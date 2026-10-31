import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { PokerEvent, PokerPick, PokerTable } from '../models/poker.model';
import { noteLaunchScore } from './game-launch.service';
import { notifyUsers, NotificationInput } from './notification.service';
import { postStandings } from './poker-feed';
import { pokerEvents, pokerHands, pokerPicks, pokerResults, ensurePokerIndexes } from './poker-db';
import {
  advance,
  applyAction,
  newTable,
  nextWake,
  parseAction,
  PokerMoveError,
  PokerTableView,
  sitIn,
  viewFor,
} from './poker-engine';
import {
  boardOf,
  BoardRow,
  bountiesOnAt,
  bountyHolders,
  budgetOf,
  formTables,
  HOUSE_PLAYERS,
  houseMove,
  isHouse,
  makePick,
  officeLeague,
  phaseOf,
  picksBoard,
  picksOpen,
  playMode,
  PokerPickError,
  powerHourAt,
  queueOrder,
  scoreTable,
  seedFinal,
  seedSemis,
  settlePicks,
} from './poker-floor';
import { cardName } from './poker-rules';
import {
  createTable,
  forgetLive,
  lease,
  liveTables,
  mutateFloor,
  mutateTable,
  PokerFloor,
  readFloor,
  readTable,
  release,
} from './poker-store';
import { logger } from '../utils/logger';

/**
 * Speed Poker's room service: the event's day, run on the clock. It seats
 * the queue, moves tables on, scores them, seeds and starts the semifinals
 * and the final, settles the picks, and tells the sockets what changed.
 * The rules are pure (`poker-engine.ts`, `poker-floor.ts`); this is the I/O.
 */

export interface PokerIdentity {
  userId: string;
  org: string;
  name: string;
  photoUrl: string | null;
  office: string | null;
}

export class PokerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PokerEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toWatchers(tableId: string, event: string, payload: unknown): void;
  toEvent(eventId: string, event: string, payload: unknown): void;
  watch(userId: string, tableId: string, on: boolean): void;
}

interface Deps {
  now: () => number;
  random: () => number;
  notify: (userIds: string[], input: NotificationInput) => Promise<void>;
  /** Short gap a house player takes before acting, so a practice table reads like play. */
  houseDelayMs: number;
}

const cryptoRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

let deps: Deps = { now: () => Date.now(), random: cryptoRandom, notify: notifyUsers, houseDelayMs: 1400 };
let emitter: PokerEmitter | null = null;
const OWNER = `${process.pid}:${randomBytes(4).toString('hex')}`;

/** The check script's clock, dice and notifier. */
export function configurePoker(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
}

export function setPokerEmitter(next: PokerEmitter | null): void {
  emitter = next;
}

// ------------------------------------------------------------------ events

const eventCache = new Map<string, { event: PokerEvent | null; at: number }>();
const EVENT_TTL_MS = 2000;

/** The org's current event: the newest that is live, else the newest at all. */
export async function eventFor(org: string, fresh = false): Promise<PokerEvent | null> {
  const held = eventCache.get(org);
  if (!fresh && held && deps.now() - held.at < EVENT_TTL_MS) return held.event;
  await ensurePokerIndexes();
  const event =
    (await pokerEvents().findOne({ org, status: 'live' }, { sort: { createdAt: -1 }, projection: { _id: 0 } })) ??
    (await pokerEvents().findOne({ org }, { sort: { createdAt: -1 }, projection: { _id: 0 } }));
  eventCache.set(org, { event, at: deps.now() });
  return event;
}

async function saveEvent(event: PokerEvent, set: Partial<PokerEvent>): Promise<PokerEvent> {
  Object.assign(event, set, { updatedAt: new Date(deps.now()) });
  await pokerEvents().updateOne({ id: event.id }, { $set: { ...set, updatedAt: event.updatedAt } });
  eventCache.set(event.org, { event, at: deps.now() });
  sharedCache.delete(event.id);
  return event;
}

/** Drops what this process remembers about an event, after the host changes it. */
export function forgetEvent(org: string, eventId?: string): void {
  eventCache.delete(org);
  if (eventId) sharedCache.delete(eventId);
}

// ------------------------------------------------------------------ boards

const boardCache = new Map<string, { board: BoardRow[]; at: number }>();
const BOARD_TTL_MS = 3000;

async function boardFor(event: PokerEvent, fresh = false): Promise<BoardRow[]> {
  const held = boardCache.get(event.id);
  if (!fresh && held && deps.now() - held.at < BOARD_TTL_MS) return held.board;
  const rows = await pokerResults()
    .find({ eventId: event.id, round: 'open' }, { projection: { _id: 0, userId: 1, name: 1, office: 1, round: 1, counted: 1, points: 1, knockouts: 1, voided: 1, at: 1 } })
    .toArray();
  const board = boardOf(rows, event.config);
  boardCache.set(event.id, { board, at: deps.now() });
  return board;
}

/** Counted tables each person has played on the game day. */
async function playedCount(event: PokerEvent, userId: string): Promise<number> {
  return pokerResults().countDocuments({ eventId: event.id, round: 'open', userId, counted: true, voided: false });
}

// ------------------------------------------------------------------ the lobby

export interface PokerShared {
  event: {
    id: string;
    name: string;
    status: PokerEvent['status'];
    paused: boolean;
    phase: ReturnType<typeof phaseOf>;
    practice: PokerEvent['config']['practice'];
    game: PokerEvent['config']['game'];
    rules: {
      tableSize: number;
      minPlayers: number;
      fallbackMs: number;
      cooldownMs: number;
      countedTables: number;
      bestOf: number;
      knockoutPoints: number;
      bountyPoints: number;
      powerMultiplier: number;
      semifinalists: number;
      advancePerSemi: number;
      picks: PokerEvent['config']['picks'];
      minutes: { open: number; semi: number; final: number };
    };
  };
  now: number;
  powerHour: boolean;
  bountiesOn: boolean;
  queue: { userId: string; name: string; since: number }[];
  seated: Record<string, string>;
  cooldownUntil: Record<string, number>;
  tables: { id: string; round: PokerTable['round']; label: string | null; players: { userId: string; name: string; stack: number }[]; endsAt: number; power: boolean }[];
  board: BoardRow[];
  league: ReturnType<typeof officeLeague>;
  bounties: string[];
  semis: PokerEvent['semis'];
  final: PokerEvent['final'];
  names: Record<string, string>;
  picksBoard: ReturnType<typeof picksBoard>;
  champion: PokerEvent['champion'];
}

const sharedCache = new Map<string, { shared: PokerShared; at: number; fingerprint: string }>();

async function eventTables(eventId: string): Promise<PokerTable[]> {
  const out: PokerTable[] = [];
  for (const id of await liveTables()) {
    const t = await readTable(id);
    if (t && t.eventId === eventId) out.push(t);
  }
  return out;
}

async function buildShared(event: PokerEvent, floor?: PokerFloor): Promise<PokerShared> {
  const now = deps.now();
  const [board, f, tables, picks] = await Promise.all([
    boardFor(event),
    floor ? Promise.resolve(floor) : readFloor(event.id),
    eventTables(event.id),
    pokerPicks().find({ eventId: event.id, payout: { $ne: null } }, { projection: { _id: 0, userId: 1, name: 1, payout: 1, stake: 1 } }).toArray(),
  ]);
  const c = event.config;
  const names: Record<string, string> = {};
  for (const r of board) names[r.userId] = r.name;
  for (const t of tables) for (const s of t.seats) names[s.userId] = s.name;
  const minutes = (round: 'open' | 'semi' | 'final', base: number) => Math.round((c.formats[round]?.durationMs ?? base) / 60_000);
  return {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      paused: event.paused,
      phase: phaseOf(event, now),
      practice: c.practice,
      game: c.game,
      rules: {
        tableSize: c.tableSize,
        minPlayers: c.minPlayers,
        fallbackMs: c.fallbackMs,
        cooldownMs: c.cooldownMs,
        countedTables: c.countedTables,
        bestOf: c.bestOf,
        knockoutPoints: c.knockoutPoints,
        bountyPoints: c.bountyPoints,
        powerMultiplier: c.powerMultiplier,
        semifinalists: c.semifinalists,
        advancePerSemi: c.advancePerSemi,
        picks: c.picks,
        minutes: { open: minutes('open', 12 * 60_000), semi: minutes('semi', 20 * 60_000), final: minutes('final', 30 * 60_000) },
      },
    },
    now,
    powerHour: powerHourAt(c, now),
    bountiesOn: bountiesOnAt(c, now),
    queue: queueOrder(f.queue, c.countedTables).map((q) => ({ userId: q.userId, name: q.name, since: q.since })),
    seated: f.seats,
    cooldownUntil: Object.fromEntries(Object.entries(f.cooldownUntil).filter(([, until]) => until > now)),
    tables: tables
      .filter((t) => t.status === 'playing')
      .map((t) => ({
        id: t.id,
        round: t.round,
        label: t.label,
        players: t.seats.map((s) => ({ userId: s.userId, name: s.name, stack: s.stack })),
        endsAt: t.endsAt,
        power: Boolean(t.meta?.power),
      })),
    board,
    league: officeLeague(board),
    bounties: bountyHolders(board, c, now),
    semis: event.semis,
    final: event.final,
    names,
    picksBoard: picksBoard(picks).slice(0, 20),
    champion: event.champion,
  };
}

/** The lobby everyone at the event shares, built at most once a second. */
export async function sharedFor(event: PokerEvent): Promise<PokerShared> {
  const held = sharedCache.get(event.id);
  if (held && deps.now() - held.at < 1000) return held.shared;
  const shared = await buildShared(event);
  sharedCache.set(event.id, { shared, at: deps.now(), fingerprint: fingerprintOf(shared) });
  return shared;
}

const fingerprintOf = (s: PokerShared) =>
  JSON.stringify([s.event.phase, s.event.paused, s.event.status, s.powerHour, s.bountiesOn, s.queue, s.seated, s.cooldownUntil, s.tables.map((t) => [t.id, t.players.map((p) => p.stack)]), s.board.map((b) => [b.userId, b.score]), s.semis, s.final, s.picksBoard, s.champion]);

/** Sends the shared lobby to everyone at the event when it has changed. */
async function pushShared(event: PokerEvent, force = false): Promise<void> {
  const shared = await buildShared(event);
  const fingerprint = fingerprintOf(shared);
  const held = sharedCache.get(event.id);
  sharedCache.set(event.id, { shared, at: deps.now(), fingerprint });
  if (!force && held && held.fingerprint === fingerprint) return;
  emitter?.toEvent(event.id, 'lobby:shared', shared);
}

/** What only this person sees: their picks and what they have left to pick with. */
export async function mineFor(event: PokerEvent, who: PokerIdentity) {
  const picks = await pokerPicks().find({ eventId: event.id, userId: who.userId }, { projection: { _id: 0 } }).sort({ placedAt: 1 }).toArray();
  const left = (stage: 'semi' | 'final') => budgetOf(event.config, stage) - picks.filter((p) => p.stage === stage).reduce((a, p) => a + p.stake, 0);
  const now = deps.now();
  return {
    userId: who.userId,
    name: who.name,
    office: who.office,
    picks,
    picksLeft: { semi: left('semi'), final: left('final') },
    picksOpen: { semi: picksOpen(event, 'semi', now), final: picksOpen(event, 'final', now) },
  };
}

async function requireEvent(who: PokerIdentity): Promise<PokerEvent> {
  const event = await eventFor(who.org);
  if (!event || event.status === 'draft') throw new PokerError(404, 'Speed Poker is not on at your company right now.');
  return event;
}

/** Everything the page needs on opening: the event, the lobby, their own bits, and their table if they sit at one. */
export async function hello(who: PokerIdentity) {
  const event = await eventFor(who.org);
  if (!event || event.status === 'draft') return { event: null };
  const [shared, mine] = await Promise.all([sharedFor(event), mineFor(event, who)]);
  const tableId = shared.seated[who.userId];
  const table = tableId ? await readTable(tableId) : null;
  return { shared, mine, table: table ? viewFor(table, who.userId, deps.now()) : null };
}

// ------------------------------------------------------------------ the queue

export async function joinQueue(who: PokerIdentity) {
  const event = await requireEvent(who);
  const now = deps.now();
  const mode = playMode(event, now);
  if (!mode) throw new PokerError(409, event.paused ? 'Play is paused for a moment. Try again shortly.' : 'Tables are not open right now.');
  const played = mode === 'scored' ? await playedCount(event, who.userId) : 0;
  const changed = await mutateFloor(event.id, (floor) => {
    if (floor.seats[who.userId]) throw new PokerError(409, 'You are already at a table.');
    const until = floor.cooldownUntil[who.userId] ?? 0;
    if (until > now) throw new PokerError(429, `You can sit again in ${Math.ceil((until - now) / 1000)} seconds.`);
    if (floor.queue.some((q) => q.userId === who.userId)) return false;
    floor.queue.push({ userId: who.userId, name: who.name, photoUrl: who.photoUrl, office: who.office, since: now, played });
    return true;
  });
  if (changed?.result) await pushShared(event);
  return { queued: true };
}

export async function leaveQueue(who: PokerIdentity) {
  const event = await eventFor(who.org);
  if (!event) return { queued: false };
  const changed = await mutateFloor(event.id, (floor) => {
    const before = floor.queue.length;
    floor.queue = floor.queue.filter((q) => q.userId !== who.userId);
    return floor.queue.length === before ? null : true;
  });
  if (changed) await pushShared(event);
  return { queued: false };
}

/** A practice table against the house, any time the event is on and the person is free. */
export async function startPractice(who: PokerIdentity) {
  const event = await requireEvent(who);
  const now = deps.now();
  const phase = phaseOf(event, now);
  if (phase === 'over') throw new PokerError(409, 'Speed Poker is over for this event.');
  const id = `px-${randomUUID()}`;
  const seated = await mutateFloor(event.id, (floor) => {
    if (floor.seats[who.userId]) throw new PokerError(409, 'You are already at a table.');
    floor.queue = floor.queue.filter((q) => q.userId !== who.userId);
    floor.seats[who.userId] = id;
    return true;
  });
  if (!seated) throw new PokerError(500, 'Could not open a practice table. Try again.');
  const table = newTable(
    { id, org: event.org, eventId: event.id, round: 'practice', players: [{ userId: who.userId, name: who.name, photoUrl: who.photoUrl, office: who.office }, ...HOUSE_PLAYERS] },
    now,
    deps.random,
  );
  table.meta = { power: false, bounties: [], counted: {}, bots: HOUSE_PLAYERS.map((h) => h.userId) };
  await createTable(table);
  pushTable(table);
  await pushShared(event);
  return { tableId: id };
}

// ------------------------------------------------------------------ at the table

async function tableOf(who: PokerIdentity, tableId: unknown): Promise<PokerTable> {
  const id = typeof tableId === 'string' ? tableId : '';
  const table = id ? await readTable(id) : null;
  if (!table || table.org !== who.org) throw new PokerError(404, 'That table has closed.');
  return table;
}

export async function act(who: PokerIdentity, tableId: unknown, rawAction: unknown) {
  const table = await tableOf(who, tableId);
  const action = parseAction(rawAction);
  if (!action) throw new PokerError(400, 'Choose fold, check, call or raise.');
  const written = await mutateTable(table.id, (t) => {
    try {
      applyAction(t, who.userId, action, deps.now());
    } catch (error) {
      if (error instanceof PokerMoveError) throw new PokerError(409, moveMessage(error.code));
      throw error;
    }
    return true;
  });
  if (!written) throw new PokerError(404, 'That table has closed.');
  await afterTableChange(written.value);
  return {};
}

function moveMessage(code: PokerMoveError['code']): string {
  switch (code) {
    case 'not-your-turn':
      return 'It is not your turn.';
    case 'cannot-check':
      return 'There is a bet to you: call, raise or fold.';
    case 'cannot-raise':
      return 'You cannot raise here.';
    case 'raise-too-small':
      return 'That raise is below the minimum.';
    case 'not-seated':
      return 'You are not at this table.';
    default:
      return 'That hand is over.';
  }
}

export async function sitBackIn(who: PokerIdentity, tableId: unknown) {
  const table = await tableOf(who, tableId);
  const written = await mutateTable(table.id, (t) => (sitIn(t, who.userId) ? true : null));
  if (written) pushTable(written.value);
  return {};
}

/** Watching a table: the semifinals and the final on the screen, or a friend's table. */
export async function watch(who: PokerIdentity, tableId: unknown) {
  const table = await tableOf(who, tableId);
  emitter?.watch(who.userId, table.id, true);
  return { table: viewFor(table, null, deps.now()) };
}

export async function unwatch(who: PokerIdentity, tableId: unknown) {
  if (typeof tableId === 'string') emitter?.watch(who.userId, tableId, false);
  return {};
}

export async function placePick(who: PokerIdentity, input: Record<string, unknown>) {
  const event = await requireEvent(who);
  const already = await pokerPicks().find({ eventId: event.id, userId: who.userId }, { projection: { _id: 0, stage: 1, stake: 1, table: 1, kind: 1 } }).toArray();
  let pick: PokerPick;
  try {
    pick = makePick(event, { userId: who.userId, name: who.name }, { stage: input.stage, table: input.table, kind: input.kind, choice: input.choice, stake: input.stake }, already, deps.now(), randomUUID());
  } catch (error) {
    if (error instanceof PokerPickError) throw new PokerError(409, error.message);
    throw error;
  }
  await pokerPicks().insertOne({ ...pick });
  return { mine: await mineFor(event, who) };
}

// ------------------------------------------------------------------ views out

function pushTable(table: PokerTable): void {
  if (!emitter) return;
  const now = deps.now();
  for (const s of table.seats) if (!isHouse(s.userId)) emitter.toUser(s.userId, 'table:state', viewFor(table, s.userId, now));
  emitter.toWatchers(table.id, 'table:state', viewFor(table, null, now));
}

/** After any change to a table: send it, keep finished hands, and close it out when it is over. */
async function afterTableChange(table: PokerTable): Promise<void> {
  pushTable(table);
  await recordHand(table);
  if (table.status === 'over') await closeTable(table);
}

async function recordHand(table: PokerTable): Promise<void> {
  const hand = table.hand;
  if (!hand || hand.street !== 'done' || !hand.result) return;
  const shown = new Map(hand.result.shown.map((s) => [s.seat, s.cards.map(cardName)]));
  await pokerHands()
    .updateOne(
      { tableId: table.id, no: hand.no },
      {
        $setOnInsert: {
          eventId: table.eventId,
          org: table.org,
          tableId: table.id,
          round: table.round,
          no: hand.no,
          players: table.seats.map((s, seat) => ({
            seat,
            userId: s.userId,
            name: s.name,
            // Every hand is kept with its cards: a dispute needs them all.
            cards: hand.hole[seat] ? hand.hole[seat]!.map(cardName) : shown.get(seat) ?? null,
          })),
          board: hand.board.map(cardName),
          log: hand.log,
          result: hand.result,
          at: new Date(deps.now()),
        },
      },
      { upsert: true },
    )
    .catch((error) => logger.error('Poker hand record failed', { tableId: table.id, no: hand.no }, error));
}

const closing = new Set<string>();

/** A table is over: its results, the seats and cooldowns, the picks, and the next stage. */
async function closeTable(table: PokerTable): Promise<void> {
  if (closing.has(table.id)) return;
  closing.add(table.id);
  try {
    const event = await pokerEvents().findOne({ id: table.eventId }, { projection: { _id: 0 } });
    if (!event) return;
    const now = deps.now();
    const at = new Date(table.overAt ?? now);
    for (const r of scoreTable(table, event.config)) {
      await pokerResults().updateOne({ eventId: r.eventId, tableId: r.tableId, userId: r.userId }, { $setOnInsert: { ...r, at } }, { upsert: true });
    }
    boardCache.delete(event.id);
    const humans = table.seats.filter((s) => !isHouse(s.userId)).map((s) => s.userId);
    if (table.round === 'open') {
      // The day's score so far goes to the game card's leaderboard: it only
      // ever rises (a new table can only improve the best three), so the
      // card keeps each person's latest.
      const board = await boardFor(event, true);
      for (const userId of humans) {
        const row = board.find((r) => r.userId === userId);
        if (row) await noteLaunchScore(event.catalogKey, event.org, { userId, name: row.name }, row.score, true);
      }
    }
    await mutateFloor(event.id, (floor) => {
      for (const userId of humans) {
        if (floor.seats[userId] === table.id) delete floor.seats[userId];
        if (table.round === 'open' || table.round === 'practice') floor.cooldownUntil[userId] = now + (table.round === 'open' ? event.config.cooldownMs : 0);
      }
      return true;
    });
    await forgetLive(table.id);
    if (table.round === 'semi' || table.round === 'final') await closeStageTable(event, table);
    await pushShared(event, true);
  } finally {
    closing.delete(table.id);
  }
}

async function closeStageTable(event: PokerEvent, table: PokerTable): Promise<void> {
  const stage = table.round === 'semi' ? 'semi' : 'final';
  const picks = await pokerPicks().find({ eventId: event.id, stage, table: table.label ?? 'F', payout: null }, { projection: { _id: 0 } }).toArray();
  for (const [id, payout] of settlePicks(picks, table, event.config)) await pokerPicks().updateOne({ id }, { $set: { payout } });
  if (stage === 'final') {
    const top = table.standings?.[0];
    await saveEvent(event, {
      final: event.final ? { ...event.final, endedAt: deps.now() } : null,
      champion: top ? { userId: top.userId, name: top.name } : null,
    });
    return;
  }
  // Both semifinals over: the final is seeded at once, so picks on it can open.
  const semiTables = await Promise.all((event.semis?.tables ?? []).map((t) => (t.tableId ? readTable(t.tableId) : Promise.resolve(null))));
  if (semiTables.every((t) => t && t.status === 'over')) {
    await saveEvent(event, {
      semis: event.semis ? { ...event.semis, endedAt: deps.now() } : null,
      final: seedFinal(semiTables as PokerTable[], event.config, deps.now()),
    });
  }
}

// ------------------------------------------------------------------ the clock

let ticking = false;
let lastRunner = 0;

/** Every half second: tables move on; once a second, each live event's day. */
export async function tickPoker(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = deps.now();
    for (const id of await liveTables()) {
      const table = await readTable(id);
      if (!table) {
        await forgetLive(id);
        continue;
      }
      if (table.status === 'over') {
        await closeTable(table);
        continue;
      }
      if (!(await lease(`table:${id}`, OWNER, 2000))) continue;
      try {
        await moveTable(table, now);
      } finally {
        await release(`table:${id}`, OWNER);
      }
    }
    if (now - lastRunner >= 1000) {
      lastRunner = now;
      const events = await pokerEvents().find({ status: 'live' }, { projection: { _id: 0 } }).toArray();
      for (const event of events) {
        if (!(await lease(`event:${event.id}`, OWNER, 3000))) continue;
        try {
          await runEvent(event, now);
        } catch (error) {
          logger.error('Poker event run failed', { eventId: event.id }, error);
        } finally {
          await release(`event:${event.id}`, OWNER);
        }
      }
    }
  } finally {
    ticking = false;
  }
}

async function moveTable(table: PokerTable, now: number): Promise<void> {
  const hand = table.hand;
  const houseTurn = hand && hand.street !== 'done' && hand.toAct !== null && isHouse(table.seats[hand.toAct].userId);
  const due = nextWake(table);
  const houseDue = houseTurn && hand!.deadline !== null && now >= hand!.deadline - table.config.actionMs + deps.houseDelayMs;
  if (!houseDue && (due === null || now < due)) return;
  const written = await mutateTable(table.id, (t) => {
    let changed = false;
    const h = t.hand;
    if (h && h.street !== 'done' && h.toAct !== null && isHouse(t.seats[h.toAct].userId)) {
      if (h.deadline !== null && now >= h.deadline - t.config.actionMs + deps.houseDelayMs) {
        applyAction(t, t.seats[h.toAct].userId, houseMove(t, h.toAct, deps.random), now);
        changed = true;
      }
    }
    if (advance(t, now, deps.random)) changed = true;
    return changed ? true : null;
  });
  if (written) await afterTableChange(written.value);
}

async function runEvent(event: PokerEvent, now: number): Promise<void> {
  const phase = phaseOf(event, now);
  const mode = playMode(event, now);
  if (mode) {
    await seatQueue(event, mode, now);
  } else {
    // Tables have closed (the day's open play is over, or a pause): nobody waits for a seat.
    const cleared = await mutateFloor(event.id, (floor) => {
      if (!floor.queue.length) return null;
      const was = floor.queue.map((q) => q.userId);
      floor.queue = [];
      return was;
    });
    for (const userId of cleared?.result ?? []) emitter?.toUser(userId, 'poker:toast', { message: event.paused ? 'Play is paused. Sit down again when it is back.' : 'Tables have closed for now.' });
  }
  if (event.status === 'live' && !event.paused) {
    const game = event.config.game;
    if (phase === 'semis-soon' && !event.semis) {
      // Tables dealt just before the close still count: seed once they have all finished.
      const stillPlaying = (await eventTables(event.id)).some((t) => t.round === 'open' && t.status === 'playing');
      if (!stillPlaying) await saveEvent(event, { semis: seedSemis(await boardFor(event, true), event.config, now) });
    }
    if (event.semis && !event.semis.startedAt && now >= Date.parse(game.semisAt)) await startStage(event, 'semi', now);
    if (event.final && !event.final.startedAt && event.semis?.endedAt && now >= Date.parse(game.finalAt)) await startStage(event, 'final', now);
  }
  if (event.config.hourlyPosts && phase === 'open' && !event.paused) {
    const hour = 60 * 60_000;
    const last = event.lastStandingsAt ?? Date.parse(event.config.game.openFrom);
    if (now - last >= hour) {
      await saveEvent(event, { lastStandingsAt: now });
      await postStandings(event, now).catch((error) => logger.error('Poker standings post failed', { eventId: event.id }, error));
    }
  }
  await pushShared(event);
}

async function seatQueue(event: PokerEvent, mode: 'scored' | 'practice', now: number): Promise<void> {
  const board = mode === 'scored' ? await boardFor(event) : [];
  const bounties = mode === 'scored' ? bountyHolders(board, event.config, now) : [];
  const power = mode === 'scored' && powerHourAt(event.config, now);
  const made: PokerTable[] = [];
  await mutateFloor(event.id, (floor) => {
    const { tables, rest } = formTables(floor.queue, now, event.config, deps.random);
    if (!tables.length) return null;
    made.length = 0;
    for (const players of tables) {
      const id = `${mode === 'scored' ? 'po' : 'pp'}-${randomUUID()}`;
      const table = newTable(
        {
          id,
          org: event.org,
          eventId: event.id,
          round: mode === 'scored' ? 'open' : 'practice',
          players: players.map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl, office: p.office })),
          config: event.config.formats[mode === 'scored' ? 'open' : 'practice'],
        },
        now,
        deps.random,
      );
      table.meta = {
        power,
        bounties,
        counted: Object.fromEntries(players.map((p) => [p.userId, mode === 'scored' && p.played < event.config.countedTables])),
        bots: [],
      };
      for (const p of players) floor.seats[p.userId] = id;
      made.push(table);
    }
    floor.queue = rest;
    return true;
  });
  for (const table of made) {
    await createTable(table);
    pushTable(table);
    const humans = table.seats.map((s) => s.userId);
    for (const userId of humans) emitter?.toUser(userId, 'table:seated', { tableId: table.id });
    void deps
      .notify(humans, {
        scenario: 'poker_table',
        title: 'Your Speed Poker table is ready',
        body: 'Cards are being dealt. Tap to play.',
        data: { destination: 'game_challenge', gameKey: event.catalogKey },
      })
      .catch((error) => logger.error('Poker seat push failed', { tableId: table.id }, error));
  }
}

/** Deals the semifinal tables or the final, from their seeding. */
export async function startStage(event: PokerEvent, stage: 'semi' | 'final', now: number): Promise<void> {
  const s = stage === 'semi' ? event.semis : event.final;
  if (!s || s.startedAt) return;
  const people = new Map<string, { name: string; office: string | null; photoUrl: string | null }>();
  const board = await boardFor(event, true);
  for (const r of board) people.set(r.userId, { name: r.name, office: r.office, photoUrl: null });
  const tables: { label: string; tableId: string; players: string[]; table: PokerTable }[] = [];
  for (const t of s.tables) {
    if (t.players.length < 2) continue;
    const id = `${stage === 'semi' ? 'ps' : 'pf'}-${randomUUID()}`;
    const table = newTable(
      {
        id,
        org: event.org,
        eventId: event.id,
        round: stage,
        label: t.label,
        players: t.players.map((userId) => ({ userId, name: people.get(userId)?.name ?? 'Player', photoUrl: null, office: people.get(userId)?.office ?? null })),
        config: event.config.formats[stage],
      },
      now,
      deps.random,
    );
    table.meta = { power: false, bounties: [], counted: {}, bots: [] };
    tables.push({ ...t, tableId: id, table });
  }
  // Anyone still at an open table or in the queue is moved off it: finals take the room.
  await mutateFloor(event.id, (floor) => {
    for (const t of tables) for (const userId of t.players) floor.seats[userId] = t.tableId;
    floor.queue = floor.queue.filter((q) => !tables.some((t) => t.players.includes(q.userId)));
    return true;
  });
  for (const t of tables) {
    await createTable(t.table);
    pushTable(t.table);
    for (const userId of t.players) emitter?.toUser(userId, 'table:seated', { tableId: t.tableId });
  }
  const next = { ...s, startedAt: now, tables: tables.map(({ table: _table, ...rest }) => rest) };
  await saveEvent(event, stage === 'semi' ? { semis: next } : { final: next });
  void deps
    .notify(
      tables.flatMap((t) => t.players),
      {
        scenario: 'poker_table',
        title: stage === 'semi' ? 'Your Speed Poker semifinal is starting' : 'The Speed Poker final is starting',
        body: 'Your seat is ready. Tap to play.',
        data: { destination: 'game_challenge', gameKey: event.catalogKey },
      },
    )
    .catch(() => undefined);
}

/** The person has no Speed Poker page open any more: off the queue (a seat at a table plays on, sitting out). */
export async function onGone(who: PokerIdentity): Promise<void> {
  const event = await eventFor(who.org);
  if (!event) return;
  const changed = await mutateFloor(event.id, (floor) => {
    const before = floor.queue.length;
    floor.queue = floor.queue.filter((q) => q.userId !== who.userId);
    return floor.queue.length === before ? null : true;
  });
  if (changed) await pushShared(event);
}

export type { PokerTableView };
