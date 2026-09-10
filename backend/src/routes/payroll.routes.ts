import { Router } from 'express';
import {
  createPayHeadHandler,
  deletePayHeadHandler,
  getPayHeadHandler,
  listPayHeadsHandler,
  updatePayHeadHandler,
} from '../controllers/payHead.controller';
import {
  deleteStateRuleHandler,
  getStateRuleHandler,
  listStateRulesHandler,
  upsertStateRuleHandler,
} from '../controllers/statutory.controller';
import {
  getSalaryStructureHandler,
  listSalaryStructuresHandler,
  previewSalaryStructureHandler,
  upsertSalaryStructureHandler,
} from '../controllers/salaryStructure.controller';
import {
  createSalaryTemplateHandler,
  deleteSalaryTemplateHandler,
  getSalaryTemplateHandler,
  listSalaryTemplatesHandler,
  previewSalaryTemplateHandler,
  updateSalaryTemplateHandler,
} from '../controllers/salaryTemplate.controller';
import {
  createRunHandler,
  decideRunHandler,
  getRunHandler,
  listRunsHandler,
  markRunPaidHandler,
  recallRunHandler,
  recomputeRunHandler,
  submitRunHandler,
} from '../controllers/payrollRun.controller';
import { getOrgSetupHandler, updateOrgSetupHandler } from '../controllers/orgSetup.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess } from '../middleware/admin.middleware';

// Payroll configuration surface. Like the rest of the HR dashboard, every route
// requires an authenticated user who additionally has dashboardAccess.
export const payrollRouter = Router();
payrollRouter.use(requireAuth, requireDashboardAccess);

// Organisation setup — Pay Schedule (ORG-3) + Statutory Registration (ORG-2).
payrollRouter.get('/org-setup', getOrgSetupHandler);
payrollRouter.put('/org-setup', updateOrgSetupHandler);

// Pay Head Master — the org's reusable component catalog (PRD §5.3).
payrollRouter.get('/pay-heads', listPayHeadsHandler);
payrollRouter.post('/pay-heads', createPayHeadHandler);
payrollRouter.get('/pay-heads/:payHeadId', getPayHeadHandler);
payrollRouter.patch('/pay-heads/:payHeadId', updatePayHeadHandler);
payrollRouter.delete('/pay-heads/:payHeadId', deletePayHeadHandler);

// Statutory Calculation Engine — per-state rule sets (PRD §5.5, PT/LWF/Bonus).
// EPF/ESI are national constants in the engine and need no configuration here.
payrollRouter.get('/statutory-rules', listStateRulesHandler);
payrollRouter.get('/statutory-rules/:state', getStateRuleHandler);
payrollRouter.put('/statutory-rules/:state', upsertStateRuleHandler);
payrollRouter.delete('/statutory-rules/:state', deleteStateRuleHandler);

// Salary Templates (Pay Groups) — reusable structures assigned to employees.
payrollRouter.get('/salary-templates', listSalaryTemplatesHandler);
payrollRouter.post('/salary-templates', createSalaryTemplateHandler);
payrollRouter.post('/salary-templates/preview', previewSalaryTemplateHandler);
payrollRouter.get('/salary-templates/:code', getSalaryTemplateHandler);
payrollRouter.put('/salary-templates/:code', updateSalaryTemplateHandler);
payrollRouter.delete('/salary-templates/:code', deleteSalaryTemplateHandler);

// Salary Structure — per-employee assignment of a template (PRD §5.6). `preview`
// computes without saving, powering the live editor.
payrollRouter.get('/salary-structures', listSalaryStructuresHandler);
payrollRouter.get('/salary-structures/:userId', getSalaryStructureHandler);
payrollRouter.put('/salary-structures/:userId', upsertSalaryStructureHandler);
payrollRouter.post('/salary-structures/:userId/preview', previewSalaryStructureHandler);

// Payroll Run & Payslip (PRD §6) — a run is an object with a lifecycle:
// draft -> submit -> approve/reject -> paid, with recall back to draft.
payrollRouter.get('/runs', listRunsHandler);
payrollRouter.post('/runs', createRunHandler);
payrollRouter.get('/runs/:runId', getRunHandler);
payrollRouter.post('/runs/:runId/recompute', recomputeRunHandler);
payrollRouter.post('/runs/:runId/submit', submitRunHandler);
payrollRouter.post('/runs/:runId/decision', decideRunHandler);
payrollRouter.post('/runs/:runId/recall', recallRunHandler);
payrollRouter.post('/runs/:runId/mark-paid', markRunPaidHandler);
