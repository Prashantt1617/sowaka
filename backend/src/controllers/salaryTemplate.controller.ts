import { NextFunction, Request, Response } from 'express';
import {
  createSalaryTemplate,
  deleteSalaryTemplate,
  getSalaryTemplate,
  listSalaryTemplates,
  previewSalaryTemplate,
  SalaryTemplateError,
  SalaryTemplateInput,
  updateSalaryTemplate,
} from '../services/salaryTemplate.service';

export async function listSalaryTemplatesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, templates: await listSalaryTemplates(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getSalaryTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await getSalaryTemplate(requireUserId(req), String(req.params.code ?? ''));
    res.status(200).json({ success: true, template });
  } catch (error) {
    next(error);
  }
}

export async function createSalaryTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await createSalaryTemplate(requireUserId(req), toInput(req.body));
    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
}

export async function updateSalaryTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await updateSalaryTemplate(
      requireUserId(req),
      String(req.params.code ?? ''),
      toInput(req.body),
    );
    res.status(200).json({ success: true, template });
  } catch (error) {
    next(error);
  }
}

export async function deleteSalaryTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await deleteSalaryTemplate(requireUserId(req), String(req.params.code ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function previewSalaryTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const computed = await previewSalaryTemplate(
      requireUserId(req),
      toInput(body),
      Number(body.sampleAnnualCtcPaise) || 0,
    );
    res.status(200).json({ success: true, computed });
  } catch (error) {
    next(error);
  }
}

function toInput(body: unknown): SalaryTemplateInput {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    name: source.name,
    code: source.code,
    description: source.description,
    components: source.components,
    balancingComponentCode: source.balancingComponentCode,
    epfApplyCeiling: source.epfApplyCeiling,
    active: source.active,
  };
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new SalaryTemplateError(401, 'Authentication required');
  return req.auth.userId;
}
