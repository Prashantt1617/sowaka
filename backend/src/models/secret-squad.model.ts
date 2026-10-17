/**
 * Secret Squad: an office plays a session of rounds (docs/secret-squad.md).
 *
 * A session lives in the store (Redis when it is configured, else this
 * process's memory) from its lobby opening until a while after it ends. Only
 * the schedule, the office lists and the paid rounds are kept in Mongo. Every
 * change goes through one compare-and-set, so several API instances can share
 * a session.
 */

export type SquadStatus = 'lobby' | 'dealing' | 'hunt' | 'break' | 'over' | 'cancelled';

/** One round's settings, chosen per session (from an office plan, or by hand). */
export interface SquadRoundConfig {
  /** The standard squad size the round aims for (2 to 10: a category has at most 10 words). */
  squadSize: number;
  huntMs: number;
  /** The results break after it; ignored after the last round. */
  breakMs: number;
  /**
   * The categories this round's squads take, in this order (an office plan's
   * list). Missing or too short: the rest of the bank fills in
   * (see `chooseCategories` in secret-squad-engine.ts).
   */
  categories?: string[];
}

export interface SquadPlayer {
  userId: string;
  /** Fixed for the session, never reused: what a player's QR is worked out from. */
  seat?: number;
  /** Left between rounds: kept (their squad still names them) but dealt no more. */
  left?: boolean;
  name: string;
  initials: string;
  photoKey?: string;
  department?: string;
  joinedAt: number;
  online: boolean;
  /** When they were last seen going offline; cleared when they come back. */
  offlineAt?: number;
  /** Dealt into the current round. */
  playing: boolean;
  /** Offline long enough in the hunt that their squad stops waiting for them. */
  away: boolean;
  /** Index into the round's `squads`, once dealt. */
  squad?: number;
  word?: string;
}

export interface SquadTeam {
  category: string;
  /** The category's first `members.length` words, in order: member i holds words[i]. */
  words: string[];
  members: string[];
  /** The squad bonus, paid to every member of the complete group: 200 + 100 × (standard size − this size), never below 0. */
  bonus: number;
  /** The time bonus each member got on completing: floor(seconds left × 0.5). Set once complete. */
  timeBonus?: number;
  finishedAt?: number;
  place?: number;
}

/** A link made by a right scan, between two players of the same squad. */
export interface SquadEdge {
  a: string;
  b: string;
  at: number;
}

export type SquadScanResult = 'right' | 'wrong' | 'already';

/** The last scan a player took part in, as their phone shows it once (by id). */
export interface SquadScanEvent {
  id: string;
  result: SquadScanResult;
  /** Who scanned: this player ('scanner'), or the other one ('scanned': "[Name] scanned you"). */
  role: 'scanner' | 'scanned';
  otherId: string;
  /** Points this scan moved for this player: +100, −25 or 0. */
  delta: number;
  /** This player's session total before and after this scan. */
  before: number;
  after: number;
  /** This scan completed the squad (the bonus follows, in `completions`). */
  completed: boolean;
  at: number;
}

/** A player's squad completing, as their phone shows it. */
export interface SquadCompletion {
  at: number;
  /** The squad bonus (+200, more for a short squad). */
  bonus: number;
  /** floor(seconds left on the round clock × 0.5). */
  timeBonus: number;
  /** The seconds left on the round clock when it completed. */
  secondsLeft: number;
  /** Their session total before and after both bonuses. */
  before: number;
  after: number;
}

export type SquadNoticeKind = 'teammate_away' | 'teammate_back' | 'squad_left';

export interface SquadNotice {
  kind: SquadNoticeKind;
  userId: string;
  at: number;
}

/** The round being dealt, hunted, or shown in its break. */
export interface SquadRoundState {
  index: number;
  dealtAt: number;
  huntStartsAt: number;
  endsAt: number;
  /** When it actually ended (time ran out, or no squad left to complete). */
  overAt?: number;
  squads: SquadTeam[];
  edges: SquadEdge[];
  /** The last scan each player took part in. */
  scans: Record<string, SquadScanEvent>;
  /** Each player whose squad completed, with their bonus. */
  completions: Record<string, SquadCompletion>;
  /** The last thing that happened to each player's squad. */
  notices: Record<string, SquadNotice>;
  /** Wrong scans made against each player: the trickiest word is the most. */
  missesAgainst: Record<string, number>;
  /** Each player's net points this round, kept live (can be below 0). */
  points: Record<string, number>;
  /** Too few players: the round was skipped. */
  skipped?: boolean;
}

export interface SquadSession {
  id: string;
  org: string;
  office: string;
  status: SquadStatus;
  lobbyOpensAt: number;
  /** The lobby closes and the first round is dealt. */
  startsAt: number;
  /** When the current phase (lobby, dealing, hunt, break) ends. */
  phaseEndsAt: number;
  rounds: SquadRoundConfig[];
  roundIndex: number;
  round: SquadRoundState | null;
  /** Earlier rounds, kept for the session results and for who has met whom. */
  history: SquadRoundState[];
  players: SquadPlayer[];
  /** The next seat to hand out. */
  nextSeat?: number;
  /** Points each player has across the session, kept live (can be below 0). */
  totals: Record<string, number>;
  /** Seeds the rotating QR codes; never sent to a page. */
  codeSeed: string;
  cancelReason?: string;
  version: number;
  createdAt: number;
}

/** A scheduled session, in Mongo (`secret_squad_sessions`). */
export interface SquadSchedule {
  id: string;
  org: string;
  office: string;
  startsAt: Date;
  lobbyMs: number;
  rounds: SquadRoundConfig[];
  /** The office plan its rounds were copied from, if any. */
  plan?: string;
  status: 'scheduled' | 'opened' | 'cancelled';
  /** The feed card announcing it, once posted. */
  postId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}

/** Who plays in which office, in Mongo (`secret_squad_offices`), one row per person. */
export interface SquadOfficeAssignment {
  org: string;
  userId: string;
  office: string;
  updatedAt: Date;
}

/** A round's points paid to the org leaderboard, in Mongo (`secret_squad_payouts`): at most one row per round. */
export interface SquadPayout {
  _id: string; // `${sessionId}:${roundIndex}`
  org: string;
  sessionId: string;
  roundIndex: number;
  points: Record<string, number>;
  paidAt: Date;
}
