/**
 * Answers worth keeping for the Time office pages (Punch log, Company calendar,
 * Out-of-location): served at once from memory and brought up to date behind
 * the reader.
 *
 * The database tier hands back a month of a large company's punches at about
 * 100 KB/s, so working one of these out takes seconds however good the query.
 * An answer here is "fresh" for a minute; after that, until it is fifteen
 * minutes old, a reader still gets it at once while one refresh runs in the
 * background (stale-while-revalidate). Older than that, or never asked for, the
 * reader waits for the work. The background warm-up keeps each company's
 * default ranges fresh, so a first open is usually instant too.
 *
 * A change HR makes on these pages calls `forgetSwr(org)` so it shows at once;
 * what employees do (a punch) shows within the minute.
 */
export type SwrKind = 'ool';

const FRESH_MS = 60_000;
const MAX_STALE_MS = 15 * 60_000;
/** A ceiling, not a working size: an org has a handful of keys at a time. */
const MAX_ENTRIES = 2_000;

type Entry = { at: number; value?: unknown; pending?: Promise<unknown> };
const kept = new Map<string, Entry>();
/** Bumped by `forgetSwr`, so a refresh that began before a change does not put the old answer back. */
const generation = new Map<string, number>();

const keyOf = (org: string, kind: SwrKind, params: unknown) => `${org}\u0000${kind}\u0000${JSON.stringify(params ?? null)}`;

function makeRoom(): void {
  if (kept.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of kept) if (!v.pending && now - v.at > MAX_STALE_MS) kept.delete(k);
  if (kept.size >= MAX_ENTRIES) kept.clear();
}

function start<T>(org: string, key: string, load: () => Promise<T>): Promise<T> {
  const gen = generation.get(org) ?? 0;
  const entry = kept.get(key) ?? { at: 0 };
  const pending = load().then(
    (value) => {
      if ((generation.get(org) ?? 0) === gen) {
        makeRoom();
        kept.set(key, { at: Date.now(), value });
      } else if (kept.get(key)?.pending === pending) {
        kept.delete(key);
      }
      return value;
    },
    (error) => {
      // A failed refresh keeps the last good answer; a first try is simply forgotten.
      const now = kept.get(key);
      if (now?.pending === pending) {
        if (now.value === undefined) kept.delete(key);
        else kept.set(key, { at: now.at, value: now.value });
      }
      throw error;
    },
  );
  kept.set(key, { ...entry, pending });
  return pending;
}

/** `load()`'s answer for this org, kind and params: from memory when there is one, refreshed behind the reader when over a minute old. */
export function cachedSwr<T>(org: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  const key = keyOf(org, kind, params);
  const hit = kept.get(key);
  const now = Date.now();
  if (hit?.value !== undefined && now - hit.at < MAX_STALE_MS) {
    if (now - hit.at >= FRESH_MS && !hit.pending) {
      // Old but usable: answer now, refresh once in the background.
      start(org, key, load).catch(() => undefined);
    }
    return Promise.resolve(hit.value as T);
  }
  if (hit?.pending) return hit.pending as Promise<T>;
  return start(org, key, load);
}

/** Work this one out again now and keep it (the warm-up's way in); readers keep the old answer meanwhile. */
export function refreshSwr<T>(org: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  const key = keyOf(org, kind, params);
  const hit = kept.get(key);
  if (hit?.pending) return hit.pending as Promise<T>;
  return start(org, key, load);
}

const forgetListeners: ((org: string) => void)[] = [];
/** Other kept answers (the Punch log's) that a forget must drop too. */
export function onForgetSwr(listener: (org: string) => void): void {
  forgetListeners.push(listener);
}

/** Drop an org's kept answers (of these kinds, or all), so the next read reflects a change at once. */
export function forgetSwr(org: string, ...kinds: SwrKind[]): void {
  for (const listener of forgetListeners) listener(org);
  generation.set(org, (generation.get(org) ?? 0) + 1);
  const prefixes = kinds.length ? kinds.map((k) => `${org}\u0000${k}\u0000`) : [`${org}\u0000`];
  for (const key of kept.keys()) if (prefixes.some((p) => key.startsWith(p))) kept.delete(key);
}
