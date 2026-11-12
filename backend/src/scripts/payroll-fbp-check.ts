/**
 * Scratch-database check of the app's FBP page (app › Payroll › FBP): the
 * month's summary (each head's amount, the part not assigned, the pool), each
 * head's bills from April to this month (approved, in review, rejected with
 * HR's reason, not uploaded), uploading and re-uploading a month's bill, HR
 * deciding it on the dashboard's reimbursement route as any claim, the bills
 * due date and the split's lock for the FY, and their "not set up" states.
 * File storage is faked: nothing reaches S3. It drops and recreates its own
 * database, and refuses any other. Test data is the `sowaka` org with
 * invented people and amounts. Run with
 *   npm run payroll:fbp-check
 */
import { ObjectId } from 'mongodb';
import {
  companies, connectDb, flexibleSplits, getDb, payHeads, payrollRuns, reimbursementClaims, reimbursementTypes, salaryStructures, salaryTemplates,
  users,
} from '../config/db';
import { env } from '../config/env';
import { PayHead } from '../models/payHead.model';
import { ReimbursementClaim } from '../models/reimbursement.model';
import { FbpBillStorage, myFbp, myFbpBillFile, myFbpHead, setFbpBillStorageForTests, uploadMyFbpBill } from '../services/employeePayroll.fbp';
import { myPayrollHome } from '../services/employeePayroll.home';
import { mySplit, reviewSplit } from '../services/employeePayroll.split';
import { decideFbpRequest, fbpRequestsForAdmin } from '../services/fbpAdmin.service';
import { listAllReimbursementsForAdmin } from '../services/reimbursement.service';

const SCRATCH = 'payroll_fbp_scratch';
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
    const e = error as { statusCode?: number; message?: string; details?: Record<string, unknown> };
    return { status: e.statusCode, message: e.message, reason: e.details?.reason, missing: e.details?.missing };
  }
}

// A fake bucket.
const stored = new Map<string, number>();
let n = 0;
const fakeStorage: FbpBillStorage = {
  available: () => true,
  async upload(userId, file) {
    const objectKey = `fake/receipts/${userId}/${++n}`;
    stored.set(objectKey, file.size);
    return { objectKey };
  },
  async url(objectKey) {
    return `https://fake.invalid/${objectKey}`;
  },
};
const jpeg = (label: string) => {
  const buffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(label)]);
  return { originalname: `${label}.jpg`, mimetype: 'image/jpeg', size: buffer.length, buffer };
};

const head = (h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'calculation'>): PayHead => ({
  org: ORG, componentType: 'other', active: true, showInPayslip: true, recurrence: 'recurring', createdAt: new Date(), updatedAt: new Date(), ...h,
} as PayHead);

const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', employeeId: `E-${userId.toUpperCase()}`, managerUserId: 'hr', ...extra,
});

const SETTINGS = { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31', splitDue: '11-15', fbpBillsDueDay: 20, splitStepPaise: R(500) };

(async () => {
  if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
  await connectDb();
  const db = getDb();
  if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}: set MONGODB_DB=${SCRATCH}`);
  await db.dropDatabase();
  setFbpBillStorageForTests(fakeStorage);

  const now = new Date();
  await companies().insertMany([{ id: ORG, name: 'Sowaka (scratch)', payrollEmployee: SETTINGS }, { id: 'otherco', name: 'Other (scratch)' }] as never[]);
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('asha', 'Asha Test'),
    person('bala', 'Bala Test'),
    person('chetan', 'Chetan Test'),
    person('dev', 'Dev Test'),
  ] as never[]);
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, taxable: true }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, taxable: true }),
    head({ code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel & vehicle', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(3000) }),
    head({ code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1000) }),
    head({ code: 'TELEPHONE', name: 'Telephone Reimbursement', payslipName: 'Telephone', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1500) }),
    head({ code: 'BOOKS', name: 'Books Reimbursement', payslipName: 'Books & periodicals', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(500) }),
  ]);
  const flat = (code: string) => ({ payHeadCode: code, calculation: { mode: 'flat_amount' as const } });
  await salaryTemplates().insertMany([
    {
      org: ORG, name: 'Flexible', code: 'FLEX', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE', flexiblePoolPaise: R(6000),
      components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, ...['FIXED_ALLOWANCE', 'FUEL', 'INTERNET', 'TELEPHONE', 'BOOKS'].map(flat)],
    },
    { org: ORG, name: 'Plain', code: 'PLAIN', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
      components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, flat('FIXED_ALLOWANCE')] },
  ] as never[]);
  await salaryStructures().insertMany([
    { org: ORG, userId: 'asha', salaryTemplateCode: 'FLEX', annualCtcPaise: R(18_00_000), componentValues: { FUEL: R(2500), INTERNET: R(1000), TELEPHONE: R(1000), BOOKS: 0 }, status: 'active', createdAt: now, updatedAt: now },
    // Bala joined in August: no bills before.
    { org: ORG, userId: 'bala', salaryTemplateCode: 'FLEX', annualCtcPaise: R(12_00_000), componentValues: { FUEL: R(2000), INTERNET: R(1000), TELEPHONE: 0, BOOKS: 0 }, status: 'active', effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdAt: now, updatedAt: now },
    { org: ORG, userId: 'chetan', salaryTemplateCode: 'PLAIN', annualCtcPaise: R(9_00_000), status: 'active', createdAt: now, updatedAt: now },
  ] as never[]);
  // HR links a bill type to each head it wants bills for; Books has none.
  await reimbursementTypes().insertMany([
    { org: ORG, name: 'Fuel', maxLimit: 3000, backdateDays: 30, payHeadCode: 'FUEL', active: true, createdAt: now, updatedAt: now },
    { org: ORG, name: 'Internet', maxLimit: 0, backdateDays: 30, payHeadCode: 'INTERNET', active: true, createdAt: now, updatedAt: now },
    { org: ORG, name: 'Telephone', maxLimit: 0, backdateDays: 30, payHeadCode: 'TELEPHONE', active: true, createdAt: now, updatedAt: now },
    { org: ORG, name: 'Travel', maxLimit: 0, backdateDays: 30, active: true, createdAt: now, updatedAt: now },
  ] as never[]);
  // Asha declared her split in April.
  await flexibleSplits().insertOne({
    org: ORG, userId: 'asha', fy: '2026-27', effectiveFrom: '2026-04', amounts: { FUEL: R(2500), INTERNET: R(1000), TELEPHONE: R(1000), BOOKS: 0 },
    acknowledged: true, submittedAt: new Date('2026-04-08T06:00:00Z'), poolPaise: R(6000),
  });
  // Her bills so far: Fuel April–July approved, August rejected, September in review; Internet every month;
  // Telephone April–August. One Travel claim is an ordinary expense, not a bill.
  const claim = (category: string, period: string, status: ReimbursementClaim['status'], extra: Partial<ReimbursementClaim> = {}): ReimbursementClaim => ({
    userId: 'asha', managerUserId: 'hr', expenseDate: new Date(`${period}-20T00:00:00Z`), amount: category === 'fuel' ? 2500 : 1000, category,
    receiptName: `${category}-${period}.jpg`, receiptObjectKey: `fake/receipts/asha/${category}-${period}`, status,
    createdAt: new Date(`${period}-21T06:00:00Z`), updatedAt: new Date(`${period}-21T06:00:00Z`),
    ...(status !== 'pending' ? { decidedAt: new Date(`${period}-25T06:00:00Z`), decidedByUserId: 'hr', decidedByRole: 'admin' as const } : {}),
    ...extra,
  });
  const REASON = 'The total on the bill isn\'t readable. Upload a clearer photo where the amount and date can be seen.';
  await reimbursementClaims().insertMany([
    ...['2026-04', '2026-05', '2026-06', '2026-07'].map((p) => claim('fuel', p, 'approved')),
    claim('fuel', '2026-08', 'declined', { managerNote: REASON, createdAt: new Date('2026-09-02T06:00:00Z'), decidedAt: new Date('2026-09-05T06:00:00Z') }),
    claim('fuel', '2026-09', 'pending'),
    ...['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((p) => claim('internet', p, p === '2026-10' ? 'paid' : 'approved')),
    ...['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((p) => claim('telephone', p, 'approved')),
    claim('travel', '2026-10', 'pending'),
    // Last FY's bill is not this year's.
    claim('fuel', '2026-03', 'approved'),
  ]);

  const oct20 = new Date('2026-10-20T06:00:00Z');

  // —— the page ——
  const f = await myFbp('asha', oct20);
  check('FY 2026-27, the summary is for October', f.fy === '2026-27' && f.period === '2026-10', { fy: f.fy, period: f.period });
  check('₹6,000 a month: Fuel ₹2,500 + Internet ₹1,000 + Telephone ₹1,000, ₹1,500 not assigned',
    f.available && f.poolPaise === R(6000) && f.assignedPaise === R(4500) && f.unassignedPaise === R(1500), f);
  check('declared in April', f.declared?.effectiveFrom === '2026-04' && f.declared.submittedAt.startsWith('2026-04-08'), f.declared);
  const h = (code: string) => f.heads.find((x) => x.code === code)!;
  check('Fuel: 4 of 7 bills approved, 2 to send (August rejected, October not uploaded)',
    h('FUEL').months === 7 && h('FUEL').approved === 4 && h('FUEL').inReview === 1 && h('FUEL').rejected === 1 && h('FUEL').toUpload === 1 && h('FUEL').needsAction === 2, h('FUEL'));
  check('Internet: 7 of 7 approved (paid counts), nothing to send', h('INTERNET').approved === 7 && h('INTERNET').needsAction === 0, h('INTERNET'));
  check('Telephone: 5 of 7 approved, 2 to upload', h('TELEPHONE').approved === 5 && h('TELEPHONE').toUpload === 2 && h('TELEPHONE').needsAction === 2, h('TELEPHONE'));
  check('Books pays nothing: no months, nothing to send, no bill type', h('BOOKS').amountPaise === 0 && h('BOOKS').months === 0 && h('BOOKS').needsAction === 0 && !h('BOOKS').billsSetUp, h('BOOKS'));
  check('3 bills to upload · 1 to re-upload · 1 in review', f.summary.toUpload === 3 && f.summary.toReupload === 1 && f.summary.inReview === 1, f.summary);
  check('bills due 31 Mar 2027, nothing missing', f.billsDueOn === '2027-03-31' && f.missing.length === 0, { due: f.billsDueOn, missing: f.missing });
  check('the split is not locked: a change now applies from November, by 15 Nov',
    !f.lock.locked && !f.lock.notConfigured && f.lock.reason === null && f.lock.effectiveFrom === '2026-11' && f.lock.closesOn === '2026-11-15', f.lock);
  check('October\'s bills are due by 20 Oct (the monthly due day); 31 Mar 2027 stays the last day', f.monthlyDueOn === '2026-10-20' && f.billsDueOn === '2027-03-31', f);

  // —— the home to-do for FBP bills ——
  const homeTodo = async (at: Date) => {
    const home = await myPayrollHome('asha', undefined, at);
    return home.appEnabled ? home.todo.find((t) => t.kind === 'fbp_bills') : undefined;
  };
  const t20 = await homeTodo(oct20);
  check('home: "Submit FBP bills · 3 pending · 1 rejected", by 20 Oct',
    t20?.pending === 3 && t20.rejected === 1 && t20.dueOn === '2026-10-20' && t20.notConfigured === false, t20);

  // —— a head ——
  const fuel = await myFbpHead('asha', 'fuel', oct20);
  const m = (period: string) => fuel.months.find((x) => x.period === period)!;
  check('Fuel & vehicle: ₹2,500 a month, FY 2026-27, April to October', fuel.name === 'Fuel & vehicle' && fuel.amountPaise === R(2500) && fuel.fy === '2026-27'
    && fuel.months.map((x) => x.period).join() === '2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10', fuel.months.map((x) => x.period));
  check('April to July approved, not to be sent again', ['2026-04', '2026-05', '2026-06', '2026-07'].every((p) => m(p).status === 'approved' && !m(p).canUpload));
  check('August rejected: uploaded 2 Sep, rejected 5 Sep, with HR\'s reason, can be re-uploaded',
    m('2026-08').status === 'rejected' && m('2026-08').bill?.uploadedAt.startsWith('2026-09-02') === true && m('2026-08').bill?.decidedAt?.startsWith('2026-09-05') === true
      && m('2026-08').bill?.reason === REASON && m('2026-08').canUpload, m('2026-08'));
  check('September in review, not to be sent again', m('2026-09').status === 'in_review' && !m('2026-09').canUpload && m('2026-09').bill?.reason === null, m('2026-09'));
  check('October not uploaded: ₹2,500 taxed until it is, can be uploaded', m('2026-10').status === 'not_uploaded' && m('2026-10').amountPaise === R(2500) && m('2026-10').canUpload && m('2026-10').bill === null, m('2026-10'));
  check('bills go in as the Fuel type, nothing blocks them', fuel.billType === 'Fuel' && fuel.uploadsBlocked === null, fuel);
  check('an unknown head is 404', (await refusal(() => myFbpHead('asha', 'MEAL', oct20)))?.status === 404);
  const books = await myFbpHead('asha', 'BOOKS', oct20);
  check('Books: no bill type linked, so uploads are not set up (ask HR)', books.uploadsBlocked?.reason === 'payroll_not_configured' && /Ask HR\.$/.test(books.uploadsBlocked.message), books.uploadsBlocked);

  // —— upload ——
  const up = (period: unknown, amountPaise: unknown, file: ReturnType<typeof jpeg> | null = jpeg(`fuel-${String(period)}`), who = 'asha', code = 'FUEL', at = oct20) =>
    uploadMyFbpBill(who, code, { period, amountPaise, file: file ?? undefined }, at);
  check('no file (400)', (await refusal(() => up('2026-10', R(2500), null)))?.status === 400);
  check('no amount (400)', (await refusal(() => up('2026-10', undefined)))?.status === 400);
  check('part rupees (400)', (await refusal(() => up('2026-10', 250050)))?.status === 400);
  check('over the Fuel type\'s ₹3,000 cap (400)', (await refusal(() => up('2026-10', R(3500))))?.status === 400);
  check('a month not started yet (400)', (await refusal(() => up('2026-11', R(2500))))?.status === 400);
  check('last FY\'s March (400)', (await refusal(() => up('2026-03', R(2500))))?.status === 400);
  check('a bad period (400)', (await refusal(() => up('Oct', R(2500))))?.status === 400);
  check('Books pays nothing, so no bill (400)', (await refusal(() => up('2026-10', R(500), jpeg('books'), 'asha', 'BOOKS')))?.status === 400);
  const approvedAgain = await refusal(() => up('2026-04', R(2500)));
  check('an approved month cannot be sent again (409), saying to ask HR', approvedAgain?.status === 409 && approvedAgain.reason === 'bill_approved' && /ask HR\.$/.test(approvedAgain.message ?? ''), approvedAgain);
  check('a month in review cannot be sent again (409)', (await refusal(() => up('2026-09', R(2500))))?.reason === 'bill_in_review');

  const afterOct = await up('2026-10', R(2400));
  const oct = afterOct.months.find((x) => x.period === '2026-10')!;
  check('October sent: in review with the amount on the bill and its file', oct.status === 'in_review' && oct.bill?.amountPaise === R(2400) && oct.bill.fileName === 'fuel-2026-10.jpg' && !oct.canUpload, oct);
  const row = await reimbursementClaims().findOne({ _id: new ObjectId(oct.bill!.id) });
  check('stored as a pending Fuel claim dated today in October, the file in (fake) storage, a note for HR',
    row?.status === 'pending' && row.category === 'fuel' && row.amount === 2400 && row.expenseDate.toISOString().slice(0, 10) === '2026-10-20'
      && row.note === 'FBP bill for October 2026' && stored.has(row.receiptObjectKey!) && row.managerUserId === 'hr', row);
  check('October twice is refused (409)', (await refusal(() => up('2026-10', R(2400))))?.reason === 'bill_in_review');

  const reAug = await up('2026-08', R(2500), jpeg('fuel-aug-clear'));
  const aug = reAug.months.find((x) => x.period === '2026-08')!;
  check('August re-uploaded: in review again, the reason gone', aug.status === 'in_review' && aug.bill?.reason === null && aug.bill.fileName === 'fuel-aug-clear.jpg', aug);
  const augRow = await reimbursementClaims().findOne({ userId: 'asha', category: 'fuel', note: 'FBP bill for August 2026' });
  check('a past month\'s bill is dated that month\'s last day', augRow?.expenseDate.toISOString().slice(0, 10) === '2026-08-31', augRow?.expenseDate);
  check('the rejected bill is kept as history', (await reimbursementClaims().countDocuments({ userId: 'asha', category: 'fuel', status: 'declined' })) === 1);
  const f2 = await myFbp('asha', oct20);
  check('now nothing of Fuel to send: 2 to upload (Telephone), 0 to re-upload, 3 in review',
    f2.summary.toUpload === 2 && f2.summary.toReupload === 0 && f2.summary.inReview === 3 && f2.heads.find((x) => x.code === 'FUEL')!.needsAction === 0, f2.summary);

  // —— HR on the dashboard's FBP requests (not Reimbursement requests) ——
  const listed = await listAllReimbursementsForAdmin('hr');
  check('the bill is not on the dashboard\'s reimbursement list (only the Travel claim is)', !listed.some((c) => c.id === oct.bill!.id) && listed.every((c) => c.category === 'travel'), listed.map((c) => c.category));
  const fbpListed = await fbpRequestsForAdmin('hr', '2026-27', oct20);
  check('…it is on FBP requests, pending', fbpListed.requests.some((r) => r.id === oct.bill!.id && r.headCode === 'FUEL' && r.status === 'pending' && r.period === '2026-10'), fbpListed.counts);
  const NEW_REASON = 'This is a hotel bill, not fuel.';
  await decideFbpRequest('hr', oct.bill!.id, { decision: 'reject', reason: NEW_REASON });
  const afterReject = (await myFbpHead('asha', 'FUEL', oct20)).months.find((x) => x.period === '2026-10')!;
  check('HR rejects it with a note: the app shows it rejected with that reason, open to re-upload',
    afterReject.status === 'rejected' && afterReject.bill?.reason === NEW_REASON && afterReject.canUpload, afterReject);
  await decideFbpRequest('hr', aug.bill!.id, { decision: 'approve' });
  const afterApprove = (await myFbpHead('asha', 'FUEL', oct20)).months.find((x) => x.period === '2026-08')!;
  check('HR approves August: approved, no reason', afterApprove.status === 'approved' && afterApprove.bill?.reason === null && !afterApprove.canUpload, afterApprove);
  check('the split\'s own bill counts see the same bills', (await mySplit('asha', oct20)).components.find((c) => c.code === 'FUEL')?.bills.approved === 5);

  // —— whose ——
  check('Asha opens her bill', (await myFbpBillFile('asha', oct.bill!.id)).startsWith('https://fake.invalid/'));
  check('Bala cannot open Asha\'s bill (404)', (await refusal(() => myFbpBillFile('bala', oct.bill!.id)))?.status === 404);
  const bala = await myFbp('bala', oct20);
  check('Bala sees only his own: nothing sent, from August (when he joined)', bala.summary.approved === 0 && bala.heads.find((x) => x.code === 'FUEL')!.months === 3, bala.heads);
  check('Bala has no split yet: the structure\'s amounts, not declared', bala.declared === null && bala.assignedPaise === R(3000) && bala.unassignedPaise === R(3000), bala);
  check('Bala\'s July is not a month of his (400)', (await refusal(() => up('2026-07', R(2000), jpeg('b'), 'bala')))?.status === 400);
  const chetan = await myFbp('chetan', oct20);
  check('Chetan\'s salary has no flexible heads: not available', chetan.available === false && chetan.heads.length === 0, chetan);
  check('Dev has no salary structure (404)', (await refusal(() => myFbp('dev', oct20)))?.status === 404);

  // —— a split that changes mid-year ——
  await flexibleSplits().insertOne({
    org: ORG, userId: 'asha', fy: '2026-27', effectiveFrom: '2026-11', amounts: { FUEL: R(3000), INTERNET: R(1000), TELEPHONE: R(1500), BOOKS: R(500) },
    acknowledged: true, submittedAt: new Date('2026-10-30T06:00:00Z'), poolPaise: R(6000),
  });
  const nov20 = new Date('2026-11-20T06:00:00Z');
  const novFuel = await myFbpHead('asha', 'FUEL', nov20);
  check('from November Fuel is ₹3,000; October stays ₹2,500',
    novFuel.amountPaise === R(3000) && novFuel.months.find((x) => x.period === '2026-11')?.amountPaise === R(3000) && novFuel.months.find((x) => x.period === '2026-10')?.amountPaise === R(2500), novFuel.months);
  const novPage = await myFbp('asha', nov20);
  check('November: all ₹6,000 assigned, declared in October for November', novPage.unassignedPaise === 0 && novPage.declared?.effectiveFrom === '2026-11', novPage);
  check('…and Books, now paid, wants November\'s bill but has no bill type (not set up)',
    novPage.heads.find((x) => x.code === 'BOOKS')!.toUpload === 1 && (await refusal(() => up('2026-11', R(500), jpeg('books'), 'asha', 'BOOKS', nov20)))?.reason === 'payroll_not_configured');

  // —— the lock for the FY: one window, closing on HR's date (15 Nov) ——
  const nov15 = new Date('2026-11-15T06:00:00Z');
  const nov16 = new Date('2026-11-16T06:00:00Z');
  const o15 = await myFbp('asha', nov15);
  check('15 Nov: still open, till 15 Nov', !o15.lock.locked && o15.lock.closesOn === '2026-11-15' && o15.lock.effectiveFrom === '2026-11', o15.lock);
  const l16 = await myFbp('asha', nov16);
  check('16 Nov: past the close date, locked for this FY, saying when it closed',
    l16.lock.locked && l16.lock.reason === 'locked_for_fy' && l16.lock.closesOn === '2026-11-15' && l16.lock.effectiveFrom === null && !l16.lock.notConfigured, l16.lock);
  const s16 = await mySplit('asha', nov16);
  check('…GET split: not editable, lockedReason locked_for_fy, no closesOn', s16.editable === false && s16.lockedReason === 'locked_for_fy' && s16.closesOn === null && !s16.window.open, s16);
  const rv16 = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2000) } }, nov16));
  check('…review refused: 409 split_locked, "raise a ticket"', rv16?.status === 409 && rv16.reason === 'split_locked' && rv16.message === 'Your split is locked for this FY. To change it, raise a ticket.', rv16);
  const rvBala = await refusal(() => reviewSplit('bala', { amounts: { FUEL: R(2500) } }, nov16));
  check('…a first split (Bala has none this FY) is locked too', rvBala?.status === 409 && rvBala.reason === 'split_locked', rvBala);
  const mar10 = new Date('2027-03-10T06:00:00Z');
  check('10 Mar: still locked for this FY', (await myFbp('asha', mar10)).lock.locked);
  const apr10 = new Date('2027-04-10T06:00:00Z');
  const a10 = await myFbp('asha', apr10);
  check('10 Apr 2027: a new FY, its own window open till 15 Nov 2027', a10.fy === '2027-28' && !a10.lock.locked && a10.lock.closesOn === '2027-11-15' && a10.lock.effectiveFrom === '2027-04', a10.lock);
  // A close date in March: past March's cutoff a change could only start in April (next FY).
  await companies().updateOne({ id: ORG }, { $set: { 'payrollEmployee.splitDue': '03-31' } });
  const m10 = await myFbp('asha', mar10);
  check('close date 31 Mar: on 10 Mar a change still reaches March, till 31 Mar', !m10.lock.locked && m10.lock.effectiveFrom === '2027-03' && m10.lock.closesOn === '2027-03-31', m10.lock);
  const m20 = await myFbp('asha', new Date('2027-03-20T06:00:00Z'));
  check('…20 Mar: past March\'s cutoff, a change would start in April (next FY): locked for this FY', m20.lock.locked && m20.lock.reason === 'locked_for_fy' && m20.lock.effectiveFrom === null, m20.lock);
  check('…and March\'s bills are due by the FY\'s last day for bills when that comes first (15 Mar < 20 Mar)',
    await companies().updateOne({ id: ORG }, { $set: { 'payrollEmployee.billsDue': '03-15' } }).then(() => myFbp('asha', mar10)).then((x) => x.monthlyDueOn === '2027-03-15'));
  await companies().updateOne({ id: ORG }, { $set: { payrollEmployee: SETTINGS } });
  await payrollRuns().insertMany(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((period) => ({
    org: ORG, period, runType: 'regular', status: 'approved', employeeCount: 0,
    totals: { grossPaise: 0, employeeDeductionsPaise: 0, netPaise: 0, reimbursementsPaise: 0, employerCostPaise: 0 }, createdByUserId: 'hr', createdAt: now, updatedAt: now,
  })) as never[]);
  check('20 Oct with every month left run and locked: locked for this FY', (await myFbp('asha', oct20)).lock.locked);
  await payrollRuns().deleteMany({});

  // —— not set up, and closed ——
  await companies().updateOne({ id: ORG }, { $unset: { 'payrollEmployee.splitCutoffDay': '', 'payrollEmployee.billsDue': '' } });
  const unset = await myFbp('asha', oct20);
  check('no cutoff day: the lock is not set up (not locked), named missing', !unset.lock.locked && unset.lock.notConfigured && unset.missing.includes('splitCutoffDay'), unset.lock);
  await companies().updateOne({ id: ORG }, { $unset: { 'payrollEmployee.splitDue': '', 'payrollEmployee.fbpBillsDueDay': '' } });
  const noClose = await myFbp('asha', nov16);
  check('no close date: not set up (not locked, no date), named missing (splitDue)',
    !noClose.lock.locked && noClose.lock.notConfigured && noClose.lock.closesOn === null && noClose.lock.missing.includes('splitDue') && noClose.missing.includes('splitDue'), noClose.lock);
  const noCloseSplit = await mySplit('asha', nov16);
  check('…the split: not editable, not locked, splitDue missing', !noCloseSplit.editable && noCloseSplit.lockedReason === null && noCloseSplit.notConfigured && noCloseSplit.missing.includes('splitDue'), noCloseSplit);
  const rvNoClose = await refusal(() => reviewSplit('asha', { amounts: { FUEL: R(2000) } }, nov16));
  check('…review refused as not set up (409 payroll_not_configured, splitDue)', rvNoClose?.status === 409 && rvNoClose.reason === 'payroll_not_configured' && (rvNoClose.missing as string[]).includes('splitDue'), rvNoClose);
  check('no monthly due day: no monthly date, never a made-up one', noClose.monthlyDueOn === null, noClose.monthlyDueOn);
  const tNoDay = await homeTodo(oct20);
  check('…the home to-do is still there, with no date', typeof tNoDay?.pending === 'number' && (tNoDay.pending as number) + (tNoDay.rejected as number) > 0 && tNoDay.dueOn === null, tNoDay);
  check('no bills due date: none to read, named missing', unset.billsDueOn === null && unset.missing.includes('billsDue'), unset.missing);
  const noDue = await refusal(() => up('2026-09', R(1000), jpeg('t'), 'asha', 'TELEPHONE'));
  check('…and a bill can\'t be sent (409 not set up, ask HR)', noDue?.status === 409 && noDue.reason === 'payroll_not_configured' && (noDue.missing as string[]).includes('billsDue') && /Ask HR\.$/.test(noDue.message ?? ''), noDue);
  check('…the head page says so', (await myFbpHead('asha', 'TELEPHONE', oct20)).months.every((x) => !x.canUpload));
  await companies().updateOne({ id: ORG }, { $set: { 'payrollEmployee.splitCutoffDay': 15, 'payrollEmployee.billsDue': '01-31' } });
  const feb10 = new Date('2027-02-10T06:00:00Z');
  const closed = await refusal(() => up('2026-12', R(1000), jpeg('t'), 'asha', 'TELEPHONE', feb10));
  check('bills due 31 Jan: on 10 Feb they are closed (409), saying when and to ask HR', closed?.status === 409 && closed.reason === 'bills_closed' && /31 Jan 2027/.test(closed.message ?? '') && /ask HR\.$/.test(closed.message ?? ''), closed);
  await companies().updateOne({ id: ORG }, { $set: { payrollEmployee: SETTINGS } });
  await salaryTemplates().updateOne({ code: 'FLEX' }, { $unset: { flexiblePoolPaise: '' } });
  const noPool = await myFbp('asha', oct20);
  check('no pool on the template: not set up, no unassigned figure', noPool.poolPaise === null && noPool.unassignedPaise === null && noPool.missing.includes('flexiblePoolPaise'), noPool);

  setFbpBillStorageForTests(null);
  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} FBP checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
