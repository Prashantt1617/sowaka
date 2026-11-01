/**
 * Aggregates the approved upstream-module data a payroll run needs for one
 * employee in one period (PRD §5.7 / INT-1,2,4). These modules already exist in
 * Sowaka Connect; payroll only reads their approved output — it does not build
 * or re-approve them.
 *
 * Note on Lates: the PRD lists a Lates module as an upstream input, but no such
 * module exists in the codebase, so it is intentionally dropped from v1.
 */

import { leaves, overtimeRequests, payrollPeriods, reimbursementClaims } from '../config/db';
import { DEFAULT_PAYROLL_PERIOD } from '../models/payrollPeriod.model';

export interface PeriodRange {
  year: number;
  month: number; // 1-based
  start: Date;
  end: Date;
  daysInMonth: number;
  /** The days the run pays for, 'YYYY-MM-DD': the calendar month unless the company's pay cycle says otherwise. */
  from: string;
  to: string;
  /** The days the month's salary is spread over: paid days = base days − loss of pay. */
  baseDays: number;
}

export class PayrollInputsError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PayrollInputsError';
  }
}

/** Parse and validate a 'YYYY-MM' period into a UTC date range. */
export function parsePeriod(period: string): PeriodRange {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new PayrollInputsError(400, "period must be in 'YYYY-MM' format");
  }
  const [year, month] = period.split('-').map(Number);
  if (month < 1 || month > 12) throw new PayrollInputsError(400, 'period month must be 01-12');
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day of month
  const daysInMonth = end.getUTCDate();
  return { year, month, start, end, daysInMonth, from: isoDay(start), to: isoDay(end), baseDays: daysInMonth };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && isoDay(new Date(`${value}T00:00:00Z`)) === value;

/**
 * A period as the company pays it (see PayrollPeriodSetting): the calendar
 * month, else the cycle from the company's start day (26: October is
 * 26 September – 25 October), with one month's own dates or base days on top.
 * A setting that does not make sense is refused, not guessed around.
 */
export async function payrollPeriodRange(org: string, period: string): Promise<PeriodRange> {
  const month = parsePeriod(period);
  const rows = await payrollPeriods().find({ org, period: { $in: [DEFAULT_PAYROLL_PERIOD, period] } }).toArray();
  const cycle = rows.find((row) => row.period === DEFAULT_PAYROLL_PERIOD);
  const own = rows.find((row) => row.period === period);
  if (!cycle && !own) return month;
  const startDay = cycle?.startDay ?? 1;
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new PayrollInputsError(409, `The pay cycle's start day must be 1 to 28 (it is ${startDay})`);
  }
  let start = startDay === 1 ? month.start : new Date(Date.UTC(month.year, month.month - 2, startDay));
  let end = startDay === 1 ? month.end : new Date(Date.UTC(month.year, month.month - 1, startDay - 1));
  if (own?.from !== undefined || own?.to !== undefined) {
    if ((own.from !== undefined && !isDay(own.from)) || (own.to !== undefined && !isDay(own.to))) {
      throw new PayrollInputsError(409, `The pay dates set for ${period} must be YYYY-MM-DD`);
    }
    if (own.from) start = new Date(`${own.from}T00:00:00Z`);
    if (own.to) end = new Date(`${own.to}T00:00:00Z`);
  }
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days < 1 || days > 62) {
    throw new PayrollInputsError(409, `The pay dates set for ${period} run ${isoDay(start)} to ${isoDay(end)}: that is not a pay period`);
  }
  const baseDays = own?.baseDays ?? days;
  if (!Number.isInteger(baseDays) || baseDays < 1 || baseDays > 62) {
    throw new PayrollInputsError(409, `The base days set for ${period} must be a whole number of days (it is ${baseDays})`);
  }
  return { ...month, start, end, from: isoDay(start), to: isoDay(end), baseDays };
}

/** The period whose pay dates hold `day` ('YYYY-MM-DD'): that month or the next, by the company's cycle. */
export async function payrollPeriodHolding(org: string, day: string): Promise<PeriodRange | undefined> {
  const [year, month] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  const before = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  for (const period of [day.slice(0, 7), next, before]) {
    const range = await payrollPeriodRange(org, period);
    if (range.from <= day && day <= range.to) return range;
  }
  return undefined;
}

/**
 * Base days for the period: the days it pays for (the month's 28 to 31, or
 * the cycle's), unless the company set the month's own. Week offs, holidays
 * and approved leave are paid, so the salary is spread over all of them and
 * only loss of pay comes off: paid days = base days − loss-of-pay days.
 */
export async function computeWorkingDays(_org: string | undefined, range: PeriodRange): Promise<number> {
  return range.baseDays;
}

export interface EmployeePeriodInputs {
  approvedLeaveDays: number;
  approvedOtHours: number;
  reimbursementsPaise: number;
  reimbursementClaimIds: string[];
}

/** Per-employee approved Leave / Overtime / Reimbursement data for the period. */
export async function getEmployeePeriodInputs(
  userId: string,
  range: PeriodRange,
  claims: {
    /** Claim categories that are bills for a salary component: never paid as expenses. */
    billCategories?: string[];
    /** Claims already on another run (not rejected): never paid twice. */
    reservedClaimIds?: Set<string>;
  } = {},
): Promise<EmployeePeriodInputs> {
  const [approvedLeaveDays, approvedOtHours, reimb] = await Promise.all([
    countApprovedLeaveDays(userId, range),
    sumApprovedOtHours(userId, range),
    collectApprovedReimbursements(userId, range, claims.billCategories ?? [], claims.reservedClaimIds ?? new Set()),
  ]);
  return {
    approvedLeaveDays,
    approvedOtHours,
    reimbursementsPaise: reimb.paise,
    reimbursementClaimIds: reimb.ids,
  };
}

/**
 * Whether any of these people has approved leave touching the period — one
 * cheap read, so a run where every template pays all days skips the calendar
 * unless there is leave in it that could be leave without pay.
 */
export async function anyApprovedLeave(userIds: string[], range: PeriodRange): Promise<boolean> {
  if (userIds.length === 0) return false;
  const found = await leaves().countDocuments(
    { userId: { $in: userIds }, status: 'approved', startDate: { $lte: range.end }, endDate: { $gte: range.start } },
    { limit: 1 },
  );
  return found > 0;
}

// Approved leave days overlapping the period (calendar days, clipped). Informational:
// LOP defaults to 0 because the Leave module has no paid/unpaid distinction — the
// run takes an explicit lopDays override instead. See INT-1 follow-up.
async function countApprovedLeaveDays(userId: string, range: PeriodRange): Promise<number> {
  const rows = await leaves()
    .find({ userId, status: 'approved', startDate: { $lte: range.end }, endDate: { $gte: range.start } })
    .toArray();
  let days = 0;
  for (const row of rows) {
    const from = row.startDate > range.start ? row.startDate : range.start;
    const to = row.endDate < range.end ? row.endDate : range.end;
    const spanMs = to.getTime() - from.getTime();
    if (spanMs < 0) continue;
    days += Math.floor(spanMs / 86_400_000) + 1; // inclusive of both endpoints
  }
  return days;
}

async function sumApprovedOtHours(userId: string, range: PeriodRange): Promise<number> {
  const rows = await overtimeRequests()
    .find({ userId, status: 'approved', workDate: { $gte: range.start, $lte: range.end } })
    .toArray();
  return rows.reduce((sum, row) => sum + (row.hours ?? 0), 0);
}

async function collectApprovedReimbursements(
  userId: string,
  range: PeriodRange,
  billCategories: string[],
  reserved: Set<string>,
): Promise<{ paise: number; ids: string[] }> {
  // Every approved claim not yet paid, for this month or the one before (a
  // claim approved late for last month's expense is paid in the next run), and
  // not already on another run. Submitting a run moves its claims to paid.
  // Older approved claims are left for HR to settle by hand.
  const rows = await reimbursementClaims()
    // A claim that is a bill for a salary component (Fuel, Internet) is not paid
    // again: the component already was; the bill only makes it tax-free.
    .find({ userId, status: 'approved', expenseDate: { $gte: new Date(Date.UTC(range.year, range.month - 2, 1)), $lte: range.end }, ...(billCategories.length ? { category: { $nin: billCategories } } : {}) })
    .toArray();
  let paise = 0;
  const ids: string[] = [];
  for (const row of rows) {
    if (row._id && reserved.has(row._id.toHexString())) continue;
    paise += Math.round((row.amount ?? 0) * 100); // stored in rupees -> paise
    if (row._id) ids.push(row._id.toHexString());
  }
  return { paise, ids };
}
