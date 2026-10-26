/**
 * Checks leave without pay end to end: HR's switch on a leave type, a balance
 * that never refuses, its own day on the calendar and the attendance report,
 * and loss of pay in a payroll run, on a template that pays every day too.
 * Normal leave and absences must read exactly as before. On a scratch
 * database only:
 *   MONGODB_DB=leave_without_pay_scratch npm run leave-without-pay:check
 */
import { ObjectId } from 'mongodb';
import {
  attendanceRecords, connectDb, getDb, leaves, paidDaysTemplates, payHeads, payslips, salaryStructures, salaryTemplates, shiftTemplates, users,
} from '../config/db';
import type { User } from '../models/user.model';
import { AttendanceRecord } from '../models/attendance.model';
import { attendanceReport, employeeCalendar, employeeDayStatuses } from '../services/attendance-report.service';
import { attendanceCountsForPeriod } from '../services/deduction.service';
import { LeaveError, adminDecideLeave, applyForLeave, decideLeave, getMyLeaveBalance } from '../services/leave.service';
import { createRun } from '../services/payrollRun.service';
import { createShift, setDefaultShift, shiftPolicyFor } from '../services/shift.service';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const ORG = 'lwpcheck';
const MONTH = '2026-09';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

/** A type as the dashboard sends it. */
const type = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
  key, name, perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0,
  advanceDays: 30, allowBackdated: true, backdatedDays: 120, ...extra,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  // ── people: HR, a manager, and three employees with the same month ─────
  // lwp and allpaid take leave without pay; plain takes none, as a control.
  await users().insertMany([
    person('hr', { dashboardAccess: true, employeeId: 'H1' }),
    person('mgr', { employeeId: 'M1' }),
    person('lwp', { managerUserId: 'mgr', employeeId: 'E1' }),
    person('allpaid', { managerUserId: 'mgr', employeeId: 'E2' }),
    person('plain', { managerUserId: 'mgr', employeeId: 'E3' }),
  ]);

  console.log('the switch');
  const shift = await createShift('hr', {
    name: 'General',
    punchFormat: 'In-app punch in',
    policy: {
      leave: {
        approver: 'Reporting manager', hrOverride: true, balanceTracked: true,
        types: [
          type('casual', 'Casual Leave'),
          type('lwp', 'Leave without pay', { perMonth: 0, unpaid: true }),
          // Comp-off is earned by overtime; it can never be unpaid.
          type('comp_off', 'Comp-off', { unpaid: true }),
        ],
      },
    },
  });
  await setDefaultShift('hr', shift.id);
  const saved = await shiftTemplates().findOne({ _id: new ObjectId(shift.id) });
  const savedTypes = saved?.policy.leave.types ?? [];
  ok('saved on the template', savedTypes.find((t) => t.key === 'lwp')?.unpaid === true, savedTypes);
  ok('a paid type stays as it was written', !('unpaid' in (savedTypes.find((t) => t.key === 'casual') ?? {})));
  ok('comp-off cannot be unpaid', savedTypes.find((t) => t.key === 'comp_off')?.unpaid === undefined);
  const view = await shiftPolicyFor('lwp');
  ok('the app is told which type is unpaid', view.leaveTypes.find((t) => t.key === 'lwp')?.unpaid === true
    && view.leaveTypes.find((t) => t.key === 'casual')?.unpaid === false, view.leaveTypes);

  console.log('the balance');
  const balance = await getMyLeaveBalance('lwp', 2026, new Date('2026-09-01T00:00:00Z'));
  const lwpItem = balance.types.find((t) => t.key === 'lwp') as Record<string, unknown> | undefined;
  ok('unlimited and unpaid, with no count', lwpItem?.unlimited === true && lwpItem?.unpaid === true && lwpItem?.total === 0, lwpItem);
  ok('a paid type keeps its balance', balance.types.find((t) => t.key === 'casual')?.total === 12, balance.types);
  // Eleven days of a type with no balance at all, while two more are pending.
  const big = await applyForLeave('lwp', { type: 'lwp', startDate: '2026-08-03', endDate: '2026-08-14', reason: 'Travel' });
  ok('never refused for lack of balance', big.status === 'pending' && big.days === 11, big);
  let refused = '';
  try {
    await applyForLeave('lwp', { type: 'casual', startDate: '2026-10-01', endDate: '2026-10-20', reason: 'Too long' });
  } catch (error) {
    refused = error instanceof LeaveError ? error.message : String(error);
  }
  ok('a paid type is still refused past its balance', /left in 2026/.test(refused), refused);
  await adminDecideLeave('hr', big.id, { decision: 'declined', managerNote: 'Not this time' });

  console.log('approval, as for any leave');
  // September 2026: the 6th and 13th are Sundays, off on the default grid.
  for (const userId of ['lwp', 'allpaid']) {
    const full = await applyForLeave(userId, { type: 'lwp', startDate: '2026-09-07', endDate: '2026-09-08', reason: 'Family' });
    const half = await applyForLeave(userId, { type: 'lwp', startDate: '2026-09-09', endDate: '2026-09-09', halfDay: true, reason: 'Errand' });
    await decideLeave('mgr', full.id, { decision: 'approved' });
    await adminDecideLeave('hr', half.id, { decision: 'approved' });
  }
  for (const userId of ['lwp', 'allpaid', 'plain']) {
    const casual = await applyForLeave(userId, { type: 'casual', startDate: '2026-09-10', endDate: '2026-09-10', reason: 'Rest' });
    await decideLeave('mgr', casual.id, { decision: 'approved' });
  }
  ok('two full days and a half day approved', (await leaves().countDocuments({ userId: 'lwp', type: 'lwp', status: 'approved' })) === 2);

  // Every other working day of September punched in full; the 11th not at all
  // (the 9th, the half day, is worked).
  const now = new Date();
  const records: AttendanceRecord[] = [];
  const employeeIdOf: Record<string, string> = { lwp: 'E1', allpaid: 'E2', plain: 'E3' };
  for (const userId of ['lwp', 'allpaid', 'plain']) {
    for (let d = 1; d <= 30; d += 1) {
      const date = `${MONTH}-${String(d).padStart(2, '0')}`;
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
      // Leave days carry no punches; the control worked the 7th to the 9th.
      if ((userId === 'plain' ? ['10', '11'] : ['07', '08', '10', '11']).includes(date.slice(8))) continue;
      records.push({
        userId, employeeId: employeeIdOf[userId], workDate: date,
        punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:05:00+05:30`),
        source: 'manual', sourceKey: `manual|${employeeIdOf[userId]}|${date}`, importedAt: now, updatedAt: now,
      });
    }
  }
  await attendanceRecords().insertMany(records);

  console.log('the calendar and the report');
  const cal = await employeeCalendar('hr', 'lwp', MONTH);
  const on = (date: string) => cal.days.find((d) => d.date === `${MONTH}-${date}`);
  ok('a full day is leave without pay', on('07')?.status === 'unpaid_leave' && on('08')?.status === 'unpaid_leave' && !on('07')?.halfDay, on('07'));
  ok('a half day is leave without pay, half', on('09')?.status === 'unpaid_leave' && on('09')?.halfDay === true, on('09'));
  ok('paid leave is still on leave', on('10')?.status === 'on_leave' && on('10')?.label === 'casual', on('10'));
  ok('no punch is still absent', on('11')?.status === 'absent', on('11'));
  ok('its own count in the totals', cal.totals.unpaid_leave === 3 && cal.totals.on_leave === 1 && cal.totals.absent === 1, cal.totals);
  const app = await employeeDayStatuses(ORG, 'lwp', `${MONTH}-07`, `${MONTH}-09`);
  ok('the app is told "Leave without pay"', app?.every((d) => d.status === 'unpaid_leave') === true
    && app?.[0].reason === 'Leave without pay' && app?.[2].reason === 'Leave without pay · half day', app);
  const report = await attendanceReport('hr', { from: `${MONTH}-01`, to: `${MONTH}-30` });
  const statusOf = (userId: string, date: string) => report.days.find((d) => d[0] === userId && d[1] === `${MONTH}-${date}`)?.[2];
  ok('the report grades it unpaid_leave', statusOf('lwp', '07') === 'unpaid_leave' && statusOf('lwp', '09') === 'unpaid_leave');
  ok('the report marks the half day', report.halfDayLeave.includes(`lwp|${MONTH}-09`));
  ok('the control reads as before', statusOf('plain', '07') === 'present' && statusOf('plain', '10') === 'on_leave' && statusOf('plain', '11') === 'absent');

  console.log('payroll');
  const counts = await attendanceCountsForPeriod('hr', MONTH);
  const lwpCounts = counts.get('lwp');
  ok('2.5 days of leave without pay, not leave or absence', lwpCounts?.unpaid_leave === 3 && lwpCounts?.unpaidLeaveLop === 2.5
    && lwpCounts?.leave === 1 && lwpCounts?.absent === 1, lwpCounts);
  ok('the control counts as before', counts.get('plain')?.leave === 1 && counts.get('plain')?.absent === 1 && counts.get('plain')?.unpaid_leave === 0, counts.get('plain'));

  // A small payroll on the check's own components; no real salary is read.
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG });
  await paidDaysTemplates().insertMany([
    { org: ORG, code: 'DEFAULT', name: 'Calendar', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 1, isDefault: true, createdAt: now, updatedAt: now },
    { org: ORG, code: 'ALLPAID', name: 'All days paid', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: false, createdAt: now, updatedAt: now },
  ]);
  await salaryStructures().insertMany(['lwp', 'allpaid', 'plain'].map((userId) => ({
    org: ORG, userId, salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 3_60_000_00, status: 'active' as const,
    ...(userId === 'allpaid' ? { paidDaysTemplateCode: 'ALLPAID' } : {}), createdAt: now, updatedAt: now,
  })));
  await createRun('hr', { period: MONTH });
  const slip = async (userId: string) => (await payslips().findOne({ org: ORG, period: MONTH, userId }))!;
  const [lwpSlip, allSlip, plainSlip] = await Promise.all([slip('lwp'), slip('allpaid'), slip('plain')]);
  const lineOf = (s: typeof lwpSlip) => s.inputs.attendanceDeductions?.find((l) => l.trigger === 'unpaid_leave');
  // The calendar template's one paid-leave day covers the absence, never the unpaid days.
  ok('calendar template: the absence covered, 2.5 unpaid', lwpSlip.inputs.lopDays === 2.5 && lwpSlip.inputs.paidLeaveDaysApplied === 1, lwpSlip.inputs);
  ok('all-days-paid template: still 2.5 unpaid', allSlip.inputs.lopDays === 2.5 && allSlip.inputs.payableDays === 27.5, allSlip.inputs);
  ok('the payslip names it', lineOf(lwpSlip)?.label === 'Leave without pay' && lineOf(lwpSlip)?.count === 3 && lineOf(lwpSlip)?.days === 2.5
    && lineOf(allSlip)?.days === 2.5, lwpSlip.inputs.attendanceDeductions);
  ok('the control: absence covered, nothing unpaid', plainSlip.inputs.lopDays === 0 && !lineOf(plainSlip)
    && plainSlip.inputs.attendanceDeductions?.find((l) => l.trigger === 'absent')?.days === 1, plainSlip.inputs);

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
