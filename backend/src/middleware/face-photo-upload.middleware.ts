import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { FaceIdError } from '../services/face-id.service';

// The app sends a JPEG of about 1,000 px; this leaves room for a phone that
// sends its camera's own, which is re-encoded before Rekognition sees it.
const MAX_FACE_BYTES = 8 * 1024 * 1024;

/** The selfie, and the light check's three face crops the server judges from. */
const FIELDS = ['photo', 'baseline', 'lit0', 'lit1'] as const;

const faceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FACE_BYTES, files: FIELDS.length },
}).fields(FIELDS.map((name) => ({ name, maxCount: 1 })));

/**
 * The photo of a face as `photo`, with the light check's `baseline`, `lit0`
 * and `lit1` when the app sends them, held in memory only: nothing is
 * written to disk. `photo` is also on `request.file`, as it always was.
 */
export function uploadFacePhoto(request: Request, response: Response, next: NextFunction) {
  faceUpload(request, response, (error) => {
    if (!error) {
      const files = facePhotoFiles(request);
      for (const name of FIELDS) {
        const file = files[name];
        if (file && !isImage(file.buffer)) {
          next(new FaceIdError(400, 'The photo must be a JPEG or PNG', { face: { reason: 'no_face' } }));
          return;
        }
      }
      request.file = files.photo;
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

/** Each uploaded face file by field name, whichever shape multer left them in. */
export function facePhotoFiles(request: Request): Partial<Record<(typeof FIELDS)[number], Express.Multer.File>> {
  const raw = request.files;
  const out: Partial<Record<(typeof FIELDS)[number], Express.Multer.File>> = {};
  if (!raw || Array.isArray(raw)) return out;
  for (const name of FIELDS) {
    const list = raw[name];
    if (Array.isArray(list) && list[0]) out[name] = list[0];
  }
  return out;
}

function isImage(bytes: Buffer) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return jpeg || png;
}
