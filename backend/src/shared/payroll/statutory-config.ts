/**
 * The national statutory figures for one financial year, as stored in
 * `payroll_statutory_configs` and edited on the HR dashboard. Every pure
 * payroll function that needs a rate, a ceiling or a state's PT / LWF rule
 * takes one of these as an input; nothing here holds a figure of its own.
 * Rates are fractions (0.12 = 12%); money is integer paise.
 */
import type { LwfRule, PtRule } from '../../models/statutoryRule.model';
import { fyOf } from './tds';

export interface StatutoryConfig {
  /** "2026-27" */
  fy: string;
  /** 'to_confirm' until someone checks the figures against the notifications. */
  status: 'to_confirm' | 'confirmed';
  source?: string | null;
  epf: {
    employeeRate: number;
    employerRate: number;
    /** Employees' Pension Scheme share of the employer's contribution, always on the capped wage. */
    epsRate: number;
    /** Employer EDLI, on the PF wage up to the ceiling. */
    edliRate: number;
    /** EPF admin charges, on the employer's contribution wage. */
    adminRate: number;
    /**
     * The PF wage ceiling across the year, by the day each value starts. The
     * first starts on the FY's first day; a month with a change is
     * day-weighted (Sep 2026: ₹15,000 for 16 days, ₹25,000 for 14).
     */
    wageCeilings: { from: string; ceilingPaise: number }[];
  };
  esi: {
    employeeRate: number;
    employerRate: number;
    /** ESI applies while the monthly wage is at or under this. */
    grossCeilingPaise: number;
  };
  /** Payment of Bonus Act. */
  bonus: {
    /** The lowest rate a company may pay (8.33%). */
    minRate: number;
    /** The highest (20%). */
    maxRate: number;
    /** The bonus wage: Basic up to this, or the state minimum wage when set (this if that is lower). */
    wageFloorPaise: number;
    /** No bonus when Basic is above this. */
    eligibilityCeilingPaise: number;
  };
  mealCard: {
    /** Tax-free part of a Meal Card each month. */
    exemptMonthlyPaise: number;
  };
  /** Professional Tax and Labour Welfare Fund by state (lower-case). A company's own state rule wins. */
  states: StateStatutoryDefaults[];
}

export interface StateStatutoryDefaults {
  state: string;
  pt?: PtRule;
  lwf?: LwfRule;
}

/** A rate as a payslip label: 0.12 → "12%", 0.0075 → "0.75%". */
export function ratePercentLabel(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

/** A rate as a percent number, without float noise: 0.0833 → 8.33. */
export function rateToPercent(rate: number): number {
  return Number((rate * 100).toFixed(4));
}

/** Refuses a config for another FY than the pay month's: the caller read the wrong row. */
export function assertConfigFor(config: StatutoryConfig, period: string): void {
  const { fy } = fyOf(period);
  if (config.fy !== fy) throw new Error(`Statutory settings for FY ${config.fy} used for ${period} (FY ${fy})`);
}

function ceilingOn(config: StatutoryConfig, day: string): number {
  const steps = config.epf.wageCeilings;
  let ceiling = steps[0].ceilingPaise;
  for (const step of steps) if (step.from <= day) ceiling = step.ceilingPaise;
  return ceiling;
}

/**
 * The PF ceilings in force across a pay month and for how many days each, in
 * order: one entry normally, two in a month the ceiling changes. Days before
 * someone joined don't count: a September joiner after the 17th is on the
 * new ceiling only (as Zoho books it).
 */
export function epfCeilingSegments(config: StatutoryConfig, period: string, employedFrom?: string): { ceilingPaise: number; days: number }[] {
  assertConfigFor(config, period);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out: { ceilingPaise: number; days: number }[] = [];
  for (let d = 1; d <= days; d++) {
    const day = `${period}-${String(d).padStart(2, '0')}`;
    if (employedFrom && day < employedFrom) continue;
    const ceiling = ceilingOn(config, day);
    const last = out[out.length - 1];
    if (last && last.ceilingPaise === ceiling) last.days++;
    else out.push({ ceilingPaise: ceiling, days: 1 });
  }
  return out;
}

/** The PF wage ceiling for a pay month ("YYYY-MM"), day-weighted across any change in it. */
export function epfCeilingForPeriod(config: StatutoryConfig, period: string): number {
  assertConfigFor(config, period);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0;
  for (let d = 1; d <= days; d++) total += ceilingOn(config, `${period}-${String(d).padStart(2, '0')}`);
  return Math.round(total / days);
}

/** The PF ceiling in force on a day ("YYYY-MM-DD") of the config's year. */
export function epfCeilingOn(config: StatutoryConfig, day: string): number {
  return ceilingOn(config, day);
}

/** A state's PT / LWF from the year's row (state matched lower-case). */
export function stateDefaultsOf(config: StatutoryConfig, state: string | undefined): StateStatutoryDefaults | undefined {
  const key = (state ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return config.states.find((s) => s.state === key);
}
