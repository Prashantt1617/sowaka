// Typed calls against the payroll admin endpoints (/admin/payroll/*).
// All money crosses the wire as INTEGER PAISE.
import { api } from './http';

// ————————————————————————————————————————————————————————————————
// Money helpers
// ————————————————————————————————————————————————————————————————

/** Format integer paise as an INR string, e.g. 150000 -> "₹1,500". */
export function inr(paise: number): string {
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

/** Convert a rupee input (number or string) to integer paise. */
export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ————————————————————————————————————————————————————————————————
// Pay Head Master
// ————————————————————————————————————————————————————————————————

export type PayHeadCategory = 'earning' | 'deduction' | 'benefit' | 'reimbursement';
export type CalculationMode = 'flat_amount' | 'percentage' | 'flat_per_month';
export type PercentageBase = 'ctc' | 'basic' | 'component';

export type CalculationBasis = {
  mode: CalculationMode;
  amountPaise?: number;
  percent?: number;
  base?: PercentageBase;
  baseComponentCode?: string;
};

export type StatutoryConsideration = { consider: boolean; condition?: 'always' | 'if_pf_wage_below_15000' };

export type PayHeadDTO = {
  id: string;
  name: string;
  code: string;
  category: PayHeadCategory;
  componentType: string;
  calculation: CalculationBasis;
  considerForEpf?: StatutoryConsideration;
  considerForEsi?: StatutoryConsideration;
  considerForPt?: boolean;
  considerForLwf?: boolean;
  fbp?: boolean;
  recurrence?: 'recurring' | 'one_time';
  prorate?: boolean;
  arrears?: boolean;
  maxClaimablePaise?: number;
  active: boolean;
};

export type PayHeadInput = {
  name: string;
  code: string;
  category: PayHeadCategory;
  componentType: string;
  calculation: CalculationBasis;
  considerForEpf?: StatutoryConsideration | boolean;
  considerForEsi?: StatutoryConsideration | boolean;
  fbp?: boolean;
  maxClaimablePaise?: number;
  active?: boolean;
};

export const listPayHeads = () =>
  api<{ payHeads: PayHeadDTO[] }>('/admin/payroll/pay-heads').then((r) => r.payHeads);

export const createPayHead = (input: PayHeadInput) =>
  api<{ payHead: PayHeadDTO }>('/admin/payroll/pay-heads', { method: 'POST', body: input }).then(
    (r) => r.payHead,
  );

export const updatePayHead = (id: string, input: PayHeadInput) =>
  api<{ payHead: PayHeadDTO }>(`/admin/payroll/pay-heads/${id}`, { method: 'PATCH', body: input }).then(
    (r) => r.payHead,
  );

export const deletePayHead = (id: string) =>
  api(`/admin/payroll/pay-heads/${id}`, { method: 'DELETE' });

// ————————————————————————————————————————————————————————————————
// Organisation setup — Pay Schedule (ORG-3) + Statutory Registration (ORG-2)
// ————————————————————————————————————————————————————————————————

export type PaySchedule = {
  frequency: 'monthly';
  payDay: 'last_day' | number;
  firstPayPeriod?: string;
  workingDaysPerMonth?: number;
  lockedAfterFirstRun?: boolean;
};
export type StatutoryRegistration = {
  pan?: string;
  tan?: string;
  tdsCircle?: string;
  aoCode?: string;
  taxPaymentFrequency?: 'monthly' | 'quarterly';
  deductor?: { type?: string; name?: string; designation?: string };
};
export type OrgSetupDTO = {
  paySchedule: PaySchedule;
  statutoryRegistration: StatutoryRegistration;
  payScheduleLocked: boolean;
  hasRuns: boolean;
};
export type OrgSetupInput = { paySchedule?: PaySchedule; statutoryRegistration?: StatutoryRegistration };

export const getOrgSetup = () =>
  api<{ setup: OrgSetupDTO }>('/admin/payroll/org-setup').then((r) => r.setup);

export const updateOrgSetup = (input: OrgSetupInput) =>
  api<{ setup: OrgSetupDTO }>('/admin/payroll/org-setup', { method: 'PUT', body: input }).then((r) => r.setup);

// ————————————————————————————————————————————————————————————————
// Statutory rules (per state: PT / LWF / Bonus). EPF & ESI are national.
// ————————————————————————————————————————————————————————————————

export type PtSlab = {
  upToPaise: number | null;
  amountPaise: number;
  monthOverride?: { month: number; amountPaise: number };
};
export type PtRule = { slabs: PtSlab[] };

export type LwfEmployeeBasis =
  | { mode: 'flat'; amountPaise: number }
  | { mode: 'percentage'; percent: number; capPaise?: number };
export type LwfEmployerBasis =
  | { mode: 'flat'; amountPaise: number }
  | { mode: 'percentage'; percent: number; capPaise?: number }
  | { mode: 'multiple_of_employee'; factor: number };
export type LwfRule = {
  cycle: 'monthly' | 'half_yearly';
  deductionMonths: number[];
  employee: LwfEmployeeBasis;
  employer: LwfEmployerBasis;
};

export type BonusRule = { ratePercent: number; minWageByCategoryPaise: Record<string, number> };

export type StatutoryRuleDTO = {
  state: string;
  pt?: PtRule;
  lwf?: LwfRule;
  bonus?: BonusRule;
  createdAt?: string;
  updatedAt?: string;
};

export type StatutoryRuleInput = { pt?: PtRule; lwf?: LwfRule; bonus?: BonusRule };

export const listStatutoryRules = () =>
  api<{ rules: StatutoryRuleDTO[] }>('/admin/payroll/statutory-rules').then((r) => r.rules);

export const getStatutoryRule = (state: string) =>
  api<{ rule: StatutoryRuleDTO }>(`/admin/payroll/statutory-rules/${encodeURIComponent(state)}`).then(
    (r) => r.rule,
  );

export const upsertStatutoryRule = (state: string, input: StatutoryRuleInput) =>
  api<{ rule: StatutoryRuleDTO }>(`/admin/payroll/statutory-rules/${encodeURIComponent(state)}`, {
    method: 'PUT',
    body: input,
  }).then((r) => r.rule);

export const deleteStatutoryRule = (state: string) =>
  api(`/admin/payroll/statutory-rules/${encodeURIComponent(state)}`, { method: 'DELETE' });

// ————————————————————————————————————————————————————————————————
// Salary Structure
// ————————————————————————————————————————————————————————————————

export type ComponentLine = {
  code: string;
  name: string;
  category: PayHeadCategory;
  componentType: string;
  calcLabel: string;
  monthlyPaise: number;
  annualPaise: number;
  prorate: boolean;
  considerForEpf: boolean;
};

export type EpfBreakdown = {
  contributionWagePaise: number;
  employeePaise: number;
  employerTotalPaise: number;
  employerEpsPaise: number;
  employerEpfPaise: number;
};

export type ComputedStructure = {
  monthlyCtcPaise: number;
  annualCtcPaise: number;
  earnings: ComponentLine[];
  deductions: ComponentLine[];
  pfWagePaise: number;
  statutory: {
    epf: EpfBreakdown;
    esi: { applicable: boolean; employeePaise: number; employerPaise: number };
    pt: { amountPaise: number };
    lwf: { applicable: boolean; employeePaise: number; employerPaise: number };
  };
  grossMonthlyPaise: number;
  employeeDeductionsMonthlyPaise: number;
  netMonthlyPaise: number;
  benefitsMonthlyPaise: number;
  employerCostMonthlyPaise: number;
  overBudget: boolean;
};

export type EmployeeStatutory = { epf?: boolean; esi?: boolean; lwf?: boolean };

export type SalaryStructureDTO = {
  userId: string;
  salaryTemplateCode?: string;
  annualCtcPaise: number;
  componentValues: Record<string, number>;
  statutory: EmployeeStatutory;
  bonusCategory?: string;
  status: 'draft' | 'active';
  updatedAt: string;
};

export type SalaryStructureInput = {
  salaryTemplateCode?: string;
  annualCtcPaise?: number;
  componentValues?: Record<string, number>;
  statutory?: EmployeeStatutory;
  bonusCategory?: string;
  status?: 'draft' | 'active';
};

export type StructureListRow = {
  userId: string;
  employeeName?: string;
  salaryTemplateCode?: string;
  annualCtcPaise: number;
  status: 'draft' | 'active';
  updatedAt: string;
};

// —— Salary Templates (Pay Groups) ——
export type SalaryTemplateComponent = { payHeadCode: string; calculation: CalculationBasis };
export type SalaryTemplateDTO = {
  id: string;
  name: string;
  code: string;
  description?: string;
  components: SalaryTemplateComponent[];
  balancingComponentCode?: string;
  epfApplyCeiling: boolean;
  active: boolean;
  updatedAt: string;
};
export type SalaryTemplateInput = {
  name: string;
  code: string;
  description?: string;
  components: SalaryTemplateComponent[];
  balancingComponentCode?: string | null;
  epfApplyCeiling?: boolean;
  active?: boolean;
};

export const listSalaryTemplates = () =>
  api<{ templates: SalaryTemplateDTO[] }>('/admin/payroll/salary-templates').then((r) => r.templates);

export const getSalaryTemplate = (code: string) =>
  api<{ template: SalaryTemplateDTO }>(`/admin/payroll/salary-templates/${code}`).then((r) => r.template);

export const createSalaryTemplate = (input: SalaryTemplateInput) =>
  api<{ template: SalaryTemplateDTO }>('/admin/payroll/salary-templates', { method: 'POST', body: input }).then((r) => r.template);

export const updateSalaryTemplate = (code: string, input: SalaryTemplateInput) =>
  api<{ template: SalaryTemplateDTO }>(`/admin/payroll/salary-templates/${code}`, { method: 'PUT', body: input }).then((r) => r.template);

export const deleteSalaryTemplate = (code: string) =>
  api(`/admin/payroll/salary-templates/${code}`, { method: 'DELETE' });

export const previewSalaryTemplate = (input: SalaryTemplateInput & { sampleAnnualCtcPaise: number }) =>
  api<{ computed: ComputedStructure }>('/admin/payroll/salary-templates/preview', { method: 'POST', body: input }).then((r) => r.computed);

export const listSalaryStructures = () =>
  api<{ structures: StructureListRow[] }>('/admin/payroll/salary-structures').then((r) => r.structures);

export const getSalaryStructure = (userId: string) =>
  api<{ structure: SalaryStructureDTO; computed: ComputedStructure }>(
    `/admin/payroll/salary-structures/${userId}`,
  );

export const previewSalaryStructure = (userId: string, input: SalaryStructureInput) =>
  api<{ computed: ComputedStructure }>(`/admin/payroll/salary-structures/${userId}/preview`, {
    method: 'POST',
    body: input,
  }).then((r) => r.computed);

export const saveSalaryStructure = (userId: string, input: SalaryStructureInput) =>
  api<{ structure: SalaryStructureDTO; computed: ComputedStructure }>(
    `/admin/payroll/salary-structures/${userId}`,
    { method: 'PUT', body: input },
  );

// ————————————————————————————————————————————————————————————————
// Payroll Runs
// ————————————————————————————————————————————————————————————————

export type RunStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'paid';

export type RunTotals = {
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  employerCostPaise: number;
};

export type PayrollRunDTO = {
  id: string;
  period: string;
  runType: string;
  status: RunStatus;
  employeeCount: number;
  totals: RunTotals;
  note?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type PayslipDTO = {
  id?: string;
  userId: string;
  employeeName: string;
  department?: string;
  period: string;
  monthlyCtcPaise: number;
  earnings: { code: string; name: string; calcLabel: string; fullPaise: number; paidPaise: number }[];
  deductions: { key: string; name: string; amountPaise: number }[];
  pfWagePaise: number;
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  netPayablePaise: number;
  employerCostPaise: number;
  epf: EpfBreakdown;
  inputs: {
    workingDays: number;
    lopDays: number;
    payableDays: number;
    approvedLeaveDays: number;
    approvedOtHours: number;
    overtimePaise: number;
    reimbursementsPaise: number;
    reimbursementClaimIds: string[];
  };
};

export const listRuns = () =>
  api<{ runs: PayrollRunDTO[] }>('/admin/payroll/runs').then((r) => r.runs);

export const getRun = (runId: string) =>
  api<{ run: PayrollRunDTO; payslips: PayslipDTO[] }>(`/admin/payroll/runs/${runId}`);

export const createRun = (input: { period: string; lopDays?: Record<string, number>; overtimePaise?: Record<string, number> }) =>
  api<{ run: PayrollRunDTO; payslipCount: number }>('/admin/payroll/runs', { method: 'POST', body: input });

export const recomputeRun = (
  runId: string,
  overrides: { lopDays?: Record<string, number>; overtimePaise?: Record<string, number> },
) =>
  api<{ run: PayrollRunDTO }>(`/admin/payroll/runs/${runId}/recompute`, {
    method: 'POST',
    body: overrides,
  }).then((r) => r.run);

export const submitRun = (runId: string) =>
  api<{ run: PayrollRunDTO }>(`/admin/payroll/runs/${runId}/submit`, { method: 'POST' }).then((r) => r.run);

export const decideRun = (runId: string, decision: 'approved' | 'rejected', note?: string) =>
  api<{ run: PayrollRunDTO }>(`/admin/payroll/runs/${runId}/decision`, {
    method: 'POST',
    body: { decision, ...(note ? { note } : {}) },
  }).then((r) => r.run);

export const recallRun = (runId: string) =>
  api<{ run: PayrollRunDTO }>(`/admin/payroll/runs/${runId}/recall`, { method: 'POST' }).then((r) => r.run);

export const markRunPaid = (runId: string) =>
  api<{ run: PayrollRunDTO }>(`/admin/payroll/runs/${runId}/mark-paid`, { method: 'POST' }).then((r) => r.run);
