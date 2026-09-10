import { NextFunction, Request, Response } from 'express';
import { getOrgSetup, OrgSetupError, updateOrgSetup } from '../services/orgSetup.service';

export async function getOrgSetupHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, setup: await getOrgSetup(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function updateOrgSetupHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const setup = await updateOrgSetup(requireUserId(req), {
      paySchedule: body.paySchedule,
      statutoryRegistration: body.statutoryRegistration,
    });
    res.status(200).json({ success: true, setup });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new OrgSetupError(401, 'Authentication required');
  return req.auth.userId;
}
