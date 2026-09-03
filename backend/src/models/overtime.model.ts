export type OvertimeStatus = 'pending' | 'approved' | 'declined';

export interface OvertimeRequest {
  userId: string;
  managerUserId: string;
  workDate: Date;
  startTime: Date;
  endTime: Date;
  hours: number;
  note?: string;
  managerNote?: string;
  status: OvertimeStatus;
  decidedByUserId?: string;
  decidedByRole?: 'manager' | 'admin'; // 'admin' = overridden from the HR dashboard
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
