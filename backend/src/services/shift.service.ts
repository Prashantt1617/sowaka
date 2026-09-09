import { ObjectId } from 'mongodb';
import { shiftPolicies, shiftTemplates, users } from '../config/db';
import {
  DayMark,
  DEFAULT_ORG_SHIFT_POLICY,
  DEFAULT_SHIFT_POLICY,
  OrgShiftPolicy,
  ShiftCorrectionRules,
  ShiftLeaveRules,
  ShiftOvertimeRules,
  ShiftTemplate,
} from '../models/shift.model';

export class ShiftError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_NAME = 60;
const DAY_MARKS: DayMark[] = ['Absent', 'Half Day', 'Present', 'Pending Regularisation'];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The caller's org. Every read and write below is scoped to it. */
async function requireOrg(callerId: string): Promise<string> {
  const caller = await users().findOne({ userId: callerId });
  if (!caller) throw new ShiftError(404, 'User not found');
  if (!caller.org) throw new ShiftError(409, 'User is not attached to a company');
  return caller.org;
}

function text(value: unknown, field: string, max: number): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new ShiftError(400, `${field} is required`);
  if (trimmed.length > max) throw new ShiftError(400, `${field} cannot exceed ${max} characters`);
  return trimmed;
}

function time(value: unknown, field: string): string {
  const trimmed = String(value ?? '').trim();
  if (!TIME_PATTERN.test(trimmed)) throw new ShiftError(400, `${field} must be a time like 09:30`);
  return trimmed;
}

/** Hours accept a half — a 4.5h half-day threshold is ordinary. */
function hours(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
    throw new ShiftError(400, `${field} must be between 0 and 24 hours`);
  }
  return Math.round(parsed * 2) / 2;
}

function minutes(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 240) {
    throw new ShiftError(400, `${field} must be a whole number of minutes, up to 240`);
  }
  return parsed;
}

function mark(value: unknown, field: string, fallback: DayMark): DayMark {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return fallback;
  if (!DAY_MARKS.includes(trimmed as DayMark)) {
    throw new ShiftError(400, `${field} must be one of: ${DAY_MARKS.join(', ')}`);
  }
  return trimmed as DayMark;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strings(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

/** Week of month (1-5) -> weekday indexes (0 = Mon .. 6 = Sun) that are off. */
function weeklyOff(value: unknown): Record<string, number[]> {
  const source = (value ?? {}) as Record<string, unknown>;
  const grid: Record<string, number[]> = {};
  for (const week of ['1', '2', '3', '4', '5']) {
    const days = Array.isArray(source[week]) ? (source[week] as unknown[]) : [];
    grid[week] = [
      ...new Set(
        days
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      ),
    ].sort((a, b) => a - b);
  }
  return grid;
}

function overtimeRules(value: unknown): ShiftOvertimeRules {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    eligible: flag(source.eligible, true),
    onHoliday: flag(source.onHoliday, true),
    onWeeklyOff: flag(source.onWeeklyOff, true),
    beyondShift: flag(source.beyondShift, false),
    beyondShiftHours: hours(source.beyondShiftHours, 'Overtime beyond shift hours', 1),
  };
}

function correctionRules(value: unknown): ShiftCorrectionRules {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    triggers: strings(source.triggers, ['Missing punch', 'Half day']),
    approver: String(source.approver ?? 'Reporting manager').trim() || 'Reporting manager',
    reasons: strings(source.reasons, []),
    managerWithoutEmployee: flag(source.managerWithoutEmployee, true),
    hrOverride: flag(source.hrOverride, true),
    skipLevel: flag(source.skipLevel, false),
    backdateByEmployee: flag(source.backdateByEmployee, true),
    backdateByManager: flag(source.backdateByManager, true),
    backdateDays: days(source.backdateDays, 'Backdating window', 7),
  };
}

function leaveRules(value: unknown): ShiftLeaveRules {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    advanceDays: days(source.advanceDays, 'Advance leave window', 30),
    allowBackdated: flag(source.allowBackdated, true),
    backdatedDays: days(source.backdatedDays, 'Backdated leave window', 3),
    approver: String(source.approver ?? 'Reporting manager').trim() || 'Reporting manager',
    managerOnBehalf: flag(source.managerOnBehalf, false),
    hrOverride: flag(source.hrOverride, true),
    skipLevel: flag(source.skipLevel, false),
  };
}

function days(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
    throw new ShiftError(400, `${field} must be a whole number of days, up to 365`);
  }
  return parsed;
}

type ShiftInput = Record<string, unknown>;

/**
 * A template is its name, its working window and whether it is the default.
 * Every rule it is graded by comes from the org policy, so there is nothing
 * here to keep in step with Shifts › Policies.
 */
function toDocument(input: ShiftInput, org: string) {
  return {
    org,
    name: text(input.name, 'Shift name', MAX_NAME),
    active: flag(input.active, true),
    startTime: time(input.startTime, 'Shift start time'),
    endTime: time(input.endTime, 'Shift end time'),
    isDefault: flag(input.isDefault, false),
  };
}

/**
 * Named field by field rather than spread, so a document written before the
 * rules moved to the org policy cannot leak a stale threshold back to a client
 * that would then disagree with Shifts › Policies.
 */
function shiftView(doc: ShiftTemplate & { _id?: ObjectId }) {
  return {
    id: doc._id!.toHexString(),
    name: doc.name,
    active: doc.active,
    startTime: doc.startTime,
    endTime: doc.endTime,
    isDefault: doc.isDefault,
    createdAt: doc.createdAt?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
  };
}

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new ShiftError(400, 'Shift ID is invalid');
  return new ObjectId(value);
}

// ------------------------------------------------------------------ HR admin

export async function listShifts(callerId: string) {
  const org = await requireOrg(callerId);
  const docs = await shiftTemplates()
    .find({ org })
    .sort({ isDefault: -1, name: 1 })
    .toArray();
  return docs.map(shiftView);
}

export async function createShift(callerId: string, input: ShiftInput) {
  const org = await requireOrg(callerId);
  const document = toDocument(input, org);
  const existing = await shiftTemplates().findOne({ org, name: document.name });
  if (existing) throw new ShiftError(409, 'A shift with that name already exists');
  // The org's first shift becomes the default, so the app has something to
  // grade against the moment HR saves once.
  const count = await shiftTemplates().countDocuments({ org });
  const isDefault = count === 0 ? true : document.isDefault;
  if (isDefault) await shiftTemplates().updateMany({ org }, { $set: { isDefault: false } });
  const now = new Date();
  const result = await shiftTemplates().insertOne({
    ...document,
    isDefault,
    createdAt: now,
    updatedAt: now,
  });
  return shiftView({ ...document, isDefault, createdAt: now, updatedAt: now, _id: result.insertedId });
}

export async function updateShift(callerId: string, shiftId: string, input: ShiftInput) {
  const org = await requireOrg(callerId);
  const _id = objectId(shiftId);
  const document = toDocument(input, org);
  const clash = await shiftTemplates().findOne({ org, name: document.name, _id: { $ne: _id } });
  if (clash) throw new ShiftError(409, 'A shift with that name already exists');
  if (document.isDefault) {
    await shiftTemplates().updateMany({ org, _id: { $ne: _id } }, { $set: { isDefault: false } });
  }
  const updated = await shiftTemplates().findOneAndUpdate(
    { _id, org },
    { $set: { ...document, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ShiftError(404, 'Shift not found');
  return shiftView(updated);
}

export async function deleteShift(callerId: string, shiftId: string) {
  const org = await requireOrg(callerId);
  const _id = objectId(shiftId);
  const doc = await shiftTemplates().findOne({ _id, org });
  if (!doc) throw new ShiftError(404, 'Shift not found');
  // Deleting the default would leave the app grading against the built-in
  // fallback without anyone having chosen that, so it has to be handed over.
  if (doc.isDefault) {
    const others = await shiftTemplates().countDocuments({ org, _id: { $ne: _id } });
    if (others > 0) {
      throw new ShiftError(409, 'Make another shift the default before deleting this one');
    }
  }
  await shiftTemplates().deleteOne({ _id, org });
}

// -------------------------------------------------- the org-wide shift policy

/**
 * The org's policy, or the documented defaults if it has never been saved.
 * Every tab under Shifts › Policies reads and writes this one document.
 */
export async function getOrgShiftPolicy(org: string): Promise<Omit<OrgShiftPolicy, 'org' | '_id'>> {
  const doc = await shiftPolicies().findOne({ org });
  if (!doc) return { ...DEFAULT_ORG_SHIFT_POLICY, updatedAt: new Date(0) };
  // Merged over the defaults so a policy saved before a field existed still
  // answers for it, rather than handing the app an undefined threshold.
  return {
    ...DEFAULT_ORG_SHIFT_POLICY,
    ...doc,
    overtime: { ...DEFAULT_ORG_SHIFT_POLICY.overtime, ...(doc.overtime ?? {}) },
    correction: { ...DEFAULT_ORG_SHIFT_POLICY.correction, ...(doc.correction ?? {}) },
    leave: { ...DEFAULT_ORG_SHIFT_POLICY.leave, ...(doc.leave ?? {}) },
  };
}

export async function readOrgShiftPolicy(callerId: string) {
  return getOrgShiftPolicy(await requireOrg(callerId));
}

/**
 * Saves one tab's worth of the policy.
 *
 * Each policy tab has its own Save button, so a patch carries only the fields
 * that tab owns; anything absent keeps the value it already had. Validation
 * runs over what was actually sent.
 */
export async function saveOrgShiftPolicy(callerId: string, input: ShiftInput) {
  const org = await requireOrg(callerId);
  const current = await getOrgShiftPolicy(org);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  const minHalfDayHours = has('minHalfDayHours')
    ? hours(input.minHalfDayHours, 'Min hours for half day', current.minHalfDayHours)
    : current.minHalfDayHours;
  const minFullDayHours = has('minFullDayHours')
    ? hours(input.minFullDayHours, 'Min hours for full day', current.minFullDayHours)
    : current.minFullDayHours;
  if (minFullDayHours < minHalfDayHours) {
    throw new ShiftError(400, 'Min hours for a full day cannot be less than for a half day');
  }

  const next: Omit<OrgShiftPolicy, '_id' | 'org'> = {
    missingPunchIn: has('missingPunchIn') ? mark(input.missingPunchIn, 'Punch-in missing', current.missingPunchIn) : current.missingPunchIn,
    missingPunchOut: has('missingPunchOut') ? mark(input.missingPunchOut, 'Punch-out missing', current.missingPunchOut) : current.missingPunchOut,
    missingBoth: has('missingBoth') ? mark(input.missingBoth, 'Both punches missing', current.missingBoth) : current.missingBoth,
    weeklyOff: has('weeklyOff') ? weeklyOff(input.weeklyOff) : current.weeklyOff,
    minHalfDayHours,
    minFullDayHours,
    lateGraceMinutes: has('lateGraceMinutes') ? minutes(input.lateGraceMinutes, 'Late grace', current.lateGraceMinutes) : current.lateGraceMinutes,
    earlyOutGraceMinutes: has('earlyOutGraceMinutes') ? minutes(input.earlyOutGraceMinutes, 'Early-out grace', current.earlyOutGraceMinutes) : current.earlyOutGraceMinutes,
    overtime: has('overtime') ? overtimeRules(input.overtime) : current.overtime,
    correction: has('correction') ? correctionRules(input.correction) : current.correction,
    leave: has('leave') ? leaveRules(input.leave) : current.leave,
    updatedAt: new Date(),
    updatedByUserId: callerId,
  };

  await shiftPolicies().updateOne({ org }, { $set: { org, ...next } }, { upsert: true });
  return next;
}

// ------------------------------------------------------------- what the app reads

export type ShiftPolicyView = {
  name: string;
  startTime: string;
  endTime: string;
  minHalfDayHours: number;
  minFullDayHours: number;
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
};

/**
 * What the app grades an employee's day against.
 *
 * The thresholds and the grace come from the org policy HR fills in under
 * Shifts › Policies — that is where the setup lives. Only the working window
 * comes from the shift template, since a template is what says when the shift
 * opens and closes. There is no per-employee shift assignment yet, so everyone
 * is on the org's default template; when assignment arrives, only the template
 * lookup below changes.
 */
export async function shiftPolicyFor(org: string | undefined): Promise<ShiftPolicyView> {
  if (!org) return { ...DEFAULT_SHIFT_POLICY };
  const [policy, template] = await Promise.all([
    getOrgShiftPolicy(org),
    shiftTemplates().find({ org, active: true }).sort({ isDefault: -1, name: 1 }).limit(1).next(),
  ]);
  return {
    name: template?.name ?? DEFAULT_SHIFT_POLICY.name,
    startTime: template?.startTime ?? DEFAULT_SHIFT_POLICY.startTime,
    endTime: template?.endTime ?? DEFAULT_SHIFT_POLICY.endTime,
    minHalfDayHours: policy.minHalfDayHours,
    minFullDayHours: policy.minFullDayHours,
    lateGraceMinutes: policy.lateGraceMinutes,
    earlyOutGraceMinutes: policy.earlyOutGraceMinutes,
  };
}

/** The same policy, for a user id — used by the attendance endpoints. */
export async function shiftPolicyForUser(userId: string): Promise<ShiftPolicyView> {
  const user = await users().findOne({ userId });
  return shiftPolicyFor(user?.org);
}
