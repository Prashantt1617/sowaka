import type { PoolBallAtRest, PoolFeedItem, PoolFinalLine, PoolPlayer, PoolResultReason, PoolRoom, PoolView } from '../models/pool.model';
import {
  Ball,
  DT,
  RuleState,
  Shot,
  groupOf,
  onEight,
  placementOk,
  rack,
  resolve,
  simulateShot,
} from '../shared/pool/engine';

/**
 * Sowaka Pool's rooms, with no I/O: Tile Up's room engine (players, host,
 * invites, idle rooms) with 8-ball turns in place of Scrabble's. The physics
 * and the rules are the shared engine's (`shared/pool/engine.ts`); this file
 * only decides who may shoot, when, and what the room looks like afterwards.
 *
 * Everything here takes a room record and a clock and says what should be
 * true now. The store layer applies it under a compare-and-set, the socket
 * layer sends what comes out, and the check script runs it against a clock
 * it moves by hand.
 */

export const POOL = {
  minPlayers: 2,
  maxPlayers: 2,
  /** A shot's time, in seconds, counted from the end of the previous shot's replay. */
  shotSecs: 30,
  /** The server fouls a shooter this long after the clock the page shows runs out, so a shot made at 0 still counts. */
  graceMs: 1500,
  /** A replay never holds the next shot longer than this, however long the balls rolled. */
  replayMaxMs: 20_000,
  /** The pages are given this much over the engine's own time to finish drawing a shot. */
  replayPadMs: 300,
  /** A host offline this long hands the role to the other player. */
  hostGoneMs: 30_000,
  /** A player offline this long mid-game forfeits it. */
  playerGoneMs: 90_000,
  /** A lobby with nobody online this long is deleted. */
  lobbyIdleMs: 10 * 60_000,
  /** A finished room stays for a rematch this long. */
  overKeepMs: 15 * 60_000,
  /** No room outlives this. */
  roomMaxMs: 4 * 60 * 60_000,
  invitesPerGame: 20,
  /** One push per inviter per invitee this often, whatever the room. */
  invitePushEveryMs: 10 * 60_000,
  /** How many rooms one person may open in `hostWindowMs`. */
  hostsPerWindow: 5,
  hostWindowMs: 10 * 60_000,
  /** A win is 1,000 on the leaderboard; each of your own balls potted is 100. */
  winScore: 1000,
  ballScore: 100,
} as const;

export type Random = () => number;

export function makeCode(random: Random): string {
  return String(1000 + (Math.floor(random() * 9000) % 9000));
}

/** `room:4827` or `4827` → `4827`; anything else null. */
export function parseCode(raw: unknown): string | null {
  const match = /^(?:room:)?([1-9]\d{3})$/i.exec(String(raw ?? '').trim());
  return match ? match[1] : null;
}

export const firstName = (name: string) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

export function playerOf(room: PoolRoom, userId: string): PoolPlayer | undefined {
  return room.players.find((p) => p.userId === userId);
}

/** The player's seat, 0 or 1, or -1 when they are not in the room. */
export const indexOf = (room: PoolRoom, userId: string): number => room.players.findIndex((p) => p.userId === userId);

/** Whether a pending invite is still worth showing: the room is in its lobby with a seat free, the invite has not run out, and they are not in it. */
export function inviteOpen(
  invite: { expiresAt: number },
  room: { status: string; players: Array<{ userId: string }> } | null,
  userId: string,
  now: number,
): boolean {
  if (!room || room.status !== 'lobby') return false;
  if (invite.expiresAt <= now) return false;
  if (room.players.some((p) => p.userId === userId)) return false;
  return room.players.length < POOL.maxPlayers;
}

// ---------------------------------------------------------------- the view

export const atRest = (balls: Ball[]): PoolBallAtRest[] => balls.map((b) => ({ n: b.n, x: b.x, y: b.y, on: b.on }));

/** Balls of this group that have dropped. */
export const pottedOf = (balls: Ball[], group: 'solid' | 'stripe' | null): number =>
  group ? balls.filter((b) => !b.on && groupOf(b.n) === group).length : 0;

/** One player's screen. Both players see the same table; `you` tells the page which seat is theirs. */
export function viewFor(room: PoolRoom, userId: string, now: number): PoolView {
  const st = room.state;
  const playing = room.status === 'playing' && !!st;
  return {
    code: room.code,
    status: room.status,
    you: userId,
    hostId: room.hostId,
    open: room.open,
    serverNow: now,
    players: room.players.map((p, i) => ({
      userId: p.userId,
      name: p.name,
      photoUrl: p.photoUrl,
      online: p.online,
      group: st ? st.groups[i as 0 | 1] ?? null : null,
      pottedCount: st ? pottedOf(st.balls, st.groups[i as 0 | 1] ?? null) : 0,
    })),
    invited: room.invited,
    turn: st ? st.turn : room.breaker,
    balls: st ? atRest(st.balls) : [],
    inHand: playing && st.inHand,
    kitchen: playing && st.kitchen,
    open8: st ? st.open : true,
    breakShot: playing && st.breakShot,
    calledPocket: st ? st.calledPocket : null,
    onEight: playing ? onEight(st, st.turn) : false,
    shotClock: playing && room.shotEndsAt > 0 ? { endsAt: room.shotEndsAt } : null,
    replayUntil: room.replayUntil,
    lastShot: room.lastShot,
    message: room.message,
    result: room.result,
    gameNo: room.gameNo,
    wins: [room.players[0]?.wins ?? 0, room.players[1]?.wins ?? 0],
  };
}

/** The view without its clock, for "did anything change" comparisons. */
export function viewFingerprint(view: PoolView): string {
  const { serverNow, ...rest } = view;
  void serverNow;
  return JSON.stringify(rest);
}

/** What the company's lobby list shows of a room. */
export interface PoolRoomSummary {
  code: string;
  host: { userId: string; name: string } | null;
  players: Array<{ userId: string; name: string; photoUrl: string | null }>;
  status: PoolRoom['status'];
  /** A seat is free. */
  seatFree: boolean;
  createdAt: number;
}

export function summaryOf(room: PoolRoom): PoolRoomSummary {
  const host = playerOf(room, room.hostId);
  return {
    code: room.code,
    host: host ? { userId: host.userId, name: host.name } : null,
    players: room.players.map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl })),
    status: room.status,
    seatFree: room.players.length < POOL.maxPlayers,
    createdAt: room.createdAt,
  };
}

// ---------------------------------------------------------------- the state machine

/** What a change asks the socket layer to do besides sending everyone their view. */
export type Effect =
  /** A feed line to the whole room. */
  | { type: 'feed'; item: PoolFeedItem }
  | { type: 'invite'; userId: string; from: { userId: string; name: string; photoUrl: string | null }; code: string }
  /** Push a notification to the invitee. */
  | { type: 'notify'; userId: string; code: string; fromName: string }
  /** The game ended: record these final lines (carried here, since the room may be a lobby again by the time they are read). */
  | { type: 'finished'; gameId: string; lines: PoolFinalLine[] }
  /** The room is gone; whoever was in it is told so. */
  | { type: 'delete'; players: string[] };

export class PoolMoveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function newRoom(code: string, org: string, host: Pick<PoolPlayer, 'userId' | 'name' | 'photoUrl'>, open: boolean, now: number): PoolRoom {
  return {
    code,
    org,
    gameKey: 'pool',
    hostId: host.userId,
    status: 'lobby',
    open,
    createdAt: now,
    updatedAt: now,
    players: [{ ...host, joinedAt: now, online: true, offlineAt: null, wins: 0 }],
    invited: [],
    invitesSent: 0,
    gameId: null,
    gameNo: 0,
    breaker: 0,
    state: null,
    shotEndsAt: 0,
    replayUntil: 0,
    shotSeq: 0,
    lastShot: null,
    message: null,
    result: null,
    final: null,
    finishedAt: null,
    version: 0,
  };
}

const nameAt = (room: PoolRoom, i: number) => room.players[i]?.name ?? 'Someone';

/** Starts a game: a fresh rack, the breaker with the cue ball in hand behind the head string, the clock running. */
export function startGame(room: PoolRoom, now: number, gameId: string): Effect[] {
  if (room.players.length < POOL.minPlayers) throw new PoolMoveError(409, 'Need two players to start.');
  room.gameId = gameId;
  room.gameNo += 1;
  room.state = {
    balls: rack(),
    turn: room.breaker,
    groups: [null, null],
    open: true,
    inHand: true,
    kitchen: true,
    breakShot: true,
    calledPocket: null,
  };
  room.shotSeq = 0;
  room.lastShot = null;
  room.result = null;
  room.final = null;
  room.finishedAt = null;
  room.replayUntil = 0;
  room.shotEndsAt = now + POOL.shotSecs * 1000;
  room.message = `${firstName(nameAt(room, room.breaker))} breaks`;
  room.invited = [];
  room.invitesSent = 0;
  room.status = 'playing';
  return [];
}

/**
 * The game is over. The final lines are fixed now (the leaderboard and the
 * points read them, whoever is still in the room by then), the winner's tally
 * goes up, and the loser breaks the next game.
 */
export function finish(room: PoolRoom, winner: 0 | 1, reason: PoolResultReason, now: number): Effect[] {
  const st = room.state;
  room.final = room.players.map((p, i) => {
    const potted = st ? pottedOf(st.balls, st.groups[i as 0 | 1] ?? null) : 0;
    const won = i === winner;
    return { userId: p.userId, name: p.name, potted, won, score: potted * POOL.ballScore + (won ? POOL.winScore : 0) };
  });
  if (room.players[winner]) room.players[winner].wins += 1;
  room.result = { winner, reason };
  room.breaker = (1 - winner) as 0 | 1;
  room.status = 'over';
  room.shotEndsAt = 0;
  room.finishedAt = now;
  return [{ type: 'finished', gameId: room.gameId ?? '', lines: room.final }];
}

const notPlaying = () => new PoolMoveError(409, 'The game is not on.');
const notYourTurn = () => new PoolMoveError(409, "It isn't your turn.");

/**
 * The shooter's state, or a refusal: the game is on and it is their turn. The
 * last shot still rolling on the pages stops only the next shot (`applyShot`):
 * a pocket is called and ball in hand dragged while the balls settle.
 */
function shooter(room: PoolRoom, userId: string): { st: RuleState; i: 0 | 1 } {
  if (room.status !== 'playing' || !room.state) throw notPlaying();
  const i = indexOf(room, userId);
  if (i < 0) throw new PoolMoveError(404, 'You are not in this room.');
  if (room.state.turn !== i) throw notYourTurn();
  return { st: room.state, i: i as 0 | 1 };
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Ball in hand: puts the cue ball where the shooter asks, if the table allows it. They may move it again until they shoot. */
export function applyPlace(room: PoolRoom, userId: string, raw: { x?: unknown; y?: unknown }): void {
  const { st } = shooter(room, userId);
  if (!st.inHand) throw new PoolMoveError(409, 'You do not have ball in hand.');
  const x = finite(raw.x), y = finite(raw.y);
  if (x === null || y === null) throw new PoolMoveError(400, 'Where should the cue ball go?');
  if (!placementOk(st.balls, x, y, st.kitchen)) {
    throw new PoolMoveError(400, st.kitchen ? 'Place the cue ball behind the head string, clear of other balls.' : 'Place the cue ball on the table, clear of other balls.');
  }
  const cue = st.balls.find((b) => b.n === 0);
  if (!cue) throw notPlaying();
  cue.x = x; cue.y = y; cue.vx = 0; cue.vy = 0; cue.on = true;
}

/** Calls the pocket for the 8: only when the shooter is on it. */
export function applyCall(room: PoolRoom, userId: string, rawPocket: unknown): void {
  const { st, i } = shooter(room, userId);
  if (!onEight(st, i)) throw new PoolMoveError(409, 'You can call a pocket only when you are on the 8.');
  const pocket = finite(rawPocket);
  if (pocket === null || !Number.isInteger(pocket) || pocket < 0 || pocket > 5) throw new PoolMoveError(400, 'Choose one of the six pockets.');
  st.calledPocket = pocket;
}

/** Reads a shot the page sent, or refuses it. Power and spin are clamped as the engine clamps them. */
export function parseShot(raw: { aim?: unknown; power?: unknown; spin?: unknown }): Shot {
  const aim = finite(raw.aim);
  const power = finite(raw.power);
  if (aim === null || power === null) throw new PoolMoveError(400, 'A shot needs an aim and a power.');
  const spin = raw.spin && typeof raw.spin === 'object' ? (raw.spin as Record<string, unknown>) : {};
  const clamp = (v: number | null, lo: number, hi: number) => Math.min(hi, Math.max(lo, v ?? 0));
  return { aim, power: clamp(power, 0, 1), spin: { top: clamp(finite(spin.top), -1, 1), side: clamp(finite(spin.side), -1, 1) } };
}

/**
 * A shot on the shooter's turn: simulated and ruled by the shared engine, kept
 * as `lastShot` for the pages to replay, the clock restarted after the replay
 * (or the game finished when the 8 decided it).
 */
export function applyShot(room: PoolRoom, userId: string, shot: Shot, now: number): Effect[] {
  const { st, i } = shooter(room, userId);
  if (now < room.replayUntil) throw new PoolMoveError(409, 'The balls are still rolling.');
  const cue = st.balls.find((b) => b.n === 0);
  if (!cue || !cue.on) throw notPlaying();
  const from = { x: cue.x, y: cue.y };
  const sim = simulateShot(st.balls, shot);
  const out = resolve(st, sim.balls, sim.events);
  room.shotSeq += 1;
  room.lastShot = { seq: room.shotSeq, by: i, aim: shot.aim, power: shot.power, spin: shot.spin, from, events: sim.events, balls: atRest(out.next.balls), steps: sim.steps, at: now };
  room.state = out.next;
  room.message = out.message;
  room.replayUntil = now + Math.min(POOL.replayMaxMs, Math.ceil(sim.steps * DT * 1000) + POOL.replayPadMs);
  const effects: Effect[] = [];
  if (out.foul) effects.push({ type: 'feed', item: { kind: 'foul', userId, name: nameAt(room, i), text: out.foul } });
  if (out.winner !== null) {
    effects.push(...finish(room, out.winner, out.foul ? 'foul' : 'eight', now));
    return effects;
  }
  room.shotEndsAt = room.replayUntil + POOL.shotSecs * 1000;
  return effects;
}

/** The shooter's clock ran out: a foul, ball in hand to the other (behind the head string if the break is still to come). */
function timeOut(room: PoolRoom, now: number): Effect[] {
  const st = room.state;
  if (!st) return [];
  const i = st.turn, opp = (1 - i) as 0 | 1;
  st.turn = opp;
  st.inHand = true;
  st.kitchen = st.breakShot;
  st.calledPocket = null;
  room.replayUntil = 0;
  room.shotEndsAt = now + POOL.shotSecs * 1000;
  room.message = `${firstName(nameAt(room, i))} ran out of time: ball in hand to ${firstName(nameAt(room, opp))}`;
  return [{ type: 'feed', item: { kind: 'timeout', userId: room.players[i]?.userId, name: nameAt(room, i) } }];
}

/** Back to the lobby (a rematch with a seat empty, or a player gone from a finished room). */
export function resetToLobby(room: PoolRoom): Effect[] {
  room.status = 'lobby';
  room.gameId = null;
  room.state = null;
  room.shotEndsAt = 0;
  room.replayUntil = 0;
  room.shotSeq = 0;
  room.lastShot = null;
  room.message = null;
  room.result = null;
  room.final = null;
  room.finishedAt = null;
  return [];
}

/** The longest-present online player, else the longest-present at all. */
export function nextHost(room: PoolRoom, except?: string): PoolPlayer | undefined {
  return [...room.players]
    .filter((p) => p.userId !== except)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0];
}

/**
 * Takes a player out. Mid-game the other player wins by forfeit (scored and
 * tallied like any win); then, as for a finished room, the room goes back to
 * its lobby for whoever stays, who is seat 0 now (the table, the turn and the
 * result were indexed by the old seats, so none of them survives; the tally
 * does). The host role passes on; an empty room is deleted.
 */
export function removePlayer(room: PoolRoom, userId: string, now: number): Effect[] {
  const i = indexOf(room, userId);
  const player = room.players[i];
  if (!player) return [];
  const effects: Effect[] = [];
  let message: string | null = null;
  if (room.status === 'playing' && room.players.length === 2) {
    const winner = (1 - i) as 0 | 1;
    effects.push(...finish(room, winner, 'left', now));
    message = `${firstName(player.name)} left the table: ${firstName(nameAt(room, winner))} wins`;
  }
  room.players = room.players.filter((p) => p.userId !== userId);
  effects.push({ type: 'feed', item: { kind: 'leave', userId, name: player.name } });
  if (room.players.length === 0) return [...effects, { type: 'delete', players: [userId] }];
  if (room.hostId === userId) {
    const next = nextHost(room);
    if (next) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
    }
  }
  if (room.status !== 'lobby') {
    effects.push(...resetToLobby(room));
    room.message = message;
  }
  room.breaker = 0;
  return effects;
}

/**
 * Moves a room on to wherever the clock says it should be: a shot whose time
 * ran out is a foul, a player away too long forfeits, an absent host hands
 * over, idle and finished rooms go. Null when nothing is due, so a quiet room
 * costs no write and no push.
 */
export function advance(room: PoolRoom, now: number): Effect[] | null {
  if (room.players.length === 0) return [{ type: 'delete', players: [] }];
  if (now - room.createdAt >= POOL.roomMaxMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
  const effects: Effect[] = [];
  let changed = false;

  const online = room.players.filter((p) => p.online);
  const host = playerOf(room, room.hostId);
  if (host && !host.online && host.offlineAt !== null && now - host.offlineAt >= POOL.hostGoneMs && online.length > 0) {
    const next = nextHost(room, host.userId);
    if (next?.online) {
      room.hostId = next.userId;
      effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
      changed = true;
    }
  }

  switch (room.status) {
    case 'lobby': {
      if (online.length === 0) {
        const lastSeen = Math.max(room.updatedAt, ...room.players.map((p) => p.offlineAt ?? 0));
        if (now - lastSeen >= POOL.lobbyIdleMs) return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
      }
      break;
    }
    case 'playing': {
      // A player away too long forfeits, but only to an opponent who is here:
      // with both gone the game is abandoned, nobody wins and nothing is paid.
      const away = room.players.map((p) => !p.online && p.offlineAt !== null && now - p.offlineAt >= POOL.playerGoneMs);
      if (room.players.length === 2 && away.every(Boolean)) {
        effects.push(...resetToLobby(room));
        room.message = 'Both players were away: the game was abandoned';
        changed = true;
        break;
      }
      const gone = away.indexOf(true);
      if (gone >= 0 && room.players.length === 2 && room.players[1 - gone].online) {
        const winner = (1 - gone) as 0 | 1;
        effects.push(...finish(room, winner, 'away', now));
        room.message = `${firstName(nameAt(room, gone))} has gone: ${firstName(nameAt(room, winner))} wins`;
        changed = true;
        break;
      }
      if (room.shotEndsAt > 0 && now >= room.shotEndsAt + POOL.graceMs) {
        effects.push(...timeOut(room, now));
        changed = true;
      }
      break;
    }
    case 'over': {
      if (room.finishedAt !== null && now - room.finishedAt >= POOL.overKeepMs) {
        return [{ type: 'delete', players: room.players.map((p) => p.userId) }];
      }
      break;
    }
    default:
      break;
  }
  return changed ? effects : null;
}
