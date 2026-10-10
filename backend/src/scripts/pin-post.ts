/**
 * Pins a Connect post to the top of its company's feed, or unpins it.
 *
 * Pinning is done from here only — nothing in the app or the dashboard can
 * pin. A pinned post leads the first page of the feed until `pinnedUntil`,
 * then drops back to its own place by publish time. Nothing else on the post
 * changes: its entries, votes, comments and publish time stay as they are.
 * A company has at most FEED_MAX_PINNED pins at once; one more is refused.
 *
 *   node --env-file=.env --import tsx src/scripts/pin-post.ts <postId>            # until a challenge closes, else 24 h
 *   node --env-file=.env --import tsx src/scripts/pin-post.ts <postId> 2026-10-12T18:00:00+05:30
 *   node --env-file=.env --import tsx src/scripts/pin-post.ts <postId> off
 *   node --env-file=.env --import tsx src/scripts/pin-post.ts list <org>
 */
import { connectDb, connectPosts } from '../config/db';
import { FEED_MAX_PINNED } from '../services/connect.service';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const [first, second] = process.argv.slice(2);
  if (!first) {
    console.log('Usage: pin-post.ts <postId> [until ISO | off]  |  pin-post.ts list <org>');
    return;
  }
  await connectDb();

  if (first === 'list') {
    const pinned = await connectPosts()
      .find({ ...(second ? { org: second } : {}), pinnedUntil: { $gt: new Date() } })
      .project<{ id: string; org: string; type: string; body: Record<string, unknown>; pinnedUntil: Date }>({
        _id: 0, id: 1, org: 1, type: 1, 'body.title': 1, 'body.text': 1, pinnedUntil: 1,
      })
      .toArray();
    if (pinned.length === 0) console.log('Nothing pinned.');
    for (const post of pinned) {
      const title = String(post.body?.title ?? post.body?.text ?? '').slice(0, 60);
      console.log(`${post.org}  ${post.id}  ${post.type}  "${title}"  until ${post.pinnedUntil.toISOString()}`);
    }
    return;
  }

  const post = await connectPosts().findOne({ id: first });
  if (!post) throw new Error(`No post ${first}`);
  const title = String(post.body?.title ?? post.body?.text ?? '').slice(0, 60);

  if (second === 'off') {
    await connectPosts().updateOne({ id: post.id }, { $set: { pinnedUntil: null } });
    console.log(`Unpinned ${post.org} "${title}".`);
    return;
  }

  // A challenge stays pinned until it closes; anything else for a day,
  // unless a time is given.
  const closesAt = new Date(String(post.body?.closesAt ?? ''));
  const until = second
    ? new Date(second)
    : !Number.isNaN(closesAt.getTime()) && closesAt.getTime() > Date.now()
      ? closesAt
      : new Date(Date.now() + DAY_MS);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    throw new Error(`"${second}" is not a time in the future`);
  }
  // The feed leads with at most FEED_MAX_PINNED pins; one more would sit in
  // the list unpinned while looking pinned here. Re-pinning a post that is
  // already one of them only moves its time, so that is always allowed.
  const now = new Date();
  if (!(post.pinnedUntil && post.pinnedUntil > now)) {
    const live = await connectPosts()
      .find({ org: post.org, pinnedUntil: { $gt: now } })
      .project<{ id: string; body: Record<string, unknown>; pinnedUntil: Date }>({
        _id: 0, id: 1, 'body.title': 1, 'body.text': 1, pinnedUntil: 1,
      })
      .toArray();
    if (live.length >= FEED_MAX_PINNED) {
      const list = live
        .map((pin) => `  ${pin.id}  "${String(pin.body?.title ?? pin.body?.text ?? '').slice(0, 60)}"  until ${pin.pinnedUntil.toISOString()}`)
        .join('\n');
      throw new Error(
        `${post.org} already has ${live.length} pinned posts, the most the feed shows (${FEED_MAX_PINNED}):\n${list}\n` +
          'Unpin one first with: pin-post.ts <postId> off',
      );
    }
  }
  await connectPosts().updateOne({ id: post.id }, { $set: { pinnedUntil: until } });
  console.log(`Pinned ${post.org} "${title}" until ${until.toISOString()}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
