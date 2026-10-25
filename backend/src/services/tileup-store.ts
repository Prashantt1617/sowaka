import type Redis from 'ioredis';
import { redisClient, redisReady } from '../config/redis';
import { TileUpRoom } from '../models/tileup.model';
import { TILEUP } from './tileup-engine';
import { logger } from '../utils/logger';

/**
 * Where a live Tile Up room lives: Redis, or this process's memory when Redis
 * is not configured, exactly as Scribble's rooms do (`scribble-store.ts`).
 * Rooms are made and dropped by players, so this is the only copy: nothing is
 * mirrored to Mongo while a room lives.
 *
 * Every change is a read, a change and a compare-and-set on the room's JSON,
 * so two moves landing together on two instances cannot both be applied.
 */

const ROOM_TTL_SECONDS = TILEUP.roomMaxMs / 1000;
const SEAT_TTL_SECONDS = ROOM_TTL_SECONDS;

const roomKey = (org: string, code: string) => `tileup:room:${org}:${code}`;
const seatKey = (org: string, userId: string) => `tileup:seat:${org}:${userId}`;
const invitesKey = (org: string, userId: string) => `tileup:invites:${org}:${userId}`;
const lockKey = (org: string, code: string) => `tileup:lock:${org}:${code}`;
const onceKey = (name: string) => `tileup:once:${name}`;
const LIVE_KEY = 'tileup:live';

const memoryRooms = new Map<string, string>();
const memorySeats = new Map<string, string>();
/** Per invitee key, the pending invites by room code. */
const memoryInvites = new Map<string, Map<string, PendingInvite>>();
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

export class TileUpStoreConflict extends Error {
  constructor() {
    super('The room changed under us');
    this.name = 'TileUpStoreConflict';
  }
}

export async function readRoom(org: string, code: string): Promise<TileUpRoom | null> {
  const key = roomKey(org, code);
  const client = redis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as TileUpRoom) : null;
    } catch (error) {
      logger.error('Tile Up room read failed', { org, code }, error);
    }
  }
  const raw = memoryRooms.get(key);
  return raw ? (JSON.parse(raw) as TileUpRoom) : null;
}

/** Writes a new room, unless the code is taken. */
export async function createRoom(room: TileUpRoom): Promise<boolean> {
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
      logger.error('Tile Up room create failed, using memory', { org: room.org, code: room.code }, error);
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
  change: (room: TileUpRoom) => T | null,
): Promise<{ room: TileUpRoom; result: T } | null> {
  const key = roomKey(org, code);
  const client = redis();
  if (client) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let before: string | null;
      try {
        before = await client.get(key);
      } catch (error) {
        logger.error('Tile Up room read failed', { org, code }, error);
        return memoryMutate(org, code, change);
      }
      if (!before) return null;
      const room = JSON.parse(before) as TileUpRoom;
      const result = change(room);
      if (result === null) return null;
      room.version += 1;
      try {
        const written = await client.eval(CAS_SCRIPT, 1, key, before, JSON.stringify(room), String(ROOM_TTL_SECONDS));
        if (written === 1) return { room, result };
      } catch (error) {
        logger.error('Tile Up room write failed', { org, code }, error);
        return memoryMutate(org, code, change);
      }
    }
    throw new TileUpStoreConflict();
  }
  return memoryMutate(org, code, change);
}

function memoryMutate<T>(
  org: string,
  code: string,
  change: (room: TileUpRoom) => T | null,
): Promise<{ room: TileUpRoom; result: T } | null> {
  const key = roomKey(org, code);
  const previous = memoryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(() => {
    const before = memoryRooms.get(key);
    if (!before) return null;
    const room = JSON.parse(before) as TileUpRoom;
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
      await client.multi().del(roomKey(org, code)).srem(LIVE_KEY, live).exec();
      return;
    } catch (error) {
      logger.error('Tile Up room delete failed', { org, code }, error);
    }
  }
  memoryRooms.delete(roomKey(org, code));
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
      logger.error('Tile Up live set read failed', {}, error);
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

// ---------------------------------------------------------------- seats

/** The room a person sits in, so a fresh socket can be put straight back in it. */
export async function seatOf(org: string, userId: string): Promise<string | null> {
  const key = seatKey(org, userId);
  const client = redis();
  if (client) {
    try {
      return await client.get(key);
    } catch (error) {
      logger.error('Tile Up seat read failed', { org, userId }, error);
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
      logger.error('Tile Up seat write failed', { org, userId }, error);
    }
  }
  if (code) memorySeats.set(key, code);
  else memorySeats.delete(key);
}

/** Clears a seat only if it still points at `code`: a player who moved rooms keeps the new one. */
export async function clearSeatIf(org: string, userId: string, code: string): Promise<void> {
  if ((await seatOf(org, userId)) === code) await setSeat(org, userId, null);
}

// ---------------------------------------------------------------- pending invites

/**
 * An invite that has not been answered: what the Games tab and a later
 * Tile Up socket show the invitee, since the push itself is gone the moment
 * it is dismissed. Kept per invitee, one record per room code; it lives as
 * long as the room can (four hours) and is dropped when the invitee joins or
 * is removed, when the game starts, or when the room is deleted.
 */
export interface PendingInvite {
  org: string;
  code: string;
  inviter: { userId: string; name: string };
  /** Epoch ms, the game's clock. */
  createdAt: number;
  expiresAt: number;
}

/** Writes or refreshes the invitee's record for this room. */
export async function recordInvite(userId: string, invite: PendingInvite): Promise<void> {
  const key = invitesKey(invite.org, userId);
  const client = redis();
  if (client) {
    try {
      // The hash outlives its longest record: no record lives past a room's four hours.
      await client.multi().hset(key, invite.code, JSON.stringify(invite)).expire(key, ROOM_TTL_SECONDS).exec();
      return;
    } catch (error) {
      logger.error('Tile Up invite record failed', { org: invite.org, code: invite.code, userId }, error);
    }
  }
  const held = memoryInvites.get(key) ?? new Map<string, PendingInvite>();
  held.set(invite.code, invite);
  memoryInvites.set(key, held);
}

/** The invitee's pending invites that have not expired by `now`; expired ones are dropped as they are met. */
export async function pendingInvitesOf(org: string, userId: string, now: number): Promise<PendingInvite[]> {
  const key = invitesKey(org, userId);
  let records: PendingInvite[] = [];
  const client = redis();
  let fromRedis = false;
  if (client) {
    try {
      records = Object.values(await client.hgetall(key)).map((raw) => JSON.parse(raw) as PendingInvite);
      fromRedis = true;
    } catch (error) {
      logger.error('Tile Up invites read failed', { org, userId }, error);
    }
  }
  if (!fromRedis) records = [...(memoryInvites.get(key)?.values() ?? [])];
  const kept: PendingInvite[] = [];
  for (const record of records) {
    if (record.expiresAt > now) kept.push(record);
    else await clearInvite(org, userId, record.code);
  }
  return kept.sort((a, b) => a.createdAt - b.createdAt);
}

export async function clearInvite(org: string, userId: string, code: string): Promise<void> {
  const key = invitesKey(org, userId);
  const client = redis();
  if (client) {
    try {
      await client.hdel(key, code);
    } catch (error) {
      logger.error('Tile Up invite clear failed', { org, code, userId }, error);
    }
  }
  const held = memoryInvites.get(key);
  if (!held) return;
  held.delete(code);
  if (held.size === 0) memoryInvites.delete(key);
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
      logger.error('Tile Up once-claim failed', { name }, error);
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
      logger.error('Tile Up count-claim failed', { name }, error);
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
export function resetTileUpMemory(): void {
  memoryRooms.clear();
  memorySeats.clear();
  memoryInvites.clear();
  memoryOnce.clear();
  memoryCounts.clear();
  memoryLive.clear();
  memoryQueues.clear();
}
