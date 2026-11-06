import { randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import { users } from '../config/db';
import { PoolPlayer, PoolRoom, PoolView } from '../models/pool.model';
import type { User } from '../models/user.model';
import type { Shot } from '../shared/pool/engine';
import { recordServerScore } from './game-catalog.service';
import { recordPointChanges } from './points-ledger.service';
import { notifyUsers, NotificationInput } from './notification.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  Effect,
  POOL,
  PoolMoveError,
  PoolRoomSummary,
  advance,
  applyCall,
  applyPlace,
  applyShot,
  firstName,
  inviteOpen,
  makeCode,
  newRoom,
  parseCode,
  parseShot,
  playerOf,
  removePlayer,
  resetToLobby,
  startGame,
  summaryOf,
  viewFingerprint,
  viewFor,
} from './pool-rooms-engine';
import {
  claimOnce,
  claimWithin,
  clearInvite,
  clearSeatIf,
  createRoom,
  deleteRoom,
  forgetLive,
  leaseRoom,
  liveRooms,
  mutateRoom,
  pendingInvitesOf,
  readRoom,
  recordInvite,
  releaseRoom,
  seatOf,
  setSeat,
} from './pool-store';
import { logger } from '../utils/logger';

/**
 * Sowaka Pool's rooms: what a player may do to one, and what everyone is told.
 * Tile Up's room service (`tileup-room.service.ts`) with pool's turns: every
 * operation reads the room, applies a rule from the engine under the store's
 * compare-and-set, carries out the effects (a feed line, a push, the scores)
 * and sends each player their own view. The socket layer
 * (`pool-realtime.service.ts`) is a thin shell around this; the check script
 * drives it with a clock it moves by hand.
 */

export class PoolError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PoolError';
  }
}

/** Who is acting, as the socket authenticated them. */
export interface Seat {
  userId: string;
  org: string;
  name: string;
  photoUrl: string | null;
}

export interface PoolEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(org: string, code: string, event: string, payload: unknown): void;
  /** Moves every socket this person holds, on every instance, into the room's channel or out of it. */
  seat(userId: string, org: string, code: string, inside: boolean): void;
}

export interface PoolDeps {
  now: () => number;
  random: () => number;
  notify: (userIds: string[], input: NotificationInput) => Promise<void>;
  recordScore: (org: string, player: { userId: string; name: string }, score: number) => Promise<void>;
  /** Engagement points for one player's finished game (profile rank and the Games leaderboard). */
  awardPoints: (award: PoolAward) => Promise<void>;
}

export interface PoolAward {
  org: string;
  userId: string;
  points: number;
  gameId: string;
  score: number;
  won: boolean;
  potted: number;
}

/**
 * What a finished game pays each player: their score ÷ 70, rounded, at most
 * 25 (a win with all seven balls is 1,700, so 24; a loss with four balls is
 * 400, so 6).
 */
export const POOL_POINTS_PER_SCORE = 70;
export const POOL_POINTS_MAX = 25;
export const poolPointsFor = (score: number): number => Math.max(0, Math.min(POOL_POINTS_MAX, Math.round(score / POOL_POINTS_PER_SCORE)));

async function payPoints(award: PoolAward): Promise<void> {
  if (award.points > 0) await users().updateOne({ userId: award.userId, org: award.org }, { $inc: { points: award.points } });
  // Every finished game goes in the player's history, one that paid nothing too.
  recordPointChanges(
    [{
      userId: award.userId,
      org: award.org,
      delta: award.points,
      source: 'game_challenge' as const,
      reason: 'game' as const,
      refId: award.gameId,
      note: `Sowaka Pool · ${award.won ? 'won' : 'lost'} · ${award.potted} ${award.potted === 1 ? 'ball' : 'balls'} potted`,
      gameKey: 'pool',
      title: 'Sowaka Pool',
    }],
    { keepZero: true },
  );
}

const deps: PoolDeps = {
  now: () => Date.now(),
  random: Math.random,
  notify: notifyUsers,
  recordScore: (org, player, score) => recordServerScore(org, 'pool', { ...player, org }, score),
  awardPoints: payPoints,
};

let emitter: PoolEmitter | null = null;

/** For checks: a clock, a die, a notifier of their own. Partial; the rest stays. */
export function configurePool(overrides: Partial<PoolDeps>): void {
  Object.assign(deps, overrides);
}

export function setPoolEmitter(target: PoolEmitter | null): void {
  emitter = target;
}

export const poolNow = () => deps.now();

const INACTIVE: User['lifecycleStatus'][] = ['offboarded', 'terminated'];

// ---------------------------------------------------------------- views out

/**
 * What each player was last sent, so an unchanged room costs nothing. The
 * room's version goes with the fingerprint: this map is per process, and a
 * stale entry here must never swallow a change another instance wrote.
 */
const lastSent = new Map<string, { print: string; version: number }>();

export function forgetSent(userId: string): void {
  lastSent.delete(userId);
}

/** Sends every player their own view; `force` resends to these even if unchanged (a reconnecter). */
function pushRoom(room: PoolRoom, force: string[] = []): void {
  if (!emitter) return;
  const now = deps.now();
  const forced = new Set(force);
  for (const player of room.players) {
    const view = viewFor(room, player.userId, now);
    const print = viewFingerprint(view);
    const sent = lastSent.get(player.userId);
    if (!forced.has(player.userId) && sent && sent.print === print && sent.version === room.version) continue;
    lastSent.set(player.userId, { print, version: room.version });
    emitter.toUser(player.userId, 'room:state', { room: view });
  }
}

async function applyEffects(room: PoolRoom, effects: Effect[]): Promise<{ deleted: boolean }> {
  let deleted = false;
  for (const effect of effects) {
    switch (effect.type) {
      case 'feed':
        emitter?.toRoom(room.org, room.code, 'room:feed', effect.item);
        break;
      case 'invite':
        // Kept until answered, so the Games tab and a later socket can show
        // it; a second invite to the same room refreshes the one record.
        await recordInvite(effect.userId, {
          org: room.org,
          code: effect.code,
          inviter: { userId: effect.from.userId, name: effect.from.name },
          createdAt: deps.now(),
          expiresAt: room.createdAt + POOL.roomMaxMs,
        });
        emitter?.toUser(effect.userId, 'room:invite', { from: effect.from, code: effect.code, expiresAt: room.createdAt + POOL.roomMaxMs });
        break;
      case 'notify':
        void deps
          .notify([effect.userId], {
            scenario: 'pool_invite',
            title: `${firstName(effect.fromName)} invited you to Sowaka Pool`,
            body: `Room ${effect.code} · tap to join`,
            // The app opens a game on this destination and hands the page the
            // challenge id, which the page's live bridge reads as the room.
            data: { destination: 'game_challenge', gameKey: 'pool', challengeId: `room:${effect.code}` },
          })
          .catch((error) => logger.error('Pool invite push failed', { org: room.org, code: room.code }, error));
        break;
      case 'finished':
        recordScores(room);
        break;
      case 'delete': {
        deleted = true;
        await deleteRoom(room.org, room.code);
        for (const userId of effect.players) {
          await clearSeatIf(room.org, userId, room.code);
          emitter?.seat(userId, room.org, room.code, false);
          lastSent.delete(userId);
          emitter?.toUser(userId, 'room:state', { room: null });
        }
        // Nobody is left with a card for a room that is gone.
        for (const userId of new Set([...effect.players, ...room.invited.map((i) => i.userId)])) {
          await clearInvite(room.org, userId, room.code);
        }
        break;
      }
      default:
        break;
    }
  }
  return { deleted };
}

/**
 * The final lines go to the game's own leaderboard (the live page never
 * submits them), and each player is paid engagement points for their own
 * line, once per game however many instances see it finish.
 */
function recordScores(room: PoolRoom): void {
  const lines = room.final ?? [];
  const gameId = room.gameId;
  if (!gameId || lines.length < POOL.minPlayers) return;
  void (async () => {
    if (!(await claimOnce(`points:${room.org}:${gameId}`, 7 * 24 * 60 * 60 * 1000))) return;
    for (const line of lines) {
      if (line.score > 0) {
        await deps
          .recordScore(room.org, { userId: line.userId, name: line.name }, line.score)
          .catch((error) => logger.error('Pool score record failed', { org: room.org, code: room.code, userId: line.userId }, error));
      }
      await deps
        .awardPoints({ org: room.org, userId: line.userId, points: poolPointsFor(line.score), gameId, score: line.score, won: line.won, potted: line.potted })
        .catch((error) => logger.error('Pool points failed', { org: room.org, gameId, userId: line.userId }, error));
    }
  })();
}

/**
 * Reads, changes, writes and tells: the one path every change takes. `fn`
 * returns what to do, or null when nothing changed (nothing is written or
 * pushed then, but any effects still happen).
 */
async function change<T>(
  org: string,
  code: string,
  fn: (room: PoolRoom) => { result: T; effects: Effect[]; write: boolean } | null,
  /** Who gets their view even if it did not change (a reconnecter). */
  forceTo: string[] = [],
): Promise<{ room: PoolRoom; result: T } | null> {
  // Held in a box: the callback assigns them, which narrowing cannot see.
  const box: { outcome: { result: T; effects: Effect[]; write: boolean } | null; seen: PoolRoom | null } = { outcome: null, seen: null };
  const written = await mutateRoom(org, code, (room) => {
    box.seen = room;
    box.outcome = fn(room);
    if (!box.outcome || !box.outcome.write) return null;
    // The game's clock, not the wall's: the idle rules compare against it.
    room.updatedAt = deps.now();
    return box.outcome;
  });
  const outcome = box.outcome;
  if (!outcome) return null;
  const room = written?.room ?? box.seen;
  if (!room) return null;
  const { deleted } = await applyEffects(room, outcome.effects);
  if (written && !deleted) pushRoom(room, forceTo);
  return { room, result: outcome.result };
}

/** A refused move from the engine, as the page reads it: `.status` and `.message`. */
function asPoolError(error: unknown): never {
  if (error instanceof PoolMoveError) throw new PoolError(error.status, error.message);
  throw error;
}

// ---------------------------------------------------------------- where someone sits

async function roomOf(seat: Seat): Promise<PoolRoom | null> {
  const code = await seatOf(seat.org, seat.userId);
  if (!code) return null;
  const room = await readRoom(seat.org, code);
  if (!room || !playerOf(room, seat.userId)) {
    await clearSeatIf(seat.org, seat.userId, code);
    return null;
  }
  return room;
}

async function requireRoom(seat: Seat): Promise<PoolRoom> {
  const room = await roomOf(seat);
  if (!room) throw new PoolError(404, 'You are not in a room.');
  return room;
}

const asPlayer = (seat: Seat, now: number): PoolPlayer => ({
  userId: seat.userId,
  name: seat.name,
  photoUrl: seat.photoUrl,
  joinedAt: now,
  online: true,
  offlineAt: null,
  wins: 0,
});

// ---------------------------------------------------------------- the lobby

/** The company's open rooms, those with a seat first, oldest first. */
export async function openRooms(org: string): Promise<PoolRoomSummary[]> {
  const rooms: PoolRoomSummary[] = [];
  for (const live of await liveRooms()) {
    if (live.org !== org) continue;
    const room = await readRoom(org, live.code);
    if (!room) {
      await forgetLive(org, live.code);
      continue;
    }
    if (!room.open || room.players.length === 0) continue;
    rooms.push(summaryOf(room));
  }
  rooms.sort((a, b) => Number(b.seatFree) - Number(a.seatFree) || a.createdAt - b.createdAt);
  return rooms;
}

/** Everything the page needs on opening: their room if they sit in one, the company's open rooms, their invites. */
export async function hello(seat: Seat): Promise<{ room: PoolView | null; rooms: PoolRoomSummary[]; invites: OpenInvite[] }> {
  const room = await roomOf(seat);
  const [rooms, invites] = await Promise.all([openRooms(seat.org), openInvitesFor(seat.org, seat.userId)]);
  return { room: room ? viewFor(room, seat.userId, deps.now()) : null, rooms, invites };
}

// ---------------------------------------------------------------- operations

export async function hostRoom(seat: Seat, options: { open?: unknown } = {}): Promise<PoolView> {
  // A few rooms in ten minutes is a game night; more is a loop.
  if (!(await claimWithin(`host:${seat.org}:${seat.userId}`, POOL.hostsPerWindow, POOL.hostWindowMs))) {
    throw new PoolError(429, 'That is enough new rooms for now. Try again in a few minutes.');
  }
  await leaveRoom(seat);
  const now = deps.now();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode(deps.random);
    const room = newRoom(code, seat.org, { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl }, options.open !== false, now);
    if (!(await createRoom(room))) continue;
    await setSeat(seat.org, seat.userId, code);
    emitter?.seat(seat.userId, seat.org, code, true);
    lastSent.delete(seat.userId);
    return viewFor(room, seat.userId, now);
  }
  throw new PoolError(503, 'Could not make a room just now. Try again.');
}

const NO_ROOM = 'No room with that code at your company. Check it and try again.';
const NOT_SEATED = 'You are not in that room any more.';
const FULL = 'That table has two players already.';

export async function joinRoom(seat: Seat, rawCode: unknown, options: { rejoin?: boolean } = {}): Promise<PoolView> {
  const rejoin = options.rejoin === true;
  const code = parseCode(rawCode);
  if (!code) throw new PoolError(404, NO_ROOM);
  // Only ever looked up in the viewer's own org: another company's code reads
  // the same as one that does not exist.
  const existing = await readRoom(seat.org, code);
  if (!existing) throw new PoolError(404, NO_ROOM);
  const already = playerOf(existing, seat.userId);
  // A rejoin (the page reconnecting to the room it was in) only ever puts back someone still seated there.
  if (!already && rejoin) throw new PoolError(404, NOT_SEATED);
  if (!already && existing.players.length >= POOL.maxPlayers) throw new PoolError(409, FULL);
  const current = await seatOf(seat.org, seat.userId);
  if (current && current !== code) await leaveRoom(seat);

  const changed = await change(seat.org, code, (room) => {
    const now = deps.now();
    const mine = playerOf(room, seat.userId);
    if (!mine && rejoin) throw new PoolError(404, NOT_SEATED);
    if (mine) {
      mine.online = true;
      mine.offlineAt = null;
      mine.name = seat.name;
      mine.photoUrl = seat.photoUrl;
      return { result: true, effects: [], write: true };
    }
    if (room.players.length >= POOL.maxPlayers) throw new PoolError(409, FULL);
    // Someone who was invited shows as "accepted your invite".
    const invited = room.invited.some((i) => i.userId === seat.userId);
    room.players.push(asPlayer(seat, now));
    room.invited = room.invited.filter((i) => i.userId !== seat.userId);
    return {
      result: true,
      effects: [{ type: 'feed', item: { kind: 'join', userId: seat.userId, name: seat.name, ...(invited ? { invited: true } : {}) } }],
      write: true,
    };
  }, [seat.userId]);
  if (!changed) throw new PoolError(404, NO_ROOM);
  await setSeat(seat.org, seat.userId, code);
  emitter?.seat(seat.userId, seat.org, code, true);
  // In the room now: the invite that brought them is answered.
  await clearInvite(seat.org, seat.userId, code);
  return viewFor(changed.room, seat.userId, deps.now());
}

/** Quick join: the oldest open lobby with a seat, else a new open room of your own. */
export async function quickJoin(seat: Seat): Promise<PoolView> {
  const mine = await roomOf(seat);
  if (mine) return viewFor(mine, seat.userId, deps.now());
  const rooms = (await openRooms(seat.org)).filter((r) => r.seatFree && r.status === 'lobby');
  for (const r of rooms) {
    try {
      return await joinRoom(seat, r.code);
    } catch (error) {
      if (!(error instanceof PoolError)) throw error;
    }
  }
  return hostRoom(seat, { open: true });
}

export async function leaveRoom(seat: Seat): Promise<void> {
  const room = await roomOf(seat);
  if (!room) return;
  emitter?.seat(seat.userId, seat.org, room.code, false);
  lastSent.delete(seat.userId);
  await clearSeatIf(seat.org, seat.userId, room.code);
  await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) return null;
    return { result: true, effects: removePlayer(r, seat.userId, deps.now()), write: true };
  });
}

/** Someone the viewer may invite: same company, still here, not a counsellor. */
async function findColleague(org: string, userId: string): Promise<Pick<User, 'userId' | 'name' | 'profilePhotoKey' | 'profilePhotoUrl'> | null> {
  if (typeof userId !== 'string' || !userId || userId.length > 64) return null;
  const escaped = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter: Filter<User> = {
    userId,
    lifecycleStatus: { $nin: INACTIVE },
    isCounsellor: { $ne: true }, hiddenFromDirectory: { $ne: true },
    $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${escaped}$`, $options: 'i' } }],
  };
  return users().findOne(filter, { projection: { _id: 0, userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } });
}

export async function inviteToRoom(seat: Seat, rawUserId: unknown): Promise<{ invited: true }> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (!userId || userId === seat.userId) throw new PoolError(400, 'Choose a colleague to invite.');
  if (playerOf(room, userId)) return { invited: true };
  if (room.players.length >= POOL.maxPlayers) throw new PoolError(409, FULL);
  if (room.invitesSent >= POOL.invitesPerGame) throw new PoolError(429, 'That is enough invites for one game.');
  const colleague = await findColleague(seat.org, userId);
  if (!colleague) throw new PoolError(404, "That person isn't a colleague you can invite.");
  const photoUrl = (await resolveProfilePhoto(colleague)) ?? null;
  // Keyed on the pair, not the room: a new room is not a fresh licence to push.
  const push = await claimOnce(`invite:${seat.org}:${seat.userId}:${userId}`, POOL.invitePushEveryMs);
  const changed = await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) throw new PoolError(404, 'You are not in a room.');
    if (playerOf(r, userId)) return { result: true, effects: [], write: false };
    if (!r.invited.some((i) => i.userId === userId)) r.invited.push({ userId, name: colleague.name, photoUrl });
    r.invitesSent += 1;
    const effects: Effect[] = [{ type: 'invite', userId, from: { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl }, code: r.code }];
    if (push) effects.push({ type: 'notify', userId, code: r.code, fromName: seat.name });
    return { result: true, effects, write: true };
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
  return { invited: true };
}

const HOST_ONLY_START = 'Only the host can start the game.';

export async function startRoom(seat: Seat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId) throw new PoolError(403, HOST_ONLY_START);
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new PoolError(403, HOST_ONLY_START);
    if (r.status !== 'lobby') throw new PoolError(409, 'The game has already started.');
    if (r.players.length < POOL.minPlayers) throw new PoolError(409, 'Need two players to start.');
    if (r.players.some((p) => !p.online)) throw new PoolError(409, 'Wait for your opponent to come back.');
    // The engine empties the invite list as the game starts; remembered here
    // so the invitees' pending cards go with it.
    const invitees = r.invited.map((i) => i.userId);
    try {
      return { result: invitees, effects: startGame(r, deps.now(), `g${randomUUID().slice(0, 8)}`), write: true };
    } catch (error) {
      return asPoolError(error);
    }
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
  for (const userId of changed.result) await clearInvite(seat.org, userId, room.code);
}

/**
 * A rematch from the podium, which either player may ask for: with both still
 * at the table a new game starts at once and the loser breaks; with a seat
 * empty the room goes back to its lobby to wait for an opponent.
 */
export async function againRoom(seat: Seat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.status !== 'over') throw new PoolError(409, 'The game is still on.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.status !== 'over') throw new PoolError(409, 'The game is still on.');
    if (r.players.length < POOL.minPlayers || r.players.some((p) => !p.online)) return { result: true, effects: resetToLobby(r), write: true };
    try {
      return { result: true, effects: startGame(r, deps.now(), `g${randomUUID().slice(0, 8)}`), write: true };
    } catch (error) {
      return asPoolError(error);
    }
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
}

/** Ball in hand: `{x, y}` on the table (behind the head string after a break foul), clear of other balls. */
export async function placeBall(seat: Seat, raw: { x?: unknown; y?: unknown }): Promise<PoolView> {
  const room = await requireRoom(seat);
  const changed = await change(seat.org, room.code, (r) => {
    try {
      applyPlace(r, seat.userId, raw, deps.now());
      return { result: true, effects: [], write: true };
    } catch (error) {
      return asPoolError(error);
    }
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
  return viewFor(changed.room, seat.userId, deps.now());
}

/** The called pocket for the 8, `{pocket: 0..5}`. */
export async function callPocket(seat: Seat, raw: { pocket?: unknown }): Promise<PoolView> {
  const room = await requireRoom(seat);
  const changed = await change(seat.org, room.code, (r) => {
    try {
      applyCall(r, seat.userId, raw.pocket, deps.now());
      return { result: true, effects: [], write: true };
    } catch (error) {
      return asPoolError(error);
    }
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
  return viewFor(changed.room, seat.userId, deps.now());
}

/**
 * A shot on your turn, `{aim, power, spin: {top, side}}`: the server simulates
 * and rules it, keeps it as `lastShot` for both pages to replay, and answers
 * with the shooter's view (the same view everyone is pushed).
 */
export async function takeShot(seat: Seat, raw: { aim?: unknown; power?: unknown; spin?: unknown }): Promise<PoolView> {
  const room = await requireRoom(seat);
  if (room.status !== 'playing') throw new PoolError(409, 'The game is not on.');
  const shot = ((): Shot => {
    try {
      return parseShot(raw);
    } catch (error) {
      return asPoolError(error);
    }
  })();
  const changed = await change(seat.org, room.code, (r) => {
    try {
      return { result: true, effects: applyShot(r, seat.userId, shot, deps.now()), write: true };
    } catch (error) {
      return asPoolError(error);
    }
  });
  if (!changed) throw new PoolError(404, 'That room has closed.');
  return viewFor(changed.room, seat.userId, deps.now());
}

// ---------------------------------------------------------------- pending invites

/** An invite still worth answering, as a fresh socket shows it. */
export interface OpenInvite {
  code: string;
  from: { userId: string; name: string; photoUrl: string | null };
  /** In the room now. */
  players: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * The invites waiting on this person whose room is still in its lobby with a
 * seat, oldest first. A record whose room has gone, started, filled or run
 * out is dropped as it is met, so the list is never stale for more than one read.
 */
export async function openInvitesFor(org: string, userId: string): Promise<OpenInvite[]> {
  const now = deps.now();
  const open: OpenInvite[] = [];
  for (const invite of await pendingInvitesOf(org, userId, now)) {
    const room = await readRoom(org, invite.code);
    if (!inviteOpen(invite, room, userId, now)) {
      await clearInvite(org, userId, invite.code);
      continue;
    }
    const inviter = playerOf(room!, invite.inviter.userId);
    open.push({
      code: invite.code,
      from: { userId: invite.inviter.userId, name: inviter?.name ?? invite.inviter.name, photoUrl: inviter?.photoUrl ?? null },
      players: room!.players.length,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    });
  }
  return open;
}

// ---------------------------------------------------------------- presence

/**
 * A fresh socket: back into the room this person sits in, marked online, and
 * sent what is true now. Returns the room's code so the socket layer can join
 * its channel.
 */
export async function onConnected(seat: Seat): Promise<string | null> {
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
      return { result: true, effects: [], write: true };
    },
    [seat.userId],
  );
  return changed ? room.code : null;
}

/** Their last socket closed: the chip dims; the shot clock and the away rule decide the rest. */
export async function onDisconnected(seat: Seat): Promise<void> {
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

const INSTANCE = randomUUID();
const LEASE_MS = 1500;
let ticking = false;

/**
 * Moves every live room on to wherever the clock says (a shot whose time ran
 * out is a foul, a player away too long forfeits). One pass at a time, and one
 * instance per room per pass (a short lease), so two backends never both foul
 * a shooter.
 */
export async function tickPool(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const { org, code } of await liveRooms()) {
      if (!(await leaseRoom(org, code, INSTANCE, LEASE_MS))) continue;
      try {
        const room = await readRoom(org, code);
        if (!room) {
          await forgetLive(org, code);
          continue;
        }
        const now = deps.now();
        await change(org, code, (r) => {
          const effects = advance(r, now);
          return effects ? { result: true, effects, write: !effects.some((e) => e.type === 'delete') } : null;
        });
      } catch (error) {
        logger.error('Pool tick failed for a room', { org, code }, error);
      } finally {
        await releaseRoom(org, code, INSTANCE);
      }
    }
  } finally {
    ticking = false;
  }
}

/** For checks: the room as stored. */
export async function peekRoom(org: string, code: string): Promise<PoolRoom | null> {
  return readRoom(org, code);
}
