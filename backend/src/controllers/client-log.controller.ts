import { NextFunction, Request, Response } from 'express';
import { recordClientErrors } from '../services/client-log.service';

export async function reportClientErrors(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await recordClientErrors(req.auth!.userId, req.body)) });
  } catch (error) { next(error); }
}
