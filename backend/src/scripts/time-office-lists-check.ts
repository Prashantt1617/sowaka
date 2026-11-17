/**
 * Time office lists kept in memory (services/timeOfficeLists.ts): the kept answer equals the
 * database's, every kind of change shows on the next read, live punches are never stale, and
 * what each list costs in bytes from the database cold and warm.
 *
 *   MONGODB_DB=time_office_lists_scratch npm run time-office-lists:check
 */
import type { Request, Response } from 'express';

let failures = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures += 1;
};
const IST_OFFSET_MS = 330 * 60_000;
const istToday = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Run the write hook as a request to `path` would, then end the response. */
function writeThrough(path: string, org: string, readCache: typeof import('../services/lifecycle/readCache')) {
  const req = { method: 'POST', path, auth: { user: { org } } } as unknown as Request;
  const res = { end: () => res } as unknown as Response;
  readCache.forgetReadsOnWrite(req, res, () => undefined);
  (res as unknown as { end: () => void }).end();
}

const main = async () => {
  const db = await import('../config/db');
  const seed = await import('./engagement-speed-check');
  const readCache = await import('../services/lifecycle/readCache');
  const lists = await import('../services/timeOfficeLists');
  const { listAllRegularizationsForAdmin } = await import('../services/attendance.service');
  const { listAllLeavesForAdmin } = await import('../services/leave.service');
  const { listAllOvertimeForAdmin } = await import('../services/overtime.service');
  const { listAllFeedbackForAdmin } = await import('../services/admin.service');
  const { forgetCorrectionsListOf } = await import('../services/timeOfficeDrop');
  const { ObjectId } = await import('mongodb');

  await seed.seedSpeedOrg(50, 30);
  const raw = db.getDb();
  if (!/scratch/.test(raw.databaseName)) throw new Error(`refusing to run against ${raw.databaseName}`);
  const ORG = seed.ORG;
  const HR = seed.HR;
  const today = istToday();
  await db.users().updateOne({ userId: HR }, { $set: { dashboardAccess: true, dashboardAdmin: true } });
  const people = (await db.users().find({ org: ORG, userId: /^speed-\d/ }).project({ _id: 0, userId: 1, employeeId: 1, managerUserId: 1 }).toArray()) as { userId: string; employeeId: string; managerUserId?: string }[];

  // A company's worth of history, Convrse-sized: ~660 corrections, ~220 leaves, ~40 overtime, feedback.
  const regs = Array.from({ length: 660 }, (_, i) => {
    const p = people[i % people.length];
    return { userId: p.userId, employeeId: p.employeeId, managerUserId: p.managerUserId ?? HR, workDate: addDays(today, -(i % 60) - 2), requestedDayType: 'full_day', note: i % 3 ? '' : 'forgot to punch out', status: i % 4 ? 'approved' : 'pending', createdAt: new Date(Date.now() - (i + 2) * 3_600_000), ...(i % 4 ? { decidedAt: new Date(), decidedByRole: 'manager', decidedByUserId: HR, managerNote: '' } : {}) };
  });
  await raw.collection('attendance_regularizations').insertMany(regs as never);
  await db.leaves().insertMany(Array.from({ length: 220 }, (_, i) => ({ org: ORG, userId: people[i % people.length].userId, type: i % 2 ? 'casual' : 'earned', startDate: new Date(`${addDays(today, (i % 40) - 20)}T00:00:00Z`), endDate: new Date(`${addDays(today, (i % 40) - 20)}T00:00:00Z`), reason: 'personal', status: i % 5 ? 'approved' : 'pending', halfDay: i % 7 === 0, createdAt: Date.now() - i * 3_600_000 })) as never);
  await raw.collection('overtime_requests').insertMany(Array.from({ length: 40 }, (_, i) => ({ org: ORG, userId: people[i % people.length].userId, managerUserId: HR, workDate: new Date(`${addDays(today, -(i % 20) - 1)}T00:00:00Z`), startTime: new Date(`${addDays(today, -(i % 20) - 1)}T18:00:00+05:30`), endTime: new Date(`${addDays(today, -(i % 20) - 1)}T22:00:00+05:30`), hours: 4, duration: i % 2 ? 'full_day' : 'half_day', note: 'release', status: i % 3 ? 'approved' : 'pending', createdAt: new Date(Date.now() - i * 3_600_000) })) as never);
  await raw.collection('feedback_records').insertMany(Array.from({ length: 60 }, (_, i) => ({ employeeUserId: people[i % people.length].userId, managerUserId: HR, period: `2026-${String(Math.floor(i / people.length) + 1).padStart(2, '0')}`, status: 'sent', overallScore: 3 + (i % 3), parameters: [], updatedAt: new Date(), sentAt: new Date() })) as never);

  readCache.enableLifecycleReadCache(true);
  await raw.command({ profile: 2, slowms: 0 } as never);
  const bytesOf = async (fn: () => Promise<unknown>) => {
    const from = new Date();
    const t0 = Date.now();
    const value = await fn();
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 30));
    const rows = await raw.collection('system.profile').find({ ts: { $gte: from }, ns: { $not: /system\.profile/ } }).project({ responseLength: 1 }).toArray();
    return { value, ms, bytes: rows.reduce((t, r) => t + (Number(r.responseLength) || 0), 0) };
  };

  // 1. The kept answer equals the database's, and costs nothing once kept.
  const cases: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
    ['corrections', () => lists.correctionsForAdmin(HR), () => listAllRegularizationsForAdmin(HR)],
    ['leave requests', () => lists.leavesForAdmin(HR), () => listAllLeavesForAdmin(HR)],
    ['overtime', () => lists.overtimeForAdmin(HR), () => listAllOvertimeForAdmin(HR)],
    ['feedback', () => lists.feedbackForAdmin(HR), () => listAllFeedbackForAdmin(HR)],
  ];
  console.log('\nlist              rows  cold bytes  cold ms  warm bytes  warm ms  prod cold est  prod warm');
  for (const [name, keptFn, direct] of cases) {
    readCache.forgetLifecycleReads(ORG);
    const cold = await bytesOf(keptFn);
    const warm = await bytesOf(keptFn);
    const fresh = await direct();
    const n = Array.isArray(cold.value) ? cold.value.length : 0;
    console.log(`${name.padEnd(16)} ${String(n).padStart(5)} ${String(cold.bytes).padStart(11)} ${String(cold.ms).padStart(8)} ${String(warm.bytes).padStart(11)} ${String(warm.ms).padStart(8)} ${(cold.bytes / 102_400).toFixed(2).padStart(12)} s ${(warm.bytes / 102_400).toFixed(2).padStart(7)} s`);
    ok(`${name}: the kept answer equals the database's`, same(warm.value, fresh), `${n} rows`);
    ok(`${name}: a kept read sends nothing from the database${name === 'corrections' ? ' but recent punches' : ''}`, warm.bytes < (name === 'corrections' ? 20_000 : 600), `${warm.bytes} bytes`);
  }

  // 2. Every kind of change shows on the next read.
  await lists.leavesForAdmin(HR);
  await db.leaves().insertOne({ org: ORG, userId: people[1].userId, type: 'casual', startDate: new Date(`${addDays(today, 9)}T00:00:00Z`), endDate: new Date(`${addDays(today, 9)}T00:00:00Z`), reason: 'NEW-LEAVE', status: 'pending', halfDay: false, createdAt: Date.now() } as never);
  writeThrough('/leaves', ORG, readCache);
  ok('a leave applied through the API shows on the next Leave requests read', (await lists.leavesForAdmin(HR)).some((l) => (l as { reason?: string }).reason === 'NEW-LEAVE'));

  await lists.correctionsForAdmin(HR);
  const regId = new ObjectId();
  await raw.collection('attendance_regularizations').insertOne({ _id: regId, userId: people[2].userId, employeeId: people[2].employeeId, managerUserId: HR, workDate: addDays(today, -3), requestedDayType: 'full_day', note: 'NEW-CORRECTION', status: 'pending', createdAt: new Date() } as never);
  writeThrough('/attendance/regularizations', ORG, readCache);
  ok('a correction raised through the API shows on the next corrections read', (await lists.correctionsForAdmin(HR)).some((r) => r.note === 'NEW-CORRECTION'));

  await raw.collection('attendance_regularizations').updateOne({ _id: regId }, { $set: { status: 'approved', decidedAt: new Date() } });
  writeThrough(`/admin/regularizations/${regId}/decision`, ORG, readCache);
  ok('an HR decision shows on the next corrections read', (await lists.correctionsForAdmin(HR)).find((r) => r.note === 'NEW-CORRECTION')?.status === 'approved');

  // A punch is not a dropping route: an out-of-location punch opens a request and drops the list itself.
  await lists.correctionsForAdmin(HR);
  writeThrough('/attendance/punch', ORG, readCache);
  await raw.collection('attendance_regularizations').insertOne({ userId: people[3].userId, employeeId: people[3].employeeId, managerUserId: HR, workDate: today, kind: 'out_of_location', requestedDayType: 'full_day', note: 'OOL-PUNCH', status: 'pending', createdAt: new Date() } as never);
  ok('a plain punch does not drop the kept corrections (busy companies keep their copy)', !(await lists.correctionsForAdmin(HR)).some((r) => r.note === 'OOL-PUNCH'));
  await forgetCorrectionsListOf(people[3].userId);
  ok('the out-of-location request a punch opens shows on the next read', (await lists.correctionsForAdmin(HR)).some((r) => r.note === 'OOL-PUNCH'));

  // Live punches: today's row takes its punches from the database on every read.
  await db.attendanceRecords().deleteMany({ employeeId: people[3].employeeId, workDate: today });
  await db.attendanceRecords().insertOne({ userId: people[3].userId, employeeId: people[3].employeeId, workDate: today, punchIn: new Date(`${today}T09:30:00+05:30`), source: 'manual', sourceKey: `manual|${people[3].employeeId}|${today}`, importedAt: new Date(), updatedAt: new Date() } as never);
  const beforeOut = (await lists.correctionsForAdmin(HR)).find((r) => r.note === 'OOL-PUNCH');
  await db.attendanceRecords().updateOne({ employeeId: people[3].employeeId, workDate: today }, { $set: { punchOut: new Date(`${today}T18:05:00+05:30`) } });
  const afterOut = (await lists.correctionsForAdmin(HR)).find((r) => r.note === 'OOL-PUNCH');
  ok("today's row shows the punch-out at once, with nothing dropped", !beforeOut?.punchOut && afterOut?.punchOut === new Date(`${today}T18:05:00+05:30`).toISOString(), `${beforeOut?.punchOut ?? '-'} -> ${afterOut?.punchOut ?? '-'}`);

  await lists.overtimeForAdmin(HR);
  await raw.collection('overtime_requests').insertOne({ org: ORG, userId: people[4].userId, managerUserId: HR, workDate: new Date(`${addDays(today, -1)}T00:00:00Z`), startTime: new Date(`${addDays(today, -1)}T18:00:00+05:30`), endTime: new Date(`${addDays(today, -1)}T23:00:00+05:30`), hours: 5, duration: 'full_day', note: 'NEW-OT', status: 'pending', createdAt: new Date() } as never);
  writeThrough('/overtime', ORG, readCache);
  ok('an overtime request shows on the next Overtime read', (await lists.overtimeForAdmin(HR)).some((o) => (o as { note?: string }).note === 'NEW-OT'));

  await lists.feedbackForAdmin(HR);
  await raw.collection('feedback_records').insertOne({ employeeUserId: people[5].userId, managerUserId: HR, period: '2026-11', status: 'sent', overallScore: 5, parameters: [], updatedAt: new Date(), sentAt: new Date() } as never);
  writeThrough('/manager/feedback', ORG, readCache);
  ok('feedback a manager sends shows on the next Feedback read', (await lists.feedbackForAdmin(HR)).some((f) => (f as { period?: string; overallScore?: number }).period === '2026-11' && (f as { overallScore?: number }).overallScore === 5));

  // An employee change (name) shows too: the rows name people from the roster.
  await lists.leavesForAdmin(HR);
  await db.users().updateOne({ userId: people[1].userId }, { $set: { name: 'Renamed Person' } });
  writeThrough(`/admin/employees/${people[1].userId}`, ORG, readCache);
  ok('a renamed employee shows renamed on the next Leave requests read', (await lists.leavesForAdmin(HR)).some((l) => JSON.stringify(l).includes('Renamed Person')));

  // 3. Another company's change leaves this company's copy alone; the warm-up fills it.
  await lists.leavesForAdmin(HR);
  writeThrough('/leaves', 'some-other-org', readCache);
  const otherOrg = await bytesOf(() => lists.leavesForAdmin(HR));
  ok("another company's write keeps this company's copy", otherOrg.bytes < 600, `${otherOrg.bytes} bytes`);
  readCache.forgetLifecycleReads(ORG);
  await lists.warmTimeOfficeLists(ORG, HR);
  const afterWarm = await bytesOf(() => lists.leavesForAdmin(HR));
  ok('after the warm-up the first read is served from memory', afterWarm.bytes < 600, `${afterWarm.bytes} bytes, ${afterWarm.ms} ms`);
  ok('the warm-up finds a reader for the company', (await lists.listReaderFor(ORG)) !== undefined);

  // 4. With the cache off (scripts), every read is live.
  readCache.enableLifecycleReadCache(false);
  await db.leaves().insertOne({ org: ORG, userId: people[6].userId, type: 'casual', startDate: new Date(`${addDays(today, 11)}T00:00:00Z`), endDate: new Date(`${addDays(today, 11)}T00:00:00Z`), reason: 'CACHE-OFF', status: 'pending', halfDay: false, createdAt: Date.now() } as never);
  ok('with the cache off a write shows without any drop', (await lists.leavesForAdmin(HR)).some((l) => (l as { reason?: string }).reason === 'CACHE-OFF'));

  await raw.command({ profile: 0 } as never);
  console.log(failures ? `\n${failures} failed` : '\nall time office list checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((error) => { console.error(error); process.exit(1); });
