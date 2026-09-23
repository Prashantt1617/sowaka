import { randomUUID } from 'node:crypto';
import { connectPosts, relayEvents, relayItems, relayTeams, users } from '../config/db';
import { ConnectPost } from '../models/connect.model';
import { RelayEvent } from '../models/relay.model';
import { companyDisplayName } from './company-settings.service';
import { uploadConnectMedia } from './s3-connect-media.service';
import { RelayError } from './relay-import.service';
import { forgetRelayCache } from './relay-runtime.service';

/**
 * Publishes the game to Connect, which is the only way in.
 *
 * One call does the scheduling and the announcement together, because they
 * cannot disagree: the post's countdown and the moment the game starts itself
 * are the same timestamp, set here.
 */

export interface PublishInput {
  title?: string;
  subtitle?: string;
  startsAt?: string;
  /** What each correct answer pays. */
  pointsPerCorrect?: number | string;
}

function wholeNumber(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RelayError(400, `${label} must be a whole number from ${min} to ${max}`);
  }
  return parsed;
}

export interface VideoUpload {
  originalName: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

async function adminOrg(userId: string) {
  const admin = await users().findOne({ userId });
  if (!admin) throw new RelayError(404, 'Admin user not found');
  return admin.org ?? admin.email.split('@').at(1) ?? 'default';
}

/** What the sheet turned out to contain, which is what the post describes. */
async function shapeOf(event: RelayEvent) {
  const items = await relayItems().find({ eventId: event.id }).toArray();
  const rounds = new Map<number, Set<string>>();
  for (const item of items) {
    rounds.set(item.round, (rounds.get(item.round) ?? new Set()).add(item.kind));
  }
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, kinds]) => ({ round, category: [...kinds].join(', ') }));
}

export async function publishRelayGame(
  adminUserId: string,
  eventId: string,
  input: PublishInput,
  video?: VideoUpload,
) {
  const org = await adminOrg(adminUserId);
  const event = await relayEvents().findOne({ id: eventId, org });
  if (!event) throw new RelayError(404, 'Relay event not found');
  if (event.status === 'live') throw new RelayError(409, 'The game is already running');

  // Publishing is the last moment anything can be caught, since nobody is
  // watching on the day — so the same checks that guard starting run here.
  const teams = await relayTeams().countDocuments({ eventId });
  if (teams === 0) throw new RelayError(400, 'Import the team roster before publishing');
  const shape = await shapeOf(event);
  if (shape.length === 0) throw new RelayError(400, 'Import the questions before publishing');
  for (let round = 1; round <= event.config.rounds; round += 1) {
    const size = await relayItems().countDocuments({ eventId, round });
    if (size < event.config.questionsPerRound) {
      throw new RelayError(400, `Round ${round} has too few items to play`);
    }
  }

  const startsAt = new Date(String(input.startsAt ?? ''));
  if (Number.isNaN(startsAt.getTime())) throw new RelayError(400, 'A start time is required');
  if (startsAt.getTime() < Date.now()) throw new RelayError(400, 'The start time has already passed');

  // HR's decision and required: a default here would put a number on the
  // rules screen that nobody chose.
  const pointsPerCorrect = wholeNumber(input.pointsPerCorrect, 'Points per correct answer', 1, 1000);

  const title = (input.title ?? '').trim() || 'Team Relay';
  const subtitle = (input.subtitle ?? '').trim();

  // Stored as an object key under the name the feed already presigns on read,
  // so the video is served the same way every other post's media is.
  let instructionsVideoKey = event.instructionsVideoUrl ?? '';
  if (video) {
    if (!video.contentType.startsWith('video/')) {
      throw new RelayError(400, 'The instructions file must be a video');
    }
    const stored = await uploadConnectMedia(adminUserId, video);
    instructionsVideoKey = stored.objectKey;
  }

  const now = new Date();
  await relayEvents().updateOne(
    { id: eventId, org },
    {
      $set: {
        name: title,
        status: 'scheduled',
        startsAt,
        lobbyOpensAt: now,
        instructionsVideoUrl: instructionsVideoKey,
        'config.pointsPerCorrect': pointsPerCorrect,
        updatedAt: now,
      },
    },
  );
  forgetRelayCache(eventId);

  const post: ConnectPost = {
    id: randomUUID(),
    org,
    type: 'relay_game',
    tag: 'Live Game',
    tagIcon: '🎮',
    tagColor: '#0571A6',
    tagTint: '#E7F2F7',
    author: {
      userId: adminUserId,
      name: await companyDisplayName(org, 'Your company'),
      initials: 'G',
      designation: 'Auto · Games',
      avatarColor: '#0571A6',
    },
    audience: { label: 'Company', org },
    body: {
      eventId,
      title,
      subtitle,
      // Descriptive, and taken from the sheet — a number typed here could
      // disagree with the rounds that were actually imported.
      roundCount: shape.length,
      rounds: shape,
      startsAt: startsAt.toISOString(),
      mediaObjectKey: instructionsVideoKey,
      mediaContentType: video?.contentType ?? '',
      actionLabel: 'View game',
      teamCount: teams,
      pointsPerCorrect,
    },
    likedBy: [],
    comments: [],
    actionBy: {},
    pollVotes: {},
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await connectPosts().insertOne(post);

  return {
    postId: post.id,
    startsAt: startsAt.toISOString(),
    rounds: shape,
    teams,
    instructionsVideoKey,
    pointsPerCorrect,
  };
}
