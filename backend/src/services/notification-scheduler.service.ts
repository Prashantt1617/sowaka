import { sendNewJoinerNotifications } from './notification.service';
import { sendLeaveNextWeek, sendPendingRequestReminders } from './request-notifications.service';
import { sendOpenTicketReminders } from './support.service';
import { runFeedbackCycleMessages } from './feedback-cycle-scheduler.service';
import { sendLatePunchInReminders } from './punch-reminder.service';
import { flushGroupedNotifications } from './notification-groups.service';
import { istParts } from './notification-time';
import { logger } from '../utils/logger';
import { closeDueExits } from './exit.service';
import { runPortalJobs } from './lifecycle/portal';
import { runOffboardingJobs } from './lifecycle/offboarding';
import { runLifecycleJobs } from './lifecycle/jobs';
import { forgetLifecycleReads } from './lifecycle/readCache';
import { runContestNotifications } from './contest-notifications.service';

/**
 * Runs one scheduled job in isolation: a thrown error is logged and does not
 * stop the other jobs in this tick. Each job decides for itself whether today
 * is its day (Tuesday/Thursday, a holiday moving it on, the cycle's dates) and
 * dedupes against the notification store, so a second run sends nothing.
 */
async function run(name: string, job: () => Promise<unknown>) {
  try { await job(); }
  catch (error) { logger.error(`Scheduled notification job failed: ${name}`, {}, error); }
}

const HOUR_MS = 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

/** Milliseconds to the next top of the hour in IST (half past, in UTC). */
export function msToNextIstHour(now: Date): number {
  return HOUR_MS - ((now.getTime() + IST_OFFSET_MS) % HOUR_MS);
}

/** The jobs for one IST hour. The spec's times are all IST. */
export async function runHourlyJobs(now = new Date()): Promise<void> {
  const { hour, weekday } = istParts(now);
  // Exits: access ends the day after the last working day. Every hour, so a missed one catches up.
  await run('closeDueExits', () => closeDueExits(now));
  // Pre-boarding portal: offer expiry, login/quiet/letter nudges, the Day-1 pass mail (idempotent).
  await run('runPortalJobs', () => runPortalJobs(now));
  // Offboarding: exit interview opens, settlement due, gratuity due (once each; access itself is closeDueExits').
  await run('runOffboardingJobs', () => runOffboardingJobs(now));
  // Those three change exits, journeys and tasks without a request: the kept boards go too.
  forgetLifecycleReads(null);
  if (hour === 10) {
    await run('sendNewJoinerNotifications', () => sendNewJoinerNotifications(now));
    // Cycle open, the Friday reminder and the last day, to managers only.
    await run('runFeedbackCycleMessages', () => runFeedbackCycleMessages(now));
  }
  if (hour === 14) {
    await run('sendPendingRequestReminders', () => sendPendingRequestReminders(now));
    await run('sendOpenTicketReminders', () => sendOpenTicketReminders(now));
  }
  if (hour === 16 && weekday === 'Fri') await run('sendLeaveNextWeek', () => sendLeaveNextWeek(now));
}

/**
 * The jobs for one five-minute slot. Shifts start at different times, so the punch-in reminder
 * checks every five minutes; grouped Connect pushes go out as their three-hour windows close.
 * Run on the clock by leader-jobs.ts (one process, once per slot; a slot still running when the
 * next is due is not doubled up).
 */
export async function runFiveMinuteJobs(): Promise<void> {
  await run('sendLatePunchInReminders', () => sendLatePunchInReminders());
  await run('flushGroupedNotifications', () => flushGroupedNotifications());
  // Contests: two hours before closing, to those not in yet; then the results (once each).
  await run('runContestNotifications', () => runContestNotifications());
  // Employee lifecycle: meeting reminders every tick, the day jobs once an hour (fired once each).
  await run('runLifecycleJobs', () => runLifecycleJobs());
}
