import type { PoolBallAtRest, PoolFeedItem, PoolFinalLine, PoolPlayer, PoolResultReason, PoolRoom, PoolSide, PoolSize, PoolView } from '../models/pool.model';
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
 * A table seats two or four. The engine plays two sides; at a table for four
 * each side is a pair of seats (0 and 2 against 1 and 3) whose players take
 * the side's innings in turn, so this file also keeps the shooter and each
 * side's rotation (`docs/pool-rooms.md`, "Seats and innings").
 *
 * Everything here takes a room record and a clock and says what should be
 * true now. The store layer applies it under a compare-and-set, the socket
 * layer sends what comes out, and the check script runs it against a clock
 * it moves by hand.
 */

export const POOL = {
  /** A game needs at least this many final lines to be scored. */
  minPlayers: 2,
  /** The tables there are: for two, or for four as two pairs. */
  sizes: [2, 4] as readonly PoolSize[],
  /** A shot's time, in seconds, counted from the end of the previous shot's replay. */
  shotSecs: 30,
  /** The server fouls a shooter this long after the clock the page shows runs out, so a shot made at 0 still counts. */
  graceMs: 1500,
  /** A replay never holds the next shot longer than this, however long the balls rolled. */
  replayMaxMs: 20_000,
  /** The pages are given this much over the engine's own time to finish drawing a shot. */
  replayPadMs: 300,
  /** A host offline this long hands the role to another player. */
  hostGoneMs: 30_000,
  /** A side with every player offline this long mid-game forfeits it. */
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

/** `2` or `4` (a number or its string), `undefined` for nothing given, null for anything else. */
export function parseSize(raw: unknown): PoolSize | undefined | null {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw) as PoolSize;
  return POOL.sizes.includes(n) ? n : null;
}

export const firstName = (name: string) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';

/** A player still in the game: one who has not left a seat they still hold. */
export const seated = (room: PoolRoom): PoolPlayer[] => room.players.filter((p) => !p.left);

export function playerOf(room: PoolRoom, userId: string): PoolPlayer | undefined {
  return room.players.find((p) => p.userId === userId && !p.left);
}

/** The player's seat (0 to size − 1), or -1 when they are not in the room. */
export const indexOf = (room: PoolRoom, userId: string): number => room.players.findIndex((p) => p.userId === userId && !p.left);

/** A seat's side: seats 0 and 2 are side 0, seats 1 and 3 side 1. */
export const sideOf = (seat: number): PoolSide => (seat % 2) as PoolSide;

/** The seats of a side still in the game, lowest first. */
export const seatsOf = (room: PoolRoom, side: PoolSide): number[] =>
  room.players.map((p, i) => (!p.left && sideOf(i) === side ? i : -1)).filter((i) => i >= 0);

/**
 * The seat of a side that shoots after `after` in its rotation: the next one
 * up (round and round), or the side's lowest seat when `after` is not one of
 * them (-1 for "its first inning"). A side with nobody left gives its own
 * number, which no shot is ever accepted from since the game ends first.
 */
export function nextSeat(room: PoolRoom, side: PoolSide, after: number): number {
  const seats = seatsOf(room, side);
  if (seats.length === 0) return side;
  return seats[(seats.indexOf(after) + 1) % seats.length];
}

/** Whether a pending invite is still worth showing: the room is in its lobby with a seat free, the invite has not run out, and they are not in it. */
export function inviteOpen(
  invite: { expiresAt: number },
  room: { status: string; size: number; players: Array<{ userId: string }> } | null,
  userId: string,
  now: number,
): boolean {
  if (!room || room.status !== 'lobby') return false;
  if (invite.expiresAt <= now) return false;
  if (room.players.some((p) => p.userId === userId)) return false;
  return room.players.length < room.size;
}

// ---------------------------------------------------------------- the view

export const atRest = (balls: Ball[]): PoolBallAtRest[] => balls.map((b) => ({ n: b.n, x: b.x, y: b.y, on: b.on }));

/**
 * The balls a seat is credited with: those of its side's group it sank itself
 * (a ball sunk while the table was still open counts for whichever side ended
 * up with that group). The opponents' balls it knocked in are nobody's.
 */
export function pottedBySeat(room: PoolRoom, seat: number): number {
  const group = room.state?.groups[sideOf(seat)] ?? null;
  if (!group) return 0;
  return Object.entries(room.pottedBy).filter(([n, by]) => by === seat && groupOf(Number(n)) === group).length;
}

/** A side's `pottedCount`: what its seats are credited with, a seat that has since left included (the balls stayed down). */
const sidePotted = (room: PoolRoom, side: PoolSide): number =>
  room.players.reduce((sum, _p, i) => (sideOf(i) === side ? sum + pottedBySeat(room, i) : sum), 0);

/**
 * A side's tally: the most games any of its players has won here (a pair that
 * has played together shows one number). A seat that left mid-game still
 * counts until the room re-seats, so the tally does not drop in play.
 */
const sideWins = (room: PoolRoom, side: PoolSide): number => Math.max(0, ...room.players.filter((_p, i) => sideOf(i) === side).map((p) => p.wins));

/** One player's screen. Everyone sees the same table; `you` tells the page which seat is theirs. */
export function viewFor(room: PoolRoom, userId: string, now: number): PoolView {
  const st = room.state;
  const playing = room.status === 'playing' && !!st;
  return {
    code: room.code,
    status: room.status,
    you: userId,
    hostId: room.hostId,
    open: room.open,
    size: room.size,
    serverNow: now,
    players: room.players.map((p, i) => ({
      userId: p.userId,
      name: p.name,
      photoUrl: p.photoUrl,
      online: p.online,
      left: p.left,
      team: sideOf(i),
      group: st ? st.groups[sideOf(i)] ?? null : null,
      pottedCount: sidePotted(room, sideOf(i)),
    })),
    invited: room.invited,
    turn: st ? st.turn : room.breaker,
    // In the lobby, the seat that will break: the breaking side's lowest.
    shooter: st ? room.shooter : nextSeat(room, room.breaker, -1),
    balls: st ? atRest(st.balls) : [],
    inHand: playing && st.inHand,
    kitchen: playing && st.kitchen,
    open8: st ? st.open : true,
    breakShot: playing && st.breakShot,
    onEight: playing ? onEight(st, st.turn) : false,
    shotClock: playing && room.shotEndsAt > 0 ? { endsAt: room.shotEndsAt } : null,
    replayUntil: room.replayUntil,
    lastShot: room.lastShot,
    message: room.message,
    result: room.result,
    gameNo: room.gameNo,
    wins: [sideWins(room, 0), sideWins(room, 1)],
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
  size: PoolSize;
  /** A seat is free. */
  seatFree: boolean;
  createdAt: number;
}

export function summaryOf(room: PoolRoom): PoolRoomSummary {
  const host = playerOf(room, room.hostId);
  return {
    code: room.code,
    host: host ? { userId: host.userId, name: host.name } : null,
    players: seated(room).map((p) => ({ userId: p.userId, name: p.name, photoUrl: p.photoUrl })),
    status: room.status,
    size: room.size,
    seatFree: room.players.length < room.size,
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

export function newRoom(code: string, org: string, host: Pick<PoolPlayer, 'userId' | 'name' | 'photoUrl'>, open: boolean, size: PoolSize, now: number): PoolRoom {
  return {
    code,
    org,
    gameKey: 'pool',
    hostId: host.userId,
    status: 'lobby',
    open,
    size,
    createdAt: now,
    updatedAt: now,
    players: [{ ...host, joinedAt: now, online: true, offlineAt: null, wins: 0, left: false }],
    invited: [],
    invitesSent: 0,
    gameId: null,
    gameNo: 0,
    breaker: 0,
    shooter: 0,
    rotation: [0, 1],
    pottedBy: {},
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

/** Who is still at the table, by id (a leaver holding a seat mid-game is not told anything more). */
export const seatedIds = (room: PoolRoom): string[] => seated(room).map((p) => p.userId);

const nameAt = (room: PoolRoom, i: number) => room.players[i]?.name ?? 'Someone';

/** "Kritik", or "Kritik and Tanvi": the first names of a side's players still in the game. */
const sideNames = (room: PoolRoom, side: PoolSide): string => {
  const names = seatsOf(room, side).map((i) => firstName(nameAt(room, i)));
  return names.length ? names.join(' and ') : 'Nobody';
};

/** "wins" for one player, "win" for a pair. */
const winVerb = (room: PoolRoom, side: PoolSide): string => (seatsOf(room, side).length > 1 ? 'win' : 'wins');

export const needPlayers = (size: PoolSize): string => `Need ${size === 4 ? 'four' : 'two'} players to start.`;

/** Starts a game: a fresh rack, the breaking side's lower seat with the cue ball in hand behind the head string, the clock running. */
export function startGame(room: PoolRoom, now: number, gameId: string): Effect[] {
  if (room.players.length < room.size) throw new PoolMoveError(409, needPlayers(room.size));
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
  };
  // The breaker is the breaking side's lowest seat; each side's rotation then
  // starts from its first seat (the breaking side's from the one after the breaker).
  const other = (1 - room.breaker) as PoolSide;
  room.shooter = nextSeat(room, room.breaker, -1);
  room.rotation = [0, 1];
  room.rotation[room.breaker] = nextSeat(room, room.breaker, room.shooter);
  room.rotation[other] = nextSeat(room, other, -1);
  room.pottedBy = {};
  room.shotSeq = 0;
  room.lastShot = null;
  room.result = null;
  room.final = null;
  room.finishedAt = null;
  room.replayUntil = 0;
  room.shotEndsAt = now + POOL.shotSecs * 1000;
  room.message = `${firstName(nameAt(room, room.shooter))} breaks`;
  room.invited = [];
  room.invitesSent = 0;
  room.status = 'playing';
  return [];
}

/** The inning passes to `side`: its next seat in the rotation shoots, and the rotation moves on. */
function passInning(room: PoolRoom, side: PoolSide): void {
  room.shooter = room.rotation[side];
  room.rotation[side] = nextSeat(room, side, room.shooter);
}

/**
 * The game is over. The final lines are fixed now (the leaderboard and the
 * points read them, whoever is still in the room by then), the winning side's
 * tally goes up, and the losing side breaks the next game. Someone who left
 * mid-game walked out on it: their line shows what they sank but no win and no
 * score, nothing is recorded or paid for them, and their tally stays. The
 * room stays on its podium whoever has gone, so everyone sees the winning shot.
 */
export function finish(room: PoolRoom, winner: PoolSide, reason: PoolResultReason, now: number): Effect[] {
  room.final = room.players.map((p, i) => {
    const potted = pottedBySeat(room, i);
    const won = !p.left && sideOf(i) === winner;
    return { userId: p.userId, name: p.name, potted, won, score: p.left ? 0 : potted * POOL.ballScore + (won ? POOL.winScore : 0) };
  });
  room.players.forEach((p, i) => {
    if (!p.left && sideOf(i) === winner) p.wins += 1;
  });
  room.result = { winner, reason };
  room.breaker = (1 - winner) as PoolSide;
  room.status = 'over';
  room.shotEndsAt = 0;
  room.finishedAt = now;
  return [{ type: 'finished', gameId: room.gameId ?? '', lines: room.final.filter((_line, i) => !room.players[i].left) }];
}

/** The game is over, with the referee's last word. */
function settle(room: PoolRoom, winner: PoolSide, reason: PoolResultReason, message: string | null, now: number): Effect[] {
  const effects = finish(room, winner, reason, now);
  room.message = message;
  return effects;
}

const notPlaying = () => new PoolMoveError(409, 'The game is not on.');
const notYourTurn = () => new PoolMoveError(409, "It isn't your turn.");

/**
 * The shooter's state, or a refusal: the game is on and this is the seat the
 * server waits for. The last shot still rolling on the pages stops only the
 * next shot (`applyShot`): ball in hand is dragged while the balls settle.
 */
function shooter(room: PoolRoom, userId: string): { st: RuleState; i: number } {
  if (room.status !== 'playing' || !room.state) throw notPlaying();
  const i = indexOf(room, userId);
  if (i < 0) throw new PoolMoveError(404, 'You are not in this room.');
  if (room.shooter !== i) throw notYourTurn();
  return { st: room.state, i };
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
 * A shot from the shooter's seat: simulated and ruled by the shared engine,
 * kept as `lastShot` for the pages to replay, the clock restarted after the
 * replay (or the game finished when the 8 decided it). A shooter who keeps
 * the table shoots again; otherwise the inning passes to the other side's
 * next seat.
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
  for (const n of out.potted) room.pottedBy[String(n)] = i;
  room.replayUntil = now + Math.min(POOL.replayMaxMs, Math.ceil(sim.steps * DT * 1000) + POOL.replayPadMs);
  const effects: Effect[] = [];
  if (out.foul) effects.push({ type: 'feed', item: { kind: 'foul', userId, name: nameAt(room, i), text: out.foul } });
  if (out.winner !== null) {
    effects.push(...settle(room, out.winner, out.foul ? 'foul' : 'eight', out.message, now));
    return effects;
  }
  if (out.next.turn !== st.turn) passInning(room, out.next.turn);
  room.shotEndsAt = room.replayUntil + POOL.shotSecs * 1000;
  return effects;
}

/** The shooter's clock ran out: a foul, ball in hand to the other side's next seat (behind the head string if the break is still to come). */
function timeOut(room: PoolRoom, now: number): Effect[] {
  const st = room.state;
  if (!st) return [];
  const i = room.shooter, opp = (1 - st.turn) as PoolSide;
  st.turn = opp;
  st.inHand = true;
  st.kitchen = st.breakShot;
  passInning(room, opp);
  room.replayUntil = 0;
  room.shotEndsAt = now + POOL.shotSecs * 1000;
  room.message = `${firstName(nameAt(room, i))} ran out of time: ball in hand to ${firstName(nameAt(room, room.shooter))}`;
  return [{ type: 'feed', item: { kind: 'timeout', userId: room.players[i]?.userId, name: nameAt(room, i) } }];
}

/**
 * Back to the lobby (a rematch with a seat empty, a game abandoned, or a
 * player gone from a running or finished room). Anyone who left mid-game
 * gives up the seat they were holding, so those who stay are re-seated in
 * joining order.
 */
export function resetToLobby(room: PoolRoom): Effect[] {
  room.players = room.players.filter((p) => !p.left);
  room.status = 'lobby';
  room.gameId = null;
  room.state = null;
  room.shooter = 0;
  room.rotation = [0, 1];
  room.pottedBy = {};
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

/**
 * A rematch asked for with a seat empty or someone offline: back to the lobby
 * to wait. With a seat gone (someone left mid-game), those who stay are
 * re-seated in joining order and the forfeit's message stays with them.
 */
export function againToLobby(room: PoolRoom): Effect[] {
  const gone = room.players.some((p) => p.left);
  const message = room.message;
  const effects = resetToLobby(room);
  if (gone) {
    room.message = message;
    room.breaker = 0;
  }
  return effects;
}

/** The longest-present online player, else the longest-present at all. */
export function nextHost(room: PoolRoom, except?: string): PoolPlayer | undefined {
  return seated(room)
    .filter((p) => p.userId !== except)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0];
}

/** If this person was the host, the role passes to whoever is next. */
function handOverHost(room: PoolRoom, userId: string, effects: Effect[]): void {
  if (room.hostId !== userId) return;
  const next = nextHost(room);
  if (!next) return;
  room.hostId = next.userId;
  effects.push({ type: 'feed', item: { kind: 'host', userId: next.userId, name: next.name } });
}

/**
 * Takes a player out. Mid-game at a table for four with a partner still in,
 * the leaver only drops out of the rotation: the seat is kept (so nobody
 * else's moves) and the partner plays on alone, taking the shot at once if
 * it was the leaver's. Otherwise the leaver's side is empty and the other
 * side wins by forfeit (scored and tallied like any win); then, as for a
 * finished room, the room goes back to its lobby for whoever stays,
 * re-seated in joining order (the table, the turn and the result were
 * indexed by the old seats, so none of them survives; the tally does). The
 * host role passes on; an empty room is deleted.
 */
export function removePlayer(room: PoolRoom, userId: string, now: number): Effect[] {
  const i = indexOf(room, userId);
  const player = room.players[i];
  if (!player) return [];
  const effects: Effect[] = [];
  let message: string | null = null;
  if (room.status === 'playing' && room.state) {
    const side = sideOf(i), other = (1 - side) as PoolSide;
    const partners = seatsOf(room, side).filter((s) => s !== i);
    if (partners.length > 0) {
      player.left = true;
      player.online = false;
      player.offlineAt = now;
      room.rotation[side] = nextSeat(room, side, i);
      if (room.shooter === i) {
        // The partner inherits the shot as it stands, with a fresh clock.
        passInning(room, side);
        room.shotEndsAt = Math.max(now, room.replayUntil) + POOL.shotSecs * 1000;
      }
      room.message = `${firstName(player.name)} left the table: ${firstName(nameAt(room, partners[0]))} plays on alone`;
      effects.push({ type: 'feed', item: { kind: 'leave', userId, name: player.name } });
      handOverHost(room, userId, effects);
      return effects;
    }
    effects.push(...finish(room, other, 'left', now));
    message = `${firstName(player.name)} left the table: ${sideNames(room, other)} ${winVerb(room, other)}`;
  }
  room.players = room.players.filter((p) => p.userId !== userId);
  effects.push({ type: 'feed', item: { kind: 'leave', userId, name: player.name } });
  if (seated(room).length === 0) return [...effects, { type: 'delete', players: [userId] }];
  handOverHost(room, userId, effects);
  if (room.status !== 'lobby') {
    effects.push(...resetToLobby(room));
    room.message = message;
  }
  room.breaker = 0;
  return effects;
}

/**
 * Moves a room on to wherever the clock says it should be: a shot whose time
 * ran out is a foul, a side away too long forfeits, an absent host hands
 * over, idle and finished rooms go. Null when nothing is due, so a quiet room
 * costs no write and no push.
 */
export function advance(room: PoolRoom, now: number): Effect[] | null {
  if (seated(room).length === 0) return [{ type: 'delete', players: [] }];
  if (now - room.createdAt >= POOL.roomMaxMs) return [{ type: 'delete', players: seatedIds(room) }];
  const effects: Effect[] = [];
  let changed = false;

  const online = seated(room).filter((p) => p.online);
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
        if (now - lastSeen >= POOL.lobbyIdleMs) return [{ type: 'delete', players: seatedIds(room) }];
      }
      break;
    }
    case 'playing': {
      // A side with everyone away too long forfeits, but only to a side with
      // someone here: with both sides gone the game is abandoned, nobody wins
      // and nothing is paid. One offline player of a pair simply times out.
      const away = (p: PoolPlayer) => !p.online && p.offlineAt !== null && now - p.offlineAt >= POOL.playerGoneMs;
      const sideAway = (side: PoolSide) => seatsOf(room, side).every((s) => away(room.players[s]));
      const sideHere = (side: PoolSide) => seatsOf(room, side).some((s) => room.players[s].online);
      if (sideAway(0) && sideAway(1)) {
        effects.push(...resetToLobby(room));
        room.message = room.size === 2 ? 'Both players were away: the game was abandoned' : 'Everyone was away: the game was abandoned';
        changed = true;
        break;
      }
      const gone = ([0, 1] as PoolSide[]).find((side) => sideAway(side) && sideHere((1 - side) as PoolSide));
      if (gone !== undefined) {
        const winner = (1 - gone) as PoolSide;
        const verb = seatsOf(room, gone).length > 1 ? 'have' : 'has';
        effects.push(...settle(room, winner, 'away', `${sideNames(room, gone)} ${verb} gone: ${sideNames(room, winner)} ${winVerb(room, winner)}`, now));
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
        return [{ type: 'delete', players: seatedIds(room) }];
      }
      break;
    }
    default:
      break;
  }
  return changed ? effects : null;
}
