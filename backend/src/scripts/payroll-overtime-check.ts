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
import {
  companies, connectDb, getDb, overtimeRequests, paidDaysTemplates, payHeads, payrollPeriods, payslips, salaryStructures,
  salaryTemplates, statutoryConfigs, tdsConfigs, users,
} from '../config/db';
import type { User } from '../models/user.model';
import type { OvertimeRequest } from '../models/overtime.model';
import { myPayrollHome } from '../services/employeePayroll.home';
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
const ot = (workDate: string, hours: number, status: OvertimeRequest['status']): OvertimeRequest => {
  const start = new Date(`${workDate}T13:30:00Z`);
  return {
    userId: 'asha', managerUserId: 'hr', workDate: new Date(`${workDate}T00:00:00Z`), startTime: start,
    endTime: new Date(start.getTime() + hours * 3_600_000), hours, duration: 'half_day', status,
    createdAt: new Date(), updatedAt: new Date(),
  };
};
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
  ]);
  // A 26th-to-25th cycle: September is 26 Aug – 25 Sep, 31 base days.
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now } as never);
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES[CODE], org: ORG });
  // Every day paid: what is checked here is overtime, not attendance.
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'All days', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now } as never);
  await salaryStructures().insertMany(['asha', 'bala'].map((userId) => ({
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
  ]);
  const HOURS = 5;
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

  const home = await myPayrollHome('asha', PERIOD, new Date('2026-10-02T06:00:00Z'));
  const salary = home.appEnabled ? home.salary : null;
  ok('Payroll home shows the released payslip', salary?.status === 'final', salary);
  ok('Payroll home: the overtime, as on the payslip', salary?.overtimePaise === byBasic, salary && { overtimePaise: salary.overtimePaise });
  ok('Payroll home: the loss of pay as on the payslip, not less by the overtime', salary?.lopDays === 2 && salary?.lopPaise === lopOnSlip, salary && { lopPaise: salary.lopPaise, onSlip: lopOnSlip });
  ok('Payroll home adds up: gross − loss of pay + overtime − deductions = net',
    salary !== null && salary !== undefined && salary.grossPaise - salary.lopPaise + salary.overtimePaise - asha.employeeDeductionsPaise === salary.netPaise,
    salary && { gross: salary.grossPaise, lop: salary.lopPaise, ot: salary.overtimePaise, deductions: asha.employeeDeductionsPaise, net: salary.netPaise });

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  try { if (/_scratch$/.test(getDb().databaseName)) await getDb().dropDatabase(); } catch { /* not connected */ }
  process.exit(1);
});
