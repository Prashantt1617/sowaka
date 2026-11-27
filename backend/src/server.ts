import { app } from './app';
import { env } from './config/env';
import { closeDb, connectDb } from './config/db';
import { drainHttpServer } from './utils/drain';
import { logger } from './utils/logger';
import { appColor, buildId, instanceId } from './utils/instance';
import { closeConnectRealtime, initConnectRealtime } from './services/connect-realtime.service';
import { closeRelayRealtime, initRelayRealtime } from './services/relay-realtime.service';
import { closeScribbleRealtime, initScribbleRealtime } from './services/scribble-realtime.service';
import { closeTileUpRealtime, initTileUpRealtime } from './services/tileup-realtime.service';
import { closePokerRealtime, initPokerRealtime } from './services/poker-realtime.service';
import { closePoolRealtime, initPoolRealtime } from './services/pool-realtime.service';
import { closeSquadRealtime, initSquadRealtime } from './services/secret-squad-realtime.service';
import { closeRedis, redisClient } from './config/redis';
import { stopEngagementWarmup, warmEngagementNow } from './services/engagement-warmup.service';
import { enableLifecycleReadCache } from './services/lifecycle/readCache';
import { enableBackgroundPace } from './services/background-pace';
import { startBackgroundJobs, stopBackgroundJobs } from './services/background-jobs';
import { startCacheBus, stopCacheBus } from './services/cache-bus';
import { flushCupWords } from './services/cup.service';
import { markDraining, markWarmDone, markWarmStarted } from './services/readiness';

/**
 * How long shutdown lets requests in progress finish (utils/drain.ts). pm2's kill_timeout must be
 * longer than this plus the background jobs' stop (leader-jobs.ts, JOBS_STOP_WAIT_MS). Blue/green
 * sets it longer (docs/deploy/bluegreen.md): the old process is out of nginx by then, so nobody waits.
 */
const DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS ?? 10_000);

/**
 * This process's own kept answers, before it says it is ready (readiness.ts): Suwi's inputs and
 * notices, then one Engagement / Time office / lifecycle round, companies back to back. A process
 * taking over from another (blue/green) is warm when nginx is pointed at it; a lone restart serves
 * meanwhile, as before.
 */
async function bootWarm(): Promise<void> {
  markWarmStarted();
  const t0 = Date.now();
  try {
    const { warmSuwiAtBoot } = await import('./services/lifecycle/warm');
    await warmSuwiAtBoot();
    await warmEngagementNow();
  } catch (error) {
    logger.error('Boot warm-up failed', {}, error);
  } finally {
    markWarmDone();
    logger.info('Boot warm-up done: ready for traffic', { ms: Date.now() - t0 });
  }
}

async function start(): Promise<void> {
  await connectDb();
  // Lifecycle boards and Suwi notices from memory, dropped on every write (lifecycle/readCache.ts).
  enableLifecycleReadCache();
  // The background warm-up waits for a quiet moment before each step (background-pace.ts).
  enableBackgroundPace();
  logger.info('Connected to MongoDB', { database: env.mongoDbName });
  // Redis now, so readiness can see it; then the drops of kept answers shared with any other copy (cache-bus.ts).
  redisClient();
  await startCacheBus();
  // The schedulers, the Cup runner, the challenge sweeper and the Engagement warm-up run in one
  // process only: the one holding the background-jobs lease (leader.ts, background-jobs.ts).
  startBackgroundJobs();

logger.info('CORS Origins:', {cors: env.corsOrigins, path: 'https://dikcsyvq9i7v1.cloudfront.net'})

  const server = app.listen(env.port, () => {
    logger.info('API listening', {
      port: env.port,
      environment: env.nodeEnv,
      corsOrigins: env.corsOrigins,
      smtpConfigured: Boolean(env.zohoSmtp.user && env.zohoSmtp.pass),
      instance: instanceId,
      color: appColor,
      build: buildId(),
    });
  });

  // nginx keeps its upstream connections open for reuse, longer than Node's
  // 5 s default. Node closing an idle one just as nginx sends a request down
  // it is the occasional "connection reset" the app saw. Node now outlasts
  // nginx, and the header timeout must stay above the keep-alive one.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // The game rides the same socket server, as its own namespace: one upgrade
  // path through the proxy, one way of authenticating a handshake.
  const io = initConnectRealtime(server);
  initRelayRealtime(io);
  // Scribble's rooms: the same server and path, a third namespace.
  initScribbleRealtime(io);
  initTileUpRealtime(io);
  initPokerRealtime(io);
  // Sowaka Pool's two-player rooms: its own `/pool` namespace, built like Tile Up's.
  initPoolRealtime(io);
  // Secret Squad's office sessions: a fourth namespace on the same server.
  initSquadRealtime(io);

  // A moment after start so Redis is connected and boot isn't slowed; `/health/ready` says when it is done.
  setTimeout(() => { void bootWarm(); }, 1_000).unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown requested', { signal, drainMs: DRAIN_MS });
    markDraining();
    // Stop taking new requests and let the ones in progress finish before the
    // database closes (closing it first turned them into 500s). pm2 needs a
    // kill_timeout longer than this window.
    const drained = drainHttpServer(server, DRAIN_MS, () => logger.warn(`Shutdown: requests still open after ${DRAIN_MS} ms, closing them`));
    // The background jobs stop now, alongside the drain: their last runs finish, then the lease
    // goes, so a process beside this one (blue/green) takes them over at once.
    const jobs = stopBackgroundJobs();
    // The game clocks stop; each close waits for its pass under way, which reads the database.
    const clocks = Promise.all([
      closeScribbleRealtime(),
      closeTileUpRealtime(),
      closePokerRealtime(),
      closePoolRealtime(),
      closeSquadRealtime(),
      closeRelayRealtime(),
    ]);
    // The sockets close: each phone reconnects, through nginx, to whichever process it points at.
    closeConnectRealtime();
    await drained;
    // Word Trip words taken by this process and not yet written (any process serves them, runner or not).
    await flushCupWords().catch((error) => logger.error('Shutdown: cup words not flushed', {}, error));
    await clocks;
    await jobs;
    // The boot warm-up, if this process never ran the jobs and is still warming.
    await stopEngagementWarmup();
    await stopCacheBus();
    await closeRedis();
    await closeDb();
    logger.info('Shutdown complete', { signal });
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error) => {
  logger.error('Failed to start server', { environment: env.nodeEnv }, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {}, reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {}, error);
  process.exit(1);
});
