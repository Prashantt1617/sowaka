/**
 * The passes of a timer still running, so shutdown can wait for them before it
 * closes the database. Clearing an interval stops the next pass, not the one
 * already part-way through its reads: closing the database under it was the
 * "Poker tick failed: MongoClientClosedError" logged at every restart.
 */
export class InFlight {
  private readonly running = new Set<Promise<unknown>>();

  /** Keeps `pass` until it settles, and hands it back. */
  track<T>(pass: Promise<T>): Promise<T> {
    this.running.add(pass);
    const done = () => { this.running.delete(pass); };
    pass.then(done, done);
    return pass;
  }

  get size(): number {
    return this.running.size;
  }

  /** Resolves once every pass tracked so far has settled, or after `ms`; true if they all did. */
  async settle(ms = 30_000): Promise<boolean> {
    if (this.running.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); timer.unref(); });
    const all = Promise.allSettled([...this.running]).then(() => true as const);
    const how = await Promise.race([all, timedOut]);
    clearTimeout(timer);
    return how;
  }
}
