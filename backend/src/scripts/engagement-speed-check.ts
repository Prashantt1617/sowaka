/**
 * Engagement speed check, on a scratch database only.
 *
 *   MONGODB_DB=engagement_speed_scratch npm run engagement-speed:check
 *
 * Seeds an org of fifty people with two months of punches (full days, missed
 * punch-outs, absences, leave, HR's marks, imported rows keyed by employee id
 * only, a single-punch and a present-by-default shift), app activity and game
 * plays, plus a noisy second org, then checks:
 *   - App usage's missed-punch people (graded directly) are exactly the ones
 *     Reports › Attendance shows a missed punch or an unmarked absence for;
 *   - Engagement answers are remembered, and a plan edit shows at once.
 */
import { attendanceOverrides, attendanceRecords, closeDb, companies, connectDb, gameCatalog, getDb, holidays, leaves, shiftAssignments, users } from '../config/db';
import type { AttendanceOverride, AttendanceRecord } from '../models/attendance.model';
import type { Leave } from '../models/leave.model';
import type { User } from '../models/user.model';
import { appActivity } from '../services/app-activity.service';
import { attendanceReport, missedPunchPeople } from '../services/attendance-report.service';
import { forgetEngagement } from '../services/engagement-cache';
import { gamesOverview } from '../services/engagement-games.service';
import { addPlanItem, deletePlanItem, planFor } from '../services/engagement-plan.service';
import { usageSummary, usageTrend, usageWhen } from '../services/engagement-usage.service';
import { pointEvents } from '../services/points-ledger.service';
import { assignShiftToUsers, createShift, setDefaultShift } from '../services/shift.service';

export const ORG = 'speedorg';
const NOISE_ORG = 'speednoise';
export const HR = 'speed-hr';
const DAY_MS = 86_400_000;
const IST = 330 * 60_000;

const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

let failures = 0;
function ok(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? `\n      ${detail}` : ''}`);
}

/** A small deterministic random, so every run seeds the same org. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const person = (org: string, userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@speed.test`, org, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

/** Drop and seed the scratch database. `people` in the main org, `days` back from today. */
export async function seedSpeedOrg(people = 50, days = 60): Promise<void> {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  // A fresh connection puts the indexes back, as the server has them.
  await closeDb();
  await connectDb();
  const rand = rng(7);
  const today = istToday();
  const from = addDays(today, -(days - 1));
  const now = new Date();

  const ids = Array.from({ length: people }, (_, i) => `speed-${String(i).padStart(3, '0')}`);
  await users().insertMany([
    person(ORG, HR, { dashboardAccess: true, employeeId: 'SPH1', department: 'HR', location: 'Pune' } as Partial<User>),
    ...ids.map((id, i) => person(ORG, id, {
      employeeId: `SP${i}`,
      department: ['Design', 'Build', 'Sales'][i % 3],
      location: i % 4 === 0 ? 'Delhi' : 'Pune',
      managerUserId: i < 5 ? HR : ids[i % 5],
      // A few joined part-way through the range.
      joiningDate: new Date(`${i % 17 === 3 ? addDays(from, 20) : '2025-01-01'}T00:00:00Z`),
      lastLoginAt: i % 6 === 0 ? undefined : new Date(),
    })),
  ]);

  const general = await createShift(HR, { name: 'General', punchFormat: 'In-app punch in' });
  await setDefaultShift(HR, general.id);
  const single = await createShift(HR, { name: 'Single', punchFormat: 'In-app punch in', punchMode: 'Single punch' });
  const auto = await createShift(HR, { name: 'Auto', punchFormat: 'Present by default (Auto Punch)' });
  await assignShiftToUsers(HR, single.id, ids.slice(40, 45));
  await assignShiftToUsers(HR, auto.id, ids.slice(45, 48));
  // Assignments start tomorrow: back-date them so the whole range is graded on them.
  await shiftAssignments().updateMany({ org: ORG }, { $set: { effectiveFrom: addDays(from, -30) } });

  await holidays().insertMany([
    { org: ORG, state: '*', date: new Date(`${addDays(from, 9)}T00:00:00Z`), name: 'Everyone', type: 'Public', createdAt: now.getTime() },
    { org: ORG, state: 'delhi', date: new Date(`${addDays(from, 23)}T00:00:00Z`), name: 'Delhi day', type: 'Public', createdAt: now.getTime() },
  ] as never[]);

  const records: AttendanceRecord[] = [];
  const marks: AttendanceOverride[] = [];
  const leaveRows: Leave[] = [];
  const activity: { org: string; userId: string; day: string; hours: number[]; did: string[]; firstAt: Date }[] = [];
  const plays: Record<string, unknown>[] = [];
  ids.forEach((id, i) => {
    // Most people are diligent; a few miss a punch or a day now and then.
    const sloppy = i % 3 === 0 ? 0.08 : 0.004;
    for (let d = 0; d < days; d += 1) {
      const date = addDays(from, d);
      const r = rand();
      if (r < 0.01) {
        marks.push({ org: ORG, userId: id, workDate: date, status: rand() < 0.5 ? 'absent' : 'present', setByUserId: HR, setAt: now });
      } else if (r < 0.02) {
        leaveRows.push({ userId: id, type: 'casual', startDate: new Date(`${date}T00:00:00Z`), endDate: new Date(`${date}T00:00:00Z`), reason: 'x', status: 'approved', halfDay: rand() < 0.3, createdAt: now.getTime() } as unknown as Leave);
      }
      const roll = rand();
      if (roll >= sloppy) {
        const imported = i % 10 === 7;
        const missOut = roll < sloppy * 2 && date < today;
        records.push({
          ...(imported ? {} : { userId: id }),
          employeeId: `SP${i}`, workDate: date,
          punchIn: new Date(`${date}T09:${String(Math.floor(rand() * 40)).padStart(2, '0')}:00+05:30`),
          ...(missOut ? {} : { punchOut: new Date(`${date}T${rand() < 0.05 ? '12' : '18'}:30:00+05:30`) }),
          ...(imported ? {} : { punchInLocation: { latitude: 18.5, longitude: 73.8, accuracy: 12, officeName: 'Pune' } as never }),
          source: imported ? 'sql_import' : 'manual', sourceKey: `${imported ? 'sql' : 'manual'}|SP${i}|${date}`, importedAt: now, updatedAt: now,
        } as AttendanceRecord);
      }
      if (rand() < 0.7) {
        activity.push({ org: ORG, userId: id, day: date, hours: [9, 10, 13, 17].filter(() => rand() < 0.6), did: rand() < 0.1 ? ['payslips'] : [], firstAt: now });
      }
      for (let k = 0; k < 5; k += 1) {
        if (rand() < 0.5) plays.push({ org: ORG, userId: id, reason: 'game', gameKey: ['tile-up', 'scribble', 'pool'][k % 3], delta: 5, createdAt: new Date(Date.parse(`${date}T10:00:00Z`) + k * 3_600_000) });
      }
    }
  });
  // A noisy neighbour in the same database: what a shared cluster looks like.
  for (let i = 0; i < 200; i += 1) {
    for (let d = 0; d < days * 2; d += 1) {
      const date = addDays(today, -d);
      records.push({ userId: `noise-${i}`, employeeId: `NZ${i}`, workDate: date, punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:00:00+05:30`), source: 'manual', sourceKey: `manual|NZ${i}|${date}`, importedAt: now, updatedAt: now } as AttendanceRecord);
      activity.push({ org: NOISE_ORG, userId: `noise-${i}`, day: date, hours: [9, 12], did: [], firstAt: now });
    }
  }
  // The Games tab on, with the three games the plays are of.
  await companies().insertOne({ id: ORG, name: 'Speed', enabledTabs: ['games'], enabledGames: ['tile-up', 'scribble', 'pool'] } as never);
  await gameCatalog().insertMany(['tile-up', 'scribble', 'pool'].map((key, order) => ({
    key, name: key, kind: 'native', order, active: true, createdAt: now, updatedAt: now,
  })) as never[]);
  await users().insertMany(Array.from({ length: 200 }, (_, i) => person(NOISE_ORG, `noise-${i}`, { employeeId: `NZ${i}` })));
  await attendanceRecords().insertMany(records);
  await attendanceOverrides().insertMany(marks);
  if (leaveRows.length) await leaves().insertMany(leaveRows);
  await appActivity().insertMany(activity as never[]);
  await pointEvents().insertMany(plays as never[]);
  console.log(`seeded ${people} people × ${days} days: ${records.length} punch rows, ${activity.length} app days, ${plays.length} plays, ${marks.length} HR marks, ${leaveRows.length} leaves`);
}

/** Who Reports › Attendance shows a missed punch or an unmarked absence for: App usage's old rule, off the full report. */
export async function missedFromReport(from: string, to: string): Promise<Set<string>> {
  const report = await attendanceReport(HR, { from, to });
  const out = new Set<string>();
  for (const [userId, , status, , , , , source, , running] of report.days) {
    if (running) continue;
    if (status === 'missed_punch' || (status === 'absent' && source !== 'hr')) out.add(userId);
  }
  return out;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

if (require.main === module) {
  (async () => {
    await seedSpeedOrg();
    const today = istToday();
    const caller = { userId: HR, org: ORG };

    console.log('\nmissed punches, graded directly');
    for (const [label, from, to] of [
      ['last 30 days', addDays(today, -29), today],
      ['last 7 days', addDays(today, -6), today],
      ['a settled fortnight', addDays(today, -40), addDays(today, -27)],
      ['just today', today, today],
    ] as const) {
      const [direct, viaReport] = await Promise.all([missedPunchPeople(ORG, from, to), missedFromReport(from, to)]);
      ok(`${label}: ${direct.size} people, the same as the report`, sameSet(direct, viaReport),
        `direct only: ${[...direct].filter((x) => !viaReport.has(x)).join(',')} · report only: ${[...viaReport].filter((x) => !direct.has(x)).join(',')}`);
    }
    const summary = await usageSummary(caller, { from: addDays(today, -29), to: today });
    const expected = await missedFromReport(addDays(today, -29), today);
    ok('the App usage summary flags exactly those people', summary.missedKnown && summary.people.every((p) => p.missed === expected.has(p.id)));

    console.log('\nremembered answers');
    ok('the summary is remembered', (await usageSummary(caller, { from: addDays(today, -29), to: today })) === summary);
    const when = await usageWhen(ORG, { from: addDays(today, -29), to: today, dept: 'All', loc: 'All' });
    ok('"when" is remembered per filter', (await usageWhen(ORG, { from: addDays(today, -29), to: today, dept: 'All', loc: 'All' })) === when
      && (await usageWhen(ORG, { from: addDays(today, -29), to: today, dept: 'Design', loc: 'All' })) !== when);
    const trend = await usageTrend(ORG, { from: addDays(today, -29), to: today, gran: 'week' });
    ok('the trend is remembered', (await usageTrend(ORG, { from: addDays(today, -29), to: today, gran: 'week' })) === trend);
    const games = await gamesOverview(ORG);
    ok('the games overview is remembered', (await gamesOverview(ORG)) === games && games.plays.length > 0);
    ok('another org gets its own answer', (await gamesOverview(NOISE_ORG)) !== games);

    const before = await planFor(ORG);
    const item = await addPlanItem(ORG, HR, { date: today, kind: 'contest', title: 'Speed check' });
    const after = await planFor(ORG);
    ok('a planned date shows at once', after.entries.length === before.entries.length + 1);
    await deletePlanItem(ORG, item.id);
    ok('and goes at once', (await planFor(ORG)).entries.length === before.entries.length);
    forgetEngagement(ORG);
    ok('forgetting an org drops its answers', (await gamesOverview(ORG)) !== games);

    console.log(failures ? `\n${failures} failed` : '\nall passed');
    await getDb().dropDatabase();
    process.exit(failures ? 1 : 0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
