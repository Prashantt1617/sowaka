/**
 * What a month of attendance costs under a salary template's deduction rules.
 *
 * The counts come from the same graded days the attendance report shows, so
 * anything a person is docked for can be checked and corrected there. The
 * current month runs only up to today: a day that has not happened is not an
 * absence.
 */
import { DEDUCTION_TRIGGER_LABELS, DeductionTrigger, SalaryDeductionRule, daysDeducted } from '../models/deduction.model';
import { attendanceReport } from './attendance-report.service';
import { todayIso } from './shift.service';

export type DeductionCounts = Record<DeductionTrigger, number>;

export interface AttendanceDeductionLine {
  label: string;
  count: number;
  days: number;
  /** The rule behind the figure, so a slip can say why. */
  trigger: DeductionTrigger;
  every: number;
  deductDays: number;
}

const emptyCounts = (): DeductionCounts => ({ late: 0, early: 0, absent: 0, half_day: 0, leave: 0, missed_punch: 0 });

/** Everyone's counts for a YYYY-MM period, keyed by userId. A future month counts nothing. */
export async function attendanceCountsForPeriod(adminUserId: string, period: string): Promise<Map<string, DeductionCounts>> {
  const [year, month] = period.split('-').map(Number);
  const from = `${period}-01`;
  const today = todayIso();
  const counts = new Map<string, DeductionCounts>();
  if (from > today) return counts;
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const report = await attendanceReport(adminUserId, { from, to: monthEnd < today ? monthEnd : today });
  for (const [userId, , status, lateBy, , , , , earlyBy] of report.days) {
    const c = counts.get(userId) ?? emptyCounts();
    if (status === 'absent') c.absent += 1;
    else if (status === 'half_day') c.half_day += 1;
    else if (status === 'on_leave') c.leave += 1;
    // A single punch is half a day's evidence, so it counts as a half day
    // too; the separate missed-punch trigger stays for orgs that want it.
    else if (status === 'missed_punch') { c.missed_punch += 1; c.half_day += 1; }
    // A single-punch day is already a missed punch; it is not also late or early.
    if (status !== 'missed_punch' && lateBy > 0) c.late += 1;
    if (status !== 'missed_punch' && (earlyBy ?? 0) > 0) c.early += 1;
    counts.set(userId, c);
  }
  return counts;
}

/** One line per active rule, and the paid days they cost together. */
export function deductionsUnder(
  rules: SalaryDeductionRule[] | undefined,
  counts: DeductionCounts | undefined,
): { lines: AttendanceDeductionLine[]; days: number } {
  const lines = (rules ?? [])
    .filter((rule) => rule.active)
    .map((rule) => {
      const count = counts?.[rule.trigger] ?? 0;
      return { label: DEDUCTION_TRIGGER_LABELS[rule.trigger], count, days: daysDeducted(rule, count), trigger: rule.trigger, every: rule.every, deductDays: rule.deductDays };
    });
  return { lines, days: lines.reduce((total, line) => total + line.days, 0) };
}
