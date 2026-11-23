/**
 * Probation (module 6): each month the manager sets goals at the start, the
 * joiner and the manager check in at the end, the manager reviews and the
 * cycle closes (a leaf). The final month opens HR's decision: confirm,
 * extend (a new review cycle for extendMonths) or not confirm. The letter
 * comes from Documents; the reveal shows in the app once it is sent.
 */
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { journeyTasks, journeys, kpiParameters, kpiTemplates, letters, probationMonths, users } from '../../config/db';
import type { ConfirmationDecision, Journey, JourneyTask, ProbationMonth, SystemTaskKey } from '../../models/lifecycle.model';
import { companyTimeZone, humanDay, keyOfDay, probationMonthEnd, probationMonthStart, todayKey } from './dueRules';
import {
  ACTIVE_STATUSES, LifecycleError, OPEN_STATUSES, loadJourney, refreshJourney, reopenTask, syncProbationTasks, tasksOf, tell, totalProbationMonths,
} from './engine';

const strip = <T extends object>(doc: T & { _id?: unknown }): T => {
  const { _id, ...rest } = doc;
  return rest as T;
};

/** The month rows 1..total, created on first read. */
export async function ensureMonths(j: Journey): Promise<ProbationMonth[]> {
  const total = totalProbationMonths(j);
  const existing = (await probationMonths().find({ journeyId: j.id }).sort({ monthNo: 1 }).toArray()).map(strip);
  const missing: ProbationMonth[] = [];
  for (let n = 1; n <= total; n += 1) {
    if (!existing.some((m) => m.monthNo === n)) missing.push({ id: randomUUID(), org: j.org, journeyId: j.id, monthNo: n, goals: [] });
  }
  if (missing.length) {
    await probationMonths().bulkWrite(missing.map((m) => ({ updateOne: { filter: { journeyId: j.id, monthNo: m.monthNo }, update: { $setOnInsert: m }, upsert: true } })));
  }
  return (await probationMonths().find({ journeyId: j.id, monthNo: { $lte: total } }).sort({ monthNo: 1 }).toArray()).map(strip);
}

export type MonthView = ProbationMonth & { startsOn?: string; endsOn?: string; final: boolean };

function monthViews(j: Journey, months: ProbationMonth[]): MonthView[] {
  const total = totalProbationMonths(j);
  return months.map((m) => ({
    ...m,
    ...(j.tj ? { startsOn: probationMonthStart(j.tj, m.monthNo), endsOn: probationMonthEnd(j.tj, m.monthNo) } : {}),
    final: m.monthNo === total,
  }));
}

/** HR's view: every month and the decision. */
export async function probationOf(journeyId: string): Promise<{
  months: MonthView[]; decision?: ConfirmationDecision;
  recommendation?: NonNullable<Journey['probation']>['recommendation']; hodApproval?: NonNullable<Journey['probation']>['hodApproval'];
}> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding') throw new LifecycleError(400, 'Not an onboarding journey');
  const months = await ensureMonths(j);
  // The manager's recommendation and the head of department's answer from the app (teamTasks.ts), by HR's decision.
  return {
    months: monthViews(j, months), ...(j.probation?.decision ? { decision: j.probation.decision } : {}),
    ...(j.probation?.recommendation ? { recommendation: j.probation.recommendation } : {}),
    ...(j.probation?.hodApproval ? { hodApproval: j.probation.hodApproval } : {}),
  };
}

/** The joiner's view: goals are read-only; the decision only shows through the reveal. */
export async function probationForJoiner(journeyId: string) {
  const j = await loadJourney(journeyId);
  const months = await ensureMonths(j);
  return { months: monthViews(j, months).map(({ checkinManager: _m, ...rest }) => rest) };
}

function monthTask(tasks: JourneyTask[], key: SystemTaskKey, monthNo: number): JourneyTask | undefined {
  return tasks.find((t) => t.systemKey === key && t.month === monthNo && t.status !== 'cancelled');
}

async function finishMonthTask(task: JourneyTask | undefined, by: { userId?: string; name?: string }): Promise<void> {
  if (!task || !OPEN_STATUSES.includes(task.status)) return;
  await journeyTasks().updateOne({ id: task.id }, { $set: { status: 'done', doneAt: new Date(), ...(by.userId ? { doneByUserId: by.userId } : {}), ...(by.name ? { doneByName: by.name } : {}) } });
}

function cleanText(value: unknown, max: number, label: string, required = true): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new LifecycleError(400, `${label} is required`);
  if (text.length > max) throw new LifecycleError(400, `${label} cannot exceed ${max} characters`);
  return text;
}

/** The joiner rates the month 1–4 (Rough · Okay · Good · Great); the manager 1–5. */
function cleanRating(value: unknown, max = 5): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) throw new LifecycleError(400, `A rating is a whole number from 1 to ${max}`);
  return Number(value);
}

export function cleanGoals(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) throw new LifecycleError(400, 'goals must be a list');
  if (value.length > max) throw new LifecycleError(400, `At most ${max} goals`);
  return value.map((g, i) => cleanText(typeof g === 'object' && g ? (g as { text?: unknown }).text : g, 200, `Goal ${i + 1}`));
}

/** One 1–5 rating per goal, in goal order (a null keeps a goal unrated). */
function cleanGoalRatings(value: unknown, goals: number): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > Math.max(goals, 0)) throw new LifecycleError(400, `goalRatings is one 1–5 rating per goal (${goals})`);
  return value.map((v, i) => {
    if (v === null) return 0;
    if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 5) throw new LifecycleError(400, `Goal ${i + 1}: a rating is 1 to 5`);
    return Number(v);
  });
}

/** One-tap feedback on the review (PB2). */
export const REVIEW_FEEDBACK = ['Great start', 'Keep going', 'Let’s talk', 'Proud of you'] as const;

async function monthRow(j: Journey, monthNo: number): Promise<ProbationMonth> {
  if (!Number.isInteger(monthNo) || monthNo < 1 || monthNo > totalProbationMonths(j)) throw new LifecycleError(404, 'No such probation month');
  const months = await ensureMonths(j);
  return months.find((m) => m.monthNo === monthNo)!;
}

function requireOpen(task: JourneyTask | undefined, what: string): void {
  if (task && task.status === 'locked') {
    throw new LifecycleError(409, `${what} opens ${task.opensAt ? `on ${humanDay(keyOfDay(task.opensAt))}` : 'later'}`);
  }
}

/** The manager's month: goals (until the check-in closes them), their side of the check-in, the review. */
export async function updateMonthByManager(journeyId: string, manager: { userId: string; name: string }, monthNo: number, body: Record<string, unknown>) {
  const j = await loadJourney(journeyId);
  if (j.managerUserId !== manager.userId) throw new LifecycleError(403, 'Only their manager can do this');
  if (!j.userId) throw new LifecycleError(409, 'Probation starts once they join');
  const row = await monthRow(j, monthNo);
  const tasks = await tasksOf(journeyId);
  const set: Partial<ProbationMonth> = {};
  const now = new Date();
  if (body.goals !== undefined) {
    if (row.lockedAt) throw new LifecycleError(409, `Month ${monthNo} goals are locked`);
    // A goal kept as it was keeps the joiner's "How's it going?", their note and the comment (Final designs).
    set.goals = cleanGoals(body.goals).map((text) => row.goals.find((g) => g.text === text) ?? { text });
    set.goalsSetAt = now;
    if (set.goals.length) await finishMonthTask(monthTask(tasks, 'monthly_goals', monthNo), manager);
  }
  if (body.checkin !== undefined) {
    const checkinTask = monthTask(tasks, 'monthly_checkin', monthNo);
    requireOpen(checkinTask, `The month-${monthNo} check-in`);
    const c = (body.checkin ?? {}) as Record<string, unknown>;
    const rating = cleanRating(c.rating);
    const goalRatings = cleanGoalRatings(c.goalRatings, (set.goals ?? row.goals).length);
    // Rating each goal is a check-in on its own; the words are then optional. So is marking the
    // check-in meeting done from the team side (`met: true`): its notes, if any, are the words.
    set.checkinManager = { text: cleanText(c.text, 2000, 'The check-in', !goalRatings?.some(Boolean) && !rating && c.met !== true), ...(rating ? { rating } : {}), ...(goalRatings ? { goalRatings } : {}), at: now };
  }
  if (body.review !== undefined) {
    const reviewTask = monthTask(tasks, 'monthly_review', monthNo);
    if (reviewTask && reviewTask.status === 'locked') throw new LifecycleError(409, `Review month ${monthNo} after the check-in`);
    const r = (body.review ?? {}) as Record<string, unknown>;
    const feedback = Array.isArray(r.feedback) ? [...new Set(r.feedback.map(String))] : [];
    if (feedback.some((f) => !(REVIEW_FEEDBACK as readonly string[]).includes(f))) throw new LifecycleError(400, `feedback is any of: ${REVIEW_FEEDBACK.join(', ')}`);
    // "Mark as reviewed" (team side, MgrReview) may come without comments.
    set.review = {
      text: cleanText(r.text, 2000, 'The review', !feedback.length && r.reviewed !== true),
      ...(feedback.length ? { feedback } : {}), ...(r.askAck === true ? { askAck: true } : {}), at: now,
    };
    await finishMonthTask(reviewTask, manager);
    if (Array.isArray(r.nextGoals) && monthNo < totalProbationMonths(j)) {
      const next = await monthRow(j, monthNo + 1);
      if (!next.lockedAt) {
        await probationMonths().updateOne({ id: next.id }, { $set: { goals: cleanGoals(r.nextGoals).map((text) => ({ text })), goalsSetAt: now } });
        await finishMonthTask(monthTask(tasks, 'monthly_goals', monthNo + 1), manager);
      }
    }
    if (j.userId) await tell([j.userId], { scenario: 'lifecycle_monthly_review', destination: 'lifecycle_probation', title: `Month ${monthNo} review`, body: `${manager.name} reviewed your month ${monthNo}.`, data: { journeyId, month: String(monthNo) } });
  }
  if (body.sendBack !== undefined) {
    // "Send back" (team side, MgrReview): the joiner's self check-in goes back to them to send again.
    if (!row.checkinEmployee) throw new LifecycleError(409, `Nothing to send back: month ${monthNo} has no check-in yet`);
    if (row.review || set.review) throw new LifecycleError(409, `Month ${monthNo} is reviewed already`);
    const s = (body.sendBack ?? {}) as Record<string, unknown>;
    const text = cleanText(s.text, 2000, 'The comment', false);
    set.sentBack = { ...(text ? { text } : {}), at: now, byName: manager.name };
    if (j.userId) await tell([j.userId], { scenario: 'lifecycle_monthly_review', destination: 'lifecycle_probation', title: `Month ${monthNo} check-in`, body: `${manager.name} sent your month-${monthNo} check-in back${text ? `: ${text}` : '.'}`, data: { journeyId, month: String(monthNo) } });
  }
  await saveMonth(j, row, set, tasks, manager);
  return probationOf(journeyId);
}

/** The joiner's side of the month-end check-in. */
export async function checkinByJoiner(journeyId: string, joiner: { userId: string; name: string }, monthNo: number, body: Record<string, unknown>) {
  const j = await loadJourney(journeyId);
  if (j.userId !== joiner.userId) throw new LifecycleError(403, 'Not your journey');
  const row = await monthRow(j, monthNo);
  const tasks = await tasksOf(journeyId);
  requireOpen(monthTask(tasks, 'monthly_checkin', monthNo), `The month-${monthNo} check-in`);
  const rating = cleanRating(body.rating, 4);
  const goalRatings = cleanGoalRatings(body.goalRatings, row.goals.length);
  const win = cleanText(body.win, 1000, 'The win', false);
  const ask = cleanText(body.ask, 1000, 'What would help', false);
  // The words: as sent, else made from the win and the ask (older apps send only `text`).
  const said = typeof body.text === 'string' && body.text.trim() ? body.text : [win && `A win: ${win}`, ask && `Would help: ${ask}`].filter(Boolean).join('\n');
  const set: Partial<ProbationMonth> = { checkinEmployee: {
    text: cleanText(said, 2000, 'The check-in'), ...(rating ? { rating } : {}), ...(goalRatings ? { goalRatings } : {}),
    ...(win ? { win } : {}), ...(ask ? { ask } : {}), at: new Date(),
  } };
  await saveMonth(j, row, set, tasks, joiner);
  // No push to the manager: reading check-ins is no longer an app task of theirs (HR follows them on the dashboard).
  return probationForJoiner(journeyId);
}

async function saveMonth(j: Journey, row: ProbationMonth, set: Partial<ProbationMonth>, tasks: JourneyTask[], by: { userId: string; name: string }) {
  if (!Object.keys(set).length) return;
  const merged = { ...row, ...set };
  // Both sides in: the check-in is done and the month's goals close.
  if (merged.checkinEmployee && merged.checkinManager && !row.lockedAt) {
    set.lockedAt = new Date();
    await finishMonthTask(monthTask(tasks, 'monthly_checkin', row.monthNo), by);
  }
  await probationMonths().updateOne({ id: row.id }, { $set: set });
  await refreshJourney(j.id);
}

// ─── The decision ───────────────────────────────────────────────────────────

/**
 * HR's final-month decision (H1c). Extend restarts a review cycle for
 * extendMonths. A new salary is pay: only someone who may see pay sets it.
 */
export async function recordDecision(journeyId: string, hr: { userId: string; name: string; seesPay?: boolean }, body: Record<string, unknown>): Promise<ConfirmationDecision> {
  if (hr.seesPay === false && body.salary !== undefined && body.salary !== null && body.salary !== '') {
    throw new LifecycleError(403, 'Only someone with payroll access can set the salary');
  }
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || !j.userId) throw new LifecycleError(409, 'The decision is for someone who has joined');
  if (j.status === 'confirmed') throw new LifecycleError(409, 'Already confirmed');
  const tasks = await tasksOf(journeyId);
  const discussion = tasks
    .filter((t) => t.systemKey === 'confirmation_discussion' && t.status !== 'cancelled')
    .sort((a, b) => (b.month ?? 0) - (a.month ?? 0))[0];
  if (discussion && !ACTIVE_STATUSES.includes(discussion.status)) {
    const total = totalProbationMonths(j);
    throw new LifecycleError(409, `The decision opens in the final month${j.tj ? ` (from ${humanDay(probationMonthStart(j.tj, total))})` : ''}`);
  }
  const outcome = body.outcome;
  if (outcome !== 'confirm' && outcome !== 'extend' && outcome !== 'not_confirm') throw new LifecycleError(400, 'outcome is confirm, extend or not_confirm');
  const decision: ConfirmationDecision = { outcome, decidedAt: new Date(), decidedByName: hr.name };
  if (outcome === 'extend') {
    if (!Number.isInteger(body.extendMonths) || Number(body.extendMonths) < 1 || Number(body.extendMonths) > 6) throw new LifecycleError(400, 'Extend by 1 to 6 months');
    decision.extendMonths = Number(body.extendMonths);
  }
  if (body.salary !== undefined && body.salary !== null) {
    if (typeof body.salary !== 'number' || !Number.isFinite(body.salary) || body.salary <= 0 || body.salary > 1e10) throw new LifecycleError(400, 'salary is the annual CTC in rupees');
    decision.salary = Math.round(body.salary);
  }
  if (typeof body.kpiTemplateId === 'string' && body.kpiTemplateId.trim()) decision.kpiTemplateId = body.kpiTemplateId.trim();
  if (typeof body.designation === 'string' && body.designation.trim()) decision.designation = body.designation.trim().slice(0, 120);
  if (typeof body.reportingToUserId === 'string' && body.reportingToUserId) {
    const boss = await users().findOne({ userId: body.reportingToUserId, org: j.org }, { projection: { _id: 1 } });
    if (!boss) throw new LifecycleError(400, 'The new manager is not someone at this company');
    decision.reportingToUserId = body.reportingToUserId;
  }

  if (discussion) await finishMonthTask(discussion, hr);
  if (outcome === 'confirm') {
    // Probation is over: what is left of its months (a later check-in, review or goals) is nobody's to do or be reminded of.
    await journeyTasks().updateMany(
      { journeyId, phase: 'probation', status: { $in: OPEN_STATUSES }, systemKey: { $nin: ['confirmation_letter', 'confirmation_reveal'] } },
      { $set: { status: 'cancelled' } },
    );
  }
  // A new decision needs its own letter and its own reveal.
  for (const key of ['confirmation_letter', 'confirmation_reveal'] as SystemTaskKey[]) {
    await journeyTasks().updateMany({ journeyId, systemKey: key, status: { $in: ['done', 'skipped'] } }, { $set: { status: 'locked' }, $unset: { doneAt: '', doneByUserId: '', doneByName: '' } });
  }
  const set: Record<string, unknown> = { 'probation.decision': decision, updatedAt: new Date() };
  if (outcome === 'confirm') set.status = 'confirmed';
  if (outcome === 'extend') set['probation.extendedBy'] = (j.probation?.extendedBy ?? 0) + decision.extendMonths!;
  await journeys().updateOne({ id: journeyId }, { $set: set });
  if (outcome === 'extend') {
    await syncProbationTasks(journeyId);
    // The extension letter is for this decision: it opens now, not with the new final month's discussion.
    await reopenTask(journeyId, 'confirmation_letter');
  }
  await refreshJourney(journeyId);
  const name = (await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }))?.name ?? 'Your joiner';
  const said = outcome === 'confirm' ? 'is confirmed' : outcome === 'extend' ? `has probation extended by ${decision.extendMonths} months` : 'is not confirmed';
  await tell([j.managerUserId], { scenario: 'lifecycle_decision', destination: 'employee_profile', title: 'Probation decision', body: `${name} ${said}.`, data: { journeyId, ...(j.userId ? { employeeUserId: j.userId } : {}) } });
  return decision;
}

/**
 * The confirmation or extension letter sent to this person for the current
 * decision (the kind matching its outcome, emailed on or after the decision):
 * the latest one, or none.
 */
export async function sentDecisionLetter(j: Journey): Promise<string | undefined> {
  const decision = j.probation?.decision;
  if (!decision || (decision.outcome !== 'confirm' && decision.outcome !== 'extend')) return undefined;
  const kind = decision.outcome === 'confirm' ? 'confirmation' : 'extension';
  const who = j.userId ? [{ journeyId: j.id }, { userId: j.userId }] : [{ journeyId: j.id }];
  const letter = await letters().find({ org: j.org, kind, $or: who, 'email.sentAt': { $gte: new Date(decision.decidedAt) } }, { projection: { _id: 0, id: 1 } })
    .sort({ 'email.sentAt': -1 }).limit(1).next();
  return letter?.id;
}

/** The reveal (PB3): only once the letter is out. */
export async function revealFor(journeyId: string) {
  const j = await loadJourney(journeyId);
  const decision = j.probation?.decision;
  const tasks = await tasksOf(journeyId);
  const letterSent = tasks.some((t) => t.systemKey === 'confirmation_letter' && t.status === 'done') || !!decision?.letterId;
  if (!decision || !letterSent) return { ready: false };
  // A letter sent from Documents without the link to the decision (an older send) still opens from the reveal.
  if (!decision.letterId) {
    const found = await sentDecisionLetter(j);
    if (found) { decision.letterId = found; await journeys().updateOne({ id: journeyId }, { $set: { 'probation.decision.letterId': found } }); }
  }
  const manager = decision.reportingToUserId ? (await users().findOne({ userId: decision.reportingToUserId }, { projection: { _id: 0, name: 1 } }))?.name : undefined;
  const kpis = decision.kpiTemplateId ? await kpisOf(j.org, decision.kpiTemplateId) : undefined;
  return {
    ready: true,
    outcome: decision.outcome,
    ...(decision.extendMonths ? { extendMonths: decision.extendMonths } : {}),
    ...(decision.designation ? { designation: decision.designation } : {}),
    // Their own new CTC, to them only (never to the manager).
    ...(decision.salary ? { salary: decision.salary } : {}),
    ...(manager ? { reportsTo: manager } : {}),
    ...(kpis ? { kpis } : {}),
    ...(decision.letterId ? { letterId: decision.letterId, letterUrl: `/lifecycle/onboarding/letters/${decision.letterId}/pdf` } : {}),
    ...(decision.revealedAt ? { revealedAt: decision.revealedAt } : {}),
    decidedOn: todayKey(decision.decidedAt, companyTimeZone(j.org)),
  };
}

/** The KPI template the decision names: its name and its parameters, in order (NEW KPIs on the reveal). */
async function kpisOf(org: string, templateId: string): Promise<{ name: string; items: string[] } | undefined> {
  if (!ObjectId.isValid(templateId)) return undefined;
  const template = await kpiTemplates().findOne({ _id: new ObjectId(templateId), org }, { projection: { _id: 0, name: 1, parameterIds: 1 } });
  if (!template) return undefined;
  const ids = (template.parameterIds ?? []).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const params = ids.length ? await kpiParameters().find({ _id: { $in: ids } }, { projection: { _id: 1, title: 1 } }).toArray() : [];
  const title = new Map(params.map((p) => [String(p._id), (p as { title?: string }).title ?? '']));
  return { name: template.name, items: (template.parameterIds ?? []).map((id) => title.get(id) ?? '').filter(Boolean) };
}

export async function markRevealSeen(journeyId: string, joiner: { userId: string; name: string }) {
  const j = await loadJourney(journeyId);
  const reveal = await revealFor(journeyId);
  if (!reveal.ready) throw new LifecycleError(409, 'Nothing to reveal yet');
  if (!j.probation?.decision?.revealedAt) await journeys().updateOne({ id: journeyId }, { $set: { 'probation.decision.revealedAt': new Date() } });
  const task = (await tasksOf(journeyId)).find((t) => t.systemKey === 'confirmation_reveal' && OPEN_STATUSES.includes(t.status));
  await finishMonthTask(task, joiner);
  await refreshJourney(journeyId);
  return revealFor(journeyId);
}
