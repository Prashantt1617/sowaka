import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { cupTvStateHandler, cupTvVoidHandler } from '../services/cup-bets.service';

/**
 * The Diwali Cup on the office TV (dashboard › Connect › Cup TV): the same
 * state a Cup page polls, and HR's void. HR only (dashboard access with
 * every tab), checked by the handlers.
 */
export const cupAdminRouter = Router();
cupAdminRouter.use(requireAuth, requireDashboardAccess);
cupAdminRouter.get('/state', cupTvStateHandler);
cupAdminRouter.get('/:eventId/state', cupTvStateHandler);
cupAdminRouter.post('/matches/:id/void', cupTvVoidHandler);
