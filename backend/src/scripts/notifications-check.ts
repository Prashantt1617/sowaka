/**
 * Scratch-database check of the notification spec (Sowaka_notifications_final.xlsx).
 * It drops and recreates its own database, and refuses any other. Run with
 * MONGODB_DB=sowaka_notifcheck NOTIFY_ORGS=sowaka EMAIL_ORGS=nobody-scratch npm run notifications:check
 */
import { randomUUID } from 'node:crypto';
import { connectDb, getDb, notifications } from '../config/db';
import { ConnectPost } from '../models/connect.model';
import {
  mostLikelyPrompt, notifyContestVote, notifyLiveGameStarted, notifyMostLikelyTag,
  notifyPollVoted, notifyPostCommented, notifyPostLiked, notifyPostPublished,
} from '../services/connect-notifications.service';
import { flushGroupedNotifications } from '../services/notification-groups.service';
import { sendNewJoinerNotifications } from '../services/notification.service';
import { notifyLeaveDecided, notifyLeaveSubmitted, sendLeaveNextWeek, sendPendingRequestReminders } from '../services/request-notifications.service';
import { msToNextIstHour } from '../services/notification-scheduler.service';
import { dateRange, tueThuDueFor } from '../services/notification-time';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}

const ORG = 'sowaka';
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@example.invalid`, org: ORG, lifecycleStatus: 'active', ...extra,
});
const people = [
  person('hr', 'Hema HR', { dashboardAccess: true, department: 'HR' }),
  person('mgr', 'Manav Manager', { department: 'Eng' }),
  person('a', 'Asha', { managerUserId: 'mgr', department: 'Eng', location: 'Pune' }),
  person('b', 'Bala', { managerUserId: 'mgr', department: 'Eng' }),
  person('c', 'Chetan', { department: 'Sales' }),
  person('d', 'Divya', { managerUserId: 'a', department: 'Design' }),
  person('left', 'Leaver', { managerUserId: 'mgr', department: 'Eng', lifecycleStatus: 'offboarded' }),
];

function post(partial: Partial<ConnectPost> & { type: ConnectPost['type'] }): ConnectPost {
  const now = new Date();
  return {
    id: randomUUID(), org: ORG, tag: '', tagIcon: '', tagColor: '', tagTint: '',
    author: { userId: 'b', name: 'Bala', initials: 'B', designation: '', avatarColor: '' },
    audience: { label: 'Company', org: ORG }, body: {}, likedBy: [], comments: [], actionBy: {}, pollVotes: {},
    publishedAt: now, createdAt: now, updatedAt: now, ...partial,
  } as ConnectPost;
}

async function inbox(postId: string) {
  return notifications().find({ 'data.postId': postId }).toArray();
}
const byUser = (rows: Awaited<ReturnType<typeof inbox>>, userId: string) => rows.filter((r) => r.userId === userId);
const user = (id: string) => getDb().collection('users').findOne({ userId: id }) as never;

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'sowaka_notifcheck') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await db.collection('users').insertMany(people as never[]);

  // --- pure bits
  check('prompt from "Who is most likely to eat your lunch?"', mostLikelyPrompt('Who is most likely to eat your lunch?') === 'eat your lunch');
  check('prompt from "whos most likely ot eb late to the office"', mostLikelyPrompt('whos most likely ot eb late to the office') === 'eb late to the office');
  check('no prompt from "Aaj kaam ka mood nahi hai"', mostLikelyPrompt('Aaj kaam ka mood nahi hai') === null);
  check('next IST hour from 08:10 UTC is 20 min', msToNextIstHour(new Date('2026-10-20T08:10:00Z')) === 20 * 60_000);
  check('next IST hour from 08:30 UTC is a full hour', msToNextIstHour(new Date('2026-10-20T08:30:00Z')) === 60 * 60_000);
  check('date range in one month', dateRange('2026-10-10', '2026-10-12') === '10–12 Oct', dateRange('2026-10-10', '2026-10-12'));
  check('date range across months', dateRange('2026-09-30', '2026-10-02') === '30 Sep – 2 Oct');

  // --- birthday: manager, reports, department; never the person; never a leaver
  const bday = post({ type: 'birthday', author: { userId: '', name: 'Sowaka', initials: 'S', designation: '', avatarColor: '' }, body: { personUserId: 'a', personName: 'Asha' } });
  await db.collection('connect_posts').insertOne(bday as never);
  await notifyPostPublished(bday);
  let rows = await inbox(bday.id);
  check('birthday reaches mgr, b, d only', JSON.stringify(rows.map((r) => r.userId).sort()) === JSON.stringify(['b', 'd', 'mgr']), rows.map((r) => r.userId));
  check('birthday copy', rows[0]?.title === "🎂 It's Asha's birthday!" && rows[0]?.body === 'Drop a wish and make their day' && rows[0]?.pushed === true, rows[0]);

  const anniv = post({ type: 'anniversary', author: { userId: '', name: 'Sowaka', initials: 'S', designation: '', avatarColor: '' }, body: { personUserId: 'b', personName: 'Bala', years: 2 } });
  await notifyPostPublished(anniv);
  rows = await inbox(anniv.id);
  check('anniversary copy', rows[0]?.title === '🎉 Bala completes 2 years today' && rows[0]?.body === 'Celebrate their journey', rows[0]);

  // --- ordinary post: inbox only, except the tagged person
  const ordinary = post({ type: 'new_post', body: { text: 'Lunch pics', taggedUserIds: ['c'] } });
  await db.collection('connect_posts').insertOne(ordinary as never);
  await notifyPostPublished(ordinary);
  rows = await inbox(ordinary.id);
  check('ordinary post: everyone else inbox only', rows.filter((r) => r.userId !== 'c').every((r) => r.pushed === false) && rows.length === 5, rows.map((r) => [r.userId, r.pushed]));
  check('ordinary post: tagged person pushed', byUser(rows, 'c')[0]?.pushed === true && byUser(rows, 'c')[0]?.title === 'Bala tagged you in a post');
  check('ordinary post: author hears nothing', byUser(rows, 'b').length === 0);

  const mustRead = post({ type: 'new_post', author: { userId: 'c', name: 'Chetan', initials: 'C', designation: '', avatarColor: '' }, body: { text: 'Read this', priority: 'must_read' } });
  await notifyPostPublished(mustRead);
  rows = await inbox(mustRead.id);
  check('must read pushes to everyone', rows.length === 5 && rows.every((r) => r.pushed), rows.map((r) => [r.userId, r.pushed]));

  const announce = post({ type: 'hr_announcement', author: { userId: 'hr', name: 'Hema HR', initials: 'H', designation: '', avatarColor: '' }, body: { title: 'Diwali hours' } });
  await notifyPostPublished(announce);
  rows = await inbox(announce.id);
  check('HR announcement pushes', rows.every((r) => r.pushed && r.title === 'New announcement from HR' && r.body === 'Diwali hours') && rows.length === 5, rows[0]);

  const colleaguePoll = post({ type: 'survey', author: { userId: 'c', name: 'Chetan', initials: 'C', designation: '', avatarColor: '' }, body: { question: 'Pizza?' } });
  await notifyPostPublished(colleaguePoll);
  rows = await inbox(colleaguePoll.id);
  check('colleague poll: inbox only', rows.every((r) => r.pushed === false) && rows.length === 5);
  const managerPoll = post({ type: 'survey', author: { userId: 'mgr', name: 'Manav Manager', initials: 'M', designation: '', avatarColor: '' }, body: { question: 'Offsite?' } });
  await notifyPostPublished(managerPoll);
  rows = await inbox(managerPoll.id);
  check('manager poll: own reports pushed', byUser(rows, 'a')[0]?.pushed === true && byUser(rows, 'a')[0]?.title === 'Your manager wants your opinion');
  check('manager poll: others inbox only', byUser(rows, 'c')[0]?.pushed === false);

  const listPost = post({ type: 'new_post', audience: { label: 'List', org: ORG, userIds: ['a', 'c', 'b'] }, body: { text: 'For you two', sendTo: 'list' } });
  await notifyPostPublished(listPost);
  rows = await inbox(listPost.id);
  check('limited list: only the list, pushed', JSON.stringify(rows.map((r) => r.userId).sort()) === '["a","c"]' && rows.every((r) => r.pushed && r.title === 'Bala shared a post with you'), rows.map((r) => [r.userId, r.title]));

  const kudos = post({ type: 'kudos', body: { text: 'Shipped the release overnight.\nThank you!', recipientUserIds: ['a'] } });
  await notifyPostPublished(kudos);
  rows = await inbox(kudos.id);
  check('kudos: recipient pushed with first line', byUser(rows, 'a')[0]?.title === 'Bala gave you kudos 🎉' && byUser(rows, 'a')[0]?.body === 'Shipped the release overnight.' && byUser(rows, 'a')[0]?.pushed === true);
  check('kudos: others inbox only', byUser(rows, 'c')[0]?.pushed === false);

  const contest = post({ type: 'caption_challenge', author: { userId: 'hr', name: 'Hema HR', initials: 'H', designation: '', avatarColor: '' }, body: { title: 'Caption this', closesAt: '2026-10-20T12:00:00.000Z' } });
  await db.collection('connect_posts').insertOne(contest as never);
  await notifyPostPublished(contest);
  rows = await inbox(contest.id);
  check('new contest copy', rows.length === 5 && rows.every((r) => r.pushed && r.title === 'New contest: Caption this' && r.body === 'Enter by 20 Oct'), rows[0]);

  const joinee = post({ type: 'new_joinee', body: { personName: 'X' } });
  await notifyPostPublished(joinee);
  check('new joinee post sends nothing (10:00 job does)', (await inbox(joinee.id)).length === 0);

  // --- contest votes and tags
  await notifyContestVote(contest, 'a', await user('b'));
  rows = byUser(await inbox(contest.id), 'a');
  check('caption vote push', rows.some((r) => r.title === 'Bala voted for your caption' && r.body === 'Caption this' && r.pushed));
  const ml = post({ type: 'most_likely', author: { userId: 'hr', name: 'Hema HR', initials: 'H', designation: '', avatarColor: '' }, body: { title: 'Most Likely', question: 'Who is most likely to eat your lunch?' } });
  await notifyMostLikelyTag(ml, 'c', 'a');
  rows = await inbox(ml.id);
  check('most likely tag is anonymous', rows.length === 1 && rows[0].userId === 'c' && rows[0].title === "Someone thinks you're most likely to eat your lunch 😄" && !rows[0].title.includes('Asha'), rows[0]);

  // --- comments, grouped
  const t0 = new Date();
  const c1 = { id: 'c1', userId: 'a', name: 'Asha', text: 'nice', createdAt: t0, likedBy: [] };
  await notifyPostCommented(ordinary, c1 as never, await user('a'), ['d']);
  rows = await notifications().find({ 'data.postId': ordinary.id, scenario: { $in: ['post_commented', 'comment_mention', 'post_commented_inbox'] } }).toArray();
  check('author grouped push, first comment at once', byUser(rows, 'b').some((r) => r.title === 'Asha commented on your post' && r.pushed));
  check('mention pushed', byUser(rows, 'd').some((r) => r.title === 'Asha mentioned you in a comment' && r.pushed));
  check('tagged gets inbox only', byUser(rows, 'c').some((r) => r.scenario === 'post_commented_inbox' && r.pushed === false));
  const withC1 = { ...ordinary, comments: [c1] } as ConnectPost;
  await notifyPostCommented(withC1, { ...c1, id: 'c2', userId: 'mgr', name: 'Manav Manager' } as never, await user('mgr'));
  await notifyPostCommented(withC1, { ...c1, id: 'c3', userId: 'hr', name: 'Hema HR' } as never, await user('hr'));
  rows = await notifications().find({ 'data.postId': ordinary.id, userId: 'b', scenario: 'post_commented' }).toArray();
  check('second and third comments gathered, not pushed', rows.length === 1, rows.length);
  rows = await notifications().find({ 'data.postId': ordinary.id, userId: 'a', scenario: 'post_also_commented' }).toArray();
  check('earlier commenter: first "also commented" at once', rows.length === 1 && rows[0].title === 'Manav Manager also commented', rows.map((r) => r.title));
  await flushGroupedNotifications(new Date(Date.now() + 3 * 3_600_000 + 1000));
  rows = await notifications().find({ 'data.postId': ordinary.id, userId: 'b', scenario: 'post_commented' }).sort({ createdAt: 1 }).toArray();
  check('after 3h the gathered comments go as one', rows.length === 2 && rows[1].title === 'Hema HR and 1 other commented on your post', rows.map((r) => r.title));

  const wish = { id: 'w1', userId: 'b', name: 'Bala', text: 'HBD', createdAt: t0, likedBy: [] };
  await notifyPostCommented(bday, wish as never, await user('b'));
  await notifyPostCommented({ ...bday, comments: [wish] } as ConnectPost, { ...wish, id: 'w2', userId: 'mgr', name: 'Manav Manager' } as never, await user('mgr'));
  rows = await inbox(bday.id);
  check('celebrant gets "wished you 🎂"', byUser(rows, 'a').some((r) => r.title === 'Bala wished you 🎂'));
  check('no "also commented" on a birthday card', byUser(rows, 'b').every((r) => r.scenario !== 'post_also_commented'));

  // --- likes and votes
  await db.collection('connect_posts').updateOne({ id: ordinary.id }, { $set: { likedBy: ['d'], comments: [c1] } });
  await notifyPostLiked(ordinary, await user('d'));
  rows = await notifications().find({ 'data.postId': ordinary.id, scenario: { $in: ['post_liked', 'post_liked_inbox'] } }).toArray();
  check('like: author pushed', byUser(rows, 'b').some((r) => r.title === 'Divya liked your post' && r.pushed));
  check('like: tagged and commenter inbox only', byUser(rows, 'c')[0]?.pushed === false && byUser(rows, 'a')[0]?.pushed === false, rows.map((r) => [r.userId, r.pushed]));

  const poll = post({ type: 'survey', pollVotes: { a: 'x', c: 'y' } });
  await db.collection('connect_posts').insertOne(poll as never);
  await notifyPollVoted(poll, await user('c'));
  rows = await inbox(poll.id);
  check('poll: creator "1 person voted"', byUser(rows, 'b').some((r) => r.title === '1 person voted on your poll' && r.pushed));
  check('poll: earlier voter inbox only', byUser(rows, 'a')[0]?.pushed === false && byUser(rows, 'a')[0]?.title === 'Chetan also voted');

  // --- live game
  const live = post({ type: 'live_game', author: { userId: 'hr', name: 'Sowaka', initials: 'G', designation: '', avatarColor: '' }, body: { title: 'Odd One Out' } });
  await notifyLiveGameStarted(live, 'Hema HR');
  rows = await inbox(live.id);
  check('live game copy', rows.length === 5 && rows[0].title === '🎮 Live Odd One Out starting now' && rows[0].body === 'Hema HR is hosting. Join in!');

  // --- requests
  await notifyLeaveSubmitted({ employeeUserId: 'a', requestId: 'L1', type: 'casual', startDate: new Date('2026-10-26'), endDate: new Date('2026-10-28'), days: 3, reason: 'trip' });
  rows = await notifications().find({ 'data.requestId': 'L1' }).toArray();
  check('leave submitted: employee inbox only', byUser(rows, 'a')[0]?.pushed === false && byUser(rows, 'a')[0]?.title === 'Leave request sent');
  check('leave submitted: manager pushed', byUser(rows, 'mgr')[0]?.pushed === true && byUser(rows, 'mgr')[0]?.body === '26–28 Oct (3 days)', byUser(rows, 'mgr')[0]);
  await notifyLeaveDecided({ employeeUserId: 'a', requestId: 'L1', type: 'casual', startDate: new Date('2026-10-26'), endDate: new Date('2026-10-28'), days: 3, approved: true, comment: '', decidedByUserId: 'mgr' });
  rows = await notifications().find({ 'data.requestId': 'L1', scenario: 'leave_decided' }).toArray();
  check('leave approved copy', rows[0]?.title === 'Leave approved ✓' && rows[0]?.body.startsWith('Manav Manager approved'), rows[0]);

  await db.collection('leaves').insertOne({ userId: 'b', status: 'pending', type: 'casual', startDate: new Date('2026-10-27'), endDate: new Date('2026-10-27'), createdAt: new Date('2026-10-19T05:00:00Z') } as never);
  const wed = await sendPendingRequestReminders(new Date('2026-10-21T08:30:00Z'));
  check('pending reminder: nothing on a Wednesday', wed === 0, wed);
  const tue = await sendPendingRequestReminders(new Date('2026-10-20T08:30:00Z'));
  rows = await notifications().find({ scenario: 'pending_requests_reminder' }).toArray();
  check('pending reminder: Tuesday 14:00 to the manager', tue === 1 && rows[0]?.userId === 'mgr' && rows[0]?.title === '1 request waiting on you' && rows[0]?.body === '1 leave · oldest from Mon 19 Oct', rows[0]);
  check('pending reminder: once a day', (await sendPendingRequestReminders(new Date('2026-10-20T09:30:00Z'))) === 0);
  await db.collection('holidays').insertOne({ org: ORG, state: '*', date: new Date('2026-10-22T00:00:00Z'), name: 'Test holiday' } as never);
  check('Thursday holiday: not due on Thursday', !(await tueThuDueFor(people[1], '2026-10-22')));
  check('Thursday holiday: due on Friday', await tueThuDueFor(people[1], '2026-10-23'));
  check('Saturday after a Friday reminder: not due', !(await tueThuDueFor(people[1], '2026-10-24')));

  await db.collection('leaves').insertOne({ userId: 'a', status: 'approved', type: 'casual', startDate: new Date('2026-10-26'), endDate: new Date('2026-10-28') } as never);
  await sendLeaveNextWeek(new Date('2026-10-23T10:30:00Z'));
  rows = await notifications().find({ scenario: 'leave_planning' }).toArray();
  check('leave next week', rows[0]?.userId === 'mgr' && rows[0]?.body === 'Asha (Mon–Wed)', rows[0]);

  // --- new joiner
  await db.collection('users').insertOne(person('new', 'Nikhil', { managerUserId: 'mgr', department: 'Eng', joiningDate: new Date('2026-10-20T00:00:00Z') }) as never);
  await sendNewJoinerNotifications(new Date('2026-10-20T04:30:00Z'));
  rows = await notifications().find({ scenario: 'new_joiner' }).toArray();
  check('new joiner: manager and team, not the joiner, not a leaver', JSON.stringify(rows.map((r) => r.userId).sort()) === '["a","b","mgr"]' && rows[0].title === 'Nikhil joined your team today 👋', rows.map((r) => r.userId));

  check('the leaver got nothing at all', (await notifications().countDocuments({ userId: 'left' })) === 0);

  await db.dropDatabase();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
