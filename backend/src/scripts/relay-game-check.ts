/**
 * Plays a whole relay game with many people at once, the way the app does.
 *
 * The socket server is built exactly as server.ts builds it — Connect's server
 * with the relay namespace on top, at /connect/socket — and every client
 * connects to /relay on that path, as the phone does. An earlier check built
 * its own server and connected to the namespace directly, which is how the app
 * shipped pointing at the wrong channel with every check still passing.
 *
 * Three teams of five play all five rounds on a fast clock:
 *   A — the lead answers everything correctly
 *   B — the lead gets one wrong first, and skips some
 *   C — the lead never turns up, so a teammate has to take over
 *
 * Runs against a scratch database and drops it afterwards:
 *   MONGODB_DB=relay_check npm run relay:game
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import {
  authSessions,
  closeDb,
  connectDb,
  getDb,
  relayEvents,
  relayItems,
  relayProgress,
  relayTeams,
  users,
} from '../config/db';
import { env } from '../config/env';
import { hashSessionToken } from '../services/auth.service';
import { closeConnectRealtime, initConnectRealtime } from '../services/connect-realtime.service';
import { closeRelayRealtime, initRelayRealtime } from '../services/relay-realtime.service';
import { publishRelayGame } from '../services/relay-publish.service';
import { RELAY_DEFAULT_CONFIG, RelayItem, RelayItemKind, RelayTeam } from '../models/relay.model';
import { User } from '../models/user.model';
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

const ORG = 'gameorg';
const PORT = 4312;
const eventId = randomUUID();
const now = new Date();

// A fast clock: six-second questions and a three-second break, so five full
// rounds play in a couple of minutes rather than twenty.
const config = {
  ...RELAY_DEFAULT_CONFIG,
  questionSeconds: 6,
  hintIntervalSeconds: 1,
  breakSeconds: 3,
  presenceWindowSeconds: 8,
  leadGraceSeconds: 6,
};

interface Player {
  userId: string;
  name: string;
  team: 'A' | 'B' | 'C';
  isLeader: boolean;
  token: string;
  socket?: ClientSocket;
  states: PlayerSnapshot[];
  errors: string[];
  results: { correct: boolean; skipped?: boolean }[];
}

const players: Player[] = [];
for (const team of ['A', 'B', 'C'] as const) {
  for (let i = 0; i < 5; i += 1) {
    players.push({
      userId: `${team}${i}`,
      name: `${team} Player ${i}`,
      team,
      isLeader: i === 0,
      token: `tok-${team}${i}-${randomUUID()}`,
      states: [],
      errors: [],
      results: [],
    });
  }
}

const kinds: RelayItemKind[] = ['movie', 'word', 'number', 'lyric', 'odd'];
/** Answers keyed by prompt text, so a scripted lead can "know" them. */
const answerKey = new Map<string, string>();

function items(): RelayItem[] {
  const out: RelayItem[] = [];
  kinds.forEach((kind, r) => {
    for (let n = 0; n < 12; n += 1) {
      const answer = `ANSWER${r + 1}X${n}`;
      const prompt = `Round ${r + 1} question ${n}`;
      answerKey.set(prompt, answer);
      out.push({
        id: `${r + 1}-${n}`,
        eventId,
        org: ORG,
        round: r + 1,
        kind,
        reveal: kind === 'movie' ? 'staggered' : 'simultaneous',
        matching: kind === 'movie' || kind === 'lyric' ? 'fuzzy' : 'exact',
        prompt,
        acceptedAnswers: [answer],
        pieces: Array.from({ length: 5 }, (_, i) => ({ label: `Piece ${i + 1}`, text: `secret-${r}-${n}-${i}` })),
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return out;
}

const latest = (p: Player) => p.states.at(-1);

function open(p: Player) {
  return new Promise<void>((resolve, reject) => {
    // The same address and path the app uses.
    const socket = connect(`http://localhost:${PORT}/relay`, {
      path: '/connect/socket',
      transports: ['websocket'],
      auth: { token: p.token },
      reconnection: false,
    });
    socket.on('relay:state', (s: PlayerSnapshot) => p.states.push(s));
    socket.on('relay:error', (e: { message: string }) => p.errors.push(e.message));
    socket.on('relay:result', (r: { correct: boolean; skipped?: boolean }) => p.results.push(r));
    socket.on('connect', () => {
      p.socket = socket;
      resolve();
    });
    socket.on('connect_error', reject);
  });
}

async function main() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"\n`);

  const admin = { userId: 'admin', name: 'Admin', email: 'admin@game.local', employeeId: 'ADM', org: ORG, lifecycleStatus: 'active', dashboardAccess: true } as unknown as User;
  await users().insertMany([
    admin,
    ...players.map((p) => ({ userId: p.userId, name: p.name, email: `${p.userId}@game.local`, employeeId: p.userId, org: ORG, lifecycleStatus: 'active' }) as unknown as User),
  ]);
  await authSessions().insertMany(
    players.map((p) => ({ tokenHash: hashSessionToken(p.token), userId: p.userId, createdAt: now, expiresAt: new Date(Date.now() + 3_600_000) })),
  );
  await relayEvents().insertOne({
    id: eventId, org: ORG, name: 'Game check', status: 'draft', config,
    currentRound: 0, createdBy: 'admin', createdAt: now, updatedAt: now,
  });
  const teams: RelayTeam[] = (['A', 'B', 'C'] as const).map((t, index) => ({
    id: `team-${t}`, eventId, org: ORG, index, teamKey: t, name: `${t} TEAM`,
    leaderUserId: `${t}0`,
    members: players.filter((p) => p.team === t).map((p) => ({ userId: p.userId, name: p.name, email: `${p.userId}@game.local`, isLeader: p.isLeader })),
    createdAt: now, updatedAt: now,
  }));
  await relayTeams().insertMany(teams);
  await relayItems().insertMany(items());

  // Wired as server.ts wires it.
  const http = createServer();
  const io = initConnectRealtime(http);
  initRelayRealtime(io);
  await new Promise<void>((resolve) => http.listen(PORT, resolve));

  console.log('publishing, with HR setting the numbers');
  // Long enough for fourteen handshakes against the remote cluster to finish
  // before the start, so the lobby can actually be seen.
  const startsAt = new Date(Date.now() + 20_000);
  await publishRelayGame('admin', eventId, {
    title: 'Hint Relay', startsAt: startsAt.toISOString(), pointsPerCorrect: 30, rewardAmount: 10000,
  });

  console.log('\neveryone joins except team C\'s lead');
  const joining = players.filter((p) => !(p.team === 'C' && p.isLeader));
  await Promise.all(joining.map(open));
  check('14 players connected over the app\'s own address', joining.every((p) => p.socket?.connected));
  await wait(2500);

  console.log('\nlobby');
  const lobbyViews = joining.map(latest);
  check('every player received the lobby', lobbyViews.every((s) => s?.phase === 'lobby'), `${lobbyViews.filter(Boolean).length}/14`);
  check('the countdown is counting to the start', lobbyViews.every((s) => (s?.secondsUntilStart ?? 0) > 0));
  check('HR\'s points reached the phones', lobbyViews.every((s) => s?.pointsPerCorrect === 30));
  check('HR\'s reward reached the phones', lobbyViews.every((s) => s?.rewardAmount === 10000));
  check(
    'each player sees exactly their own row as theirs',
    joining.every((p) => latest(p)?.teammates.filter((t) => t.isYou).length === 1 && latest(p)?.teammates.find((t) => t.isYou)?.name === p.name),
  );

  console.log('\nthe game starts itself');
  await wait(Math.max(0, startsAt.getTime() - Date.now()));
  const zero = Date.now();
  while (Date.now() - zero < 15_000 && !joining.every((p) => latest(p)?.phase === 'playing')) await wait(200);
  const lag = ((Date.now() - zero) / 1000).toFixed(1);
  const notPlaying = joining.filter((p) => !(latest(p)?.phase === 'playing' && latest(p)?.event.round === 1));
  check(
    'everyone is playing round 1 soon after the countdown ends',
    notPlaying.length === 0,
    notPlaying.length ? notPlaying.map((p) => `${p.userId}:${latest(p)?.phase}`).join(' ') : `${lag}s after zero`,
  );
  check(
    'nobody lost time to the delay — the round clock starts when play does',
    joining.every((p) => (latest(p)?.roundSecondsLeft ?? 0) >= config.questionsPerRound * config.questionSeconds - 3),
  );

  const leadA = players.find((p) => p.team === 'A' && p.isLeader)!;
  const leadB = players.find((p) => p.team === 'B' && p.isLeader)!;
  const memberA = players.find((p) => p.team === 'A' && !p.isLeader)!;

  // A member trying to answer is refused.
  memberA.socket!.emit('relay:answer', { text: 'anything' });
  await wait(1200);
  check('a member cannot answer', memberA.errors.some((e) => /leader/i.test(e)));

  // Play the rounds: A answers correctly at once; B gets the first one wrong,
  // then skips every second question; C has no lead of its own.
  let bWrongDone = false;
  const seen = new Set<string>();
  const deadline = Date.now() + 5 * ((config.questionsPerRound * config.questionSeconds + config.breakSeconds) * 1000) + 30_000;
  while (Date.now() < deadline) {
    const a = latest(leadA);
    const b = latest(leadB);
    if (a?.phase === 'finished') break;
    if (a?.phase === 'playing' && a.prompt) {
      const key = `A${a.event.round}-${a.questionNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        leadA.socket!.emit('relay:typing');
        leadA.socket!.emit('relay:answer', { text: answerKey.get(a.prompt) ?? '' });
      }
    }
    if (b?.phase === 'playing' && b.prompt) {
      const key = `B${b.event.round}-${b.questionNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!bWrongDone) {
          bWrongDone = true;
          leadB.socket!.emit('relay:answer', { text: 'totally wrong' });
          await wait(300);
          seen.delete(key);
        } else if (b.questionNumber % 2 === 0) {
          leadB.socket!.emit('relay:skip');
        } else {
          leadB.socket!.emit('relay:answer', { text: answerKey.get(b.prompt) ?? '' });
        }
      }
    }
    await wait(250);
  }

  console.log('\nthe game ran to the end');
  const finals = joining.map(latest);
  check('every player reached the final screen', finals.every((s) => s?.phase === 'finished'), `${finals.filter((s) => s?.phase === 'finished').length}/14`);
  check('all five rounds were played', Math.max(...leadA.states.map((s) => s.event.round)) === 5);

  console.log('\nwhat was on every screen, across the whole game');
  const everyState = players.flatMap((p) => p.states.map((s) => ({ p, s })));
  check(
    'no clue ever reached a lead',
    everyState.filter(({ p, s }) => s.isLeader && p.isLeader).every(({ s }) => s.pieces.length === 0),
  );
  const holders = new Map<string, Set<string>>();
  for (const { p, s } of everyState) {
    for (const piece of s.pieces) holders.set(piece.text, (holders.get(piece.text) ?? new Set()).add(p.team));
  }
  check('no clue ever crossed to another team', [...holders.values()].every((teamsHolding) => teamsHolding.size === 1));
  check(
    'members were dealt clues',
    everyState.some(({ p, s }) => !p.isLeader && s.pieces.length > 0),
  );
  check('the lead\'s typing reached their team', everyState.some(({ p, s }) => p.team === 'A' && !p.isLeader && s.leadIsAnswering));

  console.log('\nanswers and scoring');
  check('a correct answer was accepted', leadA.results.some((r) => r.correct));
  check('a wrong answer was refused', leadB.results.some((r) => !r.correct && !r.skipped));
  check('a skip went through', leadB.results.some((r) => r.skipped));

  const progress = await relayProgress().find({ eventId }).toArray();
  const pts = (t: string) => progress.find((p) => p.teamId === `team-${t}`)?.totalPoints ?? -1;
  const correctA = progress.find((p) => p.teamId === 'team-A')?.answers.filter((x) => x.outcome === 'correct').length ?? 0;
  check('points are counted at HR\'s rate', pts('A') >= correctA * 30 && correctA > 0, `${correctA} correct, ${pts('A')} points`);
  check('team A beat team B', pts('A') > pts('B'), `${pts('A')} vs ${pts('B')}`);

  console.log('\na team whose lead never came');
  const cMembers = players.filter((p) => p.team === 'C' && !p.isLeader);
  check('someone on team C was made lead', cMembers.some((p) => p.states.some((s) => s.isLeader)));
  check('team C still reached the end', cMembers.every((p) => latest(p)?.phase === 'finished'));

  console.log('\nthe final table');
  const table = latest(leadA)!.standings;
  check('all three teams are ranked', table.length === 3, table.map((r) => `${r.rank}. ${r.name} ${r.points}`).join(' · '));
  check('the winner is on top', table[0]?.name === 'A TEAM');
  check('each player is told their own rank', joining.every((p) => (latest(p)?.yourRank ?? 0) >= 1));

  console.log('\nnothing went wrong along the way');
  const unexpected = players.flatMap((p) => p.errors.filter((e) => !/leader/i.test(e)));
  check('no player saw an unexpected error', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
  check('every socket is still connected', joining.every((p) => p.socket?.connected));

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(async () => {
    players.forEach((p) => p.socket?.close());
    closeRelayRealtime();
    closeConnectRealtime();
    await wait(1500);
    await getDb().dropDatabase();
    console.log(`dropped scratch database "${env.mongoDbName}"\n`);
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  });
