import { NextFunction, Request, Response } from 'express';
import { gardenFor, GardenError, giveNote, removeNote, timelineFor, treeFor } from '../services/garden.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new GardenError(401, 'Authentication required');
  return req.auth.userId;
}

export async function gardenHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await gardenFor(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function treeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await treeFor(requireUserId(req), String(req.params.userId ?? ''))) });
  } catch (error) {
    next(error);
  }
}

export async function timelineHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, notes: await timelineFor(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function giveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const gift = await giveNote(requireUserId(req), {
      toUserId: String(req.body.toUserId ?? ''),
      kind: String(req.body.kind ?? ''),
      note: String(req.body.note ?? ''),
    });
    res.status(201).json({ success: true, ...gift });
  } catch (error) {
    next(error);
  }
}

export async function removeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await removeNote(requireUserId(req), String(req.params.noteId ?? ''));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
