import Redis from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Redis, when it is configured.
 *
 * The game's live state — who is present, where each team has got to — is read
 * many times a second and is worthless once the event ends. Holding it here
 * keeps it off a remote cluster where a single read can cost hundreds of
 * milliseconds, and keeps it correct when more than one server is answering.
 *
 * Without REDIS_URL the game falls back to this process's own memory. That is
 * degraded rather than broken: correct while one server is running, and the
 * alternative to 220 people watching a frozen screen if Redis is unreachable.
 */
let client: Redis | null = null;
let announcedFailure = false;

export function redisClient(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  client = new Redis(url, {
    // A game cannot wait on a retry storm; fail fast and use memory instead.
    connectTimeout: 3000,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  client.on('error', (error) => {
    if (announcedFailure) return;
    announcedFailure = true;
    logger.error('Redis unavailable — the relay falls back to in-process state', {}, error);
  });
  client.on('ready', () => {
    announcedFailure = false;
    logger.info('Redis ready', {});
  });
  return client;
}

/** True only when Redis is configured and currently usable. */
export function redisReady(): boolean {
  const redis = redisClient();
  return Boolean(redis && redis.status === 'ready');
}

/**
 * A connection for the socket backplane.
 *
 * Deliberately not the same options as the game's client. The adapter
 * subscribes the moment it is constructed, before the socket is up, so it
 * needs commands queued rather than rejected — failing fast is right for a
 * game read, and fatal for a subscription that has not connected yet.
 */
export function redisPubSubPair(): { pub: Redis; sub: Redis } | null {
  const base = redisClient();
  if (!base) return null;
  const options = { enableOfflineQueue: true, maxRetriesPerRequest: null } as const;
  const pub = base.duplicate(options);
  const sub = base.duplicate(options);
  // Without these a dropped Redis takes the process down with it.
  pub.on('error', (error) => logger.error('Redis publisher error', {}, error));
  sub.on('error', (error) => logger.error('Redis subscriber error', {}, error));
  return { pub, sub };
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  await client.quit().catch(() => undefined);
  client = null;
}
