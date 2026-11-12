import { COMP_OFF_CREDIT, type OvertimeDuration } from './shift.model';

export type OvertimeStatus = 'pending' | 'approved' | 'declined';

/**
 * How approved overtime is compensated, as the person chose it on the form:
 * paid through payroll, or comp-off leave — a full day (1) or a half day (0.5)
 * added to their Comp-off balance.
 */
export type OvertimeCompensation = { kind: 'pay' } | { kind: 'comp_off'; days: CompOffDays };
export type CompOffDays = 1 | 0.5;

export interface OvertimeRequest {
  userId: string;
  managerUserId: string;
  workDate: Date;
  startTime: Date;
  endTime: Date;
  hours: number;
  /**
   * What was claimed: a half day or a full day, as the person chose it.
   * Records from before this was stored carry only hours; see
   * [overtimeDurationOf].
   */
  duration?: OvertimeDuration;
  /**
   * Overtime pay or comp-off, as chosen. Absent on every request from before
   * the choice existed and from app builds that predate it; those are treated
   * exactly as they always were — see [compOffDaysOf] and
   * [OVERTIME_PAID_IN_PAYROLL].
   */
  compensation?: OvertimeCompensation;
  note?: string;
  managerNote?: string;
  status: OvertimeStatus;
  decidedByUserId?: string;
  decidedByRole?: 'manager' | 'admin'; // 'admin' = overridden from the HR dashboard
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The duration a request was for. Stored on every request since claims
 * became a plain half or full day; an older record is judged by its hours
 * against the shift's full-day threshold, as it was when it was filed.
 */
export function overtimeDurationOf(
  request: Pick<OvertimeRequest, 'duration' | 'hours'>,
  fullDayHours: number,
): OvertimeDuration {
  return request.duration ?? (request.hours >= fullDayHours ? 'full_day' : 'half_day');
}

/**
 * Comp-off days an approved request adds to the Comp-off balance.
 *
 * Comp-off chosen: the days chosen. Overtime pay chosen: none — payroll pays
 * it instead. No choice (every request from before it existed, and older app
 * builds): the half or full day claimed, exactly as before, so no balance
 * anybody already has moves.
 */
export function compOffDaysOf(
  request: Pick<OvertimeRequest, 'duration' | 'hours' | 'compensation'>,
  fullDayHours: number,
): number {
  const compensation = request.compensation;
  if (compensation?.kind === 'pay') return 0;
  if (compensation?.kind === 'comp_off') return compensation.days;
  return COMP_OFF_CREDIT[overtimeDurationOf(request, fullDayHours)];
}

/**
 * The approved requests payroll pays: all but those taken as comp-off. A
 * request without a choice is paid as it always was.
 */
export const OVERTIME_PAID_IN_PAYROLL = { 'compensation.kind': { $ne: 'comp_off' as const } };

/** "Overtime Pay", or "Leave (Comp-off) · Full day" — the choice in the form's words. */
export function compensationLabel(compensation: OvertimeCompensation | undefined): string | undefined {
  if (!compensation) return undefined;
  if (compensation.kind === 'pay') return 'Overtime Pay';
  return `Leave (Comp-off) · ${compensation.days === 1 ? 'Full day' : 'Half day'}`;
}
