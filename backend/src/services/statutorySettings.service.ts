/**
 * Org-wide statutory settings (Payroll › Statutory Components) and the
 * per-employee facts the payroll run needs alongside them: which state a
 * person works in, and whether ESI already covers them this contribution
 * period.
 */
import { payrollRuns, payslips, statutorySettings, users } from '../config/db';
import { EPF_CONSTANTS } from '../models/statutoryRule.model';
import {
  BonusSettings,
  EpfSettings,
  EsiSettings,
  MinWageRow,
  PfRateMode,
  StatutorySettings,
} from '../models/statutorySettings.model';
import { resolveRuleSet } from './statutory.service';

export class StatutorySettingsError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'StatutorySettingsError';
  }
}

/**
 * Defaults for an org that has never saved its settings. They reproduce how
 * payroll calculated before the screen was wired: PF on, both sides capped at
 * the ceiling, employer contributions on top of CTC, ESI on, no statutory bonus.
 */
export function defaultStatutorySettings(org: string): StatutorySettings {
  return {
    org,
    epf: {
      enabled: true,
      employeeRate: 'restricted',
      employerRate: 'restricted',
      includeEmployer: false,
      includeEDLI: false,
      includeAdmin: false,
      overrideAtEmployee: false,
      proRateRestricted: false,
      considerLOP: true,
    },
    esi: { enabled: true, includeEmployer: false },
    bonus: { enabled: false, frequency: 'monthly', ratePercent: 8.33, minWages: {} },
    lwfDisabledStates: [],
  };
}

/** The org's settings, with defaults filling anything never saved. */
export async function statutorySettingsFor(org: string): Promise<StatutorySettings> {
  const stored = await statutorySettings().findOne({ org }, { projection: { _id: 0 } });
  const base = defaultStatutorySettings(org);
  if (!stored) return base;
  return {
    org,
    epf: { ...base.epf, ...stored.epf },
    esi: { ...base.esi, ...stored.esi },
    bonus: { ...base.bonus, ...stored.bonus, minWages: stored.bonus?.minWages ?? {} },
    lwfDisabledStates: stored.lwfDisabledStates ?? [],
    updatedAt: stored.updatedAt,
  };
}

// ————————————————————————————————————————————————————————————————
// Work state
// ————————————————————————————————————————————————————————————————

/** Cities Sowaka's orgs work in, mapped to their state. */
const CITY_STATE: Record<string, string> = {
  gurgaon: 'Haryana',
  gurugram: 'Haryana',
  faridabad: 'Haryana',
  noida: 'Uttar Pradesh',
  'greater noida': 'Uttar Pradesh',
  ghaziabad: 'Uttar Pradesh',
  lucknow: 'Uttar Pradesh',
  delhi: 'Delhi',
  'new delhi': 'Delhi',
  kolkata: 'West Bengal',
  bengaluru: 'Karnataka',
  bangalore: 'Karnataka',
  mumbai: 'Maharashtra',
  pune: 'Maharashtra',
  hyderabad: 'Telangana',
  chennai: 'Tamil Nadu',
};

/**
 * The state statutory rules are picked by: the person's work state, or the
 * state of their work city when no state is recorded.
 */
export function workStateOf(user: { state?: string | null; location?: string | null }): string | undefined {
  const state = (user.state ?? '').trim();
  if (state) return state;
  return CITY_STATE[(user.location ?? '').trim().toLowerCase()];
}

// ————————————————————————————————————————————————————————————————
// ESI contribution periods
// ————————————————————————————————————————————————————————————————

/** The months of `period`'s ESI contribution period (Apr–Sep or Oct–Mar) before it. */
export function earlierMonthsInEsiPeriod(period: string): string[] {
  const [year, month] = period.split('-').map(Number);
  let y = year;
  let m: number;
  if (month >= 4 && month <= 9) m = 4;
  else if (month >= 10) m = 10;
  else {
    m = 10;
    y = year - 1;
  }
  const out: string[] = [];
  while (!(y === year && m === month)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * People who were under ESI earlier in `period`'s contribution period. ESI
 * keeps covering them until the period ends even if their pay crosses
 * ₹21,000. Rejected runs don't count.
 */
export async function esiCoveredThisPeriod(org: string, period: string, userIds: string[]): Promise<Set<string>> {
  const months = earlierMonthsInEsiPeriod(period);
  if (months.length === 0 || userIds.length === 0) return new Set();
  const runs = await payrollRuns()
    .find({ org, period: { $in: months }, status: { $ne: 'rejected' } }, { projection: { _id: 1 } })
    .toArray();
  if (runs.length === 0) return new Set();
  const slips = await payslips()
    .find(
      { org, runId: { $in: runs.map((r) => r._id!.toHexString()) }, userId: { $in: userIds } },
      { projection: { _id: 0, userId: 1, esiApplicable: 1, deductions: 1 } },
    )
    .toArray();
  const covered = new Set<string>();
  for (const slip of slips) {
    if (slip.esiApplicable === true || slip.deductions?.some((d) => d.key === 'esi')) covered.add(slip.userId);
  }
  return covered;
}

// ————————————————————————————————————————————————————————————————
// Admin view + update
// ————————————————————————————————————————————————————————————————

/** Everything Statutory Components shows: settings, plus PT and LWF by the org's work states. */
export async function getStatutoryOverview(adminUserId: string) {
  const org = await requireAdminOrg(adminUserId);
  // Work locations from the people on the roster: city → state.
  const [settings, people] = await Promise.all([
    statutorySettingsFor(org),
    users().find({ org }, { projection: { _id: 0, state: 1, location: 1 } }).toArray(),
  ]);
  const locations = new Map<string, string>();
  for (const person of people) {
    const state = workStateOf(person);
    if (!state) continue;
    const city = (person.location ?? '').trim() || state;
    if (!locations.has(city)) locations.set(city, state);
  }
  const states = [...new Set([...locations.values()])].sort();

  const resolved = await Promise.all(states.map((state) => resolveRuleSet(org, state)));
  const rules = new Map(states.map((state, i) => [state, resolved[i]]));

  return {
    settings: viewSettings(settings),
    ceilingPaise: EPF_CONSTANTS.wageCeilingPaise,
    pt: [...locations.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([location, state]) => ({ location, state, pt: rules.get(state)?.pt ?? null })),
    lwf: states.map((state) => ({
      state,
      rule: rules.get(state)?.lwf ?? null,
      enabled: !settings.lwfDisabledStates.includes(state.toLowerCase()),
    })),
    states,
  };
}

export async function updateStatutorySettings(adminUserId: string, input: unknown) {
  const org = await requireAdminOrg(adminUserId);
  if (!isRecord(input)) throw new StatutorySettingsError(400, 'Settings must be an object');
  const current = await statutorySettingsFor(org);
  const next: StatutorySettings = { ...current };

  if (input.epf !== undefined) next.epf = parseEpf(input.epf, current.epf);
  if (input.esi !== undefined) next.esi = parseEsi(input.esi, current.esi);
  if (input.bonus !== undefined) next.bonus = parseBonus(input.bonus, current.bonus);
  if (input.lwf !== undefined) {
    if (!isRecord(input.lwf) || typeof input.lwf.state !== 'string' || typeof input.lwf.enabled !== 'boolean') {
      throw new StatutorySettingsError(400, 'lwf must be { state, enabled }');
    }
    const state = input.lwf.state.trim().toLowerCase();
    const off = new Set(current.lwfDisabledStates);
    if (input.lwf.enabled) off.delete(state);
    else off.add(state);
    next.lwfDisabledStates = [...off].sort();
  }

  // JSON round trip drops undefined fields (an empty EPF number) instead of storing null.
  const doc = JSON.parse(JSON.stringify({ epf: next.epf, esi: next.esi, bonus: next.bonus, lwfDisabledStates: next.lwfDisabledStates })) as Pick<StatutorySettings, 'epf' | 'esi' | 'bonus' | 'lwfDisabledStates'>;
  await statutorySettings().updateOne({ org }, { $set: { org, ...doc, updatedAt: new Date() } }, { upsert: true });
  return getStatutoryOverview(adminUserId);
}

function viewSettings(s: StatutorySettings) {
  return { epf: s.epf, esi: s.esi, bonus: s.bonus, lwfDisabledStates: s.lwfDisabledStates };
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

function parseEpf(raw: unknown, current: EpfSettings): EpfSettings {
  if (!isRecord(raw)) throw new StatutorySettingsError(400, 'epf must be an object');
  const rate = (value: unknown, fallback: PfRateMode): PfRateMode => {
    if (value === undefined) return fallback;
    if (value !== 'restricted' && value !== 'actual') {
      throw new StatutorySettingsError(400, 'PF rate must be "restricted" or "actual"');
    }
    return value;
  };
  const flag = (key: keyof EpfSettings): boolean =>
    raw[key] === undefined ? (current[key] as boolean) : Boolean(raw[key]);
  const includeEmployer = flag('includeEmployer');
  return {
    enabled: flag('enabled'),
    epfNumber: optionalText(raw.epfNumber, current.epfNumber, 'epfNumber'),
    employeeRate: rate(raw.employeeRate, current.employeeRate),
    employerRate: rate(raw.employerRate, current.employerRate),
    includeEmployer,
    includeEDLI: includeEmployer && flag('includeEDLI'),
    includeAdmin: includeEmployer && flag('includeAdmin'),
    overrideAtEmployee: flag('overrideAtEmployee'),
    proRateRestricted: flag('proRateRestricted'),
    considerLOP: flag('considerLOP'),
  };
}

function parseEsi(raw: unknown, current: EsiSettings): EsiSettings {
  if (!isRecord(raw)) throw new StatutorySettingsError(400, 'esi must be an object');
  return {
    enabled: raw.enabled === undefined ? current.enabled : Boolean(raw.enabled),
    esiNumber: optionalText(raw.esiNumber, current.esiNumber, 'esiNumber'),
    includeEmployer: raw.includeEmployer === undefined ? current.includeEmployer : Boolean(raw.includeEmployer),
  };
}

function parseBonus(raw: unknown, current: BonusSettings): BonusSettings {
  if (!isRecord(raw)) throw new StatutorySettingsError(400, 'bonus must be an object');
  const frequency = raw.frequency === undefined ? current.frequency : raw.frequency;
  if (frequency !== 'monthly' && frequency !== 'yearly') {
    throw new StatutorySettingsError(400, 'Bonus frequency must be monthly or yearly');
  }
  const ratePercent = raw.ratePercent === undefined ? current.ratePercent : Number(raw.ratePercent);
  if (!Number.isFinite(ratePercent) || ratePercent < 8.33 || ratePercent > 20) {
    throw new StatutorySettingsError(400, 'Statutory Bonus rate should be between 8.33% and 20%');
  }
  let minWages = current.minWages;
  if (raw.minWages !== undefined) {
    if (!isRecord(raw.minWages)) throw new StatutorySettingsError(400, 'minWages must be an object of state → rows');
    minWages = {};
    for (const [stateRaw, rows] of Object.entries(raw.minWages)) {
      if (!Array.isArray(rows)) throw new StatutorySettingsError(400, `Minimum wages for ${stateRaw} must be a list`);
      const state = stateRaw.trim().toLowerCase();
      minWages[state] = rows.map((row): MinWageRow => {
        if (!isRecord(row)) throw new StatutorySettingsError(400, 'Each minimum wage must be an object');
        const category = String(row.category ?? '').trim();
        const minWagePaise = Number(row.minWagePaise);
        const effectiveFrom = String(row.effectiveFrom ?? '');
        if (!category) throw new StatutorySettingsError(400, `Enter an employment category for ${stateRaw}`);
        if (!Number.isInteger(minWagePaise) || minWagePaise <= 0) {
          throw new StatutorySettingsError(400, `Enter the minimum wage for ${category} in ${stateRaw}`);
        }
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFrom)) {
          throw new StatutorySettingsError(400, `Pick the month ${category} in ${stateRaw} applies from`);
        }
        return { category, minWagePaise, effectiveFrom };
      });
    }
  }
  return {
    enabled: raw.enabled === undefined ? current.enabled : Boolean(raw.enabled),
    frequency,
    ratePercent: Math.round(ratePercent * 100) / 100,
    minWages,
  };
}

/**
 * The minimum wage for a category in a state for a month, if one is set:
 * the latest row whose effective month is not after `period`.
 */
export function minimumWageFor(bonus: BonusSettings, state: string | undefined, category: string | undefined, period: string): number {
  if (!state || !category) return 0;
  const rows = bonus.minWages[state.trim().toLowerCase()] ?? [];
  const match = rows
    .filter((r) => r.category.trim().toLowerCase() === category.trim().toLowerCase() && r.effectiveFrom <= period)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return match?.minWagePaise ?? 0;
}

function optionalText(value: unknown, fallback: string | undefined, field: string): string | undefined {
  if (value === undefined) return fallback;
  if (value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new StatutorySettingsError(400, `${field} must be text`);
  return value.trim().slice(0, 60) || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requireAdminOrg(adminUserId: string): Promise<string> {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new StatutorySettingsError(404, 'User not found');
  if (!admin.org) throw new StatutorySettingsError(409, 'User is not attached to a company');
  return admin.org;
}

