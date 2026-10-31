import { app } from './app';
import { env } from './config/env';
import { closeDb, connectDb } from './config/db';
import { logger } from './utils/logger';
import { startConnectScheduler, stopConnectScheduler } from './services/connect-scheduler.service';
import { startNotificationScheduler, stopNotificationScheduler } from './services/notification-scheduler.service';
import { closeConnectRealtime, initConnectRealtime } from './services/connect-realtime.service';
import { closeRelayRealtime, initRelayRealtime } from './services/relay-realtime.service';
import { closeScribbleRealtime, initScribbleRealtime } from './services/scribble-realtime.service';
import { closeTileUpRealtime, initTileUpRealtime } from './services/tileup-realtime.service';
import { closePokerRealtime, initPokerRealtime } from './services/poker-realtime.service';
import { closeSquadRealtime, initSquadRealtime } from './services/secret-squad-realtime.service';
import { closeRedis } from './config/redis';
import { startCareScheduler, stopCareScheduler } from './services/care.service';
import { startGameChallengeSweeper, stopGameChallengeSweeper } from './services/game-challenge.service';
import { startCupRunner, stopCupRunner } from './services/cup.service';
import { startSuwiDigestScheduler, stopSuwiDigestScheduler } from './suwi/digest';

async function start(): Promise<void> {
  await connectDb();
  logger.info('Connected to MongoDB', { database: env.mongoDbName });
  startConnectScheduler();
  startNotificationScheduler();
  startCareScheduler();
  // Suwi's morning digest (07:00 IST); not in api-only mode, which never calls start().
  startSuwiDigestScheduler();
  // Expires game challenges nobody finished in time, and tells both players.
  startGameChallengeSweeper();
  // Moves switched-on Diwali Cup events along (only CUP_RUNNER_ORGS' outside production).
  startCupRunner();


logger.info('CORS Origins:', {cors: env.corsOrigins, path: 'https://dikcsyvq9i7v1.cloudfront.net'})

  const server = app.listen(env.port, () => {
    logger.info('API listening', {
      port: env.port,
      environment: env.nodeEnv,
      corsOrigins: env.corsOrigins,
      smtpConfigured: Boolean(env.zohoSmtp.user && env.zohoSmtp.pass),
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
  // Secret Squad's office sessions: a fourth namespace on the same server.
  initSquadRealtime(io);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutdown requested', { signal });
    closeScribbleRealtime();
    closeTileUpRealtime();
    closePokerRealtime();
    closeSquadRealtime();
    closeRelayRealtime();
    closeConnectRealtime();
    server.close();
    stopConnectScheduler();
    stopNotificationScheduler();
    stopCareScheduler();
    stopSuwiDigestScheduler();
    stopGameChallengeSweeper();
    stopCupRunner();
    await closeRedis();
    await closeDb();
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
