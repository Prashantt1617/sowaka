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
 * An original sent in place of a copy that does not exist yet is kept a
 * week, so a phone picks up the smaller copy once the backfill has made it.
 *
 * `private` as before: these URLs are not behind sign-in but are secret, and
 * letting a shared cache (CloudFront, a proxy) keep them is a decision of its
 * own, since a deleted post's picture would live on there until it expired.
 */
export function mediaCacheControl(served: MediaCandidate, asked: number | 'original' | undefined, objectKey: string) {
  const standIn = !served.copy && asked !== 'original' && mayHaveCopies(objectKey);
  return standIn ? 'private, max-age=604800' : 'private, max-age=31536000, immutable';
}
