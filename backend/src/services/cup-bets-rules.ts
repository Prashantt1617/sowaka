/**
 * The Diwali Cup's bets, with no database: who may bet, what a decided or
 * voided match does to each bet, the split on the match on stage and the top
 * tipsters. `cup-bets.service.ts` reads and writes; `scripts/cup-bets-check.ts`
 * runs these on their own.
 *
 * A bet is a stake of engagement points (`User.points`) on one of the two
 * players in a top-8 match, placed in that match's betting lobby. The stake
 * leaves the balance when the bet is placed (held), then:
 *   - the match is decided: the pick won, 2 × stake comes back; it lost,
 *     nothing does;
 *   - the match is tied and replayed: nothing happens, the bet rides;
 *   - HR voids the match: every bet on it gets its stake back, whatever had
 *     happened to it (a win already paid is taken back to the stake). The
 *     match is bet on afresh: a new "book", the match's `voids.length`.
 */
import type { CupBet, CupBetStatus, CupMatch } from '../models/cup.model';
import type { PointEvent } from '../models/points.model';
import { mayBet, type Verdict } from './cup-rules';

/** A bet as stored: the model's, with the book it was placed in (0 until the match is first voided). */
export type CupBetRow = CupBet & { book: number };

/** The match's book: how many times it has been voided. A bet belongs to the book it was placed in. */
export const bookOf = (match: Pick<CupMatch, 'voids'>): number => match.voids?.length ?? 0;

/** One bet per person per match and book: a second is refused by the primary key. */
export const betIdOf = (matchId: string, book: number, userId: string): string => `${matchId}:${book}:${userId}`;

const refuse = (status: number, message: string): Verdict => ({ ok: false, status, message });

/**
 * Whether `userId` may back `pick` with `stake` now. On top of the engine's
 * own rule (`mayBet`: the lobby is open, not their own match, a player of
 * this match, a whole stake within the cap and the balance): only a top-8
 * match takes bets, and only while its lobby has an end.
 */
export function betVerdict(
  match: Pick<CupMatch, 'kind' | 'status' | 'players' | 'bettingEndsAt'>,
  userId: string,
  pick: unknown,
  stake: unknown,
  balance: number,
  maxStake: number,
  now: Date,
): Verdict {
  if (match.kind !== 'sequential') return refuse(409, 'Bets open from the quarter-finals');
  if (!match.bettingEndsAt) return refuse(409, 'Betting on this match is closed');
  return mayBet(match, userId, pick, stake, Math.max(0, Math.floor(balance || 0)), Math.max(0, maxStake || 0), now);
}

// ---------------------------------------------------------------- settling

/** What is to happen to one bet, and what it does to its owner's balance. */
export interface BetMove {
  bet: CupBetRow;
  /** The status it has now: the write is conditional on it, so it happens once. */
  from: CupBetStatus;
  to: CupBetStatus;
  payout: number;
  /** Signed change to `User.points`. */
  delta: number;
  kind: 'won' | 'lost' | 'refund';
}

/**
 * Everything a match's current state means for its bets, from the bets as
 * they stand. Pure and idempotent: a bet already where it should be gets no
 * move, so running it twice (a retry, a second server) moves nothing more.
 *
 *   - A bet from an earlier book (the match has been voided since): refunded.
 *     Held or lost: + stake. Won (2 × stake already paid): − stake.
 *   - A held bet in the current book, the match decided: won (+ 2 × stake) or
 *     lost (nothing).
 *   - Anything else (the match still on, a tie being replayed): nothing.
 */
export function movesFor(bets: CupBetRow[], match: Pick<CupMatch, 'id' | 'status' | 'winnerId' | 'voids'>): BetMove[] {
  const book = bookOf(match);
  const moves: BetMove[] = [];
  for (const bet of bets) {
    if (bet.matchId !== match.id || bet.status === 'refunded') continue;
    const placedIn = typeof bet.book === 'number' ? bet.book : 0;
    if (placedIn < book) {
      const paid = bet.status === 'won' ? bet.payout : 0;
      moves.push({ bet, from: bet.status, to: 'refunded', payout: bet.stake, delta: bet.stake - paid, kind: 'refund' });
      continue;
    }
    if (bet.status !== 'held' || match.status !== 'done' || !match.winnerId) continue;
    if (bet.pick === match.winnerId) {
      moves.push({ bet, from: 'held', to: 'won', payout: bet.stake * 2, delta: bet.stake * 2, kind: 'won' });
    } else {
      moves.push({ bet, from: 'held', to: 'lost', payout: 0, delta: 0, kind: 'lost' });
    }
  }
  return moves;
}

/** Each person's net change from a set of moves (one `$inc` each). */
export function deltasByUser(moves: BetMove[]): Map<string, { org: string; delta: number }> {
  const out = new Map<string, { org: string; delta: number }>();
  for (const move of moves) {
    if (move.delta === 0) continue;
    const kept = out.get(move.bet.userId) ?? { org: move.bet.org, delta: 0 };
    kept.delta += move.delta;
    out.set(move.bet.userId, kept);
  }
  for (const [userId, row] of out) if (row.delta === 0) out.delete(userId);
  return out;
}

// ---------------------------------------------------------------- the points history

export interface BetContext {
  /** "QF1", "Final". */
  label: string;
  /** The name of the player backed. */
  pickName: string;
}

/** The line the points history shows under a bet: the match, the pick and how it went. */
export function betNote(ctx: BetContext, how?: string): string {
  return [ctx.label, `backed ${ctx.pickName}`, how].filter(Boolean).join(' · ');
}

/**
 * A ledger row for a bet. The id is the bet's and the step's, so a row is
 * never written twice for the same step (the bet's status change claims it
 * first). `refId` is the bet, so the history shows one line per bet.
 */
export function ledgerRowFor(
  bet: Pick<CupBetRow, '_id' | 'userId' | 'org' | 'stake' | 'eventId'>,
  step: 'placed' | 'won' | 'refund',
  delta: number,
  ctx: BetContext,
  now: Date,
): PointEvent {
  const how =
    step === 'placed'
      ? `${bet.stake} point${bet.stake === 1 ? '' : 's'} staked`
      : step === 'won'
        ? `won, ${delta} back`
        : 'match voided, stake back';
  return {
    id: `cup:${bet._id}:${step}`,
    userId: bet.userId,
    org: bet.org,
    delta,
    source: 'cup_bet',
    reason: step === 'placed' ? 'bet_placed' : step === 'won' ? 'bet_won' : 'bet_refunded',
    refId: bet._id,
    note: betNote(ctx, how),
    title: step === 'placed' ? 'Diwali Cup bet' : step === 'won' ? 'Diwali Cup win' : 'Diwali Cup refund',
    createdAt: now,
  };
}

// ---------------------------------------------------------------- what pages show

export interface BetView {
  matchId: string;
  pick: string;
  stake: number;
  status: CupBetStatus;
  payout: number;
  book: number;
  placedAt: Date;
}

/** One person's bets, newest first. */
export function mineOf(bets: CupBetRow[], userId: string): BetView[] {
  return bets
    .filter((bet) => bet.userId === userId)
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
    .map((bet) => ({
      matchId: bet.matchId,
      pick: bet.pick,
      stake: bet.stake,
      status: bet.status,
      payout: bet.payout,
      book: typeof bet.book === 'number' ? bet.book : 0,
      placedAt: bet.placedAt,
    }));
}

export interface Side {
  stake: number;
  count: number;
}

/** How the bets on a match stand in its current book: points and people on each player (a: `players[0]`). */
export function splitOf(bets: CupBetRow[], match: Pick<CupMatch, 'id' | 'players' | 'voids'>): { a: Side; b: Side } {
  const book = bookOf(match);
  const a: Side = { stake: 0, count: 0 };
  const b: Side = { stake: 0, count: 0 };
  for (const bet of bets) {
    if (bet.matchId !== match.id || bet.status === 'refunded' || (bet.book ?? 0) !== book) continue;
    const side = bet.pick === match.players[0] ? a : bet.pick === match.players[1] ? b : null;
    if (!side) continue;
    side.stake += bet.stake;
    side.count += 1;
  }
  return { a, b };
}

export interface Tipster {
  userId: string;
  name: string;
  /** Points won from bets: payouts less stakes, over settled bets. */
  won: number;
  /** Bets that came in. */
  right: number;
  /** Settled bets. */
  of: number;
}

/**
 * The top tipsters: most points won from settled bets (won or lost; a
 * refunded bet is as if never placed), then most right, then fewest bets,
 * then by name.
 */
export function tipstersOf(bets: CupBetRow[], limit = 10): Tipster[] {
  const by = new Map<string, Tipster>();
  for (const bet of bets) {
    if (bet.status !== 'won' && bet.status !== 'lost') continue;
    const row = by.get(bet.userId) ?? { userId: bet.userId, name: bet.name, won: 0, right: 0, of: 0 };
    row.won += bet.payout - bet.stake;
    row.of += 1;
    if (bet.status === 'won') row.right += 1;
    by.set(bet.userId, row);
  }
  return [...by.values()]
    .sort((x, y) => y.won - x.won || y.right - x.right || x.of - y.of || x.name.localeCompare(y.name))
    .slice(0, limit);
}
