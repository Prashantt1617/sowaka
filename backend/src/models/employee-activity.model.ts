import { ObjectId } from 'mongodb';

/**
 * One change to an employee's record, as their profile's Activity list shows
 * it: who made it, where from, and each field's old and new value. Written
 * beside the change itself; never read back to decide anything.
 */
export type ActivityVia = 'dashboard' | 'suwi' | 'import';

export type ActivityKind = 'details' | 'manager' | 'shift' | 'kpi' | 'paid_days' | 'created';

export interface ActivityChange {
  /** The record's own field name, e.g. `department`. */
  field: string;
  /** What HR calls it, e.g. "Department". */
  label: string;
  /** Display values; '' when empty. */
  from: string;
  to: string;
}

export interface EmployeeActivity {
  _id?: ObjectId;
  org: string;
  /** The employee changed. */
  userId: string;
  at: Date;
  byUserId: string;
  /** Their name when the change was made, so a later rename or exit keeps the line readable. */
  byName: string;
  via: ActivityVia;
  kind: ActivityKind;
  /** One line, e.g. "Moved to General Shift". */
  title: string;
  changes: ActivityChange[];
  /** A shift move starts the next day: YYYY-MM-DD. */
  effectiveFrom?: string;
  /** The Suwi card that made it, when `via` is suwi. */
  proposalTitle?: string;
}
