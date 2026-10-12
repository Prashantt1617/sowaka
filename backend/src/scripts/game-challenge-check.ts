/**
 * Checks game challenges' rules: the same seed gives both players the same
 * boards, who wins, who may do what, how a challenge is cleared, one open
 * challenge at a time, the lobby that starts both rounds together, when a
 * challenge runs out, and what a result pays in engagement points under every cap.
 *
 * No database: the rules live in `services/game-challenge-rules.ts`, which is
 * pure, and the boards are the game page's own code, read out of
 * `game-pages/odd-one-out.html` and run here.
 * Run with `npx tsx src/scripts/game-challenge-check.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { GameChallenge } from '../models/game-challenge.model';
import type { PointEvent } from '../models/points.model';
import {
  DEFAULT_CHALLENGE_REWARDS,
  FINISH_GRACE_MS,
  LOBBY_PRESENCE_MS,
  MAX_OPEN_OUTGOING,
  MAX_PENDING_INCOMING,
  SEED_MAX,
  SEED_MIN,
  START_DELAY_MS,
  acceptMeans,
  bothReady,
  cappedReason,
  challengeMay,
  challengeRewardsOf,
  clearingFor,
  computeAwards,
  effectiveStatus,
  hiddenFor,
  inLobby,
  isOwnOpen,
  istDayStart,
  ledgerNote,
  lobbyArrivalLine,
  lobbyOpen,
  lobbyStateOf,
  mayChallenge,
  mayTakeAnother,
  playedLongEnough,
  mayOpenAnother,
  readyToggle,
  startAtFor,
  tellOtherOfArrival,
  newSeed,
  outcomeFor,
  parseChallengeScore,
  resultLine,
  resultOf,
  winBase,
  winPoints,
  type PaidToday,
} from '../services/game-challenge-rules';
import { groupActivity } from '../services/leaderboard';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const at = new Date('2026-10-10T10:00:00Z');
const hours = (h: number) => new Date(at.getTime() + h * 3600_000);

function challenge(overrides: Partial<GameChallenge> = {}): GameChallenge {
  return {
    id: 'c1', org: 'sowaka', gameKey: 'odd-one-out', seed: 4242,
    challengerUserId: 'u-kritik', challengerName: 'Kritik Bansal',
    opponentUserId: 'u-priya', opponentName: 'Priya Nair',
    status: 'accepted', scores: {}, live: {}, createdAt: at, updatedAt: at, expiresAt: hours(24),
    ...overrides,
  };
}
const scored = (k: number, p: number, overrides: Partial<GameChallenge> = {}) =>
  challenge({ scores: { 'u-kritik': { score: k, finishedAt: at }, 'u-priya': { score: p, finishedAt: at } }, ...overrides });
const nothingPaid = (): PaidToday => ({ wins: {}, participation: {}, winsOverOther: {} });

console.log('seed: the same boards for both players');
{
  const html = readFileSync(resolve(__dirname, '../../game-pages/odd-one-out.html'), 'utf8');
  const block = /\/\* seeded-boards:start[\s\S]*?\/\* seeded-boards:end \*\//.exec(html)?.[0];
  check('the page marks the code its boards depend on', Boolean(block));
  // The block alone, in a fresh context each time, with Math.random poisoned: a board must never depend on it.
  const sandbox = () => ({ Math: Object.create(Math, { random: { value: () => { throw new Error('Math.random used'); } } }) });
  const boards = (seed: number, count: number) =>
    runInNewContext(`${block}\nArray.from({ length: ${count} }, (_, g) => boardAt(${seed}, g));`, sandbox()) as {
      n: number; base: string; odd: string; flip: boolean; at: number;
    }[];
  const a = boards(4242, 40);
  const b = boards(4242, 40);
  check('one seed gives the same 40 boards twice over', JSON.stringify(a) === JSON.stringify(b));
  check('and never reads Math.random', a.length === 40);
  check('a different seed gives different boards', JSON.stringify(boards(4243, 40)) !== JSON.stringify(a));
  check('the boards grow as the round goes on', a[0].n === 2 && a[39].n === 6, `${a[0].n} .. ${a[39].n}`);
  check('every board has one odd tile on it', a.every((x) => x.at >= 0 && x.at < x.n * x.n));
  check('the odd tile differs from the rest (or is mirrored)', a.every((x) => x.flip || x.odd !== x.base));
  const edge = boards(SEED_MAX, 25);
  check('the largest seed the server issues still works', edge.length === 25 && edge.every((x) => x.at < x.n * x.n));
  const seeds = Array.from({ length: 500 }, newSeed);
  check('server seeds are whole numbers in the page\'s range', seeds.every((s) => Number.isInteger(s) && s >= SEED_MIN && s <= SEED_MAX));
  check('server seeds vary', new Set(seeds).size > 450);
}

console.log('winner and draw');
{
  check('nobody has won before both have played', resultOf(challenge({ scores: { 'u-kritik': { score: 10, finishedAt: at } } })) === null);
  check('the higher score wins', resultOf(scored(4320, 3980))?.winnerUserId === 'u-kritik');
  check('either side can win', resultOf(scored(100, 3980))?.winnerUserId === 'u-priya');
  check('a tie is a draw', resultOf(scored(4000, 4000))?.draw === true);
  check('each side reads its own outcome', outcomeFor(scored(4320, 3980), 'u-kritik') === 'won' && outcomeFor(scored(4320, 3980), 'u-priya') === 'lost');
  check('a draw reads as a draw to both', outcomeFor(scored(5, 5), 'u-kritik') === 'draw' && outcomeFor(scored(5, 5), 'u-priya') === 'draw');
  check('the result push, from the winner', resultLine(scored(4320, 3980), 'u-kritik') === 'You beat Priya 4,320 to 3,980', resultLine(scored(4320, 3980), 'u-kritik') ?? '');
  check('from the loser', resultLine(scored(4320, 3980), 'u-priya') === 'Kritik beat you 4,320 to 3,980');
  check('on a draw', resultLine(scored(4000, 4000), 'u-priya') === 'You and Kritik tied at 4,000');
  check('the ledger line', ledgerNote(scored(4320, 3980), 'u-kritik') === 'Beat Priya 4,320–3,980' &&
    ledgerNote(scored(4320, 3980), 'u-priya') === 'Played Kritik 3,980–4,320' && ledgerNote(scored(7, 7), 'u-kritik') === 'Tied with Priya at 7');
  check('scores: whole, non-negative, at most the game allows', parseChallengeScore(864.4, 80000) === 864 &&
    parseChallengeScore('15', 80000) === 15 && parseChallengeScore(-1, 80000) === null &&
    parseChallengeScore(80001, 80000) === null && parseChallengeScore('lots', 80000) === null && parseChallengeScore(null, 80000) === null);
}

console.log('who can be challenged');
{
  const me = { userId: 'u-kritik', org: 'sowaka', email: 'kritik@getsowaka.com' };
  check('a colleague at the same company', mayChallenge(me, { userId: 'u-priya', org: 'sowaka', lifecycleStatus: 'active' }).ok);
  const elsewhere = mayChallenge(me, { userId: 'u-x', org: 'convrse', lifecycleStatus: 'active' });
  check('not someone at another company, and they read as not found', !elsewhere.ok && elsewhere.status === 404);
  check('not yourself', !mayChallenge(me, { userId: 'u-kritik', org: 'sowaka' }).ok);
  check('not someone who has left', !mayChallenge(me, { userId: 'u-gone', org: 'sowaka', lifecycleStatus: 'offboarded' }).ok);
  check('not a counsellor', !mayChallenge(me, { userId: 'u-c', org: 'sowaka', isCounsellor: true }).ok);
  check('not someone who does not exist', !mayChallenge(me, null).ok);
  check('an old record without an org goes by its email domain', mayChallenge({ userId: 'a', email: 'a@acme.test' }, { userId: 'b', email: 'b@acme.test' }).ok
    && !mayChallenge({ userId: 'a', email: 'a@acme.test' }, { userId: 'b', email: 'b@other.test' }).ok);
  check('one open challenge per pair', !mayOpenAnother({ outgoing: 0, incomingForOpponent: 0, betweenThem: true }).ok);
  check(`at most ${MAX_OPEN_OUTGOING} open at once`, mayOpenAnother({ outgoing: MAX_OPEN_OUTGOING - 1, incomingForOpponent: 0, betweenThem: false }).ok
    && !mayOpenAnother({ outgoing: MAX_OPEN_OUTGOING, incomingForOpponent: 0, betweenThem: false }).ok);
  check(`nobody is sent more than ${MAX_PENDING_INCOMING} unanswered`, !mayOpenAnother({ outgoing: 0, incomingForOpponent: MAX_PENDING_INCOMING, betweenThem: false }).ok);
}

console.log('who may do what');
{
  const pending = challenge({ status: 'pending' });
  const accepted = challenge();
  const status = (d: ReturnType<typeof challengeMay>) => (d.ok ? 'ok' : String(d.status));
  for (const action of ['view', 'accept', 'decline', 'ready', 'live', 'finish'] as const) {
    check(`an outsider cannot ${action}, and it reads as not found`, status(challengeMay(action, 'u-outsider', accepted, at)) === '404'
      && status(challengeMay(action, 'u-outsider', pending, at)) === '404');
  }
  check('both players can see it', challengeMay('view', 'u-kritik', pending, at).ok && challengeMay('view', 'u-priya', pending, at).ok);
  check('only the one challenged answers it', challengeMay('accept', 'u-priya', pending, at).ok && challengeMay('decline', 'u-priya', pending, at).ok
    && status(challengeMay('accept', 'u-kritik', pending, at)) === '403');
  check('it is answered once', status(challengeMay('accept', 'u-priya', accepted, at)) === '409');
  check('nobody plays before it is accepted', status(challengeMay('live', 'u-kritik', pending, at)) === '409'
    && status(challengeMay('finish', 'u-priya', pending, at)) === '409');
  check('both play once it is', challengeMay('live', 'u-kritik', accepted, at).ok && challengeMay('finish', 'u-priya', accepted, at).ok);
  const half = challenge({ scores: { 'u-kritik': { score: 900, finishedAt: at } } });
  check('a final score is posted once', status(challengeMay('finish', 'u-kritik', half, at)) === '409'
    && status(challengeMay('live', 'u-kritik', half, at)) === '409' && challengeMay('finish', 'u-priya', half, at).ok);
  check('nothing is played on a finished, declined or expired one', ['finished', 'declined', 'expired'].every((s) =>
    !challengeMay('finish', 'u-priya', challenge({ status: s as GameChallenge['status'] }), at).ok));
}

console.log('clearing a challenge');
{
  const action = (d: ReturnType<typeof clearingFor>) => (d.ok ? d.action : String(d.status));
  const pending = challenge({ status: 'pending' });
  check('the one challenged declines it', action(clearingFor(pending, 'u-priya', at)) === 'decline');
  check('the challenger withdraws it', action(clearingFor(pending, 'u-kritik', at)) === 'withdraw');
  const accepted = challenge();
  check('once accepted, either calls it off while neither has played', action(clearingFor(accepted, 'u-kritik', at)) === 'call_off'
    && action(clearingFor(accepted, 'u-priya', at)) === 'call_off');
  const mid = challenge({ live: { 'u-kritik': { score: 300, at } }, started: { 'u-kritik': at } });
  check('a round under way with no final yet can still be called off', action(clearingFor(mid, 'u-priya', at)) === 'call_off');
  const half = challenge({ scores: { 'u-kritik': { score: 900, finishedAt: at } } });
  const mine = clearingFor(half, 'u-kritik', at);
  const theirs = clearingFor(half, 'u-priya', at);
  check('not once you have played: nobody dodges a loss', !mine.ok && mine.status === 409 && /already played/.test(mine.message));
  check('not once they have played, and it says who', !theirs.ok && theirs.status === 409 && theirs.message.startsWith('Kritik has already played'),
    theirs.ok ? '' : theirs.message);
  for (const status of ['finished', 'declined', 'expired'] as const) {
    check(`a ${status} one is cleared from your own list, by either`, action(clearingFor(challenge({ status }), 'u-kritik', at)) === 'hide'
      && action(clearingFor(challenge({ status }), 'u-priya', at)) === 'hide');
  }
  check('a pending one past its time is expired, so cleared', action(clearingFor(challenge({ status: 'pending', expiresAt: hours(1) }), 'u-kritik', hours(2))) === 'hide');
  check('an accepted one past its grace is expired, so cleared', action(clearingFor(challenge({ expiresAt: hours(1) }), 'u-priya', hours(2))) === 'hide');
  check('an outsider clears nothing, and it reads as not found', action(clearingFor(accepted, 'u-outsider', at)) === '404');
  check('cleared is per person', hiddenFor(challenge({ hiddenBy: ['u-priya'] }), 'u-priya') && !hiddenFor(challenge({ hiddenBy: ['u-priya'] }), 'u-kritik')
    && !hiddenFor(challenge(), 'u-priya'));
}

console.log('one open challenge at a time');
{
  const pending = challenge({ status: 'pending' });
  check('one you sent and is unanswered is yours', isOwnOpen(pending, 'u-kritik', at));
  check('one sent to you and unanswered is not: it can arrive and wait', !isOwnOpen(pending, 'u-priya', at));
  check('an accepted one you have not played is, for both', isOwnOpen(challenge(), 'u-kritik', at) && isOwnOpen(challenge(), 'u-priya', at));
  const half = challenge({ scores: { 'u-kritik': { score: 900, finishedAt: at } } });
  check('not once you have played it; still for the one who has not', !isOwnOpen(half, 'u-kritik', at) && isOwnOpen(half, 'u-priya', at));
  check('not a finished, declined or expired one', ['finished', 'declined', 'expired'].every((s) =>
    !isOwnOpen(challenge({ status: s as GameChallenge['status'] }), 'u-kritik', at)));
  check('not one past its time', !isOwnOpen(challenge({ status: 'pending', expiresAt: hours(1) }), 'u-kritik', hours(2)));
  check('nothing open: go ahead', mayTakeAnother(null).ok && mayTakeAnother(undefined).ok);
  const busy = mayTakeAnother({ challengeId: 'c9', withName: 'Raghav Menon' });
  check('one open: refused, naming who it is with', !busy.ok && busy.status === 409 && busy.message === 'Finish or clear your challenge with Raghav first',
    busy.ok ? '' : busy.message);
  check('and which challenge, for the page to open', !busy.ok && busy.details?.challengeId === 'c9' && busy.details?.reason === 'one_open');
  const send = mayOpenAnother({ outgoing: 1, incomingForOpponent: 0, betweenThem: false, own: { challengeId: 'c9', withName: 'Raghav Menon' } });
  check('sending another is refused the same way', !send.ok && send.status === 409 && send.details?.challengeId === 'c9');
  const pair = mayOpenAnother({ outgoing: 1, incomingForOpponent: 0, betweenThem: true, own: { challengeId: 'c9', withName: 'Raghav Menon' } });
  check('one already open with the same person says so first', !pair.ok && pair.message === 'You already have a challenge open with them');
  check('nothing open still sends', mayOpenAnother({ outgoing: 0, incomingForOpponent: 3, betweenThem: false, own: null }).ok);
}

console.log('the lobby: both rounds start together');
{
  const ago = (ms: number) => new Date(at.getTime() - ms);
  const status = (d: ReturnType<typeof challengeMay>) => (d.ok ? 'ok' : String(d.status));
  const lobby = (overrides: Partial<GameChallenge> = {}) => challenge({ acceptedAt: ago(600_000), ...overrides });
  check('open once accepted, before anyone has played', lobbyOpen(lobby(), at));
  check('not while pending', !lobbyOpen(lobby({ status: 'pending' }), at));
  check('not once either has played', !lobbyOpen(lobby({ scores: { 'u-priya': { score: 10, finishedAt: at } } }), at));
  check('not once started', !lobbyOpen(lobby({ startAt: at }), at));
  check('not past its deadline, even in the finish grace', !lobbyOpen(lobby({ expiresAt: ago(1000) }), at)
    && effectiveStatus(lobby({ expiresAt: ago(1000) }), at) === 'accepted');
  check('a heartbeat keeps you there for a minute', inLobby(lobby({ seen: { 'u-kritik': ago(LOBBY_PRESENCE_MS - 1000) } }), 'u-kritik', at)
    && !inLobby(lobby({ seen: { 'u-kritik': ago(LOBBY_PRESENCE_MS) } }), 'u-kritik', at) && !inLobby(lobby(), 'u-kritik', at));
  const states = lobby({ seen: { 'u-kritik': ago(5000), 'u-priya': ago(5000) }, ready: { 'u-kritik': ago(3000) } });
  check('each in the lobby is joined or ready', lobbyStateOf(states, 'u-kritik', at) === 'ready' && lobbyStateOf(states, 'u-priya', at) === 'joined');
  const left = lobby({ seen: { 'u-kritik': ago(LOBBY_PRESENCE_MS + 1) }, ready: { 'u-kritik': ago(LOBBY_PRESENCE_MS + 1) } });
  check('a ready only counts while you are there', lobbyStateOf(left, 'u-kritik', at) === 'away');
  check('ready says ready; again takes it back', readyToggle(states, 'u-priya', at) === 'ready' && readyToggle(states, 'u-kritik', at) === 'unready');
  check('a ready left from before you went away counts for nothing: tapping says ready', readyToggle(left, 'u-kritik', at) === 'ready');
  const both = lobby({ seen: { 'u-kritik': ago(5000), 'u-priya': ago(1000) }, ready: { 'u-kritik': ago(4000), 'u-priya': ago(1000) } });
  check('both there and ready: start', bothReady(both, at));
  check('not while one is only joined', !bothReady(states, at));
  check('not when the other ready has gone stale', !bothReady(lobby({ seen: { 'u-kritik': ago(LOBBY_PRESENCE_MS + 1), 'u-priya': ago(1000) },
    ready: both.ready }), at));
  check('not twice: once started the lobby is closed', !bothReady({ ...both, startAt: at }, at));
  check(`the start is ${START_DELAY_MS / 1000} s ahead`, startAtFor(at).getTime() - at.getTime() === START_DELAY_MS && START_DELAY_MS === 4000);
  check('accepting answers a pending one, and says ready on an accepted one', acceptMeans(lobby({ status: 'pending' }), at) === 'answer'
    && acceptMeans(lobby(), at) === 'ready' && acceptMeans(lobby({ status: 'declined' }), at) === 'answer');
  check('an accepted one past its grace is answered, so refused as expired', acceptMeans(lobby({ expiresAt: hours(-1) }), at) === 'answer'
    && status(challengeMay('accept', 'u-priya', lobby({ expiresAt: hours(-1) }), at)) === '410');
  check('either player says ready', challengeMay('ready', 'u-kritik', lobby(), at).ok && challengeMay('ready', 'u-priya', lobby(), at).ok);
  check('not before it is accepted', status(challengeMay('ready', 'u-priya', lobby({ status: 'pending' }), at)) === '409');
  const played = lobby({ scores: { 'u-kritik': { score: 900, finishedAt: at } } });
  check('not once you have played', status(challengeMay('ready', 'u-kritik', played, at)) === '409');
  const theyPlayed = challengeMay('ready', 'u-priya', played, at);
  check('not once they have played: nobody to start with', !theyPlayed.ok && theyPlayed.status === 409 && theyPlayed.message.startsWith('Kritik has already played'));
  check('not once started', status(challengeMay('ready', 'u-priya', lobby({ startAt: at }), at)) === '409');
  check('not past the deadline', status(challengeMay('ready', 'u-priya', lobby({ expiresAt: ago(1000) }), at)) === '409');
  check('not on an expired one', status(challengeMay('ready', 'u-priya', lobby({ expiresAt: hours(-1) }), at)) === '410');
  check('not on a finished or declined one', status(challengeMay('ready', 'u-priya', lobby({ status: 'finished' }), at)) === '409'
    && status(challengeMay('ready', 'u-priya', lobby({ status: 'declined' }), at)) === '409');
  check('the other is told the first time you come in', tellOtherOfArrival(lobby(), 'u-kritik', at));
  check('not when they are there to see it', !tellOtherOfArrival(lobby({ seen: { 'u-priya': ago(2000) } }), 'u-kritik', at));
  check('and only once', !tellOtherOfArrival(lobby({ lobbyPushed: { 'u-kritik': ago(9_000_000) } }), 'u-kritik', at));
  check('the push', lobbyArrivalLine(lobby(), 'u-kritik', 'Odd One Out') === 'Kritik is waiting in the Odd One Out lobby'
    && lobbyArrivalLine(lobby(), 'u-priya', 'Odd One Out') === 'Priya is waiting in the Odd One Out lobby');
  // The page's first live score, at the start, is when its round began: the finish rule still measures from it.
  const synced = lobby({ startAt: at, started: { 'u-kritik': at, 'u-priya': new Date(at.getTime() + 150) } });
  check('a synced round still has to be played out', !playedLongEnough(synced, 'u-priya', DEFAULT_CHALLENGE_REWARDS, new Date(at.getTime() + 20_000)).ok
    && playedLongEnough(synced, 'u-priya', DEFAULT_CHALLENGE_REWARDS, new Date(at.getTime() + 45_500)).ok);
}

console.log('expiry');
{
  const pending = challenge({ status: 'pending', expiresAt: hours(24) });
  check('pending until its time', effectiveStatus(pending, hours(23.9)) === 'pending');
  check('expired from its time, before the sweep writes it', effectiveStatus(pending, hours(24)) === 'expired');
  check('an expired one cannot be accepted', !challengeMay('accept', 'u-priya', pending, hours(25)).ok
    && (challengeMay('accept', 'u-priya', pending, hours(25)) as { status: number }).status === 410);
  const accepted = challenge({ expiresAt: hours(24) });
  const grace = new Date(hours(24).getTime() + FINISH_GRACE_MS - 1000);
  check('a round started at the deadline still finishes', effectiveStatus(accepted, grace) === 'accepted' && challengeMay('finish', 'u-priya', accepted, grace).ok);
  check('after the grace it is expired', effectiveStatus(accepted, new Date(hours(24).getTime() + FINISH_GRACE_MS)) === 'expired');
  const halfPlayed = challenge({ expiresAt: hours(24), scores: { 'u-kritik': { score: 9000, finishedAt: at } } });
  check('one player alone never wins: it expires with no result', effectiveStatus(halfPlayed, hours(30)) === 'expired' && resultOf(halfPlayed) === null);
  check('a finished one never expires', effectiveStatus(scored(1, 2, { status: 'finished', expiresAt: hours(1) }), hours(100)) === 'finished');
  check('a declined one stays declined', effectiveStatus(challenge({ status: 'declined', expiresAt: hours(1) }), hours(100)) === 'declined');
}

console.log('reward rules');
{
  check('the defaults', JSON.stringify(challengeRewardsOf(undefined)) === JSON.stringify(DEFAULT_CHALLENGE_REWARDS)
    && DEFAULT_CHALLENGE_REWARDS.perPoints === 100 && DEFAULT_CHALLENGE_REWARDS.maxPerMatch === 25 && DEFAULT_CHALLENGE_REWARDS.dailyWinCap === 3
    && DEFAULT_CHALLENGE_REWARDS.samePairPerDay === 3 && DEFAULT_CHALLENGE_REWARDS.minLoserShare === 0.25
    && DEFAULT_CHALLENGE_REWARDS.participation === 2 && DEFAULT_CHALLENGE_REWARDS.expiryHours === 24);
  const tuned = challengeRewardsOf({ perPoints: 1000, dailyWinCap: '5', maxPerMatch: -3, minLoserShare: 2, participation: 1.5, junk: 9 });
  check('a game sets its own; anything unusable falls back to the default', tuned.perPoints === 1000 && tuned.dailyWinCap === 5
    && tuned.maxPerMatch === 25 && tuned.minLoserShare === 0.25 && tuned.participation === 2 && !('junk' in tuned));
  check('an IST day starts at 18:30 UTC', istDayStart(new Date('2026-10-10T18:29:00Z')).toISOString() === '2026-10-09T18:30:00.000Z'
    && istDayStart(new Date('2026-10-10T18:30:00Z')).toISOString() === '2026-10-10T18:30:00.000Z');
}

console.log('what a result pays');
{
  const R = DEFAULT_CHALLENGE_REWARDS;
  const pay = (k: number, p: number, paid = nothingPaid(), rules = R) => computeAwards(scored(k, p), rules, paid)!;
  const winner = (k: number, p: number, paid?: PaidToday, rules = R) => pay(k, p, paid, rules).reward!;

  check('nothing before both have played', computeAwards(challenge(), R, nothingPaid()) === null);
  check('base: both scores', winBase(864, 796, R).base === 1660 && !winBase(864, 796, R).onlyOwnScore);
  check('scaled by perPoints: 1,660 / 100 rounds to 17', winner(864, 796).points === 17, String(winner(864, 796).points));
  check('capped at maxPerMatch', winner(40000, 30000).points === 25);
  check('at least 1 for any win', winner(30, 0).points === 1 && winPoints(0, R) === 1);
  const thrown = winner(1600, 399);
  check('a loser under a quarter of the winner adds nothing (anti-tanking)', thrown.onlyOwnScore === true && thrown.base === 1600 && thrown.points === 16,
    `base ${thrown.base}, ${thrown.points}`);
  const fair = winner(1600, 400);
  check('exactly a quarter still counts', fair.onlyOwnScore === false && fair.base === 2000 && fair.points === 20);
  const both = pay(864, 796).awards;
  check('the loser earns participation', both.find((a) => a.userId === 'u-priya')?.points === 2
    && both.find((a) => a.userId === 'u-priya')?.kind === 'participation');
  check('the win is the reward on the challenge', pay(864, 796).reward?.userId === 'u-kritik' && pay(864, 796).reward?.kind === 'win');
  const draw = pay(800, 800);
  check('a draw: no reward, each gets participation', draw.reward === null && draw.awards.length === 2
    && draw.awards.every((a) => a.kind === 'participation' && a.points === 2));

  // Daily cap: the first `dailyWinCap` rewarded wins of the day pay.
  const third = winner(864, 796, { wins: { 'u-kritik': 2 }, participation: {}, winsOverOther: {} });
  check('the third rewarded win of the day still pays', third.points === 17 && third.capped === null);
  const fourth = winner(864, 796, { wins: { 'u-kritik': 3 }, participation: {}, winsOverOther: {} });
  check('the fourth pays nothing: daily limit', fourth.points === 0 && fourth.capped === 'daily_limit');
  check('and says why', cappedReason(fourth, 'Priya') === 'Daily limit reached');
  check('the opponent\'s wins do not count against the winner', winner(864, 796, { wins: { 'u-priya': 3 }, participation: {}, winsOverOther: {} }).points === 17);

  // Same pair: one rewarded win per winner per opponent per day.
  const again = winner(864, 796, { wins: { 'u-kritik': 1 }, participation: {}, winsOverOther: { 'u-kritik': 1 } }, { ...R, samePairPerDay: 1 });
  check('a second win over the same person today pays nothing', again.points === 0 && again.capped === 'same_pair');
  check('and says why', cappedReason(again, 'Priya') === 'Already rewarded for a win over Priya today');
  check('the loser beating them back still pays', winner(796, 864, { wins: {}, participation: {}, winsOverOther: { 'u-kritik': 1 } }, { ...R, samePairPerDay: 1 }).points === 17);
  check('by default a second win over the same person pays too', winner(864, 796, { wins: { 'u-kritik': 1 }, participation: {}, winsOverOther: { 'u-kritik': 1 } }).points === 17);
  check('samePairPerDay is a setting', winner(864, 796, { wins: { 'u-kritik': 1 }, participation: {}, winsOverOther: { 'u-kritik': 1 } },
    { ...R, samePairPerDay: 2 }).points === 17);

  // Participation has its own count, capped at the same number.
  const tired = pay(864, 796, { wins: {}, participation: { 'u-priya': 3 }, winsOverOther: {} }).awards.find((a) => a.userId === 'u-priya')!;
  check('participation stops after dailyWinCap awards a day', tired.points === 0 && tired.capped === 'daily_limit');
  const drawCapped = pay(10, 10, { wins: {}, participation: { 'u-kritik': 3, 'u-priya': 2 }, winsOverOther: {} }).awards;
  check('on a draw each is capped on their own count', drawCapped.find((a) => a.userId === 'u-kritik')!.points === 0
    && drawCapped.find((a) => a.userId === 'u-priya')!.points === 2);
  check('wins do not use up participation', pay(864, 796, { wins: { 'u-priya': 3 }, participation: {}, winsOverOther: {} })
    .awards.find((a) => a.userId === 'u-priya')!.points === 2);
  check('participation 0 pays nothing and is not a cap', pay(864, 796, nothingPaid(), { ...R, participation: 0 })
    .awards.find((a) => a.userId === 'u-priya')!.capped === null);
  check('dailyWinCap 0 turns paid wins off', winner(864, 796, nothingPaid(), { ...R, dailyWinCap: 0 }).capped === 'daily_limit');
  check('every award is a whole, non-negative number', [pay(1, 2), pay(79999, 1), pay(3, 3)].every((p) =>
    p.awards.every((a) => Number.isInteger(a.points) && a.points >= 0)));
}

console.log('the Rank tab activity');
{
  const event = (partial: Partial<PointEvent>): PointEvent => ({
    id: Math.random().toString(), userId: 'u-kritik', org: 'sowaka', delta: 17, source: 'game_challenge', reason: 'game',
    refId: 'c1', note: 'Beat Priya 864–796', gameKey: 'odd-one-out', title: 'Odd One Out', createdAt: at, ...partial,
  });
  const rows = groupActivity([event({}), event({ refId: 'c2', delta: 2, note: 'Played Neha 900–1,200', createdAt: hours(1) })]);
  check('one row per challenge', rows.length === 2);
  check('titled by the game, detailed by the match', rows[1].title === 'Odd One Out' && rows[1].detail === 'Game · Beat Priya 864–796', `${rows[1].title} / ${rows[1].detail}`);
  check('carries the game, for its picture', rows[0].gameKey === 'odd-one-out' && rows[0].points === 2);
  check('a row without a title still reads', groupActivity([event({ title: undefined })])[0].title === 'Game challenge');
}

{
  // A final can only follow a round really played.
  const R = DEFAULT_CHALLENGE_REWARDS;
  const accepted = new Date('2026-10-10T06:00:00.000Z');
  const at = (seconds: number) => new Date(accepted.getTime() + seconds * 1000);
  const c = { createdAt: accepted, acceptedAt: accepted, started: { 'u-kritik': at(60) } };
  check('a minimum round by default', R.minPlaySeconds === 30);
  check('a final a second into the round is refused', !playedLongEnough(c, 'u-kritik', R, at(61)).ok);
  check('a final after a whole round counts', playedLongEnough(c, 'u-kritik', R, at(108)).ok);
  check('with no live score, measured from the accept', !playedLongEnough(c, 'u-priya', R, at(5)).ok && playedLongEnough(c, 'u-priya', R, at(50)).ok);
  check('a game can drop the minimum', playedLongEnough(c, 'u-kritik', { minPlaySeconds: 0 }, at(60)).ok);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
