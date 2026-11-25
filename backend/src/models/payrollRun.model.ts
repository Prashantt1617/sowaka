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
  /** Net pay held for people on notice (paid with their final settlement), and how many. */
  heldPaise?: number;
  heldCount?: number;
}

export interface PayrollRun {
  org: string; // -> Company.id
  period: string; // 'YYYY-MM'
  /** The days the run pays for and the base days its salaries are spread over (see payroll_periods). */
  periodFrom?: string;
  periodTo?: string;
  baseDays?: number;
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
  /**
   * Of lopDays, the days before joining and after leaving (0 when HR typed the
   * loss of pay): not loss of pay, the person was not employed. Runs before
   * 23 Nov 2026 leave it out; payslipDays reads it from attendanceDeductions.
   */
  notEmployedDays?: number;
  /** Left during the period: the last working day, for the payslip's "Not employed" line. */
  leftOn?: string;
  /** Income tax withheld this month, and whether HR typed it (else the TDS engine, or none). */
  incomeTaxPaise?: number;
  incomeTaxEnteredByHr?: boolean;
  /** HR typed the overtime pay on the run. */
  overtimeEnteredByHr?: boolean;
  /** This month only: one-time earnings and deductions HR entered, paise by component code. */
  componentAmounts?: Record<string, number>;
  /** How the TDS engine reached this month's income tax, when it did (HR didn't type one). */
  tds?: import('../shared/payroll/tds').TdsResult & { proofs?: string };
  /** Salary reimbursements this FY so far (this month included): paid, covered by approved bills, taxed. */
  reimbursementTax?: { paidPaise: number; exemptPaise: number; taxablePaise: number };
  /** What the template's attendance rules cost this month, one line per rule. */
  attendanceDeductions?: { label: string; count: number; days: number; trigger?: string; every?: number; deductDays?: number }[];
  /** Paid leave days from the template's monthly allowance that offset the docked days. */
  paidLeaveDaysApplied?: number;
  payableDays: number;
  /**
   * The period paid on more than one salary (a CTC revision took effect inside it): each part,
   * its days and loss of pay, on the salary in force then. Absent when one salary covered the period.
   */
  salarySegments?: SalarySegmentView[];
  /** Arrears for earlier, already submitted periods from a back-dated revision (see salary-revisions). */
  arrears?: PayslipArrears;
  approvedLeaveDays: number;
  approvedOtHours: number;
  overtimePaise: number;
  reimbursementsPaise: number;
  reimbursementClaimIds: string[];
}

export interface SalarySegmentView {
  from: string;
  to: string;
  /** Calendar days of the period in this part. */
  days: number;
  /** Loss of pay (and days not employed) placed in this part. */
  lopDays: number;
  /** Paid days of this part, in the period's base days. */
  paidDays: number;
  annualCtcPaise: number;
  salaryTemplateCode?: string;
}

export interface PayslipArrearsLine {
  code: string;
  name: string;
  /** The component's monthly amount for that period on the old salary and on the revised one. */
  oldMonthlyPaise: number;
  newMonthlyPaise: number;
  amountPaise: number;
}

export interface PayslipArrearsItem {
  /** The revision (revisionKey) and the earlier period it pays for: paid once per pair. */
  revisionKey: string;
  effectiveFrom: string;
  period: string;
  from: string;
  to: string;
  days: number;
  lopDays: number;
  paidDays: number;
  baseDays: number;
  previousCtcPaise: number;
  annualCtcPaise: number;
  lines: PayslipArrearsLine[];
  amountPaise: number;
  /** Days no Sowaka run paid (a month paid outside Sowaka): no figure, HR enters any arrears by hand. */
  notInSowaka?: true;
}

export interface PayslipArrears {
  /** The earning (flagged Arrears on Salary Components) it is paid with; absent when the company has none. */
  payHeadCode?: string;
  /**
   * paid: worked out and paid; entered_by_hr: HR typed the amount on the run (0 = not paid);
   * not_set_up: no component is flagged Arrears, nothing paid (and still owed: the next run offers it again);
   * negative: the revision lowered pay, nothing recovered automatically.
   */
  status: 'paid' | 'entered_by_hr' | 'not_set_up' | 'negative';
  workedOutPaise: number;
  paidPaise: number;
  items: PayslipArrearsItem[];
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
  /**
   * Held: worked out as usual but not paid with this run, because the person is
   * serving notice (their pay is held from the day notice begins and paid with
   * the final settlement). Out of the bank file; still on the run and the registers.
   */
  held?: { reason: 'notice'; since: string };

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
  createdAt: Date;
}
