import { app } from './app';
import { env } from './config/env';
import { closeDb, connectDb } from './config/db';
import { logger } from './utils/logger';
import { startConnectScheduler, stopConnectScheduler } from './services/connect-scheduler.service';
import { startNotificationScheduler, stopNotificationScheduler } from './services/notification-scheduler.service';
import { closeConnectRealtime, initConnectRealtime } from './services/connect-realtime.service';
import { closeRelayRealtime, initRelayRealtime } from './services/relay-realtime.service';

async function start(): Promise<void> {
  await connectDb();
  logger.info('Connected to MongoDB', { database: env.mongoDbName });
  startConnectScheduler();
  startNotificationScheduler();


logger.info('CORS Origins:', {cors: env.corsOrigins, path: 'https://dikcsyvq9i7v1.cloudfront.net'})

  const server = app.listen(env.port, () => {
    logger.info('API listening', {
      port: env.port,
      environment: env.nodeEnv,
      corsOrigins: env.corsOrigins,
      smtpConfigured: Boolean(env.zohoSmtp.user && env.zohoSmtp.pass),
    });
  });

  // The game rides the same socket server, as its own namespace: one upgrade
  // path through the proxy, one way of authenticating a handshake.
  initRelayRealtime(initConnectRealtime(server));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutdown requested', { signal });
    closeRelayRealtime();
    closeConnectRealtime();
    server.close();
    stopConnectScheduler();
    stopNotificationScheduler();
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
