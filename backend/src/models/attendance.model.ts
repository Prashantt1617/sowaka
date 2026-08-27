import { ObjectId } from 'mongodb';

export type AttendanceSource = 'sql_import' | 'manual';
export type RegularizationPeriod = 'present' | 'half_day' | 'late';
export type RegularizationStatus = 'pending' | 'approved' | 'declined';

export interface AttendanceRecord {
  employeeId: string;
  userId?: string;
  workDate: string;
  punchIn?: Date;
  punchOut?: Date;
  source: AttendanceSource;
  sourceKey: string;
  importedAt: Date;
  updatedAt: Date;
}

export interface AttendanceRegularization {
  _id?: ObjectId;
  userId: string;
  employeeId: string;
  managerUserId: string;
  workDate: string;
  period: RegularizationPeriod;
  note?: string;
  status: RegularizationStatus;
  managerNote?: string;
  createdAt: Date;
  decidedAt?: Date;
  decidedByUserId?: string;
}
