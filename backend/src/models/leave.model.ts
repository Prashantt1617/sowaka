export type LeaveStatus = 'pending' | 'approved' | 'declined';

export interface Leave {
  userId: string; // -> User.userId
  type: 'sick' | 'casual' | 'earned';
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
  status: LeaveStatus;
  managerNote?: string;
  decidedByUserId?: string; // -> User.userId
  decidedByRole?: 'manager' | 'admin'; // 'admin' = overridden from the HR dashboard
  decidedAt?: Date;
  createdAt?: number;
  updatedAt?: Date;
}
