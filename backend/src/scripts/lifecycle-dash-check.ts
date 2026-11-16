/**
 * The HR dashboard's onboarding side against the coverage audit's gaps,
 * in-process on its own scratch database (routes through a mocked request,
 * services directly):
 *
 *  - pay: one "may see pay" rule (admin or a payroll tab; Documents is not one)
 *    for the panel, the decision, the offer routes, merge values and letters;
 *  - a sent confirmation / extension letter does `confirmation_letter` (the
 *    reveal, with a letterUrl the joiner can open), a relieving letter the
 *    exit's `relieving_letter`;
 *  - the bank/PF change: decided by payroll access, HR's view only;
 *  - the onboarding tab alone sees documents as status only, never the files;
 *  - Nudge: email to a candidate, push to the joiner and the manager, once a
 *    day per task, never for HR's own tasks;
 *  - the sidebar counts, the Needs attention filter, a template's journeys;
 *  - email drafts and extra attachments, the offer's portal-link switch, the
 *    relieving letter's personal email, Annexure A's salary breakup.
 *
 *   npm run lifecycle:dash-check   (MONGODB_DB=el_dash_onb_check; local mongod only)
 */
import { createHash, randomBytes } from 'node:crypto';

process.env.MONGODB_URI = process.env.EL_DASH_MONGO_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_dash_onb_check';
process.env.EMAIL_ORGS = 'el-dash';
process.env.NOTIFY_ORGS = 'el-dash';
process.env.AWS_S3_BUCKET = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = '';
process.env.PORTAL_BASE_URL = 'http://localhost:5181';
process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 800)}`}`); }
}
function eq(label: string, got: unknown, want: unknown) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '(no refusal)' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}
const section = (name: string) => console.log(`\n${name}`);
const PDF = (text = 'letter') => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake image bytes')]);

type Mock = { status: number; body: unknown; next: boolean; headers: Record<string, string> };
type Handler = { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.mongoUri)) throw new Error(`refusing to run against ${env.mongoUri}`);
  if (!/^el_dash_/.test(env.mongoDbName)) throw new Error(`refusing to run against database ${env.mongoDbName}`);
  await (await db.connectDb()).dropDatabase();
  await db.closeDb();
  await db.connectDb();

  const { lifecycleOutbox, clearLifecycleOutbox } = await import('../services/lifecycle/emails');
  const rules = await import('../services/lifecycle/dueRules');
  const engine = await import('../services/lifecycle/engine');
  const board = await import('../services/lifecycle/board');
  const probation = await import('../services/lifecycle/probation');
  const app = await import('../services/lifecycle/appOnboarding');
  const offersSvc = await import('../services/lifecycle/offers');
  const lettersSvc = await import('../services/lifecycle/letters');
  const nudges = await import('../services/lifecycle/nudges');
  const templates = await import('../services/lifecycle/templates');
  const files = await import('../services/lifecycle/files');
  const { lifecycleAdminRouter } = await import('../routes/lifecycle-admin.routes');
  const { lifecycleOfferRouter } = await import('../routes/lifecycle-offer.routes');
  const { lifecycleAppRouter } = await import('../routes/lifecycle-app.routes');

  const ORG = 'el-dash';
  const now = new Date();
  const TODAY = rules.todayKey(now);
  const day = (n: number) => rules.addDaysKey(TODAY, n);

  await db.companies().insertOne({ id: ORG, name: 'Dash Check Co', features: { lifecycle: true }, profile: { displayName: 'Dash Check Co', replyToEmail: 'hr@dash.test' } } as never);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@dash.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
  });
  await db.users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, employeeId: 'H1' }),
    person('onb', 'Ishaan IT', { dashboardAccess: true, dashboardTabs: ['onboarding'] }),
    person('onbhr', 'Olga People', { dashboardAccess: true, dashboardTabs: ['onboarding', 'employees'] }),
    person('onbdocs', 'Dev Docs', { dashboardAccess: true, dashboardTabs: ['onboarding', 'lifecycle_documents'] }),
    person('pay', 'Priya Payroll', { dashboardAccess: true, dashboardTabs: ['onboarding', 'payruns'] }),
    person('mgr', 'Neha Rao', { role: 'manager', designation: 'Design lead', employeeId: 'M1' }),
  ] as never[]);
  const sessions: Record<string, string> = {};
  for (const userId of ['hr', 'onb', 'onbhr', 'onbdocs', 'pay']) {
    sessions[userId] = randomBytes(32).toString('hex');
    await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(sessions[userId]).digest('hex'), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  }
  const sessionFor = async (userId: string) => {
    if (!sessions[userId]) {
      sessions[userId] = randomBytes(32).toString('hex');
      await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(sessions[userId]).digest('hex'), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
    }
    return sessions[userId];
  };

  /** A request through a router as Express would send it: `mount` + url for the tab rules, the query parsed. */
  const call = (router: Handler, mount: string, method: string, url: string, who: string | undefined, payload: unknown = {}): Promise<Mock> =>
    new Promise((resolve) => {
      const headers: Record<string, string> = who ? { authorization: `Bearer ${who}` } : {};
      const out: Mock = { status: 200, body: undefined, next: false, headers: {} };
      const [path, qs = ''] = url.split('?');
      const req = {
        method, url, originalUrl: `${mount}${url}`, path, headers, header: (n: string) => headers[n.toLowerCase()], get: (n: string) => headers[n.toLowerCase()],
        body: payload, query: Object.fromEntries(new URLSearchParams(qs)), params: {}, socket: { remoteAddress: '127.0.0.1' }, requestId: 'check',
      };
      const res = {
        statusCode: 200, headersSent: false, locals: {},
        status(code: number) { out.status = code; this.statusCode = code; return this; },
        json(b: unknown) { out.body = b; this.headersSent = true; resolve(out); return this; },
        send(b: unknown) { out.body = b; this.headersSent = true; resolve(out); return this; },
        setHeader(k: string, v: string) { out.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; },
      };
      const next = (err?: unknown) => { out.next = !err; if (err) { out.status = 500; out.body = String(err); } resolve(out); };
      router.handle(req, res, next);
    });
  const admin = (method: string, url: string, userId: string, payload?: unknown) => call(lifecycleAdminRouter as never, '/admin/lifecycle', method, url, sessions[userId], payload);
  const offerApi = (method: string, url: string, userId: string, payload?: unknown) => call(lifecycleOfferRouter as never, '/admin/lifecycle', method, url, sessions[userId], payload);
  const has = (x: unknown, text: string) => JSON.stringify(x ?? null).includes(text);

  const HR = { userId: 'hr', name: 'Hema HR', org: ORG, seesPay: true };
  const NOPAY = { userId: 'onb', name: 'Ishaan IT', org: ORG, seesPay: false };
  const fields = (extra: Record<string, unknown> = {}) => ({
    designation: 'Product Designer', department: 'Design', location: 'Bengaluru', ctc: 1_437_000, tj: day(20), managerUserId: 'mgr',
    probationMonths: 6, noticeDays: 60, validTill: day(7), ...extra,
  });

  // ─── a candidate with an offer, a joiner in week 1, two in the final month, a leaver
  const created = await offersSvc.createOffer(HR, { candidate: { name: 'Kabir Mehta', personalEmail: 'kabir.dash@example.com' }, fields: fields() });
  const A = created.journeyId;
  await offersSvc.uploadOfferPdf(HR, A, { originalname: 'Offer letter.pdf', buffer: PDF('offer') });
  await offersSvc.sendOffer(HR, A, { subject: 'Your offer', body: 'Hi Kabir,\n\nYour offer is attached.' });

  const joinAt = async (name: string, userId: string, tj: string) => {
    const j = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name, personalEmail: `${userId}@example.com` }, tj, managerUserId: 'mgr', designation: 'Analyst', department: 'Design' });
    for (const s of ['offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const) await engine.setJourneyStatus(j.id, s);
    await engine.completeTask(j.id, 'sign_letters');
    await db.users().insertOne(person(userId, name, { managerUserId: 'mgr', department: 'Design', designation: 'Analyst', employeeId: `E-${userId}`, joiningDate: new Date(`${tj}T00:00:00Z`) }) as never);
    await engine.onJoined(j.id, userId);
    return engine.loadJourney(j.id);
  };
  const finalTj = rules.addDaysKey(rules.addMonthsKey(TODAY, -5), -3);
  const W = await joinAt('Isha Verma', 'isha', day(-3));
  const C = await joinAt('Ishita Kaur', 'ishita', finalTj);
  const X = await joinAt('Sameer Khan', 'sameer', finalTj);
  const taskOf = async (journeyId: string, key: string) => (await engine.tasksOf(journeyId)).find((t) => t.systemKey === key && t.status !== 'cancelled')!;

  // ─── Pay ───────────────────────────────────────────────────────────────────
  section('Pay: one "may see pay" rule, everywhere');
  eq('The rule: admin and a payroll tab see pay; onboarding, Documents and People do not',
    [['hr', { dashboardAdmin: true }], ['onb', { dashboardTabs: ['onboarding'] }], ['onbdocs', { dashboardTabs: ['onboarding', 'lifecycle_documents'] }], ['pay', { dashboardTabs: ['payruns'] }], ['sal', { dashboardTabs: ['salarydetails'] }], ['all', {}]]
      .map(([, u]) => board.lifecycleViewer(u as never).seesPay), [true, false, false, true, true, true]);
  const panelHr = await admin('GET', `/journeys/${A}`, 'hr');
  const panelOnb = await admin('GET', `/journeys/${A}`, 'onb');
  ok('GET /journeys/:id: the offer CTC for an admin', panelHr.status === 200 && (panelHr.body as { offer: { fields: { ctc?: number } } }).offer.fields.ctc === 1_437_000, panelHr.status);
  ok('…never for the onboarding tab alone', panelOnb.status === 200 && !('ctc' in (panelOnb.body as { offer: { fields: object } }).offer.fields) && !has(panelOnb.body, '1437000'), panelOnb.body);
  const offerDocs = await offerApi('GET', `/offers/${A}`, 'onbdocs');
  ok('GET /offers/:id: the Documents tab is not a pay tab (no CTC)', offerDocs.status === 200 && !has(offerDocs.body, '1437000'), offerDocs);
  eq('…so it cannot change the CTC either', (await offerApi('PUT', `/offers/${A}`, 'onbdocs', { fields: fields({ ctc: 1 }) })).status, 403);
  const offerPay = await offerApi('GET', `/offers/${A}`, 'pay');
  ok('…while Payroll runs sees it', has(offerPay.body, '1437000'), offerPay.status);

  section('Pay: the decision');
  const refusedSalary = await admin('POST', `/journeys/${C.id}/decision`, 'onb', { outcome: 'confirm', salary: 1_600_000 });
  eq('Recording a salary without pay access: 403', refusedSalary.status, 403);
  eq('…and nothing was decided', (await engine.loadJourney(C.id)).probation?.decision, undefined);
  ok('The service refuses it too', (await refusal(() => probation.recordDecision(C.id, { userId: 'onb', name: 'Ishaan IT', seesPay: false }, { outcome: 'confirm', salary: 5 }))).status === 403);
  const decided = await admin('POST', `/journeys/${C.id}/decision`, 'pay', { outcome: 'confirm', salary: 1_600_000, designation: 'Senior Analyst' });
  ok('With Payroll runs: decided with the salary', decided.status === 200 && (decided.body as { decision: { salary?: number } }).decision.salary === 1_600_000, decided.body);
  const cOnb = await admin('GET', `/journeys/${C.id}`, 'onb');
  ok('The panel never shows the onboarding tab the decision’s salary', cOnb.status === 200 && (cOnb.body as { probation: { decision: { outcome: string } } }).probation.decision.outcome === 'confirm' && !has(cOnb.body, '1600000'), cOnb.body);
  ok('…nor GET /journeys/:id/probation', !has((await admin('GET', `/journeys/${C.id}/probation`, 'onb')).body, '1600000'));
  ok('…while Payroll runs sees it', has((await admin('GET', `/journeys/${C.id}`, 'pay')).body, '1600000'));
  const putOnb = await admin('PUT', `/journeys/${C.id}`, 'onb', { buddyUserId: 'mgr' });
  ok('PUT /journeys/:id answers without the salary', putOnb.status === 200 && !has(putOnb.body, '1600000'), putOnb.body);

  section('Pay: merge values and letters');
  const mergeOnb = await offerApi('GET', `/letters/merge?kind=confirmation&journeyId=${C.id}`, 'onbdocs');
  ok('letters/merge for a confirmation letter: no CTC without pay', mergeOnb.status === 200 && !('ctc' in (mergeOnb.body as { values: object }).values) && !('ctcWords' in (mergeOnb.body as { values: object }).values), mergeOnb.body);
  const mergeHr = await offerApi('GET', `/letters/merge?kind=confirmation&journeyId=${C.id}`, 'hr');
  ok('…with pay the field is there', mergeHr.status === 200 && 'ctc' in (mergeHr.body as { values: object }).values);
  const mergeOfferHr = await offerApi('GET', `/letters/merge?kind=offer&journeyId=${A}`, 'hr');
  ok('…and an offer’s merge carries the CTC for pay', has(mergeOfferHr.body, '14,37,000'), mergeOfferHr.body);
  eq('…and an offer letter’s merge is refused outright', (await offerApi('GET', `/letters/merge?kind=offer&journeyId=${A}`, 'onbdocs')).status, 403);
  const madeOnb = await offerApi('POST', '/letters', 'onbdocs', { kind: 'confirmation', journeyId: C.id });
  ok('POST /letters answers without pay values', madeOnb.status === 200 && !has((madeOnb.body as { letter: { values: object } }).letter.values, 'ctc'), madeOnb.body);
  const listOnb = await offerApi('GET', `/letters?journeyId=${C.id}`, 'onbdocs');
  ok('GET /letters: no pay values', listOnb.status === 200 && (listOnb.body as { letters: Array<{ values: object }> }).letters.every((l) => !has(l.values, 'ctc')), listOnb.body);

  // ─── Letters → tasks ───────────────────────────────────────────────────────
  section('A sent letter does its task');
  const otherKind = await lettersSvc.createLetter(HR, { kind: 'extension', journeyId: C.id, values: { extensionMonths: '2 months', extensionUntil: 'Mon 1 Jun 2027', probationEndsOn: 'Sat 1 May 2027' } });
  await lettersSvc.uploadLetterPdf(HR, otherKind.id, { originalname: 'Extension.pdf', buffer: PDF('ext') });
  await lettersSvc.sendLetter(HR, otherKind.id, { to: 'ishita@example.com', subject: 'Letter', body: 'Attached.' });
  eq('An extension letter for a confirm decision does not do the confirmation task', (await taskOf(C.id, 'confirmation_letter')).status === 'done', false);
  const conf = await lettersSvc.createLetter(HR, { kind: 'confirmation', journeyId: C.id });
  await lettersSvc.uploadLetterPdf(HR, conf.id, { originalname: 'Confirmation letter - Ishita Kaur.pdf', buffer: PDF('confirmation') });
  ok('No reveal before the letter is sent', !(await app.revealForMe({ userId: 'ishita', name: 'Ishita Kaur', org: ORG })).ready);
  await lettersSvc.sendLetter(HR, conf.id, { to: 'ishita@example.com', subject: 'Your confirmation letter', body: 'Congratulations.' });
  const cTask = await taskOf(C.id, 'confirmation_letter');
  eq('Sending the confirmation letter: confirmation_letter done by HR, the decision keeps the letter',
    [cTask.status, cTask.doneByName, (await engine.loadJourney(C.id)).probation?.decision?.letterId], ['done', 'Hema HR', conf.id]);
  const reveal = await app.revealForMe({ userId: 'ishita', name: 'Ishita Kaur', org: ORG }) as { ready: boolean; letterUrl?: string; outcome?: string };
  eq('The reveal is ready with a letterUrl the app opens', [reveal.ready, reveal.outcome, reveal.letterUrl], [true, 'confirm', `/lifecycle/onboarding/letters/${conf.id}/pdf`]);
  const appLetter = await call(lifecycleAppRouter as never, '/lifecycle', 'GET', `/onboarding/letters/${conf.id}/pdf`, await sessionFor('ishita'));
  ok('GET /lifecycle/onboarding/letters/:id/pdf: their own letter, as a PDF', appLetter.status === 200 && Buffer.isBuffer(appLetter.body) && (appLetter.body as Buffer).subarray(0, 5).toString() === '%PDF-' && appLetter.headers['Content-Type'] === 'application/pdf', appLetter.status);
  eq('…another employee gets 404', (await call(lifecycleAppRouter as never, '/lifecycle', 'GET', `/onboarding/letters/${conf.id}/pdf`, await sessionFor('isha'))).status, 404);
  eq('…no session: 401', (await call(lifecycleAppRouter as never, '/lifecycle', 'GET', `/onboarding/letters/${conf.id}/pdf`, undefined)).status, 401);
  const unsent = await lettersSvc.createLetter(HR, { kind: 'confirmation', journeyId: C.id });
  await lettersSvc.uploadLetterPdf(HR, unsent.id, { buffer: PDF('draft') });
  ok('…a letter not sent yet is not served', (await refusal(() => lettersSvc.letterPdfForEmployee(ORG, 'ishita', unsent.id))).status === 404);

  await probation.recordDecision(X.id, { userId: 'hr', name: 'Hema HR', seesPay: true }, { outcome: 'extend', extendMonths: 2 });
  const ext = await lettersSvc.createLetter(HR, { kind: 'extension', userId: 'sameer' });
  await lettersSvc.uploadLetterPdf(HR, ext.id, { buffer: PDF('extension') });
  await lettersSvc.sendLetter(HR, ext.id, { to: 'sameer@example.com', subject: 'Your probation extension letter', body: 'Attached.' });
  eq('An extension letter picked by the employee (no journey id) does the task too', [(await taskOf(X.id, 'confirmation_letter')).status, (await engine.loadJourney(X.id)).probation?.decision?.letterId], ['done', ext.id]);

  await db.users().insertOne(person('leaver', 'Pooja Iyer', { managerUserId: 'mgr', employeeId: 'E-77', designation: 'Accountant', personalEmail: 'pooja.personal@example.com' }) as never);
  const O = await engine.createOffboardingJourney(ORG, 'leaver', day(10), 'resignation', 'hr');
  const reliefMerge = await lettersSvc.mergeValues(ORG, { kind: 'relieving', userId: 'leaver' }, 'Hema HR');
  eq('The relieving letter goes to the personal email by default', reliefMerge.values.personalEmail, 'pooja.personal@example.com');
  const relief = await lettersSvc.createLetter(HR, { kind: 'relieving', userId: 'leaver', values: { lastWorkingDay: 'Thu 26 Nov 2026' } });
  await lettersSvc.uploadLetterPdf(HR, relief.id, { buffer: PDF('relieving') });
  eq('Before it is sent the exit’s relieving task is open', (await taskOf(O.id, 'relieving_letter')).status === 'done', false);
  await lettersSvc.sendLetter(HR, relief.id, { to: reliefMerge.values.personalEmail, subject: 'Your relieving letter', body: 'Attached.' });
  eq('Sending the relieving letter does the exit’s relieving_letter', (await taskOf(O.id, 'relieving_letter')).status, 'done');

  // ─── Bank / PF ─────────────────────────────────────────────────────────────
  section('The week-1 bank / PF change');
  await db.journeys().updateOne({ id: W.id }, { $set: { bankPfRequest: { status: 'pending', changes: { bankName: 'HDFC Bank', ifsc: 'HDFC0001234', accountLast4: '4417' }, requestedAt: new Date() } } });
  ok('HR sees the request on the panel', has((await admin('GET', `/journeys/${W.id}`, 'hr')).body, '"accountLast4":"4417"'));
  ok('The onboarding tab alone does not', !has((await admin('GET', `/journeys/${W.id}`, 'onb')).body, 'bankPfRequest'));
  eq('Deciding it without payroll access: 403', (await admin('POST', `/journeys/${W.id}/bank-pf-request`, 'onbhr', { decision: 'decline' })).status, 403);
  const declined = await admin('POST', `/journeys/${W.id}/bank-pf-request`, 'hr', { decision: 'decline', note: 'Send a cancelled cheque' });
  eq('An admin declines it; the joiner is told', [declined.status, (declined.body as { journey: { bankPfRequest: { status: string } } }).journey.bankPfRequest.status, await db.notifications().countDocuments({ userId: 'isha', scenario: 'lifecycle_bank_pf_decided' })], [200, 'declined', 1]);

  // ─── Documents: status only for the onboarding tab ─────────────────────────
  section('Candidates’ documents are HR’s');
  const idFile = await files.storeFile(ORG, A, { name: 'Aadhaar.jpg', contentType: 'image/jpeg', bytes: JPG }, 'candidate');
  const idDoc = (await db.candidateDocuments().findOne({ journeyId: A, docKey: 'id_proof' }))!;
  await db.candidateDocuments().updateOne({ id: idDoc.id }, { $set: { fileIds: [idFile.id], status: 'in_review', uploadedAt: new Date() } });
  type DocRow = { id: string; status: string; files: Array<{ name: string }>; fileIds: unknown[] };
  const docsOnb = ((await admin('GET', `/journeys/${A}`, 'onb')).body as { documents: DocRow[] }).documents.find((d) => d.id === idDoc.id);
  const docsHr = ((await admin('GET', `/journeys/${A}`, 'onbhr')).body as { documents: DocRow[] }).documents.find((d) => d.id === idDoc.id);
  ok('The panel: the onboarding tab alone sees the status, no files', docsOnb?.status === 'in_review' && docsOnb.files.length === 0 && docsOnb.fileIds.length === 0 && !has(docsOnb, 'Aadhaar.jpg'), docsOnb);
  ok('…People › Employees (HR) sees the files', docsHr?.files[0]?.name === 'Aadhaar.jpg', docsHr);
  ok('GET /journeys/:id/documents: the same', !has((await offerApi('GET', `/journeys/${A}/documents`, 'onb')).body, 'Aadhaar.jpg') && has((await offerApi('GET', `/journeys/${A}/documents`, 'onbhr')).body, 'Aadhaar.jpg'));
  eq('GET /files/:id of an ID proof: 403 for the onboarding tab alone', (await offerApi('GET', `/files/${idFile.id}`, 'onb')).status, 403);
  eq('…200 for HR', (await offerApi('GET', `/files/${idFile.id}`, 'onbhr')).status, 200);
  eq('Reviewing a document needs HR', (await offerApi('POST', `/documents/${idDoc.id}/review`, 'onb', { decision: 'approve' })).status, 403);

  // ─── Nudge ─────────────────────────────────────────────────────────────────
  section('Nudge / Remind');
  clearLifecycleOutbox();
  const accept = await taskOf(A, 'accept_offer');
  const n1 = await admin('POST', `/journeys/${A}/tasks/${accept.id}/nudge`, 'hr');
  const mail = lifecycleOutbox().find((m) => m.to === 'kabir.dash@example.com');
  ok('A candidate gets the lifecycle email', n1.status === 200 && (n1.body as { nudged: { channel: string } }).nudged.channel === 'email' && !!mail && mail.subject.includes(accept.title), n1.body);
  const n2 = await admin('POST', `/journeys/${A}/tasks/${accept.id}/nudge`, 'hr');
  ok('Once per task per day: the second is refused', n2.status === 409 && /tomorrow/i.test((n2.body as { error: string }).error), n2.body);
  eq('…and no second email', lifecycleOutbox().filter((m) => m.to === 'kabir.dash@example.com').length, 1);
  const boardA = await board.onboardingBoard(ORG, 'hr', { tab: 'pre_boarding' });
  const cardA = boardA.columns.flatMap((c) => c.cards).find((c) => c.journeyId === A)!;
  const waitA = cardA.waitingOn.find((w) => w.taskId === accept.id);
  eq('The card’s waiting-on item carries its task, can be nudged, and was today', [!!waitA, waitA?.canNudge, waitA?.nudgedToday], [true, true, true]);
  const hrTask = (await engine.tasksOf(W.id)).find((t) => t.ownerRole === 'hr' && engine.ACTIVE_STATUSES.includes(t.status));
  if (hrTask) eq('A task that waits on HR cannot be nudged', (await admin('POST', `/journeys/${W.id}/tasks/${hrTask.id}/nudge`, 'hr')).status, 409);
  const joinerTask = (await engine.tasksOf(W.id)).find((t) => t.ownerRole === 'employee' && t.status === 'todo')!;
  const n3 = await admin('POST', `/journeys/${W.id}/tasks/${joinerTask.id}/nudge`, 'onb');
  const push = await db.notifications().findOne({ userId: 'isha', scenario: 'lifecycle_nudge' });
  ok('A joiner gets an app push with a lifecycle_ destination', n3.status === 200 && (n3.body as { nudged: { who: string } }).nudged.who === 'joiner' && /^lifecycle_/.test(String(push?.data?.destination)), { body: n3.body, push });
  const mgrTask = (await engine.tasksOf(W.id)).find((t) => ['manager', 'hr_manager'].includes(t.ownerRole) && t.status === 'todo');
  if (mgrTask) {
    const n4 = await admin('POST', `/journeys/${W.id}/tasks/${mgrTask.id}/nudge`, 'hr');
    const mPush = await db.notifications().findOne({ userId: 'mgr', scenario: 'lifecycle_nudge' });
    ok('The manager gets a push naming the joiner', n4.status === 200 && (n4.body as { nudged: { who: string } }).nudged.who === 'manager' && String(mPush?.title).startsWith('Isha Verma') && /^lifecycle_/.test(String(mPush?.data?.destination)), { body: n4.body, mPush });
  } else ok('A manager task exists to nudge', false);
  const locked = (await engine.tasksOf(W.id)).find((t) => t.status === 'locked');
  if (locked) eq('A task not open yet cannot be nudged', (await refusal(() => nudges.nudgeTask(ORG, W.id, locked.id, { userId: 'hr', name: 'Hema HR' }))).status, 409);
  const panelW = (await admin('GET', `/journeys/${W.id}`, 'hr')).body as { tasks: Array<{ id: string; canNudge: boolean; nudgedToday?: boolean }> };
  ok('The panel’s tasks say which can be nudged and which were today', panelW.tasks.find((t) => t.id === joinerTask.id)?.nudgedToday === true && panelW.tasks.some((t) => t.canNudge === false));

  // ─── Counts, filter, template journeys ─────────────────────────────────────
  section('Sidebar counts, the Needs attention filter, a template’s joiners');
  const counts = await admin('GET', '/counts', 'onb');
  const c = (counts.body as { onboarding: { badge: number; needsYou: number; late: number } }).onboarding;
  ok('GET /counts: Needs you + Late, each joiner once', counts.status === 200 && c.badge >= Math.max(c.needsYou, c.late) && c.badge <= c.needsYou + c.late, counts.body);
  const flagged = (await Promise.all((['pre_boarding', 'first_week', 'probation'] as const).map((tab) => board.onboardingBoard(ORG, 'hr', { tab }))))
    .flatMap((b) => b.columns.flatMap((col) => col.cards)).filter((card) => card.flags.includes('needs_you') || card.flags.includes('late')).length;
  eq('…the same joiners the board flags', c.badge, flagged);
  const attention = await admin('GET', '/board?tab=first_week&filter=needs_attention', 'hr');
  ok('filter=needs_attention is a quick filter', attention.status === 200 && (attention.body as { columns: Array<{ cards: Array<{ flags: string[] }> }> }).columns.every((col) => col.cards.every((card) => card.flags.includes('needs_attention'))), attention.body);
  const tpl = (await engine.loadJourney(A)).templateId;
  const tj = await admin('GET', `/templates/${tpl}/journeys`, 'onb');
  const listed = (tj.body as { journeys: Array<{ journeyId: string; name: string }> }).journeys;
  ok('GET /templates/:id/journeys lists who follows it', tj.status === 200 && listed.some((r) => r.journeyId === A && r.name === 'Kabir Mehta') && listed.some((r) => r.journeyId === W.id && r.name === 'Isha Verma'), tj.body);
  eq('…the same number as Joiners using it', listed.length, (await templates.listTemplates(ORG, 'onboarding')).find((t) => t.id === tpl)?.journeysUsing);

  // ─── Drafts, attachments, the portal-link switch ───────────────────────────
  section('Email drafts and extra attachments');
  const policies = await lettersSvc.uploadLetterAttachment(HR, { journeyId: C.id, kind: 'policies' }, { originalname: 'Company policies.pdf', buffer: PDF('policies') });
  eq('An extra file is stored for the letter’s email', [policies.attachment.kind, policies.attachment.name], ['policies', 'Company policies.pdf']);
  ok('A salary breakup cannot be attached without pay', (await refusal(() => lettersSvc.uploadLetterAttachment(NOPAY, { kind: 'salary_breakup' }, { buffer: PDF('x') }))).status === 403);
  const draftLetter = await lettersSvc.createLetter(HR, { kind: 'confirmation', journeyId: C.id });
  await lettersSvc.uploadLetterPdf(HR, draftLetter.id, { buffer: PDF('draft letter') });
  const savedDraft = await offerApi('PUT', `/letters/${draftLetter.id}/draft`, 'hr', { to: 'ishita@example.com', cc: ['mgr@dash.test'], subject: 'Draft subject', body: 'Draft body', attachments: [policies.attachment] });
  ok('Save draft keeps the email on the letter', savedDraft.status === 200 && (await db.letters().findOne({ id: draftLetter.id }))?.email?.subject === 'Draft subject', savedDraft.body);
  const listedDraft = (await lettersSvc.listLetters(ORG, { journeyId: C.id })).find((l) => l.id === draftLetter.id);
  eq('…and it comes back with the letters (to, subject, the attachment, not sent)', [listedDraft?.email?.to, listedDraft?.email?.attachments?.[0]?.fileId, !!listedDraft?.email?.sentAt], ['ishita@example.com', policies.attachment.fileId, false]);
  clearLifecycleOutbox();
  await lettersSvc.sendLetter(HR, draftLetter.id, { to: 'ishita@example.com', subject: 'Draft subject', body: 'Draft body', attachments: [policies.attachment] });
  const withExtra = lifecycleOutbox().find((m) => m.to === 'ishita@example.com');
  eq('Sent: the letter PDF and the extra file', [withExtra?.attachments.length, withExtra?.attachments[0]?.contentType, withExtra?.attachments[1]?.filename], [2, 'application/pdf', 'Company policies.pdf']);
  eq('A sent letter’s draft cannot be saved again', (await refusal(() => lettersSvc.saveLetterDraft(HR, draftLetter.id, { subject: 'x' }))).status, 409);
  const foreign = await files.storeFile('someone-else', undefined, { name: 'x.pdf', contentType: 'application/pdf', bytes: PDF() }, 'hr');
  eq('Another company’s file cannot be attached', (await refusal(() => lettersSvc.saveLetterDraft(HR, unsent.id, { attachments: [{ fileId: foreign.id, kind: 'other' }] }))).status, 404);
  const breakupFile = await lettersSvc.uploadLetterAttachment(HR, { journeyId: A, kind: 'salary_breakup' }, { originalname: 'Salary breakup.pdf', buffer: PDF('breakup') });
  await lettersSvc.saveLetterDraft(HR, unsent.id, { attachments: [breakupFile.attachment] });
  eq('A salary-breakup attachment is a pay file: 403 without pay', (await offerApi('GET', `/files/${breakupFile.attachment.fileId}`, 'onbhr')).status, 403);
  ok('…and it is left out of the letter list without pay', !has((await offerApi('GET', `/letters?journeyId=${C.id}`, 'onbdocs')).body, breakupFile.attachment.fileId));

  section('The offer’s portal-link switch and its extras');
  const B = (await offersSvc.createOffer(HR, { candidate: { name: 'Riya Sen', personalEmail: 'riya.dash@example.com' }, fields: fields() })).journeyId;
  await offersSvc.uploadOfferPdf(HR, B, { originalname: 'Offer letter - Riya Sen.pdf', buffer: PDF('offer b') });
  const offerDraft = await lettersSvc.createLetter(HR, { kind: 'offer', journeyId: B });
  await lettersSvc.saveLetterDraft(HR, offerDraft.id, { subject: 'Saved offer email', body: 'Hi Riya' });
  const checklist = await lettersSvc.uploadLetterAttachment(HR, { journeyId: B, kind: 'joining_checklist' }, { originalname: 'Joining checklist.pdf', buffer: PDF('checklist') });
  clearLifecycleOutbox();
  const sentB = await offerApi('POST', `/offers/${B}/send`, 'hr', { subject: 'Your offer', body: 'Hi Riya,\n\nAttached.', withPortalLink: false, attachments: [checklist.attachment] });
  const mailB = lifecycleOutbox().find((m) => m.to === 'riya.dash@example.com');
  ok('Switch off: the offer email has no portal link', sentB.status === 200 && !!mailB && !/\/o\/[A-Za-z0-9_-]+/.test(mailB.html), sentB.body);
  eq('…and carries the offer PDF and the joining checklist', mailB?.attachments.map((a) => a.filename), ['Offer letter - Riya Sen.pdf', 'Joining checklist.pdf']);
  ok('…the saved offer draft is marked sent', !!(await db.letters().findOne({ id: offerDraft.id }))?.email?.sentAt);
  clearLifecycleOutbox();
  await offersSvc.sendOffer(HR, B, { subject: 'Again', body: 'Hi Riya' });
  ok('Switch on (the default): the link is there', /\/o\/[A-Za-z0-9_-]+/.test(lifecycleOutbox().find((m) => m.to === 'riya.dash@example.com')?.html ?? ''));

  // ─── Annexure A ────────────────────────────────────────────────────────────
  section('Annexure A: the salary breakup from the company’s payroll set-up');
  const none = await offerApi('GET', `/letters/salary-breakup?journeyId=${A}`, 'hr');
  ok('No salary template: no breakup, and the reason says what to set up', none.status === 200 && (none.body as { breakup: unknown }).breakup === null && /salary template/i.test((none.body as { reason: string }).reason), none.body);
  eq('Without pay access: 403', (await offerApi('GET', `/letters/salary-breakup?journeyId=${A}`, 'onbdocs')).status, 403);
  const { ZOHO_CATALOG, ZOHO_TEMPLATES } = await import('./payroll-zoho-check');
  const { STATUTORY_SEED } = await import('./payroll-config-seed-data');
  await db.statutoryConfigs().insertMany(STATUTORY_SEED.map((cfg) => ({ ...structuredClone(cfg), createdAt: new Date(), updatedAt: new Date(), updatedByUserId: null })) as never);
  await db.payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })) as never);
  await db.salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG } as never);
  const some = await lettersSvc.salaryBreakup(ORG, A);
  const sum = (some.breakup?.lines ?? []).reduce((s, l) => s + l.monthly, 0);
  ok('With one: lines from the template, adding up to the monthly CTC', !!some.breakup && some.breakup.lines.length > 1 && Math.abs(sum - some.breakup.ctcMonthly) <= some.breakup.lines.length, { some, sum });
  eq('…for this offer’s CTC, on the template the company uses', [some.breakup?.ctcAnnual, some.templateCode], [1_437_000, ZOHO_TEMPLATES.BELOW_TAXABLE.code]);

  // Clean the scratch uploads this run wrote.
  const { rm } = await import('node:fs/promises');
  const pathMod = await import('node:path');
  for (const org of [ORG, 'someone-else']) await rm(pathMod.resolve(__dirname, '../../.local-uploads/lifecycle', org), { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.closeDb();
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
