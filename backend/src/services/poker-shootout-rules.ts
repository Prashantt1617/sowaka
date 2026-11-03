/**
 * The Speed Poker Shootout's rules, with no database: how many rounds a
 * headcount makes, random seating, who starts on 1,500, and how a table, the
 * qualifier and the whole tournament are ranked. Ported from the Shootout
 * developer handoff's reference logic; `scripts/poker-shootout-check.ts`
 * runs its test cases. `poker-room.service.ts` does the reading and writing.
 *
 * The live Speed Poker table is unchanged: it plays the hands and records
 * each bust (the hand it was on, the stack going into it); this decides
 * everything around it.
 */
import type { PokerTable } from '../models/poker.model';

export const SHOOTOUT = {
  /** Seats per table. */
  TABLE_SIZE: 8,
  /** The last this many at each knockout table go through. */
  ADVANCE: 4,
  /** Everyone, every round. */
  START_STACK: 1000,
  /** Last round's table winners. */
  WINNER_STACK: 1500,
  /** What a qualifier cuts the field to. */
  TARGETS: [8, 16, 32, 64, 128],
  /** Fewer in the lobby: the tournament is called off. */
  MIN_PLAYERS: 3,
} as const;

export type ShootoutRoundKind = 'qualifier' | 'knockout' | 'final';

export interface ShootoutPlannedRound {
  kind: ShootoutRoundKind;
  name: string;
  players: number;
  /** Players per table. */
  tables: number[];
  /** A qualifier: how many go through in all; a knockout: per table; the final: 1. */
  advance: number;
}

/** A random number in [0, 1). */
export type Rng = () => number;

/** n players across t tables as evenly as possible: [8, 8, 7]. */
export function splitSizes(n: number, t: number): number[] {
  const base = Math.floor(n / t);
  const extra = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < extra ? 1 : 0));
}

export function roundName(players: number): string {
  if (players <= 16) return 'Semi-finals';
  if (players <= 32) return 'Quarter-finals';
  return `Round of ${players}`;
}

/**
 * The rounds for n players, decided when the lobby closes: a qualifier only
 * when n is not already a field the knockouts can take (8 or fewer, 12–16,
 * 32, 64, 128), knockouts of full tables keeping the last 4 of each, then
 * the final table. More than 128: no qualifier at all; everyone plays from
 * round 1, at tables of up to 8 keeping their last 4, round after round.
 */
export function planRounds(n: number): ShootoutPlannedRound[] {
  const S = SHOOTOUT;
  if (n < S.MIN_PLAYERS) throw new Error(`Need at least ${S.MIN_PLAYERS} players`);
  const rounds: ShootoutPlannedRound[] = [];
  if (n <= S.TABLE_SIZE) return [{ kind: 'final', name: 'Final table', players: n, tables: [n], advance: 1 }];
  let cur: number;
  if (n >= 12 && n <= 16) {
    // Two short tables, no qualifier.
    cur = n;
  } else if (n > S.TARGETS[S.TARGETS.length - 1]) {
    // A big field: everyone is through to round 1, no qualifier cut.
    cur = n;
  } else {
    const target = S.TARGETS.filter((t) => t <= n).pop()!;
    if (target < n) {
      rounds.push({ kind: 'qualifier', name: 'Qualifier', players: n, tables: splitSizes(n, Math.ceil(n / S.TABLE_SIZE)), advance: target });
    }
    cur = target;
  }
  while (cur > S.TABLE_SIZE) {
    // Full tables (after a qualifier the field is a multiple of 8); a big field's first rounds split as evenly as they go.
    const t = cur <= 16 ? 2 : Math.ceil(cur / S.TABLE_SIZE);
    rounds.push({ kind: 'knockout', name: roundName(cur), players: cur, tables: splitSizes(cur, t), advance: S.ADVANCE });
    cur = t * S.ADVANCE;
  }
  rounds.push({ kind: 'final', name: 'Final table', players: cur, tables: [cur], advance: 1 });
  return rounds;
}

/** Shuffled, then dealt round-robin, so the tables come out the sizes asked for. */
export function seatPlayers(playerIds: string[], tableSizes: number[], rng: Rng): string[][] {
  const ids = playerIds.slice();
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const tables: string[][] = tableSizes.map(() => []);
  ids.forEach((id, i) => tables[i % tableSizes.length].push(id));
  return tables;
}

/** Each player's stack for the next round: 1,500 for last round's table winners, 1,000 for everyone else. */
export function startingStacks(playerIds: string[], winners: string[] = []): Record<string, number> {
  const w = new Set(winners);
  return Object.fromEntries(playerIds.map((id) => [id, w.has(id) ? SHOOTOUT.WINNER_STACK : SHOOTOUT.START_STACK]));
}

/**
 * One table as the tournament reads it: who busted (on which hand, with what
 * stack going into it), who still holds chips, and a random number each,
 * drawn at seating, for exact ties.
 */
export interface ShootoutTableResult {
  players: string[];
  busts: { id: string; hand: number; stackBefore: number }[];
  survivors: Record<string, number>;
  draw: Record<string, number>;
}

/** A live or finished table, in that shape. */
export function resultOf(table: PokerTable, draw: Record<string, number>): ShootoutTableResult {
  const busts: ShootoutTableResult['busts'] = [];
  const survivors: Record<string, number> = {};
  for (const s of table.seats) {
    if (s.stack > 0) survivors[s.userId] = s.stack;
    else busts.push({ id: s.userId, hand: s.bustHand ?? 0, stackBefore: s.bustStack ?? 0 });
  }
  return { players: table.seats.map((s) => s.userId), busts, survivors, draw };
}

/**
 * Finishing order at one table, best first. Everyone with chips above every
 * busted player, most chips first; the busted, the later hand first, and on
 * the same hand the bigger stack going into it.
 */
export function finishingOrder(table: ShootoutTableResult): string[] {
  const d = table.draw;
  const alive = Object.keys(table.survivors).sort((a, b) => table.survivors[b] - table.survivors[a] || (d[b] ?? 0) - (d[a] ?? 0));
  const out = table.busts
    .slice()
    .sort((a, b) => b.hand - a.hand || b.stackBefore - a.stackBefore || (d[b.id] ?? 0) - (d[a.id] ?? 0))
    .map((b) => b.id);
  return alive.concat(out);
}

/** A knockout or final table: its order, who goes through, its winner. Played to one, or the clock (chips decide). */
export function settleTable(table: ShootoutTableResult, advance: number): { order: string[]; through: string[]; winner: string } {
  const order = finishingOrder(table);
  return { order, through: order.slice(0, advance), winner: order[0] };
}

/** During a knockout table: who is now sure to go through (nobody until only `advance` are left). */
export function throughSoFar(table: ShootoutTableResult, advance: number): string[] {
  if (Object.keys(table.survivors).length > advance) return [];
  return finishingOrder(table).slice(0, advance);
}

/**
 * The qualifier, every table together: chips first (most first), then the
 * busted by the stack they lost with, then the later bust, then the draw.
 */
export function rankQualifier(tables: ShootoutTableResult[]): string[] {
  const rows: { id: string; alive: number; chips: number; hand: number; stack: number; draw: number }[] = [];
  for (const t of tables) {
    for (const id of Object.keys(t.survivors)) rows.push({ id, alive: 1, chips: t.survivors[id], hand: Infinity, stack: 0, draw: t.draw[id] ?? 0 });
    for (const b of t.busts) rows.push({ id: b.id, alive: 0, chips: 0, hand: b.hand, stack: b.stackBefore, draw: t.draw[b.id] ?? 0 });
  }
  rows.sort((a, b) => b.alive - a.alive || b.chips - a.chips || b.stack - a.stack || b.hand - a.hand || b.draw - a.draw);
  return rows.map((r) => r.id);
}

/**
 * Everyone, champion first: a later round ranks higher; within a round, by
 * place at the table, then by the stack busted with. `history` is every round
 * played, in order.
 */
export function finalStandings(history: { kind: ShootoutRoundKind; tables: ShootoutTableResult[] }[]): string[] {
  const placed: string[] = [];
  const seen = new Set<string>();
  for (let r = history.length - 1; r >= 0; r--) {
    const round = history[r];
    let ids: string[];
    if (round.kind === 'qualifier') {
      ids = rankQualifier(round.tables);
    } else {
      const group: { id: string; place: number; stack: number }[] = [];
      for (const t of round.tables) {
        const stackOf = new Map(t.busts.map((b) => [b.id, b.stackBefore]));
        finishingOrder(t).forEach((id, place) => group.push({ id, place, stack: stackOf.get(id) ?? Infinity }));
      }
      group.sort((a, b) => a.place - b.place || b.stack - a.stack);
      ids = group.map((g) => g.id);
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        placed.push(id);
      }
    }
  }
  return placed;
}
