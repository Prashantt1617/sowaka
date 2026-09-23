import {
  RelayAnswerRecord,
  RelayConfig,
  RelayItem,
  RelayPiece,
  RelayTeamMember,
} from '../models/relay.model';

/**
 * The rules of the game, as pure functions of time.
 *
 * Nothing here schedules anything. Which pieces have fired, who holds them,
 * whether a question has expired and whether a round is over are all derived
 * from `startedAt` and the clock, so a dropped message corrupts nothing and a
 * player who reconnects mid-question is told exactly what is true right now.
 */

export interface PresentPlayer extends RelayTeamMember {
  lastSeenAt: Date;
}

export function activeMembers(
  players: PresentPlayer[],
  config: RelayConfig,
  now: number,
): PresentPlayer[] {
  return players.filter(
    (player) => now - player.lastSeenAt.getTime() < config.presenceWindowSeconds * 1000,
  );
}

/**
 * Who types the answer right now.
 *
 * The imported leader keeps the role while they are still around. Once they
 * have been silent past the grace period it moves to someone present, because
 * a team whose leader walked away can otherwise do nothing at all.
 */
export function currentLeader(
  players: PresentPlayer[],
  config: RelayConfig,
  now: number,
): PresentPlayer | null {
  const active = activeMembers(players, config, now);
  if (active.length === 0) return null;
  const appointed = players.find((player) => player.isLeader);
  if (appointed && now - appointed.lastSeenAt.getTime() < config.leadGraceSeconds * 1000) {
    return appointed;
  }
  return active[0];
}

export interface PieceAssignment {
  piece: RelayPiece;
  index: number;
  userId: string;
  firesAtSec: number;
}

/**
 * Which pieces have reached whom, this many seconds into a question.
 *
 * Pieces are dealt only to players present at the moment each one fires, so a
 * clue is never handed to a phone that left — that was the flaw that left a
 * prototype team scoring nothing while hints went nowhere. The leader is
 * excluded: their screen carries the answer box, never the puzzle.
 */
export function assignments(
  item: RelayItem,
  players: PresentPlayer[],
  config: RelayConfig,
  elapsedSec: number,
  now: number,
): PieceAssignment[] {
  const leader = currentLeader(players, config, now);
  const receivers = activeMembers(players, config, now).filter(
    (player) => player.userId !== leader?.userId,
  );
  if (receivers.length === 0) return [];

  return item.pieces
    .map((piece, index) => ({
      piece,
      index,
      firesAtSec: item.reveal === 'staggered' ? index * config.hintIntervalSeconds : 0,
      userId: receivers[index % receivers.length].userId,
    }))
    .filter((assignment) => assignment.firesAtSec <= elapsedSec);
}

/** Only what this player should see — never the whole puzzle. */
export function piecesForPlayer(
  item: RelayItem,
  players: PresentPlayer[],
  config: RelayConfig,
  elapsedSec: number,
  now: number,
  userId: string,
): RelayPiece[] {
  return assignments(item, players, config, elapsedSec, now)
    .filter((assignment) => assignment.userId === userId)
    .map((assignment) => assignment.piece);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

/**
 * Whether a typed answer counts.
 *
 * An unscrambled word, a total or the odd one out is matched exactly: one
 * wrong letter makes SHEET a different answer from SHEEP, and a similarity
 * threshold would wave it through. Titles and lyrics are matched loosely,
 * because writing `dekhuga` for `dekhunga` is the thing the game is for.
 */
export function answerAccepted(given: string, item: RelayItem, config: RelayConfig): boolean {
  const typed = normalize(given);
  if (!typed) return false;
  const accepted = item.acceptedAnswers.map(normalize);
  if (accepted.includes(typed)) return true;
  if (item.matching === 'exact') return false;
  return accepted.some((answer) => {
    const longest = Math.max(typed.length, answer.length);
    return longest > 0 && 1 - editDistance(typed, answer) / longest >= config.matchThreshold;
  });
}

export type QuestionPhase = 'running' | 'expired';

export function questionPhase(
  config: RelayConfig,
  questionStartedAt: Date,
  now: number,
  carriedSeconds = 0,
): { phase: QuestionPhase; elapsedSec: number; secondsLeft: number; allowance: number } {
  // Whatever a skip handed forward is added to this question's own time.
  const allowance = config.questionSeconds + Math.max(0, carriedSeconds);
  const elapsedSec = (now - questionStartedAt.getTime()) / 1000;
  return {
    phase: elapsedSec >= allowance ? 'expired' : 'running',
    elapsedSec,
    secondsLeft: Math.max(0, Math.ceil(allowance - elapsedSec)),
    allowance,
  };
}

export function roundSeconds(config: RelayConfig): number {
  return config.questionsPerRound * config.questionSeconds;
}

/**
 * A round runs the same length for everyone regardless of how fast a team
 * finishes, so rounds start together and the leaderboard between them is
 * shared. Finishing early buys points, not a head start.
 */
export function roundPhase(
  config: RelayConfig,
  roundStartedAt: Date,
  now: number,
): { phase: 'playing' | 'break'; secondsLeft: number } {
  const elapsed = (now - roundStartedAt.getTime()) / 1000;
  const length = roundSeconds(config);
  if (elapsed < length) {
    return { phase: 'playing', secondsLeft: Math.max(0, Math.ceil(length - elapsed)) };
  }
  return {
    phase: 'break',
    secondsLeft: Math.max(0, Math.ceil(length + config.breakSeconds - elapsed)),
  };
}

export interface RoundScore {
  correct: number;
  basePoints: number;
  /** The round clock when the team closed its last question; zero if it ran out. */
  secondsSaved: number;
  bonusPoints: number;
  totalPoints: number;
  secondsUsed: number;
}

/**
 * A team that finishes the round early banks half a point for every second it
 * saved — floor(saved / 2) — as long as it got at least one right. Skipping
 * the lot to reach the end fast earns nothing.
 *
 * The saved time is the round clock as players saw it when the last question
 * closed. Rounds recorded before that was kept fall back to the question
 * times, which add up to the same thing give or take their rounding.
 */
export function scoreRound(answers: RelayAnswerRecord[], config: RelayConfig): RoundScore {
  const correct = answers.filter((answer) => answer.outcome === 'correct').length;
  const secondsUsed = answers.reduce((total, answer) => total + answer.secondsTaken, 0);
  const basePoints = answers.reduce((total, answer) => total + answer.points, 0);
  const finished = answers.length === config.questionsPerRound;
  const last = [...answers].sort((a, b) => a.position - b.position).at(-1);
  const secondsSaved = finished
    ? Math.max(0, Math.round(last?.roundSecondsLeft ?? roundSeconds(config) - secondsUsed))
    : 0;
  const bonusPoints = correct > 0 ? Math.floor(secondsSaved / 2) : 0;
  return {
    correct,
    basePoints,
    secondsSaved,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    secondsUsed,
  };
}

export interface StandingRow {
  teamId: string;
  name: string;
  points: number;
  secondsUsed: number;
  rank: number;
}

/** Most points first; level teams separated by who spent least time. */
export function standings(
  teams: { teamId: string; name: string; points: number; secondsUsed: number }[],
): StandingRow[] {
  return [...teams]
    .sort((a, b) => b.points - a.points || a.secondsUsed - b.secondsUsed || a.name.localeCompare(b.name))
    .map((team, index) => ({ ...team, rank: index + 1 }));
}
