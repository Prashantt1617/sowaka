import { NextFunction, Request, Response } from 'express';
import { CupError, entrantsFor, stateFor, viewerFromTicket, type CupViewer } from '../services/cup.service';

/** The ticket a Cup page sends with every call. */
const viewerOf = (req: Request): Promise<CupViewer> => viewerFromTicket(req.get('x-cup-ticket'));

/** The event a page asked about (the feed link names one), else the company's current one. */
const eventOf = (req: Request) => (typeof req.query.event === 'string' ? req.query.event : req.get('x-cup-event')) || undefined;

/** Each handler: the viewer, then the work; a CupError answers with its status, anything else goes on. */
const handle =
  (work: (viewer: CupViewer, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewer = await viewerOf(req);
      const body = await work(viewer, req);
      res.set('Cache-Control', 'private, no-store').json({ success: true, ...(body as object) });
    } catch (error) {
      if (error instanceof CupError) {
        res.status(error.statusCode).set('Cache-Control', 'private, no-store').json({ success: false, message: error.message });
        return;
      }
      next(error);
    }
  };

export const stateHandler = handle((viewer, req) => stateFor(viewer, eventOf(req)));
export const entrantsHandler = handle((viewer, req) => entrantsFor(viewer, eventOf(req)));
