/**
 * Time office › Attendance corrections, Leave requests, Overtime and Feedback,
 * kept in memory per company the way the lifecycle boards are (swr-cache via
 * lifecycle/readCache.ts).
 *
 * On the throttled database link a list costs its bytes: the corrections list
 * reads a company's whole correction history (660 rows, ~250 KB at Convrse,
 * 5.8 s) and Leave requests ~2 s. These lists are the same for every dashboard
 * viewer of a company (they are scoped by org only), so one copy per company
 * serves them all.
 *
 * Kept fresh by:
 *  - every API write that can change them dropping them (readCache.forgetReadsOnWrite,
 *    whose kinds include TIME_OFFICE_LIST_KINDS), then a rebuild a few seconds later;
 *  - the writes that don't come through a dropping route calling
 *    `forgetTimeOfficeLists` themselves: a punch outside the office opens a
 *    correction request and a later punch-out completes it (attendance and
 *    face punches are not dropping routes, so busy companies don't empty their
 *    kept boards on every punch);
 *  - swr-cache's own minute: older than that, the copy is served while a
 *    refresh runs behind the reader.
 *
 * Live punch state is never served from the copy: a correction row shows what
 * the device recorded for its day, and today's and yesterday's punches can
 * still change, so those rows' punches are read fresh on every request (a few
 * rows, projected).
 */
import { attendanceRecords, users } from '../config/db';
import { cachedLifecycle, forgetTimeOfficeListReads, lifecycleReadCacheOn, refreshLifecycle } from './lifecycle/readCache';
import { requestUserFor } from './request-user';
import { listAllRegularizationsForAdmin } from './attendance.service';
import { listAllLeavesForAdmin } from './leave.service';
import { listAllOvertimeForAdmin } from './overtime.service';
import { listAllFeedbackForAdmin } from './admin.service';
import type { SwrKind } from './swr-cache';
import { yieldToLive } from './background-pace';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

async function orgOfAdmin(adminUserId: string): Promise<string | undefined> {
  const known = requestUserFor(adminUserId)?.org;
  if (known) return known;
  const row = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } });
  return row?.org;
}

async function kept<T>(adminUserId: string, kind: SwrKind, params: unknown, load: () => Promise<T>): Promise<T> {
  if (!lifecycleReadCacheOn()) return load();
  const org = await orgOfAdmin(adminUserId);
  return org ? cachedLifecycle(org, kind, params, load) : load();
}

type CorrectionRow = Awaited<ReturnType<typeof listAllRegularizationsForAdmin>>[number];

/** Today's and yesterday's rows (IST) take their punches from the database now, not from the copy. */
export async function withLivePunches(rows: CorrectionRow[], now = Date.now()): Promise<CorrectionRow[]> {
  const since = istDay(now - DAY_MS);
  const recent = rows.filter((row) => typeof row.workDate === 'string' && row.workDate >= since && row.employeeId);
  if (recent.length === 0) return rows;
  const punches = await attendanceRecords()
    .find({ employeeId: { $in: [...new Set(recent.map((row) => row.employeeId))] }, workDate: { $in: [...new Set(recent.map((row) => row.workDate))] } })
    .project<{ employeeId: string; workDate: string; punchIn?: Date; punchOut?: Date }>({ _id: 0, employeeId: 1, workDate: 1, punchIn: 1, punchOut: 1 })
    .toArray();
  const byKey = new Map(punches.map((p) => [`${p.employeeId}|${p.workDate}`, p]));
  return rows.map((row) => {
    if (!(typeof row.workDate === 'string' && row.workDate >= since)) return row;
    const punch = byKey.get(`${row.employeeId}|${row.workDate}`);
    return { ...row, punchIn: punch?.punchIn?.toISOString(), punchOut: punch?.punchOut?.toISOString() };
  });
}

export async function correctionsForAdmin(adminUserId: string) {
  const rows = await kept(adminUserId, 'adm-regs', null, () => listAllRegularizationsForAdmin(adminUserId));
  return lifecycleReadCacheOn() ? withLivePunches(rows) : rows;
}

export function leavesForAdmin(adminUserId: string) {
  return kept(adminUserId, 'adm-leaves', null, () => listAllLeavesForAdmin(adminUserId));
}

export function overtimeForAdmin(adminUserId: string) {
  // The full-day threshold is resolved as of today: a new day is a new copy.
  return kept(adminUserId, 'adm-overtime', istDay(Date.now()), () => listAllOvertimeForAdmin(adminUserId));
}

export function feedbackForAdmin(adminUserId: string) {
  return kept(adminUserId, 'adm-feedback', null, () => listAllFeedbackForAdmin(adminUserId));
}

/** Drop a company's kept Time office lists (a change made outside a dropping route, e.g. a punch). */
export function forgetTimeOfficeLists(org: string | undefined | null): void {
  if (org) forgetTimeOfficeListReads(org);
}

/** The same, from a person whose change it is. */
export async function forgetTimeOfficeListsOf(userId: string): Promise<void> {
  const row = await users().findOne({ userId }, { projection: { _id: 0, org: 1 } });
  forgetTimeOfficeLists(row?.org);
}

/** Work the four lists out again now, as `who` (a dashboard user of the company): the warm-up's way in. */
export async function warmTimeOfficeLists(org: string, who: string, isStopping: () => boolean = () => false): Promise<Record<string, number | string>> {
  const took: Record<string, number | string> = {};
  if (!lifecycleReadCacheOn()) return took;
  const steps: [string, () => Promise<unknown>][] = [
    ['adm-regs', () => refreshLifecycle(org, 'adm-regs', null, () => listAllRegularizationsForAdmin(who))],
    ['adm-leaves', () => refreshLifecycle(org, 'adm-leaves', null, () => listAllLeavesForAdmin(who))],
    ['adm-overtime', () => refreshLifecycle(org, 'adm-overtime', istDay(Date.now()), () => listAllOvertimeForAdmin(who))],
    ['adm-feedback', () => refreshLifecycle(org, 'adm-feedback', null, () => listAllFeedbackForAdmin(who))],
  ];
  for (const [name, run] of steps) {
    if (isStopping()) break;
    await yieldToLive(isStopping);
    const t0 = Date.now();
    try { await run(); took[name] = Date.now() - t0; } catch (error) { took[name] = `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200); }
  }
  return took;
}

/** A dashboard user to read the lists as (the lists don't depend on who, only on the company). */
export async function listReaderFor(org: string): Promise<string | undefined> {
  const viewer = await users().findOne(
    { org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true } },
    { projection: { _id: 0, userId: 1 } },
  );
  return viewer?.userId;
}
