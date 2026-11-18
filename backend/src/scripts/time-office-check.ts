/**
 * Scratch-database check of the time office pages' backend (PR #161 reworked):
 *
 * - GET /admin/punch-log: only the admin's own org; never a face match score
 *   or liveness; "passed"/"failed" only for a viewer with the Face ID tab;
 *   refused without an attendance tab.
 * - GET /admin/pay-cycle: `current: null` when no pay cycle is set (no
 *   calendar month stands in); the cycle once set; a setting payroll refuses
 *   is a 409 with its message, not a 500.
 * - People › Accesses: Reports, and the Time Reviewer preset, save as the
 *   dashboard sends them (Company calendar and Punch log ride along with the
 *   Attendance report, so they are never sent); someone with the Attendance
 *   report keeps the punch log.
 * - The admin leave list says which leave is leave without pay from the
 *   type's unpaid flag, never its name.
 *
 * It drops and recreates its own database, and refuses any other. Run with
 *   npm run time-office:check
 */
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import { app } from '../app';
import { attendanceRecords, attendanceRegularizations, authSessions, connectDb, getDb, leaves, payrollPeriods, users } from '../config/db';
import { env } from '../config/env';
import { DEFAULT_PAYROLL_PERIOD } from '../models/payrollPeriod.model';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { setDashboardAccess } from '../services/dashboard-access.service';
import { listAllLeavesForAdmin } from '../services/leave.service';
import { createShift, setDefaultShift } from '../services/shift.service';

const SCRATCH = 'time_office_scratch';
const ORG = 'sowaka';
const OTHER = 'otherco-scratch';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (ok) passed += 1;
  else failed += 1;
}
async function refusal(run: () => Promise<unknown>) {
  try { await run(); return null; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message };
  }
}

const person = (userId: string, org: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@sowaka.test`, org, lifecycleStatus: 'active', role: 'employee',
  employeeId: `E-${userId.toUpperCase()}`, joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

(async () => {
  if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  await users().insertMany([
    person('hr', ORG, { dashboardAccess: true, dashboardAdmin: true }),
    person('reporter', ORG, { dashboardAccess: true, dashboardTabs: ['attendancereport'] }),
    person('facer', ORG, { dashboardAccess: true, dashboardTabs: ['attendancereport', 'faceid'] }),
    person('leaveonly', ORG, { dashboardAccess: true, dashboardTabs: ['leave'] }),
    person('emp1', ORG, { managerUserId: 'hr' }),
    person('emp2', ORG, { managerUserId: 'hr' }),
    person('outsider', OTHER, { dashboardAccess: true, dashboardAdmin: true }),
  ]);
  const tokens = new Map<string, string>();
  for (const userId of ['hr', 'reporter', 'facer', 'leaveonly', 'outsider']) {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(userId, token);
    await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) });
  }

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (as: string, path: string) => {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokens.get(as)}` } });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text || '{}') as Record<string, unknown> };
  };

  const day = '2026-11-10';
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
  const record = (userId: string, extra: Record<string, unknown> = {}) => ({
    employeeId: `E-${userId.toUpperCase()}`, userId, workDate: day, punchIn: at('09:30'), punchOut: at('18:30'),
    source: 'manual' as const, sourceKey: `check:${userId}:${day}`, importedAt: new Date(), updatedAt: new Date(), ...extra,
  });
  await attendanceRecords().insertMany([
    record('emp1', {
      punchInFace: { similarity: 99.3, liveness: 'aws', at: at('09:30') },
      punchInLocation: { latitude: 12.97, longitude: 77.59, officeId: 'o1', officeName: 'HQ', distanceMeters: 10 },
    }),
    record('emp2'),
    record('outsider'),
  ]);
  // emp2's punch-in was refused by the face check and sent for a decision.
  await attendanceRegularizations().insertOne({
    userId: 'emp2', employeeId: 'E-EMP2', managerUserId: 'hr', workDate: day, kind: 'face_check',
    faceCheck: { at: at('09:29'), punchType: 'in', reason: 'not_a_match', attempts: 3 },
    punchIn: at('09:29'), note: 'Face check did not match', status: 'pending', createdAt: at('09:29'),
  });

  console.log('punch log');
  const asHr = await get('hr', `/admin/punch-log?from=${day}&to=${day}`);
  const hrRows = (asHr.body.punches ?? []) as { userId: string; face: unknown }[];
  check('HR reads the punch log', asHr.status === 200, asHr.status);
  check('only their own org', hrRows.length === 2 && hrRows.every((r) => r.userId !== 'outsider'), hrRows.map((r) => r.userId));
  check('no match score or liveness is ever sent', !/similarity|liveness/.test(asHr.text), asHr.text.slice(0, 300));
  check('HR (every tab) sees a passed face check', hrRows.find((r) => r.userId === 'emp1')?.face === 'passed', hrRows);
  check('…and a refused one as failed', hrRows.find((r) => r.userId === 'emp2')?.face === 'failed', hrRows);

  const asReporter = await get('reporter', `/admin/punch-log?from=${day}&to=${day}`);
  const repRows = (asReporter.body.punches ?? []) as { face: unknown }[];
  check('the Attendance report alone opens the punch log', asReporter.status === 200 && repRows.length === 2, asReporter.status);
  check('without Face ID no face check result at all', repRows.every((r) => r.face === null) && !/similarity|liveness/.test(asReporter.text), repRows);

  const asFacer = await get('facer', `/admin/punch-log?from=${day}&to=${day}`);
  const faceRows = (asFacer.body.punches ?? []) as { userId: string; face: unknown }[];
  check('with Face ID: passed / failed only', faceRows.find((r) => r.userId === 'emp1')?.face === 'passed' && faceRows.find((r) => r.userId === 'emp2')?.face === 'failed' && !/similarity/.test(asFacer.text), faceRows);

  const asLeave = await get('leaveonly', `/admin/punch-log?from=${day}&to=${day}`);
  check('without an attendance tab it is refused', asLeave.status === 403, asLeave.status);
  const asOutsider = await get('outsider', `/admin/punch-log?from=${day}&to=${day}`);
  const outRows = (asOutsider.body.punches ?? []) as { userId: string }[];
  check('the other org sees only its own', outRows.length === 1 && outRows[0].userId === 'outsider', outRows);
  check('a bad range is a 400', (await get('hr', `/admin/punch-log?from=${day}&to=2026-11-01`)).status === 400);

  console.log('punch log: loaded once, then only what changed');
  // PUNCH_LOG_DELTA_MS=0 (set below in package.json) makes every read ask for the changes.
  await attendanceRecords().insertOne(record('facer', { sourceKey: `check:facer:${day}` }) as never);
  const withNew = ((await get('hr', `/admin/punch-log?from=${day}&to=${day}`)).body.punches ?? []) as { userId: string; waiting?: boolean }[];
  check('a punch written after the first load shows on the next read', withNew.some((r) => r.userId === 'facer') && withNew.length === 3, withNew.map((r) => r.userId));
  const ool = await attendanceRegularizations().insertOne({
    userId: 'reporter', employeeId: 'E-REPORTER', managerUserId: 'hr', workDate: day, kind: 'out_of_location',
    outsideLocation: { at: at('09:40'), punchType: 'in', reason: 'Client visit', latitude: 12.9, longitude: 77.5, officeName: 'HQ', distanceMeters: 2500 },
    note: 'At a client', status: 'pending', createdAt: new Date(),
  } as never);
  const withWaiting = ((await get('hr', `/admin/punch-log?from=${day}&to=${day}`)).body.punches ?? []) as { userId: string; waiting?: boolean }[];
  check('an out-of-location punch raised since joins as waiting', withWaiting.some((r) => r.userId === 'reporter' && r.waiting === true), withWaiting.map((r) => [r.userId, r.waiting]));
  await attendanceRegularizations().updateOne({ _id: ool.insertedId }, { $set: { status: 'declined', decidedAt: new Date() } });
  const afterDecline = ((await get('hr', `/admin/punch-log?from=${day}&to=${day}`)).body.punches ?? []) as { userId: string; waiting?: boolean }[];
  check('…and leaves once it is declined', !afterDecline.some((r) => r.userId === 'reporter'), afterDecline.map((r) => r.userId));
  await attendanceRecords().updateOne({ userId: 'emp2', workDate: day }, { $set: { punchOut: at('20:15'), updatedAt: new Date() } });
  const afterEdit = ((await get('hr', `/admin/punch-log?from=${day}&to=${day}`)).body.punches ?? []) as { userId: string; punchOut: string | null }[];
  check('an edited punch reads its new time', afterEdit.find((r) => r.userId === 'emp2')?.punchOut === at('20:15').toISOString(), afterEdit.find((r) => r.userId === 'emp2'));

  console.log('pay cycle');
  const none = await get('hr', '/admin/pay-cycle');
  check('no pay cycle set: current is null, no calendar month stands in', none.status === 200 && (none.body.cycle as { current: unknown }).current === null, none.body);
  await payrollPeriods().insertOne({ org: ORG, period: DEFAULT_PAYROLL_PERIOD, startDay: 26, updatedAt: new Date() } as never);
  const set = await get('hr', '/admin/pay-cycle');
  const cycle = set.body.cycle as { current: { from: string; to: string } | null; previous: { from: string; to: string } | null };
  const today = new Date().toISOString().slice(0, 10);
  check('a 26th–25th cycle reads as set', set.status === 200 && cycle.current?.from.slice(8) === '26' && cycle.current?.to.slice(8) === '25' && cycle.current.from <= today && today <= cycle.current.to, cycle);
  check('…with the cycle before it', cycle.previous?.from.slice(8) === '26' && cycle.previous?.to < (cycle.current?.from ?? ''), cycle);
  check('the other org still has none', ((await get('outsider', '/admin/pay-cycle')).body.cycle as { current: unknown }).current === null);
  await payrollPeriods().updateOne({ org: ORG, period: DEFAULT_PAYROLL_PERIOD }, { $set: { startDay: 40 } });
  const bad = await get('hr', '/admin/pay-cycle');
  check('a start day payroll refuses is a 409 with its message', bad.status === 409 && /start day/.test(String(bad.body.message)), { status: bad.status, body: bad.body });
  check('the reporter (Attendance report) may read the pay cycle', (await get('reporter', '/admin/pay-cycle')).status === 409);
  check('…someone with only Leave may not', (await get('leaveonly', '/admin/pay-cycle')).status === 403);

  console.log('accesses');
  // What People › Accesses sends: whole sections, less the pages that ride along (Accesses.tsx).
  const reports = ['attendancereport'];
  const timeReviewer = ['overview', 'leave', 'overtime', 'attendance', 'oolcheckins', ...reports];
  check('Reports saves', (await refusal(() => setDashboardAccess('hr', 'reporter', { access: true, admin: false, tabs: reports }))) === null);
  check('the Time Reviewer preset saves', (await refusal(() => setDashboardAccess('hr', 'emp1', { access: true, admin: false, tabs: timeReviewer }))) === null);
  const unknown = await refusal(() => setDashboardAccess('hr', 'emp2', { access: true, admin: false, tabs: [...reports, 'companycalendar', 'punchlog'] }));
  check('the new pages are not tab keys of their own (so the page must not send them)', unknown?.status === 400 && /Unknown tab/.test(unknown.message ?? ''), unknown);
  check('a saved Attendance report keeps the punch log', (await get('reporter', `/admin/punch-log?from=${day}&to=${day}`)).status === 200);

  console.log('leave without pay');
  const shift = await createShift('hr', {
    name: 'General',
    punchFormat: 'In-app punch in',
    policy: {
      leave: {
        approver: 'Reporting manager', hrOverride: true, balanceTracked: true,
        types: [
          { key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 30 },
          // Named like unpaid leave, but paid: the flag decides, not the name.
          { key: 'unpaidish', name: 'Unpaid-sounding Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 30 },
          { key: 'sabbatical', name: 'Sabbatical', perMonth: 0, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 30, unpaid: true },
        ],
      },
    },
  } as never);
  await setDefaultShift('hr', shift.id);
  const leave = (type: string) => ({ userId: 'emp1', type, startDate: new Date('2026-11-20T00:00:00Z'), endDate: new Date('2026-11-20T00:00:00Z'), days: 1, reason: 'check', status: 'approved' as const, createdAt: Date.now() });
  await leaves().insertMany([leave('casual'), leave('unpaidish'), leave('sabbatical')]);
  const list = await listAllLeavesForAdmin('hr');
  const unpaidOf = (type: string) => (list.find((l) => l.type === type) as { unpaid?: boolean } | undefined)?.unpaid === true;
  check('an unpaid-flagged type is leave without pay', unpaidOf('sabbatical'), list.map((l) => [l.type, (l as { unpaid?: boolean }).unpaid]));
  check('a paid type is not, whatever its name', !unpaidOf('unpaidish') && !unpaidOf('casual'));
  check('custom types keep their names', list.find((l) => l.type === 'sabbatical')?.typeName === 'Sabbatical', list.map((l) => l.typeName));

  server.close();
  console.log(`\n${failed ? `${failed} FAILED, ` : 'all '}${passed}${failed ? ' passed' : ' passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
