/**
 * Tile Up: Scrabble for colleagues. 2 to 4 players in a room, a 15×15 board,
 * one bag of 100 tiles, seven each, taking turns.
 *
 * A room lives in the fast store (Redis, or this process's memory) for at most
 * a few hours and never touches Mongo, like Scribble's; see
 * `services/tileup-store.ts`. Every field a phone needs is derived from this
 * record and the clock, so a restart or a second backend instance picks up
 * exactly where the last tick left off. The wire contract is the page's own
 * (`game-pages/tile-up.html`, "the bridge").
 */

export type TileUpStatus = 'lobby' | 'playing' | 'over';

export interface TileUpPlayer {
  userId: string;
  name: string;
  photoUrl: string | null;
  score: number;
  /** Epoch ms; the host role passes to the longest-present player. */
  joinedAt: number;
  online: boolean;
  /** Epoch ms of the last disconnect while offline, else null. */
  offlineAt: number | null;
}

export interface TileUpInvitee {
  userId: string;
  name: string;
  photoUrl: string | null;
}

export type TileUpMoveKind = 'play' | 'swap' | 'pass' | 'timeout';

/** The last move, as the page shows it. */
export interface TileUpLastMove {
  userId: string;
  name: string;
  turnNo: number;
  kind: TileUpMoveKind;
  word?: string;
  words?: string[];
  score?: number;
  all7?: boolean;
  /** Board squares the play filled (r*15+c). */
  cells?: number[];
  /** Tiles swapped. */
  count?: number;
}

export interface TileUpBestWord {
  userId: string;
  name: string;
  word: string;
  score: number;
}

/** How the game ended: who went out (and took the others' tiles' value), and what each was left holding. */
export interface TileUpEnding {
  outId: string | null;
  outName: string | null;
  bonus: number;
  left: Record<string, number>;
}

export interface TileUpRoom {
  code: string;
  org: string;
  gameKey: 'tile-up';
  hostId: string;
  status: TileUpStatus;
  createdAt: number;
  updatedAt: number;
  players: TileUpPlayer[];
  invited: TileUpInvitee[];
  /** Removed by the host, and when: back by code after a cool-down, or at once on a fresh invite from the host. */
  kicked: Array<{ userId: string; at: number }>;
  /** Invites sent in this game, against the per-game cap. */
  invitesSent: number;
  /** The time for each turn, in seconds: 30, 60 or 120, set by the host in the lobby. */
  secs: number;
  gameId: string | null;
  /** 225 squares: '' or a letter, lowercase, or uppercase for a blank (which scores 0). */
  board: string[];
  /** The tiles still in the bag, in draw order. Never sent to anyone, only its length. */
  bag: string[];
  /** Each player's tiles ('?' for a blank). Each player is sent only their own. */
  racks: Record<string, string[]>;
  /** Who plays, in turn order, fixed when the game starts (shrinks as people leave). */
  order: string[];
  /** Index into `order` of whose turn it is. */
  turnIdx: number;
  /** 1-based count of turns this game; 0 in the lobby. */
  turnNo: number;
  /** When the turn's clock runs out, epoch ms, including the grace; 0 when no turn runs. */
  endsAt: number;
  /** Moves in a row with no score (pass, swap, timeout); the game ends at twice the number of players. */
  scoreless: number;
  last: TileUpLastMove | null;
  bestWord: TileUpBestWord | null;
  ending: TileUpEnding | null;
  finishedAt: number | null;
  /** The final scores were sent to the game's leaderboard. */
  recorded: boolean;
  version: number;
}

/** What one player is sent: their own view, never the room record itself (nobody's tiles are in anyone else's view). */
export interface TileUpView {
  code: string;
  you: string;
  hostId: string;
  status: TileUpStatus;
  min: number;
  max: number;
  secs: number;
  turnId: string | null;
  turnNo: number;
  endsAt: number;
  serverNow: number;
  gameId: string | null;
  board: string[];
  bag: number;
  rack: string[] | null;
  players: Array<{ userId: string; name: string; photoUrl: string | null; score: number; online: boolean; tiles: number }>;
  invited: TileUpInvitee[];
  /** Removed by the host and still inside the cool-down; the page keeps them out of the invite picker. */
  removed: Array<{ userId: string; until: number | null }>;
  last: TileUpLastMove | null;
  bestWord: TileUpBestWord | null;
  ending: TileUpEnding | null;
  awards: null;
}

export type TileUpFeedKind = 'join' | 'leave' | 'swap' | 'pass' | 'timeout' | 'host' | 'sys';

export interface TileUpFeedItem {
  kind: TileUpFeedKind;
  userId?: string;
  name?: string;
  count?: number;
  invited?: boolean;
  text?: string;
}
