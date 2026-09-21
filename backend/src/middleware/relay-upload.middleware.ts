import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { RelayError } from '../services/relay-import.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('file');

export function uploadRelayFile(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error) => {
    if (!error) {
      if (request.file && !isAllowedRelayFile(request.file)) {
        next(new RelayError(400, 'Upload must be a CSV or XLSX file'));
        return;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new RelayError(413, 'Upload must be 5 MB or smaller'));
      return;
    }
    next(new RelayError(400, error instanceof Error ? error.message : 'Upload is invalid'));
  });
}

function isAllowedRelayFile(file: Express.Multer.File) {
  const name = file.originalname.toLowerCase();
  return (
    name.endsWith('.csv') ||
    name.endsWith('.xlsx') ||
    file.mimetype === 'text/csv' ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

const videoUpload = multer({
  storage: multer.memoryStorage(),
  // Instructions, not a feature film.
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
}).single('video');

export function uploadRelayVideo(request: Request, response: Response, next: NextFunction) {
  videoUpload(request, response, (error) => {
    if (!error) {
      if (request.file && !request.file.mimetype.startsWith('video/')) {
        next(new RelayError(400, 'The instructions file must be a video'));
        return;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new RelayError(413, 'The instructions video must be 60 MB or smaller'));
      return;
    }
    next(new RelayError(400, error instanceof Error ? error.message : 'Upload is invalid'));
  });
}
