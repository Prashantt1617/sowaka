import type { Ball, RuleState, ShotEvent } from '../shared/pool/engine';

/**
 * Sowaka Pool: 8-ball for two or four colleagues in a room. The server is the
 * referee (`shared/pool/engine.ts` simulates and rules every shot); the page
 * animates the same shot with the same engine and snaps to the server's
 * positions.
 *
 * A table for four is two sides of two seats: seats 0 and 2 against seats 1
 * and 3 (a player's side is their seat modulo 2). The engine only knows the
 * two sides; the room decides which seat of a side shoots each inning.
 *
 * A room lives in the fast store (Redis, or this process's memory) for at most
 * a few hours and never touches Mongo, like Tile Up's; see
 * `services/pool-store.ts`. The wire contract is `docs/pool-rooms.md`.
 */

export type PoolStatus = 'lobby' | 'playing' | 'over';

/** How many seats a table has. */
export type PoolSize = 2 | 4;

/** A side of the table, the engine's `turn`: seats 0 and 2, or seats 1 and 3. */
export type PoolSide = 0 | 1;

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
  /**
   * Left mid-game at a table for four: the seat is kept until the game ends
   * so the others' seats (and sides) stay where they are, but this person is
   * out of the rotation and out of the room. Never true in a lobby.
   */
  left: boolean;
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
  /** The seat that shot. */
  by: number;
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
  /** The side that won. */
  winner: PoolSide;
  /** `eight`: the 8 potted after the group; `foul`: the 8 lost (early, or with a scratch); `left`: the other side left; `away`: the other side was offline too long. */
  reason: PoolResultReason;
}

/** One player's final line, fixed the moment a game ends (the leaderboard and the points read it). */
export interface PoolFinalLine {
  userId: string;
  name: string;
  /** The balls of their side's group this player sank themselves. */
  potted: number;
  /** By side: both teammates win together. */
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
  /** Seats at the table, fixed when the room is made. */
  size: PoolSize;
  createdAt: number;
  updatedAt: number;
  /** In seat order (joining order); a seat's side is its index modulo 2. Seat 0 broke the first game. */
  players: PoolPlayer[];
  invited: PoolInvitee[];
  /** Invites sent in this game, against the per-game cap. */
  invitesSent: number;
  gameId: string | null;
  /** Games started in this room; 0 in the first lobby. */
  gameNo: number;
  /** The side that breaks the next game, with its lower seat: side 0 for the first, then the loser. */
  breaker: PoolSide;
  /** The seat whose shot the server waits for; `shooter % 2` is the engine's `turn`. */
  shooter: number;
  /** Per side, the seat that shoots that side's next inning (seats of a side take innings in turn). */
  rotation: [number, number];
  /** Which seat sank each ball (by ball number) in this game, for the final lines. */
  pottedBy: Record<string, number>;
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
  size: PoolSize;
  serverNow: number;
  players: Array<{
    userId: string;
    name: string;
    photoUrl: string | null;
    online: boolean;
    /** Out of the game but still holding the seat (a table for four, mid-game). */
    left: boolean;
    team: PoolSide;
    group: 'solid' | 'stripe' | null;
    /** The side's: its group's balls off the table. */
    pottedCount: number;
  }>;
  invited: PoolInvitee[];
  /** The side whose inning it is. */
  turn: PoolSide;
  /** The seat that shoots now. */
  shooter: number;
  balls: PoolBallAtRest[];
  inHand: boolean;
  kitchen: boolean;
  /** The table is open: the first legal pot decides the groups. */
  open8: boolean;
  breakShot: boolean;
  /** The shooter's group is cleared: the 8 is next, in any pocket. */
  onEight: boolean;
  shotClock: { endsAt: number } | null;
  /** Until when the last shot replays; the next shot is taken after it. */
  replayUntil: number;
  lastShot: PoolLastShot | null;
  message: string | null;
  result: PoolResult | null;
  gameNo: number;
  /** Games won in this room, per side. */
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
