import type { NextFunction, Request, Response } from 'express';
import {
  createShift, deleteShift, listShifts, readOrgShiftPolicy, saveOrgShiftPolicy, updateShift,
} from '../services/shift.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

export async function listShiftsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, shifts: await listShifts(callerId(req)) });
  } catch (error) { next(error); }
}

export async function createShiftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, shift: await createShift(callerId(req), req.body ?? {}) });
  } catch (error) { next(error); }
}

export async function updateShiftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shift = await updateShift(callerId(req), String(req.params.shiftId ?? ''), req.body ?? {});
    res.json({ success: true, shift });
  } catch (error) { next(error); }
}

export async function deleteShiftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteShift(callerId(req), String(req.params.shiftId ?? ''));
    res.json({ success: true });
  } catch (error) { next(error); }
}

// The Shifts › Policies setup: one document per org, one tab at a time.
export async function getShiftPolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, policy: await readOrgShiftPolicy(callerId(req)) });
  } catch (error) { next(error); }
}

export async function saveShiftPolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const policy = await saveOrgShiftPolicy(callerId(req), req.body ?? {});
    res.json({ success: true, policy });
  } catch (error) { next(error); }
}
