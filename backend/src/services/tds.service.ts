/**
 * The TDS engine wired to storage: the FY's config rows, a person's
 * declaration, their earlier payslips this FY, and the monthly figure a run
 * withholds when HR hasn't typed one.
 */
import { payrollRuns, payslips, taxDeclarations, tdsConfigs, users } from '../config/db';
import { TaxDeclarationRow } from '../models/tds.model';
import { computeTds, fyOf, TaxDeclarations, TaxRegime, TdsConfig, TdsResult } from '../shared/payroll/tds';
import { hasPayrollAccess } from './payrollAccess.service';

export class TdsError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'TdsError';
  }
}

/** The config rows for a FY, by regime. Absent rows: no automatic TDS that year. */
export async function tdsConfigsFor(fy: string): Promise<Map<TaxRegime, TdsConfig>> {
  const rows = await tdsConfigs().find({ fy }, { projection: { _id: 0, createdAt: 0, updatedAt: 0 } }).toArray();
  return new Map(rows.map((r) => [r.regime, r as TdsConfig]));
}

export interface YtdFigures {
  taxablePaise: number;
  tdsPaise: number;
}

/** Earlier this FY, per person: taxable pay and tax withheld, from runs not rejected, before `period`. */
export async function ytdFor(org: string, period: string, userIds: string[]): Promise<Map<string, YtdFigures>> {
  const { firstPeriod } = fyOf(period);
  const runs = await payrollRuns().find({ org, period: { $gte: firstPeriod, $lt: period }, status: { $ne: 'rejected' } }, { projection: { _id: 1 } }).toArray();
  const out = new Map<string, YtdFigures>();
  if (runs.length === 0) return out;
  const slips = await payslips()
    .find({ org, runId: { $in: runs.map((r) => r._id.toHexString()) }, userId: { $in: userIds } }, { projection: { userId: 1, grossPaise: 1, taxablePaise: 1, deductions: 1 } })
    .toArray();
  for (const slip of slips) {
    const y = out.get(slip.userId) ?? { taxablePaise: 0, tdsPaise: 0 };
    y.taxablePaise += slip.taxablePaise ?? slip.grossPaise;
    y.tdsPaise += slip.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
    out.set(slip.userId, y);
  }
  return out;
}

export async function declarationsFor(org: string, fy: string, userIds: string[]): Promise<Map<string, TaxDeclarationRow>> {
  const rows = await taxDeclarations().find({ org, fy, userId: { $in: userIds } }).toArray();
  return new Map(rows.map((r) => [r.userId, r]));
}

export function runTds(args: {
  configs: Map<TaxRegime, TdsConfig>;
  regime: TaxRegime;
  period: string;
  ytd?: YtdFigures;
  currentTaxablePaise: number;
  futureMonthlyTaxablePaise: number;
  basicMonthlyPaise: number;
  hraMonthlyPaise: number;
  employeePfMonthlyPaise: number;
  ptMonthlyPaise: number;
  declarations?: TaxDeclarations;
}): TdsResult | undefined {
  const config = args.configs.get(args.regime);
  if (!config) return undefined;
  const { monthsAfter } = fyOf(args.period);
  const months = 12;
  return computeTds({
    config,
    ytdTaxablePaise: args.ytd?.taxablePaise ?? 0,
    ytdTdsPaise: args.ytd?.tdsPaise ?? 0,
    currentTaxablePaise: args.currentTaxablePaise,
    futureMonthlyTaxablePaise: args.futureMonthlyTaxablePaise,
    monthsAfter,
    // Old regime pieces, a normal month's figure for the whole year.
    basicYearPaise: args.basicMonthlyPaise * months,
    hraYearPaise: args.hraMonthlyPaise * months,
    employeePfYearPaise: args.employeePfMonthlyPaise * months,
    ptYearPaise: args.ptMonthlyPaise * months,
    declarations: args.declarations,
  });
}

// —— Declarations API (HR enters them for now) ——

async function access(viewerUserId: string, userId: string) {
  const viewer = await users().findOne({ userId: viewerUserId }, { projection: { _id: 0, org: 1, dashboardAccess: 1, dashboardAdmin: 1, dashboardTabs: 1 } });
  if (!viewer?.org) throw new TdsError(403, 'No organisation on this account');
  if (!hasPayrollAccess(viewer)) throw new TdsError(403, 'Only people with payroll access can see tax declarations');
  const employee = await users().findOne({ userId }, { projection: { _id: 0, org: 1 } });
  if (!employee || employee.org !== viewer.org) throw new TdsError(404, 'Employee not found');
  return viewer.org;
}

const AMOUNT_FIELDS = ['sec80C', 'sec80CCD1B', 'sec80DSelf', 'sec80DParents', 'homeLoanInterest', 'sec80TTA', 'rentPaidPaise', 'otherIncomePaise', 'previousEmployerSalaryPaise', 'previousEmployerTdsPaise'] as const;

export async function getDeclaration(viewerUserId: string, userId: string, fy: string) {
  const org = await access(viewerUserId, userId);
  const row = await taxDeclarations().findOne({ org, userId, fy }, { projection: { _id: 0 } });
  const configs = await tdsConfigsFor(fy);
  return {
    declaration: row ?? null,
    configs: [...configs.values()].map((c) => ({ regime: c.regime, status: c.status, source: c.source })),
  };
}

export async function setDeclaration(viewerUserId: string, userId: string, fy: string, input: Record<string, unknown>) {
  const org = await access(viewerUserId, userId);
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new TdsError(400, 'fy is like 2026-27');
  const regime = input.regime === 'old' ? 'old' : input.regime === 'new' ? 'new' : undefined;
  if (!regime) throw new TdsError(400, 'regime must be new or old');
  const raw = (input.declarations ?? {}) as Record<string, unknown>;
  const declarations: TaxDeclarations = {};
  for (const f of AMOUNT_FIELDS) {
    if (raw[f] === undefined || raw[f] === null || raw[f] === '') continue;
    const n = Number(raw[f]);
    if (!Number.isInteger(n) || n < 0) throw new TdsError(400, `${f} must be a whole amount in paise`);
    declarations[f] = n;
  }
  for (const f of ['selfSenior', 'parentsSenior', 'metro'] as const) if (raw[f] !== undefined) declarations[f] = Boolean(raw[f]);
  const proofs = input.proofs === 'submitted' || input.proofs === 'verified' ? input.proofs : 'none';
  await taxDeclarations().updateOne(
    { org, userId, fy },
    { $set: { org, userId, fy, regime, declarations, proofs, updatedAt: new Date(), updatedByUserId: viewerUserId } },
    { upsert: true },
  );
  return getDeclaration(viewerUserId, userId, fy);
}
