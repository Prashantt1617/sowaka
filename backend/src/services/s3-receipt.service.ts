import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { s3EncryptionParams } from '../utils/s3-encryption.util';
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
  return { objectKey, contentType: file.contentType, size: file.size };
}

/**
 * A document attached to a leave request. Same bucket and the same encryption
 * as receipts — only the key prefix differs, so a leave note is never served
 * from a reimbursement URL.
 */
export async function uploadLeaveDocument(userId: string, file: ReceiptFile) {
  validateConfiguration();
  const objectKey = buildObjectKey(userId, file.originalName).replace(
    /^([^/]*\/)?/,
    (prefix) => `${prefix}leave/`,
  );
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
  return { objectKey, contentType: file.contentType, size: file.size };
}

/**
 * A document HR files against an employee. Same bucket and encryption; its own
 * prefix, so an offer letter is never reachable through a receipt's path.
 */
export async function uploadEmployeeDocument(userId: string, file: ReceiptFile) {
  validateConfiguration();
  const objectKey = buildObjectKey(userId, file.originalName).replace(
    /^([^/]*\/)?/,
    (prefix) => `${prefix}employees/`,
  );
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
  return { objectKey, contentType: file.contentType, size: file.size };
}

/**
 * A file attached to a Support desk message. Same bucket and encryption; its
 * own prefix, `…/support/<org>/<ticketId>/`. The key is random and carries no
 * part of the client's file name; the name is kept on the message instead.
 */
export async function uploadSupportAttachment(org: string, ticketId: string, file: ReceiptFile) {
  validateConfiguration();
  const root = env.s3.receiptPrefix.replace(/^\/+|\/+$/g, '').split('/')[0];
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
  const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' }[file.contentType] ?? '';
  const objectKey = [root, 'support', safe(org), safe(ticketId), `${randomUUID()}${extension}`].filter(Boolean).join('/');
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
  return { objectKey, contentType: file.contentType, size: file.size };
}

export async function deleteSupportAttachment(objectKey: string) {
  validateConfiguration();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
}

/** Whether uploads can be stored at all on this host. */
export function hasReceiptStorage(): boolean {
  return Boolean(env.s3.region && env.s3.bucket);
}

export async function deleteEmployeeDocument(objectKey: string) {
  validateConfiguration();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: objectKey }));
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
    ...(fileName ? { ResponseContentDisposition: inlineDisposition(fileName) } : {}),
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: env.s3.presignTtl,
    signingDate: stablePresignDate(),
  });
}

/**
 * `inline`, under the file's own name. S3 refuses the whole download when the
 * header carries anything outside ISO-8859-1, and real names often do: the
 * narrow space in a macOS screenshot's time, a name in Hindi. So `filename`
 * is a plain-ASCII stand-in and the real name goes in `filename*`, which
 * browsers prefer when it is there.
 */
function inlineDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  let utf8: string;
  try {
    // encodeURIComponent leaves these four alone, but `filename*` may not carry them bare.
    utf8 = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    // A broken surrogate pair cannot be encoded; the stand-in still opens the file.
    return `inline; filename="${ascii}"`;
  }
  return `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`;
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
