/**
 * The Diwali Cup's rules on their own, no database:
 *   npx tsx src/scripts/cup-check.ts
 */
import assert from 'node:assert/strict';
import type { CupMatch, CupRound } from '../models/cup.model';
import {
  DEFAULT_CUP_CONFIG,
  bracketOrder,
  buildDraw,
  mayBet,
  mayJoin,
  mayScore,
  nextStep,
  parseRef,
  seedOrderOf,
} from '../services/cup-rules';

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
  // Started and never finished: absent.
  assert.equal((nextStep(started, T, at(205 + 70), seedOf) as { decidedBy: string }).decidedBy, 'absent');
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

check('a tie replays, up to the limit, then the better seed', () => {
  const tie = match({ status: 'live', joined: { hi: at(5), lo: at(9) }, startAt: at(13), finals: { hi: sc(500), lo: sc(500) } });
  assert.deepEqual(nextStep(tie, T, at(60), seedOf), { kind: 'replay', scores: { hi: 500, lo: 500 } });
  assert.deepEqual(nextStep({ ...tie, attempt: 2 }, T, at(60), seedOf), { kind: 'decide', winnerId: 'hi', decidedBy: 'played', result: { hi: 500, lo: 500 } });
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

console.log(`\n${checks} checks passed`);
