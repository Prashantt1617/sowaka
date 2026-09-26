import { ObjectId } from 'mongodb';
import { PunchLocation } from './office.model';

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
/**
 * 'wfh' and 'client_visit' are about *where* the day was worked rather than
 * what it counts as, and both are claims only the manager can settle — nobody
 * marks their own day present from outside the office. They are raised from the
 * punch screen when the location check refuses, and the day becomes a worked
 * day when, and only when, the manager approves.
 */
export type RegularizationDayType =
  | 'full_day'
  | 'half_day'
  | 'wfh'
  | 'client_visit'
  /** Retired name for a client visit; kept so older requests still read. */
  | 'office_visit'
  | 'leave';

export const REGULARIZATION_DAY_TYPES: RegularizationDayType[] = [
  'full_day',
  'half_day',
  'wfh',
  'client_visit',
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
  /**
   * Where each punch was taken, when the app supplied it. Kept as the device
   * reported it — coordinates, the fix's accuracy, which office it matched and
   * how far away — so a disputed day can be looked into rather than argued
   * over a yes/no that nobody can check.
   */
  punchInLocation?: PunchLocation;
  punchOutLocation?: PunchLocation;
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
  /** Whether the reporting manager or an HR admin settled it. */
  decidedByRole?: 'manager' | 'admin';
}
