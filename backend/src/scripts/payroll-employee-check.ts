/**
 * Scratch-database check of the app's Payroll screens: the home summary, the
 * missing punches of a month, the flexible split (limits, pool, the window
 * and the run's lock, the payroll run paying the split from its month on),
 * and payslips (only released ones, only one's own). It drops and recreates
 * its own database, and refuses any other. Test data is the `sowaka` org with
 * invented people and amounts. Run with
 *   npm run payroll:employee-check
 */
import {
  attendanceRecords, companies, connectDb, flexibleSplits, getDb, payHeads, payrollRuns, payslips, salaryStructures, salaryTemplates,
  shiftPolicies, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { PayHead } from '../models/payHead.model';
import { createRun, myPayslip, myPayslips, submitRun } from '../services/payrollRun.service';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { mySplit, reviewSplit, saveSplit, splitWindow } from '../services/employeePayroll.split';
import { TDS_SEED } from '../shared/payroll/tds';

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

  await companies().insertOne({ id: ORG, name: 'Sowaka (scratch)' } as never);
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
  check('reviewing a split on such a template is refused (409)', (await refusal(() => reviewSplit('chetan', { amounts: {} }, oct31)))?.status === 409);

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
  check('the month is locked by the submitted October run, and the fix-by date is its last day', mp.locked === true && mp.fixBy === '2026-10-31', mp);
  check('a future month is refused', (await refusal(() => myMissingPunches('asha', '2026-12', oct31)))?.status === 400);
  check('today is never listed (not final yet)', !(await myMissingPunches('asha', '2026-10', new Date('2026-10-14T06:00:00Z'))).days.some((d) => d.date >= '2026-10-14'));

  // —— home ——
  const home = await myPayrollHome('asha', '2026-10', oct31);
  check('home: October is final from the released payslip', home.salary?.status === 'final' && home.salary.payslipId === one.payslip.id, home.salary);
  check('home: take-home = net + reimbursements', home.salary!.takeHomePaise === home.salary!.netPaise + home.salary!.reimbursementsPaise, home.salary);
  check('home: no missing-punches to-do for a locked month', !home.todo.some((t) => t.kind === 'missing_punches'), home.todo);
  check('home: the regime is not chosen yet: a to-do by 30 Nov', home.todo.some((t) => t.kind === 'tax_regime' && t.dueOn === '2026-11-30'), home.todo);
  check('home: Asha has split this FY, so no split to-do', !home.todo.some((t) => t.kind === 'flexible_split'), home.todo);
  const bHome = await myPayrollHome('bala', undefined, new Date('2026-12-02T06:00:00Z'));
  check('home: December for Bala is an estimate', bHome.salary?.status === 'estimate' && bHome.salary.grossPaise > 0, bHome.salary);
  check('home: Bala has not split: a split to-do', bHome.todo.some((t) => t.kind === 'flexible_split'), bHome.todo);
  check('home: Bala\'s split summary is his own pool and amounts', bHome.split?.poolPaise === R(6000) && bHome.split.assignedPaise === R(6000), bHome.split);
  const cHome = await myPayrollHome('chetan', '2026-10', oct31);
  check('home: no flexible components, no split section', cHome.split === null, cHome.split);
  await users().insertOne(person('dev', 'Dev New') as never);
  const dHome = await myPayrollHome('dev', '2026-10', oct31);
  check('home: no salary structure yet: hasSalaryStructure false, salary null', dHome.hasSalaryStructure === false && dHome.salary === null, dHome);

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
