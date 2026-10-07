import { attendanceRegularizations, overtimeRequests, reimbursementClaims, users } from '../config/db';
import { User } from '../models/user.model';
import { invalidateAttendanceReport } from './attendance-report.service';

const inactiveStatuses = new Set(['offboarded', 'terminated']);

export interface EmployeeSummary {
  userId: string;
  employeeId?: string;
  name: string;
  email: string;
  designation?: string;
  department?: string;
  org?: string;
  lifecycleStatus: User['lifecycleStatus'];
  role: 'manager' | 'employee';
  managerUserId?: string;
}

export interface ReportingLine {
  employee: EmployeeSummary;
  manager: EmployeeSummary | null;
}

/**
 * The org HR is acting in. Every reporting change and lookup stays inside it:
 * a dashboard user can only see and move people in their own company.
 */
async function actorOrg(actorUserId: string): Promise<string | undefined> {
  const actor = await users().findOne({ userId: actorUserId }, { projection: { org: 1 } });
  if (!actor) throw new ReportingError(401, 'Sign in again');
  return actor.org;
}

function assertInOrg(user: User, org: string | undefined, what: string): void {
  if ((user.org ?? undefined) !== org) throw new ReportingError(404, `${what} not found`);
}

/**
 * Requests waiting on the old manager go to the new one, so nothing sits in
 * the inbox of someone who no longer manages this person. Decided requests
 * keep the manager who decided them.
 */
async function movePendingRequests(employeeUserId: string, managerUserId: string): Promise<number> {
  const filter = { userId: employeeUserId, status: 'pending' as const, managerUserId: { $ne: managerUserId } };
  const update = { $set: { managerUserId, updatedAt: new Date() } };
  const moved = await Promise.all([
    reimbursementClaims().updateMany(filter, update),
    overtimeRequests().updateMany(filter, update),
    attendanceRegularizations().updateMany(filter, update),
  ]);
  return moved.reduce((total, r) => total + r.modifiedCount, 0);
}

export async function assignManager(
  actorUserId: string,
  employeeUserIdInput: string,
  managerUserIdInput: string,
): Promise<ReportingLine & { movedRequests: number }> {
  const employeeUserId = normalizeUserId(employeeUserIdInput);
  const managerUserId = normalizeUserId(managerUserIdInput);

  if (!employeeUserId || !managerUserId) {
    throw new ReportingError(400, 'employeeUserId and managerUserId are required');
  }
  if (employeeUserId === managerUserId) {
    throw new ReportingError(400, 'An employee cannot be their own manager');
  }

  const collection = users();
  const [employee, manager] = await Promise.all([
    collection.findOne({ userId: employeeUserId }),
    collection.findOne({ userId: managerUserId }),
  ]);

  if (!employee) {
    throw new ReportingError(404, 'Employee not found');
  }
  if (!manager) {
    throw new ReportingError(404, 'Manager not found');
  }
  const org = await actorOrg(actorUserId);
  assertInOrg(employee, org, 'Employee');
  assertInOrg(manager, org, 'Manager');
  if (inactiveStatuses.has(employee.lifecycleStatus)) {
    throw new ReportingError(409, 'Cannot update an inactive employee');
  }
  if (inactiveStatuses.has(manager.lifecycleStatus)) {
    throw new ReportingError(409, 'An inactive employee cannot be assigned as manager');
  }
  if (employee.org && manager.org && employee.org !== manager.org) {
    throw new ReportingError(409, 'Employee and manager must belong to the same organization');
  }

  await assertNoReportingCycle(employeeUserId, managerUserId);

  const updatedAt = new Date();
  const previousManagerUserId = employee.managerUserId;
  const updatedEmployee = await collection.findOneAndUpdate(
    { userId: employeeUserId },
    { $set: { managerUserId, updatedAt } },
    { returnDocument: 'after' },
  );

  await syncManagerRole(managerUserId, updatedAt);
  if (previousManagerUserId && previousManagerUserId !== managerUserId) {
    await syncManagerRole(previousManagerUserId, updatedAt);
  }

  if (!updatedEmployee) {
    throw new ReportingError(404, 'Employee not found');
  }
  const movedRequests = await movePendingRequests(employeeUserId, managerUserId);
  // The attendance report names each person's manager.
  if (org) invalidateAttendanceReport(org);

  return {
    employee: toEmployeeSummary(updatedEmployee),
    manager: toEmployeeSummary({ ...manager, role: 'manager', updatedAt }),
    movedRequests,
  };
}

export async function removeManager(actorUserId: string, employeeUserIdInput: string): Promise<EmployeeSummary> {
  const employeeUserId = requireUserId(employeeUserIdInput, 'employeeUserId');
  const org = await actorOrg(actorUserId);
  const collection = users();
  const employee = await collection.findOneAndUpdate(
    { userId: employeeUserId, org },
    { $unset: { managerUserId: '' }, $set: { updatedAt: new Date() } },
  );

  if (!employee) {
    throw new ReportingError(404, 'Employee not found');
  }

  if (employee.managerUserId) {
    await syncManagerRole(employee.managerUserId);
  }
  if (org) invalidateAttendanceReport(org);

  const updatedEmployee = { ...employee };
  delete updatedEmployee.managerUserId;
  return toEmployeeSummary(updatedEmployee);
}

export async function getReportingLine(actorUserId: string, employeeUserIdInput: string): Promise<ReportingLine> {
  const employeeUserId = requireUserId(employeeUserIdInput, 'employeeUserId');
  const employee = await users().findOne({ userId: employeeUserId, org: await actorOrg(actorUserId) });

  if (!employee) {
    throw new ReportingError(404, 'Employee not found');
  }
  if (!employee.managerUserId) {
    return { employee: toEmployeeSummary(employee), manager: null };
  }

  const manager = await users().findOne({ userId: employee.managerUserId });
  if (!manager) {
    throw new ReportingError(409, 'Employee has an invalid manager reference');
  }

  return {
    employee: toEmployeeSummary(employee),
    manager: toEmployeeSummary(manager),
  };
}

export async function getDirectReports(actorUserId: string, managerUserIdInput: string): Promise<{
  manager: EmployeeSummary;
  employees: EmployeeSummary[];
}> {
  const managerUserId = requireUserId(managerUserIdInput, 'managerUserId');
  const org = await actorOrg(actorUserId);
  const collection = users();
  const manager = await collection.findOne({ userId: managerUserId, org });

  if (!manager) {
    throw new ReportingError(404, 'Manager not found');
  }

  const employees = await collection.find({ managerUserId, org }).sort({ name: 1, userId: 1 }).toArray();

  return {
    manager: toEmployeeSummary(manager),
    employees: employees.map(toEmployeeSummary),
  };
}

async function assertNoReportingCycle(
  employeeUserId: string,
  managerUserId: string,
): Promise<void> {
  const visited = new Set<string>();
  let currentUserId: string | undefined = managerUserId;

  while (currentUserId) {
    if (currentUserId === employeeUserId) {
      throw new ReportingError(409, 'Manager assignment would create a reporting cycle');
    }
    if (visited.has(currentUserId)) {
      throw new ReportingError(409, 'The existing reporting hierarchy contains a cycle');
    }

    visited.add(currentUserId);
    const currentUser: User | null = await users().findOne({ userId: currentUserId });
    currentUserId = currentUser?.managerUserId;
  }
}

async function syncManagerRole(userId: string, updatedAt = new Date()): Promise<void> {
  const collection = users();
  const hasDirectReports =
    (await collection.countDocuments({ managerUserId: userId }, { limit: 1 })) > 0;
  await collection.updateOne(
    { userId },
    { $set: { role: hasDirectReports ? 'manager' : 'employee', updatedAt } },
  );
}

function requireUserId(value: string, field: string): string {
  const userId = normalizeUserId(value);
  if (!userId) {
    throw new ReportingError(400, `${field} is required`);
  }
  return userId;
}

function normalizeUserId(value: string): string {
  return value.trim();
}

function toEmployeeSummary(user: User): EmployeeSummary {
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    designation: user.designation,
    department: user.department,
    org: user.org,
    lifecycleStatus: user.lifecycleStatus,
    role: user.role ?? 'employee',
    managerUserId: user.managerUserId,
  };
}

export class ReportingError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
