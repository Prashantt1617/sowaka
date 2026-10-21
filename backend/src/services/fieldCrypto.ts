/**
 * Field-level encryption for sensitive employee identifiers (bank account
 * number, PAN, UAN, PF and ESI numbers): AES-256-GCM, a fresh 96-bit IV per
 * value, stored as "f1:<iv>:<tag>:<ciphertext>" (base64url).
 *
 * INTERIM LAYER. The key is a server-side secret from the environment
 * (PAYROLL_FIELD_KEY: 32 random bytes, base64), so it protects the values in
 * the database and its backups, not against someone who also holds the
 * server's environment. The end-to-end scheme in docs/PAYROLL_ENCRYPTION.md
 * (per-org data key wrapped to each payroll user's key, decrypted only in
 * the browser) is meant to take over these fields; until then this keeps
 * them out of plaintext at rest.
 */
import crypto from 'node:crypto';

const PREFIX = 'f1';

export class FieldCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldCryptoError';
  }
}

function key(): Buffer {
  const raw = process.env.PAYROLL_FIELD_KEY?.trim();
  if (!raw) throw new FieldCryptoError('PAYROLL_FIELD_KEY is not set: bank, PAN and UAN details cannot be saved or read');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new FieldCryptoError('PAYROLL_FIELD_KEY must be 32 bytes, base64');
  return k;
}

/** Whether a key is configured (reads degrade to masked values without one). */
export function fieldKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored; // a value saved before encryption
  const [, iv, tag, ct] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** "•••• 1234": the last four characters only. */
export function maskTail(plainOrLast4: string | undefined): string | undefined {
  if (!plainOrLast4) return undefined;
  return `•••• ${plainOrLast4.slice(-4)}`;
}
