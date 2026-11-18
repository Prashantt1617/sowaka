/**
 * Missing picture copies, made the first time someone asks for one and kept in S3 beside the
 * original (`<key>@w<width>`, where uploads put theirs), so every later ask is served the stored copy
 * without resizing anything again.
 *
 * A picture uploaded before copies existed (the backfill never ran on production) had none, so each
 * `/media/<key>?w=256` thumbnail streamed the whole original (often megabytes) through the server, about
 * 2 s each, hundreds at a time when someone scrolled the feed. Now the copy at that width is made from
 * the original once, stored, and sent.
 *
 * Kept small for a small server: one picture is resized at a time (sharp runs one at a time here
 * anyway), the same copy is made once however many ask for it at once, a request waits for its copy
 * only while the queue is short (otherwise it is sent the original as before and the copy is made
 * behind it), and the queue has a ceiling. A copy that comes out no smaller than the original is the
 * original itself, stored under the copy's key, so it is not tried again either.
 */
import { copyKey, copyOrder, fitImage } from './image-fit';
import { forgetMissingCopy } from './media-lookup';
import { putConnectObject, readConnectMedia } from './s3-connect-media.service';
import { logger } from '../utils/logger';

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** A request waits for its copy only with fewer than this many ahead of it. */
const WAIT_WHEN_AHEAD_BELOW = 3;
/** Copies waiting to be made, at most (a burst past it is served originals and asked again later). */
const MAX_QUEUED = 300;
/** An original larger than this is not decoded here (a phone photo decodes to tens of megabytes). */
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;

export type MadeCopy = { bytes: Buffer; contentType: string };

type Job = { objectKey: string; width: number; key: string; done: Promise<MadeCopy | null>; resolve: (copy: MadeCopy | null) => void };
const queue: Job[] = [];
/** Originals that could not be made a copy of (not a picture, too large, S3 refused): not tried again for an hour. */
const FAILED_FOR_MS = 60 * 60_000;
const failed = new Map<string, number>();
const byKey = new Map<string, Job>();
let running = false;

/** The width a missing copy is made at for this ask: the first copy `/media` looks for. */
export function copyWidthFor(asked: number): number {
  return copyOrder(asked)[0];
}

/** Where originals are read and copies kept: S3 (a check puts its own in). */
type Store = { read: typeof readConnectMedia; put: typeof putConnectObject };
let store: Store = { read: readConnectMedia, put: putConnectObject };
export function setMediaStoreForCheck(next: Store | null): void {
  store = next ?? { read: readConnectMedia, put: putConnectObject };
}

async function readWhole(objectKey: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const object = await store.read(objectKey);
  if (!object.body || !RESIZABLE.has(object.contentType)) {
    (object.body as { destroy?: () => void } | undefined)?.destroy?.();
    return null;
  }
  if (object.contentLength != null && object.contentLength > MAX_ORIGINAL_BYTES) {
    (object.body as { destroy?: () => void }).destroy?.();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of object.body as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_ORIGINAL_BYTES) {
      (object.body as { destroy?: () => void }).destroy?.();
      return null;
    }
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), contentType: object.contentType };
}

/** Makes one copy and stores it; null when the original is not a picture that can be resized here. */
async function make(objectKey: string, width: number, key: string): Promise<MadeCopy | null> {
  const original = await readWhole(objectKey);
  if (!original) return null;
  const file = { originalName: objectKey.split('/').pop() ?? 'image', contentType: original.contentType, size: original.bytes.length, bytes: original.bytes };
  // No smaller at this width, or not decodable: the original itself is stored as the copy, so it is not tried again.
  const fitted = await fitImage(file, width);
  await store.put(key, { bytes: fitted.bytes, contentType: fitted.contentType, size: fitted.bytes.length });
  forgetMissingCopy(key);
  return { bytes: fitted.bytes, contentType: fitted.contentType };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue[0];
      let made: MadeCopy | null = null;
      try {
        made = await make(job.objectKey, job.width, job.key);
      } catch (error) {
        logger.warn('Media copy not made; the original is served instead', { objectKey: job.objectKey, width: job.width, error: error instanceof Error ? error.message : String(error) });
      }
      queue.shift();
      byKey.delete(job.key);
      if (!made) {
        if (failed.size >= 20_000) failed.clear();
        failed.set(job.key, Date.now() + FAILED_FOR_MS);
      }
      job.resolve(made);
    }
  } finally {
    running = false;
  }
}

/**
 * The copy of `objectKey` at `width`, made now: awaited when the queue is short (the caller sends it),
 * else queued behind the reader and null (the caller sends the original, as before).
 */
export async function copyMadeFor(objectKey: string, width: number): Promise<MadeCopy | null> {
  const key = copyKey(objectKey, width);
  const until = failed.get(key);
  if (until !== undefined) {
    if (until > Date.now()) return null;
    failed.delete(key);
  }
  let job = byKey.get(key);
  const ahead = job ? queue.indexOf(job) : queue.length;
  if (!job) {
    if (queue.length >= MAX_QUEUED) return null;
    let resolve!: (copy: MadeCopy | null) => void;
    const done = new Promise<MadeCopy | null>((r) => { resolve = r; });
    job = { objectKey, width, key, done, resolve };
    queue.push(job);
    byKey.set(key, job);
    void drain();
  }
  return ahead < WAIT_WHEN_AHEAD_BELOW ? job.done : null;
}

/** For checks: how many copies are waiting, and forget the ones that failed. */
export const queuedCopies = () => queue.length;
export const forgetFailedCopies = () => failed.clear();
