import type { OvertimePayRule } from '../../models/salaryTemplate.model';

/** What approved overtime hours pay under a template's rule, in paise (0 without a rule). */
export function overtimePayFor(
  rule: OvertimePayRule | undefined,
  hours: number,
  monthly: { basicPaise: number; grossPaise: number },
  workingDays: number,
): number {
  if (!rule || !(hours > 0)) return 0;
  if (rule.mode === 'flat_per_hour') return Math.round(hours * (rule.flatPerHourPaise ?? 0));
  const base = rule.base === 'gross' ? monthly.grossPaise : monthly.basicPaise;
  const hoursInMonth = Math.max(1, workingDays) * (rule.hoursPerDay ?? 8);
  return Math.round((base / hoursInMonth) * (rule.multiplier ?? 2) * hours);
}
