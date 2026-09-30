import { NextFunction, Request, Response } from 'express';
import {
  acceptCounsellor,
  counsellorDetail,
  getIntake,
  helpHome,
  HelpError,
  saveIntake,
} from '../services/help.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new HelpError(401, 'Authentication required');
  return req.auth.userId;
}

export async function helpHomeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await helpHome(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function getIntakeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, intake: await getIntake(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function saveIntakeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, ...(await saveIntake(requireUserId(req), body)) });
  } catch (error) {
    next(error);
  }
}

export async function acceptCounsellorHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const match = await acceptCounsellor(requireUserId(req), String(req.body?.counsellorUserId ?? ''));
    res.json({ success: true, match });
  } catch (error) {
    next(error);
  }
}

export async function counsellorDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await counsellorDetail(requireUserId(req), String(req.params.userId ?? ''))) });
  } catch (error) {
    next(error);
  }
}
