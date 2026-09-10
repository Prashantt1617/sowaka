import { ObjectId } from 'mongodb';
import { attendanceRecords, leaves, overtimeRequests, users } from '../config/db';
import { Leave, LeaveStatus } from '../models/leave.model';
import { User } from '../models/user.model';
import { orgUsers } from './admin-scope';
import { notifyLeaveDecided, notifyLeaveSubmitted } from './request-notifications.service';
import { holidayDatesForUser } from './holiday.service';
import {
  approvalRulesFor, fullDayHoursFor, hrMayDecide, isWeekOffDay, leaveTypeRulesFor,
  managerMayDecide, weekOffGridFor,
} from './shift.service';
import { COMP_OFF_CREDIT, LeaveTypeKey, LeaveTypeRule, processYearEnd } from '../models/shift.model';
import { carriedFromRun as carriedFromYearEndRun } from './leave-year-end.service';

const maxLeaveDays = 30;
const leaveTypes = new Set<Leave['type']>(['sick', 'casual', 'earned', 'comp_off']);
const decisionStatuses = new Set<LeaveStatus>(['approved', 'declined']);

export interface LeaveView {
  id: string;
  userId: string;
  employee: {
    name: string;
    email: string;
    department?: string;
    designation?: string;
  };
  type: Leave['type'];
  startDate: string;
  endDate: string;
  days: number;
  halfDay: boolean;
  reason: string;
  status: LeaveStatus;
  managerNote?: string;
  createdAt: string;
  decidedAt?: string;
  decidedByRole?: 'manager' | 'admin';
}

export async function applyForLeave(
  userId: string,
  input: {
    type: string;
    startDate: string;
    endDate: string;
    reason: string;
    halfDay?: boolean;
  },
): Promise<LeaveView> {
  const employee = await users().findOne({ userId });
  if (!employee) {
    throw new LeaveError(404, 'Employee not found');
  }
  if (!employee.managerUserId) {
    throw new LeaveError(409, 'A manager must be assigned before applying for leave');
  }

  const manager = await users().findOne({ userId: employee.managerUserId });
  if (
    !manager ||
    manager.lifecycleStatus === 'offboarded' ||
    manager.lifecycleStatus === 'terminated'
  ) {
    throw new LeaveError(409, 'The assigned manager is not active');
  }

  const type = input.type.trim().toLowerCase() as Leave['type'];
  if (!leaveTypes.has(type)) {
    throw new LeaveError(400, `Leave type must be one of: ${[...leaveTypes].join(', ')}`);
  }

  const startDate = parseDateOnly(input.startDate, 'startDate');
  const endDate = parseDateOnly(input.endDate, 'endDate');
  if (endDate < startDate) {
    throw new LeaveError(400, 'End date cannot be before start date');
  }

  const singleDay = startDate.getTime() === endDate.getTime();
  const halfDay = input.halfDay === true;
  if (halfDay && !singleDay) {
    throw new LeaveError(400, 'A half day can only be applied for a single date');
  }

  // The application window is per leave type: sick leave is usually applied for
  // after the fact, earned leave is planned well ahead.
  const rules = await leaveTypeRulesFor(employee.userId);
  const rule = rules.find((item) => item.key === type);
  // A type this org does not run at all.
  if (!rule) {
    throw new LeaveError(400, 'That leave type is not available in this organisation');
  }
  {
    const todayOnly = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const aheadDays = Math.floor((startDate.getTime() - todayOnly.getTime()) / 86_400_000);
    if (aheadDays > rule.advanceDays) {
      throw new LeaveError(
        400,
        `${rule.name} can be applied for at most ${rule.advanceDays} days ahead`,
      );
    }
    if (aheadDays < 0) {
      if (!rule.allowBackdated) {
        throw new LeaveError(400, `${rule.name} cannot be applied for a past date`);
      }
      if (-aheadDays > rule.backdatedDays) {
        throw new LeaveError(
          400,
          `${rule.name} can be backdated by at most ${rule.backdatedDays} days`,
        );
      }
    }
  }

  // A range may span week-offs and holidays, but neither is charged as leave.
  // Resolved through the shared helper so leave counts the same holidays the
  // employee's calendar shows: their work location's, plus all-locations days.
  const holidayDates = await holidayDatesForUser(employee, { from: startDate, to: endDate });
  // Week-offs come from the shift policy, the same grid the app greys out on
  // the calendar — so what is charged matches what the employee was shown.
  const weeklyOff = await weekOffGridFor(employee.userId);
  const days = halfDay
    ? 0.5
    : countLeaveDays(startDate, endDate, holidayDates, weeklyOff);
  if (days === 0) {
    throw new LeaveError(400, 'These dates are all week-offs or company holidays');
  }
  if (days > maxLeaveDays) {
    throw new LeaveError(400, `Leave cannot exceed ${maxLeaveDays} days`);
  }

  // You cannot spend leave you do not have. Checked against the balance for the
  // year the leave starts in, counting what is already approved *and* what is
  // still pending — two pending requests that each fit the balance must not be
  // able to overdraw it together.
  // A range that crosses new year is charged to both years, so each one is
  // checked against its own balance rather than the start year's alone.
  const years = [...new Set([startDate.getUTCFullYear(), endDate.getUTCFullYear()])];
  const pending = await leaves().find({ userId, type, status: 'pending' }).toArray();
  for (const year of years) {
    const balance = await getMyLeaveBalance(userId, year);
    const forType = balance[type] as { total: number; used: number } | undefined;
    if (!forType) continue;
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const daysInYear = years.length === 1
      ? days
      : halfDay
        ? 0.5
        : countLeaveDays(
            startDate < yearStart ? yearStart : startDate,
            endDate > yearEnd ? yearEnd : endDate,
            holidayDates,
            weeklyOff,
          );
    if (daysInYear <= 0) continue;
    const held = pending
      .filter((row) => row.startDate <= yearEnd && row.endDate >= yearStart)
      .reduce((total, row) => total + (row.days ?? 0), 0);
    const available = Math.max(0, forType.total - forType.used - held);
    if (daysInYear > available) {
      throw new LeaveError(
        400,
        held > 0
          ? `Only ${available} day(s) of ${type} leave left in ${year} — ${forType.total - forType.used} in balance, ${held} already requested`
          : `Only ${available} day(s) of ${type} leave left in ${year}`,
      );
    }
  }

  const reason = input.reason.trim();
  if (reason.length > 500) {
    throw new LeaveError(400, 'Reason cannot exceed 500 characters');
  }

  const overlap = await leaves().findOne({
    userId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  });
  if (overlap) {
    throw new LeaveError(409, 'A pending or approved leave already overlaps these dates');
  }

  const createdAt = Date.now();
  const result = await leaves().insertOne({
    userId,
    type,
    startDate,
    endDate,
    days,
    halfDay: halfDay || undefined,
    reason,
    status: 'pending',
    createdAt,
    updatedAt: new Date(createdAt),
  });

  await notifyLeaveSubmitted({
    employeeUserId: employee.userId,
    type,
    startDate,
    endDate,
    days,
    reason,
  });

  return toLeaveView(
    {
      _id: result.insertedId,
      userId,
      type,
      startDate,
      endDate,
      days,
      halfDay,
      reason,
      status: 'pending',
      createdAt,
    },
    employee,
  );
}

export async function getMyLeaves(userId: string): Promise<LeaveView[]> {
  const employee = await users().findOne({ userId });
  if (!employee) {
    throw new LeaveError(404, 'Employee not found');
  }

  const documents = await leaves().find({ userId }).sort({ createdAt: -1 }).toArray();
  return documents.map((leave) => toLeaveView(leave, employee));
}

export async function getMyLeaveBalance(userId: string, year = new Date().getUTCFullYear()) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new LeaveError(404, 'Employee not found');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new LeaveError(400, 'Invalid balance year');
  }
  // Entitlements come from the leave types HR configured under Shifts ›
  // Policies › Leaves, never from a table in here.
  const rules = await leaveTypeRulesFor(employee.userId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const approved = await leaves()
    .find({
      userId,
      status: 'approved',
      startDate: { $lte: yearEnd },
      endDate: { $gte: yearStart },
    })
    .toArray();
  const used: Record<Leave['type'], number> = { sick: 0, casual: 0, earned: 0, comp_off: 0 };
  for (const leave of approved) {
    const withinYear = leave.startDate >= yearStart && leave.endDate <= yearEnd;
    if (leave.days != null && withinYear) {
      // The count agreed at apply time — holidays already excluded.
      used[leave.type] += leave.days;
      continue;
    }
    // Legacy rows, and leaves straddling a year boundary, fall back to the
    // clamped calendar span.
    const start = leave.startDate < yearStart ? yearStart : leave.startDate;
    const end = leave.endDate > yearEnd ? yearEnd : leave.endDate;
    used[leave.type] += inclusiveDays(start, end);
  }
  // Comp-off is not accrued: the balance is what approved overtime earned.
  const compOffEarned = await compOffCreditedIn(userId, yearStart, yearEnd);
  const openingFor = await openingBalances(userId, employee.org, year, rules, compOffEarned);
  const entitlement = (key: Leave['type']) => {
    const rule = rules.find((item) => item.key === key);
    const accrued = key === 'comp_off' ? compOffEarned : (rule?.perMonth ?? 0) * 12;
    return round(accrued + (openingFor[key] ?? 0));
  };

  return {
    year,
    sick: balanceItem(entitlement('sick'), used.sick),
    casual: balanceItem(entitlement('casual'), used.casual),
    earned: balanceItem(entitlement('earned'), used.earned),
    comp_off: balanceItem(entitlement('comp_off'), used.comp_off),
  };
}

/**
 * Days of comp-off earned by approved overtime in a window.
 *
 * An overtime record stores the hours worked, so which of the two durations it
 * was is decided against the org's own full-day threshold — the same figure the
 * attendance calendar grades a day by, never a fixed eight hours.
 */
async function compOffCreditedIn(userId: string, from: Date, to: Date): Promise<number> {
  const [approved, fullDayHours] = await Promise.all([
    overtimeRequests().find({ userId, status: 'approved', workDate: { $gte: from, $lte: to } }).toArray(),
    fullDayHoursFor(userId),
  ]);
  return round(
    approved.reduce(
      (total, request) =>
        total + COMP_OFF_CREDIT[request.hours >= fullDayHours ? 'full_day' : 'half_day'],
      0,
    ),
  );
}

/**
 * What last year's closing balance carries into this one, per the carry-forward
 * limit HR set.
 *
 * Only from a year the system actually tracked. Without that guard an org
 * adopting Sowaka mid-life hands every employee the full carry-forward on day
 * one: with no records for last year, "accrued minus used" reads as a whole
 * year accrued and nothing taken. A year counts as tracked for an employee once
 * there is any leave or attendance record of theirs inside it.
 *
 * Looks back exactly one year: going further would need every prior year's
 * usage, and an opening balance older than that cannot be reconstructed.
 */
/**
 * The opening balance for each type.
 *
 * If a year-end run has closed last year, that run's `carried` is the answer —
 * a recorded fact that cannot move because someone edited the policy since.
 * Only when no run exists does this fall back to deriving it.
 */
async function openingBalances(
  userId: string,
  org: string | undefined,
  year: number,
  rules: LeaveTypeRule[],
  compOffThisYear: number,
): Promise<Partial<Record<Leave['type'], number>>> {
  const recorded: Partial<Record<Leave['type'], number>> = {};
  const missing: LeaveTypeRule[] = [];
  for (const rule of rules) {
    const carried = await carriedFromYearEndRun(userId, rule.key as LeaveTypeKey, year);
    if (carried != null) recorded[rule.key as Leave['type']] = carried;
    else missing.push(rule);
  }
  if (missing.length === 0) return recorded;
  // Per type, not all-or-nothing: a type whose year-end has been recorded uses
  // that figure, and one that has not is still derived. Short-circuiting on
  // the first recorded type left every other type opening at zero — a
  // financial-year type looked emptied the moment a calendar-year one closed.
  const derived = await carriedForwardInto(userId, org, year, missing, compOffThisYear);
  return { ...derived, ...recorded };
}

async function carriedForwardInto(
  userId: string,
  org: string | undefined,
  year: number,
  rules: LeaveTypeRule[],
  _compOffThisYear: number,
): Promise<Partial<Record<Leave['type'], number>>> {
  void _compOffThisYear;
  const priorStart = new Date(Date.UTC(year - 1, 0, 1));
  const priorEnd = new Date(Date.UTC(year - 1, 11, 31));
  if (!(await yearWasTracked(userId, priorStart, priorEnd))) return {};
  const prior = await leaves()
    .find({ userId, status: 'approved', startDate: { $lte: priorEnd }, endDate: { $gte: priorStart } })
    .toArray();
  const usedLastYear: Record<string, number> = {};
  for (const leave of prior) {
    const start = leave.startDate < priorStart ? priorStart : leave.startDate;
    const end = leave.endDate > priorEnd ? priorEnd : leave.endDate;
    const days = leave.days != null && leave.startDate >= priorStart && leave.endDate <= priorEnd
      ? leave.days
      : inclusiveDays(start, end);
    usedLastYear[leave.type] = (usedLastYear[leave.type] ?? 0) + days;
  }
  const priorCompOff = await compOffCreditedIn(userId, priorStart, priorEnd);

  const opening: Partial<Record<Leave['type'], number>> = {};
  for (const rule of rules) {
    const accrued = rule.key === 'comp_off' ? priorCompOff : rule.perMonth * 12;
    const closing = accrued - (usedLastYear[rule.key] ?? 0);
    opening[rule.key as Leave['type']] = round(processYearEnd(closing, rule).carried);
  }
  return opening;
}

/**
 * Whether the system holds anything for this employee in a given year. A year
 * with no leave and no attendance was not being tracked, so nothing can be
 * carried out of it.
 */
async function yearWasTracked(userId: string, from: Date, to: Date): Promise<boolean> {
  const [leaveCount, attendanceCount] = await Promise.all([
    leaves().countDocuments({ userId, startDate: { $lte: to }, endDate: { $gte: from } }, { limit: 1 }),
    attendanceRecords().countDocuments(
      { userId, workDate: { $gte: from.toISOString().slice(0, 10), $lte: to.toISOString().slice(0, 10) } },
      { limit: 1 },
    ),
  ]);
  return leaveCount > 0 || attendanceCount > 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getManagerLeaveInbox(managerUserId: string): Promise<LeaveView[]> {
  const reports = await users()
    .find({ managerUserId })
    .project<Pick<User, 'userId' | 'name' | 'email' | 'department' | 'designation'>>({
      userId: 1,
      name: 1,
      email: 1,
      department: 1,
      designation: 1,
    })
    .toArray();

  if (reports.length === 0) {
    return [];
  }

  const employeeById = new Map(reports.map((employee) => [employee.userId, employee]));
  const documents = await leaves()
    .find({ userId: { $in: reports.map((employee) => employee.userId) } })
    .sort({ status: -1, createdAt: -1 })
    .toArray();

  return documents.map((leave) => {
    const employee = employeeById.get(leave.userId);
    if (!employee) {
      throw new LeaveError(409, 'Leave has an invalid employee reference');
    }
    return toLeaveView(leave, employee as User);
  });
}

export async function decideLeave(
  managerUserId: string,
  leaveIdInput: string,
  input: { decision: string; managerNote?: string },
): Promise<LeaveView> {
  if (!ObjectId.isValid(leaveIdInput)) {
    throw new LeaveError(400, 'Invalid leave ID');
  }

  const decision = input.decision.trim().toLowerCase() as LeaveStatus;
  if (!decisionStatuses.has(decision)) {
    throw new LeaveError(400, 'Decision must be approved or declined');
  }

  const leaveId = new ObjectId(leaveIdInput);
  const leave = await leaves().findOne({ _id: leaveId });
  if (!leave) {
    throw new LeaveError(404, 'Leave request not found');
  }

  const employee = await users().findOne({ userId: leave.userId });
  // Who signs off is the org's call, from Policies › Leaves.
  const rules = await approvalRulesFor(leave.userId, 'leave');
  if (!managerMayDecide(rules.approver)) {
    throw new LeaveError(403, `Leave is approved by ${rules.approver}, not by the reporting manager`);
  }
  if (!employee || employee.managerUserId !== managerUserId) {
    throw new LeaveError(403, 'Only the employee’s current manager can decide this leave');
  }
  if (leave.status !== 'pending') {
    throw new LeaveError(409, 'Leave request has already been decided');
  }

  const managerNote = input.managerNote?.trim();
  if (decision === 'declined' && !managerNote) {
    throw new LeaveError(400, 'A decline reason is required');
  }
  if (managerNote && managerNote.length > 500) {
    throw new LeaveError(400, 'Manager note cannot exceed 500 characters');
  }

  const decidedAt = new Date();
  const updateFields: Partial<Leave> = {
    status: decision,
    decidedByUserId: managerUserId,
    decidedByRole: 'manager',
    decidedAt,
    updatedAt: decidedAt,
  };
  if (managerNote) updateFields.managerNote = managerNote;
  const updated = await leaves().findOneAndUpdate(
    { _id: leaveId, status: 'pending' },
    {
      $set: updateFields,
    },
    { returnDocument: 'after' },
  );
  if (!updated) {
    throw new LeaveError(409, 'Leave request has already been decided');
  }

  await notifyLeaveDecided({
    employeeUserId: employee.userId,
    type: leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    approved: decision === 'approved',
    comment: input.managerNote?.trim() ?? '',
  });

  return toLeaveView(updated, employee);
}

/** Org-wide list of every leave, for the HR dashboard. */
export async function listAllLeavesForAdmin(adminUserId: string): Promise<LeaveView[]> {
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  const documents = await leaves()
    .find({ userId: { $in: employees.map((e) => e.userId) } })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  return documents.flatMap((leave) => {
    const employee = employeeById.get(leave.userId);
    return employee ? [toLeaveView(leave, employee)] : [];
  });
}

/**
 * Dashboard override: a dashboard user decides any pending leave, regardless of
 * reporting line. Records the decision as made by 'admin'. A user cannot override
 * their own request (rule 8).
 */
export async function adminDecideLeave(
  adminUserId: string,
  leaveIdInput: string,
  input: { decision: string; managerNote?: string },
): Promise<LeaveView> {
  if (!ObjectId.isValid(leaveIdInput)) throw new LeaveError(400, 'Invalid leave ID');
  const decision = input.decision.trim().toLowerCase() as LeaveStatus;
  if (!decisionStatuses.has(decision)) {
    throw new LeaveError(400, 'Decision must be approved or declined');
  }
  const leaveId = new ObjectId(leaveIdInput);
  const leave = await leaves().findOne({ _id: leaveId });
  if (!leave) throw new LeaveError(404, 'Leave request not found');
  if (leave.userId === adminUserId) {
    throw new LeaveError(403, 'You cannot override your own request');
  }
  if (leave.status !== 'pending') {
    throw new LeaveError(409, 'Leave request has already been decided');
  }
  const employee = await users().findOne({ userId: leave.userId });
  if (!employee) throw new LeaveError(409, 'Leave has an invalid employee reference');
  // HR deciding is only an override when someone else is the named approver.
  const rules = await approvalRulesFor(leave.userId, 'leave');
  if (!hrMayDecide(rules.approver, rules.hrOverride)) {
    throw new LeaveError(403, 'HR override is switched off for leave in this organisation');
  }

  const managerNote = input.managerNote?.trim();
  if (managerNote && managerNote.length > 500) {
    throw new LeaveError(400, 'Note cannot exceed 500 characters');
  }
  const decidedAt = new Date();
  const updateFields: Partial<Leave> = {
    status: decision,
    decidedByUserId: adminUserId,
    decidedByRole: 'admin',
    decidedAt,
    updatedAt: decidedAt,
  };
  if (managerNote) updateFields.managerNote = managerNote;
  const updated = await leaves().findOneAndUpdate(
    { _id: leaveId, status: 'pending' },
    { $set: updateFields },
    { returnDocument: 'after' },
  );
  if (!updated) throw new LeaveError(409, 'Leave request has already been decided');
  await notifyLeaveDecided({
    employeeUserId: employee.userId,
    type: leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    approved: decision === 'approved',
    comment: input.managerNote?.trim() ?? '',
  });
  return toLeaveView(updated, employee);
}

/** Shared by the manager and HR decision paths, which send identical copy. */

function parseDateOnly(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LeaveError(400, `${field} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new LeaveError(400, `${field} is not a valid date`);
  }
  return date;
}

function inclusiveDays(startDate: Date, endDate: Date): number {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

/** YYYY-MM-DD company holidays for the employee's state inside a date range. */

/**
 * Leave days consumed by a range: every calendar day in it, less the company's
 * week-offs — from the grid HR set under Shifts › Policies, so the 2nd Saturday
 * can be off while the 1st is not — and any company holiday. Both may sit
 * inside a range without being charged as leave.
 */
function countLeaveDays(
  startDate: Date,
  endDate: Date,
  holidayDates: Set<string>,
  weeklyOff: Record<string, number[]>,
): number {
  let days = 0;
  for (let cursor = startDate; cursor <= endDate; cursor = addUtcDays(cursor, 1)) {
    if (isWeekOffDay(cursor, weeklyOff)) continue;
    if (holidayDates.has(cursor.toISOString().slice(0, 10))) continue;
    days += 1;
  }
  return days;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function balanceItem(total: number, used: number) {
  return { total, used, remaining: Math.max(0, total - used) };
}

function toLeaveView(leave: Leave & { _id: ObjectId }, employee: User): LeaveView {
  const createdAt = leave.createdAt ? new Date(leave.createdAt) : (leave.updatedAt ?? new Date());
  return {
    id: leave._id.toHexString(),
    userId: leave.userId,
    employee: {
      name: employee.name,
      email: employee.email,
      department: employee.department,
      designation: employee.designation,
    },
    type: leave.type,
    startDate: leave.startDate.toISOString().slice(0, 10),
    endDate: leave.endDate.toISOString().slice(0, 10),
    // Rows written before `days` existed fall back to the raw calendar span.
    days: leave.days ?? inclusiveDays(leave.startDate, leave.endDate),
    halfDay: leave.halfDay === true,
    reason: leave.reason,
    status: leave.status,
    managerNote: leave.managerNote,
    createdAt: createdAt.toISOString(),
    decidedAt: leave.decidedAt?.toISOString(),
    decidedByRole: leave.decidedByRole,
  };
}

export class LeaveError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
