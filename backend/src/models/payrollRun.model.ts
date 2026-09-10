/**
 * Payroll Run & Payslip (PRD §6). A run is an object with a lifecycle, not a
 * one-shot action: created as a Draft, submitted for approval, and either
 * approved (then paid) or rejected with a note to recall and amend. Each run
 * snapshots one Payslip per employee. Money is INTEGER PAISE.
 */

export type PayrollRunStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'paid';

/** Regular monthly cycle. Bulk Termination / F&F (RUN-4) is a later run type. */
export type PayrollRunType = 'regular';

export interface PayrollRunTotals {
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  employerCostPaise: number;
}

export interface PayrollRun {
  org: string; // -> Company.id
  period: string; // 'YYYY-MM'
  runType: PayrollRunType;
  status: PayrollRunStatus;
  employeeCount: number;
  totals: PayrollRunTotals;
  /** Rejection / recall note (PRD §6). */
  note?: string;
  createdByUserId: string;
  submittedByUserId?: string;
  decidedByUserId?: string;
  decidedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayslipLine {
  code: string;
  name: string;
  calcLabel: string;
  /** Entitled monthly amount before proration. */
  fullPaise: number;
  /** Amount actually paid this cycle after proration. */
  paidPaise: number;
}

export interface PayslipDeductionLine {
  key: string; // 'epf' | 'esi' | 'pt' | 'lwf' | a pay head code
  name: string;
  amountPaise: number;
}

/** The per-employee inputs that fed this payslip, snapshotted for audit. */
export interface PayslipInputs {
  workingDays: number;
  lopDays: number;
  payableDays: number;
  approvedLeaveDays: number;
  approvedOtHours: number;
  overtimePaise: number;
  reimbursementsPaise: number;
  reimbursementClaimIds: string[];
}

export interface Payslip {
  org: string;
  runId: string; // PayrollRun _id hex
  period: string;
  userId: string;
  employeeName: string;
  department?: string;

  annualCtcPaise: number;
  monthlyCtcPaise: number;

  earnings: PayslipLine[];
  deductions: PayslipDeductionLine[];

  pfWagePaise: number;
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number; // after deductions, before reimbursements
  reimbursementsPaise: number;
  netPayablePaise: number; // net + reimbursements
  employerCostPaise: number;

  /** EPF split retained for statutory filing downstream. */
  epf: {
    contributionWagePaise: number;
    employeePaise: number;
    employerEpsPaise: number;
    employerEpfPaise: number;
  };

  inputs: PayslipInputs;
  createdAt: Date;
}
