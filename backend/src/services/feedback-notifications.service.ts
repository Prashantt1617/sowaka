/**
 * The performance-feedback messages: two per cycle, both to managers.
 *
 *   1. Cycle open    -> every manager with reports, the day the cycle starts
 *   2. Closing soon  -> every manager with anything pending, 5 days before it ends
 *
 * Both say where the manager stands: how many reviews are done and how many
 * are pending. Nothing is sent per employee — not on submit, not to the
 * person being reviewed — so a manager with eight reports gets two messages a
 * cycle, not twenty.
 *
 * Every count is derived at send time from the reporting line and the
 * feedback records — never stored — so a manager who gains or loses a report
 * mid-cycle gets a number that matches what they see in the app.
 */
import { feedbackRecords, notifications, users } from '../config/db';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { notifyUsers } from './notification.service';
import { sendNotificationEmail } from './email.service';
import { cycleStartDayFor, cycleWindow, currentPeriodFor, periodFor } from './cycle';

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

/** "3 of 7 done · 4 pending" — the line both notices are built around. */
export function progressLine(done: number, total: number): string {
  const pending = total - done;
  return `${done} of ${total} done · ${pending} pending`;
}

export function cycleOpenEmail(a: {
  cycle: string; closes: string; done: number; total: number; pending: string[];
}): Mail {
  return {
    subject: `${a.cycle} Performance Feedback Cycle Is Open — ${progressLine(a.done, a.total)}`,
    body: `Hi {firstName},\n\n`
      + `The ${a.cycle} performance feedback cycle is open and closes on ${a.closes}.\n\n`
      + `Your team: ${progressLine(a.done, a.total)}\n`
      + (a.pending.length ? `Pending feedback for:\n${a.pending.join('\n')}\n\n` : '\n')
      + `${SIGNIFICANCE}\n\n`
      + cta('Give Feedback on App'),
  };
}

export function closingSoonEmail(a: {
  managerName: string; cycle: string; closes: string; daysLeft: number;
  done: number; total: number; pending: string[];
}): Mail {
  const month = a.cycle.split(' ')[0];
  return {
    subject: `${a.daysLeft} Day${a.daysLeft === 1 ? '' : 's'} Left in ${month} Cycle — `
      + `${progressLine(a.done, a.total)} in ${a.managerName}’s Team`,
    body: `Hi {firstName},\n\n`
      + `The ${a.cycle} performance feedback cycle closes on ${a.closes}.\n\n`
      + `Your team: ${progressLine(a.done, a.total)}\n`
      + `Pending feedback for:\n${a.pending.join('\n')}\n\n`
      + `${SIGNIFICANCE}\n\n`
      + `You can also review or edit feedback already submitted until the cycle closes.\n\n`
      + cta('Complete / Edit Feedback'),
  };
}

/** A manager's reports and which of them have a sent review for the cycle. */
export async function feedbackProgress(manager: User, period: string) {
  const reports = await users()
    .find({
      org: manager.org,
      managerUserId: manager.userId,
      lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    })
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

/** HR mailboxes for an org — copied on the closing-soon mail. */
async function hrEmails(org: string): Promise<string[]> {
  const hr = await users().find({ org, dashboardAccess: true }).toArray();
  return hr.map((u) => u.email).filter(Boolean);
}

/** Email addressed to the manager, read by their manager and HR too. */
async function mailManager(manager: User, mail: Mail, copyOthers: boolean): Promise<void> {
  const org = manager.org ?? '';
  const theirManager = copyOthers && manager.managerUserId
    ? await users().findOne({ userId: manager.managerUserId })
    : null;
  const cc = copyOthers
    ? [...(theirManager?.email ? [theirManager.email] : []), ...(await hrEmails(org))]
    : [];
  const first = manager.name?.trim().split(/\s+/).at(0) || 'there';
  await sendNotificationEmail(manager.email, mail.subject, mail.body.replaceAll('{firstName}', first), cc);
}

/** Once per manager per cycle: the daily run re-derives everything, so it checks what was sent. */
async function alreadySent(userId: string, scenario: string, period: string): Promise<boolean> {
  return Boolean(await notifications().findOne({ userId, scenario, 'data.period': period }));
}

// ---------------------------------------------------------------- 1 and 2

/**
 * The day a cycle opens: one message to every manager with reports, saying
 * how many reviews the cycle asks of them. Run daily; only the opening day
 * sends, and never twice for the same cycle.
 */
export async function sendCycleOpenNotices(org: string, now = new Date()): Promise<number> {
  const startDay = await cycleStartDayFor(org);
  const period = periodFor(now, startDay);
  const { start, end } = cycleWindow(period, startDay);
  if (start.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10)) return 0;

  const cycle = cycleName(period);
  const closes = longDate(end);
  let sent = 0;
  for (const manager of await managersOf(org)) {
    if (await alreadySent(manager.userId, 'feedback_cycle_open', period)) continue;
    const { reports, done, pending } = await feedbackProgress(manager, period);
    if (reports.length === 0) continue;
    await notifyUsers([manager.userId], {
      scenario: 'feedback_cycle_open',
      title: `${cycle.split(' ')[0]} feedback cycle is open`,
      body: `${progressLine(done.length, reports.length)} · closes ${closes}`,
      data: { destination: 'grow_feedback', period },
    });
    await mailManager(manager, cycleOpenEmail({
      cycle, closes, done: done.length, total: reports.length, pending: pending.map((p) => p.name),
    }), false);
    sent += 1;
  }
  logger.info('Feedback cycle open notices sent', { org, period, managers: sent });
  return sent;
}

/**
 * Five days before a cycle closes: one message to every manager with anything
 * still pending, with the done-versus-pending count. The days remaining are
 * computed from the cycle's own end date, so moving the org's start day
 * moves this with it. Never twice for the same cycle.
 */
export async function sendCycleClosingNotices(
  org: string,
  now = new Date(),
  daysBefore = 5,
): Promise<number> {
  const startDay = await cycleStartDayFor(org);
  const period = periodFor(now, startDay);
  const { end } = cycleWindow(period, startDay);
  const left = daysUntil(end, now);
  if (left !== daysBefore) return 0;

  const cycle = cycleName(period);
  const closes = longDate(end);
  let sent = 0;
  for (const manager of await managersOf(org)) {
    if (await alreadySent(manager.userId, 'feedback_cycle_closing', period)) continue;
    const { reports, done, pending } = await feedbackProgress(manager, period);
    if (pending.length === 0) continue;
    await notifyUsers([manager.userId], {
      scenario: 'feedback_cycle_closing',
      title: `${left} days left: ${cycle.split(' ')[0]} feedback`,
      body: `${progressLine(done.length, reports.length)} · closes ${closes}`,
      data: { destination: 'grow_feedback', period },
    });
    await mailManager(manager, closingSoonEmail({
      managerName: manager.name, cycle, closes, daysLeft: left,
      done: done.length, total: reports.length, pending: pending.map((p) => p.name),
    }), true);
    sent += 1;
  }
  logger.info('Feedback cycle closing notices sent', { org, period, daysLeft: left, managers: sent });
  return sent;
}

/** Everyone in the org with at least one active direct report. */
async function managersOf(org: string): Promise<User[]> {
  const roster = await users()
    .find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } })
    .toArray();
  const withReports = new Set(roster.map((u) => u.managerUserId).filter(Boolean) as string[]);
  return roster.filter((u) => withReports.has(u.userId)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The cycle an org is currently inside — exported for the scheduler's logs. */
export const livePeriodFor = currentPeriodFor;
