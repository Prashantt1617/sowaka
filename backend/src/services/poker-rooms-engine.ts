import type { PokerRoom, PokerRoomPlayer, PokerSeat } from '../models/poker.model';
import { addSeat, advance as advanceTable, applyAction, leaveSeat, newTable, SEATS_MAX, viewFor as tableViewFor } from './poker-engine';
import { houseMove, isHouse } from './poker-floor';
import type { Random } from './poker-rules';

/**
 * Speed Poker's rooms, with no I/O: Tile Up's room rules (players, host,
 * invites, removals, idle rooms; `tileup-engine.ts`) around one poker table
 * (`poker-engine.ts`). Everything takes a room record and a clock and says
 * what should be true now; the room service applies it under the store's
 * compare-and-set and sends each player their own view.
 *
 * A room seats two to six. The host deals a game when at least two are in
 * (house players count; a full room deals itself). A game is one table: 1,500
 * chips each, blinds rising on a clock, to its time or until one player has
 * every chip. Someone who joins mid-game is dealt in from the next hand while
 * a seat is free; someone who leaves folds and is gone. After a game the host
 * can deal again (back to the lobby, chips reset). No event, no points.
 */

export const ROOMS = {
  minPlayers: 2,
  maxSeats: SEATS_MAX,
  /** Each game's length, in minutes: the host picks one in the lobby. */
  minutesOptions: [10, 20, 30] as readonly number[],
  minutes: 20,
  maxHouse: 5,
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
} as const;

export const HOUSE_NAMES = ['House Ace', 'House King', 'House Queen', 'House Jack', 'House Ten'];
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
  options: { open?: boolean; house?: number } = {},
): PokerRoom {
  return {
    code,
    org,
    gameKey: 'speed-poker',
    hostId: host.userId,
    status: 'lobby',
    open: options.open !== false,
    minutes: ROOMS.minutes,
    house: Math.max(0, Math.min(ROOMS.maxHouse, options.house ?? 0)),
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

/** Deals a game: everyone online in the room plus the house players, 1,500 chips each. */
export function startGame(room: PokerRoom, now: number, random: Random): PokerRoomEffect[] {
  if (room.status === 'playing') throw new PokerRoomRuleError(409, 'The game has already started.');
  const people = online(room).map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl, office: p.office }));
  const house = Array.from({ length: room.house }, (_, i) => houseSeat(i));
  const seats = [...people, ...house].slice(0, ROOMS.maxSeats);
  if (seats.length < ROOMS.minPlayers) throw new PokerRoomRuleError(409, 'Need two players to deal. Invite someone or add a house player.');
  room.gameNo += 1;
  const table = newTable(
    {
      id: `pr-${room.code}-${room.createdAt.toString(36)}-${room.gameNo}`,
      org: room.org,
      eventId: '',
      round: 'casual',
      players: seats,
      config: { durationMs: room.minutes * 60_000 },
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
  if (placesTaken(room) >= ROOMS.maxSeats) throw new PokerRoomRuleError(409, `That table is full (${ROOMS.maxSeats} of ${ROOMS.maxSeats}).`);
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
  room.house = Math.min(room.house, Math.max(0, ROOMS.maxSeats - room.players.length));
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
  if (next < 0 || next > ROOMS.maxHouse || room.players.length + next > ROOMS.maxSeats) return false;
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

  switch (room.status) {
    case 'lobby': {
      if (here.length === 0 && now - lastSeen() >= ROOMS.lobbyIdleMs) return [{ type: 'delete', players: everyone() }];
      // A full room deals itself.
      if (placesTaken(room) >= ROOMS.maxSeats && here.length === room.players.length) {
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
    max: ROOMS.maxSeats,
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
  const free = ROOMS.maxSeats - placesTaken(room);
  const seatFree = room.status !== 'playing' || !room.table ? free > 0 : free > 0 && (room.table.seats.length < ROOMS.maxSeats || room.table.seats.some((s) => s.left));
  return {
    code: room.code,
    host: host ? { userId: host.userId, name: host.name } : null,
    status: room.status,
    minutes: room.minutes,
    house: room.house,
    players: room.players.map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl })),
    seats: ROOMS.maxSeats,
    free,
    seatFree,
    endsAt: room.status === 'playing' && room.table ? room.table.endsAt : null,
    serverNow: now,
  };
}

export type PokerRoomSummary = ReturnType<typeof summaryOf>;
