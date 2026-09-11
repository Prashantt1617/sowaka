/**
 * Feed moderation: what someone reports, and who they choose not to see.
 *
 * Both live outside `connect_posts` on purpose. A report has to survive the
 * post it is about — HR still needs to see what was reported after the author
 * deletes it — and a block belongs to the person who made it, not to any one
 * post.
 */

/** Why a post or comment was reported. Fixed list; the app shows the labels. */
export type ContentReportReason =
  | 'harassment'
  | 'hate'
  | 'sexual'
  | 'violence'
  | 'confidential'
  | 'spam'
  | 'other';

export const CONTENT_REPORT_REASONS: ContentReportReason[] = [
  'harassment',
  'hate',
  'sexual',
  'violence',
  'confidential',
  'spam',
  'other',
];

export type ContentReportStatus = 'open' | 'actioned' | 'dismissed';

export interface ContentReport {
  id: string;
  org: string;
  postId: string;
  /** Set when the report is about one comment rather than the post itself. */
  commentId?: string;
  reason: ContentReportReason;
  /** What the reporter typed, if anything. */
  note?: string;
  reporterUserId: string;
  reporterName: string;
  /** Absent on system-generated posts, which have no human author. */
  authorUserId?: string;
  authorName: string;
  /**
   * A copy of the reported words, taken when the report is raised. HR has to
   * be able to judge a report whose content the author has since edited or
   * deleted.
   */
  excerpt: string;
  postTag: string;
  status: ContentReportStatus;
  createdAt: Date;
  reviewedAt?: Date;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewNote?: string;
}

/**
 * One person choosing not to see another in Connect. Personal and one-way:
 * it hides the blocked colleague's posts and comments from the blocker's feed
 * and nothing else — no notification, no effect on either person's work.
 */
export interface ConnectBlock {
  org: string;
  userId: string;
  blockedUserId: string;
  createdAt: Date;
}
