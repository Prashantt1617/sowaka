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
    res.status(200).json({ success: true, fy: fyParam(req), ...(await getDeclaration(requireUserId(req), String(req.params.userId ?? ''), fyParam(req))) });
  } catch (error) {
    next(error);
  }
}

export async function setDeclarationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(200).json({ success: true, fy: fyParam(req), ...(await setDeclaration(requireUserId(req), String(req.params.userId ?? ''), fyParam(req), body)) });
  } catch (error) {
    next(error);
  }
}
