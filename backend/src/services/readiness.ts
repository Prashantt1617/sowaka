/**
 * Whether this process is ready to take traffic: what `/health/ready` answers, and what a
 * blue/green deploy waits for before it points nginx here (docs/deploy/bluegreen.md).
 *
 * Ready means all of:
 *   - the database answers a ping (asked at most once a second);
 *   - Redis is connected, when REDIS_URL is set (the games' rooms and Suwi's kept copies live there);
 *   - the boot warm-up has finished (server.ts: Suwi's inputs and notices, and one Engagement /
 *     Time office / lifecycle round), so the first HR page after the switch is served from memory;
 *   - it is not shutting down.
 *
 * `/health` itself stays a plain liveness answer (200 while the process runs).
 */
import { dbClient } from '../config/db';
import { redisReady } from '../config/redis';
import { env } from '../config/env';

type WarmState = 'pending' | 'running' | 'done';

const state = {
  warm: 'pending' as WarmState,
  warmStartedAt: 0,
  warmMs: null as number | null,
  draining: false,
};

let lastPing = { at: 0, ok: false };
let pinging: Promise<boolean> | null = null;

async function dbAnswers(): Promise<boolean> {
  const client = dbClient();
  if (!client) return false;
  if (Date.now() - lastPing.at < 1000) return lastPing.ok;
  pinging ??= client.db(env.mongoDbName).command({ ping: 1 }, { timeoutMS: 2000 })
    .then(() => true, () => false)
    .then((ok) => { lastPing = { at: Date.now(), ok }; pinging = null; return ok; });
  return pinging;
}

export function markWarmStarted(): void {
  state.warm = 'running';
  state.warmStartedAt = Date.now();
}

export function markWarmDone(): void {
  state.warm = 'done';
  state.warmMs = Date.now() - state.warmStartedAt;
}

/** Shutdown has begun: say "not ready" from now on, so nothing new is sent here. */
export function markDraining(): void {
  state.draining = true;
}

export const isDraining = (): boolean => state.draining;

export interface Readiness {
  ready: boolean;
  db: boolean;
  /** 'off' when REDIS_URL is not set (the server runs on its own memory then). */
  redis: boolean | 'off';
  warm: WarmState;
  warmMs: number | null;
  draining: boolean;
}

export async function readiness(): Promise<Readiness> {
  const db = await dbAnswers();
  const redis: boolean | 'off' = process.env.REDIS_URL ? redisReady() : 'off';
  const ready = db && redis !== false && state.warm === 'done' && !state.draining;
  return { ready, db, redis, warm: state.warm, warmMs: state.warmMs, draining: state.draining };
}
