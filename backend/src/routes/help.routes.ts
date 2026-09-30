import { Router } from 'express';
import {
  acceptCounsellorHandler,
  counsellorDetailHandler,
  getIntakeHandler,
  helpHomeHandler,
  saveIntakeHandler,
} from '../controllers/help.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * Help, from the app: the intake, the match and a counsellor's profile.
 * Booking itself stays on /talk. Every handler checks the caller's company
 * shows the tab, so a company without it gets a 403 even with a session.
 */
export const helpRouter = Router();
helpRouter.use(requireAuth);
helpRouter.get('/home', helpHomeHandler);
helpRouter.get('/intake', getIntakeHandler);
helpRouter.put('/intake', saveIntakeHandler);
// The closest counsellor, accepted although a preference goes unmet.
helpRouter.post('/match', acceptCounsellorHandler);
helpRouter.get('/counsellors/:userId', counsellorDetailHandler);
