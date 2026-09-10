export type FeedbackRecordStatus = 'saved' | 'sent';

/**
 * One scored line on a review.
 *
 * The name and subtitle are a snapshot, not a reference: a sent review has to
 * keep reading the way it read when it was sent, so renaming or archiving a KPI
 * parameter later must not rewrite history. `parameterId` is what makes a
 * parameter trendable across cycles despite that.
 */
export interface FeedbackParameter {
  /** Absent on reviews written before parameters became HR-configurable. */
  parameterId?: string;
  name: string;
  /** Copy shown under the name at the time of scoring. Absent on legacy rows. */
  subtitle?: string;
  /**
   * Percentage this parameter contributed to the overall score, snapshotted
   * like the copy: re-weighting a template later must not silently restate what
   * a sent review meant. Absent on reviews written before weighting existed,
   * which were an even split.
   */
  weight?: number;
  score: number;
  note: string;
}

export interface FeedbackRecord {
  managerUserId: string;
  employeeUserId: string;
  period: string;
  status: FeedbackRecordStatus;
  parameters: FeedbackParameter[];
  extra: string;
  overallScore: number;
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
}

