import { NextFunction, Request, Response } from 'express';
import {
  catalogFor,
  GameCatalogError,
  GameViewer,
  leaderboardFor,
  pageFor,
  publicPageFor,
  submitScore,
} from '../services/game-catalog.service';
import { gamesHomeFor, parsePeriod, pointsLeaderboardFor } from '../services/games-home.service';
import { loadEvent } from '../services/cup.service';
import { mintTicket, verifyTicket } from '../services/scribble-ticket.service';

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
  // 'self': photos come from this host's /media (the Cup's players), which is plain http on a local test.
  "img-src 'self' data: blob: https:",
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
    const viewer = viewerOf(req);
    const key = keyOf(req);
    const { html, version } = await pageFor(viewer, key);
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
      .send(TICKETED[key] ? withGameTicket(key, html, viewer, true) : html);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------- live games' tickets

const SCRIBBLE_KEY = 'scribble';
const SQUAD_KEY = 'secret-squad';
const CUP_KEY = 'diwali-cup';

/** The live games whose page carries a socket ticket: the marker it leaves, and the global it gets. */
const TICKETED: Record<string, { marker: string; global: string; name: string }> = {
  [SCRIBBLE_KEY]: { marker: '<!--SCRIBBLE-TICKET-->', global: '__SCRIBBLE', name: 'Scribble' },
  [SQUAD_KEY]: { marker: '<!--SQUAD-TICKET-->', global: '__SQUAD', name: 'Secret Squad' },
  // The Diwali Cup's page talks to `/cup/api` with its ticket, after the same reload.
  [CUP_KEY]: { marker: '<!--CUP-TICKET-->', global: '__CUP', name: 'the tournament' },
};

/** A JavaScript literal safe inside a `<script>` element (`<` can never close it). */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Puts `payload` into the page where it left its marker, as the game's global. */
function withGlobal(key: string, html: string, payload: Record<string, unknown>): string {
  const spec = TICKETED[key];
  if (!spec || !html.includes(spec.marker)) return html;
  // A function replacer: a `$&` in the ticket is text, not a replacement pattern.
  const script = `<script>window.${spec.global}=${scriptJson(payload)}</script>`;
  return html.replace(spec.marker, () => script);
}

/**
 * The ticket the page's socket presents and, on the copy the app loads as a
 * string, a short-lived hop token for the reload that escapes the app's
 * policy (Scribble's PROTOCOL.md §1–2). A page without the marker is unchanged.
 */
function withGameTicket(key: string, html: string, viewer: GameViewer, withHop: boolean): string {
  if (!viewer.org) return html;
  const subject = { userId: viewer.userId, org: viewer.org, name: viewer.name };
  const payload: Record<string, string> = { ticket: mintTicket(subject) };
  if (withHop) payload.hopTicket = mintTicket(subject, { kind: 'hop' });
  if (key === CUP_KEY) payload.from = 'games';
  return withGlobal(key, html, payload);
}

/** The host the request was made to, as the browser sees it, for the policy. */
function requestHost(req: Request): string {
  const forwarded = req.get('x-forwarded-host');
  const host = (forwarded ?? req.get('host') ?? '').split(',')[0].trim();
  return /^[A-Za-z0-9.\-[\]:]+$/.test(host) ? host : '';
}

/**
 * The copy of Scribble the page reloads itself onto, `GET /play/scribble?ticket=<hop>`,
 * with no session: the hop token is the credential. The same page, with a
 * fresh ticket in it, under a policy that lets it reach this server's socket
 * and nothing else. A bad or stale token gets a plain 401; the page cannot
 * recover from one and the person closes and reopens Scribble.
 */
export async function scribbleHopHandler(req: Request, res: Response, next: NextFunction) {
  const key = keyOf(req);
  const spec = TICKETED[key];
  if (!spec || typeof req.query.ticket !== 'string') {
    next();
    return;
  }
  try {
    const verdict = verifyTicket(req.query.ticket, 'hop');
    if (!verdict.ok) {
      res
        .status(401)
        .set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' })
        .type('text/plain')
        .send(verdict.error === 'ticket_expired' ? `This ${spec.name} link has expired. Close and reopen ${spec.name}.` : `Close and reopen ${spec.name}.`);
      return;
    }
    const viewer: GameViewer = { userId: verdict.ticket.userId, org: verdict.ticket.org, name: verdict.ticket.name };
    const { html, version } = await pageFor(viewer, key);
    const host = requestHost(req);
    const sockets = host ? ` https://${host} wss://${host} http://${host} ws://${host}` : '';
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        // The token is in this page's URL: it must not travel on to fonts or images.
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': PAGE_CSP.replace("connect-src 'none'", `connect-src 'self'${sockets}`),
        'X-Game-Version': version,
      })
      .send(withGameTicket(key, html, viewer, false));
  } catch (error) {
    next(error);
  }
}

/**
 * The Diwali Cup from its feed post, `GET /cup/<event>?ticket=<cup-link>`: the
 * app opens the post's link as an ordinary page (no session, no bridge), and
 * the link is the viewer's own (see `cupLinkFor`). The page comes with a
 * ticket for `/cup/api` and the event it is about, under a policy that lets
 * it reach this server and nothing else. A bad or stale link gets a plain 401.
 */
export async function cupLinkPageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const verdict = verifyTicket(req.query.ticket, 'cup-link');
    const eventId = String(req.params.eventId ?? '');
    const event = verdict.ok && /^[A-Za-z0-9_-]{1,80}$/.test(eventId) ? await loadEvent(eventId) : null;
    if (!verdict.ok || !event || event.org !== verdict.ticket.org) {
      res
        .status(401)
        .set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' })
        .type('text/plain')
        .send(`This link has expired. Go back and open ${event?.name ?? 'the tournament'} again.`);
      return;
    }
    const page = await publicPageFor(event.catalogKey);
    if (!page) {
      res.status(404).type('text/plain').send(`${event.name} is not available here yet.`);
      return;
    }
    const subject = { userId: verdict.ticket.userId, org: verdict.ticket.org, name: '' };
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': PAGE_CSP.replace("connect-src 'none'", "connect-src 'self'"),
        'X-Game-Version': page.version,
      })
      .send(withGlobal(CUP_KEY, page.html, { ticket: mintTicket(subject), eventId: event.id, from: 'feed' }));
  } catch (error) {
    next(error);
  }
}

/**
 * Secret Squad in a phone browser, `GET /squad`: the same page with no
 * session, which signs itself in by email code (same origin, so no CORS) and
 * connects with the token it gets. Its policy lets it reach this server only.
 */
export async function squadWebHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await publicPageFor(SQUAD_KEY);
    if (!page) {
      res.status(404).type('text/plain').send('Secret Squad is not available here yet.');
      return;
    }
    const host = requestHost(req);
    const sockets = host ? ` https://${host} wss://${host} http://${host} ws://${host}` : '';
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': PAGE_CSP
          .replace("connect-src 'none'", `connect-src 'self'${sockets}`)
          .replace("form-action 'none'", "form-action 'self'"),
        'X-Game-Version': page.version,
      })
      .send(withGlobal(SQUAD_KEY, page.html, { web: true }));
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
