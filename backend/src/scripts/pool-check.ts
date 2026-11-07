/**
 * Sowaka Pool's rooms, end to end on a scratch database and real sockets:
 * the page's ticket, hosting, joining by code and by quick join, a third
 * player refused, invites (a colleague, a card, a push; another company
 * refused), the host starting, a legal break the engine rules (a pot on it
 * gives the breaker its group), a shot out of turn, ball-in-hand placement,
 * the shot clock fouling through the tick, a game played to the 8 (any
 * pocket; scores recorded, points paid once), a rematch the loser breaks, a
 * reconnect, a forfeit by absence, and the last one out deleting the room.
 * Then a table for four: seats and sides, the innings rotating within a side,
 * a leaver dropped from the rotation, a whole side leaving, final lines per
 * player, the losing side's lower seat breaking the rematch, and quick join
 * by size; last, a room stored by the build before, read whole and played
 * on. The clock is moved by hand.
 *
 *   MONGODB_DB=pool_check npx tsx src/scripts/pool-check.ts
 *
 * No REDIS_URL: the store runs in memory. The database is dropped afterwards.
 */
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, gameCatalog, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { PoolRoom, PoolView } from '../models/pool.model';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import { closePoolRealtime, initPoolRealtime } from '../services/pool-realtime.service';
import { configurePool, peekRoom, tickPool, type PoolAward } from '../services/pool-room.service';
import { POOL } from '../services/pool-rooms-engine';
import { createRoom, mutateRoom, resetPoolMemory, setSeat } from '../services/pool-store';
import { mintTicket } from '../services/scribble-ticket.service';
import type { Ball, Group, RuleState } from '../shared/pool/engine';

let failures = 0;
let passes = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  else passes += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Real time, not the game's clock: for what waits on the database or a socket (a welcome, a goodbye, a push). */
async function until(done: () => boolean | Promise<boolean>, ms = 8000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await done()) return true;
    await wait(40);
  }
  return done();
}
/** Ticks the rooms (the timer may be mid-pass, so more than once) until `done` holds. */
async function settle(done: () => boolean | Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 20; i += 1) {
    await tickPool();
    await wait(30);
    if (await done()) return true;
  }
  return done();
}

const ORG = 'sowaka';
const OTHER = 'elsewhere';
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const clock = { now: Date.UTC(2026, 10, 6, 6, 0, 0) };
const pushes: { userIds: string[]; title: string; scenario: string; data: Record<string, unknown> }[] = [];
const scores: { org: string; userId: string; score: number }[] = [];
const awards: PoolAward[] = [];

let seed = 7;
const die = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

interface Client {
  user: User;
  socket: ClientSocket;
  room: PoolView | null;
  states: number;
  feed: { kind: string; userId?: string; text?: string }[];
  invites: { code: string; from: { userId: string } }[];
}

const seedUser = (i: number, org = ORG): User =>
  ({ userId: `pl-u${i}`, name: `Pool Player ${i}`, email: `p${i}@${org}.local`, employeeId: `PL-${i}`, org, lifecycleStatus: 'active', location: 'Gurgaon' }) as User;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ack = { ok: true; data: Record<string, any> } | { ok: false; status: number; message: string };
const request = (c: Client, event: string, payload: Record<string, unknown> = {}) =>
  new Promise<Ack>((resolve) => c.socket.timeout(4000).emit(event, payload, (err: unknown, res: Ack) => resolve(err ? { ok: false, status: 0, message: 'timeout' } : res)));

function open(user: User): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(`${BASE}/pool`, {
      path: '/connect/socket',
      transports: ['websocket'],
      auth: { ticket: mintTicket({ userId: user.userId, org: user.org ?? ORG, name: user.name }) },
      reconnection: false,
    });
    const c: Client = { user, socket, room: null, states: 0, feed: [], invites: [] };
    socket.on('room:state', (p: { room: PoolView | null }) => {
      c.room = p.room;
      c.states += 1;
    });
    socket.on('room:feed', (item: { kind: string; userId?: string; text?: string }) => c.feed.push(item));
    socket.on('room:invite', (p: { code: string; from: { userId: string } }) => c.invites.push(p));
    socket.on('connect', () => resolve(c));
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

const ballOn = (view: PoolView | null | undefined, n: number) => view?.balls.find((b) => b.n === n);

async function main() {
  if (!/^(pool_)?check$/.test(env.mongoDbName) && !/scratch/i.test(env.mongoDbName)) {
    console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=pool_check.`);
    process.exit(1);
  }
  if (process.env.REDIS_URL) {
    console.error('Run without REDIS_URL: this check uses the in-memory store.');
    process.exit(1);
  }
  let server: ReturnType<typeof app.listen> | undefined;
  const clients: Client[] = [];
  try {
    await connectDb();
    await getDb().dropDatabase();
    resetPoolMemory();
    configurePool({
      now: () => clock.now,
      random: die,
      notify: async (userIds, input) => void pushes.push({ userIds, title: input.title, scenario: input.scenario, data: input.data ?? {} }),
      recordScore: async (org, player, score) => void scores.push({ org, userId: player.userId, score }),
      awardPoints: async (award) => void awards.push(award),
    });
    const people = Array.from({ length: 5 }, (_, i) => seedUser(i + 1));
    const stranger = seedUser(9, OTHER);
    await users().insertMany([...people, stranger]);
    await companies().insertMany([
      { id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['pool'] },
      { id: OTHER, name: 'Elsewhere', enabledTabs: ['games'], enabledGames: ['pool'] },
    ] as never[]);
    const created = new Date();
    await gameCatalog().insertOne({
      key: 'pool', name: 'Sowaka Pool', kind: 'web', order: 70, active: true,
      scoring: { higherIsBetter: true, label: 'points', max: 20000 },
      html: '<!doctype html><html><head><meta charset="utf-8"><title>Sowaka Pool</title>\n<!--POOL-TICKET-->\n</head><body>page</body></html>',
      createdAt: created, updatedAt: created,
    } as never);
    const session = `tok-${randomUUID()}`;
    await authSessions().insertOne({ tokenHash: hashSessionToken(session), userId: people[0].userId, createdAt: created, expiresAt: new Date(Date.now() + 3_600_000) } as never);

    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const io = initConnectRealtime(server);
    initPoolRealtime(io);

    // ------------------------------------------------------------ the page and hello
    console.log('the page');
    const page = await fetch(`${BASE}/play/pool`, { headers: { authorization: `Bearer ${session}` } });
    check('the page is served with its ticket as window.__POOL', page.status === 200 && /window\.__POOL=\{"ticket":/.test(await page.text()));
    for (const user of people.slice(0, 4)) clients.push(await open(user));
    const [A, B, C, D] = clients;
    const hello0 = await request(A, 'room:hello');
    check('hello with no room: nothing to show yet', hello0.ok && hello0.data.room === null && Array.isArray(hello0.data.rooms) && hello0.data.rooms.length === 0 && hello0.data.invites.length === 0);

    // ------------------------------------------------------------ hosting, invites, joining
    console.log('\nhosting and joining');
    const hosted = await request(A, 'room:host', { open: true });
    const code = hosted.ok ? String(hosted.data.code) : '';
    check('A hosts an open room with a four-digit code, in its lobby, seat 0, a table for two by default', hosted.ok && /^[1-9]\d{3}$/.test(code) && hosted.data.hostId === A.user.userId && hosted.data.open === true && hosted.data.status === 'lobby' && hosted.data.turn === 0 && hosted.data.shooter === 0 && hosted.data.size === 2 && hosted.data.players.length === 1 && hosted.data.players[0].team === 0);
    const outsider = await request(A, 'room:invite', { userId: stranger.userId });
    check('someone at another company cannot be invited', !outsider.ok && outsider.status === 404);
    const nobody = await request(A, 'room:invite', { userId: 'nobody-here' });
    check('nor someone who does not exist', !nobody.ok && nobody.status === 404);
    const inv = await request(A, 'room:invite', { userId: C.user.userId });
    await until(() => C.invites.length > 0);
    check('A invites C: a card at once', inv.ok && C.invites.some((i) => i.code === code && i.from.userId === A.user.userId));
    const push = pushes.find((p) => p.userIds[0] === C.user.userId);
    check('and a pool_invite push that opens this room', !!push && push.scenario === 'pool_invite' && /invited you to Sowaka Pool/.test(push.title) && push.data.gameKey === 'pool' && push.data.challengeId === `room:${code}` && push.data.destination === 'game_challenge');
    const helloB = await request(B, 'room:hello');
    check("B's hello lists A's room with its size and a seat free", helloB.ok && helloB.data.rooms.some((r: { code: string; host: { userId: string }; size: number; seatFree: boolean; status: string }) => r.code === code && r.host.userId === A.user.userId && r.size === 2 && r.seatFree && r.status === 'lobby'));
    const bad = await request(B, 'room:join', { code: code === '1000' ? '1001' : '1000' });
    check('a code with no room: not found', !bad.ok && bad.status === 404);
    const joined = await request(B, 'room:join', { code: `room:${code}` });
    check('B joins by code as seat 1, side 1', joined.ok && joined.data.players.length === 2 && joined.data.players[1].userId === B.user.userId && joined.data.players[1].team === 1);
    const third = await request(C, 'room:join', { code });
    check('a third player is refused with a plain message', !third.ok && third.status === 409 && third.message === 'That table is full.');
    const invFull = await request(A, 'room:invite', { userId: D.user.userId });
    check('and cannot be invited to a full table', !invFull.ok && invFull.status === 409);
    const quickC = await request(C, 'room:quick');
    const code2 = quickC.ok ? String(quickC.data.code) : '';
    check('C quick-joins: no room with a seat, so a new open room of their own', quickC.ok && code2 !== code && quickC.data.hostId === C.user.userId && quickC.data.open === true);
    const quickD = await request(D, 'room:quick');
    check("D quick-joins: into C's room", quickD.ok && quickD.data.code === code2 && quickD.data.players.length === 2);
    await request(D, 'room:leave');
    await request(C, 'room:leave');
    check('the last one out deletes the room', (await peekRoom(ORG, code2)) === null);
    // A die that always lands on A's code: no new room can be made.
    configurePool({ random: () => (Number(code) - 1000 + 0.5) / 9000 });
    const unmade = await request(B, 'room:host', {});
    configurePool({ random: die });
    check('a room that cannot be made (503) leaves B seated where they were', !unmade.ok && unmade.status === 503 && (await peekRoom(ORG, code))?.players.length === 2 && (await request(B, 'room:hello')).ok);
    await until(() => A.feed.some((f) => f.kind === 'join' && f.userId === B.user.userId));
    check('A heard B come in', A.feed.some((f) => f.kind === 'join' && f.userId === B.user.userId));

    // ------------------------------------------------------------ the start and the break
    console.log('\nthe break');
    const notHost = await request(B, 'room:start');
    check('only the host starts', !notHost.ok && notHost.status === 403);
    const started = await request(A, 'room:start');
    await until(() => A.room?.status === 'playing' && B.room?.status === 'playing');
    check('the host starts: both see the game on', started.ok && A.room?.status === 'playing' && B.room?.status === 'playing' && A.room.gameNo === 1);
    check('a full rack, seat 0 to break with ball in hand behind the head string, the clock running', A.room!.balls.length === 16 && A.room!.balls.every((b) => b.on) && A.room!.turn === 0 && A.room!.inHand && A.room!.kitchen && A.room!.breakShot && A.room!.shotClock?.endsAt === clock.now + POOL.shotSecs * 1000);
    const early = await request(B, 'pool:shot', { aim: 0, power: 1, spin: { top: 0, side: 0 } });
    check('a shot out of turn is refused', !early.ok && early.status === 409 && early.message === "It isn't your turn.");
    const outOfKitchen = await request(A, 'pool:place', { x: 1.0, y: 0.5 });
    check('the break must start behind the head string', !outOfKitchen.ok && outOfKitchen.status === 400);
    const placed = await request(A, 'pool:place', { x: 0.4, y: 0.5 });
    check('the breaker moves the cue ball in the kitchen', placed.ok && ballOn(placed.data as PoolView, 0)?.x === 0.4);
    const brk = await request(A, 'pool:shot', { aim: 0.004, power: 1, spin: { top: 0, side: 0 } });
    await until(() => (B.room?.lastShot?.seq ?? 0) === 1);
    const broke = brk.ok ? (brk.data as PoolView) : null;
    const last = broke?.lastShot ?? null;
    check('a legal break: lastShot with its events, the balls at rest, from the cue ball\'s spot', !!last && last.seq === 1 && last.by === 0 && last.events.length > 0 && last.balls.length === 16 && last.from.x === 0.4 && last.steps > 0);
    check('four balls reached a cushion and the 13 dropped: no foul, stripes to the breaker, who shoots again', !!broke && !!last && last.events.filter((e) => e.t === 'cushion').length >= 4 && last.events.some((e) => e.t === 'pocket' && e.n === 13) && broke.turn === 0 && broke.shooter === 0 && !broke.open8 && broke.players[0].group === 'stripe' && broke.players[1].group === 'solid' && broke.players[0].pottedCount === 1 && !broke.inHand && broke.message === 'Stripes to the shooter');
    check('B is sent the same shot to replay', !!last && B.room?.lastShot?.seq === 1 && B.room.lastShot.events.length === last.events.length && B.room.turn === 0);
    check('the next clock starts after the replay', !!broke && broke.replayUntil > clock.now && broke.shotClock?.endsAt === broke.replayUntil + POOL.shotSecs * 1000);
    const rolling = await request(A, 'pool:shot', { aim: 0, power: 0.5, spin: { top: 0, side: 0 } });
    check('a shot while the balls still roll is refused', !rolling.ok && rolling.status === 409 && /still rolling/.test(rolling.message));

    // ------------------------------------------------------------ the shot clock
    console.log('\nthe shot clock');
    const before = (await peekRoom(ORG, code))!;
    clock.now = before.shotEndsAt + POOL.graceMs;
    await settle(async () => (await peekRoom(ORG, code))?.state?.turn === 1);
    const timedOut = (await peekRoom(ORG, code))!;
    check('the shooter ran out of time: a foul, ball in hand to the other', timedOut.state?.turn === 1 && timedOut.shooter === 1 && timedOut.state.inHand && !timedOut.state.kitchen && /ran out of time/.test(timedOut.message ?? ''));
    await until(() => B.room?.turn === 1 && B.room.inHand === true);
    check('B is told, and the feed carries the timeout', B.room?.turn === 1 && B.room.shooter === 1 && B.room.inHand && B.feed.some((f) => f.kind === 'timeout'));
    const eight = ballOn(B.room, 8)!;
    const onBall = await request(B, 'pool:place', { x: eight.x, y: eight.y });
    check('the cue ball cannot go on another ball', !onBall.ok && onBall.status === 400);
    const offTable = await request(B, 'pool:place', { x: 2.5, y: 0.5 });
    check('nor off the table', !offTable.ok && offTable.status === 400);
    const free = { x: 0.25, y: 0.5 };
    const placedB = await request(B, 'pool:place', free);
    check('a free spot anywhere on the table is fine', placedB.ok && ballOn(placedB.data as PoolView, 0)?.x === free.x && (placedB.data as PoolView).inHand);
    const stillA = await request(A, 'pool:shot', { aim: 0, power: 0.5, spin: { top: 0, side: 0 } });
    check('A, no longer the shooter, is refused', !stillA.ok && stillA.status === 409);

    // ------------------------------------------------------------ to the 8
    console.log('\nthe 8');
    // A's move bucket (2 a second, 6 in hand) has taken six quick moves; real time refills it.
    await wait(2000);
    // The table set by hand: A (solids) has only the 8 left, B (stripes) has potted two; each sank their own.
    const balls: Ball[] = [{ n: 0, x: 1.5, y: 0.5, vx: 0, vy: 0, on: true }];
    for (let n = 1; n <= 7; n++) balls.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: false });
    balls.push({ n: 8, x: 1.86, y: 0.14, vx: 0, vy: 0, on: true });
    for (let n = 9; n <= 15; n++) balls.push({ n, x: 0.2 + (n - 9) * 0.08, y: 0.9, vx: 0, vy: 0, on: n > 10 });
    // A has ball in hand, and the previous shot is still rolling on the pages for five more seconds.
    const setAt = clock.now;
    await mutateRoom(ORG, code, (r) => {
      r.state = { balls, turn: 0, groups: ['solid', 'stripe'], open: false, inHand: true, kitchen: false, breakShot: false };
      r.pottedBy = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 9: 1, 10: 1 };
      // The timeout had passed the inning to B; the shot is A's again.
      r.shooter = 0;
      r.replayUntil = setAt + 5000;
      r.shotEndsAt = r.replayUntil + POOL.shotSecs * 1000;
      return true;
    });
    const cueFrom = { x: 1.45, y: 0.5 };
    const dragged = await request(A, 'pool:place', cueFrom);
    const draggedView = dragged.ok ? (dragged.data as PoolView) : null;
    check('A, on the 8, drags ball in hand during the replay', !!draggedView && ballOn(draggedView, 0)?.x === cueFrom.x && draggedView.onEight && draggedView.players[0].pottedCount === 7 && draggedView.players[1].pottedCount === 2);
    const tooSoon = await request(A, 'pool:shot', { aim: 0, power: 0.4, spin: { top: 0, side: 0 } });
    check('but the shot waits for the replay', !tooSoon.ok && tooSoon.status === 409 && /still rolling/.test(tooSoon.message));
    clock.now = setAt + 5000;
    const winShot = await request(A, 'pool:shot', { aim: Math.atan2(0.14 - cueFrom.y, 1.86 - cueFrom.x), power: 0.4, spin: { top: 0, side: 0 } });
    await until(() => B.room?.status === 'over');
    const won = winShot.ok ? (winShot.data as PoolView) : null;
    check('the 8 drops, in any pocket: A wins', !!won && won.status === 'over' && won.result?.winner === 0 && won.result.reason === 'eight' && won.lastShot?.events.some((e) => e.t === 'pocket' && e.n === 8) === true && won.shotClock === null);
    check('B sees the result too, and the tally', B.room?.status === 'over' && B.room.result?.winner === 0 && B.room.wins[0] === 1 && B.room.wins[1] === 0);
    await until(() => awards.length >= 2);
    check('both scores go to the leaderboard: 7 balls and the win is 1,700; 2 balls is 200', scores.length === 2 && scores.find((s) => s.userId === A.user.userId)?.score === 1700 && scores.find((s) => s.userId === B.user.userId)?.score === 200 && scores.every((s) => s.org === ORG));
    await settle(() => false);
    check('points are paid once per game: 24 to the winner, 3 to the loser', awards.length === 2 && awards.find((a) => a.userId === A.user.userId)?.points === 24 && awards.find((a) => a.userId === B.user.userId)?.points === 3 && awards.every((a) => a.won === (a.userId === A.user.userId)));
    const lateShot = await request(A, 'pool:shot', { aim: 0, power: 0.5, spin: { top: 0, side: 0 } });
    check('no shots once the game is over', !lateShot.ok && lateShot.status === 409);

    // ------------------------------------------------------------ the rematch
    console.log('\nthe rematch');
    const again = await request(B, 'room:again');
    await until(() => A.room?.gameNo === 2 && B.room?.gameNo === 2);
    check('the loser asks for a rematch: a second game starts at once, and the loser breaks', again.ok && A.room?.status === 'playing' && A.room.gameNo === 2 && A.room.turn === 1 && A.room.shooter === 1 && A.room.breakShot && A.room.result === null && A.room.lastShot === null && A.room.balls.every((b) => b.on));
    check('the tally stays', A.room?.wins[0] === 1 && A.room.wins[1] === 0);
    const midGame = await request(C, 'room:join', { code });
    check('nobody joins a game under way', !midGame.ok && midGame.status === 409);
    const midInvite = await request(A, 'room:invite', { userId: C.user.userId });
    check('nor is invited into one', !midInvite.ok && midInvite.status === 409);

    // ------------------------------------------------------------ away and back
    console.log('\naway and back');
    B.socket.close();
    await until(async () => (await peekRoom(ORG, code))?.players[1].online === false);
    check('B drops: marked offline, the game stays on', (await peekRoom(ORG, code))?.players[1].online === false && (await peekRoom(ORG, code))?.status === 'playing');
    const B2 = await open(people[1]);
    clients.push(B2);
    await until(async () => B2.room?.code === code && (await peekRoom(ORG, code))?.players[1].online === true);
    check('B reopens the game: back in the room, online, sent the table', B2.room?.code === code && B2.room.status === 'playing' && B2.room.you === B.user.userId && (await peekRoom(ORG, code))?.players[1].online === true);
    const rejoin = await request(B2, 'room:join', { code, rejoin: true });
    check('an explicit rejoin by code is fine too', rejoin.ok && rejoin.data.code === code);
    const strangerRejoin = await request(C, 'room:join', { code, rejoin: true });
    check('a rejoin by someone not seated is not', !strangerRejoin.ok && strangerRejoin.status === 404);
    A.socket.close();
    B2.socket.close();
    await until(async () => (await peekRoom(ORG, code))?.players.every((p) => !p.online) === true);
    clock.now += POOL.playerGoneMs + 1000;
    await settle(async () => (await peekRoom(ORG, code))?.status === 'lobby');
    const abandoned = (await peekRoom(ORG, code))!;
    check('both away for a minute and a half: the game is abandoned, nobody wins', abandoned.status === 'lobby' && abandoned.result === null && abandoned.state === null && /abandoned/.test(abandoned.message ?? '') && abandoned.players.length === 2);
    await settle(() => false);
    check('and nothing is scored or paid', awards.length === 2 && scores.length === 2 && abandoned.players[0].wins === 1 && abandoned.players[1].wins === 0);
    const A2 = await open(people[0]);
    const B3 = await open(people[1]);
    clients.push(A2, B3);
    await until(async () => (await peekRoom(ORG, code))?.players.every((p) => p.online) === true && A2.room?.code === code);
    const thirdGame = await request(A2, 'room:start');
    await until(() => B3.room?.gameNo === 3);
    check('both back: the host starts a third game', thirdGame.ok && B3.room?.status === 'playing' && B3.room.gameNo === 3);
    B3.socket.close();
    await until(async () => (await peekRoom(ORG, code))?.players[1].online === false);
    clock.now += POOL.playerGoneMs + 1000;
    await settle(async () => (await peekRoom(ORG, code))?.status === 'over');
    const forfeited = (await peekRoom(ORG, code))!;
    check('B away for a minute and a half while A waits: A wins by forfeit', forfeited.status === 'over' && forfeited.result?.winner === 0 && forfeited.result.reason === 'away' && forfeited.players[0].wins === 2);
    await until(() => awards.length >= 4);
    check('a forfeit pays as a finished game: the win and nothing more', awards.length === 4 && awards.filter((a) => a.userId === A.user.userId).at(-1)?.points === Math.round(1000 / 70) && awards.filter((a) => a.userId === B.user.userId).at(-1)?.points === 0);

    // ------------------------------------------------------------ out
    console.log('\nleaving');
    const B4 = await open(people[1]);
    clients.push(B4);
    await until(() => B4.room?.code === code);
    check('B, back, sees they lost', B4.room?.status === 'over' && B4.room.result?.winner === 0 && B4.room.you === B.user.userId);
    const fullInvite = await request(A2, 'room:invite', { userId: D.user.userId });
    check('an invite to a full table is refused', !fullInvite.ok && fullInvite.status === 409);
    await request(B4, 'room:leave');
    await until(() => A2.room?.status === 'lobby');
    const oneLeft = (await peekRoom(ORG, code))!;
    check('B leaves the finished room: back to the lobby for A, seat 0 and host, the tally kept, the table gone', oneLeft.status === 'lobby' && oneLeft.players.length === 1 && oneLeft.hostId === A.user.userId && oneLeft.players[0].wins === 2 && oneLeft.result === null && oneLeft.state === null && oneLeft.lastShot === null && A2.room?.wins[0] === 2 && A2.room.balls.length === 0);
    const againAlone = await request(A2, 'room:again');
    check('there is nothing to replay in a lobby', !againAlone.ok && againAlone.status === 409 && againAlone.message === 'There is no finished game to replay.');
    pushes.length = 0;
    const inviteD = await request(A2, 'room:invite', { userId: D.user.userId });
    await until(() => pushes.length > 0);
    check('the refused invite did not spend the push: inviting D now pushes', inviteD.ok && pushes.some((p) => p.userIds[0] === D.user.userId && p.scenario === 'pool_invite' && p.data.challengeId === `room:${code}`));
    const dJoins = await request(D, 'room:join', { code });
    check('a newcomer takes the seat in the lobby', dJoins.ok && dJoins.data.players.length === 2 && dJoins.data.status === 'lobby');
    await request(A2, 'room:start');
    await until(() => D.room?.status === 'playing');
    await request(D, 'room:leave');
    await until(() => A2.room?.status === 'lobby' && A2.room.wins[0] === 3);
    check('D leaves mid-game: A wins by forfeit and waits in the lobby with the tally', A2.room?.status === 'lobby' && A2.room.wins[0] === 3 && A2.room.players.length === 1 && /left the table/.test(A2.room.message ?? ''));
    await until(() => awards.length >= 6);
    check('the forfeit is scored and paid once', awards.length === 6 && scores.length === 4);
    await request(A2, 'room:leave');
    await until(() => A2.room === null);
    check('the last one out deletes the room and is told', (await peekRoom(ORG, code)) === null && A2.room === null);
    const helloEnd = await request(A2, 'room:hello');
    check('hello afterwards: nothing open', helloEnd.ok && helloEnd.data.room === null && helloEnd.data.rooms.length === 0);

    // ------------------------------------------------------------ a table for four
    console.log('\na table for four');
    // A2 and B4 are the sockets A and B hold now; C and D still hold their first ones. E is a fifth colleague.
    const E = await open(people[4]);
    clients.push(E);
    const [H, P, Q, S] = [A2, B4, C, D];
    const wrongSize = await request(H, 'room:host', { open: true, size: 3 });
    check('a table seats two or four', !wrongSize.ok && wrongSize.status === 400);
    const hosted4 = await request(H, 'room:host', { open: true, size: 4 });
    const code4 = hosted4.ok ? String(hosted4.data.code) : '';
    check('A hosts a table for four', hosted4.ok && hosted4.data.size === 4 && hosted4.data.players.length === 1 && hosted4.data.players[0].team === 0 && hosted4.data.shooter === 0);
    const helloE = await request(E, 'room:hello');
    check("E's hello lists it with its size and a seat free", helloE.ok && helloE.data.rooms.some((r: { code: string; size: number; seatFree: boolean }) => r.code === code4 && r.size === 4 && r.seatFree));
    const j1 = await request(P, 'room:join', { code: code4 });
    const j2 = await request(Q, 'room:join', { code: code4 });
    const three = await request(H, 'room:start');
    check('three at the table: the host cannot start yet', !three.ok && three.status === 409 && three.message === 'Need four players to start.');
    const j3 = await request(S, 'room:join', { code: code4 });
    check('B, C and D join: seats 1, 2, 3, sides 0 & 2 against 1 & 3', j1.ok && j2.ok && j3.ok && j3.data.players.length === 4 && j3.data.players.map((p: { team: number }) => p.team).join('') === '0101' && j3.data.players[2].userId === C.user.userId);
    const fifth = await request(E, 'room:join', { code: code4 });
    check('a fifth is refused: the table is full', !fifth.ok && fifth.status === 409 && fifth.message === 'That table is full.');
    const started4 = await request(H, 'room:start');
    await until(() => S.room?.status === 'playing' && S.room.code === code4);
    check('four at the table: the game starts, seat 0 breaks for side 0', started4.ok && S.room?.status === 'playing' && S.room.size === 4 && S.room.shooter === 0 && S.room.turn === 0 && S.room.breakShot);

    // The same break as the table for two: the 13 drops and the breaker keeps the table.
    const BREAK = { aim: 0.004, power: 1, spin: { top: 0, side: 0 } };
    /** Straight along the table at the ball lined up ahead: it reaches the far cushion and nothing drops. */
    const MISS = { aim: 0, power: 0.3, spin: { top: 0, side: 0 } };
    /** From (1.45, 0.5) at a ball by the corner pocket at (2, 0): it drops. */
    const POT = { aim: Math.atan2(0.14 - 0.5, 1.86 - 1.45), power: 0.4, spin: { top: 0, side: 0 } };
    await request(H, 'pool:place', { x: 0.4, y: 0.5 });
    const brk4 = await request(H, 'pool:shot', BREAK);
    const b4 = brk4.ok ? (brk4.data as PoolView) : null;
    check('a pot on the break keeps the table: the same shooter, stripes to side 0 (both partners)', !!b4 && b4.shooter === 0 && b4.turn === 0 && b4.lastShot?.by === 0 && b4.players[0].group === 'stripe' && b4.players[2].group === 'stripe' && b4.players[1].group === 'solid' && b4.players[0].pottedCount === 1 && b4.players[2].pottedCount === 1);
    /**
     * The table set by hand, keeping which balls are down: the cue ball and
     * `target` lined up along the middle (a straight shot to the far cushion
     * misses), or `target` by the corner pocket for a pot; the rest along the
     * far rail. The replay is over and the shooter's clock runs.
     */
    const lineUp = (target: number, groups: [Group, Group], pot = false) =>
      mutateRoom(ORG, code4, (r) => {
        const down = new Set(r.state!.balls.filter((b) => !b.on).map((b) => b.n));
        const set: Ball[] = pot
          ? [{ n: 0, x: 1.45, y: 0.5, vx: 0, vy: 0, on: true }, { n: target, x: 1.86, y: 0.14, vx: 0, vy: 0, on: true }]
          : [{ n: 0, x: 1.0, y: 0.5, vx: 0, vy: 0, on: true }, { n: target, x: 1.3, y: 0.5, vx: 0, vy: 0, on: true }];
        let k = 0;
        for (let n = 1; n <= 15; n++) if (n !== target) set.push({ n, x: 0.15 + k++ * 0.12, y: 0.93, vx: 0, vy: 0, on: !down.has(n) });
        r.state = { ...(r.state as RuleState), balls: set, groups, open: false, inHand: false, kitchen: false, breakShot: false };
        r.replayUntil = clock.now;
        r.shotEndsAt = clock.now + POOL.shotSecs * 1000;
        return true;
      });
    /** Moves the clock past the last shot's replay. */
    const settled = async () => {
      clock.now = Math.max(clock.now, (await peekRoom(ORG, code4))!.replayUntil);
    };
    const groups4: [Group, Group] = ['stripe', 'solid'];
    await settled();
    await lineUp(9, groups4);
    const miss0 = await request(H, 'pool:shot', MISS);
    check('seat 0 misses: the inning passes to side 1, its first seat, 1', miss0.ok && miss0.data.shooter === 1 && miss0.data.turn === 1 && miss0.data.message === null && !miss0.data.inHand);
    await settled();
    await lineUp(1, groups4);
    const miss1 = await request(P, 'pool:shot', MISS);
    check('seat 1 misses: side 0 again, and its other seat, 2', miss1.ok && miss1.data.shooter === 2 && miss1.data.turn === 0);
    const partnerShot = await request(H, 'pool:shot', MISS);
    const partnerPlace = await request(H, 'pool:place', { x: 0.3, y: 0.3 });
    const otherSide = await request(S, 'pool:shot', MISS);
    check('neither the partner nor the other side may shoot or place for seat 2', !partnerShot.ok && partnerShot.status === 409 && partnerShot.message === "It isn't your turn." && !partnerPlace.ok && partnerPlace.status === 409 && !otherSide.ok && otherSide.status === 409);
    await settled();
    await lineUp(11, groups4, true);
    const pot2 = await request(Q, 'pool:shot', POT);
    check('seat 2 pots a stripe: keeps the table', pot2.ok && pot2.data.shooter === 2 && pot2.data.turn === 0 && pot2.data.lastShot.by === 2 && pot2.data.lastShot.events.some((e: { t: string; n?: number }) => e.t === 'pocket' && e.n === 11) && pot2.data.players[2].pottedCount === 2);
    await settled();
    await lineUp(9, groups4);
    const miss2 = await request(Q, 'pool:shot', MISS);
    check('seat 2 misses: side 1 again, its other seat, 3', miss2.ok && miss2.data.shooter === 3 && miss2.data.turn === 1);
    clock.now = (await peekRoom(ORG, code4))!.shotEndsAt + POOL.graceMs;
    await settle(async () => (await peekRoom(ORG, code4))?.shooter === 0);
    const t4 = (await peekRoom(ORG, code4))!;
    check('seat 3 runs out of time: ball in hand to side 0, whose rotation is back at seat 0', t4.shooter === 0 && t4.state?.turn === 0 && t4.state.inHand && /ran out of time: ball in hand to/.test(t4.message ?? ''));
    await until(() => H.room?.shooter === 0 && H.room.inHand === true);
    // A's move bucket (2 a second, 6 in hand) has taken six quick moves; real time refills it.
    await wait(2000);
    await lineUp(10, groups4, true);
    const pot0 = await request(H, 'pool:shot', POT);
    check('seat 0 pots a stripe and keeps the table', pot0.ok && pot0.data.shooter === 0 && pot0.data.players[0].pottedCount === 3);
    // Side 0 has only the 8 left, by a pocket.
    await settled();
    await mutateRoom(ORG, code4, (r) => {
      const set: Ball[] = [{ n: 0, x: 1.45, y: 0.5, vx: 0, vy: 0, on: true }, { n: 8, x: 1.86, y: 0.14, vx: 0, vy: 0, on: true }];
      for (let n = 1; n <= 7; n++) set.push({ n, x: 0.15 + n * 0.12, y: 0.93, vx: 0, vy: 0, on: true });
      for (let n = 9; n <= 15; n++) set.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: false });
      r.state = { ...(r.state as RuleState), balls: set, groups: groups4, open: false, inHand: false, kitchen: false, breakShot: false };
      r.replayUntil = clock.now;
      r.shotEndsAt = clock.now + POOL.shotSecs * 1000;
      return true;
    });
    const win4 = await request(H, 'pool:shot', POT);
    await until(() => S.room?.status === 'over');
    check('the 8 drops: side 0 wins, the result and the tally by side', win4.ok && win4.data.status === 'over' && win4.data.result.winner === 0 && win4.data.result.reason === 'eight' && S.room?.status === 'over' && S.room.wins[0] === 1 && S.room.wins[1] === 0 && S.room.players[2].group === 'stripe');
    await until(() => awards.length >= 10);
    const lines4 = scores.slice(4);
    const paid4 = awards.slice(6);
    check('final lines per player: A sank two stripes (1,200), C one (1,100), B and D nothing (not recorded); all four paid', scores.length === 6 && lines4.find((s) => s.userId === A.user.userId)?.score === 1200 && lines4.find((s) => s.userId === C.user.userId)?.score === 1100 && awards.length === 10 && paid4.find((a) => a.userId === A.user.userId)?.points === 17 && paid4.find((a) => a.userId === C.user.userId)?.points === 16 && paid4.filter((a) => a.points === 0 && !a.won).length === 2, JSON.stringify(lines4));

    // ------------------------------------------------------------ the rematch, and seats emptying
    console.log('\nthe rematch for four');
    const again4 = await request(P, 'room:again');
    await until(() => H.room?.gameNo === 2 && H.room.code === code4);
    check('a rematch: the losing side breaks with its lower seat, 1', again4.ok && H.room?.status === 'playing' && H.room.shooter === 1 && H.room.turn === 1 && H.room.breakShot && H.room.players[1].group === null && H.room.wins[0] === 1);
    await request(Q, 'room:leave');
    await until(() => H.room?.players[2]?.left === true);
    const dropped = (await peekRoom(ORG, code4))!;
    check('C leaves mid-game: dropped from the rotation, the seat kept, the game on, B still to break', H.room?.status === 'playing' && H.room.players.length === 4 && H.room.players[2].left && H.room.players[2].online === false && H.room.shooter === 1 && dropped.rotation[0] === 0 && /plays on alone/.test(H.room.message ?? ''));
    const helloQ = await request(Q, 'room:hello');
    check('and is out of the room', helloQ.ok && helloQ.data.room === null);
    await request(P, 'pool:place', { x: 0.4, y: 0.5 });
    const brkB = await request(P, 'pool:shot', BREAK);
    check('B breaks and pots: stripes to side 1, B shoots on', brkB.ok && brkB.data.shooter === 1 && brkB.data.players[1].group === 'stripe' && brkB.data.players[3].group === 'stripe');
    const groupsB: [Group, Group] = ['solid', 'stripe'];
    await settled();
    await lineUp(9, groupsB);
    const missB = await request(P, 'pool:shot', MISS);
    check('B misses: side 0, which is A alone', missB.ok && missB.data.shooter === 0);
    await settled();
    await lineUp(1, groupsB);
    const missA = await request(H, 'pool:shot', MISS);
    check('A misses: side 1, seat 3', missA.ok && missA.data.shooter === 3);
    await settled();
    await lineUp(9, groupsB);
    const missD = await request(S, 'pool:shot', MISS);
    check('D misses: back to A, never the empty seat 2', missD.ok && missD.data.shooter === 0 && missD.data.turn === 0);
    // Side 0 (A alone now) has only the 8 left: set by hand, two solids to A's credit.
    await settled();
    await mutateRoom(ORG, code4, (r) => {
      const set: Ball[] = [{ n: 0, x: 1.45, y: 0.5, vx: 0, vy: 0, on: true }, { n: 8, x: 1.86, y: 0.14, vx: 0, vy: 0, on: true }];
      for (let n = 1; n <= 7; n++) set.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: false });
      for (let n = 9; n <= 15; n++) set.push({ n, x: 0.15 + (n - 9) * 0.12, y: 0.93, vx: 0, vy: 0, on: n !== 13 });
      r.state = { ...(r.state as RuleState), balls: set, groups: groupsB, open: false, inHand: false, kitchen: false, breakShot: false };
      r.pottedBy = { ...r.pottedBy, 1: 0, 2: 0 };
      r.replayUntil = clock.now;
      r.shotEndsAt = clock.now + POOL.shotSecs * 1000;
      return true;
    });
    const win5 = await request(H, 'pool:shot', POT);
    await until(() => H.room?.status === 'over');
    const podium = (await peekRoom(ORG, code4))!;
    check('A pots the 8 with a seat gone: the podium stays, with the shot, for those still there; C gets no win, no score and no tally', win5.ok && podium.status === 'over' && podium.result?.winner === 0 && podium.result.reason === 'eight' && podium.players.length === 4 && podium.players[2].left && podium.players[2].wins === 1 && podium.players[0].wins === 2 && podium.lastShot?.by === 0 && podium.final?.length === 4 && podium.final[2].score === 0 && !podium.final[2].won && podium.final[0].score === 1200 && podium.final[0].won && H.room?.status === 'over' && H.room.wins[0] === 2 && H.room.wins[1] === 0 && H.room.players[0].pottedCount === 2);
    await until(() => awards.length >= 13);
    const lines5 = scores.slice(6);
    check('scored per player: A 1,200, B 100 for the 13, D nothing; C, who walked out, nothing recorded or paid', awards.length === 13 && scores.length === 8 && lines5.find((s) => s.userId === A.user.userId)?.score === 1200 && lines5.find((s) => s.userId === B.user.userId)?.score === 100 && !lines5.some((s) => s.userId === C.user.userId || s.userId === D.user.userId) && !awards.slice(10).some((a) => a.userId === C.user.userId) && awards.slice(10).some((a) => a.userId === D.user.userId && a.points === 0), JSON.stringify(lines5));
    const againGone = await request(P, 'room:again');
    await until(() => H.room?.status === 'lobby');
    const relobby = (await peekRoom(ORG, code4))!;
    check('a rematch asked for with a seat gone: the lobby, re-seated in joining order (A, B, D), seat 0 the host, the tally kept', againGone.ok && relobby.status === 'lobby' && relobby.players.map((p) => p.userId).join() === [A, B, D].map((c) => c.user.userId).join() && relobby.hostId === A.user.userId && relobby.players[0].wins === 2 && relobby.players[1].wins === 0 && relobby.state === null && relobby.result === null && relobby.breaker === 0 && relobby.message === podium.message && H.room?.players.length === 3 && H.room.size === 4);

    // ------------------------------------------------------------ a whole side leaving
    console.log('\na whole side leaving');
    await request(E, 'room:join', { code: code4 });
    const third4 = await request(H, 'room:start');
    await until(() => E.room?.status === 'playing' && E.room.gameNo === 3);
    check('E takes the empty seat and a third game starts: A and D against B and E', third4.ok && E.room?.status === 'playing' && E.room.players[3].userId === E.user.userId && E.room.players[3].team === 1 && E.room.shooter === 0);
    await request(S, 'room:leave');
    await request(E, 'room:leave');
    await until(() => H.room?.players[2]?.left === true && H.room.players[3]?.left === true);
    check('D and E leave: both dropped, A and B play on alone, the game still on', H.room?.status === 'playing' && H.room.players[2].left && H.room.players[3].left && H.room.shooter === 0 && H.room.players.length === 4);
    await request(P, 'room:leave');
    await until(() => H.room?.status === 'lobby');
    const forfeit4 = (await peekRoom(ORG, code4))!;
    check('B leaves too: side 1 is empty, side 0 wins by forfeit, and the room is a lobby for A alone, seat 0 and host, the tally kept', forfeit4.status === 'lobby' && forfeit4.players.length === 1 && forfeit4.players[0].userId === A.user.userId && forfeit4.hostId === A.user.userId && forfeit4.players[0].wins === 3 && forfeit4.state === null && /left the table/.test(forfeit4.message ?? '') && H.room?.wins[0] === 3 && H.room.size === 4 && H.room.players.length === 1);
    await until(() => awards.length >= 15);
    check('the forfeit is scored and paid for those who stayed to the end: A the win, B a line with nothing; D and E, who walked out, nothing', awards.length === 15 && scores.length === 9 && scores.at(-1)?.userId === A.user.userId && scores.at(-1)?.score === 1000 && awards.slice(13).some((a) => a.userId === B.user.userId && a.points === 0 && !a.won) && !awards.slice(13).some((a) => a.userId === D.user.userId || a.userId === E.user.userId));

    // ------------------------------------------------------------ quick join by size
    console.log('\nquick join by size');
    const quickE = await request(E, 'room:quick', { size: 4 });
    check("quick join for a table of four finds A's", quickE.ok && quickE.data.code === code4 && quickE.data.size === 4 && quickE.data.players.length === 2);
    const quickQ = await request(Q, 'room:quick', { size: 2 });
    const code5 = quickQ.ok ? String(quickQ.data.code) : '';
    check('quick join for a table of two: none open, so a new one of their own', quickQ.ok && code5 !== code4 && quickQ.data.size === 2 && quickQ.data.hostId === C.user.userId);
    const quickS = await request(S, 'room:quick');
    check("quick join with no size: the oldest open lobby with a seat, A's table for four", quickS.ok && quickS.data.code === code4 && quickS.data.players.length === 3);
    for (const c of [E, S, H, Q]) await request(c, 'room:leave');
    await until(async () => (await peekRoom(ORG, code4)) === null && (await peekRoom(ORG, code5)) === null);
    check('everyone out: both rooms are gone', (await peekRoom(ORG, code4)) === null && (await peekRoom(ORG, code5)) === null);

    // ------------------------------------------------------------ a room from the last build
    console.log('\na room from the last build');
    // Written as the build before tables for four wrote it: no size, shooter, rotation or record of
    // who sank what, no `left` on the players, a called pocket in the state; B on turn, a ball lined up.
    const v1Balls: Ball[] = [{ n: 0, x: 1.0, y: 0.5, vx: 0, vy: 0, on: true }, { n: 1, x: 1.3, y: 0.5, vx: 0, vy: 0, on: true }];
    for (let n = 2; n <= 15; n++) v1Balls.push({ n, x: 0.15 + (n - 2) * 0.12, y: 0.93, vx: 0, vy: 0, on: n !== 9 });
    const v1 = {
      code: '9876', org: ORG, gameKey: 'pool', hostId: A.user.userId, status: 'playing', open: true, createdAt: clock.now, updatedAt: clock.now,
      players: [A, B].map((c, i) => ({ userId: c.user.userId, name: c.user.name, photoUrl: null, joinedAt: clock.now - 1000 + i, online: false, offlineAt: clock.now, wins: i })),
      invited: [], invitesSent: 0, gameId: 'g-v1', gameNo: 1, breaker: 0,
      state: { balls: v1Balls, turn: 1, groups: ['stripe', 'solid'], open: false, inHand: false, kitchen: false, breakShot: false, calledPocket: null },
      shotEndsAt: clock.now + POOL.shotSecs * 1000, replayUntil: 0, shotSeq: 3, lastShot: null, message: null, result: null, final: null, finishedAt: null, version: 7,
    };
    check('the old record is stored as it was', await createRoom(v1 as unknown as PoolRoom));
    await setSeat(ORG, A.user.userId, '9876');
    await setSeat(ORG, B.user.userId, '9876');
    const v1Read = (await peekRoom(ORG, '9876'))!;
    check('read back whole: a table for two, B (on turn) the shooter, a fresh rotation, nobody credited, nobody left', v1Read.size === 2 && v1Read.shooter === 1 && v1Read.rotation[0] === 0 && v1Read.rotation[1] === 1 && Object.keys(v1Read.pottedBy).length === 0 && v1Read.players.every((p) => p.left === false));
    const backA = await request(H, 'room:join', { code: '9876', rejoin: true });
    const backB = await request(P, 'room:join', { code: '9876', rejoin: true });
    check('A and B rejoin it and see the game on, B to shoot', backA.ok && backB.ok && backB.data.size === 2 && backB.data.shooter === 1 && backB.data.turn === 1 && backB.data.players[1].team === 1 && backB.data.wins[1] === 1);
    const v1Shot = await request(P, 'pool:shot', MISS);
    check('and play on: B misses, the inning passes to A', v1Shot.ok && v1Shot.data.shooter === 0 && v1Shot.data.turn === 0 && v1Shot.data.lastShot.seq === 4 && v1Shot.data.lastShot.by === 1);
    await request(P, 'room:leave');
    await request(H, 'room:leave');
    check('and the room goes when they do', (await peekRoom(ORG, '9876')) === null);
  } finally {
    for (const c of clients) c.socket.close();
    closePoolRealtime();
    closeConnectRealtime();
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    await getDb().dropDatabase().catch(() => undefined);
    await closeDb();
  }
  console.log(failures ? `\n${failures} check(s) failed, ${passes} passed.` : `\nAll ${passes} Sowaka Pool checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
