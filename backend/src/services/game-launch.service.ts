import { getDb, connectPosts, gameCatalog, users } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import { resolveProfilePhoto } from './s3-connect-media.service';

/**
 * A timed game launch's own scoreboard: each player's best score in the
 * launch's game while it was on, one row per player per launch. Kept apart
 * from `game_scores`, which holds one all-time best per player and so cannot
 * say who played between a start and an end.
 */
interface GameLaunchScore {
  postId: string;
  org: string;
  gameKey: string;
  userId: string;
  playerName: string;
  score: number;
  achievedAt: Date;
}

const launchScores = () => getDb().collection<GameLaunchScore>('game_launch_scores');
let indexed: Promise<unknown> | null = null;
/** One row per player per launch: two first scores at once cannot make two. */
const ensureIndex = () =>
  (indexed ??= launchScores().createIndex({ postId: 1, userId: 1 }, { unique: true }).catch(() => (indexed = null)));

/** How long after the end a late round still counts, before the standings are kept. */
const SETTLE_MS = 2 * 60_000;

/**
 * A score just recorded in [gameKey]: it counts towards every timed launch
 * of that game in the company that is on right now. Never throws; a launch's
 * board is a nicety, not a reason to lose the score.
 */
export async function noteLaunchScore(
  gameKey: string,
  org: string,
  player: { userId: string; name: string },
  score: number,
  higherIsBetter: boolean,
): Promise<void> {
  try {
    await ensureIndex();
    const now = new Date();
    const at = now.toISOString();
    const launches = await connectPosts()
      .find(
        {
          org,
          type: 'game_launch',
          'body.gameKey': gameKey,
          'body.endsAt': { $gt: new Date(now.getTime() - SETTLE_MS).toISOString() },
          $or: [{ 'body.startsAt': { $exists: false } }, { 'body.startsAt': '' }, { 'body.startsAt': { $lte: at } }],
        },
        { projection: { _id: 0, id: 1 } },
      )
      .toArray();
    for (const launch of launches) {
      const key = { postId: launch.id, userId: player.userId };
      const better = higherIsBetter ? { score: { $lt: score } } : { score: { $gt: score } };
      const set = { org, gameKey, playerName: player.name, score, achievedAt: now };
      const raised = await launchScores().updateOne({ ...key, ...better }, { $set: set });
      if (raised.matchedCount > 0) continue;
      await launchScores()
        .updateOne(key, { $setOnInsert: { ...key, ...set } }, { upsert: true })
        .catch(() => undefined);
    }
  } catch {
    // The score itself is already kept.
  }
}

/**
 * The standings of a game launch whose end has passed: everyone who scored
 * while it was on, best first, ranked 1, 2, 2, 4 on a tie, with their face.
 * Worked out on each read until a little after the end (a round that ends on
 * the whistle still counts), then kept on the post for its window: change the
 * start or the end and they are worked out again. Null while it is still on,
 * or for an untimed launch.
 */
export async function gameLaunchResults(post: ConnectPost) {
  const body = post.body as Record<string, unknown>;
  const endsAt = typeof body.endsAt === 'string' ? body.endsAt : '';
  const ends = endsAt ? new Date(endsAt) : null;
  if (!ends || Number.isNaN(ends.getTime()) || ends.getTime() > Date.now()) return null;
  const window = `${typeof body.startsAt === 'string' ? body.startsAt : ''}|${endsAt}`;
  if (Array.isArray(body.results) && body.resultsWindow === window) return body.results;
  const key = typeof body.gameKey === 'string' ? body.gameKey : '';
  if (!key) return null;
  const game = await gameCatalog().findOne({ key }, { projection: { _id: 0, scoring: 1 } });
  const lowerWins = game?.scoring?.higherIsBetter === false;
  const rows = await launchScores()
    .find({ postId: post.id })
    .sort({ score: lowerWins ? 1 : -1, achievedAt: 1 })
    .limit(50)
    .toArray();
  const people = new Map(
    (
      await users()
        .find(
          { userId: { $in: rows.map((row) => row.userId) } },
          { projection: { _id: 0, userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 } },
        )
        .toArray()
    ).map((person) => [person.userId, person]),
  );
  let rank = 0;
  let last: number | undefined;
  const results = await Promise.all(
    rows.map(async (row, index) => {
      // Ranked on what is shown, so two equal-looking scores are a tie.
      const points = Math.round(row.score);
      if (points !== last) {
        rank = index + 1;
        last = points;
      }
      const person = people.get(row.userId);
      const name = person?.name || row.playerName || 'Player';
      return {
        userId: row.userId,
        name,
        initials: initialsOf(name),
        points,
        rank,
        photoUrl: person ? ((await resolveProfilePhoto(person).catch(() => undefined)) ?? null) : null,
      };
    }),
  );
  if (Date.now() > ends.getTime() + SETTLE_MS) {
    await connectPosts().updateOne({ id: post.id }, { $set: { 'body.results': results, 'body.resultsWindow': window } });
  }
  return results;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
