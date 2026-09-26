import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AdminError } from '../services/admin.service';

// Bigger than a receipt: a scanned offer letter or an ID proof is several
// pages, and rejecting those is what would send HR back to email.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('document');

/** Reads the one file on an employee-document upload, and refuses what it cannot serve back. */
export function uploadEmployeeDocumentFile(request: Request, response: Response, next: NextFunction) {
  documentUpload(request, response, (error) => {
    if (!error) {
      if (request.file) {
        const contentType = detectContentType(request.file.buffer);
        if (!contentType) {
          next(new AdminError(400, 'Document must be a PDF, JPEG, or PNG file'));
          return;
        }
        request.file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AdminError(413, 'Document must be 10 MB or smaller'));
      return;
    }
    next(new AdminError(400, error instanceof Error ? error.message : 'Document upload is invalid'));
  });
}

// Sniffed from the bytes, not trusted from the browser: the type is what the
// file will be served back as.
function detectContentType(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, pngSignature.length).equals(pngSignature)) return 'image/png';
  return undefined;
}
