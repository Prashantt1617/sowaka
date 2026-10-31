import type {
  PokerActionKind,
  PokerHand,
  PokerHandResult,
  PokerLevel,
  PokerRound,
  PokerSeat,
  PokerStanding,
  PokerTable,
  PokerTableConfig,
} from '../models/poker.model';
import { bestHand, buildPots, cardName, compareScores, Random, shuffledDeck, splitPot } from './poker-rules';

/**
 * One Speed Poker table, with no I/O: no-limit Texas Hold'em at tournament
 * pace. Everything takes a table record and a clock and says what is true
 * now; the store applies it, the socket layer sends the views, and the check
 * script runs it against a clock it moves by hand.
 *
 * A table runs for its round's time with blinds rising on a clock. When the
 * time is up, the hand in play finishes and the table closes; chips decide
 * the order. A player who busts is out of this table. Fifteen seconds to act,
 * then the table checks for them if it can, else folds; two timeouts in a row
 * sit them out (their blinds still go in, their hands fold) until they tap
 * back in.
 */

const level = (sb: number, bb: number): PokerLevel => ({ sb, bb });

/** The three formats from the plan: open play 12 min, semifinals 20, the final 30. */
export const POKER_FORMATS: Record<PokerRound, PokerTableConfig> = {
  practice: {
    startStack: 1500,
    levels: [level(10, 20), level(20, 40), level(40, 80), level(75, 150), level(150, 300), level(300, 600), level(500, 1000)],
    levelMs: 2 * 60_000,
    actionMs: 15_000,
    durationMs: 12 * 60_000,
    handPauseMs: 3500,
  },
  open: {
    startStack: 1500,
    levels: [level(10, 20), level(20, 40), level(40, 80), level(75, 150), level(150, 300), level(300, 600), level(500, 1000)],
    levelMs: 2 * 60_000,
    actionMs: 15_000,
    durationMs: 12 * 60_000,
    handPauseMs: 3500,
  },
  semi: {
    startStack: 1500,
    levels: [level(25, 50), level(50, 100), level(75, 150), level(100, 200), level(150, 300), level(250, 500), level(400, 800), level(600, 1200), level(1000, 2000), level(1500, 3000)],
    levelMs: 2 * 60_000,
    actionMs: 15_000,
    durationMs: 20 * 60_000,
    handPauseMs: 4500,
  },
  // A room's game: the host picks 10, 20 or 30 minutes; blinds rise a little slower.
  casual: {
    startStack: 1500,
    levels: [level(10, 20), level(20, 40), level(30, 60), level(50, 100), level(75, 150), level(100, 200), level(150, 300), level(200, 400), level(300, 600), level(500, 1000)],
    levelMs: 3 * 60_000,
    actionMs: 20_000,
    durationMs: 20 * 60_000,
    handPauseMs: 3500,
  },
  final: {
    startStack: 1500,
    levels: [level(50, 100), level(75, 150), level(100, 200), level(150, 300), level(250, 500), level(400, 800), level(600, 1200), level(1000, 2000), level(1500, 3000), level(2500, 5000)],
    levelMs: 3 * 60_000,
    actionMs: 15_000,
    durationMs: 30 * 60_000,
    handPauseMs: 5000,
  },
};

export const SEATS_MAX = 6;
/** Timeouts in a row before a player is sat out. */
export const TIMEOUTS_TO_SIT_OUT = 2;

export class PokerMoveError extends Error {
  constructor(public readonly code: 'not-your-turn' | 'no-hand' | 'cannot-check' | 'cannot-raise' | 'raise-too-small' | 'bad-action' | 'not-seated') {
    super(code);
  }
}

export interface NewTableInput {
  id: string;
  org: string;
  eventId: string;
  round: PokerRound;
  label?: string | null;
  players: Pick<PokerSeat, 'userId' | 'name' | 'photoUrl' | 'office'>[];
  /** A format other than the round's own (the host's settings). */
  config?: Partial<PokerTableConfig>;
}

export function newTable(input: NewTableInput, now: number, random: Random, deck?: number[]): PokerTable {
  if (input.players.length < 2 || input.players.length > SEATS_MAX) throw new Error('A table seats 2 to 6');
  const config = { ...POKER_FORMATS[input.round], ...(input.config ?? {}) };
  const table: PokerTable = {
    id: input.id,
    org: input.org,
    eventId: input.eventId,
    round: input.round,
    label: input.label ?? null,
    status: 'playing',
    seats: input.players.map((p) => ({
      userId: p.userId,
      name: p.name,
      photoUrl: p.photoUrl ?? null,
      office: p.office ?? null,
      stack: config.startStack,
      sittingOut: false,
      timeouts: 0,
      knockouts: [],
      bustedAt: null,
      bustedBy: null,
    })),
    config,
    startedAt: now,
    endsAt: now + config.durationMs,
    handNo: 0,
    // The first button is drawn: the seat before it, so the next live seat is it.
    lastButton: Math.floor(random() * input.players.length) % input.players.length,
    hand: null,
    standings: null,
    overAt: null,
  };
  startHand(table, now, random, deck);
  return table;
}

export function levelIndexAt(table: PokerTable, now: number): number {
  const idx = Math.floor(Math.max(0, now - table.startedAt) / table.config.levelMs);
  return Math.min(idx, table.config.levels.length - 1);
}

export function levelAt(table: PokerTable, now: number): PokerLevel {
  return table.config.levels[levelIndexAt(table, now)];
}

/** When the blinds next go up, or null at the top level. */
export function nextLevelAt(table: PokerTable, now: number): number | null {
  const idx = levelIndexAt(table, now);
  if (idx >= table.config.levels.length - 1) return null;
  return table.startedAt + (idx + 1) * table.config.levelMs;
}

const live = (table: PokerTable) => table.seats.map((s, i) => (s.stack > 0 && s.bustedAt === null && !s.left ? i : -1)).filter((i) => i >= 0);

function nextOf(seats: number[], from: number, count: number): number {
  for (let step = 1; step <= count; step++) {
    const i = (from + step) % count;
    if (seats.includes(i)) return i;
  }
  return -1;
}

/**
 * Whether seat [i] still owes an action on this street: it faces a bet, or
 * has not acted since the last full raise while someone else can still bet.
 */
function needsAction(hand: PokerHand, i: number): boolean {
  if (!hand.inHand[i] || hand.folded[i] || hand.allIn[i]) return false;
  if (hand.streetIn[i] < hand.currentBet) return true;
  if (canActCount(hand) <= 1) return false;
  return !hand.acted[i];
}

/** The next seat after [from] that owes an action, or null when the street is settled. */
function nextNeeding(hand: PokerHand, from: number): number | null {
  const n = hand.inHand.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (needsAction(hand, i)) return i;
  }
  return null;
}

function put(table: PokerTable, hand: PokerHand, seat: number, chips: number): number {
  const s = table.seats[seat];
  const paid = Math.min(chips, s.stack);
  s.stack -= paid;
  hand.streetIn[seat] += paid;
  hand.committed[seat] += paid;
  if (s.stack === 0) hand.allIn[seat] = true;
  return paid;
}

/** Deals the next hand, or closes the table when its time is up or one player is left. */
export function startHand(table: PokerTable, now: number, random: Random, deck?: number[]): void {
  const players = live(table);
  if (players.length < 2 || now >= table.endsAt) {
    finish(table, now);
    return;
  }
  const n = table.seats.length;
  const lvl = levelAt(table, now);
  const button = nextOf(players, table.lastButton, n);
  const headsUp = players.length === 2;
  const sb = headsUp ? button : nextOf(players, button, n);
  const bb = nextOf(players, sb, n);
  const inHand = table.seats.map((_, i) => players.includes(i));
  table.handNo += 1;
  const hand: PokerHand = {
    no: table.handNo,
    button,
    sb,
    bb,
    level: lvl,
    deck: deck ? [...deck] : shuffledDeck(random),
    hole: table.seats.map(() => null),
    board: [],
    street: 'preflop',
    toAct: null,
    deadline: null,
    currentBet: 0,
    minRaise: lvl.bb,
    streetIn: table.seats.map(() => 0),
    committed: table.seats.map(() => 0),
    inHand,
    folded: table.seats.map(() => false),
    allIn: table.seats.map(() => false),
    acted: table.seats.map(() => false),
    canRaise: table.seats.map(() => true),
    log: [],
    result: null,
    nextAt: null,
  };
  table.hand = hand;
  table.lastButton = button;
  // Two cards each, dealt from the small blind round.
  for (let k = 0; k < n; k++) {
    const seat = (sb + k) % n;
    if (inHand[seat]) hand.hole[seat] = [hand.deck.shift()!, hand.deck.shift()!];
  }
  const sbPaid = put(table, hand, sb, lvl.sb);
  hand.log.push({ seat: sb, kind: 'sb', amount: sbPaid, to: hand.streetIn[sb], street: 'preflop' });
  const bbPaid = put(table, hand, bb, lvl.bb);
  hand.log.push({ seat: bb, kind: 'bb', amount: bbPaid, to: hand.streetIn[bb], street: 'preflop' });
  hand.currentBet = Math.max(...hand.streetIn);
  // The first to act preflop is the next owing an action after the big blind
  // (heads up, that is the button, who posted the small blind).
  hand.toAct = bb;
  progress(table, now);
}

const stillIn = (hand: PokerHand) => hand.inHand.map((x, i) => (x && !hand.folded[i] ? i : -1)).filter((i) => i >= 0);
const canActCount = (hand: PokerHand) => stillIn(hand).filter((i) => !hand.allIn[i]).length;

/**
 * Moves the hand on from the seat in `toAct` (the one who just acted, or the
 * anchor at a deal): to the next player who owes an action, the next street,
 * the run-out when no more betting is possible, or the showdown.
 */
function progress(table: PokerTable, now: number): void {
  const hand = table.hand!;
  for (;;) {
    if (stillIn(hand).length === 1) {
      settle(table, now, false);
      return;
    }
    const next = nextNeeding(hand, hand.toAct ?? hand.button);
    if (next !== null) {
      hand.toAct = next;
      hand.deadline = table.seats[next].sittingOut ? now : now + table.config.actionMs;
      return;
    }
    if (hand.street === 'river' || canActCount(hand) <= 1) {
      while (hand.board.length < 5) hand.board.push(hand.deck.shift()!);
      settle(table, now, true);
      return;
    }
    hand.street = hand.street === 'preflop' ? 'flop' : hand.street === 'flop' ? 'turn' : 'river';
    const deal = hand.street === 'flop' ? 3 : 1;
    for (let k = 0; k < deal; k++) hand.board.push(hand.deck.shift()!);
    hand.streetIn = hand.streetIn.map(() => 0);
    hand.currentBet = 0;
    hand.minRaise = hand.level.bb;
    hand.acted = hand.acted.map(() => false);
    hand.canRaise = hand.canRaise.map(() => true);
    // After the flop the first to act is the first live seat after the button.
    hand.toAct = hand.button;
  }
}

/** Pays the pots: to the one player left, or by the best hands at a showdown. */
function settle(table: PokerTable, now: number, showdown: boolean): void {
  const hand = table.hand!;
  const n = table.seats.length;
  const result: PokerHandResult = { pots: [], shown: [], busted: [], showdown };
  const best = new Map<number, ReturnType<typeof bestHand>>();
  if (showdown) {
    for (const seat of stillIn(hand)) {
      const b = bestHand([...hand.hole[seat]!, ...hand.board]);
      best.set(seat, b);
      result.shown.push({ seat, cards: hand.hole[seat]!, best: b.cards, hand: b.name });
    }
  }
  const pots = buildPots(hand.committed, hand.folded);
  const lastPotOf = new Map<number, number>();
  pots.forEach((pot, idx) => {
    let winners: number[];
    let handName: string | null = null;
    if (!showdown) {
      winners = stillIn(hand);
    } else {
      let top: number[] = [];
      for (const seat of pot.eligible) {
        if (!top.length) top = [seat];
        else {
          const cmp = compareScores(best.get(seat)!.score, best.get(top[0])!.score);
          if (cmp > 0) top = [seat];
          else if (cmp === 0) top.push(seat);
        }
      }
      winners = top;
      handName = best.get(top[0])?.name ?? null;
    }
    // An uncontested slice (only its owner eligible) is a bet nobody called: it goes back.
    for (const [seat, chips] of splitPot(pot.amount, winners, hand.button, n)) table.seats[seat].stack += chips;
    result.pots.push({ amount: pot.amount, winners, hand: pot.eligible.length > 1 ? handName : null });
    for (const seat of pot.eligible) lastPotOf.set(seat, idx);
  });
  for (let seat = 0; seat < n; seat++) {
    const s = table.seats[seat];
    if (!hand.inHand[seat] || s.stack > 0 || s.bustedAt !== null) continue;
    const potIdx = lastPotOf.get(seat);
    const by = potIdx !== undefined ? result.pots[potIdx].winners.find((w) => w !== seat) ?? null : null;
    s.bustedAt = now;
    s.bustedBy = by !== null ? table.seats[by].userId : null;
    if (by !== null) table.seats[by].knockouts.push(s.userId);
    result.busted.push({ seat, by });
  }
  hand.result = result;
  hand.street = 'done';
  hand.toAct = null;
  hand.deadline = null;
  hand.nextAt = now + table.config.handPauseMs;
}

export interface PokerAction {
  kind: PokerActionKind;
  /** For a raise: the street total to raise to. */
  to?: number;
}

export function parseAction(raw: unknown): PokerAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'fold' && kind !== 'check' && kind !== 'call' && kind !== 'raise' && kind !== 'allin') return null;
  const to = typeof r.to === 'number' && Number.isFinite(r.to) ? Math.floor(r.to) : undefined;
  return { kind, to };
}

/** What the player to act may do now, with the raise range. */
export function choicesFor(table: PokerTable, seat: number) {
  const hand = table.hand;
  if (!hand || hand.street === 'done' || hand.toAct !== seat) return null;
  const s = table.seats[seat];
  const toCall = Math.max(0, hand.currentBet - hand.streetIn[seat]);
  const maxTo = hand.streetIn[seat] + s.stack;
  const minTo = Math.min(maxTo, hand.currentBet + hand.minRaise);
  const othersCanAct = canActCount(hand) > 1;
  return {
    toCall: Math.min(toCall, s.stack),
    canCheck: toCall === 0,
    canRaise: hand.canRaise[seat] && othersCanAct && maxTo > hand.currentBet,
    minRaiseTo: minTo,
    maxRaiseTo: maxTo,
    pot: hand.committed.reduce((a, b) => a + b, 0),
    currentBet: hand.currentBet,
  };
}

/** A player's action. Throws [PokerMoveError] when it is not theirs to make or not allowed. */
export function applyAction(table: PokerTable, userId: string, action: PokerAction, now: number, auto = false): void {
  const hand = table.hand;
  if (!hand || hand.street === 'done' || table.status !== 'playing') throw new PokerMoveError('no-hand');
  const seat = table.seats.findIndex((s) => s.userId === userId);
  if (seat < 0) throw new PokerMoveError('not-seated');
  if (hand.toAct !== seat) throw new PokerMoveError('not-your-turn');
  const s = table.seats[seat];
  const choice = choicesFor(table, seat)!;
  const street = hand.street as Exclude<typeof hand.street, 'done'>;
  if (!auto) {
    s.timeouts = 0;
    s.sittingOut = false;
  }
  let kind = action.kind;
  if (kind === 'allin') kind = choice.canRaise && choice.maxRaiseTo > hand.currentBet ? 'raise' : 'call';
  if (kind === 'raise' && action.kind === 'allin') action = { kind: 'raise', to: choice.maxRaiseTo };
  if (kind === 'call' && choice.toCall === 0) kind = 'check';
  switch (kind) {
    case 'fold':
      hand.folded[seat] = true;
      hand.log.push({ seat, kind: auto ? 'timeout' : 'fold', amount: 0, to: hand.streetIn[seat], street });
      break;
    case 'check':
      if (!choice.canCheck) throw new PokerMoveError('cannot-check');
      hand.log.push({ seat, kind: auto ? 'timeout' : 'check', amount: 0, to: hand.streetIn[seat], street });
      break;
    case 'call': {
      const paid = put(table, hand, seat, choice.toCall);
      hand.log.push({ seat, kind: hand.allIn[seat] ? 'allin' : 'call', amount: paid, to: hand.streetIn[seat], street });
      break;
    }
    case 'raise': {
      if (!choice.canRaise) throw new PokerMoveError('cannot-raise');
      let to = Math.min(action.to ?? choice.minRaiseTo, choice.maxRaiseTo);
      if (to < choice.minRaiseTo) throw new PokerMoveError('raise-too-small');
      if (to <= hand.currentBet) throw new PokerMoveError('raise-too-small');
      to = Math.floor(to);
      const raiseBy = to - hand.currentBet;
      const paid = put(table, hand, seat, to - hand.streetIn[seat]);
      const full = raiseBy >= hand.minRaise;
      for (let i = 0; i < table.seats.length; i++) {
        if (i === seat || !hand.inHand[i] || hand.folded[i] || hand.allIn[i]) continue;
        if (full) {
          hand.acted[i] = false;
          hand.canRaise[i] = true;
        } else if (hand.acted[i]) {
          // A short all-in: they must answer it, but may not re-raise.
          hand.acted[i] = false;
          hand.canRaise[i] = false;
        }
      }
      if (full) hand.minRaise = raiseBy;
      hand.currentBet = to;
      hand.log.push({ seat, kind: hand.allIn[seat] ? 'allin' : 'raise', amount: paid, to, street });
      break;
    }
    default:
      throw new PokerMoveError('bad-action');
  }
  hand.acted[seat] = true;
  progress(table, now);
}

/** A sat-out player is back: they act again from their next turn. */
export function sitIn(table: PokerTable, userId: string): boolean {
  const s = table.seats.find((x) => x.userId === userId);
  if (!s || !s.sittingOut) return false;
  s.sittingOut = false;
  s.timeouts = 0;
  return true;
}

/**
 * A room's drop-in: a new player takes a seat with the starting stack and is
 * dealt in from the next hand. A seat someone left is reused once it is out
 * of the hand in play; else a new seat, up to six. False when the table is full.
 */
export function addSeat(table: PokerTable, player: Pick<PokerSeat, 'userId' | 'name' | 'photoUrl' | 'office'>, now: number): boolean {
  if (table.status !== 'playing') return false;
  const existingAt = table.seats.findIndex((s) => s.userId === player.userId);
  if (existingAt >= 0 && !table.seats[existingAt].left) return true;
  const seat: PokerSeat = {
    userId: player.userId,
    name: player.name,
    photoUrl: player.photoUrl ?? null,
    office: player.office ?? null,
    stack: table.config.startStack,
    sittingOut: false,
    timeouts: 0,
    knockouts: [],
    bustedAt: null,
    bustedBy: null,
  };
  const hand = table.hand;
  // Back after leaving: their own old seat and the chips they left with
  // (leaving is no way to a fresh stack), once it is out of the hand in play.
  if (existingAt >= 0) {
    if (hand && hand.inHand[existingAt]) return false;
    const old = table.seats[existingAt];
    table.seats[existingAt] = { ...seat, stack: old.stack, knockouts: old.knockouts, bustedAt: old.stack > 0 ? null : old.bustedAt ?? now, bustedBy: old.bustedBy };
    return true;
  }
  const free = table.seats.findIndex((s, i) => s.left && (!hand || !hand.inHand[i]));
  if (free >= 0) {
    table.seats[free] = seat;
    return true;
  }
  if (table.seats.length >= SEATS_MAX) return false;
  table.seats.push(seat);
  return true;
}

/**
 * A room's leaver: their hand folds (at once, in or out of turn) and their
 * seat is dealt no more hands; the chips they had stay with the seat and
 * count for nothing. The table ends at the next deal if one player is left.
 */
export function leaveSeat(table: PokerTable, userId: string, now: number): boolean {
  const seat = table.seats.findIndex((s) => s.userId === userId);
  if (seat < 0 || table.seats[seat].left) return false;
  const s = table.seats[seat];
  s.left = true;
  s.sittingOut = true;
  const hand = table.hand;
  if (table.status === 'playing' && hand && hand.street !== 'done' && hand.inHand[seat] && !hand.folded[seat]) {
    const street = hand.street as Exclude<typeof hand.street, 'done'>;
    if (hand.toAct === seat) {
      hand.folded[seat] = true;
      hand.log.push({ seat, kind: 'fold', amount: 0, to: hand.streetIn[seat], street });
      hand.acted[seat] = true;
      progress(table, now);
    } else {
      hand.folded[seat] = true;
      hand.log.push({ seat, kind: 'fold', amount: 0, to: hand.streetIn[seat], street });
      if (stillIn(hand).length === 1) settle(table, now, false);
    }
  }
  return true;
}

/** Closes the table: chips decide the order, then who lasted longer, then knockouts. */
export function finish(table: PokerTable, now: number): void {
  if (table.status === 'over') return;
  table.status = 'over';
  table.overAt = now;
  if (table.hand && table.hand.street !== 'done') {
    // Only reached when a table is stopped by hand: the chips in play go back.
    table.hand.committed.forEach((c, i) => (table.seats[i].stack += c));
  }
  const order = table.seats
    .map((s) => s)
    .sort(
      (a, b) =>
        Number(Boolean(a.left)) - Number(Boolean(b.left)) ||
        b.stack - a.stack ||
        (b.bustedAt ?? Number.MAX_SAFE_INTEGER) - (a.bustedAt ?? Number.MAX_SAFE_INTEGER) ||
        b.knockouts.length - a.knockouts.length,
    );
  table.standings = order.map((s, i): PokerStanding => ({
    userId: s.userId,
    name: s.name,
    office: s.office,
    stack: s.stack,
    busted: s.stack === 0,
    knockouts: [...s.knockouts],
    place: i + 1,
    ...(s.left ? { left: true } : {}),
  }));
}

/**
 * What the clock does: a timed-out or sat-out player checks or folds, and a
 * finished hand gives way to the next deal (or the table's end). Returns
 * whether anything changed.
 */
export function advance(table: PokerTable, now: number, random: Random): boolean {
  let changed = false;
  for (let guard = 0; guard < 50; guard++) {
    if (table.status === 'over') return changed;
    const hand = table.hand;
    if (!hand) return changed;
    if (hand.street !== 'done' && hand.toAct !== null && hand.deadline !== null && now >= hand.deadline) {
      const seat = table.seats[hand.toAct];
      if (!seat.sittingOut) {
        seat.timeouts += 1;
        if (seat.timeouts >= TIMEOUTS_TO_SIT_OUT) seat.sittingOut = true;
      }
      const choice = choicesFor(table, hand.toAct)!;
      applyAction(table, seat.userId, { kind: choice.canCheck ? 'check' : 'fold' }, now, true);
      changed = true;
      continue;
    }
    if (hand.street === 'done' && hand.nextAt !== null && now >= hand.nextAt) {
      startHand(table, now, random);
      changed = true;
      continue;
    }
    return changed;
  }
  return changed;
}

/** The next moment the clock needs to look at this table, or null. */
export function nextWake(table: PokerTable): number | null {
  if (table.status === 'over' || !table.hand) return null;
  if (table.hand.street === 'done') return table.hand.nextAt;
  return table.hand.deadline;
}

// ------------------------------------------------------------------ views

export interface PokerSeatView {
  seat: number;
  userId: string;
  name: string;
  photoUrl: string | null;
  office: string | null;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  busted: boolean;
  /** Left the room mid-game (a room's table only). */
  left: boolean;
  inHand: boolean;
  button: boolean;
  sb: boolean;
  bb: boolean;
  toAct: boolean;
  me: boolean;
  /** The two cards: the viewer's own, or anyone's turned over at a showdown. */
  cards: string[] | null;
  knockouts: number;
  lastAction: string | null;
}

/**
 * The table as one person sees it ([viewerId] null for a spectator or the
 * screen): everyone's chips and actions, the board and the pot; only the
 * viewer's own cards, and others' only when turned over at a showdown.
 */
export function viewFor(table: PokerTable, viewerId: string | null, now: number) {
  const hand = table.hand;
  const mine = table.seats.findIndex((s) => s.userId === viewerId);
  const shown = new Map<number, string[]>();
  for (const s of hand?.result?.shown ?? []) shown.set(s.seat, s.cards.map(cardName));
  // Each seat's last move on this street (or in the hand, once it is over).
  const lastBy = new Map<number, string>();
  for (const entry of hand?.log ?? []) {
    if (hand?.street !== 'done' && entry.street !== hand?.street) continue;
    lastBy.set(entry.seat, entry.kind);
  }
  const seats: PokerSeatView[] = table.seats.map((s, i) => ({
    seat: i,
    userId: s.userId,
    name: s.name,
    photoUrl: s.photoUrl,
    office: s.office,
    stack: s.stack,
    bet: hand && hand.street !== 'done' ? hand.streetIn[i] ?? 0 : 0,
    folded: Boolean(hand?.folded[i]),
    allIn: Boolean(hand?.allIn[i]),
    sittingOut: s.sittingOut,
    busted: s.bustedAt !== null,
    left: Boolean(s.left),
    inHand: Boolean(hand?.inHand[i]),
    button: hand?.button === i,
    sb: hand?.sb === i,
    bb: hand?.bb === i,
    toAct: hand?.toAct === i,
    me: i === mine,
    cards: hand?.hole[i] ? (i === mine ? hand.hole[i]!.map(cardName) : shown.get(i) ?? null) : null,
    knockouts: s.knockouts.length,
    lastAction: lastBy.get(i) ?? null,
  }));
  const pot = hand ? hand.committed.reduce((a, b) => a + b, 0) : 0;
  return {
    id: table.id,
    round: table.round,
    label: table.label,
    status: table.status,
    now,
    startedAt: table.startedAt,
    endsAt: table.endsAt,
    level: levelAt(table, now),
    levelIndex: levelIndexAt(table, now),
    nextLevelAt: nextLevelAt(table, now),
    nextLevel: (() => {
      const idx = levelIndexAt(table, now);
      return table.config.levels[idx + 1] ?? null;
    })(),
    actionMs: table.config.actionMs,
    handNo: hand?.no ?? 0,
    street: hand?.street ?? null,
    board: hand ? hand.board.map(cardName) : [],
    pot,
    toAct: hand?.toAct ?? null,
    deadline: hand?.deadline ?? null,
    mySeat: mine >= 0 ? mine : null,
    choices: mine >= 0 ? choicesFor(table, mine) : null,
    seats,
    result: hand?.result
      ? {
          showdown: hand.result.showdown,
          pots: hand.result.pots.map((p) => ({ amount: p.amount, winners: p.winners, hand: p.hand })),
          shown: hand.result.shown.map((s) => ({ seat: s.seat, cards: s.cards.map(cardName), best: s.best.map(cardName), hand: s.hand })),
          busted: hand.result.busted,
        }
      : null,
    nextHandAt: hand?.nextAt ?? null,
    standings: table.standings,
  };
}

export type PokerTableView = ReturnType<typeof viewFor>;
