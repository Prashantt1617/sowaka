/**
 * Org-wide statutory settings — what Payroll › Statutory Components edits.
 * One document per org. Every employee is calculated under the same settings;
 * templates only choose salary components, never statutory treatment.
 * Per-state amounts (PT slabs, LWF amounts) stay in `statutory_rules`.
 */

/** "restricted": PF on the PF wage up to the ceiling; "actual": on the full PF wage. */
export type PfRateMode = 'restricted' | 'actual';

export interface EpfSettings {
  enabled: boolean;
  epfNumber?: string;
  employeeRate: PfRateMode;
  employerRate: PfRateMode;
  /** Employer PF is part of CTC (taken out of the balancing component). */
  includeEmployer: boolean;
  /** Employer EDLI is part of CTC. Only when includeEmployer. */
  includeEDLI: boolean;
  /** EPF admin charges are part of CTC. Only when includeEmployer. */
  includeAdmin: boolean;
  /** A person's salary structure may switch them to PF on the actual PF wage. */
  overrideAtEmployee: boolean;
  /** The ceiling shrinks with loss-of-pay days (ceiling × payable ÷ working days). */
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
  /** Employer ESI is part of CTC (taken out of the balancing component). */
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
  /** The company's bonus rate (percent). Absent: the FY's minimum rate (statutory config `bonus.minRate`). */
  ratePercent?: number;
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
  /** Income tax worked out by the TDS engine when HR doesn't type it. Absent / off: tax only as typed. */
  tds?: { enabled: boolean; defaultRegime: 'new' | 'old' };
  updatedAt?: Date;
}
