/**
 * The launch-event relay game: hints land on individual phones, the team talks
 * them through out loud, and only the team's leader submits an answer.
 *
 * Teams and their questions arrive as spreadsheets before the event; nothing is
 * derived from the org chart, because the teams are formed for the game.
 */

export interface RelayConfig {
  rounds: number;
  questionsPerRound: number;
  hintsPerQuestion: number;
  hintIntervalSeconds: number;
  questionSeconds: number;
  breakSeconds: number;
  pointsPerCorrect: number;
  /** Similarity a typed answer must reach, so a near-miss spelling still counts. */
  matchThreshold: number;
  /** Silence a player is allowed before they drop out of the hint rotation. */
  presenceWindowSeconds: number;
  /** Silence the leader is allowed before the role moves to someone present. */
  leadGraceSeconds: number;
}

export const RELAY_DEFAULT_CONFIG: RelayConfig = {
  // Five rounds of four, as the screens show: "ROUND 2 OF 5" over four pips.
  rounds: 5,
  questionsPerRound: 4,
  hintsPerQuestion: 5,
  hintIntervalSeconds: 3,
  // The cap that closes a question. Players are shown the round instead —
  // four of these, counted down as one 120-second clock.
  questionSeconds: 30,
  breakSeconds: 90,
  pointsPerCorrect: 30,
  matchThreshold: 0.7,
  presenceWindowSeconds: 20,
  leadGraceSeconds: 30,
};

export type RelayEventStatus = 'draft' | 'scheduled' | 'live' | 'finished';

export interface RelayEvent {
  id: string;
  org: string;
  name: string;
  status: RelayEventStatus;
  config: RelayConfig;
  lobbyOpensAt?: Date;
  /**
   * When play begins, set when the post is published from the dashboard.
   *
   * The lobby counts down to it and the game starts itself — nobody presses
   * anything at half past one, and there is no operator on the day.
   */
  startsAt?: Date;
  /** The instructions video, uploaded with the post and shown before the lobby. */
  instructionsVideoUrl?: string;
  /**
   * The prize headline on the post, in rupees. Set by HR when publishing —
   * never a figure the app or the server makes up.
   */
  rewardAmount?: number;
  startedAt?: Date;
  /** 1-based once play begins; 0 while the lobby is still filling. */
  currentRound: number;
  roundStartedAt?: Date;
  breakStartedAt?: Date;
  finishedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelayTeamMember {
  userId: string;
  name: string;
  email: string;
  isLeader: boolean;
}

export interface RelayTeam {
  id: string;
  eventId: string;
  org: string;
  /**
   * Position in the import, which decides where this team starts in each
   * round's pool. Teams that sit near each other get widely separated slices,
   * so nobody overhears a neighbour answering the question they are on.
   */
  index: number;
  /** Whatever grouped the rows in the uploaded sheet. */
  teamKey: string;
  /** Generated from the leader, never typed into the sheet. */
  name: string;
  leaderUserId: string;
  members: RelayTeamMember[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * How an item's pieces reach the team.
 *
 * `staggered` fires them one at a time on the hint interval, easiest first —
 * the movie-clue shape. `simultaneous` puts every piece out at once, one per
 * player, which is what the unscramble, number-chain, lyric and odd-one-out
 * rounds are: nobody can see the whole puzzle, so they have to talk.
 */
export type RelayRevealMode = 'staggered' | 'simultaneous';

/**
 * `exact` for answers where one wrong letter is a different answer — an
 * unscrambled word, a total, the odd one out. `fuzzy` for the ones where a
 * transliterated near-miss is the point, like a movie title or a lyric.
 */
export type RelayMatching = 'exact' | 'fuzzy';

export type RelayItemKind = 'movie' | 'lyric' | 'word' | 'number' | 'odd';

export const RELAY_KIND_RULES: Record<
  RelayItemKind,
  { reveal: RelayRevealMode; matching: RelayMatching }
> = {
  movie: { reveal: 'staggered', matching: 'fuzzy' },
  lyric: { reveal: 'simultaneous', matching: 'fuzzy' },
  word: { reveal: 'simultaneous', matching: 'exact' },
  number: { reveal: 'simultaneous', matching: 'exact' },
  odd: { reveal: 'simultaneous', matching: 'exact' },
};

export interface RelayPiece {
  /** What the player's screen calls it: "Clue 2", "Letter 3", "Step 1". */
  label: string;
  text: string;
}

/**
 * One puzzle, belonging to the event rather than to a team.
 *
 * Teams share a pool and enter it at different offsets: 44 teams needing four
 * questions a round is 176 slots against a pool of a few dozen, so unique sets
 * per team were never possible. What matters is that teams within earshot are
 * never on the same item at the same moment, and the offset delivers that.
 */
export interface RelayItem {
  id: string;
  eventId: string;
  org: string;
  round: number;
  kind: RelayItemKind;
  reveal: RelayRevealMode;
  matching: RelayMatching;
  prompt: string;
  /** Checked before similarity, so known spellings never depend on a threshold. */
  acceptedAnswers: string[];
  /** For a staggered item these are ordered easiest to hardest. */
  pieces: RelayPiece[];
  createdAt: Date;
  updatedAt: Date;
}

export type RelayAnswerOutcome = 'correct' | 'skipped' | 'timeout';

export interface RelayAnswerRecord {
  round: number;
  position: number;
  outcome: RelayAnswerOutcome;
  /** What the leader typed, kept for reviewing near-misses after the event. */
  submitted?: string;
  answeredBy?: string;
  secondsTaken: number;
  points: number;
}

export interface RelayTeamProgress {
  eventId: string;
  org: string;
  teamId: string;
  round: number;
  /** 0-based position within the round. */
  questionIndex: number;
  questionStartedAt: Date;
  /**
   * Seconds a skip handed forward.
   *
   * Skipping is how a team buys time: the seconds left on a question they give
   * up on are added to the next one's allowance, so walking away from a
   * hopeless clue is worth something rather than merely ending it sooner.
   */
  carriedSeconds: number;
  answers: RelayAnswerRecord[];
  totalPoints: number;
  /** Rounds whose clean-sweep bonus has been paid, so it is never paid twice. */
  bonusRounds: number[];
  /** Drives the tie-break: least time used wins. */
  totalSecondsUsed: number;
  updatedAt: Date;
}

export interface RelayPresence {
  eventId: string;
  teamId: string;
  userId: string;
  lastSeenAt: Date;
}
