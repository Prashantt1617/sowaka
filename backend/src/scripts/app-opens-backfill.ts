/**
 * Fills the App usage page's days before app opens were tracked.
 *
 * `appActivity` (services/app-activity.service) holds one row per person per
 * IST day they used the app, written from the app's own requests. It only
 * started on the day it shipped, so every earlier day reads "not tracked".
 * This script writes rows for those earlier days from things the server
 * already keeps that only the person's app could have done, each with its own
 * time and person:
 *
 *   punch     a punch in from the app (`attendance_records` the punch wrote,
 *             `manual|…`), a punch out with the phone's location; biometric
 *             imports, HR's calendar marks and approved fixes are left out
 *   request   leave, overtime, reimbursement (FBP bills too) and attendance
 *             fix requests raised, a leave cancelled, an investment proof
 *             uploaded: only the employee's own app raises these
 *   manager   a team request approved or declined from the app (decidedByRole
 *             'manager'; 'admin' is the dashboard), a feedback review written,
 *             a recognition nomination
 *   feed      a post the person wrote (not the server's cards or contests,
 *             which the dashboard can publish), a comment, a contest entry,
 *             a report, a block, an audience list
 *   games     a finished game or cup bet (points ledger), a best score, a
 *             challenge sent, started or finished, a cup match joined, a
 *             poker hand dealt in, a Hint Relay or Secret Squad round
 *   inbox     a notification opened in the app's inbox
 *   device    the app registering its push token (iOS and Android only)
 *   face      a face check set up or taken at a punch
 *   support   a help ticket raised or answered by the employee
 *   care      a gratitude note, a Care writing, a counselling session booked
 *   signin    signing in, for people without dashboard access (the dashboard
 *             signs in through the same door, so its users are left out)
 *
 * Left out, because they cannot be put on a day or told apart from the
 * dashboard: likes, poll and contest votes (no time kept), profile and photo
 * edits, HR's edits and imports, Suwi, KPI assignments, last-login and
 * last-seen fields (only the latest is kept), and anything seeded for a demo.
 *
 * These are estimates and undercount: someone who only looked at the app
 * leaves none of these behind. `--compare` measures how many of the people the
 * real tracking saw on its first days these signals would have caught.
 *
 * Rows it writes carry `inferred: true` and `sources`, so the page can mark
 * those days as estimated and `--undo` can take them away again. It never
 * writes a day on or after the first really tracked day (anywhere), and never
 * changes a real row: a person with a real row on a day keeps it as it is.
 * Running it again refreshes its own rows and adds nothing twice.
 *
 * Run from backend/ with the server's .env (MONGODB_URI, MONGODB_DB). It opens
 * its own connection and builds no indexes, so a dry run only reads.
 *
 *   node dist/scripts/app-opens-backfill.js                  # dry run: what it would write, per org per day
 *   node dist/scripts/app-opens-backfill.js --compare        # also: how well the signals match the tracked days
 *   node dist/scripts/app-opens-backfill.js --apply          # write the rows
 *   node dist/scripts/app-opens-backfill.js --undo           # dry run of taking the estimated rows away
 *   node dist/scripts/app-opens-backfill.js --undo --apply   # take them away
 *
 *   --from=YYYY-MM-DD   first IST day (default: 120 days before tracking began)
 *   --to=YYYY-MM-DD     last IST day (default and ceiling: the day before tracking began)
 *   --org=a,b           only these companies
 *   --samples=n         rows shown per org in a dry run (default 3)
 *
 * In a checkout without a build: `npm run app-opens:backfill -- --compare`.
 */
import { MongoClient, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import { env } from '../config/env';

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

export type Group = 'punch' | 'request' | 'manager' | 'feed' | 'games' | 'inbox' | 'device' | 'face' | 'support' | 'care' | 'signin';
export const GROUPS: Group[] = ['punch', 'request', 'manager', 'feed', 'games', 'inbox', 'device', 'face', 'support', 'care', 'signin'];

/** One signal: a collection, and a pipeline that hands back `{ u, t }` (person, moment) for moments in [start, end). */
type Source = { key: string; group: Group; collection: string; pipeline: (start: Date, end: Date) => Document[] };

/** Leaves stamp `createdAt` as epoch milliseconds; elsewhere it is a Date. */
const asDate = (field: string) => ({ $cond: [{ $eq: [{ $type: field }, 'date'] }, field, { $toDate: field }] });
const notDemo = { demoSeed: { $exists: false } };

/** The last steps of every pipeline: person and moment, kept when both are there and in range. */
function out(u: unknown, t: unknown, start: Date, end: Date): Document[] {
  return [
    { $project: { _id: 0, u, t } },
    { $match: { u: { $type: 'string' }, t: { $gte: start, $lt: end } } },
  ];
}
/** A `{ userId: Date }` field, one row per person in it. */
function mapField(field: string, start: Date, end: Date, pre: Document[] = []): Document[] {
  return [
    ...pre,
    { $project: { _id: 0, m: { $objectToArray: { $ifNull: [field, {}] } } } },
    { $unwind: '$m' },
    ...out('$m.k', '$m.v', start, end),
  ];
}
const simple = (key: string, group: Group, collection: string, user: string, time: string, extra: Document = {}): Source => ({
  key, group, collection,
  pipeline: (start, end) => [{ $match: { ...notDemo, ...extra, [time]: { $gte: start, $lt: end } } }, ...out(`$${user}`, `$${time}`, start, end)],
});
const CONTEST_TYPES = ['caption_challenge', 'photo_story_challenge', 'most_likely'];
/** Posts the server writes on its own (celebrations, game and tournament cards). */
const AUTO_TYPES = ['birthday', 'anniversary', 'new_joinee', 'game_launch', 'live_game', 'relay_game', 'secret_squad'];

export const SOURCES: Source[] = [
  // ── punch ──
  // Only the app's punch writes `manual|…` keys (an approved fix writes `regularization|…`).
  simple('punch-in', 'punch', 'attendance_records', 'userId', 'punchIn', { sourceKey: /^manual\|/ }),
  // A punch out carries the phone's location; a fix's shift hours do not.
  simple('punch-out', 'punch', 'attendance_records', 'userId', 'punchOut', { punchOutLocation: { $exists: true } }),
  // ── request ──
  simple('fix-request', 'request', 'attendance_regularizations', 'userId', 'createdAt'),
  // A punch out taken while the day waits as an out-of-location or face-check request.
  // (A correction's punch times are what the person claimed, not when they asked: left out.)
  simple('fix-request-punch-out', 'request', 'attendance_regularizations', 'userId', 'punchOut', { kind: { $in: ['out_of_location', 'face_check'] } }),
  {
    key: 'leave', group: 'request', collection: 'leaves',
    pipeline: (start, end) => [
      { $match: { ...notDemo, $or: [{ createdAt: { $gte: start.getTime(), $lt: end.getTime() } }, { createdAt: { $gte: start, $lt: end } }] } },
      ...out('$userId', asDate('$createdAt'), start, end),
    ],
  },
  simple('leave-cancel-asked', 'request', 'leaves', 'userId', 'cancelRequest.requestedAt'),
  // A pending leave the person took back themselves (no cancellation request to decide).
  simple('leave-cancelled', 'request', 'leaves', 'userId', 'cancelledAt', { cancelRequest: { $exists: false } }),
  simple('overtime', 'request', 'overtime_requests', 'userId', 'createdAt'),
  simple('reimbursement', 'request', 'reimbursement_claims', 'userId', 'createdAt'),
  simple('investment-proof', 'request', 'investment_proofs', 'userId', 'uploadedAt'),
  // ── manager ──
  simple('leave-decided', 'manager', 'leaves', 'decidedByUserId', 'decidedAt', { decidedByRole: 'manager' }),
  simple('leave-cancel-decided', 'manager', 'leaves', 'cancelRequest.decidedByUserId', 'cancelRequest.decidedAt', { 'cancelRequest.decidedByRole': 'manager' }),
  simple('overtime-decided', 'manager', 'overtime_requests', 'decidedByUserId', 'decidedAt', { decidedByRole: 'manager' }),
  simple('fix-decided', 'manager', 'attendance_regularizations', 'decidedByUserId', 'decidedAt', { decidedByRole: 'manager' }),
  simple('review-started', 'manager', 'feedback_records', 'managerUserId', 'createdAt'),
  simple('review-edited', 'manager', 'feedback_records', 'managerUserId', 'updatedAt'),
  simple('review-sent', 'manager', 'feedback_records', 'managerUserId', 'sentAt'),
  simple('nomination', 'manager', 'recognition_nominations', 'managerUserId', 'createdAt'),
  simple('nomination-edited', 'manager', 'recognition_nominations', 'managerUserId', 'updatedAt'),
  // ── feed ──
  {
    key: 'post', group: 'feed', collection: 'connect_posts',
    pipeline: (start, end) => [
      {
        $match: {
          ...notDemo, createdAt: { $gte: start, $lt: end }, systemKey: { $exists: false },
          type: { $nin: [...AUTO_TYPES, ...CONTEST_TYPES] }, 'author.designation': { $not: /^Auto/ },
        },
      },
      ...out('$author.userId', '$createdAt', start, end),
    ],
  },
  {
    key: 'comment', group: 'feed', collection: 'connect_posts',
    pipeline: (start, end) => [
      { $match: { ...notDemo, 'comments.createdAt': { $gte: start, $lt: end } } },
      { $project: { _id: 0, c: '$comments' } },
      { $unwind: '$c' },
      ...out('$c.userId', '$c.createdAt', start, end),
    ],
  },
  {
    key: 'contest-entry', group: 'feed', collection: 'connect_posts',
    pipeline: (start, end) => [
      { $match: { ...notDemo, 'captionEntries.createdAt': { $gte: start, $lt: end } } },
      { $project: { _id: 0, c: '$captionEntries' } },
      { $unwind: '$c' },
      ...out('$c.userId', '$c.createdAt', start, end),
    ],
  },
  simple('report', 'feed', 'content_reports', 'reporterUserId', 'createdAt'),
  simple('block', 'feed', 'connect_blocks', 'userId', 'createdAt'),
  simple('audience-list', 'feed', 'audience_lists', 'ownerUserId', 'createdAt'),
  simple('audience-list-edited', 'feed', 'audience_lists', 'ownerUserId', 'updatedAt'),
  // ── games ──
  simple('game-points', 'games', 'point_events', 'userId', 'createdAt', { reason: { $in: ['game', 'bet_placed'] } }),
  simple('best-score', 'games', 'game_scores', 'userId', 'achievedAt'),
  simple('launch-score', 'games', 'game_launch_scores', 'userId', 'achievedAt'),
  simple('challenge-sent', 'games', 'game_challenges', 'challengerUserId', 'createdAt'),
  {
    key: 'challenge-started', group: 'games', collection: 'game_challenges',
    pipeline: (start, end) => mapField('$started', start, end, [{ $match: { started: { $exists: true }, createdAt: { $lt: end } } }]),
  },
  {
    key: 'challenge-finished', group: 'games', collection: 'game_challenges',
    pipeline: (start, end) => [
      { $match: { createdAt: { $lt: end }, updatedAt: { $gte: start } } },
      { $project: { _id: 0, m: { $objectToArray: { $ifNull: ['$scores', {}] } } } },
      { $unwind: '$m' },
      ...out('$m.k', '$m.v.finishedAt', start, end),
    ],
  },
  {
    key: 'cup-joined', group: 'games', collection: 'cup_matches',
    pipeline: (start, end) => mapField('$joined', start, end, [{ $match: { createdAt: { $lt: end } } }]),
  },
  simple('cup-bet', 'games', 'cup_bets', 'userId', 'placedAt'),
  {
    key: 'poker-hand', group: 'games', collection: 'poker_hands',
    pipeline: (start, end) => [
      { $match: { at: { $gte: start, $lt: end } } },
      { $project: { _id: 0, at: 1, p: '$players' } },
      { $unwind: '$p' },
      ...out('$p.userId', '$at', start, end),
    ],
  },
  simple('poker-result', 'games', 'poker_results', 'userId', 'at', { voided: { $ne: true } }),
  simple('relay-seen', 'games', 'relay_presence', 'userId', 'lastSeenAt'),
  {
    key: 'squad-round', group: 'games', collection: 'secret_squad_payouts',
    pipeline: (start, end) => [
      { $match: { paidAt: { $gte: start, $lt: end } } },
      { $project: { _id: 0, at: '$paidAt', m: { $objectToArray: { $ifNull: ['$points', {}] } } } },
      { $unwind: '$m' },
      ...out('$m.k', '$at', start, end),
    ],
  },
  simple('squad-office', 'games', 'secret_squad_offices', 'userId', 'updatedAt'),
  // ── inbox, device, face ──
  simple('inbox-read', 'inbox', 'notifications', 'userId', 'readAt'),
  simple('push-token', 'device', 'device_tokens', 'userId', 'createdAt', { platform: { $in: ['ios', 'android'] } }),
  simple('push-token-refresh', 'device', 'device_tokens', 'userId', 'updatedAt', { platform: { $in: ['ios', 'android'] } }),
  simple('face-check', 'face', 'face_verifications', 'userId', 'at'),
  simple('face-phone', 'face', 'face_phone_logs', 'userId', 'at'),
  // ── support, care ──
  simple('ticket', 'support', 'support_tickets', 'requesterUserId', 'createdAt'),
  {
    key: 'ticket-reply', group: 'support', collection: 'support_messages',
    pipeline: (start, end) => [
      { $match: { side: 'employee', createdAt: { $gte: start, $lt: end } } },
      { $lookup: { from: 'support_tickets', localField: 'ticketId', foreignField: 'id', as: 't', pipeline: [{ $project: { _id: 0, requesterUserId: 1 } }] } },
      { $unwind: '$t' },
      ...out('$t.requesterUserId', '$createdAt', start, end),
    ],
  },
  simple('gratitude', 'care', 'gratitude_notes', 'fromUserId', 'createdAt'),
  simple('care-writing', 'care', 'care_writings', 'userId', 'createdAt'),
  simple('care-writing-edited', 'care', 'care_writings', 'userId', 'updatedAt'),
  simple('talk-booked', 'care', 'talk_sessions', 'clientUserId', 'createdAt'),
  // ── signin (dashboard users are dropped below) ──
  simple('signin', 'signin', 'auth_sessions', 'userId', 'createdAt'),
];

// ── days ──────────────────────────────────────────────────────────────────

export function istDay(t: Date): string {
  return new Date(t.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function istHour(t: Date): number {
  return new Date(t.getTime() + IST_OFFSET_MS).getUTCHours();
}
/** The moment an IST day begins. */
export function istStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export type Person = { org: string; dashboard: boolean };
export type DayRow = { userId: string; org: string; day: string; hours: Set<number>; sources: Set<string>; groups: Set<Group>; firstAt: Date };

/**
 * Every signal in [start, end), folded to one row per person per IST day.
 * Sources run one after another, to be gentle on a shared server.
 */
export async function collect(db: Db, people: Map<string, Person>, start: Date, end: Date, orgs: Set<string> | null): Promise<Map<string, DayRow>> {
  const rows = new Map<string, DayRow>();
  for (const s of SOURCES) {
    const events = await db.collection(s.collection).aggregate<{ u: string; t: Date }>(s.pipeline(start, end), { allowDiskUse: true }).toArray();
    for (const e of events) {
      const p = people.get(e.u);
      if (!p || (orgs && !orgs.has(p.org))) continue;
      if (s.group === 'signin' && p.dashboard) continue;
      const day = istDay(e.t);
      const k = `${e.u}|${day}`;
      let r = rows.get(k);
      if (!r) {
        r = { userId: e.u, org: p.org, day, hours: new Set(), sources: new Set(), groups: new Set(), firstAt: e.t };
        rows.set(k, r);
      }
      r.hours.add(istHour(e.t));
      r.sources.add(s.key);
      r.groups.add(s.group);
      if (e.t < r.firstAt) r.firstAt = e.t;
    }
  }
  return rows;
}

/** Who is who: org, and whether they can open the dashboard. Demo-seeded people are left out. */
export async function peopleOf(db: Db): Promise<Map<string, Person>> {
  const list = await db.collection('users')
    .find({ demoSeed: { $exists: false } }, { projection: { _id: 0, userId: 1, org: 1, dashboardAccess: 1 } })
    .toArray();
  const people = new Map<string, Person>();
  for (const u of list) if (typeof u.userId === 'string' && typeof u.org === 'string') people.set(u.userId, { org: u.org, dashboard: u.dashboardAccess === true });
  return people;
}

/** The first really tracked day anywhere, and the moment tracking began. */
export async function trackingStart(db: Db): Promise<{ day: string; at: Date } | null> {
  const [first] = await db.collection('appActivity')
    .find({ inferred: { $ne: true } }, { projection: { _id: 0, day: 1, firstAt: 1 } })
    .sort({ firstAt: 1 })
    .limit(1)
    .toArray();
  return first ? { day: String(first.day), at: new Date(first.firstAt) } : null;
}

/** The row as it is written. */
export function rowDoc(r: DayRow) {
  return {
    org: r.org,
    userId: r.userId,
    day: r.day,
    hours: [...r.hours].sort((a, b) => a - b),
    did: [] as string[],
    firstAt: r.firstAt,
    inferred: true as const,
    sources: [...r.sources].sort(),
  };
}

/**
 * Writes the rows: a new row only where the person has none that day, and a
 * refresh of rows this script wrote before. A real row is never matched by
 * either: the insert is `$setOnInsert`, the refresh asks for `inferred: true`.
 * Rows from an earlier run that the signals no longer back are taken away.
 */
export async function applyRows(db: Db, rows: DayRow[], stale: unknown[]): Promise<{ inserted: number; refreshed: number; removed: number }> {
  const col = db.collection('appActivity');
  let inserted = 0;
  let refreshed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const ops: AnyBulkWriteOperation<Document>[] = [];
    for (const r of rows.slice(i, i + 500)) {
      const doc = rowDoc(r);
      ops.push({ updateOne: { filter: { userId: doc.userId, day: doc.day }, update: { $setOnInsert: doc }, upsert: true } });
      ops.push({ updateOne: { filter: { userId: doc.userId, day: doc.day, inferred: true }, update: { $set: { org: doc.org, hours: doc.hours, firstAt: doc.firstAt, sources: doc.sources } } } });
    }
    const res = await col.bulkWrite(ops, { ordered: false });
    inserted += res.upsertedCount;
    refreshed += res.modifiedCount;
  }
  const removed = stale.length ? (await col.deleteMany({ _id: { $in: stale as never[] }, inferred: true })).deletedCount : 0;
  return { inserted, refreshed, removed };
}

// ── the command ───────────────────────────────────────────────────────────

function option(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const isDay = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

async function compare(db: Db, people: Map<string, Person>, orgs: Set<string> | null, start: { day: string; at: Date }, today: string) {
  console.log(`\nCompare: the signals against the real tracking, from ${start.at.toISOString()} (tracking began) to now`);
  const proxy = await collect(db, people, start.at, new Date(), orgs);
  const real = await db.collection('appActivity')
    .find({ inferred: { $ne: true }, day: { $gte: start.day, $lte: today }, ...(orgs ? { org: { $in: [...orgs] } } : {}) }, { projection: { _id: 0, userId: 1, org: 1, day: 1 } })
    .toArray();
  const keys = new Map<string, Set<string>>();
  for (const r of real) {
    const k = `${r.org}|${r.day}`;
    (keys.get(k) ?? keys.set(k, new Set()).get(k)!).add(`${r.userId}|${r.day}`);
  }
  for (const r of proxy.values()) if (!keys.has(`${r.org}|${r.day}`)) keys.set(`${r.org}|${r.day}`, new Set());
  console.log('org | day | tracked | caught by signals | coverage | signals, not tracked | coverage by group');
  const total = { tracked: 0, caught: 0, extra: 0 };
  for (const k of [...keys.keys()].sort()) {
    const [org, day] = k.split('|');
    const tracked = keys.get(k)!;
    const mine = [...proxy.values()].filter((r) => r.org === org && r.day === day);
    const caught = mine.filter((r) => tracked.has(`${r.userId}|${r.day}`)).length;
    const extra = mine.length - caught;
    const by = GROUPS.map((g) => {
      const n = mine.filter((r) => r.groups.has(g) && tracked.has(`${r.userId}|${r.day}`)).length;
      return n ? `${g} ${n}` : '';
    }).filter(Boolean).join(', ');
    total.tracked += tracked.size;
    total.caught += caught;
    total.extra += extra;
    console.log(`${org} | ${day} | ${tracked.size} | ${caught} | ${pct(caught, tracked.size)} | ${extra} | ${by}`);
  }
  console.log(`all | — | ${total.tracked} | ${total.caught} | ${pct(total.caught, total.tracked)} | ${total.extra} |`);
}

async function main() {
  const apply = flag('apply');
  const undo = flag('undo');
  const samples = Number(option('samples') ?? 3);
  const orgs = option('org') ? new Set(option('org')!.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(env.mongoUri, { compressors: ['zlib'] });
  await client.connect();
  const db = client.db(env.mongoDbName);
  try {
    const today = istDay(new Date());
    const start = await trackingStart(db);
    // Never on or after the first really tracked day, nor today.
    const ceiling = addDays(start && start.day < today ? start.day : today, -1);
    const to = isDay(option('to')) && option('to')! < ceiling ? option('to')! : ceiling;
    const from = isDay(option('from')) ? option('from')! : addDays(ceiling, -119);
    if (option('to') && option('to')! > ceiling) console.log(`--to moved back to ${ceiling}: days from ${addDays(ceiling, 1)} are really tracked.`);
    if (from > to) throw new Error(`Nothing to do: ${from} is after ${to}`);
    const orgFilter = orgs ? { org: { $in: [...orgs] } } : {};
    console.log(`App opens backfill · ${apply ? 'APPLY' : 'dry run'}${undo ? ' · UNDO' : ''} · ${from} to ${to}${orgs ? ` · orgs ${[...orgs].join(', ')}` : ''}`);
    console.log(`Tracking began: ${start ? start.at.toISOString() : 'not yet'} (database ${env.mongoDbName})`);

    const existingQuery = { day: { $gte: from, $lte: to }, ...orgFilter };
    if (undo) {
      const n = await db.collection('appActivity').countDocuments({ ...existingQuery, inferred: true });
      if (!apply) {
        console.log(`Would remove ${n} estimated rows. Run again with --apply to remove them.`);
        return;
      }
      const res = await db.collection('appActivity').deleteMany({ ...existingQuery, inferred: true });
      console.log(`Removed ${res.deletedCount} estimated rows.`);
      return;
    }

    const people = await peopleOf(db);
    const rows = await collect(db, people, istStart(from), istStart(addDays(to, 1)), orgs);
    const existing = await db.collection('appActivity')
      .find(existingQuery, { projection: { _id: 1, userId: 1, day: 1, inferred: 1 } })
      .toArray();
    const realKeys = new Set(existing.filter((r) => r.inferred !== true).map((r) => `${r.userId}|${r.day}`));
    const ownKeys = new Set(existing.filter((r) => r.inferred === true).map((r) => `${r.userId}|${r.day}`));
    const write = [...rows.values()].filter((r) => !realKeys.has(`${r.userId}|${r.day}`) && r.day >= from && r.day <= to);
    const stale = existing.filter((r) => r.inferred === true && !rows.has(`${r.userId}|${r.day}`)).map((r) => r._id);

    // Per org per day: people it would show, new rows, refreshed rows.
    const byOrg = new Map<string, Map<string, { n: number; fresh: number; groups: Record<string, number> }>>();
    for (const r of write) {
      const days = byOrg.get(r.org) ?? byOrg.set(r.org, new Map()).get(r.org)!;
      const d = days.get(r.day) ?? days.set(r.day, { n: 0, fresh: 0, groups: {} }).get(r.day)!;
      d.n += 1;
      if (!ownKeys.has(`${r.userId}|${r.day}`)) d.fresh += 1;
      for (const g of r.groups) d.groups[g] = (d.groups[g] ?? 0) + 1;
    }
    const rosterSize = new Map<string, number>();
    for (const p of people.values()) rosterSize.set(p.org, (rosterSize.get(p.org) ?? 0) + 1);
    for (const org of [...byOrg.keys()].sort()) {
      const days = byOrg.get(org)!;
      const size = rosterSize.get(org) ?? 0;
      console.log(`\n${org} (${size} people) · ${[...days.values()].reduce((s, d) => s + d.n, 0)} person-days`);
      console.log('day | people | of roster | new rows | by signal');
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const x = days.get(d);
        if (!x) continue;
        const g = GROUPS.filter((k) => x.groups[k]).map((k) => `${k} ${x.groups[k]}`).join(', ');
        console.log(`${d} | ${x.n} | ${pct(x.n, size)} | ${x.fresh} | ${g}`);
      }
      if (!apply && samples > 0) {
        for (const r of write.filter((w) => w.org === org).slice(0, samples)) console.log('  sample', JSON.stringify(rowDoc(r)));
      }
    }
    console.log(`\nTotal: ${write.length} person-days · ${write.filter((r) => !ownKeys.has(`${r.userId}|${r.day}`)).length} new · ${stale.length} earlier estimates no longer backed · ${realKeys.size} days already really tracked (left as they are)`);

    if (flag('compare') && start) await compare(db, people, orgs, start, today);

    if (apply) {
      const res = await applyRows(db, write, stale);
      console.log(`\nWritten: ${res.inserted} new rows, ${res.refreshed} refreshed, ${res.removed} removed. The App usage page shows them within five minutes (its cache).`);
    } else {
      console.log('\nDry run: nothing written. Run again with --apply to write these rows.');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
