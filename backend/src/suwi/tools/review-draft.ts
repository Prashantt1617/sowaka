// Drafting a review for a manager to edit (24 Nov, HR: "Draft Rohan's review"). review_draft writes, per
// KPI parameter the person is reviewed on this cycle, a suggested 1–5 score and a comment of at least 75
// characters (what a sent review needs), from the facts Sowaka holds and nothing else: this cycle's
// attendance, the parameter's scores and notes in earlier reviews, and recognitions (Connect shout-outs,
// manager nominations). The words come from the quick model in the style of "Refine with Suwi"
// (review-refine.service.ts); without a model, or when its reply is unusable, they are built from the
// facts directly. It SAVES NOTHING. prepare_save_review_draft keeps a draft on the review page as a
// DRAFT (status 'saved', never 'sent', so the employee sees nothing) through the same upsertFeedback the
// review page's PUT /manager/feedback/:userId calls, and only for the asker's own direct reports.
import { connectPosts, feedbackRecords, recognitionNominations } from '../../config/db';
import { listAllFeedbackForAdmin } from '../../services/admin.service';
import { attendanceReport } from '../../services/attendance-report.service';
import { cycleStartDayFor, cycleWindow, previousPeriod } from '../../services/cycle';
import { cycleName } from '../../services/feedback-notifications.service';
import { assignedParametersFor } from '../../services/kpi.service';
import { FEEDBACK_NOTE_MIN, reviewablePeriod, upsertFeedback } from '../../services/manager.service';
import { SUWI_SMALL_MODEL } from '../digest';
import { callModel, llmConfigured } from '../llm';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose, SuwiActionError } from '../proposals';
import { countReport } from './attendance';
import { findPerson, norm, Person } from './people';

/** Tests swap this for a stub so no draft costs money. */
export const reviewDraftModel: { call: typeof callModel; configured: () => boolean } = { call: callModel, configured: llmConfigured };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clampScore = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
const ATTENDANCE_LIKE = /attend|punctual|discipline|reliab|time ?keep|regular|availab/;

interface Line { parameterId: string; parameter: string; guidance: string; weight: number; score: number; comment: string; basis: string[] }
interface Facts {
  attendance: { present: number; halfDay: number; late: number; absent: number; missed: number; leave: number; from: string; to: string } | null;
  recognitions: string[];
  earlier: { period: string; manager: string | null; overall: number; byParameter: Map<string, { score: number; note: string }> }[];
}

/** The cycle (this one, or the one before it while it is open), its days so far, and what the person is reviewed on. */
async function material(ctx: SuwiContext, person: Person, periodIn: unknown) {
  const period = await reviewablePeriod(ctx.org, typeof periodIn === 'string' ? periodIn : undefined);
  const w = cycleWindow(period, await cycleStartDayFor(ctx.org));
  const from = w.start.toISOString().slice(0, 10);
  const lastDay = addDays(w.end.toISOString().slice(0, 10), -1);
  const to = lastDay < ctx.today ? lastDay : ctx.today;
  const assigned = await assignedParametersFor(ctx.org, person.userId, period);

  const records = (await listAllFeedbackForAdmin(ctx.userId)).filter((r) => r.employeeUserId === person.userId);
  const earlierPeriods = [previousPeriod(period)];
  while (earlierPeriods.length < 3) earlierPeriods.push(previousPeriod(earlierPeriods.at(-1)!));
  const earlier = records.filter((r) => r.status === 'sent' && earlierPeriods.includes(r.period)).sort((a, b) => b.period.localeCompare(a.period)).map((r) => ({
    period: r.period, manager: r.managerName ?? null, overall: Math.round(r.overallScore * 10) / 10,
    byParameter: new Map(r.parameters.flatMap((p) => {
      const v = { score: p.score, note: (p.note ?? '').trim() };
      return [[`id:${p.parameterId ?? ''}`, v], [`name:${norm(p.name)}`, v]] as [string, typeof v][];
    })),
  }));

  let attendance: Facts['attendance'] = null;
  try {
    const r = await attendanceReport(ctx.userId, { from, to });
    const c = countReport(r.days, 0, ctx.today).get(person.userId);
    if (c) attendance = { present: c.present, halfDay: c.halfDay, late: c.late, absent: c.absent, missed: c.missed, leave: c.leave + c.unpaidLeave, from, to };
  } catch { /* no attendance set-up: the draft says nothing about attendance */ }

  const [kudos, nominations] = await Promise.all([
    connectPosts().find({ org: ctx.org, type: 'kudos', 'body.personUserId': person.userId, publishedAt: { $gte: w.start, $lt: w.end } } as never, { projection: { _id: 0, 'author.name': 1, 'body.text': 1, publishedAt: 1 } }).limit(5).toArray(),
    recognitionNominations().find({ employeeUserId: person.userId, period }).limit(5).toArray(),
  ]);
  const recognitions = [
    ...kudos.map((k) => `Shout-out on Connect from ${k.author?.name ?? 'a colleague'}: "${clip(String(k.body?.text ?? '').trim(), 160)}"`),
    ...nominations.map((n) => `Nominated by their manager for the ${n.category} recognition${n.reason ? `: "${clip(n.reason.trim(), 160)}"` : ''}`),
  ];
  const draftNow = records.find((r) => r.period === period && r.managerUserId === ctx.userId);
  return { period, from, to, lastDay, assigned, facts: { attendance, recognitions, earlier } as Facts, existing: draftNow ? { status: draftNow.status, sentAt: draftNow.sentAt ?? null } : null };
}

/** The draft from the facts alone: a score from the earlier reviews, words that only restate what is on record. */
function factDraft(person: Person, assigned: { id: string; title: string; description: string; weight: number }[], f: Facts): Line[] {
  const first = person.name.split(' ')[0];
  const a = f.attendance;
  return assigned.map((p) => {
    const prior = f.earlier.map((r) => ({ r, v: r.byParameter.get(`id:${p.id}`) ?? r.byParameter.get(`name:${norm(p.title)}`) })).filter((x) => x.v);
    const basis: string[] = [];
    let score = prior.length ? prior[0].v!.score : f.earlier.length ? f.earlier[0].overall : 3;
    const parts: string[] = [];
    if (prior.length) {
      const { r, v } = prior[0];
      parts.push(`${r.manager ?? 'Their manager'} scored ${first} ${v!.score} of 5 on this in ${cycleName(r.period)}${v!.note ? `, noting "${clip(v!.note, 140)}"` : ''}.`);
      basis.push(`${cycleName(r.period)} review: ${v!.score}/5`);
      if (prior[1]) {
        const d = v!.score - prior[1].v!.score;
        if (d) parts.push(`That was ${d > 0 ? 'up' : 'down'} from ${prior[1].v!.score} in ${cycleName(prior[1].r.period)}.`);
      }
    } else if (f.earlier.length) {
      parts.push(`There is no earlier score on ${p.title}; ${first}'s last overall review score was ${f.earlier[0].overall} of 5 (${cycleName(f.earlier[0].period)}).`);
      basis.push(`${cycleName(f.earlier[0].period)} overall: ${f.earlier[0].overall}/5`);
    } else {
      parts.push(`This is ${first}'s first review on ${p.title}, so there is no earlier score to build on.`);
      basis.push('No earlier review');
    }
    if (a && ATTENDANCE_LIKE.test(norm(p.title))) {
      if (a.absent >= 3 || a.late >= 5) score -= 1;
      else if (!a.absent && !a.late && !a.missed && a.present >= 10) score += 1;
      parts.push(`This cycle so far (${a.from} to ${a.to}): ${a.present} days present, ${a.late} late mark${a.late === 1 ? '' : 's'}, ${a.absent} absence${a.absent === 1 ? '' : 's'}${a.missed ? `, ${a.missed} missed punch${a.missed === 1 ? '' : 'es'}` : ''}.`);
      basis.push(`Attendance: ${a.present} present, ${a.late} late, ${a.absent} absent`);
    }
    if (f.recognitions.length) { parts.push(`Recognised this cycle: ${clip(f.recognitions[0], 160)}.`); basis.push(`${f.recognitions.length} recognition${f.recognitions.length === 1 ? '' : 's'} this cycle`); }
    let comment = parts.join(' ');
    if (comment.length < FEEDBACK_NOTE_MIN + 5) comment += ` [Add an example from this cycle${p.description ? ` against: ${clip(p.description, 120)}` : ''}.]`;
    if (comment.length < FEEDBACK_NOTE_MIN) comment += ' Sowaka has no record of this cycle\'s work on it.';
    return { parameterId: p.id, parameter: p.title, guidance: p.description, weight: p.weight, score: clampScore(score), comment, basis };
  });
}

const SYSTEM = `You draft a manager's performance review of one person, one comment per KPI parameter, for the manager to edit before sending.
Rules:
- Use ONLY the facts given (earlier review scores and notes, this cycle's attendance, recognitions, the parameter's guidance). Never invent work, projects, results, numbers, praise or criticism.
- Where the facts say nothing about this cycle's work on a parameter, say so plainly and leave "[add an example from this cycle]" for the manager.
- Each comment: 2 to 3 sentences, plain professional English, at least 90 characters, matching the score (a low score never sounds positive, a high one never negative).
- Keep each suggested score unless the facts clearly support moving it by 1; scores are whole numbers 1 to 5.
- A short closing note (1 to 2 sentences) from the same facts.
Return only JSON: {"parameters":[{"id":"<id>","score":<1-5>,"comment":"<text>"}],"closingNote":"<text>"}`;

/** The quick model's words over the fact draft; any line it gets wrong keeps the fact draft's. */
async function modelDraft(person: Person, lines: Line[], f: Facts): Promise<{ lines: Line[]; closingNote: string | null; by: 'model' | 'facts' }> {
  if (!reviewDraftModel.configured()) return { lines, closingNote: null, by: 'facts' };
  const facts = {
    person: person.name, designation: person.designation ?? null,
    attendanceThisCycle: f.attendance, recognitionsThisCycle: f.recognitions,
    earlierReviews: f.earlier.map((r) => ({ cycle: cycleName(r.period), overall: r.overall })),
    parameters: lines.map((l) => ({ id: l.parameterId, parameter: l.parameter, guidance: l.guidance, suggestedScore: l.score, factsOnIt: l.comment })),
  };
  try {
    const reply = await reviewDraftModel.call({ model: SUWI_SMALL_MODEL, system: SYSTEM, maxTokens: 1500, thinking: 'minimal', messages: [{ role: 'user', content: JSON.stringify(facts) }] });
    const text = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { parameters?: { id?: string; score?: number; comment?: string }[]; closingNote?: string };
    const byId = new Map((json.parameters ?? []).map((x) => [String(x.id), x]));
    let used = 0;
    const out = lines.map((l) => {
      const m = byId.get(l.parameterId);
      const comment = typeof m?.comment === 'string' ? m.comment.trim().slice(0, 1200) : '';
      if (!m || comment.length < FEEDBACK_NOTE_MIN) return l;
      used += 1;
      const s = Number(m.score);
      return { ...l, comment, score: Number.isFinite(s) && Math.abs(clampScore(s) - l.score) <= 1 ? clampScore(s) : l.score };
    });
    return { lines: out, closingNote: typeof json.closingNote === 'string' && json.closingNote.trim() ? json.closingNote.trim().slice(0, 600) : null, by: used ? 'model' : 'facts' };
  } catch {
    return { lines, closingNote: null, by: 'facts' };
  }
}

const weightedOverall = (lines: { score: number; weight: number }[]) => {
  const w = lines.reduce((s, l) => s + l.weight, 0);
  return Math.round((w ? lines.reduce((s, l) => s + l.score * l.weight, 0) / w : lines.reduce((s, l) => s + l.score, 0) / lines.length) * 10) / 10;
};

const PERSON = { type: 'string', description: 'The person reviewed: name, employee ID or userId' };

defineTools(
  {
    name: 'review_draft',
    area: 'performance',
    label: (i) => `Draft review for ${str(i.person) || 'one person'}`,
    description: "Draft one person's performance review for their manager to edit: for each KPI parameter they are reviewed on this cycle, a suggested 1–5 score and a comment of at least 75 characters, written only from the facts Sowaka holds (this cycle's attendance, the parameter's scores and notes in earlier reviews, Connect shout-outs and manager nominations). SAVES NOTHING: show the draft to the manager. To keep it as a draft on the review page, use prepare_save_review_draft (the asker's own direct reports only). For the raw material without a draft, use review_material; for trends across people, kpi_trend.",
    input_schema: { type: 'object', properties: { person: PERSON, period: { type: 'string', description: 'Cycle YYYY-MM: this one (default) or the one before it' } }, required: ['person'] },
    api: { method: 'GET', path: '/admin/feedback' },
    async run(ctx, i) {
      const person = await findPerson(ctx, i.person ?? i.userId);
      const m = await material(ctx, person, i.period);
      if (!m.assigned.length) return { data: { drafted: false, person: person.name, cycle: cycleName(m.period), message: `No KPI parameters are assigned to ${person.name} for the ${cycleName(m.period)} cycle, so no review can be given yet. HR assigns them under KPI › Bulk assign or with prepare_assign_kpi_template.` } };
      const d = await modelDraft(person, factDraft(person, m.assigned, m.facts), m.facts);
      return {
        data: {
          drafted: true, saved: false, person: { userId: person.userId, name: person.name, designation: person.designation ?? null },
          cycle: { period: m.period, name: cycleName(m.period), from: m.from, lastDay: m.lastDay },
          draft: d.lines.map((l) => ({ parameter: l.parameter, weight: l.weight, suggestedScore: l.score, comment: l.comment, basedOn: l.basis })),
          overallIfKept: weightedOverall(d.lines), closingNote: d.closingNote,
          facts: { attendance: m.facts.attendance, recognitions: m.facts.recognitions, earlierReviews: m.facts.earlier.map((r) => ({ cycle: cycleName(r.period), overall: r.overall, by: r.manager })) },
          writtenBy: d.by === 'model' ? 'Suwi, from the facts listed' : 'Built directly from the facts listed',
          existingReview: m.existing,
          canSaveAsDraft: person.managerUserId === ctx.userId,
          note: `Nothing is saved. Show the draft as it is (scores and comments) for the manager to edit; scores are suggestions. ${person.managerUserId === ctx.userId ? 'You are their manager: prepare_save_review_draft keeps it as a draft (not sent).' : 'Only their own manager can save it (on the review page or by asking Suwi).'}`,
        },
        links: [{ label: 'Open feedback', view: 'feedback' }],
      };
    },
  },
  {
    name: 'prepare_save_review_draft',
    area: 'performance',
    acts: true,
    label: (i) => `Prepared: save ${str(i.person) || 'a'} review as a draft`,
    description: "Prepare saving a review as a DRAFT (never sent: the employee sees nothing until the manager sends it on the review page), only for the asker's own direct reports and only while no review has been sent this cycle. Give parameters (each: parameter title, score 1–5, comment) as the manager edited them from review_draft; any parameter left out takes review_draft's suggestion. Changes nothing until confirmed; Undo puts back an earlier draft when there was one. Not for sending reviews or for someone else's reports.",
    input_schema: {
      type: 'object',
      properties: {
        person: PERSON, period: { type: 'string', description: 'Cycle YYYY-MM: this one (default) or the one before it' },
        parameters: { type: 'array', items: { type: 'object', properties: { parameter: { type: 'string' }, score: { type: 'number' }, comment: { type: 'string' } }, required: ['parameter'] } },
        closingNote: { type: 'string', description: 'The review\'s closing note (max 2000 characters)' },
      },
      required: ['person'],
    },
    api: { method: 'PUT', path: '/manager/feedback/x' },
    async run(ctx, i) {
      const person = await findPerson(ctx, i.person ?? i.userId);
      if (person.managerUserId !== ctx.userId) throw new Error(`Only ${person.name}'s own manager can save their review; you can draft it with review_draft and share it.`);
      const m = await material(ctx, person, i.period);
      if (!m.assigned.length) throw new Error(`No KPI parameters are assigned to ${person.name} for the ${cycleName(m.period)} cycle. Ask HR to assign them first.`);
      if (m.existing?.status === 'sent') throw new Error(`${person.name}'s ${cycleName(m.period)} review is already sent; edit it on the review page (Suwi only saves drafts).`);
      const given = Array.isArray(i.parameters) ? (i.parameters as Record<string, unknown>[]) : [];
      const byName = new Map(given.map((g) => [norm(g.parameter), g]));
      const unknown = given.filter((g) => !m.assigned.some((p) => norm(p.title) === norm(g.parameter))).map((g) => str(g.parameter, 80));
      if (unknown.length) throw new Error(`${person.name} is not reviewed on ${unknown.join(', ')} this cycle. Their parameters: ${m.assigned.map((p) => p.title).join(', ')}.`);
      const base = factDraft(person, m.assigned, m.facts);
      const needModel = base.some((l) => !byName.get(norm(l.parameter))?.comment);
      const d = needModel ? await modelDraft(person, base, m.facts) : { lines: base, closingNote: null };
      const lines = d.lines.map((l) => {
        const g = byName.get(norm(l.parameter));
        const s = num(g?.score, NaN);
        return { ...l, score: Number.isFinite(s) ? clampScore(s) : l.score, comment: str(g?.comment, 5000) || l.comment };
      });
      const closingNote = str(i.closingNote, 2000) || d.closingNote || '';
      const short = lines.filter((l) => l.comment.length < FEEDBACK_NOTE_MIN);
      const previous = m.existing ? await feedbackRecords().findOne({ managerUserId: ctx.userId, employeeUserId: person.userId, period: m.period }) : null;
      const title = `Save ${person.name}'s ${cycleName(m.period)} review as a draft`;
      const proposalId = await propose(ctx, {
        kind: 'save_review_draft', area: 'performance', title,
        summary: `Saves a draft review of ${person.name} for the ${cycleName(m.period)} cycle on your review page, overall ${weightedOverall(lines)} of 5. It is NOT sent: ${person.name.split(' ')[0]} sees nothing until you send it.`,
        lines: [
          ...lines.map((l) => ({ text: `${l.parameter} (${l.weight}%): ${l.score} of 5. "${l.comment}"` })),
          ...(closingNote ? [{ text: `Closing note: "${closingNote}"` }] : []),
          { text: 'Saved as a draft only (status saved, never sent), the same as pressing Save on the review page.', why: 'Sending is the manager\'s own step on the review page, after reading and editing the draft; that is when the employee is notified.' },
          ...(short.length ? [{ text: `${short.map((l) => l.parameter).join(', ')}: under ${FEEDBACK_NOTE_MIN} characters. A draft may be short, but each comment needs ${FEEDBACK_NOTE_MIN} before sending.`, tone: 'warn' as const }] : []),
          ...(previous ? [{ text: 'This replaces the draft already saved for this cycle; Undo puts that one back.', tone: 'warn' as const }] : [{ text: 'Undo is not offered: the review page has no way to remove a draft. You can edit or overwrite it there any time before sending.', tone: 'info' as const }]),
        ],
        effectiveFrom: ctx.today, undoable: Boolean(previous),
        payload: {
          byUserId: ctx.userId, employeeUserId: person.userId, name: person.name, period: m.period, extra: closingNote,
          parameters: lines.map((l) => ({ parameterId: l.parameterId, score: l.score, note: l.comment })),
        },
      });
      return { data: { prepared: true, title, overall: weightedOverall(lines), parameters: lines.map((l) => ({ parameter: l.parameter, score: l.score })), note: 'Nothing is saved until you press Confirm on the card; it is saved as a draft, not sent.' }, proposalId, links: [{ label: 'Open feedback', view: 'feedback' }] };
    },
  },
);

type Saved = { parameterId: string; score: number; note: string };

defineExecutor('save_review_draft', {
  async run(p) {
    const { byUserId, employeeUserId, name, period, extra, parameters } = p.payload as { byUserId: string; employeeUserId: string; name: string; period: string; extra: string; parameters: Saved[] };
    const before = await feedbackRecords().findOne({ managerUserId: byUserId, employeeUserId, period });
    // upsertFeedback keeps a sent review sent: a "draft" saved over it would rewrite what the employee reads.
    if (before?.status === 'sent') throw new SuwiActionError(409, `${name}'s review was sent in the meantime, so nothing was changed. Edit it on the review page.`);
    await upsertFeedback(byUserId, employeeUserId, { status: 'saved', parameters, extra, period });
    return {
      message: `Saved ${name}'s ${cycleName(period)} review as a draft (not sent).`,
      undo: { previous: before ? { parameters: before.parameters.map((x) => ({ parameterId: x.parameterId, score: x.score, note: x.note })), extra: before.extra ?? '' } : null },
    };
  },
  async undo(p) {
    const { byUserId, employeeUserId, name, period } = p.payload as { byUserId: string; employeeUserId: string; name: string; period: string };
    const prev = p.undo?.previous as { parameters: Saved[]; extra: string } | null | undefined;
    if (!prev) throw new SuwiActionError(409, 'There was no earlier draft to put back');
    const now = await feedbackRecords().findOne({ managerUserId: byUserId, employeeUserId, period });
    if (now?.status === 'sent') throw new SuwiActionError(409, `${name}'s review has been sent since, so the earlier draft was not put back.`);
    await upsertFeedback(byUserId, employeeUserId, { status: 'saved', parameters: prev.parameters, extra: prev.extra, period });
    return `Put back the earlier draft of ${name}'s ${cycleName(period)} review.`;
  },
});
