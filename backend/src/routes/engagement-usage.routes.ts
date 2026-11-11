import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';
import { AdminError } from '../services/admin.service';
import { remindPeople, usageSummary, usageTrend, usageWhen } from '../services/engagement-usage.service';

/** Dashboard › Engagement › Usage: mounted at /admin/engagement/usage. */
export const engagementUsageRouter = Router();
engagementUsageRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);


/** The signed-in HR user and their org; every query below is scoped to it. */
function callerOf(req: Request): { userId: string; org: string } {
  const user = req.auth?.user;
  if (!user?.org) throw new AdminError(403, 'No organisation on this account');
  return { userId: user.userId, org: user.org };
}

/** Everyone, with what they did in the range: funnel, requests, active usage, status, what they use. */
engagementUsageRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, summary: await usageSummary(callerOf(req), req.query) });
  } catch (error) {
    next(error);
  }
});

/** When people open the app: hours of the day and weekdays, for a department and location. */
engagementUsageRouter.get('/when', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, when: await usageWhen(callerOf(req).org, req.query) });
  } catch (error) {
    next(error);
  }
});

/** Active people per day, week or month, by attendance group. */
engagementUsageRouter.get('/trend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, trend: await usageTrend(callerOf(req).org, req.query) });
  } catch (error) {
    next(error);
  }
});

/** One push to people who have gone quiet; HR confirms the count first. */
engagementUsageRouter.post('/remind', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await remindPeople(callerOf(req), req.body ?? {})) });
  } catch (error) {
    next(error);
  }
});
