/**
 * The final settlement against the plan's worked examples ("Exits and Final
 * Settlement", 14 Nov 2026): one employee on ₹18,00,000 a year who leaves four
 * ways. Each is run through the real code (monthly runs with the tax engine,
 * the exit, the hourly job, the settlement) and every line is compared with the
 * figure worked out by hand in the plan.
 *
 * The plan's year is moved to April 2025 – March 2026 so every date is in the
 * past (the arithmetic is the same: February has 28 days in both). As in the
 * plan: PF on the ₹15,000 ceiling, in proportion in a part month; no labour
 * welfare fund; the new tax regime; a day of leave or notice recovery at
 * Basic ÷ 30, a day of notice pay at gross ÷ 30.
 *
 *   MONGODB_DB=exits_plan_scratch npm run exits:plan-check
 */
import {
  companies, connectDb, exitSettlements, getDb, leaves, paidDaysTemplates, payHeads, payslips, salaryStructures, salaryTemplates, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import type { User } from '../models/user.model';
import { closeCase, closeDueExits, exitDetail, listExits, recordExit, setClearance, settlementAction } from '../services/exit.service';
import { serviceYears } from '../services/exitSettlement.service';
import { createRun } from '../services/payrollRun.service';
import { createShift, setDefaultShift } from '../services/shift.service';
import { ZOHO_CATALOG, ZOHO_SETTINGS, ZOHO_TEMPLATES } from './payroll-zoho-check';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
/** Rupees of a paise figure. */
const rs = (paise: number | undefined) => Math.round((paise ?? 0) / 100);
function eq(label: string, got: number | undefined, want: number) { ok(`${label}: ₹${want.toLocaleString('en-IN')}`, rs(got) === want, { got: rs(got), want }); }
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}

const ORG = 'plancheck';
const ist = (stamp: string) => new Date(`${stamp}+05:30`);
const person = (userId: string, name: string, extra: Partial<User> = {}): User => ({
  userId, name, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', employeeId: userId.toUpperCase(),
  joiningDate: new Date('2019-04-01T00:00:00Z'), managerUserId: 'hr', ...extra,
} as User);

// ————————————————————————————————————————————— the same sums, worked out here from first principles
// Nothing below calls payroll or the settlement: it is the arithmetic of the plan, written a second time,
// so a figure passes only when two separate workings agree.
const half = (n: number) => Math.floor(n + 0.5);
const BASIC = 75_000;                       // 50% of ₹1,50,000 a month
const HRA = 37_500;                         // 50% of Basic
const PF_CEILING = 15_000;
const EMPLOYER_PF = 0.12 * PF_CEILING;      // 1,800, inside CTC
const GRATUITY_SET_ASIDE = half((BASIC * 481) / 10_000); // 4.81% of Basic: 3,607.50 → 3,608, inside CTC (the plan wrote 3,607, hence its ₹1–2 differences)
const FIXED = 1_50_000 - BASIC - HRA - EMPLOYER_PF - GRATUITY_SET_ASIDE; // the rest: 32,092
const GROSS = BASIC + HRA + FIXED;          // 1,44,592
/** A part month: each component for the days paid, rounded to the rupee. */
const partMonth = (days: number, base: number) => half((BASIC * days) / base) + half((HRA * days) / base) + half((FIXED * days) / base);
/** PF: 12% of the ceiling, in proportion to the days paid. */
const pfFor = (days: number, base: number) => half(0.12 * ((PF_CEILING * days) / base));
/** New regime: ₹75,000 standard deduction, the slabs, no tax to ₹12 lakh (marginal relief just above), 4% cess. */
function taxForYear(salary: number): number {
  const taxable = Math.round((salary - 75_000) / 10) * 10;
  const slabs: [number, number][] = [[4_00_000, 0], [8_00_000, 0.05], [12_00_000, 0.10], [16_00_000, 0.15], [20_00_000, 0.20], [24_00_000, 0.25], [Infinity, 0.30]];
  let tax = 0;
  let from = 0;
  for (const [upTo, rate] of slabs) { if (taxable > from) tax += (Math.min(taxable, upTo) - from) * rate; from = upTo; }
  if (taxable <= 12_00_000) tax = 0;
  else tax = Math.min(tax, taxable - 12_00_000);
  return half(tax * 1.04);
}
/** Month by month, as payroll withholds: what the year still needs, spread over the months left. */
function taxTaken(months: number): number[] {
  const year = taxForYear(GROSS * 12);
  const out: number[] = [];
  for (let m = 0; m < months; m += 1) out.push(Math.max(0, half((year - out.reduce((t, x) => t + x, 0)) / (12 - m))));
  return out;
}
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const LEAVE = 12 * (BASIC / 30);                    // 12 days × 2,500
const GRATUITY = half((15 / 26) * BASIC * 7);       // 7 years counted
const APR_DEC = taxTaken(9);

/** Within ₹2 of the plan page's figure (which rounded the gratuity set aside down by 50 paise). */
function plan(label: string, got: number | undefined, planFigure: number) { ok(`${label}: within ₹2 of the plan's ₹${planFigure.toLocaleString('en-IN')}`, Math.abs(rs(got) - planFigure) <= 2, { got: rs(got), plan: planFigure }); }

type Detail = Awaited<ReturnType<typeof exitDetail>>;
const line = (d: Detail, key: string) => d.settlement?.lines.find((l) => l.key === key);
const amount = (d: Detail, key: string) => line(d, key)?.amountPaise;

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const now = new Date();

  // —— The company's payroll, as the plan assumes it.
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...structuredClone(c), fy: '2025-26', createdAt: now, updatedAt: now })) as never);
  await statutorySettings().insertOne({ ...ZOHO_SETTINGS, org: ORG, epf: { ...ZOHO_SETTINGS.epf, proRateRestricted: true }, tds: { enabled: true, defaultRegime: 'new' } } as never);
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG, code: 'PLAN', name: 'Plan', components: [
    { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } },
    { payHeadCode: 'HRA', calculation: { mode: 'percentage', percent: 50, base: 'basic' } },
    { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
    { payHeadCode: 'GRATUITY', calculation: { mode: 'percentage', percent: 4.81, base: 'basic' } },
  ] } as never);
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'Every day paid', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now } as never);
  await companies().insertOne({ id: ORG, name: 'Plan Check Pvt Ltd', features: { exits: true }, exitNoticeDays: 60 } as never);
  // No work state: national rules only, so no labour welfare fund or professional tax (the plan has neither).
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('r1', 'Riya Resigned'), person('r2', 'Riya Terminated'), person('r3', 'Riya Absconded'), person('r5', 'Riya Retired'),
  ]);
  await salaryStructures().insertMany(['r1', 'r2', 'r3', 'r5'].map((userId) => ({ org: ORG, userId, salaryTemplateCode: 'PLAN', annualCtcPaise: 18_00_000_00, status: 'active' as const, createdAt: now, updatedAt: now })));
  // Earned leave, all of it encashable: a day a month, carried forward. 12 days left on the last day (the plan's figure).
  const shift = await createShift('hr', { name: 'General', punchFormat: 'In-app punch in', policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [
    { key: 'earned', name: 'Earned Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 30, encashment: 'all', encashLimitDays: 0, advanceDays: 90, allowBackdated: false, backdatedDays: 0 },
  ] } } } as never);
  await setDefaultShift('hr', (shift as { id: string }).id);
  // Leave taken in 2025, so each has 12 days on their own last day (a day is credited each month of 2026 they work in).
  const took = async (userId: string, days: number) => leaves().insertOne({ userId, type: 'earned', startDate: new Date('2025-06-09T00:00:00Z'), endDate: new Date(Date.UTC(2025, 5, 9 + days - 1)), days, reason: 'Trip', status: 'approved', decidedByRole: 'manager', createdAt: Date.now() } as never);
  await took('r1', 2); await took('r2', 1); await took('r3', 1); await took('r5', 3);

  console.log('April to December 2025: paid as usual');
  for (const period of ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']) await createRun('hr', { period });
  const slipOf = (userId: string, period: string) => payslips().findOne({ org: ORG, userId, period });
  const dec = (await slipOf('r1', '2025-12'))!;
  const of = (s: NonNullable<typeof dec>, key: string) => s.deductions.find((d) => d.key === key)?.amountPaise ?? 0;
  eq('Basic', dec.earnings.find((e) => e.code === 'BASIC')?.paidPaise, 75_000);
  eq('House rent allowance', dec.earnings.find((e) => e.code === 'HRA')?.paidPaise, 37_500);
  eq('Fixed allowance, the rest of CTC', dec.earnings.find((e) => e.code === 'FIXED_ALLOWANCE')?.paidPaise, FIXED);
  eq('Gross a month', dec.grossPaise, GROSS);
  plan('Gross a month', dec.grossPaise, 1_44_593);
  eq('PF a month (12% of ₹15,000)', of(dec, 'epf'), 1_800);
  eq('Income tax in December', of(dec, 'income_tax'), APR_DEC[8]);
  eq('Take-home in December', dec.netPayablePaise, GROSS - 1_800 - APR_DEC[8]);
  plan('Take-home a month', dec.netPayablePaise, 1_31_351);
  const taken = (await payslips().find({ org: ORG, userId: 'r1', period: { $lte: '2025-12' } }).toArray()).reduce((t, s) => t + of(s, 'income_tax'), 0);
  eq('Tax taken April to December', taken, sum(APR_DEC));
  plan('Tax taken April to December', taken, 1_02_978);

  // ————————————————————————————————————————————— 2 · Terminated
  console.log('\n2 · Terminated on 20 January, paid 60 days of notice');
  await recordExit('hr', 'r2', { kind: 'terminated', noticeFrom: '2026-01-20', lastWorkingDay: '2026-01-20', noticeDays: 60, rules: { noticePay: 'pay' } }, ist('2026-01-20T16:00:00'));
  ok('their app is off at once', (await users().findOne({ userId: 'r2' }))?.lifecycleStatus === 'terminated');
  // Before January's run exists: the settlement works the last month out itself.
  let t = await exitDetail('hr', 'r2', ist('2026-01-21T11:00:00'));
  ok('the settlement has started, as a draft', t.settlement?.status === 'draft' && t.exit.stage === 'settlement_due', t.exit.stage);
  ok('January is worked out by the settlement (no run yet)', line(t, 'salary:2026-01')?.estimated === true, line(t, 'salary:2026-01'));
  // 24 Nov 2026 (HR): no notice money any more. Leaving early is paid for the days worked; no notice pay, nothing recovered.
  const T = { jan: partMonth(20, 31), noticePay: 0, pf: pfFor(20, 31) };
  const tYear = taxForYear(GROSS * 9 + T.jan + T.noticePay);
  const tDue = Math.max(0, tYear - sum(APR_DEC));
  const terminated = (d: Detail, how: string) => {
    eq(`${how}: January salary, 20 of 31 days`, amount(d, 'salary:2026-01'), T.jan);
    ok(`${how}: no notice pay line`, !line(d, 'notice_pay'));
    eq(`${how}: leave encashment, 12 days × 2,500`, amount(d, 'leave_encashment'), LEAVE);
    eq(`${how}: gratuity, 15 ÷ 26 × 75,000 × 7 years`, amount(d, 'gratuity'), GRATUITY);
    eq(`${how}: PF on January salary only`, amount(d, 'pf'), T.pf);
    eq(`${how}: tax for the year (encashment and gratuity not taxed)`, d.settlement?.tax?.annualTaxPaise, tYear);
    eq(`${how}: income tax still due for the year`, amount(d, 'income_tax'), tDue);
    eq(`${how}: paid to her`, d.settlement?.payablePaise, T.jan + T.noticePay + LEAVE + GRATUITY - T.pf - tDue);
    plan(`${how}: paid to her`, d.settlement?.payablePaise, 4_25_010);
  };
  terminated(t, 'before the run');
  ok('no notice recovery on a termination', !line(t, 'notice_recovery'));

  // ————————————————————————————————————————————— 3 · Absconded
  console.log('\n3 · Absconded: last seen 5 January, recorded on the 12th');
  await recordExit('hr', 'r3', { kind: 'absconded', noticeFrom: '2026-01-05', lastWorkingDay: '2026-01-05', noticeDays: 60 }, ist('2026-01-12T11:00:00'));
  let a = await exitDetail('hr', 'r3', ist('2026-01-13T11:00:00'));
  ok('nothing is settled until HR closes the case', a.settlement === null && a.exit.caseOpen === true && a.exit.stage === 'settlement_due', a.exit);
  ok('…and the settlement cannot be approved before that', (await refusal(() => settlementAction('hr', 'r3', 'approve', {}, ist('2026-01-13T11:00:00')))).status === 409);

  // ————————————————————————————————————————————— 1 · Resigned
  console.log('\n1 · Resigned: notice from 1 January, last day 15 February (46 of 60 days)');
  await recordExit('hr', 'r1', { kind: 'resigned', noticeFrom: '2026-01-01', lastWorkingDay: '2026-02-15', noticeDays: 60 }, ist('2026-01-01T11:00:00'));

  console.log('\nJanuary 2026 run');
  await createRun('hr', { period: '2026-01' });
  const jan = async (userId: string) => (await slipOf(userId, '2026-01'))!;
  ok('Resigned: January is made but held', (await jan('r1')).held?.since === '2026-01-01');
  eq('Resigned: January gross, a full month', (await jan('r1')).grossPaise, GROSS);
  eq('Resigned: January tax (the year now ends on 15 February)', of(await jan('r1'), 'income_tax'), 0);
  ok('Terminated: January held, 20 of 31 days', (await jan('r2')).held !== undefined && (await jan('r2')).inputs.payableDays === 20, (await jan('r2')).inputs);
  ok('Absconded: January held, 5 of 31 days', (await jan('r3')).held !== undefined && (await jan('r3')).inputs.payableDays === 5, (await jan('r3')).inputs);
  ok('Retiring later: January paid as usual', (await jan('r5')).held === undefined);
  eq('…with January\'s tax', of(await jan('r5'), 'income_tax'), taxTaken(10)[9]);

  t = await exitDetail('hr', 'r2', ist('2026-02-01T11:00:00'));
  ok('Terminated: the settlement now uses the run\'s payslip', line(t, 'salary:2026-01')?.estimated !== true);
  terminated(t, 'from the run');

  a = await closeCase('hr', 'r3', ist('2026-02-02T11:00:00'));
  ok('Absconded: closing the case starts the settlement', a.settlement?.status === 'draft' && a.exit.caseOpen === false);
  const A = { jan: partMonth(5, 31), recovery: 0, pf: pfFor(5, 31) };
  const aYear = taxForYear(GROSS * 9 + A.jan);
  const aPaid = A.jan + LEAVE + GRATUITY - A.recovery - A.pf;
  eq('Absconded: January salary, 5 of 31 days', amount(a, 'salary:2026-01'), A.jan);
  eq('Absconded: leave encashment', amount(a, 'leave_encashment'), LEAVE);
  eq('Absconded: gratuity, 7 years', amount(a, 'gratuity'), GRATUITY);
  ok('Absconded: nothing recovered for notice', !line(a, 'notice_recovery'));
  eq('Absconded: PF on January salary', amount(a, 'pf'), A.pf);
  eq('Absconded: tax for the year (just over ₹12 lakh: marginal relief; the recovery does not lower it)', a.settlement?.tax?.annualTaxPaise, aYear);
  eq('Absconded: income tax still due', amount(a, 'income_tax'), 0);
  eq('…taken too much, back in her return', a.settlement?.tax?.refundViaReturnPaise, sum(APR_DEC) - aYear);
  eq('Absconded: paid if HR pays everything due', a.settlement?.payablePaise, aPaid);
  plan('Absconded: paid', a.settlement?.payablePaise, 3_55_916);
  // HR forfeits the leave encashment, with a reason.
  ok('a change needs a reason', (await refusal(() => settlementAction('hr', 'r3', 'line', { key: 'leave_encashment', amountPaise: 0 }, ist('2026-02-02T11:05:00')))).status === 400);
  a = await settlementAction('hr', 'r3', 'line', { key: 'leave_encashment', amountPaise: 0, reason: 'Forfeited: absconded' }, ist('2026-02-02T11:06:00'));
  eq('Absconded: with the leave encashment forfeited', a.settlement?.payablePaise, aPaid - LEAVE);
  plan('Absconded: with it forfeited', a.settlement?.payablePaise, 3_25_916);
  ok('the statement says who changed it and why', line(a, 'leave_encashment')?.changedReason === 'Forfeited: absconded' && line(a, 'leave_encashment')?.computedPaise === 30_000_00, line(a, 'leave_encashment'));
  a = await settlementAction('hr', 'r3', 'line', { key: 'leave_encashment', amountPaise: null }, ist('2026-02-02T11:07:00'));
  eq('…and put back', a.settlement?.payablePaise, aPaid);

  // ————————————————————————————————————————————— 5 · Retired
  console.log('\n5 · Retired: notice from 1 February, last day 31 March');
  await recordExit('hr', 'r5', { kind: 'retired', noticeFrom: '2026-02-01', lastWorkingDay: '2026-03-31', noticeDays: 60 }, ist('2026-02-01T11:00:00'));

  console.log('\n1 · Resigned, settled by 18 February (before February\'s run)');
  ok('her app works on her last day', (await closeDueExits(ist('2026-02-15T23:30:00'))) === 0);
  ok('…and is off the next morning', (await closeDueExits(ist('2026-02-16T00:30:00'))) === 1 && (await users().findOne({ userId: 'r1' }))?.lifecycleStatus === 'offboarded');
  ok('the settlement was drafted by itself', (await exitSettlements().findOne({ org: ORG, userId: 'r1' }))?.status === 'draft');
  let r = await exitDetail('hr', 'r1', ist('2026-02-17T11:00:00'));
  const R = { feb: partMonth(15, 28), short: 0, pf: 1_800 + pfFor(15, 28) };
  const rYear = taxForYear(GROSS * 10 + R.feb);
  const rPaid = GROSS + R.feb + LEAVE + GRATUITY - R.short - R.pf;
  eq('Resigned: January salary (held), a full month', amount(r, 'salary:2026-01'), GROSS);
  eq('Resigned: February salary, 15 of 28 days', amount(r, 'salary:2026-02'), R.feb);
  ok('…February worked out by the settlement', line(r, 'salary:2026-02')?.estimated === true);
  eq('Resigned: leave encashment, 12 days × 2,500', amount(r, 'leave_encashment'), LEAVE);
  eq('Resigned: gratuity, 7 years', amount(r, 'gratuity'), GRATUITY);
  ok('Resigned: left 14 days before the notice ended, nothing recovered', !line(r, 'notice_recovery'));
  eq('Resigned: PF on January and February', amount(r, 'pf'), R.pf);
  eq('Resigned: tax for the year on what she earned', r.settlement?.tax?.annualTaxPaise, rYear);
  eq('Resigned: income tax still due', amount(r, 'income_tax'), 0);
  eq('…taken too much, back in her return', r.settlement?.tax?.refundViaReturnPaise, sum(APR_DEC) - rYear);
  eq('Resigned: paid to her in one transfer', r.settlement?.payablePaise, rPaid);
  plan('Resigned: paid', r.settlement?.payablePaise, 5_52_175);
  ok('no notice pay on a resignation', !line(r, 'notice_pay'));

  console.log('\napprove and pay');
  const blocked = await refusal(() => settlementAction('hr', 'r1', 'approve', {}, ist('2026-02-17T11:20:00')));
  ok('not approved while clearance is open', blocked.status === 409 && /Clearance is not complete/.test(blocked.message), blocked);
  for (const item of r.exit.clearance) await setClearance('hr', 'r1', { key: item.key, done: true }, ist('2026-02-17T11:30:00'));
  r = await settlementAction('hr', 'r1', 'approve', {}, ist('2026-02-17T11:40:00'));
  ok('approved once everything is ticked', r.settlement?.status === 'approved' && r.settlement.approvedByName === 'Hema HR', r.settlement?.status);
  ok('an approved settlement cannot be changed', (await refusal(() => settlementAction('hr', 'r1', 'line', { key: 'gratuity', amountPaise: 0, reason: 'x' }, ist('2026-02-17T11:41:00')))).status === 409);
  r = await settlementAction('hr', 'r1', 'reopen', {}, ist('2026-02-17T11:42:00'));
  ok('…until it is reopened', r.settlement?.status === 'draft');
  r = await settlementAction('hr', 'r1', 'approve', {}, ist('2026-02-17T11:43:00'));
  r = await settlementAction('hr', 'r1', 'paid', {}, ist('2026-02-18T11:00:00'));
  ok('paid: she has left', r.settlement?.status === 'paid' && r.exit.stage === 'left', r.exit.stage);
  eq('the amount paid stays as approved', r.settlement?.payablePaise, rPaid);
  ok('the held January payslip is stamped as settled', !!((await slipOf('r1', '2026-01'))?.held as { settledAt?: Date } | undefined)?.settledAt);
  ok('a paid settlement cannot be reopened', (await refusal(() => settlementAction('hr', 'r1', 'reopen', {}, ist('2026-02-19T11:00:00')))).status === 409);

  console.log('\nFebruary and March runs');
  await createRun('hr', { period: '2026-02' });
  ok('February\'s run leaves her out: the settlement already paid it', (await slipOf('r1', '2026-02')) === null);
  ok('…and the two who left in January', (await slipOf('r2', '2026-02')) === null && (await slipOf('r3', '2026-02')) === null);
  ok('Retiring: February held', (await slipOf('r5', '2026-02'))?.held?.since === '2026-02-01');
  await createRun('hr', { period: '2026-03' });
  ok('…and March', (await slipOf('r5', '2026-03'))?.held !== undefined && (await slipOf('r1', '2026-03')) === null);

  console.log('\n5 · Retired, settled on 1 April');
  ok('her app is off on 1 April', (await closeDueExits(ist('2026-04-01T00:30:00'))) === 1);
  const p = await exitDetail('hr', 'r5', ist('2026-04-01T11:00:00'));
  // She works the whole year: the year's tax is what April guessed, less the ten months already taken.
  const pDue = taxForYear(GROSS * 12) - sum(taxTaken(10));
  eq('Retired: February salary (held)', amount(p, 'salary:2026-02'), GROSS);
  eq('Retired: March salary (held)', amount(p, 'salary:2026-03'), GROSS);
  eq('Retired: leave encashment', amount(p, 'leave_encashment'), LEAVE);
  eq('Retired: gratuity, 7 years to the day', amount(p, 'gratuity'), GRATUITY);
  eq('Retired: PF on February and March', amount(p, 'pf'), 3_600);
  eq('Retired: income tax for February and March', amount(p, 'income_tax'), pDue);
  plan('Retired: income tax for February and March', amount(p, 'income_tax'), 22_884);
  eq('Retired: paid to her', p.settlement?.payablePaise, GROSS * 2 + LEAVE + GRATUITY - 3_600 - pDue);
  plan('Retired: paid', p.settlement?.payablePaise, 5_95_587);
  ok('no notice lines: the notice was served in full', !line(p, 'notice_recovery') && !line(p, 'notice_pay'));

  console.log('\nthe Exits page');
  const rows = await listExits('hr', ist('2026-04-01T12:00:00'));
  const stage = (userId: string) => rows.find((x) => x.userId === userId)?.stage;
  ok('paid: Left; the rest: Settlement due', stage('r1') === 'left' && stage('r2') === 'settlement_due' && stage('r3') === 'settlement_due' && stage('r5') === 'settlement_due', rows.map((x) => [x.userId, x.stage]));
  ok('each row carries its settlement amount', rs(rows.find((x) => x.userId === 'r2')?.settlement?.payablePaise) === T.jan + T.noticePay + LEAVE + GRATUITY - T.pf - tDue && rs(rows.find((x) => x.userId === 'r5')?.settlement?.payablePaise) === GROSS * 2 + LEAVE + GRATUITY - 3_600 - pDue);

  console.log('\ngratuity years');
  const y = (joined: string, last: string) => serviceYears(joined, last);
  ok('4 years 11 months: none (under 5 completed years)', y('2021-03-01', '2026-01-31').completed === 4);
  ok('exactly 5 years: 5', y('2021-02-01', '2026-01-31').completed === 5 && y('2021-02-01', '2026-01-31').counted === 5);
  ok('5 years 6 months to the day: still 5', y('2020-08-01', '2026-01-31').counted === 5, y('2020-08-01', '2026-01-31'));
  ok('5 years 6 months and a day: 6', y('2020-07-31', '2026-01-31').counted === 6, y('2020-07-31', '2026-01-31'));
  ok('6 years 9 months 20 days: 7', y('2019-04-01', '2026-01-20').counted === 7);

  console.log(`\n${failed ? `${failed} check(s) failed` : `all ${passed} plan checks passed`}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
