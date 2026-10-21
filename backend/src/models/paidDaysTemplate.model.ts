import { SalaryDeductionRule } from './deduction.model';

/**
 * How attendance turns into paid days for the people on it, kept apart from
 * what they are paid (the salary template). Each company has one Default,
 * used for anyone not given another; a payroll run reads it per person.
 */
export interface PaidDaysTemplate {
  org: string;
  /** Unique per org, e.g. "DEFAULT". */
  code: string;
  name: string;
  description?: string;
  /** Every day of the month is paid: the attendance calendar is not read. */
  allDaysPaid: boolean;
  /** Every N late arrivals / early leaves… cost M paid days, on top of the calendar's absences and half days. */
  deductionRules: SalaryDeductionRule[];
  /** Paid leave days a month that offset what the rules and calendar deduct (0 = none). */
  monthlyPaidLeaveDays: number;
  /** The company's default: anyone without another is on it. Exactly one per org. */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
