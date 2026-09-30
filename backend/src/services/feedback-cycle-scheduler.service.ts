/**
 * The daily pass that sends the two feedback-cycle messages.
 *
 * Run once a day rather than on a timer per org: both messages are tied to a
 * date, not a moment, and each org's boundary depends on its own cycle start
 * day. The senders decide for themselves whether today is the day, and each
 * checks the notification store so a second run in the same day sends nothing.
 */
import { companies } from '../config/db';
import { logger } from '../utils/logger';
import { sendCycleClosingNotices, sendCycleOpenNotices } from './feedback-notifications.service';

export async function runFeedbackCycleMessages(now = new Date()): Promise<void> {
  const orgs = await companies().find({}).project({ id: 1 }).toArray();
  for (const row of orgs as unknown as { id: string }[]) {
    try {
      await sendCycleOpenNotices(row.id, now);
      await sendCycleClosingNotices(row.id, now);
    } catch (error) {
      logger.error('Feedback cycle messages failed', { org: row.id }, error);
    }
  }
}
