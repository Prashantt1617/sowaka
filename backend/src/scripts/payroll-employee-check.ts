/**
 * Scratch-database check of the app's Payroll screens: the home summary, the
 * missing punches of a month, the flexible split (limits, pool, the window
 * and the run's lock, the payroll run paying the split from its month on),
 * payslips (only released ones, only one's own), the home estimate on the
 * company's pay period (payroll_periods) and its "not set up" states, and the
 * 409s telling the person to ask HR. It drops and recreates
 * its own database, and refuses any other. Test data is the `sowaka` org with
 * invented people and amounts. Run with
 *   npm run payroll:employee-check
 */
import {
  attendanceRecords, companies, connectDb, flexibleSplits, getDb, payHeads, payrollPeriods, payrollRuns, payslips, salaryStructures, salaryTemplates,
  shiftPolicies, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { PayHead } from '../models/payHead.model';
import { createRun, myPayslip, myPayslips, submitRun } from '../services/payrollRun.service';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { mySalarySummary } from '../services/employeePayroll.salary';
import { mySplit, reviewSplit, saveSplit, splitWindow } from '../services/employeePayroll.split';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

/** Home with Payroll switched on (the seed turns it on for the org). */
async function homeOn(...args: Parameters<typeof myPayrollHome>) {
  const h = await myPayrollHome(...args);
  if (h.appEnabled !== true) throw new Error('Payroll is off for the scratch org');
  return h;
}

const SCRATCH = 'payroll_employee_scratch';
const ORG = 'sowaka';
const R = (rupees: number) => rupees * 100;

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (ok) passed += 1;
  else failed += 1;
}
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message };
  }
}

const head = (h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'calculation'>): PayHead => ({
  org: ORG, componentType: 'other', active: true, showInPayslip: true, recurrence: 'recurring', createdAt: new Date(), updatedAt: new Date(), ...h,
} as PayHead);

const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', employeeId: `E-${userId.toUpperCase()}`, managerUserId: 'hr', ...extra,
});

(async () => {
  if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
  await connectDb();
  const db = getDb();
  if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}: set MONGODB_DB=${SCRATCH}`);
  await db.dropDatabase();

  await companies().insertOne({ id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31' } } as never);
  await companies().insertOne({ id: 'otherco', name: 'Other (scratch)' } as never);
  // People punch in and out (the default policy marks everyone present).
  await shiftPolicies().insertOne({ org: ORG, correction: { punchFormat: 'Geotag (powered by Sowaka)' } } as never);
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('asha', 'Asha Test'),
    person('bala', 'Bala Test'),
    person('chetan', 'Chetan Test'),
  ] as never[]);
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, taxable: true }),
    head({ code: 'HRA', name: 'House Rent Allowance', category: 'earning', componentType: 'hra', calculation: { mode: 'percentage', percent: 40, base: 'basic' }, taxable: true }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, taxable: true }),
    head({ code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel & vehicle', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(3000) }),
    head({ code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1000) }),
    head({ code: 'TELEPHONE', name: 'Telephone Reimbursement', payslipName: 'Telephone', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1500) }),
    head({ code: 'BOOKS', name: 'Books Reimbursement', payslipName: 'Books & periodicals', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(500) }),
    // Fixed every month: not something to split.
    head({ code: 'MEAL', name: 'Meal Card', category: 'earning', calculation: { mode: 'flat_per_month', amountPaise: R(2200) }, fbp: true }),
  ]);
  const now = new Date();
  await salaryTemplates().insertMany([
    {
      org: ORG, name: 'Flexible', code: 'FLEX', active: true, createdAt: now, updatedAt: now,
      balancingComponentCode: 'FIXED_ALLOWANCE', flexiblePoolPaise: R(6000),
      components: ['BASIC', 'HRA', 'FIXED_ALLOWANCE', 'FUEL', 'INTERNET', 'TELEPHONE', 'BOOKS', 'MEAL'].map((code) => ({ payHeadCode: code, calculation: { mode: 'flat_amount' as const } }))
        .map((c) => c.payHeadCode === 'BASIC' ? { ...c, calculation: { mode: 'percentage' as const, percent: 50, base: 'ctc' as const } }
          : c.payHeadCode === 'HRA' ? { ...c, calculation: { mode: 'percentage' as const, percent: 40, base: 'basic' as const } }
            : c.payHeadCode === 'MEAL' ? { ...c, calculation: { mode: 'flat_per_month' as const, amountPaise: R(2200) } } : c),
    },
    { org: ORG, name: 'Plain', code: 'PLAIN', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
      components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } }] },
  ]);
  await salaryStructures().insertMany([
    { org: ORG, userId: 'asha', salaryTemplateCode: 'FLEX', annualCtcPaise: R(18_00_000), componentValues: { FUEL: R(2500), INTERNET: R(1000), TELEPHONE: R(1000), BOOKS: 0 }, status: 'active', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'bala', salaryTemplateCode: 'FLEX', annualCtcPaise: R(12_00_000), status: 'active', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'chetan', salaryTemplateCode: 'PLAIN', annualCtcPaise: R(9_00_000), status: 'active', createdAt: now, updatedAt: now },
  ]);
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));

  // —— the split ——
  const oct10 = new Date('2026-10-10T06:00:00Z');
  const oct31 = new Date('2026-10-31T06:00:00Z');
  const s0 = await mySplit('asha', oct31);
  check('flexible components: the four reimbursements, not the fixed meal card or the balancing component',
    s0.components.map((c) => c.code).join() === 'FUEL,INTERNET,TELEPHONE,BOOKS', s0.components.map((c) => c.code));
  check('limits come from the pay heads', s0.components.map((c) => c.limitPaise).join() === [R(3000), R(1000), R(1500), R(500)].join(), s0.components);
  check('before any split, the structure\'s own amounts', s0.components.map((c) => c.amountPaise).join() === [R(2500), R(1000), R(1000), 0].join() && s0.current === null, s0);
  check('pool ₹6,000 from the template, ₹4,500 assigned, ₹1,500 left', s0.poolPaise === R(6000) && s0.assignedPaise === R(4500) && s0.unassignedPaise === R(1500), s0);
  check('on 31 Oct (past the 15th) a change applies from November, until 15 Nov, to March',
    s0.window.effectiveFrom === '2026-11' && s0.window.closesOn === '2026-11-15' && s0.window.effectiveTo === '2027-03', s0.window);
  check('on 10 Oct it applies from October', (await splitWindow(ORG, oct10)).effectiveFrom === '2026-10');
  const plain = await mySplit('chetan', oct31);
  check('a template without flexible components: not available', plain.available === false && plain.components.length === 0, plain);
  const noSplit = await refusal(() => reviewSplit('chetan', { amounts: {} }, oct31));
  check('reviewing a split on such a template is refused (409), saying to ask HR', noSplit?.status === 409 && /ask HR\.$/.test(noSplit.message ?? ''), noSplit);

  const over = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(3500) } }, oct31));
  check('an amount above its limit is refused (400)', over?.status === 400 && /Fuel & vehicle can be at most ₹3,000/.test(over.message ?? ''), over);
  const pool = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500), INTERNET: R(1000) } }, oct31));
  check('a total within limits but above the pool is refused', pool === null, pool); // 3000+1000+1500+500 = 6000: exactly the pool
  const pool2 = await refusal(() => reviewSplit('bala', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500), INTERNET: R(1000) } }, oct31));
  check('(the pool is the template\'s, the same ₹6,000 for Bala: exactly full is fine)', pool2 === null, pool2);
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $set: { flexiblePoolPaise: R(5000) } });
  const pool3 = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500), INTERNET: R(1000) } }, oct31));
  check('above a ₹5,000 pool it is refused (400)', pool3?.status === 400 && /more than your ₹5,000/.test(pool3.message ?? ''), pool3);
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $set: { flexiblePoolPaise: R(6000) } });
  check('paise that are not whole rupees are refused', (await refusal(() => reviewSplit('asha', { amounts: { FUEL: 250050 } }, oct31)))?.status === 400);
  check('a negative amount is refused', (await refusal(() => reviewSplit('asha', { amounts: { FUEL: -100 } }, oct31)))?.status === 400);
  check('a code that is not flexible (the meal card) is refused', (await refusal(() => reviewSplit('asha', { amounts: { MEAL: R(100) } }, oct31)))?.status === 400);

  const review = await reviewSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500) } }, oct31);
  const fuel = review.lines.find((l) => l.code === 'FUEL')!;
  const books = review.lines.find((l) => l.code === 'BOOKS')!;
  check('review: Fuel +₹500, Books new, total ₹6,000 a month, nothing left',
    fuel.changePaise === R(500) && books.isNew && review.totalPaise === R(6000) && review.unassignedPaise === 0, review);
  check('review: a tax saving is estimated (new regime, ₹18 lakh CTC)', typeof review.monthlyTaxSavingPaise === 'number' && review.monthlyTaxSavingPaise > 0, review.monthlyTaxSavingPaise);
  check('review saves nothing', (await flexibleSplits().countDocuments({})) === 0);

  check('saving without the bills tick is refused', (await refusal(() => saveSplit('asha', { amounts: { FUEL: R(3000) } }, oct31)))?.status === 400);
  const stale = await refusal(() => saveSplit('asha', { amounts: { FUEL: R(3000) }, acknowledged: true, effectiveFrom: '2026-10' }, oct31));
  check('saving for a month whose window has closed is refused (409)', stale?.status === 409 && /November 2026/.test(stale.message ?? ''), stale);
  const saved = await saveSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500) }, acknowledged: true, effectiveFrom: '2026-11' }, oct31);
  check('saved from November', saved.current?.effectiveFrom === '2026-11' && saved.assignedPaise === R(6000), saved);
  const bView = await mySplit('bala', oct31);
  check('Bala still sees his own split, untouched by Asha\'s', bView.current === null && bView.components.find((c) => c.code === 'FUEL')?.amountPaise === R(3000), bView);

  // —— the run's lock moves the window ——
  await payrollRuns().insertOne({ org: ORG, period: '2026-11', runType: 'regular', status: 'paid', employeeCount: 0, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
  const nov5 = new Date('2026-11-05T06:00:00Z');
  const w = await splitWindow(ORG, nov5);
  check('once November\'s run is locked, a change on 5 Nov applies from December', w.effectiveFrom === '2026-12' && w.closesOn === '2026-12-15', w);
  await payrollRuns().updateOne({ period: '2026-11' }, { $set: { status: 'draft' } });
  check('a draft run does not lock its month', (await splitWindow(ORG, nov5)).effectiveFrom === '2026-11');
  await payrollRuns().deleteMany({});
  check('a March change after the 15th starts the next FY\'s split', (await splitWindow(ORG, new Date('2027-03-20T06:00:00Z'))).effectiveTo === '2028-03');

  // —— the payroll run pays the split from its month on ——
  const oct = await createRun('hr', { period: '2026-10' });
  const octSlip = await payslips().findOne({ runId: oct.run.id, userId: 'asha' });
  const line = (slip: typeof octSlip, code: string) => slip?.reimbursementLines?.find((l) => l.code === code)?.amountPaise ?? 0;
  check('October\'s run pays the structure\'s amounts (Fuel ₹2,500, Books none)', line(octSlip, 'FUEL') === R(2500) && line(octSlip, 'BOOKS') === 0, octSlip?.reimbursementLines);
  const nov = await createRun('hr', { period: '2026-11' });
  const novSlip = await payslips().findOne({ runId: nov.run.id, userId: 'asha' });
  check('November\'s run pays the split (Fuel ₹3,000, Telephone ₹1,500, Books ₹500)',
    line(novSlip, 'FUEL') === R(3000) && line(novSlip, 'TELEPHONE') === R(1500) && line(novSlip, 'BOOKS') === R(500), novSlip?.reimbursementLines);
  const fa = (slip: typeof octSlip) => slip?.earnings.find((e) => e.code === 'FIXED_ALLOWANCE')?.fullPaise ?? 0;
  check('the balancing Fixed Allowance gives up what the split adds (₹1,500 less)', fa(octSlip) - fa(novSlip) === R(1500), [fa(octSlip), fa(novSlip)]);

  // —— payslips: released only, own only ——
  check('a draft run\'s payslip is not shown to the employee', (await myPayslips('asha')).payslips.length === 0);
  await submitRun('hr', oct.run.id);
  const mine = await myPayslips('asha', 12);
  check('once submitted, Asha sees October', mine.payslips.length === 1 && mine.payslips[0].payslip.period === '2026-10', mine.payslips.map((p) => p.payslip.period));
  const one = await myPayslip('asha', mine.payslips[0].payslip.id!);
  check('one payslip by id, with its run and company', one.payslip.userId === 'asha' && one.run.status === 'paid' && one.company.org === ORG, one.run);
  check('Bala cannot open Asha\'s payslip (404)', (await refusal(() => myPayslip('bala', mine.payslips[0].payslip.id!)))?.status === 404);
  check('Bala\'s own list never holds Asha\'s', (await myPayslips('bala', 24)).payslips.every((p) => p.payslip.userId === 'bala'));
  const novId = (await payslips().findOne({ runId: nov.run.id, userId: 'asha' }))!._id.toHexString();
  check('a draft run\'s payslip cannot be opened by id', (await refusal(() => myPayslip('asha', novId)))?.status === 404);

  // —— missing punches ——
  await attendanceRecords().insertMany([
    { userId: 'asha', employeeId: 'E-ASHA', workDate: '2026-10-12', punchIn: new Date('2026-10-12T04:32:00Z'), createdAt: now, updatedAt: now },
    { userId: 'asha', employeeId: 'E-ASHA', workDate: '2026-10-13', punchIn: new Date('2026-10-13T03:30:00Z'), punchOut: new Date('2026-10-13T12:40:00Z'), createdAt: now, updatedAt: now },
  ] as never[]);
  const mp = await myMissingPunches('asha', '2026-10', oct31);
  const d12 = mp.days.find((d) => d.date === '2026-10-12');
  const d13 = mp.days.find((d) => d.date === '2026-10-13');
  check('missing punches: 12 Oct is a missing punch-out with the punch-in time', d12?.trigger === 'Missing punch-out' && d12.punchIn !== null && d12.punchOut === null, d12);
  check('a complete day is not listed', !d13, d13);
  check('days with no punches are listed as both missing', mp.days.some((d) => d.trigger === 'Both punches missing'), mp.days.slice(0, 3));
  check('the month is locked by the submitted October run: nothing left to fix, no fix-by date',
    mp.locked === true && mp.count === 0 && mp.fixBy === null && mp.days.every((d) => !d.canFix && d.closedReason !== null), mp);
  check('a future month is refused', (await refusal(() => myMissingPunches('asha', '2026-12', oct31)))?.status === 400);
  check('today is never listed (not final yet)', !(await myMissingPunches('asha', '2026-10', new Date('2026-10-14T06:00:00Z'))).days.some((d) => d.date >= '2026-10-14'));

  // —— home ——
  const home = await homeOn('asha', '2026-10', oct31);
  check('home: October is final from the released payslip', home.salary?.status === 'final' && home.salary.payslipId === one.payslip.id, home.salary);
  check('home: take-home = net + reimbursements', home.salary!.takeHomePaise === home.salary!.netPaise + home.salary!.reimbursementsPaise, home.salary);
  check('home: no missing-punches to-do for a locked month', !home.todo.some((t) => t.kind === 'missing_punches'), home.todo);
  check('home: the regime is not chosen yet: a to-do by 30 Nov', home.todo.some((t) => t.kind === 'tax_regime' && t.dueOn === '2026-11-30'), home.todo);
  check('home: Asha has split this FY, so no split to-do', !home.todo.some((t) => t.kind === 'flexible_split'), home.todo);
  const bHome = await homeOn('bala', undefined, new Date('2026-12-02T06:00:00Z'));
  check('home: December for Bala is an estimate', bHome.salary?.status === 'estimate' && bHome.salary.grossPaise > 0, bHome.salary);
  check('home: Bala has not split: a split to-do', bHome.todo.some((t) => t.kind === 'flexible_split'), bHome.todo);
  check('home: Bala\'s split summary is his own pool and amounts', bHome.split?.poolPaise === R(6000) && bHome.split.assignedPaise === R(6000), bHome.split);
  const cHome = await homeOn('chetan', '2026-10', oct31);
  check('home: no flexible components, no split section', cHome.split === null, cHome.split);
  await users().insertOne(person('dev', 'Dev New') as never);
  const dHome = await homeOn('dev', '2026-10', oct31);
  check('home: no salary structure yet: hasSalaryStructure false, salary null', dHome.hasSalaryStructure === false && dHome.salary === null, dHome);
  check('home: no salary structure: nothing to set up either', dHome.salaryNotSetUp === null, dHome.salaryNotSetUp);
  check('home: a company with no pay cycle is paid by the calendar month', bHome.payPeriod?.from === '2026-12-01' && bHome.payPeriod.to === '2026-12-31' && bHome.salary?.baseDays === 31, bHome.payPeriod);

  // —— home on the company's pay period (26th to 25th, November's base days set to 26) ——
  await payrollPeriods().insertMany([
    { org: ORG, period: 'default', startDay: 26, updatedAt: now },
    { org: ORG, period: '2026-11', baseDays: 26, updatedAt: now },
  ]);
  const oct28 = new Date('2026-10-28T06:00:00Z'); // 28 Oct: November's pay period (26 Oct – 25 Nov)
  const pHome = await homeOn('bala', undefined, oct28);
  const pSal = pHome.salary;
  check('pay period: on 28 Oct the estimate is November\'s', pHome.period === '2026-11' && pSal?.period === '2026-11' && pSal.status === 'estimate', [pHome.period, pSal?.period]);
  check('pay period: its dates and base days come from payroll_periods',
    pSal?.periodFrom === '2026-10-26' && pSal.periodTo === '2026-11-25' && pSal.baseDays === 26
      && pHome.payPeriod?.from === '2026-10-26' && pHome.payPeriod.baseDays === 26, [pSal, pHome.payPeriod]);
  check('pay period: 26 and 27 Oct without punches are loss of pay (not 1–27 Oct)', pSal?.lopDays === 2, pSal?.lopDays);
  check('pay period: loss of pay is gross ÷ 26 base days × days lost', pSal !== null && pSal !== undefined && pSal.lopPaise === Math.round((pSal.grossPaise * 2) / 26 / 100) * 100 && pSal.lopPaise > 0, pSal);
  check('pay period: missing punches stay on the calendar month', pHome.missingPunches.period === '2026-10', pHome.missingPunches);
  check('pay period: asking for November on 28 Oct is fine (it has started)', (await homeOn('bala', '2026-11', oct28)).salary?.period === '2026-11');
  check('pay period: December has not started', (await refusal(() => homeOn('bala', '2026-12', oct28)))?.status === 400);
  const oct25 = await homeOn('bala', undefined, new Date('2026-10-25T06:00:00Z'));
  check('pay period: on 25 Oct it is October\'s, final from the released payslip, on that run\'s own 31 base days',
    oct25.period === '2026-10' && oct25.salary?.status === 'final' && oct25.salary.baseDays === 31, oct25.salary);

  // —— the FY's statutory row is missing: the pay says not set up, the rest of home still shows ——
  const fyRow = await statutoryConfigs().findOne({ fy: '2026-27' });
  await statutoryConfigs().deleteOne({ fy: '2026-27' });
  const sh = await homeOn('bala', undefined, oct28).catch((error) => {
    check('no statutory row: home still answers', false, (error as Error).message);
    throw error;
  });
  check('no statutory row: home still answers', sh.appEnabled === true);
  check('no statutory row: no made-up salary, a not-set-up state that says to ask HR',
    sh.salary === null && sh.hasSalaryStructure === true && sh.salaryNotSetUp?.reason === 'statutory_not_set_up' && sh.salaryNotSetUp.fy === '2026-27'
      && /FY 2026-27/.test(sh.salaryNotSetUp.message) && /Ask HR\.$/.test(sh.salaryNotSetUp.message), sh.salaryNotSetUp);
  check('no statutory row: the to-dos and sections still show', sh.todo.some((t) => t.kind === 'flexible_split') && sh.split !== null && sh.proofs.fy === '2026-27', sh.todo);
  check('no statutory row: a released payslip still shows as final', (await homeOn('asha', '2026-10', oct31)).salary?.status === 'final');
  await statutoryConfigs().insertOne(fyRow!);

  // —— a pay cycle HR set up wrong: said, not guessed around ——
  await payrollPeriods().updateOne({ org: ORG, period: 'default' }, { $set: { startDay: 30 } });
  const bad = await homeOn('bala', undefined, new Date('2026-12-02T06:00:00Z')); // December: no payslip yet
  check('a broken pay cycle: no salary, pay_period_not_set_up, ask HR',
    bad.salary === null && bad.payPeriod === null && bad.salaryNotSetUp?.reason === 'pay_period_not_set_up' && /1 to 28/.test(bad.salaryNotSetUp.message) && /Ask HR\.$/.test(bad.salaryNotSetUp.message), bad.salaryNotSetUp);
  check('a broken pay cycle: the rest of home still shows', bad.todo.some((t) => t.kind === 'flexible_split'), bad.todo);
  await payrollPeriods().deleteMany({});

  // —— the salary summary (GET /payroll/me/salary): one pay period as a receipt, each line explained ——
  type Summary = Awaited<ReturnType<typeof mySalarySummary>>;
  // The lines make the take-home: earnings in, loss of pay and deductions out.
  const addsUp = (s: Summary) => s.takeHomePaise !== null
    && s.lines.reduce((t, l) => t + (l.kind === 'earning' ? l.amountPaise : -l.amountPaise), 0) === s.takeHomePaise;
  const lineOf = (s: Summary, key: string) => s.lines.find((l) => l.key === key);
  const nov11 = new Date('2026-11-11T06:00:00Z');
  const aSal = await mySalarySummary('asha', undefined, nov11);
  const aHome = await homeOn('asha', '2026-10', nov11);
  check('salary: on 11 Nov the default is the previous pay period, October, from its released payslip',
    aSal.period === '2026-10' && aSal.label === 'October 2026' && aSal.released === true && aSal.payslipId === one.payslip.id, [aSal.period, aSal.released]);
  check('salary: the same take-home and gross as Home shows for October', aSal.takeHomePaise === aHome.salary?.takeHomePaise && aSal.grossPaise === aHome.salary?.grossPaise, [aSal.takeHomePaise, aHome.salary]);
  check('salary: the lines add up to the take-home', addsUp(aSal), aSal.lines);
  check('salary: gross first, explained from the payslip\'s own components', aSal.lines[0]?.key === 'gross' && /before any deductions: Basic ₹75,000 \+/.test(aSal.lines[0].explanation), aSal.lines[0]);
  check('salary: days paid of the run\'s base days, on its own dates (the calendar month)',
    aSal.baseDays === 31 && aSal.daysInPeriod === 31 && aSal.periodFrom === '2026-10-01' && aSal.daysPaid === 31 - (aSal.lop?.days ?? 0), [aSal.daysPaid, aSal.baseDays, aSal.lop]);
  const aLop = lineOf(aSal, 'lop');
  check('salary: loss of pay explained from the days and one day\'s pay (gross ÷ 31 days in October)',
    aSal.lop !== null && (aSal.lop.days === 0 ? aLop === undefined
      : aLop?.kind === 'lop' && aLop.label.startsWith('Loss of pay · ')
        && aLop.explanation.includes(`One day's pay is ₹${Math.round(aSal.lop.perDayPaise! / 100).toLocaleString('en-IN')} (₹${Math.round(aSal.grossPaise! / 100).toLocaleString('en-IN')} ÷ 31 days in October)`)),
    [aLop, aSal.lop]);
  check('salary: released payslips for the Past payslips row (October only)', aSal.payslips.count === 1 && aSal.payslips.from === '2026-10' && aSal.payslips.to === '2026-10', aSal.payslips);
  check('salary: unpaid days open on October\'s list, locked by its run', aSal.unpaidDays.period === '2026-10' && aSal.unpaidDays.locked === true, aSal.unpaidDays);
  check('salary: no not-set-up state', aSal.notSetUp === null);

  // September, released with PF on Basic, the TDS engine on and 2 days of loss of pay HR typed for Asha.
  await payHeads().updateOne({ org: ORG, code: 'BASIC' }, { $set: { considerForEpf: { consider: true } } });
  await statutorySettings().insertOne({ org: ORG, tds: { enabled: true, defaultRegime: 'new' }, updatedAt: now } as never);
  // ₹36 lakh a year from September, so the year's tax is above the rebate.
  await salaryStructures().updateOne({ userId: 'asha' }, { $set: { annualCtcPaise: R(36_00_000) } });
  const sep = await createRun('hr', { period: '2026-09', lopDays: { asha: 2 } });
  await submitRun('hr', sep.run.id);
  const sSal = await mySalarySummary('asha', '2026-09', nov11);
  check('salary: September is its released payslip, and its lines add up', sSal.released === true && addsUp(sSal), sSal.lines);
  check('salary: 28 of 30 days paid (2 days of loss of pay HR set)', sSal.daysPaid === 28 && sSal.baseDays === 30 && sSal.lop?.days === 2 && sSal.lop.enteredByHr === true, [sSal.daysPaid, sSal.lop]);
  const sLop = lineOf(sSal, 'lop');
  check('salary: its loss of pay says HR set it, and one day\'s pay (gross ÷ 30 days in September)',
    sLop?.label === 'Loss of pay · 2 days' && sLop.explanation.startsWith('HR set 2 days of loss of pay for September.')
      && sLop.explanation.includes(`(₹${Math.round(sSal.grossPaise! / 100).toLocaleString('en-IN')} ÷ 30 days in September)`), sLop);
  const sPf = lineOf(sSal, 'epf');
  check('salary: PF says the FY\'s rate (12%) and the wage it was worked out on', sPf !== undefined && /^12% of your PF wage of ₹[\d,]+/.test(sPf.explanation) && /retirement/.test(sPf.explanation), sPf);
  const sTax = lineOf(sSal, 'income_tax');
  check('salary: income tax from the TDS engine: the year\'s tax, what was taken before, the months left',
    sTax !== undefined && /^Your income tax for FY 2026-27 under the new regime comes to ₹[\d,]+\. (₹[\d,]+ was taken before September, so the ₹[\d,]+ left|None of it was taken before September, so it) is split across the 7 months from September to March\.$/.test(sTax.explanation), sTax);
  check('salary: deductions in order: PF, then income tax', sSal.lines.filter((l) => l.kind === 'deduction').map((l) => l.key).join() .startsWith('epf,income_tax'), sSal.lines.map((l) => l.key));
  check('salary: two released payslips now, September to October', (await mySalarySummary('asha', undefined, nov11)).payslips.count === 2
    && (await mySalarySummary('asha', undefined, nov11)).payslips.from === '2026-09', null);

  // An estimate: December, for Bala in Karnataka (PT on), asked for on 5 January.
  await users().updateOne({ userId: 'bala' }, { $set: { state: 'Karnataka' } });
  const jan5 = new Date('2027-01-05T06:00:00Z');
  const bSal = await mySalarySummary('bala', undefined, jan5);
  const bHomeDec = await homeOn('bala', '2026-12', jan5);
  check('salary: on 5 Jan the default is December: an estimate (no run yet)', bSal.period === '2026-12' && bSal.released === false && bSal.payslipId === null, [bSal.period, bSal.released]);
  check('salary: the estimate is Home\'s own figure for December', bSal.takeHomePaise === bHomeDec.salary?.takeHomePaise && bSal.grossPaise === bHomeDec.salary?.grossPaise, [bSal.takeHomePaise, bHomeDec.salary?.takeHomePaise]);
  check('salary: the estimate\'s lines add up', addsUp(bSal), bSal.lines);
  check('salary: the estimate\'s loss of pay is the calendar\'s days, broken down',
    bSal.lop !== null && bSal.lop.days === bHomeDec.salary?.lopDays
      && bSal.lop.absentDays + bSal.lop.halfDays / 2 + bSal.lop.missedPunchDays + bSal.lop.unpaidLeaveDays === bSal.lop.days, bSal.lop);
  const bLop = lineOf(bSal, 'lop');
  check('salary: an estimate\'s loss of pay names the absent days', bSal.lop!.days === 0 || /^\d+ absent days?/.test(bLop?.explanation ?? ''), bLop);
  const bPt = lineOf(bSal, 'pt');
  check('salary: PT from Karnataka\'s slab in the FY\'s statutory row', bPt?.amountPaise === R(200) && bPt.explanation === 'A tax set by Karnataka: ₹200 a month for monthly pay of ₹25,000 or more.', bPt);
  check('salary: the estimate\'s days paid are base days less loss of pay', bSal.daysPaid === 31 - bSal.lop!.days && bSal.baseDays === 31, [bSal.daysPaid, bSal.lop?.days]);
  const bTax = lineOf(bSal, 'income_tax');
  check('salary: an estimate\'s income tax says which payslip it is taken from',
    bTax === undefined || /your October 2026 payslip took/.test(bTax.explanation), bTax);

  // On the company's pay dates (26th to 25th): on 28 Dec the previous period is December, 26 Nov – 25 Dec.
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now });
  const pSum = await mySalarySummary('bala', undefined, new Date('2026-12-28T06:00:00Z'));
  check('salary: with a 26th-to-25th cycle, on 28 Dec the previous pay period is December (26 Nov – 25 Dec)',
    pSum.period === '2026-12' && pSum.periodFrom === '2026-11-26' && pSum.periodTo === '2026-12-25' && pSum.baseDays === 30 && pSum.daysInPeriod === 30, [pSum.period, pSum.periodFrom, pSum.periodTo, pSum.baseDays]);
  check('salary: its loss of pay is divided by the 30 days from 26 Nov to 25 Dec',
    pSum.lop!.days === 0 || (lineOf(pSum, 'lop')?.explanation ?? '').includes('÷ 30 days from 26 Nov to 25 Dec)'), lineOf(pSum, 'lop'));
  check('salary: a month asked for is that month', (await mySalarySummary('asha', '2026-10', new Date('2026-12-28T06:00:00Z'))).period === '2026-10');
  // November's pay period on 28 Oct: 26 and 27 Oct without punches are 2 absent days.
  const lSum = await mySalarySummary('bala', '2026-11', oct28);
  const lLop = lineOf(lSum, 'lop');
  check('salary: an estimate\'s loss of pay: 2 absent days, one day\'s pay = gross ÷ 31 days from 26 Oct to 25 Nov',
    lSum.released === false && lSum.lop?.days === 2 && lSum.lop.absentDays === 2 && lSum.daysPaid === 29 && lLop?.label === 'Loss of pay · 2 days'
      && lLop.explanation === `2 absent days. One day's pay is ₹${Math.round(lSum.lop.perDayPaise! / 100).toLocaleString('en-IN')} (₹${Math.round(lSum.grossPaise! / 100).toLocaleString('en-IN')} ÷ 31 days from 26 Oct to 25 Nov).`,
    [lLop, lSum.lop]);
  check('salary: that estimate adds up', addsUp(lSum), lSum.lines);
  const lPf = lineOf(lSum, 'epf');
  check('salary: an estimate\'s PF: 12% of the ₹25,000 ceiling, the PF wage (Basic ₹50,000) above it',
    lPf?.amountPaise === R(3000) && lPf.explanation === '12% of your PF wage of ₹25,000 (your PF wage is ₹50,000; PF is worked out on the ₹25,000 ceiling), saved in your PF account for retirement.', lPf);
  await payrollPeriods().deleteMany({});

  check('salary: a month not started is refused (400)', (await refusal(() => mySalarySummary('bala', '2027-02', jan5)))?.status === 400);
  check('salary: a period not like 2026-10 is refused (400)', (await refusal(() => mySalarySummary('bala', 'October', jan5)))?.status === 400);
  const devSal = await mySalarySummary('dev', undefined, jan5);
  check('salary: no salary structure: no figures, says HR sets it up', devSal.notSetUp?.reason === 'no_salary_structure' && devSal.lines.length === 0 && devSal.takeHomePaise === null, devSal);

  // The FY's statutory row missing: an estimate is not made up; a released payslip still shows, its rules "not set up".
  const fyRow2 = await statutoryConfigs().findOne({ fy: '2026-27' });
  await statutoryConfigs().deleteOne({ fy: '2026-27' });
  const noFy = await mySalarySummary('bala', undefined, jan5);
  check('salary: no statutory row: the estimate says not set up, ask HR', noFy.notSetUp?.reason === 'statutory_not_set_up' && /Ask HR\.$/.test(noFy.notSetUp.message) && noFy.lines.length === 0, noFy.notSetUp);
  const noFyReleased = await mySalarySummary('asha', '2026-10', nov11);
  check('salary: no statutory row: October\'s released figures still show',
    noFyReleased.released && noFyReleased.takeHomePaise === aSal.takeHomePaise, noFyReleased.takeHomePaise);
  const noFySep = await mySalarySummary('asha', '2026-09', nov11);
  check('salary: no statutory row: September\'s PF line says its rate is not set up, ask HR',
    noFySep.released && /FY 2026-27 are not set up/.test(lineOf(noFySep, 'epf')?.explanation ?? '') && /Ask HR\.$/.test(lineOf(noFySep, 'epf')?.explanation ?? ''), lineOf(noFySep, 'epf'));
  await statutoryConfigs().insertOne(fyRow2!);
  console.log('  salary summary sample:', JSON.stringify({ ...lSum, lines: lSum.lines.map((l) => `${l.label} ${l.amountPaise / 100} — ${l.explanation}`) }, null, 1));
  console.log('  released sample:', JSON.stringify(sSal.lines.map((l) => `${l.label} ${l.amountPaise / 100} — ${l.explanation}`), null, 1));

  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} payroll employee checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
