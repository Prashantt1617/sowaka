/**
 * The joining portal inside the app (the Action tab before Day 1), through its
 * HTTP routes on a scratch database: POST /lifecycle/portal-session needs an
 * app session (no session, or a portal token, is 401), answers only for the
 * caller's own journey and only before the joining day in IST (no journey, Day
 * 1 itself, joined, moved to the app: 404), and the token it gives works on GET
 * /portal/me for that journey. /lifecycle/me says `onboarding.portal` to match.
 * The app's own token still never opens a portal route.
 *
 *   npm run portal-app:check     (mongod on 127.0.0.1:27133, database el_portal_app_check)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_portal_app_check';
process.env.EMAIL_ORGS = 'nobody-scratch';
process.env.NOTIFY_ORGS = 'nobody-scratch';
process.env.AWS_S3_BUCKET = '';
process.env.PORTAL_JWT_SECRET = 'portal-app-check-secret';
process.env.PORTAL_BASE_URL = 'http://localhost:5181/onboarding';
process.env.NODE_ENV = 'test';

const ORG = 'el-portal-app';
const PORT = Number(process.env.PORT ?? 4097);

let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
async function call(token: string | null, method: string, path: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

(async () => {
  let server: Server | undefined;
  const db = await import('../config/db');
  try {
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('runs on a local mongod only');
    if (process.env.MONGODB_DB !== 'el_portal_app_check') throw new Error('needs the el_portal_app_check database');
    await db.connectDb();
    if (db.getDb().databaseName !== 'el_portal_app_check') throw new Error(`refusing to run against ${db.getDb().databaseName}`);
    await db.getDb().dropDatabase();
    await db.connectDb();

    const { app } = await import('../app');
    const { hashSessionToken } = await import('../services/auth.service');
    const rules = await import('../services/lifecycle/dueRules');
    const engine = await import('../services/lifecycle/engine');
    const auth = await import('../services/lifecycle/portalAuth');

    const now = new Date();
    const day = (offset: number) => rules.addDaysKey(rules.todayKey(now), offset);
    await db.companies().insertOne({ id: ORG, name: 'Portal App Works', features: { lifecycle: true } } as never);
    const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
      userId, name, email: `${userId}@portal-app.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', ...extra,
    });
    await db.users().insertMany([
      person('hr', 'Hema Rao', { dashboardAccess: true, dashboardAdmin: true }),
      person('mgr', 'Meera Iyer', { role: 'manager' }),
      person('ravi', 'Ravi Menon', { managerUserId: 'mgr' }),
    ] as never[]);

    /** Offer accepted → finalised (the candidate's account) → docs approved, as HR and the portal walk it. */
    const preboard = async (name: string, userId: string, tjOffset: number) => {
      const j = await engine.createOnboardingJourney(ORG, 'hr', {
        candidate: { name, personalEmail: `${userId}@example.com` }, tj: day(tjOffset), managerUserId: 'mgr', designation: 'Designer', department: 'Design',
      });
      for (const s of ['offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const) await engine.setJourneyStatus(j.id, s);
      await auth.createCandidateAccount(await engine.loadJourney(j.id));
      return engine.loadJourney(j.id);
    };
    /** ...and Mark joined on Day 1 (the app user created then, bound to the journey). */
    const joinAt = async (name: string, userId: string, tjOffset: number) => {
      const j = await preboard(name, userId, tjOffset);
      await db.users().insertOne(person(userId, name, { managerUserId: 'mgr', joiningDate: rules.dayDate(day(tjOffset)) }) as never);
      await engine.onJoined(j.id, userId);
      return engine.loadJourney(j.id);
    };
    /** An app login before Day 1: the app user's email is the portal's login (HR set the employee up early). */
    const earlyLogin = async (name: string, userId: string, tjOffset: number) => {
      const j = await preboard(name, userId, tjOffset);
      await db.users().insertOne(person(userId, name, { email: `${userId}@example.com`, managerUserId: 'mgr', joiningDate: rules.dayDate(day(tjOffset)) }) as never);
      return j;
    };
    const pia = await earlyLogin('Pia Rao', 'pia', 5);
    const tara = await earlyLogin('Tara Bose', 'tara', 0);
    const isha = await joinAt('Isha Verma', 'isha', -2);
    const kabir = await joinAt('Kabir Mehta', 'kabir', -9);
    await engine.setJourneyStatus(kabir.id, 'moved_to_app');

    const tokens: Record<string, string> = {};
    for (const userId of ['pia', 'tara', 'isha', 'kabir', 'ravi']) {
      tokens[userId] = `tok-${randomUUID()}`;
      await db.authSessions().insertOne({ tokenHash: hashSessionToken(tokens[userId]), userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) });
    }
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));

    console.log('who may ask');
    ok('no session: 401', (await call(null, 'POST', '/lifecycle/portal-session')).status === 401);
    const portalOnly = auth.signPortalToken(pia.id, ORG);
    ok('a portal token in place of an app session: 401', (await call(portalOnly, 'POST', '/lifecycle/portal-session')).status === 401);
    const none = await call(tokens.ravi, 'POST', '/lifecycle/portal-session');
    ok('an employee without a journey: 404 (never someone else\'s)', none.status === 404, none);
    const dayOne = await call(tokens.tara, 'POST', '/lifecycle/portal-session');
    ok('on the joining day itself (Tj, IST): 404, the tab is the usual Actions', dayOne.status === 404, dayOne);
    const joined = await call(tokens.isha, 'POST', '/lifecycle/portal-session');
    ok('joined (after Day 1): 404', joined.status === 404, joined);
    const moved = await call(tokens.kabir, 'POST', '/lifecycle/portal-session');
    ok('moved to the app: 404', moved.status === 404, moved);

    console.log('the session (before Day 1)');
    const got = await call(tokens.pia, 'POST', '/lifecycle/portal-session');
    ok('their own journey: 200 with a token', got.status === 200 && typeof got.body.token === 'string', got);
    const claims = auth.verifyPortalToken(String(got.body.token));
    ok('the token is a portal token for their journey, in their company', claims?.sub === pia.id && claims?.org === ORG, claims);
    ok('valid for 12 hours', !!claims && claims.exp - claims.iat === auth.PORTAL_TOKEN_TTL_SECONDS && Math.abs(Date.parse(got.body.expiresAt) - claims.exp * 1000) < 1000, got.body.expiresAt);
    const url = String(got.body.url ?? '');
    ok('the address is the portal\'s /app entry with the token in the fragment', url.startsWith('http://localhost:5181/onboarding/app?c=') && url.endsWith(`#t=${got.body.token}`), url);

    console.log('the token in the portal');
    const home = await call(String(got.body.token), 'GET', '/portal/me');
    ok('GET /portal/me answers for them', home.status === 200 && home.body.candidateName === 'Pia Rao', { status: home.status, name: home.body.candidateName, view: home.body.view });
    ok('the pre-boarding portal (not joined, not closed)', !['joined', 'closed'].includes(String(home.body.view)), home.body.view);
    ok('the app token itself never opens a portal route', (await call(tokens.pia, 'GET', '/portal/me')).status === 401);

    console.log('/lifecycle/me');
    const mePia = await call(tokens.pia, 'GET', '/lifecycle/me');
    ok('before Day 1: portal true, their journey, no Onboarding tile', mePia.body.onboarding?.portal === true && mePia.body.onboarding?.journeyId === pia.id && mePia.body.onboarding?.tileVisible === false, mePia.body.onboarding);
    const meTara = await call(tokens.tara, 'GET', '/lifecycle/me');
    ok('on Day 1: no portal', !meTara.body.onboarding?.portal, meTara.body.onboarding);
    const meIsha = await call(tokens.isha, 'GET', '/lifecycle/me');
    ok('joined: portal false, the Onboarding tile', meIsha.body.onboarding?.portal === false && meIsha.body.onboarding?.tileVisible === true, meIsha.body.onboarding);
    const meKabir = await call(tokens.kabir, 'GET', '/lifecycle/me');
    ok('moved to the app: portal false', meKabir.body.onboarding?.portal === false, meKabir.body.onboarding);
    const meRavi = await call(tokens.ravi, 'GET', '/lifecycle/me');
    ok('no journey: no onboarding', meRavi.status === 200 && !meRavi.body.onboarding, meRavi.body);

    console.log('the day passes');
    ok('from Tj on the same journey gives no portal', (await auth.portalJourneyForAppUser('pia', ORG, new Date(`${pia.tj}T00:30:00+05:30`))) === null);
    ok('the evening before Tj (IST) it still does', (await auth.portalJourneyForAppUser('pia', ORG, new Date(`${day(4)}T23:30:00+05:30`)))?.id === pia.id);

    console.log('feature off');
    await db.companies().updateOne({ id: ORG }, { $set: { 'features.lifecycle': false } });
    const off = await call(tokens.pia, 'POST', '/lifecycle/portal-session');
    ok('the company switched off: 404', off.status === 404, off);
  } catch (error) {
    failed += 1;
    console.error(error);
  } finally {
    server?.close();
    try { await db.getDb().dropDatabase(); } catch { /* already gone */ }
    await db.closeDb();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
