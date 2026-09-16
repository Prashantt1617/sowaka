import { randomUUID } from 'node:crypto';
import { connectPosts, gameScores, users } from '../config/db';
import { ConnectPost, ConnectPostType } from '../models/connect.model';
import { User } from '../models/user.model';
import { notifyUsers } from './notification.service';
import {
  notifyCommentLiked, notifyPollVoted, notifyPostCommented, notifyPostLiked, notifyPostPublished,
} from './connect-notifications.service';
import { emitConnectChange, type ConnectChangeAction } from './connect-realtime.service';
import { blockedUserIdsFor } from './connect-blocks.service';
import { fetchLinkPreview } from './link-preview.service';
import {
  deleteConnectMedia,
  presignConnectMedia,
  resolveProfilePhoto,
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

/**
 * Posts that carry company communication rather than one colleague's voice.
 * A personal block never hides these — see the block filter in the feed.
 */
const ANNOUNCEMENT_POST_TYPES: ConnectPostType[] = ['leadership', 'hr_announcement'];

/**
 * The engagement formats people enter and vote on. They share one entry list,
 * one vote map and one leaderboard — a photo-story entry is a caption entry
 * that also carries a picture.
 */
const CHALLENGE_POST_TYPES: ConnectPostType[] = [
  'caption_challenge',
  'photo_story_challenge',
  'most_likely',
];
const isChallenge = (type: ConnectPostType) => CHALLENGE_POST_TYPES.includes(type);

/**
 * Tells every other client in the post's audience that it changed. Fire-and-
 * forget: a realtime hiccup must never fail the write that already succeeded.
 */
function announceChange(
  post: Pick<ConnectPost, 'id' | 'org' | 'audience'>,
  action: ConnectChangeAction,
  actorUserId?: string,
): void {
  emitConnectChange({
    postId: post.id,
    action,
    actorUserId,
    org: post.org,
    teamId: post.audience.teamId,
    department: post.audience.department,
  });
}

export async function getConnectFeed(viewerUserId: string) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const org = orgForUser(viewer);

  // Blocking is a personal mute: a blocked colleague's own posts drop out of
  // this viewer's feed. Official announcements are exempt — an employee who
  // has muted a colleague who happens to work in HR must still see what the
  // company tells everyone.
  const blockedUserIds = await blockedUserIdsFor(viewerUserId);
  const blockFilter =
    blockedUserIds.length > 0
      ? {
          $nor: [
            {
              'author.userId': { $in: blockedUserIds },
              type: { $nin: ANNOUNCEMENT_POST_TYPES },
            },
          ],
        }
      : {};

  const posts = await connectPosts()
    .find({
      org,
      ...blockFilter,
      $or: [
        // MongoDB's driver stores `undefined` as BSON null rather than
        // dropping the key, so company-wide posts persist with an explicit
        // null — querying for `null` matches both that and a genuinely
        // missing field, unlike `$exists: false`.
        { 'audience.teamId': null, 'audience.department': null },
        { 'audience.teamId': { $in: visibleTeamIds(viewer) } },
        // Posts written while Team meant "same department".
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
    .project<{ userId: string; profilePhotoKey?: string; profilePhotoUrl?: string }>({
      userId: 1,
      profilePhotoKey: 1,
      profilePhotoUrl: 1,
    })
    .toArray();
  const authorPhotoUrls = new Map(
    await Promise.all(
      authors.map(
        async (author) =>
          [author.userId, await resolveProfilePhoto(author)] as [string, string | undefined],
      ),
    ),
  );

  return Promise.all(
    posts.map((post) => viewPost(post, viewerUserId, authorPhotoUrls, blockedUserIds)),
  );
}

/**
 * One post rendered for one viewer. Clients call this after a realtime change
 * notice rather than refetching the whole feed for a single edited post.
 */
export async function getConnectPost(viewerUserId: string, postId: string) {
  const post = await requireVisiblePost(viewerUserId, postId);
  return viewPost(post, viewerUserId);
}

export async function toggleConnectReaction(viewerUserId: string, postId: string) {
  const post = await requireVisiblePost(viewerUserId, postId);
  const liked = post.likedBy.includes(viewerUserId);
  const update = liked
    ? { $pull: { likedBy: viewerUserId } }
    : { $addToSet: { likedBy: viewerUserId } };
  await connectPosts().updateOne({ id: postId }, update);
  const updated = await connectPosts().findOne({ id: postId });
  // Only on like, never on unlike: an unlike lowers the count that the next
  // notification reports, and announces nothing of its own.
  if (!liked) {
    const viewer = await users().findOne({ userId: viewerUserId });
    if (viewer) await notifyPostLiked(updated ?? post, viewer);
  }
  announceChange(post, 'updated', viewerUserId);
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
  if (viewer) {
    // `post` is the pre-insert copy on purpose: prior commenters are the people
    // who had commented before this one.
    await notifyPostCommented(post, comment, viewer, mentionedUserIdsIn(text, post));
  }
  const updated = await connectPosts().findOne({ id: postId });
  announceChange(post, 'updated', viewerUserId);
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
  if (!liked) {
    const viewer = await users().findOne({ userId: viewerUserId });
    if (viewer) await notifyCommentLiked(updated ?? post, comment, viewer);
  }
  announceChange(post, 'updated', viewerUserId);
  return viewPost(updated ?? post, viewerUserId);
}

/**
 * Adds this person's caption to a challenge.
 *
 * One each, and deliberately not editable. A caption that is already up may
 * have been voted on, and rewriting it underneath those votes would change
 * what people endorsed after the fact. Changing your mind means deleting and
 * posting again — which gives up the votes along with the caption, and the
 * points they earned.
 */
export async function addCaptionEntry(
  viewerUserId: string,
  postId: string,
  textInput: string,
  photo?: ConnectMediaFile,
  taggedUserId?: string,
) {
  const post = await requireVisiblePost(viewerUserId, postId);
  if (!isChallenge(post.type)) {
    throw new ConnectError(400, 'That post does not take entries');
  }
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  if ((post.captionEntries ?? []).some((entry) => entry.userId === viewerUserId)) {
    throw new ConnectError(
      409,
      post.type === 'most_likely'
        ? 'You have already tagged someone. Remove your tag to pick again.'
        : 'You have already entered this. Delete your entry to write a new one.',
    );
  }
  // Most Likely is answered by naming someone, so there is nothing to type —
  // the tag is the whole entry, and the points go to whoever was named.
  if (post.type === 'most_likely') {
    const tagged = await users().findOne({ userId: String(taggedUserId ?? '') });
    if (!tagged) throw new ConnectError(400, 'Tag a colleague first');
    if (orgForUser(tagged) !== post.org) {
      throw new ConnectError(400, 'You can only tag someone from your company');
    }
    if (tagged.userId === viewerUserId) {
      throw new ConnectError(400, 'You cannot tag yourself');
    }
    const tagEntry = {
      id: randomUUID(),
      userId: viewerUserId,
      name: viewer.name,
      initials: initialsFor(viewer.name),
      text: '',
      taggedUserId: tagged.userId,
      taggedName: tagged.name,
      taggedInitials: initialsFor(tagged.name),
      taggedDesignation: tagged.designation ?? tagged.department ?? '',
      createdAt: new Date(),
    };
    await connectPosts().updateOne(
      { id: postId },
      { $push: { captionEntries: tagEntry }, $set: { updatedAt: new Date() } },
    );
    await users().updateOne(
      { userId: tagged.userId },
      { $inc: { points: normalizePoints(post.body.pointsPerVote) } },
    );
    const afterTag = await connectPosts().findOne({ id: postId });
    announceChange(post, 'updated', viewerUserId);
    return viewPost(afterTag ?? post, viewerUserId);
  }

  const limit = Number(post.body.captionLimit ?? 140);
  const text = textInput.trim().slice(0, limit);
  if (!text) throw new ConnectError(400, 'Write your entry first');
  // A photo-story entry is the picture plus the story — one without the other
  // is not an entry, and the card has nowhere to show it.
  if (post.type === 'photo_story_challenge' && !photo) {
    throw new ConnectError(400, 'Add the photo you caught');
  }
  if (photo && !photo.contentType.startsWith('image/')) {
    throw new ConnectError(400, 'Entries must be a photo');
  }

  const uploaded = photo ? await storeConnectMediaMany(viewerUserId, [photo]) : [];
  const entry = {
    id: randomUUID(),
    userId: viewerUserId,
    name: viewer.name,
    initials: initialsFor(viewer.name),
    text,
    ...(uploaded.length ? { photoObjectKey: uploaded[0].objectKey } : {}),
    createdAt: new Date(),
  };
  await connectPosts().updateOne(
    { id: postId },
    { $push: { captionEntries: entry }, $set: { updatedAt: new Date() } },
  );
  const updated = await connectPosts().findOne({ id: postId });
  announceChange(post, 'updated', viewerUserId);
  return viewPost(updated ?? post, viewerUserId);
}

/**
 * Removes this person's own caption, and with it every vote it held.
 *
 * The points those votes paid are taken back at the same time: a balance that
 * survived the caption it was earned on would let someone farm votes and then
 * delete the evidence.
 */
export async function removeCaptionEntry(viewerUserId: string, postId: string) {
  const post = await requireVisiblePost(viewerUserId, postId);
  if (!isChallenge(post.type)) {
    throw new ConnectError(400, 'That post does not take entries');
  }
  const mine = (post.captionEntries ?? []).find((entry) => entry.userId === viewerUserId);
  if (!mine) throw new ConnectError(404, 'You have not captioned this yet');

  const votes = post.captionVotes ?? {};
  const votesLost = Object.values(votes).filter((entryId) => entryId === mine.id).length;
  const pointsPerVote = normalizePoints(post.body.pointsPerVote);
  // Every voter who backed this caption is released, so their one vote is
  // free to go elsewhere rather than being spent on something that is gone.
  const voterIds = Object.entries(votes)
    .filter(([, entryId]) => entryId === mine.id)
    .map(([voterId]) => voterId);

  await connectPosts().updateOne(
    { id: postId },
    {
      $pull: { captionEntries: { id: mine.id } },
      $unset: Object.fromEntries(voterIds.map((id) => [`captionVotes.${id}`, true])),
      $set: { updatedAt: new Date() },
    },
  );
  // A photo-story entry takes its picture with it rather than leaving it
  // orphaned in the bucket.
  if (mine.photoObjectKey) {
    await deleteConnectMediaByKeys([mine.photoObjectKey]);
  }
  if (votesLost > 0) {
    await users().updateOne(
      { userId: viewerUserId },
      { $inc: { points: -(votesLost * pointsPerVote) } },
    );
  }
  // A Most Likely entry paid its point to the person who was named, so
  // withdrawing the tag takes it back from them.
  if (mine.taggedUserId) {
    await users().updateOne(
      { userId: mine.taggedUserId },
      { $inc: { points: -pointsPerVote } },
    );
  }
  const updated = await connectPosts().findOne({ id: postId });
  announceChange(post, 'updated', viewerUserId);
  return viewPost(updated ?? post, viewerUserId);
}

/**
 * One vote each, changeable — voting again moves it rather than adding one.
 * Voting for your own caption is refused, and the points follow the vote so a
 * moved vote pays the new author and takes it back from the old one.
 */
export async function voteOnCaptionEntry(
  viewerUserId: string,
  postId: string,
  entryId: string,
) {
  const post = await requireVisiblePost(viewerUserId, postId);
  if (!isChallenge(post.type)) {
    throw new ConnectError(400, 'That post does not take entries');
  }
  const entry = (post.captionEntries ?? []).find((item) => item.id === entryId);
  if (!entry) throw new ConnectError(404, 'Caption not found');
  if (entry.userId === viewerUserId) {
    throw new ConnectError(400, 'You cannot vote for your own caption');
  }
  const pointsPerVote = normalizePoints(post.body.pointsPerVote);
  const previousEntryId = post.captionVotes?.[viewerUserId];
  const previous = previousEntryId
    ? (post.captionEntries ?? []).find((item) => item.id === previousEntryId)
    : undefined;

  if (previousEntryId === entryId) {
    // Tapping the caption you already backed takes the vote back.
    await connectPosts().updateOne(
      { id: postId },
      { $unset: { [`captionVotes.${viewerUserId}`]: true }, $set: { updatedAt: new Date() } },
    );
    await users().updateOne({ userId: entry.userId }, { $inc: { points: -pointsPerVote } });
  } else {
    await connectPosts().updateOne(
      { id: postId },
      { $set: { [`captionVotes.${viewerUserId}`]: entryId, updatedAt: new Date() } },
    );
    await users().updateOne({ userId: entry.userId }, { $inc: { points: pointsPerVote } });
    if (previous) {
      await users().updateOne({ userId: previous.userId }, { $inc: { points: -pointsPerVote } });
    }
  }
  const updated = await connectPosts().findOne({ id: postId });
  announceChange(post, 'updated', viewerUserId);
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
    const hadVoted = Boolean(post.pollVotes?.[viewerUserId]);
    await connectPosts().updateOne(
      { id: postId },
      { $set: { [`pollVotes.${viewerUserId}`]: optionId, updatedAt: now } },
    );
    // Changing a vote is not a new voter, so it announces nothing.
    if (!hadVoted) {
      const viewer = await users().findOne({ userId: viewerUserId });
      const fresh = await connectPosts().findOne({ id: postId });
      if (viewer) await notifyPollVoted(fresh ?? post, viewer);
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
  announceChange(post, 'updated', viewerUserId);
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
  let published = false;
  try {
    const normalizedBody = normalizePostBody(
      type,
      input.body ?? {},
      sparsePollImageKeys(uploadedPollImages, input.pollOptionImageIndexes),
    );
    const enrichedBody =
      type === 'recommendation' ? await withLinkPreview(normalizedBody) : normalizedBody;
    const visibility = await visibilityFromBody(type, enrichedBody, viewer);
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
        teamId: visibility.teamId,
      },
      body: withMedia(enrichedBody, uploadedMedia),
      likedBy: [],
      comments: [],
      actionBy: {},
      pollVotes: {},
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await connectPosts().insertOne(post);
    published = true;
    announceChange(post, 'created', viewerUserId);
    // One publication push per person in the audience. Awaited so a failure is
    // logged against the request that caused it rather than surfacing later,
    // and because notifyUsers already swallows its own delivery errors.
    await notifyPostPublished(post);
    return viewPost(post, viewerUserId);
  } catch (error) {
    // Only for a post that never made it into the collection. Once the row is
    // in, its media belongs to a live post: a transient failure while
    // announcing it must not leave the post standing with its images deleted.
    if (!published) {
      await deleteConnectMediaMany([...uploadedMedia, ...uploadedPollImages]);
    }
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
    const enrichedBody =
      type === 'recommendation'
        ? await withLinkPreview(normalizedBody, post.body.linkUrl as string | undefined)
        : normalizedBody;
    const visibility = await visibilityFromBody(type, enrichedBody, viewer);
    const existingMediaObjectKeys = mediaObjectKeys(post.body);
    const body = input.removeMedia
      ? withoutMedia(enrichedBody)
      : withMedia(
          enrichedBody,
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
          teamId: visibility.teamId,
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
    // Audience can change on edit, so announce against the saved post: a now
    // department-scoped post must not keep reaching the whole org.
    announceChange(updated ?? post, 'updated', viewer.userId);
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
  announceChange(post, 'deleted', viewerUserId);
  return { id: post.id };
}

/**
 * The post, if this viewer is allowed to see it at all. Exported so the
 * moderation service can apply exactly the same audience check before letting
 * someone report something.
 */
export async function requireVisiblePost(viewerUserId: string, postId: string) {
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectError(404, 'User not found');
  const post = await connectPosts().findOne({ id: postId, org: orgForUser(viewer) });
  if (!post) throw new ConnectError(404, 'Post not found');
  const { teamId, department } = post.audience;
  const visible = teamId
    ? visibleTeamIds(viewer).includes(teamId)
    : !department || department === viewer.department;
  if (!visible) {
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
  knownBlockedUserIds?: string[],
) {
  // The feed resolves this once for the whole page; every other caller renders
  // a single post after a write and looks it up here.
  const blockedUserIds = knownBlockedUserIds ?? (await blockedUserIdsFor(viewerUserId));
  let authorPhotoUrl = post.author.photoUrl;
  if (post.author.userId) {
    if (authorPhotoUrls) {
      if (authorPhotoUrls.has(post.author.userId)) {
        authorPhotoUrl = authorPhotoUrls.get(post.author.userId);
      }
    } else {
      const authorUser = await users().findOne(
        { userId: post.author.userId },
        { projection: { _id: 0, profilePhotoKey: 1, profilePhotoUrl: 1 } },
      );
      if (authorUser) authorPhotoUrl = await resolveProfilePhoto(authorUser);
    }
  }
  const liked = post.likedBy.includes(viewerUserId);
  const pollVotes = post.pollVotes ?? {};
  const selectedPollOptionId = pollVotes[viewerUserId] ?? null;
  const actionValue = post.actionBy?.[viewerUserId] ?? null;
  const body = { ...post.body };
  // Lifecycle posts (birthday/anniversary/new joinee) reference the subject's
  // photo by key so the post document stays small; resolve it per read.
  if (typeof body.photoKey === 'string' && body.photoKey.length > 0) {
    body.photoUrl = await presignConnectMedia(body.photoKey).catch(() => undefined);
  }
  // Tags store ids only, so a tagged person's name and photo are always
  // current rather than frozen at the moment the post was written.
  if (Array.isArray(body.taggedUserIds) && body.taggedUserIds.length > 0) {
    body.taggedPeople = await resolveTaggedPeople(body.taggedUserIds as string[]);
  }
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
  if (isChallenge(post.type)) {
    const votes = post.captionVotes ?? {};
    const tally = new Map<string, number>();
    for (const entryId of Object.values(votes)) {
      tally.set(entryId, (tally.get(entryId) ?? 0) + 1);
    }
    const pointsPerVote = normalizePoints(body.pointsPerVote);
    const entries = await Promise.all(
      (post.captionEntries ?? [])
        // A blocked colleague's entry goes the way of their posts and comments.
        .filter((entry) => !blockedUserIds.includes(entry.userId))
        .map(async (entry) => {
          const votesFor = tally.get(entry.id) ?? 0;
          return {
            id: entry.id,
            userId: entry.userId,
            name: entry.name,
            initials: entry.initials,
            text: entry.text,
            photoUrl: entry.photoObjectKey
              ? await presignConnectMedia(entry.photoObjectKey).catch(() => undefined)
              : undefined,
            createdAt: entry.createdAt,
            votes: votesFor,
            points: votesFor * pointsPerVote,
            votedByViewer: votes[viewerUserId] === entry.id,
            isMine: entry.userId === viewerUserId,
          };
        }),
    );
    body.entries = entries;
    body.entryCount = entries.length;
    if (post.type === 'most_likely') {
      // Here the board ranks the people who were named, not the people who
      // did the naming — one row per colleague, counting their tags.
      const tally = new Map<
        string,
        { userId: string; name: string; initials: string; designation: string; votes: number }
      >();
      for (const entry of post.captionEntries ?? []) {
        if (!entry.taggedUserId) continue;
        const row = tally.get(entry.taggedUserId) ?? {
          userId: entry.taggedUserId,
          name: entry.taggedName ?? 'Teammate',
          initials: entry.taggedInitials ?? '?',
          designation: entry.taggedDesignation ?? '',
          votes: 0,
        };
        row.votes += 1;
        tally.set(entry.taggedUserId, row);
      }
      body.leaderboard = [...tally.values()]
        .sort((a, b) => b.votes - a.votes)
        .map((row, index) => ({
          ...row,
          id: row.userId,
          text: row.designation,
          points: row.votes * pointsPerVote,
          rank: index + 1,
          isMine: row.userId === viewerUserId,
          votedByViewer: false,
        }));
      body.myTaggedUserId =
        (post.captionEntries ?? []).find((entry) => entry.userId === viewerUserId)
          ?.taggedUserId ?? null;
    }
    // The card shows entries in the order they were written; the leaderboard
    // ranks them. Ties keep submission order, so an earlier entry is never
    // demoted by a later one that drew level. Most Likely has already built
    // its own board above, ranking the people who were named.
    if (post.type !== 'most_likely') {
      body.leaderboard = [...entries]
        .sort((a, b) => b.votes - a.votes)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
    }
    body.myEntryId = entries.find((entry) => entry.isMine)?.id ?? null;
    body.myVoteEntryId = votes[viewerUserId] ?? null;
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
  // A blocked colleague's comments go too, and the replies underneath them —
  // a reply left on its own reads as an answer to nothing.
  const hiddenCommentIds = new Set(
    post.comments
      .filter((comment) => blockedUserIds.includes(comment.userId))
      .map((comment) => comment.id),
  );
  const comments = post.comments
    .filter(
      (comment) =>
        !hiddenCommentIds.has(comment.id) &&
        !(comment.parentId && hiddenCommentIds.has(comment.parentId)),
    )
    .map((comment) => ({
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
    commentCount: comments.length,
    selectedPollOptionId,
    actionValue,
  };
}

/**
 * `@Name` mentions inside a comment, resolved to the people already involved in
 * the post — its author, anyone tagged, and anyone who has commented.
 *
 * Deliberately not matched against the whole roster: a comment mentioning a
 * common first name should not notify a stranger, and the audience check in the
 * notifier would drop them anyway.
 */
function mentionedUserIdsIn(text: string, post: ConnectPost): string[] {
  const names = text.match(/@([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)/gu) ?? [];
  if (names.length === 0) return [];
  const needles = names.map((n) => n.slice(1).trim().toLowerCase());
  const candidates = new Map<string, string>();
  for (const comment of post.comments) candidates.set(comment.name.toLowerCase(), comment.userId);
  if (post.author.userId) candidates.set(post.author.name.toLowerCase(), post.author.userId);
  const matched = new Set<string>();
  for (const needle of needles) {
    for (const [name, userId] of candidates) {
      if (name === needle || name.split(' ')[0] === needle) matched.add(userId);
    }
  }
  return [...matched];
}

export function orgForUser(user: Pick<User, 'org' | 'email'>) {
  return user.org ?? user.email.split('@').at(1) ?? 'default';
}

function authorForUser(user: User) {
  return {
    userId: user.userId,
    name: user.name,
    initials: initialsFor(user.name),
    designation: user.designation ?? user.role ?? 'Teammate',
    avatarColor: avatarColorFor(user.userId),
    // Deliberately no photo snapshot: `viewPost` resolves the author's live
    // photo on every read, so embedding one here only bloated every post
    // document with a copy of the image.
    photoUrl: undefined as string | undefined,
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
    'caption_challenge',
    'photo_story_challenge',
    'most_likely',
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
        taggedUserIds: normalizeTaggedUserIds(input.taggedUserIds),
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
        // Filled in by `withLinkPreview` after normalization.
        linkImageUrl: normalizeText(input.linkImageUrl, '', 600),
      };
    case 'caption_challenge':
      // Entries and votes are never taken from the client: they are written by
      // their own endpoints, so editing the brief cannot quietly rewrite who
      // captioned what or how the voting stands.
      return {
        title: normalizeText(input.title, 'Caption this', 80),
        prompt: normalizeText(input.prompt, '', 300),
        pointsPerVote: normalizePoints(input.pointsPerVote),
        closesAt: normalizeText(input.closesAt, '', 60),
        captionLimit: 140,
      };
    case 'photo_story_challenge':
      // Entries and votes are written by their own endpoints, never taken from
      // the client, so editing the brief cannot rewrite who caught what.
      return {
        title: normalizeText(input.title, 'Caught red handed', 80),
        task: normalizeText(input.task, '', 200),
        prompt: normalizeText(input.prompt, '', 300),
        pointsPerVote: normalizePoints(input.pointsPerVote),
        closesAt: normalizeText(input.closesAt, '', 60),
        captionLimit: 200,
      };
    case 'most_likely':
      // The tags themselves are the votes, so nothing here is user-supplied
      // beyond the question being asked.
      return {
        title: normalizeText(input.title, 'Most Likely', 80),
        label: normalizeText(input.label, '', 40),
        question: normalizeText(input.question, '', 160),
        hint: normalizeText(input.hint, '', 120),
        prompt: normalizeText(input.prompt, '', 300),
        pointsPerVote: normalizePoints(input.pointsPerVote),
        closesAt: normalizeText(input.closesAt, '', 60),
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

/**
 * What one vote is worth. Bounded rather than free-form: the figure is printed
 * on the card and paid into a balance, so a typo of 10000 would quietly mint
 * points nobody can take back.
 */
function normalizePoints(value: unknown) {
  const points = Math.round(Number(value));
  if (!Number.isFinite(points) || points < 1) return 10;
  return Math.min(points, 100);
}

/** Ids of people tagged in a media post. Deduped and capped; names and photos
 * are resolved per read so a tag never shows a stale name. */
/** Names and photos for the people tagged in a post, in the order tagged. */
async function resolveTaggedPeople(userIds: string[]) {
  const tagged = await users()
    .find({ userId: { $in: userIds } })
    .project<{ userId: string; name: string; designation?: string; profilePhotoKey?: string; profilePhotoUrl?: string }>({
      _id: 0, userId: 1, name: 1, designation: 1, profilePhotoKey: 1, profilePhotoUrl: 1,
    })
    .toArray();
  const byId = new Map(tagged.map((person) => [person.userId, person]));
  const resolved = await Promise.all(
    // Preserve the author's ordering, and drop anyone since offboarded or deleted.
    userIds
      .map((id) => byId.get(id))
      .filter((person): person is NonNullable<typeof person> => Boolean(person))
      .map(async (person) => ({
        userId: person.userId,
        name: person.name,
        designation: person.designation ?? '',
        photoUrl: await resolveProfilePhoto(person),
      })),
  );
  return resolved;
}

function normalizeTaggedUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim().slice(0, 80));
  return [...new Set(ids)].slice(0, 20);
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

async function visibilityFromBody(
  type: ConnectPostType,
  body: Record<string, unknown>,
  viewer: User,
) {
  const canTargetTeam = type === 'hr_announcement' || type === 'survey' || type === 'new_post';
  const sendTo = canTargetTeam ? body.sendTo : undefined;
  const teamId = sendTo === 'my_team' ? await teamIdForAuthor(viewer) : undefined;
  return {
    label: teamId ? 'Team' : 'Public',
    teamId,
  };
}

/**
 * The reporting group a "Team" post from this author addresses, named by the
 * manager who heads it.
 *
 * A manager posts to the team they lead; anyone else posts to the team they
 * belong to — their manager's — which is exactly the set of people the Team
 * tab shows them. Leadership with neither a manager nor reports addresses
 * themselves, which the caller turns back into a company-wide post.
 */
async function teamIdForAuthor(author: User): Promise<string | undefined> {
  const leadsATeam = await users().countDocuments({ managerUserId: author.userId }, { limit: 1 });
  if (leadsATeam > 0) return author.userId;
  return author.managerUserId;
}

/**
 * Every reporting group the viewer is part of: the one they lead and the one
 * they belong to. A Team post is visible when it targets either.
 */
function visibleTeamIds(viewer: User): string[] {
  return [viewer.userId, viewer.managerUserId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
}

/**
 * Fills a recommendation's thumbnail and source details from the link itself,
 * so authors only paste a URL. Re-fetched only when the URL changes.
 */
async function withLinkPreview(
  body: Record<string, unknown>,
  previousUrl?: string,
): Promise<Record<string, unknown>> {
  const linkUrl = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : '';
  if (!linkUrl) return { ...body, linkImageUrl: '', linkTitle: '', linkDomain: '' };
  if (linkUrl === previousUrl && typeof body.linkImageUrl === 'string' && body.linkImageUrl) {
    return body;
  }
  const preview = await fetchLinkPreview(linkUrl);
  return {
    ...body,
    linkImageUrl: preview.imageUrl,
    linkTitle: (body.linkTitle as string) || preview.title,
    linkDomain: (body.linkDomain as string) || preview.siteName,
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
    caption_challenge: ['Caption Challenge', '💬', '#6D28D9', '#F3E8FF'],
    photo_story_challenge: ['Photo Challenge', '📸', '#6D28D9', '#F3E8FF'],
    most_likely: ['Most Likely', '🫵', '#6D28D9', '#F3E8FF'],
  } satisfies Record<ConnectPostType, [string, string, string, string]>;
  const [tag, tagIcon, tagColor, tagTint] = meta[type];
  return { tag, tagIcon, tagColor, tagTint };
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
  teamId?: string,
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
    audience: { label: teamId ? 'Team' : 'Public', org, teamId },
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
  const result = await connectPosts().updateOne(
    { systemKey: post.systemKey },
    { $setOnInsert: post },
    { upsert: true },
  );
  // These run daily and are deliberately repeatable, so only a genuinely new
  // insert is worth announcing — a no-op upsert would spam every client, and
  // re-push a birthday every morning until the date changed.
  if (result.upsertedCount > 0) {
    announceChange(post, 'created');
    await notifyPostPublished(post);
  }
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
  // Projected: this scans the whole directory daily, and full documents would
  // pull every profile photo along with it.
  const employees = await users()
    .find(
      { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } },
      {
        projection: {
          userId: 1, name: 1, email: 1, org: 1, birthday: 1, joiningDate: 1,
          designation: 1, department: 1, role: 1, location: 1, profilePhotoKey: 1,
        },
      },
    )
    .toArray();

  for (const employee of employees) {
    const org = orgForUser(employee);
    if (employee.birthday && employee.birthday.getUTCMonth() + 1 === month && employee.birthday.getUTCDate() === day) {
      await insertSystemPost(systemPost(org, 'birthday', `birthday:${employee.userId}:${dateKey}`, {
        // Whose day it is: the notifier needs it to spare them the push about
        // themselves and to greet them differently when someone comments.
        personUserId: employee.userId,
        personName: employee.name,
        personInitials: initialsFor(employee.name),
        photoKey: employee.profilePhotoKey,
        subtitle: `${employee.designation ?? employee.department ?? 'Teammate'} · turns a year wiser today`,
        actionLabel: 'Send wishes',
        actionDoneLabel: 'Wish sent!',
      }));
    }
    if (employee.joiningDate && employee.joiningDate.getUTCMonth() + 1 === month && employee.joiningDate.getUTCDate() === day) {
      const years = year - employee.joiningDate.getUTCFullYear();
      if (years > 0) {
        await insertSystemPost(systemPost(org, 'anniversary', `anniversary:${employee.userId}:${dateKey}`, {
          personUserId: employee.userId,
          personName: employee.name,
          personInitials: initialsFor(employee.name),
          photoKey: employee.profilePhotoKey,
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
    photoKey: employee.profilePhotoKey,
    subtitle: `Joining as ${employee.designation ?? 'Teammate'} · Team ${employee.department ?? 'Company'}`,
    facts: [employee.location ? `based in ${employee.location}` : '', employee.joiningDate ? `started ${employee.joiningDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : ''].filter(Boolean).join(' · '),
    managerName: manager?.name,
    managerInitials: manager ? initialsFor(manager.name) : undefined,
    managerDesignation: manager?.designation ?? (manager ? 'Manager' : undefined),
    managerNote: manager ? `Thrilled to have ${employee.name} join the team. Please say hi and help them feel at home!` : undefined,
    actionLabel: 'Say hi',
    actionDoneLabel: 'Said hi!',
    // Scoped to the team the joinee lands in — their manager's reporting group.
  }, employee.managerUserId));
}
