import { NextFunction, Request, Response } from 'express';
import { addEntry, CareError, deleteEntry, getCatalog, listJournal, updateEntry } from '../services/care.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new CareError(401, 'Authentication required');
  return req.auth.userId;
}

export async function catalogHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, catalog: await getCatalog(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function listJournalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await listJournal(requireUserId(req))) });
  } catch (error) {
    next(error);
  }
}

export async function addEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const entry = await addEntry(requireUserId(req), { text: body.text, prompt: body.prompt, context: body.context });
    res.status(201).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
}

export async function updateEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const entry = await updateEntry(requireUserId(req), String(req.params.id ?? ''), { text: body.text });
    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
}

export async function deleteEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteEntry(requireUserId(req), String(req.params.id ?? ''));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
