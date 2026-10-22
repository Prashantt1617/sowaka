/**
 * /suwi/notices and /suwi/digest: what Suwi noticed (no model call) and
 * today's morning digest. Dashboard users only; both are empty when Suwi is
 * off for the company. Mounted next to the main suwi router.
 */
import { NextFunction, Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';
import { contextFor } from './tools';
import { settingsFor } from './store';
import { noticeCounts, suwiNotices } from './notices';
import { digestFor, istToday } from './digest';

export const suwiNoticesRouter = Router();
suwiNoticesRouter.use(requireAuth, requireDashboardAccess);

const me = (req: Request) => req.auth!.user!;
const fail = (res: Response, e: unknown, next: NextFunction) => {
  const code = (e as { statusCode?: number }).statusCode;
  if (code) { res.status(code).json({ success: false, message: (e as Error).message }); return; }
  next(e);
};

suwiNoticesRouter.get('/notices', async (req, res, next) => {
  try {
    const user = me(req);
    const settings = await settingsFor(user.org!);
    if (!settings.enabled) { res.json({ success: true, enabled: false, notices: [], counts: {} }); return; }
    const notices = await suwiNotices(contextFor(user, settings.levels, istToday()));
    res.json({ success: true, enabled: true, notices, counts: noticeCounts(notices) });
  } catch (e) { fail(res, e, next); }
});

suwiNoticesRouter.get('/digest', async (req, res, next) => {
  try {
    const d = await digestFor(me(req));
    res.json({ success: true, digest: d ? { date: d.date, text: d.text, builtAt: d.builtAt.toISOString() } : null });
  } catch (e) { fail(res, e, next); }
});
