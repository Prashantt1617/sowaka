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
import { onForgetSwr } from './swr-cache';

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
  const rows = await punchRows(adminUserId, org, from, to);
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

/** Brings the range up to date now (the background warm-up's way in). */
export async function warmPunchLog(adminUserId: string, org: string, from: string, to: string) {
  await punchRows(adminUserId, org, from, to, { force: true });
}

// —— The kept punches, loaded once and then only what changed ——
//
// A month of a large company's punches is seconds on this database tier, but only a
// handful change in a minute. So a range is loaded in full once and kept; after that a
// read more than DELTA_MS after the last one asks only for the records written since
// (updatedAt; every write path sets it) and the out-of-location requests raised or
// decided since, and patches them in — tens of milliseconds. A full reload still runs
// every FULL_MS in the background, for anything a delta can't see (a bulk import, a
// renamed person). A correction decision drops the org's ranges (swr-cache's forget).

type PunchRow = {
  userId: string; name: string; employeeCode: string; department: string; manager: string;
  workDate: string; punchIn: string | null; punchOut: string | null;
  inLocation: ReturnType<typeof where>; outLocation: ReturnType<typeof where>;
  outside: ReturnType<typeof outsideLocationView> | null; facePassed: boolean; dayType: string | null; waiting: boolean;
};
type Person = { userId: string; name?: string; employeeId?: string; department?: string; managerUserId?: string };
type Kept = {
  org: string;
  people: Map<string, Person>;
  rows: Map<string, PunchRow>;
  /** Server time the last sync asked from; the next delta asks from a little before it. */
  syncedAt: Date;
  fullAt: number;
  sorted: PunchRow[] | null;
  pending: Promise<void> | null;
  fullPending: Promise<void> | null;
};
const DELTA_MS = Number(process.env.PUNCH_LOG_DELTA_MS ?? 10_000);
const FULL_MS = 15 * 60_000;
/** Overlap between deltas, so a write that lands as one is read is not missed. */
const SKEW_MS = 5_000;
const kept = new Map<string, Kept>();
onForgetSwr((org) => { for (const key of kept.keys()) if (key.startsWith(`${org}|`)) kept.delete(key); });

const RECORD_FIELDS = { userId: 1, workDate: 1, punchIn: 1, punchOut: 1, punchInLocation: 1, punchOutLocation: 1, outsideLocation: 1, 'punchInFace.at': 1, dayType: 1 } as const;
const hasPunch = { $or: [{ punchIn: { $exists: true } }, { punchOut: { $exists: true } }, { outsideLocation: { $exists: true } }] };

function whoOf(people: Map<string, Person>, userId: string) {
  const p = people.get(userId);
  return { userId, name: p?.name ?? 'Employee', employeeCode: p?.employeeId ?? '', department: p?.department ?? '', manager: people.get(p?.managerUserId ?? '')?.name ?? '' };
}

function recordRow(people: Map<string, Person>, r: Record<string, unknown>): PunchRow {
  return {
    ...whoOf(people, String(r.userId ?? '')),
    workDate: String(r.workDate),
    punchIn: r.punchIn ? new Date(r.punchIn as Date).toISOString() : null,
    punchOut: r.punchOut ? new Date(r.punchOut as Date).toISOString() : null,
    inLocation: where(r.punchInLocation as PunchLocation | undefined),
    outLocation: where(r.punchOutLocation as PunchLocation | undefined),
    outside: outsideLocationView(r.outsideLocation as never) ?? null,
    facePassed: Boolean(r.punchInFace),
    dayType: (r.dayType as string | undefined) ?? null,
    waiting: false,
  };
}

function waitingRow(people: Map<string, Person>, q: Record<string, unknown>): PunchRow {
  const outside = outsideLocationView(q.outsideLocation as never) ?? null;
  return {
    ...whoOf(people, String(q.userId)),
    workDate: String(q.workDate),
    punchIn: outside && outside.punchType === 'in' ? outside.at : null,
    punchOut: outside && outside.punchType === 'out' ? outside.at : null,
    inLocation: null,
    outLocation: null,
    outside,
    facePassed: false,
    dayType: null,
    waiting: true,
  };
}

async function fullLoad(adminUserId: string, org: string, from: string, to: string): Promise<Kept> {
  const startedAt = new Date();
  const list = await orgUsers(adminUserId, ['userId', 'name', 'employeeId', 'department', 'managerUserId']);
  const people = new Map(list.map((p) => [p.userId, p as Person]));
  const userIds = list.map((p) => p.userId);
  const rows = new Map<string, PunchRow>();
  if (userIds.length) {
    const [records, waiting] = await Promise.all([
      attendanceRecords().find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, ...hasPunch }).project(RECORD_FIELDS).toArray(),
      attendanceRegularizations()
        .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, kind: 'out_of_location', status: 'pending' })
        .project({ userId: 1, workDate: 1, outsideLocation: 1 })
        .toArray(),
    ]);
    for (const r of records) rows.set(`${r.userId}|${r.workDate}`, recordRow(people, r));
    for (const q of waiting) {
      const key = `${q.userId}|${q.workDate}`;
      if (!rows.has(key)) rows.set(key, waitingRow(people, q));
    }
  }
  return { org, people, rows, syncedAt: startedAt, fullAt: Date.now(), sorted: null, pending: null, fullPending: null };
}

async function delta(k: Kept, from: string, to: string): Promise<void> {
  const since = new Date(k.syncedAt.getTime() - SKEW_MS);
  const startedAt = new Date();
  const userIds = [...k.people.keys()];
  if (!userIds.length) return;
  const [records, requests] = await Promise.all([
    attendanceRecords().find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, updatedAt: { $gte: since } }).project(RECORD_FIELDS).toArray(),
    // Raised or decided since: a request decided away leaves the log, one raised joins it.
    attendanceRegularizations()
      .find({ userId: { $in: userIds }, workDate: { $gte: from, $lte: to }, kind: 'out_of_location', $or: [{ createdAt: { $gte: since } }, { decidedAt: { $gte: since } }] })
      .project({ userId: 1, workDate: 1, outsideLocation: 1, status: 1 })
      .toArray(),
  ]);
  let changed = false;
  for (const r of records) {
    const key = `${r.userId}|${r.workDate}`;
    const has = r.punchIn || r.punchOut || r.outsideLocation;
    if (has) k.rows.set(key, recordRow(k.people, r));
    else if (k.rows.get(key)?.waiting === false) k.rows.delete(key);
    changed = true;
  }
  for (const q of requests) {
    const key = `${q.userId}|${q.workDate}`;
    const current = k.rows.get(key);
    if (q.status === 'pending') {
      if (!current) { k.rows.set(key, waitingRow(k.people, q)); changed = true; }
    } else if (current?.waiting) {
      k.rows.delete(key);
      changed = true;
    }
  }
  k.syncedAt = startedAt;
  if (changed) k.sorted = null;
}

function sortedRows(k: Kept): PunchRow[] {
  if (!k.sorted) {
    k.sorted = [...k.rows.values()].sort((a, b) => (a.workDate === b.workDate ? (b.punchIn ?? '').localeCompare(a.punchIn ?? '') : b.workDate.localeCompare(a.workDate)));
  }
  return k.sorted;
}

/** Everyone's punches in the range (and out-of-location punches still waiting), newest first. */
async function punchRows(adminUserId: string, org: string, from: string, to: string, opts: { force?: boolean } = {}): Promise<PunchRow[]> {
  const key = `${org}|${from}|${to}`;
  let k = kept.get(key);
  if (!k) {
    const loading = fullLoad(adminUserId, org, from, to);
    k = await loading;
    // Two first readers at once: keep whichever landed, both are complete.
    if (!kept.has(key)) kept.set(key, k);
    return sortedRows(kept.get(key)!);
  }
  const now = Date.now();
  if ((opts.force || now - k.fullAt > FULL_MS) && !k.fullPending) {
    const current = k;
    current.fullPending = fullLoad(adminUserId, org, from, to)
      .then((fresh) => { if (kept.get(key) === current) kept.set(key, fresh); })
      .catch(() => undefined)
      .finally(() => { current.fullPending = null; });
    if (opts.force) await current.fullPending;
  }
  k = kept.get(key)!;
  if (opts.force || now - k.syncedAt.getTime() > DELTA_MS) {
    const current = k;
    const pending = current.pending ?? (current.pending = delta(current, from, to).finally(() => { current.pending = null; }));
    await pending.catch(() => undefined);
  }
  return sortedRows(k);
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
