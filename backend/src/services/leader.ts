/**
 * Which process runs the background jobs: a lease in Mongo, held by one process at a time.
 *
 * Production runs one API process, except for the minute of a blue/green deploy
 * (docs/deploy/bluegreen.md), when the new build is up beside the old one. The
 * jobs that change data on the clock (the notification and lifecycle schedulers,
 * the Connect 07:00 posts, the Care digest, the Diwali Cup runner, the challenge
 * sweeper, the Engagement warm-up and Suwi's pre-asks) must not run in both:
 * leader-jobs.ts starts them when this process takes the lease and stops them
 * when it lets go.
 *
 * The lease is one document (`leases`, `_id: 'background-jobs'`): its holder and
 * the time it runs out. The holder renews it every few seconds; another process
 * may take it only once it has run out, or once the holder lets go at shutdown
 * (which sets it to have run out). A holder that cannot renew stops its jobs
 * well before its lease could be taken, so two never run at once.
 *
 * Mongo, not Redis: the server cannot run without Mongo, but it runs on without
 * Redis (the games fall back to memory), and the Redis here evicts keys with a
 * TTL under memory pressure (volatile-lru, 64 MB). Both processes are on one
 * machine, so one clock decides when a lease has run out.
 */
import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import { logger } from '../utils/logger';
import { instanceId, appColor } from '../utils/instance';

export interface LeaseDoc {
  _id: string;
  holder: string;
  until: Date;
  renewedAt: Date;
  acquiredAt: Date;
  releasedAt?: Date;
  pid: number;
  port: number | null;
  color: string | null;
}

export interface LeaderOptions {
  name?: string;
  /** Who holds it: this process's instance id unless a check makes several in one process. */
  holder?: string;
  /** How long a lease lasts without renewal. */
  ttlMs?: number;
  /** How often the holder renews. */
  renewMs?: number;
  /** How often a process without the lease asks for it. */
  pollMs?: number;
  /** The collection, for checks; else `leases` in the app's database. */
  collection?: () => Collection<LeaseDoc>;
  port?: number | null;
}

type Listener = () => void | Promise<void>;

export class Leader {
  readonly name: string;
  readonly holder: string;
  private readonly ttlMs: number;
  private readonly renewMs: number;
  private readonly pollMs: number;
  /** A holder whose renewals have failed this long stops its jobs: well inside the TTL, so it stops before anyone else may start. */
  private readonly stepDownAfterMs: number;
  private readonly collection: () => Collection<LeaseDoc>;
  private readonly port: number | null;
  private leading = false;
  private lastRenewed = 0;
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private stopped = false;
  /** One step (acquire, renew, step down) at a time. */
  private stepping: Promise<void> = Promise.resolve();
  /**
   * The jobs starting and stopping, one after another, apart from the steps: starting them can be
   * slow (indexes), and a renewal must never wait behind it or the lease would lapse under a holder
   * that still believes it leads.
   */
  private transitions: Promise<void> = Promise.resolve();
  private readonly onAcquire: Listener[] = [];
  private readonly onRelease: Listener[] = [];

  constructor(options: LeaderOptions = {}) {
    this.name = options.name ?? 'background-jobs';
    this.holder = options.holder ?? instanceId;
    this.ttlMs = options.ttlMs ?? Number(process.env.LEADER_TTL_MS ?? 30_000);
    this.renewMs = options.renewMs ?? Number(process.env.LEADER_RENEW_MS ?? 5_000);
    this.pollMs = options.pollMs ?? Number(process.env.LEADER_POLL_MS ?? 1_000);
    this.stepDownAfterMs = Math.max(this.renewMs, Math.floor(this.ttlMs * 0.6));
    this.collection = options.collection ?? (() => getDb().collection<LeaseDoc>('leases'));
    this.port = options.port ?? null;
  }

  /**
   * True while this process holds the lease and its jobs may run: only while its last renewal is
   * recent enough that nobody else can have taken it (a process stalled past that point, a long GC
   * or a frozen event loop, stops counting itself the leader before the lease can lapse).
   */
  isLeader(): boolean {
    return this.leading && Date.now() - this.lastRenewed < this.stepDownAfterMs;
  }

  /** Runs when this process takes the lease (the jobs start). */
  whenAcquired(listener: Listener): void {
    this.onAcquire.push(listener);
  }

  /** Runs when this process gives the lease up or loses it (the jobs stop; awaited before the lease is let go). */
  whenReleased(listener: Listener): void {
    this.onRelease.push(listener);
  }

  /** Starts asking for the lease, at once and then every `pollMs`; renews it once held. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.queue();
  }

  /**
   * At shutdown: stop asking, stop the jobs (waiting for the ones running), then let the
   * lease go so the next process takes it at once instead of waiting out the TTL.
   */
  async release(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.stepping;
    if (!this.leading) { await this.transitions; return; }
    await this.stepDown('shutdown');
    try {
      await this.collection().updateOne(
        { _id: this.name, holder: this.holder },
        { $set: { until: new Date(0), releasedAt: new Date() } },
      );
      logger.info('Background jobs lease released', { holder: this.holder });
    } catch (error) {
      logger.warn('Background jobs lease: could not release; it runs out on its own', { error: (error as Error).message, ttlMs: this.ttlMs });
    }
  }

  /** Who holds the lease now, as stored. */
  async current(): Promise<LeaseDoc | null> {
    return this.collection().findOne({ _id: this.name });
  }

  private queue(): void {
    this.stepping = this.stepping.then(() => this.step()).catch((error) => logger.error('Background jobs lease step failed', {}, error));
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.queue(), ms);
    this.timer.unref();
  }

  private async step(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    if (this.leading) {
      const outcome = await this.renew(now);
      if (outcome === 'renewed') this.lastRenewed = now;
      else if (outcome === 'lost') await this.stepDown('taken by another process');
      else if (now - this.lastRenewed >= this.stepDownAfterMs) await this.stepDown('renewals failing');
    } else if (await this.tryAcquire(now)) {
      this.leading = true;
      this.lastRenewed = now;
      logger.info('Background jobs lease taken: this process runs the jobs', { holder: this.holder, port: this.port, color: appColor });
      this.transitions = this.transitions.then(async () => {
        for (const listener of this.onAcquire) {
          try { await listener(); } catch (error) { logger.error('Background jobs failed to start', {}, error); }
        }
      });
    }
    this.schedule(this.leading ? this.renewMs : this.pollMs);
  }

  private async renew(now: number): Promise<'renewed' | 'lost' | 'error'> {
    try {
      const result = await this.collection().updateOne(
        { _id: this.name, holder: this.holder, until: { $gt: new Date(now) } },
        { $set: { until: new Date(now + this.ttlMs), renewedAt: new Date(now) } },
      );
      return result.matchedCount === 1 ? 'renewed' : 'lost';
    } catch (error) {
      logger.warn('Background jobs lease: renewal failed', { error: (error as Error).message });
      return 'error';
    }
  }

  private async tryAcquire(now: number): Promise<boolean> {
    try {
      const doc = await this.collection().findOneAndUpdate(
        { _id: this.name, until: { $lte: new Date(now) } },
        {
          $set: { holder: this.holder, until: new Date(now + this.ttlMs), renewedAt: new Date(now), acquiredAt: new Date(now), pid: process.pid, port: this.port, color: appColor },
          $unset: { releasedAt: '' },
        },
        { upsert: true, returnDocument: 'after' },
      );
      return doc?.holder === this.holder;
    } catch (error) {
      // Held by someone else: the upsert's insert collides with their document.
      if ((error as { code?: number }).code === 11000) return false;
      logger.warn('Background jobs lease: could not ask for it', { error: (error as Error).message });
      return false;
    }
  }

  private async stepDown(why: string): Promise<void> {
    if (!this.leading) return;
    logger.info('Background jobs stopping on this process', { why, holder: this.holder });
    // After any start still under way, so a stop never runs before the start it undoes.
    const stop = this.transitions.then(async () => {
      for (const listener of this.onRelease) {
        try { await listener(); } catch (error) { logger.error('Background jobs failed to stop cleanly', {}, error); }
      }
    });
    this.transitions = stop;
    // Still renewing while the last runs finish (up to JOBS_STOP_WAIT_MS, longer than the TTL), so the
    // lease cannot lapse to another process while a job here is part-way through. Fails harmlessly
    // when the lease is already lost.
    const keepAlive = setInterval(() => {
      void this.renew(Date.now()).then((outcome) => { if (outcome === 'renewed') this.lastRenewed = Date.now(); });
    }, this.renewMs);
    keepAlive.unref();
    try { await stop; } finally { clearInterval(keepAlive); }
    this.leading = false;
  }
}

/** The API server's lease (server.ts starts it). */
export const leader = new Leader({ port: Number(process.env.PORT ?? 4000) });

/** Shorthand for the jobs' own checks: true while this process runs the background jobs. */
export const isLeader = (): boolean => leader.isLeader();
