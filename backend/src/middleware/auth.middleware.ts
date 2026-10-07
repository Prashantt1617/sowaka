import { NextFunction, Request, Response } from 'express';
import { authSessions, users } from '../config/db';
import { hashSessionToken } from '../services/auth.service';
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

    const session = await authSessions().findOne({
      tokenHash: hashSessionToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) {
      logAuthRejection(req, 'Session expired or invalid');
      res.status(401).json({
        success: false,
        message: 'Session expired or invalid',
        requestId: req.requestId,
      });
      return;
    }

    // The whole record, bar the profile photo: older accounts hold it inline
    // as a base64 data URI of hundreds of KB, which is the one field worth
    // leaving behind on every call. The rest is a few hundred bytes, and a
    // handler that needs the user then has it without a second read.
    const user = await users().findOne(
      { userId: session.userId },
      { projection: { _id: 0, profilePhotoUrl: 0 } },
    );
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
      user: user as Omit<User, 'profilePhotoUrl'>,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function logAuthRejection(req: Request, reason: string, userId?: string): void {
  logger.warn('Authentication rejected', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: 401,
    userId,
    reason,
  });
}
