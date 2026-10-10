import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { SupportError } from '../services/support.service';

export const SUPPORT_MAX_FILES = 5;
export const SUPPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Files on a Support desk message, as multipart field `files`: images and PDF,
 * up to five, 10 MB each. Optional: a JSON body with no files passes through
 * untouched, since multer only reads multipart requests.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SUPPORT_MAX_FILE_BYTES, files: SUPPORT_MAX_FILES },
}).array('files', SUPPORT_MAX_FILES);

export function uploadSupportFiles(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error) => {
    if (!error) {
      for (const file of (request.files ?? []) as Express.Multer.File[]) {
        // Trust the bytes, not the client's Content-Type.
        const contentType = detectContentType(file.buffer);
        if (!contentType) {
          next(new SupportError(400, 'Attachments must be a JPEG, PNG, WEBP, HEIC image or a PDF'));
          return;
        }
        file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new SupportError(413, 'Each attachment must be 10 MB or smaller'));
      return;
    }
    if (error instanceof multer.MulterError && (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE')) {
      next(new SupportError(400, `Attach at most ${SUPPORT_MAX_FILES} files, in the "files" field`));
      return;
    }
    next(new SupportError(400, error instanceof Error ? error.message : 'Upload is invalid'));
  });
}

function detectContentType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= png.length && bytes.subarray(0, png.length).equals(png)) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return undefined;
}
