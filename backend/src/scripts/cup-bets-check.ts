/**
 * Checks the Diwali Cup's bets: the rules on their own (no database), then
 * placing and settling for real, in one transaction each, against scratch
 * collections (`cup_test_bets`, `cup_test_users`, `cup_test_point_events`)
 * that are dropped at the end. Nothing else is written; no index is made.
 *
 *   npx tsx src/scripts/cup-bets-check.ts          (rules only)
 *   npx tsx src/scripts/cup-bets-check.ts --db     (and the database part)
 */
import { MongoClient } from 'mongodb';
import { env } from '../config/env';
import type { CupMatch } from '../models/cup.model';
import type { PointEvent } from '../models/points.model';
import type { User } from '../models/user.model';
import { CupError } from '../services/cup.service';
import {
  betIdOf,
  betVerdict,
  bookOf,
  deltasByUser,
  ledgerRowFor,
  mineOf,
  movesFor,
  splitOf,
  tipstersOf,
  type CupBetRow,
} from '../services/cup-bets-rules';
import { placeBetOn, settleMatchBets, type BetStores } from '../services/cup-bets.service';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

const now = new Date('2026-10-30T12:00:00Z');
const later = (s: number) => new Date(now.getTime() + s * 1000);

function matchOf(partial: Partial<CupMatch> = {}): CupMatch {
  return {
    id: 'm-qf1',
    eventId: 'cup-test',
    org: 'sowaka',
    round: 5,
    slot: 0,
    label: 'QF1',
    kind: 'sequential',
    players: ['pa', 'pb'],
    status: 'betting',
    seed: 1,
    attempt: 0,
    bettingAt: now,
    bettingEndsAt: later(60),
    joined: {},
    live: {},
    finals: {},
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function betOf(userId: string, pick: string, stake: number, partial: Partial<CupBetRow> = {}): CupBetRow {
  const book = partial.book ?? 0;
  return {
    _id: betIdOf('m-qf1', book, userId),
    book,
    eventId: 'cup-test',
    org: 'sowaka',
    matchId: 'm-qf1',
    userId,
    name: `Name ${userId}`,
    pick,
    stake,
    status: 'held',
    payout: 0,
    placedAt: now,
    ...partial,
  };
}

// ---------------------------------------------------------------- the rules

console.log('Who may bet');
{
  const m = matchOf();
  check('a colleague backs a player within their balance', betVerdict(m, 'u1', 'pa', 10, 100, 0, now).ok);
  check('…the whole balance', betVerdict(m, 'u1', 'pa', 100, 100, 0, now).ok);
  check('…not more than it', !betVerdict(m, 'u1', 'pa', 101, 100, 0, now).ok);
  check('…not 0, a fraction, a string', [0, 1.5, '10', -3, null].every((s) => !betVerdict(m, 'u1', 'pa', s, 100, 0, now).ok));
  check('…the cap when there is one', !betVerdict(m, 'u1', 'pa', 51, 100, 50, now).ok && betVerdict(m, 'u1', 'pa', 50, 100, 50, now).ok);
  check('…only one of the two players', !betVerdict(m, 'u1', 'someone', 10, 100, 0, now).ok);
  const own = betVerdict(m, 'pa', 'pb', 10, 100, 0, now);
  check("a player can't bet on their own match (403)", !own.ok && own.status === 403);
  check('…on the other side either', !betVerdict(m, 'pb', 'pb', 10, 100, 0, now).ok);
  check('only in the betting lobby', ['scheduled', 'open', 'live', 'solo', 'done'].every((status) => !betVerdict(matchOf({ status: status as CupMatch['status'] }), 'u1', 'pa', 10, 100, 0, now).ok));
  check('not once the lobby has closed', !betVerdict(m, 'u1', 'pa', 10, 100, 0, later(60)).ok && betVerdict(m, 'u1', 'pa', 10, 100, 0, later(59)).ok);
  check('not on a lobby with no end', !betVerdict(matchOf({ bettingEndsAt: undefined }), 'u1', 'pa', 10, 100, 0, now).ok);
  const early = betVerdict(matchOf({ kind: 'parallel' }), 'u1', 'pa', 10, 100, 0, now);
  check('only top-8 matches (409 before)', !early.ok && early.status === 409);
  check('a zero or broken balance bets nothing', !betVerdict(m, 'u1', 'pa', 1, 0, 0, now).ok && !betVerdict(m, 'u1', 'pa', 1, Number.NaN, 0, now).ok);
}

console.log('Settling');
{
  const bets = [betOf('u1', 'pa', 10), betOf('u2', 'pb', 20), betOf('u3', 'pa', 5)];
  check('nothing while the match is on', movesFor(bets, matchOf({ status: 'live' })).length === 0);
  check('a tie being replayed: the bets ride', movesFor(bets, matchOf({ status: 'live', attempt: 1, history: [{ attempt: 0, scores: { pa: 9, pb: 9 } }] })).length === 0);
  const decided = matchOf({ status: 'done', winnerId: 'pa' });
  const moves = movesFor(bets, decided);
  check('decided: a winner gets 2 × stake, a loser nothing', moves.length === 3
    && moves[0].to === 'won' && moves[0].payout === 20 && moves[0].delta === 20
    && moves[1].to === 'lost' && moves[1].payout === 0 && moves[1].delta === 0
    && moves[2].to === 'won' && moves[2].delta === 10, moves.map((m) => [m.to, m.payout, m.delta]));
  check('done with no winner: nothing', movesFor(bets, matchOf({ status: 'done' })).length === 0);
  const settled = bets.map((bet, i) => ({ ...bet, status: moves[i].to, payout: moves[i].payout }));
  check('settled bets are not settled again', movesFor(settled, decided).length === 0);
  const voided = matchOf({ status: 'betting', voids: [{ by: 'hr', at: now }] });
  const back = movesFor(settled, voided);
  check('voided: a win paid is taken back to the stake (− stake)', back[0].to === 'refunded' && back[0].payout === 10 && back[0].delta === -10);
  check('…a loss gets its stake (+ stake)', back[1].to === 'refunded' && back[1].delta === 20);
  check('…a held bet gets its stake', movesFor([betOf('u9', 'pa', 7)], voided)[0]?.delta === 7);
  const refunded = settled.map((bet, i) => ({ ...bet, status: back[i].to, payout: back[i].payout }));
  check('…and only once', movesFor(refunded, voided).length === 0);
  check('…each person ends where they started', bets.every((bet, i) => -bet.stake + moves[i].delta + back[i].delta === 0));
  check('a new book after a void is its own', bookOf(voided) === 1 && betIdOf('m-qf1', 1, 'u1') !== betIdOf('m-qf1', 0, 'u1'));
  const fresh = [...refunded, betOf('u1', 'pb', 4, { book: 1 })];
  const replayDecided = matchOf({ status: 'done', winnerId: 'pb', voids: [{ by: 'hr', at: now }] });
  const second = movesFor(fresh, replayDecided);
  check('the replay settles only its own book', second.length === 1 && second[0].bet.book === 1 && second[0].to === 'won');
  check('a bet on another match is left alone', movesFor([{ ...betOf('u1', 'pa', 3), matchId: 'other' }], decided).length === 0);
  const d = deltasByUser([...moves, ...movesFor([betOf('u1', 'pa', 1, { _id: 'x', matchId: 'm-qf1' })], decided)]);
  check('one balance change per person', d.get('u1')?.delta === 22 && !d.has('u2') && d.get('u3')?.delta === 10, [...d]);
}

console.log('What pages show');
{
  const m = matchOf({ voids: [{ by: 'hr', at: now }] });
  const bets = [
    betOf('u1', 'pa', 10, { book: 1 }),
    betOf('u2', 'pb', 20, { book: 1 }),
    betOf('u3', 'pa', 5, { book: 1 }),
    betOf('u4', 'pa', 50, { book: 0, status: 'refunded', payout: 50 }),
  ];
  const split = splitOf(bets, m);
  check('the split: points and people on each side, this book only', split.a.stake === 15 && split.a.count === 2 && split.b.stake === 20 && split.b.count === 1, split);
  const mine = mineOf([...bets, betOf('u1', 'pb', 2, { matchId: 'm-sf1', _id: 'm-sf1:0:u1', placedAt: later(600) })], 'u1');
  check('my bets, newest first', mine.length === 2 && mine[0].matchId === 'm-sf1' && mine[1].stake === 10);
  const tips = tipstersOf([
    betOf('a', 'pa', 10, { status: 'won', payout: 20, name: 'Asha' }),
    betOf('a', 'pa', 10, { _id: 'a2', status: 'lost', payout: 0, name: 'Asha' }),
    betOf('b', 'pa', 30, { status: 'won', payout: 60, name: 'Bala' }),
    betOf('c', 'pa', 5, { status: 'won', payout: 10, name: 'Chitra' }),
    betOf('c', 'pa', 5, { _id: 'c2', status: 'won', payout: 10, name: 'Chitra' }),
    betOf('d', 'pa', 99, { status: 'held', name: 'Dev' }),
    betOf('e', 'pa', 99, { status: 'refunded', payout: 99, name: 'Esha' }),
  ]);
  check('tipsters: most points won first', tips.map((t) => t.name).join(',') === 'Bala,Chitra,Asha', tips);
  check('…won = payouts less stakes, right of settled', tips[0].won === 30 && tips[1].won === 10 && tips[1].right === 2 && tips[1].of === 2 && tips[2].won === 0 && tips[2].right === 1 && tips[2].of === 2);
  check('…held and refunded bets do not count', !tips.some((t) => t.userId === 'd' || t.userId === 'e'));
  const row = ledgerRowFor(betOf('u1', 'pa', 10), 'won', 20, { label: 'QF1', pickName: 'Priya' }, now);
  check('ledger: a win is a cup_bet row on the bet, "O-O-O Tournament win"', row.source === 'cup_bet' && row.reason === 'bet_won' && row.refId === 'm-qf1:0:u1' && row.title === 'O-O-O Tournament win' && row.delta === 20 && row.id === 'cup:m-qf1:0:u1:won', row);
  check('…its note: the match, the pick, how it went', row.note === 'QF1 · backed Priya · won, 20 back', row.note);
  check('…a stake is "O-O-O Tournament bet", a refund "O-O-O Tournament refund"',
    ledgerRowFor(betOf('u1', 'pa', 10), 'placed', -10, { label: 'QF1', pickName: 'P' }, now).title === 'O-O-O Tournament bet'
    && ledgerRowFor(betOf('u1', 'pa', 10), 'refund', 10, { label: 'QF1', pickName: 'P' }, now).reason === 'bet_refunded');
}

// ---------------------------------------------------------------- for real

async function database() {
  console.log('Placing and settling, in scratch collections');
  const client = new MongoClient(env.mongoUri);
  await client.connect();
  const db = client.db(env.mongoDbName);
  const names = ['cup_test_bets', 'cup_test_users', 'cup_test_point_events'];
  const stores: BetStores = {
    db,
    bets: db.collection<CupBetRow>('cup_test_bets'),
    users: db.collection<User>('cup_test_users'),
    ledger: db.collection<PointEvent>('cup_test_point_events'),
  };
  const nameOf = (id: string) => (id === 'pa' ? 'Player A' : 'Player B');
  const event = { id: 'cup-test', maxStake: 0, entrants: [] };
  const viewer = (userId: string) => ({ userId, name: `Tester ${userId}`, org: 'sowaka' });
  const points = async (userId: string) => (await stores.users.findOne({ userId }))?.points ?? null;
  const ledgerFor = (userId: string) => stores.ledger.find({ userId }).toArray();
  const refusal = async (work: Promise<unknown>) => {
    try {
      await work;
      return null;
    } catch (error) {
      return error instanceof CupError ? error.statusCode : String(error);
    }
  };
  try {
    for (const name of names) await db.collection(name).drop().catch(() => undefined);
    // The bets and ledger collections are left to be made by the first
    // transaction, as `cup_bets` will be in production.
    await stores.users.insertMany(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((userId, i) => ({ userId, org: 'sowaka', name: userId, points: [100, 10, 100, 50, 100, 0][i] }) as unknown as User),
    );
    const m = matchOf();

    const placed = await placeBetOn(viewer('u1'), event, m, 'pa', 30, stores, now);
    check('a bet is placed: the stake leaves the balance', placed.balance === 70 && (await points('u1')) === 70, placed.balance);
    const held = await stores.bets.findOne({ _id: betIdOf(m.id, 0, 'u1') });
    check('…the bet is held', held?.status === 'held' && held.stake === 30 && held.pick === 'pa' && held.book === 0);
    const placedRows = await ledgerFor('u1');
    check('…a ledger row, − stake, "O-O-O Tournament bet"', placedRows.length === 1 && placedRows[0].delta === -30 && placedRows[0].title === 'O-O-O Tournament bet' && placedRows[0].reason === 'bet_placed', placedRows);

    check('a second bet on the same match: 409', (await refusal(placeBetOn(viewer('u1'), event, m, 'pb', 5, stores, now))) === 409);
    check('…the balance and history untouched', (await points('u1')) === 70 && (await ledgerFor('u1')).length === 1);

    check('more than the balance: 400', (await refusal(placeBetOn(viewer('u2'), event, m, 'pa', 20, stores, now))) === 400);
    check('…no bet written', (await stores.bets.countDocuments({ userId: 'u2' })) === 0);
    check('no points at all: 400', (await refusal(placeBetOn(viewer('u6'), event, m, 'pa', 1, stores, now))) === 400);
    check('a player on their own match: 403', (await refusal(placeBetOn(viewer('pa'), event, m, 'pb', 1, stores, now))) === 403);

    // The same bet sent twice at once (a double tap, two servers).
    const twice = await Promise.all([1, 2].map(() => refusal(placeBetOn(viewer('u3'), event, m, 'pb', 40, stores, now))));
    check('the same bet twice at once: one in, one 409', twice.filter((r) => r === null).length === 1 && twice.includes(409), twice);
    check('…debited once', (await points('u3')) === 60 && (await ledgerFor('u3')).length === 1);

    // Two bets on two matches at once, each the whole balance's worth.
    const other = matchOf({ id: 'm-qf2', label: 'QF2' });
    const both = await Promise.all([
      refusal(placeBetOn(viewer('u4'), event, m, 'pa', 40, stores, now)),
      refusal(placeBetOn(viewer('u4'), event, other, 'pa', 40, stores, now)),
    ]);
    const u4Bets = await stores.bets.find({ userId: 'u4' }).toArray();
    check('two bets at once for more than the balance: only one goes in', both.filter((r) => r === null).length === 1 && u4Bets.length === 1 && (await points('u4')) === 10, { both, n: u4Bets.length });
    check('…the refused one leaves no bet and no ledger row', (await ledgerFor('u4')).length === 1);

    await placeBetOn(viewer('u5'), event, m, 'pa', 100, stores, now);
    check('the whole balance can be staked', (await points('u5')) === 0);

    // A tie replayed: bets ride.
    const replay = await settleMatchBets(matchOf({ status: 'live', attempt: 1 }), stores, nameOf, now);
    check('a tie being replayed moves nothing', replay.length === 0 && (await stores.bets.countDocuments({ status: 'held' })) === 4);

    // Decided: settled, three at once, then again. (u4's bet went on QF1 or QF2, whichever won the race.)
    const onM = await stores.bets.countDocuments({ matchId: m.id });
    const decided = matchOf({ status: 'done', winnerId: 'pa', decidedAt: later(200) });
    const runs = await Promise.all([1, 2, 3].map(() => settleMatchBets(decided, stores, nameOf, later(200))));
    const movedTotal = runs.reduce((sum, run) => sum + run.length, 0);
    check('settled by three at once: each bet moved exactly once', movedTotal === onM, runs.map((r) => r.length));
    check('…a winner: 2 × stake back (u1 70 + 60)', (await points('u1')) === 130, await points('u1'));
    check('…a loser: nothing (u3 stays 60)', (await points('u3')) === 60);
    check('…whole-balance winner (u5 0 + 200)', (await points('u5')) === 200);
    const winRows = (await ledgerFor('u1')).filter((r) => r.reason === 'bet_won');
    check('…one win row each, "O-O-O Tournament win"', winRows.length === 1 && winRows[0].delta === 60 && winRows[0].title === 'O-O-O Tournament win', winRows);
    check('…no row for a loss', (await ledgerFor('u3')).length === 1);
    const again = await settleMatchBets(decided, stores, nameOf, later(300));
    check('settled again (a retry): nothing moves', again.length === 0 && (await points('u1')) === 130 && (await stores.ledger.countDocuments({ reason: 'bet_won' })) === onM - 1);

    // Voided by HR: every stake back, wins taken back; then a fresh book.
    const voided = matchOf({ status: 'betting', bettingEndsAt: later(400), voids: [{ by: 'hr', at: later(350) }] });
    const voidRuns = await Promise.all([1, 2].map(() => settleMatchBets(voided, stores, nameOf, later(350))));
    check('voided by two at once: each bet refunded once', voidRuns[0].length + voidRuns[1].length === onM);
    check('…everyone back where they started', (await points('u1')) === 100 && (await points('u3')) === 100 && (await points('u5')) === 100, [await points('u1'), await points('u3'), await points('u5')]);
    check('…refund rows, "O-O-O Tournament refund"', (await stores.ledger.countDocuments({ reason: 'bet_refunded', title: 'O-O-O Tournament refund' })) === onM);
    const net = await stores.ledger.aggregate<{ _id: string; sum: number }>([{ $match: { userId: { $in: ['u1', 'u3', 'u5'] } } }, { $group: { _id: '$userId', sum: { $sum: '$delta' } } }]).toArray();
    check('…the ledger nets to zero for each', net.every((row) => row.sum === 0), net);
    check('…all bets refunded at their stake', (await stores.bets.countDocuments({ matchId: m.id, status: 'refunded', $expr: { $eq: ['$payout', '$stake'] } })) === onM);
    check('voided again: nothing moves', (await settleMatchBets(voided, stores, nameOf, later(360))).length === 0);

    const rebet = await placeBetOn(viewer('u1'), event, voided, 'pb', 25, stores, later(360));
    check('after a void, a new bet on the replay (book 1)', rebet.bet._id === betIdOf(m.id, 1, 'u1') && (await points('u1')) === 75);
    const replayed = await settleMatchBets({ ...voided, status: 'done', winnerId: 'pb' }, stores, nameOf, later(500));
    check('the replay settles its own book only', replayed.length === 1 && (await points('u1')) === 125);
    const all = await stores.bets.find({}).toArray();
    const tips = tipstersOf(all);
    check('tipsters from what is stored', tips.length === 1 && tips[0].userId === 'u1' && tips[0].won === 25 && tips[0].right === 1 && tips[0].of === 1, tips);
  } finally {
    for (const name of names) await db.collection(name).drop().catch(() => undefined);
    const left = (await db.listCollections({ name: { $regex: '^cup_test_' } }, { nameOnly: true }).toArray()).map((c) => c.name);
    check('scratch collections dropped', left.length === 0, left);
    await client.close();
  }
}

(async () => {
  if (process.argv.includes('--db')) await database();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
