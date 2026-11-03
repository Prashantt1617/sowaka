/**
 * Checks the Speed Poker Shootout's rules (services/poker-shootout-rules.ts):
 * the handoff's test cases, then whole tournaments for every headcount with
 * fake tables. No database. Run with `npx tsx src/scripts/poker-shootout-check.ts`.
 */
import {
  finalStandings,
  planRounds,
  rankQualifier,
  seatPlayers,
  settleTable,
  startingStacks,
  throughSoFar,
  type ShootoutRoundKind,
  type ShootoutTableResult,
} from '../services/poker-shootout-rules';

let failures = 0;
function check(label: string, passed: boolean, detail: unknown = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : ` — ${JSON.stringify(detail)}`}`);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const describe = (n: number) => planRounds(n).map((r) => `${r.name}[${r.tables.join('/')}]${r.kind === 'qualifier' ? `→${r.advance}` : ''}`).join(' → ');

console.log('the handoff test cases');
check('1. 24 join: qualifier at 3 tables of 8, top 16, semis 8/8, final of 8', describe(24) === 'Qualifier[8/8/8]→16 → Semi-finals[8/8] → Final table[8]', describe(24));
check('2. 13 join: no qualifier, semis 7/6, final of 8', describe(13) === 'Semi-finals[7/6] → Final table[8]', describe(13));
const t3: ShootoutTableResult = { players: ['A', 'B'], busts: [{ id: 'B', hand: 9, stackBefore: 1400 }], survivors: { A: 220 }, draw: {} };
check('3. qualifier: A still in with 220 ranks above B busted with 1,400', rankQualifier([t3]).join() === 'A,B');
const t4: ShootoutTableResult = { players: ['B', 'C'], busts: [{ id: 'B', hand: 4, stackBefore: 900 }, { id: 'C', hand: 7, stackBefore: 900 }], survivors: {}, draw: {} };
check('4. qualifier: same stack, C busted later ranks above B', rankQualifier([t4]).join() === 'C,B');
const t5: ShootoutTableResult = {
  players: ['P1', 'P2', 'P3', 'D', 'E', 'X'],
  busts: [{ id: 'X', hand: 3, stackBefore: 500 }, { id: 'D', hand: 10, stackBefore: 300 }, { id: 'E', hand: 10, stackBefore: 800 }],
  survivors: { P1: 2000, P2: 1500, P3: 900 },
  draw: {},
};
const s5 = settleTable(t5, 4);
check('5. same-hand busts below 4: E (800 in) is 4th through, D out', s5.through.join() === 'P1,P2,P3,E' && !s5.through.includes('D'), s5);
const t6: ShootoutTableResult = { players: ['a', 'b', 'c', 'd', 'e', 'f'], busts: [], survivors: { a: 900, b: 2400, c: 300, d: 1200, e: 700, f: 500 }, draw: {} };
const s6 = settleTable(t6, 4);
check('6. the clock ends a table of 6: top 4 by chips through, chip leader wins', s6.through.join() === 'b,d,a,e' && s6.winner === 'b', s6);
const st7 = startingStacks(['Riya', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], ['Riya']);
check('7. a semi-final winner starts the final on 1,500, the rest on 1,000', st7.Riya === 1500 && Object.entries(st7).every(([id, n]) => id === 'Riya' || n === 1000));
const standings = finalStandings([
  { kind: 'qualifier', tables: [{ players: ['Q1', 'S6'], busts: [], survivors: { Q1: 5000, S6: 100 }, draw: {} }] },
  { kind: 'knockout', tables: [{ players: ['S6', 'W'], busts: [{ id: 'S6', hand: 5, stackBefore: 200 }], survivors: { W: 3000 }, draw: {} }] },
]);
check('8. out in a semi-final ranks above cut first in the qualifier', standings.indexOf('S6') < standings.indexOf('Q1'), standings);

console.log('big fields');
check('128 join: no qualifier, round of 128', describe(128).startsWith('Round of 128['), describe(128));
check('129 join: no qualifier, everyone plays round 1', !describe(129).includes('Qualifier') && describe(129).startsWith('Round of 129['), describe(129));
check('700 join: no qualifier, 88 tables in round 1, down to one final table', (() => {
  const p = planRounds(700);
  return p[0].kind === 'knockout' && p[0].tables.length === 88 && p.every((r) => r.tables.every((t) => t >= 4 && t <= 8)) && p[p.length - 1].kind === 'final';
})(), describe(700));
check('100 join: still a qualifier to 64', describe(100).startsWith('Qualifier[') && describe(100).includes('→64'), describe(100));

console.log('through at a knockout table');
check('nobody is through with 5 left', throughSoFar({ players: [], busts: [], survivors: { a: 1, b: 2, c: 3, d: 4, e: 5 }, draw: {} }, 4).length === 0);
check('the last 4 are through with 4 left', throughSoFar({ players: [], busts: [], survivors: { a: 1, b: 2, c: 3, d: 4 }, draw: {} }, 4).length === 4);

console.log('seating');
const seated = seatPlayers(Array.from({ length: 23 }, (_, i) => `p${i}`), [8, 8, 7], mulberry32(3));
check('everyone seated once, the tables the sizes planned', seated.map((t) => t.length).join() === '8,8,7' && new Set(seated.flat()).size === 23);

console.log('whole tournaments, 3 to 200 players');
function simulateTable(ids: string[], stacks: Record<string, number>, rng: () => number, maxHands: number): ShootoutTableResult {
  const chips: Record<string, number> = { ...Object.fromEntries(ids.map((id) => [id, stacks[id]])) };
  const busts: ShootoutTableResult['busts'] = [];
  const draw = Object.fromEntries(ids.map((id) => [id, rng()]));
  for (let hand = 1; hand <= maxHands; hand++) {
    const alive = ids.filter((id) => chips[id] > 0);
    if (alive.length <= 1) break;
    const pick = alive.slice().sort(() => rng() - 0.5).slice(0, alive.length >= 3 && rng() < 0.15 ? 3 : 2);
    const winner = pick[Math.floor(rng() * pick.length)];
    const before = Object.fromEntries(pick.map((id) => [id, chips[id]]));
    const allIn = rng() < 0.3;
    for (const id of pick) {
      if (id === winner) continue;
      const take = Math.min(chips[id], allIn ? Math.min(chips[id], before[winner]) : Math.max(1, Math.round(chips[id] * (0.05 + rng() * 0.2))));
      chips[id] -= take;
      chips[winner] += take;
    }
    for (const id of pick) if (chips[id] === 0) busts.push({ id, hand, stackBefore: before[id] });
  }
  return { players: ids, busts, survivors: Object.fromEntries(ids.filter((id) => chips[id] > 0).map((id) => [id, chips[id]])), draw };
}
const bad: string[] = [];
for (let n = 3; n <= 200; n++) {
  const rng = mulberry32(n);
  const plan = planRounds(n);
  let players = Array.from({ length: n }, (_, i) => `p${i}`);
  let winners: string[] = [];
  const history: { kind: ShootoutRoundKind; tables: ShootoutTableResult[] }[] = [];
  plan.forEach((round, i) => {
    if (players.length !== round.players) bad.push(`n=${n} round ${i}: ${players.length} for ${round.players}`);
    if (round.kind !== 'qualifier' && round.kind !== 'final' && round.tables.some((t) => t > 8)) bad.push(`n=${n}: a table over 8`);
    const tables = seatPlayers(players, round.tables, rng).map((ids) => simulateTable(ids, startingStacks(players, winners), rng, round.kind === 'qualifier' ? 25 : 400));
    history.push({ kind: round.kind, tables });
    if (round.kind === 'qualifier') {
      players = rankQualifier(tables).slice(0, round.advance);
      winners = [];
    } else {
      const settled = tables.map((t) => settleTable(t, round.advance));
      players = settled.flatMap((s) => s.through);
      winners = settled.map((s) => s.winner);
    }
  });
  const standings = finalStandings(history);
  if (standings.length !== n || new Set(standings).size !== n) bad.push(`n=${n}: standings ${standings.length}`);
  if (players.length !== 1) bad.push(`n=${n}: ${players.length} champions`);
}
check('every round gets the planned number, one champion, everyone in the standings once', bad.length === 0, bad.slice(0, 5));

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
