/**
 * Checks the leaderboard's ranking and the credit history's grouping.
 *
 * No database: the rules live in `services/leaderboard.ts`, which is pure.
 * Run with `npx tsx src/scripts/leaderboard-check.ts`.
 */
import type { PointEvent } from '../models/points.model';
import {
  groupActivity,
  monthBounds,
  monthKey,
  placesMoved,
  podiumOf,
  rankByPoints,
} from '../services/leaderboard';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('ranking');
const ranked = rankByPoints([
  { userId: 'k', name: 'Karan', points: 790 },
  { userId: 'm', name: 'Mannya', points: 980 },
  { userId: 's', name: 'Shivani', points: 860 },
  { userId: 'a', name: 'Arjun', points: 860 },
  { userId: 'n', name: 'Nobody' },
  { userId: 'z', name: 'Zero', points: 0 },
  { userId: 'x', name: 'Broken', points: Number.NaN },
]);
check('highest first', ranked[0].userId === 'm');
check('ties share a rank', ranked[1].rank === 2 && ranked[2].rank === 2);
check('ties listed by name', ranked[1].name === 'Arjun' && ranked[2].name === 'Shivani');
check('the next score skips the tied places', ranked[3].userId === 'k' && ranked[3].rank === 4);
check(
  'missing and broken balances read as zero, tied last',
  ranked.slice(4).every((entry) => entry.points === 0 && entry.rank === 5),
  ranked.slice(4).map((entry) => `${entry.name}:${entry.rank}`).join(' '),
);
check('fractions and negatives are floored to whole points', rankByPoints([
  { userId: 'f', name: 'F', points: 10.9 },
  { userId: 'g', name: 'G', points: -5 },
]).map((entry) => entry.points).join(',') === '10,0');

console.log('podium');
const podium = podiumOf(ranked);
check('three on the podium', podium.length === 3);
check('nobody stands on it for zero', podiumOf(rankByPoints([
  { userId: 'a', name: 'A', points: 10 },
  { userId: 'b', name: 'B' },
])).length === 1);
check('an org that has not played has an empty podium', podiumOf(rankByPoints([
  { userId: 'a', name: 'A' },
  { userId: 'b', name: 'B' },
])).length === 0);

console.log('movement');
const people = [
  { userId: 'a', name: 'A', points: 100 },
  { userId: 'b', name: 'B', points: 90 },
  { userId: 'c', name: 'C', points: 80 },
];
check('climbing past two people is +2', placesMoved(
  [...people.slice(0, 2), { userId: 'c', name: 'C', points: 120 }], new Map([['c', 50]]), 'c',
) === 2);
check('being overtaken is -1', placesMoved(people, new Map([['a', 20]]), 'b') === -1);
check('nothing earned is 0', placesMoved(people, new Map(), 'b') === 0);

console.log('activity');
const at = (day: number) => new Date(Date.UTC(2026, 9, day, 10));
const event = (
  partial: Partial<PointEvent> & Pick<PointEvent, 'delta' | 'reason' | 'source'>,
  day: number,
): PointEvent => ({ id: `${day}-${Math.random()}`, userId: 'me', org: 'o', createdAt: at(day), ...partial });
const activity = groupActivity([
  event({ delta: 10, reason: 'vote_received', source: 'caption_challenge', refId: 'p1' }, 3),
  event({ delta: 10, reason: 'vote_received', source: 'caption_challenge', refId: 'p1' }, 4),
  event({ delta: -10, reason: 'vote_withdrawn', source: 'caption_challenge', refId: 'p1' }, 5),
  event({ delta: 10, reason: 'vote_received', source: 'caption_challenge', refId: 'p1' }, 6),
  event({ delta: 10, reason: 'tagged', source: 'most_likely', refId: 'p2' }, 7),
  event({ delta: 10, reason: 'vote_received', source: 'photo_story_challenge', refId: 'p3' }, 2),
  event({ delta: -10, reason: 'entry_removed', source: 'photo_story_challenge', refId: 'p3' }, 8),
  event({ delta: 40, reason: 'game', source: 'hint_relay', refId: 'g1', note: '5 rounds completed' }, 9),
]);
check('one row per challenge, nothing for one that netted zero', activity.length === 3,
  activity.map((row) => row.title).join(', '));
check('newest first', activity[0].title === 'Hint Relay');
check('a game keeps its own line', activity[0].detail === 'Game · 5 rounds completed', activity[0].detail);
const caption = activity.find((row) => row.source === 'caption_challenge');
check('votes are counted net of those taken back', caption?.detail === 'Community challenge · 2 votes received',
  caption?.detail);
check('points are the net', caption?.points === 20);
check('a mention is a mention', activity.find((row) => row.source === 'most_likely')?.detail ===
  'Social challenge · 1 mention');

console.log('months');
check('a month has bounds, in India time', monthBounds('2026-12')?.start.toISOString() === '2026-11-30T18:30:00.000Z'
  && monthBounds('2026-12')?.end.toISOString() === '2026-12-31T18:30:00.000Z');
check('1 Nov 02:00 India time is November', monthKey(new Date('2026-10-31T20:30:00.000Z')) === '2026-11');
check('a bad month has none', monthBounds('2026-13') === null && monthBounds('soon') === null);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
