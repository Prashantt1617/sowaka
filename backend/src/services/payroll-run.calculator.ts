/**
 * Pure payslip calculator (PRD §6). Post-processes an employee's entitled monthly
 * breakup (from the salary calculator) into what is actually paid this cycle:
 * prorates prorate-able earnings by attendance, adds approved overtime to gross,
 * RECOMPUTES the wage-dependent statutory deductions on the prorated wage
 * (RUN-3 — "EPF/ESI ceilings react to actual wage paid, not just the structure"),
 * and adds approved reimbursements on top. No I/O; money in INTEGER PAISE.
 */

import { epfCeilingForPeriod, ResolvedRuleSet } from '../models/statutoryRule.model';
import { StatutorySettings } from '../models/statutorySettings.model';
import { SalaryCalcResult } from './salary-calculator';
import { applyStatutory, PersonStatutory } from './statutory-apply';
import { roundToRupee } from './statutory-engine';
import { defaultStatutorySettings } from './statutorySettings.service';

export interface PayslipInputSet {
  workingDays: number;
  lopDays: number;
  overtimePaise: number;
  reimbursementsPaise: number;
  ruleSet: ResolvedRuleSet;
  month: number;
  /** Per-employee statutory applicability (EPF/ESI/LWF). Absent flag = applicable. */
  statutory?: PersonStatutory;
  /** The org's Statutory Components settings. Defaults reproduce the old behaviour. */
  settings?: StatutorySettings;
  /** ESI covered this person earlier in the same contribution period. */
  esiCoveredEarlier?: boolean;
  /** Income tax (TDS) to withhold this month. */
  incomeTaxPaise?: number;
  /** "YYYY-MM": picks the PF ceiling in force that month. */
  period?: string;
}

export interface PayslipEarningLine {
  code: string;
  /** The payslip label (payslip name, else the component name). */
  name: string;
  /** Not listed on the payslip; still counted in the totals. */
  hidden?: boolean;
  calcLabel: string;
  fullPaise: number;
  paidPaise: number;
}

export interface PayslipDeduction {
  key: string;
  name: string;
  amountPaise: number;
  /** Not listed on the payslip; still counted in the totals. */
  hidden?: boolean;
}

export interface PayslipComputation {
  payableDays: number;
  prorationFactor: number;
  earnings: PayslipEarningLine[];
  deductions: PayslipDeduction[];
  pfWagePaise: number;
  grossPaise: number;
  /** Taxable salary this month (taxable earnings as paid, plus overtime), for TDS. */
  taxablePaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  netPayablePaise: number;
  employerCostPaise: number;
  esiApplicable: boolean;
  /** What the employer pays on top of gross this month, line by line. */
  employer: EmployerContributions;
  /** The structure's reimbursements, paid in full this month. */
  reimbursementLines: { code: string; name: string; amountPaise: number; hidden?: boolean }[];
  epf: {
    contributionWagePaise: number;
    employeePaise: number;
    employerEpsPaise: number;
    employerEpfPaise: number;
  };
}

export interface EmployerContributions {
  epfPaise: number;
  epsPaise: number;
  edliPaise: number;
  adminPaise: number;
  esiPaise: number;
  lwfPaise: number;
  /** Employer benefits in the structure (gratuity…). */
  benefitsPaise: number;
  totalPaise: number;
}

export function computePayslip(base: SalaryCalcResult, input: PayslipInputSet): PayslipComputation {
  const payableDays = Math.max(0, input.workingDays - input.lopDays);
  const factor = input.workingDays > 0 ? payableDays / input.workingDays : 1;

  // Prorate earnings; overtime is added to gross but never prorated.
  const earnings: PayslipEarningLine[] = base.earnings.map((line) => ({
    code: line.code,
    name: line.payslipName ?? line.name,
    ...(line.showInPayslip === false ? { hidden: true } : {}),
    calcLabel: line.calcLabel,
    fullPaise: line.monthlyPaise,
    // A full month pays the structure exactly (a balancing component can carry
    // paise when the monthly CTC does); a prorated month rounds to the rupee.
    paidPaise: line.prorate && factor !== 1 ? roundToRupee(line.monthlyPaise * factor) : line.monthlyPaise,
  }));

  const earningsPaid = earnings.reduce((sum, line) => sum + line.paidPaise, 0);
  const grossPaise = earningsPaid + input.overtimePaise;

  // PF wage from the earnings flagged for EPF, at their PAID (prorated) value.
  // Components that count only under the ceiling are tested after loss of pay
  // or as in the structure, per the org's setting.
  const settings = input.settings ?? defaultStatutorySettings('');
  const paidByCode = new Map(earnings.map((line) => [line.code, line.paidPaise]));
  let alwaysPaid = 0;
  let alwaysFull = 0;
  let conditionalPaid = 0;
  for (const line of base.earnings) {
    if (!line.considerForEpf) continue;
    const paid = paidByCode.get(line.code) ?? 0;
    if (line.epfConditional) conditionalPaid += paid;
    else {
      alwaysPaid += paid;
      alwaysFull += line.monthlyPaise;
    }
  }
  const monthCeiling = epfCeilingForPeriod(input.period ?? new Date().toISOString().slice(0, 7));
  const ceiling = settings.epf.proRateRestricted ? roundToRupee(monthCeiling * factor) : monthCeiling;
  // The ESI wage when the template names its components (overtime counts), else gross.
  const esiWagePaise = base.statutoryWages?.esiComponents
    ? base.earnings.filter((line) => line.inEsiWage).reduce((sum, line) => sum + (paidByCode.get(line.code) ?? 0), 0) + input.overtimePaise
    : undefined;
  const st = applyStatutory({
    settings,
    ruleSet: input.ruleSet,
    month: input.month,
    grossPaise,
    esiWagePaise,
    pfWageMode: base.statutoryWages?.pfWageMode,
    pfAlwaysPaise: alwaysPaid,
    pfConditionalPaise: conditionalPaid,
    pfTestPaise: settings.epf.considerLOP ? alwaysPaid : alwaysFull,
    ceilingPaise: ceiling,
    person: input.statutory,
    esiCoveredEarlier: input.esiCoveredEarlier,
  });
  const { epf, esi, pt, lwf, pfWagePaise } = st;

  // Non-statutory deduction components are taken at full value (not prorated).
  const nonStatutoryDeductions: PayslipDeduction[] = base.deductions.map((line) => ({
    key: line.code,
    name: line.payslipName ?? line.name,
    amountPaise: line.monthlyPaise,
    ...(line.showInPayslip === false ? { hidden: true } : {}),
  }));

  const deductions: PayslipDeduction[] = [];
  if (epf.employeePaise > 0)
    deductions.push({ key: 'epf', name: 'Employee EPF (12%)', amountPaise: epf.employeePaise });
  if (esi.applicable && esi.employeePaise > 0)
    deductions.push({ key: 'esi', name: 'Employee ESI (0.75%)', amountPaise: esi.employeePaise });
  if (pt.amountPaise > 0)
    deductions.push({ key: 'pt', name: 'Professional Tax', amountPaise: pt.amountPaise });
  if (lwf.applicable && lwf.employeePaise > 0)
    deductions.push({ key: 'lwf', name: 'Labour Welfare Fund', amountPaise: lwf.employeePaise });
  // Meal Card is loaded onto a food card, not paid in cash: the same amount
  // comes back off the payslip as Food Coupon Deduction.
  const mealCard = base.earnings
    .filter((line) => line.componentType === 'meal_card')
    .reduce((sum, line) => sum + (paidByCode.get(line.code) ?? 0), 0);
  if (mealCard > 0) deductions.push({ key: 'food_coupon', name: 'Food Coupon Deduction', amountPaise: mealCard });
  if ((input.incomeTaxPaise ?? 0) > 0) deductions.push({ key: 'income_tax', name: 'Income Tax', amountPaise: input.incomeTaxPaise! });
  deductions.push(...nonStatutoryDeductions);

  const employeeDeductionsPaise = deductions.reduce((sum, d) => sum + d.amountPaise, 0);
  const netPaise = grossPaise - employeeDeductionsPaise;
  // The structure's reimbursements are paid in full every month; approved
  // business-expense claims come on top.
  const reimbursementLines = (base.reimbursements ?? []).map((line) => ({
    code: line.code,
    name: line.payslipName ?? line.name,
    amountPaise: line.monthlyPaise,
    ...(line.showInPayslip === false ? { hidden: true } : {}),
  }));
  const structureReimbursements = reimbursementLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const reimbursementsPaise = structureReimbursements + input.reimbursementsPaise;
  const netPayablePaise = netPaise + reimbursementsPaise;

  const employerCostPaise = grossPaise + structureReimbursements + st.employerContributionsPaise + base.benefitsMonthlyPaise;

  return {
    payableDays,
    prorationFactor: factor,
    earnings,
    deductions,
    pfWagePaise,
    grossPaise,
    taxablePaise: base.earnings.filter((line) => line.taxable !== false).reduce((sum, line) => sum + (paidByCode.get(line.code) ?? 0), 0) + input.overtimePaise,
    employeeDeductionsPaise,
    netPaise,
    reimbursementsPaise,
    netPayablePaise,
    employerCostPaise,
    esiApplicable: esi.applicable,
    employer: {
      epfPaise: epf.employerEpfPaise,
      epsPaise: epf.employerEpsPaise,
      edliPaise: epf.edliPaise ?? 0,
      adminPaise: epf.adminPaise ?? 0,
      esiPaise: esi.employerPaise,
      lwfPaise: lwf.employerPaise,
      benefitsPaise: base.benefitsMonthlyPaise,
      totalPaise: st.employerContributionsPaise + base.benefitsMonthlyPaise,
    },
    reimbursementLines,
    epf: {
      contributionWagePaise: epf.contributionWagePaise,
      employeePaise: epf.employeePaise,
      employerEpsPaise: epf.employerEpsPaise,
      employerEpfPaise: epf.employerEpfPaise,
    },
  };
}
