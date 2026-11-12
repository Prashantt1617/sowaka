/**
 * Dashboard › Engagement answers, remembered per org for a few minutes.
 *
 * Every Engagement page reads a company's whole history (every play on
 * record, thirty days of app activity, the year's plan) and none of it needs
 * to be to-the-second: HR flips between tabs, ranges and filters, and each
 * flip used to redo seconds of queries. An answer is kept for five minutes,
 * keyed by the org, which page asked (`kind`) and what it asked with.
 *
 * The pages each org's dashboard opens on are worked out again every few
 * minutes in the background (engagement-warmup.service, `refreshEngagement`),
 * so the first open is served from here too; five minutes outlasts the
 * warm-up's round, so a warmed answer never runs out between two rounds.
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

export const ENGAGEMENT_TTL_MS = 5 * 60_000;
/** A ceiling, not a working size: an org has a handful of keys at a time. */
const MAX_ENTRIES = 2_000;

const kept = new Map<string, { expires: number; value: Promise<unknown> }>();
/** Bumped per org by `forgetEngagement`, so a refresh that began before a change does not put the old answer back. */
const generation = new Map<string, number>();
/** Set only for the synchronous call `refreshEngagement` makes. */
let refreshing = false;

const keyOf = (org: string, kind: EngagementKind, params: unknown) => `${org}\u0000${kind}\u0000${JSON.stringify(params ?? null)}`;

function makeRoom(now: number): void {
  if (kept.size < MAX_ENTRIES) return;
  for (const [k, v] of kept) if (v.expires <= now) kept.delete(k);
  if (kept.size >= MAX_ENTRIES) kept.clear();
}

/** `load()`'s answer for this org, kind and params, from memory when it is under five minutes old. */
export function cachedEngagement<T>(org: string, kind: EngagementKind, params: unknown, load: () => Promise<T>): Promise<T> {
  const key = keyOf(org, kind, params);
  const now = Date.now();
  if (refreshing) {
    // A refresh: work it out afresh, and keep it only once it is in, so the
    // answer already kept goes on serving readers meanwhile.
    refreshing = false;
    const gen = generation.get(org) ?? 0;
    const value = load();
    value.then(
      (v) => {
        if ((generation.get(org) ?? 0) !== gen) return;
        makeRoom(Date.now());
        kept.set(key, { expires: Date.now() + ENGAGEMENT_TTL_MS, value: Promise.resolve(v) });
      },
      () => undefined,
    );
    return value;
  }
  const hit = kept.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  makeRoom(now);
  const value = load();
  const entry = { expires: now + ENGAGEMENT_TTL_MS, value: value as Promise<unknown> };
  kept.set(key, entry);
  value.catch(() => {
    if (kept.get(key) === entry) kept.delete(key);
  });
  return value;
}

/**
 * Call one of the pages' own functions (`usageSummary`, `gamesOverview`, …)
 * so that it works its answer out afresh and keeps it under exactly the key a
 * dashboard request for the same thing uses. `ask` must reach
 * `cachedEngagement` before its first await, as every Engagement page does.
 */
export function refreshEngagement<T>(ask: () => Promise<T>): Promise<T> {
  refreshing = true;
  try {
    return ask();
  } finally {
    refreshing = false;
  }
}

/** Drop an org's remembered answers of these kinds (all kinds when none are named). */
export function forgetEngagement(org: string, ...kinds: EngagementKind[]): void {
  generation.set(org, (generation.get(org) ?? 0) + 1);
  const prefixes = kinds.length ? kinds.map((k) => `${org}\u0000${k}\u0000`) : [`${org}\u0000`];
  for (const key of kept.keys()) if (prefixes.some((p) => key.startsWith(p))) kept.delete(key);
}
