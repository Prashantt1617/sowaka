import { NextFunction, Request, Response } from 'express';
import {
  assignPaidDaysTemplate,
  createPaidDaysTemplate,
  deletePaidDaysTemplate,
  listPaidDaysTemplates,
  makeDefaultPaidDaysTemplate,
  PaidDaysTemplateError,
  updatePaidDaysTemplate,
} from '../services/paidDaysTemplate.service';

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new PaidDaysTemplateError(401, 'Authentication required');
  return req.auth.userId;
}

const handle = (fn: (req: Request) => Promise<object>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, ...(await fn(req)) });
  } catch (error) {
    next(error);
  }
};

export const listPaidDaysTemplatesHandler = handle(async (req) => ({ templates: await listPaidDaysTemplates(requireUserId(req)) }));
export const createPaidDaysTemplateHandler = handle(async (req) => ({ template: await createPaidDaysTemplate(requireUserId(req), req.body ?? {}) }));
export const updatePaidDaysTemplateHandler = handle(async (req) => ({ template: await updatePaidDaysTemplate(requireUserId(req), String(req.params.code ?? ''), req.body ?? {}) }));
export const makeDefaultPaidDaysTemplateHandler = handle(async (req) => ({ templates: await makeDefaultPaidDaysTemplate(requireUserId(req), String(req.params.code ?? '')) }));
export const deletePaidDaysTemplateHandler = handle(async (req) => deletePaidDaysTemplate(requireUserId(req), String(req.params.code ?? '')));
export const assignPaidDaysTemplateHandler = handle(async (req) => {
  const code = req.body?.code;
  return assignPaidDaysTemplate(requireUserId(req), String(req.params.userId ?? ''), typeof code === 'string' && code ? code : null);
});
