/**
 * Game challenges: one colleague challenges another to a round of a catalog
 * game, both play the same boards (the server's `seed`), and the scores are
 * compared once both are in.
 *
 * The two players hear about every change on their own socket channel
 * (`game:challenge`), and by push for the ones that need them: a challenge
 * received; for the challenger, the answer; and the result for whoever
 * finished first. Rules about who may do what are in `game-challenge-rules.ts`.
 *
 * Points: a finished challenge pays engagement points, scaled and capped by
 * the game's `challengeRewards` (`computeAwards`), into `User.points` with a
 * row each in the points ledger. `awardChallengePoints` is the only place
 * that happens, and it pays a challenge once.
 */
import { randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import { gameCatalog, gameChallenges, users } from '../config/db';
import {
  OPEN_CHALLENGE_STATUSES,
  type GameChallenge,
} from '../models/game-challenge.model';
import type { User } from '../models/user.model';
import { logger } from '../utils/logger';
import { emitGameChallenge } from './connect-realtime.service';
import { requireChallengeGame } from './game-catalog.service';
import {
  FINISH_GRACE_MS,
  LIVE_MIN_INTERVAL_MS,
  cappedReason,
  challengeMay,
  computeAwards,
  effectiveStatus,
  expiryMs,
  istDayStart,
  isParticipant,
  ledgerNote,
  mayChallenge,
  mayOpenAnother,
  newSeed,
  orgOf,
  otherPlayer,
  outcomeFor,
  parseChallengeScore,
  resultLine,
  type Decision,
  type PaidToday,
} from './game-challenge-rules';
import { notifyUsers } from './notification.service';
import { recordPointChanges } from './points-ledger.service';
import { resolveProfilePhoto } from './s3-connect-media.service';

export class GameChallengeError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GameChallengeError';
  }
}

/** The signed-in person, as `requireAuth` loaded them. */
export type ChallengeViewer = Pick<User, 'userId' | 'name' | 'email'> & Partial<Pick<User, 'org'>>;

const SCORE_CEILING = 1_000_000_000;
const LIST_SCAN = 80;
const RECENT_RESULTS = 10;
const COLLEAGUE_LIMIT = 50;
const BOARD_SIZE = 10;
const INACTIVE = ['offboarded', 'terminated'];

function refuse(decision: Decision): never {
  if (decision.ok) throw new Error('refuse() called with an allowed decision');
  throw new GameChallengeError(decision.status, decision.message);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// ---------------------------------------------------------------- views

export interface ChallengePlayerView {
  userId: string;
  name: string;
  /** Final score; null until they have played. */
  score: number | null;
  finishedAt: Date | null;
  /** Last score reported mid-round, and when. */
  live: number | null;
  liveAt: Date | null;
}

export interface ChallengeView {
  id: string;
  gameKey: string;
  /** The board sequence both play; only once accepted, so nobody practises it first. */
  seed: number | null;
  status: GameChallenge['status'];
  role: 'challenger' | 'opponent';
  me: ChallengePlayerView;
  them: ChallengePlayerView;
  /** From the viewer's side, once both have played. */
  outcome: 'won' | 'lost' | 'draw' | null;
  /** What the viewer earned in engagement points once it finished, or why nothing. */
  myAward: AwardView | null;
  /** What the other player earned. */
  theirAward: AwardView | null;
  createdAt: Date;
  acceptedAt: Date | null;
  closedAt: Date | null;
  expiresAt: Date;
}

export interface AwardView {
  kind: 'win' | 'participation';
  points: number;
  /** Only the winner's own score counted: the loser's was under the game's minimum share. */
  onlyOwnScore: boolean;
  /** Why it came to nothing, for the result card. */
  reason: string | null;
}

function awardView(c: GameChallenge, userId: string): AwardView | null {
  const award = (c.awards ?? []).find((a) => a.userId === userId);
  if (!award) return null;
  const otherId = otherPlayer(c, userId);
  const otherName = (otherId === c.challengerUserId ? c.challengerName : c.opponentName).trim().split(/\s+/)[0] ?? '';
  return {
    kind: award.kind,
    points: award.points,
    onlyOwnScore: award.onlyOwnScore === true,
    reason: cappedReason(award, otherName),
  };
}

function playerView(c: GameChallenge, userId: string): ChallengePlayerView {
  const score = c.scores?.[userId];
  const live = c.live?.[userId];
  return {
    userId,
    name: userId === c.challengerUserId ? c.challengerName : c.opponentName,
    score: score ? score.score : null,
    finishedAt: score ? score.finishedAt : null,
    live: live ? live.score : null,
    liveAt: live ? live.at : null,
  };
}

export function toView(c: GameChallenge, viewerId: string, now = new Date()): ChallengeView {
  const status = effectiveStatus(c, now);
  const finished = status === 'finished';
  const outcome = finished ? outcomeFor(c, viewerId) : null;
  return {
    id: c.id,
    gameKey: c.gameKey,
    seed: status === 'accepted' ? c.seed : null,
    status,
    role: viewerId === c.challengerUserId ? 'challenger' : 'opponent',
    me: playerView(c, viewerId),
    them: playerView(c, otherPlayer(c, viewerId)),
    outcome,
    myAward: finished ? awardView(c, viewerId) : null,
    theirAward: finished ? awardView(c, otherPlayer(c, viewerId)) : null,
    createdAt: c.createdAt,
    acceptedAt: c.acceptedAt ?? null,
    closedAt: c.closedAt ?? null,
    expiresAt: c.expiresAt,
  };
}

/** Each player gets their own view of the change. */
function broadcast(c: GameChallenge, kind: string) {
  const now = new Date();
  for (const userId of [c.challengerUserId, c.opponentUserId]) {
    emitGameChallenge(userId, { kind, challengeId: c.id, gameKey: c.gameKey, challenge: toView(c, userId, now) });
  }
}

/** A push about a challenge; never holds up the request that caused it. */
function push(userId: string, scenario: string, title: string, body: string, c: GameChallenge) {
  void notifyUsers([userId], {
    scenario,
    title,
    body,
    data: { destination: 'game_challenge', gameKey: c.gameKey, challengeId: c.id },
  }).catch((error) => logger.error('Game challenge push failed', { scenario, challengeId: c.id }, error));
}

async function load(id: string): Promise<GameChallenge> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    throw new GameChallengeError(404, 'Challenge not found');
  }
  const c = await gameChallenges().findOne({ id }, { projection: { _id: 0 } });
  if (!c) throw new GameChallengeError(404, 'Challenge not found');
  return c;
}

/** The challenge, provided the viewer may do `action` to it now. */
async function loadFor(viewer: ChallengeViewer, id: string, action: Parameters<typeof challengeMay>[0]) {
  const c = await load(id);
  const decision = challengeMay(action, viewer.userId, c, new Date());
  if (!decision.ok) refuse(decision);
  return c;
}

// ---------------------------------------------------------------- colleagues

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Who the viewer can challenge: everyone still at their company, bar counsellors and themselves. */
export async function listColleagues(viewer: ChallengeViewer, rawQuery: unknown, rawLimit: unknown) {
  const org = orgOf(viewer);
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 60) : '';
  const requested = Number(rawLimit);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 500) : COLLEAGUE_LIMIT;
  const filter: Filter<User> = {
    userId: { $ne: viewer.userId },
    lifecycleStatus: { $nin: INACTIVE as User['lifecycleStatus'][] },
    isCounsellor: { $ne: true },
    $and: [
      { $or: [{ org }, { org: { $exists: false }, email: { $regex: `@${escapeRegex(org)}$`, $options: 'i' } }] },
      ...(query ? [{ name: { $regex: escapeRegex(query), $options: 'i' } }] : []),
    ],
  };
  const rows = await users()
    .find(filter, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1, profilePhotoKey: 1 } })
    .sort({ name: 1 })
    .limit(limit)
    .toArray();
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.userId,
      name: row.name,
      designation: row.designation ?? '',
      department: row.department ?? '',
      photoUrl: (await resolveProfilePhoto({ profilePhotoKey: row.profilePhotoKey })) ?? null,
    })),
  );
}

// ---------------------------------------------------------------- create, answer

export async function createChallenge(viewer: ChallengeViewer, body: { gameKey?: unknown; opponentUserId?: unknown }) {
  const gameKey = typeof body.gameKey === 'string' ? body.gameKey : '';
  const opponentUserId = typeof body.opponentUserId === 'string' ? body.opponentUserId.trim() : '';
  if (!opponentUserId) throw new GameChallengeError(400, 'Choose who to challenge');
  const [game, opponent] = await Promise.all([
    requireChallengeGame(viewer, gameKey),
    users().findOne(
      { userId: opponentUserId },
      { projection: { _id: 0, userId: 1, name: 1, org: 1, email: 1, lifecycleStatus: 1, isCounsellor: 1 } },
    ),
  ]);
  const allowed = mayChallenge(viewer, opponent);
  if (!allowed.ok) refuse(allowed);

  const now = new Date();
  const open = { status: { $in: OPEN_CHALLENGE_STATUSES }, expiresAt: { $gt: now } };
  const [outgoing, incomingForOpponent, between] = await Promise.all([
    gameChallenges().countDocuments({ challengerUserId: viewer.userId, ...open }),
    gameChallenges().countDocuments({ opponentUserId, status: 'pending', expiresAt: { $gt: now } }),
    gameChallenges().findOne(
      {
        gameKey: game.key,
        ...open,
        $or: [
          { challengerUserId: viewer.userId, opponentUserId },
          { challengerUserId: opponentUserId, opponentUserId: viewer.userId },
        ],
      },
      { projection: { _id: 0, id: 1 } },
    ),
  ]);
  const room = mayOpenAnother({ outgoing, incomingForOpponent, betweenThem: Boolean(between) });
  if (!room.ok) {
    throw new GameChallengeError(room.status, room.message, between ? { challengeId: between.id } : undefined);
  }

  const challenge: GameChallenge = {
    id: randomUUID(),
    org: game.org,
    gameKey: game.key,
    seed: newSeed(),
    challengerUserId: viewer.userId,
    challengerName: viewer.name,
    opponentUserId,
    opponentName: opponent!.name,
    status: 'pending',
    scores: {},
    live: {},
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + expiryMs(game.rewards)),
  };
  await gameChallenges().insertOne({ ...challenge });
  broadcast(challenge, 'created');
  push(
    opponentUserId,
    'game_challenge_received',
    `${viewer.name} challenged you to ${game.name}`,
    'Same boards for both of you. Accept to play.',
    challenge,
  );
  return toView(challenge, viewer.userId, now);
}

async function answer(viewer: ChallengeViewer, id: string, verdict: 'accepted' | 'declined') {
  const pending = await loadFor(viewer, id, verdict === 'accepted' ? 'accept' : 'decline');
  // A game since taken off the company's list can still be declined, not played.
  const game = await requireChallengeGame(viewer, pending.gameKey).catch((error) => {
    if (verdict === 'accepted') throw error;
    return null;
  });
  const now = new Date();
  const set: Partial<GameChallenge> =
    verdict === 'accepted'
      ? { status: 'accepted', acceptedAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + expiryMs(game!.rewards)) }
      : { status: 'declined', closedAt: now, updatedAt: now };
  const c = await gameChallenges().findOneAndUpdate(
    { id, opponentUserId: viewer.userId, status: 'pending', expiresAt: { $gt: now } },
    { $set: set },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!c) {
    // Answered or expired in the meantime: say which.
    const decision = challengeMay(verdict === 'accepted' ? 'accept' : 'decline', viewer.userId, await load(id), now);
    refuse(decision.ok ? { ok: false, status: 409, message: 'This challenge has already been answered' } : decision);
  }
  broadcast(c, verdict);
  const gameName = game?.name ?? 'the game';
  push(
    c.challengerUserId,
    verdict === 'accepted' ? 'game_challenge_accepted' : 'game_challenge_declined',
    verdict === 'accepted'
      ? `${firstName(c.opponentName)} accepted your challenge`
      : `${firstName(c.opponentName)} declined your challenge`,
    verdict === 'accepted' ? `${gameName}: play your round when you're ready.` : `${gameName}: maybe next time.`,
    c,
  );
  return toView(c, viewer.userId, now);
}

export const acceptChallenge = (viewer: ChallengeViewer, id: string) => answer(viewer, id, 'accepted');
export const declineChallenge = (viewer: ChallengeViewer, id: string) => answer(viewer, id, 'declined');

// ---------------------------------------------------------------- reading

export async function getChallenge(viewer: ChallengeViewer, id: string) {
  return toView(await loadFor(viewer, id, 'view'), viewer.userId);
}

/** The viewer's challenges, for one game when given: waiting on them, waiting on the other, in play, and the latest results. */
export async function listMyChallenges(viewer: ChallengeViewer, gameKey: unknown) {
  const now = new Date();
  const rows = await gameChallenges()
    .find(
      {
        $or: [{ challengerUserId: viewer.userId }, { opponentUserId: viewer.userId }],
        ...(typeof gameKey === 'string' && gameKey ? { gameKey } : {}),
      },
      { projection: { _id: 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(LIST_SCAN)
    .toArray();
  const views = rows.map((row) => toView(row, viewer.userId, now));
  const recent = views
    .filter((v) => v.status === 'finished' || v.status === 'declined' || v.status === 'expired')
    .sort((a, b) => (b.closedAt ?? b.expiresAt).getTime() - (a.closedAt ?? a.expiresAt).getTime())
    .slice(0, RECENT_RESULTS);
  return {
    incoming: views.filter((v) => v.status === 'pending' && v.role === 'opponent'),
    outgoing: views.filter((v) => v.status === 'pending' && v.role === 'challenger'),
    active: views.filter((v) => v.status === 'accepted'),
    recent,
  };
}

// ---------------------------------------------------------------- playing

/** When each player last had a live score passed on, by `${challengeId}:${userId}`. */
const lastLive = new Map<string, number>();

/**
 * A score mid-round, passed straight to the other player and kept on the
 * challenge for whoever opens it later. Updates closer together than
 * LIVE_MIN_INTERVAL_MS are dropped (the page sends at most a couple a second).
 */
export async function reportLive(viewer: ChallengeViewer, id: string, raw: unknown) {
  const score = parseChallengeScore(raw, SCORE_CEILING);
  if (score === null) throw new GameChallengeError(400, 'Score is invalid');
  const c = await loadFor(viewer, id, 'live');
  const key = `${c.id}:${viewer.userId}`;
  const nowMs = Date.now();
  if (nowMs - (lastLive.get(key) ?? 0) < LIVE_MIN_INTERVAL_MS) return { ok: true, throttled: true };
  lastLive.set(key, nowMs);
  const at = new Date(nowMs);
  // The other player first: the write only matters to someone opening it later.
  emitGameChallenge(otherPlayer(c, viewer.userId), {
    kind: 'live', challengeId: c.id, gameKey: c.gameKey, userId: viewer.userId, score, at,
  });
  await gameChallenges().updateOne(
    { id: c.id, status: 'accepted', [`scores.${viewer.userId}`]: { $exists: false } },
    { $set: { [`live.${viewer.userId}`]: { score, at } } },
  );
  return { ok: true, throttled: false };
}

/**
 * The viewer's final score. Once both are in the challenge finishes: the
 * result is decided, the points paid, and whoever finished first is told.
 * Posting again returns the challenge as it is, so a retry is harmless.
 */
export async function finishChallenge(viewer: ChallengeViewer, id: string, raw: unknown) {
  const existing = await load(id);
  if (!isParticipant(existing, viewer.userId)) throw new GameChallengeError(404, 'Challenge not found');
  if (existing.scores?.[viewer.userId]) return toView(existing, viewer.userId);
  const decision = challengeMay('finish', viewer.userId, existing, new Date());
  if (!decision.ok) refuse(decision);
  const game = await requireChallengeGame(viewer, existing.gameKey);
  const score = parseChallengeScore(raw, game.maxScore);
  if (score === null) throw new GameChallengeError(400, 'Score is invalid');

  const now = new Date();
  lastLive.delete(`${id}:${viewer.userId}`);
  const scored = await gameChallenges().findOneAndUpdate(
    {
      id,
      status: 'accepted',
      expiresAt: { $gt: new Date(now.getTime() - FINISH_GRACE_MS) },
      [`scores.${viewer.userId}`]: { $exists: false },
    },
    {
      $set: {
        [`scores.${viewer.userId}`]: { score, finishedAt: now },
        [`live.${viewer.userId}`]: { score, at: now },
        updatedAt: now,
      },
    },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!scored) {
    const latest = await load(id);
    if (latest.scores?.[viewer.userId]) return toView(latest, viewer.userId);
    const again = challengeMay('finish', viewer.userId, latest, now);
    refuse(again.ok ? { ok: false, status: 409, message: 'This challenge is over' } : again);
  }

  if (!resultOfBoth(scored)) {
    broadcast(scored, 'scored');
    return toView(scored, viewer.userId, now);
  }
  // Both are in. Only one request moves it to finished, and only that one decides the awards.
  const payout = computeAwards(scored, game.rewards, await paidToday(scored, now));
  const done = await gameChallenges().findOneAndUpdate(
    { id, status: 'accepted' },
    { $set: { status: 'finished', closedAt: now, updatedAt: now, reward: payout?.reward ?? null, awards: payout?.awards ?? [] } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!done) return toView(await load(id), viewer.userId);
  // The result stands whatever happens to the payment; the sweep pays anything left unpaid.
  await awardChallengePoints(done, game.name).catch((error) =>
    logger.error('Game challenge award failed', { challengeId: id }, error));
  broadcast(done, 'finished');
  const first = otherPlayer(done, viewer.userId);
  const line = resultLine(done, first);
  const earned = (done.awards ?? []).find((a) => a.userId === first);
  if (line) {
    push(
      first,
      'game_challenge_result',
      line,
      earned && earned.points > 0
        ? `${game.name}: +${earned.points} point${earned.points === 1 ? '' : 's'}.`
        : `${game.name}: rematch?`,
      done,
    );
  }
  return toView(done, viewer.userId, now);
}

const resultOfBoth = (c: GameChallenge) =>
  Boolean(c.scores?.[c.challengerUserId] && c.scores?.[c.opponentUserId]);

/**
 * What both players of `c` have already been paid today (IST) in this game,
 * by other challenges: the counts the daily and same-pair caps read.
 */
async function paidToday(c: GameChallenge, now: Date): Promise<PaidToday> {
  const players = [c.challengerUserId, c.opponentUserId];
  const rows = await gameChallenges()
    .find(
      {
        id: { $ne: c.id },
        gameKey: c.gameKey,
        status: 'finished',
        closedAt: { $gte: istDayStart(now) },
        'awards.userId': { $in: players },
      },
      { projection: { _id: 0, challengerUserId: 1, opponentUserId: 1, awards: 1 } },
    )
    .toArray();
  const paid: PaidToday = { wins: {}, participation: {}, winsOverOther: {} };
  for (const row of rows) {
    for (const award of row.awards ?? []) {
      if (!players.includes(award.userId) || award.points <= 0) continue;
      const tally = award.kind === 'win' ? paid.wins : paid.participation;
      tally[award.userId] = (tally[award.userId] ?? 0) + 1;
      const other = otherPlayer(c, award.userId);
      if (award.kind === 'win' && isParticipant(row, other) && isParticipant(row, award.userId)) {
        paid.winsOverOther[award.userId] = (paid.winsOverOther[award.userId] ?? 0) + 1;
      }
    }
  }
  return paid;
}

// ---------------------------------------------------------------- points

/**
 * Pays a finished challenge's awards into engagement points: `User.points`,
 * and a row each in the points ledger (source `game_challenge`, the
 * challenge as its ref). The only place challenge points are paid.
 *
 * Pays once: the challenge is claimed (`awardedAt`) before anything moves, so
 * a retry, a second request or the sweep finding it again pays nothing more.
 */
export async function awardChallengePoints(c: GameChallenge, gameName: string): Promise<void> {
  const claimed = await gameChallenges().findOneAndUpdate(
    { id: c.id, status: 'finished', awardedAt: { $exists: false } },
    { $set: { awardedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!claimed) return;
  const awards = claimed.awards ?? [];
  const paying = awards.filter((award) => award.points > 0);
  if (paying.length > 0) {
    await users().bulkWrite(
      paying.map((award) => ({ updateOne: { filter: { userId: award.userId }, update: { $inc: { points: award.points } } } })),
      { ordered: false },
    );
  }
  // Every finished game goes in both players' history — a win the caps paid
  // nothing for too, with why, so a game never looks as if it went missing.
  recordPointChanges(
    awards.map((award) => {
      const otherId = otherPlayer(claimed, award.userId);
      const otherName = firstName(otherId === claimed.challengerUserId ? claimed.challengerName : claimed.opponentName);
      const why = award.points > 0 ? null : cappedReason(award, otherName);
      return {
        userId: award.userId,
        org: claimed.org,
        delta: award.points,
        source: 'game_challenge' as const,
        reason: 'game' as const,
        refId: claimed.id,
        note: ledgerNote(claimed, award.userId) + (why ? ` · No points: ${why[0].toLowerCase()}${why.slice(1)}` : ''),
        gameKey: claimed.gameKey,
        title: gameName,
      };
    }),
    { keepZero: true },
  );
}

/** A finished challenge whose awards were never paid (the server stopped in between): paid now. */
async function payOverdue(now: Date) {
  const overdue = await gameChallenges()
    .find(
      { status: 'finished', awardedAt: { $exists: false }, closedAt: { $lte: new Date(now.getTime() - 60_000) } },
      { projection: { _id: 0 } },
    )
    .limit(50)
    .toArray();
  for (const c of overdue) {
    const name = await gameNameOf(c.gameKey);
    await awardChallengePoints(c, name);
  }
}

async function gameNameOf(key: string): Promise<string> {
  const entry = await gameCatalog().findOne({ key }, { projection: { _id: 0, name: 1 } });
  return entry?.name ?? 'Game challenge';
}

// ---------------------------------------------------------------- expiry

/**
 * Writes `expired` on every open challenge past its time and tells both
 * players. Reads already treat them as expired; this makes it true in the
 * database and reaches a page that is open. Nobody wins an expired challenge.
 */
export async function expireChallenges(now = new Date()): Promise<number> {
  const due = await gameChallenges()
    .find(
      {
        $or: [
          { status: 'pending', expiresAt: { $lte: now } },
          { status: 'accepted', expiresAt: { $lte: new Date(now.getTime() - FINISH_GRACE_MS) } },
        ],
      },
      { projection: { _id: 0, id: 1, status: 1 } },
    )
    .limit(200)
    .toArray();
  let expired = 0;
  for (const row of due) {
    const c = await gameChallenges().findOneAndUpdate(
      { id: row.id, status: row.status },
      { $set: { status: 'expired', closedAt: now, updatedAt: now } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    if (!c) continue;
    expired += 1;
    broadcast(c, 'expired');
  }
  await payOverdue(now);
  // The throttle's memory of challenges long gone.
  const stale = Date.now() - 10 * 60 * 1000;
  for (const [key, at] of lastLive) if (at < stale) lastLive.delete(key);
  return expired;
}

let sweeper: NodeJS.Timeout | undefined;
let sweeping = false;

export function startGameChallengeSweeper(intervalMs = 60_000) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    expireChallenges()
      .catch((error) => logger.error('Game challenge expiry sweep failed', {}, error))
      .finally(() => { sweeping = false; });
  }, intervalMs);
  sweeper.unref();
}

export function stopGameChallengeSweeper() {
  if (sweeper) clearInterval(sweeper);
  sweeper = undefined;
}
