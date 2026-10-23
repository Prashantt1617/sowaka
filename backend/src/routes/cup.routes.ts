import { Router } from 'express';
import { cupLinkPageHandler } from '../controllers/game-catalog.controller';
import { entrantsHandler, stateHandler } from '../controllers/cup.controller';

/**
 * The Diwali Cup. `/cup/api/*` is the page's own API, signed in by the
 * ticket in `X-Cup-Ticket` (never the session); `/cup/<event>?ticket=` is the
 * page itself, opened from the feed post with the viewer's own link.
 */
export const cupRouter = Router();
cupRouter.get('/api/state', stateHandler);
cupRouter.get('/api/entrants', entrantsHandler);
cupRouter.get('/:eventId', cupLinkPageHandler);
