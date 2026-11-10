/**
 * Cancelling a leave, end to end on a scratch database: the employee takes
 * back a pending or an approved leave that has not begun, the balance and the
 * calendar forget it, the approvers hear; a leave that has started, someone
 * else's, or a declined one is refused.
 *
 *   MONGODB_DB=leave_cancel_scratch NOTIFY_ORGS=cancelcheck EMAIL_ORGS=nobody-scratch npm run leave-cancel:check
 */
import { ObjectId } from 'mongodb';
import { connectDb, getDb, leaves, notifications, users } from '../config/db';
import type { User } from '../models/user.model';
import { employeeDayStatuses } from '../services/attendance-report.service';
import { LeaveError, applyForLeave, cancelLeave, decideLeave, getManagerLeaveInbox, getMyLeaveBalance, getMyLeaves } from '../services/leave.service';
import { createShift, setDefaultShift } from '../services/shift.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refused(run: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try { await run(); return { status: 0, message: '' }; }
  catch (error) { return error instanceof LeaveError ? { status: error.statusCode, message: error.message } : { status: -1, message: String(error) }; }
}

const ORG = 'cancelcheck';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);
/** YYYY-MM-DD, `offset` days from today (UTC, as the leave dates are kept), moved on past a weekend so the day is one leave can be taken on. */
const day = (offset: number) => { const d = new Date(Date.now() + offset * 86_400_000); while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  await users().insertMany([
    person('hr', { dashboardAccess: true, employeeId: 'H1' }),
    person('mgr', { employeeId: 'M1' }),
    person('emp', { managerUserId: 'mgr', employeeId: 'E1' }),
    person('other', { managerUserId: 'mgr', employeeId: 'E2' }),
  ]);
  const shift = await createShift('hr', {
    name: 'General',
    punchFormat: 'In-app punch in',
    policy: {
      leave: {
        approver: 'Reporting manager', hrOverride: true, balanceTracked: true,
        types: [{
          key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none',
          encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 120,
        }],
      },
    },
  });
  await setDefaultShift('hr', shift.id);
  const year = new Date().getUTCFullYear();
  const casualUsed = async (userId: string) => (await getMyLeaveBalance(userId, year)).types.find((t) => t.key === 'casual')?.used ?? -1;

  console.log('a pending leave, taken back');
  const pending = await applyForLeave('emp', { type: 'casual', startDate: day(10), endDate: day(10), reason: 'Trip' });
  ok('a day pending (the balance counts approved leave only)', pending.status === 'pending' && pending.days === 1 && (await casualUsed('emp')) === 0, pending);
  ok('with the manager', (await getManagerLeaveInbox('mgr')).some((l) => l.id === pending.id));
  const taken = await cancelLeave('emp', pending.id, { note: 'Plans changed' });
  ok('cancelled, with the note', taken.status === 'cancelled' && taken.cancelNote === 'Plans changed' && !!taken.cancelledAt, taken);
  ok('nothing on the balance', (await casualUsed('emp')) === 0);
  ok('the manager\'s inbox lists it as cancelled, nothing left to decide', (await getManagerLeaveInbox('mgr')).some((l) => l.id === pending.id && l.status === 'cancelled'));
  ok('still in the employee\'s history', (await getMyLeaves('emp')).some((l) => l.id === pending.id && l.status === 'cancelled'));
  const told = await notifications().find({ scenario: 'leave_cancelled' }).toArray();
  ok('the manager hears, with the note; the employee gets a line of their own',
    told.some((n) => n.userId === 'mgr' && /emp cancelled/.test(n.title) && /Plans changed/.test(n.body) && n.data.requestId === pending.id)
    && told.some((n) => n.userId === 'emp' && n.title === 'Leave cancelled'), told.map((n) => [n.userId, n.title, n.body]));
  ok('cancelling twice is refused', (await refused(() => cancelLeave('emp', pending.id))).status === 409);

  console.log('an approved leave, taken back');
  const approved = await applyForLeave('emp', { type: 'casual', startDate: day(20), endDate: day(20), reason: 'Errand' });
  await decideLeave('mgr', approved.id, { decision: 'approved' });
  ok('one day used once approved', (await casualUsed('emp')) === 1);
  const marks = (await employeeDayStatuses(ORG, 'emp', day(20), day(20))) ?? [];
  ok('on the calendar while approved', marks.some((m) => /leave/i.test(m.status)), marks);
  const back = await cancelLeave('emp', approved.id);
  ok('cancelled without a note: the day is back on the balance', back.status === 'cancelled' && back.cancelNote === undefined && (await casualUsed('emp')) === 0, back);
  const after = (await employeeDayStatuses(ORG, 'emp', day(20), day(20))) ?? [];
  ok('off the calendar once cancelled', !after.some((m) => /leave/i.test(m.status)), after);
  ok('told the manager the days are back', (await notifications().find({ scenario: 'leave_cancelled', userId: 'emp', 'data.requestId': approved.id }).toArray())
    .some((n) => /back in your balance/.test(n.body)));

  console.log('what cannot be cancelled');
  const started = await applyForLeave('emp', { type: 'casual', startDate: day(-7), endDate: day(-7), reason: 'Last week' });
  const r1 = await refused(() => cancelLeave('emp', started.id));
  ok('a leave that has begun: ask HR', r1.status === 409 && /Ask HR/.test(r1.message), r1);
  const theirs = await applyForLeave('other', { type: 'casual', startDate: day(15), endDate: day(15), reason: 'Mine' });
  ok('someone else\'s: not found', (await refused(() => cancelLeave('emp', theirs.id))).status === 404);
  const declined = await applyForLeave('emp', { type: 'casual', startDate: day(30), endDate: day(30), reason: 'No' });
  await decideLeave('mgr', declined.id, { decision: 'declined', managerNote: 'Busy week' });
  ok('a declined one: nothing to cancel', (await refused(() => cancelLeave('emp', declined.id))).status === 409);
  ok('a bad id', (await refused(() => cancelLeave('emp', 'nope'))).status === 400 && (await refused(() => cancelLeave('emp', String(new ObjectId())))).status === 404);
  const long = await applyForLeave('emp', { type: 'casual', startDate: day(40), endDate: day(40), reason: 'Later' });
  const r2 = await refused(() => cancelLeave('emp', long.id, { note: 'x'.repeat(501) }));
  ok('a note over 500 characters is refused', r2.status === 400 && /500/.test(r2.message), r2);
  const r3 = await refused(() => decideLeave('mgr', pending.id, { decision: 'approved' }));
  ok('deciding a cancelled leave says the employee cancelled it', r3.status === 409 && /cancelled/.test(r3.message), r3);
  ok('the rows all kept', (await leaves().countDocuments({ userId: 'emp' })) === 5
    && (await leaves().countDocuments({ userId: 'emp', status: 'cancelled' })) === 2);

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
