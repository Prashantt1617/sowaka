/**
 * Checks Suwi's request decisions (24 Nov): prepare_decide_leave, prepare_decide_correction and
 * prepare_cancel_leave each prepare ONE card for several requests; nothing changes before Confirm;
 * Confirm decides them all through the dashboard's services; a request that fails is reported and the
 * others still go through. On a scratch database only:
 *   npm run suwi-decide:check
 */
import { ObjectId } from 'mongodb';
import { attendanceRegularizations, connectDb, getDb, leaves, users } from '../config/db';
import type { User } from '../models/user.model';
import { confirmProposal, getProposal } from '../suwi/proposals';
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
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), employeeId: `E-${userId}`, managerUserId: 'founder', ...extra,
} as User);
const at = (d: string) => new Date(`${d}T00:00:00.000Z`);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 8);
  const d = (n: number) => `${month}${String(n).padStart(2, '0')}`;
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true, managerUserId: undefined }),
    person('asha'), person('ravi'), person('meena'),
  ]);
  const created = new Date(Date.now() - 3 * 86_400_000);
  const lv = (userId: string, s: string, e: string, days: number) =>
    ({ userId, type: 'casual', startDate: at(s), endDate: at(e), days, reason: 'x', status: 'pending', createdAt: created });
  const L = await leaves().insertMany([lv('asha', d(1), d(2), 2), lv('ravi', d(3), d(3), 1), lv('meena', d(4), d(4), 1), lv('founder', d(5), d(5), 1)] as never[]);
  const [lAsha, lRavi, lMeena, lMine] = Object.values(L.insertedIds).map((x) => (x as ObjectId).toHexString());
  const reg = (userId: string, workDate: string) => ({ userId, employeeId: `E-${userId}`, managerUserId: 'founder', workDate, kind: 'correction', requestedDayType: 'full_day', note: 'forgot', status: 'pending', createdAt: created });
  await attendanceRegularizations().insertMany([reg('asha', d(1)), reg('ravi', d(2)), reg('meena', d(3))] as never[]);

  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, today);
  for (const n of ['prepare_decide_leave', 'prepare_decide_correction', 'prepare_cancel_leave']) ok(`${n} is registered`, Boolean(toolByName(n)));
  const st = async (id: string) => (await leaves().findOne({ _id: new ObjectId(id) }))?.status;

  console.log('Approve every pending leave in one card');
  const out = await toolByName('prepare_decide_leave')!.run(ctx, { decision: 'approved', all: true, note: 'Enjoy' });
  const card = await getProposal('founder', 'acme', out.proposalId!);
  ok('one card lists Asha, Meena and Ravi', JSON.stringify(card.preview?.rows.map((r) => r.name).sort()) === JSON.stringify(['Asha', 'Meena', 'Ravi']), card.preview ?? out.data);
  ok('the asker\'s own leave is left out', card.preview?.skipped.some((s) => s.who === 'Founder') === true, card.preview?.skipped);
  ok('the card says it cannot be undone', card.undoable === false && card.lines.some((l) => /cannot be undone/.test(l.text)), card.lines);
  ok('nothing changes before Confirm', (await leaves().countDocuments({ status: 'pending' })) === 4);
  // Meena's leave gets decided elsewhere before HR confirms: that one must fail, the rest still go.
  await leaves().updateOne({ _id: new ObjectId(lMeena) }, { $set: { status: 'declined' } });
  const done = await confirmProposal('founder', 'acme', out.proposalId!);
  ok('Confirm approves Asha and Ravi', (await st(lAsha)) === 'approved' && (await st(lRavi)) === 'approved', [await st(lAsha), await st(lRavi), done.message]);
  ok('the one decided elsewhere is reported, not hidden', /Approved 2 requests/.test(done.message ?? '') && /Meena/.test(done.message ?? ''), done.message);
  ok('the asker\'s own leave is untouched', (await st(lMine)) === 'pending' && (await st(lMeena)) === 'declined');

  console.log('Decline two corrections by name');
  const c = await toolByName('prepare_decide_correction')!.run(ctx, { decision: 'declined', names: ['asha', 'ravi'], note: 'No proof' });
  const cc = await getProposal('founder', 'acme', c.proposalId!);
  ok('one card for Asha and Ravi only', cc.preview?.rows.length === 2, cc.preview?.rows ?? c.data);
  ok('nothing changes before Confirm', (await attendanceRegularizations().countDocuments({ status: 'pending' })) === 3);
  const cd = await confirmProposal('founder', 'acme', c.proposalId!);
  ok('Confirm declines both, decided by the asker as admin', (await attendanceRegularizations().countDocuments({ status: 'declined', decidedByUserId: 'founder', decidedByRole: 'admin' })) === 2, cd.message);
  ok('Meena\'s correction is still pending', (await attendanceRegularizations().countDocuments({ userId: 'meena', status: 'pending' })) === 1);

  console.log('HR cancels approved leave');
  const x = await toolByName('prepare_cancel_leave')!.run(ctx, { action: 'cancel', ids: [lAsha, lRavi] });
  const xc = await getProposal('founder', 'acme', x.proposalId!);
  ok('one card for both leaves', xc.preview?.rows.length === 2, xc.preview ?? x.data);
  ok('nothing changes before Confirm', (await st(lAsha)) === 'approved');
  const xd = await confirmProposal('founder', 'acme', x.proposalId!);
  ok('Confirm cancels both', (await st(lAsha)) === 'cancelled' && (await st(lRavi)) === 'cancelled', xd.message);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
