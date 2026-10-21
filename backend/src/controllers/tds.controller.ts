import { NextFunction, Request, Response } from 'express';
import { fyOf } from '../shared/payroll/tds';
import { getDeclaration, setDeclaration, TdsError } from '../services/tds.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new TdsError(401, 'Authentication required');
  return req.auth.userId;
}
const fyParam = (req: Request) => String(req.query.fy ?? fyOf(new Date().toISOString().slice(0, 7)).fy);

export async function getDeclarationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = requireUserId(req);
    const userId = String(req.params.userId ?? '');
    const result = await getDeclaration(viewer, userId, fyParam(req));
    res.status(200).json({ success: true, fy: fyParam(req), ...result });
  } catch (error) {
    next(error);
  }
}

export async function setDeclarationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = requireUserId(req);
    const userId = String(req.params.userId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await setDeclaration(viewer, userId, fyParam(req), body);
    res.status(200).json({ success: true, fy: fyParam(req), ...result });
  } catch (error) {
    next(error);
  }
}
