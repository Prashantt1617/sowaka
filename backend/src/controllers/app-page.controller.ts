import { NextFunction, Request, Response } from 'express';
import { appPageFor } from '../services/app-page.service';
import { orgForUser } from '../services/connect.service';

/**
 * `GET /app-pages/:key`: the page when it is on for the viewer's company,
 * else 404 and the app keeps its native screen. Never cached by anything in
 * between: it is behind a session and changes whenever Sowaka uploads it.
 */
export async function appPageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.set('Cache-Control', 'no-store');
    // The company as the rest of the app places people: by the org field, or
    // for older accounts by their email's domain.
    const user = req.auth?.user;
    const page = await appPageFor(user ? orgForUser(user) : undefined, String(req.params.key ?? ''));
    if (!page) {
      res.status(404).json({ success: false, message: 'No page here', requestId: req.requestId });
      return;
    }
    res.json({ success: true, version: page.version, html: page.html });
  } catch (error) {
    next(error);
  }
}
