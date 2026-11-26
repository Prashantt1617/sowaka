/**
 * A whole Word Trip Tournament played by bots against a backend started here,
 * on a scratch database (never a shared one): the lobby (with ghosts who join
 * and close the app), the qualifier (two runs each on letters of their own,
 * late joiners playing attempt 2 only, a tie forced at the cut and its extra
 * run), the cut and the ranked bracket, every round, no-shows
 * (their opponents play alone and go through), ties (forced in round 1,
 * replayed on new letters), the betting gaps on the last eight, to a champion.
 * Bots read only what a page reads (`/cup/api/state`) and send words the way
 * the page does (`POST /matches/:id/word`, with each word's time on the run's
 * clock): each plays a normal Word Trip run on the match's seed (the stops of
 * Word Trip's own boardAt, all-letter words to move on, skips, a little junk),
 * keeping its own copy of the run to compare with the server's answers. A TV polls `/admin/cup/state`
 * as the dashboard does. Every byte the pages, the TV and their photos take is
 * counted (each bot has a ~1.7 MB profile photo, as the phones upload them).
 *
 *   # a mongod (replica set rs0) on 127.0.0.1:27144, the page built (game-pages/cup/build.mjs), then:
 *   node --import tsx src/scripts/wordtrip-bot-run.ts [--bots 100] [--port 4166]
 *
 * Checks: a champion; every match decided; every round opened; every word
 * judged as the game's rules judge it; every result is its run played back
 * from the events kept (real words on the seed's stops); no player's state
 * holds the other player's words, and no match carries photo addresses; ghosts left out of the draw,
 * every live joiner in it; bets settled. The qualifier: the cut the largest power of two of those who played,
 * best of two, late joiners attempt 2 only (attempt 1 refused), the tie at the cut played off, ranks pairing
 * 1 v last, first names only in the qualifier rows, every run's score its words played back.
 * Prints timings, latencies and bytes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { DEFAULT_CUP_CONFIG, newRun, playRunSkip, playRunWord, qualifierCut, replayRun, runEndsSec } from '../services/cup-rules';
import { loadWordTripGame } from '../services/cup-wordtrip-game';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BOTS = Number(arg('bots', '100'));
const PORT = Number(arg('port', '4166'));
const MONGO = arg('mongo', 'mongodb://127.0.0.1:27144');
const DB = arg('db', 'wordtrip_scratch');
if (!/_scratch$/.test(DB) || !/127\.0\.0\.1|localhost/.test(MONGO)) throw new Error('Scratch databases on this machine only');
const PAGE = path.resolve(__dirname, '../../game-pages/diwali-cup.html');
const SECRET = 'wordtrip-bot-run-secret';
const BASE = `http://127.0.0.1:${PORT}`;
const EVENT_ID = 'wordtrip-bots';
const ORG = 'sowaka';
const HR_TOKEN = 'wordtrip-bot-run-hr-token';
/** The normal game, as the server loads it here (no catalog in a scratch database: this repo's page). */
const GAME = loadWordTripGame(readFileSync(path.resolve(__dirname, '../../game-pages/word-trip.html'), 'utf8'), 'repo');

const id = (i: number) => `bot-${String(i + 1).padStart(3, '0')}`;
/** Join the lobby, then close the app: never connected at the draw. */
const GHOSTS = new Set([3, 17, 29, 41, 58, 77].filter((i) => i < BOTS).map(id));
/** In the draw (connected in the lobby) but never join a match: their opponents play alone. */
const NO_SHOW = new Set([7, 22, 64].filter((i) => i < BOTS).map(id));
/** Join the lobby after attempt 1's window has closed: attempt 2 only (attempt 1 refused). */
const LATE = new Set([5, 9, 11, 13, 19, 25, 33, 37, 45, 55].filter((i) => i < BOTS).map(id));
/** Play attempt 1 only. */
const SKIP_A2 = new Set([2, 8].filter((i) => i < BOTS).map(id));
/** The same two short words at the same moments in both attempts: a tie, placed at the cut (below the strong, above the weak). */
const TIE = new Set([90, 91, 92, 93].filter((i) => i < BOTS).map(id));
/** Play both attempts but find no words (score 0): below the tie. With 100 bots: 62 strong, 4 tied, 28 weak, 6 ghosts → 94 played, the cut 64, the tie across it. */
const WEAK = new Set([...Array.from({ length: 24 }, (_, k) => 66 + k), 94, 95, 96, 97, 98].filter((i) => i < BOTS && i !== 77).map(id));

process.env.SCRIBBLE_TICKET_SECRET = SECRET;
process.env.MONGODB_URI = MONGO;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const failures: string[] = [];
const fail = (msg: string) => {
  if (failures.length < 60) console.log(`FAIL ${msg}`);
  failures.push(msg);
};

// ---------------------------------------------------------------- setup

/** A ~1.7 MB PNG (noise does not compress), as phones upload profile photos. */
async function bigPhoto(): Promise<Buffer> {
  const w = 760;
  return sharp(randomBytes(w * w * 3), { raw: { width: w, height: w, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

async function seed(client: MongoClient) {
  const db = client.db(DB);
  await db.dropDatabase();
  const now = new Date();
  await db.collection('companies').insertOne({ id: ORG, name: 'Sowaka Test', createdAt: now, updatedAt: now });
  const photo = await bigPhoto();
  const users = Array.from({ length: BOTS }, (_, i) => ({
    userId: id(i), name: `Bot ${i + 1}`, org: ORG, email: `${id(i)}@sowaka.test`, lifecycleStatus: 'active', points: 0,
    profilePhotoKey: `mongo/cup-bots/${id(i)}.png`, createdAt: now, updatedAt: now,
  }));
  await db.collection('users').insertMany([
    ...users,
    { userId: 'hr-1', name: 'HR Test', org: ORG, email: 'hr@sowaka.test', lifecycleStatus: 'active', dashboardAccess: true, dashboardAdmin: true, points: 0, createdAt: now, updatedAt: now },
  ]);
  // The same bytes under every bot's own key (the server reads each one).
  for (let i = 0; i < BOTS; i += 10) {
    await db.collection('connect_media').insertMany(users.slice(i, i + 10).map((u) => ({ objectKey: u.profilePhotoKey, contentType: 'image/png', size: photo.length, bytes: photo, createdAt: now })));
  }
  await db.collection('auth_sessions').insertOne({ tokenHash: createHash('sha256').update(HR_TOKEN).digest('hex'), userId: 'hr-1', createdAt: now, expiresAt: new Date(now.getTime() + 6 * 3600_000) });
  const event = {
    ...DEFAULT_CUP_CONFIG,
    gameKey: 'word-trip',
    roundSec: 60,
    startWindowSec: 10,
    soloStartSec: 10,
    bettingSec: 8,
    countdownSec: 5,
    minPlaySec: 0,
    topN: 8,
    walletStart: 1000,
    lobbyDraw: true,
    qualifier: true,
    maxReplays: 2,
    pushAtLobby: false,
    id: EVENT_ID,
    org: ORG,
    name: 'Word Trip Tournament',
    active: true,
    lobbyAt: new Date(now.getTime() + 3000),
    startAt: new Date(now.getTime() + 60_000),
    linkUntil: new Date(now.getTime() + 3 * 3600_000),
    linkBase: `http://localhost:${PORT}`,
    phase: 'scheduled',
    round: 0,
    entrants: [],
    rounds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection('cup_events').insertOne({ _id: EVENT_ID, ...event } as never);
  return { ids: users.map((u) => u.userId), photoBytes: photo.length, startAt: event.startAt };
}

async function replicaSet() {
  const client = await MongoClient.connect(`${MONGO}/?directConnection=true`);
  try {
    await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: MONGO.replace('mongodb://', '') }] } });
  } catch (error) {
    if (!/already initialized/i.test(String((error as Error).message))) console.log('replSetInitiate:', (error as Error).message);
  }
  for (let i = 0; i < 40; i += 1) {
    if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
    await sleep(500);
  }
  await client.close();
}

function startServer(): ChildProcess {
  const log = createWriteStream(path.join(process.env.BOT_LOG_DIR ?? '/tmp', 'wordtrip-bot-server.log'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      MONGODB_URI: `${MONGO}/?replicaSet=rs0&directConnection=true`,
      MONGODB_DB: DB,
      CUP_RUNNER_ORGS: ORG,
      CUP_PAGE_FILE: PAGE,
      NOTIFY_ORGS: 'nobody',
      EMAIL_ORGS: 'nobody',
      SCRIBBLE_TICKET_SECRET: SECRET,
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

// ---------------------------------------------------------------- calls and bytes

let calls = 0;
let callErrors = 0;
const latencies: number[] = [];
const wordLat: number[] = [];
/** Bytes as read (raw) and as they travel (the API gzips every answer over 1 KB, as compression() does; photos are WebP and travel as they are). */
const gz = { state: 0, words: 0, other: 0, photos: 0, page: 0, tvState: 0, tvPhotos: 0 };
const wire = (b: Buffer) => (b.length > 1024 ? gzipSync(b).length : b.length);
const bytes = { state: 0, words: 0, other: 0, photos: 0, page: 0, tvState: 0, tvPhotos: 0 };
const photoLoads = { bots: 0, tv: 0 };

async function call(ticket: string | null, method: 'GET' | 'POST', url: string, body?: unknown, bucket: keyof typeof bytes = 'other', bearer?: string): Promise<{ status: number; text: string }> {
  const t = Date.now();
  calls += 1;
  try {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { ...(ticket ? { 'X-Cup-Ticket': ticket, 'X-Cup-Event': EVENT_ID } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    bytes[bucket] += buf.length;
    gz[bucket] += wire(buf);
    const ms = Date.now() - t;
    latencies.push(ms);
    if (bucket === 'words') wordLat.push(ms);
    if (res.status >= 500) {
      callErrors += 1;
      if (callErrors < 5) console.log(`5xx ${method} ${url}: ${buf.toString().slice(0, 200)}`);
    }
    return { status: res.status, text: buf.toString() };
  } catch (error) {
    callErrors += 1;
    return { status: 0, text: String(error) };
  }
}

/** A browser loads each photo address once (they are kept a year); counted per client. */
async function loadPhotos(seen: Set<string>, state: unknown, tv: boolean) {
  const urls = new Set<string>();
  JSON.stringify(state, (k, v) => {
    if (k === 'photoUrl' && typeof v === 'string') urls.add(v);
    return v;
  });
  const map = (state as { photos?: Record<string, string | null> }).photos;
  for (const u of Object.values(map ?? {})) if (typeof u === 'string') urls.add(u);
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await fetch(`${BASE}${u}`).catch(() => null);
    if (!r) continue;
    const b = Buffer.from(await r.arrayBuffer());
    if (r.status !== 200) fail(`photo ${u}: ${r.status}`);
    if (!/immutable/.test(r.headers.get('cache-control') ?? '')) fail(`photo ${u}: not cached long (${r.headers.get('cache-control')})`);
    if (tv) {
      bytes.tvPhotos += b.length;
      gz.tvPhotos += b.length;
      photoLoads.tv += 1;
    } else {
      bytes.photos += b.length;
      gz.photos += b.length;
      photoLoads.bots += 1;
    }
  }
}

// ---------------------------------------------------------------- checks on what a page sees

let viewsChecked = 0;
function checkState(userId: string, state: Record<string, any>) {
  for (const round of state.event?.rounds ?? []) {
    for (const m of round.matches ?? []) {
      viewsChecked += 1;
      for (const key of Object.keys(m)) if (['wtMe', 'wtOpp', 'found', 'letters', 'words'].includes(key)) fail(`${m.id}: ${key} in the bracket view`);
      if (m.a?.photoUrl || m.b?.photoUrl) fail(`${m.id}: a photo address in every match of every poll`);
    }
  }
  const mm = state.me?.match;
  if (mm && mm.wtOpp && Object.keys(mm.wtOpp).some((k) => !['score', 'words', 'endsAt'].includes(k))) fail(`${userId}: more than the opponent's score in my match`);
  if (mm?.wtMe?.best && !sentOk.get(`${userId}:${mm.id}:${mm.attempt}`)?.has(mm.wtMe.best)) fail(`${userId}: ${mm.wtMe.best} as my best word, but I never sent it`);
  if (state.wordTrip) fail(`${userId}: the TV's words in a player's state`);
  checkQualifier(userId, state);
  for (const round of state.event?.rounds ?? []) for (const m of round.matches ?? []) for (const p of [m.a, m.b]) if (p && p.rank !== p.seed) fail(`${m.id}: rank ${p.rank} but seed ${p.seed}`);
}

const PHASES = new Set(['lobby', 'qualifier', 'qualifier_tiebreak', 'bracket', 'done']);
const qualSeen = { states: 0, phases: new Set<string>(), maxCut: 0, tiebreak: null as null | { spots: number; userIds: string[] } };
function checkQualifier(who: string, state: Record<string, any>) {
  if (!PHASES.has(state.phase)) fail(`${who}: phase ${state.phase}`);
  qualSeen.phases.add(state.phase);
  const q = state.qualifier;
  if (!q) return;
  qualSeen.states += 1;
  if (q.attempt !== 1 && q.attempt !== 2) fail(`${who}: qualifier attempt ${q.attempt}`);
  if (q.cut !== qualifierCut(q.played)) fail(`${who}: cut ${q.cut} for ${q.played} played`);
  if (q.cut & (q.cut - 1)) fail(`${who}: cut ${q.cut} not a power of two`);
  qualSeen.maxCut = Math.max(qualSeen.maxCut, q.cut);
  if (!Array.isArray(q.rows) || q.rows.length !== q.played) fail(`${who}: ${q.rows?.length} rows for ${q.played} played`);
  q.rows.forEach((r: any, i: number) => {
    if (r.rank !== i + 1) fail(`${who}: row ${i} rank ${r.rank}`);
    if ('name' in r || /\s/.test(r.firstName ?? ' ')) fail(`${who}: a full name in the qualifier rows (${r.firstName})`);
    if (!['in', 'out', 'tied', 'pending'].includes(r.status)) fail(`${who}: status ${r.status}`);
    if (r.attempts < 0 || r.attempts > 2) fail(`${who}: attempts ${r.attempts}`);
    if (i && r.best > q.rows[i - 1].best && !(q.tiebreak || q.rows[i - 1].status === 'in')) fail(`${who}: rows not by best at ${i}`);
  });
  if (q.tiebreak) qualSeen.tiebreak = q.tiebreak;
}

// ---------------------------------------------------------------- a bot

const stats = { words: 0, taken: 0, refused: 0, serverSaidNo: 0, mismatch: 0, skips: 0, junk: 0, junkTaken: 0, bets: 0, joins: 0, lobbyJoins: 0, solos: 0, forcedTies: 0, runs: 0, lateA1Refused: 0, lateA1Taken: 0, extraRuns: 0 };
const sentOk = new Map<string, Set<string>>();
const lobbyOk = new Set<string>();
let done = false;
let startAtMs = 0;

async function bot(userId: string, ticket: string, linkTicket: string) {
  const seen = new Set<string>();
  const playing = new Set<string>();
  const betOn = new Set<string>();
  let joinedLobby = false;
  const attempted = new Set<number>();
  // The page itself, once (as the feed link opens it).
  const pageRes = await fetch(`${BASE}/cup/${EVENT_ID}?ticket=${encodeURIComponent(linkTicket)}`).catch(() => null);
  if (pageRes) {
    const b = Buffer.from(await pageRes.arrayBuffer());
    if (pageRes.status !== 200) fail(`page ${pageRes.status}: ${b.toString().slice(0, 100)}`);
    bytes.page += b.length;
    gz.page += wire(b);
  } else fail('page did not load');
  // The normal game's page, once (the page keeps it by version).
  const game = await call(ticket, 'GET', '/cup/api/wordtrip-game', undefined, 'page');
  if (game.status !== 200 || !JSON.parse(game.text).html) fail(`wordtrip-game ${game.status}`);
  let version: string | undefined;
  let photosV: number | undefined;
  let state: Record<string, any> | null = null;
  while (!done) {
    const res = await call(ticket, 'GET', `/cup/api/state?event=${EVENT_ID}${version ? `&since=${version}` : ''}${photosV != null ? `&pv=${photosV}` : ''}`, undefined, 'state');
    if (res.status !== 200) {
      await sleep(1000);
      continue;
    }
    const j = JSON.parse(res.text);
    if (!j.unchanged) {
      state = j;
      version = String(j.version);
      if (j.photosV != null) photosV = j.photosV;
      checkState(userId, j);
      await loadPhotos(seen, j, false);
    }
    if (!state) continue;
    const event = state.event;
    const me = state.me ?? {};
    const qs = state.qualifier;
    if (event?.lobbyOpen && !me.inLobby && !joinedLobby) {
      // A late joiner: once attempt 1's window has closed (attempt 1 is refused to them, attempt 2 is theirs).
      const lateNow = qs && ((qs.stage === 'a1' && Date.now() > qs.windowEndsAt + 500) || qs.stage === 'a2');
      if (!LATE.has(userId) || lateNow) {
        const r = await call(ticket, 'POST', `/cup/api/lobby?event=${EVENT_ID}`);
        if (r.status === 200) {
          joinedLobby = true;
          stats.lobbyJoins += 1;
          if (!GHOSTS.has(userId)) lobbyOk.add(userId);
          if (LATE.has(userId) && qs.stage === 'a1') {
            const q1 = await call(ticket, 'POST', `/cup/api/qualifier/join?event=${EVENT_ID}`);
            if (q1.status === 409) stats.lateA1Refused += 1;
            else {
              stats.lateA1Taken += 1;
              fail(`${userId}: a late joiner got attempt 1 (${q1.status} ${q1.text.slice(0, 80)})`);
            }
          }
          version = undefined;
        }
      }
    }
    // The qualifier: the attempt open now, joined as the page does by itself (but for those who skip attempt 2).
    const mq = me.qual;
    if (mq && mq.canJoin && !GHOSTS.has(userId)) {
      const att = mq.stage === 'a1' ? 1 : mq.stage === 'a2' ? 2 : 3;
      if (!attempted.has(att) && !(att === 2 && SKIP_A2.has(userId))) {
        attempted.add(att);
        await sleep(rand(200, 3000));
        const r = await call(ticket, 'POST', `/cup/api/qualifier/join?event=${EVENT_ID}`);
        if (r.status === 200) {
          const j = JSON.parse(r.text);
          stats.runs += 1;
          if (att === 3) stats.extraRuns += 1;
          const mode = WEAK.has(userId) ? 'none' : TIE.has(userId) && att < 3 ? 'tie' : 'normal';
          void play(userId, ticket, { id: j.run.id, startAt: j.run.startAt, boardSeed: j.run.seed, attempt: att, round: 0, label: `q${att}`, status: 'live' }, j.serverNow, `/cup/api/runs/${j.run.id}/word`, mode);
        } else fail(`${userId}: qualifier join ${r.status} ${r.text.slice(0, 80)}`);
        version = undefined;
      }
    }
    // A ghost closes the app once in the lobby: no more polls until the end.
    if (GHOSTS.has(userId) && joinedLobby) {
      while (!done) await sleep(1000);
      return;
    }
    const m = me.match;
    if (m && !NO_SHOW.has(userId)) {
      if (m.status === 'open' && !m.joined) {
        await sleep(rand(200, 2500));
        const r = await call(ticket, 'POST', `/cup/api/matches/${m.id}/join`);
        if (r.status === 200) stats.joins += 1;
        version = undefined;
      } else if ((m.status === 'live' || m.status === 'solo') && m.startAt && m.boardSeed) {
        const key = `${m.id}:${m.attempt}`;
        if (!playing.has(key)) {
          playing.add(key);
          if (m.status === 'solo') stats.solos += 1;
          void play(userId, ticket, m, state.serverNow);
        }
      }
    }
    if (state.current?.kind === 'betting' && !betOn.has(state.current.matchId) && Math.random() < 0.7) {
      const stage = (event?.rounds ?? []).flatMap((r: any) => r.matches).find((x: any) => x.id === state!.current.matchId);
      if (stage?.a && stage?.b && stage.a.userId !== userId && stage.b.userId !== userId) {
        betOn.add(state.current.matchId);
        const r = await call(ticket, 'POST', `/cup/api/bets?event=${EVENT_ID}`, { matchId: stage.id, pick: pick([stage.a.userId, stage.b.userId]), stake: pick([100, 250, 500]) });
        if (r.status === 200) stats.bets += 1;
      }
    }
    if (event?.phase === 'done') return;
    // As the page polls a Word Trip tournament: every 2.5 s.
    await sleep(rand(2300, 2700));
  }
}

/**
 * Plays a match as a person plays the normal game: from the match's start, on the stop the run is on (the seed's,
 * dealt by Word Trip's own boardAt), words from its lists every 0.6-3.5 s, now and then the all-letter word (on to
 * the next stop), now and then a skip, a little junk; until the run's clock (1:00 + what it earned) runs out. The bot
 * keeps its own copy of the run with the same rules, so it knows its stop and clock as the game would.
 */
async function play(userId: string, ticket: string, first: any, serverNow: string, url = `/cup/api/matches/${first.id}/word`, mode: 'normal' | 'tie' | 'none' = 'normal') {
  const skew = new Date(serverNow).getTime() - Date.now();
  const startAt = new Date(first.startAt).getTime();
  const seed = Number(first.boardSeed);
  const key = `${userId}:${first.id}:${first.attempt}`;
  sentOk.set(key, new Set());
  const forcedTie = mode === 'tie' || (first.round === 1 && /Match [12]$/.test(first.label) && first.attempt === 0 && first.status === 'live');
  if (forcedTie) stats.forcedTies += 1;
  const wait = startAt - (Date.now() + skew);
  if (wait > 0) await sleep(wait + 30);
  const mine = newRun();
  const clock = () => (Date.now() + skew - startAt) / 1000;
  const send = async (body: Record<string, unknown>) => call(ticket, 'POST', url, body, 'words');
  if (mode === 'none') return;
  if (mode === 'tie') {
    // Two common three-letter words at 2 s and 4 s: the same score on any letters.
    const s = GAME.boards(seed, 0);
    const words = [...s.words].filter((w) => w.length === 3).sort().slice(0, 2);
    if (words.length < 2) fail(`${userId}: no two 3-letter words on ${s.letters}`);
    for (const [i, w] of words.entries()) {
      await sleep(Math.max(0, (2 + i * 2 - clock()) * 1000));
      sentOk.get(key)!.add(w);
      stats.words += 1;
      const r = await send({ stop: 0, word: w, t: 2 + i * 2 });
      if (r.status === 200 && JSON.parse(r.text).verdict?.ok) stats.taken += 1;
    }
    return;
  }
  if (forcedTie) {
    // Both players: the same three words at the same moments, then nothing: a tie.
    const s = GAME.boards(seed, 0);
    const words = [...s.words].filter((w) => w.length < s.len).sort().slice(0, 3);
    for (const [i, w] of words.entries()) {
      await sleep(Math.max(0, (2 + i * 2 - clock()) * 1000));
      sentOk.get(key)!.add(w);
      stats.words += 1;
      const r = await send({ stop: 0, word: w, t: 2 + i * 2 });
      if (r.status === 200 && JSON.parse(r.text).verdict?.ok) stats.taken += 1;
    }
    return;
  }
  const skill = first.round === 0 ? rand(0.5, 0.9) : rand(0.25, 0.9);
  while (clock() < runEndsSec(mine, GAME.rules) - 0.3) {
    await sleep(rand(600, 3500) / skill);
    const t = clock();
    if (t >= runEndsSec(mine, GAME.rules) - 0.2) break;
    const stop = GAME.boards(seed, mine.gi);
    if (t < mine.stopFrom) continue;
    const found = new Set((mine.found[mine.gi] ?? []).map(([w]) => w));
    const left = [...stop.words, ...stop.rare].filter((w) => !found.has(w));
    const full = left.filter((w) => w.length === stop.len);
    const short = left.filter((w) => w.length < stop.len);
    const roll = Math.random();
    if (roll < 0.04 && mine.score >= GAME.rules.SKIP_COST) {
      const r = await send({ skip: true, stop: mine.gi, t });
      if (r.status === 200 && JSON.parse(r.text).skip?.ok) {
        playRunSkip(mine, mine.gi, t, GAME.rules);
        stats.skips += 1;
      }
      continue;
    }
    if (roll < 0.12) {
      stats.junk += 1;
      const junk = stop.letters.split('').sort(() => Math.random() - 0.5).join('').slice(0, 4);
      sentOk.get(key)!.add(junk);
      const r = await send({ stop: mine.gi, word: junk, t });
      if (r.status === 200) {
        const v = JSON.parse(r.text).verdict;
        if (v?.ok) {
          playRunWord(mine, stop, mine.gi, junk, t, GAME.rules);
          if (!stop.words.has(junk) && !stop.rare.has(junk)) stats.junkTaken += 1;
        }
      }
      continue;
    }
    const word = (roll > 0.82 && full.length) || !short.length ? pick(full) : pick(short);
    if (!word) continue;
    sentOk.get(key)!.add(word);
    stats.words += 1;
    const r = await send({ stop: mine.gi, word, t });
    if (r.status !== 200) {
      stats.refused += 1;
      if (r.status === 409) return;
      continue;
    }
    const j = JSON.parse(r.text);
    const local = playRunWord(mine, stop, mine.gi, word, t, GAME.rules);
    if (j.verdict?.ok) stats.taken += 1;
    else stats.serverSaidNo += 1;
    if (!!j.verdict?.ok !== local.ok || j.score !== mine.score || j.gi !== mine.gi) {
      stats.mismatch += 1;
      if (stats.mismatch < 5) console.log(`run mismatch ${first.id} ${userId}: server ${JSON.stringify(j.verdict)} ${j.score}/${j.gi}, bot ${JSON.stringify(local)} ${mine.score}/${mine.gi}`);
    }
  }
}

/** The office TV: the dashboard's poll, with each face loaded once. */
async function tv() {
  const seen = new Set<string>();
  let maxLiveWithWords = 0;
  while (!done) {
    const r = await call(null, 'GET', `/admin/cup/${EVENT_ID}/state`, undefined, 'tvState', HR_TOKEN);
    if (r.status === 200) {
      const j = JSON.parse(r.text);
      const payload = j.data ?? j;
      await loadPhotos(seen, payload, true);
      checkQualifier('tv', payload);
      const live = Object.values(payload.wordTrip ?? {}).filter((x: any) => Object.values(x).some((p: any) => p.words > 0)).length;
      maxLiveWithWords = Math.max(maxLiveWithWords, live);
    } else if (r.status !== 200) fail(`tv state ${r.status}: ${r.text.slice(0, 120)}`);
    await sleep(1500);
  }
  return maxLiveWithWords;
}

// ---------------------------------------------------------------- the run

async function main() {
  const t0 = Date.now();
  await replicaSet();
  const client = await MongoClient.connect(`${MONGO}/?replicaSet=rs0&directConnection=true`);
  const { ids, photoBytes, startAt } = await seed(client);
  startAtMs = startAt.getTime();
  console.log(`Seeded ${ids.length} bots (each with a ${(photoBytes / 1024 / 1024).toFixed(2)} MB photo) in ${DB}; starting the backend on ${PORT}`);
  const server = startServer();
  const { mintTicket } = await import('../services/scribble-ticket.service');
  const tickets = new Map(ids.map((u) => [u, mintTicket({ userId: u, org: ORG, name: u }, { ttlMs: 3 * 3600_000 })]));
  const links = new Map(ids.map((u) => [u, mintTicket({ userId: u, org: ORG, name: '' }, { kind: 'cup-link', ttlMs: 3 * 3600_000 })]));
  for (let i = 0; i < 120; i += 1) {
    const r = await call(tickets.get(ids[0])!, 'GET', `/cup/api/state?event=${EVENT_ID}`);
    if (r.status === 200) break;
    await sleep(1000);
  }
  callErrors = 0;
  calls = 0;
  for (const k of Object.keys(bytes) as (keyof typeof bytes)[]) {
    bytes[k] = 0;
    gz[k] = 0;
  }
  latencies.length = 0;
  console.log(`Backend up after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const bots = ids.map((u) => bot(u, tickets.get(u)!, links.get(u)!));
  const tvRun = tv();
  const db = client.db(DB);
  const deadline = Date.now() + 60 * 60_000;
  let lastStage = '';
  let lastRound = -1;
  let lastPhase = '';
  while (Date.now() < deadline) {
    const event = await db.collection('cup_events').findOne({ id: EVENT_ID });
    if (event?.round !== lastRound || event?.phase !== lastPhase) {
      lastRound = event?.round;
      lastPhase = event?.phase;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] phase ${event?.phase} round ${event?.round}${event?.round ? ` (${event.rounds[event.round - 1]?.label})` : ''}`);
    }
    const stage = event?.qual ? `${event.qual.stage}${event.qual.done ? ' (cut made)' : ''}` : '';
    if (stage !== lastStage) {
      lastStage = stage;
      if (stage) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] qualifier ${stage}${event!.qual.extraUserIds ? ` · tied at the cut: ${event!.qual.extraUserIds.length} for ${event!.qual.spots} places` : ''}`);
    }
    if (event?.phase === 'done') break;
    await sleep(1000);
  }
  done = true;
  const maxLiveTv = await Promise.race([tvRun, sleep(5000).then(() => -1)]);
  await Promise.race([Promise.all(bots), sleep(5000)]);

  // ---------------------------------------------------------------- verify
  const event = (await db.collection('cup_events').findOne({ id: EVENT_ID }))!;
  const matches = await db.collection('cup_matches').find({ eventId: EVENT_ID }).toArray();
  const total = event.rounds.length;
  console.log(`\nLobby: ${event.lobbyJoined?.length} joined · drawn ${event.entrants.length} · rounds ${total} · matches ${matches.length}`);
  const drawn = new Set(event.entrants.map((e: any) => e.userId));
  const ghostsIn = [...GHOSTS].filter((g) => drawn.has(g));
  if (ghostsIn.length) fail(`ghosts drawn: ${ghostsIn.join(', ')}`);
  // ---- the qualifier
  const runs = await db.collection('cup_runs').find({ eventId: EVENT_ID }).toArray();
  const byUser = new Map<string, Record<number, any>>();
  for (const r of runs) byUser.set(r.userId, { ...(byUser.get(r.userId) ?? {}), [r.attempt]: r });
  const played = [...byUser.entries()].filter(([, a]) => a[1] || a[2]).map(([u]) => u);
  const cut = qualifierCut(played.length);
  console.log(`Qualifier: ${runs.length} runs · ${played.length} played · cut ${event.qual?.cut} (largest power of two: ${cut}) · ranked ${event.qual?.ranking?.length}`);
  if (!event.qual?.done) fail('the qualifier never finished');
  if (event.qual?.cut !== cut || event.entrants.length !== cut) fail(`cut ${event.qual?.cut}, entrants ${event.entrants.length}, want ${cut}`);
  const silent = [...lobbyOk].filter((u) => !byUser.has(u) && !SKIP_A2.has(u));
  if (silent.length) fail(`in the lobby, live, but no run: ${silent.join(', ')}`);
  let runsChecked = 0;
  for (const r of runs) {
    const back = replayRun(r.live?.wtr ?? [], GAME.boards, r.seed, GAME.rules);
    if ((r.score ?? 0) !== back.score) fail(`${r.id}: score ${r.score} but its words make ${back.score}`);
    if (r.status !== 'done') fail(`${r.id}: ${r.status} after the qualifier`);
    runsChecked += 1;
  }
  const seeds = new Set(runs.map((r) => r.seed));
  if (seeds.size < runs.length * 0.95) fail(`${runs.length} runs on only ${seeds.size} seeds (own letters each)`);
  for (const u of LATE) {
    const a = byUser.get(u) ?? {};
    if (a[1]) fail(`${u}: a late joiner played attempt 1`);
    if (!a[2]) fail(`${u}: a late joiner did not get attempt 2`);
  }
  if (stats.lateA1Refused !== LATE.size) fail(`late joiners refused attempt 1: ${stats.lateA1Refused} of ${LATE.size}`);
  for (const u of SKIP_A2) if (byUser.get(u)?.[2]) fail(`${u}: played attempt 2 but never asked`);
  const bestOf = (u: string) => Math.max(byUser.get(u)?.[1]?.score ?? -1, byUser.get(u)?.[2]?.score ?? -1);
  for (const e of event.entrants) if (e.best !== bestOf(e.userId)) fail(`${e.userId}: best ${e.best} but runs ${byUser.get(e.userId)?.[1]?.score}/${byUser.get(e.userId)?.[2]?.score}`);
  const ranking: string[] = event.qual?.ranking ?? [];
  for (let i = 1; i < ranking.length; i += 1) if (bestOf(ranking[i]) > bestOf(ranking[i - 1])) fail(`rank ${i + 1} has a better best than rank ${i}`);
  event.entrants.forEach((e: any, i: number) => { if (e.seed !== i + 1 || ranking[i] !== e.userId) fail(`entrant ${i}: seed ${e.seed}, ranking ${ranking[i]} vs ${e.userId}`); });
  const tieIn = [...TIE].filter((u) => drawn.has(u));
  const tb = event.qual?.extraUserIds as string[] | undefined;
  console.log(`Tie at the cut: ${tb ? `${tb.length} tied (${tb.filter((u) => TIE.has(u)).length} of the forced ${TIE.size}) for ${event.qual.spots} places · extra runs ${stats.extraRuns} · tied bots drawn ${tieIn.length}` : 'none'} · TV/page saw tiebreak: ${!!qualSeen.tiebreak}`);
  if (TIE.size && BOTS >= 100) {
    if (!tb || !TIE.size || [...TIE].some((u) => !tb.includes(u))) fail('the forced tie at the cut was not played off');
    if (tb && tieIn.length + tb.filter((u) => !TIE.has(u) && drawn.has(u)).length !== event.qual.spots) fail(`tied drawn ${tieIn.length}, places ${event.qual.spots}`);
    if (!qualSeen.tiebreak) fail('no state showed the tiebreak');
  }
  const wantPhases = ['lobby', 'qualifier', 'bracket', 'done', ...(tb ? ['qualifier_tiebreak'] : [])];
  for (const p of wantPhases) if (!qualSeen.phases.has(p)) fail(`phase ${p} never seen in a state`);
  console.log(`Qualifier runs played back: ${runsChecked} · states with the qualifier checked: ${qualSeen.states} · phases seen: ${[...qualSeen.phases].join(', ')} · late joiners: attempt 1 refused ${stats.lateA1Refused}, attempt 2 played ${[...LATE].filter((u) => byUser.get(u)?.[2]).length} of ${LATE.size}`);
  // Ranks pair the bracket: 1 v last, 2 v last but one, ….
  const seedOf = new Map(event.entrants.map((e: any) => [e.userId, e.seed]));
  const r1 = matches.filter((m) => m.round === 1);
  const pairs = r1.map((m) => m.players.map((p: string) => seedOf.get(p)).sort((a: number, b: number) => a - b));
  for (const p of pairs) if (p[0] + p[1] !== cut + 1) fail(`round 1 pairs rank ${p[0]} with ${p[1]}`);
  console.log(`Round 1 (${event.rounds[0]?.label}): ${r1.length} matches, every one rank k v ${cut + 1}-k: ${pairs.every((p) => p[0] + p[1] === cut + 1)} · rounds: ${event.rounds.map((r: any) => r.label).join(', ')}`);
  console.log(`Ghosts (joined, then gone) left out: ${[...GHOSTS].length - ghostsIn.length} of ${GHOSTS.size}`);
  if (event.phase !== 'done' || !event.championId) fail(`no champion: phase ${event.phase}`);
  else console.log(`Champion: ${event.entrants.find((e: any) => e.userId === event.championId)?.name}`);
  const undecided = matches.filter((m) => m.status !== 'done');
  if (undecided.length) fail(`${undecided.length} matches not decided`);
  const wanted = event.rounds.reduce((s: number, r: any) => s + r.nodes.filter((x: any) => x.feeders.length === 2).length, 0);
  if (matches.length !== wanted) fail(`${matches.length} matches for ${wanted} places`);
  for (const r of event.rounds) if (!r.openedAt) fail(`${r.label} never opened`);
  // Every result is the server's run, played back again here from its events: the same score, from real words on the stops.
  let wordsChecked = 0;
  for (const m of matches) {
    if (m.decidedBy === 'played' || m.decidedBy === 'replays' || m.decidedBy === 'solo') {
      for (const p of m.players) {
        const live = m.live?.[p];
        const back = replayRun(live?.wtr ?? [], GAME.boards, m.seed, GAME.rules);
        if ((live?.score ?? 0) !== back.score) fail(`${m.id} ${p}: score ${live?.score} but its words make ${back.score}`);
        if ((m.result?.[p] ?? 0) !== back.score) fail(`${m.id} ${p}: result ${m.result?.[p]} but the run makes ${back.score}`);
        for (const e of live?.wtr ?? []) if (e[0] === 'w') {
          const st = GAME.boards(m.seed, e[1]);
          if (!st.words.has(e[2]) && !st.rare.has(e[2])) fail(`${m.id}: ${e[2]} taken on ${st.letters}`);
          wordsChecked += 1;
        }
      }
    }
  }
  console.log(`Words played back against the matches: ${wordsChecked}`);
  const by: Record<string, number> = {};
  for (const m of matches) by[m.decidedBy] = (by[m.decidedBy] ?? 0) + 1;
  console.log(`Decided by: ${JSON.stringify(by)}`);
  const replays = matches.filter((m) => (m.history?.length ?? 0) > 0);
  console.log(`Replays: ${replays.length} matches (${replays.map((m) => `${m.label} ×${m.history.length} → ${m.decidedBy}`).join(', ')})`);
  if (stats.forcedTies && !replays.length) fail('forced ties did not replay');
  const solos = matches.filter((m) => m.decidedBy === 'solo');
  for (const m of solos) if (!m.joined?.[m.winnerId]) fail(`${m.id}: solo won by someone who never joined`);
  console.log(`Solo (opponent a no-show): ${solos.map((m) => m.label).join(', ') || 'none'}`);
  console.log('\nWall-clock per round:');
  for (const round of event.rounds) {
    const end = round.closedAt ?? event.finishedAt;
    const s = end && round.openedAt ? (new Date(end).getTime() - new Date(round.openedAt).getTime()) / 1000 : NaN;
    const inRound = matches.filter((m) => m.round === round.n);
    console.log(`  ${round.label.padEnd(15)} ${round.kind.padEnd(10)} ${String(inRound.length).padStart(3)} matches  ${s.toFixed(1)} s`);
  }
  const bets = await db.collection('cup_bets').find({ eventId: EVENT_ID }).toArray();
  const held = bets.filter((b) => b.status === 'held').length;
  if (stats.mismatch) fail(`${stats.mismatch} words judged differently by the server and the game's rules`);
  console.log(`\nBets ${bets.length} (held after the end: ${held}) · bot stats ${JSON.stringify(stats)}`);
  if (held) fail(`${held} bets still held`);
  if (stats.junkTaken) fail(`${stats.junkTaken} junk words taken`);
  latencies.sort((a, b) => a - b);
  wordLat.sort((a, b) => a - b);
  const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  console.log(`Calls ${calls} · 5xx/failed ${callErrors} · latency p50 ${q(latencies, 0.5)} ms p95 ${q(latencies, 0.95)} ms p99 ${q(latencies, 0.99)} ms · word calls p50 ${q(wordLat, 0.5)} ms p95 ${q(wordLat, 0.95)} ms · views leak-checked ${viewsChecked} · TV max live matches with words ${maxLiveTv}`);
  if (callErrors) fail(`${callErrors} failed calls`);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const sum = Object.values(bytes).reduce((a, b) => a + b, 0);
  console.log(`\nBytes downloaded (${BOTS} pages + 1 TV, whole event): page ${mb(bytes.page)} · state polls ${mb(bytes.state)} · words ${mb(bytes.words)} · other calls ${mb(bytes.other)} · photos ${mb(bytes.photos)} (${photoLoads.bots} loads, avg ${(bytes.photos / Math.max(1, photoLoads.bots) / 1024).toFixed(1)} KB) · TV state ${mb(bytes.tvState)} · TV photos ${mb(bytes.tvPhotos)} (${photoLoads.tv} loads) · TOTAL ${mb(sum)}`);
  const gsum = Object.values(gz).reduce((a, b) => a + b, 0);
  console.log(`  On the wire (gzip): page ${mb(gz.page)} · state polls ${mb(gz.state)} · words ${mb(gz.words)} · photos ${mb(gz.photos)} · TV state ${mb(gz.tvState)} · TV photos ${mb(gz.tvPhotos)} · TOTAL ${mb(gsum)}`);
  console.log(`  The same photo loads at full size would have been ${mb((photoLoads.bots + photoLoads.tv) * photoBytes)}.`);
  console.log(`Total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  server.kill('SIGTERM');
  await sleep(1500);
  if (!server.killed) server.kill('SIGKILL');
  await client.close();
  console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
