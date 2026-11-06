import type { Ball, RuleState, ShotEvent } from '../shared/pool/engine';

/**
 * Sowaka Pool: 8-ball for two colleagues in a room. The server is the referee
 * (`shared/pool/engine.ts` simulates and rules every shot); the page animates
 * the same shot with the same engine and snaps to the server's positions.
 *
 * A room lives in the fast store (Redis, or this process's memory) for at most
 * a few hours and never touches Mongo, like Tile Up's; see
 * `services/pool-store.ts`. The wire contract is `docs/pool-rooms.md`.
 */

export type PoolStatus = 'lobby' | 'playing' | 'over';

export interface PoolPlayer {
  userId: string;
  name: string;
  photoUrl: string | null;
  /** Epoch ms; the host role passes to the longest-present player. */
  joinedAt: number;
  online: boolean;
  /** Epoch ms of the last disconnect while offline, else null. */
  offlineAt: number | null;
  /** Games won in this room. */
  wins: number;
}

export interface PoolInvitee {
  userId: string;
  name: string;
  photoUrl: string | null;
}

/** A ball as the page is sent it: no velocity, since every shot is sent at rest. */
export interface PoolBallAtRest {
  n: number;
  x: number;
  y: number;
  on: boolean;
}

/**
 * The last shot, for the page to replay: the cue ball's start, the shot, the
 * events the engine produced and where everything came to rest.
 */
export interface PoolLastShot {
  /** Counts up from 1 in a game; the page replays each one once. */
  seq: number;
  by: 0 | 1;
  aim: number;
  power: number;
  spin: { top: number; side: number };
  /** Where the cue ball was struck from. */
  from: { x: number; y: number };
  events: ShotEvent[];
  /** The table after the shot (and after any re-spot). */
  balls: PoolBallAtRest[];
  /** Fixed steps the engine ran (240 a second): how long the replay takes. */
  steps: number;
  /** Epoch ms, the server's clock, when the shot was taken. */
  at: number;
}

export type PoolResultReason = 'eight' | 'foul' | 'left' | 'away';

export interface PoolResult {
  winner: 0 | 1;
  /** `eight`: the 8 potted in its called pocket; `foul`: the 8 lost (early, wrong pocket, with a scratch); `left`: the other player left; `away`: the other player was offline too long. */
  reason: PoolResultReason;
}

/** One player's final line, fixed the moment a game ends (the leaderboard and the points read it). */
export interface PoolFinalLine {
  userId: string;
  name: string;
  potted: number;
  won: boolean;
  /** potted × 100, plus 1,000 for the win. */
  score: number;
}

export interface PoolRoom {
  code: string;
  org: string;
  gameKey: 'pool';
  hostId: string;
  status: PoolStatus;
  /** Listed to the company and open to quick join. */
  open: boolean;
  createdAt: number;
  updatedAt: number;
  /** At most two; index 0 broke the first game. */
  players: PoolPlayer[];
  invited: PoolInvitee[];
  /** Invites sent in this game, against the per-game cap. */
  invitesSent: number;
  gameId: string | null;
  /** Games started in this room; 0 in the first lobby. */
  gameNo: number;
  /** Who breaks the next game: 0 for the first, then the loser. */
  breaker: 0 | 1;
  /** The table and the rules' state while a game is on (or just over); null in the lobby. */
  state: RuleState | null;
  /** Epoch ms when the shooter's time is up; 0 when no clock runs. */
  shotEndsAt: number;
  /** Epoch ms until which the last shot is still rolling on the pages; a shot before then is refused. */
  replayUntil: number;
  shotSeq: number;
  lastShot: PoolLastShot | null;
  /** The referee's last word: a foul, a group assignment, a timeout. */
  message: string | null;
  result: PoolResult | null;
  final: PoolFinalLine[] | null;
  finishedAt: number | null;
  version: number;
}

/** What one player is sent: their own view of the room (`docs/pool-rooms.md`, "Room view"). */
export interface PoolView {
  code: string;
  status: PoolStatus;
  you: string;
  hostId: string;
  open: boolean;
  serverNow: number;
  players: Array<{ userId: string; name: string; photoUrl: string | null; online: boolean; group: 'solid' | 'stripe' | null; pottedCount: number }>;
  invited: PoolInvitee[];
  turn: 0 | 1;
  balls: PoolBallAtRest[];
  inHand: boolean;
  kitchen: boolean;
  /** The table is open: the first legal pot decides the groups. */
  open8: boolean;
  breakShot: boolean;
  calledPocket: number | null;
  /** The shooter is on the 8 and must call a pocket. */
  onEight: boolean;
  shotClock: { endsAt: number } | null;
  /** Until when the last shot replays; the next shot is taken after it. */
  replayUntil: number;
  lastShot: PoolLastShot | null;
  message: string | null;
  result: PoolResult | null;
  gameNo: number;
  wins: [number, number];
}

export type PoolFeedKind = 'join' | 'leave' | 'host' | 'foul' | 'timeout' | 'sys';

export interface PoolFeedItem {
  kind: PoolFeedKind;
  userId?: string;
  name?: string;
  text?: string;
  invited?: boolean;
}

export type { Ball, RuleState, ShotEvent };
