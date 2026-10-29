import { Router } from 'express';
import { challenge, enrol, faceStatus, fallback, livenessSession, phoneLog, verify } from '../controllers/face.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadFacePhoto } from '../middleware/face-photo-upload.middleware';

/**
 * Face ID in the app: set up once, checked before a geotagged punch-in. The
 * check hands back a single-use token the punch spends; see face-id.service.
 */
export const faceRouter = Router();
faceRouter.use(requireAuth);
faceRouter.get('/status', faceStatus);
faceRouter.post('/enrol', uploadFacePhoto, enrol);
// The light check for the next selfie: its id and colours, used once.
faceRouter.post('/challenge', challenge);
faceRouter.post('/liveness-session', livenessSession);
faceRouter.post('/verify', uploadFacePhoto, verify);
faceRouter.post('/fallback', fallback);
// What the phone measured on one try, pass or fail: the prompts' time, the colour flashes, the screen detector.
faceRouter.post('/phone-log', phoneLog);
