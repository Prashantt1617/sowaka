/**
 * Overtime pay end to end: HR sets the salary template's overtime rule (the
 * dashboard's save path), the run turns the pay period's approved overtime
 * hours into pay through it (`overtimePayFor`), HR can still type the amount
 * on the run, and the released payslip shows it to the employee — the list
 * the app reads, the payslip HTML/PDF, and Payroll's home in the app.
 *
 * Runs on a pay cycle from the database (payroll_periods: 26th to 25th), so
 * the hours counted are the cycle's, not the calendar month's. Test data is
 * the `sowaka` org with invented people and amounts. Scratch database only:
 *   MONGODB_DB=payroll_overtime_scratch npm run payroll:overtime-check
 */
import { ObjectId } from 'mongodb';
import {
  companies, connectDb, getDb, overtimeRequests, paidDaysTemplates, payHeads, payrollPeriods, payslips, salaryStructures,
  salaryTemplates, shiftTemplates, statutoryConfigs, tdsConfigs, users,
} from '../config/db';
import type { User } from '../models/user.model';
import { OVERTIME_PAID_IN_PAYROLL, type OvertimeCompensation, type OvertimeRequest } from '../models/overtime.model';
import { DEFAULT_ORG_SHIFT_POLICY } from '../models/shift.model';
import { myPayrollHome } from '../services/employeePayroll.home';
import { applyForLeave, getMyLeaveBalance } from '../services/leave.service';
import { adminDecideOvertime, createOvertimeRequest, decideOvertime, getManagerOvertimeInbox, getMyOvertimeRequests, listAllOvertimeForAdmin } from '../services/overtime.service';
import { compensationNote, overtimeApprovedEmail } from '../services/request-notifications.service';
import { createRun, myPayslipHtml, myPayslips, recomputeRun, submitRun } from '../services/payrollRun.service';
import { getSalaryTemplate, updateSalaryTemplate } from '../services/salaryTemplate.service';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}

const ORG = 'sowaka';
const CODE = 'BELOW_TAXABLE';
const PERIOD = '2026-09';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), managerUserId: 'hr', ...extra,
} as User);
const ot = (
  workDate: string, hours: number, status: OvertimeRequest['status'],
  extra: { userId?: string; compensation?: OvertimeCompensation; duration?: OvertimeRequest['duration'] } = {},
): OvertimeRequest => {
  const start = new Date(`${workDate}T13:30:00Z`);
  return {
    userId: extra.userId ?? 'asha', managerUserId: 'hr', workDate: new Date(`${workDate}T00:00:00Z`), startTime: start,
    endTime: new Date(start.getTime() + hours * 3_600_000), hours, duration: extra.duration ?? 'half_day', status,
    ...(extra.compensation ? { compensation: extra.compensation } : {}),
    createdAt: new Date(), updatedAt: new Date(),
  };
};
const ymd = (date: Date) => date.toISOString().slice(0, 10);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

(async () => {
  await connectDb();
  const db = getDb();
  if (!/_scratch$/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}: set MONGODB_DB=payroll_overtime_scratch`);
  await db.dropDatabase();
  await connectDb();

  const now = new Date();
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  await companies().insertOne({ id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31' } } as never);
  await users().insertMany([
    person('hr', { dashboardAccess: true, dashboardAdmin: true, employeeId: 'H1', managerUserId: undefined }),
    person('asha', { employeeId: 'E1' }),
    person('bala', { employeeId: 'E2' }),
    person('chitra', { employeeId: 'E3' }),
    person('dev', { employeeId: 'E4' }),
    person('farah', { employeeId: 'E5' }),
  ]);
  // A 26th-to-25th cycle: September is 26 Aug – 25 Sep, 31 base days.
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now } as never);
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES[CODE], org: ORG });
  // Every day paid: what is checked here is overtime, not attendance.
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'All days', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now } as never);
  await salaryStructures().insertMany(['asha', 'bala', 'chitra'].map((userId) => ({
    org: ORG, userId, salaryTemplateCode: CODE, annualCtcPaise: 6_00_000_00, status: 'active' as const, createdAt: now, updatedAt: now,
  })));
  // Asha's overtime: 3 h + 2 h approved inside the cycle (27 Aug, and 25 Sep
  // its last day); approved hours just outside it (25 Aug is August's, 26 Sep
  // October's), and a pending and a declined claim inside it, none paid.
  await overtimeRequests().insertMany([
    ot('2026-08-27', 3, 'approved'),
    ot('2026-09-25', 2, 'approved'),
    ot('2026-08-25', 5, 'approved'),
    ot('2026-09-26', 4, 'approved'),
    ot('2026-09-10', 6, 'pending'),
    ot('2026-09-11', 7, 'declined'),
    // Chitra chose how each claim is compensated (Asha's above are from
    // before the choice): 4 h as overtime pay, a full day and a half day as
    // comp-off, and a declined comp-off — only the 4 h are paid.
    ot('2026-09-01', 4, 'approved', { userId: 'chitra', compensation: { kind: 'pay' } }),
    ot('2026-09-02', 8, 'approved', { userId: 'chitra', duration: 'full_day', compensation: { kind: 'comp_off', days: 1 } }),
    ot('2026-09-03', 4, 'approved', { userId: 'chitra', compensation: { kind: 'comp_off', days: 0.5 } }),
    ot('2026-09-04', 8, 'declined', { userId: 'chitra', duration: 'full_day', compensation: { kind: 'comp_off', days: 1 } }),
  ]);
  const HOURS = 5;
  const CHITRA_PAID_HOURS = 4;
  const BASE_DAYS = 31;

  console.log('HR sets the overtime rule on the salary template');
  const view = await getSalaryTemplate('hr', CODE);
  const save = (overtimePay: unknown) => updateSalaryTemplate('hr', CODE, { ...view, overtimePay });
  ok('no rule yet: HR types overtime on the run', view.overtimePay === null, view.overtimePay);
  ok('a multiplier over 5 is refused (400)', (await refusal(() => save({ mode: 'hourly_multiple', base: 'basic', multiplier: 6, hoursPerDay: 8 }))).status === 400);
  ok('a flat rate of nothing is refused (400)', (await refusal(() => save({ mode: 'flat_per_hour', flatPerHourPaise: 0 }))).status === 400);
  const saved = await save({ mode: 'hourly_multiple', base: 'basic', multiplier: 2, hoursPerDay: 8 });
  ok('2× the hourly rate from Basic, 8-hour day: saved as set', JSON.stringify(saved.overtimePay) === JSON.stringify({ mode: 'hourly_multiple', base: 'basic', multiplier: 2, hoursPerDay: 8 }), saved.overtimePay);

  console.log('the run pays the cycle\'s approved hours by the rule');
  const created = await createRun('hr', { period: PERIOD });
  ok('the run is on the cycle: 26 Aug – 25 Sep, 31 base days', created.run.periodFrom === '2026-08-26' && created.run.periodTo === '2026-09-25' && created.run.baseDays === BASE_DAYS, created.run);
  const slip = async (userId: string) => (await payslips().findOne({ org: ORG, period: PERIOD, userId }))!;
  let asha = await slip('asha');
  const basicFull = asha.earnings.find((l) => l.code === 'BASIC')!.fullPaise;
  const earnedPaid = (s: typeof asha) => s.earnings.reduce((t, l) => t + l.paidPaise, 0);
  const byBasic = Math.round((basicFull / (BASE_DAYS * 8)) * 2 * HOURS);
  ok(`5 approved hours in the cycle at 2× Basic ÷ (31 × 8): ${inr(byBasic)}`, asha.inputs.overtimePaise === byBasic && !asha.inputs.overtimeEnteredByHr, { got: asha.inputs.overtimePaise, want: byBasic });
  ok('overtime is in gross, on top of the earnings (not prorated)', asha.grossPaise === earnedPaid(asha) + byBasic, { gross: asha.grossPaise, earned: earnedPaid(asha) });
  ok('someone with no overtime: none', (await slip('bala')).inputs.overtimePaise === 0);
  ok('requests from before the compensation choice (Asha\'s) are paid as before', !(await overtimeRequests().findOne({ userId: 'asha', compensation: { $exists: true } })) && asha.inputs.overtimePaise === byBasic);
  const chitraByBasic = Math.round((basicFull / (BASE_DAYS * 8)) * 2 * CHITRA_PAID_HOURS);
  let chitra = await slip('chitra');
  ok(`overtime pay chosen: its 4 h paid as before, ${inr(chitraByBasic)}; the comp-off claims add no pay`, chitra.inputs.overtimePaise === chitraByBasic && chitra.inputs.approvedOtHours === CHITRA_PAID_HOURS, { got: chitra.inputs, want: chitraByBasic });

  await save({ mode: 'hourly_multiple', base: 'gross', multiplier: 1.5, hoursPerDay: 9 });
  await recomputeRun('hr', created.run.id, {});
  asha = await slip('asha');
  const grossFull = asha.earnings.reduce((t, l) => t + l.fullPaise, 0);
  const byGross = Math.round((grossFull / (BASE_DAYS * 9)) * 1.5 * HOURS);
  ok(`HR changes it to 1.5× Gross, 9-hour day; recalculated: ${inr(byGross)}`, asha.inputs.overtimePaise === byGross, { got: asha.inputs.overtimePaise, want: byGross });

  await save({ mode: 'flat_per_hour', flatPerHourPaise: 250_00 });
  await recomputeRun('hr', created.run.id, {});
  ok('a fixed ₹250 an hour: ₹1,250 for 5 hours', (await slip('asha')).inputs.overtimePaise === 1_250_00, (await slip('asha')).inputs.overtimePaise);

  await recomputeRun('hr', created.run.id, { overtimePaise: { asha: 999_00 } });
  asha = await slip('asha');
  ok('HR types ₹999 on the run: that, not the rule', asha.inputs.overtimePaise === 999_00 && asha.inputs.overtimeEnteredByHr === true, asha.inputs);
  await recomputeRun('hr', created.run.id, {});
  ok('…and it stays through a recalculation', (await slip('asha')).inputs.overtimePaise === 999_00);
  await recomputeRun('hr', created.run.id, { overtimePaise: { asha: null } });
  ok('cleared: back to the rule', (await slip('asha')).inputs.overtimePaise === 1_250_00);

  await save(null);
  await recomputeRun('hr', created.run.id, {});
  ok('rule off: approved hours alone pay nothing', (await slip('asha')).inputs.overtimePaise === 0);

  await save({ mode: 'hourly_multiple', base: 'basic', multiplier: 2, hoursPerDay: 8 });
  // Released with two days' loss of pay typed by HR, so the payslip has both.
  await recomputeRun('hr', created.run.id, { lopDays: { asha: 2 } });
  asha = await slip('asha');
  ok('rule back on, recalculated; two days\' loss of pay do not touch overtime', asha.inputs.overtimePaise === byBasic && asha.inputs.lopDays === 2, asha.inputs);
  const lopOnSlip = asha.earnings.reduce((t, l) => t + l.fullPaise - l.paidPaise, 0);

  console.log('the employee sees it once the run is released');
  ok('not before: a draft run shows no payslip', (await myPayslips('asha')).payslips.length === 0);
  await submitRun('hr', created.run.id);
  const mine = await myPayslips('asha');
  const shown = mine.payslips[0]?.payslip;
  ok('the app\'s payslip list carries the overtime (inputs.overtimePaise)', shown?.inputs.overtimePaise === byBasic, shown?.inputs);
  const html = await myPayslipHtml('asha', String(shown?.id ?? asha._id));
  const rupees = `₹${Math.round(byBasic / 100).toLocaleString('en-IN')}`;
  ok(`the payslip HTML/PDF has an Overtime line: ${rupees}`, html.includes(`Overtime</div></td><td class="r">${rupees}<`), html.match(/Overtime<\/div><\/td><td[^>]*>[^<]*/)?.[0]);
  const bala = (await myPayslips('bala')).payslips[0]?.payslip;
  ok('…and none for someone without overtime', bala !== undefined && !(await myPayslipHtml('bala', String(bala.id))).includes('Overtime'));
  chitra = await slip('chitra');
  const chitraShown = (await myPayslips('chitra')).payslips[0]?.payslip;
  ok(`overtime pay chosen: the released payslip pays only those hours, ${inr(chitraByBasic)}`,
    chitraShown?.inputs.overtimePaise === chitraByBasic && chitra.grossPaise === earnedPaid(chitra) + chitraByBasic, chitraShown?.inputs);

  const home = await myPayrollHome('asha', PERIOD, new Date('2026-10-02T06:00:00Z'));
  const salary = home.appEnabled ? home.salary : null;
  ok('Payroll home shows the released payslip', salary?.status === 'final', salary);
  ok('Payroll home: the overtime, as on the payslip', salary?.overtimePaise === byBasic, salary && { overtimePaise: salary.overtimePaise });
  ok('Payroll home: the loss of pay as on the payslip, not less by the overtime', salary?.lopDays === 2 && salary?.lopPaise === lopOnSlip, salary && { lopPaise: salary.lopPaise, onSlip: lopOnSlip });
  ok('Payroll home adds up: gross − loss of pay + overtime − deductions = net',
    salary !== null && salary !== undefined && salary.grossPaise - salary.lopPaise + salary.overtimePaise - asha.employeeDeductionsPaise === salary.netPaise,
    salary && { gross: salary.grossPaise, lop: salary.lopPaise, ot: salary.overtimePaise, deductions: asha.employeeDeductionsPaise, net: salary.netPaise });

  console.log('comp-off chosen: credited to the Comp-off balance instead of paid');
  const compOff = async (userId: string, year = 2026) =>
    (await getMyLeaveBalance(userId, year, new Date(`${year}-12-31T06:00:00Z`))).comp_off;
  ok('a full day credits 1 and a half day 0.5; overtime pay and a declined claim credit nothing: 1.5',
    (await compOff('chitra')).total === 1.5, await compOff('chitra'));
  ok('requests from before the choice credit as they always did (four approved half days: 2)',
    (await compOff('asha')).total === 2, await compOff('asha'));

  console.log('the form: what the server accepts');
  const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86_400_000));
  const claim = (userId: string, workDate: string, duration: 'half_day' | 'full_day', compensation?: unknown) =>
    createOvertimeRequest(userId, {
      workDate,
      startTime: `${workDate}T09:00:00.000Z`,
      endTime: `${workDate}T${duration === 'full_day' ? '18' : '13'}:00:00.000Z`,
      duration,
      compensation,
      note: 'Release night',
    });
  ok('an unknown compensation is refused (400)', (await refusal(() => claim('chitra', daysAgo(1), 'half_day', { kind: 'cash' }))).status === 400);
  ok('comp-off of 2 days is refused (400)', (await refusal(() => claim('chitra', daysAgo(1), 'full_day', { kind: 'comp_off', days: 2 }))).status === 400);
  ok('a full day of comp-off for half a day of overtime is refused (400)', (await refusal(() => claim('chitra', daysAgo(1), 'half_day', { kind: 'comp_off', days: 1 }))).status === 400);
  // Dev's shift template has no Comp-off leave type.
  await shiftTemplates().insertOne({
    org: ORG, name: 'No comp-off', active: true, isDefault: false, assignedUserIds: ['dev'], createdAt: now, updatedAt: now,
    policy: { ...structuredClone(DEFAULT_ORG_SHIFT_POLICY), leave: { ...structuredClone(DEFAULT_ORG_SHIFT_POLICY.leave), types: DEFAULT_ORG_SHIFT_POLICY.leave.types.filter((t) => t.key !== 'comp_off') } },
  } as never);
  const noCompOff = await refusal(() => claim('dev', daysAgo(1), 'half_day', { kind: 'comp_off', days: 0.5 }));
  ok('comp-off where HR has no Comp-off leave type is refused (409), with a reason', noCompOff.status === 409 && /comp-off isn't set up/i.test(noCompOff.message), noCompOff);
  const devPay = await claim('dev', daysAgo(1), 'half_day', { kind: 'pay' });
  ok('…while overtime pay there is accepted', devPay.compensation?.kind === 'pay');

  const year = Number(daysAgo(2).slice(0, 4));
  const before = (await compOff('chitra', year)).total;
  const half = await claim('chitra', daysAgo(2), 'half_day', { kind: 'comp_off', days: 0.5 });
  ok('comp-off is stored on the request and shown to the manager', JSON.stringify(half.compensation) === JSON.stringify({ kind: 'comp_off', days: 0.5 }), half.compensation);
  const inbox = await getManagerOvertimeInbox('hr');
  ok('…in the manager\'s inbox too', JSON.stringify(inbox.find((r) => r.id === half.id)?.compensation) === JSON.stringify({ kind: 'comp_off', days: 0.5 }));
  ok('pending: nothing credited yet', (await compOff('chitra', year)).total === before);
  await decideOvertime('hr', half.id, { decision: 'approved' });
  ok('approved: +0.5 comp-off', (await compOff('chitra', year)).total === before + 0.5, { before, after: (await compOff('chitra', year)).total });
  const full = await claim('chitra', daysAgo(3), 'full_day', { kind: 'comp_off', days: 1 });
  await decideOvertime('hr', full.id, { decision: 'declined', managerNote: 'Not this time' });
  ok('declined: nothing credited', (await compOff('chitra', year)).total === before + 0.5);
  const paid = await claim('chitra', daysAgo(4), 'full_day', { kind: 'pay' });
  await decideOvertime('hr', paid.id, { decision: 'approved' });
  ok('overtime pay approved: no comp-off', (await compOff('chitra', year)).total === before + 0.5);
  const legacy = await claim('chitra', daysAgo(5), 'full_day');
  ok('an app from before the choice sends none: accepted, stored without one', legacy.compensation === null && !(await overtimeRequests().findOne({ workDate: new Date(`${daysAgo(5)}T00:00:00Z`), userId: 'chitra' }))?.compensation);
  await decideOvertime('hr', legacy.id, { decision: 'approved' });
  ok('…and approved, it credits its full day as before', (await compOff('chitra', year)).total === before + 1.5);

  console.log('the manager decides: the employee\'s choice is a preference');
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const paidInPayroll = async (id: string) =>
    Boolean(await overtimeRequests().findOne({ _id: new ObjectId(id), ...OVERTIME_PAID_IN_PAYROLL }));
  const stored = async (id: string) => (await overtimeRequests().findOne({ _id: new ObjectId(id) }))!;
  const credit = (await compOff('chitra', year)).total;

  const wantsDay = await claim('chitra', daysAgo(6), 'full_day', { kind: 'comp_off', days: 1 });
  const pendingView = (await getManagerOvertimeInbox('hr')).find((r) => r.id === wantsDay.id);
  ok('pending: the inbox shows the preference, and that comp-off can be chosen for her',
    same(pendingView?.preferredCompensation, { kind: 'comp_off', days: 1 }) && pendingView?.compOffAvailable === true, pendingView);
  const toPay = await decideOvertime('hr', wantsDay.id, { decision: 'approved', compensation: { kind: 'pay' } });
  ok('comp-off preferred, manager decides overtime pay: the request is paid…',
    same(toPay.compensation, { kind: 'pay' }) && same(toPay.preferredCompensation, { kind: 'comp_off', days: 1 }) && await paidInPayroll(wantsDay.id), toPay);
  ok('…and credits no comp-off', (await compOff('chitra', year)).total === credit, (await compOff('chitra', year)).total);
  ok('…stored: compensation is the decision, preferredCompensation her choice',
    same((await stored(wantsDay.id)).compensation, { kind: 'pay' }) && same((await stored(wantsDay.id)).preferredCompensation, { kind: 'comp_off', days: 1 }));
  const mineAfter = (await getMyOvertimeRequests('chitra')).find((r) => r.id === wantsDay.id);
  ok('…and she sees both: decided pay, preferred comp-off', same(mineAfter?.compensation, { kind: 'pay' }) && same(mineAfter?.preferredCompensation, { kind: 'comp_off', days: 1 }), mineAfter);

  const wantsPay = await claim('chitra', daysAgo(7), 'full_day', { kind: 'pay' });
  const toHalf = await decideOvertime('hr', wantsPay.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 0.5 } });
  ok('pay preferred, manager decides half a day of comp-off: +0.5, not paid',
    (await compOff('chitra', year)).total === credit + 0.5 && !(await paidInPayroll(wantsPay.id)) && same(toHalf.preferredCompensation, { kind: 'pay' }), toHalf);

  const asIs = await claim('farah', daysAgo(1), 'half_day', { kind: 'comp_off', days: 0.5 });
  const stands = await decideOvertime('hr', asIs.id, { decision: 'approved' });
  ok('no decision sent (an older manager app): the preference stands, +0.5',
    same(stands.compensation, { kind: 'comp_off', days: 0.5 }) && same(stands.preferredCompensation, { kind: 'comp_off', days: 0.5 }) && (await compOff('farah', year)).total === 0.5, stands);

  const halfClaim = await claim('farah', daysAgo(2), 'half_day', { kind: 'pay' });
  ok('an unknown decision is refused (400)', (await refusal(() => decideOvertime('hr', halfClaim.id, { decision: 'approved', compensation: { kind: 'cash' } }))).status === 400);
  ok('comp-off of 2 days is refused (400)', (await refusal(() => decideOvertime('hr', halfClaim.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 2 } }))).status === 400);
  ok('a full day off for a half-day claim is refused (400)', (await refusal(() => decideOvertime('hr', halfClaim.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 1 } }))).status === 400);
  ok('…and nothing was decided by the refusals', (await stored(halfClaim.id)).status === 'pending');
  const declined = await decideOvertime('hr', halfClaim.id, { decision: 'declined', managerNote: 'No', compensation: { kind: 'cash' } });
  ok('a decline ignores any decision sent, and keeps the preference', declined.status === 'declined' && same(declined.compensation, { kind: 'pay' }) && (await stored(halfClaim.id)).preferredCompensation === undefined, declined);

  const devClaim = await claim('dev', daysAgo(2), 'half_day', { kind: 'pay' });
  ok('the inbox says comp-off can\'t be chosen where HR has no Comp-off type',
    (await getManagerOvertimeInbox('hr')).find((r) => r.id === devClaim.id)?.compOffAvailable === false);
  const devRefused = await refusal(() => decideOvertime('hr', devClaim.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 0.5 } }));
  ok('deciding comp-off there is refused (409), with a reason', devRefused.status === 409 && /comp-off isn't set up/i.test(devRefused.message), devRefused);

  console.log('HR decides from the dashboard the same way');
  const hrList = await listAllOvertimeForAdmin('hr');
  ok('the dashboard list carries the preference and whether comp-off can be chosen',
    same(hrList.find((r) => r.id === devClaim.id)?.preferredCompensation, { kind: 'pay' }) && hrList.find((r) => r.id === devClaim.id)?.compOffAvailable === false);
  ok('HR deciding comp-off there is refused (409) too', (await refusal(() => adminDecideOvertime('hr', devClaim.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 0.5 } }))).status === 409);
  ok('HR\'s unknown decision is refused (400)', (await refusal(() => adminDecideOvertime('hr', devClaim.id, { decision: 'approved', compensation: 'pay' }))).status === 400);
  const hrDay = await claim('farah', daysAgo(3), 'full_day', { kind: 'pay' });
  const hrDecided = await adminDecideOvertime('hr', hrDay.id, { decision: 'approved', compensation: { kind: 'comp_off', days: 1 } });
  ok('HR decides a full day of comp-off over a pay preference: +1, not paid',
    hrDecided.decidedByRole === 'admin' && same(hrDecided.compensation, { kind: 'comp_off', days: 1 }) && same(hrDecided.preferredCompensation, { kind: 'pay' })
      && (await compOff('farah', year)).total === 1.5 && !(await paidInPayroll(hrDay.id)), hrDecided);

  const legacyDecided = await claim('farah', daysAgo(4), 'full_day');
  const legacyPay = await decideOvertime('hr', legacyDecided.id, { decision: 'approved', compensation: { kind: 'pay' } });
  ok('a request with no preference, decided as pay: paid, no credit, and no preference shown',
    legacyPay.preferredCompensation === null && same(legacyPay.compensation, { kind: 'pay' }) && await paidInPayroll(legacyDecided.id) && (await compOff('farah', year)).total === 1.5, legacyPay);

  console.log('what the employee is told');
  ok('approved as asked: "· +1 Comp-off"', compensationNote('Leave (Comp-off) · Full day') === ' · +1 Comp-off');
  ok('decided otherwise: says so', compensationNote('Overtime Pay', 'Leave (Comp-off) · Full day') === ' · paid as overtime (you preferred Leave (Comp-off) · Full day)', compensationNote('Overtime Pay', 'Leave (Comp-off) · Full day'));
  ok('the email gives the decision and the preference it differs from',
    /Decision: Overtime Pay\nYour preference was: Leave \(Comp-off\) · Full day/.test(overtimeApprovedEmail({ userId: 'chitra', name: 'Chitra' }, 'Full day', '1 Nov', 'Overtime Pay', 'Leave (Comp-off) · Full day').body));

  console.log('the comp-off is spent through Apply Leave');
  let ahead = new Date(Date.now() + 3 * 86_400_000);
  while ([0, 6].includes(ahead.getUTCDay())) ahead = new Date(ahead.getTime() + 86_400_000);
  const takeCompOff = (userId: string) => applyForLeave(userId, { type: 'comp_off', startDate: ymd(ahead), endDate: ymd(ahead), reason: 'Comp-off' });
  const taken = await takeCompOff('chitra');
  ok('someone with comp-off earned applies for a day of it', taken.status === 'pending' && taken.type === 'comp_off', taken);
  ok('…someone with none cannot', (await refusal(() => takeCompOff('bala'))).status !== undefined);

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  try { if (/_scratch$/.test(getDb().databaseName)) await getDb().dropDatabase(); } catch { /* not connected */ }
  process.exit(1);
});
