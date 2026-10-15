import { NextFunction, Request, Response, Router } from 'express';
import { companies } from '../config/db';
import { requireAuth } from '../middleware/auth.middleware';
import { orgForUser } from '../services/connect.service';
import { parsePlatform, updateFor } from '../services/app-update';

/**
 * `GET /app/update?platform=ios&version=1.3.7+40`: whether this app must
 * update ("force", a screen it cannot leave), may ("optional", closable) or
 * need not ("none"), by the person's company's rule, with the store to open.
 * Set per company with src/scripts/app-update.ts.
 */
export const appUpdateRouter = Router();
appUpdateRouter.use(requireAuth);
appUpdateRouter.get('/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.set('Cache-Control', 'no-store');
    const platform = parsePlatform(req.query.platform);
    const user = req.auth?.user;
    if (!platform || !user) {
      res.json({ success: true, mode: 'none' });
      return;
    }
    const company = await companies().findOne({ id: orgForUser(user) }, { projection: { appUpdate: 1 } });
    res.json({ success: true, ...updateFor(company?.appUpdate, platform, String(req.query.version ?? '')) });
  } catch (error) {
    next(error);
  }
});
