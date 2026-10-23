import { Router } from 'express';
import { cupLinkPageHandler } from '../controllers/game-catalog.controller';
import {
  entrantsHandler,
  finalHandler,
  joinHandler,
  liveHandler,
  soloHandler,
  stateHandler,
  voidHandler,
} from '../controllers/cup.controller';
// TODO(cup-bets, Agent 4): mount the bet handlers and load the hooks, e.g.
//   import { placeBetHandler, myBetsHandler } from '../services/cup-bets.service';
// Importing that module sets `cupHooks` (settle on decide, ride on replay, refund on void, bets in state).

/**
 * The Diwali Cup. `/cup/api/*` is the page's own API, signed in by the
 * ticket in `X-Cup-Ticket` (never the session); `/cup/<event>?ticket=` is the
 * page itself, opened from the feed post with the viewer's own link.
 */
export const cupRouter = Router();
cupRouter.get('/api/state', stateHandler);
cupRouter.get('/api/entrants', entrantsHandler);
cupRouter.post('/api/matches/:id/join', joinHandler);
cupRouter.post('/api/matches/:id/solo', soloHandler);
cupRouter.post('/api/matches/:id/live', liveHandler);
cupRouter.post('/api/matches/:id/final', finalHandler);
cupRouter.post('/api/matches/:id/void', voidHandler);
// cupRouter.post('/api/bets', placeBetHandler);
// cupRouter.get('/api/bets/mine', myBetsHandler);
cupRouter.get('/:eventId', cupLinkPageHandler);
