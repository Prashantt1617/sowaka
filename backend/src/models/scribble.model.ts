/**
 * Scribble: colleagues in a room, one drawing a word, the rest guessing.
 *
 * A room lives in the fast store (Redis, or this process's memory) for at most
 * two hours and never touches Mongo; see `services/scribble-store.ts`. Every
 * field a phone needs is derived from this record and the clock, so a restart
 * or a second backend instance picks up exactly where the last tick left off.
 */

export type ScribbleStatus = 'lobby' | 'picking' | 'drawing' | 'reveal' | 'over';

export type ScribbleWordLevel = 'easy' | 'medium' | 'hard';

export interface ScribbleChoice {
  word: string;
  level: ScribbleWordLevel;
}

export interface ScribblePlayer {
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

export interface ScribbleInvitee {
  userId: string;
  name: string;
  photoUrl: string | null;
}

export type ScribbleTurnEnd = 'all' | 'time' | 'drawer_left';

export interface ScribbleLastTurn {
  word: string;
  drawerId: string;
  why: ScribbleTurnEnd;
  gains: Array<{ userId: string; points: number }>;
}

export interface ScribbleRoom {
  code: string;
  org: string;
  gameKey: 'scribble';
  hostId: string;
  status: ScribbleStatus;
  createdAt: number;
  updatedAt: number;
  players: ScribblePlayer[];
  invited: ScribbleInvitee[];
  /**
   * Removed by the host, and when: they may come back by code after a short
   * cool-down, or at once on a fresh invite from the host. A bare user id is a
   * removal written before the cool-down existed: removed with no expiry.
   * Read it only through the engine's `kickedId` / `stillKicked` / `wasKicked`.
   */
  kicked: Array<{ userId: string; at: number } | string>;
  /** Invites sent in this game, against the per-game cap. */
  invitesSent: number;
  /**
   * The host's choices in the lobby: how hard the words are, and how many
   * rounds. Missing on a room written before they existed; read them only
   * through the engine's `levelOf` / `roundsOf`.
   */
  level?: ScribbleWordLevel;
  rounds?: number;
  gameId: string | null;
  /** 1-based while a game runs; 0 in the lobby. */
  round: number;
  /** 0-based index into `order`; -1 in the lobby. */
  turnIdx: number;
  /** Who draws this round, in seat order, as it stood when the round began. */
  order: string[];
  drawerId: string | null;
  choices: ScribbleChoice[] | null;
  word: string | null;
  /** Indexes into `word` shown as hints. */
  revealed: number[];
  turnStartedAt: number;
  /** When the current phase ends, epoch ms; 0 in the lobby. */
  endsAt: number;
  /** Set when every online guesser has the word: the turn ends shortly after. */
  pendingEndAt: number | null;
  /** Points each correct guesser took this turn. */
  guessed: Record<string, number>;
  drawerGain: number;
  usedWords: string[];
  last: ScribbleLastTurn | null;
  finishedAt: number | null;
  /** The final scores were sent to the game's leaderboard. */
  recorded: boolean;
  version: number;
}

/** What one player is sent: their own view, never the room record itself. */
export interface ScribbleView {
  code: string;
  you: string;
  hostId: string;
  status: ScribbleStatus;
  min: number;
  max: number;
  rounds: number;
  /** How hard the drawer's three words are; the host sets it, with `rounds`, in the lobby. */
  level: ScribbleWordLevel;
  round: number;
  turn: number;
  turns: number;
  turnKey: string | null;
  gameId: string | null;
  drawerId: string | null;
  turnSec: number;
  pickSec: number;
  revealSec: number;
  endsAt: number;
  serverNow: number;
  players: Array<{
    userId: string;
    name: string;
    photoUrl: string | null;
    score: number;
    online: boolean;
    guessed: boolean;
  }>;
  invited: ScribbleInvitee[];
  /**
   * Removed by the host and still inside the cool-down: `until` is when it
   * ends on the server's clock, null for never (only the host's invite lets
   * them back). The page keeps them out of a non-host's invite picker.
   */
  removed: Array<{ userId: string; until: number | null }>;
  choices: ScribbleChoice[] | null;
  word: string | null;
  mask: string | null;
  last: ScribbleLastTurn | null;
  awards: Array<{ userId: string; points: number; reason: string | null }> | null;
}

export type ScribbleFeedKind = 'guess' | 'chat' | 'correct' | 'join' | 'leave' | 'host' | 'sys';

export interface ScribbleFeedItem {
  kind: ScribbleFeedKind;
  userId?: string;
  name?: string;
  text?: string;
  /** A chat line sent only to those who know the word (the drawer and whoever has guessed it). */
  private?: boolean;
}

/** A stroke op as the page sends it; see PROTOCOL.md §7. */
export type ScribbleOp =
  | { t: 'b'; id: number; k: number; c: number; w: number; x: number; y: number }
  | { t: 'p'; id: number; pts: number[] }
  | { t: 'f'; id: number; c: number; x: number; y: number }
  | { t: 'u'; id: number }
  | { t: 'r'; id: number }
  | { t: 'c' };
