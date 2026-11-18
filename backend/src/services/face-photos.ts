/**
 * A person's face as an address any screen can load, read lean.
 *
 * A photo held as media is `/media/<key>?w=256`, as the feed draws it; one
 * kept as a link is the link. An older account keeps its photo inline (a
 * base64 `data:` URI of hundreds of KB on the user): that is never sent in a
 * list, and never read for one. The list gets `/faces/<userId>?v=&s=`
 * instead, signed so that only an address this API handed out opens it, and
 * the image is read from the record only when that address is fetched.
 * No photo at all: null, and the screen draws the initials.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { users } from '../config/db';
import { env } from '../config/env';
import { AVATAR_EDGE } from './image-fit';
import { mediaPath } from './s3-connect-media.service';

/** What a face needs from a user record, without the inline photo itself. */
export interface FaceFields {
  userId: string;
  profilePhotoKey?: string;
  /** The first characters of `profilePhotoUrl` (enough to tell `data:image/`). */
  faceHead?: string;
  /** `profilePhotoUrl`'s length, which changes with the photo (the link's version). */
  faceSize?: number;
  /** `profilePhotoUrl` when it is an https link; absent otherwise. */
  faceLink?: string;
}

const photoText = { $ifNull: ['$profilePhotoUrl', ''] };

/**
 * The projection for a face, for `find` or a `$project` stage: a few bytes
 * per person however big an inline photo is.
 */
export const FACE_PROJECTION = {
  userId: 1,
  profilePhotoKey: 1,
  faceHead: { $substrCP: [photoText, 0, 16] },
  faceSize: { $strLenBytes: photoText },
  faceLink: {
    $cond: [{ $eq: [{ $substrCP: [photoText, 0, 8] }, 'https://'] }, '$profilePhotoUrl', '$$REMOVE'],
  },
} as const;

let signingKey: Buffer | null = null;
function signature(userId: string, v: string): string {
  signingKey ??= createHash('sha256').update(`face-photo:${env.scribbleTicketSecret || env.mongoUri}`).digest();
  return createHmac('sha256', signingKey).update(`${userId}:${v}`).digest('base64url').slice(0, 24);
}

/** The address of someone's inline photo. */
function inlineAddress(userId: string, size: number): string {
  const v = String(size);
  return `/faces/${encodeURIComponent(userId)}?v=${v}&s=${signature(userId, v)}`;
}

/** A face read with FACE_PROJECTION, as an address; null for none. */
export function faceUrlOf(row: FaceFields | null | undefined): string | null {
  if (!row) return null;
  if (row.profilePhotoKey) return mediaPath(row.profilePhotoKey, AVATAR_EDGE);
  if (row.faceLink && row.faceLink.length <= 2048) return row.faceLink;
  if (row.faceHead?.startsWith('data:image/') && row.faceSize) return inlineAddress(row.userId, row.faceSize);
  return null;
}

/**
 * The same, from a record already read whole (its `profilePhotoUrl` in
 * hand): an inline photo still goes out as its address, never as itself.
 */
export function faceUrlOfUser(
  user: { userId: string; profilePhotoKey?: string; profilePhotoUrl?: string } | null | undefined,
): string | null {
  if (!user) return null;
  const photo = user.profilePhotoUrl ?? '';
  return faceUrlOf({
    userId: user.userId,
    profilePhotoKey: user.profilePhotoKey,
    faceHead: photo.slice(0, 16),
    faceSize: Buffer.byteLength(photo),
    faceLink: photo.startsWith('https://') ? photo : undefined,
  });
}

/** Faces for a handful of people, by userId, in one lean read. Everyone asked for is in the map. */
export async function faceUrlsFor(userIds: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const faces = new Map<string, string | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return faces;
  const rows = await users()
    .find<FaceFields>({ userId: { $in: ids } }, { projection: { _id: 0, ...FACE_PROJECTION } })
    .toArray();
  for (const row of rows) faces.set(row.userId, faceUrlOf(row));
  return faces;
}

/** Faces and names for a handful of people, in one lean read. */
export async function facesAndNamesFor(
  userIds: Array<string | null | undefined>,
): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return new Map();
  const rows = await users()
    .find<FaceFields & { name: string }>({ userId: { $in: ids } }, { projection: { _id: 0, name: 1, ...FACE_PROJECTION } })
    .toArray();
  return new Map(rows.map((row) => [row.userId, { name: row.name, photoUrl: faceUrlOf(row) }]));
}

/**
 * An inline photo, for `GET /faces/:userId?v=&s=`: only with the signature
 * this API put in the address. Null when there is nothing to show.
 */
export async function inlineFace(userId: string, v: unknown, sig: unknown): Promise<{ type: string; bytes: Buffer } | null> {
  if (typeof v !== 'string' || typeof sig !== 'string' || !/^\d{1,9}$/.test(v)) return null;
  if (!/^[^/\s]{1,160}$/.test(userId)) return null;
  const expected = Buffer.from(signature(userId, v));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const row = await users().findOne({ userId }, { projection: { _id: 0, profilePhotoUrl: 1 } });
  const parsed = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(row?.profilePhotoUrl ?? '');
  if (!parsed) return null;
  return { type: parsed[1] === 'image/jpg' ? 'image/jpeg' : parsed[1], bytes: Buffer.from(parsed[2], 'base64') };
}

/**
 * Faces kept a few minutes, for screens polled every second or two (a live
 * game's state, its socket ticks): a photo changes rarely, and a face a few
 * minutes old is still the right face.
 */
const KEPT_MS = 5 * 60_000;
const KEPT_MAX = 20_000;
const kept = new Map<string, { url: string | null; at: number }>();

export async function keptFaceUrlsFor(userIds: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const now = Date.now();
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const faces = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = kept.get(id);
    if (hit && now - hit.at < KEPT_MS) faces.set(id, hit.url);
    else missing.push(id);
  }
  if (missing.length) {
    const fresh = await faceUrlsFor(missing);
    if (kept.size + fresh.size > KEPT_MAX) kept.clear();
    for (const [id, url] of fresh) {
      kept.set(id, { url, at: now });
      faces.set(id, url);
    }
  }
  return faces;
}

/**
 * A kept face without waiting, for views built synchronously: the face when
 * it was read in the last few minutes, else null now, with a read started so
 * the next view has it. Await keptFaceUrlsFor first where the first view counts.
 */
export function keptFaceUrlNow(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const hit = kept.get(userId);
  if (hit && Date.now() - hit.at < KEPT_MS) return hit.url;
  void keptFaceUrlsFor([userId]).catch(() => undefined);
  return hit?.url ?? null;
}
