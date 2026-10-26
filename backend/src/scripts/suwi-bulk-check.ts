/**
 * Checks Suwi's Bulk assign from an attached sheet: the sheet is read into rows
 * (quotes, several tabs, headers spelt the usual ways), people are matched by
 * employee ID, email or a name only one person has, unmatched rows come back
 * with their row number, and a column with a value per row becomes one card per
 * value. Confirm and Undo go through the department and manager executors. On a
 * scratch database only:
 *   MONGODB_DB=suwi_bulk_scratch npx tsx src/scripts/suwi-bulk-check.ts
 */
import { connectDb, getDb, users } from '../config/db';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
import { parseSheet } from '../suwi/sheet';
import { contextFor, SUWI_AREAS, toolByName, type SuwiArea, type SuwiLevel } from '../suwi/tools';

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
  console.log('Reading a sheet');
  const plain = parseSheet('people.csv', 'Emp ID,Full Name,Dept\nE1,Asha,Sales\n"E2","Ravi, Jr",Ops\n\nE9,Nobody,Sales\n');
  ok('finds the ID, name and department columns', plain?.idColumn === 'Emp ID' && plain?.nameColumn === 'Full Name' && plain?.fieldColumns.department === 'Dept', plain);
  ok('reads quoted cells with commas, skips blank lines', plain?.rows.length === 3 && plain.rows[1].name === 'Ravi, Jr' && plain.rows[1].values.department === 'Ops', plain?.rows);
  ok('numbers rows as the sheet does', plain?.rows.map((r) => r.row).join() === '2,3,5', plain?.rows.map((r) => r.row));
  const tabs = parseSheet('book.xlsx', '--- Sheet: Notes ---\nSomething,Else\nx,y\n\n--- Sheet: Staff ---\nEmail,Reporting Manager\nA@X.test,Founder\n');
  ok('uses the first tab that names people', tabs?.tab === 'Staff' && tabs.rows[0].email === 'a@x.test' && tabs.rows[0].values.reporting_manager === 'Founder', tabs);
  ok('a manager column is not the person\'s name', tabs?.nameColumn === undefined);
  ok('a sheet that names nobody is not a people sheet', parseSheet('x.csv', 'Month,Total\nOct,3\n') === null);

  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('founder', { canEditEmployeeDetails: true, dashboardAccess: true, dashboardAdmin: true, employeeId: 'F1', department: 'Leadership' }),
    person('asha', { employeeId: 'E1', department: 'Sales', managerUserId: 'founder' }),
    person('ravi', { employeeId: 'E2', department: 'Sales', managerUserId: 'founder' }),
    person('meena', { employeeId: 'E3', department: 'Ops', managerUserId: 'founder' }),
    person('twin', { name: 'Sam', employeeId: 'E4' }),
    person('twin2', { name: 'Sam', employeeId: 'E5' }),
  ]);
  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, new Date().toISOString().slice(0, 10));
  const tool = toolByName('prepare_bulk_assign')!;

  console.log('One value for everyone in the sheet');
  ctx.sheet = parseSheet('move.csv', 'Employee ID,Name\nE1,Asha\nE2,Ravi\nE404,Ghost\n,Sam\nE1,Asha again\n')!;
  const one = await tool.run(ctx, { field: 'department', value: 'Support', fromSheet: true });
  const p1 = await getProposal('founder', 'acme', one.proposalId!);
  ok('prepares one card for the matched rows', Boolean(one.proposalId) && p1.preview?.rows.length === 2, p1.preview);
  const reasons = p1.preview?.skipped.map((k) => `${k.who}: ${k.reason}`) ?? [];
  ok('an unknown ID is skipped with its row', reasons.some((r) => r.startsWith('Row 4 (E404)') && /employee ID/.test(r)), reasons);
  ok('a name two people share is skipped', reasons.some((r) => r.startsWith('Row 5 (Sam)') && /2 people/.test(r)), reasons);
  ok('a repeated row is skipped', reasons.some((r) => r.startsWith('Row 6') && /twice/.test(r)), reasons);
  await confirmProposal('founder', 'acme', one.proposalId!);
  ok('Confirm moves both', (await users().find({ userId: { $in: ['asha', 'ravi'] } }).toArray()).every((u) => u.department === 'Support'));
  await undoProposal('founder', 'acme', one.proposalId!);
  ok('Undo puts both back', (await users().find({ userId: { $in: ['asha', 'ravi'] } }).toArray()).every((u) => u.department === 'Sales'));

  console.log('A value per row');
  ctx.sheet = parseSheet('split.csv', 'Employee ID,Department\nE1,Finance\nE2,Ops\nE3,ops\nF1,\n')!;
  const split = await tool.run(ctx, { field: 'department', fromSheet: true });
  ok('one card per value, spellings merged', split.proposalIds?.length === 2, split.data);
  const cards = await Promise.all((split.proposalIds ?? []).map((id) => getProposal('founder', 'acme', id)));
  const ops = cards.find((c) => c.title.includes('Ops'));
  ok('the Ops card has the two Ops rows, one already there', ops?.preview?.rows.length === 2 && ops.preview.rows.filter((r) => r.current === r.next).length === 1, ops?.preview);
  ok('a row with no value is skipped on a card', cards.some((c) => c.preview?.skipped.some((k) => /No department/.test(k.reason))), cards.map((c) => c.preview?.skipped));

  console.log('Manager from the sheet');
  ctx.sheet = parseSheet('mgr.csv', 'Employee ID\nE2\nE3\nF1\n')!;
  const mgr = await tool.run(ctx, { field: 'reporting_manager', value: 'Asha', fromSheet: true });
  const pm = await getProposal('founder', 'acme', mgr.proposalId!);
  ok('the founder, above Asha, is skipped', pm.preview?.skipped.some((k) => k.who === 'Founder' && /below them/.test(k.reason)) === true, pm.preview?.skipped);
  await confirmProposal('founder', 'acme', mgr.proposalId!);
  ok('Confirm moves Ravi and Meena under Asha', (await users().find({ userId: { $in: ['ravi', 'meena'] } }).toArray()).every((u) => u.managerUserId === 'asha'));
  await undoProposal('founder', 'acme', mgr.proposalId!);
  ok('Undo puts the founder back as their manager', (await users().find({ userId: { $in: ['ravi', 'meena'] } }).toArray()).every((u) => u.managerUserId === 'founder'));

  console.log('Refusals');
  ctx.sheet = undefined;
  try { await tool.run(ctx, { field: 'department', value: 'X', fromSheet: true }); ok('no sheet: says to attach one', false); }
  catch (e) { ok('no sheet: says to attach one', /No sheet is attached/.test((e as Error).message), (e as Error).message); }
  try { await tool.run(ctx, { field: 'work email', value: 'x', everyone: true }); ok('work email refused', false); }
  catch (e) { ok('work email refused', /can't be changed/.test((e as Error).message), (e as Error).message); }

  await db.dropDatabase();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
