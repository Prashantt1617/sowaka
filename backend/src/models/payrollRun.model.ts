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
  /** E2E-encrypted orgs: the totals, sealed; `totals` is zeros. */
  sealedTotals?: import('../shared/payroll/crypto').Sealed;
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
  /** The payslip label: the template's or component's payslip name, else the component name. */
  name: string;
  /** Not listed on the payslip (showInPayslip off); still counted in every total. */
  hidden?: boolean;
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
  /** Not listed on the payslip; still counted in the totals. */
  hidden?: boolean;
}

/** The per-employee inputs that fed this payslip, snapshotted for audit. */
export interface PayslipInputs {
  workingDays: number;
  lopDays: number;
  /** What attendance and the template's rules made the loss of pay, before any HR figure. */
  attendanceLopDays?: number;
  /** HR typed the loss-of-pay days on the run (kept across recomputes). */
  lopEnteredByHr?: boolean;
  /** Income tax withheld this month, and whether HR typed it (else the TDS engine, or none). */
  incomeTaxPaise?: number;
  incomeTaxEnteredByHr?: boolean;
  /** HR typed the overtime pay on the run. */
  overtimeEnteredByHr?: boolean;
  /** This month only: one-time earnings and deductions HR entered, paise by component code. */
  componentAmounts?: Record<string, number>;
  /** How the TDS engine reached this month's income tax, when it did (HR didn't type one). */
  tds?: import('../shared/payroll/tds').TdsResult & { proofs?: string };
  /** What the template's attendance rules cost this month, one line per rule. */
  attendanceDeductions?: { label: string; count: number; days: number; trigger?: string; every?: number; deductDays?: number }[];
  /** Paid leave days from the template's monthly allowance that offset the docked days. */
  paidLeaveDaysApplied?: number;
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
  employeeId?: string;
  designation?: string;
  joiningDate?: Date;

  annualCtcPaise: number;
  monthlyCtcPaise: number;

  earnings: PayslipLine[];
  deductions: PayslipDeductionLine[];

  pfWagePaise: number;
  grossPaise: number;
  /** Taxable salary this month, for TDS year-to-date. Older slips: use grossPaise. */
  taxablePaise?: number;
  employeeDeductionsPaise: number;
  netPaise: number; // after deductions, before reimbursements
  reimbursementsPaise: number;
  netPayablePaise: number; // net + reimbursements
  employerCostPaise: number;

  /** Whether ESI covered this person this month; carries coverage through the contribution period. */
  esiApplicable?: boolean;
  /** The structure's reimbursements paid this month. */
  reimbursementLines?: { code: string; name: string; amountPaise: number; hidden?: boolean }[];
  /** What the employer pays on top of gross, line by line. */
  employer?: { epfPaise: number; epsPaise: number; edliPaise: number; adminPaise: number; esiPaise: number; lwfPaise: number; benefitsPaise: number; totalPaise: number };

  /** EPF split retained for statutory filing downstream. */
  epf: {
    contributionWagePaise: number;
    employeePaise: number;
    employerEpsPaise: number;
    employerEpfPaise: number;
  };

  inputs: PayslipInputs;
  /** E2E-encrypted orgs: the whole computed slip, sealed with the org's data key; amounts above are zero. */
  sealed?: import('../shared/payroll/crypto').Sealed;
  /** The same slip for the employee alone, wrapped to their public key (when they have one). */
  sealedForEmployee?: import('../shared/payroll/crypto').SealedForPerson;
  createdAt: Date;
}
