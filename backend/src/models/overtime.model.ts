import { COMP_OFF_CREDIT, type OvertimeDuration } from './shift.model';

export type OvertimeStatus = 'pending' | 'approved' | 'declined';

/**
 * How approved overtime is compensated: paid through payroll, or comp-off
 * leave — a full day (1) or a half day (0.5) added to their Comp-off balance.
 * The person states a preference on the form; the approver makes the final
 * call (see [OvertimeRequest.compensation] and [preferredCompensation]).
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
   * Overtime pay or comp-off: what payroll and the Comp-off balance read.
   * While pending it is the person's preference from the form; on approval
   * it becomes the approver's decision (the preference, unless they chose
   * otherwise). Absent on every request from before the choice existed and
   * from app builds that predate it; those are treated exactly as they always
   * were — see [compOffDaysOf] and [OVERTIME_PAID_IN_PAYROLL].
   */
  compensation?: OvertimeCompensation;
  /**
   * The person's own choice, kept when the request is approved (null: they
   * made none). Absent on pending requests and on those approved before the
   * approver could decide — for those `compensation` is the preference; see
   * [preferredCompensationOf].
   */
  preferredCompensation?: OvertimeCompensation | null;
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

/** What the person asked for on the form, whatever was decided; null when they chose nothing. */
export function preferredCompensationOf(
  request: Pick<OvertimeRequest, 'compensation' | 'preferredCompensation'>,
): OvertimeCompensation | null {
  return request.preferredCompensation !== undefined ? request.preferredCompensation : request.compensation ?? null;
}

/** Whether two choices are the same: same kind and, for comp-off, the same days. */
export function sameCompensation(a: OvertimeCompensation | null | undefined, b: OvertimeCompensation | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'pay' || a.days === (b as { days: CompOffDays }).days;
}

/**
 * The approved requests payroll pays: all but those taken as comp-off. A
 * request without a choice is paid as it always was.
 */
export const OVERTIME_PAID_IN_PAYROLL = { 'compensation.kind': { $ne: 'comp_off' as const } };

/** "Overtime Pay", or "Leave (Comp-off) · Full day" — the choice in the form's words. */
export function compensationLabel(compensation: OvertimeCompensation | null | undefined): string | undefined {
  if (!compensation) return undefined;
  if (compensation.kind === 'pay') return 'Overtime Pay';
  return `Leave (Comp-off) · ${compensation.days === 1 ? 'Full day' : 'Half day'}`;
}
