import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { EmployeePayrollError } from '../services/employeePayroll.common';
import { FORM16_MAX_BULK_FILES, FORM16_MAX_BYTES } from '../services/form16.service';

const memory = multer.memoryStorage();
const single = multer({ storage: memory, limits: { fileSize: FORM16_MAX_BYTES, files: 1 } }).single('file');
const bulk = multer({ storage: memory, limits: { fileSize: FORM16_MAX_BYTES, files: FORM16_MAX_BULK_FILES } }).array('files', FORM16_MAX_BULK_FILES);

const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString('ascii') === '%PDF-';

function finish(error: unknown, files: Express.Multer.File[], next: NextFunction) {
  if (!error) {
    // Trust the bytes, not the browser's Content-Type: anything not a PDF is marked so and refused by the service.
    for (const file of files) file.mimetype = isPdf(file.buffer) ? 'application/pdf' : 'application/octet-stream';
    next();
    return;
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(new EmployeePayrollError(413, 'Each Form 16 must be 3 MB or smaller'));
    return;
  }
  if (error instanceof multer.MulterError && (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE')) {
    next(new EmployeePayrollError(400, `Send at most ${FORM16_MAX_BULK_FILES} files at a time, as field "files"`));
    return;
  }
  next(new EmployeePayrollError(400, error instanceof Error ? error.message : 'The upload is invalid'));
}

/** One Form 16 PDF, field `file`. */
export function uploadForm16File(request: Request, response: Response, next: NextFunction) {
  single(request, response, (error) => finish(error, request.file ? [request.file] : [], next));
}

/** Up to FORM16_MAX_BULK_FILES PDFs, field `files`. */
export function uploadForm16Files(request: Request, response: Response, next: NextFunction) {
  bulk(request, response, (error) => finish(error, Array.isArray(request.files) ? request.files : [], next));
}
