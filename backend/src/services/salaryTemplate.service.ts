import { ObjectId } from 'mongodb';
import { salaryStructures, salaryTemplates, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import { CalculationBasis, PayHead } from '../models/payHead.model';
import { OvertimePayRule, SalaryTemplate, SalaryTemplateComponent, TemplateStatutoryWages } from '../models/salaryTemplate.model';
import { DEDUCTION_TRIGGERS, DeductionTrigger, SalaryDeductionRule } from '../models/deduction.model';
import { assertAcyclic } from './payHead.service';
import { calculateSalaryStructure, SalaryCalcResult } from './salary-calculator';
import { resolveTemplateComponents } from '../shared/payroll/resolve';
import { resolveRuleSet } from './statutory.service';
import { statutoryConfigForPeriod } from './payrollConfig.service';
import { statutorySettingsFor } from './statutorySettings.service';
import { catalogWithStandard, materializeStandard } from './standardComponents.service';
import { ensurePaidDaysTemplates } from './paidDaysTemplate.service';

export class SalaryTemplateError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SalaryTemplateError';
  }
}

export interface SalaryTemplateInput {
  name?: unknown;
  code?: unknown;
  description?: unknown;
  components?: unknown;
  balancingComponentCode?: unknown;
  epfApplyCeiling?: unknown;
  paidDaysEnabled?: unknown;
  statutoryWages?: unknown;
  deductionRules?: unknown;
  monthlyPaidLeaveDays?: unknown;
  overtimePay?: unknown;
  /** The monthly flexible pool in paise; null removes it, absent keeps it. */
  flexiblePoolPaise?: unknown;
  active?: unknown;
}

type StoredTemplate = SalaryTemplate & { _id: ObjectId };

const MODES = new Set(['flat_amount', 'percentage', 'flat_per_month']);
const BASES = new Set(['ctc', 'basic', 'component']);
const MAX_AMOUNT_PAISE = 100_000_000_000;

// ————————————————————————————————————————————————————————————————
// CRUD
// ————————————————————————————————————————————————————————————————

export async function listSalaryTemplates(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const docs = await salaryTemplates().find({ org }).sort({ name: 1 }).toArray();
  return docs.map(toView);
}

export async function getSalaryTemplate(adminUserId: string, code: string) {
  const org = await requireAdminOrg(adminUserId);
  const doc = await salaryTemplates().findOne({ org, code: normalizeCode(code) });
  if (!doc) throw new SalaryTemplateError(404, 'Salary template not found');
  return toView(doc);
}

export async function createSalaryTemplate(adminUserId: string, input: SalaryTemplateInput) {
  const org = await requireAdminOrg(adminUserId);
  const catalog = await orgCatalog(org);
  const draft = await normalizeInput(input, catalog);
  await ensurePaidDaysTemplates(org);
  // A standard component on the template becomes this org's pay head now.
  await materializeStandard(org, draft.components.map((c) => c.payHeadCode));
  const now = new Date();
  const pool = parseFlexiblePool(input.flexiblePoolPaise);
  const doc: SalaryTemplate = { ...draft, ...(pool ? { flexiblePoolPaise: pool.value } : {}), org, createdAt: now, updatedAt: now };
  try {
    const result = await salaryTemplates().insertOne(doc);
    return toView({ ...doc, _id: result.insertedId });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new SalaryTemplateError(409, `A template with code "${doc.code}" already exists`);
    }
    throw error;
  }
}

export async function updateSalaryTemplate(
  adminUserId: string,
  code: string,
  input: SalaryTemplateInput,
) {
  const org = await requireAdminOrg(adminUserId);
  const current = await salaryTemplates().findOne({ org, code: normalizeCode(code) });
  if (!current) throw new SalaryTemplateError(404, 'Salary template not found');
  const catalog = await orgCatalog(org);
  const draft = await normalizeInput({ code, ...input }, catalog);
  await materializeStandard(org, draft.components.map((c) => c.payHeadCode));
  // The company's Paid Days Templates are made from these fields: make them before anything changes.
  await ensurePaidDaysTemplates(org);
  const paidDaysKeys = ['paidDaysEnabled', 'deductionRules', 'monthlyPaidLeaveDays'] as const;
  const set: Record<string, unknown> = { ...draft, updatedAt: new Date() };
  for (const k of paidDaysKeys) if (set[k] === undefined) delete set[k];
  // The flexible pool: absent keeps what is stored, null removes it.
  const pool = input.flexiblePoolPaise === null ? null : parseFlexiblePool(input.flexiblePoolPaise);
  if (pool) set.flexiblePoolPaise = pool.value;
  const updated = await salaryTemplates().findOneAndUpdate(
    { _id: current._id },
    pool === null ? { $set: set, $unset: { flexiblePoolPaise: '' } } : { $set: set },
    { returnDocument: 'after' },
  );
  if (!updated) throw new SalaryTemplateError(404, 'Salary template not found');
  return toView(updated);
}

export async function deleteSalaryTemplate(adminUserId: string, code: string) {
  const org = await requireAdminOrg(adminUserId);
  // People on the template would silently drop out of every run.
  const people = await salaryStructures().countDocuments({ org, salaryTemplateCode: normalizeCode(code) });
  if (people > 0) {
    throw new SalaryTemplateError(
      409,
      `${people} ${people === 1 ? 'person is' : 'people are'} on this template. Move them to another template on their Salary details first.`,
    );
  }
  const result = await salaryTemplates().deleteOne({ org, code: normalizeCode(code) });
  if (result.deletedCount === 0) throw new SalaryTemplateError(404, 'Salary template not found');
  return { code: normalizeCode(code), deleted: true };
}

/** Compute an (unsaved) template against a sample CTC — powers the live builder. */
export async function previewSalaryTemplate(
  adminUserId: string,
  input: SalaryTemplateInput,
  sampleAnnualCtcPaise: number,
): Promise<SalaryCalcResult> {
  const org = await requireAdminOrg(adminUserId);
  const catalog = await orgCatalog(org);
  const draft = await normalizeInput(input, catalog);
  const resolved = resolveTemplateComponents(draft.components, new Map(catalog.map((h) => [h.code, h])));
  // This month, on this FY's statutory row (409 when it has none).
  const period = new Date().toISOString().slice(0, 7);
  const config = await statutoryConfigForPeriod(period);
  const [ruleSet, settings] = await Promise.all([resolveRuleSet(org, undefined, config), statutorySettingsFor(org)]);
  return calculateSalaryStructure({
    monthlyCtcPaise: Math.round((Number(sampleAnnualCtcPaise) || 0) / 12),
    payHeads: resolved,
    balancingComponentCode: draft.balancingComponentCode,
    ruleSet,
    config,
    settings,
    month: Number(period.slice(5, 7)),
    period,
    statutoryWages: draft.statutoryWages,
  });
}

// ————————————————————————————————————————————————————————————————
// Resolution — turn a template into an effective PayHead[] for the calculator.
// The pay head supplies identity + statutory treatment; the template supplies the
// calculation. Components no longer in the catalog are skipped.
// ————————————————————————————————————————————————————————————————

// applyOverrides and resolveTemplateComponents are pure and shared with the dashboard.
export { applyOverrides, resolveTemplateComponents } from '../shared/payroll/resolve';

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

async function normalizeInput(
  input: SalaryTemplateInput,
  catalog: PayHead[],
): Promise<Omit<SalaryTemplate, 'org' | 'createdAt' | 'updatedAt'>> {
  const byCode = new Map(catalog.map((h) => [h.code, h]));
  const name = requireString(input.name, 'name', 100);
  const code = normalizeCode(input.code);
  // null clears it; never store the word "null".
  const description = input.description === undefined ? undefined : input.description === null ? '' : String(input.description).trim().slice(0, 300);
  const active = input.active === undefined ? true : Boolean(input.active);

  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new SalaryTemplateError(400, 'A template must include at least one component');
  }
  const seen = new Set<string>();
  const componentCodes = new Set<string>();
  for (const raw of input.components) {
    if (!isRecord(raw)) throw new SalaryTemplateError(400, 'Each component must be an object');
    const payHeadCode = normalizeCode(raw.payHeadCode, 'component.payHeadCode');
    if (!byCode.has(payHeadCode)) {
      throw new SalaryTemplateError(400, `Component "${payHeadCode}" is not in the pay head catalog`);
    }
    if (seen.has(payHeadCode)) {
      throw new SalaryTemplateError(400, `Component "${payHeadCode}" is listed twice`);
    }
    seen.add(payHeadCode);
    componentCodes.add(payHeadCode);
  }

  const components: SalaryTemplateComponent[] = input.components.map((raw) => {
    const r = raw as Record<string, unknown>;
    const payHeadCode = normalizeCode(r.payHeadCode, 'component.payHeadCode');
    const out: SalaryTemplateComponent = { payHeadCode, calculation: validateCalculation(r.calculation, payHeadCode, componentCodes) };
    if (typeof r.payslipName === 'string' && r.payslipName.trim()) out.payslipName = r.payslipName.trim().slice(0, 100);
    if (typeof r.showInPayslip === 'boolean') out.showInPayslip = r.showInPayslip;
    return out;
  });

  // Basic is a flat monthly amount or a % of CTC, HRA a flat monthly amount or
  // a % of Basic, the same two choices their Salary Components form offers.
  for (const c of components) {
    const type = byCode.get(c.payHeadCode)?.componentType;
    const base = type === 'basic' ? 'ctc' : type === 'hra' ? 'basic' : undefined;
    if (!base) continue;
    const ok = c.calculation.mode === 'flat_per_month' || (c.calculation.mode === 'percentage' && c.calculation.base === base);
    if (!ok) {
      const label = type === 'basic' ? 'Basic' : 'House Rent Allowance';
      throw new SalaryTemplateError(
        400,
        `${label} is a flat monthly amount or a percentage of ${base === 'ctc' ? 'CTC' : 'Basic'}`,
      );
    }
  }

  // '% of Basic' requires a Basic component in the template.
  const hasBasic = components.some((c) => byCode.get(c.payHeadCode)?.componentType === 'basic');
  if (!hasBasic && components.some((c) => c.calculation.mode === 'percentage' && c.calculation.base === 'basic')) {
    throw new SalaryTemplateError(400, 'A component is "% of Basic" but the template has no Basic component');
  }

  // Paid days now live in Paid Days Templates; a save that leaves these out keeps what is stored.
  const deductionRules = input.deductionRules === undefined ? undefined : parseDeductionRules(input.deductionRules);
  const monthlyPaidLeaveDays = input.monthlyPaidLeaveDays === undefined
    ? undefined
    : input.monthlyPaidLeaveDays === null ? 0 : Math.round(Number(input.monthlyPaidLeaveDays) * 2) / 2;
  if (monthlyPaidLeaveDays !== undefined && (!Number.isFinite(monthlyPaidLeaveDays) || monthlyPaidLeaveDays < 0 || monthlyPaidLeaveDays > 31)) {
    throw new SalaryTemplateError(400, 'Paid leave days a month must be 0 to 31, in halves');
  }

  let balancingComponentCode: string | undefined;
  if (input.balancingComponentCode !== undefined && input.balancingComponentCode !== null && input.balancingComponentCode !== '') {
    balancingComponentCode = normalizeCode(input.balancingComponentCode, 'balancingComponentCode');
    if (!componentCodes.has(balancingComponentCode)) {
      throw new SalaryTemplateError(400, 'The balancing component must be one of the template components');
    }
    if (byCode.get(balancingComponentCode)?.category !== 'earning') {
      throw new SalaryTemplateError(400, 'The balancing component must be an earning');
    }
  }

  // Reject circular percentage references across the template's components.
  assertAcyclic(
    components.map((c) => ({
      code: c.payHeadCode,
      componentType: byCode.get(c.payHeadCode)!.componentType,
      calculation: c.calculation,
    })),
  );

  return {
    name,
    code,
    description,
    components,
    balancingComponentCode,
    epfApplyCeiling: input.epfApplyCeiling === undefined ? undefined : Boolean(input.epfApplyCeiling),
    active,
    paidDaysEnabled: input.paidDaysEnabled === undefined ? undefined : Boolean(input.paidDaysEnabled),
    statutoryWages: parseStatutoryWages(input.statutoryWages, components, byCode),
    deductionRules,
    monthlyPaidLeaveDays,
    overtimePay: parseOvertimePay(input.overtimePay),
  };
}

function parseOvertimePay(raw: unknown): OvertimePayRule | undefined {
  if (raw === undefined || raw === null || raw === '' || (isRecord(raw) && raw.mode === 'off')) return undefined;
  if (!isRecord(raw)) throw new SalaryTemplateError(400, 'Overtime pay is invalid');
  if (raw.mode === 'flat_per_hour') {
    const flat = Number(raw.flatPerHourPaise);
    if (!Number.isInteger(flat) || flat <= 0) throw new SalaryTemplateError(400, 'Enter the overtime amount per hour');
    return { mode: 'flat_per_hour', flatPerHourPaise: flat };
  }
  if (raw.mode !== 'hourly_multiple') throw new SalaryTemplateError(400, 'Overtime pay is invalid');
  const base = raw.base === 'gross' ? 'gross' : 'basic';
  const multiplier = raw.multiplier === undefined ? 2 : Number(raw.multiplier);
  const hoursPerDay = raw.hoursPerDay === undefined ? 8 : Number(raw.hoursPerDay);
  if (!(multiplier > 0 && multiplier <= 5)) throw new SalaryTemplateError(400, 'Overtime multiplier must be more than 0 and at most 5');
  if (!(hoursPerDay >= 1 && hoursPerDay <= 24)) throw new SalaryTemplateError(400, 'Hours a day must be 1 to 24');
  return { mode: 'hourly_multiple', base, multiplier: Math.round(multiplier * 100) / 100, hoursPerDay: Math.round(hoursPerDay * 2) / 2 };
}

export function validateCalculation(raw: unknown, selfCode: string, componentCodes: Set<string>): CalculationBasis {
  if (!isRecord(raw)) throw new SalaryTemplateError(400, `calculation for "${selfCode}" is required`);
  const mode = String(raw.mode);
  if (!MODES.has(mode)) throw new SalaryTemplateError(400, `calculation.mode for "${selfCode}" is invalid`);

  if (mode === 'flat_per_month') {
    return { mode: 'flat_per_month', amountPaise: requireAmountPaise(raw.amountPaise, `${selfCode} amount`) };
  }
  if (mode === 'flat_amount') {
    if (raw.amountPaise === undefined) return { mode: 'flat_amount' };
    return { mode: 'flat_amount', amountPaise: requireAmountPaise(raw.amountPaise, `${selfCode} amount`) };
  }
  // percentage
  const percent = Number(raw.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new SalaryTemplateError(400, `calculation.percent for "${selfCode}" must be 0–100`);
  }
  const base = String(raw.base);
  if (!BASES.has(base)) throw new SalaryTemplateError(400, `calculation.base for "${selfCode}" is invalid`);
  const rounded = Math.round(percent * 100) / 100;
  if (base !== 'component') return { mode: 'percentage', percent: rounded, base: base as 'ctc' | 'basic' };
  const baseComponentCode = normalizeCode(raw.baseComponentCode, `${selfCode} baseComponentCode`);
  if (baseComponentCode === selfCode) {
    throw new SalaryTemplateError(400, `"${selfCode}" cannot be a percentage of itself`);
  }
  if (!componentCodes.has(baseComponentCode)) {
    throw new SalaryTemplateError(400, `"${selfCode}" references "${baseComponentCode}", which is not in the template`);
  }
  return { mode: 'percentage', percent: rounded, base: 'component', baseComponentCode };
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

/** The org's pay heads plus the standard components it hasn't added yet. */
async function orgCatalog(org: string): Promise<PayHead[]> {
  return (await catalogWithStandard(org)).all;
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SalaryTemplateError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new SalaryTemplateError(400, `${field} is too long`);
  return trimmed;
}

function normalizeCode(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SalaryTemplateError(400, `${field} is required`);
  }
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,40}$/.test(code)) {
    throw new SalaryTemplateError(400, `${field} must be 1-40 chars of A-Z, 0-9, or underscore`);
  }
  return code;
}

/** A flexible pool sent on a save: whole rupees in paise. Undefined: not sent. */
function parseFlexiblePool(value: unknown): { value: number } | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const amount = requireAmountPaise(value, 'flexiblePoolPaise');
  if (amount % 100 !== 0) throw new SalaryTemplateError(400, 'flexiblePoolPaise must be whole rupees');
  return { value: amount };
}

function requireAmountPaise(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT_PAISE) {
    throw new SalaryTemplateError(400, `${field} must be a non-negative integer amount in paise`);
  }
  return amount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && (error as { code?: number }).code === 11000;
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }));
  if (!admin) throw new SalaryTemplateError(404, 'User not found');
  if (!admin.org) throw new SalaryTemplateError(409, 'User is not attached to a company');
  return admin.org;
}

function toView(doc: StoredTemplate) {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    code: doc.code,
    description: doc.description,
    components: doc.components,
    balancingComponentCode: doc.balancingComponentCode,
    epfApplyCeiling: doc.epfApplyCeiling ?? true,
    paidDaysEnabled: doc.paidDaysEnabled ?? true,
    statutoryWages: doc.statutoryWages ?? null,
    deductionRules: doc.deductionRules ?? [],
    monthlyPaidLeaveDays: doc.monthlyPaidLeaveDays ?? 0,
    overtimePay: doc.overtimePay ?? null,
    flexiblePoolPaise: doc.flexiblePoolPaise ?? null,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * The template's PF / ESI wage applicability. Absent, null or every field
 * left out is the default (each component's own EPF flag, the org's PF
 * setting, ESI on gross). Named components must be earnings on the template.
 */
function parseStatutoryWages(
  value: unknown,
  components: SalaryTemplateComponent[],
  byCode: Map<string, PayHead>,
): TemplateStatutoryWages | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new SalaryTemplateError(400, 'statutoryWages must be an object');
  const earnings = new Set(components.map((c) => c.payHeadCode).filter((code) => byCode.get(code)?.category === 'earning'));
  const codes = (raw: unknown, what: string): string[] | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw)) throw new SalaryTemplateError(400, `${what} must be a list of component codes`);
    const out = [...new Set(raw.map((c) => normalizeCode(c, what)))];
    for (const code of out) {
      // The synthetic Statutory Bonus line may be named for ESI.
      if (!earnings.has(code) && code !== 'STATUTORY_BONUS') throw new SalaryTemplateError(400, `${what}: "${code}" is not an earning on this template`);
    }
    return out;
  };
  const out: TemplateStatutoryWages = {};
  const pf = codes(value.pfComponents, 'PF wage components');
  if (pf) out.pfComponents = pf;
  const esi = codes(value.esiComponents, 'ESI wage components');
  if (esi) out.esiComponents = esi;
  if (value.pfWageMode !== undefined && value.pfWageMode !== null) {
    const mode = String(value.pfWageMode);
    if (mode !== 'org' && mode !== 'actual' && mode !== 'ceiling') throw new SalaryTemplateError(400, 'pfWageMode must be org, actual or ceiling');
    if (mode !== 'org') out.pfWageMode = mode;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The attendance deduction rules, validated. Absent means none. */
export function parseDeductionRules(value: unknown): SalaryDeductionRule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SalaryTemplateError(400, 'deductionRules must be a list');
  return value.map((raw) => {
    if (!isRecord(raw)) throw new SalaryTemplateError(400, 'Each deduction rule must be an object');
    const trigger = String(raw.trigger ?? '');
    if (!DEDUCTION_TRIGGERS.includes(trigger as DeductionTrigger)) {
      throw new SalaryTemplateError(400, `A deduction rule must count one of: ${DEDUCTION_TRIGGERS.join(', ')}`);
    }
    const every = Number(raw.every);
    if (!Number.isInteger(every) || every < 1 || every > 31) throw new SalaryTemplateError(400, 'Occurrences per deduction must be a whole number from 1 to 31');
    const deductDays = Math.round(Number(raw.deductDays) * 2) / 2;
    if (!Number.isFinite(deductDays) || deductDays <= 0 || deductDays > 31) throw new SalaryTemplateError(400, 'Paid days deducted must be more than 0 and at most 31, in halves');
    return { trigger: trigger as DeductionTrigger, every, deductDays, active: raw.active === undefined ? true : Boolean(raw.active) };
  });
}
