/**
 * The flexible split (app › Payroll › Change my split).
 *
 * Flexible components are the reimbursement heads, and any pay head marked
 * `fbp`, on the person's template that are set per person (`flat_amount`)
 * and have a monthly limit. The person splits a monthly pool among them, each
 * within its limit; what is left is paid as the balancing component (Fixed
 * Allowance) and taxed in full. A split applies from one month to the end of
 * that financial year; the payroll run reads it over the structure's own
 * per-person values (`splitAmountsFor`).
 *
 * The window: a change made today applies from this month while today is on
 * or before the company's cutoff day, else from next month, and never to a
 * month a run has locked.
 */
import { flexibleSplits, reimbursementClaims, salaryStructures, salaryTemplates, taxDeclarations } from '../config/db';
import { FlexibleSplit } from '../models/employeePayroll.model';
import { PayHead } from '../models/payHead.model';
import { SalaryStructure } from '../models/salaryStructure.model';
import { SalaryTemplate } from '../models/salaryTemplate.model';
import { fyEndPeriod, splitProblem } from '../shared/payroll/declaration';
import { applyOverrides, resolveTemplateComponents } from '../shared/payroll/resolve';
import { fyOf, taxOnIncome, TaxRegime } from '../shared/payroll/tds';
import {
  EmployeePayrollError, dayInMonth, dayOf, deadlinesOf, fyLastDay, lockedPeriods, meOf, nextPeriod, periodOf,
} from './employeePayroll.common';
import { billCategories } from './reimbursementBills.service';
import { computeStructureFor } from './salaryStructure.service';
import { catalogWithStandard } from './standardComponents.service';
import { statutorySettingsFor } from './statutorySettings.service';
import { tdsConfigsFor } from './tds.service';

export interface FlexibleComponent {
  code: string;
  name: string;
  limitPaise: number;
  /** The amount before any split: the structure's own value, else the template's. */
  basePaise: number;
}

/** Which of a person's resolved components they may split their pool among. */
export function flexibleComponentsOf(resolved: PayHead[], structure: Pick<SalaryStructure, 'componentValues'>, balancingCode?: string): FlexibleComponent[] {
  return resolved
    .filter((h) => (h.category === 'reimbursement' || h.fbp === true) && h.calculation.mode === 'flat_amount' && (h.maxClaimablePaise ?? 0) > 0 && h.code !== balancingCode)
    .map((h) => {
      const own = structure.componentValues?.[h.code];
      // As the calculator pays a reimbursement: the person's value, the template's amount, else the limit.
      const base = own !== undefined ? own : h.category === 'reimbursement' ? h.calculation.amountPaise || h.maxClaimablePaise || 0 : 0;
      return { code: h.code, name: h.payslipName?.trim() || h.name, limitPaise: h.maxClaimablePaise!, basePaise: Math.min(base, h.maxClaimablePaise!) };
    });
}

/** The split in force for a pay month: the latest one starting on or before it in the same FY. */
export function splitFor(splits: FlexibleSplit[], period: string): FlexibleSplit | undefined {
  const { fy } = fyOf(period);
  let best: FlexibleSplit | undefined;
  for (const s of splits) {
    if (s.fy !== fy || s.effectiveFrom > period) continue;
    if (!best || s.effectiveFrom > best.effectiveFrom) best = s;
  }
  return best;
}

export const splitAmountsFor = (splits: FlexibleSplit[] | undefined, period: string): Record<string, number> =>
  (splits && splitFor(splits, period)?.amounts) ?? {};

/** Everyone's splits, by person, for a payroll run. */
export async function splitsByUser(org: string, userIds: string[]): Promise<Map<string, FlexibleSplit[]>> {
  const out = new Map<string, FlexibleSplit[]>();
  if (userIds.length === 0) return out;
  const rows = await flexibleSplits().find({ org, userId: { $in: userIds } }, { projection: { _id: 0 } }).toArray();
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r]);
  return out;
}

export interface SplitWindow {
  open: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  closesOn: string;
  reason: string | null;
}

/** The first month a change made at `now` applies to, and until when it can still be made for it. */
export async function splitWindow(org: string, now: Date): Promise<SplitWindow> {
  const { splitCutoffDay } = await deadlinesOf(org);
  let period = periodOf(now);
  if (dayOf(now) > dayInMonth(period, splitCutoffDay)) period = nextPeriod(period);
  const locked = await lockedPeriods(org, period, `${Number(period.slice(0, 4)) + 1}-12`);
  while (locked.has(period)) period = nextPeriod(period);
  return { open: true, effectiveFrom: period, effectiveTo: fyEndPeriod(period), closesOn: dayInMonth(period, splitCutoffDay), reason: null };
}

interface Context {
  org: string;
  structure: SalaryStructure;
  template: SalaryTemplate;
  components: FlexibleComponent[];
  poolPaise: number;
}

async function contextOf(userId: string): Promise<Context> {
  const { org } = await meOf(userId);
  const structure = await salaryStructures().findOne({ org, userId }, { projection: { _id: 0 } });
  if (!structure?.salaryTemplateCode) throw new EmployeePayrollError(404, 'No salary structure has been set up for you yet');
  const [template, catalog] = await Promise.all([
    salaryTemplates().findOne({ org, code: structure.salaryTemplateCode }),
    catalogWithStandard(org).then((c) => c.all),
  ]);
  if (!template) throw new EmployeePayrollError(404, 'No salary structure has been set up for you yet');
  const byCode = new Map(catalog.map((h) => [h.code, h]));
  const resolved = resolveTemplateComponents(applyOverrides(template.components, structure.overrides, byCode), byCode);
  const components = flexibleComponentsOf(resolved, structure, template.balancingComponentCode);
  const poolPaise = template.flexiblePoolPaise ?? components.reduce((sum, c) => sum + c.limitPaise, 0);
  return { org, structure, template, components, poolPaise };
}

/** This FY's bills for each flexible head: approved (or paid), waiting, declined. */
async function billCounts(org: string, userId: string, fy: string): Promise<Map<string, { approved: number; inReview: number; rejected: number }>> {
  const categories = await billCategories(org);
  const out = new Map<string, { approved: number; inReview: number; rejected: number }>();
  if (categories.size === 0) return out;
  const start = new Date(`${fy.slice(0, 4)}-04-01T00:00:00Z`);
  const end = new Date(`${fyLastDay(fy)}T23:59:59.999Z`);
  const claims = await reimbursementClaims()
    .find({ userId, category: { $in: [...categories.keys()] }, expenseDate: { $gte: start, $lte: end } }, { projection: { category: 1, status: 1 } })
    .toArray();
  for (const c of claims) {
    const code = categories.get(c.category);
    if (!code) continue;
    const n = out.get(code) ?? { approved: 0, inReview: 0, rejected: 0 };
    if (c.status === 'approved' || c.status === 'paid') n.approved += 1;
    else if (c.status === 'pending') n.inReview += 1;
    else if (c.status === 'declined') n.rejected += 1;
    out.set(code, n);
  }
  return out;
}

const EMPTY_SPLIT = (window: SplitWindow, billsDueOn: string) => ({
  available: false, poolPaise: 0, assignedPaise: 0, unassignedPaise: 0, components: [], current: null, window, billsDueOn,
});

/** The person's split as Change my split shows it. */
export async function mySplit(userId: string, now = new Date()) {
  const ctx = await contextOf(userId);
  const window = await splitWindow(ctx.org, now);
  const billsDueOn = fyLastDay(fyOf(window.effectiveFrom).fy);
  if (ctx.components.length === 0) return EMPTY_SPLIT(window, billsDueOn);
  const [splits, bills] = await Promise.all([
    flexibleSplits().find({ org: ctx.org, userId }, { projection: { _id: 0 } }).toArray(),
    billCounts(ctx.org, userId, fyOf(periodOf(now)).fy),
  ]);
  const current = splitFor(splits, window.effectiveFrom);
  const amounts = amountsOf(ctx.components, current?.amounts);
  const assigned = Object.values(amounts).reduce((a, b) => a + b, 0);
  return {
    available: true,
    poolPaise: ctx.poolPaise,
    assignedPaise: assigned,
    unassignedPaise: Math.max(0, ctx.poolPaise - assigned),
    components: ctx.components.map((c) => ({
      code: c.code,
      name: c.name,
      limitPaise: c.limitPaise,
      amountPaise: amounts[c.code],
      stepPaise: 10_000,
      bills: bills.get(c.code) ?? { approved: 0, inReview: 0, rejected: 0 },
    })),
    current: current ? { effectiveFrom: current.effectiveFrom, submittedAt: current.submittedAt.toISOString() } : null,
    window,
    billsDueOn,
  };
}

function amountsOf(components: FlexibleComponent[], split: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(components.map((c) => [c.code, split ? split[c.code] ?? 0 : c.basePaise]));
}

function parseAmounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EmployeePayrollError(400, 'amounts must be an object of component code to paise');
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    out[code.trim().toUpperCase()] = n;
  }
  return out;
}

async function proposal(userId: string, body: Record<string, unknown>, now: Date) {
  const ctx = await contextOf(userId);
  if (ctx.components.length === 0) throw new EmployeePayrollError(409, 'Your salary has no flexible components to split');
  const window = await splitWindow(ctx.org, now);
  const given = parseAmounts(body.amounts);
  const splits = await flexibleSplits().find({ org: ctx.org, userId }, { projection: { _id: 0 } }).toArray();
  const previous = amountsOf(ctx.components, splitFor(splits, window.effectiveFrom)?.amounts);
  const next = { ...previous, ...given };
  const problem = splitProblem(next, ctx.components, ctx.poolPaise);
  if (problem) throw new EmployeePayrollError(400, problem);
  return { ctx, window, previous, next };
}

/** What a split would be, without saving it (Review). */
export async function reviewSplit(userId: string, body: Record<string, unknown>, now = new Date()) {
  const { ctx, window, previous, next } = await proposal(userId, body, now);
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  return {
    effectiveFrom: window.effectiveFrom,
    effectiveTo: window.effectiveTo,
    closesOn: window.closesOn,
    lines: ctx.components.map((c) => ({
      code: c.code,
      name: c.name,
      previousPaise: previous[c.code],
      amountPaise: next[c.code],
      changePaise: next[c.code] - previous[c.code],
      isNew: previous[c.code] === 0 && next[c.code] > 0,
    })),
    totalPaise: total,
    poolPaise: ctx.poolPaise,
    unassignedPaise: Math.max(0, ctx.poolPaise - total),
    monthlyTaxSavingPaise: await taxSaving(ctx, next, window.effectiveFrom).catch(() => null),
    billsDueOn: fyLastDay(fyOf(window.effectiveFrom).fy),
  };
}

/** Save a split from the window's month to the end of its FY. */
export async function saveSplit(userId: string, body: Record<string, unknown>, now = new Date()) {
  if (body.acknowledged !== true) throw new EmployeePayrollError(400, 'Confirm that you will keep the bills for these heads');
  const { ctx, window, next } = await proposal(userId, body, now);
  // The app reviewed it for one month; if the window moved since, it reviews again.
  if (typeof body.effectiveFrom === 'string' && body.effectiveFrom !== window.effectiveFrom) {
    throw new EmployeePayrollError(409, `Changes now apply from ${monthName(window.effectiveFrom)}. Review your split again.`);
  }
  const row: FlexibleSplit = {
    org: ctx.org,
    userId,
    fy: fyOf(window.effectiveFrom).fy,
    effectiveFrom: window.effectiveFrom,
    amounts: next,
    acknowledged: true,
    submittedAt: now,
  };
  await flexibleSplits().updateOne({ org: ctx.org, userId, effectiveFrom: window.effectiveFrom }, { $set: row }, { upsert: true });
  return mySplit(userId, now);
}

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * About how much less tax a month the split saves once its bills are
 * approved: the year's tax with the flexible amounts taxed, less the year's
 * tax without them, on a normal month's salary. Declarations are left out:
 * it is an estimate.
 */
async function taxSaving(ctx: Context, amounts: Record<string, number>, period: string): Promise<number | null> {
  const { fy } = fyOf(period);
  const [configs, declaration, settings] = await Promise.all([
    tdsConfigsFor(fy),
    taxDeclarations().findOne({ org: ctx.org, userId: ctx.structure.userId, fy }, { projection: { regime: 1 } }),
    statutorySettingsFor(ctx.org),
  ]);
  const regime: TaxRegime = declaration?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const config = configs.get(regime);
  if (!config) return null;
  const { computed } = await computeStructureFor(ctx.org, ctx.structure.userId, {
    ...ctx.structure,
    componentValues: { ...(ctx.structure.componentValues ?? {}), ...amounts },
  });
  const flexible = Object.values(amounts).reduce((a, b) => a + b, 0);
  const yearly = (monthly: number) => Math.max(0, monthly * 12 - config.standardDeductionPaise);
  const withoutBills = taxOnIncome(yearly(computed.grossMonthlyPaise + flexible), config).annualTaxPaise;
  const withBills = taxOnIncome(yearly(computed.grossMonthlyPaise), config).annualTaxPaise;
  return Math.max(0, Math.round((withoutBills - withBills) / 12 / 100) * 100);
}
