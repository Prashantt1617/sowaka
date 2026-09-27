import { ObjectId } from 'mongodb';
import { overtimeRequests, users } from '../config/db';
import { OvertimeRequest, OvertimeStatus, overtimeDurationOf } from '../models/overtime.model';
import { User } from '../models/user.model';
import { orgUsers } from './admin-scope';
import { getCompanyConfig } from './company-settings.service';
import type { OvertimeDuration } from '../models/shift.model';
import { fullDayHoursFor, policyForUser } from './shift.service';
import { notifyOvertimeDecided, notifyOvertimeSubmitted } from './request-notifications.service';

const decisions = new Set<OvertimeStatus>(['approved', 'declined']);

export async function createOvertimeRequest(
  userId: string,
  input: { workDate: string; startTime: string; endTime: string; duration?: string; note?: string },
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
  // Whether overtime is offered to these people at all. It is set on their
  // shift template, or on the org under Policies › Overtime — and until now it
  // was saved and never read, so switching it off did nothing.
  if (overtimeRules.eligible === false) {
    throw new OvertimeError(403, 'Overtime is not enabled for your shift');
  }
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
  // A claim is a half day or a full day, as the person chose. An app that
  // predates the choice sends only times; those are graded by the hours.
  const chosen = input.duration?.trim();
  if (chosen && chosen !== 'half_day' && chosen !== 'full_day') {
    throw new OvertimeError(400, 'Duration must be half_day or full_day');
  }
  const duration: OvertimeDuration = chosen === 'half_day' || chosen === 'full_day'
    ? chosen
    : overtimeDurationOf({ hours }, await fullDayHoursFor(userId));

  // Team gate. Overtime of any length may be logged for any past day: a long
  // stretch on a working day is exactly what overtime is for, and refusing it
  // unless the day was a week-off only pushed people to log it as something
  // else.
  if (employee.overtimeEligible === false) {
    throw new OvertimeError(403, 'You are not eligible to apply for overtime');
  }
  const companyConfig = await getCompanyConfig(employee.org);
  if (companyConfig.overtimeDisabledDepartments.includes((employee.department ?? '').trim())) {
    throw new OvertimeError(403, 'Overtime is not enabled for your team');
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
    duration,
    note,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  const result = await overtimeRequests().insertOne(request);
  await notifyOvertimeSubmitted({
    employeeUserId: userId,
    workDate,
    duration: labelOf(duration),
    reason: note ?? '',
  });
  return toView({ ...request, _id: result.insertedId }, employee, await fullDayHoursFor(userId));
}

export async function getMyOvertimeRequests(userId: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new OvertimeError(404, 'Employee not found');
  const requests = await overtimeRequests().find({ userId }).sort({ createdAt: -1 }).toArray();
  const fullDayHours = await fullDayHoursFor(userId);
  return requests.map((request) => toView(request, employee, fullDayHours));
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
  const hoursByUser = await fullDayHoursByUser(employeeIds);
  return requests.flatMap((request) => {
    const employee = employeeById.get(request.userId);
    return employee ? [toView(request, employee, hoursByUser.get(request.userId) ?? 8)] : [];
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
    duration: await durationLabel(request),
    approved: decision === 'approved',
    comment: managerNote ?? '',
  });
  return toView(updated, employee, await fullDayHoursFor(request.userId));
}

/** "Full day" or "Half day", for the notification copy. */
function labelOf(duration: OvertimeDuration): string {
  return duration === 'full_day' ? 'Full day' : 'Half day';
}

/** The duration a stored request was for, in the notification's words. */
async function durationLabel(request: Pick<OvertimeRequest, 'userId' | 'duration' | 'hours'>): Promise<string> {
  return labelOf(overtimeDurationOf(request, await fullDayHoursFor(request.userId)));
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
  const hoursByUser = await fullDayHoursByUser(requests.map((request) => request.userId));
  return requests.flatMap((request) => {
    const employee = employeeById.get(request.userId);
    return employee ? [toView(request, employee, hoursByUser.get(request.userId) ?? 8)] : [];
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
    duration: await durationLabel(request),
    approved: decision === 'approved',
    comment: managerNote ?? '',
  });
  return toView(updated, employee, await fullDayHoursFor(request.userId));
}

/**
 * The full-day threshold for each of several people, looked up once per
 * person rather than once per request when shaping a list.
 */
async function fullDayHoursByUser(userIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(userIds)];
  const hours = await Promise.all(unique.map((userId) => fullDayHoursFor(userId)));
  return new Map(unique.map((userId, index) => [userId, hours[index]]));
}

function toView(request: OvertimeRequest & { _id: ObjectId }, employee: User, fullDayHours: number) {
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
    // The half or full day that was claimed, which is what the comp-off is
    // credited as; an older record is graded by its hours.
    duration: overtimeDurationOf(request, fullDayHours),
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
