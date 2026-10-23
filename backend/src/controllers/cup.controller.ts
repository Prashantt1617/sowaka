import { NextFunction, Request, Response } from 'express';
import {
  CupError,
  entrantsFor,
  inlinePhoto,
  joinMatch,
  reportFinal,
  reportLive,
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
    noStore(res).type('application/json').send(await stateFor(viewer, eventOf(req), req.query.since));
  } catch (error) {
    cupFailed(error, res, next);
  }
}

const idOf = (req: Request) => String(req.params.id ?? '');

export const entrantsHandler = cupHandler((viewer, req) => entrantsFor(viewer, eventOf(req)));
export const joinHandler = cupHandler((viewer, req) => joinMatch(viewer, idOf(req)));
export const soloHandler = cupHandler((viewer, req) => startSolo(viewer, idOf(req)));
export const liveHandler = cupHandler(async (viewer, req) => {
  await reportLive(viewer, idOf(req), req.body?.score);
  return undefined;
});
export const finalHandler = cupHandler((viewer, req) => reportFinal(viewer, idOf(req), req.body?.score));

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
