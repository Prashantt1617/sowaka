/**
 * Drives Scribble end to end: tickets, the page endpoint and its policy, and
 * the `/scribble` namespace with real socket clients against a clock moved by
 * hand. Runs against a scratch database and drops it afterwards:
 *   MONGODB_DB=scribble_check npm run scribble:check
 *   REDIS_URL=redis://localhost:6379 MONGODB_DB=scribble_check npm run scribble:check
 *
 * Also mints tickets for the browser live test, on a developer's machine only
 * and only for the sowaka org (nothing is written):
 *   npx tsx src/scripts/scribble-check.ts --mint <userId|email> [--ttl <ms>]
 */
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { authSessions, closeDb, companies, connectDb, gameCatalog, gameScores, getDb, users } from '../config/db';
import { env } from '../config/env';
import { closeRedis, redisClient, redisReady } from '../config/redis';
import type { ScribbleOp, ScribbleView } from '../models/scribble.model';
import type { User } from '../models/user.model';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import type { NotificationInput } from '../services/notification.service';
import { SCRIBBLE, advance, guessOutcome, guessPoints, hintsWanted, maskOf, newRoom, normalizeGuess, validateOp } from '../services/scribble-engine';
import { closeScribbleRealtime, initScribbleRealtime } from '../services/scribble-realtime.service';
import { configureScribble, peekRoom, tickScribble } from '../services/scribble-room.service';
import { resetScribbleMemory } from '../services/scribble-store';
import { HOP_TTL_MS, TICKET_TTL_MS, mintTicket, redactTicket, verifyTicket } from '../services/scribble-ticket.service';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

// ---------------------------------------------------------------- --mint

/** One JSON line per person named (ids or emails, comma-separated). */
async function mintForLiveTest(who: string) {
  if (!env.isLocal) {
    console.error('Refusing to mint tickets: NODE_ENV does not name a developer environment.');
    process.exit(1);
  }
  await connectDb();
  try {
    for (const name of who.split(',').map((v) => v.trim()).filter(Boolean)) {
      const user = await users().findOne(
        { $or: [{ userId: name }, { email: name.toLowerCase() }] },
        { projection: { _id: 0, userId: 1, name: 1, org: 1, email: 1, lifecycleStatus: 1 } },
      );
      const org = user?.org ?? user?.email.split('@').at(1);
      if (!user || org !== 'sowaka') {
        console.error('Refusing to mint: tickets are minted only for sowaka users.');
        process.exit(1);
      }
      const ttl = Number(flag('--ttl'));
      const subject = { userId: user.userId, org, name: user.name };
      const options = Number.isFinite(ttl) ? { ttlMs: ttl } : {};
      console.log(
        JSON.stringify({
          userId: user.userId,
          name: user.name,
          ticket: mintTicket(subject, options),
          hopTicket: mintTicket(subject, { kind: 'hop', ...options }),
        }),
      );
    }
  } finally {
    await closeDb();
  }
}

if (flag('--mint')) {
  void mintForLiveTest(String(flag('--mint'))).then(() => process.exit(0));
} else {
  // The database is dropped at the end: only a name that is plainly a scratch one.
  if (!/^(scribble_)?check$/.test(env.mongoDbName) && !/scratch/i.test(env.mongoDbName)) {
    console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=scribble_check.`);
    process.exit(1);
  }
  // Keys are written and read under real names: a shared Redis would be mixed with a live game's.
  const redisHost = (() => {
    try {
      return process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost';
    } catch {
      return '';
    }
  })();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(redisHost) && !args.includes('--redis-ok')) {
    console.error(`Refusing to run against Redis at "${redisHost || process.env.REDIS_URL}". Use a local Redis, or pass --redis-ok.`);
    process.exit(1);
  }
  void runChecks();
}

// ---------------------------------------------------------------- harness

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(25);
  }
  check(label, false, `timed out after ${timeoutMs}ms`);
  return false;
}

const ORG = 'sowaka';
const OTHER = 'othercheck';
const PORT = 4312;
const BASE = `http://localhost:${PORT}`;

/** The clock the game runs on. Sockets and rate limits keep real time. */
const clock = { now: Date.UTC(2026, 9, 13, 10, 0, 0) };
const advanceClock = async (ms: number) => {
  clock.now += ms;
  await tickScribble();
};

/** A die that can be made to repeat itself, so two orgs can draw the same code. */
let dieSequence: number[] | null = null;
const die = () => {
  if (dieSequence && dieSequence.length > 0) return dieSequence.shift() as number;
  return Math.random();
};

const pushes: Array<{ userIds: string[]; input: NotificationInput }> = [];

interface Client {
  userId: string;
  socket: ClientSocket;
  states: Array<{ room: ScribbleView | null; strokes?: ScribbleOp[] }>;
  feeds: Array<Record<string, unknown>>;
  draws: ScribbleOp[][];
  closes: string[];
  kicked: unknown[];
  invites: Array<{ from: { userId: string; name: string }; code: string }>;
  fatal: unknown[];
}

const clients = new Map<string, Client>();
const room = (c: Client) => c.states.at(-1)?.room ?? null;
const player = (c: Client, userId: string) => room(c)?.players.find((p) => p.userId === userId);

function seedUser(index: number, org = ORG): User {
  return {
    userId: `${org}-u${index}`,
    name: `Player ${index}${org === ORG ? '' : ' Other'}`,
    email: `p${index}@${org}.local`,
    employeeId: `CK-${org}-${index}`,
    org,
    lifecycleStatus: 'active',
  } as User;
}

const ticketFor = (user: Pick<User, 'userId' | 'org' | 'name'>, options?: Parameters<typeof mintTicket>[1]) =>
  mintTicket({ userId: user.userId, org: user.org as string, name: user.name }, options);

function open(user: Pick<User, 'userId' | 'org' | 'name'>, ticket = ticketFor(user)): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(`${BASE}/scribble`, { path: '/connect/socket', transports: ['websocket'], auth: { ticket }, reconnection: false });
    const client: Client = { userId: user.userId, socket, states: [], feeds: [], draws: [], closes: [], kicked: [], invites: [], fatal: [] };
    socket.on('room:state', (p: { room: ScribbleView | null; strokes?: ScribbleOp[] }) => client.states.push(p));
    socket.on('room:feed', (p: Record<string, unknown>) => client.feeds.push(p));
    socket.on('scribble:draw', (p: { ops: ScribbleOp[] }) => client.draws.push(p.ops));
    socket.on('scribble:close', (p: { text: string }) => client.closes.push(p.text));
    socket.on('room:kicked', (p: unknown) => client.kicked.push(p));
    socket.on('room:invite', (p: { from: { userId: string; name: string }; code: string }) => client.invites.push(p));
    socket.on('room:fatal', (p: unknown) => client.fatal.push(p));
    socket.on('connect', () => {
      clients.set(user.userId, client);
      resolve(client);
    });
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

type Ack = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };
const request = (c: Client, event: string, payload: Record<string, unknown> = {}) =>
  new Promise<Ack>((resolve) => c.socket.timeout(4000).emit(event, payload, (err: unknown, res: Ack) => resolve(err ? { ok: false, status: 0, message: 'timeout' } : res)));
const turnKey = (c: Client) => room(c)?.turnKey ?? null;

async function connectError(user: Pick<User, 'userId' | 'org' | 'name'>, ticket: string): Promise<string> {
  try {
    const c = await open(user, ticket);
    c.socket.close();
    return 'connected';
  } catch (error) {
    return (error as Error).message;
  }
}

/** Plays out whatever phase the room is in until `until` holds, moving the clock. */
async function playUntil(a: Client, until: () => boolean, pickers: Map<string, Client>, maxSteps = 60) {
  for (let step = 0; step < maxSteps && !until(); step += 1) {
    const r = room(a);
    if (!r) return;
    if (r.status === 'picking') {
      const drawer = pickers.get(r.drawerId ?? '');
      if (drawer) await request(drawer, 'scribble:pick', { i: 0, turn: turnKey(drawer) });
      else await advanceClock(SCRIBBLE.pickMs);
    } else if (r.status === 'drawing') await advanceClock(SCRIBBLE.turnMs);
    else if (r.status === 'reveal') await advanceClock(SCRIBBLE.revealMs);
    else return;
    await wait(60);
  }
}

// ---------------------------------------------------------------- the checks

async function runChecks() {
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await connectDb();
    if (process.env.REDIS_URL) {
      redisClient();
      await wait(1200);
    }
    console.log(`\nusing scratch database "${env.mongoDbName}", store backed by ${redisReady() ? 'REDIS' : 'in-process memory'}\n`);
    resetScribbleMemory();
    configureScribble({ now: () => clock.now, random: die, notify: async (userIds, input) => void pushes.push({ userIds, input }) });

    const players = Array.from({ length: 9 }, (_, i) => seedUser(i + 1));
    const others = [seedUser(1, OTHER), seedUser(2, OTHER)];
    const gone = { ...seedUser(99), lifecycleStatus: 'offboarded' } as User;
    await users().insertMany([...players, ...others, gone]);
    const now = new Date();
    await companies().insertMany([
      { id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['scribble'] } as never,
      { id: OTHER, name: 'Other', enabledTabs: ['games'], enabledGames: ['scribble'] } as never,
    ]);
    await gameCatalog().insertOne({
      key: 'scribble', name: 'Scribble', kind: 'web', order: 50, active: true,
      scoring: { higherIsBetter: true, label: 'points', max: 20000 },
      html: '<!doctype html><html><head><meta charset="utf-8"><title>Scribble</title>\n<!--SCRIBBLE-TICKET-->\n</head><body>page</body></html>',
      createdAt: now, updatedAt: now,
    });
    const sessionToken = `tok-${randomUUID()}`;
    await authSessions().insertOne({ tokenHash: hashSessionToken(sessionToken), userId: players[0].userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) });

    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const io = initConnectRealtime(server);
    initScribbleRealtime(io);

    // ------------------------------------------------------------ tickets
    console.log('tickets');
    const [A0, B0, C0, D0] = players;
    const good = ticketFor(A0);
    const verdict = verifyTicket(good, 'ticket');
    check('a minted ticket verifies and names its subject', verdict.ok && verdict.ticket.userId === A0.userId && verdict.ticket.org === ORG && verdict.ticket.name === A0.name);
    check('it lives twelve hours', verdict.ok && verdict.ticket.exp - verdict.ticket.iat === TICKET_TTL_MS);
    const expired = ticketFor(A0, { ttlMs: -1 });
    check('an expired ticket says so', !verifyTicket(expired, 'ticket').ok && (verifyTicket(expired, 'ticket') as { error: string }).error === 'ticket_expired');
    const tampered = good.slice(0, -4) + (good.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    check('a tampered ticket is invalid', (verifyTicket(tampered, 'ticket') as { error: string }).error === 'ticket_invalid');
    const body = good.split('.');
    const forged = `${body[0]}.${Buffer.from(JSON.stringify({ userId: A0.userId, org: OTHER, name: 'x', kind: 'ticket', exp: Date.now() + 1e6, iat: Date.now() })).toString('base64url')}.${body[2]}`;
    check('a ticket rewritten for another org is invalid', (verifyTicket(forged, 'ticket') as { error: string }).error === 'ticket_invalid');
    const hop = ticketFor(A0, { kind: 'hop' });
    check('a hop token is not a socket ticket', (verifyTicket(hop, 'ticket') as { error: string }).error === 'ticket_invalid');
    check('nor a ticket a hop token', (verifyTicket(good, 'hop') as { error: string }).error === 'ticket_invalid');
    const hopVerdict = verifyTicket(hop, 'hop');
    check('a hop token lives two minutes', hopVerdict.ok && hopVerdict.ticket.exp - hopVerdict.ticket.iat === HOP_TTL_MS && HOP_TTL_MS === 120_000);
    check('garbage is invalid, quietly', ['', 'x', 's1.a', 's1.a.b.c', 42, null].every((v) => (verifyTicket(v, 'ticket') as { error: string }).error === 'ticket_invalid'));
    check('a ticket is blanked out of a URL', redactTicket('/play/scribble?ticket=abc.def&x=1') === '/play/scribble?ticket=[redacted]&x=1');

    // ------------------------------------------------------------ the page
    console.log('\nthe page');
    const withSession = await fetch(`${BASE}/play/scribble`, { headers: { authorization: `Bearer ${sessionToken}` } });
    const sessionHtml = await withSession.text();
    const injected = /window\.__SCRIBBLE=(\{.*?\})<\/script>/.exec(sessionHtml);
    const injectedJson = injected ? (JSON.parse(injected[1]) as { ticket?: string; hopTicket?: string }) : null;
    check('the session fetch serves the page with __SCRIBBLE in it', withSession.status === 200 && !!injectedJson?.ticket && !sessionHtml.includes('<!--SCRIBBLE-TICKET-->'));
    check('the injected ticket is a socket ticket for the viewer', !!injectedJson?.ticket && (verifyTicket(injectedJson.ticket, 'ticket') as { ok: boolean }).ok);
    check('and it carries a hop token for the reload', !!injectedJson?.hopTicket && (verifyTicket(injectedJson.hopTicket, 'hop') as { ok: boolean }).ok);
    check("the session copy keeps connect-src 'none'", /connect-src 'none'/.test(withSession.headers.get('content-security-policy') ?? ''));
    const noAuth = await fetch(`${BASE}/play/scribble`);
    check('without a session or a ticket, 401', noAuth.status === 401);

    const hopped = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(injectedJson!.hopTicket!)}`);
    const hoppedHtml = await hopped.text();
    const hoppedJson = /window\.__SCRIBBLE=(\{.*?\})<\/script>/.exec(hoppedHtml);
    const hoppedPayload = hoppedJson ? (JSON.parse(hoppedJson[1]) as { ticket?: string; hopTicket?: string }) : null;
    const hoppedCsp = hopped.headers.get('content-security-policy') ?? '';
    check('the hop URL serves the page with no session', hopped.status === 200 && !!hoppedPayload?.ticket);
    check('the hop copy carries a socket ticket and no further hop', (verifyTicket(hoppedPayload?.ticket, 'ticket') as { ok: boolean }).ok && !hoppedPayload?.hopTicket);
    check("its policy lets the page reach this host's socket", new RegExp(`connect-src 'self' https://localhost:${PORT} wss://localhost:${PORT} http://localhost:${PORT} ws://localhost:${PORT}`).test(hoppedCsp), hoppedCsp.split(';').find((d) => /connect-src/.test(d)) ?? '');
    check("and keeps frame-ancestors 'none'", /frame-ancestors 'none'/.test(hoppedCsp));
    check('it is never cached and sends no referrer', hopped.headers.get('cache-control') === 'private, no-store' && hopped.headers.get('referrer-policy') === 'no-referrer');
    const forwarded = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(injectedJson!.hopTicket!)}`, { headers: { 'x-forwarded-host': 'api.example.com' } });
    check('behind a proxy the policy names the forwarded host', /wss:\/\/api\.example\.com/.test(forwarded.headers.get('content-security-policy') ?? ''));
    const evil = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(injectedJson!.hopTicket!)}`, { headers: { 'x-forwarded-host': "evil.com 'unsafe-eval'" } });
    check('a host header that is not a host is left out of the policy', !/evil/.test(evil.headers.get('content-security-policy') ?? '') && /connect-src 'self'/.test(evil.headers.get('content-security-policy') ?? ''));
    const longInUrl = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(injectedJson!.ticket!)}`);
    check('a socket ticket in the URL buys nothing', longInUrl.status === 401);
    const staleHop = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(ticketFor(A0, { kind: 'hop', ttlMs: -1 }))}`);
    check('an expired hop token is a plain 401 that says so', staleHop.status === 401 && /expired/.test(await staleHop.text()));
    const otherHop = await fetch(`${BASE}/play/scribble?ticket=${encodeURIComponent(mintTicket({ userId: 'nobody', org: 'nogames', name: 'N' }, { kind: 'hop' }))}`);
    check("a hop token from a company without the game is refused", otherHop.status === 403);
    const otherGame = await fetch(`${BASE}/play/trails?ticket=${encodeURIComponent(injectedJson!.hopTicket!)}`, { headers: {} });
    check('another game ignores the ticket and wants a session', otherGame.status === 401);

    // ------------------------------------------------------------ handshakes
    console.log('\nhandshakes');
    check('a bad ticket is refused as invalid', (await connectError(A0, 'nonsense')) === 'ticket_invalid');
    check('an expired ticket is refused as expired', (await connectError(A0, expired)) === 'ticket_expired');
    check('a hop token is refused at the socket', (await connectError(A0, hop)) === 'ticket_invalid');
    check('no ticket and no session is refused', (await connectError(A0, '')) === 'not_allowed');
    const ghost = await open(gone, ticketFor(gone));
    await waitFor('offboarded told', () => ghost.fatal.length > 0 || ghost.socket.disconnected);
    check('an offboarded person with a valid ticket is told not_allowed and dropped', (ghost.fatal[0] as { code?: string } | undefined)?.code === 'not_allowed');
    const movedTicket = mintTicket({ userId: A0.userId, org: OTHER, name: A0.name });
    const moved = await open(A0, movedTicket);
    await waitFor('moved told', () => moved.fatal.length > 0 || moved.socket.disconnected);
    check("a ticket naming another org than the person's record is dropped", (moved.fatal[0] as { code?: string } | undefined)?.code === 'not_allowed');

    // ------------------------------------------------------------ rooms
    console.log('\nrooms');
    const A = await open(A0);
    const B = await open(B0);
    const C = await open(C0);
    const D = await open(D0);
    const hosted = await request(A, 'room:host', { gameKey: 'scribble' });
    const view = hosted.ok ? (hosted.data as unknown as ScribbleView) : null;
    check('hosting answers with the room view', !!view && view.status === 'lobby' && view.hostId === A0.userId && view.players.length === 1 && view.you === A0.userId);
    const code = view?.code ?? '';
    check('the code is five unambiguous characters', /^[A-HJKMNP-Z2-9]{5}$/.test(code), code);
    check('the view carries the rules', view?.min === 3 && view?.max === 8 && view?.rounds === 2 && view?.turnSec === 70 && view?.pickSec === 10 && view?.revealSec === 6);
    A.states.push({ room: view });

    const wrong = await request(B, 'room:join', { code: 'ZZZZZ' });
    check('a wrong code is a 404 with the company wording', !wrong.ok && wrong.status === 404 && /No room with that code at your company/.test(wrong.message));
    const badShape = await request(B, 'room:join', { code: 'abc' });
    check('a malformed code is the same 404', !badShape.ok && badShape.status === 404);
    const joined = await request(B, 'room:join', { code: code.toLowerCase() });
    const joinedView = joined.ok ? (joined.data.room as ScribbleView) : null;
    check('joining (lower case too) answers with the view and strokes', !!joinedView && joinedView.players.length === 2 && Array.isArray(joined.ok && joined.data.strokes));
    await waitFor('A sees B', () => (player(A, B0.userId) ?? null) !== null);
    check('the host is pushed the new player', !!player(A, B0.userId) && player(A, B0.userId)?.online === true);
    check('and a join line in the feed', A.feeds.some((f) => f.kind === 'join' && f.userId === B0.userId));

    const tooFew = await request(A, 'room:start');
    check('two players cannot start', !tooFew.ok && tooFew.status === 409 && /Need 3 players/.test(tooFew.message));
    await request(C, 'room:join', { code });
    const notHost = await request(B, 'room:start');
    check('only the host can start', !notHost.ok && notHost.status === 403);
    const notHostKick = await request(B, 'room:kick', { userId: C0.userId });
    check('only the host can remove players', !notHostKick.ok && notHostKick.status === 403);

    // ------------------------------------------------------------ invites
    console.log('\ninvites');
    pushes.length = 0;
    const invited = await request(A, 'room:invite', { userId: D0.userId });
    check('inviting a colleague is acknowledged', invited.ok && invited.data.invited === true);
    await waitFor('D invited', () => D.invites.length > 0);
    check('the invitee hears it on the socket', D.invites[0]?.code === code && D.invites[0]?.from.userId === A0.userId && D.invites[0]?.from.name === A0.name);
    const push = pushes[0];
    check('one push went out, to the invitee', pushes.length === 1 && push?.userIds.join() === D0.userId);
    check('with the game-challenge route and the room code as the challenge id', push?.input.data.destination === 'game_challenge' && push?.input.data.gameKey === 'scribble' && push?.input.data.challengeId === `room:${code}`);
    check('named for the host, with the code in the body', push?.input.scenario === 'scribble_invite' && push?.input.title === `${A0.name.split(' ')[0]} invited you to Scribble` && (push?.input.body ?? '').includes(code));
    await waitFor('A sees the invite listed', () => (room(A)?.invited ?? []).some((i) => i.userId === D0.userId));
    check('the lobby lists them as invited', (room(A)?.invited ?? []).some((i) => i.userId === D0.userId && i.name === D0.name));
    await request(A, 'room:invite', { userId: D0.userId });
    check('a second invite within ten minutes sends no second push', pushes.length === 1);
    await request(B, 'room:invite', { userId: D0.userId });
    await wait(50);
    check('another player inviting them is another pair, and pushes', pushes.length === 2 && pushes[1]?.userIds.join() === D0.userId);
    const stranger = await request(A, 'room:invite', { userId: others[0].userId });
    check('someone at another company cannot be invited', !stranger.ok && stranger.status === 404);
    const nobody = await request(A, 'room:invite', { userId: 'no-such-user' });
    check('nor someone who does not exist', !nobody.ok && nobody.status === 404);
    const self = await request(A, 'room:invite', { userId: A0.userId });
    check('nor yourself', !self.ok && self.status === 400);
    const outside = await request(D, 'room:invite', { userId: C0.userId });
    check('you must be in a room to invite', !outside.ok && outside.status === 404);

    // ------------------------------------------------------------ a turn
    console.log('\na turn');
    pushes.length = 0;
    const started = await request(A, 'room:start');
    check('three players start', started.ok);
    await waitFor('picking', () => room(B)?.status === 'picking');
    check('the first drawer is the host, first in the order', room(B)?.drawerId === A0.userId && room(B)?.turn === 1 && room(B)?.turns === 3 && room(B)?.round === 1);
    await waitFor('A choices', () => (room(A)?.choices?.length ?? 0) === 3);
    const choices = room(A)?.choices ?? [];
    check('the drawer gets three words, one of each level', choices.map((c) => c.level).join() === 'easy,medium,hard' && choices.every((c) => c.word.length > 0));
    check('guessers get no choices and no word', room(B)?.choices === null && room(B)?.word === null);
    check('the invite list is cleared at the start', (room(A)?.invited ?? []).length === 0);
    const stalePick = await request(B, 'scribble:pick', { i: 0, turn: turnKey(B) });
    check('a guesser cannot pick', !stalePick.ok && stalePick.status === 409);
    const picked = await request(A, 'scribble:pick', { i: 1, turn: turnKey(A) });
    check('the drawer picks', picked.ok);
    await waitFor('drawing', () => room(B)?.status === 'drawing');
    const word = room(A)?.word ?? '';
    check('the drawer sees the word they picked', word === choices[1].word, word);
    check('a guesser sees the mask, not the word', room(B)?.word === null && (room(B)?.mask ?? '').length === word.length && !/[a-z]/i.test(room(B)?.mask ?? '') && (room(B)?.mask ?? '').replace(/ /g, '').split('').every((ch) => ch === '_'));
    check('the clock is the server\'s', (room(B)?.endsAt ?? 0) === clock.now + SCRIBBLE.turnMs && room(B)?.serverNow === clock.now);
    const latePick = await request(A, 'scribble:pick', { i: 0, turn: turnKey(A) });
    check('picking again is too late', !latePick.ok && latePick.status === 409);

    console.log('\nstrokes');
    const ops: ScribbleOp[] = [{ t: 'b', id: 1, k: 0, c: 3, w: 1, x: 100, y: 100 }, { t: 'p', id: 1, pts: [110, 110, 120, 125, 140, 160] }];
    A.socket.emit('scribble:draw', { turn: turnKey(A), ops });
    await waitFor('B draw', () => B.draws.length > 0);
    check('strokes reach the guessers as sent', JSON.stringify(B.draws[0]) === JSON.stringify(ops) && C.draws.length === 1);
    check('and never the drawer', A.draws.length === 0);
    B.socket.emit('scribble:draw', { turn: turnKey(B), ops: [{ t: 'f', id: 2, c: 4, x: 5, y: 5 }] });
    A.socket.emit('scribble:draw', { turn: 'stale:1:0', ops: [{ t: 'f', id: 2, c: 4, x: 5, y: 5 }] });
    A.socket.emit('scribble:draw', { turn: turnKey(A), ops: [{ t: 'p', id: 1, pts: Array.from({ length: 2 * 301 }, (_, i) => i % 1000) }] });
    A.socket.emit('scribble:draw', { turn: turnKey(A), ops: [{ t: 'b', id: 1, k: 0, c: 3, w: 1, x: 1, y: 1 }, { t: 'u', id: 77 }, { t: 'x' }, { t: 'f', id: 3, c: 99, x: 5, y: 5 }] });
    A.socket.emit('scribble:draw', { turn: turnKey(A), ops: [{ t: 'f', id: 4, c: 4, x: 5, y: 5 }] });
    await waitFor('fill arrives', () => B.draws.length >= 2);
    await wait(150);
    check('a guesser\'s strokes, a stale turn, a 301-point message, a reused id, an unknown op, an out-of-range colour: all dropped', B.draws.length === 2 && JSON.stringify(B.draws[1]) === JSON.stringify([{ t: 'f', id: 4, c: 4, x: 5, y: 5 }]), JSON.stringify(B.draws.slice(1)));

    console.log('\nreconnect');
    C.socket.close();
    await waitFor('C offline', () => player(A, C0.userId)?.online === false);
    check('a dropped player shows offline to the others', player(A, C0.userId)?.online === false);
    const C2 = await open(C0);
    await waitFor('C2 state', () => C2.states.length > 0);
    const back = C2.states[0];
    check('a fresh socket is put back in the room with the strokes so far', back.room?.code === code && back.room?.status === 'drawing' && JSON.stringify(back.strokes) === JSON.stringify([...ops, { t: 'f', id: 4, c: 4, x: 5, y: 5 }]));
    check('and still without the word', back.room?.word === null);
    await waitFor('C online again', () => player(A, C0.userId)?.online === true);
    const rejoin = await request(C2, 'room:join', { code, rejoin: true });
    check('the belt-and-braces rejoin answers the same', rejoin.ok && (rejoin.data.room as ScribbleView).code === code && Array.isArray(rejoin.data.strokes));

    console.log('\nguesses');
    const wrongGuess = await request(B, 'scribble:guess', { turn: turnKey(B), text: 'zzzz' });
    check('a wrong guess is not correct', wrongGuess.ok && wrongGuess.data.correct === false && !wrongGuess.data.close);
    await waitFor('wrong guess in feed', () => A.feeds.some((f) => f.kind === 'guess' && f.text === 'zzzz') && C2.feeds.some((f) => f.kind === 'guess' && f.text === 'zzzz'));
    check('and the room reads it', A.feeds.some((f) => f.kind === 'guess' && f.text === 'zzzz' && f.userId === B0.userId) && C2.feeds.some((f) => f.kind === 'guess' && f.text === 'zzzz'));
    const nearly = word.length >= 4 ? word.slice(0, -1) + (word.endsWith('x') ? 'y' : 'x') : null;
    if (nearly) {
      const closeGuess = await request(B, 'scribble:guess', { turn: turnKey(B), text: nearly });
      await wait(100);
      check('one letter off is "close", told only to the guesser', closeGuess.ok && closeGuess.data.close === true && B.closes.includes(nearly) && !A.feeds.some((f) => f.text === nearly) && C2.closes.length === 0);
    }
    const rude = await request(B, 'scribble:guess', { turn: turnKey(B), text: 'you ASSHOLE' });
    await wait(100);
    check('a blocked word is not shown to the room', rude.ok && rude.data.blocked === true && !A.feeds.some((f) => String(f.text ?? '').toLowerCase().includes('asshole')));
    const hindi = await request(C2, 'scribble:guess', { turn: turnKey(C2), text: 'हाथी' });
    await waitFor('hindi guess in feed', () => A.feeds.some((f) => f.kind === 'guess' && f.text === 'हाथी'));
    check('a guess in another script is a wrong guess the room reads, not an empty one', hindi.ok && hindi.data.correct === false && A.feeds.some((f) => f.kind === 'guess' && f.text === 'हाथी' && f.userId === C0.userId) && B.feeds.some((f) => f.text === 'हाथी'));
    const drawerGuess = await request(A, 'scribble:guess', { turn: turnKey(A), text: word });
    check('the drawer cannot guess', drawerGuess.ok && drawerGuess.data.correct === false);
    await advanceClock(SCRIBBLE.turnMs / 2);
    await waitFor('hint', () => (room(B)?.mask ?? '').replace(/[_ ]/g, '').length === 1);
    check('at half time one letter shows', (room(B)?.mask ?? '').replace(/[_ ]/g, '').length === 1 && room(A)?.word === word);
    const right = await request(B, 'scribble:guess', { turn: turnKey(B), text: `a ${word.toUpperCase()}!` });
    check('the word inside a phrase, in any case, is correct and scored by the clock', right.ok && right.data.correct === true && right.data.points === 175, String(right.ok && right.data.points));
    await waitFor('B scored', () => player(A, B0.userId)?.score === 175 && player(C2, A0.userId)?.score === 50);
    check('the guesser\'s score shows to everyone, the drawer gets 50', player(A, B0.userId)?.score === 175 && player(C2, A0.userId)?.score === 50);
    await waitFor('B has word', () => room(B)?.word === word);
    check('the word reaches the guesser once they have it', room(B)?.word === word && player(B, B0.userId)?.guessed === true);
    check('a "correct" feed line never carries the text', A.feeds.some((f) => f.kind === 'correct' && f.userId === B0.userId && f.text === undefined));
    check('no state ever showed a guesser the word before they had it', !B.states.some((s) => s.room?.status === 'drawing' && s.room.drawerId !== B0.userId && !s.room.players.find((p) => p.userId === B0.userId)?.guessed && s.room.word));
    const again = await request(B, 'scribble:guess', { turn: turnKey(B), text: word });
    check('guessing again scores nothing', again.ok && again.data.correct === false);
    const ratelimited: Ack[] = [];
    for (let i = 0; i < 9; i += 1) ratelimited.push(await request(C2, 'scribble:guess', { turn: turnKey(C2), text: `spam${i}` }));
    check('a burst of guesses is rate limited', ratelimited.some((r) => !r.ok && r.status === 429));
    await wait(1100);
    const last = await request(C2, 'scribble:guess', { turn: turnKey(C2), text: word });
    check('the last guesser has it', last.ok && last.data.correct === true);
    await wait(100);
    check('not over yet: the early end waits 0.7 s', room(A)?.status === 'drawing');
    await advanceClock(SCRIBBLE.earlyEndMs);
    await waitFor('reveal', () => room(A)?.status === 'reveal');
    const reveal = room(C2);
    check('everyone having it ends the turn early, with the word and the gains', reveal?.status === 'reveal' && reveal.last?.why === 'all' && reveal.last.word === word && reveal.word === word && (reveal.last.gains ?? []).find((g) => g.userId === A0.userId)?.points === 100);

    console.log('\ntiming');
    await advanceClock(SCRIBBLE.revealMs);
    await waitFor('B picks', () => room(A)?.status === 'picking' && room(A)?.drawerId === B0.userId);
    check('after the reveal the next in order picks', room(A)?.drawerId === B0.userId && room(A)?.turn === 2);
    await waitFor('B choices', () => (room(B)?.choices?.length ?? 0) === 3);
    const bChoices = room(B)?.choices ?? [];
    await advanceClock(SCRIBBLE.pickMs);
    await waitFor('auto pick', () => room(A)?.status === 'drawing');
    check('ten seconds without a pick takes the first word', room(B)?.word === bChoices[0]?.word);
    const bWord = room(B)?.word ?? '';
    await advanceClock(SCRIBBLE.turnMs * 0.76);
    await wait(150);
    const letters = bWord.replace(/ /g, '').length;
    const shown = (room(A)?.mask ?? '').replace(/[_ ]/g, '').length;
    check('at three quarters, a second letter for five letters or more, never over half', shown === Math.min(Math.floor(letters / 2), letters >= 5 ? 2 : 1), `${bWord}: ${shown}`);
    await advanceClock(SCRIBBLE.turnMs * 0.25);
    await waitFor('time up', () => room(A)?.status === 'reveal');
    check('the turn ends when the clock runs out', room(A)?.last?.why === 'time' && (room(A)?.last?.gains ?? []).every((g) => g.points === 0));
    const beforeB = player(A, B0.userId)?.score;
    check('nobody scored for it', beforeB === 175);
    await advanceClock(SCRIBBLE.revealMs);
    await waitFor('C picks', () => room(A)?.status === 'picking' && room(A)?.drawerId === C0.userId);
    check('third turn: the third player draws', room(A)?.drawerId === C0.userId && room(A)?.turn === 3);
    await request(C2, 'scribble:pick', { i: 2, turn: turnKey(C2) });
    await waitFor('C drawing', () => room(A)?.status === 'drawing');
    C2.socket.close();
    await waitFor('C gone', () => player(A, C0.userId)?.online === false);
    await advanceClock(SCRIBBLE.drawerGoneMs - 1);
    await wait(100);
    check('a drawer gone nine seconds keeps the turn', room(A)?.status === 'drawing');
    await advanceClock(1);
    await waitFor('drawer left', () => room(A)?.status === 'reveal');
    check('gone ten seconds ends it as drawer_left', room(A)?.last?.why === 'drawer_left');
    await advanceClock(SCRIBBLE.revealMs);
    await waitFor('round two', () => room(A)?.round === 2);
    check('round two begins with the order rebuilt from who is here', room(A)?.round === 2 && room(A)?.turns === 2 && room(A)?.drawerId === A0.userId);
    let C3 = await open(C0);
    await waitFor('C back', () => player(A, C0.userId)?.online === true);

    console.log('\na guesser goes offline');
    await request(A, 'scribble:pick', { i: 0, turn: turnKey(A) });
    await waitFor('A drawing', () => room(B)?.status === 'drawing' && !!room(A)?.word);
    const aWord = room(A)?.word ?? '';
    const bRight = await request(B, 'scribble:guess', { turn: turnKey(B), text: aWord });
    check('B has the word at once, for 300', bRight.ok && bRight.data.correct === true && bRight.data.points === 300);
    await wait(100);
    check('C still guessing: the turn goes on', room(A)?.status === 'drawing' && (await peekRoom(ORG, code))?.pendingEndAt === null);
    C3.socket.close();
    await waitFor('C offline', () => player(A, C0.userId)?.online === false);
    await advanceClock(0);
    check('with the last guesser gone, everyone here has it: the early end is set', (await peekRoom(ORG, code))?.pendingEndAt === clock.now + SCRIBBLE.earlyEndMs);
    await advanceClock(SCRIBBLE.earlyEndMs - 1);
    await wait(100);
    check('and waits its 0.7 s', room(A)?.status === 'drawing');
    await advanceClock(1);
    await waitFor('early reveal', () => room(A)?.status === 'reveal');
    check('then the turn ends as "all"', room(A)?.last?.why === 'all' && room(A)?.last?.word === aWord);
    C3 = await open(C0);
    await waitFor('C back again', () => player(A, C0.userId)?.online === true);

    const pickers = new Map([[A0.userId, A], [B0.userId, B], [C0.userId, C3]]);
    await playUntil(A, () => room(A)?.status === 'over', pickers);
    check('the game ends after two rounds', room(A)?.status === 'over' && room(B)?.status === 'over' && room(C3)?.status === 'over', room(A)?.status);
    check('the podium carries everyone\'s scores and no drawer', (room(A)?.players ?? []).length === 3 && room(A)?.drawerId === null && player(A, B0.userId)?.score === 475 && player(A, C0.userId)?.score === 175 && player(A, A0.userId)?.score === 150);
    await wait(500);
    const boards = await gameScores().find({ gameId: 'catalog:scribble', org: ORG }).toArray();
    check('the final scores went to the game\'s board, by the server', boards.length === 3 && boards.find((b) => b.userId === B0.userId)?.score === 475 && boards.find((b) => b.userId === A0.userId)?.score === 150, JSON.stringify(boards.map((b) => [b.userId, b.score])));
    const notOverAgain = await request(B, 'room:again');
    check('only the host can play again', !notOverAgain.ok && notOverAgain.status === 403);

    console.log('\nhost leaves, kick, cleanup');
    await request(A, 'room:leave');
    await waitFor('host passes', () => room(B)?.hostId === B0.userId);
    check('the host leaving passes the role to the longest-present player', room(B)?.hostId === B0.userId && B.feeds.some((f) => f.kind === 'host' && f.userId === B0.userId) && B.feeds.some((f) => f.kind === 'leave' && f.userId === A0.userId));
    const againOk = await request(B, 'room:again');
    await waitFor('lobby again', () => room(C3)?.status === 'lobby');
    check('play again returns everyone to the lobby with scores at zero and a clean paper', againOk.ok && room(C3)?.status === 'lobby' && (room(C3)?.players ?? []).every((p) => p.score === 0) && JSON.stringify(C3.states.at(-1)?.strokes) === '[]');
    const kicked = await request(B, 'room:kick', { userId: C0.userId });
    await waitFor('C kicked', () => C3.kicked.length > 0 && (room(B)?.players ?? []).length === 1);
    check('the host removes a player, who is told by whom', kicked.ok && (C3.kicked[0] as { by: { userId: string } }).by.userId === B0.userId && (room(B)?.players ?? []).length === 1);
    const refused = await request(C3, 'room:join', { code });
    check('a removed player cannot rejoin', !refused.ok && refused.status === 403 && /removed/.test(refused.message));
    const kickGone = await request(B, 'room:kick', { userId: C0.userId });
    check('removing them again is a 404', !kickGone.ok && kickGone.status === 404);
    const heardByC = C3.feeds.length;
    await request(D, 'room:join', { code });
    await waitFor('B hears D join', () => B.feeds.some((f) => f.kind === 'join' && f.userId === D0.userId));
    await request(D, 'room:leave');
    await waitFor('B hears D leave', () => B.feeds.some((f) => f.kind === 'leave' && f.userId === D0.userId));
    check("a removed player's sockets are out of the room's channel: the feed no longer reaches them", C3.feeds.length === heardByC);
    B.socket.close();
    await wait(200);
    await advanceClock(SCRIBBLE.lobbyIdleMs - 1000);
    check('an empty lobby is kept for ten minutes', (await peekRoom(ORG, code)) !== null);
    await advanceClock(1000);
    check('then deleted', (await peekRoom(ORG, code)) === null);
    const afterwards = await request(A, 'room:join', { code });
    check('and its code is gone', !afterwards.ok && afterwards.status === 404);

    const finished = newRoom('ABCDE', ORG, { userId: 'x', name: 'X', photoUrl: null }, clock.now);
    finished.status = 'over';
    finished.finishedAt = clock.now;
    check('a finished room is kept fifteen minutes (engine)', advance(finished, clock.now + SCRIBBLE.overKeepMs - 1, Math.random) === null && advance(finished, clock.now + SCRIBBLE.overKeepMs, Math.random)?.some((e) => e.type === 'delete') === true);
    const ancient = newRoom('ABCDE', ORG, { userId: 'x', name: 'X', photoUrl: null }, clock.now - SCRIBBLE.roomMaxMs);
    check('no room outlives two hours (engine)', advance(ancient, clock.now, Math.random)?.some((e) => e.type === 'delete') === true);

    console.log('\nfull rooms and two companies');
    const H = await open(players[4]);
    const hostedFull = await request(H, 'room:host', { gameKey: 'scribble' });
    const fullCode = hostedFull.ok ? String(hostedFull.data.code) : '';
    const extra: Client[] = [];
    for (const p of [players[5], players[6], players[7], players[8], players[0], players[1], players[3]]) {
      const c = await open(p);
      extra.push(c);
      const j = await request(c, 'room:join', { code: fullCode });
      if (!j.ok) check(`${p.userId} joins`, false, j.message);
    }
    const ninth = await open(players[2]);
    const full = await request(ninth, 'room:join', { code: fullCode });
    check('a ninth player is refused as full', !full.ok && full.status === 409 && /full \(8 of 8\)/.test(full.message));
    const fullInvite = await request(H, 'room:invite', { userId: players[2].userId });
    check('and cannot be invited', !fullInvite.ok && fullInvite.status === 409);

    console.log('\nreconnect race, a drawer gone before picking');
    extra[0].socket.close();
    const E0 = await open(players[5]);
    await waitFor('E0 state', () => E0.states.length > 0);
    await wait(400);
    check('a reconnect that beats the close leaves the player online', player(H, players[5].userId)?.online === true && (await peekRoom(ORG, fullCode))?.players.find((p) => p.userId === players[5].userId)?.online === true);
    const bigStart = await request(H, 'room:start');
    await waitFor('H picking', () => room(E0)?.status === 'picking' && room(E0)?.drawerId === players[4].userId);
    check('eight start, the host picks first', bigStart.ok && room(E0)?.drawerId === players[4].userId);
    await request(H, 'room:leave');
    await waitFor('next picks', () => room(E0)?.drawerId === players[5].userId);
    check('the drawer leaving before picking hands the pick to the next, with no reveal', room(E0)?.status === 'picking' && room(E0)?.turn === 2 && !E0.states.some((s) => s.room?.status === 'reveal'));
    await waitFor('E0 choices', () => (room(E0)?.choices?.length ?? 0) === 3);
    E0.socket.close();
    await waitFor('E0 offline', () => player(extra[1], players[5].userId)?.online === false);
    await advanceClock(SCRIBBLE.drawerGoneMs);
    await waitFor('third picks', () => room(extra[1])?.drawerId === players[6].userId);
    check('a drawer offline ten seconds before picking: the next picks, still no reveal', room(extra[1])?.status === 'picking' && room(extra[1])?.turn === 3 && !extra[1].states.some((s) => s.room?.status === 'reveal'));

    const O = await open(others[0]);
    const foreignHosted = await request(O, 'room:host', { gameKey: 'scribble' });
    const foreignCode = foreignHosted.ok ? String(foreignHosted.data.code) : '';
    const crossMissing = await request(D, 'room:join', { code: foreignCode });
    check("another company's code reads as missing here", foreignCode.length === 5 && !crossMissing.ok && crossMissing.status === 404 && /No room with that code at your company/.test(crossMissing.message));
    dieSequence = [0.1, 0.2, 0.3, 0.4, 0.5];
    const otherHosted = await request(O, 'room:host', { gameKey: 'scribble' });
    const otherCode = otherHosted.ok ? String(otherHosted.data.code) : '';
    dieSequence = [0.1, 0.2, 0.3, 0.4, 0.5];
    const sameCodeHosted = await request(ninth, 'room:host', { gameKey: 'scribble' });
    const sameCode = sameCodeHosted.ok ? String(sameCodeHosted.data.code) : '';
    if (sameCodeHosted.ok) ninth.states.push({ room: sameCodeHosted.data as unknown as ScribbleView });
    check('two companies can hold the same code', otherCode.length === 5 && otherCode === sameCode, `${otherCode} / ${sameCode}`);
    const O2 = await open(others[1]);
    const crossJoin = await request(O2, 'room:join', { code: sameCode });
    check("a code only ever opens your own company's room", crossJoin.ok && (crossJoin.data.room as ScribbleView).hostId === others[0].userId);
    await waitFor('O sees O2', () => (room(O)?.players.length ?? 0) === 2);
    await wait(100);
    check('and nobody from the other company appears in it', (room(O)?.players ?? []).every((p) => p.userId.startsWith(OTHER)) && (room(ninth)?.players ?? []).length === 1);
    O.socket.close();
    O2.socket.close();
    await wait(300);
    await advanceClock(SCRIBBLE.lobbyIdleMs);
    check("the other company's room went when its lobby emptied; this company's with the same code is untouched", (await peekRoom(OTHER, otherCode)) === null && (await peekRoom(ORG, sameCode))?.hostId === players[2].userId);

    console.log('\nhosting and invite pushes across rooms');
    pushes.length = 0;
    await request(ninth, 'room:invite', { userId: D0.userId });
    await wait(50);
    check('a first invite from this person pushes', pushes.length === 1);
    const second = await request(ninth, 'room:host', { gameKey: 'scribble' });
    check('a second room in ten minutes is allowed', second.ok);
    await request(ninth, 'room:invite', { userId: D0.userId });
    await wait(50);
    check('inviting the same person from a new room pushes nothing: the claim is per pair, not per room', pushes.length === 1);
    const third = await request(ninth, 'room:host', { gameKey: 'scribble' });
    const fourth = await request(ninth, 'room:host', { gameKey: 'scribble' });
    check('a third room is allowed, a fourth in ten minutes is 429', third.ok && !fourth.ok && fourth.status === 429 && /enough new rooms/.test(fourth.message));
    check('and the refusal leaves them in the room they had', third.ok && (await peekRoom(ORG, String(third.data.code)))?.hostId === players[2].userId);

    console.log('\nengine');
    check('guess points: 300 at once, 50 at the buzzer, 175 half way', guessPoints(70_000) === 300 && guessPoints(0) === 50 && guessPoints(35_000) === 175);
    check('matching: case and punctuation ignored, whole word inside a phrase, one letter off is close', guessOutcome('Ice-Cream!', 'ice cream') === 'correct' && guessOutcome('a giraffe', 'giraffe') === 'correct' && guessOutcome('giraffes', 'giraffe') === 'close' && guessOutcome('cat', 'car') === 'wrong' && guessOutcome('', 'car') === 'empty');
    check('other scripts keep their letters and marks; punctuation alone is empty', normalizeGuess('हाथी!') === 'हाथी' && normalizeGuess('Café-au-Lait') === 'café au lait' && guessOutcome('हाथी', 'elephant') === 'wrong' && guessOutcome('?!', 'cat') === 'empty');
    check('hints: none before half time, one at half, two at three quarters for five letters, never over half', hintsWanted('kite', 0.49) === 0 && hintsWanted('kite', 0.5) === 1 && hintsWanted('kite', 0.8) === 1 && hintsWanted('rocket', 0.75) === 2 && hintsWanted('cat', 0.9) === 1);
    check('mask keeps spaces and shows hints', maskOf('ice cream', [0, 5]) === 'i__ _r___');
    check('ops: ranges hold', validateOp({ t: 'b', id: 1, k: 3, c: 1, w: 1, x: 1, y: 1 }) === null && validateOp({ t: 'p', id: 1, pts: [1, 2, 3] }) === null && validateOp({ t: 'p', id: 1, pts: [1000, 0] }) !== null && validateOp({ t: 'c' }) !== null);

    console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
  } catch (error) {
    console.error('\ncheck crashed:', error);
    failures += 1;
  } finally {
    for (const c of clients.values()) c.socket.close();
    closeScribbleRealtime();
    closeConnectRealtime();
    server?.close();
    try {
      await getDb().dropDatabase();
      console.log(`dropped scratch database "${env.mongoDbName}"\n`);
    } catch {
      /* already closed */
    }
    await closeRedis();
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  }
}
