/**
 * A whole Knights Tournament played by bots against a backend started here,
 * on a scratch database (never a shared one): the lobby, the draw, every
 * round, the betting gaps on the last eight, ties replayed on a new board,
 * resignations and no-shows, to a champion. Bots read only what a page reads
 * (`/cup/api/state`): they find the answer by looking the board's regions up
 * in the bank, as nothing in the state gives it away before the decision.
 *
 *   # a mongod (replica set rs0) on 127.0.0.1:27133, then:
 *   node --import tsx src/scripts/knights-bot-run.ts [--bots 64] [--port 4155] [--round 40]
 *
 * Checks: a champion; every match decided; each round's grid is gridFor's;
 * no solution or right count in any view of a match not yet decided; round 1
 * ties (forced) replay on another board. Prints wall-clock per round.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import knightsBank from '../content/knights-boards.json';
import { DEFAULT_CUP_CONFIG, gridFor, type KnightsBank } from '../services/cup-rules';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BOTS = Number(arg('bots', '64'));
const PORT = Number(arg('port', '4155'));
const ROUND_SEC = Number(arg('round', '40'));
const MONGO = arg('mongo', 'mongodb://127.0.0.1:27133');
const DB = arg('db', 'knights_bots');
if (!/^knights_/.test(DB) || !/127\.0\.0\.1|localhost/.test(MONGO)) throw new Error('Scratch databases on this machine only');
const SECRET = 'knights-bot-run-secret';
const BASE = `http://127.0.0.1:${PORT}`;
const EVENT_ID = 'knights-bots';
const ORG = 'sowaka';
const NO_SHOW = new Set(['bot-07', 'bot-21']);
const bank = knightsBank as unknown as KnightsBank;

process.env.SCRIBBLE_TICKET_SECRET = SECRET;
process.env.MONGODB_URI = MONGO;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const failures: string[] = [];
const fail = (msg: string) => {
  if (failures.length < 50) console.log(`FAIL ${msg}`);
  failures.push(msg);
};

// ---------------------------------------------------------------- setup

async function seed(client: MongoClient) {
  const db = client.db(DB);
  await db.dropDatabase();
  const now = new Date();
  await db.collection('companies').insertOne({ id: ORG, name: 'Sowaka Test', createdAt: now, updatedAt: now });
  const users = Array.from({ length: BOTS }, (_, i) => {
    const id = `bot-${String(i + 1).padStart(2, '0')}`;
    return { userId: id, name: `Bot ${i + 1}`, org: ORG, email: `${id}@sowaka.test`, lifecycleStatus: 'active', points: 0, createdAt: now, updatedAt: now };
  });
  await db.collection('users').insertMany(users);
  const event = {
    ...DEFAULT_CUP_CONFIG,
    gameKey: 'knights',
    roundSec: ROUND_SEC,
    startWindowSec: 8,
    soloStartSec: 10,
    bettingSec: 5,
    countdownSec: 4,
    minPlaySec: 5,
    topN: 8,
    walletStart: 1000,
    lobbyDraw: true,
    maxReplays: 2,
    pushAtLobby: false,
    id: EVENT_ID,
    org: ORG,
    name: 'Knights Tournament',
    active: true,
    lobbyAt: new Date(now.getTime() + 3000),
    startAt: new Date(now.getTime() + 25_000),
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
  return users.map((u) => u.userId);
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
  const log = createWriteStream(path.join(process.env.BOT_LOG_DIR ?? '/tmp', 'knights-bot-server.log'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      MONGODB_URI: `${MONGO}/?replicaSet=rs0&directConnection=true`,
      MONGODB_DB: DB,
      CUP_RUNNER_ORGS: ORG,
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

// ---------------------------------------------------------------- calls

let calls = 0;
let callErrors = 0;
const latencies: number[] = [];

async function call(ticket: string, method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ status: number; text: string }> {
  const t = Date.now();
  calls += 1;
  try {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'X-Cup-Ticket': ticket, 'X-Cup-Event': EVENT_ID, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    latencies.push(Date.now() - t);
    if (res.status >= 500) callErrors += 1;
    return { status: res.status, text };
  } catch (error) {
    callErrors += 1;
    return { status: 0, text: String(error) };
  }
}

// ---------------------------------------------------------------- the leak check

type View = Record<string, unknown> & { status?: string; knights?: { n: number; g: number[]; solution?: number[] }; id?: string };

let viewsChecked = 0;
function checkView(where: string, m: View | undefined) {
  if (!m || typeof m !== 'object') return;
  viewsChecked += 1;
  if (m.status !== 'done') {
    if (m.knights?.solution) fail(`${where} ${m.id}: solution in a ${m.status} view`);
    if ('solution' in m) fail(`${where} ${m.id}: solution key in a ${m.status} view`);
    if ('right' in m && m.right !== undefined) fail(`${where} ${m.id}: right in a ${m.status} view`);
    if (m.live !== undefined) fail(`${where} ${m.id}: live scores in a knights view`);
    if (m.result !== undefined && m.status !== 'open') fail(`${where} ${m.id}: result before the decision`);
  }
}

function checkState(state: Record<string, any>) {
  for (const round of state.event?.rounds ?? []) for (const m of round.matches ?? []) checkView('bracket', m);
  checkView('me', state.me?.match);
}

/** The answer, as a bot finds it: the board's regions looked up in the bank. */
function answerFor(knights: { n: number; g: number[] }): number[] | null {
  const key = knights.g.join(',');
  return bank[String(knights.n)]?.find((b) => b.g.join(',') === key)?.s ?? null;
}

// ---------------------------------------------------------------- a bot

interface Stats {
  finished: number;
  resigned: number;
  wrongFirst: number;
  slow: number;
  bets: number;
  reports: number;
  refused: number;
}
const stats: Stats = { finished: 0, resigned: 0, wrongFirst: 0, slow: 0, bets: 0, reports: 0, refused: 0 };
const forcedTieBoards = new Map<string, string>();
const replayBoards = new Map<string, string>();
let done = false;

async function bot(userId: string, ticket: string) {
  const playing = new Set<string>();
  let joinedLobby = false;
  const betOn = new Set<string>();
  let lastMatch: string | null = null;
  while (!done) {
    const res = await call(ticket, 'GET', `/cup/api/state?event=${EVENT_ID}`);
    if (res.status !== 200) {
      await sleep(1000);
      continue;
    }
    const state = JSON.parse(res.text);
    checkState(state);
    const event = state.event;
    const me = state.me ?? {};
    if (event?.lobbyOpen && !me.inLobby && !joinedLobby) {
      const r = await call(ticket, 'POST', `/cup/api/lobby?event=${EVENT_ID}`);
      if (r.status === 200) joinedLobby = true;
    }
    const m = me.match as View | undefined;
    if (m && !NO_SHOW.has(userId)) {
      lastMatch = m.id ?? null;
      if (m.status === 'open' && !m.joined) {
        await sleep(rand(100, 2500));
        await call(ticket, 'POST', `/cup/api/matches/${m.id}/join`);
      } else if (m.status === 'solo' && !m.startAt) {
        await sleep(rand(200, 2000));
        await call(ticket, 'POST', `/cup/api/matches/${m.id}/solo`);
      } else if (m.status === 'live' && m.knights && m.startAt) {
        const key = `${m.id}:${m.attempt}`;
        if (!playing.has(key)) {
          playing.add(key);
          void play(userId, ticket, m as View & { attempt: number; round: number; startAt: string; label: string }, state.serverNow);
        }
      }
    }
    // Spectators back a player in the betting lobby.
    if (state.current?.kind === 'betting' && !betOn.has(state.current.matchId) && Math.random() < 0.6) {
      const stage = (event?.rounds ?? []).flatMap((r: any) => r.matches).find((x: any) => x.id === state.current.matchId);
      if (stage && stage.a && stage.b && stage.a.userId !== userId && stage.b.userId !== userId) {
        betOn.add(state.current.matchId);
        const r = await call(ticket, 'POST', `/cup/api/bets?event=${EVENT_ID}`, { matchId: stage.id, pick: pick([stage.a.userId, stage.b.userId]), stake: Math.ceil(rand(10, 200)) });
        if (r.status === 200) stats.bets += 1;
      }
    }
    if (event?.phase === 'done') return;
    await sleep(rand(600, 1000));
  }
  void lastMatch;
}

async function play(userId: string, ticket: string, m: View & { attempt: number; round: number; startAt: string; label: string }, serverNow: string) {
  const answer = answerFor(m.knights!);
  if (!answer) {
    fail(`${m.id}: board not in the bank`);
    return;
  }
  const boardKey = m.knights!.g.join(',');
  const wait = new Date(m.startAt).getTime() - new Date(serverNow).getTime();
  if (wait > 0) await sleep(wait + 50);
  const n = m.knights!.n;
  const report = async (knights: number[]) => {
    stats.reports += 1;
    const r = await call(ticket, 'POST', `/cup/api/matches/${m.id}/live`, { knights });
    if (r.status !== 204) stats.refused += 1;
    return r.status;
  };
  // Round 1, the first three matches, first attempt: both play slow with 2 right, a forced tie (replay on a new board).
  const forcedTie = m.round === 1 && /Match [123]$/.test(m.label) && m.attempt === 0;
  if (forcedTie) forcedTieBoards.set(m.id!, boardKey);
  if (m.attempt > 0) replayBoards.set(`${m.id}:${m.attempt}`, boardKey);
  const roll = Math.random();
  if (!forcedTie && roll < 0.08) {
    await sleep(rand(1000, 6000));
    const r = await call(ticket, 'POST', `/cup/api/matches/${m.id}/resign`);
    if (r.status === 200) stats.resigned += 1;
    return;
  }
  const slow = forcedTie || roll < 0.3;
  const wrong = [...Array(n * n).keys()].filter((c) => !answer.includes(c));
  let board: number[] = [];
  if (Math.random() < 0.35) {
    stats.wrongFirst += 1;
    board = [pick(wrong)];
    await sleep(rand(300, 1500));
    if ((await report(board)) !== 204) return;
    await sleep(rand(300, 1500));
    board = [];
    if ((await report(board)) !== 204) return;
  }
  const order = [...answer].sort(() => Math.random() - 0.5);
  // Forced ties place exactly 2; other slow players 1-3, so the cap decides some by more right.
  const target = forcedTie ? 2 : slow ? 1 + Math.floor(Math.random() * 3) : n;
  if (slow) stats.slow += 1;
  // A solver takes 1-4 s a knight; slow players place two and stop (the cap decides).
  for (const cell of order.slice(0, target)) {
    await sleep(rand(800, ROUND_SEC * 1000 / n * 0.9));
    board = [...board, cell];
    const status = await report(board);
    if (status !== 204) return;
  }
  if (!slow) stats.finished += 1;
}

// ---------------------------------------------------------------- the run

async function main() {
  const t0 = Date.now();
  await replicaSet();
  const client = await MongoClient.connect(`${MONGO}/?replicaSet=rs0&directConnection=true`);
  const ids = await seed(client);
  console.log(`Seeded ${ids.length} bots in ${DB}; starting the backend on ${PORT}`);
  const server = startServer();
  const { mintTicket } = await import('../services/scribble-ticket.service');
  const tickets = new Map(ids.map((id) => [id, mintTicket({ userId: id, org: ORG, name: id }, { ttlMs: 3 * 3600_000 })]));
  for (let i = 0; i < 120; i += 1) {
    const r = await call(tickets.get(ids[0])!, 'GET', `/cup/api/state?event=${EVENT_ID}`);
    if (r.status === 200) break;
    await sleep(1000);
  }
  // Connection refusals while it booted are not failures.
  callErrors = 0;
  calls = 0;
  console.log(`Backend up after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const bots = ids.map((id) => bot(id, tickets.get(id)!));
  const db = client.db(DB);
  const deadline = Date.now() + 40 * 60_000;
  let lastRound = -1;
  while (Date.now() < deadline) {
    const event = await db.collection('cup_events').findOne({ id: EVENT_ID });
    if (event?.round !== lastRound) {
      lastRound = event?.round;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] phase ${event?.phase} round ${event?.round}`);
    }
    if (event?.phase === 'done') break;
    await sleep(1000);
  }
  done = true;
  await Promise.race([Promise.all(bots), sleep(5000)]);

  // ---------------------------------------------------------------- verify
  const event = (await db.collection('cup_events').findOne({ id: EVENT_ID }))!;
  const matches = await db.collection('cup_matches').find({ eventId: EVENT_ID }).toArray();
  const total = event.rounds.length;
  console.log(`\nEntrants ${event.entrants.length} · rounds ${total} · matches ${matches.length}`);
  if (event.phase !== 'done' || !event.championId) fail(`no champion: phase ${event.phase}`);
  else console.log(`Champion: ${event.entrants.find((e: any) => e.userId === event.championId)?.name}`);
  const undecided = matches.filter((m) => m.status !== 'done');
  if (undecided.length) fail(`${undecided.length} matches not decided`);
  const wanted = event.rounds.reduce((s: number, r: any) => s + r.nodes.filter((x: any) => x.feeders.length === 2).length, 0);
  if (matches.length !== wanted) fail(`${matches.length} matches for ${wanted} places`);
  // The grids, as the page sees them: the final state's bracket (done matches carry knights.n and the solution).
  const anyTicket = tickets.get(ids[0])!;
  const final = JSON.parse((await call(anyTicket, 'GET', `/cup/api/state?event=${EVENT_ID}`)).text);
  const gridsSeen: string[] = [];
  for (const round of final.event.rounds) {
    const ns = new Set(round.matches.map((m: any) => m.knights?.n));
    const expect = gridFor(round.n, total);
    if (ns.size !== 1 || !ns.has(expect)) fail(`round ${round.n}: grids ${[...ns].join(',')} (want ${expect})`);
    for (const m of round.matches) {
      if (!m.knights?.solution || !m.right || !m.placed) fail(`${m.id}: done view without solution/right/placed`);
      if (!m.result || !m.result.right || !m.result.winnerId) fail(`${m.id}: result shape ${JSON.stringify(m.result)}`);
    }
    gridsSeen.push(`${round.label}: ${expect}x${expect}`);
  }
  console.log(`Grids: ${gridsSeen.join(' · ')}`);
  const by: Record<string, number> = {};
  for (const m of matches) by[m.decidedBy] = (by[m.decidedBy] ?? 0) + 1;
  console.log(`Decided by: ${JSON.stringify(by)}`);
  const replays = matches.filter((m) => (m.history?.length ?? 0) > 0);
  console.log(`Replays: ${replays.length} matches (${replays.map((m) => `${m.label} x${m.history.length}`).join(', ')})`);
  for (const [id, key] of forcedTieBoards) {
    const m = matches.find((x) => x.id === id)!;
    if (!m.history?.length && m.decidedBy !== 'resigned' && m.decidedBy !== 'absent' && m.decidedBy !== 'solo') fail(`${id}: forced tie did not replay (${m.decidedBy})`);
    const next = replayBoards.get(`${id}:1`);
    if (next && next === key) fail(`${id}: replay on the same board`);
    if (m.history?.length) console.log(`  ${m.label}: tie ${JSON.stringify(m.history[0].scores)} -> replay on ${next && next !== key ? 'a new board' : '?'}; then ${m.decidedBy}`);
  }
  console.log('\nWall-clock per round:');
  for (const round of event.rounds) {
    const ms = round.closedAt && round.openedAt ? new Date(round.closedAt).getTime() - new Date(round.openedAt).getTime() : NaN;
    const ms2 = Number.isNaN(ms) && round.openedAt ? new Date(event.finishedAt).getTime() - new Date(round.openedAt).getTime() : ms;
    const inRound = matches.filter((m) => m.round === round.n);
    console.log(`  ${round.label.padEnd(15)} ${round.kind.padEnd(10)} ${String(inRound.length).padStart(2)} matches  ${(ms2 / 1000).toFixed(1)} s`);
  }
  const bets = await db.collection('cup_bets').find({ eventId: EVENT_ID }).toArray();
  const held = bets.filter((b) => b.status === 'held').length;
  console.log(`\nBets ${bets.length} (held after the end: ${held}) · bot stats ${JSON.stringify(stats)}`);
  if (held) fail(`${held} bets still held`);
  latencies.sort((a, b) => a - b);
  const q = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  console.log(`Calls ${calls} · 5xx/failed ${callErrors} · latency p50 ${q(0.5)} ms p95 ${q(0.95)} ms p99 ${q(0.99)} ms · views leak-checked ${viewsChecked}`);
  if (callErrors) fail(`${callErrors} failed calls`);
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
