/**
 * The year's income tax (app › Payroll › Tax): what the TDS engine makes of
 * the whole financial year, what this FY's released payslips have already
 * withheld, and the months still to come at the figure a run would take now.
 *
 * Paid months are the released payslips' own income tax line, never worked
 * out again. The months after the last released payslip are projected the way
 * a run projects them (shared/payroll/tds.ts through runTds): the year so far
 * from those payslips, each coming month on the person's structure as it pays
 * that month, their regime and declaration. Anything HR has not set up (the
 * FY's tax rules, TDS switched on, the salary, the FY's statutory row) is
 * said, with no figure: nothing here falls back to an invented number.
 */
import { ObjectId } from 'mongodb';
import { flexibleSplits, payHeads, payrollRuns, payslips, salaryStructures, taxDeclarations, users } from '../config/db';
import { PayrollRunStatus, Payslip } from '../models/payrollRun.model';
import { projectedTaxable } from '../shared/payroll/payroll-run.calculator';
import { SalaryCalcResult } from '../shared/payroll/salary-calculator';
import { TaxRegime, TdsConfigIncompleteError } from '../shared/payroll/tds';
import {
  askHr, dayOf, deadlinesOf, declarationDueOn, form16AppEnabled, istPeriodOf, meOf, nextPeriod, parseFyParam, periodOf, proofsDueOn,
} from './employeePayroll.common';
import { splitAmountsFor } from './employeePayroll.split';
import { PayrollConfigError, statutoryConfigForPeriod } from './payrollConfig.service';
import { computeStructureFor, SalaryStructureError } from './salaryStructure.service';
import { statutorySettingsFor } from './statutorySettings.service';
import { runTds, tdsConfigsFor } from './tds.service';

/** As the employee's payslip list: a draft or a run awaiting approval is not theirs to see yet. */
const RELEASED: PayrollRunStatus[] = ['approved', 'paid'];

export type TaxSummaryReason = 'tax_rules_not_set_up' | 'tds_off' | 'salary_not_set_up' | 'statutory_not_set_up';

export interface TaxSummaryMonth {
  period: string;
  /** "April 2026". */
  label: string;
  /** Paid: the payslip's income tax. Estimate: the monthly figure now (null while not set up). No payslip: null. */
  amountPaise: number | null;
  /** `no_payslip`: a month before the projection with no released payslip in Sowaka (before joining, or paid elsewhere). */
  status: 'paid' | 'estimate' | 'no_payslip';
}

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function fyPeriods(fy: string): string[] {
  const out: string[] = [];
  let p = `${fy.slice(0, 4)}-04`;
  for (let i = 0; i < 12; i++, p = nextPeriod(p)) out.push(p);
  return out;
}

const incomeTaxOf = (slip: Pick<Payslip, 'deductions'>) => slip.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;

/** This FY's released payslips of the person, one per month (the newest run's). */
async function releasedSlips(org: string, userId: string, from: string, to: string): Promise<Map<string, Payslip>> {
  const slips = await payslips()
    .find({ org, userId, period: { $gte: from, $lte: to } }, { projection: { period: 1, runId: 1, deductions: 1, grossPaise: 1, taxablePaise: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  const runIds = [...new Set(slips.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }, { projection: { _id: 1 } }).toArray() : [];
  const released = new Set(runs.map((r) => r._id.toHexString()));
  const out = new Map<string, Payslip>();
  for (const s of slips) if (released.has(s.runId) && !out.has(s.period)) out.set(s.period, s as Payslip);
  return out;
}

class NotSetUp extends Error {
  constructor(public readonly reason: TaxSummaryReason, message: string) {
    super(message);
  }
}

/** The year's tax on the engine, from `start` to March; throws NotSetUp for anything HR has not set up. */
async function projection(args: {
  org: string;
  userId: string;
  fy: string;
  regime: TaxRegime;
  start: string;
  periods: string[];
  ytd: { taxablePaise: number; tdsPaise: number };
  declarations: Parameters<typeof runTds>[0]['declarations'];
}) {
  const { org, userId, fy, regime, start, periods } = args;
  const [settings, configs, structure, employee] = await Promise.all([
    statutorySettingsFor(org),
    tdsConfigsFor(fy),
    salaryStructures().findOne({ org, userId }),
    users().findOne({ userId, org }),
  ]);
  if (!settings.tds?.enabled) {
    throw new NotSetUp('tds_off', askHr('Income tax is not worked out in Sowaka for your company yet, so there is no estimate for the year'));
  }
  if (!configs.has(regime)) throw new NotSetUp('tax_rules_not_set_up', `The income tax rules for FY ${fy} are not set up yet. Ask HR.`);
  if (!structure?.salaryTemplateCode || !employee) {
    throw new NotSetUp('salary_not_set_up', askHr('Your salary is not set up in payroll yet, so your tax for the year can\'t be worked out'));
  }

  let statutory: Awaited<ReturnType<typeof statutoryConfigForPeriod>>;
  let months: SalaryCalcResult[];
  const [splits, catalog] = await Promise.all([
    flexibleSplits().find({ org, userId }).toArray(),
    payHeads().find({ org }, { projection: { _id: 0, code: 1, taxable: 1 } }).toArray(),
  ]);
  try {
    statutory = await statutoryConfigForPeriod(start);
    // Each month on its own structure, as a run projects them (a PF ceiling change moves the balance).
    months = await Promise.all(periods.map(async (p) => (await computeStructureFor(org, userId, {
      ...structure,
      componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits, p) },
    }, employee, p)).computed));
  } catch (error) {
    if (error instanceof PayrollConfigError && error.statusCode === 409) {
      throw new NotSetUp('statutory_not_set_up', askHr(`Your tax can't be worked out yet: the statutory settings (PF, ESI, professional tax) for FY ${fy} are not set up`));
    }
    if (error instanceof SalaryStructureError && error.statusCode === 409) {
      throw new NotSetUp('salary_not_set_up', askHr(`Your tax can't be worked out yet: ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`));
    }
    throw error;
  }
  // Salary reimbursements count as taxable until bills come in, as a run counts the months to come.
  const untaxed = new Set(catalog.filter((h) => h.taxable === false).map((h) => h.code));
  const taxable = (c: SalaryCalcResult) =>
    projectedTaxable(c, statutory.mealCard.exemptMonthlyPaise) + (c.reimbursements ?? []).filter((l) => !untaxed.has(l.code)).reduce((t, l) => t + l.monthlyPaise, 0);
  const first = months[0];
  const byType = (t: string) => first.earnings.filter((l) => l.componentType === t).reduce((s, l) => s + l.monthlyPaise, 0);
  let result: ReturnType<typeof runTds>;
  try {
    result = runTds({
      configs,
      regime,
      period: start,
      ytd: args.ytd,
      currentTaxablePaise: taxable(first),
      futureMonthlyTaxablePaise: taxable(first),
      futureTaxablePaise: months.slice(1).reduce((t, c) => t + taxable(c), 0),
      basicMonthlyPaise: byType('basic'),
      hraMonthlyPaise: byType('hra'),
      employeePfMonthlyPaise: first.statutory.epf.employeePaise,
      ptMonthlyPaise: first.statutory.pt.amountPaise,
      declarations: args.declarations,
    });
  } catch (error) {
    if (error instanceof TdsConfigIncompleteError) throw new NotSetUp('tax_rules_not_set_up', askHr(error.message));
    throw error;
  }
  if (!result) throw new NotSetUp('tax_rules_not_set_up', `The income tax rules for FY ${fy} are not set up yet. Ask HR.`);
  return result;
}

export async function myTaxSummary(userId: string, fyRaw: unknown, now = new Date()) {
  const { org } = await meOf(userId);
  const fy = parseFyParam(fyRaw, now);
  const periods = fyPeriods(fy);
  const [row, settings, deadlines, configs, paid, person, form16Enabled] = await Promise.all([
    taxDeclarations().findOne({ org, userId, fy }, { projection: { _id: 0 } }),
    statutorySettingsFor(org),
    deadlinesOf(org),
    tdsConfigsFor(fy),
    releasedSlips(org, userId, periods[0], periods[11]),
    users().findOne({ userId }, { projection: { _id: 0, joiningDate: 1 } }),
    form16AppEnabled(org),
  ]);
  // The regime as the declaration page shows it.
  const regime: TaxRegime = row?.regime ?? settings.tds?.defaultRegime ?? 'new';
  const regimeDueOn = declarationDueOn(fy, deadlines);
  const locked = regimeDueOn !== null && dayOf(now) > regimeDueOn;
  const missing = [...(regimeDueOn === null ? ['declarationDue'] : []), ...(proofsDueOn(fy, deadlines) === null ? ['proofsDue'] : [])];
  // Saving a regime is the declaration save: it needs both regimes' rules and an open due date.
  const rulesSetUp = Boolean(configs.get('old')?.limits) && configs.has('new');

  const paidPeriods = [...paid.keys()].sort();
  const paidThroughMonth = paidPeriods.length ? paidPeriods[paidPeriods.length - 1] : null;
  const paidSoFarPaise = [...paid.values()].reduce((t, s) => t + incomeTaxOf(s), 0);
  // The projection starts after the last released payslip (else this month), never before joining.
  let start = paidThroughMonth ? nextPeriod(paidThroughMonth) : istPeriodOf(now) > periods[0] ? istPeriodOf(now) : periods[0];
  const joined = person?.joiningDate instanceof Date && !Number.isNaN(person.joiningDate.getTime()) ? periodOf(person.joiningDate) : null;
  if (joined && joined > start) start = joined;
  const coming = periods.filter((p) => p >= start);

  let reason: TaxSummaryReason | null = null;
  let message: string | null = null;
  let annualTaxPaise: number | null = paidSoFarPaise;
  let monthlyNowPaise: number | null = null;
  if (coming.length > 0) {
    try {
      const result = await projection({
        org, userId, fy, regime, start, periods: coming,
        ytd: {
          taxablePaise: [...paid.values()].reduce((t, s) => t + (s.taxablePaise ?? s.grossPaise), 0),
          tdsPaise: paidSoFarPaise,
        },
        declarations: row?.declarations,
      });
      annualTaxPaise = result.annualTaxPaise;
      monthlyNowPaise = result.monthlyTdsPaise;
    } catch (error) {
      if (!(error instanceof NotSetUp)) throw error;
      reason = error.reason;
      message = error.message;
      annualTaxPaise = null;
    }
  }

  const months: TaxSummaryMonth[] = periods.map((period) => {
    const slip = paid.get(period);
    if (slip) return { period, label: monthLabel(period), amountPaise: incomeTaxOf(slip), status: 'paid' };
    if (period >= start) return { period, label: monthLabel(period), amountPaise: monthlyNowPaise, status: 'estimate' };
    return { period, label: monthLabel(period), amountPaise: null, status: 'no_payslip' };
  });

  return {
    fy,
    regime,
    chosen: Boolean(row),
    defaultRegime: (settings.tds?.defaultRegime ?? 'new') as TaxRegime,
    regimeDueOn,
    proofsDueOn: proofsDueOn(fy, deadlines),
    locked,
    canChangeRegime: rulesSetUp && regimeDueOn !== null && !locked,
    notConfigured: reason !== null,
    reason,
    message,
    missing,
    annualTaxPaise,
    paidSoFarPaise,
    paidThroughMonth,
    monthlyNowPaise,
    months,
    estimate: coming.length > 0,
    // Whether the page offers "Download Form 16": companies.features.form16, set by Sowaka.
    form16Enabled,
  };
}
