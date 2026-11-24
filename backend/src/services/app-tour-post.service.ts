import { randomUUID } from 'node:crypto';
import { connectPosts } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import type { User } from '../models/user.model';
import { realtimeUserIds } from './audience-list-rules';
import { companyDisplayName } from './company-settings.service';
import { ConnectError, deleteConnectPost, orgForUser, postMeta } from './connect.service';
import { closeReportsForRemovedPost } from './connect-moderation.service';
import { emitConnectChange } from './connect-realtime.service';
import { uploadConnectMedia, type ConnectMediaFile } from './s3-connect-media.service';

/**
 * The "Start a tour" post: HR, from Dashboard › Engagement › Feed, puts an
 * invitation to the app's Sowaka tour in the company's feed. The app draws it
 * as its own card (`app_tour`): a picture, or until HR uploads one the tour's
 * own globe and plane; a title; a caption; and one button that opens the
 * tour's start card. From the company, to everyone, liked and commented on
 * like any post. No push: it waits in the feed, as a game launch does.
 *
 * One at a time. A second while one is in the feed is refused unless HR asks
 * to replace it, which posts the new one and then takes the old one down (its
 * likes and comments with it, and any open report about it closed), so a
 * failed upload never leaves the feed with none.
 *
 * Builds from before the card read an unknown type as a plain post and show
 * its `text` and its picture, with likes and comments; `text` here is the
 * title, the caption and a line asking them to update for the tour.
 */

type Admin = Pick<User, 'userId' | 'org' | 'email' | 'name'>;

export const APP_TOUR_DEFAULTS = {
  title: 'Take the Sowaka tour',
  caption: 'New here, or never had the tour? See where everything lives in Connect in about a minute.',
  actionLabel: 'Get tour',
} as const;

const LIMITS = { title: 80, caption: 300, actionLabel: 24 } as const;

/** What builds without the card show under the title and caption. */
export const APP_TOUR_UPDATE_LINE = 'Update the Sowaka app to take the tour.';

export type AppTourInput = {
  title?: unknown;
  caption?: unknown;
  actionLabel?: unknown;
  /** True (or "true", from a form) to take the one in the feed down. */
  replace?: unknown;
};

function text(value: unknown, fallback: string, max: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return (trimmed || fallback).slice(0, max);
}

/** The app tour post in the company's feed now, if there is one. */
export async function currentAppTourPost(admin: Admin) {
  const org = orgForUser(admin);
  const row = await connectPosts()
    .find({ org, type: 'app_tour' }, { projection: { _id: 0, id: 1, publishedAt: 1, body: 1 } })
    .sort({ publishedAt: -1 })
    .limit(1)
    .next();
  return {
    defaults: APP_TOUR_DEFAULTS,
    current: row
      ? { id: row.id, title: typeof row.body?.title === 'string' ? row.body.title : '', publishedAt: row.publishedAt }
      : null,
  };
}

export async function publishAppTourPost(admin: Admin, input: AppTourInput, image?: ConnectMediaFile) {
  const org = orgForUser(admin);
  const replace = input.replace === true || input.replace === 'true';
  const live = await connectPosts()
    .find({ org, type: 'app_tour' }, { projection: { _id: 0, id: 1 } })
    .toArray();
  if (live.length > 0 && !replace) {
    throw new ConnectError(409, 'An app tour post is already in the feed. Replace it to post a new one.');
  }
  if (image && !image.contentType.startsWith('image/')) {
    throw new ConnectError(400, 'The picture must be a JPEG, PNG or WEBP image');
  }

  const title = text(input.title, APP_TOUR_DEFAULTS.title, LIMITS.title);
  const caption = text(input.caption, APP_TOUR_DEFAULTS.caption, LIMITS.caption);
  const actionLabel = text(input.actionLabel, APP_TOUR_DEFAULTS.actionLabel, LIMITS.actionLabel);

  let media: Record<string, unknown> = { mediaKind: 'none' };
  if (image) {
    let stored: { objectKey?: string; contentType: string; size: number };
    try {
      // Stored as feed pictures are, with the smaller copies the feed is served.
      stored = await uploadConnectMedia(admin.userId, image, 'post');
    } catch {
      throw new ConnectError(503, 'Media storage is unavailable');
    }
    if (!stored.objectKey) throw new ConnectError(503, 'Media storage is unavailable');
    media = {
      mediaKind: 'image',
      mediaObjectKey: stored.objectKey,
      mediaContentType: stored.contentType,
      mediaSize: stored.size,
      mediaObjectKeys: [stored.objectKey],
      mediaContentTypes: [stored.contentType],
    };
  }

  const companyName = await companyDisplayName(org, 'Your company');
  const now = new Date();
  const post: ConnectPost = {
    id: randomUUID(),
    org,
    type: 'app_tour',
    ...postMeta('app_tour'),
    // The company, as its announcements are: nobody to tap through to.
    author: {
      userId: '',
      name: companyName,
      initials: companyName.trim().slice(0, 1).toUpperCase() || 'S',
      designation: 'HR',
      avatarColor: '#0B6FAA',
    },
    audience: { label: 'Public', org },
    body: {
      title,
      caption,
      actionLabel,
      text: `${title}\n\n${caption}\n\n${APP_TOUR_UPDATE_LINE}`,
      ...media,
    },
    likedBy: [],
    comments: [],
    actionBy: {},
    pollVotes: {},
    publishedAt: now,
    pinnedUntil: null,
    createdAt: now,
    updatedAt: now,
  } as ConnectPost;
  await connectPosts().insertOne(post);
  // Open feeds pick it up at once.
  emitConnectChange({
    postId: post.id,
    action: 'created',
    actorUserId: admin.userId,
    org,
    userIds: realtimeUserIds(post.audience),
  });

  // Only now the old one goes: the app's own delete, then its open reports.
  const replaced: string[] = [];
  for (const old of live) {
    await deleteConnectPost(admin.userId, old.id);
    await closeReportsForRemovedPost(old.id, admin.userId);
    replaced.push(old.id);
  }
  return { id: post.id, replaced };
}
