/**
 * The API server's background jobs and the lease that decides where they run (leader.ts,
 * leader-jobs.ts). server.ts calls `startBackgroundJobs` once connected and
 * `stopBackgroundJobs` at shutdown.
 *
 * What is NOT here, because it must run in every process: the game clocks (each realtime service's
 * tick; every room, table and session is leased per pass in Redis, and each process moves the
 * players whose sockets it holds), the boot warm-up of this process's own kept answers (server.ts),
 * and the rebuild a few seconds after a write (lifecycle/readCache.ts).
 */
import { getDb } from '../config/db';
import { logger } from '../utils/logger';
import { DAY, HOUR, JobRunner, istSlots, type SlotJob } from './leader-jobs';
import { leader } from './leader';
import { runFiveMinuteJobs, runHourlyJobs } from './notification-scheduler.service';
import { runDailyConnectJobs } from './connect-scheduler.service';
import { DIGEST_HOUR_IST, runJournalDigest } from './care.service';
import { startCupRunner, stopCupRunner } from './cup.service';
import { startGameChallengeSweeper, stopGameChallengeSweeper } from './game-challenge.service';
import { startEngagementWarmup, stopEngagementWarmup } from './engagement-warmup.service';
import { instanceId } from '../utils/instance';

const MINUTE = 60_000;

const slotJobs: SlotJob[] = [
  // Exits, the portal, offboarding every hour; the 10:00, 14:00 and Friday 16:00 messages (IST).
  { name: 'notifications-hourly', ...istSlots(HOUR), graceMs: 15 * MINUTE, run: (at) => runHourlyJobs(at) },
  // Punch-in reminders, grouped pushes, contests, lifecycle meeting reminders and day jobs.
  { name: 'notifications-5min', ...istSlots(5 * MINUTE), graceMs: 5 * MINUTE, run: () => runFiveMinuteJobs() },
  // The day's Connect lifecycle posts and leave year-end, 07:00 IST.
  { name: 'connect-daily', ...istSlots(DAY, 7 * HOUR), graceMs: 30 * MINUTE, run: () => runDailyConnectJobs() },
  // Care: the journal digest mailed and cleared, at the digest hour IST.
  { name: 'care-digest', ...istSlots(DAY, DIGEST_HOUR_IST * HOUR), graceMs: 30 * MINUTE, run: (at) => runJournalDigest(at) },
];

/**
 * For the blue/green check (scripts/bluegreen-check.ts): `LEADER_PROBE_MS` adds a job that only
 * records which process ran which slot, so a check can prove no slot ran twice or was skipped
 * across a handover. Never set in production.
 */
const probeMs = Number(process.env.LEADER_PROBE_MS ?? 0);
if (probeMs > 0) {
  slotJobs.push({
    name: 'bluegreen-probe',
    periodMs: probeMs,
    offsetMs: 0,
    graceMs: probeMs,
    run: async (at) => {
      await getDb().collection('bluegreen_probe').insertOne({ slotStart: at, by: instanceId, port: Number(process.env.PORT ?? 0), ranAt: new Date() });
    },
  });
}

export const backgroundJobs = new JobRunner({
  slotJobs,
  loopJobs: [
    // Moves switched-on Diwali Cup events along (only CUP_RUNNER_ORGS' outside production).
    { name: 'cup-runner', start: () => startCupRunner(), stop: () => stopCupRunner() },
    // Expires game challenges nobody finished in time, and tells both players.
    { name: 'challenge-sweeper', start: () => startGameChallengeSweeper(), stop: () => stopGameChallengeSweeper() },
    // Works out each company's Engagement pages ahead of HR, every four minutes (with Suwi's pre-asks).
    { name: 'engagement-warmup', start: () => startEngagementWarmup(), stop: () => stopEngagementWarmup() },
  ],
});
backgroundJobs.attach(leader);

export function startBackgroundJobs(): void {
  leader.start();
}

/** Stops this process's jobs (waiting for the ones under way) and lets the lease go. */
export async function stopBackgroundJobs(): Promise<void> {
  await leader.release();
  logger.info('Background jobs stopped', {});
}
