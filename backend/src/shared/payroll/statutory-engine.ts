/**
 * Pure statutory calculation engine (PRD §5.5). No I/O, no DB — every function
 * takes explicit inputs and rule config and returns amounts in INTEGER PAISE, so
 * the rules can be exercised in isolation. Rates and ceilings come from the
 * FY's statutory config row, passed in by the caller. Rule resolution (which state, which
 * flags apply) lives in statutory.service.ts and the payroll run; this file only
 * does the arithmetic.
 *
 * Rounding follows filing convention: EPF rounds to the nearest rupee, ESI
 * rounds UP to the next rupee for each contribution.
 */

import { BonusRule, ContributionPeriod, LwfRule, PtRule } from '../../models/statutoryRule.model';
import type { StatutoryConfig } from './statutory-config';

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
  /** The wage the employee rate was actually applied to. */
  contributionWagePaise: number;
  employeePaise: number;
  employerTotalPaise: number;
  employerEpsPaise: number;
  employerEpfPaise: number;
  /** Employer EDLI on the PF wage up to the ceiling. Employer cost only. */
  edliPaise?: number;
  /** EPF admin charges on the employer's contribution wage. Employer cost only. */
  adminPaise?: number;
}

/**
 * EPF split. Each side contributes its rate of the PF wage, capped at the
 * ceiling when that side is "restricted", or on the full PF wage when it is
 * "actual". The employer's contribution is split into EPS (ALWAYS on the
 * capped wage) and the EPF residual. `ceilingPaise` is the month's ceiling
 * (a caller may pro-rate it for loss-of-pay days).
 *
 * Worked example at 12% / 8.33%: PF wage ₹30,000, ceiling ₹25,000, both
 * restricted → employee ₹3,000, employer EPS ₹2,083 + EPF ₹917.
 */
export function computeEpf(rates: StatutoryConfig['epf'], input: {
  pfWagePaise: number;
  /** Shorthand for both sides restricted (true, the default) or actual (false). */
  applyCeiling?: boolean;
  employeeRestricted?: boolean;
  employerRestricted?: boolean;
  ceilingPaise: number;
  /** false: no pension-scheme split; the employer's whole contribution is PF. */
  eps?: boolean;
}): EpfResult {
  const restrictedDefault = input.applyCeiling ?? true;
  const employeeRestricted = input.employeeRestricted ?? restrictedDefault;
  const employerRestricted = input.employerRestricted ?? restrictedDefault;
  const ceiling = input.ceilingPaise;
  const capped = Math.min(input.pfWagePaise, ceiling);
  const employeeWage = employeeRestricted ? capped : input.pfWagePaise;
  const employerWage = employerRestricted ? capped : input.pfWagePaise;

  const employeePaise = roundToRupee(employeeWage * rates.employeeRate);
  const employerTotalPaise = roundToRupee(employerWage * rates.employerRate);
  const employerEpsPaise = input.eps === false ? 0 : roundToRupee(capped * rates.epsRate); // EPS ceiling is statutory, always applied
  const employerEpfPaise = employerTotalPaise - employerEpsPaise;

  return {
    contributionWagePaise: employeeWage,
    employeePaise,
    employerTotalPaise,
    employerEpsPaise,
    employerEpfPaise,
    edliPaise: roundToRupee(capped * rates.edliRate),
    // EPFO bills admin charges to the paisa (Zoho: ₹98.34 on ₹19,666.67).
    adminPaise: Math.ceil(employerWage * rates.adminRate),
  };
}

/** A zero EPF result, for people or orgs without PF. */
export const NO_EPF: EpfResult = {
  contributionWagePaise: 0,
  employeePaise: 0,
  employerTotalPaise: 0,
  employerEpsPaise: 0,
  employerEpfPaise: 0,
  edliPaise: 0,
  adminPaise: 0,
};

/**
 * PF wage from components that always count, plus components that count only
 * while the PF wage is under the ceiling. Those top the wage up to the ceiling
 * and no further. `testPaise` is the always-counted wage the condition is
 * checked against (after loss of pay, or as in the structure).
 */
export function pfWageWithConditional(input: {
  alwaysPaise: number;
  conditionalPaise: number;
  testPaise: number;
  ceilingPaise: number;
}): number {
  const ceiling = input.ceilingPaise;
  if (input.conditionalPaise <= 0 || input.testPaise >= ceiling) return input.alwaysPaise;
  return input.alwaysPaise + Math.min(input.conditionalPaise, Math.max(0, ceiling - input.alwaysPaise));
}

// ————————————————————————————————————————————————————————————————
// ESI (STAT-3)
// ————————————————————————————————————————————————————————————————

/** Which ESI contribution period a 1-based calendar month falls in. */
export function contributionPeriodOf(month: number): ContributionPeriod {
  return month >= 4 && month <= 9 ? 'apr_sep' : 'oct_mar';
}

/**
 * ESI eligibility. Applies while monthly gross ≤ the ceiling. The date-window rule:
 * once an employee is under ESI at the start of a contribution period, they stay
 * covered until that period ends even if their gross later crosses the ceiling.
 * The caller passes `wasApplicableAtPeriodStart` scoped to the SAME period.
 */
export function isEsiApplicable(esi: StatutoryConfig['esi'], input: {
  grossPaise: number;
  wasApplicableAtPeriodStart?: boolean;
}): boolean {
  if (input.grossPaise <= esi.grossCeilingPaise) return true;
  return input.wasApplicableAtPeriodStart === true;
}

export interface EsiResult {
  applicable: boolean;
  employeePaise: number;
  employerPaise: number;
}

/** ESI contribution on actual gross. Amounts round up to the next rupee. */
export function computeEsi(esi: StatutoryConfig['esi'], input: { grossPaise: number; applicable: boolean }): EsiResult {
  if (!input.applicable) return { applicable: false, employeePaise: 0, employerPaise: 0 };
  return {
    applicable: true,
    employeePaise: ceilToRupee(input.grossPaise * esi.employeeRate),
    employerPaise: ceilToRupee(input.grossPaise * esi.employerRate),
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
    // A multiple of the employee's share before it is rounded (Zoho: 2 × ₹17.29 = ₹35, not 2 × ₹17),
    // within the employee cap times the factor.
    const rawEmployee = rule.employee.mode === 'flat' ? rule.employee.amountPaise : (input.grossPaise * rule.employee.percent) / 100;
    const cap = rule.employee.mode === 'flat' ? undefined : rule.employee.capPaise;
    employerPaise = capped(roundToRupee(rawEmployee * rule.employer.factor), cap === undefined ? undefined : cap * rule.employer.factor);
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
