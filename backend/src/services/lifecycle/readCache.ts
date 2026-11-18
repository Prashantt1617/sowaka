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
 *
 * The onboarding board's data is the exception to "drops": it is the costly one
 * (every journey's tasks), and dropping it made the first board, count or joiner
 * list after any write read it all again (3–11 s on the database link). A write
 * request notes which journeys it wrote (config/writeTrack.ts), and the kept
 * data is patched for those journeys only (board.ts patchBoardData: their
 * journey, tasks and offer, a few KB) before anyone reads it again; readers wait
 * for the patch, so the writer sees the change at once. A write it cannot place
 * (a filter naming no journey) drops it as before; a write that touched none of
 * the board's records leaves it alone.
 */
import type { NextFunction, Request, Response } from 'express';
import { cachedSwr, dropSwr, refreshSwr, type SwrKind } from '../swr-cache';
import { bumpSuwiVersion } from '../../suwi/kept';
import { noWrites, takeWrites, trackWrites, untracked, wroteAnything, type WritesSeen } from '../../config/writeTrack';

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
  void bumpSuwiVersion(org);
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
  // Not part of the request that scheduled it: its reads and writes are the warm-up's own.
  const timer = untracked(() => setTimeout(() => {
    rewarmTimers.delete(org);
    rewarm?.(org).catch(() => undefined);
  }, REWARM_MS));
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
 * Writes that change only the waiting requests: a leave, overtime, correction or claim made, decided
 * or cancelled (the employee's routes and HR's). For these Suwi's company bundle (suwi/orgData.ts) is
 * not read again whole: only its waiting-request sections are (a few KB, pending rows only), and the
 * rest (People › Tasks, claim types, engagement counts) carries over, since none of these writes can
 * change it. `/admin/reimbursement-types` is not one (the claim types change). A Suwi action marks
 * itself (`res.locals.suwiRequestsOnly`) when it only decides requests (approve_claims).
 */
const REQUEST_WRITES = /^\/(leaves|overtime|reimbursements|attendance\/regularizations)(\/|$)|^\/admin\/(leaves|overtime|reimbursements|regularizations)\//;
export const changesOnlyRequests = (path: string): boolean => REQUEST_WRITES.test(path);

/**
 * Patches the kept onboarding board data for what a write touched (registered by board.ts, which
 * keeps this file free of imports). Without it the board data is dropped like the rest.
 */
export type BoardWrites = Omit<WritesSeen, 'onWrite'>;
type BoardPatch = (org: string | null, writes: BoardWrites) => void;
let boardPatch: BoardPatch | null = null;
export function setBoardPatch(fn: BoardPatch | null): void {
  boardPatch = fn;
}
const BOARD_KIND: SwrKind = 'lc-board-data';

/** The kept board data after a write: left alone (nothing of it written), patched, or dropped (a write it cannot place). */
function settleBoard(org: string | null, writes: BoardWrites): void {
  if (!wroteAnything(writes)) return;
  if (writes.unknown || !enabled || !boardPatch) { dropSwr(org, [BOARD_KIND]); return; }
  boardPatch(org, writes);
}

/**
 * Patches Suwi's company bundle after a request write (registered by suwi/orgData.ts, which keeps this
 * file free of imports). Called before the drop, so it can take the kept bundle; returns what to start
 * once the drop is done (a refresh readers join), or null when there is nothing kept to patch.
 */
type OrgDataPatch = (org: string, bumped: Promise<void>) => (() => void) | null;
let orgDataPatch: OrgDataPatch | null = null;
export function setSuwiOrgDataPatch(fn: OrgDataPatch | null): void {
  orgDataPatch = fn;
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
  // Read now: by the time the response ends, routing may have rewritten the path.
  const requestsOnly = changesOnlyRequests(req.path);
  // What this request writes to the board's records (journeys, tasks, offers, people).
  const writes = noWrites();
  const orgOf = () => (req as Request & { auth?: { user?: { org?: string } } }).auth?.user?.org;
  let dropped = false;
  const drop = (): Promise<void> | null => {
    if (dropped) return null;
    dropped = true;
    const org = orgOf();
    const board = kinds.includes(BOARD_KIND);
    if (board) settleBoard(org || null, takeWrites(writes));
    // A write still running after the answer went out (one left unawaited) patches again when it lands.
    let later: NodeJS.Timeout | null = null;
    writes.onWrite = () => {
      if (later || !board) return;
      later = setTimeout(() => { later = null; settleBoard(org || null, takeWrites(writes)); }, 0);
      later.unref();
    };
    // Suwi's copies in Redis (suwi/kept.ts) are keyed by a data version: bump it before the response
    // goes out, so the next question anywhere misses them. Waits at most a moment for Redis.
    const patchOnly = requestsOnly || (res.locals as { suwiRequestsOnly?: boolean } | undefined)?.suwiRequestsOnly === true;
    const bump = kinds.some((k) => SUWI_KINDS.includes(k)) ? bumpSuwiVersion(org || null, { requestsOnly: patchOnly && Boolean(org) }) : null;
    // Taken before the drop (it needs the kept bundle), started after it (so it lands as the new copy).
    const patch = enabled && org && bump && patchOnly && orgDataPatch ? orgDataPatch(org, bump) : null;
    dropSwr(org || null, kinds.filter((k) => k !== BOARD_KIND));
    patch?.();
    if (org) scheduleRewarm(org);
    return bump;
  };
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  // res.json and res.send both finish in res.end; dropping there covers every way out.
  (res as unknown as { end: (...args: unknown[]) => Response }).end = (...args: unknown[]) => {
    const bump = drop();
    if (!bump) return end(...args);
    void Promise.race([bump, new Promise((r) => setTimeout(r, 300))]).then(() => end(...args));
    return res;
  };
  trackWrites(writes, next);
}
