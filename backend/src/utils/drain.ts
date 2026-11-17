import type { Server } from 'node:http';

/**
 * Stops the HTTP server taking new requests and resolves once the requests
 * already in progress have finished, or after `ms` (then the rest are cut).
 *
 * Shutdown waits on this before closing the database: closing it first turned
 * every request still running into a 500 (MongoClientClosedError). pm2 must
 * give the process longer than `ms` before it kills it (kill_timeout).
 */
export function drainHttpServer(server: Server, ms: number, onTimeout?: () => void): Promise<'drained' | 'timed_out'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (how: 'drained' | 'timed_out') => { if (done) return; done = true; clearTimeout(timer); clearInterval(sweep); resolve(how); };
    const timer = setTimeout(() => {
      onTimeout?.();
      server.closeAllConnections?.();
      finish('timed_out');
    }, ms);
    timer.unref();
    // A socket.io close may already have closed the server: then its 'close'
    // still fires once the last connection ends.
    server.once('close', () => finish('drained'));
    if (server.listening) server.close();
    // Keep-alive sockets with no request in flight would hold the close open:
    // close them now and again as each request still running finishes.
    server.closeIdleConnections?.();
    const sweep = setInterval(() => server.closeIdleConnections?.(), 100);
    sweep.unref();
    server.getConnections((err, open) => { if (!err && open === 0) finish('drained'); });
  });
}
