/**
 * The Diwali Cup's events, set up from here: every time, rule and switch in
 * one place. An event is created switched OFF; nothing happens and no page
 * shows it until `on`.
 *
 *   # A test in sowaka, squeezed into minutes: lobby in 2 min, round 1 in 4 min,
 *   # short windows, 15-second rounds, top 4 one at a time:
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts create --id cup-test-sowaka --org sowaka --name "Test Cup" \
 *     --lobby +2m --start +4m --link-base http://localhost:4311 --top-n 4 \
 *     --start-window 40 --solo-start 30 --betting 20 --round 15 --min-play 8
 *
 *   # The real one (times in IST), switched on later by hand:
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts create --id diwali-cup-2026 --org convrse \
 *     --name "Diwali Cup" --lobby 2026-10-23T17:25+05:30 --start 2026-10-23T17:30+05:30 \
 *     --link-base https://d3lwup4rvo6csf.cloudfront.net --exclude <supportUserId>
 *
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts on  --id diwali-cup-2026
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts off --id diwali-cup-2026   # pauses everything; on again resumes, nobody losing time
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts update --id diwali-cup-2026 --start 2026-10-23T17:40+05:30
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts status --id diwali-cup-2026
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts list
 *   # Who looks like a Support account (name, designation, email), to put in --exclude:
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts support-candidates --org convrse
 *   # The feed post (a live_game post whose button opens the Cup, signed per viewer):
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts post --id diwali-cup-2026 [--title ..] [--subtitle ..]
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts unpost --id diwali-cup-2026
 *   # Sowaka only: back to before the draw (bets refunded), or gone altogether:
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts reset --id cup-test-sowaka
 *   node --env-file=.env --import tsx src/scripts/cup-event.ts remove --id cup-test-sowaka
 *
 * Options (create and update): --name --lobby --start --link-base --link-until
 * --exclude id,id --include id,id (a test: only these) --seeding leaderboard|lucky
 * --top-n N --start-window S --solo-start S --betting S --countdown S --round S
 * --grace S --min-play S --max-score N --max-replays N --max-stake N --push-at-lobby true|false
 * Times: ISO with an offset (2026-10-23T17:25+05:30), or +Nm / +Ns from now.
 */
import { randomUUID } from 'node:crypto';
import { companies, connectDb, connectPosts, closeDb, gameCatalog, users } from '../config/db';
import type { CupEvent, CupEventConfig, CupSeeding } from '../models/cup.model';
import type { ConnectPost } from '../models/connect.model';
import { DEFAULT_CUP_CONFIG } from '../services/cup-rules';
import { newSeed } from '../services/game-challenge-rules';
import { cupBets, cupEvents, cupMatches, rosterOf } from '../services/cup.service';
import { pointEvents } from '../services/points-ledger.service';

type Flags = Record<string, string>;

function parse(argv: string[]): { command: string; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    flags[key] = value;
    i += 1;
  }
  return { command, flags };
}

function time(raw: string, name: string): Date {
  const rel = /^\+(\d+(?:\.\d+)?)([sm])$/.exec(raw);
  if (rel) return new Date(Date.now() + Number(rel[1]) * (rel[2] === 'm' ? 60_000 : 1000));
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(raw)) throw new Error(`--${name} needs a time zone, e.g. 2026-10-23T17:25+05:30`);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`--${name} is not a time: ${raw}`);
  return date;
}

const ids = (raw: string) => raw.split(',').map((id) => id.trim()).filter(Boolean);

function int(raw: string, name: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}

const NUMBER_FLAGS: Record<string, [keyof CupEventConfig, number, number]> = {
  'top-n': ['topN', 2, 64],
  'start-window': ['startWindowSec', 10, 1800],
  'solo-start': ['soloStartSec', 10, 1800],
  betting: ['bettingSec', 5, 600],
  countdown: ['countdownSec', 2, 15],
  round: ['roundSec', 10, 300],
  grace: ['finishGraceSec', 5, 300],
  'min-play': ['minPlaySec', 0, 300],
  'max-score': ['maxScore', 100, 1_000_000],
  'max-replays': ['maxReplays', 0, 10],
  'max-stake': ['maxStake', 0, 1_000_000],
};

/** The fields the flags set. */
function fieldsFrom(flags: Flags): Partial<CupEvent> {
  const set: Partial<CupEvent> & Record<string, unknown> = {};
  if (flags.name) set.name = flags.name.slice(0, 60);
  if (flags.lobby) set.lobbyAt = time(flags.lobby, 'lobby');
  if (flags.start) set.startAt = time(flags.start, 'start');
  if (flags['link-until']) set.linkUntil = time(flags['link-until'], 'link-until');
  if (flags['link-base']) {
    const base = flags['link-base'].replace(/\/+$/, '');
    if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(base)) throw new Error('--link-base must be https://host (or a localhost address for a test)');
    set.linkBase = base;
  }
  if (flags.exclude !== undefined) set.excludeUserIds = flags.exclude === 'none' ? [] : ids(flags.exclude);
  if (flags.include !== undefined) set.includeUserIds = flags.include === 'none' ? [] : ids(flags.include);
  if (flags.seeding) {
    if (flags.seeding !== 'leaderboard' && flags.seeding !== 'lucky') throw new Error('--seeding is leaderboard or lucky');
    set.seeding = flags.seeding as CupSeeding;
  }
  if (flags['push-at-lobby']) set.pushAtLobby = flags['push-at-lobby'] === 'true';
  for (const [flag, [field, min, max]] of Object.entries(NUMBER_FLAGS)) {
    if (flags[flag] !== undefined) (set as Record<string, unknown>)[field] = int(flags[flag], flag, min, max);
  }
  return set;
}

function check(event: Pick<CupEvent, 'lobbyAt' | 'startAt' | 'linkUntil' | 'roundSec' | 'minPlaySec'>) {
  if (event.startAt.getTime() < event.lobbyAt.getTime()) throw new Error('Round 1 (--start) must not be before the lobby (--lobby)');
  if (event.linkUntil.getTime() <= event.startAt.getTime()) throw new Error('--link-until must be after the start');
  if (event.minPlaySec >= event.roundSec) throw new Error('--min-play must be shorter than --round');
}

const ist = (date: Date) =>
  date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) + ' IST';

async function requireEvent(id: string | undefined): Promise<CupEvent> {
  if (!id) throw new Error('--id is required');
  const event = await cupEvents().findOne({ id }, { projection: { _id: 0 } });
  if (!event) throw new Error(`No event ${id}`);
  return event;
}

async function describe(event: CupEvent) {
  const roster = event.entrants?.length ? null : await rosterOf(event);
  console.log(`${event.id} · ${event.name} · org ${event.org} · ${event.active ? 'ON' : 'OFF'} · phase ${event.phase}, round ${event.round}`);
  console.log(`  lobby ${ist(event.lobbyAt)} · round 1 ${ist(event.startAt)} · links until ${ist(event.linkUntil)}`);
  console.log(`  link base ${event.linkBase} · seeding ${event.seeding} · top ${event.topN} one at a time`);
  console.log(
    `  start window ${event.startWindowSec}s · solo start ${event.soloStartSec}s · betting ${event.bettingSec}s · countdown ${event.countdownSec}s · round ${event.roundSec}s (+${event.finishGraceSec}s grace, min ${event.minPlaySec}s) · max score ${event.maxScore} · replays ${event.maxReplays} · max stake ${event.maxStake || 'balance'}`,
  );
  console.log(`  excluded ${event.excludeUserIds.length} · ${event.includeUserIds.length ? `only ${event.includeUserIds.length} named people` : 'everyone active'}`);
  if (roster) console.log(`  would enter ${roster.length} people now (${roster.filter((r) => r.best != null).length} with a leaderboard score)`);
  else console.log(`  drawn ${event.drawnAt ? ist(event.drawnAt) : ''}: ${event.entrants.length} entrants, ${event.rounds.length} rounds`);
  if (event.championId) console.log(`  champion ${event.entrants.find((e) => e.userId === event.championId)?.name ?? event.championId}`);
  const matches = await cupMatches().countDocuments({ eventId: event.id });
  const bets = await cupBets().countDocuments({ eventId: event.id });
  console.log(`  ${matches} matches · ${bets} bets`);
}

/**
 * Undoes every point a test event's bets moved: each person's ledger rows for
 * its matches (refId `<eventId>-r…`) summed, taken back off their balance,
 * and the rows deleted. Sowaka only.
 */
async function revertBetPoints(event: CupEvent): Promise<string> {
  const rows = await pointEvents().find({ org: event.org, source: 'cup_bet', refId: { $regex: `^${event.id}-r` } }).toArray();
  const net = new Map<string, number>();
  for (const row of rows) net.set(row.userId, (net.get(row.userId) ?? 0) + row.delta);
  for (const [userId, delta] of net) if (delta !== 0) await users().updateOne({ userId }, { $inc: { points: -delta } });
  await pointEvents().deleteMany({ _id: { $in: rows.map((row) => (row as unknown as { _id: never })._id) } });
  return `${rows.length} bet ledger rows reverted for ${net.size} people.`;
}

/**
 * Back on after a pause mid-tournament: nobody loses time to it. Every
 * window still running when it was paused (betting lobby, start window, a
 * lone player's start) moves on by the pause; a round that was being played
 * starts again from the start window on new boards (the pages lost it while
 * the Cup was off), and its bets ride. Round 1's start moves on too, from a
 * lobby. Done while still switched off, so no runner or page moves meanwhile.
 */
async function resume(event: CupEvent, now: Date): Promise<string> {
  const paused = now.getTime() - new Date(event.pausedAt!).getTime();
  const later = (date: Date | undefined) => (date ? new Date(new Date(date).getTime() + paused) : date);
  const pausedMs = new Date(event.pausedAt!).getTime();
  let moved = 0;
  let restarted = 0;
  if (event.phase === 'lobby' && event.startAt.getTime() > pausedMs) {
    await cupEvents().updateOne({ id: event.id }, { $set: { startAt: later(event.startAt)! } });
  }
  const open = await cupMatches().find({ eventId: event.id, status: { $in: ['betting', 'open', 'live', 'solo'] } }, { projection: { _id: 0 } }).toArray();
  for (const m of open) {
    const where = { id: m.id, status: m.status, attempt: m.attempt };
    const playing = (m.status === 'live' || m.status === 'solo') && m.startAt;
    if (playing) {
      // A round that had run out before the pause is decided from what came in, as usual.
      if (new Date(m.startAt!).getTime() + (event.roundSec + event.finishGraceSec) * 1000 <= pausedMs) continue;
      await cupMatches().updateOne(where, {
        $set: { status: 'open', seed: newSeed(), joined: {}, live: {}, finals: {}, openedAt: now, deadlineAt: new Date(now.getTime() + event.startWindowSec * 1000), updatedAt: now },
        $unset: { startAt: '', soloUntil: '' },
        $inc: { attempt: 1 },
      });
      restarted += 1;
      continue;
    }
    const set: Record<string, Date> = { updatedAt: now };
    if (m.status === 'betting' && m.bettingEndsAt) set.bettingEndsAt = later(m.bettingEndsAt)!;
    if (m.status === 'open' && m.deadlineAt) set.deadlineAt = later(m.deadlineAt)!;
    if (m.status === 'solo' && m.soloUntil) set.soloUntil = later(m.soloUntil)!;
    await cupMatches().updateOne(where, { $set: set });
    moved += 1;
  }
  return `Paused ${Math.round(paused / 1000)}s: ${moved} match clocks moved on, ${restarted} rounds in play restarted${event.phase === 'lobby' ? ', round 1 moved on' : ''}.`;
}

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  await connectDb();
  const now = new Date();
  switch (command) {
    case 'create': {
      if (!flags.id || !/^[A-Za-z0-9_-]{1,80}$/.test(flags.id)) throw new Error('--id is required: letters, digits, - and _');
      if (!flags.org) throw new Error('--org is required');
      if (!flags.name || !flags.lobby || !flags.start || !flags['link-base']) throw new Error('--name, --lobby, --start and --link-base are required');
      if (!(await companies().findOne({ id: flags.org }))) throw new Error(`No company ${flags.org}`);
      if (await cupEvents().findOne({ id: flags.id })) throw new Error(`${flags.id} exists: use update`);
      const fields = fieldsFrom(flags);
      // The game's own ceiling, as its catalog entry says, unless given.
      const game = await gameCatalog().findOne({ key: fields.gameKey ?? DEFAULT_CUP_CONFIG.gameKey }, { projection: { _id: 0, scoring: 1 } });
      const event: CupEvent = {
        ...DEFAULT_CUP_CONFIG,
        ...(game?.scoring?.max ? { maxScore: game.scoring.max } : {}),
        id: flags.id,
        org: flags.org,
        name: flags.name.slice(0, 60),
        active: false,
        lobbyAt: fields.lobbyAt!,
        startAt: fields.startAt!,
        linkUntil: new Date(fields.startAt!.getTime() + 6 * 60 * 60 * 1000),
        linkBase: fields.linkBase!,
        phase: 'scheduled',
        round: 0,
        entrants: [],
        rounds: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...fields,
      };
      check(event);
      // `_id` is the event id: the primary key keeps it unique (no index on `id` is made on the shared cluster).
      await cupEvents().insertOne({ _id: event.id, ...event } as unknown as CupEvent);
      console.log('Created, switched OFF:');
      await describe(event);
      break;
    }
    case 'update': {
      const event = await requireEvent(flags.id);
      const fields = fieldsFrom(flags);
      const structural = ['excludeUserIds', 'includeUserIds', 'seeding', 'topN', 'lobbyAt'] as const;
      if (event.phase !== 'scheduled' && structural.some((f) => f in fields)) {
        throw new Error(`The draw is made: ${structural.join(', ')} can no longer change (reset first, in a test)`);
      }
      const next = { ...event, ...fields };
      check(next);
      await cupEvents().updateOne({ id: event.id }, { $set: { ...fields, updatedAt: now }, $inc: { version: 1 } });
      await describe(next);
      break;
    }
    case 'off': {
      const event = await requireEvent(flags.id);
      const midway = event.active && (event.phase === 'lobby' || event.phase === 'running');
      await cupEvents().updateOne(
        { id: event.id },
        { $set: { active: false, updatedAt: now, ...(midway && !event.pausedAt ? { pausedAt: now } : {}) }, $inc: { version: 1 } },
      );
      console.log(`${event.id} is OFF${midway ? ': paused; every clock moves on by the pause when it is switched on again' : ''}`);
      break;
    }
    case 'on': {
      const event = await requireEvent(flags.id);
      if (event.pausedAt && (event.phase === 'lobby' || event.phase === 'running')) console.log(`  ${await resume(event, now)}`);
      await cupEvents().updateOne({ id: event.id }, { $set: { active: true, updatedAt: now }, $unset: { pausedAt: '' }, $inc: { version: 1 } });
      console.log(`${event.id} is ON`);
      if (event.lobbyAt.getTime() < now.getTime() && event.phase === 'scheduled') {
        console.log('  Note: the lobby time has passed, so the draw is made on the runner\'s next tick.');
      }
      break;
    }
    case 'status':
      await describe(await requireEvent(flags.id));
      break;
    case 'list':
      for (const event of await cupEvents().find({}, { projection: { _id: 0 } }).sort({ lobbyAt: -1 }).toArray()) {
        console.log(`${event.id} · ${event.org} · ${event.active ? 'ON' : 'OFF'} · ${event.phase} · lobby ${ist(event.lobbyAt)}`);
      }
      break;
    case 'support-candidates': {
      if (!flags.org) throw new Error('--org is required');
      const rows = await users()
        .find(
          {
            org: flags.org,
            lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
            $or: [{ name: /support|help ?desk|sowaka/i }, { designation: /support|help ?desk/i }, { email: /support|helpdesk|sowaka/i }],
          },
          { projection: { _id: 0, userId: 1, name: 1, designation: 1, email: 1 } },
        )
        .toArray();
      for (const row of rows) console.log(`${row.userId}  ${row.name}  ·  ${row.designation ?? ''}  ·  ${row.email}`);
      console.log(`${rows.length} found. Pass the right ones as --exclude id,id`);
      break;
    }
    case 'post': {
      const event = await requireEvent(flags.id);
      const existing = await connectPosts().findOne({ org: event.org, type: 'live_game', 'body.cupEventId': event.id });
      if (existing) throw new Error(`Already posted (${existing.id}); unpost first`);
      const post: ConnectPost = {
        id: randomUUID(),
        org: event.org,
        type: 'live_game',
        tag: 'Live Game',
        tagIcon: '🪔',
        tagColor: '#E0483B',
        tagTint: '#FBE2DE',
        // Faceless, like the Games announcements: nobody to tap through to.
        author: { userId: '', name: 'Sowaka Engagements', initials: 'S', designation: 'Games', avatarColor: '#F5B82E' },
        audience: { label: 'Company', org: event.org },
        body: {
          gameId: event.id,
          cupEventId: event.id,
          cupLinkBase: event.linkBase,
          cupLinkUntil: event.linkUntil.toISOString(),
          title: flags.title ?? event.name,
          subtitle: flags.subtitle ?? 'Everyone is in. One Odd One Out knockout, live, with bets on the last eight.',
          startsAtLabel: flags['starts-label'] ?? `LOBBY OPENS ${event.lobbyAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`,
          actionLabel: flags.action ?? 'Open the Cup',
          actionDoneLabel: flags.action ?? 'Open the Cup',
          hostedUrl: '',
          accentColor: '#F5B82E',
          leaderboardEnabled: false,
        },
        likedBy: [],
        comments: [],
        actionBy: {},
        pollVotes: {},
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      } as ConnectPost;
      await connectPosts().insertOne(post);
      console.log(`Posted ${post.id} to ${event.org}'s feed (no push sent).`);
      break;
    }
    case 'unpost': {
      const event = await requireEvent(flags.id);
      const result = await connectPosts().deleteMany({ org: event.org, type: 'live_game', 'body.cupEventId': event.id });
      console.log(`Removed ${result.deletedCount} post(s).`);
      break;
    }
    case 'reset':
    case 'remove': {
      const event = await requireEvent(flags.id);
      if (event.org !== 'sowaka') throw new Error(`${command} is for sowaka test events only`);
      const reverted = await revertBetPoints(event);
      await cupBets().deleteMany({ eventId: event.id });
      await cupMatches().deleteMany({ eventId: event.id });
      if (command === 'remove') {
        await connectPosts().deleteMany({ org: event.org, type: 'live_game', 'body.cupEventId': event.id });
        await cupEvents().deleteOne({ id: event.id });
        console.log(`Removed ${event.id}; ${reverted}`);
      } else {
        await cupEvents().updateOne(
          { id: event.id },
          { $set: { phase: 'scheduled', round: 0, entrants: [], rounds: [], updatedAt: now }, $unset: { drawnAt: '', championId: '', finishedAt: '', pausedAt: '' }, $inc: { version: 1 } },
        );
        console.log(`Reset ${event.id} to before the draw (times unchanged: update them); ${reverted}`);
      }
      break;
    }
    default:
      console.log('Commands: create update on off status list support-candidates post unpost reset remove. See the top of this file.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
