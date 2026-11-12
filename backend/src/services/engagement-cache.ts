/**
 * Dashboard › Engagement answers, remembered per org for a few minutes.
 *
 * Every Engagement page reads a company's whole history (every play on
 * record, thirty days of app activity, the year's plan) and none of it needs
 * to be to-the-second: HR flips between tabs, ranges and filters, and each
 * flip used to redo seconds of queries. An answer is kept for five minutes,
 * keyed by the org, which page asked (`kind`) and what it asked with.
 *
 * What HR changes on these pages has to show at once, so a plan or contest
 * write drops that org's plan and contest answers (`forgetEngagement`). What
 * employees do (a game, a vote, an app open) just shows within the five
 * minutes.
 *
 * The promise is what is kept, so two tabs asking at once share one set of
 * queries; a failure is forgotten straight away rather than remembered.
 */
export type EngagementKind = 'games' | 'usage-summary' | 'usage-when' | 'usage-trend' | 'contests' | 'plan';

const TTL_MS = 5 * 60_000;
/** A ceiling, not a working size: an org has a handful of keys at a time. */
const MAX_ENTRIES = 2_000;

const kept = new Map<string, { expires: number; value: Promise<unknown> }>();

const keyOf = (org: string, kind: EngagementKind, params: unknown) => `${org}\u0000${kind}\u0000${JSON.stringify(params ?? null)}`;

/** `load()`'s answer for this org, kind and params, from memory when it is under five minutes old. */
export function cachedEngagement<T>(org: string, kind: EngagementKind, params: unknown, load: () => Promise<T>): Promise<T> {
  const key = keyOf(org, kind, params);
  const now = Date.now();
  const hit = kept.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (kept.size >= MAX_ENTRIES) {
    for (const [k, v] of kept) if (v.expires <= now) kept.delete(k);
    if (kept.size >= MAX_ENTRIES) kept.clear();
  }
  const value = load();
  const entry = { expires: now + TTL_MS, value: value as Promise<unknown> };
  kept.set(key, entry);
  value.catch(() => {
    if (kept.get(key) === entry) kept.delete(key);
  });
  return value;
}

/** Drop an org's remembered answers of these kinds (all kinds when none are named). */
export function forgetEngagement(org: string, ...kinds: EngagementKind[]): void {
  const prefixes = kinds.length ? kinds.map((k) => `${org}\u0000${k}\u0000`) : [`${org}\u0000`];
  for (const key of kept.keys()) if (prefixes.some((p) => key.startsWith(p))) kept.delete(key);
}
