import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ManagerError } from '../services/manager.service';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single('photo');

export function uploadProfilePhoto(request: Request, response: Response, next: NextFunction) {
  photoUpload(request, response, (error) => {
    if (!error) {
      if (request.file) {
        const contentType = detectContentType(request.file.buffer);
        if (!contentType) {
          next(new ManagerError(400, 'Photo must be a JPEG or PNG file'));
          return;
        }
        request.file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new ManagerError(413, 'Photo must be 5 MB or smaller'));
      return;
    }
    next(new ManagerError(400, error instanceof Error ? error.message : 'Photo upload is invalid'));
  });
}

function detectContentType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, pngSignature.length).equals(pngSignature)) return 'image/png';
  return undefined;
}
