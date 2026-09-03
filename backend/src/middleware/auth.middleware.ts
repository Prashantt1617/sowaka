import { NextFunction, Request, Response } from 'express';
import { authSessions, users } from '../config/db';
import { hashSessionToken } from '../services/auth.service';
import { logger } from '../utils/logger';

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

    // Only these three fields gate the request. Profile photos are stored
    // inline as base64 data URIs (hundreds of KB each), so fetching the whole
    // document here dragged that payload across the wire on *every* API call.
    const user = await users().findOne(
      { userId: session.userId },
      { projection: { _id: 0, userId: 1, lifecycleStatus: 1, dashboardAccess: 1 } },
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

    req.auth = { userId: session.userId, token, dashboardAccess: user.dashboardAccess === true };
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
