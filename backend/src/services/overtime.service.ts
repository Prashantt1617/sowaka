import { ObjectId } from 'mongodb';
import { overtimeRequests, users } from '../config/db';
import { OvertimeRequest, OvertimeStatus } from '../models/overtime.model';
import { User } from '../models/user.model';
import { orgUsers } from './admin-scope';
import { getCompanyConfig } from './company-settings.service';
import { holidayDatesForUser } from './holiday.service';
import { fullDayHoursFor, isWeekOffDay, policyForUser, weekOffGridFor } from './shift.service';
import { notifyOvertimeDecided, notifyOvertimeSubmitted } from './request-notifications.service';

const decisions = new Set<OvertimeStatus>(['approved', 'declined']);

export async function createOvertimeRequest(
  userId: string,
  input: { workDate: string; startTime: string; endTime: string; note?: string },
) {
  const employee = await requireEmployeeWithManager(userId);
  const workDate = parseDateOnly(input.workDate, 'workDate');
  if (workDate >= startOfUtcDay(new Date())) {
    throw new OvertimeError(400, 'Overtime can only be submitted for a past date');
  }
  // How far back a claim may reach is the org's call, from Policies › Overtime.
  // It was configurable but never consulted, so a claim for a day six months
  // ago was accepted.
  const overtimeRules = (await policyForUser(userId)).overtime;
  const daysBack = Math.round(
    (startOfUtcDay(new Date()).getTime() - workDate.getTime()) / 86_400_000,
  );
  if (daysBack > overtimeRules.backdateDays) {
    throw new OvertimeError(
      400,
      `Overtime can be claimed up to ${overtimeRules.backdateDays} days back`,
    );
  }
  const startTime = parseDateTime(input.startTime, 'startTime');
  const endTime = parseDateTime(input.endTime, 'endTime');
  const hours = Math.round(((endTime.getTime() - startTime.getTime()) / 3_600_000) * 100) / 100;
  if (hours <= 0) throw new OvertimeError(400, 'End time must be after start time');
  if (hours > 16) throw new OvertimeError(400, 'Overtime duration looks too long — check the times');

  // Team gate + full-day eligibility. A full day's worth (8h+) of overtime is
  // only allowed on a week-off or a company holiday; shorter stretches may be
  // logged for any past day.
  if (employee.overtimeEligible === false) {
    throw new OvertimeError(403, 'You are not eligible to apply for overtime');
  }
  const companyConfig = await getCompanyConfig(employee.org);
  if (companyConfig.overtimeDisabledDepartments.includes((employee.department ?? '').trim())) {
    throw new OvertimeError(403, 'Overtime is not enabled for your team');
  }
  if (hours >= 8) {
    const holidayDates = await holidayDatesForUser(employee);
    const isHoliday = holidayDates.has(workDate.toISOString().slice(0, 10));
    // Week-offs come from the shift policy's grid, the same one leave and the
    // attendance calendar read.
    const weeklyOff = await weekOffGridFor(employee.userId);
    if (!isHoliday && !isWeekOffDay(workDate, weeklyOff)) {
      throw new OvertimeError(
        400,
        'A full day (8h+) of overtime can only be logged on a week-off or holiday',
      );
    }
  }

  const note = input.note?.trim();
  if (note && note.length > 500) throw new OvertimeError(400, 'Note is too long');
  const duplicate = await overtimeRequests().findOne({
    userId,
    workDate,
    status: { $in: ['pending', 'approved'] },
  });
  if (duplicate) throw new OvertimeError(409, 'Overtime is already recorded for this date');

  const now = new Date();
  const request: OvertimeRequest = {
    userId,
    managerUserId: employee.managerUserId!,
    workDate,
    startTime,
    endTime,
    hours,
    note,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  const result = await overtimeRequests().insertOne(request);
  await notifyOvertimeSubmitted({
    employeeUserId: userId,
    workDate,
    duration: await durationLabel(userId, hours),
    reason: note ?? '',
  });
  return toView({ ...request, _id: result.insertedId }, employee);
}

export async function getMyOvertimeRequests(userId: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new OvertimeError(404, 'Employee not found');
  const requests = await overtimeRequests().find({ userId }).sort({ createdAt: -1 }).toArray();
  return requests.map((request) => toView(request, employee));
}

export async function getManagerOvertimeInbox(managerUserId: string) {
  const requests = await overtimeRequests()
    .find({ managerUserId })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  const employeeIds = [...new Set(requests.map((request) => request.userId))];
  const employees = await users()
    .find({ userId: { $in: employeeIds } })
    .toArray();
  const employeeById = new Map(employees.map((employee) => [employee.userId, employee]));
  return requests.flatMap((request) => {
    const employee = employeeById.get(request.userId);
    return employee ? [toView(request, employee)] : [];
  });
}

export async function decideOvertime(
  managerUserId: string,
  requestIdInput: string,
  input: { decision: string; managerNote?: string },
) {
  if (!ObjectId.isValid(requestIdInput)) throw new OvertimeError(400, 'Invalid overtime ID');
  const decision = input.decision.trim().toLowerCase() as OvertimeStatus;
  if (!decisions.has(decision)) {
    throw new OvertimeError(400, 'Decision must be approved or declined');
  }
  const requestId = new ObjectId(requestIdInput);
  const request = await overtimeRequests().findOne({ _id: requestId });
  if (!request) throw new OvertimeError(404, 'Overtime request not found');
  if (request.managerUserId !== managerUserId) {
    throw new OvertimeError(403, 'Only the assigned manager can decide this overtime request');
  }
  if (request.status !== 'pending') {
    throw new OvertimeError(409, 'Overtime request has already been decided');
  }
  const managerNote = input.managerNote?.trim();
  if (decision === 'declined' && !managerNote) {
    throw new OvertimeError(400, 'A decline reason is required');
  }
  if (managerNote && managerNote.length > 500) {
    throw new OvertimeError(400, 'Manager note cannot exceed 500 characters');
  }
  const employee = await users().findOne({ userId: request.userId });
  if (!employee) throw new OvertimeError(409, 'Overtime request has an invalid employee');
  const now = new Date();
  const updated = await overtimeRequests().findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    {
      $set: {
        status: decision,
        ...(managerNote ? { managerNote } : {}),
        decidedByUserId: managerUserId,
        decidedByRole: 'manager',
        decidedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw new OvertimeError(409, 'Overtime request has already been decided');
  await notifyOvertimeDecided({
    employeeUserId: request.userId,
    workDate: request.workDate,
    duration: await durationLabel(request.userId, request.hours),
    approved: decision === 'approved',
    comment: managerNote ?? '',
  });
  return toView(updated, employee);
}

/**
 * "Full day" or "Half day", against the org's own full-day threshold — the
 * same figure the attendance calendar grades a day by.
 */
async function durationLabel(userId: string, hours: number): Promise<string> {
  return hours >= (await fullDayHoursFor(userId)) ? 'Full day' : 'Half day';
}

/** Org-wide list of every overtime request, for the HR dashboard. */
export async function listAllOvertimeForAdmin(adminUserId: string) {
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  const requests = await overtimeRequests()
    .find({ userId: { $in: employees.map((e) => e.userId) } })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  return requests.flatMap((request) => {
    const employee = employeeById.get(request.userId);
    return employee ? [toView(request, employee)] : [];
  });
}

/** Dashboard override for overtime — decidedByRole 'admin', no self-override (rule 8). */
export async function adminDecideOvertime(
  adminUserId: string,
  requestIdInput: string,
  input: { decision: string; managerNote?: string },
) {
  if (!ObjectId.isValid(requestIdInput)) throw new OvertimeError(400, 'Invalid overtime ID');
  const decision = input.decision.trim().toLowerCase() as OvertimeStatus;
  if (!decisions.has(decision)) {
    throw new OvertimeError(400, 'Decision must be approved or declined');
  }
  const requestId = new ObjectId(requestIdInput);
  const request = await overtimeRequests().findOne({ _id: requestId });
  if (!request) throw new OvertimeError(404, 'Overtime request not found');
  if (request.userId === adminUserId) {
    throw new OvertimeError(403, 'You cannot override your own request');
  }
  if (request.status !== 'pending') {
    throw new OvertimeError(409, 'Overtime request has already been decided');
  }
  const managerNote = input.managerNote?.trim();
  if (managerNote && managerNote.length > 500) {
    throw new OvertimeError(400, 'Note cannot exceed 500 characters');
  }
  const employee = await users().findOne({ userId: request.userId });
  if (!employee) throw new OvertimeError(409, 'Overtime request has an invalid employee');
  const now = new Date();
  const updated = await overtimeRequests().findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    {
      $set: {
        status: decision,
        ...(managerNote ? { managerNote } : {}),
        decidedByUserId: adminUserId,
        decidedByRole: 'admin',
        decidedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw new OvertimeError(409, 'Overtime request has already been decided');
  await notifyOvertimeDecided({
    employeeUserId: request.userId,
    workDate: request.workDate,
    duration: await durationLabel(request.userId, request.hours),
    approved: decision === 'approved',
    comment: managerNote ?? '',
  });
  return toView(updated, employee);
}

function toView(request: OvertimeRequest & { _id: ObjectId }, employee: User) {
  return {
    id: request._id.toHexString(),
    userId: request.userId,
    employee: {
      name: employee.name,
      department: employee.department ?? employee.designation ?? 'Team',
    },
    workDate: request.workDate.toISOString().slice(0, 10),
    startTime: request.startTime.toISOString(),
    endTime: request.endTime.toISOString(),
    hours: request.hours,
    note: request.note,
    managerNote: request.managerNote,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString(),
    decidedByRole: request.decidedByRole,
  };
}

async function requireEmployeeWithManager(userId: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new OvertimeError(404, 'Employee not found');
  if (!employee.managerUserId) {
    throw new OvertimeError(409, 'A manager must be assigned before applying for overtime');
  }
  const manager = await users().findOne({ userId: employee.managerUserId });
  if (!manager || ['offboarded', 'terminated'].includes(manager.lifecycleStatus)) {
    throw new OvertimeError(409, 'The assigned manager is not active');
  }
  return employee;
}

function parseDateOnly(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OvertimeError(400, `${field} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new OvertimeError(400, `${field} is not a valid date`);
  }
  return date;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateTime(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new OvertimeError(400, `${field} is not a valid time`);
  return date;
}

export class OvertimeError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
