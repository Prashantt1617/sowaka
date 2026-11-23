/**
 * The pre-boarding profile's Basic details (the dashboard, HR): the employee ID, work email, role,
 * team, work location, employee type and joining day a joiner will have, and "Generate app access",
 * which makes their app account before joining with the same call Mark joined uses
 * (`createJoinerAccount`). Mark joined then uses that account instead of making a second one.
 *
 * Kept on the journey: `employeeId`, `candidate.workEmail`, `designation`, `department`, `location`
 * (work location), `employeeType`, `tj` (moved with every open due date, as a date change does) and
 * `appAccess`.
 */
import { journeys, offers, users } from '../../config/db';
import type { Journey, OfferFields } from '../../models/lifecycle.model';
import { mayEditEmployees } from '../../middleware/admin.middleware';
import { AdminError, createEmployeeForAdmin } from '../admin.service';
import { isDateKey } from './dueRules';
import { moveTj } from './engine';
import { LifecycleOfferError } from './files';

const EMPLOYEE_TYPES = ['full_time', 'intern', 'contract'] as const;
type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
/** Journeys that no longer hold an employee ID or work email (the offer ended before joining). */
const ENDED = ['declined', 'expired', 'not_joining'];
/** Basic details and app access are for someone still in pre-boarding. */
const NOT_PREBOARDING = new Set(['joined', 'moved_to_app', 'confirmed', ...ENDED]);
/** App access: once the candidate has accepted (a draft or a sent offer is not a joiner yet). */
const ACCESS_OPEN = new Set(['accepted', 'finalised', 'active', 'docs_approved']);

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^\S+@\S+\.\S+$/;

async function latestOfferFields(journeyId: string): Promise<Partial<OfferFields>> {
  const offer = await offers().findOne({ journeyId }, { projection: { _id: 0, versions: 1 } });
  const versions = offer?.versions ?? [];
  return ([...versions].reverse().find((v) => v.status !== 'draft') ?? versions.at(-1))?.fields ?? {};
}

/** 400 when another person (an employee, or another live joiner) has this employee ID in the company. */
async function assertEmployeeIdFree(journey: Journey, employeeId: string) {
  const own = journey.appAccess?.userId;
  const user = await users().findOne({ org: journey.org, employeeId, ...(own ? { userId: { $ne: own } } : {}) }, { projection: { _id: 0, name: 1 } });
  const other = user ? null : await journeys().findOne({ org: journey.org, kind: 'onboarding', id: { $ne: journey.id }, employeeId, status: { $nin: ENDED } } as never, { projection: { _id: 0, id: 1 } });
  if (user || other) throw new LifecycleOfferError(400, `Employee ID ${employeeId} is already in use`);
}

/** 400 when an account (any company, as Add employee checks) or another live joiner has this work email. */
async function assertWorkEmailFree(journey: Journey, email: string) {
  const own = journey.appAccess?.userId;
  const user = await users().findOne({ email, ...(own ? { userId: { $ne: own } } : {}) }, { projection: { _id: 0, userId: 1 } });
  const other = user ? null : await journeys().findOne({ org: journey.org, kind: 'onboarding', id: { $ne: journey.id }, 'candidate.workEmail': email, status: { $nin: ENDED } } as never, { projection: { _id: 0, id: 1 } });
  if (user || other) throw new LifecycleOfferError(400, `${email} is already someone’s work email`);
}

function assertPreboarding(journey: Journey) {
  if (journey.kind !== 'onboarding') throw new LifecycleOfferError(404, 'Journey not found');
  if (NOT_PREBOARDING.has(String(journey.status))) throw new LifecycleOfferError(409, 'Only someone still in pre-boarding can be changed here');
}

/**
 * PUT …/profile/basic — `{ employeeId?, workEmail?, designation?, department?, workLocation?, employeeType?, tj? }`.
 * A field left out stays; "" clears it (the employee type, designation, department and work location
 * fall back to the offer's; Tj cannot be cleared, "" leaves it).
 * Once the app account exists its employee ID and work email are fixed here (change them on the
 * employee's profile). Returns the fresh journey.
 */
export async function saveBasicDetails(journey: Journey, input: unknown, now = new Date()): Promise<Journey> {
  assertPreboarding(journey);
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  const clearable = (key: string, field: string, max: number) => {
    if (body[key] === undefined) return undefined;
    const v = text(body[key], max);
    if (v) set[field] = v; else unset[field] = '';
    return v;
  };
  if (body.employeeId !== undefined) {
    const employeeId = text(body.employeeId, 40);
    if (journey.appAccess && employeeId !== (journey.employeeId ?? '')) throw new LifecycleOfferError(409, 'Their app account is made: change the employee ID on their employee profile');
    if (employeeId) await assertEmployeeIdFree(journey, employeeId);
    clearable('employeeId', 'employeeId', 40);
  }
  if (body.workEmail !== undefined) {
    const workEmail = text(body.workEmail, 120).toLowerCase();
    if (workEmail && !EMAIL.test(workEmail)) throw new LifecycleOfferError(400, 'A valid work email is required');
    if (journey.appAccess && workEmail !== (journey.candidate?.workEmail ?? '')) throw new LifecycleOfferError(409, 'Their app account is made: change the work email on their employee profile');
    if (workEmail) { await assertWorkEmailFree(journey, workEmail); set['candidate.workEmail'] = workEmail; } else unset['candidate.workEmail'] = '';
  }
  // Cleared (""): the journey's own value goes and the offer's is used again (the account takes the offer's).
  clearable('designation', 'designation', 100);
  clearable('department', 'department', 100);
  clearable('workLocation', 'location', 100);
  if (body.employeeType !== undefined && body.employeeType !== '') {
    if (!EMPLOYEE_TYPES.includes(body.employeeType as EmployeeType)) throw new LifecycleOfferError(400, `employeeType is one of ${EMPLOYEE_TYPES.join(', ')}`);
    set.employeeType = body.employeeType;
  } else if (body.employeeType === '') unset.employeeType = '';
  // Tj cannot be cleared: "" leaves it as it is.
  const tj = body.tj === '' ? undefined : body.tj;
  if (tj !== undefined && !isDateKey(tj)) throw new LifecycleOfferError(400, 'The joining date must be YYYY-MM-DD');
  if (Object.keys(set).length || Object.keys(unset).length) {
    await journeys().updateOne({ id: journey.id }, { $set: { ...set, updatedAt: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  }
  // A new joining day moves every open due date (as an approved date change does).
  if (typeof tj === 'string' && tj !== journey.tj) await moveTj(journey.id, tj);
  return (await journeys().findOne({ id: journey.id }, { projection: { _id: 0 } }))!;
}

/**
 * The joiner's employee record (the app account), as Mark joined makes it: the work email and
 * employee ID given, the role, team, location, type and manager from the journey (the offer's when
 * the journey has none), joining on Tj. Refusals come back as LifecycleOfferError.
 */
export async function createJoinerAccount(hr: { userId: string }, journey: Journey, account: { workEmail: string; employeeId?: string }, offerFields?: Partial<OfferFields>): Promise<string> {
  const f = offerFields ?? await latestOfferFields(journey.id);
  let userId: string;
  try {
    const employee = await createEmployeeForAdmin(hr.userId, {
      name: journey.candidate?.name, email: account.workEmail, designation: journey.designation ?? f.designation, department: journey.department ?? f.department,
      location: journey.location ?? f.location, employeeType: journey.employeeType ?? f.employeeType, managerUserId: journey.managerUserId ?? f.managerUserId,
      joiningDate: journey.tj ?? f.tj, employeeId: account.employeeId, mobile: journey.candidate?.phone,
    });
    userId = employee.userId;
  } catch (error) {
    if (error instanceof AdminError) throw new LifecycleOfferError(error.statusCode, error.message);
    throw error;
  }
  if (journey.candidate?.personalEmail) await users().updateOne({ userId }, { $set: { personalEmail: journey.candidate.personalEmail } });
  return userId;
}

/** The app account HR made before joining, when it still exists in the company. */
export async function existingAppAccount(journey: Pick<Journey, 'org' | 'appAccess'>): Promise<{ userId: string; email?: string; employeeId?: string } | null> {
  if (!journey.appAccess?.userId) return null;
  return users().findOne({ userId: journey.appAccess.userId, org: journey.org }, { projection: { _id: 0, userId: 1, email: 1, employeeId: 1 } });
}

/**
 * POST …/app-access — `{ employeeId, workEmail }`: saved on the journey (Basic details' checks), then the
 * app account is made as Mark joined makes it. 409 (with `appAccess`) when it already exists. No email
 * goes out: the welcome mail ("from today…") is still sent at Mark joined.
 */
export async function grantAppAccess(hr: { userId: string; name: string }, journey: Journey, input: unknown, now = new Date()): Promise<Journey> {
  assertPreboarding(journey);
  // Making an account is editing employees: a dashboard admin, or someone given that switch in People › Accesses.
  const editor = await users().findOne({ userId: hr.userId, org: journey.org }, { projection: { _id: 0, dashboardAdmin: 1, canEditEmployeeDetails: 1 } });
  if (!mayEditEmployees(editor)) throw new LifecycleOfferError(403, 'You cannot add employees: ask a dashboard admin for “Edit employee details” in People › Accesses');
  const existing = await existingAppAccount(journey);
  if (existing) {
    throw new LifecycleOfferError(409, 'They already have app access', { appAccess: { userId: existing.userId, createdAt: new Date(journey.appAccess!.createdAt).toISOString() } });
  }
  if (!ACCESS_OPEN.has(String(journey.status))) throw new LifecycleOfferError(409, 'App access opens once the offer is accepted');
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const workEmail = text(body.workEmail, 120).toLowerCase();
  if (!EMAIL.test(workEmail)) throw new LifecycleOfferError(400, 'A valid work email is required');
  const employeeId = text(body.employeeId, 40);
  // An account that was removed since: made again.
  const fresh = journey.appAccess ? { ...journey, appAccess: undefined } : journey;
  const saved = await saveBasicDetails(fresh, { workEmail, employeeId }, now);
  const userId = await createJoinerAccount(hr, saved, { workEmail, ...(employeeId ? { employeeId } : {}) });
  const appAccess = { userId, createdAt: now, byUserId: hr.userId, byName: hr.name };
  await journeys().updateOne({ id: journey.id }, { $set: { appAccess, updatedAt: now } });
  return { ...saved, appAccess };
}
