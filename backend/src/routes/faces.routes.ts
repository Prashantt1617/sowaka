import { Router } from 'express';
import { inlineFace } from '../services/face-photos';
import { logger } from '../utils/logger';

/**
 * An older account's inline photo, by the signed address services/face-photos
 * hands out in lists (`/faces/<userId>?v=&s=`). No session: images load
 * without one, as `/media` does, so the signature is what opens it.
 */
export const facesRouter = Router();

facesRouter.get('/:userId', async (req, res) => {
  // Shown by the dashboard and the web builds on other origins, as media is.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  try {
    const photo = await inlineFace(String(req.params.userId ?? ''), req.query.v, req.query.s);
    if (!photo) {
      res.status(404).set('Cache-Control', 'no-store').json({ success: false, message: 'No photo' });
      return;
    }
    res
      .status(200)
      .set({ 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' })
      .send(photo.bytes);
  } catch (error) {
    logger.error('Inline face failed', { userId: req.params.userId }, error);
    res.status(500).set('Cache-Control', 'no-store').json({ success: false, message: 'Could not read the photo' });
  }
});
