import { relayPresence, relayProgress } from '../config/db';
import { redisClient, redisReady } from '../config/redis';
import { RelayTeamProgress } from '../models/relay.model';
import { logger } from '../utils/logger';

/**
 * Where the live game is read from.
 *
 * Presence and progress are read many times a second by every connected
 * player. Reading them from the remote cluster made a single answer take over
 * a second, so they are served from Redis — or this process's memory when
 * Redis is not configured — and Mongo keeps the durable record.
 *
 * Mutations still go through Mongo's conditional update, which is what stops
 * two callers banking the same answer twice. That costs one write on a path
 * that runs a few hundred times an event, not a few hundred times a second.
 */

const PRESENCE_TTL_SECONDS = 120;
const PROGRESS_TTL_SECONDS = 6 * 60 * 60;

const memoryPresence = new Map<string, number>();
const memoryProgress = new Map<string, RelayTeamProgress>();

const presenceKey = (eventId: string, userId: string) => `relay:pres:${eventId}:${userId}`;
const progressKey = (eventId: string, teamId: string) => `relay:prog:${eventId}:${teamId}`;

/** Marks players as here. Cheap enough to run every tick for everyone. */
export async function markPresent(eventId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const seenAt = Date.now();
  const redis = redisReady() ? redisClient() : null;
  if (!redis) {
    for (const userId of userIds) memoryPresence.set(presenceKey(eventId, userId), seenAt);
    return;
  }
  try {
    const pipeline = redis.pipeline();
    for (const userId of userIds) {
      pipeline.set(presenceKey(eventId, userId), String(seenAt), 'EX', PRESENCE_TTL_SECONDS);
    }
    await pipeline.exec();
  } catch (error) {
    logger.error('Presence write failed, using memory', { eventId }, error);
    for (const userId of userIds) memoryPresence.set(presenceKey(eventId, userId), seenAt);
  }
}

/** When each of these players was last seen, as epoch millis. */
export async function presenceFor(
  eventId: string,
  userIds: string[],
): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  if (userIds.length === 0) return seen;
  const redis = redisReady() ? redisClient() : null;
  if (!redis) {
    for (const userId of userIds) {
      const at = memoryPresence.get(presenceKey(eventId, userId));
      if (at) seen.set(userId, at);
    }
    return seen;
  }
  try {
    const values = await redis.mget(userIds.map((userId) => presenceKey(eventId, userId)));
    values.forEach((value, index) => {
      if (value) seen.set(userIds[index], Number(value));
    });
    return seen;
  } catch (error) {
    logger.error('Presence read failed, using memory', { eventId }, error);
    for (const userId of userIds) {
      const at = memoryPresence.get(presenceKey(eventId, userId));
      if (at) seen.set(userId, at);
    }
    return seen;
  }
}

function reviveProgress(raw: string): RelayTeamProgress {
  const parsed = JSON.parse(raw) as RelayTeamProgress;
  // JSON has no dates; the clock arithmetic downstream needs real ones.
  return {
    ...parsed,
    questionStartedAt: new Date(parsed.questionStartedAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

/**
 * A team's progress, from the fast store, falling back to the durable one.
 *
 * A miss is normal — the first read after a restart, or after Redis was
 * cleared — and is filled from Mongo so the game carries on where it was.
 */
export async function readProgress(
  eventId: string,
  teamId: string,
): Promise<RelayTeamProgress | null> {
  const key = progressKey(eventId, teamId);
  const redis = redisReady() ? redisClient() : null;
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return reviveProgress(cached);
    } catch (error) {
      logger.error('Progress read failed, falling back to Mongo', { eventId, teamId }, error);
    }
  } else {
    const held = memoryProgress.get(key);
    if (held) return held;
  }
  const stored = await relayProgress().findOne({ eventId, teamId });
  if (stored) await cacheProgress(stored);
  return stored;
}

/** Records the authoritative copy in the fast store after it changes. */
export async function cacheProgress(progress: RelayTeamProgress): Promise<void> {
  const key = progressKey(progress.eventId, progress.teamId);
  const redis = redisReady() ? redisClient() : null;
  if (!redis) {
    memoryProgress.set(key, progress);
    return;
  }
  try {
    await redis.set(key, JSON.stringify(progress), 'EX', PROGRESS_TTL_SECONDS);
  } catch (error) {
    logger.error('Progress cache write failed', { teamId: progress.teamId }, error);
    memoryProgress.set(key, progress);
  }
}

/** Drops cached progress for an event, after anything that rewrites it wholesale. */
export async function forgetProgress(eventId: string): Promise<void> {
  const redis = redisReady() ? redisClient() : null;
  for (const key of [...memoryProgress.keys()]) {
    if (key.startsWith(`relay:prog:${eventId}:`)) memoryProgress.delete(key);
  }
  for (const key of [...memoryPresence.keys()]) {
    if (key.startsWith(`relay:pres:${eventId}:`)) memoryPresence.delete(key);
  }
  if (!redis) return;
  try {
    const keys = await redis.keys(`relay:prog:${eventId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch (error) {
    logger.error('Could not clear cached progress', { eventId }, error);
  }
}

/** Mirrors presence into Mongo so an admin view can read it without Redis. */
export async function persistPresence(eventId: string, userIds: string[], teamOf: Map<string, string>) {
  if (userIds.length === 0) return;
  const lastSeenAt = new Date();
  await relayPresence()
    .bulkWrite(
      userIds
        .filter((userId) => teamOf.has(userId))
        .map((userId) => ({
          updateOne: {
            filter: { eventId, userId },
            update: { $set: { eventId, userId, teamId: teamOf.get(userId) as string, lastSeenAt } },
            upsert: true,
          },
        })),
      { ordered: false },
    )
    .catch(() => undefined);
}
