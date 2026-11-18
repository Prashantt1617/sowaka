/**
 * Which lifecycle records a request wrote, so the kept onboarding board data (lifecycle/board.ts,
 * kept by lifecycle/readCache.ts) can be patched for those journeys instead of dropped and read
 * again whole after every write.
 *
 * A write request runs inside `trackWrites` (readCache's forgetReadsOnWrite); while it does, the
 * collections the board is built from (journeys, their tasks, offers, people) note each write they
 * make: the journey ids, task ids or offer ids its filter or document names, or "people" for any
 * write to users (names, photos, roles). A write whose filter names none of these (an updateMany by
 * org, say) marks the request `unknown`, and the kept board is then dropped as before: nothing is
 * ever patched on a guess. Outside a tracked request (scripts, the scheduler's jobs, reads) the
 * collections are returned as they are, so this costs nothing there.
 *
 * Kept free of imports from the services (config/db.ts imports it).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Collection, Document } from 'mongodb';

export type TrackedKind = 'journeys' | 'tasks' | 'offers' | 'users';

/** What one request wrote so far. */
export interface WritesSeen {
  journeyIds: Set<string>;
  taskIds: Set<string>;
  offerIds: Set<string>;
  /** Any write to users: the board's names and photos may have changed. */
  people: boolean;
  /** A write to a tracked collection whose filter named no record: the kept board must be dropped. */
  unknown: boolean;
  /** Called on a write noted after the request's answer went out (a write left running): set by the reader. */
  onWrite?: () => void;
}

export const noWrites = (): WritesSeen => ({ journeyIds: new Set(), taskIds: new Set(), offerIds: new Set(), people: false, unknown: false });

/** Takes what was written so far and starts again (what a later write adds is noted from empty). */
export function takeWrites(w: WritesSeen): Omit<WritesSeen, 'onWrite'> {
  const out = { journeyIds: new Set(w.journeyIds), taskIds: new Set(w.taskIds), offerIds: new Set(w.offerIds), people: w.people, unknown: w.unknown };
  w.journeyIds.clear(); w.taskIds.clear(); w.offerIds.clear(); w.people = false; w.unknown = false;
  return out;
}

export const wroteAnything = (w: Omit<WritesSeen, 'onWrite'>) => w.unknown || w.people || w.journeyIds.size > 0 || w.taskIds.size > 0 || w.offerIds.size > 0;

const store = new AsyncLocalStorage<WritesSeen>();

/** Runs `fn` (and everything it starts) with its writes noted in `writes`. */
export function trackWrites<T>(writes: WritesSeen, fn: () => T): T {
  return store.run(writes, fn);
}

/** Runs `fn` outside any tracked request: for background work a request only schedules (the rewarm). */
export function untracked<T>(fn: () => T): T {
  return store.exit(fn);
}

const WRITES = new Set(['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite']);

/** The ids a filter value names: a string, or `{ $in: [strings] }`. */
function idsOf(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  const list = value && typeof value === 'object' ? (value as { $in?: unknown }).$in : undefined;
  if (Array.isArray(list) && Object.keys(value as object).length === 1 && list.every((x) => typeof x === 'string')) return list as string[];
  return null;
}

function noteFilter(w: WritesSeen, kind: TrackedKind, filter: unknown): void {
  const f = (filter ?? {}) as Record<string, unknown>;
  const journeyIds = kind === 'journeys' ? idsOf(f.id) : idsOf(f.journeyId);
  if (journeyIds) { for (const id of journeyIds) w.journeyIds.add(id); return; }
  const own = kind !== 'journeys' ? idsOf(f.id) : null;
  if (own) { for (const id of own) (kind === 'tasks' ? w.taskIds : w.offerIds).add(id); return; }
  w.unknown = true;
}

function noteDocument(w: WritesSeen, kind: TrackedKind, doc: unknown): void {
  const d = (doc ?? {}) as Record<string, unknown>;
  const id = kind === 'journeys' ? d.id : d.journeyId;
  if (typeof id === 'string') w.journeyIds.add(id);
  else w.unknown = true;
}

function note(w: WritesSeen, kind: TrackedKind, method: string, args: unknown[]): void {
  if (kind === 'users') w.people = true;
  else if (method === 'insertOne') noteDocument(w, kind, args[0]);
  else if (method === 'insertMany') for (const doc of (args[0] as unknown[]) ?? []) noteDocument(w, kind, doc);
  else if (method === 'bulkWrite') {
    for (const op of (args[0] as Record<string, Record<string, unknown>>[]) ?? []) {
      const [name, body] = Object.entries(op)[0] ?? [];
      if (!body) continue;
      if (name === 'insertOne') noteDocument(w, kind, body.document);
      // A task replaced whole names its journey: better than its own id (no look-up needed).
      else if (name === 'replaceOne' && body.replacement && typeof (body.replacement as Record<string, unknown>)[kind === 'journeys' ? 'id' : 'journeyId'] === 'string') noteDocument(w, kind, body.replacement);
      else noteFilter(w, kind, body.filter);
    }
  } else noteFilter(w, kind, args[0]);
  w.onWrite?.();
}

/**
 * The collection as it is, or (inside a tracked request) one whose writes are noted once they
 * have run (failed ones too: part of a write may have landed).
 */
export function tracked<T extends Document>(kind: TrackedKind, collection: Collection<T>): Collection<T> {
  const w = store.getStore();
  if (!w) return collection;
  return new Proxy(collection, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !WRITES.has(prop)) return (value as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]) => Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args)).then(
        (result) => { note(w, kind, prop, args); return result; },
        (error: unknown) => { note(w, kind, prop, args); throw error; },
      );
    },
  });
}
