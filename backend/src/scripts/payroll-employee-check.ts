import { ObjectId } from 'mongodb';
/**
 * Scratch-database check of the app's Payroll screens: the home summary, the
 * missing punches of a month, the flexible split (limits, pool, the − / +
 * step HR sets, the window and the run's lock, Review's deltas and tax saving,
 * no unchanged split, the bills acknowledgement kept with the split, the
 * payroll run paying the split from its month on),
 * payslips (only released ones, only one's own), the home estimate on the
 * company's pay period (payroll_periods) and its "not set up" states, and the
 * 409s telling the person to ask HR. It drops and recreates
 * its own database, and refuses any other. Test data is the `sowaka` org with
 * invented people and amounts. Run with
 *   npm run payroll:employee-check
 */
import {
  attendanceOverrides, attendanceRecords, companies, connectDb, flexibleSplits, getDb, payHeads, payrollPeriods, payrollRuns, payslips, salaryStructures, salaryTemplates,
  shiftPolicies, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { PayHead } from '../models/payHead.model';
import { createRun, myPayslip, myPayslips, recomputeRun, submitRun } from '../services/payrollRun.service';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { employeeAppSettingsForHr, setEmployeeAppSettingsForHr } from '../services/employeePayroll.settings';
import { myEarnings } from '../services/employeePayroll.earnings';
import { mySalarySummary } from '../services/employeePayroll.salary';
import { mySplit, reviewSplit, saveSplit, splitWindow } from '../services/employeePayroll.split';
import { epfBalanceForHr, myEpf, setEpfBalanceForHr, setMyEpfBalance } from '../services/employeePayroll.epf';
import { encryptField } from '../services/fieldCrypto';
import { randomBytes } from 'node:crypto';
import { employeePaymentDetails } from '../config/db';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

/** Home with Payroll switched on (the seed turns it on for the org). */
async function homeOn(...args: Parameters<typeof myPayrollHome>) {
  const h = await myPayrollHome(...args);
  if (h.appEnabled !== true) throw new Error('Payroll is off for the scratch org');
  return h;
}

// A suffixed name (payroll_employee_scratch_<who>) lets two checkouts run it at once.
const SCRATCH = /^payroll_employee_scratch(_[a-z0-9]+)?$/.test(env.mongoDbName) ? env.mongoDbName : 'payroll_employee_scratch';
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

  await companies().insertOne({ id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31', splitStepPaise: R(500), splitDue: '11-15', fbpBillsDueDay: 20 } } as never);
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
  check('GET split while open: editable, not locked, closes 15 Nov', s0.editable && s0.lockedReason === null && s0.closesOn === '2026-11-15', s0);

  // —— the − / + step is HR's (Payroll in the app), never one made up in code ——
  check('the step is the company\'s ₹500, on the split and on every head',
    s0.stepPaise === R(500) && s0.components.every((c) => c.stepPaise === R(500)) && !s0.notConfigured, [s0.stepPaise, s0.components.map((c) => c.stepPaise)]);
  await companies().updateOne({ id: ORG }, { $unset: { 'payrollEmployee.splitStepPaise': '' } });
  const noStep = await mySplit('asha', oct31);
  check('no step set: the split says not set up (splitStepPaise missing), no step made up',
    noStep.notConfigured && noStep.missing.join() === 'splitStepPaise' && noStep.stepPaise === null && noStep.components.every((c) => c.stepPaise === null), noStep);
  const rvNoStep = await reviewSplit('asha', { amounts: { FUEL: R(3000) } }, oct31).then(() => null, (e: { statusCode?: number; message?: string; details?: { missing?: string[] } }) => e);
  check('…and cannot be reviewed (409, naming splitStepPaise, saying to ask HR)',
    rvNoStep?.statusCode === 409 && rvNoStep.details?.missing?.join() === 'splitStepPaise' && /Ask HR\.$/.test(rvNoStep.message ?? ''), rvNoStep);
  const badStep = async (v: unknown) => (await refusal(() => setEmployeeAppSettingsForHr('hr', undefined, { splitStepPaise: v }, oct31)))?.status === 400;
  check('settings: a step of 0, 50 paise, ₹500.50, above ₹10,000 or not a number is refused (400)',
    (await badStep(0)) && (await badStep(50)) && (await badStep(50050)) && (await badStep(R(10_001))) && (await badStep('lots')));
  check('settings: the step reads as not set', (await employeeAppSettingsForHr('hr', undefined, oct31)).settings.splitStepPaise === null);
  const setStep = await setEmployeeAppSettingsForHr('hr', undefined, { splitStepPaise: R(500) }, oct31);
  check('settings: HR sets it to ₹500; it is not a deadline (Payroll stays on, nothing else missing)',
    setStep.settings.splitStepPaise === R(500) && setStep.settings.appEnabled && setStep.missing.length === 0, setStep);
  check('…and the split reads it', (await mySplit('asha', oct31)).stepPaise === R(500));

  // —— nothing changed is not a split ——
  const same = await refusal(() => reviewSplit('asha', { amounts: {} }, oct31));
  check('reviewing the split in force unchanged is refused (400)', same?.status === 400 && /Nothing has changed/.test(same.message ?? ''), same);
  const sameAgain = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2500), INTERNET: R(1000) } }, oct31));
  check('…also when the same amounts are sent back', sameAgain?.status === 400 && /Nothing has changed/.test(sameAgain.message ?? ''), sameAgain);
  const plain = await mySplit('chetan', oct31);
  check('a template without flexible components: not available', plain.available === false && plain.components.length === 0, plain);
  const noSplit = await refusal(() => reviewSplit('chetan', { amounts: {} }, oct31));
  check('reviewing a split on such a template is refused (409), saying to ask HR', noSplit?.status === 409 && /ask HR\.$/.test(noSplit.message ?? ''), noSplit);

  const over = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(3500) } }, oct31));
  check('an amount above its limit is refused (400)', over?.status === 400 && /Fuel & vehicle can be at most ₹3,000/.test(over.message ?? ''), over);
  const pool = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500), INTERNET: R(1000) } }, oct31));
  check('a total within limits but above the pool is refused', pool === null, pool); // 3000+1000+1500+500 = 6000: exactly the pool
  // Bala has no split yet and his structure pays every head its limit: the full ₹6,000 already, so only a change can be reviewed.
  const pool2 = await refusal(() => reviewSplit('bala', { amounts: { FUEL: R(2500) } }, oct31));
  check('(the pool is the template\'s, the same ₹6,000 for Bala: within it is fine)', pool2 === null, pool2);
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
  const lineOf = (code: string) => review.lines.find((l) => l.code === code)!;
  check('review: Internet unchanged (no delta, not new), Telephone +₹500, Books ₹0 → ₹500 is new, not a delta',
    lineOf('INTERNET').changePaise === 0 && !lineOf('INTERNET').isNew && lineOf('TELEPHONE').changePaise === R(500) && !lineOf('TELEPHONE').isNew
    && books.isNew && books.previousPaise === 0 && books.amountPaise === R(500), review.lines);
  check('review: Nov to Mar 2027, change again until 15 Nov, bills by 31 Mar 2027',
    review.effectiveFrom === '2026-11' && review.effectiveTo === '2027-03' && review.closesOn === '2026-11-15' && review.billsDueOn === '2027-03-31', review);
  check('review: the saving is in whole rupees', (review.monthlyTaxSavingPaise ?? 1) % 100 === 0, review.monthlyTaxSavingPaise);
  const smaller = await reviewSplit('asha', { amounts: { FUEL: R(3000) } }, oct31);
  check('review: a smaller split saves less tax', (smaller.monthlyTaxSavingPaise ?? 0) > 0 && smaller.monthlyTaxSavingPaise! < review.monthlyTaxSavingPaise!,
    [smaller.monthlyTaxSavingPaise, review.monthlyTaxSavingPaise]);
  await tdsConfigs().deleteMany({ fy: '2026-27' });
  const noRules = await reviewSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500) } }, oct31);
  check('review: no tax rules for the FY, no saving shown (null), the rest as before',
    noRules.monthlyTaxSavingPaise === null && noRules.totalPaise === R(6000), noRules.monthlyTaxSavingPaise);
  await tdsConfigs().insertMany(TDS_SEED.filter((c) => c.fy === '2026-27').map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  check('review saves nothing', (await flexibleSplits().countDocuments({})) === 0);

  check('saving without the bills tick is refused', (await refusal(() => saveSplit('asha', { amounts: { FUEL: R(3000) } }, oct31)))?.status === 400);
  const stale = await refusal(() => saveSplit('asha', { amounts: { FUEL: R(3000) }, acknowledged: true, effectiveFrom: '2026-10' }, oct31));
  check('saving for a month whose window has closed is refused (409)', stale?.status === 409 && /November 2026/.test(stale.message ?? ''), stale);
  const saved = await saveSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500) }, acknowledged: true, effectiveFrom: '2026-11' }, oct31);
  check('saved from November', saved.current?.effectiveFrom === '2026-11' && saved.assignedPaise === R(6000), saved);
  const row = await flexibleSplits().findOne({ org: ORG, userId: 'asha', effectiveFrom: '2026-11' });
  check('the bills acknowledgement is kept with the split (billsAcknowledgedAt, when it was ticked)',
    row?.acknowledged === true && row.billsAcknowledgedAt?.toISOString() === oct31.toISOString(), row);
  check('…and the split says when', saved.current?.billsAcknowledgedAt === oct31.toISOString(), saved.current);
  const resave = await refusal(() => saveSplit('asha', { amounts: { FUEL: R(3000), TELEPHONE: R(1500), BOOKS: R(500) }, acknowledged: true, effectiveFrom: '2026-11' }, oct31));
  check('submitting the same split again is refused (400, nothing changed)', resave?.status === 400 && /Nothing has changed/.test(resave.message ?? ''), resave);
  const bView = await mySplit('bala', oct31);
  check('Bala still sees his own split, untouched by Asha\'s', bView.current === null && bView.components.find((c) => c.code === 'FUEL')?.amountPaise === R(3000), bView);

  // —— the run's lock moves the window ——
  await payrollRuns().insertOne({ org: ORG, period: '2026-11', runType: 'regular', status: 'paid', employeeCount: 0, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
  const nov5 = new Date('2026-11-05T06:00:00Z');
  const w = await splitWindow(ORG, nov5);
  check('once November\'s run is locked, a change on 5 Nov applies from December, still till the FY\'s 15 Nov', w.effectiveFrom === '2026-12' && w.closesOn === '2026-11-15' && w.open, w);
  await payrollRuns().updateOne({ period: '2026-11' }, { $set: { status: 'draft' } });
  check('a draft run does not lock its month', (await splitWindow(ORG, nov5)).effectiveFrom === '2026-11');
  await payrollRuns().deleteMany({});
  check('a March change after the 15th starts the next FY\'s split (its own window, till 15 Nov 2027)',
    (await splitWindow(ORG, new Date('2027-03-20T06:00:00Z'))).effectiveTo === '2028-03' && (await splitWindow(ORG, new Date('2027-03-20T06:00:00Z'))).closesOn === '2027-11-15');

  // —— one window a FY: change and change again until 15 Nov, then locked for the FY ——
  const nov12 = new Date('2026-11-12T06:00:00Z');
  const again = await reviewSplit('asha', { amounts: { FUEL: R(2500) } }, nov12);
  check('12 Nov: Asha can change her November split again: "You can change this again until 15 Nov"', again.effectiveFrom === '2026-11' && again.closesOn === '2026-11-15', again);
  const nov16 = new Date('2026-11-16T06:00:00Z');
  const w16 = await splitWindow(ORG, nov16);
  check('16 Nov: the window is shut for the FY (locked_for_fy), no month to apply to, closed on 15 Nov',
    !w16.open && w16.reason === 'locked_for_fy' && w16.effectiveFrom === null && w16.closesOn === '2026-11-15', w16);
  check('…not reopened next month: 10 Dec, 10 Feb still locked',
    (await splitWindow(ORG, new Date('2026-12-10T06:00:00Z'))).reason === 'locked_for_fy' && (await splitWindow(ORG, new Date('2027-02-10T06:00:00Z'))).reason === 'locked_for_fy');
  const g16 = await mySplit('asha', nov16);
  check('…GET split: editable false, lockedReason locked_for_fy, the split in force still shown', !g16.editable && g16.lockedReason === 'locked_for_fy' && g16.current?.effectiveFrom === '2026-11' && !g16.notConfigured, g16);
  const locked = { status: 409, message: 'Your split is locked for this FY. To change it, raise a ticket.' };
  const rv16 = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2500) } }, nov16));
  check('…review: 409 "locked for this FY, raise a ticket"', rv16?.status === locked.status && rv16.message === locked.message, rv16);
  const sv16 = await refusal(() => saveSplit('asha', { amounts: { FUEL: R(2500) }, acknowledged: true }, nov16));
  check('…save: the same 409', sv16?.status === locked.status && sv16.message === locked.message, sv16);
  const bala16 = await refusal(() => saveSplit('bala', { amounts: { FUEL: R(2500) }, acknowledged: true }, nov16));
  check('…a first split (Bala has none this FY) is locked too', bala16?.status === 409 && bala16.message === locked.message, bala16);
  check('…nothing saved', (await flexibleSplits().countDocuments({ org: ORG })) === 1);

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
  check('home: Bala has not split, but on 2 Dec the window has closed for the FY: no split to-do, the split shown locked',
    !bHome.todo.some((t) => t.kind === 'flexible_split') && bHome.split?.open === false, bHome.todo);
  const bHomeOpen = await homeOn('bala', undefined, nov12);
  check('home: on 12 Nov Bala has a split to-do, by 15 Nov', bHomeOpen.todo.some((t) => t.kind === 'flexible_split' && t.dueOn === '2026-11-15'), bHomeOpen.todo);
  const bBills = bHomeOpen.todo.find((t) => t.kind === 'fbp_bills');
  check('home: Bala\'s FBP bills to-do: bills pending this FY, due by 20 Nov', typeof bBills?.pending === 'number' && (bBills.pending as number) > 0 && bBills.rejected === 0 && bBills.dueOn === '2026-11-20', bBills);
  check('home: Bala\'s split summary is his own pool and amounts', bHome.split?.poolPaise === R(6000) && bHome.split.assignedPaise === R(6000), bHome.split);
  const cHome = await homeOn('chetan', '2026-10', oct31);
  check('home: no flexible components, no split section', cHome.split === null, cHome.split);
  await users().insertOne(person('dev', 'Dev New') as never);
  const dHome = await homeOn('dev', '2026-10', oct31);
  check('home: no salary structure yet: hasSalaryStructure false, salary null', dHome.hasSalaryStructure === false && dHome.salary === null, dHome);
  check('home: no salary structure: nothing to set up either', dHome.salaryNotSetUp === null, dHome.salaryNotSetUp);
  check('home: a company with no pay cycle is paid by the calendar month', bHome.payPeriod?.from === '2026-12-01' && bHome.payPeriod.to === '2026-12-31' && bHome.salary?.baseDays === 31, bHome.payPeriod);

  // —— home's cards: last period's salary, this FY's tax, the flexible split ——
  const nov11 = new Date('2026-11-11T06:00:00Z');
  // Tax withheld: ₹7,600 on October's payslip, ₹5,000 on a paid September run; a draft August
  // run's and last FY's March payslips must not count.
  const withTds = (slip: NonNullable<typeof octSlip>, paise: number) => ({
    ...slip,
    deductions: [...slip.deductions.filter((d) => d.key !== 'income_tax'), { key: 'income_tax', name: 'Income Tax', amountPaise: paise }],
  });
  const octStored = (await payslips().findOne({ runId: oct.run.id, userId: 'asha' }))!;
  await payslips().replaceOne({ _id: octStored._id }, withTds(octStored, R(7600)));
  const cardRuns: string[] = [];
  for (const [period, status, tds] of [['2026-09', 'paid', 5000], ['2026-08', 'draft', 9999], ['2026-03', 'paid', 4321]] as const) {
    const { insertedId } = await payrollRuns().insertOne({ org: ORG, period, runType: 'regular', status, employeeCount: 1, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
    const { _id, ...rest } = withTds(octStored, R(tds));
    void _id;
    await payslips().insertOne({ ...rest, period, runId: insertedId.toHexString() } as never);
    cardRuns.push(insertedId.toHexString());
  }
  const aCards = (await homeOn('asha', undefined, nov11)).cards;
  const octAsha = (await payslips().findOne({ runId: oct.run.id, userId: 'asha' }))!;
  const sc = aCards.salary;
  const octFull = octAsha.earnings.reduce((t, e) => t + e.fullPaise, 0);
  const octLost = octFull - octAsha.earnings.reduce((t, e) => t + e.paidPaise, 0);
  const octTds = octAsha.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
  check('cards: on 11 Nov the salary card is October, from its released payslip',
    sc !== null && !sc.notConfigured && sc.period === '2026-10' && sc.label === 'October' && sc.released === true && sc.payslipId === one.payslip.id, sc);
  check('cards: the salary card\'s figures are the payslip\'s (gross, take-home, loss of pay, deductions)',
    sc !== null && !sc.notConfigured && sc.grossPaise === octFull && sc.takeHomePaise === octAsha.netPayablePaise && sc.lopPaise === octLost
      && sc.deductionsPaise === octAsha.deductions.filter((d) => !d.hidden && d.amountPaise > 0).reduce((t, d) => t + d.amountPaise, 0), [sc, octAsha.deductions]);
  check('cards: days paid = the run\'s 31 base days less the days lost',
    sc !== null && !sc.notConfigured && sc.daysInPeriod === 31 && sc.daysPaid === 31 - sc.lopDays, sc);
  const tc = aCards.tax;
  check('cards: tax is this FY\'s, on the declaration\'s regime (new, not chosen yet)',
    !tc.notConfigured && tc.fy === '2026-27' && tc.regime === 'new' && tc.regimeChosen === false && tc.fromMonth === '2026-04' && tc.toMonth === '2026-11', tc);
  check('cards: tax paid before November is September\'s and October\'s TDS; draft runs and last FY are not counted',
    !tc.notConfigured && octTds === R(7600) && tc.paidBeforeThisMonthPaise === R(5000) + R(7600) && tc.thisMonthReleased === false, [tc, octTds]);
  check('cards: November\'s tax is the estimate (last payslip\'s TDS), and paid so far adds it',
    !tc.notConfigured && tc.thisMonthPaise === R(7600) && tc.paidSoFarPaise === R(5000) + 2 * R(7600), tc);
  const fc = aCards.fbp;
  check('cards: the FBP card is the split head by head (₹6,000 pool, all assigned)',
    fc !== null && fc.poolPaise === R(6000) && fc.unassignedPaise === 0
      && fc.heads.map((h) => `${h.code}:${h.amountPaise}`).join() === `FUEL:${R(3000)},INTERNET:${R(1000)},TELEPHONE:${R(1500)},BOOKS:${R(500)}`, fc);
  const bCards = bHome.cards;
  check('cards: on 2 Dec Bala\'s November is an estimate (its run is still a draft), on 30 days',
    bCards.salary !== null && !bCards.salary.notConfigured && bCards.salary.period === '2026-11' && bCards.salary.released === false
      && bCards.salary.payslipId === null && bCards.salary.daysInPeriod === 30 && bCards.salary.daysPaid === 30 - bCards.salary.lopDays && bCards.salary.grossPaise > 0, bCards.salary);
  check('cards: the estimate adds up: take-home = gross − loss of pay − deductions + reimbursements',
    bCards.salary !== null && !bCards.salary.notConfigured
      && bCards.salary.takeHomePaise === bCards.salary.grossPaise - bCards.salary.lopPaise - bCards.salary.deductionsPaise + bCards.salary.reimbursementsPaise, bCards.salary);
  check('cards: unassigned FBP is the pool less the split', bCards.fbp !== null && bCards.fbp.unassignedPaise === R(6000) - bCards.fbp.assignedPaise, bCards.fbp);
  check('cards: no flexible heads, no FBP card', cHome.cards.fbp === null, cHome.cards.fbp);
  check('cards: no salary structure, no salary card', dHome.cards.salary === null, dHome.cards.salary);
  await users().insertOne(person('esha', 'Esha Joiner', { joiningDate: new Date('2026-11-05T00:00:00Z') }) as never);
  await salaryStructures().insertOne({ org: ORG, userId: 'esha', salaryTemplateCode: 'PLAIN', annualCtcPaise: R(6_00_000), status: 'active', createdAt: now, updatedAt: now } as never);
  check('cards: joined in November, no October salary card', (await homeOn('esha', undefined, nov11)).cards.salary === null);
  // The cards' extra runs (and October's TDS) go again, so later checks see the company as it was.
  await payslips().deleteMany({ runId: { $in: cardRuns } });
  await payrollRuns().deleteMany({ _id: { $in: cardRuns.map((id) => new ObjectId(id)) } });
  await payslips().replaceOne({ _id: octStored._id }, octStored);

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
  check('pay period: 26 and 27 Oct without punches are loss of pay (counted to yesterday; today is still going), not 1–28 Oct', pSal?.lopDays === 2, pSal?.lopDays);
  check('pay period: loss of pay is gross ÷ 26 base days × days lost', pSal !== null && pSal !== undefined && Math.abs(pSal.lopPaise - (pSal.grossPaise * 2) / 26) <= 100 && pSal.lopPaise > 0, pSal);
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
  const sCards = (await homeOn('bala', undefined, new Date('2026-12-02T06:00:00Z'))).cards;
  check('no statutory row: the salary card says not set up (November\'s estimate), with no figures',
    sCards.salary !== null && sCards.salary.notConfigured === true && sCards.salary.reason === 'statutory_not_set_up' && sCards.salary.label === 'November'
      && /Ask HR\.$/.test(sCards.salary.message) && !('grossPaise' in sCards.salary), sCards.salary);
  check('no statutory row: this month\'s tax is unknown, so paid so far runs to November only',
    !sCards.tax.notConfigured && sCards.tax.thisMonthPaise === null && sCards.tax.toMonth === '2026-11' && sCards.tax.paidSoFarPaise === sCards.tax.paidBeforeThisMonthPaise, sCards.tax);
  await statutoryConfigs().insertOne(fyRow!);

  // —— the FY's tax rules are missing: the tax card says so ——
  const tdsRows = await tdsConfigs().find({ fy: '2026-27' }).toArray();
  await tdsConfigs().deleteMany({ fy: '2026-27' });
  const tNone = (await homeOn('asha', undefined, nov11)).cards.tax;
  check('no tax rules: the tax card is not set up, saying to ask HR, with no figures',
    tNone.notConfigured === true && tNone.reason === 'tax_rules_not_set_up' && tNone.fy === '2026-27' && !('paidSoFarPaise' in tNone) && /Ask HR\.$/.test(tNone.message), tNone);
  if (tdsRows.length) await tdsConfigs().insertMany(tdsRows);

  // —— a pay cycle HR set up wrong: said, not guessed around ——
  await payrollPeriods().updateOne({ org: ORG, period: 'default' }, { $set: { startDay: 30 } });
  const bad = await homeOn('bala', undefined, new Date('2026-12-02T06:00:00Z')); // December: no payslip yet
  check('a broken pay cycle: no salary, pay_period_not_set_up, ask HR',
    bad.salary === null && bad.payPeriod === null && bad.salaryNotSetUp?.reason === 'pay_period_not_set_up' && /1 to 28/.test(bad.salaryNotSetUp.message) && /Ask HR\.$/.test(bad.salaryNotSetUp.message), bad.salaryNotSetUp);
  check('a broken pay cycle: the rest of home still shows (the FBP bills to-do; the split is locked by then)', bad.todo.some((t) => t.kind === 'fbp_bills') && bad.split !== null, bad.todo);
  await payrollPeriods().deleteMany({});

  {
  // —— the salary summary (GET /payroll/me/salary): one pay period as a receipt, each line explained ——
    // What this block changes is put back at its end, so the checks after it see the company as before.
    const saved = {
      basic: await payHeads().findOne({ org: ORG, code: 'BASIC' }),
      asha: await salaryStructures().findOne({ userId: 'asha' }),
      bala: await users().findOne({ userId: 'bala' }),
      runsBefore: (await payrollRuns().find({ org: ORG }, { projection: { _id: 1 } }).toArray()).map((r) => String(r._id)),
      settings: await statutorySettings().findOne({ org: ORG }),
    };
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
  // The switch's other side: this pay period's estimate, the run's own calculation for one person (Home's figure).
  const aCur = await mySalarySummary('asha', undefined, nov11, 'current');
  const aHomeNov = await homeOn('asha', '2026-11', nov11);
  check('salary: the default view is "previous", flipping between November and October', aSal.view === 'previous' && aSal.currentPeriod === '2026-11' && aSal.previousPeriod === '2026-10', [aSal.view, aSal.currentPeriod, aSal.previousPeriod]);
  check('salary: view=current on 11 Nov is November, an estimate', aCur.view === 'current' && aCur.period === '2026-11' && aCur.released === false && aCur.payslipId === null && aCur.notSetUp === null, [aCur.view, aCur.period, aCur.released, aCur.notSetUp]);
  check('salary: the current estimate is Home\'s own November figure', aCur.takeHomePaise === aHomeNov.salary?.takeHomePaise && aCur.grossPaise === aHomeNov.salary?.grossPaise && aCur.lop?.days === aHomeNov.salary?.lopDays, [aCur.takeHomePaise, aHomeNov.salary]);
  check('salary: the current estimate\'s lines add up', addsUp(aCur), aCur.lines);
  check('salary: the current view\'s unpaid days are November\'s', aCur.unpaidDays.period === '2026-11', aCur.unpaidDays);
  check('salary: a period asked for has no view', (await mySalarySummary('asha', '2026-10', nov11, 'current')).view === null);
  check('salary: a view not previous/current is refused (400)', (await refusal(() => mySalarySummary('asha', undefined, nov11, 'next')))?.status === 400);

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
  check('salary: an estimate\'s loss of pay says how many days', bSal.lop!.days === 0 || /^\d+ (absent )?days?/.test(bLop?.explanation ?? ''), bLop);
  const bPt = lineOf(bSal, 'pt');
  // As a run pays it: PT on the month's pay after loss of pay, so a month mostly lost may owe none.
  const bPaid = (bSal.grossPaise ?? 0) - (bLop?.amountPaise ?? 0);
  check('salary: PT from Karnataka\'s slab in the FY\'s statutory row', bPt === undefined ? bPaid < R(25_000) : bPt.amountPaise === R(200) && bPt.explanation === 'A tax set by Karnataka: ₹200 a month for monthly pay of ₹25,000 or more.', [bPt, bPaid]);
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
    await payHeads().replaceOne({ _id: saved.basic!._id }, saved.basic!);
    await salaryStructures().replaceOne({ _id: saved.asha!._id }, saved.asha!);
    await users().replaceOne({ _id: saved.bala!._id }, saved.bala!);
    const newRuns = (await payrollRuns().find({ org: ORG }, { projection: { _id: 1 } }).toArray()).map((r) => String(r._id)).filter((id) => !saved.runsBefore.includes(id));
    await payslips().deleteMany({ runId: { $in: newRuns } });
    await payrollRuns().deleteMany({ _id: { $in: newRuns.map((id) => new ObjectId(id)) } });
    if (saved.settings) await statutorySettings().replaceOne({ _id: saved.settings._id }, saved.settings);
    else await statutorySettings().deleteMany({ org: ORG });
  }

  // —— earnings: only months payroll has run for (released payslips), the yearly salary ——
  {
    const nov12 = new Date('2026-11-12T06:00:00Z');
    const e = await myEarnings('asha', undefined, nov12);
    const octE = e.months.find((m) => m.period === '2026-10');
    const novE = e.months.find((m) => m.period === '2026-11');
    const octRow = await payslips().findOne({ runId: oct.run.id, userId: 'asha' });
    check('earnings: FY 2026-27 by default, the only year with pay, and it is the current one',
      e.fy === '2026-27' && e.current === true && e.fys.join() === '2026-27', [e.fy, e.current, e.fys]);
    check('earnings: October from the released payslip (its gross, what reached the bank, its id)',
      octE?.status === 'released' && octE.grossPaise === octRow!.grossPaise && octE.netPaise === octRow!.netPayablePaise
        && octE.payslipId === octRow!._id.toHexString() && octE.label === 'October 2026', octE);
    check('earnings: November (its run still a draft, the pay period still going) is not listed — no estimate, no draft payslip',
      novE === undefined && e.estimateNotSetUp === null, [novE, e.estimateNotSetUp]);
    check('earnings: only the month payroll has run for, the span Oct', e.months.map((m) => m.period).join() === '2026-10' && e.span === 'Oct', [e.months, e.span]);
    check('earnings: the year\'s gross is the months\' gross', e.grossPaise === e.months.reduce((t, m) => t + m.grossPaise, 0), e.grossPaise);
    check('earnings: gross − tax − PF and PT − other deductions + reimbursements = take-home = the months\' net',
      e.grossPaise - e.taxPaise - e.pfPtPaise - e.otherDeductionsPaise + e.reimbursementsPaise === e.takeHomePaise
        && e.takeHomePaise === e.months.reduce((t, m) => t + m.netPaise, 0), e);
    const basic = e.components.find((c) => c.code === 'BASIC');
    check('earnings: the yearly salary is the structure (Basic 50% of ₹18 lakh, the split\'s Fuel ₹3,000 × 12)',
      e.componentsSource === 'structure' && basic?.annualPaise === R(9_00_000) && e.components.find((c) => c.code === 'FUEL')?.annualPaise === R(36_000)
        && e.componentsNotSetUp === null, e.components);
    check('earnings: "Total a year" is the components\' sum', e.annualTotalPaise === e.components.reduce((t, c) => t + c.annualPaise, 0) && e.annualTotalPaise > 0, e.annualTotalPaise);

    // An earlier year: a released March 2026 payslip with 3 unpaid days and a hidden deduction.
    const marRun = await payrollRuns().insertOne({ org: ORG, period: '2026-03', runType: 'regular', status: 'paid', employeeCount: 1, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
    const marSlip = {
      org: ORG, runId: marRun.insertedId.toHexString(), period: '2026-03', userId: 'asha', employeeName: 'Asha Test', annualCtcPaise: R(15_00_000), monthlyCtcPaise: R(1_25_000),
      earnings: [
        { code: 'BASIC', name: 'Basic', calcLabel: '', fullPaise: R(62_500), paidPaise: R(56_452) },
        { code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', calcLabel: '', fullPaise: R(50_000), paidPaise: R(45_161) },
      ],
      deductions: [
        { key: 'epf', name: 'EPF', amountPaise: R(1_800) },
        { key: 'pt', name: 'Professional Tax', amountPaise: R(200) },
        { key: 'income_tax', name: 'Income Tax', amountPaise: R(8_000) },
        { key: 'LOAN', name: 'Loan recovery', amountPaise: R(1_000), hidden: true },
      ],
      reimbursementLines: [{ code: 'FUEL', name: 'Fuel & vehicle', amountPaise: R(2_500) }],
      pfWagePaise: R(15_000), grossPaise: R(1_01_613), employeeDeductionsPaise: R(11_000), netPaise: R(90_613), reimbursementsPaise: R(2_500), netPayablePaise: R(93_113), employerCostPaise: 0,
      epf: { contributionWagePaise: R(15_000), employeePaise: R(1_800), employerEpsPaise: 0, employerEpfPaise: 0 },
      inputs: { workingDays: 31, lopDays: 3, payableDays: 28, approvedLeaveDays: 0, approvedOtHours: 0, overtimePaise: 0, reimbursementsPaise: 0, reimbursementClaimIds: [] },
      createdAt: now,
    };
    await payslips().insertOne({ ...marSlip } as never);
    // Neither another company's payslip nor a draft run's counts.
    const otherRun = await payrollRuns().insertOne({ org: 'otherco', period: '2026-02', runType: 'regular', status: 'paid', employeeCount: 1, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
    await payslips().insertOne({ ...marSlip, org: 'otherco', runId: otherRun.insertedId.toHexString(), period: '2026-02' } as never);
    const draftRun = await payrollRuns().insertOne({ org: ORG, period: '2026-01', runType: 'regular', status: 'draft', employeeCount: 1, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now });
    await payslips().insertOne({ ...marSlip, runId: draftRun.insertedId.toHexString(), period: '2026-01' } as never);

    const p = await myEarnings('asha', '2025-26', nov12);
    check('earnings: both years to switch between, newest first', p.fys.join() === '2026-27,2025-26', p.fys);
    check('earnings: FY 2025-26 has only the released March (not another company\'s, not a draft run\'s)',
      p.fy === '2025-26' && p.current === false && p.months.map((m) => m.period).join() === '2026-03' && p.span === 'Mar', p.months);
    check('earnings: March has its 3 unpaid days', p.months[0]?.unpaidDays === 3 && p.months[0].grossPaise === R(1_01_613) && p.months[0].netPaise === R(93_113), p.months[0]);
    check('earnings: March\'s tax, PF and PT, and the hidden loan as another deduction',
      p.taxPaise === R(8_000) && p.pfPtPaise === R(2_000) && p.otherDeductionsPaise === R(1_000) && p.reimbursementsPaise === R(2_500) && p.takeHomePaise === R(93_113), p);
    check('earnings: an earlier year\'s yearly salary is what its payslips were entitled to',
      p.componentsSource === 'payslips' && p.components.map((c) => `${c.code}:${c.annualPaise}`).join() === `BASIC:${R(62_500)},FIXED_ALLOWANCE:${R(50_000)},FUEL:${R(2_500)}`
        && p.annualTotalPaise === R(1_15_000) && p.estimateNotSetUp === null, p.components);
    check('earnings: a year not started is refused (400)', (await refusal(() => myEarnings('asha', '2027-28', nov12)))?.status === 400);
    check('earnings: a year written wrong is refused (400)', (await refusal(() => myEarnings('asha', '2026-28', nov12)))?.status === 400);
    const none = await myEarnings('asha', '2024-25', nov12);
    check('earnings: a year with no pay is empty, not made up', none.months.length === 0 && none.grossPaise === 0 && none.span === null && none.components.length === 0, none);

    const d = await myEarnings('dev', undefined, nov12);
    check('earnings: no structure and no pay: nothing listed, the salary says it is not set up',
      d.fys.length === 0 && d.months.length === 0 && d.componentsNotSetUp?.reason === 'no_salary_structure' && /Ask HR\.$/.test(d.componentsNotSetUp.message), d);

    const row = await statutoryConfigs().findOne({ fy: '2026-27' });
    await statutoryConfigs().deleteOne({ fy: '2026-27' });
    const s = await myEarnings('bala', undefined, nov12);
    check('earnings: no statutory row: only released months, and no made-up yearly salary',
      s.months.every((m) => m.status === 'released') && s.estimateNotSetUp === null
        && s.componentsNotSetUp?.reason === 'statutory_not_set_up' && s.components.length === 0 && /Ask HR\.$/.test(s.componentsNotSetUp.message), s);
    check('earnings: no statutory row: the released October still shows', s.months.some((m) => m.period === '2026-10'), s.months);
    await statutoryConfigs().insertOne(row!);
    await payslips().deleteMany({ period: { $in: ['2026-01', '2026-02', '2026-03'] } });
    await payrollRuns().deleteMany({ _id: { $in: [marRun.insertedId, otherRun.insertedId, draftRun.insertedId] } });
  }

  // —— EPF: PF through payroll, the passbook balance, this month's split, the own UAN ——
  // A throwaway key for this scratch run only (the UAN is encrypted at rest).
  process.env.PAYROLL_FIELD_KEY ||= randomBytes(32).toString('base64');
  await employeePaymentDetails().insertOne({ org: ORG, userId: 'asha', uan: encryptField('101234567890'), uanLast4: '7890', updatedAt: now, updatedByUserId: 'hr' });
  const before = await myEpf('asha', oct31);
  check('EPF: a salary none of whose pay heads count for PF: not deducted, nothing made up',
    !before.enrolled && before.notEnrolledReason === 'not_deducted' && before.monthly === null && before.savedThroughSowaka.months === 0, before);
  // Basic counts for PF from here; November's run is worked out again and released.
  await payHeads().updateOne({ org: ORG, code: 'BASIC' }, { $set: { considerForEpf: { consider: true, condition: 'always' } } });
  await recomputeRun('hr', nov.run.id, {});
  await submitRun('hr', nov.run.id);
  const nov30 = new Date('2026-11-30T06:00:00Z');
  const novPf = (await payslips().findOne({ runId: nov.run.id, userId: 'asha' }))!.epf;
  const epf = await myEpf('asha', nov30);
  check('EPF: Asha is enrolled, with her own UAN in full', epf.enrolled && epf.notEnrolledReason === null && epf.uan === '101234567890' && epf.uanLast4 === '7890', epf);
  check('EPF: saved through Sowaka is November\'s released payslip (employee + employer EPF); October paid no PF',
    epf.savedThroughSowaka.employeePaise === novPf.employeePaise && epf.savedThroughSowaka.employerEpfPaise === novPf.employerEpfPaise
      && epf.savedThroughSowaka.months === 1 && epf.savedThroughSowaka.sincePeriod === '2026-11' && epf.savedThroughSowaka.throughPeriod === '2026-11'
      && novPf.employeePaise > 0 && novPf.employerEpfPaise > 0, [epf.savedThroughSowaka, novPf]);
  const cfg = STATUTORY_SEED.find((c) => c.fy === '2026-27')!.epf;
  const ceiling = [...cfg.wageCeilings].reverse().find((c) => c.from <= '2026-11-30')!.ceilingPaise;
  const m = epf.monthly;
  const rupee = (p: number) => Math.round(p / 100) * 100;
  check('EPF: this month at the FY\'s rates: 12% of the PF wage from her, the employer\'s 12% split into EPS (8.33% to the ceiling) and EPF',
    m !== null && m.ratePercent === cfg.employeeRate * 100 && m.employerRatePercent === cfg.employerRate * 100 && m.pfWagePaise > 0
      && m.employeePaise === rupee(m.pfWagePaise * cfg.employeeRate)
      && m.employerEpsPaise === rupee(Math.min(m.pfWagePaise, ceiling) * cfg.epsRate)
      && m.employerEpsPaise + m.employerEpfPaise === rupee(m.pfWagePaise * cfg.employerRate) && m.period === '2026-11', [m, ceiling]);
  check('EPF: restricted PF: the wage is capped at the ₹25,000 ceiling (Basic is ₹75,000)', m?.pfWagePaise === ceiling, m);
  check('EPF: no balance typed in yet', epf.balance === null);
  const bEpf = await myEpf('bala', nov30);
  check('EPF: Bala sees no UAN (none recorded), never Asha\'s', bEpf.uan === null && bEpf.uanLast4 === null && bEpf.enrolled, bEpf);
  await salaryStructures().updateOne({ userId: 'chetan' }, { $set: { statutory: { epf: false } } });
  const cEpf = await myEpf('chetan', nov30);
  check('EPF: PF switched off for Chetan: not enrolled, no monthly split', !cEpf.enrolled && cEpf.notEnrolledReason === 'pf_off_for_you' && cEpf.monthly === null, cEpf);
  const dEpf = await myEpf('dev', nov30);
  check('EPF: no salary structure: not enrolled, nothing saved', !dEpf.enrolled && dEpf.notEnrolledReason === 'no_salary_structure' && dEpf.savedThroughSowaka.months === 0, dEpf);

  // —— Home: "Set up your payroll" (presence only, never a number) ——
  {
    const keys = (x: { items: { key: string }[] }) => x.items.map((i) => i.key).join();
    const item = (x: { items: { key: string; done: boolean }[] }, key: string) => x.items.find((i) => i.key === key);
    const aSetup = (await homeOn('asha', undefined, nov30)).setup;
    check('setup: Asha (PF on, UAN on record, no bank or PAN): bank and PAN to do, UAN done',
      item(aSetup, 'bank')?.done === false && item(aSetup, 'pan')?.done === false && item(aSetup, 'uan')?.done === true
        && aSetup.items.filter((i) => i.key === 'bank' || i.key === 'pan').every((i) => (i as { required: boolean }).required), aSetup);
    check('setup: counts add up', aSetup.total === aSetup.items.length && aSetup.done === aSetup.items.filter((i) => i.done).length, aSetup);
    check('setup: no identifier leaves the server, not even its last four', !/1012|7890|uanLast4|accountNumber/.test(JSON.stringify(aSetup)), aSetup);
    check('setup: a released payslip: not before the first payroll', aSetup.beforeFirstPayroll === false, aSetup);
    const cSetup = (await homeOn('chetan', undefined, nov30)).setup;
    check('setup: PF switched off for Chetan: no UAN row', !keys(cSetup).includes('uan'), cSetup);
    await employeePaymentDetails().insertOne({
      org: ORG, userId: 'bala', payMode: 'bank_transfer', accountNumber: encryptField('123456789012'), accountLast4: '9012',
      pan: encryptField('ABCDE1234F'), panLast4: '234F', updatedAt: now, updatedByUserId: 'hr',
    });
    const bSetup = (await homeOn('bala', undefined, nov30)).setup;
    check('setup: Bala with a bank account and PAN on record: both done', item(bSetup, 'bank')?.done === true && item(bSetup, 'pan')?.done === true, bSetup);
    await employeePaymentDetails().insertOne({ org: ORG, userId: 'dev', payMode: 'cash', updatedAt: now, updatedByUserId: 'hr' });
    const dSetup = (await homeOn('dev', undefined, nov30)).setup;
    check('setup: paid in cash: no bank row; no salary structure: no UAN or FBP row', !/bank|uan|fbp/.test(keys(dSetup)) && keys(dSetup).includes('pan'), dSetup);
    const regime = item(aSetup, 'regime') as { done: boolean; dueOn: string | null } | undefined;
    const aDecl = (await homeOn('asha', undefined, nov30)).declaration;
    check('setup: the regime row is the declaration\'s chosen flag and due date',
      regime === undefined ? aDecl.locked && !aDecl.chosen : regime.done === aDecl.chosen && regime.dueOn === aDecl.dueOn, [regime, aDecl]);
    await employeePaymentDetails().deleteMany({ userId: { $in: ['bala', 'dev'] } });
  }

  const withBal = await setMyEpfBalance('asha', { balancePaise: R(230000), asOn: '2026-09-30' }, nov30);
  const novTotal = novPf.employeePaise + novPf.employerEpfPaise;
  check('EPF balance: ₹2,30,000 as on 30 Sep plus the PF payroll put in after it (November)',
    withBal.balance?.balancePaise === R(230000) && withBal.balance.asOn === '2026-09-30' && withBal.balance.source === 'employee'
      && withBal.balance.addedSincePaise === novTotal && withBal.balance.totalPaise === R(230000) + novTotal, withBal.balance);
  const asOnNov = await setMyEpfBalance('asha', { balancePaise: R(240000), asOn: '2026-11-30' }, nov30);
  check('EPF balance: the newest entry wins; one as on 30 Nov adds nothing after it', asOnNov.balance?.balancePaise === R(240000) && asOnNov.balance.addedSincePaise === 0 && asOnNov.balance.totalPaise === R(240000), asOnNov.balance);
  check('EPF balance: a negative amount is refused (400)', (await refusal(() => setMyEpfBalance('asha', { balancePaise: -100, asOn: '2026-10-01' }, nov30)))?.status === 400);
  check('EPF balance: paise that are not whole rupees are refused', (await refusal(() => setMyEpfBalance('asha', { balancePaise: 12345, asOn: '2026-10-01' }, nov30)))?.status === 400);
  check('EPF balance: a date in the future is refused', (await refusal(() => setMyEpfBalance('asha', { balancePaise: R(100), asOn: '2026-12-01' }, nov30)))?.status === 400);
  check('EPF balance: a day that does not exist is refused', (await refusal(() => setMyEpfBalance('asha', { balancePaise: R(100), asOn: '2026-02-30' }, nov30)))?.status === 400);
  check('EPF balance: ₹0 is a balance', (await setMyEpfBalance('bala', { balancePaise: 0, asOn: '2026-10-01' }, nov30)).balance?.balancePaise === 0);
  const hrSet = await setEpfBalanceForHr('hr', 'bala', { balancePaise: R(150000), asOn: '2026-09-30' }, nov30);
  check('EPF balance: HR sets Bala\'s, and it is the one he sees', hrSet.balance?.source === 'hr' && (await myEpf('bala', nov30)).balance?.balancePaise === R(150000), hrSet);
  check('EPF balance: HR reads it back', (await epfBalanceForHr('hr', 'bala')).balance?.balancePaise === R(150000));
  check('EPF balance: someone without payroll access cannot set another\'s (403)', (await refusal(() => setEpfBalanceForHr('asha', 'bala', { balancePaise: R(1), asOn: '2026-09-30' }, nov30)))?.status === 403);
  check('EPF balance: Asha\'s own entries did not touch Bala\'s', (await myEpf('bala', nov30)).balance?.source === 'hr');

  const fyRow2 = await statutoryConfigs().findOne({ fy: '2026-27' });
  await statutoryConfigs().deleteOne({ fy: '2026-27' });
  const nEpf = await myEpf('asha', nov30);
  check('EPF: no statutory row: no made-up monthly split, a not-set-up line saying to ask HR; what payroll put in still shows',
    nEpf.enrolled && nEpf.monthly === null && nEpf.notSetUp?.reason === 'statutory_not_set_up' && /Ask HR\.$/.test(nEpf.notSetUp.message)
      && nEpf.savedThroughSowaka.employeePaise === novPf.employeePaise, nEpf);
  await statutoryConfigs().insertOne(fyRow2!);
  // —— the estimate is what the run pays: a meal card, absences, a missed punch and a half day ——
  // Gita (meal card ₹2,200 a month) in July: absent 6 and 7 Jul, only a punch-in on 8 Jul, HR
  // marked 9 Jul a half day, every other weekday punched in and out.
  await payHeads().insertOne(head({ code: 'MEAL_CARD', name: 'Meal Card', category: 'earning', componentType: 'meal_card', calculation: { mode: 'flat_per_month', amountPaise: R(2200) } }));
  await salaryTemplates().insertOne({
    org: ORG, name: 'With meal card', code: 'MEALT', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
    components: [
      { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } },
      { payHeadCode: 'MEAL_CARD', calculation: { mode: 'flat_per_month', amountPaise: R(2200) } },
      { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
    ],
  } as never);
  await users().insertOne(person('gita', 'Gita Meal', { joiningDate: new Date('2026-01-01T00:00:00Z') }) as never);
  await salaryStructures().insertOne({ org: ORG, userId: 'gita', salaryTemplateCode: 'MEALT', annualCtcPaise: R(9_60_000), status: 'active', createdAt: now, updatedAt: now } as never);
  const julyDays: unknown[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6 || d === 6 || d === 7) continue;
    julyDays.push({
      userId: 'gita', employeeId: 'E-GITA', workDate: date, createdAt: now, updatedAt: now,
      punchIn: new Date(`${date}T03:30:00Z`),
      ...(d === 8 ? {} : { punchOut: new Date(`${date}T12:40:00Z`) }),
    });
  }
  await attendanceRecords().insertMany(julyDays as never[]);
  await attendanceOverrides().insertOne({ org: ORG, userId: 'gita', workDate: '2026-07-09', status: 'half_day', setByUserId: 'hr', setAt: now } as never);
  // The home on 5 Aug: July is the last pay period, not run yet, so its card is the estimate.
  const gHome = await homeOn('gita', undefined, new Date('2026-08-05T06:00:00Z'));
  const julyRun = await createRun('hr', { period: '2026-07' });
  const gSlip = (await payslips().findOne({ runId: julyRun.run.id, userId: 'gita' }))!;
  const gCard = gHome.cards.salary;
  const gFull = gSlip.earnings.reduce((t, e) => t + e.fullPaise, 0);
  const gShown = gSlip.deductions.filter((d) => !d.hidden && d.amountPaise > 0);
  check('estimate = run: July\'s card is an estimate on the run\'s own loss of pay (absences, the missed punch, the half day)',
    gCard !== null && !gCard.notConfigured && gCard.released === false && gCard.lopDays === gSlip.inputs!.lopDays && gCard.lopDays >= 2.5,
    [gCard, gSlip.inputs?.lopDays, gSlip.inputs?.attendanceDeductions]);
  check('estimate = run: the same gross, loss of pay and take-home',
    gCard !== null && !gCard.notConfigured && gCard.grossPaise === gFull
      && gCard.lopPaise === gFull - gSlip.earnings.reduce((t, e) => t + e.paidPaise, 0) && gCard.takeHomePaise === gSlip.netPayablePaise,
    [gCard, { gross: gFull, net: gSlip.netPayablePaise }]);
  check('estimate = run: the same deduction lines, the meal card\'s food coupons among them',
    gCard !== null && !gCard.notConfigured && gShown.some((d) => d.key === 'food_coupon')
      && gCard.deductionsPaise === gShown.reduce((t, d) => t + d.amountPaise, 0), [gCard, gSlip.deductions]);
  const gJuly = (await homeOn('gita', '2026-07', new Date('2026-08-05T06:00:00Z'))).salary ?? null;
  check('estimate = run: the July salary on home (the screen the summary opens) lists the run\'s deductions',
    gJuly !== null && gJuly.status === 'estimate' && gJuly.deductions.map((d) => d.key).join() === gShown.map((d) => d.key).join()
      && gJuly.takeHomePaise === gSlip.netPayablePaise && gJuly.lopDays === gSlip.inputs!.lopDays, [gJuly?.deductions, gShown]);
  await payslips().deleteMany({ runId: julyRun.run.id });
  await payrollRuns().deleteOne({ period: '2026-07' });

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
