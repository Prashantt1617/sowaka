import { attendanceRecords, holidays, leaves, shiftAssignments, shiftTemplates, users } from '../config/db';
import { Leave } from '../models/leave.model';
import { OrgShiftPolicy, PunchFormat, ShiftTemplate } from '../models/shift.model';
import { User } from '../models/user.model';
import { getOrgShiftPolicy, isWeekOffDay, onShiftSetupChanged } from './shift.service';
import { markForDay, minutesAfterShiftStart, minutesBeforeShiftEnd, normalisePunches } from './attendance.service';
import { holidaysForUser } from './holiday.service';

/**
 * Reports › Attendance — how a date range actually went, one graded row per
 * employee per working day.
 *
 * Every employee-day in the range is graded once, against the policy that
 * governs *that* employee: the template assigned to them, or the org's if they
 * are on none. That is the same rule `policyForUser` applies one person at a
 * time; this loads the templates and the org policy once and grades everyone
 * against them, because a month for two hundred people is sixty thousand days
 * and a query each would be unusable.
 *
 * Days nobody was due to work — week-offs and their location's holidays — are
 * not graded at all. Counting them as absent is the mistake that makes every
 * attendance report read as a disaster.
 *
 * The answer is compact on purpose: who each person is goes once, in
 * `people`, and each day is a short tuple pointing at them. A month for a
 * large org is a few thousand tuples rather than a megabyte of repeated names,
 * and the dashboard does its own counting, which is instant.
 */

/** What a graded day came out as. */
export type DayStatus = 'present' | 'half_day' | 'missed_punch' | 'on_leave' | 'absent';

export type ReportPerson = {
  name: string;
  employeeId: string;
  department: string;
  location: string;
  /** The shift template governing them, or null when they follow the org policy. */
  template: string | null;
  punchFormat: PunchFormat;
  /** Who they report to, by name; empty at the top of the tree. */
  manager: string;
};

/**
 * One graded day: [userId, date, status, lateByMinutes, punchIn, punchOut, leaveType, source, earlyByMinutes].
 * `lateByMinutes` and `earlyByMinutes` are 0 when they were within grace;
 * times are ISO strings or null.
 */
export type ReportDay = [string, string, DayStatus, number, string | null, string | null, string | null, string | null, number];

export type AttendanceReport = {
  from: string;
  to: string;
  departments: string[];
  templates: string[];
  leaveTypes: string[];
  punchFormats: string[];
  managers: string[];
  people: Record<string, ReportPerson>;
  days: ReportDay[];
};

export class ReportError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** Rows per cursor round trip. The default of a hundred turns a month into dozens of trips. */
const BATCH = 10_000;

/** A date-only UTC instant for a YYYY-MM-DD, which is how work days are keyed. */
const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const keyOf = (date: Date) => date.toISOString().slice(0, 10);

/** Minutes short of the shift's end, once the grace period is spent. */
function earlyBy(punchOut: Date, startTime: string, endTime: string, graceMinutes: number): number {
  return Math.max(0, minutesBeforeShiftEnd(punchOut, startTime, endTime) - graceMinutes);
}

/** Minutes past the shift's start, once the grace period is spent. */
function lateBy(punchIn: Date, startTime: string, graceMinutes: number): number {
  const over = minutesAfterShiftStart(punchIn, startTime) - graceMinutes;
  return over > 0 ? over : 0;
}

type Person = Pick<User, 'userId' | 'name' | 'employeeId' | 'department' | 'location' | 'branch' | 'state' | 'managerUserId'>;

/**
 * The roster, templates and org policy change rarely and cost the most to
 * fetch — the cluster round trip for two hundred user documents was the whole
 * of the wait. They are held for a minute so moving the date range does not
 * fetch them again.
 */
/** One employee's moves between templates, newest first. */
type Timeline = { from: string; templateId: string | null }[];
type OrgSetup = {
  roster: Person[];
  templates: ShiftTemplate[];
  orgPolicy: Omit<OrgShiftPolicy, 'org' | '_id'>;
  timelines: Map<string, Timeline>;
};
const setupCache = new Map<string, { expires: number; value: OrgSetup }>();
// The roster and templates change on the order of days; assignments only take
// effect tomorrow anyway. Five minutes stale costs nothing a reader would
// notice and saves the slowest round trip the report makes.
const SETUP_TTL_MS = 5 * 60_000;

// Which org an admin belongs to never changes, and looking it up was a whole
// round trip before any real work could start.
const adminOrgCache = new Map<string, { expires: number; org: string }>();
const ADMIN_ORG_TTL_MS = 10 * 60_000;

// A finished report, keyed by what defines it. Two minutes is short enough
// that a punch landing during the day shows up on the next refresh, and long
// enough that flipping between filters, tabs and pages — none of which
// re-request — never waits on the link twice.
const reportCache = new Map<string, { expires: number; value: AttendanceReport }>();
const REPORT_TTL_MS = 2 * 60_000;

// A template edit, an assignment or a new default has to show on the next
// refresh; a finished report for that org is just as stale as its setup.
onShiftSetupChanged((org) => {
  setupCache.delete(org);
  for (const key of reportCache.keys()) if (key.startsWith(`${org}|`)) reportCache.delete(key);
});

async function orgSetup(org: string): Promise<OrgSetup> {
  const hit = setupCache.get(org);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [roster, templates, orgPolicy, assignments] = await Promise.all([
    users()
      .find(
        { org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } },
        { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, location: 1, branch: 1, state: 1, managerUserId: 1 } },
      )
      // One batch, not a round trip per hundred rows: on a slow link the trips
      // were the whole wait, and the whole roster is a few hundred kilobytes.
      .batchSize(BATCH)
      .toArray() as Promise<Person[]>,
    // Retired and inactive ones too: a day is graded by the template that
    // covered it, whatever became of that template since.
    shiftTemplates().find({ org }).toArray(),
    getOrgShiftPolicy(org),
    // Who moved between templates and when, so a day is graded against the
    // shift that covered it rather than the one they are on today.
    shiftAssignments().find({ org }).sort({ effectiveFrom: -1 }).batchSize(BATCH).toArray(),
  ]);
  const timelines = new Map<string, Timeline>();
  for (const row of assignments) {
    const list = timelines.get(row.userId) ?? [];
    list.push({ from: row.effectiveFrom, templateId: row.templateId ? row.templateId.toHexString() : null });
    timelines.set(row.userId, list);
  }
  const value = { roster, templates, orgPolicy, timelines };
  setupCache.set(org, { expires: Date.now() + SETUP_TTL_MS, value });
  return value;
}


/**
 * The policy covering an employee on a given day, for the whole org at once.
 *
 * Built once per template, then looked up per day: a month for two hundred
 * people is sixty thousand days, and rebuilding the object each time is the
 * difference between a report and a timeout. Shared by the org report and a
 * single employee's calendar, so the two can never grade a day differently.
 */
function dayPolicyResolver({ templates, orgPolicy, timelines }: OrgSetup) {
    // Built once per template, then looked up per day: a month for two hundred
    // people is sixty thousand days, and rebuilding the object each time is the
    // difference between a report and a timeout.
    const live = templates.filter((t) => t.active && !t.deletedAt);
    const templateFor = new Map<string, ShiftTemplate>();
    for (const template of live) {
      for (const userId of template.assignedUserIds ?? []) templateFor.set(userId, template);
    }
    const build = (template: ShiftTemplate | null) => {
      const policy = {
        ...orgPolicy,
        ...(template?.policy ?? {}),
        halfDay: { ...orgPolicy.halfDay, ...(template?.policy?.halfDay ?? {}) },
      };
      const correction = {
        ...orgPolicy.correction,
        ...(template?.policy?.correction ?? {}),
        punchFormat:
          template?.punchFormat ?? template?.policy?.correction?.punchFormat ?? orgPolicy.correction.punchFormat,
        punchMode: template?.punchMode ?? template?.policy?.correction?.punchMode ?? orgPolicy.correction.punchMode,
      };
      return { ...policy, correction, templateName: template?.name ?? null };
    };
    const byId = new Map(templates.map((t) => [t._id!.toHexString(), t]));
    // Whoever is on no template is on the default one; the org policy only
    // answers for an org that has no default yet.
    const defaultTemplate = live.find((t) => t.isDefault) ?? null;
    const orgPolicyView = build(defaultTemplate);
    const builtFor = new Map<string, ReturnType<typeof build>>();
    const forTemplateId = (id: string | null) => {
      if (!id) return orgPolicyView;
      const cached = builtFor.get(id);
      if (cached) return cached;
      const made = build(byId.get(id) ?? null);
      builtFor.set(id, made);
      return made;
    };
    /**
     * The policy covering this employee on this date.
     *
     * The timeline is newest-first, so the first entry that starts on or before
     * the day is the one that covered it. Nobody with no timeline has ever been
     * moved, so they are graded on the template they hold now — which is how
     * their history has always read.
     */
    return (user: Person, key: string) => {
      const timeline = timelines.get(user.userId);
      if (!timeline?.length) return build(templateFor.get(user.userId) ?? defaultTemplate);
      const covering = timeline.find((entry: Timeline[number]) => entry.from <= key);
      if (!covering) return build(templateFor.get(user.userId) ?? defaultTemplate);
      return forTemplateId(covering.templateId);
    };
}

export async function attendanceReport(
  adminUserId: string,
  input: { from?: string; to?: string },
): Promise<AttendanceReport> {
  const from = input.from ?? '';
  const to = input.to ?? '';
  if (!DATE.test(from) || !DATE.test(to)) throw new ReportError(400, 'from and to must be YYYY-MM-DD');
  if (from > to) throw new ReportError(400, 'from must not be after to');
  // A year of days for a large org is already a big answer; beyond that the
  // report is the wrong tool and a cap is kinder than a timeout.
  const spanDays = Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / DAY_MS) + 1;
  if (spanDays > 366) throw new ReportError(400, 'Pick a range of a year or less');

  const org = await adminOrg(adminUserId);

  const cacheKey = `${org}|${from}|${to}`;
  const cached = reportCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    console.log(`[attendance-report] ${org} ${from}..${to}: served from cache`);
    return cached.value;
  }

  const started = Date.now();
  const { roster, templates, orgPolicy, timelines } = await orgSetup(org);
  const setupMs = Date.now() - started;
  const userIds = roster.map((u) => u.userId);
  // Imported rows are keyed by employee id, app punches by user id — and an
  // employee id is only unique within an org, so both sides are scoped to this
  // roster rather than to the date alone.
  const employeeIds = roster.map((u) => u.employeeId).filter((id): id is string => !!id);

  const [records, approvedLeaves, holidayRows] = await Promise.all([
    attendanceRecords()
      .find({
        workDate: { $gte: from, $lte: to },
        $or: [{ userId: { $in: userIds } }, { employeeId: { $in: employeeIds } }],
      })
      .batchSize(BATCH)
      .toArray(),
    leaves()
      .find({ userId: { $in: userIds }, status: 'approved', startDate: { $lte: dayOf(to) }, endDate: { $gte: dayOf(from) } })
      .batchSize(BATCH)
      .toArray(),
    holidays().find({ org, date: { $gte: dayOf(from), $lte: dayOf(to) } }).toArray(),
  ]);

  console.log(`[attendance-report] ${org} ${from}..${to}: setup ${setupMs}ms, queries ${Date.now() - started - setupMs}ms, records ${records.length}`);

  const policyOn = dayPolicyResolver({ roster, templates, orgPolicy, timelines });

  // ── holidays, by the location they apply to ───────────────────────────
  const holidaysEverywhere = new Set<string>();
  const holidaysByState = new Map<string, Set<string>>();
  for (const holiday of holidayRows) {
    const key = keyOf(holiday.date);
    if (!holiday.state || holiday.state === '*') holidaysEverywhere.add(key);
    else {
      const set = holidaysByState.get(holiday.state) ?? new Set<string>();
      set.add(key);
      holidaysByState.set(holiday.state, set);
    }
  }
  const isHoliday = (user: Person, key: string) =>
    holidaysEverywhere.has(key) || (holidaysByState.get(user.state ?? user.branch ?? '')?.has(key) ?? false);

  // ── punches and leave, indexed by person and day ──────────────────────
  const punchKey = (id: string, date: string) => `${id}|${date}`;
  const punchesBy = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    if (record.userId) punchesBy.set(punchKey(record.userId, record.workDate), record);
    if (record.employeeId) punchesBy.set(punchKey(record.employeeId, record.workDate), record);
  }
  const leavesBy = new Map<string, Leave[]>();
  for (const leave of approvedLeaves) {
    leavesBy.set(leave.userId, [...(leavesBy.get(leave.userId) ?? []), leave]);
  }
  const leaveOn = (userId: string, day: Date): Leave | undefined =>
    (leavesBy.get(userId) ?? []).find((l) => l.startDate <= day && l.endDate >= day);

  // ── grade every working day ───────────────────────────────────────────
  const people: Record<string, ReportPerson> = {};
  const days: ReportDay[] = [];
  const departments = new Set<string>();
  const templateNames = new Set<string>();
  const leaveTypes = new Set<string>();
  const punchFormats = new Set<string>();
  const managers = new Set<string>();
  const nameOf = new Map(roster.map((u) => [u.userId, u.name]));
  const first = dayOf(from).getTime();
  const last = dayOf(to).getTime();

  for (const user of roster) {
    // The row that names the person describes where they stand at the end of
    // the range; each day below is graded on its own.
    const policy = policyOn(user, to);
    const department = user.department || '—';
    departments.add(department);
    punchFormats.add(policy.correction.punchFormat);
    if (policy.templateName) templateNames.add(policy.templateName);
    const manager = (user.managerUserId && nameOf.get(user.managerUserId)) || '';
    if (manager) managers.add(manager);
    people[user.userId] = {
      name: user.name,
      employeeId: user.employeeId ?? '—',
      department,
      location: user.location ?? user.branch ?? '—',
      template: policy.templateName,
      punchFormat: policy.correction.punchFormat,
      manager,
    };

    for (let t = first; t <= last; t += DAY_MS) {
      const day = new Date(t);
      const key = keyOf(day);
      // The shift that covered this day, which is not always today's.
      const onDay = policyOn(user, key);
      // Not a day they owed us, so not a day to grade.
      if (isWeekOffDay(day, onDay.weeklyOff) || isHoliday(user, key)) continue;

      const leave = leaveOn(user.userId, day);
      if (leave) {
        leaveTypes.add(leave.type);
        days.push([user.userId, key, 'on_leave', 0, null, null, leave.type, null, 0]);
        continue;
      }

      // Present by default: nobody punches, so a working day is a present day.
      if (onDay.correction.punchFormat === 'Present by default (Auto Punch)') {
        days.push([user.userId, key, 'present', 0, null, null, null, null, 0]);
        continue;
      }

      const record = punchesBy.get(punchKey(user.userId, key)) ?? punchesBy.get(punchKey(user.employeeId ?? '', key));
      // Read as they should be, not as the device filed them: a reversed pair
      // is a morning shift, and one tap recorded twice is one punch.
      const { punchIn, punchOut } = normalisePunches(
        onDay,
        record?.punchIn ? new Date(record.punchIn) : null,
        record?.punchOut ? new Date(record.punchOut) : null,
      );
      const singlePunch = onDay.correction.punchMode === 'Single punch';
      const missing = singlePunch ? !punchIn : !punchIn || !punchOut;
      // Nothing at all on a working day is an absence; half a record is a gap
      // in the record, which is a different conversation and a different fix.
      const nothing = !punchIn && !punchOut;
      const mark = markForDay(onDay, punchIn, punchOut);
      const over = punchIn ? lateBy(punchIn, onDay.startTime, onDay.lateGraceMinutes) : 0;
      // A single-punch shift has no punch-out to leave early on.
      const short = punchOut && !singlePunch ? earlyBy(punchOut, onDay.startTime, onDay.endTime, onDay.earlyOutGraceMinutes) : 0;
      const status: DayStatus = nothing
        ? 'absent'
        : missing
          ? 'missed_punch'
          : mark === 'Present'
            ? 'present'
            : mark === 'Half Day'
              ? 'half_day'
              : 'absent';

      days.push([
        user.userId, key, status, over,
        punchIn ? punchIn.toISOString() : null,
        punchOut ? punchOut.toISOString() : null,
        null,
        record?.source ?? null,
        short,
      ]);
    }
  }

  const report: AttendanceReport = {
    from,
    to,
    departments: [...departments].sort(),
    templates: [...templateNames].sort(),
    leaveTypes: [...leaveTypes].sort(),
    punchFormats: [...punchFormats].sort(),
    managers: [...managers].sort(),
    people,
    days,
  };
  reportCache.set(cacheKey, { expires: Date.now() + REPORT_TTL_MS, value: report });
  return report;
}

async function adminOrg(adminUserId: string): Promise<string> {
  const hit = adminOrgCache.get(adminUserId);
  if (hit && hit.expires > Date.now()) return hit.org;
  const admin = await users().findOne({ userId: adminUserId }, { projection: { _id: 0, org: 1 } });
  if (!admin?.org) throw new ReportError(403, 'No organisation on this account');
  adminOrgCache.set(adminUserId, { expires: Date.now() + ADMIN_ORG_TTL_MS, org: admin.org });
  return admin.org;
}


// ------------------------------------------------------------- one person's month

export type CalendarDayStatus = DayStatus | 'week_off' | 'holiday' | 'upcoming';

export interface CalendarDay {
  date: string;
  status: CalendarDayStatus;
  /** The holiday's name, the leave type, or which punch is missing. */
  label: string | null;
  punchIn: string | null;
  punchOut: string | null;
  lateByMinutes: number;
  earlyByMinutes: number;
}

export interface EmployeeCalendar {
  month: string;
  shift: string;
  window: string;
  punchFormat: string;
  days: CalendarDay[];
  totals: Record<CalendarDayStatus, number>;
}

/**
 * A month of one employee's days, the way the app's calendar shows them —
 * every day, including the ones nobody worked: week-offs and holidays are
 * named rather than skipped, and days still to come are marked as such rather
 * than graded absent. Working days are graded exactly as the org report
 * grades them, by the same resolver and the same punch normalisation.
 */
export async function employeeCalendar(
  adminUserId: string,
  userId: string,
  monthInput: string,
): Promise<EmployeeCalendar> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput)) throw new ReportError(400, 'month must be YYYY-MM');
  const [year, month] = monthInput.split('-').map(Number);
  const from = `${monthInput}-01`;
  const to = `${monthInput}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;

  const org = await adminOrg(adminUserId);
  const setup = await orgSetup(org);
  const user = setup.roster.find((u) => u.userId === userId);
  if (!user) throw new ReportError(404, 'Employee not found');
  const policyOn = dayPolicyResolver(setup);

  const [records, approvedLeaves, holidayRows] = await Promise.all([
    attendanceRecords()
      .find({
        workDate: { $gte: from, $lte: to },
        $or: [{ userId }, ...(user.employeeId ? [{ employeeId: user.employeeId }] : [])],
      })
      .toArray(),
    leaves()
      .find({ userId, status: 'approved', startDate: { $lte: dayOf(to) }, endDate: { $gte: dayOf(from) } })
      .toArray(),
    // The roster row carries no org, and without one the lookup returns nothing.
    holidaysForUser({ ...user, org }, { from: dayOf(from), to: dayOf(to) }),
  ]);
  const punchByDate = new Map(records.map((r) => [r.workDate, r]));
  const holidayByDate = new Map(holidayRows.map((h) => [keyOf(h.date), h.name]));
  const today = keyOf(new Date());

  const totals: Record<CalendarDayStatus, number> = {
    present: 0, half_day: 0, missed_punch: 0, absent: 0, on_leave: 0, week_off: 0, holiday: 0, upcoming: 0,
  };
  const days: CalendarDay[] = [];
  const add = (
    date: string, status: CalendarDayStatus, label: string | null = null,
    punchIn: Date | null = null, punchOut: Date | null = null, lateByMinutes = 0, earlyByMinutes = 0,
  ) => {
    totals[status] += 1;
    days.push({
      date, status, label,
      punchIn: punchIn ? punchIn.toISOString() : null,
      punchOut: punchOut ? punchOut.toISOString() : null,
      lateByMinutes,
      earlyByMinutes,
    });
  };

  for (let t = dayOf(from).getTime(); t <= dayOf(to).getTime(); t += DAY_MS) {
    const day = new Date(t);
    const key = keyOf(day);
    const onDay = policyOn(user, key);
    const holiday = holidayByDate.get(key);
    if (holiday) { add(key, 'holiday', holiday); continue; }
    if (isWeekOffDay(day, onDay.weeklyOff)) { add(key, 'week_off', 'Week off'); continue; }
    const leave = approvedLeaves.find((l) => l.startDate <= day && l.endDate >= day);
    if (leave) { add(key, 'on_leave', leave.type); continue; }
    if (key > today) { add(key, 'upcoming'); continue; }
    if (onDay.correction.punchFormat === 'Present by default (Auto Punch)') { add(key, 'present', 'Auto punch'); continue; }

    const record = punchByDate.get(key);
    const { punchIn, punchOut } = normalisePunches(
      onDay,
      record?.punchIn ? new Date(record.punchIn) : null,
      record?.punchOut ? new Date(record.punchOut) : null,
    );
    const singlePunch = onDay.correction.punchMode === 'Single punch';
    const missing = singlePunch ? !punchIn : !punchIn || !punchOut;
    const nothing = !punchIn && !punchOut;
    const mark = markForDay(onDay, punchIn, punchOut);
    const late = punchIn ? Math.max(0, lateBy(punchIn, onDay.startTime, onDay.lateGraceMinutes)) : 0;
    const short = punchOut && !singlePunch ? earlyBy(punchOut, onDay.startTime, onDay.endTime, onDay.earlyOutGraceMinutes) : 0;
    const status: DayStatus = nothing
      ? 'absent'
      : missing
        ? 'missed_punch'
        : mark === 'Present' ? 'present' : mark === 'Half Day' ? 'half_day' : 'absent';
    const label = nothing ? 'No punch' : missing ? (punchIn ? 'Missing punch-out' : 'Missing punch-in') : null;
    add(key, status, label, punchIn, punchOut, late, short);
  }

  const current = policyOn(user, today);
  return {
    month: monthInput,
    shift: current.templateName ?? 'Org policy',
    window: `${current.startTime} – ${current.endTime}`,
    punchFormat: current.correction.punchFormat,
    days,
    totals,
  };
}
