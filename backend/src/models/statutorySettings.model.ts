/**
 * Org-wide statutory settings — what Payroll › Statutory Components edits.
 * One document per org. Every employee is calculated under the same settings;
 * templates only choose salary components, never statutory treatment.
 * Per-state amounts (PT slabs, LWF amounts) stay in `statutory_rules`.
 */

/** "restricted": 12% of PF wage up to the ceiling; "actual": 12% of the full PF wage. */
export type PfRateMode = 'restricted' | 'actual';

export interface EpfSettings {
  enabled: boolean;
  epfNumber?: string;
  employeeRate: PfRateMode;
  employerRate: PfRateMode;
  /** Employer PF is part of CTC (taken out of the balancing component). */
  includeEmployer: boolean;
  /** Employer EDLI (0.50%) is part of CTC. Only when includeEmployer. */
  includeEDLI: boolean;
  /** EPF admin charges (0.50%) are part of CTC. Only when includeEmployer. */
  includeAdmin: boolean;
  /** A person's salary structure may switch them to 12% of actual PF wage. */
  overrideAtEmployee: boolean;
  /** The ceiling shrinks with loss-of-pay days (₹25,000 × payable ÷ working days). */
  proRateRestricted: boolean;
  /**
   * Components marked "only when PF wage is below the ceiling" are tested
   * against the PF wage after loss of pay (true) or as in the structure (false).
   */
  considerLOP: boolean;
}

export interface EsiSettings {
  enabled: boolean;
  esiNumber?: string;
  /** Employer ESI (3.25%) is part of CTC (taken out of the balancing component). */
  includeEmployer: boolean;
}

export interface MinWageRow {
  category: string;
  minWagePaise: number;
  /** "YYYY-MM": the first month this minimum wage applies. */
  effectiveFrom: string;
}

export interface BonusSettings {
  enabled: boolean;
  frequency: 'monthly' | 'yearly';
  ratePercent: number;
  /** Minimum wages by employment category, keyed by lower-case state. */
  minWages: Record<string, MinWageRow[]>;
}

export interface StatutorySettings {
  org: string;
  epf: EpfSettings;
  esi: EsiSettings;
  bonus: BonusSettings;
  /** Lower-case states where Labour Welfare Fund is switched off. */
  lwfDisabledStates: string[];
  updatedAt?: Date;
}
