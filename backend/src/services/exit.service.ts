/**
 * Exits: HR records that someone is leaving (People › Employee › Record exit).
 *
 * Until their last working day they are on notice and nothing changes for
 * them. From the day after (the hourly job, at 00:00 IST, or at once when HR
 * ends access) they are offboarded (terminated, for a termination or an
 * absconding): every request they make is refused (the auth middleware checks
 * the status), their saved sessions and device tokens are deleted so nothing
 * reaches the phone, and payroll pays nothing after the last working day
 * (payrollRun.service, attendance-report.service).
 *
 * Their records (attendance, leave, payslips, documents) all stay.
 * A recorded exit can be withdrawn while access has not ended yet.
 */
import { authSessions, companies, deviceTokens, exitSettlements, users } from '../config/db';
import { AdminError } from './admin.service';
import { forgetAuthUser } from './auth-cache';
import { invalidateAttendanceSetup } from './attendance-report.service';
import { logActivity } from './employee-activity.service';
import { istParts } from './notification-time';
import { CLEARANCE_TEAM_OF, DEFAULT_EXIT_CLEARANCE, DEFAULT_EXIT_NOTICE, DEFAULT_EXIT_RULES, EXIT_INTERVIEW_REASONS, EXIT_KINDS, EXIT_NOTICE_CHOICES, EXIT_RULE_CHOICES, EXIT_RULE_KINDS, ExitClearanceItem, ExitInterview, ExitInterviewReason, ExitKind, ExitNoticeSettings, ExitRuleKind, ExitRules, User, UserExit, UserLifecycleStatus } from '../models/user.model';
import { ExitSettlement } from '../models/exitSettlement.model';
import { approveSettlement, changeSettlementLine, draftDueSettlements, exitNoticeSettings, markSettlementPaid, reopenSettlement, settlementFor, settlementOpen, settlementView } from './exitSettlement.service';
import { notifyUsers } from './notification.service';
import { scopedUsers } from './lifecycle/scriptScope';
import { logger } from '../utils/logger';

/** An AdminError, so the error handler answers with its status and message. */
export class ExitError extends AdminError {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_LABEL: Record<ExitKind, string> = { resigned: 'Resigned', terminated: 'Terminated', absconded: 'Absconded', retired: 'Retired', other: 'Other' };
/** What someone becomes once access ends: a termination or an absconding reads as terminated. */
const statusAfter = (kind: ExitKind): UserLifecycleStatus => (kind === 'terminated' || kind === 'absconded' ? 'terminated' : 'offboarded');
const LEFT: UserLifecycleStatus[] = ['offboarded', 'terminated'];

const todayIst = (now: Date) => istParts(now).dateKey;
const asDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

async function requireExitAdmin(adminUserId: string) {
  const admin = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, userId: 1, org: 1, name: 1, dashboardAdmin: 1 } });
  if (!admin?.org) throw new ExitError(403, 'No organisation on this account');
  if (admin.dashboardAdmin !== true) throw new ExitError(403, 'Only a dashboard admin can record or change an exit');
  // A company feature: off unless Sowaka switched it on for this company (companies.features.exits).
  const company = await companies().findOne({ id: admin.org }, { projection: { _id: 0, features: 1 } });
  if (company?.features?.exits !== true) throw new ExitError(403, 'Exits are not switched on for this company');
  return admin as Pick<User, 'userId' | 'org' | 'name' | 'dashboardAdmin'> & { org: string };
}

// ———————————————————————————————————————————————— exit rules (Setup › Payroll › Exit settings)

const RULE_KEYS = Object.keys(EXIT_RULE_CHOICES) as (keyof ExitRules)[];

/** One set of rules from a body, every key checked against its choices; `base` fills what is not given. */
function readRules(raw: unknown, base: ExitRules, label: string): ExitRules {
  if (raw == null) return { ...base };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ExitError(400, `${label} must be an object`);
  const out = { ...base } as Record<keyof ExitRules, unknown>;
  for (const key of RULE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (!(EXIT_RULE_CHOICES[key] as unknown[]).includes(v)) throw new ExitError(400, `${label}: ${key} must be one of ${EXIT_RULE_CHOICES[key].join(', ')}`);
    out[key] = v;
  }
  return out as ExitRules;
}

/** The company's rules for every kind: what HR saved, else the defaults (and which is which). */
async function companyRules(org: string) {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitRules: 1 } });
  const saved = company?.exitRules ?? {};
  // Only the rules that still exist (older saves may carry ones since removed).
  const known = (r: Partial<ExitRules> | undefined) => Object.fromEntries(RULE_KEYS.filter((k) => r?.[k] !== undefined).map((k) => [k, r![k]]));
  return EXIT_RULE_KINDS.map((kind) => ({ kind, rules: { ...DEFAULT_EXIT_RULES[kind], ...known(saved[kind]) } as ExitRules, isDefault: !saved[kind] }));
}

async function companyNoticeDays(org: string): Promise<number | null> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNoticeDays: 1 } });
  return typeof company?.exitNoticeDays === 'number' ? company.exitNoticeDays : null;
}

const settingsOf = async (org: string) => ({ kinds: await companyRules(org), defaults: DEFAULT_EXIT_RULES, noticeDays: await companyNoticeDays(org), notice: await exitNoticeSettings(org), noticeDefaults: DEFAULT_EXIT_NOTICE });

export async function exitSettings(adminUserId: string) {
  const admin = await requireExitAdmin(adminUserId);
  return settingsOf(admin.org);
}

/** Save the company's rules. Body: { kinds: { resigned: {...}, … } }; a kind sent as null goes back to the default. */
export async function setExitSettings(adminUserId: string, body: Record<string, unknown>) {
  const admin = await requireExitAdmin(adminUserId);
  const raw = body.kinds ?? {};
  if (typeof raw !== 'object') throw new ExitError(400, 'kinds must be an object of rules per kind of exit');
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  // The notice period exits start from: whole days, 0 to 365; null clears it.
  if (body.noticeDays !== undefined) {
    if (body.noticeDays === null || body.noticeDays === '') $unset.exitNoticeDays = '';
    else {
      const n = Number(body.noticeDays);
      if (!Number.isInteger(n) || n < 0 || n > 365) throw new ExitError(400, 'Notice period is whole days, 0 to 365');
      $set.exitNoticeDays = n;
    }
  }
  // How the notice lines are worked out, and when the team is told. Only what is sent changes.
  if (body.notice !== undefined && body.notice !== null) {
    if (typeof body.notice !== 'object') throw new ExitError(400, 'notice must be an object');
    const n = body.notice as Record<string, unknown>;
    for (const key of ['recoveryBasis', 'noticePayBasis'] as const) {
      if (n[key] === undefined) continue;
      if (!(EXIT_NOTICE_CHOICES[key] as readonly unknown[]).includes(n[key])) throw new ExitError(400, `${key} must be one of ${EXIT_NOTICE_CHOICES[key].join(', ')}`);
      $set[`exitNotice.${key}`] = n[key];
    }
    if (n.leaveCoversShortfall !== undefined) $set['exitNotice.leaveCoversShortfall'] = n.leaveCoversShortfall === true;
    if (n.teamNoticeDays !== undefined) {
      const days = Number(n.teamNoticeDays);
      if (!Number.isInteger(days) || days < 0 || days > 90) throw new ExitError(400, 'Tell the team: whole days, 0 to 90');
      $set['exitNotice.teamNoticeDays'] = days;
    }
  }
  for (const [kind, rules] of Object.entries(raw as Record<string, unknown>)) {
    if (!EXIT_RULE_KINDS.includes(kind as ExitRuleKind)) throw new ExitError(400, `Unknown kind of exit: ${kind}`);
    if (rules === null) { $unset[`exitRules.${kind}`] = ''; continue; }
    $set[`exitRules.${kind}`] = readRules(rules, DEFAULT_EXIT_RULES[kind as ExitRuleKind], kind);
  }
  if (!Object.keys($set).length && !Object.keys($unset).length) return settingsOf(admin.org);
  const done = await companies().updateOne({ id: admin.org }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  if (done.matchedCount === 0) throw new ExitError(404, 'Company not found');
  return settingsOf(admin.org);
}

/** The clearance list of an exit: its own, else the list every exit starts with. Every item has its team. */
export const clearanceOf = (e: UserExit): ExitClearanceItem[] =>
  (e.clearance ?? DEFAULT_EXIT_CLEARANCE.map((c) => ({ ...c, done: false }))).map((c) => (c.team || !CLEARANCE_TEAM_OF[c.key] ? c : { ...c, team: CLEARANCE_TEAM_OF[c.key] }));

type ExitUser = Pick<User, 'userId' | 'name' | 'employeeId' | 'department' | 'designation' | 'managerUserId' | 'joiningDate' | 'lifecycleStatus' | 'exit'>;
interface ExitExtras { settlement?: Pick<ExitSettlement, 'status' | 'payablePaise'> | null; names?: Map<string, string>; team?: number }

/** How an exit reads on the dashboard. */
export function exitView(user: ExitUser, now = new Date(), extras: ExitExtras = {}) {
  const e = user.exit!;
  const today = todayIst(now);
  const state = e.accessEndedAt ? 'left' : e.lastWorkingDay < today ? 'leaving' : 'notice';
  const settlement = extras.settlement ?? null;
  // Where they are on the way out: working their notice, waiting for the settlement, or done.
  const stage = !e.accessEndedAt ? 'notice' : settlement?.status === 'paid' ? 'left' : 'settlement_due';
  const clearance = clearanceOf(e);
  return {
    userId: user.userId,
    name: user.name,
    employeeId: user.employeeId ?? '',
    department: user.department ?? '',
    designation: user.designation ?? '',
    joiningDate: keyOf(user.joiningDate) ?? null,
    kind: e.kind,
    kindLabel: KIND_LABEL[e.kind],
    noticeFrom: e.noticeFrom ?? null,
    lastWorkingDay: e.lastWorkingDay,
    noticeDays: e.noticeDays ?? null,
    note: e.note ?? '',
    recordedByName: e.recordedByName ?? '',
    recordedAt: e.recordedAt.toISOString(),
    accessEndedAt: e.accessEndedAt ? e.accessEndedAt.toISOString() : null,
    /** The rules this exit follows (exits recorded before rules existed read as their kind's default). */
    rules: e.rules ?? DEFAULT_EXIT_RULES[e.kind],
    /** notice: still working; leaving: past the last day, access ends within the hour; left: access ended. */
    state,
    stage,
    status: user.lifecycleStatus,
    /** Their team, when they lead one: who takes it over, and whether it has moved. */
    team: e.newManagerUserId
      ? { newManagerUserId: e.newManagerUserId, newManagerName: extras.names?.get(e.newManagerUserId) ?? '', move: e.teamMove ?? 'now', movedAt: e.teamMovedAt ? e.teamMovedAt.toISOString() : null, toldAt: e.teamToldAt ? e.teamToldAt.toISOString() : null, size: extras.team ?? 0 }
      : null,
    clearance: clearance.map((c) => ({ key: c.key, label: c.label, done: c.done, doneAt: c.doneAt ? c.doneAt.toISOString() : null, doneByName: c.doneByName ?? '', team: c.team ?? null, ...(c.amountPaise ? { amountPaise: c.amountPaise } : {}), ...(c.note ? { note: c.note } : {}) })),
    clearanceDone: clearance.every((c) => c.done),
    interview: e.interview ? { ...e.interview, filledAt: e.interview.filledAt.toISOString() } : null,
    /** An absconding waits for HR to close the case before its settlement starts. */
    caseOpen: e.kind === 'absconded' && !!e.accessEndedAt && !e.caseClosedAt,
    caseClosedAt: e.caseClosedAt ? e.caseClosedAt.toISOString() : null,
    settlement: settlement ? { status: settlement.status, payablePaise: settlement.payablePaise } : null,
  };
}

const EXIT_PROJECTION = { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, managerUserId: 1, joiningDate: 1, lifecycleStatus: 1, exit: 1 } as const;

/** One exit with what its row shows: the settlement so far and the new manager's name. */
async function viewOf(org: string, user: ExitUser, now: Date) {
  const e = user.exit!;
  const [settlement, manager, team] = await Promise.all([
    exitSettlements().findOne({ org, userId: user.userId }, { projection: { _id: 0, status: 1, payablePaise: 1 } }),
    e.newManagerUserId ? users().findOne({ userId: e.newManagerUserId }, { projection: { _id: 0, userId: 1, name: 1 } }) : null,
    e.newManagerUserId && !e.teamMovedAt ? users().countDocuments({ org, managerUserId: user.userId, lifecycleStatus: { $nin: LEFT } }) : 0,
  ]);
  return exitView(user, now, { settlement, names: new Map(manager ? [[manager.userId, manager.name]] : []), team });
}

/** Every recorded exit in the company, the most recent last working day first. */
export async function listExits(adminUserId: string, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  const rows = await users().find({ org: admin.org, exit: { $exists: true } }, { projection: EXIT_PROJECTION }).toArray();
  const [settlements, managers] = await Promise.all([
    exitSettlements().find({ org: admin.org }, { projection: { _id: 0, userId: 1, status: 1, payablePaise: 1 } }).toArray(),
    users().find({ userId: { $in: rows.map((u) => u.exit?.newManagerUserId).filter((id): id is string => !!id) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray(),
  ]);
  const byUser = new Map(settlements.map((s) => [s.userId, s]));
  const names = new Map(managers.map((m) => [m.userId, m.name]));
  return rows.map((u) => exitView(u as User, now, { settlement: byUser.get(u.userId) ?? null, names })).sort((a, b) => b.lastWorkingDay.localeCompare(a.lastWorkingDay));
}

/** One person's exit, in full: the row, and the final settlement once it has started. */
export async function exitDetail(adminUserId: string, employeeUserId: string, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  const user = await users().findOne({ userId: employeeUserId, org: admin.org });
  if (!user?.exit) throw new ExitError(404, 'No exit recorded for this employee');
  const settlement = await settlementFor(user as User, now);
  const company = await companies().findOne({ id: admin.org }, { projection: { _id: 0, name: 1, address: 1, profile: 1 } }) as { name?: string; address?: string; profile?: Record<string, string | undefined> } | null;
  const pr = company?.profile ?? {};
  const address = [pr.addressLine1, pr.addressLine2, pr.city, pr.state, pr.pincode].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  return {
    exit: await viewOf(admin.org, user as User, now),
    settlement: settlement ? settlementView(settlement) : null,
    company: { name: pr.registeredName?.trim() || company?.name || admin.org, address: address || company?.address || '', org: admin.org },
  };
}

/**
 * Record or change someone's exit. Body: { kind, lastWorkingDay, noticeFrom?, noticeDays?, note?, newManagerUserId?, moveTeamNow?, endAccessNow? }.
 * Anyone who reports to them moves to `newManagerUserId` (required when they have a team) the day
 * after the last working day, so the leaving manager still approves during notice; at once when
 * `moveTeamNow`, or when access ends now.
 */
export async function recordExit(adminUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  if (employeeUserId === admin.userId) throw new ExitError(400, 'You cannot record your own exit');
  const employee = await users().findOne({ userId: employeeUserId, org: admin.org });
  if (!employee) throw new ExitError(404, 'Employee not found');
  if (employee.exit?.accessEndedAt) throw new ExitError(409, `${employee.name} has already left; their exit can no longer be changed`);

  const kind = String(body.kind ?? '') as ExitKind;
  if (!EXIT_KINDS.includes(kind)) throw new ExitError(400, `Pick why they are leaving: ${EXIT_KINDS.join(', ')}`);
  const lastWorkingDay = String(body.lastWorkingDay ?? '').trim();
  if (!DATE.test(lastWorkingDay) || Number.isNaN(asDate(lastWorkingDay).valueOf())) throw new ExitError(400, 'Last working day is a date like 2026-11-30');
  const joined = keyOf(employee.joiningDate);
  if (joined && lastWorkingDay < joined) throw new ExitError(400, `The last working day can't be before they joined (${joined})`);
  const noticeFromRaw = body.noticeFrom == null ? '' : String(body.noticeFrom).trim();
  if (noticeFromRaw && !DATE.test(noticeFromRaw)) throw new ExitError(400, 'Notice from is a date like 2026-11-01');
  if (noticeFromRaw && noticeFromRaw > lastWorkingDay) throw new ExitError(400, 'The notice can\'t start after the last working day');
  let noticeDays: number | undefined;
  if (body.noticeDays != null && body.noticeDays !== '') {
    noticeDays = Number(body.noticeDays);
    if (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365) throw new ExitError(400, 'Notice period is whole days, 0 to 365');
  }
  const note = body.note == null ? '' : String(body.note).trim().slice(0, 1000);

  // Their team needs a new manager before they go.
  const team = await users().countDocuments({ org: admin.org, managerUserId: employeeUserId, lifecycleStatus: { $nin: LEFT } });
  const newManagerUserId = body.newManagerUserId == null ? '' : String(body.newManagerUserId).trim();
  if (team > 0) {
    if (!newManagerUserId) throw new ExitError(409, `${team} ${team === 1 ? 'person reports' : 'people report'} to ${employee.name}. Pick who they report to next.`);
    if (newManagerUserId === employeeUserId) throw new ExitError(400, 'Pick someone other than the person leaving');
    const next = await users().findOne({ userId: newManagerUserId, org: admin.org, lifecycleStatus: { $nin: LEFT } }, { projection: { _id: 0, userId: 1, exit: 1 } });
    if (!next) throw new ExitError(400, 'The new manager must be someone still working here');
  }

  // The company's rules for this kind, with HR's changes for this person.
  const forKind = (await companyRules(admin.org)).find((k) => k.kind === kind)!.rules;
  const rules = readRules(body.rules, forKind, 'rules');
  if (rules.access === 'never') throw new ExitError(400, 'Someone who leaves must lose app access: pick "the day after" or "at once"');

  const moveNow = body.moveTeamNow === true || body.endAccessNow === true || rules.access === 'at_once' || lastWorkingDay < todayIst(now);
  const exit: UserExit = {
    kind,
    rules,
    lastWorkingDay,
    ...(noticeFromRaw ? { noticeFrom: noticeFromRaw } : {}),
    ...(noticeDays !== undefined ? { noticeDays } : {}),
    ...(note ? { note } : {}),
    recordedByUserId: admin.userId,
    ...(admin.name ? { recordedByName: admin.name } : {}),
    recordedAt: employee.exit?.recordedAt ?? now,
    // The team moves the day after the last day, so they still approve during notice; at once when HR
    // says so, or when access ends now (a termination, an absconding, a last day already past).
    ...(team > 0 ? { newManagerUserId, teamMove: moveNow ? 'now' as const : 'day_after' as const } : {}),
    // What HR has already ticked, said or closed on this exit stays when its dates change.
    ...(employee.exit?.clearance ? { clearance: employee.exit.clearance } : {}),
    ...(employee.exit?.interview ? { interview: employee.exit.interview } : {}),
    // The offboarding journey's side of the exit (lifecycle companies) stays too.
    ...(employee.exit?.offboarding ? { offboarding: employee.exit.offboarding } : {}),
    ...(employee.exit?.teamToldAt && employee.exit.newManagerUserId === newManagerUserId ? { teamToldAt: employee.exit.teamToldAt } : {}),
  };
  await users().updateOne(
    { userId: employeeUserId, org: admin.org },
    { $set: { exit, endDate: asDate(lastWorkingDay), lifecycleStatus: 'notice', noticeStatus: 'serving', updatedAt: now } },
  );
  if (team > 0 && moveNow) await moveTeam(admin.org, employeeUserId, now);
  invalidateAttendanceSetup(admin.org);
  forgetAuthUser(employeeUserId);
  void logActivity({ org: admin.org, userId: employeeUserId, byUserId: admin.userId, kind: 'details', title: `Exit recorded: ${KIND_LABEL[kind].toLowerCase()}, last working day ${lastWorkingDay}` });

  // Already past the last day, or HR asked to end access now.
  if (body.endAccessNow === true || rules.access === 'at_once' || lastWorkingDay < todayIst(now)) await endAccess(employeeUserId, now);
  const after = await users().findOne({ userId: employeeUserId });
  return viewOf(admin.org, after as User, now);
}

/** Withdraw an exit that has not taken effect: they stay employed as before. */
export async function withdrawExit(adminUserId: string, employeeUserId: string, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  const employee = await users().findOne({ userId: employeeUserId, org: admin.org });
  if (!employee?.exit) throw new ExitError(404, 'No exit recorded for this employee');
  if (employee.exit.accessEndedAt) throw new ExitError(409, `${employee.name} has already left. To bring them back, add them again as a new joiner.`);
  await users().updateOne(
    { userId: employeeUserId, org: admin.org },
    { $unset: { exit: '', endDate: '' }, $set: { lifecycleStatus: 'active', noticeStatus: 'none', updatedAt: now } },
  );
  invalidateAttendanceSetup(admin.org);
  forgetAuthUser(employeeUserId);
  void logActivity({ org: admin.org, userId: employeeUserId, byUserId: admin.userId, kind: 'details', title: 'Exit withdrawn' });
  return { userId: employeeUserId, withdrawn: true };
}

/** HR's "End access now" (a termination, an absconding): the same as the day after, at once. */
export async function endAccessNow(adminUserId: string, employeeUserId: string, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  const employee = await users().findOne({ userId: employeeUserId, org: admin.org }, { projection: { _id: 0, exit: 1 } });
  if (!employee?.exit) throw new ExitError(409, 'Record their exit first');
  await endAccess(employeeUserId, now);
  const after = await users().findOne({ userId: employeeUserId });
  return viewOf(admin.org, after as User, now);
}

/**
 * Access ends: status Left, saved sessions and device tokens deleted, the cached auth user
 * forgotten so the very next request is refused. Safe to run twice. (Exported for the
 * offboarding template's "On the last day, end of shift", lifecycle/offboarding.ts.)
 */
export async function endAccess(employeeUserId: string, now: Date) {
  const user = await users().findOne({ userId: employeeUserId }, { projection: { _id: 0, org: 1, exit: 1 } });
  if (!user?.exit || user.exit.accessEndedAt || user.exit.rules?.access === 'never') return false;
  await users().updateOne(
    { userId: employeeUserId, 'exit.accessEndedAt': { $exists: false } },
    { $set: { lifecycleStatus: statusAfter(user.exit.kind), noticeStatus: 'completed', 'exit.accessEndedAt': now, updatedAt: now } },
  );
  forgetAuthUser(employeeUserId);
  await Promise.all([authSessions().deleteMany({ userId: employeeUserId }), deviceTokens().deleteMany({ userId: employeeUserId })]);
  // Their team reports to the new manager from now, if it has not moved already.
  if (user.org) await moveTeam(user.org, employeeUserId, now);
  if (user.org) invalidateAttendanceSetup(user.org);
  return true;
}

const firstName = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'Your manager';
const shortDay = (key: string) => asDate(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayAfter = (key: string) => new Date(asDate(key).getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * The team of someone leaving starts reporting to the new manager: requests they raise from now
 * go there, and so does anything still waiting (requests are routed by the person's manager).
 * The team and the new manager are told. Safe to run twice.
 */
async function moveTeam(org: string, leaverUserId: string, now: Date) {
  const leaver = await users().findOne({ userId: leaverUserId, org }, { projection: { _id: 0, name: 1, exit: 1 } });
  const to = leaver?.exit?.newManagerUserId;
  if (!leaver?.exit || !to || leaver.exit.teamMovedAt) return 0;
  const team = await users().find({ org, managerUserId: leaverUserId, lifecycleStatus: { $nin: LEFT } }, { projection: { _id: 0, userId: 1 } }).toArray();
  await users().updateOne({ userId: leaverUserId, org }, { $set: { 'exit.teamMovedAt': now } });
  if (!team.length) return 0;
  const ids = team.map((t) => t.userId).filter((id) => id !== to);
  await users().updateMany({ org, userId: { $in: ids } }, { $set: { managerUserId: to, updatedAt: now } });
  const manager = await users().findOne({ userId: to }, { projection: { _id: 0, name: 1 } });
  void logActivity({ org, userId: leaverUserId, byUserId: leaverUserId, kind: 'details', title: `Team of ${ids.length} now reports to ${manager?.name ?? 'the new manager'}` });
  try {
    await notifyUsers(ids, { scenario: 'exit_team_moved', title: 'Your manager has changed', body: `You now report to ${manager?.name ?? 'a new manager'}.`, data: { type: 'team', managerUserId: to } });
    await notifyUsers([to], { scenario: 'exit_team_joined', title: 'New team members', body: `${firstName(leaver.name)}'s team of ${ids.length} now reports to you.`, data: { type: 'team' } });
  } catch (error) {
    logger.warn('Exit: the team move could not be announced', { org, leaverUserId, reason: error instanceof Error ? error.message : String(error) });
  }
  return ids.length;
}

/**
 * The heads-up before the move: the team and the new manager are told a few days before the last
 * day (Exit settings; at once when the notice is shorter than that), after the leaving manager
 * has normally told them in person.
 */
export async function tellTeamsAhead(now = new Date()) {
  const today = todayIst(now);
  const due = await users()
    .find({ 'exit.newManagerUserId': { $exists: true }, 'exit.teamMove': 'day_after', 'exit.teamMovedAt': { $exists: false }, 'exit.teamToldAt': { $exists: false }, 'exit.accessEndedAt': { $exists: false }, ...scopedUsers() }, { projection: { _id: 0, userId: 1, org: 1, name: 1, exit: 1 } })
    .toArray();
  let told = 0;
  for (const leaver of due) {
    try {
      if (!leaver.org || !leaver.exit) continue;
      const { teamNoticeDays } = await exitNoticeSettings(leaver.org);
      const daysLeft = Math.round((Date.parse(leaver.exit.lastWorkingDay) - Date.parse(today)) / 86_400_000);
      if (daysLeft > teamNoticeDays) continue;
      const to = leaver.exit.newManagerUserId!;
      const [team, manager] = await Promise.all([
        users().find({ org: leaver.org, managerUserId: leaver.userId, lifecycleStatus: { $nin: LEFT } }, { projection: { _id: 0, userId: 1 } }).toArray(),
        users().findOne({ userId: to }, { projection: { _id: 0, name: 1 } }),
      ]);
      await users().updateOne({ userId: leaver.userId }, { $set: { 'exit.teamToldAt': now } });
      const ids = team.map((t) => t.userId).filter((id) => id !== to);
      if (!ids.length) continue;
      const moveOn = shortDay(dayAfter(leaver.exit.lastWorkingDay));
      await notifyUsers(ids, { scenario: 'exit_team_heads_up', title: 'Your manager is changing', body: `From ${moveOn} you'll report to ${manager?.name ?? 'a new manager'}. ${firstName(leaver.name)}'s last day is ${shortDay(leaver.exit.lastWorkingDay)}.`, data: { type: 'team', managerUserId: to } });
      await notifyUsers([to], { scenario: 'exit_team_heads_up_manager', title: 'New team members soon', body: `${firstName(leaver.name)}'s team of ${ids.length} will report to you from ${moveOn}.`, data: { type: 'team' } });
      told++;
    } catch (error) {
      logger.error('Exit: the team could not be told ahead', { userId: leaver.userId, org: leaver.org }, error);
    }
  }
  return told;
}

/** The hourly job: everyone whose last working day is before today (IST) and still has access, loses it. */
export async function closeDueExits(now = new Date()) {
  const due = await users()
    .find({ exit: { $exists: true }, 'exit.accessEndedAt': { $exists: false }, 'exit.lastWorkingDay': { $lt: todayIst(now) }, ...scopedUsers() }, { projection: { _id: 0, userId: 1, org: 1 } })
    .toArray();
  let closed = 0;
  for (const u of due) {
    try { if (await endAccess(u.userId, now)) closed++; }
    catch (error) { logger.error('Exit: access could not be ended', { userId: u.userId, org: u.org }, error); }
  }
  if (closed) logger.info('Exit: access ended after the last working day', { closed });
  // The settlement starts itself the day after the last day; teams hear a few days before theirs moves.
  try { await draftDueSettlements(now); } catch (error) { logger.error('Exit: settlement drafts failed', {}, error); }
  try { await tellTeamsAhead(now); } catch (error) { logger.error('Exit: team heads-up failed', {}, error); }
  return closed;
}

// ———————————————————————————————————————————————— clearance, interview, the absconding case

async function leaverOf(adminUserId: string, employeeUserId: string) {
  const admin = await requireExitAdmin(adminUserId);
  const user = await users().findOne({ userId: employeeUserId, org: admin.org });
  if (!user?.exit) throw new ExitError(404, 'No exit recorded for this employee');
  return { admin, user: user as User & { exit: UserExit } };
}

/** HR ticks (or unticks) one item of the clearance list. Body: { key, done }. */
export async function setClearance(adminUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const { admin, user } = await leaverOf(adminUserId, employeeUserId);
  await tickClearanceItem(admin.org, user, String(body.key ?? ''), body.done === true, admin.name, {}, now);
  return exitDetail(adminUserId, employeeUserId, now);
}

/**
 * Ticks (or unticks) one clearance item, keeping its team; `extra` sets or clears an open amount
 * (paise; null clears) and a note. Who may is the caller's to check: HR above, and the Offboarding
 * board for the IT, Admin and Finance staff who clear their own team's items.
 */
export async function tickClearanceItem(
  org: string, user: Pick<User, 'userId'> & { exit: UserExit }, key: string, done: boolean, byName: string | undefined,
  extra: { amountPaise?: number | null; note?: string | null } = {}, now = new Date(),
): Promise<ExitClearanceItem[]> {
  const list = clearanceOf(user.exit);
  if (!list.some((c) => c.key === key)) throw new ExitError(404, 'No such item on the clearance list');
  const next = list.map((c) => {
    if (c.key !== key) return c;
    const { doneAt: _at, doneByName: _by, amountPaise: _amount, note: _note, ...rest } = c;
    const amountPaise = extra.amountPaise === undefined ? c.amountPaise : extra.amountPaise ?? undefined;
    const note = extra.note === undefined ? c.note : extra.note?.trim().slice(0, 300) || undefined;
    return { ...rest, done, ...(done ? { doneAt: now, ...(byName ? { doneByName: byName } : {}) } : {}), ...(amountPaise ? { amountPaise } : {}), ...(note ? { note } : {}) };
  });
  await users().updateOne({ userId: user.userId, org }, { $set: { 'exit.clearance': next, updatedAt: now } });
  return next;
}

/** HR fills the exit interview after a conversation (the employee can also, from the app). */
export async function saveInterview(adminUserId: string, employeeUserId: string, body: Record<string, unknown>, now = new Date()) {
  const { admin } = await leaverOf(adminUserId, employeeUserId);
  const interview = readInterview(body, { filledBy: 'hr', filledByName: admin.name, filledAt: now });
  await users().updateOne({ userId: employeeUserId, org: admin.org }, { $set: { 'exit.interview': interview, updatedAt: now } });
  return exitDetail(adminUserId, employeeUserId, now);
}

export function readInterview(body: Record<string, unknown>, by: Pick<ExitInterview, 'filledBy' | 'filledByName' | 'filledAt'>): ExitInterview {
  const rating = (v: unknown, label: string) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ExitError(400, `${label} is 1 to 5`);
    return n;
  };
  const reason = body.reason == null || body.reason === '' ? undefined : String(body.reason);
  if (reason && !(EXIT_INTERVIEW_REASONS as readonly string[]).includes(reason)) throw new ExitError(400, `The main reason is one of ${EXIT_INTERVIEW_REASONS.join(', ')}`);
  const comeBack = body.comeBack == null || body.comeBack === '' ? undefined : String(body.comeBack);
  if (comeBack && !['yes', 'maybe', 'no'].includes(comeBack)) throw new ExitError(400, 'Would they come back: yes, maybe or no');
  const workRating = rating(body.workRating, 'Working here');
  const managerRating = rating(body.managerRating, 'Their manager');
  const change = body.change == null ? '' : String(body.change).trim().slice(0, 2000);
  return {
    ...(reason ? { reason: reason as ExitInterviewReason } : {}),
    ...(workRating ? { workRating } : {}),
    ...(managerRating ? { managerRating } : {}),
    ...(comeBack ? { comeBack: comeBack as ExitInterview['comeBack'] } : {}),
    ...(change ? { change } : {}),
    filledBy: by.filledBy,
    ...(by.filledByName ? { filledByName: by.filledByName } : {}),
    filledAt: by.filledAt,
  };
}

/** An absconding: HR closes the case (letters sent, no reply), which starts the settlement. */
export async function closeCase(adminUserId: string, employeeUserId: string, now = new Date()) {
  const { admin, user } = await leaverOf(adminUserId, employeeUserId);
  if (user.exit.kind !== 'absconded') throw new ExitError(409, 'Only an absconding has a case to close');
  if (!user.exit.accessEndedAt) throw new ExitError(409, 'Turn off their app first');
  if (!user.exit.caseClosedAt) await users().updateOne({ userId: employeeUserId, org: admin.org }, { $set: { 'exit.caseClosedAt': now, ...(admin.name ? { 'exit.caseClosedByName': admin.name } : {}), updatedAt: now } });
  return exitDetail(adminUserId, employeeUserId, now);
}

// ———————————————————————————————————————————————— the final settlement

/** Change a line (Body: { amountPaise, reason }; amountPaise null puts it back), approve, reopen, or mark paid. */
export async function settlementAction(adminUserId: string, employeeUserId: string, action: 'line' | 'approve' | 'reopen' | 'paid', body: Record<string, unknown>, now = new Date()) {
  const { admin, user } = await leaverOf(adminUserId, employeeUserId);
  if (!settlementOpen(user.exit)) throw new ExitError(409, user.exit.kind === 'absconded' ? 'Close the case first: an absconding is settled only once HR closes it' : 'The settlement starts the day after their last working day');
  const by = { userId: admin.userId, name: admin.name };
  if (action === 'line') await changeSettlementLine(admin.org, user, String(body.key ?? ''), body, by, now);
  else if (action === 'approve') await approveSettlement(admin.org, user, body, by, now);
  else if (action === 'reopen') await reopenSettlement(admin.org, user, now);
  else await markSettlementPaid(admin.org, user, by, now);
  void logActivity({ org: admin.org, userId: employeeUserId, byUserId: admin.userId, kind: 'details', title: action === 'line' ? 'Final settlement: a line changed' : action === 'approve' ? 'Final settlement approved' : action === 'reopen' ? 'Final settlement reopened' : 'Final settlement paid' });
  return exitDetail(adminUserId, employeeUserId, now);
}
