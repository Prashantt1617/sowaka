/**
 * Checks Suwi's prepare_bulk_mark_day (24 Nov, Convrse: "those who were present on 10 Nov, mark a
 * holiday for them on 11 Nov"): one card for the whole group, picked by what their day was on another
 * date; Confirm marks every one, Undo puts every day back. On a scratch database only:
 *   MONGODB_DB=suwi_markday_scratch npx tsx src/scripts/suwi-bulk-mark-day-check.ts
 */
import { attendanceOverrides, connectDb, getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiLevel } from '../suwi/tools';
import { setAttendanceOverride } from '../services/attendance-override.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId[0].toUpperCase() + userId.slice(1), email: `${userId}@x.test`, org: 'acme', lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), ...extra,
} as User);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 8);
  const day1 = `${month}02`, day2 = `${month}03`;
  if (today <= day2) { console.log('Run after the 3rd of the month'); process.exit(0); }
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true }),
    person('asha', { department: 'Sales' }), person('ravi', { department: 'Sales' }), person('meena', { department: 'Ops' }),
    person('late', { joiningDate: new Date(`${day2}T00:00:00Z`) }),
  ]);
  // What their day 1 was: HR's marks stand in for punches (they replace the graded day everywhere).
  await setAttendanceOverride('founder', 'asha', day1, { status: 'present' });
  await setAttendanceOverride('founder', 'ravi', day1, { status: 'half_day' });
  await setAttendanceOverride('founder', 'meena', day1, { status: 'absent' });
  await setAttendanceOverride('founder', 'asha', day2, { status: 'absent', note: 'earlier' });
  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, today);
  const tool = toolByName('prepare_bulk_mark_day')!;
  ok('the tool is registered', Boolean(tool));

  console.log('Those present on day 1 get day 2 as a holiday');
  const out = await tool.run(ctx, { date: day2, status: 'holiday', onDate: day1, hadStatus: 'present', note: 'Worked on day 1' });
  const card = await getProposal('founder', 'acme', out.proposalId!);
  const names = card.preview?.rows.map((r) => r.name).sort();
  ok('one card for Asha (present) and Ravi (half day), not Meena (absent)', JSON.stringify(names) === JSON.stringify(['Asha', 'Ravi']), card.preview);
  ok('the card shows Asha\'s earlier HR mark as her current day', card.preview?.rows.find((r) => r.name === 'Asha')?.current === 'Absent (HR)', card.preview?.rows);
  ok('nothing is saved before Confirm', (await attendanceOverrides().countDocuments({ workDate: day2, status: 'holiday' })) === 0);
  await confirmProposal('founder', 'acme', out.proposalId!);
  ok('Confirm marks both', (await attendanceOverrides().countDocuments({ workDate: day2, status: 'holiday', userId: { $in: ['asha', 'ravi'] } })) === 2);
  await undoProposal('founder', 'acme', out.proposalId!);
  const asha = await attendanceOverrides().findOne({ userId: 'asha', workDate: day2 });
  ok('Undo puts Asha\'s earlier mark back and clears Ravi\'s', asha?.status === 'absent' && asha?.note === 'earlier' && !(await attendanceOverrides().findOne({ userId: 'ravi', workDate: day2 })), asha);

  console.log('Everyone, with the ones that cannot be marked left out');
  const all = await tool.run(ctx, { date: day1, status: 'holiday', everyone: true });
  const c2 = await getProposal('founder', 'acme', all.proposalId!);
  const reasons = c2.preview?.skipped.map((k) => `${k.who}: ${k.reason}`) ?? [];
  ok('the asker and someone who joined later are left out with the reason', reasons.some((r) => r.startsWith('Founder') && /own/.test(r)) && reasons.some((r) => r.startsWith('Late') && /Joined/.test(r)), reasons);
  ok('the other three are on the card', c2.preview?.rows.length === 3, c2.preview?.rows);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
