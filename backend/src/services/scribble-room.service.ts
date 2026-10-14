import { randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import blocked from '../content/scribble-blocked.json';
import { users } from '../config/db';
import { ScribbleOp, ScribblePlayer, ScribbleRoom, ScribbleView } from '../models/scribble.model';
import type { User } from '../models/user.model';
import { recordServerScore } from './game-catalog.service';
import { notifyUsers, NotificationInput } from './notification.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  Effect,
  GuessResult,
  SCRIBBLE,
  advance,
  applyGuess,
  chooseWord,
  firstName,
  makeCode,
  newRoom,
  parseCode,
  playerOf,
  removePlayer,
  resetToLobby,
  standings,
  startGame,
  turnKeyOf,
  viewFingerprint,
  viewFor,
} from './scribble-engine';
import {
  appendStrokes,
  claimOnce,
  claimWithin,
  clearSeatIf,
  clearStrokes,
  createRoom,
  deleteRoom,
  forgetLive,
  leaseRoom,
  liveRooms,
  mutateRoom,
  readRoom,
  readStrokes,
  releaseRoom,
  seatOf,
  setSeat,
} from './scribble-store';
import { logger } from '../utils/logger';

/**
 * Scribble's rooms: what a player may do to one, and what everyone is told.
 *
 * Every operation reads the room, applies a rule from the engine under the
 * store's compare-and-set, carries out the effects (a feed line, a push, a
 * removed player told so) and sends each player their own view. The socket
 * layer (`scribble-realtime.service.ts`) is a thin shell around this; the
 * check script drives it with a clock it moves by hand.
 */

export class ScribbleError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ScribbleError';
  }
}

/** Who is acting, as the socket authenticated them. */
export interface Seat {
  userId: string;
  org: string;
  name: string;
  photoUrl: string | null;
}

export interface ScribbleEmitter {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(org: string, code: string, event: string, payload: unknown): void;
  /** Moves every socket this person holds, on every instance, into the room's channel or out of it. */
  seat(userId: string, org: string, code: string, inside: boolean): void;
}

export interface ScribbleDeps {
  now: () => number;
  random: () => number;
  notify: (userIds: string[], input: NotificationInput) => Promise<void>;
  recordScore: (org: string, player: { userId: string; name: string }, score: number) => Promise<void>;
}

const deps: ScribbleDeps = {
  now: () => Date.now(),
  random: Math.random,
  notify: notifyUsers,
  recordScore: (org, player, score) => recordServerScore(org, 'scribble', { ...player, org }, score),
};

let emitter: ScribbleEmitter | null = null;

/** For checks: a clock, a die, a notifier of their own. Partial; the rest stays. */
export function configureScribble(overrides: Partial<ScribbleDeps>): void {
  Object.assign(deps, overrides);
}

export function setScribbleEmitter(target: ScribbleEmitter | null): void {
  emitter = target;
}

export const scribbleNow = () => deps.now();

const BLOCKED = new Set((blocked as string[]).map((w) => w.toLowerCase()));
const isBlocked = (normalized: string) => normalized.split(' ').some((word) => BLOCKED.has(word));

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

/**
 * Sends every player their own view, with the stroke log for those in
 * `strokesFor` (a joiner, a reconnecter, everyone after a clear).
 */
async function pushRoom(room: ScribbleRoom, strokesFor: 'all' | string[] = []): Promise<void> {
  if (!emitter) return;
  const now = deps.now();
  const wantStrokes = strokesFor === 'all' ? new Set(room.players.map((p) => p.userId)) : new Set(strokesFor);
  const strokes = wantStrokes.size > 0 ? await readStrokes(room.org, room.code) : null;
  for (const player of room.players) {
    const view = viewFor(room, player.userId, now);
    const print = viewFingerprint(view);
    const withStrokes = wantStrokes.has(player.userId);
    const sent = lastSent.get(player.userId);
    if (!withStrokes && sent && sent.print === print && sent.version === room.version) continue;
    lastSent.set(player.userId, { print, version: room.version });
    emitter.toUser(player.userId, 'room:state', withStrokes ? { room: view, strokes: strokes ?? [] } : { room: view });
  }
}

async function applyEffects(room: ScribbleRoom, effects: Effect[]): Promise<{ deleted: boolean; strokesFor: 'all' | string[] }> {
  let deleted = false;
  let strokesFor: 'all' | string[] = [];
  for (const effect of effects) {
    switch (effect.type) {
      case 'feed':
        emitter?.toRoom(room.org, room.code, 'room:feed', effect.item);
        break;
      case 'close':
        emitter?.toUser(effect.userId, 'scribble:close', { text: effect.text });
        break;
      case 'kicked':
        emitter?.toUser(effect.userId, 'room:kicked', { by: effect.by });
        emitter?.seat(effect.userId, room.org, room.code, false);
        lastSent.delete(effect.userId);
        await clearSeatIf(room.org, effect.userId, room.code);
        break;
      case 'invite':
        emitter?.toUser(effect.userId, 'room:invite', { from: effect.from, code: effect.code });
        break;
      case 'notify':
        void deps
          .notify([effect.userId], {
            scenario: 'scribble_invite',
            title: `${firstName(effect.fromName)} invited you to Scribble`,
            body: `Room ${effect.code} · tap to join`,
            // The app already opens a game on this destination, and the page
            // reads the room code out of startChallengeId.
            data: { destination: 'game_challenge', gameKey: 'scribble', challengeId: `room:${effect.code}` },
          })
          .catch((error) => logger.error('Scribble invite push failed', { org: room.org, code: room.code }, error));
        break;
      case 'clearStrokes':
        await clearStrokes(room.org, room.code);
        strokesFor = 'all';
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
        break;
      }
      default:
        break;
    }
  }
  return { deleted, strokesFor };
}

/** The final scores go to the game's own leaderboard; the page never submits them. */
function recordScores(room: ScribbleRoom): void {
  for (const row of standings(room)) {
    if (row.score <= 0) continue;
    void deps
      .recordScore(room.org, { userId: row.userId, name: row.name }, row.score)
      .catch((error) => logger.error('Scribble score record failed', { org: room.org, code: room.code, userId: row.userId }, error));
  }
}

/**
 * Reads, changes, writes and tells: the one path every change takes. `change`
 * returns what to do, or null when nothing changed (nothing is written or
 * pushed then, but any effects — a wrong guess in the feed — still happen).
 */
async function change<T>(
  org: string,
  code: string,
  fn: (room: ScribbleRoom) => { result: T; effects: Effect[]; write: boolean } | null,
  /** Who gets the stroke log with their view, besides whoever the effects say. */
  strokesTo: string[] = [],
): Promise<{ room: ScribbleRoom; result: T } | null> {
  // Held in a box: the callback assigns them, which narrowing cannot see.
  const box: { outcome: { result: T; effects: Effect[]; write: boolean } | null; seen: ScribbleRoom | null } = { outcome: null, seen: null };
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
  const { deleted, strokesFor } = await applyEffects(room, outcome.effects);
  if (written && !deleted) await pushRoom(room, strokesFor === 'all' ? 'all' : [...strokesFor, ...strokesTo]);
  return { room, result: outcome.result };
}

// ---------------------------------------------------------------- where someone sits

async function roomOf(seat: Seat): Promise<ScribbleRoom | null> {
  const code = await seatOf(seat.org, seat.userId);
  if (!code) return null;
  const room = await readRoom(seat.org, code);
  if (!room || !playerOf(room, seat.userId)) {
    await clearSeatIf(seat.org, seat.userId, code);
    return null;
  }
  return room;
}

async function requireRoom(seat: Seat): Promise<ScribbleRoom> {
  const room = await roomOf(seat);
  if (!room) throw new ScribbleError(404, 'You are not in a room.');
  return room;
}

const asPlayer = (seat: Seat, now: number): ScribblePlayer => ({
  userId: seat.userId,
  name: seat.name,
  photoUrl: seat.photoUrl,
  score: 0,
  joinedAt: now,
  online: true,
  offlineAt: null,
});

// ---------------------------------------------------------------- operations

export async function hostRoom(seat: Seat): Promise<ScribbleView> {
  // A few rooms in ten minutes is a game night; more is a loop.
  if (!(await claimWithin(`host:${seat.org}:${seat.userId}`, SCRIBBLE.hostsPerWindow, SCRIBBLE.hostWindowMs))) {
    throw new ScribbleError(429, 'That is enough new rooms for now. Try again in a few minutes.');
  }
  await leaveRoom(seat);
  const now = deps.now();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode(deps.random);
    const room = newRoom(code, seat.org, { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl }, now);
    if (!(await createRoom(room))) continue;
    await setSeat(seat.org, seat.userId, code);
    emitter?.seat(seat.userId, seat.org, code, true);
    lastSent.delete(seat.userId);
    return viewFor(room, seat.userId, now);
  }
  throw new ScribbleError(503, 'Could not make a room just now. Try again.');
}

const NO_ROOM = 'No room with that code at your company. Check it and try again.';

const KICKED_MESSAGE = 'The host removed you from this room. You can come back in a minute, or at once if the host invites you again.';
/** Removed, and still inside the cool-down. */
const stillKicked = (room: ScribbleRoom, userId: string, now: number) =>
  room.kicked.some((k) => k.userId === userId && k.at + SCRIBBLE.kickCooldownMs > now);

export async function joinRoom(seat: Seat, rawCode: unknown): Promise<{ room: ScribbleView; strokes: ScribbleOp[] }> {
  const code = parseCode(rawCode);
  if (!code) throw new ScribbleError(404, NO_ROOM);
  // Only ever looked up in the viewer's own org: another company's code reads
  // the same as one that does not exist.
  const existing = await readRoom(seat.org, code);
  if (!existing) throw new ScribbleError(404, NO_ROOM);
  if (stillKicked(existing, seat.userId, deps.now())) throw new ScribbleError(403, KICKED_MESSAGE);
  const already = playerOf(existing, seat.userId);
  if (!already && existing.players.length >= SCRIBBLE.maxPlayers) {
    throw new ScribbleError(409, `That room is full (${SCRIBBLE.maxPlayers} of ${SCRIBBLE.maxPlayers}).`);
  }
  const current = await seatOf(seat.org, seat.userId);
  if (current && current !== code) await leaveRoom(seat);

  const changed = await change(seat.org, code, (room) => {
    const now = deps.now();
    if (stillKicked(room, seat.userId, now)) throw new ScribbleError(403, KICKED_MESSAGE);
    const mine = playerOf(room, seat.userId);
    if (mine) {
      mine.online = true;
      mine.offlineAt = null;
      mine.name = seat.name;
      mine.photoUrl = seat.photoUrl;
      return { result: true, effects: [], write: true };
    }
    if (room.players.length >= SCRIBBLE.maxPlayers) {
      throw new ScribbleError(409, `That room is full (${SCRIBBLE.maxPlayers} of ${SCRIBBLE.maxPlayers}).`);
    }
    room.players.push(asPlayer(seat, now));
    room.invited = room.invited.filter((i) => i.userId !== seat.userId);
    return {
      result: true,
      effects: [{ type: 'feed', item: { kind: 'join', userId: seat.userId, name: seat.name, text: `${firstName(seat.name)} joined` } }],
      write: true,
    };
  });
  if (!changed) throw new ScribbleError(404, NO_ROOM);
  await setSeat(seat.org, seat.userId, code);
  emitter?.seat(seat.userId, seat.org, code, true);
  return { room: viewFor(changed.room, seat.userId, deps.now()), strokes: await readStrokes(seat.org, code) };
}

export async function leaveRoom(seat: Seat): Promise<void> {
  const room = await roomOf(seat);
  if (!room) return;
  emitter?.seat(seat.userId, seat.org, room.code, false);
  lastSent.delete(seat.userId);
  await clearSeatIf(seat.org, seat.userId, room.code);
  await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) return null;
    return { result: true, effects: removePlayer(r, seat.userId, 'leave', null, deps.now(), deps.random), write: true };
  });
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

export async function inviteToRoom(seat: Seat, rawUserId: unknown): Promise<{ invited: true }> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (!userId || userId === seat.userId) throw new ScribbleError(400, 'Choose a colleague to invite.');
  if (playerOf(room, userId)) return { invited: true };
  if (room.players.length >= SCRIBBLE.maxPlayers) throw new ScribbleError(409, 'The room is full.');
  if (room.invitesSent >= SCRIBBLE.invitesPerGame) throw new ScribbleError(429, 'That is enough invites for one game.');
  const colleague = await findColleague(seat.org, userId);
  if (!colleague) throw new ScribbleError(404, "That person isn't a colleague you can invite.");
  const photoUrl = (await resolveProfilePhoto(colleague)) ?? null;
  // Keyed on the pair, not the room: a new room is not a fresh licence to push.
  const push = await claimOnce(`invite:${seat.org}:${seat.userId}:${userId}`, SCRIBBLE.invitePushEveryMs);
  const changed = await change(seat.org, room.code, (r) => {
    // An invite from the host ends any cool-down from a removal.
    r.kicked = r.kicked.filter((k) => k.userId !== userId);
    if (!playerOf(r, seat.userId)) throw new ScribbleError(404, 'You are not in a room.');
    if (playerOf(r, userId)) return { result: true, effects: [], write: false };
    if (!r.invited.some((i) => i.userId === userId)) r.invited.push({ userId, name: colleague.name, photoUrl });
    r.invitesSent += 1;
    const effects: Effect[] = [{ type: 'invite', userId, from: { userId: seat.userId, name: seat.name, photoUrl: seat.photoUrl }, code: r.code }];
    if (push) effects.push({ type: 'notify', userId, code: r.code, fromName: seat.name });
    return { result: true, effects, write: true };
  });
  if (!changed) throw new ScribbleError(404, 'That room has closed.');
  return { invited: true };
}

export async function startRoom(seat: Seat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId) throw new ScribbleError(403, 'Only the host can start the game.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new ScribbleError(403, 'Only the host can start the game.');
    if (r.status !== 'lobby') throw new ScribbleError(409, 'The game has already started.');
    const online = r.players.filter((p) => p.online).length;
    if (online < SCRIBBLE.minPlayers) throw new ScribbleError(409, `Need ${SCRIBBLE.minPlayers} players to start.`);
    return { result: true, effects: startGame(r, deps.now(), deps.random, randomUUID().slice(0, 8)), write: true };
  });
  if (!changed) throw new ScribbleError(404, 'That room has closed.');
}

export async function kickFromRoom(seat: Seat, rawUserId: unknown): Promise<void> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (room.hostId !== seat.userId) throw new ScribbleError(403, 'Only the host can remove players.');
  if (!userId || userId === seat.userId) throw new ScribbleError(400, 'Choose a player to remove.');
  if (!playerOf(room, userId)) throw new ScribbleError(404, 'That player has already left.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId) throw new ScribbleError(403, 'Only the host can remove players.');
    const by = playerOf(r, seat.userId) ?? null;
    if (!playerOf(r, userId)) return null;
    return { result: true, effects: removePlayer(r, userId, 'kick', by, deps.now(), deps.random), write: true };
  });
  if (!changed) throw new ScribbleError(404, 'That player has already left.');
}

export async function againRoom(seat: Seat): Promise<void> {
  const room = await requireRoom(seat);
  if (room.hostId !== seat.userId || room.status !== 'over') throw new ScribbleError(403, 'Only the host can start again.');
  const changed = await change(seat.org, room.code, (r) => {
    if (r.hostId !== seat.userId || r.status !== 'over') throw new ScribbleError(403, 'Only the host can start again.');
    return { result: true, effects: resetToLobby(r), write: true };
  });
  if (!changed) throw new ScribbleError(404, 'That room has closed.');
}

export async function pickWord(seat: Seat, rawIndex: unknown, turn: unknown): Promise<void> {
  const room = await requireRoom(seat);
  const index = typeof rawIndex === 'number' && Number.isInteger(rawIndex) ? rawIndex : Number(rawIndex) || 0;
  const tooLate = () => new ScribbleError(409, 'Too late to pick.');
  if (room.status !== 'picking' || room.drawerId !== seat.userId || turn !== turnKeyOf(room)) throw tooLate();
  const changed = await change(seat.org, room.code, (r) => {
    if (r.status !== 'picking' || r.drawerId !== seat.userId || turn !== turnKeyOf(r)) throw tooLate();
    return { result: true, effects: chooseWord(r, Math.max(0, Math.min(2, index)), deps.now()), write: true };
  });
  if (!changed) throw tooLate();
}

export async function guessWord(seat: Seat, rawText: unknown, turn: unknown): Promise<GuessResult> {
  const room = await requireRoom(seat);
  if (room.status !== 'drawing' || room.drawerId === seat.userId) return { correct: false };
  const text = String(rawText ?? '').slice(0, SCRIBBLE.maxGuessChars);
  const changed = await change(seat.org, room.code, (r) => {
    const judged = applyGuess(r, seat.userId, text, turn, deps.now(), isBlocked);
    return { result: judged.result, effects: judged.effects, write: judged.changed };
  });
  return changed?.result ?? { correct: false };
}

/** What a drawer's strokes are checked against, or null when they may not draw. */
export async function drawingContext(seat: Seat): Promise<{ org: string; code: string; turnKey: string } | null> {
  const room = await roomOf(seat);
  if (!room || room.status !== 'drawing' || room.drawerId !== seat.userId) return null;
  const turnKey = turnKeyOf(room);
  return turnKey ? { org: room.org, code: room.code, turnKey } : null;
}

/** Appends validated ops to the turn's log; the socket layer fans them out. */
export async function logStrokes(org: string, code: string, ops: ScribbleOp[]): Promise<void> {
  await appendStrokes(org, code, ops);
}

// ---------------------------------------------------------------- presence

/**
 * A fresh socket: back into the room this person sits in, marked online, and
 * sent what is true now with the strokes so far. Returns the room's code so
 * the socket layer can join its channel.
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

/** Their last socket closed: the chip dims; the clock decides the rest. */
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
 * Moves every live room on to wherever the clock says. One pass at a time,
 * and one instance per room per pass (a short lease), so two backends never
 * both end a turn.
 */
export async function tickScribble(): Promise<void> {
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
          const effects = advance(r, now, deps.random);
          return effects ? { result: true, effects, write: !effects.some((e) => e.type === 'delete') } : null;
        });
      } catch (error) {
        logger.error('Scribble tick failed for a room', { org, code }, error);
      } finally {
        await releaseRoom(org, code, INSTANCE);
      }
    }
  } finally {
    ticking = false;
  }
}

/** For checks: the room as stored. */
export async function peekRoom(org: string, code: string): Promise<ScribbleRoom | null> {
  return readRoom(org, code);
}
