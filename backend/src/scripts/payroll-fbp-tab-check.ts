/**
 * Scratch-database check of FBP as its own thing, apart from reimbursements
 * (dashboard Payroll › FBP requests and FBP splits):
 *
 * - FBP bills (claims of a type linked to an FBP head) are on FBP requests
 *   only: not on Reimbursement requests, the manager's inbox, the person's
 *   own claims, nor the reimbursement counts; the app's claim picker leaves
 *   out FBP bill types and a claim of one is refused.
 * - HR approves, or rejects with a required reason (the app shows it).
 * - FBP splits: each person's pool, heads, unassigned, declared, bills
 *   approved against months due, and what is not set up.
 * - The payroll run: FBP heads paid as salary at the split; an approved bill
 *   never paid out; approved bills make that much of the head tax-free;
 *   unbilled FBP stays taxable; an ordinary reimbursement is paid on top.
 *
 * It drops and recreates its own database, and refuses any other. Test data
 * is the `sowaka` org with invented people and amounts. Run with
 *   npm run payroll:fbp-tab-check
 */
import { ObjectId } from 'mongodb';
import {
  companies, connectDb, flexibleSplits, getDb, payHeads, payslips, reimbursementClaims, reimbursementTypes, salaryStructures, salaryTemplates,
  shiftPolicies, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import { env } from '../config/env';
import { tabsForRequest } from '../models/dashboard-tabs';
import { PayHead } from '../models/payHead.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { myFbpHead } from '../services/employeePayroll.fbp';
import { decideFbpRequest, fbpPendingCount, fbpRequestsForAdmin, fbpSplitsForAdmin } from '../services/fbpAdmin.service';
import { createRun, recomputeRun } from '../services/payrollRun.service';
import { payrollDashboard } from '../services/payrollReports.service';
import { listClaimableReimbursementTypes, listReimbursementTypes } from '../services/reimbursement-type.service';
import {
  createReimbursementClaim, getManagerReimbursementInbox, getMyReimbursementClaims, listAllReimbursementsForAdmin,
} from '../services/reimbursement.service';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

const SCRATCH = 'payroll_fbp_tab_scratch';
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

  const now = new Date();
  await companies().insertMany([
    { id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31', splitDue: '11-15', fbpBillsDueDay: 20, splitStepPaise: R(500) } },
    { id: 'otherco', name: 'Other (scratch)' },
  ] as never[]);
  await shiftPolicies().insertOne({ org: ORG, correction: { punchFormat: 'Geotag (powered by Sowaka)' } } as never);
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('hrpay', 'Pavan Payroll', { dashboardAccess: true, dashboardTabs: ['payruns'] }),
    person('hrclaims', 'Chitra Claims', { dashboardAccess: true, dashboardTabs: ['reimbursements', 'reimbursementtypes'] }),
    person('asha', 'Asha Test', { department: 'Design' }),
    person('bala', 'Bala Test', { department: 'Sales' }),
    { ...person('ohr', 'Other HR', { dashboardAccess: true, dashboardAdmin: true }), org: 'otherco' },
  ] as never[]);
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, taxable: true }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, taxable: true }),
    head({ code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel & vehicle', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(3000), fbp: true }),
    head({ code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1000), fbp: true }),
    head({ code: 'TELEPHONE', name: 'Telephone Reimbursement', payslipName: 'Telephone', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1500), fbp: true }),
  ]);
  const flat = (code: string) => ({ payHeadCode: code, calculation: { mode: 'flat_amount' as const } });
  const basic = { payHeadCode: 'BASIC', calculation: { mode: 'percentage' as const, percent: 50, base: 'ctc' as const } };
  await salaryTemplates().insertMany([
    { org: ORG, name: 'Flexible', code: 'FLEX', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE', flexiblePoolPaise: R(5000),
      components: [basic, ...['FIXED_ALLOWANCE', 'FUEL', 'INTERNET', 'TELEPHONE'].map(flat)] },
    { org: ORG, name: 'Flexible, no pool', code: 'NOPOOL', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
      components: [basic, flat('FIXED_ALLOWANCE'), flat('FUEL')] },
  ] as never[]);
  // ₹24 lakh a year: above the rebate, so tax moves with taxable income.
  await salaryStructures().insertMany([
    { org: ORG, userId: 'asha', salaryTemplateCode: 'FLEX', annualCtcPaise: R(24_00_000), componentValues: { FUEL: R(2000), INTERNET: R(1000), TELEPHONE: 0 }, status: 'active', createdAt: now, updatedAt: now },
    { org: ORG, userId: 'bala', salaryTemplateCode: 'NOPOOL', annualCtcPaise: R(12_00_000), componentValues: { FUEL: R(1500) }, status: 'active', createdAt: now, updatedAt: now },
  ] as never[]);
  // Fuel and Internet take bills; Telephone has no bill type; Travel is an ordinary expense.
  await reimbursementTypes().insertMany([
    { org: ORG, name: 'Fuel', maxLimit: 3000, backdateDays: 30, payHeadCode: 'FUEL', active: true, createdAt: now, updatedAt: now },
    { org: ORG, name: 'Internet', maxLimit: 0, backdateDays: 30, payHeadCode: 'INTERNET', active: true, createdAt: now, updatedAt: now },
    { org: ORG, name: 'Travel', maxLimit: 0, backdateDays: 3650, active: true, createdAt: now, updatedAt: now },
  ] as never[]);
  // Asha's split from April: Fuel ₹3,000, Internet ₹1,000, Telephone ₹1,000 (all ₹5,000 of the pool).
  await flexibleSplits().insertOne({
    org: ORG, userId: 'asha', fy: '2026-27', effectiveFrom: '2026-04', amounts: { FUEL: R(3000), INTERNET: R(1000), TELEPHONE: R(1000) },
    acknowledged: true, billsAcknowledgedAt: new Date('2026-04-05T06:00:00Z'), submittedAt: new Date('2026-04-05T06:00:00Z'), poolPaise: R(5000),
  });
  const claim = (category: string, status: ReimbursementClaim['status'], amount: number, extra: Partial<ReimbursementClaim> = {}): ReimbursementClaim => ({
    userId: 'asha', managerUserId: 'hr', expenseDate: new Date('2026-04-30T00:00:00Z'), amount, category,
    receiptName: `${category}-apr.jpg`, receiptObjectKey: `fake/receipts/asha/${category}-apr`, receiptContentType: 'image/jpeg', status,
    createdAt: new Date('2026-04-30T06:00:00Z'), updatedAt: new Date('2026-04-30T06:00:00Z'),
    ...(status !== 'pending' ? { decidedAt: new Date('2026-05-02T06:00:00Z'), decidedByUserId: 'hr', decidedByRole: 'admin' as const } : {}),
    ...extra,
  });
  const ids = (await reimbursementClaims().insertMany([
    claim('fuel', 'approved', 3000),
    claim('internet', 'pending', 1000),
    claim('travel', 'approved', 1500, { expenseDate: new Date('2026-04-15T00:00:00Z') }),
  ])).insertedIds;
  const fuelBill = ids[0].toHexString();
  const internetBill = ids[1].toHexString();
  const travel = ids[2].toHexString();
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  await statutorySettings().insertOne({ org: ORG, tds: { enabled: true, defaultRegime: 'new' }, updatedAt: now } as never);
  const may10 = new Date('2026-05-10T06:00:00Z');

  // —— FBP bills are not reimbursement requests ——
  const admin = await listAllReimbursementsForAdmin('hr');
  check('Reimbursement requests: the Travel claim only, no FBP bill', admin.length === 1 && admin[0].id === travel, admin.map((c) => c.category));
  check('Asha\'s own claims: Travel only (her bills are on the FBP page)', (await getMyReimbursementClaims('asha')).map((c) => c.id).join() === travel);
  check('the manager\'s inbox: Travel only', (await getManagerReimbursementInbox('hr')).map((c) => c.id).join() === travel);
  check('the app\'s claim picker: Travel only', (await listClaimableReimbursementTypes('asha')).map((t) => t.name).join() === 'Travel');
  check('Reimbursement Types (dashboard) still lists all three, with the links', (await listReimbursementTypes('hr')).filter((t) => t.payHeadCode).length === 2);
  const asClaim = await refusal(() => createReimbursementClaim('asha', { expenseDate: '2026-04-20', amount: 500, category: 'Fuel' }));
  check('a claim of an FBP bill type is refused (400), pointing to the FBP page', asClaim?.status === 400 && /Payroll › FBP/.test(asClaim.message ?? ''), asClaim);
  const dash = await payrollDashboard('hr', undefined, {});
  check('Payroll dashboard to-do: 0 reimbursement claims pending, 1 FBP bill', dash.todo.pendingClaims === 0 && dash.todo.pendingFbpBills === 1, dash.todo);

  // —— FBP requests ——
  const req = await fbpRequestsForAdmin('hr', '2026-27', may10);
  check('FBP requests: the two bills, with counts per status', req.requests.length === 2 && req.counts.pending === 1 && req.counts.approved === 1 && req.counts.rejected === 0, req.counts);
  const fuelRow = req.requests.find((r) => r.id === fuelBill);
  check('a row: employee, head, month, amount, uploaded, file', fuelRow?.employee.name === 'Asha Test' && fuelRow.headCode === 'FUEL' && fuelRow.headName === 'Fuel & vehicle'
    && fuelRow.period === '2026-04' && fuelRow.amountPaise === R(3000) && fuelRow.uploadedAt.startsWith('2026-04-30') && fuelRow.hasFile && fuelRow.fileName === 'fuel-apr.jpg', fuelRow);
  check('the sidebar count: 1 pending', (await fbpPendingCount('hr')) === 1);
  check('someone with Payroll Runs opens it', (await fbpRequestsForAdmin('hrpay', '2026-27', may10)).requests.length === 2);
  check('someone with only Reimbursements cannot (403)', (await refusal(() => fbpRequestsForAdmin('hrclaims', '2026-27', may10)))?.status === 403);
  check('another company sees none of them', (await fbpRequestsForAdmin('ohr', '2026-27', may10)).requests.length === 0);
  check('a FY with no bills: empty', (await fbpRequestsForAdmin('hr', '2025-26', may10)).requests.length === 0);
  check('tab rules: FBP requests open with fbprequests, payruns or salarydetails; splits with fbpsplits',
    JSON.stringify(tabsForRequest('POST', '/admin/payroll/fbp/requests/x/decision')) === JSON.stringify(['fbprequests', 'salarydetails', 'payruns'])
    && (tabsForRequest('GET', '/admin/payroll/fbp/splits') ?? []).includes('fbpsplits'));
  check('reject without a reason (400)', (await refusal(() => decideFbpRequest('hr', internetBill, { decision: 'reject' })))?.status === 400);
  check('a Travel claim is not an FBP bill (404)', (await refusal(() => decideFbpRequest('hr', travel, { decision: 'approve' })))?.status === 404);
  check('another company cannot decide it (404)', (await refusal(() => decideFbpRequest('ohr', internetBill, { decision: 'approve' })))?.status === 404);
  check('a decided bill cannot be decided again (409)', (await refusal(() => decideFbpRequest('hr', fuelBill, { decision: 'reject', reason: 'Wrong month' })))?.status === 409);

  // —— FBP splits ——
  const sp = await fbpSplitsForAdmin('hr', '2026-27', may10);
  const a = sp.rows.find((r) => r.userId === 'asha');
  const h = (code: string) => a?.heads.find((x) => x.code === code);
  check('splits: Asha and Bala (both on templates with FBP heads)', sp.rows.map((r) => r.userId).join() === 'asha,bala' && sp.asOf === '2026-05', sp.rows.map((r) => r.userId));
  check('Asha: pool ₹5,000, Fuel ₹3,000 · Internet ₹1,000 · Telephone ₹1,000, nothing unassigned',
    a?.poolPaise === R(5000) && h('FUEL')?.amountPaise === R(3000) && h('INTERNET')?.amountPaise === R(1000) && h('TELEPHONE')?.amountPaise === R(1000) && a.unassignedPaise === 0, a);
  check('Asha declared on 5 Apr, from April, bills noted then', a?.declared?.firstAt.startsWith('2026-04-05') === true && a.declared.effectiveFrom === '2026-04' && a.declared.changedAt === null && a.declared.billsAcknowledgedAt.startsWith('2026-04-05'), a?.declared);
  check('Fuel: 1 of 2 months approved (April; May not sent)', h('FUEL')?.bills.due === 2 && h('FUEL')?.bills.approved === 1 && h('FUEL')?.bills.missing === 1, h('FUEL'));
  check('Internet: 0 approved, 1 in review, of 2', h('INTERNET')?.bills.due === 2 && h('INTERNET')?.bills.approved === 0 && h('INTERNET')?.bills.inReview === 1, h('INTERNET'));
  check('Telephone: no bill type', h('TELEPHONE')?.billType === null && h('FUEL')?.billType === 'Fuel', h('TELEPHONE'));
  const b = sp.rows.find((r) => r.userId === 'bala');
  check('Bala: not declared, no pool on his template, the structure\'s Fuel ₹1,500', b?.declared === null && b.poolPaise === null && b.unassignedPaise === null && b.heads[0]?.amountPaise === R(1500), b);
  check('setup: Telephone has no bill type; "Flexible, no pool" has no pool', sp.setup.headsWithoutBillType.map((x) => x.code).join() === 'TELEPHONE' && sp.setup.templatesWithoutPool.map((t) => t.code).join() === 'NOPOOL', sp.setup);
  check('setup: the app rules read back (close 15 Nov, bills by the 20th, FY bills 31 Mar 2027)',
    sp.setup.rules.splitClosesOn === '2026-11-15' && sp.setup.rules.fbpBillsDueDay === 20 && sp.setup.rules.billsDueOn === '2027-03-31' && sp.setup.rules.splitStepPaise === R(500), sp.setup.rules);
  check('splits: departments to filter by', sp.departments.join() === 'Design,Sales', sp.departments);
  check('splits: only with payroll access (403 for Reimbursements only)', (await refusal(() => fbpSplitsForAdmin('hrclaims', '2026-27', may10)))?.status === 403);

  // —— the payroll run: FBP paid as salary, bills only make it tax-free ——
  const apr = await createRun('hr', { period: '2026-04', lopDays: { asha: 0, bala: 0 } });
  const slip1 = (await payslips().findOne({ runId: apr.run.id, userId: 'asha' }))!;
  const line = (code: string) => slip1.reimbursementLines?.find((l) => l.code === code)?.amountPaise ?? 0;
  check('FBP heads paid as salary at the split: Fuel ₹3,000, Internet ₹1,000, Telephone ₹1,000',
    line('FUEL') === R(3000) && line('INTERNET') === R(1000) && line('TELEPHONE') === R(1000), slip1.reimbursementLines);
  check('payout: only the Travel claim (₹1,500) is paid on top; the approved Fuel bill is not paid again',
    slip1.inputs?.reimbursementsPaise === R(1500) && (slip1.inputs?.reimbursementClaimIds ?? []).join() === travel, slip1.inputs?.reimbursementClaimIds);
  check('reimbursements on the payslip: ₹5,000 FBP + ₹1,500 Travel', slip1.reimbursementsPaise === R(6500), slip1.reimbursementsPaise);
  check('net payable = net pay + ₹6,500', slip1.netPayablePaise === slip1.netPaise + R(6500), [slip1.netPayablePaise, slip1.netPaise]);
  const earned = slip1.earnings.reduce((t, e) => t + e.paidPaise, 0);
  check('gross = the earnings (Basic + Fixed Allowance); FBP is inside CTC, beside gross', slip1.grossPaise === earned && slip1.grossPaise + R(5000) + (slip1.employer?.totalPaise ?? 0) === R(2_00_000), [slip1.grossPaise, (slip1.employer?.totalPaise ?? 0)]);
  check('taxable this month: of ₹5,000 FBP, ₹3,000 billed (Fuel) is tax-free, ₹2,000 (Internet in review, Telephone no bills) taxed',
    slip1.inputs?.reimbursementTax?.paidPaise === R(5000) && slip1.inputs.reimbursementTax.exemptPaise === R(3000) && slip1.inputs.reimbursementTax.taxablePaise === R(2000), slip1.inputs?.reimbursementTax);
  const tds1 = slip1.inputs?.tds;
  // The year: 12 months of taxable earnings, this month's ₹2,000 of FBP taxed, and 11 months of FBP still to come with no bills yet.
  check('TDS: the year\'s gross salary is 12 × taxable earnings + ₹2,000 + 11 × ₹5,000', tds1?.grossSalaryPaise === 12 * (slip1.taxablePaise ?? 0) + R(2000) + 11 * R(5000), [tds1?.grossSalaryPaise, slip1.taxablePaise]);

  // HR approves the Internet bill: ₹1,000 more of the year's salary is tax-free, still nothing paid out.
  const decided = await decideFbpRequest('hr', internetBill, { decision: 'approve' });
  check('approve: the bill reads approved', decided.status === 'approved' && decided.decidedAt !== null, decided);
  await recomputeRun('hr', apr.run.id, {});
  const slip2 = (await payslips().findOne({ runId: apr.run.id, userId: 'asha' }))!;
  check('after approving: ₹4,000 tax-free, ₹1,000 (Telephone) taxed', slip2.inputs?.reimbursementTax?.exemptPaise === R(4000) && slip2.inputs.reimbursementTax.taxablePaise === R(1000), slip2.inputs?.reimbursementTax);
  check('…the year\'s gross salary for tax is ₹1,000 lower, and the month\'s TDS is not higher',
    slip2.inputs?.tds?.grossSalaryPaise === (tds1?.grossSalaryPaise ?? 0) - R(1000) && (slip2.inputs?.tds?.monthlyTdsPaise ?? 0) <= (tds1?.monthlyTdsPaise ?? 0), [slip2.inputs?.tds?.grossSalaryPaise, slip2.inputs?.tds?.monthlyTdsPaise, tds1?.monthlyTdsPaise]);
  check('…and the payout is unchanged: still only Travel', slip2.inputs?.reimbursementsPaise === R(1500) && slip2.reimbursementsPaise === R(6500));

  // Rejecting with a reason: kept where the app reads it.
  await reimbursementClaims().insertOne(claim('internet', 'pending', 900, { expenseDate: new Date('2026-05-08T00:00:00Z'), createdAt: may10 }));
  const mayBill = (await reimbursementClaims().findOne({ category: 'internet', status: 'pending' }))!._id!.toHexString();
  const REASON = 'The bill is for a different account holder.';
  const rejected = await decideFbpRequest('hr', mayBill, { decision: 'reject', reason: REASON });
  check('reject: rejected, with the reason', rejected.status === 'rejected' && rejected.reason === REASON, rejected);
  check('…stored as the claim\'s managerNote', (await reimbursementClaims().findOne({ _id: new ObjectId(mayBill) }))?.managerNote === REASON);
  const may = (await myFbpHead('asha', 'INTERNET', may10)).months.find((m) => m.period === '2026-05');
  check('…the app\'s FBP page shows it rejected with that reason, to upload again', may?.status === 'rejected' && may.bill?.reason === REASON && may.canUpload, may);
  check('…and no FBP bill reached the reimbursement list', (await listAllReimbursementsForAdmin('hr')).length === 1);

  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} FBP tab checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
