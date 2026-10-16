/**
 * Secret Squad under a whole company: N simulated players across four offices
 * on one local server, all joining, then hunting with real QR scans for a while.
 * Prints how long requests take and how many updates each phone gets.
 * Scratch database only; dropped at the end.
 *
 *   MONGODB_DB=secret_squad_load_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch \
 *     npx tsx src/scripts/secret-squad-load.ts [players=250] [seconds=60]
 */
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { env } from '../config/env';
import { companies, connectDb, getDb, users } from '../config/db';
import { redisClient, redisReady } from '../config/redis';
import type { User } from '../models/user.model';
import { initConnectRealtime } from '../services/connect-realtime.service';
import { mintTicket } from '../services/scribble-ticket.service';
import { configureSquad, openDueSessions, roundConfig, squadSchedules, tickSquad } from '../services/secret-squad.service';
import { closeSquadRealtime, initSquadRealtime } from '../services/secret-squad-realtime.service';
import { codeFor, qrFor } from '../services/secret-squad-engine';
import { liveSessions, readSession, resetSquadMemory } from '../services/secret-squad-store';

if (!/scratch|check/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}".`);
  process.exit(1);
}

const TOTAL = Number(process.argv[2] ?? 250);
const SECONDS = Number(process.argv[3] ?? 60);
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;
const ORG = 'sowaka';
const OFFICES: Array<[string, number]> = [['Gurgaon', 0.62], ['Noida', 0.2], ['Kolkata', 0.1], ['Pune', 0.08]];


const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

interface Bot { user: User; socket: ClientSocket; states: number; bytes: number }

(async () => {
  let server: ReturnType<typeof app.listen> | undefined;
  const clock = { offset: 0 };
  try {
    await connectDb();
    if (process.env.REDIS_URL) {
      redisClient();
      await wait(1200);
    }
    await getDb().dropDatabase();
    await connectDb();
    resetSquadMemory();
    configureSquad({ now: () => Date.now() + clock.offset, notify: async () => undefined, awardPoints: async () => undefined });

    const people: User[] = [];
    let n = 0;
    for (const [office, share] of OFFICES) {
      const count = office === OFFICES.at(-1)![0] ? TOTAL - n : Math.round(TOTAL * share);
      for (let i = 0; i < count; i += 1) {
        n += 1;
        people.push({ userId: `load-${n}`, name: `Load ${n}`, email: `load${n}@sowaka.local`, org: ORG, location: office, department: `Team ${n % 9}`, lifecycleStatus: 'active' } as User);
      }
    }
    await users().insertMany(people);
    await companies().insertOne({ id: ORG, name: 'Sowaka' } as never);
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    initSquadRealtime(initConnectRealtime(server));
    console.log(`\n${TOTAL} players across ${OFFICES.map(([o]) => o).join(', ')}; store: ${redisReady() ? 'Redis' : 'memory'}\n`);

    // Connect everyone.
    const t0 = Date.now();
    const bots: Bot[] = await Promise.all(people.map((user) => new Promise<Bot>((resolve, reject) => {
      const socket = connect(`${BASE}/squad`, { path: '/connect/socket', transports: ['websocket'], auth: { ticket: mintTicket({ userId: user.userId, org: ORG, name: user.name }) }, reconnection: false });
      const bot: Bot = { user, socket, states: 0, bytes: 0 };
      socket.on('squad:state', (state: unknown) => {
        bot.states += 1;
        bot.bytes += JSON.stringify(state).length;
      });
      socket.on('connect', () => resolve(bot));
      socket.on('connect_error', reject);
    })));
    console.log(`connected ${bots.length} sockets in ${Date.now() - t0} ms`);

    // Scheduled only now that everyone is connected: setup time can't eat the lobby.
    const startsAt = Date.now() + 120_000;
    for (const [office] of OFFICES) {
      await squadSchedules().insertOne({
        id: `load-${office}`, org: ORG, office, startsAt: new Date(startsAt), lobbyMs: 120_000,
        rounds: [roundConfig({ squadSize: 5, huntMs: SECONDS * 1000 + 60_000 })],
        status: 'scheduled', createdAt: new Date(), updatedAt: new Date(),
      });
    }

    clock.offset = 0;
    await openDueSessions();
    console.log(`lobbies open: ${(await liveSessions()).length}`);

    const timed = (bot: Bot, event: string, payload: Record<string, unknown>) => new Promise<{ ms: number; ok: boolean; status?: number }>((resolve) => {
      const started = Date.now();
      bot.socket.timeout(10_000).emit(event, payload, (err: unknown, res: { ok: boolean; status?: number }) =>
        resolve({ ms: Date.now() - started, ok: !err && Boolean(res?.ok), status: err ? 0 : res?.status, message: err ? String(err) : (res as { message?: string })?.message } as never));
    });

    const joins = await Promise.all(bots.map((bot) => timed(bot, 'squad:join', {})));
    const joinMs = joins.map((j) => j.ms);
    const firstBad = joins.find((j) => !j.ok); if (firstBad) console.log("first failed join:", JSON.stringify(firstBad));
    console.log(`join (all at once): ok ${joins.filter((j) => j.ok).length}/${bots.length}, p50 ${pct(joinMs, 50)} ms, p95 ${pct(joinMs, 95)} ms, max ${Math.max(...joinMs)} ms`);

    // Skip to the deal and the hunt.
    clock.offset = startsAt - Date.now() + 1;
    await tickSquad();
    clock.offset += 10_001;
    await tickSquad();
    await wait(500);
    const sessions = await Promise.all(OFFICES.map(([office]) => readSession(ORG, `load-${office}`)));
    console.log(`dealt: ${sessions.map((s) => `${s?.office} ${s?.round?.squads.length} squads`).join(', ')}`);
    for (const bot of bots) { bot.states = 0; bot.bytes = 0; }

    // Hunt: every player scans a random colleague's QR in their office every ~4 s.
    const checkMs: number[] = [];
    let ok = 0, refused = 0, errors = 0;
    const until = Date.now() + SECONDS * 1000;
    const officeOf = new Map(people.map((p) => [p.userId, p.location!]));
    let ticks = 0;
    const ticker = setInterval(() => { void tickSquad(); ticks += 1; }, 500);
    await Promise.all(bots.map(async (bot) => {
      await wait(Math.random() * 4000);
      while (Date.now() < until) {
        const session = await readSession(ORG, `load-${officeOf.get(bot.user.userId)}`);
        const others = session?.players.filter((p) => p.userId !== bot.user.userId && p.playing) ?? [];
        const target = others[Math.floor(Math.random() * others.length)];
        const code = session && target ? codeFor(session, target.userId, Date.now() + clock.offset)?.code : undefined;
        if (session && code) {
          const result = await timed(bot, 'squad:scan', { qr: qrFor(session, code) });
          checkMs.push(result.ms);
          if (result.ok) ok += 1; else if (result.status && result.status < 500) refused += 1; else errors += 1;
        }
        await wait(3000 + Math.random() * 2000);
      }
    }));
    clearInterval(ticker);

    const states = bots.map((b) => b.states);
    const perSecond = states.reduce((a, b) => a + b, 0) / SECONDS;
    const finished = (await Promise.all(OFFICES.map(([office]) => readSession(ORG, `load-${office}`))))
      .map((s) => `${s?.office} ${s?.round?.squads.filter((q) => q.finishedAt).length}/${s?.round?.squads.length}`);
    const mem = process.memoryUsage();
    console.log(`\nhunt for ${SECONDS}s: ${checkMs.length} scans (${(checkMs.length / SECONDS).toFixed(1)}/s); accepted ${ok}, refused by rules ${refused}, errors ${errors}`);
    console.log(`scan round trip: p50 ${pct(checkMs, 50)} ms, p95 ${pct(checkMs, 95)} ms, p99 ${pct(checkMs, 99)} ms, max ${Math.max(...checkMs)} ms`);
    console.log(`updates per phone: p50 ${pct(states, 50)}, max ${Math.max(...states)} over ${SECONDS}s; ${perSecond.toFixed(0)} updates/s server-wide; avg update ${Math.round(bots.reduce((a, b) => a + b.bytes, 0) / Math.max(1, states.reduce((a, b) => a + b, 0)))} bytes`);
    console.log(`squads finished: ${finished.join(', ')}; ticks ${ticks}`);
    console.log(`server process memory: rss ${Math.round(mem.rss / 1e6)} MB, heap ${Math.round(mem.heapUsed / 1e6)} MB`);
    for (const bot of bots) bot.socket.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    closeSquadRealtime();
    server?.close();
    await getDb().dropDatabase().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }
})();
