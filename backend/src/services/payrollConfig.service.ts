/**
 * The national payroll rows, one set per financial year: the statutory figures
 * (`payroll_statutory_configs`) and the income tax rows (`tds_configs`, one per
 * regime). Payroll reads them here and refuses a year that has none; the HR
 * dashboard reads and edits them through the endpoints below.
 *
 * Access: anyone with payroll access may read. The rows serve every company on
 * Sowaka, so only a dashboard admin of an org in `PAYROLL_CONFIG_ORGS` (Sowaka's
 * own org when unset) may write: a customer's HR can see the figures their pay
 * is worked out on but cannot change another company's.
 */
import { statutoryConfigs, tdsConfigs, users } from '../config/db';
import { env } from '../config/env';
import { requestViewer } from '../middleware/request-viewer';
import { LwfRule, PtRule } from '../models/statutoryRule.model';
import { StatutoryConfigRow } from '../models/statutoryConfig.model';
import { TdsConfigRow } from '../models/tds.model';
import type { StatutoryConfig, StateStatutoryDefaults } from '../shared/payroll/statutory-config';
import { fyOf, TaxRegime, TdsConfig } from '../shared/payroll/tds';
import { hasPayrollAccess } from './payrollAccess.service';
import { StatutoryError, validateLwfRule, validatePtRule } from './statutory.service';

export class PayrollConfigError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'PayrollConfigError';
  }
}

export const statutoryMissing = (fy: string) => `Statutory settings for FY ${fy} are not set up`;
export const tdsMissing = (fy: string) => `Income tax settings for FY ${fy} are not set up`;

const STRIP = { _id: 0, createdAt: 0, updatedAt: 0, updatedByUserId: 0 } as const;

// ————————————————————————————————————————————————————————————————
// What payroll reads
// ————————————————————————————————————————————————————————————————

/** The FY's statutory row, or 409: payroll never works a year out on figures it doesn't have. */
export async function statutoryConfigFor(fy: string): Promise<StatutoryConfig> {
  const row = await statutoryConfigs().findOne({ fy }, { projection: STRIP });
  if (!row) throw new PayrollConfigError(409, statutoryMissing(fy));
  return row as StatutoryConfig;
}

/** The statutory row for the FY a pay month ("YYYY-MM") falls in. */
export function statutoryConfigForPeriod(period: string): Promise<StatutoryConfig> {
  return statutoryConfigFor(fyOf(period).fy);
}

/** Both regimes' income tax rows for a FY, or 409. */
export async function requireTdsConfigs(fy: string): Promise<Map<TaxRegime, TdsConfig>> {
  const rows = await tdsConfigs().find({ fy }, { projection: STRIP }).toArray();
  const map = new Map(rows.map((r) => [r.regime, r as TdsConfig]));
  if (!map.has('new') || !map.has('old')) throw new PayrollConfigError(409, tdsMissing(fy));
  return map;
}

// ————————————————————————————————————————————————————————————————
// Access
// ————————————————————————————————————————————————————————————————

async function accessOf(viewerUserId: string): Promise<{ canEdit: boolean }> {
  const viewer = requestViewer(viewerUserId)
    ?? (await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } }));
  if (!viewer?.org) throw new PayrollConfigError(403, 'No organisation on this account');
  if (!hasPayrollAccess(viewer)) throw new PayrollConfigError(403, 'Only people with payroll access can see the statutory and income tax settings');
  return { canEdit: viewer.dashboardAdmin === true && env.payrollConfigOrgs.includes(viewer.org) };
}

async function requireEditor(viewerUserId: string): Promise<void> {
  const { canEdit } = await accessOf(viewerUserId);
  if (!canEdit) throw new PayrollConfigError(403, 'These settings apply to every company on Sowaka; only a Sowaka admin can change them');
}

function parseFy(raw: unknown, field = 'fy'): string {
  const value = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new PayrollConfigError(400, `${field} must be a financial year like 2026-27`);
  return value;
}

function fyStart(fy: string): string {
  return `${fy.slice(0, 4)}-04-01`;
}

function fyEnd(fy: string): string {
  return `${Number(fy.slice(0, 4)) + 1}-03-31`;
}

const currentFy = () => fyOf(new Date().toISOString().slice(0, 7)).fy;

// ————————————————————————————————————————————————————————————————
// Statutory config API
// ————————————————————————————————————————————————————————————————

function statutoryView(row: StatutoryConfigRow) {
  return {
    fy: row.fy,
    status: row.status,
    source: row.source ?? null,
    epf: row.epf,
    esi: row.esi,
    bonus: row.bonus,
    mealCard: row.mealCard,
    states: row.states,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
  };
}

export async function listStatutoryConfigs(viewerUserId: string) {
  const { canEdit } = await accessOf(viewerUserId);
  const rows = await statutoryConfigs().find({}, { projection: { _id: 0, fy: 1, status: 1, updatedAt: 1 } }).sort({ fy: -1 }).toArray();
  return { canEdit, years: rows.map((r) => ({ fy: r.fy, status: r.status, updatedAt: r.updatedAt?.toISOString() ?? null })), currentFy: currentFy() };
}

export async function getStatutoryConfig(viewerUserId: string, fyRaw: unknown) {
  const { canEdit } = await accessOf(viewerUserId);
  const fy = parseFy(fyRaw);
  const row = await statutoryConfigs().findOne({ fy });
  if (!row) throw new PayrollConfigError(404, statutoryMissing(fy));
  return { canEdit, config: statutoryView(row) };
}

export async function putStatutoryConfig(viewerUserId: string, fyRaw: unknown, body: unknown) {
  await requireEditor(viewerUserId);
  const fy = parseFy(fyRaw);
  const config = validateStatutoryConfig(fy, body);
  const now = new Date();
  await statutoryConfigs().updateOne(
    { fy },
    { $set: { ...config, updatedAt: now, updatedByUserId: viewerUserId }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return { canEdit: true, config: statutoryView((await statutoryConfigs().findOne({ fy }))!) };
}

export async function copyStatutoryConfig(viewerUserId: string, fyRaw: unknown, copyFromRaw: unknown) {
  await requireEditor(viewerUserId);
  const fy = parseFy(fyRaw);
  const from = parseFy(copyFromRaw, 'copyFrom');
  if (from === fy) throw new PayrollConfigError(400, 'copyFrom must be another year');
  const source = await statutoryConfigs().findOne({ fy: from }, { projection: STRIP });
  if (!source) throw new PayrollConfigError(404, statutoryMissing(from));
  if (await statutoryConfigs().findOne({ fy }, { projection: { _id: 1 } })) throw new PayrollConfigError(409, `Statutory settings for FY ${fy} already exist`);
  const lastCeiling = source.epf.wageCeilings[source.epf.wageCeilings.length - 1].ceilingPaise;
  const now = new Date();
  const row: StatutoryConfigRow = {
    ...(structuredClone(source) as StatutoryConfig),
    fy,
    status: 'to_confirm',
    source: `Copied from FY ${from}`,
    epf: { ...source.epf, wageCeilings: [{ from: fyStart(fy), ceilingPaise: lastCeiling }] },
    createdAt: now,
    updatedAt: now,
    updatedByUserId: viewerUserId,
  };
  try {
    await statutoryConfigs().insertOne(row);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new PayrollConfigError(409, `Statutory settings for FY ${fy} already exist`);
    throw e;
  }
  return { canEdit: true, config: statutoryView((await statutoryConfigs().findOne({ fy }))!) };
}

// ————————————————————————————————————————————————————————————————
// Income tax config API
// ————————————————————————————————————————————————————————————————

function tdsView(row: TdsConfigRow | null | undefined) {
  if (!row) return null;
  const { _id, createdAt, updatedAt, updatedByUserId, ...rest } = row as TdsConfigRow & { _id?: unknown };
  void _id;
  void createdAt;
  return { ...rest, source: rest.source ?? null, updatedAt: updatedAt?.toISOString() ?? null, updatedByUserId: updatedByUserId ?? null };
}

async function tdsBody(fy: string, canEdit: boolean) {
  const rows = await tdsConfigs().find({ fy }).toArray();
  return {
    canEdit,
    fy,
    configs: { new: tdsView(rows.find((r) => r.regime === 'new')), old: tdsView(rows.find((r) => r.regime === 'old')) },
  };
}

export async function listTdsConfigs(viewerUserId: string) {
  const { canEdit } = await accessOf(viewerUserId);
  const rows = await tdsConfigs().find({}, { projection: { _id: 0, fy: 1, regime: 1, status: 1 } }).toArray();
  const byFy = new Map<string, { fy: string; regimes: TaxRegime[]; status: TdsConfig['status'] }>();
  for (const r of rows) {
    const y = byFy.get(r.fy) ?? { fy: r.fy, regimes: [], status: 'confirmed' };
    y.regimes.push(r.regime);
    if (r.status !== 'confirmed') y.status = 'to_confirm';
    byFy.set(r.fy, y);
  }
  const years = [...byFy.values()].map((y) => ({ ...y, regimes: y.regimes.sort() })).sort((a, b) => b.fy.localeCompare(a.fy));
  return { canEdit, years, currentFy: currentFy() };
}

export async function getTdsConfig(viewerUserId: string, fyRaw: unknown) {
  const { canEdit } = await accessOf(viewerUserId);
  const fy = parseFy(fyRaw);
  const body = await tdsBody(fy, canEdit);
  if (!body.configs.new && !body.configs.old) throw new PayrollConfigError(404, tdsMissing(fy));
  return body;
}

export async function putTdsConfig(viewerUserId: string, fyRaw: unknown, regimeRaw: unknown, raw: unknown) {
  await requireEditor(viewerUserId);
  const fy = parseFy(fyRaw);
  const regime = regimeRaw === 'new' || regimeRaw === 'old' ? regimeRaw : undefined;
  if (!regime) throw new PayrollConfigError(400, 'regime must be new or old');
  const config = validateTdsConfig(fy, regime, raw);
  const now = new Date();
  await tdsConfigs().updateOne(
    { fy, regime },
    { $set: { ...config, updatedAt: now, updatedByUserId: viewerUserId }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return tdsBody(fy, true);
}

export async function copyTdsConfig(viewerUserId: string, fyRaw: unknown, copyFromRaw: unknown) {
  await requireEditor(viewerUserId);
  const fy = parseFy(fyRaw);
  const from = parseFy(copyFromRaw, 'copyFrom');
  if (from === fy) throw new PayrollConfigError(400, 'copyFrom must be another year');
  const source = await tdsConfigs().find({ fy: from }, { projection: STRIP }).toArray();
  if (source.length === 0) throw new PayrollConfigError(404, tdsMissing(from));
  if (await tdsConfigs().findOne({ fy }, { projection: { _id: 1 } })) throw new PayrollConfigError(409, `Income tax settings for FY ${fy} already exist`);
  const now = new Date();
  await tdsConfigs().insertMany(source.map((r) => ({
    ...(structuredClone(r) as TdsConfig),
    fy,
    status: 'to_confirm' as const,
    source: `Copied from FY ${from}`,
    createdAt: now,
    updatedAt: now,
    updatedByUserId: viewerUserId,
  })));
  return tdsBody(fy, true);
}

// ————————————————————————————————————————————————————————————————
// Validation
// ————————————————————————————————————————————————————————————————

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function obj(raw: unknown, field: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new PayrollConfigError(400, `${field} must be an object`);
  return raw;
}

function rate(raw: unknown, field: string): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new PayrollConfigError(400, `${field} must be a fraction between 0 and 1`);
  return n;
}

function percent(raw: unknown, field: string): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new PayrollConfigError(400, `${field} must be a percentage between 0 and 100`);
  return n;
}

function paise(raw: unknown, field: string, { positive = false } = {}): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || (positive && n === 0)) {
    throw new PayrollConfigError(400, `${field} must be ${positive ? 'more than 0' : 'a whole amount, 0 or more'} (paise)`);
  }
  return n;
}

function status(raw: unknown): 'to_confirm' | 'confirmed' {
  if (raw === undefined) return 'to_confirm';
  if (raw !== 'to_confirm' && raw !== 'confirmed') throw new PayrollConfigError(400, 'status must be to_confirm or confirmed');
  return raw;
}

function source(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new PayrollConfigError(400, 'source must be text');
  const s = raw.trim();
  if (s.length > 500) throw new PayrollConfigError(400, 'source is too long (500 characters at most)');
  return s || null;
}

function day(raw: unknown, field: string): string {
  const s = String(raw ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new PayrollConfigError(400, `${field} must be a day like 2026-04-01`);
  }
  return s;
}

/** Re-labels the per-state rule errors with where they are in the row. */
function stateRule<T>(state: string, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof StatutoryError) throw new PayrollConfigError(400, `states[${state}]: ${e.message}`);
    throw e;
  }
}

function validatePtSlabsOrder(state: string, pt: PtRule): void {
  const slabs = pt.slabs;
  for (let i = 0; i < slabs.length; i++) {
    const upTo = slabs[i].upToPaise;
    if (upTo === null && i !== slabs.length - 1) throw new PayrollConfigError(400, `states[${state}].pt.slabs: the open-ended slab (upToPaise: null) must be the last one`);
    if (i > 0 && upTo !== null && (slabs[i - 1].upToPaise ?? Infinity) >= upTo) {
      throw new PayrollConfigError(400, `states[${state}].pt.slabs must go up: upToPaise ${upTo} is not above ${slabs[i - 1].upToPaise}`);
    }
  }
}

export function validateStatutoryConfig(fy: string, raw: unknown): StatutoryConfig {
  const body = obj(raw, 'The statutory settings');

  const epfRaw = obj(body.epf, 'epf');
  const epf: StatutoryConfig['epf'] = {
    employeeRate: rate(epfRaw.employeeRate, 'epf.employeeRate'),
    employerRate: rate(epfRaw.employerRate, 'epf.employerRate'),
    epsRate: rate(epfRaw.epsRate, 'epf.epsRate'),
    edliRate: rate(epfRaw.edliRate, 'epf.edliRate'),
    adminRate: rate(epfRaw.adminRate, 'epf.adminRate'),
    wageCeilings: [],
  };
  if (epf.epsRate > epf.employerRate) throw new PayrollConfigError(400, 'epf.epsRate cannot be more than epf.employerRate (EPS is part of the employer contribution)');
  if (!Array.isArray(epfRaw.wageCeilings) || epfRaw.wageCeilings.length === 0) throw new PayrollConfigError(400, 'epf.wageCeilings must list at least one ceiling');
  epfRaw.wageCeilings.forEach((c, i) => {
    const row = obj(c, `epf.wageCeilings[${i}]`);
    const from = day(row.from, `epf.wageCeilings[${i}].from`);
    const ceilingPaise = paise(row.ceilingPaise, `epf.wageCeilings[${i}].ceilingPaise`, { positive: true });
    if (i === 0 && from !== fyStart(fy)) throw new PayrollConfigError(400, `epf.wageCeilings[0].from must be the year's first day, ${fyStart(fy)}`);
    if (from > fyEnd(fy)) throw new PayrollConfigError(400, `epf.wageCeilings[${i}].from is after FY ${fy} ends`);
    if (i > 0 && from <= epf.wageCeilings[i - 1].from) throw new PayrollConfigError(400, 'epf.wageCeilings must be in date order, one per day');
    epf.wageCeilings.push({ from, ceilingPaise });
  });

  const esiRaw = obj(body.esi, 'esi');
  const esi: StatutoryConfig['esi'] = {
    employeeRate: rate(esiRaw.employeeRate, 'esi.employeeRate'),
    employerRate: rate(esiRaw.employerRate, 'esi.employerRate'),
    grossCeilingPaise: paise(esiRaw.grossCeilingPaise, 'esi.grossCeilingPaise', { positive: true }),
  };

  const bonusRaw = obj(body.bonus, 'bonus');
  const bonus: StatutoryConfig['bonus'] = {
    minRate: rate(bonusRaw.minRate, 'bonus.minRate'),
    maxRate: rate(bonusRaw.maxRate, 'bonus.maxRate'),
    wageFloorPaise: paise(bonusRaw.wageFloorPaise, 'bonus.wageFloorPaise', { positive: true }),
    eligibilityCeilingPaise: paise(bonusRaw.eligibilityCeilingPaise, 'bonus.eligibilityCeilingPaise', { positive: true }),
  };
  if (bonus.maxRate < bonus.minRate) throw new PayrollConfigError(400, 'bonus.maxRate cannot be below bonus.minRate');

  const mealRaw = obj(body.mealCard, 'mealCard');
  const mealCard = { exemptMonthlyPaise: paise(mealRaw.exemptMonthlyPaise, 'mealCard.exemptMonthlyPaise') };

  if (!Array.isArray(body.states)) throw new PayrollConfigError(400, 'states must be a list (it may be empty)');
  const seen = new Set<string>();
  const states: StateStatutoryDefaults[] = body.states.map((s, i) => {
    const row = obj(s, `states[${i}]`);
    const state = String(row.state ?? '').trim().toLowerCase();
    if (!state) throw new PayrollConfigError(400, `states[${i}].state is required`);
    if (state.length > 60) throw new PayrollConfigError(400, `states[${i}].state is too long`);
    if (seen.has(state)) throw new PayrollConfigError(400, `states: ${state} is listed twice`);
    seen.add(state);
    if (row.pt === undefined && row.lwf === undefined) throw new PayrollConfigError(400, `states[${state}] needs pt or lwf`);
    const pt: PtRule | undefined = row.pt === undefined || row.pt === null ? undefined : stateRule(state, () => validatePtRule(row.pt));
    if (pt) validatePtSlabsOrder(state, pt);
    const lwf: LwfRule | undefined = row.lwf === undefined || row.lwf === null ? undefined : stateRule(state, () => validateLwfRule(row.lwf));
    return { state, ...(pt ? { pt } : {}), ...(lwf ? { lwf } : {}) };
  });
  states.sort((a, b) => a.state.localeCompare(b.state));

  return { fy, status: status(body.status), source: source(body.source), epf, esi, bonus, mealCard, states };
}

const LIMIT_KEYS = ['sec80C', 'sec80CCD1B', 'sec80DSelf', 'sec80DSelfSenior', 'sec80DParents', 'sec80DParentsSenior', 'sec24bHomeLoan', 'sec80TTA'] as const;

export function validateTdsConfig(fy: string, regime: TaxRegime, raw: unknown): TdsConfig {
  const body = obj(raw, 'The income tax settings');

  if (!Array.isArray(body.slabs) || body.slabs.length === 0) throw new PayrollConfigError(400, 'slabs must list at least one slab');
  const slabs = body.slabs.map((s, i) => {
    const row = obj(s, `slabs[${i}]`);
    const upToPaise = row.upToPaise === null ? null : paise(row.upToPaise, `slabs[${i}].upToPaise`, { positive: true });
    return { upToPaise, ratePercent: percent(row.ratePercent, `slabs[${i}].ratePercent`) };
  });
  slabs.forEach((s, i) => {
    if (s.upToPaise === null && i !== slabs.length - 1) throw new PayrollConfigError(400, 'slabs: the open-ended slab (upToPaise: null) must be the last one');
    if (i > 0 && s.upToPaise !== null && (slabs[i - 1].upToPaise ?? Infinity) >= s.upToPaise) throw new PayrollConfigError(400, `slabs must go up: upToPaise ${s.upToPaise} is not above ${slabs[i - 1].upToPaise}`);
  });
  if (slabs[slabs.length - 1].upToPaise !== null) throw new PayrollConfigError(400, 'slabs must end with an open-ended top slab (upToPaise: null)');

  const rebateRaw = obj(body.rebate, 'rebate');
  const rebate = {
    incomeLimitPaise: paise(rebateRaw.incomeLimitPaise, 'rebate.incomeLimitPaise'),
    maxRebatePaise: paise(rebateRaw.maxRebatePaise, 'rebate.maxRebatePaise'),
    marginalRelief: Boolean(rebateRaw.marginalRelief),
  };

  if (!Array.isArray(body.surcharge)) throw new PayrollConfigError(400, 'surcharge must be a list (it may be empty)');
  const surcharge = body.surcharge.map((s, i) => {
    const row = obj(s, `surcharge[${i}]`);
    return { abovePaise: paise(row.abovePaise, `surcharge[${i}].abovePaise`, { positive: true }), ratePercent: percent(row.ratePercent, `surcharge[${i}].ratePercent`) };
  });
  surcharge.forEach((s, i) => {
    if (i > 0 && surcharge[i - 1].abovePaise >= s.abovePaise) throw new PayrollConfigError(400, 'surcharge must go up: each abovePaise above the one before');
  });

  const limitsRaw = obj(body.limits, 'limits');
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, paise(limitsRaw[k], `limits.${k}`)])) as TdsConfig['limits'];

  const hraExemption = Boolean(body.hraExemption);
  let hra: TdsConfig['hra'];
  if (body.hra !== undefined && body.hra !== null) {
    const h = obj(body.hra, 'hra');
    hra = {
      metroPercentOfBasic: percent(h.metroPercentOfBasic, 'hra.metroPercentOfBasic'),
      nonMetroPercentOfBasic: percent(h.nonMetroPercentOfBasic, 'hra.nonMetroPercentOfBasic'),
      rentOverPercentOfBasic: percent(h.rentOverPercentOfBasic, 'hra.rentOverPercentOfBasic'),
    };
  }
  if (hraExemption && !hra) throw new PayrollConfigError(400, 'hra (the exemption rule) is needed when hraExemption is on');

  return {
    fy,
    regime,
    status: status(body.status),
    source: source(body.source) ?? undefined,
    standardDeductionPaise: paise(body.standardDeductionPaise, 'standardDeductionPaise'),
    slabs,
    rebate,
    surcharge,
    cessPercent: percent(body.cessPercent, 'cessPercent'),
    limits,
    ptDeductible: Boolean(body.ptDeductible),
    hraExemption,
    ...(hra ? { hra } : {}),
  };
}
