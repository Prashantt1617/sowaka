/**
 * Speed Poker: the event (a game day the host sets up and runs), the queue
 * people sit in, the tables, and the picks spectators make on the semifinals
 * and the final. Chips and points are for the day's boards only: nothing is
 * bought, moved between people, or worth money.
 */

/** `casual`: a room's game (Speed Poker as a group game, no event); `shootout`: a Shootout's table (any of its rounds); the others belong to an event. */
export type PokerRound = 'practice' | 'open' | 'semi' | 'final' | 'casual' | 'shootout';

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
  /** The most it seats, drop-ins included: six unless the table says (a big room's eight). */
  seats?: number;
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
  /** The hand the player busted on, and their stack going into it: what a Shootout ranks busted players by. */
  bustHand?: number;
  bustStack?: number;
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

/** `lobby` and `shootout`: a Speed Poker Shootout's lobby, then its rounds (`PokerEvent.shootout`). */
export type PokerPhase = 'draft' | 'upcoming' | 'practice' | 'between' | 'open' | 'semis-soon' | 'semis' | 'final-soon' | 'final' | 'over' | 'lobby' | 'shootout';

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
  /**
   * A Speed Poker Shootout instead of a game day: the lobby opens at
   * `lobbyFrom` and closes at `startAt`, when everyone in it is seated at
   * random and the rounds run on their own (services/poker-shootout-rules.ts).
   * `breakMs`: the countdown before each round's tables deal.
   */
  shootout?: { lobbyFrom: string; startAt: string; breakMs?: number };
}

/** One table of a Shootout round. */
export interface ShootoutTableRec {
  label: string;
  tableId: string | null;
  players: string[];
  /** Each player's starting stack: 1,500 for last round's table winners, else 1,000. */
  stacks: Record<string, number>;
  /** A random number each, drawn at seating, for exact ties. */
  draw: Record<string, number>;
  /** Once the table is over: everyone in order, who went through, its winner. */
  result?: { order: string[]; through: string[]; winner: string } | null;
  /** The table as it ended, for the qualifier ranking and the standings. */
  final?: { busts: { id: string; hand: number; stackBefore: number }[]; survivors: Record<string, number> } | null;
}

export interface ShootoutRoundRec {
  kind: 'qualifier' | 'knockout' | 'final';
  name: string;
  /** A qualifier: how many go through in all; a knockout: per table; the final: 1. */
  advance: number;
  players: string[];
  /** Seats are drawn at `seatedAt`; the tables deal at `startsAt`. */
  seatedAt: number;
  startsAt: number;
  startedAt: number | null;
  endedAt: number | null;
  tables: ShootoutTableRec[];
  /** Once the round is over: who goes on, and the qualifier's whole ranking. */
  next: string[] | null;
  winners: string[];
  ranking?: string[] | null;
}

export interface ShootoutState {
  status: 'live' | 'done' | 'cancelled';
  /** Everyone who was in the lobby when it closed, with their names and offices. */
  joined: { userId: string; name: string; office: string | null }[];
  plan: { kind: 'qualifier' | 'knockout' | 'final'; name: string; players: number; tables: number[]; advance: number }[];
  rounds: ShootoutRoundRec[];
  /** Everyone, champion first, once the final is over. */
  standings: string[] | null;
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
  /** A Shootout's draw and rounds, from the moment its lobby closes. */
  shootout?: ShootoutState | null;
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
  /** House players the host has added to fill seats (up to one fewer than the seats). */
  house: number;
  /** Seats at the table and each game's chips: 8 and 1,000 where the company has Speed Poker's big tables, else 6 and 1,500 (rooms made before had neither). */
  seats?: number;
  buyIn?: number;
  /** Practice against the house: one person and house players. Leaving it (or reopening the game) ends it. */
  practice?: boolean;
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
  /** The table's chat, newest last: what players and watchers said (the last few dozen lines). */
  chat?: PokerChatLine[];
  /** Colleagues watching the game without a seat; they can chat, and sit down when a seat frees. */
  watchers?: PokerRoomWatcher[];
  version: number;
}

export interface PokerChatLine {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  /** Said by someone watching, not playing. */
  watching?: true;
}

export interface PokerRoomWatcher {
  userId: string;
  name: string;
  photoUrl: string | null;
  /** When they started watching (or came back): watchers gone this long are dropped. */
  at: number;
}
