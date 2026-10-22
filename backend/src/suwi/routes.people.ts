/**
 * Suwi's People routes, mounted under /suwi: the risk line on People › Import.
 * Dashboard users only; the import itself is a dashboard admin's page, and the
 * service checks that too.
 */
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { importRiskFor } from './importRisk';

export const suwiPeopleRouter = Router();
suwiPeopleRouter.use(requireAuth, requireDashboardAccess);

const fail = (res: Response, e: unknown, next: NextFunction) => {
  const code = (e as { statusCode?: number }).statusCode;
  if (code) { res.status(code).json({ success: false, message: (e as Error).message }); return; }
  next(e);
};

suwiPeopleRouter.get('/import-risk/:importId', async (req: Request, res, next) => {
  try { res.json({ success: true, ...(await importRiskFor(req.auth!.user!.userId, String(req.params.importId))) }); } catch (e) { fail(res, e, next); }
});
