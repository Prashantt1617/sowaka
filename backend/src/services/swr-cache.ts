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
export type SwrKind = 'ool'
  // Employee lifecycle and Suwi (lifecycle/readCache.ts): dropped on every write, see there.
  | 'lc-board-data' | 'off-board-data' | 'suwi-notices'
  // Suwi's company-wide inputs (suwi/orgData.ts): the waiting requests and today's lists, shared by every viewer.
  | 'suwi-org-data'
  // The manager workspace's company roster (manager.service.ts workspaceRoster), and the inline photos it leaves out, per person.
  | 'mgr-roster' | 'mgr-photos'
  // Time office lists (timeOfficeLists.ts): corrections, leave requests, overtime, feedback.
  | 'adm-regs' | 'adm-leaves' | 'adm-overtime' | 'adm-feedback'
  // People › Employees' rows (keptReads.ts), and a payroll run's payslips with the year to date behind them.
  | 'adm-employees' | 'pay-run'
  // One person's own payroll screens (keptReads.ts): kept per person, params carry the userId.
  | 'pay-home' | 'pay-salary' | 'pay-earnings'
  // The Games list and the Games home page (keptReads.ts): Sowaka's scripts change them, so they are checked by version.
  | 'games-catalog' | 'app-page';

const FRESH_MS = 60_000;
const MAX_STALE_MS = 15 * 60_000;
/**
 * A ceiling, not a working size: an org has a handful of company-wide keys, plus one per person
 * for each of their own payroll screens they opened in the last quarter hour.
 */
const MAX_ENTRIES = 20_000;

/**
 * `pending`: a load or refresh under way. `patching`: a write's patch of the kept value under way
 * (patchSwr): readers wait for it (a few small reads), so a change shows to whoever made it at once.
 */
type Entry = { at: number; value?: unknown; pending?: Promise<unknown>; patching?: Promise<unknown> };
const kept = new Map<string, Entry>();
/**
 * Bumped by a forget or drop, so a refresh that began before a change does not put the old answer back:
 * per org (a forget of everything) and per org and kind (a drop of some kinds), so dropping one kind
 * never throws away a refresh of another (Suwi's company bundle patched while the Time office lists drop).
 */
const generation = new Map<string, number>();
const kindOf = (key: string) => key.split('\u0000')[1];
/** The person an answer is kept for (params with a `userId`: their own payroll screens), else ''. */
const personOf = (key: string): string => {
  const params = key.split('\u0000').slice(2).join('\u0000');
  if (!params.startsWith('{"userId":')) return '';
  const parsed = JSON.parse(params) as { userId?: unknown };
  return typeof parsed.userId === 'string' ? parsed.userId : '';
};
const personGenKey = (org: string, kind: string, userId: string) => `${org}\u0000${kind}\u0000@${userId}`;
const genOf = (org: string, kind: string, person = '') => (generation.get(org) ?? 0) + (generation.get(`${org}\u0000${kind}`) ?? 0)
  + (person ? generation.get(personGenKey(org, kind, person)) ?? 0 : 0);
const bump = (genKey: string) => generation.set(genKey, (generation.get(genKey) ?? 0) + 1);

const keyOf = (org: string, kind: SwrKind, params: unknown) => `${org}\u0000${kind}\u0000${JSON.stringify(params ?? null)}`;

function makeRoom(): void {
  if (kept.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of kept) if (!v.pending && now - v.at > MAX_STALE_MS) kept.delete(k);
  // Still full: the oldest tenth goes (a Map iterates in the order keys were first kept), never all of it.
  let over = kept.size - Math.floor(MAX_ENTRIES * 0.9);
  for (const [k, v] of kept) {
    if (over <= 0) break;
    if (v.pending) continue;
    kept.delete(k);
    over -= 1;
  }
}

function start<T>(org: string, key: string, load: () => Promise<T>): Promise<T> {
  const person = personOf(key);
  const gen = genOf(org, kindOf(key), person);
  const entry = kept.get(key) ?? { at: 0 };
  const pending = load().then(
    (value) => {
      if (genOf(org, kindOf(key), person) === gen) {
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
  // A write's patch is landing: its answer, as soon as it is there (a failed patch drops the entry: load).
  if (hit?.patching) return (hit.patching as Promise<T>).catch(() => cachedSwr(org, kind, params, load));
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

/** The kept answer if there is a usable one, without loading anything (undefined otherwise). */
export function peekSwr<T>(org: string, kind: SwrKind, params: unknown): T | undefined {
  const hit = kept.get(keyOf(org, kind, params));
  return hit?.value !== undefined && Date.now() - hit.at < MAX_STALE_MS ? (hit.value as T) : undefined;
}

/** A load or refresh under way for this org, kind and params, if any (a reader that would otherwise read for itself can wait on it). */
export function pendingSwr<T>(org: string, kind: SwrKind, params: unknown): Promise<T> | undefined {
  return kept.get(keyOf(org, kind, params))?.pending as Promise<T> | undefined;
}

/** Every usable kept answer of this kind for one org, with the params it was kept under. */
export function keptOfKind<T>(org: string, kind: SwrKind): { params: unknown; value: T }[] {
  const prefix = `${org}\u0000${kind}\u0000`;
  const now = Date.now();
  const out: { params: unknown; value: T }[] = [];
  for (const [key, entry] of kept) {
    if (!key.startsWith(prefix) || entry.value === undefined || now - entry.at >= MAX_STALE_MS) continue;
    out.push({ params: JSON.parse(key.slice(prefix.length)), value: entry.value as T });
  }
  return out;
}

/**
 * A write changed part of what is kept: `patch` works the new value out from the kept one (reading
 * only what the write touched) instead of the whole answer being dropped and read again. Readers
 * wait for the patch; patches from writes in a row apply one after the other. A load or refresh that
 * began before the write is not kept when it lands (it may have read the old data). The entry keeps
 * its age, so it is still refreshed whole behind the reader after its minute, which mends anything a
 * patch could not see. With nothing usable kept (or only a first load under way) there is nothing to
 * patch: the entry is dropped as `dropSwr` would, and false is returned.
 */
export function patchSwr<T>(org: string, kind: SwrKind, params: unknown, patch: (value: T) => Promise<T>): boolean {
  const key = keyOf(org, kind, params);
  const hit = kept.get(key);
  bump(`${org}\u0000${kind}`);
  const usable = hit && (hit.patching || (hit.value !== undefined && Date.now() - hit.at < MAX_STALE_MS));
  if (!hit || !usable) {
    kept.delete(key);
    return false;
  }
  const gen = genOf(org, kind);
  const base = (hit.patching ?? Promise.resolve(hit.value)) as Promise<T>;
  const patching: Promise<T> = base.then(patch).then(
    (value) => {
      // A later patch carries on from this one and keeps its own result; a drop since then wins.
      if (kept.get(key)?.patching === patching && genOf(org, kind) === gen) kept.set(key, { at: hit.at, value });
      return value;
    },
    (error: unknown) => {
      if (kept.get(key)?.patching === patching) kept.delete(key);
      throw error;
    },
  );
  patching.catch(() => undefined);
  kept.set(key, { at: hit.at, value: hit.value, patching });
  return true;
}

/** The orgs keeping any answer of this kind (a write with no company patches each of them). */
export function orgsKeeping(kind: SwrKind): string[] {
  const orgs = new Set<string>();
  for (const key of kept.keys()) {
    const [o, k] = key.split('\u0000');
    if (k === kind) orgs.add(o);
  }
  return [...orgs];
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

/**
 * Drop these kinds of kept answers for one org, or for every org that has any (`org` null),
 * without the Punch log listeners `forgetSwr` also runs: for writes that cannot touch punches.
 * A refresh already under way for that org is not kept when it lands.
 */
export function dropSwr(org: string | null, kinds: SwrKind[]): void {
  const orgs = new Set<string>();
  for (const key of kept.keys()) {
    const [o, k] = key.split('\u0000');
    if ((org === null || o === org) && kinds.includes(k as SwrKind)) orgs.add(o);
  }
  if (org !== null) orgs.add(org);
  for (const o of orgs) {
    for (const k of kinds) bump(`${o}\u0000${k}`);
    const prefixes = kinds.map((k) => `${o}\u0000${k}\u0000`);
    for (const key of kept.keys()) if (prefixes.some((p) => key.startsWith(p))) kept.delete(key);
  }
}

/**
 * Drop these kinds of kept answers for one person of an org (answers kept with `userId` in their
 * params): for a write of theirs that can change only their own (a punch). A refresh of that kind
 * already under way for the org is not kept when it lands.
 */
export function dropSwrForPerson(org: string, kinds: SwrKind[], userId: string): void {
  for (const k of kinds) {
    const prefix = `${org}\u0000${k}\u0000`;
    for (const key of [...kept.keys()]) {
      if (key.startsWith(prefix) && personOf(key) === userId) kept.delete(key);
    }
    // A load of theirs may be under way: their own counter keeps it from landing (no one else's).
    bump(personGenKey(org, k, userId));
  }
}

/** Drop an org's kept answers (of these kinds, or all), so the next read reflects a change at once. */
export function forgetSwr(org: string, ...kinds: SwrKind[]): void {
  for (const listener of forgetListeners) listener(org);
  if (kinds.length) for (const k of kinds) bump(`${org}\u0000${k}`);
  else bump(org);
  const prefixes = kinds.length ? kinds.map((k) => `${org}\u0000${k}\u0000`) : [`${org}\u0000`];
  for (const key of kept.keys()) if (prefixes.some((p) => key.startsWith(p))) kept.delete(key);
}

/**
 * `forgetSwr(org)` for every kind but these: for a change whose own write hook looks after them
 * (a leave or correction decided: readCache patches Suwi's company bundle rather than dropping it).
 */
export function forgetSwrExcept(org: string, except: SwrKind[]): void {
  for (const listener of forgetListeners) listener(org);
  const prefix = `${org}\u0000`;
  const kinds = new Set<string>();
  for (const key of kept.keys()) if (key.startsWith(prefix) && !except.includes(kindOf(key) as SwrKind)) kinds.add(kindOf(key));
  for (const k of kinds) bump(`${org}\u0000${k}`);
  for (const key of [...kept.keys()]) if (key.startsWith(prefix) && kinds.has(kindOf(key))) kept.delete(key);
}
