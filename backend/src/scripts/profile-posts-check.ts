/**
 * The Posts tab on a profile: one person's posts, as the viewer's own feed
 * would show them — never more.
 *
 * Runs against a scratch database, dropped after:
 *   MONGODB_DB=profile_posts_scratch npx tsx src/scripts/profile-posts-check.ts
 * It refuses any database whose name does not say scratch.
 *
 * Covered: another company, a Team or list post the viewer is not on, a post
 * deleted by its author or taken down by HR, a reported one (reporting does
 * not hide, in the feed or here), a blocked author, paging on the feed's
 * cursor, the count for the tab's badge, and someone with no posts at all.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, connectBlocks, connectDb, connectPosts, contentReports, getDb, users } from '../config/db';
import { env } from '../config/env';
import type { ConnectAudience, ConnectPost, ConnectPostType } from '../models/connect.model';
import type { ContentReport } from '../models/moderation.model';
import type { User } from '../models/user.model';
import {
  ConnectError,
  deleteConnectPost,
  getConnectFeed,
  getConnectPersonPosts,
} from '../services/connect.service';

let failures = 0;
function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const org = 'sowaka';
const otherOrg = 'othercompany_scratch';

async function profileChecks() {
  await connectDb();
  console.log(`\nusing scratch database "${env.mongoDbName}"`);

  const person = (userId: string, extra: Partial<User> = {}) =>
    ({
      userId,
      name: `Person ${userId}`,
      email: `${userId}@sowaka.check`,
      employeeId: userId,
      org,
      lifecycleStatus: 'active',
      ...extra,
    }) as unknown as User;
  await users().insertMany([
    // Whose profile it is: in the boss's team.
    person('ananya', { managerUserId: 'boss', department: 'Product' }),
    // A colleague in the same team, who sees its Team posts.
    person('teammate', { managerUserId: 'boss', department: 'Product' }),
    // A colleague in another team and department.
    person('viewer', { managerUserId: 'other-boss', department: 'Sales' }),
    // A colleague who has muted Ananya.
    person('muter', { managerUserId: 'other-boss', department: 'Sales' }),
    person('hr', { dashboardAccess: true, department: 'HR' }),
    person('quiet'),
    person('outsider', { org: otherOrg, email: 'outsider@elsewhere.check' }),
  ]);
  await connectBlocks().insertOne({ userId: 'muter', blockedUserId: 'ananya', org, createdAt: new Date() } as never);

  // Oldest first, a second apart, so the order is the order of insertion.
  let clock = Date.now() - 6 * 3_600_000;
  const post = (
    type: ConnectPostType,
    extra: Partial<ConnectPost> = {},
    authorUserId = 'ananya',
  ): ConnectPost => {
    const when = new Date((clock += 1_000));
    return {
      id: randomUUID(),
      org,
      type,
      tag: type,
      tagIcon: '',
      tagColor: '',
      tagTint: '',
      author: {
        userId: authorUserId,
        name: `Person ${authorUserId}`,
        initials: 'P',
        designation: '',
        avatarColor: '#000',
      },
      audience: { label: 'Public', org },
      body: { text: `${type} ${when.toISOString()}` },
      likedBy: [],
      comments: [],
      actionBy: {},
      pollVotes: {},
      publishedAt: when,
      createdAt: when,
      updatedAt: when,
      ...extra,
    } as ConnectPost;
  };
  const listAudience = (userIds: string[]): ConnectAudience => ({
    label: 'Private',
    org,
    listId: randomUUID(),
    listName: 'A list',
    userIds: ['ananya', ...userIds],
  });

  const publicPosts = Array.from({ length: 11 }, () => post('new_post'));
  const announcement = post('hr_announcement');
  const teamPost = post('new_post', { audience: { label: 'Team', org, teamId: 'boss' } });
  const departmentPost = post('new_post', { audience: { label: 'Team', org, department: 'Product' } });
  const listWithViewer = post('new_post', { audience: listAudience(['viewer']) });
  const listWithoutViewer = post('new_post', { audience: listAudience(['teammate']) });
  const reported = post('new_post');
  const deletedByAuthor = post('new_post');
  const takenDownByHr = post('new_post');
  const someoneElses = post('new_post', {}, 'teammate');
  // Hers, but filed under another company — as if the record were wrong.
  const elsewhere = post('new_post', { org: otherOrg, audience: { label: 'Public', org: otherOrg } });
  const outsidersOwn = post('new_post', { org: otherOrg, audience: { label: 'Public', org: otherOrg } }, 'outsider');
  // A birthday card names her but is written by the company.
  const birthday = post('birthday', {
    author: { name: 'Sowaka', initials: 'S', designation: 'Auto · HRIS', avatarColor: '#C98A2E' },
    body: { personUserId: 'ananya', personName: 'Person ananya' },
  });
  await connectPosts().insertMany([
    ...publicPosts,
    announcement,
    teamPost,
    departmentPost,
    listWithViewer,
    listWithoutViewer,
    reported,
    deletedByAuthor,
    takenDownByHr,
    someoneElses,
    elsewhere,
    outsidersOwn,
    birthday,
  ]);
  await contentReports().insertOne({
    id: randomUUID(),
    org,
    postId: reported.id,
    reason: 'spam',
    reporterUserId: 'viewer',
    reporterName: 'Person viewer',
    authorUserId: 'ananya',
    authorName: 'Person ananya',
    excerpt: 'reported',
    postTag: 'new_post',
    status: 'open',
    createdAt: new Date(),
  } as unknown as ContentReport);
  await deleteConnectPost('ananya', deletedByAuthor.id);
  await deleteConnectPost('hr', takenDownByHr.id);

  type Shown = { id: string; author: { userId?: string } };
  async function allPages(viewerUserId: string, personUserId: string, limit: number) {
    const seen: Shown[] = [];
    const totals: Array<number | undefined> = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 30; i += 1) {
      const page = await getConnectPersonPosts(viewerUserId, personUserId, { limit, cursor });
      seen.push(...(page.posts as unknown as Shown[]));
      totals.push(page.total);
      sizes.push(page.posts.length);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return { seen, totals, sizes };
  }
  /** What the viewer's own feed shows of hers, every page of it. */
  async function feedOfHers(viewerUserId: string) {
    const seen: Shown[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 30; i += 1) {
      const page = await getConnectFeed(viewerUserId, { limit: 50, cursor });
      seen.push(...(page.posts as unknown as Shown[]));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return seen.filter((item) => item.author.userId === 'ananya').map((item) => item.id);
  }
  const ids = (shown: Shown[]) => shown.map((item) => item.id);
  const newestFirst = (list: ConnectPost[]) =>
    [...list].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((item) => item.id);
  async function refusal(job: () => Promise<unknown>) {
    try {
      await job();
      return null;
    } catch (error) {
      return error instanceof ConnectError ? error.statusCode : -1;
    }
  }

  console.log('\nA colleague in another team');
  const viewer = await allPages('viewer', 'ananya', 5);
  const viewerExpected = newestFirst([...publicPosts, announcement, listWithViewer, reported]);
  check(
    'her company posts, her announcement and the list she put them on, newest first',
    JSON.stringify(ids(viewer.seen)) === JSON.stringify(viewerExpected),
    `${viewer.seen.length} shown, ${viewerExpected.length} expected`,
  );
  check(
    'exactly what their own feed shows of hers, in the same order',
    JSON.stringify(ids(viewer.seen)) === JSON.stringify(await feedOfHers('viewer')),
  );
  check('not her Team post', !ids(viewer.seen).includes(teamPost.id));
  check('not her department post', !ids(viewer.seen).includes(departmentPost.id));
  check('not a list they are not on', !ids(viewer.seen).includes(listWithoutViewer.id));
  check('a reported post still shows, as it does in the feed', ids(viewer.seen).includes(reported.id));
  check('not a post she deleted', !ids(viewer.seen).includes(deletedByAuthor.id));
  check('not a post HR took down', !ids(viewer.seen).includes(takenDownByHr.id));
  check('not one filed under another company', !ids(viewer.seen).includes(elsewhere.id));
  check("not someone else's post", !ids(viewer.seen).includes(someoneElses.id));
  check('not the birthday card that names her', !ids(viewer.seen).includes(birthday.id));

  console.log('\nPaging');
  check('pages of five, then the rest', JSON.stringify(viewer.sizes) === JSON.stringify([5, 5, 4]), JSON.stringify(viewer.sizes));
  check('nothing shows twice', new Set(ids(viewer.seen)).size === viewer.seen.length);
  check('the count comes with the first page', viewer.totals[0] === viewerExpected.length, String(viewer.totals[0]));
  check('and only the first', viewer.totals.slice(1).every((total) => total === undefined));
  const exact = await allPages('viewer', 'ananya', viewerExpected.length);
  check('a page that ends exactly at the last post has no cursor after it', exact.sizes.length === 1);
  const newer = post('new_post');
  const firstPage = await getConnectPersonPosts('viewer', 'ananya', { limit: 5 });
  await connectPosts().insertOne(newer);
  const secondPage = await getConnectPersonPosts('viewer', 'ananya', { limit: 5, cursor: firstPage.nextCursor ?? undefined });
  check(
    'a post made between two pages shifts nothing already shown',
    JSON.stringify(ids(secondPage.posts as unknown as Shown[])) === JSON.stringify(viewerExpected.slice(5, 10)),
  );
  await connectPosts().deleteOne({ id: newer.id });
  check('a cursor that is not one is refused', (await refusal(() => getConnectPersonPosts('viewer', 'ananya', { cursor: 'nonsense' }))) === 400);

  console.log('\nHer teammate');
  const teammate = await allPages('teammate', 'ananya', 50);
  check('sees her Team and department posts too', ids(teammate.seen).includes(teamPost.id) && ids(teammate.seen).includes(departmentPost.id));
  check('and the list they are on, not the other', ids(teammate.seen).includes(listWithoutViewer.id) && !ids(teammate.seen).includes(listWithViewer.id));
  check('exactly what their own feed shows of hers', JSON.stringify(ids(teammate.seen)) === JSON.stringify(await feedOfHers('teammate')));

  console.log('\nSomeone who has blocked her');
  const muter = await allPages('muter', 'ananya', 5);
  check('sees only what a block never hides: her announcement', JSON.stringify(ids(muter.seen)) === JSON.stringify([announcement.id]));
  check('and the count says so', muter.totals[0] === 1, String(muter.totals[0]));
  check('exactly what their own feed shows of hers', JSON.stringify(ids(muter.seen)) === JSON.stringify(await feedOfHers('muter')));

  console.log('\nHer own profile');
  const own = await allPages('ananya', 'ananya', 50);
  check(
    'every post of hers in the company, lists included',
    ids(own.seen).includes(listWithViewer.id) && ids(own.seen).includes(listWithoutViewer.id) && ids(own.seen).includes(teamPost.id),
  );
  check('still not the deleted ones or the other company', ![deletedByAuthor, takenDownByHr, elsewhere].some((p) => ids(own.seen).includes(p.id)));

  console.log('\nAnother company');
  check('someone outside the company finds no profile to read', (await refusal(() => getConnectPersonPosts('outsider', 'ananya'))) === 404);
  check('nor can anyone here read theirs', (await refusal(() => getConnectPersonPosts('viewer', 'outsider'))) === 404);
  check('nor someone who does not exist', (await refusal(() => getConnectPersonPosts('viewer', 'nobody'))) === 404);
  check('nor no one at all', (await refusal(() => getConnectPersonPosts('viewer', ''))) === 404);

  console.log('\nNo posts yet');
  const quiet = await getConnectPersonPosts('viewer', 'quiet');
  check('an empty page', quiet.posts.length === 0);
  check('with no cursor', quiet.nextCursor === null);
  check('and a count of nought', quiet.total === 0, String(quiet.total));

  console.log('\nWhat a card is sent');
  const card = (await getConnectPersonPosts('viewer', 'ananya', { limit: 1 })).posts[0] as unknown as Record<string, unknown>;
  const audience = card.audience as Record<string, unknown>;
  check("the feed's own card, author and all", typeof card.id === 'string' && typeof card.author === 'object');
  check('never who else a list went to', !JSON.stringify(viewer.seen).includes('"userIds"'));
  check('never the raw like list', !('likedBy' in card));
  check('nor the votes, who acted, or the stored ids', !['pollVotes', 'actionBy', '_id', 'org'].some((key) => key in card));
  check('but what the card draws', ['liked', 'likeCount', 'commentCount', 'comments', 'body', 'publishedAt'].every((key) => key in card));
  check('the audience as the feed shows it', audience.label === 'Public' || audience.label === 'Private');
}

async function main() {
  if (!/scratch/i.test(env.mongoDbName)) {
    console.log(`\nskipping: "${env.mongoDbName}" is not a scratch database (MONGODB_DB=profile_posts_scratch)`);
    return;
  }
  try {
    await profileChecks();
  } finally {
    await getDb().dropDatabase();
    console.log(`\ndropped scratch database "${env.mongoDbName}"`);
    await closeDb();
  }
}

main()
  .catch((error) => {
    console.error('\ncheck crashed:', error);
    failures += 1;
  })
  .finally(() => {
    console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
