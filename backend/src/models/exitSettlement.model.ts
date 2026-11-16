import type { ObjectId } from 'mongodb';

/**
 * The final settlement of someone who has left: every held month, the last
 * month up to the last working day, leave encashment, gratuity, notice pay,
 * less any notice recovery, PF and the year's remaining income tax.
 *
 * A draft is worked out afresh every time it is opened (so a monthly run made
 * since, or a clearance tick, shows); HR's changes to a line are kept in
 * `changes` and laid over it. Approving freezes the lines; paid closes it.
 */
export type SettlementStatus = 'draft' | 'approved' | 'paid';

export interface SettlementLine {
  /** 'salary:2026-11', 'leave_encashment', 'gratuity', 'notice_pay', 'notice_recovery', 'pf', 'other_deductions', 'income_tax'. */
  key: string;
  side: 'earning' | 'deduction';
  label: string;
  /** How it was worked out, in a line: "12 days × ₹2,500". */
  note?: string;
  /** What the rules give. */
  computedPaise: number;
  /** What stands: HR's figure when changed, else the computed one. */
  amountPaise: number;
  changedReason?: string;
  changedByName?: string;
  /** Salary lines. */
  period?: string;
  payslipId?: string;
  /** Worked out here because no monthly run has made this period's payslip yet. */
  estimated?: boolean;
}

export interface SettlementChange {
  amountPaise: number;
  reason: string;
  byUserId: string;
  byName?: string;
  at: Date;
}

/** How the year's tax was added up, for HR to read (and to type the figure where the tax engine is off). */
export interface SettlementTaxWorking {
  engine: boolean;
  regime?: 'new' | 'old';
  fy: string;
  /** Salary already paid this year, before anything held. */
  paidTaxablePaise: number;
  /** Held months, the last month and notice pay. */
  settlementTaxablePaise: number;
  /** Leave encashment and gratuity above the tax-free limits. */
  excessExemptPaise: number;
  taxableIncomePaise?: number;
  annualTaxPaise?: number;
  alreadyDeductedPaise: number;
  duePaise: number;
  /** Taken more than the year needs: comes back in their tax return. */
  refundViaReturnPaise?: number;
}

export interface ExitSettlement {
  _id?: ObjectId;
  org: string;
  userId: string;
  status: SettlementStatus;
  lines: SettlementLine[];
  earningsPaise: number;
  deductionsPaise: number;
  /** Earnings less deductions: paid to them when positive, recovered from them when negative. */
  payablePaise: number;
  tax?: SettlementTaxWorking;
  /** HR's changes by line key, laid over the computed lines of a draft. */
  changes?: Record<string, SettlementChange>;
  /** Approved with clearance still open: why. */
  clearanceOverrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  approvedByUserId?: string;
  approvedByName?: string;
  paidAt?: Date;
  paidByName?: string;
}
