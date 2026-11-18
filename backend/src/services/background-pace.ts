/**
 * Live requests first: the background warm-up (engagement-warmup.service, lifecycle/warm.ts, Suwi's
 * tools and answers made ahead) waits for a quiet moment before each of its steps.
 *
 * The database tier hands back about 100 KB/s, shared by everything the server asks of it, and the
 * server is one small instance. While a warm-up round ran (every four minutes, about two minutes of
 * reads, one company after another), a request that is normally answered from memory in tens of
 * milliseconds waited seconds behind it: GET /suwi/notices' p95 of 6.5 s against a median of 46 ms,
 * and a punch-out of 10 s. The round's own length doubled (233 s) when it ran into busy moments.
 *
 * So before each step the warm-up waits until no live request has been in flight for a moment, and
 * the event loop is not running behind; never longer than `MAX_WAIT_MS` a step, so it still finishes
 * on a server that is never idle. Every step is also a short gap apart, so the warm-up never runs back
 * to back. Long-lived requests (a video streaming, Suwi writing an answer, a health check) are not
 * counted as live: they would hold the warm-up off for their whole length.
 */
import type { NextFunction, Request, Response } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Between one background step and the next, always. */
const GAP_MS = 150;
/** How long the server must have had no live request before a step starts. */
const QUIET_MS = 250;
/** The longest a step waits for quiet. */
const MAX_WAIT_MS = 5_000;
/** The event loop held up this long (ms, the longest stall in the last second) counts as busy. */
const LAG_BUSY_MS = 60;
/** How often the loop's delay is sampled (ms); every sample includes it. */
const RESOLUTION_MS = 20;

let live = 0;
let lastLiveAt = 0;
/** Off until the API server switches it on (server.ts): scripts and checks run their steps straight through. */
let pacing = false;
export function enableBackgroundPace(on = true): void {
  pacing = on;
}
let waited = { steps: 0, ms: 0 };

const LONG_LIVED = /^\/(health|media|suwi\/ask)(\/|$)/;

/** Mounted before the routes: counts the requests in flight. */
export function trackLiveRequests(req: Request, res: Response, next: NextFunction): void {
  if (LONG_LIVED.test(req.path)) { next(); return; }
  live += 1;
  lastLiveAt = Date.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    live -= 1;
    lastLiveAt = Date.now();
  };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

let delay: ReturnType<typeof monitorEventLoopDelay> | null = null;
let lagMs = 0;
let sampler: NodeJS.Timeout | null = null;
function sampleLag(): void {
  if (sampler) return;
  delay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  delay.enable();
  sampler = setInterval(() => {
    lagMs = delay ? Math.max(0, delay.max / 1e6 - RESOLUTION_MS) : 0;
    delay?.reset();
  }, 1_000);
  sampler.unref();
}

const pause = (ms: number) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  t.unref();
});

/** Whether a live request is in flight or just finished, or the event loop is behind. */
export function serverBusy(now = Date.now()): boolean {
  return live > 0 || now - lastLiveAt < QUIET_MS || lagMs > LAG_BUSY_MS;
}

/**
 * Before a background step: a short gap, then wait (up to `maxWaitMs`) for no live request in
 * flight. Resolves at once when `isStopping` says the server is shutting down.
 */
export async function yieldToLive(isStopping: () => boolean = () => false, maxWaitMs = MAX_WAIT_MS): Promise<void> {
  if (!pacing) return;
  sampleLag();
  const started = Date.now();
  await pause(GAP_MS);
  while (!isStopping() && serverBusy() && Date.now() - started < maxWaitMs) await pause(50);
  waited = { steps: waited.steps + 1, ms: waited.ms + (Date.now() - started) };
}

/** How many background steps waited and for how long in all, since the last call (the warm-up's log). */
export function takePaceStats(): { steps: number; ms: number; live: number; lagMs: number } {
  const out = { ...waited, live, lagMs: Math.round(lagMs) };
  waited = { steps: 0, ms: 0 };
  return out;
}

/** For checks: as if requests came and went. */
export function __liveForCheck(delta: number): void {
  live += delta;
  lastLiveAt = Date.now();
}
