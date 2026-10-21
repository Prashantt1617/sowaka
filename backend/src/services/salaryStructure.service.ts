import { payHeads, salaryStructures, salaryTemplates, users } from '../config/db';
import { PayHead } from '../models/payHead.model';
import { EmployeeStatutory, SalaryRevision, SalaryStructure, StructureOverrides } from '../models/salaryStructure.model';
import { SalaryTemplate } from '../models/salaryTemplate.model';
import { User } from '../models/user.model';
import { assertAcyclic } from './payHead.service';
import { calculateSalaryStructure, SalaryCalcResult } from './salary-calculator';
import { applyOverrides, resolveTemplateComponents, validateCalculation } from './salaryTemplate.service';
import { resolveRuleSet } from './statutory.service';
import { statutorySettingsFor, workStateOf } from './statutorySettings.service';
import { catalogWithStandard, materializeStandard } from './standardComponents.service';
import { decryptField, encryptField, fieldKeyConfigured, isEncrypted, maskTail } from './fieldCrypto';
import { payrollAccessOf } from './payrollAccess.service';
import { isEncryptedOrg } from './payrollCrypto.service';

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
  overrides?: unknown;
  effectiveFrom?: unknown;
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
    /** Amounts are sealed (end-to-end encrypted org): open them in the browser. */
    sealed: Boolean(doc.sealed),
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

/** The saved structure plus its freshly computed breakup. */
export async function getSalaryStructure(adminUserId: string, userId: string) {
  const org = await requireAdminOrg(adminUserId);
  if (await isEncryptedOrg(org)) throw new SalaryStructureError(409, 'This organisation’s salaries are encrypted: unlock them in the dashboard');
  const doc = await salaryStructures().findOne({ org, userId });
  if (!doc) throw new SalaryStructureError(404, 'No salary structure for this employee');
  const { computed, components, template } = await compute(org, userId, doc);
  return { structure: viewOf(doc, template.name, await payrollAccessOf(adminUserId)), computed, components };
}

export async function upsertSalaryStructure(
  adminUserId: string,
  userId: string,
  input: SalaryStructureInput,
) {
  const org = await requireAdminOrg(adminUserId);
  if (await isEncryptedOrg(org)) throw new SalaryStructureError(409, 'This organisation’s salaries are encrypted: unlock them in the dashboard');
  const employee = await requireOrgEmployee(org, userId);
  const catalog = await orgPayHeads(org);
  const draft = normalizeInput(input, catalog);

  const existing = await salaryStructures().findOne({ org, userId });
  const now = new Date();
  // A CTC change is a revision; the history keeps every one.
  const previousCtc = existing?.annualCtcPaise ?? 0;
  const revisions: SalaryRevision[] = [...(existing?.revisions ?? [])];
  if (draft.annualCtcPaise !== undefined && draft.annualCtcPaise !== previousCtc) {
    revisions.push({
      previousCtcPaise: previousCtc,
      annualCtcPaise: draft.annualCtcPaise,
      effectiveFrom: draft.effectiveFrom ?? now.toISOString().slice(0, 10),
      at: now,
    });
  }
  const merged: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: draft.salaryTemplateCode ?? existing?.salaryTemplateCode,
    annualCtcPaise: draft.annualCtcPaise ?? existing?.annualCtcPaise ?? 0,
    componentValues: draft.componentValues ?? existing?.componentValues,
    overrides: draft.overrides ?? existing?.overrides,
    revisions,
    statutory: draft.statutory ? sealIds(draft.statutory, existing?.statutory) : existing?.statutory,
    bonusCategory: draft.bonusCategory ?? existing?.bonusCategory,
    status: draft.status ?? existing?.status ?? 'draft',
    effectiveFrom: existing?.effectiveFrom,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // Compute first: a template or override that doesn't resolve must not be saved.
  const { computed, components, template } = await compute(org, userId, merged, employee, catalog);
  // A standard component added for this person becomes this org's pay head.
  await materializeStandard(org, [...(merged.overrides?.add ?? []).map((a) => a.payHeadCode), ...Object.keys(merged.componentValues ?? {})]);
  await salaryStructures().updateOne({ org, userId }, { $set: merged }, { upsert: true });
  return { structure: viewOf(merged, template.name, await payrollAccessOf(adminUserId)), computed, components };
}

/** Compute a breakup WITHOUT saving — powers the live assignment editor. */
export async function previewSalaryStructure(
  adminUserId: string,
  userId: string,
  input: SalaryStructureInput,
) {
  const org = await requireAdminOrg(adminUserId);
  if (await isEncryptedOrg(org)) throw new SalaryStructureError(409, 'This organisation’s salaries are encrypted: unlock them in the dashboard');
  const employee = await requireOrgEmployee(org, userId);
  const catalog = await orgPayHeads(org);
  const draft = normalizeInput(input, catalog);
  const existing = await salaryStructures().findOne({ org, userId });
  const provisional: SalaryStructure = {
    org,
    userId,
    salaryTemplateCode: draft.salaryTemplateCode ?? existing?.salaryTemplateCode,
    annualCtcPaise: draft.annualCtcPaise ?? existing?.annualCtcPaise ?? 0,
    componentValues: draft.componentValues ?? existing?.componentValues,
    overrides: draft.overrides ?? existing?.overrides,
    statutory: draft.statutory ?? existing?.statutory,
    bonusCategory: draft.bonusCategory ?? existing?.bonusCategory,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { computed, components } = await compute(org, userId, provisional, employee, catalog);
  return { computed, components };
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
): Promise<{ computed: SalaryCalcResult; components: ReturnType<typeof applyOverrides>; template: SalaryTemplate }> {
  const employee = employeeArg ?? (await requireOrgEmployee(org, userId));
  if (!structure.salaryTemplateCode) {
    throw new SalaryStructureError(400, 'Assign a salary template first');
  }
  const template = await salaryTemplates().findOne({ org, code: structure.salaryTemplateCode });
  if (!template) throw new SalaryStructureError(409, 'The assigned salary template no longer exists');

  const catalog = catalogArg ?? (await orgPayHeads(org));
  const catalogByCode = new Map(catalog.map((h) => [h.code, h]));
  // The template plus this person's own add / remove / edit, checked for loops.
  const components = applyOverrides(template.components, structure.overrides, catalogByCode);
  assertAcyclic(components.map((c) => ({ code: c.payHeadCode, componentType: catalogByCode.get(c.payHeadCode)!.componentType, calculation: c.calculation })));
  const resolved = resolveTemplateComponents(components, catalogByCode);
  const [ruleSet, settings] = await Promise.all([resolveRuleSet(org, workStateOf(employee)), statutorySettingsFor(org)]);

  const computed = calculateSalaryStructure({
    monthlyCtcPaise: Math.round(structure.annualCtcPaise / 12),
    payHeads: resolved,
    componentValues: structure.componentValues,
    balancingComponentCode: template.balancingComponentCode,
    ruleSet,
    settings,
    month: new Date().getUTCMonth() + 1,
    bonusCategory: structure.bonusCategory,
    statutory: structure.statutory,
    statutoryWages: template.statutoryWages,
  });
  return { computed, components, template };
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

interface NormalizedInput {
  salaryTemplateCode?: string;
  annualCtcPaise?: number;
  componentValues?: Record<string, number>;
  overrides?: StructureOverrides;
  effectiveFrom?: string;
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

  if (input.overrides !== undefined && input.overrides !== null) {
    out.overrides = normalizeOverrides(input.overrides, catalog);
  }

  if (input.effectiveFrom !== undefined && input.effectiveFrom !== null && input.effectiveFrom !== '') {
    const day = String(input.effectiveFrom);
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)) {
      throw new SalaryStructureError(400, 'effectiveFrom must be a date, YYYY-MM-DD');
    }
    out.effectiveFrom = day;
  }

  if (input.statutory !== undefined) {
    if (!isRecord(input.statutory)) {
      throw new SalaryStructureError(400, 'statutory must be an object of epf/esi/lwf booleans');
    }
    const s: EmployeeStatutory = {};
    if (input.statutory.epf !== undefined) s.epf = Boolean(input.statutory.epf);
    if (input.statutory.esi !== undefined) s.esi = Boolean(input.statutory.esi);
    if (input.statutory.lwf !== undefined) s.lwf = Boolean(input.statutory.lwf);
    if (input.statutory.pfActualWage !== undefined) s.pfActualWage = Boolean(input.statutory.pfActualWage);
    if (input.statutory.contributeEps !== undefined) s.contributeEps = Boolean(input.statutory.contributeEps);
    const text = (value: unknown, field: string, max: number): string | undefined => {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') throw new SalaryStructureError(400, `${field} must be text`);
      const v = value.trim();
      if (v.length > max) throw new SalaryStructureError(400, `${field} is too long`);
      return v || undefined;
    };
    if (input.statutory.pfAccountNumber !== undefined) s.pfAccountNumber = text(input.statutory.pfAccountNumber, 'PF account number', 40);
    if (input.statutory.uan !== undefined) {
      s.uan = text(input.statutory.uan, 'UAN', 12);
      if (s.uan && !s.uan.includes('•') && !/^\d{12}$/.test(s.uan)) throw new SalaryStructureError(400, 'UAN is 12 digits');
    }
    if (input.statutory.esiNumber !== undefined) {
      s.esiNumber = text(input.statutory.esiNumber, 'ESI number', 17);
      if (s.esiNumber && !s.esiNumber.includes('•') && !/^\d{10,17}$/.test(s.esiNumber)) throw new SalaryStructureError(400, 'ESI insurance number is 10 to 17 digits');
    }
    if (input.statutory.pfRestrictedWagePaise !== undefined) {
      const raw = input.statutory.pfRestrictedWagePaise;
      if (raw === null || raw === '' || raw === 0) s.pfRestrictedWagePaise = undefined;
      else {
        const wage = Number(raw);
        if (!Number.isInteger(wage) || wage <= 0) throw new SalaryStructureError(400, 'Restricted PF wage must be a positive amount in paise');
        s.pfRestrictedWagePaise = wage;
      }
    }
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

/**
 * This person's add / remove / edit on top of their template. Every code must
 * be in the catalog, Basic can't be removed, and each calculation is checked
 * the way a template's is.
 */
function normalizeOverrides(raw: unknown, catalog: PayHead[]): StructureOverrides {
  if (!isRecord(raw)) throw new SalaryStructureError(400, 'overrides must be an object');
  const codes = new Set(catalog.map((head) => head.code));
  const byCode = new Map(catalog.map((head) => [head.code, head]));
  const code = (value: unknown, what: string): string => {
    const c = String(value ?? '').trim().toUpperCase();
    if (!codes.has(c)) throw new SalaryStructureError(400, `${what} "${c}" is not a salary component`);
    return c;
  };
  const out: StructureOverrides = {};
  if (raw.add !== undefined) {
    if (!Array.isArray(raw.add)) throw new SalaryStructureError(400, 'overrides.add must be a list');
    out.add = raw.add.map((item) => {
      if (!isRecord(item)) throw new SalaryStructureError(400, 'Each added component must be an object');
      const payHeadCode = code(item.payHeadCode, 'Added component');
      return { payHeadCode, calculation: validateCalculation(item.calculation, payHeadCode, codes) };
    });
  }
  if (raw.remove !== undefined) {
    if (!Array.isArray(raw.remove)) throw new SalaryStructureError(400, 'overrides.remove must be a list');
    out.remove = raw.remove.map((value) => {
      const c = code(value, 'Removed component');
      if (byCode.get(c)?.componentType === 'basic') throw new SalaryStructureError(400, 'Basic cannot be removed for one person');
      return c;
    });
  }
  if (raw.edit !== undefined) {
    if (!isRecord(raw.edit)) throw new SalaryStructureError(400, 'overrides.edit must be an object of code → calculation');
    out.edit = {};
    for (const [key, calc] of Object.entries(raw.edit)) {
      const c = code(key, 'Edited component');
      out.edit[c] = validateCalculation(calc, c, codes);
    }
  }
  return out;
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

/** The org's pay heads plus the standard components it hasn't added yet. */
async function orgPayHeads(org: string): Promise<PayHead[]> {
  return (await catalogWithStandard(org)).all;
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

const ID_FIELDS = ['uan', 'pfAccountNumber', 'esiNumber'] as const;

/**
 * The person's UAN, PF account and ESI numbers are kept encrypted at rest
 * (interim server key, see fieldCrypto). A masked value sent back unchanged
 * keeps the stored one.
 */
function sealIds(next: EmployeeStatutory, previous: EmployeeStatutory | undefined): EmployeeStatutory {
  const out: EmployeeStatutory = { ...next };
  for (const field of ID_FIELDS) {
    const v = next[field];
    if (v === undefined) {
      if (previous?.[field] !== undefined && !(field in next)) out[field] = previous[field];
      continue;
    }
    if (v.includes('•')) out[field] = previous?.[field];
    else if (!isEncrypted(v)) {
      if (!fieldKeyConfigured()) throw new SalaryStructureError(503, 'PAYROLL_FIELD_KEY is not set: UAN, PF and ESI numbers cannot be saved');
      out[field] = encryptField(v);
    }
  }
  return out;
}

/** The IDs in full for payroll access, else masked; never the ciphertext. */
function openIds(statutory: EmployeeStatutory | undefined, payroll: boolean): EmployeeStatutory {
  const out: EmployeeStatutory = { ...(statutory ?? {}) };
  for (const field of ID_FIELDS) {
    const v = out[field];
    if (!v) continue;
    let plain: string | undefined;
    try {
      plain = isEncrypted(v) ? (fieldKeyConfigured() ? decryptField(v) : undefined) : v;
    } catch {
      plain = undefined;
    }
    out[field] = payroll && plain ? plain : plain ? maskTail(plain) : '••••';
  }
  return out;
}

function viewOf(doc: SalaryStructure, templateName?: string, payroll = false) {
  return {
    userId: doc.userId,
    salaryTemplateCode: doc.salaryTemplateCode,
    templateName,
    annualCtcPaise: doc.annualCtcPaise,
    componentValues: doc.componentValues ?? {},
    overrides: doc.overrides ?? {},
    revisions: (doc.revisions ?? []).map((r) => ({ ...r, at: r.at instanceof Date ? r.at.toISOString() : String(r.at) })),
    statutory: openIds(doc.statutory, payroll),
    bonusCategory: doc.bonusCategory,
    status: doc.status,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
