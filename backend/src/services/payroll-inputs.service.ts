/**
 * Aggregates the approved upstream-module data a payroll run needs for one
 * employee in one period (PRD §5.7 / INT-1,2,4). These modules already exist in
 * Sowaka Connect; payroll only reads their approved output — it does not build
 * or re-approve them.
 *
 * Note on Lates: the PRD lists a Lates module as an upstream input, but no such
 * module exists in the codebase, so it is intentionally dropped from v1.
 */

import { leaves, overtimeRequests, reimbursementClaims } from '../config/db';
import { getCompanyConfig, getOrgHolidayDates, isWeekoffDay } from './company-settings.service';

export interface PeriodRange {
  year: number;
  month: number; // 1-based
  start: Date;
  end: Date;
  daysInMonth: number;
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
  return { year, month, start, end, daysInMonth: end.getUTCDate() };
}

/**
 * Org-level working days in the period: calendar days minus configured week-offs
 * minus org holidays. (v1 uses org-wide holidays; per-state holiday variation is
 * a later refinement.)
 */
export async function computeWorkingDays(org: string | undefined, range: PeriodRange): Promise<number> {
  const { weekoffDays } = await getCompanyConfig(org);
  const holidayDates = await getOrgHolidayDates(org);
  let workingDays = 0;
  for (let day = 1; day <= range.daysInMonth; day++) {
    const date = new Date(Date.UTC(range.year, range.month - 1, day));
    const iso = date.toISOString().slice(0, 10);
    if (isWeekoffDay(date, weekoffDays)) continue;
    if (holidayDates.has(iso)) continue;
    workingDays++;
  }
  return workingDays;
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
): Promise<EmployeePeriodInputs> {
  const [approvedLeaveDays, approvedOtHours, reimb] = await Promise.all([
    countApprovedLeaveDays(userId, range),
    sumApprovedOtHours(userId, range),
    collectApprovedReimbursements(userId, range),
  ]);
  return {
    approvedLeaveDays,
    approvedOtHours,
    reimbursementsPaise: reimb.paise,
    reimbursementClaimIds: reimb.ids,
  };
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
): Promise<{ paise: number; ids: string[] }> {
  const rows = await reimbursementClaims()
    .find({ userId, status: 'approved', expenseDate: { $gte: range.start, $lte: range.end } })
    .toArray();
  let paise = 0;
  const ids: string[] = [];
  for (const row of rows) {
    paise += Math.round((row.amount ?? 0) * 100); // stored in rupees -> paise
    if (row._id) ids.push(row._id.toHexString());
  }
  return { paise, ids };
}
