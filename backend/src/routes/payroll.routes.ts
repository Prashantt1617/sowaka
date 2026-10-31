import { Router } from 'express';
import {
  liabilitySummaryHandler,
  paymentDetailsHandler,
  payrollDashboardHandler,
  payrollSummaryHandler,
  ptAnnualReturnHandler,
  ptSummaryHandler,
  salaryRegisterHandler,
} from '../controllers/payrollReports.controller';
import {
  assignPaidDaysTemplateHandler,
  createPaidDaysTemplateHandler,
  deletePaidDaysTemplateHandler,
  listPaidDaysTemplatesHandler,
  makeDefaultPaidDaysTemplateHandler,
  updatePaidDaysTemplateHandler,
} from '../controllers/paidDaysTemplate.controller';
import {
  createPayHeadHandler,
  deletePayHeadHandler,
  getPayHeadHandler,
  listPayHeadsHandler,
  listStandardComponentsHandler,
  updatePayHeadHandler,
} from '../controllers/payHead.controller';
import {
  deleteStateRuleHandler,
  getStateRuleHandler,
  listStateRulesHandler,
  upsertStateRuleHandler,
} from '../controllers/statutory.controller';
import {
  getStatutorySettingsHandler,
  updateStatutorySettingsHandler,
} from '../controllers/statutorySettings.controller';
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
  tdsWorksheetHandler,
  listRunsHandler,
  markRunPaidHandler,
  recallRunHandler,
  recomputeRunHandler,
  submitRunHandler,
} from '../controllers/payrollRun.controller';
import { getOrgSetupHandler, updateOrgSetupHandler } from '../controllers/orgSetup.controller';
import { getPaymentDetailsHandler, setPaymentDetailsHandler } from '../controllers/employeePayment.controller';
import { getDeclarationHandler, setDeclarationHandler } from '../controllers/tds.controller';
import { hrDecideProofHandler, hrListProofsHandler, hrProofFileHandler } from '../controllers/employeePayroll.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDashboardAccess, requireDashboardTabs } from '../middleware/admin.middleware';

// Payroll configuration surface. Like the rest of the HR dashboard, every route
// requires an authenticated user who additionally has dashboardAccess.
export const payrollRouter = Router();
// Tabs too: someone given only some tabs in People › Accesses can't read what
// people earn through the payroll APIs.
payrollRouter.use(requireAuth, requireDashboardAccess, requireDashboardTabs);

// Organisation setup — Pay Schedule (ORG-3) + Statutory Registration (ORG-2).
payrollRouter.get('/org-setup', getOrgSetupHandler);
payrollRouter.put('/org-setup', updateOrgSetupHandler);

// Pay Head Master — the org's reusable component catalog (PRD §5.3).
payrollRouter.get('/pay-heads', listPayHeadsHandler);
payrollRouter.post('/pay-heads', createPayHeadHandler);
// The built-in standard components this org hasn't added yet (nothing saved).
payrollRouter.get('/pay-heads/standard', listStandardComponentsHandler);
payrollRouter.get('/pay-heads/:payHeadId', getPayHeadHandler);
payrollRouter.patch('/pay-heads/:payHeadId', updatePayHeadHandler);
payrollRouter.delete('/pay-heads/:payHeadId', deletePayHeadHandler);

// Statutory Calculation Engine — per-state rule sets (PRD §5.5, PT/LWF/Bonus).
// EPF/ESI are national constants in the engine and need no configuration here.
payrollRouter.get('/statutory-settings', getStatutorySettingsHandler);
payrollRouter.put('/statutory-settings', updateStatutorySettingsHandler);
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

// Paid Days Templates — how attendance becomes paid days, per person; one Default per company.
payrollRouter.get('/paid-days-templates', listPaidDaysTemplatesHandler);
payrollRouter.post('/paid-days-templates', createPaidDaysTemplateHandler);
payrollRouter.put('/paid-days-templates/:code', updatePaidDaysTemplateHandler);
payrollRouter.delete('/paid-days-templates/:code', deletePaidDaysTemplateHandler);
payrollRouter.post('/paid-days-templates/:code/default', makeDefaultPaidDaysTemplateHandler);
payrollRouter.put('/salary-structures/:userId/paid-days-template', assignPaidDaysTemplateHandler);

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
// Payroll reports and the payroll dashboard (finished runs; ?includeDrafts=true previews the rest).
payrollRouter.get('/reports/dashboard', payrollDashboardHandler);
payrollRouter.get('/reports/payroll-summary', payrollSummaryHandler);
payrollRouter.get('/reports/salary-register', salaryRegisterHandler);
payrollRouter.get('/reports/liability-summary', liabilitySummaryHandler);
payrollRouter.get('/reports/pt-summary', ptSummaryHandler);
payrollRouter.get('/reports/pt-annual', ptAnnualReturnHandler);
payrollRouter.get('/runs/:runId/payment-details', paymentDetailsHandler);
// A payslip's TDS work sheet, as Zoho lays it out.
payrollRouter.get('/payslips/:payslipId/tds-sheet', tdsWorksheetHandler);

// One employee's bank account, PAN and UAN: encrypted at rest, shown in full
// only to people with payroll access, masked to everyone else.
payrollRouter.get('/employees/:userId/payment-details', getPaymentDetailsHandler);
payrollRouter.put('/employees/:userId/payment-details', setPaymentDetailsHandler);

// One employee's income tax regime and declarations for a FY (?fy=2026-27).
payrollRouter.get('/employees/:userId/tax-declaration', getDeclarationHandler);
payrollRouter.put('/employees/:userId/tax-declaration', setDeclarationHandler);

// The proofs employees upload for their investment declarations: list, open, approve or reject.
payrollRouter.get('/investment-proofs', hrListProofsHandler);
payrollRouter.get('/investment-proofs/:proofId/file', hrProofFileHandler);
payrollRouter.post('/investment-proofs/:proofId/decision', hrDecideProofHandler);

