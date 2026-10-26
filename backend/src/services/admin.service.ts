import { randomUUID } from 'node:crypto';
import { forgetAuthUser } from './auth-cache';
import { authSessions, companies, deviceTokens, employeePaymentDetails, feedbackRecords, salaryStructures, users } from '../config/db';
import { EmployeeDocument, User } from '../models/user.model';
import { orgUsers, orgUsersWithRows, sortLikeMongo } from './admin-scope';
import { resolveProfilePhoto } from './s3-connect-media.service';
import { deleteEmployeeDocument, presignReceiptDownload, uploadEmployeeDocument } from './s3-receipt.service';
import { detailChanges, detailsTitle, logActivity } from './employee-activity.service';
import { forgetFace } from './face-id.service';
import { logger } from '../utils/logger';

export class AdminError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

/** Org-wide list of every feedback record, for the HR dashboard (rule 5). */
export async function listAllFeedbackForAdmin(adminUserId: string) {
  // The same people `orgUsers` returns, but only the four fields used here
  // (whole user records carry profile photos, some inline and hundreds of
  // KB), with their records, in one round trip. Everyone, not only those
  // reviewed: a manager is named from the same roster.
  const { employees, rows } = await orgUsersWithRows(adminUserId, feedbackRecords(), {
    foreignField: 'employeeUserId',
    userFields: ['userId', 'name', 'department', 'designation'],
  });
  if (employees.length === 0) return [];
  const userById = new Map(employees.map((e) => [e.userId, e]));
  const records = sortLikeMongo(rows, [['period', -1], ['updatedAt', -1]]);
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
  // Presigning is local arithmetic, not a round trip, so the whole roster's
  // photos resolve in one pass without slowing the directory down.
  const photos = await Promise.all(employees.map((e) => resolveProfilePhoto(e)));
  const documents = await Promise.all(employees.map((e) => employeeDocumentViews(e.documents)));
  return employees.map((e, i) => ({
    userId: e.userId,
    name: e.name,
    email: e.email,
    profilePhotoUrl: photos[i],
    documents: documents[i],
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
    // Present on the user record already; the dashboard's employee table and
    // profile show these, and without them every row reads as a dash.
    employeeId: e.employeeId,
    location: e.location ?? e.branch,
    // Kept separate from `location` as well as merged into it: KPI template
    // targeting filters on branch and location independently.
    branch: e.branch,
    recognition: e.recognition?.label,
    employeeType: e.employeeType,
    joiningDate: e.joiningDate ? e.joiningDate.toISOString().slice(0, 10) : undefined,
    birthday: e.birthday ? e.birthday.toISOString().slice(0, 10) : undefined,
    gender: e.gender,
    phone: e.phone,
    isDirector: e.isDirector === true,
  }));
}

/** The company's account limit, or null when it has none. */
async function accountLimitOf(org: string): Promise<number | null> {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, maxUsers: 1 } });
  const max = company?.maxUsers;
  return typeof max === 'number' && Number.isInteger(max) && max >= 0 ? max : null;
}

/** Accounts that count against the limit: everyone not offboarded or terminated. */
const countAccounts = (org: string) =>
  users().countDocuments({ org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } });

const accountLimitError = (limit: number) =>
  new AdminError(409, `Your plan allows up to ${limit} accounts. Contact Sowaka to add more.`);

/** The admin's company's account limit and how much of it is used; max is null when there is none. */
export async function accountLimitForAdmin(adminUserId: string): Promise<{ max: number | null; used: number }> {
  const admin = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } });
  if (!admin) throw new AdminError(404, 'Admin user not found');
  if (!admin.org) return { max: null, used: 0 };
  const [max, used] = await Promise.all([accountLimitOf(admin.org), countAccounts(admin.org)]);
  return { max, used };
}

export interface CreateEmployeeInput {
  name?: string; email?: string; designation?: string; department?: string;
  location?: string; employeeType?: string; managerUserId?: string;
  birthday?: string; joiningDate?: string;
  employeeId?: string; gender?: string; mobile?: string; branch?: string;
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
  // An employee id is what attendance records are keyed by, so a duplicate
  // would silently merge two people's punches.
  const employeeId = input.employeeId?.trim() || undefined;
  if (employeeId && await users().findOne({ org: admin.org, employeeId })) {
    throw new AdminError(409, `Employee ID ${employeeId} is already in use`);
  }
  // The company's account limit, checked before and after the write: two
  // admins adding at once must not both slip under it.
  const limit = admin.org ? await accountLimitOf(admin.org) : null;
  if (limit !== null && (await countAccounts(admin.org!)) >= limit) throw accountLimitError(limit);
  const employee: User = {
    userId: randomUUID(), name, email, org: admin.org,
    // Left out rather than set to undefined: the driver would store null,
    // and the unique index then refuses the second employee without an id.
    ...(employeeId ? { employeeId } : {}),
    gender: input.gender?.trim() || undefined,
    phone: input.mobile?.trim() || undefined,
    branch: input.branch?.trim() || undefined,
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
  void logActivity({ org: employee.org ?? '', userId: employee.userId, byUserId: adminUserId, kind: 'created', title: 'Added to the company' });
  if (limit !== null && (await countAccounts(admin.org!)) > limit) {
    await users().deleteOne({ userId: employee.userId });
    throw accountLimitError(limit);
  }
  // The welcome post is switched off: adding an employee no longer announces
  // them on Connect. [generateNewJoineePost] is kept for when it comes back.
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

export interface EmployeeDetailsInput {
  name?: string; email?: string; employeeId?: string; joiningDate?: string; birthday?: string;
  mobile?: string; gender?: string; designation?: string; department?: string; location?: string;
  employeeType?: string; isDirector?: boolean;
}

/**
 * Whether `employee` is the editor or sits anywhere below them in the
 * reporting line. Walks up the managers; a loop in the data ends the walk.
 */
async function isSelfOrBelow(editor: User, employee: User): Promise<boolean> {
  const seen = new Set<string>();
  let current: Pick<User, 'userId' | 'managerUserId'> | null = employee;
  while (current && !seen.has(current.userId)) {
    if (current.userId === editor.userId) return true;
    seen.add(current.userId);
    if (!current.managerUserId) return false;
    current = await users().findOne(
      { userId: current.managerUserId, org: editor.org },
      { projection: { _id: 0, userId: 1, managerUserId: 1 } },
    );
  }
  return false;
}

/**
 * Edits an employee's profile details from the dashboard. Only someone given
 * `canEditEmployeeDetails`: a dashboard admin (HR) for anyone in the company,
 * anyone else for themselves and the people below them.
 * Fields left out stay as they are; an empty optional field clears it.
 */
export async function updateEmployeeDetailsForAdmin(editorUserId: string, employeeUserId: string, input: EmployeeDetailsInput) {
  const editor = await users().findOne({ userId: editorUserId });
  if (!editor) throw new AdminError(404, 'Admin user not found');
  if (editor.canEditEmployeeDetails !== true) throw new AdminError(403, 'You cannot edit employee details');
  const employee = await users().findOne({ userId: employeeUserId, ...(editor.org ? { org: editor.org } : {}) });
  if (!employee) throw new AdminError(404, 'Employee not found');
  if (editor.dashboardAdmin !== true && !(await isSelfOrBelow(editor, employee))) {
    throw new AdminError(403, 'You can edit your own details and those of the people who report to you');
  }

  const set: Partial<User> = {};
  const unset: Record<string, ''> = {};
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
  const optional = (key: 'phone' | 'gender' | 'designation' | 'department' | 'location', value: unknown) => {
    const v = text(value);
    if (v === undefined) return;
    if (v) set[key] = v.slice(0, 120);
    else unset[key] = '';
  };
  const date = (value: unknown, label: string) => {
    const v = text(value);
    if (v === undefined) return undefined;
    if (!v) return null;
    const parsed = new Date(`${v}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(parsed.valueOf())) throw new AdminError(400, `${label} is invalid`);
    return parsed;
  };

  if (input.name !== undefined) {
    const name = text(input.name);
    if (!name) throw new AdminError(400, 'Full name is required');
    set.name = name.slice(0, 120);
  }
  if (input.email !== undefined) {
    const email = text(input.email)?.toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new AdminError(400, 'A valid work email is required');
    if (email !== employee.email) {
      if (await users().findOne({ email, userId: { $ne: employee.userId } })) {
        throw new AdminError(409, 'An employee with this email already exists');
      }
      set.email = email;
    }
  }
  if (input.employeeId !== undefined) {
    // Attendance is keyed by the employee id, so two people must never share one.
    const employeeId = text(input.employeeId);
    if (employeeId) {
      if (employeeId !== employee.employeeId
        && await users().findOne({ org: employee.org, employeeId, userId: { $ne: employee.userId } })) {
        throw new AdminError(409, `Employee ID ${employeeId} is already in use`);
      }
      set.employeeId = employeeId;
    } else {
      // Unset rather than null: the unique index refuses a second null.
      unset.employeeId = '';
    }
  }
  const joining = date(input.joiningDate, 'Joining date');
  if (joining === null) throw new AdminError(400, 'Joining date is required');
  if (joining) set.joiningDate = joining;
  const birthday = date(input.birthday, 'Date of birth');
  if (birthday) set.birthday = birthday;
  else if (birthday === null) unset.birthday = '';
  optional('phone', input.mobile);
  optional('gender', input.gender);
  optional('designation', input.designation);
  optional('department', input.department);
  optional('location', input.location);
  if (input.employeeType !== undefined) {
    if (!['full_time', 'contract', 'intern'].includes(String(input.employeeType))) throw new AdminError(400, 'Employee type is invalid');
    set.employeeType = input.employeeType as User['employeeType'];
  }
  if (input.isDirector !== undefined) set.isDirector = input.isDirector === true;

  const updated = await users().findOneAndUpdate(
    { userId: employee.userId },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' },
  );
  if (!updated) throw new AdminError(404, 'Employee not found');
  const changes = detailChanges(employee, set, unset);
  void logActivity({ org: employee.org ?? '', userId: employee.userId, byUserId: editorUserId, kind: 'details', title: detailsTitle(changes), changes });
  return { userId: updated.userId, changed: [...Object.keys(set), ...Object.keys(unset)] };
}


// ------------------------------------------------------------- documents

/** What HR may file against an employee. The dropdown offers exactly these. */
export const EMPLOYEE_DOCUMENT_TYPES = [
  'Offer letter',
  'ID proof',
  'Address proof',
  'Experience letter',
  'Resume',
] as const;

export interface EmployeeDocumentView {
  id: string;
  name: string;
  type: string | null;
  /** Presigned for stored files; the plain link for records that only had one. */
  url?: string;
  uploadedAt: string | null;
  size: number | null;
}

/** Resolves stored files to links the browser can open. Presigning is local arithmetic. */
export async function employeeDocumentViews(
  documents: EmployeeDocument[] | undefined,
): Promise<EmployeeDocumentView[]> {
  return Promise.all(
    (documents ?? []).map(async (document, index) => ({
      // Records written before uploads had no id; the position is stable
      // enough to open one, and nothing else is offered on them.
      id: document.id ?? `legacy-${index}`,
      name: document.name,
      type: document.type ?? null,
      url: document.objectKey
        ? await presignReceiptDownload(document.objectKey, document.name).catch(() => undefined)
        : document.url,
      uploadedAt: document.uploadedAt ? document.uploadedAt.toISOString() : null,
      size: document.size ?? null,
    })),
  );
}

async function employeeInOrg(adminUserId: string, userId: string) {
  const employees = await orgUsers(adminUserId);
  const employee = employees.find((e) => e.userId === userId);
  if (!employee) throw new AdminError(404, 'Employee not found');
  return employee;
}

export async function addEmployeeDocument(
  adminUserId: string,
  userId: string,
  typeInput: unknown,
  file: { originalName: string; contentType: string; size: number; bytes: Buffer } | undefined,
) {
  const type = String(typeInput ?? '').trim();
  if (!(EMPLOYEE_DOCUMENT_TYPES as readonly string[]).includes(type)) {
    throw new AdminError(400, `Document type must be one of: ${EMPLOYEE_DOCUMENT_TYPES.join(', ')}`);
  }
  if (!file) throw new AdminError(400, 'Attach the document to upload');
  await employeeInOrg(adminUserId, userId);
  const stored = await uploadEmployeeDocument(userId, file);
  const document: EmployeeDocument = {
    id: randomUUID(),
    name: file.originalName,
    type,
    objectKey: stored.objectKey,
    contentType: stored.contentType,
    size: stored.size,
    uploadedAt: new Date(),
  };
  const updated = await users().findOneAndUpdate(
    { userId },
    { $push: { documents: document } } as never,
    { returnDocument: 'after' },
  );
  return employeeDocumentViews(updated?.documents);
}

export async function removeEmployeeDocument(adminUserId: string, userId: string, documentId: string) {
  const employee = await employeeInOrg(adminUserId, userId);
  const document = (employee.documents ?? []).find((d) => d.id === documentId);
  if (!document) throw new AdminError(404, 'Document not found');
  const updated = await users().findOneAndUpdate(
    { userId },
    { $pull: { documents: { id: documentId } } } as never,
    { returnDocument: 'after' },
  );
  // The record is the source of truth; a stored file that outlives it is
  // only storage, so failing to remove it must not fail the request.
  if (document.objectKey) await deleteEmployeeDocument(document.objectKey).catch(() => undefined);
  return employeeDocumentViews(updated?.documents);
}

/**
 * Deletes an employee from the company for good: their account and profile,
 * every sign-in and device, their salary set-up and payment details. Only a
 * dashboard admin, never on themselves, with the person's name typed to
 * confirm, and not while anyone still reports to them. Records of what already
 * happened (attendance, leave, payslips, posts) stay, so past payroll and
 * reports still add up. A proper exit workflow will take over from this.
 */
export async function deleteEmployeeForAdmin(adminUserId: string, employeeUserId: string, confirmName: unknown) {
  const admin = await users().findOne({ userId: adminUserId });
  if (!admin?.org) throw new AdminError(403, 'No organisation on this account');
  if (admin.dashboardAdmin !== true) throw new AdminError(403, 'Only a dashboard admin can delete an employee');
  if (employeeUserId === adminUserId) throw new AdminError(400, 'You cannot delete your own account');
  const employee = await users().findOne({ userId: employeeUserId, org: admin.org });
  if (!employee) throw new AdminError(404, 'Employee not found');
  const typed = typeof confirmName === 'string' ? confirmName.trim().toLowerCase() : '';
  if (!typed || typed !== employee.name.trim().toLowerCase()) throw new AdminError(400, `Type ${employee.name} to confirm`);
  const reports = await users().countDocuments({ org: admin.org, managerUserId: employeeUserId, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } });
  if (reports > 0) {
    throw new AdminError(409, `${reports} ${reports === 1 ? 'person reports' : 'people report'} to ${employee.name}. Give them another manager first.`);
  }
  await Promise.all([
    (forgetAuthUser(employeeUserId), authSessions().deleteMany({ userId: employeeUserId })),
    deviceTokens().deleteMany({ userId: employeeUserId }),
    salaryStructures().deleteMany({ org: admin.org, userId: employeeUserId }),
    employeePaymentDetails().deleteMany({ org: admin.org, userId: employeeUserId } as never),
  ]);
  // Their face goes with them: from the collection, and the photo from the
  // bucket. A failure is logged for removal by hand rather than keeping the
  // account, which HR has asked to delete.
  await forgetFace(employee).catch((error) =>
    logger.error('Face ID data not removed with the employee; remove it by hand', {
      employeeUserId, collectionId: employee.faceId?.collectionId, faceId: employee.faceId?.faceId, photoKey: employee.faceId?.photoKey,
    }, error));
  await users().deleteOne({ userId: employeeUserId, org: admin.org });
  return { userId: employeeUserId, deleted: true };
}
