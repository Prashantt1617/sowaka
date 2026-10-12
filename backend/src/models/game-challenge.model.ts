/**
 * One colleague challenging another to a round of a catalog game.
 *
 * Both play the same board sequence: the server picks `seed` once and each
 * page builds its puzzles from it. A challenge has a result only once both
 * have played; one that runs out first expires with no winner and no points.
 * Once accepted, the two can meet in its lobby and start at the same moment,
 * or each play when they like.
 *
 * A finished challenge pays engagement points (`User.points`, with a row in
 * the points ledger under source `game_challenge`), scaled down from the
 * scores and capped per match, per day and per pair, by the game's
 * `challengeRewards` (see `services/game-challenge-rules.ts`). Each final
 * score also goes on the game's own leaderboard the way any round does,
 * through its score endpoint.
 *
 * Lives in `game_challenges`.
 */
export type GameChallengeStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'finished';

/** A player's final score, posted once when their round ends. */
export interface GameChallengeScore {
  score: number;
  finishedAt: Date;
}

/** The last score a player reported mid-round, for the other's live view. */
export interface GameChallengeLive {
  score: number;
  at: Date;
}

/**
 * What one player earned from a finished challenge, in engagement points. A
 * capped award stays here at zero with the reason, so the result card can
 * say why nothing was earned.
 */
export interface GameChallengeAward {
  userId: string;
  kind: 'win' | 'participation';
  points: number;
  /** A win's base before scaling: both scores, or the winner's alone (`onlyOwnScore`). */
  base?: number;
  /** The loser scored under `minLoserShare` of the winner, so their score was not added. */
  onlyOwnScore?: boolean;
  /** Why it came to nothing: the day's cap, or a win over the same person already paid today. */
  capped: 'daily_limit' | 'same_pair' | null;
  /** When these points went into `User.points`. Each award is claimed on its own, so a retry pays only what is unpaid. */
  paidAt?: Date;
}

export interface GameChallenge {
  id: string;
  /** Both players' company; a challenge never crosses companies. */
  org: string;
  /** The catalog game, e.g. 'odd-one-out'. */
  gameKey: string;
  /** Seeds both players' puzzle sequence, so both see the same boards. */
  seed: number;
  challengerUserId: string;
  /** Names as they were when the challenge was made, for lists and pushes. */
  challengerName: string;
  opponentUserId: string;
  opponentName: string;
  status: GameChallengeStatus;
  /** By userId. */
  scores: Record<string, GameChallengeScore>;
  /** By userId. */
  live: Record<string, GameChallengeLive>;
  /** When each player's round began, by userId: their first live score. A final sooner than a round takes is refused. */
  started?: Record<string, Date>;
  /**
   * The lobby, where two players meet to start their rounds at the same
   * moment. `seen`: each player's last heartbeat there, by userId; someone
   * counts as in the lobby while it is under `LOBBY_PRESENCE_MS` old.
   */
  seen?: Record<string, Date>;
  /** When each player said they were ready, by userId. Gone when they say not ready, or come back after being away. */
  ready?: Record<string, Date>;
  /** Players whose first time in the lobby the other has been told about, by userId: that push goes once. */
  lobbyPushed?: Record<string, Date>;
  /** When both rounds start: set once, the moment both are in the lobby and ready. */
  startAt?: Date;
  /**
   * The challenger took it back before an answer. Its status reads 'declined',
   * which apps from before withdrawing already understand.
   */
  withdrawnBy?: string;
  /** Either player called it off once accepted, before either had played. Status 'declined' likewise. */
  cancelledBy?: string;
  /** Players who cleared it from their own lists. Nobody else's list changes. */
  hiddenBy?: string[];
  createdAt: Date;
  updatedAt: Date;
  /** `expiryHours` to answer; once accepted, `expiryHours` from then to play. */
  expiresAt: Date;
  acceptedAt?: Date;
  /** When it was declined, withdrawn, called off, expired, or both scores were in. */
  closedAt?: Date;
  /** The winner's award; null on a draw. Set when it finishes. */
  reward?: GameChallengeAward | null;
  /** Every award it made when it finished, capped ones included. */
  awards?: GameChallengeAward[];
  /** When every award was paid and the history written. Set once: a challenge pays out once. */
  awardedAt?: Date;
}

/**
 * What a game's challenges pay, per game on `game_catalog.challengeRewards`.
 * Any field left out takes its default (`DEFAULT_CHALLENGE_REWARDS`).
 */
export interface ChallengeRewardRules {
  /** Score points per engagement point: a win's base is divided by this. */
  perPoints: number;
  /** Most engagement points one win can pay. */
  maxPerMatch: number;
  /** Rewarded wins per person per day (IST); the same number caps participation awards. */
  dailyWinCap: number;
  /** Rewarded wins per winner over the same opponent per day. */
  samePairPerDay: number;
  /** A loser under this share of the winner's score adds nothing to the winner's base. */
  minLoserShare: number;
  /** What the loser earns for finishing, and each player on a draw. */
  participation: number;
  /** Hours to answer, and once accepted, to play. */
  expiryHours: number;
  /** The shortest a real round can take, in seconds: a final posted sooner after the round began is refused. */
  minPlaySeconds: number;
}

/** Statuses that still need someone to do something. */
export const OPEN_CHALLENGE_STATUSES: GameChallengeStatus[] = ['pending', 'accepted'];
