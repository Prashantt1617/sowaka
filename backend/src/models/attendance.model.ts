import { ObjectId } from 'mongodb';

export type AttendanceSource = 'sql_import' | 'manual';
export type RegularizationStatus = 'pending' | 'approved' | 'declined';

/**
 * What the employee says the day should have been.
 *
 * A correction used to submit the punch times someone believed they worked,
 * which asked a manager to vouch for a clock reading nobody witnessed. Asking
 * for the day's classification instead is the judgement a manager can actually
 * make, and it is what payroll consumes.
 */
export type RegularizationDayType = 'full_day' | 'half_day' | 'wfh' | 'leave';

export const REGULARIZATION_DAY_TYPES: RegularizationDayType[] = [
  'full_day',
  'half_day',
  'wfh',
  'leave',
];

export interface AttendanceRecord {
  employeeId: string;
  userId?: string;
  workDate: string;
  punchIn?: Date;
  punchOut?: Date;
  /**
   * Set when an approved correction reclassified the day. It outranks whatever
   * the punches grade to, because a manager has explicitly said what the day
   * was.
   */
  dayType?: RegularizationDayType;
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
  /** What the day should be recorded as. */
  requestedDayType?: RegularizationDayType;
  /** @deprecated Punch times from corrections raised before day types. */
  punchIn?: Date;
  /** @deprecated */
  punchOut?: Date;
  note?: string;
  status: RegularizationStatus;
  managerNote?: string;
  createdAt: Date;
  decidedAt?: Date;
  decidedByUserId?: string;
}
