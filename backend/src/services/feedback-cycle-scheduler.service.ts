/**
 * The daily pass that sends the two feedback-cycle messages.
 *
 * Run once a day rather than on a timer per org: both messages are tied to a
 * date, not a moment, and each org's boundary depends on its own cycle start
 * day. The senders decide for themselves whether today is the day, and each
 * checks the notification store so a second run in the same day sends nothing.
 */
import { users } from '../config/db';
import { logger } from '../utils/logger';
import { sendCycleClosingNotices, sendCycleOpenNotices } from './feedback-notifications.service';

export async function runFeedbackCycleMessages(now = new Date()): Promise<void> {
  // Every org that has people, not only those with a company document — a
  // company row is written lazily, and an org without one still has managers.
  const orgs = (await users().distinct('org')).filter(
    (org): org is string => typeof org === 'string' && org.length > 0,
  );
  for (const org of orgs) {
    try {
      await sendCycleOpenNotices(org, now);
      await sendCycleClosingNotices(org, now);
    } catch (error) {
      logger.error('Feedback cycle messages failed', { org }, error);
    }
  }
}
