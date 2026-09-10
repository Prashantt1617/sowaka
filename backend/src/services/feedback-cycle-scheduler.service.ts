/**
 * The daily pass that sends the cycle-boundary feedback mail.
 *
 * Run once a day rather than on a timer per org: both messages are tied to a
 * date, not a moment, and each org's boundary depends on its own cycle start
 * day. The senders decide for themselves whether today is the day, so this only
 * has to iterate orgs.
 *
 * Both are idempotent within a day only in the sense that they re-derive from
 * the data — running twice in one day would send twice, which is why the hourly
 * scheduler calls this from a single hour.
 */
import { companies } from '../config/db';
import { logger } from '../utils/logger';
import {
  sendMissedFeedbackNotices,
  sendPendingFeedbackReminders,
} from './feedback-notifications.service';
import { cycleStartDayFor, cycleWindow, periodFor } from './cycle';

/** True on the first day of a cycle — the day the previous one closed. */
async function isCycleCloseDay(org: string, now: Date): Promise<boolean> {
  const startDay = await cycleStartDayFor(org);
  const { start } = cycleWindow(periodFor(now, startDay), startDay);
  return start.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

export async function runFeedbackCycleMessages(now = new Date()): Promise<void> {
  const orgs = await companies().find({}).project({ id: 1 }).toArray();
  for (const row of orgs as unknown as { id: string }[]) {
    try {
      // Chase while the cycle is still open…
      await sendPendingFeedbackReminders(row.id, now);
      // …and report what was missed on the day it closes.
      if (await isCycleCloseDay(row.id, now)) {
        await sendMissedFeedbackNotices(row.id, now);
      }
    } catch (error) {
      logger.error('Feedback cycle messages failed', { org: row.id }, error);
    }
  }
}
