import { Router } from 'express';
import { connectMedia } from '../config/db';
import { readConnectMedia } from '../services/s3-connect-media.service';

export const mediaRouter = Router();

/**
 * Streams media held in Mongo (the fallback used when S3 isn't configured).
 *
 * Deliberately unauthenticated: image widgets can't attach an Authorization
 * header, and the key is an unguessable UUID — the same "secret URL" model as
 * the S3 presigned URLs this replaces once credentials are in place.
 */
mediaRouter.get('/:key', async (req, res, next) => {
  try {
    const objectKey = decodeURIComponent(String(req.params.key ?? ''));
    if (!objectKey) {
      res.status(404).json({ success: false, message: 'Media not found' });
      return;
    }
    // Held in S3: stream it back through this host, so a client only ever
    // has to reach the API. Anything else is the Mongo fallback below.
    if (!objectKey.startsWith('mongo/')) {
      // A video player asks for the bytes it needs, not the whole file, and
      // AVPlayer on iOS will not scrub at all unless the answer is a 206.
      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const object = await readConnectMedia(objectKey, range).catch(() => undefined);
      if (!object?.body) {
        res.status(404).json({ success: false, message: 'Media not found' });
        return;
      }
      res.setHeader('Content-Type', object.contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      if (object.contentLength != null) {
        res.setHeader('Content-Length', String(object.contentLength));
      }
      if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
      // Immutable per key, as below.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.status(object.contentRange ? 206 : 200);
      object.body.pipe(res);
      return;
    }
    const media = await connectMedia().findOne({ objectKey });
    if (!media) {
      res.status(404).json({ success: false, message: 'Media not found' });
      return;
    }
    const bytes = media.bytes as unknown as { buffer: ArrayBuffer } | Buffer;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from((bytes as { buffer: ArrayBuffer }).buffer);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    // Content is immutable per key, so let clients cache it hard rather than
    // refetching megabytes on every feed render.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    const asked = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (asked) {
      const start = asked[1] ? Number(asked[1]) : 0;
      const end = asked[2] ? Math.min(Number(asked[2]), body.length - 1) : body.length - 1;
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
