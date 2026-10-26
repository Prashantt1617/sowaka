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
    .find(
      {
        org: manager.org,
        managerUserId: manager.userId,
        lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
      },
      // Every caller names and counts them; an inline photo or a pile of
      // documents would cross the link for nothing (the inbox asks this).
      { projection: { profilePhotoUrl: 0, documents: 0 } },
    )
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

/** Email to the manager alone: nobody else is copied (Rules sheet, "Email copy"). */
async function mailManager(manager: User, mail: Mail, _copyOthers: boolean): Promise<void> {
  const first = manager.name?.trim().split(/\s+/).at(0) || 'there';
  await sendNotificationEmail(manager.email, mail.subject, mail.body.replaceAll('{firstName}', first));
}

/** Once per manager per cycle: the daily run re-derives everything, so it checks what was sent. */
async function alreadySent(userId: string, scenario: string, period: string): Promise<boolean> {
  return Boolean(await notifications().findOne({ userId, scenario, 'data.period': period }));
}

// -------------------------------------------------------------- the messages

/** The cycle's last day: the day before the next one starts (31 Oct, not 1 Nov). */
function lastDayOf(end: Date): Date {
  return new Date(end.getTime() - 86_400_000);
}

/** "31 Oct". */
const dayMonth = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);

/** "October" from a `YYYY-MM` cycle key. */
const monthOf = (period: string) => cycleName(period).split(' ')[0];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The cycle `now` falls in, its first day and its last day, as `YYYY-MM-DD`. */
async function cycleOf(org: string, now: Date) {
  const startDay = await cycleStartDayFor(org);
  const period = periodFor(now, startDay);
  const { start, end } = cycleWindow(period, startDay);
  return { period, start, last: lastDayOf(end), today: isoDay(now) };
}

/**
 * Row 24 — the cycle's first day, 10:00 IST: every manager with reports,
 * once per cycle. The email goes to the manager only.
 */
export async function sendCycleOpenNotices(org: string, now = new Date()): Promise<number> {
  const { period, start, last, today } = await cycleOf(org, now);
  if (isoDay(start) !== today) return 0;
  const month = monthOf(period);
  let sent = 0;
  for (const manager of await managersOf(org)) {
    if (await alreadySent(manager.userId, 'feedback_cycle_open', period)) continue;
    const { reports, done, pending } = await feedbackProgress(manager, period);
    if (reports.length === 0) continue;
    await notifyUsers([manager.userId], {
      scenario: 'feedback_cycle_open',
      title: `${month} feedback is open`,
      body: `Share feedback for your ${reports.length} team ${reports.length === 1 ? 'member' : 'members'} by ${dayMonth(last)}`,
      data: { destination: 'grow_feedback', period },
    });
    await mailManager(manager, cycleOpenEmail({
      cycle: cycleName(period), closes: longDate(last), done: done.length, total: reports.length, pending: pending.map((p) => p.name),
    }), false);
    sent += 1;
  }
  logger.info('Feedback cycle open notices sent', { org, period, managers: sent });
  return sent;
}

/**
 * Row 25 — every Friday at 10:00 IST while the cycle is open: managers with
 * anything pending. Not in the cycle's first week, and not on its first or
 * last day (those days have their own message).
 */
export async function sendWeeklyFeedbackReminders(org: string, now = new Date()): Promise<number> {
  const { period, start, last, today } = await cycleOf(org, now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  if (weekday !== 5) return 0;
  if (today === isoDay(start) || today === isoDay(last)) return 0;
  if ((new Date(`${today}T00:00:00.000Z`).getTime() - start.getTime()) / 86_400_000 < 7) return 0;
  const month = monthOf(period);
  let sent = 0;
  for (const manager of await managersOf(org)) {
    if (await notifications().findOne({ userId: manager.userId, scenario: 'feedback_weekly', 'data.dateKey': today })) continue;
    const { reports, done, pending } = await feedbackProgress(manager, period);
    if (pending.length === 0) continue;
    await notifyUsers([manager.userId], {
      scenario: 'feedback_weekly',
      title: `${month} feedback: ${pending.length} still to go`,
      body: `${done.length} of ${reports.length} done. Due ${dayMonth(last)}.`,
      data: { destination: 'grow_feedback', period, dateKey: today },
    });
    sent += 1;
  }
  return sent;
}

/** Row 26 — the cycle's last day, 10:00 IST: managers with anything pending. */
export async function sendLastDayFeedbackNotices(org: string, now = new Date()): Promise<number> {
  const { period, last, today } = await cycleOf(org, now);
  if (isoDay(last) !== today) return 0;
  const month = monthOf(period);
  let sent = 0;
  for (const manager of await managersOf(org)) {
    if (await alreadySent(manager.userId, 'feedback_last_day', period)) continue;
    const { pending } = await feedbackProgress(manager, period);
    if (pending.length === 0) continue;
    await notifyUsers([manager.userId], {
      scenario: 'feedback_last_day',
      title: `Last day for ${month} feedback`,
      body: `${pending.length} team ${pending.length === 1 ? 'member still needs' : 'members still need'} feedback`,
      data: { destination: 'grow_feedback', period },
    });
    sent += 1;
  }
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
