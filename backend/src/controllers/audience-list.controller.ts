import { NextFunction, Request, Response } from 'express';
import { ConnectError } from '../services/connect.service';
import {
  createAudienceList,
  deleteAudienceList,
  listAudienceLists,
  listAudiencePeople,
  updateAudienceList,
} from '../services/audience-list.service';

/**
 * Custom audience lists for Connect posts. Signed in, and every call is the
 * viewer's own: there is no way to name another person's list.
 */

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new ConnectError(401, 'Authentication required');
  return req.auth.userId;
}

export async function getAudienceLists(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, lists: await listAudienceLists(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function postAudienceList(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await createAudienceList(requireUserId(req), {
      name: req.body?.name,
      memberUserIds: req.body?.memberUserIds,
    });
    res.status(201).json({ success: true, list });
  } catch (error) {
    next(error);
  }
}

export async function patchAudienceList(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await updateAudienceList(requireUserId(req), String(req.params.listId ?? ''), {
      name: req.body?.name,
      memberUserIds: req.body?.memberUserIds,
    });
    res.status(200).json({ success: true, list });
  } catch (error) {
    next(error);
  }
}

export async function removeAudienceList(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, ...(await deleteAudienceList(requireUserId(req), String(req.params.listId ?? ''))) });
  } catch (error) {
    next(error);
  }
}

/** The company directory the list picker opens with. */
export async function getAudiencePeople(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, people: await listAudiencePeople(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}
