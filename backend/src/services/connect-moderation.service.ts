import { randomUUID } from 'node:crypto';
import { connectPosts, contentReports, users } from '../config/db';
import {
  CONTENT_REPORT_REASONS,
  ContentReport,
  ContentReportReason,
  ContentReportStatus,
} from '../models/moderation.model';
import { ConnectError, orgForUser, requireVisiblePost } from './connect.service';
import { notifyUsers } from './notification.service';

/**
 * Reporting a post or a comment, and what HR does with the report afterwards.
 *
 * A report is a message to the reporter's own HR team — Sowaka is one
 * organisation per feed, and the people who can act on what a colleague wrote
 * are the people who employ them both. So a report notifies everyone with
 * dashboard access in that organisation and lands in a queue there, rather
 * than going anywhere near us.
 */

const REASON_LABELS: Record<ContentReportReason, string> = {
  harassment: 'Harassment or bullying',
  hate: 'Hate speech or discrimination',
  sexual: 'Sexual or explicit content',
  violence: 'Violence or threats',
  confidential: 'Confidential information',
  spam: 'Spam or irrelevant content',
  other: 'Something else',
};

export function reportReasonLabel(reason: ContentReportReason) {
  return REASON_LABELS[reason];
}

export interface ReportContentInput {
  reason: string;
  note?: string;
  commentId?: string;
}

export async function reportConnectContent(
  viewerUserId: string,
  postId: string,
  input: ReportContentInput,
) {
  // Same audience check as reading it: you can only report what you can see.
  const post = await requireVisiblePost(viewerUserId, postId);
  const reporter = await users().findOne({ userId: viewerUserId });
  if (!reporter) throw new ConnectError(404, 'User not found');

  const reason = parseReason(input.reason);
  const note = (input.note ?? '').trim().slice(0, 1000);
  const commentId = input.commentId?.trim() || undefined;
  const comment = commentId
    ? post.comments.find((item) => item.id === commentId)
    : undefined;
  if (commentId && !comment) throw new ConnectError(404, 'Comment not found');

  const authorUserId = comment ? comment.userId : post.author.userId;
  if (authorUserId && authorUserId === viewerUserId) {
    throw new ConnectError(400, 'You cannot report your own post');
  }

  // Reporting the same thing twice is a mis-tap, not a second complaint.
  const existing = await contentReports().findOne({
    reporterUserId: viewerUserId,
    postId,
    commentId: commentId ?? { $exists: false },
    status: 'open',
  });
  if (existing) {
    return { id: existing.id, alreadyReported: true };
  }

  const report: ContentReport = {
    id: randomUUID(),
    org: orgForUser(reporter),
    postId,
    ...(commentId ? { commentId } : {}),
    reason,
    ...(note ? { note } : {}),
    reporterUserId: viewerUserId,
    reporterName: reporter.name,
    ...(authorUserId ? { authorUserId } : {}),
    authorName: comment ? comment.name : post.author.name,
    excerpt: excerptOf(comment ? comment.text : postText(post.body)),
    postTag: post.tag,
    status: 'open',
    createdAt: new Date(),
  };
  await contentReports().insertOne(report);
  await notifyReviewers(report);
  return { id: report.id, alreadyReported: false };
}

/** HR's queue, newest first. `status` narrows it; omit for everything open. */
export async function listContentReports(adminUserId: string, status?: string) {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new ConnectError(404, 'User not found');
  const filter: Record<string, unknown> = { org: orgForUser(admin) };
  if (status && status !== 'all') filter.status = parseStatus(status);

  const reports = await contentReports().find(filter).sort({ createdAt: -1 }).limit(200).toArray();
  if (reports.length === 0) return [];

  // The post is fetched fresh so HR sees whether the content is still up —
  // the excerpt on the report is only the snapshot taken when it was raised.
  const posts = await connectPosts()
    .find({ id: { $in: [...new Set(reports.map((report) => report.postId))] } })
    .toArray();
  const postsById = new Map(posts.map((post) => [post.id, post]));

  return reports.map((report) => {
    const post = postsById.get(report.postId);
    const comment = report.commentId
      ? post?.comments.find((item) => item.id === report.commentId)
      : undefined;
    const stillPresent = report.commentId ? Boolean(comment) : Boolean(post);
    return {
      ...report,
      _id: undefined,
      reasonLabel: reportReasonLabel(report.reason),
      target: report.commentId ? ('comment' as const) : ('post' as const),
      stillPresent,
      // What the content says now, which may not be what was reported.
      currentText: comment ? comment.text : post ? postText(post.body) : '',
      postType: post?.type ?? '',
    };
  });
}

export interface ReviewReportInput {
  status: string;
  note?: string;
}

/** HR closing a report: actioned (they dealt with it) or dismissed. */
export async function reviewContentReport(
  adminUserId: string,
  reportId: string,
  input: ReviewReportInput,
) {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new ConnectError(404, 'User not found');
  const report = await contentReports().findOne({ id: reportId, org: orgForUser(admin) });
  if (!report) throw new ConnectError(404, 'Report not found');

  const status = parseStatus(input.status);
  await contentReports().updateOne(
    { id: reportId },
    {
      $set: {
        status,
        reviewedAt: new Date(),
        reviewedByUserId: adminUserId,
        reviewedByName: admin.name,
        reviewNote: (input.note ?? '').trim().slice(0, 1000),
      },
    },
  );
  return { id: reportId, status };
}

/**
 * Removing reported content closes every other open report about it too — one
 * post can be reported by several people, and HR should not have to work
 * through the same complaint five times.
 */
export async function closeReportsForRemovedPost(postId: string, adminUserId: string) {
  const admin = await users().findOne({ userId: adminUserId });
  await contentReports().updateMany(
    { postId, status: 'open' },
    {
      $set: {
        status: 'actioned' as ContentReportStatus,
        reviewedAt: new Date(),
        reviewedByUserId: adminUserId,
        reviewedByName: admin?.name ?? 'HR',
        reviewNote: 'Content removed',
      },
    },
  );
}

/**
 * Everyone with dashboard access in the reporter's organisation. In-app and
 * push only, deliberately: a report can quote what was said, and that does not
 * belong in an inbox outside the system.
 */
async function notifyReviewers(report: ContentReport) {
  const reviewers = await users()
    .find({ org: report.org, dashboardAccess: true })
    .project<{ userId: string }>({ userId: 1 })
    .toArray();
  const target = report.commentId ? 'comment' : 'post';
  await notifyUsers(
    reviewers.map((reviewer) => reviewer.userId).filter((id) => id !== report.reporterUserId),
    {
      scenario: 'connect_content_reported',
      title: `A ${target} was reported`,
      body: `${report.reporterName} reported ${report.authorName}'s ${target} — ${reportReasonLabel(
        report.reason,
      )}. Review it in Connect reports.`,
      data: { reportId: report.id, postId: report.postId, reason: report.reason },
    },
  );
}

function parseReason(value: string): ContentReportReason {
  const reason = String(value ?? '').trim() as ContentReportReason;
  if (!CONTENT_REPORT_REASONS.includes(reason)) {
    throw new ConnectError(400, 'Pick a reason for the report');
  }
  return reason;
}

function parseStatus(value: string): ContentReportStatus {
  const status = String(value ?? '').trim();
  if (status !== 'open' && status !== 'actioned' && status !== 'dismissed') {
    throw new ConnectError(400, 'Unknown report status');
  }
  return status;
}

/**
 * The words in a post, whichever fields its type keeps them in — an
 * announcement has a headline and a body, a poll or an event only a title.
 * Empty for a post that is nothing but an image, which the dashboard says so.
 */
function postText(body: Record<string, unknown>): string {
  return ['title', 'text', 'subtitle']
    .map((key) => body[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .join(' — ');
}

function excerptOf(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 400 ? `${clean.slice(0, 400)}…` : clean;
}
