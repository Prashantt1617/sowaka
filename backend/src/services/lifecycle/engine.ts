/**
 * The lifecycle task engine: journeys snapshot a template, materialise its
 * tasks, open and date them by rule, and keep the derived state (stage,
 * plant, flags, board column) that every surface reads.
 *
 * Signatures follow ENGINE-API.md exactly; BE-offer and Offboarding call only
 * these exports and never write `lifecycle_journey_tasks` themselves.
 *
 * Rules (handover §1.3 §3): a task stores its rule (on the snapshot) and its
 * resolved dates; open tasks are re-dated whenever an anchor moves; done,
 * skipped and cancelled tasks never move; an owner whose due date changed is
 * told once per change.
 */
import { randomUUID } from 'node:crypto';
import { companies, journeys, journeyTasks, lifecycleMeetings, offers, users } from '../../config/db';
import type {
  CandidateDetails, DueRule, ExitType, Journey, JourneyFlag, JourneyTask, JourneyTaskStatus, LifecyclePhase,
  OffboardingStatus, OnboardingBoardColumn, OnboardingBoardTab, OnboardingStage, OnboardingStatus, OwnerRole,
  PlantState, SystemTaskKey, TaskKind, TaskSurface, TemplateTask,
} from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { notifyUsers } from '../notification.service';
import { scriptForcesFeatures } from './scriptScope';
import {
  addDaysKey, companyTimeZone, dateKeyOf, dayDate, daysBetween, humanDay, isDateKey, keyOfDay, monthsOfRule,
  probationMonthEnd, probationMonthOn, probationMonthStart, resolveRuleWith, todayKey, workCalendar,
  type RuleAnchors, type WorkCalendar,
} from './dueRules';
import { LifecycleError } from './errors';
import { templateForJourney } from './templates';

export { LifecycleError };

// ─── Feature switch ─────────────────────────────────────────────────────────

const FEATURE_TTL_MS = 30_000;
const featureCache = new Map<string, { at: number; on: boolean }>();

/** `companies.features.lifecycle`, kept for half a minute. */
export async function lifecycleEnabled(org: string | undefined): Promise<boolean> {
  if (!org) return false;
  if (scriptForcesFeatures(org)) return true;
  const kept = featureCache.get(org);
  if (kept && Date.now() - kept.at < FEATURE_TTL_MS) return kept.on;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  const on = company?.features?.lifecycle === true;
  featureCache.set(org, { at: Date.now(), on });
  return on;
}

/** For checks that switch the feature and look again at once. */
export function forgetLifecycleFeature(): void {
  featureCache.clear();
}

export async function requireLifecycle(org: string | undefined): Promise<void> {
  if (!(await lifecycleEnabled(org))) throw new LifecycleError(404, 'Not available');
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

export interface TaskView {
  id: string; systemKey?: SystemTaskKey; phase: LifecyclePhase; title: string; helper?: string;
  ownerRole: OwnerRole; ownerName?: string; kind: TaskKind; surface: TaskSurface; mustDo: boolean;
  status: JourneyTaskStatus; opensAt?: string | null; dueAt?: string | null; dueLabel?: string;
  doneAt?: string; doneByName?: string; note?: string; late: boolean; month?: number;
}

export type Viewer = 'hr' | 'manager' | 'employee' | `team:${'it' | 'admin' | 'finance'}`;

export const OPEN_STATUSES: JourneyTaskStatus[] = ['locked', 'todo', 'in_review', 'sent_back'];
export const ACTIVE_STATUSES: JourneyTaskStatus[] = ['todo', 'in_review', 'sent_back'];
const FINISHED: JourneyTaskStatus[] = ['done', 'skipped', 'cancelled'];

/** Tasks that never count towards progress, lateness or waiting-on. */
const OPTIONAL_KEYS = new Set<SystemTaskKey>(['new_joining_date']);
export const isCounted = (task: Pick<JourneyTask, 'ownerRole' | 'systemKey' | 'status'>) =>
  task.ownerRole !== 'automatic' && !(task.systemKey && OPTIONAL_KEYS.has(task.systemKey)) && task.status !== 'cancelled';

const JOINED: Array<Journey['status']> = ['joined', 'moved_to_app', 'confirmed'];
export const isJoined = (j: Pick<Journey, 'status' | 'userId'>) => JOINED.includes(j.status) && !!j.userId;
const CLOSED_ONBOARDING: Array<Journey['status']> = ['declined', 'expired', 'not_joining'];

function strip<T extends object>(doc: T & { _id?: unknown }): T {
  const { _id, ...rest } = doc;
  return rest as T;
}

export async function loadJourney(journeyId: string): Promise<Journey> {
  const doc = await journeys().findOne({ id: journeyId });
  if (!doc) throw new LifecycleError(404, 'Journey not found');
  return strip(doc);
}

export async function tasksOf(journeyId: string): Promise<JourneyTask[]> {
  const rows = await journeyTasks().find({ journeyId }).sort({ order: 1, month: 1 }).toArray();
  return rows.map(strip);
}

export function totalProbationMonths(j: Pick<Journey, 'probation' | 'templateSnapshot'>): number {
  const base = j.probation?.months ?? j.templateSnapshot.settings.probationMonths ?? 6;
  return base + (j.probation?.extendedBy ?? 0);
}

function anchorsOf(j: Journey): RuleAnchors {
  return { tj: j.tj, tl: j.tl, ...j.anchors };
}

function templateTaskOf(j: Journey, task: Pick<JourneyTask, 'templateTaskId'>): TemplateTask | undefined {
  return j.templateSnapshot.tasks.find((t) => t.id === task.templateTaskId);
}

const MANAGER_ROLES: OwnerRole[] = ['manager', 'manager_employee', 'hr_manager'];

function ownerFor(role: OwnerRole, j: Journey): string | undefined {
  if (role === 'employee') return j.userId;
  if (MANAGER_ROLES.includes(role)) return j.managerUserId;
  return undefined;
}

// ─── Materialising ──────────────────────────────────────────────────────────

/** Whether a template task runs: switched on, and (if recommended) added. */
const runs = (t: TemplateTask) => t.enabled && (!t.recommended || t.recommended.added);

function monthsFor(t: TemplateTask, total: number): Array<number | undefined> {
  const months = monthsOfRule(t.opensRule, total) ?? monthsOfRule(t.dueRule, total);
  if (months) return months;
  // A task that waits for a month task of its own belongs to those months too (the monthly review).
  return [undefined];
}

function newTask(j: Journey, t: TemplateTask, month: number | undefined): JourneyTask {
  const title = month && t.systemKey !== 'confirmation_discussion' ? `${t.title} · month ${month}` : t.title;
  return {
    id: randomUUID(), org: j.org, journeyId: j.id, templateTaskId: t.id,
    ...(t.systemKey ? { systemKey: t.systemKey } : {}),
    phase: t.phase, title, ...(t.helper ? { helper: t.helper } : {}),
    ownerRole: t.ownerRole, ...(ownerFor(t.ownerRole, j) ? { ownerUserId: ownerFor(t.ownerRole, j) } : {}),
    kind: t.kind, surface: t.surface, mustDo: t.mustDo, order: t.order,
    ...(month ? { month } : {}),
    status: 'locked', opensAt: null, dueAt: null, ...(t.dueLabel ? { dueLabel: t.dueLabel } : {}),
  };
}

/**
 * Brings the month tasks in line with the probation length: missing months
 * are added, months past the end (open ones) cancelled. Done tasks stay.
 */
function syncMonthTasks(j: Journey, tasks: JourneyTask[]): { added: JourneyTask[]; cancelled: string[] } {
  const total = totalProbationMonths(j);
  const added: JourneyTask[] = [];
  const cancelled: string[] = [];
  for (const t of j.templateSnapshot.tasks) {
    if (!runs(t)) continue;
    const months = monthsOfRule(t.opensRule, total) ?? monthsOfRule(t.dueRule, total);
    if (!months) continue;
    const mine = tasks.filter((task) => task.templateTaskId === t.id);
    for (const month of months) {
      if (!mine.some((task) => task.month === month)) added.push(newTask(j, t, month));
    }
    for (const task of mine) {
      if (task.month && !months.includes(task.month) && OPEN_STATUSES.includes(task.status)) cancelled.push(task.id);
    }
  }
  return { added, cancelled };
}

function materialise(j: Journey): JourneyTask[] {
  const total = totalProbationMonths(j);
  const out: JourneyTask[] = [];
  for (const t of j.templateSnapshot.tasks) {
    if (!runs(t)) continue;
    for (const month of monthsFor(t, total)) out.push(newTask(j, t, month));
  }
  return out;
}

// ─── Dating and opening ─────────────────────────────────────────────────────

/** The task this one waits for (the same month's, else the latest), if any. */
function dependencyOf(task: JourneyTask, t: TemplateTask | undefined, tasks: JourneyTask[]): JourneyTask | undefined {
  if (!t?.after) return undefined;
  const candidates = tasks
    .filter((other) => other.systemKey === t.after!.key && other.status !== 'cancelled' && other.id !== task.id)
    .filter((other) => !task.month || !other.month || other.month === task.month);
  if (!candidates.length) return undefined;
  return candidates.reduce((a, b) => ((b.month ?? 0) >= (a.month ?? 0) ? b : a));
}

function dependencyMet(task: JourneyTask, t: TemplateTask | undefined, tasks: JourneyTask[]): boolean {
  if (!t?.after) return true;
  const dep = dependencyOf(task, t, tasks);
  if (!dep) return true; // the task it waits for is not in this template: nothing to wait for
  if (t.after.when === 'started') return ['in_review', 'sent_back', 'done'].includes(dep.status);
  return dep.status === 'done' || dep.status === 'skipped';
}

const sameDay = (a?: Date | null, b?: Date | null) => (a ? keyOfDay(a) : null) === (b ? keyOfDay(b) : null);

interface RecomputeResult {
  changed: JourneyTask[];
  /** Owners whose open task got a new due date. */
  dueMoved: Map<string, number>;
}

/**
 * Re-dates every open task from its rule and opens or locks it. Pure apart
 * from the inputs; the caller writes the changed tasks.
 */
function recomputeTasks(j: Journey, tasks: JourneyTask[], calendar: WorkCalendar, now: Date, extra: { offerValidTill?: string }): RecomputeResult {
  const tz = companyTimeZone(j.org);
  const today = todayKey(now, tz);
  const anchors = anchorsOf(j);
  const total = totalProbationMonths(j);
  const changed = new Set<JourneyTask>();
  const dueMoved = new Map<string, number>();
  // Two passes: a task finished in the first may open its dependants in the second.
  for (let pass = 0; pass < 3; pass += 1) {
    let any = false;
    for (const task of tasks) {
      if (FINISHED.includes(task.status)) continue;
      const t = templateTaskOf(j, task);
      const ctx = { org: j.org, calendar, probationMonths: total, month: task.month, timeZone: tz };
      const opensAt = t?.opensRule ? resolveRuleWith(t.opensRule, anchors, ctx) : null;
      let dueAt: Date | null | undefined = t?.dueRule ? resolveRuleWith(t.dueRule, anchors, ctx) : task.dueAt;
      if (task.systemKey === 'accept_offer' && !t?.dueRule && extra.offerValidTill) dueAt = dayDate(extra.offerValidTill);
      if (!sameDay(opensAt, task.opensAt)) { task.opensAt = opensAt; changed.add(task); any = true; }
      if (!sameDay(dueAt ?? null, task.dueAt ?? null)) {
        const hadDate = !!task.dueAt;
        task.dueAt = dueAt ?? null;
        changed.add(task); any = true;
        if (hadDate && t?.dueRule) {
          task.dueChangedAt = now;
          if (task.ownerUserId && task.ownerRole !== 'automatic') dueMoved.set(task.ownerUserId, (dueMoved.get(task.ownerUserId) ?? 0) + 1);
        }
      }
      if (task.status !== 'locked' && task.status !== 'todo') continue;
      const opened = dependencyMet(task, t, tasks) && (t?.opensRule ? !!opensAt && keyOfDay(opensAt) <= today : true);
      if (task.ownerRole === 'automatic') {
        // Time-driven automatic steps (the Day-1 pass, Week 1 done) happen when their day comes;
        // event-driven ones (the reveal) wait for whoever completes them; informational ones stay put.
        if (opened && t?.opensRule) {
          task.status = 'done'; task.doneAt = now; task.doneByName = 'Automatic';
          changed.add(task); any = true;
          continue;
        }
        const next: JourneyTaskStatus = opened && t?.after ? 'todo' : 'locked';
        if (next !== task.status) { task.status = next; changed.add(task); any = true; }
        continue;
      }
      // A dependency only ever opens a task: once open (by the rule or by an explicit reopenTask)
      // it goes back to locked only when its own opening day moves into the future.
      const notYetDay = !!t?.opensRule && (!opensAt || keyOfDay(opensAt) > today);
      const next: JourneyTaskStatus = task.status === 'todo' ? (notYetDay ? 'locked' : 'todo') : opened ? 'todo' : 'locked';
      if (next !== task.status) { task.status = next; changed.add(task); any = true; }
    }
    if (!any) break;
  }
  return { changed: [...changed], dueMoved };
}

async function offerValidTill(journeyId: string): Promise<string | undefined> {
  const offer = await offers().findOne({ journeyId }, { projection: { _id: 0, versions: 1 } });
  const current = offer?.versions?.at(-1);
  return current?.fields?.validTill && isDateKey(current.fields.validTill) ? current.fields.validTill : undefined;
}

async function calendarFor(j: Journey): Promise<WorkCalendar> {
  return workCalendar(j.org, { userId: j.userId, location: j.location });
}

async function writeTasks(tasks: JourneyTask[]): Promise<void> {
  if (!tasks.length) return;
  await journeyTasks().bulkWrite(tasks.map((task) => ({ replaceOne: { filter: { id: task.id }, replacement: task, upsert: true } })));
}

async function tellDueMoved(j: Journey, dueMoved: Map<string, number>): Promise<void> {
  const who = j.candidate?.name ?? (j.userId ? (await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }))?.name : undefined) ?? 'a joiner';
  for (const [userId, count] of dueMoved) {
    const self = userId === j.userId;
    await tell([userId], {
      scenario: 'lifecycle_due_changed',
      destination: self ? 'lifecycle_onboarding' : 'lifecycle_joiner',
      title: 'New due dates',
      body: self
        ? `${count === 1 ? 'One of your tasks has' : `${count} of your tasks have`} a new due date.`
        : `${count === 1 ? 'One task' : `${count} tasks`} for ${who} ${count === 1 ? 'has' : 'have'} a new due date.`,
      data: { journeyId: j.id },
    });
  }
}

/** Where the app opens a lifecycle notification (`data.destination`; mobile-app onboarding_launcher.dart). */
export type Destination =
  | 'lifecycle_onboarding' | 'lifecycle_meeting' | 'lifecycle_starter_task' | 'lifecycle_notes' | 'lifecycle_week1'
  | 'lifecycle_intro' | 'lifecycle_people' | 'lifecycle_survey' | 'lifecycle_probation' | 'lifecycle_checkin' | 'lifecycle_reveal'
  | 'lifecycle_joiner' | 'lifecycle_joiner_setup' | 'lifecycle_starter_task_done' | 'lifecycle_probation_review';

/**
 * Every push of the lifecycle goes through here: a delivery failure never fails the write.
 * Stored and pushed as `{ scenario, title, body, data: { destination, journeyId, …ids } }` (all data values strings).
 */
export async function tell(userIds: Array<string | undefined>, input: { scenario: `lifecycle_${string}`; title: string; body: string; destination?: Destination; data: Record<string, string> }): Promise<void> {
  const ids = userIds.filter((id): id is string => !!id);
  if (!ids.length) return;
  const { destination, ...rest } = input;
  try {
    await notifyUsers(ids, { ...rest, data: { ...input.data, ...(destination ? { destination } : {}) } });
  } catch (error) {
    logger.error('Lifecycle notification failed', { scenario: input.scenario }, error);
  }
}

// ─── Derived state ──────────────────────────────────────────────────────────

export interface Derived {
  stage: OnboardingStage;
  plant: PlantState;
  flags: JourneyFlag[];
  tab: OnboardingBoardTab;
  column: OnboardingBoardColumn;
  dayLabel: string;
  statusLabel: string;
  quietDays?: number;
  expiresInDays?: number;
}

export function taskLate(task: Pick<JourneyTask, 'status' | 'dueAt' | 'ownerRole' | 'systemKey'>, today: string): boolean {
  if (task.status !== 'todo' && task.status !== 'sent_back') return false;
  if (!isCounted({ ...task, status: task.status })) return false;
  return !!task.dueAt && keyOfDay(task.dueAt) < today;
}

const doneOrSkipped = (task?: JourneyTask) => !!task && (task.status === 'done' || task.status === 'skipped');
const byKey = (tasks: JourneyTask[], key: SystemTaskKey) => tasks.filter((t) => t.systemKey === key && t.status !== 'cancelled');
const keyDone = (tasks: JourneyTask[], key: SystemTaskKey) => {
  const list = byKey(tasks, key);
  return list.length > 0 && list.every(doneOrSkipped);
};

export function currentMonth(j: Journey, today: string): number {
  if (!j.tj) return 0;
  return probationMonthOn(j.tj, today, totalProbationMonths(j));
}

export function dayLabelFor(j: Journey, today: string): string {
  if (CLOSED_ONBOARDING.includes(j.status)) return j.status === 'declined' ? 'Declined' : j.status === 'expired' ? 'Expired' : 'Not joining';
  if (!j.tj) return '—';
  if (j.status === 'confirmed') return 'Confirmed';
  if (!isJoined(j)) {
    const toGo = daysBetween(today, j.tj);
    // Before the joining day it reads as time to go, never a negative day.
    return toGo > 1 ? `In ${toGo} days` : toGo === 1 ? 'Tomorrow' : 'Day 1';
  }
  const d = daysBetween(j.tj, today);
  if (d <= 0) return 'Day 1';
  if (today <= probationMonthEnd(j.tj, 1)) return `Week ${Math.floor(d / 7) + 1}`;
  return `Month ${currentMonth(j, today)}`;
}

const STAGE_NAMES: Record<OnboardingStage, string> = {
  pre_boarding: 'Pre-boarding', welcome_week1: 'Welcome', settling_in: 'Settling in', growing_gains: 'Growing gains',
  final_month: 'Final month', ready_to_perform: 'Ready to perform',
};
export const stageName = (stage: OnboardingStage) => STAGE_NAMES[stage];

export function deriveJourney(j: Journey, tasks: JourneyTask[], now: Date, extra: { offerValidTill?: string } = {}): Derived {
  const tz = companyTimeZone(j.org);
  const today = todayKey(now, tz);
  const total = totalProbationMonths(j);
  const joined = isJoined(j);
  const confirmed = j.status === 'confirmed';
  const tj = j.tj;
  const d = tj ? daysBetween(tj, today) : -1;
  const month = currentMonth(j, today);
  const live = tasks.filter((t) => t.status !== 'cancelled');

  // Stage
  let stage: OnboardingStage = 'pre_boarding';
  if (joined && tj) {
    if (confirmed) stage = 'ready_to_perform';
    else if (d < 7) stage = 'welcome_week1';
    else if (month >= total && total > 1) stage = 'final_month';
    else if (month <= 1) stage = 'settling_in';
    else stage = 'growing_gains';
  }

  // Plant
  let plantStage: PlantState['stage'] = 0;
  if (joined && tj) {
    if (confirmed) plantStage = 5;
    else if (total > 1 && today >= probationMonthStart(tj, total)) plantStage = 4;
    else if (today > probationMonthEnd(tj, 1)) plantStage = 3;
    else if (d >= 7) plantStage = 2;
    else plantStage = 1;
  }
  const water = joined ? 3 : (['upload_documents', 'about_you', 'sign_letters'] as SystemTaskKey[]).filter((k) => keyDone(live, k)).length;
  const closedCycles = new Set(
    live.filter((t) => t.systemKey === 'monthly_review' && t.status === 'done' && t.month)
      .map((t) => t.month!)
      .filter((m) => live.some((c) => c.systemKey === 'monthly_checkin' && c.month === m && c.status === 'done')),
  ).size;
  // A leaf is earned (done), never given for a group that was skipped or closed unfinished.
  const keyEarned = (k: SystemTaskKey) => byKey(live, k).length > 0 && byKey(live, k).every((t) => t.status === 'done');
  const leaves = (['week1_reels', 'people_to_meet', 'day7_survey'] as SystemTaskKey[]).filter(keyEarned).length + closedCycles;
  const late = live.filter((t) => taskLate(t, today));
  const droop = late.some((t) => t.ownerRole === 'employee' || t.ownerRole === 'manager_employee');
  const plant: PlantState = { stage: plantStage, water: Math.min(3, water) as PlantState['water'], leaves, droop };

  // Tab and column
  let tab: OnboardingBoardTab = 'pre_boarding';
  let column: OnboardingBoardColumn = 'offer_sent';
  if (!joined) {
    if (j.status === 'draft' || j.status === 'offer_sent') column = 'offer_sent';
    else if (j.status === 'accepted') column = 'accepted';
    else if (keyDone(live, 'sign_letters')) column = 'ready_to_join';
    else if (j.status === 'docs_approved' || keyDone(live, 'review_documents')) column = 'letters';
    else column = 'documents';
  } else if (d < 7 && !confirmed) {
    tab = 'first_week';
    const weekDone = (['week1_reels', 'intro_post', 'day7_survey'] as SystemTaskKey[]).every((k) => !byKey(live, k).length || keyDone(live, k));
    if (d <= 0) column = 'day1';
    else if (weekDone) column = 'week_done';
    else if (d >= 6) column = 'day7_survey';
    else column = 'week1_tasks';
  } else {
    tab = 'probation';
    if (confirmed) column = 'confirmed';
    else if (month >= total) column = 'final_month';
    else if (month <= 1) column = 'month1';
    else column = 'months_2_5';
  }

  // Flags
  const flags: JourneyFlag[] = [];
  const active = live.filter((t) => ACTIVE_STATUSES.includes(t.status) && isCounted(t));
  const soon = addDaysKey(today, 2);
  if (active.some((t) => (t.ownerRole === 'hr' || t.ownerRole === 'hr_manager') && (!t.dueAt || keyOfDay(t.dueAt) <= soon))) flags.push('needs_you');
  if (late.length) flags.push('late');
  let quietDays: number | undefined;
  let expiresInDays: number | undefined;
  if (!joined && !CLOSED_ONBOARDING.includes(j.status)) {
    const since = j.lastActivityAt ?? j.anchors.finalised;
    const waitingOnCandidate = active.some((t) => t.ownerRole === 'employee' && t.surface === 'portal' && t.status !== 'in_review');
    if (since && ['finalised', 'active', 'docs_approved'].includes(j.status) && waitingOnCandidate) {
      const idle = daysBetween(dateKeyOf(since, tz), today);
      if (idle >= 3) { flags.push('quiet'); quietDays = idle; }
    }
    if (tj && today >= addDaysKey(tj, -5) && byKey(live, 'upload_documents').some((t) => !doneOrSkipped(t))) flags.push('joining_risk');
    if (j.status === 'offer_sent' && extra.offerValidTill) {
      const left = daysBetween(today, extra.offerValidTill);
      if (left >= 0 && left <= 4) { flags.push('expires_soon'); expiresInDays = left; }
    }
    if (column === 'ready_to_join' && !active.some((t) => t.ownerRole !== 'automatic' && t.systemKey !== 'mark_joined' && isCounted(t))) flags.push('all_set');
  }
  // From Tj + 5 (week-1 tasks due), anything of the joiner's due by today and still open needs attention.
  const dueByToday = (t: JourneyTask) => !!t.dueAt && keyOfDay(t.dueAt) <= today && (t.ownerRole === 'employee' || t.ownerRole === 'manager_employee');
  if (joined && tab === 'first_week' && tj && today >= addDaysKey(tj, 5) && (late.some((t) => t.phase === 'first_week') || active.some((t) => t.phase === 'first_week' && dueByToday(t)))) flags.push('needs_attention');
  if (j.probation?.decision?.outcome === 'not_confirm') flags.push('needs_attention');
  if (tab === 'probation' && !confirmed && !late.length && active.some((t) => t.phase === 'probation' && t.dueAt && keyOfDay(t.dueAt) >= today && keyOfDay(t.dueAt) <= addDaysKey(today, 3))) flags.push('due_soon');
  if (column === 'final_month' && byKey(live, 'confirmation_discussion').some((t) => ACTIVE_STATUSES.includes(t.status))) flags.push('decide');
  if (column === 'week_done') flags.push('done');
  if (confirmed) flags.push('confirmed');

  // Labels
  const dayLabel = dayLabelFor(j, today);
  const human = (at?: Date) => (at ? humanDay(dateKeyOf(at, tz)) : '');
  let statusLabel: string;
  switch (j.status) {
    case 'draft': statusLabel = 'Offer not sent'; break;
    case 'offer_sent': statusLabel = `Offer sent ${human(j.anchors.offer_sent)}`.trim(); break;
    case 'accepted': statusLabel = `Accepted ${human(j.anchors.accepted)}`.trim(); break;
    case 'declined': statusLabel = 'Declined'; break;
    case 'expired': statusLabel = 'Offer expired'; break;
    case 'not_joining': statusLabel = 'Not joining'; break;
    case 'confirmed': statusLabel = `Confirmed ${human(j.probation?.decision?.decidedAt)}`.trim(); break;
    default:
      if (!joined && tj) {
        const toGo = daysBetween(today, tj);
        statusLabel = `Joins ${humanDay(tj)}${toGo > 0 ? ` · ${toGo} ${toGo === 1 ? 'day' : 'days'} to go` : ''}`;
      } else {
        statusLabel = stage === 'welcome_week1' ? dayLabel : `${dayLabel} · ${STAGE_NAMES[stage]}`;
      }
  }
  return { stage, plant, flags, tab, column, dayLabel, statusLabel, ...(quietDays !== undefined ? { quietDays } : {}), ...(expiresInDays !== undefined ? { expiresInDays } : {}) };
}

// ─── Views ──────────────────────────────────────────────────────────────────

export async function namesOf(userIds: Array<string | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const rows = await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  return new Map(rows.map((row) => [row.userId, row.name]));
}

export function taskView(task: JourneyTask, j: Pick<Journey, 'org' | 'candidate' | 'userId'>, names: Map<string, string>, now = new Date()): TaskView {
  const today = todayKey(now, companyTimeZone(j.org));
  const ownerName = task.ownerUserId ? names.get(task.ownerUserId) : task.ownerRole === 'employee' ? j.candidate?.name : undefined;
  const dueLabel = task.dueAt ? humanDay(keyOfDay(task.dueAt)) : task.dueLabel;
  return {
    id: task.id, ...(task.systemKey ? { systemKey: task.systemKey } : {}), phase: task.phase, title: task.title,
    ...(task.helper ? { helper: task.helper } : {}), ownerRole: task.ownerRole, ...(ownerName ? { ownerName } : {}),
    kind: task.kind, surface: task.surface, mustDo: task.mustDo, status: task.status,
    opensAt: task.opensAt ? task.opensAt.toISOString() : null, dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    ...(dueLabel ? { dueLabel } : {}),
    ...(task.doneAt ? { doneAt: task.doneAt.toISOString() } : {}), ...(task.doneByName ? { doneByName: task.doneByName } : {}),
    ...(task.note ? { note: task.note } : {}), late: taskLate(task, today), ...(task.month ? { month: task.month } : {}),
  };
}

const VISIBLE: Record<string, OwnerRole[]> = {
  manager: ['manager', 'manager_employee', 'employee', 'hr_manager'],
  employee: ['employee', 'manager_employee'],
  'team:it': ['it'], 'team:admin': ['admin'], 'team:finance': ['finance'],
};

/**
 * The Day-1 items someone else does that the joiner still sees on their day (6Zs §5.3 A2 Day 1:
 * Welcome and induction, Company vision and culture, Laptop and login, Meet your team): shown
 * read-only ("HR does this"), counted toward the day, never ticked by the joiner. Custom
 * first-week meetings of HR's or the manager's count too.
 */
const JOINER_READ_ONLY_KEYS = new Set<SystemTaskKey>(['welcome_induction', 'vision_culture', 'laptop_setup', 'meet_team']);
export function joinerSeesReadOnly(task: Pick<JourneyTask, 'ownerRole' | 'status' | 'systemKey' | 'phase' | 'kind'>): boolean {
  if (task.status === 'cancelled' || task.phase !== 'first_week') return false;
  if (task.ownerRole === 'employee' || task.ownerRole === 'manager_employee' || task.ownerRole === 'automatic') return false;
  if (task.systemKey) return JOINER_READ_ONLY_KEYS.has(task.systemKey);
  return task.kind === 'meeting';
}

export function visibleTo(viewer: Viewer, task: Pick<JourneyTask, 'ownerRole' | 'status'>): boolean {
  if (viewer === 'hr') return true;
  if (task.status === 'cancelled') return false;
  return (VISIBLE[viewer] ?? []).includes(task.ownerRole);
}

/** Tasks as a viewer sees them (see ENGINE-API.md). */
export async function journeyTasksView(journeyId: string, viewer: Viewer): Promise<TaskView[]> {
  const j = await loadJourney(journeyId);
  const tasks = (await tasksOf(journeyId)).filter((t) => visibleTo(viewer, t));
  const names = await namesOf([...tasks.map((t) => t.ownerUserId)]);
  const now = new Date();
  return tasks.map((t) => taskView(t, j, names, now));
}

// ─── Writing a journey ──────────────────────────────────────────────────────

async function recomputeAndSave(j: Journey, tasks: JourneyTask[], opts: { now?: Date; tellOwners?: boolean } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const [calendar, validTill] = await Promise.all([calendarFor(j), j.kind === 'onboarding' ? offerValidTill(j.id) : Promise.resolve(undefined)]);
  const { changed, dueMoved } = recomputeTasks(j, tasks, calendar, now, { offerValidTill: validTill });
  await writeTasks(changed);
  if (opts.tellOwners && dueMoved.size) await tellDueMoved(j, dueMoved);
}

/** Recomputes flags, plant, stage, board column/tab (and re-dates open tasks). Cheap; call after any change. */
export async function refreshJourney(journeyId: string, now = new Date()): Promise<Journey> {
  const j = await loadJourney(journeyId);
  const tasks = await tasksOf(journeyId);
  if (!j.closedAt) await recomputeAndSave(j, tasks, { now });
  const set: Partial<Journey> = { updatedAt: now };
  if (j.kind === 'onboarding') {
    const derived = deriveJourney(j, tasks, now, { offerValidTill: await offerValidTill(j.id) });
    Object.assign(set, { stage: derived.stage, plant: derived.plant, flags: derived.flags, boardTab: derived.tab, boardColumn: derived.column });
  } else {
    const today = todayKey(now, companyTimeZone(j.org));
    set.flags = tasks.some((t) => taskLate(t, today)) ? ['late'] : [];
  }
  await journeys().updateOne({ id: journeyId }, { $set: set });
  return { ...j, ...set };
}

function cleanCandidate(input: unknown): CandidateDetails {
  const c = (input ?? {}) as Record<string, unknown>;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  const personalEmail = typeof c.personalEmail === 'string' ? c.personalEmail.trim().toLowerCase() : '';
  if (!name || name.length > 120) throw new LifecycleError(400, "The candidate's name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) throw new LifecycleError(400, "The candidate's personal email is not valid");
  const out: CandidateDetails = { name, personalEmail };
  if (typeof c.phone === 'string' && c.phone.trim()) out.phone = c.phone.trim().slice(0, 20);
  if (typeof c.workEmail === 'string' && c.workEmail.trim()) out.workEmail = c.workEmail.trim().toLowerCase();
  return out;
}

async function requireColleague(org: string, userId: string | undefined, what: string): Promise<void> {
  if (!userId) return;
  const user = await users().findOne({ userId, org }, { projection: { _id: 1 } });
  if (!user) throw new LifecycleError(400, `The ${what} is not someone at this company`);
}

/** Status 'draft'; snapshots the template (default onboarding template when templateId is absent); materialises every enabled task (locked until its opens rule passes). */
export async function createOnboardingJourney(org: string, byUserId: string, input: {
  candidate: CandidateDetails; tj: string; managerUserId?: string; designation?: string;
  department?: string; location?: string; templateId?: string; offerId?: string;
}): Promise<Journey> {
  if (!isDateKey(input.tj)) throw new LifecycleError(400, 'The joining date must be YYYY-MM-DD');
  const candidate = cleanCandidate(input.candidate);
  await requireColleague(org, input.managerUserId, 'manager');
  const template = await templateForJourney(org, 'onboarding', input.templateId);
  const now = new Date();
  const j: Journey = {
    id: randomUUID(), org, kind: 'onboarding', candidate,
    ...(input.managerUserId ? { managerUserId: input.managerUserId } : {}),
    templateId: template.id,
    templateSnapshot: structuredClone({ name: template.name, settings: template.settings, tasks: template.tasks }),
    status: 'draft', stage: 'pre_boarding', tj: input.tj, anchors: {},
    ...(input.offerId ? { offerId: input.offerId } : {}),
    ...(input.designation ? { designation: input.designation.trim().slice(0, 120) } : {}),
    ...(input.department ? { department: input.department.trim().slice(0, 120) } : {}),
    ...(input.location ? { location: input.location.trim().slice(0, 120) } : {}),
    plant: { stage: 0, water: 0, leaves: 0, droop: false },
    probation: { months: template.settings.probationMonths ?? 6 },
    createdAt: now, createdByUserId: byUserId, updatedAt: now,
  };
  const tasks = materialise(j);
  await journeys().insertOne({ ...j });
  await recomputeAndSave(j, tasks, { now });
  await writeTasks(tasks);
  return refreshJourney(j.id, now);
}

const IMPLIED_ANCHOR: Partial<Record<Journey['status'], 'offer_sent' | 'accepted' | 'finalised'>> = {
  offer_sent: 'offer_sent', accepted: 'accepted', finalised: 'finalised',
};
const IMPLIED_DONE: Partial<Record<Journey['status'], SystemTaskKey[]>> = {
  offer_sent: ['send_offer'], accepted: ['accept_offer'], finalised: ['finalise_offer'], active: ['portal_sign_in'],
  docs_approved: ['upload_documents', 'review_documents'],
};

/** Sets the status, stamps the event anchor it implies (offer_sent / accepted / finalised), merges `extra`, recomputes dates + flags. */
export async function setJourneyStatus(journeyId: string, status: OnboardingStatus | OffboardingStatus, extra: Partial<Journey> = {}): Promise<Journey> {
  const j = await loadJourney(journeyId);
  const now = new Date();
  const { id: _id, org: _org, kind: _kind, templateSnapshot: _snap, anchors: extraAnchors, ...rest } = extra;
  const set: Record<string, unknown> = { ...rest, status, updatedAt: now };
  const anchor = IMPLIED_ANCHOR[status];
  if (anchor) set[`anchors.${anchor}`] = now;
  if (extraAnchors) for (const [key, value] of Object.entries(extraAnchors)) if (value) set[`anchors.${key}`] = value;
  await journeys().updateOne({ id: journeyId }, { $set: set });
  // A revised offer sent again: the candidate accepts it, and HR finalises it, again.
  if (status === 'offer_sent' && j.status !== 'draft') {
    // Finalising waits for the new acceptance, not the old one.
    await journeys().updateOne({ id: journeyId }, { $unset: { 'anchors.accepted': '' } });
    for (const key of ['accept_offer', 'finalise_offer'] as SystemTaskKey[]) await reopenQuietly(journeyId, key);
  }
  for (const key of IMPLIED_DONE[status] ?? []) await finishQuietly(journeyId, key, { name: 'Automatic' });
  return refreshJourney(journeyId, now);
}

export async function setAnchor(journeyId: string, anchor: 'offer_sent' | 'accepted' | 'finalised' | 'exit_accepted', at: Date): Promise<void> {
  await loadJourney(journeyId);
  await journeys().updateOne({ id: journeyId }, { $set: { [`anchors.${anchor}`]: at, updatedAt: new Date() } });
  await refreshJourney(journeyId);
}

async function moveAnchorDay(journeyId: string, field: 'tj' | 'tl', day: string): Promise<void> {
  if (!isDateKey(day)) throw new LifecycleError(400, `${field === 'tj' ? 'The joining date' : 'The last working day'} must be YYYY-MM-DD`);
  const j = await loadJourney(journeyId);
  if (j[field] === day) return;
  const moved: Journey = { ...j, [field]: day };
  await journeys().updateOne({ id: journeyId }, { $set: { [field]: day, updatedAt: new Date() } });
  const tasks = await tasksOf(journeyId);
  await recomputeAndSave(moved, tasks, { tellOwners: true });
  await refreshJourney(journeyId);
}

/** Moves Tj; every open (not done/skipped/cancelled) task's opensAt/dueAt is recomputed; owners whose due date changed are told once. */
export async function moveTj(journeyId: string, tj: string): Promise<void> {
  await moveAnchorDay(journeyId, 'tj', tj);
}
export async function moveTl(journeyId: string, tl: string): Promise<void> {
  await moveAnchorDay(journeyId, 'tl', tl);
}

function pickOpen(tasks: JourneyTask[], key: SystemTaskKey): JourneyTask | undefined {
  return tasks
    .filter((t) => t.systemKey === key && OPEN_STATUSES.includes(t.status))
    .sort((a, b) => (a.month ?? 0) - (b.month ?? 0) || a.order - b.order)[0];
}

function finish(task: JourneyTask, status: 'done' | 'skipped', by?: { userId?: string; name?: string }, note?: string): JourneyTask {
  return {
    ...task, status, doneAt: new Date(),
    ...(by?.userId ? { doneByUserId: by.userId } : {}), ...(by?.name ? { doneByName: by.name } : {}),
    ...(note !== undefined ? { note: note.slice(0, 1000) } : {}),
  };
}

async function finishQuietly(journeyId: string, key: SystemTaskKey, by?: { userId?: string; name?: string }, status: 'done' | 'skipped' = 'done'): Promise<void> {
  const task = pickOpen(await tasksOf(journeyId), key);
  if (task) await writeTasks([finish(task, status, by)]);
}

async function reopenQuietly(journeyId: string, key: SystemTaskKey): Promise<void> {
  const tasks = (await tasksOf(journeyId)).filter((t) => t.systemKey === key && (t.status === 'done' || t.status === 'skipped'));
  const task = tasks.at(-1);
  if (!task) return;
  const { doneAt: _a, doneByUserId: _b, doneByName: _c, ...rest } = task;
  await writeTasks([{ ...rest, status: 'locked' }]);
}

/** Marks the journey's task with that systemKey done (no-op if already done). Returns the task or null if the journey has none. */
export async function completeTask(journeyId: string, systemKey: SystemTaskKey, by?: { userId?: string; name?: string }, note?: string): Promise<JourneyTask | null> {
  const tasks = await tasksOf(journeyId);
  const task = pickOpen(tasks, systemKey);
  if (!task) return tasks.filter((t) => t.systemKey === systemKey).at(-1) ?? null;
  const done = finish(task, 'done', by, note);
  await writeTasks([done]);
  await refreshJourney(journeyId);
  return (await journeyTasks().findOne({ id: done.id }, { projection: { _id: 0 } })) ?? done;
}

/**
 * A task that does not apply to this journey (offboarding: gratuity under 5 years), skipped
 * whether or not it has opened yet, with a note saying why. Must-do tasks are never skipped.
 */
export async function skipTask(journeyId: string, systemKey: SystemTaskKey, by?: { userId?: string; name?: string }, note?: string): Promise<JourneyTask | null> {
  const task = pickOpen(await tasksOf(journeyId), systemKey);
  if (!task || task.mustDo) return null;
  const skipped = finish(task, 'skipped', by, note);
  await writeTasks([skipped]);
  await refreshJourney(journeyId);
  return skipped;
}

/** One task by id: done or skipped (skip refused for must-do), with a note. */
export async function finishTaskById(journeyId: string, taskId: string, action: 'done' | 'skip', by?: { userId?: string; name?: string }, note?: string): Promise<JourneyTask> {
  const task = await journeyTasks().findOne({ id: taskId, journeyId }, { projection: { _id: 0 } });
  if (!task) throw new LifecycleError(404, 'Task not found');
  if (action === 'skip' && task.mustDo) throw new LifecycleError(409, 'A must-do task cannot be skipped');
  if (task.status === 'cancelled') throw new LifecycleError(409, 'This task was cancelled');
  if (task.status === 'done' || task.status === 'skipped') return task;
  if (task.status === 'locked') throw new LifecycleError(409, 'This task has not opened yet');
  await writeTasks([finish(task, action === 'skip' ? 'skipped' : 'done', by, note)]);
  await refreshJourney(journeyId);
  return (await journeyTasks().findOne({ id: taskId }, { projection: { _id: 0 } }))!;
}

/**
 * Back to todo (or sent_back when `sentBack`), with an HR note. Also opens a
 * locked task (BE-offer opens the letters when the last document is
 * approved). The task is re-dated from its rule, so a date that moved while
 * it was done applies.
 */
export async function reopenTask(journeyId: string, systemKey: SystemTaskKey, note?: string, sentBack?: boolean): Promise<JourneyTask | null> {
  const tasks = (await tasksOf(journeyId)).filter((t) => t.systemKey === systemKey && t.status !== 'cancelled');
  const task = tasks.find((t) => t.status === 'in_review' || t.status === 'sent_back') ?? tasks.filter((t) => t.status === 'done' || t.status === 'skipped').at(-1) ?? tasks[0];
  if (!task) return null;
  return reopenTaskById(journeyId, task.id, note, sentBack);
}

export async function reopenTaskById(journeyId: string, taskId: string, note?: string, sentBack?: boolean): Promise<JourneyTask> {
  const task = await journeyTasks().findOne({ id: taskId, journeyId }, { projection: { _id: 0 } });
  if (!task) throw new LifecycleError(404, 'Task not found');
  if (task.status === 'cancelled') throw new LifecycleError(409, 'This task was cancelled');
  const { doneAt: _a, doneByUserId: _b, doneByName: _c, ...rest } = task;
  await writeTasks([{ ...rest, status: sentBack ? 'sent_back' : 'todo', ...(note !== undefined ? { note: note.slice(0, 1000) } : {}) }]);
  await refreshJourney(journeyId);
  return (await journeyTasks().findOne({ id: taskId }, { projection: { _id: 0 } }))!;
}

export async function setTaskInReview(journeyId: string, systemKey: SystemTaskKey): Promise<JourneyTask | null> {
  const task = pickOpen(await tasksOf(journeyId), systemKey);
  if (!task) return null;
  await writeTasks([{ ...task, status: 'in_review' }]);
  await refreshJourney(journeyId);
  return journeyTasks().findOne({ id: task.id }, { projection: { _id: 0 } });
}

/** Sets a task's due date by hand (a starter task's date, which the manager sets). */
export async function setTaskDue(journeyId: string, systemKey: SystemTaskKey, dueAt: Date | null): Promise<void> {
  const task = pickOpen(await tasksOf(journeyId), systemKey);
  if (task) await writeTasks([{ ...task, dueAt }]);
}

/** Re-points the manager-owned tasks when the manager changes (open ones only). */
export async function reassignManager(journeyId: string, managerUserId: string | undefined): Promise<void> {
  const tasks = (await tasksOf(journeyId)).filter((t) => MANAGER_ROLES.includes(t.ownerRole) && OPEN_STATUSES.includes(t.status));
  await writeTasks(tasks.map((t) => {
    const { ownerUserId: _o, ...rest } = t;
    return managerUserId ? { ...rest, ownerUserId: managerUserId } : rest;
  }));
}

/** After Mark joined: binds userId, resolves employee-owned tasks to the user, status 'joined', stage welcome_week1, plant sprout. */
export async function onJoined(journeyId: string, userId: string): Promise<void> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding') throw new LifecycleError(400, 'Not an onboarding journey');
  const user = await users().findOne({ userId, org: j.org }, { projection: { _id: 0, userId: 1, managerUserId: 1, location: 1 } });
  if (!user) throw new LifecycleError(404, 'Employee not found');
  const offer = await offers().findOne({ journeyId }, { projection: { _id: 0, versions: 1 } });
  const offeredMonths = offer?.versions?.at(-1)?.fields?.probationMonths;
  const months = Number.isInteger(offeredMonths) && offeredMonths! >= 1 && offeredMonths! <= 12 ? offeredMonths! : j.probation?.months ?? 6;
  const now = new Date();
  const managerUserId = j.managerUserId ?? user.managerUserId;
  const set: Partial<Journey> = {
    userId, status: 'joined', stage: 'welcome_week1', updatedAt: now,
    probation: { ...(j.probation ?? { months }), months },
    plant: { stage: 1, water: 3, leaves: j.plant?.leaves ?? 0, droop: false },
    ...(managerUserId ? { managerUserId } : {}),
    ...(!j.location && user.location ? { location: user.location } : {}),
  };
  await journeys().updateOne({ id: journeyId }, { $set: set });
  const joined: Journey = { ...j, ...set };
  const tasks = await tasksOf(journeyId);
  for (const task of tasks) {
    if (task.ownerRole === 'employee' && OPEN_STATUSES.includes(task.status)) task.ownerUserId = userId;
    if (managerUserId && MANAGER_ROLES.includes(task.ownerRole) && OPEN_STATUSES.includes(task.status)) task.ownerUserId = managerUserId;
  }
  const { added, cancelled } = syncMonthTasks(joined, tasks);
  for (const task of tasks) if (cancelled.includes(task.id)) task.status = 'cancelled';
  for (const task of added) {
    if (task.ownerRole === 'employee') task.ownerUserId = userId;
    if (managerUserId && MANAGER_ROLES.includes(task.ownerRole)) task.ownerUserId = managerUserId;
  }
  const all = [...tasks, ...added];
  const markJoined = pickOpen(all, 'mark_joined');
  if (markJoined) Object.assign(markJoined, finish(markJoined, 'done', { name: 'HR' }));
  const newDate = pickOpen(all, 'new_joining_date');
  if (newDate) Object.assign(newDate, finish(newDate, 'skipped', { name: 'Automatic' }));
  await writeTasks(all);
  await syncDay1Meetings(journeyId);
  await refreshJourney(journeyId, now);
}

/** Declined / expired / not joining / withdrawn: cancels open tasks, stamps closedAt + reason, sets the status. */
export async function closeJourney(journeyId: string, status: OnboardingStatus | OffboardingStatus, reason?: string): Promise<void> {
  await loadJourney(journeyId);
  await journeyTasks().updateMany({ journeyId, status: { $in: OPEN_STATUSES } }, { $set: { status: 'cancelled' } });
  const now = new Date();
  await journeys().updateOne({ id: journeyId }, { $set: { status, closedAt: now, updatedAt: now, ...(reason ? { closedReason: reason.slice(0, 300) } : {}) } });
  await refreshJourney(journeyId, now);
}

/**
 * A declined or expired journey brought back (BE-offer's reopen): closedAt and
 * the reason go, the tasks the close cancelled come back (re-dated and opened
 * by their rules), done tasks stay done.
 */
export async function reopenJourney(journeyId: string, status: OnboardingStatus | OffboardingStatus): Promise<Journey> {
  const j = await loadJourney(journeyId);
  if (!j.closedAt) throw new LifecycleError(409, 'This journey is not closed');
  const total = totalProbationMonths(j);
  await journeyTasks().updateMany(
    { journeyId, status: 'cancelled', $or: [{ month: { $exists: false } }, { month: { $lte: total } }] },
    { $set: { status: 'locked' } },
  );
  await journeys().updateOne({ id: journeyId }, { $set: { status, updatedAt: new Date() }, $unset: { closedAt: '', closedReason: '' } });
  return refreshJourney(journeyId);
}

const RESIGNATION_STEPS: SystemTaskKey[] = ['send_resignation', 'manager_resignation_action', 'hr_accept_exit'];

/** Snapshot of the default (or given) offboarding template; anchors tl and exit_accepted = now; status 'accepted'. */
export async function createOffboardingJourney(org: string, userId: string, tl: string, exitType: ExitType, byUserId: string, templateId?: string): Promise<Journey> {
  if (!isDateKey(tl)) throw new LifecycleError(400, 'The last working day must be YYYY-MM-DD');
  const user = await users().findOne({ userId, org }, { projection: { _id: 0, userId: 1, managerUserId: 1, location: 1, designation: 1, department: 1 } });
  if (!user) throw new LifecycleError(404, 'Employee not found');
  const open = await journeys().findOne({ org, userId, kind: 'offboarding', closedAt: { $exists: false } }, { projection: { _id: 0, id: 1 } });
  if (open) throw new LifecycleError(409, 'This person already has an exit in progress');
  const template = await templateForJourney(org, 'offboarding', templateId);
  const now = new Date();
  const j: Journey = {
    id: randomUUID(), org, kind: 'offboarding', userId,
    ...(user.managerUserId ? { managerUserId: user.managerUserId } : {}),
    templateId: template.id,
    templateSnapshot: structuredClone({ name: template.name, settings: template.settings, tasks: template.tasks }),
    status: 'accepted', tl, anchors: { exit_accepted: now }, exitType,
    ...(user.designation ? { designation: user.designation } : {}),
    ...(user.department ? { department: user.department } : {}),
    ...(user.location ? { location: user.location } : {}),
    createdAt: now, createdByUserId: byUserId, updatedAt: now,
  };
  const tasks = materialise(j);
  // The journey starts at Accepted: what led here is already behind it.
  for (const task of tasks) {
    if (!task.systemKey) continue;
    if (exitType === 'resignation') {
      if (RESIGNATION_STEPS.includes(task.systemKey)) Object.assign(task, finish(task, 'done', { name: 'Automatic' }));
      if (task.systemKey === 'hr_start_exit') Object.assign(task, finish(task, 'skipped', { name: 'Automatic' }));
    } else {
      if (task.systemKey === 'hr_start_exit') Object.assign(task, finish(task, 'done', { userId: byUserId, name: 'HR' }));
      if (RESIGNATION_STEPS.includes(task.systemKey)) Object.assign(task, finish(task, 'skipped', { name: 'Automatic' }));
    }
  }
  await journeys().insertOne({ ...j });
  await recomputeAndSave(j, tasks, { now });
  await writeTasks(tasks);
  return refreshJourney(j.id, now);
}

/** A draft whose template changed: nothing is done yet, so its tasks start again from the new snapshot. */
export async function rematerialiseDraft(journeyId: string): Promise<void> {
  const j = await loadJourney(journeyId);
  if (j.status !== 'draft') throw new LifecycleError(409, 'Only a draft can change template');
  await journeyTasks().deleteMany({ journeyId });
  const tasks = materialise(j);
  await recomputeAndSave(j, tasks);
  await writeTasks(tasks);
}

/** Probation length changed (extension): adds the new months' tasks, cancels open ones past the end. */
export async function syncProbationTasks(journeyId: string): Promise<void> {
  const j = await loadJourney(journeyId);
  const tasks = await tasksOf(journeyId);
  const { added, cancelled } = syncMonthTasks(j, tasks);
  for (const task of added) {
    if (task.ownerRole === 'employee' && j.userId) task.ownerUserId = j.userId;
    if (MANAGER_ROLES.includes(task.ownerRole) && j.managerUserId) task.ownerUserId = j.managerUserId;
  }
  const changed = [...added, ...tasks.filter((t) => cancelled.includes(t.id)).map((t) => ({ ...t, status: 'cancelled' as const }))];
  await writeTasks(changed);
  await refreshJourney(journeyId);
}

// ─── Day-1 meetings ─────────────────────────────────────────────────────────

const MEETING_MATCH: Array<[RegExp, SystemTaskKey]> = [
  [/manager|1:1|one.on.one/i, 'meet_manager'],
  [/team/i, 'meet_team'],
  [/induction|welcome/i, 'welcome_induction'],
  [/vision|culture/i, 'vision_culture'],
];

/** Local wall-clock time on a day, as an instant (company time zone; India has no DST). */
export function localInstant(day: string, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return new Date(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00+05:30`);
}

/**
 * The joining day's timed items come from the Day-1 pass agenda HR fills: one
 * meeting per agenda line, tied to its task by name (the manager 1:1, the team
 * intro, induction, the culture session). Re-run when the pass changes; a
 * meeting already marked met is left alone.
 */
export async function syncDay1Meetings(journeyId: string): Promise<void> {
  const j = await loadJourney(journeyId);
  if (!j.userId || !j.tj || !j.day1Pass?.agenda?.length) return;
  const day = j.day1Pass.date && isDateKey(j.day1Pass.date) ? j.day1Pass.date : j.tj;
  const tasks = await tasksOf(journeyId);
  for (const item of j.day1Pass.agenda) {
    const startsAt = localInstant(day, item.time);
    if (!startsAt || !item.title) continue;
    const key = MEETING_MATCH.find(([re]) => re.test(item.title))?.[1];
    const task = key ? tasks.find((t) => t.systemKey === key) : undefined;
    const attendees = [j.userId, ...(key === 'meet_manager' || key === 'meet_team' ? [j.managerUserId] : [])].filter((id): id is string => !!id);
    const filter = { journeyId, title: item.title.slice(0, 120) };
    const existing = await lifecycleMeetings().findOne(filter, { projection: { _id: 0 } });
    if (existing?.met) continue;
    // The room stays when the line names a person too ("Room 4B · with Neha R.").
    const place = j.day1Pass.place;
    const withWho = item.with?.trim().slice(0, 120);
    await lifecycleMeetings().updateOne(filter, {
      $set: {
        startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), attendeeUserIds: attendees,
        ...(task ? { journeyTaskId: task.id } : {}), ...(place ? { place } : {}), ...(j.day1Pass.meetingLink ? { link: j.day1Pass.meetingLink } : {}),
        ...(withWho ? { with: withWho } : {}),
      },
      $setOnInsert: { id: randomUUID(), org: j.org, journeyId },
      ...(existing && existing.startsAt.getTime() !== startsAt.getTime() ? { $unset: { remindedAt: '' } } : {}),
    }, { upsert: true });
  }
}

export function sanitiseJourney(j: Journey): Omit<Journey, 'templateSnapshot'> {
  const { templateSnapshot: _s, ...rest } = j;
  if (rest.bankPfRequest) {
    const { accountNumberEnc: _a, uanEnc: _u, ...changes } = rest.bankPfRequest.changes;
    rest.bankPfRequest = { ...rest.bankPfRequest, changes };
  }
  return rest;
}

export type { DueRule };
