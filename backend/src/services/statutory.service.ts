import { statutoryRules, users } from '../config/db';
import { requestViewer } from '../middleware/request-viewer';
import {
  BonusRule,
  LwfRule,
  PtRule,
  ResolvedRuleSet,
  StateStatutoryRule,
} from '../models/statutoryRule.model';
import { stateDefaultsOf, StatutoryConfig } from '../shared/payroll/statutory-config';

export class StatutoryError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'StatutoryError';
  }
}

export interface StateRuleInput {
  state: string;
  pt?: unknown;
  lwf?: unknown;
  bonus?: unknown;
}

export async function listStateRules(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  const docs = await statutoryRules().find({ org }).sort({ state: 1 }).toArray();
  return docs.map(toView);
}

export async function getStateRule(adminUserId: string, stateInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const state = normalizeState(stateInput);
  const doc = await statutoryRules().findOne({ org, state });
  if (!doc) throw new StatutoryError(404, `No statutory rule configured for "${state}"`);
  return toView(doc);
}

export async function upsertStateRule(adminUserId: string, input: StateRuleInput) {
  const org = await requireAdminOrg(adminUserId);
  const state = normalizeState(input.state);
  const set: Partial<StateStatutoryRule> = {
    org,
    state,
    updatedAt: new Date(),
    pt: input.pt === undefined ? undefined : validatePtRule(input.pt),
    lwf: input.lwf === undefined ? undefined : validateLwfRule(input.lwf),
    bonus: input.bonus === undefined ? undefined : validateBonus(input.bonus),
  };
  // Drop undefined so an upsert doesn't wipe unspecified sub-rules.
  const cleanSet = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));

  await statutoryRules().updateOne(
    { org, state },
    { $set: cleanSet, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  const doc = await statutoryRules().findOne({ org, state });
  return toView(doc!);
}

export async function deleteStateRule(adminUserId: string, stateInput: string) {
  const org = await requireAdminOrg(adminUserId);
  const state = normalizeState(stateInput);
  const result = await statutoryRules().deleteOne({ org, state });
  if (result.deletedCount === 0) {
    throw new StatutoryError(404, `No statutory rule configured for "${state}"`);
  }
  return { state, deleted: true };
}

/**
 * Resolve the effective rule set for an org + state, for the payroll run to
 * consume: the org's own rule for the state where it has set one, else the
 * state's PT / LWF from the FY's statutory row. Nothing comes from code.
 * Called with org/state directly — no admin context.
 */
export async function resolveRuleSet(
  org: string | undefined,
  stateInput: string | undefined,
  config: StatutoryConfig,
): Promise<ResolvedRuleSet> {
  // Lenient: a missing state (e.g. a stateless template preview, or an employee
  // with no work location) resolves to national-only statutory (no PT/LWF).
  const state = (stateInput ?? '').trim().toLowerCase();
  const national = stateDefaultsOf(config, state);
  const stored = org && state ? await statutoryRules().findOne({ org, state }) : null;
  return {
    state,
    pt: stored?.pt ?? national?.pt,
    lwf: stored?.lwf ?? national?.lwf,
    bonus: stored?.bonus,
  };
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

export function validatePtRule(raw: unknown): PtRule {
  if (!isRecord(raw) || !Array.isArray(raw.slabs) || raw.slabs.length === 0) {
    throw new StatutoryError(400, 'pt.slabs must be a non-empty array');
  }
  const slabs = raw.slabs.map((slab, i) => {
    if (!isRecord(slab)) throw new StatutoryError(400, `pt.slabs[${i}] must be an object`);
    const upToPaise =
      slab.upToPaise === null ? null : requireNonNegInt(slab.upToPaise, `pt.slabs[${i}].upToPaise`);
    const amountPaise = requireNonNegInt(slab.amountPaise, `pt.slabs[${i}].amountPaise`);
    const monthOverride =
      slab.monthOverride === undefined
        ? undefined
        : validateMonthOverride(slab.monthOverride, i);
    return { upToPaise, amountPaise, ...(monthOverride ? { monthOverride } : {}) };
  });
  if (!slabs.some((slab) => slab.upToPaise === null)) {
    throw new StatutoryError(400, 'pt.slabs must include an open-ended top slab (upToPaise: null)');
  }
  return { slabs };
}

function validateMonthOverride(raw: unknown, i: number) {
  if (!isRecord(raw)) throw new StatutoryError(400, `pt.slabs[${i}].monthOverride must be an object`);
  return {
    month: requireMonth(raw.month, `pt.slabs[${i}].monthOverride.month`),
    amountPaise: requireNonNegInt(raw.amountPaise, `pt.slabs[${i}].monthOverride.amountPaise`),
  };
}

export function validateLwfRule(raw: unknown): LwfRule {
  if (!isRecord(raw)) throw new StatutoryError(400, 'lwf must be an object');
  const cycle = raw.cycle;
  if (cycle !== 'monthly' && cycle !== 'half_yearly') {
    throw new StatutoryError(400, 'lwf.cycle must be "monthly" or "half_yearly"');
  }
  if (!Array.isArray(raw.deductionMonths) || raw.deductionMonths.length === 0) {
    throw new StatutoryError(400, 'lwf.deductionMonths must be a non-empty array');
  }
  const deductionMonths = raw.deductionMonths.map((m, i) =>
    requireMonth(m, `lwf.deductionMonths[${i}]`),
  );
  return {
    cycle,
    deductionMonths,
    employee: validateLwfEmployee(raw.employee),
    employer: validateLwfEmployer(raw.employer),
  };
}

function validateLwfEmployee(raw: unknown): LwfRule['employee'] {
  if (!isRecord(raw)) throw new StatutoryError(400, 'lwf.employee must be an object');
  if (raw.mode === 'flat') {
    return { mode: 'flat', amountPaise: requireNonNegInt(raw.amountPaise, 'lwf.employee.amountPaise') };
  }
  if (raw.mode === 'percentage') {
    return {
      mode: 'percentage',
      percent: requirePercent(raw.percent, 'lwf.employee.percent'),
      ...(raw.capPaise === undefined
        ? {}
        : { capPaise: requireNonNegInt(raw.capPaise, 'lwf.employee.capPaise') }),
    };
  }
  throw new StatutoryError(400, 'lwf.employee.mode must be "flat" or "percentage"');
}

function validateLwfEmployer(raw: unknown): LwfRule['employer'] {
  if (!isRecord(raw)) throw new StatutoryError(400, 'lwf.employer must be an object');
  if (raw.mode === 'flat') {
    return { mode: 'flat', amountPaise: requireNonNegInt(raw.amountPaise, 'lwf.employer.amountPaise') };
  }
  if (raw.mode === 'percentage') {
    return {
      mode: 'percentage',
      percent: requirePercent(raw.percent, 'lwf.employer.percent'),
      ...(raw.capPaise === undefined
        ? {}
        : { capPaise: requireNonNegInt(raw.capPaise, 'lwf.employer.capPaise') }),
    };
  }
  if (raw.mode === 'multiple_of_employee') {
    const factor = Number(raw.factor);
    if (!Number.isFinite(factor) || factor < 0) {
      throw new StatutoryError(400, 'lwf.employer.factor must be a non-negative number');
    }
    return { mode: 'multiple_of_employee', factor };
  }
  throw new StatutoryError(
    400,
    'lwf.employer.mode must be "flat", "percentage", or "multiple_of_employee"',
  );
}

function validateBonus(raw: unknown): BonusRule {
  if (!isRecord(raw)) throw new StatutoryError(400, 'bonus must be an object');
  const ratePercent = requirePercent(raw.ratePercent, 'bonus.ratePercent');
  if (!isRecord(raw.minWageByCategoryPaise)) {
    throw new StatutoryError(400, 'bonus.minWageByCategoryPaise must be an object');
  }
  const minWageByCategoryPaise: Record<string, number> = {};
  for (const [category, value] of Object.entries(raw.minWageByCategoryPaise)) {
    minWageByCategoryPaise[category] = requireNonNegInt(
      value,
      `bonus.minWageByCategoryPaise.${category}`,
    );
  }
  return { ratePercent, minWageByCategoryPaise };
}

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

function normalizeState(value: string): string {
  const state = value.trim().toLowerCase();
  if (!state) throw new StatutoryError(400, 'state is required');
  if (state.length > 60) throw new StatutoryError(400, 'state is too long');
  return state;
}

function requireNonNegInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new StatutoryError(400, `${field} must be a non-negative integer (paise)`);
  }
  return n;
}

function requirePercent(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new StatutoryError(400, `${field} must be between 0 and 100`);
  }
  return Math.round(n * 100) / 100;
}

function requireMonth(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new StatutoryError(400, `${field} must be a month 1-12`);
  }
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = requestViewer(adminUserId) ?? (await users().findOne({ userId: adminUserId }));
  if (!admin) throw new StatutoryError(404, 'User not found');
  if (!admin.org) throw new StatutoryError(409, 'User is not attached to a company');
  return admin.org;
}

function toView(doc: StateStatutoryRule) {
  return {
    state: doc.state,
    pt: doc.pt,
    lwf: doc.lwf,
    bonus: doc.bonus,
    createdAt: doc.createdAt?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
  };
}
