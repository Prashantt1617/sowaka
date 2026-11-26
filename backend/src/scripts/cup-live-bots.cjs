#!/usr/bin/env node
/**
 * Easy bots for a live Word Trip Tournament rehearsal in Sowaka Test: they join the lobby, play the
 * qualifier attempts (and the tie-break run, if theirs), and every match they are drawn into, as phones
 * do: over HTTP, through the same `/cup/api` routes the tournament page calls, with cup tickets minted
 * the way the feed card's are. Every word is checked by the server exactly like a phone's; nothing of
 * the game is written to the database here (it is only read: the accounts and the event).
 *
 * Plain JavaScript (CommonJS), so it runs on the server against the deployed build with no compile:
 *
 *   cd <backend dir>   # where .env is
 *   node --env-file=.env <path>/cup-live-bots.cjs --dist <backend>/dist --base http://127.0.0.1:<port> \
 *        --org sowaka --event <eventId> [--bots 12] [--level easy|medium|hard] [--late 2] [--exclude id1,id2] [--bet] [--dry-run]
 *
 * --dist: the backend's built `dist` folder (its services are required from there: tickets, the game's
 *         stops and rules); with `node --import tsx` the `src` folder works too.
 * --base: the backend itself (its own port on this machine), not the CDN.
 *
 * Safety: refuses unless --org sowaka and the event's org is sowaka; uses only existing accounts of
 * that company whose email ends with @sowaka.test (never creates or edits a user); skips --exclude and
 * anyone already in the lobby; picks the first N by email (the same every time).
 *
 * Levels: easy (the default): 3-4 letter words only, one every 6-10 s, now and then gives up early;
 * an all-letter word very rarely, so it mostly stays on the first stop or two. medium: 3-5 letters,
 * every 4-7 s. hard: any word, every 2-4 s, all-letter words often (for testing, it should win).
 * Ctrl-C / SIGTERM: stops at once. Exits when the event is done or removed.
 */
'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');

// ---------------------------------------------------------------- flags
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const DIST = path.resolve(String(flag('dist', path.resolve(__dirname, '..'))));
const BASE = String(flag('base', 'http://127.0.0.1:4000')).replace(/\/+$/, '');
const ORG = String(flag('org', ''));
const EVENT = String(flag('event', ''));
const N = Math.max(1, Math.min(60, Number(flag('bots', 12)) || 12));
const LEVEL = String(flag('level', 'easy'));
const LATE = Math.max(0, Number(flag('late', 0)) || 0);
const EXCLUDE = new Set(String(flag('exclude', '') === true ? '' : flag('exclude', '')).split(',').map((s) => s.trim()).filter(Boolean));
const BET = flag('bet', false) === true;
const DRY = flag('dry-run', false) === true;
const OFFSET = Math.max(0, Number(flag('offset', 0)) || 0);

const die = (msg) => {
  console.error(`cup-live-bots: ${msg}`);
  process.exit(2);
};
if (ORG !== 'sowaka') die('refused: --org sowaka only (Sowaka Test)');
if (!DRY && !EVENT) die('--event <id> is needed');
if (!['easy', 'medium', 'hard'].includes(LEVEL)) die('--level easy|medium|hard');
if (!process.env.MONGODB_URI) die('MONGODB_URI is not set (run with node --env-file=.env)');
if (!process.env.SCRIBBLE_TICKET_SECRET) die('SCRIBBLE_TICKET_SECRET is not set (run with node --env-file=.env)');

// The deployed build's own modules (and its node_modules).
const req = createRequire(path.join(DIST, 'index.js'));
const { MongoClient } = req('mongodb');
const { mintTicket } = req(path.join(DIST, 'services/scribble-ticket.service'));
const rules = req(path.join(DIST, 'services/cup-rules'));
const { loadWordTripGame } = req(path.join(DIST, 'services/cup-wordtrip-game'));

const LEVELS = {
  easy: { gap: [6000, 10000], maxLen: 4, fullChance: 0.03, quitChance: 0.3, quitAfter: [20, 45] },
  medium: { gap: [4000, 7000], maxLen: 5, fullChance: 0.1, quitChance: 0.1, quitAfter: [35, 55] },
  hard: { gap: [2000, 4000], maxLen: 99, fullChance: 0.35, quitChance: 0, quitAfter: [99, 99] },
};
const L = LEVELS[LEVEL];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (who, what) => console.log(`[${stamp()}] ${who.padEnd(10)} ${what}`);
let stopping = false;
const stopNow = (sig) => {
  if (stopping) process.exit(1);
  stopping = true;
  log('all', `${sig}: stopping`);
};
process.on('SIGINT', () => stopNow('SIGINT'));
process.on('SIGTERM', () => stopNow('SIGTERM'));

// ---------------------------------------------------------------- HTTP as the page does
async function api(bot, method, url, body) {
  const res = await fetch(`${BASE}/cup/api${url}`, {
    method,
    headers: { 'X-Cup-Ticket': bot.ticket, 'X-Cup-Event': EVENT, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { status: 0, j: null };
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {}
  return { status: res.status, j };
}

let GAME = null;
async function game(bot) {
  if (GAME) return GAME;
  const r = await api(bot, 'GET', '/wordtrip-game');
  if (r.status !== 200 || !r.j || typeof r.j.html !== 'string') throw new Error(`the game page: ${r.status}`);
  GAME = loadWordTripGame(r.j.html, r.j.version);
  return GAME;
}

// ---------------------------------------------------------------- a run, played slowly
/** One normal run (a qualifier attempt or a match), on its seed, as a weak player: words the server checks. */
async function play(bot, what, seed, startAt, serverNow, url) {
  const G = await game(bot);
  const skew = new Date(serverNow).getTime() - Date.now();
  const start = new Date(startAt).getTime();
  const clock = () => (Date.now() + skew - start) / 1000;
  const run = rules.newRun();
  const quitAt = Math.random() < L.quitChance ? rand(L.quitAfter[0], L.quitAfter[1]) : Infinity;
  if (clock() < 0) await sleep(-clock() * 1000 + 300);
  log(bot.tag, `${what}: playing (level ${LEVEL}${Number.isFinite(quitAt) ? `, gives up at ${quitAt.toFixed(0)} s` : ''})`);
  while (!stopping && clock() < rules.runEndsSec(run, G.rules) - 1) {
    await sleep(rand(L.gap[0], L.gap[1]));
    const t = clock();
    if (stopping || t >= rules.runEndsSec(run, G.rules) - 0.5) break;
    if (t > quitAt) {
      log(bot.tag, `${what}: stops early at ${t.toFixed(0)} s (score ${run.score})`);
      break;
    }
    if (t < run.stopFrom) continue;
    const stop = G.boards(seed, run.gi);
    const had = new Set((run.found[run.gi] || []).map((x) => x[0]));
    const left = [...stop.words].filter((w) => !had.has(w));
    const full = left.filter((w) => w.length === stop.len);
    const short = left.filter((w) => w.length >= 3 && w.length <= L.maxLen && w.length < stop.len);
    const word = full.length && (Math.random() < L.fullChance || !short.length) ? pick(full) : pick(short);
    if (!word) continue;
    const r = await api(bot, 'POST', url, { stop: run.gi, word, t });
    if (r.status === 409 || r.status === 404) {
      log(bot.tag, `${what}: run over (${r.j && r.j.message})`);
      break;
    }
    if (r.status === 200 && r.j && r.j.verdict && r.j.verdict.ok) {
      rules.playRunWord(run, stop, run.gi, word, t, G.rules);
      log(bot.tag, `${what}: ${word} +${r.j.verdict.pts} → ${r.j.score}${r.j.verdict.full ? ' (all letters: next stop)' : ''}`);
    } else log(bot.tag, `${what}: ${word} not taken (${r.status} ${r.j && r.j.verdict ? r.j.verdict.reason : r.j && r.j.message})`);
  }
  log(bot.tag, `${what}: done, ${run.total} words, ${run.score} points`);
}

// ---------------------------------------------------------------- a bot
async function bot(b) {
  const tried = new Set();
  const playing = new Set();
  const betOn = new Set();
  let version = null;
  let state = null;
  let quiet = 0;
  while (!stopping) {
    const r = await api(b, 'GET', `/state?event=${encodeURIComponent(EVENT)}${version ? `&since=${version}` : ''}`);
    if (r.status !== 200 || !r.j) {
      if (++quiet % 10 === 1) log(b.tag, `state ${r.status} ${(r.j && r.j.message) || ''}`);
      await sleep(3000);
      continue;
    }
    quiet = 0;
    if (!r.j.unchanged) {
      state = r.j;
      version = String(r.j.version);
    }
    const ev = state && state.event;
    if (!ev || ev.id !== EVENT) {
      log(b.tag, 'the event is gone: leaving');
      return;
    }
    const me = state.me || {};
    const qs = state.qualifier;
    // The lobby: at once, or (a late joiner) once attempt 1's window has closed.
    if (ev.lobbyOpen && !me.inLobby && !b.inLobby) {
      const lateOk = !b.late || (qs && ((qs.stage === 'a1' && Date.now() > qs.windowEndsAt + 1000) || qs.stage === 'a2'));
      if (lateOk) {
        const j = await api(b, 'POST', `/lobby?event=${encodeURIComponent(EVENT)}`);
        if (j.status === 200) {
          b.inLobby = true;
          log(b.tag, `joined the lobby${b.late ? ' (late: attempt 2 only)' : ''}`);
        } else if (!b.lobbyRefused) {
          b.lobbyRefused = true;
          log(b.tag, `lobby refused: ${j.status} ${j.j && j.j.message}`);
        }
        version = null;
      }
    }
    // The qualifier: the attempt open now (the tie-break run only if theirs).
    const q = me.qual;
    if (q && q.canJoin) {
      const att = q.stage === 'a1' ? 1 : q.stage === 'a2' ? 2 : 3;
      if (!tried.has(att)) {
        tried.add(att);
        await sleep(rand(1500, 5000));
        const j = await api(b, 'POST', `/qualifier/join?event=${encodeURIComponent(EVENT)}`);
        if (j.status === 200 && j.j && j.j.run) {
          const run = j.j.run;
          void play(b, att === 3 ? 'tie-break run' : `attempt ${att}`, Number(run.seed), run.startAt, j.j.serverNow, `/runs/${encodeURIComponent(run.id)}/word`);
        } else log(b.tag, `attempt ${att} refused: ${j.status} ${j.j && j.j.message}`);
        version = null;
      }
    }
    // A match: ready at once, then the run.
    const m = me.match;
    if (m) {
      if (m.status === 'open' && !m.joined && !b.joined.has(`${m.id}:${m.attempt}`)) {
        b.joined.add(`${m.id}:${m.attempt}`);
        await sleep(rand(1000, 4000));
        const j = await api(b, 'POST', `/matches/${encodeURIComponent(m.id)}/join`);
        log(b.tag, `${m.label || m.id}: ready (${j.status})`);
        version = null;
      } else if ((m.status === 'live' || m.status === 'solo') && m.startAt && m.boardSeed && !playing.has(`${m.id}:${m.attempt}`)) {
        playing.add(`${m.id}:${m.attempt}`);
        void play(b, `${m.label || m.id}${m.attempt ? ` replay ${m.attempt}` : ''}`, Number(m.boardSeed), m.startAt, state.serverNow, `/matches/${encodeURIComponent(m.id)}/word`);
      }
    }
    // Bets (only with --bet): 100 on either player of the match on stage.
    if (BET && state.current && state.current.kind === 'betting' && !betOn.has(state.current.matchId)) {
      betOn.add(state.current.matchId);
      const stage = (ev.rounds || []).flatMap((x) => x.matches || []).find((x) => x.id === state.current.matchId);
      if (stage && stage.a && stage.b && stage.a.userId !== b.userId && stage.b.userId !== b.userId) {
        const j = await api(b, 'POST', `/bets?event=${encodeURIComponent(EVENT)}`, { matchId: stage.id, pick: pick([stage.a.userId, stage.b.userId]), stake: 100 });
        log(b.tag, `bet 100 on ${stage.label || stage.id}: ${j.status}`);
      }
    }
    if (ev.phase === 'done') {
      log(b.tag, 'the tournament is over');
      return;
    }
    await sleep(rand(2300, 2800));
  }
}

// ---------------------------------------------------------------- main
async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB || 'sowaka');
    let lobby = [];
    if (EVENT) {
      const event = await db.collection('cup_events').findOne({ id: EVENT }, { projection: { _id: 0, id: 1, org: 1, name: 1, gameKey: 1, phase: 1, lobbyJoined: 1 } });
      if (!event) die(`no event ${EVENT}`);
      if (event.org !== 'sowaka') die(`refused: event ${EVENT} is ${event.org}'s, not Sowaka Test's`);
      if (event.gameKey !== 'word-trip') die(`refused: event ${EVENT} is not a Word Trip tournament`);
      lobby = event.lobbyJoined || [];
      log('all', `event ${event.id} "${event.name}" (${event.phase}), ${lobby.length} in the lobby`);
    }
    const users = await db
      .collection('users')
      .find({ org: 'sowaka', email: { $regex: /@sowaka\.test$/i } }, { projection: { _id: 0, userId: 1, name: 1, email: 1, lifecycleStatus: 1 } })
      .sort({ email: 1 })
      .toArray();
    const ok = users.filter((u) => /@sowaka\.test$/i.test(u.email) && !EXCLUDE.has(u.userId) && !lobby.includes(u.userId) && (!u.lifecycleStatus || u.lifecycleStatus === 'active'));
    const chosen = ok.slice(OFFSET, OFFSET + N);
    if (!chosen.length) die('no @sowaka.test accounts free to use');
    const late = new Set(chosen.slice(-LATE).map((u) => u.userId));
    console.log(`${chosen.length} bot(s), level ${LEVEL}${LATE ? `, ${late.size} late` : ''} (of ${ok.length} @sowaka.test accounts free):`);
    for (const u of chosen) console.log(`  ${u.email.padEnd(32)} ${u.name}${late.has(u.userId) ? '  (late)' : ''}`);
    if (DRY) return;
    const bots = chosen.map((u, i) => ({
      userId: u.userId,
      tag: `bot${String(i + 1).padStart(2, '0')}`,
      name: u.name,
      late: late.has(u.userId),
      ticket: mintTicket({ userId: u.userId, org: 'sowaka', name: u.name }, { ttlMs: 6 * 3600_000 }),
      joined: new Set(),
    }));
    for (const b of bots) log(b.tag, `${b.name} <${chosen.find((u) => u.userId === b.userId).email}>`);
    await Promise.all(bots.map((b) => bot(b).catch((e) => log(b.tag, `error: ${e && e.message}`))));
  } finally {
    await client.close().catch(() => {});
  }
  log('all', stopping ? 'stopped' : 'all bots finished');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
