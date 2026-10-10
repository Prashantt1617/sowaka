import { Router } from 'express';
import { leaderboard, personProfile, pointsActivity } from '../controllers/profile.controller';
import { requireAuth } from '../middleware/auth.middleware';

/**
 * What a profile shows beyond the workspace: the company's leaderboard, one's
 * own credit history, and a colleague's public profile. Every read is scoped
 * to the caller's own company.
 */
export const profileRouter = Router();
profileRouter.use(requireAuth);
profileRouter.get('/leaderboard', leaderboard);
profileRouter.get('/points/activity', pointsActivity);
profileRouter.get('/people/:userId', personProfile);
