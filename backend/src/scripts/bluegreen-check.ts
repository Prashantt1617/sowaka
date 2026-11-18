/**
 * Blue/green restarts, checked end to end (docs/deploy/bluegreen.md):
 *
 *   BLUEGREEN_MONGO_URI=mongodb://127.0.0.1:27180 BLUEGREEN_REDIS_URL=redis://127.0.0.1:6390 \
 *     npm run bluegreen:check -w backend
 *
 * Local only: a scratch database on a local mongod and a local redis-server (it refuses anything
 * else). Three parts:
 *   1. The background-jobs lease and the slot ledger, in this process with fast clocks: one leader
 *      at a time (also when one's renewals fail), each slot run exactly once across handovers.
 *   2. The cache bus over real Redis: a drop made in one process reaches the other's memory.
 *   3. Two real API servers (`src/server.ts`) behind a proxy that switches the way nginx's graceful
 *      reload does, hammered with requests while it switches blue -> green -> blue: no request may
 *      fail; sockets reconnect to the new copy; a live Tile Up room carries on; the background jobs
 *      hand over with every probe slot run once; shutdown logs no "tick failed".
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, createWriteStream } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { MongoClient, type Collection } from 'mongodb';
import Redis from 'ioredis';
import { io as ioClient, type Socket } from 'socket.io-client';

const MONGO = process.env.BLUEGREEN_MONGO_URI ?? 'mongodb://127.0.0.1:27180';
const REDIS = process.env.BLUEGREEN_REDIS_URL ?? 'redis://127.0.0.1:6390';
const DB = 'bluegreen_scratch';
const ORG = 'bgcheck';
const LOGS = process.env.BLUEGREEN_LOG_DIR ?? path.resolve(__dirname, '../../.bluegreen-logs');
const BACKEND = path.resolve(__dirname, '../..');
const PORTS = { blue: 4610, green: 4611, proxy: 4699 };

for (const url of [MONGO, REDIS]) {
  if (!/^(mongodb|redis):\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) throw new Error(`Local only: ${url}`);
}
if (existsSync(path.join(BACKEND, '.env'))) throw new Error('backend/.env exists here: run this from a checkout without one, so nothing falls back to its database');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: () => boolean | Promise<boolean>, ms: number, every = 100): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await what()) return true; await sleep(every); }
  return what();
};

// ─────────────────────────────────────────── 1. lease and slot ledger, in process ──

async function leaseAndLedger(mongo: MongoClient): Promise<void> {
  console.log('\n— 1. The background-jobs lease and the slot ledger (in process, fast clocks)');
  // Imported here, after the env is set: nothing else of the server is loaded.
  const { Leader } = await import('../services/leader');
  const { JobRunner } = await import('../services/leader-jobs');
  const db = mongo.db(DB);
  const leases = db.collection('leases_check') as unknown as Collection<import('../services/leader').LeaseDoc>;
  const runsCol = db.collection('job_runs_check') as unknown as Collection<import('../services/leader-jobs').JobRun>;
  await leases.deleteMany({});
  await runsCol.deleteMany({});

  const broken = new Set<string>();
  const ran: { slot: number; by: string }[] = [];
  const intervals: { by: string; from: number; to: number | null }[] = [];
  const make = (holder: string) => {
    const leader = new Leader({
      name: 'check', holder, ttlMs: 600, renewMs: 150, pollMs: 100,
      collection: () => {
        if (broken.has(holder)) throw new Error('simulated: this process cannot reach the database');
        return leases;
      },
    });
    const runner = new JobRunner({
      by: holder,
      runs: () => runsCol,
      stopWaitMs: 2000,
      slotJobs: [{ name: 'probe', periodMs: 1000, offsetMs: 0, graceMs: 1000, run: async (at) => { ran.push({ slot: at.getTime() / 1000, by: holder }); await sleep(30); } }],
      loopJobs: [],
    });
    // Conservative bounds on when this one may run a job: from before its jobs start to after they have stopped.
    leader.whenAcquired(() => { intervals.push({ by: holder, from: Date.now(), to: null }); });
    runner.attach(leader);
    leader.whenReleased(() => { for (const i of intervals) if (i.by === holder && i.to === null) i.to = Date.now(); });
    return leader;
  };

  const a = make('A');
  const b = make('B');
  a.start();
  await sleep(50);
  b.start();
  await sleep(700);
  check('two processes asking: exactly one runs the jobs', [a, b].filter((l) => l.isLeader()).length === 1, `A=${a.isLeader()} B=${b.isLeader()}`);
  const first = a.isLeader() ? a : b;
  const second = first === a ? b : a;

  await sleep(2600);
  // Graceful handover: the leader stops (its jobs finish) and lets go; the other takes over at once.
  const t0 = Date.now();
  await first.release();
  const took = await until(() => second.isLeader(), 2000, 10);
  const handoverMs = Date.now() - t0;
  check('released at shutdown, the other takes the lease within a poll', took && handoverMs < 600, `${handoverMs} ms`);

  await sleep(2400);
  // A process that cannot renew (cut off from the database): it stops its own jobs before the lease
  // runs out, and only then may a third process take it.
  const c = make('C');
  c.start();
  await sleep(300);
  check('while the lease is held, a newcomer waits', !c.isLeader() && second.isLeader());
  broken.add(second.holder);
  const t1 = Date.now();
  await until(() => c.isLeader(), 3000, 10);
  const takeoverMs = Date.now() - t1;
  check('a holder whose renewals fail steps down, and the lease is taken once it has run out', c.isLeader() && !second.isLeader() && takeoverMs >= 450 && takeoverMs < 1500, `${takeoverMs} ms`);
  await sleep(2300);
  await c.release();
  await second.release().catch(() => undefined);

  const overlaps = intervals.some((x, i) => intervals.some((y, j) => i < j && x.from < (y.to ?? Infinity) && y.from < (x.to ?? Infinity)));
  check('never two leaders at once', !overlaps, intervals.map((i) => `${i.by}:${i.from % 100000}-${(i.to ?? 0) % 100000}`).join(' '));
  const slots = ran.map((r) => r.slot).sort((x, y) => x - y);
  const dupes = slots.filter((s, i) => i > 0 && s === slots[i - 1]);
  const gaps: number[] = [];
  for (let s = slots[0]; s <= slots[slots.length - 1]; s++) if (!slots.includes(s)) gaps.push(s);
  check(`every slot ran exactly once across three handovers (${slots.length} slots, by ${[...new Set(ran.map((r) => r.by))].join(', ')})`, dupes.length === 0 && gaps.length === 0, `dupes ${dupes.length}, skipped ${gaps.length}`);
  // Jobs slow to start (an index build on a busy cluster) must not let the lease lapse under them.
  {
    const slow = new Leader({ name: 'check-slow', holder: 'S', ttlMs: 600, renewMs: 150, pollMs: 100, collection: () => leases });
    slow.whenAcquired(() => sleep(1500));
    const rival = new Leader({ name: 'check-slow', holder: 'R', ttlMs: 600, renewMs: 150, pollMs: 100, collection: () => leases });
    await leases.deleteMany({ _id: 'check-slow' });
    slow.start();
    await sleep(100);
    rival.start();
    let rivalLed = false;
    const end = Date.now() + 1800;
    while (Date.now() < end) { if (rival.isLeader()) rivalLed = true; await sleep(20); }
    check('a holder whose jobs take longer than the TTL to start keeps the lease (renewal is not held up)', slow.isLeader() && !rivalLed);
    await slow.release();
    await rival.release();
  }
  const ledger = await runsCol.countDocuments({});
  check('the ledger has one claim per slot run', ledger === ran.length, `${ledger} claims, ${ran.length} runs`);
}

// ─────────────────────────────────────────── 2. cache bus over Redis ──

async function cacheBus(): Promise<void> {
  console.log('\n— 2. Kept answers dropped in every process (cache bus, real Redis)');
  const swr = await import('../services/swr-cache');
  const bus = await import('../services/cache-bus');
  const engagement = await import('../services/engagement-cache');
  const { instanceId } = await import('../utils/instance');
  const { redisClient } = await import('../config/redis');
  redisClient();
  await until(async () => (await import('../config/redis')).redisReady(), 3000);
  check('cache bus subscribed', await bus.startCacheBus());
  const other = new Redis(REDIS);
  const heard: string[] = [];
  const listener = new Redis(REDIS);
  await listener.subscribe(bus.CACHE_BUS_CHANNEL);
  listener.on('message', (_c, m) => heard.push(m));
  await sleep(100);

  await swr.cachedSwr(ORG, 'lc-board-data', null, async () => ({ board: 1 }));
  await other.publish(bus.CACHE_BUS_CHANNEL, JSON.stringify({ from: 'someone-else', op: 'swr-drop', org: ORG, kinds: ['lc-board-data'] }));
  check("another process's drop empties this one's kept board", await until(() => swr.peekSwr(ORG, 'lc-board-data', null) === undefined, 1000));

  await swr.cachedSwr(ORG, 'adm-employees', { page: 1 }, async () => ({ rows: 1 }));
  await other.publish(bus.CACHE_BUS_CHANNEL, JSON.stringify({ from: instanceId, op: 'swr-drop', org: ORG, kinds: ['adm-employees'] }));
  await sleep(200);
  check('its own messages are ignored', swr.peekSwr(ORG, 'adm-employees', { page: 1 }) !== undefined);

  heard.length = 0;
  swr.dropSwr('elsewhere', ['lc-board-data']);
  engagement.forgetEngagement('elsewhere', 'plan');
  await until(() => heard.length >= 2, 1000);
  const parsed = heard.map((m) => JSON.parse(m) as { from: string; op: string });
  check('a drop here is published for the others', parsed.some((p) => p.op === 'swr-drop' && p.from === instanceId) && parsed.some((p) => p.op === 'engagement'), heard.join(' | ').slice(0, 200));

  heard.length = 0;
  bus.applyRemoteDrop({ op: 'swr-forget', org: ORG, kinds: [] });
  await sleep(200);
  check('a drop applied from another process is not sent on (no echo)', heard.length === 0 && swr.peekSwr(ORG, 'adm-employees', { page: 1 }) === undefined);
  await bus.stopCacheBus();
  other.disconnect();
  listener.disconnect();
}

// ─────────────────────────────────────────── 3. two servers, a proxy, a switch ──

/**
 * nginx's graceful reload, as far as the backend can tell: from the switch on, every new request
 * and every new socket goes to the new upstream (new workers); requests already sent finish where
 * they are, and an upgraded socket stays piped to the old one until either end closes it (old
 * workers). Upstream connections are kept alive per upstream (`keepalive 64`). A failed upstream
 * connection is a 502, as nginx gives.
 */
function startProxy(port: number, initial: number) {
  let target = initial;
  const agents = new Map<number, http.Agent>();
  const agentFor = (p: number) => { let a = agents.get(p); if (!a) { a = new http.Agent({ keepAlive: true, maxSockets: 64 }); agents.set(p, a); } return a; };
  const stats = { badGateway: 0 };
  const server = http.createServer((req, res) => {
    const to = target;
    const up = http.request({ host: '127.0.0.1', port: to, method: req.method, path: req.url, headers: { ...req.headers, connection: 'keep-alive' }, agent: agentFor(to) }, (pres) => {
      res.writeHead(pres.statusCode ?? 502, pres.headers);
      pres.pipe(res);
    });
    up.on('error', () => { stats.badGateway += 1; if (!res.headersSent) res.writeHead(502); res.end('bad gateway'); });
    req.pipe(up);
  });
  server.on('upgrade', (req, client, head) => {
    const up = net.connect(target, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`), '', ''];
      up.write(lines.join('\r\n'));
      if (head.length) up.write(head);
      client.pipe(up).pipe(client);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
    up.on('close', () => client.destroy());
    client.on('close', () => up.destroy());
  });
  server.keepAliveTimeout = 60_000;
  server.listen(port, '127.0.0.1');
  return { switchTo: (p: number) => { target = p; }, target: () => target, stats, close: () => server.close() };
}

interface Proc { color: string; port: number; child: ChildProcess; log: string; exited: Promise<number | null>; peakRssMb: number }

function startServer(color: 'blue' | 'green'): Proc {
  const port = PORTS[color];
  const log = path.join(LOGS, `${color}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: BACKEND,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'development',
      PORT: String(port),
      APP_COLOR: color,
      MONGODB_URI: MONGO,
      MONGODB_DB: DB,
      REDIS_URL: REDIS,
      // Shorter than production's so the check runs in a minute; the order of things is the same.
      SHUTDOWN_DRAIN_MS: '8000',
      JOBS_STOP_WAIT_MS: '8000',
      LEADER_TTL_MS: '6000',
      LEADER_RENEW_MS: '1000',
      LEADER_POLL_MS: '300',
      LEADER_PROBE_MS: '1000',
      NOTIFY_ORGS: 'nobody-scratch',
      EMAIL_ORGS: 'nobody-scratch',
      CUP_RUNNER_ORGS: 'nobody-scratch',
      AWS_S3_BUCKET: '',
      JWT_SECRET: 'bluegreen-check',
      SCRIBBLE_TICKET_SECRET: 'bluegreen-check',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  const proc: Proc = { color, port, child, log, peakRssMb: 0, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
  const sampler = setInterval(() => {
    try {
      const rss = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)]).toString().trim()) / 1024;
      proc.peakRssMb = Math.max(proc.peakRssMb, Math.round(rss));
    } catch { /* gone */ }
  }, 1000);
  sampler.unref();
  void proc.exited.then(() => clearInterval(sampler));
  return proc;
}

const getJson = (port: number, p: string, token?: string, method = 'GET'): Promise<{ status: number; body: Record<string, unknown> | null; error?: string }> => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {} }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { let body: Record<string, unknown> | null = null; try { body = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, body }); });
  });
  req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
  req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
  if (method !== 'GET') req.write('{}');
  req.end();
});

async function waitReady(proc: Proc, ms = 120_000): Promise<{ ms: number; first503: boolean; body: Record<string, unknown> | null }> {
  const t0 = Date.now();
  let first503 = false;
  let last: Awaited<ReturnType<typeof getJson>> = { status: 0, body: null };
  while (Date.now() - t0 < ms) {
    last = await getJson(proc.port, '/health/ready');
    if (last.status === 503) first503 = true;
    if (last.status === 200) return { ms: Date.now() - t0, first503, body: last.body };
    await sleep(250);
  }
  throw new Error(`${proc.color} never ready: ${JSON.stringify(last)}`);
}

async function seed(mongo: MongoClient): Promise<{ tokens: string[]; userIds: string[] }> {
  const db = mongo.db(DB);
  await db.dropDatabase();
  const now = new Date();
  await db.collection('companies').insertOne({ id: ORG, name: 'Blue Green Check', createdAt: now, enabledTabs: [], features: {} });
  const userIds = ['bg-user-1', 'bg-user-2'];
  const tokens: string[] = [];
  for (const [i, userId] of userIds.entries()) {
    await db.collection('users').insertOne({ userId, org: ORG, name: `Player ${i + 1}`, email: `bg${i + 1}@bgcheck.test`, role: 'employee', lifecycleStatus: 'active', createdAt: now, updatedAt: now });
    const token = randomBytes(32).toString('hex');
    tokens.push(token);
    await db.collection('auth_sessions').insertOne({ tokenHash: createHash('sha256').update(token).digest('hex'), userId, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000) });
  }
  return { tokens, userIds };
}

type Ack = { ok: boolean; data?: Record<string, unknown>; status?: number; message?: string };
const emitAck = (socket: Socket, event: string, payload: Record<string, unknown> = {}): Promise<Ack> =>
  new Promise((resolve) => socket.timeout(8000).emit(event, payload, (err: unknown, reply: Ack) => resolve(err ? { ok: false, message: String(err) } : reply)));

async function twoServers(mongo: MongoClient): Promise<void> {
  console.log('\n— 3. Two API servers behind a switching proxy, under load');
  mkdirSync(LOGS, { recursive: true });
  const { tokens } = await seed(mongo);
  const db = mongo.db(DB);
  const procs: Proc[] = [];

  const blue = startServer('blue');
  procs.push(blue);
  const blueReady = await waitReady(blue);
  check('blue: /health/ready is 503 until warm, then 200', blueReady.first503 && blueReady.body?.ready === true, `${blueReady.ms} ms, ${JSON.stringify(blueReady.body).slice(0, 160)}`);
  await until(async () => (await getJson(blue.port, '/health')).body?.leader === true, 10_000);
  check('blue, alone, takes the background-jobs lease', (await getJson(blue.port, '/health')).body?.leader === true);

  const proxy = startProxy(PORTS.proxy, blue.port);
  await sleep(200);

  // ── load: 24 clients, back to back, a mix of reads, a signed-in read and a write ──
  const results = { ok: 0, failed: [] as string[], byPort: new Map<number, number>() };
  let loading = true;
  const reqs: [string, string, boolean][] = [['GET', '/health', false], ['GET', '/auth/me', true], ['GET', '/notifications/unread-count', true], ['PATCH', '/notifications/read-all', true]];
  const worker = async (n: number) => {
    let i = n;
    while (loading) {
      const [method, p, auth] = reqs[i++ % reqs.length];
      const r = await getJson(PORTS.proxy, p, auth ? tokens[i % 2] : undefined, method);
      if (r.status >= 200 && r.status < 300) {
        results.ok += 1;
        if (p === '/health') { const port = Number(r.body?.port); results.byPort.set(port, (results.byPort.get(port) ?? 0) + 1); }
      } else results.failed.push(`${method} ${p} -> ${r.status}${r.error ? ` ${r.error}` : ''} ${JSON.stringify(r.body).slice(0, 80)}`);
    }
  };
  const workers = Array.from({ length: 24 }, (_, n) => worker(n));

  // ── sockets: one Connect socket, and a Tile Up room with two players ──
  const sockOpts = (token: string) => ({ path: '/connect/socket', transports: ['websocket'], auth: { token }, reconnectionDelay: 300, reconnectionDelayMax: 1000 });
  const connect = ioClient(`http://127.0.0.1:${PORTS.proxy}`, sockOpts(tokens[0]));
  const connectEvents = { connects: 0, disconnects: [] as string[] };
  connect.on('connect', () => { connectEvents.connects += 1; });
  connect.on('disconnect', (reason) => connectEvents.disconnects.push(reason));
  const tA = ioClient(`http://127.0.0.1:${PORTS.proxy}/tileup`, sockOpts(tokens[0]));
  const tB = ioClient(`http://127.0.0.1:${PORTS.proxy}/tileup`, sockOpts(tokens[1]));
  const reconnects = { A: 0, B: 0 };
  tA.io.on('reconnect', () => { reconnects.A += 1; });
  tB.io.on('reconnect', () => { reconnects.B += 1; });
  let lastView: Record<string, unknown> | null = null;
  for (const s of [tA, tB]) s.on('room:state', (v: Record<string, unknown>) => { if (s === tA) lastView = v; });
  check('sockets connect through the proxy', await until(() => connect.connected && tA.connected && tB.connected, 10_000));
  await sleep(500);
  const hosted = await emitAck(tA, 'room:host');
  const code = String((hosted.data as { code?: string; room?: { code?: string } } | undefined)?.code ?? (hosted.data as { room?: { code?: string } } | undefined)?.room?.code ?? '');
  const joined = await emitAck(tB, 'room:join', { code });
  const started = await emitAck(tA, 'room:start');
  check('a Tile Up room is hosted, joined and started on blue', hosted.ok && joined.ok && started.ok, `code ${code}; ${JSON.stringify([hosted.message, joined.message, started.message])}`);
  const roomBefore = await new Redis(REDIS).get(`tileup:room:${ORG}:${code}`);

  // ── switch 1: blue -> green, the old one stopped 3 s after the switch ──
  await sleep(2000);
  const green = startServer('green');
  procs.push(green);
  const greenReady = await waitReady(green);
  check('green ready beside blue (warm before any traffic)', greenReady.body?.ready === true && greenReady.body?.leader === false, `${greenReady.ms} ms`);
  const okBefore = results.ok;
  proxy.switchTo(green.port);
  await sleep(3000);
  const tStop1 = Date.now();
  blue.child.kill('SIGINT');
  await blue.exited;
  const stop1Ms = Date.now() - tStop1;
  const greenLeads = await until(async () => (await getJson(green.port, '/health')).body?.leader === true, 5000, 50);
  const leadMs = Date.now() - tStop1;
  check('blue stopped cleanly; green takes the jobs as it lets go', greenLeads, `blue shut down in ${stop1Ms} ms; green leader ${leadMs - stop1Ms} ms after`);
  check('load kept flowing through switch 1', results.ok > okBefore + 100, `${results.ok - okBefore} ok since`);

  // The room survived: both players reconnected to green, and the game goes on there.
  check('Tile Up sockets reconnected to green', await until(() => tA.connected && tB.connected && reconnects.A > 0 && reconnects.B > 0, 10_000), JSON.stringify(reconnects));
  const roomAfter = await new Redis(REDIS).get(`tileup:room:${ORG}:${code}`);
  // The game itself, not who is online: each player went offline and came back (offlineAt, updatedAt).
  const game = (raw: string | null) => {
    if (!raw) return null;
    const r = JSON.parse(raw) as Record<string, unknown> & { players: { userId: string }[] };
    return JSON.stringify([r.code, r.status, r.gameId, r.hostId, r.board, r.bag, r.racks, r.order, r.players.map((p) => p.userId)]);
  };
  check('the room carries on after the switch: same game, board, bag, racks and turn order', Boolean(roomBefore) && game(roomAfter) === game(roomBefore), `${(roomBefore ?? '').length} / ${(roomAfter ?? '').length} bytes`);
  await sleep(500);
  // Whoever is to move passes; the other is refused as not their turn. Either way the room answered from green.
  const passA = await emitAck(tA, 'tileup:pass');
  const passB = passA.ok ? { ok: false } : await emitAck(tB, 'tileup:pass');
  check('a move in the room is accepted after the switch (served by green)', passA.ok || passB.ok, JSON.stringify([passA.message, (passB as Ack).message]));
  check('the Connect socket reconnected', connect.connected && connectEvents.connects >= 2, `${connectEvents.connects} connects, disconnects: ${connectEvents.disconnects.join(',')}`);
  void lastView;

  // ── switch 2: green -> blue again, the old one stopped at the same moment as the switch (drain under load) ──
  const blue2 = startServer('blue');
  procs.push(blue2);
  const blue2Ready = await waitReady(blue2);
  check('blue ready again beside green', blue2Ready.body?.ready === true, `${blue2Ready.ms} ms`);
  const okBefore2 = results.ok;
  proxy.switchTo(blue2.port);
  const tStop2 = Date.now();
  green.child.kill('SIGINT');
  await green.exited;
  const stop2Ms = Date.now() - tStop2;
  check('blue takes the jobs back', await until(async () => (await getJson(blue2.port, '/health')).body?.leader === true, 5000, 50), `green shut down in ${stop2Ms} ms`);
  await sleep(3000);
  check('load kept flowing through switch 2', results.ok > okBefore2 + 100, `${results.ok - okBefore2} ok since`);

  loading = false;
  await Promise.all(workers);
  connect.close(); tA.close(); tB.close();
  check(`no request failed across two switches (${results.ok} ok)`, results.failed.length === 0 && proxy.stats.badGateway === 0, `${results.failed.length} failed, ${proxy.stats.badGateway} bad gateway: ${results.failed.slice(0, 5).join(' | ')}`);
  check('both copies served (health answered by port)', (results.byPort.get(PORTS.blue) ?? 0) > 0 && (results.byPort.get(PORTS.green) ?? 0) > 0, JSON.stringify([...results.byPort]));

  // ── background jobs: every probe slot once, across both handovers ──
  await sleep(1500);
  const probes = await db.collection('bluegreen_probe').find({}, { projection: { _id: 0, slotStart: 1, port: 1 } }).sort({ slotStart: 1 }).toArray();
  const secs = probes.map((p) => (p.slotStart as Date).getTime() / 1000);
  const dupes = secs.filter((s, i) => i > 0 && s === secs[i - 1]).length;
  let skipped = 0;
  for (let s = secs[0]; s <= secs[secs.length - 1]; s++) if (!secs.includes(s)) skipped += 1;
  const byPort = probes.reduce<Record<string, number>>((m, p) => { m[p.port] = (m[p.port] ?? 0) + 1; return m; }, {});
  check(`probe job: each one-second slot ran exactly once across both handovers (${secs.length} slots)`, dupes === 0 && skipped === 0 && Object.keys(byPort).length === 2, `dupes ${dupes}, skipped ${skipped}, by port ${JSON.stringify(byPort)}`);
  const realJobs = await db.collection('job_runs').aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
  check('no job slot claimed twice in job_runs', realJobs.length === 0);

  // ── shutdown logs ──
  blue2.child.kill('SIGINT');
  await blue2.exited;
  proxy.close();
  for (const p of procs) {
    const text = readFileSync(p.log, 'utf8');
    const bad = text.split('\n').filter((l) => /tick failed|MongoClientClosedError|Unhandled request error|Failed to start server/.test(l));
    check(`${p.color} (${path.basename(p.log)}): clean shutdown, no "tick failed" / closed-client errors`, /Shutdown complete/.test(text) && bad.length === 0, bad.slice(0, 2).join(' | ').slice(0, 300));
  }
  console.log(`\npeak RSS (tsx, so above a built server's): ${procs.map((p) => `${p.color} ${p.peakRssMb} MB`).join(', ')}`);
  console.log(`warm-up to ready: blue ${blueReady.ms} ms, green ${greenReady.ms} ms, blue again ${blue2Ready.ms} ms; old copy shut down in ${stop1Ms} / ${stop2Ms} ms`);
}

async function main(): Promise<void> {
  process.env.REDIS_URL = REDIS;
  process.env.MONGODB_URI = MONGO;
  process.env.MONGODB_DB = DB;
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  try {
    if (!process.argv.includes('--e2e-only')) {
      await leaseAndLedger(mongo);
      await cacheBus();
    }
    if (!process.argv.includes('--no-e2e')) await twoServers(mongo);
  } finally {
    await mongo.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nall blue/green checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
