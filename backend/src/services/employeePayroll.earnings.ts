/**
 * Earnings (app › Payroll › Earnings): what the person has been paid in a
 * financial year, month by month, and their yearly salary.
 *
 * Every figure comes from the person's own released payslips (a run that was
 * approved or paid), plus, for the year it is in, this pay period's estimate
 * as Home works it out (the same numbers Home shows). Nothing is filled in:
 * a month with no released payslip and no estimate is simply not listed, and
 * a salary structure or setup that is missing says so (`componentsNotSetUp`,
 * `estimateNotSetUp`) instead of carrying a made-up figure.
 *
 * The yearly salary is the salary structure as it pays now for the current
 * year (computeStructureFor, with the person's flexible split). For an
 * earlier year the structure of the time is not kept, so it is what that
 * year's payslips were entitled to, component by component, before loss of
 * pay (`componentsSource: 'payslips'`).
 */
import { ObjectId } from 'mongodb';
import { flexibleSplits, payrollRuns, payslips, salaryStructures } from '../config/db';
import { Payslip, PayrollRunStatus } from '../models/payrollRun.model';
import { fyOf } from '../shared/payroll/tds';
import { EmployeePayrollError, askHr, meOf, parseFyParam } from './employeePayroll.common';
import { myPayrollHome } from './employeePayroll.home';
import { splitAmountsFor } from './employeePayroll.split';
import { PayrollConfigError } from './payrollConfig.service';
import { SalaryStructureError, computeStructureFor } from './salaryStructure.service';

/** The runs whose payslips the person sees (as the Payslips list reads them). */
const RELEASED: PayrollRunStatus[] = ['approved', 'paid'];

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (period: string) => Number(period.slice(5, 7));
/** "2026-10" → "October 2026". */
const monthLabel = (period: string) => `${LONG[monthOf(period) - 1]} ${period.slice(0, 4)}`;

/** Statutory employee deductions shown as "PF and professional tax". */
const PF_PT = new Set(['epf', 'pt']);

export interface EarningsComponent {
  code: string;
  name: string;
  annualPaise: number;
}

export interface EarningsMonth {
  period: string;
  label: string;
  /** Gross paid that month: earnings after loss of pay, with overtime. */
  grossPaise: number;
  /** What reached the bank: gross less every deduction, plus reimbursements. */
  netPaise: number;
  /** Loss-of-pay days (halves count). */
  unpaidDays: number;
  status: 'released' | 'estimate';
  /** The released payslip, to open it; null for the estimate. */
  payslipId: string | null;
}

export interface EarningsNotSetUp {
  reason: 'no_salary_structure' | 'statutory_not_set_up' | 'structure_not_set_up' | 'pay_period_not_set_up';
  message: string;
}

type StoredSlip = Payslip & { _id: ObjectId };

/** The person's released payslips in this company, one per month (the newest run's). */
async function releasedSlips(org: string, userId: string): Promise<StoredSlip[]> {
  const all = (await payslips().find({ org, userId }).sort({ period: 1, createdAt: -1 }).toArray()) as StoredSlip[];
  const runIds = [...new Set(all.map((s) => s.runId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const runs = runIds.length
    ? await payrollRuns().find({ _id: { $in: runIds }, status: { $in: RELEASED } }, { projection: { _id: 1 } }).toArray()
    : [];
  const released = new Set(runs.map((r) => r._id.toHexString()));
  const byPeriod = new Map<string, StoredSlip>();
  for (const slip of all) if (released.has(slip.runId) && !byPeriod.has(slip.period)) byPeriod.set(slip.period, slip);
  return [...byPeriod.values()];
}

/** A month's money, split the way the Earned card shows it. */
interface MonthMoney {
  grossPaise: number;
  taxPaise: number;
  pfPtPaise: number;
  otherDeductionsPaise: number;
  reimbursementsPaise: number;
  netPaise: number;
}

function slipMoney(slip: Payslip): MonthMoney {
  let tax = 0;
  let pfPt = 0;
  let other = 0;
  // Hidden lines are still taken off: they count, as in every payslip total.
  for (const d of slip.deductions) {
    if (d.key === 'income_tax') tax += d.amountPaise;
    else if (PF_PT.has(d.key)) pfPt += d.amountPaise;
    else other += d.amountPaise;
  }
  return {
    grossPaise: slip.grossPaise,
    taxPaise: tax,
    pfPtPaise: pfPt,
    otherDeductionsPaise: other,
    reimbursementsPaise: slip.reimbursementsPaise,
    netPaise: slip.netPayablePaise,
  };
}

/** Home's estimate for this pay period, as earnings (or why there is none). */
async function currentEstimate(userId: string, now: Date) {
  const home = await myPayrollHome(userId, undefined, now);
  if (home.appEnabled !== true) return { period: home.period, month: null, notSetUp: null };
  const salary = home.salary;
  if (!salary) {
    const notSetUp: EarningsNotSetUp | null = home.salaryNotSetUp
      ? { reason: home.salaryNotSetUp.reason, message: home.salaryNotSetUp.message }
      : null;
    return { period: home.period, month: null, notSetUp };
  }
  // A released payslip for the month is already among the released months.
  if (salary.status !== 'estimate') return { period: home.period, month: null, notSetUp: null };
  let tax = 0;
  let pfPt = 0;
  let other = 0;
  for (const d of salary.deductions) {
    if (d.key === 'income_tax') tax += d.amountPaise;
    else if (PF_PT.has(d.key)) pfPt += d.amountPaise;
    else other += d.amountPaise;
  }
  const money: MonthMoney = {
    grossPaise: salary.grossPaise - salary.lopPaise + salary.overtimePaise,
    taxPaise: tax,
    pfPtPaise: pfPt,
    otherDeductionsPaise: other,
    reimbursementsPaise: salary.reimbursementsPaise,
    netPaise: salary.takeHomePaise,
  };
  return { period: salary.period, month: { money, unpaidDays: salary.lopDays }, notSetUp: null };
}

/** The structure's yearly components as it pays in `period`, or why they can't be shown. */
async function structureComponents(org: string, userId: string, period: string): Promise<{ components: EarningsComponent[]; notSetUp: EarningsNotSetUp | null }> {
  const structure = await salaryStructures().findOne({ org, userId });
  if (!structure?.salaryTemplateCode) {
    return { components: [], notSetUp: { reason: 'no_salary_structure', message: askHr('Your salary structure is not set up yet') } };
  }
  const splits = await flexibleSplits().find({ org, userId }).toArray();
  try {
    const { computed } = await computeStructureFor(org, userId, {
      ...structure,
      componentValues: { ...(structure.componentValues ?? {}), ...splitAmountsFor(splits, period) },
    }, undefined, period);
    const components = [...computed.earnings, ...computed.reimbursements]
      .filter((line) => line.annualPaise > 0)
      .map((line) => ({ code: line.code, name: line.payslipName || line.name, annualPaise: line.annualPaise }));
    return { components, notSetUp: null };
  } catch (error) {
    if (error instanceof PayrollConfigError && error.statusCode === 409) {
      const fy = fyOf(period).fy;
      return {
        components: [],
        notSetUp: {
          reason: 'statutory_not_set_up',
          message: `Your yearly salary can't be worked out yet: the statutory settings (PF, ESI, professional tax) for FY ${fy} are not set up. Ask HR.`,
        },
      };
    }
    if (error instanceof SalaryStructureError && (error.statusCode === 409 || error.statusCode === 400)) {
      return { components: [], notSetUp: { reason: 'structure_not_set_up', message: askHr(error.message) } };
    }
    throw error;
  }
}

/** What a year's payslips were entitled to, component by component (before loss of pay). */
function payslipComponents(slips: Payslip[]): EarningsComponent[] {
  const byCode = new Map<string, EarningsComponent>();
  const add = (code: string, name: string, paise: number) => {
    const line = byCode.get(code);
    if (line) {
      line.annualPaise += paise;
      line.name = name; // the newest month's name (slips come oldest first)
    } else byCode.set(code, { code, name, annualPaise: paise });
  };
  for (const slip of slips) {
    for (const e of slip.earnings) add(e.code, e.name, e.fullPaise);
    for (const r of slip.reimbursementLines ?? []) add(r.code, r.name, r.amountPaise);
  }
  return [...byCode.values()].filter((c) => c.annualPaise > 0);
}

/**
 * The signed-in person's earnings for a financial year ("2026-27"; default
 * the latest year they have pay in): the years they can switch between, the
 * year's gross so far with its tax, PF and PT and take-home, the yearly
 * salary, and each paid month (the current one an estimate).
 */
export async function myEarnings(userId: string, fyRaw: unknown, now = new Date()) {
  const { org } = await meOf(userId);
  const asked = fyRaw === undefined || fyRaw === null || fyRaw === '' ? null : parseFyParam(fyRaw, now);
  const [slips, estimate] = await Promise.all([releasedSlips(org, userId), currentEstimate(userId, now)]);
  // The year of the pay period Home is on (a company paying 26th to 25th is in April's from 26 March).
  const currentFy = fyOf(estimate.period).fy;
  if (asked && asked > currentFy) throw new EmployeePayrollError(400, 'That financial year has not started yet');

  const estimateFy = estimate.month ? fyOf(estimate.period).fy : null;
  const fys = [...new Set([...slips.map((s) => fyOf(s.period).fy), ...(estimateFy ? [estimateFy] : [])])].sort().reverse();
  const fy = asked ?? fys[0] ?? currentFy;

  const yearSlips = slips.filter((s) => fyOf(s.period).fy === fy);
  const rows: { period: string; money: MonthMoney; unpaidDays: number; status: EarningsMonth['status']; payslipId: string | null }[] = yearSlips.map((s) => ({
    period: s.period,
    money: slipMoney(s),
    unpaidDays: s.inputs?.lopDays ?? 0,
    status: 'released',
    payslipId: s._id.toHexString(),
  }));
  if (estimate.month && estimateFy === fy && !rows.some((r) => r.period === estimate.period)) {
    rows.push({ period: estimate.period, money: estimate.month.money, unpaidDays: estimate.month.unpaidDays, status: 'estimate', payslipId: null });
  }
  rows.sort((a, b) => a.period.localeCompare(b.period));

  const sum = (key: keyof MonthMoney) => rows.reduce((total, r) => total + r.money[key], 0);
  const span = rows.length === 0 ? null
    : rows.length === 1 ? SHORT[monthOf(rows[0].period) - 1]
      : `${SHORT[monthOf(rows[0].period) - 1]}–${SHORT[monthOf(rows[rows.length - 1].period) - 1]}`;

  // The yearly salary: the structure for the current year, the payslips for an earlier one.
  const isCurrent = fy === currentFy;
  const structurePeriod = isCurrent ? estimate.period : null;
  const yearly = structurePeriod
    ? await structureComponents(org, userId, structurePeriod)
    : { components: payslipComponents(yearSlips), notSetUp: null };

  return {
    fy,
    /** The year it is now (its gross is "so far"). */
    current: isCurrent,
    /** The years with pay to switch between, newest first. */
    fys,
    span,
    grossPaise: sum('grossPaise'),
    taxPaise: sum('taxPaise'),
    pfPtPaise: sum('pfPtPaise'),
    otherDeductionsPaise: sum('otherDeductionsPaise'),
    reimbursementsPaise: sum('reimbursementsPaise'),
    takeHomePaise: sum('netPaise'),
    componentsSource: structurePeriod ? ('structure' as const) : ('payslips' as const),
    components: yearly.components,
    annualTotalPaise: yearly.components.reduce((total, c) => total + c.annualPaise, 0),
    componentsNotSetUp: yearly.notSetUp,
    /** Set when this pay period's estimate can't be worked out (the month is then not listed). */
    estimateNotSetUp: isCurrent ? estimate.notSetUp : null,
    months: rows.map((r): EarningsMonth => ({
      period: r.period,
      label: monthLabel(r.period),
      grossPaise: r.money.grossPaise,
      netPaise: r.money.netPaise,
      unpaidDays: r.unpaidDays,
      status: r.status,
      payslipId: r.payslipId,
    })),
  };
}
