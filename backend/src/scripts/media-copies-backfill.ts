/**
 * Makes the smaller copies (see services/image-fit.ts) of pictures uploaded
 * before uploads made their own: every profile photo, and every picture on a
 * Connect post (post media, poll option images, photo-story entries).
 *
 * Until it runs, `/media` serves those originals (about 1.9 MB each) where a
 * copy is asked for. It only ever adds copies beside an original, under
 * `<key>@w<width>`: no original is changed or deleted, and nothing in the
 * database is written (except copies of pictures held in the Mongo fallback,
 * `mongo/` keys, which live there).
 *
 * Safe to stop and run again. Each picture finished is written to the
 * progress file and is not looked at again; a picture whose smallest copy is
 * already in the bucket is skipped too (the upload or an earlier run made
 * it). A failure is logged with its key and the run carries on; failures are
 * not written to the progress file, so the next run tries them again.
 *
 * Gentle on the server it shares: pictures go a few at a time
 * (--concurrency), in batches (--batch) with a pause after each (--pause-ms).
 *
 * Run from backend/ with the server's own .env (MONGODB_URI, MONGODB_DB,
 * AWS_REGION, AWS_S3_BUCKET, AWS_S3_CONNECT_MEDIA_PREFIX, the encryption
 * settings, and S3 access from the instance role or the access keys):
 *
 *   node dist/scripts/media-copies-backfill.js                     # dry run: counts and the bytes it would save
 *   node dist/scripts/media-copies-backfill.js --apply             # make the copies
 *
 *   --org=<org>          only this company's people and posts
 *   --limit=<n>          stop after n pictures (this run)
 *   --concurrency=<n>    pictures at once (default 2)
 *   --batch=<n>          pictures per batch (default 20)
 *   --pause-ms=<n>       rest after each batch (default 1000)
 *   --sample=<n>         dry run: pictures actually resized in memory to
 *                        measure the saving (default 20; nothing is written)
 *   --progress=<file>    where finished keys are kept (default
 *                        ./media-copies-backfill.progress)
 *
 * In a checkout without a build: `node --import tsx src/scripts/media-copies-backfill.ts ...`.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { connectDb, connectMedia, connectPosts, users } from '../config/db';
import { env } from '../config/env';
import { copyKey, imageCopies, mayHaveCopies, type MediaCopies } from '../services/image-fit';
import {
  putConnectObject,
  readConnectMedia,
  statConnectObject,
} from '../services/s3-connect-media.service';

export type Job = { key: string; copies: MediaCopies };

function option(name: string, fallback: string) {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

function count(name: string, fallback: number) {
  const value = Number(option(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The copy a phone is usually sent, by kind: what the saving is measured
 * against. Avatar URLs ask for 256; a feed card for about 1080.
 */
const SERVED_WIDTH: Record<MediaCopies, number> = { avatar: 256, post: 1080 };

/** Every picture key there is, each once, in a fixed order (so a run resumes where the last stopped). */
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
      // A key that is also someone's photo keeps its avatar copy.
      if (typeof key === 'string' && key && !found.has(key)) found.set(key, 'post');
    }
  }
  return [...found]
    .filter(([key]) => mayHaveCopies(key))
    .map(([key, copies]) => ({ key, copies }))
    .sort((a, b) => a.key.localeCompare(b.key));
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

/** Runs [work] over [items], at most [concurrency] at a time. */
async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item);
      }
    }),
  );
}

type Outcome = 'made' | 'had copies' | 'nothing to make' | 'missing' | 'not a picture';

export type BackfillOptions = {
  apply: boolean;
  org?: string;
  limit: number;
  concurrency: number;
  batch: number;
  pauseMs: number;
  sample: number;
  progressFile: string;
};

async function main() {
  const options: BackfillOptions = {
    apply: process.argv.includes('--apply'),
    org: option('org', '') || undefined,
    limit: count('limit', Number.MAX_SAFE_INTEGER),
    concurrency: count('concurrency', 2),
    batch: count('batch', 20),
    pauseMs: Number(option('pause-ms', '1000')),
    sample: count('sample', 20),
    progressFile: option('progress', './media-copies-backfill.progress'),
  };
  await connectDb();
  await backfill(await jobs(options.org), options);
}

/** The run itself, over pictures already listed; apart from [main] so it can be tried on a fake bucket. */
export async function backfill(all: Job[], options: BackfillOptions) {
  const { apply, org, limit, concurrency, batch, pauseMs, sample, progressFile } = options;
  if (!env.s3.bucket && all.some((job) => !job.key.startsWith('mongo/'))) {
    throw new Error('AWS_S3_BUCKET is not set: run this with the server\'s own .env');
  }
  // Each line is "<outcome>\t<key>" for a picture this script is done with.
  const finished = new Set(
    existsSync(progressFile)
      ? readFileSync(progressFile, 'utf8')
          .split('\n')
          .map((line) => line.split('\t')[1])
          .filter(Boolean)
      : [],
  );
  const todo = all.filter((job) => !finished.has(job.key)).slice(0, limit);
  console.log(
    `${all.length} pictures${org ? ` in ${org}` : ''}; ${finished.size} finished by earlier runs (${progressFile}); ` +
      `${todo.length} to look at this run, ${concurrency} at a time in batches of ${batch}` +
      (apply ? '' : '. DRY RUN: nothing is written; add --apply to make the copies'),
  );

  const tally: Record<Outcome | 'failed', number> = {
    made: 0,
    'had copies': 0,
    'nothing to make': 0,
    missing: 0,
    'not a picture': 0,
    failed: 0,
  };
  // Dry run: the originals still to do, by kind, and what the sample says a
  // copy weighs against its original.
  const pending: Record<MediaCopies, { count: number; bytes: number }> = {
    avatar: { count: 0, bytes: 0 },
    post: { count: 0, bytes: 0 },
  };
  const measured: Record<MediaCopies, { original: number; copy: number }> = {
    avatar: { original: 0, copy: 0 },
    post: { original: 0, copy: 0 },
  };
  let sampled = 0;
  let looked = 0;

  async function one(job: Job): Promise<Outcome> {
    // Asked of the bucket every time, not only the progress file: an upload
    // since copies began made its own.
    if (await statConnectObject(copyKey(job.key, 256))) return 'had copies';
    if (!apply) {
      const original = await statConnectObject(job.key);
      if (!original) return 'missing';
      if (!original.contentType.startsWith('image/')) return 'not a picture';
      pending[job.copies].count += 1;
      pending[job.copies].bytes += original.size;
      if (sampled < sample) {
        sampled += 1;
        const read = await readOriginal(job.key);
        if (read) {
          const copies = await imageCopies(
            { originalName: job.key, contentType: read.contentType, size: read.bytes.length, bytes: read.bytes },
            job.copies,
          );
          const served =
            copies.find((copy) => copy.width >= SERVED_WIDTH[job.copies]) ?? copies[copies.length - 1];
          measured[job.copies].original += read.bytes.length;
          measured[job.copies].copy += served?.size ?? read.bytes.length;
        }
      }
      return 'made';
    }
    const original = await readOriginal(job.key);
    if (!original) return 'missing';
    if (!original.contentType.startsWith('image/')) return 'not a picture';
    const copies = await imageCopies(
      { originalName: job.key, contentType: original.contentType, size: original.bytes.length, bytes: original.bytes },
      job.copies,
    );
    if (copies.length === 0) return 'nothing to make';
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
    return 'made';
  }

  for (let start = 0; start < todo.length; start += batch) {
    await pool(todo.slice(start, start + batch), concurrency, async (job) => {
      try {
        const outcome = await one(job);
        tally[outcome] += 1;
        // Only a real run finishes a picture; a dry run leaves no trace.
        if (apply && outcome !== 'missing') appendFileSync(progressFile, `${outcome}\t${job.key}\n`);
      } catch (error) {
        tally.failed += 1;
        console.error(`FAILED ${job.key}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        looked += 1;
      }
    });
    console.log(
      `[${looked}/${todo.length}] ${apply ? 'made' : 'would make'} ${tally.made}, had copies ${tally['had copies']}, ` +
        `nothing to make ${tally['nothing to make']}, missing ${tally.missing}, not a picture ${tally['not a picture']}, failed ${tally.failed}`,
    );
    if (start + batch < todo.length && pauseMs > 0) await sleep(pauseMs);
  }

  if (!apply) {
    let estimate = 0;
    for (const kind of ['avatar', 'post'] as const) {
      const { original, copy } = measured[kind];
      const ratio = original > 0 ? copy / original : undefined;
      const saved = ratio == null ? undefined : pending[kind].bytes * (1 - ratio);
      if (saved) estimate += saved;
      console.log(
        `${kind}: ${pending[kind].count} to copy, originals ${mb(pending[kind].bytes)}; ` +
          (ratio == null
            ? 'none sampled'
            : `the ${SERVED_WIDTH[kind]} px copy is ${(ratio * 100).toFixed(0)}% of the original in the sample, ` +
              `so about ${mb(saved ?? 0)} less for one view of each`),
      );
    }
    console.log(`estimated saving: about ${mb(estimate)} less for one view of every picture still to do (sampled ${sampled})`);
  }
  console.log(`done: ${JSON.stringify(tally)}`);
  return tally;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
