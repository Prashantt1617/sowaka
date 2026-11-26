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
const GONE = "This link isn't active. Ask the host for the current one.";
/**
 * A calm screen and nothing more: a removed tournament's link ("has ended"), or a token that
 * isn't (or is no longer) a link. 200, never 404/403: the livetv CloudFront turns those into the
 * dashboard's page.
 */
const calmPage = (title: string, line: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tournament TV</title><style>html,body{margin:0;height:100%;background:#15122B;color:#F6F1FF;font-family:system-ui,-apple-system,sans-serif}body{display:grid;place-items:center;text-align:center;padding:0 24px}h1{font-size:clamp(28px,5vw,64px);margin:0 0 12px}p{margin:0;color:#A9A3CC;font-size:clamp(16px,2vw,24px)}</style></head><body><div><h1>${title}</h1><p>${line}</p></div></body></html>`;
const ENDED_PAGE = calmPage('This tournament has ended', 'Thanks for watching.');
const INACTIVE_PAGE = calmPage('This link isn’t active', 'Ask the host for the current one.');
const ENDED_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
    if (!link || link.ended) {
      res.status(200).set({ ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ENDED_CSP }).send(link ? ENDED_PAGE : INACTIVE_PAGE);
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
      res.status(410).set(PRIVATE).json({ success: false, gone: true, message: GONE });
      return;
    }
    if (link.ended) {
      res.status(410).set(PRIVATE).json({ success: false, ended: true, message: 'This tournament has ended.' });
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
    const bytes = link && !link.ended ? await tvFace(link, String(req.params.pid ?? ''), v) : null;
    if (!bytes) {
      res.status(410).set({ ...PRIVATE, 'Cache-Control': 'no-store' }).json({ success: false, message: 'No photo' });
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
