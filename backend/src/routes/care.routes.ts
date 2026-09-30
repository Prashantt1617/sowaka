import { Router } from 'express';
import {
  addEntryHandler,
  catalogHandler,
  deleteEntryHandler,
  deleteWritingHandler,
  listJournalHandler,
  listWritingsHandler,
  putWritingHandler,
  publicCatalogHandler,
  updateEntryHandler,
} from '../controllers/care.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Care, from the app: the media catalogue and the person's own writing.
 * Every handler checks the caller's company shows the Care tab.
 */
export const careRouter = Router();
// The catalogue of media and topic text holds nothing personal, and the web
// pages for Move, Breathe, Listen and Sleep read it without a sign-in.
careRouter.get('/public-catalog', publicCatalogHandler);
careRouter.use(requireAuth);
careRouter.get('/catalog', catalogHandler);
careRouter.get('/journal', listJournalHandler);
careRouter.post('/journal', addEntryHandler);
careRouter.put('/journal/:id', updateEntryHandler);
careRouter.delete('/journal/:id', deleteEntryHandler);
// Kept writing, by key: ?prefix=letter: lists the letters, and so on.
careRouter.get('/writings', listWritingsHandler);
careRouter.put('/writings/:key', putWritingHandler);
careRouter.delete('/writings/:key', deleteWritingHandler);
