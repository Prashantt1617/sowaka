import { ObjectId } from 'mongodb';
import { payHeads, salaryTemplates, users } from '../config/db';
import { CalculationBasis, PayHead } from '../models/payHead.model';
import { SalaryTemplate, SalaryTemplateComponent } from '../models/salaryTemplate.model';
import { assertAcyclic } from './payHead.service';
import { calculateSalaryStructure, SalaryCalcResult } from './salary-calculator';
import { resolveRuleSet } from './statutory.service';

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
  const now = new Date();
  const doc: SalaryTemplate = { ...draft, org, createdAt: now, updatedAt: now };
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
  const updated = await salaryTemplates().findOneAndUpdate(
    { _id: current._id },
    { $set: { ...draft, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new SalaryTemplateError(404, 'Salary template not found');
  return toView(updated);
}

export async function deleteSalaryTemplate(adminUserId: string, code: string) {
  const org = await requireAdminOrg(adminUserId);
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
  const ruleSet = await resolveRuleSet(org, undefined);
  return calculateSalaryStructure({
    monthlyCtcPaise: Math.round((Number(sampleAnnualCtcPaise) || 0) / 12),
    payHeads: resolved,
    balancingComponentCode: draft.balancingComponentCode,
    epfApplyCeiling: draft.epfApplyCeiling,
    ruleSet,
    month: new Date().getUTCMonth() + 1,
  });
}

// ————————————————————————————————————————————————————————————————
// Resolution — turn a template into an effective PayHead[] for the calculator.
// The pay head supplies identity + statutory treatment; the template supplies the
// calculation. Components no longer in the catalog are skipped.
// ————————————————————————————————————————————————————————————————

export function resolveTemplateComponents(
  components: SalaryTemplateComponent[],
  catalogByCode: Map<string, PayHead>,
): PayHead[] {
  const resolved: PayHead[] = [];
  for (const c of components) {
    const head = catalogByCode.get(c.payHeadCode);
    if (!head) continue;
    resolved.push({ ...head, calculation: c.calculation, active: true });
  }
  return resolved;
}

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
  const description = input.description === undefined ? undefined : String(input.description).trim().slice(0, 300);
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
    return { payHeadCode, calculation: validateCalculation(r.calculation, payHeadCode, componentCodes) };
  });

  // '% of Basic' requires a Basic component in the template.
  const hasBasic = components.some((c) => byCode.get(c.payHeadCode)?.componentType === 'basic');
  if (!hasBasic && components.some((c) => c.calculation.mode === 'percentage' && c.calculation.base === 'basic')) {
    throw new SalaryTemplateError(400, 'A component is "% of Basic" but the template has no Basic component');
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
  };
}

function validateCalculation(raw: unknown, selfCode: string, componentCodes: Set<string>): CalculationBasis {
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

async function orgCatalog(org: string): Promise<PayHead[]> {
  return payHeads().find({ org }).toArray();
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
  const admin = await users().findOne({ userId: adminUserId });
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
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
