/**
 * Pre-boarding end to end, in-process on a scratch database (no HTTP server):
 * offer → PDF → send (the email has the PDF and the link) → the link opens →
 * revise → the old link is replaced → accept (latest only) → finalise (login
 * emailed) → sign-in (lock after 5) → forgot/reset → token audiences kept
 * apart → documents (limits, send back, approve) → letters unlock → open →
 * sign → Day-1 pass locked until Tj − 7 → date request moves Tj (offer v+1,
 * finalise again) → mark joined creates the user with personalEmail → decline,
 * reopen, expiry, not joining → timed mails once each → feature off →
 * another company's HR sees nothing.
 *
 *   npm run portal:check        (MONGODB_DB=el_offer_check, mongod on 127.0.0.1:27133)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
import { createHash, createHmac, randomBytes } from 'node:crypto';

process.env.MONGODB_URI = process.env.EL_OFFER_MONGO_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_offer_check';
process.env.EMAIL_ORGS = 'sowaka,el-other';
process.env.NOTIFY_ORGS = 'nobody-scratch';
process.env.AWS_S3_BUCKET = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = '';
process.env.PORTAL_JWT_SECRET = 'portal-check-secret';
process.env.PORTAL_BASE_URL = 'http://localhost:5181';
process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;
const tokenOf = (out: { token: string } | { closed: unknown }) => { if (!('token' in out)) throw new Error('expected a session, got a closed portal'); return out.token; };
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '(no refusal)' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}
const section = (name: string) => console.log(`\n${name}`);

const PDF = (text = 'offer') => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake image bytes')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')]);
/** A real PDF (pdf-lib), for the checks that load or stamp it. */
async function realPdf(title: string, pages = 2): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i += 1) doc.addPage([595, 842]).drawText(`${title} · page ${i}`, { x: 56, y: 760, size: 14, font });
  return Buffer.from(await doc.save());
}
/** The text drawn on a page of a PDF, decoded from its content stream (pdf-lib writes standard-font text as hex strings). */
async function pageText(pdf: Buffer, pageIndex: number): Promise<string> {
  const { PDFDocument, PDFRawStream, PDFArray, decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPages()[pageIndex < 0 ? doc.getPageCount() + pageIndex : pageIndex];
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  let raw = '';
  for (const stream of streams) if (stream instanceof PDFRawStream) raw += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  return raw.replace(/<([0-9A-Fa-f]+)>/g, (_m, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
}
/** 10:00 IST on a day. */
const at10 = (day: string) => new Date(`${day}T10:00:00+05:30`);

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.mongoUri)) throw new Error(`refusing to run against ${env.mongoUri}`);
  if (!/^el_offer_/.test(env.mongoDbName)) throw new Error(`refusing to run against database ${env.mongoDbName}`);
  await (await db.connectDb()).dropDatabase();
  await db.closeDb();
  await db.connectDb();

  const emails = await import('../services/lifecycle/emails');
  const { addDays, istDate, lifecycleOutbox, clearLifecycleOutbox, formatDay } = emails;
  const offersSvc = await import('../services/lifecycle/offers');
  const docsSvc = await import('../services/lifecycle/documents');
  const lettersSvc = await import('../services/lifecycle/letters');
  const portalSvc = await import('../services/lifecycle/portal');
  const auth = await import('../services/lifecycle/portalAuth');
  const files = await import('../services/lifecycle/files');
  const { lifecycleOfferRouter } = await import('../routes/lifecycle-offer.routes');
  const { portalRouter } = await import('../routes/portal.routes');
  const { requireAuth } = await import('../middleware/auth.middleware');

  const ORG = 'sowaka';
  const OTHER = 'el-other';
  const OFF = 'el-off';
  const today = istDate();
  // About three weeks out, on a weekday (a Saturday or Sunday is a week-off and the offer is refused).
  const tj = (() => { let d = addDays(today, 20); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1); return d; })();

  await db.companies().insertMany([
    { id: ORG, name: 'Sowaka Test', features: { lifecycle: true }, profile: { displayName: 'Sowaka Test', addressLine1: '4th Floor, Example Towers', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', replyToEmail: 'hr@sowaka.test' }, lifecyclePortal: { videoUrl: 'https://videos.example/life.mp4' } },
    { id: OTHER, name: 'Other Test Co', features: { lifecycle: true } },
    { id: OFF, name: 'Lifecycle Off Co', features: {} },
  ] as never);
  const person = (userId: string, org: string, extra: Record<string, unknown> = {}) => ({
    userId, name: userId, email: `${userId}@${org}.test`, org, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
  });
  await db.users().insertMany([
    person('hr', ORG, { name: 'Hema HR', dashboardAccess: true, dashboardAdmin: true, employeeId: 'H1' }),
    person('mgr', ORG, { name: 'Neha Rao', employeeId: 'M1', designation: 'Design lead' }),
    person('it', ORG, { name: 'Ishaan IT', dashboardAccess: true, dashboardTabs: ['onboarding'], employeeId: 'I1' }),
    person('hr2', OTHER, { name: 'Omar Other', dashboardAccess: true, dashboardAdmin: true }),
    person('hr3', OFF, { name: 'Farah Off', dashboardAccess: true, dashboardAdmin: true }),
  ] as never);
  await db.lifecycleTemplates().insertOne({
    id: 'tpl-std', org: ORG, kind: 'onboarding', name: 'Standard', isDefault: true, active: true, settings: { probationMonths: 6 },
    createdAt: new Date(), updatedAt: new Date(),
    tasks: [
      ['send_offer', 'hr', 'dashboard', null], ['accept_offer', 'employee', 'portal', 'offer_sent'], ['finalise_offer', 'hr', 'dashboard', 'accepted'],
      ['portal_sign_in', 'employee', 'portal', 'finalised'], ['upload_documents', 'employee', 'portal', 'finalised'], ['review_documents', 'hr', 'dashboard', 'finalised'],
      ['about_you', 'employee', 'portal', 'finalised'], ['meet_us', 'employee', 'portal', 'finalised'], ['sign_letters', 'employee', 'portal', 'finalised'],
      ['day1_pass', 'automatic', 'portal', null], ['mark_joined', 'hr', 'dashboard', null], ['new_joining_date', 'employee', 'portal', 'finalised'],
    ].map(([key, owner, surface, opens], i) => ({
      id: `t-${key}`, phase: 'pre_boarding', title: String(key), ownerRole: owner, kind: 'system', surface, systemKey: key, mustDo: true, enabled: true, order: i,
      opensRule: opens ? { anchor: opens } : null,
      dueRule: key === 'upload_documents' ? { anchor: 'tj', offset: -5 } : key === 'about_you' ? { anchor: 'tj', offset: -3 } : key === 'sign_letters' ? { anchor: 'tj', offset: -2 } : key === 'mark_joined' ? { anchor: 'tj', offset: 0 } : null,
      ...(key === 'upload_documents' ? { documents: [
        { key: 'id_proof', label: 'ID proof', required: true }, { key: 'address', label: 'Address proof', required: true }, { key: 'photo', label: 'Passport photo', required: false },
      ] } : {}),
    })),
  } as never);

  const HR: import('../services/lifecycle/offers').HrActor = { userId: 'hr', name: 'Hema HR', org: ORG, seesPay: true };
  const IT: import('../services/lifecycle/offers').HrActor = { userId: 'it', name: 'Ishaan IT', org: ORG, seesPay: false };
  const HR2: import('../services/lifecycle/offers').HrActor = { userId: 'hr2', name: 'Omar Other', org: OTHER, seesPay: true };
  const lastMail = (to: string) => [...lifecycleOutbox()].reverse().find((m) => m.to === to);
  const mailsTo = (to: string) => lifecycleOutbox().filter((m) => m.to === to);
  const tokenIn = (html: string) => /\/o\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? '';
  const fields = (extra: Record<string, unknown> = {}) => ({
    designation: 'Product Designer', department: 'Design', location: 'Bengaluru · Hybrid', ctc: 1400000, tj, managerUserId: 'mgr',
    probationMonths: 6, noticeDays: 60, validTill: addDays(today, 7), responsibilities: 'Own the onboarding experience.\nWork with research.', ...extra,
  });
  const KABIR = 'kabir.check@example.com';

  // ─── Offer ────────────────────────────────────────────────────────────────
  section('Offer: create, PDF, send, the link');
  ok('IT staff without pay access cannot make an offer', (await refusal(() => offersSvc.createOffer(IT, { candidate: { name: 'X', personalEmail: 'x@example.com' }, fields: fields() }))).status === 403);
  ok('a bad CTC is refused', (await refusal(() => offersSvc.createOffer(HR, { candidate: { name: 'X', personalEmail: 'x@example.com' }, fields: fields({ ctc: -1 }) }))).status === 400);
  ok('an offer without a reporting manager is refused', (await refusal(() => offersSvc.createOffer(HR, { candidate: { name: 'X', personalEmail: 'x@example.com' }, fields: fields({ managerUserId: undefined }) }))).status === 400);
  ok('a manager from another company is refused', (await refusal(() => offersSvc.createOffer(HR, { candidate: { name: 'X', personalEmail: 'x@example.com' }, fields: fields({ managerUserId: 'hr2' }) }))).status === 400);
  const created = await offersSvc.createOffer(HR, { candidate: { name: 'Kabir Mehta', personalEmail: KABIR, phone: '+91 98765 43210' }, fields: fields() });
  const A = created.journeyId;
  let journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('the journey starts as a draft with the offer', journeyA.status === 'draft' && journeyA.offerId === (await db.offers().findOne({ journeyId: A }))?.id);
  ok('v1 is a draft with a reference number', created.offer.version === 1 && created.offer.status === 'draft' && /^OL\/\d{4}\/001$/.test(created.offer.refNo ?? ''), created.offer);
  ok('the candidate is not a user', !(await db.users().findOne({ email: KABIR })) && !journeyA.userId);
  ok('a second open offer to the same email is refused', (await refusal(() => offersSvc.createOffer(HR, { candidate: { name: 'Kabir', personalEmail: KABIR }, fields: fields() }))).status === 409);
  ok('the offer view hides CTC from staff without pay access', !('ctc' in ((await offersSvc.offerView(A, { hidePay: true }))!.fields)) && (await offersSvc.offerView(A))!.fields.ctc === 1400000);
  ok('the offer view names the manager', (await offersSvc.offerView(A))!.fields.managerName === 'Neha Rao');
  ok('sending before the PDF is refused', (await refusal(() => offersSvc.sendOffer(HR, A, {}))).status === 409);
  ok('a PNG as the offer PDF is refused', (await refusal(() => offersSvc.uploadOfferPdf(HR, A, { originalname: 'offer.pdf', buffer: PNG }))).status === 400);
  await offersSvc.uploadOfferPdf(HR, A, { originalname: 'Offer letter.pdf', buffer: PDF('v1') });
  clearLifecycleOutbox();
  let offer = await offersSvc.sendOffer(HR, A, { subject: 'Your offer from Sowaka Test', body: 'Hi Kabir,\n\nYour offer is attached.', cc: ['mgr@sowaka.test'] });
  const sentMail = lastMail(KABIR)!;
  const token1 = tokenIn(sentMail?.html ?? '');
  ok('sent: status offer_sent, version sent', offer.status === 'sent' && (await db.journeys().findOne({ id: A }))?.status === 'offer_sent');
  ok('the email has the PDF attached', sentMail?.attachments.length === 1 && sentMail.attachments[0].contentType === 'application/pdf' && sentMail.attachments[0].content.subarray(0, 5).toString() === '%PDF-');
  ok('the email has the personal link on PORTAL_BASE_URL', sentMail?.html.includes('http://localhost:5181/o/') && token1.length > 30, sentMail?.html);
  ok('the email copies the manager', sentMail?.cc.includes('mgr@sowaka.test'));
  ok('only the token’s hash is stored', (await db.offers().findOne({ journeyId: A }))!.versions[0].linkTokenHash === createHash('sha256').update(token1).digest('hex') && !JSON.stringify(await db.offers().findOne({ journeyId: A })).includes(token1));
  let link = await offersSvc.openOfferLink(token1, '1.1.1.1');
  ok('the link opens the offer (no login)', link.state === 'offer' && link.candidateName === 'Kabir Mehta' && link.version === 1);
  ok('the link shows the manager by name and role, no internal ids', link.fields.managerName === 'Neha Rao' && link.fields.managerDesignation === 'Design lead' && !('managerUserId' in link.fields));
  ok('the link carries the PDF url, HR contact and the company video', link.pdfUrl === `/portal/offer/${token1}/pdf` && link.hrContact.email === 'hr@sowaka.test' && link.companyVideoUrl === 'https://videos.example/life.mp4');
  ok('the link serves the PDF', (await offersSvc.offerLinkPdf(token1, '1.1.1.1')).bytes.subarray(0, 5).toString() === '%PDF-');
  ok('a made-up token is not found', (await refusal(() => offersSvc.openOfferLink('x'.repeat(43), '1.1.1.1'))).status === 404);

  section('Offer: revise before acceptance, old link replaced');
  offer = await offersSvc.reviseOffer(HR, A, { ctc: 1450000, designation: 'Senior Product Designer' });
  ok('revising a sent offer makes v2 with the changed fields', offer.version === 2 && offer.status === 'draft' && JSON.stringify(offer.changedFields) === '["designation","ctc"]', offer);
  ok('a saved revision leaves v1 as sent (nothing has gone to the candidate)', offer.versions[0].status === 'sent');
  ok('…so the old link still opens v1 with its terms', (link = await offersSvc.openOfferLink(token1, '1.1.1.1')).state === 'offer' && link.version === 1 && link.fields.ctc === 1400000 && link.pdfUrl !== null, link);
  ok('…and the journey keeps v1’s terms until HR sends v2', (await db.journeys().findOne({ id: A }))?.designation === 'Product Designer');
  offer = await offersSvc.reviseOffer(HR, A, { designation: 'Product Designer' });
  ok('editing the draft again keeps only the real changes', offer.version === 2 && JSON.stringify(offer.changedFields) === '["ctc"]', offer.changedFields);
  await offersSvc.uploadOfferPdf(HR, A, { originalname: 'Offer letter v2.pdf', buffer: await realPdf('Offer v2', 3) });
  await offersSvc.sendOffer(HR, A, {});
  const token2 = tokenIn(lastMail(KABIR)!.html);
  ok('sent: v1 is replaced', (await offersSvc.offerView(A))!.versions[0].status === 'replaced');
  ok('the old link says replaced, without terms or PDF', (link = await offersSvc.openOfferLink(token1, '1.1.1.1')).state === 'replaced' && link.pdfUrl === null && !('ctc' in link.fields));
  ok('the old link cannot accept', (await refusal(() => offersSvc.acceptOffer(token1, { ip: '1.1.1.1' }))).status === 409);
  link = await offersSvc.openOfferLink(token2, '1.1.1.1');
  ok('the new link opens v2 with its changed fields', link.state === 'offer' && link.version === 2 && link.changedFields?.[0] === 'ctc' && link.fields.ctc === 1450000);
  ok('the link counts the PDF’s pages (P4 "Accepted version · 3 pages")', link.pdfPages === 3, link.pdfPages);
  ok('the Up-next helper names the changes in plain words, without the reply-by date', portalSvc.changesLine(['tj', 'ctc', 'validTill']) === 'Joining date and salary changed' && portalSvc.changesLine(['validTill']) === undefined);
  ok('the default email body names the role and the reply-by date', lastMail(KABIR)!.html.includes('Product Designer') && lastMail(KABIR)!.html.includes(formatDay(addDays(today, 7))));

  section('Offer: accept (latest only), finalise');
  link = await offersSvc.acceptOffer(token2, { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone) Check' });
  let stored = (await db.offers().findOne({ journeyId: A }))!.versions[1];
  ok('accepted: time, IP and device stored', link.state === 'accepted' && Boolean(link.acceptedAt) && stored.acceptedAt instanceof Date && stored.acceptedIp === '203.0.113.9' && stored.acceptedDevice?.includes('iPhone'));
  ok('the journey is accepted and HR is emailed to finalise', (await db.journeys().findOne({ id: A }))?.status === 'accepted' && Boolean(lastMail('hr@sowaka.test')?.subject.includes('finalise')));
  ok('accepting again just shows the status', (await offersSvc.acceptOffer(token2, { ip: '203.0.113.9' })).state === 'accepted');
  ok('no account before HR finalises', !(await db.candidateAccounts().findOne({ journeyId: A })));
  ok('a sign-in before finalise fails like a wrong password', (await refusal(() => auth.signIn(KABIR, 'whatever1', '5.5.5.5'))).status === 401);
  // Notifications reach the check's own org only for the finalise, so the set-up push can be read back.
  env.notifyOrgs.push(ORG);
  try { await offersSvc.finaliseOffer(HR, A); } finally { env.notifyOrgs.splice(env.notifyOrgs.indexOf(ORG), 1); }
  const loginMail = lastMail(KABIR)!;
  const account = (await db.candidateAccounts().findOne({ journeyId: A }))!;
  ok('finalise creates the account and emails the portal link only (no password: they sign in with a code to this email)',
    loginMail.subject.includes('joining portal is ready') && !/password/i.test(loginMail.html.replace(/no password to remember/i, '')) && loginMail.html.includes(KABIR) && Boolean(account));
  // A sign-in code for an email: asked for, then read off the code email's subject.
  const codeFor = async (email: string, ip: string, at?: Date) => { await auth.requestSignInCode(email, ip, at); return /^(\d{6}) is your/.exec(lastMail(email.trim().toLowerCase())?.subject ?? '')?.[1] ?? ''; };
  ok('the journey is finalised', (await db.journeys().findOne({ id: A }))?.status === 'finalised');
  const setupPush = await db.notifications().findOne({ userId: 'mgr', scenario: 'lifecycle_joiner_setup' });
  ok('no set-up push to the manager (HR assigns every onboarding task on the dashboard, 24 Nov)', !setupPush, setupPush?.data);
  ok('finalising twice is refused', (await refusal(() => offersSvc.finaliseOffer(HR, A))).status === 409);
  link = await offersSvc.openOfferLink(token2, '1.1.1.1');
  ok('the login email’s sign-in link carries their email and the client (logo and HR on a fresh device)', /\/sign-in\?email=[^"&]+&(amp;)?c=/.test(loginMail.html) && loginMail.html.includes(`c=${emails.clientToken(ORG)}`), loginMail.html);
  ok('the link now says "all set" with the masked email and both dates', link.state === 'finalised' && link.loginEmailMasked === 'ka***@example.com' && Boolean(link.acceptedAt && link.finalisedAt));

  // ─── Sign-in ──────────────────────────────────────────────────────────────
  section('Portal sign-in by a code: one-time, expires, lock after 5, rate limit; forgot / reset kept');
  const t0 = new Date();
  clearLifecycleOutbox();
  ok('a code for an unknown email says ok and sends nothing', (await auth.requestSignInCode('nobody@example.com', '6.6.6.5', t0)).ok && lifecycleOutbox().length === 0);
  const c1 = await codeFor(KABIR.toUpperCase(), '6.6.6.6', t0);
  ok('asking for a code emails a 6-digit code to the portal’s email', /^\d{6}$/.test(c1) && Boolean(lastMail(KABIR)?.html.includes(c1)));
  const wrongCode = c1 === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 4; i += 1) ok(`wrong code ${i} is refused`, (await refusal(() => auth.signInWithCode(KABIR, wrongCode, '6.6.6.6', t0))).status === 401);
  const fifth = await refusal(() => auth.signInWithCode(KABIR, wrongCode, '6.6.6.6', t0));
  ok('the fifth wrong code locks sign-in for 15 minutes', fifth.status === 403 && fifth.message.includes('15 minutes'), fifth);
  const t1 = new Date(t0.getTime() + 16 * 60_000);
  const c2 = await codeFor(KABIR, '6.6.6.6', t1);
  ok('an expired code is refused (codes last 10 minutes)', (await refusal(() => auth.signInWithCode(KABIR, c2, '6.6.6.6', new Date(t1.getTime() + 11 * 60_000)))).status === 401);
  const c3 = await codeFor(KABIR, '6.6.6.6', t1);
  const signedIn = await auth.signInWithCode(` ${KABIR.toUpperCase()} `, ` ${c3} `, '6.6.6.6', t1);
  ok('after the lock, the right code signs in (email case and spaces do not matter)', 'token' in signedIn && signedIn.token.split('.').length === 3);
  ok('a code works once', (await refusal(() => auth.signInWithCode(KABIR, c3, '6.6.6.6', t1))).status === 401);
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('first sign-in: status active, sign-in task done', journeyA.status === 'active' && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'portal_sign_in' }))?.status === 'done');
  env.otpTestEmails.push(KABIR);
  try {
    clearLifecycleOutbox();
    await auth.requestSignInCode(KABIR, '6.6.6.4', t1);
    ok('a test address (OTP_TEST_EMAILS) gets no mail and signs in with 123456', lifecycleOutbox().length === 0 && 'token' in (await auth.signInWithCode(KABIR, '123456', '6.6.6.4', t1)));
  } finally { env.otpTestEmails.splice(env.otpTestEmails.indexOf(KABIR), 1); }
  auth.resetRateLimits();
  let codeLimited: { status?: number } = {};
  for (let i = 0; i < auth.LIMITS.code.max + 1; i += 1) codeLimited = await refusal(() => auth.requestSignInCode('nobody@example.com', '9.9.9.7'));
  ok('asking for codes is rate-limited per IP', codeLimited.status === 429);
  auth.resetRateLimits();
  clearLifecycleOutbox();
  ok('forgot for an unknown email says ok and sends nothing', (await auth.forgotPassword('nobody@example.com', '7.7.7.7')).ok && lifecycleOutbox().length === 0);
  await auth.forgotPassword(KABIR, '7.7.7.7');
  const resetToken = /\/reset\/([A-Za-z0-9_-]+)/.exec(lastMail(KABIR)?.html ?? '')?.[1] ?? '';
  ok('forgot for the candidate emails a reset link on the portal’s route (/reset/:token)', resetToken.length > 30 && lastMail(KABIR)!.html.includes(`http://localhost:5181/reset/${resetToken}?c=`) && !lastMail(KABIR)!.html.includes('reset?token='), lastMail(KABIR)?.html);
  ok('a new password under 8 characters is refused', (await refusal(() => auth.resetPassword(resetToken, 'short'))).status === 400);
  ok('8 characters of any kind is enough (the portal’s rule)', auth.checkNewPassword('abcdefgh') === 'abcdefgh');
  await auth.resetPassword(resetToken, 'NewPassword9');
  ok('the reset link works once', (await refusal(() => auth.resetPassword(resetToken, 'NewPassword9'))).status === 400);
  ok('the new password signs in (the password route stays for older pages)', 'token' in (await auth.signIn(KABIR, 'NewPassword9', '6.6.6.7')));
  ok('a password copied with a space or line break around it still signs in', 'token' in (await auth.signIn(KABIR, ' NewPassword9\n', '6.6.6.8')));
  auth.resetRateLimits();
  let limited: { status?: number } = {};
  for (let i = 0; i < auth.LIMITS.signIn.max + 1; i += 1) limited = await refusal(() => auth.signIn('nobody@example.com', 'x1xxxxxx', '9.9.9.9'));
  ok('sign-in is rate-limited per IP', limited.status === 429);
  ok('another IP is not limited', (await refusal(() => auth.signIn('nobody@example.com', 'x1xxxxxx', '9.9.9.8'))).status === 401);
  auth.resetRateLimits();
  for (let i = 0; i < auth.LIMITS.offerLink.max + 1; i += 1) limited = await refusal(() => offersSvc.openOfferLink(token2, '8.8.8.8'));
  ok('the offer link is rate-limited per IP', limited.status === 429);
  auth.resetRateLimits();
  const portalToken = tokenOf(await auth.signIn(KABIR, 'NewPassword9', '6.6.6.8'));

  section('Token audiences: app and portal tokens never pass for each other');
  const appToken = randomBytes(32).toString('hex');
  await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(appToken).digest('hex'), userId: 'hr', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  ok('the portal accepts its own token', (await auth.journeyForPortalToken(`Bearer ${portalToken}`)).id === A);
  ok('the portal refuses an app session token', (await refusal(() => auth.journeyForPortalToken(`Bearer ${appToken}`))).status === 401);
  const key = createHash('sha256').update('portal-jwt:portal-check-secret').digest();
  const forge = (claims: Record<string, unknown>) => {
    const body = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  ok('a correctly signed token for another audience is refused', auth.verifyPortalToken(forge({ aud: 'app', typ: 'portal', sub: A, org: ORG, exp })) === null);
  ok('a correctly signed portal token is accepted (the forge is right)', auth.verifyPortalToken(forge({ aud: 'portal', typ: 'portal', sub: A, org: ORG, exp }))?.sub === A);
  ok('an expired portal token is refused', auth.verifyPortalToken(auth.signPortalToken(A, ORG, new Date(Date.now() - 13 * 3_600_000))) === null);
  ok('a tampered signature is refused', auth.verifyPortalToken(portalToken.slice(0, -2) + (portalToken.endsWith('AA') ? 'BB' : 'AA')) === null);
  ok('alg "none" is refused', auth.verifyPortalToken(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${portalToken.split('.')[1]}.`) === null);

  type Mock = { status: number; body: unknown; next: boolean; headers: Record<string, string> };
  const call = (router: { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void } | ((req: never, res: never, next: (e?: unknown) => void) => unknown), method: string, url: string, bearer?: string, payload: unknown = {}, extraHeaders: Record<string, string> = {}): Promise<Mock> =>
    new Promise((resolve) => {
      const headers: Record<string, string> = { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extraHeaders };
      const out: Mock = { status: 200, body: undefined, next: false, headers: {} };
      const req = { method, url, originalUrl: url, path: url.split('?')[0], headers, header: (n: string) => headers[n.toLowerCase()], body: payload, query: {}, params: {}, socket: { remoteAddress: '127.0.0.1' }, requestId: 'check' };
      const res = {
        statusCode: 200, headersSent: false, locals: {},
        status(code: number) { out.status = code; this.statusCode = code; return this; },
        json(b: unknown) { out.body = b; this.headersSent = true; resolve(out); return this; },
        send(b: unknown) { out.body = b; this.headersSent = true; resolve(out); return this; },
        setHeader(k: string, v: string) { out.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; },
      };
      const next = (err?: unknown) => { out.next = !err; if (err) out.body = String(err); resolve(out); };
      if (typeof router === 'function') void (router as (a: unknown, b: unknown, c: unknown) => unknown)(req, res, next);
      else router.handle(req, res, next);
    });
  ok('the app’s requireAuth refuses a portal token', (await call(requireAuth as never, 'GET', '/profile', portalToken)).status === 401);
  ok('the app’s requireAuth takes an app token (the mock is right)', (await call(requireAuth as never, 'GET', '/profile', appToken)).next);
  ok('GET /portal/me refuses an app token', (await call(portalRouter as never, 'GET', '/me', appToken)).status === 401);
  const meViaRoute = await call(portalRouter as never, 'GET', '/me', portalToken);
  ok('GET /portal/me answers a portal token', meViaRoute.status === 200 && (meViaRoute.body as { status?: string })?.status === 'active', meViaRoute);
  ok('the dashboard routes refuse a portal token', (await call(lifecycleOfferRouter as never, 'GET', '/letters', portalToken)).status === 401);
  const client = await call(portalRouter as never, 'GET', `/client/${emails.clientToken(ORG)}`);
  ok('GET /portal/client/:token names the client and its HR (no session needed)', client.status === 200 && (client.body as { company?: { name?: string }; hrContact?: { email?: string } })?.company?.name === 'Sowaka Test' && (client.body as { hrContact?: { email?: string } }).hrContact?.email === 'hr@sowaka.test', client);
  const forgedClient = `${Buffer.from(OTHER).toString('base64url')}.${emails.clientToken(ORG).split('.')[1]}`;
  ok('…and a made-up or re-pointed client token is not found', (await call(portalRouter as never, 'GET', `/client/${forgedClient}`)).status === 404 && (await call(portalRouter as never, 'GET', '/client/abc.def')).status === 404);

  // ─── Home ─────────────────────────────────────────────────────────────────
  section('Portal home');
  journeyA = (await db.journeys().findOne({ id: A }))!;
  let home = await portalSvc.portalHome(journeyA);
  ok('view tasks_open, Tj and days to go', home.view === 'tasks_open' && home.tj === tj && home.daysToGo === Math.round((Date.parse(`${tj}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000), home);
  ok('path: Offer done, Docs current, Sign and Day 1 locked', JSON.stringify(home.path.map((p) => `${p.key}:${p.state}`)) === JSON.stringify(['offer:done', 'docs:current', 'about:todo', 'meet:todo', 'letter:locked', 'pass:locked']), home.path);
  ok('Up next is the item due soonest (documents, Tj − 5)', home.upNext?.key === 'docs' && home.upNext.due === addDays(tj, -5), home.upNext);
  ok('the seed has no water yet', home.plant.stage === 0 && home.plant.water === 0);
  ok('home carries the designation, the portal’s last day and the Up next helper', home.designation === 'Product Designer' && home.portalOpenUntil === addDays(tj, 7) && Boolean(home.upNext?.helper), home);

  // ─── About you, Meet us ───────────────────────────────────────────────────
  section('About you and Meet us');
  ok('a short phone is refused', (await refusal(() => portalSvc.saveAboutYou(journeyA, { emergencyContact: { name: 'Asha', relation: 'Parent', phone: '12345' } }))).status === 400);
  ok('the candidate’s own number is refused', (await refusal(() => portalSvc.saveAboutYou(journeyA, { emergencyContact: { name: 'Asha', relation: 'Parent', phone: '9876543210' } }))).status === 400);
  ok('an unknown relation is refused', (await refusal(() => portalSvc.saveAboutYou(journeyA, { emergencyContact: { name: 'Asha', relation: 'Cousin', phone: '+91 91234 56789' } }))).status === 400);
  ok('a UAN of 11 digits is refused', (await refusal(() => portalSvc.saveAboutYou(journeyA, { pf: { firstJob: false, uan: '10000000000' } }))).status === 400);
  const aboutView = portalSvc.aboutYouView(journeyA);
  ok('About you GET: the candidate’s own phone and the last day to edit (Tj − 1)', aboutView.phone === '+919876543210' && aboutView.editableUntil === addDays(tj, -1), aboutView);
  await portalSvc.saveAboutYou(journeyA, { emergencyContact: { name: 'Asha Mehta', relation: 'Parent', phone: '+91 91234 56789' } });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  // PF is no longer asked before joining (24 Nov: Bank and PF is the app's own task): the emergency contact alone finishes About you.
  ok('the emergency contact alone finishes About you (PF is the app’s Bank and PF task since 24 Nov)', journeyA.aboutYou?.emergencyContact?.phone === '+919123456789' && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'about_you' }))?.status === 'done');
  ok('a bad second number is refused', (await refusal(() => portalSvc.saveAboutYou(journeyA, { emergencyContact: { name: 'Asha Mehta', relation: 'Parent', phone: '+91 91234 56789', altPhone: '123' } }))).status === 400);
  await portalSvc.saveAboutYou(journeyA, {
    emergencyContact: { name: 'Asha Mehta', relation: 'Parent', phone: '+91 91234 56789', altPhone: '+91 99887 76655' },
    emergencyContact2: { name: 'Ravi Mehta', relation: 'Sibling', phone: '9988123456' },
  });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('a second number and a second contact are kept', journeyA.aboutYou?.emergencyContact?.altPhone === '+919988776655' && journeyA.aboutYou?.emergencyContact2?.name === 'Ravi Mehta' && journeyA.aboutYou?.emergencyContact2?.phone === '+919988123456', journeyA.aboutYou);
  await portalSvc.saveAboutYou(journeyA, { emergencyContact2: null });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('the second contact can be removed, the first stays', !journeyA.aboutYou?.emergencyContact2 && journeyA.aboutYou?.emergencyContact?.name === 'Asha Mehta');
  await portalSvc.saveAboutYou(journeyA, { pf: { firstJob: false } });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('a UAN is optional when they have one (HR can find it)', journeyA.aboutYou?.pf?.firstJob === false && !journeyA.aboutYou?.pf?.uan);
  await portalSvc.saveAboutYou(journeyA, { pf: { firstJob: false, uan: '1000 0000 0001' } });
  ok('a PF sent by an older portal is still kept; the task stays done', journeyA.aboutYou?.pf?.firstJob === false && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'about_you' }))?.status === 'done');
  ok('About you locks on the joining day', (await refusal(() => portalSvc.saveAboutYou(journeyA, { pf: { firstJob: true } }, at10(tj)))).status === 409);
  journeyA = (await db.journeys().findOne({ id: A }))!;
  let items = await portalSvc.meetItems(journeyA);
  ok('Meet us: the company video and the role card', JSON.stringify(items.map((i) => i.id)) === '["company_video","role"]' && items.every((i) => !i.seen), items);
  ok('Meet us items carry a tag and a subtitle', items.every((i) => i.tag && i.subtitle));
  await db.journeys().updateOne({ id: A }, { $set: { 'meetUs.managerNote': { kind: 'text', text: 'Your portfolio made us rethink our own onboarding.' } } });
  const withNote = await portalSvc.meetItems((await db.journeys().findOne({ id: A }))!);
  ok('the manager’s note names its author and role once (the portal adds "· your manager")', withNote[0].id === 'manager_note' && withNote[0].authorName === 'Neha Rao' && withNote[0].authorRole === 'Design lead', withNote[0]);
  const jd = await portalSvc.joiningDetails((await db.journeys().findOne({ id: A }))!);
  ok('Joining details: the manager by name with their work email (Say hi), the pass day a week before', jd.manager?.name === 'Neha Rao' && /@/.test(jd.manager?.email ?? '') && jd.passOpensOn === addDays(tj, -7), jd);
  // A video note: a signed media link, because <video src> cannot send the portal's Bearer token.
  const clip = Buffer.from('fake mp4 bytes for the manager video note');
  const clipFile = await files.storeFile(ORG, A, { name: 'Hello from Neha.mp4', contentType: 'video/mp4', bytes: clip }, 'manager');
  await db.journeys().updateOne({ id: A }, { $set: { 'meetUs.managerNote': { kind: 'video', fileId: clipFile.id } } });
  const videoNote = (await portalSvc.meetItems((await db.journeys().findOne({ id: A }))!))[0];
  ok('the video note’s url is a signed /portal/media link, not the Bearer-only /portal/files', /^\/portal\/media\/[\w-]+\.[\w-]+$/.test(videoNote.videoUrl ?? ''), videoNote.videoUrl);
  const mediaPath = (videoNote.videoUrl ?? '').replace(/^\/portal/, '');
  const media = await call(portalRouter as never, 'GET', mediaPath);
  ok('GET /portal/media/:token plays without a session', media.status === 200 && Buffer.isBuffer(media.body) && (media.body as Buffer).equals(clip) && media.headers['Content-Type'] === 'video/mp4' && media.headers['Accept-Ranges'] === 'bytes', { status: media.status, headers: media.headers });
  const ranged = await call(portalRouter as never, 'GET', mediaPath, undefined, {}, { range: 'bytes=0-3' });
  ok('…and serves byte ranges (Safari asks for them before it plays)', ranged.status === 206 && (ranged.body as Buffer).toString() === 'fake' && ranged.headers['Content-Range'] === `bytes 0-3/${clip.length}`, { status: ranged.status, headers: ranged.headers });
  ok('…a tampered media link is not found', (await call(portalRouter as never, 'GET', `${mediaPath.slice(0, -3)}xyz`)).status === 404);
  ok('…an expired one neither (links last to the end of the day after their TTL)', auth.verifyMediaToken(auth.mediaPath(A, clipFile.id, new Date(Date.now() - 50 * 3_600_000)).split('/').pop()!) === null);
  ok('…and a link only opens its own journey’s file', (await call(portalRouter as never, 'GET', auth.mediaPath('another-journey', clipFile.id).replace(/^\/portal/, ''))).status === 404);
  await db.journeys().updateOne({ id: A }, { $unset: { 'meetUs.managerNote': '' } });
  ok('an unknown item is refused', (await refusal(() => portalSvc.markMeetSeen(journeyA, 'nope'))).status === 404);
  await portalSvc.markMeetSeen(journeyA, 'company_video');
  items = await portalSvc.markMeetSeen((await db.journeys().findOne({ id: A }))!, 'role');
  ok('all seen: meet_us done', items.every((i) => i.seen) && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'meet_us' }))?.status === 'done');

  // ─── Documents ────────────────────────────────────────────────────────────
  section('Documents: limits, send back, approve');
  journeyA = (await db.journeys().findOne({ id: A }))!;
  let docs = await portalSvc.portalDocuments(journeyA);
  ok('the list comes from the template', JSON.stringify(docs.map((d) => d.docKey)) === '["id_proof","address","photo"]', docs.map((d) => d.docKey));
  ok('each document carries its reel tag, title, hint and due date', JSON.stringify(docs.map((d) => [d.tag, d.title])) === JSON.stringify([['ID proof', 'Upload your ID proof'], ['Address proof', 'Upload an address proof'], ['Passport photo', 'Upload your passport photo']]) && docs.every((d) => d.dueAt === addDays(tj, -5)) && docs[0].hint === 'Both sides, in good light, with no glare.' && docs[2].hint === 'Plain background, face clearly visible.', docs.map((d) => [d.title, d.hint, d.dueAt]));
  const idDoc = docs.find((d) => d.docKey === 'id_proof')!;
  const addrDoc = docs.find((d) => d.docKey === 'address')!;
  ok('a text file named .pdf is refused (bytes, not the name)', (await refusal(() => docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: 'id.pdf', buffer: Buffer.from('hello, not a pdf') }]))).status === 400);
  ok('over 10 MB is refused', (await refusal(() => docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: 'big.pdf', buffer: Buffer.concat([PDF(), Buffer.alloc(10 * 1024 * 1024)]) }]))).status === 413);
  ok('a mixed batch stores nothing when one file is bad', (await refusal(() => docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: 'a.jpg', buffer: JPG }, { originalname: 'b.gif', buffer: Buffer.from('GIF89a') }]))).status === 400
    && (await db.candidateDocuments().findOne({ id: idDoc.id }))!.fileIds.length === 0);
  // Multer hands over a browser's UTF-8 file name read as latin1 ("Aadhaar – front.jpg" as "Aadhaar â\u0080\u0093 front.jpg").
  const misread = (name: string) => Buffer.from(name, 'utf8').toString('latin1');
  await docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: misread('Aadhaar – front.jpg'), buffer: JPG }, { originalname: 'pan.png', buffer: PNG }]);
  let idRow = (await db.candidateDocuments().findOne({ id: idDoc.id }))!;
  const idFile = (await db.lifecycleFiles().findOne({ id: idRow.fileIds[0] }))!;
  ok('a non-ASCII file name is stored as the candidate named it, not mojibake', idFile.name === 'Aadhaar – front.jpg', idFile.name);
  ok('uploadName leaves real names alone (Résumé, an en dash already decoded, plain ASCII)', files.uploadName('Résumé.pdf') === 'Résumé.pdf' && files.uploadName('Letter – Neel.pdf') === 'Letter – Neel.pdf' && files.uploadName('bill.pdf') === 'bill.pdf' && files.uploadName(misread('Appointment letter – Neel Kapoor.pdf')) === 'Appointment letter – Neel Kapoor.pdf');
  ok('uploaded: in review with two files, typed from their bytes', idRow.status === 'in_review' && idRow.fileIds.length === 2 && idFile.contentType === 'image/jpeg' && idFile.uploadedBy === 'candidate');
  ok('stored under .local-uploads (no S3 here)', idFile.objectKey.startsWith(`lifecycle/${ORG}/${A}/`) && (await files.readFileBytes(idFile)).equals(JPG));
  ok('the dashboard serves the file to its own org', (await files.fileForOrg(ORG, idFile.id)).id === idFile.id);
  ok('send back needs a note', (await refusal(() => docsSvc.reviewDocument(HR, idDoc.id, { decision: 'send_back' }))).status === 400);
  clearLifecycleOutbox();
  await docsSvc.reviewDocument(HR, idDoc.id, { decision: 'send_back', note: 'The Aadhaar photo is cut off. Please upload both sides.' });
  idRow = (await db.candidateDocuments().findOne({ id: idDoc.id }))!;
  ok('sent back with the note; the candidate is emailed', idRow.status === 'sent_back' && idRow.hrNote?.includes('cut off') && Boolean(lastMail(KABIR)?.html.includes('cut off')));
  home = await portalSvc.portalHome((await db.journeys().findOne({ id: A }))!);
  ok('Up next leads with the sent-back document', home.upNext?.key === 'docs' && home.upNext.title === 'Re-upload your ID proof', home.upNext);
  ok('the path keeps Docs current while a document is sent back', home.path.find((p) => p.key === 'docs')?.state === 'current', home.path);
  docs = await portalSvc.portalDocuments((await db.journeys().findOne({ id: A }))!);
  ok('the sent-back document is listed first', docs[0].id === idDoc.id);
  journeyA = (await db.journeys().findOne({ id: A }))!;
  await docsSvc.removeDocumentFile(journeyA, idDoc.id, idRow.fileIds[1]);
  ok('a file can be removed before approval', (await db.candidateDocuments().findOne({ id: idDoc.id }))!.fileIds.length === 1 && !(await db.lifecycleFiles().findOne({ id: idRow.fileIds[1] })));
  const sentBackFile = (await db.candidateDocuments().findOne({ id: idDoc.id }))!.fileIds[0];
  await docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: 'aadhaar-both.pdf', buffer: PDF('id') }]);
  const reup = (await db.candidateDocuments().findOne({ id: idDoc.id }))!;
  ok('a re-upload after Send back replaces the sent-back file (kept only as a superseded note, the file removed)',
    reup.fileIds.length === 1 && reup.fileIds[0] !== sentBackFile && reup.status === 'in_review' && reup.superseded?.length === 1 && reup.superseded[0].reason?.includes('cut off') === true && !(await db.lifecycleFiles().findOne({ id: sentBackFile })), reup);
  await docsSvc.reviewDocument(HR, idDoc.id, { decision: 'approve' });
  ok('one approval is not all: still active', (await db.journeys().findOne({ id: A }))?.status === 'active');
  ok('an approved document cannot be uploaded to', (await refusal(() => docsSvc.uploadDocumentFiles(journeyA, idDoc.id, [{ originalname: 'x.pdf', buffer: PDF() }]))).status === 409);
  ok('a document with nothing uploaded cannot be approved', (await refusal(() => docsSvc.reviewDocument(HR, addrDoc.id, { decision: 'approve' }))).status === 409);
  await docsSvc.uploadDocumentFiles(journeyA, addrDoc.id, [{ originalname: 'bill.pdf', buffer: PDF('addr') }]);
  home = await portalSvc.portalHome((await db.journeys().findOne({ id: A }))!);
  ok('every required document in (one approved, one in review): Docs is With HR, and Up next moves on (or says HR is checking)',
    home.path.find((p) => p.key === 'docs')?.state === 'waiting' && (home.upNext?.key !== 'docs' || home.upNext.title === 'HR is checking your documents'), { path: home.path, up: home.upNext });
  ok('letters are locked before the last approval', (await lettersSvc.portalLetters(journeyA)).every((l) => l.state === 'locked'));
  await docsSvc.reviewDocument(HR, addrDoc.id, { decision: 'approve' });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('the last required approval: docs_approved (the optional photo does not hold it up)', journeyA.status === 'docs_approved');
  const letterRows = await db.letters().find({ journeyId: A }).toArray();
  ok('appointment letter and NDA drafted from the accepted offer', letterRows.length === 2 && letterRows.every((l) => l.values.ctc === '₹14,50,000' && l.values.managerName === 'Neha Rao' && l.values.ctcWords === 'Rupees fourteen lakh fifty thousand only'), letterRows.map((l) => l.values.ctc));
  ok('without PDFs they stay locked on the portal', (await lettersSvc.portalLetters(journeyA)).every((l) => l.state === 'locked'));
  home = await portalSvc.portalHome(journeyA);
  ok('every required document approved: Docs done', home.path.find((p) => p.key === 'docs')?.state === 'done', home.path);
  const photoDoc = docs.find((d) => d.docKey === 'photo')!;
  await docsSvc.uploadDocumentFiles(journeyA, photoDoc.id, [{ originalname: 'me.jpg', buffer: JPG }]);
  await docsSvc.reviewDocument(HR, photoDoc.id, { decision: 'send_back', note: 'Please use a plain background.' });
  home = await portalSvc.portalHome((await db.journeys().findOne({ id: A }))!);
  ok('an optional document sent back: Docs is not done, it is the current step again', home.path.find((p) => p.key === 'docs')?.state === 'current' && home.upNext?.key === 'docs', home.path);
  await docsSvc.uploadDocumentFiles((await db.journeys().findOne({ id: A }))!, photoDoc.id, [{ originalname: 'me-plain.jpg', buffer: JPG }]);
  await docsSvc.reviewDocument(HR, photoDoc.id, { decision: 'approve' });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('…and done again once it is approved', (await portalSvc.portalHome(journeyA)).path.find((p) => p.key === 'docs')?.state === 'done');
  ok('approving the optional one later does not draft the letters twice', (await db.letters().countDocuments({ journeyId: A })) === 2);
  {
    const reviewTask = async () => (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'review_documents' }))!;
    ok('Review documents: done by the last required approval, by HR', (await reviewTask()).status === 'done' && (await reviewTask()).doneByName === 'Hema HR');
    await docsSvc.reviewDocument(HR, addrDoc.id, { decision: 'send_back', note: 'Please upload the full bill.' });
    ok('…a required document sent back after it: the review is to do again', (await reviewTask()).status === 'todo', await reviewTask());
    await docsSvc.uploadDocumentFiles((await db.journeys().findOne({ id: A }))!, addrDoc.id, [{ originalname: 'bill-full.pdf', buffer: PDF('addr-2') }]);
    await docsSvc.reviewDocument(HR, addrDoc.id, { decision: 'approve' });
    ok('…and done again by approving it, the status kept (docs_approved), the letters not drafted again',
      (await reviewTask()).status === 'done' && (await db.journeys().findOne({ id: A }))?.status === 'docs_approved' && (await db.letters().countDocuments({ journeyId: A })) === 2);
  }

  // ─── Letters ──────────────────────────────────────────────────────────────
  section('Letters: templates, merge, PDF, open, sign');
  const templates = await lettersSvc.listLetterTemplates(ORG);
  ok('six default templates seeded', templates.length === 6 && new Set(templates.map((t) => t.kind)).size === 6 && templates.every((t) => t.isDefault));
  ok('templates are body only: from the salutation, no letterhead, ref no. or title', templates.every((t) => /^<p>(Dear \{\{candidateName\}\},|To whom it may concern,)<\/p>/.test(t.body) && !t.body.includes('{{refNo}}') && !/<h\d/.test(t.body)));
  ok('templates use only known flat merge keys', templates.every((t) => [...t.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].every((m) => m[1] in lettersSvc.MERGE_FIELDS)));
  ok('templates with scripts are refused', (await refusal(() => lettersSvc.createLetterTemplate(ORG, { kind: 'offer', name: 'X', body: '<p onclick="x()">hi</p>' }))).status === 400);
  const custom = await lettersSvc.createLetterTemplate(ORG, { kind: 'offer', name: 'Campus offer', body: '<p>Dear {{candidate.firstName}}</p>', isDefault: true });
  ok('a new default template unsets the old default', !(await db.letterTemplates().findOne({ org: ORG, kind: 'offer', id: { $ne: custom.id } }))?.isDefault);
  const merged = await lettersSvc.mergeValues(ORG, { kind: 'appointment', journeyId: A }, 'Hema HR');
  ok('merge: appointment values from the accepted offer, nothing missing', merged.missing.length === 0 && merged.values.joiningDate === formatDay(tj) && merged.values.probationMonths === '6 months' && merged.values.noticeDays === '60 days' && merged.values.companyAddress.includes('Bengaluru') && merged.values.companyName === 'Sowaka Test' && merged.values.hrName === 'Hema HR', merged);
  const mergedOffer = await lettersSvc.mergeValues(ORG, { kind: 'relieving', journeyId: A });
  ok('merge: a relieving letter before joining lists what is missing', mergedOffer.missing.includes('employeeId') && mergedOffer.missing.includes('lastWorkingDay'));
  ok('fillTemplate marks missing fields', lettersSvc.fillTemplate('<p>{{employeeId}} {{merge.candidateName}}</p>', { candidateName: 'Kabir <M>' }) === '<p>[Employee ID] Kabir &lt;M&gt;</p>');
  const appt = letterRows.find((l) => l.kind === 'appointment')!;
  const nda = letterRows.find((l) => l.kind === 'nda')!;
  const again = await lettersSvc.createLetter(HR, { kind: 'appointment', journeyId: A, values: { employeeId: 'SWT-101' } });
  ok('POST /letters for an unsigned appointment letter updates the same row', again.id === appt.id && again.values.employeeId === 'SWT-101' && (await db.letters().countDocuments({ journeyId: A })) === 2);
  ok('a letter PDF must be a PDF', (await refusal(() => lettersSvc.uploadLetterPdf(HR, appt.id, { buffer: JPG }))).status === 400);
  clearLifecycleOutbox();
  const apptPdf = await realPdf('Appointment letter', 2);
  await lettersSvc.uploadLetterPdf(HR, appt.id, { originalname: misread('Appointment letter – Kabir Mehta.pdf'), buffer: apptPdf });
  ok('one letter with a PDF is not "ready" yet (no mail)', mailsTo(KABIR).length === 0);
  home = await portalSvc.portalHome((await db.journeys().findOne({ id: A }))!);
  ok('one of two letters ready: home waits for both (no letter_ready yet)', home.view !== 'letter_ready' && home.path.find((p) => p.key === 'letter')?.state === 'locked', home.view);
  await lettersSvc.uploadLetterPdf(HR, nda.id, { originalname: 'NDA.pdf', buffer: PDF('nda') });
  ok('both PDFs: "letters ready" emailed once', mailsTo(KABIR).filter((m) => m.subject.includes('ready to sign')).length === 1);
  ok('the catch-up job does not send it twice', !(await lettersSvc.maybeSendLettersReady(A)));
  journeyA = (await db.journeys().findOne({ id: A }))!;
  let pl = await lettersSvc.portalLetters(journeyA);
  ok('both letters ready on the portal, with HR’s file names in UTF-8 (no mojibake)', pl.every((l) => l.state === 'ready' && l.pdfUrl?.startsWith('/portal/letters/')) && pl.map((l) => l.fileName).join() === 'Appointment letter – Kabir Mehta.pdf,NDA.pdf', pl.map((l) => l.fileName));
  ok('the appointment letter says its page count before it is opened', pl.find((l) => l.kind === 'appointment')?.pages === 2 && pl.find((l) => l.kind === 'nda')?.pages === 1, pl.map((l) => l.pages));
  home = await portalSvc.portalHome(journeyA);
  ok('home view letter_ready; the path’s Sign step is current', home.view === 'letter_ready' && home.path.find((p) => p.key === 'letter')?.state === 'current', home);
  ok('signing before opening the PDF is refused', (await refusal(() => lettersSvc.signLetter(journeyA, appt.id, { method: 'type', typedName: 'Kabir Mehta' }, { ip: '1.2.3.4' }))).status === 409);
  await lettersSvc.openLetter(journeyA, appt.id);
  ok('opened', (await lettersSvc.portalLetters(journeyA)).find((l) => l.id === appt.id)?.state === 'opened');
  ok('a one-letter typed name is refused', (await refusal(() => lettersSvc.signLetter(journeyA, appt.id, { method: 'type', typedName: 'K' }, { ip: '1.2.3.4' }))).status === 400);
  pl = await lettersSvc.signLetter(journeyA, appt.id, { method: 'type', typedName: 'Kabir Mehta' }, { ip: '1.2.3.4', userAgent: 'Check browser' });
  const signedAppt = (await db.letters().findOne({ id: appt.id }))!;
  ok('typed signature stored with time, IP and device', signedAppt.signature?.method === 'type' && signedAppt.signature.ip === '1.2.3.4' && signedAppt.signature.device === 'Check browser' && signedAppt.signature.signedAt instanceof Date);
  ok('the signed PDF is stored (pdf-lib)', Boolean(signedAppt.signedPdfFileId), signedAppt);
  const signedFile = (await db.lifecycleFiles().findOne({ id: signedAppt.signedPdfFileId }))!;
  const signedBytes = await files.readFileBytes(signedFile);
  const { PDFDocument } = await import('pdf-lib');
  const signedDoc = await PDFDocument.load(signedBytes);
  ok('the signed copy is a PDF with the record page added (2 + 1 pages), named after the original', signedDoc.getPageCount() === 3 && signedFile.name === 'Appointment letter – Kabir Mehta (signed).pdf' && signedFile.uploadedBy === 'system', { pages: signedDoc.getPageCount(), name: signedFile.name });
  const recordText = await pageText(signedBytes, -1);
  ok('its last page is the signature record: name, method, IP and device', recordText.includes(lettersSvc.SIGNATURE_RECORD_TITLE) && recordText.includes('Kabir Mehta') && recordText.includes('Typed name (Kabir Mehta)') && recordText.includes('1.2.3.4') && recordText.includes('Check browser'), recordText.slice(0, 400));
  const stampedText = await pageText(signedBytes, 1);
  ok('the signature itself is on the letter’s last page', stampedText.includes('Signed by Kabir Mehta') && stampedText.includes('Appointment letter · page 2'), stampedText.slice(0, 400));
  ok('the PDF’s metadata says it is signed, with the reference', (signedDoc.getKeywords() ?? '').includes('signed') && (signedDoc.getKeywords() ?? '').includes(appt.refNo), signedDoc.getKeywords());
  ok('the portal serves the signed copy of the appointment letter', (await lettersSvc.letterPdfForPortal(journeyA, appt.id)).bytes.equals(signedBytes));
  ok('signing twice is refused', (await refusal(() => lettersSvc.signLetter(journeyA, appt.id, { method: 'type', typedName: 'Kabir Mehta' }, { ip: '1.2.3.4' }))).status === 409);
  ok('a drawn signature must be an image', (await refusal(async () => { await lettersSvc.openLetter(journeyA, nda.id); return lettersSvc.signLetter(journeyA, nda.id, { method: 'draw', imageDataUrl: `data:image/png;base64,${Buffer.from('not png').toString('base64')}` }, { ip: '1.2.3.4' }); })).status === 400);
  lettersSvc.setPdfStamper({ async stamp(pdf) { return Buffer.concat([pdf, Buffer.from('%stamped')]); } });
  await lettersSvc.signLetter(journeyA, nda.id, { method: 'draw', imageDataUrl: `data:image/png;base64,${PNG.toString('base64')}` }, { ip: '1.2.3.4', userAgent: 'Check browser' });
  lettersSvc.setPdfStamper(lettersSvc.pdfLibStamper);
  const signedNda = (await db.letters().findOne({ id: nda.id }))!;
  ok('drawn signature: image stored, stamped PDF stored', Boolean(signedNda.signature?.imageFileId) && Boolean(signedNda.signedPdfFileId));
  ok('the portal serves the signed copy', (await lettersSvc.letterPdfForPortal(journeyA, nda.id)).bytes.toString().endsWith('%stamped'));
  ok('both signed: sign_letters done', (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'sign_letters' }))?.status === 'done');
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const drawn = await lettersSvc.pdfLibStamper.stamp(await realPdf('Drawn', 1), { name: 'Kabir Mehta', method: 'draw', image: { bytes: tinyPng, type: 'image/png' }, signedAt: new Date(), ip: '1.2.3.4', refNo: 'NDA/2026/001' });
  ok('the pdf-lib stamper also takes a drawn (PNG) signature', Boolean(drawn) && (await PDFDocument.load(drawn!)).getPageCount() === 2);
  ok('a file that is not a real PDF cannot be stamped (the signature record still stands)', (await lettersSvc.pdfLibStamper.stamp(Buffer.from('%PDF-1.4\n% not really a PDF\n%%EOF\n'), { name: 'x', method: 'type', typedName: 'x', signedAt: new Date(), refNo: 'r' }).catch(() => null)) === null);
  const lettersView = await lettersSvc.journeyLettersView(A);
  ok('the HR side panel sees both signed', lettersView.every((l) => l.state === 'signed' && l.signedAt));

  // ─── Day-1 pass ───────────────────────────────────────────────────────────
  section('Day-1 pass');
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('locked before Tj − 7 (403)', (await refusal(() => portalSvc.portalPass(journeyA))).status === 403);
  await db.journeys().updateOne({ id: A }, { $set: { day1Pass: { reportingTime: '09:30', place: 'Floor 4, Example Towers', askFor: { name: 'Hema HR' }, bring: ['Original ID'], agenda: [{ time: '09:30', title: 'Welcome and induction' }, { time: '16:00', title: 'Meet your team' }] } } });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  const pass = await portalSvc.portalPass(journeyA, at10(addDays(tj, -7)));
  ok('open at Tj − 7 with date, manager and the HR content', pass.date === tj && pass.managerName === 'Neha Rao' && pass.place === 'Floor 4, Example Towers');
  const ics = await portalSvc.portalPassIcs(journeyA, at10(addDays(tj, -7)));
  ok('.ics: one event from 09:30 IST to 17:00 IST', ics.includes('BEGIN:VEVENT') && ics.includes(`DTSTART:${tj.replace(/-/g, '')}T040000Z`) && ics.includes(`DTEND:${tj.replace(/-/g, '')}T113000Z`), ics);
  home = await portalSvc.portalHome(journeyA, at10(addDays(tj, -7)));
  ok('home view pass_unlocked once letters are signed', home.view === 'pass_unlocked' && home.path.find((p) => p.key === 'pass')?.state !== 'locked', home.view);
  clearLifecycleOutbox();
  await portalSvc.runPortalJobs(at10(addDays(tj, -7)));
  await portalSvc.runPortalJobs(new Date(at10(addDays(tj, -7)).getTime() + 3_600_000));
  ok('the Tj − 7 job emails the reporting details once', mailsTo(KABIR).filter((m) => m.subject.startsWith('Your first day')).length === 1, mailsTo(KABIR).map((m) => m.subject));
  ok('and the day1_pass task is done', (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'day1_pass' }))?.status === 'done');

  // ─── Date-change request ──────────────────────────────────────────────────
  section('Date-change request: approve moves Tj, offer v3, finalise again');
  const newTj = addDays(tj, 7);
  ok('a bad reason is refused', (await refusal(() => offersSvc.createDateRequest(journeyA, { requestedTj: newTj, reason: 'Because' }))).status === 400);
  ok('a past date is refused', (await refusal(() => offersSvc.createDateRequest(journeyA, { requestedTj: addDays(today, -1), reason: 'Personal' }))).status === 400);
  const request = await offersSvc.createDateRequest(journeyA, { requestedTj: newTj, reason: 'Notice period', note: 'My notice ends later.' });
  ok('request pending', request.status === 'pending');
  ok('a second pending request is refused', (await refusal(() => offersSvc.createDateRequest(journeyA, { requestedTj: newTj, reason: 'Personal' }))).status === 409);
  ok('home shows the pending request', (await portalSvc.portalHome((await db.journeys().findOne({ id: A }))!)).pendingDateRequest?.requestedTj === newTj);
  ok('another company’s HR cannot decide it', (await refusal(() => offersSvc.decideDateRequest(HR2, request.id, { decision: 'approve' }))).status === 404);
  clearLifecycleOutbox();
  const decided = await offersSvc.decideDateRequest(HR, request.id, { decision: 'approve', note: 'See you then!' });
  journeyA = (await db.journeys().findOne({ id: A }))!;
  offer = (await offersSvc.offerView(A))!;
  ok('approved: Tj moved and the offer revised (v3, Tj changed)', decided.status === 'approved' && journeyA.tj === newTj && offer.version === 3 && JSON.stringify(offer.changedFields) === '["tj"]' && offer.fields.tj === newTj, offer);
  ok('open due dates moved with Tj (mark joined, due Tj)', istDate((await db.journeyTasks().findOne({ journeyId: A, systemKey: 'mark_joined' }))!.dueAt!) === newTj);
  ok('done tasks keep their dates', istDate((await db.journeyTasks().findOne({ journeyId: A, systemKey: 'upload_documents' }))!.dueAt!) === addDays(tj, -5));
  ok('the candidate is emailed the outcome', Boolean(lastMail(KABIR)?.subject.includes('new joining date')));
  // v3 is only a draft: nothing about the offer changes for the candidate until HR sends it.
  ok('approval alone keeps the journey where it was (docs approved)', journeyA.status === 'docs_approved', journeyA.status);
  home = await portalSvc.portalHome(journeyA);
  ok('home before HR sends v3: no "HR updated your offer", the new Tj shown', home.view !== 'offer_updated' && !home.banner && home.tj === newTj && home.path.find((p) => p.key === 'offer')?.state === 'done', { view: home.view, banner: home.banner, tj: home.tj });
  ok('signed in, before HR sends v3 the session still shows v2, accepted and finalised', (await offersSvc.portalOfferForJourney(journeyA)).state === 'finalised' && (await offersSvc.portalOfferForJourney(journeyA)).version === 2);
  ok('…and v2’s link is not replaced yet', (await offersSvc.openOfferLink(token2, '1.1.1.1')).state === 'finalised');
  ok('there is nothing to finalise before v3 is sent and accepted', (await refusal(() => offersSvc.finaliseOffer(HR, A))).status === 409);
  await offersSvc.uploadOfferPdf(HR, A, { buffer: PDF('v3') });
  await offersSvc.sendOffer(HR, A, {});
  const token3 = tokenIn(lastMail(KABIR)!.html);
  ok('v2’s link is replaced now', (await offersSvc.openOfferLink(token2, '1.1.1.1')).state === 'replaced');
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('sent: the journey stays where it was (docs approved), no second finalise', journeyA.status === 'docs_approved' && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'finalise_offer' }))?.status === 'done', journeyA.status);
  home = await portalSvc.portalHome(journeyA);
  ok('home: offer_updated with the banner naming Tj', home.view === 'offer_updated' && home.banner?.changedFields?.[0] === 'tj' && home.upNext?.title === 'Read your updated offer' && home.upNext.helper === 'Joining date changed', home);
  ok('the token still opens the portal while the offer is updated', (await auth.journeyForPortalToken(`Bearer ${portalToken}`)).id === A);
  ok('there is nothing for HR to finalise while v3 waits', (await refusal(() => offersSvc.finaliseOffer(HR, A))).status === 409);
  const meOffer = await offersSvc.portalOfferForJourney(journeyA);
  ok('GET /portal/me/offer: v3 with its changes and the session PDF path', meOffer.state === 'offer' && meOffer.version === 3 && meOffer.changedFields?.[0] === 'tj' && meOffer.pdfUrl === '/portal/me/offer/pdf', meOffer);
  ok('GET /portal/me/offer/pdf serves v3', (await offersSvc.portalOfferPdfForJourney(journeyA)).bytes.toString().includes('v3'));
  const meViaRouter = await call(portalRouter as never, 'GET', '/me/offer', portalToken);
  ok('…through the router with the portal token', meViaRouter.status === 200 && (meViaRouter.body as { version?: number })?.version === 3);
  ok('…and not with an app token', (await call(portalRouter as never, 'GET', '/me/offer', appToken)).status === 401);
  const meAccepted = await offersSvc.acceptOfferForJourney(journeyA, { ip: '203.0.113.9', userAgent: 'Check' });
  ok('POST /portal/me/offer/accept accepts the latest version; already finalised (their login exists)', meAccepted.state === 'finalised' && (await db.offers().findOne({ journeyId: A }))!.versions[2].acceptedIp === '203.0.113.9' && !!(await db.offers().findOne({ journeyId: A }))!.versions[2].finalisedAt, meAccepted.state);
  ok('the v3 link agrees', (await offersSvc.openOfferLink(token3, '1.1.1.1')).state === 'finalised');
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('accepted v3: back where they were (docs approved), no second finalise, no second login email', journeyA.status === 'docs_approved' && (await refusal(() => offersSvc.finaliseOffer(HR, A))).status === 409 && !mailsTo(KABIR).some((m) => m.subject.includes('login details')));
  ok('HR is told the letters to sign again', mailsTo('hr@sowaka.test').some((m) => m.subject.includes('letters to sign again') && m.html.includes('appointment letter')) || lifecycleOutbox().some((m) => m.subject.includes('letters to sign again')), lifecycleOutbox().map((m) => m.subject));
  const oldAppt = (await db.letters().findOne({ id: appt.id }))!;
  ok('the signed appointment letter (it states Tj) is out of date, kept as signed history', !!oldAppt.signature && !!oldAppt.outdatedAt && oldAppt.outdatedFields?.includes('joiningDate') === true, oldAppt.outdatedFields);
  ok('the signed NDA (no Tj in it) is not', !(await db.letters().findOne({ id: nda.id }))!.outdatedAt);
  const regenerated = await db.letters().find({ journeyId: A, signature: { $exists: false } }).toArray();
  ok('a new appointment letter is drafted from v3 to sign again', regenerated.length === 1 && regenerated[0].kind === 'appointment' && regenerated[0].values.joiningDate === formatDay(newTj) && !regenerated[0].pdfFileId, regenerated.map((l) => [l.kind, l.values.joiningDate]));
  pl = await lettersSvc.portalLetters(journeyA);
  ok('on the portal: the new appointment letter waits for its PDF; the NDA stays signed', pl.find((l) => l.kind === 'appointment')?.state === 'locked' && pl.find((l) => l.kind === 'nda')?.state === 'signed', pl.map((l) => [l.kind, l.state]));
  ok('the Sign step is open again', (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'sign_letters' }))?.status !== 'done');
  clearLifecycleOutbox();
  for (const l of regenerated) await lettersSvc.uploadLetterPdf(HR, l.id, { buffer: PDF(l.kind) });
  ok('their "ready" mail goes again for the new set', mailsTo(KABIR).filter((m) => m.subject.includes('ready to sign')).length === 1);
  clearLifecycleOutbox();
  await portalSvc.runPortalJobs(at10(addDays(newTj, -3)));
  await portalSvc.runPortalJobs(new Date(at10(addDays(newTj, -3)).getTime() + 2 * 3_600_000));
  await portalSvc.runPortalJobs(at10(addDays(newTj, -2)));
  ok('unsigned letters: a nudge a day from Tj − 3', mailsTo(KABIR).filter((m) => m.subject.includes('Reminder: sign')).length === 2, mailsTo(KABIR).map((m) => m.subject));
  ok('the moved Tj gets its own Day-1 mail', mailsTo(KABIR).filter((m) => m.subject.startsWith('Your first day')).length === 1);
  await portalSvc.runPortalJobs(new Date(`${addDays(newTj, -1)}T23:00:00+05:30`));
  ok('no mail at night', mailsTo(KABIR).filter((m) => m.subject.includes('Reminder: sign')).length === 2);

  // ─── Mark joined ──────────────────────────────────────────────────────────
  section('Mark joined');
  ok('before Tj it is refused', (await refusal(() => offersSvc.markJoined(HR, A, { workEmail: 'kabir.mehta@sowaka.test' }))).status === 409);
  ok('a work email already in use is refused', (await refusal(() => offersSvc.markJoined(HR, A, { workEmail: 'mgr@sowaka.test' }, at10(newTj)))).status === 409);
  const joined = await offersSvc.markJoined(HR, A, { workEmail: 'Kabir.Mehta@sowaka.test', employeeId: 'SWT-101' }, at10(newTj));
  const user = (await db.users().findOne({ userId: joined.userId }))!;
  ok('the employee is created from the accepted offer', user.email === 'kabir.mehta@sowaka.test' && user.org === ORG && user.designation === 'Product Designer' && user.managerUserId === 'mgr' && user.employeeId === 'SWT-101' && user.joiningDate?.toISOString().slice(0, 10) === newTj, user);
  ok('with the personal email kept for later', user.personalEmail === KABIR);
  const welcome = lastMail(KABIR);
  ok('Mark joined emails the joiner: sign in to the app with the work email, the work address copied',
    Boolean(welcome?.subject.includes('sign in to the Sowaka app') && welcome.html.includes('kabir.mehta@sowaka.test') && welcome.html.includes('go.getsowaka.com/open')
      && JSON.stringify(welcome).includes('kabir.mehta@sowaka.test')), welcome?.subject);
  journeyA = (await db.journeys().findOne({ id: A }))!;
  ok('journey joined, userId bound, work email shown', journeyA.status === 'joined' && journeyA.userId === user.userId && journeyA.candidate?.workEmail === 'kabir.mehta@sowaka.test');
  home = await portalSvc.portalHome(journeyA);
  ok('home view joined with the work email, no path', home.view === 'joined' && home.workEmail === 'kabir.mehta@sowaka.test' && home.path.length === 0 && home.upNext?.key === 'app');
  ok('joined home: open until Tj + 7, the reporting time', home.portalOpenUntil === addDays(newTj, 7) && home.reportingTime === '09:30', home);
  ok('during week 1 the offer link says "all set" (sign in), not "Week 1 is done"', (await offersSvc.openOfferLink(token3, '1.1.1.1')).state === 'finalised');
  ok('marking joined twice is refused', (await refusal(() => offersSvc.markJoined(HR, A, { workEmail: 'k2@sowaka.test' }, at10(newTj)))).status === 409);

  // ─── Branches ─────────────────────────────────────────────────────────────
  section('Branches: decline / reopen, expire, not joining');
  const make = async (name: string, email: string, extra: Record<string, unknown> = {}, hr = HR) => {
    const { journeyId } = await offersSvc.createOffer(hr, { candidate: { name, personalEmail: email }, fields: fields(extra) });
    await offersSvc.uploadOfferPdf(hr, journeyId, { buffer: PDF(name) });
    await offersSvc.sendOffer(hr, journeyId, {});
    return { journeyId, token: tokenIn(lastMail(email)!.html) };
  };
  const B = await make('Bina Bose', 'bina.check@example.com');
  ok('decline before sending is refused (draft)', (await refusal(async () => {
    const { journeyId } = await offersSvc.createOffer(HR, { candidate: { name: 'Dee', personalEmail: 'dee.check@example.com' }, fields: fields() });
    return offersSvc.declineOffer(HR, journeyId);
  })).status === 409);
  await offersSvc.declineOffer(HR, B.journeyId, 'Took another offer');
  ok('declined: closed, the link says so', (await db.journeys().findOne({ id: B.journeyId }))?.status === 'declined' && (await offersSvc.openOfferLink(B.token, '1.1.1.1')).state === 'declined');
  ok('a declined offer cannot be accepted', (await refusal(() => offersSvc.acceptOffer(B.token, { ip: '1.1.1.1' }))).status === 409);
  ok('a declined offer cannot be revised until reopened', (await refusal(() => offersSvc.reviseOffer(HR, B.journeyId, { ctc: 1 }))).status === 409);
  await offersSvc.reopenOffer(HR, B.journeyId);
  ok('reopened while still valid: the same link opens the offer again', (await db.journeys().findOne({ id: B.journeyId }))?.status === 'offer_sent' && (await offersSvc.openOfferLink(B.token, '1.1.1.1')).state === 'offer');

  const C = await make('Chetan Rao', 'chetan.check@example.com', { validTill: today });
  const expiredRun = await portalSvc.runPortalJobs(at10(addDays(today, 1)));
  ok('the valid-till job expires the unaccepted offer', expiredRun.expired >= 1 && (await db.journeys().findOne({ id: C.journeyId }))?.status === 'expired');
  ok('the link says expired and cannot accept', (await offersSvc.openOfferLink(C.token, '1.1.1.1')).state === 'expired' && (await refusal(() => offersSvc.acceptOffer(C.token, { ip: '1.1.1.1' }))).status === 409);
  await offersSvc.reopenOffer(HR, C.journeyId);
  ok('reopening an expired offer makes a draft to revise', (await db.journeys().findOne({ id: C.journeyId }))?.status === 'draft');
  const cRevised = await offersSvc.reviseOffer(HR, C.journeyId, { validTill: addDays(today, 5) });
  ok('…which becomes v2 with its own valid-till', cRevised.version === 2 && cRevised.validTill === addDays(today, 5));
  const accepted = await make('Aarav Accept', 'aarav.check@example.com', { validTill: today });
  await offersSvc.acceptOffer(accepted.token, { ip: '1.1.1.1' });
  await portalSvc.runPortalJobs(at10(addDays(today, 1)));
  ok('an accepted offer no longer expires', (await db.journeys().findOne({ id: accepted.journeyId }))?.status === 'accepted');

  const G = await make('Gita Gill', 'gita.check@example.com');
  await offersSvc.reviseOffer(HR, G.journeyId, { ctc: 1500000 });
  ok('while HR drafts a revision the candidate can still accept the offer they were sent', (await offersSvc.acceptOffer(G.token, { ip: '1.1.1.1' })).state === 'accepted' && (await db.journeys().findOne({ id: G.journeyId }))?.status === 'accepted');
  await offersSvc.uploadOfferPdf(HR, G.journeyId, { buffer: PDF('g2') });
  await offersSvc.sendOffer(HR, G.journeyId, {});
  ok('…and once HR sends it, the accepted v1 is replaced and the candidate accepts again', (await offersSvc.openOfferLink(G.token, '1.1.1.1')).state === 'replaced' && (await db.journeys().findOne({ id: G.journeyId }))?.status === 'offer_sent');

  const D = await make('Divya Das', 'divya.check@example.com');
  ok('not joining needs an accepted offer', (await refusal(() => offersSvc.markNotJoining(HR, D.journeyId))).status === 409);
  await offersSvc.acceptOffer(D.token, { ip: '1.1.1.1' });
  clearLifecycleOutbox();
  await offersSvc.finaliseOffer(HR, D.journeyId);
  const dToken = tokenOf(await auth.signInWithCode('divya.check@example.com', await codeFor('divya.check@example.com', '4.4.4.4'), '4.4.4.4'));
  await offersSvc.markNotJoining(HR, D.journeyId, 'Joined elsewhere');
  const dJourney = (await db.journeys().findOne({ id: D.journeyId }))!;
  ok('not joining: closed, open tasks cancelled', dJourney.status === 'not_joining' && (await db.journeyTasks().countDocuments({ journeyId: D.journeyId, status: { $in: ['todo', 'locked'] } })) === 0);
  ok('the link says not joining', (await offersSvc.openOfferLink(D.token, '1.1.1.1')).state === 'not_joining');
  const closedTry = await auth.signInWithCode('divya.check@example.com', await codeFor('divya.check@example.com', '4.4.4.4'), '4.4.4.4');
  ok('the right code on a closed portal: no session, the closed screen', !('token' in closedTry) && 'closed' in closedTry && closedTry.closed.state === 'not_joining');
  const closedViaRoute = await call(portalRouter as never, 'POST', '/auth/verify', undefined, { email: 'divya.check@example.com', code: await codeFor('divya.check@example.com', '4.4.4.4') });
  const closedBody = closedViaRoute.body as { token?: string; closed?: { state?: string; company?: { name?: string }; hrContact?: { email?: string } } };
  ok('…a 200 with the closed screen to show (PX: not joining), the client and HR, and no token', closedViaRoute.status === 200 && !closedBody.token && closedBody.closed?.state === 'not_joining' && closedBody.closed.company?.name === 'Sowaka Test' && closedBody.closed.hrContact?.email === 'hr@sowaka.test', closedViaRoute.body);
  ok('…but a wrong code on a closed portal says nothing about it', !('closed' in ((await call(portalRouter as never, 'POST', '/auth/verify', undefined, { email: 'divya.check@example.com', code: '000001' })).body as object)));
  const dHome = await portalSvc.portalHome(await auth.journeyForPortalToken(`Bearer ${dToken}`));
  ok('an old session sees the closed screen', dHome.view === 'closed' && dHome.closedState === 'not_joining');
  const dDocs = await docsSvc.journeyDocumentsView(D.journeyId);
  ok('…and cannot upload', (await refusal(() => docsSvc.uploadDocumentFiles(dJourney, dDocs[0].id, [{ buffer: PDF() }]))).status === 409);

  // ─── Timed mails ──────────────────────────────────────────────────────────
  section('Timed mails: HR finalise reminder, login reminder, quiet nudge (once each)');
  const F = await make('Farhan Faiz', 'farhan.check@example.com');
  await offersSvc.acceptOffer(F.token, { ip: '1.1.1.1' });
  clearLifecycleOutbox();
  await portalSvc.runPortalJobs(at10(addDays(today, 5)));
  await portalSvc.runPortalJobs(new Date(at10(addDays(today, 5)).getTime() + 3_600_000));
  ok('accepted, not finalised after a working day: HR reminded once', mailsTo('hr@sowaka.test').filter((m) => m.subject.includes('finalise Farhan')).length === 1, mailsTo('hr@sowaka.test').map((m) => m.subject));
  await offersSvc.finaliseOffer(HR, F.journeyId);
  const loginSent = (await db.candidateAccounts().findOne({ journeyId: F.journeyId }))!.loginSentAt!;
  clearLifecycleOutbox();
  await portalSvc.runPortalJobs(new Date(loginSent.getTime() + 36 * 3_600_000));
  ok('no login reminder before two days', !mailsTo('farhan.check@example.com').length);
  const twoDays = at10(istDate(new Date(loginSent.getTime() + 2 * 86_400_000 + 86_400_000)));
  await portalSvc.runPortalJobs(twoDays);
  await portalSvc.runPortalJobs(new Date(twoDays.getTime() + 3_600_000));
  ok('two days without signing in: one reminder with the login email', mailsTo('farhan.check@example.com').filter((m) => m.subject.includes('waiting') && m.html.includes('farhan.check@example.com')).length === 1);
  const signedAt = at10(addDays(today, 4));
  await auth.signInWithCode('farhan.check@example.com', await codeFor('farhan.check@example.com', '3.3.3.3', signedAt), '3.3.3.3', signedAt);
  clearLifecycleOutbox();
  await portalSvc.runPortalJobs(at10(addDays(today, 6)));
  ok('two quiet days: no nudge yet', !mailsTo('farhan.check@example.com').some((m) => m.subject.includes('few things')));
  await portalSvc.runPortalJobs(at10(addDays(today, 7)));
  await portalSvc.runPortalJobs(at10(addDays(today, 8)));
  ok('three quiet days: one nudge for the stretch', mailsTo('farhan.check@example.com').filter((m) => m.subject.includes('few things')).length === 1);
  const fJourney = (await db.journeys().findOne({ id: F.journeyId }))!;
  const fHome = await portalSvc.portalHome(fJourney);
  ok('the batch: others joining the same day', fHome.batch.count >= 1 && fHome.batch.names.includes('Aarav'), fHome.batch);

  // ─── Feature switch ───────────────────────────────────────────────────────
  section('features.lifecycle off is refused');
  const offSession = randomBytes(32).toString('hex');
  await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(offSession).digest('hex'), userId: 'hr3', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  const offCall = await call(lifecycleOfferRouter as never, 'GET', '/letters', offSession);
  ok('a dashboard route answers 404 Not available', offCall.status === 404 && (offCall.body as { error?: string })?.error === 'Not available', offCall);
  const onCall = await call(lifecycleOfferRouter as never, 'GET', '/letter-templates', appToken);
  ok('…while the same route works where it is on', onCall.status === 200 && Array.isArray((onCall.body as { templates?: unknown[] })?.templates), onCall.status);
  const unowned = await call(lifecycleOfferRouter as never, 'GET', '/board', offSession);
  ok('paths this router does not own fall through untouched', unowned.next && unowned.status === 200);
  const E = await make('Esha Other', 'esha.check@example.com', { managerUserId: 'hr2' }, HR2);
  await db.companies().updateOne({ id: OTHER }, { $set: { 'features.lifecycle': false } });
  ok('the offer link of a company switched off is not found', (await refusal(() => offersSvc.openOfferLink(E.token, '1.1.1.1'))).status === 404);
  await db.companies().updateOne({ id: OTHER }, { $set: { 'features.lifecycle': true } });
  const itCall = await call(lifecycleOfferRouter as never, 'GET', '/letters/merge?kind=offer', undefined);
  ok('no session: 401', itCall.status === 401);

  // ─── Org isolation ────────────────────────────────────────────────────────
  section('Another company’s HR sees nothing');
  // The ID proof's file now: the re-upload after Send back replaced the first one.
  const idFileNow = (await db.candidateDocuments().findOne({ id: idDoc.id }))!.fileIds[0];
  ok('files: not found', (await refusal(() => files.fileForOrg(OTHER, idFileNow))).status === 404);
  ok('document review: not found', (await refusal(() => docsSvc.reviewDocument(HR2, addrDoc.id, { decision: 'approve' }))).status === 404);
  ok('offer changes: not found', (await refusal(() => offersSvc.reviseOffer(HR2, B.journeyId, { ctc: 1 }))).status === 404);
  ok('finalise / decline / mark joined: not found', (await refusal(() => offersSvc.finaliseOffer(HR2, F.journeyId))).status === 404
    && (await refusal(() => offersSvc.declineOffer(HR2, B.journeyId))).status === 404 && (await refusal(() => offersSvc.markJoined(HR2, A, { workEmail: 'a@b.co' }))).status === 404);
  ok('merge values: not found', (await refusal(() => lettersSvc.mergeValues(OTHER, { kind: 'offer', journeyId: A }))).status === 404);
  ok('letters: none listed, PDFs not uploadable', (await lettersSvc.listLetters(OTHER, {})).length === 0 && (await refusal(() => lettersSvc.uploadLetterPdf(HR2, appt.id, { buffer: PDF() }))).status === 404);
  ok('templates: their own six only', (await lettersSvc.listLetterTemplates(OTHER)).every((t) => t.org === OTHER));
  ok('a portal session cannot read another journey’s file', (await refusal(() => files.fileForJourney(F.journeyId, idFileNow))).status === 404);
  const otherHrSession = randomBytes(32).toString('hex');
  await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(otherHrSession).digest('hex'), userId: 'hr2', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  const crossFile = await call(lifecycleOfferRouter as never, 'GET', `/files/${idFileNow}`, otherHrSession);
  ok('GET /admin/lifecycle/files/:id from another company: 404', crossFile.status === 404, crossFile);
  const ownFile = await call(lifecycleOfferRouter as never, 'GET', `/files/${idFileNow}`, appToken);
  ok('…and the bytes for the right company (the re-uploaded file)', ownFile.status === 200 && Buffer.isBuffer(ownFile.body) && (ownFile.body as Buffer).equals(PDF('id')));
  const itSession = randomBytes(32).toString('hex');
  await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(itSession).digest('hex'), userId: 'it', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
  const offerPdfId = (await db.offers().findOne({ journeyId: A }))!.versions[0].pdfFileId!;
  ok('staff without pay access cannot download an offer PDF (CTC)', (await call(lifecycleOfferRouter as never, 'GET', `/files/${offerPdfId}`, itSession)).status === 403);
  ok('…nor a candidate document: the onboarding tab alone sees status only (HR opens the files)', (await call(lifecycleOfferRouter as never, 'GET', `/files/${idFileNow}`, itSession)).status === 403);
  ok('…and cannot read an appointment letter’s merge values', (await call(lifecycleOfferRouter as never, 'POST', `/letters/${appt.id}/send`, itSession, { to: 'x@y.co', body: 'x' })).status === 403);
  const noTab = await call(lifecycleOfferRouter as never, 'GET', '/letter-templates', itSession);
  ok('the onboarding tab opens letter templates; offboarding-only staff would too', noTab.status === 200);

  // ─── The portal on each company's own address (<org>.getsowaka.com/onboarding) ───
  {
    const { companyOfRequest } = await import('../routes/portal.routes');
    const { env: liveEnv } = await import('../config/env');
    const { portalLink } = await import('../services/lifecycle/emails');
    const reqFrom = (origin?: string, referer?: string) => ({ header: (n: string) => (n.toLowerCase() === 'origin' ? origin : n.toLowerCase() === 'referer' ? referer : undefined) }) as never;
    ok('a company address names its company', companyOfRequest(reqFrom('https://convrse.getsowaka.com')) === 'convrse');
    ok('the referer counts when there is no origin', companyOfRequest(reqFrom(undefined, 'https://acmt.getsowaka.com/onboarding/o/x')) === 'acmt');
    ok('shared addresses (join, go) name no company', companyOfRequest(reqFrom('https://join.getsowaka.com')) === null && companyOfRequest(reqFrom('https://go.getsowaka.com')) === null);
    ok('anything off the product domain names no company', companyOfRequest(reqFrom('http://localhost:5181')) === null && companyOfRequest(reqFrom('https://evil.example.com')) === null);
    const saved = liveEnv.portalBaseUrl;
    (liveEnv as { portalBaseUrl: string }).portalBaseUrl = 'https://{org}.getsowaka.com/onboarding';
    const link = portalLink('/sign-in', ORG);
    ok('emails link to the company\'s own portal address', link.startsWith(`https://${ORG}.getsowaka.com/onboarding/sign-in?c=`), link);
    ok('a link with no company falls back to the shared join address', portalLink('/') === 'https://join.getsowaka.com/onboarding/');
    (liveEnv as { portalBaseUrl: string }).portalBaseUrl = saved;
  }

  // ─── Offer as it runs now: the PDF only, the candidate replies, HR marks it accepted ───
  section('Offer (live rules): no accept link, no online accept, HR marks it accepted');
  {
    process.env.OFFER_ONLINE_ACCEPT = '0';
    try {
      const RIYA = 'riya.live@example.com';
      const B = (await offersSvc.createOffer(HR, { candidate: { name: 'Riya Live', personalEmail: RIYA }, fields: fields() })).journeyId;
      ok('marking an unsent offer accepted is refused', (await refusal(() => offersSvc.finaliseOffer(HR, B))).status === 409);
      await offersSvc.uploadOfferPdf(HR, B, { originalname: 'Offer letter.pdf', buffer: PDF('live') });
      clearLifecycleOutbox();
      await offersSvc.sendOffer(HR, B, {});
      const mail = lastMail(RIYA);
      ok('the email has the PDF and no accept link', !!mail && mail.attachments.length === 1 && !/\/o\//.test(mail.html) && !/accept it online/i.test(mail.html), mail?.html);
      ok('…and asks the candidate to reply to accept', /reply to this email/i.test(mail?.html ?? ''));
      const sentJ = (await db.journeys().findOne({ id: B }))!;
      ok('the candidate cannot accept online', (await refusal(() => offersSvc.acceptOfferForJourney(sentJ, { ip: '1.1.1.1' }))).status === 403);
      const done = await offersSvc.finaliseOffer(HR, B);
      const v = (await db.offers().findOne({ journeyId: B }))!.versions[0];
      ok('HR marks the sent offer accepted: accepted and finalised, by HR', done.status === 'accepted' && !!v.finalisedAt && v.finalisedByUserId === 'hr' && /Confirmed by HR/.test(v.acceptedDevice ?? ''), v);
      ok('…the portal is ready and its login emailed', (await db.journeys().findOne({ id: B }))?.status === 'finalised' && !!(await db.candidateAccounts().findOne({ journeyId: B })) && mailsTo(RIYA).some((m) => /joining portal is ready/i.test(m.subject)));
      ok('…and accept_offer and finalise_offer are done', (await db.journeyTasks().find({ journeyId: B, systemKey: { $in: ['accept_offer', 'finalise_offer'] } }).toArray()).every((t) => t.status === 'done'));
    } finally {
      process.env.OFFER_ONLINE_ACCEPT = '1';
    }
  }

  // ─── The dashboard's pre-boarding profile: HR reads it, approving locks a section, the Employees page ───
  section('Pre-boarding profile (dashboard): HR view, approve locks the section, the pre-boarding list, a joined employee’s documents');
  {
    const profileSvc = await import('../services/lifecycle/profile');
    const lock = await import('../services/lifecycle/profileLock');
    const appSvc = await import('../services/lifecycle/appOnboarding');
    const joinerSvc = await import('../services/lifecycle/joinerApp');
    const adminSvc = await import('../services/admin.service');
    const { lifecycleAdminRouter } = await import('../routes/lifecycle-admin.routes');
    const { adminRouter } = await import('../routes/admin.routes');
    const { tabsForRequest } = await import('../models/dashboard-tabs');
    type Field = { label: string; value: string };
    type FileRow = { id: string; name: string; contentType: string; size: number; url: string };
    type DocRow = { id: string; label: string; required: boolean; status: string; hrNote?: string; files: FileRow[] };
    type Sec = { key: string; title: string; done: boolean; approved?: { byName: string; at: string }; editedByHr?: { byName: string; at: string }; fields: Field[]; values: Record<string, unknown>; documents: DocRow[] };
    type BankPf = { title: string; state: string; declaredAt?: string; approved?: { byName: string; at: string }; sentBack?: { at: string; note?: string }; editedByHr?: { byName: string; at: string }; source: string; fields: Field[]; values: Record<string, unknown>; documents: DocRow[] };
    type HrProfile = { journeyId: string; candidate: Record<string, string>; done: number; total: number; sections: Sec[]; bankPf: BankPf; options: Record<string, string[]> };
    const bankValue = (p: HrProfile, label: string) => p.bankPf?.fields.find((f) => f.label === label)?.value;
    const value = (p: HrProfile, key: string, label: string) => p.sections.find((x) => x.key === key)?.fields.find((f) => f.label === label)?.value;

    // A fresh joiner, finalised (HR marks the sent offer accepted, as the live rules do).
    process.env.OFFER_ONLINE_ACCEPT = '0';
    let P = '';
    try {
      P = (await offersSvc.createOffer(HR, { candidate: { name: 'Nia Profile', personalEmail: 'nia.profile@example.com', phone: '+91 98111 22334' }, fields: fields() })).journeyId;
      await offersSvc.uploadOfferPdf(HR, P, { originalname: 'Offer.pdf', buffer: PDF('nia') });
      await offersSvc.sendOffer(HR, P, {});
      await offersSvc.finaliseOffer(HR, P);
    } finally {
      process.env.OFFER_ONLINE_ACCEPT = '1';
    }
    const jp = async () => (await db.journeys().findOne({ id: P }))!;
    await profileSvc.saveProfileSection(await jp(), 'personal', { fullName: 'Nia Profile', dob: '1998-03-12', gender: 'Female', maritalStatus: 'Single' });
    await profileSvc.saveProfileSection(await jp(), 'education', { qualification: 'Graduate', institution: 'Pune University', year: '2019', jobs: [{ company: 'Acme', role: 'Designer', from: '2020-03', to: '2023-06' }] });
    ok('the portal no longer takes bank and PF (the app’s own task since 24 Nov): 400', (await refusal(async () => profileSvc.saveProfileSection(await jp(), 'bank', { holderName: 'Nia Profile', ifsc: 'HDFC0001234', accountNumber: '123456789012', accountNumberAgain: '123456789012' }))).status === 400);
    // What the portal stored before 24 Nov stays readable: the bank account saved then, as it was saved.
    await db.journeys().updateOne({ id: P }, { $set: { 'profile.bank': profileSvc.sectionValue('bank', { holderName: 'Nia Profile', ifsc: 'HDFC0001234', accountNumber: '123456789012', accountNumberAgain: '123456789012' }, await jp(), new Date()).bank } });
    await profileSvc.saveProfileSection(await jp(), 'ids', { aadhaar: '234567890123', pan: 'ABCDE1234F' });
    await portalSvc.saveAboutYou(await jp(), { emergencyContact: { name: 'Asha Rao', relation: 'Parent', phone: '+91 91234 56789' }, pf: { firstJob: false, uan: '100000000001' } });

    const getProfile = () => call(lifecycleAdminRouter as never, 'GET', `/journeys/${P}/profile`, appToken);
    let res = await getProfile();
    let hp = res.body as HrProfile;
    ok('GET /admin/lifecycle/journeys/:id/profile: the five sections in the portal’s order (no bank and PF), done counted', res.status === 200 && hp.journeyId === P && hp.total === 5
      && JSON.stringify(hp.sections.map((x) => x.key)) === '["personal","contact","emergency","education","ids"]'
      && JSON.stringify(hp.sections.map((x) => x.done)) === '[true,false,true,true,false]' && hp.done === 3, { status: res.status, body: res.body });
    ok('…bank and PF apart (bankPf): to do (nothing declared in the app), the portal’s old answers shown', hp.bankPf?.state === 'todo' && hp.bankPf.source === 'portal' && !hp.bankPf.declaredAt && !hp.bankPf.approved
      && hp.bankPf.title === 'Bank account and PF' && bankValue(hp, 'Account holder') === 'Nia Profile' && bankValue(hp, 'IFSC') === 'HDFC0001234', hp.bankPf);
    ok('…the candidate: name, personal email, phone, designation, department, Tj and status', hp.candidate?.name === 'Nia Profile' && hp.candidate.personalEmail === 'nia.profile@example.com'
      && hp.candidate.phone === '+91 98111 22334' && hp.candidate.designation === 'Product Designer' && hp.candidate.department === 'Design' && hp.candidate.tj === tj && hp.candidate.status === 'finalised', hp.candidate);
    ok('…readable fields: the date of birth, the last job, the emergency contact, the UAN', value(hp, 'personal', 'Date of birth') === '12 Mar 1998' && value(hp, 'personal', 'Full name') === 'Nia Profile'
      && value(hp, 'education', 'Last job') === 'Designer at Acme (Mar 2020 – Jun 2023)' && value(hp, 'education', 'Year of passing') === '2019'
      && value(hp, 'emergency', 'Name') === 'Asha Rao' && value(hp, 'emergency', 'Mobile') === '+919123456789' && bankValue(hp, 'PF') === 'UAN 100000000001', hp.sections.map((x) => [x.key, x.fields]));
    ok('…secrets as their last four only (account, Aadhaar, PAN), never the whole number', bankValue(hp, 'Account number') === '•••• 9012' && value(hp, 'ids', 'Aadhaar')?.endsWith('0123') === true
      && value(hp, 'ids', 'PAN') === '••••••234F' && !JSON.stringify(hp).includes('123456789012') && !JSON.stringify(hp).includes('234567890123') && !JSON.stringify(hp).includes('ABCDE1234F'), hp.sections.find((x) => x.key === 'ids'));
    ok('…each section carries its template documents (ID proof under IDs, address proof under contact, the photo nowhere)',
      JSON.stringify(hp.sections.find((x) => x.key === 'ids')?.documents.map((d) => [d.label, d.required, d.status])) === '[["ID proof",true,"todo"]]'
      && hp.sections.find((x) => x.key === 'contact')?.documents[0]?.label === 'Address proof' && !hp.sections.some((x) => x.documents.some((d) => d.label === 'Passport photo')), hp.sections.map((x) => [x.key, x.documents]));

    const approve = (sec: string, bearer = appToken) => call(lifecycleAdminRouter as never, 'POST', `/journeys/${P}/profile/${sec}/approve`, bearer);
    const unlock = (sec: string) => call(lifecycleAdminRouter as never, 'DELETE', `/journeys/${P}/profile/${sec}/approve`, appToken);
    res = await approve('ids');
    ok('approving a section that isn’t done: 409 "This section isn\'t complete yet"', res.status === 409 && (res.body as { error?: string }).error === 'This section isn\'t complete yet', res);
    ok('…an unknown section: 400', (await approve('photo')).status === 400 && (await approve('salary')).status === 400);
    res = await approve('personal');
    hp = res.body as HrProfile;
    const personal = hp.sections?.find((x) => x.key === 'personal');
    ok('approve: the same body as the GET, the section approved by HR’s name with the time', res.status === 200 && personal?.approved?.byName === 'Hema HR' && !Number.isNaN(Date.parse(personal.approved.at)) && hp.sections.filter((x) => x.approved).length === 1, res.body);
    const stored = (await jp()).profileApprovals?.personal;
    ok('…kept on the journey as profileApprovals.personal { byUserId, byName, at }', stored?.byUserId === 'hr' && stored.byName === 'Hema HR' && stored.at instanceof Date, stored);
    const refusedPersonal = await refusal(async () => profileSvc.saveProfileSection(await jp(), 'personal', { fullName: 'Nia P', dob: '1998-03-12', gender: 'Female' }));
    ok('the candidate can no longer save an approved section: 409 with HR’s words', refusedPersonal.status === 409 && refusedPersonal.message === 'HR has approved this section. Write to HR if something needs to change.', refusedPersonal);
    ok('…the other sections still save', (await profileSvc.saveProfileSection(await jp(), 'education', { qualification: 'Graduate', institution: 'Pune University', year: '2019', firstJob: true })).sections.find((x) => x.key === 'education')?.done === true);
    const pv = await profileSvc.profileView(await jp());
    ok('the portal’s profile view marks the approved section locked (and only it)', JSON.stringify(pv.sections.map((x) => x.locked)) === '[true,false,false,false,false]', pv.sections);
    const appHome = await appSvc.onboardingHome({ userId: 'nobody', name: 'Nia Profile', org: ORG }, new Date(), await jp());
    ok('…and the app’s Your profile too', (appHome.profile.sections as Array<{ key: string; locked: boolean }>).find((x) => x.key === 'personal')?.locked === true
      && (appHome.profile.sections as Array<{ key: string; locked: boolean }>).filter((x) => x.locked).length === 1, appHome.profile.sections);

    await approve('emergency');
    const emergencyChange = await refusal(async () => portalSvc.saveAboutYou(await jp(), { emergencyContact: { name: 'Someone Else', relation: 'Friend', phone: '+91 98989 89898' } }));
    ok('emergency approved: About you refuses a change to the emergency contact (409)', emergencyChange.status === 409 && emergencyChange.message === lock.PROFILE_LOCKED_MESSAGE, emergencyChange);
    ok('…and a second contact', (await refusal(async () => portalSvc.saveAboutYou(await jp(), { emergencyContact2: { name: 'Ravi', relation: 'Sibling', phone: '+91 98989 89898' } }))).status === 409);
    ok('…saving the same contact again is not a change', (await portalSvc.saveAboutYou(await jp(), { emergencyContact: { name: 'Asha Rao', relation: 'Parent', phone: '+91 91234 56789' } })).emergencyContact?.name === 'Asha Rao');
    ok('…a PF from an older portal still saves', (await portalSvc.saveAboutYou(await jp(), { pf: { firstJob: false, uan: '100000000002' } })).pf?.uan === '100000000002');
    ok('bank and PF is not a section: approving it is 400', (await approve('bank')).status === 400);

    // The ID proof: uploaded (ids is done), opened from the dashboard by its url, approved, then locked.
    const idRow = (await db.candidateDocuments().findOne({ journeyId: P, docKey: 'id_proof' }))!;
    await docsSvc.uploadDocumentFiles(await jp(), idRow.id, [{ originalname: 'aadhaar.pdf', buffer: PDF('nia-id') }, { originalname: 'pan.jpg', buffer: JPG }]);
    hp = (await getProfile()).body as HrProfile;
    const idsSec = hp.sections.find((x) => x.key === 'ids')!;
    const idFiles = idsSec.documents[0]?.files ?? [];
    ok('ID proof uploaded: ids is done, its document in review with both files and dashboard links', idsSec.done && idsSec.documents[0]?.status === 'in_review' && idFiles.length === 2
      && idFiles.every((f) => f.url === `/admin/lifecycle/files/${f.id}` && f.size > 0 && !!f.contentType && !!f.name), idsSec);
    const opened = await call(lifecycleOfferRouter as never, 'GET', idFiles[0].url.replace(/^\/admin\/lifecycle/, ''), appToken);
    ok('…the file url opens the bytes on the dashboard’s authorised route', opened.status === 200 && Buffer.isBuffer(opened.body) && (opened.body as Buffer).equals(PDF('nia-id')), opened.status);
    res = await approve('ids');
    ok('…and ids can now be approved', res.status === 200 && !!(res.body as HrProfile).sections.find((x) => x.key === 'ids')?.approved, res.body);
    const lockedUpload = await refusal(async () => docsSvc.uploadDocumentFiles(await jp(), idRow.id, [{ originalname: 'again.pdf', buffer: PDF('again') }]));
    ok('uploads to a document of an approved section are refused (409, HR’s words), though the document itself is only in review', lockedUpload.status === 409 && lockedUpload.message === lock.PROFILE_LOCKED_MESSAGE, lockedUpload);
    ok('…and removing one of its files', (await refusal(async () => docsSvc.removeDocumentFile(await jp(), idRow.id, idFiles[1].id))).status === 409);
    ok('a document of another section still uploads (address proof, contact open)', (await docsSvc.uploadDocumentFiles(await jp(), (await db.candidateDocuments().findOne({ journeyId: P, docKey: 'address' }))!.id, [{ originalname: 'bill.pdf', buffer: PDF('nia-addr') }])).length > 0);
    await docsSvc.reviewDocument(HR, idRow.id, { decision: 'send_back', note: 'The PAN is blurred.' });
    ok('HR sending back a document of an approved section unlocks that section (so it can be uploaded again)', !(await jp()).profileApprovals?.ids && !!(await jp()).profileApprovals?.personal);
    await docsSvc.uploadDocumentFiles(await jp(), idRow.id, [{ originalname: 'pan-clear.jpg', buffer: JPG }]);
    ok('…and the re-upload goes in', (await db.candidateDocuments().findOne({ id: idRow.id }))?.status === 'in_review');

    res = await unlock('personal');
    ok('DELETE …/approve unlocks: the same body, no approval on it', res.status === 200 && !(res.body as HrProfile).sections.find((x) => x.key === 'personal')?.approved && !(await jp()).profileApprovals?.personal, res.body);
    ok('…the candidate can save it again', (await profileSvc.saveProfileSection(await jp(), 'personal', { fullName: 'Nia Profile', dob: '1998-03-13', gender: 'Female' })).sections[0].done);
    ok('…unlocking what is not approved is fine', (await unlock('personal')).status === 200);

    // HR changes the candidate's answers (PUT …/profile/:section): the portal's body and checks, approved sections too.
    const sec = (b: unknown, key: string) => (b as HrProfile).sections?.find((x) => x.key === key);
    {
      const put = (s: string, payload: unknown, bearer = appToken) => call(lifecycleAdminRouter as never, 'PUT', `/journeys/${P}/profile/${s}`, bearer, payload);
      hp = (await getProfile()).body as HrProfile;
      ok('GET carries each section’s raw values in the PUT’s shape (secrets as last four only)',
        JSON.stringify(sec(hp, 'personal')?.values) === JSON.stringify({ fullName: 'Nia Profile', dob: '1998-03-13', gender: 'Female', nationality: 'Indian' })
        && JSON.stringify(sec(hp, 'contact')?.values) === '{}'
        && JSON.stringify(sec(hp, 'emergency')?.values) === JSON.stringify({ emergencyContact: { name: 'Asha Rao', relation: 'Parent', phone: '+919123456789' } })
        && !sec(hp, 'bank') && JSON.stringify(hp.bankPf.values) === JSON.stringify({ holderName: 'Nia Profile', ifsc: 'HDFC0001234', accountLast4: '9012', pf: { firstJob: false, uan: '100000000002' } })
        && JSON.stringify(sec(hp, 'education')?.values) === JSON.stringify({ qualification: 'Graduate', institution: 'Pune University', year: '2019', firstJob: true, jobs: [] })
        && JSON.stringify(sec(hp, 'ids')?.values) === JSON.stringify({ aadhaarLast4: '0123', panLast4: '234F' })
        && !JSON.stringify(hp).includes('123456789012') && !JSON.stringify(hp).includes('Enc'), hp.sections.map((x) => [x.key, x.values]));
      ok('…and the form’s choices: genders, marital, qualifications, relations (the portal’s lists)',
        JSON.stringify(hp.options) === JSON.stringify({ ...profileSvc.PROFILE_OPTIONS, relations: ['Parent', 'Partner', 'Sibling', 'Friend'] }) && !hp.sections.some((x) => x.editedByHr), hp.options);

      await approve('personal');
      res = await put('personal', { fullName: 'Nia R Profile', preferredName: 'Nia', dob: '1998-03-12', gender: 'Female', maritalStatus: 'Married', nationality: 'Indian' });
      const pSec = sec(res.body, 'personal');
      ok('PUT personal on an approved section: 200, the GET’s body, still approved, edited by HR’s name with the time', res.status === 200 && (res.body as HrProfile).journeyId === P && Array.isArray((res.body as HrProfile).options?.relations)
        && !!pSec?.approved && pSec.editedByHr?.byName === 'Hema HR' && !Number.isNaN(Date.parse(pSec.editedByHr.at))
        && JSON.stringify(pSec.values) === JSON.stringify({ fullName: 'Nia R Profile', preferredName: 'Nia', dob: '1998-03-12', gender: 'Female', maritalStatus: 'Married', nationality: 'Indian' })
        && value(res.body as HrProfile, 'personal', 'Marital status') === 'Married', res.body);
      const edited = (await jp()).profileEditedByHr?.personal;
      ok('…kept on the journey as profileEditedByHr.personal { byUserId, byName, at }, the approval untouched', edited?.byUserId === 'hr' && edited.byName === 'Hema HR' && edited.at instanceof Date
        && (await jp()).profileApprovals?.personal?.byName === 'Hema HR' && (await jp()).profile?.personal?.fullName === 'Nia R Profile', edited);
      ok('…the candidate is still locked out of it', (await refusal(async () => profileSvc.saveProfileSection(await jp(), 'personal', { fullName: 'Nia', dob: '1998-03-12', gender: 'Female' }))).status === 409);
      res = await put('personal', { fullName: 'Nia', dob: '1998-03-12', gender: 'Robot' });
      ok('the portal’s checks: a gender not on the list is 400 "Pick your gender"', res.status === 400 && (res.body as { error?: string }).error === 'Pick your gender', res);
      ok('…an unknown section (or the photo): 400', (await put('salary', {})).status === 400 && (await put('photo', {})).status === 400);

      res = await put('contact', { mobile: '98111 22334', current: { line: '12 MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' }, permanentSame: false, permanent: { line: '4 Lake View', city: 'Nashik', state: 'Maharashtra', pin: '422001' } });
      ok('PUT contact: saved as the portal saves it (+91 mobile), values back in the same shape', res.status === 200 && JSON.stringify(sec(res.body, 'contact')?.values) === JSON.stringify({
        mobile: '+919811122334', current: { line: '12 MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' }, permanentSame: false, permanent: { line: '4 Lake View', city: 'Nashik', state: 'Maharashtra', pin: '422001' } }), res.body);
      ok('…a bad PIN: 400 with the portal’s words', (await put('contact', { mobile: '9811122334', current: { line: 'x', city: 'Pune', state: 'Maharashtra', pin: '0110' } })).status === 400);

      res = await put('emergency', { emergencyContact: { name: 'Ravi Rao', relation: 'Sibling', phone: '+91 98989 89898', altPhone: '97979 79797' }, emergencyContact2: { name: 'Asha Rao', relation: 'Parent', phone: '+91 91234 56789' } });
      ok('PUT emergency on an approved section: About you’s contacts replaced, still approved', res.status === 200 && !!sec(res.body, 'emergency')?.approved && JSON.stringify(sec(res.body, 'emergency')?.values) === JSON.stringify({
        emergencyContact: { name: 'Ravi Rao', relation: 'Sibling', phone: '+919898989898', altPhone: '+919797979797' }, emergencyContact2: { name: 'Asha Rao', relation: 'Parent', phone: '+919123456789' } })
        && (await jp()).aboutYou?.pf?.uan === '100000000002', res.body);
      ok('…a relation not on the list, the candidate’s own number, or no contact: 400', (await put('emergency', { emergencyContact: { name: 'X', relation: 'Boss', phone: '+91 98989 89898' } })).status === 400
        && (await put('emergency', { emergencyContact: { name: 'X', relation: 'Friend', phone: '+91 98111 22334' } })).status === 400 && (await put('emergency', {})).status === 400);
      res = await put('emergency', { emergencyContact: { name: 'Ravi Rao', relation: 'Sibling', phone: '+91 98989 89898' }, emergencyContact2: null });
      ok('…null removes the second contact', res.status === 200 && !(await jp()).aboutYou?.emergencyContact2 && !(await jp()).aboutYou?.emergencyContact?.altPhone, (await jp()).aboutYou);

      const bankBefore = (await jp()).profile!.bank!;
      res = await put('bank', { holderName: 'Nia R Profile', ifsc: 'icic0004321', bankName: 'ICICI Bank', accountNumber: '', accountNumberAgain: '', pf: { firstJob: true } });
      const bankAfter = (await jp()).profile!.bank!;
      const bankPfOf = (b: unknown) => (b as HrProfile).bankPf;
      ok('PUT bank (HR, no joiner needed) with the account number left blank: the stored number kept as it was, the rest and the PF changed; still to do (the joiner’s task)', res.status === 200
        && bankAfter.accountLast4 === '9012' && bankAfter.accountNumberEnc === bankBefore.accountNumberEnc && bankAfter.ifsc === 'ICIC0004321' && (await jp()).aboutYou?.pf?.firstJob === true
        && bankPfOf(res.body)?.state === 'todo' && bankPfOf(res.body)?.source === 'hr' && bankPfOf(res.body)?.editedByHr?.byName === 'Hema HR' && (await jp()).profileEditedByHr?.bank?.byName === 'Hema HR'
        && JSON.stringify(bankPfOf(res.body)?.values) === JSON.stringify({ holderName: 'Nia R Profile', ifsc: 'ICIC0004321', bankName: 'ICICI Bank', accountLast4: '9012', pf: { firstJob: true } }), { bankAfter, bankPf: bankPfOf(res.body) });
      ok('…two different account numbers: 400', (await put('bank', { holderName: 'Nia', ifsc: 'ICIC0004321', accountNumber: '998877665544', accountNumberAgain: '998877665545' })).status === 400);
      ok('…a 13-digit UAN: 400 (nothing saved)', (await put('bank', { holderName: 'Nia', ifsc: 'ICIC0004321', pf: { firstJob: false, uan: '1234567890123' } })).status === 400 && (await jp()).profile?.bank?.holderName === 'Nia R Profile');
      res = await put('bank', { holderName: 'Nia R Profile', ifsc: 'ICIC0004321', accountNumber: '9988 7766 5544' });
      const bankNew = (await jp()).profile!.bank!;
      const { fieldKeyConfigured } = await import('../services/fieldCrypto');
      ok('…a new account number typed once (no accountNumberAgain): stored as the portal stores it (last four, encrypted when a key is set), never sent back; the PF kept', res.status === 200 && bankNew.accountLast4 === '5544'
        && (fieldKeyConfigured() ? !!bankNew.accountNumberEnc && bankNew.accountNumberEnc !== bankBefore.accountNumberEnc : !bankNew.accountNumberEnc)
        && !JSON.stringify(res.body).includes('998877665544') && (await jp()).aboutYou?.pf?.firstJob === true, { bankNew, keySet: fieldKeyConfigured() });

      // Declared from the app (the payroll details task's send): done, by date; HR's approval: approved; sent back: to do again.
      const declaredAt = new Date();
      await db.journeys().updateOne({ id: P }, { $set: { bankPfRequest: { status: 'pending', source: 'payroll_task', changes: { accountHolder: 'Nia Profile', bankName: 'Axis Bank', ifsc: 'UTIB0000123', accountLast4: '7788', uanLast4: '0003' }, firstJob: false, nominees: [{ name: 'Asha Rao', relation: 'Mother', share: 100 }], requestedAt: declaredAt } } });
      let bp = ((await getProfile()).body as HrProfile).bankPf;
      ok('declared in the app: done ("declared", on its date), the app’s details shown (UAN as its last four, the nominee), not counted in the profile', bp.state === 'declared' && bp.declaredAt === declaredAt.toISOString() && bp.source === 'app'
        && bp.fields.find((f) => f.label === 'Account number')?.value === '•••• 7788' && bp.fields.find((f) => f.label === 'PF')?.value === 'UAN •••• 0003' && bp.fields.find((f) => f.label === 'PF nominee')?.value === 'Asha Rao (Mother) · 100%'
        && ((await getProfile()).body as HrProfile).total === 5, bp);
      res = await put('bank', { holderName: 'Nia Profile', ifsc: 'UTIB0000123', bankName: 'Axis Bank', pf: { firstJob: false } });
      bp = bankPfOf(res.body);
      ok('…HR edits it after the declaration, the number and UAN left blank: the app’s kept (last four), still declared, HR’s details shown', res.status === 200 && bp.state === 'declared' && bp.source === 'hr'
        && (await jp()).profile?.bank?.accountLast4 === '7788' && (await jp()).aboutYou?.pf?.uanLast4 === '0003' && bp.fields.find((f) => f.label === 'PF')?.value === 'UAN •••• 0003', { bp, stored: (await jp()).profile?.bank });
      await db.journeys().updateOne({ id: P }, { $set: { 'bankPfRequest.status': 'approved', 'bankPfRequest.decidedAt': new Date(), 'bankPfRequest.decidedByName': 'Hema HR' } });
      bp = ((await getProfile()).body as HrProfile).bankPf;
      ok('…HR approved it: approved, by name', bp.state === 'approved' && bp.approved?.byName === 'Hema HR', bp);
      await db.journeys().updateOne({ id: P }, { $set: { 'bankPfRequest.status': 'declined', 'bankPfRequest.hrNote': 'Wrong IFSC' } });
      bp = ((await getProfile()).body as HrProfile).bankPf;
      ok('…sent back: to do again, with HR’s note', bp.state === 'todo' && bp.sentBack?.note === 'Wrong IFSC' && !bp.declaredAt, bp);
      await db.journeys().updateOne({ id: P }, { $unset: { bankPfRequest: '' } });

      res = await put('ids', { aadhaar: '', pan: 'fghij5678k' });
      ok('PUT ids with Aadhaar blank: Aadhaar kept, PAN replaced (last four only back)', res.status === 200 && JSON.stringify(sec(res.body, 'ids')?.values) === JSON.stringify({ aadhaarLast4: '0123', panLast4: '678K' })
        && !JSON.stringify(res.body).includes('FGHIJ5678K') && (await jp()).profile?.ids?.aadhaarLast4 === '0123', res.body);
      ok('…a bad PAN: 400', (await put('ids', { pan: '12345' })).status === 400);
      res = await put('education', { qualification: 'Postgraduate', institution: 'IIT Bombay', year: '2021', firstJob: false, jobs: [{ company: 'Acme', role: 'Designer', from: '2020-03', to: '2023-06' }] });
      ok('PUT education: qualification and jobs, values back in the same shape', res.status === 200 && JSON.stringify(sec(res.body, 'education')?.values) === JSON.stringify({
        qualification: 'Postgraduate', institution: 'IIT Bombay', year: '2021', firstJob: false, jobs: [{ company: 'Acme', role: 'Designer', from: '2020-03', to: '2023-06' }] }), res.body);
      ok('…no last job and not first job: 400', (await put('education', { qualification: 'Graduate', institution: 'X', year: '2020', firstJob: false, jobs: [] })).status === 400);
      const pbSvc = await import('../services/lifecycle/preboardingProfile');
      const onTj = await pbSvc.hrSaveProfileSection({ userId: 'hr', name: 'Hema HR' }, await jp(), 'personal', { fullName: 'Nia R Profile', dob: '1998-03-12', gender: 'Female' }, at10(tj));
      ok('HR can still change it on joining day (the Tj − 1 lock is the candidate’s only)', onTj.sections.find((x) => x.key === 'personal')?.values.maritalStatus === undefined
        && (await refusal(async () => profileSvc.saveProfileSection(await jp(), 'education', { qualification: 'Graduate', institution: 'X', year: '2020', firstJob: true }, at10(tj)))).status === 409);
      const itPut = randomBytes(32).toString('hex');
      const otherPut = randomBytes(32).toString('hex');
      await db.authSessions().insertMany([
        { tokenHash: createHash('sha256').update(itPut).digest('hex'), userId: 'it', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
        { tokenHash: createHash('sha256').update(otherPut).digest('hex'), userId: 'hr2', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
      ] as never);
      ok('who may: the onboarding tab alone (IT) 403, another company 404; tab rule Onboarding or People › Employees',
        (await put('personal', {}, itPut)).status === 403 && (await put('personal', {}, otherPut)).status === 404
        && JSON.stringify(tabsForRequest('PUT', `/admin/lifecycle/journeys/${P}/profile/personal`)) === '["onboarding","employees"]');
      await unlock('personal');
    }

    // Ask to re-upload: HR sends back any uploaded document, in review or approved; an approved section unlocks.
    {
      const review = (id: string, payload: unknown) => call(lifecycleOfferRouter as never, 'POST', `/documents/${id}/review`, appToken, payload);
      const addr = (await db.candidateDocuments().findOne({ journeyId: P, docKey: 'address' }))!;
      res = await review(addr.id, { decision: 'send_back', note: 'The bill is older than 3 months.' });
      const sent = (res.body as { document?: DocRow }).document;
      ok('send back a document in review: sent_back with the note', res.status === 200 && sent?.status === 'sent_back' && sent.hrNote === 'The bill is older than 3 months.', res.body);
      await docsSvc.uploadDocumentFiles(await jp(), addr.id, [{ originalname: 'bill-new.pdf', buffer: PDF('nia-addr-2') }]);
      await review(addr.id, { decision: 'approve' });
      res = await approve('contact');
      ok('…re-uploaded and approved: contact is done and approved', res.status === 200 && !!sec(res.body, 'contact')?.approved, res.body);
      ok('Check the joining form: not done while a section is still open', !(await jp()).teamTasks?.hr_check_form);
      await approve('personal');
      await approve('education');
      ok('…the approval that completes the joining form (personal, contact, emergency, education) is "Check the joining form" done, by HR',
        (await jp()).teamTasks?.hr_check_form?.byName === 'Hema HR', (await jp()).teamTasks);
      await unlock('education');
      ok('…unlocking one of its sections makes it to do again', !(await jp()).teamTasks?.hr_check_form, (await jp()).teamTasks);
      await unlock('personal');
      res = await review(addr.id, { decision: 'send_back', note: 'Please upload the full page.' });
      const back = (await db.candidateDocuments().findOne({ id: addr.id }))!;
      ok('send back an APPROVED document: sent_back, the note kept, its approved section (contact) unlocked', res.status === 200 && back.status === 'sent_back' && back.hrNote === 'Please upload the full page.'
        && !(await jp()).profileApprovals?.contact && !!(await jp()).profileApprovals?.emergency, back);
      const portalDocs = await docsSvc.journeyDocumentsView(P);
      ok('…the candidate sees it first on the portal, with the note', portalDocs[0]?.id === addr.id && portalDocs[0].hrNote === 'Please upload the full page.', portalDocs.map((d) => [d.label, d.status]));
      ok('…one already sent back (nothing new uploaded) is not reviewed again (409)', (await review(addr.id, { decision: 'send_back', note: 'again' })).status === 409);
      const photoRow = (await db.candidateDocuments().findOne({ journeyId: P, docKey: 'photo' }))!;
      ok('…approving a document with nothing uploaded is still refused (409)', photoRow.status === 'todo' && (await review(photoRow.id, { decision: 'approve' })).status === 409);
      res = await review(photoRow.id, { decision: 'send_back', note: 'Please add a passport photo.' });
      ok('send back a document still TO DO (ask for it): sent_back with the note, still needs a note', res.status === 200 && (res.body as { document?: DocRow }).document?.status === 'sent_back'
        && (res.body as { document?: DocRow }).document?.hrNote === 'Please add a passport photo.', res.body);
      await db.candidateDocuments().updateOne({ id: photoRow.id }, { $set: { status: 'todo' }, $unset: { hrNote: '', reviewedAt: '', reviewedByName: '' } });
      await docsSvc.uploadDocumentFiles(await jp(), addr.id, [{ originalname: 'bill-full.pdf', buffer: PDF('nia-addr-3') }]);
      ok('…and the re-upload goes in (in review)', (await db.candidateDocuments().findOne({ id: addr.id }))?.status === 'in_review');
    }

    // Who may: HR only; another company not at all.
    const itSess = randomBytes(32).toString('hex');
    await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(itSess).digest('hex'), userId: 'it', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
    ok('the onboarding tab alone (IT) cannot read the profile (403) nor approve', (await call(lifecycleAdminRouter as never, 'GET', `/journeys/${P}/profile`, itSess)).status === 403 && (await approve('personal', itSess)).status === 403);
    const otherSess = randomBytes(32).toString('hex');
    await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(otherSess).digest('hex'), userId: 'hr2', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
    ok('another company’s HR: 404', (await call(lifecycleAdminRouter as never, 'GET', `/journeys/${P}/profile`, otherSess)).status === 404 && (await approve('personal', otherSess)).status === 404);
    ok('tab rules: the profile and the pre-boarding list open to Onboarding or People › Employees; files to Employees too',
      JSON.stringify(tabsForRequest('GET', `/admin/lifecycle/journeys/${P}/profile`)) === '["onboarding","employees"]' && JSON.stringify(tabsForRequest('POST', `/admin/lifecycle/journeys/${P}/profile/ids/approve`)) === '["onboarding","employees"]'
      && JSON.stringify(tabsForRequest('GET', '/admin/lifecycle/preboarding')) === '["onboarding","employees"]' && (tabsForRequest('GET', '/admin/lifecycle/files/x') ?? []).includes('employees')
      && JSON.stringify(tabsForRequest('GET', `/admin/lifecycle/journeys/${P}`)) === '["onboarding"]');

    // The Employees page's pre-boarding list.
    await db.journeys().updateOne({ id: P }, { $set: { 'profileApprovals.emergency': { byUserId: 'hr', byName: 'Hema HR', at: new Date() } } });
    res = await call(lifecycleAdminRouter as never, 'GET', '/preboarding', appToken);
    type Row = { journeyId: string; name: string; designation?: string; department?: string; tj?: string; status: string; profileDone: number; profileTotal: number; approvedSections: number; documentsWaiting: number };
    const people = Array.isArray(res.body) ? (res.body as Row[]) : [];
    const nia = people.find((x) => x.journeyId === P);
    const niaDone = (await profileSvc.profileView(await jp())).done;
    ok('GET /admin/lifecycle/preboarding (a bare array): the joiner with their profile count, approvals and documents with HR', res.status === 200 && !!nia && nia.name === 'Nia Profile' && nia.designation === 'Product Designer'
      && nia.department === 'Design' && nia.tj === tj && nia.status === 'finalised' && nia.profileDone === niaDone && nia.profileTotal === 5 && nia.approvedSections === 1 && nia.documentsWaiting === 2, nia);
    ok('…not the joined (Kabir) nor the closed (declined, not joining)', !people.some((x) => x.journeyId === A || x.journeyId === B.journeyId)
      && people.every((x) => !['joined', 'declined', 'expired', 'not_joining', 'moved_to_app', 'confirmed'].includes(x.status)), people.map((x) => [x.name, x.status]));
    ok('…soonest joining first', people.every((x, i) => i === 0 || (people[i - 1].tj ?? '9999') <= (x.tj ?? '9999')), people.map((x) => x.tj));
    ok('…another company sees its own only', ((await call(lifecycleAdminRouter as never, 'GET', '/preboarding', otherSess)).body as Row[]).every((x) => x.journeyId !== P));

    // Basic details (PUT …/profile/basic) and "Generate app access" (POST …/app-access); Mark joined then uses that account.
    let appUserId = '';
    {
      type Basic = Record<string, unknown> & { appAccess?: { userId: string; createdAt: string; emailedTo?: string; emailedAt?: string } };
      const basicOf = (b: unknown) => (b as { basic?: Basic }).basic;
      const putBasic = (payload: unknown, bearer = appToken) => call(lifecycleAdminRouter as never, 'PUT', `/journeys/${P}/profile/basic`, bearer, payload);
      const access = (payload: unknown, id = P, bearer = appToken) => call(lifecycleAdminRouter as never, 'POST', `/journeys/${id}/app-access`, bearer, payload);
      const errorOf = (r: { body: unknown }) => (r.body as { error?: string }).error;
      let b = basicOf((await getProfile()).body);
      ok('GET profile carries `basic`: name, role, team, work location, Tj, mobile, gender, DOB, reporting manager; no app access yet',
        b?.name === 'Nia R Profile' && b.designation === 'Product Designer' && b.department === 'Design' && b.workLocation === 'Bengaluru · Hybrid' && b.tj === tj
        && b.mobile === '+919811122334' && b.gender === 'Female' && b.dob === '1998-03-12' && JSON.stringify(b.reportingManager) === JSON.stringify({ userId: 'mgr', name: 'Neha Rao' })
        && !b.employeeId && !b.workEmail && !b.appAccess, b);
      res = await putBasic({ employeeId: ' SWT-201 ', workEmail: 'Nia.Profile@sowaka.test', designation: 'Senior Product Designer', department: 'Design', workLocation: 'Pune', employeeType: 'intern' });
      b = basicOf(res.body);
      ok('PUT …/profile/basic: saved on the journey (email lower-cased), the GET’s body back', res.status === 200 && b?.employeeId === 'SWT-201' && b.workEmail === 'nia.profile@sowaka.test'
        && b.designation === 'Senior Product Designer' && b.workLocation === 'Pune' && b.employeeType === 'intern' && Array.isArray((res.body as HrProfile).sections)
        && (await jp()).employeeId === 'SWT-201' && (await jp()).candidate?.workEmail === 'nia.profile@sowaka.test' && (await jp()).location === 'Pune', res.body);
      ok('…an employee ID someone has (an employee): 400', errorOf(await putBasic({ employeeId: 'H1' })) === 'Employee ID H1 is already in use');
      await db.journeys().updateOne({ id: A }, { $set: { employeeId: 'SWT-777' } });
      ok('…or another joiner: 400', (await putBasic({ employeeId: 'SWT-777' })).status === 400);
      await db.journeys().updateOne({ id: A }, { $unset: { employeeId: '' } });
      ok('…a work email an account has, or a bad one: 400', errorOf(await putBasic({ workEmail: 'HR@sowaka.test' })) === 'hr@sowaka.test is already someone’s work email'
        && errorOf(await putBasic({ workEmail: 'nia@' })) === 'A valid work email is required');
      ok('…an unknown employee type, a bad Tj: 400', (await putBasic({ employeeType: 'temp' })).status === 400 && (await putBasic({ tj: '2026-02-30' })).status === 400 && (await jp()).employeeId === 'SWT-201');
      res = await putBasic({ workLocation: '', employeeType: '', tj: '' });
      b = basicOf(res.body);
      ok('…"" clears: the work location and type fall back to the offer’s, Tj stays', res.status === 200 && !(await jp()).location && !(await jp()).employeeType
        && b?.workLocation === 'Bengaluru · Hybrid' && b.employeeType === 'full_time' && b.tj === tj && b.employeeId === 'SWT-201', b);
      await putBasic({ workLocation: 'Pune' });
      const taskDue = async () => (await db.journeyTasks().findOne({ journeyId: P, systemKey: 'mark_joined' }))?.dueAt;
      const dueBefore = await taskDue();
      res = await putBasic({ tj: addDays(tj, 2) });
      ok('…a new Tj moves the journey and its open due dates', res.status === 200 && basicOf(res.body)?.tj === addDays(tj, 2) && (await jp()).tj === addDays(tj, 2)
        && String(await taskDue()) !== String(dueBefore), { before: dueBefore, after: await taskDue() });
      await putBasic({ tj, designation: 'Product Designer', employeeType: 'full_time' });

      const draftJ = (await offersSvc.createOffer(HR, { candidate: { name: 'Dev Draft', personalEmail: 'dev.draft@example.com' }, fields: fields() })).journeyId;
      ok('POST …/app-access: not before the offer is accepted (409)', errorOf(await access({ workEmail: 'dev@sowaka.test' }, draftJ)) === 'App access opens once the offer is accepted');
      ok('…a work email an account has, or none: 400 (nothing made)', (await access({ employeeId: 'SWT-201', workEmail: 'mgr@sowaka.test' })).status === 400
        && (await access({ employeeId: 'SWT-201' })).status === 400 && !(await jp()).appAccess);
      await db.users().insertOne(person('empview', ORG, { name: 'Esha Viewer', dashboardAccess: true, dashboardTabs: ['employees'] }) as never);
      const viewSess = randomBytes(32).toString('hex');
      await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(viewSess).digest('hex'), userId: 'empview', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
      const viewAccess = await access({ employeeId: 'SWT-201', workEmail: 'nia.profile@sowaka.test' }, P, viewSess);
      ok('People › Employees without “Edit employee details”: edits Basic details (200) but cannot make the account (403)',
        (await putBasic({ department: 'Design' }, viewSess)).status === 200 && viewAccess.status === 403 && !(await jp()).appAccess, viewAccess);
      ok('…the onboarding tab alone (IT) 403, another company 404; tab rule Onboarding or People › Employees',
        (await access({ workEmail: 'nia.profile@sowaka.test' }, P, itSess)).status === 403 && (await access({ workEmail: 'nia.profile@sowaka.test' }, P, otherSess)).status === 404
        && JSON.stringify(tabsForRequest('POST', `/admin/lifecycle/journeys/${P}/app-access`)) === '["onboarding","employees"]');
      clearLifecycleOutbox();
      res = await access({ employeeId: 'SWT-201', workEmail: 'nia.profile@sowaka.test' });
      b = basicOf(res.body);
      appUserId = b?.appAccess?.userId ?? '';
      const welcome = lifecycleOutbox().filter((m) => m.subject.includes('your Sowaka app is ready'));
      ok('…the app-access mail: Mark joined’s welcome (sign in with the work email, open the app), to the personal address, the work one copied, worded for before Day 1',
        welcome.length === 1 && welcome[0].to === 'nia.profile@example.com' && JSON.stringify(welcome[0].cc) === '["nia.profile@sowaka.test"]'
        && welcome[0].html.includes('nia.profile@sowaka.test') && welcome[0].html.includes('go.getsowaka.com/open') && welcome[0].html.includes('Until you join') && !welcome[0].html.includes('From today'), welcome.map((m) => [m.to, m.cc, m.subject]));
      ok('…`basic.appAccess` says where and when it was emailed', b?.appAccess?.emailedTo === 'nia.profile@example.com' && !Number.isNaN(Date.parse(String((b.appAccess as Record<string, unknown>).emailedAt))), b?.appAccess);
      const appUser = await db.users().findOne({ userId: appUserId });
      ok('app access: the account made as Mark joined makes it (work email, employee ID, role, team, place, manager, Tj, personal email); `basic.appAccess` back',
        res.status === 200 && !!appUser && appUser.org === ORG && appUser.email === 'nia.profile@sowaka.test' && appUser.employeeId === 'SWT-201' && appUser.designation === 'Product Designer'
        && appUser.location === 'Pune' && appUser.managerUserId === 'mgr' && appUser.employeeType === 'full_time' && new Date(appUser.joiningDate as Date).toISOString().slice(0, 10) === tj
        && (appUser as { personalEmail?: string }).personalEmail === 'nia.profile@example.com' && !Number.isNaN(Date.parse(b?.appAccess?.createdAt ?? '')), { body: res.body, appUser });
      const jNow = await jp();
      ok('…kept as journey.appAccess (by HR); the journey is not joined (no userId, status unchanged)', jNow.appAccess?.byName === 'Hema HR' && jNow.appAccess.userId === appUserId && !jNow.userId && jNow.status === 'finalised', jNow.appAccess);
      res = await access({ employeeId: 'SWT-201', workEmail: 'nia.profile@sowaka.test' });
      ok('…a second time: 409 with the existing account', res.status === 409 && errorOf(res) === 'They already have app access' && (res.body as Basic).appAccess?.userId === appUserId, res.body);
      ok('…the app finds their joining portal through it before Day 1', (await auth.portalJourneyForAppUser(appUserId, ORG))?.id === P);
      const meNia = { userId: appUserId, name: 'Nia R Profile', org: ORG };
      const before = await appSvc.lifecycleMe(meNia) as { onboarding?: { journeyId?: string; stage?: string; portal?: boolean; tileVisible?: boolean } };
      const session = await auth.portalSessionForAppUser(meNia);
      ok('before Tj the app shows pre-boarding: /lifecycle/me onboarding { stage pre_boarding, portal: true }, and the in-app portal session opens their journey',
        before.onboarding?.journeyId === P && before.onboarding.stage === 'pre_boarding' && before.onboarding.portal === true && before.onboarding.tileVisible === false
        && auth.verifyPortalToken(session.token)?.sub === P, { before, url: session.url });
      const onTjMe = await appSvc.lifecycleMe(meNia, at10(tj)) as { onboarding?: unknown };
      ok('…on Tj, before Mark joined: no portal any more (it closes the day before) and no onboarding yet', !onTjMe.onboarding
        && (await refusal(() => auth.portalSessionForAppUser(meNia, at10(tj)))).status === 404, onTjMe);
      ok('…Basic details then keep the account’s work email and employee ID (409 on a change), other fields still edit',
        (await putBasic({ workEmail: 'nia2@sowaka.test' })).status === 409 && (await putBasic({ employeeId: 'SWT-999' })).status === 409
        && (await putBasic({ workEmail: 'nia.profile@sowaka.test', employeeId: 'SWT-201', department: 'Design' })).status === 200);
      ok('Mark joined with another work email than the account’s: 400', (await refusal(() => offersSvc.markJoined(HR, P, { workEmail: 'someone.else@sowaka.test' }, at10(tj)))).status === 400);
    }

    // Joined: the employee profile's Documents carry the onboarding uploads beside the filed ones.
    const niaUser = await offersSvc.markJoined(HR, P, { workEmail: 'nia.profile@sowaka.test', employeeId: 'SWT-201' }, at10(tj));
    ok('Mark joined after app access: that account is the employee (no second one), the journey bound to it',
      niaUser.userId === appUserId && (await db.users().countDocuments({ email: 'nia.profile@sowaka.test' })) === 1 && (await jp()).userId === appUserId && (await jp()).status === 'joined');
    const joinedMe = await appSvc.lifecycleMe({ userId: appUserId, name: 'Nia R Profile', org: ORG }, at10(tj)) as { onboarding?: { journeyId?: string; stage?: string; portal?: boolean } };
    ok('…and from Mark joined the same account opens onboarding (Day 1), not the portal', joinedMe.onboarding?.journeyId === P && joinedMe.onboarding.portal === false && joinedMe.onboarding.stage !== 'pre_boarding', joinedMe.onboarding);
    ok('once joined, they leave the pre-boarding list', !((await call(lifecycleAdminRouter as never, 'GET', '/preboarding', appToken)).body as Row[]).some((x) => x.journeyId === P));
    const joinerHome = await joinerSvc.joinerOnboarding({ userId: niaUser.userId, name: 'Nia Profile', org: ORG }).catch((e: Error) => ({ error: e.message }));
    ok('the joiner app’s profile view carries `locked` per section', 'profile' in joinerHome && joinerHome.profile.sections.find((x) => x.key === 'emergency')?.locked === true
      && joinerHome.profile.sections.find((x) => x.key === 'personal')?.locked === false, 'profile' in joinerHome ? joinerHome.profile.sections : joinerHome);
    type EmpDoc = { id: string; name: string; type: string | null; url?: string; uploadedAt: string | null; size: number | null; source: string; label?: string; status?: string; files?: FileRow[] };
    const empDocs = await call(adminRouter as never, 'GET', `/employees/${niaUser.userId}/documents`, appToken);
    const list = ((empDocs.body as { documents?: EmpDoc[] }).documents ?? []);
    const onboardingDocs = list.filter((d) => d.source === 'onboarding');
    const idEntry = onboardingDocs.find((d) => d.label === 'ID proof');
    ok('GET /admin/employees/:userId/documents: their onboarding documents, marked source onboarding, with label, status and file links',
      empDocs.status === 200 && onboardingDocs.length === 3 && !!idEntry && idEntry.status === 'in_review' && idEntry.name === 'ID proof' && idEntry.files?.length === 1 && idEntry.files[0].name === 'pan-clear.jpg'
      && idEntry.files.every((f) => f.url === `/admin/lifecycle/files/${f.id}`) && idEntry.url === idEntry.files[0].url && typeof idEntry.uploadedAt === 'string', { status: empDocs.status, body: empDocs.body });
    // A document HR filed (a link record: no S3 in the check), then the list again.
    await db.users().updateOne({ userId: niaUser.userId }, { $push: { documents: { id: 'filed-cv', name: 'cv.pdf', type: 'Resume', url: 'https://files.example/cv.pdf', uploadedAt: new Date() } } } as never);
    const both = ((await call(adminRouter as never, 'GET', `/employees/${niaUser.userId}/documents`, appToken)).body as { documents?: EmpDoc[] }).documents ?? [];
    ok('…a document HR filed comes first, marked source filed with its old fields, the onboarding ones after',
      both.length === 4 && both[0].source === 'filed' && both[0].id === 'filed-cv' && both[0].name === 'cv.pdf' && both[0].type === 'Resume' && both[0].url === 'https://files.example/cv.pdf' && 'size' in both[0]
      && both.slice(1).every((d) => d.source === 'onboarding'), both.map((d) => [d.source, d.name]));
    const afterRemove = await adminSvc.removeEmployeeDocument('hr', niaUser.userId, 'filed-cv', { seesDocuments: true });
    ok('…removing the filed one answers the list with the onboarding ones still in it', afterRemove.length === 3 && afterRemove.every((d) => d.source === 'onboarding'), afterRemove.map((d) => [d.source, d.name]));
    const statusOnly = await adminSvc.employeeDocumentsForAdmin('hr', niaUser.userId, { seesDocuments: false });
    ok('…someone outside HR gets the onboarding documents’ status only (no files or links)', statusOnly.filter((d) => d.source === 'onboarding').every((d) => 'files' in d && d.files.length === 0 && !d.url));
    const roster = await adminSvc.listAllEmployeesForAdmin('hr', { seesDocuments: true, org: ORG });
    const niaRow = roster.find((e) => e.userId === niaUser.userId);
    ok('GET /admin/employees: the employee’s documents carry the onboarding ones (source, label, status, files), the old fields kept',
      (niaRow?.documents ?? []).filter((d) => d.source === 'onboarding').length === 3 && (niaRow?.documents ?? []).every((d) => 'id' in d && 'name' in d && 'uploadedAt' in d && 'size' in d)
      && (niaRow?.documents as EmpDoc[]).find((d) => d.label === 'ID proof')?.files?.[0]?.url?.startsWith('/admin/lifecycle/files/') === true, niaRow?.documents);
    ok('…status only for someone outside HR; none without the dashboard viewer (old callers)',
      (await adminSvc.listAllEmployeesForAdmin('hr', { seesDocuments: false, org: ORG })).find((e) => e.userId === niaUser.userId)?.documents.every((d) => !('files' in d) || (d as EmpDoc).files?.length === 0) === true
      && (await adminSvc.listAllEmployeesForAdmin('hr')).find((e) => e.userId === niaUser.userId)?.documents.length === 0);
    // People › Employees alone (HR without lifecycle tabs) opens the candidate documents, nothing else stored there.
    await db.users().insertOne(person('emphr', ORG, { name: 'Esha Employees', dashboardAccess: true, dashboardTabs: ['employees'] }) as never);
    const empSess = randomBytes(32).toString('hex');
    await db.authSessions().insertOne({ tokenHash: createHash('sha256').update(empSess).digest('hex'), userId: 'emphr', createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } as never);
    const empOpen = await call(lifecycleOfferRouter as never, 'GET', `/files/${idEntry?.files?.[0]?.id}`, empSess);
    ok('People › Employees alone opens an onboarding document’s file', empOpen.status === 200 && Buffer.isBuffer(empOpen.body), empOpen.status);
    const offerPdf = (await db.offers().findOne({ journeyId: P }))!.versions[0].pdfFileId!;
    ok('…but not an offer PDF or other lifecycle file (403)', (await call(lifecycleOfferRouter as never, 'GET', `/files/${offerPdf}`, empSess)).status === 403);
    ok('…and reads the pre-boarding profile route (HR)', (await call(lifecycleAdminRouter as never, 'GET', `/journeys/${P}/profile`, empSess)).status === 200);
    const joinedPut = await call(lifecycleAdminRouter as never, 'PUT', `/journeys/${P}/profile/personal`, empSess, { fullName: 'Nia', dob: '1998-03-12', gender: 'Female' });
    ok('…may edit it too, but not once the joiner has joined (409)', joinedPut.status === 409 && (joinedPut.body as { error?: string }).error === 'Only someone still in pre-boarding can be changed here', joinedPut);
    // Bank and PF after joining: HR's edit goes to payroll too, so it needs payroll access (written first: a refusal saves nothing).
    const keyBefore = process.env.PAYROLL_FIELD_KEY;
    process.env.PAYROLL_FIELD_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const bankBody = { holderName: 'Nia R Profile', ifsc: 'KKBK0000111', bankName: 'Kotak', accountNumber: '5566 7788 9900', pf: { firstJob: false, uan: '100000000009' } };
      const noPay = await call(lifecycleAdminRouter as never, 'PUT', `/journeys/${P}/profile/bank`, empSess, bankBody);
      ok('joined: bank and PF by someone without payroll access is 403, nothing saved', noPay.status === 403 && (await jp()).profile?.bank?.ifsc !== 'KKBK0000111', noPay);
      const withPay = await call(lifecycleAdminRouter as never, 'PUT', `/journeys/${P}/profile/bank`, appToken, bankBody);
      const pay = await db.employeePaymentDetails().findOne({ org: ORG, userId: niaUser.userId });
      ok('…by HR with payroll access: on the journey and in payroll (account and UAN as their last four, encrypted)', withPay.status === 200 && (withPay.body as HrProfile).bankPf?.source === 'hr'
        && (await jp()).profile?.bank?.ifsc === 'KKBK0000111' && pay?.ifsc === 'KKBK0000111' && pay.accountLast4 === '9900' && pay.uanLast4 === '0009' && pay.accountHolder === 'Nia R Profile' && !String(pay.accountNumber).includes('556677889900'), { status: withPay.status, pay });
    } finally {
      if (keyBefore === undefined) delete process.env.PAYROLL_FIELD_KEY; else process.env.PAYROLL_FIELD_KEY = keyBefore;
    }
  }

  // Clean the scratch uploads this run wrote.
  const { rm } = await import('node:fs/promises');
  const path = await import('node:path');
  for (const org of [ORG, OTHER]) await rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', org), { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.closeDb();
  process.exit(failed ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
