/**
 * Birthday and work-anniversary cards, as the feed presents them.
 *
 * The daily lifecycle job writes one post per person per day, keyed
 * `birthday:<userId>:<YYYY-MM-DD>` / `anniversary:<userId>:<YYYY-MM-DD>` on the
 * India calendar. Each person keeps their own post, so their wishes (the
 * comments) stay theirs. On top of that:
 *
 * - the person whose day it is sees their own card pinned at the top of their
 *   feed until the day ends in India (`celebrantPinKeys`);
 * - everyone else sees the same day's cards of a company clubbed into one
 *   card, by a group key each post carries (`celebrationGroupFor`). The app
 *   draws posts sharing a key as one card with a wish thread per person; an
 *   app that does not know the key keeps showing them one by one.
 *
 * Pure: no database, so `scripts/connect-celebrations-check.ts` can run it.
 */
import type { ConnectPost } from '../models/connect.model';

export type CelebrationType = 'birthday' | 'anniversary';
export const CELEBRATION_TYPES: CelebrationType[] = ['birthday', 'anniversary'];

/** A birthday and an anniversary can fall on the same day: at most two pins. */
export const CELEBRANT_MAX_PINNED = CELEBRATION_TYPES.length;

const isCelebration = (type: string): type is CelebrationType =>
  (CELEBRATION_TYPES as string[]).includes(type);

/** The calendar day in India, as `YYYY-MM-DD` — the day the job writes into the key. */
export function istDateKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The system keys of a person's own cards for the India day [at] falls on. */
export function celebrantPinKeys(userId: string, at: Date): string[] {
  const day = istDateKey(at);
  return CELEBRATION_TYPES.map((type) => `${type}:${userId}:${day}`);
}

/** The day a celebration card is for: from its key, else when it went up. */
export function celebrationDayOf(post: Pick<ConnectPost, 'type' | 'systemKey' | 'publishedAt'>): string {
  const fromKey = /:(\d{4}-\d{2}-\d{2})$/.exec(post.systemKey ?? '')?.[1];
  return fromKey ?? istDateKey(post.publishedAt);
}

/** Whose day a birthday or anniversary card is, when it names them. */
export function celebrantOfPost(post: Pick<ConnectPost, 'type' | 'body'>): string {
  if (!isCelebration(post.type)) return '';
  const id = post.body.personUserId;
  return typeof id === 'string' ? id : '';
}

/** Whether [post] is [viewerUserId]'s own card for today — the one pinned for them. */
export function isPinnedForCelebrant(
  post: Pick<ConnectPost, 'type' | 'systemKey'>,
  viewerUserId: string,
  now: Date,
): boolean {
  return post.systemKey !== undefined && celebrantPinKeys(viewerUserId, now).includes(post.systemKey);
}

/**
 * The key a celebration card is clubbed by for [viewerUserId], or null when it
 * stands alone: not a celebration, or the viewer's own card — the celebrant
 * sees their own wishes, never a card shared with the others.
 */
export function celebrationGroupFor(
  post: Pick<ConnectPost, 'type' | 'org' | 'body' | 'systemKey' | 'publishedAt'>,
  viewerUserId: string,
): string | null {
  if (!isCelebration(post.type)) return null;
  if (celebrantOfPost(post) === viewerUserId) return null;
  return `celebrations:${post.org}:${celebrationDayOf(post)}`;
}

/**
 * How many of the wishes on [post] its celebrant has not seen yet, or null
 * when [viewerUserId] is not the person it celebrates (only they get a count).
 *
 * A wish is a colleague's top-level comment — not the celebrant's own, and not
 * a reply in a thread. "Seen" is the last time the celebrant opened their
 * wishes, on any device (`wishesSeenAt`); before the first time, every wish is
 * new. [comments] are the ones the viewer may see, so a blocked colleague's
 * wish never counts.
 */
export function newWishCountFor(
  post: Pick<ConnectPost, 'type' | 'body' | 'wishesSeenAt'>,
  comments: Array<{ userId: string; parentId?: string; createdAt: Date }>,
  viewerUserId: string,
): number | null {
  const celebrant = celebrantOfPost(post);
  if (!celebrant || celebrant !== viewerUserId) return null;
  const seenAt = post.wishesSeenAt?.[viewerUserId];
  const seen = seenAt ? new Date(seenAt).getTime() : null;
  return comments.filter(
    (comment) =>
      !comment.parentId &&
      comment.userId !== celebrant &&
      (seen === null || new Date(comment.createdAt).getTime() > seen),
  ).length;
}
