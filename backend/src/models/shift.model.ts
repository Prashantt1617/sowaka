import { ObjectId } from 'mongodb';

/** How a day is marked when one or both punches never arrived. */
export type DayMark = 'Absent' | 'Half Day' | 'Present' | 'Pending Regularisation';

export interface ShiftOvertimeRules {
  eligible: boolean;
  onHoliday: boolean;
  onWeeklyOff: boolean;
  beyondShift: boolean;
  beyondShiftHours: number;
}

export interface ShiftCorrectionRules {
  /** Auto-marked outcomes that let an employee raise a correction. */
  triggers: string[];
  approver: string;
  reasons: string[];
  managerWithoutEmployee: boolean;
  hrOverride: boolean;
  skipLevel: boolean;
  backdateByEmployee: boolean;
  backdateByManager: boolean;
  backdateDays: number;
}

export interface ShiftLeaveRules {
  advanceDays: number;
  allowBackdated: boolean;
  backdatedDays: number;
  approver: string;
  managerOnBehalf: boolean;
  hrOverride: boolean;
  skipLevel: boolean;
}

export interface ShiftTemplate {
  _id?: ObjectId;
  org: string;
  name: string;
  active: boolean;
  /** Local wall-clock "HH:MM". An end at or before the start means overnight. */
  startTime: string;
  endTime: string;
  /**
   * A template carries no rules of its own. The thresholds, the grace, the
   * missing-punch marks and the weekly-off all come from the org's
   * `OrgShiftPolicy`, saved under Shifts › Policies — a template is the window
   * plus the vehicle that policy is assigned to people by.
   */
  /** The shift everyone without one of their own is graded against. */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The org-wide shift policy — the one HR fills in under Shifts › Policies.
 *
 * This is the setup: every figure the app grades a day against lives here, once
 * for the whole org. A shift template carries only the working window it opens
 * and closes on; it inherits everything below rather than restating it.
 */
export interface OrgShiftPolicy {
  _id?: ObjectId;
  org: string;
  // Policies › Shift
  missingPunchIn: DayMark;
  missingPunchOut: DayMark;
  missingBoth: DayMark;
  /** Week of the month (1-5) -> weekday indexes off, 0 = Mon .. 6 = Sun. */
  weeklyOff: Record<string, number[]>;
  // Policies › Half day
  minHalfDayHours: number;
  minFullDayHours: number;
  // Policies › Late
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
  // Policies › Overtime / Attendance correction / Leaves
  overtime: ShiftOvertimeRules;
  correction: ShiftCorrectionRules;
  leave: ShiftLeaveRules;
  updatedAt: Date;
  updatedByUserId?: string;
}

/** What an org sees on a policy tab it has never saved. */
export const DEFAULT_ORG_SHIFT_POLICY: Omit<OrgShiftPolicy, 'org' | 'updatedAt'> = {
  missingPunchIn: 'Pending Regularisation',
  missingPunchOut: 'Pending Regularisation',
  missingBoth: 'Absent',
  weeklyOff: { '1': [6], '2': [6], '3': [6], '4': [6], '5': [6] },
  minHalfDayHours: 4,
  minFullDayHours: 8,
  lateGraceMinutes: 10,
  earlyOutGraceMinutes: 10,
  overtime: { eligible: true, onHoliday: true, onWeeklyOff: true, beyondShift: false, beyondShiftHours: 1 },
  correction: {
    triggers: ['Missing punch', 'Half day'],
    approver: 'Reporting manager',
    reasons: ['WFH', 'On duty', 'Site visit', 'Forgot to punch', 'Apply leave'],
    managerWithoutEmployee: true, hrOverride: true, skipLevel: false,
    backdateByEmployee: true, backdateByManager: true, backdateDays: 7,
  },
  leave: {
    advanceDays: 30, allowBackdated: true, backdatedDays: 3,
    approver: 'Reporting manager', managerOnBehalf: false, hrOverride: true, skipLevel: false,
  },
};

/**
 * What the app grades against before HR has saved a single shift. These are the
 * numbers the shift form itself opens with, so an org that never visits the
 * page behaves the way the page says it would.
 */
export const DEFAULT_SHIFT_POLICY = {
  name: 'General',
  startTime: '09:00',
  endTime: '18:00',
  minHalfDayHours: 4,
  minFullDayHours: 8,
  lateGraceMinutes: 10,
  earlyOutGraceMinutes: 10,
} as const;
