/**
 * A review written with Suwi, one KPI at a time (25 Nov 2026, HR: "if I ask Suwi, as Vikrant, give review to
 * Inderjeet, it should ask me: ok let's start with his first KPI, rate it ... then what do you want to fill in as
 * feedback, with an option to take me to that feedback interface ... if I don't fill in 75 characters it should
 * ask me to fill that much too").
 *
 * No model: a manager names one of their direct reports with a review word ("give review to Inderjeet", "write
 * Rohan's feedback for last month") and Suwi walks the KPIs HR assigned for that cycle, asking for a 1–5 score and
 * then a comment of at least FEEDBACK_NOTE_MIN characters (what a sent review needs). A shorter comment is not
 * padded: Suwi says how many more characters are needed and adds the next message to it. At the end it shows the
 * review as it will be filled in, a card to save it (a draft, or an update of a review already sent) and a button
 * that opens the dashboard's review page with everything filled in, to read over and send.
 *
 * Where the conversation stands is kept on the server per person (suwi_review_chats), so it does not depend on the
 * panel's short history. "cancel" ends it, "back" redoes the last KPI, "keep" leaves a sent review's score or
 * comment as it was. Only the asker's own direct reports, and only this cycle or the one before it, as the review
 * page itself allows.
 */
import { feedbackRecords, getDb, users } from '../config/db';
import { User } from '../models/user.model';
import { currentPeriodFor, previousPeriod } from '../services/cycle';
import { cycleName } from '../services/feedback-notifications.service';
import { assignedParametersFor } from '../services/kpi.service';
import { FEEDBACK_NOTE_MIN, upsertFeedback } from '../services/manager.service';
import type { SuwiAnswer } from './agent';
import { defineExecutor, getProposal, propose, SuwiActionError } from './proposals';
import { auditCol, settingsFor } from './store';
import { contextFor, SuwiLink } from './tools';

interface Kpi { parameterId: string; name: string; weight: number; guidance: string; nowScore?: number; nowNote?: string }
interface Answer { score?: number; note?: string }
interface Chat {
  _id: string; // the asker's userId: one review conversation at a time
  org: string;
  employeeUserId: string;
  name: string;
  period: string;
  kpis: Kpi[];
  answers: Answer[];
  index: number;
  step: 'score' | 'comment';
  /** What the review held when the conversation began. */
  existing: 'saved' | 'sent' | null;
  updatedAt: Date;
}

const chats = () => getDb().collection<Chat>('suwi_review_chats');
/** A conversation left this long is forgotten: the next message is a new question. */
const IDLE_MS = 2 * 60 * 60_000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const REVIEW_WORD = /\b(review|reviews|feedback|apprais\w*|rate|rating|ratings|score|kpis?)\b/i;
const LAST_CYCLE = /\b(last|previous|prev|past)\s+(month|cycle|period)\b/i;
const CANCEL = /^(cancel|stop|quit|exit|abort|never ?mind|forget it)\b/i;
const BACK = /^(back|go back|undo|previous|redo)\b/i;
const KEEP = /^(keep|same|no change|leave it|as it is|unchanged)\b/i;
const CLEAR = /^(clear|start over|restart comment|rewrite)\b/i;
const RESTART = /^(?:ok(?:ay)?\s+|now\s+|next\s+|let'?s\s+)?(?:give|write|start|do|review|begin|fill|rate|edit|update)\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const first = (name: string) => name.split(' ')[0];

const weighted = (kpis: Kpi[], answers: Answer[]) => {
  const w = kpis.reduce((s, k) => s + (k.weight || 0), 0);
  const total = w
    ? kpis.reduce((s, k, i) => s + (answers[i]?.score ?? 0) * (k.weight || 0), 0) / w
    : kpis.reduce((s, _k, i) => s + (answers[i]?.score ?? 0), 0) / Math.max(1, kpis.length);
  return Math.round(total * 10) / 10;
};

/** "4", "4/5", "4 out of 5", "four", "4 - great quarter ..." → the score and anything said after it. */
function scoreOf(text: string): { score?: number; rest: string; bad?: string } {
  const t = text.trim();
  const m = /^(?:i(?:'d| would)? (?:give|rate)(?: (?:him|her|them|it))?\s*(?:a\s*)?)?\s*([0-9]+(?:\.[0-9]+)?|one|two|three|four|five)\b\s*(?:(?:\/|out of|of)\s*5\b)?[\s,.:;!-]*/i.exec(t);
  if (!m) return { rest: t };
  const raw = m[1].toLowerCase();
  const n = WORDS[raw] ?? Number(raw);
  if (!Number.isInteger(n)) return { rest: t, bad: 'Scores are whole numbers: 1, 2, 3, 4 or 5.' };
  if (n < 1 || n > 5) return { rest: t, bad: 'The score goes from 1 to 5.' };
  return { score: n, rest: t.slice(m[0].length).trim() };
}

function kpiPrompt(c: Chat): string {
  const k = c.kpis[c.index];
  const lines = [`**${c.index + 1} of ${c.kpis.length} · ${k.name}**${k.weight ? ` (weight ${k.weight}%)` : ''}`];
  if (k.guidance) lines.push(`HR's guidance: ${k.guidance}`);
  if (k.nowScore) lines.push(`Now: ${k.nowScore} of 5. Say **keep** to leave it.`);
  lines.push(`How would you rate ${first(c.name)} on ${k.name}, from 1 to 5?`);
  return lines.join('\n\n');
}

function commentPrompt(c: Chat): string {
  const k = c.kpis[c.index];
  const a = c.answers[c.index];
  return [
    `${k.name}: **${a.score} of 5**. Now the comment: why ${a.score}? An example from this cycle helps. It needs at least ${FEEDBACK_NOTE_MIN} characters.`,
    ...(k.nowNote ? [`Say **keep** to leave the comment already on the review.`] : []),
  ].join('\n\n');
}

function shortPrompt(c: Chat): string {
  const note = c.answers[c.index].note ?? '';
  const have = note.trim().length;
  return `That comment is ${have} character${have === 1 ? '' : 's'}; a review comment needs at least ${FEEDBACK_NOTE_MIN}. Please add about ${FEEDBACK_NOTE_MIN - have} more, for example what ${first(c.name)} did that earned a ${c.answers[c.index].score}. I'll add your next message to what you wrote (say **clear** to write it again from the start).`;
}

/** The asker's direct reports named in the question, by full name first, then by a first or last name. */
async function namedReports(user: Omit<User, 'profilePhotoUrl'>, question: string) {
  const reports = await users().find(
    { org: user.org, managerUserId: user.userId, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never,
    { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } },
  ).toArray() as Pick<User, 'userId' | 'name' | 'employeeId'>[];
  const q = ` ${norm(question)} `;
  const full = reports.filter((r) => r.name && q.includes(` ${norm(r.name)} `));
  if (full.length) return full;
  const byId = reports.filter((r) => r.employeeId && q.includes(` ${norm(r.employeeId)} `));
  if (byId.length) return byId;
  return reports.filter((r) => r.name && norm(r.name).split(' ').some((w) => w.length > 2 && q.includes(` ${w} `)));
}

async function begin(user: Omit<User, 'profilePhotoUrl'>, question: string): Promise<{ text: string; chat?: Chat } | null> {
  if (!REVIEW_WORD.test(question) || /\b(trend|progress|pending|who has|how many|remind|status of)\b/i.test(question)) return null;
  const named = await namedReports(user, question);
  if (!named.length) return null;
  if (named.length > 1) {
    return { text: `Which one should we review: ${named.slice(0, 6).map((r) => `**${r.name}**`).join(', ')}? Say it again with their full name.` };
  }
  const person = named[0];
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) return null;
  const current = await currentPeriodFor(user.org!);
  const last = previousPeriod(current);
  const lastName = cycleName(last).split(' ')[0].toLowerCase();
  const period = LAST_CYCLE.test(question) || new RegExp(`\\b${lastName}\\b`, 'i').test(question) ? last : current;
  const assigned = await assignedParametersFor(user.org!, person.userId, period);
  if (!assigned.length) {
    return { text: `${person.name} has no KPIs assigned for the ${cycleName(period)} cycle, so there is nothing to score yet. Assign their KPIs on Performance Reviews (Assign KPIs), then ask me again.` };
  }
  const record = await feedbackRecords().findOne({ managerUserId: user.userId, employeeUserId: person.userId, period });
  const byParam = new Map((record?.parameters ?? []).map((p) => [p.parameterId ?? `name:${norm(p.name)}`, p]));
  const kpis: Kpi[] = assigned.map((a) => {
    const had = byParam.get(a.id) ?? byParam.get(`name:${norm(a.title)}`);
    return {
      parameterId: a.id, name: a.title, weight: a.weight, guidance: (a.description ?? '').trim().slice(0, 300),
      ...(had && had.score > 0 ? { nowScore: had.score } : {}),
      ...(had && (had.note ?? '').trim() ? { nowNote: had.note.trim() } : {}),
    };
  });
  const chat: Chat = {
    _id: user.userId, org: user.org!, employeeUserId: person.userId, name: person.name, period, kpis,
    answers: kpis.map(() => ({})), index: 0, step: 'score', existing: (record?.status as Chat['existing']) ?? null, updatedAt: new Date(),
  };
  const intro = [
    `Let's review **${person.name}** for the **${cycleName(period)}** cycle. ${first(person.name)} is scored on ${kpis.length} KPI${kpis.length === 1 ? '' : 's'}: ${kpis.map((k) => `${k.name}${k.weight ? ` (${k.weight}%)` : ''}`).join(', ')}.`,
    record?.status === 'sent'
      ? `You've already sent this review (overall ${Number(record.overallScore ?? 0).toFixed(1)}). We'll go through it again; say **keep** to leave a score or comment as it is.`
      : record ? 'You have a draft saved; its scores are shown as we go.' : '',
    `For each one I'll ask for a score from 1 to 5, then a comment of at least ${FEEDBACK_NOTE_MIN} characters. Say **back** to redo the last one, or **cancel** to stop. Nothing is saved until you confirm at the end.`,
  ].filter(Boolean).join('\n\n');
  return { text: `${intro}\n\n${kpiPrompt(chat)}`, chat };
}

/** The end: the review as it will be filled in, a card to save it, and the review page with it filled in. */
async function finish(user: Omit<User, 'profilePhotoUrl'>, c: Chat): Promise<Pick<SuwiAnswer, 'text' | 'links' | 'proposals'>> {
  const overall = weighted(c.kpis, c.answers);
  const parameters = c.kpis.map((k, i) => ({ parameterId: k.parameterId, score: c.answers[i].score!, note: (c.answers[i].note ?? '').trim() }));
  const table = [
    '| KPI | Score | Comment |',
    '|---|---|---|',
    ...c.kpis.map((k, i) => `| ${k.name}${k.weight ? ` (${k.weight}%)` : ''} | ${c.answers[i].score} of 5 | ${(c.answers[i].note ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim()} |`),
  ].join('\n');
  const settings = await settingsFor(user.org!);
  const ctx = contextFor(user, settings.levels, new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const sent = c.existing === 'sent';
  const proposals: SuwiAnswer['proposals'] = [];
  if (settings.levels.performance === 'act') {
    const before = await feedbackRecords().findOne({ managerUserId: user.userId, employeeUserId: c.employeeUserId, period: c.period });
    const id = await propose(ctx, {
      kind: 'fill_review', area: 'performance',
      title: sent ? `Update ${c.name}'s ${cycleName(c.period)} review` : `Save ${c.name}'s ${cycleName(c.period)} review as a draft`,
      summary: sent
        ? `Updates the review you already sent ${first(c.name)} for ${cycleName(c.period)}, overall ${overall} of 5. ${first(c.name)} sees the new scores and comments.`
        : `Saves your review of ${c.name} for ${cycleName(c.period)} as a draft, overall ${overall} of 5. It is not sent: ${first(c.name)} sees nothing until you send it from the review page.`,
      lines: [
        ...c.kpis.map((k, i) => ({ text: `${k.name}: ${c.answers[i].score} of 5. "${(c.answers[i].note ?? '').trim()}"` })),
        sent
          ? { text: 'The review stays sent; this replaces its scores and comments. Undo puts the earlier ones back.', tone: 'warn' as const }
          : { text: 'To send it, open the review page and press Send review.', tone: 'info' as const },
      ],
      effectiveFrom: ctx.today, undoable: Boolean(before),
      payload: { byUserId: user.userId, employeeUserId: c.employeeUserId, name: c.name, period: c.period, parameters },
    });
    proposals.push(await getProposal(user.userId, user.org!, id));
  }
  const text = [
    `Here is ${c.name}'s ${cycleName(c.period)} review as it will be filled in. Overall: **${overall} of 5**.`,
    table,
    proposals.length
      ? (sent ? 'Press **Confirm** on the card to update the sent review, or open the review page to read it over first.' : 'Press **Confirm** on the card to save it as a draft, or **Open the review page** to read it over and send it.')
      : 'Open the review page to read it over and send it; everything is filled in there.',
  ].join('\n\n');
  const links: SuwiLink[] = [{ label: 'Open the review page', view: 'feedback', review: { userId: c.employeeUserId, period: c.period, parameters } }];
  return { text, links, proposals };
}

/** One message in a review conversation: the reply, and the conversation as it now stands (null when it ended). */
async function step(user: Omit<User, 'profilePhotoUrl'>, c: Chat, message: string): Promise<Pick<SuwiAnswer, 'text' | 'links' | 'proposals'> & { chat: Chat | null }> {
  const said = message.trim();
  const plain = { links: [] as SuwiLink[], proposals: [] as SuwiAnswer['proposals'] };
  if (CANCEL.test(said)) return { ...plain, text: `Stopped ${c.name}'s review. Nothing was saved.`, chat: null };
  if (BACK.test(said)) {
    if (c.step === 'comment') c.step = 'score';
    else if (c.index > 0) { c.index -= 1; c.step = 'score'; }
    c.answers[c.index] = {};
    return { ...plain, text: kpiPrompt(c), chat: c };
  }
  const k = c.kpis[c.index];
  const a = c.answers[c.index];
  if (c.step === 'score') {
    let rest = '';
    if (KEEP.test(said) && k.nowScore) a.score = k.nowScore;
    else {
      const s = scoreOf(said);
      if (s.score === undefined) return { ...plain, text: `${s.bad ?? `I need a score for ${k.name}: a number from 1 to 5.`} (Say **cancel** to stop the review.)`, chat: c };
      a.score = s.score;
      rest = s.rest;
    }
    c.step = 'comment';
    // A score and its comment in one message ("4, she closed the audit early ...").
    if (rest.length) { a.note = rest; if (rest.length < FEEDBACK_NOTE_MIN) return { ...plain, text: `${k.name}: **${a.score} of 5**. ${shortPrompt(c)}`, chat: c }; }
    else return { ...plain, text: commentPrompt(c), chat: c };
  } else if (KEEP.test(said) && k.nowNote && !a.note) {
    a.note = k.nowNote;
  } else if (CLEAR.test(said)) {
    a.note = '';
    return { ...plain, text: `Cleared. Write the ${k.name} comment again (at least ${FEEDBACK_NOTE_MIN} characters).`, chat: c };
  } else {
    a.note = a.note ? `${a.note.trim()} ${said}` : said;
    if (a.note.trim().length < FEEDBACK_NOTE_MIN) return { ...plain, text: shortPrompt(c), chat: c };
  }
  // This KPI is done: the next one, or the end.
  const done = `${k.name}: ${a.score} of 5, comment noted.`;
  if (c.index + 1 < c.kpis.length) {
    c.index += 1; c.step = 'score';
    return { ...plain, text: `${done}\n\n${kpiPrompt(c)}`, chat: c };
  }
  const end = await finish(user, c);
  return { ...end, text: `${done}\n\n${end.text}`, chat: null };
}

/**
 * Suwi's first look at a question: a review conversation under way, or one starting. Null when it is neither,
 * and the question goes on to the rest of Suwi.
 */
export async function reviewChat(user: Omit<User, 'profilePhotoUrl'>, question: string): Promise<SuwiAnswer | null> {
  if (!user.org) return null;
  const started = Date.now();
  let chat = await chats().findOne({ _id: user.userId });
  if (chat && Date.now() - chat.updatedAt.getTime() > IDLE_MS) { await chats().deleteOne({ _id: user.userId }); chat = null; }
  let reply: Pick<SuwiAnswer, 'text' | 'links' | 'proposals'> & { chat: Chat | null };
  // Mid-review, only a short request that starts like one ("now review Rohan") starts another: a comment that
  // happens to name a colleague and the word "review" is a comment.
  const restart = Boolean(chat) && question.trim().split(/\s+/).length <= 12 && RESTART.test(question.trim());
  const fresh = !chat || restart ? await begin(user, question) : null;
  if (fresh && (!chat || !fresh.chat || fresh.chat.employeeUserId !== chat.employeeUserId || fresh.chat.period !== chat.period)) {
    reply = { text: fresh.text, links: [], proposals: [], chat: fresh.chat ?? chat };
  } else if (chat) {
    reply = await step(user, chat, question);
  } else return null;
  if (reply.chat) await chats().replaceOne({ _id: user.userId }, { ...reply.chat, updatedAt: new Date() }, { upsert: true });
  else await chats().deleteOne({ _id: user.userId });
  await auditCol().insertOne({
    org: user.org, userId: user.userId, kind: 'question', at: new Date(), page: 'review-chat', question, answer: reply.text.slice(0, 50_000),
    status: 'answered', tools: [], model: 'none', costUsd: 0, timing: { path: 'instant', totalMs: Date.now() - started },
  } as never).catch(() => undefined);
  return { text: reply.text, checked: [], links: reply.links, proposals: reply.proposals, costUsd: 0, path: 'instant' };
}

type Line = { parameterId: string; score: number; note: string };

defineExecutor('fill_review', {
  async run(p) {
    const { byUserId, employeeUserId, name, period, parameters } = p.payload as { byUserId: string; employeeUserId: string; name: string; period: string; parameters: Line[] };
    const before = await feedbackRecords().findOne({ managerUserId: byUserId, employeeUserId, period });
    // A review sent stays sent (upsertFeedback keeps it so); anything else is saved as a draft.
    const status = before?.status === 'sent' ? 'sent' : 'saved';
    await upsertFeedback(byUserId, employeeUserId, { status, parameters, extra: before?.extra ?? '', period });
    return {
      message: status === 'sent' ? `Updated ${name}'s ${cycleName(period)} review.` : `Saved ${name}'s ${cycleName(period)} review as a draft (not sent).`,
      undo: { previous: before ? { parameters: before.parameters.map((x) => ({ parameterId: x.parameterId, score: x.score, note: x.note })), extra: before.extra ?? '', status: before.status } : null },
    };
  },
  async undo(p) {
    const { byUserId, employeeUserId, name, period } = p.payload as { byUserId: string; employeeUserId: string; name: string; period: string };
    const prev = p.undo?.previous as { parameters: Line[]; extra: string; status: 'saved' | 'sent' } | null | undefined;
    if (!prev) throw new SuwiActionError(409, 'There was no earlier review to put back');
    await upsertFeedback(byUserId, employeeUserId, { status: prev.status, parameters: prev.parameters, extra: prev.extra, period });
    return `Put back the earlier version of ${name}'s ${cycleName(period)} review.`;
  },
});
