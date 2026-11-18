/**
 * The background jobs, run by whichever process holds the lease (leader.ts).
 *
 * Two kinds:
 *   - On the clock (`SlotJob`): the hourly notification and lifecycle jobs, the five-minute ones
 *     (punch-in reminders, grouped pushes, contests, lifecycle day jobs), the Connect 07:00 posts
 *     and leave year-end, and the Care digest at 21:00 IST. Time is cut into slots (an IST hour,
 *     five minutes, an IST day from 07:00) and each slot is claimed in `job_runs` before it runs,
 *     so a slot runs once however many processes and handovers there are.
 *   - Loops (`LoopJob`): the Diwali Cup runner, the game-challenge sweeper and the Engagement
 *     warm-up. Started when the lease is taken, stopped (waiting for the pass under way) when it
 *     is let go. Each pass of these already decides for itself what is due, so a pass missed in
 *     the second of a handover is made up by the next.
 *
 * A handover in the moment a slot starts must not skip it: the process taking the lease runs the
 * current slot at once when it is still unclaimed, is under `graceMs` old, and the slot before it
 * was claimed (proof the ledger was in use then: the first start after the old single-process
 * server, which claimed nothing, does not repeat a slot that server may already have run).
 */
import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import { logger } from '../utils/logger';
import { instanceId } from '../utils/instance';
import { InFlight } from '../utils/inflight';
import type { Leader } from './leader';

export interface SlotJob {
  name: string;
  /** How long a slot is. */
  periodMs: number;
  /** Slots start at `periodMs * n - offsetMs` (UTC ms): the IST offset, plus the hour for a daily job. */
  offsetMs: number;
  /** How late into its slot a handover may still run it. */
  graceMs: number;
  run: (slotStart: Date) => Promise<unknown>;
}

export interface LoopJob {
  name: string;
  start: () => void;
  stop: () => Promise<void> | void;
}

export interface JobRun {
  _id: string;
  job: string;
  slot: number;
  slotStart: Date;
  by: string;
  claimedAt: Date;
  doneAt?: Date;
  ms?: number;
  failed?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const IST_OFFSET_MS = 5.5 * HOUR_MS;

export const slotOf = (job: Pick<SlotJob, 'periodMs' | 'offsetMs'>, at: number): number => Math.floor((at + job.offsetMs) / job.periodMs);
export const slotStartOf = (job: Pick<SlotJob, 'periodMs' | 'offsetMs'>, slot: number): number => slot * job.periodMs - job.offsetMs;

/** An IST-clock job: every `periodMs`, starting at `atIstMs` past IST midnight (for a daily one). */
export function istSlots(periodMs: number, atIstMs = 0): Pick<SlotJob, 'periodMs' | 'offsetMs'> {
  return { periodMs, offsetMs: IST_OFFSET_MS - atIstMs };
}

export interface JobRunnerOptions {
  slotJobs: SlotJob[];
  loopJobs: LoopJob[];
  /** For checks; else `job_runs` in the app's database. */
  runs?: () => Collection<JobRun>;
  /** Who claims the slots: the lease's holder. */
  by?: string;
  /** How long a stop waits for the jobs under way before letting the lease go anyway. */
  stopWaitMs?: number;
}

export class JobRunner {
  private readonly slotJobs: SlotJob[];
  private readonly loopJobs: LoopJob[];
  private readonly runs: () => Collection<JobRun>;
  private readonly by: string;
  private readonly stopWaitMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly busy = new Set<string>();
  private readonly passes = new InFlight();
  private running = false;
  /** Whether this process still holds the lease, asked before every claim. */
  private stillLeading: () => boolean = () => true;
  private indexed: Promise<void> | null = null;

  constructor(options: JobRunnerOptions) {
    this.slotJobs = options.slotJobs;
    this.loopJobs = options.loopJobs;
    this.runs = options.runs ?? (() => getDb().collection<JobRun>('job_runs'));
    this.by = options.by ?? instanceId;
    this.stopWaitMs = options.stopWaitMs ?? Number(process.env.JOBS_STOP_WAIT_MS ?? 45_000);
  }

  /** Ties the jobs to the lease: they start when it is taken and stop before it is let go. */
  attach(leader: Leader): void {
    this.stillLeading = () => leader.isLeader();
    leader.whenAcquired(() => this.start());
    leader.whenReleased(() => this.stop());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.ensureIndexes();
    for (const job of this.loopJobs) {
      try { job.start(); } catch (error) { logger.error(`Background job failed to start: ${job.name}`, {}, error); }
    }
    const now = Date.now();
    for (const job of this.slotJobs) {
      // A slot that began just before this process took over, and nobody ran.
      const slot = slotOf(job, now);
      if (now - slotStartOf(job, slot) <= job.graceMs) {
        void this.passes.track(this.catchUp(job, slot));
      }
      this.arm(job);
    }
    logger.info('Background jobs running on this process', { slotJobs: this.slotJobs.map((j) => j.name), loopJobs: this.loopJobs.map((j) => j.name) });
  }

  /** Stops every timer and loop, then waits for the jobs under way (up to `stopWaitMs`). */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const loops = Promise.all(this.loopJobs.map(async (job) => {
      try { await job.stop(); } catch (error) { logger.error(`Background job failed to stop: ${job.name}`, {}, error); }
    }));
    const settled = await this.passes.settle(this.stopWaitMs);
    await loops;
    if (!settled) logger.warn('Background jobs: some were still running when the lease was let go', { waitedMs: this.stopWaitMs, busy: [...this.busy] });
  }

  private ensureIndexes(): Promise<void> {
    this.indexed ??= this.runs()
      .createIndex({ claimedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 })
      .then(() => undefined)
      .catch((error) => {
        logger.warn('job_runs index failed', { error: (error as Error).message });
        this.indexed = null;
      });
    return this.indexed;
  }

  private arm(job: SlotJob): void {
    if (!this.running) return;
    const now = Date.now();
    const next = slotStartOf(job, slotOf(job, now) + 1);
    const timer = setTimeout(() => {
      this.timers.delete(job.name);
      // The slot that has just begun (a timer can fire a moment early or late).
      const slot = slotOf(job, Date.now() + 50);
      void this.passes.track(this.fire(job, slot));
      this.arm(job);
    }, next - now + 20);
    timer.unref();
    this.timers.set(job.name, timer);
  }

  private async catchUp(job: SlotJob, slot: number): Promise<void> {
    try {
      const [mine, before] = await Promise.all([
        this.runs().findOne({ _id: `${job.name}:${slot}` }, { projection: { _id: 1 } }),
        this.runs().findOne({ _id: `${job.name}:${slot - 1}` }, { projection: { _id: 1 } }),
      ]);
      if (mine || !before) return;
      logger.info('Background job: running the slot a handover would have missed', { job: job.name, slotStart: new Date(slotStartOf(job, slot)).toISOString() });
      await this.fire(job, slot);
    } catch (error) {
      logger.error(`Background job catch-up failed: ${job.name}`, {}, error);
    }
  }

  /** Claims the slot and runs it, unless this job is still running its last slot or someone already claimed this one. */
  private async fire(job: SlotJob, slot: number): Promise<void> {
    if (!this.running || !this.stillLeading()) return;
    if (this.busy.has(job.name)) {
      logger.info('Background job skipped: the last slot is still running', { job: job.name });
      return;
    }
    this.busy.add(job.name);
    const id = `${job.name}:${slot}`;
    const slotStart = new Date(slotStartOf(job, slot));
    try {
      try {
        await this.runs().insertOne({ _id: id, job: job.name, slot, slotStart, by: this.by, claimedAt: new Date() });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) return; // another process ran it
        throw error;
      }
      const t0 = Date.now();
      let failed: string | undefined;
      try { await job.run(slotStart); } catch (error) {
        failed = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        logger.error(`Background job failed: ${job.name}`, {}, error);
      }
      await this.runs().updateOne({ _id: id }, { $set: { doneAt: new Date(), ms: Date.now() - t0, ...(failed ? { failed } : {}) } }).catch(() => undefined);
    } catch (error) {
      logger.error(`Background job could not be claimed: ${job.name}`, {}, error);
    } finally {
      this.busy.delete(job.name);
    }
  }
}

export const DAY = DAY_MS;
export const HOUR = HOUR_MS;
