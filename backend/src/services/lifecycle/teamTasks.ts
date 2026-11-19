/**
 * Teams › Joiners for everyone connected to a joiner (the Team side artifact, 20 Nov,
 * prototypes Manager / Head of department / Buddy): the list of joiners, one joiner's page
 * and the full task list ("View all"), the same page for every viewer with the tasks of
 * their relation to the joiner:
 *
 * - `report`: the joiner reports to me. The manager's tasks: every manager-owned journey task
 *   from the template (ticked through the engine), plus the artifact's manager tasks that have
 *   no template row (MANAGER_EXTRA_TASKS, ticked here).
 * - `buddy`: I'm the joiner's buddy (journey.buddyUserId). BUDDY_TASKS.
 * - `line`: the joiner is further down my reporting line (I manage their manager, or someone
 *   above them): the head of department's view. HOD_TASKS, among them the confirmation approval
 *   once the manager has recommended.
 *
 * The team tasks are definitions in code (not in HR's template yet) and their ticks live on the
 * journey (`journey.teamTasks`), so every journey has them, existing ones too.
 *
 * Stages are the artifact's steps: Before Day 1, Day 1, Week 1, Month 1…Month n, Confirmed.
 */
import { journeys, users } from '../../config/db';
import type { Journey, JourneyTask, SystemTaskKey, TeamTaskTick } from '../../models/lifecycle.model';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { companyTimeZone, keyOfDay, probationMonthOn, todayKey, daysBetween } from './dueRules';
import {
  LifecycleError, deriveJourney, isJoined, loadJourney, namesOf, taskLate, tasksOf, totalProbationMonths, visibleTo,
} from './engine';
import { MANAGER_OWNED, managerMayTick, managerTaskDone } from './appOnboarding';
import { APP_COPY } from './seed';

type Me = { userId: string; name: string; org: string };

export type TeamRelation = 'report' | 'buddy' | 'line';
export type TeamTaskKind = 'help' | 'approve' | 'review' | 'task' | 'meet' | 'team' | 'goal' | 'doc' | 'chat';

/** When a team task is due: a step of the journey (a probation month by number, or the last). */
export type TeamAt = { step: 'pre' | 'day1' | 'week1' | 'confirmed' } | { step: 'month'; month: number | 'last' | 'mid' };

export interface TeamTaskDef {
  id: string;
  /** `{n}` is the joiner's first name, `{p}` their first name with ’s. */
  title: string;
  at: TeamAt;
  kind: TeamTaskKind;
  /** May be done before its step ("Opens in Month 2" otherwise). */
  early?: boolean;
  /** The joiner's own item it pairs with ("Your buddy"), shown with their avatar. */
  pair?: string;
  note?: string;
  /** A meeting's agenda (the meeting screen). */
  agenda?: string[];
}

const SETTLE = ['How {n} is settling in', 'Anything {n} is stuck on'];

/** The buddy's list (BuddyProto). */
export const BUDDY_TASKS: TeamTaskDef[] = [
  { id: 'buddy_meet', title: 'Meet {n} on Day 1', at: { step: 'day1' }, kind: 'meet', pair: 'Your buddy', agenda: ['How the team works day to day', 'Tools and shortcuts', 'Anything {n} is unsure about'] },
  { id: 'buddy_show_around', title: 'Show {n} around the office', at: { step: 'day1' }, kind: 'team' },
  { id: 'buddy_punch_in', title: 'Tell {n} how punch-in works', at: { step: 'day1' }, kind: 'help', pair: 'Sowaka tour: Punch in and out' },
  { id: 'buddy_policies', title: 'Show {n} where policies and payslips are', at: { step: 'day1' }, kind: 'help' },
  { id: 'buddy_week1', title: 'Week-1 check-in', at: { step: 'week1' }, kind: 'meet', agenda: ['How the first week went', 'Anything {n} is stuck on', 'Who {n} should meet next'] },
  { id: 'buddy_tools', title: 'Help {n} set up their work tools', at: { step: 'week1' }, kind: 'help', early: true },
  { id: 'buddy_intros', title: 'Introduce {n} to three people outside the team', at: { step: 'week1' }, kind: 'team', early: true },
  { id: 'buddy_leave_ot', title: 'Tell {n} how leave and overtime work', at: { step: 'week1' }, kind: 'help', early: true, pair: 'Sowaka tour: leave and overtime' },
  { id: 'buddy_month1', title: 'Month-1 catch-up', at: { step: 'month', month: 1 }, kind: 'meet', agenda: ['How the first month went', 'What would make next month easier'] },
];

/** The head of department's list (HodProto). */
export const HOD_TASKS: TeamTaskDef[] = [
  { id: 'hod_meet', title: 'Meet {n}', at: { step: 'week1' }, kind: 'meet', early: true, pair: 'Meet your head of department', note: 'A short hello in the first week or two', agenda: ['How {n} is settling in', 'What the department is working on', 'Anything {n} needs from you'] },
  { id: 'hod_approve', title: 'Approve {p} confirmation', at: { step: 'month', month: 'last' }, kind: 'approve', note: 'After the manager recommends' },
];

/**
 * The manager's tasks from the artifact that no template row covers (the template's own rows,
 * e.g. Meet {n}, Pick a buddy, the monthly check-ins and goals, come from the journey).
 * `manager_welcome` is done when the manager posted the welcome (journey.managerWelcome).
 */
export const MANAGER_EXTRA_TASKS: TeamTaskDef[] = [
  { id: 'mgr_plan_week', title: 'Plan {p} first week', at: { step: 'pre' }, kind: 'task', note: 'Who they meet, what they shadow' },
  { id: 'mgr_welcome', title: 'Send {n} a welcome message', at: { step: 'pre' }, kind: 'chat', early: true, pair: 'Message from your manager' },
  { id: 'mgr_buddy_check', title: 'Check in with {p} buddy', at: { step: 'week1' }, kind: 'meet', early: true, agenda: SETTLE },
  { id: 'mgr_week_chat', title: 'End-of-week chat', at: { step: 'week1' }, kind: 'meet', early: true, agenda: ['Highlights of the week', 'Questions so far', 'Plan for next week'] },
  { id: 'mgr_mid_feedback', title: 'Mid-probation feedback', at: { step: 'month', month: 'mid' }, kind: 'doc', pair: 'Feedback from your manager' },
  { id: 'mgr_write_review', title: 'Write {p} confirmation review', at: { step: 'month', month: 'last' }, kind: 'doc' },
  { id: 'mgr_recommend', title: 'Recommend: confirm or extend', at: { step: 'month', month: 'last' }, kind: 'doc', note: 'HR makes the final call' },
  { id: 'mgr_share_news', title: 'Share the news with the team', at: { step: 'confirmed' }, kind: 'team' },
];

const DEFS: Record<TeamRelation, TeamTaskDef[]> = { report: MANAGER_EXTRA_TASKS, buddy: BUDDY_TASKS, line: HOD_TASKS };
const ALL_DEFS = new Map([...BUDDY_TASKS, ...HOD_TASKS, ...MANAGER_EXTRA_TASKS].map((d) => [d.id, d]));

// ─── Steps ──────────────────────────────────────────────────────────────────

/** Before Day 1, Day 1, Week 1, Month 1…Month n, Confirmed. */
export function stepsFor(j: Pick<Journey, 'probation' | 'templateSnapshot'>): string[] {
  const n = totalProbationMonths(j);
  return ['Before Day 1', 'Day 1', 'Week 1', ...Array.from({ length: n }, (_, i) => `Month ${i + 1}`), 'Confirmed'];
}

/** The step a team task belongs to, or -1 when the journey has no such month. */
export function stepOfDef(at: TeamAt, months: number): number {
  switch (at.step) {
    case 'pre': return 0;
    case 'day1': return 1;
    case 'week1': return 2;
    case 'confirmed': return 3 + months;
    case 'month': {
      const raw = at.month;
      const m = raw === 'last' ? months : raw === 'mid' ? Math.max(1, Math.ceil(months / 2)) : raw;
      return m >= 1 && m <= months ? 2 + m : -1;
    }
  }
}

/** The step a day falls on for a journey joining on `tj` (a key 'YYYY-MM-DD'). */
export function stepOfDay(tj: string, day: string, months: number): number {
  const d = daysBetween(tj, day);
  if (d < 0) return 0;
  if (d === 0) return 1;
  if (d < 7) return 2;
  return 2 + Math.min(months, Math.max(1, probationMonthOn(tj, day, months)));
}

/** Where the joiner is now. */
export function currentStep(j: Journey, today: string): number {
  const months = totalProbationMonths(j);
  if (j.status === 'confirmed') return 3 + months;
  if (!isJoined(j) || !j.tj) return 0;
  return stepOfDay(j.tj, today, months);
}

// ─── Who is connected to whom ───────────────────────────────────────────────

const OPEN_ONBOARDING = { kind: 'onboarding', closedAt: { $exists: false }, status: { $nin: ['draft', 'offer_sent', 'accepted', 'declined', 'expired', 'not_joining'] } } as const;

/** Everyone under me (my reports, theirs, and so on, up to 8 levels), by user id. */
async function myLine(org: string, userId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier = [userId];
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const rows = await users().find({ org, managerUserId: { $in: frontier } }, { projection: { _id: 0, userId: 1 } }).toArray();
    frontier = rows.map((r) => r.userId).filter((id): id is string => !!id && !seen.has(id) && id !== userId);
    frontier.forEach((id) => seen.add(id));
  }
  return seen;
}

/** How I'm connected to a joiner: their manager first, then their buddy, then their line. */
export async function relationTo(me: Me, j: Journey): Promise<TeamRelation | null> {
  if (j.managerUserId === me.userId) return 'report';
  if (j.buddyUserId === me.userId) return 'buddy';
  if (j.managerUserId && (await myLine(me.org, me.userId)).has(j.managerUserId)) return 'line';
  return null;
}

async function connectedJourney(me: Me, journeyId: string): Promise<{ j: Journey; rel: TeamRelation }> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || j.org !== me.org || j.closedAt) throw new LifecycleError(404, 'Joiner not found');
  const rel = await relationTo(me, j);
  if (!rel) throw new LifecycleError(404, 'Joiner not found');
  return { j, rel };
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || 'them';
const fill = (text: string, first: string) => text.replace(/\{n\}/g, first).replace(/\{p\}/g, `${first}’s`);

// ─── The tasks ──────────────────────────────────────────────────────────────

export type TeamReviewState = 'waiting' | 'ready' | 'reviewed' | 'back';

export interface TeamTaskView {
  id: string;
  title: string;
  kind: TeamTaskKind;
  /** Index into `steps`. */
  step: number;
  early: boolean;
  done: boolean;
  pair?: string;
  note?: string;
  /** Can be ticked from the list (a review or approval opens its own screen instead). */
  canTick: boolean;
  /** A meeting, a review or an approval opens a screen. */
  opens: 'meeting' | 'approval' | null;
  /** Reviews and approvals: where it stands. */
  reviewState?: TeamReviewState;
  agenda?: string[];
  /** 'team': a team-side tick here; 'journey': a template task, ticked through the engine. */
  source: 'team' | 'journey';
  doneByName?: string;
}

const KIND_OF_KEY: Partial<Record<SystemTaskKey, TeamTaskKind>> = {
  manager_setup: 'task', assign_buddy: 'team', meet_manager: 'meet', meet_team: 'team', starter_task: 'task', one_on_one_notes: 'doc',
  probation_goals: 'goal', monthly_goals: 'goal', monthly_checkin: 'meet', monthly_review: 'review', confirmation_discussion: 'meet', manager_30day_note: 'doc',
};
const PAIR_OF_KEY: Partial<Record<SystemTaskKey, string>> = {
  assign_buddy: 'Your buddy', meet_manager: 'Meet your manager', meet_team: 'Your team', probation_goals: 'Your goals', monthly_goals: 'This month’s goals',
  monthly_checkin: 'Your check-in', monthly_review: 'Your self check-in', confirmation_discussion: 'Confirmation discussion',
};

function journeyTaskView(t: JourneyTask, j: Journey, first: string, months: number, names: Map<string, string>): TeamTaskView {
  const copy = t.systemKey ? APP_COPY[t.systemKey] : undefined;
  const on = t.dueAt ?? t.opensAt;
  const step = j.tj && on ? stepOfDay(j.tj, keyOfDay(on), months) : t.phase === 'pre_boarding' ? 0 : t.phase === 'first_week' ? 2 : 3;
  const done = t.status === 'done' || t.status === 'skipped';
  let title = copy?.managerTitle ? fill(copy.managerTitle.replace(/\{name\}/g, '{n}'), first) : t.title;
  if (t.month && (t.systemKey === 'monthly_checkin' || t.systemKey === 'monthly_goals' || t.systemKey === 'monthly_review')) {
    title = t.systemKey === 'monthly_checkin' ? `Month-${t.month} check-in` : t.systemKey === 'monthly_goals' ? `Set ${first}’s Month ${t.month} goals` : `Review ${first}’s Month-${t.month} self check-in`;
  }
  const kind = (t.systemKey && KIND_OF_KEY[t.systemKey]) || 'task';
  return {
    id: t.id, title, kind, step, early: false, done,
    ...(t.systemKey && PAIR_OF_KEY[t.systemKey] ? { pair: PAIR_OF_KEY[t.systemKey] } : {}),
    ...(copy?.manager ? { note: copy.manager } : {}),
    canTick: !done && managerMayTick(t), opens: kind === 'meet' ? 'meeting' : null, source: 'journey',
    ...(done && t.doneByUserId ? { doneByName: names.get(t.doneByUserId) } : {}),
  };
}

function teamDefView(d: TeamTaskDef, j: Journey, first: string, months: number): TeamTaskView | null {
  const step = stepOfDef(d.at, months);
  if (step < 0) return null;
  const tick = j.teamTasks?.[d.id];
  let done = !!tick;
  if (d.id === 'mgr_welcome' && j.managerWelcome) done = true;
  let reviewState: TeamReviewState | undefined;
  if (d.kind === 'approve') {
    const rec = j.teamTasks?.mgr_recommend;
    reviewState = tick ? (tick.outcome === 'discuss' ? 'back' : 'reviewed') : rec ? 'ready' : 'waiting';
    done = reviewState === 'reviewed';
  }
  return {
    id: d.id, title: fill(d.title, first), kind: d.kind, step, early: !!d.early, done,
    ...(d.pair ? { pair: d.pair } : {}), ...(d.note ? { note: d.note } : {}),
    canTick: d.kind !== 'approve' && d.id !== 'mgr_recommend',
    opens: d.kind === 'meet' ? 'meeting' : d.kind === 'approve' ? 'approval' : null,
    ...(reviewState ? { reviewState } : {}),
    ...(d.agenda ? { agenda: d.agenda.map((a) => fill(a, first)) } : {}),
    source: 'team', ...(tick?.byName ? { doneByName: tick.byName } : {}),
  };
}

async function tasksFor(j: Journey, rel: TeamRelation, first: string, journeyTasks?: JourneyTask[]): Promise<TeamTaskView[]> {
  const months = totalProbationMonths(j);
  const team = DEFS[rel].map((d) => teamDefView(d, j, first, months)).filter((t): t is TeamTaskView => !!t);
  if (rel !== 'report') return team;
  const rows = (journeyTasks ?? await tasksOf(j.id)).filter((t) => MANAGER_OWNED.includes(t.ownerRole) && visibleTo('manager', t));
  const names = await namesOf(rows.map((t) => t.doneByUserId));
  const fromJourney = rows.map((t) => journeyTaskView(t, j, first, months, names));
  // One list in step order; within a step the template's order, then the team's.
  return [...fromJourney, ...team].map((t, i) => ({ t, i })).sort((a, b) => a.t.step - b.t.step || a.i - b.i).map((x) => x.t);
}

// ─── Reads ──────────────────────────────────────────────────────────────────

type Face = Partial<FaceFields> & { userId?: string; name?: string; designation?: string; department?: string };

async function facesOf(ids: Array<string | undefined>): Promise<Map<string, Face>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await users().find({ userId: { $in: list } }, { projection: { _id: 0, name: 1, designation: 1, department: 1, ...FACE_PROJECTION } }).toArray();
  return new Map(rows.map((r) => [r.userId, r as Face]));
}

/** The joiner's own late items ("1 task delayed"), not the manager's. */
function delayedCount(tasks: JourneyTask[], today: string): number {
  return tasks.filter((t) => !MANAGER_OWNED.includes(t.ownerRole) && taskLate(t, today)).length;
}

/** GET /lifecycle/team/joiners — everyone joining or in probation I'm connected to. */
export async function teamJoiners(me: Me, now = new Date()) {
  const line = await myLine(me.org, me.userId);
  const rows = ((await journeys().find({
    org: me.org, ...OPEN_ONBOARDING,
    $or: [{ managerUserId: me.userId }, { buddyUserId: me.userId }, { managerUserId: { $in: [...line] } }],
  } as never, { projection: { _id: 0 } }).toArray()) as Journey[])
    .filter((j) => !(j.status === 'confirmed' && j.probation?.decision?.revealedAt));
  const faces = await facesOf(rows.flatMap((j) => [j.userId, j.managerUserId, j.buddyUserId]));
  const today = (j: Journey) => todayKey(now, companyTimeZone(j.org));
  const out = await Promise.all(rows.map(async (j) => {
    const rel: TeamRelation = j.managerUserId === me.userId ? 'report' : j.buddyUserId === me.userId ? 'buddy' : 'line';
    const person = j.userId ? faces.get(j.userId) : undefined;
    const name = person?.name ?? j.candidate?.name ?? '—';
    const steps = stepsFor(j);
    const step = currentStep(j, today(j));
    const all = await tasksOf(j.id);
    const tasks = await tasksFor(j, rel, firstOf(name), all);
    const open = tasks.filter((t) => t.step === step && !t.done && (t.canTick || t.opens === 'meeting' || t.reviewState === 'ready')).length;
    const photoUrl = person?.userId ? await faceUrlOf(person as FaceFields) : null;
    return {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name, ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      relation: rel, ...(j.managerUserId ? { managerName: faces.get(j.managerUserId)?.name ?? '' } : {}),
      step, stepLabel: step === 0 && j.tj ? `Joins ${joinsLabel(j.tj)}` : steps[step], plant: deriveJourney(j, all, now).plant,
      preboarding: !isJoined(j), toDo: open, ...(j.tj ? { tj: j.tj } : {}),
    };
  }));
  const rank: Record<TeamRelation, number> = { report: 0, buddy: 1, line: 2 };
  out.sort((a, b) => rank[a.relation] - rank[b.relation] || (a.tj ?? '').localeCompare(b.tj ?? ''));
  return { joiners: out };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const joinsLabel = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;

/** GET /lifecycle/team/joiners/:journeyId — the person page and the full task list. */
export async function teamJoiner(me: Me, journeyId: string, now = new Date()) {
  const { j, rel } = await connectedJourney(me, journeyId);
  const all = await tasksOf(j.id);
  const faces = await facesOf([j.userId, j.managerUserId, j.buddyUserId]);
  const person = j.userId ? faces.get(j.userId) : undefined;
  const name = person?.name ?? j.candidate?.name ?? '—';
  const first = firstOf(name);
  const today = todayKey(now, companyTimeZone(j.org));
  const steps = stepsFor(j);
  const step = currentStep(j, today);
  const photoUrl = person?.userId ? await faceUrlOf(person as FaceFields) : null;
  const delayed = delayedCount(all, today);
  const derived = deriveJourney(j, all, now);
  return {
    joiner: {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name, first, ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      ...((j.department ?? person?.department) ? { department: j.department ?? person?.department } : {}),
      ...(j.managerUserId ? { managerName: faces.get(j.managerUserId)?.name ?? '' } : {}),
      ...(j.buddyUserId ? { buddyName: faces.get(j.buddyUserId)?.name ?? '' } : {}),
      ...(j.tj ? { tj: j.tj } : {}), preboarding: !isJoined(j), plant: derived.plant, dayLabel: derived.dayLabel,
      status: delayed ? `${delayed} task${delayed === 1 ? '' : 's'} delayed` : step === 0 ? 'Joining soon' : 'On track', delayed,
    },
    relation: rel,
    steps, step,
    // The head of department follows along; only the manager and the buddy step ahead or back.
    canBrowseSteps: rel !== 'line',
    tasks: await tasksFor(j, rel, first, all),
  };
}

/** GET /lifecycle/team/joiners/:journeyId/approval — what the head of department approves. */
export async function teamApproval(me: Me, journeyId: string) {
  const { j, rel } = await connectedJourney(me, journeyId);
  if (rel !== 'line') throw new LifecycleError(403, 'Only the head of department approves');
  const all = await tasksOf(j.id);
  const rec = j.teamTasks?.mgr_recommend;
  const mine = j.teamTasks?.hod_approve;
  const names = await namesOf([j.managerUserId, j.userId]);
  const total = totalProbationMonths(j);
  const status = (key: SystemTaskKey, month?: number) => all.find((t) => t.systemKey === key && (month === undefined || t.month === month) && t.status !== 'cancelled');
  const isDone = (t?: JourneyTask) => !!t && (t.status === 'done' || t.status === 'skipped');
  const lastReview = status('monthly_checkin', total);
  const goals = all.filter((t) => t.systemKey === 'monthly_review');
  const facts: Array<{ label: string; value: string; ok: boolean }> = [
    { label: 'Self-review', value: isDone(lastReview) ? 'Sent' : 'Not yet', ok: isDone(lastReview) },
    { label: 'Confirmation discussion', value: isDone(status('confirmation_discussion')) ? 'Done' : 'Not yet', ok: isDone(status('confirmation_discussion')) },
    ...(goals.length ? [{ label: 'Months reviewed', value: `${goals.filter(isDone).length} of ${goals.length}`, ok: goals.every(isDone) }] : []),
    ...(status('pulse_survey') ? [{ label: 'Probation feedback survey', value: isDone(status('pulse_survey')) ? 'Filled in' : 'Not yet', ok: isDone(status('pulse_survey')) }] : []),
  ];
  return {
    state: (mine ? (mine.outcome === 'discuss' ? 'back' : 'reviewed') : rec ? 'ready' : 'waiting') as TeamReviewState,
    ...(rec ? { recommendation: { byName: rec.byName ?? (j.managerUserId ? names.get(j.managerUserId) : '') ?? '', outcome: rec.outcome ?? 'confirm', ...(rec.note ? { note: rec.note } : {}), at: rec.doneAt } } : {}),
    ...(mine ? { answer: { outcome: mine.outcome, ...(mine.note ? { note: mine.note } : {}), at: mine.doneAt, byName: mine.byName } } : {}),
    managerName: (j.managerUserId ? names.get(j.managerUserId) : '') ?? '',
    facts,
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function setTick(j: Journey, id: string, tick: TeamTaskTick | null): Promise<void> {
  const update = tick
    ? { $set: { [`teamTasks.${id}`]: tick, updatedAt: new Date() } }
    : { $unset: { [`teamTasks.${id}`]: '' }, $set: { updatedAt: new Date() } };
  await journeys().updateOne({ id: j.id }, update as never);
}

const cleanNote = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');

/**
 * POST /lifecycle/team/joiners/:journeyId/tasks/:taskId — `{ action: 'done' | 'undo' }`; the manager's
 * recommendation `{ action: 'recommend', outcome: 'confirm' | 'extend', note }`. A template task of the
 * manager's goes through the engine (managerTaskDone: its rules, no undo).
 */
export async function teamTaskAction(me: Me, journeyId: string, taskId: string, body: Record<string, unknown>) {
  const { j, rel } = await connectedJourney(me, journeyId);
  const def = ALL_DEFS.get(taskId);
  if (!def) {
    if (rel !== 'report') throw new LifecycleError(404, 'Task not found');
    await managerTaskDone(me, journeyId, taskId, { action: 'done' });
    return teamJoiner(me, journeyId);
  }
  if (!DEFS[rel].includes(def)) throw new LifecycleError(404, 'Task not found');
  if (def.kind === 'approve') throw new LifecycleError(409, 'This one is done from its own screen');
  const by = { doneAt: new Date(), byUserId: me.userId, byName: me.name };
  if (body.action === 'recommend') {
    if (def.id !== 'mgr_recommend') throw new LifecycleError(400, 'Only the recommendation takes an outcome');
    const outcome = body.outcome === 'extend' ? 'extend' : body.outcome === 'confirm' ? 'confirm' : null;
    if (!outcome) throw new LifecycleError(400, 'outcome is confirm or extend');
    await setTick(j, def.id, { ...by, outcome, ...(cleanNote(body.note) ? { note: cleanNote(body.note) } : {}) });
  } else if (body.action === 'done') {
    if (def.id === 'mgr_recommend') throw new LifecycleError(400, 'Recommend with an outcome');
    await setTick(j, def.id, by);
  } else if (body.action === 'undo') {
    if (def.id === 'mgr_recommend' && j.teamTasks?.hod_approve) throw new LifecycleError(409, 'The head of department has answered already');
    await setTick(j, def.id, null);
  } else {
    throw new LifecycleError(400, 'action is done, undo or recommend');
  }
  return teamJoiner(me, journeyId);
}

/** POST /lifecycle/team/joiners/:journeyId/approval — `{ action: 'approve' | 'discuss', comment }`. */
export async function answerApproval(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, rel } = await connectedJourney(me, journeyId);
  if (rel !== 'line') throw new LifecycleError(403, 'Only the head of department approves');
  if (!j.teamTasks?.mgr_recommend) throw new LifecycleError(409, 'Waiting for the manager’s recommendation');
  if (j.teamTasks?.hod_approve && j.teamTasks.hod_approve.outcome !== 'discuss') throw new LifecycleError(409, 'Approved already');
  const outcome = body.action === 'approve' ? 'approved' : body.action === 'discuss' ? 'discuss' : null;
  if (!outcome) throw new LifecycleError(400, 'action is approve or discuss');
  const note = cleanNote(body.comment);
  await setTick(j, 'hod_approve', { doneAt: new Date(), byUserId: me.userId, byName: me.name, outcome, ...(note ? { note } : {}) });
  return teamApproval(me, journeyId);
}

