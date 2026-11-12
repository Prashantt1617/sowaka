import { ObjectId } from 'mongodb';
import { overtimeRequests, shiftAssignments, users } from '../config/db';
import {
  compensationLabel,
  OvertimeCompensation,
  OvertimeRequest,
  OvertimeStatus,
  overtimeDurationOf,
  preferredCompensationOf,
  sameCompensation,
} from '../models/overtime.model';
import { User } from '../models/user.model';
import { orgUsersWithRows, sortLikeMongo } from './admin-scope';
import { requestUserFor } from './request-user';
import { getCompanyConfig } from './company-settings.service';
import { COMP_OFF_CREDIT, type OvertimeDuration, type ShiftAssignment, type ShiftPolicyRules } from '../models/shift.model';
import { orgPolicySetup, policiesForPeople, policyForUser, resolvePolicies, todayIso } from './shift.service';
import { notifyOvertimeDecided, notifyOvertimeSubmitted } from './request-notifications.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { requestViewerWithPhoto } from '../middleware/request-viewer';

const decisions = new Set<OvertimeStatus>(['approved', 'declined']);

export async function createOvertimeRequest(
  userId: string,
  input: {
    workDate: string;
    startTime: string;
    endTime: string;
    duration?: string;
    /** `{ kind: 'pay' }` or `{ kind: 'comp_off', days: 1 | 0.5 }`; absent from older app builds. */
    compensation?: unknown;
    note?: string;
  },
) {
  const employee = await requireEmployeeWithManager(userId);
  const workDate = parseDateOnly(input.workDate, 'workDate');
  if (workDate >= startOfUtcDay(new Date())) {
    throw new OvertimeError(400, 'Overtime can only be submitted for a past date');
  }
  // How far back a claim may reach is the org's call, from Policies › Overtime.
  // It was configurable but never consulted, so a claim for a day six months
  // ago was accepted.
  const policy = await policyForUser(userId);
  const overtimeRules = policy.overtime;
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
  // The hours worked set the ceiling: a claim may be for less than what was
  // put in, never more. Without this the duration is simply taken on trust,
  // and a modified client could claim a full day's comp-off for a minute.
  const earned = overtimeDurationOf({ hours }, policy.minFullDayHours);
  if (chosen === 'full_day' && earned === 'half_day') {
    throw new OvertimeError(400, 'A full day needs a full day of hours');
  }
  const duration: OvertimeDuration =
    chosen === 'half_day' || chosen === 'full_day' ? chosen : earned;
  // Overtime pay or comp-off, as chosen. An app that predates the choice sends
  // nothing, and its request is handled exactly as before.
  const compensation = parseCompensation(input.compensation);
  if (compensation?.kind === 'comp_off') {
    // Comp-off is a leave type HR keeps on the shift template; without it (or
    // with leave balances off) a credit would land nowhere, so it is refused
    // rather than quietly turned into something else.
    if (!compOffSetUp(policy)) {
      throw new OvertimeError(409, "Comp-off isn't set up for you — ask HR");
    }
    // As much comp-off as the overtime claimed, never more.
    if (compensation.days > COMP_OFF_CREDIT[duration]) {
      throw new OvertimeError(400, 'A full day of comp-off needs a full day of overtime');
    }
  }

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
    ...(compensation ? { compensation } : {}),
    note,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  const result = await overtimeRequests().insertOne(request);
  await notifyOvertimeSubmitted({
    employeeUserId: userId,
    requestId: String(result.insertedId),
    workDate,
    duration: labelOf(duration),
    compensation: compensationLabel(compensation),
    reason: note ?? '',
  });
  return await toView({ ...request, _id: result.insertedId }, employee, policy.minFullDayHours, compOffSetUp(policy));
}

export async function getMyOvertimeRequests(userId: string) {
  // The person, their requests and their full-day hours depend only on who
  // they are, so they are read together rather than one after another.
  const policyLookup = policyForUser(userId);
  policyLookup.catch(() => undefined);
  const [employee, requests] = await Promise.all([
    requestViewerWithPhoto(userId) ?? users().findOne({ userId }, { projection: OVERTIME_VIEW_EMPLOYEE }),
    overtimeRequests().find({ userId }).sort({ createdAt: -1 }).toArray(),
  ]);
  if (!employee) throw new OvertimeError(404, 'Employee not found');
  const policy = await policyLookup;
  return await Promise.all(
    requests.map((request) => toView(request, employee as User, policy.minFullDayHours, compOffSetUp(policy))),
  );
}

/** The fields of a person an overtime view shows, and their org for the policy lookup. */
const OVERTIME_VIEW_EMPLOYEE = {
  _id: 0, userId: 1, org: 1, name: 1, department: 1, designation: 1, profilePhotoKey: 1, profilePhotoUrl: 1,
} as const;

export async function getManagerOvertimeInbox(managerUserId: string) {
  // The requests and the people who raised them in one trip, then every one
  // of those people's full-day hours in one more.
  const rows = await overtimeRequests()
    .aggregate<OvertimeRequest & { _id: ObjectId; employee: User[] }>([
      { $match: { managerUserId } },
      { $sort: { status: -1, createdAt: -1 } },
      {
        $lookup: {
          from: users().collectionName,
          localField: 'userId',
          foreignField: 'userId',
          pipeline: [{ $limit: 1 }, { $project: OVERTIME_VIEW_EMPLOYEE }],
          as: 'employee',
        },
      },
    ])
    .toArray();
  const requests = rows.map(({ employee: _employee, ...request }) => request);
  const employees = [...new Map(rows.flatMap((row) => row.employee).map((e) => [e.userId, e])).values()];
  const employeeIds = [...new Set(requests.map((request) => request.userId))];
  const employeeById = new Map(employees.map((employee) => [employee.userId, employee]));
  const policyByUser = await policiesByUser(employeeIds, employees);
  return await Promise.all(
    requests.flatMap((request) => {
      const employee = employeeById.get(request.userId);
      const policy = policyByUser.get(request.userId);
      return employee
        ? [toView(request, employee, policy?.minFullDayHours ?? 8, policy ? compOffSetUp(policy) : false)]
        : [];
    }),
  );
}

export async function decideOvertime(
  managerUserId: string,
  requestIdInput: string,
  input: {
    decision: string;
    managerNote?: string;
    /**
     * On approval, the manager's final call: `{ kind: 'pay' }` or
     * `{ kind: 'comp_off', days: 1 | 0.5 }`. Absent (an older app, or no
     * change made): the employee's preference stands. Ignored on decline.
     */
    compensation?: unknown;
  },
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
  return await recordDecision(request, decision, managerNote, input.compensation, managerUserId, 'manager');
}

/**
 * Writes an approval or decline, shared by the manager's inbox and HR's
 * dashboard. On approval the approver's choice of overtime pay or comp-off —
 * checked as the form's is: a known kind, no more comp-off than the duration
 * claimed, and only where Comp-off is set up for the person — becomes the
 * request's `compensation`, which payroll and the Comp-off balance read; the
 * person's own choice is kept as `preferredCompensation`. No choice sent: the
 * preference stands. A decline changes neither.
 */
async function recordDecision(
  request: OvertimeRequest & { _id: ObjectId },
  decision: OvertimeStatus,
  managerNote: string | undefined,
  rawCompensation: unknown,
  decidedByUserId: string,
  decidedByRole: 'manager' | 'admin',
) {
  const employee = await users().findOne({ userId: request.userId });
  if (!employee) throw new OvertimeError(409, 'Overtime request has an invalid employee');
  const policy = await policyForUser(request.userId);
  const preferred = preferredCompensationOf(request);
  let compensation = request.compensation;
  if (decision === 'approved') {
    const decided = parseCompensation(rawCompensation, 'Decision');
    if (decided?.kind === 'comp_off') {
      if (!compOffSetUp(policy)) {
        throw new OvertimeError(409, `Comp-off isn't set up for ${employee.name ?? 'this employee'} — choose overtime pay, or ask HR`);
      }
      if (decided.days > COMP_OFF_CREDIT[overtimeDurationOf(request, policy.minFullDayHours)]) {
        throw new OvertimeError(400, 'A full day of comp-off needs a full day of overtime');
      }
    }
    if (decided) compensation = decided;
  }
  const now = new Date();
  const updated = await overtimeRequests().findOneAndUpdate(
    { _id: request._id, status: 'pending' },
    {
      $set: {
        status: decision,
        ...(managerNote ? { managerNote } : {}),
        ...(decision === 'approved'
          ? { preferredCompensation: preferred, ...(compensation ? { compensation } : {}) }
          : {}),
        decidedByUserId,
        decidedByRole,
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
    duration: labelOf(overtimeDurationOf(request, policy.minFullDayHours)),
    compensation: compensationLabel(updated.compensation),
    preferred: sameCompensation(preferred, updated.compensation) ? undefined : compensationLabel(preferred),
    approved: decision === 'approved',
    comment: managerNote ?? '',
    decidedByUserId: updated.decidedByUserId,
    requestId: String(updated._id),
  });
  return await toView(updated, employee, policy.minFullDayHours, compOffSetUp(policy));
}

/** "Full day" or "Half day", for the notification copy. */
function labelOf(duration: OvertimeDuration): string {
  return duration === 'full_day' ? 'Full day' : 'Half day';
}

/** Org-wide list of every overtime request, for the HR dashboard. */
export async function listAllOvertimeForAdmin(adminUserId: string) {
  // One round trip for the lot: the roster with its requests and each
  // person's shift assignments, beside the org's policy and templates. The
  // full-day threshold is then resolved in memory, as `policiesForPeople`
  // would, rather than read person by person.
  const org = requestUserFor(adminUserId)?.org;
  const asOf = todayIso();
  const [{ employees, rows }, setup] = await Promise.all([
    orgUsersWithRows(adminUserId, overtimeRequests(), {
      onlyWithRows: true,
      userFields: ['userId', 'org', 'name', 'department', 'designation', 'profilePhotoKey', 'profilePhotoUrl'],
      alsoLookup: [
        {
          $lookup: {
            from: shiftAssignments().collectionName,
            localField: 'userId',
            foreignField: 'userId',
            pipeline: [{ $match: { effectiveFrom: { $lte: asOf } } }],
            as: '__assignments',
          },
        },
      ],
    }),
    org ? orgPolicySetup([org]) : Promise.resolve(null),
  ]);
  if (employees.length === 0) return [];
  const assignments = sortLikeMongo(
    employees.flatMap((e) => ((e as { __assignments?: ShiftAssignment[] }).__assignments ?? [])),
    [['effectiveFrom', -1], ['createdAt', -1]],
  );
  for (const e of employees) delete (e as { __assignments?: unknown }).__assignments;
  const employeeById = new Map(employees.map((e) => [e.userId, e]));
  const requests = sortLikeMongo(rows, [['status', -1], ['createdAt', -1]]);
  // Everyone here is in the caller's org; anything else (no org on the
  // caller) reads the policies the long way.
  const policies =
    setup && employees.every((e) => e.org === org)
      ? resolvePolicies(employees, setup, assignments)
      : await policiesForPeople(employees, asOf);
  return await Promise.all(
    requests.flatMap((request) => {
      const employee = employeeById.get(request.userId);
      const policy = policies.get(request.userId);
      return employee
        ? [toView(request, employee, policy?.minFullDayHours ?? 8, policy ? compOffSetUp(policy) : false)]
        : [];
    }),
  );
}

/** Dashboard override for overtime — decidedByRole 'admin', no self-override (rule 8). */
export async function adminDecideOvertime(
  adminUserId: string,
  requestIdInput: string,
  input: {
    decision: string;
    managerNote?: string;
    /** HR's final call on approval, as the manager's; absent, the preference stands. */
    compensation?: unknown;
  },
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
  return await recordDecision(request, decision, managerNote, input.compensation, adminUserId, 'admin');
}

/**
 * Each of several people's policy (full-day threshold, leave types), looked
 * up once per person rather than once per request when shaping a list.
 */
async function policiesByUser(
  userIds: string[],
  /** Their user records, when in hand: then every policy is one batch. */
  people?: { userId: string; org?: string }[],
): Promise<Map<string, Pick<ShiftPolicyRules, 'minFullDayHours' | 'leave'>>> {
  const unique = [...new Set(userIds)];
  const batch = people?.length ? await policiesForPeople(people).catch(() => null) : null;
  const policies = await Promise.all(unique.map((userId) => batch?.get(userId) ?? policyForUser(userId)));
  return new Map(unique.map((userId, index) => [userId, policies[index]]));
}

async function toView(
  request: OvertimeRequest & { _id: ObjectId },
  employee: User,
  fullDayHours: number,
  /** Whether comp-off can be credited to this person, for the approver's decision. */
  compOffAvailable: boolean,
) {
  return {
    id: request._id.toHexString(),
    userId: request.userId,
    employee: {
      name: employee.name,
      department: employee.department ?? employee.designation ?? 'Team',
      // Their own face on the request card, where they have set one.
      photoUrl: await resolveProfilePhoto(employee),
    },
    workDate: request.workDate.toISOString().slice(0, 10),
    startTime: request.startTime.toISOString(),
    endTime: request.endTime.toISOString(),
    hours: request.hours,
    // The half or full day that was claimed, which is what the comp-off is
    // credited as; an older record is graded by its hours.
    duration: overtimeDurationOf(request, fullDayHours),
    // Overtime pay or comp-off (with its days): the employee's preference
    // while pending, the approver's decision once approved. Older app builds
    // read only this. Null on a request from before the choice existed.
    compensation: request.compensation ?? null,
    // What the employee asked for, whatever was decided.
    preferredCompensation: preferredCompensationOf(request),
    // Whether the approver may choose comp-off (HR has a Comp-off leave type
    // for this person); otherwise only overtime pay can be decided.
    compOffAvailable,
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

/**
 * The compensation the form (or the approver) sent: `{ kind: 'pay' }` or
 * `{ kind: 'comp_off', days: 1 | 0.5 }`. Nothing sent is undefined — an app
 * build from before the choice — and is handled as before.
 */
function parseCompensation(raw: unknown, what = 'Preference'): OvertimeCompensation | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OvertimeError(400, `${what} must be overtime pay or comp-off`);
  }
  const { kind, days } = raw as { kind?: unknown; days?: unknown };
  if (kind === 'pay') return { kind: 'pay' };
  if (kind === 'comp_off') {
    if (days === 1 || days === 0.5) return { kind: 'comp_off', days };
    throw new OvertimeError(400, 'Comp-off must be a full day (1) or a half day (0.5)');
  }
  throw new OvertimeError(400, `${what} must be overtime pay or comp-off`);
}

/**
 * Whether comp-off can be credited to this person: their leave types (from
 * their shift template, or the org's) include Comp-off, and their leave is
 * counted from a balance at all.
 */
function compOffSetUp(policy: Pick<ShiftPolicyRules, 'leave'>): boolean {
  return policy.leave.balanceTracked !== false && policy.leave.types.some((type) => type.key === 'comp_off');
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
