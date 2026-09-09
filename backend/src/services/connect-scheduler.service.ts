import { generateDailyLifecyclePosts } from './connect.service';
import { runLeaveYearEnd } from './leave-year-end.service';
import { logger } from '../utils/logger';

let timer: NodeJS.Timeout | undefined;

function millisecondsUntilNextSevenAmIst(now = new Date()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const next = Date.UTC(
    istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 7, 0, 0, 0,
  );
  const nextIstClock = next <= istNow.getTime() ? next + 24 * 60 * 60 * 1000 : next;
  return nextIstClock - istNow.getTime();
}

export function startConnectScheduler() {
  const schedule = () => {
    timer = setTimeout(async () => {
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
      schedule();
    }, millisecondsUntilNextSevenAmIst());
    timer.unref();
  };
  schedule();
  logger.info('Connect lifecycle scheduler started', { time: '07:00', timeZone: 'Asia/Kolkata' });
}

export function stopConnectScheduler() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
