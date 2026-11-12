/**
 * Cancelling a leave, end to end on a scratch database. A pending leave is
 * withdrawn at once. An approved one becomes a cancellation request: it stays
 * approved (balance, calendar) until the approver agrees (then it is
 * cancelled and counts nowhere) or declines (it stays). How far back is the
 * leave type's backdating window, re-checked with the payroll lock when the
 * approver agrees. Someone else's, a declined one, one already requested are
 * refused.
 *
 *   MONGODB_DB=leave_cancel_scratch NOTIFY_ORGS=cancelcheck EMAIL_ORGS=nobody-scratch npm run leave-cancel:check
 */
import { ObjectId } from 'mongodb';
import { connectDb, getDb, leaves, notifications, payrollRuns, users } from '../config/db';
import type { User } from '../models/user.model';
import { employeeDayStatuses } from '../services/attendance-report.service';
import {
  LeaveError, adminDecideLeave, applyForLeave, cancelLeave, decideLeave, decideLeaveCancellation, getManagerLeaveInbox, getMyLeaveBalance,
  getMyLeaves, listAllLeavesForAdmin,
} from '../services/leave.service';
import { resolveNotifications } from '../services/notification-resolution.service';
import { listNotificationRows } from '../services/notification.service';
import { pendingFor } from '../services/request-notifications.service';
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
        }, {
          key: 'earned', name: 'Earned Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none',
          encashLimitDays: 0, advanceDays: 60, allowBackdated: true, backdatedDays: 10,
        }, {
          key: 'sick', name: 'Sick Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none',
          encashLimitDays: 0, advanceDays: 60, allowBackdated: false, backdatedDays: 0,
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
  ok('cancelled at once, with the note: a pending leave withdrawn', taken.status === 'cancelled' && taken.cancelNote === 'Plans changed' && !!taken.cancelledAt
    && taken.cancelledFrom === 'pending' && taken.cancelRequest === undefined, taken);
  ok('nothing on the balance', (await casualUsed('emp')) === 0);
  ok('the manager\'s inbox lists it as cancelled, nothing left to decide', (await getManagerLeaveInbox('mgr')).some((l) => l.id === pending.id && l.status === 'cancelled'));
  ok('still in the employee\'s history', (await getMyLeaves('emp')).some((l) => l.id === pending.id && l.status === 'cancelled'));
  const told = await notifications().find({ scenario: 'leave_cancelled' }).toArray();
  ok('the manager hears, with the note; the employee gets a line of their own',
    told.some((n) => n.userId === 'mgr' && /emp cancelled/.test(n.title) && /Plans changed/.test(n.body) && n.data.requestId === pending.id)
    && told.some((n) => n.userId === 'emp' && n.title === 'Leave cancelled'), told.map((n) => [n.userId, n.title, n.body]));
  ok('cancelling twice is refused', (await refused(() => cancelLeave('emp', pending.id))).status === 409);

  console.log('an approved leave: a cancellation request, approved by the manager');
  const approved = await applyForLeave('emp', { type: 'casual', startDate: day(20), endDate: day(20), reason: 'Errand' });
  await decideLeave('mgr', approved.id, { decision: 'approved' });
  ok('one day used once approved', (await casualUsed('emp')) === 1);
  const onCalendar = async (date: string) => ((await employeeDayStatuses(ORG, 'emp', date, date)) ?? []).some((m) => /leave/i.test(m.status));
  ok('on the calendar while approved', await onCalendar(day(20)));
  const asked = await cancelLeave('emp', approved.id, { note: 'Trip called off' });
  ok('the leave stays approved, with a cancellation request waiting', asked.status === 'approved' && asked.cancelRequest?.status === 'pending'
    && asked.cancelRequest.note === 'Trip called off' && !!asked.cancelRequest.requestedAt && asked.cancelledAt === undefined && asked.cancelledFrom === undefined, asked);
  ok('still counted: the balance and the calendar', (await casualUsed('emp')) === 1 && await onCalendar(day(20)));
  ok('the manager\'s inbox has it, request and all', (await getManagerLeaveInbox('mgr')).some((l) => l.id === approved.id && l.status === 'approved' && l.cancelRequest?.status === 'pending'));
  ok('HR\'s list has it too', (await listAllLeavesForAdmin('hr')).some((l) => l.id === approved.id && l.cancelRequest?.status === 'pending'));
  const askedMgr = await notifications().find({ scenario: 'leave_cancel_requested', userId: 'mgr', 'data.requestId': approved.id }).toArray();
  ok('the manager is asked, with the note (push + inbox)', askedMgr.some((n) => /emp asked to cancel their approved leave/.test(n.title) && /Trip called off/.test(n.body)
    && n.data.view === 'inbox' && n.data.kind === 'cancellation'), askedMgr.map((n) => [n.title, n.body]));
  ok('the employee gets a quiet line: sent', (await notifications().countDocuments({ scenario: 'leave_cancel_sent', userId: 'emp', 'data.requestId': approved.id })) === 1);
  ok('the reminders count it as waiting on the manager', (await pendingFor((await users().findOne({ userId: 'mgr' }))!, new Date())).leave === 1);
  const mgrRows = await listNotificationRows('mgr');
  const unresolved = (await resolveNotifications('mgr', mgrRows)).find((n) => n.scenario === 'leave_cancel_requested' && n.data.requestId === approved.id);
  ok('the manager\'s request row stays open while it waits', !!unresolved && !unresolved.resolved, unresolved);
  const again = await refused(() => cancelLeave('emp', approved.id));
  ok('asking twice is refused: already with the manager', again.status === 409 && /already with your manager/.test(again.message), again);
  ok('someone else\'s manager cannot decide it', (await refused(() => decideLeaveCancellation('other', approved.id, { decision: 'approved' }, 'manager'))).status === 403);
  ok('nor the employee themself, as admin', (await refused(() => decideLeaveCancellation('emp', approved.id, { decision: 'approved' }, 'admin'))).status === 403);
  ok('a bad decision word', (await refused(() => decideLeaveCancellation('mgr', approved.id, { decision: 'maybe' }, 'manager'))).status === 400);
  ok('the leave decision path still says it is decided', (await refused(() => decideLeave('mgr', approved.id, { decision: 'declined', managerNote: 'x' }))).status === 409);
  const yes = await decideLeaveCancellation('mgr', approved.id, { decision: 'approved' }, 'manager');
  ok('approved: the leave is cancelled, the employee\'s note kept', yes.status === 'cancelled' && yes.cancelNote === 'Trip called off' && !!yes.cancelledAt
    && yes.cancelRequest?.status === 'approved' && yes.cancelRequest.decidedByRole === 'manager' && yes.cancelledFrom === 'approved', yes);
  ok('uncounted: the day is back on the balance and off the calendar', (await casualUsed('emp')) === 0 && !(await onCalendar(day(20))));
  const toldEmp = await notifications().find({ scenario: 'leave_cancel_decided', userId: 'emp', 'data.requestId': approved.id }).toArray();
  ok('the employee hears it was approved', toldEmp.some((n) => n.title === 'Leave cancelled ✓' && /back in your balance/.test(n.body)), toldEmp.map((n) => [n.title, n.body]));
  const resolvedRow = (await resolveNotifications('mgr', await listNotificationRows('mgr'))).find((n) => n.scenario === 'leave_cancel_requested' && n.data.requestId === approved.id);
  ok('the manager\'s request row resolves once decided', resolvedRow?.resolved === true);
  ok('nothing left waiting on the manager', (await pendingFor((await users().findOne({ userId: 'mgr' }))!, new Date())).leave === 0);
  ok('deciding it twice is refused', (await refused(() => decideLeaveCancellation('mgr', approved.id, { decision: 'approved' }, 'manager'))).status === 409);
  ok('cancelling it again is refused', (await refused(() => cancelLeave('emp', approved.id))).status === 409);

  console.log('an approved leave: the cancellation declined, asked again, approved by HR');
  const kept = await applyForLeave('emp', { type: 'casual', startDate: day(25), endDate: day(25), reason: 'Wedding' });
  await decideLeave('mgr', kept.id, { decision: 'approved' });
  await cancelLeave('emp', kept.id);
  const no = await decideLeaveCancellation('mgr', kept.id, { decision: 'declined', note: 'Cover is booked' }, 'manager');
  ok('declined: the leave stays approved, with the manager\'s note', no.status === 'approved' && no.cancelRequest?.status === 'declined'
    && no.cancelRequest.decisionNote === 'Cover is booked' && no.cancelledAt === undefined, no);
  ok('still counted after a decline', (await casualUsed('emp')) === 1 && await onCalendar(day(25)));
  ok('the employee hears why', (await notifications().find({ scenario: 'leave_cancel_decided', userId: 'emp', 'data.requestId': kept.id }).toArray())
    .some((n) => n.title === 'Cancellation not approved' && /Cover is booked/.test(n.body)));
  ok('a declined cancellation cannot be decided again', (await refused(() => decideLeaveCancellation('mgr', kept.id, { decision: 'approved' }, 'manager'))).status === 409);
  const reasked = await cancelLeave('emp', kept.id, { note: 'Please, the wedding moved' });
  ok('the employee may ask again after a decline', reasked.status === 'approved' && reasked.cancelRequest?.status === 'pending' && reasked.cancelRequest.note === 'Please, the wedding moved', reasked);
  const byHr = await decideLeaveCancellation('hr', kept.id, { decision: 'approved', note: 'Cleared' }, 'admin');
  ok('HR approves it from the dashboard: cancelled, recorded as admin', byHr.status === 'cancelled' && byHr.cancelRequest?.decidedByRole === 'admin'
    && byHr.cancelledFrom === 'approved' && byHr.cancelNote === 'Please, the wedding moved' && (await casualUsed('emp')) === 0, byHr);
  ok('HR\'s decision reads as from HR', (await notifications().find({ scenario: 'leave_cancel_decided', userId: 'emp', 'data.requestId': kept.id }).toArray())
    .some((n) => n.title === 'Leave cancelled ✓' && n.data.from === 'hr'));
  const noNote = await applyForLeave('emp', { type: 'casual', startDate: day(26), endDate: day(26), reason: 'Later' });
  await decideLeave('mgr', noNote.id, { decision: 'approved' });
  await cancelLeave('emp', noNote.id);
  ok('a decline needs no note', (await decideLeaveCancellation('mgr', noNote.id, { decision: 'declined' }, 'manager')).cancelRequest?.status === 'declined');
  const r4 = await refused(() => decideLeaveCancellation('mgr', noNote.id, { decision: 'declined', note: 'x'.repeat(501) }, 'manager'));
  ok('nothing waiting: deciding refused', r4.status === 409 && /no cancellation request/.test(r4.message), r4);
  const stillPending = await applyForLeave('emp', { type: 'casual', startDate: day(27), endDate: day(27), reason: 'Maybe' });
  ok('a pending leave has no cancellation to decide', (await refused(() => decideLeaveCancellation('mgr', stillPending.id, { decision: 'approved' }, 'manager'))).status === 409);
  ok('nor an HR leave override on it', (await refused(() => adminDecideLeave('hr', approved.id, { decision: 'approved' }))).status === 409);

  console.log('the window and the payroll lock, when asked and again when approved');
  // Today as the service reads it: the day in India. A weekend has no leave to apply for.
  const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const weekend = [0, 6].includes(new Date(`${istToday}T00:00:00Z`).getUTCDay());
  const todays = weekend ? null : await applyForLeave('emp', { type: 'casual', startDate: istToday, endDate: istToday, reason: 'Today' });
  if (todays) ok('a leave for today can still be taken back on the day', (await cancelLeave('emp', todays.id)).status === 'cancelled');
  else console.log('  (skipped: today is a weekend)');
  // As far back as the type lets you apply: Casual Leave reaches 120 days back.
  const started = await applyForLeave('emp', { type: 'casual', startDate: day(-7), endDate: day(-7), reason: 'Last week' });
  ok('a pending leave that began a week ago, inside its type\'s 120-day window: withdrawn', (await cancelLeave('emp', started.id)).status === 'cancelled');
  /** YYYY-MM-DD `n` days ago, weekend or not: these rows are written straight in. */
  const ago = (n: number) => new Date(`${istToday}T00:00:00Z`).getTime() - n * 86_400_000;
  const agoKey = (n: number) => new Date(ago(n)).toISOString().slice(0, 10);
  const approvedRow = (type: string, date: string, reason: string) => leaves().insertOne({
    userId: 'emp', type, startDate: new Date(`${date}T00:00:00Z`), endDate: new Date(`${date}T00:00:00Z`), days: 1, reason,
    status: 'approved', decidedAt: new Date(), decidedByUserId: 'mgr', decidedByRole: 'manager', createdAt: Date.now(), updatedAt: new Date(),
  } as never).then((r) => r.insertedId.toHexString());
  // Earned Leave reaches 10 days back: one that began 20 days ago is past it.
  const old = await approvedRow('earned', agoKey(20), 'Old');
  const r1 = await refused(() => cancelLeave('emp', old));
  ok('past its type\'s backdating window (10 days): refused, with the window', r1.status === 409 && /up to 10 days back/.test(r1.message), r1);
  // Sick Leave can't be backdated, so once it has started it can't be cancelled here.
  const sick = await approvedRow('sick', agoKey(2), 'Fever');
  const rSick = await refused(() => cancelLeave('emp', sick));
  ok('a type with no backdating, once started: refused', rSick.status === 409 && /once it has started/.test(rSick.message), rSick);
  // Inside the window when asked; past it by the time the manager answers.
  const late = await approvedRow('earned', agoKey(7), 'Late');
  ok('asked inside the 10-day window: a request', (await cancelLeave('emp', late)).cancelRequest?.status === 'pending');
  await leaves().updateOne({ _id: new ObjectId(late) }, { $set: { startDate: new Date(`${agoKey(20)}T00:00:00Z`), endDate: new Date(`${agoKey(20)}T00:00:00Z`) } });
  const r5 = await refused(() => decideLeaveCancellation('mgr', late, { decision: 'approved' }, 'manager'));
  ok('the window is checked again at approval: refused once past it', r5.status === 409 && /up to 10 days back/.test(r5.message), r5);
  ok('and the leave and its request are left as they were', (await leaves().findOne({ _id: new ObjectId(late) }))?.cancelRequest?.status === 'pending');
  ok('declining it is still possible', (await decideLeaveCancellation('mgr', late, { decision: 'declined', note: 'Too late' }, 'manager')).status === 'approved');
  // The payroll lock: once the month it began in has been run.
  const locked = await approvedRow('casual', agoKey(7), 'Locked');
  const period = agoKey(7).slice(0, 7);
  await payrollRuns().insertOne({ org: ORG, period, status: 'approved', createdAt: new Date(), updatedAt: new Date() } as never);
  const r6 = await refused(() => cancelLeave('emp', locked));
  ok('payroll run for that month: asking is refused', r6.status === 409 && /Payroll/.test(r6.message), r6);
  await payrollRuns().deleteMany({ org: ORG });
  ok('before the run: asked', (await cancelLeave('emp', locked)).cancelRequest?.status === 'pending');
  await payrollRuns().insertOne({ org: ORG, period, status: 'pending_approval', createdAt: new Date(), updatedAt: new Date() } as never);
  const r7 = await refused(() => decideLeaveCancellation('mgr', locked, { decision: 'approved' }, 'manager'));
  ok('payroll run before the manager answers: approving is refused', r7.status === 409 && /Payroll/.test(r7.message), r7);
  await payrollRuns().deleteMany({ org: ORG });
  ok('once the run is gone it can be approved', (await decideLeaveCancellation('mgr', locked, { decision: 'approved' }, 'manager')).status === 'cancelled');

  console.log('what cannot be cancelled');
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

  console.log('what a cancelled leave had been, for its label');
  // Rows cancelled before requests existed carry no cancelRequest: a decision on record means approved.
  const legacy = await leaves().insertMany([
    { userId: 'emp', type: 'casual', startDate: new Date('2026-01-05T00:00:00Z'), endDate: new Date('2026-01-05T00:00:00Z'), days: 1, reason: 'Legacy approved',
      status: 'cancelled', decidedAt: new Date('2026-01-01T00:00:00Z'), decidedByRole: 'manager', cancelledAt: new Date('2026-01-02T00:00:00Z'), createdAt: Date.now(), updatedAt: new Date() },
    { userId: 'emp', type: 'casual', startDate: new Date('2026-01-06T00:00:00Z'), endDate: new Date('2026-01-06T00:00:00Z'), days: 1, reason: 'Legacy pending',
      status: 'cancelled', cancelledAt: new Date('2026-01-02T00:00:00Z'), createdAt: Date.now(), updatedAt: new Date() },
  ] as never[]);
  const mine = await getMyLeaves('emp');
  const from = (id: unknown) => mine.find((l) => l.id === String(id))?.cancelledFrom;
  ok('an old cancelled row decided first reads as an approved leave cancelled', from(legacy.insertedIds[0]) === 'approved');
  ok('an old one never decided reads as a pending leave withdrawn', from(legacy.insertedIds[1]) === 'pending');
  ok('a leave still standing has no cancelledFrom', mine.filter((l) => l.status !== 'cancelled').every((l) => l.cancelledFrom === undefined));

  // emp's rows: pending, approved, kept, noNote, stillPending, [todays], started, old, sick, late, locked,
  // declined, long, and the two legacy ones. Cancelled: pending, approved, kept, [todays], started,
  // locked, and the two legacy ones.
  ok('the rows all kept', (await leaves().countDocuments({ userId: 'emp' })) === (todays ? 15 : 14)
    && (await leaves().countDocuments({ userId: 'emp', status: 'cancelled' })) === (todays ? 8 : 7));

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
