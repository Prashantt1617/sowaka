import { sendPendingLeaveReminders, sendTodayLifecycleNotifications } from './notification.service';
import { sendLeavePlanningReport, sendWeeklyAttendanceReport } from './notification-digests.service';
import { runFeedbackCycleMessages } from './feedback-cycle-scheduler.service';
import { sendLatePunchInReminders } from './punch-reminder.service';
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
let punchTimer: NodeJS.Timeout | undefined;
let punchRunning = false;
export function startNotificationScheduler() {
  // Shifts start at different times, so the punch-in reminder checks every
  // five minutes rather than on the hour. A tick still running when the next
  // one is due is not doubled up.
  punchTimer = setInterval(() => {
    if (punchRunning) return;
    punchRunning = true;
    void run('sendLatePunchInReminders', async () => { await sendLatePunchInReminders(); })
      .finally(() => { punchRunning = false; });
  }, 5 * 60 * 1000);
  punchTimer.unref();

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

        if (istHour === 9) {
          await run('sendTodayLifecycleNotifications', sendTodayLifecycleNotifications);
          await run('sendPendingLeaveReminders', sendPendingLeaveReminders);
          // Two messages a cycle, to managers only, on the org's own cycle dates.
          await run('runFeedbackCycleMessages', () => runFeedbackCycleMessages());
          if (weekday === 'Mon') await run('sendWeeklyAttendanceReport', sendWeeklyAttendanceReport);
        }
        if (istHour === 16 && weekday === 'Fri') await run('sendLeavePlanningReport', sendLeavePlanningReport);
      }
      catch (error) { logger.error('Notification scheduler tick failed', {}, error); }
      finally { schedule(); }
    }, next.getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}
export function stopNotificationScheduler() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (punchTimer) clearInterval(punchTimer);
  punchTimer = undefined;
}
