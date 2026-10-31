import type {
  PokerEvent,
  PokerEventConfig,
  PokerPhase,
  PokerPick,
  PokerPickKind,
  PokerResult,
  PokerStage,
  PokerTable,
} from '../models/poker.model';
import { bestHand, parseCard, rankOf, Random } from './poker-rules';
import { choicesFor, PokerAction } from './poker-engine';

/**
 * Speed Poker's event rules, with no I/O: the phase of the day from the
 * clock and the host's switches, who sits at the next table, what a table
 * is worth, the day's board and the office league, who goes to the
 * semifinals and the final, and the spectators' picks. The room service
 * applies them; the check script runs them on made-up days.
 */

export const DEFAULT_CONFIG: Omit<PokerEventConfig, 'practice' | 'game'> = {
  tableSize: 6,
  minPlayers: 4,
  fallbackMs: 6 * 60_000,
  cooldownMs: 2 * 60_000,
  countedTables: 6,
  bestOf: 3,
  knockoutPoints: 100,
  bountyPoints: 300,
  bountyTop: 5,
  powerMultiplier: 2,
  semifinalists: 12,
  advancePerSemi: 3,
  picks: {
    on: true,
    leadMs: 15 * 60_000,
    semiBudget: 500,
    finalBudget: 1000,
    winnerOdds: 5,
    firstOutOdds: 3,
    fullTimeOdds: 3,
    minStake: 10,
  },
  formats: {},
  exclude: [],
};

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Where the day stands now. */
export function phaseOf(event: PokerEvent, now: number): PokerPhase {
  if (event.status === 'draft') return 'draft';
  if (event.status === 'over' || event.final?.endedAt) return 'over';
  const c = event.config;
  if (event.final?.startedAt) return 'final';
  if (event.semis?.endedAt) return 'final-soon';
  if (event.semis?.startedAt) return 'semis';
  if (now >= at(c.game.openTo)) return 'semis-soon';
  if (now >= at(c.game.openFrom)) return 'open';
  if (c.practice && now >= at(c.practice.from) && now < at(c.practice.to)) return 'practice';
  if (c.practice && now < at(c.practice.from)) return 'upcoming';
  if (!c.practice && now < at(c.game.openFrom)) return 'upcoming';
  return 'between';
}

/** Whether people can sit at tables now, and whether those tables count. */
export function playMode(event: PokerEvent, now: number): 'scored' | 'practice' | null {
  if (event.paused) return null;
  const phase = phaseOf(event, now);
  if (phase === 'open') return 'scored';
  if (phase === 'practice') return 'practice';
  return null;
}

export function powerHourAt(config: PokerEventConfig, now: number): boolean {
  const from = at(config.game.powerFrom);
  const to = at(config.game.powerTo);
  return Number.isFinite(from) && Number.isFinite(to) && now >= from && now < to;
}

export function bountiesOnAt(config: PokerEventConfig, now: number): boolean {
  const from = at(config.game.bountiesFrom);
  return Number.isFinite(from) && now >= from && now < at(config.game.openTo);
}

// ------------------------------------------------------------------ queue

export interface QueueEntry {
  userId: string;
  name: string;
  photoUrl: string | null;
  office: string | null;
  since: number;
  /** Counted tables already played today. */
  played: number;
}

/** Queue order: fewer tables played first, then who has waited longest; those past their counted tables last. */
export function queueOrder(queue: QueueEntry[], countedTables: number): QueueEntry[] {
  return [...queue].sort((a, b) => {
    const ea = a.played >= countedTables ? 1 : 0;
    const eb = b.played >= countedTables ? 1 : 0;
    return ea - eb || a.played - b.played || a.since - b.since;
  });
}

/**
 * Who sits down now. Full tables form at once; with two or more full tables
 * the people in queue order are dealt across them in turn, so colleagues who
 * queued together are split. A short table (at least [minPlayers]) forms
 * only once the longest wait has passed [fallbackMs]. Seats are shuffled.
 */
export function formTables(
  queue: QueueEntry[],
  now: number,
  config: Pick<PokerEventConfig, 'tableSize' | 'minPlayers' | 'fallbackMs' | 'countedTables'>,
  random: Random,
): { tables: QueueEntry[][]; rest: QueueEntry[] } {
  const ordered = queueOrder(queue, config.countedTables);
  const full = Math.floor(ordered.length / config.tableSize);
  const tables: QueueEntry[][] = Array.from({ length: full }, () => []);
  const take = full * config.tableSize;
  for (let i = 0; i < take; i++) tables[i % full].push(ordered[i]);
  let rest = ordered.slice(take);
  const longest = rest.reduce((m, e) => Math.min(m, e.since), Number.POSITIVE_INFINITY);
  if (rest.length >= config.minPlayers && now - longest >= config.fallbackMs) {
    tables.push(rest);
    rest = [];
  }
  return { tables: tables.map((t) => shuffle(t, random)), rest };
}

function shuffle<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------ scoring

/**
 * What each player's table is worth: their chips at the end (none if they
 * busted), plus every knockout (a bounty holder's worth more), all doubled
 * in the power hour. Practice tables are worth nothing.
 */
export function scoreTable(table: PokerTable, config: PokerEventConfig): Omit<PokerResult, 'at'>[] {
  const meta = table.meta ?? { power: false, bounties: [], counted: {}, bots: [] };
  return (table.standings ?? [])
    .filter((s) => !meta.bots.includes(s.userId))
    .map((s) => {
      const bountyKnockouts = s.knockouts.filter((v) => meta.bounties.includes(v)).length;
      const plain = s.knockouts.length - bountyKnockouts;
      const base = (s.busted ? 0 : s.stack) + plain * config.knockoutPoints + bountyKnockouts * config.bountyPoints;
      const scored = table.round === 'open';
      return {
        eventId: table.eventId,
        org: table.org,
        tableId: table.id,
        round: table.round,
        label: table.label,
        userId: s.userId,
        name: s.name,
        office: s.office,
        chips: s.stack,
        busted: s.busted,
        place: s.place,
        knockouts: s.knockouts,
        bountyKnockouts,
        power: meta.power,
        counted: scored && meta.counted[s.userId] !== false,
        points: scored ? base * (meta.power ? config.powerMultiplier : 1) : 0,
        voided: false,
      };
    });
}

export interface BoardRow {
  userId: string;
  name: string;
  office: string | null;
  played: number;
  best: number[];
  score: number;
  knockouts: number;
  rank: number;
  /** When the score was reached, for ties: earlier is higher. */
  reachedAt: number;
}

/** The day's board: each player's best [bestOf] counted open tables. */
export function boardOf(results: Pick<PokerResult, 'userId' | 'name' | 'office' | 'round' | 'counted' | 'points' | 'knockouts' | 'voided' | 'at'>[], config: Pick<PokerEventConfig, 'bestOf'>): BoardRow[] {
  const by = new Map<string, BoardRow & { all: { points: number; at: number }[] }>();
  for (const r of results) {
    if (r.round !== 'open' || !r.counted || r.voided) continue;
    const row = by.get(r.userId) ?? { userId: r.userId, name: r.name, office: r.office, played: 0, best: [], score: 0, knockouts: 0, rank: 0, reachedAt: 0, all: [] };
    row.played += 1;
    row.knockouts += r.knockouts.length;
    row.all.push({ points: r.points, at: new Date(r.at).getTime() });
    row.name = r.name;
    row.office = r.office ?? row.office;
    by.set(r.userId, row);
  }
  const rows = [...by.values()].map(({ all, ...row }) => {
    const top = [...all].sort((a, b) => b.points - a.points || a.at - b.at).slice(0, config.bestOf);
    return { ...row, best: top.map((t) => t.points), score: top.reduce((a, t) => a + t.points, 0), reachedAt: Math.max(0, ...top.map((t) => t.at)) };
  });
  rows.sort((a, b) => b.score - a.score || a.reachedAt - b.reachedAt || a.name.localeCompare(b.name));
  let rank = 0;
  let last: number | null = null;
  rows.forEach((row, i) => {
    if (row.score !== last) {
      rank = i + 1;
      last = row.score;
    }
    row.rank = rank;
  });
  return rows;
}

/** Offices by the average score of their players on the board. */
export function officeLeague(board: BoardRow[]) {
  const by = new Map<string, { office: string; players: number; total: number }>();
  for (const row of board) {
    const office = row.office?.trim() || 'Other';
    const o = by.get(office) ?? { office, players: 0, total: 0 };
    o.players += 1;
    o.total += row.score;
    by.set(office, o);
  }
  return [...by.values()]
    .map((o) => ({ office: o.office, players: o.players, average: Math.round(o.total / o.players) }))
    .sort((a, b) => b.average - a.average || b.players - a.players);
}

/** The bounty holders: the top of the board, when bounties are on. */
export function bountyHolders(board: BoardRow[], config: PokerEventConfig, now: number): string[] {
  if (!bountiesOnAt(config, now)) return [];
  return board.filter((r) => r.score > 0).slice(0, config.bountyTop).map((r) => r.userId);
}

// ------------------------------------------------------------------ finals

/**
 * The semifinals: the top [semifinalists] on the board, dealt into tables A
 * and B in a snake (1, 4, 5, 8… against 2, 3, 6, 7…) so the leaders meet only
 * in the final.
 */
export function seedSemis(board: BoardRow[], config: PokerEventConfig, now: number): PokerStage {
  const seeds = board.filter((r) => !config.exclude.includes(r.userId)).slice(0, config.semifinalists).map((r) => r.userId);
  const a: string[] = [];
  const b: string[] = [];
  seeds.forEach((userId, i) => {
    const pair = Math.floor(i / 2);
    const first = i % 2 === 0;
    (pair % 2 === 0 ? (first ? a : b) : first ? b : a).push(userId);
  });
  return {
    seededAt: now,
    startedAt: null,
    endedAt: null,
    tables: [
      { label: 'A', tableId: null, players: a },
      { label: 'B', tableId: null, players: b },
    ].filter((t) => t.players.length >= 2),
  };
}

/** The final: the top [advancePerSemi] of each semifinal. */
export function seedFinal(semiTables: PokerTable[], config: PokerEventConfig, now: number): PokerStage {
  const players: string[] = [];
  for (const t of [...semiTables].sort((x, y) => String(x.label).localeCompare(String(y.label)))) {
    for (const s of (t.standings ?? []).slice(0, config.advancePerSemi)) players.push(s.userId);
  }
  return { seededAt: now, startedAt: null, endedAt: null, tables: [{ label: 'F', tableId: null, players }] };
}

// ------------------------------------------------------------------ picks

export class PokerPickError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** When picks on a stage may be placed: from [leadMs] before it until it starts. */
export function picksOpen(event: PokerEvent, stage: 'semi' | 'final', now: number): boolean {
  const c = event.config;
  if (!c.picks.on || event.status !== 'live') return false;
  const s = stage === 'semi' ? event.semis : event.final;
  if (!s || s.startedAt) return false;
  const startAt = at(stage === 'semi' ? c.game.semisAt : c.game.finalAt);
  return now >= startAt - c.picks.leadMs || (stage === 'final' && Boolean(event.semis?.endedAt));
}

export const budgetOf = (config: PokerEventConfig, stage: 'semi' | 'final') => (stage === 'semi' ? config.picks.semiBudget : config.picks.finalBudget);

/** Checks a pick and returns it ready to save. */
export function makePick(
  event: PokerEvent,
  picker: { userId: string; name: string },
  input: { stage: unknown; table: unknown; kind: unknown; choice: unknown; stake: unknown },
  already: Pick<PokerPick, 'stage' | 'stake' | 'table' | 'kind'>[],
  now: number,
  id: string,
): PokerPick {
  const stage = input.stage === 'final' ? 'final' : input.stage === 'semi' ? 'semi' : null;
  if (!stage) throw new PokerPickError('Pick a stage.');
  if (!picksOpen(event, stage, now)) throw new PokerPickError('Picks are not open for this round right now.');
  const s = stage === 'semi' ? event.semis! : event.final!;
  const table = s.tables.find((t) => t.label === input.table);
  if (!table) throw new PokerPickError('Pick a table.');
  if (s.tables.some((t) => t.players.includes(picker.userId))) throw new PokerPickError('Players cannot pick on their own round.');
  const kind = input.kind as PokerPickKind;
  if (kind !== 'winner' && kind !== 'firstOut' && kind !== 'fullTime') throw new PokerPickError('Pick what you are calling.');
  if (kind === 'fullTime' && stage !== 'final') throw new PokerPickError('That pick is for the final only.');
  const choice = String(input.choice ?? '');
  if (kind === 'fullTime' ? choice !== 'yes' && choice !== 'no' : !table.players.includes(choice)) throw new PokerPickError('Pick someone at that table.');
  const stake = Math.floor(Number(input.stake));
  const spent = already.filter((p) => p.stage === stage).reduce((a, p) => a + p.stake, 0);
  const left = budgetOf(event.config, stage) - spent;
  if (!Number.isFinite(stake) || stake < event.config.picks.minStake) throw new PokerPickError(`The smallest pick is ${event.config.picks.minStake} points.`);
  if (stake > left) throw new PokerPickError(`You have ${left} pick points left for this round.`);
  if (already.some((p) => p.stage === stage && p.table === table.label && p.kind === kind)) throw new PokerPickError('You already made that pick.');
  return { id, eventId: event.id, org: event.org, userId: picker.userId, name: picker.name, stage, table: table.label, kind, choice, stake, placedAt: new Date(now), payout: null };
}

/** What each pick on a finished table pays. */
export function settlePicks(picks: PokerPick[], table: PokerTable, config: PokerEventConfig): Map<string, number> {
  const out = new Map<string, number>();
  const winner = table.standings?.[0]?.userId ?? null;
  const busted = table.seats.filter((s) => s.bustedAt !== null).sort((a, b) => a.bustedAt! - b.bustedAt!);
  // Two out in the same hand: either call is right.
  const firstOut = busted.length ? busted.filter((s) => s.bustedAt === busted[0].bustedAt).map((s) => s.userId) : [];
  const alive = table.seats.filter((s) => s.stack > 0).length;
  const fullTime = (table.overAt ?? 0) >= table.endsAt && alive > 1 ? 'yes' : 'no';
  for (const p of picks) {
    if (p.payout !== null) continue;
    let payout = 0;
    if (p.kind === 'winner') payout = p.choice === winner ? p.stake * config.picks.winnerOdds : 0;
    else if (p.kind === 'firstOut') payout = firstOut.length === 0 ? p.stake : firstOut.includes(p.choice) ? p.stake * config.picks.firstOutOdds : 0;
    else payout = p.choice === fullTime ? p.stake * config.picks.fullTimeOdds : 0;
    out.set(p.id, payout);
  }
  return out;
}

/** The picks board: everyone's winnings, best first. */
export function picksBoard(picks: Pick<PokerPick, 'userId' | 'name' | 'payout' | 'stake'>[]) {
  const by = new Map<string, { userId: string; name: string; won: number; staked: number }>();
  for (const p of picks) {
    const row = by.get(p.userId) ?? { userId: p.userId, name: p.name, won: 0, staked: 0 };
    row.staked += p.stake;
    row.won += p.payout ?? 0;
    by.set(p.userId, row);
  }
  return [...by.values()].sort((a, b) => b.won - a.won || a.staked - b.staked);
}

// ------------------------------------------------------------------ the house

export const HOUSE_PLAYERS = [
  { userId: 'bot:1', name: 'House Ace', photoUrl: null, office: null },
  { userId: 'bot:2', name: 'House King', photoUrl: null, office: null },
  { userId: 'bot:3', name: 'House Queen', photoUrl: null, office: null },
];

/**
 * A house player's move on a practice table: plays pairs and high cards,
 * calls small bets, folds most of the rest, bets made hands after the flop.
 * Meant to give a newcomer a table to learn on, not to win.
 */
export function houseMove(table: PokerTable, seat: number, random: Random): PokerAction {
  const hand = table.hand!;
  const c = choicesFor(table, seat)!;
  const hole = hand.hole[seat]!;
  const bb = hand.level.bb;
  const roll = random();
  let strength: number;
  if (hand.board.length === 0) {
    const [r1, r2] = hole.map(rankOf).sort((a, b) => b - a);
    strength = (r1 === r2 ? 0.55 + r1 / 40 : 0) + (r1 >= 12 ? 0.25 : 0) + (r2 >= 10 ? 0.15 : 0) + (hole[0] % 4 === hole[1] % 4 ? 0.05 : 0);
  } else {
    const best = bestHand([...hole, ...hand.board]);
    strength = best.score[0] >= 2 ? 0.85 : best.score[0] === 1 ? (best.score[1] >= 10 ? 0.6 : 0.4) : 0.1;
  }
  if (c.canRaise && strength > 0.7 && roll < 0.5) return { kind: 'raise', to: Math.min(c.maxRaiseTo, Math.max(c.minRaiseTo, c.currentBet + Math.floor(c.pot / 2))) };
  if (c.canCheck) return { kind: 'check' };
  if (c.toCall <= bb * 2 && strength > 0.15) return { kind: 'call' };
  if (strength > 0.45 && c.toCall <= c.pot) return { kind: 'call' };
  if (strength > 0.7) return { kind: 'call' };
  return { kind: 'fold' };
}

export const isHouse = (userId: string) => userId.startsWith('bot:');

/** Test helper: cards by name. */
export const cardsOf = (s: string) => s.split(' ').map(parseCard);
