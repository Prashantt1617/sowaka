/**
 * Feed push notifications.
 *
 * Two rules shape everything here:
 *
 *   One action, one push. A recipient often qualifies under several rules at
 *   once — tagged in a post they also commented on, say — so the copy is
 *   *resolved* rather than accumulated: `pick` walks a precedence list and the
 *   first match wins. A tagged or kudos-specific message replaces the generic
 *   one; it never arrives alongside it.
 *
 *   Never notify someone about their own action. Filtered centrally in `send`,
 *   so no individual rule has to remember it.
 *
 * Counts come from the post's live state, not a running tally: `likedBy` is the
 * set of currently active likers, so an unlike lowers the next notification's
 * count without any separate bookkeeping.
 */
import { connectPosts, users } from '../config/db';
import { ConnectComment, ConnectPost } from '../models/connect.model';
import { User } from '../models/user.model';
import { notifyUsers } from './notification.service';
import { logger } from '../utils/logger';

// ------------------------------------------------------------------ helpers

/** "and 1 other" / "and 2 others" — never the literal "other(s)". */
export function others(count: number): string {
  if (count <= 0) return '';
  return ` and ${count} ${count === 1 ? 'other' : 'others'}`;
}

export function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** Who the author is *to this recipient* — the same post reads differently. */
export type CreatorType = 'sowaka' | 'founder' | 'hr' | 'manager' | 'employee';

export function creatorTypeFor(post: ConnectPost, author: User | null, recipient: User): CreatorType {
  if (!post.author.userId) return 'sowaka';
  // The post's declared type wins over who wrote it: an HR announcement reads
  // as HR even when its author also happens to be leadership, which is common
  // in a small company where one person is both.
  if (post.type === 'hr_announcement') return 'hr';
  if (post.type === 'leadership') return 'founder';
  if (author?.isLeadership) return 'founder';
  if (author?.dashboardAccess) return 'hr';
  if (author && recipient.managerUserId === author.userId) return 'manager';
  return 'employee';
}

export type PostPriority = 'normal' | 'must_read' | 'must_watch';

/** Priority is a flag on the body, not a post type of its own. */
export function priorityOf(post: ConnectPost): PostPriority {
  const value = String((post.body as { priority?: unknown }).priority ?? '').trim();
  return value === 'must_read' || value === 'must_watch' ? value : 'normal';
}

const idsFrom = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];

export const taggedIn = (post: ConnectPost): string[] => idsFrom(post.body.taggedUserIds);

/** Kudos recipients, which the body carries under either historical key. */
export const kudosRecipients = (post: ConnectPost): string[] =>
  post.type === 'kudos'
    ? [...new Set([...idsFrom(post.body.recipientUserIds), ...idsFrom(post.body.taggedUserIds)])]
    : [];

const titleOf = (post: ConnectPost): string =>
  String(post.body.title ?? post.body.text ?? 'a post').slice(0, 80);

/** Everyone who can see the post — the audience a notification may reach. */
export async function postAudience(post: ConnectPost): Promise<User[]> {
  const roster = await users().find({ org: post.org }).toArray();
  const { teamId, department } = post.audience;
  return roster.filter((u) => {
    if (teamId) return u.userId === teamId || u.managerUserId === teamId;
    return !department || department === u.department;
  });
}

type Copy = { title: string; body: string };

/** First matching rule wins — this is the precedence, written as a list. */
function pick(rules: Array<Copy | null | undefined | false>): Copy | null {
  for (const rule of rules) if (rule) return rule;
  return null;
}

/**
 * Sends one push per recipient, dropping the actor.
 *
 * `notifyUsers` also applies the NOTIFY_ORGS gate, so a suppressed org gets
 * nothing here either.
 */
async function send(
  recipients: Array<{ user: User; copy: Copy | null }>,
  scenario: string,
  data: Record<string, string>,
  actorUserId: string,
): Promise<number> {
  const deliverable = recipients.filter((r) => r.copy && r.user.userId !== actorUserId);
  // Per recipient, and never rethrowing: publishing a post or leaving a comment
  // must not fail because a push could not be delivered.
  const results = await Promise.allSettled(
    deliverable.map((r) =>
      notifyUsers([r.user.userId], {
        scenario,
        title: r.copy!.title,
        body: r.copy!.body,
        data,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    logger.error('Feed notifications failed', { scenario, failed: failed.length },
      (failed[0] as PromiseRejectedResult).reason);
  }
  return deliverable.length - failed.length;
}

// -------------------------------------------------------------- publication

/**
 * One publication notification per person in the audience.
 *
 * Precedence: kudos recipient, tagged, must-read/watch, then the author's
 * relationship to the reader. A kudos or tagged reader gets that copy instead
 * of the generic one, never as well.
 */
export async function notifyPostPublished(post: ConnectPost): Promise<number> {
  const author = post.author.userId
    ? await users().findOne({ userId: post.author.userId })
    : null;
  const actorName = post.author.name || 'Someone';
  const audience = await postAudience(post);
  const tagged = taggedIn(post);
  const kudos = kudosRecipients(post);
  const priority = priorityOf(post);
  const isPoll = post.type === 'survey';
  const isAnnouncement = post.type === 'hr_announcement' || post.type === 'leadership';
  const title = titleOf(post);

  const recipients = audience.map((user) => {
    const role = creatorTypeFor(post, author, user);
    const iAmKudosRecipient = kudos.includes(user.userId);
    const otherKudos = kudos.filter((id) => id !== user.userId).length;
    const iAmTagged = tagged.includes(user.userId);
    const otherTagged = tagged.filter((id) => id !== user.userId).length;

    const copy = pick([
      // Kudos about me outranks everything, including a tag on the same post.
      iAmKudosRecipient && {
        title: otherKudos > 0
          ? `${actorName} gave kudos to you${others(otherKudos)} 🎉`
          : `${actorName} gave you kudos 🎉`,
        body: 'See what they appreciated',
      },
      // Kudos about someone else, for the rest of the audience.
      post.type === 'kudos' && kudos.length > 0 && {
        title: `${actorName} gave kudos to ${kudosNames(kudos, audience)} 🎉`,
        body: "See what they're celebrating",
      },
      iAmTagged && {
        title: otherTagged > 0
          ? `${actorName} tagged you${others(otherTagged)} in a post`
          : `${actorName} tagged you in a post`,
        body: 'See what they shared',
      },
      priority === 'must_read' && { title: mustReadTitle(role, actorName), body: title },
      priority === 'must_watch' && { title: mustWatchTitle(role, actorName), body: title },
      isPoll && pollCopy(role, actorName),
      isAnnouncement && announcementCopy(role, actorName, title),
      postCopy(role, actorName),
    ]);
    return { user, copy };
  });

  const count = await send(
    recipients,
    `post_published_${post.type}`,
    { destination: 'connect_post', postId: post.id, postType: post.type, priority },
    post.author.userId ?? '',
  );
  logger.info('Feed publication notified', { postId: post.id, type: post.type, recipients: count });
  return count;
}

function kudosNames(ids: string[], audience: User[]): string {
  const first = audience.find((u) => u.userId === ids[0])?.name ?? 'a teammate';
  return ids.length > 1 ? `${first}${others(ids.length - 1)}` : first;
}

function postCopy(role: CreatorType, actor: string): Copy {
  switch (role) {
    case 'hr': return { title: 'New post from HR', body: `See what ${actor} shared` };
    case 'founder': return { title: `${actor} just posted`, body: 'See what your founder shared' };
    case 'manager': return { title: 'Your manager just posted', body: `See what ${actor} shared` };
    // Sowaka's own posts push only when an admin opts in, with their own copy.
    case 'sowaka': return { title: 'New post', body: `See what ${actor} shared` };
    default: return { title: 'New post in your team', body: `See what ${actor} posted` };
  }
}

function pollCopy(role: CreatorType, actor: string): Copy {
  switch (role) {
    case 'hr': return { title: 'HR wants your opinion', body: 'Cast your vote' };
    case 'founder': return { title: `${actor} wants your take`, body: 'Cast your vote' };
    case 'manager': return { title: 'Your manager wants your opinion', body: 'Cast your vote' };
    default: return { title: 'New poll: Have your say', body: `${actor} wants to know what you think` };
  }
}

function announcementCopy(role: CreatorType, actor: string, title: string): Copy {
  switch (role) {
    case 'hr': return { title: 'New announcement from HR', body: title };
    case 'founder': return { title: `An update from ${actor}`, body: title };
    case 'manager': return { title: 'Update from your manager', body: title };
    default: return { title: 'Company announcement', body: title };
  }
}

function mustReadTitle(role: CreatorType, actor: string): string {
  switch (role) {
    case 'hr': return 'Must read from HR';
    case 'founder': return `A must-read from ${actor}`;
    case 'manager': return 'Your manager recommends this';
    default: return `${actor} recommends this`;
  }
}

function mustWatchTitle(role: CreatorType, actor: string): string {
  switch (role) {
    case 'hr': return 'Must watch from HR';
    case 'founder': return `${actor} recommends watching this`;
    case 'manager': return 'Your manager recommends this';
    default: return `${actor} recommends this`;
  }
}

// ------------------------------------------------------------ interactions

/** Distinct people who have commented, excluding one id. */
const commenterIds = (post: ConnectPost, except: string): string[] =>
  [...new Set(post.comments.map((c) => c.userId))].filter((id) => id && id !== except);

/**
 * A like on a post. Reaches the author, anyone tagged, and anyone who has
 * commented — each with copy naming their relationship to the post, and a
 * cumulative count taken from the live liker set.
 */
export async function notifyPostLiked(post: ConnectPost, actor: User): Promise<number> {
  const fresh = (await connectPosts().findOne({ id: post.id })) ?? post;
  const likeCount = (fresh.likedBy ?? []).length;
  if (likeCount === 0) return 0;
  const suffix = others(likeCount - 1);
  const isPoll = fresh.type === 'survey';
  const tagged = taggedIn(fresh);
  const audience = await postAudience(fresh);
  const commenters = commenterIds(fresh, actor.userId);

  const targets = new Set(
    [fresh.author.userId, ...tagged, ...commenters].filter((id): id is string => Boolean(id)),
  );

  const recipients = [...targets].map((userId) => {
    const user = audience.find((u) => u.userId === userId);
    if (!user) return { user: { userId } as User, copy: null };
    const copy = pick([
      // Your own content first, then a tag, then merely having commented.
      userId === fresh.author.userId && {
        title: isPoll
          ? `${actor.name}${suffix} liked your poll`
          : `${actor.name}${suffix} liked your post`,
        body: isPoll ? 'See the poll' : likeCount > 1 ? 'See the activity' : 'See the post',
      },
      tagged.includes(userId) && {
        title: `${actor.name}${suffix} liked a post you're tagged in`,
        body: 'See the post',
      },
      commenters.includes(userId) && {
        title: `${actor.name}${suffix} liked a post you commented on`,
        body: "See what's happening",
      },
    ]);
    return { user, copy };
  });

  return send(recipients, 'post_liked', { destination: 'connect_post', postId: fresh.id }, actor.userId);
}

/** A like on a comment — only its author hears about it. */
export async function notifyCommentLiked(
  post: ConnectPost,
  comment: ConnectComment,
  actor: User,
): Promise<number> {
  const fresh = (await connectPosts().findOne({ id: post.id })) ?? post;
  const updated = fresh.comments.find((c) => c.id === comment.id);
  const count = (updated?.likedBy ?? []).length;
  if (count === 0 || !comment.userId) return 0;
  const author = await users().findOne({ userId: comment.userId });
  if (!author) return 0;
  return send(
    [{
      user: author,
      copy: {
        title: `${actor.name}${others(count - 1)} liked your comment`,
        body: 'See the conversation',
      },
    }],
    'comment_liked',
    { destination: 'connect_comment', postId: fresh.id, commentId: comment.id },
    actor.userId,
  );
}

/**
 * A comment or reply. Precedence runs: a direct reply, then an @mention, then
 * kudos you were given or gave, then your own post, then a post you are tagged
 * in, then one you had commented on.
 */
export async function notifyPostCommented(
  post: ConnectPost,
  comment: ConnectComment,
  actor: User,
  mentionedUserIds: string[] = [],
): Promise<number> {
  const audience = await postAudience(post);
  const tagged = taggedIn(post);
  const kudos = kudosRecipients(post);
  const isPoll = post.type === 'survey';
  const parent = comment.parentId
    ? post.comments.find((c) => c.id === comment.parentId)
    : undefined;
  const priorCommenters = commenterIds(post, actor.userId);
  const mentions = mentionedUserIds.filter((id) => id !== actor.userId);

  const targets = new Set(
    [
      post.author.userId,
      parent?.userId,
      ...mentions,
      ...kudos,
      ...tagged,
      ...priorCommenters,
    ].filter((id): id is string => Boolean(id)),
  );

  const recipients = [...targets].map((userId) => {
    const user = audience.find((u) => u.userId === userId);
    if (!user) return { user: { userId } as User, copy: null };
    const otherMentions = mentions.filter((id) => id !== userId).length;
    const copy = pick([
      // A reply that also mentions you is still just a reply.
      parent?.userId === userId && {
        title: `${actor.name} replied to your comment`,
        body: 'See what they said',
      },
      mentions.includes(userId) && {
        title: otherMentions > 0
          ? `${actor.name} mentioned you${others(otherMentions)}`
          : `${actor.name} mentioned you in a comment`,
        body: 'See the comment',
      },
      // Kudos context beats the generic tagged copy, for giver and receiver.
      (kudos.includes(userId) || (post.type === 'kudos' && userId === post.author.userId)) && {
        title: `${actor.name} commented on your kudos`,
        body: 'See what they said',
      },
      userId === post.author.userId && {
        title: `${actor.name} commented on your ${isPoll ? 'poll' : 'post'}`,
        body: 'See what they said',
      },
      tagged.includes(userId) && {
        title: `${actor.name} commented on a post you're tagged in`,
        body: 'Join the conversation',
      },
      priorCommenters.includes(userId) && {
        title: `${actor.name} joined the conversation`,
        body: 'See their comment',
      },
    ]);
    return { user, copy };
  });

  return send(
    recipients,
    'post_commented',
    { destination: 'connect_comment', postId: post.id, commentId: comment.id },
    actor.userId,
  );
}

/**
 * A poll vote. The creator hears every vote immediately, and so does anyone who
 * has already voted. A changed vote is not a new voter and sends nothing —
 * that is decided by the caller, which knows whether a prior vote existed.
 */
export async function notifyPollVoted(post: ConnectPost, actor: User): Promise<number> {
  const fresh = (await connectPosts().findOne({ id: post.id })) ?? post;
  const voters = Object.keys(fresh.pollVotes ?? {});
  const count = voters.length;
  if (count === 0) return 0;
  const suffix = others(count - 1);
  const audience = await postAudience(fresh);
  const priorVoters = voters.filter((id) => id !== actor.userId && id !== fresh.author.userId);

  const recipients = [
    ...(fresh.author.userId ? [fresh.author.userId] : []),
    ...priorVoters,
  ].map((userId) => {
    const user = audience.find((u) => u.userId === userId);
    if (!user) return { user: { userId } as User, copy: null };
    const copy = pick([
      userId === fresh.author.userId && {
        title: `${actor.name}${suffix} voted on your poll`,
        body: 'See how the results are shaping up',
      },
      {
        title: count > 2
          ? `${actor.name}${others(count - 2)} also voted`
          : `${actor.name} also voted`,
        body: 'See how the poll is shaping up',
      },
    ]);
    return { user, copy };
  });

  return send(recipients, 'poll_voted', { destination: 'connect_post', postId: fresh.id }, actor.userId);
}
