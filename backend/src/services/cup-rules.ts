/**
 * The Diwali Cup's rules, with no database: the seeded draw, how a match is
 * decided, and who may bet what. `cup.service.ts` does the reading and
 * writing; `scripts/cup-check.ts` runs these on their own.
 *
 * The draw. Everyone is ranked by their best Odd One Out score (no score
 * below everyone, ties by lucky draw), or all by lucky draw, and numbered
 * seed 1..N.
 *   - Round 1: everyone plays, seed k against seed N+1-k (1 v N, 2 v N-1, …).
 *     With an odd N, seed 1 has the one free pass. That makes U "units".
 *   - Then the units go into a bracket of T places, T the largest power of
 *     two not above U. When U > T, round 2 hands out 2T-U free passes, to the
 *     units of the top seeds (places 1..2T-U), and the rest meet as unit r v
 *     unit 2T+1-r for the remaining places. The free pass belongs to the
 *     place: whoever won that unit has it, the draw is never reshuffled.
 *   - The T places then play a standard seeded bracket (1 v T, and 1 and 2
 *     in opposite halves, 1-4 in different quarters, …), so seeds 1 and 2 can
 *     only meet in the final, the top four not before the semi-finals, the
 *     top eight not before the quarter-finals.
 * A round with `topN` players or fewer is played one match at a time, each
 * with a betting lobby; every other round plays all its matches at once.
 */
import { randomInt } from 'node:crypto';
import type {
  CupDecision,
  CupEventConfig,
  CupMatch,
  CupNode,
  CupRef,
  CupRound,
  CupSeeding,
} from '../models/cup.model';

export const DEFAULT_CUP_CONFIG: CupEventConfig = {
  catalogKey: 'diwali-cup',
  gameKey: 'odd-one-out',
  excludeUserIds: [],
  includeUserIds: [],
  seeding: 'leaderboard',
  topN: 8,
  startWindowSec: 180,
  soloStartSec: 90,
  bettingSec: 60,
  countdownSec: 4,
  roundSec: 45,
  finishGraceSec: 25,
  minPlaySec: 25,
  maxScore: 10_000,
  maxReplays: 2,
  maxStake: 0,
  pushAtLobby: true,
};

export type Rng = (maxExclusive: number) => number;
export const cryptoRng: Rng = (max) => randomInt(max);

export function shuffle<T>(items: T[], rng: Rng = cryptoRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface Candidate {
  userId: string;
  name: string;
  best: number | null;
}

/**
 * Everyone in seed order: by best score, highest first, with no score below
 * every score, and equal scores (and everyone without one) in lucky-draw
 * order; or all by lucky draw.
 */
export function seedOrderOf<T extends Candidate>(people: T[], seeding: CupSeeding, rng: Rng = cryptoRng): T[] {
  const drawn = shuffle(people, rng);
  if (seeding === 'lucky') return drawn;
  const rankOf = (p: T) => (p.best == null ? -1 : p.best);
  // A stable sort keeps the lucky-draw order between equals.
  return drawn
    .map((p, i) => ({ p, i }))
    .sort((x, y) => rankOf(y.p) - rankOf(x.p) || x.i - y.i)
    .map(({ p }) => p);
}

export const largestPowerOfTwoAtMost = (n: number) => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

/**
 * A standard seeded bracket's order of places for T (a power of two):
 * [1, 8, 4, 5, 2, 7, 3, 6] for 8. Neighbouring pairs meet first.
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return order;
}

export const entrantRef = (seed: number): CupRef => `e:${seed}`;
export const nodeRef = (round: number, slot: number): CupRef => `n:${round}:${slot}`;

export function parseRef(ref: CupRef): { kind: 'e'; seed: number } | { kind: 'n'; round: number; slot: number } | null {
  const e = /^e:(\d+)$/.exec(ref);
  if (e) return { kind: 'e', seed: Number(e[1]) };
  const n = /^n:(\d+):(\d+)$/.exec(ref);
  if (n) return { kind: 'n', round: Number(n[1]), slot: Number(n[2]) };
  return null;
}

/** Players in a round: two for a match, one for a free pass. */
export const playersIn = (nodes: CupNode[]) => nodes.reduce((sum, node) => sum + node.feeders.length, 0);

/**
 * The whole draw for N entrants, as rounds of places, each fed by two
 * earlier places (a match) or one (a free pass). Labels and kinds included.
 */
export function buildDraw(entrants: number, topN: number): CupRound[] {
  if (entrants < 2) return [];
  const raw: CupNode[][] = [];
  // Round 1: everyone plays, 1 v N; an odd N gives seed 1 the free pass.
  const odd = entrants % 2 === 1;
  const units = Math.ceil(entrants / 2);
  const first: CupNode[] = [];
  for (let k = 1; k <= units; k += 1) {
    if (odd && k === 1) first.push({ slot: k, feeders: [entrantRef(1)] });
    else first.push({ slot: k, feeders: [entrantRef(k), entrantRef(odd ? entrants + 2 - k : entrants + 1 - k)] });
  }
  raw.push(first);
  if (units > 1) {
    const size = largestPowerOfTwoAtMost(units);
    let places: CupRef[];
    if (units > size) {
      // Round 2: free passes for the top units, the rest meet r v 2T+1-r.
      const passes = 2 * size - units;
      const second: CupNode[] = [];
      for (let r = 1; r <= size; r += 1) {
        second.push({ slot: r, feeders: r <= passes ? [nodeRef(1, r)] : [nodeRef(1, r), nodeRef(1, 2 * size + 1 - r)] });
      }
      raw.push(second);
      places = second.map((node) => nodeRef(2, node.slot));
    } else {
      places = first.map((node) => nodeRef(1, node.slot));
    }
    // The seeded bracket over the places.
    const order = bracketOrder(size);
    let level: CupRef[] = order.map((place) => places[place - 1]);
    while (level.length > 1) {
      const round = raw.length + 1;
      const nodes: CupNode[] = [];
      for (let m = 0; m < level.length / 2; m += 1) nodes.push({ slot: m + 1, feeders: [level[2 * m], level[2 * m + 1]] });
      raw.push(nodes);
      level = nodes.map((node) => nodeRef(round, node.slot));
    }
  }
  const total = raw.length;
  return raw.map((nodes, index) => {
    const n = index + 1;
    const { label, short } = roundName(n, total, nodes.length);
    return { n, label, short, kind: playersIn(nodes) <= topN ? 'sequential' : 'parallel', nodes };
  });
}

export function roundName(n: number, total: number, nodes: number): { label: string; short: string } {
  if (n === total && nodes === 1) return { label: 'Final', short: 'F' };
  if (n === total - 1 && nodes === 2) return { label: 'Semi-finals', short: 'SF' };
  if (n === total - 2 && nodes === 4) return { label: 'Quarter-finals', short: 'QF' };
  return { label: `Round ${n}`, short: `R${n}` };
}

/** A match's name: "QF2", "SF1", "Final", or "Round 3 · Match 7" (counting matches, not free passes). */
export function matchLabel(round: CupRound, matchNumber: number): string {
  if (round.short === 'F') return 'Final';
  if (round.short === 'QF' || round.short === 'SF') return `${round.short}${matchNumber}`;
  return `${round.label} · Match ${matchNumber}`;
}

// ---------------------------------------------------------------- deciding a match

export type MatchTiming = Pick<
  CupEventConfig,
  'startWindowSec' | 'soloStartSec' | 'roundSec' | 'finishGraceSec' | 'minPlaySec' | 'maxReplays' | 'countdownSec' | 'maxScore'
>;

export type MatchStep =
  | { kind: 'none' }
  /** Both joined but the start was never set (a crash between the two writes). */
  | { kind: 'start'; startAt: Date }
  /** The window closed with one player in: they play alone. */
  | { kind: 'solo'; userId: string; soloUntil: Date }
  /** A tie: the same two again, on new boards. */
  | { kind: 'replay'; scores: Record<string, number> }
  | { kind: 'decide'; winnerId: string; decidedBy: CupDecision; result: Record<string, number> };

/** The better seed of the two: the one with the lower number. */
export function betterSeed(match: Pick<CupMatch, 'players'>, seedOf: (userId: string) => number): string {
  const [a, b] = match.players;
  return seedOf(a) <= seedOf(b) ? a : b;
}

const at = (date: Date | undefined) => (date ? new Date(date).getTime() : Number.NaN);

/** When a round that started at `startAt` stops taking finals. */
export const roundEnds = (startAt: Date, t: Pick<MatchTiming, 'roundSec' | 'finishGraceSec'>) =>
  new Date(at(startAt) + (t.roundSec + t.finishGraceSec) * 1000);

/**
 * What the runner should do with a match now. Pure: the caller applies it
 * with an update conditional on the status it read.
 *
 *   open:  both joined → start (normally done by the second join itself).
 *          Window over → one joined: solo; nobody: the better seed, as absent.
 *   live:  both finals in, or the round over: each player's final, else
 *          their last live score; nothing at all from either is absent. A
 *          tie replays (up to `maxReplays`, then the better seed).
 *   solo:  the lone player's final (or, if they dropped out, their best live
 *          score) counts against 0. Not started in time, or started and
 *          never scored at all: both absent, so the better seed.
 */
export function nextStep(match: CupMatch, t: MatchTiming, now: Date, seedOf: (userId: string) => number): MatchStep {
  const nowMs = now.getTime();
  const [a, b] = match.players;
  const absent = (): MatchStep => ({ kind: 'decide', winnerId: betterSeed(match, seedOf), decidedBy: 'absent', result: { [a]: 0, [b]: 0 } });
  switch (match.status) {
    case 'open': {
      const joined = match.players.filter((p) => match.joined?.[p]);
      if (joined.length === 2) return { kind: 'start', startAt: new Date(nowMs + t.countdownSec * 1000) };
      if (nowMs < at(match.deadlineAt)) return { kind: 'none' };
      if (joined.length === 1) return { kind: 'solo', userId: joined[0], soloUntil: new Date(nowMs + t.soloStartSec * 1000) };
      return absent();
    }
    case 'live': {
      if (!match.startAt) return { kind: 'start', startAt: new Date(nowMs + t.countdownSec * 1000) };
      const bothIn = !!(match.finals?.[a] && match.finals?.[b]);
      if (!bothIn && nowMs < roundEnds(match.startAt, t).getTime()) return { kind: 'none' };
      // The higher of a player's final and their best live score: a page reopened mid-round starts again from 0.
      const scoreOf = (p: string) => {
        const final = match.finals?.[p]?.score;
        const live = match.live?.[p]?.score;
        return final == null && live == null ? null : Math.max(final ?? 0, live ?? 0);
      };
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa == null && sb == null) return absent();
      const result = { [a]: sa ?? 0, [b]: sb ?? 0 };
      if (result[a] === result[b]) {
        // Ties so far in this play of the match (an HR void starts the count again).
        if ((match.history?.length ?? 0) < t.maxReplays) return { kind: 'replay', scores: result };
        return { kind: 'decide', winnerId: betterSeed(match, seedOf), decidedBy: 'played', result };
      }
      return { kind: 'decide', winnerId: result[a] > result[b] ? a : b, decidedBy: 'played', result };
    }
    case 'solo': {
      const lone = match.players.find((p) => match.joined?.[p]);
      if (!lone) return absent();
      const other = lone === a ? b : a;
      const final = match.finals?.[lone];
      if (final) {
        const score = Math.max(final.score, match.live?.[lone]?.score ?? 0);
        return { kind: 'decide', winnerId: lone, decidedBy: 'solo', result: { [lone]: score, [other]: 0 } };
      }
      if (!match.startAt) return nowMs >= at(match.soloUntil) ? absent() : { kind: 'none' };
      if (nowMs < roundEnds(match.startAt, t).getTime()) return { kind: 'none' };
      // Started and dropped out before the end: their last live score stands against 0, as in a played match.
      const live = match.live?.[lone]?.score;
      if (live != null) return { kind: 'decide', winnerId: lone, decidedBy: 'solo', result: { [lone]: live, [other]: 0 } };
      return absent();
    }
    default:
      return { kind: 'none' };
  }
}

export type Refusal = { ok: false; status: number; message: string };
export type Verdict = { ok: true } | Refusal;
const no = (status: number, message: string): Refusal => ({ ok: false, status, message });
const yes: Verdict = { ok: true };

/** Whether `userId` may join the match now (say they are here, ready to play). */
export function mayJoin(match: CupMatch, userId: string, now: Date): Verdict {
  if (!match.players.includes(userId)) return no(403, 'This is not your match');
  if (match.status === 'scheduled' || match.status === 'betting') return no(409, 'Your match has not opened yet');
  if (match.status === 'done') return no(409, 'This match is over');
  if (match.joined?.[userId]) return yes;
  if (match.status !== 'open' || now.getTime() >= at(match.deadlineAt)) return no(409, 'Too late: the start window has closed');
  return yes;
}

/** Whether a lone player may start their round now. */
export function mayStartSolo(match: CupMatch, userId: string, now: Date): Verdict {
  if (match.status !== 'solo' || !match.joined?.[userId]) return no(409, 'There is no round to start');
  if (match.startAt) return yes;
  if (now.getTime() >= at(match.soloUntil)) return no(409, 'Too late to start your round');
  return yes;
}

/** Whether a score from `userId` (live or final) is taken now. */
export function mayScore(match: CupMatch, userId: string, t: MatchTiming, now: Date, final: boolean): Verdict {
  if (!match.players.includes(userId)) return no(403, 'This is not your match');
  if ((match.status !== 'live' && match.status !== 'solo') || !match.startAt) return no(409, 'Your round is not on');
  if (match.status === 'solo' && !match.joined?.[userId]) return no(409, 'Your round is not on');
  if (match.finals?.[userId]) return no(409, 'You have already finished this round');
  const nowMs = now.getTime();
  const start = at(match.startAt);
  if (nowMs < start - 1500) return no(409, 'Your round has not started yet');
  if (nowMs > roundEnds(match.startAt, t).getTime()) return no(409, 'This round is over');
  if (final && nowMs < start + t.minPlaySec * 1000) return no(400, 'That round ended too soon to count');
  return yes;
}

/** A score as posted, held to 0..max (a round past the game's ceiling counts as the ceiling); null for no number. */
export function parseScore(raw: unknown, max: number): number | null {
  const score = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(score) || score < 0) return null;
  return Math.min(Math.round(score), max);
}

/** Whether `userId` may back `pick` with `stake` points in this match, with `balance` to spend. */
export function mayBet(
  match: Pick<CupMatch, 'status' | 'players' | 'bettingEndsAt'>,
  userId: string,
  pick: unknown,
  stake: unknown,
  balance: number,
  maxStake: number,
  now: Date,
): Verdict {
  if (match.status !== 'betting' || now.getTime() >= at(match.bettingEndsAt)) return no(409, 'Betting on this match is closed');
  if (match.players.includes(userId)) return no(403, "You can't bet on your own match");
  if (typeof pick !== 'string' || !match.players.includes(pick)) return no(400, 'Pick one of the two players');
  if (typeof stake !== 'number' || !Number.isInteger(stake) || stake < 1) return no(400, 'Stake at least 1 point');
  if (maxStake > 0 && stake > maxStake) return no(400, `The most you can stake is ${maxStake} points`);
  if (stake > balance) return no(400, `You have ${balance} points to bet`);
  return yes;
}
