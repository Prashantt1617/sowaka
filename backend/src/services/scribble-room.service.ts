import { randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import blocked from '../content/scribble-blocked.json';
import { users } from '../config/db';
import { ScribbleOp, ScribblePlayer, ScribbleRoom, ScribbleView } from '../models/scribble.model';
import type { User } from '../models/user.model';
import { recordServerScore } from './game-catalog.service';
import { recordPointChanges } from './points-ledger.service';
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
  forgetKick,
  inviteOpen,
  makeCode,
  newRoom,
  parseCode,
  playerOf,
  removePlayer,
  resetToLobby,
  standings,
  startGame,
  stillKicked,
  turnKeyOf,
  viewFingerprint,
  viewFor,
  wasKicked,
} from './scribble-engine';
import {
  appendStrokes,
  claimOnce,
  claimWithin,
  clearInvite,
  clearSeatIf,
  clearStrokes,
  createRoom,
  deleteRoom,
  forgetLive,
  leaseRoom,
  liveRooms,
  mutateRoom,
  pendingInvitesOf,
  readRoom,
  readStrokes,
  recordInvite,
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
  /** Engagement points for one player's finished game (profile rank and the Games leaderboard). */
  awardPoints: (award: ScribbleAward) => Promise<void>;
}

export interface ScribbleAward {
  org: string;
  userId: string;
  points: number;
  gameId: string;
  score: number;
  place: number;
  players: number;
}

/** What a finished game pays each player: their own score ÷ 100, rounded, at most this many. */
export const SCRIBBLE_POINTS_PER_SCORE = 100;
export const SCRIBBLE_POINTS_MAX = 25;
export const scribblePointsFor = (score: number): number =>
  Math.max(0, Math.min(SCRIBBLE_POINTS_MAX, Math.round(score / SCRIBBLE_POINTS_PER_SCORE)));

const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

async function payPoints(award: ScribbleAward): Promise<void> {
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
      note: `Scribble · ${award.score.toLocaleString('en-IN')} points · ${ordinal(award.place)} of ${award.players}`,
      gameKey: 'scribble',
      title: 'Scribble',
    }],
    { keepZero: true },
  );
}

const deps: ScribbleDeps = {
  now: () => Date.now(),
  random: Math.random,
  notify: notifyUsers,
  recordScore: (org, player, score) => recordServerScore(org, 'scribble', { ...player, org }, score),
  awardPoints: payPoints,
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
        // A fresh invite from the host puts the card back.
        await clearInvite(room.org, effect.userId, room.code);
        break;
      case 'invite':
        // Kept until answered, so the Games tab and a later socket can show
        // it; a second invite to the same room refreshes the one record.
        await recordInvite(effect.userId, {
          org: room.org,
          code: effect.code,
          inviter: { userId: effect.from.userId, name: effect.from.name },
          createdAt: deps.now(),
          expiresAt: room.createdAt + SCRIBBLE.roomMaxMs,
        });
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
  return { deleted, strokesFor };
}

/**
 * The final scores go to the game's own leaderboard (the page never submits
 * them), and each player is paid engagement points for their own score, once
 * per game however many instances see it finish.
 */
function recordScores(room: ScribbleRoom): void {
  const rows = standings(room);
  for (const row of rows) {
    if (row.score <= 0) continue;
    void deps
      .recordScore(room.org, { userId: row.userId, name: row.name }, row.score)
      .catch((error) => logger.error('Scribble score record failed', { org: room.org, code: room.code, userId: row.userId }, error));
  }
  const gameId = room.gameId;
  if (!gameId || rows.length < SCRIBBLE.minPlayers) return;
  void (async () => {
    if (!(await claimOnce(`points:${room.org}:${gameId}`, 7 * 24 * 60 * 60 * 1000))) return;
    for (const row of rows) {
      await deps
        .awardPoints({ org: room.org, userId: row.userId, points: scribblePointsFor(row.score), gameId, score: row.score, place: row.place, players: rows.length })
        .catch((error) => logger.error('Scribble points failed', { org: room.org, gameId, userId: row.userId }, error));
    }
  })();
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
const REMOVED_MESSAGE = 'The host removed you from this room.';
const NOT_SEATED = 'You are not in that room any more.';

/**
 * A rejoin (the page reconnecting to the room it was in) only ever puts back
 * someone still seated there: one removed while offline is told so, whatever
 * the cool-down says, and anyone else gets a 404. The cool-down applies only
 * to a fresh join by code.
 */
const refuseRejoin = (room: ScribbleRoom, userId: string) =>
  wasKicked(room, userId) ? new ScribbleError(403, REMOVED_MESSAGE) : new ScribbleError(404, NOT_SEATED);

export async function joinRoom(seat: Seat, rawCode: unknown, options: { rejoin?: boolean } = {}): Promise<{ room: ScribbleView; strokes: ScribbleOp[] }> {
  const rejoin = options.rejoin === true;
  const code = parseCode(rawCode);
  if (!code) throw new ScribbleError(404, NO_ROOM);
  // Only ever looked up in the viewer's own org: another company's code reads
  // the same as one that does not exist.
  const existing = await readRoom(seat.org, code);
  if (!existing) throw new ScribbleError(404, NO_ROOM);
  const already = playerOf(existing, seat.userId);
  if (!already && rejoin) throw refuseRejoin(existing, seat.userId);
  if (!already && stillKicked(existing, seat.userId, deps.now())) throw new ScribbleError(403, KICKED_MESSAGE);
  if (!already && existing.players.length >= SCRIBBLE.maxPlayers) {
    throw new ScribbleError(409, `That room is full (${SCRIBBLE.maxPlayers} of ${SCRIBBLE.maxPlayers}).`);
  }
  const current = await seatOf(seat.org, seat.userId);
  if (current && current !== code) await leaveRoom(seat);

  const changed = await change(seat.org, code, (room) => {
    const now = deps.now();
    const mine = playerOf(room, seat.userId);
    if (!mine && rejoin) throw refuseRejoin(room, seat.userId);
    if (!mine && stillKicked(room, seat.userId, now)) throw new ScribbleError(403, KICKED_MESSAGE);
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
  // In the room now: the invite that brought them is answered.
  await clearInvite(seat.org, seat.userId, code);
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

const HOST_ONLY_REINVITE = 'Only the host can invite someone they removed.';

export async function inviteToRoom(seat: Seat, rawUserId: unknown): Promise<{ invited: true }> {
  const room = await requireRoom(seat);
  const userId = String(rawUserId ?? '').trim();
  if (!userId || userId === seat.userId) throw new ScribbleError(400, 'Choose a colleague to invite.');
  if (playerOf(room, userId)) return { invited: true };
  if (room.players.length >= SCRIBBLE.maxPlayers) throw new ScribbleError(409, 'The room is full.');
  if (room.invitesSent >= SCRIBBLE.invitesPerGame) throw new ScribbleError(429, 'That is enough invites for one game.');
  // Only the host can undo their own removal early; anyone may invite them once the cool-down is over.
  if (room.hostId !== seat.userId && stillKicked(room, userId, deps.now())) throw new ScribbleError(403, HOST_ONLY_REINVITE);
  const colleague = await findColleague(seat.org, userId);
  if (!colleague) throw new ScribbleError(404, "That person isn't a colleague you can invite.");
  const photoUrl = (await resolveProfilePhoto(colleague)) ?? null;
  // Keyed on the pair, not the room: a new room is not a fresh licence to push.
  const push = await claimOnce(`invite:${seat.org}:${seat.userId}:${userId}`, SCRIBBLE.invitePushEveryMs);
  const changed = await change(seat.org, room.code, (r) => {
    if (!playerOf(r, seat.userId)) throw new ScribbleError(404, 'You are not in a room.');
    if (playerOf(r, userId)) return { result: true, effects: [], write: false };
    // An invite from the host ends any removal; anyone else's waits out the cool-down.
    if (r.hostId === seat.userId) forgetKick(r, userId);
    else if (stillKicked(r, userId, deps.now())) throw new ScribbleError(403, HOST_ONLY_REINVITE);
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
    // The engine empties the invite list as the game starts; remembered here
    // so the invitees' pending cards go with it.
    const invitees = r.invited.map((i) => i.userId);
    return { result: invitees, effects: startGame(r, deps.now(), deps.random, randomUUID().slice(0, 8)), write: true };
  });
  if (!changed) throw new ScribbleError(404, 'That room has closed.');
  for (const userId of changed.result) await clearInvite(seat.org, userId, room.code);
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

// ---------------------------------------------------------------- pending invites

/** An invite still worth answering, as the Games tab and a fresh socket show it. */
export interface OpenInvite {
  code: string;
  from: { userId: string; name: string; photoUrl: string | null };
  /** In the room now. */
  players: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * The invites waiting on this person whose room is still in its lobby, oldest
 * first. A record whose room has gone, started, or run out is dropped as it
 * is met, so the list is never stale for more than one read.
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
