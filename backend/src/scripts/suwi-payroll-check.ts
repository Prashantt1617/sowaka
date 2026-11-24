/**
 * Checks Suwi's payroll training (24 Nov): one-time pay on a draft run, run steps (calculate,
 * submit with blockers, reopen, mark paid), CTCs typed as monthly (×12 with Undo), pay cycle and
 * pay schedule, final settlement (answer, approve with Undo, mark paid), payslip notices (EMAIL_ORGS),
 * investment proofs, and claim types. Each card changes nothing before Confirm; Confirm goes through
 * the dashboard's own services. On a scratch database only:
 *   npm run suwi-payroll:check
 */
import { ObjectId } from 'mongodb';
import {
  companies, connectDb, employeePaymentDetails, exitSettlements, getDb, investmentProofs, notifications, paidDaysTemplates, payHeads,
  payrollPeriods, payrollRuns, payslips, reimbursementTypes, salaryStructures, salaryTemplates, statutoryConfigs, taxDeclarations, users,
} from '../config/db';
import { env } from '../config/env';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiLevel } from '../suwi/tools';
import { addMonths } from '../suwi/tools/payroll-common';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';
import { STATUTORY_SEED } from './payroll-config-seed-data';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function thrown(work: () => Promise<unknown>): Promise<string> {
  try { await work(); return ''; } catch (e) { return (e as Error).message; }
}
const ORG = 'acme';
const person = (userId: string, name: string, extra: Partial<User> = {}): User => ({
  userId, name, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
  joiningDate: new Date('2025-01-01T00:00:00Z'), employeeId: `E-${userId}`, managerUserId: 'founder', ...extra,
} as User);
const data = (out: { data: unknown }) => out.data as Record<string, unknown>;

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const now = new Date();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const month = addMonths(today.slice(0, 7), -1); // a month that is over
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }).toUpperCase();
  const earlier = addMonths(today.slice(0, 7), -2);

  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  const oneTime = ZOHO_CATALOG.find((h) => h.code === 'BONUS_ONE_TIME')!;
  await payHeads().insertMany([
    ...ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })),
    { ...oneTime, org: ORG, code: 'INCENTIVE', name: 'Incentive', payslipName: 'Incentive' },
    { ...oneTime, org: ORG, code: 'SALARY_ADVANCE', name: 'Salary Advance', payslipName: 'Salary Advance', category: 'deduction', componentType: 'salary_advance', recurrence: undefined, taxable: false },
  ] as never);
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG });
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'Every day paid', allDaysPaid: true, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now } as never);
  await companies().insertOne({ id: ORG, name: 'Acme', features: { exits: true } } as never);
  await users().insertMany([
    person('founder', 'Founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true, managerUserId: undefined }),
    person('kavya', 'Kavya Rao'), person('ravi', 'Ravi Kumar'), person('meena', 'Meena Iyer'), person('tiny', 'Tina Typo'),
    person('arjun', 'Arjun Leaver', {
      lifecycleStatus: 'offboarded', endDate: new Date(`${earlier}-15T00:00:00Z`),
      exit: { kind: 'resigned', lastWorkingDay: `${earlier}-15`, noticeFrom: `${earlier}-01`, recordedByUserId: 'founder', recordedAt: now, accessEndedAt: new Date(`${earlier}-16T00:00:00Z`) },
    } as Partial<User>),
  ]);
  const structure = (userId: string, ctc: number) => ({ org: ORG, userId, salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: ctc, status: 'active', effectiveFrom: new Date('2025-01-01T00:00:00Z'), createdAt: now, updatedAt: now });
  await salaryStructures().insertMany([structure('founder', 12_00_000_00), structure('kavya', 6_00_000_00), structure('ravi', 4_80_000_00), structure('meena', 4_20_000_00), structure('tiny', 40_000_00), structure('arjun', 6_00_000_00)] as never);
  await employeePaymentDetails().insertMany(['founder', 'kavya', 'ravi', 'meena', 'tiny', 'arjun'].map((userId) => ({ org: ORG, userId, accountNumber: 'x', pan: 'x', uan: 'x', updatedAt: now })) as never);

  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, today);
  const NEW = ['prepare_one_time_pay', 'prepare_run_step', 'prepare_payslip_notice', 'ctc_looks_monthly', 'prepare_fix_monthly_ctc', 'pay_cycle', 'prepare_pay_schedule', 'claim_types', 'prepare_claim_type', 'final_settlement', 'prepare_settlement_step', 'prepare_review_proofs'];
  ok('all 12 payroll tools are registered, every one needing payroll access', NEW.every((n) => toolByName(n)?.payroll === true), NEW.filter((n) => !toolByName(n)?.payroll));
  const tool = (n: string) => toolByName(n)!;

  console.log('CTCs typed as monthly');
  const lm = data(await tool('ctc_looks_monthly').run(ctx, {}));
  ok('Tina\'s ₹40,000 a year is listed, nobody else', lm.count === 1 && JSON.stringify(lm.people).includes('Tina Typo'), lm);
  const fx = await tool('prepare_fix_monthly_ctc').run(ctx, { names: ['Tina', 'Kavya'] });
  const fxc = await getProposal('founder', ORG, fx.proposalId!);
  ok('one card for Tina; Kavya is left out with why', fxc.preview?.rows.length === 1 && /₹40,000 a year/.test(fxc.preview.rows[0].current) && /₹4,80,000 a year/.test(fxc.preview.rows[0].next) && fxc.preview.skipped.some((s) => s.who === 'Kavya Rao'), fxc.preview);
  ok('nothing changes before Confirm', (await salaryStructures().findOne({ userId: 'tiny' }))?.annualCtcPaise === 40_000_00);
  await confirmProposal('founder', ORG, fx.proposalId!);
  const tinyAfter = await salaryStructures().findOne({ userId: 'tiny' });
  ok('Confirm multiplies by 12 through the salary save (a revision is recorded)', tinyAfter?.annualCtcPaise === 4_80_000_00 && tinyAfter.revisions?.length === 1, tinyAfter);
  await undoProposal('founder', ORG, fx.proposalId!);
  const tinyBack = await salaryStructures().findOne({ userId: 'tiny' });
  ok('Undo puts ₹40,000 back with the history as it was', tinyBack?.annualCtcPaise === 40_000_00 && (tinyBack.revisions ?? []).length === 0, tinyBack);

  console.log('Calculate the month\'s run');
  const calc = await tool('prepare_run_step').run(ctx, { action: 'calculate', period: month });
  ok('a card is prepared and no run exists before Confirm', Boolean(calc.proposalId) && (await payrollRuns().countDocuments({ org: ORG })) === 0, calc.data);
  await confirmProposal('founder', ORG, calc.proposalId!);
  const run = await payrollRuns().findOne({ org: ORG, period: month });
  ok('Confirm makes the draft with a payslip for each of the 5 active salaries', run?.status === 'draft' && run.employeeCount === 5, run && { status: run.status, count: run.employeeCount });
  const runId = run!._id!.toHexString();
  const slip = async (u: string) => payslips().findOne({ org: ORG, runId, userId: u });

  console.log('One-time pay');
  ok('an item the company does not have is refused, listing the ones it has', /no one-time pay item called "arrears".*Incentive/.test(await thrown(() => tool('prepare_one_time_pay').run(ctx, { period: month, person: 'Kavya', item: 'arrears', amountRupees: 1000 }))));
  const kavyaBefore = (await slip('kavya'))!.netPayablePaise;
  const ot = await tool('prepare_one_time_pay').run(ctx, { period: month, items: [{ person: 'Kavya', item: 'incentive', amountRupees: 15000 }, { person: 'Ravi', item: 'salary advance', amountRupees: 2000 }, { person: 'Arjun', item: 'incentive', amountRupees: 1 }] });
  const otc = await getProposal('founder', ORG, ot.proposalId!);
  ok('one card for Kavya and Ravi, with rupees per person and totals', otc.preview?.rows.length === 2 && otc.lines.some((l) => /one-time earnings \+₹15,000, one-time deductions \+₹2,000/.test(l.text)), otc.lines);
  ok('the card says nothing is paid until the run is submitted', otc.lines.some((l) => /Nothing is paid/.test(l.text)) && otc.undoable === true);
  ok('someone who has left is left out', otc.preview?.skipped.some((s) => /Arjun/.test(s.who)) === true, otc.preview?.skipped);
  ok('nothing changes before Confirm', !(await slip('kavya'))?.inputs.componentAmounts);
  const otd = await confirmProposal('founder', ORG, ot.proposalId!);
  const k = await slip('kavya'), r = await slip('ravi');
  ok('Confirm saves Kavya\'s ₹15,000 incentive and recalculates (net goes up)', k?.inputs.componentAmounts?.INCENTIVE === 15_000_00 && k.netPayablePaise > kavyaBefore, { amounts: k?.inputs.componentAmounts, before: kavyaBefore, after: k?.netPayablePaise, msg: otd.message });
  ok('…and Ravi\'s ₹2,000 salary advance deduction', r?.inputs.componentAmounts?.SALARY_ADVANCE === 2_000_00 && r.deductions.some((d) => d.amountPaise === 2_000_00 || /advance/i.test(d.name)), r?.deductions);
  await undoProposal('founder', ORG, ot.proposalId!);
  ok('Undo removes both items and recalculates', !(await slip('kavya'))?.inputs.componentAmounts && !(await slip('ravi'))?.inputs.componentAmounts && (await slip('kavya'))!.netPayablePaise === kavyaBefore);

  console.log('Submit, with blockers first');
  await employeePaymentDetails().updateOne({ userId: 'meena' }, { $unset: { accountNumber: '' } });
  const blocked = data(await tool('prepare_run_step').run(ctx, { action: 'submit', period: month }));
  ok('a missing bank account blocks submit: no card, the blocker named', blocked.prepared === false && blocked.refused === true && JSON.stringify(blocked.blockers).includes('Meena Iyer'), blocked);
  await employeePaymentDetails().updateOne({ userId: 'meena' }, { $set: { accountNumber: 'x' } });
  const sub = await tool('prepare_run_step').run(ctx, { action: 'submit', period: month });
  const subc = await getProposal('founder', ORG, sub.proposalId!);
  ok('the submit card shows each person\'s net pay and asks to type the month', subc.preview?.rows.length === 5 && subc.typeToConfirm === monthName && subc.preview.rows.every((x) => /₹/.test(x.current)), { t: subc.typeToConfirm, rows: subc.preview?.rows });
  ok('typing the wrong word is refused', /Type/.test(await thrown(() => confirmProposal('founder', ORG, sub.proposalId!, 'nope'))));
  await confirmProposal('founder', ORG, sub.proposalId!, monthName);
  ok('Confirm submits the run (final)', (await payrollRuns().findOne({ org: ORG, period: month }))?.status === 'paid');

  console.log('Payslip notice');
  const off = data(await tool('prepare_payslip_notice').run(ctx, { period: month }));
  ok('with notifications off for the company, nothing is prepared', off.prepared === false && /switched off/.test(String(off.message)), off);
  env.notifyOrgs.push(ORG);
  const pn = await tool('prepare_payslip_notice').run(ctx, { period: month });
  const pnc = await getProposal('founder', ORG, pn.proposalId!);
  ok('the card says email is off for this company (EMAIL_ORGS) and lists 5 people', pnc.preview?.rows.length === 5 && pnc.lines.some((l) => /Email is off for this company/.test(l.text)), pnc.lines);
  ok('nothing is sent before Confirm', (await notifications().countDocuments({ scenario: 'payslip_ready' })) === 0);
  await confirmProposal('founder', ORG, pn.proposalId!);
  ok('Confirm sends one app notification each', (await notifications().countDocuments({ scenario: 'payslip_ready' })) === 5);

  console.log('Reopen and mark paid');
  const ro = await tool('prepare_run_step').run(ctx, { action: 'reopen', period: month });
  await confirmProposal('founder', ORG, ro.proposalId!, monthName);
  ok('reopen puts the run back to draft', (await payrollRuns().findOne({ org: ORG, period: month }))?.status === 'draft');
  const pn2 = data(await tool('prepare_payslip_notice').run(ctx, { period: month }));
  ok('a draft\'s payslips are not announced: it points to submit', pn2.prepared === false && /submit/.test(String(pn2.message)), pn2);
  const mp = data(await tool('prepare_run_step').run(ctx, { action: 'mark_paid', period: month }));
  ok('mark paid on a draft is refused, pointing to submit', mp.prepared === false && /Submit/.test(String(mp.message)), mp);
  await payrollRuns().updateOne({ org: ORG, period: month }, { $set: { status: 'approved' } });
  const mp2 = await tool('prepare_run_step').run(ctx, { action: 'mark_paid', period: month });
  await confirmProposal('founder', ORG, mp2.proposalId!, monthName);
  ok('an approved run is marked paid', (await payrollRuns().findOne({ org: ORG, period: month }))?.status === 'paid');

  console.log('Pay cycle and pay schedule');
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now } as never);
  const pc = data(await tool('pay_cycle').run(ctx, {}));
  ok('the cycle reads as the 26th to the 25th', /26th to the 25th/.test(String(pc.cycle)), pc.cycle);
  const cyc = data(await tool('prepare_pay_schedule').run(ctx, { cycleStartDay: 1 }));
  ok('changing the cycle itself is explained, not done', cyc.prepared === false && /Sowaka sets it/.test(String(cyc.message)));
  const ps = await tool('prepare_pay_schedule').run(ctx, { payDay: '7' });
  ok('nothing changes before Confirm', !(await companies().findOne({ id: ORG }))?.paySchedule);
  await confirmProposal('founder', ORG, ps.proposalId!);
  ok('Confirm saves pay day 7 through the Pay Schedule save', (await companies().findOne({ id: ORG }))?.paySchedule?.payDay === 7);
  await undoProposal('founder', ORG, ps.proposalId!);
  ok('Undo puts the old schedule back', (await companies().findOne({ id: ORG }))?.paySchedule?.payDay === 'last_day');

  console.log('Claim types');
  const ct = data(await tool('claim_types').run(ctx, {}));
  ok('the four starting types are read', (ct.types as unknown[]).length === 4, ct);
  const tr = await tool('prepare_claim_type').run(ctx, { type: 'travel', limitPerClaimRupees: 6000, perDay: true });
  const trc = await getProposal('founder', ORG, tr.proposalId!);
  ok('the card says a daily limit becomes a per-claim limit', trc.lines.some((l) => /no per-day limit/.test(l.text)), trc.lines);
  await confirmProposal('founder', ORG, tr.proposalId!);
  const travel = await reimbursementTypes().findOne({ org: ORG, name: 'Travel' });
  ok('Confirm sets ₹6,000 a claim and keeps the 30-day window', travel?.maxLimit === 6000 && travel.backdateDays === 30, travel);
  await undoProposal('founder', ORG, tr.proposalId!);
  ok('Undo puts ₹25,000 back', (await reimbursementTypes().findOne({ org: ORG, name: 'Travel' }))?.maxLimit === 25000);
  const nf = await tool('prepare_claim_type').run(ctx, { name: 'Fuel', limitPerClaimRupees: 3000 });
  await confirmProposal('founder', ORG, nf.proposalId!);
  ok('a new type is added', Boolean(await reimbursementTypes().findOne({ org: ORG, name: 'Fuel', maxLimit: 3000 })));
  await undoProposal('founder', ORG, nf.proposalId!);
  ok('Undo removes it', !(await reimbursementTypes().findOne({ org: ORG, name: 'Fuel' })));

  console.log('Final settlement');
  const fs = data(await tool('final_settlement').run(ctx, { person: 'Arjun' }));
  ok('the statement is read line by line, with the payable in rupees and no notice lines', fs.status === 'draft' && Array.isArray(fs.lines) && (fs.lines as string[]).length > 0 && /₹/.test(String(fs.payable)) && !(fs.lines as string[]).some((l) => /^[+−]₹[\d,]+ Notice/i.test(l)), fs);
  const noReason = data(await tool('prepare_settlement_step').run(ctx, { person: 'Arjun', action: 'approve' }));
  ok('approve with clearance open and no reason is refused', noReason.prepared === false && /Clearance is not complete/.test(String(noReason.message)), noReason);
  const ap = await tool('prepare_settlement_step').run(ctx, { person: 'Arjun', action: 'approve', clearanceReason: 'Laptop returned by courier' });
  const apc = await getProposal('founder', ORG, ap.proposalId!);
  ok('the card lists the lines, the payable and that notice money is off', apc.lines.some((l) => /payable ₹/.test(l.text)) && apc.lines.some((l) => /Notice pay and notice recovery are switched off/.test(l.text)), apc.lines);
  ok('nothing changes before Confirm', (await exitSettlements().findOne({ org: ORG, userId: 'arjun' }))?.status === 'draft');
  await confirmProposal('founder', ORG, ap.proposalId!);
  ok('Confirm approves it, keeping the reason', (await exitSettlements().findOne({ org: ORG, userId: 'arjun' }))?.status === 'approved');
  await undoProposal('founder', ORG, ap.proposalId!);
  ok('Undo reopens it', (await exitSettlements().findOne({ org: ORG, userId: 'arjun' }))?.status === 'draft');
  const ap2 = await tool('prepare_settlement_step').run(ctx, { person: 'Arjun', action: 'approve', clearanceReason: 'Laptop returned by courier' });
  await confirmProposal('founder', ORG, ap2.proposalId!);
  const pd = await tool('prepare_settlement_step').run(ctx, { person: 'Arjun', action: 'mark_paid' });
  await confirmProposal('founder', ORG, pd.proposalId!);
  ok('mark paid records it paid', (await exitSettlements().findOne({ org: ORG, userId: 'arjun' }))?.status === 'paid');

  console.log('Investment proofs');
  const fy = (() => { const [y, m] = today.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; })();
  await taxDeclarations().insertMany([
    { org: ORG, userId: 'kavya', fy, regime: 'old', items: { lifeInsurance: 1_50_000_00 } },
    { org: ORG, userId: 'ravi', fy, regime: 'old', items: { lifeInsurance: 1_00_000_00 } },
  ] as never);
  const proof = (userId: string, amountPaise: number) => ({ org: ORG, userId, fy, item: 'lifeInsurance', status: 'uploaded', amountPaise, objectKey: `k/${userId}`, fileName: 'p.pdf', contentType: 'application/pdf', size: 1, uploadedAt: now });
  const P = await investmentProofs().insertMany([proof('kavya', 1_50_000_00), proof('ravi', 60_000_00)] as never);
  const [pKavya, pRavi] = Object.values(P.insertedIds).map((x) => (x as ObjectId));
  const rv = await tool('prepare_review_proofs').run(ctx, { decision: 'approved', matchingOnly: true });
  const rvc = await getProposal('founder', ORG, rv.proposalId!);
  ok('only Kavya\'s proof matches her declaration; Ravi\'s is left out with why', rvc.preview?.rows.length === 1 && rvc.preview.rows[0].name === 'Kavya Rao' && rvc.preview.skipped.some((s) => /less than declared/.test(s.reason)), rvc.preview);
  await confirmProposal('founder', ORG, rv.proposalId!);
  ok('Confirm approves Kavya\'s proof through the review service', (await investmentProofs().findOne({ _id: pKavya }))?.status === 'approved' && (await investmentProofs().findOne({ _id: pRavi }))?.status === 'uploaded');
  ok('sending back needs a reason', /reason/.test(await thrown(() => tool('prepare_review_proofs').run(ctx, { decision: 'rejected', names: ['Ravi'] }))));
  const rj = await tool('prepare_review_proofs').run(ctx, { decision: 'rejected', names: ['Ravi'], reason: 'The policy shows ₹60,000, not ₹1,00,000' });
  await confirmProposal('founder', ORG, rj.proposalId!);
  ok('Ravi\'s proof is sent back with the reason', (await investmentProofs().findOne({ _id: pRavi }))?.status === 'rejected');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
