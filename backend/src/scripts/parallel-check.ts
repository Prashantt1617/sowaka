/**
 * Scratch-database check of the routes whose reads were put side by side, or
 * whose optional parts were made to fail on their own: the Games home and its
 * page, the workspace and the feedback snapshot, the inbox and its unread
 * count, a feed page, HR's corrections and out-of-location lists, Suwi's
 * notices, the KPI audiences, the shift policy and an out-of-location punch.
 *
 * `snapshot <file>` seeds the database, calls each route's service and writes
 * what every one answered, with times and generated ids blanked, to <file>.
 * Run it on the sources before a change and after; the two files must match,
 * which is what "the response is unchanged" means here.
 *
 * `degrade` seeds the same data and breaks one read at a time (by making the
 * driver throw for one collection), checking the answer still comes back with
 * that part empty, or that the request fails when the part is one it cannot
 * do without. It also checks the unread count agrees with the inbox in the
 * cases the inbox reads specially. Only the new sources have the code it
 * exercises.
 *
 * Drops and recreates its own database and refuses any other. Run with
 * MONGODB_DB=backend_parallel_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch \
 *   npx tsx src/scripts/parallel-check.ts snapshot /tmp/after.json
 */
import { writeFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import { Collection } from 'mongodb';
import {
  appPages, attendanceRecords, attendanceRegularizations, companies, connectDb, connectPosts, feedbackRecords,
  gameCatalog, gameChallenges, gameScores, getDb, kpiTemplates, leaves, notifications, offices,
  recognitionNominations, relayEvents, relayPresence, relayTeams, shiftPolicies, users,
} from '../config/db';
import { runAsViewer } from '../middleware/request-viewer';
import { runAsRequestUser } from '../services/request-user';
import type { User } from '../models/user.model';
import type { ConnectPost } from '../models/connect.model';
import { DEFAULT_ORG_SHIFT_POLICY } from '../models/shift.model';
import { gamesHomeFor } from '../services/games-home.service';
import { appPageFor } from '../services/app-page.service';
import { getFeedbackSnapshot, getManagerWorkspace } from '../services/manager.service';
import { notificationInbox, unreadNotificationCount } from '../controllers/notification.controller';
import { getConnectFeed } from '../services/connect.service';
import { adminDecideRegularization, listAllRegularizationsForAdmin, listOutOfLocationForAdmin, recordPunch } from '../services/attendance.service';
import { suwiNotices } from '../suwi/notices';
import { contextFor } from '../suwi/tools';
import { kpiTemplateAudience, kpiTemplateMembers, resolveKpiAudience } from '../services/kpi.service';
import { shiftPolicyFor } from '../services/shift.service';
import { currentPeriodFor } from '../services/cycle';
import { runWithRequestId } from '../utils/optional';

const SCRATCH = 'backend_parallel_scratch';
const ORG = 'sowaka';
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);
const INLINE = 'data:image/png;base64,AAAA';
const TODAY = new Date().toISOString().slice(0, 10);
// The office the punches are checked against, and a point 5 km away.
const HQ = { latitude: 19.076, longitude: 72.8777 };
const AWAY = { latitude: 19.12, longitude: 72.9 };

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)?.slice(0, 400)}`}`);
  if (!ok) failed += 1;
}

const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', ...extra,
});

function post(id: string, partial: Partial<ConnectPost> & { type: ConnectPost['type'] }, minutesAgo: number): ConnectPost {
  const at = ago(minutesAgo);
  return {
    id, org: ORG, tag: '', tagIcon: '', tagColor: '', tagTint: '',
    author: { userId: 'c', name: 'Chetan', initials: 'C', designation: '', avatarColor: '' },
    audience: { label: 'Company', org: ORG }, body: {}, likedBy: [], comments: [], actionBy: {}, pollVotes: {},
    publishedAt: at, createdAt: at, updatedAt: at, ...partial,
  } as ConnectPost;
}

async function seed() {
  const db = getDb();
  if (db.databaseName !== SCRATCH) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const period = await currentPeriodFor(ORG);

  await users().insertMany([
    person('boss', 'Bina Boss', { department: 'Eng', profilePhotoUrl: 'https://cdn.test/boss.jpg', dashboardAccess: true, dashboardAdmin: true, points: 50, employeeId: 'E-BOSS' }),
    person('mgr', 'Manav Manager', { managerUserId: 'boss', department: 'Eng', employeeId: 'E-MGR', points: 120, profilePhotoUrl: INLINE }),
    person('a', 'Asha', { managerUserId: 'mgr', department: 'Eng', profilePhotoUrl: INLINE, employeeId: 'E-A', points: 300, documents: [{ name: 'Offer', url: 'https://docs.test/offer.pdf', type: 'offer' }] }),
    person('b', 'Bala', { managerUserId: 'mgr', department: 'Eng', profilePhotoKey: 'connect/b.jpg', employeeId: 'E-B', points: 80, location: 'Mumbai' }),
    person('c', 'Chetan', { managerUserId: 'mgr', department: 'Eng', profilePhotoUrl: 'https://cdn.test/c.jpg', isLeadership: true, joiningDate: new Date('2023-10-02'), employeeId: 'E-C', points: 0 }),
    person('d', 'Divya', { managerUserId: 'a', department: 'Eng', employeeId: 'E-D', points: 10 }),
    person('left', 'Leaver', { managerUserId: 'mgr', department: 'Eng', lifecycleStatus: 'offboarded' }),
    // Someone who has left the company altogether: no org.
    { userId: 'gone', name: 'Gita Gone', email: 'gone@elsewhere.test', lifecycleStatus: 'offboarded' },
  ] as never[]);

  await companies().insertOne({ id: ORG, name: 'Sowaka', enabledTabs: ['games'], enabledGames: ['odd-one-out', 'word-hunt'] } as never);
  await gameCatalog().insertMany([
    { key: 'odd-one-out', name: 'Odd One Out', kind: 'web', order: 1, active: true, hostedUrl: 'https://games.test/odd', thumbnail: 'data:image/png;base64,BBBB', scoring: { higherIsBetter: true, label: 'points' }, updatedAt: new Date('2026-10-01T00:00:00Z') },
    { key: 'word-hunt', name: 'Word Hunt', kind: 'web', order: 2, active: true, html: '<html>hunt</html>', scoring: { higherIsBetter: false, label: 'seconds' }, updatedAt: new Date('2026-10-02T00:00:00Z') },
  ] as never[]);
  await gameScores().insertMany([
    { gameId: 'catalog:odd-one-out', org: ORG, userId: 'a', playerName: 'Asha', score: 40, achievedAt: ago(600), updatedAt: ago(600) },
    { gameId: 'catalog:odd-one-out', org: ORG, userId: 'b', playerName: 'Bala', score: 55, achievedAt: ago(30), updatedAt: ago(2) },
    { gameId: 'catalog:word-hunt', org: ORG, userId: 'a', playerName: 'Asha', score: 20, achievedAt: ago(900), updatedAt: ago(900) },
    { gameId: 'catalog:word-hunt', org: ORG, userId: 'c', playerName: 'Chetan', score: 25, achievedAt: ago(800), updatedAt: ago(800) },
  ] as never[]);
  await gameChallenges().insertOne({
    id: 'ch1', org: ORG, gameKey: 'odd-one-out', challengerUserId: 'b', challengerName: 'Bala', opponentUserId: 'a', opponentName: 'Asha',
    status: 'pending', createdAt: ago(20), updatedAt: ago(20), expiresAt: new Date(NOW + 86_400_000), scores: {},
  } as never);
  await relayEvents().insertOne({ id: 'ev1', org: ORG, name: 'Friday Relay', status: 'live', startsAt: ago(10), updatedAt: ago(5) } as never);
  await relayTeams().insertOne({ eventId: 'ev1', name: 'Team Blue', members: [{ userId: 'a', name: 'Asha' }, { userId: 'd', name: 'Divya' }] } as never);
  await relayPresence().insertOne({ eventId: 'ev1', userId: 'd', lastSeenAt: ago(1) } as never);

  await connectPosts().insertMany([
    post('p-caption', { type: 'caption_challenge', body: { title: 'Caption this', task: 'Say it', closesAt: new Date(NOW + 86_400_000).toISOString(), mediaObjectKey: 'connect/pic.jpg' }, captionEntries: [
      { id: 'e1', userId: 'b', name: 'Bala', initials: 'B', text: 'Ha', createdAt: ago(50) } as never,
    ] }, 120),
    post('p-kudos', { type: 'kudos', body: { personUserId: 'a', taggedUserIds: ['b', 'c', 'nobody'] }, comments: [
      { id: 'cm1', userId: 'b', name: 'Bala', initials: 'B', text: 'Yay', createdAt: ago(40) } as never,
    ] }, 60),
    post('p-anniv', { type: 'anniversary', author: { userId: '', name: 'Sowaka', initials: 'S', designation: '', avatarColor: '' }, body: { personUserId: 'c' } }, 30),
    post('p-relay', { type: 'relay_game', body: { eventId: 'ev1', title: 'Relay' } }, 15),
  ] as never[]);

  await appPages().insertOne({ key: 'games-home', html: '<html>v1</html>', version: 1, previous: null, enabledOrgs: [ORG], updatedAt: new Date(), updatedBy: 'check' } as never);

  const record = (managerUserId: string, employeeUserId: string, p: string, status: 'sent' | 'saved', overallScore: number) => ({
    managerUserId, employeeUserId, period: p, status, overallScore, parameters: [], extra: '',
    createdAt: new Date('2026-01-05'), updatedAt: new Date('2026-01-05'), sentAt: new Date('2026-01-06'),
  });
  await feedbackRecords().insertMany([
    record('boss', 'mgr', '2026-01', 'sent', 3.24),
    record('mgr', 'a', period, 'saved', 3),
    record('mgr', 'b', period, 'sent', 4.5),
    record('mgr', 'a', '2020-01', 'sent', 1),
  ] as never[]);
  await recognitionNominations().insertMany([
    { managerUserId: 'mgr', employeeUserId: 'a', period, category: 'mentor', reason: 'Helps', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { managerUserId: 'mgr', employeeUserId: 'gone', period: '2025-01', category: 'artist', reason: 'Drew', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01') },
  ] as never[]);

  // Geotagged punches, with an outside punch-in sent to the manager.
  await shiftPolicies().insertOne({
    org: ORG, ...DEFAULT_ORG_SHIFT_POLICY,
    correction: { ...DEFAULT_ORG_SHIFT_POLICY.correction, punchFormat: 'Geotag (powered by Sowaka)', outsideLocation: { outcome: 'request', reasons: ['Client visit'] } },
    updatedAt: new Date('2026-01-01'),
  } as never);
  await offices().insertOne({ id: 'hq', org: ORG, name: 'HQ', ...HQ, radiusMeters: 300, active: true } as never);

  // Corrections HR lists, an out-of-location day, and leave Suwi notices.
  await attendanceRegularizations().insertMany([
    { userId: 'a', employeeId: 'E-A', managerUserId: 'mgr', workDate: '2026-10-01', requestedDayType: 'full_day', note: 'forgot', status: 'pending', createdAt: new Date('2026-10-02T05:00:00Z') },
    { userId: 'b', employeeId: 'E-B', managerUserId: 'mgr', workDate: '2026-10-03', requestedDayType: 'wfh', note: 'home', status: 'approved', createdAt: new Date('2026-10-04T05:00:00Z'), decidedAt: new Date('2026-10-04T06:00:00Z') },
    { userId: 'c', employeeId: 'E-C', managerUserId: 'mgr', workDate: '2026-10-05', kind: 'out_of_location', requestedDayType: 'full_day', note: '', status: 'declined', createdAt: new Date('2026-10-05T05:00:00Z'), outsideLocation: { reason: 'Client visit', punchType: 'in', at: new Date('2026-10-05T05:00:00Z'), latitude: 1, longitude: 2, officeName: 'HQ', distanceMeters: 5000 } },
  ] as never[]);
  await attendanceRecords().insertMany([
    { employeeId: 'E-A', userId: 'a', workDate: '2026-10-01', punchIn: new Date('2026-10-01T04:00:00Z'), source: 'manual', sourceKey: 'k1', importedAt: new Date('2026-10-01') },
    { employeeId: 'E-B', userId: 'b', workDate: '2026-10-06', punchIn: new Date('2026-10-06T04:00:00Z'), source: 'manual', sourceKey: 'k2', importedAt: new Date('2026-10-06'), outsideLocation: { reason: 'Client visit', punchType: 'in', at: new Date('2026-10-06T04:00:00Z'), latitude: 1, longitude: 2, officeName: 'HQ', distanceMeters: 900 } },
  ] as never[]);
  await leaves().insertOne({ userId: 'b', type: 'casual', startDate: new Date(NOW + 5 * 86_400_000), endDate: new Date(NOW + 5 * 86_400_000), days: 1, reason: 'Trip', status: 'pending', createdAt: new Date(NOW - 4 * 86_400_000), updatedAt: new Date(NOW - 4 * 86_400_000) } as never);
  await kpiTemplates().insertOne({ org: ORG, name: 'Engineering', description: '', parameterIds: [], departments: ['Eng'], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') } as never);
}

/** Notification rows for `a`, oldest last as listed. */
async function seedInbox(rows: Record<string, unknown>[]) {
  await notifications().deleteMany({ userId: 'a' });
  if (rows.length) await notifications().insertMany(rows as never[]);
}
const note = (id: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
  id, userId: 'a', org: ORG, scenario: 'kudos', title: id, body: 'b', data: {}, createdAt: ago(minutesAgo), pushed: false, ...extra,
});
const NORMAL_INBOX = [
  note('read', 5, { readAt: ago(1) }),
  note('gone', 6, { data: { postId: 'deleted-post' } }),
  note('kudos-post', 7, { data: { postId: 'p-kudos' } }),
  note('scribble-old', 200, { scenario: 'scribble_invite' }),
  note('fresh', 8),
  note('punch', 9, { scenario: 'punch_in_reminder', data: { dateKey: '2020-01-01' } }),
];

/** Runs a controller as Express would and hands back what it sent. */
async function call(handler: (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>, userId: string) {
  let sent: unknown;
  let error: unknown;
  const res = { json: (body: unknown) => { sent = body; return res; }, status: () => res } as unknown as Response;
  await handler({ auth: { userId, token: 't' } } as unknown as Request, res, (e) => { error = e; });
  if (error) throw error;
  return sent as Record<string, unknown>;
}

/** Inside a signed-in request for `userId`, as `requireAuth` would set it up. */
async function asSignedIn<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const found = await users().findOne({ userId }, { projection: { _id: 0, profilePhotoUrl: 0 } });
  const viewer = found as Omit<User, 'profilePhotoUrl'>;
  return new Promise<T>((resolve, reject) => {
    runAsRequestUser({ userId, org: viewer.org }, () => runAsViewer(viewer, () => { work().then(resolve, reject); }));
  });
}

/** Times within a day of now, and generated ids, blanked; everything else as answered. */
function normalise(value: unknown): unknown {
  if (value instanceof Date) return normalise(value.toISOString());
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return '<oid>';
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalise(v)]));
  }
  if (typeof value === 'string') {
    if (/^[0-9a-f]{24}$/.test(value)) return '<oid>';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && Math.abs(Date.parse(value) - NOW) < 2 * 86_400_000) return '<recent>';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return '<uuid>';
  }
  return value;
}

/** Clears what the new sources keep between calls, when they keep it. */
async function forgetCaches() {
  const home = (await import('../services/games-home.service')) as { forgetHomeCatalogs?: () => void };
  const pages = (await import('../services/app-page.service')) as { forgetAppPages?: () => void };
  home.forgetHomeCatalogs?.();
  pages.forgetAppPages?.();
}

async function snapshot(file: string) {
  await seed();
  const out: Record<string, unknown> = {};
  const take = async (name: string, work: () => Promise<unknown>) => {
    await forgetCaches();
    try {
      out[name] = normalise(await work());
    } catch (error) {
      out[name] = { threw: (error as { statusCode?: number }).statusCode ?? String(error) };
    }
  };
  // Each read twice: as a script would, and inside a signed-in request.
  for (const [label, run] of [['read', (_u: string, w: () => Promise<unknown>) => w()], ['signedIn', asSignedIn]] as const) {
    await take(`${label}:gamesHome:a`, () => run('a', () => gamesHomeFor('a')));
    await take(`${label}:gamesHome:boss`, () => run('boss', () => gamesHomeFor('boss')));
    await take(`${label}:workspace:mgr`, async () => {
      const viewer = await users().findOne({ userId: 'mgr' }, { projection: { profilePhotoUrl: 0 } });
      return run('mgr', () => getManagerWorkspace('mgr', label === 'signedIn' ? (viewer as never) : undefined));
    });
    await take(`${label}:workspace:a`, () => run('a', () => getManagerWorkspace('a')));
    await take(`${label}:snapshot:mgr`, () => run('mgr', () => getFeedbackSnapshot('mgr')));
    await take(`${label}:feed:mgr`, () => run('mgr', () => getConnectFeed('mgr', { limit: 10 })));
    await take(`${label}:regularizations`, () => run('boss', () => listAllRegularizationsForAdmin('boss')));
    await take(`${label}:outOfLocation`, () => run('boss', () => listOutOfLocationForAdmin('boss', '2026-10-01', '2026-10-31')));
    await take(`${label}:kpiAudience`, async () => {
      const template = await kpiTemplates().findOne({ org: ORG });
      return run('boss', () => kpiTemplateAudience('boss', template!._id!.toHexString(), '2026-11'));
    });
    await take(`${label}:kpiResolve`, () => run('boss', () => resolveKpiAudience('boss', { period: '2026-11', departments: ['Eng'] })));
    await take(`${label}:kpiMembers`, async () => {
      const template = await kpiTemplates().findOne({ org: ORG });
      return run('boss', () => kpiTemplateMembers('boss', template!._id!.toHexString(), '2026-11'));
    });
    await take(`${label}:shiftPolicy:a`, () => run('a', () => shiftPolicyFor('a')));
    await take(`${label}:notices:boss`, async () => {
      const boss = await users().findOne({ userId: 'boss' }, { projection: { profilePhotoUrl: 0 } });
      return run('boss', () => suwiNotices(contextFor(boss!, {} as never, TODAY), true));
    });
    await seedInbox(NORMAL_INBOX);
    await take(`${label}:inbox:a`, () => run('a', () => call(notificationInbox, 'a')));
    await take(`${label}:unread:a`, () => run('a', () => call(unreadNotificationCount, 'a')));
  }
  await take('appPage:sowaka', () => appPageFor(ORG, 'games-home'));
  await take('appPage:again', () => appPageFor(ORG, 'games-home'));
  await take('appPage:other', () => appPageFor('nobody-org', 'games-home'));
  await take('appPage:unknown-key', () => appPageFor(ORG, 'nope'));

  // Writes last, in order, each read back.
  await take('decide:a', async () => {
    const pending = await attendanceRegularizations().findOne({ userId: 'a', status: 'pending' });
    return asSignedIn('boss', () => adminDecideRegularization('boss', pending!._id!.toHexString(), { decision: 'approved', managerNote: 'ok' }));
  });
  await take('punch:a:in-office', () => asSignedIn('a', () => recordPunch('a', 'in', { ...HQ, accuracy: 10 })));
  await take('punch:c:no-reason', () => asSignedIn('c', () => recordPunch('c', 'in', { ...AWAY, accuracy: 10 })));
  await take('punch:c:outside', () => asSignedIn('c', () => recordPunch('c', 'in', { ...AWAY, accuracy: 10 }, 'Client visit')));
  await take('punch:c:again', () => asSignedIn('c', () => recordPunch('c', 'in', { ...AWAY, accuracy: 10 }, 'Client visit')));
  await take('punch:c:out', () => asSignedIn('c', () => recordPunch('c', 'out', { ...AWAY, accuracy: 10 }, 'Client visit')));
  // The notes go out after the answer on the new sources; wait for them.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await take('notes:after-punches', async () =>
    (await notifications().find({ userId: { $in: ['a', 'c', 'mgr'] }, scenario: { $ne: 'kudos' } }).sort({ userId: 1, scenario: 1 }).toArray())
      .map((row) => ({ userId: row.userId, scenario: row.scenario, title: row.title, body: row.body })));
  await take('regularizations:after', () => asSignedIn('boss', () => listAllRegularizationsForAdmin('boss')));

  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${Object.keys(out).length} answers to ${file}`);
}

/**
 * A cursor whose reads fail as the driver's do when the cluster is out of
 * reach: building it works, reading it rejects.
 */
function failingCursor(error: Error): unknown {
  const cursor: unknown = new Proxy(() => undefined, {
    get: (_target, prop) =>
      prop === 'then'
        ? undefined
        : ['toArray', 'next', 'hasNext', 'tryNext'].includes(String(prop))
          ? () => Promise.reject(error)
          : () => cursor,
  });
  return cursor;
}

/** Makes `method` fail for one collection until the returned function is called. */
function breakCollection(collection: string, method: 'find' | 'findOne' | 'aggregate' | 'countDocuments' | 'distinct', when: (filter: unknown) => boolean = () => true) {
  const proto = Collection.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = proto[method];
  proto[method] = function (this: Collection, ...args: unknown[]) {
    if (this.collectionName === collection && when(args[0])) {
      const error = new Error(`check: ${collection}.${method} is down`);
      return method === 'find' || method === 'aggregate' ? failingCursor(error) : Promise.reject(error);
    }
    return original.apply(this, args);
  };
  return () => { proto[method] = original; };
}

async function broken<T>(collection: string, method: Parameters<typeof breakCollection>[1], work: () => Promise<T>, when?: (filter: unknown) => boolean) {
  await forgetCaches();
  const restore = breakCollection(collection, method, when);
  try { return await work(); } finally { restore(); }
}

async function fails(work: () => Promise<unknown>) {
  try { await work(); return false; } catch { return true; }
}

async function degrade() {
  await seed();
  await forgetCaches();
  const home = await asSignedIn('a', () => gamesHomeFor('a'));
  check('the home is whole to start with', home.challenges.length === 1 && home.yourGames.length === 2 && home.liveContests.length === 1 && home.liveRelay !== null && home.banner !== null && home.playingNow.count > 0, home);

  console.log('games home: each section fails on its own');
  const noChallenges = await broken('game_challenges', 'find', () => asSignedIn('a', () => gamesHomeFor('a')));
  check('challenges down: no challenges, playing-now empty', noChallenges.challenges.length === 0 && noChallenges.playingNow.count === 0, noChallenges);
  check('…and the rest as it was', JSON.stringify(normalise({ ...noChallenges, challenges: [], playingNow: null })) === JSON.stringify(normalise({ ...home, challenges: [], playingNow: null })));
  const noRelay = await broken('relay_teams', 'find', () => asSignedIn('a', () => gamesHomeFor('a')));
  check('relay teams down: no relay card, the rest stands', noRelay.liveRelay === null && noRelay.games.length === 2 && noRelay.challenges.length === 1, noRelay);
  const noPosts = await broken('connect_posts', 'find', () => asSignedIn('a', () => gamesHomeFor('a')));
  check('contests down: none, the rest stands', noPosts.liveContests.length === 0 && noPosts.yourGames.length === 2, noPosts);
  const noScores = await broken('game_scores', 'find', () => asSignedIn('a', () => gamesHomeFor('a')));
  check('scores down: no banner, no games played, still a home', noScores.banner === null && noScores.yourGames.length === 0 && noScores.games.length === 2, noScores);
  check('the roster down fails the home', await broken('users', 'find', () => fails(() => asSignedIn('a', () => gamesHomeFor('a'))), (f) => JSON.stringify(f).includes('"org"')));
  check('the catalog down fails the home', await broken('game_catalog', 'aggregate', () => fails(() => asSignedIn('a', () => gamesHomeFor('a')))));
  await forgetCaches();
  const first = await asSignedIn('a', () => gamesHomeFor('a'));
  await gameCatalog().updateOne({ key: 'word-hunt' }, { $set: { name: 'Word Hunt 2' } });
  const cached = await asSignedIn('a', () => gamesHomeFor('a'));
  check('the catalog is kept for a minute', JSON.stringify(cached.games) === JSON.stringify(first.games));
  await forgetCaches();
  const fresh = await asSignedIn('a', () => gamesHomeFor('a'));
  check('and read again after', fresh.games.some((g) => g.name === 'Word Hunt 2'));

  console.log('app page');
  await forgetCaches();
  check('a failed read fails the request', await broken('app_pages', 'findOne', () => fails(() => appPageFor(ORG, 'games-home'))));
  const after = await appPageFor(ORG, 'games-home');
  check('and is not kept: the next one reads', after?.version === '1', after);
  await appPages().updateOne({ key: 'games-home' }, { $set: { html: '<html>v2</html>', version: 2 } });
  check('a kept page is served for a minute', (await appPageFor(ORG, 'games-home'))?.version === '1');
  await forgetCaches();
  check('and the new one after', (await appPageFor(ORG, 'games-home'))?.version === '2');

  console.log('workspace and snapshot');
  const workspace = await asSignedIn('mgr', () => getManagerWorkspace('mgr'));
  check('the workspace is whole to start with', workspace.nominations.length === 1 && workspace.recognitionHistory.some((n) => n.employeeName === 'Gita Gone'), workspace.recognitionHistory);
  const noRecognition = await broken('recognition_nominations', 'find', () => asSignedIn('mgr', () => getManagerWorkspace('mgr')));
  check('recognition down: an empty tab, the team as it was',
    noRecognition.nominations.length === 0 && noRecognition.recognitionHistory.length === 0 &&
      JSON.stringify(normalise(noRecognition.team)) === JSON.stringify(normalise(workspace.team)), noRecognition.nominations);
  const noHolidays = await broken('holidays', 'find', () => asSignedIn('mgr', () => getManagerWorkspace('mgr')));
  check('holidays down: none, the team as it was', noHolidays.holidays.length === 0 && noHolidays.team.length === workspace.team.length);
  const noInline = await broken('users', 'find', () => asSignedIn('mgr', () => getManagerWorkspace('mgr')), (f) => JSON.stringify(f).includes('"$in"'));
  check('inline photos down: initials for those, the rest as it was',
    noInline.team.find((m) => m.userId === 'a')?.photoUrl === null && noInline.team.find((m) => m.userId === 'b')?.photoUrl === '/media/connect%2Fb.jpg', noInline.team.map((m) => [m.userId, m.photoUrl]));
  check('the feedback down fails the workspace', await broken('feedback_records', 'find', () => fails(() => asSignedIn('mgr', () => getManagerWorkspace('mgr')))));
  const snap = await broken('users', 'findOne', () => asSignedIn('mgr', () => getFeedbackSnapshot('mgr')), (f) => (f as { userId?: string })?.userId === 'boss');
  check('the approver down: "Your manager", the rest as it was', snap.growthHistory[0]?.managerName === 'Your manager' && snap.team.length === 2, snap);

  console.log('feed');
  const feed = await broken('relay_events', 'find', () => asSignedIn('mgr', () => getConnectFeed('mgr', { limit: 10 })));
  const relayCard = feed.posts.find((p) => p.id === 'p-relay');
  check('game states down: the page, the card without its state', feed.posts.length === 4 && relayCard !== undefined && relayCard.body.status === undefined, relayCard?.body);

  console.log('inbox');
  await seedInbox(NORMAL_INBOX);
  const whole = await asSignedIn('a', () => call(notificationInbox, 'a'));
  const noPostsInbox = await broken('connect_posts', 'find', () => asSignedIn('a', () => call(notificationInbox, 'a')));
  check('posts down: the deleted post\'s row stays in, the rest as they were',
    (noPostsInbox.notifications as unknown[]).length === (whole.notifications as unknown[]).length + 1, [whole, noPostsInbox]);
  await seedInbox([
    ...NORMAL_INBOX,
    note('asked', 3, { scenario: 'leave_requested', data: { type: 'leave', requestId: '64b000000000000000000001' } }),
  ]);
  const row = (rows: unknown, id: string) => (rows as { id: string; resolved?: boolean }[]).find((r) => r.id === id);
  const allResolving = await asSignedIn('a', () => call(notificationInbox, 'a'));
  check('both rows resolve to start with', row(allResolving.notifications, 'punch')?.resolved === true && row(allResolving.notifications, 'asked')?.resolved === true, allResolving.notifications);
  const noRecords = await broken('attendance_records', 'find', () => asSignedIn('a', () => call(notificationInbox, 'a')));
  check('punches down: the reminder keeps its colour, the request row still resolves',
    row(noRecords.notifications, 'punch')?.resolved === undefined && row(noRecords.notifications, 'asked')?.resolved === true, noRecords.notifications);
  const noLeaves = await broken('leaves', 'find', () => asSignedIn('a', () => call(notificationInbox, 'a')));
  check('leaves down: the request row keeps its colour, the reminder still resolves',
    row(noLeaves.notifications, 'asked')?.resolved === undefined && row(noLeaves.notifications, 'punch')?.resolved === true, noLeaves.notifications);
  check('the rows themselves down fails the inbox', await broken('notifications', 'find', () => fails(() => asSignedIn('a', () => call(notificationInbox, 'a')))));

  console.log('unread count agrees with the inbox');
  const inboxUnread = async () =>
    ((await asSignedIn('a', () => call(notificationInbox, 'a'))).notifications as { readAt?: unknown; resolved?: boolean }[])
      .filter((r) => !r.readAt && r.resolved !== true).length;
  const cases: [string, Record<string, unknown>[]][] = [
    ['the usual rows', NORMAL_INBOX],
    ['nothing at all', []],
    ['an unread row older than the inbox\'s hundred', [
      ...Array.from({ length: 100 }, (_, i) => note(`r${i}`, i + 1, { readAt: ago(0) })),
      note('ancient', 10_000),
    ]],
    ['an unread reminder overtaken by a newer read one', [
      note('rem-new', 1, { scenario: 'pending_requests_reminder', readAt: ago(0) }),
      note('rem-old', 60, { scenario: 'pending_requests_reminder' }),
    ]],
    ['the newest reminder unread, with nothing pending', [
      note('rem-new', 1, { scenario: 'pending_requests_reminder' }),
      note('rem-old', 60, { scenario: 'pending_requests_reminder' }),
    ]],
  ];
  cases.push(['the newest reminder unread, with a request waiting on them', [
    note('rem-new', 1, { scenario: 'pending_requests_reminder' }),
    note('rem-old', 60, { scenario: 'pending_requests_reminder' }),
  ]]);
  for (const [label, rows] of cases) {
    // Divya reports to Asha: her leave is waiting on Asha in the last case.
    if (label.includes('waiting on them')) {
      await leaves().insertOne({ userId: 'd', type: 'casual', startDate: new Date(NOW + 86_400_000), endDate: new Date(NOW + 86_400_000), days: 1, reason: 'x', status: 'pending', createdAt: ago(5), updatedAt: ago(5) } as never);
    }
    await seedInbox(rows);
    const expected = await inboxUnread();
    const got = (await asSignedIn('a', () => call(unreadNotificationCount, 'a'))).unread;
    check(`${label}: ${expected}`, got === expected, { got, expected });
  }

  console.log('a degraded part is logged with its request');
  const lines: string[] = [];
  const write = console.error;
  console.error = (line: string) => { lines.push(String(line)); };
  try {
    await broken('relay_events', 'find', () =>
      new Promise((resolve, reject) => runWithRequestId('check-request-1', () => {
        asSignedIn('mgr', () => getConnectFeed('mgr', { limit: 10 })).then(resolve, reject);
      })));
  } finally { console.error = write; }
  const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((entry) => entry.part === 'Feed game states');
  check('with its id, its part and the error', logged?.requestId === 'check-request-1' && typeof (logged?.error as { message?: string })?.message === 'string', lines);

  console.log('HR lists');
  const regs = await asSignedIn('boss', () => listAllRegularizationsForAdmin('boss'));
  check('corrections: pending first, then newest, named with their managers',
    JSON.stringify(regs.map((r) => [r.userId, r.status, r.manager, r.employeeCode])) ===
      JSON.stringify([['a', 'pending', 'Manav Manager', 'E-A'], ['c', 'declined', 'Manav Manager', 'E-C'], ['b', 'approved', 'Manav Manager', 'E-B']]), regs);
  check('…with each person\'s face, inline or stored', regs[0].employee.photoUrl === INLINE && regs[2].employee.photoUrl === '/media/connect%2Fb.jpg', regs.map((r) => r.employee));

  console.log('notices');
  const boss = await users().findOne({ userId: 'boss' }, { projection: { profilePhotoUrl: 0 } });
  let leaveReads = 0;
  const restoreUsers = breakCollection('users', 'aggregate', (pipeline) => {
    if (JSON.stringify(pipeline).includes('"from":"leaves"')) leaveReads += 1;
    return false;
  });
  try {
    await asSignedIn('boss', () => suwiNotices(contextFor(boss!, {} as never, TODAY), true));
  } finally { restoreUsers(); }
  check('the leave list is read once for every notice', leaveReads === 1, leaveReads);
  const quiet = await broken('relay_events', 'countDocuments', () => asSignedIn('boss', () => suwiNotices(contextFor(boss!, {} as never, TODAY), true)));
  check('a list down: the other notices still come', Array.isArray(quiet), quiet);

  console.log('punch: the out-of-location note goes after the answer');
  const started = Date.now();
  const answer = await asSignedIn('c', () => recordPunch('c', 'in', { ...AWAY, accuracy: 10 }, 'Client visit')) as { request?: { status?: string } };
  check('the request is answered', answer.request?.status === 'pending', answer);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const told = await notifications().find({ userId: { $in: ['c', 'mgr'] }, scenario: { $in: ['correction_submitted', 'correction_requested'] } }).toArray();
  check('and both the employee and the manager are told', told.length === 2, told.map((n) => [n.userId, n.scenario]));
  void started;
}

(async () => {
  await connectDb();
  const [mode, file] = process.argv.slice(2);
  if (mode === 'snapshot' && file) await snapshot(file);
  else if (mode === 'degrade') await degrade();
  else throw new Error('usage: parallel-check.ts snapshot <file> | degrade');
  await getDb().dropDatabase();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
