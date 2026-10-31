import type Redis from 'ioredis';
import { redisClient, redisReady } from '../config/redis';
import type { PokerTable } from '../models/poker.model';
import type { QueueEntry } from './poker-floor';
import { logger } from '../utils/logger';

/**
 * Where live Speed Poker state sits: Redis, or this process's memory when
 * Redis is not configured, as Tile Up's rooms do (`tileup-store.ts`). Two
 * kinds of record, each changed by read, change and compare-and-set:
 *   - a table, for its life (a final runs 30 minutes, kept a day);
 *   - an event's floor: the queue, who sits where, and cooldowns.
 * Results, picks and hands go to Mongo; nothing here is the only copy of
 * anything that matters after the day.
 */

const TTL_SECONDS = 24 * 60 * 60;

export interface PokerFloor {
  eventId: string;
  queue: QueueEntry[];
  /** Who sits at which table now. */
  seats: Record<string, string>;
  /** When each person may queue again. */
  cooldownUntil: Record<string, number>;
  version: number;
}

const tableKey = (id: string) => `poker:table:${id}`;
const floorKey = (eventId: string) => `poker:floor:${eventId}`;
const lockKey = (name: string) => `poker:lock:${name}`;
const LIVE_KEY = 'poker:live';

const memory = new Map<string, string>();
const memoryLive = new Set<string>();
const memoryQueues = new Map<string, Promise<unknown>>();
const memoryLocks = new Map<string, number>();

const redis = (): Redis | null => (redisReady() ? redisClient() : null);

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if (current == false and ARGV[1] == '') or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export class PokerStoreConflict extends Error {
  constructor() {
    super('The record changed under us');
    this.name = 'PokerStoreConflict';
  }
}

async function read<T>(key: string): Promise<T | null> {
  const client = redis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      logger.error('Poker read failed', { key }, error);
    }
  }
  const raw = memory.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function create<T>(key: string, value: T): Promise<boolean> {
  const raw = JSON.stringify(value);
  const client = redis();
  if (client) {
    try {
      return (await client.set(key, raw, 'EX', TTL_SECONDS, 'NX')) === 'OK';
    } catch (error) {
      logger.error('Poker create failed, using memory', { key }, error);
    }
  }
  if (memory.has(key)) return false;
  memory.set(key, raw);
  return true;
}

/**
 * Reads the record, lets `change` alter it, and writes it back only if
 * nobody else wrote in between; else reads again, a few times. `change`
 * returning null writes nothing. [init] makes the record when there is none.
 */
async function mutate<T, R>(key: string, change: (value: T) => R | null, init?: () => T): Promise<{ value: T; result: R } | null> {
  const client = redis();
  if (client) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let before: string | null;
      try {
        before = await client.get(key);
      } catch (error) {
        logger.error('Poker read failed', { key }, error);
        return memoryMutate(key, change, init);
      }
      if (!before && !init) return null;
      const value = before ? (JSON.parse(before) as T) : init!();
      const result = change(value);
      if (result === null) return null;
      try {
        const written = await client.eval(CAS_SCRIPT, 1, key, before ?? '', JSON.stringify(value), String(TTL_SECONDS));
        if (written === 1) return { value, result };
      } catch (error) {
        logger.error('Poker write failed', { key }, error);
        return memoryMutate(key, change, init);
      }
    }
    throw new PokerStoreConflict();
  }
  return memoryMutate(key, change, init);
}

function memoryMutate<T, R>(key: string, change: (value: T) => R | null, init?: () => T): Promise<{ value: T; result: R } | null> {
  const previous = memoryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(() => {
    const before = memory.get(key);
    if (!before && !init) return null;
    const value = before ? (JSON.parse(before) as T) : init!();
    const result = change(value);
    if (result === null) return null;
    memory.set(key, JSON.stringify(value));
    return { value, result };
  });
  memoryQueues.set(key, run.catch(() => undefined));
  return run;
}

// ------------------------------------------------------------------ tables

export const readTable = (id: string) => read<PokerTable>(tableKey(id));

export async function createTable(table: PokerTable): Promise<boolean> {
  const made = await create(tableKey(table.id), table);
  if (made) await addLive(table.id);
  return made;
}

export const mutateTable = <R>(id: string, change: (table: PokerTable) => R | null) => mutate<PokerTable, R>(tableKey(id), change);

async function addLive(id: string) {
  const client = redis();
  if (client) {
    try {
      await client.sadd(LIVE_KEY, id);
      return;
    } catch (error) {
      logger.error('Poker live add failed', { id }, error);
    }
  }
  memoryLive.add(id);
}

export async function forgetLive(id: string): Promise<void> {
  const client = redis();
  if (client) {
    try {
      await client.srem(LIVE_KEY, id);
      return;
    } catch (error) {
      logger.error('Poker live remove failed', { id }, error);
    }
  }
  memoryLive.delete(id);
}

export async function liveTables(): Promise<string[]> {
  const client = redis();
  if (client) {
    try {
      return await client.smembers(LIVE_KEY);
    } catch (error) {
      logger.error('Poker live read failed', {}, error);
    }
  }
  return [...memoryLive];
}

// ------------------------------------------------------------------ floor

const emptyFloor = (eventId: string): PokerFloor => ({ eventId, queue: [], seats: {}, cooldownUntil: {}, version: 0 });

export async function readFloor(eventId: string): Promise<PokerFloor> {
  return (await read<PokerFloor>(floorKey(eventId))) ?? emptyFloor(eventId);
}

export async function mutateFloor<R>(eventId: string, change: (floor: PokerFloor) => R | null) {
  return mutate<PokerFloor, R>(
    floorKey(eventId),
    (floor) => {
      const result = change(floor);
      if (result !== null) floor.version += 1;
      return result;
    },
    () => emptyFloor(eventId),
  );
}

// ------------------------------------------------------------------ leases

/** One instance moves a table or an event's floor at a time. */
export async function lease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  const client = redis();
  if (client) {
    try {
      return (await client.set(lockKey(name), owner, 'PX', ttlMs, 'NX')) === 'OK';
    } catch {
      return true;
    }
  }
  const until = memoryLocks.get(name) ?? 0;
  if (until > Date.now()) return false;
  memoryLocks.set(name, Date.now() + ttlMs);
  return true;
}

export async function release(name: string, owner: string): Promise<void> {
  const client = redis();
  if (client) {
    try {
      await client.eval(UNLOCK_SCRIPT, 1, lockKey(name), owner);
    } catch {
      /* it expires on its own */
    }
    return;
  }
  memoryLocks.delete(name);
}

/** For the check script: forget everything held in memory. */
export function resetPokerMemory(): void {
  memory.clear();
  memoryLive.clear();
  memoryQueues.clear();
  memoryLocks.clear();
}
