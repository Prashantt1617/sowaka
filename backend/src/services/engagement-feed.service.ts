import { ObjectId } from 'mongodb';
import { connectPosts, contentReports, gameScores, getDb, notifications, users } from '../config/db';
import type { ConnectAudience, ConnectPost } from '../models/connect.model';
import type { User } from '../models/user.model';
import {
  ConnectError,
  FEED_MAX_PINNED,
  deleteConnectPost,
  encodeFeedCursor,
  orgForUser,
} from './connect.service';
import { closeReportsForRemovedPost } from './connect-moderation.service';
import { emitConnectChange } from './connect-realtime.service';
import { audienceAllows, feedAudienceFilter, isListAudience, realtimeUserIds } from './audience-list-rules';
import { presignConnectMedia, resolveProfilePhoto } from './s3-connect-media.service';

/**
 * Dashboard › Engagement › Feed: the company's Connect feed as HR reads it.
 *
 * Read-mostly. The feed is the org's `connect_posts` in the app's own order
 * (live pins first, then newest), drawn from the stored documents rather than
 * through the app's per-viewer `viewPost`, which would hide posts HR is not in
 * the audience of. The writes are pinning (the `pinnedUntil` field the app's
 * feed already reads), removing a post (the app's own delete) and removing a
 * comment (the app's own rules, without the audience check HR would fail).
 */

type Admin = Pick<User, 'userId' | 'org' | 'email' | 'name'>;

/** How many posts one page of the dashboard's feed holds. */
const PAGE = 20;
/** Media is drawn about this wide in the dashboard's phone-sized column. */
const MEDIA_W = 720;
const PEOPLE_GONE = ['offboarded', 'terminated'];

export type FeedAs = 'all' | 'company' | 'team' | 'list' | `person:${string}`;

// ------------------------------------------------------------------ summary

export async function feedSummary(admin: Admin) {
  const org = orgForUser(admin);
  const now = new Date();
  // The two counts and the open reports in one round trip, beside the people.
  const [counts, people] = await Promise.all([
    connectPosts()
      .aggregate<{ k: 'posts'; total: number; pinned: number } | { k: 'reports'; n: number }>([
        { $match: { org } },
        { $project: { _id: 0, pinnedUntil: 1 } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            // As `pinnedUntil: { $gt: now }` matches: a date after now.
            pinned: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$pinnedUntil' }, 'date'] }, { $gt: ['$pinnedUntil', now] }] }, 1, 0] } },
          },
        },
        { $set: { k: 'posts' } },
        {
          $unionWith: {
            coll: 'content_reports',
            pipeline: [
              { $match: { org, status: 'open' } },
              { $group: { _id: { postId: '$postId', commentId: '$commentId' } } },
              { $count: 'n' },
              { $set: { k: 'reports' } },
            ],
          },
        },
      ])
      .toArray(),
    users()
      .find({ org, lifecycleStatus: { $nin: PEOPLE_GONE as never } })
      .project<{ userId: string; name: string; department?: string }>({ _id: 0, userId: 1, name: 1, department: 1 })
      .sort({ name: 1 })
      .batchSize(10_000)
      .toArray(),
  ]);
  const posts = counts.find((c) => c.k === 'posts') as { total: number; pinned: number } | undefined;
  const reports = counts.find((c) => c.k === 'reports') as { n: number } | undefined;
  return {
    total: posts?.total ?? 0,
    pinned: posts?.pinned ?? 0,
    pinMax: FEED_MAX_PINNED,
    reportsOpen: reports?.n ?? 0,
    // For "See the feed as" one person.
    people: people.map((p) => ({ userId: p.userId, name: p.name, department: p.department ?? '' })),
  };
}

// --------------------------------------------------------------------- feed

const NOT_A_LIST = { 'audience.listId': null, 'audience.userIds': null };

async function audienceClause(org: string, as: string): Promise<Record<string, unknown>> {
  if (as === 'company') return { ...NOT_A_LIST, 'audience.teamId': null, 'audience.department': null };
  if (as === 'team') {
    return { ...NOT_A_LIST, $or: [{ 'audience.teamId': { $ne: null } }, { 'audience.department': { $ne: null } }] };
  }
  if (as === 'list') return { $or: [{ 'audience.listId': { $ne: null } }, { 'audience.userIds': { $exists: true, $ne: null } }] };
  if (as.startsWith('person:')) {
    const person = await users().findOne(
      { userId: as.slice('person:'.length), org },
      { projection: { _id: 0, userId: 1, managerUserId: 1, department: 1 } },
    );
    if (!person) throw new ConnectError(404, 'Person not found');
    // The app's own audience rule for that person, before any mutes of theirs.
    return feedAudienceFilter(person);
  }
  return {};
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  const [published, created, id, pinned] = value.split('|');
  const publishedAt = new Date(published ?? '');
  const createdAt = new Date(created ?? '');
  if (Number.isNaN(publishedAt.getTime()) || Number.isNaN(createdAt.getTime())) {
    throw new ConnectError(400, 'The feed cursor is not valid');
  }
  return {
    publishedAt,
    createdAt,
    id: id && ObjectId.isValid(id) ? new ObjectId(id) : null,
    pinnedIds: (pinned ?? '').split(',').filter(Boolean).slice(0, FEED_MAX_PINNED),
  };
}

/**
 * One page of the feed, in the app's order: on the first page up to
 * FEED_MAX_PINNED live pins lead, newest first; every page then leaves those
 * out of the list, as the app does, so a pin past the limit keeps its place.
 */
export async function feedPage(admin: Admin, options: { as?: string; cursor?: string }) {
  const org = orgForUser(admin);
  const audience = await audienceClause(org, options.as ?? 'all');
  const after = decodeCursor(options.cursor);
  const now = new Date();
  const base = { org, $and: [audience] };
  const older = after
    ? {
        $or: [
          { publishedAt: { $lt: after.publishedAt } },
          { publishedAt: after.publishedAt, createdAt: { $lt: after.createdAt } },
          ...(after.id ? [{ publishedAt: after.publishedAt, createdAt: after.createdAt, _id: { $lt: after.id } }] : []),
        ],
      }
    : null;
  const sort = { publishedAt: -1, createdAt: -1, _id: -1 } as const;

  // The page and, on the first page, the live pins, in one round trip: the
  // pins come after the page, marked, and are told apart here.
  const PIN = '__leadingPin';
  const both = await connectPosts()
    .aggregate<ConnectPost & { [PIN]?: true }>([
      { $match: older ? { org, $and: [audience, older] } : base },
      { $sort: sort },
      { $limit: PAGE + 1 + FEED_MAX_PINNED },
      ...(after
        ? []
        : [{
          $unionWith: {
            coll: 'connect_posts',
            pipeline: [{ $match: { ...base, pinnedUntil: { $gt: now } } }, { $sort: sort }, { $limit: FEED_MAX_PINNED }, { $set: { [PIN]: true } }],
          },
        }]),
    ])
    .toArray();
  const pinned: ConnectPost[] = [];
  const rows: ConnectPost[] = [];
  for (const post of both) {
    if (post[PIN]) {
      delete post[PIN];
      pinned.push(post);
    } else rows.push(post);
  }
  const shownPinned = after ? after.pinnedIds : pinned.map((post) => post.id);
  const page = rows.filter((post) => !shownPinned.includes(post.id)).slice(0, PAGE + 1);
  const hasMore = page.length > PAGE;
  const paged = hasMore ? page.slice(0, PAGE) : page;
  const posts = [...pinned, ...paged];
  const cards = await cardsFor(org, posts, new Set(pinned.map((post) => post.id)));
  return {
    posts: cards,
    nextCursor: hasMore && paged.length > 0 ? encodeFeedCursor(paged[paged.length - 1], shownPinned) : null,
  };
}

// -------------------------------------------------------------------- cards

type Person = { userId: string; name: string; profilePhotoKey?: string; profilePhotoUrl?: string };

/** Everyone a page of cards names, with their live photo, in one read. */
async function peopleFor(posts: ConnectPost[], extra: string[] = []) {
  const ids = [
    ...new Set(
      posts
        .flatMap((post) => [
          post.author.userId,
          typeof post.body.personUserId === 'string' ? post.body.personUserId : '',
          post.audience.teamId ?? '',
        ])
        .concat(extra)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const rows = ids.length
    ? await users()
        .find({ userId: { $in: ids } })
        .project<Person>({ _id: 0, userId: 1, name: 1, profilePhotoKey: 1, profilePhotoUrl: 1 })
        .toArray()
    : [];
  const photos = await Promise.all(rows.map(async (row) => [row.userId, await resolveProfilePhoto(row)] as const));
  const photoById = new Map(photos);
  return new Map(rows.map((row) => [row.userId, { name: row.name, photoUrl: photoById.get(row.userId) }]));
}

async function cardsFor(org: string, posts: ConnectPost[], leadingPins: Set<string>) {
  const people = await peopleFor(posts);
  const now = Date.now();
  return Promise.all(posts.map((post) => cardOf(post, people, leadingPins.has(post.id), now)));
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

function mediaKeysOf(body: Record<string, unknown>): string[] {
  const many = body.mediaObjectKeys;
  if (Array.isArray(many)) return many.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const one = body.mediaObjectKey;
  return typeof one === 'string' && one.trim() ? [one] : [];
}

/** Who the post went to, in words HR reads, and which kind of audience it is. */
function audienceOf(audience: ConnectAudience, people: Map<string, { name: string }>) {
  if (isListAudience(audience)) {
    const n = Array.isArray(audience.userIds) ? audience.userIds.length : 0;
    return { kind: 'list' as const, label: `${audience.listName || 'Private list'} · ${n} people` };
  }
  if (audience.teamId) {
    const lead = people.get(audience.teamId)?.name;
    return { kind: 'team' as const, label: lead ? `${lead}'s team` : 'A team' };
  }
  if (audience.department) return { kind: 'team' as const, label: `${audience.department} (department)` };
  return { kind: 'company' as const, label: 'Everyone' };
}

/**
 * A post as its card needs it: only the fields the cards draw. Never the whole
 * body, which can carry things meant for one viewer (a signed Cup link).
 */
async function cardOf(
  post: ConnectPost,
  people: Map<string, { name: string; photoUrl?: string }>,
  leadingPin: boolean,
  now: number,
) {
  const body = post.body ?? {};
  const keys = mediaKeysOf(body);
  const types = Array.isArray(body.mediaContentTypes) ? (body.mediaContentTypes as unknown[]) : [body.mediaContentType];
  const media = await Promise.all(
    keys.map(async (key, i) => {
      const type = typeof types[i] === 'string' ? (types[i] as string) : '';
      const video = type.startsWith('video/') || (i === 0 && body.mediaKind === 'video');
      return { url: await presignConnectMedia(key, video ? undefined : MEDIA_W), video };
    }),
  );
  const pollVotes = post.pollVotes ?? {};
  const options =
    post.type === 'survey' && Array.isArray(body.options)
      ? await Promise.all(
          (
            body.options as Array<{
              id: string;
              label: string;
              votes?: number;
              imageObjectKey?: string;
              videoObjectKey?: string;
            }>
          ).map(async (option) => ({
            id: option.id,
            label: option.label,
            votes: (option.votes ?? 0) + Object.values(pollVotes).filter((v) => v === option.id).length,
            imageUrl: option.imageObjectKey ? await presignConnectMedia(option.imageObjectKey, 360) : undefined,
            // A video option's own clip, served whole; nothing added for any other.
            ...(option.videoObjectKey ? { videoUrl: await presignConnectMedia(option.videoObjectKey) } : {}),
          })),
        )
      : undefined;
  const personId = str(body, 'personUserId');
  const subjectPhoto = personId
    ? people.get(personId)?.photoUrl
    : str(body, 'photoKey')
      ? await presignConnectMedia(str(body, 'photoKey'), 240)
      : undefined;
  const pinnedUntil = post.pinnedUntil && post.pinnedUntil.getTime() > now ? post.pinnedUntil : null;
  const author = post.author.userId ? people.get(post.author.userId) : undefined;
  const challenge = ['caption_challenge', 'photo_story_challenge', 'most_likely'].includes(post.type);
  const closesAt = str(body, 'closesAt');
  return {
    id: post.id,
    type: post.type,
    tag: post.tag,
    tagIcon: post.tagIcon,
    tagColor: post.tagColor,
    tagTint: post.tagTint,
    author: {
      userId: post.author.userId ?? '',
      name: post.author.name,
      initials: post.author.initials,
      designation: post.author.designation,
      avatarColor: post.author.avatarColor,
      photoUrl: author?.photoUrl,
    },
    // Posted by the system (birthdays, Sowaka Engagements) rather than a person.
    auto: !post.author.userId || Boolean(post.systemKey),
    audience: audienceOf(post.audience, people),
    publishedAt: post.publishedAt,
    pinnedUntil,
    // Whether the app's feed leads with it now (only FEED_MAX_PINNED do).
    leadingPin,
    likeCount: post.likedBy?.length ?? 0,
    commentCount: post.comments?.length ?? 0,
    body: {
      title: str(body, 'title'),
      text: str(body, 'text') || str(body, 'task') || str(body, 'question'),
      subtitle: str(body, 'subtitle'),
      label: str(body, 'label'),
      severity: str(body, 'severity'),
      personName: str(body, 'personName'),
      personPhotoUrl: subjectPhoto,
      years: typeof body.years === 'number' ? body.years : undefined,
      media,
      link: str(body, 'linkUrl')
        ? { url: str(body, 'linkUrl'), title: str(body, 'linkTitle'), domain: str(body, 'linkDomain'), imageUrl: str(body, 'linkImageUrl') }
        : undefined,
      options,
      totalVotes: options ? options.reduce((sum, o) => sum + o.votes, 0) : undefined,
      challenge: challenge
        ? {
            entries: post.captionEntries?.length ?? 0,
            votes: Object.keys(post.captionVotes ?? {}).length,
            pointsPerVote: typeof body.pointsPerVote === 'number' ? body.pointsPerVote : 10,
            closesAt: closesAt || undefined,
            official: body.official === true,
          }
        : undefined,
      event:
        post.type === 'event'
          ? { date: str(body, 'date'), time: str(body, 'time'), location: str(body, 'location'), prize: str(body, 'prize') }
          : undefined,
      game:
        post.type === 'game_launch' || post.type === 'live_game' || post.type === 'relay_game'
          ? {
              name: str(body, 'gameName') || str(body, 'title'),
              actionLabel: str(body, 'actionLabel'),
              accentColor: str(body, 'accentColor'),
              startsAt: str(body, 'startsAt') || undefined,
              endsAt: str(body, 'endsAt') || undefined,
              gameKey: str(body, 'gameKey') || undefined,
            }
          : undefined,
    },
  };
}

// ------------------------------------------------------------------- detail

/** Everything the insights panel shows for one post. All of it stored, none of it estimated. */
export async function feedPostDetail(admin: Admin, postId: string) {
  const org = orgForUser(admin);
  const post = await connectPosts().findOne({ id: postId, org });
  if (!post) throw new ConnectError(404, 'Post not found');

  const [people, roster, pushes, reports, players] = await Promise.all([
    peopleFor([post], post.comments.map((c) => c.userId)),
    users()
      .find(Array.isArray(post.audience.userIds) ? { org, userId: { $in: post.audience.userIds } } : { org })
      .project<Pick<User, 'userId' | 'managerUserId' | 'department' | 'lifecycleStatus'>>({
        _id: 0, userId: 1, managerUserId: 1, department: 1, lifecycleStatus: 1,
      })
      .toArray(),
    notifications().countDocuments({ 'data.postId': post.id, scenario: `post_published_${post.type}`, pushed: true }),
    contentReports().find({ org, postId: post.id, status: 'open' }).project<{ commentId?: string }>({ _id: 0, commentId: 1 }).toArray(),
    playersOf(post),
  ]);
  const [card] = await cardsFor(org, [post], new Set());
  const reportsByComment = new Map<string, number>();
  let postReports = 0;
  for (const report of reports) {
    if (report.commentId) reportsByComment.set(report.commentId, (reportsByComment.get(report.commentId) ?? 0) + 1);
    else postReports += 1;
  }
  // Current employees the audience reaches, by the same rule the app uses.
  const audienceSize = roster.filter(
    (person) => !PEOPLE_GONE.includes(person.lifecycleStatus) && audienceAllows(post.audience, person),
  ).length;
  // Whether the app leads with it right now: one of the newest live pins.
  const leading = post.pinnedUntil && post.pinnedUntil > new Date()
    ? (await connectPosts()
        .find({ org, pinnedUntil: { $gt: new Date() } })
        .sort({ publishedAt: -1, createdAt: -1, _id: -1 })
        .limit(FEED_MAX_PINNED)
        .project<{ id: string }>({ _id: 0, id: 1 })
        .toArray()).some((row) => row.id === post.id)
    : false;

  return {
    post: { ...card, leadingPin: leading },
    insights: {
      audienceSize,
      pushSent: pushes,
      reportsOpen: postReports,
      players,
    },
    comments: post.comments
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((comment) => ({
        id: comment.id,
        userId: comment.userId,
        name: comment.name,
        photoUrl: people.get(comment.userId)?.photoUrl,
        text: comment.text,
        createdAt: comment.createdAt,
        parentId: comment.parentId ?? null,
        likeCount: (comment.likedBy ?? []).length,
        reportsOpen: reportsByComment.get(comment.id) ?? 0,
      })),
  };
}

/** People who played the game a post launched, where the scores say so. */
async function playersOf(post: ConnectPost): Promise<number | null> {
  if (post.type === 'game_launch') {
    const ids = await getDb().collection('game_launch_scores').distinct('userId', { postId: post.id });
    return ids.length;
  }
  if (post.type === 'live_game' && typeof post.body.gameId === 'string') {
    return gameScores().countDocuments({ gameId: post.body.gameId, org: post.org });
  }
  return null;
}

// -------------------------------------------------------------------- writes

/**
 * Pins a post to the top of the feed until `until`, by the rules of
 * `scripts/pin-post.ts`: a time in the future, and at most FEED_MAX_PINNED
 * live pins in a company. Re-pinning a pinned post only moves its time.
 */
export async function pinFeedPost(admin: Admin, postId: string, untilRaw: unknown) {
  const org = orgForUser(admin);
  const post = await connectPosts().findOne({ id: postId, org }, { projection: { _id: 0, id: 1, pinnedUntil: 1 } });
  if (!post) throw new ConnectError(404, 'Post not found');
  const until = new Date(String(untilRaw ?? ''));
  const now = new Date();
  if (Number.isNaN(until.getTime()) || until <= now) throw new ConnectError(400, 'Pick a time in the future');
  if (!(post.pinnedUntil && post.pinnedUntil > now)) {
    const live = await connectPosts().countDocuments({ org, pinnedUntil: { $gt: now } });
    if (live >= FEED_MAX_PINNED) {
      throw new ConnectError(
        409,
        `${FEED_MAX_PINNED} posts are already pinned, the most the feed shows. Unpin one first.`,
      );
    }
  }
  await connectPosts().updateOne({ id: postId, org }, { $set: { pinnedUntil: until } });
  return { id: postId, pinnedUntil: until };
}

export async function unpinFeedPost(admin: Admin, postId: string) {
  const org = orgForUser(admin);
  const result = await connectPosts().updateOne({ id: postId, org }, { $set: { pinnedUntil: null } });
  if (result.matchedCount === 0) throw new ConnectError(404, 'Post not found');
  return { id: postId, pinnedUntil: null };
}

/**
 * Takes a post down: the app's own delete (which HR's dashboard access
 * allows on any post in the company), then closes every open report about
 * it — exactly what `DELETE /connect/posts/:id` does.
 */
export async function removeFeedPost(admin: Admin, postId: string) {
  const org = orgForUser(admin);
  const post = await connectPosts().findOne({ id: postId, org }, { projection: { _id: 0, id: 1 } });
  if (!post) throw new ConnectError(404, 'Post not found');
  const result = await deleteConnectPost(admin.userId, postId);
  await closeReportsForRemovedPost(postId, admin.userId);
  return result;
}

/**
 * Removes a comment and the replies under it, as `deleteConnectComment` does
 * for HR, without its audience check: HR moderates the whole company's feed,
 * team and list posts it is not on included (a report shows HR their text).
 */
export async function removeFeedComment(admin: Admin, postId: string, commentId: string) {
  const org = orgForUser(admin);
  const post = await connectPosts().findOne({ id: postId, org });
  if (!post) throw new ConnectError(404, 'Post not found');
  if (!post.comments.some((c) => c.id === commentId)) throw new ConnectError(404, 'Comment not found');
  const gone = new Set([commentId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of post.comments) {
      if (item.parentId && gone.has(item.parentId) && !gone.has(item.id)) {
        gone.add(item.id);
        grew = true;
      }
    }
  }
  const ids = [...gone];
  await connectPosts().updateOne(
    { id: postId, org },
    { $pull: { comments: { id: { $in: ids } } } as never, $set: { updatedAt: new Date() } },
  );
  // Same notice the app's delete sends, so open phones redraw the post.
  emitConnectChange({
    postId: post.id,
    action: 'updated',
    actorUserId: admin.userId,
    org: post.org,
    teamId: post.audience.teamId,
    department: post.audience.department,
    userIds: realtimeUserIds(post.audience),
  });
  await notifications().deleteMany({ 'data.postId': postId, 'data.commentId': { $in: ids } });
  await contentReports().updateMany(
    { postId, commentId: { $in: ids }, status: 'open' },
    {
      $set: {
        status: 'actioned',
        reviewedAt: new Date(),
        reviewedByUserId: admin.userId,
        reviewedByName: admin.name,
        reviewNote: 'Comment deleted',
      },
    },
  );
  return { id: commentId, removed: ids.length };
}
