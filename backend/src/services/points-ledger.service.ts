import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import type { PointEvent, PointSource } from '../models/points.model';
import { logger } from '../utils/logger';

/**
 * The history behind `User.points`: one row per change, written by whatever
 * moved the balance. Kept here rather than in `config/db` so the ledger is one
 * file to read.
 */
export function pointEvents(): Collection<PointEvent> {
  return getDb().collection<PointEvent>('point_events');
}

let indexes: Promise<unknown> | null = null;

/**
 * Made on first use rather than at boot. A failure is retried on the next
 * write instead of being remembered.
 */
function ensurePointIndexes(): Promise<unknown> {
  indexes ??= pointEvents()
    .createIndexes([
      // One person's month, for their credit history.
      { key: { userId: 1, createdAt: -1 } },
      // An org's month, for how far everyone has moved since it began.
      { key: { org: 1, createdAt: -1 } },
    ])
    .catch((error) => {
      indexes = null;
      logger.warn('Point ledger indexes could not be made', {}, error);
    });
  return indexes;
}

export type PointChange = Omit<PointEvent, 'id' | 'createdAt'>;

/** The ledger's name for a Connect challenge, by its post type. */
export function challengePointSource(postType: string): PointSource {
  switch (postType) {
    case 'photo_story_challenge':
    case 'most_likely':
      return postType;
    default:
      return 'caption_challenge';
  }
}

/**
 * Records changes to people's points. Call it beside the `$inc` that made
 * them.
 *
 * Never throws and never holds the caller up: the balance has already moved by
 * the time this runs, and a vote must not fail because its history could not
 * be written. A lost row costs one line of someone's activity, not their
 * points.
 */
export function recordPointChanges(
  changes: PointChange[],
  /** Keep rows that moved nothing — a game played for no points still belongs in the history. */
  options: { keepZero?: boolean } = {},
): void {
  const rows: PointEvent[] = changes
    .filter(
      (change) =>
        change.userId && Number.isFinite(change.delta) && (options.keepZero || change.delta !== 0),
    )
    .map((change) => ({ ...change, id: randomUUID(), createdAt: new Date() }));
  if (rows.length === 0) return;
  void (async () => {
    try {
      await ensurePointIndexes();
      await pointEvents().insertMany(rows, { ordered: false });
    } catch (error) {
      logger.warn('Point ledger write failed', { rows: rows.length }, error);
    }
  })();
}
