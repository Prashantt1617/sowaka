/**
 * Split-month salary revisions, end to end on a scratch database: a CTC
 * revision applies from its effective date only (each day of a pay period on
 * the salary in force that day), a revision dated after the period leaves it
 * alone, and one dated in a period already submitted is paid once as arrears
 * on the next run. People without a revision must be paid exactly as before.
 *
 *   MONGODB_DB=salary_revisions_scratch NOTIFY_ORGS=nobody-scratch npm run salary-revisions:check
 *
 * Refuses any database whose name does not end in _scratch; drops and
 * recreates it. Invented people and companies only.
 *
 * The hand-worked figures below use one template, SIMPLE: Basic 50% of CTC,
 * HRA 50% of Basic, Special Allowance balancing to the monthly CTC. So
 *   ₹12,00,000 a year = ₹1,00,000 a month: Basic 50,000 · HRA 25,000 · Special 25,000
 *   ₹15,00,000 a year = ₹1,25,000 a month: Basic 62,500 · HRA 31,250 · Special 31,250
 *   ₹18,00,000 a year = ₹1,50,000 a month: Basic 75,000 · HRA 37,500 · Special 37,500
 * A part of a period with d days (of D, base B = D here) on monthly m pays m × (d − LOP) / B,
 * summed over the parts and rounded to the rupee once per component.
 */
import { ObjectId } from 'mongodb';
import {
  attendanceRecords, closeDb, connectDb, getDb, paidDaysTemplates, payHeads, payrollPeriods, payrollRuns, payslips,
  salaryStructures, salaryTemplates, statutoryConfigs, users,
} from '../config/db';
import type { User } from '../models/user.model';
import type { PayHead } from '../models/payHead.model';
import type { SalaryTemplate } from '../models/salaryTemplate.model';
import type { Payslip } from '../models/payrollRun.model';
import type { SalaryRevision, SalaryStructure } from '../models/salaryStructure.model';
import type { AttendanceRecord } from '../models/attendance.model';
import { createRun, recomputeRun, submitRun } from '../services/payrollRun.service';
import { upsertSalaryStructure } from '../services/salaryStructure.service';
import { createShift, setDefaultShift } from '../services/shift.service';
import { calculateSalaryStructure } from '../services/salary-calculator';
import { computePayslip } from '../services/payroll-run.calculator';
import { applyOverrides, resolveTemplateComponents } from '../services/salaryTemplate.service';
import { resolveRuleSet } from '../services/statutory.service';
import { statutorySettingsFor, workStateOf } from '../services/statutorySettings.service';
import { statutoryConfigForPeriod } from '../services/payrollConfig.service';
import { allocateLop, payRevisions, structureAsOf } from '../shared/payroll/salary-revisions';
import { STATUTORY_SEED } from './payroll-config-seed-data';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const R = (rupees: number) => Math.round(rupees * 100);
const L = (lakh: number) => R(lakh * 100_000);
const now = new Date();
const A = 'revcheck-cal';   // pays by the calendar month
const B = 'revcheck-cycle'; // pays 26th to 25th, October on 31 base days

const person = (org: string, userId: string, extra: Partial<User> = {}): User => ({
  userId, name: `Person ${userId}`, email: `${userId}@revcheck.test`, org, lifecycleStatus: 'active',
  role: 'employee', employeeId: userId.toUpperCase(), joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

const head = (org: string, h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'componentType' | 'calculation'>): PayHead => ({
  org, active: true, createdAt: now, updatedAt: now, taxable: true, showInPayslip: true, ...h,
});
const catalog = (org: string, withArrears: boolean): PayHead[] => [
  head(org, { code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, considerForEpf: { consider: true }, considerForEsi: { consider: true }, prorate: true }),
  head(org, { code: 'HRA', name: 'House Rent Allowance', category: 'earning', componentType: 'hra', calculation: { mode: 'percentage', percent: 50, base: 'basic' }, considerForEsi: { consider: true }, prorate: true }),
  head(org, { code: 'SPECIAL', name: 'Special Allowance', category: 'earning', componentType: 'special_allowance', calculation: { mode: 'flat_amount' }, considerForEsi: { consider: true }, prorate: true }),
  head(org, { code: 'BONUS_ONE_TIME', name: 'Bonus', category: 'earning', componentType: 'other', calculation: { mode: 'flat_amount' }, recurrence: 'one_time', prorate: false }),
  ...(withArrears ? [head(org, { code: 'SALARY_ARREARS', name: 'Salary Arrears', category: 'earning', componentType: 'other', calculation: { mode: 'flat_amount' }, recurrence: 'one_time', prorate: false, arrears: true })] : []),
];
const template = (org: string, code: string, basicPercent: number): SalaryTemplate => ({
  org, name: code, code, balancingComponentCode: 'SPECIAL', paidDaysEnabled: true, active: true, createdAt: now, updatedAt: now,
  components: [
    { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: basicPercent, base: 'ctc' } },
    { payHeadCode: 'HRA', calculation: { mode: 'percentage', percent: 50, base: 'basic' } },
    { payHeadCode: 'SPECIAL', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'BONUS_ONE_TIME', calculation: { mode: 'flat_amount' } },
  ],
});
const structure = (org: string, userId: string, ctc: number, extra: Partial<SalaryStructure> = {}): SalaryStructure => ({
  org, userId, salaryTemplateCode: 'SIMPLE', annualCtcPaise: ctc, status: 'active', paidDaysTemplateCode: 'ALLPAID',
  createdAt: now, updatedAt: now, ...extra,
});
/** A revision as the dashboard's Revise saves one on a live salary. */
const revision = (prev: number, next: number, effectiveFrom: string, at: Date, extra: Partial<SalaryRevision> = {}): SalaryRevision => ({
  id: new ObjectId().toHexString(), previousCtcPaise: prev, annualCtcPaise: next, effectiveFrom, at, whileActive: true, templateCode: 'SIMPLE', ...extra,
});
/** A revision saved before 25 Nov 2026 (no id, flag or snapshot), as the data has them. */
const oldRevision = (prev: number, next: number, effectiveFrom: string, at: Date): SalaryRevision => ({ previousCtcPaise: prev, annualCtcPaise: next, effectiveFrom, at });

const slipOf = async (org: string, period: string, userId: string) =>
  (await payslips().findOne({ org, period, userId })) as Payslip;
const line = (s: Payslip, code: string) => s.earnings.find((e) => e.code === code)?.paidPaise ?? 0;
const earned = (s: Payslip) => ({ basic: line(s, 'BASIC'), hra: line(s, 'HRA'), special: line(s, 'SPECIAL'), arrears: line(s, 'SALARY_ARREARS'), gross: s.grossPaise });
const same = (s: Payslip, want: { basic: number; hra: number; special: number; arrears?: number; gross: number }) => {
  const got = earned(s);
  return got.basic === want.basic && got.hra === want.hra && got.special === want.special && got.gross === want.gross && got.arrears === (want.arrears ?? 0);
};
const setStructure = (org: string, userId: string, patch: Partial<SalaryStructure>) => salaryStructures().updateOne({ org, userId }, { $set: patch });

/** The old run's arithmetic for one person with no revision: one salary, one factor (as before 25 Nov 2026). */
async function plainPayslip(org: string, period: string, s: SalaryStructure, employee: User, lopDays: number, workingDays: number, employedFrom?: string) {
  const config = await statutoryConfigForPeriod(period);
  const settings = await statutorySettingsFor(org);
  const ruleSet = await resolveRuleSet(org, workStateOf(employee), config);
  const tpl = (await salaryTemplates().findOne({ org, code: s.salaryTemplateCode }))!;
  const heads = await payHeads().find({ org }).toArray();
  const byCode = new Map(heads.map((h) => [h.code, h]));
  const base = calculateSalaryStructure({
    monthlyCtcPaise: Math.round(s.annualCtcPaise / 12), payHeads: resolveTemplateComponents(applyOverrides(tpl.components, s.overrides, byCode), byCode),
    componentValues: s.componentValues, balancingComponentCode: tpl.balancingComponentCode, ruleSet, config, month: Number(period.slice(5, 7)), period,
    bonusCategory: s.bonusCategory, statutory: s.statutory, settings, statutoryWages: tpl.statutoryWages, employedFrom,
  });
  return computePayslip(base, { workingDays, lopDays, overtimePaise: 0, reimbursementsPaise: 0, ruleSet, config, month: Number(period.slice(5, 7)), statutory: s.statutory, settings, esiCoveredEarlier: false, incomeTaxPaise: 0, period, employedFrom });
}

(async () => {
  await connectDb();
  const db = getDb();
  if (!db.databaseName.endsWith('_scratch')) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));

  console.log('pure: loss of pay placed in the parts');
  // 2 absent days dated in part 1 (19 days), 1 in part 2 (12 days): each where it falls.
  ok('dated days stay where they fall', JSON.stringify(allocateLop(3, [{ capacity: 19, notEmployed: 0, docked: 2 }, { capacity: 12, notEmployed: 0, docked: 1 }])) === '[2,1]');
  // One paid-leave day covers the FIRST day docked (part 1), not the later one.
  ok('the paid-leave allowance covers the first day docked', JSON.stringify(allocateLop(2, [{ capacity: 19, notEmployed: 0, docked: 2 }, { capacity: 12, notEmployed: 0, docked: 1 }], 1)) === '[1,1]');
  // HR typed 3 days (no dates): by days, in half days: 3 × 19/31 = 1.84 → 2, 3 × 12/31 = 1.16 → 1.
  ok('undated days (HR\'s figure) spread by days', JSON.stringify(allocateLop(3, [{ capacity: 19, notEmployed: 0 }, { capacity: 12, notEmployed: 0 }])) === '[2,1]');
  ok('days before joining in the part they fall in', JSON.stringify(allocateLop(9, [{ capacity: 19, notEmployed: 9 }, { capacity: 12, notEmployed: 0 }])) === '[9,0]');
  // Same-day revisions are one change, from what the first replaced.
  const sameDay = payRevisions({ annualCtcPaise: L(12), revisions: [oldRevision(0, R(100_000), '2026-11-05', new Date('2026-11-01T10:00:00Z')), oldRevision(R(100_000), L(12), '2026-11-05', new Date('2026-11-01T10:05:00Z'))] });
  ok('a first salary corrected the same day is no revision', sameDay.length === 0, sameDay);
  ok('a future revision is not in force yet', structureAsOf({ annualCtcPaise: L(15), revisions: [revision(L(12), L(15), '2026-12-01', now)] }, '2026-11-25').annualCtcPaise === L(12));

  // ———————————————————————————————————————— company A: calendar months
  console.log('company A (calendar months): setup, September submitted');
  const aPeople = ['hr', 'p0', 'mid', 'lop', 'first', 'last', 'two', 'future', 'joiner', 'back', 'tpl', 'move', 'st1', 'st2', 'st3'];
  await users().insertMany(aPeople.map((id) => person(A, id, {
    ...(id === 'hr' ? { dashboardAccess: true, dashboardAdmin: true } : {}),
    ...(id === 'joiner' ? { joiningDate: new Date('2026-10-10T00:00:00Z') } : {}),
    ...(id === 'st3' ? { joiningDate: new Date('2026-10-13T00:00:00Z') } : {}),
    ...(id.startsWith('st') ? { state: 'karnataka' } : {}),
  })));
  await payHeads().insertMany(catalog(A, false)); // no Arrears component yet
  await salaryTemplates().insertMany([template(A, 'SIMPLE', 50), template(A, 'SIMPLE60', 60)]);
  await paidDaysTemplates().insertMany([
    { org: A, code: 'DEFAULT', name: 'Calendar', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now },
    { org: A, code: 'ALLPAID', name: 'All days paid', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: false, createdAt: now, updatedAt: now },
  ]);
  // A shift, so 'lop' is graded by the calendar: present every working day of October but three.
  const shift = await createShift('hr', { name: 'General', punchFormat: 'In-app punch in', policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [] } } } as never);
  await setDefaultShift('hr', shift.id);
  const absent = ['2026-10-06', '2026-10-07', '2026-10-22']; // two before the revision on the 20th, one after
  const records: AttendanceRecord[] = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || absent.includes(date)) continue;
    records.push({ userId: 'lop', employeeId: 'LOP', workDate: date, punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:05:00+05:30`), source: 'manual', sourceKey: `manual|LOP|${date}`, importedAt: now, updatedAt: now } as AttendanceRecord);
  }
  await attendanceRecords().insertMany(records);

  // September: everyone on their salary of then, no revisions; submitted.
  await salaryStructures().insertMany([
    ...['p0', 'mid', 'lop', 'first', 'last', 'two', 'future', 'joiner', 'back', 'tpl', 'move'].map((id) => structure(A, id, L(12), id === 'lop' ? { paidDaysTemplateCode: 'DEFAULT' } : {})),
    structure(A, 'st1', R(240_000)),
    structure(A, 'st2', R(360_000)),
    structure(A, 'st3', R(240_000)),
  ]);
  const sep = await createRun('hr', { period: '2026-09' });
  await submitRun('hr', sep.run.id);
  const sepBack = await slipOf(A, '2026-09', 'back');
  ok('September paid "back" on ₹12,00,000 (Basic 50,000)', line(sepBack, 'BASIC') === R(50_000), earned(sepBack));

  // The revisions, as HR saves them after September went out.
  const later = new Date(Date.now() + 1000);
  const twelveToFifteen = (eff: string, extra: Partial<SalaryRevision> = {}) => ({ annualCtcPaise: L(15), revisions: [revision(L(12), L(15), eff, later, extra)] });
  await setStructure(A, 'mid', twelveToFifteen('2026-10-20'));
  await setStructure(A, 'lop', twelveToFifteen('2026-10-20'));
  await setStructure(A, 'first', twelveToFifteen('2026-10-01'));
  await setStructure(A, 'last', twelveToFifteen('2026-10-31'));
  await setStructure(A, 'two', { annualCtcPaise: L(18), revisions: [revision(L(12), L(15), '2026-10-11', later), revision(L(15), L(18), '2026-10-21', later)] });
  await setStructure(A, 'future', twelveToFifteen('2026-11-01'));
  await setStructure(A, 'joiner', twelveToFifteen('2026-10-20'));
  await setStructure(A, 'back', twelveToFifteen('2026-09-16'));
  // Revise with a template change (Basic 60%), through the service as the dashboard saves it.
  await upsertSalaryStructure('hr', 'tpl', { salaryTemplateCode: 'SIMPLE60', annualCtcPaise: L(15), overrides: {}, effectiveFrom: '2026-10-20', status: 'active' });
  // A template move with no CTC change: not dated, the whole next run on the new template.
  await upsertSalaryStructure('hr', 'move', { salaryTemplateCode: 'SIMPLE60', effectiveFrom: '2026-10-15', status: 'active' });
  const tplDoc = await salaryStructures().findOne({ org: A, userId: 'tpl' });
  const tplRev = tplDoc?.revisions?.[tplDoc.revisions.length - 1];
  ok('a revision keeps what it replaced', tplRev?.previous?.salaryTemplateCode === 'SIMPLE' && tplRev.whileActive === true && tplRev.templateCode === 'SIMPLE60' && !!tplRev.id, tplRev);
  ok('a template move alone is no revision', ((await salaryStructures().findOne({ org: A, userId: 'move' }))?.revisions ?? []).length === 0);

  console.log('company A: October (31 days), no Arrears component yet');
  const oct = await createRun('hr', { period: '2026-10' });
  const o = (id: string) => slipOf(A, '2026-10', id);

  // No revision: one part, ₹12,00,000: 50,000 + 25,000 + 25,000.
  const p0 = await o('p0');
  ok('no revision: paid as always', same(p0, { basic: R(50_000), hra: R(25_000), special: R(25_000), gross: R(100_000) }) && !p0.inputs.salarySegments && !p0.inputs.arrears, earned(p0));

  // Revised 20 Oct, full attendance: 1–19 Oct (19 days) on 12L, 20–31 Oct (12 days) on 15L.
  //   Basic   (50,000 × 19 + 62,500 × 12) / 31 = 1,700,000 / 31 = 54,838.71 → 54,839
  //   HRA     (25,000 × 19 + 31,250 × 12) / 31 =   850,000 / 31 = 27,419.35 → 27,419
  //   Special as HRA                                                         → 27,419
  //   Gross 1,09,677
  const mid = await o('mid');
  ok('mid-period revision: each part on its own salary', same(mid, { basic: R(54_839), hra: R(27_419), special: R(27_419), gross: R(109_677) }), earned(mid));
  ok('…the rate is the month at both salaries (nothing reads as loss of pay)', mid.earnings.every((e) => e.fullPaise === e.paidPaise) && mid.inputs.lopDays === 0, mid.earnings);
  ok('…the parts are on the payslip', JSON.stringify(mid.inputs.salarySegments?.map((s) => [s.from, s.to, s.days, s.annualCtcPaise])) === JSON.stringify([['2026-10-01', '2026-10-19', 19, L(12)], ['2026-10-20', '2026-10-31', 12, L(15)]]), mid.inputs.salarySegments);
  ok('…the payslip CTC is the one in force at the end', mid.annualCtcPaise === L(15));
  ok('…PF on the Basic paid (12% of the ₹25,000 ceiling)', mid.deductions.find((d) => d.key === 'epf')?.amountPaise === R(3_000), mid.deductions);

  // Same revision, absent 6 and 7 Oct (old part) and 22 Oct (new part): 17 paid days on 12L, 11 on 15L.
  //   Basic (50,000 × 17 + 62,500 × 11) / 31 = 1,537,500 / 31 = 49,596.77 → 49,597
  //   HRA   (25,000 × 17 + 31,250 × 11) / 31 =   768,750 / 31 = 24,798.39 → 24,798
  //   Gross 49,597 + 24,798 + 24,798 = 99,193
  // (One factor on the month would have given 54,839 × 28/31 = 49,532: a day lost at the wrong rate.)
  const lop = await o('lop');
  ok('loss of pay in each part costs that part\'s rate', same(lop, { basic: R(49_597), hra: R(24_798), special: R(24_798), gross: R(99_193) }) && lop.inputs.lopDays === 3, { ...earned(lop), lopDays: lop.inputs.lopDays });
  ok('…2 days in the old part, 1 in the new', JSON.stringify(lop.inputs.salarySegments?.map((s) => [s.lopDays, s.paidDays])) === '[[2,17],[1,11]]', lop.inputs.salarySegments);

  // Revised on the first day: the whole month on 15L, one part.
  const first = await o('first');
  ok('revision on the first day: the whole month on the new salary', same(first, { basic: R(62_500), hra: R(31_250), special: R(31_250), gross: R(125_000) }) && !first.inputs.salarySegments, earned(first));
  // Revised on the last day: 30 days on 12L, 1 on 15L.
  //   Basic (50,000 × 30 + 62,500) / 31 = 1,562,500 / 31 = 50,403.23 → 50,403
  //   HRA   (25,000 × 30 + 31,250) / 31 =   781,250 / 31 = 25,201.61 → 25,202
  const last = await o('last');
  ok('revision on the last day: one day on the new salary', same(last, { basic: R(50_403), hra: R(25_202), special: R(25_202), gross: R(100_807) }), earned(last));

  // Two revisions: 1–10 Oct on 12L, 11–20 on 15L, 21–31 (11 days) on 18L.
  //   Basic (50,000 × 10 + 62,500 × 10 + 75,000 × 11) / 31 = 1,950,000 / 31 = 62,903.23 → 62,903
  //   HRA   (25,000 × 10 + 31,250 × 10 + 37,500 × 11) / 31 =   975,000 / 31 = 31,451.61 → 31,452
  const two = await o('two');
  ok('two revisions in one month: three parts', same(two, { basic: R(62_903), hra: R(31_452), special: R(31_452), gross: R(125_807) }) && two.inputs.salarySegments?.length === 3, earned(two));

  // Dated 1 Nov (saved now): October all on 12L, the payslip's CTC 12L.
  const future = await o('future');
  ok('a revision dated later does not touch this month', same(future, { basic: R(50_000), hra: R(25_000), special: R(25_000), gross: R(100_000) }) && future.annualCtcPaise === L(12) && !future.inputs.salarySegments, earned(future));

  // Joined 10 Oct (9 days not employed, in the old part), revised 20 Oct: 10 paid days on 12L, 12 on 15L.
  //   Basic (50,000 × 10 + 62,500 × 12) / 31 = 1,250,000 / 31 = 40,322.58 → 40,323
  //   HRA   (25,000 × 10 + 31,250 × 12) / 31 =   625,000 / 31 = 20,161.29 → 20,161
  const joiner = await o('joiner');
  ok('joiner with a revision: days before joining in the old part', same(joiner, { basic: R(40_323), hra: R(20_161), special: R(20_161), gross: R(80_645) }) && joiner.inputs.notEmployedDays === 9, { ...earned(joiner), inputs: joiner.inputs.salarySegments });

  // Revised with a template change on 20 Oct: 1–19 on SIMPLE at 12L (50,000 / 25,000 / 25,000),
  // 20–31 on SIMPLE60 at 15L (Basic 75,000 · HRA 37,500 · Special 12,500).
  //   Basic   (50,000 × 19 + 75,000 × 12) / 31 = 1,850,000 / 31 = 59,677.42 → 59,677
  //   HRA     (25,000 × 19 + 37,500 × 12) / 31 =   925,000 / 31 = 29,838.71 → 29,839
  //   Special (25,000 × 19 + 12,500 × 12) / 31 =   625,000 / 31 = 20,161.29 → 20,161
  const tpl = await o('tpl');
  ok('revision with a template change: the old days on the old template', same(tpl, { basic: R(59_677), hra: R(29_839), special: R(20_161), gross: R(109_677) }), earned(tpl));
  // Moved to SIMPLE60 with no CTC change: the whole of October on it (75% … 60,000 / 30,000 / 10,000).
  const move = await o('move');
  ok('a template move is not split: the whole run on the new template', same(move, { basic: R(60_000), hra: R(30_000), special: R(10_000), gross: R(100_000) }) && !move.inputs.salarySegments, earned(move));

  // Back-dated into submitted September (16 Sep, saved after it went out): October on 15L, plus arrears.
  // No component is flagged Arrears yet: worked out, shown, not paid.
  //   September 16–30 = 15 of 30 days, no loss of pay: share 15/30
  //   Basic (62,500 − 50,000) × 15/30 = 6,250 · HRA (31,250 − 25,000) × 15/30 = 3,125 · Special 3,125 = 12,500
  let back = await o('back');
  ok('arrears with no Arrears component: worked out, not paid', back.inputs.arrears?.status === 'not_set_up' && back.inputs.arrears.workedOutPaise === R(12_500) && same(back, { basic: R(62_500), hra: R(31_250), special: R(31_250), gross: R(125_000) }), back.inputs.arrears);
  ok('…by component, for 16–30 Sep', JSON.stringify(back.inputs.arrears?.items.map((i) => [i.period, i.from, i.to, i.days, i.lines.map((l) => [l.code, l.amountPaise])])) === JSON.stringify([['2026-09', '2026-09-16', '2026-09-30', 15, [['BASIC', R(6_250)], ['HRA', R(3_125)], ['SPECIAL', R(3_125)]]]]), back.inputs.arrears?.items);

  // The company flags an Arrears component; recalculating pays it, once.
  await payHeads().insertOne(catalog(A, true).find((h) => h.code === 'SALARY_ARREARS')!);
  await recomputeRun('hr', oct.run.id, { lopDays: { st2: 2 } });
  back = await o('back');
  ok('recalculated with an Arrears component: paid on its own line', back.inputs.arrears?.status === 'paid' && same(back, { basic: R(62_500), hra: R(31_250), special: R(31_250), arrears: R(12_500), gross: R(137_500) }), { ...earned(back), a: back.inputs.arrears?.status });
  await recomputeRun('hr', oct.run.id, {});
  back = await o('back');
  ok('recalculating again: still once', earned(back).arrears === R(12_500) && back.grossPaise === R(137_500), earned(back));
  // HR overrides it on the draft, then puts the worked-out figure back.
  await recomputeRun('hr', oct.run.id, { componentAmounts: { back: { SALARY_ARREARS: R(5_000) } } });
  back = await o('back');
  ok('HR can override it', earned(back).arrears === R(5_000) && back.inputs.arrears?.status === 'entered_by_hr' && back.inputs.arrears.workedOutPaise === R(12_500), back.inputs.arrears);
  await recomputeRun('hr', oct.run.id, { componentAmounts: { back: { SALARY_ARREARS: 0 } } });
  back = await o('back');
  ok('…or not pay it (0)', earned(back).arrears === 0 && back.inputs.arrears?.paidPaise === 0, back.inputs.arrears);
  await recomputeRun('hr', oct.run.id, { componentAmounts: { back: { SALARY_ARREARS: null } } });
  back = await o('back');
  ok('…and clear that to the worked-out figure', earned(back).arrears === R(12_500) && back.inputs.arrears?.status === 'paid', back.inputs.arrears);

  // People with no revision are untouched: the same payslip as the one-salary arithmetic, to the paisa.
  for (const id of ['p0', 'st1', 'st2', 'st3']) {
    const s = await o(id);
    const doc = (await salaryStructures().findOne({ org: A, userId: id }))!;
    const emp = (await users().findOne({ userId: id }))!;
    const joined = emp.joiningDate && emp.joiningDate.toISOString().slice(0, 10) > '2026-10-01' ? emp.joiningDate.toISOString().slice(0, 10) : undefined;
    const want = await plainPayslip(A, '2026-10', doc, emp, s.inputs.lopDays, 31, joined);
    const pf = (x: { deductions: { key: string; amountPaise: number }[] }, k: string) => x.deductions.find((d) => d.key === k)?.amountPaise ?? 0;
    ok(`${id}: PF ${pf(s, 'epf') / 100}, ESI ${pf(s, 'esi') / 100}, PT ${pf(s, 'pt') / 100} as before; every line to the paisa`,
      JSON.stringify(s.earnings) === JSON.stringify(want.earnings) && JSON.stringify(s.deductions) === JSON.stringify(want.deductions)
      && s.grossPaise === want.grossPaise && s.netPaise === want.netPaise && s.employerCostPaise === want.employerCostPaise && JSON.stringify(s.employer) === JSON.stringify(want.employer) && !s.inputs.salarySegments && !s.inputs.arrears,
      { got: [s.earnings, s.deductions], want: [want.earnings, want.deductions] });
  }
  const st1 = await o('st1');
  ok('st1 (₹20,000 a month): ESI is on the slip', st1.deductions.some((d) => d.key === 'esi'), st1.deductions);
  const st2 = await o('st2');
  ok('st2 (₹30,000 a month, Karnataka): PT is on the slip', st2.deductions.some((d) => d.key === 'pt'), st2.deductions);
  ok('st2: HR typed 2 days of loss of pay', (await o('st2')).inputs.lopDays === 2);

  await submitRun('hr', oct.run.id);
  console.log('company A: November (the month after the arrears)');
  const nov = await createRun('hr', { period: '2026-11' });
  const backNov = await slipOf(A, '2026-11', 'back');
  ok('the next month does not pay the arrears again', earned(backNov).arrears === 0 && !backNov.inputs.arrears && backNov.grossPaise === R(125_000), { ...earned(backNov), a: backNov.inputs.arrears });
  const futureNov = await slipOf(A, '2026-11', 'future');
  ok('the 1 Nov revision is in force from November', line(futureNov, 'BASIC') === R(62_500) && futureNov.annualCtcPaise === L(15), earned(futureNov));
  await recomputeRun('hr', nov.run.id, {});
  ok('…recalculating November: still no arrears', earned(await slipOf(A, '2026-11', 'back')).arrears === 0);

  // ———————————————————————————————————————— company B: 26th to 25th, real shapes
  console.log('company B (26th–25th; October 26 Sep–25 Oct on 31 base days, submitted; November 26 Oct–25 Nov)');
  const bPeople = ['hrb', 'b0', 'corr', 'corrOct', 'beforeSubmit', 'today1oct', 'today7sep', 'in18', 'in1', 'dec', 'cut'];
  await users().insertMany(bPeople.map((id) => person(B, id, id === 'hrb' ? { dashboardAccess: true, dashboardAdmin: true } : {})));
  await payHeads().insertMany(catalog(B, true));
  await salaryTemplates().insertOne(template(B, 'SIMPLE', 50));
  await paidDaysTemplates().insertOne({ org: B, code: 'ALLPAID', name: 'All days paid', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now });
  await payrollPeriods().insertMany([
    { org: B, period: 'default', startDay: 26, updatedAt: now },
    { org: B, period: '2026-10', baseDays: 31, updatedAt: now },
  ] as never);
  // October's run as the old code made it: one salary for the whole period, whatever the stored CTC was.
  await salaryStructures().insertMany([
    structure(B, 'b0', L(12)),
    structure(B, 'corr', L(12)),
    structure(B, 'corrOct', L(12)),
    structure(B, 'beforeSubmit', L(15)), // revised 1 Oct on 31 Oct: October went out on the new CTC already
    structure(B, 'today1oct', L(12)),
    structure(B, 'today7sep', L(12)),
    structure(B, 'in18', L(12)),
    structure(B, 'in1', L(12)),
    structure(B, 'dec', L(12)),
    structure(B, 'cut', L(15)),
  ]);
  const bOct = await createRun('hrb', { period: '2026-10' });
  await submitRun('hrb', bOct.run.id);
  const bOctRun = await payrollRuns().findOne({ _id: new ObjectId(bOct.run.id) });
  ok('October ran 26 Sep – 25 Oct on 31 base days', bOctRun?.periodFrom === '2026-09-26' && bOctRun?.periodTo === '2026-10-25' && bOctRun?.baseDays === 31, bOctRun);

  const saved = (iso: string) => new Date(iso);
  const afterOct = new Date(Date.now() + 1000);
  // 1. First salary typed monthly (1,00,000) then corrected minutes later, both dated the same day.
  await setStructure(B, 'corr', { revisions: [oldRevision(0, R(100_000), '2026-11-05', saved('2026-11-05T06:00:00Z')), oldRevision(R(100_000), L(12), '2026-11-05', saved('2026-11-05T06:04:00Z'))] });
  await setStructure(B, 'corrOct', { revisions: [oldRevision(0, R(100_000), '2026-10-01', afterOct), oldRevision(R(100_000), L(12), '2026-10-01', new Date(afterOct.getTime() + 240_000))] });
  // 2. Dated 1 Oct, saved 31 Oct: before October was submitted.
  await setStructure(B, 'beforeSubmit', { revisions: [oldRevision(L(12), L(15), '2026-10-01', saved('2026-10-31T09:00:00Z'))] });
  // 3. Saved now, back-dated into submitted October (1 Oct) and before it (7 Sep).
  await setStructure(B, 'today1oct', { annualCtcPaise: L(15), revisions: [oldRevision(L(12), L(15), '2026-10-01', afterOct)] });
  await setStructure(B, 'today7sep', { annualCtcPaise: L(15), revisions: [oldRevision(L(12), L(15), '2026-09-07', afterOct)] });
  // 4. Inside November's period.
  await setStructure(B, 'in18', { annualCtcPaise: L(15), revisions: [oldRevision(L(12), L(15), '2026-11-18', afterOct)] });
  await setStructure(B, 'in1', { annualCtcPaise: L(15), revisions: [oldRevision(L(12), L(15), '2026-11-01', afterOct)] });
  // 5. Dated 1 Dec: the stored CTC already holds it.
  await setStructure(B, 'dec', { annualCtcPaise: L(15), revisions: [oldRevision(L(12), L(15), '2026-12-01', afterOct)] });
  // A cut back-dated into October: shown, never recovered.
  await setStructure(B, 'cut', { annualCtcPaise: L(12), revisions: [oldRevision(L(15), L(12), '2026-10-01', afterOct)] });

  const bNov = await createRun('hrb', { period: '2026-11' });
  const n = (id: string) => slipOf(B, '2026-11', id);
  const twelve = { basic: R(50_000), hra: R(25_000), special: R(25_000), gross: R(100_000) };
  const fifteen = { basic: R(62_500), hra: R(31_250), special: R(31_250), gross: R(125_000) };

  ok('b0, no revision: ₹1,00,000 as always', same(await n('b0'), twelve));
  const corr = await n('corr');
  ok('1. same-day correction inside November: no split, ₹12,00,000 throughout', same(corr, twelve) && !corr.inputs.salarySegments && !corr.inputs.arrears, earned(corr));
  const corrOct = await n('corrOct');
  ok('1. same-day correction dated in October: no arrears', same(corrOct, twelve) && !corrOct.inputs.arrears, corrOct.inputs.arrears);
  const beforeSubmit = await n('beforeSubmit');
  ok('2. revised before October was submitted: accepted as paid (no arrears, no recovery)', same(beforeSubmit, fifteen) && !beforeSubmit.inputs.arrears, beforeSubmit.inputs.arrears);

  // 3. Dated 1 Oct, saved after October went out. October paid 26 Sep–25 Oct (30 days, 31 base
  //    days) on 12L. Days 1–25 Oct = 25 of the 30, no loss of pay: counted as 25 × 31/30 base days
  //    of 31, a share of 25/30 (the parts of a period add up to its whole month):
  //      Basic   12,500 × 25/30 = 10,416.67 → 10,417
  //      HRA      6,250 × 25/30 =  5,208.33 →  5,208
  //      Special  6,250 × 25/30                →  5,208     arrears 20,833
  //    November: the whole period on 15L (1,25,000) + 20,833 = 1,45,833.
  //    (Read as "paid days ÷ 31": 12,500 × 25/31 = 10,081 · 5,040 · 5,040 = 20,161 — a decision for HR.)
  const t1 = await n('today1oct');
  ok('3. back-dated to 1 Oct: arrears for 1–25 Oct', same(t1, { ...fifteen, arrears: R(20_833), gross: R(145_833) }) && t1.inputs.arrears?.items.length === 1 && t1.inputs.arrears.items[0].from === '2026-10-01', { ...earned(t1), items: t1.inputs.arrears?.items });
  // Dated 7 Sep: the whole October period on 15L (share 1): 12,500 + 6,250 + 6,250 = 25,000; and
  // 7–25 Sep was paid outside Sowaka: a line saying so, no figure.
  const t7 = await n('today7sep');
  const t7note = t7.inputs.arrears?.items.find((i) => i.notInSowaka);
  ok('3. back-dated to 7 Sep: the October period in full', same(t7, { ...fifteen, arrears: R(25_000), gross: R(150_000) }), { ...earned(t7), items: t7.inputs.arrears?.items });
  ok('3. …and 7–25 Sep shown as not paid in Sowaka, no figure', t7note?.from === '2026-09-07' && t7note.to === '2026-09-25' && t7note.amountPaise === 0, t7.inputs.arrears?.items);

  // 4. 18 Nov: 26 Oct–17 Nov (23 days) on 12L, 18–25 Nov (8) on 15L, of 31.
  //      Basic (50,000 × 23 + 62,500 × 8) / 31 = 1,650,000 / 31 = 53,225.81 → 53,226
  //      HRA   (25,000 × 23 + 31,250 × 8) / 31 =   825,000 / 31 = 26,612.90 → 26,613   gross 1,06,452
  const in18 = await n('in18');
  ok('4. 18 Nov: 26 Oct–17 Nov old, 18–25 Nov new', same(in18, { basic: R(53_226), hra: R(26_613), special: R(26_613), gross: R(106_452) }) && JSON.stringify(in18.inputs.salarySegments?.map((s) => [s.from, s.to])) === JSON.stringify([['2026-10-26', '2026-11-17'], ['2026-11-18', '2026-11-25']]), { ...earned(in18), seg: in18.inputs.salarySegments });
  //    1 Nov: 26–31 Oct (6 days) on 12L, 1–25 Nov (25) on 15L.
  //      Basic (50,000 × 6 + 62,500 × 25) / 31 = 1,862,500 / 31 = 60,080.65 → 60,081
  //      HRA   (25,000 × 6 + 31,250 × 25) / 31 =   931,250 / 31 = 30,040.32 → 30,040   gross 1,20,161
  const in1 = await n('in1');
  ok('4. 1 Nov: 26–31 Oct old, 1–25 Nov new', same(in1, { basic: R(60_081), hra: R(30_040), special: R(30_040), gross: R(120_161) }), earned(in1));
  // 5. Dated 1 Dec: November wholly on 12L, though the stored CTC is 15L.
  const dec = await n('dec');
  ok('5. dated 1 Dec: November on the old CTC', same(dec, twelve) && dec.annualCtcPaise === L(12) && !dec.inputs.salarySegments, earned(dec));
  // A cut back-dated to 1 Oct: November on 12L; the October difference shown (negative), not taken.
  const cut = await n('cut');
  ok('a back-dated cut: shown, never recovered', same(cut, twelve) && cut.inputs.arrears?.status === 'negative' && cut.inputs.arrears.paidPaise === 0 && cut.inputs.arrears.items[0].amountPaise === -R(20_833), { ...earned(cut), a: cut.inputs.arrears });

  await recomputeRun('hrb', bNov.run.id, {});
  ok('recalculating November: the same arrears, once', earned(await n('today1oct')).arrears === R(20_833) && earned(await n('today7sep')).arrears === R(25_000));
  await submitRun('hrb', bNov.run.id);
  const bDec = await createRun('hrb', { period: '2026-12' });
  const d = (id: string) => slipOf(B, '2026-12', id);
  const [t1Dec, t7Dec, decDec] = await Promise.all([d('today1oct'), d('today7sep'), d('dec')]);
  ok('December: no arrears again, no September note again', !t1Dec.inputs.arrears && !t7Dec.inputs.arrears && earned(t1Dec).arrears === 0, [t1Dec.inputs.arrears, t7Dec.inputs.arrears]);
  // December's period is 26 Nov – 25 Dec (30 days): 26–30 Nov (5) on 12L, 1–25 Dec (25) on 15L.
  //   Basic (50,000 × 5 + 62,500 × 25) / 30 = 1,812,500 / 30 = 60,416.67 → 60,417
  //   HRA   (25,000 × 5 + 31,250 × 25) / 30 =   906,250 / 30 = 30,208.33 → 30,208
  ok('December: the 1 Dec revision in force from 1 Dec', same(decDec, { basic: R(60_417), hra: R(30_208), special: R(30_208), gross: R(120_833) }) && decDec.annualCtcPaise === L(15), earned(decDec));
  void bDec;

  await db.dropDatabase();
  await closeDb();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
