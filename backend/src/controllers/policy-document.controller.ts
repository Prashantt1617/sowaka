import { NextFunction, Request, Response } from 'express';
import {
  PolicyDocumentError, PolicyViewer, adminPolicies, createPolicy, deletePolicy, policiesFor, reorderPolicies, updatePolicy,
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
