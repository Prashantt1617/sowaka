/**
 * Teams › Joiners for everyone connected to a joiner (the Team side artifact, 20 Nov,
 * prototypes Manager / Head of department / Buddy): the list of joiners, one joiner's page
 * and the full task list ("View all"), the same page for every viewer with the tasks of
 * their relation to the joiner:
 *
 * - `report`: the joiner reports to me. Every manager-owned journey task (ticked through the
 *   engine), plus the template's manager team rows (ticked here).
 * - `buddy`: I'm the joiner's buddy (journey.buddyUserId). The template's buddy rows.
 * - `line`: I'm the joiner's head of department (approverOf: the department head the company
 *   records, else the manager's manager), or further up their reporting line. Only the head of
 *   department gets the template's head-of-department rows and approves the confirmation; anyone
 *   else up the line follows along read-only.
 *
 * The team tasks are rows of HR's onboarding template (`TemplateTask.team`, seed.ts teamSeed),
 * read from the journey's template as it is now, so HR's edits apply at once; a template without
 * any (not migrated yet) uses the seed's. They never become journey tasks: ticks live on the
 * journey (`journey.teamTasks`, by the row's team key). The manager's recommendation and the head
 * of department's answer are also written onto the confirmation record (journey.probation), where
 * HR decides.
 *
 * Stages are the artifact's steps: Before Day 1, Day 1, Week 1, Month 1…Month n, Confirmed.
 */
import { companies, journeys, lifecycleTemplates, probationMonths, users } from '../../config/db';
import type { DueRule, Journey, JourneyTask, OwnerRole, ProbationMonth, SystemTaskKey, TeamTaskKind, TeamTaskSpec, TeamTaskTick, TemplateTask } from '../../models/lifecycle.model';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { addDaysKey, companyTimeZone, daysBetween, keyOfDay, probationMonthOn, todayKey } from './dueRules';
import {
  LifecycleError, deriveJourney, isJoined, loadJourney, namesOf, taskLate, tasksOf, tell, totalProbationMonths, visibleTo,
} from './engine';
import { MANAGER_OWNED, devicesFor, managerMayTick, managerTaskDone, onboardingHome } from './appOnboarding';
import { updateMonthByManager } from './probation';
import { APP_COPY, teamSeed } from './seed';
import { agendaResolver } from './joinerMeetings';
import { listExtras } from './teamApp';

type Me = { userId: string; name: string; org: string };

export type TeamRelation = 'report' | 'buddy' | 'line';

/** A team row as the views read it: its key, wording, owner, timing and look. */
export interface TeamTaskDef {
  id: string;
  owner: OwnerRole;
  /** `{n}` is the joiner's first name, `{p}` their first name with ’s. */
  title: string;
  note?: string;
  dueRule: DueRule | null;
  team: TeamTaskSpec;
}

const OWNER_OF: Record<TeamRelation, OwnerRole> = { report: 'manager', buddy: 'buddy', line: 'head_of_department' };

const defOf = (t: TemplateTask): TeamTaskDef => ({ id: t.team!.key, owner: t.ownerRole, title: t.title, ...(t.helper ? { note: t.helper } : {}), dueRule: t.dueRule ?? null, team: t.team! });

/**
 * The journey's team rows, switched on: from its template as it is now, else its snapshot, else
 * the seed (a template with no team rows at all has not been migrated yet).
 */
export async function teamDefsFor(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot'>): Promise<TeamTaskDef[]> {
  const pick = (tasks?: TemplateTask[]) => (tasks ?? []).filter((t) => !!t.team);
  // A Final-designs journey keeps the version it started with (design.ts designOf): its own copy, never the template as
  // it is now, so a template edit reaches new joiners only here too (the dashboard panel's team rows read this).
  const own = pick(j.templateSnapshot?.tasks);
  const template = !own.some((t) => !!t.design) && j.templateId ? await lifecycleTemplates().findOne({ org: j.org, id: j.templateId }, { projection: { _id: 0, tasks: 1 } }) : null;
  let rows = pick(template?.tasks);
  if (!rows.length) rows = own;
  if (!rows.length) rows = teamSeed();
  return rows.filter((t) => t.enabled !== false).sort((a, b) => a.order - b.order).map(defOf);
}

// ─── Steps ──────────────────────────────────────────────────────────────────

/** Before Day 1, Day 1, Week 1, Month 1…Month n, Confirmed. */
export function stepsFor(j: Pick<Journey, 'probation' | 'templateSnapshot'>): string[] {
  const n = totalProbationMonths(j);
  return ['Before Day 1', 'Day 1', 'Week 1', ...Array.from({ length: n }, (_, i) => `Month ${i + 1}`), 'Confirmed'];
}

/**
 * The step a team row belongs to, from its due rule: before Tj → Before Day 1, Tj → Day 1,
 * Tj+1…6 → Week 1, later or a month's start/end → that month, none → Confirmed. -1: the journey
 * has no such month (a Month-5 row on a 3-month probation).
 */
export function stepOfRule(rule: DueRule | null, months: number, tj?: string): number {
  if (!rule) return 3 + months;
  if (rule.anchor === 'tj') {
    const offset = rule.offset ?? 0;
    if (offset < 0) return 0;
    if (offset === 0) return 1;
    if (offset < 7) return 2;
    if (tj) return stepOfDay(tj, addDaysKey(tj, offset), months);
    return 2 + Math.min(months, Math.max(1, Math.ceil((offset + 1) / 30)));
  }
  if (rule.anchor === 'month_start' || rule.anchor === 'month_end') {
    const m = rule.month === 'last' ? months : Array.isArray(rule.month) ? rule.month[0] : rule.month === 'each' || rule.month === undefined ? 1 : rule.month;
    return m >= 1 && m <= months ? 2 + m : -1;
  }
  // The offer and its acceptance: before Day 1. Offboarding anchors never apply.
  return 0;
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

/**
 * The joiner's head of department, the one approver of their confirmation: the head the company
 * records for their department (Company.departmentHeads), unless that is the joiner or their
 * manager; else the manager's own manager.
 */
export async function approverOf(j: Pick<Journey, 'org' | 'userId' | 'managerUserId' | 'department'>): Promise<string | undefined> {
  const [company, joiner, manager] = await Promise.all([
    companies().findOne({ id: j.org }, { projection: { _id: 0, departmentHeads: 1 } }),
    !j.department && j.userId ? users().findOne({ userId: j.userId }, { projection: { _id: 0, department: 1 } }) : Promise.resolve(null),
    j.managerUserId ? users().findOne({ userId: j.managerUserId }, { projection: { _id: 0, managerUserId: 1 } }) : Promise.resolve(null),
  ]);
  const department = (j.department ?? joiner?.department ?? '').trim().toLowerCase();
  const head = department ? company?.departmentHeads?.find((h) => h.department.trim().toLowerCase() === department)?.userId : undefined;
  if (head && head !== j.userId && head !== j.managerUserId) return head;
  const skip = manager?.managerUserId;
  return skip && skip !== j.userId && skip !== j.managerUserId ? skip : undefined;
}

/** The departments I head (Company.departmentHeads), lower-cased. */
async function departmentsIHead(me: Me): Promise<string[]> {
  const company = await companies().findOne({ id: me.org }, { projection: { _id: 0, departmentHeads: 1 } });
  return (company?.departmentHeads ?? []).filter((h) => h.userId === me.userId).map((h) => h.department.trim().toLowerCase());
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Link = { rel: TeamRelation; approver: boolean; approverUserId?: string };

/** How I'm connected to a joiner: their manager first, then their buddy, then their head of department or line. */
export async function relationTo(me: Me, j: Journey, line?: Set<string>): Promise<Link | null> {
  const approverUserId = await approverOf(j);
  const base = approverUserId ? { approverUserId } : {};
  if (j.managerUserId === me.userId) return { rel: 'report', approver: false, ...base };
  if (j.buddyUserId === me.userId) return { rel: 'buddy', approver: false, ...base };
  if (approverUserId === me.userId) return { rel: 'line', approver: true, ...base };
  if (j.managerUserId && (line ?? await myLine(me.org, me.userId)).has(j.managerUserId)) return { rel: 'line', approver: false, ...base };
  return null;
}

async function connectedJourney(me: Me, journeyId: string): Promise<{ j: Journey } & Link> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || j.org !== me.org || j.closedAt) throw new LifecycleError(404, 'Joiner not found');
  const link = await relationTo(me, j);
  if (!link) throw new LifecycleError(404, 'Joiner not found');
  return { j, ...link };
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
  /**
   * A meeting, a review, an approval or the manager's recommendation opens a screen; `review` is a
   * month's self check-in (MgrReview); `screen` a template task done on its own screen (set up, the
   * buddy, goals, the starter task, 1:1 notes), which the app opens by its `systemKey`.
   */
  opens: 'meeting' | 'approval' | 'recommend' | 'review' | 'screen' | null;
  /** Journey rows: the template step (the app opens the right screen) and the probation month. */
  systemKey?: SystemTaskKey;
  month?: number;
  /** A journey row the engine has not opened yet (after another task, or later). */
  locked?: boolean;
  /** The manager's recommendation as it stands (`mgr_recommend` only), so the app can show and change it. */
  recommended?: { outcome: 'confirm' | 'extend'; note?: string };
  /** Reviews and approvals: where it stands. */
  reviewState?: TeamReviewState;
  agenda?: string[];
  /** 'team': a team-side tick here; 'journey': a template task, ticked through the engine. */
  source: 'team' | 'journey';
  doneByName?: string;
}

/** The manager's recommendation: the confirmation record's, else an older tick's. */
export function recommendationOf(j: Journey) {
  const rec = j.probation?.recommendation;
  if (rec) return rec;
  const tick = j.teamTasks?.mgr_recommend;
  return tick ? { outcome: (tick.outcome === 'extend' ? 'extend' : 'confirm') as 'confirm' | 'extend', ...(tick.note ? { note: tick.note } : {}), byUserId: tick.byUserId, byName: tick.byName, at: tick.doneAt } : undefined;
}

/** The head of department's answer: the confirmation record's, else an older tick's. */
export function approvalOf(j: Journey) {
  const a = j.probation?.hodApproval;
  if (a) return a;
  const tick = j.teamTasks?.hod_approve;
  return tick ? { outcome: (tick.outcome === 'discuss' ? 'discuss' : 'approved') as 'approved' | 'discuss', ...(tick.note ? { comment: tick.note } : {}), byUserId: tick.byUserId, byName: tick.byName, at: tick.doneAt } : undefined;
}

function approvalState(j: Journey): TeamReviewState {
  const a = approvalOf(j);
  if (a) return a.outcome === 'discuss' ? 'back' : 'reviewed';
  return recommendationOf(j) ? 'ready' : 'waiting';
}

const KIND_OF_KEY: Partial<Record<SystemTaskKey, TeamTaskKind>> = {
  manager_setup: 'task', assign_buddy: 'team', meet_manager: 'meet', meet_team: 'team', starter_task: 'task', one_on_one_notes: 'doc',
  probation_goals: 'goal', monthly_goals: 'goal', monthly_checkin: 'meet', monthly_review: 'review', confirmation_discussion: 'meet', manager_30day_note: 'doc',
};
const PAIR_OF_KEY: Partial<Record<SystemTaskKey, string>> = {
  assign_buddy: 'Your buddy', meet_manager: 'Meet your manager', meet_team: 'Your team', probation_goals: 'Your goals', monthly_goals: 'This month’s goals',
  monthly_checkin: 'Your check-in', monthly_review: 'Your self check-in', confirmation_discussion: 'Confirmation discussion',
};

/** The template steps done on a screen of their own in the app (never a bare tick). */
const SCREEN_KEYS = new Set<SystemTaskKey>(['starter_task', 'one_on_one_notes', 'probation_goals', 'monthly_goals', 'manager_setup', 'assign_buddy', 'manager_30day_note']);

/** A month's self check-in as the manager reviews it: waiting for it, ready, reviewed, or sent back. */
export function monthReviewState(m?: ProbationMonth): TeamReviewState {
  if (m?.review) return 'reviewed';
  const sent = m?.checkinEmployee?.at;
  if (m?.sentBack && (!sent || new Date(m.sentBack.at).getTime() >= new Date(sent).getTime())) return 'back';
  return sent ? 'ready' : 'waiting';
}

function journeyTaskView(t: JourneyTask, j: Journey, first: string, months: number, names: Map<string, string>, month?: ProbationMonth, agenda: string[] = []): TeamTaskView {
  const copy = t.systemKey ? APP_COPY[t.systemKey] : undefined;
  const on = t.dueAt ?? t.opensAt;
  const step = j.tj && on ? stepOfDay(j.tj, keyOfDay(on), months) : t.phase === 'pre_boarding' ? 0 : t.phase === 'first_week' ? 2 : 3;
  let done = t.status === 'done' || t.status === 'skipped';
  const key = t.systemKey;
  // The month's check-in is the manager's side of it (the joiner sends theirs): done once the manager's is in.
  if (key === 'monthly_checkin' && month?.checkinManager) done = true;
  const reviewState = key === 'monthly_review' ? monthReviewState(month) : undefined;
  if (reviewState) done = reviewState === 'reviewed';
  let title = copy?.managerTitle ? fill(copy.managerTitle.replace(/\{name\}/g, '{n}'), first) : t.title;
  if (t.month && (t.systemKey === 'monthly_checkin' || t.systemKey === 'monthly_goals' || t.systemKey === 'monthly_review')) {
    title = t.systemKey === 'monthly_checkin' ? `Month-${t.month} check-in` : t.systemKey === 'monthly_goals' ? `Set ${first}’s Month ${t.month} goals` : `Review ${first}’s Month-${t.month} self check-in`;
  }
  const kind = (key && KIND_OF_KEY[key]) || (t.kind === 'meeting' ? 'meet' : 'task');
  const locked = t.status === 'locked';
  const open = !done && !locked && t.status !== 'cancelled';
  const opens: TeamTaskView['opens'] = reviewState ? 'review' : kind === 'meet' ? 'meeting' : key && SCREEN_KEYS.has(key) ? 'screen' : null;
  return {
    id: t.id, title, kind, step, early: false, done,
    ...(key && PAIR_OF_KEY[key] ? { pair: PAIR_OF_KEY[key] } : {}),
    ...(copy?.manager ? { note: copy.manager } : {}),
    canTick: open && (managerMayTick(t) || key === 'monthly_checkin'), opens, source: 'journey',
    ...(key ? { systemKey: key } : {}), ...(t.month ? { month: t.month } : {}), ...(locked && !reviewState ? { locked: true } : {}),
    ...(reviewState ? { reviewState } : {}),
    // The template's agenda: the same points the joiner's meeting screen lists (joinerMeetings.ts).
    ...(kind === 'meet' && agenda.length ? { agenda } : {}),
    ...(done && t.doneByUserId ? { doneByName: names.get(t.doneByUserId) } : {}),
  };
}

function teamDefView(d: TeamTaskDef, j: Journey, first: string, months: number): TeamTaskView | null {
  const step = stepOfRule(d.dueRule, months, j.tj);
  if (step < 0) return null;
  const kind = d.team.kind;
  const tick = j.teamTasks?.[d.id];
  let done = !!tick;
  if (d.id === 'mgr_welcome' && j.managerWelcome) done = true;
  const rec = d.id === 'mgr_recommend' ? recommendationOf(j) : undefined;
  if (d.id === 'mgr_recommend') done = !!rec;
  let reviewState: TeamReviewState | undefined;
  if (kind === 'approve') {
    reviewState = approvalState(j);
    done = reviewState === 'reviewed';
  }
  return {
    id: d.id, title: fill(d.title, first), kind, step, early: !!d.team.early, done,
    ...(d.team.pair ? { pair: d.team.pair } : {}), ...(d.note ? { note: d.note } : {}),
    canTick: kind !== 'approve' && d.id !== 'mgr_recommend',
    opens: kind === 'meet' ? 'meeting' : kind === 'approve' ? 'approval' : d.id === 'mgr_recommend' ? 'recommend' : null,
    ...(reviewState ? { reviewState } : {}),
    ...(rec ? { recommended: { outcome: rec.outcome, ...(rec.note ? { note: rec.note } : {}) } } : {}),
    ...(d.team.agenda?.length ? { agenda: d.team.agenda.map((a) => fill(a, first)) } : {}),
    source: 'team', ...(tick?.byName ? { doneByName: tick.byName } : {}),
  };
}

/** My tasks for the joiner; none for someone up the line who is not the head of department. */
async function tasksFor(j: Journey, link: Link, first: string, journeyTasks?: JourneyTask[]): Promise<TeamTaskView[]> {
  if (link.rel === 'line' && !link.approver) return [];
  const months = totalProbationMonths(j);
  const owner = OWNER_OF[link.rel];
  const team = (await teamDefsFor(j)).filter((d) => d.owner === owner).map((d) => teamDefView(d, j, first, months)).filter((t): t is TeamTaskView => !!t);
  if (link.rel !== 'report') return team;
  const rows = (journeyTasks ?? await tasksOf(j.id)).filter((t) => MANAGER_OWNED.includes(t.ownerRole) && visibleTo('manager', t));
  const [names, monthRows, agendaOf] = await Promise.all([
    namesOf(rows.map((t) => t.doneByUserId)),
    rows.some((t) => t.month) ? probationMonths().find({ journeyId: j.id }, { projection: { _id: 0 } }).toArray() : Promise.resolve([] as ProbationMonth[]),
    agendaResolver(j),
  ]);
  const monthOf = (t: JourneyTask) => (t.month ? monthRows.find((m) => m.monthNo === t.month) : undefined);
  const fromJourney = rows.map((t) => journeyTaskView(t, j, first, months, names, monthOf(t), agendaOf(t)));
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

/** Still to do by the viewer now (the red count): tickable, or a screen to open that waits on them. */
export function isOpenForMe(t: TeamTaskView): boolean {
  if (t.done || t.locked) return false;
  return t.canTick || t.opens === 'meeting' || t.opens === 'recommend' || t.opens === 'screen' || t.reviewState === 'ready';
}

/**
 * View progress (MgrProgress): the joiner's own Meetings, Tasks, Sowaka tour and Devices, read from
 * the joiner's own onboarding home, so the team side counts exactly what the joiner's tiles count.
 * Only the fields a row is counted and listed by: the joiner's own notes and the meetings' details stay theirs.
 */
async function progressOf(j: Journey, name: string, all: JourneyTask[], now: Date) {
  if (!j.userId) return { today: [], later: [], done: [], tour: { done: [] as string[] }, devices: devicesFor(all) };
  const home = await onboardingHome({ userId: j.userId, name, org: j.org }, now, j);
  // Only what a row needs to be counted and listed: never the joiner's own notes or a meeting's details.
  const KEEP = ['id', 'systemKey', 'phase', 'title', 'ownerRole', 'ownerName', 'kind', 'surface', 'mustDo', 'status', 'opensAt', 'dueAt', 'dueLabel', 'doneAt', 'late', 'month', 'progress', 'readOnly'];
  const bare = (list: unknown[]) => (list as Array<Record<string, unknown>>).map((row) => Object.fromEntries(KEEP.filter((k) => row[k] !== undefined).map((k) => [k, row[k]])));
  return { today: bare(home.today), later: bare(home.later), done: bare(home.done), tour: { done: home.tour.done }, devices: home.devices };
}

/**
 * HR's joiner panel: the team rows (the manager's, the buddy's, the head of department's) as the
 * team side ticks them, so HR sees what the app's ticks did. Wording from the template as it is now.
 */
export async function teamRowsForHr(j: Journey) {
  const months = totalProbationMonths(j);
  const steps = stepsFor(j);
  const first = firstOf(j.candidate?.name ?? '');
  const views = (await teamDefsFor(j)).map((d) => ({ d, v: teamDefView(d, j, first, months) })).filter((x): x is { d: TeamTaskDef; v: TeamTaskView } => !!x.v);
  return views.map(({ d, v }) => ({
    id: v.id, title: v.title, owner: d.owner, step: steps[v.step] ?? '', done: v.done,
    ...(v.doneByName ? { doneByName: v.doneByName } : {}), ...(j.teamTasks?.[d.id]?.doneAt ? { doneAt: j.teamTasks[d.id].doneAt } : {}),
  }));
}

/** GET /lifecycle/team/joiners — everyone joining or in probation I'm connected to. */
export async function teamJoiners(me: Me, now = new Date()) {
  const [line, heads] = await Promise.all([myLine(me.org, me.userId), departmentsIHead(me)]);
  const rows = ((await journeys().find({
    org: me.org, ...OPEN_ONBOARDING,
    $or: [
      { managerUserId: me.userId }, { buddyUserId: me.userId }, { managerUserId: { $in: [...line] } },
      // The departments I head: their joiners, wherever they sit in the tree.
      ...(heads.length ? [{ department: { $in: heads.map((d) => new RegExp(`^\\s*${escapeRegex(d)}\\s*$`, 'i')) } }] : []),
    ],
  } as never, { projection: { _id: 0 } }).toArray()) as Journey[])
    .filter((j) => !(j.status === 'confirmed' && j.probation?.decision?.revealedAt));
  const links = await Promise.all(rows.map((j) => relationTo(me, j, line)));
  const mine = rows.map((j, i) => ({ j, link: links[i] })).filter((x): x is { j: Journey; link: Link } => !!x.link);
  const faces = await facesOf(mine.flatMap(({ j, link }) => [j.userId, j.managerUserId, j.buddyUserId, link.approverUserId]));
  const out = await Promise.all(mine.map(async ({ j, link }) => {
    const person = j.userId ? faces.get(j.userId) : undefined;
    const name = person?.name ?? j.candidate?.name ?? '—';
    const steps = stepsFor(j);
    const step = currentStep(j, todayKey(now, companyTimeZone(j.org)));
    const all = await tasksOf(j.id);
    const tasks = await tasksFor(j, link, firstOf(name), all);
    const open = tasks.filter((t) => t.step === step && isOpenForMe(t)).length;
    const photoUrl = person?.userId ? await faceUrlOf(person as FaceFields) : null;
    return {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name, ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      relation: link.rel, ...(j.managerUserId ? { managerName: faces.get(j.managerUserId)?.name ?? '' } : {}),
      ...approverFields(link, me, faces),
      step, stepLabel: step === 0 && j.tj ? `Joins ${joinsLabel(j.tj)}` : steps[step], plant: deriveJourney(j, all, now).plant,
      preboarding: !isJoined(j), toDo: open, ...(j.tj ? { tj: j.tj } : {}),
      // Final designs (FINAL-DESIGNS.md §4.3): initials, "You’re the buddy" / "Reports to X", the plant's stage.
      ...listExtras({ name, relation: link.rel, managerName: j.managerUserId ? faces.get(j.managerUserId)?.name : undefined, plant: deriveJourney(j, all, now).plant }),
    };
  }));
  // The newest joiner first (MgrProtoJoiners / BuddyProto / HodProto: Joins 1 Dec, Day 1, Week 1, Month 1 … Month 6),
  // whatever I am to them.
  out.sort((a, b) => a.step - b.step || (b.tj ?? '').localeCompare(a.tj ?? '') || a.name.localeCompare(b.name));
  return { joiners: out };
}

/** Who approves the confirmation, for the views ("Head of department: Rahul Mehta"). */
function approverFields(link: Link, me: Me, faces: Map<string, Face>) {
  if (!link.approverUserId) return { approverIsYou: false };
  return { approverUserId: link.approverUserId, approverName: faces.get(link.approverUserId)?.name ?? '', approverIsYou: link.approverUserId === me.userId };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const joinsLabel = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;

/** GET /lifecycle/team/joiners/:journeyId — the person page and the full task list. */
export async function teamJoiner(me: Me, journeyId: string, now = new Date()) {
  const { j, ...link } = await connectedJourney(me, journeyId);
  const all = await tasksOf(j.id);
  const faces = await facesOf([j.userId, j.managerUserId, j.buddyUserId, link.approverUserId]);
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
    relation: link.rel,
    ...approverFields(link, me, faces),
    // Up the line but not the head of department: following along, nothing to do.
    readOnly: link.rel === 'line' && !link.approver,
    steps, step,
    // The head of department follows along; only the manager and the buddy step ahead or back.
    canBrowseSteps: link.rel !== 'line',
    tasks: await tasksFor(j, link, first, all),
    progress: await progressOf(j, name, all, now),
  };
}

/** GET /lifecycle/team/joiners/:journeyId/approval — what the head of department approves. */
export async function teamApproval(me: Me, journeyId: string) {
  const { j, approver } = await connectedJourney(me, journeyId);
  if (!approver) throw new LifecycleError(403, 'Only the head of department approves');
  return approvalView(j);
}

async function approvalView(j: Journey) {
  const all = await tasksOf(j.id);
  const rec = recommendationOf(j);
  const mine = approvalOf(j);
  const names = await namesOf([j.managerUserId]);
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
    state: approvalState(j),
    ...(rec ? { recommendation: { byName: rec.byName ?? (j.managerUserId ? names.get(j.managerUserId) : '') ?? '', outcome: rec.outcome, ...(rec.note ? { note: rec.note } : {}), at: rec.at } } : {}),
    ...(mine ? { answer: { outcome: mine.outcome, ...(mine.comment ? { note: mine.comment } : {}), at: mine.at, byName: mine.byName } } : {}),
    managerName: (j.managerUserId ? names.get(j.managerUserId) : '') ?? '',
    facts,
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** A team row's tick on the journey (also the joiner's Mark as met on a paired meeting, joinerMeetings.ts). */
export async function setTick(j: Pick<Journey, 'id'>, id: string, tick: TeamTaskTick | null, extra: { set?: Record<string, unknown>; unset?: string[] } = {}): Promise<void> {
  const $set: Record<string, unknown> = { updatedAt: new Date(), ...(tick ? { [`teamTasks.${id}`]: tick } : {}), ...(extra.set ?? {}) };
  const $unset: Record<string, ''> = Object.fromEntries([...(tick ? [] : [`teamTasks.${id}`]), ...(extra.unset ?? [])].map((k) => [k, '' as const]));
  await journeys().updateOne({ id: j.id }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) } as never);
}

const cleanNote = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');

/**
 * POST /lifecycle/team/joiners/:journeyId/tasks/:taskId — `{ action: 'done' | 'undo' }`; the manager's
 * recommendation `{ action: 'recommend', outcome: 'confirm' | 'extend', note }` (onto the confirmation
 * record too; a new one after "Ask to discuss" reopens the head of department's answer). A template task
 * of the manager's goes through the engine (managerTaskDone: its rules, no undo).
 */
export async function teamTaskAction(me: Me, journeyId: string, taskId: string, body: Record<string, unknown>) {
  const { j, ...link } = await connectedJourney(me, journeyId);
  const def = (await teamDefsFor(j)).find((d) => d.id === taskId);
  if (!def) {
    if (link.rel !== 'report') throw new LifecycleError(404, 'Task not found');
    const task = (await tasksOf(j.id)).find((t) => t.id === taskId);
    if (task?.systemKey === 'monthly_checkin' && task.month) {
      // The check-in meeting marked done: the manager's side of the month's check-in, its notes the words.
      if (body.action !== 'done') throw new LifecycleError(400, 'action is done');
      await updateMonthByManager(j.id, me, task.month, { checkin: { met: true, text: typeof body.notes === 'string' ? body.notes : '' } });
      return teamJoiner(me, journeyId);
    }
    await managerTaskDone(me, journeyId, taskId, { action: 'done' });
    return teamJoiner(me, journeyId);
  }
  if (def.owner !== OWNER_OF[link.rel] || (link.rel === 'line' && !link.approver)) throw new LifecycleError(404, 'Task not found');
  if (def.team.kind === 'approve') throw new LifecycleError(409, 'This one is done from its own screen');
  const by = { doneAt: new Date(), byUserId: me.userId, byName: me.name };
  if (body.action === 'recommend') {
    if (def.id !== 'mgr_recommend') throw new LifecycleError(400, 'Only the recommendation takes an outcome');
    const outcome = body.outcome === 'extend' ? 'extend' : body.outcome === 'confirm' ? 'confirm' : null;
    if (!outcome) throw new LifecycleError(400, 'outcome is confirm or extend');
    if (j.probation?.decision) throw new LifecycleError(409, 'HR has decided already');
    const answered = approvalOf(j);
    if (answered && answered.outcome === 'approved') throw new LifecycleError(409, 'The head of department has approved already');
    const note = cleanNote(body.note);
    await setTick(j, def.id, { ...by, outcome, ...(note ? { note } : {}) }, {
      set: { 'probation.recommendation': { outcome, ...(note ? { note } : {}), byUserId: me.userId, byName: me.name, at: by.doneAt } },
      // A new recommendation after "Ask to discuss": the head of department answers again.
      unset: answered ? ['probation.hodApproval', 'teamTasks.hod_approve'] : [],
    });
  } else if (body.action === 'done') {
    if (def.id === 'mgr_recommend') throw new LifecycleError(400, 'Recommend with an outcome');
    await setTick(j, def.id, by);
  } else if (body.action === 'undo') {
    if (def.id === 'mgr_recommend') {
      if (approvalOf(j)) throw new LifecycleError(409, 'The head of department has answered already');
      if (j.probation?.decision) throw new LifecycleError(409, 'HR has decided already');
      await setTick(j, def.id, null, { unset: ['probation.recommendation'] });
    } else {
      await setTick(j, def.id, null);
    }
  } else {
    throw new LifecycleError(400, 'action is done, undo or recommend');
  }
  return teamJoiner(me, journeyId);
}

/**
 * POST /lifecycle/team/joiners/:journeyId/approval — `{ action: 'approve' | 'discuss', comment }`, the head
 * of department only. Onto the confirmation record (HR sees it by their decision) and HR is told.
 */
export async function answerApproval(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, approver } = await connectedJourney(me, journeyId);
  if (!approver) throw new LifecycleError(403, 'Only the head of department approves');
  if (!recommendationOf(j)) throw new LifecycleError(409, 'Waiting for the manager’s recommendation');
  if (j.probation?.decision) throw new LifecycleError(409, 'HR has decided already');
  const before = approvalOf(j);
  if (before && before.outcome === 'approved') throw new LifecycleError(409, 'Approved already');
  const outcome = body.action === 'approve' ? 'approved' : body.action === 'discuss' ? 'discuss' : null;
  if (!outcome) throw new LifecycleError(400, 'action is approve or discuss');
  const comment = cleanNote(body.comment);
  const at = new Date();
  await setTick(j, 'hod_approve', { doneAt: at, byUserId: me.userId, byName: me.name, outcome, ...(comment ? { note: comment } : {}) }, {
    set: { 'probation.hodApproval': { outcome, ...(comment ? { comment } : {}), byUserId: me.userId, byName: me.name, at } },
  });
  // HR records the decision: the joiner's HR contact hears, as when the final month starts.
  const joiner = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, hrPrimaryUserId: 1 } }) : null;
  const name = joiner?.name ?? j.candidate?.name ?? 'the joiner';
  await tell([joiner?.hrPrimaryUserId], {
    scenario: 'lifecycle_confirmation_window_hr',
    title: `Decide on ${name}'s probation`,
    body: outcome === 'approved'
      ? `${me.name} approved the manager’s recommendation. Confirm or extend on the Onboarding board.`
      : `${me.name} asked to discuss the recommendation${comment ? `: ${comment}` : ''}.`,
    data: { journeyId: j.id },
  });
  return approvalView(await loadJourney(j.id));
}
