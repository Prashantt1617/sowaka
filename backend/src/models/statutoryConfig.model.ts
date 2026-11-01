/**
 * `payroll_statutory_configs`: the national statutory figures, one row per
 * financial year (EPF, ESI, Statutory Bonus, the Meal Card exemption, and
 * each state's default Professional Tax and Labour Welfare Fund). National:
 * one row serves every company. Edited on the HR dashboard; payroll refuses a
 * month whose FY has no row.
 */
import type { StatutoryConfig } from '../shared/payroll/statutory-config';

export type StatutoryConfigRow = StatutoryConfig & {
  createdAt: Date;
  updatedAt: Date;
  /** Who saved it last; null for a seeded row. */
  updatedByUserId: string | null;
};
