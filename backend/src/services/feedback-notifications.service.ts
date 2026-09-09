/**
 * The four performance-feedback messages.
 *
 *   1. Submitted   -> the manager who gave it        (email + push)
 *   2. Received    -> the employee it is about        (email + push)
 *   3. Pending     -> manager + their manager, cc HR  (email only)
 *   4. Missed      -> manager + their manager, cc HR  (email only)
 *
 * 1 and 2 fire on submit. 3 and 4 are cycle-boundary messages the scheduler
 * runs once a day: 3 while the cycle is still open, 4 once it has closed.
 *
 * Every count here is derived at send time from the reporting line and the
 * feedback records — never stored — so a manager who gains or loses a report
 * mid-cycle gets a number that matches what they see in the app.
 */
import { feedbackRecords, users } from '../config/db';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { notifyUsers } from './notification.service';
import { sendNotificationEmail } from './email.service';
import { cycleStartDayFor, cycleWindow, currentPeriodFor, periodFor, previousPeriod } from './cycle';

/** "10 September 2026" — the form used throughout this copy. */
export function longDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(date);
}

/** "August 2026" from a `YYYY-MM` cycle key. */
export function cycleName(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))} ${y}`;
}

/** Whole days from now until the cycle closes, floored at zero. */
export function daysUntil(end: Date, now = new Date()): number {
  const ms = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const SIGNIFICANCE =
  'These feedbacks are an important part of evaluating and tracking your team’s '
  + 'performance over the year.\n\n'
  + 'Timely and thoughtful feedback is one of the qualities of a strong manager and plays an '
  + 'important role in both your team’s growth and your own development as a leader.';

const cta = (label: string) => `${label}:\n${env.appWebUrl}`;

// ------------------------------------------------------------------- copy
// Composed by pure functions so the wording can be rendered and checked
// without a mail server, and so the senders hold only the data-gathering.

export type Mail = { subject: string; body: string };

export function submittedEmail(a: {
  employeeName: string; cycle: string; submitted: string; closes: string;
  done: number; total: number; pending: string[];
}): Mail {
  const complete = a.pending.length === 0;
  const progress = complete
    ? `Your progress: ${a.done}/${a.total} feedbacks completed ✓\n`
      + 'All your performance feedback for this cycle is complete.'
    : `Your progress: ${a.done}/${a.total} feedbacks completed\n`
      + `Pending: ${a.pending.join(', ')}`;
  return {
    subject: `Performance Feedback Submitted for ${a.employeeName} — ${a.cycle}`,
    body: `Hi {firstName},\n\n`
      + `Your performance feedback for ${a.employeeName} for the ${a.cycle} cycle was submitted on ${a.submitted}.\n\n`
      + `You can review or edit this feedback until ${a.closes}, when the feedback cycle closes.\n\n`
      + `${SIGNIFICANCE}\n\n${progress}\n\n`
      + cta(complete ? 'View Feedback on App' : 'Give Feedback on App'),
  };
}

export function receivedEmail(a: {
  managerName: string; cycle: string; submitted: string; closes: string;
}): Mail {
  return {
    subject: `${a.managerName} Shared Performance Feedback With You for ${a.cycle}`,
    body: `Hi {firstName},\n\n`
      + `${a.managerName} has shared performance feedback with you for the ${a.cycle} cycle.\n\n`
      + `Submitted on: ${a.submitted}\n\n`
      + `Note: This feedback can be edited by ${a.managerName} until the feedback cycle closes on ${a.closes}.\n\n`
      + `You can view your performance feedback in the Sowaka app.\n\n`
      + cta('View Performance Feedback'),
  };
}

export function pendingEmail(a: {
  managerName: string; cycle: string; closes: string; daysLeft: number;
  pending: string[]; total: number;
}): Mail {
  const month = a.cycle.split(' ')[0];
  return {
    subject: `${a.daysLeft} Day${a.daysLeft === 1 ? '' : 's'} Left in ${month} Cycle — `
      + `Performance Evaluation Pending for ${a.pending.length}/${a.total} Members in ${a.managerName}’s Team`,
    body: `Hi {firstName},\n\n`
      + `The ${a.cycle} performance feedback cycle closes on ${a.closes}. Performance evaluation is `
      + `currently pending for ${a.pending.length} of ${a.total} members in your team.\n\n`
      + `Pending feedback for:\n${a.pending.join('\n')}\n\n`
      + `${SIGNIFICANCE}\n\n`
      + `You can also review or edit feedback already submitted until the cycle closes.\n\n`
      + cta('Complete / Edit Feedback'),
  };
}

export function missedEmail(a: {
  managerName: string; cycle: string; closed: string; pending: string[]; total: number;
}): Mail {
  const month = a.cycle.split(' ')[0];
  return {
    subject: `Performance Evaluation Missed for ${a.pending.length}/${a.total} Members in `
      + `${a.managerName}’s Team — ${month} Cycle Closed`,
    body: `Hi {firstName},\n\n`
      + `The ${a.cycle} performance feedback cycle closed on ${a.closed}, and performance evaluation `
      + `was not completed for ${a.pending.length} of ${a.total} members in your team.\n\n`
      + `Feedback missed for:\n${a.pending.join('\n')}\n\n`
      + `${SIGNIFICANCE}\n\n`
      + `If you still need to submit feedback for these team members, please reach out to the `
      + `HR team to reopen access.\n\n`
      + `If the feedback is not submitted, ${month} will be marked as “Missed” in their performance `
      + `tracker for the year.\n\n`
      + cta('Contact HR'),
  };
}

/** A manager's reports and which of them have a sent review for the cycle. */
export async function feedbackProgress(manager: User, period: string) {
  const reports = await users()
    .find({ org: manager.org, managerUserId: manager.userId })
    .sort({ name: 1 })
    .toArray();
  if (reports.length === 0) return { reports, done: [] as User[], pending: [] as User[] };

  const sent = await feedbackRecords()
    .find({
      managerUserId: manager.userId,
      period,
      status: 'sent',
      employeeUserId: { $in: reports.map((r) => r.userId) },
    })
    .toArray();
  const sentIds = new Set(sent.map((r) => r.employeeUserId));
  return {
    reports,
    done: reports.filter((r) => sentIds.has(r.userId)),
    pending: reports.filter((r) => !sentIds.has(r.userId)),
  };
}

/** HR mailboxes for an org — copied on the manager-chasing messages. */
async function hrEmails(org: string): Promise<string[]> {
  const hr = await users().find({ org, dashboardAccess: true }).toArray();
  return hr.map((u) => u.email).filter(Boolean);
}

// ---------------------------------------------------------------- 1 and 2

/**
 * Fired when a review is sent. Tells the manager where they now stand, and the
 * employee that feedback is waiting for them.
 */
export async function notifyFeedbackSubmitted(
  managerUserId: string,
  employeeUserId: string,
  period: string,
  submittedAt = new Date(),
): Promise<void> {
  const [manager, employee] = await Promise.all([
    users().findOne({ userId: managerUserId }),
    users().findOne({ userId: employeeUserId }),
  ]);
  if (!manager || !employee) return;

  const org = manager.org ?? '';
  const startDay = await cycleStartDayFor(org);
  const closesOn = cycleWindow(period, startDay).end;
  const cycle = cycleName(period);
  const submitted = longDate(submittedAt);
  const closes = longDate(closesOn);

  const { reports, done, pending } = await feedbackProgress(manager, period);

  // 1 — to the giver.
  await notifyUsers([manager.userId], {
    scenario: 'feedback_submitted',
    title: 'Performance feedback submitted',
    body: `Your ${cycle.split(' ')[0]} feedback for ${employee.name} has been submitted`,
    data: { destination: 'grow_feedback', period, employeeUserId },
    email: submittedEmail({
      employeeName: employee.name, cycle, submitted, closes,
      done: done.length, total: reports.length, pending: pending.map((p) => p.name),
    }),
  });

  // 2 — to the receiver.
  await notifyUsers([employee.userId], {
    scenario: 'feedback_received',
    title: `${manager.name} shared performance feedback with you`,
    body: `View your ${cycle} feedback`,
    data: { destination: 'grow_feedback', period },
    email: receivedEmail({ managerName: manager.name, cycle, submitted, closes }),
  });
}

// ---------------------------------------------------------------- 3 and 4

/** Email only, and addressed to the manager but read by their manager and HR. */
async function chaseManager(
  manager: User,
  subject: string,
  body: string,
): Promise<void> {
  const org = manager.org ?? '';
  const theirManager = manager.managerUserId
    ? await users().findOne({ userId: manager.managerUserId })
    : null;
  const cc = [
    ...(theirManager?.email ? [theirManager.email] : []),
    ...(await hrEmails(org)),
  ];
  const first = manager.name?.trim().split(/\s+/).at(0) || 'there';
  await sendNotificationEmail(manager.email, subject, body.replaceAll('{firstName}', first), cc);
}

/**
 * Sent while the cycle is still open, for managers with anything outstanding.
 * The days remaining are computed from the cycle's own end date rather than
 * assumed, so moving the org's start day moves this with it.
 */
export async function sendPendingFeedbackReminders(
  org: string,
  now = new Date(),
  remindWithinDays = 3,
): Promise<number> {
  const startDay = await cycleStartDayFor(org);
  const period = periodFor(now, startDay);
  const { end } = cycleWindow(period, startDay);
  const left = daysUntil(end, now);
  if (left === 0 || left > remindWithinDays) return 0;

  const cycle = cycleName(period);
  const closes = longDate(end);
  const managers = await managersOf(org);
  let sent = 0;

  for (const manager of managers) {
    const { reports, pending } = await feedbackProgress(manager, period);
    if (pending.length === 0) continue;
    const mail = pendingEmail({
      managerName: manager.name, cycle, closes, daysLeft: left,
      pending: pending.map((p) => p.name), total: reports.length,
    });
    await chaseManager(manager, mail.subject, mail.body);
    sent += 1;
  }
  logger.info('Pending feedback reminders sent', { org, period, daysLeft: left, managers: sent });
  return sent;
}

/**
 * Sent once the cycle has closed, naming what was never submitted. Reads the
 * cycle that just ended, not the one now open.
 */
export async function sendMissedFeedbackNotices(org: string, now = new Date()): Promise<number> {
  const startDay = await cycleStartDayFor(org);
  const period = previousPeriod(periodFor(now, startDay));
  const { end } = cycleWindow(period, startDay);
  const cycle = cycleName(period);
  const closed = longDate(end);
  const managers = await managersOf(org);
  let sent = 0;

  for (const manager of managers) {
    const { reports, pending } = await feedbackProgress(manager, period);
    if (pending.length === 0) continue;
    const mail = missedEmail({
      managerName: manager.name, cycle, closed,
      pending: pending.map((p) => p.name), total: reports.length,
    });
    await chaseManager(manager, mail.subject, mail.body);
    sent += 1;
  }
  logger.info('Missed feedback notices sent', { org, period, managers: sent });
  return sent;
}

/** Everyone in the org with at least one direct report. */
async function managersOf(org: string): Promise<User[]> {
  const roster = await users().find({ org }).toArray();
  const withReports = new Set(roster.map((u) => u.managerUserId).filter(Boolean) as string[]);
  return roster.filter((u) => withReports.has(u.userId)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The cycle an org is currently inside — exported for the scheduler's logs. */
export const livePeriodFor = currentPeriodFor;
