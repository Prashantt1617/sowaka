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

export interface SalaryTemplateComponent {
  /** -> PayHead.code (must exist in the org's catalog). */
  payHeadCode: string;
  /** Per-template calculation for this component (overrides the pay head default). */
  calculation: CalculationBasis;
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
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
