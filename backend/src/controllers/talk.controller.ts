import { NextFunction, Request, Response } from 'express';
import {
  availabilityOn,
  bookSession,
  listCounsellors,
  listMySessions,
  TalkError, checkInSession, reviewSession } from '../services/talk.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new TalkError(401, 'Authentication required');
  return req.auth.userId;
}

export async function listCounsellorsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, counsellors: await listCounsellors(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function availabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await availabilityOn(requireUserId(req), String(req.query.date ?? ''));
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function listSessionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await listMySessions(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function reviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await reviewSession(requireUserId(req), String(req.params.sessionId ?? ''), {
      rating: req.body.rating,
      note: typeof req.body.note === 'string' ? req.body.note : undefined,
    });
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
}

export async function checkInHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await checkInSession(requireUserId(req), String(req.params.sessionId ?? ''), {
      feeling: String(req.body.feeling ?? ''),
      note: typeof req.body.note === 'string' ? req.body.note : undefined,
    });
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
}

export async function bookSessionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await bookSession(requireUserId(req), {
      counsellorUserId: String(req.body.counsellorUserId ?? ''),
      startsAt: String(req.body.startsAt ?? ''),
    });
    res.status(201).json({ success: true, session });
  } catch (error) {
    next(error);
  }
}
