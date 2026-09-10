/**
 * Pay Head Master — the org's reusable catalog of pay components (Basic, HRA, PF,
 * reimbursements, etc.). Configured once per org and referenced by every
 * employee's Salary Structure. Money is stored as INTEGER PAISE throughout the
 * payroll module to avoid the floating-point drift that chained percentage and
 * statutory calculations would otherwise accumulate.
 */

/** Which of the four salary-component tabs the component belongs to (PRD §5.4). */
export type PayHeadCategory = 'earning' | 'deduction' | 'benefit' | 'reimbursement';

/**
 * Controlled vocabulary for the original schema's 15-option "Component Type"
 * list. `componentType: 'basic'` additionally marks the org's Basic component,
 * which `% of Basic` calculations resolve against.
 */
export type PayHeadComponentType =
  | 'basic'
  | 'hra'
  | 'conveyance'
  | 'meal_card'
  | 'lta'
  | 'fixed_allowance'
  | 'special_allowance'
  | 'statutory_bonus'
  | 'salary_advance'
  | 'notice_pay'
  | 'hold_amount'
  | 'vpf'
  | 'gratuity'
  | 'food_coupons'
  | 'other';

/**
 * How a component's value is derived (PRD §5.3 — the single biggest gap in the
 * original schema). `flat_amount` / `flat_per_month` carry `amountPaise`;
 * `percentage` carries `percent` plus the base it is a percentage of.
 */
export type CalculationMode = 'flat_amount' | 'percentage' | 'flat_per_month';

/** What a percentage is taken of. `component` resolves `baseComponentCode`. */
export type PercentageBase = 'ctc' | 'basic' | 'component';

export interface CalculationBasis {
  mode: CalculationMode;
  /** For `flat_amount` / `flat_per_month`: the value in integer paise. */
  amountPaise?: number;
  /** For `percentage`: a percentage 0..100, up to 2 decimal places. */
  percent?: number;
  /** For `percentage`: what the percentage is applied to. */
  base?: PercentageBase;
  /** For `percentage` + base `component`: the referenced pay head's `code`. */
  baseComponentCode?: string;
}

/**
 * A statutory applicability flag that can be conditional, not just yes/no
 * (PRD §5.3 — e.g. "Consider for EPF: Yes, if PF wage < ₹15,000").
 */
export interface StatutoryConsideration {
  consider: boolean;
  /** Meaningful only when `consider` is true; defaults to `always`. */
  condition?: 'always' | 'if_pf_wage_below_15000';
}

export interface PayHead {
  org: string; // -> Company.id
  name: string;
  /** Stable, org-unique identifier referenced by Salary Structures. */
  code: string;
  category: PayHeadCategory;
  componentType: PayHeadComponentType;
  calculation: CalculationBasis;

  // Statutory flags with conditional granularity (PRD §5.3 / PHM-3).
  considerForEpf?: StatutoryConsideration;
  considerForEsi?: StatutoryConsideration;
  considerForPt?: boolean;
  considerForLwf?: boolean;

  /** Part of the employee-allocated Flexible Benefit Plan pool (PHM-4). */
  fbp?: boolean;

  // Nature of payment (PRD §5.3, carried from the original schema).
  recurrence?: 'recurring' | 'one_time';
  prorate?: boolean;
  arrears?: boolean;

  /** For `category: 'reimbursement'` only: the per-cycle claimable cap, in paise (PHM-5). */
  maxClaimablePaise?: number;

  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
