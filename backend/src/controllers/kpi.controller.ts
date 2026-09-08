import type { NextFunction, Request, Response } from 'express';
import { cycleInfoFor } from '../services/cycle';
import { users } from '../config/db';
import {
  archiveKpiParameter,
  assignKpis,
  assignTemplateToUsers,
  cancelKpiParameterEdit,
  createKpiParameter,
  createKpiTemplate,
  deleteKpiParameter,
  deleteKpiTemplate,
  kpiTemplateAudience,
  kpiTemplateMembers,
  getKpiAssignment,
  listKpiAssignments,
  listKpiParameters,
  listKpiTemplates,
  removeKpiAssignment,
  resolveKpiAudience,
  updateKpiParameter,
  updateKpiTemplate,
} from '../services/kpi.service';

function callerId(req: Request): string {
  return String(req.auth?.userId ?? '');
}

/** The org's live review cycle, so clients never derive it themselves. */
export async function kpiCycleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const caller = await users().findOne({ userId: callerId(req) });
    res.json({ success: true, cycle: await cycleInfoFor(caller?.org ?? '') });
  } catch (error) { next(error); }
}

// parameters

export async function listKpiParametersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    res.json({ success: true, parameters: await listKpiParameters(callerId(req), includeArchived) });
  } catch (error) { next(error); }
}

export async function createKpiParameterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, parameter: await createKpiParameter(callerId(req), req.body) });
  } catch (error) { next(error); }
}

export async function updateKpiParameterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parameter = await updateKpiParameter(callerId(req), String(req.params.parameterId), req.body);
    res.json({ success: true, parameter });
  } catch (error) { next(error); }
}

export async function archiveKpiParameterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const archived = req.body?.archived !== false;
    res.json({ success: true, ...(await archiveKpiParameter(callerId(req), String(req.params.parameterId), archived)) });
  } catch (error) { next(error); }
}

export async function deleteKpiParameterHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await deleteKpiParameter(callerId(req), String(req.params.parameterId))) });
  } catch (error) { next(error); }
}

export async function cancelKpiParameterEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await cancelKpiParameterEdit(callerId(req), String(req.params.parameterId))) });
  } catch (error) { next(error); }
}

// templates

export async function listKpiTemplatesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, templates: await listKpiTemplates(callerId(req)) });
  } catch (error) { next(error); }
}

export async function createKpiTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, template: await createKpiTemplate(callerId(req), req.body) });
  } catch (error) { next(error); }
}

export async function updateKpiTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await updateKpiTemplate(callerId(req), String(req.params.templateId), req.body);
    res.json({ success: true, template });
  } catch (error) { next(error); }
}

export async function deleteKpiTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await deleteKpiTemplate(callerId(req), String(req.params.templateId))) });
  } catch (error) { next(error); }
}

export async function kpiTemplateAudienceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await kpiTemplateAudience(callerId(req), String(req.params.templateId), req.query.period);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function assignTemplateToUsersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await assignTemplateToUsers(callerId(req), String(req.params.templateId), req.body);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

/** Who an ad-hoc rule set selects — the first step of bulk assignment. */
export async function resolveKpiAudienceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...(await resolveKpiAudience(callerId(req), req.body)) });
  } catch (error) { next(error); }
}

/** Who is on a template right now, for export. */
export async function kpiTemplateMembersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await kpiTemplateMembers(callerId(req), String(req.params.templateId), req.query.period);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

// assignments

export async function listKpiAssignmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, assignments: await listKpiAssignments(callerId(req), req.query.period) });
  } catch (error) { next(error); }
}

export async function getKpiAssignmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const assignment = await getKpiAssignment(callerId(req), String(req.params.userId), req.query.period);
    res.json({ success: true, assignment });
  } catch (error) { next(error); }
}

export async function assignKpisHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, assignment: await assignKpis(callerId(req), req.body) });
  } catch (error) { next(error); }
}

export async function removeKpiAssignmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await removeKpiAssignment(callerId(req), String(req.params.userId), req.query.period);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}
