import { gameProgress } from '../config/db';

/**
 * Meow's level, kept on the server.
 *
 * The page used to keep the level only in the WebView's localStorage, so a
 * new phone, a reinstall or a cleared WebView sent the player back to level
 * 1. Now `/play/<key>` writes the stored level into the page
 * (`window.__SOWAKA_PROGRESS`), the page takes whichever is higher, its own
 * or the server's, and reports each new level back with a `progress` ticket.
 * The stored level is the next level the person will play and never goes
 * down: a stale phone reporting an old level changes nothing.
 */

/** The catalog games that keep a level here. Every other page is served exactly as before. */
export const PROGRESS_GAMES: ReadonlySet<string> = new Set(['meowdoku', 'meow-test']);

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 999;

/** A level as reported: a whole number from 1 to 999, else null. */
export function parseLevel(raw: unknown): number | null {
  const n = typeof raw === 'string' && /^\d{1,4}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_LEVEL && n <= MAX_LEVEL ? n : null;
}

/** The stored level, or 0 when the person has none yet. */
export async function storedLevel(org: string, userId: string, gameKey: string): Promise<number> {
  const row = await gameProgress().findOne({ org, userId, gameKey }, { projection: { _id: 0, level: 1 } });
  return typeof row?.level === 'number' ? row.level : 0;
}

/**
 * Keeps the higher of the stored level and `level`, in one write: `$max`
 * never lowers it, and the upsert makes the first report the row. Two reports
 * racing to create the row meet the unique index; the loser retries once and
 * finds the row there.
 */
export async function raiseLevel(org: string, userId: string, gameKey: string, level: number, now = new Date()): Promise<void> {
  const write = () =>
    gameProgress().updateOne(
      { org, userId, gameKey },
      { $max: { level }, $set: { updatedAt: now } },
      { upsert: true },
    );
  try {
    await write();
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
    await write();
  }
}

// ---------------------------------------------------------------- a light rate limit

/** Reports one person may make per minute. A player finishes a level a minute at the very fastest. */
export const REPORTS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const recent = new Map<string, { start: number; count: number }>();

/** True while `who` is within REPORTS_PER_MINUTE in the current minute; counts this report. In memory, per instance. */
export function withinRate(who: string, now = Date.now()): boolean {
  const seen = recent.get(who);
  if (!seen || now - seen.start >= WINDOW_MS) {
    if (recent.size > 10_000) {
      for (const [k, v] of recent) if (now - v.start >= WINDOW_MS) recent.delete(k);
    }
    recent.set(who, { start: now, count: 1 });
    return true;
  }
  seen.count += 1;
  return seen.count <= REPORTS_PER_MINUTE;
}

/** For checks: forgets every count. */
export function resetRate(): void {
  recent.clear();
}

// ---------------------------------------------------------------- the backfill's rule

/** The level a backfill may cap at: the page's base score stops growing at 60. */
export const BACKFILL_MAX_LEVEL = 60;

/**
 * The level a best score proves. A solved level L scores at most twice its
 * base, base(L) = 400 + 25·L (meowdoku.html `baseFor`/`worthOf`), so a best of
 * s means a level L with 400 + 25·L ≥ s/2 was solved, and the player is on at
 * least the one after it: 1 + max(0, ceil((s/2 − 400)/25)), from 1 to 60.
 */
export function levelFromBestScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return MIN_LEVEL;
  const solved = Math.max(0, Math.ceil((score / 2 - 400) / 25));
  return Math.min(BACKFILL_MAX_LEVEL, Math.max(MIN_LEVEL, 1 + solved));
}
