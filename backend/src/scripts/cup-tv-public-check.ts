/**
 * The tournament TV on a public link (cup-tv-public), on a scratch database
 * on this machine only:
 *
 *   # a mongod (replica set rs0) on 127.0.0.1:27155, then:
 *   node --import tsx src/scripts/cup-tv-public-check.ts [--port 4391] [--mongo mongodb://127.0.0.1:27155]
 *   # the same, then keeps serving one scratch event per TV phase and prints their links (for screenshots):
 *   node --import tsx src/scripts/cup-tv-public-check.ts --serve true
 *
 * Checks: the host's link (made once, printed again the same, a new one ends
 * the old); the page and its policy; the poll (unchanged when nothing moved,
 * faces only when they changed); faces only at the version shown; a wrong or
 * malformed token: a calm "isn't active" page (200, never 404: the livetv
 * CloudFront turns 404s into the dashboard) and 410 for the poll and faces; no
 * expiry (an event ended days ago, or started 25 h ago, still works); revoke
 * switches it off at once; a removed event's link shows "This tournament has
 * ended" (nothing else) within 5 s; the same at `/tv/<token>`; the rate limits (per address,
 * wrong tokens, a working token still let through); and the payload's privacy,
 * on the engine's real lobby state and on every phase's fixture: first names
 * and faces only, no userId, full name, surname, email, employee id, role,
 * company or event id anywhere.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', '4391'));
const MONGO = arg('mongo', 'mongodb://127.0.0.1:27155');
const DB = arg('db', 'cup_tv_scratch');
const SERVE = arg('serve', 'false') === 'true';
if (!/_scratch$/.test(DB) || !/127\.0\.0\.1|localhost/.test(MONGO)) throw new Error('Scratch databases on this machine only');

process.env.MONGODB_URI = `${MONGO}/?replicaSet=rs0&directConnection=true`;
process.env.MONGODB_DB = DB;
process.env.SCRIBBLE_TICKET_SECRET = 'cup-tv-public-check-secret';
process.env.NOTIFY_ORGS = 'nobody';
process.env.EMAIL_ORGS = 'nobody';
process.env.CUP_RUNNER_ORGS = 'nobody';
process.env.REDIS_URL = '';
process.env.AWS_S3_BUCKET = '';

const ORG = 'sowaka';
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
const ok = (name: string, cond: unknown, detail?: unknown) => {
  if (!cond) {
    console.log(`FAIL ${name}`, detail ?? '');
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log(`ok   ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { connectDb, closeDb, getDb } = await import('../config/db');
  const { app } = await import('../app');
  const tv = await import('../services/cup-tv-public.service');
  const { tvStateFor } = await import('../services/cup-bets.service');
  const { DEMO_PEOPLE, FIXTURES, demoFace, fixtureState } = await import('./cup-tv-fixtures');
  const { DEFAULT_CUP_CONFIG } = await import('../services/cup-rules');

  const db = await connectDb();
  await db.dropDatabase();
  const now = new Date();
  await db.collection('companies').insertOne({ id: ORG, name: 'Sowaka Test', createdAt: now, updatedAt: now });
  await db.collection('users').insertMany(
    DEMO_PEOPLE.map((p) => ({
      userId: p.userId, name: p.name, org: ORG, email: p.email, employeeId: p.employeeId, designation: p.designation, department: p.department,
      lifecycleStatus: 'active', points: 0, ...(p.photo ? { profilePhotoKey: `mongo/cup-tv-demo/${p.userId}.png` } : {}), createdAt: now, updatedAt: now,
    })),
  );
  const media = [];
  for (const [i, p] of DEMO_PEOPLE.entries()) if (p.photo) media.push({ objectKey: `mongo/cup-tv-demo/${p.userId}.png`, contentType: 'image/png', bytes: await demoFace(i), createdAt: now });
  await db.collection('connect_media').insertMany(media);

  const eventDoc = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    ...DEFAULT_CUP_CONFIG,
    gameKey: 'word-trip',
    roundSec: 60,
    topN: 8,
    walletStart: 1000,
    lobbyDraw: true,
    pushAtLobby: false,
    id,
    org: ORG,
    name: 'Word Trip Tournament',
    active: true,
    lobbyAt: new Date(now.getTime() - 5 * 60_000),
    startAt: new Date(now.getTime() + 12 * 60_000 + 30_000),
    linkUntil: new Date(now.getTime() + 6 * 3600_000),
    linkBase: BASE,
    phase: 'lobby',
    round: 0,
    entrants: [],
    rounds: [],
    includeUserIds: DEMO_PEOPLE.map((p) => p.userId),
    lobbyJoined: DEMO_PEOPLE.slice(0, 46).map((p) => p.userId),
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const LOBBY = 'wt-tv-lobby-check';
  await db.collection('cup_events').insertOne(eventDoc(LOBBY) as never);

  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  console.log(`listening on ${(server.address() as AddressInfo).port}`);

  const get = async (path: string, ip = '203.0.113.10') => {
    const res = await fetch(`${BASE}${path}`, { headers: { 'X-Forwarded-For': ip } });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, text: buf.toString('utf8'), bytes: buf };
  };

  /** Privacy: what a public answer must never hold. */
  const SECRETS = DEMO_PEOPLE.flatMap((p) => [p.userId, p.name, p.name.split(' ')[1], p.email, p.employeeId]).concat(['Senior Designer', 'Account Manager', 'Engineer II', 'Studio North', 'Client Services', 'Sowaka Test', '"sowaka"', 'cup-tv-public', 'mongo/cup-tv-demo', '/cup/api/']);
  const privacy = (label: string, text: string, eventId: string) => {
    const leaks = SECRETS.filter((s) => text.includes(s));
    ok(`${label}: no userId, full name, surname, email, employee id, role or company`, leaks.length === 0, leaks.slice(0, 8));
    ok(`${label}: no event id`, !text.includes(eventId));
    const json = JSON.parse(text) as unknown;
    const bad: string[] = [];
    const walk = (node: unknown, key = ''): void => {
      if (Array.isArray(node)) node.forEach((x) => walk(x, key));
      else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if (typeof o.userId === 'string' && !/^p[A-Za-z0-9_-]{11}$/.test(o.userId)) bad.push(`userId ${o.userId}`);
        for (const k of ['name', 'firstName']) if (typeof o.userId === 'string' && typeof o[k] === 'string' && /\s/.test(o[k] as string)) bad.push(`${k} ${o[k]}`);
        for (const [k, v] of Object.entries(o)) {
          if (['email', 'employeeId', 'designation', 'department', 'orgName', 'me', 'photoUrl', 'photos'].includes(k)) bad.push(`key ${k}`);
          walk(v, k);
        }
      }
    };
    walk(json);
    ok(`${label}: every person is an opaque id with a first name`, bad.length === 0, bad.slice(0, 8));
  };

  // ---------------------------------------------------------------- the link
  const made = await tv.tvLinkFor(LOBBY);
  const again = await tv.tvLinkFor(LOBBY);
  ok('tv-link makes a token of 43 characters (256 bits)', made.created && /^[A-Za-z0-9_-]{43}$/.test(made.token));
  ok('tv-link again prints the same link', !again.created && again.token === made.token);
  const kept = await db.collection('cup_tv_links').findOne({ _id: LOBBY as never });
  ok('only its hash and a nonce are kept', !!kept && kept.hash !== made.token && !JSON.stringify(kept).includes(made.token));
  const printed = await tv.tvLinkCommand((await db.collection('cup_events').findOne({ id: LOBBY })) as never, {});
  ok('the host command prints the livetv address and its stream view', printed.includes(`https://livetv.getsowaka.com/tv/${made.token}\n`) && printed.includes(`https://livetv.getsowaka.com/tv/${made.token}?stream=1`) && /no expiry/.test(printed));
  const printedApi = await tv.tvLinkCommand({ id: LOBBY } as never, { 'link-base': BASE });
  ok('--link-base prints the API’s own /cup/tv address', printedApi.includes(`${BASE}/cup/tv/${made.token}`));
  ok('--tv-base prints another address', (await tv.tvLinkCommand({ id: LOBBY } as never, { 'tv-base': 'https://tv.example.test/x/' })).includes(`https://tv.example.test/x/${made.token}`));
  const T = made.token;

  // ---------------------------------------------------------------- the page and its poll
  const pageRes = await get(`/cup/tv/${T}`);
  const csp = pageRes.headers.get('content-security-policy') ?? '';
  ok('the page opens with the link (200, HTML)', pageRes.status === 200 && pageRes.text.includes('data-testid="cup-tv"'));
  ok('its policy runs only its own script (by hash) and reaches only this server', /script-src 'sha256-[A-Za-z0-9+/=]+'/.test(csp) && !csp.includes("script-src 'unsafe-inline'") && csp.includes("connect-src 'self'"));
  ok('no referrer, no store, no index', pageRes.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(pageRes.headers.get('cache-control') ?? '') && /noindex/.test(pageRes.headers.get('x-robots-tag') ?? ''));
  ok('the trailing-slash address works too', (await get(`/cup/tv/${T}/`)).status === 200);
  const atTv = await get(`/tv/${T}`);
  ok('the same page at /tv/<token> (livetv.getsowaka.com/tv/…)', atTv.status === 200 && atTv.text.includes('data-testid="cup-tv"'));
  ok('and its poll at /tv/<token>/state', (await get(`/tv/${T}/state`)).status === 200);

  // The runtime reads photos as it loads: a moment for the first read.
  await get(`/cup/tv/${T}/state`);
  await sleep(1200);
  const s1 = await get(`/cup/tv/${T}/state`);
  const st = JSON.parse(s1.text) as { event: { name: string; phase: string; lobbyPeople: { userId: string; name: string }[]; entrantCount: number }; faces: Record<string, string | null>; facesV: string; h: string; serverNow: string };
  ok('the poll answers the lobby (200)', s1.status === 200 && st.event?.phase === 'lobby' && st.event.name === 'Word Trip Tournament');
  ok('the lobby: 46 joined, the latest 30 with first names', st.event.entrantCount === 46 && st.event.lobbyPeople.length === 30 && st.event.lobbyPeople.every((p) => !/\s/.test(p.name)));
  const shownPids = new Set(st.event.lobbyPeople.map((p) => p.userId));
  ok('faces: a version per person shown with a photo, null without', Object.values(st.faces).filter(Boolean).length >= 20 && Object.values(st.faces).some((v) => v === null));
  ok('faces: only the people on screen (not the whole roster the engine knows before the draw)', Object.keys(st.faces).every((pid) => shownPids.has(pid)), Object.keys(st.faces).length);
  // Someone in the company (with a photo) who never joined: not in the payload, and no face under any version.
  const never = DEMO_PEOPLE.slice(46).find((p) => p.photo)!;
  const neverPid = tv.pidOfIn(LOBBY)(never.userId);
  const rawLobby = await tvStateFor({ userId: 'cup-tv-public', name: 'TV', org: ORG, hr: false }, LOBBY);
  const neverV = /\/([kd][A-Za-z0-9_-]{1,20})\/[A-Za-z0-9_-]+\.webp$/.exec(String((rawLobby.photos as Record<string, string> | undefined)?.[never.userId] ?? ''))?.[1] ?? 'kAAAAAAAAAA';
  ok('a roster member who never joined: the engine knows their face, the link does not show it', !!(rawLobby.photos as Record<string, string> | undefined)?.[never.userId] && !(neverPid in st.faces) && !s1.text.includes(neverPid));
  ok('…and their face 410s at its real version', (await get(`/cup/tv/${T}/face/${neverPid}/${neverV}.webp`)).status === 410);
  privacy('the engine’s lobby state', s1.text, LOBBY);
  const s2 = await get(`/cup/tv/${T}/state?h=${st.h}&pv=${st.facesV}`);
  ok('holding this version: just "unchanged"', s2.status === 200 && JSON.parse(s2.text).unchanged === true && s2.bytes.length < 120);
  const s3 = JSON.parse((await get(`/cup/tv/${T}/state?pv=${st.facesV}`)).text);
  ok('holding the faces: the state comes without them', !s3.unchanged && s3.event && s3.faces === undefined);
  ok('the server time is fresh on every answer', Math.abs(new Date(s3.serverNow).getTime() - Date.now()) < 1500);

  // ---------------------------------------------------------------- faces
  const [pid, v] = Object.entries(st.faces).find(([, x]) => x) as [string, string];
  const f1 = await get(`/cup/tv/${T}/face/${pid}/${v}.webp`);
  ok('a face shown comes as a small WebP', f1.status === 200 && f1.headers.get('content-type') === 'image/webp' && f1.bytes.length < 20_000, f1.status);
  ok('kept by the browser, not by a shared cache', /private/.test(f1.headers.get('cache-control') ?? ''));
  ok('a face at another version: 410', (await get(`/cup/tv/${T}/face/${pid}/kAAAAAAAAAA.webp`)).status === 410);
  ok('a face of nobody shown: 410', (await get(`/cup/tv/${T}/face/pAAAAAAAAAAA/${v}.webp`)).status === 410);
  ok('a face under a wrong token: 410', (await get(`/cup/tv/${randomBytes(32).toString('base64url')}/face/${pid}/${v}.webp`)).status === 410);

  // ---------------------------------------------------------------- wrong tokens
  const wrong = randomBytes(32).toString('base64url');
  const wrongPage = await get(`/cup/tv/${wrong}`);
  const inactive = (r: { status: number; text: string }) => r.status === 200 && r.text.includes('This link isn’t active') && !r.text.includes('<script') && !r.text.includes('Word Trip');
  ok('a wrong token: the page a calm "isn’t active" screen (200, nothing else)', inactive(wrongPage), wrongPage.status);
  ok('a wrong token: the poll 410', (await get(`/cup/tv/${wrong}/state`)).status === 410);
  ok('a wrong token at /tv: the same', inactive(await get(`/tv/${wrong}`)) && (await get(`/tv/${wrong}/state`)).status === 410);
  ok('a malformed token: 410', (await get('/cup/tv/abc/state')).status === 410 && (await get(`/cup/tv/${T}x/state`)).status === 410 && inactive(await get('/cup/tv/abc')));
  ok('the event id is no token', (await get(`/cup/tv/${LOBBY}/state`)).status === 410);

  // ---------------------------------------------------------------- a new link ends the old
  const fresh = await tv.tvLinkFor(LOBBY, true);
  ok('a new link works', (await get(`/cup/tv/${fresh.token}/state`)).status === 200);
  ok('and the old one stops (410, the page "isn’t active")', (await get(`/cup/tv/${T}/state`)).status === 410 && inactive(await get(`/cup/tv/${T}`)));

  // ---------------------------------------------------------------- no expiry, revoke, removed
  const ENDED = 'wt-tv-ended-check';
  await db.collection('cup_events').insertOne(eventDoc(ENDED, { phase: 'done', finishedAt: new Date(Date.now() - 3 * 24 * 3600_000) }) as never);
  const ended = (await tv.tvLinkFor(ENDED)).token;
  ok('no expiry: ended 3 days ago, still works (page and poll)', (await get(`/cup/tv/${ended}/state`)).status === 200 && (await get(`/cup/tv/${ended}`)).text.includes('data-testid="cup-tv"'));
  const OLD = 'wt-tv-old-check';
  await db.collection('cup_events').insertOne(eventDoc(OLD, { phase: 'running', startAt: new Date(Date.now() - 25 * 3600_000) }) as never);
  ok('no expiry: never finished, started 25 h ago, still works', (await get(`/cup/tv/${(await tv.tvLinkFor(OLD)).token}/state`)).status === 200);
  const off = await tv.tvLinkCommand({ id: ENDED } as never, { revoke: 'true' });
  ok('--revoke true switches it off', /switched off/.test(off) && !(await db.collection('cup_tv_links').findOne({ _id: ENDED as never })));
  ok('revoked: the poll 410 at once, the page "isn’t active"', (await get(`/cup/tv/${ended}/state`)).status === 410 && inactive(await get(`/cup/tv/${ended}`)));
  ok('revoking again: nothing to switch off', /No TV link/.test(await tv.tvLinkCommand({ id: ENDED } as never, { revoke: 'true' })));
  const back = await tv.tvLinkFor(ENDED);
  ok('after a revoke, tv-link makes a new link (the old stays off)', back.created && back.token !== ended && (await get(`/cup/tv/${back.token}/state`)).status === 200 && (await get(`/cup/tv/${ended}/state`)).status === 410);

  const GONE = 'wt-tv-removed-check';
  await db.collection('cup_events').insertOne(eventDoc(GONE) as never);
  const goneToken = (await tv.tvLinkFor(GONE)).token;
  ok('before removal: works', (await get(`/cup/tv/${goneToken}/state`)).status === 200);
  await db.collection('cup_events').deleteOne({ id: GONE });
  await sleep(5300);
  const gonePage = await get(`/cup/tv/${goneToken}`);
  const goneState = await get(`/cup/tv/${goneToken}/state`);
  ok('removed: within 5 s the page says "This tournament has ended" (200, no script, nothing about it)', gonePage.status === 200 && gonePage.text.includes('This tournament has ended') && !gonePage.text.includes('<script') && !gonePage.text.includes(GONE) && !gonePage.text.includes('Word Trip'));
  ok('removed: the poll 410 { ended: true } and nothing else', goneState.status === 410 && JSON.parse(goneState.text).ended === true && !goneState.text.includes(GONE));

  // ---------------------------------------------------------------- rate limits
  tv.resetTvRateLimits();
  const good = fresh.token;
  const codes: number[] = [];
  for (let i = 0; i < tv.LIMITS.state.max + 5; i += 1) codes.push((await get(`/cup/tv/${good}/state`, '198.51.100.7')).status);
  ok(`the poll: ${tv.LIMITS.state.max} a minute per address, then 429`, codes.slice(0, tv.LIMITS.state.max).every((c) => c === 200) && codes.slice(-3).every((c) => c === 429), codes.slice(-6));
  const limited = await get(`/cup/tv/${good}/state`, '198.51.100.7');
  ok('a 429 says when to try again', limited.status === 429 && limited.headers.get('retry-after') === '20');
  ok('another address is not held up', (await get(`/cup/tv/${good}/state`, '198.51.100.8')).status === 200);
  const pages: number[] = [];
  for (let i = 0; i < tv.LIMITS.page.max + 2; i += 1) pages.push((await get(`/cup/tv/${good}`, '198.51.100.9')).status);
  ok(`the page: ${tv.LIMITS.page.max} a minute per address, then 429`, pages.slice(-2).every((c) => c === 429));
  tv.resetTvRateLimits();
  ok('the working token, once', (await get(`/cup/tv/${good}/state`, '198.51.100.20')).status === 200);
  for (let i = 0; i < tv.LIMITS.badToken.max; i += 1) await get(`/cup/tv/${randomBytes(32).toString('base64url')}/state`, '198.51.100.20');
  ok('after many wrong tokens, an address gets no more lookups (429)', (await get(`/cup/tv/${randomBytes(32).toString('base64url')}/state`, '198.51.100.20')).status === 429);
  tv.forgetTvLinks();
  ok('but a token that worked lately still works from there', (await get(`/cup/tv/${good}/state`, '198.51.100.20')).status === 200);
  tv.resetTvRateLimits();

  // ---------------------------------------------------------------- every phase, from fixtures
  const fixtureEvents = new Map<string, (typeof FIXTURES)[number]>();
  for (const key of FIXTURES) {
    const id = `wt-tv-${key}`;
    await db.collection('cup_events').insertOne(eventDoc(id) as never);
    fixtureEvents.set(id, key);
  }
  // The faces come from each event's own runtime (signed for it); the rest from the fixture.
  tv.setCupTvSourceForChecks(async (eventId, org) => {
    const key = fixtureEvents.get(eventId);
    const real = await tvStateFor({ userId: 'cup-tv-public', name: 'TV', org, hr: false }, eventId);
    if (!key) return real;
    return { ...fixtureState(key, eventId), photos: real.photos, photosV: real.photosV };
  });
  const links: [string, string][] = [['lobby', fresh.token]];
  for (const [id, key] of fixtureEvents) {
    const token = (await tv.tvLinkFor(id)).token;
    links.push([key, token]);
    await get(`/cup/tv/${token}/state`);
  }
  await sleep(1500);
  for (const [key, token] of links.slice(1)) {
    const res = await get(`/cup/tv/${token}/state`);
    const body = JSON.parse(res.text) as { phase?: string; event?: { rounds?: unknown[] }; qualifier?: { rows: unknown[] } };
    ok(`${key}: answers (${res.bytes.length.toLocaleString()} bytes)`, res.status === 200 && !!body.event);
    privacy(key, res.text, `wt-tv-${key}`);
  }
  // A stray record left in the state (`debugLast`) keeps only its first name and an opaque id.
  const stray = JSON.parse((await get(`/cup/tv/${links[1][1]}/state`)).text).debugLast as Record<string, unknown>;
  ok('a stray person record: opaque id and first name only', !!stray && Object.keys(stray).sort().join(',') === 'name,userId' && !/\s/.test(String(stray.name)));
  // The same opaque id for the same person in every poll, and another in another event.
  const q1 = JSON.parse((await get(`/cup/tv/${links[1][1]}/state`)).text).qualifier.rows[0].userId;
  await sleep(1100);
  const q1b = JSON.parse((await get(`/cup/tv/${links[1][1]}/state`)).text).qualifier.rows[0].userId;
  ok('opaque ids hold from poll to poll', q1 === q1b);
  const firstRow = JSON.parse((await get(`/cup/tv/${links[1][1]}/state`)).text).qualifier.rows[0] as { name: string };
  const q2 = (JSON.parse((await get(`/cup/tv/${links[2][1]}/state`)).text).qualifier.rows as { name: string; userId: string }[]).find((r) => r.name === firstRow.name)?.userId;
  ok('and differ from one event to another', !!q2 && q2 !== q1);

  // ---------------------------------------------------------------- the engine's own qualifier (its rows, not a fixture)
  const QUAL = 'wt-tv-engine-qualifier';
  const joined = DEMO_PEOPLE.slice(0, 60).map((p) => p.userId);
  await db.collection('cup_events').insertOne(eventDoc(QUAL, {
    qualifier: true, lobbyJoined: joined, startAt: new Date(Date.now() - 150_000), startWindowSec: 40, countdownSec: 8,
    qual: { stage: 'a2', openedAt: new Date(Date.now() - 20_000), windowSec: 40, a1At: new Date(Date.now() - 150_000) },
  }) as never);
  const runAt = new Date();
  const runs = joined.flatMap((userId, i) => {
    const out: Record<string, unknown>[] = [];
    const run = (attempt: 1 | 2, status: 'live' | 'done', score: number, startAt: Date) => ({
      _id: `${QUAL}-q${attempt}-${userId}`, id: `${QUAL}-q${attempt}-${userId}`, eventId: QUAL, org: ORG, userId, attempt, seed: 1000 + i, status,
      joinedAt: startAt, startAt, live: { score, at: runAt }, ...(status === 'done' ? { score, endedAt: runAt } : {}), createdAt: runAt, updatedAt: runAt,
    });
    if (i < 52) out.push(run(1, 'done', 400 + ((i * 7919) % 2100), new Date(Date.now() - 140_000)));
    if (i % 3 === 0 || i >= 52) out.push(run(2, i % 2 ? 'done' : 'live', 300 + ((i * 104729) % 2300), new Date(Date.now() - 15_000)));
    return out;
  });
  await db.collection('cup_runs').insertMany(runs as never[]);
  const qualToken = (await tv.tvLinkFor(QUAL)).token;
  await get(`/cup/tv/${qualToken}/state`);
  await sleep(1500);
  const eq = await get(`/cup/tv/${qualToken}/state`);
  const eqs = JSON.parse(eq.text) as { phase: string; qualifier?: { attempt: number; cut: number; played: number; rows: { userId: string; name?: string; firstName: string; rank: number; status: string; playing: boolean }[] } };
  ok('the engine’s qualifier: phase and attempt 2 as the contract says', eq.status === 200 && eqs.phase === 'qualifier' && eqs.qualifier?.attempt === 2, eqs.phase);
  ok('the engine’s qualifier: 60 played, the cut 32, ranked rows with first names', eqs.qualifier?.played === 60 && eqs.qualifier.cut === 32 && eqs.qualifier.rows.length === 60 && eqs.qualifier.rows.every((r, i) => r.rank === i + 1 && !/\s/.test(r.firstName)), eqs.qualifier && { played: eqs.qualifier.played, cut: eqs.qualifier.cut });
  ok('the engine’s qualifier: who is playing now shows', (eqs.qualifier?.rows ?? []).some((r) => r.playing));
  privacy('the engine’s qualifier', eq.text, QUAL);
  links.push(['engine-qualifier', qualToken]);

  console.log(`\n${passed} checks passed${process.exitCode ? ', SOME FAILED' : ''}.`);
  if (SERVE) {
    console.log('\nServing (Ctrl-C to stop):');
    for (const [key, token] of links) console.log(`TV ${key} ${BASE}/cup/tv/${token}`);
    await new Promise(() => undefined);
  }
  server.close();
  await closeDb();
  void getDb;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).then(() => process.exit(process.exitCode ?? 0));
