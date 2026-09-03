import { Router } from 'express';
import { connectMedia } from '../config/db';

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
    if (!objectKey.startsWith('mongo/')) {
      res.status(404).json({ success: false, message: 'Media not found' });
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
    res.setHeader('Content-Length', String(body.length));
    // Content is immutable per key, so let clients cache it hard rather than
    // refetching megabytes on every feed render.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.status(200).end(body);
  } catch (error) {
    next(error);
  }
});
