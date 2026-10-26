/**
 * Checks the profile's Activity list: a details save, a manager change, a
 * shift move and a Suwi card each leave one line saying who changed what from
 * what to what, and from where; a save that changes nothing leaves none; name
 * and work email can't be edited through Suwi. On a scratch database only:
 *   MONGODB_DB=employee_activity_scratch npx tsx src/scripts/employee-activity-check.ts
 */
import { connectDb, employeeActivity, getDb, shiftTemplates, users } from '../config/db';
import type { User } from '../models/user.model';
import { updateEmployeeDetailsForAdmin } from '../services/admin.service';
import { listEmployeeActivity } from '../services/employee-activity.service';
import { assignManager, removeManager } from '../services/reporting.service';
import { assignShiftToUsers } from '../services/shift.service';
import { confirmProposal, undoProposal } from '../suwi/proposals';
import '../suwi/registry';
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

/** Lines are written after the change returns; wait for `n` of them. */
async function linesFor(userId: string, n: number) {
  for (let i = 0; i < 40; i++) {
    const rows = await employeeActivity().find({ userId }).sort({ _id: 1 }).toArray();
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 150));
  }
  return employeeActivity().find({ userId }).sort({ _id: 1 }).toArray();
}

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await users().insertMany([
    person('founder', { canEditEmployeeDetails: true, dashboardAccess: true, dashboardAdmin: true, employeeId: 'F1' }),
    person('staff', { managerUserId: 'founder', employeeId: 'S1', department: 'Sales' }),
    person('trainee', { managerUserId: 'staff', employeeId: 'T1' }),
  ]);

  console.log('Details');
  await updateEmployeeDetailsForAdmin('founder', 'staff', { department: 'Ops', designation: 'Lead', name: 'Staff' });
  let rows = await linesFor('staff', 1);
  ok('one line for the save', rows.length === 1, rows.length);
  ok('lists only the fields that changed', rows[0]?.changes.map((c) => c.field).join() === 'designation,department', rows[0]?.changes);
  ok('old and new value', rows[0]?.changes.find((c) => c.field === 'department')?.from === 'Sales' && rows[0]?.changes.find((c) => c.field === 'department')?.to === 'Ops');
  ok('who and where', rows[0]?.byName === 'Founder' && rows[0]?.via === 'dashboard', rows[0]);
  ok('titled by the two fields', rows[0]?.title === 'Designation and Department updated', rows[0]?.title);
  await updateEmployeeDetailsForAdmin('founder', 'staff', { department: 'Ops' });
  await new Promise((r) => setTimeout(r, 800));
  ok('a save that changes nothing leaves no line', (await employeeActivity().countDocuments({ userId: 'staff' })) === 1);

  console.log('Reporting manager');
  await assignManager('founder', 'trainee', 'founder');
  rows = await linesFor('trainee', 1);
  ok('manager change: from and to by name', rows[0]?.kind === 'manager' && rows[0]?.changes[0]?.from === 'Staff' && rows[0]?.changes[0]?.to === 'Founder', rows[0]);
  await removeManager('founder', 'trainee');
  rows = await linesFor('trainee', 2);
  ok('manager removed', rows[1]?.title === 'Reporting manager removed' && rows[1]?.changes[0]?.from === 'Founder', rows[1]);

  console.log('Shift');
  const base = { org: 'acme', active: true, assignedUserIds: [], policy: {}, createdAt: new Date(), updatedAt: new Date() };
  await shiftTemplates().insertOne({ ...base, name: 'General', isDefault: true } as never);
  const night = await shiftTemplates().insertOne({ ...base, name: 'Night', isDefault: false } as never);
  await assignShiftToUsers('founder', night.insertedId.toHexString(), ['trainee']);
  rows = await linesFor('trainee', 3);
  ok('shift move from the Default, starting tomorrow', rows[2]?.kind === 'shift' && rows[2]?.changes[0]?.from === 'General' && rows[2]?.changes[0]?.to === 'Night' && /^\d{4}-\d{2}-\d{2}$/.test(rows[2]?.effectiveFrom ?? ''), rows[2]);

  console.log('Suwi');
  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, new Date().toISOString().slice(0, 10));
  const tool = toolByName('prepare_edit_details')!;
  ok('the tool is registered', Boolean(tool));
  for (const locked of [{ name: 'New Name' }, { email: 'new@x.test' }]) {
    try {
      await tool.run(ctx, { person: 'S1', ...locked });
      ok(`refuses ${Object.keys(locked)[0]}`, false, 'prepared');
    } catch (e) {
      ok(`refuses ${Object.keys(locked)[0]}`, /can't be edited/.test((e as Error).message), (e as Error).message);
    }
  }
  const same = await tool.run(ctx, { person: 'S1', department: 'Ops' });
  ok('nothing to do when it already says that', (same.data as { nothingToDo?: boolean }).nothingToDo === true, same.data);
  const prepared = await tool.run(ctx, { person: 'S1', department: 'Finance', mobile: '9999900000' });
  ok('prepares a card', Boolean(prepared.proposalId));
  ok('nothing saved before Confirm', (await users().findOne({ userId: 'staff' }))?.department === 'Ops');
  await confirmProposal('founder', 'acme', prepared.proposalId!);
  ok('Confirm saves', (await users().findOne({ userId: 'staff' }))?.department === 'Finance');
  rows = await linesFor('staff', 2);
  ok('the line says via Suwi, with the card', rows[1]?.via === 'suwi' && rows[1]?.proposalTitle === "Update Staff's basic details", rows[1]);
  await undoProposal('founder', 'acme', prepared.proposalId!);
  const back = await users().findOne({ userId: 'staff' });
  ok('Undo puts both fields back', back?.department === 'Ops' && !back?.phone, { department: back?.department, phone: back?.phone });
  rows = await linesFor('staff', 3);
  ok('Undo leaves its own line', rows[2]?.via === 'suwi' && rows[2]?.proposalTitle?.startsWith('Undo:') === true, rows[2]);

  console.log('Reading');
  const page = await listEmployeeActivity('founder', 'staff', { limit: 2 });
  ok('newest first, a page at a time', page.items.length === 2 && page.more && page.items[0].proposalTitle?.startsWith('Undo:') === true, page);
  const rest = await listEmployeeActivity('founder', 'staff', { before: page.items[1].id, limit: 2 });
  ok('the next page carries on', rest.items.length === 1 && !rest.more, rest);
  await users().insertOne(person('outsider', { org: 'other' }));
  try {
    await listEmployeeActivity('outsider', 'staff');
    ok('another company cannot read it', false, 'read');
  } catch {
    ok('another company cannot read it', true);
  }

  await db.dropDatabase();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
