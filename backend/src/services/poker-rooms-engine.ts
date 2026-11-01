import type { PokerChatLine, PokerRoom, PokerRoomPlayer, PokerRoomWatcher, PokerSeat } from '../models/poker.model';
import { addSeat, advance as advanceTable, applyAction, leaveSeat, newTable, SEATS_CAP, viewFor as tableViewFor } from './poker-engine';
import { houseMove, isHouse } from './poker-floor';
import type { Random } from './poker-rules';

/**
 * Speed Poker's rooms, with no I/O: Tile Up's room rules (players, host,
 * invites, removals, idle rooms; `tileup-engine.ts`) around one poker table
 * (`poker-engine.ts`). Everything takes a room record and a clock and says
 * what should be true now; the room service applies it under the store's
 * compare-and-set and sends each player their own view.
 *
 * A room seats two to six, at 1,500 chips each (a company with the big tables:
 * up to eight, at 1,000). The host deals a game when at least two are in
 * (house players count; a full room deals itself). A game is one table: its
 * chips each, blinds rising on a clock, to its time or until one player has
 * every chip. Someone who joins mid-game is dealt in from the next hand while
 * a seat is free; someone who leaves folds and is gone. After a game the host
 * can deal again (back to the lobby, chips reset). No event, no points.
 * At a big table, colleagues can watch a game they have no seat at (a full
 * table), everyone there can chat, and a watcher sits down when a seat frees.
 */

export const ROOMS = {
  minPlayers: 2,
  maxSeats: SEATS_CAP,
  /** Each game's length, in minutes: the host picks one in the lobby. */
  minutesOptions: [10, 20, 30] as readonly number[],
  minutes: 20,
  maxHouse: 7,
  kickCooldownMs: 60_000,
  /** A host offline this long hands the role to the longest-present online player. */
  hostGoneMs: 30_000,
  /** A seated player offline this long sits out (their hands check or fold at once) until they are back. */
  seatGoneMs: 10_000,
  /** A lobby with nobody online this long closes. */
  lobbyIdleMs: 10 * 60_000,
  /** A game with nobody online this long closes. */
  playingIdleMs: 3 * 60_000,
  /** A finished room stays for "Deal again" this long. */
  overKeepMs: 15 * 60_000,
  roomMaxMs: 6 * 60 * 60_000,
  invitesPerGame: 20,
  invitePushEveryMs: 10 * 60_000,
  hostsPerWindow: 5,
  hostWindowMs: 10 * 60_000,
  /** A practice room: you and this many house players, dealt at once. */
  practiceHouse: 3,
  /** Chat lines kept on a room, and the longest one. */
  chatKeep: 40,
  chatMaxChars: 200,
  watchersMax: 30,
  /** A watcher not seen this long (their app closed without saying so) is dropped. */
  watcherStaleMs: 2 * 60 * 60_000,
} as const;

/** A table's size and chips: the big tables where the company has them, else the classic six. */
export const TABLE_KINDS = { classic: { seats: 6, buyIn: 1500 }, big: { seats: 8, buyIn: 1000 } } as const;
export type TableKind = keyof typeof TABLE_KINDS;
export const seatsOf = (room: Pick<PokerRoom, 'seats'>) => room.seats ?? TABLE_KINDS.classic.seats;
export const buyInOf = (room: Pick<PokerRoom, 'buyIn'>) => room.buyIn ?? TABLE_KINDS.classic.buyIn;
/** House players fill every seat but the host's. */
const houseMaxOf = (room: Pick<PokerRoom, 'seats'>) => Math.min(ROOMS.maxHouse, seatsOf(room) - 1);
/** Big tables chat and can be watched; a classic room is as it was. */
export const isBigTable = (room: Pick<PokerRoom, 'seats'>) => seatsOf(room) === TABLE_KINDS.big.seats;
/**
 * The 1,000-chip tables' blinds: the big blind starts at 2% of a stack and the game's length sets the pace,
 * a level every 2, 3 or 4 minutes for a 10, 20 or 30 minute game. The 1,500-chip tables keep the casual schedule.
 */
const BIG_BLINDS = {
  levels: [[10, 20], [15, 30], [20, 40], [30, 60], [50, 100], [75, 150], [100, 200], [150, 300], [250, 500]].map(([sb, bb]) => ({ sb, bb })),
  levelMinutes: { 10: 2, 20: 3, 30: 4 } as Record<number, number>,
};
export const levelMinutesOf = (room: Pick<PokerRoom, 'buyIn' | 'minutes'>) =>
  buyInOf(room) === TABLE_KINDS.big.buyIn ? (BIG_BLINDS.levelMinutes[room.minutes] ?? 3) : 3;
const blindsOf = (room: Pick<PokerRoom, 'buyIn' | 'minutes'>) =>
  buyInOf(room) === TABLE_KINDS.big.buyIn ? { levels: BIG_BLINDS.levels, levelMs: levelMinutesOf(room) * 60_000 } : {};

export const HOUSE_NAMES = ['House Ace', 'House King', 'House Queen', 'House Jack', 'House Ten', 'House Nine', 'House Eight'];
export const houseSeat = (i: number) => ({ userId: `bot:${i + 1}`, name: HOUSE_NAMES[i] ?? `House ${i + 1}`, photoUrl: null, office: null });

export class PokerRoomRuleError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Room codes: four digits, 1000–9999, per company. */
export function makeCode(random: Random): string {
  return String(1000 + (Math.floor(random() * 9000) % 9000));
}

/** `room:4827` or `4827` → `4827`; anything else null. */
export function parseCode(raw: unknown): string | null {
  const match = /^(?:room:)?([1-9]\d{3})$/i.exec(String(raw ?? '').trim());
  return match ? match[1] : null;
}

export const firstName = (name: string) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

export const playerOf = (room: PokerRoom, userId: string) => room.players.find((p) => p.userId === userId);

/** People and house players taking up the room's six places. */
export const placesTaken = (room: PokerRoom) => room.players.length + room.house;

export function stillKicked(room: PokerRoom, userId: string, now: number): boolean {
  return room.kicked.some((k) => k.userId === userId && k.at + ROOMS.kickCooldownMs > now);
}
export const wasKicked = (room: PokerRoom, userId: string) => room.kicked.some((k) => k.userId === userId);
export function forgetKick(room: PokerRoom, userId: string): void {
  room.kicked = room.kicked.filter((k) => k.userId !== userId);
}

/** Their seat at the game in play, if they still have one (not left). */
function seatAt(room: PokerRoom, userId: string): PokerSeat | undefined {
  return room.table?.seats.find((s) => s.userId === userId && !s.left);
}

// ---------------------------------------------------------------- effects

export type PokerRoomFeedItem = { kind: 'join' | 'leave' | 'host' | 'start' | 'over' | 'dropin'; userId?: string; name?: string; invited?: boolean };

export type PokerRoomEffect =
  | { type: 'feed'; item: PokerRoomFeedItem }
  | { type: 'kicked'; userId: string; by: { userId: string; name: string } }
  | { type: 'invite'; userId: string; from: { userId: string; name: string; photoUrl: string | null }; code: string }
  | { type: 'notify'; userId: string; code: string; fromName: string }
  | { type: 'delete'; players: string[] };

// ---------------------------------------------------------------- the room

export function newRoom(
  code: string,
  org: string,
  host: Pick<PokerRoomPlayer, 'userId' | 'name' | 'photoUrl' | 'office'>,
  now: number,
  options: { open?: boolean; house?: number; kind?: TableKind } = {},
): PokerRoom {
  const kind = TABLE_KINDS[options.kind ?? 'classic'];
  return {
    code,
    org,
    gameKey: 'speed-poker',
    hostId: host.userId,
    status: 'lobby',
    open: options.open !== false,
    minutes: ROOMS.minutes,
    house: Math.max(0, Math.min(kind.seats - 1, ROOMS.maxHouse, options.house ?? 0)),
    seats: kind.seats,
    buyIn: kind.buyIn,
    createdAt: now,
    updatedAt: now,
    players: [{ ...host, joinedAt: now, online: true, offlineAt: null }],
    invited: [],
    kicked: [],
    invitesSent: 0,
    gameNo: 0,
    table: null,
    finishedAt: null,
    version: 0,
  };
}

const online = (room: PokerRoom) => room.players.filter((p) => p.online);

/** Deals a game: everyone online in the room plus the house players, the room's buy-in each. */
export function startGame(room: PokerRoom, now: number, random: Random): PokerRoomEffect[] {
  if (room.status === 'playing') throw new PokerRoomRuleError(409, 'The game has already started.');
  const people = online(room).map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl, office: p.office }));
  const house = Array.from({ length: room.house }, (_, i) => houseSeat(i));
  const seats = [...people, ...house].slice(0, seatsOf(room));
  if (seats.length < ROOMS.minPlayers) throw new PokerRoomRuleError(409, 'Need two players to deal. Invite someone or add a house player.');
  room.gameNo += 1;
  const table = newTable(
    {
      id: `pr-${room.code}-${room.createdAt.toString(36)}-${room.gameNo}`,
      org: room.org,
      eventId: '',
      round: 'casual',
      players: seats,
      config: { durationMs: room.minutes * 60_000, startStack: buyInOf(room), seats: seatsOf(room), ...blindsOf(room) },
    },
    now,
    random,
  );
  table.meta = { power: false, bounties: [], counted: {}, bots: house.map((h) => h.userId) };
  room.table = table;
  room.status = 'playing';
  room.finishedAt = null;
  return [{ type: 'feed', item: { kind: 'start' } }];
}

function finishGame(room: PokerRoom, now: number): PokerRoomEffect[] {
  room.status = 'over';
  room.finishedAt = now;
  const top = room.table?.standings?.[0];
  return [{ type: 'feed', item: { kind: 'over', ...(top ? { userId: top.userId, name: top.name } : {}) } }];
}

/** Someone new in the room: in the lobby they wait for the deal; mid-game they take a free seat from the next hand. */
export function addPlayer(room: PokerRoom, player: Pick<PokerRoomPlayer, 'userId' | 'name' | 'photoUrl' | 'office'>, now: number, invited: boolean): PokerRoomEffect[] {
  if (placesTaken(room) >= seatsOf(room)) throw new PokerRoomRuleError(409, `That table is full (${seatsOf(room)} of ${seatsOf(room)}).`);
  room.players.push({ ...player, joinedAt: now, online: true, offlineAt: null });
  room.invited = room.invited.filter((i) => i.userId !== player.userId);
  const effects: PokerRoomEffect[] = [{ type: 'feed', item: { kind: 'join', userId: player.userId, name: player.name, ...(invited ? { invited: true } : {}) } }];
  if (room.status === 'playing' && room.table && addSeat(room.table, player, now)) {
    effects.push({ type: 'feed', item: { kind: 'dropin', userId: player.userId, name: player.name } });
  }
  return effects;
}

/** A player in the room but not at the game in play, seated now if a seat is free (back from a drop, or a seat came free). */
export function seatIfFree(room: PokerRoom, userId: string, now: number): boolean {
  const p = playerOf(room, userId);
  if (!p || room.status !== 'playing' || !room.table || room.table.status !== 'playing') return false;
  if (seatAt(room, userId)) return false;
  return addSeat(room.table, p, now);
}

/** The longest-present online player, else the longest-present at all. */
export function nextHost(room: PokerRoom, except?: string): PokerRoomPlayer | undefined {
  return [...room.players].filter((p) => p.userId !== except).sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0];
}

/**
 * Takes a player out, by their own choice or the host's: mid-game their hand
 * folds and their seat is dealt no more; the host role passes on; a game down
 * to one player ends at the next deal; a room with no people left closes.
 */
export function removePlayer(room: PokerRoom, userId: string, how: 'leave' | 'kick', by: PokerRoomPlayer | null, now: number): PokerRoomEffect[] {
  const player = playerOf(room, userId);
  if (!player) return [];
  room.players = room.players.filter((p) => p.userId !== userId);
  if (how === 'kick') room.kicked = room.kicked.filter((k) => k.userId !== userId).concat({ userId, at: now });
  const effects: PokerRoomEffect[] = [];
  if (how === 'kick' && by) effects.push({ type: 'kicked', userId, by: { userId: by.userId, name: by.name } });
  effects.push({ type: 'feed', item: { kind: 'leave', userId, name: player.name } });
  if (room.players.length === 0) return [...effects, { type: 'delete', players: [userId] }];
  if (room.hostId === userId) {
    const next = nextHost(room);
    if (next) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
    }
  }
  if (room.table && room.status === 'playing') {
    leaveSeat(room.table, userId, now);
    if (room.table.status === 'over') effects.push(...finishGame(room, now));
  }
  return effects;
}

/** Back to the lobby after a game: anyone may join again, chips reset at the next deal. */
export function resetToLobby(room: PokerRoom): void {
  room.status = 'lobby';
  room.table = null;
  room.finishedAt = null;
  room.invitesSent = 0;
  // House players never outnumber the seats left.
  room.house = Math.min(room.house, Math.max(0, seatsOf(room) - room.players.length));
}

/** The host's lobby choices: the game's length and whether the table is listed. False when nothing changed, null when refused. */
export function applySettings(room: PokerRoom, input: { minutes?: unknown; open?: unknown }): boolean | null {
  let changed = false;
  if (input.minutes !== undefined) {
    const n = Number(input.minutes);
    if (!ROOMS.minutesOptions.includes(n)) return null;
    if (room.status !== 'lobby') return null;
    if (room.minutes !== n) {
      room.minutes = n;
      changed = true;
    }
  }
  if (input.open !== undefined) {
    const open = input.open === true;
    if (room.open !== open) {
      room.open = open;
      changed = true;
    }
  }
  return changed;
}

/** One house player more (+1) or fewer (-1), in the lobby. False when it cannot move that way. */
export function changeHouse(room: PokerRoom, delta: number): boolean {
  if (room.status !== 'lobby') return false;
  const next = room.house + (delta > 0 ? 1 : -1);
  if (next < 0 || next > houseMaxOf(room) || room.players.length + next > seatsOf(room)) return false;
  room.house = next;
  return true;
}

/** A player's action at the room's game; throws the engine's PokerMoveError when it is not allowed. */
export function actAtTable(room: PokerRoom, userId: string, action: Parameters<typeof applyAction>[2], now: number): PokerRoomEffect[] {
  if (room.status !== 'playing' || !room.table) throw new PokerRoomRuleError(409, 'There is no game in play.');
  applyAction(room.table, userId, action, now);
  return room.table.status === 'over' ? finishGame(room, now) : [];
}

// ---------------------------------------------------------------- the clock

/**
 * Moves a room on to wherever the clock says: a house player's move, a
 * timeout, the next deal, the end of the game; an absent host hands over, an
 * absent player sits out; idle and finished rooms close. Null when nothing is
 * due, so a quiet room costs no write and no push.
 */
export function advanceRoom(room: PokerRoom, now: number, random: Random, houseDelayMs: number): PokerRoomEffect[] | null {
  const everyone = () => room.players.map((p) => p.userId);
  if (room.players.length === 0) return [{ type: 'delete', players: [] }];
  if (now - room.createdAt >= ROOMS.roomMaxMs) return [{ type: 'delete', players: everyone() }];
  const effects: PokerRoomEffect[] = [];
  let changed = false;

  const here = online(room);
  const host = playerOf(room, room.hostId);
  if (host && !host.online && host.offlineAt !== null && now - host.offlineAt >= ROOMS.hostGoneMs && here.length > 0) {
    const next = nextHost(room, host.userId);
    if (next?.online) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
      changed = true;
    }
  }
  const lastSeen = () => Math.max(room.updatedAt, ...room.players.map((p) => p.offlineAt ?? 0));
  // Watchers whose app went without saying so.
  const watchersBefore = room.watchers?.length ?? 0;
  if (watchersBefore) {
    room.watchers = room.watchers!.filter((w) => now - w.at < ROOMS.watcherStaleMs);
    if (room.watchers.length !== watchersBefore) changed = true;
  }

  switch (room.status) {
    case 'lobby': {
      if (here.length === 0 && now - lastSeen() >= ROOMS.lobbyIdleMs) return [{ type: 'delete', players: everyone() }];
      // A full room deals itself.
      if (placesTaken(room) >= seatsOf(room) && here.length === room.players.length) {
        effects.push(...startGame(room, now, random));
        changed = true;
      }
      break;
    }
    case 'playing': {
      if (here.length === 0 && now - lastSeen() >= ROOMS.playingIdleMs) return [{ type: 'delete', players: everyone() }];
      const table = room.table;
      if (!table) {
        resetToLobby(room);
        changed = true;
        break;
      }
      // Someone whose app has gone sits out, so the table does not wait on them.
      for (const p of room.players) {
        const seat = seatAt(room, p.userId);
        if (seat && !p.online && p.offlineAt !== null && now - p.offlineAt >= ROOMS.seatGoneMs && !seat.sittingOut) {
          seat.sittingOut = true;
          const hand = table.hand;
          const i = table.seats.indexOf(seat);
          if (hand && hand.street !== 'done' && hand.toAct === i) hand.deadline = now;
          changed = true;
        }
      }
      // Anyone here and not dealt in (came while the table was full, or was away at the deal) takes a seat that has come free.
      for (const p of here) if (seatIfFree(room, p.userId, now)) changed = true;
      const hand = table.hand;
      if (table.status === 'playing' && hand && hand.street !== 'done' && hand.toAct !== null && isHouse(table.seats[hand.toAct].userId)) {
        if (hand.deadline !== null && now >= hand.deadline - table.config.actionMs + houseDelayMs) {
          applyAction(table, table.seats[hand.toAct].userId, houseMove(table, hand.toAct, random), now);
          changed = true;
        }
      }
      if (advanceTable(table, now, random)) changed = true;
      if (table.status === 'over') {
        effects.push(...finishGame(room, now));
        changed = true;
      }
      break;
    }
    case 'over': {
      if (room.finishedAt !== null && now - room.finishedAt >= ROOMS.overKeepMs) return [{ type: 'delete', players: everyone() }];
      break;
    }
    default:
      break;
  }
  return changed ? effects : null;
}

// ---------------------------------------------------------------- chat and watchers

/** One line of chat, cleaned: no control characters, one line, at most chatMaxChars. Null when there is nothing left to say. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? Array.from(text).slice(0, ROOMS.chatMaxChars).join('') : null;
}

/** Someone at the table, or watching it, says something. The room keeps the last chatKeep lines. */
export function addChat(room: PokerRoom, who: { userId: string; name: string }, raw: unknown, now: number, random: Random): PokerChatLine {
  const text = cleanChat(raw);
  if (!text) throw new PokerRoomRuleError(400, 'Type a message first.');
  const player = playerOf(room, who.userId);
  const watching = !player && (room.watchers ?? []).some((w) => w.userId === who.userId);
  if (!isBigTable(room)) throw new PokerRoomRuleError(403, 'This table has no chat.');
  if (!player && !watching) throw new PokerRoomRuleError(403, 'Sit down or watch this table to chat.');
  const line: PokerChatLine = { id: Math.floor(random() * 2 ** 32).toString(36) + now.toString(36), userId: who.userId, name: player?.name ?? who.name, text, at: now, ...(watching ? { watching: true as const } : {}) };
  room.chat = [...(room.chat ?? []), line].slice(-ROOMS.chatKeep);
  return line;
}

/** Starts (or refreshes) someone watching. Only a game in play, or one just finished, can be watched. */
export function addWatcher(room: PokerRoom, who: Omit<PokerRoomWatcher, 'at'>, now: number): void {
  if (!isBigTable(room)) throw new PokerRoomRuleError(403, 'This table cannot be watched.');
  if (playerOf(room, who.userId)) throw new PokerRoomRuleError(409, 'You are at this table already.');
  if (room.status === 'lobby' || !room.table) throw new PokerRoomRuleError(409, 'That table has not dealt yet: sit down instead.');
  const others = (room.watchers ?? []).filter((w) => w.userId !== who.userId);
  if (others.length >= ROOMS.watchersMax) throw new PokerRoomRuleError(409, 'That table has as many watching as it can take.');
  room.watchers = [...others, { ...who, at: now }];
}

export function removeWatcher(room: PokerRoom, userId: string): boolean {
  const before = room.watchers?.length ?? 0;
  room.watchers = (room.watchers ?? []).filter((w) => w.userId !== userId);
  return room.watchers.length !== before;
}

export const isWatching = (room: PokerRoom, userId: string) => (room.watchers ?? []).some((w) => w.userId === userId);

// ---------------------------------------------------------------- views

export function viewFor(room: PokerRoom, viewerId: string, now: number) {
  const table = room.table;
  const seatOf = (userId: string) => table?.seats.find((s) => s.userId === userId && !s.left);
  const mine = seatOf(viewerId);
  return {
    code: room.code,
    you: viewerId,
    hostId: room.hostId,
    status: room.status,
    open: room.open,
    practice: room.practice === true,
    minutes: room.minutes,
    minutesOptions: ROOMS.minutesOptions,
    house: room.house,
    houseNames: HOUSE_NAMES.slice(0, room.house),
    min: ROOMS.minPlayers,
    max: seatsOf(room),
    buyIn: buyInOf(room),
    /** How often the blinds rise, in minutes. */
    levelMinutes: levelMinutesOf(room),
    big: isBigTable(room),
    serverNow: now,
    gameNo: room.gameNo,
    players: room.players.map((p) => {
      const s = seatOf(p.userId);
      return { userId: p.userId, name: p.name, photoUrl: p.photoUrl, online: p.online, atTable: Boolean(s), busted: Boolean(s && s.bustedAt !== null) };
    }),
    invited: room.invited,
    removed: room.kicked.filter((k) => k.at + ROOMS.kickCooldownMs > now).map((k) => ({ userId: k.userId, until: k.at + ROOMS.kickCooldownMs })),
    /** In the room during a game but not dealt in: the table was full when they came. */
    waiting: room.status === 'playing' && !mine,
    table: table ? tableViewFor(table, viewerId, now) : null,
    finishedAt: room.finishedAt,
    /** Watching, not playing: no seat and no cards, but the table, the chat and a seat when one frees. */
    watching: !playerOf(room, viewerId) && isWatching(room, viewerId),
    watchers: (room.watchers ?? []).map((w) => ({ userId: w.userId, name: w.name, photoUrl: w.photoUrl })),
    chat: room.chat ?? [],
  };
}

export type PokerRoomView = ReturnType<typeof viewFor>;

/** What changed for this viewer, without the clock's own ticking. */
export function viewFingerprint(view: PokerRoomView): string {
  return JSON.stringify({ ...view, serverNow: 0, removed: view.removed.map((r) => r.userId), table: view.table ? { ...view.table, now: 0, level: 0, levelIndex: 0, nextLevelAt: 0, nextLevel: 0 } : null });
}

/** A room as the lobby lists it: who is in, and whether there is a seat. */
export function summaryOf(room: PokerRoom, now: number) {
  const host = playerOf(room, room.hostId);
  const free = seatsOf(room) - placesTaken(room);
  const seatFree = room.status !== 'playing' || !room.table ? free > 0 : free > 0 && (room.table.seats.length < seatsOf(room) || room.table.seats.some((s) => s.left));
  return {
    code: room.code,
    host: host ? { userId: host.userId, name: host.name } : null,
    status: room.status,
    minutes: room.minutes,
    house: room.house,
    players: room.players.map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl })),
    seats: seatsOf(room),
    free,
    seatFree,
    endsAt: room.status === 'playing' && room.table ? room.table.endsAt : null,
    /** A game in play (or just over) can be watched, full or not. */
    watchable: isBigTable(room) && room.status !== 'lobby' && Boolean(room.table),
    watchers: room.watchers?.length ?? 0,
    serverNow: now,
  };
}

export type PokerRoomSummary = ReturnType<typeof summaryOf>;
