/**
 * Pure statutory calculation engine (PRD §5.5). No I/O, no DB — every function
 * takes explicit inputs and rule config and returns amounts in INTEGER PAISE, so
 * the rules can be exercised in isolation. Rule resolution (which state, which
 * flags apply) lives in statutory.service.ts and the payroll run; this file only
 * does the arithmetic.
 *
 * Rounding follows filing convention: EPF rounds to the nearest rupee, ESI
 * rounds UP to the next rupee for each contribution.
 */

import {
  BonusRule,
  ContributionPeriod,
  EPF_CONSTANTS,
  ESI_CONSTANTS,
  LwfRule,
  PtRule,
} from '../models/statutoryRule.model';

/** Round to the nearest whole rupee (EPF convention). */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/** Round UP to the next whole rupee (ESI convention). */
export function ceilToRupee(paise: number): number {
  return Math.ceil(paise / 100) * 100;
}

// ————————————————————————————————————————————————————————————————
// EPF (STAT-2)
// ————————————————————————————————————————————————————————————————

export interface EpfResult {
  /** The wage the employee/employer 12% was actually applied to. */
  contributionWagePaise: number;
  employeePaise: number;
  employerTotalPaise: number;
  employerEpsPaise: number;
  employerEpfPaise: number;
}

/**
 * EPF split. Employee and employer each contribute 12% of the PF wage, capped at
 * ₹15,000 unless `applyCeiling` is false (an employee-level override to
 * contribute on full wage). The employer 12% is split into EPS (8.33%, ALWAYS
 * capped at ₹15,000) and the EPF residual.
 *
 * Worked example (PRD): PF wage ₹20,000, ceiling applied → employee ₹1,800,
 * employer EPS ₹1,250 + EPF ₹550.
 */
export function computeEpf(input: { pfWagePaise: number; applyCeiling?: boolean }): EpfResult {
  const applyCeiling = input.applyCeiling ?? true;
  const ceiling = EPF_CONSTANTS.wageCeilingPaise;
  const contributionWage = applyCeiling ? Math.min(input.pfWagePaise, ceiling) : input.pfWagePaise;
  const epsWage = Math.min(input.pfWagePaise, ceiling); // EPS ceiling is statutory, always applied

  const employeePaise = roundToRupee(contributionWage * EPF_CONSTANTS.employeeRate);
  const employerTotalPaise = roundToRupee(contributionWage * EPF_CONSTANTS.employerRate);
  const employerEpsPaise = roundToRupee(epsWage * EPF_CONSTANTS.epsRate);
  const employerEpfPaise = employerTotalPaise - employerEpsPaise;

  return {
    contributionWagePaise: contributionWage,
    employeePaise,
    employerTotalPaise,
    employerEpsPaise,
    employerEpfPaise,
  };
}

// ————————————————————————————————————————————————————————————————
// ESI (STAT-3)
// ————————————————————————————————————————————————————————————————

/** Which ESI contribution period a 1-based calendar month falls in. */
export function contributionPeriodOf(month: number): ContributionPeriod {
  return month >= 4 && month <= 9 ? 'apr_sep' : 'oct_mar';
}

/**
 * ESI eligibility. Applies while monthly gross ≤ ₹21,000. The date-window rule:
 * once an employee is under ESI at the start of a contribution period, they stay
 * covered until that period ends even if their gross later crosses the ceiling.
 * The caller passes `wasApplicableAtPeriodStart` scoped to the SAME period.
 */
export function isEsiApplicable(input: {
  grossPaise: number;
  wasApplicableAtPeriodStart?: boolean;
}): boolean {
  if (input.grossPaise <= ESI_CONSTANTS.grossCeilingPaise) return true;
  return input.wasApplicableAtPeriodStart === true;
}

export interface EsiResult {
  applicable: boolean;
  employeePaise: number;
  employerPaise: number;
}

/** ESI contribution on actual gross. Amounts round up to the next rupee. */
export function computeEsi(input: { grossPaise: number; applicable: boolean }): EsiResult {
  if (!input.applicable) return { applicable: false, employeePaise: 0, employerPaise: 0 };
  return {
    applicable: true,
    employeePaise: ceilToRupee(input.grossPaise * ESI_CONSTANTS.employeeRate),
    employerPaise: ceilToRupee(input.grossPaise * ESI_CONSTANTS.employerRate),
  };
}

// ————————————————————————————————————————————————————————————————
// Professional Tax (STAT-4)
// ————————————————————————————————————————————————————————————————

/**
 * Professional Tax by state-defined slab on monthly gross. Slabs are matched in
 * ascending order; `upToPaise: null` is the open-ended top slab. A slab may
 * carry a month-specific override (e.g. the higher February deduction some
 * states levy).
 */
export function computePt(rule: PtRule, input: { grossPaise: number; month: number }): {
  amountPaise: number;
} {
  const slabs = [...rule.slabs].sort((a, b) => bound(a.upToPaise) - bound(b.upToPaise));
  const slab = slabs.find((s) => s.upToPaise === null || input.grossPaise <= s.upToPaise);
  if (!slab) return { amountPaise: 0 };
  if (slab.monthOverride && slab.monthOverride.month === input.month) {
    return { amountPaise: slab.monthOverride.amountPaise };
  }
  return { amountPaise: slab.amountPaise };
}

function bound(upTo: number | null): number {
  return upTo === null ? Number.POSITIVE_INFINITY : upTo;
}

// ————————————————————————————————————————————————————————————————
// Labour Welfare Fund (STAT-5)
// ————————————————————————————————————————————————————————————————

export interface LwfResult {
  applicable: boolean;
  employeePaise: number;
  employerPaise: number;
}

/**
 * LWF, where both the amount and the deduction cycle vary by state. Returns zero
 * (and `applicable: false`) in months the state does not deduct — e.g. a
 * half-yearly state only deducts in its two listed months.
 */
export function computeLwf(rule: LwfRule, input: { grossPaise: number; month: number }): LwfResult {
  if (!rule.deductionMonths.includes(input.month)) {
    return { applicable: false, employeePaise: 0, employerPaise: 0 };
  }

  const employeePaise =
    rule.employee.mode === 'flat'
      ? rule.employee.amountPaise
      : capped(roundToRupee((input.grossPaise * rule.employee.percent) / 100), rule.employee.capPaise);

  let employerPaise: number;
  if (rule.employer.mode === 'flat') {
    employerPaise = rule.employer.amountPaise;
  } else if (rule.employer.mode === 'multiple_of_employee') {
    employerPaise = employeePaise * rule.employer.factor;
  } else {
    employerPaise = capped(
      roundToRupee((input.grossPaise * rule.employer.percent) / 100),
      rule.employer.capPaise,
    );
  }

  return { applicable: true, employeePaise, employerPaise };
}

function capped(amountPaise: number, capPaise?: number): number {
  return capPaise === undefined ? amountPaise : Math.min(amountPaise, capPaise);
}

// ————————————————————————————————————————————————————————————————
// Statutory Bonus (STAT-6)
// ————————————————————————————————————————————————————————————————

/**
 * Monthly statutory-bonus accrual on whichever is higher of Basic or the state
 * minimum wage for the employee's category. The bonus rate is locked to the
 * employee for the fiscal year at assignment time (enforced on the Salary
 * Structure, not here).
 */
export function computeStatutoryBonus(
  rule: BonusRule,
  input: { basicPaise: number; category: string },
): { basePaise: number; amountPaise: number } {
  const minWagePaise = rule.minWageByCategoryPaise[input.category] ?? 0;
  const basePaise = Math.max(input.basicPaise, minWagePaise);
  return { basePaise, amountPaise: roundToRupee((basePaise * rule.ratePercent) / 100) };
}
