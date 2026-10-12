import { Router } from 'express';
import { appPageHandler } from '../controllers/app-page.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Pages the app shows inside its own tabs, fetched with the person's session:
 * today the Games tab's home. Written with `src/scripts/app-pages.ts`.
 */
export const appPagesRouter = Router();
appPagesRouter.use(requireAuth);
appPagesRouter.get('/:key', appPageHandler);
