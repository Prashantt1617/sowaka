/**
 * Scratch-database check of the investment declaration and its proofs: the
 * statutory caps (80C ₹1.5 lakh for PF, PPF, ELSS and life insurance
 * together, 80D, 80CCD(1B), 24(b) ₹2 lakh, HRA from a month's rent), the new
 * regime saying none of it applies, the declaration deadline, the TDS engine
 * reading the item totals, proof states (not uploaded, uploaded, approved,
 * rejected with a reason, re-upload), the proofs deadline, and who may see
 * and decide what: an employee only their own, HR only with payroll access
 * and only in their own company. File storage is faked: nothing reaches S3.
 * It drops and recreates its own database, and refuses any other. Run with
 *   npm run payroll:declaration-check
 */
import { companies, connectDb, getDb, investmentProofs, payHeads, salaryStructures, salaryTemplates, taxDeclarations, tdsConfigs, users } from '../config/db';
import { env } from '../config/env';
import { PayHead } from '../models/payHead.model';
import { tabsForRequest } from '../models/dashboard-tabs';
import {
  decideProofForHr, listProofsForHr, myDeclaration, myProofFile, myProofs, ProofStorage, proofFileForHr, saveMyDeclaration, setProofStorageForTests, uploadMyProof,
} from '../services/employeePayroll.declaration';
import { myPayrollHome } from '../services/employeePayroll.home';
import { computeTds, TDS_SEED } from '../shared/payroll/tds';

/** Home with Payroll switched on (the seed turns it on for the org). */
async function homeOn(...args: Parameters<typeof myPayrollHome>) {
  const h = await myPayrollHome(...args);
  if (h.appEnabled !== true) throw new Error('Payroll is off for the scratch org');
  return h;
}

const SCRATCH = 'payroll_declaration_scratch';
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

// A fake bucket: what was stored, and what was deleted.
const stored = new Map<string, number>();
const removed: string[] = [];
let n = 0;
const fakeStorage: ProofStorage = {
  available: () => true,
  async upload(org, userId, file) {
    const objectKey = `fake/tax-proofs/${org}/${userId}/${++n}`;
    stored.set(objectKey, file.size);
    return { objectKey };
  },
  async remove(objectKey) {
    removed.push(objectKey);
    stored.delete(objectKey);
  },
  async url(objectKey) {
    return `https://fake.invalid/${objectKey}`;
  },
};
const pdf = (label: string) => {
  const buffer = Buffer.from(`%PDF-1.4 ${label}`);
  return { originalname: `${label}.pdf`, mimetype: 'application/pdf', size: buffer.length, buffer };
};

const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', employeeId: `E-${userId.toUpperCase()}`, ...extra,
});

(async () => {
  if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
  await connectDb();
  const db = getDb();
  if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  setProofStorageForTests(fakeStorage);

  const now = new Date();
  await companies().insertMany([{ id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31' } }, { id: 'otherco', name: 'Other (scratch)' }] as never[]);
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true }),
    person('hrpay', 'Pavan Payroll', { dashboardAccess: true, dashboardTabs: ['salarydetails'] }),
    person('hrleave', 'Lata Leaves', { dashboardAccess: true, dashboardTabs: ['employees', 'leaves'] }),
    person('asha', 'Asha Test'),
    person('bala', 'Bala Test'),
    { ...person('ohr', 'Other HR', { dashboardAccess: true, dashboardAdmin: true }), org: 'otherco' },
  ] as never[]);
  const head = (h: Partial<PayHead>) => ({ org: ORG, active: true, componentType: 'other', createdAt: now, updatedAt: now, ...h }) as PayHead;
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, considerForEpf: { consider: true, condition: 'always' } }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', calculation: { mode: 'flat_amount' } }),
  ]);
  await salaryTemplates().insertOne({ org: ORG, name: 'Plain', code: 'PLAIN', active: true, balancingComponentCode: 'FIXED_ALLOWANCE', createdAt: now, updatedAt: now,
    components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } }] });
  await salaryStructures().insertOne({ org: ORG, userId: 'asha', salaryTemplateCode: 'PLAIN', annualCtcPaise: R(12_00_000), status: 'active', createdAt: now, updatedAt: now });
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));

  const oct = new Date('2026-10-31T06:00:00Z');
  const FY = '2026-27';

  // —— the declaration ——
  const d0 = await myDeclaration('asha', undefined, oct);
  check('the FY is 2026-27 on 31 Oct', d0.fy === FY, d0.fy);
  check('nothing chosen yet: the new regime, not started, due 30 Nov', d0.regime === 'new' && !d0.chosen && d0.status === 'not_started' && d0.dueOn === '2026-11-30', d0);
  check('on the new regime every section says it is not needed', d0.sections.every((s) => !s.applicable && s.note === 'Not needed on the new regime' && s.countedPaise === 0), d0.sections);
  const pf = d0.sections[0].items[0];
  check('80C starts with the year\'s employee PF from payroll, read only', pf.key === 'epf' && pf.readOnly && pf.amountPaise === R(36_000), pf);

  const d1 = await saveMyDeclaration('asha', FY, {
    regime: 'old',
    items: { ppf: R(50_000), elss: R(50_000), lifeInsurance: R(14_000), healthSelf: R(25_000), nps: R(60_000), rentMonthly: R(15_000), homeLoanInterest: R(2_50_000) },
  }, oct);
  const sec = (key: string) => d1.sections.find((s) => s.key === key)!;
  check('saved on the old regime, status saved', d1.regime === 'old' && d1.chosen && d1.status === 'saved', d1);
  check('80C: PF ₹36,000 (₹3,000 a month at the ₹25,000 ceiling) + PPF + ELSS + LI = ₹1,50,000 declared, cap ₹1,50,000, all counts',
    sec('80C').declaredPaise === R(1_50_000) && sec('80C').capPaise === R(1_50_000) && sec('80C').countedPaise === R(1_50_000), sec('80C'));
  check('80CCD(1B): ₹60,000 declared, only ₹50,000 counts', sec('80CCD1B').declaredPaise === R(60_000) && sec('80CCD1B').countedPaise === R(50_000), sec('80CCD1B'));
  check('80D: ₹25,000 for self counts in full', sec('80D').countedPaise === R(25_000), sec('80D'));
  check('24(b): ₹2,50,000 interest, only ₹2,00,000 counts', sec('24B').declaredPaise === R(2_50_000) && sec('24B').countedPaise === R(2_00_000), sec('24B'));
  check('HRA: a month\'s rent is a year\'s ₹1,80,000, no cap', sec('HRA').declaredPaise === R(1_80_000) && sec('HRA').capPaise === null, sec('HRA'));
  check('each declared item asks for a proof; PF never does', sec('80C').items.filter((i) => i.proofNeeded).map((i) => i.key).join() === 'ppf,elss,lifeInsurance', sec('80C').items);

  const row = await taxDeclarations().findOne({ org: ORG, userId: 'asha', fy: FY });
  check('stored for the TDS engine: 80C total without PF, a year\'s rent, interest as declared',
    row?.declarations.sec80C === R(1_14_000) && row.declarations.rentPaidPaise === R(1_80_000) && row.declarations.homeLoanInterest === R(2_50_000) && row.declarations.sec80CCD1B === R(60_000), row?.declarations);
  const old = TDS_SEED.find((c) => c.fy === FY && c.regime === 'old')!;
  const tds = computeTds({ config: old, ytdTaxablePaise: 0, ytdTdsPaise: 0, currentTaxablePaise: R(1_00_000), futureMonthlyTaxablePaise: R(1_00_000), monthsAfter: 11, employeePfYearPaise: R(36_000), declarations: row!.declarations });
  check('the engine caps them: VI-A = 80C ₹1.5L + NPS ₹50k + 80D ₹25k, home loan ₹2L',
    tds.chapterVIAPaise === R(2_25_000) && tds.homeLoanPaise === R(2_00_000), { viA: tds.chapterVIAPaise, homeLoan: tds.homeLoanPaise });

  const senior = await saveMyDeclaration('asha', FY, { regime: 'old', items: { healthSelf: R(60_000) }, selfSenior: true }, oct);
  const d80 = senior.sections.find((s) => s.key === '80D')!;
  check('80D for a senior: ₹50,000 counts of ₹60,000', d80.countedPaise === R(50_000) && senior.selfSenior, d80);
  const over80c = await saveMyDeclaration('asha', FY, { regime: 'old', items: { other80C: R(1_00_000), healthSelf: R(25_000) }, selfSenior: false }, oct);
  const c80 = over80c.sections.find((s) => s.key === '80C')!;
  check('80C above the cap is kept but only ₹1,50,000 counts', c80.declaredPaise === R(2_50_000) && c80.countedPaise === R(1_50_000), c80);
  const cleared = await saveMyDeclaration('asha', FY, { regime: 'old', items: { other80C: null } }, oct);
  check('null clears an item', cleared.sections[0].items.find((i) => i.key === 'other80C')!.amountPaise === 0);

  check('an unknown item is refused (400)', (await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { crypto: 100 } }, oct)))?.status === 400);
  check('PF cannot be declared (400)', (await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { epf: 100 } }, oct)))?.status === 400);
  check('a negative amount is refused (400)', (await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { ppf: -1 } }, oct)))?.status === 400);
  check('a fractional paise amount is refused (400)', (await refusal(() => saveMyDeclaration('asha', FY, { regime: 'old', items: { ppf: 10.5 } }, oct)))?.status === 400);
  check('a regime is required (400)', (await refusal(() => saveMyDeclaration('asha', FY, { items: {} }, oct)))?.status === 400);
  check('a bad fy is refused (400)', (await refusal(() => myDeclaration('asha', '2026-28', oct)))?.status === 400);
  const submitted = await saveMyDeclaration('asha', FY, { regime: 'old', submit: true }, oct);
  check('submitting marks it submitted with a time', submitted.status === 'submitted' && submitted.submittedAt !== null, submitted);
  const dec1 = new Date('2026-12-01T06:00:00Z');
  const late = await refusal(() => saveMyDeclaration('asha', FY, { regime: 'new' }, dec1));
  check('after 30 Nov the declaration is locked (409)', late?.status === 409, late);
  check('…and reads back locked', (await myDeclaration('asha', FY, dec1)).locked === true);

  // —— the new regime ——
  await saveMyDeclaration('bala', FY, { regime: 'new', items: { ppf: R(10_000) } }, oct);
  const bProofs = await myProofs('bala', FY, oct);
  check('new regime: no proofs asked for, even with an amount kept', bProofs.required === false && bProofs.items.length === 0, bProofs);
  const bUp = await refusal(() => uploadMyProof('bala', 'ppf', FY, { amountPaise: R(10_000), file: pdf('bala-ppf') }, oct));
  check('new regime: a proof upload says it is not needed (400)', bUp?.status === 400 && bUp.message === 'Not needed on the new regime', bUp);

  // —— proofs ——
  const p0 = await myProofs('asha', FY, oct);
  check('Asha\'s proofs: one per declared item, all not uploaded, due 31 Jan',
    p0.required && p0.dueOn === '2027-01-31' && p0.items.every((i) => i.status === 'not_uploaded') && p0.summary.notUploaded === p0.items.length, p0);
  const items = p0.items.map((i) => i.item);
  check('the items are PPF, ELSS, LI, NPS, health (self), rent, home loan', items.join() === 'ppf,elss,lifeInsurance,nps,healthSelf,rentMonthly,homeLoanInterest', items);
  check('an item not declared cannot take a proof (400)', (await refusal(() => uploadMyProof('asha', 'healthParents', FY, { amountPaise: 100, file: pdf('x') }, oct)))?.status === 400);
  check('PF needs no proof (400)', (await refusal(() => uploadMyProof('asha', 'epf', FY, { amountPaise: 100, file: pdf('x') }, oct)))?.status === 400);
  check('no file (400)', (await refusal(() => uploadMyProof('asha', 'ppf', FY, { amountPaise: R(50_000) }, oct)))?.status === 400);
  check('no amount on the proof (400)', (await refusal(() => uploadMyProof('asha', 'ppf', FY, { file: pdf('x') }, oct)))?.status === 400);

  const up = await uploadMyProof('asha', 'ppf', FY, { amountPaise: R(50_000), file: pdf('asha-ppf') }, oct);
  check('uploaded: in review, with the amount and file name', up.status === 'uploaded' && up.proof?.amountPaise === R(50_000) && up.proof.fileName === 'asha-ppf.pdf', up);
  const firstKey = (await investmentProofs().findOne({ userId: 'asha', item: 'ppf' }))!.objectKey;
  check('the file went to (fake) storage under the org and person', firstKey.startsWith('fake/tax-proofs/sowaka/asha/') && stored.has(firstKey), firstKey);
  check('the declaration\'s proof state is now submitted', (await taxDeclarations().findOne({ userId: 'asha', fy: FY }))?.proofs === 'submitted');
  check('Asha can open her file', (await myProofFile('asha', 'ppf', FY, oct)).startsWith('https://fake.invalid/'));
  check('Bala cannot open Asha\'s file: he has none of his own (404)', (await refusal(() => myProofFile('bala', 'ppf', FY, oct)))?.status === 404);

  // —— HR: who may ——
  const list = await listProofsForHr('hr', { fy: FY }, oct);
  const proofId = list.proofs[0]?.id;
  check('HR lists the uploaded proof with the person and the declared amount',
    list.proofs.length === 1 && list.proofs[0].employeeName === 'Asha Test' && list.proofs[0].declaredPaise === R(50_000), list.proofs);
  check('someone with Salary details only may list too', (await listProofsForHr('hrpay', { fy: FY }, oct)).proofs.length === 1);
  check('HR without payroll access is refused (403)', (await refusal(() => listProofsForHr('hrleave', { fy: FY }, oct)))?.status === 403);
  check('an employee is refused the HR list (403)', (await refusal(() => listProofsForHr('asha', { fy: FY }, oct)))?.status === 403);
  check('an employee cannot decide a proof, not even their own (403)', (await refusal(() => decideProofForHr('asha', proofId, { decision: 'approved' }, oct)))?.status === 403);
  check('another company\'s HR cannot see it (404)', (await refusal(() => decideProofForHr('ohr', proofId, { decision: 'approved' }, oct)))?.status === 404);
  check('…nor list it', (await listProofsForHr('ohr', { fy: FY }, oct)).proofs.length === 0);
  check('…nor open its file (404)', (await refusal(() => proofFileForHr('ohr', proofId)))?.status === 404);
  check('the dashboard tab rule: payroll tabs only', JSON.stringify(tabsForRequest('POST', '/admin/payroll/investment-proofs/x/decision')) === JSON.stringify(['salarydetails', 'payruns']), tabsForRequest('POST', '/admin/payroll/investment-proofs/x/decision'));

  // —— reject, re-upload, approve ——
  check('rejecting needs a reason (400)', (await refusal(() => decideProofForHr('hr', proofId, { decision: 'rejected' }, oct)))?.status === 400);
  check('a bad decision (400)', (await refusal(() => decideProofForHr('hr', proofId, { decision: 'maybe' }, oct)))?.status === 400);
  const reason = 'This certificate is for FY 2025-26. Upload the one for FY 2026-27.';
  const rej = await decideProofForHr('hr', proofId, { decision: 'rejected', reason }, oct);
  check('rejected with the reason', rej.status === 'rejected' && rej.reason === reason && rej.decidedByUserId === 'hr', rej);
  const seen = (await myProofs('asha', FY, oct)).items.find((i) => i.item === 'ppf')!;
  check('Asha sees it rejected, with the reason', seen.status === 'rejected' && seen.proof?.reason === reason, seen);
  check('a rejected proof cannot be decided again (409)', (await refusal(() => decideProofForHr('hr', proofId, { decision: 'approved' }, oct)))?.status === 409);
  const re = await uploadMyProof('asha', 'ppf', FY, { amountPaise: R(50_000), file: pdf('asha-ppf-2026') }, oct);
  check('re-uploaded: in review again, the reason gone', re.status === 'uploaded' && re.proof?.reason === null && re.proof.decidedAt === null, re);
  check('the replaced file was deleted from storage', removed.includes(firstKey) && !stored.has(firstKey), removed);
  check('filtering HR\'s list by status', (await listProofsForHr('hr', { fy: FY, status: 'uploaded' }, oct)).proofs.length === 1
    && (await listProofsForHr('hr', { fy: FY, status: 'rejected' }, oct)).proofs.length === 0);
  const ok = await decideProofForHr('hrpay', proofId, { decision: 'approved' }, oct);
  check('approved by someone with Salary details', ok.status === 'approved' && ok.reason === null, ok);
  check('an approved proof cannot be replaced (409)', (await refusal(() => uploadMyProof('asha', 'ppf', FY, { amountPaise: R(50_000), file: pdf('again') }, oct)))?.status === 409);

  const others = ['elss', 'lifeInsurance', 'nps', 'healthSelf', 'rentMonthly', 'homeLoanInterest'] as const;
  for (const item of others) await uploadMyProof('asha', item, FY, { amountPaise: R(1_000), file: pdf(`asha-${item}`) }, oct);
  const allSent = await myProofs('asha', FY, oct);
  check('every item uploaded: all sent for review, not all approved yet', allSent.summary.allSent && !allSent.summary.allApproved && allSent.summary.uploaded === 6, allSent.summary);
  const pending = await listProofsForHr('hr', { fy: FY, status: 'uploaded' }, oct);
  for (const p of pending.proofs) await decideProofForHr('hr', p.id, { decision: 'approved' }, oct);
  const allSet = await myProofs('asha', FY, oct);
  check('every proof approved: all set', allSet.summary.allApproved && allSet.summary.approved === 7, allSet.summary);
  check('the declaration\'s proof state is verified', (await taxDeclarations().findOne({ userId: 'asha', fy: FY }))?.proofs === 'verified');

  // —— deadlines and the home to-do ——
  await saveMyDeclaration('bala', FY, { regime: 'old', items: { ppf: R(10_000) } }, oct);
  const bHome = await homeOn('bala', undefined, oct);
  check('home: Bala has a proof to upload by 31 Jan', bHome.todo.some((t) => t.kind === 'investment_proofs' && t.notUploaded === 1 && t.dueOn === '2027-01-31'), bHome.todo);
  check('home: Bala chose his regime: no regime to-do', !bHome.todo.some((t) => t.kind === 'tax_regime'), bHome.todo);
  check('home: no salary structure for Bala yet, still works', bHome.hasSalaryStructure === false, bHome.hasSalaryStructure);
  const feb = new Date('2027-02-01T06:00:00Z');
  const lateProof = await refusal(() => uploadMyProof('bala', 'ppf', FY, { amountPaise: R(10_000), file: pdf('late') }, feb));
  check('after 31 Jan proofs are closed (409)', lateProof?.status === 409, lateProof);
  check('a company can move the deadlines', await (async () => {
    await companies().updateOne({ id: ORG }, { $set: { payrollEmployee: { declarationDue: '12-15', proofsDue: '02-15' } } });
    const d = await myDeclaration('bala', FY, dec1);
    const p = await uploadMyProof('bala', 'ppf', FY, { amountPaise: R(10_000), file: pdf('feb') }, feb);
    return d.dueOn === '2026-12-15' && !d.locked && p.status === 'uploaded';
  })());

  // Asha's and Bala's views never mix.
  const aView = await myProofs('asha', FY, oct);
  const bView = await myProofs('bala', FY, oct);
  check('Asha\'s proofs are hers, Bala\'s his', aView.items.length === 7 && bView.items.length === 1 && bView.items[0].proof?.fileName === 'feb.pdf', { a: aView.items.length, b: bView.items });

  setProofStorageForTests(null);
  await db.dropDatabase();
  console.log(failed === 0 ? `\nall ${passed} declaration checks passed` : `\n${failed} check(s) failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  try {
    if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
  } catch { /* not connected */ }
  process.exit(1);
});
