/**
 * The whole employee lifecycle on a fake clock, in-process, on a scratch
 * database. The clock walks from the offer through probation confirmation for
 * joiners, and from the resignation through settlement and close for leavers.
 * At every simulated hour it runs what the scheduler runs (closeDueExits with
 * its tellTeamsAhead, runPortalJobs, runOffboardingJobs from the hourly tick;
 * runLifecycleJobs from the five-minute tick) with that `now`, and at every
 * milestone it checks what each person would see: the HR boards, the joiner's
 * /lifecycle/me and app home, the leaver's off-boarding page, the portal home,
 * every push and email (each exactly once) and that done tasks never move.
 *
 *   npm run lifecycle:timeline     (MONGODB_DB=el_timeline_scratch; local mongod on 127.0.0.1:27133 only)
 *
 * The clock: the global Date is replaced, so every `new Date()` in the product
 * reads the simulated instant. Times are IST (+05:30).
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
import { createHash, randomBytes } from 'node:crypto';

// ─── Environment: the local mongod and a scratch database only, no mail, no S3 ──
const LOCAL_URI = 'mongodb://127.0.0.1:27133';
if (process.env.MONGODB_URI && process.env.MONGODB_URI !== LOCAL_URI) {
  console.error(`lifecycle:timeline refuses to run against ${process.env.MONGODB_URI}; it runs on ${LOCAL_URI} only`);
  process.exit(1);
}
process.env.MONGODB_URI = LOCAL_URI;
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_timeline_scratch';
process.env.NOTIFY_ORGS = process.env.NOTIFY_ORGS ?? 'el-timeline';
process.env.EMAIL_ORGS = process.env.EMAIL_ORGS ?? 'el-timeline';
process.env.AWS_S3_BUCKET = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = '';
process.env.PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'timeline-secret';
process.env.PORTAL_BASE_URL = 'http://localhost:5181';
process.env.NODE_ENV = 'test';

// ─── The fake clock ─────────────────────────────────────────────────────────
const RealDate = Date;
let fakeMs = RealDate.parse('2027-02-28T09:00:00+05:30');
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fakeMs);
    else super(...(args as [number]));
  }
  static now() { return fakeMs; }
}
(globalThis as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;
const HOUR = 3_600_000;
/** An IST wall-clock instant. */
const T = (day: string, time = '10:00') => new Date(`${day}T${time}:00+05:30`);
const istKey = (d: Date) => new RealDate(d.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);
const istTime = (d: Date) => new RealDate(d.getTime() + 5.5 * HOUR).toISOString().slice(11, 16);
const nowLabel = () => `${istKey(new Date())} ${istTime(new Date())}`;

// ─── Output: the product's info logs are quiet; warnings and errors are kept and checked ──
const productErrors: string[] = [];
const productWarnings: string[] = [];
const say = console.log.bind(console);
console.info = () => {};
console.warn = (...a: unknown[]) => { productWarnings.push(a.map(String).join(' ')); };
console.error = (...a: unknown[]) => { productErrors.push(a.map(String).join(' ')); };

let passed = 0;
let failed = 0;
const failures: string[] = [];
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; say(`  ok   ${label}`); }
  else {
    failed += 1;
    const line = `${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 900)}`}`;
    failures.push(`[${nowLabel()}] ${line}`);
    say(`  FAIL ${line}`);
  }
}
function eq(label: string, got: unknown, want: unknown) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '(no refusal)' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}
const section = (title: string) => say(`\n${title}  [${nowLabel()} IST]`);

const ORG = 'el-timeline';
const PDF = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake image bytes')]);

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (env.mongoUri !== LOCAL_URI) throw new Error(`refusing to run against ${env.mongoUri}`);
  if (!/^el_timeline/.test(env.mongoDbName)) throw new Error(`refusing to run against database ${env.mongoDbName}`);
  await (await db.connectDb()).dropDatabase();
  await db.closeDb();
  await db.connectDb();
  const { companies, users, holidays, journeys, journeyTasks, notifications, surveyResponses, exitSettlements, authSessions, resignations, letters: lettersCol } = db;

  const { lifecycleOutbox, clearLifecycleOutbox } = await import('../services/lifecycle/emails');
  const engine = await import('../services/lifecycle/engine');
  const rules = await import('../services/lifecycle/dueRules');
  const templates = await import('../services/lifecycle/templates');
  const jobs = await import('../services/lifecycle/jobs');
  const board = await import('../services/lifecycle/board');
  const app = await import('../services/lifecycle/appOnboarding');
  const probation = await import('../services/lifecycle/probation');
  const offersSvc = await import('../services/lifecycle/offers');
  const docsSvc = await import('../services/lifecycle/documents');
  const lettersSvc = await import('../services/lifecycle/letters');
  const portalSvc = await import('../services/lifecycle/portal');
  const auth = await import('../services/lifecycle/portalAuth');
  const off = await import('../services/lifecycle/offboarding');
  const resig = await import('../services/lifecycle/resignations');
  const insights = await import('../services/lifecycle/insights');
  const exitSvc = await import('../services/exit.service');
  const { requireAuth } = await import('../middleware/auth.middleware');
  type Journey = import('../models/lifecycle.model').Journey;
  type JourneyTask = import('../models/lifecycle.model').JourneyTask;

  // ─── The clock and the scheduler ──────────────────────────────────────────
  function setNow(at: Date) {
    if (at.getTime() < fakeMs) throw new Error(`the clock cannot go back (${at.toISOString()} < ${new RealDate(fakeMs).toISOString()})`);
    fakeMs = at.getTime();
  }
  let ticks = 0;
  /** One scheduler hour, exactly as notification-scheduler runs it: the hourly jobs, then the five-minute tick. */
  /** Once a day: M0's slim read gives the same rows as reading every task (set once the manager exists). */
  let compareJoinerList: ((at: Date) => Promise<void>) | null = null;
  async function tick(at: Date) {
    setNow(at);
    ticks += 1;
    await exitSvc.closeDueExits(at); // with tellTeamsAhead and the settlement drafts
    await portalSvc.runPortalJobs(at);
    await off.runOffboardingJobs(at);
    await jobs.runLifecycleJobs(at);
    drainMail();
    if (compareJoinerList && new RealDate(at.getTime() + 5.5 * HOUR).getUTCHours() === 9) await compareJoinerList(at);
  }
  type Pace = 'hourly' | 'sparse';
  const SPARSE_HOURS = new Set([0, 9, 13, 21]);
  /** Every IST top of the hour after now up to `to` runs a tick (all 24, or four a day when sparse); then the clock stops at `to`. */
  async function advanceTo(to: Date, pace: Pace = 'hourly') {
    const first = Math.floor((fakeMs + 5.5 * HOUR) / HOUR) * HOUR - 5.5 * HOUR + HOUR;
    for (let t = first; t <= to.getTime(); t += HOUR) {
      const hour = new RealDate(t + 5.5 * HOUR).getUTCHours();
      if (pace === 'hourly' || SPARSE_HOURS.has(hour)) await tick(new Date(t));
    }
    setNow(to);
  }

  // ─── What people were told ────────────────────────────────────────────────
  const who = new Map<string, string>();
  const nameOf = (userId: string) => who.get(userId) ?? userId;
  interface Push { userId: string; scenario: string; title: string; body: string; data: Record<string, string>; at: Date }
  const allPushes: Push[] = [];
  const seenPush = new Set<string>();
  let pushCursor = 0;
  async function pullPushes() {
    const rows = await notifications().find({}, { projection: { _id: 1, id: 1, userId: 1, scenario: 1, title: 1, body: 1, data: 1, createdAt: 1 } }).sort({ _id: 1 }).toArray();
    for (const r of rows) {
      if (seenPush.has(r.id)) continue;
      seenPush.add(r.id);
      allPushes.push({ userId: r.userId, scenario: r.scenario, title: r.title, body: r.body, data: (r.data ?? {}) as Record<string, string>, at: r.createdAt });
    }
  }
  const NOISY = new Set(['lifecycle_task_overdue', 'lifecycle_due_changed']);
  /** The pushes since the last look, as "scenario>who" (overdue and due-date pushes apart). */
  async function newPushes(): Promise<string[]> {
    await pullPushes();
    const fresh = allPushes.slice(pushCursor);
    pushCursor = allPushes.length;
    return fresh.filter((p) => !NOISY.has(p.scenario)).map((p) => `${p.scenario}>${nameOf(p.userId)}`).sort();
  }
  const overdueSeen = new Set<number>();
  /** Overdue pushes for one journey not looked at yet, as "title>who". */
  async function newOverdue(journeyId: string): Promise<string[]> {
    await pullPushes();
    const out: string[] = [];
    allPushes.forEach((p, i) => {
      if (p.scenario !== 'lifecycle_task_overdue' || p.data.journeyId !== journeyId || overdueSeen.has(i)) return;
      overdueSeen.add(i);
      out.push(`${p.title.replace(/^Overdue: /, '')}>${nameOf(p.userId)}`);
    });
    return out.sort();
  }
  async function expectPushes(label: string, want: string[]) { eq(`pushes: ${label}`, await newPushes(), [...want].sort()); }

  interface Mail { to: string; subject: string; html: string; at: Date; attachments: number }
  const allMail: Mail[] = [];
  let mailCursor = 0;
  function drainMail() {
    for (const m of lifecycleOutbox()) allMail.push({ to: m.to, subject: m.subject, html: m.html, at: m.at, attachments: m.attachments.length });
    clearLifecycleOutbox();
  }
  const MAIL_KIND: Array<[RegExp, string]> = [
    [/^Your offer from/, 'offer'], [/accepted the offer: finalise it$/, 'accepted'], [/accepted the updated offer/, 'revision_accepted'], [/^Waiting for you: finalise/, 'finalise_reminder'],
    [/joining portal: login details$/, 'login'], [/^Your joining portal is waiting$/, 'login_reminder'], [/^A few things are waiting/, 'quiet'],
    [/^Please upload your .* again$/, 'sent_back'], [/^Your appointment letter is ready to sign$/, 'letters_ready'], [/^Reminder: sign/, 'letter_nudge'],
    [/^Your first day:/, 'day1_pass'], [/full and final settlement/, 'settlement'], [/joining date/, 'date_change'], [/^Reset your/, 'reset'],
  ];
  const mailKind = (subject: string) => MAIL_KIND.find(([re]) => re.test(subject))?.[1] ?? subject;
  const mailWho = (to: string) => to.split('@')[0].split('.')[0];
  function newMail(): string[] {
    drainMail();
    const fresh = allMail.slice(mailCursor);
    mailCursor = allMail.length;
    return fresh.map((m) => `${mailKind(m.subject)}>${mailWho(m.to)}`).sort();
  }
  function expectMail(label: string, want: string[]) { eq(`emails: ${label}`, newMail(), [...want].sort()); }
  const lastMailTo = (to: string) => { drainMail(); return [...allMail].reverse().find((m) => m.to === to); };
  const tokenIn = (html: string) => /\/o\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? '';
  const passwordIn = (html: string) => /monospace">([^<]+)</.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? '';
  function noProductErrors(label: string) {
    ok(`no job or service errors logged (${label})`, productErrors.length === 0, productErrors.slice(0, 3));
    productErrors.length = 0;
  }

  // ─── Reading what people see ──────────────────────────────────────────────
  type Tab = 'pre_boarding' | 'first_week' | 'probation';
  async function onCard(journeyId: string) {
    for (const tab of ['pre_boarding', 'first_week', 'probation'] as Tab[]) {
      const b = await board.onboardingBoard(ORG, 'hr', { tab });
      for (const col of b.columns) {
        const card = col.cards.find((c) => c.journeyId === journeyId);
        if (card) return { tab, column: col.key, flags: card.flags, dayLabel: card.dayLabel, plant: card.plant, quietDays: card.quietDays, waitingOn: card.waitingOn };
      }
    }
    return null;
  }
  async function offCard(userId: string) {
    for (const tab of ['resignations', 'notice', 'exit']) {
      const b = await off.offboardingBoard('hr', { tab });
      for (const col of b.columns) {
        const card = col.cards.find((c) => c.userId === userId);
        if (card) return { tab, column: col.key, flag: card.flag?.key ?? null, due: card.due, owner: card.owner.role, nextStep: card.nextStep, late: card.late };
      }
    }
    return null;
  }
  const journey = async (id: string) => (await journeys().findOne({ id }, { projection: { _id: 0 } })) as Journey;
  const portalHome = async (id: string) => portalSvc.portalHome(await journey(id));
  const pathOf = (home: { path: Array<{ key: string; state: string }> }) => home.path.map((p) => `${p.key}:${p.state}`);
  const task = async (journeyId: string, key: string, month?: number) =>
    (await journeyTasks().findOne({ journeyId, systemKey: key as never, ...(month ? { month } : {}) }, { projection: { _id: 0 } })) as JourneyTask;
  const dayOf = (d: Date | null | undefined) => (d ? rules.keyOfDay(d) : null);
  /** The done tasks of a journey and their dates, to compare after a date moves. */
  async function doneDates(journeyId: string) {
    const rows = await journeyTasks().find({ journeyId, status: { $in: ['done', 'skipped'] } }, { projection: { _id: 0 } }).toArray();
    return new Map(rows.map((t) => [t.id, `${t.systemKey}:${dayOf(t.opensAt)}:${dayOf(t.dueAt)}:${t.doneAt?.toISOString()}`]));
  }
  async function openDue(journeyId: string) {
    const rows = await journeyTasks().find({ journeyId, status: { $in: ['locked', 'todo', 'in_review', 'sent_back'] } }, { projection: { _id: 0 } }).toArray();
    return new Map(rows.map((t) => [`${t.systemKey}${t.month ? `#${t.month}` : ''}`, dayOf(t.dueAt)]));
  }
  async function doneTasksStayed(label: string, journeyId: string, before: Map<string, string>, except: string[] = []) {
    const after = await doneDates(journeyId);
    const moved = [...before].filter(([id, v]) => after.has(id) && after.get(id) !== v && !except.some((k) => v.startsWith(`${k}:`)));
    ok(`done tasks did not move: ${label}`, moved.length === 0 && before.size > 0, { moved, before: before.size });
  }

  // App session tokens, to see the app refuse someone whose access ended.
  async function appSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await authSessions().insertOne({ tokenHash: createHash('sha256').update(token).digest('hex'), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86_400_000) } as never);
    return token;
  }
  function authCall(token: string): Promise<{ status: number; next: boolean }> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      const out = { status: 200, next: false };
      const req = { method: 'GET', url: '/profile', originalUrl: '/profile', path: '/profile', headers, header: (n: string) => headers[n.toLowerCase()], body: {}, query: {}, params: {}, socket: { remoteAddress: '127.0.0.1' }, requestId: 'timeline' };
      const res = {
        statusCode: 200, headersSent: false, locals: {},
        status(code: number) { out.status = code; this.statusCode = code; return this; },
        json() { this.headersSent = true; resolve(out); return this; },
        send() { this.headersSent = true; resolve(out); return this; },
        setHeader() {}, getHeader() { return undefined; }, on() { return this; },
      };
      void (requireAuth as unknown as (a: unknown, b: unknown, c: (e?: unknown) => void) => unknown)(req, res, (err?: unknown) => { out.next = !err; if (err) out.status = 401; resolve(out); });
    });
  }

  // ─── Setup (Sunday 28 Feb 2027) ───────────────────────────────────────────
  section('Setup: one company, HR, a manager, four on the team, IT and Finance staff');
  const HOLIDAY_1 = '2027-03-03'; // Wed, in pre-boarding
  const HOLIDAY_2 = '2027-08-09'; // Mon, the working day after Ravi's last day
  await companies().insertOne({
    id: ORG, name: 'Timeline Labs', features: { exits: true, lifecycle: true }, exitNoticeDays: 30,
    profile: { displayName: 'Timeline Labs', replyToEmail: 'hr@el-timeline.test', city: 'Bengaluru' },
  } as never);
  await holidays().insertMany([
    { org: ORG, state: '*', type: 'Public', date: new Date(`${HOLIDAY_1}T00:00:00Z`), name: 'Timeline Day' },
    { org: ORG, state: '*', type: 'Public', date: new Date(`${HOLIDAY_2}T00:00:00Z`), name: 'Founders Day' },
  ] as never[]);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@el-timeline.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date('2024-01-01T00:00:00Z'), ...extra,
  });
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, employeeId: 'ELT-0', joiningDate: new Date('2018-01-01T00:00:00Z') }),
    person('mgr', 'Neha Rao', { role: 'manager', designation: 'Design lead', department: 'Design', managerUserId: 'hr', employeeId: 'ELT-M' }),
    person('ravi', 'Ravi Menon', { employeeId: 'ELT-1', department: 'Design', designation: 'Senior designer', managerUserId: 'mgr', joiningDate: new Date('2021-01-04T00:00:00Z') }),
    person('wanda', 'Wanda Dsouza', { employeeId: 'ELT-2', department: 'Design', managerUserId: 'ravi', joiningDate: new Date('2024-06-03T00:00:00Z') }),
    person('esha', 'Esha Iyer', { employeeId: 'ELT-3', department: 'Design', managerUserId: 'mgr', joiningDate: new Date('2025-02-03T00:00:00Z') }),
    person('tom', 'Tarun Shah', { employeeId: 'ELT-4', department: 'Design', managerUserId: 'mgr', joiningDate: new Date('2023-05-01T00:00:00Z') }),
    person('it', 'Ishaan IT', { dashboardAccess: true, dashboardTabs: ['offboarding'], clearanceTeam: 'it', department: 'Technology', employeeId: 'ELT-IT' }),
    person('fin', 'Farida Finance', { dashboardAccess: true, dashboardTabs: ['offboarding'], clearanceTeam: 'finance', department: 'Finance', employeeId: 'ELT-FIN' }),
  ] as never[]);
  for (const id of ['hr', 'mgr', 'ravi', 'wanda', 'esha', 'tom', 'it', 'fin']) who.set(id, id);
  await templates.ensureDefaultTemplates(ORG);
  const HR = { userId: 'hr', name: 'Hema HR', org: ORG, seesPay: true };
  const HRME = { userId: 'hr', name: 'Hema HR' };
  const HRO = { ...HRME, org: ORG };
  const MGR = { userId: 'mgr', name: 'Neha Rao', org: ORG };
  let listDays = 0, listMismatch = 0;
  compareJoinerList = async (at) => {
    listDays += 1;
    const [slim, full] = await Promise.all([app.joinersForManager(MGR, at), app.joinersForManager(MGR, at, { fullTasks: true })]);
    if (JSON.stringify(slim) !== JSON.stringify(full)) {
      listMismatch += 1;
      if (listMismatch <= 3) ok(`M0 slim read = full read on ${at.toISOString().slice(0, 10)}`, false, { slim, full });
    }
  };
  ok('the scratch company is the only one with the lifecycle on', (await companies().countDocuments({ 'features.lifecycle': true })) === 1);
  const cal = await rules.workCalendar(ORG);
  ok('Saturday and Sunday off; the two holidays are off', !rules.isWorkingDay('2027-03-06', cal) && !rules.isWorkingDay('2027-03-07', cal) && !rules.isWorkingDay(HOLIDAY_1, cal) && !rules.isWorkingDay(HOLIDAY_2, cal) && rules.isWorkingDay('2027-03-04', cal));

  // ═════════════════════════════════════════════════════════════ JOINERS
  const TJ = '2027-03-22'; // Monday, three weeks out
  const TJ_B = '2027-03-29'; // Bina's, after her revised offer
  const offerFields = (tj: string, extra: Record<string, unknown> = {}) => ({
    designation: 'Product Designer', department: 'Design', location: 'Bengaluru', ctc: 1_400_000, tj, managerUserId: 'mgr',
    probationMonths: 3, noticeDays: 30, validTill: '2027-03-08', responsibilities: 'Own the onboarding experience.', ...extra,
  });
  const KABIR = 'kabir.mehta@example.com';
  const BINA = 'bina.bose@example.com';
  const CHETAN = 'chetan.rao@example.com';

  // ── Mon 1 Mar: offers out
  await advanceTo(T('2027-03-01', '10:30'));
  section('1 · Offers sent (Kabir, Bina, Chetan; Tj Mon 22 Mar, 3 months probation)');
  const make = async (name: string, email: string, phone: string) => {
    const { journeyId } = await offersSvc.createOffer(HR, { candidate: { name, personalEmail: email, phone }, fields: offerFields(TJ) });
    await offersSvc.uploadOfferPdf(HR, journeyId, { originalname: `Offer - ${name}.pdf`, buffer: PDF(name) });
    await offersSvc.sendOffer(HR, journeyId, {});
    return journeyId;
  };
  const A = await make('Kabir Mehta', KABIR, '+91 98765 43210');
  const B = await make('Bina Bose', BINA, '+91 98765 43211');
  const C = await make('Chetan Rao', CHETAN, '+91 98765 43212');
  const tokenA = tokenIn(lastMailTo(KABIR)!.html);
  const tokenB1 = tokenIn(lastMailTo(BINA)!.html);
  const tokenC = tokenIn(lastMailTo(CHETAN)!.html);
  expectMail('one offer email each, with the PDF', ['offer>kabir', 'offer>bina', 'offer>chetan']);
  ok('the offer email carries the PDF and the link', lastMailTo(KABIR)!.attachments === 1 && tokenA.length > 30);
  let card = await onCard(A);
  eq('board: Pre-boarding › Offer sent, "In 21 days"', [card?.tab, card?.column, card?.dayLabel], ['pre_boarding', 'offer_sent', 'In 21 days']);
  ok('board: not expiring yet (valid till Mon 8 Mar, 7 days)', !card?.flags.includes('expires_soon'), card?.flags);
  eq('the link opens the offer', (await offersSvc.openOfferLink(tokenA, '1.1.1.1')).state, 'offer');
  await board.updateJourneyByHr(ORG, A, { day1Pass: { reportingTime: '09:30', place: 'Floor 4, Timeline Towers', askFor: { name: 'Hema HR' }, agenda: [{ time: '11:30', title: 'Meet your manager', with: 'Neha' }, { time: '14:30', title: 'Meet your team' }] } });
  await expectPushes('nobody is pushed for an offer', []);

  // ── Tue 2 Mar: they accept; HR finalises Bina and Chetan the same day, not Kabir
  await advanceTo(T('2027-03-02', '11:30'));
  section('1 · Accepted (Kabir waits for HR to finalise)');
  eq('Kabir accepts', (await offersSvc.acceptOffer(tokenA, { ip: '203.0.113.9', userAgent: 'Timeline phone' })).state, 'accepted');
  await offersSvc.acceptOffer(tokenB1, { ip: '203.0.113.10' });
  await offersSvc.acceptOffer(tokenC, { ip: '203.0.113.11' });
  expectMail('HR is emailed to finalise, once per acceptance', ['accepted>hr', 'accepted>hr', 'accepted>hr']);
  card = await onCard(A);
  ok('board: Accepted, Needs you', card?.column === 'accepted' && card.flags.includes('needs_you'), card);
  eq('Kabir’s link: accepted, waiting for HR', (await offersSvc.openOfferLink(tokenA, '1.1.1.1')).state, 'accepted');
  const finaliseDue = dayOf((await task(A, 'finalise_offer')).dueAt);
  eq('finalising is due 1 working day after acceptance, skipping the holiday (Wed 3 Mar)', finaliseDue, '2027-03-04');
  await advanceTo(T('2027-03-02', '14:00'));
  await offersSvc.finaliseOffer(HR, B);
  await offersSvc.finaliseOffer(HR, C);
  const passB = passwordIn(lastMailTo(BINA)!.html);
  const passC = passwordIn(lastMailTo(CHETAN)!.html);
  expectMail('Bina and Chetan get their login', ['login>bina', 'login>chetan']);
  await expectPushes('no set-up to-do push to the manager (HR assigns onboarding tasks on the dashboard)', []);
  await advanceTo(T('2027-03-02', '16:00'));
  await auth.signIn(CHETAN, passC, '4.4.4.4');
  // HR raises Bina's laptop request now: a done task that must not move when her joining day does.
  await board.actOnTaskByHr(ORG, B, (await task(B, 'device_request')).id, { action: 'done', note: 'Raised with IT' }, HRME);

  // ── Wed 3 Mar (holiday): Bina signs in; no reminder yet
  await advanceTo(T('2027-03-03', '10:00'));
  await auth.signIn(BINA, passB, '5.5.5.5');
  await advanceTo(T('2027-03-04', '08:30'));
  expectMail('nothing to HR on the holiday', []);
  section('1 · Not finalised for a working day: the HR reminder (the holiday does not count)');
  await advanceTo(T('2027-03-04', '23:30'));
  expectMail('Thu 4 Mar: the one working day is not over yet, no reminder', []);
  card = await onCard(A);
  ok('board Thu: finalising is not late yet', !card?.flags.includes('late'), card?.flags);
  await advanceTo(T('2027-03-05', '09:30'));
  expectMail('Fri 5 Mar 09:00: HR is reminded to finalise Kabir, once', ['finalise_reminder>hr']);
  card = await onCard(A);
  ok('board Fri: Late and Needs you', card?.flags.includes('late') && card.flags.includes('needs_you'), card?.flags);
  await advanceTo(T('2027-03-05', '12:00'));
  expectMail('the reminder does not repeat', []);
  noProductErrors('pre-boarding week 1');

  // ── Fri 5 Mar 14:30: finalise Kabir
  await advanceTo(T('2027-03-05', '14:30'));
  section('2 · Finalised: login mail; no sign-in for 2 days → the login reminder');
  await offersSvc.finaliseOffer(HR, A);
  const passA = passwordIn(lastMailTo(KABIR)!.html);
  expectMail('Kabir’s login', ['login>kabir']);
  await expectPushes('the manager’s set-up to-do for Kabir', ['lifecycle_joiner_setup>mgr']);
  card = await onCard(A);
  ok('board: Documents (finalised, waiting for sign-in)', card?.column === 'documents', card);
  // Chetan signed in Tue 16:00 and went quiet: his nudge is due Fri 16:00.
  await advanceTo(T('2027-03-05', '16:30'));
  expectMail('Chetan: three quiet days after signing in, one nudge', ['quiet>chetan']);
  await advanceTo(T('2027-03-06', '10:30'));
  expectMail('Bina: three quiet days after her sign-in on the holiday, one nudge', ['quiet>bina']);
  await advanceTo(T('2027-03-07', '14:10'));
  expectMail('Sun 14:00 (47.5 hours): no login reminder yet', []);
  await advanceTo(T('2027-03-07', '15:10'));
  expectMail('Sun 15:00, two days after the login went out: the reminder, once', ['login_reminder>kabir']);
  ok('the reminder names the login email', lastMailTo(KABIR)!.html.includes(KABIR));
  await advanceTo(T('2027-03-08', '10:30'));
  expectMail('…and never again', []);

  // ── Mon 8 Mar 10:30: Kabir signs in
  section('3 · Signed in; quiet for 3 days → the nudge and the Quiet flag');
  const signedA = await auth.signIn(KABIR, passA, '6.6.6.6');
  const tokA = 'token' in signedA ? signedA.token : '';
  ok('signed in: status active', (await journey(A)).status === 'active');
  let home = await portalHome(A);
  eq('portal home: tasks open; path Offer done, Docs current, Sign and Day 1 locked', [home.view, pathOf(home)], ['tasks_open', ['offer:done', 'docs:current', 'about:todo', 'meet:todo', 'letter:locked', 'pass:locked']]);
  eq('portal home: 14 days to go, a seed', [home.daysToGo, home.plant.stage], [14, 0]);
  ok('the portal token opens the journey', (await auth.journeyForPortalToken(`Bearer ${tokA}`)).id === A);
  // Tue 9: the manager sets the joiner up (people to meet, welcome note, probation goals).
  await advanceTo(T('2027-03-09', '11:00'));
  await app.saveSetup(MGR, A, { people: [{ userId: 'esha', why: 'Runs the design system' }, { userId: 'tom' }], welcomeNote: { kind: 'text', text: 'We loved your portfolio.' }, goals: ['Ship the onboarding revamp'] });
  eq('manager set-up and probation goals done', [(await task(A, 'manager_setup')).status, (await task(A, 'probation_goals')).status], ['done', 'done']);
  const pre = (await app.joinersForManager(MGR)).joiners.find((x) => x.journeyId === A);
  eq('the manager’s New joiners shows Kabir before joining (pre-boarding, In 13 days)', [pre?.preboarding, pre?.dayLabel], [true, 'In 13 days']);
  // Wed 10: Chetan is not joining.
  await advanceTo(T('2027-03-10', '11:00'));
  section('9 · Chetan accepted, then is not joining');
  await offersSvc.markNotJoining(HR, C, 'Took another offer');
  const cTasks = await journeyTasks().find({ journeyId: C }).toArray();
  ok('every open task cancelled, the done ones stay done', cTasks.every((t) => ['done', 'skipped', 'cancelled'].includes(t.status)) && cTasks.some((t) => t.status === 'cancelled') && cTasks.find((t) => t.systemKey === 'accept_offer')?.status === 'done');
  const cHome = await portalHome(C);
  eq('portal: the closed screen, not joining', [cHome.view, cHome.closedState], ['closed', 'not_joining']);
  eq('the offer link says not joining', (await offersSvc.openOfferLink(tokenC, '1.1.1.1')).state, 'not_joining');
  eq('sign-in on the closed portal: no session, the closed screen', (await auth.signIn(CHETAN, passC, '4.4.4.4') as { closed?: { state?: string } }).closed?.state, 'not_joining');
  ok('off the board', !(await onCard(C)));
  await expectPushes('the manager is told, once', ['lifecycle_not_joining>mgr']);
  await advanceTo(T('2027-03-11', '09:30'));
  card = await onCard(A);
  ok('Thu 11 Mar: board shows Quiet, 3 days', card?.flags.includes('quiet') && card.quietDays === 3, card);
  expectMail('…the nudge waits for 72 hours (10:30)', []);
  await advanceTo(T('2027-03-11', '11:05'));
  expectMail('Thu 11:00: the quiet nudge, once', ['quiet>kabir']);
  ok('the nudge names Up next', lastMailTo(KABIR)!.html.includes('Upload your documents'));

  // ── Thu 11 Mar 12:00: Bina's offer is revised (salary and a later joining day)
  section('5 · A revised offer for Bina: the old link replaced, open dates move, done ones do not');
  const bDoneBefore = await doneDates(B);
  const bOpenBefore = await openDue(B);
  await advanceTo(T('2027-03-11', '12:00'));
  const revised = await offersSvc.reviseOffer(HR, B, { ctc: 1_450_000, tj: TJ_B, validTill: '2027-03-18' });
  eq('v2 with the changed fields', [revised.version, revised.changedFields], [2, ['ctc', 'tj', 'validTill']]);
  // A revision is HR's draft until sent: the candidate's link and the journey only change on send.
  eq('saved, not sent: the old link still works', (await offersSvc.openOfferLink(tokenB1, '1.1.1.1')).state, 'finalised');
  await offersSvc.uploadOfferPdf(HR, B, { buffer: PDF('Bina v2') });
  await offersSvc.sendOffer(HR, B, {});
  const tokenB2 = tokenIn(lastMailTo(BINA)!.html);
  expectMail('the revised offer goes to Bina', ['offer>bina']);
  eq('the old link says replaced', (await offersSvc.openOfferLink(tokenB1, '1.1.1.1')).state, 'replaced');
  eq('the journey stays where Bina had got to (active, no second finalise), Tj moved', [(await journey(B)).status, (await journey(B)).tj], ['active', TJ_B]);
  await doneTasksStayed('Bina’s Tj moved a week', B, bDoneBefore, ['send_offer', 'accept_offer', 'finalise_offer']);
  const bOpenAfter = await openDue(B);
  eq('open Tj tasks moved a week (documents, mark joined)', [bOpenAfter.get('upload_documents'), bOpenAfter.get('mark_joined')], [rules.addDaysKey(bOpenBefore.get('upload_documents')!, 7), TJ_B]);
  eq('the laptop request (done) kept its date', dayOf((await task(B, 'device_request')).dueAt), '2027-03-17');
  home = await portalHome(B);
  eq('Bina’s portal: offer updated, the banner names salary and joining date', [home.view, home.banner?.changedFields, home.upNext?.title], ['offer_updated', ['ctc', 'tj', 'validTill'], 'Read your updated offer']);
  ok('the new link opens v2; the old one cannot accept', (await offersSvc.openOfferLink(tokenB2, '1.1.1.1')).version === 2 && (await refusal(() => offersSvc.acceptOffer(tokenB1, { ip: '1.1.1.1' }))).status === 409);
  await advanceTo(T('2027-03-11', '15:00'));
  eq('accepting v2: already finalised (the login exists)', (await offersSvc.acceptOfferForJourney(await journey(B), { ip: '203.0.113.10' })).state, 'finalised');
  eq('still active, nothing for HR to finalise, no second login', [(await journey(B)).status, (await refusal(() => offersSvc.finaliseOffer(HR, B))).status], ['active', 409]);
  expectMail('HR told of the v2 acceptance; no new login', ['revision_accepted>hr']);
  await expectPushes('the revision and the re-acceptance push nothing else (due-date pushes counted apart)', []);
  const dueChangedB = allPushes.filter((p) => p.scenario === 'lifecycle_due_changed' && p.data.journeyId === B);
  eq('the manager was told once that Bina’s dates moved', dueChangedB.map((p) => nameOf(p.userId)), ['mgr']);

  // ── Fri 12 Mar: Kabir uploads; one document sent back
  await advanceTo(T('2027-03-12', '11:00'));
  section('4 · Documents: uploaded, one sent back and re-uploaded, all approved; the letters unlock');
  let jA = await journey(A);
  const docs = await portalSvc.portalDocuments(jA);
  const required = docs.filter((d) => d.required);
  eq('the template’s three required documents', required.map((d) => d.docKey), ['id_proof', 'address_proof', 'education']);
  for (const d of required) await docsSvc.uploadDocumentFiles(jA, d.id, [{ originalname: `${d.docKey}.jpg`, buffer: JPG }]);
  eq('uploaded: in review, HR’s review open', [(await task(A, 'upload_documents')).status, (await task(A, 'review_documents')).status], ['in_review', 'todo']);
  card = await onCard(A);
  ok('the Quiet flag goes once they are active again', !card?.flags.includes('quiet'), card?.flags);
  await advanceTo(T('2027-03-12', '14:00'));
  const idDoc = required.find((d) => d.docKey === 'id_proof')!;
  for (const d of required.filter((x) => x.id !== idDoc.id)) await docsSvc.reviewDocument(HRO, d.id, { decision: 'approve' });
  await docsSvc.reviewDocument(HRO, idDoc.id, { decision: 'send_back', note: 'The Aadhaar is cut off. Both sides, please.' });
  expectMail('sent back: Kabir is emailed', ['sent_back>kabir']);
  home = await portalHome(A);
  eq('portal Up next: re-upload the ID proof', home.upNext?.title, 'Re-upload your ID proof (PAN and Aadhaar)');
  eq('the upload task is sent back', (await task(A, 'upload_documents')).status, 'sent_back');
  eq('letters still locked', (await lettersSvc.portalLetters(await journey(A))).map((l) => l.state), ['locked', 'locked']);
  await advanceTo(T('2027-03-15', '08:30'));
  expectMail('Sat and Sun: no quiet nudge for Kabir (activity Fri 11:00); Bina’s second quiet stretch (since accepting v2 Thu 15:00) nudges once', ['quiet>bina']);
  // Mon 15 Mar = Tj − 7: the Day-1 pass at 09:00.
  await advanceTo(T('2027-03-15', '09:30'));
  section('5 · Tj − 7: the Day-1 pass unlocks and its email goes out');
  expectMail('Tj − 7 for Kabir; Tj − 7 for nobody else (Bina’s is Mon 22)', ['day1_pass>kabir']);
  eq('the Day-1 pass task is done (automatic)', (await task(A, 'day1_pass')).status, 'done');
  const pass = await portalSvc.portalPass(await journey(A));
  eq('the pass: the day, the place, the manager', [pass.date, pass.place, pass.managerName], [TJ, 'Floor 4, Timeline Towers', 'Neha Rao']);
  eq('Bina’s pass is still locked (her Tj − 7 is Mon 22)', (await refusal(async () => portalSvc.portalPass(await journey(B)))).status, 403);
  await advanceTo(T('2027-03-15', '10:15'));
  jA = await journey(A);
  await docsSvc.uploadDocumentFiles(jA, idDoc.id, [{ originalname: 'aadhaar-both.pdf', buffer: PDF('id') }]);
  await advanceTo(T('2027-03-15', '11:00'));
  await docsSvc.reviewDocument(HRO, idDoc.id, { decision: 'approve' });
  jA = await journey(A);
  eq('the last approval: docs approved, documents and review done, letters to sign open', [jA.status, (await task(A, 'upload_documents')).status, (await task(A, 'review_documents')).status, (await task(A, 'sign_letters')).status], ['docs_approved', 'done', 'done', 'todo']);
  card = await onCard(A);
  eq('board: Letters to sign', card?.column, 'letters');
  const letterRows = await lettersCol().find({ journeyId: A }).toArray();
  eq('appointment letter and NDA drafted', letterRows.map((l) => l.kind).sort(), ['appointment', 'nda']);
  await advanceTo(T('2027-03-15', '12:00'));
  for (const l of letterRows) await lettersSvc.uploadLetterPdf({ org: ORG }, l.id, { originalname: `${l.kind}.pdf`, buffer: PDF(l.kind) });
  expectMail('both PDFs in: “letters ready”, once', ['letters_ready>kabir']);
  home = await portalHome(A);
  eq('portal home: letter ready; Up next is About you (due Tj − 3, before the letters’ Tj − 2); Sign and Day 1 open', [home.view, home.upNext?.key, home.path.find((p) => p.key === 'letter')?.state, home.path.find((p) => p.key === 'pass')?.state], ['letter_ready', 'about', 'todo', 'todo']);
  // Tue 16 and Wed 17: About you and Meet us (activity).
  await advanceTo(T('2027-03-16', '10:30'));
  await portalSvc.saveAboutYou(await journey(A), { emergencyContact: { name: 'Asha Mehta', relation: 'Parent', phone: '+91 91234 56789' }, pf: { firstJob: true } });
  eq('About you done', (await task(A, 'about_you')).status, 'done');
  await advanceTo(T('2027-03-17', '10:30'));
  section('5 · Tj − 5: Joining risk only where documents are missing');
  card = await onCard(A);
  ok('Kabir (all approved): no Joining risk', !card?.flags.includes('joining_risk'), card?.flags);
  for (const item of await portalSvc.meetItems(await journey(A))) await portalSvc.markMeetSeen(await journey(A), item.id);
  eq('Meet us done', (await task(A, 'meet_us')).status, 'done');
  let cardB = await onCard(B);
  ok('Bina (Tj 29 Mar, nothing uploaded): no Joining risk yet at Tj − 12', !cardB?.flags.includes('joining_risk'), cardB?.flags);
  await advanceTo(T('2027-03-18', '10:30'));
  jA = await journey(A);
  const [apptA, ndaA] = await lettersSvc.portalLetters(jA);
  await lettersSvc.openLetter(jA, apptA.id);
  await advanceTo(T('2027-03-18', '23:59'));
  expectMail('Thu 18 (Tj − 4): no letter nudge yet', []);
  await advanceTo(T('2027-03-19', '09:30'));
  section('4 · Letters: a nudge a day from Tj − 3 while unsigned, then none');
  expectMail('Fri 19 (Tj − 3): nudge 1', ['letter_nudge>kabir']);
  await advanceTo(T('2027-03-20', '09:30'));
  expectMail('Sat 20 (Tj − 2): nudge 2', ['letter_nudge>kabir']);
  await advanceTo(T('2027-03-20', '15:00'));
  jA = await journey(A);
  await lettersSvc.signLetter(jA, apptA.id, { method: 'type', typedName: 'Kabir Mehta' }, { ip: '6.6.6.6', userAgent: 'Timeline phone' });
  await lettersSvc.openLetter(await journey(A), ndaA.id);
  await lettersSvc.signLetter(await journey(A), ndaA.id, { method: 'type', typedName: 'Kabir Mehta' }, { ip: '6.6.6.6', userAgent: 'Timeline phone' });
  eq('both signed: the sign task done', (await task(A, 'sign_letters')).status, 'done');
  let pdfLib = true;
  try { require.resolve('pdf-lib'); } catch { pdfLib = false; }
  const signedRows = await lettersCol().find({ journeyId: A }).toArray();
  ok(pdfLib ? 'both signed PDFs stored (stamped with pdf-lib)' : 'signatures kept with the original PDFs (no pdf-lib here)', signedRows.every((l) => !!l.signature && (pdfLib ? !!l.signedPdfFileId : !l.signedPdfFileId)), signedRows.map((l) => [l.kind, !!l.signedPdfFileId]));
  card = await onCard(A);
  eq('board: Ready to join, "In 2 days"', [card?.column, card?.dayLabel], ['ready_to_join', 'In 2 days']);
  home = await portalHome(A);
  eq('portal: pass unlocked; Offer, Docs, About, Team, Sign done', [home.view, pathOf(home).slice(0, 5)], ['pass_unlocked', ['offer:done', 'docs:done', 'about:done', 'meet:done', 'letter:done']]);
  await advanceTo(T('2027-03-21', '23:30'));
  expectMail('Sun 21 (Tj − 1): signed, no more nudges', []);
  noProductErrors('pre-boarding');

  // Bina's joining risk: Tj − 5 is Wed 24 Mar. Her Tj − 7 (Mon 22) sends her pass mail.
  // ── Mon 22 Mar = Tj for Kabir
  await advanceTo(T('2027-03-22', '09:15'));
  section('6 · Tj: Mark joined; the tile, a sprout, the manager’s New joiners');
  expectMail('Mon 22 09:00: Bina’s Day-1 pass mail (her Tj − 7)', ['day1_pass>bina']);
  card = await onCard(A);
  eq('board before Mark joined: still Ready to join, Day 1', [card?.column, card?.dayLabel], ['ready_to_join', 'Day 1']);
  ok('Mark joined is open and due today for HR (Needs you)', (await task(A, 'mark_joined')).status === 'todo' && card?.flags.includes('needs_you'), card?.flags);
  const joinedA = await offersSvc.markJoined(HR, A, { workEmail: 'kabir@el-timeline.test', employeeId: 'ELT-101' });
  const KAB = joinedA.userId;
  who.set(KAB, 'kabir');
  const KME = { userId: KAB, name: 'Kabir Mehta', org: ORG };
  const kUser = await users().findOne({ userId: KAB });
  ok('the employee record: work email, Tj, the manager, the personal email kept', kUser?.email === 'kabir@el-timeline.test' && rules.keyOfDay(kUser.joiningDate!) === TJ && kUser.managerUserId === 'mgr' && kUser.personalEmail === KABIR, kUser);
  let me = await app.lifecycleMe(KME) as { enabled: boolean; onboarding?: { tileVisible: boolean; plant: { stage: number }; dayLabel: string; stage: string } };
  eq('/lifecycle/me: the tile shows, Day 1, a sprout, Welcome', [me.enabled, me.onboarding?.tileVisible, me.onboarding?.dayLabel, me.onboarding?.plant.stage, me.onboarding?.stage], [true, true, 'Day 1', 1, 'welcome_week1']);
  const mj = await app.joinersForManager(MGR);
  ok('the manager’s Team › New joiners shows Kabir (joined)', mj.joiners.some((x) => x.journeyId === A && x.name === 'Kabir Mehta' && !x.preboarding && x.dayLabel === 'Day 1'), mj.joiners);
  card = await onCard(A);
  eq('board: First week › Day 1', [card?.tab, card?.column], ['first_week', 'day1']);
  home = await portalHome(A);
  eq('portal: the joined view with the work email', [home.view, home.workEmail, home.upNext?.key], ['joined', 'kabir@el-timeline.test', 'app']);
  let aHome = await app.onboardingHome(KME);
  ok('app home: Up next is a must-do of Day 1; the meetings are there', !!aHome.upNext && aHome.upNext.mustDo && aHome.meetings.length === 2, { upNext: aHome.upNext?.title, meetings: aHome.meetings.length });
  await app.managerProbationMonth(MGR, A, 1, { goals: ['Learn the design system', 'Ship one screen'] });
  eq('month-1 goals set on Day 1', (await task(A, 'monthly_goals', 1)).status, 'done');
  await expectPushes('nothing pushed before the next tick', []);
  await advanceTo(T('2027-03-22', '10:05'));
  await expectPushes('10:00 tick: the welcome to Kabir, “joins today” to the manager', ['lifecycle_welcome>kabir', 'lifecycle_joiner_today>mgr']);
  await advanceTo(T('2027-03-22', '11:05'));
  await expectPushes('11:00: 30 minutes before “Meet your manager”, both told once', ['lifecycle_meeting_soon>kabir', 'lifecycle_meeting_soon>mgr']);
  await advanceTo(T('2027-03-22', '12:00'));
  const meetMgr = aHome.meetings.find((m) => m.title === 'Meet your manager')!;
  await app.actOnMeeting(KME, meetMgr.id, { met: 'yes' });
  eq('“Did you meet?” yes: meet your manager done', (await task(A, 'meet_manager')).status, 'done');
  await advanceTo(T('2027-03-22', '14:05'));
  await expectPushes('14:00: the team meeting reminder, both once', ['lifecycle_meeting_soon>kabir', 'lifecycle_meeting_soon>mgr']);
  await advanceTo(T('2027-03-22', '15:30'));
  await app.managerTaskDone(MGR, A, (await task(A, 'meet_team')).id, { action: 'done' });
  for (const key of ['welcome_induction', 'vision_culture', 'laptop_setup']) await board.actOnTaskByHr(ORG, A, (await task(A, key)).id, { action: 'done' }, HRME);
  await advanceTo(T('2027-03-22', '23:30'));
  await expectPushes('the rest of Day 1: nothing more', []);
  eq('Day 1 overdue: none (everything due today was done)', await newOverdue(A), []);

  // Tue 23: the tour; register face left undone.
  await advanceTo(T('2027-03-23', '10:30'));
  await app.actOnOwnTask(KME, (await task(A, 'app_tour')).id, { action: 'done' });
  cardB = await onCard(B);
  ok('Tue 23 Mar (Bina’s Tj − 6): no Joining risk yet', !cardB?.flags.includes('joining_risk'), cardB?.flags);
  await advanceTo(T('2027-03-24', '09:30'));
  section('Bina: Tj − 5 with no documents → Joining risk');
  cardB = await onCard(B);
  ok('Wed 24 Mar (Bina’s Tj − 5): Joining risk', cardB?.flags.includes('joining_risk'), cardB?.flags);
  eq('Kabir: register face (due Tj + 1) overdue, pushed once', await newOverdue(A), ['Register face for punch-in>kabir']);
  // Thu 25 = Tj + 3: the intro nudge.
  await advanceTo(T('2027-03-25', '09:30'));
  section('7 · Tj + 3: the intro-post nudge');
  await expectPushes('Tj + 3 09:00: nudge to post the intro', ['lifecycle_intro_nudge>kabir']);
  await advanceTo(T('2027-03-25', '15:00'));
  await app.saveIntro(KME, { line: 'Designer who sketches on trains', funFacts: ['Chai over coffee'] });
  await app.postIntro(KME);
  await expectPushes('the intro is up: the manager is asked to say hi', ['lifecycle_intro_post>mgr']);
  // Sat 27 = Tj + 5.
  await advanceTo(T('2027-03-27', '09:30'));
  section('7 · Tj + 5: week-1 tasks due; Needs attention for what is undone');
  await expectPushes('Tj + 5: “your week-1 tasks are due today”', ['lifecycle_week1_due>kabir']);
  card = await onCard(A);
  ok('board: Week-1 tasks, Needs attention and Late', card?.column === 'week1_tasks' && card.flags.includes('needs_attention') && card.flags.includes('late'), card);
  me = await app.lifecycleMe(KME) as typeof me;
  eq('/lifecycle/me: Week 1, still a sprout', [me.onboarding?.dayLabel, me.onboarding?.plant.stage], ['Week 1', 1]);
  // Sun 28 = Tj + 6.
  await advanceTo(T('2027-03-28', '09:30'));
  section('7 · Tj + 6: the Day-7 survey opens');
  await expectPushes('Tj + 6: the survey opens', ['lifecycle_survey_open>kabir']);
  eq('week-1 tasks (due Tj + 5) overdue, pushed once', await newOverdue(A), ['Week-1 tasks>kabir']);
  card = await onCard(A);
  eq('board: Day-7 survey', card?.column, 'day7_survey');
  ok('the survey is open in the app', (await app.surveyView(KME)).open);
  await advanceTo(T('2027-03-28', '10:30'));
  await app.saveWeek1Step(KME, { step: 'policies', value: { agreed: true } });
  await app.saveWeek1Step(KME, { step: 'tax', value: 'new' });
  await app.saveWeek1Step(KME, { step: 'bank_pf', value: { confirm: true } });
  await app.saveWeek1Step(KME, { step: 'goals', value: { read: true } });
  eq('the four reels: week-1 tasks done', (await task(A, 'week1_reels')).status, 'done');
  await advanceTo(T('2027-03-28', '16:00'));
  await app.sendSurvey(KME, { answers: { q1: 4, q2: 'mostly', q3: 5, q4: 'More time with the team' } });
  card = await onCard(A);
  ok('board: every week-1 task done on Tj + 6: All set, still Day-7 survey (Week done is Tj + 7, the day the app shows it)', card?.column === 'day7_survey' && card.flags.includes('all_set'), card);
  await advanceTo(T('2027-03-29', '08:30'));
  await expectPushes('nothing overnight', []);

  // ── Mon 29 Mar = Tj + 7 for Kabir, Tj for Bina
  await advanceTo(T('2027-03-29', '09:15'));
  section('7 · Tj + 7: goals lock, Week 1 done, a seedling, the portal closes into the app');
  jA = await journey(A);
  ok('goals locked; status moved to app', !!jA.probation?.goalsLockedAt && jA.status === 'moved_to_app', { goals: jA.probation?.goalsLockedAt, status: jA.status });
  eq('Week 1 done (automatic)', (await task(A, 'week1_done')).status, 'done');
  me = await app.lifecycleMe(KME) as typeof me;
  eq('/lifecycle/me: Week 2, a seedling, Settling in', [me.onboarding?.dayLabel, me.onboarding?.plant.stage, me.onboarding?.stage], ['Week 2', 2, 'settling_in']);
  card = await onCard(A);
  eq('board: Week done on Tj + 7, the same day as the app (Probation › Month 1 from the next day)', [card?.tab, card?.column, card?.flags.includes('done')], ['first_week', 'week_done', true]);
  home = await portalHome(A);
  eq('portal: closed, moved to the app', [home.view, home.closedState], ['closed', 'moved_to_app']);
  eq('portal sign-in now: no session, the closed screen', (await auth.signIn(KABIR, passA, '6.6.6.6') as { closed?: { state?: string } }).closed?.state, 'moved_to_app');
  eq('goals can no longer change', (await refusal(() => app.saveSetup(MGR, A, { goals: ['Late'] }))).status, 409);
  aHome = await app.onboardingHome(KME);
  ok('app home: the Week 1 done moment shows', aHome.showWeekDone);
  await expectPushes('Tj + 7: no push to the manager (no onboarding to-dos in their app since 24 Nov)', []);
  // Bina joins today.
  section('8b · Bina joins (Tj 29 Mar)');
  cardB = await onCard(B);
  ok('Bina before joining: Joining risk still (documents missing)', cardB?.flags.includes('joining_risk'), cardB?.flags);
  const joinedB = await offersSvc.markJoined(HR, B, { workEmail: 'bina@el-timeline.test', employeeId: 'ELT-102' });
  const BIN = joinedB.userId;
  who.set(BIN, 'bina');
  const BME = { userId: BIN, name: 'Bina Bose', org: ORG };
  eq('Bina: tile, sprout, Day 1', [((await app.lifecycleMe(BME)) as typeof me).onboarding?.tileVisible, ((await app.lifecycleMe(BME)) as typeof me).onboarding?.plant.stage], [true, 1]);
  await app.managerProbationMonth(MGR, B, 1, { goals: ['Learn the product'] });
  await advanceTo(T('2027-03-29', '10:05'));
  await expectPushes('Bina’s welcome and the manager’s “joins today”', ['lifecycle_welcome>bina', 'lifecycle_joiner_today>mgr']);
  noProductErrors('first week');

  // ── Probation, month by month (Kabir: M1 22 Mar–21 Apr, M2 22 Apr–21 May, M3 22 May–21 Jun)
  section('8 · Probation month 1');
  await advanceTo(T('2027-04-01', '10:30'), 'sparse');
  for (const p of (await app.peopleView(KME)).people) await app.actOnPerson(KME, p.id, { action: 'met' });
  eq('people to meet done', (await task(A, 'people_to_meet')).status, 'done');
  await advanceTo(T('2027-04-15', '09:30'), 'sparse');
  section('8 · Month-end check-in reminders to both sides');
  const p1 = (await newPushes());
  ok('Thu 15 Apr (M1 end − 6): the check-in reminder to Kabir only, once', p1.filter((x) => x.startsWith('lifecycle_checkin_reminder')).join() === ['lifecycle_checkin_reminder>kabir'].join(), p1);
  eq('…and no goals reminder for month 1 (set on Day 1)', p1.filter((x) => x.startsWith('lifecycle_goals_reminder')), []);
  ok('the month-1 check-in is open', (await task(A, 'monthly_checkin', 1)).status === 'todo');
  await advanceTo(T('2027-04-16', '11:00'), 'sparse');
  await app.checkinForMe(KME, 1, { text: 'A good first month', rating: 3 });
  await app.managerProbationMonth(MGR, A, 1, { checkin: { text: 'Settling in well', rating: 4 } });
  await app.managerProbationMonth(MGR, A, 1, { review: { text: 'Strong start', nextGoals: ['Own the leave flow'] } });
  eq('check-in and review saved; month-2 goals set from the review', [(await task(A, 'monthly_checkin', 1)).status, (await task(A, 'monthly_review', 1)).status, (await task(A, 'monthly_goals', 2)).status], ['done', 'done', 'done']);
  await expectPushes('the check-in reaches the manager; the review reaches Kabir', ['lifecycle_checkin_sent>mgr', 'lifecycle_monthly_review>kabir']);
  me = await app.lifecycleMe(KME) as typeof me;
  await advanceTo(T('2027-04-22', '10:00'), 'sparse');
  section('8 · Month 2 (goals from the month-1 review: no reminder)');
  me = await app.lifecycleMe(KME) as typeof me;
  eq('/lifecycle/me: Month 2, a sapling, Growing gains', [me.onboarding?.dayLabel, me.onboarding?.plant.stage, me.onboarding?.stage], ['Month 2', 3, 'growing_gains']);
  card = await onCard(A);
  eq('board: Months 2–5', card?.column, 'months_2_5');
  const p2 = await newPushes();
  eq('Thu 22 Apr: no goals reminder to the manager for Kabir’s month 2', p2.filter((x) => x.startsWith('lifecycle_goals_reminder') || x.startsWith('lifecycle_checkin_reminder')), ['lifecycle_checkin_reminder>bina']);
  await advanceTo(T('2027-05-15', '09:30'), 'sparse');
  const p3 = await newPushes();
  ok('Sat 15 May: Kabir’s month-2 check-in reminder to him (not the manager)', p3.includes('lifecycle_checkin_reminder>kabir') && !p3.includes('lifecycle_checkin_reminder>mgr'), p3);
  await advanceTo(T('2027-05-17', '11:00'), 'sparse');
  await app.checkinForMe(KME, 2, { text: 'Shipped the leave flow', rating: 4 });
  await app.managerProbationMonth(MGR, A, 2, { checkin: { text: 'Great month', rating: 4 } });
  await app.managerProbationMonth(MGR, A, 2, { review: { text: 'Keep going' } });
  await advanceTo(T('2027-05-22', '09:30'), 'sparse');
  section('8 · Month 3 = the final month: goals reminder, the M3 pulse, the decision window');
  const p4 = await newPushes();
  for (const x of ['lifecycle_survey_open>kabir', 'lifecycle_confirmation_window>mgr']) ok(`Sat 22 May: ${x}`, p4.includes(x), p4);
  eq('…each once', [p4.filter((x) => x === 'lifecycle_survey_open>kabir').length, p4.filter((x) => x === 'lifecycle_confirmation_window>mgr').length], [1, 1]);
  card = await onCard(A);
  ok('board: Final month, Decide', card?.column === 'final_month' && card.flags.includes('decide'), card);
  me = await app.lifecycleMe(KME) as typeof me;
  eq('/lifecycle/me: a bud, Final month', [me.onboarding?.plant.stage, me.onboarding?.stage], [4, 'final_month']);
  const sv = await app.surveyView(KME);
  eq('the M3 pulse survey is open', [sv.kind, sv.open], ['m3', true]);
  await app.sendSurvey(KME, { answers: { q1: 5, q2: 'yes', q3: 5 } });
  // Bina's M3 (29 May–28 Jun) is her final month.
  await advanceTo(T('2027-05-29', '09:30'), 'sparse');
  const pb = await newPushes();
  ok('Sat 29 May: Bina’s decision window opens for the manager, her M3 pulse opens', pb.includes('lifecycle_confirmation_window>mgr') && pb.includes('lifecycle_survey_open>bina'), pb);
  await advanceTo(T('2027-06-01', '10:30'), 'sparse');
  section('8 · HR confirms Kabir: the letter, the reveal, a bloom');
  const before = await doneDates(A);
  const conf = await probation.recordDecision(A, HRME, { outcome: 'confirm', salary: 1_600_000, designation: 'Senior Product Designer', reportingToUserId: 'mgr' });
  eq('confirmed', [conf.outcome, (await journey(A)).status], ['confirm', 'confirmed']);
  card = await onCard(A);
  ok('board: Confirmed', card?.column === 'confirmed' && card.flags.includes('confirmed'), card);
  me = await app.lifecycleMe(KME) as typeof me;
  eq('/lifecycle/me: a bloom', me.onboarding?.plant.stage, 5);
  eq('no reveal before the letter', (await app.revealForMe(KME)).ready, false);
  // The letter task is done by a sent letter, not a tick alone: refused first, then the letter goes out (as from Documents).
  const letterTaskId = (await task(A, 'confirmation_letter')).id;
  eq('the letter task cannot be ticked with no letter sent', (await refusal(() => board.actOnTaskByHr(ORG, A, letterTaskId, { action: 'done' }, HRME))).status, 409);
  await db.getDb().collection('lifecycle_letters').insertOne({ id: 'L-kabir-confirm', org: ORG, journeyId: A, kind: 'confirmation', templateId: 't', refNo: 'CL-1', values: {}, createdAt: new Date(), email: { to: 'kabir@example.com', subject: 'Confirmed', body: 'x', sentAt: new Date() } });
  await board.actOnTaskByHr(ORG, A, (await task(A, 'confirmation_letter')).id, { action: 'done', note: 'Letter sent' }, HRME);
  await advanceTo(T('2027-06-01', '11:05'), 'sparse');
  await advanceTo(T('2027-06-01', '13:05'), 'sparse');
  const p5 = await newPushes();
  eq('the decision to the manager; the reveal to Kabir once', p5.filter((x) => /decision|reveal/.test(x)), ['lifecycle_decision>mgr', 'lifecycle_reveal_ready>kabir']);
  const rv = await app.revealForMe(KME) as Record<string, unknown>;
  eq('the reveal: confirmed, the new title and CTC (to them), the manager', [rv.ready, rv.outcome, rv.designation, rv.salary, rv.reportsTo], [true, 'confirm', 'Senior Product Designer', 1_600_000, 'Neha Rao']);
  await app.revealSeenForMe(KME);
  me = await app.lifecycleMe(KME) as typeof me;
  eq('seen: the tile goes', me.onboarding?.tileVisible, false);
  ok('the manager’s list no longer shows Kabir', !(await app.joinersForManager(MGR)).joiners.some((x) => x.journeyId === A));
  await doneTasksStayed('Kabir’s confirmation', A, before, ['confirmation_letter', 'confirmation_reveal']);

  section('8b · Bina: final month, HR extends by 1 month (a new review cycle, a later decision)');
  await advanceTo(T('2027-06-02', '10:30'), 'sparse');
  const bBefore = await doneDates(B);
  const ext = await probation.recordDecision(B, HRME, { outcome: 'extend', extendMonths: 1 });
  let jB = await journey(B);
  eq('extended: 4 months, months_2_5 again', [ext.outcome, engine.totalProbationMonths(jB), (await onCard(B))?.column], ['extend', 4, 'months_2_5']);
  ok('month-4 tasks added (check-in, review, goals, a new decision)', !!(await task(B, 'monthly_checkin', 4)) && !!(await task(B, 'monthly_review', 4)) && (await task(B, 'confirmation_discussion', 4))?.status === 'locked');
  await doneTasksStayed('Bina’s extension', B, bBefore, ['confirmation_letter', 'confirmation_reveal']);
  // The extension letter goes out from Documents; then its task can be marked done.
  await db.getDb().collection('lifecycle_letters').insertOne({ id: 'L-bina-extend', org: ORG, journeyId: B, kind: 'extension', templateId: 't', refNo: 'EL-1', values: {}, createdAt: new Date(), email: { to: 'bina@example.com', subject: 'Extended', body: 'x', sentAt: new Date() } });
  await board.actOnTaskByHr(ORG, B, (await task(B, 'confirmation_letter')).id, { action: 'done', note: 'Extension letter sent' }, HRME);
  await advanceTo(T('2027-06-02', '13:05'), 'sparse');
  const pe = await newPushes();
  eq('the manager is told; Bina’s reveal (extension) once', pe.filter((x) => /decision|reveal/.test(x)), ['lifecycle_decision>mgr', 'lifecycle_reveal_ready>bina']);
  eq('Bina’s reveal says extended by 1 month', [(await app.revealForMe(BME) as Record<string, unknown>).outcome, (await app.revealForMe(BME) as Record<string, unknown>).extendMonths], ['extend', 1]);
  await app.revealSeenForMe(BME);
  ok('Bina’s tile stays (still on probation)', ((await app.lifecycleMe(BME)) as typeof me).onboarding?.tileVisible === true);
  await advanceTo(T('2027-06-29', '09:30'), 'sparse');
  const pf = await newPushes();
  ok('Tue 29 Jun: month 4 is the final month: the decision window again, and the month-4 goals reminder', pf.includes('lifecycle_confirmation_window>mgr') && pf.includes('lifecycle_goals_reminder>mgr'), pf);
  cardB = await onCard(B);
  ok('board: Final month, Decide', cardB?.column === 'final_month' && cardB.flags.includes('decide'), cardB);
  await advanceTo(T('2027-07-01', '10:30'), 'sparse');
  await probation.recordDecision(B, HRME, { outcome: 'confirm' });
  await db.getDb().collection('lifecycle_letters').insertOne({ id: 'L-bina-confirm', org: ORG, journeyId: B, kind: 'confirmation', templateId: 't', refNo: 'CL-2', values: {}, createdAt: new Date(), email: { to: 'bina@example.com', subject: 'Confirmed', body: 'x', sentAt: new Date() } });
  await board.actOnTaskByHr(ORG, B, (await task(B, 'confirmation_letter')).id, { action: 'done' }, HRME);
  await advanceTo(T('2027-07-01', '13:05'), 'sparse');
  const pg = await newPushes();
  eq('confirmed after the extension: the manager told, a second reveal once', pg.filter((x) => /decision|reveal/.test(x)), ['lifecycle_decision>mgr', 'lifecycle_reveal_ready>bina']);
  jB = await journey(B);
  eq('Bina confirmed, a bloom', [jB.status, jB.plant?.stage], ['confirmed', 5]);
  noProductErrors('probation');

  // Overdue pushes on the joiners: each task at most once.
  const overdue = allPushes.filter((p) => p.scenario === 'lifecycle_task_overdue');
  ok('overdue pushes: one per task and owner', new Set(overdue.map((p) => `${p.userId}:${p.data.taskId}`)).size === overdue.length, overdue.length);
  const confirmedAt = T('2027-06-01', '10:30').getTime();
  const afterConfirm = overdue.filter((p) => p.data.journeyId === A && p.at.getTime() > confirmedAt);
  eq('nothing about Kabir’s probation is pushed as overdue after he is confirmed', afterConfirm.map((p) => `${p.title}>${nameOf(p.userId)}`), []);

  // ═════════════════════════════════════════════════════════════ LEAVERS
  await advanceTo(T('2027-07-05', '10:30'), 'sparse');
  await newPushes(); newMail(); productWarnings.length = 0;
  section('Leaver 1 · Ravi resigns (6 years; Wanda reports to him)');
  const appTokenRavi = await appSession('ravi');
  const res1 = await resig.resign('ravi', { reason: 'Better opportunity', note: 'Thank you for six years.' });
  eq('with the manager, the last day by notice (30 days)', [res1.resignation.status, res1.resignation.lastDayByNotice], ['with_manager', '2027-08-04']);
  let oc = await offCard('ravi');
  eq('board: Resignations › With manager', [oc?.tab, oc?.column, oc?.owner], ['resignations', 'with_manager', 'manager']);
  let meR = await app.lifecycleMe({ userId: 'ravi', name: 'Ravi Menon', org: ORG }) as { offboarding?: { status: string; pageVisible: boolean; tl?: string } };
  eq('/lifecycle/me: resignation with the manager, no off-boarding page yet', [meR.offboarding?.status, meR.offboarding?.pageVisible], ['with_manager', false]);
  await expectPushes('the manager is pushed the request', ['lifecycle_resignation>mgr']);
  section('Leaver 2 · Wanda resigns and withdraws before HR accepts');
  await advanceTo(T('2027-07-05', '11:00'));
  await resig.resign('wanda', { reason: 'Personal' });
  await expectPushes('Wanda’s manager (Ravi) is pushed', ['lifecycle_resignation>ravi']);
  await advanceTo(T('2027-07-06', '10:00'));
  await resig.withdrawResignation('wanda');
  await expectPushes('withdrawn: Ravi is told', ['lifecycle_resignation_withdrawn>ravi']);
  ok('a withdrawn resignation is off the board and off /lifecycle/me', !(await offCard('wanda')) && !((await app.lifecycleMe({ userId: 'wanda', name: 'Wanda', org: ORG })) as { offboarding?: unknown }).offboarding);
  const wandaRes = await resignations().findOne({ userId: 'wanda' });
  eq('…and HR cannot accept it', (await refusal(() => resig.acceptResignation('hr', wandaRes!.id, {}))).status, 409);
  section('Leaver 1 · The manager changes the last day; HR accepts with Tl');
  await advanceTo(T('2027-07-06', '11:00'));
  const TL = '2027-08-06'; // Friday
  await resig.managerResignationAction('mgr', res1.resignation.id, { action: 'change_day', date: TL, note: 'Two more days to close the project' });
  oc = await offCard('ravi');
  eq('board: With HR, Needs you, the asked day', [oc?.column, oc?.flag, oc?.owner], ['with_hr', 'needs_you', 'hr']);
  await expectPushes('the manager acting tells nobody (the status updates)', []);
  await advanceTo(T('2027-07-07', '11:00'));
  const acc = await resig.acceptResignation('hr', res1.resignation.id, { lastWorkingDay: TL, newManagerUserId: 'mgr' });
  const OR = acc.journeyId;
  let ravi = await users().findOne({ userId: 'ravi' });
  ok('the live exit is recorded: resigned, Tl, notice from the day sent, the team moves the day after', ravi?.exit?.kind === 'resigned' && ravi.exit.lastWorkingDay === TL && ravi.exit.noticeFrom === '2027-07-05' && ravi.exit.teamMove === 'day_after' && ravi.lifecycleStatus === 'notice', ravi?.exit);
  ok('the offboarding journey is created (accepted, Tl)', (await journey(OR)).status === 'accepted' && (await journey(OR)).tl === TL && ravi?.exit?.offboarding?.journeyId === OR);
  await expectPushes('HR accepted: Ravi (his page), the manager (handover checklist); IT and Finance work from the dashboard (no push)', ['lifecycle_offboarding_open>ravi', 'lifecycle_handover_checklist>mgr']);
  meR = await app.lifecycleMe({ userId: 'ravi', name: 'Ravi Menon', org: ORG }) as typeof meR;
  eq('/lifecycle/me: accepted, the page shows, Tl', [meR.offboarding?.status, meR.offboarding?.pageVisible, meR.offboarding?.tl], ['accepted', true, TL]);
  let page = await off.myOffboarding('ravi');
  eq('the off-boarding page: Tl, 30 days left, interview opens Tl − 5', [page.tl, page.daysLeft, page.interview.opensAt, page.interview.open], [TL, 30, '2027-08-01', false]);
  oc = await offCard('ravi');
  eq('board: Accepted, waiting on the manager’s checklist (due in 3 days)', [oc?.column, oc?.owner, oc?.due], ['accepted', 'manager', '2027-07-10']);
  section('Leaver 1 · Handover: the checklist within 3 days, the uploads');
  await advanceTo(T('2027-07-08', '10:00'));
  await off.setHandoverChecklist('mgr', 'ravi', { items: ['Design system file', 'Open projects'], note: 'Please share by the 25th.' });
  await expectPushes('Ravi is told the checklist is shared', ['lifecycle_handover_shared>ravi']);
  oc = await offCard('ravi');
  eq('board: Notice › Handover, waiting on Ravi', [oc?.tab, oc?.column, oc?.owner], ['notice', 'handover', 'employee']);
  await advanceTo(T('2027-07-12', '11:00'), 'sparse');
  page = await off.myOffboarding('ravi');
  for (const item of page.handover) await off.uploadHandover('ravi', item.id, { url: `https://docs.example/${item.id}` });
  eq('every item uploaded: the upload task done', (await task(OR, 'upload_handover')).status, 'done');
  await expectPushes('the manager is pushed for each upload', ['lifecycle_handover_uploaded>mgr', 'lifecycle_handover_uploaded>mgr']);
  oc = await offCard('ravi');
  eq('board: Clearance', oc?.column, 'clearance');

  section('Leaver 3 · Esha: accepted, then released early (Tl and every open Tl task move)');
  await advanceTo(T('2027-07-12', '12:00'));
  const res3 = await resig.resign('esha', { reason: 'Higher studies' });
  await advanceTo(T('2027-07-13', '11:00'));
  await resig.managerResignationAction('mgr', res3.resignation.id, { action: 'accept' });
  await advanceTo(T('2027-07-14', '11:00'));
  const acc3 = await resig.acceptResignation('hr', res3.resignation.id, {});
  const OE = acc3.journeyId;
  eq('Esha’s Tl: the last day by notice (Wed 11 Aug)', (await journey(OE)).tl, '2027-08-11');
  await advanceTo(T('2027-07-15', '10:00'));
  await off.setHandoverChecklist('mgr', 'esha', { items: ['Research notes'] });
  await newPushes();
  await advanceTo(T('2027-07-19', '10:00'), 'sparse');
  const eDone = await doneDates(OE);
  const eOpen = await openDue(OE);
  const TL_E = '2027-07-30';
  await off.changeLastDay('hr', 'esha', { lastWorkingDay: TL_E });
  const eOpenAfter = await openDue(OE);
  eq('the exit and the journey move to Fri 30 Jul', [(await users().findOne({ userId: 'esha' }))?.exit?.lastWorkingDay, (await journey(OE)).tl], [TL_E, TL_E]);
  eq('every open Tl task moved (handover Tl − 7, finance Tl − 2, return assets Tl, settlement Tl + 2 working days, gratuity Tl + 30)',
    ['upload_handover', 'finance_clearance', 'return_assets', 'final_settlement'].map((k) => eOpenAfter.get(k)),
    ['2027-07-23', '2027-07-28', TL_E, '2027-08-03']);
  ok('…they had the old Tl before', eOpen.get('final_settlement') === '2027-08-13', [eOpen.get('final_settlement')]);
  // Under five completed years, "Gratuity, if eligible" is skipped on its own (it has no open date to move).
  ok('gratuity: skipped, not eligible', !eOpenAfter.has('gratuity') || eOpenAfter.get('gratuity') === null, eOpenAfter.get('gratuity'));
  await doneTasksStayed('Esha’s early release', OE, eDone);
  const opensE = await task(OE, 'exit_interview');
  eq('the exit interview now opens Tl − 5', dayOf(opensE.opensAt), '2027-07-25');
  const pEsha = await newPushes();
  ok('Esha and the manager are told the last day moved, once each', pEsha.filter((x) => x.startsWith('lifecycle_last_day_changed')).join() === ['lifecycle_last_day_changed>esha', 'lifecycle_last_day_changed>mgr'].join(), pEsha);

  section('Leaver 4 · Tarun: an HR-started termination, the app page off');
  await advanceTo(T('2027-07-19', '11:00'));
  await off.startExit('hr', 'tom', { exitType: 'termination', lastWorkingDay: '2027-07-23', noticeHandling: 'paid_in_lieu', hrNote: 'Policy breach' });
  const tom = await users().findOne({ userId: 'tom' });
  ok('termination: recorded, page off, access ended at once (company rule)', tom?.exit?.kind === 'terminated' && tom.exit.offboarding?.showAppPage === false && !!tom.exit.accessEndedAt, tom?.exit);
  const meT = await app.lifecycleMe({ userId: 'tom', name: 'Tarun', org: ORG }) as typeof meR;
  eq('/lifecycle/me: no page', meT.offboarding?.pageVisible, false);
  eq('the off-boarding page is refused', (await refusal(() => off.myOffboarding('tom'))).status, 404);
  await expectPushes('Tarun hears nothing in the app; the manager does (the clearance staff work from the dashboard)', ['lifecycle_handover_checklist>mgr']);
  oc = await offCard('tom');
  eq('board: Exit › Settlement due', [oc?.tab, oc?.column], ['exit', 'settlement_due']);

  section('Leaver 1 · Clearance by team; finance due Tl − 2');
  eq('finance clearance due Tl − 2 (Wed 4 Aug)', dayOf((await task(OR, 'finance_clearance')).dueAt), '2027-08-04');
  await advanceTo(T('2027-07-20', '11:00'));
  await off.setOffboardingClearance('it', 'ravi', { key: 'laptop', done: true });
  await off.setOffboardingClearance('hr', 'ravi', { key: 'id_card', done: true });
  await off.setOffboardingClearance('fin', 'ravi', { key: 'advances', done: true });
  eq('IT, Admin and Finance done', [(await task(OR, 'return_assets')).status, (await task(OR, 'finance_clearance')).status], ['done', 'done']);
  await advanceTo(T('2027-07-29', '23:30'), 'sparse');
  section('Leaver 1 · Tl − 7: the team hears its manager is changing (tellTeamsAhead)');
  await newPushes();
  await advanceTo(T('2027-07-30', '10:30'));
  const pTeam = await newPushes();
  ok('Fri 30 Jul (Tl − 7): Wanda and the new manager are told ahead, once', ['exit_team_heads_up>wanda', 'exit_team_heads_up_manager>mgr'].every((x) => pTeam.filter((y) => y === x).length === 1), pTeam);
  await off.markHandoverDone('mgr', 'ravi');
  oc = await offCard('ravi');
  eq('handover done, clearance clear: Last week, all clear (the interview opens Sun 1 Aug)', [oc?.column, oc?.flag], ['last_week', 'all_clear']);
  await advanceTo(T('2027-07-31', '23:30'));
  await newPushes();
  section('Leaver 1 · Tl − 5: the exit interview opens (one push)');
  await advanceTo(T('2027-08-01', '10:30'));
  await pullPushes();
  const pI = allPushes.filter((p) => p.scenario === 'lifecycle_exit_interview_open' && p.userId === 'ravi');
  eq('Sun 1 Aug: one push to Ravi', pI.length, 1);
  ok('…sent in the day, not at night (from 09:00 IST)', pI.length === 1 && Number(istTime(pI[0].at).slice(0, 2)) >= 9, pI.map((p) => istTime(p.at)));
  oc = await offCard('ravi');
  eq('board: Exit interview, waiting on Ravi', [oc?.column, oc?.owner], ['exit_interview', 'employee']);
  page = await off.myOffboarding('ravi');
  ok('the page: the interview is open', page.interview.open);
  await advanceTo(T('2027-08-02', '11:00'));
  await off.sendExitInterview('ravi', { reason: 'Growth', workingHere: 4, manager: 4, comeBack: 'maybe', change: 'Clearer growth paths' });
  const row = await surveyResponses().findOne({ org: ORG, kind: 'exit' });
  ok('the anonymised row: no userId, no journey, department, tenure 5y+, dated the 1st', !!row && !('userId' in row) && !('journeyId' in row) && row.department === 'Design' && row.tenureBand === '5y+' && row.createdAt.toISOString() === new Date('2027-08-01T00:00:00+05:30').toISOString(), row);
  eq('the interview task done; board All clear', [(await task(OR, 'exit_interview')).status, (await offCard('ravi'))?.column], ['done', 'last_week']);
  ok('exit insights stay hidden under 5 answers', (await insights.exitInsights('hr', { from: '2027-01-01', to: '2027-12-31' })).hidden);
  section('Leaver 1 · Tl: the last day; Tl + 1: access closes');
  await advanceTo(T('2027-08-02', '23:30'));
  ok('Esha (Tl moved to Fri 30 Jul): no settlement-due flag on Mon 2 Aug (Tl + 1 working day)', (await journey(OE)).status !== 'settlement_due', (await journey(OE)).status);
  await advanceTo(T('2027-08-03', '00:30'));
  eq('Esha: the settlement-due flag on Tue 3 Aug (Tl + 2 working days of the moved day)', (await journey(OE)).status, 'settlement_due');
  oc = await offCard('esha');
  eq('Esha’s card: Settlement due, due Tue 3 Aug', [oc?.column, oc?.due], ['settlement_due', '2027-08-03']);
  await advanceTo(T('2027-08-06', '10:30'));
  oc = await offCard('ravi');
  eq('Fri 6 Aug: Exit › Last day today, account closes tonight', [oc?.tab, oc?.column, oc?.nextStep], ['exit', 'last_day', 'Account closes tonight']);
  ok('the app still lets Ravi in on his last day', (await authCall(appTokenRavi)).next);
  await advanceTo(T('2027-08-06', '23:30'));
  ok('still in at 23:30', !(await users().findOne({ userId: 'ravi' }))?.exit?.accessEndedAt);
  await newPushes();
  await advanceTo(T('2027-08-07', '00:30'));
  ravi = await users().findOne({ userId: 'ravi' });
  ok('Sat 7 Aug 00:00 (Tl + 1): access ended by closeDueExits', !!ravi?.exit?.accessEndedAt && istKey(ravi.exit.accessEndedAt) === '2027-08-07', ravi?.exit?.accessEndedAt);
  eq('the app refuses the account now', (await authCall(appTokenRavi)).status, 401);
  eq('the close-account task done', (await task(OR, 'close_account')).status, 'done');
  ok('Wanda now reports to the manager', (await users().findOne({ userId: 'wanda' }))?.managerUserId === 'mgr');
  await expectPushes('the team move is told once (Wanda, the manager)', ['exit_team_moved>wanda', 'exit_team_joined>mgr']);
  ok('handover uploads are closed', (await refusal(() => off.uploadHandover('ravi', page.handover[0].id, { url: 'https://x.example' }))).status === 409);
  section('Leaver 1 · Tl + 2 working days (skipping Mon 9 Aug): settlement due');
  oc = await offCard('ravi');
  eq('board: Settlement due, due Wed 11 Aug (Mon 9 Aug is a holiday), needs you', [oc?.column, oc?.due, oc?.flag], ['settlement_due', '2027-08-11', 'needs_you']);
  const checks = await off.settlementChecks('hr', 'ravi');
  eq('the settlement checks agree on the due day', checks.dueOn, '2027-08-11');
  await advanceTo(T('2027-08-10', '23:30'));
  ok('Tue 10 Aug: the settlement-due flag has not fired', (await journey(OR)).status !== 'settlement_due', (await journey(OR)).status);
  await advanceTo(T('2027-08-11', '09:30'));
  eq('Wed 11 Aug: the settlement-due flag (journey status), once', [(await journey(OR)).status, (await users().findOne({ userId: 'ravi' }))?.exit?.offboarding?.fired?.filter((k) => k === 'settlement_due').length], ['settlement_due', 1]);
  await advanceTo(T('2027-08-11', '11:00'));
  oc = await offCard('ravi');
  ok('due today: Needs you (not late yet)', oc?.flag === 'needs_you' && !oc.late, oc);
  section('Leaver 1 · Settlement emailed: Settlement sent; gratuity at Tl + 30; closed');
  const drafted = await exitSettlements().findOne({ org: ORG, userId: 'ravi' });
  ok('the settlement was drafted the day after the last day (closeDueExits)', drafted?.status === 'draft' && istKey(drafted.createdAt) === '2027-08-07', drafted && { status: drafted.status, at: drafted.createdAt });
  if (!drafted) {
    await exitSettlements().insertOne({ org: ORG, userId: 'ravi', status: 'draft', lines: [{ key: 'gratuity', side: 'earning', label: 'Gratuity', computedPaise: 9_000_00, amountPaise: 9_000_00 }], earningsPaise: 9_000_00, deductionsPaise: 0, payablePaise: 9_000_00, createdAt: new Date(), updatedAt: new Date() } as never);
  }
  await exitSettlements().updateOne({ org: ORG, userId: 'ravi' }, { $set: { status: 'approved', approvedAt: new Date() } });
  newMail();
  const pdfB64 = Buffer.from('%PDF-1.4\n'.padEnd(400, '0')).toString('base64');
  await off.emailSettlement('hr', 'ravi', { pdfBase64: pdfB64, to: 'ravi.menon@example.com', overrideReason: 'No payroll run in the timeline: the final salary is on the statement' });
  expectMail('the settlement PDF to the personal email, once', ['settlement>ravi']);
  oc = await offCard('ravi');
  eq('board: Settlement sent; gratuity to pay (Finance), 6 years', [oc?.column, oc?.owner, oc?.nextStep], ['settlement_sent', 'finance', 'Gratuity to pay']);
  eq('the journey: settlement sent', (await journey(OR)).status, 'settlement_sent');
  await newPushes();
  await advanceTo(T('2027-09-04', '23:30'), 'sparse');
  eq('before Tl + 30: no gratuity push', allPushes.filter((p) => p.scenario === 'lifecycle_gratuity_due').length, 0);
  await advanceTo(T('2027-09-05', '13:30'), 'sparse');
  const pG = await newPushes();
  eq('Sun 5 Sep (Tl + 30): gratuity due shows on the board; no push to the clearance staff', pG.filter((x) => x.startsWith('lifecycle_gratuity_due')), []);
  await advanceTo(T('2027-09-06', '11:00'), 'sparse');
  await off.offboardingTaskDone('fin', 'ravi', 'gratuity', {});
  await off.offboardingTaskDone('hr', 'ravi', 'relieving_letter', {});
  await off.closeOffboarding('hr', 'ravi', {});
  oc = await offCard('ravi');
  eq('closed: the card moves to Closed', [oc?.column, oc?.flag], ['closed', 'closed']);
  await advanceTo(T('2027-09-08', '13:30'), 'sparse');
  eq('a closed exit gets nothing more', (await newPushes()).filter((x) => /ravi|gratuity/.test(x)), []);

  section('Leaver 3 · Esha after the early release');
  const esha = await users().findOne({ userId: 'esha' });
  ok('access closed Sat 31 Jul (Tl + 1 of the moved day)', !!esha?.exit?.accessEndedAt && istKey(esha.exit.accessEndedAt) === '2027-07-31', esha?.exit?.accessEndedAt);
  await pullPushes();
  const ePushes = allPushes.filter((p) => p.scenario === 'lifecycle_exit_interview_open' && p.userId === 'esha');
  ok('her exit interview push came on the moved day (Sun 25 Jul), once', ePushes.length === 1 && istKey(ePushes[0].at) === '2027-07-25', ePushes.map((p) => p.at));
  noProductErrors('offboarding');

  // ═════════════════════════════════════════════════════════════ every message, once
  section('Every push and email fired once');
  await pullPushes();
  drainMail();
  const MAY_REPEAT = new Set(['lifecycle_due_changed', 'lifecycle_handover_uploaded']);
  // A second decision window and a second reveal (Bina's extension) are new events a month apart: those keys carry the day.
  const RECUR = new Set(['lifecycle_confirmation_window', 'lifecycle_reveal_ready']);
  const pushKeys = allPushes.filter((p) => !MAY_REPEAT.has(p.scenario)).map((p) => `${p.userId}|${p.scenario}|${p.title}|${p.body}|${JSON.stringify(p.data)}|${RECUR.has(p.scenario) ? istKey(p.at) : ''}`);
  const dupPushes = pushKeys.filter((k, i) => pushKeys.indexOf(k) !== i);
  ok(`no push sent twice (${allPushes.length} pushes)`, dupPushes.length === 0, dupPushes.slice(0, 5));
  const once = new Set(['offer', 'accepted', 'finalise_reminder', 'login', 'login_reminder', 'letters_ready', 'day1_pass', 'settlement', 'sent_back']);
  const mailKeys = allMail.map((m) => `${m.to}|${m.subject}|${once.has(mailKind(m.subject)) ? '' : istKey(m.at)}|${m.html.length}`);
  const dupMail = mailKeys.filter((k, i) => mailKeys.indexOf(k) !== i);
  ok(`no email sent twice (${allMail.length} emails)`, dupMail.length === 0, dupMail.slice(0, 5));
  const night = allPushes.filter((p) => { const h = Number(istTime(p.at).slice(0, 2)); return (h < 8 || h >= 21) && !/^exit_team|lifecycle_due_changed/.test(p.scenario); });
  eq('no timed push went out at night (21:00–08:00 IST)', night.map((p) => `${p.scenario}>${nameOf(p.userId)} ${istKey(p.at)} ${istTime(p.at)}`), []);
  ok(`M0 slim read matched the full read every day (${listDays} days)`, listDays > 30 && listMismatch === 0, { listDays, listMismatch });
  ok('no product warnings about failed notifications', !productWarnings.some((w) => /could not be sent|failed/i.test(w)), productWarnings.slice(0, 3));

  say(`\n${ticks} scheduler ticks, ${allPushes.length} pushes, ${allMail.length} emails`);
  say(`${passed} passed, ${failed} failed`);
  if (failures.length) say(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  const { rm } = await import('node:fs/promises');
  const path = await import('node:path');
  await rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', ORG), { recursive: true, force: true });
  await db.closeDb();
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  say(String(error?.stack ?? error));
  if (productErrors.length) say(productErrors.slice(0, 5).join('\n'));
  process.exit(1);
});
