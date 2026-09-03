import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ConnectError } from '../services/connect.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
}).fields([
  { name: 'media', maxCount: 6 },
  { name: 'pollOptionImages', maxCount: 4 },
]);

export function uploadConnectPostMedia(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error) => {
    if (!error) {
      const files = (request.files ?? {}) as Record<string, Express.Multer.File[]>;
      for (const file of [...(files.media ?? []), ...(files.pollOptionImages ?? [])]) {
        const contentType = detectContentType(file.buffer);
        if (!contentType) {
          next(new ConnectError(400, 'Media must be a JPEG, PNG, WEBP, MP4, or MOV file'));
          return;
        }
        file.mimetype = contentType;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new ConnectError(413, 'Media must be 50 MB or smaller'));
      return;
    }
    next(new ConnectError(400, error instanceof Error ? error.message : 'Media upload is invalid'));
  });
}

function detectContentType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, pngSignature.length).equals(pngSignature)) return 'image/png';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const brand = bytes.subarray(4, 12).toString('ascii');
  if (brand.startsWith('ftyp')) {
    if (brand.includes('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  return undefined;
}
