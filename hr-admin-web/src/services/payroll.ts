// Typed calls against the payroll admin endpoints (/admin/payroll/*).
// All money crosses the wire as INTEGER PAISE.
import { api } from './http';
import { standardNotAdded } from '../../../backend/src/shared/payroll/standard-components';

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

// `if_pf_wage_below_15000` is the old name for the ceiling condition (now ₹25,000).
export type StatutoryConsideration = { consider: boolean; condition?: 'always' | 'if_pf_wage_below_ceiling' | 'if_pf_wage_below_15000' };

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
  unclaimedHandling?: 'carry_forward' | 'encash_monthly';
  payslipName?: string;
  taxable?: boolean;
  partOfStructure?: boolean;
  showInPayslip?: boolean;
  active: boolean;
  /** A built-in standard component this org hasn't added yet (not saved; id is empty). */
  standard?: boolean;
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
  prorate?: boolean;
  recurrence?: 'recurring' | 'one_time';
  maxClaimablePaise?: number;
  unclaimedHandling?: 'carry_forward' | 'encash_monthly';
  payslipName?: string;
  taxable?: boolean;
  partOfStructure?: boolean;
  showInPayslip?: boolean;
  active?: boolean;
};

export const listPayHeads = () =>
  api<{ payHeads: PayHeadDTO[] }>('/admin/payroll/pay-heads').then((r) => r.payHeads);

/**
 * The built-in standard components (shared with the server), as catalog rows
 * for the ones this org hasn't added yet. Saved as its pay head on first use.
 */
export function standardPayHeads(own: PayHeadDTO[]): PayHeadDTO[] {
  return standardNotAdded(own).map((s) => {
    const row = { ...s, id: '', active: true, standard: true } as PayHeadDTO & { uniqueType?: boolean };
    delete row.uniqueType;
    return row;
  });
}

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
// Statutory settings — org-wide, what Payroll › Statutory Components edits.
// ————————————————————————————————————————————————————————————————

export type PfRateMode = 'restricted' | 'actual';
export type EpfSettings = {
  enabled: boolean;
  epfNumber?: string;
  employeeRate: PfRateMode;
  employerRate: PfRateMode;
  includeEmployer: boolean;
  includeEDLI: boolean;
  includeAdmin: boolean;
  overrideAtEmployee: boolean;
  proRateRestricted: boolean;
  considerLOP: boolean;
};
export type EsiSettings = { enabled: boolean; esiNumber?: string; includeEmployer: boolean };
export type MinWageRow = { category: string; minWagePaise: number; effectiveFrom: string };
export type BonusSettings = { enabled: boolean; frequency: 'monthly' | 'yearly'; ratePercent: number; minWages: Record<string, MinWageRow[]> };
export type TdsSettings = { enabled: boolean; defaultRegime: 'new' | 'old' };
export type StatutorySettingsDTO = { epf: EpfSettings; esi: EsiSettings; bonus: BonusSettings; lwfDisabledStates: string[]; tds?: TdsSettings };
export type StatutoryOverview = {
  settings: StatutorySettingsDTO;
  ceilingPaise: number;
  /** Work locations on the roster, with the Professional Tax rule of their state. */
  pt: { location: string; state: string; pt: PtRule | null }[];
  /** Work states on the roster, with their Labour Welfare Fund rule and whether it is switched on. */
  lwf: { state: string; rule: LwfRule | null; enabled: boolean }[];
  states: string[];
};
export type StatutorySettingsInput = {
  epf?: Partial<EpfSettings>;
  esi?: Partial<EsiSettings>;
  bonus?: Partial<BonusSettings>;
  lwf?: { state: string; enabled: boolean };
  tds?: Partial<TdsSettings>;
};

export const getStatutorySettings = () =>
  api<StatutoryOverview>('/admin/payroll/statutory-settings');

export const updateStatutorySettings = (input: StatutorySettingsInput) =>
  api<StatutoryOverview>('/admin/payroll/statutory-settings', { method: 'PUT', body: input });

// ————————————————————————————————————————————————————————————————
// Salary Structure
// ————————————————————————————————————————————————————————————————

export type ComponentLine = {
  code: string;
  name: string;
  /** How the line reads on the payslip. */
  payslipName?: string;
  /** Listed on the payslip; hidden lines still count in every total. */
  showInPayslip?: boolean;
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
  edliPaise?: number;
  adminPaise?: number;
};

export type ComputedStructure = {
  monthlyCtcPaise: number;
  annualCtcPaise: number;
  earnings: ComponentLine[];
  /** Paid every month at their amount, inside CTC, outside gross pay. */
  reimbursements?: ComponentLine[];
  /** Employer-paid benefits (gratuity…), inside CTC. */
  benefits?: ComponentLine[];
  deductions: ComponentLine[];
  pfWagePaise: number;
  /** Employer contributions the org's statutory settings place inside CTC. */
  includedInCtcPaise?: number;
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

export type EmployeeStatutory = {
  epf?: boolean;
  esi?: boolean;
  lwf?: boolean;
  pfActualWage?: boolean;
  /** false: the employer's 12% all goes to PF, nothing to the pension scheme. */
  contributeEps?: boolean;
  pfAccountNumber?: string;
  uan?: string;
  esiNumber?: string;
  /** This person's restricted PF wage in paise, when it differs from the ceiling. */
  pfRestrictedWagePaise?: number;
};

/** A person's own changes on top of the assigned template. */
export type StructureOverrides = {
  add?: { payHeadCode: string; calculation: CalculationBasis }[];
  remove?: string[];
  edit?: Record<string, CalculationBasis>;
};
export type SalaryRevision = { previousCtcPaise: number; annualCtcPaise: number; effectiveFrom: string; at: string };
/** One line of a person's resolved structure, with where it came from. */
export type StructureComponent = { payHeadCode: string; calculation: CalculationBasis; source: 'template' | 'edited' | 'added' };

export type SalaryStructureDTO = {
  userId: string;
  salaryTemplateCode?: string;
  templateName?: string;
  /** The person's Paid Days Template; absent = the company's Default. */
  paidDaysTemplateCode?: string;
  annualCtcPaise: number;
  componentValues: Record<string, number>;
  overrides: StructureOverrides;
  revisions: SalaryRevision[];
  statutory: EmployeeStatutory;
  bonusCategory?: string;
  status: 'draft' | 'active';
  updatedAt: string;
};

export type SalaryStructureInput = {
  salaryTemplateCode?: string;
  annualCtcPaise?: number;
  componentValues?: Record<string, number>;
  overrides?: StructureOverrides;
  /** "YYYY-MM-DD": when a CTC change applies from. */
  effectiveFrom?: string;
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

// —— Attendance deductions, as a salary template defines them ——
export type DeductionTrigger = 'late' | 'early' | 'absent' | 'half_day' | 'leave' | 'missed_punch';
export const DEDUCTION_TRIGGER_LABELS: Record<DeductionTrigger, string> = {
  late: 'Late arrivals',
  early: 'Early leaves',
  absent: 'Absent days',
  half_day: 'Half days',
  leave: 'Leave days',
  missed_punch: 'Missed punches',
};
/** Every `every` occurrences in a month cost `deductDays` paid days. */
export type SalaryDeductionRule = { trigger: DeductionTrigger; every: number; deductDays: number; active: boolean };

// —— Salary Templates (Pay Groups) ——
export type SalaryTemplateComponent = {
  payHeadCode: string;
  calculation: CalculationBasis;
  /** This template's payslip label for the component; falls back to the component's. */
  payslipName?: string;
  /** Whether this template lists the component on the payslip; falls back to the component's. */
  showInPayslip?: boolean;
};
/**
 * Which components make up the PF and ESI wage for a template, and how PF is
 * applied. Every field absent = the defaults: each component's own "Consider
 * for EPF", the org's PF setting, and ESI on gross pay.
 */
export type TemplateStatutoryWages = {
  pfComponents?: string[];
  pfWageMode?: 'org' | 'actual' | 'ceiling';
  esiComponents?: string[];
};
export type SalaryTemplateDTO = {
  id: string;
  name: string;
  code: string;
  description?: string;
  components: SalaryTemplateComponent[];
  balancingComponentCode?: string;
  epfApplyCeiling: boolean;
  /** Whether the run reads attendance for the people on this template. */
  paidDaysEnabled?: boolean;
  statutoryWages?: TemplateStatutoryWages | null;
  deductionRules: SalaryDeductionRule[];
  monthlyPaidLeaveDays: number;
  overtimePay?: OvertimePayRule | null;
  active: boolean;
  updatedAt: string;
};
/** How approved overtime hours become pay; null = HR types it on the run. */
export type OvertimePayRule = {
  mode: 'hourly_multiple' | 'flat_per_hour';
  base?: 'basic' | 'gross';
  multiplier?: number;
  hoursPerDay?: number;
  flatPerHourPaise?: number;
};
export type SalaryTemplateInput = {
  name: string;
  code: string;
  description?: string;
  components: SalaryTemplateComponent[];
  balancingComponentCode?: string | null;
  epfApplyCeiling?: boolean;
  paidDaysEnabled?: boolean;
  /** null clears it back to the defaults. */
  statutoryWages?: TemplateStatutoryWages | null;
  deductionRules?: SalaryDeductionRule[];
  monthlyPaidLeaveDays?: number;
  overtimePay?: OvertimePayRule | null;
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

export type StructureResponse = { structure: SalaryStructureDTO; computed: ComputedStructure; components: StructureComponent[] };

/** How attendance becomes paid days, per person; one Default per company. */
export type PaidDaysTemplateDTO = {
  code: string;
  name: string;
  description: string;
  /** Every day of the month is paid: the attendance calendar is not read. */
  allDaysPaid: boolean;
  deductionRules: SalaryDeductionRule[];
  monthlyPaidLeaveDays: number;
  isDefault: boolean;
  /** People it applies to (for the Default: everyone with a salary not given another). */
  people: number;
  updatedAt: string;
};
export type PaidDaysTemplateInput = Pick<PaidDaysTemplateDTO, 'name' | 'description' | 'allDaysPaid' | 'deductionRules' | 'monthlyPaidLeaveDays'>;

export const listPaidDaysTemplates = () =>
  api<{ templates: PaidDaysTemplateDTO[] }>('/admin/payroll/paid-days-templates').then((r) => r.templates);
export const createPaidDaysTemplate = (input: PaidDaysTemplateInput) =>
  api<{ template: PaidDaysTemplateDTO }>('/admin/payroll/paid-days-templates', { method: 'POST', body: input }).then((r) => r.template);
export const updatePaidDaysTemplate = (code: string, input: PaidDaysTemplateInput) =>
  api<{ template: PaidDaysTemplateDTO }>(`/admin/payroll/paid-days-templates/${encodeURIComponent(code)}`, { method: 'PUT', body: input }).then((r) => r.template);
export const deletePaidDaysTemplate = (code: string) =>
  api<{ deleted: boolean }>(`/admin/payroll/paid-days-templates/${encodeURIComponent(code)}`, { method: 'DELETE' });
export const makeDefaultPaidDaysTemplate = (code: string) =>
  api<{ templates: PaidDaysTemplateDTO[] }>(`/admin/payroll/paid-days-templates/${encodeURIComponent(code)}/default`, { method: 'POST' }).then((r) => r.templates);
/** null puts the person back on the Default. */
export const assignPaidDaysTemplate = (userId: string, code: string | null) =>
  api<{ paidDaysTemplateCode: string | null }>(`/admin/payroll/salary-structures/${userId}/paid-days-template`, { method: 'PUT', body: { code } });

export const getSalaryStructure = (userId: string) =>
  api<StructureResponse>(`/admin/payroll/salary-structures/${userId}`);

export const previewSalaryStructure = (userId: string, input: SalaryStructureInput) =>
  api<{ computed: ComputedStructure; components: StructureComponent[] }>(`/admin/payroll/salary-structures/${userId}/preview`, {
    method: 'POST',
    body: input,
  });

export const saveSalaryStructure = (userId: string, input: SalaryStructureInput) =>
  api<StructureResponse>(`/admin/payroll/salary-structures/${userId}`, { method: 'PUT', body: input });

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
  /** The run's creator may approve it: nobody else in the company can. */
  creatorMayApprove?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PayslipDTO = {
  id?: string;
  /** This financial year up to and including this month, per earning code / deduction key. */
  ytd?: { earnings: Record<string, number>; deductions: Record<string, number>; reimbursementsPaise: number };
  /** Bank account the salary goes to (in full for payroll people). */
  bankAccountNo?: string;
  userId: string;
  employeeName: string;
  department?: string;
  employeeId?: string;
  designation?: string;
  joiningDate?: string;
  period: string;
  monthlyCtcPaise: number;
  /** `name` is the payslip label; `hidden` lines are not listed but count in every total. */
  earnings: { code: string; name: string; calcLabel: string; fullPaise: number; paidPaise: number; hidden?: boolean }[];
  deductions: { key: string; name: string; amountPaise: number; hidden?: boolean }[];
  pfWagePaise: number;
  grossPaise: number;
  employeeDeductionsPaise: number;
  netPaise: number;
  reimbursementsPaise: number;
  netPayablePaise: number;
  employerCostPaise: number;
  epf: EpfBreakdown;
  annualCtcPaise?: number;
  /** What the employer pays on top of gross, line by line. */
  employer?: { epfPaise: number; epsPaise: number; edliPaise: number; adminPaise: number; esiPaise: number; lwfPaise: number; benefitsPaise: number; totalPaise: number };
  esiApplicable?: boolean;
  /** The structure's reimbursements paid this month. */
  reimbursementLines?: { code: string; name: string; amountPaise: number; hidden?: boolean }[];
  inputs: {
    workingDays: number;
    lopDays: number;
    /** What attendance and the template's rules made the loss of pay. */
    attendanceLopDays?: number;
    lopEnteredByHr?: boolean;
    incomeTaxPaise?: number;
    incomeTaxEnteredByHr?: boolean;
    overtimeEnteredByHr?: boolean;
    componentAmounts?: Record<string, number>;
    /** How the TDS engine reached the income tax, when HR didn't type it. */
    tds?: TdsResultDTO & { proofs?: string };
    attendanceDeductions?: { label: string; count: number; days: number; trigger?: DeductionTrigger; every?: number; deductDays?: number }[];
    paidLeaveDaysApplied?: number;
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
  api<{ run: PayrollRunDTO; payslips: PayslipDTO[]; company: { name: string; address: string } }>(`/admin/payroll/runs/${runId}`);

/** A payslip's TDS work sheet, as Zoho lays it out (amounts in paise). */
export type TdsSheetDTO = {
  company: { name: string; address: string; org?: string };
  period: string;
  monthName: string;
  year: number;
  fy: string;
  regime: 'new' | 'old';
  configStatus: string;
  employee: { name: string; employeeId?: string; designation?: string; pan?: string };
  earnings: { name: string; actualPaise: number; projectionPaise: number; totalPaise: number }[];
  grossPaise: number;
  exemptions: { name: string; paise: number }[];
  exemptPaise: number;
  afterExemptionPaise: number;
  previousEmployment: { incomePaise: number; professionalTaxPaise: number };
  grossTotalPaise: number;
  section19: { entertainmentPaise: number; taxOnEmploymentPaise: number; standardDeductionPaise: number; totalPaise: number };
  chargeablePaise: number;
  otherIncomePaise: number;
  grossTotalIncomePaise: number;
  chapterVIII: { name: string; qualifyingPaise: number; deductiblePaise: number }[];
  chapterVIIIPaise: number;
  totalIncomePaise: number;
  tax: {
    slabRows: { fromPaise: number; toPaise: number | null; ratePercent: number; onPaise: number; taxPaise: number }[];
    slabTaxPaise: number;
    rebatePaise: number;
    marginalReliefPaise: number;
    taxAfterRebatePaise: number;
    surchargePaise: number;
    cessPaise: number;
    cessPercent: number;
    cessOnPaise: number;
    relief157Paise: number;
    annualTaxPaise: number;
  };
  rebateRule: { incomeLimitPaise: number; maxRebatePaise: number };
  tds: { tillLastMonthPaise: number; thisMonthPaise: number; previousEmployerPaise: number; totalPaise: number; payablePaise: number; monthsAfter: number; perMonthNextPaise: number };
  /** Months this FY paid before Sowaka, filled in from the salary. */
  estimatedPeriods: string[];
};

export const getTdsSheet = (payslipId: string) =>
  api<{ sheet: TdsSheetDTO }>(`/admin/payroll/payslips/${payslipId}/tds-sheet`).then((r) => r.sheet);

// —— Payroll reports and dashboard (finished runs; includeDrafts previews the rest) ——
export type ReportLine = { name: string; paise: number };
export type PayrollSummaryReport = {
  from: string; to: string; employees: number;
  runs: { period: string; status: RunStatus }[];
  sections: { title: string; rows: ReportLine[]; totalLabel: string; totalPaise: number }[];
  netPayPaise: number; costToCompanyPaise: number; balancesPaise: number;
};
export type SalaryRegisterRow = {
  employeeId: string; name: string; department: string; designation: string; workLocation: string; joiningDate: string;
  paymentMode: string; bankName: string; accountNumber: string; ifsc: string; annualCtcPaise: number;
  baseDays: number; lopDays: number; paidDays: number;
  earnings: Record<string, number>; grossPaise: number; reimbursements: Record<string, number>; reimbursementsPaise: number;
  deductions: Record<string, number>; taxOnIncomePaise: number; surchargePaise: number; cessPaise: number; incomeTaxPaise: number;
  totalDeductionsPaise: number; employer: Record<string, number>; employerTotalPaise: number; netPayPaise: number;
};
export type SalaryRegisterReport = {
  period: string; run: { id: string; status: RunStatus } | null;
  columns: { earnings: { code: string; name: string }[]; reimbursements: { code: string; name: string }[]; deductions: { key: string; name: string }[]; employer: { key: string; name: string }[] };
  rows: SalaryRegisterRow[];
};
export type LiabilityReport = { from: string; to: string; runs: { period: string; status: RunStatus }[]; rows: { key: string; name: string; employeePaise: number; employerPaise: number; totalPaise: number }[]; totalPaise: number };
export type PtSummaryReport = { period: string; run: { status: RunStatus } | null; rows: { employeeId: string; name: string; workLocation: string; status: string; employeeType: string; ptPaise: number }[]; totalPaise: number };
export type PtAnnualReport = { fy: string; rows: { period: string; periodEnd: string; status: RunStatus; employees: number; ptPaise: number }[]; totalPaise: number };
export type PaymentDetailsReport = { period: string; status: RunStatus; rows: { employeeId: string; name: string; paymentMode: string; bankName: string; accountNumber: string; ifsc: string; netPayPaise: number }[] };
export type CostRange = 'this_year' | 'this_quarter' | 'previous_year' | 'previous_quarter';
export type PayrollDashboardReport = {
  currentRun: { id: string | null; period: string; status: RunStatus | 'not_started'; employees: number; netPayPaise: number; payDate: string };
  dues: { period: string; status: RunStatus; epfPaise: number; esiPaise: number; tdsPaise: number; ptPaise: number; lwfPaise: number } | null;
  people: { active: number; withSalary: number; noSalary: number; noBankAccount: number; noPan: number };
  cost: { range: CostRange; label: string; months: { period: string; status: RunStatus | null; netPayPaise: number; taxesPaise: number; deductionsPaise: number; employerPaise: number }[] };
  todo: { pendingClaims: number; runsAwaitingApproval: number };
};
const reportQs = (q: Record<string, string | boolean | undefined>) =>
  Object.entries(q).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
const report = <T,>(path: string, q: Record<string, string | boolean | undefined>) =>
  api<{ report: T }>(`/admin/payroll/${path}?${reportQs(q)}`).then((r) => r.report);
export const getPayrollDashboard = (range: CostRange, includeDrafts: boolean) => report<PayrollDashboardReport>('reports/dashboard', { range, includeDrafts });
export const getPayrollSummary = (from: string, to: string, includeDrafts: boolean) => report<PayrollSummaryReport>('reports/payroll-summary', { from, to, includeDrafts });
export const getSalaryRegister = (period: string, includeDrafts: boolean) => report<SalaryRegisterReport>('reports/salary-register', { period, includeDrafts });
export const getLiabilitySummary = (from: string, to: string, includeDrafts: boolean) => report<LiabilityReport>('reports/liability-summary', { from, to, includeDrafts });
export const getPtSummary = (period: string, includeDrafts: boolean) => report<PtSummaryReport>('reports/pt-summary', { period, includeDrafts });
export const getPtAnnual = (fy: string, includeDrafts: boolean) => report<PtAnnualReport>('reports/pt-annual', { fy, includeDrafts });
export const getRunPaymentDetails = (runId: string) => report<PaymentDetailsReport>(`runs/${runId}/payment-details`, {});

export const createRun = (input: { period: string; lopDays?: Record<string, number>; overtimePaise?: Record<string, number> }) =>
  api<{ run: PayrollRunDTO; payslipCount: number }>('/admin/payroll/runs', { method: 'POST', body: input });

/** Per-person figures HR types on a draft run. A null clears one back to attendance / none; people left out keep what was typed before. */
export type RunOverrides = {
  lopDays?: Record<string, number | null>;
  overtimePaise?: Record<string, number | null>;
  incomeTaxPaise?: Record<string, number | null>;
  /** This month only: one-time earnings and deductions per person, paise by component code. */
  componentAmounts?: Record<string, Record<string, number | null> | null>;
};
export const recomputeRun = (
  runId: string,
  overrides: RunOverrides,
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

/** One employee's payslips across runs, newest first, with the company for the printed slip. */
export const getEmployeePayslips = (userId: string) =>
  api<{ company: { name: string; address: string }; payslips: { run: PayrollRunDTO; payslip: PayslipDTO }[] }>(`/admin/employees/${userId}/payslips`);

// ————————————————————————————————————————————————————————————————
// Bank account, PAN and UAN — encrypted at rest; in full only with payroll access.
// ————————————————————————————————————————————————————————————————

export type PaymentDetailsDTO = {
  payMode?: 'bank_transfer' | 'cheque' | 'cash';
  bankName?: string;
  accountHolder?: string;
  accountType?: 'savings' | 'current';
  ifsc?: string;
  /** In full with payroll access, else "•••• 1234". */
  accountNumber?: string;
  pan?: string;
  uan?: string;
  unmasked: boolean;
  canEdit: boolean;
  updatedAt?: string;
};
export type PaymentDetailsInput = Partial<Omit<PaymentDetailsDTO, 'unmasked' | 'canEdit' | 'updatedAt'>>;

export const getPaymentDetails = (userId: string) =>
  api<{ details: PaymentDetailsDTO }>(`/admin/payroll/employees/${userId}/payment-details`).then((r) => r.details);

export const savePaymentDetails = (userId: string, input: PaymentDetailsInput) =>
  api<{ details: PaymentDetailsDTO }>(`/admin/payroll/employees/${userId}/payment-details`, { method: 'PUT', body: input }).then((r) => r.details);

// ————————————————————————————————————————————————————————————————
// Income tax: the TDS engine's working, and each person's declaration.
// ————————————————————————————————————————————————————————————————

export type TdsResultDTO = {
  regime: 'new' | 'old';
  fy: string;
  configStatus: 'to_confirm' | 'confirmed';
  grossSalaryPaise: number;
  standardDeductionPaise: number;
  hraExemptPaise: number;
  ptDeductionPaise: number;
  chapterVIAPaise: number;
  homeLoanPaise: number;
  taxableIncomePaise: number;
  slabTaxPaise: number;
  rebatePaise: number;
  surchargePaise: number;
  cessPaise: number;
  annualTaxPaise: number;
  alreadyDeductedPaise: number;
  monthsLeft: number;
  monthlyTdsPaise: number;
};
export type TaxDeclarations = {
  sec80C?: number;
  sec80CCD1B?: number;
  sec80DSelf?: number;
  sec80DParents?: number;
  selfSenior?: boolean;
  parentsSenior?: boolean;
  homeLoanInterest?: number;
  sec80TTA?: number;
  rentPaidPaise?: number;
  metro?: boolean;
  otherIncomePaise?: number;
  previousEmployerSalaryPaise?: number;
  previousEmployerTdsPaise?: number;
};
export type TaxDeclarationDTO = { regime: 'new' | 'old'; declarations: TaxDeclarations; proofs: 'none' | 'submitted' | 'verified'; updatedAt?: string };
export type TaxDeclarationResponse = { fy: string; declaration: TaxDeclarationDTO | null; configs: { regime: 'new' | 'old'; status: string; source?: string }[] };

export const getTaxDeclaration = (userId: string, fy?: string) =>
  api<TaxDeclarationResponse>(`/admin/payroll/employees/${userId}/tax-declaration${fy ? `?fy=${fy}` : ''}`);

export const saveTaxDeclaration = (userId: string, input: Omit<TaxDeclarationDTO, 'updatedAt'>, fy?: string) =>
  api<TaxDeclarationResponse>(`/admin/payroll/employees/${userId}/tax-declaration${fy ? `?fy=${fy}` : ''}`, { method: 'PUT', body: input });
