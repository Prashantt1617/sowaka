/**
 * Pure salary-structure calculator (PRD §5.6). Given an org's Pay Head catalog,
 * an employee's CTC + per-employee values, and the resolved statutory rule set,
 * it produces the full monthly CTC breakup: each component evaluated from its
 * calculation basis, an optional balancing component reconciling gross to CTC,
 * and the statutory deductions from the engine. No I/O — all inputs explicit,
 * all money in INTEGER PAISE.
 */

import { PayHead } from '../models/payHead.model';
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import {
  computeEpf,
  computeEsi,
  computeLwf,
  computePt,
  EpfResult,
  isEsiApplicable,
  roundToRupee,
} from './statutory-engine';

export interface SalaryCalcInput {
  monthlyCtcPaise: number;
  payHeads: PayHead[];
  /** Per-employee monthly values keyed by pay head code (for flat_amount / overrides). */
  componentValues?: Record<string, number>;
  balancingComponentCode?: string;
  epfApplyCeiling?: boolean;
  ruleSet: ResolvedRuleSet;
  /** 1-based calendar month, for PT/LWF month gating. */
  month: number;
  bonusCategory?: string;
  /** Per-employee statutory applicability (EPF/ESI/LWF). Absent flag = applicable. */
  statutory?: { epf?: boolean; esi?: boolean; lwf?: boolean };
}

export interface ComponentLine {
  code: string;
  name: string;
  category: PayHead['category'];
  componentType: PayHead['componentType'];
  calcLabel: string;
  monthlyPaise: number;
  annualPaise: number;
  /** Whether this line prorates for partial months (LOP). Earnings default true. */
  prorate: boolean;
  /** Whether this earning counts toward the EPF wage base. */
  considerForEpf: boolean;
}

export interface SalaryCalcResult {
  monthlyCtcPaise: number;
  annualCtcPaise: number;
  earnings: ComponentLine[];
  deductions: ComponentLine[]; // non-statutory deduction components
  pfWagePaise: number;
  statutory: {
    epf: EpfResult;
    esi: { applicable: boolean; employeePaise: number; employerPaise: number };
    pt: { amountPaise: number };
    lwf: { applicable: boolean; employeePaise: number; employerPaise: number };
  };
  grossMonthlyPaise: number;
  employeeDeductionsMonthlyPaise: number;
  netMonthlyPaise: number;
  benefitsMonthlyPaise: number;
  employerCostMonthlyPaise: number;
  /** True when a balancing component was set but the other components already exceed CTC. */
  overBudget: boolean;
}

export function calculateSalaryStructure(input: SalaryCalcInput): SalaryCalcResult {
  const monthlyCtc = input.monthlyCtcPaise;
  const values = input.componentValues ?? {};
  const active = input.payHeads.filter((head) => head.active);
  const byCode = new Map(active.map((head) => [head.code, head]));
  const basicCode = active.find((head) => head.componentType === 'basic')?.code;

  const memo = new Map<string, number>();
  const inProgress = new Set<string>();
  let computingBalance = false;

  const evalComponent = (code: string): number => {
    if (code === input.balancingComponentCode) return balancingValue();
    return rawValue(code);
  };

  const rawValue = (code: string): number => {
    const cached = memo.get(code);
    if (cached !== undefined) return cached;
    if (inProgress.has(code)) return 0; // defensive: catalog is validated acyclic
    const head = byCode.get(code);
    if (!head) return 0;

    inProgress.add(code);
    const calc = head.calculation;
    let result = 0;
    if (calc.mode === 'flat_per_month') {
      result = calc.amountPaise ?? 0;
    } else if (calc.mode === 'flat_amount') {
      result = values[code] ?? 0;
    } else {
      const percent = calc.percent ?? 0;
      let base = 0;
      if (calc.base === 'ctc') base = monthlyCtc;
      else if (calc.base === 'basic') base = basicCode ? evalComponent(basicCode) : 0;
      else if (calc.base === 'component' && calc.baseComponentCode)
        base = evalComponent(calc.baseComponentCode);
      result = roundToRupee((base * percent) / 100);
    }
    inProgress.delete(code);
    memo.set(code, result);
    return result;
  };

  const balancingValue = (): number => {
    const code = input.balancingComponentCode;
    if (!code) return 0;
    const cached = memo.get(code);
    if (cached !== undefined) return cached;
    if (computingBalance) return 0; // reentrancy guard
    computingBalance = true;
    const othersTotal = active
      .filter((head) => head.category === 'earning' && head.code !== code)
      .reduce((sum, head) => sum + rawValue(head.code), 0);
    computingBalance = false;
    const residual = Math.max(0, monthlyCtc - othersTotal);
    memo.set(code, residual);
    return residual;
  };

  const lineFor = (head: PayHead): ComponentLine => {
    const monthlyPaise = evalComponent(head.code);
    return {
      code: head.code,
      name: head.name,
      category: head.category,
      componentType: head.componentType,
      calcLabel: calcLabel(head, head.code === input.balancingComponentCode),
      monthlyPaise,
      annualPaise: monthlyPaise * 12,
      // Earnings prorate unless explicitly turned off; deductions never prorate.
      prorate: head.category === 'earning' && head.prorate !== false,
      considerForEpf: head.considerForEpf?.consider === true,
    };
  };

  const earnings = active.filter((head) => head.category === 'earning').map(lineFor);
  const deductions = active.filter((head) => head.category === 'deduction').map(lineFor);

  const grossMonthly = earnings.reduce((sum, line) => sum + line.monthlyPaise, 0);
  const nonStatutoryDeductions = deductions.reduce((sum, line) => sum + line.monthlyPaise, 0);

  // PF wage: the earnings flagged "consider for EPF". The conditional variant
  // (only if PF wage < ₹15,000 after LOP) is a payroll-run concern; at structure
  // level we include any component whose flag is on.
  const pfWagePaise = active
    .filter((head) => head.category === 'earning' && head.considerForEpf?.consider === true)
    .reduce((sum, head) => sum + evalComponent(head.code), 0);

  // Per-employee statutory applicability (default: applicable).
  const epfOn = input.statutory?.epf !== false;
  const esiOn = input.statutory?.esi !== false;
  const lwfOn = input.statutory?.lwf !== false;

  const epf = epfOn
    ? computeEpf({ pfWagePaise, applyCeiling: input.epfApplyCeiling ?? true })
    : { contributionWagePaise: 0, employeePaise: 0, employerTotalPaise: 0, employerEpsPaise: 0, employerEpfPaise: 0 };

  const esiApplicable = esiOn && isEsiApplicable({ grossPaise: grossMonthly });
  const esi = computeEsi({ grossPaise: grossMonthly, applicable: esiApplicable });

  const pt = input.ruleSet.pt
    ? computePt(input.ruleSet.pt, { grossPaise: grossMonthly, month: input.month })
    : { amountPaise: 0 };

  const lwf = lwfOn && input.ruleSet.lwf
    ? computeLwf(input.ruleSet.lwf, { grossPaise: grossMonthly, month: input.month })
    : { applicable: false, employeePaise: 0, employerPaise: 0 };

  const employeeDeductionsMonthly =
    epf.employeePaise + esi.employeePaise + pt.amountPaise + lwf.employeePaise + nonStatutoryDeductions;
  const netMonthly = grossMonthly - employeeDeductionsMonthly;

  const benefitsMonthly = active
    .filter((head) => head.category === 'benefit')
    .reduce((sum, head) => sum + evalComponent(head.code), 0);
  const employerCostMonthly =
    grossMonthly + epf.employerTotalPaise + esi.employerPaise + lwf.employerPaise + benefitsMonthly;

  const nonBalancingEarnings = earnings
    .filter((line) => line.code !== input.balancingComponentCode)
    .reduce((sum, line) => sum + line.monthlyPaise, 0);

  return {
    monthlyCtcPaise: monthlyCtc,
    annualCtcPaise: monthlyCtc * 12,
    earnings,
    deductions,
    pfWagePaise,
    statutory: { epf, esi, pt, lwf },
    grossMonthlyPaise: grossMonthly,
    employeeDeductionsMonthlyPaise: employeeDeductionsMonthly,
    netMonthlyPaise: netMonthly,
    benefitsMonthlyPaise: benefitsMonthly,
    employerCostMonthlyPaise: employerCostMonthly,
    overBudget: Boolean(input.balancingComponentCode) && nonBalancingEarnings > monthlyCtc,
  };
}

function calcLabel(head: PayHead, isBalancing: boolean): string {
  if (isBalancing) return 'Balancing (reconciles to CTC)';
  const calc = head.calculation;
  if (calc.mode === 'flat_per_month') return `₹${rupees(calc.amountPaise ?? 0)} / month`;
  if (calc.mode === 'flat_amount') return 'Flat (per employee)';
  const of =
    calc.base === 'ctc'
      ? 'CTC'
      : calc.base === 'basic'
        ? 'Basic'
        : (calc.baseComponentCode ?? 'component');
  return `${calc.percent ?? 0}% of ${of}`;
}

function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN');
}
