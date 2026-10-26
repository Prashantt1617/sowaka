import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { env } from '../config/env';
import { s3EncryptionParams } from '../utils/s3-encryption.util';
import { connectMedia } from '../config/db';
import { logger } from '../utils/logger';
import { AVATAR_EDGE, copyKey, imageCopies, MEDIA_WIDTHS, withoutMetadata, type MediaCopies, type MediaCopy } from './image-fit';

export type ConnectMediaFile = {
  originalName: string;
  contentType: string;
  size: number;
  bytes: Buffer;
};

let client: S3Client | undefined;

/**
 * Stores one upload. A picture given [copies] is stored as it came, with its
 * smaller copies beside it (see [imageCopies]). The copies are a bonus: one
 * that fails to store is logged, `/media` serves the original in its place,
 * and the upload still succeeds.
 */
export async function uploadConnectMedia(userId: string, upload: ConnectMediaFile, copies?: MediaCopies) {
  // A picture's original loses its metadata (where it was taken) before it is kept.
  const file = copies ? await withoutMetadata(upload) : upload;
  const made = copies ? await imageCopies(file, copies) : [];
  if (!hasS3Configuration()) return storeInMongo(file, made);
  try {
    validateConfiguration();
    const objectKey = buildObjectKey(userId, file.originalName);
    await Promise.all([
      putConnectObject(objectKey, file),
      ...made.map((copy) =>
        putConnectObject(copyKey(objectKey, copy.width), copy).catch((error: unknown) => {
          logger.warn('Media copy not stored; the original is served instead', { objectKey, width: copy.width }, error);
        }),
      ),
    ]);
    return { objectKey, contentType: file.contentType, size: file.size };
  } catch (error) {
    // No explicit access key was configured, meaning we expected an AWS
    // instance role to supply credentials. Failing to resolve any means
    // we're not actually running on AWS (e.g. local dev) rather than a real
    // misconfiguration — fall back to Mongo storage instead of hard-failing.
    // An explicit-but-wrong key still throws, since that path is skipped.
    if (!env.s3.accessKeyId) return storeInMongo(file, made);
    throw error;
  }
}

/** Writes one object under the Connect prefix, encrypted as every object is. */
export async function putConnectObject(
  objectKey: string,
  file: Pick<ConnectMediaFile, 'bytes' | 'contentType' | 'size'>,
) {
  validateConfiguration();
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: objectKey,
      Body: file.bytes,
      ContentType: file.contentType,
      ContentLength: file.size,
      ...s3EncryptionParams(),
    }),
  );
}

async function storeInMongo(file: ConnectMediaFile, copies: MediaCopy[] = []) {
  if (!file.contentType.startsWith('image/')) {
    throw new Error('AWS S3 is required for video uploads');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Images must be 10 MB or smaller');
  }
  const objectKey = `mongo/${randomUUID()}`;
  const createdAt = new Date();
  await connectMedia().insertMany([
    { objectKey, contentType: file.contentType, size: file.size, bytes: file.bytes, createdAt },
    ...copies.map((copy) => ({
      objectKey: copyKey(objectKey, copy.width),
      contentType: copy.contentType,
      size: copy.size,
      bytes: copy.bytes,
      createdAt,
    })),
  ]);
  return { objectKey, contentType: file.contentType, size: file.size };
}

/** Deletes an upload and every copy it may have. */
export async function deleteConnectMedia(objectKey: string) {
  const copies = MEDIA_WIDTHS.map((width) => copyKey(objectKey, width));
  if (objectKey.startsWith('mongo/')) {
    await connectMedia().deleteMany({ objectKey: { $in: [objectKey, ...copies] } });
    return;
  }
  validateConfiguration();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
  // S3 answers a delete of a key never written as done, so an upload from
  // before copies existed costs four quick calls and nothing else.
  await Promise.all(
    copies.map((key) =>
      getClient()
        .send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }))
        .catch(() => undefined),
    ),
  );
}

/**
 * Streams one stored object back, for the `/media` route to serve. Kept here
 * so the bucket and its encryption settings stay in one place.
 */
/**
 * True only for a key this service itself wrote.
 *
 * The bucket is shared: reimbursement receipts, leave documents (medical
 * notes) and HR's employee files live beside Connect media under their own
 * prefixes. `/media/:key` is deliberately unauthenticated, so it must be
 * unable to name anything but a Connect object — a receipt's key is visible
 * to anyone ever shown its download link, and would otherwise be readable
 * for ever by anyone at all.
 */
export function isConnectMediaKey(objectKey: string): boolean {
  const prefix = env.s3.connectMediaPrefix.replace(/^\/+|\/+$/g, '');
  return prefix.length > 0 && objectKey.startsWith(`${prefix}/`);
}

export async function readConnectMedia(objectKey: string, range?: string) {
  if (!isConnectMediaKey(objectKey)) {
    throw new Error(`Refusing to read a key outside the Connect media prefix: ${objectKey}`);
  }
  validateConfiguration();
  const object = await getClient().send(
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: objectKey, Range: range }),
  );
  return {
    body: object.Body as NodeJS.ReadableStream | undefined,
    contentType: object.ContentType ?? 'application/octet-stream',
    contentLength: object.ContentLength,
    // Present only for a ranged read, as "bytes 0-999/22880555".
    contentRange: object.ContentRange,
  };
}

/**
 * The size and type of the Connect object at `objectKey` (S3 or the Mongo
 * fallback) without reading it, or undefined when there is none.
 */
export async function statConnectObject(
  objectKey: string,
): Promise<{ size: number; contentType: string } | undefined> {
  if (objectKey.startsWith('mongo/')) {
    const media = await connectMedia().findOne(
      { objectKey },
      { projection: { _id: 0, size: 1, contentType: 1 } },
    );
    return media ? { size: media.size, contentType: media.contentType } : undefined;
  }
  if (!isConnectMediaKey(objectKey)) return undefined;
  validateConfiguration();
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? 'application/octet-stream' };
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
    throw error;
  }
}

export async function presignConnectMedia(objectKey: string, width?: number) {
  // Always a path on this API, never the bucket's own host. Phones on
  // networks that filter *.amazonaws.com (a common Private DNS or ad-block
  // rule) could resolve the API but not S3, so a feed of images and video sat
  // buffering forever. One host to reach means one host to allow.
  return mediaPath(objectKey, width);
}

/**
 * `/media/<key>`, optionally asking for a width. Without one the route serves
 * the largest copy there is; the app adds `?w=` for the width it draws at.
 */
export function mediaPath(objectKey: string, width?: number) {
  return `/media/${encodeURIComponent(objectKey)}${width ? `?w=${width}` : ''}`;
}

export async function resolveProfilePhoto(
  user: { profilePhotoKey?: string; profilePhotoUrl?: string } | null | undefined,
): Promise<string | undefined> {
  if (!user) return undefined;
  if (user.profilePhotoKey) {
    // The small copy: a face is drawn at avatar size everywhere it appears,
    // and app builds already in people's hands load the URL as given.
    return presignConnectMedia(user.profilePhotoKey, AVATAR_EDGE).catch(() => undefined);
  }
  return user.profilePhotoUrl;
}

function getClient() {
  client ??= new S3Client({
    region: env.s3.region,
    ...(env.s3.endpoint ? { endpoint: env.s3.endpoint } : {}),
    forcePathStyle: env.s3.forcePathStyle,
    // Every image and video in the feed streams through this client. The
    // defaults (50 sockets, no idle limit) let a few stuck reads hold the pool
    // until nothing more could load: on 21 Oct every feed image and video
    // hung until the process was restarted.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      // A read that has gone quiet this long is dropped and its socket freed.
      socketTimeout: 60_000,
      httpsAgent: { keepAlive: true, maxSockets: 256 },
    }),
    ...(env.s3.accessKeyId && env.s3.secretAccessKey
      ? {
          credentials: {
            accessKeyId: env.s3.accessKeyId,
            secretAccessKey: env.s3.secretAccessKey,
            ...(env.s3.sessionToken ? { sessionToken: env.s3.sessionToken } : {}),
          },
        }
      : {}),
  });
  return client;
}

function validateConfiguration() {
  if (!env.s3.region || !env.s3.bucket) {
    throw new Error('AWS_REGION and AWS_S3_BUCKET are required');
  }
  if (Boolean(env.s3.accessKeyId) !== Boolean(env.s3.secretAccessKey)) {
    throw new Error('AWS access key ID and secret access key must be provided together');
  }
  if (!['AES256', 'aws:kms'].includes(env.s3.serverSideEncryption)) {
    throw new Error('AWS_S3_SERVER_SIDE_ENCRYPTION must be AES256 or aws:kms');
  }
  if (env.s3.serverSideEncryption === 'aws:kms' && !env.s3.kmsKeyId) {
    throw new Error('AWS_S3_KMS_KEY_ID is required when using aws:kms');
  }
}

function hasS3Configuration() {
  return Boolean(env.s3.region && env.s3.bucket);
}

function buildObjectKey(userId: string, originalName: string) {
  const now = new Date();
  const prefix = env.s3.connectMediaPrefix.replace(/^\/+|\/+$/g, '');
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeName = originalName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
  return [
    prefix,
    safeUserId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomUUID()}-${safeName || 'media'}`,
  ]
    .filter(Boolean)
    .join('/');
}
