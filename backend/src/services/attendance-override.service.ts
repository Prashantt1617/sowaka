/**
 * HR marks on an employee's calendar: tap a day on the dashboard, say what it
 * was. One mark per person per day, current month only. Every place that
 * grades a day reads these first (see `overridesFor`), and the org report's
 * cache is dropped on every write so payroll and the report see it at once.
 */
import { attendanceOverrides, users } from '../config/db';
import { AttendanceOverride, HR_DAY_STATUSES, HrDayStatus } from '../models/attendance.model';
import { invalidateAttendanceReport } from './attendance-report.service';

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
    users().findOne({ userId }, { projection: { _id: 0, org: 1, userId: 1 } }),
  ]);
  if (!admin?.org) throw new AttendanceOverrideError(403, 'No organisation on this account');
  if (!employee) throw new AttendanceOverrideError(404, 'Employee not found');
  if (employee.org !== admin.org) throw new AttendanceOverrideError(403, 'This employee belongs to another organisation');
  return { org: admin.org, adminName: admin.name };
}

function checkDate(workDate: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(workDate)) {
    throw new AttendanceOverrideError(400, 'The day must be YYYY-MM-DD');
  }
  if (workDate.slice(0, 7) !== currentMonthIst()) {
    throw new AttendanceOverrideError(400, 'Only days in the current month can be corrected here');
  }
}

export async function setAttendanceOverride(
  adminUserId: string,
  userId: string,
  workDate: string,
  input: { status?: unknown; note?: unknown },
) {
  checkDate(workDate);
  const status = String(input.status ?? '') as HrDayStatus;
  if (!HR_DAY_STATUSES.includes(status)) {
    throw new AttendanceOverrideError(400, `Mark the day as one of: ${HR_DAY_STATUSES.join(', ')}`);
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  const { org, adminName } = await adminAndEmployee(adminUserId, userId);
  const doc: AttendanceOverride = {
    org, userId, workDate, status,
    ...(note ? { note } : {}),
    setByUserId: adminUserId,
    ...(adminName ? { setByName: adminName } : {}),
    setAt: new Date(),
  };
  await attendanceOverrides().replaceOne({ org, userId, workDate }, doc, { upsert: true });
  invalidateAttendanceReport(org);
  return doc;
}

export async function clearAttendanceOverride(adminUserId: string, userId: string, workDate: string) {
  checkDate(workDate);
  const { org } = await adminAndEmployee(adminUserId, userId);
  const result = await attendanceOverrides().deleteOne({ org, userId, workDate });
  invalidateAttendanceReport(org);
  return { removed: result.deletedCount === 1 };
}
