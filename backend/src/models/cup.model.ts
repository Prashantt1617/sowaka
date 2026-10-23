/**
 * The Diwali Cup: a company-wide knockout of Odd One Out, played live in its
 * own page (`game-pages/diwali-cup.html`), with bets on the last eight.
 *
 * Three collections, none shared with anything else:
 *   - `cup_events`: one per tournament, with its switch (`active`), its
 *     times and rules, and once the draw is made, everyone in it by seed
 *     (`entrants`) and the seeded draw (`rounds`).
 *   - `cup_matches`: one per match actually played (a free pass is not one).
 *   - `cup_bets`: one per person per match and book, `_id`
 *     `${matchId}:${book}:${userId}` so a second bet on the same match is
 *     refused by the primary key, with no index of its own. The book is the
 *     match's `voids.length` when the bet was placed: a voided match is bet on
 *     afresh.
 *
 * See `services/cup-rules.ts` for the draw and the rules, and
 * `services/cup.service.ts` for the runner and the API.
 */

/** How the seeds are ordered: the company's Odd One Out leaderboard (default), or a lucky draw. */
export type CupSeeding = 'leaderboard' | 'lucky';

/** Where the event has got to. */
export type CupPhase = 'scheduled' | 'lobby' | 'running' | 'done';

/** A place in the draw: an entrant by seed (`e:12`), or the winner of a node (`n:3:7`, round 3 slot 7). */
export type CupRef = string;

/** One place in a round of the draw: a match between two feeders, or a free pass when there is one. */
export interface CupNode {
  slot: number;
  feeders: CupRef[];
}

export interface CupRound {
  /** 1-based. */
  n: number;
  /** "Round 1", "Quarter-finals", … */
  label: string;
  /** Short form for match labels: "R1", "QF", "SF", "F". */
  short: string;
  /** All matches at once ('parallel'), or one at a time with a betting lobby each ('sequential': the last `topN`). */
  kind: 'parallel' | 'sequential';
  nodes: CupNode[];
  /** Who had a free pass through this round, once it opened. */
  byes?: string[];
  openedAt?: Date;
  closedAt?: Date;
}

export interface CupEventConfig {
  /** The catalog key the page lives under in the Games tab. */
  catalogKey: string;
  /** The game played, for the leaderboard the seeds come from: `game_scores` gameId `catalog:<gameKey>`. */
  gameKey: string;
  /** People never entered: the company's Support account(s). */
  excludeUserIds: string[];
  /** For a test: only these people are entered. Empty: everyone active at the company. */
  includeUserIds: string[];
  seeding: CupSeeding;
  /** From this many players left, matches go one at a time with bets. */
  topN: number;
  /** A match's start window: both should join within it; after it the absent player scores 0. */
  startWindowSec: number;
  /** After the window, how long a lone player has to start their round before both count as absent. */
  soloStartSec: number;
  /** Each top-N match's betting lobby. */
  bettingSec: number;
  /** The shared countdown once both have joined. */
  countdownSec: number;
  /** The round's length on the page (Odd One Out: 45 s). */
  roundSec: number;
  /** A final is taken up to this long after the round should have ended. */
  finishGraceSec: number;
  /** A final sooner than this after the start is refused. */
  minPlaySec: number;
  /** The highest score a round can post. */
  maxScore: number;
  /** Ties replayed at most this many times; after that the better seed goes through. */
  maxReplays: number;
  /** Most a single bet may stake (0: up to the person's balance). */
  maxStake: number;
  /** Push everyone their first match when the lobby opens. */
  pushAtLobby: boolean;
}

export interface CupEvent extends CupEventConfig {
  /** Letters, digits, - and _. */
  id: string;
  org: string;
  name: string;
  /** The switch: nothing happens, and the page shows nothing of it, while this is false. */
  active: boolean;
  /** The draw is made and the lobby opens. */
  lobbyAt: Date;
  /** Round 1 opens. */
  startAt: Date;
  /** Feed links (the post's per-viewer URL) are good until then. */
  linkUntil: Date;
  /** The public base of this API, for the feed post's link (e.g. https://d3lwup4rvo6csf.cloudfront.net). */
  linkBase: string;
  phase: CupPhase;
  /** The round being played (0 before round 1 opens). */
  round: number;
  /** Everyone in it, in seed order (seed 1 first), fixed when the draw is made. */
  entrants: CupEntrant[];
  rounds: CupRound[];
  drawnAt?: Date;
  championId?: string;
  finishedAt?: Date;
  /** Switched off mid-tournament at this time (`cup-event.ts off`); switching back on moves every match's clock on by the pause. */
  pausedAt?: Date;
  /** Bumped on every change a page would draw differently. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CupEntrant {
  userId: string;
  name: string;
  /** 1 is the top seed. */
  seed: number;
  /** Their best Odd One Out score when the draw was made; null for none. */
  best: number | null;
  /** Their place on the company's Odd One Out leaderboard then; null for no score. */
  boardRank: number | null;
}

/**
 *   scheduled: a top-N match waiting its turn
 *   betting:   its betting lobby is open
 *   open:      the start window: players join
 *   live:      both joined: the shared countdown, then the round
 *   solo:      only one came: they play alone against 0
 *   done:      decided
 */
export type CupMatchStatus = 'scheduled' | 'betting' | 'open' | 'live' | 'solo' | 'done';

export interface CupScore {
  score: number;
  at: Date;
}

/** How a match was decided. */
export type CupDecision = 'played' | 'solo' | 'absent' | 'replays';

export interface CupMatch {
  id: string;
  eventId: string;
  org: string;
  round: number;
  slot: number;
  /** "R1 · 12", "QF1", "Final". */
  label: string;
  kind: 'parallel' | 'sequential';
  /** The two players: [a, b], a the better seed. */
  players: [string, string];
  status: CupMatchStatus;
  /** The board sequence both play. A replay takes a new one. */
  seed: number;
  /** Replays after a tie (0 for the first game). */
  attempt: number;
  bettingAt?: Date;
  bettingEndsAt?: Date;
  openedAt?: Date;
  /** The start window ends. */
  deadlineAt?: Date;
  joined: Record<string, Date>;
  /** When the round starts, after the shared countdown. */
  startAt?: Date;
  /** For a lone player: by when they must start. */
  soloUntil?: Date;
  live: Record<string, CupScore>;
  finals: Record<string, CupScore>;
  /** Earlier games of this match that were tied. */
  history?: { attempt: number; scores: Record<string, number> }[];
  winnerId?: string;
  decidedBy?: CupDecision;
  decidedAt?: Date;
  /** Final scores as the result stands (an absent player's 0 included). */
  result?: Record<string, number>;
  /** HR voided it (the match was replayed). */
  voids?: { by: string; at: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export type CupBetStatus = 'held' | 'won' | 'lost' | 'refunded';

export interface CupBet {
  /** `${matchId}:${book}:${userId}`: one bet per person per match and book. */
  _id: string;
  /** The match's `voids.length` when placed. */
  book: number;
  eventId: string;
  org: string;
  matchId: string;
  userId: string;
  name: string;
  /** The player backed. */
  pick: string;
  stake: number;
  status: CupBetStatus;
  /** What came back: 2 × stake on a win, the stake on a refund, 0 on a loss. */
  payout: number;
  placedAt: Date;
  settledAt?: Date;
}
