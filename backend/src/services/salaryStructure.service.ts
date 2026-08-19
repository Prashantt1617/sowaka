import { payHeads, salaryStructures, salaryTemplates, users } from '../config/db';
import { PayHead } from '../models/payHead.model';
import { EmployeeStatutory, SalaryStructure } from '../models/salaryStructure.model';
import { User } from '../models/user.model';
import { calculateSalaryStructure, SalaryCalcResult } from './salary-calculator';
import { resolveTemplateComponents } from './salaryTemplate.service';
import { resolveRuleSet } from './statutory.service';

export class SalaryStructureError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SalaryStructureError';
  }
}

export interface SalaryStructureInput {
  salaryTemplateCode?: unknown;
  annualCtcPaise?: unknown;
  componentValues?: unknown;
  statutory?: unknown;
  bonusCategory?: unknown;
  status?: unknown;
}

export async function listSalaryStructures(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const docs = await salaryStructures().find({ org }).toArray();
  const employees = await users()
    .find({ userId: { $in: docs.map((d) => d.userId) } })
    .toArray();
  const byId = new Map(employees.map((e) => [e.userId, e]));
  return docs.map((doc) => ({
    userId: doc.userId,
    employeeName: byId.get(doc.userId)?.name,
    salaryTemplateCode: doc.salaryTemplateCode,
    annualCtcPaise: doc.annualCtcPaise,
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

/** The saved structure plus its freshly computed breakup. */
export async function getSalaryStructure(adminUserId: string, userId: string) {
  const org = await requireAdminOrg(adminUserId);
  const doc = await salaryStructures().findOne({ org, userId });
  if (!doc) throw new SalaryStructureError(404, 'No salary structure for this employee');
  const computed = await compute(org, userId, doc);
  return { structure: viewOf(doc), computed };
}

export async function upsertSalaryStructure(
  adminUserId: string,
  userId: string,
  input: SalaryStructureInput,
) {
  const org = await requireAdminOrg(adminUserId);
  const employee = await requireOrgEmployee(org, userId);
  const catalog = await orgPayHeads(org);
  const draft = normalizeInput(input, catalog);

  const existing = await salaryStructures().findOne({ org, userId });
  const now = new Date();
  const merged: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: draft.salaryTemplateCode ?? existing?.salaryTemplateCode,
    annualCtcPaise: draft.annualCtcPaise ?? existing?.annualCtcPaise ?? 0,
    componentValues: draft.componentValues ?? existing?.componentValues,
    statutory: draft.statutory ?? existing?.statutory,
    bonusCategory: draft.bonusCategory ?? existing?.bonusCategory,
    status: draft.status ?? existing?.status ?? 'draft',
    effectiveFrom: existing?.effectiveFrom,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await salaryStructures().updateOne({ org, userId }, { $set: merged }, { upsert: true });
  const computed = await compute(org, userId, merged, employee, catalog);
  return { structure: viewOf(merged), computed };
}

/** Compute a breakup WITHOUT saving — powers the live assignment editor. */
export async function previewSalaryStructure(
  adminUserId: string,
  userId: string,
  input: SalaryStructureInput,
) {
  const org = await requireAdminOrg(adminUserId);
  const employee = await requireOrgEmployee(org, userId);
  const catalog = await orgPayHeads(org);
  const draft = normalizeInput(input, catalog);
  const provisional: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: draft.salaryTemplateCode,
    annualCtcPaise: draft.annualCtcPaise ?? 0,
    componentValues: draft.componentValues,
    statutory: draft.statutory,
    bonusCategory: draft.bonusCategory,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const computed = await compute(org, userId, provisional, employee, catalog);
  return { computed };
}

// ————————————————————————————————————————————————————————————————
// Computation — resolve the assigned template, then run the calculator.
// ————————————————————————————————————————————————————————————————

async function compute(
  org: string,
  userId: string,
  structure: SalaryStructure,
  employeeArg?: User,
  catalogArg?: PayHead[],
): Promise<SalaryCalcResult> {
  const employee = employeeArg ?? (await requireOrgEmployee(org, userId));
  if (!structure.salaryTemplateCode) {
    throw new SalaryStructureError(400, 'Assign a salary template first');
  }
  const template = await salaryTemplates().findOne({ org, code: structure.salaryTemplateCode });
  if (!template) throw new SalaryStructureError(409, 'The assigned salary template no longer exists');

  const catalog = catalogArg ?? (await orgPayHeads(org));
  const resolved = resolveTemplateComponents(template.components, new Map(catalog.map((h) => [h.code, h])));
  const ruleSet = await resolveRuleSet(org, employee.state);

  return calculateSalaryStructure({
    monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
    payHeads: resolved,
    componentValues: structure.componentValues,
    balancingComponentCode: template.balancingComponentCode,
    epfApplyCeiling: template.epfApplyCeiling,
    ruleSet,
    month: new Date().getUTCMonth() + 1,
    bonusCategory: structure.bonusCategory,
    statutory: structure.statutory,
  });
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

interface NormalizedInput {
  salaryTemplateCode?: string;
  annualCtcPaise?: number;
  componentValues?: Record<string, number>;
  statutory?: EmployeeStatutory;
  bonusCategory?: string;
  status?: 'draft' | 'active';
}

function normalizeInput(input: SalaryStructureInput, catalog: PayHead[]): NormalizedInput {
  const codes = new Set(catalog.map((head) => head.code));
  const out: NormalizedInput = {};

  if (input.salaryTemplateCode !== undefined && input.salaryTemplateCode !== null) {
    const code = String(input.salaryTemplateCode).trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,40}$/.test(code)) {
      throw new SalaryStructureError(400, 'salaryTemplateCode is invalid');
    }
    out.salaryTemplateCode = code;
  }

  if (input.annualCtcPaise !== undefined) {
    const ctc = Number(input.annualCtcPaise);
    if (!Number.isInteger(ctc) || ctc < 0) {
      throw new SalaryStructureError(400, 'annualCtcPaise must be a non-negative integer (paise)');
    }
    out.annualCtcPaise = ctc;
  }

  if (input.componentValues !== undefined) {
    if (!isRecord(input.componentValues)) {
      throw new SalaryStructureError(400, 'componentValues must be an object of code -> paise');
    }
    const values: Record<string, number> = {};
    for (const [code, raw] of Object.entries(input.componentValues)) {
      const normCode = code.trim().toUpperCase();
      if (!codes.has(normCode)) {
        throw new SalaryStructureError(400, `componentValues references unknown code "${normCode}"`);
      }
      const amount = Number(raw);
      if (!Number.isInteger(amount) || amount < 0) {
        throw new SalaryStructureError(400, `componentValues.${normCode} must be a non-negative integer (paise)`);
      }
      values[normCode] = amount;
    }
    out.componentValues = values;
  }

  if (input.statutory !== undefined) {
    if (!isRecord(input.statutory)) {
      throw new SalaryStructureError(400, 'statutory must be an object of epf/esi/lwf booleans');
    }
    const s: EmployeeStatutory = {};
    if (input.statutory.epf !== undefined) s.epf = Boolean(input.statutory.epf);
    if (input.statutory.esi !== undefined) s.esi = Boolean(input.statutory.esi);
    if (input.statutory.lwf !== undefined) s.lwf = Boolean(input.statutory.lwf);
    out.statutory = s;
  }

  if (input.bonusCategory !== undefined) out.bonusCategory = String(input.bonusCategory).trim();

  if (input.status !== undefined) {
    if (input.status !== 'draft' && input.status !== 'active') {
      throw new SalaryStructureError(400, 'status must be "draft" or "active"');
    }
    out.status = input.status;
  }

  return out;
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

async function orgPayHeads(org: string): Promise<PayHead[]> {
  return payHeads().find({ org }).toArray();
}

async function requireOrgEmployee(org: string, userId: string): Promise<User> {
  const employee = await users().findOne({ userId });
  if (!employee) throw new SalaryStructureError(404, 'Employee not found');
  if (employee.org !== org) {
    throw new SalaryStructureError(403, 'Employee belongs to a different organization');
  }
  return employee;
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new SalaryStructureError(404, 'User not found');
  if (!admin.org) throw new SalaryStructureError(409, 'User is not attached to a company');
  return admin.org;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function viewOf(doc: SalaryStructure) {
  return {
    userId: doc.userId,
    salaryTemplateCode: doc.salaryTemplateCode,
    annualCtcPaise: doc.annualCtcPaise,
    componentValues: doc.componentValues ?? {},
    statutory: doc.statutory ?? {},
    bonusCategory: doc.bonusCategory,
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
