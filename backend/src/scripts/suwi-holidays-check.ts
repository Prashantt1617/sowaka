/**
 * Checks Suwi's Holiday Bank, leave total and department tools (24 Nov: "mark 7th Nov as holiday for
 * everyone" could only be pointed at Shifts › Holiday Bank). Each card saves nothing until Confirm;
 * Confirm goes through the dashboard's own service; Undo takes it back. On a scratch database only:
 *   MONGODB_DB=suwi_holidays_scratch npx tsx src/scripts/suwi-holidays-check.ts
 */
import { companies, connectDb, getDb, holidays, users } from '../config/db';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiLevel } from '../suwi/tools';
import { createShift, setDefaultShift } from '../services/shift.service';
import { getMyLeaveBalance } from '../services/leave.service';
import { leaves } from '../config/db';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId[0].toUpperCase() + userId.slice(1), email: `${userId}@x.test`, org: 'acme', lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2024-01-01T00:00:00Z'), ...extra,
} as User);
const refused = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (e) { return (e as Error).message; } };

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true }),
    person('asha', { department: 'Sales', designation: 'Executive', state: 'Karnataka' } as Partial<User>),
    person('ravi', { department: 'Ops' }),
  ]);
  const general = await createShift('founder', {
    name: 'General', punchFormat: 'In-app punch in',
    policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [
      { key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 365, allowBackdated: true, backdatedDays: 365 },
    ] } },
  } as never) as { id: string };
  await setDefaultShift('founder', general.id);
  await leaves().insertOne({ userId: 'asha', type: 'casual', startDate: new Date(Date.UTC(year, 0, 5)), endDate: new Date(Date.UTC(year, 0, 6)), days: 2, reason: 'check', status: 'approved', createdAt: new Date(), updatedAt: new Date() } as never);
  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, today);
  for (const n of ['holiday_bank', 'prepare_add_holiday', 'prepare_remove_holiday', 'prepare_set_leave_total', 'prepare_add_department_or_designation']) ok(`${n} is registered`, Boolean(toolByName(n)));

  console.log('Add a holiday for everyone');
  const date = `${year}-11-07`;
  const add = await toolByName('prepare_add_holiday')!.run(ctx, { name: 'Company day', date, locations: ['all'] });
  const card = await getProposal('founder', 'acme', add.proposalId!);
  ok('the card says it is a paid day off that the report and payroll read', /paid day off/.test(card.summary) && card.lines.some((l) => /payroll/.test(l.text)), card);
  ok('nothing is saved before Confirm', (await holidays().countDocuments({ org: 'acme' })) === 0);
  await confirmProposal('founder', 'acme', add.proposalId!);
  const saved = await holidays().findOne({ org: 'acme', date: new Date(`${date}T00:00:00.000Z`) });
  ok('Confirm saves it for all locations', saved?.state === '*' && saved?.name === 'Company day', saved);
  const list = await toolByName('holiday_bank')!.run(ctx, { year });
  ok('holiday_bank lists it as a table', (list.tables?.[0]?.rows.length ?? 0) === 1 && (list.data as { count: number }).count === 1, list.data);
  const again = await toolByName('prepare_add_holiday')!.run(ctx, { name: 'Company day', date });
  ok('adding the same day again is nothing to do', (again.data as { nothingToDo?: boolean }).nothingToDo === true, again.data);
  await undoProposal('founder', 'acme', add.proposalId!);
  ok('Undo removes it', (await holidays().countDocuments({ org: 'acme' })) === 0);

  console.log('Remove a holiday, and undo');
  await holidays().insertOne({ org: 'acme', state: 'karnataka', type: 'Public', date: new Date(`${year}-11-01T00:00:00.000Z`), name: 'Rajyotsava', createdByUserId: 'founder', createdAt: Date.now(), updatedAt: new Date() } as never);
  const rm = await toolByName('prepare_remove_holiday')!.run(ctx, { date: `${year}-11-01` });
  ok('nothing removed before Confirm', (await holidays().countDocuments({ org: 'acme' })) === 1);
  await confirmProposal('founder', 'acme', rm.proposalId!);
  ok('Confirm removes it', (await holidays().countDocuments({ org: 'acme' })) === 0);
  await undoProposal('founder', 'acme', rm.proposalId!);
  const back = await holidays().findOne({ org: 'acme' });
  ok('Undo adds it back for the same location', back?.name === 'Rajyotsava' && back?.state === 'karnataka', back);

  console.log('Set a leave total');
  const casual = async () => (await getMyLeaveBalance('asha', year)).types.find((t) => t.key === 'casual') as { total: number; used: number; remaining: number };
  const before = await casual();
  const low = await refused(() => toolByName('prepare_set_leave_total')!.run(ctx, { userId: 'asha', type: 'Casual Leave', total: 1 }));
  ok('a total below what is taken is refused with the reason', /already taken/.test(low), low);
  const lt = await toolByName('prepare_set_leave_total')!.run(ctx, { userId: 'asha', type: 'casual', total: before.total + 3 });
  const ltCard = await getProposal('founder', 'acme', lt.proposalId!);
  ok('the card shows total, taken and available before and after', ltCard.lines.some((l) => l.text.startsWith('Now: total')) && ltCard.lines.some((l) => l.text.startsWith('After: total')), ltCard.lines);
  ok('nothing changes before Confirm', (await casual()).total === before.total);
  await confirmProposal('founder', 'acme', lt.proposalId!);
  const mid = await casual();
  ok('Confirm sets the total; taken stays', mid.total === before.total + 3 && mid.used === before.used && mid.remaining === before.remaining + 3, { before, mid });
  await undoProposal('founder', 'acme', lt.proposalId!);
  ok('Undo puts the old total back', (await casual()).total === before.total, await casual());

  console.log('Add a department');
  const dep = await toolByName('prepare_add_department_or_designation')!.run(ctx, { kind: 'department', names: ['Finance', 'sales'] });
  const depCard = await getProposal('founder', 'acme', dep.proposalId!);
  ok('the card adds Finance (Sales is already held by someone, so it is saved on the list too)', /Finance/.test(depCard.summary), depCard.summary);
  ok('nothing saved before Confirm', !((await companies().findOne({ id: 'acme' }))?.departmentList?.length));
  await confirmProposal('founder', 'acme', dep.proposalId!);
  const listed = (await companies().findOne({ id: 'acme' }))?.departmentList ?? [];
  ok('Confirm saves the names, keeping the spelling people already hold', listed.includes('Finance') && listed.includes('Sales') && !listed.includes('sales'), listed);
  await undoProposal('founder', 'acme', dep.proposalId!);
  ok('Undo removes them', !((await companies().findOne({ id: 'acme' }))?.departmentList ?? []).includes('Finance'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
