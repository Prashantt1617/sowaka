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
import { stablePresignDate } from '../utils/presign.util';

type ReceiptFile = {
  originalName: string;
  contentType: string;
  size: number;
  bytes: Buffer;
};

let client: S3Client | undefined;

export async function uploadReimbursementReceipt(userId: string, file: ReceiptFile) {
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
}

export async function deleteReimbursementReceipt(objectKey: string) {
  validateConfiguration();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
}

/// Returns a short-lived presigned URL so the browser can view/download the
/// stored receipt inline without exposing S3 credentials.
export async function presignReceiptDownload(objectKey: string, fileName?: string) {
  validateConfiguration();
  const command = new GetObjectCommand({
    Bucket: env.s3.bucket,
    Key: objectKey,
    ...(fileName
      ? { ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"` }
      : {}),
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: env.s3.presignTtl,
    signingDate: stablePresignDate(),
  });
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

function buildObjectKey(userId: string, originalName: string) {
  const now = new Date();
  const prefix = env.s3.receiptPrefix.replace(/^\/+|\/+$/g, '');
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
    `${randomUUID()}-${safeName || 'receipt'}`,
  ]
    .filter(Boolean)
    .join('/');
}
