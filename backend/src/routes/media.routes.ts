import { Router } from 'express';
import { connectMedia } from '../config/db';
import { logger } from '../utils/logger';
import { isConnectMediaKey, readConnectMedia } from '../services/s3-connect-media.service';
import { requestedWidth } from '../services/image-fit';
import {
  mediaCacheControl,
  mediaCandidates,
  rememberMissingCopy,
  type MediaCandidate,
} from '../services/media-lookup';

export const mediaRouter = Router();

/** S3's answer for a key that was never written (as against one it failed to read). */
function isMissingObject(error: unknown) {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return failure?.name === 'NoSuchKey' || failure?.$metadata?.httpStatusCode === 404;
}

// helmet() sets `Cross-Origin-Resource-Policy: same-origin` on everything,
// which a browser applies to an <img> too: the dashboard and the Flutter web
// build sit on other origins, so every avatar and post image would be fetched
// and then thrown away. Media is public by nature; the page that shows it is
// not always on this host.
mediaRouter.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

/**
 * Streams media held in Mongo (the fallback used when S3 isn't configured).
 *
 * Deliberately unauthenticated: image widgets can't attach an Authorization
 * header, and the key is an unguessable UUID — the same "secret URL" model as
 * the S3 presigned URLs this replaces once credentials are in place.
 */
mediaRouter.get('/:key', async (req, res, next) => {
  try {
    // Express has already decoded the path segment; decoding again would turn
    // a literal % in a key into a URIError, and doubles nothing useful.
    const objectKey = String(req.params.key ?? '');
    if (!objectKey) {
      res.status(404).json({ success: false, message: 'Media not found' });
      return;
    }
    // `?w=720` for the copy a phone draws at that width, `?original=1` for
    // the upload as it came; neither is the largest copy there is.
    const wanted = requestedWidth(req.query);
    // Held in S3: stream it back through this host, so a client only ever
    // has to reach the API. Anything else is the Mongo fallback below.
    if (!objectKey.startsWith('mongo/')) {
      // Anything outside the Connect prefix is not ours to serve: see
      // [isConnectMediaKey]. Answered as a miss, so this is not an oracle
      // for which keys exist in the bucket.
      if (!isConnectMediaKey(objectKey)) {
        res.status(404).json({ success: false, message: 'Media not found' });
        return;
      }
      // A video player asks for the bytes it needs, not the whole file, and
      // AVPlayer on iOS will not scrub at all unless the answer is a 206.
      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      // Listen before waiting on S3: a reader who scrolls on while S3 is still
      // answering is gone by the time the stream arrives, and a 'close'
      // listener added after that never fires, so the S3 socket stayed open
      // for good. Enough of those and no image or video loaded at all.
      let readerGone = false;
      res.on('close', () => { readerGone = true; });
      // The copy at the width asked for if there is one, else the next best,
      // else the original (see [mediaCandidates]).
      let object: Awaited<ReturnType<typeof readConnectMedia>> | undefined;
      let served: MediaCandidate | undefined;
      for (const candidate of mediaCandidates(objectKey, wanted)) {
        object = await readConnectMedia(candidate.key, range).catch((error: unknown) => {
          if (candidate.copy && isMissingObject(error)) rememberMissingCopy(candidate.key);
          return undefined;
        });
        if (readerGone || res.destroyed || object?.body) {
          served = candidate;
          break;
        }
      }
      if (readerGone || res.destroyed) {
        (object?.body as (NodeJS.ReadableStream & { destroy?: () => void }) | undefined)?.destroy?.();
        return;
      }
      if (!object?.body || !served) {
        res.status(404).json({ success: false, message: 'Media not found' });
        return;
      }
      res.setHeader('Content-Type', object.contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      if (object.contentLength != null) {
        res.setHeader('Content-Length', String(object.contentLength));
      }
      if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
      res.setHeader('Cache-Control', mediaCacheControl(served, wanted, objectKey));
      res.status(object.contentRange ? 206 : 200);
      // pipe() does not forward the source's errors. An S3 socket reset
      // part-way through a video would otherwise be an unhandled 'error' on
      // a stream nobody listens to, which takes the process down.
      const stream = object.body as NodeJS.ReadableStream & { destroy?: () => void };
      stream.on('error', (error: Error) => {
        logger.error('Media stream failed', { objectKey }, error);
        res.destroy(error);
      });
      // A reader who navigates away part-way through leaves the S3 socket
      // open otherwise.
      res.on('close', () => stream.destroy?.());
      stream.pipe(res);
      return;
    }
    let media: { contentType: string; bytes: Buffer } | null = null;
    let served: MediaCandidate | undefined;
    for (const candidate of mediaCandidates(objectKey, wanted)) {
      media = await connectMedia().findOne({ objectKey: candidate.key });
      if (media) {
        served = candidate;
        break;
      }
      if (candidate.copy) rememberMissingCopy(candidate.key);
    }
    if (!media || !served) {
      res.status(404).json({ success: false, message: 'Media not found' });
      return;
    }
    const bytes = media.bytes as unknown as { buffer: ArrayBuffer } | Buffer;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from((bytes as { buffer: ArrayBuffer }).buffer);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    // Content is immutable per key, so let clients cache it hard rather than
    // refetching megabytes on every feed render.
    res.setHeader('Cache-Control', mediaCacheControl(served, wanted, objectKey));
    // `bytes=N-M`, `bytes=N-`, and the suffix form `bytes=-N` (the LAST n
    // bytes, which a video probe asks for to find the moov atom — read as
    // 0..n it would hand back the wrong bytes under a truthful header).
    const asked = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (asked && (asked[1] || asked[2])) {
      const suffix = !asked[1];
      const start = suffix
        ? Math.max(0, body.length - Number(asked[2]))
        : Number(asked[1]);
      const end = suffix || !asked[2]
        ? body.length - 1
        : Math.min(Number(asked[2]), body.length - 1);
      if (start > end || start >= body.length) {
        res.setHeader('Content-Range', `bytes */${body.length}`);
        res.status(416).end();
        return;
      }
      const slice = body.subarray(start, end + 1);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
      res.setHeader('Content-Length', String(slice.length));
      res.status(206).end(slice);
      return;
    }
    res.setHeader('Content-Length', String(body.length));
    res.status(200).end(body);
  } catch (error) {
    next(error);
  }
});
