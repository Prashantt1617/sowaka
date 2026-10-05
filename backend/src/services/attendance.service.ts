import { ObjectId } from 'mongodb';
import { attendanceRecords, attendanceRegularizations, offices, users } from '../config/db';
import { PunchLocation } from '../models/office.model';
import { locateForPunch, officeView, placeLabel, punchLocationFrom } from './geofence.service';
import {
  AttendanceRegularization,
  OutsideLocationNote,
  REGULARIZATION_DAY_TYPES,
  RegularizationDayType,
  RegularizationStatus,
} from '../models/attendance.model';
import { approvalRulesFor, isWeekOffDay, managerMayDecide, policyForUser } from './shift.service';
import { orgUsers } from './admin-scope';
import { DayMark, HALF_DAY_CORRECTION_OUTCOMES, ShiftPolicyRules } from '../models/shift.model';
import { holidayDatesForUser } from './holiday.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  notifyCorrectionDecided, notifyCorrectionSubmitted, notifyOutOfLocationDecided,
  notifyOutOfLocationSubmitted, notifyPunchedIn, notifyPunchedOut,
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
      outsideLocation: outsideLocationView(item.outsideLocation),
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
  /** Why the employee is away, when the location check has already failed once. */
  reasonInput?: string,
) {
  if (type !== 'in' && type !== 'out') throw new AttendanceError(400, 'type must be in or out');
  const found = await users().findOne({ userId });
  if (!found?.employeeId) throw new AttendanceError(409, 'Employee ID is not configured');
  const employee = { ...found, employeeId: found.employeeId };

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
    if (!verdict.inside && verdict.reason === 'inaccurate') {
      throw new AttendanceError(
        409,
        'Your location is not precise enough yet. Move near a window and try again.',
        { location, office: verdict.office ? officeView(verdict.office) : undefined },
      );
    }
    if (!verdict.inside) {
      // Outside every office. What happens next is HR's call, per shift: the
      // punch either becomes a request the manager settles, or the day is
      // marked present with the reason and the pin kept beside it. Either way
      // the employee says why first — so a punch without a reason is sent
      // back with the list to choose from, and comes again with one.
      const rules = policy.correction.outsideLocation;
      const office = verdict.office ? officeView(verdict.office) : undefined;
      const reason = (reasonInput ?? '').replace(/\s+/g, ' ').trim();
      if (!reason) {
        throw new AttendanceError(
          409,
          'You are outside the approved attendance area.',
          { location, office, outsideLocation: { outcome: rules.outcome, reasons: rules.reasons } },
        );
      }
      const chosen = rules.reasons.find((item) => item.toLowerCase() === reason.toLowerCase());
      if (!chosen) {
        throw new AttendanceError(
          400,
          'Choose one of the reasons your company allows',
          { location, office, outsideLocation: { outcome: rules.outcome, reasons: rules.reasons } },
        );
      }
      const at = new Date();
      const note: OutsideLocationNote = {
        reason: chosen,
        punchType: type,
        at,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy: reading.accuracy,
        officeId: verdict.office?.id,
        officeName: verdict.office?.name,
        distanceMeters: verdict.distanceMeters,
      };
      location = { ...location, offsite: true };
      // The request flow is about being marked present, so it applies to the
      // punch that marks the day: the punch-in. A punch-out from outside only
      // closes a day the punch-in already opened, so it is recorded with the
      // remark whichever outcome HR chose.
      if (rules.outcome === 'request' && type === 'in') {
        return requestOutOfLocation(employee, note, location);
      }
      return writePunch(employee, type, location, policy, note);
    }
  }
  return writePunch(employee, type, location, policy);
}

/**
 * Writes the punch and tells the employee. Split from the location check so an
 * out-of-location punch HR marks present goes through exactly the same door.
 */
async function writePunch(
  employee: { userId: string; employeeId: string },
  type: 'in' | 'out',
  location: PunchLocation | undefined,
  policy: { minFullDayHours: number; minHalfDayHours: number },
  outside?: OutsideLocationNote,
) {
  const { userId } = employee;
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
          ...(outside ? { outsideLocation: outside } : {}),
        },
        $setOnInsert: { source: 'manual', sourceKey: `manual|${employee.employeeId}|${workDate}`, importedAt: now },
      },
      { upsert: true },
    );
  } else {
    if (!existing?.punchIn) {
      // The day may be open only as an out-of-location request the manager
      // has not settled. The punch-out then rides on the request, and lands
      // on the day with the punch-in when the request is approved.
      const pending = await attendanceRegularizations().findOne({
        userId, workDate, status: 'pending', kind: 'out_of_location',
      });
      if (pending) {
        if (pending.punchOut) throw new AttendanceError(409, 'Already punched out today');
        await attendanceRegularizations().updateOne({ _id: pending._id }, { $set: { punchOut: now } });
        return {
          workDate,
          punchOut: now.toISOString(),
          outsideLocation: outsideLocationView(pending.outsideLocation),
          request: toRegularizationView({ ...pending, punchOut: now }),
        };
      }
      throw new AttendanceError(409, 'Punch in before punching out');
    }
    if (existing?.punchOut) throw new AttendanceError(409, 'Already punched out today');
    await attendanceRecords().updateOne(
      { employeeId: employee.employeeId, workDate },
      {
        $set: {
          punchOut: now,
          updatedAt: now,
          ...(location ? { punchOutLocation: location } : {}),
          // A punch-out from outside is noted too, unless the day already
          // carries the punch-in's note: the first remark is the one HR reads.
          ...(outside && !existing?.outsideLocation ? { outsideLocation: outside } : {}),
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
  // The same shape as a row of `mine`, since the app swaps the day's row for
  // this: leaving out the day type would blank a regularised day until refresh.
  return {
    id: updated?._id?.toHexString(),
    workDate,
    punchIn: updated?.punchIn?.toISOString(),
    punchOut: updated?.punchOut?.toISOString(),
    dayType: updated?.dayType,
    office: location?.officeName,
    outsideLocation: outsideLocationView(updated?.outsideLocation),
  };
}

/**
 * An out-of-location punch-in on a shift where HR wants the manager to decide.
 *
 * Nothing is written to the day: it stands as absent until the manager
 * approves, and declined leaves it absent for the employee to raise a
 * correction against. The request carries the pin so the manager sees where
 * the punch came from, as a distance from the nearest office.
 */
async function requestOutOfLocation(
  employee: { userId: string; employeeId: string; managerUserId?: string },
  note: OutsideLocationNote,
  location: PunchLocation,
) {
  const { userId } = employee;
  const workDate = note.at.toISOString().slice(0, 10);
  if (!employee.managerUserId) {
    throw new AttendanceError(409, 'A manager must be assigned before an out-of-location punch can be sent to them');
  }
  const existing = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });
  if (existing?.punchIn) throw new AttendanceError(409, 'Already punched in today');
  const pending = await attendanceRegularizations().findOne({ userId, workDate, status: 'pending' });
  if (pending) {
    throw new AttendanceError(
      409,
      pending.kind === 'out_of_location'
        ? 'Your out of location request for today is already with your manager'
        : 'A correction request is already pending for today',
    );
  }
  const row: AttendanceRegularization = {
    userId, employeeId: employee.employeeId, managerUserId: employee.managerUserId,
    workDate, kind: 'out_of_location', requestedDayType: 'full_day', outsideLocation: note,
    note: '', status: 'pending', createdAt: note.at,
  };
  const result = await attendanceRegularizations().insertOne(row);
  void location;
  await notifyOutOfLocationSubmitted({
    employeeUserId: userId, workDate, reason: note.reason, place: placeLabel(note.distanceMeters, note.officeName),
  });
  return {
    workDate,
    outsideLocation: outsideLocationView(note),
    request: toRegularizationView({ ...row, _id: result.insertedId }),
  };
}

/** The remark as the app and the dashboard show it, with the pin and a readable place. */
export function outsideLocationView(note?: OutsideLocationNote) {
  if (!note) return undefined;
  return {
    reason: note.reason,
    punchType: note.punchType,
    at: note.at.toISOString(),
    latitude: note.latitude,
    longitude: note.longitude,
    officeName: note.officeName,
    distanceMeters: note.distanceMeters,
    place: placeLabel(note.distanceMeters, note.officeName),
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
    | 'startTime'
    | 'endTime'
    | 'minFullDayHours'
    | 'minHalfDayHours'
    | 'missingPunchIn'
    | 'missingPunchOut'
    | 'missingBoth'
    | 'correction'
  > & Partial<Pick<ShiftPolicyRules, 'halfDay'>>,
  punchIn: Date | null,
  punchOut: Date | null,
): DayMark {
  // One punch makes the day where that is all the policy asks for: there is no
  // punch-out to be missing, and no hours to grade it by.
  const { punchIn: inAt, punchOut: outAt } = normalisePunches(policy, punchIn, punchOut);
  // Four rules, each on or off; any that is on and trips makes the day a half
  // day. With all of them off a day with its punches is a full day.
  const rules = policy.halfDay ?? DEFAULT_HALF_DAY;
  const lateIn = (at: Date) =>
    rules.lateArrivalEnabled && minutesAfterShiftStart(at, policy.startTime) > rules.lateArrivalMinutes;
  const earlyOut = (at: Date) =>
    rules.earlyLeaveEnabled && minutesBeforeShiftEnd(at, policy.startTime, policy.endTime) > rules.earlyLeaveMinutes;
  if (policy.correction?.punchMode === 'Single punch') {
    // One punch: only the check-in rule can say anything.
    if (!inAt) return policy.missingBoth;
    return lateIn(inAt) ? 'Half Day' : 'Present';
  }
  if (inAt && outAt) {
    const worked = (outAt.getTime() - inAt.getTime()) / 3_600_000;
    // Too short to be even a half day, where that rule is on.
    if (rules.minHalfDayEnabled && worked < policy.minHalfDayHours) return 'Absent';
    if (rules.minFullDayEnabled && worked < policy.minFullDayHours) return 'Half Day';
    if (lateIn(inAt) || earlyOut(outAt)) return 'Half Day';
    return 'Present';
  }
  if (!inAt && !outAt) return policy.missingBoth;
  return inAt ? policy.missingPunchOut : policy.missingPunchIn;
}

/**
 * Wall-clock offset the shift times are written in. The rest of the product
 * already assumes India, and a shift saved as "09:00" means nine in the
 * morning where the office is, not nine UTC.
 */
export const SHIFT_UTC_OFFSET = '+05:30';
const DAY_MS = 24 * 3_600_000;

/** The office's offset from UTC in milliseconds, from the same '+05:30' the shift windows use. */
const OFFICE_OFFSET_MS = (() => {
  const [, sign, hh, mm] = /^([+-])(\d{2}):(\d{2})$/.exec(SHIFT_UTC_OFFSET) ?? ['', '+', '0', '0'];
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
})();

/**
 * Minutes between the shift's start and a punch, in office time — negative
 * when the punch came early. The start is wall-clock where the office is, not
 * UTC; read as UTC a 09:00 start is mid-afternoon and nobody is ever late.
 */
/** What grades a day whose policy predates the rules: the full-day threshold alone. */
const DEFAULT_HALF_DAY = {
  minHalfDayEnabled: false, minFullDayEnabled: true,
  lateArrivalEnabled: false, lateArrivalMinutes: 120,
  earlyLeaveEnabled: false, earlyLeaveMinutes: 60,
};

/**
 * Minutes between a punch-out and the shift's end, in office time — positive
 * when they left early. An end at or before the start is the next day's.
 */
export function minutesBeforeShiftEnd(punchOut: Date, startTime: string, endTime: string): number {
  const officeDay = new Date(punchOut.getTime() + OFFICE_OFFSET_MS).toISOString().slice(0, 10);
  let end = new Date(`${officeDay}T${endTime}:00.000${SHIFT_UTC_OFFSET}`);
  // On an overnight shift a punch-out after midnight is measured against that
  // day's end; before midnight, against the end that falls the next morning.
  if (endTime <= startTime) {
    const start = new Date(`${officeDay}T${startTime}:00.000${SHIFT_UTC_OFFSET}`);
    if (punchOut.getTime() >= start.getTime()) end = new Date(end.getTime() + DAY_MS);
  }
  return Math.round((end.getTime() - punchOut.getTime()) / 60_000);
}

export function minutesAfterShiftStart(punchIn: Date, startTime: string): number {
  const officeDay = new Date(punchIn.getTime() + OFFICE_OFFSET_MS).toISOString().slice(0, 10);
  const start = new Date(`${officeDay}T${startTime}:00.000${SHIFT_UTC_OFFSET}`);
  return Math.round((punchIn.getTime() - start.getTime()) / 60_000);
}

/** Two taps this close together are one tap the device recorded twice. */
const ONE_TAP_MS = 60_000;

/**
 * The pair as it should be read, whatever order the device filed it in.
 *
 * A signed difference gets three things a biometric import does wrong. It can
 * file the two punches the wrong way round, so a 08:56→18:19 morning arrives
 * as in 18:19, out 08:56 and grades as minus nine hours — a half day. On an
 * overnight shift it can file the post-midnight punch-out under the same date
 * as its punch-in, which is the same negative for the opposite reason. And it
 * can record one tap as both punches, a day of zero hours. So: on a day shift
 * a reversed pair is swapped back; on an overnight shift it rolls over
 * midnight; and an identical pair is one punch — a missing punch-out, not a
 * short day.
 */
export function normalisePunches(
  policy: Pick<ShiftPolicyRules, 'startTime' | 'endTime'>,
  punchIn: Date | null,
  punchOut: Date | null,
): { punchIn: Date | null; punchOut: Date | null } {
  if (!punchIn || !punchOut) return { punchIn, punchOut };
  const diff = punchOut.getTime() - punchIn.getTime();
  if (Math.abs(diff) < ONE_TAP_MS) return { punchIn, punchOut: null };
  if (diff > 0) return { punchIn, punchOut };
  // An end at or before the start is how the policy says the shift runs overnight.
  const overnight = policy.endTime <= policy.startTime;
  if (overnight) return { punchIn, punchOut: new Date(punchOut.getTime() + DAY_MS) };
  return { punchIn: punchOut, punchOut: punchIn };
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
  // reach, and which of the four day outcomes may be corrected at all. Read as
  // of the day being corrected: it is that day's shift that says whether it
  // needed two punches, not whichever shift they are on now.
  const policy = await policyForUser(userId, workDate);
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
  // A colleague's month is open to the whole company — the profile shows
  // everyone's attendance — but never across orgs.
  const viewer = await users().findOne({ userId: managerUserId }, { projection: { org: 1 } });
  const sameOrg = Boolean(viewer && employee.org && viewer.org === employee.org);
  if (!sameOrg && !(await managesUpTheChain(managerUserId, employee))) {
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

/**
 * Every correction raised anywhere in the admin's org.
 *
 * The manager inbox above answers "what is waiting on me"; HR is asking "what
 * is waiting on anyone", so this is scoped by org rather than by approver.
 * Pending first, then newest, because the queue is the reason to open it.
 */
export async function listAllRegularizationsForAdmin(adminUserId: string) {
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const byUserId = new Map(employees.map((employee) => [employee.userId, employee]));
  const values = await attendanceRegularizations()
    .find({ userId: { $in: employees.map((employee) => employee.userId) } })
    .sort({ status: -1, createdAt: -1 })
    .toArray();
  const enriched = await enrichRegularizations(values);
  // HR is looking across managers, so each row has to say whose call it is.
  return enriched.map((value) => ({
    ...value,
    manager: byUserId.get(value.managerUserId)?.name ?? '',
    employeeCode: byUserId.get(value.userId)?.employeeId ?? value.employeeId,
  }));
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
    {
      $set: {
        status: decision, managerNote, decidedAt, decidedByUserId: managerUserId, decidedByRole: 'manager' as const,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) throw new AttendanceError(404, 'Pending regularization request not found');

  await applyRegularizationDecision(result, decision, decidedAt, managerNote);
  return (await enrichRegularizations([result]))[0];
}

/**
 * Dashboard override for a correction.
 *
 * HR settles requests across the whole org, so this matches on the request
 * rather than on the approver the way the manager path does. Everything that
 * follows an approval — the attendance record, the employee's notification —
 * is the same work, so it runs through the same helper.
 */
export async function adminDecideRegularization(
  adminUserId: string, id: string, input: { decision?: string; managerNote?: string },
) {
  if (!ObjectId.isValid(id)) throw new AttendanceError(400, 'Invalid request ID');
  const decision = (input.decision ?? '').trim() as RegularizationStatus;
  if (!decisions.has(decision)) throw new AttendanceError(400, 'Decision must be approved or declined');
  const managerNote = (input.managerNote ?? '').trim();
  if (managerNote.length > 500) throw new AttendanceError(400, 'Manager note cannot exceed 500 characters');

  const pending = await attendanceRegularizations().findOne({ _id: new ObjectId(id) });
  if (!pending) throw new AttendanceError(404, 'Correction request not found');
  if (pending.userId === adminUserId) {
    throw new AttendanceError(403, 'You cannot override your own request');
  }
  if (pending.status !== 'pending') {
    throw new AttendanceError(409, 'Correction request has already been decided');
  }
  // Same org check the other dashboard overrides make: an admin decides for
  // their own company and nobody else's.
  const employees = await orgUsers(adminUserId);
  if (!employees.some((employee) => employee.userId === pending.userId)) {
    throw new AttendanceError(404, 'Correction request not found');
  }

  const decidedAt = new Date();
  const result = await attendanceRegularizations().findOneAndUpdate(
    { _id: new ObjectId(id), status: 'pending' },
    {
      $set: {
        status: decision, managerNote, decidedAt, decidedByUserId: adminUserId, decidedByRole: 'admin' as const,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) throw new AttendanceError(409, 'Correction request has already been decided');

  await applyRegularizationDecision(result, decision, decidedAt, managerNote);
  return (await enrichRegularizations([result]))[0];
}

/** The work an approved or declined correction sets off, whoever decided it. */
async function applyRegularizationDecision(
  result: AttendanceRegularization,
  decision: RegularizationStatus,
  decidedAt: Date,
  managerNote: string,
) {
  if (decision === 'approved') {
    // Fold the decision into the canonical attendance record so the employee's
    // calendar reflects what was approved, not just the request. Corrections
    // raised before day types still carry punch times, so both are applied.
    const punchUpdate: Record<string, Date | RegularizationDayType> = { updatedAt: decidedAt };
    // An out-of-location day is not invented from the shift's hours: the
    // employee punched in for real, and the punch-out is theirs to take. Only
    // a correction fills the day with the shift's window.
    if (result.requestedDayType && result.kind !== 'out_of_location') {
      punchUpdate.dayType = result.requestedDayType;
      // An approved day is a worked day, so it gets the shift's own hours
      // rather than staying blank: the calendar showed "-" against a day the
      // manager had just confirmed was worked.
      // The hours belong to the shift that covered the corrected day.
      const shift = await policyForUser(result.userId, result.workDate);
      const window = punchWindowFor(result.requestedDayType, result.workDate, shift);
      if (window) {
        punchUpdate.punchIn = window.punchIn;
        punchUpdate.punchOut = window.punchOut;
      }
    }
    if (result.punchIn) punchUpdate.punchIn = result.punchIn;
    if (result.punchOut) punchUpdate.punchOut = result.punchOut;
    // An approved out-of-location day keeps where it was worked from, and the
    // punch the employee actually took, so HR's view of the day is the truth.
    const outside = result.kind === 'out_of_location' && result.outsideLocation
      ? { outsideLocation: result.outsideLocation, punchIn: result.outsideLocation.at, dayType: result.requestedDayType ?? 'full_day' }
      : {};
    await attendanceRecords().updateOne(
      { employeeId: result.employeeId, workDate: result.workDate },
      {
        $set: { employeeId: result.employeeId, userId: result.userId, workDate: result.workDate, ...punchUpdate, ...outside },
        $setOnInsert: {
          source: 'manual',
          sourceKey: `regularization|${result.employeeId}|${result.workDate}`,
          importedAt: decidedAt,
        },
      },
      { upsert: true },
    );
  }

  if (result.kind === 'out_of_location') {
    await notifyOutOfLocationDecided({
      employeeUserId: result.userId,
      workDate: result.workDate,
      reason: result.outsideLocation?.reason ?? '',
      approved: decision === 'approved',
      comment: managerNote,
    });
    return;
  }
  await notifyCorrectionDecided({
    employeeUserId: result.userId,
    workDate: result.workDate,
    approved: decision === 'approved',
    comment: managerNote,
  });
}

async function enrichRegularizations(values: AttendanceRegularization[]) {
  const userIds = [...new Set(values.map((value) => value.userId))];
  const employeeIds = [...new Set(values.map((value) => value.employeeId))];
  const [employeeRows, punchRows] = await Promise.all([
    users()
      .find({ userId: { $in: userIds } })
      // The photo fields come too, or the row resolves a face it never read.
      .project({ userId: 1, name: 1, department: 1, profilePhotoKey: 1, profilePhotoUrl: 1 })
      .toArray(),
    attendanceRecords().find({ employeeId: { $in: employeeIds } }).toArray(),
  ]);
  const employeeById = new Map(employeeRows.map((value) => [value.userId, value]));
  const punchByKey = new Map(punchRows.map((value) => [`${value.employeeId}|${value.workDate}`, value]));
  const photoByUser = new Map(
    await Promise.all(
      employeeRows.map(
        async (row) => [row.userId, await resolveProfilePhoto(row)] as [string, string | undefined],
      ),
    ),
  );
  return values.map((value) => {
    const employee = employeeById.get(value.userId);
    const punch = punchByKey.get(`${value.employeeId}|${value.workDate}`);
    return {
      ...toRegularizationView(value),
      employee: {
        name: employee?.name ?? 'Employee',
        department: employee?.department ?? 'Team',
        // Their own face on the request card, where they have set one.
        photoUrl: photoByUser.get(value.userId),
      },
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
  const { _id, punchIn, punchOut, outsideLocation, ...rest } = value;
  const kind = value.kind ?? 'correction';
  return {
    ...rest,
    id: _id?.toHexString(),
    kind,
    // Named here, once, so the employee, the manager and HR all read the same
    // heading — and a change of wording never waits for an app release.
    title: kind === 'out_of_location'
      ? `Out of location request${outsideLocation?.reason ? ` (${outsideLocation.reason})` : ''}`
      : 'Attendance correction',
    outsideLocation: outsideLocationView(outsideLocation),
    requestedPunchIn: punchIn?.toISOString(),
    requestedPunchOut: punchOut?.toISOString(),
  };
}

/**
 * Every punch taken away from an office in the admin's org, in a date range:
 * the days HR's policy marked present with a remark, and the requests that
 * went to a manager, whatever became of them. Newest first.
 */
export async function listOutOfLocationForAdmin(adminUserId: string, fromInput: string, toInput: string) {
  const from = parseDate(fromInput, 'from');
  const to = parseDate(toInput, 'to');
  if (to < from) throw new AttendanceError(400, 'to cannot be before from');
  if (daysBetween(from, to) > 366) throw new AttendanceError(400, 'Date range cannot exceed a year');
  const employees = await orgUsers(adminUserId);
  if (employees.length === 0) return [];
  const byUserId = new Map(employees.map((employee) => [employee.userId, employee]));
  const userIds = employees.map((employee) => employee.userId);
  const [records, requests] = await Promise.all([
    attendanceRecords()
      .find({ userId: { $in: userIds }, workDate: { $gte: fromInput, $lte: toInput }, outsideLocation: { $exists: true } })
      .toArray(),
    attendanceRegularizations()
      .find({ userId: { $in: userIds }, workDate: { $gte: fromInput, $lte: toInput }, kind: 'out_of_location' })
      .toArray(),
  ]);
  const who = (userId: string) => {
    const employee = byUserId.get(userId);
    return {
      userId,
      name: employee?.name ?? 'Employee',
      employeeCode: employee?.employeeId ?? '',
      department: employee?.department ?? '',
      manager: byUserId.get(employee?.managerUserId ?? '')?.name ?? '',
    };
  };
  // A request that was approved also wrote the record, so the record is the
  // one row for that day; the request rows cover what is pending or declined.
  const approvedDays = new Set(requests.filter((r) => r.status === 'approved').map((r) => `${r.userId}|${r.workDate}`));
  const rows = [
    ...records.map((record) => ({
      id: `record:${record._id?.toHexString()}`,
      ...who(record.userId ?? ''),
      workDate: record.workDate,
      outcome: approvedDays.has(`${record.userId}|${record.workDate}`) ? 'request' : 'present',
      status: 'approved',
      ...outsideLocationView(record.outsideLocation)!,
      decidedByRole: undefined as 'manager' | 'admin' | undefined,
      managerNote: '',
    })),
    ...requests
      .filter((r) => r.status !== 'approved')
      .map((request) => ({
        id: `request:${request._id?.toHexString()}`,
        ...who(request.userId),
        workDate: request.workDate,
        outcome: 'request',
        status: request.status,
        ...outsideLocationView(request.outsideLocation)!,
        decidedByRole: request.decidedByRole,
        managerNote: request.managerNote ?? '',
      })),
  ];
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * Wall-clock offset the shift times are written in. The rest of the product
 * already assumes India (see the daily lifecycle job), and a shift saved as
 * "09:00" means nine in the morning where the office is, not nine UTC.
 */

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

/**
 * Whether the viewer sits anywhere above this employee's reporting line — a
 * direct report, or a report of a report. A peer or one's own manager is not
 * the viewer's to see, so the Team tab offers no calendar for them.
 */
async function managesUpTheChain(viewerId: string, employee: { managerUserId?: string }): Promise<boolean> {
  const seen = new Set<string>();
  let managerId = employee.managerUserId;
  while (managerId && !seen.has(managerId)) {
    if (managerId === viewerId) return true;
    seen.add(managerId);
    const manager = await users().findOne({ userId: managerId }, { projection: { managerUserId: 1 } });
    managerId = manager?.managerUserId;
  }
  return false;
}
