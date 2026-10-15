/**
 * Feed notifications, as the notification spec lists them (rows 29–56).
 *
 * Most feed activity is inbox only. A push goes to someone only when the post
 * is about them, was shared with a short list they are on, is Must read /
 * Must watch, is an announcement from HR or leadership, or is a poll from HR,
 * leadership or their manager. Comments, likes and poll votes on your own post
 * push at most once every three hours per post (notification-groups).
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
import { GroupKind, notifyGrouped } from './notification-groups.service';
import { shortDate } from './notification-time';
import { logger } from '../utils/logger';
import { audienceAllows } from './audience-list-rules';

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

/** The person a birthday or anniversary card is about, when it names one. */
export const celebrantOf = (post: ConnectPost): string =>
  post.type === 'birthday' || post.type === 'anniversary'
    ? String((post.body as { personUserId?: unknown }).personUserId ?? '')
    : '';

const titleOf = (post: ConnectPost): string =>
  String(post.body.title ?? post.body.text ?? 'a post').slice(0, 80);

/**
 * Everyone who can see the post — the audience a notification may reach.
 * The same rule a read goes through (`audienceAllows`), so nobody is told
 * about a post they could not open: a list post reaches only the people
 * snapshotted onto it, however they are involved.
 */
export async function postAudience(post: ConnectPost): Promise<User[]> {
  const userIds = post.audience.userIds;
  const roster = await users()
    .find(Array.isArray(userIds) ? { org: post.org, userId: { $in: userIds } } : { org: post.org })
    .toArray();
  return roster.filter((u) => audienceAllows(post.audience, u));
}

/** `push: false` leaves an inbox entry and nothing on the lock screen. */
type Copy = { title: string; body: string; push?: boolean };

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
        push: r.copy!.push !== false,
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

const CONTESTS = new Set(['caption_challenge', 'photo_story_challenge', 'most_likely']);

/** Inbox only: the same entry, no push. */
const quietly = (copy: Copy): Copy => ({ ...copy, push: false });

/**
 * One publication notification per person in the audience.
 *
 * Birthdays and anniversaries reach the person's manager, their direct
 * reports and their department, never the person. A contest reaches everyone
 * it is open to. Anything else pushes only when it is about the reader or
 * marked as something they must see; the rest is an inbox entry.
 */
export async function notifyPostPublished(post: ConnectPost): Promise<number> {
  // Live games push when they start (notifyLiveGameStarted), and a new
  // joiner's team hears at 10:00 on their first day (sendNewJoinerNotifications).
  if (post.type === 'live_game' || post.type === 'relay_game' || post.type === 'new_joinee') return 0;

  const author = post.author.userId
    ? await users().findOne({ userId: post.author.userId })
    : null;
  const actorName = post.author.name || 'Someone';
  const audience = await postAudience(post);
  const data = { destination: 'connect_post', postId: post.id, postType: post.type, priority: priorityOf(post) };
  const scenario = `post_published_${post.type}`;

  const celebrant = celebrantOf(post);
  if (celebrant) {
    const person = await users().findOne({ userId: celebrant });
    const copy = lifecycleCopy(post);
    const reached = person ? audience.filter((u) => celebrationCircle(person, u)) : [];
    return send(reached.map((user) => ({ user, copy })), scenario, data, celebrant);
  }

  if (CONTESTS.has(post.type)) {
    const closesAt = post.body.closesAt ? new Date(String(post.body.closesAt)) : null;
    const copy: Copy = {
      title: `New contest: ${titleOf(post)}`,
      body: closesAt && !Number.isNaN(closesAt.getTime()) ? `Enter by ${shortDate(closesAt)}` : 'Join in',
    };
    return send(audience.map((user) => ({ user, copy })), scenario, data, post.author.userId ?? '');
  }

  const tagged = taggedIn(post);
  const kudos = kudosRecipients(post);
  const priority = priorityOf(post);
  const isPoll = post.type === 'survey';
  const isAnnouncement = post.type === 'hr_announcement' || post.type === 'leadership';
  const toList = Array.isArray(post.audience.userIds);
  const title = titleOf(post);

  const recipients = audience.map((user) => {
    const role = creatorTypeFor(post, author, user);
    const copy = pick([
      kudos.includes(user.userId) && { title: `${actorName} gave you kudos 🎉`, body: firstLine(post) },
      tagged.includes(user.userId) && { title: `${actorName} tagged you in a post`, body: 'See what they shared' },
      toList && { title: `${actorName} shared a post with you`, body: title },
      priority === 'must_read' && { title: mustReadTitle(role, actorName), body: title },
      priority === 'must_watch' && { title: mustWatchTitle(role, actorName), body: title },
      isAnnouncement && announcementCopy(role, actorName, title),
      isPoll && (role === 'hr' || role === 'founder' || role === 'manager') && pollCopy(role, actorName),
      // Everything else lands in the inbox and the feed, without a push.
      post.type === 'kudos' && kudos.length > 0
        && quietly({ title: `${actorName} gave kudos to ${kudosNames(kudos, audience)} 🎉`, body: firstLine(post) }),
      isPoll && quietly({ title: `New poll from ${actorName}`, body: 'Cast your vote' }),
      quietly(postCopy(role, actorName)),
    ]);
    return { user, copy };
  });

  const count = await send(recipients, scenario, data, post.author.userId ?? '');
  logger.info('Feed publication notified', { postId: post.id, type: post.type, recipients: count });
  return count;
}

/** A birthday or anniversary card's push audience: their manager, their reports, their department. */
export function celebrationCircle(person: User, other: User): boolean {
  if (other.userId === person.userId) return false;
  if (person.managerUserId && other.userId === person.managerUserId) return true;
  if (other.managerUserId === person.userId) return true;
  return Boolean(person.department) && other.department === person.department;
}

/** Birthday and work-anniversary cards, which the daily job publishes. */
function lifecycleCopy(post: ConnectPost): Copy {
  const name = String(post.body.personName ?? 'A teammate');
  if (post.type === 'anniversary') {
    const years = Number(post.body.years ?? 0);
    return { title: `🎉 ${name} completes ${plural(years, 'year')} today`, body: 'Celebrate their journey' };
  }
  return { title: `🎂 It's ${name}'s birthday!`, body: 'Drop a wish and make their day' };
}

/** The first line of a kudos, for the push under "gave you kudos". */
function firstLine(post: ConnectPost): string {
  const text = String(post.body.text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  return text.length > 100 ? `${text.slice(0, 99)}…` : text || 'See what they appreciated';
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
    case 'sowaka': return { title: 'New post', body: `See what ${actor} shared` };
    default: return { title: 'New post', body: `See what ${actor} posted` };
  }
}

function pollCopy(role: CreatorType, actor: string): Copy {
  switch (role) {
    case 'hr': return { title: 'HR wants your opinion', body: 'Cast your vote' };
    case 'founder': return { title: `${actor} wants your take`, body: 'Cast your vote' };
    default: return { title: 'Your manager wants your opinion', body: 'Cast your vote' };
  }
}

/** HR and leadership announcements push; anyone else's reads as an ordinary post. */
function announcementCopy(role: CreatorType, actor: string, title: string): Copy {
  switch (role) {
    case 'hr': return { title: 'New announcement from HR', body: title };
    case 'founder': return { title: `An update from ${actor}`, body: title };
    default: return quietly({ title: 'Company announcement', body: title });
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

// ------------------------------------------------------------------- games

/** Row 29: a live game has started, for everyone it is open to except the host. */
export async function notifyLiveGameStarted(post: ConnectPost, hostName: string): Promise<number> {
  const audience = await postAudience(post);
  const copy: Copy = {
    title: `🎮 Live ${String(post.body.title ?? 'game')} starting now`,
    body: `${hostName || 'Your company'} is hosting. Join in!`,
  };
  return send(
    audience.map((user) => ({ user, copy })),
    'live_game_started',
    { destination: 'connect_post', postId: post.id, postType: post.type },
    post.author.userId ?? '',
  );
}

/** Rows 31–32: every vote on a caption or best-photo entry, to the entry's author. */
export async function notifyContestVote(post: ConnectPost, entryAuthorUserId: string, voter: User): Promise<number> {
  if (post.type !== 'caption_challenge' && post.type !== 'photo_story_challenge') return 0;
  const author = await users().findOne({ userId: entryAuthorUserId });
  if (!author || !audienceAllows(post.audience, author)) return 0;
  const what = post.type === 'photo_story_challenge' ? 'photo' : 'caption';
  return send(
    [{ user: author, copy: { title: `${voter.name} voted for your ${what}`, body: titleOf(post) } }],
    'contest_vote',
    { destination: 'connect_post', postId: post.id, postType: post.type },
    voter.userId,
  );
}

/**
 * "who is most likely to eat your lunch?" → "eat your lunch". Null when the
 * question is not phrased that way, so the copy can fall back to quoting it.
 */
export function mostLikelyPrompt(question: string): string | null {
  const match = /^\s*(?:who(?:\s*is|'s|s)?\s+)?(?:most|more)\s+likely\s+(?:to|ot)\s+(.+?)[\s?.!]*$/i.exec(question);
  return match ? match[1] : null;
}

/** Row 33: every tag in a Most Likely contest, to the person tagged. Never says who. */
export async function notifyMostLikelyTag(post: ConnectPost, taggedUserId: string, taggerUserId: string): Promise<number> {
  const tagged = await users().findOne({ userId: taggedUserId });
  if (!tagged || !audienceAllows(post.audience, tagged)) return 0;
  const question = String(post.body.question ?? '').trim();
  const prompt = mostLikelyPrompt(question);
  const title = prompt
    ? `Someone thinks you're most likely to ${prompt} 😄`
    : `Someone tagged you in “${question || String(post.body.label || post.body.title || 'Most Likely')}” 😄`;
  return send(
    [{ user: tagged, copy: { title, body: 'See the results so far' } }],
    'most_likely_tagged',
    { destination: 'connect_post', postId: post.id, postType: post.type },
    taggerUserId,
  );
}

// ------------------------------------------------------------ interactions

/** Distinct people who have commented, excluding one id. */
const commenterIds = (post: ConnectPost, except: string): string[] =>
  [...new Set(post.comments.map((c) => c.userId))].filter((id) => id && id !== except);

/** Gathers one event into a three-hourly push, never failing the action that caused it. */
async function grouped(
  recipientUserId: string,
  kind: GroupKind,
  post: ConnectPost,
  actor: User,
  data: Record<string, string>,
): Promise<void> {
  if (!recipientUserId || recipientUserId === actor.userId) return;
  try {
    await notifyGrouped({ recipientUserId, kind, entityId: post.id, actorName: actor.name, data });
  } catch (error) {
    logger.error('Grouped feed notification failed', { kind, postId: post.id }, error);
  }
}

/**
 * A like. The author hears it grouped; people tagged in the post or who
 * commented on it get an inbox entry only.
 */
export async function notifyPostLiked(post: ConnectPost, actor: User): Promise<number> {
  const fresh = (await connectPosts().findOne({ id: post.id })) ?? post;
  const data = { destination: 'connect_post', postId: fresh.id, postType: fresh.type };
  const authorId = fresh.author.userId ?? '';
  const audience = await postAudience(fresh);
  if (authorId && audience.some((u) => u.userId === authorId)) {
    await grouped(authorId, 'post_liked', fresh, actor, data);
  }
  const tagged = taggedIn(fresh);
  const commenters = commenterIds(fresh, actor.userId);
  const recipients = [...new Set([...tagged, ...commenters])]
    .filter((id) => id !== authorId)
    .map((userId) => ({
      user: audience.find((u) => u.userId === userId) ?? ({ userId } as User),
      copy: audience.some((u) => u.userId === userId)
        ? quietly(tagged.includes(userId)
          ? { title: `${actor.name} liked a post you're tagged in`, body: 'See the post' }
          : { title: `${actor.name} liked a post you commented on`, body: 'See the post' })
        : null,
    }));
  return send(recipients, 'post_liked_inbox', data, actor.userId);
}

/**
 * A comment. Precedence: an @mention pushes at once; the person a birthday
 * or anniversary card is about, the post's author, and earlier commenters
 * hear it grouped; people tagged in the post get an inbox entry. Earlier
 * commenters on a birthday or anniversary card hear nothing.
 */
export async function notifyPostCommented(
  post: ConnectPost,
  comment: ConnectComment,
  actor: User,
  mentionedUserIds: string[] = [],
): Promise<number> {
  const audience = await postAudience(post);
  const inAudience = (id: string) => audience.some((u) => u.userId === id);
  const postData = { destination: 'connect_post', postId: post.id, postType: post.type };
  const commentData = { destination: 'connect_comment', postId: post.id, commentId: comment.id, postType: post.type };
  const mentions = mentionedUserIds.filter((id) => id !== actor.userId && inAudience(id));
  const celebrant = celebrantOf(post);
  const authorId = post.author.userId ?? '';
  const tagged = [...new Set([...taggedIn(post), ...kudosRecipients(post)])];
  const priorCommenters = commenterIds(post, actor.userId);
  const handled = new Set<string>([actor.userId, ...mentions]);

  let sent = await send(
    mentions.map((userId) => ({
      user: audience.find((u) => u.userId === userId)!,
      copy: { title: `${actor.name} mentioned you in a comment`, body: 'See the comment' },
    })),
    'comment_mention',
    commentData,
    actor.userId,
  );

  if (celebrant && !handled.has(celebrant) && inAudience(celebrant)) {
    handled.add(celebrant);
    await grouped(celebrant, post.type === 'anniversary' ? 'card_wished_anniversary' : 'card_wished_birthday', post, actor, postData);
  }
  if (authorId && !handled.has(authorId) && inAudience(authorId)) {
    handled.add(authorId);
    await grouped(authorId, 'post_commented', post, actor, postData);
  }

  const taggedRecipients = tagged
    .filter((id) => !handled.has(id) && inAudience(id))
    .map((userId) => {
      handled.add(userId);
      return {
        user: audience.find((u) => u.userId === userId)!,
        copy: quietly({ title: `${actor.name} commented on a post you're tagged in`, body: 'See what they said' }),
      };
    });
  sent += await send(taggedRecipients, 'post_commented_inbox', commentData, actor.userId);

  if (!celebrant) {
    for (const userId of priorCommenters) {
      if (handled.has(userId) || !inAudience(userId)) continue;
      handled.add(userId);
      await grouped(userId, 'post_also_commented', post, actor, postData);
    }
  }
  return sent;
}

/**
 * A first vote on a poll (a changed vote is not a new voter, and the caller
 * sends nothing for it). The creator hears it grouped; earlier voters get an
 * inbox entry.
 */
export async function notifyPollVoted(post: ConnectPost, actor: User): Promise<number> {
  const fresh = (await connectPosts().findOne({ id: post.id })) ?? post;
  const data = { destination: 'connect_post', postId: fresh.id, postType: fresh.type };
  const authorId = fresh.author.userId ?? '';
  const audience = await postAudience(fresh);
  if (authorId && audience.some((u) => u.userId === authorId)) {
    await grouped(authorId, 'poll_voted', fresh, actor, data);
  }
  const priorVoters = Object.keys(fresh.pollVotes ?? {}).filter((id) => id !== actor.userId && id !== authorId);
  return send(
    priorVoters.map((userId) => ({
      user: audience.find((u) => u.userId === userId) ?? ({ userId } as User),
      copy: audience.some((u) => u.userId === userId)
        ? quietly({ title: `${actor.name} also voted`, body: 'See how the poll is shaping up' })
        : null,
    })),
    'poll_voted_inbox',
    data,
    actor.userId,
  );
}
