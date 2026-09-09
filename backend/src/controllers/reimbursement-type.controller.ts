import type { NextFunction, Request, Response } from 'express';
import {
  createReimbursementType,
  deleteReimbursementType,
  listReimbursementTypes,
  updateReimbursementType,
} from '../services/reimbursement-type.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

export async function listReimbursementTypesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, types: await listReimbursementTypes(callerId(req)) });
  } catch (error) { next(error); }
}

export async function createReimbursementTypeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const type = await createReimbursementType(callerId(req), req.body ?? {});
    res.status(201).json({ success: true, type });
  } catch (error) { next(error); }
}

export async function updateReimbursementTypeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const type = await updateReimbursementType(callerId(req), String(req.params.typeId ?? ''), req.body ?? {});
    res.json({ success: true, type });
  } catch (error) { next(error); }
}

export async function deleteReimbursementTypeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteReimbursementType(callerId(req), String(req.params.typeId ?? ''));
    res.json({ success: true });
  } catch (error) { next(error); }
}
