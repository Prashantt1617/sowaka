import { NextFunction, Request, Response } from 'express';
import {
  catalogFor,
  GameCatalogError,
  GameViewer,
  leaderboardFor,
  pageFor,
  submitScore,
} from '../services/game-catalog.service';
import { gamesHomeFor, parsePeriod, pointsLeaderboardFor } from '../services/games-home.service';

function viewerOf(req: Request): GameViewer {
  const user = req.auth?.user;
  if (!req.auth?.userId || !user) throw new GameCatalogError(401, 'Authentication required');
  return { userId: req.auth.userId, name: user.name, org: user.org };
}

const keyOf = (req: Request) => String(req.params.key ?? '');

/**
 * What a directly opened page may do. The app loads the page itself and
 * these never reach it there; they matter only to anyone fetching it as a
 * document, who gets a page that can run its own inline code and nothing else.
 */
const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob: https:',
  'media-src data: blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export async function catalogHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, games: await catalogFor(viewerOf(req)) });
  } catch (error) {
    next(error);
  }
}

export async function playHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { html, version } = await pageFor(viewerOf(req), keyOf(req));
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        // Behind a session, and replaced whenever Sowaka updates the game.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': PAGE_CSP,
        'X-Game-Version': version,
      })
      .send(html);
  } catch (error) {
    next(error);
  }
}

export async function submitScoreHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await submitScore(viewerOf(req), keyOf(req), req.body?.score)) });
  } catch (error) {
    next(error);
  }
}

export async function leaderboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await leaderboardFor(viewerOf(req), keyOf(req))) });
  } catch (error) {
    next(error);
  }
}

/** The Games home in one round trip; see `gamesHomeFor`. */
export async function homeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await gamesHomeFor(viewerOf(req).userId)) });
  } catch (error) {
    next(error);
  }
}

/** The company's individuals by engagement points, `?period=week|all`. */
export async function pointsLeaderboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const period = parsePeriod(req.query.period);
    res.json({ success: true, ...(await pointsLeaderboardFor(viewerOf(req).userId, period)) });
  } catch (error) {
    next(error);
  }
}
