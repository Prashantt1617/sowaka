export type ReimbursementStatus = 'pending' | 'approved' | 'declined' | 'paid';

export interface ReimbursementClaim {
  userId: string;
  managerUserId: string;
  expenseDate: Date;
  amount: number;
  /**
   * The reimbursement type this claim is against, stored lowercased by name.
   * The list is per-org and HR-owned (see `ReimbursementType`), so this is a
   * free string rather than a union — a claim keeps reading correctly even
   * after the type behind it is renamed or switched off.
   */
  category: string;
  receiptName?: string;
  receiptObjectKey?: string;
  receiptContentType?: string;
  receiptSize?: number;
  note?: string;
  managerNote?: string; // override note captured when decided from the dashboard
  status: ReimbursementStatus;
  decidedByUserId?: string;
  decidedByRole?: 'manager' | 'admin'; // reimbursements are always decided from the dashboard ('admin')
  decidedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
