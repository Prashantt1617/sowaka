/**
 * Drives the relay socket namespace with real clients, end to end.
 *
 * Proves over the wire what the whole design rests on: a piece of a puzzle
 * reaches exactly one device and never the leader's. Runs against a scratch
 * database and drops it afterwards:
 *   MONGODB_DB=relay_check npm run relay:sockets
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketServer } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import {
  authSessions,
  closeDb,
  connectDb,
  getDb,
  relayEvents,
  relayItems,
  relayTeams,
  users,
} from '../config/db';
import { env } from '../config/env';
import { hashSessionToken } from '../services/auth.service';
import { RELAY_DEFAULT_CONFIG, RelayItem, RelayTeam } from '../models/relay.model';
import { User } from '../models/user.model';
import { initRelayRealtime, closeRelayRealtime } from '../services/relay-realtime.service';
import { startEvent } from '../services/relay-runtime.service';
import type { PlayerSnapshot } from '../services/relay-runtime.service';

if (!/check|scratch|test/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}". Use MONGODB_DB=relay_check.`);
  process.exit(1);
}

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a condition rather than a guessed delay, and reports how long it took. */
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return Date.now() - started;
    await wait(100);
  }
  console.log(`    [timeout] ${label} after ${timeoutMs}ms`);
  return -1;
}

const ORG = 'checkorg';
const eventId = randomUUID();
const now = new Date();
const PORT = 4311;

/** Keyed by player: index-based lookup silently shifted when a handshake failed. */
const clients = new Map<string, ClientSocket>();
const received = new Map<string, PlayerSnapshot[]>();

function seedUser(index: number): User {
  return {
    userId: `u${index}`,
    name: `Player ${index}`,
    email: `p${index}@check.local`,
    employeeId: `CK${index}`,
    org: ORG,
    lifecycleStatus: 'active',
  } as User;
}

function seedItem(position: number): RelayItem {
  return {
    id: `1-${position}`,
    eventId,
    org: ORG,
    round: 1,
    kind: 'movie',
    reveal: 'staggered',
    matching: 'fuzzy',
    prompt: 'Name the movie',
    acceptedAnswers: [`Answer ${position}`],
    pieces: Array.from({ length: 5 }, (_, i) => ({ label: `Clue ${i + 1}`, text: `secret-${position}-${i}` })),
    createdAt: now,
    updatedAt: now,
  };
}

function openClient(userId: string, token: string) {
  return new Promise<ClientSocket>((resolve, reject) => {
    const socket = connect(`http://localhost:${PORT}/relay`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    received.set(userId, []);
    socket.on('relay:state', (state: PlayerSnapshot) => received.get(userId)?.push(state));
    socket.on('relay:error', (e: { message: string }) => console.log(`    [${userId} error] ${e.message}`));
    socket.on('relay:result', (r: unknown) => console.log(`    [${userId} result] ${JSON.stringify(r)}`));
    socket.on('connect', () => {
      clients.set(userId, socket);
      resolve(socket);
    });
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });
}

const latest = (userId: string) => received.get(userId)?.at(-1);

async function main() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"\n`);

  const players = [0, 1, 2, 3].map(seedUser);
  await users().insertMany(players);
  const tokens = new Map<string, string>();
  await authSessions().insertMany(
    players.map((player) => {
      const token = `tok-${player.userId}-${randomUUID()}`;
      tokens.set(player.userId, token);
      return {
        tokenHash: hashSessionToken(token),
        userId: player.userId,
        createdAt: now,
        expiresAt: new Date(Date.now() + 3_600_000),
      };
    }),
  );

  await relayEvents().insertOne({
    id: eventId,
    org: ORG,
    name: 'Socket check',
    status: 'draft',
    config: { ...RELAY_DEFAULT_CONFIG, rounds: 1 },
    currentRound: 0,
    createdBy: 'u0',
    createdAt: now,
    updatedAt: now,
  });
  const team: RelayTeam = {
    id: randomUUID(),
    eventId,
    org: ORG,
    index: 0,
    teamKey: '1',
    name: 'Player 0 TEAM',
    leaderUserId: 'u0',
    members: players.map((p, i) => ({ userId: p.userId, name: p.name, email: p.email, isLeader: i === 0 })),
    createdAt: now,
    updatedAt: now,
  };
  await relayTeams().insertOne(team);
  await relayItems().insertMany([1, 2, 3, 4].map(seedItem));

  const http = createServer();
  const io = new SocketServer(http, { transports: ['websocket'] });
  initRelayRealtime(io);
  await new Promise<void>((resolve) => http.listen(PORT, resolve));

  console.log('handshake');
  let rejected = false;
  try {
    await openClient('bad', 'not-a-real-token');
  } catch {
    rejected = true;
  }
  check('an invalid token is refused', rejected);

  for (const player of players) await openClient(player.userId, tokens.get(player.userId)!);
  check('four players connected', [...clients.values()].filter((c) => c.connected).length === 4);

  await startEvent(eventId);
  clients.forEach((socket) => socket.emit('relay:heartbeat'));
  // long enough for every clue in the staggered item to have fired
  await wait(14_000);

  console.log('\nwhat arrived on each socket');
  const leader = latest('u0');
  check('leader received state', Boolean(leader));
  check('leader is told they lead', leader?.isLeader === true);
  check('LEADER RECEIVED NO PIECES', (leader?.pieces.length ?? -1) === 0);

  const memberPieces = ['u1', 'u2', 'u3'].map((id) => latest(id)?.pieces.length ?? 0);
  check('every member holds pieces', memberPieces.every((count) => count > 0), memberPieces.join(' / '));
  check('all five clues were dealt', memberPieces.reduce((a, b) => a + b, 0) === 5);

  const everything = ['u0', 'u1', 'u2', 'u3'].flatMap((id) =>
    (received.get(id) ?? []).flatMap((state) => state.pieces.map((piece) => `${id}:${piece.text}`)),
  );
  const leakedToLeader = everything.filter((entry) => entry.startsWith('u0:'));
  check('no clue ever reached the leader across every message', leakedToLeader.length === 0);
  const perPiece = new Map<string, Set<string>>();
  for (const entry of everything) {
    const [who, text] = entry.split(':');
    perPiece.set(text, (perPiece.get(text) ?? new Set()).add(who));
  }
  check(
    'each clue went to exactly one person',
    [...perPiece.values()].every((holders) => holders.size === 1),
  );

  console.log('\nplaying over the socket');
  const before = latest('u0')?.questionNumber ?? 0;
  clients.get('u1')!.emit('relay:answer', { text: 'Answer 1' });
  await wait(3000);
  check('a member answering is refused', (latest('u0')?.questionNumber ?? 0) === before);

  clients.get('u0')!.emit('relay:answer', { text: 'Answer 1' });
  const answerMs = await waitFor('answer', () => (latest('u0')?.questionNumber ?? 0) === before + 1);
  check('the leader answering advances the team', answerMs >= 0, `${answerMs}ms to reach the leader`);
  const memberMs = await waitFor('member push', () => latest('u2')?.questionNumber === before + 1);
  check('members were pushed the new question too', memberMs >= 0, `${memberMs}ms`);

  clients.get('u0')!.emit('relay:skip');
  const skipMs = await waitFor('skip', () => (latest('u0')?.questionNumber ?? 0) === before + 2);
  check('a skip advances over the socket', skipMs >= 0, `${skipMs}ms`);

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(async () => {
    clients.forEach((socket) => socket.close());
    closeRelayRealtime();
    await getDb().dropDatabase();
    console.log(`dropped scratch database "${env.mongoDbName}"\n`);
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  });
