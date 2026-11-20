import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { policiesAcknowledgedByJoiner } from '../services/lifecycle/appOnboarding';
import {
  PolicyDocumentError, PolicyViewer, acknowledgePolicy, adminPolicies, createPolicy, deletePolicy, policiesFor, reorderPolicies, updatePolicy,
} from '../services/policy-document.service';

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

/**
 * Policies › a policy › Acknowledge: `{ version }` is the version read. 409
 * when the text has changed since. Answers the policy and the whole list, so
 * the page redraws its pills from one reply.
 */
export async function acknowledgePolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = viewerOf(req);
    const device = String(req.get('user-agent') ?? '');
    const out = await acknowledgePolicy(viewer, String(req.params.key ?? ''), { version: req.body?.version, device });
    const user = req.auth?.user;
    if (user?.org) {
      // A joiner's Week-1 policies step follows; a failure there never fails the acknowledgement.
      await policiesAcknowledgedByJoiner({ userId: viewer.userId, name: user.name ?? '', org: user.org }, out.policies, device).catch((error: unknown) =>
        logger.warn('Policy acknowledgement not passed to onboarding', { userId: viewer.userId, reason: (error as Error).message }));
    }
    res.json({ success: true, ...out });
  } catch (error) {
    next(error);
  }
}

// Setup › Policies on the dashboard: the company's own policies, as the app shows them.
function adminOf(req: Request): { org: string; by: string } {
  const user = req.auth?.user;
  if (!req.auth?.userId || !user?.org) throw new PolicyDocumentError(401, 'Authentication required');
  return { org: user.org, by: user.name || user.email || req.auth.userId };
}

export async function adminPoliciesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, policies: await adminPolicies(adminOf(req).org) });
  } catch (error) { next(error); }
}

export async function createPolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { org, by } = adminOf(req);
    res.status(201).json({ success: true, policy: await createPolicy(org, req.body ?? {}, by) });
  } catch (error) { next(error); }
}

export async function updatePolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { org, by } = adminOf(req);
    res.json({ success: true, policy: await updatePolicy(org, String(req.params.key ?? ''), req.body ?? {}, by) });
  } catch (error) { next(error); }
}

export async function reorderPoliciesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { org, by } = adminOf(req);
    res.json({ success: true, policies: await reorderPolicies(org, req.body?.keys, by) });
  } catch (error) { next(error); }
}

export async function deletePolicyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deletePolicy(adminOf(req).org, String(req.params.key ?? ''));
    res.json({ success: true });
  } catch (error) { next(error); }
}
