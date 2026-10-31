/**
 * The host's controls for a Speed Poker event. Run on the server (the
 * database is production's):
 *
 *   node dist/scripts/poker-event.js create --org convrse --name "Convrse Speed Poker" \
 *     --practice-day 2026-11-05 --game-day 2026-11-06
 *       Day 1 (practice, no points) 10:00–17:00; day 2 open play 10:30–16:00,
 *       power hour 13:00–14:00, bounties from 15:00, semifinals 16:30, final 17:15.
 *       Any time can be changed: --practice 10:00-17:00 --open 10:30-16:00
 *       --power 13:00-14:00 --bounties 15:00 --semis 16:30 --final 17:15
 *       (IST, on the day given). --no-practice for a single day.
 *   node dist/scripts/poker-event.js update --id <event> [the times above]
 *       [--table-minutes 12 --semi-minutes 20 --final-minutes 30 --table-size 6
 *        --min-players 4 --fallback-minutes 6 --cooldown-minutes 2 --counted 6
 *        --best-of 3 --semifinalists 12 --advance 3 --picks on|off
 *        --exclude userId,userId --name "..."]
 *   node dist/scripts/poker-event.js on|off|pause|resume|end --id <event>
 *       on: the clock runs it. off: back to draft (nothing runs, the page says not on).
 *       pause: no new tables (running ones finish). end: over for good.
 *   node dist/scripts/poker-event.js status --id <event>
 *   node dist/scripts/poker-event.js list --org <org>
 *   node dist/scripts/poker-event.js close-open --id <event>      open play ends now; the top 12 are seeded
 *   node dist/scripts/poker-event.js start-semis --id <event>     the semifinals start now
 *   node dist/scripts/poker-event.js start-final --id <event>     the final starts now (once both semis are over)
 *   node dist/scripts/poker-event.js reseed --id <event>          seed the semifinals again from the board now
 *   node dist/scripts/poker-event.js void --id <event> --table <tableId>   a table's points no longer count
 *   node dist/scripts/poker-event.js tv-link --id <event> --base https://<api host> [--hours 12]
 *   node dist/scripts/poker-event.js post-standings --id <event> [--dry-run]   the top ten and the office league to the feed
 *       (--hourly-posts on|off on create/update posts them on the hour during open play)
 *   node dist/scripts/poker-event.js reset --id <event>           results, picks, hands, seeding: all gone (for a test event)
 *
 * The script only changes the event in the database; the server's clock acts
 * on it within a second (seats the queue, starts the semifinals and the
 * final). The feed card is posted with game-launch-post.js --game speed-poker.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectDb } from '../config/db';
import type { PokerEvent, PokerEventConfig } from '../models/poker.model';
import { ensurePokerIndexes, pokerEvents, pokerHands, pokerPicks, pokerResults } from '../services/poker-db';
import { postStandings, standingsText } from '../services/poker-feed';
import { boardOf, DEFAULT_CONFIG, officeLeague, phaseOf, picksBoard, seedSemis } from '../services/poker-floor';
import { mintTicket } from '../services/scribble-ticket.service';

const IST = '+05:30';

function parse(argv: string[]) {
  const [command = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = 'true';
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return { command, flags };
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/** "2026-11-06" + "16:30" → ISO in IST. */
function istAt(date: string, hhmm: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`Not a date: ${date} (use YYYY-MM-DD)`);
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) fail(`Not a time: ${hhmm} (use HH:MM)`);
  const [h, m] = hhmm.split(':');
  return new Date(`${date}T${h.padStart(2, '0')}:${m}:00${IST}`).toISOString();
}

const range = (value: string, label: string) => {
  const [from, to] = value.split('-');
  if (!from || !to) fail(`${label} needs a range like 13:00-14:00`);
  return [from, to];
};

const dayOf = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);

function applyTimes(config: PokerEventConfig, flags: Record<string, string>) {
  const gameDay = flags['game-day'] ?? dayOf(config.game.openFrom);
  const practiceDay = flags['practice-day'] ?? (config.practice ? dayOf(config.practice.from) : null);
  if (flags['no-practice']) config.practice = null;
  else if (practiceDay) {
    const [from, to] = flags.practice ? range(flags.practice, '--practice') : config.practice ? [hm(config.practice.from), hm(config.practice.to)] : ['10:00', '17:00'];
    config.practice = { from: istAt(practiceDay, from), to: istAt(practiceDay, to) };
  }
  const g = config.game;
  const [openFrom, openTo] = flags.open ? range(flags.open, '--open') : [hm(g.openFrom), hm(g.openTo)];
  g.openFrom = istAt(gameDay, openFrom);
  g.openTo = istAt(gameDay, openTo);
  if (flags.power === 'off') g.powerFrom = g.powerTo = null;
  else {
    const [pf, pt] = flags.power ? range(flags.power, '--power') : g.powerFrom && g.powerTo ? [hm(g.powerFrom), hm(g.powerTo)] : [null, null];
    g.powerFrom = pf ? istAt(gameDay, pf) : null;
    g.powerTo = pt ? istAt(gameDay, pt) : null;
  }
  if (flags.bounties === 'off') g.bountiesFrom = null;
  else if (flags.bounties) g.bountiesFrom = istAt(gameDay, flags.bounties);
  else if (g.bountiesFrom) g.bountiesFrom = istAt(gameDay, hm(g.bountiesFrom));
  g.semisAt = istAt(gameDay, flags.semis ?? hm(g.semisAt));
  g.finalAt = istAt(gameDay, flags.final ?? hm(g.finalAt));
}

/** An ISO time's HH:MM in IST. */
function hm(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(11, 16);
}

function applyRules(config: PokerEventConfig, flags: Record<string, string>) {
  const num = (name: string) => {
    if (flags[name] === undefined) return undefined;
    const n = Number(flags[name]);
    if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
    return n;
  };
  const minutes = (name: string) => (num(name) === undefined ? undefined : num(name)! * 60_000);
  const setFormat = (round: 'open' | 'semi' | 'final', ms: number | undefined) => {
    if (ms !== undefined) config.formats[round] = { ...(config.formats[round] ?? {}), durationMs: ms };
  };
  setFormat('open', minutes('table-minutes'));
  setFormat('semi', minutes('semi-minutes'));
  setFormat('final', minutes('final-minutes'));
  if (minutes('table-minutes') !== undefined) config.formats.practice = { ...(config.formats.practice ?? {}), durationMs: minutes('table-minutes') };
  config.tableSize = Math.min(6, num('table-size') ?? config.tableSize);
  config.minPlayers = Math.min(config.tableSize, num('min-players') ?? config.minPlayers);
  config.fallbackMs = minutes('fallback-minutes') ?? config.fallbackMs;
  config.cooldownMs = flags['cooldown-minutes'] === '0' ? 0 : minutes('cooldown-minutes') ?? config.cooldownMs;
  config.countedTables = num('counted') ?? config.countedTables;
  config.bestOf = num('best-of') ?? config.bestOf;
  config.semifinalists = num('semifinalists') ?? config.semifinalists;
  config.advancePerSemi = num('advance') ?? config.advancePerSemi;
  if (flags.picks) config.picks.on = flags.picks !== 'off';
  if (flags.exclude !== undefined) config.exclude = flags.exclude.split(',').map((s) => s.trim()).filter(Boolean);
  if (flags['hourly-posts']) config.hourlyPosts = flags['hourly-posts'] !== 'off';
}

async function load(id: string | undefined): Promise<PokerEvent> {
  if (!id) fail('--id is required');
  const event = await pokerEvents().findOne({ id }, { projection: { _id: 0 } });
  if (!event) fail(`No event ${id}`);
  return event!;
}

async function set(event: PokerEvent, change: Partial<PokerEvent>) {
  await pokerEvents().updateOne({ id: event.id }, { $set: { ...change, updatedAt: new Date() } });
  Object.assign(event, change);
}

function times(event: PokerEvent) {
  const c = event.config;
  const t = (iso: string | null) => (iso ? `${dayOf(iso)} ${hm(iso)}` : '—');
  return [
    c.practice ? `  Day 1 practice  ${t(c.practice.from)} – ${hm(c.practice.to)} (no points)` : '  Day 1 practice  none',
    `  Open play       ${t(c.game.openFrom)} – ${hm(c.game.openTo)}`,
    `  Power hour      ${c.game.powerFrom ? `${hm(c.game.powerFrom)} – ${hm(c.game.powerTo!)}` : 'off'}`,
    `  Bounties from   ${c.game.bountiesFrom ? hm(c.game.bountiesFrom) : 'off'}`,
    `  Semifinals      ${hm(c.game.semisAt)}   Final ${hm(c.game.finalAt)}`,
    `  Tables          ${Math.round((c.formats.open?.durationMs ?? 12 * 60_000) / 60_000)} min, semis ${Math.round((c.formats.semi?.durationMs ?? 20 * 60_000) / 60_000)}, final ${Math.round((c.formats.final?.durationMs ?? 30 * 60_000) / 60_000)}; ${c.tableSize} a table, ${c.minPlayers} after ${c.fallbackMs / 60_000} min; cooldown ${c.cooldownMs / 60_000} min; best ${c.bestOf} of ${c.countedTables}`,
  ].join('\n');
}

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  await connectDb();
  await ensurePokerIndexes();
  const now = Date.now();
  switch (command) {
    case 'create': {
      if (!flags.org) fail('--org is required');
      if (!flags['game-day']) fail('--game-day YYYY-MM-DD is required');
      const config: PokerEventConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        practice: null,
        game: {
          openFrom: istAt(flags['game-day'], '10:30'),
          openTo: istAt(flags['game-day'], '16:00'),
          powerFrom: istAt(flags['game-day'], '13:00'),
          powerTo: istAt(flags['game-day'], '14:00'),
          bountiesFrom: istAt(flags['game-day'], '15:00'),
          semisAt: istAt(flags['game-day'], '16:30'),
          finalAt: istAt(flags['game-day'], '17:15'),
        },
      };
      applyTimes(config, flags);
      applyRules(config, flags);
      const event: PokerEvent = {
        id: `poker-${randomUUID().slice(0, 8)}`,
        org: flags.org,
        name: flags.name ?? 'Speed Poker',
        catalogKey: 'speed-poker',
        status: 'draft',
        paused: false,
        config,
        semis: null,
        final: null,
        champion: null,
        postId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await pokerEvents().insertOne({ ...event });
      console.log(`Created ${event.id} for ${event.org}: "${event.name}" (draft; turn it on with: on --id ${event.id})\n${times(event)}`);
      break;
    }
    case 'update': {
      const event = await load(flags.id);
      const config = structuredClone(event.config);
      applyTimes(config, flags);
      applyRules(config, flags);
      await set(event, { config, ...(flags.name ? { name: flags.name } : {}) });
      console.log(`Updated ${event.id}.\n${times(event)}`);
      break;
    }
    case 'on':
    case 'off':
    case 'end': {
      const event = await load(flags.id);
      const status = command === 'on' ? 'live' : command === 'off' ? 'draft' : 'over';
      if (status === 'live') {
        const other = await pokerEvents().findOne({ org: event.org, status: 'live', id: { $ne: event.id } });
        if (other) fail(`${other.id} is already live at ${event.org}; turn it off first.`);
      }
      await set(event, { status });
      console.log(`${event.id} is now ${status}. Phase: ${phaseOf(event, now)}.`);
      break;
    }
    case 'pause':
    case 'resume': {
      const event = await load(flags.id);
      await set(event, { paused: command === 'pause' });
      console.log(command === 'pause' ? `${event.id} paused: no new tables; running ones finish.` : `${event.id} resumed.`);
      break;
    }
    case 'list': {
      const rows = await pokerEvents().find(flags.org ? { org: flags.org } : {}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
      for (const e of rows) console.log(`${e.id}  ${e.org}  ${e.status}${e.paused ? ' (paused)' : ''}  phase ${phaseOf(e, now)}  "${e.name}"  game day ${dayOf(e.config.game.openFrom)}`);
      if (!rows.length) console.log('No events.');
      break;
    }
    case 'status': {
      const event = await load(flags.id);
      const results = await pokerResults().find({ eventId: event.id }, { projection: { _id: 0 } }).toArray();
      const board = boardOf(results, event.config);
      const picks = await pokerPicks().find({ eventId: event.id }, { projection: { _id: 0 } }).toArray();
      console.log(`${event.id} "${event.name}" at ${event.org}: ${event.status}${event.paused ? ' (paused)' : ''}, phase ${phaseOf(event, now)}`);
      console.log(times(event));
      const tables = new Set(results.map((r) => r.tableId));
      console.log(`\nTables finished: ${tables.size} (${results.filter((r) => r.round === 'open').length} open-play results, ${results.filter((r) => r.round === 'practice').length} practice)`);
      console.log('\nBoard (top 15):');
      for (const r of board.slice(0, 15)) console.log(`  ${String(r.rank).padStart(2)}. ${r.name.padEnd(24)} ${String(r.score).padStart(7)}  best ${r.best.join(' / ')}  tables ${r.played}  KOs ${r.knockouts}  ${r.office ?? ''}`);
      console.log('\nOffice league:');
      for (const o of officeLeague(board)) console.log(`  ${o.office.padEnd(14)} ${String(o.average).padStart(6)} avg  (${o.players} players)`);
      const name = (id: string) => board.find((r) => r.userId === id)?.name ?? id;
      for (const [label, stage] of [['Semifinals', event.semis], ['Final', event.final]] as const) {
        if (!stage) continue;
        console.log(`\n${label}: seeded, ${stage.startedAt ? `started ${new Date(stage.startedAt).toISOString()}` : 'not started'}${stage.endedAt ? ', over' : ''}`);
        for (const t of stage.tables) console.log(`  ${t.label}: ${t.players.map(name).join(', ')}${t.tableId ? `  (table ${t.tableId})` : ''}`);
      }
      if (event.champion) console.log(`\nChampion: ${event.champion.name}`);
      console.log(`\nPicks: ${picks.length} made by ${new Set(picks.map((p) => p.userId)).size} people; top: ${picksBoard(picks).slice(0, 5).map((p) => `${p.name} ${p.won}`).join(', ') || '—'}`);
      break;
    }
    case 'close-open': {
      const event = await load(flags.id);
      const config = structuredClone(event.config);
      config.game.openTo = new Date(now).toISOString();
      await set(event, { config });
      console.log(`Open play ends now; the server seeds the top ${config.semifinalists} within a second.`);
      break;
    }
    case 'reseed': {
      const event = await load(flags.id);
      if (event.semis?.startedAt) fail('The semifinals have started; they cannot be seeded again.');
      const results = await pokerResults().find({ eventId: event.id }, { projection: { _id: 0 } }).toArray();
      const semis = seedSemis(boardOf(results, event.config), event.config, now);
      await set(event, { semis, final: null });
      console.log(`Seeded: ${semis.tables.map((t) => `${t.label} ${t.players.length}`).join(', ')}`);
      break;
    }
    case 'start-semis': {
      const event = await load(flags.id);
      const config = structuredClone(event.config);
      if (now < Date.parse(config.game.openTo)) config.game.openTo = new Date(now).toISOString();
      config.game.semisAt = new Date(now).toISOString();
      await set(event, { config });
      console.log('The semifinals start within a second (seeded first if they were not).');
      break;
    }
    case 'start-final': {
      const event = await load(flags.id);
      if (!event.semis?.endedAt) fail('Both semifinals must be over first.');
      const config = structuredClone(event.config);
      config.game.finalAt = new Date(now).toISOString();
      await set(event, { config });
      console.log('The final starts within a second.');
      break;
    }
    case 'void': {
      const event = await load(flags.id);
      if (!flags.table) fail('--table is required');
      const r = await pokerResults().updateMany({ eventId: event.id, tableId: flags.table }, { $set: { voided: true } });
      console.log(`Voided ${r.modifiedCount} result(s) at table ${flags.table}.`);
      break;
    }
    case 'tv-link': {
      const event = await load(flags.id);
      if (!flags.base) fail('--base https://<api host> is required');
      const hours = Number(flags.hours ?? 12);
      const ticket = mintTicket({ userId: event.id, org: event.org, name: 'tv' }, { kind: 'poker-tv', ttlMs: hours * 3600_000 });
      console.log(`${flags.base.replace(/\/+$/, '')}/poker/tv/${event.id}?ticket=${encodeURIComponent(ticket)}`);
      console.log(`Good for ${hours} hours. Open it in a browser on the office screen; it watches only.`);
      break;
    }
    case 'post-standings': {
      const event = await load(flags.id);
      if (flags['dry-run']) {
        console.log((await standingsText(event, now)) ?? 'No scores yet: nothing to post.');
        break;
      }
      const id = await postStandings(event, now);
      console.log(id ? `Posted the standings to ${event.org}'s feed (${id}).` : 'No scores yet: nothing posted.');
      break;
    }
    case 'reset': {
      const event = await load(flags.id);
      const [r, p, h] = await Promise.all([
        pokerResults().deleteMany({ eventId: event.id }),
        pokerPicks().deleteMany({ eventId: event.id }),
        pokerHands().deleteMany({ eventId: event.id }),
      ]);
      await set(event, { semis: null, final: null, champion: null });
      console.log(`Reset ${event.id}: ${r.deletedCount} results, ${p.deletedCount} picks, ${h.deletedCount} hands removed; seeding cleared.`);
      break;
    }
    default:
      fail('Commands: create, update, on, off, pause, resume, end, list, status, close-open, reseed, start-semis, start-final, void, tv-link, post-standings, reset');
  }
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
