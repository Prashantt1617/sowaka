/**
 * `cancelled`: taken back (see `cancelLeave`) — a pending one by the employee at once, an approved one
 * once its approver agreed to the employee's cancellation request. Every reader that counts leave asks
 * for pending or approved rows by name, so a cancelled row counts nowhere; an approved leave with a
 * cancellation request still waiting is approved, and counts.
 */
export type LeaveStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface Leave {
  userId: string; // -> User.userId
  // A leave type key from the employee's template: one of the built-in four
  // (comp_off is earned by approved overtime) or one HR added, like 'emergency'.
  type: string;
  startDate: Date;
  endDate: Date;
  /**
   * Leave days actually consumed: every calendar day in the range (weekends
   * included) minus company holidays, or 0.5 for a half day. Stored at apply
   * time so the count can't drift if the holiday calendar changes later.
   * Absent on rows written before this field existed.
   */
  days?: number;
  /** Half a day off. Only valid when startDate and endDate are the same day. */
  halfDay?: boolean;
  reason: string;
  /** Supporting document (a medical note, a booking) — object key in S3. */
  documentKey?: string;
  /** The file's original name, so the app can label the chip. */
  documentName?: string;
  status: LeaveStatus;
  managerNote?: string;
  decidedByUserId?: string; // -> User.userId
  decidedByRole?: 'manager' | 'admin'; // 'admin' = overridden from the HR dashboard
  decidedAt?: Date;
  /** When the employee cancelled it, and what they told their manager, if anything. */
  cancelledAt?: Date;
  cancelNote?: string;
  /**
   * The employee asked to cancel this leave after it was approved. Until the approver decides, the
   * leave stays approved; approving it cancels the leave, declining it leaves it approved.
   */
  cancelRequest?: LeaveCancelRequest;
  createdAt?: number;
  updatedAt?: Date;
}

/** An employee's request to cancel a leave that was already approved, and what became of it. */
export interface LeaveCancelRequest {
  requestedAt: Date;
  /** What the employee told their manager, if anything. */
  note?: string;
  status: 'pending' | 'approved' | 'declined';
  decidedAt?: Date;
  decidedByUserId?: string; // -> User.userId
  decidedByRole?: 'manager' | 'admin';
  /** The approver's note with the decision (a reason for declining, mostly). */
  decisionNote?: string;
}
