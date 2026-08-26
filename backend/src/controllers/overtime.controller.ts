import { NextFunction, Request, Response } from 'express';
import {
  createOvertimeRequest,
  decideOvertime,
  getManagerOvertimeInbox,
  getMyOvertimeRequests,
  OvertimeError,
} from '../services/overtime.service';

export async function createOvertime(req: Request, res: Response, next: NextFunction) {
  try {
    const overtime = await createOvertimeRequest(requireUserId(req), {
      workDate: String(req.body.workDate ?? ''),
      startTime: String(req.body.startTime ?? ''),
      endTime: String(req.body.endTime ?? ''),
      note: req.body.note == null ? undefined : String(req.body.note),
    });
    res.status(201).json({ success: true, overtime });
  } catch (error) {
    next(error);
  }
}

export async function listMyOvertime(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, overtime: await getMyOvertimeRequests(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function listOvertimeInbox(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({ success: true, overtime: await getManagerOvertimeInbox(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function updateOvertimeDecision(req: Request, res: Response, next: NextFunction) {
  try {
    const overtime = await decideOvertime(requireUserId(req), String(req.params.overtimeId ?? ''), {
      decision: String(req.body.decision ?? ''),
      managerNote: req.body.managerNote == null ? undefined : String(req.body.managerNote),
    });
    res.status(200).json({ success: true, overtime });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request) {
  if (!req.auth?.userId) throw new OvertimeError(401, 'Authentication required');
  return req.auth.userId;
}
