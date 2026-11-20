/**
 * Time office › Leave balances: the company-wide read and the Excel import.
 *
 * The batch read gives exactly what each person's own balance says; the import
 * matches rows by Employee ID, then work email; maps columns to leave types by
 * header (or HR's choice); turns available days into a total of available +
 * taken (taken never changes); refuses what it can't use; and what it writes
 * is what the employee's own balance then shows. Made-up people only, on a
 * scratch database:
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27161 MONGODB_DB=leave_balance_import_scratch npm run leave-balance-import:check
 */
import { connectDb, employeeActivity, getDb, leaves, shiftTemplates, users } from '../config/db';
import { createShift, setDefaultShift } from '../services/shift.service';
import { getMyLeaveBalance, leaveBalancesFor, LeaveError, setLeaveTotal } from '../services/leave.service';
import { applyLeaveImport, cancelLeaveImport, listLeaveBalances, planLeaveImport, previewLeaveImport } from '../services/leaveBalanceImport.service';
import type { User } from '../models/user.model';
import { ObjectId } from 'mongodb';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
const ORG = 'lbcheck';
const YEAR = new Date().getUTCFullYear();
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: `Person ${userId}`, email: `${userId}@lb.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
  joiningDate: new Date(`${YEAR - 2}-01-01T00:00:00Z`), ...extra,
} as User);
const type = (key: string, name: string, perMonth: number, extra: Record<string, unknown> = {}) => ({
  key, name, perMonth, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 365, allowBackdated: true, backdatedDays: 365, ...extra,
});
const refusedFor = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (e) { return e instanceof LeaveError ? e.message : String(e); } };
const bal = async (userId: string, key: string) => (await getMyLeaveBalance(userId, YEAR)).types.find((t) => t.key === key) as { total: number; used: number; remaining: number } | undefined;
const day = (m: number, d: number) => new Date(Date.UTC(YEAR, m - 1, d));
const approvedLeave = (userId: string, key: string, from: Date, to: Date, days: number) => ({
  userId, type: key, startDate: from, endDate: to, days, reason: 'check', status: 'approved', createdAt: new Date(), updatedAt: new Date(),
});

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  await users().insertMany([
    person('hr', { name: 'Hr Admin', employeeId: 'LB-HR', dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true }),
    person('mgr', { name: 'Mona Manager', employeeId: 'LB-9', dashboardAccess: true, canEditEmployeeDetails: true, managerUserId: 'hr' }),
    person('p1', { name: 'Asha One', employeeId: 'LB-1', managerUserId: 'mgr', department: 'Art' }),
    person('p2', { name: 'Bilal Two', employeeId: 'LB-2', managerUserId: 'hr', department: 'Art' }),
    person('p3', { name: 'Chen Three', managerUserId: 'hr', department: 'Ops' }), // no Employee ID: matched by email
    person('p4', { name: 'Dev Four', employeeId: 'LB-4', managerUserId: 'hr' }), // on the Lite template (casual only)
    person('p5', { name: 'Esha Five', employeeId: 'LB-7', managerUserId: 'hr' }), // never in the file
    person('gone', { name: 'Gita Gone', employeeId: 'LB-5', lifecycleStatus: 'offboarded' }),
    person('else', { name: 'Elsewhere', employeeId: 'LB-6', org: 'otherorg' }),
  ]);
  const general = await createShift('hr', {
    name: 'General', punchFormat: 'In-app punch in',
    policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [
      type('earned', 'Earned Leave', 1.5),
      type('casual', 'Casual Leave', 1),
      type('emergency', 'Emergency Leave', 0.5),
      type('wfh', 'Work From Home', 2, { resetOn: 'monthly' }),
      type('lwp', 'Leave Without Pay', 0, { unpaid: true }),
    ] } },
  } as never) as { id: string };
  await setDefaultShift('hr', general.id);
  const lite = await createShift('hr', {
    name: 'Lite', punchFormat: 'In-app punch in',
    policy: { leave: { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [type('casual', 'Casual Leave', 1)] } },
  } as never) as { id: string };
  await shiftTemplates().updateOne({ _id: new ObjectId(lite.id) }, { $set: { assignedUserIds: ['p4'] } });
  await leaves().insertMany([
    approvedLeave('p1', 'casual', day(3, 2), day(3, 3), 2),
    approvedLeave('p1', 'earned', day(5, 4), day(5, 4), 1),
    approvedLeave('p2', 'emergency', day(6, 1), day(6, 1), 0.5),
    // Last year's leave, so last year reads as tracked for p2.
    approvedLeave('p2', 'casual', new Date(Date.UTC(YEAR - 1, 7, 1)), new Date(Date.UTC(YEAR - 1, 7, 1)), 1),
  ] as never[]);
  // An earlier HR change to p2's earned total, which the batch must read too.
  await setLeaveTotal('hr', 'p2', 'earned', (await bal('p2', 'earned'))!.total + 3);

  console.log('the company-wide read');
  const activeIds = ['hr', 'mgr', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const people = await users().find({ userId: { $in: activeIds } }).toArray();
  const { balances, failed: unread } = await leaveBalancesFor(people, YEAR);
  ok('a balance for everyone asked', balances.size === activeIds.length && unread.size === 0, { size: balances.size, unread: [...unread] });
  let same = true;
  for (const id of activeIds) {
    const own = await getMyLeaveBalance(id, YEAR);
    if (JSON.stringify(own.types) !== JSON.stringify(balances.get(id)!.types)) { same = false; console.log('   differs for', id, own.types, balances.get(id)!.types); }
  }
  ok('each is exactly what getMyLeaveBalance gives that person', same);
  ok('it reads HR\'s earlier change (p2 earned)', balances.get('p2')!.types.find((t) => t.key === 'earned')!.total === (await bal('p2', 'earned'))!.total);
  ok('p4 has only the Lite template\'s type', balances.get('p4')!.types.map((t) => t.key).join() === 'casual');

  const list = await listLeaveBalances('hr', YEAR);
  ok('the list has every active employee of the company, and nobody else', list.people.map((p) => p.userId).sort().join() === [...activeIds].sort().join(), list.people.map((p) => p.userId));
  ok('every type on any template, unpaid last', list.types.map((t) => t.key).join() === 'earned,casual,emergency,wfh,lwp', list.types);
  ok('monthly and unpaid types are not editable', !list.types.find((t) => t.key === 'wfh')!.editable && !list.types.find((t) => t.key === 'lwp')!.editable);
  ok('the template name comes with each person', list.people.find((p) => p.userId === 'p4')!.template === 'Lite' && list.people.find((p) => p.userId === 'p1')!.template === 'General');
  ok('an admin may set anyone\'s but their own', list.people.filter((p) => p.canEdit).map((p) => p.userId).sort().join() === 'mgr,p1,p2,p3,p4,p5');
  const mgrList = await listLeaveBalances('mgr', YEAR);
  ok('a manager with the right may set only their reports\'', mgrList.people.filter((p) => p.canEdit).map((p) => p.userId).join() === 'p1');

  // A company of 250, read in one go.
  const crowd = Array.from({ length: 250 }, (_, i) => person(`c${i}`, { name: `Crowd ${i}`, employeeId: `LBC-${i}` }));
  await users().insertMany(crowd);
  await leaves().insertMany(crowd.filter((_, i) => i % 3 === 0).map((c) => approvedLeave(c.userId, 'casual', day(4, 6), day(4, 6), 1)) as never[]);
  const t0 = Date.now();
  const big = await listLeaveBalances('hr', YEAR);
  const ms = Date.now() - t0;
  ok(`257 people in one read (${ms} ms on the local scratch db)`, big.people.length === 257 && big.people.every((p) => !p.error) && ms < 5000, { n: big.people.length, ms });
  await users().deleteMany({ userId: { $in: crowd.map((c) => c.userId) } });

  console.log('the import: columns');
  const p1Casual = (await bal('p1', 'casual'))!;
  const p1Earned = (await bal('p1', 'earned'))!;
  const header = ['Emp Code ', 'Artists', 'Official Email', 'Leaves taken= 0 in next month ', 'Earned Leave', 'Casual leave ', 'Emergency leave', 'Final Leaves'];
  const sheet = (cells: string[][]) => cells.map((c, i) => ({ __row: String(i + 2), ...Object.fromEntries(header.map((h, j) => [h, c[j] ?? ''])) }));
  const rows = sheet([
    /* 2 */ ['lb 1', 'x', '', '0', '9', '5.5', '', '0'], // by code, other spelling: earned 9, casual 5.5 available
    /* 3 */ ['', 'x', 'p3@LB.test', '0', '', '3.125', '2', '0'], // by email; 3.125 is rounded
    /* 4 */ ['LB-404', 'x', 'p2@lb.test', '0', 'abc', '-1', '1', '0'], // unknown code, known email: p2; two bad cells
    /* 5 */ ['LB-777', 'x', '', '0', '4', '4', '4', '0'], // nobody
    /* 6 */ ['', 'x', '', '0', '1', '1', '1', '0'], // no code, no email
    /* 7 */ ['LB-4', 'x', '', '0', '6', '2', '', '0'], // p4: earned not on Lite
    /* 8 */ ['LB-5', 'x', '', '0', '1', '1', '1', '0'], // left
    /* 9 */ ['LB-1', 'x', '', '0', '1', '1', '1', '0'], // p1 again
    /* 10 */ ['LB-HR', 'x', '', '0', '1', '1', '1', '0'], // the importer's own
    /* 11 */ ['LB-6', 'x', '', '0', '1', '1', '1', '0'], // another company's person
    /* 12 */ ['', '', '', '', '', '', '', ''], // blank line
    /* 13 */ ['LB-9', 'x', '', '0', '', '', '', '0'], // no figures
  ]);
  const { plan } = await planLeaveImport('hr', { rows });
  const fieldOf = (h: string) => plan.fileColumns.find((c) => c.key === h)?.field;
  ok('"Emp Code " is the Employee ID', fieldOf('Emp Code ') === 'employeeId');
  ok('"Official Email" is the work email', fieldOf('Official Email') === 'email');
  ok('"Earned Leave" → earned, "Casual leave " → casual, "Emergency leave" → emergency', fieldOf('Earned Leave') === 'type:earned' && fieldOf('Casual leave ') === 'type:casual' && fieldOf('Emergency leave') === 'type:emergency');
  ok('"Leaves taken…", "Final Leaves" and the name column are not used', !fieldOf('Leaves taken= 0 in next month ') && !fieldOf('Final Leaves') && !fieldOf('Artists'));
  ok('the choices are ID, email and every paid type (not leave without pay)', plan.fieldChoices.map((c) => c.field).join() === 'employeeId,email,type:earned,type:casual,type:emergency,type:wfh');

  console.log('the import: matching and maths');
  const change = (userId: string, key: string) => plan.changes.find((c) => c.userId === userId && c.type === key);
  const c1 = change('p1', 'casual');
  ok('matched by Employee ID whatever its spelling ("lb 1" is LB-1)', Boolean(c1) && c1!.row === 2);
  ok('available 5.5 with 2 taken: total 7.5', c1?.totalNew === 7.5 && c1.taken === 2 && c1.availableNew === 5.5, c1);
  ok('now and difference from the current balance', c1?.availableNow === p1Casual.remaining && c1.totalNow === p1Casual.total && c1.difference === 7.5 - p1Casual.total, { c1, p1Casual });
  ok('earned 9 available with 1 taken: total 10', change('p1', 'earned')?.totalNew === 10 && change('p1', 'earned')?.totalNow === p1Earned.total);
  const c3 = change('p3', 'casual');
  ok('matched by work email when there is no ID (any case)', Boolean(c3) && change('p3', 'emergency')?.availableNew === 2);
  ok('3.125 is kept to two decimals, and said', c3?.availableNew === 3.13 && /3\.125 read as 3\.13/.test(c3?.note ?? ''), c3);
  ok('an unknown code falls back to the email', change('p2', 'emergency')?.row === 4 && change('p2', 'emergency')?.totalNew === 1.5);
  const unmatched = (row: number) => plan.unmatched.find((u) => u.row === row)?.message ?? '';
  ok('a code and email nobody has: not matched', /No employee has ID LB-777/.test(unmatched(5)), plan.unmatched);
  ok('no code and no email: not matched', /No Employee ID or work email/.test(unmatched(6)));
  ok('another company\'s person: not matched', /No employee has ID LB-6/.test(unmatched(11)));
  ok('a blank line is ignored', !plan.rows.some((r) => r.row === 12));
  const err = (row: number, re: RegExp) => plan.errors.some((e) => e.row === row && re.test(e.message));
  ok('not a number: refused', err(4, /not a number/));
  ok('negative: refused', err(4, /negative/));
  ok('a type not on their template: refused', err(7, /Earned Leave is not on their shift template/), plan.errors.filter((e) => e.row === 7));
  ok('…and the rest of the row still counts (p4 casual)', change('p4', 'casual')?.availableNew === 2);
  ok('someone who has left: refused', err(8, /has left/));
  ok('the same person twice: the second row refused', err(9, /twice: row 2 is used/));
  ok('the importer\'s own balance: refused', err(10, /own balance/));
  ok('a row with no figures is unchanged', plan.rows.find((r) => r.row === 13)?.status === 'unchanged');
  ok('active employees the file never names are listed (and only they)', plan.notInFile.map((p) => p.userId).join() === 'p5', plan.notInFile);

  console.log('the import: HR\'s choices');
  const monthly = await planLeaveImport('hr', { rows: sheet([['LB-1', '', '', '', '', '', '3', '']]), mapping: { 'Emergency leave': 'type:wfh' } });
  ok('HR can map a column to another type (here a monthly one: refused, it resets monthly)', monthly.plan.fileColumns.find((c) => c.key === 'Emergency leave')?.field === 'type:wfh' && monthly.plan.errors.some((e) => /resets every month/.test(e.message)), monthly.plan.errors);
  const off = await planLeaveImport('hr', { rows: sheet([['LB-1', '', '', '', '', '5', '', '']]), mapping: { 'Casual leave ': '', 'Earned Leave': '', 'Emergency leave': '' } });
  ok('a column switched off is not read (and with none left the file is refused)', off.plan.errors.some((e) => e.row === 0 && /No column is read as a leave type/.test(e.message)));
  const totals = await planLeaveImport('hr', { rows: sheet([['LB-1', '', '', '', '', '1', '', '']]), mode: 'total' });
  ok('as totals: a total below what is taken is refused (below zero after taken)', totals.plan.errors.some((e) => /2 days are already taken/.test(e.message) && /below zero/.test(e.message)), totals.plan.errors);
  const noKey = await planLeaveImport('hr', { rows: sheet([['LB-1', '', '', '', '', '1', '', '']]), mapping: { 'Emp Code ': '', 'Official Email': '' } });
  ok('no ID or email column: the whole file is refused', noKey.plan.errors.some((e) => e.row === 0 && /Employee ID or Work Email/.test(e.message)));
  ok('someone without the right to edit details cannot import', /cannot edit employee details/.test(await refusedFor(() => planLeaveImport('p1', { rows }))));
  const mgrPlan = await planLeaveImport('mgr', { rows });
  ok('a manager\'s import changes only their reports', mgrPlan.plan.changes.every((c) => c.userId === 'p1') && mgrPlan.plan.errors.some((e) => e.row === 3 && /report to you/.test(e.message)));

  console.log('the import: applying');
  const preview = await previewLeaveImport('hr', { fileName: 'made-up.xlsx', rows });
  // Leave approved for p1 after the preview: available days stay what the file said.
  await leaves().insertOne(approvedLeave('p1', 'earned', day(7, 7), day(7, 7), 1) as never);
  const result = await applyLeaveImport('hr', preview.importId, { declined: [{ row: 3, type: 'emergency' }] });
  const p1c = (await bal('p1', 'casual'))!;
  ok('p1\'s own balance shows the imported figure: 5.5 casual left of 7.5, 2 taken', p1c.remaining === 5.5 && p1c.total === 7.5 && p1c.used === 2, p1c);
  const p1e = (await bal('p1', 'earned'))!;
  ok('leave approved since the preview: still 9 earned available (total follows the 2 taken)', p1e.remaining === 9 && p1e.used === 2 && p1e.total === 11, p1e);
  ok('p3 (by email) shows 3.13 casual', (await bal('p3', 'casual'))!.remaining === 3.13);
  ok('a declined line is not applied (p3 emergency)', (await bal('p3', 'emergency'))!.total === balances.get('p3')!.types.find((t) => t.key === 'emergency')!.total);
  ok('p2 (by email fallback) shows 1 emergency left, 0.5 taken', (await bal('p2', 'emergency'))!.remaining === 1);
  ok('it reports how many changed', result.people === 4 && result.values === 5 && result.failed.length === 0, result);
  await new Promise((r) => setTimeout(r, 200));
  const act = await employeeActivity().find({ userId: 'p1', via: 'import' }).toArray();
  ok('each person\'s change is on their Activity, by import, one entry with every type', act.length === 1 && act[0].changes.length === 2 && act[0].changes.some((c) => c.field === 'leaveTotal.casual' && c.to === '7.5'), act);
  ok('an import is applied once', /already applied/.test(await refusedFor(() => applyLeaveImport('hr', preview.importId))));
  const again = await planLeaveImport('hr', { rows });
  ok('the same file again changes nothing for p1 casual', !again.plan.changes.some((c) => c.userId === 'p1' && c.type === 'casual'));
  const sameLine = again.plan.same.find((c) => c.userId === 'p1' && c.type === 'casual');
  ok('…it is listed as Same: 5.5 now, 5.5 in the file, no difference', sameLine?.availableNow === 5.5 && sameLine.availableNew === 5.5 && sameLine.difference === 0, sameLine);
  const cancelled = await previewLeaveImport('hr', { rows });
  await cancelLeaveImport('hr', cancelled.importId);
  ok('a cancelled import cannot be applied', /already applied or cancelled/.test(await refusedFor(() => applyLeaveImport('hr', cancelled.importId))));

  console.log('the profile\'s pencil still works the same');
  const before = (await bal('p4', 'casual'))!;
  await setLeaveTotal('hr', 'p4', 'casual', before.total + 0.5);
  ok('a half day more', (await bal('p4', 'casual'))!.total === before.total + 0.5);
  ok('still whole or half days only there', /half days/.test(await refusedFor(() => setLeaveTotal('hr', 'p4', 'casual', 2.3))));

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
