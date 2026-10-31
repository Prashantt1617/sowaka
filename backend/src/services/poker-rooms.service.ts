import { randomBytes, randomInt } from 'node:crypto';
import type { Filter } from 'mongodb';
import { users } from '../config/db';
import type { PokerRoom } from '../models/poker.model';
import type { User } from '../models/user.model';
import { notifyUsers, NotificationInput } from './notification.service';
import { parseAction, PokerMoveError, sitIn } from './poker-engine';
import {
  actAtTable,
  addPlayer,
  advanceRoom,
  applySettings,
  changeHouse,
  firstName,
  forgetKick,
  makeCode,
  newRoom,
  parseCode,
  placesTaken,
  playerOf,
  PokerRoomEffect,
  PokerRoomRuleError,
  PokerRoomSummary,
  PokerRoomView,
  removePlayer,
  resetToLobby,
  ROOMS,
  seatIfFree,
  startGame,
  stillKicked,
  summaryOf,
  viewFingerprint,
  viewFor,
  wasKicked,
} from './poker-rooms-engine';
import {
  claimOnce,
  claimWithin,
  clearRoomInvite,
  clearRoomSeatIf,
  createRoom,
  deleteRoom,
  forgetLiveRoom,
  lease,
  liveRooms,
  mutateRoom,
  readRoom,
  recordRoomInvite,
  release,
  roomInvitesOf,
  roomSeatOf,
  setRoomSeat,
} from './poker-store';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { logger } from '../utils/logger';

/**
 * Speed Poker's rooms: the group game, the way Scribble and Tile Up are built
 * (`tileup-room.service.ts`). Every operation reads the room, applies a rule
 * from `poker-rooms-engine.ts` under the store's compare-and-set, carries out
 * the effects (a feed line, an invite push, a removed player told so) and
 * sends each player their own view (`room:state`). No event row and no host
 * script: any company with the `speed-poker` catalog key can play. The event
 * path (`poker-room.service.ts`) is separate and untouched.
 */

export class PokerRoomError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Who is acting, as the socket authenticated them (the event path's identity). */
export interface RoomSeat {
  userId: string;
  org: string;
  name: string;
  photoUrl: string | null;
  office: string | null;
}

export interface PokerRoomEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(org: string, code: string, event: string, payload: unknown): void;
  /** Moves every socket this person holds into the room's channel or out of it. */
  seat(userId: string, org: string, code: string, inside: boolean): void;
}

interface Deps {
  now: () => number;
  random: () => number;
  notify: (userIds: string[], input: NotificationInput) => Promise<void>;
  /** The pause a house player takes before acting. */
  houseDelayMs: number;
}

const cryptoRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;
let deps: Deps = { now: () => Date.now(), random: cryptoRandom, notify: notifyUsers, houseDelayMs: 1400 };
let emitter: PokerRoomEmitter | null = null;
const OWNER = `${process.pid}:${randomBytes(4).toString('hex')}`;

/** For checks: a clock, a die, a notifier of their own. */
export function configurePokerRooms(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
}

export function setPokerRoomEmitter(next: PokerRoomEmitter | null): void {
  emitter = next;
}

const INACTIVE: User['lifecycleStatus'][] = ['offboarded', 'terminated'];

// ---------------------------------------------------------------- views out

/** What each player was last sent, with the room's version, so an unchanged room costs nothing. */
const lastSent = new Map<string, { print: string; version: number }>();

export function forgetRoomSent(userId: string): void {
  lastSent.delete(userId);
}

function pushRoom(room: PokerRoom, force: string[] = []): void {
  if (!emitter) return;
  const now = deps.now();
  const forced = new Set(force);
  for (const p of room.players) {
    const view = viewFor(room, p.userId, now);
    const print = viewFingerprint(view);
    const sent = lastSent.get(p.userId);
    if (!forced.has(p.userId) && sent && sent.print === print && sent.version === room.version) continue;
    lastSent.set(p.userId, { print, version: room.version });
    emitter.toUser(p.userId, 'room:state', { room: view });
  }
}

async function applyEffects(room: PokerRoom, effects: PokerRoomEffect[]): Promise<{ deleted: boolean }> {
  let deleted = false;
  for (const effect of effects) {
    switch (effect.type) {
      case 'feed':
        emitter?.toRoom(room.org, room.code, 'room:feed', effect.item);
        break;
      case 'kicked':
        emitter?.toUser(effect.userId, 'room:kicked', { by: effect.by });
        emitter?.seat(effect.userId, room.org, room.code, false);
        lastSent.delete(effect.userId);
        await clearRoomSeatIf(room.org, effect.userId, room.code);
        await clearRoomInvite(room.org, effect.userId, room.code);
        break;
      case 'invite': {
        const expiresAt = room.createdAt + ROOMS.roomMaxMs;
        await recordRoomInvite(room.org, effect.userId, { code: effect.code, from: effect.from, createdAt: deps.now(), expiresAt });
        emitter?.toUser(effect.userId, 'room:invite', { from: effect.from, code: effect.code, expiresAt });
        break;
      }
      case 'notify':
        void deps
          .notify([effect.userId], {
            scenario: 'poker_invite',
            title: `${firstName(effect.fromName)} invited you to Speed Poker`,
            body: `Table ${effect.code} · tap to sit down`,
            // The app opens the game on this and hands the page the challenge id, which the page reads as the room.
            data: { destination: 'game_challenge', gameKey: 'speed-poker', challengeId: `room:${effect.code}` },
          })
          .catch((error) => logger.error('Poker invite push failed', { org: room.org, code: room.code }, error));
        break;
      case 'delete': {
        deleted = true;
        await deleteRoom(room.org, room.code);
        for (const userId of effect.players) {
          await clearRoomSeatIf(room.org, userId, room.code);
          emitter?.seat(userId, room.org, room.code, false);
          lastSent.delete(userId);
          emitter?.toUser(userId, 'room:state', { room: null });
        }
        for (const userId of new Set([...effect.players, ...room.invited.map((i) => i.userId)])) await clearRoomInvite(room.org, userId, room.code);
        break;
      }
      default:
        break;
    }
  }
  return { deleted };
}

/** Reads, changes, writes and tells: the one path every change takes. */
async function change<T>(
  org: string,
  code: string,
  fn: (room: PokerRoom) => { result: T; effects: PokerRoomEffect[]; write: boolean } | null,
  forceTo: string[] = [],
): Promise<{ room: PokerRoom; result: T } | null> {
  const box: { outcome: { result: T; effects: PokerRoomEffect[]; write: boolean } | null; seen: PokerRoom | null } = { outcome: null, seen: null };
  const written = await mutateRoom(org, code, (room) => {
    box.seen = room;
    box.outcome = fn(room);
    if (!box.outcome || !box.outcome.write) return null;
    room.updatedAt = deps.now();
    return box.outcome;
  });
  const outcome = box.outcome;
  if (!outcome) return null;
  const room = written?.value ?? box.seen;
  if (!room) return null;
  const { deleted } = await applyEffects(room, outcome.effects);
  if (written && !deleted) pushRoom(room, forceTo);
  return { room, result: outcome.result };
}

/** The engine's refusals, as the page reads them. */
function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PokerRoomRuleError) throw new PokerRoomError(error.status, error.message);
    if (error instanceof PokerMoveError) throw new PokerRoomError(409, moveMessage(error.code));
    throw error;
  }
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
      return 'You are not dealt in this hand.';
    default:
      return 'That hand is over.';
  }
}

// ---------------------------------------------------------------- where someone sits

async function roomOf(seat: RoomSeat): Promise<PokerRoom | null> {
  const code = await roomSeatOf(seat.org, seat.userId);
  if (!code) return null;
  const room = await readRoom(seat.org, code);
  if (!room || !playerOf(room, seat.userId)) {
    await clearRoomSeatIf(seat.org, seat.userId, code);
    return null;
  }
  return room;
}

async function requireRoom(seat: RoomSeat): Promise<PokerRoom> {
  const room = await roomOf(seat);
  if (!room) throw new PokerRoomError(404, 'You are not at a table.');
  return room;
}

const asPlayer = (seat: RoomSeat) => ({ userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl, office: seat.office });

// ---------------------------------------------------------------- the lobby

/** The company's open tables, fullest first among those with a seat (cached a second). */
const listCache = new Map<string, { rooms: PokerRoomSummary[]; at: number }>();

export async function openRooms(org: string): Promise<PokerRoomSummary[]> {
  const held = listCache.get(org);
  if (held && deps.now() - held.at < 1000) return held.rooms;
  const now = deps.now();
  const rooms: PokerRoomSummary[] = [];
  for (const live of await liveRooms()) {
    if (live.org !== org) continue;
    const room = await readRoom(org, live.code);
    if (!room) {
      await forgetLiveRoom(org, live.code);
      continue;
    }
    if (!room.open || room.players.length === 0) continue;
    rooms.push(summaryOf(room, now));
  }
  rooms.sort((a, b) => Number(b.seatFree) - Number(a.seatFree) || Number(a.status === 'over') - Number(b.status === 'over') || b.players.length - a.players.length || Number(a.code) - Number(b.code));
  listCache.set(org, { rooms, at: now });
  return rooms;
}

export interface OpenRoomInvite {
  code: string;
  from: { userId: string; name: string; photoUrl: string | null };
  players: number;
  expiresAt: number;
}

/** Invites still worth answering: the room is there, has a place, and they are not in it. */
export async function openInvitesFor(org: string, userId: string): Promise<OpenRoomInvite[]> {
  const now = deps.now();
  const out: OpenRoomInvite[] = [];
  for (const invite of await roomInvitesOf(org, userId, now)) {
    const room = await readRoom(org, invite.code);
    if (!room || playerOf(room, userId) || placesTaken(room) >= ROOMS.maxSeats) {
      await clearRoomInvite(org, userId, invite.code);
      continue;
    }
    out.push({ code: invite.code, from: invite.from, players: room.players.length, expiresAt: invite.expiresAt });
  }
  return out;
}

/** Everything the page needs for the group game on opening: their room if they sit in one, the open tables, their invites. */
export async function roomsHello(seat: RoomSeat) {
  const room = await roomOf(seat);
  const [rooms, invites] = await Promise.all([openRooms(seat.org), openInvitesFor(seat.org, seat.userId)]);
  return {
    me: { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl },
    room: room ? viewFor(room, seat.userId, deps.now()) : null,
    rooms,
    invites,
  };
}

// ---------------------------------------------------------------- operations

export async function hostRoom(seat: RoomSeat, options: { open?: unknown; house?: number } = {}): Promise<PokerRoomView> {
  if (!(await claimWithin(`host:${seat.org}:${seat.userId}`, ROOMS.hostsPerWindow, ROOMS.hostWindowMs))) {
    throw new PokerRoomError(429, 'That is enough new tables for now. Try again in a few minutes.');
  }
  await leaveRoom(seat);
  const now = deps.now();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode(deps.random);
    const room = newRoom(code, seat.org, asPlayer(seat), now, { open: options.open !== false, house: options.house ?? 0 });
    if (!(await createRoom(room))) continue;
    await setRoomSeat(seat.org, seat.userId, code);
    emitter?.seat(seat.userId, seat.org, code, true);
    lastSent.delete(seat.userId);
    listCache.delete(seat.org);
    return viewFor(room, seat.userId, now);
  }
  throw new PokerRoomError(503, 'Could not open a table just now. Try again.');
}

/** A private table against the house, dealt at once: Speed Poker on your own. */
export async function practiceRoom(seat: RoomSeat): Promise<PokerRoomView> {
  const view = await hostRoom(seat, { open: false, house: ROOMS.practiceHouse });
  const changed = await change(seat.org, view.code, (r) => ({ result: true, effects: rule(() => startGame(r, deps.now(), deps.random)), write: true }), [seat.userId]);
  if (!changed) throw new PokerRoomError(503, 'Could not open a practice table. Try again.');
  return viewFor(changed.room, seat.userId, deps.now());
}

const NO_ROOM = 'No table with that code at your company. Check it and try again.';
const KICKED_MESSAGE = 'The host removed you from this table. You can come back in a minute, or at once if the host invites you again.';
const REMOVED_MESSAGE = 'The host removed you from this table.';
const NOT_SEATED = 'You are not at that table any more.';
const refuseRejoin = (room: PokerRoom, userId: string) => (wasKicked(room, userId) ? new PokerRoomError(403, REMOVED_MESSAGE) : new PokerRoomError(404, NOT_SEATED));

export async function joinRoom(seat: RoomSeat, rawCode: unknown, options: { rejoin?: boolean } = {}): Promise<PokerRoomView> {
  const rejoin = options.rejoin === true;
  const code = parseCode(rawCode);
  if (!code) throw new PokerRoomError(404, NO_ROOM);
  // Only ever looked up in the viewer's own company.
  const existing = await readRoom(seat.org, code);
  if (!existing) throw new PokerRoomError(404, NO_ROOM);
  const already = playerOf(existing, seat.userId);
  if (!already && rejoin) throw refuseRejoin(existing, seat.userId);
  if (!already && stillKicked(existing, seat.userId, deps.now())) throw new PokerRoomError(403, KICKED_MESSAGE);
  if (!already && placesTaken(existing) >= ROOMS.maxSeats) throw new PokerRoomError(409, `That table is full (${ROOMS.maxSeats} of ${ROOMS.maxSeats}).`);
  const current = await roomSeatOf(seat.org, seat.userId);
  if (current && current !== code) await leaveRoom(seat);

  const changed = await change(
    seat.org,
    code,
    (room) => {
      const now = deps.now();
      const mine = playerOf(room, seat.userId);
      if (!mine && rejoin) throw refuseRejoin(room, seat.userId);
      if (!mine && stillKicked(room, seat.userId, now)) throw new PokerRoomError(403, KICKED_MESSAGE);
      if (mine) {
        mine.online = true;
        mine.offlineAt = null;
        mine.name = seat.name;
        mine.photoUrl = seat.photoUrl;
        seatIfFree(room, seat.userId, now);
        return { result: true, effects: [], write: true };
      }
      const invited = room.invited.some((i) => i.userId === seat.userId);
      return { result: true, effects: rule(() => addPlayer(room, asPlayer(seat), now, invited)), write: true };
    },
    [seat.userId],
  );
  if (!changed) throw new PokerRoomError(404, NO_ROOM);
  await setRoomSeat(seat.org, seat.userId, code);
  emitter?.seat(seat.userId, seat.org, code, true);
  await clearRoomInvite(seat.org, seat.userId, code);
  listCache.delete(seat.org);
  return viewFor(changed.room, seat.userId, deps.now());
}

/**
 * Quick join: the open table with a seat that is closest to dealing (a
 * lobby with the most people first, then a game with a free seat), else a
 * new open table of your own.
 */
export async function quickJoin(seat: RoomSeat): Promise<PokerRoomView> {
  const mine = await roomOf(seat);
  if (mine) return viewFor(mine, seat.userId, deps.now());
  listCache.delete(seat.org);
  const rooms = (await openRooms(seat.org)).filter((r) => r.seatFree && r.status !== 'over');
  rooms.sort((a, b) => Number(a.status !== 'lobby') - Number(b.status !== 'lobby') || b.players.length + b.house - (a.players.length + a.house));
  for (const r of rooms) {
    try {
      return await joinRoom(seat, r.code);
    } catch (error) {
      if (!(error instanceof PokerRoomError)) throw error;
    }
  }
  return hostRoom(seat, { open: true });
}

export async function leaveRoom(seat: RoomSeat): Promise<void> {
  const room = await roomOf(seat);
  if (!room) return;
  emitter?.seat(seat.userId, seat.org, room.code, false);
  lastSent.delete(seat.userId);
  await clearRoomSeatIf(seat.org, seat.userId, room.code);
  await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) return null;
    return { result: true, effects: removePlayer(r, seat.userId, 'leave', null, deps.now()), write: true };
  });
  listCache.delete(seat.org);
}

/** Someone the viewer may invite: same company, still here, not a counsellor. */
async function findColleague(org: string, userId: string): Promise<Pick<User, 'userId' | 'name' | 'profilePhotoKey' | 'profilePhotoUrl'> | null> {
  if (typeof userId !== 'string' || !userId || userId.length > 64) return null;
  const escaped = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter: Filter<User> = {
    userId,
    lifecycleStatus: { $nin: INACTIVE },
    isCounsellor: { $ne: true },
    $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${escaped}$`, $options: 'i' } }],
  };
  return users().findOne(filter, { projection: { _id: 0, userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } });
}

export async function inviteToRoom(seat: RoomSeat, rawUserId: unknown): Promise<{ invited: true }> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (!userId || userId === seat.userId) throw new PokerRoomError(400, 'Choose a colleague to invite.');
  if (playerOf(room, userId)) return { invited: true };
  if (placesTaken(room) >= ROOMS.maxSeats) throw new PokerRoomError(409, 'The table is full.');
  if (room.invitesSent >= ROOMS.invitesPerGame) throw new PokerRoomError(429, 'That is enough invites for one game.');
  if (room.hostId !== seat.userId && stillKicked(room, userId, deps.now())) throw new PokerRoomError(403, 'Only the host can invite someone they removed.');
  const colleague = await findColleague(seat.org, userId);
  if (!colleague) throw new PokerRoomError(404, "That person isn't a colleague you can invite.");
  const photoUrl = (await resolveProfilePhoto(colleague).catch(() => null)) ?? null;
  const push = await claimOnce(`invite:${seat.org}:${seat.userId}:${userId}`, ROOMS.invitePushEveryMs);
  const changed = await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) throw new PokerRoomError(404, 'You are not at a table.');
    if (playerOf(r, userId)) return { result: true, effects: [], write: false };
    if (r.hostId === seat.userId) forgetKick(r, userId);
    else if (stillKicked(r, userId, deps.now())) throw new PokerRoomError(403, 'Only the host can invite someone they removed.');
    if (!r.invited.some((i) => i.userId === userId)) r.invited.push({ userId, name: colleague.name, photoUrl });
    r.invitesSent += 1;
    const effects: PokerRoomEffect[] = [{ type: 'invite', userId, from: { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl }, code: r.code }];
    if (push) effects.push({ type: 'notify', userId, code: r.code, fromName: seat.name });
    return { result: true, effects, write: true };
  });
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  return { invited: true };
}

const HOST_ONLY = 'Only the host can do that.';

export async function startRoom(seat: RoomSeat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId) throw new PokerRoomError(403, 'Only the host can deal.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new PokerRoomError(403, 'Only the host can deal.');
    if (r.status !== 'lobby') throw new PokerRoomError(409, 'The game has already started.');
    return { result: true, effects: rule(() => startGame(r, deps.now(), deps.random)), write: true };
  });
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  listCache.delete(seat.org);
}

/** The host's lobby choices: `{minutes: 10|20|30}` and `{open: true|false}`. */
export async function settingsRoom(seat: RoomSeat, raw: { minutes?: unknown; open?: unknown }): Promise<PokerRoomView> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId) throw new PokerRoomError(403, HOST_ONLY);
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new PokerRoomError(403, HOST_ONLY);
    const moved = applySettings(r, raw);
    if (moved === null) throw new PokerRoomError(400, r.status !== 'lobby' ? 'Change the game length between games.' : 'Choose 10, 20 or 30 minutes.');
    return { result: true, effects: [], write: moved };
  });
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  listCache.delete(seat.org);
  return viewFor(changed.room, seat.userId, deps.now());
}

/** The host adds a house player to fill a seat (`+1`) or takes one away (`-1`), in the lobby. */
export async function houseRoom(seat: RoomSeat, rawDelta: unknown): Promise<PokerRoomView> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId) throw new PokerRoomError(403, HOST_ONLY);
  const delta = Number(rawDelta) < 0 ? -1 : 1;
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new PokerRoomError(403, HOST_ONLY);
    if (r.status !== 'lobby') throw new PokerRoomError(409, 'Add house players between games.');
    if (!changeHouse(r, delta)) throw new PokerRoomError(409, delta > 0 ? 'The table is full.' : 'There are no house players to take away.');
    return { result: true, effects: [], write: true };
  });
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  listCache.delete(seat.org);
  return viewFor(changed.room, seat.userId, deps.now());
}

export async function kickFromRoom(seat: RoomSeat, rawUserId: unknown): Promise<void> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (room.hostId !== seat.userId) throw new PokerRoomError(403, 'Only the host can remove players.');
  if (!userId || userId === seat.userId) throw new PokerRoomError(400, 'Choose a player to remove.');
  if (!playerOf(room, userId)) throw new PokerRoomError(404, 'That player has already left.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new PokerRoomError(403, 'Only the host can remove players.');
    if (!playerOf(r, userId)) return null;
    return { result: true, effects: removePlayer(r, userId, 'kick', playerOf(r, seat.userId) ?? null, deps.now()), write: true };
  });
  if (!changed) throw new PokerRoomError(404, 'That player has already left.');
  listCache.delete(seat.org);
}

/** After a game: back to the lobby, where anyone can join and the host deals again. */
export async function againRoom(seat: RoomSeat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId || room.status !== 'over') throw new PokerRoomError(403, 'Only the host can start again.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId || r.status !== 'over') throw new PokerRoomError(403, 'Only the host can start again.');
    resetToLobby(r);
    return { result: true, effects: [], write: true };
  });
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  listCache.delete(seat.org);
}

export async function actInRoom(seat: RoomSeat, rawAction: unknown): Promise<Record<string, never>> {
  const room = await requireRoom(seat);
  const action = parseAction(rawAction);
  if (!action) throw new PokerRoomError(400, 'Choose fold, check, call or raise.');
  if (room.status !== 'playing') throw new PokerRoomError(409, 'There is no game in play.');
  const changed = await change(seat.org, room.code, (r) => ({ result: true, effects: rule(() => actAtTable(r, seat.userId, action, deps.now())), write: true }));
  if (!changed) throw new PokerRoomError(404, 'That table has closed.');
  return {};
}

/** Back from sitting out: they act again from their next turn. */
export async function sitInRoom(seat: RoomSeat): Promise<Record<string, never>> {
  const room = await requireRoom(seat);
  await change(seat.org, room.code, (r) => (r.table && sitIn(r.table, seat.userId) ? { result: true, effects: [], write: true } : null));
  return {};
}

// ---------------------------------------------------------------- presence

/** A fresh socket: back into their room, marked online, a seat if one is free, and sent what is true now. */
export async function onRoomConnected(seat: RoomSeat): Promise<string | null> {
  const room = await roomOf(seat);
  if (!room) return null;
  lastSent.delete(seat.userId);
  emitter?.seat(seat.userId, seat.org, room.code, true);
  const changed = await change(
    seat.org,
    room.code,
    (r) => {
      const mine = playerOf(r, seat.userId);
      if (!mine) return null;
      mine.online = true;
      mine.offlineAt = null;
      mine.name = seat.name;
      mine.photoUrl = seat.photoUrl;
      // Sat out while away: back in now.
      if (r.table) sitIn(r.table, seat.userId);
      seatIfFree(r, seat.userId, deps.now());
      return { result: true, effects: [], write: true };
    },
    [seat.userId],
  );
  return changed ? room.code : null;
}

/** Their last socket closed: the chip dims; after a few seconds away their hands check or fold on their own. */
export async function onRoomDisconnected(seat: RoomSeat): Promise<void> {
  const room = await roomOf(seat);
  if (!room) return;
  lastSent.delete(seat.userId);
  await change(seat.org, room.code, (r) => {
    const mine = playerOf(r, seat.userId);
    if (!mine || !mine.online) return null;
    mine.online = false;
    mine.offlineAt = deps.now();
    return { result: true, effects: [], write: true };
  });
}

// ---------------------------------------------------------------- the clock

let ticking = false;

/** Every half second: each room moves on (house moves, timeouts, deals, idle rooms), one instance per room per pass. */
export async function tickPokerRooms(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const { org, code } of await liveRooms()) {
      if (!(await lease(`room:${org}:${code}`, OWNER, 1500))) continue;
      try {
        const room = await readRoom(org, code);
        if (!room) {
          await forgetLiveRoom(org, code);
          continue;
        }
        const now = deps.now();
        await change(org, code, (r) => {
          const effects = advanceRoom(r, now, deps.random, deps.houseDelayMs);
          return effects ? { result: true, effects, write: !effects.some((e) => e.type === 'delete') } : null;
        });
      } catch (error) {
        logger.error('Poker room tick failed', { org, code }, error);
      } finally {
        await release(`room:${org}:${code}`, OWNER);
      }
    }
  } finally {
    ticking = false;
  }
}

/** For checks: the room as stored. */
export const peekRoom = (org: string, code: string) => readRoom(org, code);
