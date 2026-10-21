import { Router } from 'express';
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
  listRunsHandler,
  markRunPaidHandler,
  recallRunHandler,
  recomputeRunHandler,
  submitRunHandler,
} from '../controllers/payrollRun.controller';
import { getOrgSetupHandler, updateOrgSetupHandler } from '../controllers/orgSetup.controller';
import { getPaymentDetailsHandler, setPaymentDetailsHandler } from '../controllers/employeePayment.controller';
import { getDeclarationHandler, setDeclarationHandler } from '../controllers/tds.controller';
import {
  contextHandler,
  cryptoStatusHandler,
  grantHandler,
  recoverHandler,
  registerKeyHandler,
  changePassphraseHandler,
  plaintextHandler,
  sealExistingHandler,
  rotateHandler,
  runInputsHandler,
  saveSealedRunHandler,
  saveSealedStructureHandler,
  sealedDeclarationsHandler,
  sealedStructuresHandler,
  setupHandler,
} from '../controllers/payrollCrypto.controller';
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

// One employee's bank account, PAN and UAN: encrypted at rest, shown in full
// only to people with payroll access, masked to everyone else.
payrollRouter.get('/employees/:userId/payment-details', getPaymentDetailsHandler);
payrollRouter.put('/employees/:userId/payment-details', setPaymentDetailsHandler);

// One employee's income tax regime and declarations for a FY (?fy=2026-27).
payrollRouter.get('/employees/:userId/tax-declaration', getDeclarationHandler);
payrollRouter.put('/employees/:userId/tax-declaration', setDeclarationHandler);

// End-to-end encrypted salaries: keys and grants, and the sealed records the
// dashboard computes in the browser. The server never holds a key that opens them.
payrollRouter.get('/crypto', cryptoStatusHandler);
payrollRouter.post('/crypto/keys', registerKeyHandler);
payrollRouter.post('/crypto/keys/passphrase', changePassphraseHandler);
// Right after setup: the records that were readable, for the browser to lock.
payrollRouter.get('/crypto/plaintext', plaintextHandler);
payrollRouter.post('/crypto/seal-existing', sealExistingHandler);
payrollRouter.post('/crypto/setup', setupHandler);
payrollRouter.post('/crypto/recover', recoverHandler);
payrollRouter.post('/crypto/grants', grantHandler);
payrollRouter.post('/crypto/rotate', rotateHandler);
payrollRouter.get('/sealed/tax-declarations', sealedDeclarationsHandler);
payrollRouter.get('/sealed/context', contextHandler);
payrollRouter.get('/sealed/structures', sealedStructuresHandler);
payrollRouter.put('/sealed/structures/:userId', saveSealedStructureHandler);
payrollRouter.get('/sealed/run-inputs', runInputsHandler);
payrollRouter.post('/sealed/runs', saveSealedRunHandler);
