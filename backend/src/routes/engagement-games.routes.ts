import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { EngagementGamesError, gameDetail, gamesOverview } from '../services/engagement-games.service';

/** Dashboard › Engagement › Games: mounted at /admin/engagement/games. */
export const engagementGamesRouter = Router();
engagementGamesRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

/** The caller's company; nothing here answers without one. */
function orgOf(req: Request): string {
  const org = req.auth?.user?.org;
  if (!org) throw new EngagementGamesError(400, 'Your account is not linked to a company');
  return org;
}

// Our own errors answer here, since the shared error handler does not know them.
function fail(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof EngagementGamesError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
}

/** The line-up, everyone at the company and every play on record. */
engagementGamesRouter.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await gamesOverview(orgOf(req))) });
  } catch (error) {
    fail(res, next, error);
  }
});

/** One game: its board and its tournaments with their standings. */
engagementGamesRouter.get('/:key', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await gameDetail(orgOf(req), String(req.params.key ?? ''))) });
  } catch (error) {
    fail(res, next, error);
  }
});
