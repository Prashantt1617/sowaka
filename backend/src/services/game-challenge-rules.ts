/**
 * Who may do what to a game challenge, who won, what it pays, and when one
 * has run out.
 *
 * Pure: no database, no clock of its own (every check takes `now`), so
 * `scripts/game-challenge-check.ts` can run every rule without a server.
 */
import { randomInt } from 'node:crypto';
import type {
  ChallengeRewardRules,
  GameChallenge,
  GameChallengeAward,
  GameChallengeStatus,
} from '../models/game-challenge.model';

/** Challenges a person may have out at once (waiting for an answer, or not yet played). */
export const MAX_OPEN_OUTGOING = 5;
/** Unanswered challenges anyone may be sent, so nobody can be flooded. */
export const MAX_PENDING_INCOMING = 10;
/** A live score update closer than this to the previous one is dropped. */
export const LIVE_MIN_INTERVAL_MS = 250;
/**
 * An accepted challenge takes a final score this long past its deadline, so a
 * round started just before it still counts. Covers the countdown and the round.
 */
export const FINISH_GRACE_MS = 2 * 60 * 1000;

/** The range the game pages take a seed from (1..999,999), and the server issues. */
export const SEED_MIN = 1;
export const SEED_MAX = 999_999;

export function newSeed(): number {
  return randomInt(SEED_MIN, SEED_MAX + 1);
}

// ---------------------------------------------------------------- reward rules

/**
 * What a game's challenges pay, when its catalog entry says nothing. Each
 * field can be set per game on `game_catalog.challengeRewards` (see
 * `scripts/game-catalog.ts --challenge-rewards`), without a release.
 */
export const DEFAULT_CHALLENGE_REWARDS: ChallengeRewardRules = {
  perPoints: 100,
  maxPerMatch: 25,
  dailyWinCap: 3,
  // As many as the daily cap: beating the same colleague again still pays
  // (Tanvi, 10 Oct 2026 — a winner shown 0 points read as a bug).
  samePairPerDay: 3,
  minLoserShare: 0.25,
  participation: 2,
  expiryHours: 24,
  // Odd One Out's round is 45 s; a final much sooner than that was never played.
  minPlaySeconds: 30,
};

/** The limits each field is held to, whatever the database says. */
const REWARD_BOUNDS: Record<keyof ChallengeRewardRules, { min: number; max: number; integer: boolean }> = {
  perPoints: { min: 1, max: 1_000_000, integer: true },
  maxPerMatch: { min: 0, max: 10_000, integer: true },
  dailyWinCap: { min: 0, max: 1_000, integer: true },
  samePairPerDay: { min: 0, max: 1_000, integer: true },
  minLoserShare: { min: 0, max: 1, integer: false },
  participation: { min: 0, max: 1_000, integer: true },
  expiryHours: { min: 1, max: 24 * 14, integer: false },
  minPlaySeconds: { min: 0, max: 3600, integer: false },
};

export const CHALLENGE_REWARD_FIELDS = Object.keys(REWARD_BOUNDS) as (keyof ChallengeRewardRules)[];

/** One field as given, or null when it is not a usable value. */
export function rewardFieldValue(field: keyof ChallengeRewardRules, raw: unknown): number | null {
  const bounds = REWARD_BOUNDS[field];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) return null;
  if (bounds.integer && !Number.isInteger(value)) return null;
  return value;
}

/** A game's rules: what its entry sets, the default for anything it does not or sets badly. */
export function challengeRewardsOf(raw: unknown): ChallengeRewardRules {
  const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rules = { ...DEFAULT_CHALLENGE_REWARDS };
  for (const field of CHALLENGE_REWARD_FIELDS) {
    const value = rewardFieldValue(field, given[field]);
    if (value !== null) rules[field] = value;
  }
  return rules;
}

export function expiryMs(rules: Pick<ChallengeRewardRules, 'expiryHours'>): number {
  return Math.round(rules.expiryHours * 60 * 60 * 1000);
}

/** Midnight in India, the day caps reset on, as an instant. */
export function istDayStart(now: Date): Date {
  const IST = 330 * 60 * 1000;
  const shifted = new Date(now.getTime() + IST);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST);
}

// ---------------------------------------------------------------- who may

/** A refusal can carry `details` for the page, such as the challenge it is about. */
export type Refusal = { ok: false; status: number; message: string; details?: Record<string, unknown> };
export type Decision = { ok: true } | Refusal;

const ok: Decision = { ok: true };
const no = (status: number, message: string, details?: Record<string, unknown>): Refusal =>
  details ? { ok: false, status, message, details } : { ok: false, status, message };

/** Someone a person could challenge: the fields the rule reads. */
export interface ChallengeCandidate {
  userId: string;
  org?: string;
  email?: string;
  lifecycleStatus?: string;
  isCounsellor?: boolean;
}

/** A person's company: their org, or for an old record the domain of their email. */
export function orgOf(user: { org?: string; email?: string }): string {
  return user.org ?? user.email?.split('@').at(1) ?? 'default';
}

const INACTIVE = new Set(['offboarded', 'terminated']);

/** Whether `opponent` can be challenged by `viewer`: a colleague, still here, not a counsellor, not themselves. */
export function mayChallenge(viewer: ChallengeCandidate, opponent: ChallengeCandidate | null): Decision {
  // Someone outside the company reads exactly like someone who does not exist.
  if (!opponent || orgOf(opponent) !== orgOf(viewer)) return no(404, 'That colleague could not be found');
  if (opponent.userId === viewer.userId) return no(400, "You can't challenge yourself");
  if (INACTIVE.has(opponent.lifecycleStatus ?? '')) return no(404, 'That colleague could not be found');
  if (opponent.isCounsellor === true) return no(404, 'That colleague could not be found');
  return ok;
}

/**
 * A challenge still on a player's plate: one they sent that waits for an
 * answer, or one accepted that they have not played. Challenges sent to them
 * and not yet answered are not: those can arrive and wait whatever they have on.
 */
export function isOwnOpen(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'status' | 'expiresAt' | 'scores'>,
  userId: string,
  now: Date,
): boolean {
  const status = effectiveStatus(c, now);
  if (status === 'pending') return c.challengerUserId === userId;
  if (status === 'accepted') return isParticipant(c, userId) && !c.scores?.[userId];
  return false;
}

/** The player's own open challenge, as the service found it: which, and who it is with. */
export interface OwnOpen {
  challengeId: string;
  withName: string;
}

/**
 * One challenge at a time: nobody sends another, or accepts one sent to them,
 * while one of their own is open. The refusal names the challenge, so the
 * page can offer to open it.
 */
export function mayTakeAnother(own: OwnOpen | null | undefined): Decision {
  if (!own) return ok;
  return no(409, `Finish or clear your challenge with ${firstNameOf(own.withName)} first`, {
    challengeId: own.challengeId,
    reason: 'one_open',
  });
}

/** What is already open around a new challenge, as the service counted it. */
export interface OpenCounts {
  /** The challenger's own open challenges (pending or accepted, any game). */
  outgoing: number;
  /** Unanswered challenges already waiting for the opponent. */
  incomingForOpponent: number;
  /** An open challenge between these two, either way round, for this game. */
  betweenThem: boolean;
  /** The challenger's own open challenge (`isOwnOpen`), if they have one. */
  own?: OwnOpen | null;
}

export function mayOpenAnother(counts: OpenCounts): Decision {
  if (counts.betweenThem) return no(409, 'You already have a challenge open with them');
  const one = mayTakeAnother(counts.own);
  if (!one.ok) return one;
  if (counts.outgoing >= MAX_OPEN_OUTGOING) {
    return no(429, `You have ${MAX_OPEN_OUTGOING} challenges open. Finish one before sending another.`);
  }
  if (counts.incomingForOpponent >= MAX_PENDING_INCOMING) {
    return no(429, 'They have too many challenges waiting. Try again later.');
  }
  return ok;
}

export function isParticipant(c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId'>, userId: string): boolean {
  return userId === c.challengerUserId || userId === c.opponentUserId;
}

export function otherPlayer(c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId'>, userId: string): string {
  return userId === c.challengerUserId ? c.opponentUserId : c.challengerUserId;
}

/**
 * The status as of `now`. An open challenge past its time reads as expired
 * before the sweep writes it; an accepted one keeps FINISH_GRACE_MS for a
 * round already under way.
 */
export function effectiveStatus(c: Pick<GameChallenge, 'status' | 'expiresAt'>, now: Date): GameChallengeStatus {
  const deadline = c.expiresAt.getTime() + (c.status === 'accepted' ? FINISH_GRACE_MS : 0);
  if ((c.status === 'pending' || c.status === 'accepted') && deadline <= now.getTime()) return 'expired';
  return c.status;
}

export function isExpired(c: Pick<GameChallenge, 'status' | 'expiresAt'>, now: Date): boolean {
  return effectiveStatus(c, now) === 'expired';
}

/**
 * 'accept' and 'decline' answer a pending challenge; 'ready' is saying ready,
 * or not ready, in an accepted one's lobby.
 */
export type ChallengeAction = 'view' | 'accept' | 'decline' | 'ready' | 'live' | 'finish';

/**
 * Whether `userId` may do `action` to the challenge as of `now`. Anyone not
 * playing in it is told it does not exist.
 */
export function challengeMay(action: ChallengeAction, userId: string, c: GameChallenge, now: Date): Decision {
  if (!isParticipant(c, userId)) return no(404, 'Challenge not found');
  if (action === 'view') return ok;
  const status = effectiveStatus(c, now);
  if (status === 'expired') return no(410, 'This challenge has expired');
  switch (action) {
    case 'accept':
    case 'decline':
      if (userId !== c.opponentUserId) return no(403, 'Only the person challenged can answer it');
      if (status !== 'pending') return no(409, status === 'declined' ? 'This challenge was declined' : 'This challenge has already been answered');
      return ok;
    case 'ready': {
      if (status === 'pending') return no(409, 'This challenge has not been accepted yet');
      if (status !== 'accepted') return no(409, 'This challenge is over');
      if (c.scores?.[userId]) return no(409, 'You have already played this challenge');
      // Nobody to start with: the other has played. The page falls back to a round on their own.
      const other = otherPlayer(c, userId);
      if (c.scores?.[other]) return no(409, `${namesFrom(c, other)} has already played. Play your round when you're ready.`);
      if (c.startAt) return no(409, 'This challenge has already started');
      if (c.expiresAt.getTime() <= now.getTime()) return no(409, 'Too late to start together. Play your round now.');
      return ok;
    }
    case 'live':
    case 'finish':
      if (status === 'pending') return no(409, 'This challenge has not been accepted yet');
      if (status !== 'accepted') return no(409, 'This challenge is over');
      if (c.scores?.[userId]) return no(409, 'You have already played this challenge');
      return ok;
  }
}

/**
 * What accepting means: answering a challenge still pending, or once it is
 * accepted, saying ready (or not ready any more) in its lobby. The app's
 * bridge carries nothing but the challenge's id, so one call does both.
 */
export function acceptMeans(c: Pick<GameChallenge, 'status' | 'expiresAt'>, now: Date): 'answer' | 'ready' {
  return effectiveStatus(c, now) === 'accepted' ? 'ready' : 'answer';
}

// ---------------------------------------------------------------- clearing

/**
 * The one way to get rid of a challenge (the page's Decline), and what it
 * does depends on who and when:
 *   - 'decline': the one challenged, before answering;
 *   - 'withdraw': the challenger, before an answer;
 *   - 'call_off': either player once accepted, while neither has played;
 *   - 'hide': either player, once it is over: off their own list only.
 */
export type ClearAction = 'decline' | 'withdraw' | 'call_off' | 'hide';
export type ClearDecision = { ok: true; action: ClearAction } | Refusal;

export function clearingFor(c: GameChallenge, userId: string, now: Date): ClearDecision {
  if (!isParticipant(c, userId)) return no(404, 'Challenge not found');
  switch (effectiveStatus(c, now)) {
    case 'pending':
      return { ok: true, action: userId === c.opponentUserId ? 'decline' : 'withdraw' };
    case 'accepted': {
      // A final posted means a result is on its way: calling it off then would dodge a loss.
      if (c.scores?.[userId]) return no(409, "You've already played your round, so it can't be called off");
      const other = otherPlayer(c, userId);
      if (c.scores?.[other]) {
        return no(409, `${namesFrom(c, other)} has already played, so it can't be called off. Play your round to finish it.`);
      }
      return { ok: true, action: 'call_off' };
    }
    default:
      return { ok: true, action: 'hide' };
  }
}

/** Whether `userId` has cleared the challenge from their own list. */
export const hiddenFor = (c: Pick<GameChallenge, 'hiddenBy'>, userId: string) => (c.hiddenBy ?? []).includes(userId);

// ---------------------------------------------------------------- the lobby

/**
 * How long a heartbeat keeps someone in the lobby. The page sends one about
 * every 20 s while it shows the lobby, so a closed page drops out within a minute.
 */
export const LOBBY_PRESENCE_MS = 60_000;
/** From both being ready to both rounds starting: time for the start to reach both phones and count down 3-2-1. */
export const START_DELAY_MS = 4_000;

/** Where a player is: not in the lobby, in it, or in it and ready. */
export type LobbyState = 'away' | 'joined' | 'ready';

/**
 * Whether the two can still start together: accepted, not started yet,
 * neither has played, and before its deadline. The finish grace past the
 * deadline is for a round already under way, not for starting one.
 */
export function lobbyOpen(c: GameChallenge, now: Date): boolean {
  return c.status === 'accepted' && c.expiresAt.getTime() > now.getTime() && !c.startAt
    && !c.scores?.[c.challengerUserId] && !c.scores?.[c.opponentUserId];
}

/** Whether `userId`'s last heartbeat is recent enough to count them as in the lobby. */
export function inLobby(c: Pick<GameChallenge, 'seen'>, userId: string, now: Date): boolean {
  const seen = c.seen?.[userId];
  return seen !== undefined && now.getTime() - new Date(seen).getTime() < LOBBY_PRESENCE_MS;
}

/** A ready only counts while its player is in the lobby. */
export function lobbyStateOf(c: Pick<GameChallenge, 'seen' | 'ready'>, userId: string, now: Date): LobbyState {
  if (!inLobby(c, userId, now)) return 'away';
  return c.ready?.[userId] ? 'ready' : 'joined';
}

/** What a ready call does: says ready, or takes a ready back. */
export function readyToggle(c: Pick<GameChallenge, 'seen' | 'ready'>, userId: string, now: Date): 'ready' | 'unready' {
  return lobbyStateOf(c, userId, now) === 'ready' ? 'unready' : 'ready';
}

/** Whether both are in the lobby and ready, so both rounds can be given a start. */
export function bothReady(c: GameChallenge, now: Date): boolean {
  return lobbyOpen(c, now)
    && lobbyStateOf(c, c.challengerUserId, now) === 'ready'
    && lobbyStateOf(c, c.opponentUserId, now) === 'ready';
}

/** When both rounds start, given both were ready at `now`. */
export const startAtFor = (now: Date) => new Date(now.getTime() + START_DELAY_MS);

/**
 * Whether `userId` coming into the lobby should be pushed to the other
 * player: only the first time they come, and not when the other is already
 * there to see it happen.
 */
export function tellOtherOfArrival(c: GameChallenge, userId: string, now: Date): boolean {
  return !c.lobbyPushed?.[userId] && !inLobby(c, otherPlayer(c, userId), now);
}

/** The push for that: "Kritik is waiting in the Odd One Out lobby". */
export function lobbyArrivalLine(
  c: Pick<GameChallenge, 'challengerUserId' | 'challengerName' | 'opponentName'>,
  userId: string,
  gameName: string,
): string {
  return `${namesFrom(c, userId)} is waiting in the ${gameName} lobby`;
}

// ---------------------------------------------------------------- result and reward

/**
 * Whether a final posted at `now` can be a round really played: not sooner
 * than `minPlaySeconds` after the player's round began (their first live
 * score), or, when no live score ever arrived, after the challenge was accepted.
 */
export function playedLongEnough(
  c: Pick<GameChallenge, 'started' | 'acceptedAt' | 'createdAt'>,
  userId: string,
  rules: Pick<ChallengeRewardRules, 'minPlaySeconds'>,
  now: Date,
): Decision {
  const began = c.started?.[userId] ?? c.acceptedAt ?? c.createdAt;
  if (now.getTime() - new Date(began).getTime() < rules.minPlaySeconds * 1000) {
    return no(400, 'That round ended too soon to count');
  }
  return ok;
}

/** Who won: the higher score, a tie is a draw; null until both have played. */
export function resultOf(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'scores'>,
): { draw: true; winnerUserId: null } | { draw: false; winnerUserId: string } | null {
  const a = c.scores?.[c.challengerUserId];
  const b = c.scores?.[c.opponentUserId];
  if (!a || !b) return null;
  if (a.score === b.score) return { draw: true, winnerUserId: null };
  return { draw: false, winnerUserId: a.score > b.score ? c.challengerUserId : c.opponentUserId };
}

/** The result from one player's side. */
export function outcomeFor(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'scores'>,
  userId: string,
): 'won' | 'lost' | 'draw' | null {
  const result = resultOf(c);
  if (!result) return null;
  if (result.draw) return 'draw';
  return result.winnerUserId === userId ? 'won' : 'lost';
}

/**
 * The winner's base: both scores, unless the loser scored under
 * `minLoserShare` of the winner — a round thrown to hand someone points —
 * when it is the winner's own score alone.
 */
export function winBase(winnerScore: number, loserScore: number, rules: Pick<ChallengeRewardRules, 'minLoserShare'>) {
  const onlyOwnScore = loserScore < rules.minLoserShare * winnerScore;
  return { base: onlyOwnScore ? winnerScore : winnerScore + loserScore, onlyOwnScore };
}

/** A win's engagement points before any cap: the base scaled down, at least one, at most the match cap. */
export function winPoints(base: number, rules: Pick<ChallengeRewardRules, 'perPoints' | 'maxPerMatch'>): number {
  return Math.min(rules.maxPerMatch, Math.max(1, Math.round(base / rules.perPoints)));
}

/**
 * How much each player has already been paid today (IST), in this game, by
 * challenges other than this one: rewarded wins, participation awards, and
 * the winner's rewarded wins over this same opponent.
 */
export interface PaidToday {
  wins: Record<string, number>;
  participation: Record<string, number>;
  /** Rewarded wins of each player over the other one in this challenge. */
  winsOverOther: Record<string, number>;
}

/**
 * What a finished challenge pays, in engagement points, after every cap.
 *
 *   - The winner: their score plus the loser's (just their own if the loser
 *     scored under `minLoserShare` of it), divided by `perPoints`, rounded, at
 *     least 1 and at most `maxPerMatch`. Nothing once they have had
 *     `dailyWinCap` rewarded wins today, or `samePairPerDay` over this opponent.
 *   - The loser, and both players on a draw: their own score divided by
 *     `perPoints`, rounded, at most `maxPerMatch`, until they have had
 *     `dailyWinCap` such awards today. (`participation` is no longer used.)
 *
 * Null until both have played. A capped award is kept, at zero, with why.
 */
export function computeAwards(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'scores'>,
  rules: ChallengeRewardRules,
  paid: PaidToday,
): { reward: GameChallengeAward | null; awards: GameChallengeAward[] } | null {
  const result = resultOf(c);
  if (!result) return null;
  // The loser, and both players on a draw, earn their own score scaled as a
  // win is — not the flat `participation` award they used to (Tanvi, 12 Oct
  // 2026: "even if I lose I get my scored points / 100"). Results already in
  // keep what they were paid; only challenges finishing from now on pay this.
  const participation = (userId: string): GameChallengeAward => {
    const points = Math.min(rules.maxPerMatch, Math.round((c.scores[userId]?.score ?? 0) / rules.perPoints));
    if (points <= 0) return { userId, kind: 'participation', points: 0, capped: null };
    if ((paid.participation[userId] ?? 0) >= rules.dailyWinCap) {
      return { userId, kind: 'participation', points: 0, capped: 'daily_limit' };
    }
    return { userId, kind: 'participation', points, capped: null };
  };
  if (result.draw) {
    return { reward: null, awards: [participation(c.challengerUserId), participation(c.opponentUserId)] };
  }
  const winner = result.winnerUserId;
  const loser = otherPlayer(c, winner);
  const { base, onlyOwnScore } = winBase(c.scores[winner].score, c.scores[loser].score, rules);
  let reward: GameChallengeAward;
  if ((paid.wins[winner] ?? 0) >= rules.dailyWinCap) {
    reward = { userId: winner, kind: 'win', points: 0, base, onlyOwnScore, capped: 'daily_limit' };
  } else if ((paid.winsOverOther[winner] ?? 0) >= rules.samePairPerDay) {
    reward = { userId: winner, kind: 'win', points: 0, base, onlyOwnScore, capped: 'same_pair' };
  } else {
    reward = { userId: winner, kind: 'win', points: winPoints(base, rules), base, onlyOwnScore, capped: null };
  }
  return { reward, awards: [reward, participation(loser)] };
}

/** Why an award came to nothing, as the result card says it. */
export function cappedReason(award: Pick<GameChallengeAward, 'capped'>, otherName: string): string | null {
  if (award.capped === 'daily_limit') return 'Daily limit reached';
  if (award.capped === 'same_pair') return `Already rewarded for a win over ${otherName} today`;
  return null;
}

// ---------------------------------------------------------------- scores and lines

/** A score from a page: a finite, non-negative number no larger than the game allows, rounded. */
export function parseChallengeScore(raw: unknown, max: number): number | null {
  const score = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(score) || score < 0 || score > max) return null;
  return Math.round(score);
}

/** "4,320": the way the game page and the pushes write a score. */
export function formatScore(score: number): string {
  return Math.round(score).toLocaleString('en-IN');
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || 'them';

function namesFrom(
  c: Pick<GameChallenge, 'challengerUserId' | 'challengerName' | 'opponentName'>,
  them: string,
): string {
  return firstNameOf(them === c.challengerUserId ? c.challengerName : c.opponentName);
}

/** The push the first finisher gets once the second is in, from that first finisher's side. */
export function resultLine(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'scores' | 'challengerName' | 'opponentName'>,
  userId: string,
): string | null {
  const outcome = outcomeFor(c, userId);
  if (!outcome) return null;
  const them = otherPlayer(c, userId);
  const theirName = namesFrom(c, them);
  const mine = formatScore(c.scores[userId].score);
  const theirs = formatScore(c.scores[them].score);
  if (outcome === 'won') return `You beat ${theirName} ${mine} to ${theirs}`;
  if (outcome === 'lost') return `${theirName} beat you ${theirs} to ${mine}`;
  return `You and ${theirName} tied at ${mine}`;
}

/** The ledger's line for one player's award: "Beat Priya 4,320–3,980". */
export function ledgerNote(
  c: Pick<GameChallenge, 'challengerUserId' | 'opponentUserId' | 'scores' | 'challengerName' | 'opponentName'>,
  userId: string,
): string {
  const them = otherPlayer(c, userId);
  const theirName = namesFrom(c, them);
  const mine = formatScore(c.scores[userId]?.score ?? 0);
  const theirs = formatScore(c.scores[them]?.score ?? 0);
  switch (outcomeFor(c, userId)) {
    case 'won':
      return `Beat ${theirName} ${mine}–${theirs}`;
    case 'lost':
      return `Played ${theirName} ${mine}–${theirs}`;
    default:
      return `Tied with ${theirName} at ${mine}`;
  }
}
