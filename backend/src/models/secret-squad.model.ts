/**
 * Secret Squad: an office plays a session of rounds (docs/secret-squad.md).
 *
 * A session lives in the store (Redis when it is configured, else this
 * process's memory) from its lobby opening until a while after it ends. Only
 * the schedule and the office lists are kept in Mongo. Every change goes
 * through one compare-and-set, so several API instances can share a session.
 */

export type SquadStatus = 'lobby' | 'dealing' | 'hunt' | 'break' | 'over' | 'cancelled';

/** One round's settings, chosen per session. */
export interface SquadRoundConfig {
  /** Members per squad the round aims for (2 to 30). */
  squadSize: number;
  huntMs: number;
  /** The results break after it; ignored after the last round. */
  breakMs: number;
  /** How long a wrong check locks both players. */
  lockMs: number;
  pointsPerMember: number;
  /** Points per second left when a squad finishes. */
  timeBonusPerSecond: number;
}

export interface SquadPlayer {
  userId: string;
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
  /** No checks of their own before this (a wrong check locks both players). */
  lockedUntil: number;
}

export interface SquadTeam {
  theme: string;
  packId: string;
  words: string[];
  members: string[];
  finishedAt?: number;
  place?: number;
}

/** A link made by a successful check, between two players of the same squad. */
export interface SquadEdge {
  a: string;
  b: string;
  at: number;
}

/** One player asking to check another, waiting for them to allow it. */
export interface SquadAsk {
  id: string;
  from: string;
  to: string;
  expiresAt: number;
}

export type SquadResultKind = 'match' | 'miss' | 'already' | 'declined' | 'expired';

export interface SquadResult {
  id: string;
  kind: SquadResultKind;
  otherId: string;
  at: number;
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
  /** When it actually ended (time ran out, or no squad left to finish). */
  overAt?: number;
  squads: SquadTeam[];
  edges: SquadEdge[];
  asks: SquadAsk[];
  /** The last check each player took part in. */
  results: Record<string, SquadResult>;
  /** The last thing that happened to each player's squad. */
  notices: Record<string, SquadNotice>;
  /** Wrong checks made against each player: the trickiest word is the most. */
  missesAgainst: Record<string, number>;
  /** Points each player earned this round, once it ended. */
  points?: Record<string, number>;
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
  /** Earlier rounds, kept for the session results. */
  history: SquadRoundState[];
  players: SquadPlayer[];
  /** Points each player has earned across the session. */
  totals: Record<string, number>;
  /** Seeds the rotating codes; never sent to a page. */
  codeSeed: string;
  /** Packs dealt so far this session, so later rounds prefer others. */
  packIds: string[];
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
