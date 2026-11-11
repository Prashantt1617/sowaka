import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { contestDetail, listContests } from '../services/engagement-contests.service';
import { addPlanItem, deletePlanItem, planFor, PlanItemError, updatePlanItem } from '../services/engagement-plan.service';
import { logger } from '../utils/logger';

/** The caller's company; every query below is scoped to it. */
function orgOf(req: Request): string {
  return String(req.auth?.user?.org ?? '');
}

/** Runs a handler, answering a known error with its own status and anything else with a 500. */
function handle(fn: (req: Request) => Promise<Record<string, unknown>>) {
  return async (req: Request, res: Response) => {
    if (!orgOf(req)) {
      res.status(403).json({ success: false, message: 'No company on this account', requestId: req.requestId });
      return;
    }
    try {
      res.json({ success: true, ...(await fn(req)) });
    } catch (error) {
      if (error instanceof PlanItemError) {
        res.status(error.statusCode).json({ success: false, message: error.message, requestId: req.requestId });
        return;
      }
      logger.error('Engagement plan/contests request failed', { error: String(error), path: req.originalUrl });
      res.status(500).json({ success: false, message: 'Something went wrong', requestId: req.requestId });
    }
  };
}

/** Dashboard › Engagement › Engagement plan: mounted at /admin/engagement/plan. */
export const engagementPlanRouter = Router();
engagementPlanRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

engagementPlanRouter.get('/', handle(async (req) => planFor(orgOf(req))));
engagementPlanRouter.post('/items', handle(async (req) => ({
  item: await addPlanItem(orgOf(req), String(req.auth?.user?.userId ?? ''), (req.body ?? {}) as Record<string, unknown>),
})));
engagementPlanRouter.patch('/items/:id', handle(async (req) => ({
  item: await updatePlanItem(orgOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>),
})));
engagementPlanRouter.delete('/items/:id', handle(async (req) => {
  await deletePlanItem(orgOf(req), String(req.params.id));
  return {};
}));

/** Dashboard › Engagement › Contests: mounted at /admin/engagement/contests. */
export const engagementContestsRouter = Router();
engagementContestsRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

engagementContestsRouter.get('/', handle(async (req) => listContests(orgOf(req))));
engagementContestsRouter.get('/:id', handle(async (req) => {
  const detail = await contestDetail(orgOf(req), String(req.params.id));
  if (!detail) throw new PlanItemError(404, 'That contest is gone');
  return detail;
}));
