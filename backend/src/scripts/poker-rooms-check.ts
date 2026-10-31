/**
 * Speed Poker as a group game, end to end on a scratch database and real
 * sockets, with no event anywhere: open a table, the lobby's list, quick
 * join, a code, a private table, the host dealing, cards private to each
 * player, a drop-in dealt from the next hand, a leaver, invites (live, by
 * push, and replayed to a socket that connects later), a removal and its
 * cool-down, a game played to the end, dealing again, a table against the
 * house, and a reconnect. The clock is moved by hand.
 *
 *   MONGODB_DB=poker_check npx tsx src/scripts/poker-rooms-check.ts
 *
 * No REDIS_URL: the store runs in memory. The database is dropped afterwards.
 */
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, gameCatalog, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import { ensurePokerIndexes, pokerEvents } from '../services/poker-db';
import { closePokerRealtime, initPokerRealtime } from '../services/poker-realtime.service';
import { configurePoker } from '../services/poker-room.service';
import type { PokerRoomView } from '../services/poker-rooms-engine';
import { configurePokerRooms, peekRoom, tickPokerRooms } from '../services/poker-rooms.service';
import { resetPokerMemory } from '../services/poker-store';
import { mintTicket } from '../services/scribble-ticket.service';

let failures = 0;
let passes = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  else passes += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Real time, not the game's clock: for what waits on the database (a socket's welcome or goodbye). */
async function until(done: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await done()) return;
    await wait(50);
  }
}

const ORG = 'sowaka';
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;
const clock = { now: Date.UTC(2026, 10, 3, 6, 0, 0) };
const pushes: { userIds: string[]; title: string; data: Record<string, unknown> }[] = [];

let seed = 7;
const die = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

interface Client {
  user: User;
  socket: ClientSocket;
  room: PokerRoomView | null;
  states: number;
  feed: { kind: string; userId?: string }[];
  invites: { code: string }[];
  kicked: boolean;
  autoplay: boolean;
  /** Anyone else's cards this client was ever shown outside a showdown. */
  peeked: boolean;
}

function seedUser(i: number): User {
  return { userId: `pr-u${i}`, name: `Room Player ${i}`, email: `r${i}@${ORG}.local`, employeeId: `PR-${i}`, org: ORG, lifecycleStatus: 'active', location: 'Gurgaon' } as User;
}

type Ack = { ok: true; data: Record<string, any> } | { ok: false; status: number; message: string };
const request = (c: Client, event: string, payload: Record<string, unknown> = {}) =>
  new Promise<Ack>((resolve) => c.socket.timeout(4000).emit(event, payload, (err: unknown, res: Ack) => resolve(err ? { ok: false, status: 0, message: 'timeout' } : res)));

function open(user: User): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(`${BASE}/poker`, { path: '/connect/socket', transports: ['websocket'], auth: { ticket: mintTicket({ userId: user.userId, org: ORG, name: user.name }) }, reconnection: false });
    const c: Client = { user, socket, room: null, states: 0, feed: [], invites: [], kicked: false, autoplay: true, peeked: false };
    socket.on('room:state', (p: { room: PokerRoomView | null }) => {
      c.room = p.room;
      c.states += 1;
      const t = p.room?.table;
      if (!t) return;
      if (t.street !== 'done' && t.seats.some((s) => !s.me && s.cards)) c.peeked = true;
      if (c.autoplay && t.status === 'playing' && t.mySeat !== null && t.toAct === t.mySeat && t.choices) {
        const me = t.seats[t.mySeat];
        const pair = me.cards && me.cards[0][0] === me.cards[1][0];
        const action = pair && t.choices.canRaise ? { kind: 'allin' } : t.choices.canCheck ? { kind: 'check' } : { kind: 'call' };
        void request(c, 'room:act', { action });
      }
    });
    socket.on('room:feed', (item: { kind: string; userId?: string }) => c.feed.push(item));
    socket.on('room:invite', (p: { code: string }) => c.invites.push(p));
    socket.on('room:kicked', () => (c.kicked = true));
    socket.on('connect', () => resolve(c));
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

/** Moves the clock in steps, letting the server tick, until [done] holds. */
async function run(label: string, done: () => boolean | Promise<boolean>, stepMs = 3000, maxSteps = 600): Promise<boolean> {
  for (let i = 0; i < maxSteps; i++) {
    if (await done()) return true;
    clock.now += stepMs;
    await tickPokerRooms();
    await wait(25);
  }
  const ok = await done();
  if (!ok) check(label, false, 'never happened');
  return ok;
}

async function main() {
  if (!/^(poker_)?check$/.test(env.mongoDbName) && !/scratch/i.test(env.mongoDbName)) {
    console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=poker_check.`);
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
    await ensurePokerIndexes();
    resetPokerMemory();
    const notify = async (userIds: string[], input: { title: string; data?: Record<string, unknown> }) => void pushes.push({ userIds, title: input.title, data: input.data ?? {} });
    configurePoker({ now: () => clock.now, random: die, notify, houseDelayMs: 1000 });
    configurePokerRooms({ now: () => clock.now, random: die, notify, houseDelayMs: 1000 });
    const people = Array.from({ length: 9 }, (_, i) => seedUser(i + 1));
    await users().insertMany(people);
    await companies().insertOne({ id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['speed-poker'] } as never);
    const now = new Date();
    await gameCatalog().insertOne({
      key: 'speed-poker', name: 'Speed Poker', kind: 'web', order: 60, active: true,
      html: '<!doctype html><html><head><meta charset="utf-8"><title>Speed Poker</title>\n<!--POKER-TICKET-->\n</head><body>page</body></html>',
      createdAt: now, updatedAt: now,
    } as never);
    const session = `tok-${randomUUID()}`;
    await authSessions().insertOne({ tokenHash: hashSessionToken(session), userId: people[0].userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) } as never);

    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const io = initConnectRealtime(server);
    initPokerRealtime(io);

    // ------------------------------------------------------------ no event anywhere
    console.log('no event, just the game');
    const page = await fetch(`${BASE}/play/speed-poker`, { headers: { authorization: `Bearer ${session}` } });
    check('the page is served with its ticket', page.status === 200 && /window\.__POKER=\{/.test(await page.text()));
    check('there is no Speed Poker event at all', (await pokerEvents().countDocuments({})) === 0);
    for (const user of people.slice(0, 7)) clients.push(await open(user));
    const [A, B, C, D, E, F, G] = clients;
    const eventHello = await request(A, 'poker:hello');
    check('the event path says no event', eventHello.ok && eventHello.data.event === null);
    const hello = await request(A, 'room:hello');
    check('the group game says hello: no table yet, none open', hello.ok && hello.data.room === null && Array.isArray(hello.data.rooms) && hello.data.rooms.length === 0);

    // ------------------------------------------------------------ open, list, quick join, code, private
    console.log('\nopening and finding tables');
    const hosted = await request(A, 'room:host', {});
    const code = hosted.ok ? String(hosted.data.code) : '';
    check('A opens a table with a four-digit code, as its host', hosted.ok && /^[1-9]\d{3}$/.test(code) && hosted.data.hostId === A.user.userId && hosted.data.open === true);
    const list = await request(B, 'room:list');
    check("B sees A's table in the lobby's list", list.ok && list.data.rooms.some((r: { code: string; host: { userId: string } }) => r.code === code && r.host.userId === A.user.userId));
    const quick = await request(B, 'room:quick');
    check("quick join puts B at A's table", quick.ok && quick.data.code === code);
    const byCode = await request(C, 'room:join', { code: `room:${code}` });
    check('C joins by code', byCode.ok && byCode.data.players.length === 3);
    const bad = await request(D, 'room:join', { code: '1000' === code ? '1001' : '1000' });
    check('a code with no table: not found', !bad.ok && bad.status === 404);
    const priv = await request(D, 'room:host', { open: false });
    const privCode = priv.ok ? String(priv.data.code) : '';
    const list2 = await request(E, 'room:list');
    check('a private table is not listed', priv.ok && list2.ok && !list2.data.rooms.some((r: { code: string }) => r.code === privCode));
    await request(D, 'room:leave');
    check('the last one out closes it', (await peekRoom(ORG, privCode)) === null);
    await wait(50);
    check('everyone in the room heard who came', A.feed.filter((f) => f.kind === 'join').length >= 2);

    // ------------------------------------------------------------ the host's choices and the deal
    console.log('\nthe deal');
    const notHost = await request(B, 'room:start');
    check('only the host deals', !notHost.ok && notHost.status === 403);
    const length = await request(A, 'room:settings', { minutes: 10 });
    check('the host picks a 10-minute game', length.ok && length.data.minutes === 10);
    const badLength = await request(A, 'room:settings', { minutes: 7 });
    check('7 minutes is not on offer', !badLength.ok && badLength.status === 400);
    const deal = await request(A, 'room:start');
    await wait(80);
    check('the host deals: all three get the table', deal.ok && [A, B, C].every((c) => c.room?.status === 'playing' && c.room.table?.seats.length === 3));
    check('each sees their own two cards', [A, B, C].every((c) => c.room!.table!.mySeat !== null && c.room!.table!.seats[c.room!.table!.mySeat!].cards?.length === 2));
    check('a game of 10 minutes', A.room!.table!.endsAt - A.room!.table!.startedAt === 10 * 60_000);
    const lateLength = await request(A, 'room:settings', { minutes: 20 });
    check('the length cannot change mid-game', !lateLength.ok);

    // ------------------------------------------------------------ a drop-in, a leaver
    console.log('\ncoming and going');
    const drop = await request(D, 'room:join', { code });
    await wait(50);
    check('D drops in mid-game with a seat and 1,500', drop.ok && drop.data.table?.seats.length === 4 && drop.data.waiting === false && drop.data.table.seats[drop.data.table.mySeat].stack === 1500);
    const handAtDrop = D.room?.table?.handNo ?? 0;
    await run('D is dealt in from the next hand', () => (D.room?.table?.handNo ?? 0) > handAtDrop && D.room!.table!.seats[D.room!.table!.mySeat!].inHand);
    await request(B, 'room:leave');
    await wait(50);
    const afterLeave = await peekRoom(ORG, code);
    check('B leaves: their seat is dealt no more, the game plays on', !!afterLeave && afterLeave.status === 'playing' && afterLeave.table!.seats.some((s) => s.userId === B.user.userId && s.left) && afterLeave.players.length === 3);
    check('B is told the room is gone for them', B.room === null || (await request(B, 'room:hello')).ok);

    // ------------------------------------------------------------ invites
    console.log('\ninvites');
    const inv = await request(A, 'room:invite', { userId: F.user.userId });
    await wait(50);
    check('A invites F: a card at once', inv.ok && F.invites.some((i) => i.code === code));
    const push = pushes.find((p) => p.userIds[0] === F.user.userId);
    check('and a push that opens this table', !!push && /invited you to Speed Poker/.test(push.title) && push.data.challengeId === `room:${code}` && push.data.gameKey === 'speed-poker');
    const inv2 = await request(A, 'room:invite', { userId: people[7].userId });
    const H = await open(people[7]);
    clients.push(H);
    await until(() => H.invites.length > 0);
    check('someone invited while away gets the card when they open Speed Poker', inv2.ok && H.invites.some((i) => i.code === code));
    const outsider = await request(A, 'room:invite', { userId: 'nobody-here' });
    check('only colleagues can be invited', !outsider.ok && outsider.status === 404);
    const fJoin = await request(F, 'room:join', { code });
    check('F accepts and sits down', fJoin.ok);

    // ------------------------------------------------------------ removal
    console.log('\nremoval');
    const kick = await request(A, 'room:kick', { userId: C.user.userId });
    await wait(50);
    check('the host removes C, who is told', kick.ok && C.kicked);
    const back = await request(C, 'room:join', { code });
    check('C cannot come straight back by code', !back.ok && back.status === 403);
    const notHostKick = await request(D, 'room:kick', { userId: A.user.userId });
    check('only the host removes players', !notHostKick.ok && notHostKick.status === 403);
    check('nobody was ever shown anyone else\'s cards before a showdown', clients.every((c) => !c.peeked));

    // ------------------------------------------------------------ to the end, and again
    console.log('\nthe end of a game');
    await run('the game plays to its end', async () => (await peekRoom(ORG, code))?.status === 'over', 4000, 800);
    await wait(80);
    const over = await peekRoom(ORG, code);
    check('standings for everyone dealt in, best first', !!over?.table?.standings && over.table.standings[0].place === 1 && over.table.standings.length >= 3);
    check('the players see the standings', !!A.room?.table?.standings && A.room.status === 'over');
    const notHostAgain = await request(D, 'room:again');
    check('only the host deals again', !notHostAgain.ok);
    const again = await request(A, 'room:again');
    await wait(50);
    check('the host takes the room back to the lobby', again.ok && A.room?.status === 'lobby' && A.room.table === null);
    const g = await request(G, 'room:join', { code });
    check('a newcomer joins between games', g.ok && g.data.status === 'lobby');
    await request(A, 'room:start');
    await wait(80);
    const second = await peekRoom(ORG, code);
    const inPlay = second?.table?.hand?.committed.reduce((a, b) => a + b, 0) ?? 0;
    check('a second game: chips reset to 1,500 each', second?.gameNo === 2 && second.table!.seats.reduce((a, s) => a + s.stack, 0) + inPlay === 1500 * second.table!.seats.length);

    // ------------------------------------------------------------ away and back
    console.log('\naway and back');
    G.autoplay = false;
    G.socket.close();
    await until(async () => (await peekRoom(ORG, code))?.players.find((p) => p.userId === G.user.userId)?.online === false);
    await run('G, away, sits out so the table does not wait', async () => Boolean((await peekRoom(ORG, code))?.table?.seats.find((s) => s.userId === G.user.userId)?.sittingOut), 2000, 20);
    const G2 = await open(people[6]);
    clients.push(G2);
    await until(async () => G2.room?.code === code && (await peekRoom(ORG, code))?.players.find((p) => p.userId === G.user.userId)?.online === true);
    const backIn = await peekRoom(ORG, code);
    check('G reopens Speed Poker: back at the table and playing', G2.room?.code === code && !!backIn && !backIn.table!.seats.find((s) => s.userId === G.user.userId)!.sittingOut && backIn.players.find((p) => p.userId === G.user.userId)!.online);

    // ------------------------------------------------------------ the house
    console.log('\nagainst the house');
    const I = await open(people[8]);
    clients.push(I);
    const practice = await request(I, 'room:practice');
    await wait(50);
    check('practice: a private table with three house players, dealt at once', practice.ok && practice.data.status === 'playing' && practice.data.open === false && practice.data.table?.seats.length === 4);
    const pCode = practice.ok ? String(practice.data.code) : '';
    await run('the house table plays to the end', async () => (await peekRoom(ORG, pCode))?.status === 'over', 4000, 800);
    const pOver = await peekRoom(ORG, pCode);
    check('the house players acted on their own', !!pOver && pOver.table!.handNo > 1);
    const hosting = await request(I, 'room:host', {});
    const hostCode = hosting.ok ? String(hosting.data.code) : '';
    check('opening a new table leaves the old one', hosting.ok && (await peekRoom(ORG, pCode)) === null);
    const house = await request(I, 'room:house', { delta: 1 });
    check('the host adds a house player to make two', house.ok && house.data.house === 1);
    const start2 = await request(I, 'room:start');
    check('and deals against them', start2.ok);
    await request(I, 'room:leave');
    check('the only person leaving closes the table', (await peekRoom(ORG, hostCode)) === null);
  } finally {
    for (const c of clients) c.socket.close();
    closePokerRealtime();
    closeConnectRealtime();
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    await getDb().dropDatabase().catch(() => undefined);
    await closeDb();
  }
  console.log(failures ? `\n${failures} check(s) failed, ${passes} passed.` : `\nAll ${passes} Speed Poker room checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
