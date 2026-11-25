/**
 * A review written with Suwi (25 Nov 2026, HR: "if I ask Suwi, as Vikrant, give review to Inderjeet, it should ask
 * me: ok let's start with his first KPI, rate it ... then what do you want to fill in as feedback, with an option to
 * take me to that feedback interface ... if I don't fill in 75 characters it should ask me to fill that much too";
 * later the same day: "when I ask Suwi to fill feedback it asks me who, then parameter wise feedback, minimum
 * 75 character limit thing too, it talks like human; if I provide feedback directly, parameters and score and
 * feedback, it picks it and tells me the discrepancies for me to fill on chat itself; it should handle all cases").
 *
 * A manager asks to write a review: with a name ("give review to Inderjeet") it starts on that direct report; with
 * none ("fill feedback", "help me write a review for someone in my team") Suwi asks who, listing the direct reports
 * still waiting for one this cycle. Then, per KPI HR assigned for the cycle, a 1–5 score and a comment of at least
 * FEEDBACK_NOTE_MIN characters (what a sent review needs). A shorter comment is never padded: Suwi says how many more
 * characters it needs and adds the next message to it. Everything at once works too ("Hiring 4 - ...; Upskilling 3:
 * ..." in any shape, or in the middle of the walk): each piece is matched to a KPI and Suwi lists what is missing or
 * wrong (KPIs not mentioned, no score, a score that is not a whole 1–5, a short comment, a name that is no KPI, a
 * KPI given twice), then asks only for those. At the end: the review as it will be filled in, a card that saves it
 * (a draft, or an update of a review already sent) and a link to the review page with everything filled in.
 *
 * Also: "make hiring 3", "change the quality comment", "go to quality", "skip", "back", "keep", "clear", "what's
 * left?", "done", "save draft" (an unfinished draft), "go through" (every KPI again), "last month", "cancel". A
 * draft already saved is shown and carried on from; a sent review is shown and edited. A question that is not about
 * the review goes on to the rest of Suwi and the review waits (agent.ts adds a line saying it is still open).
 *
 * The rules are all here, in code: only the asker's own direct reports, only this cycle or the one before it, only
 * the KPIs assigned, whole scores 1–5, comments of at least 75 characters (upsertFeedback checks the same on save).
 * The quick model (reviewChatText.ts) only splits free-form text and rewords short replies, at most once a message.
 *
 * Where the conversation stands is kept on the server per person (suwi_review_chats), not in the panel's history.
 * A review left for over two hours is picked up again with a "welcome back"; after three days it is forgotten.
 */
import { feedbackRecords, getDb, users } from '../config/db';
import { User } from '../models/user.model';
import { currentPeriodFor, previousPeriod } from '../services/cycle';
import { cycleName } from '../services/feedback-notifications.service';
import { assignedParametersFor, assignedParametersForMany } from '../services/kpi.service';
import { FEEDBACK_NOTE_MIN, upsertFeedback } from '../services/manager.service';
import type { SuwiAnswer } from './agent';
import { cancelProposal, defineExecutor, getProposal, propose, SuwiActionError } from './proposals';
import { kpiNamedExactly, kpisNamed, looksLikeMany, ModelUse, modelParse, norm, parseMany, phrase, Piece, questionLike, reviewChatModel, scoreInside, scoreOf } from './reviewChatText';
import { auditCol, settingsFor, spentThisMonthUsd } from './store';
import { contextFor, SuwiLink, teamScoped } from './tools';

interface Kpi { parameterId: string; name: string; weight: number; guidance: string; nowScore?: number; nowNote?: string }
/** `was`: what a KPI held before it was reopened ("back", "go through"), so "keep" can put it back. */
interface Answer { score?: number; note?: string; was?: { score?: number; note?: string } }
interface Chat {
  _id: string; // the asker's userId: one review conversation at a time
  org: string;
  /** who: asked who to review; review: under way; done: shown in full (with or without a card), open to changes. */
  mode?: 'who' | 'review' | 'done';
  /** While asking who: the people a reply may name, and the one a "yes" means when Suwi asked "is it X?". */
  choices?: { userId: string; name: string }[];
  suggested?: string;
  employeeUserId: string;
  name: string;
  period: string;
  kpis: Kpi[];
  answers: Answer[];
  index: number;
  step: 'score' | 'comment';
  /** Taking every KPI in order (a sent review gone through again), not only the ones still missing something. */
  walk?: boolean;
  /** What the review held when the conversation began. */
  existing: 'saved' | 'sent' | null;
  /** The last save card shown, cancelled when a newer one replaces it. */
  proposalId?: string;
  /** Messages so far: picks among the ways of saying the same thing, so Suwi does not repeat itself word for word. */
  turns?: number;
  updatedAt: Date;
}

const chats = () => getDb().collection<Chat>('suwi_review_chats');
/** After this long the next message gets a "welcome back"; a "who" question or a finished review is simply dropped. */
const IDLE_MS = 2 * 60 * 60_000;
/** After this long a review left half done is forgotten (nothing of it was saved). */
const FORGET_MS = 3 * 24 * 60 * 60_000;
const MIN = FEEDBACK_NOTE_MIN;

const REVIEW_WORD = /\b(review|reviews|feedback|apprais\w*|rate|rating|ratings|score|kpis?)\b/i;
/** Asking about reviews rather than writing one: left to the rest of Suwi. */
const READING = /^(?:how|what|which|when|where|why|show|list|see|view|open|did|has|have|is|are|was|were|does)\b|\b(?:trend|progress|pending|who has|how many|remind|status of|history|average|compare|summary of)\b/i;
const WRITING = /\b(?:give|giving|write|writing|fill|filling|start|begin|do|doing|submit|complete|finish|draft|edit|update|change|redo|continue|resume|help|let'?s|want to|need to|have to|like to|time to)\b/i;
const LAST_CYCLE = /\b(last|previous|prev|past)\s+(month|cycle|period)\b/i;
const THIS_CYCLE = /\b(this|current)\s+(month|cycle|period)\b/i;
const CANCEL = /^(?:cancel|stop|quit|exit|abort|never ?mind|forget it|drop it)\b/i;
const BACK = /^(?:back|go back|undo|previous|redo)\b/i;
const KEEP = /^(?:keep|same|no change|leave it|as it is|unchanged)\b/i;
const CLEAR = /^(?:clear|start over|restart comment|rewrite)\b/i;
const SKIP = /^(?:skip|next|pass|later|come back to (?:this|it)|leave (?:this|it) for (?:now|later)|move on)\b/i;
const LEFT = /^(?:(?:what'?s|what is|whats)\s+(?:left|remaining|pending|missing|still (?:left|needed|missing))|status|progress|recap|summary|where (?:are|were) we|how far|remind me|show (?:me )?(?:the |my )?(?:review|progress|draft|what i have|so far)|left\??$)/i;
const DONE = /^(?:done|finish(?:ed)?|that'?s (?:it|all)|all done|wrap (?:it )?up|i'?m done|finish (?:it|up)|looks good|good to go|ready)\b/i;
const SAVE_DRAFT = /^(?:save|keep)\s+(?:it\s+|this\s+|what i have\s+)?(?:as\s+)?(?:a\s+)?draft\b|^save (?:it|this|what i have)(?: for now)?\s*[.!]?$/i;
const GO_THROUGH = /^(?:go through|walk me through|take me through|from the (?:top|start|beginning)|start from the (?:top|beginning|start)|redo (?:all|everything|the whole)|all of them|one by one|each one)/i;
const HELP = /^(?:help|i'?m not sure|not sure|no idea|i don'?t know|idk|what (?:should|do|can|could) i (?:write|say|put)|give me (?:an )?(?:example|idea|ideas)|any (?:examples?|ideas?|tips?)|examples?\??$|suggest|can you (?:write|draft|suggest|help)|how do i|what does .+ mean|what is .+ about)|\b(?:75|characters?|minimum|how long)\b.*\?$/i;
const RESTART = /^(?:ok(?:ay)?\s+|now\s+|next\s+|let'?s\s+)?(?:give|write|start|do|review|begin|fill|rate|edit|update)\b/i;
const SCORE_WORD = '([0-9]+(?:\\.[0-9]+)?|one|two|three|four|five)';
const CHANGE_SCORE = new RegExp(`^(?:(?:please|ok(?:ay)?|actually|sorry|wait|and)[,\\s]+)*(?:make|change|set|update|put|mark|give|switch|bump|lower|raise|move)\\s+(?:the\\s+)?(?:score\\s+(?:for|on|of)\\s+)?(.+?)\\s+(?:score\\s+)?(?:to|as|at|=|a|an|up to|down to|:)?\\s*${SCORE_WORD}\\s*(\\/\\s*10|out of 10)?(?:\\/\\s*5|out of 5)?\\s*[.!]?$`, 'i');
const SHOULD_BE = new RegExp(`^(.+?)\\s+(?:should be|is|=|->|→|to)\\s*${SCORE_WORD}\\s*(\\/\\s*10|out of 10)?(?:\\/\\s*5|out of 5)?\\s*[.!]?$`, 'i');
const CHANGE_NOTE = /^(?:(?:please|ok(?:ay)?|actually|and)[,\s]+)*(?:change|edit|rewrite|redo|update|fix|replace|reword)\s+(?:the\s+|my\s+)?(?:(.+?)\s+(?:comment|note|feedback|text|words)|(?:comment|note|feedback)\s+(?:for|on|of)\s+(?:the\s+)?(.+?))\s*[.!]?$/i;
const GOTO = /^(?:(?:ok(?:ay)?|let'?s|can we|now)[,\s]+)*(go to|go back to|jump to|skip to|switch to|move to|back to|on to|onto|do|open|redo|start with|start on|let'?s do|over to)\s+(?:the\s+)?(.+?)(?:\s+(?:kpi|one|next|now|first|please))*\s*[.!?]?$/i;
/** Only these say for sure the manager meant a KPI ("go to teamwork"); "do more code reviews" may be a comment. */
const STRONG_GOTO = /^(?:go to|go back to|jump to|skip to|switch to|move to|back to|over to)$/i;

const first = (name: string) => name.split(' ')[0];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const validScore = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const pick = (c: { turns?: number }, ways: string[]) => ways[(c.turns ?? 0) % ways.length];

type Who = Omit<User, 'profilePhotoUrl'>;
type Report = { userId: string; name: string; employeeId?: string };
interface Part { text: string; phrase?: boolean; keep?: string[] }
interface Reply {
  parts: Part[];
  links?: SuwiLink[];
  proposals?: SuwiAnswer['proposals'];
  /** The conversation as it now stands; null when it ended. */
  chat: Chat | null;
  /** Not about the review: the rest of Suwi answers, the conversation waits. */
  aside?: boolean;
  /** Not for the review conversation at all (it is over): the rest of Suwi answers. */
  pass?: boolean;
  /** A start that resolved nobody (a who-list, a name that is no direct report): never interrupts a review under way. */
  weak?: boolean;
  /** A model call already made this message (splitting it): the reply is not reworded as well. */
  use?: ModelUse | null;
  tried?: boolean;
}

const weighted = (kpis: Kpi[], answers: Answer[]) => {
  const w = kpis.reduce((s, k) => s + (k.weight || 0), 0);
  const total = w
    ? kpis.reduce((s, k, i) => s + (answers[i]?.score ?? 0) * (k.weight || 0), 0) / w
    : kpis.reduce((s, _k, i) => s + (answers[i]?.score ?? 0), 0) / Math.max(1, kpis.length);
  return Math.round(total * 10) / 10;
};

/** A KPI is done with a whole 1–5 score and a comment of at least MIN characters (or a sent comment left as it was). */
function complete(c: Chat, i: number): boolean {
  const a = c.answers[i];
  const k = c.kpis[i];
  const note = (a.note ?? '').trim();
  return validScore(a.score) && (note.length >= MIN || (c.existing === 'sent' && Boolean(k.nowNote) && note === k.nowNote));
}
const gapAfter = (c: Chat, from: number) => {
  for (let d = 1; d <= c.kpis.length; d++) { const i = (from + d) % c.kpis.length; if (!complete(c, i)) return i; }
  return -1;
};
const firstGap = (c: Chat) => c.kpis.findIndex((_k, i) => !complete(c, i));
const keepScore = (c: Chat) => c.answers[c.index].was?.score ?? c.kpis[c.index].nowScore;
const keepNote = (c: Chat) => c.answers[c.index].was?.note ?? c.kpis[c.index].nowNote;

/** Opens a KPI: on a walk (or when asked for by name), what it held is put aside for "keep". */
function focus(c: Chat, i: number, reopen: boolean) {
  c.index = i;
  const a = c.answers[i];
  if (reopen && (a.score !== undefined || a.note)) { c.answers[i] = { was: { score: a.score, note: a.note } }; c.step = 'score'; return; }
  c.step = validScore(a.score) ? 'comment' : 'score';
}

function card(c: Chat): string {
  const k = c.kpis[c.index];
  const lines = [`**${k.name}** · KPI ${c.index + 1} of ${c.kpis.length}${k.weight ? ` · weight ${k.weight}%` : ''}`];
  if (k.guidance) lines.push(`HR's guidance: ${k.guidance}`);
  return lines.join('\n');
}

/** What Suwi asks for next on the KPI in focus, after `ack` (what it just took). */
function askNow(c: Chat, ack = ''): Part[] {
  const k = c.kpis[c.index];
  const a = c.answers[c.index];
  const fn = first(c.name);
  const lead = (s: string) => `${ack ? `${ack} ` : ''}${s}`;
  if (c.step === 'score') {
    const kept = keepScore(c);
    const q = (a.note ?? '').trim()
      ? `I have your comment for **${k.name}**; what score goes with it, from 1 to 5?`
      : pick(c, [
        `How would you rate ${fn} on **${k.name}**, from 1 to 5?`,
        `What score would you give ${fn} for **${k.name}**, from 1 to 5?`,
        `Where would you put ${fn} on **${k.name}**, from 1 to 5?`,
      ]);
    return [{ text: lead(`${q}${kept ? ` It's ${kept} now; say **keep** to leave it.` : ''}`), phrase: true, keep: [k.name, fn] }, { text: card(c) }];
  }
  const note = (a.note ?? '').trim();
  if (note) return [{ text: lead(more(c)), phrase: true, keep: [k.name] }];
  const kept = keepNote(c);
  const q = pick(c, [
    `Why a ${a.score}? Tell me in your own words; an example from this cycle helps. It needs at least ${MIN} characters.`,
    `What's behind the ${a.score}? A line or two with a real example works best, at least ${MIN} characters.`,
    `Now the comment: what should ${fn} hear about **${k.name}**? At least ${MIN} characters, ideally with an example.`,
  ]);
  return [
    { text: lead(`${q}${kept ? ' Say **keep** to leave the comment that is there now.' : ''}`), phrase: true, keep: [fn] },
    ...(kept ? [{ text: `The comment now: "${clip(kept.replace(/\s+/g, ' '), 400)}"` }] : []),
  ];
}

/** A comment still short: how many characters it has, how many more it needs; the next message is added to it. */
function more(c: Chat): string {
  const have = (c.answers[c.index].note ?? '').trim().length;
  return pick(c, [
    `That comment is ${have} character${have === 1 ? '' : 's'}; it needs at least ${MIN}, so about ${MIN - have} more. What else should ${first(c.name)} hear about **${c.kpis[c.index].name}**? I'll add your next message to it (say **clear** to start again).`,
    `Nearly there: ${have} characters so far and it needs ${MIN}, about ${MIN - have} more. Add a little more on **${c.kpis[c.index].name}**, for example what ${first(c.name)} did that earned the ${c.answers[c.index].score ?? 'score'}; I'll join it to what you wrote (or say **clear**).`,
  ]);
}

/** This KPI is done: on to the next one still missing something (or the next in order on a walk), or the end. */
async function advance(user: Who, c: Chat, ack: string): Promise<Reply> {
  let next: number;
  if (c.walk && c.index + 1 < c.kpis.length) next = c.index + 1;
  else { c.walk = false; next = gapAfter(c, c.index); }
  if (next < 0) return finish(user, c, false, ack);
  focus(c, next, Boolean(c.walk));
  return { parts: askNow(c, ack), chat: c };
}

/** Carry on with what is in focus, or the next gap, or the end. */
async function resume(user: Who, c: Chat, ack: string): Promise<Reply> {
  if (c.mode === 'review' && c.index >= 0 && c.index < c.kpis.length && !complete(c, c.index)) {
    focus(c, c.index, false);
    return { parts: askNow(c, ack), chat: c };
  }
  const gap = firstGap(c);
  if (gap < 0) return finish(user, c, false, ack);
  c.mode = 'review';
  focus(c, gap, false);
  return { parts: askNow(c, ack), chat: c };
}

/** Each KPI in a line: its score and how far its comment is. */
function statusLines(c: Chat): string {
  return c.kpis.map((k, i) => {
    const a = c.answers[i];
    const note = (a.note ?? '').trim();
    const score = validScore(a.score) ? `${a.score} of 5` : 'no score yet';
    const said = complete(c, i) ? 'comment done' : !note ? 'no comment yet' : `comment needs ${MIN - note.length} more characters`;
    return `- **${k.name}**: ${score}, ${said}`;
  }).join('\n');
}

function table(c: Chat): string {
  return [
    '| KPI | Score | Comment |',
    '|---|---|---|',
    ...c.kpis.map((k, i) => {
      const a = c.answers[i];
      const note = (a.note ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
      return `| ${k.name}${k.weight ? ` (${k.weight}%)` : ''} | ${validScore(a.score) ? `${a.score} of 5` : 'not scored'} | ${note || 'no comment yet'}${note && !complete(c, i) ? ` (needs ${MIN - note.length} more characters)` : ''} |`;
    }),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Starting: who, and which cycle.

async function directReports(user: Who): Promise<Report[]> {
  return await users().find(
    { org: user.org, managerUserId: user.userId, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never,
    { projection: { _id: 0, userId: 1, name: 1, employeeId: 1 } },
  ).toArray() as unknown as Report[];
}

/** The people named in a message, by full name first, then employee ID, then a first or last name (or its start). */
function namedIn(people: Report[], text: string): Report[] {
  const q = ` ${norm(text)} `;
  const full = people.filter((r) => r.name && q.includes(` ${norm(r.name)} `));
  if (full.length) return full;
  const byId = people.filter((r) => r.employeeId && q.includes(` ${norm(r.employeeId)} `));
  if (byId.length) return byId;
  const said = q.trim().split(' ').filter((s) => !NOT_A_PERSON.has(s) && !WRITING.test(s) && !REVIEW_WORD.test(s));
  const byWord = people.filter((r) => r.name && norm(r.name).split(' ').some((w) => w.length > 2 && q.includes(` ${w} `)));
  if (byWord.length) return byWord;
  return people.filter((r) => r.name && norm(r.name).split(' ').some((w) => said.some((s) => s.length >= 4 && w.startsWith(s))));
}

const NOT_A_PERSON = new Set(['my', 'our', 'the', 'a', 'an', 'someone', 'somebody', 'anyone', 'team', 'him', 'her', 'them', 'this', 'that', 'last', 'previous', 'month', 'cycle', 'all', 'everyone', 'people', 'member', 'members', 'now', 'please', 'me', 'it', 'for', 'to', 'of', 'one', 'person', 'employee', 'employees', 'report', 'reports', 'direct', 'today', 'his', 'their', 'with', 'in', 'on', 'review', 'reviews', 'feedback', 'quarter', 'year', 'performance', 'each', 'every', 'members', 'someones', 'whom', 'who', 'current', 'next', 'kpi', 'kpis',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

/** A name the message gives for the person reviewed ("review to Priya", "Priya's feedback"), even if nobody has it. */
function targetName(text: string): string | null {
  const tries = [
    /\b(?:review|feedback|rating|ratings|appraisal|score|kpis?)\s+(?:to|for|of|on)\s+([A-Za-z][\w.-]*)/i,
    /\b([A-Za-z][\w-]*)['’]s\s+(?:\w+\s+)?(?:review|feedback|rating|appraisal|kpis?)\b/i,
    /^(?:please\s+)?(?:review|rate|score|appraise)\s+([A-Za-z][\w.-]*)/i,
  ];
  for (const re of tries) {
    const m = re.exec(text);
    if (m && m[1].length >= 2 && !NOT_A_PERSON.has(m[1].toLowerCase())) return m[1][0].toUpperCase() + m[1].slice(1);
  }
  return null;
}

async function periodAsked(org: string, text: string): Promise<string> {
  const current = await currentPeriodFor(org);
  const last = previousPeriod(current);
  const lastMonth = cycleName(last).split(' ')[0].toLowerCase();
  return LAST_CYCLE.test(text) || new RegExp(`\\b${lastMonth}\\b`, 'i').test(text) ? last : current;
}

/** Whether `userId` reports to the asker somewhere down the line (a manager's own subtree). */
async function inSubtree(asker: string, managerUserId: string | undefined): Promise<boolean> {
  let at = managerUserId;
  for (let hops = 0; at && hops < 10; hops++) {
    if (at === asker) return true;
    at = ((await users().findOne({ userId: at }, { projection: { _id: 0, managerUserId: 1 } })) as { managerUserId?: string } | null)?.managerUserId;
  }
  return false;
}

/**
 * Someone who is not the asker's direct report. Someone further down their own team is named with the manager who
 * writes that review; for anyone else the answer is the same whether or not the name exists, so a manager learns
 * nothing about people outside their team.
 */
async function notMine(user: Who, target: string, reports: Report[]): Promise<Reply> {
  const t = norm(target);
  const people = await users().find(
    { org: user.org, userId: { $ne: user.userId }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never,
    { projection: { _id: 0, userId: 1, name: 1, managerUserId: 1 } },
  ).toArray() as unknown as (Report & { managerUserId?: string })[];
  const matches = people.filter((p) => p.name && norm(p.name).split(' ').some((w) => w === t || (t.length >= 4 && w.startsWith(t))));
  const mine = reports.map((r) => `**${r.name}**`);
  for (const p of matches.slice(0, 5)) {
    const visible = !teamScoped(user) || await inSubtree(user.userId, p.managerUserId);
    const boss = visible && p.managerUserId ? people.find((x) => x.userId === p.managerUserId) : undefined;
    if (boss) {
      return { parts: [{ text: `**${p.name}** reports to **${boss.name}**, so ${first(boss.name)} writes that review; only someone's own manager can. ${mine.length ? `You can review ${listOf(mine)}.` : ''}`.trim() }], chat: null };
    }
  }
  return {
    parts: [{ text: `I can only help you review your own direct reports${mine.length ? ` (${listOf(mine)})` : ''}. ${target}'s review has to come from their own manager.` }],
    chat: null,
  };
}

function whoChat(user: Who, choices: Report[], period: string): Chat {
  return {
    _id: user.userId, org: user.org!, mode: 'who', choices: choices.map((r) => ({ userId: r.userId, name: r.name })),
    employeeUserId: '', name: '', period, kpis: [], answers: [], index: 0, step: 'score', existing: null, turns: 0, updatedAt: new Date(),
  };
}

/** "Fill feedback" with no name: who still needs a review this cycle, and a question. */
async function askWho(user: Who, reports: Report[], period: string): Promise<Reply> {
  const ids = reports.map((r) => r.userId);
  const [assigned, records] = await Promise.all([
    assignedParametersForMany(user.org!, ids, period),
    feedbackRecords().find({ managerUserId: user.userId, period, employeeUserId: { $in: ids } }).toArray(),
  ]);
  const status = new Map(records.map((r) => [r.employeeUserId, r.status]));
  const waiting = reports.filter((r) => assigned.get(r.userId)?.length && status.get(r.userId) !== 'sent');
  const sent = reports.filter((r) => status.get(r.userId) === 'sent');
  const noKpis = reports.filter((r) => !assigned.get(r.userId)?.length);
  const cycle = cycleName(period);
  const parts: Part[] = [];
  if (waiting.length) {
    parts.push({ text: waiting.length === 1 ? `Happy to help. Is it **${waiting[0].name}**? Theirs is the one still to do for ${cycle}.` : `Happy to help. Who is the review for?`, phrase: true, keep: waiting.length === 1 ? [waiting[0].name] : [] });
    if (waiting.length > 1) parts.push({ text: `Still to do for **${cycle}**: ${listOf(waiting.map((r) => `**${r.name}**${status.get(r.userId) === 'saved' ? ' (draft saved)' : ''}`))}.` });
  } else if (sent.length) {
    parts.push({ text: `All your ${cycle} reviews are sent already. Want to change one of them? Tell me who.`, phrase: true });
  } else {
    parts.push({ text: `None of your team has KPIs assigned for ${cycle} yet, so there is nothing to review. HR assigns them on Performance Reviews (Assign KPIs).` });
    return { parts, chat: null };
  }
  if (sent.length && waiting.length) parts.push({ text: `Already sent: ${listOf(sent.map((r) => r.name))}. I can help you edit those too.` });
  if (noKpis.length) parts.push({ text: `No KPIs assigned yet, so not ready for a review: ${listOf(noKpis.map((r) => r.name))}.` });
  return { parts, chat: { ...whoChat(user, reports, period), ...(waiting.length === 1 ? { suggested: waiting[0].userId } : {}) } };
}

/** A review for one direct report and cycle: a draft or a sent review is shown and carried on from. */
async function startFor(user: Who, person: Report, period: string): Promise<Reply> {
  const assigned = await assignedParametersFor(user.org!, person.userId, period);
  if (!assigned.length) {
    return { parts: [{ text: `${person.name} has no KPIs assigned for the ${cycleName(period)} cycle, so there is nothing to score yet. Assign their KPIs on Performance Reviews (Assign KPIs), then ask me again.` }], chat: null };
  }
  const record = await feedbackRecords().findOne({ managerUserId: user.userId, employeeUserId: person.userId, period });
  const byParam = new Map((record?.parameters ?? []).map((p) => [p.parameterId ?? `name:${norm(p.name)}`, p]));
  const kpis: Kpi[] = assigned.map((a) => {
    const had = byParam.get(a.id) ?? byParam.get(`name:${norm(a.title)}`);
    return {
      parameterId: a.id, name: a.title, weight: a.weight, guidance: (a.description ?? '').trim().slice(0, 300),
      ...(had && validScore(had.score) ? { nowScore: had.score } : {}),
      ...(had && (had.note ?? '').trim() ? { nowNote: had.note.trim() } : {}),
    };
  });
  const c: Chat = {
    _id: user.userId, org: user.org!, mode: 'review', employeeUserId: person.userId, name: person.name, period, kpis,
    answers: kpis.map((k) => ({ ...(k.nowScore ? { score: k.nowScore } : {}), ...(k.nowNote ? { note: k.nowNote } : {}) })),
    index: 0, step: 'score', walk: false, existing: (record?.status as Chat['existing']) ?? null, turns: 0, updatedAt: new Date(),
  };
  const fn = first(person.name);
  const cycle = cycleName(period);
  const list = listOf(kpis.map((k) => `${k.name}${k.weight ? ` (${k.weight}%)` : ''}`));
  if (!record) {
    focus(c, 0, false);
    return {
      parts: [
        { text: `Sure, let's do **${person.name}**'s review for **${cycle}**.`, phrase: true, keep: [person.name] },
        { text: `${fn} has ${kpis.length} KPI${kpis.length === 1 ? '' : 's'}: ${list}. For each I'll ask for a score from 1 to 5 and then a comment of at least ${MIN} characters. If it's quicker, send them all in one message (for example "${kpis[0].name} 4 - ..."${kpis[1] ? `, "${kpis[1].name} 3 - ..."` : ''}) and I'll sort it out. Nothing is saved until you confirm.` },
        ...askNow(c),
      ],
      chat: c,
    };
  }
  const gap = firstGap(c);
  if (record.status === 'sent' || gap < 0) {
    c.mode = 'done';
    const sent = record.status === 'sent';
    return {
      parts: [
        { text: sent ? `You've already sent ${fn}'s ${cycle} review (overall ${Number(record.overallScore ?? 0).toFixed(1)}). Here's what it says.` : `Your draft of ${fn}'s ${cycle} review is complete. Here it is.`, phrase: true, keep: [fn] },
        { text: table(c) },
        { text: `What would you like to change? For example **make ${kpis[0].name.toLowerCase()} 3** or **change the ${kpis[0].name.toLowerCase()} comment**. Say **go through** to take each KPI again${sent ? '' : ', **done** to get it ready to send'}, or **cancel** to leave it as it is.` },
      ],
      chat: c,
    };
  }
  focus(c, gap, false);
  return {
    parts: [
      { text: `You have a draft of ${fn}'s ${cycle} review saved. Let's finish it.`, phrase: true, keep: [fn] },
      { text: statusLines(c) },
      ...askNow(c),
    ],
    chat: c,
  };
}

/** The first message of a review conversation: a name, several names, someone else's report, or nobody yet. */
async function begin(user: Who, question: string): Promise<Reply | null> {
  const q = question.trim();
  if (!REVIEW_WORD.test(q) || READING.test(q)) return null;
  const settings = await settingsFor(user.org!);
  if (!settings.enabled) return null;
  const reports = await directReports(user);
  const period = await periodAsked(user.org!, q);
  const named = namedIn(reports, q);
  if (named.length === 1) return startFor(user, named[0], period);
  if (named.length > 1) {
    return { parts: [{ text: `I found ${named.length} people by that name in your team: ${listOf(named.slice(0, 6).map((r) => `**${r.name}**`))}. Which one?`, phrase: true, keep: named.slice(0, 6).map((r) => r.name) }], chat: whoChat(user, named, period) };
  }
  if (!WRITING.test(q) && !/^(?:please\s+)?(?:review|feedback|appraisal|rate|score)\b/i.test(q)) return null;
  if (!reports.length) return teamScoped(user) ? { parts: [{ text: "You don't have any direct reports, so there's no review for you to write." }], chat: null, weak: true } : null;
  const target = targetName(q);
  // HR asking about someone else's report ("draft Rohan's review") goes on to the rest of Suwi (review_draft).
  if (target) return teamScoped(user) ? { ...(await notMine(user, target, reports)), weak: true } : null;
  return { ...(await askWho(user, reports, period)), weak: true };
}

/** A reply to "who is it for?": a name, "the first one", or something else. */
async function pickWho(user: Who, c: Chat, said: string): Promise<Reply> {
  if (CANCEL.test(said)) return { parts: [{ text: 'No problem. Ask me again whenever you want to write one.' }], chat: null };
  const choices = (c.choices ?? []) as Report[];
  const ordinal = /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b/i.exec(said)?.[1].toLowerCase();
  const at = ordinal ? ['first', 'second', 'third', 'fourth', 'fifth'].findIndex((w, i) => ordinal === w || ordinal === ['1st', '2nd', '3rd', '4th', '5th'][i]) : -1;
  const yes = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|that'?s right|correct|right)\b/i.test(said) && words(said) <= 4;
  const meant = yes ? choices.find((r) => r.userId === c.suggested) ?? (choices.length === 1 ? choices[0] : undefined) : undefined;
  const named = at >= 0 && choices[at] ? [choices[at]] : meant ? [meant] : namedIn(choices, said);
  const period = LAST_CYCLE.test(said) ? previousPeriod(await currentPeriodFor(user.org!)) : c.period;
  if (named.length === 1) return startFor(user, named[0], period);
  if (named.length > 1) return { parts: [{ text: `Which one: ${listOf(named.slice(0, 6).map((r) => `**${r.name}**`))}?`, phrase: true, keep: named.slice(0, 6).map((r) => r.name) }], chat: { ...c, choices: named.map((r) => ({ userId: r.userId, name: r.name })) } };
  // Not a name: a question or something else entirely goes on to the rest of Suwi; nothing is lost.
  if (questionLike(said) || words(said) > 5) return { parts: [], chat: null, pass: true };
  return { parts: [{ text: `I couldn't find "${clip(said, 40)}" among your direct reports. Who is it: ${listOf(choices.slice(0, 8).map((r) => `**${r.name}**`))}?`, keep: [] }], chat: c };
}

// ---------------------------------------------------------------------------------------------------------------
// The end.

/** The review as it will be filled in, a card to save it, and the review page with it filled in. */
async function finish(user: Who, c: Chat, partial: boolean, ack = ''): Promise<Reply> {
  const settings = await settingsFor(user.org!);
  const ctx = contextFor(user, settings.levels, new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const before = await feedbackRecords().findOne({ managerUserId: user.userId, employeeUserId: c.employeeUserId, period: c.period });
  const sent = before?.status === 'sent';
  const overall = weighted(c.kpis, c.answers);
  const parameters = c.kpis.map((k, i) => ({ parameterId: k.parameterId, score: validScore(c.answers[i].score) ? c.answers[i].score! : 0, note: (c.answers[i].note ?? '').trim() }));
  const fn = first(c.name);
  const cycle = cycleName(c.period);
  if (c.proposalId) await cancelProposal(user.userId, user.org!, c.proposalId).catch(() => undefined);
  c.proposalId = undefined;
  const proposals: SuwiAnswer['proposals'] = [];
  if (settings.levels.performance === 'act') {
    const id = await propose(ctx, {
      kind: 'fill_review', area: 'performance',
      title: sent ? `Update ${c.name}'s ${cycle} review` : `Save ${c.name}'s ${cycle} review as a draft${partial ? ' (unfinished)' : ''}`,
      summary: sent
        ? `Updates the review you already sent ${fn} for ${cycle}, overall ${overall} of 5. ${fn} sees the new scores and comments.`
        : `Saves your review of ${c.name} for ${cycle} as a draft${partial ? ', unfinished' : `, overall ${overall} of 5`}. It is not sent: ${fn} sees nothing until you send it from the review page.`,
      lines: [
        ...c.kpis.map((k, i) => ({ text: `${k.name}: ${validScore(c.answers[i].score) ? `${c.answers[i].score} of 5` : 'not scored'}. "${(c.answers[i].note ?? '').trim()}"` })),
        sent
          ? { text: 'The review stays sent; this replaces its scores and comments. Undo puts the earlier ones back.', tone: 'warn' as const }
          : partial
            ? { text: 'Unfinished: finish the missing scores and comments on the review page before sending.', tone: 'warn' as const }
            : { text: 'To send it, open the review page and press Send review.', tone: 'info' as const },
      ],
      effectiveFrom: ctx.today, undoable: Boolean(before),
      payload: { byUserId: user.userId, employeeUserId: c.employeeUserId, name: c.name, period: c.period, parameters },
    });
    c.proposalId = id;
    proposals.push(await getProposal(user.userId, user.org!, id));
  }
  c.mode = 'done';
  c.walk = false;
  const head = partial
    ? `Here's what you have so far for ${fn}'s ${cycle} review.`
    : pick(c, [`That's everything. Here's ${c.name}'s ${cycle} review as it will be filled in, overall **${overall} of 5**.`, `All done. ${c.name}'s ${cycle} review comes to **${overall} of 5** overall.`]);
  const parts: Part[] = [
    { text: `${ack ? `${ack} ` : ''}${head}`, phrase: true, keep: [fn] },
    { text: table(c) },
    {
      text: proposals.length
        ? (sent ? 'Press **Confirm** on the card to update the sent review, or open the review page to read it over first.' : 'Press **Confirm** on the card to save it as a draft, or **Open the review page** to read it over and send it.')
        : 'Open the review page to read it over and send it; everything is filled in there.',
    },
    { text: 'Want to change something? Just say so, for example **make quality 3**.' },
  ];
  const links: SuwiLink[] = [{ label: 'Open the review page', view: 'feedback', review: { userId: c.employeeUserId, period: c.period, parameters } }];
  return { parts, links, proposals, chat: c };
}

// ---------------------------------------------------------------------------------------------------------------
// One message, mid-review.

/** Several KPIs in one message: take each, then list what is still missing or wrong and ask for the first of it. */
async function applyPieces(user: Who, c: Chat, pieces: Piece[], use: ModelUse | null): Promise<Reply> {
  const fn = first(c.name);
  const issues: string[] = [];
  const touched = new Map<number, number>();
  const bad = new Map<number, string>();
  for (const p of pieces) {
    if (p.kpi === null) {
      issues.push(`"${clip(p.named, 40)}" isn't one of ${fn}'s KPIs this cycle (they are ${listOf(c.kpis.map((k) => k.name))}), so I left it out.`);
      continue;
    }
    const i = p.kpi === 'current' ? c.index : p.kpi;
    touched.set(i, (touched.get(i) ?? 0) + 1);
    const a = c.answers[i];
    if (p.bad) { bad.set(i, p.bad); a.score = undefined; } else if (p.score !== undefined) { a.score = p.score; bad.delete(i); }
    if (p.comment) a.note = p.comment;
    delete a.was;
  }
  for (const [i, n] of touched) {
    if (n > 1) issues.push(`**${c.kpis[i].name}** came up ${n === 2 ? 'twice' : `${n} times`}; I went with the last one${validScore(c.answers[i].score) ? ` (${c.answers[i].score})` : ''}. Say **make ${c.kpis[i].name.toLowerCase()} N** to change the score.`);
  }
  const gaps = c.kpis.map((k, i) => {
    if (complete(c, i)) return null;
    const a = c.answers[i];
    const note = (a.note ?? '').trim();
    if (bad.has(i)) return `**${k.name}**: ${bad.get(i)}`;
    if (!touched.has(i) && !validScore(a.score) && !note) return `**${k.name}**: not in your message yet.`;
    if (!validScore(a.score)) return `**${k.name}**: there's a comment but no score.`;
    if (!note) return `**${k.name}**: ${a.score}, but no comment yet.`;
    return `**${k.name}**: the comment is ${note.length} characters; it needs ${MIN - note.length} more.`;
  }).filter((x): x is string => Boolean(x));
  const took = [...touched.keys()].sort((x, y) => x - y).filter((i) => validScore(c.answers[i].score)).map((i) => `**${c.kpis[i].name}** (${c.answers[i].score})`);
  const ack = took.length ? `Thanks, I've taken ${listOf(took)}.` : 'Thanks.';
  c.walk = false;
  c.mode = 'review';
  const gap = firstGap(c);
  if (gap < 0) {
    const end = await finish(user, c, false, ack);
    return { ...end, parts: [...(issues.length ? [{ text: issues.map((x) => `- ${x}`).join('\n') }] : []), ...end.parts], use };
  }
  focus(c, gap, false);
  const list = [...gaps, ...issues];
  return {
    parts: [
      { text: `${ack} ${list.length === 1 ? 'One thing still to sort out:' : `A few things still to sort out:`}` },
      { text: list.map((x) => `- ${x}`).join('\n') },
      ...askNow(c, pick(c, ["Let's start with this one.", 'First this one.', "Let's take them one at a time."])),
    ],
    chat: c,
    use,
  };
}

/** A command that names a KPI: "make hiring 3", "change the quality comment", "go to quality". Null when it is not one. */
async function named(user: Who, c: Chat, said: string): Promise<Reply | null> {
  const names = c.kpis.map((k) => k.name);
  const sc = CHANGE_SCORE.exec(said) ?? (words(said) <= 6 ? SHOULD_BE.exec(said) : null);
  if (sc) {
    const i = kpiNamedExactly(sc[1], names);
    if (i >= 0) {
      const s = scoreOf(`${sc[2]}${sc[3] ? ' /10' : ''}`);
      if (s.score === undefined) return { parts: [{ text: `${s.bad ?? 'Scores go from 1 to 5.'} What should **${names[i]}** be?` }], chat: c };
      c.answers[i].score = s.score;
      delete c.answers[i].was;
      const ack = `Done, **${names[i]}** is now ${s.score}.`;
      if (!(c.answers[i].note ?? '').trim()) { c.mode = 'review'; c.walk = false; focus(c, i, false); return { parts: askNow(c, ack), chat: c }; }
      return resume(user, c, ack);
    }
  }
  const cn = CHANGE_NOTE.exec(said);
  if (cn) {
    const i = kpiNamedExactly(cn[1] ?? cn[2] ?? '', names);
    if (i >= 0) {
      c.mode = 'review';
      c.walk = false;
      c.index = i;
      const a = c.answers[i];
      c.answers[i] = { score: a.score, note: '', was: { score: a.score, note: a.note } };
      c.step = validScore(a.score) ? 'comment' : 'score';
      return { parts: askNow(c, `Sure, let's redo the **${names[i]}** comment.`), chat: c };
    }
  }
  // "go to quality", or the KPI's name alone.
  const go = GOTO.exec(said);
  const target = go ? go[2] : words(said) <= 4 && !/\d/.test(said) ? said : '';
  if (target) {
    const i = kpiNamedExactly(target, names);
    if (i >= 0) {
      c.mode = 'review';
      c.walk = false;
      const was = complete(c, i);
      focus(c, i, was);
      return { parts: askNow(c, was ? `Sure, **${names[i]}** again.` : `Okay, **${names[i]}**.`), chat: c };
    }
    if (go && STRONG_GOTO.test(go[1]) && words(said) <= 6) return { parts: [{ text: `I can't find a KPI called "${clip(go[2], 40)}". ${first(c.name)}'s KPIs are ${listOf(names.map((n) => `**${n}**`))}.` }], chat: c };
  }
  return null;
}

/** Help with a comment: HR's guidance, and a nudge. The words stay the manager's: Suwi never writes them. */
function help(c: Chat): Reply {
  const k = c.kpis[c.index];
  const fn = first(c.name);
  return {
    parts: [
      { text: k.guidance ? `For **${k.name}**, HR's guidance is: "${k.guidance}".` : `HR didn't add guidance for **${k.name}**.` },
      { text: `Think of one thing ${fn} did this cycle on it and what came of it; that is usually enough for ${MIN} characters. A sent review needs at least ${MIN} characters per comment, so every score is explained. The words need to be yours, so I won't write them for you.` },
      ...askNow(c),
    ],
    chat: c,
  };
}

async function reviewStep(user: Who, c: Chat, said: string): Promise<Reply> {
  const names = c.kpis.map((k) => k.name);
  // Commands are short: "Back in October she ..." or "Ready to lead ..." is a comment.
  const short = words(said) <= 6;
  if (short && CANCEL.test(said)) return { parts: [{ text: `Okay, I've stopped ${c.name}'s review. Nothing was saved.` }], chat: null };
  // "last month" / "this month": the same person, the other cycle.
  if (words(said) <= 8 && (LAST_CYCLE.test(said) || THIS_CYCLE.test(said)) && !kpisNamed(said, names).length) {
    const current = await currentPeriodFor(user.org!);
    const want = LAST_CYCLE.test(said) ? previousPeriod(current) : current;
    if (want === c.period) return { parts: askNow(c, `We're already on the ${cycleName(c.period)} cycle.`), chat: c };
    const r = await startFor(user, { userId: c.employeeUserId, name: c.name }, want);
    return { ...r, parts: [{ text: `Switching to ${cycleName(want)}.` }, ...r.parts] };
  }
  if (short && LEFT.test(said)) {
    const left = c.kpis.filter((_k, i) => !complete(c, i)).length;
    return { parts: [{ text: left ? `Here's where we are: ${left} of ${c.kpis.length} still to finish.` : 'Everything is filled in.', phrase: true }, { text: statusLines(c) }, ...(left ? askNow(c) : [{ text: 'Say **done** to see it all and save it.' }])], chat: c };
  }
  if (short && (SAVE_DRAFT.test(said) || DONE.test(said))) {
    const gaps = c.kpis.filter((_k, i) => !complete(c, i));
    if (!gaps.length) return finish(user, c, false);
    if (SAVE_DRAFT.test(said) && c.existing !== 'sent') return finish(user, c, true, 'Okay, saving what you have.');
    return {
      parts: [
        { text: `Almost: ${listOf(gaps.map((k) => `**${k.name}**`))} still ${gaps.length === 1 ? 'needs' : 'need'} a score and a full comment.` },
        { text: statusLines(c) },
        ...(c.existing === 'sent' ? [] : [{ text: 'Say **save draft** to keep what you have as a draft and finish it later on the review page, or carry on here.' }]),
        ...askNow(c),
      ],
      chat: c,
    };
  }
  if (short && GO_THROUGH.test(said)) {
    c.walk = true;
    focus(c, 0, true);
    return { parts: askNow(c, "Sure, let's go through them in order. Say **keep** to leave one as it is."), chat: c };
  }
  if (words(said) <= 12 && HELP.test(said)) return help(c);
  const cmd = await named(user, c, said);
  if (cmd) return cmd;
  if (short && BACK.test(said)) {
    const a = c.answers[c.index];
    if (c.step === 'comment') {
      c.answers[c.index] = { ...(a.note ? { note: a.note } : {}), was: { score: a.score, note: a.note } };
      c.step = 'score';
      return { parts: askNow(c, `Okay, the **${names[c.index]}** score again.`), chat: c };
    }
    if (c.index === 0) return { parts: askNow(c, 'This is the first KPI already.'), chat: c };
    focus(c, c.index - 1, true);
    return { parts: askNow(c, `Sure, back to **${names[c.index]}**.`), chat: c };
  }
  if (short && SKIP.test(said)) {
    if (c.walk) {
      const a = c.answers[c.index];
      if (a.was) c.answers[c.index] = { score: a.score ?? a.was.score, note: a.note || a.was.note };
      return advance(user, c, `Okay, **${names[c.index]}** stays as it was.`);
    }
    const next = gapAfter(c, c.index);
    if (next < 0 || next === c.index) return { parts: askNow(c, `**${names[c.index]}** is the only one left, so it needs doing before the review can be saved${c.existing === 'sent' ? '' : ' (or say **save draft** to keep it unfinished)'}.`), chat: c };
    const skipped = names[c.index];
    focus(c, next, false);
    return { parts: askNow(c, `Okay, we'll come back to **${skipped}**.`), chat: c };
  }
  const k = c.kpis[c.index];
  const a = c.answers[c.index];
  if (short && KEEP.test(said)) {
    if (c.step === 'score') {
      const kept = keepScore(c);
      if (!kept) return { parts: askNow(c, `There's no earlier score on **${k.name}** to keep.`), chat: c };
      a.score = kept;
      // A KPI reopened and kept: its comment comes back with its score.
      if (!(a.note ?? '').trim() && a.was?.note) a.note = a.was.note;
      if ((a.note ?? '').trim()) delete a.was;
      return afterAnswer(user, c, `Kept ${kept} on **${k.name}**.`);
    }
    const kept = keepNote(c);
    if (!kept) return { parts: askNow(c, `There's no earlier comment on **${k.name}** to keep.`), chat: c };
    a.note = kept;
    delete a.was;
    return afterAnswer(user, c, `Kept the **${k.name}** comment.`);
  }
  if (short && CLEAR.test(said)) {
    a.note = '';
    return { parts: [{ text: `Cleared. Write the **${k.name}** comment again (at least ${MIN} characters).`, phrase: true, keep: [k.name] }], chat: c };
  }

  // Free text: several KPIs, prose, an answer, or a question about something else.
  const many = looksLikeMany(said, names, c.index, c.step);
  const other = kpisNamed(said, names).some((i) => i !== c.index);
  const lead = scoreOf(said);
  const prose = c.step === 'score' && lead.score === undefined && !lead.bad && words(said) >= 5;
  let tried = false;
  if ((many || other || prose) && reviewChatModel.configured() && await withinBudget(user.org!)) {
    const parsed = await modelParse(said, c.kpis.map((x) => ({ id: x.parameterId, name: x.name })), { id: k.parameterId, name: k.name, step: c.step });
    tried = true;
    const use = parsed?.use ?? null;
    if (parsed?.aside) return { parts: [], chat: c, aside: true, use, tried };
    if (parsed && parsed.pieces.length) {
      const single = parsed.pieces.length === 1 && (parsed.pieces[0].kpi === 'current' || parsed.pieces[0].kpi === c.index);
      if (!single) return { ...(await applyPieces(user, c, parsed.pieces, use)), tried };
      const p = parsed.pieces[0];
      if (p.bad) return { parts: askNow(c, p.bad), chat: c, use, tried };
      if (p.score !== undefined) a.score = p.score;
      if (p.comment) { a.note = c.step === 'comment' && a.note?.trim() ? `${a.note.trim()} ${p.comment}` : p.comment; delete a.was; }
      return { ...(await afterAnswer(user, c, p.score !== undefined ? `Got it, ${p.score} on **${k.name}**.` : '')), use, tried };
    }
  }
  const plain = await plainAnswer(user, c, said, many, lead);
  return { ...plain, tried: tried || plain.tried };
}

/** The deterministic reading of a message: several KPIs, a question, or the answer to what was asked. */
async function plainAnswer(user: Who, c: Chat, said: string, many: boolean, lead: ReturnType<typeof scoreOf>): Promise<Reply> {
  const names = c.kpis.map((x) => x.name);
  const k = c.kpis[c.index];
  const a = c.answers[c.index];
  if (many) return applyPieces(user, c, parseMany(said, names), null);
  // While a comment is asked for, only a real question ("...?") is one: "Do more code reviews" is a comment.
  if (lead.score === undefined && (c.step === 'score' ? questionLike(said) : /\?\s*$/.test(said) && said.length < 160)) return { parts: [], chat: c, aside: true };
  // The KPI being asked about, named first ("Quality 2: two deliveries came back ..."): its name is not the comment.
  const own = parseMany(said, names);
  if (own.length === 1 && own[0].kpi === c.index && own[0].named) {
    const p = own[0];
    if (p.bad) return { parts: askNow(c, p.bad), chat: c };
    if (p.score !== undefined) a.score = p.score;
    if (p.comment) { a.note = c.step === 'comment' && a.note?.trim() ? `${a.note.trim()} ${p.comment}` : p.comment; delete a.was; }
    if (p.score !== undefined || p.comment) return afterAnswer(user, c, p.score !== undefined ? `Got it, ${p.score} on **${k.name}**.` : '');
  }
  if (c.step === 'score') {
    if (lead.bad) return { parts: askNow(c, lead.bad), chat: c };
    let s = lead;
    if (s.score === undefined && words(said) >= 4) {
      const inside = scoreInside(said);
      if (inside.bad) return { parts: askNow(c, inside.bad), chat: c };
      if (inside.score !== undefined) s = { ...inside, rest: inside.rest.length >= 20 ? inside.rest : '' };
    }
    if (s.score === undefined) {
      // A comment before its score: kept, and the score asked for.
      if (words(said) >= 8) { a.note = a.note?.trim() ? `${a.note.trim()} ${said}` : said; delete a.was; return { parts: askNow(c, 'Thanks, I have the comment.'), chat: c }; }
      return { parts: [{ text: `I need a score for **${k.name}** first: a whole number from 1 to 5. (Say **cancel** to stop the review.)`, phrase: true, keep: [k.name] }], chat: c };
    }
    a.score = s.score;
    if (s.rest) { a.note = a.note?.trim() ? `${a.note.trim()} ${s.rest}` : s.rest; delete a.was; }
    return afterAnswer(user, c, pick(c, [`Got it, ${s.score} on **${k.name}**.`, `${s.score} for **${k.name}**, noted.`, `Okay, **${k.name}**: ${s.score}.`]));
  }
  // The comment step. A lone score here is a change of mind about the score, not a comment.
  if (!(a.note ?? '').trim() && lead.score !== undefined && !lead.rest) {
    a.score = lead.score;
    return { parts: askNow(c, `Changed **${k.name}** to ${lead.score}.`), chat: c };
  }
  a.note = a.note?.trim() ? `${a.note.trim()} ${said}` : said;
  delete a.was;
  return afterAnswer(user, c, '');
}

/** After a score or comment for the KPI in focus: the comment asked for, more of it asked for, or the next KPI. */
async function afterAnswer(user: Who, c: Chat, ack: string): Promise<Reply> {
  const k = c.kpis[c.index];
  if (complete(c, c.index)) return advance(user, c, ack || pick(c, [`Thanks, that covers **${k.name}**.`, `Great, **${k.name}** is done.`, `Noted for **${k.name}**.`]));
  c.step = validScore(c.answers[c.index].score) ? 'comment' : 'score';
  return { parts: askNow(c, ack), chat: c };
}

/** After the review is shown in full: changes reopen it; anything else ends it and goes to the rest of Suwi. */
async function doneStep(user: Who, c: Chat, said: string): Promise<Reply> {
  const names = c.kpis.map((k) => k.name);
  if (CANCEL.test(said)) return { parts: [{ text: c.proposalId ? "Okay, I've closed it here. Nothing is saved unless you press **Confirm** on the card." : `Okay, ${first(c.name)}'s review stays as it is.` }], chat: null };
  const cmd = await named(user, c, said);
  if (cmd) return cmd;
  if (GO_THROUGH.test(said) || BACK.test(said) || (!c.proposalId && (DONE.test(said) || SAVE_DRAFT.test(said) || LEFT.test(said))) || looksLikeMany(said, names, -1, 'score')) {
    c.mode = 'review';
    if (BACK.test(said)) { focus(c, c.kpis.length - 1, true); return { parts: askNow(c, `Sure, back to **${names[c.index]}**.`), chat: c }; }
    return reviewStep(user, c, said);
  }
  // Shown but no card yet (a sent review or a full draft just opened): a question waits, anything else is asked again.
  if (!c.proposalId) {
    if (questionLike(said)) return { parts: [], chat: c, aside: true };
    return { parts: [{ text: `Tell me what to change, for example **make ${names[0].toLowerCase()} 3** or **change the ${names[0].toLowerCase()} comment**, or say **go through** to take each KPI again, or **cancel**.` }], chat: c };
  }
  return { parts: [], chat: null, pass: true };
}

async function withinBudget(org: string): Promise<boolean> {
  const [settings, spent] = await Promise.all([settingsFor(org), spentThisMonthUsd(org)]);
  return spent < settings.monthlyBudgetUsd;
}

/** The line added under the rest of Suwi's answer while a review waits. */
function stillOpen(c: Chat): string {
  if (c.mode === 'done' || !c.kpis[c.index]) return `${first(c.name)}'s review is still open here. Tell me what to change, or say **cancel**.`;
  return `${first(c.name)}'s review is still open; we were on **${c.kpis[c.index].name}** (the ${c.step}). Reply to carry on, or say **cancel** to drop it.`;
}

export type ReviewChatResult = { answer: SuwiAnswer } | { aside: string } | null;

/**
 * Suwi's first look at a question: a review conversation under way, or one starting. `aside`: not about the review,
 * which waits; the rest of Suwi answers and adds that line. Null: not a review conversation at all.
 */
export async function reviewChat(user: Who, question: string): Promise<ReviewChatResult> {
  if (!user.org) return null;
  const said = question.trim();
  if (!said) return null;
  const started = Date.now();
  let chat = await chats().findOne({ _id: user.userId });
  const idle = chat ? Date.now() - chat.updatedAt.getTime() : 0;
  if (chat && (idle > FORGET_MS || ((chat.mode ?? 'review') !== 'review' && idle > IDLE_MS))) { await chats().deleteOne({ _id: user.userId }); chat = null; }
  if (chat) { chat.mode ??= 'review'; chat.turns = (chat.turns ?? 0) + 1; }
  const back = Boolean(chat && chat.mode === 'review' && idle > IDLE_MS);

  let reply: Reply | null = null;
  // Mid-review, only a short request that starts like one ("now review Rohan") starts another: a comment that
  // happens to name a colleague and the word "review" is a comment.
  const restart = Boolean(chat) && words(said) <= 12 && RESTART.test(said);
  if (!chat || restart) {
    const fresh = await begin(user, said);
    if (fresh && chat && chat.mode !== 'who') {
      const same = fresh.chat?.mode !== 'who' && fresh.chat?.employeeUserId === chat.employeeUserId && fresh.chat?.period === chat.period;
      // "rate it 4", "do more code reviews ...": a weak start mid-review is an answer, read below.
      if (fresh.weak) reply = null;
      else if (same) reply = await resume(user, chat, `We're already on ${first(chat.name)}'s review.`);
      else if (!fresh.chat) reply = { ...fresh, chat };
      else {
        const unsaved = chat.mode === 'review' && chat.answers.some((a, i) => (a.score !== undefined && a.score !== chat!.kpis[i].nowScore) || ((a.note ?? '') !== (chat!.kpis[i].nowNote ?? '') && (a.note ?? '')));
        reply = unsaved ? { ...fresh, parts: [{ text: `(I've dropped ${chat.name}'s unsaved answers to start this one.)` }, ...fresh.parts] } : fresh;
      }
    } else if (fresh) reply = fresh;
  }
  if (!reply && chat) reply = chat.mode === 'who' ? await pickWho(user, chat, said) : chat.mode === 'done' ? await doneStep(user, chat, said) : await reviewStep(user, chat, said);
  if (!reply) return null;
  if (reply.pass) { if (!reply.chat) await chats().deleteOne({ _id: user.userId }); return null; }
  if (reply.aside && reply.chat) {
    await chats().replaceOne({ _id: user.userId }, { ...reply.chat, updatedAt: new Date() }, { upsert: true });
    // The rest of Suwi records the question itself; only what reading it here cost is kept.
    if (reply.use?.costUsd) await auditCol().insertOne({ org: user.org, userId: user.userId, kind: 'question', at: new Date(), page: 'review-chat', question, answer: '', status: 'aside', tools: [], model: reply.use.model, costUsd: reply.use.costUsd } as never).catch(() => undefined);
    return { aside: stillOpen(reply.chat) };
  }

  // One model call a message at most: a reply to a message the model already split is not reworded too.
  let use = reply.use ?? null;
  const parts = [...reply.parts];
  const at = parts.findIndex((p) => p.phrase);
  if (!use && !reply.tried && at >= 0 && reviewChatModel.configured() && await withinBudget(user.org)) {
    const r = await phrase(parts[at].text, said, parts[at].keep ?? []);
    parts[at] = { text: r.text };
    use = r.use;
  }
  if (back && reply.chat) parts.unshift({ text: `Welcome back! We were in the middle of ${reply.chat.name}'s ${cycleName(reply.chat.period)} review.` });
  const text = parts.map((p) => p.text.trim()).filter(Boolean).join('\n\n');

  if (reply.chat) await chats().replaceOne({ _id: user.userId }, { ...reply.chat, updatedAt: new Date() }, { upsert: true });
  else await chats().deleteOne({ _id: user.userId });
  const cost = use?.costUsd ?? 0;
  await auditCol().insertOne({
    org: user.org, userId: user.userId, kind: 'question', at: new Date(), page: 'review-chat', question, answer: text.slice(0, 50_000),
    status: 'answered', tools: [], model: use?.model ?? 'none', costUsd: cost, timing: { path: 'instant', totalMs: Date.now() - started },
  } as never).catch(() => undefined);
  return { answer: { text, checked: [], links: reply.links ?? [], proposals: reply.proposals ?? [], costUsd: cost, path: 'instant' } };
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
