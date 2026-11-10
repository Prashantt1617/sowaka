/**
 * Scratch-database check of Form 16 (app › Payroll › Downloads › Form 16 and
 * the dashboard's Form 16 section): the dates worked out from the FY (ready
 * by 15 June after it, return due 31 July after it), the person's years
 * (this FY pending, past FYs ready, last FY missing once due when Sowaka paid
 * them in it), one upload per person and FY with parts replacing a combined
 * file and back, a bulk batch matched by PAN or employee ID (whole words, so
 * CS3 is not CS379), who may see and change what, and the HTTP routes with
 * real multipart uploads. File storage is faked: nothing reaches S3. It drops
 * and recreates its own database, and refuses any other. Run with
 *   env -u REDIS_URL npm run form16:check
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { ObjectId } from 'mongodb';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, employeePaymentDetails, getDb, payrollRuns, payslips, users } from '../config/db';
import { env } from '../config/env';
import { tabsForRequest } from '../models/dashboard-tabs';
import { hashSessionToken } from '../services/auth.service';
import { encryptField, fieldKeyConfigured } from '../services/fieldCrypto';
import {
  Form16Storage, bulkUploadForm16ForHr, currentFy, deleteForm16ForHr, form16Documents, form16FileForHr, form16ForHr, myForm16, myForm16File,
  previousFy, setForm16StorageForTests, uploadForm16ForHr,
} from '../services/form16.service';

const SCRATCH = 'form16_scratch';
const ORG = 'sowaka';
const PORT = Number(process.env.FORM16_CHECK_PORT ?? 4097);

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
    return { status: e.statusCode, message: e.message, reason: e.details?.reason };
  }
}

// A fake bucket: what is stored, and what was deleted.
const stored = new Map<string, number>();
const removed: string[] = [];
let n = 0;
const fakeStorage: Form16Storage = {
  available: () => true,
  async upload(org, userId, file) {
    const objectKey = `fake/form16/${org}/${userId}/${++n}.pdf`;
    stored.set(objectKey, file.size);
    return { objectKey };
  },
  async remove(objectKey) {
    removed.push(objectKey);
    stored.delete(objectKey);
  },
  async url(objectKey, fileName) {
    return `https://fake.invalid/${objectKey}?name=${encodeURIComponent(fileName)}`;
  },
};
const pdf = (originalname: string) => {
  const buffer = Buffer.from(`%PDF-1.4 ${originalname}`);
  return { originalname, mimetype: 'application/pdf', size: buffer.length, buffer };
};
const notPdf = (originalname: string) => {
  const buffer = Buffer.from('hello');
  return { originalname, mimetype: 'application/octet-stream', size: buffer.length, buffer };
};

const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', ...extra,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const tokens: Record<string, string> = {};
async function call(who: string, method: string, path: string, form?: FormData): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, { method, headers: { authorization: `Bearer ${tokens[who]}` }, body: form });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const blob = (text: string) => new Blob([Buffer.from(text)], { type: 'application/pdf' });

(async () => {
  let server: Server | undefined;
  try {
    if (env.mongoDbName !== SCRATCH) throw new Error(`refusing to run against ${env.mongoDbName}: set MONGODB_DB=${SCRATCH}`);
    // PAN matching reads encrypted PANs: a throwaway key when this shell has none (the database is scratch).
    if (!fieldKeyConfigured()) process.env.PAYROLL_FIELD_KEY = randomBytes(32).toString('base64');
    await connectDb();
    const db = getDb();
    if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}`);
    await db.dropDatabase();
    await connectDb();
    setForm16StorageForTests(fakeStorage);

    await companies().insertMany([
      { id: ORG, name: 'Sowaka (scratch)', payrollEmployee: { appEnabled: true } },
      { id: 'otherco', name: 'Other (scratch)', payrollEmployee: { appEnabled: true } },
    ] as never[]);
    await users().insertMany([
      person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true }),
      person('hrpay', 'Pavan Payroll', { dashboardAccess: true, dashboardTabs: ['salarydetails'] }),
      person('hrleave', 'Lata Leaves', { dashboardAccess: true, dashboardTabs: ['employees', 'leaves'] }),
      person('asha', 'Asha Test', { employeeId: 'E-ASHA' }),
      person('bala', 'Bala Test', { employeeId: 'E-BALA' }),
      person('chitra', 'Chitra Test', { employeeId: 'CS3' }),
      person('dev', 'Dev Test', { employeeId: 'CS379' }),
      person('eve', 'Eve Test', { employeeId: 'E-EVE' }),
      person('newbie', 'Nina New', { employeeId: 'E-NEW', joiningDate: new Date('2026-06-01T00:00:00Z') }),
      person('gone', 'Gita Gone', { employeeId: 'E-GONE', lifecycleStatus: 'offboarded' }),
      person('support', 'Support', { hiddenFromDirectory: true, dashboardAccess: true, dashboardAdmin: true }),
      { ...person('ohr', 'Other HR', { dashboardAccess: true, dashboardAdmin: true }), org: 'otherco' },
      { ...person('oscar', 'Oscar Other', { employeeId: 'E-ASHA' }), org: 'otherco' },
    ] as never[]);
    const pan = (userId: string, value: string, org = ORG) =>
      ({ org, userId, pan: encryptField(value), panLast4: value.slice(-4), updatedAt: new Date(), updatedByUserId: 'hr' });
    await employeePaymentDetails().insertMany([pan('asha', 'ABCDE1234F'), pan('bala', 'BCDEF2345G'), pan('oscar', 'BCDEF2345G', 'otherco')] as never[]);
    // Eve was paid by Sowaka in FY 2025-26 (a submitted February run); Bala only in a draft.
    const paidRun = new ObjectId();
    const draftRun = new ObjectId();
    await payrollRuns().insertMany([
      { _id: paidRun, org: ORG, period: '2026-02', status: 'paid' },
      { _id: draftRun, org: ORG, period: '2026-03', status: 'draft' },
    ] as never[]);
    await payslips().insertMany([
      { org: ORG, userId: 'eve', runId: paidRun.toHexString(), period: '2026-02', createdAt: new Date() },
      { org: ORG, userId: 'bala', runId: draftRun.toHexString(), period: '2026-03', createdAt: new Date() },
      { org: ORG, userId: 'gone', runId: paidRun.toHexString(), period: '2026-02', createdAt: new Date() },
    ] as never[]);

    const nov = new Date('2026-11-11T06:00:00Z');
    const march = new Date('2026-03-10T06:00:00Z');
    const LAST = '2025-26';

    // —— the dates ——
    console.log('the dates');
    check('11 Nov 2026 is in FY 2026-27; the one before is 2025-26', currentFy(nov) === '2026-27' && previousFy('2026-27') === LAST);
    check('31 Mar 2027 23:00 IST is still 2026-27, 1 Apr 2027 00:30 IST is 2027-28',
      currentFy(new Date('2027-03-31T17:30:00Z')) === '2026-27' && currentFy(new Date('2027-03-31T19:00:00Z')) === '2027-28');
    const empty = await myForm16('asha', nov);
    check('nothing filed: only this FY, pending, ready by 15 Jun 2027', empty.years.length === 1 && empty.years[0].fy === '2026-27'
      && empty.years[0].status === 'pending' && empty.years[0].readyBy === '2027-06-15' && empty.years[0].documents.length === 0, empty);
    check('the filing tip is for FY 2025-26, last date 31 Jul 2026', empty.currentFy === '2026-27' && empty.filing.fy === LAST && empty.filing.lastDate === '2026-07-31', empty.filing);

    // —— HR: one person's file ——
    console.log('one person\'s Form 16');
    const notEnded = await refusal(() => uploadForm16ForHr('hr', 'asha', { fy: '2026-27', file: pdf('asha.pdf') }, nov));
    check('this FY has not ended: 409 fy_not_ended', notEnded?.status === 409 && notEnded.reason === 'fy_not_ended' && /15 Jun 2027/.test(notEnded.message ?? ''), notEnded);
    check('no FY: 400', (await refusal(() => uploadForm16ForHr('hr', 'asha', { file: pdf('asha.pdf') }, nov)))?.status === 400);
    check('a bad part: 400', (await refusal(() => uploadForm16ForHr('hr', 'asha', { fy: LAST, part: 'C', file: pdf('asha.pdf') }, nov)))?.status === 400);
    check('not a PDF: 400', (await refusal(() => uploadForm16ForHr('hr', 'asha', { fy: LAST, file: notPdf('asha.pdf') }, nov)))?.status === 400);
    check('no file: 400', (await refusal(() => uploadForm16ForHr('hr', 'asha', { fy: LAST }, nov)))?.status === 400);
    check('without payroll access: 403', (await refusal(() => uploadForm16ForHr('hrleave', 'asha', { fy: LAST, file: pdf('asha.pdf') }, nov)))?.status === 403);
    check('another company\'s HR: 404', (await refusal(() => uploadForm16ForHr('ohr', 'asha', { fy: LAST, file: pdf('asha.pdf') }, nov)))?.status === 404);
    check('nothing stored by the refusals', stored.size === 0, [...stored.keys()]);

    const combined = await uploadForm16ForHr('hrpay', 'asha', { fy: LAST, file: pdf('Form16_Asha_2025-26.pdf') }, nov);
    check('Salary details access uploads it: combined, its name and size kept', combined.part === 'combined' && combined.fileName === 'Form16_Asha_2025-26.pdf' && combined.fy === LAST && stored.size === 1, combined);
    const mine = await myForm16('asha', nov);
    check('the app: this FY pending, then FY 2025-26 ready with the file', mine.years.map((y) => `${y.fy}:${y.status}`).join() === '2026-27:pending,2025-26:ready'
      && mine.years[1].documents[0]?.id === combined.id && mine.years[1].readyBy === '2026-06-15', mine.years);
    const link = await myForm16File('asha', combined.id);
    check('the app opens it through a short-lived link under its own name', link.url.startsWith('https://fake.invalid/fake/form16/sowaka/asha/') && link.fileName === combined.fileName, link);
    check('someone else cannot open it: 404', (await refusal(() => myForm16File('bala', combined.id)))?.status === 404);
    check('a broken id: 404', (await refusal(() => myForm16File('asha', 'nope')))?.status === 404);

    const partA = await uploadForm16ForHr('hr', 'asha', { fy: LAST, part: 'A', file: pdf('asha-a.pdf') }, nov);
    let rows = await form16Documents().find({ org: ORG, userId: 'asha', fy: LAST }).toArray();
    check('a Part A replaces the combined file (row and stored file)', rows.map((r) => r.part).join() === 'A' && removed.length === 1 && stored.size === 1, { rows, removed });
    await uploadForm16ForHr('hr', 'asha', { fy: LAST, part: 'b', file: pdf('asha-b.pdf') }, nov);
    rows = await form16Documents().find({ org: ORG, userId: 'asha', fy: LAST }).sort({ part: 1 }).toArray();
    check('then a Part B ("b") sits beside it', rows.map((r) => r.part).join() === 'A,B' && stored.size === 2, rows.map((r) => r.part));
    const againA = await uploadForm16ForHr('hr', 'asha', { fy: LAST, part: 'A', file: pdf('asha-a2.pdf') }, nov);
    check('a new Part A replaces the old one, same row', againA.id === partA.id && againA.fileName === 'asha-a2.pdf' && stored.size === 2, againA);
    const mineParts = (await myForm16('asha', nov)).years[1];
    check('the app lists both parts, A first', mineParts.documents.map((d) => d.part).join() === 'A,B', mineParts.documents);
    await uploadForm16ForHr('hr', 'asha', { fy: LAST, part: 'combined', file: pdf('asha-full.pdf') }, nov);
    rows = await form16Documents().find({ org: ORG, userId: 'asha', fy: LAST }).toArray();
    check('a combined file replaces both parts', rows.length === 1 && rows[0].part === 'combined' && stored.size === 1, rows);
    await uploadForm16ForHr('hr', 'asha', { fy: '2024-25', file: pdf('asha-2024.pdf') }, nov);

    // —— HR: a batch ——
    console.log('a batch');
    const batch = await bulkUploadForm16ForHr('hr', {
      fy: LAST,
      files: [
        pdf('Form16_BCDEF2345G_FY2025-26.pdf'), // Bala by PAN (Oscar elsewhere shares it: not this company)
        pdf('CS379_PartA.pdf'), // Dev, not Chitra
        pdf('cs3 form 16.pdf'), // Chitra, any case
        pdf('E-EVE Part-B.pdf'),
        pdf('ZZZZZ9999Z.pdf'), // a PAN nobody has
        pdf('YYYYY8888Y_E-ASHA.pdf'), // a PAN nobody has, next to someone's employee ID: never Asha's
        pdf('random.pdf'),
        notPdf('E-NEW.pdf'),
        pdf('CS379 Part A copy.pdf'), // Dev's Part A twice in one batch
      ],
    }, nov);
    const got = Object.fromEntries(batch.uploaded.map((u) => [u.fileName, `${u.userId}:${u.document.part}:${u.matchedBy}`]));
    check('PAN in the name matches Bala in this company only', got['Form16_BCDEF2345G_FY2025-26.pdf'] === 'bala:combined:pan', got);
    check('CS379 is Dev\'s Part A, by employee ID', got['CS379_PartA.pdf'] === 'dev:A:employeeId', got);
    check('"cs3 form 16" is Chitra (whole word, any case)', got['cs3 form 16.pdf'] === 'chitra:combined:employeeId', got);
    check('"E-EVE Part-B" is Eve\'s Part B', got['E-EVE Part-B.pdf'] === 'eve:B:employeeId', got);
    const why = Object.fromEntries(batch.unmatched.map((u) => [u.fileName, u.reason]));
    check('an unknown PAN and a name with nothing in it are listed back', /No employee/.test(why['ZZZZZ9999Z.pdf'] ?? '') && /No employee/.test(why['random.pdf'] ?? ''), why);
    check('a file named by an unknown PAN is never matched by an employee ID in it', !got['YYYYY8888Y_E-ASHA.pdf'] && /PAN/.test(why['YYYYY8888Y_E-ASHA.pdf'] ?? ''), [got, why]);
    check('a file that is not a PDF is listed back', /PDF/.test(why['E-NEW.pdf'] ?? ''), why);
    check('the same person and part twice in a batch: the second is listed back', /already/.test(why['CS379 Part A copy.pdf'] ?? ''), why);
    check('4 stored, 5 listed back', batch.uploaded.length === 4 && batch.unmatched.length === 5, { up: batch.uploaded.length, un: batch.unmatched.length });
    const forced = await bulkUploadForm16ForHr('hr', { fy: LAST, part: 'B', files: [pdf('CS379.pdf')] }, nov);
    check('a part for the whole batch wins over the name', forced.uploaded[0]?.document.part === 'B', forced);
    check('a batch for this FY: 409', (await refusal(() => bulkUploadForm16ForHr('hr', { fy: '2026-27', files: [pdf('CS379.pdf')] }, nov)))?.status === 409);
    check('an empty batch: 400', (await refusal(() => bulkUploadForm16ForHr('hr', { fy: LAST, files: [] }, nov)))?.status === 400);
    check('a batch without payroll access: 403', (await refusal(() => bulkUploadForm16ForHr('hrleave', { fy: LAST, files: [pdf('CS379.pdf')] }, nov)))?.status === 403);
    const elsewhere = await bulkUploadForm16ForHr('ohr', { fy: LAST, files: [pdf('E-ASHA.pdf')] }, nov);
    check('another company\'s batch matches its own people only', elsewhere.uploaded[0]?.userId === 'oscar', elsewhere);

    // —— HR's list ——
    console.log('HR\'s list');
    const list = await form16ForHr('hr', undefined, nov);
    const names = list.employees.map((e) => e.userId);
    check('defaults to FY 2025-26, ready by 15 Jun 2026, ended', list.fy === LAST && list.readyBy === '2026-06-15' && list.ended, list);
    check('lists the people here by the FY\'s end, plus anyone paid in it', ['asha', 'bala', 'chitra', 'dev', 'eve', 'gone'].every((u) => names.includes(u)), names);
    check('not someone who joined after it, nor a hidden support account, nor another company', !names.includes('newbie') && !names.includes('support') && !names.includes('oscar'), names);
    const asha = list.employees.find((e) => e.userId === 'asha')!;
    check('with each person\'s files and PAN\'s last four', asha.documents.length === 1 && asha.documents[0].part === 'combined' && asha.panLast4 === '234F', asha);
    check('counts: who has one', list.counts.withForm16 === 5 && list.counts.employees === list.employees.length, list.counts);
    const dev = list.employees.find((e) => e.userId === 'dev')!;
    check('Dev has Part A and Part B', dev.documents.map((d) => d.part).join() === 'A,B', dev.documents);
    check('without payroll access HR cannot list: 403', (await refusal(() => form16ForHr('hrleave', LAST, nov)))?.status === 403);
    const older = await form16ForHr('hr', '2024-25', nov);
    check('another FY lists its own files', older.fy === '2024-25' && older.counts.withForm16 === 1, older.counts);
    const thisYear = await form16ForHr('hr', '2026-27', nov);
    check('this FY lists, marked not ended', thisYear.ended === false && thisYear.readyBy === '2027-06-15', thisYear);

    // —— the employee's years ——
    console.log('the app\'s years');
    const ashaYears = await myForm16('asha', nov);
    check('Asha: 2026-27 pending, 2025-26 ready, 2024-25 ready', ashaYears.years.map((y) => `${y.fy}:${y.status}`).join() === '2026-27:pending,2025-26:ready,2024-25:ready', ashaYears.years);
    await deleteForm16ForHr('hr', (await form16Documents().findOne({ org: ORG, userId: 'eve', fy: LAST }))!._id.toHexString());
    const eve = await myForm16('eve', nov);
    check('Eve, paid in FY 2025-26 with nothing filed after 15 Jun: missing', eve.years.map((y) => `${y.fy}:${y.status}`).join() === '2026-27:pending,2025-26:missing', eve.years);
    const eveJune = await myForm16('eve', new Date('2026-06-10T06:00:00Z'));
    check('on 10 Jun 2026 the same year is pending, ready by 15 Jun 2026', eveJune.years.map((y) => `${y.fy}:${y.status}:${y.readyBy}`).join() === '2026-27:pending:2027-06-15,2025-26:pending:2026-06-15', eveJune.years);
    const eveMarch = await myForm16('eve', march);
    check('on 10 Mar 2026 this FY is 2025-26 (pending) and the tip is for 2024-25 (31 Jul 2025)', eveMarch.currentFy === LAST && eveMarch.filing.fy === '2024-25'
      && eveMarch.filing.lastDate === '2025-07-31' && eveMarch.years.map((y) => `${y.fy}:${y.status}`).join() === '2025-26:pending', eveMarch);
    const bala = await myForm16('bala', nov);
    check('a draft run is not pay: Bala\'s year is there only for his file', bala.years.map((y) => `${y.fy}:${y.status}`).join() === '2026-27:pending,2025-26:ready', bala.years);
    const nina = await myForm16('newbie', nov);
    check('someone with no pay last FY sees only this FY', nina.years.length === 1, nina.years);

    // —— HR opens and removes ——
    console.log('HR opens and removes');
    const ashaDoc = asha.documents[0];
    const hrLink = await form16FileForHr('hr', ashaDoc.id);
    check('HR opens a file', hrLink.url.includes('/asha/') && hrLink.fileName === 'asha-full.pdf', hrLink);
    check('another company\'s HR cannot: 404', (await refusal(() => form16FileForHr('ohr', ashaDoc.id)))?.status === 404);
    check('without payroll access: 403', (await refusal(() => form16FileForHr('hrleave', ashaDoc.id)))?.status === 403);
    const before = stored.size;
    const gone = await deleteForm16ForHr('hr', ashaDoc.id);
    check('HR removes it: the row and the stored file', gone.removed.id === ashaDoc.id && stored.size === before - 1 && !(await form16Documents().findOne({ _id: new ObjectId(ashaDoc.id) })), gone);
    check('removing it again: 404', (await refusal(() => deleteForm16ForHr('hr', ashaDoc.id)))?.status === 404);
    check('the dashboard tab rule: payroll tabs only', JSON.stringify(tabsForRequest('POST', '/admin/payroll/form16/bulk')) === JSON.stringify(['salarydetails', 'payruns']), tabsForRequest('POST', '/admin/payroll/form16/bulk'));

    // —— over HTTP, with real multipart uploads ——
    console.log('over HTTP');
    const now = new Date();
    const fy = previousFy(currentFy(now));
    for (const userId of ['hr', 'hrleave', 'asha', 'bala', 'ohr']) {
      tokens[userId] = `tok-${randomUUID()}`;
      await authSessions().insertOne({ tokenHash: hashSessionToken(tokens[userId]), userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) });
    }
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    const one = new FormData();
    one.append('part', 'combined');
    one.append('file', blob('%PDF-1.7 bala'), 'bala.pdf');
    const up = await call('hr', 'POST', `/admin/payroll/form16/employees/bala?fy=${fy}`, one);
    check('POST /admin/payroll/form16/employees/:userId stores a PDF', up.status === 200 && up.body.document?.part === 'combined' && up.body.document?.fy === fy, up);
    const fake = new FormData();
    fake.append('file', new Blob([Buffer.from('GIF89a')]), 'bala.pdf');
    const refused = await call('hr', 'POST', `/admin/payroll/form16/employees/bala?fy=${fy}`, fake);
    check('a file named .pdf that is not one: 400', refused.status === 400 && /PDF/.test(refused.body.message ?? ''), refused);
    const big = new FormData();
    big.append('file', new Blob([Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3 * 1024 * 1024)])]), 'big.pdf');
    const tooBig = await call('hr', 'POST', `/admin/payroll/form16/employees/bala?fy=${fy}`, big);
    check('over 3 MB: 413', tooBig.status === 413, tooBig);
    const many = new FormData();
    many.append('fy', fy);
    many.append('files', blob('%PDF-1.7 a'), 'E-ASHA_PartA.pdf');
    many.append('files', blob('%PDF-1.7 b'), 'nobody.pdf');
    const bulk = await call('hr', 'POST', '/admin/payroll/form16/bulk', many);
    check('POST /admin/payroll/form16/bulk matches by name (fy in the form)', bulk.status === 200 && bulk.body.uploaded?.[0]?.userId === 'asha' && bulk.body.uploaded?.[0]?.document?.part === 'A' && bulk.body.unmatched?.[0]?.fileName === 'nobody.pdf', bulk);
    const leave = await call('hrleave', 'GET', `/admin/payroll/form16?fy=${fy}`);
    check('the dashboard tab rule refuses Leaves-only HR: 403', leave.status === 403, leave);
    const hrList = await call('hr', 'GET', `/admin/payroll/form16?fy=${fy}`);
    check('GET /admin/payroll/form16 lists the FY', hrList.status === 200 && hrList.body.fy === fy && hrList.body.employees?.some((e: Json) => e.userId === 'bala' && e.documents.length === 1), hrList.body.counts);
    const app16 = await call('bala', 'GET', '/payroll/form16');
    const balaYear = app16.body.form16?.years?.find((y: Json) => y.fy === fy);
    check('GET /payroll/form16: the app\'s years', app16.status === 200 && app16.body.form16?.currentFy === currentFy(now) && balaYear?.status === 'ready', app16.body);
    const file = await call('bala', 'GET', `/payroll/form16/${balaYear?.documents?.[0]?.id}/file`);
    check('GET /payroll/form16/:id/file gives a link', file.status === 200 && typeof file.body.url === 'string' && file.body.fileName === 'bala.pdf', file.body);
    const notMine = await call('asha', 'GET', `/payroll/form16/${balaYear?.documents?.[0]?.id}/file`);
    check('another person\'s file: 404', notMine.status === 404, notMine);
    await companies().updateOne({ id: 'otherco' }, { $set: { 'payrollEmployee.appEnabled': false } });
    const off = await call('ohr', 'GET', '/payroll/form16');
    check('Payroll off for the company: 403 payroll_app_off', off.status === 403 && off.body.details?.reason === 'payroll_app_off', off.body);
    const del = await call('hr', 'DELETE', `/admin/payroll/form16/${up.body.document?.id}`);
    check('DELETE /admin/payroll/form16/:id', del.status === 200 && del.body.removed?.id === up.body.document?.id, del.body);
  } catch (error) {
    console.error(error);
    failed += 1;
  } finally {
    setForm16StorageForTests(null);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    try {
      if (getDb().databaseName === SCRATCH) await getDb().dropDatabase();
    } catch {
      // never connected
    }
    await closeDb().catch(() => undefined);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
