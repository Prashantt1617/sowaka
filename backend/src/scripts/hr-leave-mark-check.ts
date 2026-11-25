/**
 * HR's "On leave" day mark takes a day from a leave type (24 Nov 2026): the mark needs a type unless an
 * approved leave already covers the day, writes an approved one-day leave (the balance drops by one),
 * refuses when no day is left, and gives the day back when the mark changes or goes. On a scratch DB:
 *   MONGODB_DB=hr_leave_mark_scratch npx tsx src/scripts/hr-leave-mark-check.ts
 */
import { attendanceOverrides, connectDb, getDb, leaves, users } from '../config/db';
import type { User } from '../models/user.model';
import { clearAttendanceOverride, setAttendanceOverride } from '../services/attendance-override.service';
import { getMyLeaveBalance } from '../services/leave.service';
import { leaveTypeRulesFor } from '../services/shift.service';
import { employeeCalendar } from '../services/attendance-report.service';

let passed = 0; let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId[0].toUpperCase() + userId.slice(1), email: `${userId}@x.test`, org: 'acme', lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);
const err = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 8);
  const d1 = `${month}02`, d2 = `${month}03`, d3 = `${month}04`;
  await users().insertMany([person('founder', { dashboardAccess: true, dashboardAdmin: true }), person('asha')]);
  const rules = await leaveTypeRulesFor('asha');
  console.log('leave types on the default policy:', rules.map((r) => `${r.key}${r.unpaid ? ' (unpaid)' : ''}`).join(', '));
  const paid = rules.find((r) => !r.unpaid && r.key !== 'comp_off');
  const unpaid = rules.find((r) => r.unpaid);
  if (!paid) { console.log('no paid leave type on the default policy; nothing to check'); process.exit(1); }
  const year = Number(today.slice(0, 4));
  const usedNow = async (key: string) => ((await getMyLeaveBalance('asha', year)).types.find((t) => t.key === key) as { used: number; remaining: number });

  const before = await usedNow(paid.key);
  ok('"On leave" without a type is refused, asking which leave', /Pick which leave/.test(await err(() => setAttendanceOverride('founder', 'asha', d1, { status: 'on_leave' }))));
  if (before.remaining >= 1) {
    await setAttendanceOverride('founder', 'asha', d1, { status: 'on_leave', leaveType: paid.key, note: 'client visit' });
    const row = await leaves().findOne({ userId: 'asha', status: 'approved' });
    const after = await usedNow(paid.key);
    ok(`marking ${paid.name} writes an approved one-day leave and the balance drops by one`, Boolean(row) && row!.days === 1 && after.used === before.used + 1, { before, after });
    const mark = await attendanceOverrides().findOne({ userId: 'asha', workDate: d1 });
    ok('the mark keeps the type and the leave it took', mark?.leaveType === paid.name && mark?.leaveId === String(row!._id), mark);
    await setAttendanceOverride('founder', 'asha', d1, { status: 'on_leave', leaveType: paid.key });
    ok('saving the same mark again takes nothing more', (await leaves().countDocuments({ userId: 'asha', status: 'approved' })) === 1);
    await setAttendanceOverride('founder', 'asha', d1, { status: 'present' });
    ok('changing the day to Present gives the day back', (await usedNow(paid.key)).used === before.used && (await leaves().countDocuments({ userId: 'asha', status: 'approved' })) === 0);
    await setAttendanceOverride('founder', 'asha', d2, { status: 'on_leave', leaveType: paid.key });
    await clearAttendanceOverride('founder', 'asha', d2);
    ok('removing the mark gives the day back', (await usedNow(paid.key)).used === before.used);
  } else ok(`${paid.name} has no days on the default policy, so marking it is refused`, /left/.test(await err(() => setAttendanceOverride('founder', 'asha', d1, { status: 'on_leave', leaveType: paid.key }))));
  // A paid type with nothing left is refused.
  const empty = rules.find((r) => !r.unpaid && r.key === 'comp_off');
  if (empty) ok('Comp-off with nothing earned is refused', /left/.test(await err(() => setAttendanceOverride('founder', 'asha', d3, { status: 'on_leave', leaveType: empty.key }))));
  if (unpaid) {
    await setAttendanceOverride('founder', 'asha', d3, { status: 'on_leave', leaveType: unpaid.key });
    const cal = await employeeCalendar('founder', 'asha', month.slice(0, 7));
    ok('leave without pay is marked and shows as unpaid leave on the calendar', cal.days.find((d) => d.date === d3)?.status === 'unpaid_leave', cal.days.find((d) => d.date === d3));
  }
  // An approved leave already covering the day: no type needed, nothing more taken.
  await leaves().insertOne({ userId: 'asha', type: paid.key, startDate: new Date(`${d2}T00:00:00Z`), endDate: new Date(`${d2}T00:00:00Z`), days: 1, reason: 'applied', status: 'approved', createdAt: Date.now() });
  const n = await leaves().countDocuments({ userId: 'asha', status: 'approved' });
  await setAttendanceOverride('founder', 'asha', d2, { status: 'on_leave' });
  ok('a day an approved leave covers needs no type and takes nothing more', (await leaves().countDocuments({ userId: 'asha', status: 'approved' })) === n);
  // HR picks another type on a day their own approved one-day leave covers: the leave is swapped (25 Nov 2026).
  const other = unpaid ?? rules.find((r) => r.key !== paid.key);
  if (other) {
    const d4 = `${month}05`;
    const own = await leaves().insertOne({ userId: 'asha', type: other.key, startDate: new Date(`${d4}T00:00:00Z`), endDate: new Date(`${d4}T00:00:00Z`), days: 1, reason: 'home emergency', status: 'approved', createdAt: Date.now() });
    const left = async () => (await (await import('../services/leave.service')).getMyLeaveBalance('asha', Number(d4.slice(0, 4)))).types.find((t) => t.key === paid.key)?.remaining ?? 0;
    const before = await left();
    if (before >= 1) {
      await setAttendanceOverride('founder', 'asha', d4, { status: 'on_leave', leaveType: paid.key });
      const old = await leaves().findOne({ _id: own.insertedId });
      const mark = await attendanceOverrides().findOne({ org: 'acme', userId: 'asha', workDate: d4 });
      ok('picking another type cancels their own leave and books the picked one', old?.status === 'cancelled' && mark?.leaveType === paid.name && !!mark?.leaveId && !mark?.unpaid, { old: old?.status, mark });
      ok('…and the picked type gives up one day', (await left()) === before - 1, { before, after: await left() });
    }
    // A longer leave is not cut up from the calendar.
    const d5 = `${month}06`, d6 = `${month}07`;
    await leaves().insertOne({ userId: 'asha', type: other.key, startDate: new Date(`${d5}T00:00:00Z`), endDate: new Date(`${d6}T00:00:00Z`), days: 2, reason: 'trip', status: 'approved', createdAt: Date.now() });
    ok('a day inside a longer approved leave is refused with where to change it', /Leave requests/.test(await err(() => setAttendanceOverride('founder', 'asha', d5, { status: 'on_leave', leaveType: paid.key }))));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
