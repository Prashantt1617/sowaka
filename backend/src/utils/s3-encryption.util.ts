import type { ServerSideEncryption } from '@aws-sdk/client-s3';
import { env } from '../config/env';

/**
 * The encryption fields every object we store is written with.
 *
 * Kept in one place because it was three: a receipt, a leave document and a
 * Connect media upload each spelled it out, and a KMS key added in one of them
 * would have silently left the other two writing AES256. Which encryption is
 * used is a property of the bucket, not of what happens to be going into it.
 */
export function s3EncryptionParams() {
  const encryption = env.s3.serverSideEncryption as ServerSideEncryption;
  return {
    ServerSideEncryption: encryption,
    ...(encryption === 'aws:kms' ? { SSEKMSKeyId: env.s3.kmsKeyId } : {}),
  };
}
