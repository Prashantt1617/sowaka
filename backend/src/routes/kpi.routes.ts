import { Router } from 'express';
import {
  archiveKpiParameterHandler,
  cancelKpiParameterEditHandler,
  kpiCycleHandler,
  assignKpisHandler,
  assignTemplateToUsersHandler,
  deleteKpiParameterHandler,
  kpiTemplateAudienceHandler,
  kpiTemplateMembersHandler,
  resolveKpiAudienceHandler,
  createKpiParameterHandler,
  createKpiTemplateHandler,
  deleteKpiTemplateHandler,
  getKpiAssignmentHandler,
  listKpiAssignmentsHandler,
  listKpiParametersHandler,
  listKpiTemplatesHandler,
  removeKpiAssignmentHandler,
  updateKpiParameterHandler,
  updateKpiTemplateHandler,
} from '../controllers/kpi.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';

export const kpiRouter = Router();

// Authoring KPIs decides what every manager in the org scores against, so the
// whole module is HR-only — the same guard the payroll module uses.
kpiRouter.use(requireAuth, requireDashboardAccess);

// The live cycle, derived from the org's configured start day.
kpiRouter.get('/cycle', kpiCycleHandler);

// Parameters — the org's catalogue. Deletable only while unreferenced, since
// templates, assignments and sent reviews all point at them by id.
kpiRouter.get('/parameters', listKpiParametersHandler);
kpiRouter.post('/parameters', createKpiParameterHandler);
kpiRouter.put('/parameters/:parameterId', updateKpiParameterHandler);
kpiRouter.post('/parameters/:parameterId/archive', archiveKpiParameterHandler);
// Only permitted while nothing references it — the service checks every period.
kpiRouter.delete('/parameters/:parameterId', deleteKpiParameterHandler);
// Wording edits are staged for the next cycle; this drops one before it opens.
kpiRouter.delete('/parameters/:parameterId/pending', cancelKpiParameterEditHandler);

// Templates — named sets, optionally offered for particular designations.
kpiRouter.get('/templates', listKpiTemplatesHandler);
kpiRouter.post('/templates', createKpiTemplateHandler);
kpiRouter.put('/templates/:templateId', updateKpiTemplateHandler);
kpiRouter.delete('/templates/:templateId', deleteKpiTemplateHandler);
// Who a template's targeting selects, and assigning it to them in bulk.
kpiRouter.get('/templates/:templateId/audience', kpiTemplateAudienceHandler);
kpiRouter.get('/templates/:templateId/members', kpiTemplateMembersHandler);
kpiRouter.post('/templates/:templateId/assign', assignTemplateToUsersHandler);

// Bulk assignment: resolve an ad-hoc rule set to people, then assign a template
// to the ones chosen.
kpiRouter.post('/audience', resolveKpiAudienceHandler);

// Assignments — one employee, one cycle. Editing a template does not reach
// back into assignments already made from it.
kpiRouter.get('/assignments', listKpiAssignmentsHandler);
kpiRouter.post('/assignments', assignKpisHandler);
kpiRouter.get('/assignments/:userId', getKpiAssignmentHandler);
kpiRouter.delete('/assignments/:userId', removeKpiAssignmentHandler);
