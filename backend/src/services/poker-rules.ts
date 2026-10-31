/**
 * Speed Poker's card rules, with no I/O: the deck, the shuffle, the best
 * five-card hand out of seven, and how a hand's chips split into a main pot
 * and side pots. No-limit Texas Hold'em, standard rankings.
 *
 * A card is a number 0..51: rank = floor(card / 4) + 2 (2..14, ace high),
 * suit = card % 4 (0 clubs, 1 diamonds, 2 hearts, 3 spades). The page gets
 * them as two-letter strings ("As", "Td", "7h").
 */

export type Random = () => number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (card: number) => Math.floor(card / 4) + 2;
export const suitOf = (card: number) => card % 4;

export function cardName(card: number): string {
  return RANKS[rankOf(card) - 2] + SUITS[suitOf(card)];
}

export function parseCard(name: string): number {
  const rank = RANKS.indexOf(name[0]?.toUpperCase() ?? '');
  const suit = SUITS.indexOf(name[1]?.toLowerCase() ?? '');
  if (rank < 0 || suit < 0) throw new Error(`Not a card: ${name}`);
  return rank * 4 + suit;
}

/** A fresh deck, shuffled (Fisher–Yates) with [random]; the server passes a crypto source. */
export function shuffledDeck(random: Random): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const HAND_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const;

/**
 * A hand's strength as a list compared left to right: the category (0 high
 * card .. 8 straight flush), then the ranks that break ties within it.
 */
export type HandScore = number[];

export function compareScores(a: HandScore, b: HandScore): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The top rank of a straight in these ranks (5 for the wheel), or 0. */
function straightHigh(ranks: number[]): number {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let top = 14; top >= 5; top--) {
    let run = true;
    for (let r = top; r > top - 5; r--) {
      if (!set.has(r)) {
        run = false;
        break;
      }
    }
    if (run) return top;
  }
  return 0;
}

/** Exactly five cards. */
export function scoreFive(cards: number[]): HandScore {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const high = straightHigh(ranks);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Ranks grouped: bigger groups first, then higher rank.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]);
  const byGroup = groups.map((g) => g[0]);
  if (flush && high) return [8, high];
  if (shape[0] === 4) return [7, ...byGroup];
  if (shape[0] === 3 && shape[1] === 2) return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (high) return [4, high];
  if (shape[0] === 3) return [3, ...byGroup];
  if (shape[0] === 2 && shape[1] === 2) return [2, ...byGroup];
  if (shape[0] === 2) return [1, ...byGroup];
  return [0, ...ranks];
}

export interface BestHand {
  score: HandScore;
  /** The five cards that make it. */
  cards: number[];
  name: string;
}

/** The best five of five to seven cards. */
export function bestHand(cards: number[]): BestHand {
  if (cards.length < 5) throw new Error('Need five cards');
  let best: BestHand | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = scoreFive(five);
            if (!best || compareScores(score, best.score) > 0) best = { score, cards: five, name: HAND_NAMES[score[0]] };
          }
  return best!;
}

export interface Pot {
  amount: number;
  /** Seat indexes that may win it: still in the hand and in for at least this level. */
  eligible: number[];
}

/**
 * The main pot and side pots from what each seat put in this hand. A folded
 * seat's chips stay in the pots it paid into but it can win none. Levels with
 * the same eligible seats are merged.
 */
export function buildPots(committed: number[], folded: boolean[]): Pot[] {
  const levels = [...new Set(committed.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of committed) amount += Math.min(c, level) - Math.min(c, prev);
    const eligible = committed.map((c, i) => (c >= level && !folded[i] ? i : -1)).filter((i) => i >= 0);
    prev = level;
    if (amount === 0) continue;
    const last = pots.at(-1);
    if (last && last.eligible.length === eligible.length && last.eligible.every((s, i) => s === eligible[i])) {
      last.amount += amount;
    } else if (eligible.length === 0 && last) {
      // Chips above every live player's level (a folded overbet): to the last pot.
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

/**
 * Splits [amount] between [winners] (seat indexes); the odd chips go one
 * each to the winners nearest the left of the button, as in a card room.
 */
export function splitPot(amount: number, winners: number[], button: number, seatCount: number): Map<number, number> {
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  const out = new Map<number, number>(winners.map((w) => [w, share]));
  const byPosition = [...winners].sort((a, b) => ((a - button - 1 + seatCount) % seatCount) - ((b - button - 1 + seatCount) % seatCount));
  for (const w of byPosition) {
    if (odd <= 0) break;
    out.set(w, out.get(w)! + 1);
    odd -= 1;
  }
  return out;
}
