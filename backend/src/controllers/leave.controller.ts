import { NextFunction, Request, Response } from 'express';
import {
  applyForLeave,
  cancelLeave,
  decideLeave,
  decideLeaveCancellation,
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
      // Multipart sends booleans as strings, so both forms are accepted.
      halfDay: req.body.halfDay === true || req.body.halfDay === 'true',
      document: req.file && {
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        bytes: req.file.buffer,
      },
    });
    res.status(201).json({ success: true, leave });
  } catch (error) {
    handleLeaveError(error, res, next);
  }
}

/**
 * The employee takes back a leave of their own: a pending one is withdrawn; an approved one
 * becomes a cancellation request for its approver (the leave comes back still approved, with
 * `cancelRequest.status: 'pending'`).
 */
export async function cancelMyLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await cancelLeave(requireUserId(req), String(req.params.leaveId ?? ''), {
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    res.json({ success: true, leave });
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

/** The manager answers a report's request to cancel an approved leave. */
export async function updateLeaveCancellationDecision(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await decideLeaveCancellation(requireUserId(req), String(req.params.leaveId ?? ''), {
      decision: String(req.body?.decision ?? ''),
      note: req.body?.note == null ? undefined : String(req.body.note),
    }, 'manager');
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
