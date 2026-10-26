/**
 * Scratch-database check of the app's busiest calls after their reads were
 * put together: the feedback snapshot, the workspace's team photos, the bell's
 * unread count, a feed page and a single post, and a punch. Each must answer
 * as it did before, in fewer round trips. It drops and recreates its own
 * database, and refuses any other. Run with
 * MONGODB_DB=sowaka_hotpaths_scratch NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch npm run hot-paths:check
 */
import type { Request, Response } from 'express';
import { attendanceRecords, connectPosts, connectDb, feedbackRecords, getDb, notifications, users } from '../config/db';
import { ConnectPost } from '../models/connect.model';
import { getConnectFeed, getConnectPost } from '../services/connect.service';
import { getFeedbackSnapshot, getManagerWorkspace } from '../services/manager.service';
import { recordPunch } from '../services/attendance.service';
import { unreadNotificationCount } from '../controllers/notification.controller';
import { currentPeriodFor } from '../services/cycle';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'sowaka';
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', ...extra,
});
const INLINE = 'data:image/png;base64,AAAA';
const people = [
  person('boss', 'Bina Boss', { department: 'Eng', profilePhotoUrl: 'https://cdn.test/boss.jpg' }),
  person('mgr', 'Manav Manager', { managerUserId: 'boss', department: 'Eng', employeeId: 'E-MGR' }),
  person('a', 'Asha', { managerUserId: 'mgr', department: 'Eng', profilePhotoUrl: INLINE, employeeId: 'E-A' }),
  person('b', 'Bala', { managerUserId: 'mgr', department: 'Eng', profilePhotoKey: 'connect/b.jpg' }),
  person('c', 'Chetan', { managerUserId: 'mgr', department: 'Eng', profilePhotoUrl: 'https://cdn.test/c.jpg', isLeadership: true, joiningDate: new Date('2023-10-02') }),
  person('left', 'Leaver', { managerUserId: 'mgr', department: 'Eng', lifecycleStatus: 'offboarded' }),
];

function post(partial: Partial<ConnectPost> & { type: ConnectPost['type'] }): ConnectPost {
  const now = new Date();
  return {
    id: `post-${Math.random().toString(36).slice(2)}`, org: ORG, tag: '', tagIcon: '', tagColor: '', tagTint: '',
    author: { userId: 'c', name: 'Chetan', initials: 'C', designation: '', avatarColor: '' },
    audience: { label: 'Company', org: ORG }, body: {}, likedBy: [], comments: [], actionBy: {}, pollVotes: {},
    publishedAt: now, createdAt: now, updatedAt: now, ...partial,
  } as ConnectPost;
}

/** Runs a controller as Express would and hands back what it sent. */
async function call(handler: (req: Request, res: Response, next: (error?: unknown) => void) => Promise<void>, userId: string) {
  let sent: unknown;
  let error: unknown;
  const res = { json: (body: unknown) => { sent = body; return res; }, status: () => res } as unknown as Response;
  await handler({ auth: { userId, token: 't' } } as unknown as Request, res, (e) => { error = e; });
  if (error) throw error;
  return sent as Record<string, unknown>;
}

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'sowaka_hotpaths_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany(people as never[]);

  // --- the feedback snapshot
  const period = await currentPeriodFor(ORG);
  const record = (managerUserId: string, employeeUserId: string, p: string, status: 'sent' | 'saved', overallScore: number) => ({
    managerUserId, employeeUserId, period: p, status, overallScore, parameters: [], extra: '', createdAt: new Date(), updatedAt: new Date(), sentAt: new Date(),
  });
  await feedbackRecords().insertMany([
    record('boss', 'mgr', '2026-01', 'sent', 3.24),
    record('boss', 'mgr', '2026-02', 'sent', 4.16),
    record('mgr', 'a', period, 'saved', 3),
    record('mgr', 'b', period, 'sent', 4.5),
    record('mgr', 'left', period, 'sent', 2),
    record('mgr', 'a', '2020-01', 'sent', 1),
  ] as never[]);
  const snapshot = await getFeedbackSnapshot('mgr');
  check('the snapshot is for this cycle', snapshot.period === period, snapshot.period);
  check("the viewer's own history, oldest first, named for their approver",
    JSON.stringify(snapshot.growthHistory.map((h) => [h.period, h.overallScore, h.managerName])) ===
      JSON.stringify([['2026-01', 3.2, 'Bina Boss'], ['2026-02', 4.2, 'Bina Boss']]), snapshot.growthHistory);
  check('the manager score is the latest sent', snapshot.managerScore === 4.2, snapshot.managerScore);
  check("the team is this cycle's records of active reports only",
    JSON.stringify(snapshot.team.map((t) => [t.userId, t.feedbackStatus]).sort()) === JSON.stringify([['a', 'saved'], ['b', 'sent']]), snapshot.team);
  const viewer = await users().findOne({ userId: 'mgr' });
  const preloaded = await getFeedbackSnapshot('mgr', viewer ?? undefined);
  check('the preloaded viewer gives the same snapshot', JSON.stringify(preloaded) === JSON.stringify(snapshot));

  // --- the workspace: every face, without the roster's inline photos
  const { profilePhotoUrl: _photo, ...viewerWithoutPhoto } = viewer!;
  for (const [label, preload] of [['read', undefined], ['preloaded', viewerWithoutPhoto]] as const) {
    const workspace = await getManagerWorkspace('mgr', preload);
    const photo = (id: string) => workspace.team.find((member) => member.userId === id)?.photoUrl;
    check(`${label}: the team is the manager, the viewer and their reports`,
      JSON.stringify(workspace.team.map((m) => m.userId)) === JSON.stringify(['boss', 'mgr', 'a', 'b', 'c']), workspace.team.map((m) => m.userId));
    check(`${label}: an inline photo still reaches its row`, photo('a') === INLINE, photo('a'));
    check(`${label}: a stored photo is its media path`, photo('b') === '/media/connect%2Fb.jpg?w=256', photo('b'));
    check(`${label}: a linked photo is the link`, photo('c') === 'https://cdn.test/c.jpg' && photo('boss') === 'https://cdn.test/boss.jpg', [photo('c'), photo('boss')]);
    check(`${label}: no photo is null`, photo('mgr') === null, photo('mgr'));
    check(`${label}: the approver is named`, workspace.approverName === 'Bina Boss', workspace.approverName);
  }

  // --- the bell's unread count, as the inbox counts it
  const note = (id: string, extra: Record<string, unknown> = {}) => ({
    id, userId: 'a', scenario: 'kudos', title: id, body: '', data: {}, createdAt: new Date(), pushed: false, ...extra,
  });
  check('nothing at all: none unread', (await call(unreadNotificationCount, 'a')).unread === 0);
  await notifications().insertMany([
    note('read', { readAt: new Date() }),
    note('gone', { data: { postId: 'deleted-post' } }),
    note('scribble-old', { scenario: 'scribble_invite', createdAt: new Date(Date.now() - 3 * 60 * 60_000) }),
    note('fresh'),
    note('fresh-2'),
  ] as never[]);
  const unread = await call(unreadNotificationCount, 'a');
  check('unread leaves out the read, the deleted post and the ended game', unread.unread === 2, unread);

  // --- a feed page and a single post: the people a card names
  const kudos = post({ type: 'kudos', body: { personUserId: 'a', taggedUserIds: ['b', 'c', 'nobody'] }, comments: [
    { id: 'cm1', userId: 'b', name: 'Bala', initials: 'B', text: 'Yay', createdAt: new Date() } as never,
  ] });
  const anniversary = post({ type: 'anniversary', author: { userId: '', name: 'Sowaka', initials: 'S', designation: '', avatarColor: '' }, body: { personUserId: 'c' } });
  await connectPosts().insertMany([kudos, anniversary] as never[]);
  const feed = await getConnectFeed('mgr', { limit: 10 });
  const single = await getConnectPost('mgr', kudos.id);
  for (const [label, view] of [['feed', feed.posts.find((p) => p.id === kudos.id)], ['single', single]] as const) {
    check(`${label}: the kudos' person's face`, view?.body.photoUrl === INLINE, view?.body.photoUrl);
    check(`${label}: tagged people in the author's order, the unknown dropped`,
      JSON.stringify((view?.body.taggedPeople as { userId: string }[] | undefined)?.map((t) => t.userId)) === JSON.stringify(['b', 'c']), view?.body.taggedPeople);
    check(`${label}: the author's live photo and pill`, view?.author.photoUrl === 'https://cdn.test/c.jpg' && view.author.isLeadership === true, view?.author);
    check(`${label}: a commenter's face`, view?.comments[0]?.photoUrl === '/media/connect%2Fb.jpg?w=256', view?.comments[0]);
  }
  const card = feed.posts.find((p) => p.id === anniversary.id);
  check('an anniversary names the team and the joining month', card?.body.personDepartment === 'Eng' && card.body.joinedOn === new Date('2023-10-02').toISOString(), card?.body);

  // --- a punch
  const punchedIn = (await recordPunch('a', 'in')) as Record<string, unknown>;
  check('a punch-in is written', typeof punchedIn.punchIn === 'string' && 'id' in punchedIn && Boolean(punchedIn.id), punchedIn);
  let refused = false;
  try { await recordPunch('a', 'in'); } catch (error) { refused = (error as { statusCode?: number }).statusCode === 409; }
  check('a second punch-in is refused', refused);
  const punchedOut = (await recordPunch('a', 'out')) as Record<string, unknown>;
  check('a punch-out comes back with both punches', typeof punchedOut.punchIn === 'string' && typeof punchedOut.punchOut === 'string', punchedOut);
  const day = await attendanceRecords().findOne({ employeeId: 'E-A' });
  check('the day holds both', Boolean(day?.punchIn && day.punchOut));
  let noId = false;
  try { await recordPunch('b', 'in'); } catch (error) { noId = (error as { statusCode?: number }).statusCode === 409; }
  check('someone with no employee id cannot punch', noId);
  // The employee's own notes land just after the answer.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const punchNotes = await notifications().find({ userId: 'a', scenario: { $in: ['punch_in', 'punch_out', 'punch_out_half_day'] } }).toArray();
  check('and both are told, after the answer', punchNotes.length >= 2, punchNotes.map((n) => n.scenario));

  await db.dropDatabase();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
