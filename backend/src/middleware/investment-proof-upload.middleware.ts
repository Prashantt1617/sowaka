import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { EmployeePayrollError } from '../services/employeePayroll.common';

/** The proof behind one declared investment: one PDF, JPEG or PNG of at most 5 MB, field `proof`. */
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('proof');

export function uploadInvestmentProofFile(request: Request, response: Response, next: NextFunction) {
  proofUpload(request, response, (error) => {
    if (!error) {
      if (request.file) {
        // Trust the bytes, not the client's Content-Type.
        const contentType = detectContentType(request.file.buffer);
        if (!contentType) {
          next(new EmployeePayrollError(400, 'The proof must be a PDF, JPEG or PNG file'));
          return;
        }
        request.file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new EmployeePayrollError(413, 'The proof must be 5 MB or smaller'));
      return;
    }
    next(new EmployeePayrollError(400, error instanceof Error ? error.message : 'The upload is invalid'));
  });
}

function detectContentType(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, png.length).equals(png)) return 'image/png';
  return undefined;
}
