import { NextFunction, Request, Response } from 'express';
import {
  applyForLeave,
  decideLeave,
  getManagerLeaveInbox,
  getMyLeaveBalance,
  getMyLeaves,
  LeaveError,
} from '../services/leave.service';

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await applyForLeave(requireUserId(req), {
      type: String(req.body.type ?? ''),
      startDate: String(req.body.startDate ?? ''),
      endDate: String(req.body.endDate ?? ''),
      reason: String(req.body.reason ?? ''),
      halfDay: req.body.halfDay === true,
    });
    res.status(201).json({ success: true, leave });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

export async function leaveBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const year = req.query.year == null ? undefined : Number(req.query.year);
    const balance = await getMyLeaveBalance(requireUserId(req), year);
    res.status(200).json({ success: true, balance });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

export async function listMyLeaves(req: Request, res: Response, next: NextFunction) {
  try {
    const leaveRequests = await getMyLeaves(requireUserId(req));
    res.status(200).json({ success: true, leaves: leaveRequests });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

export async function listManagerLeaves(req: Request, res: Response, next: NextFunction) {
  try {
    const leaveRequests = await getManagerLeaveInbox(requireUserId(req));
    res.status(200).json({ success: true, leaves: leaveRequests });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

export async function updateLeaveDecision(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await decideLeave(requireUserId(req), String(req.params.leaveId ?? ''), {
      decision: String(req.body.decision ?? ''),
      managerNote: req.body.managerNote == null ? undefined : String(req.body.managerNote),
    });
    res.status(200).json({ success: true, leave });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new LeaveError(401, 'Authentication required');
  }
  return req.auth.userId;
}

function handleLeaveError(error: unknown, res: Response, next: NextFunction) {
  void res;
  next(error);
}
