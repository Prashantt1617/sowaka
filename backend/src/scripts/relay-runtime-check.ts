/**
 * Plays a full round through the live runtime, against a throwaway database.
 *
 * Run with a scratch database name so nothing lands in live collections:
 *   MONGODB_DB=relay_check npm run relay:runtime
 * The script refuses to run against anything that is not clearly scratch, and
 * drops what it created on the way out.
 */
import { randomUUID } from 'node:crypto';
import {
  closeDb,
  connectDb,
  connectPosts,
  getDb,
  relayEvents,
  relayItems,
  relayProgress,
  relayTeams,
  users,
} from '../config/db';
import { env } from '../config/env';
import { RELAY_DEFAULT_CONFIG, RelayItem, RelayTeam } from '../models/relay.model';
import { publishRelayGame } from '../services/relay-publish.service';
import { User } from '../models/user.model';
import {
  heartbeat,
  leaderboard,
  skipQuestion,
  snapshot,
  startDueEvents,
  startEvent,
  submitAnswer,
} from '../services/relay-runtime.service';

if (!/check|scratch|test/i.test(env.mongoDbName)) {
  console.error(
    `Refusing to run against database "${env.mongoDbName}".\n` +
      'Re-run with a scratch database, e.g. MONGODB_DB=relay_check npm run relay:runtime',
  );
  process.exit(1);
}

let failures = 0;
const check = (label: string, passed: boolean, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const ORG = 'checkorg';
const eventId = randomUUID();
const now = new Date();

function member(index: number): User {
  return {
    userId: `u${index}`,
    name: `Player ${index}`,
    email: `p${index}@check.local`,
    employeeId: `CK${index}`,
    org: ORG,
    lifecycleStatus: 'active',
  } as User;
}

function item(round: number, position: number, answer: string, exact: boolean): RelayItem {
  return {
    id: `${round}-${position}`,
    eventId,
    org: ORG,
    round,
    kind: exact ? 'word' : 'movie',
    reveal: exact ? 'simultaneous' : 'staggered',
    matching: exact ? 'exact' : 'fuzzy',
    prompt: exact ? 'Form the word' : 'Name the movie',
    acceptedAnswers: [answer],
    pieces: Array.from({ length: 5 }, (_, i) => ({ label: `Piece ${i + 1}`, text: `${answer}-${i}` })),
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"\n`);

  const players = [0, 1, 2, 3, 4].map(member);
  await users().insertMany(players);
  await relayEvents().insertOne({
    id: eventId,
    org: ORG,
    name: 'Check event',
    status: 'draft',
    // One round is enough to exercise every rule; the rest is the same loop.
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
  await relayItems().insertMany([
    item(1, 1, 'Kuch Kuch Hota Hai', false),
    item(1, 2, 'THINK', true),
    item(1, 3, 'Jab We Met', false),
    item(1, 4, 'CLOUD', true),
  ]);

  console.log('starting');
  const started = await startEvent(eventId);
  check('event goes live with the team seeded', started.teams === 1);

  await Promise.all(players.map((p) => heartbeat(p.userId)));

  console.log('\nwhat each screen shows');
  const leaderView = await snapshot('u0');
  const memberView = await snapshot('u1');
  check('leader is told they lead', leaderView.isLeader);
  check('leader gets no pieces', leaderView.pieces.length === 0);
  check('member is not the leader', !memberView.isLeader);
  check('member holds a piece', memberView.pieces.length > 0, `${memberView.pieces.length} piece(s)`);
  check('both see the same question', leaderView.questionNumber === memberView.questionNumber);
  check('team is present', leaderView.teammates.filter((t) => t.present).length === 5);
  check(
    'each player sees exactly their own row marked as them',
    leaderView.teammates.filter((t) => t.isYou).length === 1 &&
      memberView.teammates.find((t) => t.isYou)?.name === 'Player 1',
  );
  check(
    'the points line comes from the event',
    leaderView.pointsPerCorrect === RELAY_DEFAULT_CONFIG.pointsPerCorrect,
  );

  console.log('\nanswering');
  const wrong = await submitAnswer('u0', 'Dhoom');
  check('a wrong answer does not advance', !wrong.correct && (await snapshot('u0')).questionNumber === 1);
  const fuzzy = await submitAnswer('u0', 'kuch kuch hota he');
  check('a near-miss title is accepted', fuzzy.correct === true);
  check('the next question opens', (await snapshot('u0')).questionNumber === 2);

  let refused = false;
  try {
    await submitAnswer('u1', 'THINK');
  } catch {
    refused = true;
  }
  check('a member cannot answer', refused);

  const near = await submitAnswer('u0', 'THINL');
  check('one letter wrong is refused on an exact item', !near.correct);
  check('the exact word is accepted', (await submitAnswer('u0', 'think')).correct === true);

  console.log('\nskipping and finishing the round');
  const beforeSkip = await snapshot('u0');
  const skipped = await skipQuestion('u0', 3);
  check('a skip moves on', (await snapshot('u0')).questionNumber === 4);
  // The double tap: a second skip still aimed at question 3.
  let staleRefused = false;
  try {
    await skipQuestion('u0', 3);
  } catch {
    staleRefused = true;
  }
  check('a second tap on the same skip is refused', staleRefused);
  check('and does not skip the next question', (await snapshot('u0')).questionNumber === 4);
  check(
    'the seconds left on it are handed forward',
    (skipped.carriedSeconds ?? 0) > 20,
    `${skipped.carriedSeconds}s carried from a question barely touched`,
  );
  const afterSkip = await snapshot('u0');
  check(
    'so the next question starts with more than 30s',
    afterSkip.questionSecondsLeft > 30,
    `${afterSkip.questionSecondsLeft}s on the question, was ${beforeSkip.questionSecondsLeft}s`,
  );
  await submitAnswer('u0', 'CLOUD');

  const after = await relayProgress().findOne({ eventId, teamId: team.id });
  const expected = 3 * RELAY_DEFAULT_CONFIG.pointsPerCorrect;
  check(
    'three correct are scored at the configured rate',
    after?.totalPoints === expected,
    `${after?.totalPoints} points, expected ${expected}`,
  );
  check('a skip forfeited the bonus', (after?.bonusRounds ?? []).length === 0);
  check('four answers recorded', after?.answers.length === 4);
  const done = await snapshot('u0');
  check('the round is over for this team', done.phase === 'break');
  // The screen shows one clock for the whole round; the 30s cap governs
  // underneath it and is what a skip hands forward.
  const mid = await snapshot('u1');
  check(
    'the round clock is what players are shown',
    mid.roundSecondsLeft > 0 && mid.roundSecondsLeft <= 120,
    `${mid.roundSecondsLeft}s of the round left`,
  );

  const table = await leaderboard(eventId);
  check(
    'leaderboard has the team',
    table[0]?.name === 'Player 0 TEAM' && table[0].points === expected,
  );

  console.log('\nstarting itself when the moment arrives');
  const dueId = randomUUID();
  await relayEvents().insertOne({
    id: dueId, org: ORG, name: 'Due event', status: 'scheduled',
    config: { ...RELAY_DEFAULT_CONFIG, rounds: 1 }, currentRound: 0,
    startsAt: new Date(Date.now() - 5_000),
    createdBy: 'u0', createdAt: now, updatedAt: now,
  });
  // Mongo stamps an _id on insert, so the due event gets its own team rather
  // than a copy of one already stored.
  await relayTeams().insertOne({
    ...team,
    _id: undefined as never,
    id: randomUUID(),
    eventId: dueId,
  });
  await relayItems().insertMany([1, 2, 3, 4].map((p) => ({ ...item(1, p, `A${p}`, false), id: `d${p}`, eventId: dueId })));
  const autoStarted = await startDueEvents();
  const dueAfter = await relayEvents().findOne({ id: dueId });
  check('a scheduled event whose time has come starts itself', autoStarted.includes(dueId));
  check('and is live on round one', dueAfter?.status === 'live' && dueAfter.currentRound === 1);
  check('a second pass does not start it twice', (await startDueEvents()).length === 0);

  console.log('\npublishing to Connect');
  const pubId = randomUUID();
  await relayEvents().insertOne({
    id: pubId, org: ORG, name: 'To publish', status: 'draft',
    config: { ...RELAY_DEFAULT_CONFIG, rounds: 1 }, currentRound: 0,
    createdBy: 'u0', createdAt: now, updatedAt: now,
  });
  let refusedEmpty = false;
  try {
    await publishRelayGame('u0', pubId, { startsAt: new Date(Date.now() + 600_000).toISOString() });
  } catch {
    refusedEmpty = true;
  }
  check('refuses to publish a game with no teams', refusedEmpty);

  await relayTeams().insertOne({ ...team, _id: undefined as never, id: randomUUID(), eventId: pubId });
  await relayItems().insertMany([1, 2, 3, 4].map((p) => ({ ...item(1, p, `P${p}`, false), id: `p${p}`, eventId: pubId })));

  let refusedPast = false;
  try {
    await publishRelayGame('u0', pubId, {
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      pointsPerCorrect: 30,
      rewardAmount: 10000,
    });
  } catch {
    refusedPast = true;
  }
  check('refuses a start time already gone', refusedPast);

  const startsAt = new Date(Date.now() + 600_000);
  let refusedUnpriced = false;
  try {
    await publishRelayGame('u0', pubId, { startsAt: startsAt.toISOString() });
  } catch {
    refusedUnpriced = true;
  }
  check('refuses to publish without HR setting points and reward', refusedUnpriced);
  const published = await publishRelayGame('u0', pubId, {
    title: 'Launch Relay', subtitle: 'Five rounds, one team', startsAt: startsAt.toISOString(),
    pointsPerCorrect: 25, rewardAmount: 10000,
  });
  const pubEvent = await relayEvents().findOne({ id: pubId });
  const post = await connectPosts().findOne({ 'body.eventId': pubId });
  check('the event is scheduled for that moment', pubEvent?.status === 'scheduled' && !!pubEvent.startsAt);
  check('a post lands on Connect', post?.type === 'relay_game');
  check('the post carries the game and its shape', (post?.body as Record<string, unknown>)?.roundCount === 1);
  check('round count comes from the sheet, not typed in', published.rounds.length === 1);
  check('the post names the action', (post?.body as Record<string, unknown>)?.actionLabel === 'View game');
  check(
    'points and reward are what HR entered',
    pubEvent?.config.pointsPerCorrect === 25 && pubEvent?.rewardAmount === 10000 &&
      (post?.body as Record<string, unknown>)?.rewardAmount === 10000,
  );

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(async () => {
    // Everything this script made lives in the scratch database, which goes now.
    await getDb().dropDatabase();
    console.log(`dropped scratch database "${env.mongoDbName}"\n`);
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  });
