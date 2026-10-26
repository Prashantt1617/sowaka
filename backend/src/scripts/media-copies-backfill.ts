/**
 * Makes the smaller copies (see services/image-fit.ts) of pictures uploaded
 * before uploads made their own: every profile photo, and every picture on a
 * Connect post (post media, poll option images, photo-story entries).
 *
 * Until it runs, `/media` serves those originals (about 1.9 MB each) where a
 * copy is asked for. Originals are never changed or deleted; each copy is
 * written beside its original, and one already there is skipped, so a run can
 * be stopped and started again.
 *
 * Reads the database and never writes to it, except for pictures held in the
 * Mongo fallback (`mongo/` keys), whose copies are stored there too. It reads
 * every original in full, so on the API server it competes with the feed:
 * run it at a quiet hour, or from elsewhere with the same bucket access.
 *
 *   node --env-file=.env --import tsx src/scripts/media-copies-backfill.ts                 # dry run: counts only
 *   node --env-file=.env --import tsx src/scripts/media-copies-backfill.ts --apply         # make the copies
 *   node --env-file=.env --import tsx src/scripts/media-copies-backfill.ts --apply --org=sowaka --limit=50
 */
import { connectDb, connectMedia, connectPosts, users } from '../config/db';
import { copyKey, imageCopies, mayHaveCopies, type MediaCopies } from '../services/image-fit';
import {
  hasConnectObject,
  putConnectObject,
  readConnectMedia,
} from '../services/s3-connect-media.service';

type Job = { key: string; copies: MediaCopies };

function option(name: string) {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

async function jobs(org: string | undefined): Promise<Job[]> {
  const found = new Map<string, MediaCopies>();
  const people = await users()
    .find({ ...(org ? { org } : {}), profilePhotoKey: { $exists: true, $ne: '' } })
    .project<{ profilePhotoKey?: string }>({ _id: 0, profilePhotoKey: 1 })
    .toArray();
  for (const person of people) {
    if (person.profilePhotoKey) found.set(person.profilePhotoKey, 'avatar');
  }
  const posts = connectPosts()
    .find({ ...(org ? { org } : {}) })
    .project<{ body?: Record<string, unknown>; captionEntries?: { photoObjectKey?: string }[] }>({
      _id: 0,
      'body.mediaObjectKey': 1,
      'body.mediaObjectKeys': 1,
      'body.options': 1,
      'captionEntries.photoObjectKey': 1,
    });
  for await (const post of posts) {
    const body = post.body ?? {};
    const keys = [
      ...(Array.isArray(body.mediaObjectKeys) ? body.mediaObjectKeys : [body.mediaObjectKey]),
      ...(Array.isArray(body.options) ? body.options.map((o) => (o as { imageObjectKey?: unknown })?.imageObjectKey) : []),
      ...(post.captionEntries ?? []).map((entry) => entry.photoObjectKey),
    ];
    for (const key of keys) {
      // A key that is also someone's photo keeps its avatar copy too.
      if (typeof key === 'string' && key && !found.has(key)) found.set(key, 'post');
    }
  }
  return [...found].filter(([key]) => mayHaveCopies(key)).map(([key, copies]) => ({ key, copies }));
}

async function readOriginal(key: string) {
  if (key.startsWith('mongo/')) {
    const media = await connectMedia().findOne({ objectKey: key });
    if (!media) return undefined;
    const bytes = media.bytes as unknown as { buffer: ArrayBuffer } | Buffer;
    return {
      contentType: media.contentType,
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from((bytes as { buffer: ArrayBuffer }).buffer),
    };
  }
  const object = await readConnectMedia(key).catch(() => undefined);
  if (!object?.body) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return { contentType: object.contentType, bytes: Buffer.concat(chunks) };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const org = option('org');
  const limit = Number(option('limit') ?? Infinity);
  await connectDb();
  const all = await jobs(org);
  console.log(`${all.length} pictures${org ? ` in ${org}` : ''}${apply ? '' : ' (dry run: add --apply to make copies)'}`);
  if (!apply) return;

  let made = 0;
  let skipped = 0;
  let failed = 0;
  let originalBytes = 0;
  let copyBytes = 0;
  // One at a time, so the server keeps answering the feed while this runs.
  for (const job of all.slice(0, limit)) {
    try {
      // The smallest copy is made for every picture big enough to have one;
      // if it is there, an earlier run (or the upload) made them all.
      if (await hasConnectObject(copyKey(job.key, 256))) {
        skipped += 1;
        continue;
      }
      const original = await readOriginal(job.key);
      if (!original || !original.contentType.startsWith('image/')) {
        skipped += 1;
        continue;
      }
      const copies = await imageCopies(
        { originalName: job.key, contentType: original.contentType, size: original.bytes.length, bytes: original.bytes },
        job.copies,
      );
      for (const copy of copies) {
        const key = copyKey(job.key, copy.width);
        if (job.key.startsWith('mongo/')) {
          await connectMedia().updateOne(
            { objectKey: key },
            { $setOnInsert: { objectKey: key, contentType: copy.contentType, size: copy.size, bytes: copy.bytes, createdAt: new Date() } },
            { upsert: true },
          );
        } else {
          await putConnectObject(key, copy);
        }
      }
      if (copies.length === 0) skipped += 1;
      else made += 1;
      originalBytes += original.bytes.length;
      copyBytes += copies[copies.length - 1]?.size ?? original.bytes.length;
      if ((made + skipped) % 50 === 0) console.log(`… ${made} made, ${skipped} skipped, ${failed} failed`);
    } catch (error) {
      failed += 1;
      console.error(`failed ${job.key}:`, error instanceof Error ? error.message : error);
    }
  }
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  console.log(`${made} made, ${skipped} skipped, ${failed} failed; those originals ${mb(originalBytes)}, their largest copies ${mb(copyBytes)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
