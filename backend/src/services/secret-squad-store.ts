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
/** The session's version, kept beside it: a compare-and-set compares this, not the whole session. */
const versionKey = (org: string, id: string) => `squad:ver:${org}:${id}`;
const lockKey = (org: string, id: string) => `squad:lock:${org}:${id}`;
const LIVE_KEY = 'squad:live';

const memorySessions = new Map<string, string>();
const memoryLive = new Set<string>();
const memoryQueues = new Map<string, Promise<unknown>>();

const redis = (): Redis | null => (redisReady() ? redisClient() : null);

/** KEYS: session, version. ARGV: expected version, new session, new version, ttl. */
const CAS_SCRIPT = `
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
  return 1
end
return 0`;

/**
 * The last copy of each session this process read or wrote, by version: a
 * read first asks Redis for the version (a few bytes), and only fetches the
 * session itself (tens of KB for a big office) when another instance moved it.
 */
const cache = new Map<string, { version: string; raw: string }>();

async function readRaw(client: Redis, org: string, id: string): Promise<{ raw: string; version: string } | null> {
  const key = sessionKey(org, id);
  const version = await client.get(versionKey(org, id));
  if (version === null) {
    cache.delete(key);
    return null;
  }
  const held = cache.get(key);
  if (held && held.version === version) return held;
  const raw = await client.get(key);
  if (raw === null) return null;
  const fresh = { raw, version };
  cache.set(key, fresh);
  return fresh;
}

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
      const held = await readRaw(client, org, id);
      return held ? (JSON.parse(held.raw) as SquadSession) : null;
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
      await client.multi()
        .set(versionKey(session.org, session.id), String(session.version), 'EX', SESSION_TTL_SECONDS)
        .sadd(LIVE_KEY, live)
        .exec();
      cache.set(key, { raw, version: String(session.version) });
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
  const client = redis();
  if (!client) return memoryMutate(org, id, change);
  // One change at a time per session inside this process: a lobby of 150
  // joining at once would otherwise race itself through the compare-and-set
  // and run out of retries. Only other instances can then conflict.
  return queued(sessionKey(org, id), () => redisMutate(client, org, id, change));
}

const queues = new Map<string, Promise<unknown>>();

function queued<R>(key: string, run: () => Promise<R>): Promise<R> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  // Forget the tail once nothing is waiting behind it.
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return next;
}

async function redisMutate<T>(
  client: Redis,
  org: string,
  id: string,
  change: (session: SquadSession) => T | null,
): Promise<{ session: SquadSession; result: T } | null> {
  const key = sessionKey(org, id);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let held: { raw: string; version: string } | null;
    try {
      held = await readRaw(client, org, id);
    } catch (error) {
      logger.error('Secret Squad session read failed', { org, id }, error);
      return memoryMutate(org, id, change);
    }
    if (!held) return null;
    const session = JSON.parse(held.raw) as SquadSession;
    const result = change(session);
    if (result === null) return null;
    session.version += 1;
    const raw = JSON.stringify(session);
    const version = String(session.version);
    try {
      const written = await client.eval(CAS_SCRIPT, 2, key, versionKey(org, id), held.version, raw, version, String(SESSION_TTL_SECONDS));
      if (written === 1) {
        cache.set(key, { raw, version });
        return { session, result };
      }
    } catch (error) {
      logger.error('Secret Squad session write failed', { org, id }, error);
      return memoryMutate(org, id, change);
    }
    // Another instance wrote first: back off a little, randomly, and go again.
    cache.delete(key);
    await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * (attempt + 1)));
  }
  throw new SquadStoreConflict();
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
      await client.multi().del(sessionKey(org, id)).del(versionKey(org, id)).srem(LIVE_KEY, live).exec();
      cache.delete(sessionKey(org, id));
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
  queues.clear();
  cache.clear();
}
