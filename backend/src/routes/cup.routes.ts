import { Router } from 'express';
import { cupLinkPageHandler } from '../controllers/game-catalog.controller';
import {
  entrantsHandler,
  finalHandler,
  joinHandler,
  liveHandler,
  photoHandler,
  soloHandler,
  stateHandler,
} from '../controllers/cup.controller';
// Importing the bets module also fills the engine's `cupHooks` (settle on decide, ride on replay, refund on void, bets in state).
import { myBetsHandler, placeBetHandler, voidMatchHandler } from '../services/cup-bets.service';

/**
 * The Diwali Cup. `/cup/api/*` is the page's own API, signed in by the
 * ticket in `X-Cup-Ticket` (never the session); `/cup/<event>?ticket=` is the
 * page itself, opened from the feed post with the viewer's own link.
 */
export const cupRouter = Router();
cupRouter.get('/api/state', stateHandler);
cupRouter.get('/api/entrants', entrantsHandler);
cupRouter.get('/api/photo/:eventId/:userId', photoHandler);
cupRouter.post('/api/matches/:id/join', joinHandler);
cupRouter.post('/api/matches/:id/solo', soloHandler);
cupRouter.post('/api/matches/:id/live', liveHandler);
cupRouter.post('/api/matches/:id/final', finalHandler);
// HR's void: the engine replays the match, and its bets are refunded (reconciled once more here).
cupRouter.post('/api/matches/:id/void', voidMatchHandler);
cupRouter.post('/api/bets', placeBetHandler);
cupRouter.get('/api/bets/mine', myBetsHandler);
cupRouter.get('/:eventId', cupLinkPageHandler);
