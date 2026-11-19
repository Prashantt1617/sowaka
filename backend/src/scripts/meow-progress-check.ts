/**
 * Meow's level on the server (game-progress.service), end to end on a
 * scratch database: `/play/meowdoku` and `/play/meow-test` carry
 * `window.__SOWAKA_PROGRESS` and a policy that lets them reach this server,
 * every other page is served exactly as before; `/games/progress/:key` takes
 * only a `progress` ticket, only a whole level, keeps the higher one (POST and
 * the in-app image GET alike) and is rate limited; the backfill's rule and
 * its plan and write; and the pages' own save code, run with stubs.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27133 MONGODB_DB=meow_progress_check npx tsx src/scripts/meow-progress-check.ts
 *
 * The database is dropped before and after.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, gameCatalog, gameProgress, gameScores, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { levelFromBestScore, REPORTS_PER_MINUTE, resetRate } from '../services/game-progress.service';
import { mintTicket } from '../services/scribble-ticket.service';
import { applyBackfill, planBackfill, summarise } from './meow-progress-backfill';

let failures = 0;
let passes = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  else passes += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const ORG = 'sowaka';
const OTHER = 'elsewhere';
const PORT = Number(process.env.CHECK_PORT ?? 4377);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = join(__dirname, '..', '..', 'game-pages');
const OTHER_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Odd One Out</title></head><body>page</body></html>';

const seedUser = (id: string, org = ORG): User =>
  ({ userId: id, name: `Meow ${id}`, email: `${id}@${org}.local`, employeeId: id.toUpperCase(), org, lifecycleStatus: 'active', location: 'Gurgaon' }) as User;

const progressOf = async (userId: string, gameKey: string, org = ORG) =>
  (await gameProgress().findOne({ org, userId, gameKey }))?.level ?? 0;

function globalOf(html: string): { level: number; ticket: string; url: string } | null {
  const m = html.match(/<script>window\.__SOWAKA_PROGRESS=(\{.*?\})<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

const post = (key: string, body: unknown, ticket?: string) =>
  fetch(`${BASE}/games/progress/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ticket ? { 'x-game-ticket': ticket } : {}) },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------- the pages' save code, run with stubs

/** The page's save section (from `const SAVE_KEY=` to the first `loadSave();`), in a sandbox. */
function runSave(file: string, opts: { progress?: unknown; local?: Record<string, unknown> | null; fetch?: 'ok' | 'reject' | 'throw' | 'none' }) {
  const html = readFileSync(join(PAGES, file), 'utf8');
  const start = html.indexOf("const SAVE_KEY='meowdoku.v1';");
  const end = html.indexOf('\nloadSave();', start);
  const code = html.slice(start, end + '\nloadSave();'.length);
  const store = new Map<string, string>();
  if (opts.local) store.set('meowdoku.v1.u1', JSON.stringify(opts.local));
  const fetches: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const images: string[] = [];
  const sandbox: Record<string, unknown> = {
    window: { __SOWAKA_PROGRESS: opts.progress, Sowaka: { native: true, userId: 'u1' } },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    BANK: [],
    Image: class {
      set src(v: string) {
        images.push(v);
      }
    },
    encodeURIComponent,
    JSON,
    Math,
    Number,
    Array,
    Object,
    Promise,
  };
  if (opts.fetch !== 'none') {
    sandbox.fetch = (url: string, init: never) => {
      if (opts.fetch === 'throw') throw new TypeError('blocked');
      fetches.push({ url, init });
      return opts.fetch === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ status: 204 });
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nglobalThis.__t={ get save(){ return save; }, store, loadSave };`, sandbox);
  const t = sandbox.__t as { save: { level: number }; store: () => void };
  return { t, fetches, images, stored: () => JSON.parse(store.get('meowdoku.v1.u1') ?? 'null') as { level: number } | null };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function pageChecks(file: string) {
  console.log(`\n${file}: the save code`);
  const P = { level: 0, ticket: 's1.abc.def', url: '/games/progress/meowdoku' };

  const plain = runSave(file, { progress: undefined, local: { best: 10, level: 7 } });
  check('no __SOWAKA_PROGRESS (a plain browser): the local level, no report', plain.t.save.level === 7 && plain.fetches.length === 0 && plain.images.length === 0);
  plain.t.save.level = 8;
  plain.t.store();
  check('and a new level stays local: no report', plain.fetches.length === 0 && plain.images.length === 0 && plain.stored()?.level === 8);

  const behind = runSave(file, { progress: { ...P, level: 10 }, local: { best: 10, level: 3 } });
  check('server ahead (10 vs 3): the page plays level 10, sends nothing', behind.t.save.level === 10 && behind.fetches.length === 0);

  const fresh = runSave(file, { progress: { ...P, level: 6 }, local: null });
  check('no local save at all: the server level (6)', fresh.t.save.level === 6 && fresh.fetches.length === 0);

  const ahead = runSave(file, { progress: { ...P, level: 4 }, local: { best: 10, level: 9 } });
  const f = ahead.fetches[0];
  check('local ahead (9 vs 4): keeps 9 and POSTs it once with the ticket header', ahead.t.save.level === 9 && ahead.fetches.length === 1 && f.url === P.url && f.init.method === 'POST' && f.init.headers['X-Game-Ticket'] === P.ticket && JSON.parse(f.init.body).level === 9);
  ahead.t.save.level = 10;
  ahead.t.store();
  ahead.t.store();
  check('a new level: one POST of {level: 10}; storing again sends nothing more', ahead.fetches.length === 2 && JSON.parse(ahead.fetches[1].init.body).level === 10);
  check('nothing went as an image while fetch worked', ahead.images.length === 0);

  const inApp = runSave(file, { progress: { ...P, level: 2 }, local: { best: 10, level: 5 }, fetch: 'reject' });
  await flush();
  check('fetch refused (the app policy): the same report as an image GET with level and ticket', inApp.images.length === 1 && inApp.images[0] === `${P.url}?level=5&ticket=${encodeURIComponent(P.ticket)}`);
  const throws = runSave(file, { progress: { ...P, level: 2 }, local: { best: 10, level: 5 }, fetch: 'throw' });
  check('fetch throwing at once: an image too', throws.images.length === 1);
  const none = runSave(file, { progress: { ...P, level: 2 }, local: { best: 10, level: 5 }, fetch: 'none' });
  check('no fetch at all: an image too', none.images.length === 1);
  const junk = runSave(file, { progress: { level: 50 }, local: { best: 10, level: 5 } });
  check('a global without a ticket is ignored: local level, no report', junk.t.save.level === 5 && junk.fetches.length === 0 && junk.images.length === 0);
}

async function main() {
  if (!/^meow_progress_check$|scratch/i.test(env.mongoDbName)) {
    console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=meow_progress_check.`);
    process.exit(1);
  }
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.mongoUri)) {
    console.error('Refusing to run against a database that is not on this machine. Use MONGODB_URI=mongodb://127.0.0.1:27133.');
    process.exit(1);
  }
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await connectDb();
    await getDb().dropDatabase();
    await connectDb();
    // dropDatabase took the indexes with it; the unique one is what this checks.
    await gameProgress().createIndex({ org: 1, userId: 1, gameKey: 1 }, { unique: true });
    await users().insertMany([seedUser('mp-u1'), seedUser('mp-u2'), seedUser('mp-x1', OTHER)]);
    await companies().insertMany([
      { id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['meowdoku', 'meow-test', 'odd-one-out'] },
      { id: OTHER, name: 'Elsewhere', enabledTabs: ['games'], enabledGames: ['meowdoku'] },
    ] as never[]);
    const created = new Date();
    const entry = (key: string, html: string) =>
      ({ key, name: key, kind: 'web', order: 10, active: true, scoring: { higherIsBetter: true, label: 'points', max: 10000 }, html, createdAt: created, updatedAt: created }) as never;
    await gameCatalog().insertMany([
      entry('meowdoku', readFileSync(join(PAGES, 'meowdoku.html'), 'utf8')),
      entry('meow-test', readFileSync(join(PAGES, 'meow-test.html'), 'utf8')),
      entry('odd-one-out', OTHER_HTML),
    ]);
    const session = async (userId: string) => {
      const token = `tok-${randomUUID()}`;
      await authSessions().insertOne({ tokenHash: hashSessionToken(token), userId, createdAt: created, expiresAt: new Date(Date.now() + 3_600_000) } as never);
      return token;
    };
    const s1 = await session('mp-u1');
    const sx = await session('mp-x1');

    server = app.listen(PORT, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const play = (key: string, token = s1) => fetch(`${BASE}/play/${key}`, { headers: { authorization: `Bearer ${token}` } });

    // ------------------------------------------------------------ injection and policy
    console.log('the pages');
    for (const key of ['meowdoku', 'meow-test']) {
      const res = await play(key);
      const html = await res.text();
      const csp = res.headers.get('content-security-policy') ?? '';
      const g = globalOf(html);
      const at = html.indexOf('<script>window.__SOWAKA_PROGRESS=');
      check(`${key}: served with __SOWAKA_PROGRESS {level 0, a ticket, its url}`, res.status === 200 && !!g && g.level === 0 && /^s1\./.test(g.ticket) && g.url === `/games/progress/${key}`);
      check(`${key}: the global sits just before </head>, once`, at > 0 && html.slice(at).match(/^<script>window\.__SOWAKA_PROGRESS=.*?<\/script><\/head>/) !== null && html.split('__SOWAKA_PROGRESS=').length === 2);
      check(`${key}: its policy lets it reach this server, and only that is changed`, csp.includes("connect-src 'self'") && !csp.includes("connect-src 'none'") && csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"));
    }
    const other = await play('odd-one-out');
    const otherHtml = await other.text();
    check('another game: the page exactly as stored, no global', other.status === 200 && otherHtml === OTHER_HTML);
    check("another game: the policy unchanged (connect-src 'none')", (other.headers.get('content-security-policy') ?? '').includes("connect-src 'none'"));

    // ------------------------------------------------------------ the ticket
    console.log('\nthe ticket');
    const g1 = globalOf(await (await play('meowdoku')).text())!;
    check('no ticket: 401', (await post('meowdoku', { level: 5 })).status === 401);
    check('a forged ticket: 401', (await post('meowdoku', { level: 5 }, `${g1.ticket.slice(0, -2)}xx`)).status === 401);
    const subject = { userId: 'mp-u1', org: ORG, name: 'Meow' };
    check("a socket ('ticket') ticket: 401, kinds never mix", (await post('meowdoku', { level: 5 }, mintTicket(subject))).status === 401);
    check('a hop ticket: 401', (await post('meowdoku', { level: 5 }, mintTicket(subject, { kind: 'hop' }))).status === 401);
    check('an expired progress ticket: 401', (await post('meowdoku', { level: 5 }, mintTicket(subject, { kind: 'progress', now: Date.now() - 13 * 3_600_000 }))).status === 401);
    check('the session alone (no ticket) does not do', (await fetch(`${BASE}/games/progress/meowdoku`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s1}` }, body: '{"level":5}' })).status === 401);
    check('nothing stored by any of those', (await gameProgress().countDocuments({})) === 0);

    // ------------------------------------------------------------ levels
    console.log('\nlevels');
    for (const bad of [0, 1000, 2.5, -3, 'abc', null]) {
      const r = await post('meowdoku', { level: bad }, g1.ticket);
      check(`level ${JSON.stringify(bad)}: 400`, r.status === 400);
    }
    check('no level at all: 400', (await post('meowdoku', {}, g1.ticket)).status === 400);
    const first = await post('meowdoku', { level: 5 }, g1.ticket);
    check('level 5: 204 and stored 5', first.status === 204 && (await progressOf('mp-u1', 'meowdoku')) === 5);
    check('level 3 after: 204, still 5 (never lowered)', (await post('meowdoku', { level: 3 }, g1.ticket)).status === 204 && (await progressOf('mp-u1', 'meowdoku')) === 5);
    check('level 9: 9', (await post('meowdoku', { level: 9 }, g1.ticket)).status === 204 && (await progressOf('mp-u1', 'meowdoku')) === 9);
    const img = await fetch(`${BASE}/games/progress/meowdoku?level=12&ticket=${encodeURIComponent(g1.ticket)}`);
    check('the in-app image GET: 204 and 12', img.status === 204 && (await progressOf('mp-u1', 'meowdoku')) === 12);
    const imgLow = await fetch(`${BASE}/games/progress/meowdoku?level=2&ticket=${encodeURIComponent(g1.ticket)}`);
    check('an image GET with a lower level: 204, still 12', imgLow.status === 204 && (await progressOf('mp-u1', 'meowdoku')) === 12);
    check('an image GET without a ticket: 401', (await fetch(`${BASE}/games/progress/meowdoku?level=40`)).status === 401);
    const raced = await Promise.all([20, 14, 18, 16].map((level) => post('meow-test', { level }, g1.ticket)));
    check('four reports at once on a new row: one row, the highest (20)', raced.every((r) => r.status === 204) && (await gameProgress().countDocuments({ userId: 'mp-u1', gameKey: 'meow-test' })) === 1 && (await progressOf('mp-u1', 'meow-test')) === 20);
    check('each game its own row: meowdoku still 12', (await progressOf('mp-u1', 'meowdoku')) === 12);
    const again = globalOf(await (await play('meowdoku')).text());
    check('the next page load carries level 12', again?.level === 12);
    check('and meow-test carries 20', globalOf(await (await play('meow-test')).text())?.level === 20);
    const gx = globalOf(await (await play('meowdoku', sx)).text())!;
    await post('meowdoku', { level: 30 }, gx.ticket);
    check("another company's player: their own row, at their company; ours untouched", (await progressOf('mp-x1', 'meowdoku', OTHER)) === 30 && (await progressOf('mp-u1', 'meowdoku')) === 12 && (await progressOf('mp-x1', 'meowdoku', ORG)) === 0);
    const otherKey = await post('odd-one-out', { level: 5 }, g1.ticket);
    check('a game that keeps no level: not handled here (falls through), nothing stored', otherKey.status !== 204 && (await gameProgress().countDocuments({ gameKey: 'odd-one-out' })) === 0);

    // ------------------------------------------------------------ rate limit
    console.log('\nrate limit');
    resetRate();
    const statuses: number[] = [];
    for (let i = 0; i < REPORTS_PER_MINUTE + 1; i += 1) statuses.push((await post('meowdoku', { level: 13 }, g1.ticket)).status);
    check(`${REPORTS_PER_MINUTE} reports a minute pass, the next is 429`, statuses.slice(0, -1).every((s) => s === 204) && statuses[statuses.length - 1] === 429);
    check('another person is not held up by it', (await post('meowdoku', { level: 31 }, gx.ticket)).status === 204);
    resetRate();

    // ------------------------------------------------------------ the backfill
    console.log('\nthe backfill rule');
    check('score 0 or nothing: level 1', levelFromBestScore(0) === 1 && levelFromBestScore(Number.NaN) === 1);
    check('score 800 (s/2 = 400): level 1', levelFromBestScore(800) === 1);
    check('score 850 (base(1) = 425): level 2', levelFromBestScore(850) === 2);
    check('score 851: level 3 (needs base ≥ 425.5, so level 2 solved)', levelFromBestScore(851) === 3);
    check('score 1700: level 19', levelFromBestScore(1700) === 19);
    check('score 3800 (2·base(60)) and beyond: capped at 60', levelFromBestScore(3800) === 60 && levelFromBestScore(99999) === 60);
    // Against the page's own scoring: the best a level L can score proves L solved, and never more than L.
    const html = readFileSync(join(PAGES, 'meowdoku.html'), 'utf8');
    const sb: Record<string, unknown> = { Math };
    vm.createContext(sb);
    vm.runInContext(`${html.match(/^const PAR=.*$/m)![0]}\n${html.match(/^const baseFor=.*$/m)![0]}\n${html.match(/^function worthOf.*$/m)![0]}\nglobalThis.w=worthOf;`, sb);
    const worth = sb.w as (n: number, t: number, h: number, L: number, m: number) => number;
    let exact = true;
    let never = true;
    for (let L = 1; L <= 60; L += 1) {
      for (const n of [6, 7, 8]) {
        if (levelFromBestScore(worth(n, 0, 0, L, 0)) !== Math.min(60, L + 1)) exact = false;
        for (const t of [5, 60, 200, 1000]) for (const h of [0, 1, 3]) if (levelFromBestScore(worth(n, t, h, L, 1)) > Math.min(60, L + 1)) never = false;
      }
    }
    check("the page's top score at each level 1–60 gives exactly the level after it", exact);
    check('no score a level can make gives more than the level after it', never);

    console.log('\nthe backfill plan and write');
    await gameProgress().deleteMany({});
    const at = new Date();
    await gameScores().insertMany([
      { gameId: 'catalog:meowdoku', org: ORG, userId: 'b1', playerName: 'b1', score: 1700, achievedAt: at, updatedAt: at },
      { gameId: 'catalog:meowdoku', org: ORG, userId: 'b2', playerName: 'b2', score: 1700, achievedAt: at, updatedAt: at },
      { gameId: 'catalog:meow-test', org: ORG, userId: 'b1', playerName: 'b1', score: 0, achievedAt: at, updatedAt: at },
      { gameId: 'catalog:meowdoku', org: OTHER, userId: 'b3', playerName: 'b3', score: 900, achievedAt: at, updatedAt: at },
      { gameId: 'catalog:odd-one-out', org: ORG, userId: 'b1', playerName: 'b1', score: 5000, achievedAt: at, updatedAt: at },
    ]);
    await gameProgress().insertOne({ org: ORG, userId: 'b2', gameKey: 'meowdoku', level: 30, updatedAt: at });
    const plan = await planBackfill(getDb());
    const row = (u: string, k: string) => plan.find((r) => r.userId === u && r.gameKey === k);
    check('the plan reads only the Meow games (4 rows, no odd-one-out)', plan.length === 4 && !plan.some((r) => r.gameKey === 'odd-one-out'));
    check('b1 meowdoku: 1700 → 19, to write', row('b1', 'meowdoku')?.level === 19 && row('b1', 'meowdoku')?.write === true);
    check('b2 already at 30: left alone', row('b2', 'meowdoku')?.stored === 30 && row('b2', 'meowdoku')?.write === false);
    check('b1 meow-test 0 → 1; b3 at the other company 900 → 3', row('b1', 'meow-test')?.level === 1 && row('b3', 'meowdoku')?.level === 3);
    const lines = summarise(plan);
    console.log(lines.map((l) => `      ${l}`).join('\n'));
    check('the table: one line per org and game, with players, raised and levels', lines.length === 4 && lines.some((l) => l === `${ORG}\tmeowdoku\t2\t1\t19×1 30×1`));
    check('a dry run writes nothing', (await gameProgress().countDocuments({})) === 1);
    const written = await applyBackfill(getDb(), plan);
    check('--apply writes the 3 raises', written === 3 && (await progressOf('b1', 'meowdoku')) === 19 && (await progressOf('b1', 'meow-test')) === 1 && (await progressOf('b3', 'meowdoku', OTHER)) === 3 && (await progressOf('b2', 'meowdoku')) === 30);
    // A level reported between the plan and the write is not lowered.
    await gameProgress().updateOne({ org: ORG, userId: 'b1', gameKey: 'meowdoku' }, { $set: { level: 25 } });
    await applyBackfill(getDb(), plan);
    check('a level raised meanwhile (25) is not lowered by a stale plan (19)', (await progressOf('b1', 'meowdoku')) === 25);
    const replan = await planBackfill(getDb());
    check('run again: nothing to write', replan.every((r) => !r.write) && (await applyBackfill(getDb(), replan)) === 0);

    // ------------------------------------------------------------ the pages' code
    await pageChecks('meowdoku.html');
    await pageChecks('meow-test.html');
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    try {
      await getDb().dropDatabase();
    } catch {
      /* not connected */
    }
    await closeDb();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
