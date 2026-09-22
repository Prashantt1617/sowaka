import { ObjectId } from 'mongodb';

/** How a day is marked when one or both punches never arrived. */
/**
 * How a day is marked when one or both punches never arrived.
 *
 * There is deliberately no "pending regularisation": whether the day can be
 * corrected is its own column now, so a mark that meant "awaiting a correction"
 * said the same thing twice and could contradict it.
 */
export type DayMark = 'Absent' | 'Half Day' | 'Present';

export interface ShiftOvertimeRules {
  /** How far back an overtime claim can reach, in days. */
  backdateDays: number;
  /**
   * Whether the org offers overtime at all. HR can still switch it off for one
   * employee (`User.overtimeEligible`) or a whole team
   * (`Company.overtimeDisabledDepartments`); both gates have to pass.
   */
  eligible: boolean;
}

/**
 * Overtime is applied as a half day or a full day — nothing else, and not
 * configurable. Anything finer would have to be reconciled against the shift's
 * own hours, and comp-off is credited in half days regardless.
 */
export const OVERTIME_DURATIONS = ['half_day', 'full_day'] as const;
export type OvertimeDuration = (typeof OVERTIME_DURATIONS)[number];

/** Comp-off credited to the employee's balance per approved overtime. */
export const COMP_OFF_CREDIT: Record<OvertimeDuration, number> = {
  half_day: 0.5,
  full_day: 1,
};

/**
 * How many punches a day is built from.
 *
 * Asked before anything else, because it decides which days can even exist:
 * on a single-punch setup there is no punch-out to be missing, so the whole
 * missing-punch grid collapses to one case.
 */
export type PunchMode = 'Both punches' | 'Single punch';

export const PUNCH_MODES: PunchMode[] = ['Both punches', 'Single punch'];

/**
 * What an employee may ask a day to be changed to when they raise a
 * correction against it.
 *
 * Only an absent day is configurable. A half day can only be disputed as a
 * full day — there is nothing else it could become — so that outcome is fixed
 * in code and the dashboard shows it rather than offering it.
 */
export type CorrectionOutcome = 'Full day' | 'Half day' | 'Leave';

export const CORRECTION_OUTCOMES: CorrectionOutcome[] = ['Full day', 'Half day', 'Leave'];

/** The only thing a half day can be corrected to. */
export const HALF_DAY_CORRECTION_OUTCOMES: CorrectionOutcome[] = ['Full day'];

export interface ShiftCorrectionRules {
  /**
   * Which missing-punch outcomes let an employee raise a correction. Only a
   * missing punch can be corrected — a short or late day is a fact about hours
   * worked, not a gap in the record.
   */
  triggers: string[];
  /** Where punch data comes from in the first place. */
  punchFormat: PunchFormat;
  /** Whether the day is built from one punch or two. */
  punchMode: PunchMode;
  /**
   * What an employee may ask an absent day to become. HR picks any number of
   * these; an empty list means an absent day cannot be corrected at all, which
   * is also what turning its trigger off means.
   */
  absentOutcomes: CorrectionOutcome[];
  approver: string;
  managerWithoutEmployee: boolean;
  hrOverride: boolean;
  skipLevel: boolean;
  backdateDays: number;
}

/**
 * How an employee's punches are captured.
 *
 * Set per shift template rather than once for the org, so a factory floor on a
 * biometric device and a field team on geotagged punches can run side by side.
 * Only Biometric is wired end to end today; in-app punch-in is accepted here so
 * templates can be set up ahead of the screens being built.
 */
export type PunchFormat =
  | 'Biometric'
  | 'Geotag (powered by Sowaka)'
  | 'Present by default (Auto Punch)'
  | 'In-app punch in';

export const PUNCH_FORMATS: PunchFormat[] = [
  'Biometric',
  'Geotag (powered by Sowaka)',
  'Present by default (Auto Punch)',
  'In-app punch in',
];

/**
 * The four ways a day can come out, and what a correction may be raised
 * against. "Both punches present" is included because a complete day can still
 * be disputed — an employee who worked through and was graded a half day has
 * something to contest, even though no punch is missing.
 */
export const CORRECTION_TRIGGERS = [
  'Missing punch-in',
  'Missing punch-out',
  'Both punches missing',
  'Both punches present',
];

/**
 * The leave types an org runs. 'sick' is no longer offered — it stays in the
 * union so leave already taken against it still reads and validates.
 */
export type LeaveTypeKey = 'sick' | 'casual' | 'earned' | 'comp_off';

/**
 * One leave type's accrual and what happens to an unused balance at year end.
 *
 * The year-end order is fixed and is the flow HR was asked for: carry forward
 * up to a limit, then encash what is left (all of it, or up to a limit), and
 * anything still remaining lapses. Lapse is not a setting — it is the tail of
 * the other two, which is why the dashboard only displays it.
 */
export interface LeaveTypeRule {
  key: LeaveTypeKey;
  name: string;
  /** Days earned per month. Ignored for comp-off, which overtime credits. */
  perMonth: number;
  /** When the balance is processed. */
  resetOn: 'calendar_year' | 'financial_year';
  /** Unused days carried into the next year, at most. */
  carryForwardDays: number;
  /** What happens to what is left after carry-forward. */
  encashment: 'none' | 'all' | 'limit';
  /** Days encashable when `encashment` is 'limit'. */
  encashLimitDays: number;
  /** How far ahead this type can be applied for. */
  advanceDays: number;
  /** Whether this type can be applied for after the fact. */
  allowBackdated: boolean;
  /** How far back, when backdating is allowed. */
  backdatedDays: number;
}

/**
 * What a year-end run decided for one employee's balance of one leave type.
 *
 * Written once, when the year is closed. The next year's opening balance reads
 * `carried` from here rather than re-deriving it, so a balance cannot change
 * retroactively because someone edited the policy afterwards.
 */
export interface LeaveYearEnd {
  _id?: ObjectId;
  org: string;
  userId: string;
  /** The year that closed. */
  year: number;
  type: LeaveTypeKey;
  closing: number;
  carried: number;
  encashed: number;
  lapsed: number;
  processedAt: Date;
}

export const LEAVE_TYPE_KEYS: LeaveTypeKey[] = ['sick', 'casual', 'earned', 'comp_off'];

export const DEFAULT_LEAVE_TYPES: LeaveTypeRule[] = [
  // Sick leave was dropped — the org runs these three.
  { key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 15, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 3 },
  { key: 'earned', name: 'Earned Leave', perMonth: 1.5, resetOn: 'financial_year', carryForwardDays: 15, encashment: 'all', encashLimitDays: 0, advanceDays: 90, allowBackdated: false, backdatedDays: 0 },
  { key: 'comp_off', name: 'Comp-off', perMonth: 0, resetOn: 'calendar_year', carryForwardDays: 5, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: false, backdatedDays: 0 },
];

/**
 * Year-end processing for one balance, in the order HR configured it.
 *
 * Carry forward first, then encash what is left, then whatever still remains
 * lapses. With "carry up to 15, encash everything above that": a closing
 * balance of 8 carries 8 and encashes 0; a closing balance of 20 carries 15
 * and encashes 5.
 */
export function processYearEnd(closing: number, rule: LeaveTypeRule) {
  const balance = Math.max(0, closing);
  const carried = Math.min(balance, Math.max(0, rule.carryForwardDays));
  const remainder = balance - carried;
  const encashed =
    rule.encashment === 'all'
      ? remainder
      : rule.encashment === 'limit'
        ? Math.min(remainder, Math.max(0, rule.encashLimitDays))
        : 0;
  return { carried, encashed, lapsed: remainder - encashed };
}

export interface ShiftLeaveRules {
  approver: string;
  hrOverride: boolean;
  /**
   * Whether these people have a leave balance at all.
   *
   * Some teams are on unlimited leave: they apply, a manager approves, and
   * nothing is counted down. Accrual, carry-forward and encashment describe a
   * balance, so with this off none of them mean anything — the app stops asking
   * for a leave type and shows what has been applied for instead of what is
   * left, and the server stops checking a balance nobody keeps.
   */
  balanceTracked: boolean;
  /** Accrual, year-end handling and the application window, per leave type. */
  types: LeaveTypeRule[];
}

/** The rule half of a policy — everything a template can override. */
export type ShiftPolicyRules = Omit<OrgShiftPolicy, '_id' | 'org' | 'updatedAt' | 'updatedByUserId'>;

/**
 * A named override of the org policy, plus the people it applies to.
 *
 * A template is created by copying the org policy as it stands, so it opens
 * pre-filled and HR edits from a working starting point. Editing a template
 * never touches the org policy: the two are separate documents, and an
 * employee follows whichever one reaches them.
 *
 * Everyone the template is *not* assigned to stays on the org policy. An
 * employee belongs to at most one template — assigning them to a second moves
 * them, so there is never a question of which override wins.
 */
export interface ShiftTemplate {
  _id?: ObjectId;
  org: string;
  name: string;
  active: boolean;
  /** The full policy this template applies to the people it covers. */
  policy: ShiftPolicyRules;
  /**
   * How the people on this template have their punches captured, and how many
   * punches their day is built from.
   *
   * Absent means inherit the org's setting, which is what every template
   * written before this existed does — so a factory floor on a biometric
   * device and a field team on geotagged punches can run side by side without
   * changing anyone who was never given a format of their own.
   */
  punchFormat?: PunchFormat;
  punchMode?: PunchMode;
  /** Employees this template overrides the org policy for. */
  assignedUserIds: string[];
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
  // Policies › Shift — the working window, local wall-clock "HH:MM". An end at
  // or before the start means the shift runs overnight.
  startTime: string;
  endTime: string;
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
  startTime: '09:00',
  endTime: '18:00',
  missingPunchIn: 'Absent',
  missingPunchOut: 'Absent',
  missingBoth: 'Absent',
  weeklyOff: { '1': [6], '2': [6], '3': [6], '4': [6], '5': [6] },
  minHalfDayHours: 4,
  minFullDayHours: 8,
  lateGraceMinutes: 10,
  earlyOutGraceMinutes: 10,
  overtime: { eligible: true, backdateDays: 7 },
  correction: {
    // A complete day is correct by default, so it is not up for correction
    // unless HR turns it on.
    triggers: CORRECTION_TRIGGERS.filter((trigger) => trigger !== 'Both punches present'),
    punchFormat: 'Present by default (Auto Punch)',
    punchMode: 'Both punches',
    absentOutcomes: [...CORRECTION_OUTCOMES],
    approver: 'Reporting manager',
    managerWithoutEmployee: true, hrOverride: true, skipLevel: false,
    backdateDays: 7,
  },
  leave: {
    approver: 'Reporting manager',
    hrOverride: true,
    balanceTracked: true,
    types: DEFAULT_LEAVE_TYPES.map((type) => ({ ...type })),
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
