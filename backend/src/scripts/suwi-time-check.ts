/**
 * Checks Suwi's time skills (24 Nov): overtime and out-of-location check-in decisions, declining /
 * sending back claims, editing a shift template, leave type settings, the month's leave credit,
 * giving back leave charged on later holidays, and looking into one day's punches. Each act prepares
 * ONE card, changes nothing before Confirm, then changes the database through the dashboard's own
 * services; Undo puts it back where the service allows. On a scratch database only:
 *   npm run suwi-time:check
 */
import { ObjectId } from 'mongodb';
import {
  attendanceRecords, attendanceRegularizations, connectDb, faceVerifications, getDb, holidays, leaves, overtimeRequests, reimbursementClaims, shiftTemplates, users,
} from '../config/db';
import type { User } from '../models/user.model';
import { DEFAULT_ORG_SHIFT_POLICY } from '../models/shift.model';
import { getMyLeaveBalance } from '../services/leave.service';
import { confirmProposal, getProposal, undoProposal } from '../suwi/proposals';
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
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), employeeId: `E-${userId}`, managerUserId: 'founder', location: 'Pune', ...extra,
} as User);
const at = (d: string) => new Date(`${d}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);
  await users().insertMany([
    person('founder', { dashboardAccess: true, dashboardAdmin: true, canEditEmployeeDetails: true, managerUserId: undefined }),
    person('asha'), person('ravi'), person('meena'),
  ]);
  const now = new Date();
  const policy = JSON.parse(JSON.stringify(DEFAULT_ORG_SHIFT_POLICY));
  const T = await shiftTemplates().insertMany([
    { org: 'acme', name: 'General', active: true, isDefault: true, policy, assignedUserIds: [], createdAt: now, updatedAt: now },
    { org: 'acme', name: 'Night', active: true, policy: { ...policy, startTime: '21:00', endTime: '06:00' }, assignedUserIds: ['asha'], createdAt: now, updatedAt: now },
  ] as never[]);
  const generalId = (T.insertedIds[0] as ObjectId);
  const nightId = (T.insertedIds[1] as ObjectId);

  const founder = (await users().findOne({ userId: 'founder' }))!;
  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as Record<SuwiArea, SuwiLevel>;
  const ctx = contextFor(founder, levels, today);
  for (const n of ['prepare_decide_overtime', 'prepare_decide_checkins', 'prepare_decline_claims', 'prepare_edit_shift_template', 'leave_type_settings', 'prepare_leave_type_change', 'leave_monthly_credit', 'prepare_refund_holiday_leave', 'punch_attempts']) ok(`${n} is registered`, Boolean(toolByName(n)));
  const run = (n: string, i: Record<string, unknown>) => toolByName(n)!.run(ctx, i);
  const created = new Date(Date.now() - 3 * 86_400_000);

  console.log('1. Approve last week\'s overtime in one card');
  const ot = (userId: string, workDate: string) => ({ userId, managerUserId: 'founder', workDate: at(workDate), startTime: new Date(`${workDate}T13:00:00Z`), endTime: new Date(`${workDate}T17:00:00Z`), hours: 4, duration: 'half_day', compensation: { kind: 'pay' }, status: 'pending', createdAt: created, updatedAt: created });
  const lastWeek = addDays(today, -7);
  await overtimeRequests().insertMany([ot('asha', lastWeek), ot('ravi', addDays(lastWeek, 1)), ot('meena', addDays(today, -30)), ot('founder', lastWeek)] as never[]);
  const o = await run('prepare_decide_overtime', { decision: 'approved', from: addDays(lastWeek, -1), to: addDays(lastWeek, 5), note: 'Thanks' });
  const oc = await getProposal('founder', 'acme', o.proposalId!);
  ok('one card for Asha and Ravi (last week only)', JSON.stringify(oc.preview?.rows.map((r) => r.name).sort()) === '["Asha","Ravi"]', oc.preview ?? o.data);
  ok('own request left out, card says it cannot be undone', oc.preview?.skipped.some((s) => s.who === 'Founder') === true && oc.undoable === false);
  ok('nothing changes before Confirm', (await overtimeRequests().countDocuments({ status: 'pending' })) === 4);
  const od = await confirmProposal('founder', 'acme', o.proposalId!);
  ok('Confirm approves both as admin', (await overtimeRequests().countDocuments({ status: 'approved', decidedByRole: 'admin', decidedByUserId: 'founder' })) === 2, od.message);
  ok('Meena (a month ago) is still pending', (await overtimeRequests().countDocuments({ userId: 'meena', status: 'pending' })) === 1);

  console.log('2. Approve yesterday\'s site visits');
  const ool = (userId: string, workDate: string) => ({ userId, employeeId: `E-${userId}`, managerUserId: 'founder', workDate, kind: 'out_of_location', outsideLocation: { reason: 'Client visit', punchType: 'in', at: new Date(`${workDate}T04:00:00Z`), latitude: 18.5, longitude: 73.8, accuracy: 15, officeName: 'HQ', distanceMeters: 1800 }, punchIn: new Date(`${workDate}T04:00:00Z`), status: 'pending', createdAt: created });
  await attendanceRegularizations().insertMany([ool('asha', yesterday), ool('ravi', addDays(today, -2))] as never[]);
  const c = await run('prepare_decide_checkins', { decision: 'approved', from: yesterday });
  const cc = await getProposal('founder', 'acme', c.proposalId!);
  ok('one card, yesterday\'s only (Asha)', cc.preview?.rows.length === 1 && cc.preview.rows[0].name === 'Asha', cc.preview ?? c.data);
  await confirmProposal('founder', 'acme', c.proposalId!);
  ok('Confirm approves Asha\'s check-in; Ravi\'s waits', (await attendanceRegularizations().findOne({ userId: 'asha', kind: 'out_of_location' }))?.status === 'approved' && (await attendanceRegularizations().findOne({ userId: 'ravi', kind: 'out_of_location' }))?.status === 'pending');

  console.log('3. Send back the duplicate fuel bill');
  const claim = (userId: string, category: string, amount: number, d: string) => ({ userId, managerUserId: 'founder', expenseDate: at(d), amount, category, status: 'pending', createdAt: created, updatedAt: created });
  await reimbursementClaims().insertMany([claim('asha', 'fuel', 850, yesterday), claim('asha', 'fuel', 850, yesterday), claim('ravi', 'internet', 999, yesterday)] as never[]);
  const nope = await run('prepare_decline_claims', { flagged: 'duplicate' }).catch((e: Error) => e.message);
  ok('a reason is required', typeof nope === 'string' && /reason/.test(nope), nope);
  const r = await run('prepare_decline_claims', { flagged: 'duplicate', type: 'fuel', sendBack: true, reason: 'Duplicate fuel bill' });
  const rc = await getProposal('founder', 'acme', r.proposalId!);
  ok('one card for the two duplicate fuel claims', rc.preview?.rows.length === 2 && rc.undoable === false, rc.preview ?? r.data);
  ok('nothing changes before Confirm', (await reimbursementClaims().countDocuments({ status: 'pending' })) === 3);
  await confirmProposal('founder', 'acme', r.proposalId!);
  const declined = await reimbursementClaims().find({ status: 'declined' }).toArray();
  ok('Confirm declines both with the note asking to file again', declined.length === 2 && declined.every((x) => /Duplicate fuel bill/.test(x.managerNote ?? '') && /file it again/.test(x.managerNote ?? '')), declined.map((x) => x.managerNote));
  ok('Ravi\'s internet claim is untouched', (await reimbursementClaims().findOne({ userId: 'ravi' }))?.status === 'pending');

  console.log('4. Change grace on the General shift to 20 minutes');
  const e = await run('prepare_edit_shift_template', { template: 'general', lateGraceMinutes: 20, weeklyOff: ['Sunday', '2nd Saturday'], halfDayIfLateByMinutes: 90 });
  const ec = await getProposal('founder', 'acme', e.proposalId!);
  const late = ec.preview?.rows.find((x) => x.name === 'Late mark');
  ok('card shows late grace before → after', late?.current === 'after 10 min grace' && late?.next === 'after 20 min grace', ec.preview);
  ok('card shows weekly offs and the people on it (3 on the Default)', ec.preview?.rows.some((x) => x.name === 'Weekly offs') === true && (e.data as { people: number }).people === 3, e.data);
  ok('nothing changes before Confirm', (await shiftTemplates().findOne({ _id: generalId }))?.policy.lateGraceMinutes === 10);
  await confirmProposal('founder', 'acme', e.proposalId!);
  const g1 = (await shiftTemplates().findOne({ _id: generalId }))!;
  ok('Confirm saves 20 min and the Saturday off; the rest stays', g1.policy.lateGraceMinutes === 20 && g1.policy.weeklyOff['2'].includes(5) && g1.policy.weeklyOff['2'].includes(6) && g1.policy.startTime === '09:00' && g1.policy.halfDay.lateArrivalEnabled && g1.policy.halfDay.lateArrivalMinutes === 90 && g1.policy.halfDay.minFullDayEnabled && g1.isDefault === true && g1.name === 'General', g1.policy);
  await undoProposal('founder', 'acme', e.proposalId!);
  const g2 = (await shiftTemplates().findOne({ _id: generalId }))!;
  ok('Undo puts grace and weekly offs back', g2.policy.lateGraceMinutes === 10 && !g2.policy.weeklyOff['2'].includes(5) && !g2.policy.halfDay.lateArrivalEnabled, g2.policy);

  console.log('5. Leave types: read, add, refuse 2 a year, edit one template');
  const s = await run('leave_type_settings', {});
  ok('settings list both templates with their types', (s.data as { templates: { template: string; types: unknown[] }[] }).templates.length === 2 && (s.data as { templates: { types: unknown[] }[] }).templates[0].types.length === 3, s.data);
  const two = await run('prepare_leave_type_change', { action: 'add', name: 'Bereavement Leave', daysPerYear: 2 });
  ok('2 days a year is refused with options, no card', !two.proposalId && (two.data as { cannotSetAsAsked?: boolean }).cannotSetAsAsked === true, two.data);
  const add = await run('prepare_leave_type_change', { action: 'add', name: 'Bereavement Leave', perMonth: 0.5 });
  const ac = await getProposal('founder', 'acme', add.proposalId!);
  ok('one card for both templates', ac.preview?.rows.length === 2, ac.preview ?? add.data);
  await confirmProposal('founder', 'acme', add.proposalId!);
  const hasB = async (id: ObjectId) => (await shiftTemplates().findOne({ _id: id }))?.policy.leave.types.find((t) => t.key === 'bereavement');
  ok('Confirm adds Bereavement (0.5 a month) to both', (await hasB(generalId))?.perMonth === 0.5 && (await hasB(nightId))?.perMonth === 0.5);
  await undoProposal('founder', 'acme', add.proposalId!);
  ok('Undo removes it again', !(await hasB(generalId)) && !(await hasB(nightId)));
  const ed = await run('prepare_leave_type_change', { action: 'edit', name: 'casual', perMonth: 1.5, templates: ['Night'] });
  await confirmProposal('founder', 'acme', ed.proposalId!);
  const casual = async (id: ObjectId) => (await shiftTemplates().findOne({ _id: id }))?.policy.leave.types.find((t) => t.key === 'casual')?.perMonth;
  ok('edit on Night only: Night casual 1.5, General stays 1', (await casual(nightId)) === 1.5 && (await casual(generalId)) === 1);

  console.log('6. Credit next month\'s leave (answer only)');
  const nextMonth = addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7);
  const cr = await run('leave_monthly_credit', { month: nextMonth });
  const crd = cr.data as { status: string; credits: { template: string; type: string; people: number; perMonth: number }[]; nothingToRun: string };
  ok('says it will be credited by itself on the 1st', /will be credited/.test(crd.status) && /no "run the credit" step/.test(crd.nothingToRun), crd);
  ok('General casual: 1 day to 3 people; Night casual 1.5 to Asha', crd.credits.some((x) => x.template === 'General' && x.type === 'Casual Leave' && x.people === 3 && x.perMonth === 1) && crd.credits.some((x) => x.template === 'Night' && x.type === 'Casual Leave' && x.people === 1 && x.perMonth === 1.5), crd.credits);
  const cp = await run('leave_monthly_credit', { month: nextMonth, name: 'Asha' });
  ok('per person: Asha\'s credit names Casual 1.5', ((cp.data as { credit: { type: string; days: number }[] }).credit ?? []).some((x) => x.type === 'Casual Leave' && x.days === 1.5), cp.data);

  console.log('7. Give back leave charged on a later holiday');
  // A Monday-to-Wednesday in January this year; the Tuesday becomes a holiday after Asha's leave was counted.
  let mon = `${today.slice(0, 4)}-01-05`;
  while (new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1) mon = addDays(mon, 1);
  const tue = addDays(mon, 1), wed = addDays(mon, 2);
  const L = await leaves().insertMany([
    { userId: 'asha', type: 'casual', startDate: at(mon), endDate: at(wed), days: 3, reason: 'x', status: 'approved', createdAt: created },
    // Ravi applied after the holiday existed: counted 2, nothing to give back.
    { userId: 'ravi', type: 'casual', startDate: at(mon), endDate: at(wed), days: 2, reason: 'x', status: 'approved', createdAt: created },
  ] as never[]);
  ok('two leaves set up', Object.keys(L.insertedIds).length === 2);
  await holidays().insertOne({ org: 'acme', state: '*', name: 'Founders Day', date: at(tue), type: 'Public' } as never);
  const before = (await getMyLeaveBalance('asha', Number(today.slice(0, 4)))).types.find((t) => t.key === 'casual')!;
  const h = await run('prepare_refund_holiday_leave', {});
  const hc = await getProposal('founder', 'acme', h.proposalId!);
  ok('one card: Asha +1 casual, Ravi not listed', hc.preview?.rows.length === 1 && /Asha/.test(hc.preview.rows[0].name) && /\+1 for Founders Day/.test(hc.preview.rows[0].next), hc.preview ?? h.data);
  await confirmProposal('founder', 'acme', h.proposalId!);
  const afterB = (await getMyLeaveBalance('asha', Number(today.slice(0, 4)))).types.find((t) => t.key === 'casual')!;
  ok('Confirm raises Asha\'s casual total by 1', afterB.total === before.total + 1 && afterB.remaining === before.remaining + 1, { before, afterB });
  const again = await run('prepare_refund_holiday_leave', {});
  ok('asking again gives nothing back twice', !again.proposalId && JSON.stringify(again.data).includes('Already given back'), again.data);
  await undoProposal('founder', 'acme', h.proposalId!);
  const undone = (await getMyLeaveBalance('asha', Number(today.slice(0, 4)))).types.find((t) => t.key === 'casual')!;
  ok('Undo lowers it back', undone.total === before.total, { before, undone });

  console.log('8. Why did Ravi\'s punch fail / was he late?');
  const day = addDays(today, -3);
  await attendanceRecords().insertOne({ employeeId: 'E-ravi', userId: 'ravi', workDate: day, punchIn: new Date(`${day}T03:55:00Z`), punchOut: new Date(`${day}T12:40:00Z`), punchInLocation: { latitude: 18.5, longitude: 73.8, accuracy: 12, mocked: true, officeId: 'o1', officeName: 'HQ', distanceMeters: 40 }, source: 'manual', sourceKey: 'k1', importedAt: now, updatedAt: now } as never);
  await faceVerifications().insertOne({ org: 'acme', userId: 'ravi', kind: 'verify', at: new Date(`${day}T03:50:00Z`), passed: false, reason: 'not_a_match' } as never);
  const pt = await run('punch_attempts', { person: 'Ravi', date: day });
  const pd = pt.data as { punches: { punchIn: string; punchInPlace: { distanceMeters: number; accuracyMeters: number; mocked: boolean } }[]; reasons: string[]; faceChecks: { passed: boolean }[] };
  ok('punch-in in IST with distance, accuracy and mocked flag', pd.punches[0]?.punchIn === '09:25:00' && pd.punches[0].punchInPlace.distanceMeters === 40 && pd.punches[0].punchInPlace.accuracyMeters === 12 && pd.punches[0].punchInPlace.mocked === true, pd.punches);
  ok('says late by 15 min past the 10-min grace', pd.reasons.some((x) => /Marked late: in at 09:25:00, 25 min after the 09:00 start, 15 min past the 10-min grace/.test(x)), pd.reasons);
  ok('lists the failed face check and the mocked location', pd.faceChecks.length === 1 && pd.faceChecks[0].passed === false && pd.reasons.some((x) => /face check/.test(x)) && pd.reasons.some((x) => /mocked/.test(x)), pd);
  const empty = await run('punch_attempts', { person: 'Meena', date: day });
  ok('a day with nothing kept says so and why', (empty.data as { reasons: string[] }).reasons.some((x) => /kept nothing/.test(x)), empty.data);
  const oolDay = await run('punch_attempts', { person: 'Ravi', date: addDays(today, -2) });
  ok('an out-of-location punch is explained', (oolDay.data as { reasons: string[] }).reasons.some((x) => /outside every office \(1800 m from HQ/.test(x)), oolDay.data);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
