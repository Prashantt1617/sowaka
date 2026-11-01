/**
 * Checks pay periods from the database (payroll_periods): a company with no
 * rows is paid by the calendar month as before; a cycle starting on the 26th
 * pays 26th to 25th; one month can carry its own dates or base days; a run
 * reads attendance for its own dates, counts a joiner from the cycle's first
 * day, and keeps its dates; HR's day marks follow the run's dates. On a
 * scratch database only:
 *   MONGODB_DB=payroll_period_scratch npm run payroll:period-check
 */
import { attendanceRecords, connectDb, getDb, paidDaysTemplates, payHeads, payrollPeriods, payrollRuns, payslips, salaryStructures, salaryTemplates, users } from '../config/db';
import type { User } from '../models/user.model';
import { AttendanceRecord } from '../models/attendance.model';
import { AttendanceOverrideError, setAttendanceOverride } from '../services/attendance-override.service';
import { attendanceReport, employeeCalendar } from '../services/attendance-report.service';
import { parsePeriod, payrollPeriodHolding, payrollPeriodRange } from '../services/payroll-inputs.service';
import { createRun, recomputeRun } from '../services/payrollRun.service';
import { createShift, setDefaultShift } from '../services/shift.service';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}

const ORG = 'periodcheck';
const PLAIN = 'periodplain';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);
const setting = (period: string, extra: Record<string, unknown>) =>
  payrollPeriods().replaceOne({ org: ORG, period }, { org: ORG, period, ...extra, updatedAt: new Date() }, { upsert: true });

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  console.log('the dates');
  const plain = await payrollPeriodRange(PLAIN, '2026-09');
  const calendar = parsePeriod('2026-09');
  ok('no rows: the calendar month, as before', plain.from === '2026-09-01' && plain.to === '2026-09-30' && plain.baseDays === 30
    && plain.start.getTime() === calendar.start.getTime() && plain.end.getTime() === calendar.end.getTime(), plain);
  await setting('default', { startDay: 26 });
  const sep = await payrollPeriodRange(ORG, '2026-09');
  ok('start day 26: September is 26 Aug – 25 Sep, 31 days', sep.from === '2026-08-26' && sep.to === '2026-09-25' && sep.baseDays === 31, sep);
  const jan = await payrollPeriodRange(ORG, '2027-01');
  ok('January reaches back into December', jan.from === '2026-12-26' && jan.to === '2027-01-25' && jan.baseDays === 31, jan);
  const mar = await payrollPeriodRange(ORG, '2027-03');
  ok('March is 26 Feb – 25 Mar, 28 days', mar.from === '2027-02-26' && mar.to === '2027-03-25' && mar.baseDays === 28, mar);
  ok('the label month stays the period', sep.year === 2026 && sep.month === 9 && sep.daysInMonth === 30, sep);
  await setting('2026-10', { baseDays: 31 });
  const oct = await payrollPeriodRange(ORG, '2026-10');
  ok('one month\'s base days: 26 Sep – 25 Oct on 31 days', oct.from === '2026-09-26' && oct.to === '2026-10-25' && oct.baseDays === 31, oct);
  const nov = await payrollPeriodRange(ORG, '2026-11');
  ok('the next month is back to the cycle', nov.from === '2026-10-26' && nov.to === '2026-11-25' && nov.baseDays === 31, nov);
  await setting('2026-12', { from: '2026-12-01', to: '2026-12-20' });
  const dec = await payrollPeriodRange(ORG, '2026-12');
  ok('one month\'s own dates, base days from them', dec.from === '2026-12-01' && dec.to === '2026-12-20' && dec.baseDays === 20, dec);
  ok('the day 27 Sep is October\'s', (await payrollPeriodHolding(ORG, '2026-09-27'))?.from === '2026-09-26');
  ok('the day 25 Sep is September\'s', (await payrollPeriodHolding(ORG, '2026-09-25'))?.from === '2026-08-26');
  await setting('2027-02', { from: '2027-02-30' });
  ok('a date that does not exist is refused', (await refusal(() => payrollPeriodRange(ORG, '2027-02'))).status === 409);
  await setting('2027-02', { from: '2027-02-20', to: '2027-02-10' });
  ok('dates the wrong way round are refused', (await refusal(() => payrollPeriodRange(ORG, '2027-02'))).status === 409);
  await setting('2027-02', { baseDays: 0 });
  ok('no base days is refused', (await refusal(() => payrollPeriodRange(ORG, '2027-02'))).status === 409);
  await payrollPeriods().deleteOne({ org: ORG, period: '2027-02' });
  await setting('default', { startDay: 30 });
  ok('a start day past the 28th is refused', /1 to 28/.test((await refusal(() => payrollPeriodRange(ORG, '2026-09'))).message));
  await setting('default', { startDay: 26 });

  console.log('a run on the cycle');
  // HR, someone who worked every day, someone absent on 28 Aug (September's
  // cycle) and on 28 Sep (October's), and someone who joined on 3 September.
  await users().insertMany([
    person('hr', { dashboardAccess: true, employeeId: 'H1' }),
    person('full', { employeeId: 'E1' }),
    person('gap', { employeeId: 'E2' }),
    person('joiner', { employeeId: 'E3', joiningDate: new Date('2026-09-03T00:00:00Z') }),
    person('late', { employeeId: 'E4', joiningDate: new Date('2026-09-28T00:00:00Z') }),
  ]);
  const shift = await createShift('hr', { name: 'General', punchFormat: 'In-app punch in' });
  await setDefaultShift('hr', shift.id);
  const now = new Date();
  const records: AttendanceRecord[] = [];
  for (const [userId, employeeId] of [['full', 'E1'], ['gap', 'E2'], ['joiner', 'E3']]) {
    for (let t = Date.parse('2026-08-20'); t <= Date.parse('2026-09-30'); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (new Date(t).getUTCDay() === 0) continue;
      if (userId === 'gap' && (date === '2026-08-28' || date === '2026-09-28')) continue;
      if (userId === 'joiner' && (date < '2026-09-03' || date === '2026-09-10')) continue;
      records.push({
        userId, employeeId, workDate: date,
        punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:05:00+05:30`),
        source: 'manual', sourceKey: `manual|${employeeId}|${date}`, importedAt: now, updatedAt: now,
      });
    }
  }
  await attendanceRecords().insertMany(records);
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG });
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'Calendar', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now });
  await salaryStructures().insertMany(['full', 'gap', 'joiner', 'late'].map((userId) => ({
    org: ORG, userId, salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 3_72_000_00, status: 'active' as const, createdAt: now, updatedAt: now,
  })));
  const created = await createRun('hr', { period: '2026-09' });
  ok('the run keeps its dates', created.run.periodFrom === '2026-08-26' && created.run.periodTo === '2026-09-25' && created.run.baseDays === 31, created.run);
  const slip = async (userId: string) => (await payslips().findOne({ org: ORG, period: '2026-09', userId }))!;
  let [full, gap] = await Promise.all([slip('full'), slip('gap')]);
  const joiner = await slip('joiner');
  ok('31 base days, nothing lost when every day was worked', full.inputs.workingDays === 31 && full.inputs.lopDays === 0 && full.inputs.payableDays === 31, full.inputs);
  ok('the absence on 28 Aug costs a day; 28 Sep is not this run\'s', gap.inputs.lopDays === 1 && gap.inputs.payableDays === 30, gap.inputs);
  ok('a joiner on 3 Sep: 26 Aug – 2 Sep unpaid (8 days), and the absence on 10 Sep on top', joiner.inputs.lopDays === 9 && joiner.inputs.payableDays === 22, joiner.inputs);
  const lines = joiner.inputs.attendanceDeductions ?? [];
  ok('the payslip explains it: 8 days before joining and 1 absent, adding up', lines.reduce((t, l) => t + l.days, 0) === 9
    && lines.find((l) => l.label === 'Before joining')?.days === 8, lines);
  const joinerCal = await employeeCalendar('hr', 'joiner', '2026-09');
  const calDay = (date: string) => joinerCal.days.find((d) => d.date === date);
  ok('the calendar leaves the days before joining empty', calDay('2026-09-01')?.status === 'before_joining' && calDay('2026-09-02')?.status === 'before_joining'
    && calDay('2026-09-03')?.status === 'present' && calDay('2026-09-10')?.status === 'absent' && joinerCal.totals.absent === 1, joinerCal.totals);
  const report = await attendanceReport('hr', { from: '2026-08-26', to: '2026-09-25' });
  const joinerDays = report.days.filter((d) => d[0] === 'joiner');
  ok('the report grades nothing before joining', joinerDays.length > 0 && joinerDays.every((d) => d[1] >= '2026-09-03'), joinerDays.slice(0, 2));
  ok('paid by the days: a day short is a 31st less', Math.abs(full.grossPaise - gap.grossPaise - Math.round(full.grossPaise / 31)) <= 100, { full: full.grossPaise, gap: gap.grossPaise });
  ok('a joiner after the period is not on it', !(await payslips().findOne({ org: ORG, period: '2026-09', userId: 'late' })));
  await recomputeRun('hr', created.run.id, { lopDays: { late: 26 } });
  const late = await slip('late');
  ok('unless HR types their loss of pay: 5 of 31 days paid', late?.inputs.lopEnteredByHr === true && late.inputs.payableDays === 5, late?.inputs);

  await setting('2026-09', { baseDays: 30 });
  const again = await recomputeRun('hr', created.run.id, {});
  [full, gap] = await Promise.all([slip('full'), slip('gap')]);
  ok('recomputed on the month\'s own base days', again.baseDays === 30 && full.inputs.workingDays === 30 && gap.inputs.payableDays === 29, { run: again, gap: gap.inputs });
  await setting('2026-09', { from: '2026-09-01', to: '2026-09-30' });
  await recomputeRun('hr', created.run.id, {});
  gap = await slip('gap');
  ok('on its own dates, 28 Sep counts and 28 Aug does not', gap.inputs.lopDays === 1 && gap.inputs.workingDays === 30
    && (await payrollRuns().findOne({ org: ORG, period: '2026-09' }))?.periodFrom === '2026-09-01', gap.inputs);
  await payrollPeriods().deleteOne({ org: ORG, period: '2026-09' });
  await recomputeRun('hr', created.run.id, {});

  console.log('HR\'s day marks follow the run\'s dates');
  const mark = (date: string) => refusal(() => setAttendanceOverride('hr', 'gap', date, { status: 'present' }));
  ok('a day in August the open September run pays can be marked', (await mark('2026-08-28')).message === '');
  const early = await mark('2026-08-20');
  ok('a day before it cannot', early.status === 400 && /pay period/.test(early.message), early);
  const beforeJoining = await refusal(() => setAttendanceOverride('hr', 'joiner', '2026-09-01', { status: 'present' }));
  ok('a day before someone joined cannot be marked', beforeJoining.status === 400 && /joined on 2026-09-03/.test(beforeJoining.message), beforeJoining);
  const october = await mark('2026-09-28');
  ok('28 Sep is October\'s, which has no run', october.status === 400, october);
  await payrollRuns().updateOne({ org: ORG, period: '2026-09' }, { $set: { status: 'paid' } });
  const shut = await mark('2026-09-01');
  ok('once the run is paid its days are shut', shut.status === 409 && /2026-09/.test(shut.message), shut);
  ok('the error is the marks\' own', (await refusal(() => setAttendanceOverride('hr', 'gap', '2026-08-27', { status: 'present' }))).status === 409
    && AttendanceOverrideError.name === 'AttendanceOverrideError');

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
