// The payroll calculator, statutory rules, TDS engine and payroll crypto,
// shared with the server (backend/src/shared/payroll). The dashboard runs the
// very same code when an org's salaries are encrypted and computed here.
export { calculateSalaryStructure } from '../../../backend/src/shared/payroll/salary-calculator';
export type { SalaryCalcResult, ComponentLine as CoreComponentLine } from '../../../backend/src/shared/payroll/salary-calculator';
export { computePayslip } from '../../../backend/src/shared/payroll/payroll-run.calculator';
export type { PayslipComputation } from '../../../backend/src/shared/payroll/payroll-run.calculator';
export { applyOverrides, resolveTemplateComponents } from '../../../backend/src/shared/payroll/resolve';
export { defaultStatutorySettings } from '../../../backend/src/shared/payroll/statutory-defaults';
export { computeTds, fyOf } from '../../../backend/src/shared/payroll/tds';
export { SealedPayroll, PayrollLockedError } from '../../../backend/src/shared/payroll/sealed-client';
export type { CryptoStatus, OpenStructure, OpenPayslip, PayrollApi, RunEdits } from '../../../backend/src/shared/payroll/sealed-client';
