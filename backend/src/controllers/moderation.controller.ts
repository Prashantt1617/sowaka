import { NextFunction, Request, Response } from 'express';
import { ConnectError } from '../services/connect.service';
import {
  listContentReports,
  reviewContentReport,
} from '../services/connect-moderation.service';

export async function adminListReports(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status == null ? undefined : String(req.query.status);
    res.status(200).json({
      success: true,
      reports: await listContentReports(requireUserId(req), status),
    });
  } catch (error) {
    next(error);
  }
}

export async function adminReviewReport(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reviewContentReport(
      requireUserId(req),
      String(req.params.reportId ?? ''),
      {
        status: String(req.body.status ?? ''),
        note: req.body.note == null ? undefined : String(req.body.note),
      },
    );
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request) {
  if (!req.auth?.userId) throw new ConnectError(401, 'Authentication required');
  return req.auth.userId;
}
