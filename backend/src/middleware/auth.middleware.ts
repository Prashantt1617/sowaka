import { NextFunction, Request, Response } from 'express';
import { authSessions, users } from '../config/db';
import { hashSessionToken } from '../services/auth.service';
import { redactTicket } from '../services/scribble-ticket.service';
import { runAsRequestUser } from '../services/request-user';
import { logger } from '../utils/logger';
import type { User } from '../models/user.model';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authorization = req.header('authorization') ?? '';
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      logAuthRejection(req, 'Authentication header is missing or malformed');
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        requestId: req.requestId,
      });
      return;
    }

    // Already checked on this request: a path under /admin passes the admin
    // router's check and then its own router's (/admin/kpi, /admin/payroll…),
    // and /suwi has three routers in a row. Once is enough.
    if (req.auth?.token === token && req.auth.user) {
      next();
      return;
    }

    // The session and its user in one round trip rather than two in a row.
    // The user is the whole record, bar the profile photo: older accounts
    // hold it inline as a base64 data URI of hundreds of KB, which is the one
    // field worth leaving behind on every call. The rest is a few hundred
    // bytes, and a handler that needs the user then has it without a second read.
    const [session] = await authSessions()
      .aggregate<{ userId: string; user: Omit<User, 'profilePhotoUrl'>[] }>([
        { $match: { tokenHash: hashSessionToken(token), expiresAt: { $gt: new Date() } } },
        { $limit: 1 },
        {
          $lookup: {
            from: users().collectionName,
            localField: 'userId',
            foreignField: 'userId',
            pipeline: [{ $project: { _id: 0, profilePhotoUrl: 0 } }, { $limit: 1 }],
            as: 'user',
          },
        },
        { $project: { _id: 0, userId: 1, user: 1 } },
      ])
      .toArray();
    if (!session) {
      logAuthRejection(req, 'Session expired or invalid');
      res.status(401).json({
        success: false,
        message: 'Session expired or invalid',
        requestId: req.requestId,
      });
      return;
    }

    const user = session.user[0];
    if (!user || user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') {
      logAuthRejection(req, 'Session user is missing or inactive', session.userId);
      res.status(401).json({
        success: false,
        message: 'User is not active',
        requestId: req.requestId,
      });
      return;
    }

    req.auth = {
      userId: session.userId,
      token,
      dashboardAccess: user.dashboardAccess === true,
      user,
    };
    // So `orgUsers` and the like know the caller's org without reading it again.
    runAsRequestUser({ userId: session.userId, org: user.org }, next);
  } catch (error) {
    next(error);
  }
}

function logAuthRejection(req: Request, reason: string, userId?: string): void {
  logger.warn('Authentication rejected', {
    requestId: req.requestId,
    method: req.method,
    // A Scribble hop URL carries a credential in its query string.
    path: redactTicket(req.originalUrl),
    statusCode: 401,
    userId,
    reason,
  });
}
