/**
 * Grouped Connect pushes (spec rows 40–44): at most one push per post every
 * three hours for each kind, naming the latest person and how many others.
 *
 * The first event on a quiet post pushes at once. Events inside the next
 * three hours are gathered; when the window closes, the scheduler's tick sends
 * one push for all of them ("Asha and 4 others liked your post"). An event
 * after the window has closed pushes at once again, carrying anything still
 * gathered.
 */
import { getDb } from '../config/db';
import { notifyUsers } from './notification.service';
import { logger } from '../utils/logger';

export const GROUP_WINDOW_MS = 3 * 60 * 60 * 1000;

export type GroupKind =
  | 'post_commented'
  | 'card_wished_birthday'
  | 'card_wished_anniversary'
  | 'post_liked'
  | 'post_also_commented'
  | 'poll_voted';

interface GroupDoc {
  key: string;
  recipientUserId: string;
  kind: GroupKind;
  entityId: string;
  data: Record<string, string>;
  /** People gathered since the last push, oldest first, each once. */
  actors: string[];
  lastPushAt?: Date;
  updatedAt: Date;
}

const groups = () => getDb().collection<GroupDoc>('notification_groups');

/** " and 1 other" / " and 3 others". */
const others = (count: number) => (count <= 0 ? '' : ` and ${count} ${count === 1 ? 'other' : 'others'}`);

export function groupedCopy(kind: GroupKind, actors: string[]): { title: string; body: string } {
  const latest = actors[actors.length - 1] ?? 'Someone';
  const rest = others(actors.length - 1);
  switch (kind) {
    case 'post_commented': return { title: `${latest}${rest} commented on your post`, body: 'See what they said' };
    case 'card_wished_birthday': return { title: `${latest}${rest} wished you 🎂`, body: 'See the wishes' };
    case 'card_wished_anniversary': return { title: `${latest}${rest} wished you 🎉`, body: 'See the wishes' };
    case 'post_liked': return { title: `${latest}${rest} liked your post`, body: 'See the post' };
    case 'post_also_commented': return { title: `${latest}${rest} also commented`, body: 'On a post you commented on' };
    case 'poll_voted': {
      const count = actors.length;
      return { title: `${count} ${count === 1 ? 'person' : 'people'} voted on your poll`, body: "See how it's shaping up" };
    }
  }
}

async function push(doc: GroupDoc, actors: string[], now: Date): Promise<void> {
  const copy = groupedCopy(doc.kind, actors);
  await groups().updateOne({ key: doc.key }, { $set: { actors: [], lastPushAt: now, updatedAt: now } });
  await notifyUsers([doc.recipientUserId], { scenario: doc.kind, ...copy, data: doc.data });
}

/** One event: pushed now when the post has been quiet for three hours, else gathered. */
export async function notifyGrouped(input: {
  recipientUserId: string;
  kind: GroupKind;
  entityId: string;
  actorName: string;
  data: Record<string, string>;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const key = `${input.recipientUserId}:${input.kind}:${input.entityId}`;
  const name = input.actorName.trim() || 'Someone';
  // Each person once, and the newest at the end: pulled, then pushed again.
  await groups().updateOne(
    { key },
    {
      $setOnInsert: { key, recipientUserId: input.recipientUserId, kind: input.kind, entityId: input.entityId },
      $set: { data: input.data, updatedAt: now },
      $pull: { actors: name },
    },
    { upsert: true },
  );
  const doc = await groups().findOneAndUpdate({ key }, { $push: { actors: name } }, { returnDocument: 'after' });
  if (!doc) return;
  if (!doc.lastPushAt || now.getTime() - doc.lastPushAt.getTime() >= GROUP_WINDOW_MS) {
    await push(doc, doc.actors, now);
  }
}

/** The scheduler's tick: any group whose window has closed with people gathered gets its push. */
export async function flushGroupedNotifications(now = new Date()): Promise<number> {
  const due = await groups()
    .find({ 'actors.0': { $exists: true }, lastPushAt: { $lte: new Date(now.getTime() - GROUP_WINDOW_MS) } })
    .toArray();
  let sent = 0;
  for (const doc of due) {
    try {
      await push(doc, doc.actors, now);
      sent += 1;
    } catch (error) {
      logger.error('Grouped notification failed', { key: doc.key }, error);
    }
  }
  return sent;
}

/** A deleted post takes its gathered pushes with it. */
export async function forgetGroupsFor(entityId: string): Promise<void> {
  await groups().deleteMany({ entityId });
}
