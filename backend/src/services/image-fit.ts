import sharp from 'sharp';
import { logger } from '../utils/logger';
import type { ConnectMediaFile } from './s3-connect-media.service';

// One picture at a time, and nothing kept between them: the API server is a
// small instance, and a phone photo decodes to tens of megabytes.
sharp.concurrency(1);
sharp.cache(false);

/** A profile photo: drawn at most a few hundred pixels across, on any phone. */
export const AVATAR_EDGE = 256;
/** A feed picture: full width on the largest phone, with room to zoom a little. */
export const POST_IMAGE_EDGE = 1600;

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The picture as it is worth storing: no longer edge past `maxEdge`, turned
 * the way the camera held it, and without its metadata (a phone photo carries
 * where it was taken). A photo comes back as a JPEG; a picture with see-through
 * parts stays a PNG.
 *
 * Phones upload what the camera took, 2 MB on average and often far more, and
 * every reader of the feed then downloaded and decoded it whole to draw it a
 * few hundred pixels wide. Anything that is not a still image, or that comes
 * out no smaller, is kept exactly as it came, and so is anything that fails to
 * decode: an upload is never refused here.
 */
export async function fitImage(file: ConnectMediaFile, maxEdge: number): Promise<ConnectMediaFile> {
  if (!RESIZABLE.has(file.contentType)) return file;
  try {
    const image = sharp(file.bytes, { failOn: 'none' });
    const meta = await image.metadata();
    // A moving picture would be cut to its first frame.
    if ((meta.pages ?? 1) > 1) return file;
    const opaque = !meta.hasAlpha;
    const fitted = image
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
    const bytes = await (opaque
      ? fitted.jpeg({ quality: 82, mozjpeg: true })
      : fitted.png({ compressionLevel: 9 })
    ).toBuffer();
    if (bytes.length >= file.size) return file;
    const contentType = opaque ? 'image/jpeg' : 'image/png';
    return {
      originalName: withExtension(file.originalName, opaque ? 'jpg' : 'png'),
      contentType,
      size: bytes.length,
      bytes,
    };
  } catch (error) {
    logger.warn('Image kept as uploaded: it could not be resized', {
      contentType: file.contentType,
      size: file.size,
      error: error instanceof Error ? error.message : String(error),
    });
    return file;
  }
}

function withExtension(name: string, extension: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return `${base || 'image'}.${extension}`;
}
