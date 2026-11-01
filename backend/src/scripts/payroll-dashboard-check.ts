/**
 * Scratch-database check of what the HR dashboard reads and sets for the
 * app's Payroll: the app's payroll settings (the on/off switch, off by
 * default, and the deadlines, validated within the FY), the 403 the app's
 * payroll routes give while it is off, the sign-in flag, HR's read of one
 * person's flexible split and its history (payroll access and same company
 * only), and the per-day fix-by of missing punches from each person's shift
 * policy correction window (different windows, a day past its window,
 * corrections off, a locked month). No payroll value has a default in code:
 * unset deadlines, a FY without tax rules and a template without a pool each
 * come back as not set up; the one-time seed fills the deadlines. It drops and recreates its own database,
 * and refuses any other. Test data is the `sowaka` org with invented people
 * and amounts. Run with
 *   npm run payroll:dashboard-check
 */
import type { NextFunction, Request, Response } from 'express';
import {
  attendanceRecords, attendanceRegularizations, companies, connectDb, flexibleSplits, getDb, payHeads, payrollRuns, salaryStructures,
  salaryTemplates, shiftPolicies, shiftTemplates, taxDeclarations, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { requirePayrollApp } from '../controllers/employeePayroll.controller';
import { tabsForRequest } from '../models/dashboard-tabs';
import { PayHead } from '../models/payHead.model';
import { getCurrentAuthUser } from '../services/auth.service';
import { myDeclaration, myProofs, saveMyDeclaration, uploadMyProof } from '../services/employeePayroll.declaration';
import { myMissingPunches, myPayrollHome } from '../services/employeePayroll.home';
import { employeeAppSettingsForHr, seedEmployeePayrollSettings, setEmployeeAppSettingsForHr } from '../services/employeePayroll.settings';
import { mySplit, reviewSplit, saveSplit, splitForHr, splitWindow } from '../services/employeePayroll.split';
import { TDS_SEED } from '../shared/payroll/tds';
import { getOrgShiftPolicy } from '../services/shift.service';

const SCRATCH = 'payroll_dashboard_scratch';
const ORG = 'sowaka';
const FY = '2026-27';
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
    const e = error as { statusCode?: number; message?: string; details?: Record<string, unknown> };
    return { status: e.statusCode, message: e.message, details: e.details };
  }
}

/** What the app-switch middleware does for someone of `org`: null (let through) or the error it passes on. */
async function gate(org: string) {
  let passedOn: unknown = 'not called';
  await requirePayrollApp({ auth: { userId: 'x', token: 't', user: { org } } } as unknown as Request, {} as Response, ((e?: unknown) => { passedOn = e ?? null; }) as NextFunction);
  return passedOn as null | { statusCode?: number; details?: Record<string, unknown> };
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

  const now = new Date();
  await companies().insertMany([{ id: ORG, name: 'Sowaka (scratch)' }, { id: 'otherco', name: 'Other (scratch)' }] as never[]);
  // People punch in and out (the default policy marks everyone present).
  await shiftPolicies().insertOne({ org: ORG, correction: { punchFormat: 'Geotag (powered by Sowaka)' } } as never);
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('hrpay', 'Pooja Payroll', { dashboardAccess: true, dashboardTabs: ['salarydetails'] }),
    person('hrleave', 'Lata Leaves', { dashboardAccess: true, dashboardTabs: ['leaves'] }),
    person('asha', 'Asha Test'),
    person('bala', 'Bala Test'),
    person('chetan', 'Chetan Test'),
    person('devi', 'Devi Test'),
    person('ohr', 'Other HR', { org: 'otherco', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('omar', 'Omar Other', { org: 'otherco', managerUserId: 'ohr' }),
  ] as never[]);
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, taxable: true }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, taxable: true }),
    head({ code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel & vehicle', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(3000) }),
    head({ code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1000) }),
  ]);
  await salaryTemplates().insertOne({
    org: ORG, name: 'Flexible', code: 'FLEX', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE', flexiblePoolPaise: R(4000),
    components: [
      { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } },
      { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
      { payHeadCode: 'FUEL', calculation: { mode: 'flat_amount' } },
      { payHeadCode: 'INTERNET', calculation: { mode: 'flat_amount' } },
    ],
  } as never);
  await salaryStructures().insertOne({
    org: ORG, userId: 'asha', salaryTemplateCode: 'FLEX', annualCtcPaise: R(12_00_000), componentValues: { FUEL: R(1500), INTERNET: R(500) }, status: 'active', createdAt: now, updatedAt: now,
  } as never);

  // —— the app's payroll settings: off, and nothing set, until HR sets them ——
  const oct20 = new Date('2026-10-20T06:00:00Z');
  const s0 = await employeeAppSettingsForHr('hr', FY, oct20);
  check('settings: a company that never set them has Payroll off and no deadlines (no defaults in code)',
    s0.settings.appEnabled === false && s0.settings.splitCutoffDay === null && s0.settings.declarationDue === null && s0.settings.proofsDue === null
    && s0.settings.billsDue === null && s0.missing.join() === 'splitCutoffDay,declarationDue,proofsDue,billsDue' && s0.ready === false && !('defaults' in s0), s0);
  check('settings: no dates either', Object.values(s0.dates).every((v) => v === null), s0.dates);
  const off = await myPayrollHome('asha', undefined, oct20);
  check('home while off: appEnabled false and nothing else', off.appEnabled === false && Object.keys(off).sort().join() === 'appEnabled,fy,period', off);
  const blocked = await gate(ORG);
  check('the other app payroll routes while off: 403 payroll_app_off', blocked?.statusCode === 403 && blocked.details?.reason === 'payroll_app_off', blocked);
  check('sign-in says payroll is off', (await getCurrentAuthUser('asha')).features?.payroll === false);

  // Who may read and change them.
  check('settings: someone with Salary details only may read them', (await employeeAppSettingsForHr('hrpay', FY, oct20)).settings.appEnabled === false);
  check('settings: HR without payroll access is refused (403)', (await refusal(() => employeeAppSettingsForHr('hrleave', FY, oct20)))?.status === 403);
  check('settings: …and cannot change them (403)', (await refusal(() => setEmployeeAppSettingsForHr('hrleave', FY, { appEnabled: true }, oct20)))?.status === 403);
  check('settings: an employee is refused (403)', (await refusal(() => setEmployeeAppSettingsForHr('asha', FY, { appEnabled: true }, oct20)))?.status === 403);
  check('settings: the dashboard tab rule is payroll tabs only',
    JSON.stringify(tabsForRequest('PUT', '/admin/payroll/employee-app-settings')) === JSON.stringify(['salarydetails', 'payruns'])
    && JSON.stringify(tabsForRequest('GET', '/admin/payroll/employees/asha/flexible-split')) === JSON.stringify(['salarydetails', 'payruns']),
    [tabsForRequest('PUT', '/admin/payroll/employee-app-settings'), tabsForRequest('GET', '/admin/payroll/employees/asha/flexible-split')]);

  // Validation.
  const bad = async (body: Record<string, unknown>) => (await refusal(() => setEmployeeAppSettingsForHr('hr', FY, body, oct20)))?.status === 400;
  check('settings: nothing sent (400)', await bad({}));
  check('settings: an unknown field (400)', await bad({ appEnabled: true, colour: 'blue' }));
  check('settings: appEnabled must be a boolean (400)', await bad({ appEnabled: 'yes' }));
  check('settings: cutoff day 0 (400)', await bad({ splitCutoffDay: 0 }));
  check('settings: cutoff day 29 (400)', await bad({ splitCutoffDay: 29 }));
  check('settings: cutoff day 15.5 (400)', await bad({ splitCutoffDay: 15.5 }));
  check('settings: declaration due in February is outside its part of the FY (400)', await bad({ declarationDue: '02-15' }));
  check('settings: proofs due in April (400)', await bad({ proofsDue: '04-30' }));
  check('settings: bills due on 29 Feb (400)', await bad({ billsDue: '02-29' }));
  check('settings: bills due 31 Apr is no date (400)', await bad({ billsDue: '04-31' }));
  check('settings: a declaration date in the wrong year of the FY (400)', await bad({ declarationDue: '2027-12-15' }));
  check('settings: a proofs date in the FY\'s first year (400)', await bad({ proofsDue: '2026-02-15' }));
  check('settings: not a date (400)', await bad({ proofsDue: 'soon' }));
  const early = await refusal(() => setEmployeeAppSettingsForHr('hr', FY, { appEnabled: true, splitCutoffDay: 20 }, oct20));
  check('settings: switching Payroll on before every deadline is set is refused (409), naming them',
    early?.status === 409 && early.details?.reason === 'payroll_not_configured' && (early.details?.missing as string[]).join() === 'declarationDue,proofsDue,billsDue'
    && /declarationDue, proofsDue, billsDue/.test(early.message ?? ''), early);
  check('settings: a refused change saves nothing', (await companies().findOne({ id: ORG }))?.payrollEmployee === undefined);

  // —— what the app's screens say while a deadline is not set ——
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  const dNo = await myDeclaration('asha', FY, oct20);
  check('declaration without a due date: notConfigured, no date, not locked', dNo.notConfigured && dNo.dueOn === null && !dNo.locked && dNo.missing.join() === 'declarationDue' && dNo.proofsDueOn === null, dNo);
  const dSave = await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { ppf: R(10_000) } }, oct20));
  check('…and cannot be saved (409 payroll_not_configured)', dSave?.status === 409 && dSave.details?.reason === 'payroll_not_configured', dSave);
  const spNo = await mySplit('asha', oct20);
  check('split without a cutoff day or bills date: notConfigured, the window closed with no dates',
    spNo.notConfigured && spNo.missing.join() === 'splitCutoffDay,billsDue' && !spNo.window.open && spNo.window.effectiveFrom === null && spNo.window.reason === 'payroll_not_configured' && spNo.billsDueOn === null, spNo);
  const rvNo = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2000) } }, oct20));
  check('…and cannot be reviewed (409, naming what is missing)', rvNo?.status === 409 && (rvNo.details?.missing as string[]).join() === 'splitCutoffDay,billsDue', rvNo);
  await setEmployeeAppSettingsForHr('hr', FY, { declarationDue: '11-30' }, oct20);
  await saveMyDeclaration('asha', FY, { regime: 'old', items: { ppf: R(10_000) } }, oct20);
  const prNo = await myProofs('asha', FY, oct20);
  check('proofs without a due date: notConfigured, no date', prNo.notConfigured && prNo.dueOn === null && !prNo.locked && prNo.missing.join() === 'proofsDue', prNo);
  const upNo = await refusal(() => uploadMyProof('asha', 'ppf', FY, { amountPaise: R(10_000) }, oct20));
  check('…and nothing can be uploaded (409 payroll_not_configured)', upNo?.status === 409 && upNo.details?.reason === 'payroll_not_configured', upNo);
  // Switched on in the database by hand with deadlines missing: home says what is not set, no made-up dates.
  await companies().updateOne({ id: ORG }, { $set: { 'payrollEmployee.appEnabled': true } });
  const hNo = await myPayrollHome('asha', undefined, oct20);
  const tNo = (kind: string) => (hNo.appEnabled ? hNo.todo.find((t) => t.kind === kind) : undefined);
  check('home: the split to-do says not configured, with no date', tNo('flexible_split')?.notConfigured === true && tNo('flexible_split')?.dueOn === null, hNo.appEnabled && hNo.todo);
  check('home: the proofs to-do says not configured, with no date', tNo('investment_proofs')?.notConfigured === true && tNo('investment_proofs')?.dueOn === null, hNo.appEnabled && hNo.todo);
  check('home: the split and proofs sections say so too', hNo.appEnabled === true && hNo.split?.notConfigured === true && hNo.proofs.notConfigured === true && hNo.proofs.dueOn === null, hNo.appEnabled && [hNo.split, hNo.proofs]);
  await companies().updateOne({ id: ORG }, { $unset: { 'payrollEmployee.appEnabled': '' } });

  // The FY's tax rules come only from tds_configs.
  await tdsConfigs().deleteMany({ fy: FY });
  const noRules = await refusal(() => myDeclaration('asha', FY, oct20));
  check('no tax rules for the FY: the declaration says so (409 tax_rules_not_set_up), no caps from code',
    noRules?.status === 409 && noRules.details?.reason === 'tax_rules_not_set_up' && /FY 2026-27/.test(noRules.message ?? ''), noRules);
  check('…and cannot be saved (409)', (await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { ppf: R(20_000) } }, oct20)))?.details?.reason === 'tax_rules_not_set_up');
  await companies().updateOne({ id: ORG }, { $set: { 'payrollEmployee.appEnabled': true } });
  const hRules = await myPayrollHome('asha', undefined, oct20);
  check('home: the declaration section and to-do say the tax rules are not set up',
    hRules.appEnabled === true && hRules.declaration.notConfigured === true && hRules.declaration.reason === 'tax_rules_not_set_up'
    && hRules.todo.some((t) => t.kind === 'tax_regime' && t.notConfigured === true && t.reason === 'tax_rules_not_set_up'), hRules.appEnabled && hRules.declaration);
  await companies().updateOne({ id: ORG }, { $unset: { 'payrollEmployee.appEnabled': '' } });
  await tdsConfigs().insertMany(TDS_SEED.filter((c) => c.fy === FY).map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  check('(the rules back: the declaration reads)', (await myDeclaration('asha', FY, oct20)).fy === FY);

  // —— the one-time seed: today's values where HR has not set them ——
  const dry = await seedEmployeePayrollSettings(ORG, false, oct20);
  check('seed dry run: would write the three unset deadlines, keeps the one HR set, writes nothing',
    !dry.applied && JSON.stringify(dry.writes) === JSON.stringify({ splitCutoffDay: 15, proofsDue: '01-31', billsDue: '03-31' }) && dry.kept.join() === 'declarationDue'
    && (await employeeAppSettingsForHr('hr', FY, oct20)).missing.length === 3, dry);
  await setEmployeeAppSettingsForHr('hr', FY, { declarationDue: '2026-12-15' }, oct20);
  const applied = await seedEmployeePayrollSettings(ORG, true, oct20);
  const afterSeed = await employeeAppSettingsForHr('hr', FY, oct20);
  check('seed --apply: writes them, leaves HR\'s declaration date (15 Dec) and the switch alone',
    applied.applied && afterSeed.ready && afterSeed.settings.declarationDue === '12-15' && afterSeed.settings.splitCutoffDay === 15 && afterSeed.settings.billsDue === '03-31'
    && afterSeed.settings.appEnabled === false, afterSeed);
  check('seed again: nothing left to write', Object.keys((await seedEmployeePayrollSettings(ORG, true, oct20)).writes).length === 0);

  const s1 = await setEmployeeAppSettingsForHr('hr', FY, { appEnabled: true, splitCutoffDay: 20, proofsDue: '2027-02-15', billsDue: '03-15' }, oct20);
  check('settings: every deadline set, Payroll switched on; a full date kept as its month and day', s1.settings.appEnabled && s1.settings.splitCutoffDay === 20 && s1.settings.declarationDue === '12-15'
    && s1.settings.proofsDue === '02-15' && s1.settings.billsDue === '03-15' && s1.updatedBy === 'hr' && s1.ready && s1.missing.length === 0, s1);
  check('settings: stored on the company', (await companies().findOne({ id: ORG }))?.payrollEmployee?.declarationDue === '12-15');
  const on = await myPayrollHome('asha', undefined, oct20);
  check('home once on: appEnabled true with the full summary', on.appEnabled === true && 'todo' in on && 'salary' in on, Object.keys(on));
  check('the other app payroll routes once on: let through', (await gate(ORG)) === null, await gate(ORG));
  check('sign-in says payroll is on', (await getCurrentAuthUser('asha')).features?.payroll === true);
  check('another company is still off', (await gate('otherco'))?.statusCode === 403 && (await employeeAppSettingsForHr('ohr', FY, oct20)).settings.appEnabled === false);
  check('the declaration reads the new due date', (await myDeclaration('asha', FY, oct20)).dueOn === '2026-12-15');
  const w20 = await splitWindow(ORG, oct20);
  check('the split cutoff of 20: a change on 20 Oct still applies from October, until 20 Oct', w20.effectiveFrom === '2026-10' && w20.closesOn === '2026-10-20', w20);
  check('the split shows the new bills date', (await mySplit('asha', oct20)).billsDueOn === '2027-03-15');
  const clear = await refusal(() => setEmployeeAppSettingsForHr('hr', FY, { billsDue: null }, oct20));
  check('settings: clearing a deadline while Payroll is on is refused (409)', clear?.status === 409 && (clear.details?.missing as string[]).join() === 'billsDue', clear);
  await setEmployeeAppSettingsForHr('hr', FY, { appEnabled: false }, oct20);
  check('switched off again: home is off', (await myPayrollHome('asha', undefined, oct20)).appEnabled === false);
  const s2 = await setEmployeeAppSettingsForHr('hr', FY, { billsDue: null }, oct20);
  check('settings: with Payroll off, null clears a deadline (it is then missing, not defaulted)', s2.settings.billsDue === null && s2.missing.join() === 'billsDue' && s2.dates.billsDueOn === null, s2);
  await setEmployeeAppSettingsForHr('hr', FY, { billsDue: '03-31', appEnabled: true }, oct20);

  // —— the flexible pool comes from the template only ——
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $unset: { flexiblePoolPaise: '' } });
  const noPool = await mySplit('asha', oct20);
  check('no pool on the template: the split says not configured, no pool made up from the limits',
    noPool.notConfigured && noPool.missing.join() === 'flexiblePoolPaise' && noPool.poolPaise === null && noPool.unassignedPaise === null, noPool);
  const rvPool = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2000) } }, oct20));
  check('…and cannot be changed (409, flexiblePoolPaise missing)', rvPool?.status === 409 && (rvPool.details?.missing as string[]).join() === 'flexiblePoolPaise', rvPool);
  const hrNoPool = await splitForHr('hr', 'asha', FY, oct20);
  check('…and HR sees it the same way', hrNoPool.poolPaise === null && hrNoPool.notConfigured && hrNoPool.missing.join() === 'flexiblePoolPaise', hrNoPool);
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $set: { flexiblePoolPaise: R(4000) } });
  await taxDeclarations().deleteMany({});

  // —— HR reads a person's flexible split and its history ——
  // A split saved before pools and limits were kept with it.
  await flexibleSplits().insertOne({ org: ORG, userId: 'asha', fy: FY, effectiveFrom: '2026-07', amounts: { FUEL: R(2000), INTERNET: R(500) }, acknowledged: true, submittedAt: new Date('2026-07-05T06:00:00Z') });
  const oct10 = new Date('2026-10-10T06:00:00Z');
  const oct31 = new Date('2026-10-31T06:00:00Z');
  await saveSplit('asha', { amounts: { FUEL: R(2500), INTERNET: R(1000) }, acknowledged: true, effectiveFrom: '2026-10' }, oct10);
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $set: { flexiblePoolPaise: R(5000) } });
  await saveSplit('asha', { amounts: { FUEL: R(3000), INTERNET: R(1000) }, acknowledged: true, effectiveFrom: '2026-11' }, oct31);

  const nov5 = new Date('2026-11-05T06:00:00Z');
  const h = await splitForHr('hr', 'asha', FY, nov5);
  check('HR: three versions, oldest first', h.versions.map((v) => v.effectiveFrom).join() === '2026-07,2026-10,2026-11', h.versions.map((v) => v.effectiveFrom));
  check('HR: each runs until the next one starts, the last to March',
    h.versions.map((v) => v.effectiveTo).join() === '2026-09,2026-10,2027-03', h.versions.map((v) => v.effectiveTo));
  check('HR: on 5 Nov the November split is in force', h.current?.effectiveFrom === '2026-11' && h.current.inForce && h.versions.filter((v) => v.inForce).length === 1 && h.asOf === '2026-11', h.current);
  const [jul, oct, nov] = h.versions;
  check('HR: components with amount and limit', JSON.stringify(nov.components) === JSON.stringify([
    { code: 'FUEL', name: 'Fuel & vehicle', amountPaise: R(3000), limitPaise: R(3000) },
    { code: 'INTERNET', name: 'Internet', amountPaise: R(1000), limitPaise: R(1000) },
  ]), nov.components);
  check('HR: each version keeps the pool it was saved against (₹4,000, then ₹5,000)', oct.poolPaise === R(4000) && oct.poolSource === 'saved' && nov.poolPaise === R(5000)
    && oct.assignedPaise === R(3500) && oct.unassignedPaise === R(500), [oct, nov]);
  check('HR: a split saved before pools were kept shows today\'s pool, and says so', jul.poolPaise === R(5000) && jul.poolSource === 'current_template', jul);
  check('HR: submittedAt is when it was saved', oct.submittedAt === oct10.toISOString() && nov.submittedAt === oct31.toISOString(), [oct.submittedAt, nov.submittedAt]);
  check('HR: today\'s pool, the template, and the baseline', h.poolPaise === R(5000) && h.template?.code === 'FLEX' && h.baseline.map((b) => b.amountPaise).join() === [R(1500), R(500)].join(), h);
  check('HR: on 20 Oct the October split was in force', (await splitForHr('hr', 'asha', FY, oct20)).current?.effectiveFrom === '2026-10');
  const past = await splitForHr('hr', 'asha', '2025-26', nov5);
  check('HR: another FY has its own (none here)', past.versions.length === 0 && past.current === null && past.fy === '2025-26', past);
  check('HR: someone with Salary details only may read it', (await splitForHr('hrpay', 'asha', FY, nov5)).versions.length === 3);
  check('HR: no payroll access (403)', (await refusal(() => splitForHr('hrleave', 'asha', FY, nov5)))?.status === 403);
  check('HR: an employee cannot read someone else\'s, nor their own here (403)', (await refusal(() => splitForHr('asha', 'asha', FY, nov5)))?.status === 403);
  check('HR: another company\'s HR (404)', (await refusal(() => splitForHr('ohr', 'asha', FY, nov5)))?.status === 404);
  check('HR: someone of another company (404)', (await refusal(() => splitForHr('hr', 'omar', FY, nov5)))?.status === 404);
  check('HR: no such person (404)', (await refusal(() => splitForHr('hr', 'nobody', FY, nov5)))?.status === 404);
  check('HR: a bad fy (400)', (await refusal(() => splitForHr('hr', 'asha', '2026-28', nov5)))?.status === 400);
  const noStructure = await splitForHr('hr', 'bala', FY, nov5);
  check('HR: someone without a structure reads as such, not an error', noStructure.hasSalaryStructure === false && noStructure.versions.length === 0 && noStructure.poolPaise === null, noStructure);

  // —— missing punches: fix by the shift policy's correction window ——
  const orgPolicy = await getOrgShiftPolicy(ORG);
  check('(the org policy allows corrections 7 days back)', orgPolicy.correction.backdateDays === 7, orgPolicy.correction.backdateDays);
  const template = (name: string, userId: string, correction: Record<string, unknown>) => ({
    org: ORG, name, active: true, assignedUserIds: [userId], createdAt: now, updatedAt: now,
    policy: { ...orgPolicy, correction: { ...orgPolicy.correction, ...correction } },
  });
  await shiftTemplates().insertMany([
    template('Three days', 'bala', { backdateDays: 3 }),
    template('No corrections', 'chetan', { triggers: [] }),
    template('No window', 'devi', { backdateDays: 0 }),
  ] as never[]);
  // Nobody has assignment history: the template that lists them governs.
  await attendanceRecords().insertOne({ userId: 'asha', employeeId: 'E-ASHA', workDate: '2026-10-16', punchIn: new Date('2026-10-16T04:30:00Z'), createdAt: now, updatedAt: now } as never);
  await attendanceRegularizations().insertOne({
    userId: 'asha', employeeId: 'E-ASHA', managerUserId: 'hr', workDate: '2026-10-19', kind: 'correction', requestedDayType: 'full_day', status: 'pending', createdAt: now, updatedAt: now,
  } as never);

  const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const a = await myMissingPunches('asha', '2026-10', oct20);
  check('(Asha has missed days listed this month)', a.days.length > 5, a.days.length);
  check('Asha (7 days): each day can be fixed until 7 days after it', a.days.every((d) => d.fixBy === addDays(d.date, 7)), a.days.map((d) => [d.date, d.fixBy]));
  check('Asha: on 20 Oct days from 13 Oct on can be fixed, earlier ones are past their window',
    a.days.every((d) => d.canFix === (d.date >= '2026-10-13') && (d.canFix ? d.closedReason === null : d.closedReason === 'window_closed' && d.closedMessage !== null)),
    a.days.map((d) => [d.date, d.canFix, d.closedReason]));
  const d16 = a.days.find((d) => d.date === '2026-10-16');
  check('Asha: 16 Oct is a missing punch-out, fixable until 23 Oct', d16?.trigger === 'Missing punch-out' && d16.canFix && d16.fixBy === '2026-10-23', d16);
  const fixable = a.days.filter((d) => d.canFix && !d.request);
  check('Asha: the count is the fixable days without a pending request (19 Oct has one)',
    a.count === fixable.length && a.days.find((d) => d.date === '2026-10-19')?.request?.status === 'pending' && !fixable.some((d) => d.date === '2026-10-19'), [a.count, fixable.map((d) => d.date)]);
  check('Asha: the month\'s fix-by is the earliest among them', a.fixBy === fixable.map((d) => d.fixBy!).sort()[0], [a.fixBy, fixable.map((d) => d.fixBy)]);
  const aHome = await myPayrollHome('asha', '2026-10', oct20);
  const aTodo = aHome.appEnabled ? aHome.todo.find((t) => t.kind === 'missing_punches') : undefined;
  check('home: Asha\'s to-do counts only fixable days, due by the earliest fix-by', aTodo?.count === a.count && aTodo?.dueOn === a.fixBy, aTodo);

  const b = await myMissingPunches('bala', '2026-10', oct20);
  check('Bala (3 days): fix by 3 days after each day', b.days.length > 0 && b.days.every((d) => d.fixBy === addDays(d.date, 3)), b.days.map((d) => [d.date, d.fixBy]));
  check('Bala: only days from 17 Oct on can still be fixed', b.days.every((d) => d.canFix === (d.date >= '2026-10-17')) && b.count === b.days.filter((d) => d.date >= '2026-10-17').length, b.days.map((d) => [d.date, d.canFix]));
  check('Bala: due by the earliest, 3 days after his first fixable day', b.fixBy === addDays(b.days.find((d) => d.canFix)!.date, 3), b.fixBy);

  const c = await myMissingPunches('chetan', '2026-10', oct20);
  check('Chetan (corrections off): nothing fixable, no fix-by', c.days.length > 0 && c.count === 0 && c.fixBy === null && c.days.every((d) => !d.canFix && d.closedReason === 'corrections_off' && d.fixBy === null), c.days.slice(0, 2));
  const cHome = await myPayrollHome('chetan', '2026-10', oct20);
  check('home: Chetan has no missing-punches to-do', cHome.appEnabled === true && !cHome.todo.some((t) => t.kind === 'missing_punches'), cHome.appEnabled && cHome.todo);
  const d = await myMissingPunches('devi', '2026-10', oct20);
  check('Devi (a 0-day window): nothing fixable', d.days.length > 0 && d.count === 0 && d.days.every((x) => !x.canFix && x.closedReason === 'corrections_off'), d.days.slice(0, 2));

  // A locked month closes every day of it, even inside the window.
  await payrollRuns().insertOne({ org: ORG, period: '2026-10', runType: 'regular', status: 'pending_approval', employeeCount: 0, totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now } as never);
  const locked = await myMissingPunches('asha', '2026-10', oct20);
  check('locked October: nothing fixable, the days in the window say payroll locked',
    locked.locked && locked.count === 0 && locked.fixBy === null && locked.days.every((x) => !x.canFix)
    && locked.days.filter((x) => x.date >= '2026-10-13').every((x) => x.closedReason === 'payroll_locked'), locked.days.map((x) => [x.date, x.closedReason]));
  const lHome = await myPayrollHome('asha', '2026-10', oct20);
  check('home: no missing-punches to-do for a locked month', lHome.appEnabled === true && !lHome.todo.some((t) => t.kind === 'missing_punches'), lHome.appEnabled && lHome.todo);
  await payrollRuns().updateOne({ period: '2026-10' }, { $set: { status: 'draft' } });
  check('a draft run does not lock it', (await myMissingPunches('asha', '2026-10', oct20)).count === a.count);

  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} payroll dashboard checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
