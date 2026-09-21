/**
 * Plays a full round through the live runtime, against a throwaway database.
 *
 * Run with a scratch database name so nothing lands in live collections:
 *   MONGODB_DB=relay_check npm run relay:runtime
 * The script refuses to run against anything that is not clearly scratch, and
 * drops what it created on the way out.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, getDb, relayEvents, relayItems, relayProgress, relayTeams, users } from '../config/db';
import { env } from '../config/env';
import { RELAY_DEFAULT_CONFIG, RelayItem, RelayTeam } from '../models/relay.model';
import { User } from '../models/user.model';
import { leaderboard, skipQuestion, snapshot, startEvent, submitAnswer, heartbeat } from '../services/relay-runtime.service';

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
  await skipQuestion('u0');
  check('a skip moves on', (await snapshot('u0')).questionNumber === 4);
  await submitAnswer('u0', 'CLOUD');

  const after = await relayProgress().findOne({ eventId, teamId: team.id });
  check('three correct scored 30', after?.totalPoints === 30, `${after?.totalPoints} points`);
  check('a skip forfeited the bonus', (after?.bonusRounds ?? []).length === 0);
  check('four answers recorded', after?.answers.length === 4);
  check('the round is over for this team', (await snapshot('u0')).phase === 'break');

  const table = await leaderboard(eventId);
  check('leaderboard has the team', table[0]?.name === 'Player 0 TEAM' && table[0].points === 30);

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
