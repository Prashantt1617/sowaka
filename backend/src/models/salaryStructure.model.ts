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

/** Per-employee statutory applicability (Zoho's employee "Statutory Components"). */
export interface EmployeeStatutory {
  epf?: boolean; // default true
  esi?: boolean; // default true
  lwf?: boolean; // default true
}

export interface SalaryStructure {
  org: string; // -> Company.id
  userId: string; // -> User.userId

  /** The assigned Salary Template (Pay Group). -> SalaryTemplate.code */
  salaryTemplateCode?: string;

  annualCtcPaise: number;

  /**
   * Per-employee monthly values, keyed by pay head `code`. Supplies the amount
   * for `flat_amount` components ("set per employee") and overrides the template
   * value for a given code.
   */
  componentValues?: Record<string, number>;

  /** Per-employee statutory on/off (EPF/ESI/LWF). Absent = all applicable. */
  statutory?: EmployeeStatutory;

  /** Minimum-wage category for the Statutory Bonus floor (e.g. 'skilled', 'highly_skilled'). */
  bonusCategory?: string;

  status: 'draft' | 'active';
  effectiveFrom?: Date;
  createdAt: Date;
  updatedAt: Date;
}
