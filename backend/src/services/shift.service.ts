import { ObjectId } from 'mongodb';
import { shiftPolicies, shiftTemplates, users } from '../config/db';
import {
  CORRECTION_TRIGGERS,
  DayMark,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_ORG_SHIFT_POLICY,
  LEAVE_TYPE_KEYS,
  LeaveTypeKey,
  LeaveTypeRule,
  DEFAULT_SHIFT_POLICY,
  OrgShiftPolicy,
  ShiftCorrectionRules,
  ShiftLeaveRules,
  ShiftOvertimeRules,
  ShiftPolicyRules,
  ShiftTemplate,
  PunchFormat,
  PUNCH_FORMATS,
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
    backdateDays: days(source.backdateDays, 'Overtime backdating window', 7),
  };
}

function correctionRules(value: unknown): ShiftCorrectionRules {
  const source = (value ?? {}) as Record<string, unknown>;
  const triggers = strings(source.triggers, [...CORRECTION_TRIGGERS])
    .filter((trigger) => CORRECTION_TRIGGERS.includes(trigger));
  const format = String(source.punchFormat ?? '').trim();
  if (format && !PUNCH_FORMATS.includes(format as PunchFormat)) {
    throw new ShiftError(400, `Punch format must be one of: ${PUNCH_FORMATS.join(', ')}`);
  }
  return {
    triggers,
    punchFormat: (format || 'Present by default (Auto Punch)') as PunchFormat,
    approver: String(source.approver ?? 'Reporting manager').trim() || 'Reporting manager',
    managerWithoutEmployee: flag(source.managerWithoutEmployee, true),
    hrOverride: flag(source.hrOverride, true),
    skipLevel: flag(source.skipLevel, false),
    backdateDays: days(source.backdateDays, 'Backdating window', 7),
  };
}

/** One leave type, validated. Unknown keys are refused rather than stored. */
function leaveType(value: unknown): LeaveTypeRule {
  const source = (value ?? {}) as Record<string, unknown>;
  const key = String(source.key ?? '').trim() as LeaveTypeKey;
  if (!LEAVE_TYPE_KEYS.includes(key)) {
    throw new ShiftError(400, `Leave type must be one of: ${LEAVE_TYPE_KEYS.join(', ')}`);
  }
  const encashment = String(source.encashment ?? 'none').trim();
  if (!['none', 'all', 'limit'].includes(encashment)) {
    throw new ShiftError(400, 'Encashment must be none, all or limit');
  }
  const resetOn = String(source.resetOn ?? 'calendar_year').trim();
  if (!['calendar_year', 'financial_year'].includes(resetOn)) {
    throw new ShiftError(400, 'Balance must reset on the calendar year or the financial year');
  }
  return {
    key,
    name: text(source.name, 'Leave type name', 40),
    // Comp-off is earned by overtime, never accrued, so it has no monthly rate.
    perMonth: key === 'comp_off' ? 0 : hours(source.perMonth, 'Leaves earned per month', 0),
    resetOn: resetOn as LeaveTypeRule['resetOn'],
    carryForwardDays: days(source.carryForwardDays, 'Carry-forward limit', 0),
    encashment: encashment as LeaveTypeRule['encashment'],
    encashLimitDays: days(source.encashLimitDays, 'Encashment limit', 0),
    advanceDays: days(source.advanceDays, 'Advance window', 30),
    allowBackdated: flag(source.allowBackdated, true),
    backdatedDays: days(source.backdatedDays, 'Backdating window', 3),
  };
}

function leaveRules(value: unknown): ShiftLeaveRules {
  const source = (value ?? {}) as Record<string, unknown>;
  const types = Array.isArray(source.types)
    ? source.types.map(leaveType)
    : DEFAULT_LEAVE_TYPES.map((type) => ({ ...type }));
  const seen = new Set(types.map((type) => type.key));
  if (seen.size !== types.length) throw new ShiftError(400, 'Each leave type may appear once');
  return {
    types,
    approver: String(source.approver ?? 'Reporting manager').trim() || 'Reporting manager',
    hrOverride: flag(source.hrOverride, true),
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

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new ShiftError(400, 'Shift ID is invalid');
  return new ObjectId(value);
}

/** Every rule a template can override, validated the same way the org policy is. */
function toPolicyRules(input: Record<string, unknown>, fallback: ShiftPolicyRules): ShiftPolicyRules {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const minHalfDayHours = has('minHalfDayHours')
    ? hours(input.minHalfDayHours, 'Min hours for half day', fallback.minHalfDayHours)
    : fallback.minHalfDayHours;
  const minFullDayHours = has('minFullDayHours')
    ? hours(input.minFullDayHours, 'Min hours for full day', fallback.minFullDayHours)
    : fallback.minFullDayHours;
  if (minFullDayHours < minHalfDayHours) {
    throw new ShiftError(400, 'Min hours for a full day cannot be less than for a half day');
  }
  return {
    startTime: has('startTime') ? time(input.startTime, 'Shift start time') : fallback.startTime,
    endTime: has('endTime') ? time(input.endTime, 'Shift end time') : fallback.endTime,
    minHalfDayHours,
    minFullDayHours,
    lateGraceMinutes: has('lateGraceMinutes') ? minutes(input.lateGraceMinutes, 'Late grace', fallback.lateGraceMinutes) : fallback.lateGraceMinutes,
    earlyOutGraceMinutes: has('earlyOutGraceMinutes') ? minutes(input.earlyOutGraceMinutes, 'Early-out grace', fallback.earlyOutGraceMinutes) : fallback.earlyOutGraceMinutes,
    missingPunchIn: has('missingPunchIn') ? mark(input.missingPunchIn, 'Punch-in missing', fallback.missingPunchIn) : fallback.missingPunchIn,
    missingPunchOut: has('missingPunchOut') ? mark(input.missingPunchOut, 'Punch-out missing', fallback.missingPunchOut) : fallback.missingPunchOut,
    missingBoth: has('missingBoth') ? mark(input.missingBoth, 'Both punches missing', fallback.missingBoth) : fallback.missingBoth,
    weeklyOff: has('weeklyOff') ? weeklyOff(input.weeklyOff) : fallback.weeklyOff,
    overtime: has('overtime') ? overtimeRules(input.overtime) : fallback.overtime,
    correction: has('correction') ? correctionRules(input.correction) : fallback.correction,
    leave: has('leave') ? leaveRules(input.leave) : fallback.leave,
  };
}

/**
 * `fallback` covers templates written before a template carried a policy of its
 * own: they read as the org policy rather than as an undefined one, which is
 * what a client would otherwise have to guess at.
 */
function shiftView(doc: ShiftTemplate & { _id?: ObjectId }, fallback?: ShiftPolicyRules) {
  return {
    id: doc._id!.toHexString(),
    name: doc.name,
    active: doc.active,
    policy: doc.policy ?? fallback ?? { ...DEFAULT_ORG_SHIFT_POLICY },
    assignedUserIds: doc.assignedUserIds ?? [],
    assignedCount: (doc.assignedUserIds ?? []).length,
    createdAt: doc.createdAt?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
  };
}

// ------------------------------------------------------------------ HR admin

export async function listShifts(callerId: string) {
  const org = await requireOrg(callerId);
  const [docs, orgPolicy] = await Promise.all([
    shiftTemplates().find({ org }).sort({ name: 1 }).toArray(),
    getOrgShiftPolicy(org),
  ]);
  return docs.map((doc) => shiftView(doc, orgPolicy));
}

/**
 * A new template starts as a copy of the org policy, so the form opens on
 * something real. Anything the caller sends overrides that copy; anything it
 * omits keeps the org's current value.
 */
export async function createShift(callerId: string, input: ShiftInput) {
  const org = await requireOrg(callerId);
  const name = text(input.name, 'Shift name', MAX_NAME);
  if (await shiftTemplates().findOne({ org, name })) {
    throw new ShiftError(409, 'A shift with that name already exists');
  }
  const orgPolicy = await getOrgShiftPolicy(org);
  const policy = toPolicyRules((input.policy ?? {}) as Record<string, unknown>, orgPolicy);
  const now = new Date();
  const document: Omit<ShiftTemplate, '_id'> = {
    org, name, active: flag(input.active, true), policy, assignedUserIds: [],
    createdAt: now, updatedAt: now,
  };
  const result = await shiftTemplates().insertOne(document);
  return shiftView({ ...document, _id: result.insertedId });
}

/** Edits land on the template alone — the org policy is a different document. */
export async function updateShift(callerId: string, shiftId: string, input: ShiftInput) {
  const org = await requireOrg(callerId);
  const _id = objectId(shiftId);
  const current = await shiftTemplates().findOne({ _id, org });
  if (!current) throw new ShiftError(404, 'Shift not found');
  const name = text(input.name, 'Shift name', MAX_NAME);
  if (await shiftTemplates().findOne({ org, name, _id: { $ne: _id } })) {
    throw new ShiftError(409, 'A shift with that name already exists');
  }
  // A template saved before templates carried a policy edits from the org's.
  const base = current.policy ?? (await getOrgShiftPolicy(org));
  const policy = toPolicyRules((input.policy ?? {}) as Record<string, unknown>, base);
  const updated = await shiftTemplates().findOneAndUpdate(
    { _id, org },
    { $set: { name, active: flag(input.active, current.active), policy, updatedAt: new Date() } },
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
  // Deleting a template silently moves everyone on it back to the org policy,
  // which is a change to how their days are graded — so it has to be deliberate.
  if ((doc.assignedUserIds ?? []).length > 0) {
    throw new ShiftError(
      409,
      `${doc.assignedUserIds.length} employee(s) are on this shift. Unassign them before deleting it.`,
    );
  }
  await shiftTemplates().deleteOne({ _id, org });
}

// ------------------------------------------------------------- assignment

const FACETS = ['locations', 'designations', 'departments', 'managerUserIds'] as const;

function facet(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

/**
 * Who a set of targeting rules selects, and which template each of them is on
 * today — so HR can see whose shift they are about to change before doing it.
 */
export async function resolveShiftAudience(callerId: string, input: Record<string, unknown>) {
  const org = await requireOrg(callerId);
  const rules = Object.fromEntries(FACETS.map((key) => [key, facet(input[key])]));
  const roster = await users().find({ org }).sort({ name: 1 }).toArray();
  const matched = roster.filter((u) => {
    if (rules.locations.length && !rules.locations.includes(u.location ?? '')) return false;
    if (rules.designations.length && !rules.designations.includes(u.designation ?? '')) return false;
    if (rules.departments.length && !rules.departments.includes(u.department ?? '')) return false;
    if (rules.managerUserIds.length && !rules.managerUserIds.includes(u.managerUserId ?? '')) return false;
    return true;
  });

  const templates = await shiftTemplates().find({ org }).toArray();
  const currentByUser = new Map<string, { id: string; name: string }>();
  for (const template of templates) {
    for (const userId of template.assignedUserIds ?? []) {
      currentByUser.set(userId, { id: template._id!.toHexString(), name: template.name });
    }
  }
  const nameById = new Map(roster.map((u) => [u.userId, u.name]));

  return {
    rules,
    members: matched.map((u) => ({
      userId: u.userId,
      name: u.name,
      employeeId: u.employeeId ?? '',
      department: u.department ?? '',
      designation: u.designation ?? '',
      location: u.location ?? '',
      managerName: u.managerUserId ? nameById.get(u.managerUserId) ?? '' : '',
      // Present only when this person is already on a template — the ones whose
      // shift would actually be replaced.
      currentShift: currentByUser.get(u.userId) ?? null,
    })),
  };
}

/**
 * Puts people on a template. An employee follows at most one, so this removes
 * them from any other first — assigning is a move, not an addition.
 */
export async function assignShiftToUsers(callerId: string, shiftId: string, userIds: unknown) {
  const org = await requireOrg(callerId);
  const _id = objectId(shiftId);
  const template = await shiftTemplates().findOne({ _id, org });
  if (!template) throw new ShiftError(404, 'Shift not found');
  const ids = facet(userIds);
  if (!ids.length) throw new ShiftError(400, 'Select at least one employee');
  const known = await users().find({ org, userId: { $in: ids } }).project<{ userId: string }>({ userId: 1 }).toArray();
  const valid = known.map((u) => u.userId);
  if (valid.length !== ids.length) {
    throw new ShiftError(400, 'Some of those employees are not in this organisation');
  }
  await shiftTemplates().updateMany(
    { org, _id: { $ne: _id } },
    { $pull: { assignedUserIds: { $in: valid } } } as never,
  );
  const updated = await shiftTemplates().findOneAndUpdate(
    { _id, org },
    { $addToSet: { assignedUserIds: { $each: valid } }, $set: { updatedAt: new Date() } } as never,
    { returnDocument: 'after' },
  );
  return shiftView(updated!);
}

/** Takes people off a template, returning them to the org policy. */
export async function unassignShiftUsers(callerId: string, shiftId: string, userIds: unknown) {
  const org = await requireOrg(callerId);
  const _id = objectId(shiftId);
  const ids = facet(userIds);
  const updated = await shiftTemplates().findOneAndUpdate(
    { _id, org },
    { $pull: { assignedUserIds: { $in: ids } }, $set: { updatedAt: new Date() } } as never,
    { returnDocument: 'after' },
  );
  if (!updated) throw new ShiftError(404, 'Shift not found');
  return shiftView(updated);
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
    startTime: has('startTime') ? time(input.startTime, 'Shift start time') : current.startTime,
    endTime: has('endTime') ? time(input.endTime, 'Shift end time') : current.endTime,
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
  /** Week of the month ("1".."5") -> weekday indexes off, 0 = Mon .. 6 = Sun. */
  weeklyOff: Record<string, number[]>;
  minHalfDayHours: number;
  minFullDayHours: number;
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
};

/**
 * What the app grades this employee's day against — their template's policy if
 * they are on one, otherwise the org policy.
 */
export async function shiftPolicyFor(userId: string): Promise<ShiftPolicyView> {
  const policy = await policyForUser(userId);
  return {
    name: policy.shiftName ?? DEFAULT_SHIFT_POLICY.name,
    startTime: policy.startTime,
    endTime: policy.endTime,
    minHalfDayHours: policy.minHalfDayHours,
    minFullDayHours: policy.minFullDayHours,
    lateGraceMinutes: policy.lateGraceMinutes,
    earlyOutGraceMinutes: policy.earlyOutGraceMinutes,
    weeklyOff: policy.weeklyOff,
  };
}

/**
 * Whether a date is a weekly off, per the grid HR set under Shifts › Policies.
 *
 * The grid is per week of the month, so the 2nd Saturday can be off while the
 * 1st is not. Weeks are counted from the 1st in blocks of seven; a 5th block
 * covers the tail of a long month. Weekday indexes are 0 = Mon .. 6 = Sun,
 * which is the order the dashboard's grid is drawn in.
 */
export function isWeekOffDay(date: Date, weeklyOff: Record<string, number[]>): boolean {
  const week = Math.min(5, Math.floor((date.getUTCDate() - 1) / 7) + 1);
  const weekday = (date.getUTCDay() + 6) % 7;
  return (weeklyOff?.[String(week)] ?? []).includes(weekday);
}

/**
 * The policy that actually governs one employee.
 *
 * A template assigned to them overrides the org policy wholesale; everyone else
 * follows the org policy. This is the only place that decision is made, so the
 * app, leave counting, overtime and approvals cannot disagree about it.
 */
export async function policyForUser(userId: string): Promise<ShiftPolicyRules & { shiftName: string | null }> {
  const user = await users().findOne({ userId });
  if (!user?.org) return { ...DEFAULT_ORG_SHIFT_POLICY, shiftName: null };
  const template = await shiftTemplates().findOne({ org: user.org, active: true, assignedUserIds: userId });
  // A template with no policy of its own is not an override of anything.
  if (template?.policy) return { ...template.policy, shiftName: template.name };
  return { ...(await getOrgShiftPolicy(user.org)), shiftName: null };
}

/**
 * Who may decide a request, per the approval flow HR configured.
 *
 * `approver` names who signs off. A reporting manager cannot decide something
 * HR has taken ownership of, and HR cannot override a manager's call unless the
 * org allows it — HR deciding is not an override when HR is the named approver,
 * so that case stays open regardless of the switch.
 */
export type DecisionKind = 'leave' | 'correction';

export async function approvalRulesFor(userId: string, kind: DecisionKind) {
  const policy = await policyForUser(userId);
  return kind === 'leave'
    ? { approver: policy.leave.approver, hrOverride: policy.leave.hrOverride }
    : { approver: policy.correction.approver, hrOverride: policy.correction.hrOverride };
}

/** A manager signs off unless HR alone is the named approver. */
export function managerMayDecide(approver: string): boolean {
  return approver.trim() !== 'HR';
}

/** HR signs off when it is named as an approver, or when override is allowed. */
export function hrMayDecide(approver: string, hrOverride: boolean): boolean {
  const named = approver.trim();
  return named === 'HR' || named.toLowerCase().includes('then hr') || hrOverride;
}

/** The hours that make a full day for this employee. */
export async function fullDayHoursFor(userId: string): Promise<number> {
  return (await policyForUser(userId)).minFullDayHours;
}

/** The leave types this employee accrues, for the balance and the apply flow. */
export async function leaveTypeRulesFor(userId: string): Promise<LeaveTypeRule[]> {
  return (await policyForUser(userId)).leave.types;
}

/** The week-off grid this employee works to. */
export async function weekOffGridFor(userId: string): Promise<Record<string, number[]>> {
  return (await policyForUser(userId)).weeklyOff;
}


