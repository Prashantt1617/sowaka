import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { FaceIdError } from '../services/face-id.service';

// The app sends a JPEG of about 1,000 px; this leaves room for a phone that
// sends its camera's own, which is re-encoded before Rekognition sees it.
const MAX_FACE_BYTES = 8 * 1024 * 1024;

const faceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FACE_BYTES, files: 1 },
}).single('photo');

/** One photo of a face, as `photo`, held in memory only: it is never written to disk. */
export function uploadFacePhoto(request: Request, response: Response, next: NextFunction) {
  faceUpload(request, response, (error) => {
    if (!error) {
      if (request.file && !isImage(request.file.buffer)) {
        next(new FaceIdError(400, 'The photo must be a JPEG or PNG', { face: { reason: 'no_face' } }));
        return;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new FaceIdError(413, `The photo must be ${MAX_FACE_BYTES / 1024 / 1024} MB or smaller`));
      return;
    }
    next(new FaceIdError(400, error instanceof Error ? error.message : 'Photo upload is invalid'));
  });
}

function isImage(bytes: Buffer) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return jpeg || png;
}
