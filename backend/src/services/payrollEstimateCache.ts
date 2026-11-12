/**
 * The attendance behind one person's pay estimate (app › Payroll Home and
 * Earnings), remembered briefly, so opening Home, then Earnings, then Home
 * again grades their month once rather than three times.
 *
 * Only the attendance counts are kept, never the payslip: the structure, pay
 * heads, statutory and tax rows, split, declaration, claims and released runs
 * are read afresh on every estimate, so an HR change to any of them shows at
 * once and an estimate never stands in for a released run. The counts are
 * what the estimate used to take from the org's attendance report, which is
 * itself kept for two minutes; they are kept as long (ATTENDANCE_TTL_MS) and
 * dropped whenever that report is (an HR mark, a shift or roster change, a
 * payroll run). A new punch, correction or approved leave shows within those
 * two minutes, as it did before.
 */
import { onAttendanceReportInvalidated } from './attendance-report.service';
import type { DeductionCounts } from './deduction.service';
import type { PeriodRange } from './payroll-inputs.service';

const ATTENDANCE_TTL_MS = 2 * 60_000;
const MAX_ENTRIES = 5000;

type Counts = Map<string, DeductionCounts>;
const cache = new Map<string, { expires: number; value: Counts }>();

/** Keyed by org first, so an org's entries can be dropped together. */
export function attendanceCountsKey(org: string, userId: string, range: Pick<PeriodRange, 'from' | 'to'>, asOf: string): string {
  return `${org}|${userId}|${range.from}|${range.to}|${asOf}`;
}

export function rememberedAttendanceCounts(key: string): Counts | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function rememberAttendanceCounts(key: string, value: Counts): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    // Still full: the oldest go first (a Map keeps insertion order).
    for (const k of cache.keys()) {
      if (cache.size < MAX_ENTRIES) break;
      cache.delete(k);
    }
  }
  cache.set(key, { expires: Date.now() + ATTENDANCE_TTL_MS, value });
}

/** Forget the remembered attendance of an org (or one person in it). */
export function forgetEstimates(org: string, userId?: string): void {
  const prefix = userId === undefined ? `${org}|` : `${org}|${userId}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

onAttendanceReportInvalidated((org) => forgetEstimates(org));
