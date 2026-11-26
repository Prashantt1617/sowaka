/**
 * A whole Word Trip Tournament played by bots against a backend started here,
 * on a scratch database (never a shared one): the lobby (with ghosts who join
 * and close the app, and last-second joiners), the draw, every round, no-shows
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
 * every live joiner in it; bets settled. Prints timings, latencies and bytes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { DEFAULT_CUP_CONFIG, newRun, playRunSkip, playRunWord, replayRun, runEndsSec } from '../services/cup-rules';
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
/** Join the lobby in its last second. */
const LATE = new Set([11, 33, 55].filter((i) => i < BOTS).map(id));

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
}

// ---------------------------------------------------------------- a bot

const stats = { words: 0, taken: 0, refused: 0, serverSaidNo: 0, mismatch: 0, skips: 0, junk: 0, junkTaken: 0, bets: 0, joins: 0, lobbyJoins: 0, solos: 0, forcedTies: 0 };
const sentOk = new Map<string, Set<string>>();
const lobbyOk = new Set<string>();
let done = false;
let startAtMs = 0;

async function bot(userId: string, ticket: string, linkTicket: string) {
  const seen = new Set<string>();
  const playing = new Set<string>();
  const betOn = new Set<string>();
  let joinedLobby = false;
  // The page itself, once (as the feed link opens it).
  const pageRes = await fetch(`${BASE}/cup/${EVENT_ID}?ticket=${encodeURIComponent(linkTicket)}`).catch(() => null);
  if (pageRes) {
    const b = Buffer.from(await pageRes.arrayBuffer());
    if (pageRes.status !== 200) fail(`page ${pageRes.status}: ${b.toString().slice(0, 100)}`);
    bytes.page += b.length;
    gz.page += wire(b);
  } else fail('page did not load');
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
    if (event?.lobbyOpen && !me.inLobby && !joinedLobby) {
      if (!LATE.has(userId) || Date.now() > startAtMs - 1200) {
        const r = await call(ticket, 'POST', `/cup/api/lobby?event=${EVENT_ID}`);
        if (r.status === 200) {
          joinedLobby = true;
          stats.lobbyJoins += 1;
          if (!GHOSTS.has(userId)) lobbyOk.add(userId);
        }
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
    await sleep(rand(1200, 1700));
  }
}

/**
 * Plays a match as a person plays the normal game: from the match's start, on the stop the run is on (the seed's,
 * dealt by Word Trip's own boardAt), words from its lists every 0.6-3.5 s, now and then the all-letter word (on to
 * the next stop), now and then a skip, a little junk; until the run's clock (1:00 + what it earned) runs out. The bot
 * keeps its own copy of the run with the same rules, so it knows its stop and clock as the game would.
 */
async function play(userId: string, ticket: string, first: any, serverNow: string) {
  const skew = new Date(serverNow).getTime() - Date.now();
  const startAt = new Date(first.startAt).getTime();
  const seed = Number(first.boardSeed);
  const key = `${userId}:${first.id}:${first.attempt}`;
  sentOk.set(key, new Set());
  const forcedTie = first.round === 1 && /Match [12]$/.test(first.label) && first.attempt === 0 && first.status === 'live';
  if (forcedTie) stats.forcedTies += 1;
  const wait = startAt - (Date.now() + skew);
  if (wait > 0) await sleep(wait + 30);
  const mine = newRun();
  const clock = () => (Date.now() + skew - startAt) / 1000;
  const send = async (body: Record<string, unknown>) => call(ticket, 'POST', `/cup/api/matches/${first.id}/word`, body, 'words');
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
  const skill = rand(0.25, 0.9);
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
  const deadline = Date.now() + 45 * 60_000;
  let lastRound = -1;
  let lastPhase = '';
  while (Date.now() < deadline) {
    const event = await db.collection('cup_events').findOne({ id: EVENT_ID });
    if (event?.round !== lastRound || event?.phase !== lastPhase) {
      lastRound = event?.round;
      lastPhase = event?.phase;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] phase ${event?.phase} round ${event?.round}${event?.round ? ` (${event.rounds[event.round - 1]?.label})` : ''}`);
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
  const lost = [...lobbyOk].filter((u) => !drawn.has(u));
  if (lost.length) fail(`lobby joiners not drawn: ${lost.join(', ')}`);
  console.log(`Ghosts (joined, then gone) left out: ${[...GHOSTS].length - ghostsIn.length} of ${GHOSTS.size} · late joiners drawn: ${[...LATE].filter((u) => drawn.has(u)).length} of ${LATE.size}`);
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
  console.log(`Words played back against the runs: ${wordsChecked}`);
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
