import { randomUUID } from 'node:crypto';
import { feedbackRecords, users } from '../config/db';
import { User } from '../models/user.model';
import { orgUsers } from './admin-scope';
import { generateNewJoineePost } from './connect.service';

export class AdminError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

/** Org-wide list of every feedback record, for the HR dashboard (rule 5). */
export async function listAllFeedbackForAdmin(adminUserId: string) {
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const userById = new Map(employees.map((e) => [e.userId, e]));
  const records = await feedbackRecords()
    .find({ employeeUserId: { $in: employees.map((e) => e.userId) } })
    .sort({ period: -1, updatedAt: -1 })
    .toArray();
  return records.map((record) => {
    const employee = userById.get(record.employeeUserId);
    const manager = userById.get(record.managerUserId);
    return {
      id: record._id.toHexString(),
      employeeUserId: record.employeeUserId,
      employeeName: employee?.name ?? 'Unknown',
      department: employee?.department ?? employee?.designation,
      managerUserId: record.managerUserId,
      managerName: manager?.name,
      period: record.period,
      status: record.status,
      overallScore: record.overallScore,
      parameters: record.parameters,
      extra: record.extra,
      updatedAt: record.updatedAt?.toISOString?.() ?? undefined,
      sentAt: record.sentAt?.toISOString?.() ?? undefined,
    };
  });
}

/** Org-wide employee directory, for the HR dashboard. */
export async function listAllEmployeesForAdmin(adminUserId: string) {
  const employees = await orgUsers(adminUserId);
  const nameById = new Map(employees.map((e) => [e.userId, e.name]));
  return employees.map((e) => ({
    userId: e.userId,
    name: e.name,
    email: e.email,
    department: e.department,
    designation: e.designation,
    state: e.state,
    role: e.role ?? 'employee',
    isLeadership: e.isLeadership === true,
    dashboardAccess: e.dashboardAccess === true,
    // Absent means eligible — see User.overtimeEligible.
    overtimeEligible: e.overtimeEligible !== false,
    managerUserId: e.managerUserId,
    managerName: e.managerUserId ? nameById.get(e.managerUserId) : undefined,
    lifecycleStatus: e.lifecycleStatus,
  }));
}

export interface CreateEmployeeInput {
  name?: string; email?: string; designation?: string; department?: string;
  location?: string; employeeType?: string; managerUserId?: string;
  birthday?: string; joiningDate?: string;
}

export async function createEmployeeForAdmin(adminUserId: string, input: CreateEmployeeInput) {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new AdminError(404, 'Admin user not found');
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!name) throw new AdminError(400, 'Full name is required');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new AdminError(400, 'A valid work email is required');
  if (await users().findOne({ email })) throw new AdminError(409, 'An employee with this email already exists');
  const parseDate = (value: string | undefined, label: string) => {
    if (!value) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf())) throw new AdminError(400, `${label} is invalid`);
    return date;
  };
  const employee: User = {
    userId: randomUUID(), name, email, org: admin.org,
    designation: input.designation?.trim() || undefined,
    department: input.department?.trim() || undefined,
    location: input.location?.trim() || undefined,
    employeeType: input.employeeType === 'contract' || input.employeeType === 'intern' ? input.employeeType : 'full_time',
    managerUserId: input.managerUserId || undefined,
    birthday: parseDate(input.birthday, 'Date of birth'),
    joiningDate: parseDate(input.joiningDate, 'Joining date') ?? new Date(),
    lifecycleStatus: 'onboarding', onboardingStatus: 'pending', noticeStatus: 'none',
    role: 'employee', dashboardAccess: false, isLeadership: false,
    overtimeEligible: true,
    createdAt: Date.now(), updatedAt: new Date(),
  };
  const manager = employee.managerUserId
    ? await users().findOne({ userId: employee.managerUserId, ...(admin.org ? { org: admin.org } : {}) })
    : undefined;
  await users().insertOne(employee);
  try { await generateNewJoineePost(employee, manager ?? undefined); }
  catch (error) { await users().deleteOne({ userId: employee.userId }); throw error; }
  return employee;
}

/**
 * Flips a single employee's overtime eligibility from the HR dashboard.
 *
 * Scoped to the admin's own org so one company's HR cannot touch another's.
 */
export async function setOvertimeEligibilityForAdmin(
  adminUserId: string,
  employeeUserId: string,
  eligible: boolean,
) {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin) throw new AdminError(404, 'Admin user not found');
  const filter = { userId: employeeUserId, ...(admin.org ? { org: admin.org } : {}) };
  const employee = await users().findOneAndUpdate(
    filter,
    { $set: { overtimeEligible: eligible, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!employee) throw new AdminError(404, 'Employee not found');
  return { userId: employee.userId, name: employee.name, overtimeEligible: eligible };
}
