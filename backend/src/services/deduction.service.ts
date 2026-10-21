/**
 * What a month of attendance costs under a salary template's deduction rules.
 *
 * The counts come from the same graded days the attendance report shows, so
 * anything a person is docked for can be checked and corrected there. The
 * current month runs only up to today: a day that has not happened is not an
 * absence.
 */
import { DEDUCTION_TRIGGER_LABELS, DeductionTrigger, SalaryDeductionRule, daysDeducted } from '../models/deduction.model';
import { users } from '../config/db';
import { DayMark } from '../models/shift.model';
import { attendanceReport, employeeDayStatuses } from './attendance-report.service';
import { todayIso } from './shift.service';

export type DeductionCounts = Record<DeductionTrigger, number> & {
  /** Missed punches the shift counts as an absence or a half day, and the days they cost. */
  missedPunchLopCount: number;
  missedPunchLop: number;
};

export interface AttendanceDeductionLine {
  label: string;
  count: number;
  days: number;
  /** The rule behind the figure, so a slip can say why. */
  trigger: DeductionTrigger;
  every: number;
  deductDays: number;
}

const emptyCounts = (): DeductionCounts => ({ late: 0, early: 0, absent: 0, half_day: 0, leave: 0, missed_punch: 0, missedPunchLopCount: 0, missedPunchLop: 0 });

/** Everyone's counts for a YYYY-MM period, keyed by userId. A future month counts nothing. */
export async function attendanceCountsForPeriod(adminUserId: string, period: string): Promise<Map<string, DeductionCounts>> {
  const [year, month] = period.split('-').map(Number);
  const from = `${period}-01`;
  const today = todayIso();
  const counts = new Map<string, DeductionCounts>();
  if (from > today) return counts;
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const to = monthEnd < today ? monthEnd : today;
  const report = await attendanceReport(adminUserId, { from, to });
  const missedPunchMarks = await missedPunchMarksFor(adminUserId, report.days, from, to);
  // Only graded working days are in the report: week offs and holidays are
  // not, and an approved leave is on_leave, so all of those stay paid.
  for (const [userId, date, status, lateBy, , , , , earlyBy] of report.days) {
    const c = counts.get(userId) ?? emptyCounts();
    const missedPunchMark = missedPunchMarks.get(`${userId}|${date}`);
    if (status === 'absent') c.absent += 1;
    else if (status === 'half_day') c.half_day += 1;
    else if (status === 'on_leave') c.leave += 1;
    else if (status === 'missed_punch') {
      // Paid as whatever the shift says that gap counts as.
      const lop = missedPunchMark === 'Absent' ? 1 : missedPunchMark === 'Present' ? 0 : 0.5;
      c.missed_punch += 1;
      if (lop > 0) { c.missedPunchLopCount += 1; c.missedPunchLop += lop; }
    }
    // A single-punch day is already a missed punch; it is not also late or early.
    if (status !== 'missed_punch' && lateBy > 0) c.late += 1;
    if (status !== 'missed_punch' && (earlyBy ?? 0) > 0) c.early += 1;
    counts.set(userId, c);
  }
  return counts;
}

/**
 * What the shift says each missed punch in the report counts as, keyed
 * `userId|YYYY-MM-DD`. The org report's rows do not carry it, so it is read from
 * the same per-person grading the calendar and the app use (employeeDayStatuses),
 * and only for the people who have a missed punch in the period.
 */
async function missedPunchMarksFor(
  adminUserId: string,
  days: Awaited<ReturnType<typeof attendanceReport>>['days'],
  from: string,
  to: string,
): Promise<Map<string, DayMark>> {
  const marks = new Map<string, DayMark>();
  const people = [...new Set(days.filter((day) => day[2] === 'missed_punch').map((day) => day[0]))];
  if (people.length === 0) return marks;
  const admin = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } });
  const org = admin?.org;
  if (!org) return marks;
  await Promise.all(people.map(async (userId) => {
    const statuses = await employeeDayStatuses(org, userId, from, to);
    for (const day of statuses ?? []) {
      if (day.status === 'missed_punch' && day.countsAs) marks.set(`${userId}|${day.date}`, day.countsAs);
    }
  }));
  return marks;
}

/**
 * The month's loss of pay from the calendar: every absent day, half of every
 * half day, and a missed punch as the shift counts it. Present days, approved
 * leave, week offs and holidays are paid. A template's own rules add to that
 * for what the calendar does not take out by itself (late, early, leave,
 * missed punches); its absent and half-day rules would count those days a
 * second time, so they are not applied.
 */
export function payrollDeductions(
  rules: SalaryDeductionRule[] | undefined,
  counts: DeductionCounts | undefined,
): { lines: AttendanceDeductionLine[]; days: number } {
  const calendar: AttendanceDeductionLine[] = [
    { label: DEDUCTION_TRIGGER_LABELS.absent, count: counts?.absent ?? 0, days: counts?.absent ?? 0, trigger: 'absent', every: 1, deductDays: 1 },
    { label: DEDUCTION_TRIGGER_LABELS.half_day, count: counts?.half_day ?? 0, days: (counts?.half_day ?? 0) / 2, trigger: 'half_day', every: 2, deductDays: 1 },
  ];
  if ((counts?.missedPunchLopCount ?? 0) > 0) {
    calendar.push({ label: DEDUCTION_TRIGGER_LABELS.missed_punch, count: counts!.missedPunchLopCount, days: counts!.missedPunchLop, trigger: 'missed_punch', every: 1, deductDays: counts!.missedPunchLop / counts!.missedPunchLopCount });
  }
  const extra = deductionsUnder((rules ?? []).filter((rule) => rule.trigger !== 'absent' && rule.trigger !== 'half_day'), counts);
  const lines = [...calendar, ...extra.lines];
  return { lines, days: lines.reduce((total, line) => total + line.days, 0) };
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
