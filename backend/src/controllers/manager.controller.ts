import { NextFunction, Request, Response } from 'express';
import {
  getManagerWorkspace,
  ManagerError,
  nominateForRecognition,
  updateProfilePhoto,
  upsertFeedback,
} from '../services/manager.service';

export async function managerWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const workspace = await getManagerWorkspace(requireUserId(req));
    res.status(200).json({ success: true, ...workspace });
  } catch (error) {
    next(error);
  }
}

export async function updateMyProfilePhoto(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new ManagerError(400, 'A photo file is required');
    const photoUrl = await updateProfilePhoto(requireUserId(req), {
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size,
      bytes: req.file.buffer,
    });
    res.status(200).json({ success: true, photoUrl });
  } catch (error) {
    next(error);
  }
}

export async function saveManagerFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const feedback = await upsertFeedback(
      requireUserId(req),
      String(req.params.employeeUserId ?? ''),
      {
        status: String(req.body.status ?? ''),
        parameters: req.body.parameters,
        extra: req.body.extra == null ? undefined : String(req.body.extra),
      },
    );
    res.status(200).json({ success: true, feedback });
  } catch (error) {
    next(error);
  }
}

export async function saveRecognitionNomination(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const nomination = await nominateForRecognition(
      requireUserId(req),
      String(req.params.category ?? ''),
      String(req.body.employeeUserId ?? ''),
      req.body.reason == null ? undefined : String(req.body.reason),
    );
    res.status(200).json({ success: true, nomination });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request) {
  if (!req.auth?.userId) throw new ManagerError(401, 'Authentication required');
  return req.auth.userId;
}

