/**
 * Offboarding (employee lifecycle), on top of the live exits.
 *
 * The exit itself stays what People › Exits records (`user.exit`, exit.service):
 * HR accepting a resignation, or starting an exit, calls `recordExit` and then
 * creates the offboarding journey from the offboarding template (engine.ts).
 * What the journey adds is kept beside it on `user.exit.offboarding` (how it
 * started, the journey, the app page, the handover note, the settlement email,
 * the timed jobs that fired) and in two collections: `lifecycle_resignations`
 * (resignations.ts) and `lifecycle_handover_items`.
 *
 * Who sees what (6Zs §1.3 §6): HR sees everything; a manager sees the reason
 * and note and the handover, never pay; IT, Admin and Finance staff (people
 * given only the offboarding tab) see their own team's clearance items and no
 * money (Finance sees the amount open on its own item). Exit interview answers
 * are HR's alone and show only anonymised in Exit insights.
 *
 * The board's columns are worked out on every read from the exit, the
 * resignation, the journey's tasks, the handover and the settlement; nothing
 * about a column is stored.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { companies, exitSettlements, handoverItems, journeyTasks, journeys, lifecycleFiles, lifecycleTemplates, payslips, resignations, surveyResponses, users } from '../../config/db';
import { payrollPeriodHolding } from '../payroll-inputs.service';
import { AdminError } from '../admin.service';
import { clearanceOf, endAccess, exitView, readInterview, recordExit, tickClearanceItem } from '../exit.service';
import { policyForUser } from '../shift.service';
import { serviceYears, settlementFor } from '../exitSettlement.service';
import { notifyUsers } from '../notification.service';
import { istParts } from '../notification-time';
import { hasReceiptStorage, presignReceiptDownload, uploadEmployeeDocument } from '../s3-receipt.service';
import { logger } from '../../utils/logger';
import type { HandoverItem, Journey, JourneyTask, Resignation, SurveyResponse, SystemTaskKey } from '../../models/lifecycle.model';
import type { ExitSettlement } from '../../models/exitSettlement.model';
import {
  CLEARANCE_TEAMS, DEFAULT_EXIT_CLEARANCE, ClearanceTeam, ExitKind, ExitRules, OffboardingExitType, OffboardingNoticeHandling, User, UserExit, UserExitOffboarding,
} from '../../models/user.model';
import { closeJourney, completeTask, createOffboardingJourney, journeyTasksView, moveTl, reopenTask, setJourneyStatus, skipTask } from './engine';
import type { TaskView } from './engine';
import { orgMayEmail, sendLifecycleEmail, smtpConfigured } from './emails';
import { scopedUsers, scriptForcesFeatures } from './scriptScope';
import { env } from '../../config/env';

/** Answers with its status and message (the routes send `{ error, message }`). */
export class LifecycleError extends AdminError {}

// ———————————————————————————————————————————————— dates (IST)

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const todayKey = (now: Date) => istParts(now).dateKey;
export const keyOfInstant = (d: Date | null | undefined) => (d ? istParts(new Date(d)).dateKey : null);
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysFromTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const isDateKey = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
/** Working days after a date: Saturday and Sunday off (the engine's own rule, with holidays, wins where its task has a date). */
export function addWorkingDays(key: string, n: number): string {
  let d = Date.parse(`${key}T00:00:00Z`);
  for (let left = n; left > 0;) { d += DAY; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return new Date(d).toISOString().slice(0, 10);
}
/** "Mon 26 Jan" */
export const shortDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
/** "Mon 26 Jan 2026" */
export const longDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
export const firstName = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'They';

// ———————————————————————————————————————————————— who is asking

export type Viewer =
  | { kind: 'hr'; seesPay: boolean; canAct: boolean }
  | { kind: 'team'; team: Exclude<ClearanceTeam, 'manager'> | null; seesPay: boolean; canAct: false };

export interface Actor { userId: string; org: string; name: string; viewer: Viewer }

const PAY_TABS = ['payruns', 'salarydetails'];

/** A company with the lifecycle switched on, else 404 "Not available" (CONTRACT decision 3). */
export async function requireLifecycleOrg(org: string | undefined): Promise<string> {
  if (!org) throw new LifecycleError(404, 'Not available');
  if (scriptForcesFeatures(org)) return org;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  if (company?.features?.lifecycle !== true) throw new LifecycleError(404, 'Not available');
  return org;
}

/** IT / Admin / Finance from the person's department name, when HR has not set `clearanceTeam`. */
export function teamOfDepartment(department: string | undefined): Exclude<ClearanceTeam, 'manager'> | null {
  const d = (department ?? '').toLowerCase();
  if (/\b(it|tech|technology|systems|infra)\b/.test(d)) return 'it';
  if (/financ|account/.test(d)) return 'finance';
  if (/\badmin/.test(d) || /facilit/.test(d)) return 'admin';
  return null;
}

/**
 * Someone on the dashboard. HR: an admin, anyone never limited to some tabs, or someone who also
 * holds People › Employees (where exits live). Everyone else with the offboarding tab is clearance
 * staff for their team. HR's actions that record an exit still need a dashboard admin (recordExit).
 */
export async function dashboardActor(userId: string): Promise<Actor> {
  const u = await users().findOne({ userId }, { projection: { _id: 0, userId: 1, org: 1, name: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1, department: 1, clearanceTeam: 1 } });
  if (!u?.org || u.dashboardAccess !== true) throw new LifecycleError(403, 'You do not have HR dashboard access');
  await requireLifecycleOrg(u.org);
  const all = u.dashboardAdmin === true || !Array.isArray(u.dashboardTabs);
  const tabs = new Set(u.dashboardTabs ?? []);
  const seesPay = all || PAY_TABS.some((t) => tabs.has(t));
  if (all || tabs.has('employees')) return { userId, org: u.org, name: u.name, viewer: { kind: 'hr', seesPay, canAct: true } };
  return { userId, org: u.org, name: u.name, viewer: { kind: 'team', team: u.clearanceTeam ?? teamOfDepartment(u.department), seesPay, canAct: false } };
}

export function requireHr(actor: Actor, what = 'Only HR can do this'): void {
  if (actor.viewer.kind !== 'hr') throw new LifecycleError(403, what);
}

/** An employee in the app, at a company with the lifecycle on. */
export async function appUser(userId: string): Promise<User & { org: string }> {
  const u = await users().findOne({ userId }, { projection: { _id: 0, profilePhotoUrl: 0 } });
  if (!u?.org) throw new LifecycleError(404, 'Not available');
  await requireLifecycleOrg(u.org);
  return u as User & { org: string };
}

// ———————————————————————————————————————————————— exit types, notice, templates

export const EXIT_TYPES: OffboardingExitType[] = ['resignation', 'retirement', 'end_of_contract', 'termination', 'absconding'];
export const EXIT_TYPE_LABEL: Record<OffboardingExitType, string> = { resignation: 'Resignation', retirement: 'Retirement', end_of_contract: 'End of contract', termination: 'Termination', absconding: 'Absconding' };
/** End of contract has no kind of its own on the live exits: it records as 'other' (its rules: no notice lines, access the day after). */
export const KIND_OF: Record<OffboardingExitType, ExitKind> = { resignation: 'resigned', retirement: 'retired', end_of_contract: 'other', termination: 'terminated', absconding: 'absconded' };
const KIND_LABEL: Record<ExitKind, string> = { resigned: 'Resignation', retired: 'Retirement', terminated: 'Termination', absconded: 'Absconding', other: 'Other' };
const TYPE_OF_KIND: Partial<Record<ExitKind, OffboardingExitType>> = { resigned: 'resignation', retired: 'retirement', terminated: 'termination', absconded: 'absconding' };
export const NOTICE_HANDLING: OffboardingNoticeHandling[] = ['served', 'not_applicable', 'waived', 'recovered', 'paid_in_lieu'];

export const exitTypeOf = (e: UserExit): OffboardingExitType | null => e.offboarding?.exitType ?? TYPE_OF_KIND[e.kind] ?? null;
export const exitTypeLabel = (e: UserExit) => (e.offboarding ? EXIT_TYPE_LABEL[e.offboarding.exitType] : KIND_LABEL[e.kind]);

/** The default offboarding template (a template's settings win over the company's Exit settings). */
export async function defaultOffboardingTemplate(org: string) {
  return lifecycleTemplates().findOne({ org, kind: 'offboarding', isDefault: true, active: { $ne: false } }, { projection: { _id: 0 } });
}

/** Days of notice for a resignation: the default offboarding template, else the company's Exit settings, else 30. */
export async function noticeDaysFor(org: string): Promise<number> {
  const template = await defaultOffboardingTemplate(org);
  if (typeof template?.settings?.noticeDays === 'number') return template.settings.noticeDays;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNoticeDays: 1 } });
  return typeof company?.exitNoticeDays === 'number' ? company.exitNoticeDays : 30;
}

/** Whether the app shows the Off-boarding page: the template's list when it has one, else on except for terminations and abscondings. */
export function appPageDefault(type: OffboardingExitType, appPageFor?: OffboardingExitType[]): boolean {
  if (Array.isArray(appPageFor)) return appPageFor.includes(type);
  return type !== 'termination' && type !== 'absconding';
}

/** The notice choice of O2, as the exit's own rules (the rest stays the company's rules for the kind). */
export function rulesForNotice(type: OffboardingExitType, handling: OffboardingNoticeHandling | undefined): Partial<ExitRules> | undefined {
  switch (handling) {
    case 'waived': return { noticePay: 'none', noticeRecovery: 'none' };
    case 'recovered': return { noticeRecovery: type === 'absconding' ? 'whole_notice' : 'days_not_served' };
    case 'paid_in_lieu': return { noticePay: 'pay', noticeRecovery: 'none' };
    default: return undefined;
  }
}

/** The exit interview is part of resignations and retirements, and of HR-started exits whose page is on (not end of contract). */
export const interviewApplies = (ob: UserExitOffboarding | undefined) => !!ob && ob.showAppPage && ob.exitType !== 'end_of_contract';

function tenureBand(joined: Date | undefined, to: string): SurveyResponse['tenureBand'] {
  if (!joined) return undefined;
  const years = daysFromTo(istParts(joined).dateKey, to) / 365.25;
  return years < 1 ? '<1y' : years < 2 ? '1-2y' : years < 5 ? '2-5y' : '5y+';
}

// ———————————————————————————————————————————————— notifications

async function tell(userIds: (string | undefined)[], scenario: string, title: string, body: string, data: Record<string, string> = {}, email?: { subject: string; body: string }) {
  try {
    await notifyUsers(userIds.filter((x): x is string => !!x), { scenario, title, body, data: { type: 'lifecycle_offboarding', ...data }, ...(email ? { email } : {}) });
  } catch (error) {
    logger.warn('Offboarding: a notification could not be sent', { scenario, reason: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Where the app opens an offboarding push (`data.destination`; mobile-app
 * lib/features/lifecycle/offboarding/offboarding_launcher.dart), beside the onboarding ones (engine.ts):
 * - `lifecycle_resignation_request` the manager's Team › Requests, on that resignation's card (`resignationId`, `userId`)
 * - `lifecycle_resignation` the leaver's own Resignation tab (R2a / R2b)
 * - `lifecycle_offboarding` Action › Off-boarding (R3); `lifecycle_handover` R3 with the handover (R3b) open
 * - `lifecycle_exit_interview` the exit interview (R5)
 * - `lifecycle_leaver` the manager's Resignation tab on the leaver's profile (R8b; `userId`)
 * - `lifecycle_clearance` the dashboard's Offboarding board: nothing to open in the app
 */
export type OffboardingDestination =
  | 'lifecycle_resignation_request' | 'lifecycle_resignation' | 'lifecycle_offboarding' | 'lifecycle_handover'
  | 'lifecycle_exit_interview' | 'lifecycle_leaver' | 'lifecycle_clearance';

/** Every offboarding push: `{ scenario, title, body, data: { type, destination, …ids } }` (all data values strings). */
export async function tellOffboarding(
  userIds: (string | undefined)[], scenario: `lifecycle_${string}`, destination: OffboardingDestination, title: string, body: string,
  data: Record<string, string | undefined> = {}, type: 'lifecycle_offboarding' | 'lifecycle_resignation' = 'lifecycle_offboarding',
) {
  const clean = Object.fromEntries(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  try {
    await notifyUsers(userIds.filter((x): x is string => !!x), { scenario, title, body, data: { type, destination, ...clean } });
  } catch (error) {
    logger.warn('Offboarding: a notification could not be sent', { scenario, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The IT, Admin and Finance staff of a company: everyone limited to the offboarding tab without People (only one team's, when asked). */
async function clearanceStaff(org: string, team?: Exclude<ClearanceTeam, 'manager'>): Promise<string[]> {
  const rows = await users().find({ org, dashboardAccess: true, dashboardAdmin: { $ne: true }, dashboardTabs: 'offboarding', lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }, { projection: { _id: 0, userId: 1, dashboardTabs: 1, clearanceTeam: 1, department: 1 } }).toArray();
  return rows.filter((u) => !(u.dashboardTabs ?? []).includes('employees') && (!team || (u.clearanceTeam ?? teamOfDepartment(u.department)) === team)).map((u) => u.userId);
}

// ———————————————————————————————————————————————— starting an exit

export interface BeginInput {
  exitType: OffboardingExitType;
  lastWorkingDay: string;
  noticeFrom?: string;
  noticeDays?: number;
  note?: string;
  rules?: Partial<ExitRules>;
  newManagerUserId?: string;
  moveTeamNow?: boolean;
  templateId?: string;
  showAppPage?: boolean;
  noticeHandling?: OffboardingNoticeHandling;
  resignationId?: string;
  tellManagerNow: boolean;
  managerUserId?: string;
}

/**
 * The exit, recorded on the live exits, and its journey: the clearance list with a team per item,
 * the Off-boarding page (or not), and who is told. HR's own `recordExit` checks (a dashboard admin,
 * Exits on, sane dates, a successor for a team) come first, so nothing is written if they refuse.
 */
export async function beginOffboarding(hr: Actor, employee: User, input: BeginInput, now = new Date()) {
  const org = hr.org;
  const exit = await recordExit(hr.userId, employee.userId, {
    kind: KIND_OF[input.exitType],
    lastWorkingDay: input.lastWorkingDay,
    ...(input.noticeFrom ? { noticeFrom: input.noticeFrom } : {}),
    ...(input.noticeDays !== undefined ? { noticeDays: input.noticeDays } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.rules ? { rules: input.rules } : {}),
    ...(input.newManagerUserId ? { newManagerUserId: input.newManagerUserId } : {}),
    ...(input.moveTeamNow ? { moveTeamNow: true } : {}),
  }, now);
  const template = input.templateId ? await lifecycleTemplates().findOne({ id: input.templateId, org, kind: 'offboarding' }, { projection: { _id: 0, settings: 1 } }) : await defaultOffboardingTemplate(org);
  if (input.templateId && !template) logger.warn('Offboarding: the template asked for was not found; the default is used', { org });
  const journey = await createOffboardingJourney(org, employee.userId, input.lastWorkingDay, input.exitType, hr.userId, template && input.templateId ? input.templateId : undefined);
  if (input.managerUserId && input.managerUserId !== journey.managerUserId) await setJourneyStatus(journey.id, journey.status as Journey['status'], { managerUserId: input.managerUserId });
  const showAppPage = input.showAppPage ?? appPageDefault(input.exitType, template?.settings?.appPageFor);
  const offboarding: UserExitOffboarding = {
    exitType: input.exitType, journeyId: journey.id, showAppPage, fired: [],
    ...(input.resignationId ? { resignationId: input.resignationId } : {}),
    ...(input.noticeHandling ? { noticeHandling: input.noticeHandling } : {}),
  };
  const after = await users().findOne({ userId: employee.userId, org }, { projection: { _id: 0, exit: 1, lifecycleStatus: 1, managerUserId: 1 } });
  // Tell IT, Admin and Finance: each gets its clearance item (the existing keys, with a team each).
  const clearance = after?.exit?.clearance ?? DEFAULT_EXIT_CLEARANCE.map((c) => ({ ...c, done: false }));
  await users().updateOne({ userId: employee.userId, org }, { $set: { 'exit.offboarding': offboarding, 'exit.clearance': clearanceOf({ ...(after!.exit as UserExit), clearance }), updatedAt: now } });
  const by = { userId: hr.userId, name: hr.name };
  // HR-started exits begin at Accepted, so HR's accept task is done either way.
  await completeTask(journey.id, 'hr_accept_exit', by);
  if (!input.resignationId) await completeTask(journey.id, 'hr_start_exit', by);
  await completeTask(journey.id, 'tell_clearance_teams', by);
  if (showAppPage) await completeTask(journey.id, 'offboarding_page', by);
  await syncGratuityTask(journey.id, employee.joiningDate, input.lastWorkingDay);
  // The quiet door: someone leaving during onboarding or probation gets no plant, no probation pushes, no reveal.
  await closeOnboardingForExit(employee.userId, input.exitType);

  const first = firstName(employee.name);
  const managerId = input.managerUserId ?? after?.managerUserId ?? employee.managerUserId;
  if (showAppPage && after?.lifecycleStatus === 'notice') {
    await tellOffboarding([employee.userId], 'lifecycle_offboarding_open', 'lifecycle_resignation', input.resignationId ? 'Your resignation is accepted' : 'Your last day is set',
      `Your last working day is ${longDay(input.lastWorkingDay)}. See what to do before you go.`, { journeyId: journey.id, resignationId: input.resignationId });
  }
  if (input.tellManagerNow && managerId && managerId !== employee.userId) {
    await tellOffboarding([managerId], 'lifecycle_handover_checklist', 'lifecycle_leaver', `Handover for ${first}`, `${first}'s last day is ${shortDay(input.lastWorkingDay)}. Add the handover checklist and a note for ${first}.`, { userId: employee.userId, journeyId: journey.id });
  }
  await tellOffboarding(await clearanceStaff(org), 'lifecycle_clearance', 'lifecycle_clearance', `Clearance: ${employee.name}`, `Last day ${shortDay(input.lastWorkingDay)}. Your clearance item is on the Offboarding board.`, { userId: employee.userId });
  return { journeyId: journey.id, exit };
}

/** Completed years of service at the last day, from the settlement's own rule (exitSettlement.service). */
export function completedYears(joined: Date | string | undefined | null, tl: string): number | null {
  const key = joined ? keyOfInstant(new Date(joined)) : null;
  return key ? serviceYears(key, tl).completed : null;
}
export const GRATUITY_MIN_YEARS = 5;
const NOT_ELIGIBLE = /^Not eligible/;

/**
 * "Gratuity, if eligible" applies from 5 completed years (the settlement's rule): under that it is
 * skipped on its own with "Not eligible (n years)"; a last day that makes them eligible opens it again.
 */
export async function syncGratuityTask(journeyId: string, joined: Date | undefined, tl: string): Promise<void> {
  const years = completedYears(joined, tl);
  if (years === null) return;
  const task = await journeyTasks().findOne({ journeyId, systemKey: 'gratuity' }, { projection: { _id: 0, status: 1, note: 1 } });
  if (!task) return;
  if (years < GRATUITY_MIN_YEARS) {
    if (task.status !== 'done' && task.status !== 'skipped' && task.status !== 'cancelled') await skipTask(journeyId, 'gratuity', { name: 'Automatic' }, `Not eligible (${years} ${years === 1 ? 'year' : 'years'})`);
  } else if (task.status === 'skipped' && NOT_ELIGIBLE.test(task.note ?? '')) {
    await reopenTask(journeyId, 'gratuity', '');
  }
}

/**
 * An exit closes the person's onboarding journey, if one is still open (they resigned during probation, or
 * HR started their exit then): its open tasks are cancelled and the jobs, the Onboarding tile and tab, the
 * plant and the probation pushes stop. The status is kept (joined, moved to the app, confirmed but not yet
 * revealed) with the reason, so the onboarding board's history still says how far it got.
 */
export async function closeOnboardingForExit(userId: string, exitType: OffboardingExitType): Promise<string[]> {
  const open = await journeys().find({ userId, kind: 'onboarding', closedAt: { $exists: false } }, { projection: { _id: 0, id: 1, status: 1 } }).toArray();
  const closed: string[] = [];
  for (const j of open) {
    try {
      await closeJourney(j.id, j.status as Journey['status'], `Closed: ${EXIT_TYPE_LABEL[exitType].toLowerCase()} recorded before onboarding ended`);
      closed.push(j.id);
    } catch (error) {
      logger.warn('Offboarding: the onboarding journey could not be closed', { journeyId: j.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return closed;
}

// ———————————————————————————————————————————————— the board

export type BoardTab = 'resignations' | 'notice' | 'exit';
export type BoardColumn = 'with_manager' | 'with_hr' | 'accepted' | 'handover' | 'clearance' | 'exit_interview' | 'last_week' | 'last_day' | 'settlement_due' | 'settlement_sent' | 'closed';
export const COLUMNS: Record<BoardTab, Array<{ key: BoardColumn; label: string }>> = {
  resignations: [{ key: 'with_manager', label: 'With manager' }, { key: 'with_hr', label: 'With HR' }, { key: 'accepted', label: 'Accepted' }],
  notice: [{ key: 'handover', label: 'Handover' }, { key: 'clearance', label: 'Clearance' }, { key: 'exit_interview', label: 'Exit interview' }, { key: 'last_week', label: 'Last week' }],
  exit: [{ key: 'last_day', label: 'Last day today' }, { key: 'settlement_due', label: 'Settlement due' }, { key: 'settlement_sent', label: 'Settlement sent' }, { key: 'closed', label: 'Closed' }],
};
const TAB_OF = Object.fromEntries((Object.entries(COLUMNS) as [BoardTab, Array<{ key: BoardColumn }>][]).flatMap(([tab, cols]) => cols.map((c) => [c.key, tab]))) as Record<BoardColumn, BoardTab>;
const TRACK_STEP: Record<BoardColumn, number> = { with_manager: 0, with_hr: 1, accepted: 2, handover: 2, clearance: 2, exit_interview: 2, last_week: 3, last_day: 3, settlement_due: 4, settlement_sent: 4, closed: 6 };
export const TRACK = ['Resigned', 'Accepted', 'Notice', 'Last day', 'Settlement', 'Closed'];

export type OwnerRole = 'employee' | 'manager' | 'hr' | 'it' | 'admin' | 'finance' | 'payroll' | 'automatic' | 'done';
export interface Owner { role: OwnerRole; name?: string }
export interface Flag { key: 'needs_you' | 'late' | 'recovery' | 'all_clear' | 'closed'; label: string; tone: 'risk' | 'warn' | 'ok' }
export interface WaitingOn { owner: Owner; task: string; due: string | null; late: boolean }

export interface BoardCard {
  key: string;
  userId: string;
  resignationId?: string;
  journeyId?: string;
  name: string;
  employeeId: string;
  designation: string;
  department: string;
  exitType: OffboardingExitType | null;
  exitTypeLabel: string;
  tl: string | null;
  lastDayLine: string;
  nextStep: string;
  owner: Owner;
  due: string | null;
  late: boolean;
  flag: Flag | null;
  column: BoardColumn;
  tab: BoardTab;
  /** The next step is HR's: the sidebar counts these. */
  waitingOnHr: boolean;
  /** HR's Remind / Nudge for the card's next step, when someone else holds it (HR viewers only). */
  nudge?: NudgeOption;
}

/** A reminder HR can send from the board or the drawer: once per item per day. */
export interface NudgeOption { item: string; label: string; to: string; what: string; late: boolean; sentToday: boolean }

type BoardUser = Pick<User, 'userId' | 'name' | 'employeeId' | 'designation' | 'department' | 'managerUserId' | 'joiningDate' | 'exit' | 'personalEmail'>;
interface ExitCtx {
  user: BoardUser & { exit: UserExit };
  journey: Journey | null;
  tasks: JourneyTask[];
  handover: HandoverItem[];
  settlement: Pick<ExitSettlement, 'status' | 'lines' | 'payablePaise' | 'approvedAt' | 'paidAt'> | null;
  managerName?: string;
  resignation: Resignation | null;
}
interface Derived extends Omit<BoardCard, 'key' | 'userId' | 'name' | 'employeeId' | 'designation' | 'department'> {
  statusLabel: string;
  track: number;
  waitingOn: WaitingOn[];
}

const CLOSED: JourneyTask['status'][] = ['done', 'skipped', 'cancelled'];
const taskOf = (tasks: JourneyTask[], key: SystemTaskKey) => tasks.find((t) => t.systemKey === key);
const finished = (t: JourneyTask | undefined) => !!t && CLOSED.includes(t.status);
const dueOf = (t: JourneyTask | undefined) => keyOfInstant(t?.dueAt ?? null);
const TEAM_LABEL: Record<ClearanceTeam, string> = { manager: 'Manager', admin: 'Admin', it: 'IT', finance: 'Finance' };
const TEAM_TASK: Record<ClearanceTeam, SystemTaskKey> = { manager: 'mark_handover_done', admin: 'return_assets', it: 'return_assets', finance: 'finance_clearance' };

function flagFor(owner: Owner, due: string | null, today: string, extra: Flag | null): { flag: Flag | null; late: boolean } {
  const late = !!due && due < today;
  if (owner.role === 'hr') return { flag: { key: 'needs_you', label: 'Needs you', tone: late || due === today ? 'risk' : 'warn' }, late };
  if (late) return { flag: { key: 'late', label: 'Late', tone: 'risk' }, late };
  return { flag: extra, late };
}

/** A resignation still with the manager or with HR (no exit yet). */
export function deriveResignation(r: Resignation, managerName: string | undefined, name: string, today: string): Derived {
  const first = firstName(name);
  const submitted = keyOfInstant(r.submittedAt)!;
  if (r.status === 'with_manager') {
    const owner: Owner = { role: 'manager', name: managerName ? firstName(managerName) : 'Manager' };
    const due = addDays(submitted, 2);
    const { flag, late } = flagFor(owner, due, today, null);
    return {
      resignationId: r.id, exitType: 'resignation', exitTypeLabel: 'Resignation', tl: r.lastDayByNotice, lastDayLine: `Notice: ${r.noticeDays} days`,
      nextStep: `Manager to accept or talk to ${first}`, owner, due, late, flag, column: 'with_manager', tab: 'resignations', waitingOnHr: false,
      statusLabel: `Resigned ${shortDay(submitted)}`, track: 0, waitingOn: [{ owner, task: 'Accept, or agree another last day', due, late }],
    };
  }
  const owner: Owner = { role: 'hr', name: 'HR · you' };
  const actedOn = r.manager ? keyOfInstant(r.manager.at)! : submitted;
  const due = addDays(actedOn, 2);
  const asked = r.manager?.date;
  const nextStep = r.manager?.action === 'change_day' && asked ? `Confirm the new last day with ${first}`
    : r.manager?.action === 'release_early' && asked ? `Confirm the early release on ${shortDay(asked)}` : 'Accept and confirm the last day';
  const lastDayLine = r.manager?.action === 'change_day' && asked ? `Manager asked for ${shortDay(asked)}`
    : r.manager?.action === 'release_early' && asked ? `Early release: ${shortDay(asked)}` : `Last day ${shortDay(r.lastDayByNotice)}`;
  const statusLabel = !r.manager ? `Resigned ${shortDay(submitted)}` : r.manager.action === 'accept' ? `Accepted by manager ${shortDay(actedOn)}`
    : r.manager.action === 'change_day' ? 'Manager agreed another last day' : 'Manager agreed to release early';
  const { flag, late } = flagFor(owner, due, today, null);
  const task = r.manager?.action === 'change_day' && asked ? `Confirm last day: ${shortDay(asked)} (was ${shortDay(r.lastDayByNotice)})` : 'Accept and confirm last day';
  return {
    resignationId: r.id, exitType: 'resignation', exitTypeLabel: 'Resignation', tl: asked ?? r.lastDayByNotice, lastDayLine, nextStep, owner, due, late, flag,
    column: 'with_hr', tab: 'resignations', waitingOnHr: true, statusLabel, track: 1, waitingOn: [{ owner, task, due, late }],
  };
}

/** Where an exit stands: its column, the next step, who it waits on and when. */
export function deriveExit(ctx: ExitCtx, today: string): Derived {
  const { user, journey, tasks, handover, settlement } = ctx;
  const e = user.exit;
  const ob = e.offboarding;
  const tl = e.lastWorkingDay;
  const first = firstName(user.name);
  const clearance = clearanceOf(e);
  const left = !!e.accessEndedAt || tl < today;
  const managerOwner: Owner = { role: 'manager', name: ctx.managerName ? firstName(ctx.managerName) : 'Manager' };
  const uploaded = handover.filter((h) => !!h.upload).length;
  const handoverDone = finished(taskOf(tasks, 'mark_handover_done')) || (handover.length > 0 && handover.every((h) => h.done));
  const interview = taskOf(tasks, 'exit_interview');
  const opens = interviewOpensKey(e, journey);
  const interviewOpen = interviewApplies(ob) && !e.interview && !finished(interview) && !!opens && opens <= today && today <= tl;
  const joined = keyOfInstant(user.joiningDate ?? null);
  const gratuityLine = settlement?.lines?.find((l) => l.key === 'gratuity');
  const gratuityEligible = gratuityLine ? gratuityLine.amountPaise > 0 : !!joined && serviceYears(joined, tl).completed >= 5;
  const settlementDue = dueOf(taskOf(tasks, 'final_settlement')) ?? addWorkingDays(tl, 2);
  const waitingOn: WaitingOn[] = [];
  const wait = (owner: Owner, task: string, due: string | null) => waitingOn.push({ owner, task, due, late: !!due && due < today });
  const pendingClearance = clearance.filter((c) => !c.done);
  const teamDue = (team: ClearanceTeam) => dueOf(taskOf(tasks, TEAM_TASK[team])) ?? (team === 'finance' ? addDays(tl, -2) : tl);
  const teamOwner = (team: ClearanceTeam): Owner => (team === 'manager' ? managerOwner : { role: team, name: TEAM_LABEL[team] });
  const recovery: Flag | null = clearance.some((c) => c.team === 'finance' && !c.done && (c.amountPaise ?? 0) > 0) ? { key: 'recovery', label: 'Recovery', tone: 'warn' } : null;

  let column: BoardColumn;
  let nextStep: string;
  let owner: Owner;
  let due: string | null;
  let extra: Flag | null = recovery;
  if (left) {
    if (journey?.status === 'closed' || (!journey && settlement?.status === 'paid')) {
      column = 'closed'; nextStep = journey?.closedReason || 'Settled and closed'; owner = { role: 'done', name: 'Done' };
      due = keyOfInstant(journey?.closedAt ?? settlement?.paidAt ?? null); extra = { key: 'closed', label: 'Closed', tone: 'ok' };
    } else if (ob?.settlementEmail) {
      column = 'settlement_sent'; due = null;
      if (gratuityEligible && !finished(taskOf(tasks, 'gratuity'))) { nextStep = 'Gratuity to pay'; owner = { role: 'finance', name: 'Finance' }; due = dueOf(taskOf(tasks, 'gratuity')) ?? addDays(tl, 30); }
      else if (journey && !finished(taskOf(tasks, 'relieving_letter'))) { nextStep = 'Send the relieving letter'; owner = { role: 'hr', name: 'HR · you' }; due = dueOf(taskOf(tasks, 'relieving_letter')); }
      else if (settlement?.status !== 'paid') { nextStep = 'Mark the settlement paid'; owner = { role: 'hr', name: 'HR · you' }; }
      else { nextStep = 'Close the exit'; owner = { role: 'hr', name: 'HR · you' }; }
      if (gratuityEligible && !finished(taskOf(tasks, 'gratuity')) && journey && !finished(taskOf(tasks, 'relieving_letter'))) wait({ role: 'hr', name: 'HR · you' }, 'Relieving letter', dueOf(taskOf(tasks, 'relieving_letter')));
    } else {
      column = 'settlement_due'; due = settlementDue;
      if (e.kind === 'absconded' && !e.caseClosedAt) { nextStep = 'Close the case to start the settlement'; owner = { role: 'hr', name: 'HR · you' }; }
      else if (settlement?.lines?.some((l) => l.estimated)) {
        const month = settlement.lines.find((l) => l.estimated)?.period;
        nextStep = `Settlement drafted, waiting for the ${month ? monthName(month) : 'last month’s'} payroll run`; owner = { role: 'payroll', name: 'Payroll' };
      } else if (settlement?.status === 'approved' || settlement?.status === 'paid') { nextStep = 'Email the settlement PDF'; owner = { role: 'hr', name: 'HR · you' }; }
      else { nextStep = 'Review settlement and email the PDF'; owner = { role: 'hr', name: 'HR · you' }; }
    }
  } else if (tl === today) {
    column = 'last_day'; nextStep = e.rules?.access === 'at_once' ? 'App already off' : 'Account closes tonight'; owner = { role: 'automatic', name: 'Automatic' }; due = today; extra = null;
  } else if (journey && !finished(taskOf(tasks, 'handover_checklist')) && handover.length === 0) {
    column = 'accepted'; nextStep = 'Manager to share the handover checklist'; owner = managerOwner; due = dueOf(taskOf(tasks, 'handover_checklist'));
  } else if (handover.length > 0 && !handoverDone && uploaded < handover.length) {
    column = 'handover'; nextStep = `Handover: ${uploaded} of ${handover.length} items uploaded`; owner = { role: 'employee', name: first }; due = dueOf(taskOf(tasks, 'upload_handover')) ?? addDays(tl, -7);
  } else if (pendingClearance.length > 0) {
    column = 'clearance'; nextStep = `Clearance: ${clearance.length - pendingClearance.length} of ${clearance.length} done`;
    const team = pendingClearance[0].team ?? 'manager';
    owner = teamOwner(team); due = teamDue(team);
  } else if (interviewOpen) {
    column = 'exit_interview'; nextStep = `Exit interview open since ${shortDay(opens!)}`; owner = { role: 'employee', name: first }; due = tl;
  } else {
    column = 'last_week'; nextStep = 'All clear for the last day'; owner = { role: 'automatic', name: 'Automatic' }; due = tl; extra = { key: 'all_clear', label: 'All clear', tone: 'ok' };
  }
  waitingOn.unshift({ owner, task: nextStep, due, late: !!due && due < today });
  // Every clearance item still open waits on its team, up to the last day.
  if (!left) for (const c of pendingClearance) wait(teamOwner(c.team ?? 'manager'), clearanceTask(c), teamDue(c.team ?? 'manager'));
  if (column === 'last_day') wait({ role: 'payroll', name: 'Payroll' }, 'Final settlement', settlementDue);
  const { flag, late } = owner.role === 'done' ? { flag: extra, late: false } : flagFor(owner, due, today, extra);
  const daysLeft = daysFromTo(today, tl);
  const statusLabel = column === 'closed' ? `Closed${due ? ` ${shortDay(due)}` : ''}`
    : column === 'settlement_sent' ? `Settlement PDF emailed ${shortDay(keyOfInstant(ob!.settlementEmail!.at)!)}`
    : column === 'settlement_due' ? `Settlement due ${shortDay(settlementDue)}`
    : column === 'last_day' ? 'Last day today'
    : column === 'accepted' && journey ? `Accepted by HR ${shortDay(keyOfInstant(journey.anchors.exit_accepted ?? journey.createdAt)!)}`
    : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go`;
  return {
    ...(ob?.resignationId ? { resignationId: ob.resignationId } : {}), ...(journey ? { journeyId: journey.id } : {}),
    exitType: exitTypeOf(e), exitTypeLabel: exitTypeLabel(e), tl, lastDayLine: column === 'last_day' ? 'Last day today' : `Last day ${shortDay(tl)}`,
    nextStep, owner, due, late, flag, column, tab: TAB_OF[column], waitingOnHr: owner.role === 'hr', statusLabel, track: TRACK_STEP[column],
    waitingOn: dedupeWaiting(waitingOn),
  };
}

const clearanceTask = (c: { team?: ClearanceTeam; label: string; amountPaise?: number }) =>
  c.team === 'finance' && c.amountPaise ? `${c.label} · ${inr(c.amountPaise)} open` : c.label;
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
function dedupeWaiting(rows: WaitingOn[]): WaitingOn[] {
  const seen = new Set<string>();
  return rows.filter((r) => { const k = `${r.owner.role}|${r.task}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** When the exit interview opens: the journey's task, else Tl less the template's days (5 by default). */
export function interviewOpensKey(e: UserExit, journey: Journey | null): string | null {
  if (!interviewApplies(e.offboarding)) return null;
  const days = journey?.templateSnapshot?.settings?.exitInterviewOpensDays ?? 5;
  return addDays(e.lastWorkingDay, -days);
}

const BOARD_USER = { _id: 0, userId: 1, name: 1, employeeId: 1, designation: 1, department: 1, managerUserId: 1, joiningDate: 1, lifecycleStatus: 1, exit: 1, personalEmail: 1 } as const;

/** Everything the board and the drawer read for a set of exits, in a few queries. */
async function contexts(org: string, people: Array<BoardUser & { exit: UserExit }>): Promise<ExitCtx[]> {
  const journeyIds = people.map((u) => u.exit.offboarding?.journeyId).filter((x): x is string => !!x);
  const resignationIds = people.map((u) => u.exit.offboarding?.resignationId).filter((x): x is string => !!x);
  const [js, ts, hs, ss, rs, managers] = await Promise.all([
    journeyIds.length ? journeys().find({ id: { $in: journeyIds } }, { projection: { _id: 0 } }).toArray() : [],
    journeyIds.length ? journeyTasks().find({ journeyId: { $in: journeyIds } }, { projection: { _id: 0 } }).toArray() : [],
    journeyIds.length ? handoverItems().find({ journeyId: { $in: journeyIds } }, { projection: { _id: 0 } }).toArray() : [],
    exitSettlements().find({ org, userId: { $in: people.map((u) => u.userId) } }, { projection: { _id: 0, userId: 1, status: 1, payablePaise: 1, approvedAt: 1, paidAt: 1, 'lines.key': 1, 'lines.amountPaise': 1, 'lines.estimated': 1, 'lines.period': 1 } }).toArray(),
    resignationIds.length ? resignations().find({ id: { $in: resignationIds } }, { projection: { _id: 0 } }).toArray() : [],
    users().find({ userId: { $in: [...new Set(people.map((u) => u.managerUserId).filter((x): x is string => !!x))] } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray(),
  ]);
  const names = new Map(managers.map((m) => [m.userId, m.name]));
  return people.map((user) => {
    const jid = user.exit.offboarding?.journeyId;
    const journey = (jid && (js as Journey[]).find((j) => j.id === jid)) || null;
    const managerId = journey?.managerUserId ?? user.managerUserId;
    return {
      user, journey,
      tasks: jid ? (ts as JourneyTask[]).filter((t) => t.journeyId === jid) : [],
      handover: jid ? (hs as HandoverItem[]).filter((h) => h.journeyId === jid) : [],
      settlement: (ss as ExitCtx['settlement'][]).find((s) => (s as unknown as { userId: string }).userId === user.userId) ?? null,
      managerName: managerId ? names.get(managerId) : undefined,
      resignation: (rs as Resignation[]).find((r) => r.id === user.exit.offboarding?.resignationId) ?? null,
    };
  });
}

const cardBase = (u: Pick<User, 'userId' | 'name' | 'employeeId' | 'designation' | 'department'>) => ({ userId: u.userId, name: u.name, employeeId: u.employeeId ?? '', designation: u.designation ?? '', department: u.department ?? '' });
const toCard = (key: string, base: ReturnType<typeof cardBase>, d: Derived): BoardCard => {
  const { statusLabel: _s, track: _t, waitingOn: _w, ...rest } = d;
  return { key, ...base, ...rest };
};

/** IT, Admin or Finance staff: only exits still before their clearance is done, and only their item as the next step. */
function forTeam(card: BoardCard, ctx: ExitCtx, team: Exclude<ClearanceTeam, 'manager'> | null, today: string): BoardCard | null {
  // A resignation before HR accepts it is not an exit yet; an accepted one (Resignations › Accepted) already has the team's item.
  if (!team || card.column === 'with_manager' || card.column === 'with_hr' || card.column === 'closed' || card.column === 'settlement_sent') return null;
  const item = clearanceOf(ctx.user.exit).find((c) => c.team === team);
  if (!item) return null;
  const due = dueOf(taskOf(ctx.tasks, TEAM_TASK[team])) ?? (team === 'finance' ? addDays(ctx.user.exit.lastWorkingDay, -2) : ctx.user.exit.lastWorkingDay);
  return { ...card, nextStep: item.done ? `${item.label}: done` : item.label, owner: { role: team, name: TEAM_LABEL[team] }, due: item.done ? null : due, late: !item.done && due < today, flag: item.done ? { key: 'all_clear', label: 'Done', tone: 'ok' } : null, waitingOnHr: false };
}

export interface BoardQuery { tab?: string; q?: string; from?: string; to?: string }

/** GET /admin/lifecycle/offboarding/board: one tab's columns, every tab's count, and how many wait on HR. */
export async function offboardingBoard(actorUserId: string, query: BoardQuery = {}, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  const tab: BoardTab = query.tab === 'notice' || query.tab === 'exit' ? query.tab : 'resignations';
  const today = todayKey(now);
  const cards = await allCards(actor, today);
  const q = (query.q ?? '').trim().toLowerCase();
  const from = isDateKey(query.from) ? query.from : null;
  const to = isDateKey(query.to) ? query.to : null;
  const shown = cards.filter((c) => (!q || [c.name, c.employeeId, c.department, c.designation].some((v) => v.toLowerCase().includes(q)))
    && (!from || (c.tl ?? '') >= from) && (!to || (c.tl ?? '9999') <= to)
    // Closed exits stay on the board for 90 days unless a date range asks for older ones.
    && (c.column !== 'closed' || !!from || (c.tl ?? '') >= addDays(today, -90)));
  const counts = { resignations: 0, notice: 0, exit: 0 } as Record<BoardTab, number>;
  for (const c of shown) counts[c.tab]++;
  return {
    tab,
    columns: COLUMNS[tab].map((col) => ({ key: col.key, label: col.label, cards: shown.filter((c) => c.column === col.key).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')) })),
    counts,
    waitingOnHr: actor.viewer.kind === 'hr' ? shown.filter((c) => c.waitingOnHr).length : 0,
    viewer: actor.viewer,
    today,
  };
}

async function allCards(actor: Actor, today: string): Promise<BoardCard[]> {
  const org = actor.org;
  const [open, leavers] = await Promise.all([
    resignations().find({ org, status: { $in: ['with_manager', 'with_hr'] } }, { projection: { _id: 0 } }).toArray(),
    users().find({ org, exit: { $exists: true } }, { projection: BOARD_USER }).toArray(),
  ]);
  const people = await users().find({ userId: { $in: open.map((r) => r.userId) } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, designation: 1, department: 1, exit: 1 } }).toArray();
  const managers = await users().find({ userId: { $in: open.map((r) => r.managerUserId).filter((x): x is string => !!x) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  const out: BoardCard[] = [];
  if (actor.viewer.kind === 'hr') {
    for (const r of open) {
      const p = people.find((x) => x.userId === r.userId);
      if (!p || p.exit) continue;
      out.push(toCard(`r:${r.id}`, cardBase(p), deriveResignation(r, managers.find((m) => m.userId === r.managerUserId)?.name, p.name, today)));
    }
  }
  const ctxs = await contexts(org, leavers as Array<BoardUser & { exit: UserExit }>);
  for (const ctx of ctxs) {
    const card = toCard(ctx.user.userId, cardBase(ctx.user), deriveExit(ctx, today));
    if (actor.viewer.kind === 'hr') {
      const nudge = cardNudge(card, nudgeOptions(ctx, today));
      out.push(nudge ? { ...card, nudge } : card);
    }
    else { const mine = forTeam(card, ctx, actor.viewer.team, today); if (mine) out.push(mine); }
  }
  return out;
}

// ———————————————————————————————————————————————— reminders (Nudge / Remind)

const nudgeKey = (item: string, today: string) => `nudge:${item}:${today}`;

/**
 * What HR can remind someone about on an exit still before the last day: the manager's handover
 * checklist, the leaver's handover uploads, each open clearance item (its team, or the manager), and
 * the exit interview while it is open. Each goes once per item per day.
 */
export function nudgeOptions(ctx: ExitCtx, today: string): NudgeOption[] {
  const { user, journey, tasks, handover } = ctx;
  const e = user.exit;
  const ob = e.offboarding;
  if (!journey || !ob || e.accessEndedAt || e.lastWorkingDay < today) return [];
  const fired = new Set(ob.fired ?? []);
  const first = firstName(user.name);
  const manager = ctx.managerName ? firstName(ctx.managerName) : 'the manager';
  const out: NudgeOption[] = [];
  const add = (item: string, to: string, what: string, due: string | null) => out.push({ item, label: `Remind ${to}`, to, what, late: !!due && due < today, sentToday: fired.has(nudgeKey(item, today)) });
  const managerId = journey.managerUserId ?? user.managerUserId;
  if (managerId && !finished(taskOf(tasks, 'handover_checklist')) && handover.length === 0) add('handover_checklist', manager, 'Share the handover checklist', dueOf(taskOf(tasks, 'handover_checklist')));
  const uploaded = handover.filter((h) => !!h.upload).length;
  const handoverDone = finished(taskOf(tasks, 'mark_handover_done')) || (handover.length > 0 && handover.every((h) => h.done));
  if (ob.showAppPage && handover.length > 0 && uploaded < handover.length && !handoverDone) add('handover', first, `Upload the handover (${uploaded} of ${handover.length})`, dueOf(taskOf(tasks, 'upload_handover')) ?? addDays(e.lastWorkingDay, -7));
  for (const c of clearanceOf(e).filter((x) => !x.done)) {
    const team = c.team ?? 'manager';
    if (team === 'manager' && !managerId) continue;
    const due = dueOf(taskOf(tasks, TEAM_TASK[team])) ?? (team === 'finance' ? addDays(e.lastWorkingDay, -2) : e.lastWorkingDay);
    add(`clearance:${c.key}`, team === 'manager' ? manager : TEAM_LABEL[team], c.label, due);
  }
  const opens = interviewOpensKey(e, journey);
  if (ob.showAppPage && interviewApplies(ob) && !e.interview && !finished(taskOf(tasks, 'exit_interview')) && !!opens && opens <= today) add('exit_interview', first, 'Fill in the exit interview', e.lastWorkingDay);
  return out;
}

/** The card's own reminder: the one for its next step. */
function cardNudge(card: BoardCard, options: NudgeOption[]): NudgeOption | undefined {
  if (card.column === 'accepted') return options.find((o) => o.item === 'handover_checklist');
  if (card.column === 'handover') return options.find((o) => o.item === 'handover');
  // The board's clearance step is the first open item, as the options list them.
  if (card.column === 'clearance') return options.find((o) => o.item.startsWith('clearance:'));
  if (card.column === 'exit_interview') return options.find((o) => o.item === 'exit_interview');
  return undefined;
}

/**
 * POST /admin/lifecycle/offboarding/:userId/nudge { item } — HR reminds whoever holds the step: a push
 * that opens the right screen in the app (the leaver's Off-boarding page, the manager's leaver, the exit
 * interview), and for IT, Admin and Finance staff an email too (they work from the dashboard). Once per
 * item per day; a second try the same day is refused.
 */
export async function sendNudge(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor, 'Only HR can send a reminder');
  const today = todayKey(now);
  const user = await users().findOne({ userId: employeeUserId, org: actor.org }, { projection: BOARD_USER });
  if (!user?.exit) throw new LifecycleError(404, 'No exit recorded for this employee');
  const [ctx] = await contexts(actor.org, [user as BoardUser & { exit: UserExit }]);
  const item = String(body.item ?? '');
  const option = nudgeOptions(ctx, today).find((o) => o.item === item);
  if (!option) throw new LifecycleError(409, 'There is nothing open to remind them about');
  const e = ctx.user.exit;
  const first = firstName(user.name);
  const managerId = ctx.journey?.managerUserId ?? user.managerUserId;
  const day = shortDay(e.lastWorkingDay);
  const data = { userId: employeeUserId, journeyId: ctx.journey!.id };
  let send: () => Promise<void>;
  if (item === 'handover_checklist') {
    send = () => tell([managerId], 'lifecycle_handover_checklist_nudge', `Handover for ${first}`, `HR is waiting for ${first}'s handover checklist. Last day ${day}.`, { ...data, destination: 'lifecycle_leaver' });
  } else if (item === 'handover') {
    send = () => tell([employeeUserId], 'lifecycle_handover_nudge', 'Your handover is waiting', `${option.what.replace('Upload the handover', 'Handover uploaded')} before your last day, ${day}. Open Action › Off-boarding.`, { journeyId: data.journeyId, destination: 'lifecycle_offboarding' });
  } else if (item === 'exit_interview') {
    send = () => tell([employeeUserId], 'lifecycle_exit_interview_nudge', 'Your exit interview is open', `Five short questions, all optional, until ${day}. Your answers go to HR only.`, { journeyId: data.journeyId, destination: 'lifecycle_exit_interview' });
  } else {
    const c = clearanceOf(e).find((x) => `clearance:${x.key}` === item)!;
    const team = c.team ?? 'manager';
    if (team === 'manager') {
      send = () => tell([managerId], 'lifecycle_clearance_nudge', `Clearance for ${first}`, `${c.label} is still open. Last day ${day}.`, { ...data, destination: 'lifecycle_leaver' });
    } else {
      const staff = await clearanceStaff(actor.org, team);
      if (!staff.length) throw new LifecycleError(409, `No one is set as ${TEAM_LABEL[team]} clearance staff. Set it in People › Accesses.`);
      send = () => tell(staff, 'lifecycle_clearance_nudge', `Clearance: ${user.name}`, `${c.label} is still open. Last day ${day}.`, { userId: employeeUserId, destination: 'lifecycle_offboarding_board' },
        { subject: `Clearance reminder: ${user.name}`, body: `Hi {firstName},\n\n${c.label} for ${user.name} is still open. Their last working day is ${longDay(e.lastWorkingDay)}.\n\nTick it on the Offboarding board in the HR dashboard once it is done.` });
    }
  }
  // Once per item per day: the day's key goes on the exit atomically, so two clicks send one reminder.
  const res = await users().updateOne({ userId: employeeUserId, org: actor.org, 'exit.offboarding.fired': { $ne: nudgeKey(item, today) } }, { $push: { 'exit.offboarding.fired': nudgeKey(item, today) } });
  if (res.modifiedCount !== 1) throw new LifecycleError(429, `${option.to} was already reminded today. You can remind them again tomorrow.`);
  await send();
  return { nudged: { item, to: option.to }, ...(await offboardingDetail(actorUserId, employeeUserId, now)) };
}

/** GET /admin/lifecycle/offboarding/count — the sidebar's red badge: cards that need you, and late ones. */
export async function offboardingCount(actorUserId: string, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  const today = todayKey(now);
  const cards = (await allCards(actor, today)).filter((c) => c.column !== 'closed');
  const needs = (c: BoardCard) => (actor.viewer.kind === 'hr' ? c.waitingOnHr : c.flag?.key !== 'all_clear');
  const needsYou = cards.filter(needs).length;
  const late = cards.filter((c) => c.late && !needs(c)).length;
  return { count: needsYou + late, needsYou, late, viewer: actor.viewer };
}

// ———————————————————————————————————————————————— clearance team (People › Accesses)

async function requireDashboardAdmin(actorUserId: string) {
  const actor = await users().findOne({ userId: actorUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1 } });
  if (!actor?.org || actor.dashboardAccess !== true || actor.dashboardAdmin !== true) throw new LifecycleError(403, 'Only a dashboard admin can set a clearance team');
  return requireLifecycleOrg(actor.org);
}

/** GET /admin/lifecycle/offboarding/clearance-team/:userId — the team set, and the department's guess used when none is. */
export async function clearanceTeamOf(actorUserId: string, userId: string) {
  const org = await requireDashboardAdmin(actorUserId);
  const u = await users().findOne({ userId, org }, { projection: { _id: 0, clearanceTeam: 1, department: 1 } });
  if (!u) throw new LifecycleError(404, 'Employee not found');
  return { team: u.clearanceTeam ?? null, guess: teamOfDepartment(u.department), department: u.department ?? '' };
}

/** PUT /admin/lifecycle/offboarding/clearance-team/:userId { team: 'it'|'admin'|'finance'|null } — null goes back to the department's guess. */
export async function setClearanceTeam(actorUserId: string, userId: string, body: Record<string, unknown>, now = new Date()) {
  const org = await requireDashboardAdmin(actorUserId);
  const team = body.team == null || body.team === '' ? null : String(body.team);
  if (team !== null && !['it', 'admin', 'finance'].includes(team)) throw new LifecycleError(400, 'The clearance team is IT, Admin or Finance');
  const res = await users().updateOne({ userId, org }, team ? { $set: { clearanceTeam: team as 'it' | 'admin' | 'finance', updatedAt: now } } : { $unset: { clearanceTeam: '' }, $set: { updatedAt: now } });
  if (!res.matchedCount) throw new LifecycleError(404, 'Employee not found');
  return clearanceTeamOf(actorUserId, userId);
}

// ———————————————————————————————————————————————— the drawer

export interface HandoverItemView { id: string; title: string; upload: { kind: 'file' | 'link'; name?: string; url?: string; at: string } | null; done: boolean; doneAt: string | null }
export const handoverView = (h: HandoverItem): HandoverItemView => ({
  id: h.id, title: h.title, done: h.done, doneAt: h.doneAt ? h.doneAt.toISOString() : null,
  upload: h.upload ? { kind: h.upload.kind, ...(h.upload.name ? { name: h.upload.name } : {}), ...(h.upload.kind === 'link' && h.upload.url ? { url: h.upload.url } : {}), at: h.upload.at.toISOString() } : null,
});

function serviceText(joined: string | null, tl: string) {
  if (!joined) return '—';
  const s = serviceYears(joined, tl);
  const months = s.months - s.completed * 12;
  return [s.completed ? `${s.completed} ${s.completed === 1 ? 'year' : 'years'}` : '', months ? `${months} ${months === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(' ') || 'Under a month';
}

export function resignationView(r: Resignation, managerName?: string, now = new Date()) {
  const tl = r.agreedLastDay ?? r.manager?.date ?? r.lastDayByNotice;
  return {
    id: r.id, userId: r.userId, managerUserId: r.managerUserId ?? null, managerName: managerName ?? '', reason: r.reason, note: r.note ?? '',
    submittedAt: r.submittedAt.toISOString(), noticeDays: r.noticeDays, lastDayByNotice: r.lastDayByNotice, status: r.status,
    manager: r.manager ? { ...r.manager, at: r.manager.at.toISOString() } : null,
    hrAcceptedAt: r.hrAcceptedAt ? r.hrAcceptedAt.toISOString() : null, hrAcceptedByName: r.hrAcceptedByName ?? null,
    agreedLastDay: r.agreedLastDay ?? null, withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null, journeyId: r.journeyId ?? null,
    tl, daysLeft: r.status === 'withdrawn' ? null : daysFromTo(todayKey(now), tl),
  };
}

/** GET /admin/lifecycle/offboarding/:userId — the 460 px drawer. */
export async function offboardingDetail(actorUserId: string, employeeUserId: string, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  const today = todayKey(now);
  const user = await users().findOne({ userId: employeeUserId, org: actor.org }, { projection: BOARD_USER });
  if (!user) throw new LifecycleError(404, 'Employee not found');
  const hr = actor.viewer.kind === 'hr';
  const person = { ...cardBase(user), joiningDate: keyOfInstant(user.joiningDate ?? null), ...(hr ? { personalEmail: user.personalEmail ?? '' } : {}) };

  // A resignation not yet accepted: no exit, no journey.
  if (!user.exit) {
    if (!hr) throw new LifecycleError(404, 'Nothing to clear for this person');
    const r = await resignations().findOne({ org: actor.org, userId: employeeUserId, status: { $in: ['with_manager', 'with_hr'] } }, { projection: { _id: 0 } });
    if (!r) throw new LifecycleError(404, 'No resignation or exit for this employee');
    const manager = r.managerUserId ? await users().findOne({ userId: r.managerUserId }, { projection: { _id: 0, name: 1 } }) : null;
    const d = deriveResignation(r, manager?.name, user.name, today);
    const asked = r.manager?.date;
    return {
      viewer: actor.viewer, person: { ...person, managerName: manager?.name ?? '' }, card: toCard(`r:${r.id}`, cardBase(user), d), statusLabel: d.statusLabel,
      track: { steps: TRACK, current: d.track }, waitingOn: d.waitingOn, resignation: resignationView(r, manager?.name, now), exit: null,
      tasks: [] as TaskView[], handover: { items: [] as HandoverItemView[], note: '' }, clearance: [], interview: null, appPage: false, nudges: [] as NudgeOption[], settlement: null,
      details: [
        { label: 'Exit type', value: 'Resignation' },
        { label: 'Resigned on', value: longDay(keyOfInstant(r.submittedAt)!) },
        { label: 'Notice period', value: `${r.noticeDays} days` },
        { label: 'Last day by notice', value: longDay(r.lastDayByNotice) },
        r.manager?.action === 'change_day' && asked ? { label: 'Manager asked for', value: longDay(asked) } : { label: 'Early release', value: r.manager?.action === 'release_early' && asked ? longDay(asked) : 'Not asked' },
        { label: 'Reason', value: r.reason },
        ...(r.note ? [{ label: 'Note', value: r.note }] : []),
        { label: 'Manager', value: manager?.name ?? '—' },
      ],
    };
  }

  const [ctx] = await contexts(actor.org, [user as BoardUser & { exit: UserExit }]);
  const d = deriveExit(ctx, today);
  const e = ctx.user.exit;
  const ob = e.offboarding;
  const team = actor.viewer.kind === 'team' ? actor.viewer.team : null;
  if (!hr && !team) throw new LifecycleError(403, 'Your clearance team is not set. Ask HR to set it in People › Accesses.');
  const seesAmount = (t?: ClearanceTeam) => actor.viewer.seesPay || (team === 'finance' && t === 'finance');
  const clearance = clearanceOf(e).filter((c) => hr || c.team === team).map((c) => ({
    key: c.key, label: c.label, team: c.team ?? 'manager', done: c.done, doneAt: c.doneAt ? c.doneAt.toISOString() : null, doneByName: c.doneByName ?? '',
    ...(c.amountPaise && seesAmount(c.team) ? { amountPaise: c.amountPaise } : {}), ...(c.note ? { note: c.note } : {}),
    canTick: hr || c.team === team,
  }));
  const tasks = ctx.journey ? await journeyTasksView(ctx.journey.id, hr ? 'hr' : `team:${team!}`) : [];
  const opens = interviewOpensKey(e, ctx.journey);
  const interview = interviewApplies(ob) ? { applies: true, opensAt: opens, open: !!opens && opens <= today && today <= e.lastWorkingDay && !e.interview, sent: !!e.interview } : { applies: false, opensAt: null, open: false, sent: !!e.interview };
  const joined = keyOfInstant(user.joiningDate ?? null);
  const uploaded = ctx.handover.filter((h) => !!h.upload).length;
  const settlementDue = dueOf(taskOf(ctx.tasks, 'final_settlement')) ?? addWorkingDays(e.lastWorkingDay, 2);
  const view = exitView(user as never, now, { settlement: null });

  const details: Array<{ label: string; value: string }> = [{ label: 'Exit type', value: exitTypeLabel(e) }];
  if (hr) {
    if (ctx.resignation) details.push({ label: 'Resigned on', value: longDay(keyOfInstant(ctx.resignation.submittedAt)!) }, { label: 'Reason', value: ctx.resignation.reason });
    else if (e.noticeFrom) details.push({ label: e.kind === 'absconded' ? 'Last seen' : 'Told on', value: longDay(e.noticeFrom) });
    if (ctx.journey?.anchors.exit_accepted) details.push({ label: 'Accepted on', value: longDay(keyOfInstant(ctx.journey.anchors.exit_accepted)!) });
  }
  details.push({ label: 'Last day', value: longDay(e.lastWorkingDay) }, { label: 'Manager', value: ctx.managerName ?? '—' });
  if (hr) {
    if (e.noticeDays != null) details.push({ label: 'Notice period', value: `${e.noticeDays} days` });
    if (ctx.journey) details.push({ label: 'Template', value: ctx.journey.templateSnapshot?.name ?? 'Standard' });
    if (ctx.handover.length) details.push({ label: 'Handover', value: `${uploaded} of ${ctx.handover.length} uploaded` });
    details.push({ label: 'Exit interview', value: !interview.applies ? (e.interview ? 'Filled by HR' : 'Not part of this exit') : interview.sent ? 'Sent' : interview.open ? 'Opened, not sent' : `Opens ${shortDay(opens!)}` });
    details.push({ label: 'Service', value: serviceText(joined, e.lastWorkingDay) });
    if (actor.viewer.seesPay) {
      details.push({ label: 'Salary', value: e.rules?.holdPay ? `Held${e.noticeFrom ? ` from ${shortDay(e.noticeFrom)}` : ''} (from payroll)` : 'Paid with each run' });
      if (d.tab === 'exit') details.push({ label: 'Settlement due', value: `${shortDay(settlementDue)} · 2 working days` });
      if (ob?.settlementEmail) details.push({ label: 'Settlement', value: `Emailed ${shortDay(keyOfInstant(ob.settlementEmail.at)!)}` });
      if (ctx.settlement?.paidAt) details.push({ label: 'Settlement paid', value: shortDay(keyOfInstant(ctx.settlement.paidAt)!) });
      const gratuity = ctx.settlement?.lines?.find((l) => l.key === 'gratuity');
      const years = joined ? serviceYears(joined, e.lastWorkingDay).completed : null;
      if (gratuity || joined) details.push({ label: 'Gratuity', value: (gratuity ? gratuity.amountPaise > 0 : years !== null && years >= GRATUITY_MIN_YEARS) ? (taskOf(ctx.tasks, 'gratuity')?.status === 'done' ? 'Paid' : 'Due within 30 days') : `Not eligible (${years ?? 0} ${years === 1 ? 'year' : 'years'})` });
    }
    if (finished(taskOf(ctx.tasks, 'relieving_letter'))) details.push({ label: 'Relieving letter', value: 'Sent' });
  }

  return {
    viewer: actor.viewer,
    person: { ...person, managerName: ctx.managerName ?? '' },
    card: toCard(user.userId, cardBase(user), d),
    statusLabel: d.statusLabel,
    track: { steps: TRACK, current: d.track },
    waitingOn: hr ? d.waitingOn : d.waitingOn.filter((w) => w.owner.role === team),
    resignation: hr && ctx.resignation ? resignationView(ctx.resignation, ctx.managerName, now) : null,
    // The live exit's own view (dates, rules, team move); HR only. Neither its settlement amount nor the
    // exit interview's answers are in it: the answers show only in Exit insights, anonymised.
    exit: hr ? { ...view, interview: null } : null,
    tasks,
    handover: { items: hr ? ctx.handover.map(handoverView) : [], note: hr ? ob?.handoverNote ?? '' : '' },
    clearance,
    interview,
    /** Whether the app shows the Off-boarding page (HR turns it on or off). */
    appPage: !!ob?.showAppPage,
    /** HR's reminders for what is open (Remind {name}); once per item per day. */
    nudges: hr ? nudgeOptions(ctx, today) : [],
    settlement: hr && actor.viewer.seesPay && ctx.settlement ? {
      status: ctx.settlement.status, payablePaise: ctx.settlement.payablePaise, dueOn: settlementDue,
      emailedTo: ob?.settlementEmail?.to ?? null, emailedAt: ob?.settlementEmail ? ob.settlementEmail.at.toISOString() : null,
    } : null,
    details,
  };
}

// ———————————————————————————————————————————————— HR's actions on an exit

async function leaverFor(actor: Actor, employeeUserId: string) {
  const user = await users().findOne({ userId: employeeUserId, org: actor.org });
  if (!user?.exit) throw new LifecycleError(404, 'No exit recorded for this employee');
  return user as User & { exit: UserExit; org: string };
}

const SYSTEM_KEYS = new Set<string>(['handover_checklist', 'upload_handover', 'exit_interview', 'save_documents', 'finance_clearance', 'return_assets', 'kt_session', 'mark_handover_done', 'thank_you_note', 'final_settlement', 'relieving_letter', 'epfo_exit', 'gratuity', 'stay_in_touch', 'delete_face_data']);

/** POST /admin/lifecycle/offboarding/:userId/tasks/:systemKey { action: 'done', note? } — HR ticks a task (relieving letter, EPFO, gratuity…). */
export async function offboardingTaskDone(actorUserId: string, employeeUserId: string, systemKey: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  const user = await leaverFor(actor, employeeUserId);
  const journeyId = user.exit.offboarding?.journeyId;
  if (!journeyId) throw new LifecycleError(409, 'This exit has no offboarding journey');
  if (!SYSTEM_KEYS.has(systemKey)) throw new LifecycleError(400, 'Unknown task');
  const team = actor.viewer.kind === 'team' ? actor.viewer.team : null;
  const allowed = actor.viewer.kind === 'hr' || (team === 'finance' && (systemKey === 'finance_clearance' || systemKey === 'gratuity')) || ((team === 'it' || team === 'admin') && systemKey === 'return_assets');
  if (!allowed) throw new LifecycleError(403, 'This task is not yours to tick');
  if (String(body.action ?? 'done') !== 'done') throw new LifecycleError(400, 'action: done');
  const task = await completeTask(journeyId, systemKey as SystemTaskKey, { userId: actor.userId, name: actor.name }, body.note ? String(body.note).slice(0, 300) : undefined);
  if (!task) throw new LifecycleError(404, 'This journey has no such task');
  return offboardingDetail(actorUserId, employeeUserId, now);
}

/** Keeps the journey's clearance tasks in step with the list. */
async function syncClearanceTasks(journeyId: string | undefined, list: ReturnType<typeof clearanceOf>, by: { userId?: string; name?: string }) {
  if (!journeyId) return;
  const done = (team: ClearanceTeam) => list.filter((c) => c.team === team).every((c) => c.done);
  if (list.some((c) => c.team === 'finance') && done('finance')) await completeTask(journeyId, 'finance_clearance', by);
  if (list.some((c) => c.team === 'it' || c.team === 'admin') && done('it') && done('admin')) await completeTask(journeyId, 'return_assets', by);
  if (list.some((c) => c.team === 'manager') && done('manager')) await completeTask(journeyId, 'mark_handover_done', by);
}

/** PUT /admin/lifecycle/offboarding/:userId/clearance { key, done, amountPaise?, note? } — HR any item; IT, Admin, Finance their own. */
export async function setOffboardingClearance(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  const user = await leaverFor(actor, employeeUserId);
  const key = String(body.key ?? '');
  const item = clearanceOf(user.exit).find((c) => c.key === key);
  if (!item) throw new LifecycleError(404, 'No such item on the clearance list');
  if (actor.viewer.kind === 'team' && item.team !== actor.viewer.team) throw new LifecycleError(403, 'This clearance item belongs to another team');
  const settlement = await exitSettlements().findOne({ org: actor.org, userId: employeeUserId }, { projection: { _id: 0, status: 1 } });
  if (settlement?.status === 'paid') throw new LifecycleError(409, 'The settlement is paid: the clearance list is closed');
  let amountPaise: number | null | undefined;
  if (body.amountPaise !== undefined) {
    if (item.team !== 'finance') throw new LifecycleError(400, 'Only the Finance item carries an amount');
    if (body.amountPaise === null || body.amountPaise === '') amountPaise = null;
    else { amountPaise = Number(body.amountPaise); if (!Number.isInteger(amountPaise) || amountPaise < 0) throw new LifecycleError(400, 'The amount is whole paise, 0 or more'); }
  }
  const list = await tickClearanceItem(actor.org, user, key, body.done === true, actor.name, { amountPaise, ...(body.note !== undefined ? { note: body.note == null ? null : String(body.note) } : {}) }, now);
  await syncClearanceTasks(user.exit.offboarding?.journeyId, list, { userId: actor.userId, name: actor.name });
  return offboardingDetail(actorUserId, employeeUserId, now);
}

/**
 * POST /admin/lifecycle/offboarding/:userId/last-day { lastWorkingDay, recoverShortfall?, note? } — another
 * last day once the exit is accepted (another day agreed, or an early release). The exit is recorded
 * again with the new day and everything else as it was; every open Tl-based task moves with it.
 * An earlier day than the notice gives is the company's release: no shortfall is recovered unless asked.
 */
export async function changeLastDay(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  const user = await leaverFor(actor, employeeUserId);
  const e = user.exit;
  if (e.accessEndedAt) throw new LifecycleError(409, `${user.name} has already left; the last day can no longer move`);
  const lastWorkingDay = String(body.lastWorkingDay ?? '');
  if (!isDateKey(lastWorkingDay)) throw new LifecycleError(400, 'Last working day is a date like 2026-12-31');
  const byNotice = e.noticeFrom && e.noticeDays != null ? addDays(e.noticeFrom, e.noticeDays) : null;
  const early = !!byNotice && lastWorkingDay < byNotice;
  const rules = { ...(e.rules ?? {}), ...(early && body.recoverShortfall !== true ? { noticeRecovery: 'none' as const } : {}) };
  await recordExit(actor.userId, employeeUserId, {
    kind: e.kind, lastWorkingDay, ...(e.noticeFrom ? { noticeFrom: e.noticeFrom } : {}), ...(e.noticeDays != null ? { noticeDays: e.noticeDays } : {}),
    ...(e.note ? { note: e.note } : {}), rules, ...(e.newManagerUserId ? { newManagerUserId: e.newManagerUserId } : {}),
  }, now);
  if (e.offboarding?.journeyId) {
    await moveTl(e.offboarding.journeyId, lastWorkingDay);
    await syncGratuityTask(e.offboarding.journeyId, user.joiningDate, lastWorkingDay);
  }
  if (e.offboarding?.resignationId) await resignations().updateOne({ id: e.offboarding.resignationId }, { $set: { agreedLastDay: lastWorkingDay } });
  if (lastWorkingDay !== e.lastWorkingDay) {
    const first = firstName(user.name);
    if (e.offboarding?.showAppPage) await tellOffboarding([employeeUserId], 'lifecycle_last_day_changed', 'lifecycle_resignation', 'Your last day has moved', `Your last working day is now ${longDay(lastWorkingDay)}.`, { journeyId: e.offboarding.journeyId });
    await tellOffboarding([user.managerUserId], 'lifecycle_last_day_changed', 'lifecycle_leaver', `${first}'s last day has moved`, `${first}'s last working day is now ${longDay(lastWorkingDay)}.`, { userId: employeeUserId, journeyId: e.offboarding?.journeyId });
  }
  return offboardingDetail(actorUserId, employeeUserId, now);
}

export interface StartBody {
  exitType?: unknown; lastWorkingDay?: unknown; noticeHandling?: unknown; templateId?: unknown; managerUserId?: unknown; hrNote?: unknown;
  tellManagerNow?: unknown; showAppPage?: unknown; newManagerUserId?: unknown; moveTeamNow?: unknown; noticeFrom?: unknown;
}

/** POST /admin/lifecycle/offboarding/:userId/start — O2, an exit HR starts (an emailed resignation, retirement, end of contract, termination, absconding). */
export async function startExit(actorUserId: string, employeeUserId: string, body: StartBody, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  const exitType = String(body.exitType ?? '') as OffboardingExitType;
  if (!EXIT_TYPES.includes(exitType)) throw new LifecycleError(400, `Exit type is one of ${EXIT_TYPES.join(', ')}`);
  const lastWorkingDay = String(body.lastWorkingDay ?? '');
  if (!isDateKey(lastWorkingDay)) throw new LifecycleError(400, 'Last working day is a date like 2026-12-31');
  const noticeHandling = body.noticeHandling == null || body.noticeHandling === '' ? undefined : String(body.noticeHandling) as OffboardingNoticeHandling;
  if (noticeHandling && !NOTICE_HANDLING.includes(noticeHandling)) throw new LifecycleError(400, `Notice is one of ${NOTICE_HANDLING.join(', ')}`);
  const employee = await users().findOne({ userId: employeeUserId, org: actor.org });
  if (!employee) throw new LifecycleError(404, 'Employee not found');
  if (employee.exit) throw new LifecycleError(409, `An exit is already recorded for ${employee.name}. Open it on the board.`);
  if (await resignations().findOne({ org: actor.org, userId: employeeUserId, status: { $in: ['with_manager', 'with_hr'] } }, { projection: { _id: 1 } })) {
    throw new LifecycleError(409, `${employee.name} has resigned in the app. Accept that resignation instead.`);
  }
  const noticeFrom = isDateKey(body.noticeFrom) ? body.noticeFrom : todayKey(now) <= lastWorkingDay ? todayKey(now) : undefined;
  const managerUserId = body.managerUserId ? String(body.managerUserId) : undefined;
  if (managerUserId && !(await users().findOne({ userId: managerUserId, org: actor.org }, { projection: { _id: 1 } }))) throw new LifecycleError(400, 'The reporting manager must be someone at this company');
  const res = await beginOffboarding(actor, employee, {
    exitType, lastWorkingDay, ...(noticeFrom ? { noticeFrom } : {}),
    ...(exitType === 'resignation' ? { noticeDays: await noticeDaysFor(actor.org) } : {}),
    ...(body.hrNote ? { note: String(body.hrNote).trim().slice(0, 1000) } : {}),
    rules: rulesForNotice(exitType, noticeHandling),
    ...(body.newManagerUserId ? { newManagerUserId: String(body.newManagerUserId) } : {}),
    moveTeamNow: body.moveTeamNow === true,
    ...(body.templateId ? { templateId: String(body.templateId) } : {}),
    ...(typeof body.showAppPage === 'boolean' ? { showAppPage: body.showAppPage } : {}),
    ...(noticeHandling ? { noticeHandling } : {}),
    tellManagerNow: body.tellManagerNow !== false,
    ...(managerUserId ? { managerUserId } : {}),
  }, now);
  return { journeyId: res.journeyId, ...(await offboardingDetail(actorUserId, employeeUserId, now)) };
}

/** HR turns the Off-boarding page on or off (a termination: off until HR has told them). */
export async function setAppPage(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  const user = await leaverFor(actor, employeeUserId);
  if (!user.exit.offboarding) throw new LifecycleError(409, 'This exit has no offboarding journey');
  const on = body.showAppPage === true;
  await users().updateOne({ userId: employeeUserId, org: actor.org }, { $set: { 'exit.offboarding.showAppPage': on, updatedAt: now } });
  if (on && user.exit.offboarding.journeyId) await completeTask(user.exit.offboarding.journeyId, 'offboarding_page', { userId: actor.userId, name: actor.name });
  if (on && !user.exit.offboarding.showAppPage && !user.exit.accessEndedAt) await tellOffboarding([employeeUserId], 'lifecycle_offboarding_open', 'lifecycle_resignation', 'Your last day is set', `Your last working day is ${longDay(user.exit.lastWorkingDay)}. See what to do before you go.`, { journeyId: user.exit.offboarding.journeyId });
  return offboardingDetail(actorUserId, employeeUserId, now);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));

/**
 * POST /admin/lifecycle/offboarding/:userId/settlement/email { pdfBase64, to, subject?, message? } — O3. The
 * statement PDF the dashboard made (settlementDoc.ts), emailed to the personal email once the settlement
 * is approved. It is never shown in the app. The personal email is kept on the person when they had none.
 */
export async function emailSettlement(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  if (!actor.viewer.seesPay) throw new LifecycleError(403, 'Only someone with payroll access can send a settlement');
  const user = await leaverFor(actor, employeeUserId);
  const settlement = await exitSettlements().findOne({ org: actor.org, userId: employeeUserId }, { projection: { _id: 0 } });
  if (!settlement || settlement.status === 'draft') throw new LifecycleError(409, 'Approve the settlement before emailing it');
  const to = String(body.to ?? user.personalEmail ?? '').trim().toLowerCase();
  if (!EMAIL.test(to)) throw new LifecycleError(400, 'Add their personal email to send the PDF to');
  const raw = String(body.pdfBase64 ?? '').replace(/^data:[^,]*,/, '');
  const pdf = Buffer.from(raw, 'base64');
  if (pdf.length < 100 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new LifecycleError(400, 'pdfBase64 must be the settlement PDF');
  if (pdf.length > 10 * 1024 * 1024) throw new LifecycleError(413, 'The PDF must be 10 MB or smaller');
  // The checks stop the send until they pass, unless HR says why it goes anyway.
  const { blocking } = await checksFor(user, settlement);
  const overrideReason = String(body.overrideReason ?? '').trim().slice(0, 300);
  if (blocking.length && !overrideReason) throw new LifecycleError(409, `Not ready to send: ${blocking.join('; ')}. Resolve it, or say why you are sending anyway.`);
  const company = await companies().findOne({ id: actor.org }, { projection: { _id: 0, name: 1 } });
  const companyName = company?.name ?? actor.org;
  const first = firstName(user.name);
  const subject = String(body.subject ?? '').trim().slice(0, 200) || `Your full and final settlement · ${companyName}`;
  const message = String(body.message ?? '').trim().slice(0, 4000)
    || `Dear ${first},\n\nYour full and final settlement statement is attached.\n\nFor any question, reply to this email or write to HR.\n\n${companyName}`;
  const html = message.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  if (!orgMayEmail(actor.org)) throw new LifecycleError(409, 'Email to this company is switched off on this server; the PDF was not sent');
  const sent = await sendLifecycleEmail(actor.org, to, subject, html, [{ filename: `Settlement_${user.employeeId || user.name.replace(/\s+/g, '_')}.pdf`, content: pdf, contentType: 'application/pdf' }]);
  // Without SMTP (development only) the mail is logged and kept in the outbox; anywhere else a failed send is an error.
  if (!sent && (smtpConfigured() || env.nodeEnv === 'production')) throw new LifecycleError(502, 'The email could not be sent; the PDF was not sent. Try again');
  const settlementEmail = { to, at: now, ...(actor.name ? { byName: actor.name } : {}), ...(blocking.length ? { overrideReason } : {}) };
  await users().updateOne({ userId: employeeUserId, org: actor.org }, {
    ...(user.exit.offboarding?.settlementDraft ? { $unset: { 'exit.offboarding.settlementDraft': '' } } : {}),
    $set: { ...(user.exit.offboarding ? { 'exit.offboarding.settlementEmail': settlementEmail } : { 'exit.offboarding': { exitType: exitTypeOf(user.exit) ?? 'resignation', showAppPage: false, settlementEmail } }), ...(!user.personalEmail ? { personalEmail: to } : {}), updatedAt: now },
  });
  const journeyId = user.exit.offboarding?.journeyId;
  if (journeyId) {
    await completeTask(journeyId, 'final_settlement', { userId: actor.userId, name: actor.name });
    await setJourneyStatus(journeyId, 'settlement_sent');
  }
  return offboardingDetail(actorUserId, employeeUserId, now);
}

/** POST /admin/lifecycle/offboarding/:userId/close — HR closes the exit once the settlement is emailed (letters and EPFO done outside). */
export async function closeOffboarding(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  const user = await leaverFor(actor, employeeUserId);
  const journeyId = user.exit.offboarding?.journeyId;
  if (!journeyId) throw new LifecycleError(409, 'This exit closes when its settlement is marked paid');
  if (!user.exit.offboarding?.settlementEmail) throw new LifecycleError(409, 'Email the settlement PDF before closing the exit');
  await closeJourney(journeyId, 'closed', String(body.note ?? '').trim().slice(0, 200) || 'Settlement sent, letters and PF done');
  return offboardingDetail(actorUserId, employeeUserId, now);
}

// ———————————————————————————————————————————————— handover files

const LOCAL_ROOT = path.resolve(__dirname, '../../../.local-uploads');
export interface UploadFile { name: string; contentType: string; bytes: Buffer }

async function storeFile(org: string, journeyId: string, userId: string, file: UploadFile, now: Date): Promise<string> {
  const id = randomUUID();
  let objectKey: string;
  if (hasReceiptStorage()) {
    objectKey = (await uploadEmployeeDocument(userId, { originalName: file.name, contentType: file.contentType, size: file.bytes.length, bytes: file.bytes })).objectKey;
  } else {
    objectKey = `lifecycle/${org}/${journeyId}/${id}`;
    await fs.mkdir(path.join(LOCAL_ROOT, path.dirname(objectKey)), { recursive: true });
    await fs.writeFile(path.join(LOCAL_ROOT, objectKey), file.bytes);
  }
  await lifecycleFiles().insertOne({ id, org, journeyId, objectKey, name: file.name.slice(0, 200), contentType: file.contentType, size: file.bytes.length, uploadedAt: now, uploadedBy: 'employee' });
  return id;
}

/** A handover file: a short-lived link (S3), or the bytes (local development). */
export async function handoverFileFor(item: HandoverItem): Promise<{ url: string } | { bytes: Buffer; name: string; contentType: string }> {
  if (item.upload?.kind !== 'file' || !item.upload.fileId) throw new LifecycleError(404, 'No file on this item');
  const file = await lifecycleFiles().findOne({ id: item.upload.fileId, org: item.org });
  if (!file) throw new LifecycleError(404, 'File not found');
  if (file.objectKey.startsWith('lifecycle/') && !hasReceiptStorage()) return { bytes: await fs.readFile(path.join(LOCAL_ROOT, file.objectKey)), name: file.name, contentType: file.contentType };
  return { url: await presignReceiptDownload(file.objectKey, file.name) };
}

// ———————————————————————————————————————————————— the app: the leaver

/** The leaver's exit, when the Off-boarding page is on for it. */
async function myExit(userId: string) {
  const user = await appUser(userId);
  const ob = user.exit?.offboarding;
  if (!user.exit || !ob?.journeyId || !ob.showAppPage) throw new LifecycleError(404, 'No off-boarding page');
  return { user: user as User & { org: string; exit: UserExit }, ob, journeyId: ob.journeyId };
}

/** For GET /lifecycle/me (BE-journey's): the offboarding part. */
export async function offboardingMe(userId: string) {
  const user = await users().findOne({ userId }, { projection: { _id: 0, exit: 1, org: 1 } });
  const r = await resignations().findOne({ userId, status: { $in: ['with_manager', 'with_hr', 'accepted'] } }, { sort: { submittedAt: -1 }, projection: { _id: 0, id: 1, status: 1, lastDayByNotice: 1 } });
  const ob = user?.exit?.offboarding;
  // The offboarding journey: the one the exit names, else an open one (an exit always comes with it in the product).
  const journey = ob?.journeyId
    ? await journeys().findOne({ id: ob.journeyId }, { projection: { _id: 0, id: 1, tl: 1, exitType: 1, showAppPage: 1, templateSnapshot: 1 } })
    : await journeys().findOne({ userId, kind: 'offboarding', closedAt: { $exists: false } }, { sort: { createdAt: -1 }, projection: { _id: 0, id: 1, tl: 1, exitType: 1, showAppPage: 1, templateSnapshot: 1 } });
  if (!user?.exit && !r && !journey) return undefined;
  const appPageFor = journey?.templateSnapshot?.settings?.appPageFor ?? ['resignation', 'retirement', 'end_of_contract'];
  const pageVisible = !!journey && (ob?.showAppPage ?? journey.showAppPage ?? appPageFor.includes(journey.exitType ?? 'resignation'));
  return {
    ...(journey ? { journeyId: journey.id } : {}), ...(r ? { resignationId: r.id } : {}),
    status: user?.exit || journey ? 'accepted' : r!.status,
    tl: journey?.tl ?? user?.exit?.lastWorkingDay ?? r?.lastDayByNotice,
    pageVisible,
  };
}

/** GET /lifecycle/offboarding — R3: the last day, Before you go, the handover, the exit interview, documents to save. */
export async function myOffboarding(userId: string, now = new Date()) {
  const { user, ob, journeyId } = await myExit(userId);
  const e = user.exit;
  const today = todayKey(now);
  const [tasks, items, journey, resignation] = await Promise.all([
    journeyTasksView(journeyId, 'employee'),
    handoverItems().find({ journeyId }, { projection: { _id: 0 } }).sort({ _id: 1 }).toArray(),
    journeys().findOne({ id: journeyId }, { projection: { _id: 0 } }),
    ob.resignationId ? resignations().findOne({ id: ob.resignationId }, { projection: { _id: 0 } }) : null,
  ]);
  const opens = interviewOpensKey(e, journey);
  const clearance = clearanceOf(e);
  const assets = clearance.filter((c) => c.team === 'it' || c.team === 'admin');
  const acceptedOn = keyOfInstant(journey?.anchors.exit_accepted ?? journey?.createdAt ?? null);
  const handoverDue = tasks.find((t) => t.systemKey === 'upload_handover')?.dueAt ?? null;
  const resignedOn = resignation ? keyOfInstant(resignation.submittedAt) : e.noticeFrom ?? null;
  const managerUserId = journey?.managerUserId ?? user.managerUserId;
  const managerName = managerUserId ? (await users().findOne({ userId: managerUserId }, { projection: { _id: 0, name: 1 } }))?.name : undefined;
  const summary = handoverSummary(items, ob, tasks);
  const acceptedAt = journey?.anchors.exit_accepted ?? journey?.createdAt ?? null;
  return {
    tl: e.lastWorkingDay,
    daysLeft: Math.max(0, daysFromTo(today, e.lastWorkingDay)),
    exitType: ob.exitType,
    acceptedOn,
    resignedOn,
    // What the app's R3 reads beside the contract's fields: the manager, when HR accepted and when the notice runs from.
    ...(managerName ? { managerName } : {}),
    acceptedAt: acceptedAt ? new Date(acceptedAt).toISOString() : null,
    noticeFrom: e.noticeFrom ?? resignedOn,
    tasks,
    handover: items.map(handoverView),
    handoverNote: ob.handoverNote ?? null,
    handoverDue: handoverDue ? keyOfInstant(new Date(handoverDue)) : null,
    handoverDueAt: summary.dueAt, handoverAddedAt: summary.addedAt, handoverDone: summary.done, handoverDoneAt: summary.doneAt,
    returnAssets: { done: assets.length > 0 && assets.every((c) => c.done), items: assets.map((c) => ({ label: c.label, done: c.done })) },
    interview: interviewApplies(ob) ? { applies: true, opensAt: opens, open: !!opens && opens <= today && today <= e.lastWorkingDay && !e.interview, sent: !!e.interview } : { applies: false, opensAt: null, open: false, sent: false },
    documents: [
      { kind: 'payslip' as const, label: 'Payslips', url: '/payslips/mine' },
      { kind: 'form16' as const, label: 'Form 16', url: '/payroll/form16' },
    ],
    settlement: { by: 'email' as const, after: e.lastWorkingDay },
  };
}

async function myItem(userId: string, itemId: string) {
  const { user, journeyId } = await myExit(userId);
  if (user.exit.accessEndedAt) throw new LifecycleError(409, 'Your access has ended');
  const item = await handoverItems().findOne({ id: itemId, journeyId, userId }, { projection: { _id: 0 } });
  if (!item) throw new LifecycleError(404, 'No such handover item');
  return { user, journeyId, item };
}

/** POST /lifecycle/offboarding/handover/:id — a file (multipart `file`) or `{ url }` against one checklist item. */
export async function uploadHandover(userId: string, itemId: string, input: { file?: UploadFile; url?: unknown }, now = new Date()) {
  const { user, journeyId, item } = await myItem(userId, itemId);
  let upload: NonNullable<HandoverItem['upload']>;
  if (input.file) {
    if (input.file.bytes.length > 10 * 1024 * 1024) throw new LifecycleError(413, 'A file must be 10 MB or smaller');
    upload = { kind: 'file', fileId: await storeFile(user.org, journeyId, userId, input.file, now), name: input.file.name.slice(0, 200), at: now };
  } else {
    const url = String(input.url ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) throw new LifecycleError(400, 'A link starts with https://');
    upload = { kind: 'link', url, name: url.replace(/^https?:\/\//i, '').slice(0, 80), at: now };
  }
  await handoverItems().updateOne({ id: item.id }, { $set: { upload } });
  const all = await handoverItems().find({ journeyId }, { projection: { _id: 0, upload: 1 } }).toArray();
  if (all.every((h) => !!h.upload)) await completeTask(journeyId, 'upload_handover', { userId, name: user.name });
  const journey = await journeys().findOne({ id: journeyId }, { projection: { _id: 0, managerUserId: 1 } });
  const first = firstName(user.name);
  await tellOffboarding([journey?.managerUserId ?? user.managerUserId], 'lifecycle_handover_uploaded', 'lifecycle_leaver', `${first} uploaded a handover item`, `${item.title} · ${all.filter((h) => !!h.upload).length} of ${all.length} uploaded.`, { userId, journeyId, itemId: item.id });
  return { item: handoverView({ ...item, upload }) };
}

/** DELETE /lifecycle/offboarding/handover/:id — removes the upload (to replace it). */
export async function removeHandoverUpload(userId: string, itemId: string) {
  const { item } = await myItem(userId, itemId);
  if (item.done) throw new LifecycleError(409, 'Your manager has marked the handover done');
  await handoverItems().updateOne({ id: item.id }, { $unset: { upload: '' } });
  return { item: handoverView({ ...item, upload: undefined }) };
}

/** GET /lifecycle/offboarding/handover/:id/file — the leaver's own upload, or (managers) their leaver's. */
export async function appHandoverFile(viewerUserId: string, itemId: string) {
  const viewer = await appUser(viewerUserId);
  const item = await handoverItems().findOne({ id: itemId, org: viewer.org }, { projection: { _id: 0 } });
  if (!item) throw new LifecycleError(404, 'No such handover item');
  if (item.userId !== viewerUserId) {
    const journey = await journeys().findOne({ id: item.journeyId }, { projection: { _id: 0, managerUserId: 1 } });
    const leaver = await users().findOne({ userId: item.userId }, { projection: { _id: 0, managerUserId: 1 } });
    if (journey?.managerUserId !== viewerUserId && leaver?.managerUserId !== viewerUserId) throw new LifecycleError(404, 'No such handover item');
  }
  return handoverFileFor(item);
}

/** GET /admin/lifecycle/offboarding/:userId/handover/:id/file — HR. */
export async function adminHandoverFile(actorUserId: string, employeeUserId: string, itemId: string) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  const item = await handoverItems().findOne({ id: itemId, org: actor.org, userId: employeeUserId }, { projection: { _id: 0 } });
  if (!item) throw new LifecycleError(404, 'No such handover item');
  return handoverFileFor(item);
}

const REASON_KEY: Record<string, string> = {
  growth: 'growth', pay: 'pay', manager: 'manager', 'work-life balance': 'work_life', work_life: 'work_life', 'the work itself': 'the_work', the_work: 'the_work',
  personal: 'personal', other: 'other', relocation: 'relocation', studies: 'studies', 'higher studies': 'studies',
};

/**
 * POST /lifecycle/offboarding/interview { reason, workingHere, manager, comeBack, change? } — R5, all optional,
 * once, from Tl − n to Tl. Saved to the exit (HR only, the shape HR's own form saves) and, apart from the
 * person, as an exit survey row: department, tenure band and month only, dated the first of the month.
 */
export async function sendExitInterview(userId: string, body: Record<string, unknown>, now = new Date()) {
  const { user, ob, journeyId } = await myExit(userId);
  const e = user.exit;
  if (!interviewApplies(ob)) throw new LifecycleError(404, 'There is no exit interview for this exit');
  if (e.interview) throw new LifecycleError(409, 'You have already sent your exit interview');
  const today = todayKey(now);
  const journey = await journeys().findOne({ id: journeyId }, { projection: { _id: 0 } });
  const opens = interviewOpensKey(e, journey);
  if (!opens || today < opens) throw new LifecycleError(409, `The exit interview opens on ${longDay(opens ?? e.lastWorkingDay)}`);
  if (today > e.lastWorkingDay) throw new LifecycleError(409, 'The exit interview closed on your last day');
  const rawReason = body.reason == null || body.reason === '' ? '' : String(body.reason).trim().toLowerCase();
  const reason = rawReason ? REASON_KEY[rawReason] : undefined;
  if (rawReason && !reason) throw new LifecycleError(400, 'The main reason is one of Growth, Pay, Manager, Work-life balance, The work itself, Personal, Other');
  const comeBack = body.comeBack == null || body.comeBack === '' ? undefined : String(body.comeBack).toLowerCase();
  const interview = readInterview({ reason, workRating: body.workingHere, managerRating: body.manager, comeBack, change: body.change }, { filledBy: 'employee', filledByName: user.name, filledAt: now });
  const set = await users().updateOne({ userId, org: user.org, 'exit.interview': { $exists: false } }, { $set: { 'exit.interview': interview, updatedAt: now } });
  if (!set.modifiedCount) throw new LifecycleError(409, 'You have already sent your exit interview');
  const month = today.slice(0, 7);
  await surveyResponses().insertOne({
    id: randomUUID(), org: user.org, kind: 'exit',
    ...(user.department ? { department: user.department } : {}),
    ...(tenureBand(user.joiningDate, e.lastWorkingDay) ? { tenureBand: tenureBand(user.joiningDate, e.lastWorkingDay) } : {}),
    month,
    answers: { reason: interview.reason ?? null, workingHere: interview.workRating ?? null, manager: interview.managerRating ?? null, comeBack: interview.comeBack ?? null, change: interview.change ?? null },
    // Dated the first of the month, so the row cannot be matched to the exit by the time it was sent.
    createdAt: new Date(`${month}-01T00:00:00+05:30`),
  });
  await completeTask(journeyId, 'exit_interview', { userId, name: user.name });
  return { sent: true };
}

// ———————————————————————————————————————————————— the app: the manager

async function myLeaver(managerUserId: string, leaverUserId: string) {
  const manager = await appUser(managerUserId);
  const leaver = await users().findOne({ userId: leaverUserId, org: manager.org });
  const journeyId = leaver?.exit?.offboarding?.journeyId;
  if (!leaver?.exit || !journeyId) throw new LifecycleError(404, 'No exit for this person');
  const journey = await journeys().findOne({ id: journeyId }, { projection: { _id: 0 } });
  if (leaver.managerUserId !== managerUserId && journey?.managerUserId !== managerUserId) throw new LifecycleError(404, 'No exit for this person');
  return { manager, leaver: leaver as User & { exit: UserExit; org: string }, journeyId, journey };
}

/** GET /lifecycle/manager/leavers — the manager's reports with an exit under way (not yet gone). */
export async function managerLeavers(managerUserId: string, now = new Date()) {
  const manager = await appUser(managerUserId);
  const today = todayKey(now);
  const rows = await users().find({ org: manager.org, managerUserId, 'exit.offboarding.journeyId': { $exists: true }, 'exit.accessEndedAt': { $exists: false } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, exit: 1 } }).toArray();
  const items = await handoverItems().find({ journeyId: { $in: rows.map((r) => r.exit!.offboarding!.journeyId!) } }, { projection: { _id: 0, journeyId: 1, upload: 1 } }).toArray();
  return {
    leavers: rows.map((r) => {
      const mine = items.filter((h) => h.journeyId === r.exit!.offboarding!.journeyId);
      return { userId: r.userId, name: r.name, designation: r.designation ?? '', tl: r.exit!.lastWorkingDay, daysLeft: daysFromTo(today, r.exit!.lastWorkingDay), handover: { items: mine.length, uploaded: mine.filter((h) => !!h.upload).length } };
    }),
  };
}

/** GET /lifecycle/manager/leavers/:userId — R8b: the status, the reason and note, the handover, the other exit steps. Never pay. */
export async function managerLeaver(managerUserId: string, leaverUserId: string, now = new Date()) {
  const { leaver, journeyId, journey } = await myLeaver(managerUserId, leaverUserId);
  const e = leaver.exit;
  const ob = e.offboarding!;
  const [items, tasks, resignation] = await Promise.all([
    handoverItems().find({ journeyId }, { projection: { _id: 0 } }).sort({ _id: 1 }).toArray(),
    journeyTasksView(journeyId, 'manager'),
    ob.resignationId ? resignations().findOne({ id: ob.resignationId }, { projection: { _id: 0 } }) : null,
  ]);
  const acceptedAt = journey?.anchors.exit_accepted ?? journey?.createdAt ?? null;
  const daysLeft = daysFromTo(todayKey(now), e.lastWorkingDay);
  const managerName = resignation?.managerUserId ? (await users().findOne({ userId: resignation.managerUserId }, { projection: { _id: 0, name: 1 } }))?.name : undefined;
  return {
    leaver: { userId: leaver.userId, name: leaver.name, designation: leaver.designation ?? '', department: leaver.department ?? '' },
    status: { exitType: ob.exitType, exitTypeLabel: EXIT_TYPE_LABEL[ob.exitType], acceptedOn: keyOfInstant(acceptedAt), tl: e.lastWorkingDay, daysLeft },
    // The app's R8b reads these at the top (an exit here is always accepted and under way).
    tl: e.lastWorkingDay, daysLeft, acceptedAt: acceptedAt ? new Date(acceptedAt).toISOString() : null,
    // The whole ResignationView (status, manager's answer, the last days), with the reason and note.
    resignation: resignation ? { ...resignationView(resignation, managerName, now), tl: e.lastWorkingDay, daysLeft } : null,
    handover: handoverSummary(items, ob, tasks),
    tasks,
    // Clearance by team (IT, Admin, Finance), as rows the app draws like tasks; never an amount.
    otherSteps: clearanceOf(e).filter((c) => c.team !== 'manager').map((c) => ({
      id: c.key, label: c.label, title: c.label, team: c.team ?? 'admin', ownerRole: c.team ?? 'admin', done: c.done, status: c.done ? 'done' : 'todo',
      helper: `Tracked by ${CLEARANCE_TEAM_LABEL[c.team ?? 'admin']}`,
    })),
  };
}

const CLEARANCE_TEAM_LABEL: Record<ClearanceTeam, string> = { manager: 'your manager', it: 'IT', admin: 'Admin', finance: 'Finance' };

/** The handover checklist for the app: the items, the manager's note, when it was shared and is due, whether it is done. */
function handoverSummary(items: HandoverItem[], ob: UserExitOffboarding, tasks: Awaited<ReturnType<typeof journeyTasksView>>) {
  const upload = tasks.find((t) => t.systemKey === 'upload_handover');
  const marked = tasks.find((t) => t.systemKey === 'mark_handover_done' && t.status === 'done');
  const shared = tasks.find((t) => t.systemKey === 'handover_checklist' && t.status === 'done');
  const addedAt = items.length ? shared?.doneAt ?? (ob.handoverNoteAt ? new Date(ob.handoverNoteAt).toISOString() : null) : null;
  const doneAt = marked?.doneAt ?? items.map((h) => h.doneAt).filter((d): d is Date => !!d).map((d) => d.toISOString()).sort().at(-1) ?? null;
  return {
    items: items.map(handoverView), note: ob.handoverNote ?? '', addedAt, dueAt: upload?.dueAt ?? null,
    done: !!marked, doneAt: marked ? doneAt : null,
  };
}

/** PUT /lifecycle/manager/leavers/:userId/handover { items: string[], note? } — the checklist and the note for the leaver. */
export async function setHandoverChecklist(managerUserId: string, leaverUserId: string, body: Record<string, unknown>, now = new Date()) {
  const { manager, leaver, journeyId } = await myLeaver(managerUserId, leaverUserId);
  if (leaver.exit.accessEndedAt) throw new LifecycleError(409, `${leaver.name} has left`);
  if (!Array.isArray(body.items)) throw new LifecycleError(400, 'items is a list of checklist titles');
  const titles = [...new Set((body.items as unknown[]).map((t) => String(t ?? '').trim().slice(0, 200)).filter(Boolean))];
  if (titles.length > 30) throw new LifecycleError(400, 'Up to 30 items');
  const existing = await handoverItems().find({ journeyId }, { projection: { _id: 0 } }).toArray();
  const keep = new Set(titles);
  const gone = existing.filter((h) => !keep.has(h.title));
  if (gone.length) await handoverItems().deleteMany({ id: { $in: gone.map((h) => h.id) } });
  const known = new Set(existing.map((h) => h.title));
  const added: HandoverItem[] = titles.filter((t) => !known.has(t)).map((title) => ({ id: randomUUID(), org: leaver.org, journeyId, userId: leaver.userId, title, createdByUserId: managerUserId, done: false }));
  if (added.length) await handoverItems().insertMany(added.map((h) => ({ ...h })));
  const note = body.note === undefined ? undefined : String(body.note ?? '').trim().slice(0, 1000);
  if (note !== undefined) await users().updateOne({ userId: leaver.userId, org: leaver.org }, { $set: { 'exit.offboarding.handoverNote': note, 'exit.offboarding.handoverNoteAt': now } });
  if (titles.length) await completeTask(journeyId, 'handover_checklist', { userId: managerUserId, name: manager.name });
  if (added.length && leaver.exit.offboarding?.showAppPage) {
    await tellOffboarding([leaver.userId], 'lifecycle_handover_shared', 'lifecycle_handover', `Handover checklist from ${firstName(manager.name)}`, `${titles.length} ${titles.length === 1 ? 'item' : 'items'} to share before your last day.`, { journeyId });
  }
  return managerLeaver(managerUserId, leaverUserId, now);
}

/** POST /lifecycle/manager/leavers/:userId/handover/done — the manager confirms the handover (the Manager clearance item too). */
export async function markHandoverDone(managerUserId: string, leaverUserId: string, now = new Date()) {
  const { manager, leaver, journeyId } = await myLeaver(managerUserId, leaverUserId);
  await handoverItems().updateMany({ journeyId }, { $set: { done: true, doneAt: now } });
  await completeTask(journeyId, 'mark_handover_done', { userId: managerUserId, name: manager.name });
  const item = clearanceOf(leaver.exit).find((c) => c.team === 'manager');
  if (item && !item.done) await tickClearanceItem(leaver.org, leaver, item.key, true, manager.name, {}, now);
  return managerLeaver(managerUserId, leaverUserId, now);
}

// ———————————————————————————————————————————————— timed jobs

/**
 * "On the last day, end of shift" (the template's `accountCloses: 'tl_end_of_shift'`): on Tl, once the
 * person's shift has ended (their shift policy's end time, IST), access ends then rather than at the
 * live job's Tl + 1. A shift that ends after midnight is left to that job (it ends on Tl + 1 anyway),
 * and so is every exit whose template says the day after (the default). An exit whose rules keep
 * access (`access: 'never'`) is left alone by endAccess itself.
 */
export async function closesAtEndOfShift(userId: string, tl: string, journey: Pick<Journey, 'templateSnapshot'> | null, now: Date): Promise<boolean> {
  if (journey?.templateSnapshot?.settings?.accountCloses !== 'tl_end_of_shift') return false;
  const p = istParts(now);
  if (p.dateKey !== tl) return false;
  let start = '09:00';
  let end = '18:00';
  try {
    const policy = await policyForUser(userId, tl);
    start = policy.startTime || start;
    end = policy.endTime || end;
  } catch (error) {
    logger.warn('Offboarding: no shift for the end-of-shift close; 18:00 is used', { userId, reason: error instanceof Error ? error.message : String(error) });
  }
  const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  if (minutes(end) <= minutes(start)) return false;
  return p.hour * 60 + p.minute >= minutes(end);
}

/**
 * Every hour, after closeDueExits (which ends access the day after Tl; not repeated here). Once each:
 * Tl − n the exit interview opens (push); access ended → the Close account task is done; Tl + 2
 * working days the settlement-due flag (journey status settlement_due); Tl + 30 gratuity due, when
 * eligible. The two pushes wait for 09:00 IST. Fired keys are kept on `user.exit.offboarding.fired`, so a second run sends nothing.
 */
export async function runOffboardingJobs(now = new Date()) {
  const today = todayKey(now);
  // Pushes go out in the day, from 09:00 IST (as the onboarding day jobs do); the state changes run every hour.
  const pushHours = istParts(now).hour >= 9;
  const rows = await users().find({ 'exit.offboarding.journeyId': { $exists: true }, ...scopedUsers() }, { projection: { _id: 0, userId: 1, org: 1, name: 1, joiningDate: 1, exit: 1 } }).toArray();
  const counts = { interviewOpened: 0, accountsClosed: 0, endOfShiftClosed: 0, settlementDue: 0, gratuityDue: 0 };
  for (const u of rows) {
    try {
      let e = u.exit!;
      const ob = e.offboarding!;
      const journeyId = ob.journeyId!;
      const journey = await journeys().findOne({ id: journeyId }, { projection: { _id: 0 } });
      if (!journey || journey.status === 'closed' || !u.org) continue;
      if (!scriptForcesFeatures(u.org) && !(await companies().findOne({ id: u.org, 'features.lifecycle': true }, { projection: { _id: 1 } }))) continue;
      const fired = new Set(ob.fired ?? []);
      const fire = async (key: string) => {
        const res = await users().updateOne({ userId: u.userId, 'exit.offboarding.fired': { $ne: key } }, { $push: { 'exit.offboarding.fired': key } });
        return res.modifiedCount === 1;
      };
      if (!e.accessEndedAt && (await closesAtEndOfShift(u.userId, e.lastWorkingDay, journey, now)) && (await endAccess(u.userId, now))) {
        counts.endOfShiftClosed++;
        e = (await users().findOne({ userId: u.userId }, { projection: { _id: 0, exit: 1 } }))?.exit ?? e;
      }
      const opens = interviewOpensKey(e, journey);
      if (pushHours && opens && opens <= today && today <= e.lastWorkingDay && !e.interview && !e.accessEndedAt && !fired.has('interview_open') && (await fire('interview_open'))) {
        await tellOffboarding([u.userId], 'lifecycle_exit_interview_open', 'lifecycle_exit_interview', 'Your exit interview is open', 'Five short questions, all optional. Your answers go to HR only.', { journeyId });
        counts.interviewOpened++;
      }
      if (e.accessEndedAt) {
        const done = await completeTask(journeyId, 'close_account', { name: 'Automatic' });
        if (done && !fired.has('account_closed') && (await fire('account_closed'))) counts.accountsClosed++;
      }
      const settlementTask = await journeyTasks().findOne({ journeyId, systemKey: 'final_settlement' }, { projection: { _id: 0, dueAt: 1 } });
      const settlementDue = keyOfInstant(settlementTask?.dueAt ?? null) ?? addWorkingDays(e.lastWorkingDay, 2);
      if (e.accessEndedAt && today >= settlementDue && !ob.settlementEmail && !fired.has('settlement_due') && (await fire('settlement_due'))) {
        await setJourneyStatus(journeyId, 'settlement_due');
        counts.settlementDue++;
      }
      const joined = keyOfInstant(u.joiningDate ?? null);
      if (pushHours && today >= addDays(e.lastWorkingDay, 30) && joined && serviceYears(joined, e.lastWorkingDay).completed >= 5 && !fired.has('gratuity_due') && (await fire('gratuity_due'))) {
        await tellOffboarding(await clearanceStaff(u.org), 'lifecycle_gratuity_due', 'lifecycle_clearance', `Gratuity due: ${u.name}`, `Gratuity is due within 30 days of the last day (${shortDay(e.lastWorkingDay)}).`, { userId: u.userId });
        counts.gratuityDue++;
      }
    } catch (error) {
      logger.error('Offboarding job failed for one exit', { userId: u.userId, org: u.org }, error);
    }
  }
  return counts;
}

/** The company's HR address for the statement's footer: the reply-to / contact address, else the person asking. */
async function hrEmailFor(org: string, fallback?: string): Promise<string> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, profile: 1 } });
  return company?.profile?.replyToEmail?.trim() || company?.profile?.primaryContactEmail?.trim() || fallback || '';
}

type Check = { ok: boolean; label: string };
export interface SettlementChecks {
  attendance: Check;
  clearance: { done: number; total: number; ok: boolean };
  salary: Check;
  personalEmail: { ok: boolean; value: string };
  /** What still stops "Approve and email" (HR may send anyway, with a reason). */
  blocking: string[];
}

/**
 * O3's "Before you send": the last month's attendance and payroll (no estimated salary line), clearance
 * n of 4, the salary status from payroll (the last month either on the statement or paid in a monthly
 * run), and a personal email to send the PDF to.
 */
async function checksFor(user: User & { exit: UserExit; org: string }, settlement: ExitSettlement | null): Promise<SettlementChecks> {
  const e = user.exit;
  const estimated = settlement?.lines.filter((l) => l.estimated) ?? [];
  const clearance = clearanceOf(e);
  const range = await payrollPeriodHolding(user.org, e.lastWorkingDay);
  const lastPeriod = range ? `${range.year}-${String(range.month).padStart(2, '0')}` : e.lastWorkingDay.slice(0, 7);
  const attendance: Check = estimated.length
    ? { ok: false, label: `${estimated.map((l) => (l.period ? monthName(l.period) : l.label)).join(', ')}: no payroll run yet, so the salary is an estimate` }
    : { ok: !!settlement, label: settlement ? `Payroll for ${monthName(lastPeriod)} is run` : 'Starts the day after the last working day' };
  let salary: Check;
  const onStatement = !!settlement?.lines.some((l) => l.key === `salary:${lastPeriod}`);
  if (!settlement) salary = { ok: false, label: 'Starts the day after the last working day' };
  else if (onStatement) salary = { ok: true, label: e.rules?.holdPay !== false ? `${monthName(lastPeriod)}: held${e.noticeFrom ? ` from ${shortDay(e.noticeFrom)}` : ''}, paid with the settlement` : `${monthName(lastPeriod)}: on the statement` };
  else {
    const slip = await payslips().findOne({ org: user.org, userId: user.userId, period: lastPeriod }, { projection: { _id: 0, held: 1 } });
    salary = slip && !slip.held ? { ok: true, label: `${monthName(lastPeriod)}: paid in the monthly run` }
      : { ok: false, label: `${monthName(lastPeriod)}: not on the statement or a payroll run yet` };
  }
  const personalEmail = { ok: !!user.personalEmail, value: user.personalEmail ?? '' };
  const done = clearance.filter((c) => c.done).length;
  const blocking = [
    ...(!attendance.ok ? ['Attendance and payroll for the last month'] : []),
    ...(done < clearance.length ? [`Clearance (${done} of ${clearance.length} done)`] : []),
    ...(!salary.ok ? ['Salary status from payroll'] : []),
  ];
  return { attendance, clearance: { done, total: clearance.length, ok: done === clearance.length }, salary, personalEmail, blocking };
}

/** The settlement's pre-send checks (O3), the email draft HR saved, and what the PDF's footer says. */
export async function settlementChecks(actorUserId: string, employeeUserId: string, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  if (!actor.viewer.seesPay) throw new LifecycleError(403, 'Only someone with payroll access can see a settlement');
  const user = await leaverFor(actor, employeeUserId);
  const settlement = await settlementFor(user, now);
  const checks = await checksFor(user, settlement);
  const draft = user.exit.offboarding?.settlementDraft;
  const actorEmail = (await users().findOne({ userId: actor.userId }, { projection: { _id: 0, email: 1 } }))?.email;
  const dueOn = keyOfInstant((await journeyTasks().findOne({ journeyId: user.exit.offboarding?.journeyId ?? '-', systemKey: 'final_settlement' }, { projection: { _id: 0, dueAt: 1 } }))?.dueAt ?? null) ?? addWorkingDays(user.exit.lastWorkingDay, 2);
  return {
    open: !!settlement,
    ...checks,
    dueOn,
    hrEmail: await hrEmailFor(actor.org, actorEmail),
    draft: draft ? { to: draft.to, subject: draft.subject, message: draft.message, savedAt: new Date(draft.savedAt).toISOString(), byName: draft.byName ?? '' } : null,
    teams: CLEARANCE_TEAMS,
  };
}

/** PUT /admin/lifecycle/offboarding/:userId/settlement/draft { to?, subject?, message? } — O3 "Save draft" (the lines are saved on the settlement as they change). */
export async function saveSettlementDraft(actorUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const actor = await dashboardActor(actorUserId);
  requireHr(actor);
  if (!actor.viewer.seesPay) throw new LifecycleError(403, 'Only someone with payroll access can see a settlement');
  const user = await leaverFor(actor, employeeUserId);
  const to = String(body.to ?? '').trim().toLowerCase().slice(0, 200);
  if (to && !EMAIL.test(to)) throw new LifecycleError(400, 'The email address is not valid');
  const draft = { to, subject: String(body.subject ?? '').trim().slice(0, 200), message: String(body.message ?? '').trim().slice(0, 4000), savedAt: now, ...(actor.name ? { byName: actor.name } : {}) };
  await users().updateOne({ userId: employeeUserId, org: actor.org }, {
    $set: { ...(user.exit.offboarding ? { 'exit.offboarding.settlementDraft': draft } : { 'exit.offboarding': { exitType: exitTypeOf(user.exit) ?? 'resignation', showAppPage: false, settlementDraft: draft } }), updatedAt: now },
  });
  return settlementChecks(actorUserId, employeeUserId, now);
}
