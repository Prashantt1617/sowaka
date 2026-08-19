import { statutoryRules, users } from '../config/db';
import {
  BonusRule,
  LwfRule,
  PtRule,
  ResolvedRuleSet,
  StateStatutoryRule,
} from '../models/statutoryRule.model';

export class StatutoryError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'StatutoryError';
  }
}

/**
 * Built-in per-state defaults, seeded lazily when an org has no override for a
 * state. All amounts are editable by the admin; these only bootstrap the common
 * cases the PRD calls out (Haryana monthly LWF, Delhi half-yearly LWF).
 */
const DEFAULT_STATE_RULES: Record<string, Omit<ResolvedRuleSet, 'state'>> = {
  haryana: {
    lwf: {
      cycle: 'monthly',
      deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      employee: { mode: 'percentage', percent: 0.2, capPaise: 35_00 },
      employer: { mode: 'multiple_of_employee', factor: 2 },
    },
  },
  delhi: {
    lwf: {
      cycle: 'half_yearly',
      deductionMonths: [6, 12],
      employee: { mode: 'flat', amountPaise: 75 }, // ₹0.75
      employer: { mode: 'flat', amountPaise: 225 }, // ₹2.25
    },
  },
  karnataka: {
    // ₹0 below ₹25,000 monthly gross, ₹200 at/above.
    pt: {
      slabs: [
        { upToPaise: 24_999_99, amountPaise: 0 },
        { upToPaise: null, amountPaise: 200_00 },
      ],
    },
  },
};

// A neutral bonus default applied to any state lacking its own rule.
const DEFAULT_BONUS: BonusRule = {
  ratePercent: 8.33,
  minWageByCategoryPaise: {
    unskilled: 10_000_00,
    semi_skilled: 11_000_00,
    skilled: 12_000_00,
    highly_skilled: 13_000_00,
  },
};

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
    pt: input.pt === undefined ? undefined : validatePt(input.pt),
    lwf: input.lwf === undefined ? undefined : validateLwf(input.lwf),
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
 * consume. Stored per-state overrides win; any sub-rule the org hasn't set falls
 * back to the built-in default for that state (and bonus falls back to a neutral
 * national default). Called with org/state directly — no admin context.
 */
export async function resolveRuleSet(
  org: string | undefined,
  stateInput: string | undefined,
): Promise<ResolvedRuleSet> {
  // Lenient: a missing state (e.g. a stateless template preview, or an employee
  // with no work location) resolves to national-only statutory (no PT/LWF).
  const state = (stateInput ?? '').trim().toLowerCase();
  const defaults = DEFAULT_STATE_RULES[state] ?? {};
  const stored = org && state ? await statutoryRules().findOne({ org, state }) : null;
  return {
    state,
    pt: stored?.pt ?? defaults.pt,
    lwf: stored?.lwf ?? defaults.lwf,
    bonus: stored?.bonus ?? defaults.bonus ?? DEFAULT_BONUS,
  };
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

function validatePt(raw: unknown): PtRule {
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

function validateLwf(raw: unknown): LwfRule {
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
  const admin = await users().findOne({ userId: adminUserId });
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
