/**
 * Lifecycle files (CONTRACT decision 12): a `lifecycle_files` row per file; the
 * bytes in S3 under `lifecycle/<org>/<journeyId>/…` when S3 is configured,
 * else under `backend/.local-uploads/` (gitignored) on a developer's machine.
 * Never a public URL: every read goes through an endpoint that has checked the
 * caller's org (dashboard) or journey (portal) first.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { lifecycleFiles } from '../../config/db';
import type { LifecycleFile } from '../../models/lifecycle.model';
import { hasReceiptStorage } from '../s3-receipt.service';
import { s3EncryptionParams } from '../../utils/s3-encryption.util';

/** A refusal with the status the route answers with (`{ error }`). */
export class LifecycleOfferError extends Error {
  /** `details`: extra fields the route sends beside `error` (e.g. the closed portal's screen on sign-in). */
  constructor(public statusCode: number, message: string, public details?: Record<string, unknown>) { super(message); }
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type StoredContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

/** From the bytes, never the browser's word or the extension: the type is what the file is served back as. */
export function sniffContentType(bytes: Buffer): StoredContentType | undefined {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, png.length).equals(png)) return 'image/png';
  return undefined;
}

/** The upload rule for candidate documents and HR's PDFs: PDF/JPG/PNG (or only PDF), at most 10 MB. */
export function checkUpload(bytes: Buffer, opts: { pdfOnly?: boolean } = {}): StoredContentType {
  if (!bytes.length) throw new LifecycleOfferError(400, 'The file is empty');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new LifecycleOfferError(413, 'Files must be 10 MB or smaller');
  const type = sniffContentType(bytes);
  if (!type || (opts.pdfOnly && type !== 'application/pdf')) {
    throw new LifecycleOfferError(400, opts.pdfOnly ? 'The file must be a PDF' : 'Files must be a PDF, JPG or PNG');
  }
  return type;
}

const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4' };
/** backend/.local-uploads, from src/services/lifecycle or dist/services/lifecycle alike. */
const LOCAL_ROOT = path.resolve(__dirname, '../../../.local-uploads');
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client({
    region: env.s3.region,
    ...(env.s3.endpoint ? { endpoint: env.s3.endpoint } : {}),
    forcePathStyle: env.s3.forcePathStyle,
    ...(env.s3.accessKeyId && env.s3.secretAccessKey
      ? { credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey, ...(env.s3.sessionToken ? { sessionToken: env.s3.sessionToken } : {}) } }
      : {}),
  });
  return client;
}

function localPath(objectKey: string): string {
  const full = path.resolve(LOCAL_ROOT, objectKey);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error('Invalid object key');
  return full;
}

/** Stores the bytes and records the row. The object key is random; the client's name is kept on the row only. */
export async function storeFile(
  org: string,
  journeyId: string | undefined,
  file: { name: string; contentType: string; bytes: Buffer },
  uploadedBy: LifecycleFile['uploadedBy'],
): Promise<LifecycleFile> {
  const objectKey = ['lifecycle', safe(org), safe(journeyId ?? 'company'), `${randomUUID()}${EXT[file.contentType] ?? ''}`].join('/');
  if (hasReceiptStorage()) {
    await s3().send(new PutObjectCommand({
      Bucket: env.s3.bucket, Key: objectKey, Body: file.bytes, ContentType: file.contentType, ContentLength: file.bytes.length, ...s3EncryptionParams(),
    }));
  } else {
    const target = localPath(objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  const row: LifecycleFile = {
    id: randomUUID(), org, ...(journeyId ? { journeyId } : {}), objectKey,
    name: cleanName(file.name, EXT[file.contentType] ?? ''), contentType: file.contentType, size: file.bytes.length,
    uploadedAt: new Date(), uploadedBy,
  };
  await lifecycleFiles().insertOne({ ...row });
  return row;
}

function cleanName(name: string, ext: string): string {
  const base = uploadName(name).replace(/[\\/\0\r\n"]/g, '_').trim().slice(-120);
  return base || `file${ext}`;
}

/**
 * A browser sends the file name as raw UTF-8, which multer (busboy) reads as
 * latin1 unless told otherwise: "Appointment letter – Neel.pdf" arrives as
 * "Appointment letter â\u0080\u0093 Neel.pdf". The lifecycle routes set
 * `defParamCharset: 'utf8'`; this repairs a name that still arrives misread
 * (another route's upload), and leaves a real name alone: only a string made
 * of single bytes, with some above 0x7F, that decodes as valid UTF-8 is read again.
 */
/**
 * Multer options for every lifecycle upload: read the part's file name as UTF-8
 * (busboy's default is latin1). `defParamCharset` is read by multer 2 but not
 * yet in @types/multer, hence the cast.
 */
export const UTF8_FILE_NAMES = { defParamCharset: 'utf8' } as unknown as Record<never, never>;

export function uploadName(name: unknown): string {
  const raw = String(name ?? '');
  if (!/[\x80-\xff]/.test(raw) || /[^\x00-\xff]/.test(raw)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? raw : decoded;
}

// ─── PDF page counts (P4 "Accepted version · 3 pages", P12 before opening) ────

const pageCounts = new Map<string, number | null>();
/** The number of pages of a stored PDF, or undefined when it cannot be read. Cached per file (files never change). */
export async function pdfPageCount(file: Pick<LifecycleFile, 'id' | 'objectKey' | 'contentType'>): Promise<number | undefined> {
  if (file.contentType !== 'application/pdf') return undefined;
  if (!pageCounts.has(file.id)) {
    let count: number | null = null;
    try {
      const { PDFDocument } = await import('pdf-lib');
      count = (await PDFDocument.load(await readFileBytes(file), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
    } catch {
      count = null;
    }
    if (pageCounts.size > 2000) pageCounts.clear();
    pageCounts.set(file.id, count);
  }
  return pageCounts.get(file.id) ?? undefined;
}

export async function readFileBytes(file: Pick<LifecycleFile, 'objectKey'>): Promise<Buffer> {
  if (hasReceiptStorage()) {
    const out = await s3().send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: file.objectKey }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) throw new LifecycleOfferError(404, 'File not found');
    return Buffer.from(bytes);
  }
  try {
    return await readFile(localPath(file.objectKey));
  } catch {
    throw new LifecycleOfferError(404, 'File not found');
  }
}

export async function removeFile(fileId: string): Promise<void> {
  const file = await lifecycleFiles().findOne({ id: fileId });
  if (!file) return;
  await lifecycleFiles().deleteOne({ id: fileId });
  try {
    if (hasReceiptStorage()) await s3().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: file.objectKey }));
    else await rm(localPath(file.objectKey), { force: true });
  } catch {
    // The row is gone, so nothing serves it; a stray object is only storage.
  }
}

/** A file of this org (the dashboard's check), or 404: another org's file is "not found", never "forbidden". */
export async function fileForOrg(org: string, fileId: string): Promise<LifecycleFile> {
  const file = await lifecycleFiles().findOne({ id: fileId, org }, { projection: { _id: 0 } });
  if (!file) throw new LifecycleOfferError(404, 'File not found');
  return file;
}

/** A file of this journey (the portal's check), or 404. */
export async function fileForJourney(journeyId: string, fileId: string): Promise<LifecycleFile> {
  const file = await lifecycleFiles().findOne({ id: fileId, journeyId }, { projection: { _id: 0 } });
  if (!file) throw new LifecycleOfferError(404, 'File not found');
  return file;
}

export function fileMeta(file: LifecycleFile): { id: string; name: string; contentType: string; size: number } {
  return { id: file.id, name: file.name, contentType: file.contentType, size: file.size };
}

/** `inline`, with an ASCII stand-in and the real name in `filename*`. */
export function contentDisposition(name: string, download = false): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
