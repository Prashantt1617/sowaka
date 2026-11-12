/**
 * The dashboard's Punch log: every day someone punched, in an office or out of
 * location, with where each punch was taken. One row per person per day, read
 * straight from the attendance records; an out-of-location punch still waiting
 * on its manager has no record yet, so its request stands in for the day.
 *
 * Also the company's pay cycle (this one and the one before), which the
 * Attendance Corrections page closes its "Before payroll" count against.
 * None when HR has not set one.
 */
import { attendanceRecords, attendanceRegularizations, payrollPeriods } from '../config/db';
import type { PunchLocation } from '../models/office.model';
import { orgUsers } from './admin-scope';
import { placeLabel } from './geofence.service';
import { outsideLocationView } from './attendance.service';
import { payrollPeriodHolding } from './payroll-inputs.service';
import { requireOrg } from './shift.service';
import { cachedSwr, refreshSwr } from './swr-cache';

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

/**
 * `faceChecks`: whether the viewer may see face check results (the Face ID
 * tab). Without it no face data is sent at all; with it only passed or failed,
 * never the match score.
 */
export async function punchLogForAdmin(adminUserId: string, from: string, to: string, opts: { faceChecks?: boolean } = {}) {
  if (!DATE.test(from) || !DATE.test(to)) throw new PunchLogError(400, 'from and to must be YYYY-MM-DD');
  if (from > to) throw new PunchLogError(400, 'from must not be after to');
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 92) throw new PunchLogError(400, 'Pick at most three months');
  const org = await requireOrg(adminUserId);
  // The punches are the slow part (a month of them is seconds on this database tier): kept per
  // org and range, answered at once and refreshed behind the reader (swr-cache).
  const rows = await cachedSwr(org, 'punch-log', { from, to }, () => punchRows(adminUserId, from, to));
  if (!opts.faceChecks) return rows.map(({ facePassed: _facePassed, ...row }) => ({ ...row, face: null }));
  // Face check results only for a viewer with Face ID access, and only passed or failed:
  // a punch the face check refused went to a request instead, so that day's check failed.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const refused = userIds.length
    ? await attendanceRegularizations()
        .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, kind: 'face_check' })
        .project<{ userId: string; workDate: string }>({ _id: 0, userId: 1, workDate: 1 })
        .toArray()
    : [];
  const faceRefused = new Set(refused.map((q) => `${q.userId}|${q.workDate}`));
  return rows.map(({ facePassed, ...row }) => ({
    ...row,
    face: (facePassed ? 'passed' : faceRefused.has(`${row.userId}|${row.workDate}`) ? 'failed' : null) as 'passed' | 'failed' | null,
  }));
}

/** Works the range out again now and keeps it (the background warm-up's way in). */
export function warmPunchLog(adminUserId: string, org: string, from: string, to: string) {
  return refreshSwr(org, 'punch-log', { from, to }, () => punchRows(adminUserId, from, to));
}

/** Everyone's punches in the range (and out-of-location punches still waiting), newest first. */
async function punchRows(adminUserId: string, from: string, to: string) {
  const people = await orgUsers(adminUserId, ['userId', 'name', 'employeeId', 'department', 'managerUserId']);
  if (!people.length) return [];
  const byId = new Map(people.map((p) => [p.userId, p]));
  const userIds = people.map((p) => p.userId);
  const [records, waiting] = await Promise.all([
    attendanceRecords()
      .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, $or: [{ punchIn: { $exists: true } }, { punchOut: { $exists: true } }, { outsideLocation: { $exists: true } }] })
      // Only what a row shows: of the face check, just whether there was one.
      .project({ userId: 1, workDate: 1, punchIn: 1, punchOut: 1, punchInLocation: 1, punchOutLocation: 1, outsideLocation: 1, 'punchInFace.at': 1, dayType: 1 })
      .toArray(),
    attendanceRegularizations()
      .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, kind: 'out_of_location', status: 'pending' })
      .project({ userId: 1, workDate: 1, outsideLocation: 1 })
      .toArray(),
  ]);
  const who = (userId: string) => {
    const p = byId.get(userId);
    return { userId, name: p?.name ?? 'Employee', employeeCode: p?.employeeId ?? '', department: p?.department ?? '', manager: byId.get(p?.managerUserId ?? '')?.name ?? '' };
  };
  const seen = new Set<string>();
  const rows: {
    userId: string; name: string; employeeCode: string; department: string; manager: string;
    workDate: string; punchIn: string | null; punchOut: string | null;
    inLocation: ReturnType<typeof where>; outLocation: ReturnType<typeof where>;
    outside: ReturnType<typeof outsideLocationView> | null; facePassed: boolean; dayType: string | null; waiting: boolean;
  }[] = records.map((r) => {
    seen.add(`${r.userId}|${r.workDate}`);
    return {
      ...who(String(r.userId ?? '')),
      workDate: String(r.workDate),
      punchIn: r.punchIn ? new Date(r.punchIn).toISOString() : null,
      punchOut: r.punchOut ? new Date(r.punchOut).toISOString() : null,
      inLocation: where(r.punchInLocation as PunchLocation | undefined),
      outLocation: where(r.punchOutLocation as PunchLocation | undefined),
      outside: outsideLocationView(r.outsideLocation) ?? null,
      facePassed: Boolean(r.punchInFace),
      dayType: r.dayType ?? null,
      waiting: false,
    };
  });
  for (const q of waiting) {
    if (seen.has(`${q.userId}|${q.workDate}`)) continue;
    const outside = outsideLocationView(q.outsideLocation) ?? null;
    rows.push({
      ...who(String(q.userId)),
      workDate: String(q.workDate),
      punchIn: outside && outside.punchType === 'in' ? outside.at : null,
      punchOut: outside && outside.punchType === 'out' ? outside.at : null,
      inLocation: null,
      outLocation: null,
      outside,
      facePassed: false,
      dayType: null,
      waiting: true,
    });
  }
  return rows.sort((a, b) => (a.workDate === b.workDate ? (b.punchIn ?? '').localeCompare(a.punchIn ?? '') : b.workDate.localeCompare(a.workDate)));
}

/**
 * This pay cycle and the one before, as payroll reads them. `current` is null
 * when the company has set no pay cycle: no calendar month stands in for one.
 * A setting that does not make sense throws payroll's own 409.
 */
export async function payCycleForAdmin(adminUserId: string, today: string) {
  const org = await requireOrg(adminUserId);
  const set = await payrollPeriods().countDocuments({ org }, { limit: 1 });
  if (!set) return { current: null, previous: null };
  const current = await payrollPeriodHolding(org, today);
  if (!current) return { current: null, previous: null };
  const dayBefore = new Date(Date.parse(`${current.from}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const previous = await payrollPeriodHolding(org, dayBefore);
  return {
    current: { from: current.from, to: current.to },
    previous: previous ? { from: previous.from, to: previous.to } : null,
  };
}
