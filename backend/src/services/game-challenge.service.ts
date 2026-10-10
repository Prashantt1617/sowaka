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
import { MongoServerError, type Collection, type Filter } from 'mongodb';
import { gameCatalog, gameChallenges, getDb, users } from '../config/db';
import {
  OPEN_CHALLENGE_STATUSES,
  type ChallengeRewardRules,
  type GameChallenge,
  type GameChallengeAward,
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
  challengeRewardsOf,
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
  playedLongEnough,
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
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = 330 * 60 * 1000;
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

/**
 * Whether the viewer plays in `c` and is still at its company: someone who
 * has moved on is told it does not exist, so a challenge never crosses companies.
 */
const playsIn = (c: GameChallenge, viewer: ChallengeViewer) =>
  isParticipant(c, viewer.userId) && c.org === orgOf(viewer);

/** The challenge, provided the viewer may do `action` to it now. */
async function loadFor(viewer: ChallengeViewer, id: string, action: Parameters<typeof challengeMay>[0]) {
  const c = await load(id);
  if (!playsIn(c, viewer)) throw new GameChallengeError(404, 'Challenge not found');
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
        org: orgOf(viewer),
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

/** Each game's largest score, as its catalog entry says, kept a minute: live scores come a couple a second. */
const maxScores = new Map<string, { max: number; at: number }>();

async function maxScoreOf(key: string): Promise<number> {
  const kept = maxScores.get(key);
  if (kept && Date.now() - kept.at < 60_000) return kept.max;
  const entry = await gameCatalog().findOne({ key }, { projection: { _id: 0, scoring: 1 } });
  const max = Math.min(entry?.scoring?.max ?? SCORE_CEILING, SCORE_CEILING);
  maxScores.set(key, { max, at: Date.now() });
  return max;
}

/** When each player last had a live score passed on, by `${challengeId}:${userId}`. */
const lastLive = new Map<string, number>();

/**
 * A score mid-round, passed straight to the other player and kept on the
 * challenge for whoever opens it later. Updates closer together than
 * LIVE_MIN_INTERVAL_MS are dropped (the page sends at most a couple a second).
 */
export async function reportLive(viewer: ChallengeViewer, id: string, raw: unknown) {
  const c = await loadFor(viewer, id, 'live');
  const score = parseChallengeScore(raw, await maxScoreOf(c.gameKey));
  if (score === null) throw new GameChallengeError(400, 'Score is invalid');
  if (!c.started?.[viewer.userId]) {
    // The page reports as the round begins: when it began, for the final to be measured against.
    await gameChallenges().updateOne(
      { id: c.id, status: 'accepted', [`started.${viewer.userId}`]: { $exists: false } },
      { $set: { [`started.${viewer.userId}`]: new Date() } },
    );
  }
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
 * Posting again returns the challenge as it is, so a retry is harmless — and
 * finishes it, if the first try stopped short of that.
 */
export async function finishChallenge(viewer: ChallengeViewer, id: string, raw: unknown) {
  const existing = await load(id);
  if (!playsIn(existing, viewer)) throw new GameChallengeError(404, 'Challenge not found');
  if (existing.scores?.[viewer.userId]) {
    if (existing.status === 'accepted' && resultOfBoth(existing)) {
      const done = await settle(existing, await rulesOf(existing.gameKey), viewer.userId);
      return toView(done ?? (await load(id)), viewer.userId);
    }
    return toView(existing, viewer.userId);
  }
  const decision = challengeMay('finish', viewer.userId, existing, new Date());
  if (!decision.ok) refuse(decision);
  const game = await requireChallengeGame(viewer, existing.gameKey);
  const score = parseChallengeScore(raw, game.maxScore);
  if (score === null) throw new GameChallengeError(400, 'Score is invalid');
  const now = new Date();
  const long = playedLongEnough(existing, viewer.userId, game.rewards, now);
  if (!long.ok) refuse(long);

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
  const done = await settle(scored, game, viewer.userId, now);
  return toView(done ?? (await load(id)), viewer.userId, now);
}

/** What settling a game's challenges needs from its catalog entry. */
type SettleRules = { name: string; rewards: ChallengeRewardRules };

/** A game's name and reward rules straight from the catalog, for settling when nobody's access is being checked. */
async function rulesOf(key: string): Promise<SettleRules> {
  const entry = await gameCatalog().findOne({ key }, { projection: { _id: 0, name: 1, challengeRewards: 1 } });
  return { name: entry?.name ?? 'Game challenge', rewards: challengeRewardsOf(entry?.challengeRewards) };
}

/**
 * Finishes an accepted challenge both have played: decides the awards, holds
 * the day's places they need, moves it to finished, pays, and tells both
 * players. Only one caller gets to move it, and only that one pays; null for
 * the others. Whoever is `watching` sees the result on screen; everyone else
 * gets a push.
 */
async function settle(c: GameChallenge, game: SettleRules, watching?: string, now = new Date()): Promise<GameChallenge | null> {
  const payout = computeAwards(c, game.rewards, await paidToday(c, now));
  if (!payout) return null;
  const { awards, held } = await holdPlaces(c, payout.awards, game.rewards, now);
  const reward = awards.find((award) => award.kind === 'win') ?? null;
  const done = await gameChallenges().findOneAndUpdate(
    { id: c.id, status: 'accepted' },
    { $set: { status: 'finished', closedAt: now, updatedAt: now, reward, awards } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!done) {
    await givePlacesBack(held);
    return null;
  }
  // The result stands whatever happens to the payment; the sweep pays anything left unpaid.
  await awardChallengePoints(done, game.name).catch((error) =>
    logger.error('Game challenge award failed', { challengeId: c.id }, error));
  broadcast(done, 'finished');
  for (const userId of [done.challengerUserId, done.opponentUserId]) {
    if (userId === watching) continue;
    const line = resultLine(done, userId);
    if (!line) continue;
    const earned = (done.awards ?? []).find((a) => a.userId === userId);
    push(
      userId,
      'game_challenge_result',
      line,
      earned && earned.points > 0
        ? `${game.name}: +${earned.points} point${earned.points === 1 ? '' : 's'}.`
        : `${game.name}: rematch?`,
      done,
    );
  }
  return done;
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

// ---------------------------------------------------------------- the day's places

/**
 * How many paid awards each person has had today, kept as counters that only
 * move atomically. `paidToday` reads finished challenges, which two finishes
 * at the same moment both read before either is written; these are what stop
 * both from being paid past the cap.
 */
interface PlaceTally {
  _id: string;
  count: number;
  expiresAt: Date;
}

function placeTallies(): Collection<PlaceTally> {
  return getDb().collection<PlaceTally>('game_challenge_places');
}

let placeIndexes: Promise<unknown> | null = null;

/** Made on first use; a failure is retried next time. Counters go two days after their day. */
function ensurePlaceIndexes(): Promise<unknown> {
  placeIndexes ??= placeTallies()
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error) => {
      placeIndexes = null;
      logger.warn('Game challenge place index could not be made', {}, error);
    });
  return placeIndexes;
}

/** One of today's `cap` places under `key`, or false when they are all taken. */
async function takePlace(key: string, cap: number, now: Date): Promise<boolean> {
  if (cap <= 0) return false;
  await ensurePlaceIndexes();
  try {
    // No room left: the filter misses, the upsert collides with the full counter, and that is the answer.
    await placeTallies().updateOne(
      { _id: key, count: { $lt: cap } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(istDayStart(now).getTime() + 2 * DAY_MS) } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

async function givePlacesBack(keys: string[]) {
  if (keys.length === 0) return;
  await placeTallies()
    .updateMany({ _id: { $in: keys }, count: { $gt: 0 } }, { $inc: { count: -1 } })
    .catch((error) => logger.warn('Game challenge places could not be given back', { keys }, error));
}

/**
 * The awards as the day's places allow: each paid award takes its place
 * (a win, its place over this opponent too); one that finds none left is
 * kept at zero with why, as `computeAwards` would have.
 */
async function holdPlaces(
  c: GameChallenge,
  awards: GameChallengeAward[],
  rules: ChallengeRewardRules,
  now: Date,
): Promise<{ awards: GameChallengeAward[]; held: string[] }> {
  // The India date, as people there call the day: its midnight is the evening before in UTC.
  const day = new Date(istDayStart(now).getTime() + IST_MS).toISOString().slice(0, 10);
  const held: string[] = [];
  const out: GameChallengeAward[] = [];
  for (const award of awards) {
    if (award.points <= 0) {
      out.push(award);
      continue;
    }
    if (award.kind === 'participation') {
      const key = `${day}|${c.gameKey}|participation|${award.userId}`;
      if (await takePlace(key, rules.dailyWinCap, now)) {
        held.push(key);
        out.push(award);
      } else {
        out.push({ ...award, points: 0, capped: 'daily_limit' });
      }
      continue;
    }
    const winKey = `${day}|${c.gameKey}|win|${award.userId}`;
    if (!(await takePlace(winKey, rules.dailyWinCap, now))) {
      out.push({ ...award, points: 0, capped: 'daily_limit' });
      continue;
    }
    const pairKey = `${day}|${c.gameKey}|pair|${award.userId}|${otherPlayer(c, award.userId)}`;
    if (!(await takePlace(pairKey, rules.samePairPerDay, now))) {
      await givePlacesBack([winKey]);
      out.push({ ...award, points: 0, capped: 'same_pair' });
      continue;
    }
    held.push(winKey, pairKey);
    out.push(award);
  }
  return { awards: out, held };
}

// ---------------------------------------------------------------- points

/**
 * Pays a finished challenge's awards into engagement points: `User.points`,
 * and a row each in the points ledger (source `game_challenge`, the
 * challenge as its ref). The only place challenge points are paid.
 *
 * Pays once: each award is claimed (`paidAt`) before its points move, and
 * given back if they could not, so a retry, a second request or the sweep
 * pays only what is still unpaid. The history is written once, by whoever
 * marks the whole challenge paid (`awardedAt`).
 */
export async function awardChallengePoints(c: GameChallenge, gameName: string): Promise<void> {
  const current = await gameChallenges().findOne(
    { id: c.id, status: 'finished', awardedAt: { $exists: false } },
    { projection: { _id: 0 } },
  );
  if (!current) return;
  for (const award of current.awards ?? []) {
    if (award.points <= 0 || award.paidAt) continue;
    const claim = await gameChallenges().updateOne(
      { id: c.id, awards: { $elemMatch: { userId: award.userId, paidAt: { $exists: false } } } },
      { $set: { 'awards.$.paidAt': new Date() } },
    );
    if (claim.modifiedCount === 0) continue;
    try {
      await users().updateOne({ userId: award.userId }, { $inc: { points: award.points } });
    } catch (error) {
      await gameChallenges()
        .updateOne({ id: c.id, 'awards.userId': award.userId }, { $unset: { 'awards.$.paidAt': '' } })
        .catch(() => {});
      throw error;
    }
  }
  const claimed = await gameChallenges().findOneAndUpdate(
    { id: c.id, status: 'finished', awardedAt: { $exists: false } },
    { $set: { awardedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!claimed) return;
  const awards = claimed.awards ?? [];
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
      { projection: { _id: 0 } },
    )
    .limit(200)
    .toArray();
  let expired = 0;
  for (const row of due) {
    // Both played, but the second final stopped short of finishing it: it finishes now, not expires.
    if (row.status === 'accepted' && resultOfBoth(row)) {
      await settle(row, await rulesOf(row.gameKey), undefined, now);
      continue;
    }
    const c = await gameChallenges().findOneAndUpdate(
      {
        id: row.id,
        status: row.status,
        // A final that lands meanwhile makes it one to settle on the next sweep, not expire.
        ...(row.status === 'accepted'
          ? { $or: [{ [`scores.${row.challengerUserId}`]: { $exists: false } }, { [`scores.${row.opponentUserId}`]: { $exists: false } }] }
          : {}),
      },
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
