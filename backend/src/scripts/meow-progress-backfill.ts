/**
 * Gives Meow's players back the level their best score proves.
 *
 * Until the server kept Meow's level (`game_progress`, game-progress.service)
 * the level lived only in the phone's WebView, so anyone whose WebView was
 * cleared went back to level 1. Their best score is still in `game_scores`
 * (gameId `catalog:meowdoku` / `catalog:meow-test`), and a solved level L
 * scores at most 2·(400 + 25·L), so a best of s proves a level with
 * 400 + 25·L ≥ s/2 was solved: the player is on at least
 * 1 + max(0, ceil((s/2 − 400)/25)), capped at 60 (levelFromBestScore).
 *
 * Only ever raises a level: a row already higher (the page reported it) is
 * left alone, and running it again changes nothing.
 *
 * Run from backend/ with the server's .env (MONGODB_URI, MONGODB_DB), after
 * the backend that has `game_progress` is live (it builds the index):
 *
 *   node dist/scripts/meow-progress-backfill.js           # dry run: what it would write, per org
 *   node dist/scripts/meow-progress-backfill.js --apply   # write it
 *
 * In a checkout without a build: `npx tsx src/scripts/meow-progress-backfill.ts [--apply]`.
 */
import { MongoClient, type AnyBulkWriteOperation, type Db } from 'mongodb';
import { env } from '../config/env';
import type { GameProgress } from '../models/game-progress.model';
import { levelFromBestScore } from '../services/game-progress.service';

export const BACKFILL_GAMES = ['meowdoku', 'meow-test'] as const;

export interface BackfillRow {
  org: string;
  userId: string;
  gameKey: string;
  score: number;
  /** What the score proves. */
  level: number;
  /** What is stored now, 0 for none. */
  stored: number;
}

/** Every Meow best score with the level it proves and what is stored; `write` is true where the backfill would raise it. */
export async function planBackfill(db: Db): Promise<Array<BackfillRow & { write: boolean }>> {
  const gameIds = BACKFILL_GAMES.map((key) => `catalog:${key}`);
  const scores = await db
    .collection<{ gameId: string; org: string; userId: string; score: number }>('game_scores')
    .find({ gameId: { $in: gameIds } }, { projection: { _id: 0, gameId: 1, org: 1, userId: 1, score: 1 } })
    .toArray();
  const progress = await db
    .collection<GameProgress>('game_progress')
    .find({ gameKey: { $in: [...BACKFILL_GAMES] } }, { projection: { _id: 0, org: 1, userId: 1, gameKey: 1, level: 1 } })
    .toArray();
  const held = new Map(progress.map((p) => [`${p.org}|${p.userId}|${p.gameKey}`, p.level]));
  return scores
    .filter((s) => typeof s.org === 'string' && s.org && typeof s.userId === 'string' && s.userId)
    .map((s) => {
      const gameKey = s.gameId.slice('catalog:'.length);
      const level = levelFromBestScore(Number(s.score));
      const stored = held.get(`${s.org}|${s.userId}|${gameKey}`) ?? 0;
      return { org: s.org, userId: s.userId, gameKey, score: Number(s.score), level, stored, write: level > stored };
    });
}

/** Writes the plan's raises, each `$max`, so a level reported meanwhile is never lowered. The count written. */
export async function applyBackfill(db: Db, plan: Array<BackfillRow & { write: boolean }>, now = new Date()): Promise<number> {
  const ops: AnyBulkWriteOperation<GameProgress>[] = plan
    .filter((r) => r.write)
    .map((r) => ({
      updateOne: {
        filter: { org: r.org, userId: r.userId, gameKey: r.gameKey },
        update: { $max: { level: r.level }, $set: { updatedAt: now } },
        upsert: true,
      },
    }));
  if (!ops.length) return 0;
  const result = await db.collection<GameProgress>('game_progress').bulkWrite(ops, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
}

/** One line per org and game: players, how many it raises, and the levels as `level×players`. */
export function summarise(plan: Array<BackfillRow & { write: boolean }>): string[] {
  const groups = new Map<string, Array<BackfillRow & { write: boolean }>>();
  for (const row of plan) {
    const k = `${row.org}\t${row.gameKey}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const lines = [['org', 'game', 'players', 'raised', 'levels (level×players, after)'].join('\t')];
  for (const [k, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const dist = new Map<number, number>();
    for (const r of rows) {
      const after = Math.max(r.level, r.stored);
      dist.set(after, (dist.get(after) ?? 0) + 1);
    }
    const levels = [...dist].sort(([a], [b]) => a - b).map(([l, n]) => `${l}×${n}`).join(' ');
    lines.push([k, rows.length, rows.filter((r) => r.write).length, levels].join('\t'));
  }
  return lines;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(env.mongoUri);
  await client.connect();
  try {
    const db = client.db(env.mongoDbName);
    const plan = await planBackfill(db);
    console.log(`Database ${env.mongoDbName}: ${plan.length} Meow best scores, ${plan.filter((r) => r.write).length} levels to raise.\n`);
    for (const line of summarise(plan)) console.log(line);
    if (!apply) {
      console.log('\nDry run: nothing written. Run again with --apply to write it.');
      return;
    }
    const written = await applyBackfill(db, plan);
    console.log(`\nWritten: ${written} game_progress rows raised.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
