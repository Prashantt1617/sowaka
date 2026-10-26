/**
 * Attendance-based deductions, as a salary template defines them.
 *
 * Each rule counts one kind of graded day, or one flag on a graded day, from
 * the attendance report, and every `every` of them in a month cost
 * `deductDays` paid days. A partial bundle costs nothing: with every=3 and
 * deductDays=1, three lates cost a day, five still cost one, six cost two.
 */
export type DeductionTrigger = 'late' | 'early' | 'absent' | 'half_day' | 'leave' | 'missed_punch' | 'unpaid_leave';

/**
 * What a template rule may count. Leave without pay is not among them: every
 * day of it is already loss of pay, docked by the calendar on any template, so
 * a rule on it could only take the same days twice. It is a trigger at all so
 * a payslip line can say why.
 */
export const DEDUCTION_TRIGGERS: DeductionTrigger[] = ['late', 'early', 'absent', 'half_day', 'leave', 'missed_punch'];

export const DEDUCTION_TRIGGER_LABELS: Record<DeductionTrigger, string> = {
  late: 'Late arrivals',
  early: 'Early leaves',
  absent: 'Absent days',
  half_day: 'Half days',
  leave: 'Leave days',
  missed_punch: 'Missed punches',
  unpaid_leave: 'Leave without pay',
};

export interface SalaryDeductionRule {
  trigger: DeductionTrigger;
  /** Occurrences per bundle. */
  every: number;
  /** Paid days deducted per bundle. */
  deductDays: number;
  active: boolean;
}

/** Days deducted for `count` occurrences under a rule. */
export function daysDeducted(rule: Pick<SalaryDeductionRule, 'every' | 'deductDays'>, count: number): number {
  if (rule.every <= 0 || count <= 0) return 0;
  return Math.floor(count / rule.every) * rule.deductDays;
}
