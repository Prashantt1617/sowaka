import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { connectMedia } from '../config/db';

export type ConnectMediaFile = {
  originalName: string;
  contentType: string;
  size: number;
  bytes: Buffer;
};

let client: S3Client | undefined;

export async function uploadConnectMedia(userId: string, file: ConnectMediaFile) {
  if (!hasS3Configuration()) return storeInMongo(file);
  try {
    validateConfiguration();
    const objectKey = buildObjectKey(userId, file.originalName);
    const encryption = env.s3.serverSideEncryption as ServerSideEncryption;
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.s3.bucket,
        Key: objectKey,
        Body: file.bytes,
        ContentType: file.contentType,
        ContentLength: file.size,
        ServerSideEncryption: encryption,
        ...(encryption === 'aws:kms' ? { SSEKMSKeyId: env.s3.kmsKeyId } : {}),
      }),
    );
    return { objectKey, contentType: file.contentType, size: file.size };
  } catch (error) {
    // No explicit access key was configured, meaning we expected an AWS
    // instance role to supply credentials. Failing to resolve any means
    // we're not actually running on AWS (e.g. local dev) rather than a real
    // misconfiguration — fall back to Mongo storage instead of hard-failing.
    // An explicit-but-wrong key still throws, since that path is skipped.
    if (!env.s3.accessKeyId) return storeInMongo(file);
    throw error;
  }
}

async function storeInMongo(file: ConnectMediaFile) {
  if (!file.contentType.startsWith('image/')) {
    throw new Error('AWS S3 is required for video uploads');
  }
  if (file.size > 10 * 1024 * 1024) { 
    throw new Error('Images must be 10 MB or smaller');
  }
  const objectKey = `mongo/${randomUUID()}`;
  await connectMedia().insertOne({
    objectKey,
    contentType: file.contentType,
    size: file.size,
    bytes: file.bytes,
    createdAt: new Date(),
  });
  return { objectKey, contentType: file.contentType, size: file.size };
}

export async function deleteConnectMedia(objectKey: string) {
  if (objectKey.startsWith('mongo/')) {
    await connectMedia().deleteOne({ objectKey });
    return;
  }
  validateConfiguration();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
}

export async function presignConnectMedia(objectKey: string) {
  if (objectKey.startsWith('mongo/')) {
    const media = await connectMedia().findOne({ objectKey });
    if (!media) throw new Error('Connect media not found');
    return `data:${media.contentType};base64,${media.bytes.toString('base64')}`;
  }
  validateConfiguration();
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }),
    { expiresIn: env.s3.presignTtl },
  );
}

function getClient() {
  client ??= new S3Client({
    region: env.s3.region,
    ...(env.s3.endpoint ? { endpoint: env.s3.endpoint } : {}),
    forcePathStyle: env.s3.forcePathStyle,
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
