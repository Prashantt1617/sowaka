import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { tabsForRequest } from '../models/dashboard-tabs';

/** Whether this person may open every tab: an admin, or nobody ever limited them. */
export function hasAllDashboardTabs(user: { dashboardAdmin?: boolean; dashboardTabs?: string[] } | undefined): boolean {
  return user?.dashboardAdmin === true || !Array.isArray(user?.dashboardTabs);
}

/**
 * After `requireDashboardAccess`: refuses the APIs behind tabs this person
 * was not given in People › Accesses. Admins and anyone never limited pass.
 */
export function requireDashboardTabs(req: Request, res: Response, next: NextFunction) {
  const user = req.auth?.user;
  if (hasAllDashboardTabs(user)) return next();
  const needed = tabsForRequest(req.method, (req.originalUrl || req.url).split('?')[0]);
  if (needed === null) return next();
  const mine = new Set(user?.dashboardTabs ?? []);
  if (needed.some((tab) => mine.has(tab))) return next();
  logger.warn('Dashboard tab access denied', requestContext(req, 403));
  res.status(403).json({ success: false, message: "You don't have access to this part of the dashboard", requestId: req.requestId });
}

/** People › Accesses itself: only a dashboard admin. */
export function requireDashboardAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.user?.dashboardAdmin === true) return next();
  logger.warn('Dashboard admin required', requestContext(req, 403));
  res.status(403).json({ success: false, message: 'Only a dashboard admin can manage accesses', requestId: req.requestId });
}

/**
 * Gates the HR dashboard's org-wide + override endpoints. Runs AFTER `requireAuth`,
 * so it relies on `req.auth.dashboardAccess` (set from the user's `dashboardAccess`
 * flag). Only select users in an org are granted this.
 */
export function requireDashboardAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.userId) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      requestId: req.requestId,
    });
    return;
  }
  if (req.auth.dashboardAccess !== true) {
    logger.warn('Dashboard access denied', requestContext(req, 403));
    res.status(403).json({
      success: false,
      message: 'You do not have HR dashboard access',
      requestId: req.requestId,
    });
    return;
  }
  next();
}

function requestContext(req: Request, statusCode: number) {
  return {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
  };
}
