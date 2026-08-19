/**
 * Statutory calculation rules (PRD §5.5). EPF and ESI are national and modelled
 * as constants; Professional Tax, Labour Welfare Fund, and the Statutory Bonus
 * minimum-wage floor all vary by state and are stored per-state in the
 * `statutory_rules` collection. All money is INTEGER PAISE.
 */

// ————————————————————————————————————————————————————————————————
// National constants (EPF / ESI)
// ————————————————————————————————————————————————————————————————

/** Employees' Provident Fund. Employer 12% is split into EPS + EPF residual. */
export const EPF_CONSTANTS = {
  employeeRate: 0.12,
  employerRate: 0.12,
  /** Employees' Pension Scheme share of the employer 12%. */
  epsRate: 0.0833,
  /** Wage ceiling for the contribution base — ₹15,000. EPS is always capped here. */
  wageCeilingPaise: 15_000_00,
} as const;

/** Employees' State Insurance. Applies while monthly gross ≤ the ceiling. */
export const ESI_CONSTANTS = {
  employeeRate: 0.0075,
  employerRate: 0.0325,
  /** Gross ceiling for eligibility — ₹21,000. */
  grossCeilingPaise: 21_000_00,
} as const;

/** The two ESI contribution periods; eligibility, once set, holds till a period ends. */
export type ContributionPeriod = 'apr_sep' | 'oct_mar';

// ————————————————————————————————————————————————————————————————
// Per-state rule shapes
// ————————————————————————————————————————————————————————————————

/**
 * One Professional Tax slab. `upToPaise: null` is the open-ended top slab.
 * `monthOverridePaise` handles states that levy a different amount in a specific
 * month (e.g. the higher February deduction in Karnataka/Maharashtra).
 */
export interface PtSlab {
  upToPaise: number | null;
  amountPaise: number;
  monthOverride?: { month: number; amountPaise: number };
}

export interface PtRule {
  slabs: PtSlab[];
}

export type LwfEmployeeBasis =
  | { mode: 'flat'; amountPaise: number }
  | { mode: 'percentage'; percent: number; capPaise?: number };

export type LwfEmployerBasis =
  | { mode: 'flat'; amountPaise: number }
  | { mode: 'percentage'; percent: number; capPaise?: number }
  | { mode: 'multiple_of_employee'; factor: number };

/**
 * Labour Welfare Fund. Both the amount AND the deduction cycle vary by state —
 * Haryana deducts monthly, Delhi half-yearly (PRD §5.5). `deductionMonths` lists
 * the 1-based calendar months in which LWF is actually deducted.
 */
export interface LwfRule {
  cycle: 'monthly' | 'half_yearly';
  deductionMonths: number[];
  employee: LwfEmployeeBasis;
  employer: LwfEmployerBasis;
}

/**
 * Statutory Bonus. Computed on whichever is higher of Basic or the state
 * minimum wage for the employee's category (PRD §5.5). Rate is locked to the
 * employee for the fiscal year at assignment time — that lock lives on the
 * Salary Structure, not here.
 */
export interface BonusRule {
  ratePercent: number;
  /** Monthly minimum wage in paise, keyed by employment category. */
  minWageByCategoryPaise: Record<string, number>;
}

/** Per-org, per-state statutory rule set. State is normalized (lower-case, trimmed). */
export interface StateStatutoryRule {
  org: string; // -> Company.id
  state: string;
  pt?: PtRule;
  lwf?: LwfRule;
  bonus?: BonusRule;
  createdAt: Date;
  updatedAt: Date;
}

/** The resolved rule set the engine consumes for one employee's state. */
export interface ResolvedRuleSet {
  state: string;
  pt?: PtRule;
  lwf?: LwfRule;
  bonus?: BonusRule;
}
