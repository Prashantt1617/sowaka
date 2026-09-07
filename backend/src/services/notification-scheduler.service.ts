import { flushNotificationBatches, sendPendingLeaveReminders, sendTodayLifecycleNotifications } from './notification.service';
import {
  sendConsecutiveMissedFlags,
  sendDailyAttendanceSummary,
  sendFeedbackDueReminders,
  sendFeedbackOverdueReminders,
  sendLeavePlanningReport,
  sendMissedFeedbackSummaries,
  sendWeeklyAttendanceReport,
} from './notification-digests.service';
import { logger } from '../utils/logger';

/**
 * Runs one scheduled job in isolation: a thrown error is logged and does not
 * stop the other jobs in this tick. These jobs are gated on an exact
 * date/day-of-week match with no tracked reminder state, so a job skipped by
 * an earlier throw would otherwise not run again until the same condition
 * recurs next week or month.
 */
async function run(name: string, job: () => Promise<void>) {
  try { await job(); }
  catch (error) { logger.error(`Scheduled notification job failed: ${name}`, {}, error); }
}

let timer: NodeJS.Timeout | undefined;
export function startNotificationScheduler() {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now); next.setMinutes(60, 0, 0);
    timer = setTimeout(async () => {
      try {
        // Everything below is scheduled against IST, the timezone the spec's
        // delivery times are written in.
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', hour12: false, weekday: 'short',
        }).formatToParts(new Date());
        const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
        const istHour = Number(part('hour'));
        const istDay = Number(part('day'));
        const weekday = part('weekday');
        // Last day of the month in IST: tomorrow's date rolls back to 1.
        const istDate = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
        const daysLeftInMonth = new Date(Date.UTC(
          istDate.getUTCFullYear(), istDate.getUTCMonth() + 1, 0,
        )).getUTCDate() - istDay;

        await run('flushNotificationBatches', () => flushNotificationBatches(istHour === 18));

        if (istHour === 9) {
          await run('sendTodayLifecycleNotifications', sendTodayLifecycleNotifications);
          await run('sendPendingLeaveReminders', sendPendingLeaveReminders);
          if (daysLeftInMonth === 2) await run('sendFeedbackDueReminders', sendFeedbackDueReminders);
          if (daysLeftInMonth === 0) await run('sendFeedbackOverdueReminders', sendFeedbackOverdueReminders);
          if (istDay === 1) {
            await run('sendMissedFeedbackSummaries', sendMissedFeedbackSummaries);
            await run('sendConsecutiveMissedFlags', sendConsecutiveMissedFlags);
          }
          if (weekday === 'Mon') await run('sendWeeklyAttendanceReport', sendWeeklyAttendanceReport);
        }
        if (istHour === 18) await run('sendDailyAttendanceSummary', sendDailyAttendanceSummary);
        if (istHour === 16 && weekday === 'Fri') await run('sendLeavePlanningReport', sendLeavePlanningReport);
      }
      catch (error) { logger.error('Notification scheduler tick failed', {}, error); }
      finally { schedule(); }
    }, next.getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}
export function stopNotificationScheduler() { if (timer) clearTimeout(timer); timer = undefined; }
