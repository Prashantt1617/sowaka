/**
 * Suwi's tools, kept: what every read-only tool answered, per person and per company data version, in
 * memory and in Redis (kept.ts), so a tool asked again on unchanged data answers in milliseconds instead
 * of re-reading the database over the slow Atlas link (time there is bytes read).
 *
 *   - Keyed by the company's data version (suwiDataVersion), which the write hook bumps before any change
 *     Suwi reads from is answered (lifecycle/readCache.ts): a change always misses, nothing is deleted.
 *   - Keyed by the person asking: tools run as them, with their access, their team, their payroll right.
 *   - Never kept: tools that prepare a change (`acts`), an answer carrying a prepared change, a question
 *     with a spreadsheet attached, or an answer too big to keep.
 *   - Backstops for what the hook can't see: today's attendance changes with every punch (no hook), so
 *     attendance tools and `live` answers are kept a minute; Connect writes don't bump Suwi's version,
 *     so Connect tools are kept two minutes; anything else ten (cron jobs that change data without a request).
 *
 * The answer is always the JSON form (dates as ISO strings), whether it was just worked out or kept, so a
 * kept answer and a fresh one look the same to every caller.
 *
 * Also here: the shared people bundle (everyone on the company's active roll, the fields the people tools
 * read), and the background pre-run of the heavier tools for the people who use Suwi.
 */
import { users } from '../config/db';
import { logger } from '../utils/logger';
import { lifecycleReadCacheOn } from '../services/lifecycle/readCache';
import { hashOf, keptGet, keptSet, suwiDataVersion, suwiPeopleVersion } from './kept';
import type { SuwiContext, SuwiTool, ToolOutput } from './tools';
import { yieldToLive } from '../services/background-pace';

const MAX_KEEP_CHARS = 400_000;
const MAX_MEMORY_ENTRIES = 3_000;

/** For checks: the cache follows the lifecycle read cache (switched on by server.ts), or this override. */
let forced: boolean | null = null;
export function setSuwiToolCache(on: boolean | null): void { forced = on; }
const cacheOn = () => (forced === null ? lifecycleReadCacheOn() : forced);

const memory = new Map<string, { until: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function memGet<T>(key: string): T | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.until < Date.now()) { memory.delete(key); return undefined; }
  return hit.value as T;
}
function memSet(key: string, value: unknown, ttlSeconds: number): void {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    // Oldest first: a Map iterates in insertion order.
    const drop = Math.ceil(MAX_MEMORY_ENTRIES / 10);
    for (const k of memory.keys()) { memory.delete(k); if (memory.size <= MAX_MEMORY_ENTRIES - drop) break; }
  }
  memory.set(key, { until: Date.now() + ttlSeconds * 1000, value });
}

/** For checks: forget the in-process copies (as a restart would), keeping Redis's. */
export function __clearMemoryForCheck(): void { memory.clear(); }

/** Stable JSON: the same input in a different key order is the same call. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

function ttlFor(t: SuwiTool, out: ToolOutput): number {
  if (out.live || t.area === 'attendance') return 60;
  if (t.area === 'connect') return 120;
  return 600;
}

/** Counts for checks and the timing view: how often a tool answered from memory, Redis, or the database. */
export const toolCacheStats = { memory: 0, redis: 0, miss: 0 };

/**
 * The tool's answer, kept or worked out. `run` is the tool's own body.
 */
export async function cachedToolRun(t: SuwiTool, ctx: SuwiContext, input: Record<string, unknown>, run: () => Promise<ToolOutput>): Promise<ToolOutput> {
  if (!cacheOn() || t.acts || ctx.sheet) return run();
  const version = await suwiDataVersion(ctx.org);
  const key = `tool:${ctx.org}:${version}:${hashOf(t.name, stableJson(input ?? {}), ctx.userId, ctx.payroll, ctx.today, ctx.levels?.[t.area] ?? '')}`;
  const mem = memGet<ToolOutput>(key);
  if (mem) { toolCacheStats.memory++; return mem; }
  const pending = inflight.get(key) as Promise<ToolOutput> | undefined;
  if (pending) return pending;
  const p = (async () => {
    const kept = await keptGet<{ out: ToolOutput; ttl: number }>(key);
    if (kept?.out) { toolCacheStats.redis++; memSet(key, kept.out, kept.ttl); return kept.out; }
    toolCacheStats.miss++;
    const fresh = await run();
    const json = JSON.stringify(fresh ?? null);
    const out = JSON.parse(json) as ToolOutput;
    if (!out.proposalId && !out.proposalIds?.length && json.length <= MAX_KEEP_CHARS) {
      const ttl = ttlFor(t, out);
      memSet(key, out, ttl);
      void keptSet(key, { out, ttl }, ttl);
    }
    return out;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// ─── The people bundle ──────────────────────────────────────────────────────

/** A whole user record without what can be megabytes (old inline photos, the enrolled face, document lists). */
export const LIGHT_USER = { _id: 0, profilePhotoUrl: 0, faceId: 0, documents: 0 } as const;

export const ACTIVE_FILTER = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
/** Every field the people tools read (people.ts roster, connect.ts activeRoster); never photos, face data, documents or pay. */
const PEOPLE_FIELDS = ['userId', 'name', 'employeeId', 'email', 'designation', 'department', 'location', 'branch', 'managerUserId', 'employeeType', 'joiningDate', 'gender', 'phone', 'birthday', 'lifecycleStatus', 'isDirector'] as const;
const PEOPLE_PROJECTION = Object.fromEntries([['_id', 0], ...PEOPLE_FIELDS.map((f) => [f, 1])]);
const DATE_FIELDS = ['joiningDate', 'birthday'] as const;
const PEOPLE_TTL_S = 600;

type PersonRow = Record<string, unknown> & { userId: string };

function reviveDates(rows: PersonRow[]): PersonRow[] {
  for (const r of rows) for (const f of DATE_FIELDS) if (typeof r[f] === 'string') r[f] = new Date(r[f] as string);
  return rows;
}

/**
 * Everyone on the company's active roll with the fields the people tools read, kept per people version
 * (a person added, edited or moved bumps it through the write hook; a request write does not). Read straight from the database
 * when the cache is off (scripts and checks).
 */
export async function peopleBundle(org: string): Promise<PersonRow[]> {
  const load = () => users().find({ org, ...ACTIVE_FILTER } as never, { projection: PEOPLE_PROJECTION }).toArray() as unknown as Promise<PersonRow[]>;
  if (!cacheOn()) return load();
  // The people version: a request write (leave decided, claim made) leaves the roster kept.
  const key = `people:${org}:${await suwiPeopleVersion(org)}`;
  const mem = memGet<PersonRow[]>(key);
  if (mem) return mem;
  const pending = inflight.get(key) as Promise<PersonRow[]> | undefined;
  if (pending) return pending;
  const p = (async () => {
    const kept = await keptGet<PersonRow[]>(key);
    if (kept) { const rows = reviveDates(kept); memSet(key, rows, PEOPLE_TTL_S); return rows; }
    const rows = await load();
    memSet(key, rows, PEOPLE_TTL_S);
    void keptSet(key, rows, PEOPLE_TTL_S);
    return rows;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/** The bundle's rows with only these fields: callers get the shape their own projection gave. */
export async function peopleWith<T>(org: string, fields: readonly string[]): Promise<T[]> {
  const rows = await peopleBundle(org);
  return rows.map((r) => Object.fromEntries(fields.filter((f) => r[f] !== undefined).map((f) => [f, r[f]]))) as T[];
}

// ─── Background pre-run ─────────────────────────────────────────────────────

const PRERUN_GAP_MS = 5 * 60_000;
const lastPrerun = new Map<string, string>();
/** For checks: forget when each company was last asked ahead. */
export function __resetPrerunForCheck(): void { lastPrerun.clear(); }

/** The read-only tools that need no input: the ones worth asking ahead, with the asker's own access. */
export function prerunnable(tools: SuwiTool[]): SuwiTool[] {
  return tools.filter((t) => {
    if (t.acts) return false;
    const required = (t.input_schema as { required?: unknown }).required;
    return !Array.isArray(required) || required.length === 0;
  });
}

/**
 * Tools that answer from the company bundle (suwi/orgData.ts) with no reads of their own: asking them
 * ahead costs next to nothing, so they are asked on every new data version, within the five minutes too
 * (after a request write, the patched bundle is ready in a fraction of a second and these follow it).
 */
const FROM_BUNDLE = new Set(['review_requests', 'pending_requests', 'claims_to_check', 'missing_details']);

/**
 * Asks each recent Suwi user's no-input tools ahead (once per data version; the heavier ones at most
 * every five minutes per company), so their first question after a change finds the answers kept.
 * One tool at a time.
 */
export async function prerunTools(
  org: string,
  people: SuwiContext[],
  toolsFor: (ctx: SuwiContext) => SuwiTool[],
  isStopping: () => boolean = () => false,
): Promise<number> {
  if (!cacheOn() || !people.length) return 0;
  const version = await suwiDataVersion(org);
  const last = lastPrerun.get(org);
  if (last && last.startsWith(`${version}@`)) return 0;
  const lastAt = last ? Number(last.split('@')[1]) : 0;
  const withinGap = Date.now() - lastAt < PRERUN_GAP_MS;
  // Within the gap only the bundle's tools, and the gap still runs from the last full round.
  lastPrerun.set(org, `${version}@${withinGap ? lastAt : Date.now()}`);
  let ran = 0;
  for (const ctx of people) {
    for (const t of prerunnable(toolsFor(ctx)).filter((x) => !withinGap || FROM_BUNDLE.has(x.name))) {
      if (isStopping()) return ran;
      // One tool at a time, each after a quiet moment: live requests first (background-pace.ts).
      await yieldToLive(isStopping);
      try { await t.run(ctx, {}); ran++; } catch { /* a tool that needs its input after all: skipped */ }
    }
  }
  logger.info('Suwi tools asked ahead', { org, ran });
  return ran;
}
