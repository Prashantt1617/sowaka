/**
 * Salary Template (Pay Group) — a reusable, named salary structure that bundles a
 * set of Pay Head components together WITH their per-template calculation, plus a
 * balancing component and EPF setting. Assigned to an employee (along with their
 * CTC) on the Salary Structure. Mirrors Zoho's "Salary Templates".
 *
 * The Pay Head Master remains the component dictionary (identity + type +
 * statutory treatment); the template decides HOW each selected component is
 * calculated, so different groups (Sales, Engineering, contractors) can compute
 * the same component differently.
 */
import { CalculationBasis } from './payHead.model';
import { SalaryDeductionRule } from './deduction.model';

export interface SalaryTemplateComponent {
  /** -> PayHead.code (must exist in the org's catalog). */
  payHeadCode: string;
  /** Per-template calculation for this component (overrides the pay head default). */
  calculation: CalculationBasis;
  /** How this component reads on the payslip for this template; falls back to the pay head's. */
  payslipName?: string;
  /** Whether this component is listed on the payslip for this template; falls back to the pay head's. */
  showInPayslip?: boolean;
}

/**
 * Which components make up the PF wage and the ESI wage for people on this
 * template, and how PF is applied. Every field absent = the behaviour before
 * this setting existed: each component's own "Consider for EPF", the org's
 * restricted/actual PF setting, and ESI on gross pay.
 */
export interface TemplateStatutoryWages {
  /** Component codes counted in the PF wage (Basic included or not). Absent: each component's own flag. */
  pfComponents?: string[];
  /** 'org': the org's Statutory Components setting; 'actual': 12% of the whole PF wage; 'ceiling': capped at the ceiling. */
  pfWageMode?: 'org' | 'actual' | 'ceiling';
  /** Earning codes counted in the ESI wage (eligibility and contribution). Absent: gross pay. */
  esiComponents?: string[];
}

export interface SalaryTemplate {
  org: string; // -> Company.id
  name: string;
  /** Stable, org-unique identifier referenced by employee Salary Structures. */
  code: string;
  description?: string;
  components: SalaryTemplateComponent[];
  /** Earning that absorbs the residual so gross reconciles to CTC (the "Fixed Allowance"). */
  balancingComponentCode?: string;
  /** Default EPF ceiling behaviour for employees on this template. */
  epfApplyCeiling?: boolean;
  /** PF and ESI wage applicability for this template. Absent = the defaults above. */
  statutoryWages?: TemplateStatutoryWages;
  /**
   * How attendance costs paid days for the people on this template: every N
   * late arrivals / early leaves / absences cost M days. A payroll run turns
   * the month's counts into loss-of-pay days with these.
   */
  /** Whether the run reads attendance for the people on this template at all. Absent = on. */
  paidDaysEnabled?: boolean;
  deductionRules?: SalaryDeductionRule[];
  /** Paid leave days a month that offset what the rules deduct (0 = none). */
  monthlyPaidLeaveDays?: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
