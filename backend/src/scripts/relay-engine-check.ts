/**
 * Plays a round against the engine and checks the rules hold.
 *
 * No database and no sockets: the engine is pure, so the whole game can be
 * exercised before either exists. Run with `npm run relay:check`.
 */
import { RELAY_DEFAULT_CONFIG, RelayAnswerRecord, RelayItem } from '../models/relay.model';
import {
  answerAccepted,
  assignments,
  currentLeader,
  piecesForPlayer,
  questionPhase,
  roundPhase,
  roundSeconds,
  scoreRound,
  standings,
} from '../services/relay-engine';
import { PresentPlayer } from '../services/relay-engine';

const config = RELAY_DEFAULT_CONFIG;
const now = Date.now();
let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function player(id: string, isLeader = false, secondsSilent = 0): PresentPlayer {
  return {
    userId: id,
    name: id,
    email: `${id}@convrse.ai`,
    isLeader,
    lastSeenAt: new Date(now - secondsSilent * 1000),
  };
}

function item(overrides: Partial<RelayItem>): RelayItem {
  return {
    id: 'i1',
    eventId: 'e1',
    org: 'convrse',
    round: 1,
    kind: 'movie',
    reveal: 'staggered',
    matching: 'fuzzy',
    prompt: 'Name the movie',
    acceptedAnswers: ['Kuch Kuch Hota Hai'],
    pieces: Array.from({ length: 5 }, (_, i) => ({ label: `Clue ${i + 1}`, text: `clue ${i + 1}` })),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const team = [player('lead', true), player('a'), player('b'), player('c'), player('d')];

console.log('\nstaggered reveal — a clue every 3s, never to the leader');
const movie = item({});
for (const elapsed of [0, 3, 6, 12]) {
  const dealt = assignments(movie, team, config, elapsed, now);
  const holders = dealt.map((d) => d.userId).join(',');
  check(`t+${elapsed}s deals ${dealt.length}`, dealt.length === Math.floor(elapsed / 3) + 1, holders);
}
check(
  'leader is dealt nothing',
  piecesForPlayer(movie, team, config, 60, now, 'lead').length === 0,
);
check(
  'a member sees only their own',
  piecesForPlayer(movie, team, config, 60, now, 'a').length === 2,
  'clues 1 and 5 with four members',
);

console.log('\nsimultaneous reveal — one piece each, all at once');
const word = item({ kind: 'word', reveal: 'simultaneous', matching: 'exact', acceptedAnswers: ['THINK'],
  pieces: ['K', 'N', 'T', 'H', 'I'].map((t, i) => ({ label: `Letter ${i + 1}`, text: t })) });
check('all five out at t+0', assignments(word, team, config, 0, now).length === 5);
check('nobody holds the whole word', piecesForPlayer(word, team, config, 0, now, 'a').length < 5);

console.log('\npresence — a phone that went quiet stops being dealt to');
const halfAway = [player('lead', true), player('a'), player('b', false, 30), player('c', false, 45)];
const dealtNow = assignments(movie, halfAway, config, 12, now);
check('only present members hold pieces', dealtNow.every((d) => d.userId === 'a'), 'b and c are silent');
check('the team can still play', dealtNow.length === 5);

console.log('\nleader — the role moves rather than freezing the team');
const silentLead = [player('lead', true, 40), player('a'), player('b')];
check('appointed leader keeps it while present', currentLeader(team, config, now)?.userId === 'lead');
check('silent leader hands over', currentLeader(silentLead, config, now)?.userId === 'a');
check('nobody present, nobody leads', currentLeader([player('lead', true, 90)], config, now) === null);

console.log('\nmatching — exact where a letter matters, loose where spelling does not');
check('SHEET is refused for SHEEP', !answerAccepted('SHEET', item({ kind: 'word', matching: 'exact', acceptedAnswers: ['SHEEP'] }), config));
check('STORE is refused for STONE', !answerAccepted('STORE', item({ kind: 'word', matching: 'exact', acceptedAnswers: ['STONE'] }), config));
check('think matches THINK', answerAccepted('think', word, config));
check('dekhuga matches dekhunga', answerAccepted('dekhuga', item({ acceptedAnswers: ['dekhunga'] }), config));
check('kuch kuch hota he matches the title', answerAccepted('kuch kuch hota he', movie, config));
check('a wrong title is refused', !answerAccepted('Jab We Met', movie, config));
check('a second accepted spelling works', answerAccepted('Bombay', item({ acceptedAnswers: ['Mumbai', 'Bombay'] }), config));

console.log('\nclocks');
const q = questionPhase(config, new Date(now - 10_000), now);
check('10s into a 30s question', q.phase === 'running' && q.secondsLeft === 20, `${q.secondsLeft}s left`);
check('expires at 30s', questionPhase(config, new Date(now - 31_000), now).phase === 'expired');
const r = roundPhase(config, new Date(now - 100_000), now);
check('100s into a 120s round', r.phase === 'playing' && r.secondsLeft === 20);
const br = roundPhase(config, new Date(now - 130_000), now);
const breakLeft = roundSeconds(config) + config.breakSeconds - 130;
check(
  'after the round everyone is on the leaderboard',
  br.phase === 'break' && br.secondsLeft === breakLeft,
  `${br.secondsLeft}s until the next round`,
);

console.log('\nskipping buys time for the next question');
const fresh = questionPhase(config, new Date(now - 5_000), now);
check('a question on its own gets 30s', fresh.allowance === 30, `${fresh.secondsLeft}s left after 5s`);
const carried = questionPhase(config, new Date(now - 5_000), now, 20);
check('20s carried makes the next one 50s', carried.allowance === 50, `${carried.secondsLeft}s left after 5s`);
check('and it does not expire at 30s', carried.phase === 'running');
const spent = questionPhase(config, new Date(now - 52_000), now, 20);
check('it still expires once the carried time is gone', spent.phase === 'expired');

console.log('\nscoring');
const answer = (outcome: RelayAnswerRecord['outcome'], secondsTaken: number, position: number): RelayAnswerRecord =>
  ({ round: 1, position, outcome, secondsTaken, points: outcome === 'correct' ? config.pointsPerCorrect : 0 });
const sweep = scoreRound([answer('correct', 17, 1), answer('correct', 22, 2), answer('correct', 28, 3), answer('correct', 33, 4)], config);
const expectedBase = 4 * config.pointsPerCorrect;
check(
  'four right in 100s is four answers plus the spare seconds',
  sweep.basePoints === expectedBase && sweep.bonusPoints === 20,
  `${sweep.basePoints} + ${sweep.bonusPoints}`,
);
const skipped = scoreRound([answer('correct', 10, 1), answer('correct', 10, 2), answer('correct', 10, 3), answer('skipped', 5, 4)], config);
check(
  'a skip forfeits the bonus',
  skipped.bonusPoints === 0 && skipped.totalPoints === 3 * config.pointsPerCorrect,
);
const timedOut = scoreRound([answer('correct', 10, 1), answer('correct', 10, 2), answer('correct', 10, 3), answer('timeout', 30, 4)], config);
check('a timeout forfeits it too', timedOut.bonusPoints === 0);
const abandoned = scoreRound([answer('timeout', 30, 1), answer('timeout', 30, 2), answer('timeout', 30, 3), answer('timeout', 30, 4)], config);
check('a team that left scores nothing but stays in step', abandoned.totalPoints === 0 && abandoned.secondsUsed === 120);

console.log('\ntie-break — level on points, fewest seconds wins');
const table = standings([
  { teamId: 't1', name: 'Rohan TEAM', points: 180, secondsUsed: 400 },
  { teamId: 't2', name: 'Aditi TEAM', points: 180, secondsUsed: 355 },
  { teamId: 't3', name: 'Priya TEAM', points: 200, secondsUsed: 460 },
]);
check('most points leads', table[0].teamId === 't3');
check('the quicker of the level pair is second', table[1].teamId === 't2', `${table[1].name} at ${table[1].secondsUsed}s`);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
