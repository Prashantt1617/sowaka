import { generateDailyLifecyclePosts } from './connect.service';
import { runLeaveYearEnd } from './leave-year-end.service';
import { logger } from '../utils/logger';

/**
 * 07:00 IST every day: the day's Connect lifecycle posts (birthdays, anniversaries, joiners),
 * then any leave year that ends today. Run on the clock by leader-jobs.ts (one process, once a day).
 */
export async function runDailyConnectJobs(): Promise<void> {
  try {
    await generateDailyLifecyclePosts();
    logger.info('Generated daily Connect lifecycle posts');
  } catch (error) {
    logger.error('Failed to generate daily Connect lifecycle posts', {}, error);
  }
  try {
    // Closes any leave year that ends today. A no-op on every other day,
    // and idempotent, so a restart cannot double-process one.
    await runLeaveYearEnd();
  } catch (error) {
    logger.error('Leave year-end run failed', {}, error);
  }
}
