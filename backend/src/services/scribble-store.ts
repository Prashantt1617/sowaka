import type Redis from 'ioredis';
import { redisClient, redisReady } from '../config/redis';
import { ScribbleOp, ScribbleRoom } from '../models/scribble.model';
import { SCRIBBLE } from './scribble-engine';
import { logger } from '../utils/logger';

/**
 * Where a live Scribble room lives: Redis, or this process's memory when
 * Redis is not configured (the relay's split, see `relay-store.ts`). Rooms
 * are made and dropped by players, not an operator, so unlike the relay this
 * is the only copy — nothing is mirrored to Mongo while a room lives.
 *
 * Every change is a read, a change and a compare-and-set on the room's JSON,
 * so two guesses landing together on two instances cannot both take the
 * "last guesser" slot. The stroke log is a list beside the room, appended to
 * without touching the room record, because a drawer sends twenty messages a
 * second and the room must not be rewritten for each.
 */

const ROOM_TTL_SECONDS = SCRIBBLE.roomMaxMs / 1000;
const SEAT_TTL_SECONDS = ROOM_TTL_SECONDS;
/** A backstop on the log's length; the socket layer enforces the real caps per turn. */
const MAX_LOG_OPS = 8000;

const roomKey = (org: string, code: string) => `scribble:room:${org}:${code}`;
const strokesKey = (org: string, code: string) => `scribble:strokes:${org}:${code}`;
const seatKey = (org: string, userId: string) => `scribble:seat:${org}:${userId}`;
const lockKey = (org: string, code: string) => `scribble:lock:${org}:${code}`;
const onceKey = (name: string) => `scribble:once:${name}`;
const LIVE_KEY = 'scribble:live';

const memoryRooms = new Map<string, string>();
const memoryStrokes = new Map<string, string[]>();
const memorySeats = new Map<string, string>();
const memoryOnce = new Map<string, number>();
const memoryLive = new Set<string>();
/** Serialises in-process mutations of one room, which is all the CAS memory needs. */
const memoryQueues = new Map<string, Promise<unknown>>();

const redis = (): Redis | null => (redisReady() ? redisClient() : null);

/** Replaces the key only if it still holds `expected`; `expected` empty means "must not exist". */
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

export class ScribbleStoreConflict extends Error {
  constructor() {
    super('The room changed under us');
    this.name = 'ScribbleStoreConflict';
  }
}

export async function readRoom(org: string, code: string): Promise<ScribbleRoom | null> {
  const key = roomKey(org, code);
  const client = redis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as ScribbleRoom) : null;
    } catch (error) {
      logger.error('Scribble room read failed', { org, code }, error);
    }
  }
  const raw = memoryRooms.get(key);
  return raw ? (JSON.parse(raw) as ScribbleRoom) : null;
}

/** Writes a new room, unless the code is taken. */
export async function createRoom(room: ScribbleRoom): Promise<boolean> {
  const key = roomKey(room.org, room.code);
  const live = `${room.org}:${room.code}`;
  const raw = JSON.stringify(room);
  const client = redis();
  if (client) {
    try {
      const made = await client.set(key, raw, 'EX', ROOM_TTL_SECONDS, 'NX');
      if (made !== 'OK') return false;
      await client.sadd(LIVE_KEY, live);
      return true;
    } catch (error) {
      logger.error('Scribble room create failed, using memory', { org: room.org, code: room.code }, error);
    }
  }
  if (memoryRooms.has(key)) return false;
  memoryRooms.set(key, raw);
  memoryLive.add(live);
  return true;
}

/**
 * Reads the room, lets `change` alter it, and writes it back only if nobody
 * else wrote in between; otherwise reads again and retries, a few times.
 * `change` returning null means "nothing to write". The result carries the
 * room as written and whatever `change` returned.
 */
export async function mutateRoom<T>(
  org: string,
  code: string,
  change: (room: ScribbleRoom) => T | null,
): Promise<{ room: ScribbleRoom; result: T } | null> {
  const key = roomKey(org, code);
  const client = redis();
  if (client) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let before: string | null;
      try {
        before = await client.get(key);
      } catch (error) {
        logger.error('Scribble room read failed', { org, code }, error);
        return memoryMutate(org, code, change);
      }
      if (!before) return null;
      const room = JSON.parse(before) as ScribbleRoom;
      const result = change(room);
      if (result === null) return null;
      room.version += 1;
      try {
        const written = await client.eval(CAS_SCRIPT, 1, key, before, JSON.stringify(room), String(ROOM_TTL_SECONDS));
        if (written === 1) return { room, result };
      } catch (error) {
        logger.error('Scribble room write failed', { org, code }, error);
        return memoryMutate(org, code, change);
      }
    }
    throw new ScribbleStoreConflict();
  }
  return memoryMutate(org, code, change);
}

function memoryMutate<T>(
  org: string,
  code: string,
  change: (room: ScribbleRoom) => T | null,
): Promise<{ room: ScribbleRoom; result: T } | null> {
  const key = roomKey(org, code);
  const previous = memoryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(() => {
    const before = memoryRooms.get(key);
    if (!before) return null;
    const room = JSON.parse(before) as ScribbleRoom;
    const result = change(room);
    if (result === null) return null;
    room.version += 1;
    memoryRooms.set(key, JSON.stringify(room));
    return { room, result };
  });
  memoryQueues.set(key, run.catch(() => undefined));
  return run;
}

export async function deleteRoom(org: string, code: string): Promise<void> {
  const live = `${org}:${code}`;
  const client = redis();
  if (client) {
    try {
      await client.multi().del(roomKey(org, code)).del(strokesKey(org, code)).srem(LIVE_KEY, live).exec();
      return;
    } catch (error) {
      logger.error('Scribble room delete failed', { org, code }, error);
    }
  }
  memoryRooms.delete(roomKey(org, code));
  memoryStrokes.delete(strokesKey(org, code));
  memoryLive.delete(live);
}

/** Every room that may need moving on, as `org:code`. */
export async function liveRooms(): Promise<Array<{ org: string; code: string }>> {
  let members: string[];
  const client = redis();
  if (client) {
    try {
      members = await client.smembers(LIVE_KEY);
    } catch (error) {
      logger.error('Scribble live set read failed', {}, error);
      members = [...memoryLive];
    }
  } else {
    members = [...memoryLive];
  }
  return members
    .map((member) => {
      const at = member.lastIndexOf(':');
      return at > 0 ? { org: member.slice(0, at), code: member.slice(at + 1) } : null;
    })
    .filter((entry): entry is { org: string; code: string } => entry !== null);
}

/** Drops a room from the live set once its record has gone (expired, say). */
export async function forgetLive(org: string, code: string): Promise<void> {
  const live = `${org}:${code}`;
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

/**
 * A short lease on one room so one instance moves it on per pass. Without
 * Redis there is one instance, and the lease is always granted.
 */
export async function leaseRoom(org: string, code: string, owner: string, ttlMs: number): Promise<boolean> {
  const client = redis();
  if (!client) return true;
  try {
    return (await client.set(lockKey(org, code), owner, 'PX', ttlMs, 'NX')) === 'OK';
  } catch {
    return true;
  }
}

export async function releaseRoom(org: string, code: string, owner: string): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.eval(UNLOCK_SCRIPT, 1, lockKey(org, code), owner);
  } catch {
    /* it expires on its own */
  }
}

// ---------------------------------------------------------------- strokes

export async function appendStrokes(org: string, code: string, ops: ScribbleOp[]): Promise<void> {
  if (ops.length === 0) return;
  const key = strokesKey(org, code);
  // A clear empties the paper: everything before it is of no use to a joiner.
  const lastClear = ops.map((op) => op.t).lastIndexOf('c');
  const kept = lastClear >= 0 ? ops.slice(lastClear + 1) : ops;
  const client = redis();
  if (client) {
    try {
      const pipeline = client.multi();
      if (lastClear >= 0) pipeline.del(key);
      if (kept.length > 0) {
        pipeline.rpush(key, ...kept.map((op) => JSON.stringify(op)));
        pipeline.ltrim(key, -MAX_LOG_OPS, -1);
        pipeline.expire(key, ROOM_TTL_SECONDS);
      }
      await pipeline.exec();
      return;
    } catch (error) {
      logger.error('Scribble stroke log write failed', { org, code }, error);
    }
  }
  const log = lastClear >= 0 ? [] : (memoryStrokes.get(key) ?? []);
  log.push(...kept.map((op) => JSON.stringify(op)));
  if (log.length > MAX_LOG_OPS) log.splice(0, log.length - MAX_LOG_OPS);
  memoryStrokes.set(key, log);
}

export async function clearStrokes(org: string, code: string): Promise<void> {
  const key = strokesKey(org, code);
  const client = redis();
  if (client) {
    try {
      await client.del(key);
    } catch (error) {
      logger.error('Scribble stroke log clear failed', { org, code }, error);
    }
  }
  memoryStrokes.delete(key);
}

export async function readStrokes(org: string, code: string): Promise<ScribbleOp[]> {
  const key = strokesKey(org, code);
  const client = redis();
  if (client) {
    try {
      return (await client.lrange(key, 0, -1)).map((raw) => JSON.parse(raw) as ScribbleOp);
    } catch (error) {
      logger.error('Scribble stroke log read failed', { org, code }, error);
    }
  }
  return (memoryStrokes.get(key) ?? []).map((raw) => JSON.parse(raw) as ScribbleOp);
}

// ---------------------------------------------------------------- seats

/** The room a person sits in, so a fresh socket can be put straight back in it. */
export async function seatOf(org: string, userId: string): Promise<string | null> {
  const key = seatKey(org, userId);
  const client = redis();
  if (client) {
    try {
      return await client.get(key);
    } catch (error) {
      logger.error('Scribble seat read failed', { org, userId }, error);
    }
  }
  return memorySeats.get(key) ?? null;
}

export async function setSeat(org: string, userId: string, code: string | null): Promise<void> {
  const key = seatKey(org, userId);
  const client = redis();
  if (client) {
    try {
      if (code) await client.set(key, code, 'EX', SEAT_TTL_SECONDS);
      else await client.del(key);
      return;
    } catch (error) {
      logger.error('Scribble seat write failed', { org, userId }, error);
    }
  }
  if (code) memorySeats.set(key, code);
  else memorySeats.delete(key);
}

/** Clears a seat only if it still points at `code`: a player who moved rooms keeps the new one. */
export async function clearSeatIf(org: string, userId: string, code: string): Promise<void> {
  if ((await seatOf(org, userId)) === code) await setSeat(org, userId, null);
}

// ---------------------------------------------------------------- once

/** True the first time `name` is claimed within `ttlMs`; false while the claim holds. */
export async function claimOnce(name: string, ttlMs: number): Promise<boolean> {
  const key = onceKey(name);
  const client = redis();
  if (client) {
    try {
      return (await client.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch (error) {
      logger.error('Scribble once-claim failed', { name }, error);
    }
  }
  const now = Date.now();
  const until = memoryOnce.get(key);
  if (until !== undefined && until > now) return false;
  memoryOnce.set(key, now + ttlMs);
  if (memoryOnce.size > 10_000) {
    for (const [k, v] of memoryOnce) if (v <= now) memoryOnce.delete(k);
  }
  return true;
}

/** A counter that starts over `ttlMs` after its first count. */
const INCR_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

const memoryCounts = new Map<string, { count: number; until: number }>();

/** Counts a claim on `name`; true while the count within `ttlMs` is at most `limit`. */
export async function claimWithin(name: string, limit: number, ttlMs: number): Promise<boolean> {
  const key = onceKey(name);
  const client = redis();
  if (client) {
    try {
      return Number(await client.eval(INCR_SCRIPT, 1, key, String(ttlMs))) <= limit;
    } catch (error) {
      logger.error('Scribble count-claim failed', { name }, error);
    }
  }
  const now = Date.now();
  const held = memoryCounts.get(key);
  const entry = held && held.until > now ? held : { count: 0, until: now + ttlMs };
  entry.count += 1;
  memoryCounts.set(key, entry);
  if (memoryCounts.size > 10_000) {
    for (const [k, v] of memoryCounts) if (v.until <= now) memoryCounts.delete(k);
  }
  return entry.count <= limit;
}

/** For checks: forgets everything held in this process. */
export function resetScribbleMemory(): void {
  memoryRooms.clear();
  memoryStrokes.clear();
  memorySeats.clear();
  memoryOnce.clear();
  memoryCounts.clear();
  memoryLive.clear();
  memoryQueues.clear();
}
