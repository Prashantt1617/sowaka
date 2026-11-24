/**
 * HR marks on an employee's calendar: tap a day on the dashboard, say what it
 * was. One mark per person per day, in the current month or in a month whose
 * payroll run is still open (a draft run being checked). Every place that
 * grades a day reads these first (see `overridesFor`), and the org report's
 * cache is dropped on every write so payroll and the report see it at once.
 */
import { ObjectId } from 'mongodb';
import { attendanceMarkRemovals, attendanceOverrides, leaves, payrollRuns, users } from '../config/db';
import { AttendanceOverride, HR_DAY_STATUSES, HrDayStatus } from '../models/attendance.model';
import { invalidateAttendanceReport, joinedOn } from './attendance-report.service';
import { payrollPeriodHolding } from './payroll-inputs.service';
import { leaveTypeRulesFor, todayIso } from './shift.service';

export class AttendanceOverrideError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'AttendanceOverrideError';
  }
}

/** The pay month HR is working in, by Indian time. */
export function currentMonthIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** Marks for these people across a date range, keyed `userId|YYYY-MM-DD`. */
export async function overridesFor(userIds: string[], from: string, to: string): Promise<Map<string, AttendanceOverride>> {
  if (userIds.length === 0) return new Map();
  const rows = await attendanceOverrides()
    .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to } }, { projection: { _id: 0 } })
    .toArray();
  return new Map(rows.map((row) => [`${row.userId}|${row.workDate}`, row]));
}

async function adminAndEmployee(adminUserId: string, userId: string) {
  // A mark moves pay, so HR never settles their own day; another admin does,
  // the same way nobody approves their own correction request.
  if (userId === adminUserId) {
    throw new AttendanceOverrideError(403, 'You cannot mark your own attendance');
  }
  const [admin, employee] = await Promise.all([
    users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1, name: 1 } }),
    users().findOne({ userId }, { projection: { _id: 0, org: 1, userId: 1, joiningDate: 1 } }),
  ]);
  if (!admin?.org) throw new AttendanceOverrideError(403, 'No organisation on this account');
  if (!employee) throw new AttendanceOverrideError(404, 'Employee not found');
  if (employee.org !== admin.org) throw new AttendanceOverrideError(403, 'This employee belongs to another organisation');
  return { org: admin.org, adminName: admin.name, joined: joinedOn(employee) };
}

/**
 * The current month or pay period, or an earlier one whose payroll run is
 * still open (a draft, or one submitted before runs were final), so HR can
 * settle the days a run pays from. Once that run is submitted, its days stay
 * as paid. A run pays the dates kept on it (a company paying 26th to 25th);
 * a run made before runs kept them paid its calendar month.
 */
type RunWindow = { period: string; periodFrom?: string; periodTo?: string; status: string };
interface DateContext { runs: RunWindow[]; current: { from: string; to: string } | null; today: string; month: string }

async function dateContext(org: string): Promise<DateContext> {
  const today = todayIso();
  const [runs, current] = await Promise.all([
    payrollRuns().find({ org, status: { $in: ['approved', 'paid', 'draft', 'pending_approval'] } }, { projection: { _id: 0, period: 1, periodFrom: 1, periodTo: 1, status: 1 } }).toArray() as Promise<RunWindow[]>,
    payrollPeriodHolding(org, today),
  ]);
  return { runs, current: current ? { from: current.from, to: current.to } : null, today, month: currentMonthIst() };
}

/** Why this day can't be marked now, or null when it can (one rule for saving and for the calendar). */
function refusal(workDate: string, ctx: DateContext): AttendanceOverrideError | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(workDate)) {
    return new AttendanceOverrideError(400, 'The day must be YYYY-MM-DD');
  }
  const month = workDate.slice(0, 7);
  const pays = (r: RunWindow) => (r.periodFrom ? r.periodFrom <= workDate && workDate <= (r.periodTo ?? r.periodFrom) : r.period === month);
  const finished = ctx.runs.find((r) => (r.status === 'approved' || r.status === 'paid') && pays(r));
  if (finished) return new AttendanceOverrideError(409, `Payroll for ${finished.period} is submitted: its days can no longer be changed`);
  if (month === ctx.month) return null;
  if (ctx.current && ctx.current.from <= workDate && workDate <= ctx.current.to) return null;
  const open = workDate < ctx.today && ctx.runs.some((r) => (r.status === 'draft' || r.status === 'pending_approval') && pays(r));
  if (!open) return new AttendanceOverrideError(400, 'Only the current month or pay period, or one whose payroll run is still open, can be corrected');
  return null;
}

async function checkDate(workDate: string, org: string) {
  const error = refusal(workDate, await dateContext(org));
  if (error) throw error;
}

/**
 * Which of these days HR may mark for this person now, by the same rule a save
 * checks (`checkDate` and the joining date): the dashboard calendar opens
 * exactly these, so a company paying 26th to 25th can settle 26–31 of last
 * month while that pay period is open. Nothing for HR's own calendar.
 */
export async function markableDates(adminUserId: string, userId: string, dates: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  let who: Awaited<ReturnType<typeof adminAndEmployee>>;
  try {
    who = await adminAndEmployee(adminUserId, userId);
  } catch {
    return out;
  }
  const ctx = await dateContext(who.org);
  for (const date of dates) {
    if (who.joined && date < who.joined) continue;
    if (!refusal(date, ctx)) out.add(date);
  }
  return out;
}

/** UTC midnight of a YYYY-MM-DD day, as leave rows keep their dates. */
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The approved leave row an "On leave" mark wrote, cancelled when the mark changes or goes (its day goes back to the balance). */
async function releaseMarkLeave(prev: AttendanceOverride | null, adminUserId: string, keepId?: string) {
  if (!prev?.leaveId || prev.leaveId === keepId || !ObjectId.isValid(prev.leaveId)) return;
  const now = new Date();
  await leaves().updateOne(
    { _id: new ObjectId(prev.leaveId), status: 'approved' },
    { $set: { status: 'cancelled', cancelledAt: now, cancelledByUserId: adminUserId, cancelledByRole: 'admin', cancelNote: "HR changed the day's mark", updatedAt: now } },
  );
}

/**
 * What an "On leave" mark takes (24 Nov 2026, HR: "when I mark someone on leave their leave balance
 * should be deducted, and it should ask which leave"). A day an approved leave already covers needs
 * nothing more. Otherwise HR names the leave type: a paid type needs a day left in this year's balance;
 * the mark then writes an approved one-day leave of that type (HR's own, decided by them), which every
 * balance, the leave history and payroll read like any other leave.
 */
async function leaveForMark(org: string, adminUserId: string, userId: string, workDate: string, typeInput: unknown, note: string, prev: AttendanceOverride | null) {
  const day = dayDate(workDate);
  const covering = await leaves().findOne({ userId, status: 'approved', startDate: { $lte: day }, endDate: { $gte: day } });
  const rules = await leaveTypeRulesFor(userId);
  if (covering && String(covering._id) !== prev?.leaveId) {
    const rule = rules.find((r) => r.key === covering.type);
    return { leaveType: rule?.name ?? covering.type, unpaid: Boolean(rule?.unpaid) };
  }
  const key = String(typeInput ?? '').trim();
  if (!key) throw new AttendanceOverrideError(400, 'Pick which leave this day comes out of');
  const rule = rules.find((r) => r.key === key || r.name.toLowerCase() === key.toLowerCase());
  if (!rule) throw new AttendanceOverrideError(400, `Their leave types are: ${rules.map((r) => r.name).join(', ')}`);
  // The same leave as the mark already took: nothing new to take.
  if (covering && String(covering._id) === prev?.leaveId && covering.type === rule.key) {
    return { leaveType: rule.name, unpaid: Boolean(rule.unpaid), leaveId: prev.leaveId };
  }
  if (!rule.unpaid) {
    const { getMyLeaveBalance } = await import('./leave.service');
    const balance = await getMyLeaveBalance(userId, Number(workDate.slice(0, 4)), day);
    const item = balance.types.find((t) => t.key === rule.key) as { remaining?: number } | undefined;
    // The day this mark took before is given back first, when it was the same type.
    const back = covering && String(covering._id) === prev?.leaveId && covering.type === rule.key ? 1 : 0;
    const available = (item?.remaining ?? 0) + back;
    if (available < 1) {
      throw new AttendanceOverrideError(409, `Only ${Math.max(0, available)} day${available === 1 ? '' : 's'} of ${rule.name} left. Pick another leave type or leave without pay.`);
    }
  }
  const now = new Date();
  const { insertedId } = await leaves().insertOne({
    userId, type: rule.key, startDate: day, endDate: day, days: 1,
    reason: note || 'Marked on leave by HR on the calendar',
    status: 'approved', decidedByUserId: adminUserId, decidedByRole: 'admin', decidedAt: now,
    createdAt: now.getTime(), updatedAt: now,
  });
  void org;
  return { leaveType: rule.name, unpaid: Boolean(rule.unpaid), leaveId: String(insertedId) };
}

export async function setAttendanceOverride(
  adminUserId: string,
  userId: string,
  workDate: string,
  input: { status?: unknown; note?: unknown; leaveType?: unknown },
) {
  const status = String(input.status ?? '') as HrDayStatus;
  if (!HR_DAY_STATUSES.includes(status)) {
    throw new AttendanceOverrideError(400, `Mark the day as one of: ${HR_DAY_STATUSES.join(', ')}`);
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  const { org, adminName, joined } = await adminAndEmployee(adminUserId, userId);
  await checkDate(workDate, org);
  // Not theirs to mark: payroll counts the days before joining on its own.
  if (joined && workDate < joined) throw new AttendanceOverrideError(400, `They joined on ${joined}: days before that cannot be marked`);
  const prev = await attendanceOverrides().findOne({ org, userId, workDate }, { projection: { _id: 0 } }) as AttendanceOverride | null;
  const leave = status === 'on_leave' ? await leaveForMark(org, adminUserId, userId, workDate, input.leaveType, note, prev) : null;
  const doc: AttendanceOverride = {
    org, userId, workDate, status,
    ...(note ? { note } : {}),
    setByUserId: adminUserId,
    ...(adminName ? { setByName: adminName } : {}),
    setAt: new Date(),
    ...(leave ? { leaveType: leave.leaveType, ...(leave.unpaid ? { unpaid: true } : {}), ...(leave.leaveId ? { leaveId: leave.leaveId } : {}) } : {}),
  };
  await attendanceOverrides().replaceOne({ org, userId, workDate }, doc, { upsert: true });
  await releaseMarkLeave(prev, adminUserId, leave?.leaveId);
  if (leave?.leaveId || prev?.leaveId) (await import('./leave.service')).leaveRowChanged(userId);
  invalidateAttendanceReport(org);
  return doc;
}

export async function clearAttendanceOverride(adminUserId: string, userId: string, workDate: string) {
  const { org } = await adminAndEmployee(adminUserId, userId);
  await checkDate(workDate, org);
  const prev = await attendanceOverrides().findOne({ org, userId, workDate }, { projection: { _id: 0 } }) as AttendanceOverride | null;
  const result = await attendanceOverrides().deleteOne({ org, userId, workDate });
  // An "On leave" mark's own leave goes with it: the day returns to their balance.
  await releaseMarkLeave(prev, adminUserId);
  if (prev?.leaveId) (await import('./leave.service')).leaveRowChanged(userId);
  invalidateAttendanceReport(org);
  return { removed: result.deletedCount === 1 };
}

/**
 * HR takes the late or left-early mark off one day (or puts it back), keeping
 * the day as the punches grade it. Same rules as a day mark: another admin,
 * same company, an open month or pay period, not before joining.
 */
export async function setMarkRemoved(adminUserId: string, userId: string, workDate: string, input: { mark?: unknown; removed?: unknown }) {
  const mark = input.mark === 'late' || input.mark === 'early' ? input.mark : null;
  if (!mark) throw new AttendanceOverrideError(400, 'Say which mark: late or early');
  const removed = input.removed !== false;
  const { org, adminName, joined } = await adminAndEmployee(adminUserId, userId);
  await checkDate(workDate, org);
  if (joined && workDate < joined) throw new AttendanceOverrideError(400, `They joined on ${joined}: days before that cannot be changed`);
  if (removed) {
    await attendanceMarkRemovals().updateOne(
      { org, userId, workDate },
      { $set: { [mark]: true, setByUserId: adminUserId, ...(adminName ? { setByName: adminName } : {}), setAt: new Date() } },
      { upsert: true },
    );
  } else {
    await attendanceMarkRemovals().updateOne({ org, userId, workDate }, { $unset: { [mark]: '' } });
    await attendanceMarkRemovals().deleteOne({ org, userId, workDate, late: { $exists: false }, early: { $exists: false } });
  }
  invalidateAttendanceReport(org);
  return { userId, workDate, mark, removed };
}
