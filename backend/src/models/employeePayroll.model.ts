/**
 * What employees do on the app's Payroll screens: their flexible split and
 * the proofs behind their investment declaration. Money is INTEGER PAISE.
 */
import type { DeclarationItemKey } from '../shared/payroll/declaration';

/**
 * One person's split of their flexible pool, from one month to the end of
 * that financial year. A later split replaces it from its own month on.
 * `flexible_splits`, one row per (org, userId, effectiveFrom).
 */
export interface FlexibleSplit {
  org: string;
  userId: string;
  /** "2026-27" */
  fy: string;
  /** "YYYY-MM": the first pay month it applies to. */
  effectiveFrom: string;
  /** Monthly amount per flexible component code. */
  amounts: Record<string, number>;
  /** They ticked "I'll keep bills for these heads". */
  acknowledged: true;
  submittedAt: Date;
}

export type InvestmentProofStatus = 'uploaded' | 'approved' | 'rejected';

/**
 * The proof for one declared item. `investment_proofs`, one row per
 * (org, userId, fy, item); a re-upload replaces the file and the decision.
 */
export interface InvestmentProof {
  org: string;
  userId: string;
  fy: string;
  item: DeclarationItemKey;
  status: InvestmentProofStatus;
  /** The amount on the proof. */
  amountPaise: number;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
  decidedAt?: Date;
  decidedByUserId?: string;
  /** Why HR sent it back. */
  reason?: string;
}

/**
 * A company's deadlines for the employee payroll screens (Company.payrollEmployee).
 * Absent fields take the defaults in employeePayroll.service.
 */
export interface EmployeePayrollSettings {
  /** Day of a month until which the flexible split for that month can change. Default 15. */
  splitCutoffDay?: number;
  /** "MM-DD" in the FY's first calendar year: last day to choose the regime and declare. Default "11-30". */
  declarationDue?: string;
  /** "MM-DD" in the FY's second calendar year: last day to upload proofs. Default "01-31". */
  proofsDue?: string;
}
