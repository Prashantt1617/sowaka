import { Router } from 'express';
import {
  addEntryHandler,
  catalogHandler,
  deleteEntryHandler,
  listJournalHandler,
  updateEntryHandler,
} from '../controllers/care.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Care, from the app: the media catalogue and the person's own writing.
 * Every handler checks the caller's company shows the Care tab.
 */
export const careRouter = Router();
careRouter.use(requireAuth);
careRouter.get('/catalog', catalogHandler);
careRouter.get('/journal', listJournalHandler);
careRouter.post('/journal', addEntryHandler);
careRouter.put('/journal/:id', updateEntryHandler);
careRouter.delete('/journal/:id', deleteEntryHandler);
