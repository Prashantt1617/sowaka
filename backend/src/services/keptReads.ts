/**
 * Kept copies of the slow reads outside the lifecycle, on the same footing as the lifecycle boards
 * and the Time office lists (lifecycle/readCache.ts over swr-cache): fresh for a minute, then served
 * at once while one refresh runs behind the reader; dropped before the response of any write that
 * can change them goes out; off in scripts and checks, which read live.
 *
 * What is kept, and where it is dropped:
 *  - People › Employees' rows (`adm-employees`, per company): the raw records, never the finished
 *    list, so photo and document links are signed afresh on every request. Dropped by every company
 *    write (readCache KEPT_READ_KINDS).
 *  - A payroll run's payslips with their year to date and its people's bank rows as stored, still
 *    encrypted (`pay-run`, per company and run: payrollRun.service getRun). Dropped by every company
 *    write; a run, its payslips and bank details change only through those.
 *  - A person's own Payroll home, salary and earnings (`pay-home`, `pay-salary`, `pay-earnings`): kept
 *    per person under their own userId, never shared (salary data); keyed by the India day, since the
 *    estimate counts to yesterday and every due date is a day. Dropped by every company write (HR's,
 *    a manager's decision) and by any write of the person's own, punches included (readCache
 *    forgetReadsOnWrite: dropSwrForPerson).
 *
 * The Games list and the Games home page are kept too, by version (game-catalog.service,
 * app-page.service): Sowaka's scripts change them, not the API.
 */
import { users } from '../config/db';
import { requestUserFor } from './request-user';
import { cachedLifecycle, lifecycleReadCacheOn } from './lifecycle/readCache';
import type { SwrKind } from './swr-cache';

/** The company of a signed-in caller, from the request when it is them. */
export async function companyOfCaller(userId: string): Promise<string | undefined> {
  const known = requestUserFor(userId)?.org;
  if (known) return known;
  const row = await users().findOne({ userId }, { projection: { _id: 0, org: 1 } });
  return row?.org;
}

/** `load()`'s answer kept for the caller's company (shared by everyone there who may read it); live when the cache is off or there is no company. */
export async function keptForCompanyOf<T>(callerUserId: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  if (!lifecycleReadCacheOn()) return load();
  const org = await companyOfCaller(callerUserId);
  return org ? cachedLifecycle(org, kind, params, load) : load();
}

const IST_OFFSET_MS = 330 * 60_000;
/** Today in India. */
export const istDayKey = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * `load()`'s answer kept for this one person (their own payroll screens), under their userId and
 * today's India day. Never handed to anyone else: the key is theirs alone. A caller that passes its
 * own `now` (a check working out another day) is never kept.
 */
export function keptForPerson<T>(org: string, userId: string, kind: SwrKind, params: Record<string, unknown>, load: () => Promise<T>, nowGiven = false): Promise<T> {
  if (!lifecycleReadCacheOn() || nowGiven || !org || !userId) return load();
  return cachedLifecycle(org, kind, { userId, day: istDayKey(), ...params }, load);
}
