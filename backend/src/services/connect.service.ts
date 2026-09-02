import { randomUUID } from 'node:crypto';
import { connectPosts, gameScores, users } from '../config/db';
import { ConnectPost, ConnectPostType } from '../models/connect.model';
import { User } from '../models/user.model';
import { notifyUsers, queueBatchedNotification } from './notification.service';
import {
  deleteConnectMedia,
  presignConnectMedia,
  type ConnectMediaFile,
  uploadConnectMedia,
} from './s3-connect-media.service';

export class ConnectError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getConnectFeed(viewerUserId: string) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const org = orgForUser(viewer);
  await ensureDefaultConnectPosts(org);

  const posts = await connectPosts()
    .find({
      org,
      $or: [
        // MongoDB's driver stores `undefined` as BSON null rather than
        // dropping the key, so company-wide posts persist with an explicit
        // `department: null` — querying for `null` matches both that and a
        // genuinely missing field, unlike `$exists: false`.
        { 'audience.department': null },
        { 'audience.department': viewer.department },
      ],
    })
    .sort({ publishedAt: -1, createdAt: -1 })
    .limit(50)
    .toArray();

  // `post.author.photoUrl` is a snapshot frozen at creation time (see
  // `createConnectPost`), so a post predates whatever profile photo its
  // author later uploads. Resolve the live photo for everyone shown in this
  // page in one query rather than trusting the stale snapshot.
  const authorIds = [
    ...new Set(posts.map((post) => post.author.userId).filter((id): id is string => Boolean(id))),
  ];
  const authors = await users()
    .find({ userId: { $in: authorIds } })
    .project<{ userId: string; profilePhotoUrl?: string }>({ userId: 1, profilePhotoUrl: 1 })
    .toArray();
  const authorPhotoUrls = new Map(authors.map((author) => [author.userId, author.profilePhotoUrl]));

  return Promise.all(posts.map((post) => viewPost(post, viewerUserId, authorPhotoUrls)));
}

export async function toggleConnectReaction(viewerUserId: string, postId: string) {
  const post = await requireVisiblePost(viewerUserId, postId);
  const liked = post.likedBy.includes(viewerUserId);
  const update = liked
    ? { $pull: { likedBy: viewerUserId } }
    : { $addToSet: { likedBy: viewerUserId } };
  await connectPosts().updateOne({ id: postId }, update);
  if (!liked && post.author.userId && post.author.userId !== viewerUserId) {
    const viewer = await users().findOne({ userId: viewerUserId });
    await queueBatchedNotification(post.author.userId, 'post_liked', post.id,
      viewer?.name ?? 'Someone', '', { destination: 'connect_post', postId: post.id });
  }
  const updated = await connectPosts().findOne({ id: postId });
  return viewPost(updated ?? post, viewerUserId);
}

export async function addConnectComment(
  viewerUserId: string,
  postId: string,
  textInput: string,
  parentId?: string,
) {
  const post = await requireVisiblePost(viewerUserId, postId);
  const viewer = await users().findOne({ userId: viewerUserId });
  const text = textInput.trim();
  if (text.length < 1) throw new ConnectError(400, 'Comment cannot be empty');
  if (text.length > 500) throw new ConnectError(400, 'Comment is too long');
  if (parentId) {
    const parent = post.comments.find((existing) => existing.id === parentId);
    if (!parent) throw new ConnectError(400, 'Reply target not found');
    if (parent.parentId) throw new ConnectError(400, 'Cannot reply to a reply');
  }
  const comment = {
    id: randomUUID(),
    userId: viewerUserId,
    name: viewer?.name ?? 'Teammate',
    text,
    createdAt: new Date(),
    likedBy: [] as string[],
    ...(parentId ? { parentId } : {}),
  };
  await connectPosts().updateOne(
    { id: post.id },
    { $push: { comments: comment }, $set: { updatedAt: new Date() } },
  );
  if (post.author.userId && post.author.userId !== viewerUserId) {
    await notifyUsers([post.author.userId], {
      scenario: 'post_commented', title: 'New comment',
      body: `${viewer?.name ?? 'Someone'} commented on your post: "${text.slice(0, 60)}"`,
      data: { destination: 'connect_comment', postId: post.id, commentId: comment.id },
    });
  }
  const updated = await connectPosts().findOne({ id: postId });
  return viewPost(updated ?? post, viewerUserId);
}

export async function toggleConnectCommentReaction(
  viewerUserId: string,
  postId: string,
  commentId: string,
) {
  const post = await requireVisiblePost(viewerUserId, postId);
  const comment = post.comments.find((item) => item.id === commentId);
  if (!comment) throw new ConnectError(404, 'Comment not found');
  const liked = (comment.likedBy ?? []).includes(viewerUserId);
  const update = liked
    ? { $pull: { 'comments.$[c].likedBy': viewerUserId } }
    : { $addToSet: { 'comments.$[c].likedBy': viewerUserId } };
  await connectPosts().updateOne({ id: postId }, update, {
    arrayFilters: [{ 'c.id': commentId }],
  });
  const updated = await connectPosts().findOne({ id: postId });
  return viewPost(updated ?? post, viewerUserId);
}

export async function performConnectAction(
  viewerUserId: string,
  postId: string,
  input: { optionId?: string },
) {
  const post = await requireVisiblePost(viewerUserId, postId);
  const now = new Date();
  if (post.type === 'survey') {
    const options = ((post.body.options as Array<{ id: string }> | undefined) ?? []).map(
      (option) => option.id,
    );
    const optionId = String(input.optionId ?? '');
    if (!options.includes(optionId)) throw new ConnectError(400, 'Survey option is invalid');
    await connectPosts().updateOne(
      { id: postId },
      { $set: { [`pollVotes.${viewerUserId}`]: optionId, updatedAt: now } },
    );
    if (post.author.userId && post.author.userId !== viewerUserId) {
      const viewer = await users().findOne({ userId: viewerUserId });
      await queueBatchedNotification(post.author.userId, 'poll_voted', post.id,
        viewer?.name ?? 'Someone', String(post.body.title ?? 'Poll'),
        { destination: 'connect_post', postId: post.id });
    }
  } else {
    const existing = post.actionBy?.[viewerUserId];
    if (existing) {
      await connectPosts().updateOne(
        { id: postId },
        { $unset: { [`actionBy.${viewerUserId}`]: true }, $set: { updatedAt: now } },
      );
    } else {
      await connectPosts().updateOne(
        { id: postId },
        { $set: { [`actionBy.${viewerUserId}`]: defaultActionValue(post.type), updatedAt: now } },
      );
    }
  }
  const updated = await connectPosts().findOne({ id: postId });
  return viewPost(updated ?? post, viewerUserId);
}

export interface ConnectPostInput {
  type?: string;
  body?: Record<string, unknown>;
  media?: ConnectMediaFile[];
  pollOptionImages?: ConnectMediaFile[];
  /// Option index each entry in `pollOptionImages` belongs to, since options
  /// without an image are skipped on upload rather than sent as a gap.
  pollOptionImageIndexes?: number[];
  removeMedia?: boolean;
}

function sparsePollImageKeys(
  uploaded: UploadedMedia[],
  indexes: number[] | undefined,
): (string | undefined)[] {
  if (uploaded.length === 0) return [];
  const keys: (string | undefined)[] = [];
  uploaded.forEach((media, i) => {
    const optionIndex = indexes?.[i] ?? i;
    keys[optionIndex] = media.objectKey;
  });
  return keys;
}

export async function createConnectPost(viewerUserId: string, input: ConnectPostInput) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const type = parsePostType(input.type);
  const now = new Date();
  const meta = postMeta(type);
  const uploadedMedia = await storeConnectMediaMany(viewerUserId, input.media ?? []);
  const uploadedPollImages = await storeConnectMediaMany(viewerUserId, input.pollOptionImages ?? []);
  try {
    const normalizedBody = normalizePostBody(
      type,
      input.body ?? {},
      sparsePollImageKeys(uploadedPollImages, input.pollOptionImageIndexes),
    );
    const visibility = visibilityFromBody(type, normalizedBody, viewer);
    const post: ConnectPost = {
      id: randomUUID(),
      org: orgForUser(viewer),
      type,
      tag: meta.tag,
      tagIcon: meta.tagIcon,
      tagColor: meta.tagColor,
      tagTint: meta.tagTint,
      author: authorForUser(viewer),
      audience: {
        label: visibility.label,
        org: orgForUser(viewer),
        department: visibility.department,
      },
      body: withMedia(normalizedBody, uploadedMedia),
      likedBy: [],
      comments: [],
      actionBy: {},
      pollVotes: {},
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await connectPosts().insertOne(post);
    return viewPost(post, viewerUserId);
  } catch (error) {
    await deleteConnectMediaMany([...uploadedMedia, ...uploadedPollImages]);
    throw error;
  }
}

export async function updateConnectPost(
  viewerUserId: string,
  postId: string,
  input: ConnectPostInput,
) {
  const { post, viewer } = await requireEditablePost(viewerUserId, postId);
  const type = parsePostType(input.type ?? post.type);
  const meta = postMeta(type);
  const uploadedMedia = await storeConnectMediaMany(viewerUserId, input.media ?? []);
  const uploadedPollImages = await storeConnectMediaMany(viewerUserId, input.pollOptionImages ?? []);
  try {
    const normalizedBody = normalizePostBody(
      type,
      input.body ?? post.body,
      uploadedPollImages.length > 0
        ? sparsePollImageKeys(uploadedPollImages, input.pollOptionImageIndexes)
        : existingPollImageKeys(post.body),
    );
    const visibility = visibilityFromBody(type, normalizedBody, viewer);
    const existingMediaObjectKeys = mediaObjectKeys(post.body);
    const body = input.removeMedia
      ? withoutMedia(normalizedBody)
      : withMedia(
          normalizedBody,
          uploadedMedia.length > 0 ? uploadedMedia : mediaFromBody(post.body),
        );
    const update = {
      $set: {
        type,
        tag: meta.tag,
        tagIcon: meta.tagIcon,
        tagColor: meta.tagColor,
        tagTint: meta.tagTint,
        audience: {
          label: visibility.label,
          org: post.org,
          department: visibility.department,
        },
        body,
        updatedAt: new Date(),
      },
    };
    await connectPosts().updateOne({ id: post.id }, update);
    if ((uploadedMedia.length > 0 || input.removeMedia) && existingMediaObjectKeys.length > 0) {
      await deleteConnectMediaByKeys(existingMediaObjectKeys);
    }
    const updated = await connectPosts().findOne({ id: post.id });
    return viewPost(updated ?? post, viewer.userId);
  } catch (error) {
    await deleteConnectMediaMany([...uploadedMedia, ...uploadedPollImages]);
    throw error;
  }
}

export async function deleteConnectPost(viewerUserId: string, postId: string) {
  const { post } = await requireEditablePost(viewerUserId, postId);
  await connectPosts().deleteOne({ id: post.id });
  await deleteConnectMediaByKeys(mediaObjectKeys(post.body));
  return { id: post.id };
}

async function requireVisiblePost(viewerUserId: string, postId: string) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const post = await connectPosts().findOne({ id: postId, org: orgForUser(viewer) });
  if (!post) throw new ConnectError(404, 'Post not found');
  const department = post.audience.department;
  if (department && department !== viewer.department) {
    throw new ConnectError(403, 'Post is not visible to you');
  }
  return post;
}

async function requireEditablePost(viewerUserId: string, postId: string) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const post = await connectPosts().findOne({ id: postId, org: orgForUser(viewer) });
  if (!post) throw new ConnectError(404, 'Post not found');
  if (post.author.userId !== viewerUserId && !viewer.dashboardAccess) {
    throw new ConnectError(403, 'You can only edit your own posts');
  }
  return { post, viewer };
}

async function viewPost(
  post: ConnectPost,
  viewerUserId: string,
  authorPhotoUrls?: Map<string, string | undefined>,
) {
  let authorPhotoUrl = post.author.photoUrl;
  if (post.author.userId) {
    if (authorPhotoUrls) {
      if (authorPhotoUrls.has(post.author.userId)) {
        authorPhotoUrl = authorPhotoUrls.get(post.author.userId);
      }
    } else {
      const authorUser = await users().findOne({ userId: post.author.userId });
      if (authorUser) authorPhotoUrl = authorUser.profilePhotoUrl;
    }
  }
  const liked = post.likedBy.includes(viewerUserId);
  const pollVotes = post.pollVotes ?? {};
  const selectedPollOptionId = pollVotes[viewerUserId] ?? null;
  const actionValue = post.actionBy?.[viewerUserId] ?? null;
  const body = { ...post.body };
  const objectKeys = mediaObjectKeys(body);
  if (objectKeys.length > 0) {
    const urls = await Promise.all(
      objectKeys.map((key) => presignConnectMedia(key).catch(() => undefined)),
    );
    body.mediaUrl = urls[0];
    body.mediaUrls = urls;
  }
  if (post.type === 'survey') {
    const options = await Promise.all(
      (
        post.body.options as Array<{
          id: string;
          label: string;
          votes: number;
          imageObjectKey?: string;
        }>
      ).map(async (option) => {
        const liveVotes =
          option.votes + Object.values(pollVotes).filter((vote) => vote === option.id).length;
        const imageUrl = option.imageObjectKey
          ? await presignConnectMedia(option.imageObjectKey).catch(() => undefined)
          : undefined;
        return { ...option, votes: liveVotes, imageUrl };
      }),
    );
    body.options = options;
    body.totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  }
  if (post.type === 'event') {
    // Registered count is never user-entered — it's however many viewers have
    // taken the "Register" action, the same actionBy map RSVP/wish-style
    // posts already use, plus whatever baseline the seed data carries.
    const baseCount = typeof body.baseCount === 'number' ? body.baseCount : 0;
    body.registeredCount = baseCount + Object.keys(post.actionBy ?? {}).length;
  }
  if (post.type === 'live_game' && typeof body.gameId === 'string') {
    const leaders = await gameScores()
      .find({ gameId: body.gameId, org: post.org })
      .sort({ score: -1, achievedAt: 1 })
      .limit(3)
      .toArray();
    body.leaderboard = leaders.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      playerName: entry.playerName,
      score: entry.score,
    }));
  }
  const comments = post.comments.map((comment) => ({
    ...comment,
    likedBy: comment.likedBy ?? [],
    likeCount: (comment.likedBy ?? []).length,
    liked: (comment.likedBy ?? []).includes(viewerUserId),
  }));
  return {
    ...post,
    author: { ...post.author, photoUrl: authorPhotoUrl },
    body,
    comments,
    liked,
    likeCount: post.likedBy.length,
    commentCount: post.comments.length,
    selectedPollOptionId,
    actionValue,
  };
}

function orgForUser(user: Pick<User, 'org' | 'email'>) {
  return user.org ?? user.email.split('@').at(1) ?? 'default';
}

function authorForUser(user: User) {
  return {
    userId: user.userId,
    name: user.name,
    initials: initialsFor(user.name),
    designation: user.designation ?? user.role ?? 'Teammate',
    avatarColor: avatarColorFor(user.userId),
    photoUrl: user.profilePhotoUrl,
  };
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function avatarColorFor(seed: string) {
  const palette = ['#BE5A36', '#C98A2E', '#4C5840', '#4F8C89', '#8A6AA0', '#C26B8A'];
  const sum = seed.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[sum % palette.length];
}

function parsePostType(value: string | undefined): ConnectPostType {
  const allowed: ConnectPostType[] = [
    'leadership',
    'hr_announcement',
    'new_post',
    'birthday',
    'anniversary',
    'kudos',
    'award',
    'survey',
    'event',
    'live_game',
    'new_joinee',
    'recommendation',
  ];
  if (allowed.includes(value as ConnectPostType)) return value as ConnectPostType;
  throw new ConnectError(400, 'Post type is invalid');
}

function normalizePostBody(
  type: ConnectPostType,
  input: Record<string, unknown>,
  pollOptionImageKeys: (string | undefined)[] = [],
) {
  switch (type) {
    case 'leadership':
      return {
        text: normalizeText(input.text, '', 1200),
        mediaKind: normalizeText(input.mediaKind, 'none', 20),
        mediaTitle: normalizeText(input.mediaTitle, '', 120),
        mediaDuration: normalizeText(input.mediaDuration, '', 20),
        linkUrl: normalizeText(input.linkUrl, '', 300),
        linkTitle: normalizeText(input.linkTitle, '', 160),
        linkDomain: normalizeText(input.linkDomain, '', 120),
      };
    case 'new_post':
      return {
        postKind: normalizeChoice(input.postKind, 'media', ['media', 'text', 'question', 'link']),
        text: normalizeText(input.text, '', 1200),
        mediaKind: normalizeText(input.mediaKind, 'none', 20),
        mediaTitle: normalizeText(input.mediaTitle, '', 120),
        mediaDuration: normalizeText(input.mediaDuration, '', 20),
        linkUrl: normalizeText(input.linkUrl, '', 300),
        linkTitle: normalizeText(input.linkTitle, '', 160),
        linkDomain: normalizeText(input.linkDomain, '', 120),
        sendTo: normalizeSendTo(input.sendTo),
        sendToDepartment: normalizeDepartment(input.sendToDepartment),
      };
    case 'recommendation':
      return {
        text: normalizeText(input.text, '', 1200),
        mediaKind: 'none',
        mediaTitle: normalizeText(input.mediaTitle, '', 120),
        mediaDuration: '',
        linkUrl: normalizeText(input.linkUrl, '', 300),
        linkTitle: normalizeText(input.linkTitle, '', 160),
        linkDomain: normalizeText(input.linkDomain, '', 120),
      };
    case 'hr_announcement': {
      const requireAcknowledgement = input.requireAcknowledgement === true;
      return {
        title: normalizeText(input.title, 'Announcement', 80),
        text: normalizeText(input.text, '', 1000),
        severity: normalizeAnnouncementSeverity(input.severity),
        sendTo: normalizeSendTo(input.sendTo),
        sendToDepartment: normalizeDepartment(input.sendToDepartment),
        requireAcknowledgement,
        acknowledgementMessage: requireAcknowledgement
          ? normalizeText(input.acknowledgementMessage, '', 300)
          : '',
      };
    }
    case 'kudos':
      return {
        text: normalizeText(input.text, '', 700),
        personName: normalizeText(input.personName, 'Teammate', 80),
        personInitials: normalizeText(input.personInitials, 'T', 4),
      };
    case 'survey':
      return {
        title: normalizeText(input.title, '', 160),
        totalVotes: 0,
        options: normalizePollOptions(input.options, pollOptionImageKeys),
        sendTo: normalizeSendTo(input.sendTo),
        sendToDepartment: normalizeDepartment(input.sendToDepartment),
      };
    case 'event':
      return {
        title: normalizeText(input.title, '', 140),
        subtitle: normalizeText(input.subtitle, '', 180),
        category: normalizeChoice(input.category, 'sports', [
          'sports',
          'wellness',
          'social',
          'learning',
          'creative',
        ]),
        date: normalizeText(input.date, '', 20),
        time: normalizeText(input.time, '', 20),
        location: normalizeText(input.location, '', 120),
        prize: normalizeText(input.prize, '', 120),
        allowRegistration: input.allowRegistration !== false,
        actionLabel: input.allowRegistration === false ? '' : 'Register',
        actionDoneLabel: input.allowRegistration === false ? '' : 'Registered',
      };
    default:
      return input;
  }
}

type UploadedMedia = { objectKey: string; contentType: string; size: number };

async function storeConnectMediaMany(
  userId: string,
  files: ConnectMediaFile[],
): Promise<UploadedMedia[]> {
  try {
    return await Promise.all(files.map((file) => uploadConnectMedia(userId, file)));
  } catch {
    throw new ConnectError(503, 'Media storage is unavailable');
  }
}

async function deleteConnectMediaMany(media: (UploadedMedia | undefined)[]) {
  await deleteConnectMediaByKeys(
    media.filter((item): item is UploadedMedia => Boolean(item)).map((item) => item.objectKey),
  );
}

async function deleteConnectMediaByKeys(objectKeys: string[]) {
  await Promise.all(objectKeys.map((key) => deleteConnectMedia(key).catch(() => undefined)));
}

/// A single post can carry multiple images/videos (up to 6) — `mediaObjectKeys`
/// is the source of truth; `mediaObjectKey`/`mediaContentType`/`mediaSize`
/// mirror the first item for any code still reading the old singular fields.
function withMedia(body: Record<string, unknown>, media: UploadedMedia[]) {
  if (media.length === 0) return body;
  const first = media[0];
  return {
    ...body,
    mediaKind: first.contentType.startsWith('video/') ? 'video' : 'image',
    mediaObjectKey: first.objectKey,
    mediaContentType: first.contentType,
    mediaSize: first.size,
    mediaObjectKeys: media.map((item) => item.objectKey),
    mediaContentTypes: media.map((item) => item.contentType),
  };
}

function withoutMedia(body: Record<string, unknown>) {
  const next = { ...body };
  delete next.mediaObjectKey;
  delete next.mediaContentType;
  delete next.mediaSize;
  delete next.mediaObjectKeys;
  delete next.mediaContentTypes;
  if (next.mediaKind === 'image' || next.mediaKind === 'video') next.mediaKind = 'none';
  return next;
}

function mediaObjectKeys(body: Record<string, unknown>): string[] {
  const many = body.mediaObjectKeys;
  if (Array.isArray(many)) {
    return many.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }
  const single = body.mediaObjectKey;
  return typeof single === 'string' && single.trim().length > 0 ? [single] : [];
}

function mediaFromBody(body: Record<string, unknown>): UploadedMedia[] {
  const keys = mediaObjectKeys(body);
  const contentTypes = Array.isArray(body.mediaContentTypes)
    ? (body.mediaContentTypes as unknown[])
    : [body.mediaContentType];
  const size = typeof body.mediaSize === 'number' ? body.mediaSize : 0;
  return keys.map((objectKey, index) => ({
    objectKey,
    contentType: typeof contentTypes[index] === 'string' ? (contentTypes[index] as string) : '',
    size: index === 0 ? size : 0,
  }));
}

function existingPollImageKeys(body: Record<string, unknown>): (string | undefined)[] {
  const options = Array.isArray(body.options) ? body.options : [];
  return options.map((option) =>
    option && typeof option === 'object' && typeof (option as { imageObjectKey?: unknown }).imageObjectKey === 'string'
      ? ((option as { imageObjectKey?: string }).imageObjectKey as string)
      : undefined,
  );
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : fallback;
  return (text || fallback).slice(0, maxLength);
}

function normalizeDepartment(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, 80) : undefined;
}

function normalizeChoice(value: unknown, fallback: string, allowed: string[]) {
  if (typeof value !== 'string') return fallback;
  return allowed.includes(value) ? value : fallback;
}

function normalizeSendTo(value: unknown) {
  return normalizeChoice(value, 'all_company', ['all_company', 'my_team']);
}

function normalizeAnnouncementSeverity(value: unknown) {
  if (value === 'highlight' || value === 'alert') return 'highlight_alert';
  return normalizeChoice(value, 'plain', ['plain', 'highlight_alert']);
}

function visibilityFromBody(
  type: ConnectPostType,
  body: Record<string, unknown>,
  viewer: User,
) {
  const canTargetTeam = type === 'hr_announcement' || type === 'survey' || type === 'new_post';
  const sendTo = canTargetTeam ? body.sendTo : undefined;
  const department =
    sendTo === 'my_team'
      ? normalizeDepartment(body.sendToDepartment) ?? normalizeDepartment(viewer.department)
      : undefined;
  return {
    label: department ? 'Team' : 'Company',
    department,
  };
}

function normalizePollOptions(value: unknown, imageKeys: (string | undefined)[] = []) {
  const raw = Array.isArray(value) ? value : [];
  const labels = raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'label' in item) {
        return String((item as { label?: unknown }).label ?? '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 4);
  if (labels.length < 2) throw new ConnectError(400, 'Survey needs at least two options');
  return labels.map((label, index) => ({
    id: randomUUID(),
    label: label.slice(0, 80),
    votes: 0,
    ...(imageKeys[index] ? { imageObjectKey: imageKeys[index] } : {}),
  }));
}

function postMeta(type: ConnectPostType) {
  const meta = {
    leadership: ['Leadership', '👑', '#C98A2E', '#F4ECDD'],
    hr_announcement: ['Announcement', '📣', '#C98A2E', '#F4ECDD'],
    new_post: ['New Post', '✍️', '#BE5A36', '#F6E5DB'],
    birthday: ['Birthday', '🎂', '#BE5A36', '#F6E5DB'],
    anniversary: ['Anniversary', '🎉', '#4C5840', '#E9EBE0'],
    kudos: ['Kudos', '👏', '#BE5A36', '#F6E5DB'],
    award: ['Award', '🏆', '#C98A2E', '#F4ECDD'],
    survey: ['Survey/Poll', '📊', '#BE5A36', '#F6E5DB'],
    event: ['Event', '🎟️', '#BE5A36', '#F6E5DB'],
    live_game: ['Live Game', '🎮', '#E0483B', '#FBE2DE'],
    new_joinee: ['New Joinee', '👋', '#C26B8A', '#F5E4EC'],
    recommendation: ['Must Watch/Read', '🎬', '#4F6F8C', '#E4EBF0'],
  } satisfies Record<ConnectPostType, [string, string, string, string]>;
  const [tag, tagIcon, tagColor, tagTint] = meta[type];
  return { tag, tagIcon, tagColor, tagTint };
}

async function ensureDefaultConnectPosts(org: string) {
  const existing = await connectPosts().countDocuments({ org });
  if (existing > 0) return;
  const now = Date.now();
  const posts = defaultPosts(org).map((post, index) => ({
    ...post,
    publishedAt: new Date(now - index * 1000 * 60 * 60 * 4),
    createdAt: new Date(now - index * 1000 * 60 * 60 * 4),
    updatedAt: new Date(now - index * 1000 * 60 * 60 * 4),
  }));
  await connectPosts().insertMany(posts);
}

function defaultPosts(org: string): ConnectPost[] {
  return [
    post(
      org,
      'leadership',
      'Leadership',
      '👑',
      '#C98A2E',
      '#F4ECDD',
      'Vikrant Singh',
      'V',
      'Co-founder & CEO',
      '#BE5A36',
      'Company',
      {
        text: 'We did it, team. Sowaka has been named Best PropTech Company of the Year. This belongs to every single one of you.',
        mediaKind: 'video',
        mediaTitle: 'Award ceremony 2026',
        mediaDuration: '1:24',
      },
      342,
    ),
    post(
      org,
      'hr_announcement',
      'Announcement',
      '📣',
      '#C98A2E',
      '#F4ECDD',
      'People & Culture',
      'HR',
      'HR & Admin team',
      '#C98A2E',
      'Company',
      {
        title: 'Heads up!',
        text: 'There is construction ongoing in the common area. It will not be accessible on 17 June. Please plan accordingly.',
        severity: 'warning',
      },
      48,
    ),
    post(
      org,
      'birthday',
      'Birthday',
      '🎂',
      '#BE5A36',
      '#F6E5DB',
      'Sowaka Connect',
      'S',
      'Auto · HRIS',
      '#C98A2E',
      'Company',
      {
        personName: 'Sneha Sharma',
        personInitials: 'S',
        subtitle: 'Product Designer · turns a year wiser today',
        actionLabel: 'Send wishes',
        actionDoneLabel: 'Wish sent!',
      },
      87,
    ),
    post(
      org,
      'anniversary',
      'Anniversary',
      '🎉',
      '#4C5840',
      '#E9EBE0',
      'Sowaka Connect',
      'S',
      'Auto · HRIS',
      '#4C5840',
      'Company',
      {
        personName: 'Rahul Mehta',
        personInitials: 'R',
        years: 3,
        subtitle: 'Engineering · joined June 2023',
      },
      112,
    ),
    post(
      org,
      'kudos',
      'Kudos',
      '👏',
      '#BE5A36',
      '#F6E5DB',
      'Arjun Mehta',
      'A',
      'Design Manager',
      '#4F8C89',
      'Team',
      {
        text: 'Huge shout-out to Prashant for closing the onboarding edge cases before launch. Calm, thorough and very team-first.',
        personName: 'Prashant Nair',
        personInitials: 'P',
      },
      97,
    ),
    post(
      org,
      'award',
      'Award',
      '🏆',
      '#C98A2E',
      '#F4ECDD',
      'Sowaka Connect',
      'S',
      'Auto · Recognition',
      '#C98A2E',
      'Company',
      {
        personName: 'Tara Reddy',
        title: 'Culture Champion',
        reason: 'For making new team members feel included from day one.',
      },
      156,
    ),
    post(
      org,
      'survey',
      'Survey/Poll',
      '📊',
      '#BE5A36',
      '#F6E5DB',
      'People & Culture',
      'HR',
      'HR & Admin team',
      '#C98A2E',
      'Company',
      {
        title: 'What should our next learning session be?',
        totalVotes: 97,
        options: [
          { id: 'fin', label: 'Financial Planning', votes: 14 },
          { id: 'fit', label: 'Fitness Session', votes: 22 },
          { id: 'stress', label: 'Stress Management Workshop', votes: 19 },
          { id: 'ai', label: 'AI Training in My Job', votes: 31 },
          { id: 'stress2', label: 'Stress Management Session', votes: 11 },
        ],
      },
      54,
    ),
    post(
      org,
      'event',
      'Event',
      '🎟️',
      '#BE5A36',
      '#F6E5DB',
      'People & Culture',
      'HR',
      'HR & Admin team',
      '#BE5A36',
      'Company',
      {
        title: 'Friday Game Night',
        subtitle: 'Cafeteria · 5:30 PM',
        actionLabel: 'Register',
        actionDoneLabel: 'Registered',
        countLabel: 'registered',
        baseCount: 15,
      },
      63,
    ),
    post(
      org,
      'live_game',
      'Live Game',
      '🎮',
      '#E0483B',
      '#FBE2DE',
      'Sowaka Connect',
      'G',
      'Auto · Games',
      '#4F8C89',
      'Company',
      {
        title: 'Find Your Mate',
        subtitle: 'Match the clue to the teammate it describes before the timer runs out.',
        startsAtLabel: 'Starts 5:30 PM',
        actionLabel: 'Play now',
        actionDoneLabel: 'Played',
      },
      24,
    ),
    post(
      org,
      'new_joinee',
      'New Joinee',
      '👋',
      '#C26B8A',
      '#F5E4EC',
      'Sowaka Connect',
      'S',
      'Auto · HRIS',
      '#C26B8A',
      'Team',
      {
        personName: 'Ishaan Kapoor',
        personInitials: 'I',
        subtitle: 'Joining as Product Designer · Team Design',
        facts: 'Previously Product Designer at Zomato · based in Bengaluru · started 8 July 2026.',
        managerNote:
          "Thrilled to have Ishaan join us. He'll be leading design on our onboarding flows.",
        actionLabel: 'Say hi',
        actionDoneLabel: 'Said hi!',
      },
      64,
    ),
    post(
      org,
      'recommendation',
      'Must Watch/Read',
      '🎬',
      '#4F6F8C',
      '#E4EBF0',
      'Meera Iyer',
      'M',
      'Design Lead',
      '#4F6F8C',
      'Company',
      {
        text: "If you're figuring out how to give feedback that actually lands, this one's worth the 12 minutes.",
        mediaKind: 'video',
        mediaTitle: 'The Feedback Fallacy — HBR',
        mediaDuration: '12:04',
      },
      29,
    ),
  ];
}

function post(
  org: string,
  type: ConnectPostType,
  tag: string,
  tagIcon: string,
  tagColor: string,
  tagTint: string,
  authorName: string,
  initials: string,
  designation: string,
  avatarColor: string,
  visibilityLabel: string,
  body: Record<string, unknown>,
  baseLikes: number,
  department?: string,
): ConnectPost {
  return {
    id: randomUUID(),
    org,
    type,
    tag,
    tagIcon,
    tagColor,
    tagTint,
    author: { name: authorName, initials, designation, avatarColor },
    audience: { label: visibilityLabel, org, department },
    body,
    likedBy: Array.from({ length: baseLikes }, (_, index) => `seed-${type}-${index}`),
    comments: [],
    actionBy: {},
    pollVotes: {},
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function defaultActionValue(type: ConnectPostType) {
  return type;
}

function systemAuthor() {
  return {
    name: 'Sowaka Connect',
    initials: 'S',
    designation: 'Auto · HRIS',
    avatarColor: '#C98A2E',
  };
}

function systemPost(
  org: string,
  type: 'birthday' | 'anniversary' | 'new_joinee',
  systemKey: string,
  body: Record<string, unknown>,
  department?: string,
): ConnectPost {
  const now = new Date();
  const meta = postMeta(type);
  return {
    id: randomUUID(),
    systemKey,
    org,
    type,
    ...meta,
    author: systemAuthor(),
    audience: { label: department ? 'Team' : 'Company', org, department },
    body,
    likedBy: [],
    comments: [],
    actionBy: {},
    pollVotes: {},
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function insertSystemPost(post: ConnectPost) {
  await connectPosts().updateOne(
    { systemKey: post.systemKey },
    { $setOnInsert: post },
    { upsert: true },
  );
}

/** Generate today's birthday and work-anniversary posts, safely repeatable. */
export async function generateDailyLifecyclePosts(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => Number(dateParts.find((p) => p.type === type)?.value ?? 0);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const employees = await users().find({ lifecycleStatus: { $nin: ['offboarded', 'terminated'] } }).toArray();

  for (const employee of employees) {
    const org = orgForUser(employee);
    if (employee.birthday && employee.birthday.getUTCMonth() + 1 === month && employee.birthday.getUTCDate() === day) {
      await insertSystemPost(systemPost(org, 'birthday', `birthday:${employee.userId}:${dateKey}`, {
        personName: employee.name,
        personInitials: initialsFor(employee.name),
        photoUrl: employee.profilePhotoUrl,
        subtitle: `${employee.designation ?? employee.department ?? 'Teammate'} · turns a year wiser today`,
        actionLabel: 'Send wishes',
        actionDoneLabel: 'Wish sent!',
      }));
    }
    if (employee.joiningDate && employee.joiningDate.getUTCMonth() + 1 === month && employee.joiningDate.getUTCDate() === day) {
      const years = year - employee.joiningDate.getUTCFullYear();
      if (years > 0) {
        await insertSystemPost(systemPost(org, 'anniversary', `anniversary:${employee.userId}:${dateKey}`, {
          personName: employee.name,
          personInitials: initialsFor(employee.name),
          photoUrl: employee.profilePhotoUrl,
          years,
          subtitle: `${employee.department ?? employee.designation ?? 'Team'} · joined ${employee.joiningDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        }));
      }
    }
  }
}

/** Create the immediate welcome post emitted by the HR employee workflow. */
export async function generateNewJoineePost(employee: User, manager?: User) {
  const org = orgForUser(employee);
  await insertSystemPost(systemPost(org, 'new_joinee', `new-joinee:${employee.userId}`, {
    personName: employee.name,
    personInitials: initialsFor(employee.name),
    photoUrl: employee.profilePhotoUrl,
    subtitle: `Joining as ${employee.designation ?? 'Teammate'} · Team ${employee.department ?? 'Company'}`,
    facts: [employee.location ? `based in ${employee.location}` : '', employee.joiningDate ? `started ${employee.joiningDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : ''].filter(Boolean).join(' · '),
    managerName: manager?.name,
    managerInitials: manager ? initialsFor(manager.name) : undefined,
    managerDesignation: manager?.designation ?? (manager ? 'Manager' : undefined),
    managerNote: manager ? `Thrilled to have ${employee.name} join the team. Please say hi and help them feel at home!` : undefined,
    actionLabel: 'Say hi',
    actionDoneLabel: 'Said hi!',
  }, employee.department));
}
