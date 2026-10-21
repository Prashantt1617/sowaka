/**
 * End-to-end encryption of salary data, WebCrypto only, so the same code
 * runs in the dashboard (browser) and in Node scripts (globalThis.crypto).
 * The server stores what this produces and never holds a key that opens it.
 *
 *   passphrase ──PBKDF2-SHA256 (600k)──▶ KEK ──AES-GCM──▶ user's RSA-OAEP private key
 *   org payroll data key (AES-256-GCM, random)
 *     ├─ wrapped to each payroll user's RSA-OAEP-3072 public key   (grants)
 *     └─ wrapped to the org's recovery public key, whose private half is
 *        sealed under the recovery key (256-bit, shown once at setup)
 *   salary structure / payslip / run totals ──AES-GCM(data key, AAD)──▶ sealed blob
 *   payslip for the employee ──fresh AES key wrapped to the employee's public key──▶ sealedForEmployee
 *
 * The AAD binds a blob to what it belongs to (org, kind, id), so the server
 * cannot swap one person's sealed salary into another's record unnoticed.
 */

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available here');
  return s;
};

export const PBKDF2_ITERATIONS = 600_000;
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

// —— base64 without Buffer (browser and Node 16+) ——
export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** WebCrypto wants a plain ArrayBuffer-backed view; TS 5.7 is strict about it. */
const buf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** What the server keeps for one user: their public key, and their private key sealed under their passphrase. */
export interface UserKeyRecord {
  publicKey: string; // SPKI, base64
  wrappedPrivateKey: string; // AES-GCM(KEK, PKCS#8), base64
  salt: string;
  iv: string;
  iterations: number;
}

export interface Sealed {
  v: 1;
  keyVersion: number;
  iv: string;
  ct: string;
}

export interface SealedForPerson {
  v: 1;
  wrappedKey: string; // RSA-OAEP(employee public key, AES key)
  iv: string;
  ct: string;
}

async function kekFrom(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', buf(utf8(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** A new keypair for one payroll user, the private half sealed under their passphrase. */
export async function createUserKeys(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<{ record: UserKeyRecord; privateKey: CryptoKey }> {
  if (passphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters');
  const pair = await subtle().generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const spki = await subtle().exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', pair.privateKey);
  const salt = random(16);
  const iv = random(12);
  const kek = await kekFrom(passphrase, salt, iterations);
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv) }, kek, pkcs8);
  return {
    record: { publicKey: toB64(spki), wrappedPrivateKey: toB64(wrapped), salt: toB64(salt), iv: toB64(iv), iterations },
    privateKey: await subtle().importKey('pkcs8', pkcs8, RSA, false, ['decrypt']),
  };
}

/** The user's private key, opened with their passphrase. Throws on a wrong passphrase. */
export async function unlockPrivateKey(record: UserKeyRecord, passphrase: string): Promise<CryptoKey> {
  const kek = await kekFrom(passphrase, fromB64(record.salt), record.iterations);
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(record.iv)) }, kek, buf(fromB64(record.wrappedPrivateKey)));
  } catch {
    throw new Error('Wrong passphrase');
  }
  return subtle().importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
}

/** The same keypair under a new passphrase: grants made to it stay valid. Throws on a wrong old passphrase. */
export async function rewrapPrivateKey(record: UserKeyRecord, oldPassphrase: string, newPassphrase: string, iterations = PBKDF2_ITERATIONS): Promise<UserKeyRecord> {
  if (newPassphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters');
  const oldKek = await kekFrom(oldPassphrase, fromB64(record.salt), record.iterations);
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(record.iv)) }, oldKek, buf(fromB64(record.wrappedPrivateKey)));
  } catch {
    throw new Error('Wrong passphrase');
  }
  const salt = random(16);
  const iv = random(12);
  const kek = await kekFrom(newPassphrase, salt, iterations);
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv) }, kek, pkcs8);
  return { publicKey: record.publicKey, wrappedPrivateKey: toB64(wrapped), salt: toB64(salt), iv: toB64(iv), iterations };
}

/** A fresh org payroll data key. Extractable only so it can be wrapped for others. */
export function createDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapForPublicKey(dataKey: CryptoKey, publicKeySpki: string): Promise<string> {
  const pub = await subtle().importKey('spki', buf(fromB64(publicKeySpki)), RSA, false, ['encrypt']);
  const raw = await subtle().exportKey('raw', dataKey);
  return toB64(await subtle().encrypt(RSA, pub, raw));
}

export async function unwrapWithPrivateKey(wrapped: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const raw = await subtle().decrypt(RSA, privateKey, buf(fromB64(wrapped)));
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// —— Recovery key: 256 random bits, shown once as 8 groups of 8 hex characters ——
export function createRecoveryKey(): string {
  const hex = [...random(32)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{8}/g)!.join('-');
}
//
// The recovery key opens an RSA keypair kept for the org (its private half
// sealed under the recovery key). Every data key the org uses is wrapped to
// that public key, so rotating the data key needs neither the recovery key
// nor a new one: it is shown once, at setup, unless someone asks to replace it.
function recoveryHex(recoveryKey: string): string {
  const hex = recoveryKey.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 64) throw new Error('A recovery key is 64 hex characters');
  return hex;
}
async function recoveryAesKey(recoveryKey: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(recoveryHex(recoveryKey).match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return subtle().importKey('raw', buf(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(text: string): Promise<string> {
  return hexOf(await subtle().digest('SHA-256', buf(utf8(text))));
}
/**
 * Proof that the caller holds the recovery key, without revealing it: the
 * server keeps only sha256(proof) and compares. Neither value opens anything.
 */
export function recoveryProof(recoveryKey: string): Promise<string> {
  return sha256Hex(`sowaka-payroll-recovery-proof:v1:${recoveryHex(recoveryKey)}`);
}

/** The org's recovery keypair, as the server keeps it. */
export interface RecoveryRecord {
  publicKey: string; // SPKI, base64
  wrappedPrivateKey: string; // AES-GCM(recovery key, PKCS#8), base64
  iv: string;
  /** sha256 of the recovery proof. */
  check: string;
}

export async function createRecoveryRecord(recoveryKey: string): Promise<RecoveryRecord> {
  const pair = await subtle().generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const spki = await subtle().exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', pair.privateKey);
  const iv = random(12);
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8('payroll-recovery')) }, await recoveryAesKey(recoveryKey), pkcs8);
  return { publicKey: toB64(spki), wrappedPrivateKey: toB64(wrapped), iv: toB64(iv), check: await sha256Hex(await recoveryProof(recoveryKey)) };
}

/** The data key, opened with the recovery key. Throws "Wrong recovery key". */
export async function unwrapWithRecovery(record: { wrappedPrivateKey: string; iv: string; wrappedDataKey: string }, recoveryKey: string): Promise<CryptoKey> {
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(record.iv)), additionalData: buf(utf8('payroll-recovery')) }, await recoveryAesKey(recoveryKey), buf(fromB64(record.wrappedPrivateKey)));
  } catch {
    throw new Error('Wrong recovery key');
  }
  const priv = await subtle().importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
  return unwrapWithPrivateKey(record.wrappedDataKey, priv);
}

/** A short fingerprint of a public key, for people to compare out of band. */
export async function keyFingerprint(publicKeySpki: string): Promise<string> {
  const h = hexOf(await subtle().digest('SHA-256', buf(fromB64(publicKeySpki))));
  return h.slice(0, 16).match(/.{4}/g)!.join(' ');
}

/** What a blob belongs to; must match on open. */
export type SealedKind = 'structure' | 'payslip' | 'run' | 'declaration';
export const aadFor = (org: string, kind: SealedKind, id: string) => `sowaka-payroll:v1:${org}:${kind}:${id}`;

export async function seal(dataKey: CryptoKey, keyVersion: number, value: unknown, aad: string): Promise<Sealed> {
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8(aad)) }, dataKey, buf(utf8(JSON.stringify(value))));
  return { v: 1, keyVersion, iv: toB64(iv), ct: toB64(ct) };
}

export async function open<T>(dataKey: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(sealed.iv)), additionalData: buf(utf8(aad)) }, dataKey, buf(fromB64(sealed.ct)));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** A value only the holder of `publicKeySpki`'s private key can read (an employee's own payslip). */
export async function sealForPerson(value: unknown, publicKeySpki: string, aad: string): Promise<SealedForPerson> {
  const key = await createDataKey();
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8(aad)) }, key, buf(utf8(JSON.stringify(value))));
  return { v: 1, wrappedKey: await wrapForPublicKey(key, publicKeySpki), iv: toB64(iv), ct: toB64(ct) };
}

export async function openForPerson<T>(sealed: SealedForPerson, privateKey: CryptoKey, aad: string): Promise<T> {
  const key = await unwrapWithPrivateKey(sealed.wrappedKey, privateKey);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(sealed.iv)), additionalData: buf(utf8(aad)) }, key, buf(fromB64(sealed.ct)));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// —— What is sealed, per record ——

/** A salary structure's amounts. Everything else on the record stays plain (template, status, switches). */
export interface StructureSecret {
  annualCtcPaise: number;
  componentValues?: Record<string, number>;
  overrides?: unknown;
  revisions?: unknown[];
  pfRestrictedWagePaise?: number;
}

/** A tax declaration's amounts and flags; the regime and proof status stay plain. */
export interface DeclarationSecret {
  declarations: Record<string, number | boolean>;
}

/** The org's recovery state as stored: the keypair plus the current data key wrapped to it. */
export interface OrgRecovery extends RecoveryRecord {
  wrappedDataKey: string;
  keyVersion: number;
}
