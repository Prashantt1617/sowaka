/**
 * Sowaka Pool's rooms, end to end on a scratch database and real sockets:
 * the page's ticket, hosting, joining by code and by quick join, a third
 * player refused, invites (a colleague, a card, a push; another company
 * refused), the host starting, a legal break the engine rules, a shot out of
 * turn, ball-in-hand placement, the shot clock fouling through the tick, a
 * game played to the 8 (scores recorded, points paid once), a rematch the
 * loser breaks, a reconnect, a forfeit by absence, and the last one out
 * deleting the room. The clock is moved by hand.
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
import type { PoolView } from '../models/pool.model';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import { closePoolRealtime, initPoolRealtime } from '../services/pool-realtime.service';
import { configurePool, peekRoom, tickPool, type PoolAward } from '../services/pool-room.service';
import { POOL } from '../services/pool-rooms-engine';
import { mutateRoom, resetPoolMemory } from '../services/pool-store';
import { mintTicket } from '../services/scribble-ticket.service';
import type { Ball } from '../shared/pool/engine';

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
    const people = Array.from({ length: 4 }, (_, i) => seedUser(i + 1));
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
    for (const user of people) clients.push(await open(user));
    const [A, B, C, D] = clients;
    const hello0 = await request(A, 'room:hello');
    check('hello with no room: nothing to show yet', hello0.ok && hello0.data.room === null && Array.isArray(hello0.data.rooms) && hello0.data.rooms.length === 0 && hello0.data.invites.length === 0);

    // ------------------------------------------------------------ hosting, invites, joining
    console.log('\nhosting and joining');
    const hosted = await request(A, 'room:host', { open: true });
    const code = hosted.ok ? String(hosted.data.code) : '';
    check('A hosts an open room with a four-digit code, in its lobby, seat 0', hosted.ok && /^[1-9]\d{3}$/.test(code) && hosted.data.hostId === A.user.userId && hosted.data.open === true && hosted.data.status === 'lobby' && hosted.data.turn === 0 && hosted.data.players.length === 1);
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
    check("B's hello lists A's room with a seat free", helloB.ok && helloB.data.rooms.some((r: { code: string; host: { userId: string }; seatFree: boolean; status: string }) => r.code === code && r.host.userId === A.user.userId && r.seatFree && r.status === 'lobby'));
    const bad = await request(B, 'room:join', { code: code === '1000' ? '1001' : '1000' });
    check('a code with no room: not found', !bad.ok && bad.status === 404);
    const joined = await request(B, 'room:join', { code: `room:${code}` });
    check('B joins by code as seat 1', joined.ok && joined.data.players.length === 2 && joined.data.players[1].userId === B.user.userId);
    const third = await request(C, 'room:join', { code });
    check('a third player is refused with a plain message', !third.ok && third.status === 409 && third.message === 'That table has two players already.');
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
    check('four balls reached a cushion and the 13 dropped: no foul, the table still open, the breaker shoots again', !!broke && !!last && last.events.filter((e) => e.t === 'cushion').length >= 4 && last.events.some((e) => e.t === 'pocket' && e.n === 13) && broke.turn === 0 && broke.open8 && !broke.inHand && broke.message === null);
    check('B is sent the same shot to replay', !!last && B.room?.lastShot?.seq === 1 && B.room.lastShot.events.length === last.events.length && B.room.turn === 0);
    check('the next clock starts after the replay', !!broke && broke.replayUntil > clock.now && broke.shotClock?.endsAt === broke.replayUntil + POOL.shotSecs * 1000);
    const rolling = await request(A, 'pool:shot', { aim: 0, power: 0.5, spin: { top: 0, side: 0 } });
    check('a shot while the balls still roll is refused', !rolling.ok && rolling.status === 409 && /still rolling/.test(rolling.message));
    const notOnEight = await request(A, 'pool:call', { pocket: 2 });
    check('a pocket can be called only on the 8', !notOnEight.ok && notOnEight.status === 409);

    // ------------------------------------------------------------ the shot clock
    console.log('\nthe shot clock');
    const before = (await peekRoom(ORG, code))!;
    clock.now = before.shotEndsAt + POOL.graceMs;
    await settle(async () => (await peekRoom(ORG, code))?.state?.turn === 1);
    const timedOut = (await peekRoom(ORG, code))!;
    check('the shooter ran out of time: a foul, ball in hand to the other', timedOut.state?.turn === 1 && timedOut.state.inHand && !timedOut.state.kitchen && /ran out of time/.test(timedOut.message ?? ''));
    await until(() => B.room?.turn === 1 && B.room.inHand === true);
    check('B is told, and the feed carries the timeout', B.room?.turn === 1 && B.room.inHand && B.feed.some((f) => f.kind === 'timeout'));
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
    // The table set by hand: A (solids) has only the 8 left, B (stripes) has potted two.
    const balls: Ball[] = [{ n: 0, x: 1.5, y: 0.5, vx: 0, vy: 0, on: true }];
    for (let n = 1; n <= 7; n++) balls.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: false });
    balls.push({ n: 8, x: 1.86, y: 0.14, vx: 0, vy: 0, on: true });
    for (let n = 9; n <= 15; n++) balls.push({ n, x: 0.2 + (n - 9) * 0.08, y: 0.9, vx: 0, vy: 0, on: n > 10 });
    const setAt = clock.now;
    await mutateRoom(ORG, code, (r) => {
      r.state = { balls, turn: 0, groups: ['solid', 'stripe'], open: false, inHand: false, kitchen: false, breakShot: false, calledPocket: null };
      r.replayUntil = 0;
      r.shotEndsAt = setAt + POOL.shotSecs * 1000;
      return true;
    });
    const uncalled = await request(A, 'pool:call', { pocket: 7 });
    check('a pocket is one of six', !uncalled.ok && uncalled.status === 400);
    const called = await request(A, 'pool:call', { pocket: 2 });
    check('A, on the 8, calls the corner pocket', called.ok && (called.data as PoolView).onEight && (called.data as PoolView).calledPocket === 2 && (called.data as PoolView).players[0].pottedCount === 7 && (called.data as PoolView).players[1].pottedCount === 2);
    const winShot = await request(A, 'pool:shot', { aim: Math.atan2(0.14 - 0.5, 1.86 - 1.5), power: 0.4, spin: { top: 0, side: 0 } });
    await until(() => B.room?.status === 'over');
    const won = winShot.ok ? (winShot.data as PoolView) : null;
    check('the 8 drops in the called pocket: A wins', !!won && won.status === 'over' && won.result?.winner === 0 && won.result.reason === 'eight' && won.lastShot?.events.some((e) => e.t === 'pocket' && e.n === 8 && e.p === 2) === true && won.shotClock === null);
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
    check('the loser asks for a rematch: a second game starts at once, and the loser breaks', again.ok && A.room?.status === 'playing' && A.room.gameNo === 2 && A.room.turn === 1 && A.room.breakShot && A.room.result === null && A.room.lastShot === null && A.room.balls.every((b) => b.on));
    check('the tally stays', A.room?.wins[0] === 1 && A.room.wins[1] === 0);

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
    await until(async () => (await peekRoom(ORG, code))?.players[0].online === false);
    clock.now += POOL.playerGoneMs + 1000;
    await settle(async () => (await peekRoom(ORG, code))?.status === 'over');
    const forfeited = (await peekRoom(ORG, code))!;
    check('A away for a minute and a half: B wins by forfeit', forfeited.status === 'over' && forfeited.result?.winner === 1 && forfeited.result.reason === 'away' && forfeited.players[1].wins === 1);
    await until(() => awards.length >= 4);
    check('a forfeit pays as a finished game: the win and nothing more', awards.length === 4 && awards.filter((a) => a.userId === B.user.userId).at(-1)?.points === Math.round(1000 / 70));

    // ------------------------------------------------------------ out
    console.log('\nleaving');
    const A2 = await open(people[0]);
    clients.push(A2);
    await until(() => A2.room?.code === code);
    check('A, back, sees they lost', A2.room?.status === 'over' && A2.room.result?.winner === 1);
    await request(A2, 'room:leave');
    const oneLeft = (await peekRoom(ORG, code))!;
    check('A leaves: B is host, seat 0, and still the winner', oneLeft.players.length === 1 && oneLeft.hostId === B.user.userId && oneLeft.result?.winner === 0);
    const againAlone = await request(B2, 'room:again');
    check('a rematch with no opponent waits in the lobby', againAlone.ok && (await peekRoom(ORG, code))?.status === 'lobby');
    await request(B2, 'room:leave');
    await until(() => B2.room === null);
    check('the last one out deletes the room and is told', (await peekRoom(ORG, code)) === null && B2.room === null);
    const helloEnd = await request(B2, 'room:hello');
    check('hello afterwards: nothing open', helloEnd.ok && helloEnd.data.room === null && helloEnd.data.rooms.length === 0);
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
