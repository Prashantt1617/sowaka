import { MongoServerError } from 'mongodb';
import { companies, gameCatalog, gameScores } from '../config/db';
import { Company } from '../models/company.model';
import {
  DEFAULT_ENABLED_GAMES,
  GAME_KEY_PATTERN,
  GameCatalogEntry,
  GameScoring,
  catalogScoreId,
} from '../models/game-catalog.model';
import { User } from '../models/user.model';
import { challengeRewardsOf } from './game-challenge-rules';

export class GameCatalogError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'GameCatalogError';
  }
}

/** Who is asking: the signed-in person, as the auth middleware read them. */
export type GameViewer = Pick<User, 'userId' | 'name' | 'org'>;

/** What the app is told about a game. Never the page itself. */
export interface PublicGame {
  key: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string;
  kind: 'web' | 'native';
  accentColor?: string;
  backgroundColor?: string;
  order: number;
  thumbnail?: string;
  scoring: Pick<GameScoring, 'higherIsBetter' | 'label'> | null;
  /** The page is here, at GET /play/:key. */
  hasPage: boolean;
  /** Or it is hosted elsewhere, here. */
  hostedUrl?: string;
  /** Changes whenever the entry does, so the app knows its copy of the page is stale. */
  version: string;
}

/** A score is never larger than this, whatever the game says. */
const SCORE_CEILING = 1_000_000_000;
const LEADERBOARD_SIZE = 10;

/**
 * The games a company has: none without the Games tab, whatever its list
 * says, so a game switched on ahead of the tab is not playable (or paying
 * points) through the API meanwhile. With the tab, its own list when Sowaka
 * gave it one; otherwise the tab's original game, Gratitude Garden.
 */
export function enabledGamesOf(company: Pick<Company, 'enabledTabs' | 'enabledGames'> | null): string[] {
  if (!company?.enabledTabs?.includes('games')) return [];
  if (Array.isArray(company.enabledGames)) {
    return company.enabledGames.filter((key): key is string => typeof key === 'string');
  }
  return [...DEFAULT_ENABLED_GAMES];
}

async function gamesForOrg(org: string | undefined): Promise<string[]> {
  if (!org) return [];
  const company = await companies().findOne(
    { id: org },
    { projection: { _id: 0, enabledTabs: 1, enabledGames: 1 } },
  );
  return enabledGamesOf(company);
}

function versionOf(entry: Pick<GameCatalogEntry, 'updatedAt'>): string {
  const at = entry.updatedAt instanceof Date ? entry.updatedAt : new Date(entry.updatedAt);
  return Number.isNaN(at.getTime()) ? '0' : at.toISOString();
}

function toPublic(entry: GameCatalogEntry & { hasPage: boolean }): PublicGame {
  return {
    key: entry.key,
    name: entry.name,
    tagline: entry.tagline ?? '',
    description: entry.description ?? '',
    instructions: entry.instructions ?? '',
    kind: entry.kind,
    accentColor: entry.accentColor,
    backgroundColor: entry.backgroundColor,
    order: entry.order ?? 0,
    thumbnail: entry.thumbnail,
    scoring: entry.scoring
      ? { higherIsBetter: entry.scoring.higherIsBetter !== false, label: entry.scoring.label || 'points' }
      : null,
    hasPage: entry.hasPage,
    hostedUrl: entry.hasPage ? undefined : entry.hostedUrl,
    version: versionOf(entry),
  };
}

/** The viewer's company's games, active ones only, in order. Without their pages. */
export async function catalogFor(viewer: GameViewer): Promise<PublicGame[]> {
  const keys = await gamesForOrg(viewer.org);
  if (keys.length === 0) return [];
  const rows = await gameCatalog()
    .aggregate<GameCatalogEntry & { hasPage: boolean }>([
      { $match: { key: { $in: keys }, active: true } },
      { $sort: { order: 1, name: 1 } },
      {
        $addFields: {
          hasPage: {
            $cond: [
              { $eq: [{ $type: '$html' }, 'string'] },
              { $gt: [{ $strLenBytes: '$html' }, 0] },
              false,
            ],
          },
        },
      },
      { $project: { _id: 0, html: 0 } },
    ])
    .toArray();
  // A web game with nowhere to open it would be a card that does nothing.
  return rows.filter((row) => row.kind === 'native' || row.hasPage || !!row.hostedUrl).map(toPublic);
}

/**
 * The entry, provided it exists, is switched on, and is on the viewer's
 * company's list. A game the company does not have is refused, not hidden.
 */
async function requireGame(viewer: GameViewer, key: string, withHtml = false): Promise<GameCatalogEntry & { org: string }> {
  if (!GAME_KEY_PATTERN.test(key)) throw new GameCatalogError(404, 'Game not found');
  const keys = await gamesForOrg(viewer.org);
  if (!viewer.org || !keys.includes(key)) {
    throw new GameCatalogError(403, 'This game is not available for your company');
  }
  const entry = await gameCatalog().findOne(
    { key, active: true },
    { projection: withHtml ? { _id: 0 } : { _id: 0, html: 0 } },
  );
  if (!entry) throw new GameCatalogError(404, 'Game not found');
  return { ...entry, org: viewer.org };
}

/** A web game's page, for the app to load into its own screen. */
export async function pageFor(viewer: GameViewer, key: string): Promise<{ html: string; version: string }> {
  const entry = await requireGame(viewer, key, true);
  if (entry.kind !== 'web' || typeof entry.html !== 'string' || entry.html.length === 0) {
    throw new GameCatalogError(404, 'This game has no page here');
  }
  return { html: entry.html, version: versionOf(entry) };
}

function parseScore(raw: unknown, max: number): number {
  const score =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(score) || score < 0 || score > max) {
    throw new GameCatalogError(400, 'Score is invalid');
  }
  return Math.round(score);
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Keeps the person's best. Scores share `game_scores` with the dashboard's
 * hosted games, one row per person per game under `catalog:<key>`; the row
 * carries their company, so a board is one company's. Someone who has moved
 * company starts again on the new one's board.
 */
async function keepBest(
  key: string,
  org: string,
  viewer: GameViewer,
  score: number,
  higherIsBetter: boolean,
): Promise<boolean> {
  const gameId = catalogScoreId(key);
  const now = new Date();
  const set = { $set: { org, score, playerName: viewer.name, achievedAt: now, updatedAt: now } };
  const better = { gameId, userId: viewer.userId, org, score: higherIsBetter ? { $lt: score } : { $gt: score } };
  if ((await gameScores().updateOne(better, set)).modifiedCount > 0) return true;

  const existing = await gameScores().findOne({ gameId, userId: viewer.userId }, { projection: { _id: 0, org: 1 } });
  if (existing?.org === org) return false;
  if (existing) {
    return (await gameScores().updateOne({ gameId, userId: viewer.userId, org: existing.org }, set)).modifiedCount > 0;
  }
  try {
    await gameScores().insertOne({
      gameId, org, userId: viewer.userId, playerName: viewer.name, score, achievedAt: now, updatedAt: now,
    });
    return true;
  } catch (error) {
    // Two first scores at once: the other one landed; this one counts if it is better.
    if (isDuplicateKey(error)) return (await gameScores().updateOne(better, set)).modifiedCount > 0;
    throw error;
  }
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  playerName: string;
  score: number;
  achievedAt: Date;
  isMe: boolean;
}

export interface Leaderboard {
  scoring: { higherIsBetter: boolean; label: string };
  leaderboard: LeaderboardRow[];
  /** The viewer's own best and where it ranks; null before their first score. */
  me: { rank: number; score: number; achievedAt: Date } | null;
}

async function boardFor(key: string, org: string, viewerId: string, scoring: GameScoring): Promise<Leaderboard> {
  const gameId = catalogScoreId(key);
  const higherIsBetter = scoring.higherIsBetter !== false;
  const [rows, mine] = await Promise.all([
    gameScores()
      .find({ gameId, org })
      .sort({ score: higherIsBetter ? -1 : 1, achievedAt: 1 })
      .limit(LEADERBOARD_SIZE)
      .toArray(),
    gameScores().findOne({ gameId, org, userId: viewerId }),
  ]);
  let me: Leaderboard['me'] = null;
  if (mine) {
    // Ahead of them: a better score, or the same one reached earlier.
    const ahead = await gameScores().countDocuments({
      gameId,
      org,
      $or: [
        { score: higherIsBetter ? { $gt: mine.score } : { $lt: mine.score } },
        { score: mine.score, achievedAt: { $lt: mine.achievedAt } },
      ],
    });
    me = { rank: ahead + 1, score: mine.score, achievedAt: mine.achievedAt };
  }
  return {
    scoring: { higherIsBetter, label: scoring.label || 'points' },
    leaderboard: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      playerName: row.playerName,
      score: row.score,
      achievedAt: row.achievedAt,
      isMe: row.userId === viewerId,
    })),
    me,
  };
}

function requireScoring(entry: GameCatalogEntry): GameScoring {
  if (!entry.scoring) throw new GameCatalogError(400, 'This game does not keep scores');
  return entry.scoring;
}

/**
 * A game the viewer's company has, that keeps scores where higher is better:
 * the only kind two people can be challenged to compare. With its name, and
 * the largest score it allows.
 */
export async function requireChallengeGame(viewer: GameViewer, key: string) {
  const entry = await requireGame(viewer, key);
  const scoring = requireScoring(entry);
  if (scoring.higherIsBetter === false) throw new GameCatalogError(400, 'This game has no challenges');
  return {
    key: entry.key,
    name: entry.name,
    org: entry.org,
    maxScore: Math.min(scoring.max ?? SCORE_CEILING, SCORE_CEILING),
    rewards: challengeRewardsOf(entry.challengeRewards),
  };
}

/** Records a score; the person's best is what stays. Answers with the board as it now is. */
export async function submitScore(viewer: GameViewer, key: string, raw: unknown) {
  const entry = await requireGame(viewer, key);
  const scoring = requireScoring(entry);
  const score = parseScore(raw, Math.min(scoring.max ?? SCORE_CEILING, SCORE_CEILING));
  const improved = await keepBest(key, entry.org, viewer, score, scoring.higherIsBetter !== false);
  return { score, improved, ...(await boardFor(key, entry.org, viewer.userId, scoring)) };
}

/** The company's top ten, and the viewer's own best. */
export async function leaderboardFor(viewer: GameViewer, key: string): Promise<Leaderboard> {
  const entry = await requireGame(viewer, key);
  return boardFor(key, entry.org, viewer.userId, requireScoring(entry));
}
