import { ObjectId } from 'mongodb';

export type AttendanceSource = 'sql_import' | 'manual';
// Corrections now capture the punch times the employee says they worked,
// rather than a coarse present/half-day/late bucket.
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
  /** Requested punch-in; absent when only a punch-out is being corrected. */
  punchIn?: Date;
  /** Requested punch-out; absent when only a punch-in is being corrected. */
  punchOut?: Date;
  note?: string;
  status: RegularizationStatus;
  managerNote?: string;
  createdAt: Date;
  decidedAt?: Date;
  decidedByUserId?: string;
}
