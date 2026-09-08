import { NextFunction, Request, Response } from 'express';
import {
  getSalaryStructure,
  listSalaryStructures,
  previewSalaryStructure,
  SalaryStructureError,
  SalaryStructureInput,
  upsertSalaryStructure,
} from '../services/salaryStructure.service';

export async function listSalaryStructuresHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, structures: await listSalaryStructures(requireUserId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getSalaryStructureHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getSalaryStructure(requireUserId(req), String(req.params.userId ?? ''));
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function upsertSalaryStructureHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await upsertSalaryStructure(
      requireUserId(req),
      String(req.params.userId ?? ''),
      toInput(req.body),
    );
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function previewSalaryStructureHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await previewSalaryStructure(
      requireUserId(req),
      String(req.params.userId ?? ''),
      toInput(req.body),
    );
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

function toInput(body: unknown): SalaryStructureInput {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    salaryTemplateCode: source.salaryTemplateCode,
    annualCtcPaise: source.annualCtcPaise,
    componentValues: source.componentValues,
    statutory: source.statutory,
    bonusCategory: source.bonusCategory,
    status: source.status,
  };
}

function requireUserId(req: Request): string {
  if (!req.auth?.userId) throw new SalaryStructureError(401, 'Authentication required');
  return req.auth.userId;
}
