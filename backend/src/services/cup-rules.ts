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
  CupKnightsResult,
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

/**
 * The draw from the lobby: the entrants, already in a random order (seed 1..N
 * is just that order), paired off round by round. Each round pairs the places
 * left two by two; with an odd number, one of them, picked at random, has the
 * round's one free pass. So a free pass only ever happens in a round with an
 * odd number of players, and the pairs are random all the way to the final.
 */
export function buildPyramidDraw(entrants: number, topN: number, rng: Rng = cryptoRng): CupRound[] {
  if (entrants < 2) return [];
  const raw: CupNode[][] = [];
  let places: CupRef[] = Array.from({ length: entrants }, (_, i) => entrantRef(i + 1));
  while (places.length > 1) {
    const round = raw.length + 1;
    const pass = places.length % 2 === 1 ? rng(places.length) : -1;
    const rest = pass < 0 ? places : places.filter((_, i) => i !== pass);
    const nodes: CupNode[] = [];
    for (let i = 0; i < rest.length; i += 2) nodes.push({ slot: nodes.length + 1, feeders: [rest[i], rest[i + 1]] });
    // The free pass sits at a random place in the round too, so the next pairing is not always the last two.
    if (pass >= 0) nodes.splice(rng(nodes.length + 1), 0, { slot: 0, feeders: [places[pass]] });
    nodes.forEach((node, i) => {
      node.slot = i + 1;
    });
    raw.push(nodes);
    places = nodes.map((node) => nodeRef(round, node.slot));
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
> & { gameKey?: string };

export type MatchStep =
  | { kind: 'none' }
  /** Both joined but the start was never set (a crash between the two writes). */
  | { kind: 'start'; startAt: Date }
  /** The window closed with one player in: they play alone. */
  | { kind: 'solo'; userId: string; soloUntil: Date; startAt?: Date }
  /** A tie: the same two again, on new boards. */
  | { kind: 'replay'; scores: Record<string, number> }
  | { kind: 'decide'; winnerId: string; decidedBy: CupDecision; result: Record<string, number> | CupKnightsResult };

/** The better seed of the two: the one with the lower number. */
export function betterSeed(match: Pick<CupMatch, 'players'>, seedOf: (userId: string) => number): string {
  const [a, b] = match.players;
  return seedOf(a) <= seedOf(b) ? a : b;
}

const at = (date: Date | undefined) => (date ? new Date(date).getTime() : Number.NaN);

/** When a round that started at `startAt` stops taking finals (knights: its cap, plus a moment for the last report). */
export const roundEnds = (startAt: Date, t: Pick<MatchTiming, 'roundSec' | 'finishGraceSec' | 'gameKey'>) =>
  new Date(at(startAt) + (t.roundSec + (t.gameKey === KNIGHTS ? KNIGHTS_GRACE_SEC : t.finishGraceSec)) * 1000);

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
export function nextStep(match: CupMatch, t: MatchTiming, now: Date, seedOf: (userId: string) => number, solution?: number[]): MatchStep {
  if (t.gameKey === KNIGHTS) return nextKnightsStep(match, t, now, seedOf, solution ?? []);
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

/** Where a player is in the match's seeded boards: the board index, and the last tile tapped (right or wrong). */
export interface LiveBoard {
  board: number;
  tap?: number;
  ok?: boolean;
}

const MAX_BOARD = 10_000;
const MAX_TILE = 6 * 6 - 1;
const isBoardInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** The board a page reported with its score, or null when there is none or it is junk (a tap without a sound board is dropped with it). */
export function parseLiveBoard(raw: unknown): LiveBoard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isBoardInt(r.board, MAX_BOARD)) return null;
  const out: LiveBoard = { board: r.board };
  if (isBoardInt(r.tap, MAX_TILE) && typeof r.ok === 'boolean') {
    out.tap = r.tap;
    out.ok = r.ok;
  }
  return out;
}


// ---------------------------------------------------------------- knights

/**
 * The Knights Tournament (Men's Day): an n×n board of n colour regions, one
 * knight per row, column and region, no two touching. Both players get the
 * same board, from the bank (`content/knights-boards.json`, one answer each),
 * picked by the match's seed. The first right board wins at once; a player
 * may resign; at the cap the one with more knights in the right place wins,
 * a tie replays on a new board (then the better seed). A lone player goes
 * through as soon as they start. The solution never leaves the server until
 * the match is decided.
 */
export const KNIGHTS = 'knights';
/** After the cap, how long the last live report is still taken. */
export const KNIGHTS_GRACE_SEC = 3;

export interface KnightsBoard {
  /** Region id per cell, row-major, n*n. */
  g: number[];
  /** The solution's cells, sorted, one per row. */
  s: number[];
}
export type KnightsBank = Record<string, KnightsBoard[]>;

/** The grid of a round: the last two rounds 9×9, round 1 6×6, every other 8×8. */
export function gridFor(round: number, totalRounds: number): 6 | 8 | 9 {
  if (round === totalRounds || round === totalRounds - 1) return 9;
  if (round === 1) return 6;
  return 8;
}

/** The match's board: `seed % bank[n].length`. */
export function knightsBoardFor(bank: KnightsBank, n: number, seed: number): KnightsBoard {
  const boards = bank[String(n)];
  if (!boards?.length) throw new Error(`No ${n}x${n} knights boards`);
  return boards[Math.abs(Math.trunc(seed)) % boards.length];
}

/** A new seed for a replay that lands on another board of the bank (`len` boards). */
export function newKnightsSeed(oldSeed: number, len: number, fresh: () => number): number {
  for (let i = 0; i < 50; i += 1) {
    const seed = fresh();
    if (len <= 1 || seed % len !== oldSeed % len) return seed;
  }
  return oldSeed + 1;
}

/** The knights a page reported: whole cell indices on an n×n board, deduped and sorted; null for junk. */
export function parseKnights(raw: unknown, n: number): number[] | null {
  if (!Array.isArray(raw) || raw.length > n * n) return null;
  const cells = new Set<number>();
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= n * n) return null;
    cells.add(v);
  }
  return [...cells].sort((x, y) => x - y);
}

/** Knights in the right place. */
export function rightOf(knights: number[] | undefined | null, solution: number[]): number {
  if (!knights?.length) return 0;
  const s = new Set(solution);
  return knights.reduce((sum, c) => sum + (s.has(c) ? 1 : 0), 0);
}

/** The board is the answer: exactly the solution's cells. */
export const isSolved = (knights: number[] | undefined | null, solution: number[]) =>
  !!knights && solution.length > 0 && knights.length === solution.length && rightOf(knights, solution) === solution.length;

const knightsResult = (winnerId: string, decidedBy: CupDecision, right: Record<string, number>, finishedMs?: number): CupKnightsResult => ({
  winnerId,
  decidedBy,
  right,
  ...(finishedMs !== undefined ? { finishedMs } : {}),
});

/**
 * A knights match's next step. `match.live[p].knights` is each player's
 * latest board (the runtime's, merged in). Pure, like `nextStep`.
 *   open:  as for every game (both in → start; window over → solo or absent).
 *   live:  a right board → that player, `finished`, at once (two at once: the
 *          earlier report). At the cap (+ grace): more right wins (`cap`); equal
 *          replays, up to `maxReplays`, then the better seed (`replays`).
 *   solo:  started → the lone player goes through; never started in time →
 *          the better seed, as absent.
 */
export function nextKnightsStep(match: CupMatch, t: MatchTiming, now: Date, seedOf: (userId: string) => number, solution: number[]): MatchStep {
  const nowMs = now.getTime();
  const [a, b] = match.players;
  const zero = { [a]: 0, [b]: 0 };
  const absent = (): MatchStep => {
    const winnerId = betterSeed(match, seedOf);
    return { kind: 'decide', winnerId, decidedBy: 'absent', result: knightsResult(winnerId, 'absent', zero) };
  };
  const right = () => ({ [a]: rightOf(match.live?.[a]?.knights, solution), [b]: rightOf(match.live?.[b]?.knights, solution) });
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
      const solved = match.players
        .filter((p) => isSolved(match.live?.[p]?.knights, solution))
        .sort((x, y) => at(match.live?.[x]?.at) - at(match.live?.[y]?.at));
      if (solved.length) {
        const winnerId = solved[0];
        const finishedMs = Math.max(0, at(match.live?.[winnerId]?.at) - at(match.startAt));
        return { kind: 'decide', winnerId, decidedBy: 'finished', result: knightsResult(winnerId, 'finished', right(), Number.isFinite(finishedMs) ? finishedMs : undefined) };
      }
      if (nowMs < roundEnds(match.startAt, t).getTime()) return { kind: 'none' };
      const r = right();
      if (r[a] === r[b]) {
        if ((match.history?.length ?? 0) < t.maxReplays) return { kind: 'replay', scores: r };
        const winnerId = betterSeed(match, seedOf);
        return { kind: 'decide', winnerId, decidedBy: 'replays', result: knightsResult(winnerId, 'replays', r) };
      }
      const winnerId = r[a] > r[b] ? a : b;
      return { kind: 'decide', winnerId, decidedBy: 'cap', result: knightsResult(winnerId, 'cap', r) };
    }
    case 'solo': {
      const lone = match.players.find((p) => match.joined?.[p]);
      if (!lone) return absent();
      if (match.startAt) return { kind: 'decide', winnerId: lone, decidedBy: 'solo', result: knightsResult(lone, 'solo', right()) };
      return nowMs >= at(match.soloUntil) ? absent() : { kind: 'none' };
    }
    default:
      return { kind: 'none' };
  }
}

/** A resignation: the other player wins at once. Only a player of the match, only while it is live or solo. */
export function resignStep(match: CupMatch, userId: string, solution: number[]): MatchStep | Refusal {
  if (!match.players.includes(userId)) return no(403, 'This is not your match');
  if (match.status !== 'live' && match.status !== 'solo') return no(409, 'Your match is not on');
  const [a, b] = match.players;
  const winnerId = userId === a ? b : a;
  const right = { [a]: rightOf(match.live?.[a]?.knights, solution), [b]: rightOf(match.live?.[b]?.knights, solution) };
  return { kind: 'decide', winnerId, decidedBy: 'resigned', result: knightsResult(winnerId, 'resigned', right) };
}

// ---------------------------------------------------------------- the lobby's ghosts

/** A lobby member is drawn only if their page checked in this lately (it polls every 1.5-2 s while open). */
export const LOBBY_FRESH_MS = 30_000;

/**
 * Who in the lobby is drawn: everyone whose page checked in within
 * LOBBY_FRESH_MS of the draw (someone who joined and then closed the app would
 * only be a no-show). A lobby with no check-ins at all (pages and servers from
 * before this) is drawn whole, as before.
 */
export function lobbyPresent(event: { lobbyJoined?: string[]; lobbySeen?: Record<string, Date> }, now: Date): { kept: string[]; dropped: string[] } {
  const joined = event.lobbyJoined ?? [];
  const seen = event.lobbySeen ?? {};
  if (!joined.some((id) => seen[id])) return { kept: joined.slice(), dropped: [] };
  const fresh = (id: string) => !!seen[id] && now.getTime() - new Date(seen[id]).getTime() <= LOBBY_FRESH_MS;
  return { kept: joined.filter(fresh), dropped: joined.filter((id) => !fresh(id)) };
}

// ---------------------------------------------------------------- word trip

/**
 * The Word Trip Tournament: both players get the same letters, the same
 * stops, in the same order (all fixed by the match's seed). A stop is one set
 * of letters for `stopSec` (the event's `roundSec`, 60 s); a match is 3 stops,
 * the final 5, with a short card between stops. Round 1 deals 5 letters, the
 * middle rounds 6, the semi-finals and the final 7. The server checks every
 * word (the dictionary, the stop's letters, once per stop) and scores it with
 * Word Trip's own scoring; the higher total wins at the end of the last stop.
 * A tie replays at once on new letters (up to `maxReplays`), then the better
 * seed. Nobody joins in the window: absent, as for every game; one player: they
 * play their stops alone (started at once) and go through.
 */
export const WORD_TRIP = 'word-trip';
/** The card between two stops ("Stop 2 of 3"), in seconds. */
export const WT_GAP_SEC = 4;
/** After the last stop, how long a word sent in its last second is still taken. */
export const WT_GRACE_SEC = 3;
/** A tie replays this many seconds after it is decided (both are on the page already). */
export const WT_REPLAY_SEC = 8;
/** Words that are not words, per player per stop, before the rest are ignored (no brute force). */
export const WT_MAX_BAD = 60;
/** How far a word's own time (the page's) may trail its arrival here: a combo is never bought by holding words back. */
export const WT_LAG_MS = 3000;

/** Word Trip's scoring (game-pages/word-trip.html): by length, half again if rare, 150 more for every letter, times the combo. */
export const WT_VAL: Record<number, number> = { 3: 30, 4: 50, 5: 80, 6: 120, 7: 170, 8: 230 };
export const WT_FULL = 150;
export const WT_COMBO_WINDOW_MS = 8000;
export const WT_MAX_COMBO = 3;
export const wtWorth = (len: number, rare: boolean, full: boolean, combo: number) =>
  (Math.round((WT_VAL[len] ?? 0) * (rare ? 1.5 : 1)) + (full ? WT_FULL : 0)) * combo;

/** Letters per stop in a round: semi-finals and final 7, round 1 5, every other round 6. */
export function lettersFor(round: number, totalRounds: number): 5 | 6 | 7 {
  if (round === totalRounds || round === totalRounds - 1) return 7;
  if (round === 1) return 5;
  return 6;
}

/** Stops in a match: the final 5, every other match 3. */
export const stopsFor = (round: number, totalRounds: number) => (round === totalRounds ? 5 : 3);

/** A match's playing time, from its start to the end of its last stop, in seconds. */
export const wtPlaySec = (stops: number, stopSec: number) => stops * stopSec + Math.max(0, stops - 1) * WT_GAP_SEC;

/** Stop `k`'s window from the match's start: [from, to) in ms. */
export function stopWindow(startAt: Date, k: number, stopSec: number): { from: number; to: number } {
  const from = at(startAt) + k * (stopSec + WT_GAP_SEC) * 1000;
  return { from, to: from + stopSec * 1000 };
}

/** The stop on now (0-based), or -1 before the first, or `stops` after the last; `gap` when between two. */
export function stopAt(startAt: Date, now: Date, stops: number, stopSec: number): { k: number; gap: boolean } {
  const t = now.getTime() - at(startAt);
  if (!(t >= 0)) return { k: -1, gap: false };
  const span = (stopSec + WT_GAP_SEC) * 1000;
  const k = Math.floor(t / span);
  const gap = t - k * span >= stopSec * 1000;
  if (k >= stops || (k === stops - 1 && gap)) return { k: stops, gap: false };
  return { k, gap };
}

/** The bank (content/word-trip-cup.json, made by docs/word-trip-cup/gen_bank.mjs): space-separated lists. */
export interface WordTripBankFile {
  v: number;
  words: string;
  rare: string;
  stops: Record<string, string[]>;
}
export interface WordTripBank {
  common: Set<string>;
  rare: Set<string>;
  stops: Record<string, string[]>;
  /** Never valid, whatever the lists say (the lists already leave them out). */
  blocked: Set<string>;
}

/** Offensive words, refused even if a list ever held one (the bank's generator leaves the same out). */
export const WT_BLOCKED = new Set(
  ('anal anus arse arses ass asses balls bastard bitch bitches boner boob boobs bugger bum bums butt clit cock cocks coon crap cum cunt damn dick dicks ' +
    'dildo dyke fag fags fart farts fuck gook homo honky hooker horny hump jizz kike kinky milf nazi negro nigger nipple nude nudes orgasm orgy paki ' +
    'pee penis perv pimp piss poo poop porn porno prick pube pubes pubic queer rape raped rapes rapist retard scrotum semen sex sexy shag shit slut smut ' +
    'spic sperm spunk tit tits titty turd twat vagina wank whore wop').split(' '),
);

export function wordTripBank(file: WordTripBankFile): WordTripBank {
  return {
    common: new Set(file.words.split(' ').filter(Boolean)),
    rare: new Set(file.rare.split(' ').filter(Boolean)),
    stops: file.stops,
    blocked: WT_BLOCKED,
  };
}

/** Word Trip's own seeded generator (mulberry32), so a seed means the same letters wherever it is dealt. */
export function wtRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);

/** Whether `word` can be made from `letters`, each letter used at most as often as it is there. */
export function canSpell(word: string, letters: string): boolean {
  if (word.length > letters.length) return false;
  const have: Record<string, number> = {};
  for (const ch of letters) have[ch] = (have[ch] ?? 0) + 1;
  for (const ch of word) {
    if (!have[ch]) return false;
    have[ch] -= 1;
  }
  return true;
}

export interface WordTripStop {
  /** The letters as dealt (never spelling an all-letter word). */
  letters: string;
  /** The stop's letters, sorted (its key in the bank). */
  key: string;
}

/**
 * A match's stops: `count` different letter sets of `len` letters, from the
 * bank, by the match's seed (a walk with a stride coprime to the list, so no
 * set comes twice), each dealt in an order fixed by the seed and the stop.
 */
export function wordTripStops(bank: Pick<WordTripBank, 'stops' | 'common' | 'rare'>, seed: number, len: number, count: number): WordTripStop[] {
  const list = bank.stops[String(len)] ?? [];
  const n = list.length;
  if (!n) throw new Error(`No ${len}-letter Word Trip stops`);
  const r0 = wtRng(Math.trunc(seed) * 7919 + len * 104729 + 13);
  const start = Math.floor(r0() * n);
  let stride = n > 1 ? 1 + Math.floor(r0() * (n - 1)) : 1;
  while (n > 1 && gcd(stride, n) !== 1) stride = (stride % (n - 1)) + 1;
  const out: WordTripStop[] = [];
  for (let k = 0; k < count; k += 1) {
    const key = list[(start + k * stride) % n];
    const r = wtRng(Math.trunc(seed) * 15485863 + k * 32452843 + 7);
    const t = key.split('');
    for (let i = t.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [t[i], t[j]] = [t[j], t[i]];
    }
    const full = (w: string) => bank.common.has(w) || bank.rare.has(w);
    for (let turn = 0; turn < len && full(t.join('')); turn += 1) t.push(t.shift()!);
    out.push({ letters: t.join(''), key });
  }
  return out;
}

/** How many common words a stop's letters make (the page's "3 of 14 words"). */
export function commonCount(bank: Pick<WordTripBank, 'common'>, letters: string): number {
  let n = 0;
  for (const w of bank.common) if (w.length <= letters.length && canSpell(w, letters)) n += 1;
  return n;
}

/** A new seed for a replay whose first stop is other letters than the tied game's. */
export function newWordTripSeed(bank: Pick<WordTripBank, 'stops' | 'common' | 'rare'>, oldSeed: number, len: number, fresh: () => number): number {
  const was = wordTripStops(bank, oldSeed, len, 1)[0].key;
  for (let i = 0; i < 50; i += 1) {
    const seed = fresh();
    if (wordTripStops(bank, seed, len, 1)[0].key !== was) return seed;
  }
  return oldSeed + 1;
}

/** One player's stop as the server keeps it: the words taken (with what each paid), the combo, and the junk sent. */
export interface WtStopPlay {
  /** [word, points] in the order found. */
  found: [string, number][];
  score: number;
  combo: number;
  /** When the combo runs out, in ms from the stop's start. */
  comboUntil: number;
  /** The last word's time, in ms from the stop's start (never goes back). */
  lastT: number;
  bad: number;
}
export const emptyStop = (): WtStopPlay => ({ found: [], score: 0, combo: 1, comboUntil: 0, lastT: 0, bad: 0 });

export type WtVerdict =
  | { ok: true; word: string; pts: number; rare: boolean; full: boolean; combo: number; stopScore: number }
  | { ok: false; word: string; reason: 'short' | 'letters' | 'unknown' | 'again' | 'limit' | 'junk' };

/** A word as sent: lower case a-z only, else null. */
export function parseWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const w = raw.trim().toLowerCase();
  return /^[a-z]{1,12}$/.test(w) ? w : null;
}

/** The time a word counts at, in ms from its stop's start: the page's own, but never later than it arrived, nor more than WT_LAG_MS before. */
export function wordTime(claimed: unknown, arrivedMs: number, lastT: number): number {
  const c = typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : arrivedMs;
  return Math.max(lastT, Math.min(arrivedMs, Math.max(c, arrivedMs - WT_LAG_MS)));
}

/**
 * Checks one word on a stop and, when it counts, plays it (mutates `stop`):
 * 3 letters or more, made from the stop's letters (each at most as often as
 * dealt), in the dictionary (common or rare, never a blocked one), and not
 * already found on this stop. Points as Word Trip: by length, ×1.5 rare, +150
 * for every letter, times the combo (×1 → ×3 for words within 8 s).
 */
export function playWord(stop: WtStopPlay, letters: string, raw: unknown, tMs: number, bank: Pick<WordTripBank, 'common' | 'rare' | 'blocked'>): WtVerdict {
  const word = parseWord(raw);
  if (!word) return { ok: false, word: typeof raw === 'string' ? raw.slice(0, 12) : '', reason: 'junk' };
  if (stop.bad >= WT_MAX_BAD) return { ok: false, word, reason: 'limit' };
  const miss = (reason: 'short' | 'letters' | 'unknown' | 'again'): WtVerdict => {
    if (reason !== 'again') stop.bad += 1;
    return { ok: false, word, reason };
  };
  if (word.length < 3) return miss('short');
  if (!canSpell(word, letters)) return miss('letters');
  if (stop.found.some(([w]) => w === word)) return miss('again');
  if (bank.blocked.has(word)) return miss('unknown');
  const common = bank.common.has(word);
  const rare = !common && bank.rare.has(word);
  if (!common && !rare) return miss('unknown');
  const t = Math.max(stop.lastT, tMs);
  if (stop.found.length > 0 && t <= stop.comboUntil) stop.combo = Math.min(WT_MAX_COMBO, stop.combo + 1);
  else stop.combo = 1;
  stop.comboUntil = t + WT_COMBO_WINDOW_MS;
  stop.lastT = t;
  const full = word.length === letters.length;
  const pts = wtWorth(word.length, rare, full, stop.combo);
  stop.found.push([word, pts]);
  stop.score += pts;
  return { ok: true, word, pts, rare, full, combo: stop.combo, stopScore: stop.score };
}

/** A player's total over their stops. */
export const wtTotal = (stops: ({ score: number } | undefined)[] | undefined) => (stops ?? []).reduce((sum, s) => sum + (s?.score ?? 0), 0);

/**
 * A word trip match's next step. `match.live[p].score` is each player's server
 * total (the runtime's, merged in). Pure, like `nextStep`.
 *   open:  both in → start; window over → one in: solo, started at once
 *          (`startAt` set with it); nobody: the better seed, absent.
 *   live:  at the end of the last stop (+ grace): the higher total; equal
 *          replays (up to `maxReplays`), then the better seed.
 *   solo:  at the end of their stops (+ grace) the lone player goes through,
 *          with their score against 0, whether they stayed or not.
 */
export function nextWordTripStep(match: CupMatch, t: MatchTiming, now: Date, seedOf: (userId: string) => number, stops: number): MatchStep {
  const nowMs = now.getTime();
  const [a, b] = match.players;
  const absent = (): MatchStep => ({ kind: 'decide', winnerId: betterSeed(match, seedOf), decidedBy: 'absent', result: { [a]: 0, [b]: 0 } });
  const endsAt = (startAt: Date) => at(startAt) + (wtPlaySec(stops, t.roundSec) + WT_GRACE_SEC) * 1000;
  const scoreOf = (p: string) => match.live?.[p]?.score ?? 0;
  const soloNow = (userId: string): MatchStep => ({ kind: 'solo', userId, soloUntil: new Date(nowMs), startAt: new Date(nowMs + t.countdownSec * 1000) });
  switch (match.status) {
    case 'open': {
      const joined = match.players.filter((p) => match.joined?.[p]);
      if (joined.length === 2) return { kind: 'start', startAt: new Date(nowMs + t.countdownSec * 1000) };
      if (nowMs < at(match.deadlineAt)) return { kind: 'none' };
      if (joined.length === 1) return soloNow(joined[0]);
      return absent();
    }
    case 'live': {
      if (!match.startAt) return { kind: 'start', startAt: new Date(nowMs + t.countdownSec * 1000) };
      if (nowMs < endsAt(match.startAt)) return { kind: 'none' };
      const result = { [a]: scoreOf(a), [b]: scoreOf(b) };
      if (result[a] === result[b]) {
        if ((match.history?.length ?? 0) < t.maxReplays) return { kind: 'replay', scores: result };
        return { kind: 'decide', winnerId: betterSeed(match, seedOf), decidedBy: 'replays', result };
      }
      return { kind: 'decide', winnerId: result[a] > result[b] ? a : b, decidedBy: 'played', result };
    }
    case 'solo': {
      const lone = match.players.find((p) => match.joined?.[p]);
      if (!lone) return absent();
      const other = lone === a ? b : a;
      if (!match.startAt) return soloNow(lone);
      if (nowMs < endsAt(match.startAt)) return { kind: 'none' };
      return { kind: 'decide', winnerId: lone, decidedBy: 'solo', result: { [lone]: scoreOf(lone), [other]: 0 } };
    }
    default:
      return { kind: 'none' };
  }
}

/** Whether a word from `userId` on stop `k` is taken now: their match, in play, that stop on (with a little slack for the trip here). */
export function mayPlayWord(match: CupMatch, userId: string, k: unknown, stops: number, stopSec: number, now: Date): Refusal | { ok: true; k: number } {
  if (!match.players.includes(userId)) return no(403, 'This is not your match');
  if ((match.status !== 'live' && match.status !== 'solo') || !match.startAt) return no(409, 'Your match is not on');
  if (match.status === 'solo' && !match.joined?.[userId]) return no(409, 'Your match is not on');
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= stops) return no(400, 'Which stop?');
  const w = stopWindow(match.startAt, k, stopSec);
  const nowMs = now.getTime();
  if (nowMs < w.from - 1000) return no(409, 'That stop has not started');
  if (nowMs > w.to + 2000) return no(409, 'Time is up on that stop');
  return { ok: true, k };
}
