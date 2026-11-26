import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextFunction, Request, Response, Router } from 'express';
import { logger } from '../utils/logger';
import { clientIp } from './portal.routes';
import { publicTvFor, rateLimitTv, resolveTvToken, tvAnswer, tvFace, TvLimited } from '../services/cup-tv-public.service';

/**
 * The tournament TV on a public link (see cup-tv-public.service): mounted at
 * `/cup/tv`, under the `/cup` path the tournament's feed link and page
 * already take through CloudFront to this server.
 *
 *   GET /cup/tv/<token>                       the page (game-pages/cup-tv.html); ?stream=1 for the stream view
 *   GET /cup/tv/<token>/state?h=&pv=          its poll, every 2.5 s
 *   GET /cup/tv/<token>/face/<pid>/<v>.webp   a face, the engine's small thumbnail
 */
export const cupTvPublicRouter = Router();

const PAGE_FILE = process.env.CUP_TV_PAGE_FILE || path.resolve(__dirname, '../../game-pages/cup-tv.html');
let page: { html: string; csp: string } | null = null;

/** The page, read once; its policy allows its own inline script by hash only (names are drawn as text, never as markup). */
function pageOf() {
  if (page) return page;
  const html = readFileSync(PAGE_FILE, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  const csp = [
    "default-src 'none'",
    `script-src ${scripts.join(' ') || "'none'"}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  page = { html, csp };
  return page;
}

const PRIVATE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
const GONE = 'This TV link has expired. Ask the host for a new one.';

const tokenOf = (req: Request) => String(req.params.token ?? '');

function failed(error: unknown, res: Response, next: NextFunction, json: boolean) {
  if (error instanceof TvLimited) {
    res.status(429).set({ ...PRIVATE, 'Retry-After': '20' });
    if (json) res.json({ success: false, message: 'Too many requests. Wait a little.' });
    else res.type('text/plain').send('Too many requests. Wait a little.');
    return;
  }
  next(error);
}

cupTvPublicRouter.get('/:token', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    rateLimitTv('page', ip);
    const link = await resolveTvToken(tokenOf(req), ip);
    if (!link) {
      res.status(404).set(PRIVATE).type('text/plain').send(GONE);
      return;
    }
    const { html, csp } = pageOf();
    res.status(200).set({ ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }).send(html);
  } catch (error) {
    failed(error, res, next, false);
  }
});

cupTvPublicRouter.get('/:token/state', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    const link = await resolveTvToken(tokenOf(req), ip);
    if (!link) {
      res.status(404).set(PRIVATE).json({ success: false, gone: true, message: GONE });
      return;
    }
    rateLimitTv('state', ip, link.eventId);
    const tv = await publicTvFor(link);
    res.status(200).set({ ...PRIVATE, 'Content-Type': 'application/json; charset=utf-8' }).send(tvAnswer(tv, { h: req.query.h, pv: req.query.pv }));
  } catch (error) {
    if (!(error instanceof TvLimited)) logger.error('Cup TV state failed', {}, error);
    failed(error, res, next, true);
  }
});

cupTvPublicRouter.get('/:token/face/:pid/:file', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    rateLimitTv('face', ip);
    const link = await resolveTvToken(tokenOf(req), ip);
    const v = String(req.params.file ?? '').replace(/\.webp$/, '');
    const bytes = link ? await tvFace(link, String(req.params.pid ?? ''), v) : null;
    if (!bytes) {
      res.status(404).set({ ...PRIVATE, 'Cache-Control': 'no-store' }).json({ success: false, message: 'No photo' });
      return;
    }
    // The browser keeps it (one address per photo); no shared cache does, so an expired link shows nothing more.
    res
      .status(200)
      .set({ ...PRIVATE, 'Content-Type': 'image/webp', 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=86400, immutable' })
      .send(bytes);
  } catch (error) {
    failed(error, res, next, true);
  }
});
