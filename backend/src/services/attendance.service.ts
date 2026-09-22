import { ObjectId } from 'mongodb';
import { attendanceRecords, attendanceRegularizations, offices, users } from '../config/db';
import { PunchLocation } from '../models/office.model';
import { locateForPunch, officeView, punchLocationFrom } from './geofence.service';
import {
  AttendanceRegularization,
  REGULARIZATION_DAY_TYPES,
  RegularizationDayType,
  RegularizationStatus,
} from '../models/attendance.model';
import { approvalRulesFor, isWeekOffDay, managerMayDecide, policyForUser } from './shift.service';
import { DayMark, HALF_DAY_CORRECTION_OUTCOMES, ShiftPolicyRules } from '../models/shift.model';
import { holidayDatesForUser } from './holiday.service';
import {
  notifyCorrectionDecided, notifyCorrectionSubmitted, notifyPunchedIn, notifyPunchedOut,
} from './request-notifications.service';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decisions = new Set<RegularizationStatus>(['approved', 'declined']);

export async function getMyAttendance(userId: string, fromInput: string, toInput: string) {
  const employee = await users().findOne({ userId });
  if (!employee) throw new AttendanceError(404, 'Employee not found');
  return getAttendanceForEmployee(userId, employee.employeeId, fromInput, toInput);
}

// Split out so callers that already have the employee record (e.g.
// `getTeamMemberAttendance`, which fetches it for the manager-authorization
// check) don't pay for a second `users().findOne` — each `users` lookup on
// this cluster runs noticeably slower than the attendance collections'.
async function getAttendanceForEmployee(
  userId: string,
  employeeId: string | undefined,
  fromInput: string,
  toInput: string,
) {
  const from = parseDate(fromInput, 'from');
  const to = parseDate(toInput, 'to');
  if (to < from) throw new AttendanceError(400, 'to cannot be before from');
  if (daysBetween(from, to) > 92) throw new AttendanceError(400, 'Date range cannot exceed 93 days');

  const recordFilter = employeeId
    ? { $or: [{ userId }, { employeeId }], workDate: { $gte: fromInput, $lte: toInput } }
    : { userId, workDate: { $gte: fromInput, $lte: toInput } };
  const [records, regularizations] = await Promise.all([
    attendanceRecords().find(recordFilter).sort({ workDate: 1 }).toArray(),
    attendanceRegularizations()
      .find({ userId, workDate: { $gte: fromInput, $lte: toInput } })
      .sort({ createdAt: -1 }).toArray(),
  ]);
  return {
    records: records.map((item) => ({
      id: item._id?.toHexString(), workDate: item.workDate,
      punchIn: item.punchIn?.toISOString(), punchOut: item.punchOut?.toISOString(),
      dayType: item.dayType,
    })),
    regularizations: regularizations.map(toRegularizationView),
  };
}

export type PunchReading = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  mocked?: boolean;
};

/**
 * Punches someone in or out, having first checked they are where they say.
 *
 * The reading is raw: the app reports coordinates and this decides whether
 * they fall inside an office. Letting the app decide and send a yes/no would
 * put attendance behind a check anyone could skip by calling the endpoint
 * directly — so the app never sends a verdict, only what the device saw.
 *
 * An org with no offices configured is not geofenced at all, and punches as it
 * always did. That is how this ships before the coordinates are known.
 */
export async function recordPunch(
  userId: string,
  type: string,
  reading?: PunchReading,
) {
  if (type !== 'in' && type !== 'out') throw new AttendanceError(400, 'type must be in or out');
  const employee = await users().findOne({ userId });
  if (!employee?.employeeId) throw new AttendanceError(409, 'Employee ID is not configured');

  let location: PunchLocation | undefined;
  const org = employee.org ?? '';
  // Only a geotagged shift is checked against an office. In-app punch-in is the
  // same punch without the location question — HR chooses it for people whose
  // work is not tied to a building — so asking them for a fix would refuse a
  // punch their own policy says needs none.
  const policy = await policyForUser(userId);
  const geofenced = policy.correction.punchFormat === 'Geotag (powered by Sowaka)';
  const sites = geofenced && org ? await offices().countDocuments({ org, active: true }) : 0;
  if (sites > 0) {
    if (!reading) {
      throw new AttendanceError(
        428,
        'Location is required to punch. Turn location on and try again.',
      );
    }
    const verdict = await locateForPunch(org, reading);
    location = punchLocationFrom(reading, verdict);
    // Nobody marks their own day present from outside the fence. Working
    // elsewhere — from home, at a client site — is a claim about the day that
    // the manager settles, raised as a request from the punch screen, so it is
    // refused here whatever the reason.
    if (!verdict.inside) {
      throw new AttendanceError(
        409,
        verdict.reason === 'inaccurate'
          ? 'Your location is not precise enough yet. Move near a window and try again.'
          : 'You are outside the approved attendance area.',
        { location, office: verdict.office ? officeView(verdict.office) : undefined },
      );
    }
  }
  const now = new Date();
  const workDate = now.toISOString().slice(0, 10);
  const existing = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });

  if (type === 'in') {
    if (existing?.punchIn) throw new AttendanceError(409, 'Already punched in today');
    await attendanceRecords().updateOne(
      { employeeId: employee.employeeId, workDate },
      {
        $set: {
          employeeId: employee.employeeId,
          userId,
          workDate,
          punchIn: now,
          updatedAt: now,
          ...(location ? { punchInLocation: location } : {}),
        },
        $setOnInsert: { source: 'manual', sourceKey: `manual|${employee.employeeId}|${workDate}`, importedAt: now },
      },
      { upsert: true },
    );
  } else {
    if (!existing?.punchIn) throw new AttendanceError(409, 'Punch in before punching out');
    if (existing?.punchOut) throw new AttendanceError(409, 'Already punched out today');
    await attendanceRecords().updateOne(
      { employeeId: employee.employeeId, workDate },
      {
        $set: {
          punchOut: now,
          updatedAt: now,
          ...(location ? { punchOutLocation: location } : {}),
        },
      },
    );
  }

  const updated = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });
  if (type === 'in') {
    await notifyPunchedIn(userId, now);
  } else if (updated?.punchIn && updated?.punchOut) {
    // Grade the day the way the app does, so the message agrees with the
    // calendar the employee is about to open.
    const worked = (updated.punchOut.getTime() - updated.punchIn.getTime()) / 60_000;
    const band = worked >= policy.minFullDayHours * 60
      ? 'full'
      : worked >= policy.minHalfDayHours * 60
        ? 'half'
        : 'short';
    await notifyPunchedOut(userId, now, worked, band);
  }
  return {
    workDate,
    punchIn: updated?.punchIn?.toISOString(),
    punchOut: updated?.punchOut?.toISOString(),
    office: location?.officeName,
  };
}

/**
 * Whether a date is a day this employee was not due to work — their shift's
 * week-off grid, or one of their location's company holidays.
 */
async function isNonWorkingDay(
  weeklyOff: Record<string, number[]>,
  employee: { org?: string } & Record<string, unknown>,
  date: Date,
): Promise<boolean> {
  if (isWeekOffDay(date, weeklyOff)) return true;
  const holidays = await holidayDatesForUser(employee as never);
  return holidays.has(date.toISOString().slice(0, 10));
}

/**
 * Which of the four correction cases a day falls into, named exactly as the
 * Attendance correction page names them, so the policy's list can be checked
 * against it directly.
 */
export function correctionTriggerFor(punchIn: Date | null, punchOut: Date | null): string {
  if (punchIn && punchOut) return 'Both punches present';
  if (!punchIn && !punchOut) return 'Both punches missing';
  return punchIn ? 'Missing punch-out' : 'Missing punch-in';
}

/** How a day type reads back to the person who asked for it. */
const DAY_TYPE_LABELS: Record<string, string> = {
  full_day: 'Full day',
  half_day: 'Half day',
  leave: 'Leave',
  wfh: 'Work from home',
  client_visit: 'Client visit',
  office_visit: 'Client visit',
};

/**
 * What a day is currently marked as, graded exactly the way the calendar
 * grades it: a complete day on the hours worked, an incomplete one on the mark
 * HR chose for that kind of gap.
 */
export function markForDay(
  policy: Pick<
    ShiftPolicyRules,
    | 'minFullDayHours'
    | 'minHalfDayHours'
    | 'missingPunchIn'
    | 'missingPunchOut'
    | 'missingBoth'
    | 'correction'
  >,
  punchIn: Date | null,
  punchOut: Date | null,
): DayMark {
  // One punch makes the day where that is all the policy asks for: there is no
  // punch-out to be missing, and no hours to grade it by.
  if (policy.correction?.punchMode === 'Single punch') {
    return punchIn ? 'Present' : policy.missingBoth;
  }
  if (punchIn && punchOut) {
    const worked = (punchOut.getTime() - punchIn.getTime()) / 3_600_000;
    if (worked >= policy.minFullDayHours) return 'Present';
    // Anything under a half day is still short of a full one, and a short day
    // is argued the same way a half day is.
    return 'Half Day';
  }
  if (!punchIn && !punchOut) return policy.missingBoth;
  return punchIn ? policy.missingPunchOut : policy.missingPunchIn;
}

/** The day types HR's outcome names correspond to. */
const OUTCOME_DAY_TYPES: Record<string, RegularizationDayType> = {
  'Full day': 'full_day',
  'Half day': 'half_day',
  Leave: 'leave',
};

/**
 * What this day may be asked to become.
 *
 * A half day has exactly one answer — a full day — and it is not HR's to
 * change: there is nothing else a half day could be disputed as. An absent day
 * is the configurable one, since the reason it was absent decides whether it
 * should become a worked day or count against leave. A day already marked
 * present can only be argued down, so a full day is not on offer.
 */
export function correctionOutcomesFor(
  mark: DayMark,
  absentOutcomes: string[],
): RegularizationDayType[] {
  const allowed =
    mark === 'Half Day'
      ? HALF_DAY_CORRECTION_OUTCOMES
      : mark === 'Absent'
        ? absentOutcomes
        : absentOutcomes.filter((outcome) => outcome !== 'Full day');
  return allowed
    .map((outcome) => OUTCOME_DAY_TYPES[outcome])
    .filter((dayType): dayType is RegularizationDayType => Boolean(dayType));
}

/**
 * Raise a correction for a day.
 *
 * Current clients say what the day *should be* — a day type a manager can
 * actually vouch for. Versions already on the stores instead send the punch
 * times the person believed they worked, and know nothing about day types, so
 * those are still accepted and stored in the deprecated punch fields. One
 * backend serves both: a request carrying neither is the only one refused.
 */
export async function requestRegularization(
  userId: string,
  input: {
    workDate?: string;
    dayType?: string;
    note?: string;
    /** @deprecated Sent by app versions that predate day types. */
    punchIn?: string;
    /** @deprecated */
    punchOut?: string;
  },
) {
  const workDate = input.workDate ?? '';
  const date = parseDate(workDate, 'workDate');
  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);
  if (workDate > todayText) throw new AttendanceError(400, 'Future dates cannot be regularized');
  // Both limits come from the policy HR saved — how far back a correction may
  // reach, and which of the four day outcomes may be corrected at all.
  const policy = await policyForUser(userId);
  const correction = policy.correction;
  if (daysBetween(date, new Date(`${todayText}T00:00:00.000Z`)) > correction.backdateDays) {
    throw new AttendanceError(
      400,
      `Regularization can be raised up to ${correction.backdateDays} days back`,
    );
  }
  const requestedDayType = (input.dayType ?? '').trim() as RegularizationDayType;
  const legacyPunchIn = parsePunch(input.punchIn, 'punchIn');
  const legacyPunchOut = parsePunch(input.punchOut, 'punchOut');
  const hasDayType = REGULARIZATION_DAY_TYPES.includes(requestedDayType);
  if (!hasDayType) {
    // An older client sends punch times and no day type. Refuse only when it
    // sent neither — an empty request is a bug on any version.
    if (!legacyPunchIn && !legacyPunchOut) {
      throw new AttendanceError(400, 'Choose what this day should be');
    }
    if (input.dayType?.trim()) {
      throw new AttendanceError(400, 'Choose what this day should be');
    }
    if (legacyPunchIn && legacyPunchOut && legacyPunchOut <= legacyPunchIn) {
      throw new AttendanceError(400, 'Punch-out must be after punch-in');
    }
  }
  const note = (input.note ?? '').trim();
  if (note.length > 500) throw new AttendanceError(400, 'Note cannot exceed 500 characters');

  const employee = await users().findOne({ userId });
  if (!employee?.employeeId) throw new AttendanceError(409, 'Employee ID is not configured');
  if (!employee.managerUserId) throw new AttendanceError(409, 'A manager must be assigned');
  // Nothing to correct on a day nobody was due to work: a week-off or a
  // company holiday that was worked is an overtime claim, not a correction.
  if (await isNonWorkingDay(policy.weeklyOff, employee, date)) {
    throw new AttendanceError(
      400,
      'This day is a week-off or a company holiday — claim overtime instead',
    );
  }
  // What the day actually looks like decides whether it can be corrected: HR
  // switches each of the four outcomes on or off under Attendance correction.
  const record = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });
  const trigger =
    correction.punchMode === 'Single punch'
      ? record?.punchIn
        ? 'Both punches present'
        : 'Both punches missing'
      : correctionTriggerFor(record?.punchIn ?? null, record?.punchOut ?? null);
  if (!correction.triggers.includes(trigger)) {
    throw new AttendanceError(
      400,
      `${trigger} cannot be regularized — your company does not allow a correction for this case`,
    );
  }
  // What the day is marked as decides what it may be asked to become. Without
  // this the app's choices were advisory: a request for anything at all went
  // through, whatever HR had allowed.
  if (hasDayType) {
    const mark = markForDay(policy, record?.punchIn ?? null, record?.punchOut ?? null);
    const allowed = correctionOutcomesFor(mark, policy.correction.absentOutcomes ?? []);
    // A claim about where the day was worked is always permitted.
    // Where the day was worked, rather than what it counts as, so these sit
    // outside HR's outcome list — a manager vouches for them either way.
    const aboutPlace =
      requestedDayType === 'wfh' ||
      requestedDayType === 'client_visit' ||
      requestedDayType === 'office_visit';
    if (!aboutPlace && !allowed.includes(requestedDayType)) {
      throw new AttendanceError(
        400,
        allowed.length === 0
          ? 'Your company does not allow this day to be changed'
          : `This day can only be raised as: ${allowed
              .map((dayType) => DAY_TYPE_LABELS[dayType] ?? dayType)
              .join(', ')}`,
      );
    }
  }
  const pending = await attendanceRegularizations().findOne({ userId, workDate, status: 'pending' });
  if (pending) throw new AttendanceError(409, 'A regularization request is already pending for this date');
  const createdAt = new Date();
  // Whichever shape the request arrived in is what gets stored: a day type, or
  // the punch times an older client asked for. Never both.
  const requested = hasDayType
    ? { requestedDayType }
    : { punchIn: legacyPunchIn, punchOut: legacyPunchOut };
  const result = await attendanceRegularizations().insertOne({
    userId, employeeId: employee.employeeId, managerUserId: employee.managerUserId,
    workDate, ...requested, note, status: 'pending', createdAt,
  });
  await notifyCorrectionSubmitted({ employeeUserId: userId, workDate, reason: note });
  return toRegularizationView({
    _id: result.insertedId, userId, employeeId: employee.employeeId,
    managerUserId: employee.managerUserId, workDate, ...requested, note,
    status: 'pending', createdAt,
  });
}

export async function getTeamMemberAttendance(
  managerUserId: string,
  employeeUserId: string,
  fromInput: string,
  toInput: string,
) {
  const employee = await users().findOne({ userId: employeeUserId });
  if (!employee) throw new AttendanceError(404, 'Employee not found');
  if (employee.managerUserId !== managerUserId) {
    throw new AttendanceError(403, "Not authorized to view this employee's attendance");
  }
  const attendance = await getAttendanceForEmployee(
    employeeUserId,
    employee.employeeId,
    fromInput,
    toInput,
  );
  // The employee's own shift decides how their days read, and they may be on a
  // different template from the manager looking at them — someone on a
  // single-punch shift has no punch-out for this view to leave blank.
  const policy = await policyForUser(employeeUserId);
  return {
    ...attendance,
    singlePunch: policy.correction.punchMode === 'Single punch',
  };
}

export async function getManagerRegularizations(managerUserId: string) {
  const values = await attendanceRegularizations()
    .find({ managerUserId }).sort({ createdAt: -1 }).toArray();
  return enrichRegularizations(values);
}

export async function decideRegularization(
  managerUserId: string, id: string, input: { decision?: string; managerNote?: string },
) {
  if (!ObjectId.isValid(id)) throw new AttendanceError(400, 'Invalid request ID');
  const decision = (input.decision ?? '').trim() as RegularizationStatus;
  if (!decisions.has(decision)) throw new AttendanceError(400, 'Decision must be approved or declined');
  const managerNote = (input.managerNote ?? '').trim();
  if (managerNote.length > 500) throw new AttendanceError(400, 'Manager note cannot exceed 500 characters');
  // Who signs off a correction is decided by the policy that governs this
  // employee — their shift template's, or the org's.
  const pending = await attendanceRegularizations().findOne({ _id: new ObjectId(id) });
  if (pending) {
    const rules = await approvalRulesFor(pending.userId, 'correction');
    if (!managerMayDecide(rules.approver)) {
      throw new AttendanceError(
        403,
        `Attendance corrections are approved by ${rules.approver}, not by the reporting manager`,
      );
    }
  }

  const decidedAt = new Date();
  const result = await attendanceRegularizations().findOneAndUpdate(
    { _id: new ObjectId(id), managerUserId, status: 'pending' },
    { $set: { status: decision, managerNote, decidedAt, decidedByUserId: managerUserId } },
    { returnDocument: 'after' },
  );
  if (!result) throw new AttendanceError(404, 'Pending regularization request not found');

  if (decision === 'approved') {
    // Fold the decision into the canonical attendance record so the employee's
    // calendar reflects what was approved, not just the request. Corrections
    // raised before day types still carry punch times, so both are applied.
    const punchUpdate: Record<string, Date | RegularizationDayType> = { updatedAt: decidedAt };
    if (result.requestedDayType) {
      punchUpdate.dayType = result.requestedDayType;
      // An approved day is a worked day, so it gets the shift's own hours
      // rather than staying blank: the calendar showed "-" against a day the
      // manager had just confirmed was worked.
      const shift = await policyForUser(result.userId);
      const window = punchWindowFor(result.requestedDayType, result.workDate, shift);
      if (window) {
        punchUpdate.punchIn = window.punchIn;
        punchUpdate.punchOut = window.punchOut;
      }
    }
    if (result.punchIn) punchUpdate.punchIn = result.punchIn;
    if (result.punchOut) punchUpdate.punchOut = result.punchOut;
    await attendanceRecords().updateOne(
      { employeeId: result.employeeId, workDate: result.workDate },
      {
        $set: { employeeId: result.employeeId, userId: result.userId, workDate: result.workDate, ...punchUpdate },
        $setOnInsert: {
          source: 'manual',
          sourceKey: `regularization|${result.employeeId}|${result.workDate}`,
          importedAt: decidedAt,
        },
      },
      { upsert: true },
    );
  }

  await notifyCorrectionDecided({
    employeeUserId: result.userId,
    workDate: result.workDate,
    approved: decision === 'approved',
    comment: managerNote,
  });
  return (await enrichRegularizations([result]))[0];
}

async function enrichRegularizations(values: AttendanceRegularization[]) {
  const userIds = [...new Set(values.map((value) => value.userId))];
  const employeeIds = [...new Set(values.map((value) => value.employeeId))];
  const [employeeRows, punchRows] = await Promise.all([
    users().find({ userId: { $in: userIds } }).project({ userId: 1, name: 1, department: 1 }).toArray(),
    attendanceRecords().find({ employeeId: { $in: employeeIds } }).toArray(),
  ]);
  const employeeById = new Map(employeeRows.map((value) => [value.userId, value]));
  const punchByKey = new Map(punchRows.map((value) => [`${value.employeeId}|${value.workDate}`, value]));
  return values.map((value) => {
    const employee = employeeById.get(value.userId);
    const punch = punchByKey.get(`${value.employeeId}|${value.workDate}`);
    return {
      ...toRegularizationView(value),
      employee: { name: employee?.name ?? 'Employee', department: employee?.department ?? 'Team' },
      // What the device actually recorded, so the manager can compare it with
      // the requested times carried by the request itself.
      punchIn: punch?.punchIn?.toISOString(),
      punchOut: punch?.punchOut?.toISOString(),
    };
  });
}

/**
 * A corrected punch arrives as an ISO instant from the client. It must land on
 * the work date being corrected, so a mistyped day can't be smuggled through.
 */
/**
 * A punch time from an app version that predates day types. Kept only so those
 * builds keep working against this backend — nothing sends these any more.
 */
function parsePunch(value: string | undefined, field: string): Date | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AttendanceError(400, `${field} is not a valid time`);
  }
  return parsed;
}

function parseDate(value: string, field: string): Date {
  if (!datePattern.test(value)) throw new AttendanceError(400, `${field} must use YYYY-MM-DD format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AttendanceError(400, `${field} is not a valid date`);
  }
  return parsed;
}

function daysBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86_400_000); }
function toRegularizationView(value: AttendanceRegularization) {
  const { _id, punchIn, punchOut, ...rest } = value;
  return {
    ...rest,
    id: _id?.toHexString(),
    requestedPunchIn: punchIn?.toISOString(),
    requestedPunchOut: punchOut?.toISOString(),
  };
}

/**
 * Wall-clock offset the shift times are written in. The rest of the product
 * already assumes India (see the daily lifecycle job), and a shift saved as
 * "09:00" means nine in the morning where the office is, not nine UTC.
 */
const SHIFT_UTC_OFFSET = '+05:30';

/**
 * The hours an approved correction records for the day.
 *
 * Full day and work-from-home both take the whole shift; a half day runs from
 * the shift's start for as long as the policy says a half day lasts. Leave
 * records no hours at all — it is time off, not time worked.
 */
function punchWindowFor(
  dayType: RegularizationDayType,
  workDate: string,
  shift: { startTime: string; endTime: string; minHalfDayHours: number },
): { punchIn: Date; punchOut: Date } | undefined {
  if (dayType === 'leave') return undefined;
  const at = (time: string, addDays = 0) => {
    // Built from the calendar date directly. Going through an instant and back
    // out via toISOString() lands a day early, because midnight local is the
    // previous day in UTC.
    const [year, month, day] = workDate.split('-').map(Number);
    const base = new Date(Date.UTC(year, month - 1, day + addDays));
    return new Date(
      `${base.toISOString().slice(0, 10)}T${time}:00.000${SHIFT_UTC_OFFSET}`,
    );
  };
  const punchIn = at(shift.startTime);
  if (dayType === 'half_day') {
    const hours = shift.minHalfDayHours > 0 ? shift.minHalfDayHours : 4;
    return {
      punchIn,
      punchOut: new Date(punchIn.getTime() + hours * 60 * 60 * 1000),
    };
  }
  // An end at or before the start means the shift runs into the next day.
  const overnight = shift.endTime <= shift.startTime;
  return { punchIn, punchOut: at(shift.endTime, overnight ? 1 : 0) };
}

/**
 * The offices this employee may punch from, for the app to show before anyone
 * slides the control. An empty list means their org is not geofenced.
 */
export async function punchOfficesFor(userId: string) {
  const employee = await users().findOne({ userId });
  const org = employee?.org ?? '';
  if (!org) return [];
  const sites = await offices().find({ org, active: true }).toArray();
  return sites.map(officeView);
}

export class AttendanceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /**
     * Extra the client can act on — for a refused punch, the office it was
     * measured against and how far away the reading was, so the screen can say
     * where you are rather than only that you are not there.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
