import { NextFunction, Request, Response } from 'express';
import { authSessions, users } from '../config/db';
import { accountClosedFor, hashSessionToken } from '../services/auth.service';
import { cachedAuth, rememberAuth } from '../services/auth-cache';
import { redactTicket } from '../services/scribble-ticket.service';
import { runAsRequestUser } from '../services/request-user';
import { dashboardGrantOf } from '../services/manager-scope';
import { tabsForRequest } from '../models/dashboard-tabs';
import { logger } from '../utils/logger';
import type { User } from '../models/user.model';
import type { AuthSessionDocument } from '../models/auth.model';
import { runAsViewer } from './request-viewer';
import { noteAppRequest } from '../services/app-activity.service';

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

    // Already checked on this request: /admin/payroll, /admin/kpi and the
    // three /suwi routers each pass through a router of their own that asks
    // again. The answer cannot have changed in the milliseconds between, and
    // asking cost two round trips each time.
    if (req.auth?.token === token && req.auth.user) {
      next();
      return;
    }

    // The session and its user in one round trip rather than two: every
    // signed-in request pays this before any work starts, and on a slow link
    // to the cluster the second trip was a few hundred milliseconds a call.
    //
    // The user is the whole record, bar the profile photo: older accounts hold
    // it inline as a base64 data URI of hundreds of KB, which is the one field
    // worth leaving behind on every call. The rest is a few hundred bytes, and
    // a handler that needs the user then has it without a second read.
    const tokenHash = hashSessionToken(token);
    const remembered = cachedAuth(tokenHash);
    const [session] = remembered
      ? [{ ...remembered.session, user: [remembered.user] }]
      : await authSessions()
      .aggregate<AuthSessionDocument & { user: Omit<User, 'profilePhotoUrl'>[] }>([
        { $match: { tokenHash, expiresAt: { $gt: new Date() } } },
        { $limit: 1 },
        {
          $lookup: {
            from: users().collectionName,
            localField: 'userId',
            foreignField: 'userId',
            pipeline: [{ $limit: 1 }, { $project: { _id: 0, profilePhotoUrl: 0 } }],
            as: 'user',
          },
        },
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
      const accountClosed = await accountClosedFor(user);
      res.status(401).json({
        success: false,
        message: 'User is not active',
        requestId: req.requestId,
        ...(accountClosed ? { accountClosed } : {}),
      });
      return;
    }

    if (!remembered) {
      const { user: _users, ...sessionOnly } = session;
      rememberAuth(tokenHash, sessionOnly as AuthSessionDocument, user);
    }

    // HR's dashboard grant, or a manager's (their tabs, their team) where the company switched it on.
    // A copy: the cached record must keep what is stored, or the next request would read a manager's
    // tabs as HR's own grant.
    const grant = await dashboardGrantOf(user as never);
    // A manager HR also gave some tabs: a request behind one of those tabs is answered company-wide, as HR
    // gave it; everything else (the manager's screens and shared lookups) is their team.
    let teamScope = grant.teamScope;
    if (teamScope && grant.givenTabs?.length) {
      const needed = tabsForRequest(req.method, (req.originalUrl || req.url).split('?')[0]);
      if (needed && needed.some((t) => grant.givenTabs!.includes(t))) teamScope = false;
    }
    const seen = (grant.access === (user.dashboardAccess === true) && !teamScope && !grant.givenTabs)
      ? user
      : { ...user, dashboardAccess: grant.access, dashboardTabs: grant.tabs ?? undefined, dashboardScope: teamScope ? 'team' : undefined } as typeof user;
    req.auth = {
      userId: session.userId,
      token,
      dashboardAccess: grant.access,
      user: seen,
    };
    // The dashboard's App usage page: who used the app, and when.
    noteAppRequest(req, user);
    // So `orgUsers` and the services that need the caller's org know it
    // without reading the user again.
    runAsRequestUser({ userId: session.userId, org: user.org, ...(teamScope ? { teamScope: true } : {}) }, () => runAsViewer(seen as Omit<User, 'profilePhotoUrl'>, next));
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
