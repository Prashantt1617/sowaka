/**
 * Speed Poker end to end, on a scratch database and real sockets: the page
 * and its ticket, the office screen link, a practice day, a scored game day
 * (seating the moment six queue, the four-player fallback, cooldowns, the
 * board and the office league), the semifinals with picks, the final, the
 * champion, a table against the house, and the screen watching. Tables are
 * shortened to a couple of minutes and the clock is moved by hand.
 *
 *   MONGODB_DB=poker_check npx tsx src/scripts/poker-room-check.ts
 *
 * No REDIS_URL: the store runs in memory. The database is dropped afterwards.
 */
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, gameCatalog, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { PokerEvent } from '../models/poker.model';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import type { PokerTableView } from '../services/poker-engine';
import { ensurePokerIndexes, pokerEvents, pokerHands, pokerPicks, pokerResults } from '../services/poker-db';
import { DEFAULT_CONFIG } from '../services/poker-floor';
import { closePokerRealtime, initPokerRealtime } from '../services/poker-realtime.service';
import { configurePoker, forgetEvent, tickPoker } from '../services/poker-room.service';
import { resetPokerMemory } from '../services/poker-store';
import { mintTicket } from '../services/scribble-ticket.service';

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ORG = 'sowaka';
const PORT = 4318;
const BASE = `http://localhost:${PORT}`;
const clock = { now: Date.UTC(2026, 10, 5, 4, 30, 0) };
const pushes: { userIds: string[]; title: string }[] = [];

let seed = 42;
const die = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

interface Client {
  user: User;
  socket: ClientSocket;
  table: PokerTableView | null;
  shared: Record<string, unknown> | null;
  seated: string[];
  toasts: string[];
  autoplay: boolean;
}

const OFFICES = ['Gurgaon', 'Noida', 'Kolkata'];
function seedUser(i: number): User {
  return { userId: `pk-u${i}`, name: `Player ${i}`, email: `p${i}@${ORG}.local`, employeeId: `PK-${i}`, org: ORG, lifecycleStatus: 'active', location: OFFICES[i % 3] } as User;
}

type Ack = { ok: true; data: Record<string, any> } | { ok: false; status: number; message: string };
const request = (c: Client, event: string, payload: Record<string, unknown> = {}) =>
  new Promise<Ack>((resolve) => c.socket.timeout(4000).emit(event, payload, (err: unknown, res: Ack) => resolve(err ? { ok: false, status: 0, message: 'timeout' } : res)));

function open(user: User, auth: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(`${BASE}/poker`, { path: '/connect/socket', transports: ['websocket'], auth, reconnection: false });
    const c: Client = { user, socket, table: null, shared: null, seated: [], toasts: [], autoplay: true };
    socket.on('table:state', (v: PokerTableView) => {
      if (v.mySeat === null) return;
      c.table = v;
      // Plays as a person would: calls, sometimes shoves a pair, folds junk to big bets.
      if (c.autoplay && v.status === 'playing' && v.toAct === v.mySeat && v.choices) {
        const me = v.seats[v.mySeat];
        const pair = me.cards && me.cards[0][0] === me.cards[1][0];
        const action = pair && v.choices.canRaise ? { kind: 'allin' } : v.choices.canCheck ? { kind: 'check' } : v.choices.toCall > me.stack / 2 && !pair ? { kind: 'fold' } : { kind: 'call' };
        void request(c, 'table:act', { tableId: v.id, action });
      }
    });
    socket.on('lobby:shared', (s: Record<string, unknown>) => (c.shared = s));
    socket.on('table:seated', (p: { tableId: string }) => c.seated.push(p.tableId));
    socket.on('poker:toast', (p: { message: string }) => c.toasts.push(p.message));
    socket.on('connect', () => resolve(c));
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

/** Moves the clock in steps, letting the server tick, until [done] holds. */
async function run(label: string, done: () => boolean | Promise<boolean>, stepMs = 4000, maxSteps = 400): Promise<boolean> {
  for (let i = 0; i < maxSteps; i++) {
    if (await done()) return true;
    clock.now += stepMs;
    await tickPoker();
    await wait(30);
  }
  const ok = await done();
  if (!ok) check(label, false, 'never happened');
  return ok;
}

async function event(): Promise<PokerEvent> {
  return (await pokerEvents().findOne({ id: 'pk-check' }, { projection: { _id: 0 } }))!;
}
async function setEvent(change: Record<string, unknown>) {
  await pokerEvents().updateOne({ id: 'pk-check' }, { $set: change });
  forgetEvent(ORG, 'pk-check');
}
const iso = (offsetMin: number) => new Date(clock.now + offsetMin * 60_000).toISOString();

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
    configurePoker({ now: () => clock.now, random: die, notify: async (userIds, input) => void pushes.push({ userIds, title: input.title }), houseDelayMs: 1000 });
    const people = Array.from({ length: 19 }, (_, i) => seedUser(i + 1));
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

    // ------------------------------------------------------------ the page
    console.log('the page');
    const page = await fetch(`${BASE}/play/speed-poker`, { headers: { authorization: `Bearer ${session}` } });
    const html = await page.text();
    const injected = /window\.__POKER=(\{.*?\})<\/script>/.exec(html);
    const payload = injected ? JSON.parse(injected[1]) : null;
    check('the app fetch serves the page with a ticket and a hop token', page.status === 200 && !!payload?.ticket && !!payload?.hopTicket);
    const hopped = await fetch(`${BASE}/play/speed-poker?ticket=${encodeURIComponent(payload.hopTicket)}`);
    check("the hop copy lets the page reach this host's socket", hopped.status === 200 && /connect-src 'self'/.test(hopped.headers.get('content-security-policy') ?? ''));

    // ------------------------------------------------------------ before the event
    console.log('\nbefore any event');
    for (const user of people) clients.push(await open(user, { ticket: mintTicket({ userId: user.userId, org: ORG, name: user.name }) }));
    const [A] = clients;
    const none = await request(A, 'poker:hello');
    check('no event: the page hears so', none.ok && none.data.event === null);
    const early = await request(A, 'queue:join');
    check('and cannot queue', !early.ok && early.status === 404);

    const short = { durationMs: 2 * 60_000, levelMs: 30_000, handPauseMs: 1000 };
    await pokerEvents().insertOne({
      id: 'pk-check', org: ORG, name: 'Check Speed Poker', catalogKey: 'speed-poker', status: 'live', paused: false,
      config: {
        ...structuredClone(DEFAULT_CONFIG),
        formats: { practice: short, open: short, semi: short, final: short },
        practice: { from: iso(-10), to: iso(60) },
        game: { openFrom: iso(24 * 60), openTo: iso(26 * 60), powerFrom: null, powerTo: null, bountiesFrom: null, semisAt: iso(27 * 60), finalAt: iso(28 * 60) },
      },
      semis: null, final: null, champion: null, postId: null, createdAt: now, updatedAt: now,
    });
    forgetEvent(ORG, 'pk-check');
    // Sockets joined their event room when they connected, before the event existed: reconnect.
    for (const c of clients) c.socket.disconnect();
    clients.length = 0;
    for (const user of people) clients.push(await open(user, { ticket: mintTicket({ userId: user.userId, org: ORG, name: user.name }) }));

    // ------------------------------------------------------------ practice day
    console.log('\npractice day');
    const hello = await request(clients[0], 'poker:hello');
    check('the page sees the practice day', hello.ok && hello.data.shared?.event?.phase === 'practice');
    for (const c of clients.slice(0, 5)) await request(c, 'queue:join');
    await tickPoker();
    check('five waiting: no table yet', clients.slice(0, 5).every((c) => c.seated.length === 0));
    await request(clients[5], 'queue:join');
    clock.now += 1000;
    await tickPoker();
    await wait(100);
    check('the sixth sits down: a table at once', clients.slice(0, 6).every((c) => c.seated.length === 1));
    check('and everyone is told by push', pushes.some((p) => p.userIds.length === 6 && /table is ready/.test(p.title)));
    const practiceId = clients[0].seated[0];
    const again = await request(clients[0], 'queue:join');
    check('someone at a table cannot queue', !again.ok && again.status === 409);
    await run('the practice table finishes', async () => clients[0].table?.id === practiceId && clients[0].table?.status === 'over');
    await wait(150);
    const practiceRows = await pokerResults().find({ tableId: practiceId }).toArray();
    check('practice results are kept, worth nothing', practiceRows.length === 6 && practiceRows.every((r) => r.points === 0 && !r.counted));
    check('and every hand was recorded', (await pokerHands().countDocuments({ tableId: practiceId })) > 0);

    // ------------------------------------------------------------ against the house
    console.log('\nagainst the house');
    const solo = clients[18];
    const house = await request(solo, 'practice:start');
    check('a practice table against the house opens', house.ok && typeof house.data.tableId === 'string');
    const houseId = house.ok ? String(house.data.tableId) : '';
    await run('the house table plays to the end', async () => solo.table?.id === houseId && solo.table?.status === 'over', 4000, 600);
    check('the house players acted on their own', (await pokerHands().countDocuments({ tableId: houseId })) > 1);

    // ------------------------------------------------------------ game day
    console.log('\ngame day');
    await setEvent({ 'config.practice': { from: iso(-120), to: iso(-60) }, 'config.game.openFrom': iso(-1), 'config.game.openTo': iso(90), 'config.game.powerFrom': iso(-1), 'config.game.powerTo': iso(30), 'config.game.semisAt': iso(150), 'config.game.finalAt': iso(200) });
    for (const c of clients) {
      c.seated = [];
      c.table = null;
    }
    await wait(50);
    for (const c of clients.slice(0, 18)) {
      const r = await request(c, 'queue:join');
      if (!r.ok) check(`queue join for ${c.user.name}`, false, r.message);
    }
    clock.now += 1000;
    await tickPoker();
    await wait(150);
    const tableIds = new Set(clients.slice(0, 18).flatMap((c) => c.seated));
    check('eighteen queued: three tables of six at once', tableIds.size === 3 && clients.slice(0, 18).every((c) => c.seated.length === 1));
    await run('the three scored tables finish', async () => clients.slice(0, 18).every((c) => c.table?.status === 'over'));
    await wait(200);
    const scored = await pokerResults().find({ eventId: 'pk-check', round: 'open' }).toArray();
    check('eighteen scored results, counted, power hour doubled', scored.length === 18 && scored.every((r) => r.counted && r.power));
    check('a survivor scores chips doubled', scored.some((r) => !r.busted && r.points >= r.chips * 2));
    const cool = await request(clients[0], 'queue:join');
    check('straight after a table: wait for the cooldown', !cool.ok && cool.status === 429);
    clock.now += 2 * 60_000 + 1000;
    for (const c of clients.slice(0, 4)) {
      c.seated = [];
      await request(c, 'queue:join');
    }
    clock.now += 1000;
    await tickPoker();
    await wait(80);
    check('four waiting: no table before the fallback', clients.slice(0, 4).every((c) => c.seated.length === 0));
    clock.now += 6 * 60_000;
    await tickPoker();
    await wait(150);
    check('after six minutes: a table of four', clients.slice(0, 4).every((c) => c.seated.length === 1) && new Set(clients.slice(0, 4).flatMap((c) => c.seated)).size === 1);
    await run('the table of four finishes', async () => clients.slice(0, 4).every((c) => c.table?.status === 'over'));
    await wait(150);
    const lobby = await request(clients[5], 'poker:hello');
    const shared = lobby.ok ? lobby.data.shared : null;
    check('the board ranks everyone with counted tables', shared?.board?.length === 18);
    check('the office league has the three offices', shared?.league?.length === 3);
    check('the board keeps the best three', shared?.board?.every((r: { best: number[] }) => r.best.length <= 3));

    // ------------------------------------------------------------ the semifinals
    console.log('\nthe semifinals');
    await setEvent({ 'config.game.openTo': iso(0), 'config.game.semisAt': iso(10), 'config.game.finalAt': iso(60) });
    await run('the top twelve are seeded', async () => Boolean((await event()).semis), 1000, 20);
    const e1 = await event();
    const seeded = e1.semis!.tables.flatMap((t) => t.players);
    check('two tables of six from the top twelve', e1.semis!.tables.length === 2 && seeded.length === 12);
    const watcher = clients.find((c) => !seeded.includes(c.user.userId))!;
    const player = clients.find((c) => seeded.includes(c.user.userId))!;
    const tooEarly = await request(watcher, 'picks:place', { stage: 'semi', table: 'A', kind: 'winner', choice: e1.semis!.tables[0].players[0], stake: 100 });
    check('picks open fifteen minutes before: open now', tooEarly.ok, tooEarly.ok ? '' : tooEarly.message);
    const own = await request(player, 'picks:place', { stage: 'semi', table: 'B', kind: 'winner', choice: e1.semis!.tables[1].players[0], stake: 100 });
    check('a semifinalist cannot pick', !own.ok);
    const first = await request(watcher, 'picks:place', { stage: 'semi', table: 'A', kind: 'firstOut', choice: e1.semis!.tables[0].players[5], stake: 400 });
    check('a second pick within the budget', first.ok);
    const over = await request(watcher, 'picks:place', { stage: 'semi', table: 'B', kind: 'winner', choice: e1.semis!.tables[1].players[0], stake: 100 });
    check('past the budget: refused', !over.ok);
    for (const c of clients) c.seated = [];
    await setEvent({ 'config.game.semisAt': iso(0) });
    await run('the semifinals start', async () => Boolean((await event()).semis?.startedAt), 1000, 10);
    await wait(150);
    check('every semifinalist is seated', seeded.every((id) => clients.find((c) => c.user.userId === id)!.seated.length === 1));
    const late = await request(watcher, 'picks:place', { stage: 'semi', table: 'B', kind: 'winner', choice: e1.semis!.tables[1].players[0], stake: 10 });
    check('picks close when the semifinals start', !late.ok);
    const tv = await open(people[0], { tv: mintTicket({ userId: 'pk-check', org: ORG, name: 'tv' }, { kind: 'poker-tv' }) });
    const tvHello = await request(tv, 'poker:hello');
    check('the office screen sees the lobby', tvHello.ok && tvHello.data.tv === true && tvHello.data.shared?.event?.phase === 'semis');
    const tvSit = await request(tv, 'queue:join');
    check('and cannot sit down', !tvSit.ok && tvSit.status === 403);
    const tvWatch = await request(tv, 'table:watch', { tableId: (await event()).semis!.tables[0].tableId });
    check('it watches a semifinal with no cards showing', tvWatch.ok && (tvWatch.data.table as PokerTableView).seats.every((s) => s.cards === null || (tvWatch.data.table as PokerTableView).result !== null));
    tv.socket.close();
    await run('both semifinals finish and the final is seeded', async () => Boolean((await event()).final), 4000, 500);
    const e2 = await event();
    check('the final seats the top three of each semifinal', e2.final!.tables[0].players.length === 6);
    const semiPicks = await pokerPicks().find({ eventId: 'pk-check', stage: 'semi' }).toArray();
    check('semifinal picks are settled', semiPicks.length === 2 && semiPicks.every((p) => p.payout !== null));

    // ------------------------------------------------------------ the final
    console.log('\nthe final');
    const finalists = e2.final!.tables[0].players;
    const fan = clients.find((c) => !finalists.includes(c.user.userId) && !seeded.includes(c.user.userId))!;
    const fanPick = await request(fan, 'picks:place', { stage: 'final', table: 'F', kind: 'fullTime', choice: 'yes', stake: 500 });
    check('picks on the final open once it is seeded', fanPick.ok, fanPick.ok ? '' : fanPick.message);
    for (const c of clients) c.seated = [];
    await setEvent({ 'config.game.finalAt': iso(0) });
    await run('the final finishes', async () => Boolean((await event()).final?.endedAt), 4000, 500);
    const e3 = await event();
    check('a champion, from the final table', !!e3.champion && finalists.includes(e3.champion.userId));
    check('final picks are settled', (await pokerPicks().find({ stage: 'final', payout: null }).toArray()).length === 0);
    const end = await request(fan, 'poker:hello');
    check('the lobby says it is over, with the champion', end.ok && end.data.shared?.event?.phase === 'over' && end.data.shared?.champion?.userId === e3.champion!.userId);
  } finally {
    for (const c of clients) c.socket.close();
    closePokerRealtime();
    closeConnectRealtime();
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    await getDb().dropDatabase().catch(() => undefined);
    await closeDb();
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll Speed Poker end-to-end checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
