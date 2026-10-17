/**
 * Secret Squad, run from here: who plays in which office, and the sessions
 * (docs/secret-squad.md). Writing here is a production change: the database
 * is shared.
 *
 *   # Who plays where: a CSV of email,office or employeeId,office (a header row
 *   # is fine). --replace drops everyone not in the file from the org's office list.
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts offices convrse offices.csv [--replace]
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts offices-list convrse
 *
 *   # A session from its office's plan (services/secret-squad-packs.ts: HQ, Noida,
 *   # Kolkata, Gurgaon): squad sizes, hunt and break lengths and each round's
 *   # categories. With no --rounds the plan named like the office is used;
 *   # --plan <name> picks one for an office named differently.
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse HQ 2026-10-24T16:00+05:30 --post
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule convrse "Gurgaon 2" 2026-10-24T16:00+05:30 --plan Gurgaon
 *   # Or rounds by hand, as squadSize:huntMinutes[:breakMinutes] (categories then come from the whole bank):
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts schedule sowaka Gurgaon 2026-10-17T16:00+05:30 --rounds 5:8:1,2:3
 *   #   --lobby 5 (minutes, the default)  --post (the feed card)  --force (a plan for a very different head count)
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts edit <id> --at 2026-10-17T16:30+05:30 [--plan [name] | --rounds 5:8]
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts post <id>
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts list convrse
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts cancel <id>
 *   node --env-file=.env --import tsx src/scripts/secret-squad.ts packs
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { companies, connectDb, connectPosts, users } from '../config/db';
import { redisClient, redisReady } from '../config/redis';
import type { ConnectPost } from '../models/connect.model';
import type { SquadRoundConfig, SquadSchedule } from '../models/secret-squad.model';
import { SQUAD, cancelSession } from '../services/secret-squad-engine';
import { SQUAD_BANK, SQUAD_PLANS, SquadPlan, planNamed } from '../services/secret-squad-packs';
import {
  officeKey,
  officeMembers,
  roundConfig,
  squadOffices,
  squadSchedules,
} from '../services/secret-squad.service';
import { mutateSession, readSession } from '../services/secret-squad-store';

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const BOOLEAN_FLAGS = new Set(['replace', 'post', 'force']);
/** The word after `--plan` is its name unless it is another flag or a time. */
const takesPlanName = (next: string | undefined) => Boolean(next && !next.startsWith('--') && !/^\d{4}-\d{2}-\d{2}/.test(next));
/** `--plan` alone (the office's own plan) gives '', `--plan <name>` the name, no flag undefined. */
const planArg = (): string | undefined => {
  const at = args.indexOf('--plan');
  if (at < 0) return undefined;
  return takesPlanName(args[at + 1]) ? args[at + 1] : '';
};
const positional: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    if (args[i] === '--plan') {
      if (takesPlanName(args[i + 1])) i += 1;
      continue;
    }
    if (!BOOLEAN_FLAGS.has(args[i].slice(2))) i += 1;
    continue;
  }
  positional.push(args[i]);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const minutes = (value: string | undefined, fallbackMs: number) => {
  if (value === undefined) return fallbackMs;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(`"${value}" is not a number of minutes.`);
  return n * 60_000;
};

/** "10:8:1,5:8" → rounds (minutes may be decimals: 2:3:0.5 is a 30 s break). */
function parseRounds(spec: string): SquadRoundConfig[] {
  return spec.split(',').map((part) => {
    const [size, hunt, rest] = part.split(':').map((value) => value.trim());
    if (!/^\d+$/.test(size ?? '')) fail(`Round "${part}": squad size first, e.g. 5:17.`);
    const squadSize = Number(size);
    if (squadSize < SQUAD.minSquadSize || squadSize > SQUAD.maxSquadSize) {
      fail(`Round "${part}": squad size must be ${SQUAD.minSquadSize}–${SQUAD.maxSquadSize}.`);
    }
    return roundConfig({
      squadSize,
      huntMs: hunt ? minutes(hunt, SQUAD.defaults.huntMs) : undefined,
      breakMs: rest ? minutes(rest, SQUAD.defaults.breakMs) : undefined,
    });
  });
}

/** A plan's rounds as a session's: sizes, lengths and categories copied in. */
const roundsFromPlan = (plan: SquadPlan): SquadRoundConfig[] =>
  plan.rounds.map((round) => roundConfig({ squadSize: round.squadSize, huntMs: round.huntMs, breakMs: round.breakMs, categories: round.categories }));

/**
 * The rounds for a schedule: `--rounds` by hand, else `--plan <name>`, else
 * the plan named like the office. A plan written for a very different head
 * count is refused without --force (today's data still calls HQ "Gurgaon").
 */
function chooseRounds(office: string, people: number): { rounds: SquadRoundConfig[]; plan?: string } {
  const named = planArg();
  if (flag('rounds') !== undefined) {
    if (named !== undefined) fail('Give --rounds or --plan, not both.');
    return { rounds: parseRounds(flag('rounds')!) };
  }
  const plan = planNamed(named || office);
  if (!plan) {
    fail(`No plan is named "${named || office}". Plans: ${SQUAD_PLANS.map((p) => p.name).join(', ')}. Use --plan <name> or --rounds size:min[:break].`);
  }
  if ((people > plan.people * 2 || people * 2 < plan.people) && !has('force')) {
    fail(`The ${plan.name} plan is for about ${plan.people} people; ${office} has ${people}. Pick another with --plan <name>, or add --force.`);
  }
  return { rounds: roundsFromPlan(plan), plan: plan.name };
}

function parseTime(text: string | undefined): Date {
  const at = new Date(String(text ?? ''));
  if (Number.isNaN(at.getTime())) fail(`"${text ?? ''}" is not a time; use e.g. 2026-10-17T16:00+05:30.`);
  return at;
}

const ist = (at: Date | number) =>
  new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const clockOf = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`);
const describeRounds = (rounds: SquadRoundConfig[]) =>
  rounds.map((r, i) => `R${i + 1}: squads of ${r.squadSize}, ${clockOf(r.huntMs)}${i < rounds.length - 1 ? ` + ${clockOf(r.breakMs)} break` : ''}`
    + (r.categories?.length ? ` [${r.categories.length} categories: ${r.categories.slice(0, 3).join(', ')}${r.categories.length > 3 ? ', …' : ''}]` : ' [categories from the whole bank]')).join('\n');

async function requireOrg(org: string | undefined): Promise<string> {
  if (!org) fail('Name the company id, e.g. convrse.');
  if (!(await companies().findOne({ id: org }, { projection: { id: 1 } }))) fail(`No company "${org}".`);
  return org;
}

async function requireSchedule(id: string | undefined): Promise<SquadSchedule> {
  const schedule = id ? await squadSchedules().findOne({ id }) : null;
  if (!schedule) fail(`No session "${id ?? ''}". Run list to see them.`);
  return schedule;
}

/** When the session should be over: every round's dealing and hunt, and the breaks between. */
function estimatedEnd(schedule: SquadSchedule): Date {
  const total = schedule.rounds.reduce((sum, round, i) =>
    sum + SQUAD.dealMs + round.huntMs + (i < schedule.rounds.length - 1 ? round.breakMs : 0), 0);
  return new Date(schedule.startsAt.getTime() + total);
}

/** What an app from before the feed card shows: the post as text, with the web lobby's link. */
function fallbackText(schedule: SquadSchedule, webUrl: string): string {
  return `🎮 Secret Squad · ${schedule.office} · ${ist(schedule.startsAt)}\n`
    + 'Your word is a clue to find your secret squad. The lobby opens a few minutes before; everyone in it plays.\n'
    + `Play in the Games tab, or here: ${webUrl}`;
}

async function postCard(schedule: SquadSchedule): Promise<string> {
  const members = await officeMembers(schedule.org, schedule.office);
  if (members.length === 0) fail(`Nobody plays in ${schedule.office} yet: load the office list first.`);
  const company = await companies().findOne({ id: schedule.org }, { projection: { name: 1 } });
  const webUrl = process.env.SQUAD_WEB_URL ?? 'https://d3lwup4rvo6csf.cloudfront.net/squad';
  const now = new Date();
  const post: ConnectPost = {
    id: randomUUID(),
    org: schedule.org,
    type: 'secret_squad',
    tag: 'Secret Squad',
    tagIcon: '🕵️',
    tagColor: '#3A2E9E',
    tagTint: '#EEEAFF',
    // The company runs it; nobody's name or profile behind the card.
    author: { userId: '', name: company?.name ?? 'Your company', initials: 'S', designation: 'Games', avatarColor: '#3A2E9E' },
    audience: { label: schedule.office, org: schedule.org, userIds: members.map((member) => member.userId) },
    body: {
      sessionId: schedule.id,
      office: schedule.office,
      kicker: 'SQUAD HUNT',
      title: 'Secret Squad',
      subtitle: 'Your word is a clue to find your secret squad.',
      rewards: 'SURPRISE REWARDS',
      rewardsNote: 'For the top squads to link up',
      lobbyOpensAt: new Date(schedule.startsAt.getTime() - schedule.lobbyMs).toISOString(),
      startsAt: schedule.startsAt.toISOString(),
      rounds: schedule.rounds.map((round) => ({ squadSize: round.squadSize, huntMs: round.huntMs })),
      gameKey: 'secret-squad',
      webUrl,
      endsAt: estimatedEnd(schedule).toISOString(),
      status: 'scheduled',
      // Older apps draw an unknown post type as a plain post: this is what they show.
      text: fallbackText(schedule, webUrl),
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
  await squadSchedules().updateOne({ id: schedule.id }, { $set: { postId: post.id, updatedAt: now } });
  return post.id;
}

async function syncCard(schedule: SquadSchedule, status?: string): Promise<void> {
  if (!schedule.postId) return;
  await connectPosts().updateOne({ id: schedule.postId }, {
    $set: {
      'body.lobbyOpensAt': new Date(schedule.startsAt.getTime() - schedule.lobbyMs).toISOString(),
      'body.startsAt': schedule.startsAt.toISOString(),
      'body.rounds': schedule.rounds.map((round) => ({ squadSize: round.squadSize, huntMs: round.huntMs })),
      'body.endsAt': estimatedEnd(schedule).toISOString(),
      'body.text': fallbackText(schedule, process.env.SQUAD_WEB_URL ?? 'https://d3lwup4rvo6csf.cloudfront.net/squad'),
      ...(status ? { 'body.status': status } : {}),
      updatedAt: new Date(),
    },
  });
}

/** With Redis configured, live sessions are there: wait for it rather than miss them. */
async function storeReady(): Promise<void> {
  if (!process.env.REDIS_URL) return;
  redisClient();
  for (let i = 0; i < 50 && !redisReady(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!redisReady()) fail('Could not reach Redis, where live sessions are kept. Nothing was changed.');
}

(async () => {
  await connectDb();
  await storeReady();
  const by = userInfo().username;

  if (command === 'packs') {
    for (const entry of SQUAD_BANK) console.log(`${entry.category.padEnd(20)} ${entry.words.join(', ')}`);
    console.log(`${SQUAD_BANK.length} categories\n`);
    for (const plan of SQUAD_PLANS) console.log(`${plan.name} (~${plan.people} people)\n${describeRounds(roundsFromPlan(plan))}\n`);
    process.exit(0);
  }

  if (command === 'offices') {
    const org = await requireOrg(positional[0]);
    const file = positional[1] ?? fail('Give the CSV file: email,office per line.');
    const rows = readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))).filter((cells) => cells.length >= 2 && cells[0] && cells[1]);
    // A person by email, or by employee id (as HR lists them): whichever the first column holds.
    const lines = rows.filter((cells) => cells[0].includes('@') || /^[A-Za-z]{1,6}[-_]?\d+$/.test(cells[0]));
    const keyOf = (cell: string) => (cell.includes('@') ? cell.toLowerCase() : cell.toUpperCase());
    const emails = lines.filter((cells) => cells[0].includes('@')).map((cells) => cells[0].toLowerCase());
    const ids = lines.filter((cells) => !cells[0].includes('@')).map((cells) => cells[0].toUpperCase());
    const found = await users()
      .find({ org, $or: [{ email: { $in: emails } }, { employeeId: { $in: ids } }] })
      .project<{ userId: string; email: string; employeeId?: string }>({ _id: 0, userId: 1, email: 1, employeeId: 1 })
      .toArray();
    const byEmail = new Map<string, string>();
    for (const user of found) {
      byEmail.set(user.email.toLowerCase(), user.userId);
      if (user.employeeId) byEmail.set(user.employeeId.toUpperCase(), user.userId);
    }
    const missing = lines.map((cells) => keyOf(cells[0])).filter((key) => !byEmail.has(key));
    const now = new Date();
    const ops = lines.filter((cells) => byEmail.has(keyOf(cells[0]))).map((cells) => ({
      updateOne: {
        filter: { org, userId: byEmail.get(keyOf(cells[0]))! },
        update: { $set: { org, userId: byEmail.get(keyOf(cells[0]))!, office: cells[1], updatedAt: now } },
        upsert: true,
      },
    }));
    if (ops.length) await squadOffices().bulkWrite(ops);
    if (has('replace')) {
      const keep = [...new Set(byEmail.values())];
      const dropped = await squadOffices().deleteMany({ org, userId: { $nin: keep } });
      console.log(`Dropped ${dropped.deletedCount} not in the file.`);
    }
    const counts = new Map<string, number>();
    for (const cells of lines) if (byEmail.has(keyOf(cells[0]))) counts.set(cells[1], (counts.get(cells[1]) ?? 0) + 1);
    console.log(`Set ${ops.length} people: ${[...counts].map(([office, n]) => `${office} ${n}`).join(', ')}`);
    if (missing.length) console.log(`Not found in ${org} (${missing.length}): ${missing.join(', ')}`);
    process.exit(0);
  }

  if (command === 'offices-list') {
    const org = await requireOrg(positional[0]);
    const offices = new Set<string>();
    for (const row of await squadOffices().find({ org }).toArray()) offices.add(row.office);
    for (const user of await users().find({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }).project<{ location?: string }>({ location: 1 }).toArray()) {
      if (user.location?.trim()) offices.add(user.location.trim());
    }
    const seen = new Set<string>();
    for (const office of offices) {
      if (seen.has(officeKey(office))) continue;
      seen.add(officeKey(office));
      console.log(`${office.padEnd(16)} ${(await officeMembers(org, office)).length} people`);
    }
    process.exit(0);
  }

  if (command === 'schedule') {
    const org = await requireOrg(positional[0]);
    const office = positional[1] ?? fail('Name the office, e.g. Gurgaon.');
    const startsAt = parseTime(positional[2]);
    if (startsAt.getTime() < Date.now()) fail('That time has passed.');
    const members = await officeMembers(org, office);
    if (members.length === 0) fail(`Nobody plays in ${office} yet: load the office list (offices) or check the spelling.`);
    const { rounds, plan } = chooseRounds(office, members.length);
    const now = new Date();
    const schedule: SquadSchedule = {
      id: randomUUID(),
      org,
      office,
      startsAt,
      lobbyMs: minutes(flag('lobby'), SQUAD.defaults.lobbyMs),
      rounds,
      ...(plan ? { plan } : {}),
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
      createdBy: by,
    };
    await squadSchedules().insertOne(schedule);
    console.log(`Scheduled ${schedule.id}: ${office} (${members.length} people), ${ist(startsAt)}; lobby opens ${ist(startsAt.getTime() - schedule.lobbyMs)}.${plan ? ` Plan: ${plan}.` : ''}`);
    console.log(describeRounds(schedule.rounds));
    if (has('post')) console.log(`Feed card posted: ${await postCard(schedule)}`);
    process.exit(0);
  }

  if (command === 'edit') {
    const schedule = await requireSchedule(positional[0]);
    if (schedule.status !== 'scheduled') fail(`It is ${schedule.status}; only a session that hasn't opened can be edited.`);
    const set: Partial<SquadSchedule> = { updatedAt: new Date() };
    if (flag('at')) set.startsAt = parseTime(flag('at'));
    if (flag('rounds') !== undefined || planArg() !== undefined) {
      const { rounds, plan } = chooseRounds(schedule.office, (await officeMembers(schedule.org, schedule.office)).length);
      set.rounds = rounds;
      set.plan = plan;
    }
    if (flag('lobby')) set.lobbyMs = minutes(flag('lobby'), schedule.lobbyMs);
    await squadSchedules().updateOne({ id: schedule.id }, { $set: set });
    const updated = { ...schedule, ...set } as SquadSchedule;
    await syncCard(updated);
    console.log(`${updated.office}, ${ist(updated.startsAt)}.\n${describeRounds(updated.rounds)}`);
    process.exit(0);
  }

  if (command === 'post') {
    const schedule = await requireSchedule(positional[0]);
    if (schedule.postId) fail(`Already posted: ${schedule.postId}.`);
    console.log(`Feed card posted: ${await postCard(schedule)}`);
    process.exit(0);
  }

  if (command === 'list') {
    const org = await requireOrg(positional[0]);
    const rows = await squadSchedules().find({ org }).sort({ startsAt: -1 }).limit(20).toArray();
    for (const row of rows) {
      const live = row.status === 'opened' ? await readSession(org, row.id) : null;
      console.log(`${row.id}  ${row.office.padEnd(10)} ${ist(row.startsAt).padEnd(24)} ${(live?.status ?? row.status).padEnd(10)} ${row.postId ? 'card ' : '     '}${row.plan ? `plan ${row.plan}` : 'by hand'}\n${describeRounds(row.rounds)}`);
    }
    process.exit(0);
  }

  if (command === 'cancel') {
    const schedule = await requireSchedule(positional[0]);
    if (schedule.status === 'scheduled') {
      await squadSchedules().updateOne({ id: schedule.id }, { $set: { status: 'cancelled', updatedAt: new Date() } });
    } else if (schedule.status === 'opened') {
      const live = await mutateSession(schedule.org, schedule.id, (session) => {
        if (session.status === 'over' || session.status === 'cancelled') return null;
        cancelSession(session, 'Called off', Date.now());
        return true;
      });
      if (!live) {
        const held = await readSession(schedule.org, schedule.id);
        if (!held) fail('This session is not live in this store (is REDIS_URL the same as the servers\'?). Nothing was changed.');
        if (held.status === 'over') fail('This session has already ended.');
      }
      await squadSchedules().updateOne({ id: schedule.id }, { $set: { status: 'cancelled', updatedAt: new Date() } });
    }
    await syncCard(schedule, 'cancelled');
    console.log(`Cancelled ${schedule.id} (${schedule.office}).`);
    process.exit(0);
  }

  fail('Commands: offices, offices-list, schedule, edit, post, list, cancel, packs.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
