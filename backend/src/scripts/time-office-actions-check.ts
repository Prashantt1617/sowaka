/**
 * The Company calendar's actions, end to end on a scratch database: HR removes
 * a late or left-early mark (the day stays present, the mark is gone from the
 * report and the employee's calendar, and comes back when restored), and HR
 * cancels an approved leave (its days come off the report and back on the
 * balance at once, with no stale cached report).
 *
 *   MONGODB_DB=time_office_actions_scratch npm run time-office-actions:check
 */
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import { app } from '../app';
import { attendanceRecords, authSessions, connectDb, getDb, leaves, users } from '../config/db';
import { hashSessionToken } from '../services/auth.service';
import type { User } from '../models/user.model';
import { setMarkRemoved } from '../services/attendance-override.service';
import { attendanceReport, employeeCalendar } from '../services/attendance-report.service';
import { adminCancelLeave, getMyLeaveBalance } from '../services/leave.service';
import { createShift, setDefaultShift } from '../services/shift.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refused(run: () => Promise<unknown>) {
  try { await run(); return null; } catch (e) { return (e as { statusCode?: number; message?: string }); }
}
const ORG = 'actionscheck';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
  employeeId: `E-${userId.toUpperCase()}`, joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([person('hr', { dashboardAccess: true, dashboardAdmin: true }), person('emp', { managerUserId: 'hr' })]);
  const shift = await createShift('hr', {
    name: 'General', punchFormat: 'In-app punch in', startTime: '09:30', endTime: '18:30', lateGraceMinutes: 0,
    policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [
      { key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 30 },
    ] } },
  } as never);
  await setDefaultShift('hr', shift.id);

  // A working day earlier this month (the month HR may still change), and one after it for leave.
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const month = now.toISOString().slice(0, 7);
  const weekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  const days: string[] = [];
  for (let n = 1; n <= 28; n += 1) { const d = new Date(`${month}-${String(n).padStart(2, '0')}T00:00:00Z`); if (weekday(d)) days.push(d.toISOString().slice(0, 10)); }
  const [workDay, leaveDay] = days;
  const at = (hhmm: string) => new Date(`${workDay}T${hhmm}:00+05:30`);
  await attendanceRecords().insertOne({ employeeId: 'E-EMP', userId: 'emp', workDate: workDay, punchIn: at('11:05'), punchOut: at('15:00'), source: 'manual', sourceKey: `c:${workDay}`, importedAt: new Date(), updatedAt: new Date() } as never);

  const reportDay = async (date: string, refresh = false) => (await attendanceReport('hr', { from: `${month}-01`, to: `${month}-28` }, { refresh })).days.find((d) => d[0] === 'emp' && d[1] === date);
  const calDay = async (date: string) => (await employeeCalendar('hr', 'emp', month)).days.find((d) => d.date === date);

  console.log('late and left-early marks');
  let r = await reportDay(workDay);
  const lateMin = Number(r?.[3]), earlyMin = Number(r?.[8]), status = r?.[2];
  ok('in at 11:05, out at 15:00: marked late and left early', lateMin > 0 && earlyMin > 0, r);
  await setMarkRemoved('hr', 'emp', workDay, { mark: 'late' });
  r = await reportDay(workDay);
  ok('late removed: no late, early kept, the day itself unchanged', r?.[3] === 0 && r?.[8] === earlyMin && r?.[2] === status, r);
  ok('…and the employee calendar agrees', (await calDay(workDay))?.lateByMinutes === 0);
  await setMarkRemoved('hr', 'emp', workDay, { mark: 'early' });
  r = await reportDay(workDay);
  ok('early removed too', r?.[3] === 0 && r?.[8] === 0, r);
  await setMarkRemoved('hr', 'emp', workDay, { mark: 'late', removed: false });
  r = await reportDay(workDay);
  ok('late put back: the same minutes again, early still removed', r?.[3] === lateMin && r?.[8] === 0, r);
  ok('HR cannot change their own day', (await refused(() => setMarkRemoved('hr', 'hr', workDay, { mark: 'late' })))?.statusCode === 403);
  ok('only late or early', (await refused(() => setMarkRemoved('hr', 'emp', workDay, { mark: 'absent' })))?.statusCode === 400);

  console.log('HR cancels an approved leave');
  const ins = await leaves().insertOne({ userId: 'emp', type: 'casual', startDate: new Date(`${leaveDay}T00:00:00Z`), endDate: new Date(`${leaveDay}T00:00:00Z`), days: 1, reason: 'x', status: 'approved', createdAt: Date.now() } as never);
  const usedBefore = (await getMyLeaveBalance('emp', Number(month.slice(0, 4)))).types.find((t) => t.key === 'casual')?.used;
  ok('the day reads as leave (and the report is now cached)', (await reportDay(leaveDay, true))?.[2] === 'on_leave');
  const view = await adminCancelLeave('hr', String(ins.insertedId), { note: 'Came in after all' });
  ok('cancelled', view.status === 'cancelled', view.status);
  await new Promise((resolve) => setTimeout(resolve, 200));
  ok('the cached report is dropped: the day is no longer leave', (await reportDay(leaveDay))?.[2] !== 'on_leave', await reportDay(leaveDay));
  const usedAfter = (await getMyLeaveBalance('emp', Number(month.slice(0, 4)))).types.find((t) => t.key === 'casual')?.used;
  ok('the day is back on the balance', usedBefore === 1 && usedAfter === 0, { usedBefore, usedAfter });
  ok('a cancelled leave cannot be cancelled again', (await refused(() => adminCancelLeave('hr', String(ins.insertedId))))?.statusCode === 409);
  const own = await leaves().insertOne({ userId: 'hr', type: 'casual', startDate: new Date(`${leaveDay}T00:00:00Z`), endDate: new Date(`${leaveDay}T00:00:00Z`), days: 1, reason: 'x', status: 'approved', createdAt: Date.now() } as never);
  ok('HR cannot cancel their own', (await refused(() => adminCancelLeave('hr', String(own.insertedId))))?.statusCode === 403);

  console.log('over HTTP, as the dashboard calls them');
  const token = crypto.randomBytes(32).toString('hex');
  await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId: 'hr', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  };
  const put = await call('PUT', `/admin/employees/emp/calendar/${workDay}/marks`, { mark: 'late' });
  ok('PUT …/calendar/:date/marks removes the late mark', put.status === 200 && put.body.removed === true, put);
  ok('…and the report shows it', (await reportDay(workDay))?.[3] === 0);
  const back = await call('PUT', `/admin/employees/emp/calendar/${workDay}/marks`, { mark: 'late', removed: false });
  ok('…and puts it back', back.status === 200 && (await reportDay(workDay))?.[3] === lateMin, back);
  const lv = await leaves().insertOne({ userId: 'emp', type: 'casual', startDate: new Date(`${leaveDay}T00:00:00Z`), endDate: new Date(`${leaveDay}T00:00:00Z`), days: 1, reason: 'y', status: 'approved', createdAt: Date.now() } as never);
  const cancel = await call('POST', `/admin/leaves/${String(lv.insertedId)}/cancel`, { note: 'checked' });
  ok('POST /admin/leaves/:id/cancel cancels it', cancel.status === 200 && (cancel.body.leave as { status?: string })?.status === 'cancelled', cancel);
  server.close();

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
