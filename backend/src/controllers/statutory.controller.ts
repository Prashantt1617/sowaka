import { NextFunction, Request, Response } from 'express';
import {
  deleteStateRule,
  getStateRule,
  listStateRules,
  StatutoryError,
  StateRuleInput,
  upsertStateRule,
} from '../services/statutory.service';

export async function listStateRulesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, rules: await listStateRules(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getStateRuleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rule = await getStateRule(requireUserId(req), String(req.params.state ?? ''));
    res.status(200).json({ success: true, rule });
  } catch (error) {
    next(error);
  }
}

export async function upsertStateRuleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: StateRuleInput = {
      state: String(req.params.state ?? body.state ?? ''),
      pt: body.pt,
      lwf: body.lwf,
      bonus: body.bonus,
    };
    const rule = await upsertStateRule(requireUserId(req), input);
    res.status(200).json({ success: true, rule });
  } catch (error) {
    next(error);
  }
}

export async function deleteStateRuleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await deleteStateRule(requireUserId(req), String(req.params.state ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new StatutoryError(401, 'Authentication required');
  return req.auth.userId;
}
