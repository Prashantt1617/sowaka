import { NextFunction, Request, Response } from 'express';
import { PolicyDocumentError, PolicyViewer, policiesFor } from '../services/policy-document.service';

function viewerOf(req: Request): PolicyViewer {
  const user = req.auth?.user;
  if (!req.auth?.userId || !user) throw new PolicyDocumentError(401, 'Authentication required');
  return { userId: req.auth.userId, org: user.org };
}

export async function policiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, policies: await policiesFor(viewerOf(req)) });
  } catch (error) {
    next(error);
  }
}
