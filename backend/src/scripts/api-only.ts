/**
 * The HTTP API alone: no schedulers, no sockets, no background jobs. For
 * trying a branch against the shared database without a second copy of the
 * notification / Connect / Care schedulers running.
 *
 *   PORT=4097 npm run api:only
 */
import type { Server } from 'node:http';
import { app } from '../app';
import { closeDb, connectDb } from '../config/db';

const port = Number(process.env.PORT ?? 4097);
if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a port number');
if (port === 4000 || port === 5173) throw new Error(`Port ${port} is someone's dev server: pick another`);

let server: Server | null = null;
connectDb()
  .then(() => {
    server = app.listen(port, () => console.log(`API only (no schedulers) on http://localhost:${port}`));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

const stop = async () => {
  server?.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
