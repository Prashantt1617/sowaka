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
 * The Word Trip Tournament (27 Nov 2026): a match is one normal Word Trip
 * run each, the same for both players (one seed: the same stops in the same
 * order), played in the normal game itself (game-pages/word-trip.html, in the
 * tournament page). Its rules, as that page plays them: one clock from 1:00;
 * a word of 5 letters or more adds seconds (TIMEB), one with every letter 3
 * more (FULL_TIME), up to MAX_ADDED in a run; points by length, half again if
 * rare, FULL more for every letter, times the combo (×1 → ×MAXCOMBO for words
 * within COMBO_WINDOW of the last); every letter used moves to the next stop
 * a moment later; Skip moves on for SKIP_COST points. A player's run ends when
 * their clock runs out; the higher final score wins, a tie replays at once on
 * a new seed (up to `maxReplays`), then the better seed. Nobody joins: absent,
 * as for every game; one player: they play their run alone and go through.
 *
 * The page sends every word it took (and every skip) with its stop and its
 * time on the run's clock; the server plays them again here, against the same
 * stops and lists (`WtBoards`, from the same page) and these rules, and the
 * match is decided on the server's score, never the page's.
 */
export const WORD_TRIP = 'word-trip';
/** After a player's clock should have run out, how long their last words are still taken (a slow phone, a late start). */
export const WT_GRACE_SEC = 8;
/** A tie replays this many seconds after it is decided (both are on the page already). */
export const WT_REPLAY_SEC = 8;
/** Words that are not taken, per run, before the rest are ignored (no brute force). */
export const WT_MAX_BAD = 120;
/** How far a word's own time (the run's clock) may trail its arrival here (a dropped connection, its words sent when back): further back, it counts from then. */
export const WT_LAG_SEC = 20;
/** A word's time may run ahead of its arrival by this much (the page's clock and the server's are a little apart). */
export const WT_AHEAD_SEC = 1.5;
/** Two words closer than this are not a person swiping. */
export const WT_MIN_GAP_SEC = 0.3;
/** The next stop shows this long after an all-letter word (WT_PAUSE) or a skip (WT_SKIP_PAUSE), less the page's quicker reduced-motion pause. */
export const WT_PAUSE_SEC = 0.5;
export const WT_SKIP_PAUSE_SEC = 0.7;
const WT_PAUSE_SLACK_SEC = 0.45;

/** Word Trip's own numbers (read from its page; these are what it says today). */
export interface WtRules {
  ROUND: number;
  VAL: Record<number, number>;
  FULL: number;
  COMBO_WINDOW: number;
  MAXCOMBO: number;
  TIMEB: Record<number, number>;
  FULL_TIME: number;
  MAX_ADDED: number;
  SKIP_COST: number;
}
export const WT_DEFAULT_RULES: WtRules = {
  ROUND: 60,
  VAL: { 3: 30, 4: 50, 5: 80, 6: 120, 7: 170, 8: 230 },
  FULL: 150,
  COMBO_WINDOW: 8,
  MAXCOMBO: 3,
  TIMEB: { 5: 2, 6: 3, 7: 4, 8: 5 },
  FULL_TIME: 3,
  MAX_ADDED: 30,
  SKIP_COST: 100,
};
/** What a word pays: Word Trip's worthOf. */
export const wtWorth = (r: WtRules, len: number, rare: boolean, full: boolean, combo: number) =>
  (Math.round((r.VAL[len] ?? 0) * (rare ? 1.5 : 1)) + (full ? r.FULL : 0)) * combo;
/** The longest a run can last, in seconds: the clock and every second it can earn. */
export const wtLongestSec = (r: WtRules) => r.ROUND + r.MAX_ADDED;

/** Offensive words: never a word in the tournament, on the page or here, whatever Word Trip's lists hold. */
export const WT_BLOCKED = new Set(
  ('anal anus arse arses ass asses balls bastard bitch bitches boner boob boobs bugger bum bums butt clit cock cocks coon crap cum cunt damn dick dicks ' +
    'dildo dyke fag fags fart farts fuck gook homo honky hooker horny hump jizz kike kinky milf nazi negro nigger nipple nude nudes orgasm orgy paki ' +
    'pee penis perv pimp piss poo poop porn porno prick pube pubes pubic queer rape raped rapes rapist retard scrotum semen sex sexy shag shit slut smut ' +
    'spic sperm spunk tit tits titty turd twat vagina wank whore wop').split(' '),
);

/** One stop, as the page deals it: its letters, and the words it takes (common and rare, never a blocked one). */
export interface WtStop {
  g: number;
  len: number;
  letters: string;
  words: Set<string>;
  rare: Set<string>;
}
/** The stops of a seed: Word Trip's own `boardAt(seed, g)`. */
export type WtBoards = (seed: number, g: number) => WtStop;

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

/** A word as sent: lower case a-z only, else null. */
export function parseWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const w = raw.trim().toLowerCase();
  return /^[a-z]{1,12}$/.test(w) ? w : null;
}

/** A run's event, as kept: a word ['w', stop, word, t, pts] or a skip ['s', stop, t]; t in seconds on the run's clock. */
export type WtEvent = ['w', number, string, number, number] | ['s', number, number];

/** A player's run as the server has played it. */
export interface WtRun {
  /** The stop they are on. */
  gi: number;
  score: number;
  combo: number;
  comboUntil: number;
  /** Words taken in the whole run (the combo needs one before it). */
  total: number;
  /** Seconds the clock has earned. */
  added: number;
  /** The last word's time. */
  lastT: number;
  /** When the stop they are on showed (seconds). */
  stopFrom: number;
  /** Words taken per stop, [word, points]. */
  found: [string, number][][];
  skips: number;
  bad: number;
  events: WtEvent[];
}
export const newRun = (): WtRun => ({ gi: 0, score: 0, combo: 1, comboUntil: 0, total: 0, added: 0, lastT: 0, stopFrom: 0, found: [[]], skips: 0, bad: 0, events: [] });
/** When the run's clock runs out, in seconds from its start. */
export const runEndsSec = (run: Pick<WtRun, 'added'> | undefined, r: WtRules) => r.ROUND + (run?.added ?? 0);

export type WtVerdict =
  | { ok: true; word: string; pts: number; rare: boolean; full: boolean; combo: number; added: number; gi: number; score: number }
  | { ok: false; word: string; reason: 'short' | 'letters' | 'unknown' | 'again' | 'limit' | 'junk' | 'stop' | 'time' | 'early' | 'fast' };

/** The time a word counts at: the run's clock as the page sent it, never ahead of its arrival (`arrived`, the same clock here) nor more than WT_LAG_SEC behind it. */
export function wordTime(claimed: unknown, arrived: number): number {
  const c = typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : arrived;
  return Math.max(0, Math.min(arrived + WT_AHEAD_SEC, Math.max(c, arrived - WT_LAG_SEC)));
}

/**
 * One word of a run, checked and played (mutates `run` when it counts): on
 * the stop the run is on, inside the run's clock, not before that stop showed,
 * not faster than a person swipes; 3 letters or more, from the stop's letters
 * (each at most as often as dealt), in its lists (never a blocked word), not
 * already found on that stop. Then Word Trip's points, combo and seconds; every
 * letter used moves the run to the next stop.
 */
export function playRunWord(run: WtRun, stop: WtStop, g: unknown, raw: unknown, t: number, r: WtRules): WtVerdict {
  const word = parseWord(raw);
  if (!word) return { ok: false, word: typeof raw === 'string' ? raw.slice(0, 12) : '', reason: 'junk' };
  if (run.bad >= WT_MAX_BAD) return { ok: false, word, reason: 'limit' };
  const miss = (reason: 'short' | 'letters' | 'unknown' | 'again' | 'stop' | 'time' | 'early' | 'fast'): WtVerdict => {
    run.bad += 1;
    return { ok: false, word, reason };
  };
  if (g !== run.gi || stop.g !== run.gi) return miss('stop');
  if (t > runEndsSec(run, r) + 0.75) return miss('time');
  if (t < run.stopFrom - WT_PAUSE_SLACK_SEC) return miss('early');
  const at = Math.max(t, run.lastT);
  if (run.total > 0 && at - run.lastT < WT_MIN_GAP_SEC) return miss('fast');
  if (word.length < 3) return miss('short');
  if (!canSpell(word, stop.letters)) return miss('letters');
  if ((run.found[run.gi] ?? []).some(([w]) => w === word)) return miss('again');
  if (WT_BLOCKED.has(word)) return miss('unknown');
  const common = stop.words.has(word);
  const rare = !common && stop.rare.has(word);
  if (!common && !rare) return miss('unknown');
  if (at <= run.comboUntil && run.total > 0) run.combo = Math.min(r.MAXCOMBO, run.combo + 1);
  else run.combo = 1;
  run.comboUntil = at + r.COMBO_WINDOW;
  run.lastT = at;
  const full = word.length === stop.len;
  const pts = wtWorth(r, word.length, rare, full, run.combo);
  run.score += pts;
  run.total += 1;
  const tb = Math.min(r.MAX_ADDED - run.added, (r.TIMEB[word.length] ?? 0) + (full ? r.FULL_TIME : 0));
  if (tb > 0) run.added += tb;
  (run.found[run.gi] ??= []).push([word, pts]);
  run.events.push(['w', run.gi, word, at, pts]);
  const combo = run.combo;
  if (full) {
    run.gi += 1;
    run.stopFrom = at + WT_PAUSE_SEC;
    run.found[run.gi] = [];
  }
  return { ok: true, word, pts, rare, full, combo, added: run.added, gi: run.gi, score: run.score };
}

/** A skip: only on the stop the run is on, inside its clock, with SKIP_COST points to pay. */
export function playRunSkip(run: WtRun, g: unknown, t: number, r: WtRules): { ok: true; gi: number; score: number } | { ok: false; reason: 'stop' | 'time' | 'points' } {
  if (g !== run.gi) return { ok: false, reason: 'stop' };
  if (t > runEndsSec(run, r) + 0.75) return { ok: false, reason: 'time' };
  if (run.score < r.SKIP_COST) return { ok: false, reason: 'points' };
  const at = Math.max(t, run.lastT);
  run.score -= r.SKIP_COST;
  run.skips += 1;
  run.lastT = at;
  run.events.push(['s', run.gi, at]);
  run.gi += 1;
  run.stopFrom = at + WT_SKIP_PAUSE_SEC;
  run.found[run.gi] = [];
  return { ok: true, gi: run.gi, score: run.score };
}

/** A run back from its events (as kept on the match), played again from the start: the same checks, the same result. */
export function replayRun(events: unknown, boards: WtBoards, seed: number, r: WtRules): WtRun {
  const run = newRun();
  if (!Array.isArray(events)) return run;
  for (const e of events) {
    if (!Array.isArray(e)) continue;
    if (e[0] === 'w') playRunWord(run, boards(seed, run.gi), e[1], e[2], Number(e[3]) || 0, r);
    else if (e[0] === 's') playRunSkip(run, e[1], Number(e[2]) || 0, r);
  }
  return run;
}

/**
 * A word trip match's next step. `match.live[p]` is each player's run as the
 * server played it (`score`, and `wtAdded`, the seconds their clock earned).
 * Pure, like `nextStep`.
 *   open:  both in → start; window over → one in: solo, started at once;
 *          nobody: the better seed, absent.
 *   live:  once both clocks have run out (each player's 1:00 + what it earned,
 *          + a moment for the last word): the higher score; equal replays (up to
 *          `maxReplays`), then the better seed.
 *   solo:  once the lone player's clock has run out, they go through.
 */
export function nextWordTripStep(match: CupMatch, t: MatchTiming, now: Date, seedOf: (userId: string) => number, r: WtRules = WT_DEFAULT_RULES): MatchStep {
  const nowMs = now.getTime();
  const [a, b] = match.players;
  const absent = (): MatchStep => ({ kind: 'decide', winnerId: betterSeed(match, seedOf), decidedBy: 'absent', result: { [a]: 0, [b]: 0 } });
  const scoreOf = (p: string) => match.live?.[p]?.score ?? 0;
  const over = (p: string) => !!match.startAt && nowMs >= at(match.startAt) + (r.ROUND + (match.live?.[p]?.wtAdded ?? 0) + WT_GRACE_SEC) * 1000;
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
      if (!over(a) || !over(b)) return { kind: 'none' };
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
      if (!over(lone)) return { kind: 'none' };
      return { kind: 'decide', winnerId: lone, decidedBy: 'solo', result: { [lone]: scoreOf(lone), [other]: 0 } };
    }
    default:
      return { kind: 'none' };
  }
}

/** Whether a word (or a skip) from `userId` is taken now: their match, in play, their run's clock not yet out (+ a moment). */
export function mayPlayWord(match: CupMatch, userId: string, run: Pick<WtRun, 'added'> | undefined, now: Date, r: WtRules = WT_DEFAULT_RULES): Refusal | { ok: true; arrived: number } {
  if (!match.players.includes(userId)) return no(403, 'This is not your match');
  if ((match.status !== 'live' && match.status !== 'solo') || !match.startAt) return no(409, 'Your match is not on');
  if (match.status === 'solo' && !match.joined?.[userId]) return no(409, 'Your match is not on');
  const arrived = (now.getTime() - at(match.startAt)) / 1000;
  if (arrived < -2) return no(409, 'Your run has not started');
  if (arrived > runEndsSec(run, r) + WT_GRACE_SEC + WT_LAG_SEC) return no(409, 'Your time is up');
  return { ok: true, arrived };
}

// ---------------------------------------------------------------- the qualifier (Word Trip, 27 Nov 2026)

/**
 * Round 1 is a qualifier: everyone in the lobby plays a normal Word Trip run
 * on letters of their own (a seed per player per attempt), twice; their best
 * counts. Attempt 1 opens at the start for everyone (a start window); attempt
 * 2 opens for everyone in the lobby once attempt 1 is over, late joiners
 * included (attempt 2 only). The top P go on, P the largest power of two not
 * above the number who played; they are ranked by best, then the two
 * attempts combined; a tie across the cut is played off with one extra run
 * each, then the all-time Word Trip best, then a fixed order. The ranks pair
 * the bracket: 1 v P, 2 v P-1, … (a standard seeded bracket, 1 and 2 only in
 * the final).
 */
export type QualStage = 'a1' | 'a2' | 'extra';

/** The largest power of two not above n (0 for none). */
export const qualifierCut = (n: number) => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

/** One player's qualifier: their attempts' scores (null: not played), the extra run's, their all-time best, and a fixed order. */
export interface QualEntry {
  userId: string;
  /** Attempt 1 and 2: a number once played (started), null otherwise. */
  attempts: [number | null, number | null];
  /** The tie-break run, when they had one. */
  extra?: number | null;
  /** Their all-time Word Trip best before the event (the Games tab's), null for none. */
  allTimeBest?: number | null;
  /** The last word of the order: their place in the lobby (earlier first). */
  order: number;
}
export const qualBest = (e: Pick<QualEntry, 'attempts'>) => Math.max(e.attempts[0] ?? -1, e.attempts[1] ?? -1);
export const qualCombined = (e: Pick<QualEntry, 'attempts'>) => (e.attempts[0] ?? 0) + (e.attempts[1] ?? 0);
export const qualPlayed = (e: Pick<QualEntry, 'attempts'>) => e.attempts[0] != null || e.attempts[1] != null;

export interface QualResult {
  /** Everyone who played, in rank order (rank = index + 1). */
  ranked: string[];
  /** How many go on. */
  cut: number;
  /** Those tied across the cut who must play the extra run first (empty when the ranking is settled). */
  needExtra: string[];
  /** How many of the cut's places the tied group shares. */
  spots: number;
}

/**
 * The qualifier's ranking. Best first, then combined; the group tied across
 * the cut (same best and combined, some inside and some outside) is ordered by
 * its extra run once played (or needs one: `needExtra`), then all-time best,
 * then the lobby order. Ties elsewhere use the same order without an extra run.
 */
export function rankQualifier(entries: QualEntry[], extraPlayed: boolean): QualResult {
  const played = entries.filter(qualPlayed);
  const cut = qualifierCut(played.length);
  const key = (e: QualEntry) => `${qualBest(e)}:${qualCombined(e)}`;
  const base = (x: QualEntry, y: QualEntry) => qualBest(y) - qualBest(x) || qualCombined(y) - qualCombined(x);
  const rest = (x: QualEntry, y: QualEntry) => (y.allTimeBest ?? -1) - (x.allTimeBest ?? -1) || x.order - y.order || (x.userId < y.userId ? -1 : 1);
  const sorted = played.slice().sort((x, y) => base(x, y) || rest(x, y));
  let needExtra: string[] = [];
  let spots = 0;
  if (cut > 0 && sorted.length > cut && key(sorted[cut - 1]) === key(sorted[cut])) {
    const k = key(sorted[cut]);
    const group = sorted.filter((e) => key(e) === k);
    const first = sorted.findIndex((e) => key(e) === k);
    spots = cut - first;
    if (!extraPlayed) needExtra = group.map((e) => e.userId);
    else {
      const ordered = group.slice().sort((x, y) => (y.extra ?? -1) - (x.extra ?? -1) || rest(x, y));
      sorted.splice(first, group.length, ...ordered);
    }
  }
  return { ranked: sorted.map((e) => e.userId), cut, needExtra, spots };
}

/** Whether someone may start an attempt now: in the lobby, the attempt open (its window), and for attempt 1 in the lobby by then; the extra run only for the tied. */
export function mayJoinAttempt(
  q: { stage: QualStage; openedAt: Date; windowSec: number; extraUserIds?: string[] },
  userId: string,
  lobbyJoinedAt: Date | null,
  already: boolean,
  now: Date,
): Verdict {
  if (!lobbyJoinedAt) return no(403, 'Join the lobby to play the qualifier');
  if (already) return yes;
  const closes = at(q.openedAt) + q.windowSec * 1000;
  if (now.getTime() >= closes) return no(409, 'Too late: this attempt has closed');
  if (q.stage === 'a1' && lobbyJoinedAt.getTime() > closes) return no(409, 'Too late for attempt 1: attempt 2 is yours');
  if (q.stage === 'extra' && !(q.extraUserIds ?? []).includes(userId)) return no(409, 'The tie-break run is only for the players tied at the cut');
  return yes;
}

/** When an attempt is surely over: its window, the countdown, the longest run, and the grace for the last words (ms). */
export const attemptCapAt = (openedAt: Date, windowSec: number, countdownSec: number, r: WtRules = WT_DEFAULT_RULES) =>
  at(openedAt) + (windowSec + countdownSec + wtLongestSec(r) + WT_GRACE_SEC) * 1000;

/** A bracket round's name after a qualifier: Final, Semi-finals, Quarter-finals, else "Round of N". */
export function bracketRoundName(n: number, total: number, nodes: number): { label: string; short: string } {
  const named = roundName(n, total, nodes);
  if (named.short === 'F' || named.short === 'SF' || named.short === 'QF') return named;
  return { label: `Round of ${nodes * 2}`, short: `R${nodes * 2}` };
}

/** The first name only (the public screens show no full names). */
export const firstNameOf = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'Player';
