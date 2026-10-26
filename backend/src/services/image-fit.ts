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

/**
 * Every width a stored copy can have, smallest first. A phone asks for the
 * width it draws at (`/media/<key>?w=720`) and gets the smallest copy at least
 * that wide.
 */
export const MEDIA_WIDTHS = [256, 720, 1080, 1600] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

/**
 * Which copies an upload gets. An avatar is drawn at most a profile header
 * across; a feed picture as a poll thumbnail, a grid tile, a card and full
 * screen.
 */
export type MediaCopies = 'avatar' | 'post';

const COPY_WIDTHS: Record<MediaCopies, readonly MediaWidth[]> = {
  avatar: [AVATAR_EDGE],
  post: [256, 720, 1080, POST_IMAGE_EDGE],
};

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type MediaCopy = ConnectMediaFile & { width: number };

/** Where the copy of `objectKey` at `width` is kept: beside it, under the same prefix. */
export function copyKey(objectKey: string, width: number) {
  return `${objectKey}@w${width}`;
}

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
  const [fitted] = await fitAt(file, [maxEdge]);
  if (!fitted) return file;
  return { originalName: fitted.originalName, contentType: fitted.contentType, size: fitted.size, bytes: fitted.bytes };
}

/**
 * The smaller copies an upload is stored with, beside the original rather
 * than in its place, so the original is still there for full-size viewing,
 * a later re-cut and the backfill. Fitted as [fitImage] fits; a copy that
 * comes out no smaller is left out, and `/media` serves the original for any
 * width that has no copy.
 */
export function imageCopies(file: ConnectMediaFile, copies: MediaCopies): Promise<MediaCopy[]> {
  return fitAt(file, COPY_WIDTHS[copies]);
}

/**
 * The original as it is kept: full size and in its own format, but turned the
 * way the camera held it and without its metadata. A phone photo carries where
 * it was taken, and anyone who opens the picture full screen gets the original.
 * Anything that is not a still picture, or that fails to decode, is kept as it
 * came. Never throws.
 */
export async function withoutMetadata(file: ConnectMediaFile): Promise<ConnectMediaFile> {
  if (!RESIZABLE.has(file.contentType)) return file;
  try {
    const image = sharp(file.bytes, { failOn: 'none' });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1) return file;
    // sharp writes no EXIF, XMP or IPTC unless asked to.
    const upright = image.rotate();
    const bytes = await (file.contentType === 'image/png'
      ? upright.png({ compressionLevel: 9 })
      : file.contentType === 'image/webp'
        ? upright.webp({ quality: 92 })
        : upright.jpeg({ quality: 92, mozjpeg: true })
    ).toBuffer();
    return { ...file, size: bytes.length, bytes };
  } catch (error) {
    logger.warn('Original kept as uploaded: its metadata could not be removed', {
      contentType: file.contentType,
      size: file.size,
      error: error instanceof Error ? error.message : String(error),
    });
    return file;
  }
}

/** Decoded once, then fitted to each edge in turn. Never throws. */
async function fitAt(file: ConnectMediaFile, edges: readonly number[]): Promise<MediaCopy[]> {
  if (!RESIZABLE.has(file.contentType)) return [];
  try {
    const image = sharp(file.bytes, { failOn: 'none' });
    const meta = await image.metadata();
    // A moving picture would be cut to its first frame.
    if ((meta.pages ?? 1) > 1) return [];
    const opaque = !meta.hasAlpha;
    const upright = image.rotate();
    // Never enlarged, so every edge past the picture's own would be the same
    // file again: only the first of them is made, and `/media` finds it for
    // any wider ask (see [copyOrder]).
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const covering = edges.find((edge) => edge >= longEdge);
    const worth = edges.filter((edge) => edge < longEdge || edge === covering);
    const made: MediaCopy[] = [];
    // One after another: sharp runs one at a time here anyway, and only one
    // encoded copy is in flight on the small instance.
    for (const edge of worth) {
      const fitted = upright
        .clone()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
      const bytes = await (opaque
        ? fitted.jpeg({ quality: 82, mozjpeg: true })
        : fitted.png({ compressionLevel: 9 })
      ).toBuffer();
      if (bytes.length >= file.size) continue;
      made.push({
        width: edge,
        originalName: withExtension(file.originalName, opaque ? 'jpg' : 'png'),
        contentType: opaque ? 'image/jpeg' : 'image/png',
        size: bytes.length,
        bytes,
      });
    }
    return made;
  } catch (error) {
    logger.warn('Image kept as uploaded: it could not be resized', {
      contentType: file.contentType,
      size: file.size,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * What a `/media` request asks for: a width (`?w=720`), the original
 * (`?original=1`), or neither, which is the largest copy there is.
 */
export function requestedWidth(query: { w?: unknown; original?: unknown }): number | 'original' | undefined {
  if (query.original === '1' || query.original === 'true') return 'original';
  const width = Number(query.w);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : undefined;
}

/**
 * The copies to look for, best first: the smallest at least as wide as asked,
 * then wider ones (sharper beats missing), then narrower ones. An avatar has
 * only its small copy, and a picture stored before copies existed has none,
 * so `/media` walks this list and ends at the original.
 */
export function copyOrder(asked: number | undefined): MediaWidth[] {
  const widths = [...MEDIA_WIDTHS];
  const first = asked == null ? -1 : widths.findIndex((width) => width >= asked);
  if (first === -1) return widths.reverse();
  return [...widths.slice(first), ...widths.slice(0, first).reverse()];
}

/**
 * False for a key that is never a picture. A video is read in many ranged
 * pieces as it plays, and each would otherwise look for every copy first.
 */
export function mayHaveCopies(objectKey: string) {
  return !/\.(mp4|mov|m4v|webm|3gp)$/i.test(objectKey) && !/@w\d+$/.test(objectKey);
}

function withExtension(name: string, extension: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return `${base || 'image'}.${extension}`;
}
