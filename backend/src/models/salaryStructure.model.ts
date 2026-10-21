/**
 * Salary Structure (PRD §5.6) — the per-employee ASSIGNMENT of a Salary Template.
 * The template (Pay Group) defines the component set + calculation; the structure
 * binds it to one employee with their CTC, any per-employee flat overrides, and
 * per-employee statutory applicability. The computed breakup is derived on demand
 * by the salary calculator, not stored here. Money is INTEGER PAISE.
 *
 * v1 keeps one structure per employee (keyed on userId). Salary Revision history
 * (AW-3) will layer versioning on top later.
 */

import { CalculationBasis } from './payHead.model';

/**
 * A person's own changes on top of the assigned template: components only they
 * get, template components they don't get, and template components worked
 * out differently for them. Resolved in `applyOverrides`.
 */
export interface StructureOverrides {
  add?: { payHeadCode: string; calculation: CalculationBasis }[];
  remove?: string[];
  edit?: Record<string, CalculationBasis>;
}

/** One CTC change, kept for the Salary Revision History. */
export interface SalaryRevision {
  previousCtcPaise: number;
  annualCtcPaise: number;
  /** "YYYY-MM-DD" */
  effectiveFrom: string;
  at: Date;
}

/** Per-employee statutory applicability (Zoho's employee "Statutory Components"). */
export interface EmployeeStatutory {
  epf?: boolean; // default true
  esi?: boolean; // default true
  lwf?: boolean; // default true
  /** 12% of actual PF wage for this person; used only when the org allows employee-level PF override. */
  pfActualWage?: boolean;
  /** Employer PF goes to the pension scheme (8.33%) and PF; false sends all of it to PF. Default true. */
  contributeEps?: boolean;
  pfAccountNumber?: string;
  uan?: string;
  esiNumber?: string;
  /** Restricted PF wage for this person in paise, when it differs from the ceiling. */
  pfRestrictedWagePaise?: number;
}

export interface SalaryStructure {
  org: string; // -> Company.id
  userId: string; // -> User.userId

  /** The assigned Salary Template (Pay Group). -> SalaryTemplate.code */
  salaryTemplateCode?: string;
  /** The Paid Days Template for this person; absent = the company's Default. -> PaidDaysTemplate.code */
  paidDaysTemplateCode?: string;

  annualCtcPaise: number;

  /**
   * Per-employee monthly values, keyed by pay head `code`. Supplies the amount
   * for `flat_amount` components ("set per employee") and overrides the template
   * value for a given code.
   */
  componentValues?: Record<string, number>;

  /** This person's add / remove / edit on top of the template. */
  overrides?: StructureOverrides;

  /** CTC changes, oldest first. */
  revisions?: SalaryRevision[];

  /** Per-employee statutory on/off (EPF/ESI/LWF). Absent = all applicable. */
  statutory?: EmployeeStatutory;

  /** Minimum-wage category for the Statutory Bonus floor (e.g. 'skilled', 'highly_skilled'). */
  bonusCategory?: string;

  status: 'draft' | 'active';
  effectiveFrom?: Date;
  createdAt: Date;
  updatedAt: Date;
}
