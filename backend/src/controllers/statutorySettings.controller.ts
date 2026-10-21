import { NextFunction, Request, Response } from 'express';
import {
  getStatutoryOverview,
  StatutorySettingsError,
  updateStatutorySettings,
} from '../services/statutorySettings.service';

export async function getStatutorySettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, ...(await getStatutoryOverview(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function updateStatutorySettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, ...(await updateStatutorySettings(requireUserId(req), req.body ?? {})) });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new StatutorySettingsError(401, 'Authentication required');
  return req.auth.userId;
}
