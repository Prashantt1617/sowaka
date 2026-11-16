/**
 * Setup › Notification sounds and pictures (dashboard admins only): read and
 * set each kind's look, and upload a sound or a picture for one.
 *
 *   GET  /admin/notification-look            every kind, its look and the sounds to pick from
 *   PUT  /admin/notification-look            { kinds: { <kind>: look | null } } (null: Sowaka's default)
 *   POST /admin/notification-look/sounds     multipart `file` (WAV) + `name` (+ optional `key`)
 *   POST /admin/notification-look/pictures   multipart `file` (JPEG or PNG)
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardAdmin } from '../middleware/admin.middleware';
import {
  MAX_PICTURE_BYTES,
  NotificationLookError,
  adminNotificationLook,
  setNotificationLook,
  uploadNotificationPicture,
  uploadNotificationSound,
} from '../services/notification-look.service';

export const notificationLookRouter = Router();
notificationLookRouter.use(requireAuth, requireDashboardAccess, requireDashboardAdmin);

const orgOf = (req: Request) => req.auth!.user?.org ?? '';

function fail(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof NotificationLookError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
}

const oneFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PICTURE_BYTES, files: 1 } }).single('file');
function readFile(req: Request, res: Response, next: NextFunction) {
  oneFile(req, res, (error: unknown) => {
    if (!error) return next();
    const tooBig = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ success: false, message: tooBig ? 'That file is too big' : 'The upload is invalid' });
  });
}

/** What the bytes say they are: a picture's or a WAV's own header, not the browser's guess. */
function sniff(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  return 'application/octet-stream';
}

notificationLookRouter.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await adminNotificationLook(orgOf(req))) });
  } catch (error) { fail(res, next, error); }
});

notificationLookRouter.put('/', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await setNotificationLook(orgOf(req), req.auth!.userId, req.body?.kinds)) });
  } catch (error) { fail(res, next, error); }
});

notificationLookRouter.post('/sounds', readFile, async (req, res, next) => {
  try {
    if (!req.file) throw new NotificationLookError(400, 'Choose a WAV file');
    if (sniff(req.file.buffer) !== 'audio/wav') throw new NotificationLookError(400, 'A sound must be a WAV file');
    const sound = await uploadNotificationSound(orgOf(req), req.auth!.userId, {
      name: String(req.body?.name ?? req.file.originalname.replace(/\.[^.]+$/, '')),
      key: req.body?.key ? String(req.body.key) : undefined,
      bytes: req.file.buffer,
    });
    res.status(201).json({ success: true, sound });
  } catch (error) { fail(res, next, error); }
});

notificationLookRouter.post('/pictures', readFile, async (req, res, next) => {
  try {
    if (!req.file) throw new NotificationLookError(400, 'Choose a picture');
    const picture = await uploadNotificationPicture(req.auth!.userId, {
      originalName: req.file.originalname,
      contentType: sniff(req.file.buffer),
      bytes: req.file.buffer,
    });
    res.status(201).json({ success: true, ...picture });
  } catch (error) { fail(res, next, error); }
});
