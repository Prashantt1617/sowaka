/**
 * Kept answers dropped in every process, not only the one that took the write.
 *
 * The kept answers (swr-cache.ts: the lifecycle boards, Time office lists, Suwi's company bundle,
 * People and payroll copies; engagement-cache.ts) live in each process's memory and are dropped by
 * the writes that change them. With one process that is all there is. In a blue/green deploy the
 * new process warms itself while the old one still takes every write (docs/deploy/bluegreen.md):
 * without this, a board the new one read before an HR change would be served after the switch.
 *
 * Each drop is published on one Redis channel; every other process applies the same drop to its
 * own memory (a patch is applied as a drop: the cheap, always-correct side). A process ignores its
 * own messages. Without Redis nothing is sent and nothing changes: one process needs none of it.
 */
import type Redis from 'ioredis';
import { redisClient, redisReady } from '../config/redis';
import { logger } from '../utils/logger';
import { instanceId } from '../utils/instance';

export const CACHE_BUS_CHANNEL = 'sowaka:cache-drop';

export type CacheDrop =
  | { op: 'swr-drop'; org: string | null; kinds: string[] }
  | { op: 'swr-person'; org: string; kinds: string[]; userId: string }
  | { op: 'swr-forget'; org: string; kinds: string[] }
  | { op: 'swr-forget-except'; org: string; except: string[] }
  | { op: 'engagement'; org: string; kinds: string[] };

type Handler = (drop: CacheDrop) => void;

const handlers: Handler[] = [];
let on = false;
let applying = false;
let sub: Redis | null = null;
export const cacheBusStats = { sent: 0, applied: 0 };

/** The caches' own way to apply a drop that came from another process (registered at import). */
export function onRemoteDrop(handler: Handler): void {
  handlers.push(handler);
}

/** Tells the other processes about a drop just made here. Not while applying one of theirs. */
export function publishDrop(drop: CacheDrop): void {
  if (!on || applying) return;
  const redis = redisReady() ? redisClient() : null;
  if (!redis) return;
  cacheBusStats.sent += 1;
  redis.publish(CACHE_BUS_CHANNEL, JSON.stringify({ from: instanceId, ...drop })).catch(() => undefined);
}

/** Applies a drop from another process to this one's memory, without sending it on. */
export function applyRemoteDrop(drop: CacheDrop): void {
  applying = true;
  try {
    for (const handler of handlers) handler(drop);
    cacheBusStats.applied += 1;
  } catch (error) {
    logger.error('Cache bus: a drop from another process failed to apply', { op: drop.op }, error);
  } finally {
    applying = false;
  }
}

/** The API server starts it (server.ts); scripts and checks never do, so they send nothing. */
export async function startCacheBus(): Promise<boolean> {
  if (on) return true;
  const base = redisClient();
  if (!base) return false;
  on = true;
  // A subscriber connection of its own: one in subscribe mode can run nothing else.
  sub = base.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  sub.on('error', (error) => logger.warn('Cache bus: Redis subscriber error', { error: (error as Error).message }));
  sub.on('message', (_channel: string, message: string) => {
    let parsed: (CacheDrop & { from?: string }) | null = null;
    try { parsed = JSON.parse(message) as CacheDrop & { from?: string }; } catch { return; }
    if (!parsed || parsed.from === instanceId) return;
    applyRemoteDrop(parsed);
  });
  try {
    await sub.subscribe(CACHE_BUS_CHANNEL);
    return true;
  } catch (error) {
    logger.warn('Cache bus: could not subscribe; drops stay in this process', { error: (error as Error).message });
    return false;
  }
}

export async function stopCacheBus(): Promise<void> {
  on = false;
  const s = sub;
  sub = null;
  if (s) await s.quit().catch(() => undefined);
}
