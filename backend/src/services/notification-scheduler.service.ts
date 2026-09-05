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

        await flushNotificationBatches(istHour === 18);

        if (istHour === 9) {
          await sendTodayLifecycleNotifications();
          await sendPendingLeaveReminders();
          if (daysLeftInMonth === 2) await sendFeedbackDueReminders();
          if (daysLeftInMonth === 0) await sendFeedbackOverdueReminders();
          if (istDay === 1) {
            await sendMissedFeedbackSummaries();
            await sendConsecutiveMissedFlags();
          }
          if (weekday === 'Mon') await sendWeeklyAttendanceReport();
        }
        if (istHour === 18) await sendDailyAttendanceSummary();
        if (istHour === 16 && weekday === 'Fri') await sendLeavePlanningReport();
      }
      catch (error) { logger.error('Notification batch flush failed', {}, error); }
      finally { schedule(); }
    }, next.getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}
export function stopNotificationScheduler() { if (timer) clearTimeout(timer); timer = undefined; }
