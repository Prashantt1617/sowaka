/**
 * Statutory calculation rule shapes (PRD §5.5). The national figures (EPF,
 * ESI, bonus, the PF ceiling over time, and each state's default PT / LWF)
 * live in `payroll_statutory_configs`, one row per financial year (see
 * shared/payroll/statutory-config.ts). A company may override a state's PT,
 * LWF or bonus rule for itself in `statutory_rules`. All money is INTEGER PAISE.
 */

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
