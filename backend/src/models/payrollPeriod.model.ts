/**
 * A company's pay cycle, held in `payroll_periods`. One row with
 * `period: 'default'` says the day each cycle starts (26: a run for October
 * pays 26 September – 25 October). A row for one month ('YYYY-MM') changes
 * that month alone: its own first and last day, or the days its salary is
 * spread over when that is not the number of days in the cycle. A company
 * with no rows is paid by the calendar month.
 *
 * Set in the database for now; the dashboard will edit the same rows.
 */
export const DEFAULT_PAYROLL_PERIOD = 'default';

export interface PayrollPeriodSetting {
  org: string; // -> Company.id
  /** 'default' for the company's cycle, else the 'YYYY-MM' it changes. */
  period: string;
  /** Default row: the day of the month a cycle starts, 1–28. 1 is the calendar month. */
  startDay?: number;
  /** One month's first and last day ('YYYY-MM-DD'), when not the cycle's. */
  from?: string;
  to?: string;
  /** One month's base days (the salary is spread over these), when not the days from `from` to `to`. */
  baseDays?: number;
  note?: string;
  updatedAt: Date;
}
