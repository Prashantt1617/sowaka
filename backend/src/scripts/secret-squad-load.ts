/**
 * Secret Squad under a whole company: N simulated players across four offices
 * on one local server, all joining, then hunting with real QR scans for a
 * while, then the round's end. Prints how long requests take, how the clock
 * kept up, how many updates each phone gets, and whether every phone ended on
 * what the server says it should see. Scratch database only; dropped at the end.
 *
 *   MONGODB_DB=secret_squad_load_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch \
 *     npx tsx src/scripts/secret-squad-load.ts [players=250] [seconds=60]
 *
 * With REDIS_URL set, the sessions live in Redis instead of memory.
 * SQUAD_LOAD_AIM (default 0.06) sets how often a scan is a good guess.
 *
 * A bot scans what a person could: a colleague's QR as it shows on that
 * colleague's phone right now (the QR in their last `squad:state`), never its
 * own, and only while its own phone says it is hunting (dealt in, squad not
 * complete). One scan in AIM goes to a squadmate it hasn't linked with yet (a
 * good guess); the rest go to anyone in the office.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../app';
import { env } from '../config/env';
import { companies, connectDb, getDb, users } from '../config/db';
import { redisClient, redisReady } from '../config/redis';
import type { User } from '../models/user.model';
import { initConnectRealtime } from '../services/connect-realtime.service';
import { mintTicket } from '../services/scribble-ticket.service';
import { configureSquad, initialsOf, openDueSessions, roundConfig, squadSchedules, stateFor, tickSquad } from '../services/secret-squad.service';
import { closeSquadRealtime, initSquadRealtime } from '../services/secret-squad-realtime.service';
import { deleteSession, liveSessions, readSession, resetSquadMemory } from '../services/secret-squad-store';

if (!/scratch|check/i.test(env.mongoDbName)) {
  console.error(`Refusing to run against database "${env.mongoDbName}".`);
  process.exit(1);
}

const TOTAL = Number(process.argv[2] ?? 250);
const SECONDS = Number(process.argv[3] ?? 60);
/** How often a bot's scan is a good guess (a squadmate), SQUAD_LOAD_AIM; the rest go to anyone. */
const AIM = Number(process.env.SQUAD_LOAD_AIM ?? 0.06);
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
const max = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = { v: number; now: number; session: any };
interface Bot { user: User; socket: ClientSocket; states: number; bytes: number; last: State | null }

/** A state as it shows, not when it was sent. */
const shown = (state: unknown) => JSON.stringify({ ...(state as object), now: 0, v: 0 });

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
    // A run before this one may have left its sessions in Redis (they keep 12 hours).
    for (const [office] of OFFICES) await deleteSession(ORG, `load-${office}`);
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
    const counts = OFFICES.map(([office]) => `${office} ${people.filter((p) => p.location === office).length}`).join(', ');
    console.log(`\n${TOTAL} players (${counts}); store: ${redisReady() ? 'Redis' : 'memory'}\n`);

    const officeOf = new Map(people.map((p) => [p.userId, p.location!]));
    /** When each office's game ended, after the hunt started (every squad complete ends it early). */
    const overAt = new Map<string, number>();
    let huntStarted = 0;
    /** The QR each phone shows right now, by office: what a colleague can scan. */
    const showing = new Map(OFFICES.map(([office]) => [office, new Map<string, string>()]));

    // Connect everyone.
    const t0 = Date.now();
    const bots: Bot[] = await Promise.all(people.map((user) => new Promise<Bot>((resolve, reject) => {
      const socket = connect(`${BASE}/squad`, { path: '/connect/socket', transports: ['websocket'], auth: { ticket: mintTicket({ userId: user.userId, org: ORG, name: user.name }) }, reconnection: false });
      const bot: Bot = { user, socket, states: 0, bytes: 0, last: null };
      socket.on('squad:state', (state: State) => {
        bot.states += 1;
        bot.bytes += JSON.stringify(state).length;
        if (bot.last && state.v < bot.last.v) return; // older than what it shows: ignored, as the page does
        bot.last = state;
        if (state.session?.status === 'over' && huntStarted && !overAt.has(officeOf.get(user.userId)!)) overAt.set(officeOf.get(user.userId)!, Date.now() - huntStarted);
        const qr = state.session?.round?.me?.qr as string | null | undefined;
        const board = showing.get(officeOf.get(user.userId)!)!;
        if (qr) board.set(user.userId, qr);
        else board.delete(user.userId);
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

    const timed = (bot: Bot, event: string, payload: Record<string, unknown>) => new Promise<{ ms: number; ok: boolean; status: number; message: string; data?: Record<string, unknown> }>((resolve) => {
      const started = Date.now();
      bot.socket.timeout(10_000).emit(event, payload, (err: unknown, res: { ok: boolean; status?: number; message?: string; data?: Record<string, unknown> }) =>
        resolve({ ms: Date.now() - started, ok: !err && Boolean(res?.ok), status: err ? 0 : res?.status ?? 200, message: err ? 'timed out (10 s)' : res?.message ?? '', data: res?.data }));
    });

    const joinStarted = Date.now();
    const joins = await Promise.all(bots.map((bot) => timed(bot, 'squad:join', {})));
    const joinAll = Date.now() - joinStarted;
    const joinMs = joins.map((j) => j.ms);
    const firstBad = joins.find((j) => !j.ok);
    if (firstBad) console.log('first failed join:', JSON.stringify(firstBad));
    console.log(`join (all at once): ok ${joins.filter((j) => j.ok).length}/${bots.length}, p50 ${pct(joinMs, 50)} ms, p95 ${pct(joinMs, 95)} ms, max ${max(joinMs)} ms; all done in ${joinAll} ms`);
    const lobbyCounts = await waitConverged('lobby');
    console.log(`lobby: ${lobbyCounts}`);

    // Skip to the deal and the hunt.
    clock.offset = startsAt - Date.now() + 1;
    await tickSquad();
    clock.offset += 10_001;
    await tickSquad();
    await wait(500);
    const sessions = await Promise.all(OFFICES.map(([office]) => readSession(ORG, `load-${office}`)));
    console.log(`dealt: ${sessions.map((s) => `${s?.office} ${s?.round?.squads.length} squads of ${Math.min(...s!.round!.squads.map((q) => q.members.length))}–${Math.max(...s!.round!.squads.map((q) => q.members.length))}, ${s?.players.filter((p) => !p.playing).length} sitting out`).join('; ')}`);
    /** Who is in whose squad: what a bot's good guesses come from. */
    const squadmates = new Map<string, string[]>();
    for (const s of sessions) for (const squad of s?.round?.squads ?? []) for (const id of squad.members) squadmates.set(id, squad.members.filter((m) => m !== id));
    for (const bot of bots) { bot.states = 0; bot.bytes = 0; }

    // The clock, measured: one tick a second here (the realtime ticker runs its own every 500 ms too).
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const tickMs: number[] = [];
    let ticks = 0;
    let lastTickAt = Date.now();
    const tickGaps: number[] = [];
    let ticking = false;
    const ticker = setInterval(() => {
      const at = Date.now();
      tickGaps.push(at - lastTickAt);
      lastTickAt = at;
      if (ticking) return;
      ticking = true;
      void tickSquad().finally(() => { ticks += 1; tickMs.push(Date.now() - at); ticking = false; });
    }, 1000);

    // Hunt: every player scans a colleague's QR every ~4 s.
    const scanMs: number[] = [];
    const results = { right: 0, wrong: 0, already: 0 };
    let completed = 0;
    let refused = 0, errors = 0, idle = 0;
    const reasons = new Map<string, number>();
    huntStarted = Date.now();
    const until = Date.now() + SECONDS * 1000;
    await Promise.all(bots.map(async (bot) => {
      await wait(Math.random() * 4000);
      while (Date.now() < until) {
        const view = bot.last?.session;
        const hunting = view?.status === 'hunt' && view.playing && view.round?.me?.qr && !view.round?.squad?.complete;
        if (!hunting) {
          idle += 1;
          await wait(3000 + Math.random() * 2000);
          continue;
        }
        const office = showing.get(officeOf.get(bot.user.userId)!)!;
        const linked = new Set<string>((view.round.squad.members ?? []).map((m: { userId: string }) => m.userId));
        const guesses = (squadmates.get(bot.user.userId) ?? []).filter((id) => !linked.has(id) && office.has(id));
        let target: string | undefined;
        if (guesses.length && Math.random() < AIM) target = guesses[Math.floor(Math.random() * guesses.length)];
        else {
          const ids = [...office.keys()].filter((id) => id !== bot.user.userId);
          target = ids[Math.floor(Math.random() * ids.length)];
        }
        const qr = target ? office.get(target) : undefined;
        if (qr) {
          const result = await timed(bot, 'squad:scan', { qr });
          scanMs.push(result.ms);
          if (result.ok) {
            const kind = result.data?.result as keyof typeof results;
            if (kind in results) results[kind] += 1;
            if (result.data?.completed) completed += 1;
          } else {
            if (result.status && result.status < 500) refused += 1;
            else errors += 1;
            const reason = `${result.status} ${result.message}`;
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
          }
        }
        await wait(3000 + Math.random() * 2000);
      }
    }));
    clearInterval(ticker);
    lag.disable();

    const states = bots.map((b) => b.states);
    const perSecond = states.reduce((a, b) => a + b, 0) / SECONDS;
    const finished = (await Promise.all(OFFICES.map(([office]) => readSession(ORG, `load-${office}`))))
      .map((s) => `${s?.office} ${s?.round?.squads.filter((q) => q.finishedAt).length}/${s?.round?.squads.length}`);
    const mem = process.memoryUsage();
    const accepted = results.right + results.wrong + results.already;
    console.log(`\nhunt for ${SECONDS}s: ${scanMs.length} scans (${(scanMs.length / SECONDS).toFixed(1)}/s); accepted ${accepted} (right ${results.right}, wrong ${results.wrong}, already ${results.already}; ${completed} completed a squad), refused by rules ${refused}, errors ${errors}; ${idle} turns sat out (not hunting)`);
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${reason}`);
    console.log(`scan round trip: p50 ${pct(scanMs, 50)} ms, p95 ${pct(scanMs, 95)} ms, p99 ${pct(scanMs, 99)} ms, max ${max(scanMs)} ms`);
    console.log(`clock: ${ticks} ticks in ${SECONDS}s (one a second asked), tick p95 ${pct(tickMs, 95)} ms, max ${max(tickMs)} ms; longest gap between ticks ${max(tickGaps)} ms`);
    console.log(`event loop delay: p50 ${(lag.percentile(50) / 1e6).toFixed(0)} ms, p99 ${(lag.percentile(99) / 1e6).toFixed(0)} ms, max ${(lag.max / 1e6).toFixed(0)} ms`);
    console.log(`updates per phone: p50 ${pct(states, 50)}, max ${max(states)} over ${SECONDS}s; ${perSecond.toFixed(0)} updates/s server-wide; avg update ${Math.round(bots.reduce((a, b) => a + b.bytes, 0) / Math.max(1, states.reduce((a, b) => a + b, 0)))} bytes`);
    console.log(`squads finished: ${finished.join(', ')}; ${OFFICES.map(([office]) => (overAt.has(office) ? `${office} all complete at ${(overAt.get(office)! / 1000).toFixed(0)} s` : `${office} still hunting`)).join(', ')}`);
    console.log(`server process memory: rss ${Math.round(mem.rss / 1e6)} MB, heap ${Math.round(mem.heapUsed / 1e6)} MB`);
    console.log(`mid-hunt: ${await waitConverged('hunt')}`);

    // The round's 0:00: results and the final standings on every phone.
    const endsAt = Math.max(...sessions.map((s) => s!.round!.endsAt));
    const endedAt = Date.now();
    clock.offset = endsAt - Date.now() + 1;
    let tickDone = 0;
    const endTick = tickSquad().then(() => { tickDone = Date.now() - endedAt; });
    const over = () => bots.every((bot) => bot.last?.session?.status === 'over');
    while (!over() && Date.now() - endedAt < 20_000) await wait(10);
    const shownAfter = Date.now() - endedAt;
    await endTick;
    const finalBytes = bots.map((bot) => JSON.stringify(bot.last).length);
    console.log(`game over: every phone shows it ${shownAfter} ms after the clock's 0:00 (final state ${Math.round(pct(finalBytes, 50) / 1000)}–${Math.round(max(finalBytes) / 1000)} KB a phone); that tick, with its card and payout writes to Mongo, took ${tickDone} ms`);
    console.log(`after the game: ${await waitConverged('over')}`);
    for (const bot of bots) bot.socket.close();

    /**
     * Every phone's last state against a fresh read of what it should show
     * (now and v aside). A phone a push is still on its way to gets a few
     * more tries; any left over are counted as wrong.
     */
    async function waitConverged(label: string): Promise<string> {
      let pending = bots;
      for (let attempt = 0; attempt < 8 && pending.length; attempt += 1) {
        await wait(attempt === 0 ? 400 : 500);
        const fresh = await Promise.all(pending.map((bot) => stateFor({
          userId: bot.user.userId, org: ORG, name: bot.user.name, initials: initialsOf(bot.user.name), office: bot.user.location!, department: bot.user.department,
        })));
        pending = pending.filter((bot, i) => !bot.last || shown(bot.last) !== shown(fresh[i]));
      }
      if (pending.length) {
        process.exitCode = 1;
        return `NOT converged (${label}): ${pending.length}/${bots.length} phones differ from the server, e.g. ${pending[0].user.userId}`;
      }
      return `every phone (${bots.length}/${bots.length}) shows what the server says it should`;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    closeSquadRealtime();
    server?.close();
    for (const [office] of OFFICES) await deleteSession(ORG, `load-${office}`).catch(() => undefined);
    await getDb().dropDatabase().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }
})();
