/**
 * Pure salary-structure calculator (PRD §5.6). Given an org's Pay Head catalog,
 * an employee's CTC + per-employee values, and the resolved statutory rule set,
 * it produces the full monthly CTC breakup: each component evaluated from its
 * calculation basis, an optional balancing component reconciling gross to CTC,
 * and the statutory deductions from the engine. No I/O — all inputs explicit,
 * all money in INTEGER PAISE.
 */

import { PayHead } from '../models/payHead.model';
import { epfCeilingForPeriod, ResolvedRuleSet } from '../models/statutoryRule.model';
import { StatutorySettings } from '../models/statutorySettings.model';
import { TemplateStatutoryWages } from '../models/salaryTemplate.model';
import { applyStatutory, PersonStatutory } from './statutory-apply';
import { EpfResult, roundToRupee } from './statutory-engine';
import { defaultStatutorySettings, minimumWageFor } from './statutorySettings.service';

/** The synthetic earning line the org's Statutory Bonus setting adds. */
export const STATUTORY_BONUS_CODE = 'STATUTORY_BONUS';
/** Payment of Bonus Act: people whose Basic is above this are not covered. */
const BONUS_ELIGIBILITY_PAISE = 21_000_00;

export interface SalaryCalcInput {
  monthlyCtcPaise: number;
  payHeads: PayHead[];
  /** Per-employee monthly values keyed by pay head code (for flat_amount / overrides). */
  componentValues?: Record<string, number>;
  balancingComponentCode?: string;
  ruleSet: ResolvedRuleSet;
  /** 1-based calendar month, for PT/LWF month gating. */
  month: number;
  /** "YYYY-MM", for minimum wages that change over time. Defaults to this month. */
  period?: string;
  bonusCategory?: string;
  /** Per-employee statutory applicability (EPF/ESI/LWF). Absent flag = applicable. */
  statutory?: PersonStatutory;
  /** The org's Statutory Components settings. Defaults reproduce the old behaviour. */
  settings?: StatutorySettings;
  /** The template's PF / ESI wage applicability. Absent reproduces the old behaviour. */
  statutoryWages?: TemplateStatutoryWages;
}

/**
 * A component as the template's PF wage setting sees it. Without
 * `pfComponents` the component's own "Consider for EPF" stands. With it, a
 * listed earning counts (keeping an "only under the ceiling" condition the
 * component has), and an unlisted one does not.
 */
export function withTemplateWages(head: PayHead, wages: TemplateStatutoryWages | undefined): PayHead {
  if (!wages?.pfComponents || head.category !== 'earning') return head;
  if (!wages.pfComponents.includes(head.code)) return { ...head, considerForEpf: { consider: false } };
  const cond = head.considerForEpf?.consider ? head.considerForEpf.condition : undefined;
  return { ...head, considerForEpf: { consider: true, condition: cond && cond !== 'always' ? cond : 'always' } };
}

export interface ComponentLine {
  code: string;
  name: string;
  /** How the line reads on the payslip: the template's or component's payslip name, else `name`. */
  payslipName: string;
  /** Listed on the payslip. Hidden lines still count in every total. */
  showInPayslip: boolean;
  category: PayHead['category'];
  componentType: PayHead['componentType'];
  calcLabel: string;
  monthlyPaise: number;
  annualPaise: number;
  /** Whether this line prorates for partial months (LOP). Earnings default true. */
  prorate: boolean;
  /** Whether this earning counts toward the EPF wage base. */
  considerForEpf: boolean;
  /** Counts toward the EPF wage only while the PF wage is under the ceiling. */
  epfConditional?: boolean;
  /** Counts toward the ESI wage, when the template names the ESI components. */
  inEsiWage?: boolean;
  /** A one-time earning (entered on a run): on top of CTC, never prorated. */
  oneTime?: boolean;
}

/** An earning paid once (Bonus), entered per run, not part of the monthly CTC split. */
function isOneTime(head: PayHead): boolean {
  return head.category === 'earning' && head.recurrence === 'one_time';
}

export interface SalaryCalcResult {
  monthlyCtcPaise: number;
  annualCtcPaise: number;
  earnings: ComponentLine[];
  /** Paid every month at their amount, inside CTC, outside gross pay. */
  reimbursements: ComponentLine[];
  /** Employer-paid benefits (gratuity…), inside CTC. */
  benefits: ComponentLine[];
  deductions: ComponentLine[]; // non-statutory deduction components
  pfWagePaise: number;
  /** Employer contributions the org's settings place inside CTC. */
  includedInCtcPaise: number;
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
  /** The template's PF / ESI wage applicability this was worked out under. */
  statutoryWages?: TemplateStatutoryWages;
}

export function calculateSalaryStructure(input: SalaryCalcInput): SalaryCalcResult {
  const monthlyCtc = input.monthlyCtcPaise;
  const values = input.componentValues ?? {};
  const wages = input.statutoryWages;
  const active = input.payHeads.filter((head) => head.active).map((head) => withTemplateWages(head, wages));
  const esiCodes = wages?.esiComponents ? new Set(wages.esiComponents) : undefined;
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
      // Percent is kept to 2 decimals; multiply in hundredths so 4.81% of
      // ₹1,25,000 is exactly ₹6,012.50 (→ ₹6,013), not ₹6,012.4999…
      result = roundToRupee((base * Math.round(percent * 100)) / 10000);
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
      .filter((head) => head.category === 'earning' && head.code !== code && !isOneTime(head))
      .reduce((sum, head) => sum + rawValue(head.code), 0);
    computingBalance = false;
    const residual = Math.max(0, monthlyCtc - othersTotal);
    memo.set(code, residual);
    return residual;
  };

  const settings = input.settings ?? defaultStatutorySettings('');
  const ceiling = epfCeilingForPeriod(input.period ?? new Date().toISOString().slice(0, 7));
  const balancingCode = input.balancingComponentCode;

  const lineFor = (head: PayHead): ComponentLine => {
    const monthlyPaise = evalComponent(head.code);
    const epfFlag = head.considerForEpf;
    return {
      code: head.code,
      name: head.name,
      payslipName: head.payslipName?.trim() || head.name,
      showInPayslip: head.showInPayslip !== false,
      category: head.category,
      componentType: head.componentType,
      calcLabel: calcLabel(head, head.code === balancingCode),
      monthlyPaise,
      annualPaise: monthlyPaise * 12,
      // Earnings prorate unless explicitly turned off or paid once; deductions never prorate.
      prorate: head.category === 'earning' && head.prorate !== false && !isOneTime(head),
      ...(isOneTime(head) ? { oneTime: true } : {}),
      considerForEpf: epfFlag?.consider === true,
      epfConditional: epfFlag?.consider === true && Boolean(epfFlag.condition) && epfFlag.condition !== 'always',
      ...(esiCodes ? { inEsiWage: head.category === 'earning' && esiCodes.has(head.code) } : {}),
    };
  };

  // A Statutory Bonus component in the template follows the Payment of Bonus
  // Act: its percent of Basic or the state minimum wage, whichever is higher,
  // and nothing for people whose Basic is above ₹21,000.
  const bonusPeriod = input.period ?? new Date().toISOString().slice(0, 7);
  for (const head of active) {
    if (head.category !== 'earning' || head.componentType !== 'statutory_bonus') continue;
    const basic = basicCode ? rawValue(basicCode) : 0;
    let amount = 0;
    if (basic > 0 && basic <= BONUS_ELIGIBILITY_PAISE) {
      const floor = minimumWageFor(settings.bonus, input.ruleSet.state, input.bonusCategory, bonusPeriod);
      const pct = head.calculation.mode === 'percentage' ? head.calculation.percent ?? 8.33 : settings.bonus.ratePercent;
      amount = roundToRupee((Math.max(basic, floor) * Math.round(pct * 100)) / 10000);
    }
    memo.set(head.code, amount);
  }

  // Statutory Bonus, when the org pays it monthly and no template component
  // already carries it: a share of Basic or the state minimum wage, whichever
  // is higher, for people whose Basic is within the Act's limit.
  const basicPaise = basicCode ? evalComponent(basicCode) : 0;
  const templateHasBonus = active.some((head) => head.componentType === 'statutory_bonus');
  let bonusLine: ComponentLine | undefined;
  if (settings.bonus.enabled && settings.bonus.frequency === 'monthly' && !templateHasBonus && basicPaise > 0 && basicPaise <= BONUS_ELIGIBILITY_PAISE) {
    const period = input.period ?? new Date().toISOString().slice(0, 7);
    const floor = minimumWageFor(settings.bonus, input.ruleSet.state, input.bonusCategory, period);
    const amount = roundToRupee((Math.max(basicPaise, floor) * settings.bonus.ratePercent) / 100);
    bonusLine = {
      code: STATUTORY_BONUS_CODE,
      name: 'Statutory Bonus',
      payslipName: 'Statutory Bonus',
      showInPayslip: true,
      category: 'earning',
      componentType: 'statutory_bonus',
      calcLabel: `${settings.bonus.ratePercent}% of ${floor > basicPaise ? 'minimum wage' : 'Basic'}`,
      monthlyPaise: amount,
      annualPaise: amount * 12,
      prorate: true,
      considerForEpf: false,
      ...(esiCodes ? { inEsiWage: esiCodes.has(STATUTORY_BONUS_CODE) } : {}),
    };
  }

  // Reimbursements: their monthly amount (a flat amount on the template, a
  // per-person value, or the component's monthly limit). Paid every month.
  const reimbursementValue = (head: PayHead): number => {
    const calc = head.calculation;
    if (calc.mode === 'flat_per_month') return calc.amountPaise ?? 0;
    if (values[head.code] !== undefined) return values[head.code];
    if (calc.mode === 'flat_amount' && calc.amountPaise) return calc.amountPaise;
    return head.maxClaimablePaise ?? 0;
  };
  const reimbursementHeads = active.filter((head) => head.category === 'reimbursement');
  const benefitHeads = active.filter((head) => head.category === 'benefit');
  const reimbursementsTotal = reimbursementHeads.reduce((sum, head) => sum + reimbursementValue(head), 0);
  const benefitsTotal = benefitHeads.reduce((sum, head) => sum + rawValue(head.code), 0);

  // The statutory month for a given balancing amount. CTC holds the earnings,
  // the reimbursements and the employer benefits, so all of them come out
  // before the balancing component takes what is left.
  const nonBalancing = active.filter((head) => head.category === 'earning' && head.code !== balancingCode);
  // One-time earnings (a bonus entered on a run) are paid on top: they are in
  // gross pay but do not come out of the CTC the balancing component shares.
  const earningsOthers = nonBalancing.filter((head) => !isOneTime(head)).reduce((sum, head) => sum + rawValue(head.code), 0) + (bonusLine?.monthlyPaise ?? 0);
  const oneTimeTotal = nonBalancing.filter(isOneTime).reduce((sum, head) => sum + rawValue(head.code), 0);
  const othersTotal = earningsOthers + reimbursementsTotal + benefitsTotal;
  const balancingHead = balancingCode ? byCode.get(balancingCode) : undefined;
  const statutoryAt = (balancePaise: number) => {
    let always = 0;
    let conditional = 0;
    const pfHeads = [...nonBalancing, ...(balancingHead ? [balancingHead] : [])];
    for (const head of pfHeads) {
      if (head.considerForEpf?.consider !== true) continue;
      const value = head.code === balancingCode ? balancePaise : rawValue(head.code);
      const cond = head.considerForEpf.condition;
      if (cond && cond !== 'always') conditional += value;
      else always += value;
    }
    // The ESI wage, when the template names its components; else gross pay.
    let esiWagePaise: number | undefined;
    if (esiCodes) {
      esiWagePaise = 0;
      for (const head of pfHeads) if (esiCodes.has(head.code)) esiWagePaise += head.code === balancingCode ? balancePaise : rawValue(head.code);
      if (bonusLine && esiCodes.has(STATUTORY_BONUS_CODE)) esiWagePaise += bonusLine.monthlyPaise;
    }
    return applyStatutory({
      settings,
      ruleSet: input.ruleSet,
      month: input.month,
      grossPaise: earningsOthers + oneTimeTotal + (balancingHead ? balancePaise : 0),
      pfAlwaysPaise: always,
      pfConditionalPaise: conditional,
      pfTestPaise: always,
      ceilingPaise: ceiling,
      person: input.statutory,
      esiWagePaise,
      pfWageMode: wages?.pfWageMode,
    });
  };

  // The balancing component takes what CTC has left after the other earnings
  // and any employer contributions placed inside CTC. Those contributions can
  // depend on the balance (ESI on gross), so settle it in a few passes.
  if (balancingHead) {
    let balance = Math.max(0, monthlyCtc - othersTotal);
    for (let pass = 0; pass < 8; pass++) {
      const next = Math.max(0, monthlyCtc - othersTotal - statutoryAt(balance).includedInCtcPaise);
      if (Math.abs(next - balance) < 100) {
        balance = next;
        break;
      }
      balance = next;
    }
    memo.set(balancingHead.code, balance);
  }

  const earnings = [...active.filter((head) => head.category === 'earning').map(lineFor), ...(bonusLine ? [bonusLine] : [])];
  const reimbursements: ComponentLine[] = reimbursementHeads.map((head) => {
    const monthlyPaise = reimbursementValue(head);
    return { ...lineFor(head), monthlyPaise, annualPaise: monthlyPaise * 12, prorate: false, considerForEpf: false };
  });
  const benefits = benefitHeads.map(lineFor);
  const deductions = active.filter((head) => head.category === 'deduction').map(lineFor);

  const grossMonthly = earnings.reduce((sum, line) => sum + line.monthlyPaise, 0);
  const nonStatutoryDeductions = deductions.reduce((sum, line) => sum + line.monthlyPaise, 0);
  const st = statutoryAt(balancingHead ? memo.get(balancingHead.code) ?? 0 : 0);
  const { epf, esi, pt, lwf } = st;

  const employeeDeductionsMonthly =
    epf.employeePaise + esi.employeePaise + pt.amountPaise + lwf.employeePaise + nonStatutoryDeductions;
  const netMonthly = grossMonthly - employeeDeductionsMonthly;

  const benefitsMonthly = benefitsTotal;
  const employerCostMonthly = grossMonthly + reimbursementsTotal + st.employerContributionsPaise + benefitsMonthly;

  const nonBalancingEarnings = earnings
    .filter((line) => line.code !== balancingCode && !line.oneTime)
    .reduce((sum, line) => sum + line.monthlyPaise, 0);

  return {
    monthlyCtcPaise: monthlyCtc,
    annualCtcPaise: monthlyCtc * 12,
    earnings,
    reimbursements,
    benefits,
    deductions,
    pfWagePaise: st.pfWagePaise,
    includedInCtcPaise: st.includedInCtcPaise,
    statutory: { epf, esi, pt, lwf },
    grossMonthlyPaise: grossMonthly,
    employeeDeductionsMonthlyPaise: employeeDeductionsMonthly,
    netMonthlyPaise: netMonthly,
    benefitsMonthlyPaise: benefitsMonthly,
    employerCostMonthlyPaise: employerCostMonthly,
    overBudget: Boolean(balancingCode) && nonBalancingEarnings + reimbursementsTotal + benefitsTotal + st.includedInCtcPaise > monthlyCtc,
    ...(wages ? { statutoryWages: wages } : {}),
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
