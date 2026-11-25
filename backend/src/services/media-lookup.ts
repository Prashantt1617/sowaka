import { copyKey, copyOrder, mayHaveCopies } from './image-fit';

/**
 * Which stored object answers a `/media` request: a copy at the width asked
 * for, or the original. Kept apart from the route so the choice can be
 * checked without S3 (see scripts/image-fit-check.ts).
 */

export type MediaCandidate = { key: string; copy: boolean };

// Copies known not to exist, so a picture uploaded before copies existed (or
// an avatar asked for at a width it has no copy at) costs one miss per
// process rather than one per request. Forgotten after a while, so copies
// made by the backfill are found without a restart.
const MISSING_FOR_MS = 10 * 60_000;
const MAX_REMEMBERED = 20_000;
const missing = new Map<string, number>();

export function rememberMissingCopy(key: string, now = Date.now()) {
  if (missing.size >= MAX_REMEMBERED) {
    // The oldest entry: a Map iterates in insertion order.
    const oldest = missing.keys().next().value;
    if (oldest !== undefined) missing.delete(oldest);
  }
  missing.set(key, now + MISSING_FOR_MS);
}

/** A copy that exists now (made on first ask: media-copies.ts). */
export function forgetMissingCopy(key: string) {
  missing.delete(key);
}

function knownMissing(key: string, now: number) {
  const until = missing.get(key);
  if (until == null) return false;
  if (until > now) return true;
  missing.delete(key);
  return false;
}

/**
 * The keys to read, best first, always ending at the original. Asked for the
 * original (or for a video), that is the only one.
 */
export function mediaCandidates(
  objectKey: string,
  asked: number | 'original' | undefined,
  now = Date.now(),
): MediaCandidate[] {
  const original = { key: objectKey, copy: false };
  if (asked === 'original' || !mayHaveCopies(objectKey)) return [original];
  return [
    ...copyOrder(asked)
      .map((width) => ({ key: copyKey(objectKey, width), copy: true }))
      .filter((candidate) => !knownMissing(candidate.key, now)),
    original,
  ];
}

/**
 * How long a reader may keep what it was sent. Every key's bytes never
 * change, so a copy, or an original that was asked for, is kept a year.
 * An original sent in place of a copy that does not exist yet is kept an
 * hour, so a phone and CloudFront pick up the smaller copy soon after it is made
 * (a week kept 6 MB avatars on every phone long after their 200 KB copy existed).
 *
 * `public`, so CloudFront keeps them too and a scroll through the feed is
 * served from the edge rather than from this server: the URLs are not behind
 * sign-in (an image widget cannot send one) but are unguessable, and the bytes
 * under a key never change. A deleted post's picture can then still be fetched
 * from the edge by someone who kept its URL, until it expires there.
 */
export function mediaCacheControl(served: MediaCandidate, asked: number | 'original' | undefined, objectKey: string) {
  const standIn = !served.copy && asked !== 'original' && mayHaveCopies(objectKey);
  return standIn ? 'public, max-age=3600' : 'public, max-age=31536000, immutable';
}

/**
 * The file name a push's picture is sent under (`/media/<key>?push=1`): its
 * extension from what is really sent, since a PNG upload may be served as a
 * JPEG copy. iOS's notification extension (Firebase's helper) names the
 * attachment after the response, and refuses a picture whose name says
 * another type.
 */
export function pushPictureName(contentType: string): string {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/gif' ? 'gif' : 'jpg';
  return `picture.${ext}`;
}

/**
 * A copy that is not there yet. S3 answers a missing key with 404 only to a user allowed to list the
 * bucket; the upload user is not (no s3:ListBucket), so a missing copy comes back as 403 AccessDenied.
 * Read as an error, no copy was ever made and every `?w=` ask streamed the whole original: 24.7 GB of
 * profile photos in 45 minutes of the 19 Nov Knights tournament (25 Nov 2026). Only asked of copy keys,
 * which live under our own prefix, so a 403 there means "not made yet".
 */
export function isMissingObject(error: unknown) {
  const failure = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return failure?.name === 'NoSuchKey' || failure?.$metadata?.httpStatusCode === 404
    || failure?.name === 'AccessDenied' || failure?.Code === 'AccessDenied' || failure?.$metadata?.httpStatusCode === 403;
}
