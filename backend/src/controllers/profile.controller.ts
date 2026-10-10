import { NextFunction, Request, Response } from 'express';
import { ManagerError } from '../services/manager.service';
import { getLeaderboard, getPersonProfile, getPointsActivity } from '../services/profile.service';

function requireUserId(req: Request) {
  if (!req.auth?.userId) throw new ManagerError(401, 'Authentication required');
  return req.auth.userId;
}

/**
 * The company ranked by engagement points. `?userId=` also returns where that
 * person stands, for the Rank tab on their profile.
 */
export async function leaderboard(req: Request, res: Response, next: NextFunction) {
  try {
    const subject = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    res.status(200).json({ success: true, ...(await getLeaderboard(requireUserId(req), subject)) });
  } catch (error) {
    next(error);
  }
}

/** The signed-in person's credit history for a month, `?month=YYYY-MM`. */
export async function pointsActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
    res.status(200).json({ success: true, ...(await getPointsActivity(requireUserId(req), month, userId)) });
  } catch (error) {
    next(error);
  }
}

/** A colleague's profile, as anyone in the same company may see it. */
export async function personProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const person = await getPersonProfile(requireUserId(req), String(req.params.userId ?? ''));
    res.status(200).json({ success: true, person });
  } catch (error) {
    next(error);
  }
}
