import { NextFunction, Request, Response } from 'express';
import {
  CupError,
  entrantsFor,
  inlinePhoto,
  joinLobby,
  joinMatch,
  playWordIn,
  wordTripGameFor,
  cupThumb,
  reportFinal,
  reportLive,
  resignMatch,
  startSolo,
  stateFor,
  viewerFromTicket,
  type CupViewer,
} from '../services/cup.service';

/** The ticket a Cup page sends with every call. */
export const cupViewerOf = (req: Request): Promise<CupViewer> => viewerFromTicket(req.get('x-cup-ticket'));

/** The event a page asked about (the feed link names one), else the company's current one. */
const eventOf = (req: Request) => (typeof req.query.event === 'string' ? req.query.event : req.get('x-cup-event')) || undefined;

const noStore = (res: Response) => res.set('Cache-Control', 'private, no-store');

/** A CupError answers with its status and message; anything else goes on to the error handler. */
export function cupFailed(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof CupError) {
    noStore(res).status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
}

/** Each handler: the viewer, then the work, answered as `{ success: true, ...body }`. */
export const cupHandler =
  (work: (viewer: CupViewer, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewer = await cupViewerOf(req);
      const body = await work(viewer, req);
      if (body === undefined) {
        noStore(res).status(204).end();
        return;
      }
      noStore(res).json({ success: true, ...(body as object) });
    } catch (error) {
      cupFailed(error, res, next);
    }
  };

/** The page's poll: one JSON string, the shared part serialised once per revision. */
export async function stateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = await cupViewerOf(req);
    noStore(res).type('application/json').send(await stateFor(viewer, eventOf(req), req.query.since, req.query.pv));
  } catch (error) {
    cupFailed(error, res, next);
  }
}

const idOf = (req: Request) => String(req.params.id ?? '');

export const entrantsHandler = cupHandler((viewer, req) => entrantsFor(viewer, eventOf(req)));
export const joinHandler = cupHandler((viewer, req) => joinMatch(viewer, idOf(req)));
/** Into the lobby of a tournament drawn from it (`lobbyDraw`). */
export const lobbyHandler = cupHandler((viewer, req) => joinLobby(viewer, eventOf(req)));
export const soloHandler = cupHandler((viewer, req) => startSolo(viewer, idOf(req)));
export const liveHandler = cupHandler(async (viewer, req) => {
  await reportLive(viewer, idOf(req), req.body?.score, req.body);
  return undefined;
});
export const finalHandler = cupHandler((viewer, req) => reportFinal(viewer, idOf(req), req.body?.score));
/** Word Trip: one word `{ stop, word, t }` (or a skip `{ skip: true, stop, t }`), played again by the server; the answer says whether it counted. */
/** Word Trip: the normal game's page, to play the match in (`?v=` the version the page holds: just that it is the same). */
export const wordTripGameHandler = cupHandler((viewer, req) => wordTripGameFor(viewer, req.query.v));
export const wordHandler = cupHandler((viewer, req) => playWordIn(viewer, idOf(req), req.body));

/**
 * A face for the tournament page and the TV, small (`cupThumb`): signed in its
 * path, the same address for the same photo, kept a year by browsers and by
 * any cache in front (`public, immutable`). Not behind the ticket: an `<img>`
 * sends none, and the dashboard's TV has no ticket at all.
 */
export async function thumbHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const bytes = await cupThumb(String(req.params.eventId ?? ''), String(req.params.userId ?? ''), String(req.params.v ?? ''), String(req.params.sig ?? ''));
    if (!bytes) {
      res.status(404).set('Cache-Control', 'public, max-age=300').json({ success: false, message: 'No photo' });
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  } catch (error) {
    cupFailed(error, res, next);
  }
}

/** Knights: gives the match up; the opponent wins at once. */
export const resignHandler = cupHandler((viewer, req) => resignMatch(viewer, idOf(req)));

/**
 * An old inline profile photo, as an image (`<img>` sends no ticket: the
 * address is signed instead, and only ever handed to the event's own company
 * in its state). Kept a day by the browser; a new photo has a new address.
 */
export async function photoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const photo = await inlinePhoto(String(req.params.eventId ?? ''), String(req.params.userId ?? ''), req.query.v, req.query.s);
    if (!photo) {
      noStore(res).status(404).json({ success: false, message: 'No photo' });
      return;
    }
    res
      .status(200)
      .set({ 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' })
      .send(photo.bytes);
  } catch (error) {
    cupFailed(error, res, next);
  }
}
