/**
 * The dashboard's Punch log: every day someone punched, in an office or out of
 * location, with where each punch was taken. One row per person per day, read
 * straight from the attendance records; an out-of-location punch still waiting
 * on its manager has no record yet, so its request stands in for the day.
 *
 * Also the company's pay cycle (this one and the one before), which the
 * Attendance Corrections page closes its "Before payroll" count against.
 */
import { attendanceRecords, attendanceRegularizations } from '../config/db';
import type { PunchLocation } from '../models/office.model';
import { orgUsers } from './admin-scope';
import { placeLabel } from './geofence.service';
import { outsideLocationView } from './attendance.service';
import { payrollPeriodHolding } from './payroll-inputs.service';
import { requireOrg } from './shift.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export class PunchLogError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function where(loc?: PunchLocation) {
  if (!loc) return null;
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    accuracy: loc.accuracy ?? null,
    officeName: loc.officeName ?? null,
    distanceMeters: loc.distanceMeters ?? null,
    /** Matched an office, and not punched deliberately off-site. */
    inOffice: Boolean(loc.officeId) && loc.offsite !== true,
    mocked: loc.mocked === true,
    place: loc.officeId && loc.offsite !== true ? (loc.officeName ?? 'Office') : placeLabel(loc.distanceMeters, loc.officeName),
  };
}

export async function punchLogForAdmin(adminUserId: string, from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new PunchLogError(400, 'from and to must be YYYY-MM-DD');
  if (from > to) throw new PunchLogError(400, 'from must not be after to');
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 92) throw new PunchLogError(400, 'Pick at most three months');
  const people = await orgUsers(adminUserId, ['userId', 'name', 'employeeId', 'department', 'managerUserId']);
  if (!people.length) return [];
  const byId = new Map(people.map((p) => [p.userId, p]));
  const userIds = people.map((p) => p.userId);
  const [records, waiting] = await Promise.all([
    attendanceRecords()
      .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, $or: [{ punchIn: { $exists: true } }, { punchOut: { $exists: true } }, { outsideLocation: { $exists: true } }] })
      .project({ userId: 1, workDate: 1, punchIn: 1, punchOut: 1, punchInLocation: 1, punchOutLocation: 1, outsideLocation: 1, punchInFace: 1, dayType: 1 })
      .toArray(),
    attendanceRegularizations()
      .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, kind: 'out_of_location', status: 'pending' })
      .toArray(),
  ]);
  const who = (userId: string) => {
    const p = byId.get(userId);
    return { userId, name: p?.name ?? 'Employee', employeeCode: p?.employeeId ?? '', department: p?.department ?? '', manager: byId.get(p?.managerUserId ?? '')?.name ?? '' };
  };
  const seen = new Set<string>();
  const rows = records.map((r) => {
    seen.add(`${r.userId}|${r.workDate}`);
    return {
      ...who(String(r.userId ?? '')),
      workDate: String(r.workDate),
      punchIn: r.punchIn ? new Date(r.punchIn).toISOString() : null,
      punchOut: r.punchOut ? new Date(r.punchOut).toISOString() : null,
      inLocation: where(r.punchInLocation as PunchLocation | undefined),
      outLocation: where(r.punchOutLocation as PunchLocation | undefined),
      outside: outsideLocationView(r.outsideLocation) ?? null,
      face: r.punchInFace ? { similarity: r.punchInFace.similarity ?? null, liveness: r.punchInFace.liveness } : null,
      dayType: r.dayType ?? null,
      waiting: false,
    };
  });
  for (const q of waiting) {
    if (seen.has(`${q.userId}|${q.workDate}`)) continue;
    const outside = outsideLocationView(q.outsideLocation) ?? null;
    rows.push({
      ...who(q.userId),
      workDate: q.workDate,
      punchIn: outside && outside.punchType === 'in' ? outside.at : null,
      punchOut: outside && outside.punchType === 'out' ? outside.at : null,
      inLocation: null,
      outLocation: null,
      outside,
      face: null,
      dayType: null,
      waiting: true,
    });
  }
  return rows.sort((a, b) => (a.workDate === b.workDate ? (b.punchIn ?? '').localeCompare(a.punchIn ?? '') : b.workDate.localeCompare(a.workDate)));
}

/** This pay cycle and the one before, as payroll reads them (a 26th–25th cycle, or the month). */
export async function payCycleForAdmin(adminUserId: string, today: string) {
  const org = await requireOrg(adminUserId);
  const current = await payrollPeriodHolding(org, today);
  if (!current) return { current: null, previous: null };
  const dayBefore = new Date(Date.parse(`${current.from}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const previous = await payrollPeriodHolding(org, dayBefore);
  return {
    current: { from: current.from, to: current.to },
    previous: previous ? { from: previous.from, to: previous.to } : null,
  };
}
