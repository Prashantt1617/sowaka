import { sendNewJoinerNotifications } from './notification.service';
import { sendLeaveNextWeek, sendPendingRequestReminders } from './request-notifications.service';
import { sendOpenTicketReminders } from './support.service';
import { runFeedbackCycleMessages } from './feedback-cycle-scheduler.service';
import { sendLatePunchInReminders } from './punch-reminder.service';
import { flushGroupedNotifications } from './notification-groups.service';
import { istParts } from './notification-time';
import { logger } from '../utils/logger';

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

let timer: NodeJS.Timeout | undefined;
let fiveMinuteTimer: NodeJS.Timeout | undefined;
let fiveMinuteRunning = false;
export function startNotificationScheduler() {
  // Shifts start at different times, so the punch-in reminder checks every
  // five minutes; grouped Connect pushes go out as their three-hour windows
  // close. A tick still running when the next one is due is not doubled up.
  fiveMinuteTimer = setInterval(() => {
    if (fiveMinuteRunning) return;
    fiveMinuteRunning = true;
    void (async () => {
      await run('sendLatePunchInReminders', () => sendLatePunchInReminders());
      await run('flushGroupedNotifications', () => flushGroupedNotifications());
    })().finally(() => { fiveMinuteRunning = false; });
  }, 5 * 60 * 1000);
  fiveMinuteTimer.unref();

  const schedule = () => {
    timer = setTimeout(async () => {
      try { await runHourlyJobs(); }
      catch (error) { logger.error('Notification scheduler tick failed', {}, error); }
      finally { schedule(); }
    }, msToNextIstHour(new Date()));
    timer.unref();
  };
  schedule();
}
export function stopNotificationScheduler() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (fiveMinuteTimer) clearInterval(fiveMinuteTimer);
  fiveMinuteTimer = undefined;
}
