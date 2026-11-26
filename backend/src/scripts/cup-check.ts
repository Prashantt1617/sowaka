/**
 * The Diwali Cup's rules on their own, no database:
 *   npx tsx src/scripts/cup-check.ts
 */
import assert from 'node:assert/strict';
import type { CupMatch, CupRound } from '../models/cup.model';
import knightsBank from '../content/knights-boards.json';
import {
  DEFAULT_CUP_CONFIG,
  gridFor,
  isSolved,
  knightsBoardFor,
  newKnightsSeed,
  parseKnights,
  resignStep,
  rightOf,
  type KnightsBank,
  bracketOrder,
  buildDraw,
  buildPyramidDraw,
  mayBet,
  mayJoin,
  mayScore,
  nextStep,
  parseLiveBoard,
  parseRef,
  seedOrderOf,
  WT_BLOCKED,
  WT_DEFAULT_RULES,
  WT_GRACE_SEC,
  lobbyPresent,
  mayPlayWord,
  newRun,
  nextWordTripStep,
  playRunSkip,
  playRunWord,
  replayRun,
  runEndsSec,
  wordTime,
  wtLongestSec,
  type WtStop,
} from '../services/cup-rules';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadWordTripGame } from '../services/cup-wordtrip-game';


let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`ok  ${name}`);
}

/** Plays a whole draw: `win(a, b)` picks the winner by seeds. Returns each round's players and the champion. */
function play(rounds: CupRound[], entrants: number, win: (a: number, b: number) => number) {
  const winners = new Map<string, number>();
  const holder = (ref: string): number => {
    const p = parseRef(ref)!;
    if (p.kind === 'e') return p.seed;
    const v = winners.get(ref);
    assert.ok(v !== undefined, `place ${ref} played before it was decided`);
    return v;
  };
  const meetings: { round: number; a: number; b: number }[] = [];
  let matches = 0;
  for (const round of rounds) {
    for (const node of round.nodes) {
      const ref = `n:${round.n}:${node.slot}`;
      if (node.feeders.length === 1) winners.set(ref, holder(node.feeders[0]));
      else {
        const [a, b] = node.feeders.map(holder);
        meetings.push({ round: round.n, a, b });
        winners.set(ref, win(a, b));
        matches += 1;
      }
    }
  }
  const last = rounds[rounds.length - 1];
  return { champion: winners.get(`n:${last.n}:1`)!, meetings, matches, entrants };
}
const favourite = (a: number, b: number) => Math.min(a, b);

check('bracket order is the standard one', () => {
  assert.deepEqual(bracketOrder(2), [1, 2]);
  assert.deepEqual(bracketOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

check('226 entrants: 113 in round 1, 15 free passes and 49 matches in round 2, then 64', () => {
  const rounds = buildDraw(226, 8);
  assert.equal(rounds.length, 8);
  assert.equal(rounds[0].nodes.length, 113);
  assert.ok(rounds[0].nodes.every((n) => n.feeders.length === 2));
  assert.deepEqual(rounds[0].nodes[0].feeders, ['e:1', 'e:226']);
  assert.deepEqual(rounds[0].nodes[112].feeders, ['e:113', 'e:114']);
  const second = rounds[1];
  assert.equal(second.nodes.length, 64);
  assert.equal(second.nodes.filter((n) => n.feeders.length === 1).length, 15);
  assert.equal(second.nodes.filter((n) => n.feeders.length === 2).length, 49);
  assert.deepEqual(second.nodes[15].feeders, ['n:1:16', 'n:1:113']);
  assert.deepEqual(second.nodes[63].feeders, ['n:1:64', 'n:1:65']);
  assert.deepEqual(rounds.map((r) => r.nodes.length), [113, 64, 32, 16, 8, 4, 2, 1]);
  assert.deepEqual(rounds.map((r) => r.kind), ['parallel', 'parallel', 'parallel', 'parallel', 'parallel', 'sequential', 'sequential', 'sequential']);
  assert.deepEqual(rounds.slice(5).map((r) => r.short), ['QF', 'SF', 'F']);
});

check('seeding holds: with favourites winning, 1 v 2 in the final, top 4 in the semis, top 8 in the quarters', () => {
  const rounds = buildDraw(226, 8);
  const { champion, meetings } = play(rounds, 226, favourite);
  assert.equal(champion, 1);
  const inRound = (n: number) => meetings.filter((m) => m.round === n).flatMap((m) => [m.a, m.b]).sort((x, y) => x - y);
  assert.deepEqual(inRound(8), [1, 2]);
  assert.deepEqual(inRound(7), [1, 2, 3, 4]);
  assert.deepEqual(inRound(6), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Whoever wins anything, two of the top eight never meet before the quarter-finals.
  for (let trial = 0; trial < 200; trial += 1) {
    const { meetings: any } = play(rounds, 226, (a, b) => (Math.random() < 0.5 ? a : b));
    const early = any.filter((m) => m.round < 6 && m.a <= 8 && m.b <= 8);
    // Only possible if a top-8 seed's place was taken by an upset: the places, not the people, are what is seeded.
    for (const m of early) assert.fail(`seeds ${m.a} and ${m.b} met in round ${m.round}`);
  }
});

check('the top seeds hold the round-2 free passes', () => {
  const rounds = buildDraw(226, 8);
  const passes = rounds[1].nodes.filter((n) => n.feeders.length === 1).map((n) => n.feeders[0]);
  assert.deepEqual(passes, Array.from({ length: 15 }, (_, i) => `n:1:${i + 1}`));
});

check('every size from 2 to 300 makes one champion in N-1 matches, each entrant out once', () => {
  for (let n = 2; n <= 300; n += 1) {
    for (const topN of [4, 8]) {
      const rounds = buildDraw(n, topN);
      const { champion, meetings, matches } = play(rounds, n, (a, b) => (Math.random() < 0.5 ? a : b));
      assert.equal(matches, n - 1, `N=${n}`);
      const lost = new Set(meetings.map((m) => (m.a === champion ? m.b : m.b === champion ? m.a : null)).filter((x) => x !== null));
      assert.ok(!lost.has(champion));
      const seen = new Set<number>();
      for (const m of meetings) for (const p of [m.a, m.b]) seen.add(p);
      assert.equal(seen.size, n, `N=${n}: everyone plays at least once (seed 1 too, after any pass)`);
      // Free passes only in round 1 (one, odd N) and round 2.
      rounds.forEach((r, i) => {
        const passes = r.nodes.filter((x) => x.feeders.length === 1).length;
        if (i === 0) assert.equal(passes, n % 2, `N=${n}`);
        else if (i > 1) assert.equal(passes, 0, `N=${n} round ${r.n}`);
      });
      const round1 = rounds[0];
      assert.equal(round1.nodes.filter((x) => x.feeders.length === 2).length, Math.floor(n / 2), 'round 1 is everyone');
      // Sequential from topN players down.
      for (const r of rounds) {
        const players = r.nodes.reduce((s, x) => s + x.feeders.length, 0);
        assert.equal(r.kind, players <= topN ? 'sequential' : 'parallel');
      }
    }
  }
});

/** The earliest round two seeds could meet in, whatever happens: where their paths through the draw first join. */
function meetRound(rounds: CupRound[], s1: number, s2: number): number {
  const path = (seed: number) => {
    const out = new Map<string, number>();
    let ref = `e:${seed}`;
    for (const round of rounds) {
      const node = round.nodes.find((x) => x.feeders.includes(ref));
      if (!node) break;
      ref = `n:${round.n}:${node.slot}`;
      out.set(ref, node.feeders.length === 2 ? round.n : Number.POSITIVE_INFINITY);
    }
    return out;
  };
  const a = path(s1);
  const b = path(s2);
  for (const [ref, n] of a) if (b.has(ref)) return n;
  return Number.POSITIVE_INFINITY;
}

check('every size 2..300, every topN: 1 v 2 only in the final, top 4 not before the semis (8+ entrants), top 8 not before the quarters (16+)', () => {
  for (let n = 2; n <= 300; n += 1) {
    for (const topN of [2, 4, 8, 16]) {
      const rounds = buildDraw(n, topN);
      const total = rounds.length;
      assert.equal(rounds[total - 1].nodes.length, 1, `N=${n}: one final`);
      assert.equal(rounds[total - 1].short, 'F', `N=${n}`);
      for (let i = 1; i <= Math.min(8, n); i += 1) {
        for (let j = i + 1; j <= Math.min(8, n); j += 1) {
          const r = meetRound(rounds, i, j);
          // Round 1 is everyone, top half v bottom half: with fewer than 2k entrants two of the top k must meet in it.
          if (j > 2 && n < 2 * (j <= 4 ? 4 : 8)) continue;
          const limit = j <= 2 ? total : j <= 4 ? total - 1 : total - 2;
          assert.ok(r >= limit && r <= total, `N=${n}: seeds ${i} and ${j} could meet in round ${r} of ${total}`);
        }
      }
      // Free passes: round 1 only seed 1 (odd N); round 2 the units of the top seeds, each keeping its place.
      const second = rounds[1];
      if (second) {
        const passes = second.nodes.filter((x) => x.feeders.length === 1);
        passes.forEach((node, k) => assert.deepEqual(node.feeders, [`n:1:${k + 1}`], `N=${n}`));
        const players = second.nodes.reduce((sum, x) => sum + x.feeders.length, 0);
        if (passes.length) assert.equal(players, Math.ceil(n / 2), `N=${n}: round 2 is every round-1 survivor`);
        assert.equal(second.nodes.length & (second.nodes.length - 1), 0, `N=${n}: round 2 leaves a power of two`);
      }
      // Each later round halves; labels F/SF/QF only where they belong.
      for (let k = 2; k < total; k += 1) assert.equal(rounds[k].nodes.length * 2, rounds[k - 1].nodes.length, `N=${n} round ${k + 1}`);
      rounds.forEach((r) => {
        if (r.short === 'SF') assert.ok(r.n === total - 1 && r.nodes.length === 2);
        if (r.short === 'QF') assert.ok(r.n === total - 2 && r.nodes.length === 4);
      });
    }
  }
});

check('226 random tournaments: no two of the top 8 meet before the quarter-finals, the top 4 before the semis, 1 and 2 before the final', () => {
  const rounds = buildDraw(226, 8);
  for (let trial = 0; trial < 2000; trial += 1) {
    const { meetings, champion } = play(rounds, 226, (a, b) => (Math.random() < 0.5 ? a : b));
    assert.ok(champion >= 1 && champion <= 226);
    for (const m of meetings) {
      const lo = Math.min(m.a, m.b);
      const hi = Math.max(m.a, m.b);
      if (hi <= 2) assert.equal(m.round, 8);
      else if (hi <= 4) assert.ok(m.round >= 7, `${lo} v ${hi} in round ${m.round}`);
      else if (hi <= 8) assert.ok(m.round >= 6, `${lo} v ${hi} in round ${m.round}`);
    }
  }
});

check('33 entrants: seed 1 skips round 1, then 15 free passes to 16', () => {
  const rounds = buildDraw(33, 8);
  assert.deepEqual(rounds[0].nodes[0].feeders, ['e:1']);
  assert.deepEqual(rounds[0].nodes[1].feeders, ['e:2', 'e:33']);
  assert.equal(rounds[1].nodes.length, 16);
  assert.equal(rounds[1].nodes.filter((n) => n.feeders.length === 1).length, 15);
});

check('seed order: best first, no score last, lucky draw between equals', () => {
  const people = [
    { userId: 'a', name: 'A', best: 100 },
    { userId: 'b', name: 'B', best: null },
    { userId: 'c', name: 'C', best: 900 },
    { userId: 'd', name: 'D', best: 100 },
    { userId: 'e', name: 'E', best: null },
  ];
  for (let i = 0; i < 20; i += 1) {
    const order = seedOrderOf(people, 'leaderboard').map((p) => p.userId);
    assert.equal(order[0], 'c');
    assert.deepEqual(order.slice(1, 3).sort(), ['a', 'd']);
    assert.deepEqual(order.slice(3).sort(), ['b', 'e']);
  }
  const lucky = new Set<string>();
  for (let i = 0; i < 60; i += 1) lucky.add(seedOrderOf(people, 'lucky')[0].userId);
  assert.ok(lucky.size > 1);
});

// ---------------------------------------------------------------- a match

const T = { ...DEFAULT_CUP_CONFIG, startWindowSec: 180, soloStartSec: 90, roundSec: 45, finishGraceSec: 25, minPlaySec: 25, maxReplays: 2, countdownSec: 4 };
const t0 = new Date('2026-10-23T12:00:00Z').getTime();
const at = (sec: number) => new Date(t0 + sec * 1000);
const seeds: Record<string, number> = { hi: 3, lo: 40 };
const seedOf = (u: string) => seeds[u] ?? 999;
function match(over: Partial<CupMatch>): CupMatch {
  return {
    id: 'e-r1-m1', eventId: 'e', org: 'sowaka', round: 1, slot: 1, label: 'Round 1 · Match 1', kind: 'parallel',
    players: ['hi', 'lo'], status: 'open', seed: 7, attempt: 0, openedAt: at(0), deadlineAt: at(180),
    joined: {}, live: {}, finals: {}, createdAt: at(0), updatedAt: at(0), ...over,
  };
}
const sc = (score: number, sec = 50) => ({ score, at: at(sec) });

check('nobody comes: the better seed goes through as absent, 0 v 0', () => {
  assert.deepEqual(nextStep(match({}), T, at(100), seedOf), { kind: 'none' });
  assert.deepEqual(nextStep(match({}), T, at(180), seedOf), { kind: 'decide', winnerId: 'hi', decidedBy: 'absent', result: { hi: 0, lo: 0 } });
});

check('one comes: they play alone, their score against 0', () => {
  const m = match({ joined: { lo: at(10) } });
  const step = nextStep(m, T, at(181), seedOf);
  assert.equal(step.kind, 'solo');
  const solo = match({ status: 'solo', joined: { lo: at(10) }, soloUntil: at(271) });
  assert.deepEqual(nextStep(solo, T, at(200), seedOf), { kind: 'none' });
  // Never started: both absent, so the better seed (who did not come!) goes through, as the rule says.
  assert.equal((nextStep(solo, T, at(271), seedOf) as { winnerId: string }).winnerId, 'hi');
  const started = { ...solo, startAt: at(205) };
  assert.deepEqual(nextStep(started, T, at(240), seedOf), { kind: 'none' });
  assert.deepEqual(nextStep({ ...started, finals: { lo: sc(1200, 251) } }, T, at(251), seedOf), { kind: 'decide', winnerId: 'lo', decidedBy: 'solo', result: { lo: 1200, hi: 0 } });
  // Started and never scored: absent.
  assert.equal((nextStep(started, T, at(205 + 70), seedOf) as { decidedBy: string }).decidedBy, 'absent');
  // Started, played a while, dropped out: their best live score stands against 0.
  assert.equal(nextStep({ ...started, live: { lo: sc(640, 230) } }, T, at(205 + 69), seedOf).kind, 'none');
  assert.deepEqual(nextStep({ ...started, live: { lo: sc(640, 230) } }, T, at(205 + 70), seedOf), { kind: 'decide', winnerId: 'lo', decidedBy: 'solo', result: { lo: 640, hi: 0 } });
  // A final lower than their best live score: the best counts.
  assert.deepEqual(nextStep({ ...started, live: { lo: sc(900, 230) }, finals: { lo: sc(300, 251) } }, T, at(251), seedOf), { kind: 'decide', winnerId: 'lo', decidedBy: 'solo', result: { lo: 900, hi: 0 } });
});

check('both come: decided when both finals are in, higher wins', () => {
  const live = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13) });
  assert.equal(nextStep({ ...live, finals: { hi: sc(900) } }, T, at(60), seedOf).kind, 'none');
  assert.deepEqual(nextStep({ ...live, finals: { hi: sc(900), lo: sc(1300) } }, T, at(60), seedOf), { kind: 'decide', winnerId: 'lo', decidedBy: 'played', result: { hi: 900, lo: 1300 } });
});

check('a player who drops out mid-round: their last live score stands when the round is over', () => {
  const live = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), finals: { hi: sc(700) }, live: { hi: sc(700), lo: sc(820, 40) } });
  assert.equal(nextStep(live, T, at(13 + 69), seedOf).kind, 'none');
  assert.deepEqual(nextStep(live, T, at(13 + 70), seedOf), { kind: 'decide', winnerId: 'lo', decidedBy: 'played', result: { hi: 700, lo: 820 } });
});

check('a page reopened mid-round: the higher of final and live counts', () => {
  const live = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), finals: { hi: sc(300), lo: sc(500) }, live: { hi: sc(900, 30), lo: sc(500) } });
  assert.deepEqual(nextStep(live, T, at(60), seedOf), { kind: 'decide', winnerId: 'hi', decidedBy: 'played', result: { hi: 900, lo: 500 } });
});

check('a tie replays, up to the limit, then the better seed', () => {
  const tie = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), finals: { hi: sc(500), lo: sc(500) } });
  assert.deepEqual(nextStep(tie, T, at(60), seedOf), { kind: 'replay', scores: { hi: 500, lo: 500 } });
  const twice = { ...tie, attempt: 2, history: [{ attempt: 0, scores: { hi: 1, lo: 1 } }, { attempt: 1, scores: { hi: 2, lo: 2 } }] };
  assert.deepEqual(nextStep(twice, T, at(60), seedOf), { kind: 'decide', winnerId: 'hi', decidedBy: 'played', result: { hi: 500, lo: 500 } });
  // After an HR void (attempt 3, the tie history cleared) the replays are counted afresh.
  assert.equal(nextStep({ ...tie, attempt: 3, history: undefined }, T, at(60), seedOf).kind, 'replay');
});

check('joining: only the two, only in the window', () => {
  const m = match({});
  assert.equal(mayJoin(m, 'x', at(10)).ok, false);
  assert.equal(mayJoin(m, 'lo', at(10)).ok, true);
  assert.equal(mayJoin(m, 'lo', at(180)).ok, false);
  assert.equal(mayJoin(match({ status: 'betting' }), 'lo', at(10)).ok, false);
});

check('scores: only during the round, a final not too soon', () => {
  const live = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13) });
  assert.equal(mayScore(live, 'hi', T, at(10), false).ok, false);
  assert.equal(mayScore(live, 'hi', T, at(20), false).ok, true);
  assert.equal(mayScore(live, 'hi', T, at(20), true).ok, false);
  assert.equal(mayScore(live, 'hi', T, at(13 + 45), true).ok, true);
  assert.equal(mayScore(live, 'hi', T, at(13 + 71), true).ok, false);
  assert.equal(mayScore({ ...live, finals: { hi: sc(10) } }, 'hi', T, at(40), false).ok, false);
});

check('bets: open lobby only, not on your own match, within balance', () => {
  const m = { status: 'betting' as const, players: ['hi', 'lo'] as [string, string], bettingEndsAt: at(60) };
  assert.equal(mayBet(m, 'x', 'hi', 50, 100, 0, at(10)).ok, true);
  assert.equal(mayBet(m, 'hi', 'lo', 50, 100, 0, at(10)).ok, false);
  assert.equal(mayBet(m, 'x', 'zz', 50, 100, 0, at(10)).ok, false);
  assert.equal(mayBet(m, 'x', 'hi', 150, 100, 0, at(10)).ok, false);
  assert.equal(mayBet(m, 'x', 'hi', 50, 100, 40, at(10)).ok, false);
  assert.equal(mayBet(m, 'x', 'hi', 50, 100, 0, at(60)).ok, false);
  assert.equal(mayBet(m, 'x', 'hi', 0, 100, 0, at(10)).ok, false);
});

check('live board: integers in range kept, junk ignored, a tap only with ok', () => {
  assert.deepEqual(parseLiveBoard({ score: 120, board: 7 }), { board: 7 });
  assert.deepEqual(parseLiveBoard({ score: 120, board: 7, tap: 3, ok: true }), { board: 7, tap: 3, ok: true });
  assert.deepEqual(parseLiveBoard({ board: 0, tap: 35, ok: false }), { board: 0, tap: 35, ok: false });
  assert.deepEqual(parseLiveBoard({ board: 7, tap: 3 }), { board: 7 });
  assert.deepEqual(parseLiveBoard({ board: 7, tap: 36, ok: true }), { board: 7 });
  assert.deepEqual(parseLiveBoard({ board: 7, tap: '3', ok: true }), { board: 7 });
  assert.deepEqual(parseLiveBoard({ board: 7, tap: 1.5, ok: true }), { board: 7 });
  for (const junk of [undefined, null, 'x', 5, { score: 100 }, { board: -1 }, { board: 1.5 }, { board: '3' }, { board: 10_001 }, { board: Number.NaN }, { board: Infinity }]) {
    assert.equal(parseLiveBoard(junk), null);
  }
});

// ---------------------------------------------------------------- the draw from the lobby
check('lobby draw: every round pairs who is left, a free pass only with an odd number', () => {
  for (let n = 2; n <= 300; n += 1) {
    const rounds = buildPyramidDraw(n, 8);
    let left = n;
    for (const round of rounds) {
      const passes = round.nodes.filter((node) => node.feeders.length === 1).length;
      assert.equal(passes, left % 2, `n=${n} round ${round.n}: ${passes} free passes for ${left} players`);
      assert.equal(round.nodes.length, Math.ceil(left / 2));
      round.nodes.forEach((node, i) => assert.equal(node.slot, i + 1));
      left = round.nodes.length;
    }
    assert.equal(left, 1, `n=${n} ends with one`);
    assert.equal(rounds[rounds.length - 1].short, 'F');
    // Every entrant is in round 1 exactly once.
    const firsts = rounds[0].nodes.flatMap((node) => node.feeders).sort();
    assert.deepEqual(firsts, Array.from({ length: n }, (_, i) => `e:${i + 1}`).sort());
  }
});
check('lobby draw: the last eight are one at a time, and the free pass falls anywhere', () => {
  const rounds = buildPyramidDraw(227, 8);
  for (const round of rounds) {
    const players = round.nodes.reduce((sum, node) => sum + node.feeders.length, 0);
    assert.equal(round.kind, players <= 8 ? 'sequential' : 'parallel');
  }
  const at = new Set<number>();
  for (let i = 0; i < 200; i += 1) at.add(buildPyramidDraw(9, 8)[0].nodes.findIndex((node) => node.feeders.length === 1));
  assert.ok(at.size > 3, `free pass slots seen: ${[...at].join(',')}`);
  assert.deepEqual(buildPyramidDraw(1, 8), []);
});


// ---------------------------------------------------------------- knights (Men's Day)
const KT = { ...T, gameKey: 'knights', roundSec: 300, startWindowSec: 30, soloStartSec: 30, maxReplays: 2 };
const bank = knightsBank as unknown as KnightsBank;
const board = knightsBoardFor(bank, 6, 7);
const SOL = board.s;
const kn = (cells: number[], sec: number) => ({ score: 0, at: at(sec), knights: cells });
const kLive = (over: Partial<CupMatch> = {}) => match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), ...over });

check('knights: grid per round, 2..7 rounds (last two 9, round 1 6, else 8)', () => {
  const grids = (total: number) => Array.from({ length: total }, (_, i) => gridFor(i + 1, total));
  assert.deepEqual(grids(1), [9]);
  assert.deepEqual(grids(2), [9, 9]);
  assert.deepEqual(grids(3), [6, 9, 9]);
  assert.deepEqual(grids(4), [6, 8, 9, 9]);
  assert.deepEqual(grids(5), [6, 8, 8, 9, 9]);
  assert.deepEqual(grids(6), [6, 8, 8, 8, 9, 9]);
  assert.deepEqual(grids(7), [6, 8, 8, 8, 8, 9, 9]);
});

check('knights: every bank board is n×n with one knight per row, column and region, none touching', () => {
  for (const n of [6, 8, 9]) {
    const boards = bank[String(n)];
    assert.equal(boards.length, 30);
    for (const b of boards) {
      assert.equal(b.g.length, n * n);
      assert.equal(new Set(b.g).size, n);
      assert.equal(b.s.length, n);
      const rows = new Set(b.s.map((c) => Math.floor(c / n)));
      const cols = new Set(b.s.map((c) => c % n));
      const regions = new Set(b.s.map((c) => b.g[c]));
      assert.equal(rows.size, n);
      assert.equal(cols.size, n);
      assert.equal(regions.size, n);
      for (const x of b.s) for (const y of b.s) {
        if (x === y) continue;
        assert.ok(Math.abs(Math.floor(x / n) - Math.floor(y / n)) > 1 || Math.abs((x % n) - (y % n)) > 1, `touching ${x} ${y}`);
      }
    }
  }
  assert.equal(knightsBoardFor(bank, 8, 31), bank['8'][1]);
});

check('knights: a reported board is whole cells on the grid, deduped and sorted', () => {
  assert.deepEqual(parseKnights([5, 3, 3, 0], 6), [0, 3, 5]);
  assert.deepEqual(parseKnights([], 6), []);
  for (const junk of [undefined, null, 'x', 5, {}, [36], [-1], [1.5], ['3'], Array.from({ length: 37 }, () => 0)]) {
    assert.equal(parseKnights(junk, 6), null);
  }
  assert.equal(rightOf([SOL[0], SOL[1], (SOL[2] + 1) % 36], SOL), 2);
  assert.equal(isSolved([...SOL], SOL), true);
  assert.equal(isSolved([...SOL, (SOL[0] + 1) % 36], SOL), false);
});

check('knights: a right board decides the match at once (finished), a wrong one waits', () => {
  const almost = kLive({ live: { hi: kn(SOL.slice(0, 5), 40), lo: kn([0], 30) } });
  assert.deepEqual(nextStep(almost, KT, at(60), seedOf, SOL), { kind: 'none' });
  const done = kLive({ live: { hi: kn(SOL.slice(0, 5), 40), lo: kn([...SOL], 73) } });
  assert.deepEqual(nextStep(done, KT, at(74), seedOf, SOL), {
    kind: 'decide', winnerId: 'lo', decidedBy: 'finished', result: { winnerId: 'lo', decidedBy: 'finished', right: { hi: 5, lo: 6 }, finishedMs: 60_000 },
  });
  // Both right by the time the runner looks: the earlier report wins.
  const both = kLive({ live: { hi: kn([...SOL], 50), lo: kn([...SOL], 49) } });
  assert.equal((nextStep(both, KT, at(51), seedOf, SOL) as { winnerId: string }).winnerId, 'lo');
  // A right board with a knight too many is not finished.
  const extra = [...Array(36).keys()].find((c) => !SOL.includes(c))!;
  assert.equal(nextStep(kLive({ live: { hi: kn([...SOL, extra], 40) } }), KT, at(60), seedOf, SOL).kind, 'none');
});

check('knights: resign hands the match over at once, only to a player, only in play', () => {
  const live = kLive({ live: { hi: kn(SOL.slice(0, 3), 40) } });
  assert.deepEqual(resignStep(live, 'hi', SOL), { kind: 'decide', winnerId: 'lo', decidedBy: 'resigned', result: { winnerId: 'lo', decidedBy: 'resigned', right: { hi: 3, lo: 0 } } });
  assert.equal((resignStep(live, 'lo', SOL) as { winnerId: string }).winnerId, 'hi');
  assert.equal((resignStep(live, 'x', SOL) as { ok: boolean; status: number }).status, 403);
  assert.equal((resignStep({ ...live, status: 'open' }, 'hi', SOL) as { ok: boolean }).ok, false);
  assert.equal((resignStep({ ...live, status: 'done' }, 'hi', SOL) as { ok: boolean }).ok, false);
  // In the countdown (status live, the start still ahead) resigning is allowed.
  assert.equal((resignStep(kLive({ startAt: at(100) }), 'hi', SOL) as { kind: string }).kind, 'decide');
});

check('knights: at the cap (+3 s) more knights in the right place wins', () => {
  const capped = kLive({ live: { hi: kn([SOL[0], SOL[1], SOL[2]], 200), lo: kn([SOL[3], SOL[4], (SOL[5] + 1) % 36], 250) } });
  assert.equal(nextStep(capped, KT, at(13 + 302), seedOf, SOL).kind, 'none');
  const step = nextStep(capped, KT, at(13 + 303), seedOf, SOL);
  assert.equal(step.kind, 'decide');
  assert.deepEqual(step, { kind: 'decide', winnerId: 'hi', decidedBy: 'cap', result: { winnerId: 'hi', decidedBy: 'cap', right: { hi: 3, lo: 2 } } });
  // Reports are taken until the cap + 3 s, not the 25 s grace of the other games.
  assert.equal(mayScore(capped, 'lo', KT, at(13 + 302), false).ok, true);
  assert.equal(mayScore(capped, 'lo', KT, at(13 + 304), false).ok, false);
});

check('knights: a tie at the cap replays (up to 2), then the better seed; a replay seed is a new board', () => {
  const tie = kLive({ live: { hi: kn([SOL[0]], 200), lo: kn([SOL[1]], 250) } });
  assert.deepEqual(nextStep(tie, KT, at(13 + 303), seedOf, SOL), { kind: 'replay', scores: { hi: 1, lo: 1 } });
  // Nothing placed by either: 0 v 0, a tie too.
  assert.equal(nextStep(kLive(), KT, at(13 + 303), seedOf, SOL).kind, 'replay');
  const twice = { ...tie, attempt: 2, history: [{ attempt: 0, scores: { hi: 1, lo: 1 } }, { attempt: 1, scores: { hi: 0, lo: 0 } }] };
  assert.deepEqual(nextStep(twice, KT, at(13 + 303), seedOf, SOL), { kind: 'decide', winnerId: 'hi', decidedBy: 'replays', result: { winnerId: 'hi', decidedBy: 'replays', right: { hi: 1, lo: 1 } } });
  let n = 0;
  const fresh = () => [7, 37, 67, 8][n++ % 4];
  // 37 and 67 land on board 7 again (mod 30): skipped, 8 is taken.
  assert.equal(newKnightsSeed(7, 30, fresh), 8);
  for (let i = 0; i < 500; i += 1) {
    const old = 1_000_000 + i * 7919;
    const seed = newKnightsSeed(old, 30, () => 1_000_000 + Math.floor(Math.random() * 9_000_000));
    assert.notEqual(seed % 30, old % 30);
  }
});

check('knights: a lone player goes through once they start; never started: the better seed', () => {
  const solo = match({ status: 'solo', joined: { lo: at(10) }, soloUntil: at(70) });
  assert.deepEqual(nextStep(solo, KT, at(40), seedOf, SOL), { kind: 'none' });
  assert.deepEqual(nextStep({ ...solo, startAt: at(44) }, KT, at(40), seedOf, SOL), {
    kind: 'decide', winnerId: 'lo', decidedBy: 'solo', result: { winnerId: 'lo', decidedBy: 'solo', right: { hi: 0, lo: 0 } },
  });
  assert.deepEqual(nextStep(solo, KT, at(70), seedOf, SOL), {
    kind: 'decide', winnerId: 'hi', decidedBy: 'absent', result: { winnerId: 'hi', decidedBy: 'absent', right: { hi: 0, lo: 0 } },
  });
  // Nobody came: absent, as every game.
  assert.equal((nextStep(match({ deadlineAt: at(30) }), KT, at(30), seedOf, SOL) as { decidedBy: string }).decidedBy, 'absent');
  // One came: solo, with 30 s to start.
  assert.deepEqual(nextStep(match({ deadlineAt: at(30), joined: { lo: at(3) } }), KT, at(30), seedOf, SOL), { kind: 'solo', userId: 'lo', soloUntil: at(60) });
});

check('knights rules never touch the other games: Odd One Out ignores a knights board', () => {
  const live = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), live: { hi: { ...kn([...SOL], 20), score: 10 }, lo: sc(20, 30) } });
  assert.equal(nextStep(live, T, at(30), seedOf, SOL).kind, 'none');
  assert.deepEqual(nextStep(live, T, at(13 + 70), seedOf, SOL), { kind: 'decide', winnerId: 'lo', decidedBy: 'played', result: { hi: 10, lo: 20 } });
});

// ---------------------------------------------------------------- word trip (27 Nov): one normal Word Trip run each
const WTT = { ...T, gameKey: 'word-trip', roundSec: 60, startWindowSec: 40, soloStartSec: 30, maxReplays: 2, countdownSec: 5 };
const GAME = loadWordTripGame(readFileSync(path.resolve(__dirname, '../../game-pages/word-trip.html'), 'utf8'), 'repo');
const R = GAME.rules;
/** The live part of a match as the runner sees it: a run's score and the seconds its clock earned. */
const run = (score: number, added = 0) => ({ score, at: at(50), wtAdded: added });
/** A word the stop takes, of a length, common or rare, from the dictionary as the game deals it. */
const wordOn = (stop: WtStop, len: number, rare = false) => [...(rare ? stop.rare : stop.words)].find((w) => w.length === len);
const fullOf = (stop: WtStop) => [...stop.words, ...stop.rare].find((w) => w.length === stop.len)!;

check("word trip: the rules are read from Word Trip's own page (the normal game's numbers)", () => {
  assert.deepEqual(R, WT_DEFAULT_RULES);
  assert.equal(wtLongestSec(R), 90);
});

check('word trip: both players get the same stops in the same order (the seed), as the normal game deals them', () => {
  const page = readFileSync(path.resolve(__dirname, '../../game-pages/word-trip.html'), 'utf8');
  const block = /\/\* seeded-boards:start[\s\S]*?\/\* seeded-boards:end \*\//.exec(page)![0];
  const { boardAt } = new Function(`${block}\nreturn { boardAt };`)();
  for (const seed of [1, 7, 424242, 987654]) {
    for (let g = 0; g < 9; g += 1) {
      const b = boardAt(seed, g);
      const s = GAME.boards(seed, g);
      assert.equal(s.letters, b.letters, 'the letters as the page deals them');
      assert.equal(s.len, [5, 6, 6, 7, 7, 7][g] ?? 8, 'stops grow 5, 6, 6, 7, 7, 7, then 8');
      for (const w of s.words) assert.ok(b.words.includes(w));
    }
  }
});

check('word trip: a word is checked (stop, letters, counts, dictionary, offensive, once per stop) and scored as Word Trip scores it', () => {
  const r = newRun();
  const s0 = GAME.boards(7, 0);
  const w4 = wordOn(s0, 4)!;
  const v1 = playRunWord(r, s0, 0, w4, 2, R);
  assert.ok(v1.ok && v1.pts === 50 && v1.combo === 1 && v1.added === 0, JSON.stringify(v1));
  assert.equal((playRunWord(r, s0, 0, w4, 3, R) as { reason: string }).reason, 'again', 'a word counts once per stop');
  assert.equal((playRunWord(r, s0, 0, w4.toUpperCase(), 4, R) as { reason: string }).reason, 'again');
  assert.equal((playRunWord(r, s0, 0, 'zzzz', 5, R) as { reason: string }).reason, 'letters');
  assert.equal((playRunWord(r, s0, 0, s0.letters + s0.letters[0], 6, R) as { reason: string }).reason, 'letters', 'each letter at most as often as dealt');
  assert.equal((playRunWord(r, s0, 0, 'ab', 7, R) as { reason: string }).reason, 'short');
  assert.equal((playRunWord(r, s0, 1, w4, 7, R) as { reason: string }).reason, 'stop', 'only the stop the run is on');
  assert.equal(r.score, 50);
  // Within 8 s: ×2; a 5-letter word adds 2 s; every letter adds 3 more and moves to the next stop.
  const w3 = wordOn(s0, 3)!;
  const v2 = playRunWord(r, s0, 0, w3, 5, R);
  assert.ok(v2.ok && v2.combo === 2 && v2.pts === 60, JSON.stringify(v2));
  const full = fullOf(s0);
  const rare = !s0.words.has(full);
  const v3 = playRunWord(r, s0, 0, full, 8, R);
  assert.ok(v3.ok && v3.full && v3.combo === 3 && v3.pts === (Math.round(80 * (rare ? 1.5 : 1)) + 150) * 3, JSON.stringify(v3));
  assert.equal(r.added, 2 + 3, 'TIMEB[5] + FULL_TIME');
  assert.equal(r.gi, 1, 'every letter: the next stop');
  assert.ok(['early', 'fast'].includes((playRunWord(r, GAME.boards(7, 1), 1, wordOn(GAME.boards(7, 1), 3), 8.1, R) as { reason: string }).reason), 'not before the next stop shows');
  const s1 = GAME.boards(7, 1);
  const v4 = playRunWord(r, s1, 1, wordOn(s1, 3)!, 30, R);
  assert.ok(v4.ok && v4.combo === 1, 'over 8 s since the last: ×1');
  // Offensive words never count, whatever the letters, and the game's lists never deal one as a word.
  for (const w of WT_BLOCKED) {
    const fake: WtStop = { g: 0, len: w.length + 1, letters: `${w}e`, words: new Set([w]), rare: new Set() };
    assert.equal((playRunWord(newRun(), fake, 0, w, 1, R) as { reason: string }).reason, 'unknown', `${w} refused`);
  }
  for (let g = 0; g < 12; g += 1) for (const w of [...GAME.boards(424242, g).words, ...GAME.boards(424242, g).rare]) assert.ok(!WT_BLOCKED.has(w));
});

check('word trip: the clock is 1:00 plus what the run earned (at most 30 s); no word after it, none faster than a person, none in brute force', () => {
  const r = newRun();
  const s0 = GAME.boards(11, 0);
  const words = [...s0.words, ...s0.rare].filter((w) => w.length < s0.len);
  assert.equal((playRunWord(r, s0, 0, words[0], 61, R) as { reason: string }).reason, 'time', 'the clock has run out');
  assert.ok(playRunWord(r, s0, 0, words[0], 10, R).ok);
  assert.equal((playRunWord(r, s0, 0, words[1], 10.1, R) as { reason: string }).reason, 'fast', 'two words 0.1 s apart');
  // Seconds earned never pass MAX_ADDED.
  const many = newRun();
  let t = 1;
  for (let g = 0; g < 12 && many.added < R.MAX_ADDED; g += 1) {
    const s = GAME.boards(11, many.gi);
    t += 1;
    playRunWord(many, s, many.gi, fullOf(s), t, R);
  }
  assert.equal(many.added, R.MAX_ADDED);
  assert.equal(runEndsSec(many, R), 90);
  const junk = newRun();
  for (let i = 0; i < 120; i += 1) playRunWord(junk, s0, 0, 'qqq', i * 0.4, R);
  assert.equal((playRunWord(junk, s0, 0, words[0], 50, R) as { reason: string }).reason, 'limit');
});

check('word trip: skip costs 100 points and moves on, only with 100 to pay, as the game does', () => {
  const r = newRun();
  assert.deepEqual(playRunSkip(r, 0, 1, R), { ok: false, reason: 'points' });
  const s0 = GAME.boards(5, 0);
  for (const w of [...s0.words].filter((x) => x.length < s0.len).slice(0, 3)) playRunWord(r, s0, 0, w, 1 + r.total, R);
  const before = r.score;
  assert.ok(before >= 100);
  assert.deepEqual(playRunSkip(r, 0, 9, R), { ok: true, gi: 1, score: before - 100 });
  assert.equal((playRunWord(r, GAME.boards(5, 1), 1, wordOn(GAME.boards(5, 1), 3), 9.2, R) as { reason: string }).reason, 'early');
});

check('word trip: a run played back from its events is the same run (a restart decides the same)', () => {
  const r = newRun();
  let t = 1;
  for (let i = 0; i < 20; i += 1) {
    const s = GAME.boards(99, r.gi);
    const w = i % 4 === 3 ? fullOf(s) : [...s.words].filter((x) => x.length < s.len)[i % 3];
    t += 1.1;
    playRunWord(r, s, r.gi, w, t, R);
  }
  const back = replayRun(JSON.parse(JSON.stringify(r.events)), GAME.boards, 99, R);
  assert.equal(back.score, r.score);
  assert.equal(back.added, r.added);
  assert.equal(back.gi, r.gi);
});

check("word trip: a word's time is the run's clock as sent, never ahead of its arrival by more than 1.5 s nor 20 s behind it (a dropped connection)", () => {
  assert.equal(wordTime(20, 20.4), 20);
  assert.equal(wordTime(30, 20), 21.5, 'ahead of its arrival');
  assert.equal(wordTime(1, 30), 10, 'held back: counts from 20 s before it arrived');
  assert.equal(wordTime('x', 20), 20);
});

check('word trip: the higher score wins once both clocks have run out (each 1:00 + what it earned, + 8 s for the last words)', () => {
  const live = match({ status: 'live', joined: { hi: at(1), lo: at(2) }, startAt: at(10), live: { hi: run(900, 12), lo: run(1200) } });
  assert.deepEqual(nextWordTripStep(live, WTT, at(10 + 68), seedOf, R), { kind: 'none' }, 'one clock (hi, +12 s) still running');
  assert.deepEqual(nextWordTripStep(live, WTT, at(10 + 72 + 8), seedOf, R), { kind: 'decide', winnerId: 'lo', decidedBy: 'played', result: { hi: 900, lo: 1200 } });
  // Left mid-match: the score so far stands, the clock never stops.
  const left = match({ status: 'live', joined: { hi: at(1), lo: at(2) }, startAt: at(10), live: { hi: run(80) } });
  assert.deepEqual(nextWordTripStep(left, WTT, at(10 + 68), seedOf, R), { kind: 'decide', winnerId: 'hi', decidedBy: 'played', result: { hi: 80, lo: 0 } });
});

check('word trip: no-show at 40 s → the one who came plays their run alone (started at once), then goes through', () => {
  const open = match({ deadlineAt: at(40), joined: { lo: at(5) } });
  assert.deepEqual(nextWordTripStep(open, WTT, at(39), seedOf, R), { kind: 'none' });
  assert.deepEqual(nextWordTripStep(open, WTT, at(40), seedOf, R), { kind: 'solo', userId: 'lo', soloUntil: at(40), startAt: at(45) });
  const solo = match({ status: 'solo', joined: { lo: at(5) }, soloUntil: at(40), startAt: at(45), live: { lo: run(300, 6) } });
  assert.deepEqual(nextWordTripStep(solo, WTT, at(45 + 69), seedOf, R), { kind: 'none' }, 'their run first (1:06)');
  assert.deepEqual(nextWordTripStep(solo, WTT, at(45 + 66 + 8), seedOf, R), { kind: 'decide', winnerId: 'lo', decidedBy: 'solo', result: { lo: 300, hi: 0 } });
  const empty = match({ status: 'solo', joined: { lo: at(5) }, soloUntil: at(40), startAt: at(45) });
  assert.equal((nextWordTripStep(empty, WTT, at(45 + 68), seedOf, R) as { winnerId: string }).winnerId, 'lo', 'the one who came goes through, never the no-show');
  assert.equal(mayPlayWord(solo, 'hi', undefined, at(60), R).ok, false, 'the no-show cannot score in a solo');
});

check('word trip: neither joins → absent (the bracket carries the better seed, as for every game)', () => {
  assert.deepEqual(nextWordTripStep(match({ deadlineAt: at(40) }), WTT, at(40), seedOf, R), { kind: 'decide', winnerId: 'hi', decidedBy: 'absent', result: { hi: 0, lo: 0 } });
});

check('word trip: a tie replays (up to 2), then the better seed', () => {
  const tied = match({ status: 'live', joined: { hi: at(1), lo: at(2) }, startAt: at(10), live: { hi: run(500), lo: run(500) } });
  assert.deepEqual(nextWordTripStep(tied, WTT, at(10 + 68), seedOf, R), { kind: 'replay', scores: { hi: 500, lo: 500 } });
  const twice = { ...tied, history: [{ attempt: 0, scores: {} }, { attempt: 1, scores: {} }] };
  assert.deepEqual(nextWordTripStep(twice, WTT, at(10 + 68), seedOf, R), { kind: 'decide', winnerId: 'hi', decidedBy: 'replays', result: { hi: 500, lo: 500 } });
});

check('word trip: the lobby draw leaves out members not connected lately (and keeps a lobby with no check-ins whole)', () => {
  const now = at(1000);
  const ev = { lobbyJoined: ['a', 'b', 'c'], lobbySeen: { a: at(990), b: at(900) } };
  assert.deepEqual(lobbyPresent(ev, now), { kept: ['a'], dropped: ['b', 'c'] });
  assert.deepEqual(lobbyPresent({ lobbyJoined: ['a', 'b'] }, now), { kept: ['a', 'b'], dropped: [] });
});

check('word trip: a run started 4 s late on a slow phone, and one with a 15 s outage, keep every word and the game\'s score', () => {
  /** A run as the game plays it (its own clock), then as the server takes it (each word on arrival). */
  const both = (seed: number, arrivalOf: (t: number) => number) => {
    const game = newRun();
    const server = newRun();
    const sent: { g: number; w: string; t: number }[] = [];
    let t = 1;
    for (let i = 0; i < 40 && t < 59; i += 1) {
      const s = GAME.boards(seed, game.gi);
      const had = new Set((game.found[game.gi] ?? []).map(([w]) => w));
      const left = [...s.words].filter((w) => !had.has(w));
      const w = i % 4 === 3 ? left.find((x) => x.length === s.len) : left.find((x) => x.length < s.len);
      if (!w) break;
      t += 1.4;
      if (t < game.stopFrom) t = game.stopFrom + 0.1;
      if (t >= runEndsSec(game, R)) break;
      if (playRunWord(game, s, game.gi, w, t, R).ok) sent.push({ g: s.g, w, t });
    }
    for (const m of sent) playRunWord(server, GAME.boards(seed, server.gi), m.g, m.w, wordTime(m.t, arrivalOf(m.t)), R);
    return { game, server, last: sent[sent.length - 1] };
  };
  // 4 s late: the phone's clock runs 4 s behind the match's; every word arrives 4 s "late".
  const late = both(4242, (t) => t + 4);
  assert.equal(late.server.score, late.game.score);
  assert.equal(late.server.total, late.game.total);
  // Its last word still arrives before the match is decided (its clock's end + grace).
  assert.ok(late.last.t + 4 < runEndsSec(late.server, R) + WT_GRACE_SEC, 'the last word of a late run is in time');
  // 15 s outage from 20 s to 35 s: those words all arrive at 35 s, with their own times.
  const out = both(777, (t) => (t >= 20 && t < 35 ? 35 : t + 0.2));
  assert.equal(out.server.score, out.game.score);
  assert.equal(out.server.total, out.game.total);
  assert.equal(out.server.combo === out.game.combo && out.server.added === out.game.added, true);
});

check('word trip: the page blocks the same offensive words as the server', () => {
  const js = readFileSync(path.resolve(__dirname, '../../game-pages/cup/play-wordtrip.js'), 'utf8');
  const list = JSON.parse(/var BLOCKED = (\[[\s\S]*?\]);/.exec(js)![1].replace(/'/g, '"'));
  assert.deepEqual([...list].sort(), [...WT_BLOCKED].sort());
});

console.log(`\n${checks} checks passed`);
