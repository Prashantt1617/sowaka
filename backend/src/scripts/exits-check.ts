/**
 * Exits, step 1, end to end: HR records an exit (only a dashboard admin, sane
 * dates, a team moved to a new manager), the person works their notice as
 * before, and from the day after the last working day (the hourly job) they
 * are offboarded: sessions and device tokens gone, sign-in refused. A withdrawn
 * exit leaves no trace; "End access now" works at once. Days after the last
 * working day are not graded on the calendar and are not paid in a run; someone
 * who left before the period gets no payslip. The days before joining and
 * after leaving are not paid, and are not loss of pay either: the payslip, the
 * app and the salary register call them "not employed", with the same pay;
 * a loss of pay HR typed stays loss of pay. On a scratch database only:
 *   MONGODB_DB=exits_scratch npm run exits:check
 */
import {
  attendanceRecords, authSessions, companies, connectDb, deviceTokens, getDb, paidDaysTemplates, payHeads, payslips, salaryStructures, salaryTemplates, statutoryConfigs, users,
} from '../config/db';
import type { User } from '../models/user.model';
import type { AttendanceRecord } from '../models/attendance.model';
import { attendanceReport, employeeDayStatuses } from '../services/attendance-report.service';
import { getCurrentAuthUser } from '../services/auth.service';
import { closeDueExits, endAccessNow, exitSettings, listExits, recordExit, setExitSettings, withdrawExit } from '../services/exit.service';
import { createRun, listRuns, recomputeRun } from '../services/payrollRun.service';
import { paymentDetails, salaryRegister } from '../services/payrollReports.service';
import { payslipHtml } from '../services/payslip-html';
import { employedDaysOf, lossOfPayDaysOf, lossOfPayPaiseOf, notEmployedDaysOf, notEmployedPaiseOf, unpaidPaiseOf } from '../services/payslipDays';
import { fromPayslip } from '../services/employeePayroll.home';
import { createShift, setDefaultShift } from '../services/shift.service';
import { ZOHO_CATALOG, ZOHO_TEMPLATES } from './payroll-zoho-check';
import { STATUTORY_SEED } from './payroll-config-seed-data';

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

const ORG = 'exitcheck';
const MONTH = '2026-09';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@x.test`, org: ORG, lifecycleStatus: 'active',
  role: 'employee', joiningDate: new Date('2025-01-01T00:00:00Z'), managerUserId: 'hr', ...extra,
} as User);
/** A moment in IST, as the hourly job sees it. */
const ist = (stamp: string) => new Date(`${stamp}+05:30`);
/** The payslip as its PDF prints it. */
const myPayslipHtmlFor = async (slip: Parameters<typeof payslipHtml>[0]) => payslipHtml(slip, { name: 'Exit Check Pvt Ltd', address: '' } as never);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: new Date(), updatedAt: new Date(), updatedByUserId: null })));

  await companies().insertOne({ id: ORG, name: 'Exit Check', features: { exits: true } } as never);
  await users().insertMany([
    person('hr', { name: 'Hema HR', dashboardAccess: true, dashboardAdmin: true, employeeId: 'H1', managerUserId: undefined }),
    person('mgr', { name: 'Manoj', dashboardAccess: true, employeeId: 'M1' }),
    person('lead', { name: 'Lata Lead', employeeId: 'L1' }),
    person('e1', { name: 'Esha', employeeId: 'E1', managerUserId: 'lead' }),
    person('leaver', { name: 'Lalit Leaver', employeeId: 'E2' }),
    person('gone', { name: 'Gopal Gone', employeeId: 'E3' }),
    person('stayer', { name: 'Sita Stayer', employeeId: 'E4' }),
    person('runner', { name: 'Ravi Runner', employeeId: 'E5' }),
    person('fresh', { name: 'Farah Fresh', employeeId: 'E6', joiningDate: new Date('2026-09-15T00:00:00Z') }),
    person('joiner', { name: 'Jaya Joiner', employeeId: 'E7', joiningDate: new Date('2026-09-16T00:00:00Z') }),
  ]);
  const shift = await createShift('hr', { name: 'General', punchFormat: 'In-app punch in' });
  await setDefaultShift('hr', shift.id);

  console.log('recording an exit');
  const sept10 = ist('2026-09-10T11:00:00');
  await companies().updateOne({ id: ORG }, { $set: { 'features.exits': false } });
  ok('off for a company without the feature', /not switched on/.test((await refusal(() => listExits('hr', sept10))).message));
  await companies().updateOne({ id: ORG }, { $set: { 'features.exits': true } });
  ok('only a dashboard admin', (await refusal(() => recordExit('mgr', 'leaver', { kind: 'resigned', lastWorkingDay: '2026-09-20' }, sept10))).status === 403);
  ok('not their own', (await refusal(() => recordExit('hr', 'hr', { kind: 'resigned', lastWorkingDay: '2026-09-20' }, sept10))).status === 400);
  ok('a known kind', (await refusal(() => recordExit('hr', 'leaver', { kind: 'vanished', lastWorkingDay: '2026-09-20' }, sept10))).status === 400);
  ok('a real date', (await refusal(() => recordExit('hr', 'leaver', { kind: 'resigned', lastWorkingDay: '20/09/2026' }, sept10))).status === 400);
  ok('not before they joined', /before they joined/.test((await refusal(() => recordExit('hr', 'fresh', { kind: 'resigned', lastWorkingDay: '2026-09-01' }, sept10))).message));
  const teamRefused = await refusal(() => recordExit('hr', 'lead', { kind: 'resigned', lastWorkingDay: '2026-09-25' }, sept10));
  ok('a manager needs a successor first', teamRefused.status === 409 && /1 person reports to Lata Lead/.test(teamRefused.message), teamRefused);
  ok('the successor must still be here', (await refusal(() => recordExit('hr', 'lead', { kind: 'resigned', lastWorkingDay: '2026-09-25', newManagerUserId: 'nobody' }, sept10))).status === 400);
  const leadView = await recordExit('hr', 'lead', { kind: 'resigned', lastWorkingDay: '2026-09-25', newManagerUserId: 'mgr' }, sept10);
  ok('their team stays with them during notice', (await users().findOne({ userId: 'e1' }))?.managerUserId === 'lead' && leadView.team?.move === 'day_after' && leadView.team.newManagerName === 'Manoj' && leadView.team.size === 1, leadView.team);

  await authSessions().insertOne({ tokenHash: 'leaver-session', userId: 'leaver', createdAt: sept10, expiresAt: new Date('2027-01-01') });
  await deviceTokens().insertOne({ userId: 'leaver', token: 'leaver-phone', platform: 'android', createdAt: sept10, updatedAt: sept10 });
  const view = await recordExit('hr', 'leaver', { kind: 'resigned', lastWorkingDay: '2026-09-20', noticeFrom: '2026-08-21', noticeDays: 30, note: 'Moving cities' }, sept10);
  const leaverNow = await users().findOne({ userId: 'leaver' });
  ok('on notice, still working', view.state === 'notice' && leaverNow?.lifecycleStatus === 'notice' && leaverNow?.noticeStatus === 'serving', view);
  ok('the last working day is the end date', leaverNow?.endDate?.toISOString().slice(0, 10) === '2026-09-20');
  ok('signed in as usual while on notice', (await getCurrentAuthUser('leaver')).id === 'leaver');
  ok('listed on Exits', (await listExits('hr', sept10)).some((x) => x.userId === 'leaver' && x.kindLabel === 'Resigned' && x.noticeDays === 30));

  console.log('access ends the day after');
  ok('not on the last working day itself', (await closeDueExits(ist('2026-09-20T23:30:00'))) === 0 && (await users().findOne({ userId: 'leaver' }))?.lifecycleStatus === 'notice');
  const closed = await closeDueExits(ist('2026-09-21T00:30:00'));
  const leaverAfter = await users().findOne({ userId: 'leaver' });
  ok('at 00:00 IST the next day: offboarded', closed === 1 && leaverAfter?.lifecycleStatus === 'offboarded' && leaverAfter?.noticeStatus === 'completed' && !!leaverAfter?.exit?.accessEndedAt, leaverAfter?.exit);
  ok('their sessions are deleted', (await authSessions().countDocuments({ userId: 'leaver' })) === 0);
  ok('their phone gets nothing more', (await deviceTokens().countDocuments({ userId: 'leaver' })) === 0);
  ok('sign-in is refused', (await refusal(() => getCurrentAuthUser('leaver'))).status === 401);
  ok('running it again changes nothing', (await closeDueExits(ist('2026-09-22T00:30:00'))) === 0);
  ok('the next one goes on its own day (the lead, last day the 25th)', (await closeDueExits(ist('2026-09-26T00:30:00'))) === 1 && (await closeDueExits(ist('2026-09-26T01:30:00'))) === 0);
  const leadAfter = await users().findOne({ userId: 'lead' });
  ok('the team moves to the new manager the day after the last day', (await users().findOne({ userId: 'e1' }))?.managerUserId === 'mgr' && !!leadAfter?.exit?.teamMovedAt, leadAfter?.exit);
  ok('a left exit can no longer be changed', (await refusal(() => recordExit('hr', 'leaver', { kind: 'resigned', lastWorkingDay: '2026-09-30' }, sept10))).status === 409);
  ok('nor withdrawn', (await refusal(() => withdrawExit('hr', 'leaver', sept10))).status === 409);

  console.log('withdraw, and end access now');
  await recordExit('hr', 'stayer', { kind: 'resigned', lastWorkingDay: '2026-09-28' }, sept10);
  await withdrawExit('hr', 'stayer', sept10);
  const stayer = await users().findOne({ userId: 'stayer' });
  ok('withdrawn: active again, no exit, no end date', stayer?.lifecycleStatus === 'active' && !stayer?.exit && !stayer?.endDate, stayer);
  // Absconded: the default rule ends access as it is recorded.
  const ran = await recordExit('hr', 'runner', { kind: 'absconded', lastWorkingDay: '2026-09-12' }, sept10);
  ok('absconded: access ends at once (the default rule)', ran.state === 'left' && ran.rules.access === 'at_once' && (await users().findOne({ userId: 'runner' }))?.lifecycleStatus === 'terminated', ran);
  ok('…and no notice money on it (24 Nov 2026: nothing recovered, no notice pay)', ran.rules.noticeRecovery === 'none' && ran.rules.noticePay === 'none', ran.rules);
  // End access now, for an exit whose rule waits for the day after.
  await recordExit('hr', 'stayer', { kind: 'resigned', lastWorkingDay: '2026-09-28' }, sept10);
  const ended = await endAccessNow('hr', 'stayer', sept10);
  ok('End access now: offboarded at once', ended.state === 'left' && (await users().findOne({ userId: 'stayer' }))?.lifecycleStatus === 'offboarded', ended);
  // Put the control back as it was (a test shortcut: a left exit cannot be withdrawn on the dashboard).
  await users().updateOne({ userId: 'stayer' }, { $unset: { exit: '', endDate: '' }, $set: { lifecycleStatus: 'active', noticeStatus: 'none' } });
  // A last working day already past: access ends as it is recorded.
  const goneView = await recordExit('hr', 'gone', { kind: 'retired', lastWorkingDay: '2026-08-20' }, sept10);
  ok('a past last working day ends access at once', goneView.state === 'left' && (await users().findOne({ userId: 'gone' }))?.lifecycleStatus === 'offboarded', goneView);

  console.log('exit settings');
  const settings = await exitSettings('hr');
  const resignedRules = settings.kinds.find((k) => k.kind === 'resigned');
  ok('defaults until HR changes them', resignedRules?.isDefault === true && resignedRules.rules.holdPay === true && resignedRules.rules.access === 'day_after', resignedRules);
  ok('only a dashboard admin may change them', (await refusal(() => setExitSettings('mgr', { kinds: { resigned: { holdPay: false } } }))).status === 403);
  ok('a choice that is not on the list is refused', (await refusal(() => setExitSettings('hr', { kinds: { resigned: { noticeRecovery: 'double' } } }))).status === 400);
  const saved = await setExitSettings('hr', { kinds: { retired: { holdPay: false, noticeRecovery: 'days_not_served' } }, noticeDays: 30 });
  const retired = saved.kinds.find((k) => k.kind === 'retired');
  ok('the company changes a kind: saved, the rest of that kind kept', retired?.isDefault === false && retired.rules.holdPay === false && retired.rules.noticeRecovery === 'days_not_served' && retired.rules.noticePay === 'none' && saved.noticeDays === 30, retired);
  const lead = (await listExits('hr', sept10)).find((x) => x.userId === 'lead');
  ok('an exit already recorded keeps its own rules', lead?.rules.holdPay === true, lead?.rules);
  ok('one exit can change its rules: no hold for this person', (await recordExit('hr', 'fresh', { kind: 'resigned', lastWorkingDay: '2026-09-29', rules: { holdPay: false } }, sept10)).rules.holdPay === false);
  ok('an exit can never keep access for good', (await refusal(() => recordExit('hr', 'e1', { kind: 'other', lastWorkingDay: '2026-09-29', rules: { access: 'never' } }, sept10))).status === 400);
  ok('a notice period out of range is refused', (await refusal(() => setExitSettings('hr', { noticeDays: 400 }))).status === 400);
  await setExitSettings('hr', { kinds: { retired: null } });
  ok('a kind sent as null goes back to the default', (await exitSettings('hr')).kinds.find((k) => k.kind === 'retired')?.isDefault === true);

  console.log('calendar');
  const now = new Date();
  const records: AttendanceRecord[] = [];
  for (const [userId, employeeId, lastDay, firstDay] of [['leaver', 'E2', 20, 1], ['stayer', 'E4', 30, 1], ['runner', 'E5', 12, 1], ['joiner', 'E7', 30, 16]] as const) {
    for (let d = firstDay; d <= lastDay; d += 1) {
      const date = `${MONTH}-${String(d).padStart(2, '0')}`;
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
      records.push({
        userId, employeeId, workDate: date, punchIn: new Date(`${date}T09:00:00+05:30`), punchOut: new Date(`${date}T18:05:00+05:30`),
        source: 'manual', sourceKey: `manual|${employeeId}|${date}`, importedAt: now, updatedAt: now,
      });
    }
  }
  await attendanceRecords().insertMany(records);
  const days = await employeeDayStatuses(ORG, 'leaver', `${MONTH}-19`, `${MONTH}-22`);
  // The 20th, their last day, is a Sunday: a week off, still theirs.
  ok('worked up to the last day, then "After leaving"', days?.[0]?.status === 'present' && days?.[1]?.status === 'week_off'
    && days?.[2]?.reason === 'After leaving' && days?.[3]?.reason === 'After leaving', days?.map((d) => [d.date, d.status, d.reason]));
  const report = await attendanceReport('hr', { from: `${MONTH}-01`, to: `${MONTH}-30` });
  const leaverDays = report.days.filter((d) => d[0] === 'leaver');
  ok('the report grades them only up to the last day', leaverDays.length > 0 && leaverDays.every((d) => d[1] <= `${MONTH}-20`), leaverDays.slice(-2));
  ok('no absences after it', !report.days.some((d) => d[0] === 'leaver' && d[1] > `${MONTH}-20`));
  ok('someone who left before the month is not in it', !report.people.gone && !report.days.some((d) => d[0] === 'gone'));

  console.log('payroll');
  await payHeads().insertMany(ZOHO_CATALOG.map((h) => ({ ...h, org: ORG })));
  await salaryTemplates().insertOne({ ...ZOHO_TEMPLATES.BELOW_TAXABLE, org: ORG });
  await paidDaysTemplates().insertOne({ org: ORG, code: 'DEFAULT', name: 'Calendar', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0, isDefault: true, createdAt: now, updatedAt: now });
  await salaryStructures().insertMany(['leaver', 'gone', 'stayer', 'fresh', 'joiner'].map((userId) => ({
    org: ORG, userId, salaryTemplateCode: 'BELOW_TAXABLE', annualCtcPaise: 3_60_000_00, status: 'active' as const, createdAt: now, updatedAt: now,
  })));
  await createRun('hr', { period: MONTH });
  const slip = async (userId: string) => payslips().findOne({ org: ORG, period: MONTH, userId });
  const leaverSlip = await slip('leaver');
  const stayerSlip = await slip('stayer');
  const after = leaverSlip?.inputs.attendanceDeductions?.find((l) => l.label === 'After leaving');
  ok('the leaver is paid to the 20th: 10 days after leaving unpaid', after?.days === 10 && leaverSlip?.inputs.lopDays === 10, leaverSlip?.inputs);
  ok('their pay is two thirds of the month', !!leaverSlip && !!stayerSlip && Math.abs(leaverSlip.grossPaise / stayerSlip.grossPaise - 20 / 30) < 0.01,
    [leaverSlip?.grossPaise, stayerSlip?.grossPaise]);
  ok('someone who left in August gets no September payslip', (await slip('gone')) === null);
  ok('the control is paid in full', stayerSlip?.inputs.lopDays === 0, stayerSlip?.inputs);

  console.log('pay held from the notice');
  ok('the leaver (notice from 21 Aug) is held', leaverSlip?.held?.reason === 'notice' && leaverSlip?.held?.since === '2026-08-21', leaverSlip?.held);
  ok('the control is not held', !stayerSlip?.held);
  ok('an exit whose rules say not to hold: paid with the run', !(await slip('fresh'))?.held);
  const run = (await listRuns('hr')).find((r) => r.period === MONTH)!;
  ok('the run totals the held pay', run.totals.heldCount === 1 && run.totals.heldPaise === leaverSlip?.netPayablePaise, run.totals);
  const bank = await paymentDetails('hr', run.id);
  ok('held pay is not in the bank list', !bank.rows.some((r) => r.employeeId === 'E2') && bank.rows.some((r) => r.employeeId === 'E4'), bank.rows.map((r) => r.employeeId));
  ok('…it is listed apart as held', bank.held.length === 1 && bank.held[0].employeeId === 'E2', bank.held);
  const html = await myPayslipHtmlFor({ ...leaverSlip!, joiningDate: undefined } as never);
  ok('the payslip says it is held', /Held: paid with your final settlement/.test(html));

  console.log('days not employed are not loss of pay');
  const asHtml = (s: NonNullable<typeof leaverSlip>, joined: string) => myPayslipHtmlFor({ ...s, joiningDate: joined } as never);
  const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  // Joined 16 Sep, worked every day since: 15 days not paid (1–15 Sep), none of them loss of pay.
  const joinerSlip = (await slip('joiner'))!;
  ok('the run still does not pay the 15 days before joining', joinerSlip.inputs.lopDays === 15 && joinerSlip.inputs.payableDays === 15 && joinerSlip.inputs.notEmployedDays === 15, joinerSlip.inputs);
  ok('…its pay is half the month, as before', Math.abs(joinerSlip.grossPaise / stayerSlip!.grossPaise - 15 / 30) < 0.01, [joinerSlip.grossPaise, stayerSlip?.grossPaise]);
  ok('…loss of pay 0, not employed 15, employed 15 of the 30 days', lossOfPayDaysOf(joinerSlip.inputs) === 0 && notEmployedDaysOf(joinerSlip.inputs) === 15 && employedDaysOf(joinerSlip.inputs) === 15);
  ok('…all the unpaid amount is "not employed"', unpaidPaiseOf(joinerSlip) > 0 && notEmployedPaiseOf(joinerSlip) === unpaidPaiseOf(joinerSlip) && lossOfPayPaiseOf(joinerSlip) === 0);
  const joinerHtml = await asHtml(joinerSlip, '2026-09-16');
  ok('the payslip has no loss-of-pay line, a "Not employed" one instead', !/Loss of pay ·/.test(joinerHtml) && joinerHtml.includes('Not employed · 15 days (joined 16 Sep)'), joinerHtml.match(/<div class="n">[^<]*<\/div>/g));
  ok('…its days: 15 paid, 0 loss of pay, joined 16 Sep (never "of 30")', joinerHtml.includes('<span>Paid days</span><span>15</span>') && joinerHtml.includes('<span>Loss of pay days</span><span>0</span>') && joinerHtml.includes('<span>Joined</span><span>16 Sep</span>'));
  ok('…and the same net pay', joinerHtml.includes(`<div class="amt">${inr(joinerSlip.netPayablePaise)}</div>`));
  const app = fromPayslip(joinerSlip);
  ok('the app: loss of pay 0, 15 days not employed (joined 16 Sep), the same take-home', app.lopDays === 0 && app.lopPaise === 0 && app.notEmployedDays === 15 && app.notEmployedPaise === unpaidPaiseOf(joinerSlip)
    && app.notEmployedWhen === 'joined 16 Sep' && app.takeHomePaise === joinerSlip.netPayablePaise, app);
  const register = await salaryRegister('hr', MONTH, { includeDrafts: true });
  const regRow = register.rows.find((r) => r.employeeId === 'E7');
  ok('the salary register: LOP 0, 15 days not employed, paid days and net pay as on the slip', regRow?.lopDays === 0 && regRow.notEmployedDays === 15 && regRow.lopAmountPaise === 0
    && regRow.notEmployedAmountPaise === unpaidPaiseOf(joinerSlip) && regRow.paidDays === 15 && regRow.employedDays === 15 && regRow.netPayPaise === joinerSlip.netPayablePaise && regRow.notEmployedNote === '15 days before joining (joined 16 Sep)', regRow);
  // Left on the 20th: the 10 days after are "After leaving".
  ok('the leaver: loss of pay 0, 10 days not employed, left 20 Sep', lossOfPayDaysOf(leaverSlip!.inputs) === 0 && notEmployedDaysOf(leaverSlip!.inputs) === 10 && leaverSlip!.inputs.leftOn === '2026-09-20', leaverSlip?.inputs);
  const leaverHtml = await asHtml(leaverSlip!, '2025-01-01');
  ok('…their payslip: "Not employed · 10 days (left 20 Sep)", 20 paid, 0 loss of pay, left 20 Sep, the same net pay', !/Loss of pay ·/.test(leaverHtml) && leaverHtml.includes('Not employed · 10 days (left 20 Sep)')
    && leaverHtml.includes('<span>Paid days</span><span>20</span>') && leaverHtml.includes('<span>Loss of pay days</span><span>0</span>') && leaverHtml.includes('<span>Left</span><span>20 Sep</span>') && leaverHtml.includes(`<div class="amt">${inr(leaverSlip!.netPayablePaise)}</div>`));
  // Joined the 15th, left the 29th: both, on one line.
  const freshSlip = (await slip('fresh'))!;
  ok('joined and left in the month: 14 before + 1 after, not loss of pay', notEmployedDaysOf(freshSlip.inputs) === 15 && lossOfPayDaysOf(freshSlip.inputs) === freshSlip.inputs.lopDays - 15
    && (await asHtml(freshSlip, '2026-09-15')).includes('Not employed · 15 days (joined 15 Sep, left 29 Sep)'), freshSlip.inputs);
  ok('…the two amounts add up to what the earnings lost', lossOfPayPaiseOf(freshSlip) + notEmployedPaiseOf(freshSlip) === unpaidPaiseOf(freshSlip));
  ok('a full month: nothing not employed', notEmployedDaysOf(stayerSlip!.inputs) === 0 && !(await asHtml(stayerSlip!, '2025-01-01')).includes('Not employed'));

  // HR types the same 15 days (a company paying joiners by the calendar month): those are the days
  // before joining, so not employed, not loss of pay; the pay is the same.
  await recomputeRun('hr', run.id, { lopDays: { joiner: 15 } });
  const typed = (await slip('joiner'))!;
  ok('HR-typed days up to the days before joining are not employed: LOP 0, not employed 15', typed.inputs.lopEnteredByHr === true && lossOfPayDaysOf(typed.inputs) === 0 && notEmployedDaysOf(typed.inputs) === 15 && typed.inputs.notEmployedDays === 15, typed.inputs);
  const typedHtml = await asHtml(typed, '2026-09-16');
  ok('…the payslip says "Not employed · 15 days", no loss of pay, the same net pay', typedHtml.includes('Not employed · 15 days') && !typedHtml.includes('Loss of pay ·') && typed.netPayablePaise === joinerSlip.netPayablePaise);
  // HR types more than the days before joining: the rest is real loss of pay.
  await recomputeRun('hr', run.id, { lopDays: { joiner: 17 } });
  const more = (await slip('joiner'))!;
  ok('…HR types 17: not employed 15, loss of pay 2', lossOfPayDaysOf(more.inputs) === 2 && notEmployedDaysOf(more.inputs) === 15, more.inputs);
  await recomputeRun('hr', run.id, { lopDays: { joiner: null } });
  const back = (await slip('joiner'))!;
  ok('back to attendance: not employed again, the same pay', !back.inputs.lopEnteredByHr && notEmployedDaysOf(back.inputs) === 15 && back.netPayablePaise === joinerSlip.netPayablePaise && back.grossPaise === joinerSlip.grossPaise);

  console.log(`\n${failed ? `${failed} check(s) failed` : `all ${passed} exit checks passed`}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
