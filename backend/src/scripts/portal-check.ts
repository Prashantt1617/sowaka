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
  const tj = addDays(today, 20);

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
  ok('the manager’s set-up push opens the set-up screen (destination + journeyId)', setupPush?.data?.destination === 'lifecycle_joiner_setup' && setupPush?.data?.journeyId === A, setupPush?.data);
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
  ok('view tasks_open, Tj and days to go', home.view === 'tasks_open' && home.tj === tj && home.daysToGo === 20, home);
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
  ok('step 1 saved on its own; the task waits for step 2', journeyA.aboutYou?.emergencyContact?.phone === '+919123456789' && (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'about_you' }))?.status !== 'done');
  await portalSvc.saveAboutYou(journeyA, { pf: { firstJob: false, uan: '1000 0000 0001' } });
  ok('both steps saved: task done', (await db.journeyTasks().findOne({ journeyId: A, systemKey: 'about_you' }))?.status === 'done');
  ok('About you locks on the joining day', (await refusal(() => portalSvc.saveAboutYou(journeyA, { pf: { firstJob: true } }, at10(tj)))).status === 409);
  journeyA = (await db.journeys().findOne({ id: A }))!;
  let items = await portalSvc.meetItems(journeyA);
  ok('Meet us: the company video and the role card', JSON.stringify(items.map((i) => i.id)) === '["company_video","role"]' && items.every((i) => !i.seen), items);
  ok('Meet us items carry a tag and a subtitle', items.every((i) => i.tag && i.subtitle));
  await db.journeys().updateOne({ id: A }, { $set: { 'meetUs.managerNote': { kind: 'text', text: 'Your portfolio made us rethink our own onboarding.' } } });
  const withNote = await portalSvc.meetItems((await db.journeys().findOne({ id: A }))!);
  ok('the manager’s note names its author and role once (the portal adds "· your manager")', withNote[0].id === 'manager_note' && withNote[0].authorName === 'Neha Rao' && withNote[0].authorRole === 'Design lead', withNote[0]);
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
  ok('…an expired one neither', auth.verifyMediaToken(auth.mediaPath(A, clipFile.id, new Date(Date.now() - 13 * 3_600_000)).split('/').pop()!) === null);
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
  ok('home: offer_updated with the banner naming Tj', home.view === 'offer_updated' && home.banner?.changedFields?.[0] === 'tj' && home.upNext?.title === 'Review your updated offer' && home.upNext.helper === 'Joining date changed', home);
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
  const E = await make('Esha Other', 'esha.check@example.com', { managerUserId: undefined }, HR2);
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
