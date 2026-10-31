/**
 * Checks Speed Poker's table with no database: hand rankings, side pots,
 * scripted hands on fixed decks, heads-up blinds, the short all-in rule,
 * timeouts and sitting out, the clock closing a table, and a few hundred
 * random tables played to the end with every chip accounted for; and the
 * group game's rooms (drop-ins between hands, leaving mid-hand, house
 * players, the host's choices, a room dealt and played to the end).
 *   npx tsx src/scripts/poker-check.ts
 */
import assert from 'node:assert/strict';
import type { PokerEvent, PokerResult, PokerTable } from '../models/poker.model';
import { addSeat, advance, applyAction, choicesFor, finish, leaveSeat, newTable, PokerMoveError, sitIn, startHand, viewFor } from '../services/poker-engine';
import {
  addPlayer,
  advanceRoom,
  applySettings,
  changeHouse,
  newRoom,
  parseCode,
  removePlayer,
  resetToLobby,
  ROOMS,
  startGame,
  summaryOf,
  viewFor as roomViewFor,
  PokerRoomRuleError,
} from '../services/poker-rooms-engine';
import {
  boardOf,
  bountiesOnAt,
  DEFAULT_CONFIG,
  formTables,
  HOUSE_PLAYERS,
  houseMove,
  isHouse,
  makePick,
  officeLeague,
  phaseOf,
  picksBoard,
  playMode,
  PokerPickError,
  powerHourAt,
  QueueEntry,
  queueOrder,
  scoreTable,
  seedFinal,
  seedSemis,
  settlePicks,
} from '../services/poker-floor';
import { bestHand, buildPots, cardName, compareScores, parseCard, shuffledDeck, splitPot } from '../services/poker-rules';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const cards = (s: string) => s.split(' ').map(parseCard);
const score = (s: string) => bestHand(cards(s)).score;

/** A deck that deals [holes] (in deal order, from the small blind round) then [board], then the rest. */
function deckOf(holes: string[], board: string): number[] {
  const first = [...holes.flatMap((h) => cards(h)), ...cards(board)];
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !first.includes(c));
  return [...first, ...rest];
}

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, photoUrl: null, office: i % 2 ? 'Noida' : 'Gurgaon' }));

const total = (t: PokerTable) =>
  t.seats.reduce((a, s) => a + s.stack, 0) + (t.hand && t.hand.street !== 'done' ? t.hand.committed.reduce((a, b) => a + b, 0) : 0);

/** A table whose first button is seat [button] (the draw is the seat before it). */
function table(n: number, now: number, deck?: number[], button = 1): PokerTable {
  const random = () => ((button - 1 + n) % n) / n + 1e-9;
  return newTable({ id: 't1', org: 'sowaka', eventId: 'e1', round: 'open', players: players(n) }, now, random, deck);
}

const act = (t: PokerTable, seat: number, kind: 'fold' | 'check' | 'call' | 'raise' | 'allin', now: number, to?: number) =>
  applyAction(t, t.seats[seat].userId, { kind, to }, now);

// ------------------------------------------------------------------ rules

check('hand ranks, top to bottom', () => {
  const order = [
    'As Ks Qs Js Ts 2c 3d', // straight flush
    'Ah Ad Ac As Kd 2c 3d', // quads
    'Kh Kd Kc 2s 2d 7c 9d', // full house
    'Ah 9h 7h 4h 2h Kc Qd', // flush
    '9c Td Jh Qs Kd 2c 3d', // straight
    '7c 7d 7h Ks 2d 4c 9d', // trips
    'Jc Jd 4h 4s Ad 2c 9d', // two pair
    'Tc Td 4h 3s Ad 2c 8d', // pair
    'Ac Jd 9h 7s 4d 3c 2d', // high card
  ];
  for (let i = 0; i < order.length - 1; i++) assert.ok(compareScores(score(order[i]), score(order[i + 1])) > 0, `${order[i]} beats ${order[i + 1]}`);
  assert.equal(bestHand(cards('As Ks Qs Js Ts 2c 3d')).name, 'Straight flush');
});

check('the wheel is a five-high straight; a pair\'s kicker decides', () => {
  assert.deepEqual(score('Ac 2d 3h 4s 5d Kc Kd').slice(0, 2), [4, 5]);
  assert.ok(compareScores(score('6c 2d 3h 4s 5d Kc 9d'), score('Ac 2d 3h 4s 5d Kc 9d')) > 0);
  assert.ok(compareScores(score('Ac Ad 9h 7s 4d 3c 2d'), score('Ac Ad 8h 7s 4d 3c 2d')) > 0);
  assert.equal(compareScores(score('Ac Kd Qh Js 9d 3c 2d'), score('Ad Kc Qs Jh 9c 4c 2h')), 0, 'board plays: same five');
});

check('a full house of more threes beats fewer; two pair compares high pair, low pair, kicker', () => {
  assert.ok(compareScores(score('Qc Qd Qh 2s 2d 5c 6d'), score('Jc Jd Jh As Ad 5c 6d')) > 0);
  assert.ok(compareScores(score('Kc Kd 3h 3s Ad 5c 6d'), score('Kc Kd 3h 3s Qd 5c 6d')) > 0);
});

check('side pots: levels, eligibility, folded chips stay in', () => {
  const pots = buildPots([100, 300, 300, 50], [false, false, false, false]);
  assert.deepEqual(pots, [
    { amount: 200, eligible: [0, 1, 2, 3] },
    { amount: 150, eligible: [0, 1, 2] },
    { amount: 400, eligible: [1, 2] },
  ]);
  const withFold = buildPots([100, 100, 40], [true, false, false]);
  assert.equal(withFold.reduce((a, p) => a + p.amount, 0), 240);
  assert.ok(withFold.every((p) => !p.eligible.includes(0)));
});

check('a split pot gives the odd chip left of the button', () => {
  const out = splitPot(101, [0, 2], 1, 4);
  assert.equal(out.get(2), 51);
  assert.equal(out.get(0), 50);
});

check('the shuffle uses every card once', () => {
  const deck = shuffledDeck(seeded(7));
  assert.equal(new Set(deck).size, 52);
  assert.equal(cardName(parseCard('Td')), 'Td');
});

// ------------------------------------------------------------------ hands

check('three players: blinds, preflop order, flop order, showdown pays the best hand', () => {
  const now = 1_000_000;
  // Button seat 1, small blind seat 2, big blind seat 0. Deal from the small blind: C(2), A(0), B(1).
  const deck = deckOf(['7c 2d', 'Ah Ad', 'Kc Kd'], 'As 9h 4c 8s 3d');
  const t = table(3, now, deck, 1);
  const h = t.hand!;
  assert.equal(h.button, 1);
  assert.equal(h.sb, 2);
  assert.equal(h.bb, 0);
  assert.equal(h.streetIn[2], 10);
  assert.equal(h.streetIn[0], 20);
  assert.equal(h.toAct, 1, 'first to act preflop: the seat after the big blind');
  act(t, 1, 'raise', now, 60);
  act(t, 2, 'fold', now);
  assert.equal(h.toAct, 0);
  act(t, 0, 'call', now);
  assert.equal(h.street, 'flop');
  assert.deepEqual(h.board.map(cardName), ['As', '9h', '4c']);
  assert.equal(h.toAct, 0, 'after the flop: the first live seat after the button');
  act(t, 0, 'check', now);
  act(t, 1, 'raise', now, 100);
  act(t, 0, 'call', now);
  act(t, 0, 'check', now); // turn
  act(t, 1, 'check', now);
  act(t, 0, 'raise', now, 200); // river
  act(t, 1, 'call', now);
  assert.equal(h.street, 'done');
  assert.equal(h.result!.showdown, true);
  assert.deepEqual(h.result!.pots[0].winners, [0]);
  assert.equal(h.result!.pots[0].hand, 'Three of a kind');
  assert.equal(t.seats[0].stack, 1500 + 10 + 60 + 100 + 200);
  assert.equal(total(t), 4500);
});

check('everyone folds to the big blind: no showdown, blinds back to the big blind', () => {
  const now = 1_000_000;
  const t = table(4, now, undefined, 0);
  const h = t.hand!;
  const bb = h.bb;
  while (h.street !== 'done') act(t, h.toAct!, 'fold', now);
  assert.equal(h.result!.showdown, false);
  assert.equal(t.seats[bb].stack, 1510);
  assert.equal(total(t), 6000);
});

check('heads up: the button posts the small blind and acts first preflop, last after', () => {
  const now = 1_000_000;
  const t = table(2, now, undefined, 0);
  const h = t.hand!;
  assert.equal(h.sb, h.button);
  assert.equal(h.toAct, h.button);
  act(t, h.button, 'call', now);
  act(t, h.bb, 'check', now);
  assert.equal(h.street, 'flop');
  assert.equal(h.toAct, h.bb);
});

check('all in preflop with a short stack: side pot, run-out, bust and knockout', () => {
  const now = 1_000_000;
  const t = table(3, now, undefined, 1);
  // Reset to a fresh hand with set stacks: A 300, B 1500, C 1500.
  t.seats[0].stack = 300;
  t.seats[1].stack = 1500;
  t.seats[2].stack = 1500;
  t.lastButton = 0; // button 1, sb 2, bb 0
  t.hand = null;
  // Deal from sb: C(2), A(0), B(1). A has the worst hand; B beats C.
  startHand(t, now, seeded(1), deckOf(['Qc Qd', '7c 2d', 'Kc Kd'], '3s 5h 9c Js 4d'));
  const h = t.hand!;
  act(t, 1, 'allin', now); // B all in for 1500
  act(t, 2, 'call', now); // C calls 1500
  act(t, 0, 'call', now); // A calls 300, all in
  assert.equal(h.street, 'done');
  assert.equal(h.board.length, 5, 'the board runs out');
  assert.equal(h.result!.pots.length, 2);
  assert.equal(h.result!.pots[0].amount, 900);
  assert.equal(h.result!.pots[1].amount, 2400);
  assert.deepEqual(h.result!.pots[0].winners, [1]);
  assert.equal(t.seats[1].stack, 3300);
  assert.equal(t.seats[2].stack, 0);
  assert.equal(t.seats[0].stack, 0);
  assert.deepEqual(t.seats[1].knockouts.sort(), ['u0', 'u2']);
  assert.equal(t.seats[0].bustedBy, 'u1');
  // One player left: the next deal closes the table.
  advance(t, now + 10_000, seeded(2));
  assert.equal(t.status, 'over');
  assert.equal(t.standings![0].userId, 'u1');
  assert.equal(total(t), 3300);
});

check('a short all-in does not reopen raising for those who already acted', () => {
  const now = 1_000_000;
  const t = table(3, now, undefined, 1);
  t.seats[2].stack = 150; // C will be the small blind with 150
  t.lastButton = 0;
  t.hand = null;
  startHand(t, now, seeded(3));
  const h = t.hand!; // button 1, sb 2, bb 0
  act(t, 1, 'raise', now, 100); // B raises to 100 (raise of 80)
  act(t, 2, 'allin', now); // C all in to 150: a raise of 50, short of 80
  assert.equal(h.currentBet, 150);
  act(t, 0, 'call', now); // A calls 150
  const b = choicesFor(t, 1)!;
  assert.equal(h.toAct, 1);
  assert.equal(b.canRaise, false, 'B already acted: may call or fold only');
  assert.throws(() => act(t, 1, 'raise', now, 400), PokerMoveError);
  act(t, 1, 'call', now);
  assert.equal(h.street, 'flop');
});

check('a raise below the minimum is refused; acting out of turn is refused', () => {
  const now = 1_000_000;
  const t = table(3, now, undefined, 1);
  const h = t.hand!;
  assert.throws(() => act(t, 2, 'call', now), PokerMoveError);
  assert.throws(() => act(t, h.toAct!, 'raise', now, 30), PokerMoveError);
  assert.throws(() => act(t, h.toAct!, 'check', now), PokerMoveError);
});

check('the clock: a timeout checks or folds; two in a row sit out; sat out folds at once; tapping back in', () => {
  let now = 1_000_000;
  const t = table(3, now, undefined, 1);
  const r = seeded(4);
  const h1 = t.hand!;
  const first = h1.toAct!;
  now += 15_000;
  assert.ok(advance(t, now, r));
  assert.ok(h1.folded[first], 'facing the big blind: folded');
  assert.equal(t.seats[first].timeouts, 1);
  // Play the hand out quickly.
  while (t.hand!.street !== 'done') act(t, t.hand!.toAct!, t.hand!.toAct === null ? 'check' : choicesFor(t, t.hand!.toAct!)!.canCheck ? 'check' : 'call', now);
  // Next hands until [first] times out again.
  for (let guard = 0; guard < 20 && !t.seats[first].sittingOut; guard++) {
    now = t.hand!.nextAt! + 1;
    advance(t, now, r);
    while (t.hand!.street !== 'done' && t.hand!.toAct !== first) {
      const s = t.hand!.toAct!;
      act(t, s, choicesFor(t, s)!.canCheck ? 'check' : 'call', now);
    }
    if (t.hand!.toAct === first) {
      now += 15_000;
      advance(t, now, r);
    }
    while (t.hand!.street !== 'done') {
      const s = t.hand!.toAct!;
      if (s === first) advance(t, now, r);
      else act(t, s, choicesFor(t, s)!.canCheck ? 'check' : 'call', now);
    }
  }
  assert.equal(t.seats[first].sittingOut, true);
  // Sat out: on their turn the deadline is now, so the clock acts at once.
  now = t.hand!.nextAt! + 1;
  advance(t, now, r);
  for (let guard = 0; guard < 10 && t.hand!.toAct !== first && t.hand!.street !== 'done'; guard++) {
    const s = t.hand!.toAct!;
    act(t, s, choicesFor(t, s)!.canCheck ? 'check' : 'call', now);
  }
  if (t.hand!.toAct === first) assert.equal(t.hand!.deadline, now);
  assert.ok(sitIn(t, t.seats[first].userId));
  assert.equal(t.seats[first].sittingOut, false);
  assert.equal(total(t), 4500);
});

check('the clock closes the table after the hand in play; chips decide the order', () => {
  let now = 1_000_000;
  const t = table(4, now, undefined, 1);
  const r = seeded(5);
  now = t.endsAt + 1; // time is up mid-hand
  assert.equal(t.status, 'playing');
  while (t.hand!.street !== 'done') {
    const s = t.hand!.toAct!;
    act(t, s, choicesFor(t, s)!.canCheck ? 'check' : 'call', now);
  }
  assert.equal(t.status, 'playing', 'the hand in play finishes');
  advance(t, t.hand!.nextAt! + 1, r);
  assert.equal(t.status, 'over');
  const st = t.standings!;
  assert.equal(st.length, 4);
  for (let i = 1; i < st.length; i++) assert.ok(st[i - 1].stack >= st[i].stack);
  assert.equal(st.reduce((a, s) => a + s.stack, 0), 6000);
});

check('blinds rise on the clock', () => {
  let now = 1_000_000;
  const t = table(3, now, undefined, 1);
  const r = seeded(6);
  assert.deepEqual(t.hand!.level, { sb: 10, bb: 20 });
  now += 2 * 60_000 + 1;
  while (t.hand!.street !== 'done') act(t, t.hand!.toAct!, 'fold', now);
  advance(t, t.hand!.nextAt! + 1, r);
  assert.deepEqual(t.hand!.level, { sb: 20, bb: 40 });
});

check('a spectator sees no hole cards until a showdown; a player sees only theirs', () => {
  const now = 1_000_000;
  const t = table(3, now, undefined, 1);
  const watch = viewFor(t, null, now);
  assert.ok(watch.seats.every((s) => s.cards === null));
  assert.equal(watch.choices, null);
  const mine = viewFor(t, 'u0', now);
  assert.equal(mine.seats[0].cards!.length, 2);
  assert.ok(mine.seats.filter((s) => !s.me).every((s) => s.cards === null));
});

check('300 random tables to the end: chips never made or lost, stacks never negative, every table closes', () => {
  for (let k = 0; k < 300; k++) {
    const r = seeded(1000 + k);
    let now = 1_000_000;
    const n = 2 + (k % 5);
    const t = newTable({ id: `t${k}`, org: 'o', eventId: 'e', round: 'open', players: players(n) }, now, r);
    const chips = n * 1500;
    for (let guard = 0; guard < 5000 && t.status === 'playing'; guard++) {
      const h = t.hand!;
      if (h.street === 'done') {
        now = h.nextAt! + 1;
        advance(t, now, r);
        continue;
      }
      const seat = h.toAct!;
      const c = choicesFor(t, seat)!;
      const roll = r();
      now += 1000 + Math.floor(r() * 4000);
      if (roll < 0.05) {
        now = h.deadline! + 1;
        advance(t, now, r);
      } else if (roll < 0.2) act(t, seat, 'fold', now);
      else if (roll < 0.3 && c.canRaise) act(t, seat, 'allin', now);
      else if (roll < 0.5 && c.canRaise) act(t, seat, 'raise', now, c.minRaiseTo + Math.floor(r() * (c.maxRaiseTo - c.minRaiseTo)));
      else act(t, seat, c.canCheck ? 'check' : 'call', now);
      assert.equal(total(t), chips, `table ${k}: chips`);
      assert.ok(t.seats.every((s) => s.stack >= 0));
    }
    assert.equal(t.status, 'over', `table ${k} closed`);
    assert.equal(t.standings!.reduce((a, s) => a + s.stack, 0), chips);
    const knockouts = t.seats.reduce((a, s) => a + s.knockouts.length, 0);
    assert.equal(knockouts, t.seats.filter((s) => s.bustedBy !== null).length);
  }
});

// ------------------------------------------------------------------ the floor

const day = (hhmm: string) => `2026-11-06T${hhmm}:00+05:30`;
const ms = (hhmm: string) => Date.parse(day(hhmm));
function event(over: Partial<PokerEvent> = {}): PokerEvent {
  return {
    id: 'e1',
    org: 'convrse',
    name: 'Convrse Speed Poker',
    catalogKey: 'speed-poker',
    status: 'live',
    paused: false,
    config: {
      ...DEFAULT_CONFIG,
      practice: { from: '2026-11-05T10:00:00+05:30', to: '2026-11-05T17:00:00+05:30' },
      game: { openFrom: day('10:30'), openTo: day('16:00'), powerFrom: day('13:00'), powerTo: day('14:00'), bountiesFrom: day('15:00'), semisAt: day('16:30'), finalAt: day('17:15') },
    },
    semis: null,
    final: null,
    champion: null,
    postId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

check('phases through the two days, and the host switches', () => {
  const e = event();
  assert.equal(phaseOf(e, Date.parse('2026-11-05T09:00:00+05:30')), 'upcoming');
  assert.equal(phaseOf(e, Date.parse('2026-11-05T12:00:00+05:30')), 'practice');
  assert.equal(playMode(e, Date.parse('2026-11-05T12:00:00+05:30')), 'practice');
  assert.equal(phaseOf(e, Date.parse('2026-11-05T18:00:00+05:30')), 'between');
  assert.equal(phaseOf(e, ms('11:00')), 'open');
  assert.equal(playMode(e, ms('11:00')), 'scored');
  assert.equal(phaseOf(e, ms('16:05')), 'semis-soon');
  assert.equal(playMode(e, ms('16:05')), null);
  assert.equal(playMode({ ...e, paused: true }, ms('11:00')), null);
  assert.equal(phaseOf({ ...e, status: 'draft' }, ms('11:00')), 'draft');
  const stage = { seededAt: 1, startedAt: 2, endedAt: null, tables: [] };
  assert.equal(phaseOf({ ...e, semis: stage }, ms('16:31')), 'semis');
  assert.equal(phaseOf({ ...e, semis: { ...stage, endedAt: 3 } }, ms('16:55')), 'final-soon');
  assert.equal(phaseOf({ ...e, semis: { ...stage, endedAt: 3 }, final: { ...stage } }, ms('17:20')), 'final');
  assert.equal(phaseOf({ ...e, semis: { ...stage, endedAt: 3 }, final: { ...stage, endedAt: 4 } }, ms('17:50')), 'over');
  assert.ok(powerHourAt(e.config, ms('13:30')) && !powerHourAt(e.config, ms('14:00')));
  assert.ok(bountiesOnAt(e.config, ms('15:10')) && !bountiesOnAt(e.config, ms('14:59')));
});

const entry = (i: number, since: number, played = 0): QueueEntry => ({ userId: `q${i}`, name: `Q${i}`, photoUrl: null, office: 'Noida', since, played });

check('seating: six makes a table at once; a short table only after the wait; never fewer than four', () => {
  const c = event().config;
  const now = ms('11:00');
  const six = Array.from({ length: 6 }, (_, i) => entry(i, now - 1000));
  assert.equal(formTables(six, now, c, seeded(1)).tables.length, 1);
  const five = Array.from({ length: 5 }, (_, i) => entry(i, now - 60_000));
  assert.equal(formTables(five, now, c, seeded(1)).tables.length, 0);
  const waited = Array.from({ length: 5 }, (_, i) => entry(i, now - 6 * 60_000));
  assert.equal(formTables(waited, now, c, seeded(1)).tables[0].length, 5);
  const three = Array.from({ length: 3 }, (_, i) => entry(i, now - 10 * 60_000));
  const r = formTables(three, now, c, seeded(1));
  assert.equal(r.tables.length, 0);
  assert.equal(r.rest.length, 3);
});

check('seating: first-timers before regulars; past the six counted tables, last; big queues split friends', () => {
  const c = event().config;
  const now = ms('13:05');
  const queue = [entry(1, now - 9000, 4), entry(2, now - 8000, 4), entry(3, now - 7000, 0), entry(4, now - 6000, 6), entry(5, now - 5000, 1), entry(6, now - 4000, 0), entry(7, now - 3000, 2)];
  const order = queueOrder(queue, c.countedTables).map((e) => e.userId);
  assert.deepEqual(order, ['q3', 'q6', 'q5', 'q7', 'q1', 'q2', 'q4']);
  const { tables, rest } = formTables(queue, now, c, seeded(2));
  assert.equal(tables.length, 1);
  assert.deepEqual(rest.map((e) => e.userId), ['q4'], 'the seventh-table player waits');
  const twelve = Array.from({ length: 12 }, (_, i) => entry(i, now - 12_000 + i * 1000));
  const two = formTables(twelve, now, c, seeded(3)).tables;
  assert.equal(two.length, 2);
  // q0 and q1 queued together: dealt to different tables.
  const tableOf = (id: string) => two.findIndex((t) => t.some((e) => e.userId === id));
  assert.notEqual(tableOf('q0'), tableOf('q1'));
});

function finishedTable(round: 'open' | 'practice' | 'semi' | 'final', meta: PokerTable['meta'], stacks: number[], knockouts: string[][] = []): PokerTable {
  const t = newTable({ id: `t-${round}`, org: 'convrse', eventId: 'e1', round, label: round === 'semi' ? 'A' : null, players: players(stacks.length) }, 1, seeded(9));
  t.meta = meta;
  t.seats.forEach((s, i) => {
    s.stack = stacks[i];
    s.knockouts = knockouts[i] ?? [];
    s.bustedAt = stacks[i] === 0 ? 100 + i : null;
  });
  t.hand = null;
  finish(t, 2);
  return t;
}

check('a table\'s points: chips, knockouts, a bounty worth more, doubled in the power hour; practice is worth nothing', () => {
  const c = event().config;
  const t = finishedTable('open', { power: false, bounties: ['u2'], counted: {}, bots: [] }, [3000, 1500, 0], [['u2'], [], []]);
  const pts = Object.fromEntries(scoreTable(t, c).map((r) => [r.userId, r.points]));
  assert.equal(pts.u0, 3000 + 300, 'knocked out the bounty holder');
  assert.equal(pts.u1, 1500);
  assert.equal(pts.u2, 0, 'busted: no chips');
  const p = finishedTable('open', { power: true, bounties: [], counted: {}, bots: [] }, [2000, 2500], [['x'], []]);
  assert.equal(scoreTable(p, c).find((r) => r.userId === 'u0')!.points, (2000 + 100) * 2);
  const practice = finishedTable('practice', { power: false, bounties: [], counted: {}, bots: ['bot:1'] }, [3000, 1500]);
  assert.ok(scoreTable(practice, c).every((r) => r.points === 0 && !r.counted));
  const extra = finishedTable('open', { power: false, bounties: [], counted: { u0: false }, bots: [] }, [3000, 1500]);
  assert.equal(scoreTable(extra, c).find((r) => r.userId === 'u0')!.counted, false, 'a seventh table does not count');
});

check('the board: best three counted tables, ties ranked together, voided and practice left out', () => {
  const r = (userId: string, points: number, extra: Partial<PokerResult> = {}) => ({ userId, name: userId, office: userId === 'a' ? 'Kolkata' : 'Noida', round: 'open' as const, counted: true, points, knockouts: [], voided: false, at: new Date(1000), ...extra });
  const board = boardOf([r('a', 100), r('a', 900), r('a', 400), r('a', 800), r('b', 2100), r('c', 2100), r('d', 5000, { voided: true }), r('e', 9000, { round: 'practice' }), r('f', 9000, { counted: false })], { bestOf: 3 });
  assert.deepEqual(board.map((x) => [x.userId, x.score, x.rank]), [
    ['a', 2100, 1],
    ['b', 2100, 1],
    ['c', 2100, 1],
  ]);
  assert.deepEqual(board[0].best, [900, 800, 400]);
  const league = officeLeague(board);
  assert.deepEqual(league.map((o) => [o.office, o.average, o.players]), [
    ['Noida', 2100, 2],
    ['Kolkata', 2100, 1],
  ]);
});

check('semifinal seeding snakes the top twelve; the final takes the top three of each', () => {
  const e = event();
  const board = Array.from({ length: 14 }, (_, i) => ({ userId: `p${i + 1}`, name: `P${i + 1}`, office: null, played: 3, best: [], score: 10000 - i, knockouts: 0, rank: i + 1, reachedAt: 0 }));
  const semis = seedSemis(board, { ...e.config, exclude: ['p3'] }, 5);
  assert.deepEqual(semis.tables[0].players, ['p1', 'p5', 'p6', 'p9', 'p10', 'p13']);
  assert.deepEqual(semis.tables[1].players, ['p2', 'p4', 'p7', 'p8', 'p11', 'p12']);
  const a = finishedTable('semi', undefined, [4000, 3000, 1000, 500, 0, 500]);
  a.label = 'A';
  const b = finishedTable('semi', undefined, [100, 6000, 2000, 0, 900, 0]);
  b.label = 'B';
  const final = seedFinal([b, a], e.config, 6);
  assert.deepEqual(final.tables[0].players, ['u0', 'u1', 'u2', 'u1', 'u2', 'u4']);
});

check('picks: open in the window, within the budget, never on your own round, settled at the odds', () => {
  const players6 = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'];
  const e = event({ semis: { seededAt: 1, startedAt: null, endedAt: null, tables: [{ label: 'A', tableId: 't-semi', players: players6 }, { label: 'B', tableId: null, players: ['v0', 'v1'] }] } });
  const me = { userId: 'w', name: 'Watcher' };
  assert.throws(() => makePick(e, me, { stage: 'semi', table: 'A', kind: 'winner', choice: 'u1', stake: 100 }, [], ms('16:00'), 'p'), PokerPickError, 'too early');
  const now = ms('16:20');
  const p1 = makePick(e, me, { stage: 'semi', table: 'A', kind: 'winner', choice: 'u1', stake: 300 }, [], now, 'p1');
  assert.throws(() => makePick(e, me, { stage: 'semi', table: 'A', kind: 'firstOut', choice: 'u2', stake: 300 }, [p1], now, 'p2'), PokerPickError, 'over budget');
  const p2 = makePick(e, me, { stage: 'semi', table: 'A', kind: 'firstOut', choice: 'u4', stake: 200 }, [p1], now, 'p2');
  assert.throws(() => makePick(e, { userId: 'u3', name: 'U3' }, { stage: 'semi', table: 'B', kind: 'winner', choice: 'v0', stake: 50 }, [], now, 'p3'), PokerPickError, 'a semifinalist');
  assert.throws(() => makePick(e, me, { stage: 'semi', table: 'A', kind: 'fullTime', choice: 'yes', stake: 50 }, [], now, 'p4'), PokerPickError);
  assert.throws(() => makePick({ ...e, semis: { ...e.semis!, startedAt: now } }, me, { stage: 'semi', table: 'A', kind: 'winner', choice: 'u1', stake: 10 }, [], now, 'p5'), PokerPickError, 'closed at the start');
  const t = finishedTable('semi', undefined, [500, 6000, 2000, 1000, 0, 1500]);
  t.seats[4].bustedAt = 50;
  const paid = settlePicks([p1, p2], t, e.config);
  assert.equal(paid.get('p1'), 300 * 5);
  assert.equal(paid.get('p2'), 200 * 3);
  const board = picksBoard([{ ...p1, payout: 1500 }, { ...p2, payout: 600 }]);
  assert.equal(board[0].won, 2100);
});

check('a practice table with house players plays itself to the end', () => {
  const r = seeded(77);
  let now = 1_000_000;
  const t = newTable({ id: 'tp', org: 'o', eventId: 'e', round: 'practice', players: [players(1)[0], ...HOUSE_PLAYERS] }, now, r);
  t.meta = { power: false, bounties: [], counted: {}, bots: HOUSE_PLAYERS.map((h) => h.userId) };
  for (let guard = 0; guard < 5000 && t.status === 'playing'; guard++) {
    const h = t.hand!;
    now += 2000;
    if (h.street === 'done') {
      advance(t, h.nextAt! + 1, r);
      continue;
    }
    const seat = h.toAct!;
    const who = t.seats[seat].userId;
    if (isHouse(who)) applyAction(t, who, houseMove(t, seat, r), now);
    else act(t, seat, choicesFor(t, seat)!.canCheck ? 'check' : 'call', now);
    assert.equal(total(t), 6000);
  }
  assert.equal(t.status, 'over');
});

// ------------------------------------------------------------------ the group game's rooms

check('a drop-in sits out the hand in play and is dealt the next one, with 1,500', () => {
  const now = 1_000_000;
  const t = newTable({ id: 'tc', org: 'o', eventId: '', round: 'casual', players: players(3) }, now, seeded(3));
  assert.equal(t.config.durationMs, 20 * 60_000);
  assert.ok(addSeat(t, { userId: 'late', name: 'Late', photoUrl: null, office: null }, now));
  const v = viewFor(t, 'late', now);
  assert.equal(v.seats.length, 4);
  assert.equal(v.seats[3].inHand, false);
  assert.equal(v.seats[3].bet, 0);
  assert.equal(v.choices, null);
  // Fold the hand round to its end, then the next deal includes the newcomer.
  for (let guard = 0; guard < 10 && t.hand!.street !== 'done'; guard++) act(t, t.hand!.toAct!, 'fold', now);
  advance(t, t.hand!.nextAt! + 1, seeded(4));
  assert.equal(t.hand!.no, 2);
  assert.equal(t.hand!.inHand[3], true);
  assert.equal(total(t), 4 * 1500);
});

check('a full table takes no drop-in; a seat someone left is reused once out of the hand', () => {
  const now = 1_000_000;
  const t = newTable({ id: 'tf', org: 'o', eventId: '', round: 'casual', players: players(6) }, now, seeded(5));
  assert.equal(addSeat(t, { userId: 'x', name: 'X', photoUrl: null, office: null }, now), false);
  const leaver = t.seats.findIndex((_, i) => i !== t.hand!.toAct);
  leaveSeat(t, t.seats[leaver].userId, now);
  assert.equal(t.hand!.folded[leaver], true);
  assert.equal(addSeat(t, { userId: 'x', name: 'X', photoUrl: null, office: null }, now), false, 'still in the hand in play');
  for (let guard = 0; guard < 10 && t.hand!.street !== 'done'; guard++) act(t, t.hand!.toAct!, 'fold', now);
  advance(t, t.hand!.nextAt! + 1, seeded(6));
  assert.equal(t.hand!.inHand[leaver], false, 'a leaver is dealt no more');
  assert.ok(addSeat(t, { userId: 'x', name: 'X', photoUrl: null, office: null }, now));
  assert.equal(t.seats[leaver].userId, 'x');
});

check('leaving out of turn folds the hand; the last one left wins the pot; heads-up leave ends the table', () => {
  const now = 1_000_000;
  const t = newTable({ id: 'tl', org: 'o', eventId: '', round: 'casual', players: players(3) }, now, seeded(7));
  const toAct = t.hand!.toAct!;
  const others = [0, 1, 2].filter((i) => i !== toAct);
  leaveSeat(t, t.seats[others[0]].userId, now);
  assert.notEqual(t.hand!.street, 'done');
  leaveSeat(t, t.seats[others[1]].userId, now);
  assert.equal(t.hand!.street, 'done');
  assert.deepEqual(t.hand!.result!.pots[0].winners, [toAct]);
  assert.equal(total(t), 3 * 1500);
  advance(t, t.hand!.nextAt! + 1, seeded(8));
  assert.equal(t.status, 'over');
  assert.equal(t.standings![0].userId, t.seats[toAct].userId);
  assert.ok(t.standings!.slice(1).every((s) => s.left));
});

check('a leaver who comes back gets their own seat and the chips they left with', () => {
  const now = 1_000_000;
  const t = newTable({ id: 'tb', org: 'o', eventId: '', round: 'casual', players: players(3) }, now, seeded(9));
  const seat = t.seats.findIndex((_, i) => i !== t.hand!.toAct);
  const id = t.seats[seat].userId;
  leaveSeat(t, id, now);
  const kept = t.seats[seat].stack;
  for (let guard = 0; guard < 10 && t.hand!.street !== 'done'; guard++) act(t, t.hand!.toAct!, 'fold', now);
  advance(t, t.hand!.nextAt! + 1, seeded(10));
  assert.ok(addSeat(t, players(3)[seat], now));
  assert.equal(t.seats.filter((s) => s.userId === id).length, 1);
  assert.equal(t.seats[seat].stack, kept);
  assert.equal(Boolean(t.seats[seat].left), false);
});

const host = { userId: 'h', name: 'Hana Host', photoUrl: null, office: null };
const guest = (i: number) => ({ userId: `g${i}`, name: `Guest ${i}`, photoUrl: null, office: null });

check('room codes: four digits, room:4821 or 4821', () => {
  assert.equal(parseCode('room:4821'), '4821');
  assert.equal(parseCode(' 4821 '), '4821');
  assert.equal(parseCode('0821'), null);
  assert.equal(parseCode('48211'), null);
});

check('a room: one person cannot deal; a house player makes two; the host picks the length', () => {
  const now = 1_000_000;
  const r = newRoom('4821', 'sowaka', host, now);
  assert.equal(r.open, true);
  assert.throws(() => startGame(r, now, seeded(1)), PokerRoomRuleError);
  assert.equal(applySettings(r, { minutes: 15 }), null);
  assert.equal(applySettings(r, { minutes: 10, open: false }), true);
  assert.ok(changeHouse(r, 1));
  startGame(r, now, seeded(1));
  assert.equal(r.status, 'playing');
  assert.equal(r.table!.seats.length, 2);
  assert.equal(r.table!.endsAt - r.table!.startedAt, 10 * 60_000);
  assert.equal(applySettings(r, { minutes: 20 }), null, 'not mid-game');
});

check('a room: six places at most (people and house players), a full lobby deals itself', () => {
  const now = 1_000_000;
  const r = newRoom('4822', 'sowaka', host, now, { house: 2 });
  for (let i = 0; i < 2; i++) addPlayer(r, guest(i), now, false);
  assert.equal(advanceRoom(r, now, seeded(2), 1000), null, 'five: waits for the host');
  addPlayer(r, guest(3), now, false);
  assert.throws(() => addPlayer(r, guest(4), now, false), PokerRoomRuleError);
  assert.equal(changeHouse(r, 1), false);
  const effects = advanceRoom(r, now + 500, seeded(2), 1000);
  assert.ok(effects && effects.some((e) => e.type === 'feed' && e.item.kind === 'start'));
  assert.equal(r.table!.seats.length, 6);
});

check('a room: someone who joins mid-game is dealt in from the next hand; a leaver folds and goes', () => {
  let now = 1_000_000;
  const r = newRoom('4823', 'sowaka', host, now);
  addPlayer(r, guest(1), now, false);
  startGame(r, now, seeded(11));
  addPlayer(r, guest(2), now, false);
  assert.equal(r.table!.seats.length, 3);
  assert.equal(roomViewFor(r, 'g2', now).waiting, false);
  assert.equal(roomViewFor(r, 'g2', now).table!.seats[2].inHand, false);
  const effects = removePlayer(r, 'h', 'leave', null, now);
  assert.equal(r.hostId, 'g1', 'the host role passes on');
  assert.ok(effects.some((e) => e.type === 'feed' && e.item.kind === 'host'));
  assert.ok(r.table!.seats[0].left);
  // On to the next deal: the newcomer plays, the leaver does not.
  for (let guard = 0; guard < 20 && r.table!.hand!.no === 1; guard++) {
    now += 25_000;
    advanceRoom(r, now, seeded(12), 1000);
  }
  assert.equal(r.table!.hand!.inHand[2], true);
  assert.equal(r.table!.hand!.inHand[0], false);
  assert.equal(summaryOf(r, now).players.length, 2);
});

check('a room against the house plays itself to the end; the host deals again with chips reset', () => {
  let now = 1_000_000;
  const r = newRoom('4824', 'sowaka', host, now, { open: false, house: ROOMS.practiceHouse });
  startGame(r, now, seeded(13));
  const r13 = seeded(14);
  for (let guard = 0; guard < 4000 && r.status === 'playing'; guard++) {
    now += 1500;
    const h = r.table!.hand!;
    if (h.street !== 'done' && r.table!.seats[h.toAct!].userId === 'h') {
      const c = choicesFor(r.table!, h.toAct!)!;
      applyAction(r.table!, 'h', { kind: c.canCheck ? 'check' : 'call' }, now);
    }
    advanceRoom(r, now, r13, 1000);
    assert.equal(total(r.table!), 4 * 1500);
  }
  assert.equal(r.status, 'over');
  assert.ok(r.table!.standings!.length === 4);
  resetToLobby(r);
  assert.equal(r.status, 'lobby');
  assert.equal(r.table, null);
  startGame(r, now, seeded(15));
  assert.equal(r.gameNo, 2);
  assert.ok(r.table!.seats.every((s) => s.stack + (r.table!.hand!.committed[r.table!.seats.indexOf(s)] ?? 0) === 1500));
});

check('a room: a player away for ten seconds sits out so the table does not wait; nobody left closes it', () => {
  let now = 1_000_000;
  const r = newRoom('4825', 'sowaka', host, now);
  addPlayer(r, guest(1), now, false);
  startGame(r, now, seeded(16));
  const away = r.players[1];
  away.online = false;
  away.offlineAt = now;
  now += ROOMS.seatGoneMs + 1;
  advanceRoom(r, now, seeded(17), 1000);
  assert.ok(r.table!.seats.find((s) => s.userId === 'g1')!.sittingOut);
  r.players[0].online = false;
  r.players[0].offlineAt = now;
  const gone = advanceRoom(r, now + ROOMS.playingIdleMs + 1, seeded(18), 1000);
  assert.ok(gone && gone.some((e) => e.type === 'delete'));
});

console.log(`\n${passed} poker checks passed.`);
