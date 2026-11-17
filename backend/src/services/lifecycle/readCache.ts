/**
 * The employee-lifecycle boards and Suwi's notices, kept in memory the way the
 * Time office pages and Engagement are (swr-cache: fresh for a minute, then
 * served at once while one refresh runs behind the reader; the warm-up round
 * keeps them fresh).
 *
 * What is kept is the RAW data a board is built from (journeys, their tasks,
 * offers' valid-till, people's names), never a finished board: cards, flags,
 * columns and "late" are worked out on every request with the current time, so
 * a day boundary or a due time passing shows at once.
 *
 * Consistency comes first, because the dashboard, the app and the portal must
 * show the same thing: every write drops these answers BEFORE its response goes
 * out (`forgetReadsOnWrite`, mounted on the API router for every non-GET), and
 * so does each run of the lifecycle jobs (`forgetLifecycleReads(null)`), which
 * change journeys without a request. A refresh that began before a write is not
 * kept when it lands (swr-cache's generation). What can still lag, by at most
 * the minute: a change made outside the API (a script) or by the clock alone
 * in data no request touches.
 */
import type { NextFunction, Request, Response } from 'express';
import { cachedSwr, dropSwr, refreshSwr, type SwrKind } from '../swr-cache';

/** Time office lists (timeOfficeLists.ts): dropped by the same writes as the boards. */
export const TIME_OFFICE_LIST_KINDS: SwrKind[] = ['adm-regs', 'adm-leaves', 'adm-overtime', 'adm-feedback'];
export const LIFECYCLE_READ_KINDS: SwrKind[] = ['lc-board-data', 'off-board-data', 'suwi-notices', 'suwi-org-data', 'mgr-roster', ...TIME_OFFICE_LIST_KINDS];
const SUWI_KINDS: SwrKind[] = ['suwi-notices', 'suwi-org-data'];

/**
 * Off until the API server switches it on (server.ts). Scripts and checks call the services
 * directly, writes included, with no request to drop a kept answer, so they always read live.
 */
let enabled = false;
export function enableLifecycleReadCache(on = true): void {
  enabled = on;
  if (!on) forgetLifecycleReads(null);
}
export const lifecycleReadCacheOn = () => enabled;

/** Drop the kept lifecycle and Suwi answers of one org, or of every org (`null`). */
export function forgetLifecycleReads(org: string | null): void {
  dropSwr(org, LIFECYCLE_READ_KINDS);
  if (org) scheduleRewarm(org);
}

/**
 * After a change drops a company's kept answers, they are worked out again a few seconds later in the
 * background, so the next viewer (often a limited-role HR) finds them ready instead of paying the cold
 * read. Coalesced per company: a burst of writes makes one rebuild, 3 s after the last. A rebuild that
 * began before a later write is not kept (swr-cache's generation), so nothing stale is ever served.
 * The work itself is the warm-up's (warm.ts registers it, which keeps this file free of imports).
 */
/**
 * Drop only a company's kept Time office lists: for changes that don't come through a dropping
 * route (a punch outside the office opens a correction request; a later punch-out completes it).
 */
export function forgetTimeOfficeListReads(org: string): void {
  dropSwr(org, TIME_OFFICE_LIST_KINDS);
  scheduleRewarm(org);
}

const REWARM_MS = 3_000;
const rewarmTimers = new Map<string, NodeJS.Timeout>();
let rewarm: ((org: string) => Promise<unknown>) | null = null;
export function setLifecycleRewarm(fn: ((org: string) => Promise<unknown>) | null): void {
  rewarm = fn;
}
export function scheduleRewarm(org: string): void {
  if (!enabled || !rewarm) return;
  const before = rewarmTimers.get(org);
  if (before) clearTimeout(before);
  const timer = setTimeout(() => {
    rewarmTimers.delete(org);
    rewarm?.(org).catch(() => undefined);
  }, REWARM_MS);
  timer.unref();
  rewarmTimers.set(org, timer);
}
/** For checks: the companies with a rebuild waiting. */
export const pendingRewarms = () => [...rewarmTimers.keys()];

/** The kept answer for this org and kind, or `load()`'s. */
export function cachedLifecycle<T>(org: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  return enabled ? cachedSwr(org, kind, params, load) : load();
}

/** Work it out again now and keep it (the warm-up's way in). */
export function refreshLifecycle<T>(org: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  return enabled ? refreshSwr(org, kind, params, load) : load();
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Writes that can change none of these answers, left alone so a busy company's punches, games,
 * likes and pushes do not empty its kept boards every few seconds: punching, games and rooms,
 * notifications, uploads of media, sign-in, help and support, and Suwi's read-only POSTs (a question,
 * a people search: they change no data; a confirmed Suwi action does, and still drops). Connect writes can complete a
 * lifecycle task (the welcome post), so they drop the boards, but not Suwi's notices.
 */
const NEVER_LIFECYCLE = /^\/(attendance\/punch|games|play|notifications|relay|cup|poker|squad|talk|garden|face|media|app(\/|$)|care|help|support|auth|suwi\/ask|suwi\/people-search)(\/|$)/;
const NOT_SUWI = /^\/connect(\/|$)/;

/** Which kept answers a write to this path can change. */
export function kindsChangedBy(path: string): SwrKind[] {
  if (NEVER_LIFECYCLE.test(path)) return [];
  if (NOT_SUWI.test(path)) return LIFECYCLE_READ_KINDS.filter((k) => !SUWI_KINDS.includes(k));
  return LIFECYCLE_READ_KINDS;
}

/**
 * Every write through the API that can change a board or Suwi's notices drops those answers for
 * the writer's company (every company when the request names none: a candidate on the portal)
 * just before the response is sent, so the next read anywhere (dashboard, app, portal) is worked
 * out afresh. Failed writes drop too: one may have written part of its change before it failed.
 */
export function forgetReadsOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (READS.has(req.method)) { next(); return; }
  const kinds = kindsChangedBy(req.path);
  if (!kinds.length) { next(); return; }
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    const org = (req as Request & { auth?: { user?: { org?: string } } }).auth?.user?.org;
    dropSwr(org || null, kinds);
    if (org) scheduleRewarm(org);
  };
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  // res.json and res.send both finish in res.end; dropping there covers every way out.
  (res as unknown as { end: (...args: unknown[]) => Response }).end = (...args: unknown[]) => { drop(); return end(...args); };
  next();
}
