import { connectBlocks, users } from '../config/db';
import { resolveProfilePhoto } from './s3-connect-media.service';

/**
 * Blocking in Connect, kept deliberately small.
 *
 * This is a personal mute, not a ban: it hides one colleague's posts and
 * comments from one person's feed. Nobody is told they have been blocked,
 * nothing about either person's work changes, and HR is not involved. Removing
 * someone from the organisation is an HR action taken in the dashboard, and
 * this is not that.
 *
 * A leaf module on purpose — it touches only its own collection, so the feed
 * can read blocks without importing the moderation service that reports go
 * through.
 */

export class ConnectBlockError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Who this viewer has chosen not to see. Empty for almost everyone. */
export async function blockedUserIdsFor(userId: string): Promise<string[]> {
  const blocks = await connectBlocks()
    .find({ userId }, { projection: { _id: 0, blockedUserId: 1 } })
    .toArray();
  return blocks.map((block) => block.blockedUserId);
}

export async function blockConnectPerson(viewerUserId: string, targetUserId: string) {
  if (!targetUserId) throw new ConnectBlockError(400, 'Who to block was not given');
  if (targetUserId === viewerUserId) throw new ConnectBlockError(400, 'You cannot block yourself');
  const viewer = await users().findOne({ userId: viewerUserId });
  if (!viewer) throw new ConnectBlockError(404, 'User not found');
  const target = await users().findOne({ userId: targetUserId });
  // Same organisation only — the feed never shows anyone else, so a block
  // outside it could only come from a tampered request.
  if (!target || orgOf(target) !== orgOf(viewer)) {
    throw new ConnectBlockError(404, 'That person is not in your organisation');
  }
  await connectBlocks().updateOne(
    { userId: viewerUserId, blockedUserId: targetUserId },
    { $setOnInsert: { org: orgOf(viewer), createdAt: new Date() } },
    { upsert: true },
  );
  return listConnectBlocks(viewerUserId);
}

export async function unblockConnectPerson(viewerUserId: string, targetUserId: string) {
  await connectBlocks().deleteOne({ userId: viewerUserId, blockedUserId: targetUserId });
  return listConnectBlocks(viewerUserId);
}

/** The blocked list as the app shows it, newest first. */
export async function listConnectBlocks(viewerUserId: string) {
  const blocks = await connectBlocks()
    .find({ userId: viewerUserId })
    .sort({ createdAt: -1 })
    .toArray();
  if (blocks.length === 0) return [];
  const blocked = await users()
    .find({ userId: { $in: blocks.map((block) => block.blockedUserId) } })
    .toArray();
  const byId = new Map(blocked.map((user) => [user.userId, user]));
  return Promise.all(
    blocks.map(async (block) => {
      const user = byId.get(block.blockedUserId);
      return {
        userId: block.blockedUserId,
        // A blocked colleague who has since left the organisation keeps their
        // row so it can still be undone, rather than vanishing unexplained.
        name: user?.name ?? 'Former colleague',
        designation: user?.designation ?? '',
        photoUrl: user ? await resolveProfilePhoto(user) : undefined,
        blockedAt: block.createdAt,
      };
    }),
  );
}

function orgOf(user: { org?: string; email: string }) {
  return user.org ?? user.email.split('@').at(1) ?? 'default';
}
