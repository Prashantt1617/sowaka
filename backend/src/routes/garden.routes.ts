import { Router } from 'express';
import { gardenHandler, giveHandler, removeHandler, timelineHandler, treeHandler } from '../controllers/garden.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Gratitude Garden, from the app. Every handler checks that the caller's
 * company shows the Games tab, where the garden lives.
 */
export const gardenRouter = Router();
gardenRouter.use(requireAuth);
gardenRouter.get('/', gardenHandler);
gardenRouter.get('/timeline', timelineHandler);
gardenRouter.get('/trees/:userId', treeHandler);
gardenRouter.post('/notes', giveHandler);
gardenRouter.delete('/notes/:noteId', removeHandler);
