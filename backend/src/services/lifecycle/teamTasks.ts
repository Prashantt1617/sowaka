/**
 * The team side's shared reading of a joiner (24 Nov): who is connected to whom (the one approver of the
 * confirmation, the manager, the buddy, the line), where a joiner is (Before Day 1, Day 1, Week 1,
 * Month 1…Month n, Confirmed), and the template's team rows as HR's dashboard panel reads them.
 *
 * The team rows are rows of HR's onboarding template (`TemplateTask.team`, seed.ts teamSeed), read from
 * the journey's template as it is now, so HR's edits apply at once; a template without any (not migrated
 * yet) uses the seed's. They never become journey tasks: ticks live on the journey (`journey.teamTasks`,
 * by the row's team key). HR assigns and follows every one of them on the dashboard: the manager, the
 * buddy and the head of department have no task page in the app any more (the old Teams › Joiners
 * `/lifecycle/team/joiners*` routes answer 404), only the confirmation review and approval (teamApp.ts).
 */
import { companies, journeys, lifecycleTemplates, users } from '../../config/db';
import type { DueRule, Journey, OwnerRole, SystemTaskKey, TeamTaskKind, TeamTaskSpec, TeamTaskTick, TemplateTask } from '../../models/lifecycle.model';
import { addDaysKey, daysBetween, probationMonthOn } from './dueRules';
import { isJoined, totalProbationMonths } from './engine';
import { teamSeed } from './seed';

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

export const OPEN_ONBOARDING = { kind: 'onboarding', closedAt: { $exists: false }, status: { $nin: ['draft', 'offer_sent', 'accepted', 'declined', 'expired', 'not_joining'] } } as const;

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

// ─── Writes ─────────────────────────────────────────────────────────────────

/** A team row's tick on the journey (also the joiner's Mark as met on a paired meeting, joinerMeetings.ts). */
export async function setTick(j: Pick<Journey, 'id'>, id: string, tick: TeamTaskTick | null, extra: { set?: Record<string, unknown>; unset?: string[] } = {}): Promise<void> {
  const $set: Record<string, unknown> = { updatedAt: new Date(), ...(tick ? { [`teamTasks.${id}`]: tick } : {}), ...(extra.set ?? {}) };
  const $unset: Record<string, ''> = Object.fromEntries([...(tick ? [] : [`teamTasks.${id}`]), ...(extra.unset ?? [])].map((k) => [k, '' as const]));
  await journeys().updateOne({ id: j.id }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) } as never);
}
