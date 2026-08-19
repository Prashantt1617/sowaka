/**
 * Pure payslip calculator (PRD §6). Post-processes an employee's entitled monthly
 * breakup (from the salary calculator) into what is actually paid this cycle:
 * prorates prorate-able earnings by attendance, adds approved overtime to gross,
 * RECOMPUTES the wage-dependent statutory deductions on the prorated wage
 * (RUN-3 — "EPF/ESI ceilings react to actual wage paid, not just the structure"),
 * and adds approved reimbursements on top. No I/O; money in INTEGER PAISE.
 */

import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { SalaryCalcResult } from './salary-calculator';
import {
  computeEpf,
  computeEsi,
  computeLwf,
  computePt,
  isEsiApplicable,
  roundToRupee,
} from './statutory-engine';

export interface PayslipInputSet {
  workingDays: number;
  lopDays: number;
  overtimePaise: number;
  reimbursementsPaise: number;
  epfApplyCeiling?: boolean;
  ruleSet: ResolvedRuleSet;
  month: number;
  /** Per-employee statutory applicability (EPF/ESI/LWF). Absent flag = applicable. */
  statutory?: { epf?: boolean; esi?: boolean; lwf?: boolean };
}

export interface PayslipEarningLine {
  code: string;
  name: string;
  calcLabel: string;
  fullPaise: number;
  paidPaise: number;
}

export interface PayslipDeduction {
  key: string;
  name: string;
  amountPaise: number;
}

export interface PayslipComputation {
  payableDays: number;
  prorationFactor: number;
  earnings: PayslipEarningLine[];
  deductions: PayslipDeduction[];
  pfWagePaise: number;
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  netPayablePaise: number;
  employerCostPaise: number;
  epf: {
    contributionWagePaise: number;
    employeePaise: number;
    employerEpsPaise: number;
    employerEpfPaise: number;
  };
}

export function computePayslip(base: SalaryCalcResult, input: PayslipInputSet): PayslipComputation {
  const payableDays = Math.max(0, input.workingDays - input.lopDays);
  const factor = input.workingDays > 0 ? payableDays / input.workingDays : 1;

  // Prorate earnings; overtime is added to gross but never prorated.
  const earnings: PayslipEarningLine[] = base.earnings.map((line) => ({
    code: line.code,
    name: line.name,
    calcLabel: line.calcLabel,
    fullPaise: line.monthlyPaise,
    paidPaise: line.prorate ? roundToRupee(line.monthlyPaise * factor) : line.monthlyPaise,
  }));

  const earningsPaid = earnings.reduce((sum, line) => sum + line.paidPaise, 0);
  const grossPaise = earningsPaid + input.overtimePaise;

  // PF wage from the earnings flagged for EPF, at their PAID (prorated) value.
  const paidByCode = new Map(earnings.map((line) => [line.code, line.paidPaise]));
  const pfWagePaise = base.earnings
    .filter((line) => line.considerForEpf)
    .reduce((sum, line) => sum + (paidByCode.get(line.code) ?? 0), 0);

  const epfOn = input.statutory?.epf !== false;
  const esiOn = input.statutory?.esi !== false;
  const lwfOn = input.statutory?.lwf !== false;

  const epf = epfOn
    ? computeEpf({ pfWagePaise, applyCeiling: input.epfApplyCeiling ?? true })
    : { contributionWagePaise: 0, employeePaise: 0, employerTotalPaise: 0, employerEpsPaise: 0, employerEpfPaise: 0 };
  const esi = computeEsi({ grossPaise, applicable: esiOn && isEsiApplicable({ grossPaise }) });
  const pt = input.ruleSet.pt
    ? computePt(input.ruleSet.pt, { grossPaise, month: input.month })
    : { amountPaise: 0 };
  const lwf = lwfOn && input.ruleSet.lwf
    ? computeLwf(input.ruleSet.lwf, { grossPaise, month: input.month })
    : { applicable: false, employeePaise: 0, employerPaise: 0 };

  // Non-statutory deduction components are taken at full value (not prorated).
  const nonStatutoryDeductions: PayslipDeduction[] = base.deductions.map((line) => ({
    key: line.code,
    name: line.name,
    amountPaise: line.monthlyPaise,
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
  deductions.push(...nonStatutoryDeductions);

  const employeeDeductionsPaise = deductions.reduce((sum, d) => sum + d.amountPaise, 0);
  const netPaise = grossPaise - employeeDeductionsPaise;
  const netPayablePaise = netPaise + input.reimbursementsPaise;

  const employerCostPaise =
    grossPaise +
    epf.employerTotalPaise +
    esi.employerPaise +
    lwf.employerPaise +
    base.benefitsMonthlyPaise;

  return {
    payableDays,
    prorationFactor: factor,
    earnings,
    deductions,
    pfWagePaise,
    grossPaise,
    employeeDeductionsPaise,
    netPaise,
    reimbursementsPaise: input.reimbursementsPaise,
    netPayablePaise,
    employerCostPaise,
    epf: {
      contributionWagePaise: epf.contributionWagePaise,
      employeePaise: epf.employeePaise,
      employerEpsPaise: epf.employerEpsPaise,
      employerEpfPaise: epf.employerEpfPaise,
    },
  };
}
