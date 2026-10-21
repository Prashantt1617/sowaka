/**
 * End-to-end encryption of salary data, WebCrypto only, so the same code
 * runs in the dashboard (browser) and in Node scripts (globalThis.crypto).
 * The server stores what this produces and never holds a key that opens it.
 *
 *   passphrase ──PBKDF2-SHA256 (600k)──▶ KEK ──AES-GCM──▶ user's RSA-OAEP private key
 *   org payroll data key (AES-256-GCM, random)
 *     ├─ wrapped to each payroll user's RSA-OAEP-3072 public key   (grants)
 *     └─ wrapped with the org's recovery key (256-bit, shown once)
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
async function recoveryAesKey(recoveryKey: string): Promise<CryptoKey> {
  const hex = recoveryKey.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 64) throw new Error('A recovery key is 64 hex characters');
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return subtle().importKey('raw', buf(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function wrapWithRecovery(dataKey: CryptoKey, recoveryKey: string): Promise<{ wrapped: string; iv: string }> {
  const iv = random(12);
  const raw = await subtle().exportKey('raw', dataKey);
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8('payroll-recovery')) }, await recoveryAesKey(recoveryKey), raw);
  return { wrapped: toB64(wrapped), iv: toB64(iv) };
}
export async function unwrapWithRecovery(w: { wrapped: string; iv: string }, recoveryKey: string): Promise<CryptoKey> {
  let raw: ArrayBuffer;
  try {
    raw = await subtle().decrypt({ name: 'AES-GCM', iv: buf(fromB64(w.iv)), additionalData: buf(utf8('payroll-recovery')) }, await recoveryAesKey(recoveryKey), buf(fromB64(w.wrapped)));
  } catch {
    throw new Error('Wrong recovery key');
  }
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** What a blob belongs to; must match on open. */
export const aadFor = (org: string, kind: 'structure' | 'payslip' | 'run', id: string) => `sowaka-payroll:v1:${org}:${kind}:${id}`;

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
