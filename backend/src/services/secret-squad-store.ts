/**
 * Where a live Secret Squad session is kept: Redis when it is configured, so
 * every API instance sees the same session, else this process's memory (right
 * while one server runs). Same approach as Scribble's store: each change is a
 * read, a change, and a compare-and-set write, retried if someone else wrote.
 */
import type Redis from 'ioredis';
import { redisClient, redisReady } from '../config/redis';
import type { SquadSession } from '../models/secret-squad.model';
import { logger } from '../utils/logger';

/** A session's record outlives any session: the lobby, every round, and the results. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const sessionKey = (org: string, id: string) => `squad:session:${org}:${id}`;
const lockKey = (org: string, id: string) => `squad:lock:${org}:${id}`;
const LIVE_KEY = 'squad:live';

const memorySessions = new Map<string, string>();
const memoryLive = new Set<string>();
const memoryQueues = new Map<string, Promise<unknown>>();

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

export class SquadStoreConflict extends Error {
  constructor() {
    super('The session changed under us');
    this.name = 'SquadStoreConflict';
  }
}

export async function readSession(org: string, id: string): Promise<SquadSession | null> {
  const key = sessionKey(org, id);
  const client = redis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as SquadSession) : null;
    } catch (error) {
      logger.error('Secret Squad session read failed', { org, id }, error);
    }
  }
  const raw = memorySessions.get(key);
  return raw ? (JSON.parse(raw) as SquadSession) : null;
}

/** Writes a new session, unless one with that id exists. */
export async function createSession(session: SquadSession): Promise<boolean> {
  const key = sessionKey(session.org, session.id);
  const live = `${session.org}:${session.id}`;
  const raw = JSON.stringify(session);
  const client = redis();
  if (client) {
    try {
      const made = await client.set(key, raw, 'EX', SESSION_TTL_SECONDS, 'NX');
      if (made !== 'OK') return false;
      await client.sadd(LIVE_KEY, live);
      return true;
    } catch (error) {
      logger.error('Secret Squad session create failed, using memory', { org: session.org, id: session.id }, error);
    }
  }
  if (memorySessions.has(key)) return false;
  memorySessions.set(key, raw);
  memoryLive.add(live);
  return true;
}

/**
 * Reads the session, lets `change` alter it, and writes it back only if nobody
 * else wrote in between; otherwise reads again and retries. `change` returning
 * null means "nothing to write"; throwing passes the error on, unwritten.
 */
export async function mutateSession<T>(
  org: string,
  id: string,
  change: (session: SquadSession) => T | null,
): Promise<{ session: SquadSession; result: T } | null> {
  const key = sessionKey(org, id);
  const client = redis();
  if (client) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let before: string | null;
      try {
        before = await client.get(key);
      } catch (error) {
        logger.error('Secret Squad session read failed', { org, id }, error);
        return memoryMutate(org, id, change);
      }
      if (!before) return null;
      const session = JSON.parse(before) as SquadSession;
      const result = change(session);
      if (result === null) return null;
      session.version += 1;
      try {
        const written = await client.eval(CAS_SCRIPT, 1, key, before, JSON.stringify(session), String(SESSION_TTL_SECONDS));
        if (written === 1) return { session, result };
      } catch (error) {
        logger.error('Secret Squad session write failed', { org, id }, error);
        return memoryMutate(org, id, change);
      }
    }
    throw new SquadStoreConflict();
  }
  return memoryMutate(org, id, change);
}

function memoryMutate<T>(
  org: string,
  id: string,
  change: (session: SquadSession) => T | null,
): Promise<{ session: SquadSession; result: T } | null> {
  const key = sessionKey(org, id);
  const previous = memoryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(() => {
    const before = memorySessions.get(key);
    if (!before) return null;
    const session = JSON.parse(before) as SquadSession;
    const result = change(session);
    if (result === null) return null;
    session.version += 1;
    memorySessions.set(key, JSON.stringify(session));
    return { session, result };
  });
  memoryQueues.set(key, run.catch(() => undefined));
  return run;
}

export async function deleteSession(org: string, id: string): Promise<void> {
  const live = `${org}:${id}`;
  const client = redis();
  if (client) {
    try {
      await client.multi().del(sessionKey(org, id)).srem(LIVE_KEY, live).exec();
      return;
    } catch (error) {
      logger.error('Secret Squad session delete failed', { org, id }, error);
    }
  }
  memorySessions.delete(sessionKey(org, id));
  memoryLive.delete(live);
}

/** Every session that may need moving on, as `{ org, id }`. */
export async function liveSessions(): Promise<Array<{ org: string; id: string }>> {
  let members: string[];
  const client = redis();
  if (client) {
    try {
      members = await client.smembers(LIVE_KEY);
    } catch (error) {
      logger.error('Secret Squad live set read failed', {}, error);
      members = [...memoryLive];
    }
  } else {
    members = [...memoryLive];
  }
  return members
    .map((member) => {
      const at = member.indexOf(':');
      return at > 0 ? { org: member.slice(0, at), id: member.slice(at + 1) } : null;
    })
    .filter((entry): entry is { org: string; id: string } => entry !== null);
}

/** Drops a session from the live set once its record has gone. */
export async function forgetLiveSession(org: string, id: string): Promise<void> {
  const live = `${org}:${id}`;
  const client = redis();
  if (client) {
    try {
      await client.srem(LIVE_KEY, live);
    } catch {
      /* the next pass tries again */
    }
  }
  memoryLive.delete(live);
}

/** A short lease so one instance moves a session on per pass. Without Redis it is always granted. */
export async function leaseSession(org: string, id: string, owner: string, ttlMs: number): Promise<boolean> {
  const client = redis();
  if (!client) return true;
  try {
    return (await client.set(lockKey(org, id), owner, 'PX', ttlMs, 'NX')) === 'OK';
  } catch {
    return true;
  }
}

export async function releaseSession(org: string, id: string, owner: string): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.eval(UNLOCK_SCRIPT, 1, lockKey(org, id), owner);
  } catch {
    /* it expires on its own */
  }
}

/** For checks: forget every session kept in memory. */
export function resetSquadMemory(): void {
  memorySessions.clear();
  memoryLive.clear();
  memoryQueues.clear();
}
