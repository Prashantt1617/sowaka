/**
 * Checks the Games home's rules: the week's start, which contests are live
 * and in what order, who is next up, places moved, and which colleague's
 * best is news.
 *
 * No database: the rules live in `services/games-home-rules.ts`, which is
 * pure. Run with `npx tsx src/scripts/games-home-check.ts`.
 */
import {
  contestIsLive,
  initialsOf,
  istWeekStart,
  movementSince,
  nextUpFor,
  orderLiveContests,
  passedSince,
  playedRecently,
  pointsBefore,
} from '../services/games-home-rules';
import { rankByPoints } from '../services/leaderboard';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('the week');
// Saturday 10 Oct 2026, 16:30 IST.
const saturday = new Date('2026-10-10T11:00:00.000Z');
check('starts on Monday 00:00 IST', istWeekStart(saturday).toISOString() === '2026-10-04T18:30:00.000Z', istWeekStart(saturday).toISOString());
// Monday 00:10 IST is the new week; Sunday 23:50 IST is still the old one.
check('a minute past midnight Monday IST is the new week', istWeekStart(new Date('2026-10-11T18:40:00.000Z')).toISOString() === '2026-10-11T18:30:00.000Z');
check('Sunday night IST is still last week', istWeekStart(new Date('2026-10-11T18:20:00.000Z')).toISOString() === '2026-10-04T18:30:00.000Z');

console.log('live contests');
const now = new Date('2026-10-10T11:00:00.000Z');
const posted = new Date('2026-10-09T07:00:00.000Z');
check('closing later today is live', contestIsLive('2026-10-10T18:00:00.000Z', posted, now).live);
check('already closed is not', !contestIsLive('2026-10-10T07:45:03.403Z', posted, now).live);
check('no closing time, posted yesterday, is live', contestIsLive('', posted, now).live);
check('no closing time, posted a month ago, is not', !contestIsLive('', new Date('2026-09-01T00:00:00.000Z'), now).live);
check('free-text closing time reads as none', contestIsLive('Closes Friday, 5 pm', posted, now).closesAt === null);
const ordered = orderLiveContests([
  { id: 'open-old', closesAt: null, publishedAt: new Date('2026-10-01T00:00:00Z') },
  { id: 'late', closesAt: new Date('2026-10-12T00:00:00Z'), publishedAt: posted },
  { id: 'open-new', closesAt: null, publishedAt: new Date('2026-10-09T00:00:00Z') },
  { id: 'soon', closesAt: new Date('2026-10-10T12:00:00Z'), publishedAt: posted },
]);
check('closing soonest first, then open-ended newest first', ordered.map((row) => row.id).join(',') === 'soon,late,open-new,open-old', ordered.map((row) => row.id).join(','));

console.log('next up');
const board = rankByPoints([
  { userId: 'shiv', name: 'Shiv', points: 980 },
  { userId: 'ananya', name: 'Ananya Bisht', points: 860 },
  { userId: 'karan', name: 'Karan', points: 860 },
  { userId: 'tanvi', name: 'Tanvi', points: 790 },
  { userId: 'zero', name: 'Zero' },
]);
const tanvi = nextUpFor(board, 'tanvi');
check('the closest score above, to pass by one', tanvi?.gap === 71 && tanvi?.rank === 2, JSON.stringify(tanvi));
check('tied people are passed together, named by the board order', tanvi?.userId === 'ananya');
check('the leader has nobody to chase', nextUpFor(board, 'shiv') === null);
check('zero chases the last scorer', nextUpFor(board, 'zero')?.userId === 'tanvi' && nextUpFor(board, 'zero')?.gap === 791);
check('someone not on the board has nobody', nextUpFor(board, 'ghost') === null);

console.log('movement');
const before = rankByPoints([
  { userId: 'shiv', name: 'Shiv', points: 980 },
  { userId: 'ananya', name: 'Ananya Bisht', points: 700 },
  { userId: 'karan', name: 'Karan', points: 860 },
  { userId: 'tanvi', name: 'Tanvi', points: 790 },
  { userId: 'zero', name: 'Zero' },
]);
const moved = movementSince(board, before, 5);
check('a climb is positive', moved.get('ananya') === 2, String(moved.get('ananya')));
check('being overtaken is negative', moved.get('tanvi') === -1, String(moved.get('tanvi')));
check('still on nothing has not moved', moved.get('zero') === 0);
check('the balance before this week is never below zero', pointsBefore(10, 25) === 0 && pointsBefore(100, 25) === 75 && pointsBefore(undefined, undefined) === 0);

console.log('a colleague’s new best');
const mine = { userId: 'me', score: 1100, achievedAt: new Date('2026-10-09T10:00:00Z') };
check('better, after mine, today: news', passedSince(mine, { userId: 'yami', score: 1250, achievedAt: new Date('2026-10-10T09:00:00Z') }, true, now));
check('better but set before mine: no news', !passedSince(mine, { userId: 'yami', score: 1250, achievedAt: new Date('2026-10-09T09:00:00Z') }, true, now));
check('not better: no news', !passedSince(mine, { userId: 'yami', score: 1100, achievedAt: new Date('2026-10-10T09:00:00Z') }, true, now));
check('three days ago: no longer news', !passedSince({ ...mine, achievedAt: new Date('2026-10-01T00:00:00Z') }, { userId: 'yami', score: 1250, achievedAt: new Date('2026-10-07T09:00:00Z') }, true, now));
check('lower is better for a timed game', passedSince(mine, { userId: 'yami', score: 900, achievedAt: new Date('2026-10-10T09:00:00Z') }, false, now));
check('never their own', !passedSince(mine, { userId: 'me', score: 2000, achievedAt: new Date('2026-10-10T09:00:00Z') }, true, now));

console.log('playing now');
check('five minutes ago counts', playedRecently(new Date(now.getTime() - 5 * 60_000), now));
check('twenty minutes ago does not', !playedRecently(new Date(now.getTime() - 20 * 60_000), now));
check('nothing does not', !playedRecently(undefined, now));
check('initials', initialsOf('Ananya Bisht') === 'AB' && initialsOf('Raghav') === 'R' && initialsOf('  ') === '?');

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
