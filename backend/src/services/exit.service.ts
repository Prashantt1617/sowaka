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
import { authSessions, deviceTokens, users } from '../config/db';
import { AdminError } from './admin.service';
import { forgetAuthUser } from './auth-cache';
import { invalidateAttendanceSetup } from './attendance-report.service';
import { logActivity } from './employee-activity.service';
import { istParts } from './notification-time';
import { EXIT_KINDS, ExitKind, User, UserExit, UserLifecycleStatus } from '../models/user.model';
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
  return admin as Pick<User, 'userId' | 'org' | 'name' | 'dashboardAdmin'> & { org: string };
}

/** How an exit reads on the dashboard. */
export function exitView(user: Pick<User, 'userId' | 'name' | 'employeeId' | 'department' | 'designation' | 'managerUserId' | 'joiningDate' | 'lifecycleStatus' | 'exit'>, now = new Date()) {
  const e = user.exit!;
  const today = todayIst(now);
  const state = e.accessEndedAt ? 'left' : e.lastWorkingDay < today ? 'leaving' : 'notice';
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
    /** notice: still working; leaving: past the last day, access ends within the hour; left: access ended. */
    state,
    status: user.lifecycleStatus,
  };
}

/** Every recorded exit in the company, the most recent last working day first. */
export async function listExits(adminUserId: string, now = new Date()) {
  const admin = await requireExitAdmin(adminUserId);
  const rows = await users()
    .find({ org: admin.org, exit: { $exists: true } }, { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, designation: 1, managerUserId: 1, joiningDate: 1, lifecycleStatus: 1, exit: 1 } })
    .toArray();
  return rows.map((u) => exitView(u as User, now)).sort((a, b) => b.lastWorkingDay.localeCompare(a.lastWorkingDay));
}

/**
 * Record or change someone's exit. Body: { kind, lastWorkingDay, noticeFrom?, noticeDays?, note?, newManagerUserId?, endAccessNow? }.
 * Anyone who reports to them moves to `newManagerUserId` now (required when they have a team),
 * so new requests go to the new manager while they serve their notice.
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

  const exit: UserExit = {
    kind,
    lastWorkingDay,
    ...(noticeFromRaw ? { noticeFrom: noticeFromRaw } : {}),
    ...(noticeDays !== undefined ? { noticeDays } : {}),
    ...(note ? { note } : {}),
    recordedByUserId: admin.userId,
    ...(admin.name ? { recordedByName: admin.name } : {}),
    recordedAt: employee.exit?.recordedAt ?? now,
    ...(team > 0 ? { newManagerUserId } : {}),
  };
  await users().updateOne(
    { userId: employeeUserId, org: admin.org },
    { $set: { exit, endDate: asDate(lastWorkingDay), lifecycleStatus: 'notice', noticeStatus: 'serving', updatedAt: now } },
  );
  if (team > 0) {
    await users().updateMany({ org: admin.org, managerUserId: employeeUserId, lifecycleStatus: { $nin: LEFT } }, { $set: { managerUserId: newManagerUserId, updatedAt: now } });
  }
  invalidateAttendanceSetup(admin.org);
  forgetAuthUser(employeeUserId);
  void logActivity({ org: admin.org, userId: employeeUserId, byUserId: admin.userId, kind: 'details', title: `Exit recorded: ${KIND_LABEL[kind].toLowerCase()}, last working day ${lastWorkingDay}` });

  // Already past the last day, or HR asked to end access now.
  if (body.endAccessNow === true || lastWorkingDay < todayIst(now)) await endAccess(employeeUserId, now);
  const after = await users().findOne({ userId: employeeUserId });
  return exitView(after as User, now);
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
  return exitView(after as User, now);
}

/**
 * Access ends: status Left, saved sessions and device tokens deleted, the cached auth user
 * forgotten so the very next request is refused. Safe to run twice.
 */
async function endAccess(employeeUserId: string, now: Date) {
  const user = await users().findOne({ userId: employeeUserId }, { projection: { _id: 0, org: 1, exit: 1 } });
  if (!user?.exit || user.exit.accessEndedAt) return false;
  await users().updateOne(
    { userId: employeeUserId, 'exit.accessEndedAt': { $exists: false } },
    { $set: { lifecycleStatus: statusAfter(user.exit.kind), noticeStatus: 'completed', 'exit.accessEndedAt': now, updatedAt: now } },
  );
  forgetAuthUser(employeeUserId);
  await Promise.all([authSessions().deleteMany({ userId: employeeUserId }), deviceTokens().deleteMany({ userId: employeeUserId })]);
  if (user.org) invalidateAttendanceSetup(user.org);
  return true;
}

/** The hourly job: everyone whose last working day is before today (IST) and still has access, loses it. */
export async function closeDueExits(now = new Date()) {
  const due = await users()
    .find({ exit: { $exists: true }, 'exit.accessEndedAt': { $exists: false }, 'exit.lastWorkingDay': { $lt: todayIst(now) } }, { projection: { _id: 0, userId: 1, org: 1 } })
    .toArray();
  let closed = 0;
  for (const u of due) {
    try { if (await endAccess(u.userId, now)) closed++; }
    catch (error) { logger.error('Exit: access could not be ended', { userId: u.userId, org: u.org }, error); }
  }
  if (closed) logger.info('Exit: access ended after the last working day', { closed });
  return closed;
}
