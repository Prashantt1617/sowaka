/**
 * Suwi's second layer of kept data, in Redis (the server's existing client and
 * its `name:` key style; no new infrastructure), behind the in-process copies.
 *
 * Every company has a data version (`suwi:ver:<org>`), bumped by the write hook
 * (lifecycle/readCache.ts) whenever a write can change what Suwi reads: a
 * request made or decided, a person changed. Everything kept here carries the
 * version it was read at in its key, so after a change every reader on every
 * server asks for a new key and misses: nothing survives a change, and nothing
 * has to be deleted. Copies also expire on their own (a backstop).
 *
 * Kept here:
 *   - the company bundle Suwi reads (orgData.ts), so a restart starts warm;
 *   - finished answers (agent.ts), per viewer, so the same question on
 *     unchanged data comes back in milliseconds.
 *
 * Redis down or not configured: every call here quietly returns null / does
 * nothing, once logged, and Suwi works exactly as without it.
 */
import { createHash } from 'node:crypto';
import { redisClient, redisReady } from '../config/redis';
import { logger } from '../utils/logger';

const PREFIX = 'suwi:';
/** A change with no company named (a candidate on the portal) bumps this one, which every key also carries. */
const ALL = '_all';

let warned = false;
function quietFail(error: unknown): null {
  if (!warned) {
    warned = true;
    logger.warn('Suwi: Redis unavailable, answering without its kept copies', { error: (error as Error)?.message });
  }
  return null;
}

/** For checks: pretend Redis is down (true), or use it if there is one (false). */
let forcedOff = false;
export function setSuwiRedisOff(off: boolean): void { forcedOff = off; }

function redis() {
  if (forcedOff) return null;
  try { return redisReady() ? redisClient() : null; } catch (e) { return quietFail(e); }
}

export const suwiRedisOn = () => Boolean(redis());

/** The company's data version as `<org>.<all>`, or null without Redis. */
export async function suwiVersion(org: string): Promise<string | null> {
  const r = redis();
  if (!r) return null;
  try {
    const [own, all] = await r.mget(`${PREFIX}ver:${org}`, `${PREFIX}ver:${ALL}`);
    return `${own ?? 0}.${all ?? 0}`;
  } catch (e) { return quietFail(e); }
}

/**
 * This process's own count of changes per company (and `_all`), kept beside Redis's: the prepared
 * answers in memory (planner.ts) key on it, so they too miss after a change when Redis is down.
 */
const localVersion = new Map<string, number>();

/** A change Suwi must not answer from before: the next read of every kept copy misses. */
export async function bumpSuwiVersion(org: string | null, opts: { requestsOnly?: boolean } = {}): Promise<void> {
  localVersion.set(org || ALL, (localVersion.get(org || ALL) ?? 0) + 1);
  // A request made, decided or cancelled changes nobody's record: the people version stays.
  if (!opts.requestsOnly) localPeopleVersion.set(org || ALL, (localPeopleVersion.get(org || ALL) ?? 0) + 1);
  const r = redis();
  if (!r) return;
  try {
    if (opts.requestsOnly) await r.incr(`${PREFIX}ver:${org || ALL}`);
    else await r.multi().incr(`${PREFIX}ver:${org || ALL}`).incr(`${PREFIX}pver:${org || ALL}`).exec();
  } catch (e) { quietFail(e); }
}

/**
 * The version of the company's people records alone: bumped by every change but a request write
 * (readCache: a leave, overtime, correction or claim made, decided or cancelled). What is read only
 * from people records (toolCache's people bundle) keys on it, so a leave approved doesn't re-read
 * the roster.
 */
const localPeopleVersion = new Map<string, number>();
export async function suwiPeopleVersion(org: string): Promise<string> {
  const r = redis();
  let shared: string | null = null;
  if (r) {
    try { const [own, all] = await r.mget(`${PREFIX}pver:${org}`, `${PREFIX}pver:${ALL}`); shared = `${own ?? 0}.${all ?? 0}`; } catch (e) { quietFail(e); }
  }
  return `${shared ?? 'n'}|${localPeopleVersion.get(org) ?? 0}.${localPeopleVersion.get(ALL) ?? 0}`;
}

/** The company's data version for keys that must work with or without Redis: Redis's when there is one, plus this process's. */
export async function suwiDataVersion(org: string): Promise<string> {
  const shared = await suwiVersion(org);
  return `${shared ?? 'n'}|${localVersion.get(org) ?? 0}.${localVersion.get(ALL) ?? 0}`;
}

export async function keptGet<T>(key: string): Promise<T | null> {
  const r = redis();
  if (!r) return null;
  try {
    const raw = await r.get(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) { return quietFail(e); }
}

export async function keptSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = redis();
  if (!r) return;
  try { await r.set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds); } catch (e) { quietFail(e); }
}

export const hashOf = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

/** The question as a cache key: case, spacing and trailing punctuation don't make a new question. */
export function normalQuestion(q: string): string {
  return q.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '').trim();
}
