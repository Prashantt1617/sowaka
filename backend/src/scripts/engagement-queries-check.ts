/**
 * Engagement database round trips, old code against new, on a scratch database only.
 *
 *   MONGODB_DB=engagement_queries_scratch npm run engagement-queries:check
 *
 * Seeds the speed check's org plus a little of everything the Engagement
 * pages read (requests and who decided them, claims, proofs, reviews, posts,
 * contests, games, tournaments, reports, pins), then for App usage's summary,
 * the Games overview, the Feed summary and feed pages:
 *   - builds the answer with the code as it was at ENGAGEMENT_BASE (a git
 *     ref, copied next to the services for the run) and with the code now,
 *     and checks the two are the same (order ignored only where the old code
 *     left it to Mongo);
 *   - counts the database calls each makes and how many of them are in a
 *     chain (each waits on an earlier one), with a pretend delay on every call
 *     so overlapping calls can be told from sequential ones.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Collection, ObjectId } from 'mongodb';
import {
  attendanceRecords, attendanceRegularizations, connectPosts, contentReports, feedbackRecords, gameChallenges,
  gameScores, getDb, investmentProofs, leaves, overtimeRequests, reimbursementClaims, relayEvents, relayPresence, shiftAssignments, users,
} from '../config/db';
import { forgetEngagement } from '../services/engagement-cache';
import { pointEvents } from '../services/points-ledger.service';
import { HR, ORG, seedSpeedOrg } from './engagement-speed-check';

const BASE = process.env.ENGAGEMENT_BASE || '3db1ab2';
const DELAY_MS = Number(process.env.DELAY_MS || 40);
const DAY_MS = 86_400_000;
const IST = 330 * 60_000;
const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const at = (iso: string, h = 6) => new Date(Date.parse(`${iso}T00:00:00Z`) + h * 3_600_000);

let failures = 0;
function ok(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? `\n      ${detail}` : ''}`);
}

// ── the old code, copied in for the run ───────────────────────────────────
const SERVICES = join(__dirname, '..', 'services');
const LEGACY: Record<string, string> = {
  'engagement-usage.service.ts': '__legacy-usage.ts',
  'attendance-report.service.ts': '__legacy-attendance-report.ts',
  'engagement-games.service.ts': '__legacy-games.ts',
  'engagement-feed.service.ts': '__legacy-feed.ts',
  'game-catalog.service.ts': '__legacy-game-catalog.ts',
};
export function writeLegacy(): void {
  for (const [file, copy] of Object.entries(LEGACY)) {
    let text = execFileSync('git', ['show', `${BASE}:backend/src/services/${file}`], { cwd: SERVICES, encoding: 'utf8', maxBuffer: 1 << 26 });
    text = text.replace(/'\.\/attendance-report\.service'/g, "'./__legacy-attendance-report'");
    text = text.replace(/'\.\/game-catalog\.service'/g, "'./__legacy-game-catalog'");
    writeFileSync(join(SERVICES, copy), text);
  }
}
export function removeLegacy(): void {
  for (const copy of Object.values(LEGACY)) rmSync(join(SERVICES, copy), { force: true });
}

// ── counting calls ────────────────────────────────────────────────────────
type Call = { what: string; start: number; end: number };
let calls: Call[] | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timed<T>(what: string, run: () => Promise<T>): Promise<T> {
  const log = calls;
  if (!log) return run();
  const call: Call = { what, start: performance.now(), end: Number.POSITIVE_INFINITY };
  log.push(call);
  return sleep(DELAY_MS).then(run).finally(() => { call.end = performance.now(); });
}

function installCounter(): void {
  const proto = Collection.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['findOne', 'countDocuments', 'distinct', 'estimatedDocumentCount']) {
    const orig = proto[name];
    proto[name] = function (this: Collection, ...args: unknown[]) {
      return timed(`${this.collectionName}.${name}`, () => orig.apply(this, args) as Promise<unknown>);
    };
  }
  for (const name of ['find', 'aggregate']) {
    const orig = proto[name];
    proto[name] = function (this: Collection, ...args: unknown[]) {
      const cursor = orig.apply(this, args) as Record<string, (...a: unknown[]) => unknown>;
      const what = `${this.collectionName}.${name}`;
      const toArray = cursor.toArray.bind(cursor);
      cursor.toArray = () => timed(what, () => toArray() as Promise<unknown>);
      return cursor;
    };
  }
}

/** Calls made, and the longest chain of calls each started after the one before it finished. */
async function measure<T>(run: () => Promise<T>): Promise<{ value: T; calls: number; depth: number; ms: number; list: string[] }> {
  calls = [];
  const t0 = performance.now();
  const value = await run();
  const ms = performance.now() - t0;
  const log = calls;
  calls = null;
  const sorted = [...log].sort((a, b) => a.start - b.start);
  const depth = new Map<Call, number>();
  for (const c of sorted) {
    let d = 1;
    for (const p of sorted) if (p.end <= c.start) d = Math.max(d, (depth.get(p) ?? 1) + 1);
    depth.set(c, d);
  }
  const counts = new Map<string, number>();
  for (const c of log) counts.set(c.what, (counts.get(c.what) ?? 0) + 1);
  return { value, calls: log.length, depth: Math.max(0, ...depth.values()), ms: Math.round(ms), list: [...counts].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)) };
}

// ── a little of everything ────────────────────────────────────────────────
export async function seedMore(): Promise<void> {
  const today = istToday();
  const ids = Array.from({ length: 50 }, (_, i) => `speed-${String(i).padStart(3, '0')}`);
  const mgrOf = (i: number) => (i < 5 ? HR : ids[i % 5]);
  const now = new Date();
  // Someone hidden from the directory, someone who left, a legacy photo, a face, interests.
  await users().insertMany([
    { userId: 'speed-hidden', name: 'Support', email: 'h@speed.test', org: ORG, lifecycleStatus: 'active', role: 'employee', hiddenFromDirectory: true, employeeId: 'SPX', joiningDate: new Date('2025-01-01') },
    { userId: 'speed-left', name: 'Gone', email: 'g@speed.test', org: ORG, lifecycleStatus: 'offboarded', role: 'employee', employeeId: 'SPL', joiningDate: new Date('2025-01-01') },
  ] as never[]);
  await users().updateOne({ userId: ids[1] }, { $set: { profilePhotoUrl: 'data:image/png;base64,AAAA', interests: ['chess'], faceId: { faceId: 'f1' } as never } });
  await users().updateOne({ userId: ids[2] }, { $set: { profilePhotoKey: 'photos/p2.jpg', overtimeEligible: false } });

  const leaveRows: unknown[] = [];
  const ot: unknown[] = [];
  const regs: unknown[] = [];
  const claims: unknown[] = [];
  ids.forEach((id, i) => {
    const day = addDays(today, -(i % 40));
    const decided = i % 4 === 0 ? { decidedByRole: 'manager', decidedByUserId: mgrOf(i), decidedAt: at(day, 10), status: 'approved' }
      : i % 4 === 1 ? { decidedByRole: 'admin', decidedByUserId: HR, decidedAt: at(day, 10), status: 'rejected' }
        : { status: i % 7 === 0 ? 'cancelled' : 'pending' };
    if (i % 3 !== 2) leaveRows.push({ userId: id, type: 'casual', startDate: at(day, 0), endDate: at(day, 0), reason: 'x', ...decided, createdAt: i % 2 ? at(day).getTime() : at(day) });
    if (i % 3 === 0) ot.push({ userId: id, org: ORG, managerUserId: mgrOf(i), workDate: day, hours: 2, ...decided, createdAt: at(day) });
    if (i % 2 === 0) regs.push({ userId: id, org: ORG, managerUserId: mgrOf(i), workDate: day, ...(i % 6 === 0 ? {} : { kind: i % 4 === 0 ? 'correction' : 'outside_location' }), ...decided, createdAt: at(day) });
    if (i % 5 === 0) claims.push({ userId: id, org: ORG, amount: 100, status: 'pending', createdAt: at(day) });
  });
  // A request from long ago, decided by a manager in the range.
  leaveRows.push({ userId: ids[9], type: 'casual', startDate: at(addDays(today, -200)), endDate: at(addDays(today, -200)), status: 'approved', decidedByRole: 'manager', decidedByUserId: ids[4], decidedAt: at(today, 1), createdAt: at(addDays(today, -200)).getTime() });
  await leaves().insertMany(leaveRows as never[]);
  await overtimeRequests().insertMany(ot as never[]);
  await attendanceRegularizations().insertMany(regs as never[]);
  await reimbursementClaims().insertMany(claims as never[]);
  await investmentProofs().insertMany(ids.filter((_, i) => i % 9 === 0).map((id, k) => ({ org: ORG, userId: id, fy: '2026-27', item: `i${k}`, status: 'pending', uploadedAt: at(addDays(today, -k * 5)) })) as never[]);
  await feedbackRecords().insertMany([
    { managerUserId: ids[0], employeeUserId: ids[5], period: 'p0', userId: ids[5], status: 'sent', sentAt: at(addDays(today, -3)), updatedAt: now },
    { managerUserId: ids[1], employeeUserId: ids[6], period: 'p1', userId: ids[6], status: 'sent', updatedAt: at(addDays(today, -4)) },
    { managerUserId: ids[2], employeeUserId: ids[7], period: 'p2', userId: ids[7], status: 'draft', updatedAt: now },
  ] as never[]);

  // Posts: people's own, automatic ones, contests with entries and votes, pins, a team and a list audience.
  const author = (i: number) => ({ userId: ids[i], name: ids[i], initials: 'SP', designation: 'Engineer', avatarColor: '#123456' });
  const posts: Record<string, unknown>[] = [];
  for (let k = 0; k < 45; k += 1) {
    const day = addDays(today, -k);
    const type = k % 9 === 0 ? 'caption_challenge' : k % 7 === 0 ? 'birthday' : k % 11 === 0 ? 'survey' : 'text';
    const contest = type === 'caption_challenge';
    posts.push({
      id: `post-${k}`, org: ORG, type, tag: 'Post',
      author: type === 'birthday' ? { userId: '', name: 'Sowaka', initials: 'S', designation: 'Auto', avatarColor: '#000' } : author(k % 50),
      audience: k % 10 === 3 ? { teamId: ids[0] } : k % 10 === 4 ? { listId: 'l1', listName: 'Leads', userIds: [ids[1], ids[2]] } : {},
      body: { text: `post ${k}`, ...(type === 'survey' ? { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', imageObjectKey: 'img/b.png' }] } : {}), ...(k % 5 === 0 ? { mediaObjectKey: `m/${k}.jpg`, mediaContentType: 'image/jpeg' } : {}), ...(type === 'birthday' ? { personUserId: ids[k % 50] } : {}) },
      comments: k % 4 === 0 ? [{ id: `c${k}`, userId: ids[(k + 1) % 50], name: 'x', text: 'nice', createdAt: at(day, 8) }] : [],
      likedBy: ids.slice(0, k % 6),
      ...(contest ? {
        captionEntries: ids.slice(k % 10, (k % 10) + 4).map((u, n) => ({ id: `e${k}-${n}`, userId: u, text: 'c', createdAt: at(addDays(day, 1)) })),
        captionVotes: Object.fromEntries(ids.slice(20, 24 + (k % 5)).map((u) => [u, `e${k}-0`])),
      } : {}),
      ...(type === 'survey' ? { pollVotes: { [ids[3]]: 'a', [ids[4]]: 'b' } } : {}),
      ...(k % 13 === 0 ? { systemKey: `sys-${k}` } : {}),
      ...(k < 4 && k !== 1 ? { pinnedUntil: new Date(Date.now() + DAY_MS * (k + 1)) } : {}),
      createdAt: at(day), publishedAt: at(day), updatedAt: at(day),
    });
  }
  posts.push({ id: 'launch-1', org: ORG, type: 'game_launch', tag: 'Game', author: author(3), audience: {}, body: { gameKey: 'tile-up', title: 'Timed', startsAt: addDays(today, -5), endsAt: addDays(today, -4) }, comments: [], likedBy: [], createdAt: at(addDays(today, -5)), publishedAt: at(addDays(today, -5)) });
  await connectPosts().insertMany(posts as never[]);
  await contentReports().insertMany([
    { id: 'rep-post-2-4', org: ORG, status: 'open', postId: 'post-2', reporterUserId: ids[4] },
    { id: 'rep-post-2-5', org: ORG, status: 'open', postId: 'post-2', reporterUserId: ids[5] },
    { id: 'rep-post-4-6', org: ORG, status: 'open', postId: 'post-4', commentId: 'c4', reporterUserId: ids[6] },
    { id: 'rep-post-5-6', org: ORG, status: 'actioned', postId: 'post-5', reporterUserId: ids[6] },
  ] as never[]);

  // Games and tournaments of every kind.
  const db = getDb();
  await gameScores().insertMany(ids.slice(0, 12).map((u, i) => ({ org: ORG, gameId: 'catalog:tile-up', userId: u, playerName: u, score: 100 + i, achievedAt: at(addDays(today, -i * 3)) })) as never[]);
  await db.collection('game_launch_scores').insertMany(ids.slice(10, 16).map((u, i) => ({ org: ORG, postId: 'launch-1', gameKey: 'tile-up', userId: u, playerName: u, score: 50 + i, achievedAt: at(addDays(today, -5), 12) })));
  await gameChallenges().insertMany([
    { id: 'ch1', org: ORG, gameKey: 'scribble', started: { [ids[30]]: at(addDays(today, -2)), [ids[31]]: at(addDays(today, -90)) }, scores: { [ids[30]]: { finishedAt: at(addDays(today, -2), 7) } }, createdAt: at(addDays(today, -2)) },
  ] as never[]);
  await db.collection('cup_events').insertMany([{ id: 'cup1', org: ORG, gameKey: 'pool', phase: 'running', name: 'Cup', rounds: [], entrants: [] }, { id: 'cup2', org: ORG, gameKey: 'pool', phase: 'done', name: 'Cup 2', rounds: [], entrants: [] }]);
  await db.collection('cup_matches').insertMany([{ org: ORG, eventId: 'cup1', joined: { [ids[32]]: at(addDays(today, -1)), [ids[33]]: at(addDays(today, -1)) }, finals: { [ids[32]]: { at: at(addDays(today, -1), 9) } } }]);
  await db.collection('poker_events').insertMany([{ id: 'pk1', org: ORG, catalogKey: '', status: 'over' }, { id: 'pk2', org: ORG, status: 'draft' }]);
  await db.collection('poker_results').insertMany([
    { org: ORG, eventId: 'pk1', userId: ids[34], at: at(addDays(today, -3)), points: 40 },
    { org: ORG, eventId: 'pk1', userId: ids[35], at: at(addDays(today, -3)), points: 10, voided: true },
  ]);
  await db.collection('secret_squad_sessions').insertMany([{ id: 'sq1', org: ORG, status: 'scheduled', startsAt: new Date(Date.now() + DAY_MS) }]);
  await db.collection('secret_squad_payouts').insertMany([{ org: ORG, sessionId: 'sq0', paidAt: at(addDays(today, -6)), points: { [ids[36]]: 20, [ids[37]]: 10, 'not-here': 5 } }]);
  await relayEvents().insertMany([{ id: 'rl1', org: ORG, status: 'finished' }] as never[]);
  await relayPresence().insertMany([{ eventId: 'rl1', userId: ids[38], lastSeenAt: at(addDays(today, -8)) }, { eventId: 'rl1', userId: ids[39], lastSeenAt: at(addDays(today, -80)) }] as never[]);
  await pointEvents().insertMany([{ org: ORG, userId: ids[38], source: 'hint_relay', delta: 15, createdAt: at(addDays(today, -8)) }] as never[]);
  // Someone on the Auto shift with a newer assignment row written under another org.
  await shiftAssignments().insertOne({ org: 'speednoise', userId: ids[46], templateId: new ObjectId(), effectiveFrom: addDays(today, -3), createdAt: now } as never);
  // An app punch outside the range, and a roster person with no punches at all.
  await attendanceRecords().updateMany({ userId: ids[3] }, { $unset: { punchInLocation: '' } });
}

/** Order Mongo was left to choose, made the same for comparing. */
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

function compare(label: string, oldValue: unknown, newValue: unknown): void {
  const a = plain(oldValue);
  const b = plain(newValue);
  const diffs: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (diffs.length >= 8 || isDeepStrictEqual(x, y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
      return;
    }
    diffs.push(`${path}: ${JSON.stringify(x)?.slice(0, 120)} vs ${JSON.stringify(y)?.slice(0, 120)}`);
  };
  walk(a, b, '');
  ok(`${label}: old and new give the same answer`, diffs.length === 0, diffs.join('\n      '));
}

type Lib = {
  usageSummary: (c: { userId: string; org: string }, i: { from: string; to: string }) => Promise<Record<string, unknown> & { people: { id: string }[]; managers: { id: string }[] }>;
  gamesOverview: (org: string) => Promise<{ board: [number, number][] } & Record<string, unknown>>;
  feedSummary: (admin: unknown) => Promise<unknown>;
  feedPage: (admin: unknown, o: { as?: string; cursor?: string }) => Promise<{ nextCursor: string | null } & Record<string, unknown>>;
};

if (require.main === module) {
  (async () => {
    installCounter();
    await seedSpeedOrg();
    await seedMore();
    writeLegacy();
    let oldLib: Lib;
    let newLib: Lib;
    try {
      oldLib = {
        ...(await import(join(SERVICES, '__legacy-usage.ts'))),
        ...(await import(join(SERVICES, '__legacy-games.ts'))),
        ...(await import(join(SERVICES, '__legacy-feed.ts'))),
      } as unknown as Lib;
    } finally {
      removeLegacy();
    }
    newLib = {
      ...(await import('../services/engagement-usage.service')),
      ...(await import('../services/engagement-games.service')),
      ...(await import('../services/engagement-feed.service')),
    } as unknown as Lib;

    const today = istToday();
    const caller = { userId: HR, org: ORG };
    const admin = { userId: HR, org: ORG, email: 'speed-hr@speed.test', name: 'HR' };
    const table: string[] = [];
    const both = async <T>(label: string, run: (lib: Lib) => Promise<T>, norm: (v: T) => unknown = (v) => v) => {
      forgetEngagement(ORG);
      const before = await measure(() => run(oldLib));
      forgetEngagement(ORG);
      const after = await measure(() => run(newLib));
      forgetEngagement(ORG);
      compare(label, norm(before.value), norm(after.value));
      table.push(`${label.padEnd(34)} calls ${String(before.calls).padStart(3)} → ${String(after.calls).padStart(3)}   in a chain ${before.depth} → ${after.depth}   (${before.ms} → ${after.ms} ms at ${DELAY_MS} ms a call)`);
      table.push(`    before: ${before.list.join(', ')}`);
      table.push(`    after:  ${after.list.join(', ')}`);
    };
    const usageNorm = (s: Awaited<ReturnType<Lib['usageSummary']>>) => ({ ...s, people: byId(s.people), managers: byId(s.managers) });

    console.log('\nsame answers');
    for (const [label, from, to] of [
      ['last 30 days', addDays(today, -29), today],
      ['a settled fortnight', addDays(today, -40), addDays(today, -27)],
      ['into the future', addDays(today, -6), addDays(today, 20)],
      ['before anything', '2024-01-01', '2024-01-31'],
    ] as const) {
      await both(`usage summary, ${label}`, (lib) => lib.usageSummary(caller, { from, to }), usageNorm);
    }
    await both('games overview', (lib) => lib.gamesOverview(ORG), (g) => ({ ...g, board: [...g.board].sort((a, b) => a[0] - b[0]) }));
    await both('feed summary', (lib) => lib.feedSummary(admin));
    for (const as of ['all', 'company', 'team', 'list', `person:speed-007`]) {
      await both(`feed page, as ${as}`, (lib) => lib.feedPage(admin, { as }));
    }
    const first = await newLib.feedPage(admin, { as: 'all' });
    if (first.nextCursor) await both('feed page two', (lib) => lib.feedPage(admin, { as: 'all', cursor: first.nextCursor! }));

    console.log('\ndatabase calls, old → new');
    for (const line of table) console.log(line);

    console.log(failures ? `\n${failures} failed` : '\nall passed');
    if (!process.env.KEEP_DB) await getDb().dropDatabase();
    process.exit(failures ? 1 : 0);
  })().catch((error) => {
    removeLegacy();
    console.error(error);
    process.exit(1);
  });
}
