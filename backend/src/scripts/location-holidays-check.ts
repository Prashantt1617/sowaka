/**
 * Checks that a holiday keyed to a work location is a holiday for the people
 * at that location everywhere it is decided: the app's holiday list and
 * calendar, the dashboard's attendance report, leave day counts and a payroll
 * run's loss of pay. Holidays used to be matched two ways: the calendar by
 * location, state or branch (trimmed and lowercased), the org report (and so
 * payroll) by the exact state alone, so a Kolkata holiday was a day off in the
 * app and an absence on the payslip. Another location's holiday must still be
 * a normal working day. On a scratch database only (the npm script sets
 * MONGODB_DB=location_holiday_scratch and sends nothing):
 *   npm run location-holidays:check
 */
import {
  attendanceRecords, connectDb, getDb, holidays, paidDaysTemplates, payHeads, payslips, salaryStructures, salaryTemplates, statutoryConfigs, users,
} from '../config/db';
import type { Holiday } from '../models/holiday.model';
import type { User } from '../models/user.model';
import { AttendanceRecord } from '../models/attendance.model';
import { attendanceReport, employeeCalendar, employeeDayStatuses } from '../services/attendance-report.service';
import { attendanceCountsForPeriod } from '../services/deduction.service';
import { holidayAppliesTo, holidayDatesForUser, listCompanyHolidays } from '../services/holiday.service';
import { applyForLeave } from '../services/leave.service';
import { createRun } from '../services/payrollRun.service';
import { createShift, setDefaultShift } from '../services/shift.service';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';
import { STATUTORY_SEED } from './payroll-config-seed-data';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}

const ORG = 'locholcheck';
const MONTH = '2026-09';
const day = (d: number) => `${MONTH}-${String(d).padStart(2, '0')}`;
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

// The week of 14 to 18 September 2026 (Monday to Friday) holds one holiday a
// day, each keyed a different way, and nobody punches on any of them.
const HOLIDAYS: Array<{ date: string; state: string; name: string }> = [
  { date: day(14), state: 'kolkata', name: 'Kolkata day' },
  { date: day(15), state: 'gurgaon', name: 'Gurgaon day' },
  // A row from before holidays moved to work location, keyed by state.
  { date: day(16), state: 'haryana', name: 'Haryana day' },
  { date: day(17), state: '*', name: 'Everywhere day' },
  // An older row still, written before locations were lowercased.
  { date: day(18), state: 'West Bengal', name: 'West Bengal day' },
];
const WEEK = [14, 15, 16, 17, 18].map(day);

// Each person's own holidays in that week; the rest of it is a working day.
const PEOPLE: Array<{ userId: string; employeeId: string; extra: Partial<User>; holidays: string[] }> = [
  { userId: 'kolkata', employeeId: 'K1', extra: { state: 'West Bengal', location: 'Kolkata' }, holidays: [day(14), day(17), day(18)] },
  { userId: 'haryana', employeeId: 'G1', extra: { state: 'Haryana', location: 'Gurgaon' }, holidays: [day(15), day(16), day(17)] },
  // Only a location, typed with stray case and spaces.
  { userId: 'location-only', employeeId: 'L1', extra: { location: ' gurgaon ' }, holidays: [day(15), day(17)] },
  { userId: 'state-only', employeeId: 'S1', extra: { state: 'Haryana' }, holidays: [day(16), day(17)] },
];

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  // A run needs the FY's statutory figures (statutory_configs): no row, no run.
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: new Date(), updatedAt: new Date(), updatedByUserId: null })));

  console.log('the rule');
  ok('a location row matches by location, whatever its case', holidayAppliesTo({ state: 'kolkata' }, { state: 'West Bengal', location: 'Kolkata' }));
  ok('a state row still matches by state', holidayAppliesTo({ state: 'haryana' }, { state: 'Haryana', location: 'Gurgaon' }));
  ok('a branch still counts', holidayAppliesTo({ state: 'noida' }, { branch: 'Noida' }));
  ok('an old mixed-case row matches', holidayAppliesTo({ state: 'West Bengal' }, { state: 'west bengal' }));
  ok('every location, and an old row with none, apply to all', holidayAppliesTo({ state: '*' }, {}) && holidayAppliesTo({ state: '' }, { location: 'Kolkata' }));
  ok('another location does not', !holidayAppliesTo({ state: 'gurgaon' }, { state: 'West Bengal', location: 'Kolkata' }));
  ok('someone with no location gets only the all-locations days', !holidayAppliesTo({ state: 'kolkata' }, {}));

  // ── the org: HR, four people, the week's holidays and a month of punches ─
  await users().insertMany([
    person('hr', { dashboardAccess: true, employeeId: 'H1' }),
    ...PEOPLE.map((p) => person(p.userId, { employeeId: p.employeeId, managerUserId: 'hr', ...p.extra })),
  ]);
  const now = new Date();
  await holidays().insertMany(HOLIDAYS.map((h): Holiday => ({
    org: ORG, state: h.state, date: new Date(`${h.date}T00:00:00Z`), name: h.name, type: 'Public', createdAt: now.getTime(),
  })));
  const shift = await createShift('hr', {
    name: 'General',
    punchFormat: 'In-app punch in',
    policy: {
      leave: {
        approver: 'Reporting manager', hrOverride: true, balanceTracked: true,
        types: [{
          key: 'lwp', name: 'Leave without pay', perMonth: 0, unpaid: true, resetOn: 'calendar_year', carryForwardDays: 0,
          encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 120,
        }],
      },
    },
  });
  await setDefaultShift('hr', shift.id);
  // Every working day of September punched in full, except that week.
  const records: AttendanceRecord[] = [];
  for (const p of PEOPLE) {
    for (let d = 1; d <= 30; d += 1) {
      const date = day(d);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || WEEK.includes(date)) continue;
      records.push({
        userId: p.userId, employeeId: p.employeeId, workDate: date,
        punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:05:00+05:30`),
        source: 'manual', sourceKey: `manual|${p.employeeId}|${date}`, importedAt: now, updatedAt: now,
      });
    }
  }
  await attendanceRecords().insertMany(records);

  console.log('the app: holiday list, calendar and day statuses');
  for (const p of PEOPLE) {
    const listed = (await listCompanyHolidays(p.userId)).map((h) => h.date).sort();
    ok(`${p.userId}: the holiday list is their own`, JSON.stringify(listed) === JSON.stringify(p.holidays), listed);
    const dates = [...(await holidayDatesForUser({ ...p.extra, org: ORG }))].sort();
    ok(`${p.userId}: the shared holiday dates agree`, JSON.stringify(dates) === JSON.stringify(p.holidays), dates);
    const statuses = await employeeDayStatuses(ORG, p.userId, day(14), day(18));
    const wrong = (statuses ?? []).filter((d) => d.status !== (p.holidays.includes(d.date) ? 'holiday' : 'absent'));
    ok(`${p.userId}: the app shows their holidays, and absences on the rest`, statuses?.length === 5 && wrong.length === 0, wrong);
    const cal = await employeeCalendar('hr', p.userId, MONTH);
    ok(`${p.userId}: the dashboard calendar counts the same`, cal.totals.holiday === p.holidays.length && cal.totals.absent === 5 - p.holidays.length, cal.totals);
  }

  console.log('the org attendance report');
  const report = await attendanceReport('hr', { from: day(1), to: day(30) });
  for (const p of PEOPLE) {
    const off = report.offDays.filter((d) => d[0] === p.userId && d[2] === 'holiday').map((d) => d[1]).sort();
    ok(`${p.userId}: their holidays are holidays`, JSON.stringify(off) === JSON.stringify(p.holidays), off);
    const absent = report.days.filter((d) => d[0] === p.userId && d[2] === 'absent').map((d) => d[1]).sort();
    const expected = WEEK.filter((date) => !p.holidays.includes(date));
    ok(`${p.userId}: other locations' holidays are absences`, JSON.stringify(absent) === JSON.stringify(expected), absent);
  }

  console.log('leave day counts');
  // A leave over the whole week charges only the days that were not holidays.
  for (const p of PEOPLE) {
    const leave = await applyForLeave(p.userId, { type: 'lwp', startDate: day(14), endDate: day(18), reason: 'Travel' });
    ok(`${p.userId}: ${5 - p.holidays.length} leave days, their holidays not charged`, leave.days === 5 - p.holidays.length, leave.days);
  }

  console.log('payroll');
  const counts = await attendanceCountsForPeriod('hr', MONTH);
  for (const p of PEOPLE) {
    ok(`${p.userId}: ${5 - p.holidays.length} absences counted`, counts.get(p.userId)?.absent === 5 - p.holidays.length, counts.get(p.userId));
  }
  // A small payroll on the check's own components; no real salary is read.
  // No paid-leave allowance, so every absence shows as loss of pay.
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG });
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'Calendar', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now });
  await salaryStructures().insertMany(PEOPLE.map((p) => ({
    org: ORG, userId: p.userId, salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 3_60_000_00, status: 'active' as const, createdAt: now, updatedAt: now,
  })));
  await createRun('hr', { period: MONTH });
  for (const p of PEOPLE) {
    const slip = await payslips().findOne({ org: ORG, period: MONTH, userId: p.userId });
    const lop = 5 - p.holidays.length;
    ok(`${p.userId}: loss of pay is ${lop} days, none for their own holidays`, slip?.inputs.lopDays === lop && slip?.inputs.payableDays === 30 - lop, slip?.inputs);
  }

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
