import type { OvertimeDuration } from './shift.model';

export type OvertimeStatus = 'pending' | 'approved' | 'declined';

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
