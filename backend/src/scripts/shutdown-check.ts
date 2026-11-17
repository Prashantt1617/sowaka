/**
 * Checks that shutdown lets requests in progress finish before it goes on
 * (`npm run shutdown:check -w backend`). Real HTTP servers, no database.
 */
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { drainHttpServer } from '../utils/drain';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const start = (delayMs: number): Promise<Server> => new Promise((resolve) => {
  const server = createServer((_req, res) => { setTimeout(() => { res.writeHead(200); res.end('done'); }, delayMs); });
  server.keepAliveTimeout = 60_000;
  server.listen(0, '127.0.0.1', () => { ports.set(server, (server.address() as AddressInfo).port); resolve(server); });
});

const ports = new WeakMap<Server, number>();
const get = (server: Server, agent = false): Promise<{ status: number; body: string } | { error: string }> => new Promise((resolve) => {
  const port = (server.address() as AddressInfo | null)?.port ?? ports.get(server)!;
  ports.set(server, port);
  const req = request({ host: '127.0.0.1', port, path: '/', headers: agent ? { connection: 'keep-alive' } : {} }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
  });
  req.on('error', (e) => resolve({ error: e.message }));
  req.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  // 1. A request in progress finishes with its real answer; drain waits for it.
  {
    const server = await start(600);
    const inFlight = get(server);
    await sleep(50);
    const t0 = Date.now();
    const how = await drainHttpServer(server, 5000);
    const took = Date.now() - t0;
    const res = await inFlight;
    check('in-progress request finishes with 200', 'status' in res && res.status === 200 && res.body === 'done', JSON.stringify(res));
    check('drain waits for it, then resolves', how === 'drained' && took >= 450 && took < 2000, `${how} in ${took} ms`);
    // 2. After draining starts, new requests are refused (not half served).
    const late = await get(server);
    check('new requests after shutdown are refused', 'error' in late, JSON.stringify(late));
  }
  // 3. No requests open: resolves at once.
  {
    const server = await start(10);
    const t0 = Date.now();
    const how = await drainHttpServer(server, 5000);
    check('idle server drains at once', how === 'drained' && Date.now() - t0 < 300, `${how} in ${Date.now() - t0} ms`);
  }
  // 4. An idle keep-alive socket does not hold shutdown open.
  {
    const server = await start(10);
    await get(server, true);
    const t0 = Date.now();
    const how = await drainHttpServer(server, 5000);
    check('idle keep-alive socket does not block', how === 'drained' && Date.now() - t0 < 500, `${how} in ${Date.now() - t0} ms`);
  }
  // 5. A request slower than the window is cut at the window, and the hook runs.
  {
    const server = await start(3000);
    const inFlight = get(server);
    await sleep(50);
    let hooked = false;
    const t0 = Date.now();
    const how = await drainHttpServer(server, 400, () => { hooked = true; });
    const took = Date.now() - t0;
    await inFlight;
    check('a request past the window is cut at the window', how === 'timed_out' && hooked && took >= 380 && took < 1000, `${how} in ${took} ms`);
  }
  // 6. Already closed by someone else (socket.io's close): still waits for the request.
  {
    const server = await start(500);
    const inFlight = get(server);
    await sleep(50);
    server.close();
    const t0 = Date.now();
    const how = await drainHttpServer(server, 5000);
    const res = await inFlight;
    check('server closed elsewhere first: still waits', how === 'drained' && Date.now() - t0 >= 350 && 'status' in res && res.status === 200, `${how} in ${Date.now() - t0} ms`);
  }
  console.log(failures ? `\n${failures} failed` : '\nall shutdown checks passed');
  process.exit(failures ? 1 : 0);
};

void main();
