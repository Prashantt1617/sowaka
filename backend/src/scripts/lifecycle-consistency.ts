/**
 * One person, one truth: the HR dashboard, the app and the pre-boarding portal
 * show the same data for the same person at every step of the lifecycle, and
 * the template set on the dashboard decides it (tasks, owners, due dates,
 * documents, probation, notice, the exit interview, the account close).
 *
 * At the HTTP level, in-process: the real express app on an ephemeral port,
 * real sessions (an HR admin, a manager, IT staff with only the Offboarding tab,
 * someone with only the Onboarding tab, the joiner and the leavers in the app,
 * the candidate through a portal sign-in), every route called the way its
 * client calls it (hr-admin-web/src/services/lifecycle*.ts,
 * preboarding-web/src/api/portal.ts, mobile-app/lib/features/lifecycle/**). The
 * clock is fake (as lifecycle-timeline.ts) and the scheduler's jobs run on it.
 *
 *   npm run lifecycle:consistency   (MONGODB_DB=el_consistency_scratch; local mongod on 127.0.0.1:27133 only)
 *
 * Sections: 1 · same person, same truth (a joiner from offer to confirmation, a
 * leaver from resignation to closed); 2 · the template is the source of truth;
 * 3 · across processes (People, Exits, payroll hold, the settlement email).
 * The differences that are allowed are listed in ALLOWED below; any other
 * difference between surfaces fails.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// ─── Environment: the local mongod and a scratch database only, no mail, no S3 ──
const LOCAL_URI = 'mongodb://127.0.0.1:27133';
if (process.env.MONGODB_URI && process.env.MONGODB_URI !== LOCAL_URI) {
  console.error(`lifecycle:consistency refuses to run against ${process.env.MONGODB_URI}; it runs on ${LOCAL_URI} only`);
  process.exit(1);
}
process.env.MONGODB_URI = LOCAL_URI;
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_consistency_scratch';
process.env.NOTIFY_ORGS = process.env.NOTIFY_ORGS ?? 'el-consistency';
process.env.EMAIL_ORGS = process.env.EMAIL_ORGS ?? 'el-consistency';
process.env.AWS_S3_BUCKET = '';
process.env.ZOHO_SMTP_USER = '';
process.env.ZOHO_SMTP_PASS = '';
process.env.PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'consistency-secret';
process.env.PORTAL_BASE_URL = 'http://localhost:5181';
process.env.NODE_ENV = 'test';
// Section 5 counts the bytes each command brings back (config/db.ts).
process.env.MONGODB_MONITOR_COMMANDS = '1';

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
const T = (day: string, time = '10:00') => new Date(`${day}T${time}:00+05:30`);
const istKey = (d: Date) => new RealDate(d.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);
const nowLabel = () => `${istKey(new Date())} ${new RealDate(fakeMs + 5.5 * HOUR).toISOString().slice(11, 16)}`;

// ─── Output: the product's logs are quiet; errors are kept and checked ─────
const productErrors: string[] = [];
const say = console.log.bind(console);
console.info = () => {};
console.warn = () => {};
console.error = (...a: unknown[]) => { productErrors.push(a.map(String).join(' ')); };
// The access log (morgan) writes each request to stdout: not here.
const rawWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: (chunk: unknown, ...rest: unknown[]) => boolean }).write = (chunk: unknown, ...rest: unknown[]) => {
  if (typeof chunk === 'string' && /^(GET|POST|PUT|DELETE|PATCH) \/\S* \d{3} /.test(chunk)) return true;
  return rawWrite(chunk as string, ...(rest as []));
};

type Section = 'same_truth' | 'template' | 'across' | 'access';
const counts: Record<Section, { passed: number; failed: number }> = {
  same_truth: { passed: 0, failed: 0 }, template: { passed: 0, failed: 0 }, across: { passed: 0, failed: 0 }, access: { passed: 0, failed: 0 },
};
let current: Section = 'same_truth';
const failures: string[] = [];
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { counts[current].passed += 1; say(`  ok   ${label}`); return true; }
  counts[current].failed += 1;
  const line = `${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 1200)}`}`;
  failures.push(`[${current} ${nowLabel()}] ${line}`);
  say(`  FAIL ${line}`);
  return false;
}
function eq(label: string, got: unknown, want: unknown) { return ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
/** Every value equal; the detail names who said what. */
function agree(label: string, values: Record<string, unknown>) {
  // A surface that does not show the value (not reachable at this step) is left out, never counted as agreeing.
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const first = JSON.stringify(entries[0]?.[1]);
  return ok(label, entries.length > 1 && entries.every(([, v]) => JSON.stringify(v) === first), values);
}
const heading = (title: string) => say(`\n${title}  [${nowLabel()} IST]`);

/**
 * The differences between surfaces that are allowed (the brief's list, then the
 * presentation differences docs/lifecycle/CONTRACT.md settles). The checks below
 * skip exactly these and nothing else.
 */
const ALLOWED = [
  'pay is hidden from managers and from staff without a payroll tab (offer CTC, decision salary, settlement amounts)',
  'unshared 1:1 notes are hidden from the joiner',
  'a manager gets the survey summary only at 3 or more answers',
  'exit interview answers never show outside HR',
  'candidate document files are hidden from the Onboarding-only role (status only)',
  'CONTRACT: the app’s helper is the app copy (APP_COPY), not the template’s HR helper',
  'CONTRACT: the manager’s M2 phrases tasks for them (APP_COPY managerTitle, “Meet {name}”)',
  'CONTRACT: the joiner sees the Day-1 items others do read-only (readOnly, doneBy), and starter tasks / shared notes as rows',
  'CONTRACT: finished pre-boarding steps stay behind on the portal (the app home lists open ones only)',
  'CONTRACT: the joiner’s home also lists rows that live on their own record, not journey tasks (team:<key> meetings on journey.teamTasks, person:<id> people to meet, Acknowledge policies); they are compared with that record, not HR’s task list',
  'CONTRACT Auth: IT / Admin / Finance staff see their own team’s clearance items only',
  'an ended account cannot open the app at all (its app views are not compared after access ends)',
];

const ORG = 'el-consistency';
const PDF = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake image bytes')]);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (env.mongoUri !== LOCAL_URI) throw new Error(`refusing to run against ${env.mongoUri}`);
  if (!/^el_consistency/.test(env.mongoDbName)) throw new Error(`refusing to run against database ${env.mongoDbName}`);
  await (await db.connectDb()).dropDatabase();
  await db.closeDb();
  await db.connectDb();
  const { companies, users, holidays, journeys, journeyTasks, authSessions, exitSettlements, notifications } = db;
  const { app } = await import('../app');
  // The boards and Suwi's notices are served from memory as on the server (lifecycle/readCache.ts):
  // every check below that reads a board after an action is also a check that the action was seen.
  const readCache = await import('../services/lifecycle/readCache');
  readCache.enableLifecycleReadCache();
  const { lifecycleOutbox, clearLifecycleOutbox } = await import('../services/lifecycle/emails');
  const rules = await import('../services/lifecycle/dueRules');
  const jobs = await import('../services/lifecycle/jobs');
  const portalSvc = await import('../services/lifecycle/portal');
  const off = await import('../services/lifecycle/offboarding');
  const exitSvc = await import('../services/exit.service');
  const { hashSessionToken } = await import('../services/auth.service');
  const { forgetLifecycleFeature } = await import('../services/lifecycle/engine');

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ─── The clock and the scheduler ──────────────────────────────────────────
  const setNow = (at: Date) => {
    if (at.getTime() < fakeMs) throw new Error(`the clock cannot go back (${at.toISOString()})`);
    fakeMs = at.getTime();
  };
  /** One scheduler hour, as notification-scheduler runs it. */
  async function tick(at: Date) {
    setNow(at);
    await exitSvc.closeDueExits(at);
    await portalSvc.runPortalJobs(at);
    await off.runOffboardingJobs(at);
    await jobs.runLifecycleJobs(at);
  }
  const SPARSE = new Set([0, 9, 13, 19, 21]);
  async function advanceTo(to: Date, pace: 'hourly' | 'sparse' = 'sparse') {
    const first = Math.floor((fakeMs + 5.5 * HOUR) / HOUR) * HOUR - 5.5 * HOUR + HOUR;
    for (let t = first; t <= to.getTime(); t += HOUR) {
      const hour = new RealDate(t + 5.5 * HOUR).getUTCHours();
      if (pace === 'hourly' || SPARSE.has(hour)) await tick(new Date(t));
    }
    // The auth cache holds a session for 10 s of the clock: a step never reads a stale user.
    setNow(new Date(to.getTime() + 11_000));
  }

  // ─── HTTP, as each client calls it ────────────────────────────────────────
  const tokens = new Map<string, string>();
  async function session(userId: string) {
    const token = randomBytes(32).toString('hex');
    await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 365 * 86_400_000) } as never);
    tokens.set(userId, token);
    return token;
  }
  let portalToken = '';
  /** The portal keeps a 12-hour session: like the portal, sign in again when it has run out. */
  let portalCreds: { email: string } | null = null;
  interface Res { status: number; body: Json }
  /** `as`: a user id (app/dashboard session), 'portal' (the candidate), or null (no login). */
  async function call(as: string | null, method: string, path: string, body?: unknown, form?: FormData): Promise<Res> {
    const headers: Record<string, string> = {};
    const token = as === 'portal' ? portalToken : as ? tokens.get(as) : undefined;
    if (as && !token) throw new Error(`no session for ${as}`);
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res = await fetch(`${base}${path}`, { method, headers, body: payload });
    if (as === 'portal' && res.status === 401 && portalCreds) {
      const again = await portalSignIn(portalCreds.email);
      if (again) {
        portalToken = again;
        headers.authorization = `Bearer ${portalToken}`;
        res = await fetch(`${base}${path}`, { method, headers, body: form ?? payload });
      }
    }
    const type = res.headers.get('content-type') ?? '';
    const out = type.includes('application/json') ? await res.json() : await res.arrayBuffer().then((b) => ({ bytes: Buffer.from(b), type }));
    return { status: res.status, body: out };
  }
  /** A call that must succeed; its body. */
  async function get(as: string | null, path: string): Promise<Json> {
    const r = await call(as, 'GET', path);
    if (r.status !== 200) throw new Error(`GET ${path} as ${as}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  }
  async function send(as: string | null, method: string, path: string, body?: unknown, form?: FormData): Promise<Json> {
    const r = await call(as, method, path, body, form);
    if (r.status >= 300) throw new Error(`${method} ${path} as ${as}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    return r.body;
  }
  const pdfForm = (name: string, field = 'file', bytes = PDF(name), type = 'application/pdf') => {
    const f = new FormData();
    f.append(field, new Blob([bytes], { type }), name);
    return f;
  };

  // ─── Mail ─────────────────────────────────────────────────────────────────
  type Mail = { to: string; subject: string; html: string; attachments: Array<{ filename?: string; content?: unknown }> };
  const mail: Mail[] = [];
  const drain = () => { for (const m of lifecycleOutbox()) mail.push(m as unknown as Mail); clearLifecycleOutbox(); };
  const lastMailTo = (to: string) => { drain(); return [...mail].reverse().find((m) => m.to === to); };
  const tokenIn = (html: string) => /\/o\/([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? '';
  /** The portal's sign-in now: a code emailed to the candidate (read off the code email), then the code. */
  async function portalSignIn(email: string): Promise<string | null> {
    await fetch(`${base}/portal/auth/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const code = /^(\d{6}) is your/.exec(lastMailTo(email)?.subject ?? '')?.[1] ?? '';
    const res = await fetch(`${base}/portal/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
    return res.status === 200 ? ((await res.json()) as { token?: string }).token ?? null : null;
  }

  // ─── The calendar the test computes due dates with (independently of the product) ──
  const HOLIDAYS = ['2027-03-17', '2027-03-25', '2027-07-28'];
  const addDays = (key: string, n: number) => new RealDate(RealDate.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const working = (key: string) => { const d = new RealDate(`${key}T00:00:00Z`).getUTCDay(); return d !== 0 && d !== 6 && !HOLIDAYS.includes(key); };
  const addWorking = (key: string, n: number) => {
    let at = key; let left = Math.abs(n); const step = n < 0 ? -1 : 1;
    while (left > 0) { at = addDays(at, step); if (working(at)) left -= 1; }
    return at;
  };
  const addMonths = (key: string, n: number) => {
    const [y, m, d] = key.split('-').map(Number);
    const t = new RealDate(Date.UTC(y, m - 1 + n, 1));
    const last = new RealDate(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return new RealDate(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
  };
  const monthEnd = (tj: string, n: number) => addDays(addMonths(tj, n), -1);
  const monthStart = (tj: string, n: number) => addMonths(tj, n - 1);
  const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);

  // ═════════════════════════════════════════════════════════════ SETUP
  heading('Setup: a company (Exit settings: 45 days notice), HR, a manager, a team, IT staff, an Onboarding-only coordinator');
  await companies().insertOne({
    id: ORG, name: 'Consistency Works', features: { exits: true, lifecycle: true }, exitNoticeDays: 45,
    profile: { displayName: 'Consistency Works', replyToEmail: 'hr@el-consistency.test', city: 'Bengaluru' },
  } as never);
  await holidays().insertMany(HOLIDAYS.map((d) => ({ org: ORG, state: '*', type: 'Public', date: new Date(`${d}T00:00:00Z`), name: `Holiday ${d}` })) as never[]);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@el-consistency.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date('2024-01-01T00:00:00Z'), ...extra,
  });
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, employeeId: 'ELC-0', joiningDate: new Date('2018-01-01T00:00:00Z') }),
    person('mgr', 'Neha Rao', { role: 'manager', designation: 'Design lead', department: 'Design', managerUserId: 'hr', employeeId: 'ELC-M' }),
    person('p1', 'Esha Iyer', { employeeId: 'ELC-1', department: 'Design', designation: 'Design system lead', managerUserId: 'mgr' }),
    person('p2', 'Tarun Shah', { employeeId: 'ELC-2', department: 'Design', designation: 'Researcher', managerUserId: 'mgr' }),
    person('ravi', 'Ravi Menon', { employeeId: 'ELC-3', department: 'Design', designation: 'Senior designer', managerUserId: 'mgr', joiningDate: new Date('2021-01-04T00:00:00Z'), personalEmail: 'ravi.menon@example.com' }),
    person('omar', 'Omar Khan', { employeeId: 'ELC-4', department: 'Design', designation: 'Principal designer', managerUserId: 'mgr', joiningDate: new Date('1997-06-02T00:00:00Z'), personalEmail: 'omar.khan@example.com' }),
    person('esha2', 'Esha Pillai', { employeeId: 'ELC-5', department: 'Design', designation: 'Contract designer', managerUserId: 'mgr', joiningDate: new Date('2026-08-03T00:00:00Z'), personalEmail: 'esha.pillai@example.com' }),
    person('tara', 'Tara Bose', { employeeId: 'ELC-6', department: 'Design', designation: 'Designer', managerUserId: 'mgr', joiningDate: new Date('2025-02-03T00:00:00Z') }),
    person('it', 'Ishaan IT', { dashboardAccess: true, dashboardTabs: ['offboarding'], clearanceTeam: 'it', department: 'Technology', employeeId: 'ELC-IT' }),
    person('onb', 'Owen Coordinator', { dashboardAccess: true, dashboardTabs: ['onboarding'], department: 'People', employeeId: 'ELC-ON' }),
  ] as never[]);
  for (const id of ['hr', 'mgr', 'p1', 'p2', 'ravi', 'omar', 'esha2', 'tara', 'it', 'onb']) await session(id);
  forgetLifecycleFeature();
  ok('the dashboard sees the group (HR: every lifecycle tab; IT: Offboarding only; the coordinator: Onboarding only)',
    JSON.stringify([(await get('hr', '/admin/lifecycle/settings')).tabs.length, (await get('it', '/admin/lifecycle/settings')).tabs, (await get('onb', '/admin/lifecycle/settings')).tabs]) === JSON.stringify([5, ['offboarding'], ['onboarding']]));

  current = 'access';
  heading('access · each role reaches its own board only');
  eq('IT (Offboarding only): the offboarding board yes, the onboarding board no', [(await call('it', 'GET', '/admin/lifecycle/offboarding/board?tab=notice')).status, (await call('it', 'GET', '/admin/lifecycle/board?tab=pre_boarding')).status], [200, 403]);
  eq('the coordinator (Onboarding only): the onboarding board yes, the offboarding board no', [(await call('onb', 'GET', '/admin/lifecycle/board?tab=pre_boarding')).status, (await call('onb', 'GET', '/admin/lifecycle/offboarding/board?tab=notice')).status], [200, 403]);
  eq('a manager without dashboard access reaches neither', [(await call('mgr', 'GET', '/admin/lifecycle/board?tab=pre_boarding')).status, (await call('mgr', 'GET', '/admin/lifecycle/offboarding/board?tab=notice')).status], [403, 403]);

  // ═════════════════════════════════════════════════════════════ 2 · ONBOARDING TEMPLATE
  current = 'template';
  heading('2 · A custom onboarding template, edited through the dashboard’s template endpoints');
  const standardOn = (await get('hr', '/admin/lifecycle/templates?kind=onboarding')).templates.find((t: Json) => t.isDefault);
  ok('the company starts with one default onboarding template (Standard)', standardOn?.name === 'Standard');
  let tplA = (await send('hr', 'POST', '/admin/lifecycle/templates', { kind: 'onboarding', name: 'Design joiners', copyFromId: standardOn.id })).template;
  const edit = (tasks: Json[]) => tasks.map((t: Json) => {
    const x = structuredClone(t);
    switch (x.systemKey) {
      case 'register_face': x.enabled = false; break; // disabled
      case 'intro_post': x.mustDo = true; x.dueRule = { anchor: 'tj', offset: 2, unit: 'days' }; break; // must-do, Tj + 2
      case 'app_tour': x.ownerRole = 'manager_employee'; break; // a new owner
      case 'upload_documents':
        x.dueRule = { anchor: 'tj', offset: -4, unit: 'working_days' }; // Tj − 4 working days (across a holiday and a weekend)
        x.documents = [
          { key: 'id_proof', label: 'ID proof (PAN and Aadhaar)', required: true },
          { key: 'address_proof', label: 'Current address proof', required: true },
          { key: 'degree', label: 'Degree certificate', required: true },
          { key: 'relieving', label: 'Relieving letter', required: false },
        ];
        break;
      case 'about_you': x.dueRule = { anchor: 'tj', offset: -8, unit: 'days' }; break; // Tj − 8
      case 'week1_reels': x.dueRule = { anchor: 'tj', offset: 4, unit: 'working_days' }; break; // Tj + 4 working days (a holiday inside)
      case 'people_to_meet': x.dueRule = { anchor: 'month_end', month: 2, offset: -2, unit: 'days' }; break; // month_end of month 2, − 2
      case 'check_logins': x.recommended = { ...x.recommended, added: true }; x.enabled = true; break; // a Recommended task added
      default: break;
    }
    return x;
  });
  tplA = (await send('hr', 'PUT', `/admin/lifecycle/templates/${tplA.id}`, {
    settings: { probationMonths: 3, portalOpenUntil: 'month_1', signLettersOnDay1: false }, tasks: edit(tplA.tasks),
  })).template;
  const tplTask = (tpl: Json, key: string) => tpl.tasks.find((t: Json) => t.systemKey === key);
  eq('saved: probation 3, portal open for month 1, letters on the portal', [tplA.settings.probationMonths, tplA.settings.portalOpenUntil, tplA.settings.signLettersOnDay1], [3, 'month_1', false]);
  eq('saved: the edits are on the template', [tplTask(tplA, 'register_face').enabled, tplTask(tplA, 'intro_post').mustDo, tplTask(tplA, 'app_tour').ownerRole, tplTask(tplA, 'check_logins').enabled, tplTask(tplA, 'upload_documents').documents.length], [false, true, 'manager_employee', true, 4]);

  // ═════════════════════════════════════════════════════════════ 1 · THE JOINER
  current = 'same_truth';
  const TJ = '2027-03-22'; // Monday
  const KABIR = 'kabir.mehta@example.com';
  await advanceTo(T('2027-03-01', '10:30'));
  heading('1 · Offer: HR makes Kabir an offer on the custom template (as OfferDialogs sends it)');
  // The dashboard's offer form (OfferDialogs.tsx): the template's probation fills the form when the template is picked.
  const offerFields = (tj: string, extra: Record<string, unknown> = {}) => ({
    designation: 'Product Designer', department: 'Design', location: 'Bengaluru', ctc: 1_400_000, tj, managerUserId: 'mgr',
    probationMonths: 3, noticeDays: 30, validTill: '2027-03-08', responsibilities: 'Own the onboarding experience.', employeeType: 'full_time',
    // These dates are picked for the rules under test, not the weekday; the non-working-day rule has its own checks below.
    allowNonWorkingDay: true, ...extra,
  });
  {
    // A week-off or holiday as the joining date: refused with the reason; HR can keep it on purpose.
    const sunday = await call('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Sunny Weekoff', personalEmail: 'sunny.weekoff@example.com' }, fields: offerFields('2027-03-14', { allowNonWorkingDay: false }), templateId: tplA.id });
    eq('a Sunday joining date is refused with its reason (non_working_day)', [sunday.status, (sunday.body as Json)?.code, String((sunday.body as Json)?.error ?? '').includes('Sunday')], [409, 'non_working_day', true]);
    const kept = await call('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Sunny Weekoff', personalEmail: 'sunny.weekoff@example.com' }, fields: offerFields('2027-03-14'), templateId: tplA.id });
    eq('…and accepted when HR keeps it on purpose (allowNonWorkingDay)', kept.status, 200);
  }
  const created = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Kabir Mehta', personalEmail: KABIR, phone: '+91 98765 43210' }, fields: offerFields(TJ), templateId: tplA.id });
  const A = created.journeyId as string;
  await send('hr', 'POST', `/admin/lifecycle/offers/${A}/pdf`, undefined, pdfForm('Offer - Kabir Mehta.pdf'));
  await send('hr', 'POST', `/admin/lifecycle/offers/${A}/send`, { subject: 'Your offer from Consistency Works', body: 'Hello Kabir, your offer is attached.' });
  const linkA = tokenIn(lastMailTo(KABIR)!.html);
  ok('the offer email carries the link', linkA.length > 30);

  // ── Reading every surface
  const TABS = ['pre_boarding', 'first_week', 'probation'];
  async function boardCard(as: string, journeyId: string) {
    for (const tab of TABS) {
      const b = await get(as, `/admin/lifecycle/board?tab=${tab}`);
      for (const col of b.columns) {
        const card = col.cards.find((c: Json) => c.journeyId === journeyId);
        if (card) return { tab, ...card };
      }
    }
    return null;
  }
  interface OnView {
    card: Json; panel: Json; panelOnb: Json; offerLink?: Json;
    portal?: { me: Json; documents: Json[]; letters: Json[]; pass: Res; offer: Json };
    app?: { me: Json; home: Json; probation: Json; people: Json; starters: Json; notes: Json; week1: Json };
    mgr?: { list: Json; detail: Json };
  }
  let joinerId = ''; // Kabir's userId once joined
  async function onboardingViews(journeyId: string, who: { joiner?: string; link?: string; portal?: boolean }): Promise<OnView> {
    const v: OnView = { card: await boardCard('hr', journeyId), panel: await get('hr', `/admin/lifecycle/journeys/${journeyId}`), panelOnb: await get('onb', `/admin/lifecycle/journeys/${journeyId}`) };
    if (who.link) v.offerLink = await get(null, `/portal/offer/${who.link}`);
    if (who.portal) {
      v.portal = {
        me: await get('portal', '/portal/me'), documents: (await get('portal', '/portal/documents')).documents,
        letters: (await get('portal', '/portal/letters')).letters, pass: await call('portal', 'GET', '/portal/pass'), offer: await get('portal', '/portal/me/offer'),
      };
    }
    if (who.joiner) {
      v.app = {
        me: await get(who.joiner, '/lifecycle/me'), home: await get(who.joiner, '/lifecycle/onboarding'), probation: await get(who.joiner, '/lifecycle/onboarding/probation'),
        people: await get(who.joiner, '/lifecycle/onboarding/people'), starters: await get(who.joiner, '/lifecycle/onboarding/starter-tasks'),
        notes: await get(who.joiner, '/lifecycle/onboarding/notes'), week1: await get(who.joiner, '/lifecycle/onboarding/week1'),
      };
    }
    const list = await get('mgr', '/lifecycle/manager/joiners');
    const mine = list.joiners.find((x: Json) => x.journeyId === journeyId);
    if (mine) v.mgr = { list: mine, detail: await get('mgr', `/lifecycle/manager/joiners/${journeyId}`) };
    return v;
  }

  // ── The comparisons
  const TASK_FIELDS = ['id', 'systemKey', 'phase', 'ownerRole', 'ownerName', 'kind', 'surface', 'mustDo', 'status', 'opensAt', 'dueAt', 'dueLabel', 'doneAt', 'doneByName', 'late', 'month'];
  const pick = (t: Json, fields: string[]) => Object.fromEntries(fields.map((f) => [f, t?.[f] ?? null]));
  const JOINER_READ_ONLY = new Set(['welcome_induction', 'vision_culture', 'laptop_setup', 'meet_team']);
  const ACTIVE = ['todo', 'in_review', 'sent_back'];
  /** CONTRACT: who sees which task (engine visibleTo / joinerSeesReadOnly). */
  const joinerSees = (t: Json) => t.status !== 'cancelled' && (['employee', 'manager_employee'].includes(t.ownerRole)
    || (t.phase === 'first_week' && !['automatic'].includes(t.ownerRole) && (t.systemKey ? JOINER_READ_ONLY.has(t.systemKey) : t.kind === 'meeting')));
  const managerSees = (t: Json) => t.status !== 'cancelled' && ['manager', 'manager_employee', 'employee', 'hr_manager'].includes(t.ownerRole);
  /** The task rows a surface shows agree with HR's panel, field by field (titles too, bar the CONTRACT's wording). */
  function sameTasks(label: string, hrTasks: Json[], rows: Json[], expectIds: string[], opts: { titles?: 'same' | 'manager' } = {}) {
    const got = rows.map((r) => r.id).sort();
    eq(`${label}: the same tasks as HR’s panel`, got, [...expectIds].sort());
    const diffs: Json[] = [];
    for (const r of rows) {
      const h = hrTasks.find((t) => t.id === r.id);
      if (!h) continue;
      const a = pick(h, TASK_FIELDS); const b = pick(r, TASK_FIELDS);
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ id: r.systemKey ?? r.id, hr: a, here: b });
      // Titles: the same, except the manager's own wording (APP_COPY managerTitle) on tasks the manager does.
      if ((opts.titles ?? 'same') === 'same' ? r.title !== h.title : (r.ownerRole === 'employee' && r.title !== h.title)) diffs.push({ id: r.systemKey ?? r.id, title: [h.title, r.title] });
    }
    ok(`${label}: titles, owners, due dates, done/open, must-do agree with HR’s panel`, diffs.length === 0, diffs.slice(0, 4));
  }
  const allAppRows = (home: Json): Json[] => [...home.today, ...home.later, ...home.done];
  /**
   * Rows on the joiner's home that are not journey tasks, each read from its own record: shared 1:1
   * notes, starter tasks, team meetings (`team:<key>`, journey.teamTasks), people the manager picked
   * (`person:<id>`, lifecycle_people_to_meet) and Acknowledge policies (`policies`, the policy
   * acknowledgements). HR's panel lists journey tasks only; these are compared with their record.
   */
  const ownRecordRow = (t: Json) => t.id === 'notes' || t.id === 'policies' || String(t.id).includes(':') || t.systemKey === 'starter_task';
  const appRows = (home: Json) => allAppRows(home).filter((t: Json) => !ownRecordRow(t));
  /** The home's own-record rows agree with their records: people to meet, and the policy counts. */
  function sameOwnRows(label: string, hr: Json[], home: Json, people: Json) {
    const rows = allAppRows(home);
    const container = hr.find((t) => t.systemKey === 'people_to_meet' && t.status !== 'cancelled');
    if (container) {
      agree(`${label}: people to meet (the home's rows, the people list)`, {
        home: rows.filter((r) => String(r.id).startsWith('person:')).map((r) => [r.id, r.status === 'done']).sort(),
        people: (people.people as Json[]).filter((x) => !x.role).map((x) => [`person:${x.id}`, !!x.metAt]).sort(),
      });
    }
    const pol = rows.find((r) => r.id === 'policies');
    const counts = home.policies;
    agree(`${label}: Acknowledge policies (the home's row, the policy counts)`, {
      row: pol ? [pol.progress?.done, pol.progress?.total] : null,
      counts: counts?.required ? [counts.acknowledged, counts.required] : null,
    });
  }

  function compareOnboarding(step: string, v: OnView, opts: { joined?: boolean } = {}) {
    const p = v.panel; const j = p.journey;
    heading(`   compare · ${step}`);
    // Status, stage, day label, Tj, plant
    const status: Record<string, unknown> = { board: v.card?.status, panel: j.status };
    if (v.portal) status.portal = v.portal.me.status;
    agree(`${step}: status`, status);
    const stage: Record<string, unknown> = { panel: j.stage };
    if (v.app) Object.assign(stage, { appMe: v.app.me.onboarding?.stage, appHome: v.app.home.stage });
    if (v.mgr) Object.assign(stage, { managerList: v.mgr.list.stage, managerDetail: v.mgr.detail.joiner.stage });
    if (Object.keys(stage).length > 1) agree(`${step}: stage`, stage);
    const label: Record<string, unknown> = { board: v.card?.dayLabel, panel: j.dayLabel };
    if (v.app) Object.assign(label, { appMe: v.app.me.onboarding?.dayLabel, appHome: v.app.home.dayLabel });
    if (v.mgr) Object.assign(label, { managerList: v.mgr.list.dayLabel, managerDetail: v.mgr.detail.joiner.dayLabel });
    agree(`${step}: day label`, label);
    if (v.portal && !opts.joined) {
      const n = v.portal.me.daysToGo;
      const want = n > 1 ? `In ${n} days` : n === 1 ? 'Tomorrow' : 'Day 1';
      eq(`${step}: the portal’s days to go say the board’s day label`, want, j.dayLabel);
    }
    const tj: Record<string, unknown> = { board: v.card?.tj, panel: j.tj, offer: p.offer?.fields?.tj, panelOnb: v.panelOnb.journey.tj };
    if (v.portal) Object.assign(tj, { portal: v.portal.me.tj, portalOffer: v.portal.offer.fields.tj });
    if (v.offerLink && v.offerLink.fields?.tj) tj.offerLink = v.offerLink.fields.tj;
    if (v.app) tj.appHome = v.app.home.tj;
    if (v.mgr) Object.assign(tj, { managerList: v.mgr.list.tj, managerDetail: v.mgr.detail.joiner.tj });
    agree(`${step}: Tj`, tj);
    const plant: Record<string, unknown> = { board: v.card?.plant, panel: j.plant };
    if (v.app) Object.assign(plant, { appMe: v.app.me.onboarding?.plant, appHome: v.app.home.plant });
    if (v.mgr) Object.assign(plant, { managerList: v.mgr.list.plant, managerDetail: v.mgr.detail.joiner.plant });
    if (v.portal && !opts.joined) plant.portal = v.portal.me.plant;
    agree(`${step}: plant`, plant);
    // Probation months
    const months: Record<string, unknown> = { panel: (j.probation?.months ?? 0) + (j.probation?.extendedBy ?? 0), panelOffer: p.offer?.fields?.probationMonths };
    if (v.portal) months.portalOffer = v.portal.offer.fields.probationMonths;
    if (v.offerLink?.fields?.probationMonths !== undefined) months.offerLink = v.offerLink.fields.probationMonths;
    if (v.app) Object.assign(months, { appProbation: v.app.probation.totalMonths, appWeek1: v.app.week1.probationMonths });
    if (v.mgr) months.managerDetail = v.mgr.detail.joiner.probationMonths;
    agree(`${step}: probation months`, months);
    // Progress the board and the panel count
    agree(`${step}: progress`, { board: v.card?.progress, panel: j.progress });
    // Tasks
    const hr = p.tasks as Json[];
    sameTasks(`${step}: the Onboarding-only coordinator`, hr, v.panelOnb.tasks, hr.map((t) => t.id));
    if (v.portal) {
      const portalIds = hr.filter((t) => joinerSees(t) && (opts.joined ? t.phase === 'first_week' : t.surface === 'portal') && ['employee', 'manager_employee'].includes(t.ownerRole)).map((t) => t.id);
      sameTasks(`${step}: portal home`, hr, v.portal.me.tasks, portalIds);
    }
    if (v.app) {
      const appIds = hr.filter((t) => joinerSees(t) && (t.phase !== 'pre_boarding' || ACTIVE.includes(t.status))).map((t) => t.id);
      sameTasks(`${step}: app home`, hr, appRows(v.app.home), appIds);
      sameOwnRows(`${step}: app home`, hr, v.app.home, v.app.people);
    }
    if (v.mgr) sameTasks(`${step}: manager’s M2`, hr, v.mgr.detail.tasks, hr.filter(managerSees).map((t) => t.id), { titles: 'manager' });
    // Documents and letters
    if (v.portal) {
      const docs = (list: Json[]) => list.map((d) => ({ id: d.id, docKey: d.docKey, label: d.label, required: d.required, status: d.status, files: (d.files ?? []).map((f: Json) => f.id), hrNote: d.hrNote ?? null }));
      agree(`${step}: documents (HR’s panel, the portal)`, { panel: docs(p.documents), portal: docs(v.portal.documents) });
      const portalLetterState = Object.fromEntries(v.portal.letters.map((l: Json) => [l.kind, l.state]));
      // A letter not drafted yet is the portal's locked placeholder.
      // (A draft without its PDF is still locked for the candidate.)
      const asPortal = (state: string | undefined) => (!state || state === 'draft' ? 'locked' : state === 'sent' ? 'ready' : state);
      const panelLetterState = Object.fromEntries(Object.keys(portalLetterState).map((kind) => [kind, asPortal((p.letters as Json[]).find((l) => l.kind === kind)?.state)]));
      agree(`${step}: letter states (HR’s panel, the portal)`, { panel: panelLetterState, portal: portalLetterState });
      const signTask = hr.find((t) => t.systemKey === 'sign_letters');
      const step5 = v.portal.me.path.find((s: Json) => s.key === 'letter');
      if (signTask && step5) ok(`${step}: the portal’s Sign step and the sign task agree (done ⇔ done)`, (step5.state === 'done') === (signTask.status === 'done'), { path: step5, task: signTask.status });
      const docTask = hr.find((t) => t.systemKey === 'upload_documents');
      const docStep = v.portal.me.path.find((s: Json) => s.key === 'docs');
      if (docTask && !opts.joined) eq(`${step}: the portal’s documents due day is the task’s`, [docStep?.due ?? null, ...new Set(v.portal.documents.map((d: Json) => d.dueAt))], [day(docTask.dueAt), day(docTask.dueAt)]);
      // GET /portal/pass answers 200 either way: `state: 'open'` with the pass, or `state: 'locked'` with the day it opens.
      ok(`${step}: the Day-1 pass answers 200 (open or not yet), never an error the browser logs`, v.portal.pass.status === 200 && ['open', 'locked'].includes(v.portal.pass.body?.state), v.portal.pass);
      const passOpen = v.portal.pass.status === 200 && v.portal.pass.body?.state === 'open';
      const passStep = v.portal.me.path.find((s: Json) => s.key === 'pass');
      if (passStep) ok(`${step}: the Day-1 pass opens exactly when the path says (${passStep.state})`, passOpen === (passStep.state !== 'locked'), { pass: v.portal.pass.status, step: passStep });
      if (v.portal.pass.body?.state === 'locked' && v.portal.pass.body.opensOn) {
        const passTask = (v.portal.me.tasks as Json[]).find((t) => t.systemKey === 'day1_pass');
        eq(`${step}: a locked pass names the day it opens (Tj − 7)`, v.portal.pass.body.opensOn, addDays(v.portal.me.tj, -7));
        if (passTask?.opensAt) eq(`${step}: the day it opens is the pass task's opening day`, v.portal.pass.body.opensOn, day(passTask.opensAt));
      }
    }
    // The Onboarding-only coordinator: the same documents, status only (allowed: no files)
    agree(`${step}: documents for the Onboarding-only role (status only)`, {
      hr: (p.documents as Json[]).map((d) => [d.id, d.status, d.required]), onb: (v.panelOnb.documents as Json[]).map((d) => [d.id, d.status, d.required]),
    });
    ok(`${step}: no files for the Onboarding-only role (allowed difference)`, (v.panelOnb.documents as Json[]).every((d) => !d.files?.length && !d.fileIds?.length));
    ok(`${step}: no CTC for the Onboarding-only role (allowed difference)`, v.panelOnb.offer && !('ctc' in v.panelOnb.offer.fields) && p.offer.fields.ctc === 1_400_000);
    // Manager's set-up: people to meet, buddy, notes, starter tasks
    if (v.mgr && v.app) {
      agree(`${step}: people to meet (app, manager’s set-up)`, {
        app: v.app.people.people.map((x: Json) => [x.userId, x.why ?? null, x.metAt ?? null]),
        manager: v.mgr.detail.setup.people.map((x: Json) => [x.userId ?? x.personUserId, x.why ?? null, x.metAt ?? null]),
      });
      agree(`${step}: starter tasks (app, manager)`, {
        app: v.app.starters.tasks.map((s: Json) => [s.id, s.title, day(s.dueAt), !!s.doneAt]),
        manager: v.mgr.detail.starterTasks.map((s: Json) => [s.id, s.title, day(s.dueAt), !!s.doneAt]),
      });
      const sharedOnly = v.mgr.detail.notes.filter((n: Json) => n.shared);
      agree(`${step}: 1:1 notes (the app shows the shared ones; unshared hidden — allowed)`, {
        app: v.app.notes.notes.map((n: Json) => [n.id, n.text]), managerShared: sharedOnly.map((n: Json) => [n.id, n.text]),
      });
      agree(`${step}: probation months and goals (app, manager)`, {
        app: v.app.probation.months.map((m: Json) => [m.monthNo ?? m.month, (m.goals ?? []).map((g: Json) => g.text ?? g)]),
        manager: v.mgr.detail.probation.months.map((m: Json) => [m.monthNo ?? m.month, (m.goals ?? []).map((g: Json) => g.text ?? g)]),
        panel: p.probation.months.map((m: Json) => [m.monthNo ?? m.month, (m.goals ?? []).map((g: Json) => g.text ?? g)]),
      });
      ok(`${step}: the manager’s decision view carries no salary (allowed difference)`, !v.mgr.detail.probation.decision || !('salary' in v.mgr.detail.probation.decision));
    }
    if (v.mgr) {
      agree(`${step}: the buddy (HR’s panel, the manager)`, { panel: j.buddyName ?? null, manager: v.mgr.detail.setup.buddy?.name ?? null });
      ok(`${step}: the manager’s survey summary only from 3 answers (allowed difference)`, !v.mgr.detail.surveySummary || v.mgr.detail.surveySummary.count >= 3, v.mgr.detail.surveySummary);
    }
  }

  // ── Step 1: offer sent
  let v = await onboardingViews(A, { link: linkA });
  compareOnboarding('offer sent', v);
  eq('the journey follows the custom template', [v.panel.journey.templateId, v.card?.column], [tplA.id, 'offer_sent']);
  ok('the manager does not see a candidate before acceptance', !v.mgr);

  // ═════════ section 2 checks on Kabir's journey (template → every surface)
  current = 'template';
  heading('2 · The template reaches every surface (Kabir, offer sent)');
  const hrTask = (view: OnView, key: string) => (view.panel.tasks as Json[]).find((t) => t.systemKey === key);
  ok('a disabled task is absent from HR’s panel', !hrTask(v, 'register_face'));
  ok('the added Recommended task is there (Check logins work)', !!hrTask(v, 'check_logins'));
  eq('the must-do change: Intro post is must-do', hrTask(v, 'intro_post')?.mustDo, true);
  eq('the owner change: Take the tour is manager + employee', hrTask(v, 'app_tour')?.ownerRole, 'manager_employee');
  const expectDue: Record<string, string> = {
    upload_documents: addWorking(TJ, -4), // Mon 15 Mar (skips Wed 17 holiday and the weekend)
    about_you: addDays(TJ, -8),
    intro_post: addDays(TJ, 2),
    week1_reels: addWorking(TJ, 4), // Mon 29 Mar (skips Thu 25 holiday and the weekend)
    people_to_meet: addDays(monthEnd(TJ, 2), -2),
  };
  eq('the due rules computed with the company’s holidays and week-offs', Object.fromEntries(Object.keys(expectDue).map((k) => [k, day(hrTask(v, k)?.dueAt)])), expectDue);
  eq('…as the test’s own calendar has them', expectDue, { upload_documents: '2027-03-15', about_you: '2027-03-14', intro_post: '2027-03-24', week1_reels: '2027-03-29', people_to_meet: '2027-05-19' });
  eq('month tasks for 3 months (check-ins 1–3)', (v.panel.tasks as Json[]).filter((t) => t.systemKey === 'monthly_checkin').map((t) => t.month), [1, 2, 3]);
  eq('the confirmation talk opens at the start of month 3', day(hrTask(v, 'confirmation_discussion')?.opensAt), monthStart(TJ, 3));

  // A second candidate whose offer states another probation than the template (HR edited the offer form).
  heading('2 · Probation: the offer form’s value and the journey agree from the start');
  const cand = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Chetan Rao', personalEmail: 'chetan.rao@example.com' }, fields: offerFields('2027-04-05', { probationMonths: 6, validTill: '2027-03-10' }), templateId: tplA.id });
  const pc = await get('hr', `/admin/lifecycle/journeys/${cand.journeyId}`);
  agree('Chetan (offer says 6 months on a 3-month template): the panel’s probation, the offer, the month tasks', {
    journey: pc.journey.probation?.months, offer: pc.offer.fields.probationMonths, monthTasks: (pc.tasks as Json[]).filter((t) => t.systemKey === 'monthly_checkin').length,
  });
  const noMonths = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Dev Anand', personalEmail: 'dev.anand@example.com' }, fields: (({ probationMonths: _p, ...rest }) => rest)(offerFields('2027-04-05', { validTill: '2027-03-10' })), templateId: tplA.id });
  const pd = await get('hr', `/admin/lifecycle/journeys/${noMonths.journeyId}`);
  agree('Dev (the offer gives no probation): the template’s 3 months on the offer and the journey', { journey: pd.journey.probation?.months, offer: pd.offer.fields.probationMonths, template: 3 });
  // Drafts (never sent) stay as HR's drafts.
  current = 'same_truth';

  // ── Step 2: accepted (through the link, as the portal does)
  await advanceTo(T('2027-03-02', '11:30'));
  heading('1 · Accepted');
  eq('the link accepts', (await send(null, 'POST', `/portal/offer/${linkA}/accept`)).state, 'accepted');
  v = await onboardingViews(A, { link: linkA });
  compareOnboarding('accepted', v);
  eq('the link says accepted; the board Accepted', [v.offerLink?.state, v.card?.column], ['accepted', 'accepted']);

  // ── Step 3: finalised; the manager's to-do
  await advanceTo(T('2027-03-02', '14:00'));
  heading('1 · Finalised');
  await send('hr', 'POST', `/admin/lifecycle/offers/${A}/finalise`);
  ok('the portal email carries the link and no password (sign-in is a code to this email)', /joining portal is ready/.test(lastMailTo(KABIR)!.subject) && !/Password:/i.test(lastMailTo(KABIR)!.html));
  ok('…and its link fills in their email on the sign-in page', lastMailTo(KABIR)!.html.includes(`/sign-in?email=${encodeURIComponent(KABIR)}`), lastMailTo(KABIR)!.html.match(/href="[^"]*sign-in[^"]*"/)?.[0]);
  v = await onboardingViews(A, { link: linkA });
  compareOnboarding('finalised', v);
  ok('the manager sees Kabir in pre-boarding now', v.mgr?.list.preboarding === true, v.mgr?.list);

  // ── Step 4: signed in
  await advanceTo(T('2027-03-04', '10:00'));
  heading('1 · Signed in to the portal');
  const signIn = { token: await portalSignIn(KABIR) };
  portalToken = signIn.token ?? '';
  portalCreds = { email: KABIR };
  ok('an app token is not a portal token, nor the reverse', (await call('hr', 'GET', '/portal/me')).status === 401 && (await call('portal', 'GET', '/lifecycle/me')).status === 401);
  v = await onboardingViews(A, { link: linkA, portal: true });
  compareOnboarding('signed in', v);
  current = 'template';
  eq('the portal lists the template’s documents (edited list), in order', v.portal!.documents.map((d: Json) => [d.docKey, d.label, d.required]), [
    ['id_proof', 'ID proof (PAN and Aadhaar)', true], ['address_proof', 'Current address proof', true], ['degree', 'Degree certificate', true], ['relieving', 'Relieving letter', false],
  ]);
  eq('the portal’s path: six steps (letters on the portal)', v.portal!.me.path.map((s: Json) => s.key), ['offer', 'docs', 'about', 'meet', 'letter', 'pass']);
  eq('the portal’s About-you due day is the template’s Tj − 8', v.portal!.me.path.find((s: Json) => s.key === 'about')?.due, expectDue.about_you);
  eq('“open until” on the portal: a month after Tj (portalOpenUntil month_1)', v.portal!.me.portalOpenUntil, addMonths(TJ, 1));
  current = 'same_truth';

  // ── Step 5: the manager sets the joiner up in the app
  await advanceTo(T('2027-03-05', '10:00'));
  heading('1 · The manager’s set-up (app)');
  await send('mgr', 'PUT', `/lifecycle/manager/joiners/${A}/setup`, { people: [{ userId: 'p1', why: 'Runs the design system' }, { userId: 'p2' }], buddyUserId: 'p1', welcomeNote: { kind: 'text', text: 'We loved your portfolio.' }, goals: ['Ship the onboarding revamp'] });
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('manager set-up', v);
  const meet = await get('portal', '/portal/meet');
  ok('the welcome note reaches the portal’s Meet us', meet.items.some((i: Json) => i.kind === 'manager_note' && /portfolio/.test(i.text ?? '')), meet.items);
  eq('the buddy on the panel and the manager’s set-up is Esha', [v.panel.journey.buddyName, v.mgr?.detail.setup.buddy?.name], ['Esha Iyer', 'Esha Iyer']);

  // ── Step 6: documents uploaded; one sent back
  await advanceTo(T('2027-03-08', '11:00'));
  heading('1 · Documents: uploaded through the portal, one sent back');
  for (const d of v.portal!.documents.filter((x: Json) => x.required)) {
    await send('portal', 'POST', `/portal/documents/${d.id}/upload`, undefined, pdfForm(`${d.docKey}.jpg`, 'files', JPG, 'image/jpeg'));
  }
  const docs1 = (await get('portal', '/portal/documents')).documents as Json[];
  for (const d of docs1.filter((x) => x.required && x.docKey !== 'id_proof')) await send('hr', 'POST', `/admin/lifecycle/documents/${d.id}/review`, { decision: 'approve' });
  const idDoc = docs1.find((x) => x.docKey === 'id_proof')!;
  await send('hr', 'POST', `/admin/lifecycle/documents/${idDoc.id}/review`, { decision: 'send_back', note: 'Both sides, please.' });
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('a document sent back', v);
  eq('the upload task is sent back on HR’s panel and on the portal', [hrTask(v, 'upload_documents')?.status, v.portal!.me.tasks.find((t: Json) => t.systemKey === 'upload_documents')?.status], ['sent_back', 'sent_back']);
  eq('the portal’s Up next: re-upload the ID proof', v.portal!.me.upNext?.key, 'docs');
  current = 'access';
  heading('access · candidate files: HR opens them, the Onboarding-only role does not');
  const fileId = (v.panel.documents as Json[]).find((d) => d.docKey === 'address_proof').files[0].id;
  eq('HR opens the uploaded file; the coordinator is refused (allowed difference)', [(await call('hr', 'GET', `/admin/lifecycle/files/${fileId}`)).status, (await call('onb', 'GET', `/admin/lifecycle/files/${fileId}`)).status], [200, 403]);
  eq('the coordinator cannot review documents or make an offer (pay)', [(await call('onb', 'POST', `/admin/lifecycle/documents/${idDoc.id}/review`, { decision: 'approve' })).status, (await call('onb', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'X Y', personalEmail: 'x@y.example' }, fields: offerFields('2027-05-03') })).status], [403, 403]);
  current = 'same_truth';

  // ── Step 7: re-uploaded and approved; the letters
  await advanceTo(T('2027-03-09', '11:00'));
  heading('1 · Documents approved; the letters drafted and made');
  await send('portal', 'POST', `/portal/documents/${idDoc.id}/upload`, undefined, pdfForm('aadhaar-both.pdf', 'files'));
  await send('hr', 'POST', `/admin/lifecycle/documents/${idDoc.id}/review`, { decision: 'approve' });
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('documents approved (letters drafted, no PDF yet)', v);
  for (const l of (v.panel.letters as Json[]).filter((x) => ['appointment', 'nda'].includes(x.kind))) {
    await send('hr', 'POST', `/admin/lifecycle/letters/${l.id}/pdf`, undefined, pdfForm(`${l.kind}.pdf`));
  }
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('letters ready', v);
  eq('the board: Letters to sign; the portal: letter ready', [v.card?.column, v.portal!.me.view], ['letters', 'letter_ready']);

  // ── Step 8: About you, Meet us
  await advanceTo(T('2027-03-10', '10:30'));
  heading('1 · About you and Meet us');
  await send('portal', 'PUT', '/portal/about', { emergencyContact: { name: 'Asha Mehta', relation: 'Parent', phone: '+91 91234 56789' }, pf: { firstJob: true } });
  for (const item of (await get('portal', '/portal/meet')).items) await send('portal', 'POST', '/portal/meet/seen', { itemId: item.id });
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('about you and meet us done', v);

  // ── Step 9: Tj − 7: the pass
  await advanceTo(T('2027-03-15', '09:30'));
  heading('1 · Tj − 7: the Day-1 pass');
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('Tj − 7', v);
  ok('the pass opens', v.portal!.pass.status === 200 && v.portal!.pass.body.state === 'open', v.portal!.pass);
  if (v.portal!.pass.body?.state === 'open') agree('the pass names the manager and buddy the panel names', { pass: [v.portal!.pass.body.managerName, v.portal!.pass.body.buddyName, v.portal!.pass.body.date], panel: [v.panel.journey.managerName, v.panel.journey.buddyName, v.panel.journey.tj] });

  // ── Step 10: letters signed
  await advanceTo(T('2027-03-16', '11:00'));
  heading('1 · Letters signed on the portal');
  for (const l of (await get('portal', '/portal/letters')).letters) {
    await send('portal', 'POST', `/portal/letters/${l.id}/opened`);
    await send('portal', 'POST', `/portal/letters/${l.id}/sign`, { method: 'type', typedName: 'Kabir Mehta' });
  }
  v = await onboardingViews(A, { portal: true });
  compareOnboarding('letters signed', v);
  eq('board: Ready to join', v.card?.column, 'ready_to_join');

  // ── Step 11: Tj, Mark joined
  await advanceTo(T(TJ, '09:30'));
  heading('1 · Tj: Mark joined; the app');
  const joined = await send('hr', 'POST', `/admin/lifecycle/offers/${A}/mark-joined`, { workEmail: 'kabir@el-consistency.test', employeeId: 'ELC-101' });
  joinerId = joined.userId;
  await session(joinerId);
  await advanceTo(T(TJ, '10:05'), 'hourly');
  v = await onboardingViews(A, { joiner: joinerId, portal: true });
  compareOnboarding('Day 1 (joined)', v, { joined: true });
  eq('the app tile shows; the portal says joined with the work email', [v.app!.me.onboarding?.tileVisible, v.portal!.me.view, v.portal!.me.workEmail], [true, 'joined', 'kabir@el-consistency.test']);

  current = 'across';
  heading('3 · Mark joined made the employee from the offer and the template');
  const kUser = await users().findOne({ userId: joinerId });
  eq('People: joiningDate is Tj; work email, manager, designation, department, location, type, personal email from the offer', [
    kUser?.joiningDate ? rules.keyOfDay(kUser.joiningDate) : null, kUser?.email, kUser?.managerUserId, kUser?.designation, kUser?.department, kUser?.location, kUser?.employeeType, kUser?.personalEmail, kUser?.employeeId,
  ], [TJ, 'kabir@el-consistency.test', 'mgr', 'Product Designer', 'Design', 'Bengaluru', 'full_time', KABIR, 'ELC-101']);
  const people = await get('hr', `/admin/employees/${joinerId}`).catch(() => null);
  if (people) eq('the dashboard’s People record says the same joining day', day(people.employee?.joiningDate ?? people.joiningDate ?? people.user?.joiningDate), TJ);
  eq('the journey’s probation (template: 3 months) on the app, the board and the manager', [v.app!.probation.totalMonths, v.panel.journey.probation.months, v.mgr?.detail.joiner.probationMonths], [3, 3, 3]);
  current = 'same_truth';

  // ── Step 12: day 2: starter task, notes, the tour (manager + employee), check logins
  await advanceTo(T('2027-03-23', '11:00'));
  heading('1 · Day 2: a starter task, 1:1 notes (one shared), the tour, people met');
  const starter = await send('mgr', 'POST', `/lifecycle/manager/joiners/${A}/starter-tasks`, { title: 'Redesign the leave screen', dueAt: '2027-03-26', note: 'Start with the research', links: ['https://docs.example/leave'] });
  ok('the starter task is created', !!starter);
  await send('mgr', 'POST', `/lifecycle/manager/joiners/${A}/notes`, { text: 'Great first day — shared', shared: true });
  await send('mgr', 'POST', `/lifecycle/manager/joiners/${A}/notes`, { text: 'Private: watch the workload', shared: false });
  v = await onboardingViews(A, { joiner: joinerId, portal: true });
  const tour = appRows(v.app!.home).find((t: Json) => t.systemKey === 'app_tour');
  await send(joinerId, 'POST', `/lifecycle/onboarding/tasks/${tour.id}`, { action: 'done' });
  const logins = appRows(v.app!.home).find((t: Json) => t.systemKey === 'check_logins');
  if (ok('the Recommended task added on the template is on the app (Check logins work)', !!logins)) await send(joinerId, 'POST', `/lifecycle/onboarding/tasks/${logins.id}`, { action: 'done' });
  const p1 = (await get(joinerId, '/lifecycle/onboarding/people')).people[0];
  await send(joinerId, 'POST', `/lifecycle/onboarding/people/${p1.id}`, { action: 'met' });
  v = await onboardingViews(A, { joiner: joinerId, portal: true });
  compareOnboarding('day 2', v, { joined: true });
  current = 'template';
  eq('the owner change: the tour is a manager + employee task, on HR’s panel and on the manager’s M2', [hrTask(v, 'app_tour')?.ownerRole, (v.mgr?.detail.tasks as Json[]).some((t) => t.systemKey === 'app_tour')], ['manager_employee', true]);
  ok('disabled “Register face” is on no surface', ![...(v.panel.tasks as Json[]), ...appRows(v.app!.home), ...(v.mgr!.detail.tasks as Json[]), ...v.portal!.me.tasks].some((t: Json) => t.systemKey === 'register_face'));
  eq('the app’s week-1 tasks are due on the template’s Tj + 4 working days', day(appRows(v.app!.home).find((t: Json) => t.systemKey === 'week1_reels')?.dueAt), expectDue.week1_reels);
  eq('must-do on the app: the intro post', appRows(v.app!.home).find((t: Json) => t.systemKey === 'intro_post')?.mustDo, true);
  current = 'same_truth';

  // ── Snapshot rule: the template changes while Kabir's journey runs
  current = 'template';
  heading('2 · The snapshot rule: the template is edited while Kabir’s journey runs');
  const beforeEdit = (await get('hr', `/admin/lifecycle/journeys/${A}`)).tasks.map((t: Json) => [t.systemKey, t.month ?? null, day(t.dueAt), t.ownerRole, t.mustDo]);
  const tplNow = (await get('hr', `/admin/lifecycle/templates/${tplA.id}`)).template;
  await send('hr', 'PUT', `/admin/lifecycle/templates/${tplA.id}`, {
    settings: { probationMonths: 6 },
    tasks: tplNow.tasks.map((t: Json) => (t.systemKey === 'people_to_meet' ? { ...t, dueRule: { anchor: 'tj', offset: 10, unit: 'days' } } : t.systemKey === 'intro_post' ? { ...t, enabled: false } : t)),
  });
  await advanceTo(T('2027-03-23', '14:00'), 'hourly');
  const afterEdit = (await get('hr', `/admin/lifecycle/journeys/${A}`)).tasks.map((t: Json) => [t.systemKey, t.month ?? null, day(t.dueAt), t.ownerRole, t.mustDo]);
  eq('REPORT · a running journey keeps its snapshot: no task, date or probation changed (6Zs: template changes apply to journeys that start after saving)', afterEdit, beforeEdit);
  eq('…its probation stays 3 months on the app and the panel', [(await get(joinerId, '/lifecycle/onboarding/probation')).totalMonths, (await get('hr', `/admin/lifecycle/journeys/${A}`)).journey.probation.months], [3, 3]);
  const usingA = await get('hr', `/admin/lifecycle/templates/${tplA.id}/journeys`);
  ok('the template’s Joiners tab lists Kabir as following it', usingA.journeys.some((x: Json) => x.journeyId === A), usingA);
  // Put the template back for the joiners after.
  await send('hr', 'PUT', `/admin/lifecycle/templates/${tplA.id}`, { settings: { probationMonths: 3 }, tasks: tplNow.tasks });
  current = 'same_truth';

  // ── Default template: Day-1 letters, made the default; Bina's offer without a template
  current = 'template';
  heading('2 · The default template: a “Day-1 letters” template made the default; a new offer uses it');
  let tplB = (await send('hr', 'POST', '/admin/lifecycle/templates', { kind: 'onboarding', name: 'Day-1 letters', copyFromId: tplA.id })).template;
  tplB = (await send('hr', 'PUT', `/admin/lifecycle/templates/${tplB.id}`, { settings: { signLettersOnDay1: true }, isDefault: true })).template;
  const listOn = (await get('hr', '/admin/lifecycle/templates?kind=onboarding')).templates;
  eq('one default: Day-1 letters', listOn.filter((t: Json) => t.isDefault).map((t: Json) => t.name), ['Day-1 letters']);
  const BINA = 'bina.bose@example.com';
  const TJ_B = '2027-04-05';
  // The dashboard's form: the default template is preselected (and its probation fills the form).
  const createdB = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Bina Bose', personalEmail: BINA }, fields: offerFields(TJ_B, { validTill: '2027-03-30' }) });
  const B = createdB.journeyId as string;
  eq('an offer made without a template follows the default (Day-1 letters)', (await get('hr', `/admin/lifecycle/journeys/${B}`)).journey.templateId, tplB.id);
  await send('hr', 'POST', `/admin/lifecycle/offers/${B}/pdf`, undefined, pdfForm('Offer - Bina.pdf'));
  await send('hr', 'POST', `/admin/lifecycle/offers/${B}/send`, { subject: 'Your offer', body: 'Hello Bina' });
  const linkB = tokenIn(lastMailTo(BINA)!.html);
  await send(null, 'POST', `/portal/offer/${linkB}/accept`);
  await send('hr', 'POST', `/admin/lifecycle/offers/${B}/finalise`);
  const portalA = { token: portalToken, creds: portalCreds };
  portalToken = (await portalSignIn(BINA)) ?? '';
  portalCreds = { email: BINA };
  for (const d of ((await get('portal', '/portal/documents')).documents as Json[]).filter((x) => x.required)) {
    await send('portal', 'POST', `/portal/documents/${d.id}/upload`, undefined, pdfForm(`${d.docKey}.pdf`, 'files'));
    await send('hr', 'POST', `/admin/lifecycle/documents/${d.id}/review`, { decision: 'approve' });
  }
  let vb = await onboardingViews(B, { portal: true });
  compareOnboarding('Bina, documents approved (Day-1 letters)', vb);
  eq('letters on Day 1: the portal’s path has no Sign step', vb.portal!.me.path.map((s: Json) => s.key), ['offer', 'docs', 'about', 'meet', 'pass']);
  ok('letters on Day 1: nothing to sign on the portal', vb.portal!.letters.every((l: Json) => l.state === 'locked'), vb.portal!.letters);
  const signB = hrTask(vb, 'sign_letters');
  ok('letters on Day 1: the sign task leaves pre-boarding (moves to week 1 in the app, due Tj)', !!signB && signB.phase === 'first_week' && signB.surface === 'app' && day(signB.dueAt) === TJ_B && signB.status === 'locked', signB);
  eq('letters on Day 1: the template’s own task says so (the editor shows it in week 1)', [tplTask(tplB, 'sign_letters').phase, tplTask(tplB, 'sign_letters').dueRule], ['first_week', { anchor: 'tj', offset: 0, unit: 'days' }]);
  ok('letters on Day 1: the board does not wait on the portal for letters (Ready to join)', vb.card?.column === 'ready_to_join', vb.card);
  ok('letters on Day 1: the portal’s home does not wait for letters either', vb.portal!.me.upNext?.key !== 'letter' && !vb.portal!.me.tasks.some((t: Json) => t.systemKey === 'sign_letters'), vb.portal!.me.upNext);
  portalToken = portalA.token;
  portalCreds = portalA.creds;
  current = 'same_truth';

  // ── Week 1 done (Tj + 7): portal stays open (month 1)
  await advanceTo(T('2027-03-29', '10:30'));
  heading('1 · Tj + 7: week 1 done; the portal stays open for month 1');
  for (const step of [['policies', { agreed: true }], ['tax', 'new'], ['bank_pf', { confirm: true }], ['goals', { read: true }]] as const) {
    await send(joinerId, 'PUT', '/lifecycle/onboarding/week1', { step: step[0], value: step[1] });
  }
  await send(joinerId, 'POST', '/lifecycle/onboarding/survey', { answers: { q1: 4, q2: 'mostly', q3: 5, q4: 'More time with the team' } });
  v = await onboardingViews(A, { joiner: joinerId, portal: true });
  compareOnboarding('Tj + 7', v, { joined: true });
  const hrSurveys = await get('hr', '/admin/lifecycle/surveys?kind=day7');
  eq('the Day-7 answers: HR sees Kabir’s; the manager no summary under 3 people (allowed difference)', [hrSurveys.responses.length, hrSurveys.responses[0]?.name, v.mgr?.detail.surveySummary ?? null], [1, 'Kabir Mehta', null]);
  eq('the manager cannot read the answers on the dashboard', (await call('mgr', 'GET', '/admin/lifecycle/surveys?kind=day7')).status, 403);
  current = 'template';
  eq('portal open until month 1: the portal still answers at Tj + 7', (await call('portal', 'GET', '/portal/me')).status, 200);
  current = 'same_truth';

  // ── Bina joins: the letters are a Day-1 task in the app
  await advanceTo(T(TJ_B, '09:30'));
  current = 'template';
  heading('2 · Letters on Day 1: Bina joins; the sign task is on her app’s Day 1');
  const joinedB = await send('hr', 'POST', `/admin/lifecycle/offers/${B}/mark-joined`, { workEmail: 'bina@el-consistency.test', employeeId: 'ELC-102' });
  await session(joinedB.userId);
  const homeB = await get(joinedB.userId, '/lifecycle/onboarding');
  const signApp = homeB.today.find((t: Json) => t.systemKey === 'sign_letters');
  ok('the app’s Today has “Sign the appointment letter and NDA”, due Day 1, must-do, with the Day-1 copy', !!signApp && day(signApp.dueAt) === TJ_B && signApp.mustDo && signApp.status === 'todo' && signApp.helper === 'With HR on your first day', signApp);
  const panelB = await get('hr', `/admin/lifecycle/journeys/${B}`);
  sameTasks('Bina on Day 1: app home', panelB.tasks, appRows(homeB), (panelB.tasks as Json[]).filter((t) => joinerSees(t) && (t.phase !== 'pre_boarding' || ACTIVE.includes(t.status))).map((t) => t.id));
  current = 'same_truth';

  // ── Month 2: the portal has closed
  await advanceTo(T('2027-04-22', '10:30'));
  heading('1 · Month 2: the portal closed into the app');
  current = 'template';
  const closedHome = await call('portal', 'GET', '/portal/me');
  await call(null, 'POST', '/portal/auth/code', { email: KABIR });
  const signInNow = await call(null, 'POST', '/portal/auth/verify', { email: KABIR, code: /^(\d{6}) is your/.exec(lastMailTo(KABIR)?.subject ?? '')?.[1] ?? '' });
  // The right code on a closed portal answers 200 with the closed screen and no session (a wrong one stays 401).
  ok('the portal closed the day the template says (a month after Tj): sign-in shows the closed screen, no session, home says closed', signInNow.status === 200 && !!signInNow.body?.closed && !signInNow.body?.token && (closedHome.status !== 200 || closedHome.body.view === 'closed'), { signIn: signInNow.status, closed: !!signInNow.body?.closed, token: !!signInNow.body?.token, home: closedHome.status === 200 ? closedHome.body.view : closedHome.status });
  current = 'same_truth';
  v = await onboardingViews(A, { joiner: joinerId });
  compareOnboarding('month 2', v, { joined: true });

  // Month 1 check-in and review (both sides), then month 2, month 3 (final)
  heading('1 · Probation: check-ins and reviews month by month');
  await send(joinerId, 'PUT', '/lifecycle/onboarding/probation/1/checkin', { text: 'A good first month', rating: 3 });
  await send('mgr', 'PUT', `/lifecycle/manager/joiners/${A}/probation/1`, { checkin: { text: 'Settling in well', rating: 4 } });
  await send('mgr', 'PUT', `/lifecycle/manager/joiners/${A}/probation/1`, { review: { text: 'Strong start', nextGoals: ['Own the leave flow'] } });
  v = await onboardingViews(A, { joiner: joinerId });
  compareOnboarding('month 1 closed', v, { joined: true });
  await advanceTo(T('2027-05-17', '11:00'));
  await send(joinerId, 'PUT', '/lifecycle/onboarding/probation/2/checkin', { text: 'Shipped the leave flow', rating: 4 });
  await send('mgr', 'PUT', `/lifecycle/manager/joiners/${A}/probation/2`, { checkin: { text: 'Great month', rating: 4 } });
  await send('mgr', 'PUT', `/lifecycle/manager/joiners/${A}/probation/2`, { review: { text: 'Keep going' } });
  await advanceTo(T('2027-05-24', '10:30'));
  heading('1 · Month 3: the final month');
  v = await onboardingViews(A, { joiner: joinerId });
  compareOnboarding('final month', v, { joined: true });
  eq('board: Final month, Decide', [v.card?.column, v.card?.flags.includes('decide')], ['final_month', true]);

  // Confirmation
  await advanceTo(T('2027-06-01', '10:30'));
  heading('1 · Confirmed, the letter, the reveal');
  await send('hr', 'POST', `/admin/lifecycle/journeys/${A}/decision`, { outcome: 'confirm', salary: 1_600_000, designation: 'Senior Product Designer', reportingToUserId: 'mgr' });
  const letterTask = (await get('hr', `/admin/lifecycle/journeys/${A}`)).tasks.find((t: Json) => t.systemKey === 'confirmation_letter');
  // The letter task can only be ticked once the confirmation letter has been sent from Documents (the reveal opens with it).
  await db.getDb().collection('lifecycle_letters').insertOne({ id: 'L-kabir-confirm', org: ORG, journeyId: A, kind: 'confirmation', templateId: 't', refNo: 'CL-1', values: {}, createdAt: new Date(), email: { to: 'kabir@example.com', subject: 'Confirmed', body: 'x', sentAt: new Date() } } as never);
  await send('hr', 'POST', `/admin/lifecycle/journeys/${A}/tasks/${letterTask.id}`, { action: 'done', note: 'Letter sent' });
  await advanceTo(T('2027-06-01', '13:30'), 'hourly');
  v = await onboardingViews(A, { joiner: joinerId });
  compareOnboarding('confirmed', v, { joined: true });
  const reveal = await get(joinerId, '/lifecycle/onboarding/reveal');
  const decisionOnb = (await get('onb', `/admin/lifecycle/journeys/${A}`)).probation.decision;
  agree('the outcome: HR’s panel, the coordinator, the manager, the joiner’s reveal', {
    hr: v.panel.probation.decision?.outcome, onb: decisionOnb?.outcome, manager: v.mgr?.detail.probation.decision?.outcome, reveal: reveal.outcome,
  });
  eq('pay: the salary shows to HR and the joiner, never to the manager or the coordinator (allowed difference)', [v.panel.probation.decision?.salary, reveal.salary, v.mgr?.detail.probation.decision?.salary ?? null, decisionOnb?.salary ?? null], [1_600_000, 1_600_000, null, null]);
  await send(joinerId, 'POST', '/lifecycle/onboarding/reveal/seen');
  ok('after the reveal: the tile and the manager’s list let go of Kabir', !(await get(joinerId, '/lifecycle/me')).onboarding?.tileVisible && !(await get('mgr', '/lifecycle/manager/joiners')).joiners.some((x: Json) => x.journeyId === A));
  ok('no job or service errors logged (onboarding)', productErrors.length === 0, productErrors.slice(0, 3));
  productErrors.length = 0;

  // ═════════════════════════════════════════════════════════════ OFFBOARDING
  await runOffboarding();

  async function runOffboarding() {
    current = 'template';
    await advanceTo(T('2027-07-02', '10:30'));
    heading('2 · Offboarding: the company’s Exit settings and the template, for notice');
    const standardOff = (await get('hr', '/admin/lifecycle/templates?kind=offboarding')).templates.find((t: Json) => t.isDefault);
    eq('Standard (made on first use) took the company’s Exit settings: 45 days', standardOff.settings.noticeDays, 45);
    let form = await get('ravi', '/lifecycle/resignation');
    eq('the resign form: Standard’s 45 days and the last day by notice', [form.noticeDays, form.lastDayByNotice], [45, addDays('2027-07-02', 45)]);
    await send('hr', 'PUT', '/admin/exit-settings', { noticeDays: 50 });
    form = await get('ravi', '/lifecycle/resignation');
    eq('REPORT · Exit settings changed to 50: the template’s 45 still wins (the template is set)', form.noticeDays, 45);
    const blank = (await send('hr', 'POST', '/admin/lifecycle/templates', { kind: 'offboarding', name: 'Blank leavers' })).template;
    eq('a new offboarding template starts from the company’s Exit settings (50), not the seed’s 60', blank.settings.noticeDays, 50);
    await send('hr', 'DELETE', `/admin/lifecycle/templates/${blank.id}`);
    let tplL = (await send('hr', 'POST', '/admin/lifecycle/templates', { kind: 'offboarding', name: 'Leavers', copyFromId: standardOff.id })).template;
    tplL = (await send('hr', 'PUT', `/admin/lifecycle/templates/${tplL.id}`, {
      settings: { noticeDays: 21, exitInterviewOpensDays: 3, accountCloses: 'tl_end_of_shift', settlementWorkingDays: 4, gratuityDays: 20, appPageFor: ['resignation', 'end_of_contract'] },
      isDefault: true,
    })).template;
    eq('Leavers: the settings are on its tasks (interview Tl − 3, settlement Tl + 4 working days, gratuity Tl + 20, close on Tl)', [
      tplTask(tplL, 'exit_interview').opensRule, tplTask(tplL, 'final_settlement').dueRule, tplTask(tplL, 'gratuity').dueRule, tplTask(tplL, 'close_account').dueRule,
    ], [{ anchor: 'tl', offset: -3, unit: 'days' }, { anchor: 'tl', offset: 4, unit: 'working_days' }, { anchor: 'tl', offset: 20, unit: 'days' }, { anchor: 'tl', offset: 0, unit: 'days' }]);
    await advanceTo(T('2027-07-05', '10:30'));
    form = await get('ravi', '/lifecycle/resignation');
    eq('the resign form: the new default’s 21 days, last day by notice Mon 26 Jul', [form.noticeDays, form.lastDayByNotice, form.canResign], [21, '2027-07-26', true]);
    const TL = form.lastDayByNotice as string;

    // Offers state a notice too: a new offer's notice defaults to the same rule.
    const offerNotice = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Nisha Notice', personalEmail: 'nisha.notice@example.com' }, fields: (({ noticeDays: _n, ...rest }) => rest)(offerFields('2027-08-02', { validTill: '2027-07-20' })) });
    eq('a new offer’s notice defaults to the notice a resignation gets (template, else Exit settings)', offerNotice.offer.fields.noticeDays, 21);

    // ═════════ the leaver
    current = 'same_truth';
    heading('1 · Ravi resigns in the app');
    await send('ravi', 'POST', '/lifecycle/resignation', { reason: 'Better opportunity', note: 'Thank you for six years.' });

    interface OffView { card: Json; cardIt: Json; drawerItStatus: number; drawer: Json; drawerIt: Json; me: Json; resignation: Json; page: Res; mgrResignations: Json; mgrLeavers: Json; mgrLeaver: Res; exitRow?: Json; exitDetail?: Json }
    async function offCard(as: string, userId: string) {
      for (const tab of ['resignations', 'notice', 'exit']) {
        const b = await get(as, `/admin/lifecycle/offboarding/board?tab=${tab}`);
        for (const col of b.columns) {
          const card = col.cards.find((c: Json) => c.userId === userId);
          if (card) return card;
        }
      }
      return null;
    }
    async function offViews(userId: string): Promise<OffView> {
      const exits = (await get('hr', '/admin/exits')).exits as Json[];
      const detail = await call('hr', 'GET', `/admin/employees/${userId}/exit`);
      const it = await call('it', 'GET', `/admin/lifecycle/offboarding/${userId}`);
      return {
        cardIt: await offCard('it', userId), drawerItStatus: it.status,
        card: await offCard('hr', userId), drawer: await get('hr', `/admin/lifecycle/offboarding/${userId}`), drawerIt: it.status === 200 ? it.body : null,
        me: await get(userId, '/lifecycle/me').catch(() => null), resignation: await get(userId, '/lifecycle/resignation').catch(() => null), page: await call(userId, 'GET', '/lifecycle/offboarding'),
        mgrResignations: await get('mgr', '/lifecycle/manager/resignations'), mgrLeavers: await get('mgr', '/lifecycle/manager/leavers'), mgrLeaver: await call('mgr', 'GET', `/lifecycle/manager/leavers/${userId}`),
        exitRow: exits.find((e) => e.userId === userId), exitDetail: detail.status === 200 ? detail.body : undefined,
      };
    }
    const OFF_TASK = ['id', 'systemKey', 'phase', 'ownerRole', 'mustDo', 'status', 'opensAt', 'dueAt', 'dueLabel', 'doneAt', 'late'];
    function sameOffTasks(label: string, hr: Json[], rows: Json[], expectIds: string[]) {
      eq(`${label}: the same tasks as HR’s drawer`, rows.map((r) => r.id).sort(), [...expectIds].sort());
      const diffs = rows.map((r) => ({ r, h: hr.find((t) => t.id === r.id) })).filter(({ r, h }) => h && (JSON.stringify(pick(h, OFF_TASK)) !== JSON.stringify(pick(r, OFF_TASK)) || h.title !== r.title))
        .map(({ r, h }) => ({ id: r.systemKey, hr: pick(h, [...OFF_TASK, 'title']), here: pick(r, [...OFF_TASK, 'title']) }));
      ok(`${label}: titles, owners, due dates, done/open, must-do agree with HR’s drawer`, diffs.length === 0, diffs.slice(0, 3));
    }
    function compareOffboarding(step: string, userId: string, v: OffView, opts: { page?: boolean } = {}) {
      heading(`   compare · ${step}`);
      const d = v.drawer;
      const mgrRes = (v.mgrResignations.resignations as Json[]).find((r) => r.userId === userId);
      const mgrLeaverRow = (v.mgrLeavers.leavers as Json[]).find((r) => r.userId === userId);
      const leaver = v.mgrLeaver.status === 200 ? v.mgrLeaver.body : null;
      const page = v.page.status === 200 ? v.page.body : null;
      // The last day
      const tl: Record<string, unknown> = { board: v.card?.tl, drawerCard: d.card?.tl, appMe: v.me?.offboarding?.tl };
      if (d.exit) Object.assign(tl, { drawerExit: d.exit.lastWorkingDay, exitsPage: v.exitRow?.lastWorkingDay, exitDetail: v.exitDetail?.exit?.lastWorkingDay });
      if (d.resignation) tl.drawerResignation = d.resignation.tl;
      if (v.resignation?.resignation) tl.appResignation = v.resignation.resignation.tl;
      if (mgrRes) tl.managerRequest = mgrRes.tl;
      if (mgrLeaverRow) tl.managerLeavers = mgrLeaverRow.tl;
      if (leaver) Object.assign(tl, { managerLeaver: leaver.tl, managerLeaverStatus: leaver.status.tl });
      if (page) tl.offboardingPage = page.tl;
      if (v.drawerIt?.card) tl.itDrawer = v.drawerIt.card.tl;
      agree(`${step}: Tl (the last day) everywhere`, tl);
      // The notice and the last day by notice
      if (d.resignation) {
        const notice: Record<string, unknown> = { drawer: [d.resignation.noticeDays, d.resignation.lastDayByNotice] };
        if (v.resignation?.resignation) notice.app = [v.resignation.resignation.noticeDays, v.resignation.resignation.lastDayByNotice];
        if (mgrRes) notice.manager = [mgrRes.noticeDays, mgrRes.lastDayByNotice];
        if (leaver?.resignation) notice.managerLeaver = [leaver.resignation.noticeDays, leaver.resignation.lastDayByNotice];
        agree(`${step}: notice and the last day by notice`, notice);
        const state: Record<string, unknown> = { drawer: d.resignation.status };
        if (v.resignation?.resignation) state.app = v.resignation.resignation.status;
        if (mgrRes) state.manager = mgrRes.status;
        if (leaver?.resignation) state.managerLeaver = leaver.resignation.status;
        if (v.me?.offboarding) state.appMe = v.me.offboarding.status;
        agree(`${step}: the resignation’s state`, state);
      }
      // Days left
      const left: Record<string, unknown> = {};
      if (page) left.page = page.daysLeft;
      if (leaver) left.managerLeaver = Math.max(0, leaver.daysLeft);
      if (mgrLeaverRow) left.managerLeavers = Math.max(0, mgrLeaverRow.daysLeft);
      if (v.resignation?.resignation?.daysLeft != null && d.exit) left.appResignation = Math.max(0, v.resignation.resignation.daysLeft);
      if (Object.keys(left).length > 1) agree(`${step}: days left`, left);
      // The page shows exactly when the template / HR says
      const visible = v.me ? !!v.me.offboarding?.pageVisible : undefined;
      if (v.me) agree(`${step}: the Off-boarding page (app /me, the page, HR’s drawer)`, { appMe: visible, page: v.page.status === 200, drawer: d.appPage });
      if (opts.page !== undefined) eq(`${step}: the page is ${opts.page ? 'shown' : 'hidden'} for this exit type`, visible ?? d.appPage, opts.page);
      // Tasks
      if (d.tasks?.length) {
        if (page) sameOffTasks(`${step}: the leaver’s page`, d.tasks, page.tasks, d.tasks.filter((t: Json) => t.status !== 'cancelled' && ['employee', 'manager_employee'].includes(t.ownerRole)).map((t: Json) => t.id));
        if (leaver) sameOffTasks(`${step}: the manager’s R8b`, d.tasks, leaver.tasks, d.tasks.filter(managerSees).map((t: Json) => t.id));
        if (v.drawerIt?.tasks) sameOffTasks(`${step}: IT’s drawer`, d.tasks, v.drawerIt.tasks, v.drawerIt.tasks.map((t: Json) => t.id));
      }
      // Handover
      const items = (list: Json[]) => list.map((h) => [h.id, h.title, h.upload ? (h.upload.url ?? h.upload.name ?? 'file') : null, h.done]);
      const handover: Record<string, unknown> = { drawer: items(d.handover?.items ?? []) };
      if (page) handover.page = items(page.handover);
      if (leaver) handover.manager = items(leaver.handover.items);
      if (Object.keys(handover).length > 1) agree(`${step}: handover items`, handover);
      if (page && leaver) agree(`${step}: the handover note, due and done`, { page: [page.handoverNote ?? '', day(page.handoverDueAt), page.handoverAddedAt ?? null, page.handoverDone, page.handoverDoneAt ?? null], manager: [leaver.handover.note ?? '', day(leaver.handover.dueAt), leaver.handover.addedAt ?? null, leaver.handover.done, leaver.handover.doneAt ?? null] });
      // Clearance
      const byTeam = (rows: Json[]) => rows.filter((c) => c.team !== 'manager').map((c) => [c.key ?? c.id, c.label, c.team, c.done]);
      const clear: Record<string, unknown> = { drawer: byTeam(d.clearance ?? []) };
      if (leaver) clear.manager = byTeam(leaver.otherSteps.map((c: Json) => ({ ...c, key: c.id })));
      if (Object.keys(clear).length > 1) agree(`${step}: clearance by team`, clear);
      if (v.drawerIt?.clearance) agree(`${step}: IT’s clearance items (its own team only — allowed)`, { drawer: byTeam((d.clearance ?? []).filter((c: Json) => c.team === 'it')), it: byTeam(v.drawerIt.clearance) });
      if (page) agree(`${step}: assets to return (the page, the drawer)`, { page: page.returnAssets.items.map((i: Json) => [i.label, i.done]), drawer: (d.clearance ?? []).filter((c: Json) => c.team === 'it' || c.team === 'admin').map((c: Json) => [c.label, c.done]) });
      // The exit interview
      if (d.interview) {
        const iv: Record<string, unknown> = { drawer: [d.interview.applies, d.interview.opensAt, d.interview.open, d.interview.sent] };
        if (page) iv.page = [page.interview.applies, page.interview.opensAt, page.interview.open, page.interview.sent];
        const task = (d.tasks as Json[] ?? []).find((t) => t.systemKey === 'exit_interview');
        if (task && d.interview.applies) iv.task = [true, day(task.opensAt), d.interview.open, d.interview.sent];
        if (Object.keys(iv).length > 1) agree(`${step}: the exit interview (opens, open, sent)`, iv);
      }
      // Allowed: pay and the interview's answers stay with HR
      if (d.exit) {
        ok(`${step}: IT sees no settlement, so no amount (allowed difference)`, v.drawerIt?.settlement === null && v.drawerIt?.viewer?.seesPay === false, [v.drawerItStatus, v.drawerIt?.settlement, v.drawerIt?.viewer]);
        agree(`${step}: IT’s board card (column, last day)`, { hr: [v.card?.column, v.card?.tl], it: [v.cardIt?.column, v.cardIt?.tl] });
      } else {
        // CONTRACT Auth: clearance staff see their items; a resignation HR has not accepted has none yet.
        eq(`${step}: IT sees nothing before HR accepts (no card, no drawer — allowed)`, [v.cardIt, v.drawerItStatus], [null, 404]);
      }
      ok(`${step}: no interview answers outside HR (allowed difference)`, !JSON.stringify([leaver, v.drawerIt, page, v.mgrResignations]).includes('Clearer growth paths'));
    }

    let ov = await offViews('ravi');
    compareOffboarding('resigned (with the manager)', 'ravi', ov);
    eq('the resignation: 21 days, last day by notice, with the manager', [ov.resignation.resignation.status, ov.resignation.resignation.noticeDays, ov.resignation.resignation.lastDayByNotice], ['with_manager', 21, TL]);
    eq('board: Resignations › With manager', ov.card?.column, 'with_manager');

    await advanceTo(T('2027-07-06', '11:00'));
    heading('1 · The manager accepts in the app');
    const resId = ov.resignation.resignation.id;
    await send('mgr', 'POST', `/lifecycle/manager/resignations/${resId}`, { action: 'accept' });
    ov = await offViews('ravi');
    compareOffboarding('with HR', 'ravi', ov);

    await advanceTo(T('2027-07-07', '11:00'));
    heading('1 · HR accepts on the dashboard (the last day by notice)');
    const acc = await send('hr', 'POST', `/admin/lifecycle/resignations/${resId}/accept`, {});
    const OR = acc.journeyId as string;
    ov = await offViews('ravi');
    compareOffboarding('accepted', 'ravi', ov, { page: true });
    current = 'template';
    eq('the journey follows the default offboarding template (Leavers)', (await journeys().findOne({ id: OR }))?.templateId, tplL.id);
    const ravTask = (key: string) => (ov.drawer.tasks as Json[]).find((t) => t.systemKey === key);
    eq('the interview opens Tl − 3 on the app and the dashboard (template)', [ov.drawer.interview?.opensAt, (ov.page.body as Json).interview?.opensAt, day(ravTask('exit_interview')?.opensAt)], [addDays(TL, -3), addDays(TL, -3), addDays(TL, -3)]);
    const settleDue = addWorking(TL, 4);
    eq('settlement due Tl + 4 working days (the holiday on Wed 28 Jul skipped): Mon 2 Aug', [day(ravTask('final_settlement')?.dueAt), settleDue], ['2027-08-02', '2027-08-02']);
    eq('gratuity due Tl + 20; access closes on Tl (end of shift)', [day(ravTask('gratuity')?.dueAt), day(ravTask('close_account')?.dueAt)], [addDays(TL, 20), TL]);
    current = 'across';
    heading('3 · The resignation’s last day is the live exit’s, the Exits page’s and the payroll hold’s');
    const rUser = await users().findOne({ userId: 'ravi' });
    eq('the live exit: resigned, Tl, notice from the day sent (payroll holds pay from then), 21 days', [rUser?.exit?.kind, rUser?.exit?.lastWorkingDay, rUser?.exit?.noticeFrom, rUser?.exit?.noticeDays, rUser?.exit?.rules?.holdPay !== false], ['resigned', TL, '2027-07-05', 21, true]);
    agree('Exits page, exit detail, the board and the app agree on the last day and the notice start', {
      exitsPage: [ov.exitRow?.lastWorkingDay, ov.exitRow?.noticeFrom ?? null], exitDetail: [ov.exitDetail?.exit?.lastWorkingDay, ov.exitDetail?.exit?.noticeFrom ?? null], drawer: [ov.drawer.exit?.lastWorkingDay, ov.drawer.exit?.noticeFrom ?? null],
      page: [(ov.page.body as Json).tl, (ov.page.body as Json).noticeFrom ?? null],
    });
    const checks = await get('hr', '/admin/lifecycle/offboarding/ravi/settlement/checks');
    eq('the settlement checks’ due day is the template’s (Tl + 4 working days)', checks.dueOn, settleDue);
    const leaveApp = await call('ravi', 'GET', '/leaves/balance');
    ok('leave balance: the lifecycle does not change it (the app still reads it on notice)', leaveApp.status === 200, leaveApp.status);
    current = 'same_truth';

    // ── Snapshot rule for offboarding
    current = 'template';
    heading('2 · The snapshot rule (offboarding): Leavers edited while Ravi’s exit runs');
    await send('hr', 'PUT', `/admin/lifecycle/templates/${tplL.id}`, { settings: { exitInterviewOpensDays: 7 } });
    ov = await offViews('ravi');
    eq('REPORT · Ravi keeps the snapshot: the interview still opens Tl − 3 on the drawer, the page and the task', [ov.drawer.interview?.opensAt, (ov.page.body as Json).interview?.opensAt], [addDays(TL, -3), addDays(TL, -3)]);
    await send('hr', 'PUT', `/admin/lifecycle/templates/${tplL.id}`, { settings: { exitInterviewOpensDays: 3 } });
    current = 'same_truth';

    // ── Handover
    await advanceTo(T('2027-07-08', '10:00'));
    heading('1 · Handover: the manager’s checklist, Ravi’s uploads');
    await send('mgr', 'PUT', '/lifecycle/manager/leavers/ravi/handover', { items: ['Design system file', 'Open projects'], note: 'Please share by the 20th.' });
    ov = await offViews('ravi');
    compareOffboarding('checklist shared', 'ravi', ov);
    await advanceTo(T('2027-07-12', '11:00'));
    for (const item of (ov.page.body as Json).handover) await send('ravi', 'POST', `/lifecycle/offboarding/handover/${item.id}`, { url: `https://docs.example/${item.id}` });
    ov = await offViews('ravi');
    compareOffboarding('handover uploaded', 'ravi', ov);

    // ── Clearance: IT ticks its item; HR the rest
    await advanceTo(T('2027-07-14', '11:00'));
    heading('1 · Clearance by team (IT on its own drawer)');
    const itRow = (ov.drawerIt.clearance as Json[]).find((c) => c.team === 'it' && c.canTick);
    if (ok('IT can tick its own clearance item', !!itRow, ov.drawerIt.clearance)) await send('it', 'PUT', '/admin/lifecycle/offboarding/ravi/clearance', { key: itRow.key, done: true });
    for (const c of ((await get('hr', '/admin/lifecycle/offboarding/ravi')).clearance as Json[]).filter((x) => !x.done && x.team !== 'manager')) {
      await send('hr', 'PUT', '/admin/lifecycle/offboarding/ravi/clearance', { key: c.key, done: true });
    }
    ov = await offViews('ravi');
    compareOffboarding('clearance done', 'ravi', ov);

    // ── HR-started exits
    heading('2 · HR-started exits on the template: the app page per exit type');
    current = 'template';
    await send('hr', 'POST', '/admin/lifecycle/offboarding/omar/start', { exitType: 'retirement', lastWorkingDay: '2027-07-30', noticeHandling: 'served', tellManagerNow: true });
    await send('hr', 'POST', '/admin/lifecycle/offboarding/esha2/start', { exitType: 'end_of_contract', lastWorkingDay: '2027-07-30', noticeHandling: 'not_applicable', templateId: standardOff.id, tellManagerNow: true });
    await send('hr', 'POST', '/admin/lifecycle/offboarding/tara/start', { exitType: 'termination', lastWorkingDay: '2027-07-23', noticeHandling: 'paid_in_lieu', hrNote: 'Policy breach' });
    current = 'same_truth';
    const omar = await offViews('omar');
    compareOffboarding('Omar (retirement, Leavers)', 'omar', omar, { page: false });
    const esha = await offViews('esha2');
    compareOffboarding('Esha (end of contract, Standard)', 'esha2', esha, { page: true });
    const tara = await offViews('tara');
    compareOffboarding('Tara (termination, Leavers)', 'tara', tara, { page: false });
    current = 'template';
    eq('the exit interview does not apply to an end of contract (page shown, no interview)', [esha.drawer.interview?.applies ?? false, (esha.page.body as Json)?.interview?.applies], [false, false]);
    eq('the template each journey follows', [(await journeys().findOne({ id: omar.drawer.card.journeyId }))?.templateId, (await journeys().findOne({ id: esha.drawer.card.journeyId }))?.templateId], [tplL.id, standardOff.id]);
    eq('Esha (Standard): settlement Tl + 2 working days, close Tl + 1', [day(esha.drawer.tasks.find((t: Json) => t.systemKey === 'final_settlement')?.dueAt), day(esha.drawer.tasks.find((t: Json) => t.systemKey === 'close_account')?.dueAt)], [addWorking('2027-07-30', 2), '2027-07-31']);
    current = 'same_truth';

    // ── Tl − 3: the interview opens
    await advanceTo(T('2027-07-23', '10:30'), 'hourly');
    heading('1 · Tl − 3: the exit interview opens (app and dashboard)');
    ov = await offViews('ravi');
    compareOffboarding('interview open', 'ravi', ov);
    eq('open on both', [ov.drawer.interview?.open, (ov.page.body as Json).interview.open], [true, true]);
    const pushes = await notifications().find({ userId: 'ravi', scenario: 'lifecycle_exit_interview_open' }).toArray();
    eq('one push, on Tl − 3', pushes.map((p) => istKey(p.createdAt)), [addDays(TL, -3)]);
    await send('ravi', 'POST', '/lifecycle/offboarding/interview', { reason: 'Growth', workingHere: 4, manager: 4, comeBack: 'maybe', change: 'Clearer growth paths' });
    await send('mgr', 'POST', '/lifecycle/manager/leavers/ravi/handover/done');
    ov = await offViews('ravi');
    compareOffboarding('interview sent, handover done', 'ravi', ov);

    // ── Tl: end of shift closes access (Leavers); Omar the same day? Omar's Tl is 30 Jul.
    await advanceTo(T(TL, '17:30'), 'hourly');
    current = 'template';
    heading('2 · Tl: the account closes at the end of the shift (Leavers)');
    ok('17:30 on the last day: still in', (await call('ravi', 'GET', '/lifecycle/me')).status === 200);
    await advanceTo(T(TL, '18:30'), 'hourly');
    const raviAfter = await users().findOne({ userId: 'ravi' });
    ok('18:00 on the last day: access ended (end of shift), not at Tl + 1', !!raviAfter?.exit?.accessEndedAt && istKey(raviAfter.exit.accessEndedAt) === TL, raviAfter?.exit?.accessEndedAt);
    eq('the app refuses Ravi now', (await call('ravi', 'GET', '/lifecycle/me')).status, 401);
    current = 'same_truth';

    // Esha (Standard, Tl + 1) and Omar (Leavers, end of shift) on 30 Jul
    await advanceTo(T('2027-07-30', '18:30'), 'hourly');
    current = 'template';
    const omarU = await users().findOne({ userId: 'omar' });
    const eshaU = await users().findOne({ userId: 'esha2' });
    eq('30 Jul 18:30: Omar (Leavers) closed at the end of his shift; Esha (Standard) still in until Tl + 1', [!!omarU?.exit?.accessEndedAt, !!eshaU?.exit?.accessEndedAt], [true, false]);
    await advanceTo(T('2027-07-31', '00:30'), 'hourly');
    const eshaU2 = await users().findOne({ userId: 'esha2' });
    ok('31 Jul 00:00: Esha’s access ended at Tl + 1', !!eshaU2?.exit?.accessEndedAt && istKey(eshaU2.exit.accessEndedAt) === '2027-07-31', eshaU2?.exit?.accessEndedAt);
    current = 'same_truth';

    // ── Settlement due on the template's day
    await advanceTo(T(addDays(settleDue, -1), '23:30'));
    current = 'template';
    heading('2 · Settlement due: Tl + 4 working days');
    ok('the day before: not yet settlement due', (await journeys().findOne({ id: OR }))?.status !== 'settlement_due', (await journeys().findOne({ id: OR }))?.status);
    await advanceTo(T(settleDue, '09:30'));
    eq('on the day: settlement due (journey, board)', [(await journeys().findOne({ id: OR }))?.status, (await offCard('hr', 'ravi'))?.column, (await offCard('hr', 'ravi'))?.due], ['settlement_due', 'settlement_due', settleDue]);
    current = 'same_truth';
    ov = await offViews('ravi');
    compareOffboarding('settlement due', 'ravi', ov);

    // ── The settlement statement: the dashboard's amount is the emailed one
    current = 'across';
    heading('3 · The settlement statement: the dashboard’s amount is the amount emailed');
    let settlement = await exitSettlements().findOne({ org: ORG, userId: 'ravi' });
    if (!settlement) {
      await exitSettlements().insertOne({ org: ORG, userId: 'ravi', status: 'draft', lines: [{ key: 'gratuity', side: 'earning', label: 'Gratuity', computedPaise: 9_000_00, amountPaise: 9_000_00 }], earningsPaise: 9_000_00, deductionsPaise: 0, payablePaise: 9_000_00, createdAt: new Date(), updatedAt: new Date() } as never);
    }
    const approved = await call('hr', 'POST', '/admin/employees/ravi/exit/settlement/approve', { clearanceOverrideReason: 'Consistency test' });
    if (approved.status !== 200) await exitSettlements().updateOne({ org: ORG, userId: 'ravi' }, { $set: { status: 'approved', approvedAt: new Date() } });
    // Written straight to the database above (not through the API): the kept boards would not know.
    readCache.forgetLifecycleReads(ORG);
    settlement = await exitSettlements().findOne({ org: ORG, userId: 'ravi' });
    const exitDetail = await get('hr', '/admin/employees/ravi/exit');
    const drawerS = (await get('hr', '/admin/lifecycle/offboarding/ravi')).settlement;
    agree('the statement’s amount: the exit detail (what the PDF is made from), the drawer, the settlement', { exitDetail: exitDetail.settlement?.payablePaise, drawer: drawerS?.payablePaise, stored: settlement?.payablePaise });
    // The dashboard makes the PDF from the exit detail (settlementDoc.ts) and sends it as base64.
    const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const amountLine = `Net payable ${money(exitDetail.settlement.payablePaise)}`;
    const pdf = Buffer.concat([PDF('settlement'), Buffer.from(`\n% ${amountLine}\n`.padEnd(200, ' '))]);
    drain(); mail.length = 0;
    await send('hr', 'POST', '/admin/lifecycle/offboarding/ravi/settlement/email', { pdfBase64: pdf.toString('base64'), to: 'ravi.menon@example.com', overrideReason: 'No payroll run in the consistency test' });
    drain();
    const sentMail = mail.find((m) => m.to === 'ravi.menon@example.com');
    const attached = sentMail?.attachments?.[0]?.content as Buffer | undefined;
    ok('the emailed PDF carries the dashboard’s amount, byte for byte', !!attached && Buffer.from(attached).includes(Buffer.from(amountLine)), { amountLine, attachments: sentMail?.attachments?.length });
    const afterSend = await get('hr', '/admin/lifecycle/offboarding/ravi');
    eq('the drawer records the email (to, settlement sent)', [afterSend.settlement?.emailedTo, afterSend.card.column], ['ravi.menon@example.com', 'settlement_sent']);
    current = 'same_truth';

    // ── Gratuity on the template's day (Tl + 20)
    current = 'template';
    heading('2 · Gratuity due: Tl + 20 (template), not the seed’s Tl + 30');
    await advanceTo(T(addDays(TL, 19), '23:30'));
    eq('the day before Tl + 20: no gratuity push', (await notifications().countDocuments({ scenario: 'lifecycle_gratuity_due', 'data.userId': 'ravi' })), 0);
    await advanceTo(T(addDays(TL, 20), '13:30'));
    const grat = await notifications().find({ scenario: 'lifecycle_gratuity_due', 'data.userId': 'ravi' }).toArray();
    ok('on Tl + 20: the gratuity push to the clearance staff, once each', grat.length > 0 && grat.every((p) => istKey(p.createdAt) === addDays(TL, 20)) && new Set(grat.map((p) => p.userId)).size === grat.length, grat.map((p) => [p.userId, istKey(p.createdAt)]));
    eq('the board’s gratuity step is due the same day', (await offCard('hr', 'ravi'))?.due, addDays(TL, 20));
    current = 'same_truth';

    // ── Closed
    await advanceTo(T(addDays(TL, 21), '11:00'));
    heading('1 · Closed');
    await send('hr', 'POST', '/admin/lifecycle/offboarding/ravi/tasks/gratuity', { action: 'done' });
    await send('hr', 'POST', '/admin/lifecycle/offboarding/ravi/tasks/relieving_letter', { action: 'done' });
    await send('hr', 'POST', '/admin/lifecycle/offboarding/ravi/close', {});
    const closedDrawer = await get('hr', '/admin/lifecycle/offboarding/ravi');
    agree('closed: the board and the drawer', { board: (await offCard('hr', 'ravi'))?.column, drawer: closedDrawer.card.column });
    eq('the manager’s lists let go of Ravi', [(await get('mgr', '/lifecycle/manager/leavers')).leavers.some((l: Json) => l.userId === 'ravi'), (await get('mgr', '/lifecycle/manager/resignations')).resignations.some((r: Json) => r.userId === 'ravi')], [false, false]);
    ok('no job or service errors logged (offboarding)', productErrors.length === 0, productErrors.slice(0, 3));
  }

  // ═════════════════════════════════════════════════════════════ 4 · KEPT READS
  {
    current = 'across';
    heading('4 · Kept reads: the boards and Suwi\u2019s notices come from memory, and every write is seen by the next read');
    const boardSvc = await import('../services/lifecycle/board');
    const notices = await import('../suwi/notices');
    const tools = await import('../suwi/tools');
    const hrUser = await users().findOne({ userId: 'hr' });
    const today = istKey(new Date());
    const ctx = () => tools.contextFor(hrUser as never, {} as never, today);
    const cardsOf = (b: Json) => (b.columns as Json[]).flatMap((c) => c.cards as Json[]);
    const offCards = async () => (await Promise.all(['resignations', 'notice', 'exit'].map((tab) => get('hr', `/admin/lifecycle/offboarding/board?tab=${tab}`)))).flatMap(cardsOf);

    // Kept: the same data comes back until something is written.
    await get('hr', '/admin/lifecycle/board?tab=pre_boarding');
    ok('the onboarding board data is kept between reads', (await boardSvc.boardData(ORG)) === (await boardSvc.boardData(ORG)));
    await get('hr', '/admin/lifecycle/offboarding/board?tab=notice');
    ok('the offboarding board data is kept between reads', (await off.offBoardData(ORG)) === (await off.offBoardData(ORG)));
    const n1 = await notices.suwiNotices(ctx());
    ok('Suwi\u2019s notices are kept between reads', n1 === (await notices.suwiNotices(ctx())));

    // An offer made through the API: the board, the counts, the Documents picker and Suwi see it at once.
    const before = await get('hr', '/admin/lifecycle/board?tab=pre_boarding');
    const countsBefore = await get('hr', '/admin/lifecycle/counts');
    const pickBefore = await get('hr', '/admin/lifecycle/joiners');
    const made = await send('hr', 'POST', '/admin/lifecycle/offers', {
      candidate: { name: 'Kavi Cache', personalEmail: 'kavi.cache@example.com' },
      fields: { designation: 'Designer', department: 'Design', location: 'Bengaluru', ctc: 1_000_000, tj: addDays(today, 35), managerUserId: 'mgr', probationMonths: 3, noticeDays: 30, validTill: addDays(today, 10), employeeType: 'full_time', allowNonWorkingDay: true },
    });
    const K = made.journeyId as string;
    const after = await get('hr', '/admin/lifecycle/board?tab=pre_boarding');
    eq('a new draft offer is on the board at the next read', [cardsOf(before).some((c) => c.journeyId === K), cardsOf(after).some((c) => c.journeyId === K), after.counts.pre_boarding - before.counts.pre_boarding], [false, true, 1]);
    const countsAfter = await get('hr', '/admin/lifecycle/counts');
    eq('the sidebar count moves with it (a draft waits on HR)', countsAfter.onboarding.needsYou - countsBefore.onboarding.needsYou, 1);
    const pickAfter = await get('hr', '/admin/lifecycle/joiners');
    eq('the Documents page\u2019s joiner picker has it too', [pickBefore.joiners.some((j: Json) => j.journeyId === K), pickAfter.joiners.some((j: Json) => j.journeyId === K)], [false, true]);
    ok('Suwi\u2019s notices are worked out again after the write', (await notices.suwiNotices(ctx())) !== n1);

    // Edited through the API: the card changes at the next read.
    eq('the card names the offer\u2019s manager', cardsOf(await get('hr', '/admin/lifecycle/board?tab=pre_boarding')).find((c) => c.journeyId === K)?.managerName, 'Neha Rao');
    await send('hr', 'PUT', `/admin/lifecycle/journeys/${K}`, { managerUserId: 'hr' });
    const edited = cardsOf(await get('hr', '/admin/lifecycle/board?tab=pre_boarding')).find((c) => c.journeyId === K);
    eq('an edit (a new manager) shows on the card at the next read', edited?.managerName, 'Hema HR');

    // An exit started through the API: the offboarding board and its count see it at once.
    await users().insertOne({ userId: 'cachey', name: 'Cara Cache', email: 'cachey@el-consistency.test', org: ORG, lifecycleStatus: 'active', role: 'employee', employeeId: 'ELC-C', department: 'Design', designation: 'Designer', managerUserId: 'mgr', joiningDate: new Date('2022-01-03T00:00:00Z') } as never);
    eq('before: not on the offboarding board', (await offCards()).some((c) => c.userId === 'cachey'), false);
    const keptOff = await off.offBoardData(ORG);
    await send('hr', 'POST', '/admin/lifecycle/offboarding/cachey/start', { exitType: 'retirement', lastWorkingDay: addDays(today, 40), noticeHandling: 'served', tellManagerNow: true });
    eq('an exit started through the API is on the offboarding board at the next read', (await offCards()).some((c) => c.userId === 'cachey'), true);
    ok('the offboarding board and its count are worked out from the new data', (await off.offBoardData(ORG)) !== keptOff && (await get('hr', '/admin/lifecycle/offboarding/count')).count !== undefined);

    // The slim reads (no template task list, no long task texts) give exactly the boards whole documents give.
    for (const tab of ['pre_boarding', 'first_week', 'probation'] as const) {
      const at = new Date();
      eq(`slim read = full read: onboarding board, ${tab}`, JSON.stringify(await boardSvc.onboardingBoard(ORG, 'hr', { tab }, at, { fresh: true })), JSON.stringify(await boardSvc.onboardingBoard(ORG, 'hr', { tab }, at, { full: true })));
    }
    eq('slim read = full read: onboarding counts', JSON.stringify(await boardSvc.onboardingCounts(ORG, new Date(), { fresh: true })), JSON.stringify(await boardSvc.onboardingCounts(ORG, new Date(), { full: true })));
    for (const tab of ['resignations', 'notice', 'exit']) {
      const at = new Date();
      eq(`slim read = full read: offboarding board, ${tab}`, JSON.stringify(await off.offboardingBoard('hr', { tab }, at, { fresh: true })), JSON.stringify(await off.offboardingBoard('hr', { tab }, at, { full: true })));
    }
    eq('slim read = full read: offboarding count', JSON.stringify(await off.offboardingCount('hr', new Date(), { fresh: true })), JSON.stringify(await off.offboardingCount('hr', new Date(), { full: true })));

    // The manager home (GET /manager/workspace): the company roster is kept, today's punches never are.
    const wsTeam = async () => (await get('mgr', '/manager/workspace')).team as Json[];
    const member = (await wsTeam()).find((m) => m.reportsToViewer && !m.isSelf && !m.punchIn);
    ok('the manager home lists a report not punched in yet', !!member, (await wsTeam()).map((m) => [m.name, m.punchIn]));
    if (member) {
      const who = await users().findOne({ userId: member.userId as string });
      const day = new Date().toISOString().slice(0, 10);
      // Written the way a punch lands (not a dashboard request): nothing to drop, and the next read still shows it.
      await db.attendanceRecords().insertOne({ org: ORG, userId: who!.userId, employeeId: who!.employeeId, workDate: day, punchIn: new Date(), source: 'manual', sourceKey: `cache-check|${who!.userId}|${day}` } as never);
      eq('a punch is on the very next read of the manager home', Boolean((await wsTeam()).find((m) => m.userId === member.userId)?.punchIn), true);
      // HR may edit people only with this switch (People › Accesses); granted here as setup.
      await users().updateOne({ userId: 'hr' }, { $set: { canEditEmployeeDetails: true } });
      await send('hr', 'PATCH', `/admin/employees/${member.userId}`, { designation: 'Cache tester' });
      eq('HR\u2019s change to a report (through the API) is on the next read of the manager home', (await wsTeam()).find((m) => m.userId === member.userId)?.designation, 'Cache tester');
    }

    // A day job (no request) changes a journey: the next read sees it.
    const jobsBefore = await boardSvc.boardData(ORG);
    await jobs.runLifecycleJobs(new Date(), { full: true });
    ok('a full run of the lifecycle jobs drops the kept board data', (await boardSvc.boardData(ORG)) !== jobsBefore);
  }

  // ═════════════════════════════════════════════════════════════ 5 · SUITE FIXES (18 Nov)
  {
    const boardSvc = await import('../services/lifecycle/board');
    const swr = await import('../services/swr-cache');
    const writeTrack = await import('../config/writeTrack');
    const today = istKey(new Date());
    const TABS3 = ['pre_boarding', 'first_week', 'probation'] as const;
    const cardsIn = (b: Json) => ((b?.columns ?? []) as Json[]).flatMap((c) => c.cards as Json[]);
    /** Kept (patched) = a whole read: every tab, the counts and the joiner picker, at one instant. */
    async function keptIsWhole(label: string) {
      const at = new Date();
      const kept: Json[] = []; const whole: Json[] = [];
      for (const tab of TABS3) {
        kept.push(await boardSvc.onboardingBoard(ORG, 'hr', { tab }, at));
        whole.push(await boardSvc.onboardingBoard(ORG, 'hr', { tab }, at, { fresh: true }));
      }
      kept.push(await boardSvc.onboardingCounts(ORG, at), await boardSvc.boardJoiners(ORG, at));
      whole.push(await boardSvc.onboardingCounts(ORG, at, { fresh: true }), await boardSvc.boardJoiners(ORG, at, { fresh: true }));
      eq(`${label}: the kept board, counts and joiner list are exactly what a whole read gives`, JSON.stringify(kept), JSON.stringify(whole));
    }

    current = 'across';
    heading('5 · claudeA-slow-board / claude-B-board-10s / claudeA-documents-page-slow: a write patches the kept board data, it is not read again whole');
    await get('hr', '/admin/lifecycle/board?tab=pre_boarding');
    const kept0 = await boardSvc.boardData(ORG);
    const other = kept0.all.find((j) => (kept0.tasksBy.get(j.id)?.length ?? 0) > 0)!;
    ok('there is a journey on the board to watch (one the writes below do not touch)', !!other);
    // Bytes the database sends back, per command (the link to production moves ~100 KB/s).
    const { BSON } = await import('mongodb');
    const started = new Map<number, string>();
    let traffic: { bytes: number; rows: string[] } | null = null;
    db.dbClient()!.on('commandStarted', (e) => { started.set(e.requestId, `${e.commandName} ${String((e.command as Json)[e.commandName] ?? '')}`); });
    db.dbClient()!.on('commandSucceeded', (e) => {
      const what = started.get(e.requestId) ?? e.commandName; started.delete(e.requestId);
      if (!traffic) return;
      const n = BSON.calculateObjectSize(e.reply as Json);
      traffic.bytes += n; traffic.rows.push(`${what} ${n}`);
    });
    const measure = async <T>(fn: () => Promise<T>) => {
      traffic = { bytes: 0, rows: [] };
      const t0 = RealDate.now();
      const value = await fn();
      const out = { value, bytes: traffic.bytes, rows: traffic.rows, ms: RealDate.now() - t0 };
      traffic = null;
      return out;
    };
    const whole = await measure(() => boardSvc.boardData(ORG, new Date(), { fresh: true }));

    // A new offer draft through the API (as the dashboard saves it), then the board, counts and joiners.
    const draft = await measure(() => send('hr', 'POST', '/admin/lifecycle/offers', {
      candidate: { name: 'Pia Patch', personalEmail: 'pia.patch@example.com' },
      fields: { designation: 'Designer', department: 'Design', location: 'Bengaluru', ctc: 1_000_000, tj: addDays(today, 40), managerUserId: 'mgr', probationMonths: 3, noticeDays: 30, validTill: addDays(today, 12), employeeType: 'full_time', allowNonWorkingDay: true },
    }));
    const P = draft.value.journeyId as string;
    // Each of these is ~17 KB (a journey with its template snapshot) and ~20 KB (its tasks) here, more in a real company.
    const bigReads = (rows: string[], coll: string) => rows.filter((r) => r.startsWith(`find ${coll} `) && Number(r.split(' ').at(-1)) > 5_000).length;
    const heaviest = (rows: string[]) => [...rows].sort((a, b) => Number(b.split(' ').at(-1)) - Number(a.split(' ').at(-1))).slice(0, 6).join(' · ');
    say(`  ·    saving an offer draft: ${draft.bytes} bytes back from the database in ${draft.rows.length} commands, ${draft.ms} ms (heaviest: ${heaviest(draft.rows)})`);
    eq('saving an offer draft reads the new journey and its tasks at most once each (lean writes)', [bigReads(draft.rows, 'lifecycle_journeys') <= 1, bigReads(draft.rows, 'lifecycle_journey_tasks') <= 1], [true, true]);
    const firstRead = await measure(() => get('hr', '/admin/lifecycle/board?tab=pre_boarding'));
    say(`  ·    the first board read after it: ${firstRead.bytes} bytes (a whole read of the board data: ${whole.bytes} bytes)`);
    ok('the first board read after a write reads only the written journey (under half of a whole read)', firstRead.bytes < whole.bytes / 2, { first: firstRead.bytes, whole: whole.bytes, rows: firstRead.rows.slice(0, 12) });
    const kept1 = await boardSvc.boardData(ORG);
    eq('the new draft is on the kept board; a journey nobody wrote keeps its kept tasks (not read again)', [kept1.all.some((j) => j.id === P), kept1.tasksBy.get(other.id) === kept0.tasksBy.get(other.id)], [true, true]);
    ok('the writer sees it at once: the draft is on the board the very next read', cardsIn(firstRead.value).some((c) => c.journeyId === P));
    eq('the Documents picker has it at once too', (await get('hr', '/admin/lifecycle/joiners')).joiners.some((j: Json) => j.journeyId === P), true);
    await keptIsWhole('after an offer draft');

    // Saving the draft again (the offer form's Save): a revise by journey id.
    const revised = await measure(() => send('hr', 'PUT', `/admin/lifecycle/offers/${P}`, { fields: { designation: 'Senior Designer', department: 'Design', location: 'Bengaluru', ctc: 1_100_000, tj: addDays(today, 41), managerUserId: 'mgr', probationMonths: 3, noticeDays: 30, validTill: addDays(today, 12), employeeType: 'full_time', allowNonWorkingDay: true } }));
    say(`  ·    saving the draft again (new date): ${revised.bytes} bytes back in ${revised.rows.length} commands, ${revised.ms} ms (heaviest: ${heaviest(revised.rows)})`);
    eq('saving the draft again reads the journey and its tasks at most once each', [bigReads(revised.rows, 'lifecycle_journeys') <= 1, bigReads(revised.rows, 'lifecycle_journey_tasks') <= 1], [true, true]);
    const revCard = cardsIn(await get('hr', '/admin/lifecycle/board?tab=pre_boarding')).find((c) => c.journeyId === P);
    eq('the revised draft on the board: its new role and day', [revCard?.designation, revCard?.tj], ['Senior Designer', addDays(today, 41)]);
    await keptIsWhole('after a revised draft');

    // A task done by its own id (the panel's tick), traced to its journey.
    const panelP = await get('hr', `/admin/lifecycle/journeys/${P}`);
    const hrTask = (panelP.tasks as Json[]).find((t) => ACTIVE.includes(t.status) && t.ownerRole === 'hr' && t.systemKey !== 'send_offer');
    if (hrTask) {
      await send('hr', 'POST', `/admin/lifecycle/journeys/${P}/tasks/${hrTask.id}`, { action: 'done', note: 'Patch check' });
      await keptIsWhole('after a task ticked on the panel');
    }
    // A write to people (a manager's name): the names are read again.
    await users().updateOne({ userId: 'hr' }, { $set: { canEditEmployeeDetails: true } });
    await send('hr', 'PATCH', '/admin/employees/mgr', { name: 'Neha Rao-Patch' });
    eq('a renamed manager shows on the kept board at the next read', cardsIn(await get('hr', '/admin/lifecycle/board?tab=pre_boarding')).find((c) => c.journeyId === P)?.managerName, 'Neha Rao-Patch');
    await keptIsWhole('after a name change');
    await send('hr', 'PATCH', '/admin/employees/mgr', { name: 'Neha Rao' });
    // A write that touches none of the board's records leaves the kept data alone.
    const kept2 = await boardSvc.boardData(ORG);
    await send('hr', 'PUT', '/admin/exit-settings', { noticeDays: 50 });
    ok('a write to nothing the board is built from (Exit settings) keeps the kept board data as it is', (await boardSvc.boardData(ORG)) === kept2);
    // A write that names no journey cannot be patched: the kept data is dropped, as before.
    await new Promise<void>((resolve) => {
      const res = { locals: {}, end: () => { resolve(); return res; } };
      const req = { method: 'POST', path: '/admin/lifecycle/anything', auth: { user: { org: ORG } } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => {
        void journeys().updateMany({ org: ORG, kind: 'no-such-kind' as never }, { $set: { updatedAt: new Date() } }).then(() => (res as { end: () => unknown }).end());
      });
    });
    eq('a write whose filter names no journey drops the kept board data (never patched on a guess)', swr.peekSwr(ORG, 'lc-board-data', null), undefined);
    await keptIsWhole('after a drop');
    // A write still running after the answer went out (left unawaited) patches again when it lands.
    await get('hr', '/admin/lifecycle/board?tab=pre_boarding');
    await new Promise<void>((resolve) => {
      const res = { locals: {}, end: () => res };
      const req = { method: 'POST', path: '/admin/lifecycle/anything', auth: { user: { org: ORG } } };
      readCache.forgetReadsOnWrite(req as never, res as never, () => {
        (res as { end: () => unknown }).end();
        void journeys().updateOne({ id: P }, { $set: { designation: 'Late Designer' } }).then(() => setTimeout(resolve, 20));
      });
    });
    eq('a write that lands after the answer still reaches the kept board', cardsIn(await get('hr', '/admin/lifecycle/board?tab=pre_boarding')).find((c) => c.journeyId === P)?.designation, 'Late Designer');
    const { types } = await import('node:util');
    ok('outside a write request the collections are not wrapped (no cost on reads, scripts and jobs)', !types.isProxy(journeys()) && !types.isProxy(users()));
    ok('inside one they are (what it writes is noted)', writeTrack.trackWrites(writeTrack.noWrites(), () => types.isProxy(journeys()) && types.isProxy(journeyTasks()) && types.isProxy(users())));

    // ═══ X1-1 · C-portal-disabled-meet: a template without Meet us has no Team step on the portal
    current = 'template';
    heading('5 · C-portal-disabled-meet: the portal path follows the template (Meet us off: no Team step)');
    const standard = (await get('hr', '/admin/lifecycle/templates?kind=onboarding')).templates.find((t: Json) => t.isDefault);
    let noMeetTpl = (await send('hr', 'POST', '/admin/lifecycle/templates', { kind: 'onboarding', name: 'No Meet us', copyFromId: standard.id })).template;
    noMeetTpl = (await send('hr', 'PUT', `/admin/lifecycle/templates/${noMeetTpl.id}`, { tasks: (noMeetTpl.tasks as Json[]).map((t) => (t.systemKey === 'meet_us' ? { ...t, enabled: false } : t)) })).template;
    eq('saved: Meet us is off in the template', (noMeetTpl.tasks as Json[]).find((t) => t.systemKey === 'meet_us')?.enabled, false);
    const MIRA = 'mira.nomeet@example.com';
    const nm = await send('hr', 'POST', '/admin/lifecycle/offers', { candidate: { name: 'Mira Nomeet', personalEmail: MIRA }, fields: { designation: 'Designer', department: 'Design', location: 'Bengaluru', ctc: 900_000, tj: addDays(today, 30), managerUserId: 'mgr', probationMonths: 3, noticeDays: 30, validTill: addDays(today, 10), employeeType: 'full_time', allowNonWorkingDay: true }, templateId: noMeetTpl.id });
    await send('hr', 'POST', `/admin/lifecycle/offers/${nm.journeyId}/pdf`, undefined, pdfForm('Offer - Mira.pdf'));
    await send('hr', 'POST', `/admin/lifecycle/offers/${nm.journeyId}/send`, { subject: 'Your offer', body: 'Hello Mira' });
    await send(null, 'POST', `/portal/offer/${tokenIn(lastMailTo(MIRA)!.html)}/accept`);
    await send('hr', 'POST', `/admin/lifecycle/offers/${nm.journeyId}/finalise`);
    const savedPortal = { token: portalToken, creds: portalCreds };
    portalCreds = { email: MIRA };
    portalToken = (await portalSignIn(MIRA)) ?? '';
    const miraHome = await get('portal', '/portal/me');
    const miraTasks = (await get('hr', `/admin/lifecycle/journeys/${nm.journeyId}`)).tasks as Json[];
    eq('the journey has no Meet us task', miraTasks.some((t) => t.systemKey === 'meet_us'), false);
    eq('the portal path leaves the Team step out (offer, docs, about, [letter,] pass)', (miraHome.path as Json[]).map((s) => s.key), ['offer', 'docs', 'about', ...(noMeetTpl.settings.signLettersOnDay1 ? [] : ['letter']), 'pass']);
    ok('Up next is never the Team step', miraHome.upNext?.key !== 'meet', miraHome.upNext);

    // ═══ L7-3 · claudeA-pass-403: a pass not open yet is a normal answer
    heading('5 · claudeA-pass-403: GET /portal/pass before it opens answers 200 with when it opens');
    const locked = await call('portal', 'GET', '/portal/pass');
    eq('before Tj − 7: 200 { state: locked, opensOn: Tj − 7 }', [locked.status, locked.body.state, locked.body.opensOn], [200, 'locked', addDays(miraHome.tj, -7)]);
    ok('the locked answer carries none of the pass (no place, agenda or names)', !('agenda' in locked.body) && !('managerName' in locked.body) && !('date' in locked.body), locked.body);
    ok('the .ics stays refused until the pass opens', (await call('portal', 'GET', '/portal/pass.ics')).status === 403);
    portalToken = savedPortal.token; portalCreds = savedPortal.creds;

    // ═══ EO-10 · C-successor-open-resignation: a leaving manager's team move takes their reports' open resignations
    current = 'across';
    heading('5 · C-successor-open-resignation: the team move takes the reports’ open resignations to the new manager');
    await users().insertMany([
      person('zlead', 'Zoya Lead', { role: 'manager', employeeId: 'ELC-ZL', department: 'Design', designation: 'Lead' }),
      person('zrep', 'Zane Report', { employeeId: 'ELC-ZR', department: 'Design', designation: 'Designer', managerUserId: 'zlead' }),
      person('zrep2', 'Zia Report', { employeeId: 'ELC-ZR2', department: 'Design', designation: 'Designer', managerUserId: 'zlead' }),
    ] as never[]);
    for (const id of ['zlead', 'zrep', 'zrep2']) await session(id);
    await send('zrep', 'POST', '/lifecycle/resignation', { reason: 'Growth' });
    await send('zrep2', 'POST', '/lifecycle/resignation', { reason: 'Relocation' });
    // zrep2's goes on to HR (the manager accepted), still open.
    const cardsOf = async (who: string) => ((await get(who, '/lifecycle/manager/resignations')).resignations as Json[]).map((r) => r.userId).filter((u) => u === 'zrep' || u === 'zrep2').sort();
    const zrep2Res = ((await get('zlead', '/lifecycle/manager/resignations')).resignations as Json[]).find((r) => r.userId === 'zrep2');
    await send('zlead', 'POST', `/lifecycle/manager/resignations/${zrep2Res.id}`, { action: 'accept' });
    eq('before: both cards are the leaving manager’s, none the new manager’s', [await cardsOf('zlead'), await cardsOf('mgr')], [['zrep', 'zrep2'], []]);
    await send('zlead', 'POST', '/lifecycle/resignation', { reason: 'Personal' });
    const leadRes = await db.resignations().findOne({ org: ORG, userId: 'zlead', status: { $in: ['with_manager', 'with_hr'] } });
    await send('hr', 'POST', `/admin/lifecycle/resignations/${leadRes!.id}/accept`, { lastWorkingDay: addDays(today, 30), newManagerUserId: 'mgr', moveTeamNow: true });
    const rows = await db.resignations().find({ org: ORG, userId: { $in: ['zrep', 'zrep2'] } }).toArray();
    eq('both open resignations now name the new manager (with the manager, and with HR)', rows.map((r) => [r.userId, r.status, r.managerUserId]).sort(), [['zrep', 'with_manager', 'mgr'], ['zrep2', rows.find((r) => r.userId === 'zrep2')!.status, 'mgr']].sort());
    eq('Team › Requests: the cards are the new manager’s, no longer the leaver’s', [await cardsOf('mgr'), await cardsOf('zlead')], [['zrep', 'zrep2'], []]);
    eq('the reports themselves report to the new manager', (await users().find({ userId: { $in: ['zrep', 'zrep2'] } }).toArray()).map((u) => u.managerUserId), ['mgr', 'mgr']);
    const zrepView = await get('zrep', '/lifecycle/resignation');
    eq('the report’s own resignation names the new manager', zrepView.resignation?.managerName, 'Neha Rao');
    ok('the new manager is told a resignation waits for them', (await notifications().find({ userId: 'mgr', 'data.destination': 'lifecycle_resignation_request' }).toArray()).some((n: Json) => /waiting for you/.test(String(n.title))));
  }

  // ═════════════════════════════════════════════════════════════ the end
  say('\nAllowed differences (everything else must agree):');
  for (const a of ALLOWED) say(`  · ${a}`);
  say('');
  let total = 0; let bad = 0;
  for (const [k, c] of Object.entries(counts)) { say(`${k.padEnd(12)} ${c.passed} passed, ${c.failed} failed`); total += c.passed + c.failed; bad += c.failed; }
  say(`${total - bad} passed, ${bad} failed`);
  if (failures.length) say(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  server.close();
  const { rm } = await import('node:fs/promises');
  const path = await import('node:path');
  await rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', ORG), { recursive: true, force: true });
  await db.closeDb();
  process.exit(bad ? 1 : 0);
})().catch((error) => {
  say(String(error?.stack ?? error));
  if (productErrors.length) say(productErrors.slice(0, 5).join('\n'));
  process.exit(1);
});

