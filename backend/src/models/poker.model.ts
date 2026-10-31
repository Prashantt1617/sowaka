/**
 * Speed Poker: the event (a game day the host sets up and runs), the queue
 * people sit in, the tables, and the picks spectators make on the semifinals
 * and the final. Chips and points are for the day's boards only: nothing is
 * bought, moved between people, or worth money.
 */

/** `casual`: a room's game (Speed Poker as a group game, no event); the others belong to an event. */
export type PokerRound = 'practice' | 'open' | 'semi' | 'final' | 'casual';

export interface PokerLevel {
  sb: number;
  bb: number;
}

export interface PokerTableConfig {
  startStack: number;
  levels: PokerLevel[];
  /** How long each blind level lasts. */
  levelMs: number;
  /** How long a player has to act before the table checks or folds for them. */
  actionMs: number;
  /** How long the table runs; at the end the hand in play finishes and the table closes. */
  durationMs: number;
  /** The pause after a hand, so everyone sees who won before the next deal. */
  handPauseMs: number;
}

export interface PokerSeat {
  userId: string;
  name: string;
  photoUrl: string | null;
  /** The office (location) the player plays for in the league. */
  office: string | null;
  stack: number;
  /** Two timeouts in a row sit a player out until they tap back in; their hands fold. */
  sittingOut: boolean;
  timeouts: number;
  /** Who this player knocked out at this table. */
  knockouts: string[];
  bustedAt: number | null;
  bustedBy: string | null;
  /** A room's game only: the player left the room mid-game; their seat is dealt no more hands. */
  left?: boolean;
}

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'done';

export type PokerActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PokerLogEntry {
  seat: number;
  kind: PokerActionKind | 'sb' | 'bb' | 'timeout';
  /** Chips put in by this action, and the street total it reached. */
  amount: number;
  to: number;
  street: Exclude<PokerStreet, 'done'>;
}

export interface PokerPotResult {
  amount: number;
  winners: number[];
  /** The winning hand's name at a showdown ("Two pair"), or null when everyone else folded. */
  hand: string | null;
}

export interface PokerHandResult {
  pots: PokerPotResult[];
  /** The hands turned over at a showdown. */
  shown: { seat: number; cards: number[]; best: number[]; hand: string }[];
  busted: { seat: number; by: number | null }[];
  showdown: boolean;
}

export interface PokerHand {
  no: number;
  button: number;
  sb: number;
  bb: number;
  level: PokerLevel;
  deck: number[];
  hole: (number[] | null)[];
  board: number[];
  street: PokerStreet;
  toAct: number | null;
  deadline: number | null;
  /** The street's highest total bet, and the smallest raise on top of it allowed now. */
  currentBet: number;
  minRaise: number;
  /** Chips in this street, and in the whole hand, per seat. */
  streetIn: number[];
  committed: number[];
  inHand: boolean[];
  folded: boolean[];
  allIn: boolean[];
  /** Acted since the last full raise. */
  acted: boolean[];
  /** May still raise (a short all-in does not reopen raising for those who already acted). */
  canRaise: boolean[];
  log: PokerLogEntry[];
  result: PokerHandResult | null;
  /** When the next hand is dealt, once this one is done. */
  nextAt: number | null;
}

export interface PokerStanding {
  userId: string;
  name: string;
  office: string | null;
  stack: number;
  busted: boolean;
  knockouts: string[];
  /** 1 = most chips (or last standing). */
  place: number;
  /** Left the room before the game ended (placed last). */
  left?: boolean;
}

export interface PokerTable {
  id: string;
  org: string;
  eventId: string;
  round: PokerRound;
  /** For a semifinal: which of the two tables. */
  label: string | null;
  status: 'playing' | 'over';
  seats: PokerSeat[];
  config: PokerTableConfig;
  startedAt: number;
  endsAt: number;
  handNo: number;
  lastButton: number;
  hand: PokerHand | null;
  standings: PokerStanding[] | null;
  overAt: number | null;
  /** The event layer's notes on this table (power hour, bounties, what counts). */
  meta?: PokerTableMeta;
}

/** What the event layer keeps on a table: why it counts and how. */
export interface PokerTableMeta {
  /** Open play only: started in the power hour, so its points count double. */
  power: boolean;
  /** The bounty holders when the table was dealt: knocking one out is worth more. */
  bounties: string[];
  /** Per player: whether this table counts towards their day (the first six do). */
  counted: Record<string, boolean>;
  /** Practice tables: the house players' seats. */
  bots: string[];
}

export type PokerPhase = 'draft' | 'upcoming' | 'practice' | 'between' | 'open' | 'semis-soon' | 'semis' | 'final-soon' | 'final' | 'over';

export interface PokerEventConfig {
  /** Day 1: open play without points (ISO times). Null for no practice day. */
  practice: { from: string; to: string } | null;
  /** The game day: open play with points, the power hour, bounties, then the semifinals and the final. */
  game: {
    openFrom: string;
    openTo: string;
    powerFrom: string | null;
    powerTo: string | null;
    bountiesFrom: string | null;
    semisAt: string;
    finalAt: string;
  };
  /** A table starts the moment this many are queued... */
  tableSize: number;
  /** ...or, after [fallbackMs] of waiting, with at least this many. */
  minPlayers: number;
  fallbackMs: number;
  /** After a table, before queuing again. */
  cooldownMs: number;
  /** Tables per person per day that count, and how many of the best make the score. */
  countedTables: number;
  bestOf: number;
  knockoutPoints: number;
  bountyPoints: number;
  bountyTop: number;
  powerMultiplier: number;
  semifinalists: number;
  advancePerSemi: number;
  picks: {
    on: boolean;
    /** Picks open this long before a stage starts, and close when it starts. */
    leadMs: number;
    semiBudget: number;
    finalBudget: number;
    winnerOdds: number;
    firstOutOdds: number;
    fullTimeOdds: number;
    minStake: number;
  };
  /** Per-round changes to the table formats (minutes, blinds). */
  formats: Partial<Record<PokerRound, Partial<PokerTableConfig>>>;
  /** Never seeded into the semifinals (hosts, testers). */
  exclude: string[];
  /** Post the standings to the feed on the hour during open play. */
  hourlyPosts?: boolean;
}

export interface PokerStage {
  seededAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Semifinals: two tables, A and B. The final: one, F. */
  tables: { label: string; tableId: string | null; players: string[] }[];
}

export interface PokerEvent {
  id: string;
  org: string;
  name: string;
  catalogKey: string;
  /** The host's switch: draft (nothing runs), live (the clock runs it), over. */
  status: 'draft' | 'live' | 'over';
  /** The host's pause: no new tables form; running ones finish. */
  paused: boolean;
  config: PokerEventConfig;
  semis: PokerStage | null;
  final: PokerStage | null;
  champion: { userId: string; name: string } | null;
  /** The feed card, when posted. */
  postId: string | null;
  /** When the last standings post went out. */
  lastStandingsAt?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One player's result at one table: what the day's board is made of. */
export interface PokerResult {
  eventId: string;
  org: string;
  tableId: string;
  round: PokerRound;
  label: string | null;
  userId: string;
  name: string;
  office: string | null;
  chips: number;
  busted: boolean;
  place: number;
  knockouts: string[];
  bountyKnockouts: number;
  power: boolean;
  counted: boolean;
  points: number;
  voided: boolean;
  at: Date;
}

export type PokerPickKind = 'winner' | 'firstOut' | 'fullTime';

/** A spectator's pick on a semifinal or the final, in pick points only. */
export interface PokerPick {
  id: string;
  eventId: string;
  org: string;
  userId: string;
  name: string;
  stage: 'semi' | 'final';
  table: string;
  kind: PokerPickKind;
  /** A player's userId, or 'yes' / 'no' for the final going the distance. */
  choice: string;
  stake: number;
  placedAt: Date;
  /** Null until the table ends; then what it paid (0 when wrong, the stake back when it cannot be settled). */
  payout: number | null;
}

/** One hand's record, kept so a disputed result can be looked into. */
export interface PokerHandRecord {
  eventId: string;
  org: string;
  tableId: string;
  round: PokerRound;
  no: number;
  players: { seat: number; userId: string; name: string; cards: string[] | null }[];
  board: string[];
  log: unknown[];
  result: unknown;
  at: Date;
}

// ------------------------------------------------------------------ rooms

/**
 * Speed Poker as a group game, built like a Scribble or Tile Up room: someone
 * opens a table (open to the company, or private by code and invite), up to
 * six sit at it (colleagues, and house players if the host adds them), the
 * host deals, and a game runs to its time or until one player has every chip.
 * People drop in between hands and leave whenever they like; chips start
 * again at 1,500 every game. No event, no points, no board. A room lives in
 * the fast store only (`poker-store.ts`), for a few hours at most.
 */
export type PokerRoomStatus = 'lobby' | 'playing' | 'over';

export interface PokerRoomPlayer {
  userId: string;
  name: string;
  photoUrl: string | null;
  office: string | null;
  /** The host role passes to the longest-present player. */
  joinedAt: number;
  online: boolean;
  offlineAt: number | null;
}

export interface PokerRoom {
  code: string;
  org: string;
  gameKey: 'speed-poker';
  hostId: string;
  status: PokerRoomStatus;
  /** Listed for everyone at the company (and quick join); else by code and invite only. */
  open: boolean;
  /** Each game's length, set by the host in the lobby: 10, 20 or 30. */
  minutes: number;
  /** House players the host has added to fill seats (0 to 5). */
  house: number;
  createdAt: number;
  updatedAt: number;
  players: PokerRoomPlayer[];
  invited: { userId: string; name: string; photoUrl: string | null }[];
  /** Removed by the host: back by code after a cool-down, or at once on a fresh invite from the host. */
  kicked: { userId: string; at: number }[];
  invitesSent: number;
  /** Games dealt in this room so far. */
  gameNo: number;
  /** The game in play, or the one just finished (its standings), else null. */
  table: PokerTable | null;
  finishedAt: number | null;
  version: number;
}
