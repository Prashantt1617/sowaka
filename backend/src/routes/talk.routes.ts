import { Router } from 'express';
import {
  availabilityHandler,
  bookSessionHandler,
  listCounsellorsHandler,
  listSessionsHandler, checkInHandler, reviewHandler } from '../controllers/talk.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Talk, from the app. Every handler checks that the caller's company shows the
 * Talk tab, so a company without it gets a 403 even with a valid session.
 */
export const talkRouter = Router();
talkRouter.use(requireAuth);
talkRouter.get('/counsellors', listCounsellorsHandler);
// ?date=YYYY-MM-DD — who is free when, on that day.
talkRouter.get('/availability', availabilityHandler);
talkRouter.get('/sessions', listSessionsHandler);
talkRouter.post('/sessions', bookSessionHandler);
talkRouter.put('/sessions/:sessionId/check-in', checkInHandler);
talkRouter.put('/sessions/:sessionId/review', reviewHandler);
