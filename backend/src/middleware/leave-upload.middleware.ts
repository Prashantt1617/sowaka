import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { LeaveError } from '../services/leave.service';

/**
 * The optional document on a leave request — a medical note, a booking
 * confirmation. Optional throughout: a leave with no attachment is the normal
 * case, so an absent file is never an error here.
 */
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('document');

export function uploadLeaveDocument(request: Request, response: Response, next: NextFunction) {
  documentUpload(request, response, (error) => {
    if (!error) {
      if (request.file) {
        // Trust the bytes, not the client's Content-Type.
        const contentType = detectContentType(request.file.buffer);
        if (!contentType) {
          next(new LeaveError(400, 'The document must be a PDF, JPEG, or PNG file'));
          return;
        }
        request.file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new LeaveError(413, 'The document must be 5 MB or smaller'));
      return;
    }
    next(new LeaveError(400, error instanceof Error ? error.message : 'Upload is invalid'));
  });
}

function detectContentType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= png.length && bytes.subarray(0, png.length).equals(png)) {
    return 'image/png';
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return undefined;
}
