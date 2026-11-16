/**
 * Offboarding (employee lifecycle) end to end, on the live exits: resigning in
 * the app, the manager's answer, withdrawing, HR accepting (the exit recorded,
 * the journey created), the handover (checklist, link and file uploads, done),
 * clearance by team (IT, Admin, Finance see and tick only their own; no
 * money), the exit interview (once, in its window, anonymised), moving the last
 * day, the timed jobs (once each), the board's columns and flags, the
 * settlement emailed as a PDF, closing, HR-started exits (O2) and Exit
 * insights (groups under 5 hidden, no quotes). On a scratch database only:
 *   MONGODB_URI=mongodb://127.0.0.1:27133 MONGODB_DB=el_off_check NOTIFY_ORGS=nobody-scratch EMAIL_ORGS=offcheck AWS_S3_BUCKET= npm run offboarding:check
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { companies, connectDb, exitSettlements, getDb, handoverItems, journeyTasks, journeys, lifecycleFiles, lifecycleTemplates, resignations, surveyResponses, users } from '../config/db';
import type { User } from '../models/user.model';
import { closeDueExits, listExits, setClearance } from '../services/exit.service';
import {
  addDays, addWorkingDays, appHandoverFile, changeLastDay, closeOffboarding, emailSettlement, managerLeaver, managerLeavers, markHandoverDone, myOffboarding, offboardingBoard,
  offboardingDetail, offboardingTaskDone, removeHandoverUpload, runOffboardingJobs, sendExitInterview, setAppPage, setHandoverChecklist, setOffboardingClearance, settlementChecks,
  startExit, todayKey, uploadHandover,
} from '../services/lifecycle/offboarding';
import { acceptResignation, managerResignationAction, managerResignations, myResignation, resign, withdrawResignation } from '../services/lifecycle/resignations';
import { exitInsights } from '../services/lifecycle/insights';
import { lifecycleOutbox } from '../services/lifecycle/emails';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 600)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}

const ORG = 'offcheck';
const OFF = 'offoff';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@offcheck.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
  joiningDate: new Date('2024-01-01T00:00:00Z'), managerUserId: 'mgr', ...extra,
} as User);
const at = (key: string, hour = 11) => new Date(`${key}T${String(hour).padStart(2, '0')}:00:00+05:30`);
const keyOf = (d: string | null | undefined) => (d ? todayKey(new Date(d)) : null);

(async () => {
  await connectDb();
  const db = getDb();
  if (!/^el_off/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();

  const now = new Date();
  const T = todayKey(now);
  await companies().insertMany([
    { id: ORG, name: 'Offboard Check Pvt Ltd', features: { exits: true, lifecycle: true }, exitNoticeDays: 60 },
    { id: OFF, name: 'No Lifecycle', features: { exits: true } },
  ] as never[]);
  await users().insertMany([
    person('hr', { name: 'Hema HR', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
    person('it', { name: 'Ishaan IT', dashboardAccess: true, dashboardTabs: ['offboarding'], clearanceTeam: 'it', department: 'Technology' }),
    person('fin', { name: 'Farida Finance', dashboardAccess: true, dashboardTabs: ['offboarding'], department: 'Finance & Accounts' }),
    person('mgr', { name: 'Meera Manager', role: 'manager', managerUserId: 'hr' }),
    person('mgr2', { name: 'Mohan Other', role: 'manager', managerUserId: 'hr' }),
    person('ravi', { name: 'Ravi Menon', employeeId: 'OC-1', department: 'Design', designation: 'Design Lead', joiningDate: new Date('2019-01-01T00:00:00Z') }),
    person('wanda', { name: 'Wanda Withdraw', employeeId: 'OC-2', department: 'Design' }),
    person('lead', { name: 'Lata Lead', employeeId: 'OC-3', department: 'Design' }),
    person('lead_report', { name: 'Lal Report', employeeId: 'OC-4', managerUserId: 'lead' }),
    person('tom', { name: 'Tarun Terminated', employeeId: 'OC-5', department: 'Sales' }),
    person('ivy', { name: 'Ivy Intern', employeeId: 'OC-6', department: 'Design', employeeType: 'intern' }),
    person('other', { name: 'Om Outsider', org: OFF, managerUserId: undefined }),
  ]);

  console.log('the switch');
  ok('off for a company without the lifecycle', (await refusal(() => myResignation('other', now))).status === 404);

  console.log('resigning');
  const before = await myResignation('ravi', now);
  ok('notice from Exit settings when there is no template (60 days)', before.noticeDays === 60 && before.lastDayByNotice === addDays(T, 60) && before.canResign, before);
  await lifecycleTemplates().insertOne({ id: 'tpl-std', org: ORG, kind: 'offboarding', name: 'Standard', isDefault: true, active: true, settings: { noticeDays: 45, exitInterviewOpensDays: 5 }, tasks: [], createdAt: now, updatedAt: now } as never);
  // An empty task list would leave the stub engine nothing to make; the stub's own list is used when the template has none.
  await lifecycleTemplates().updateOne({ id: 'tpl-std' }, { $unset: { tasks: '' } });
  ok('the default offboarding template wins (45 days)', (await myResignation('ravi', now)).noticeDays === 45);
  ok('a reason is required', (await refusal(() => resign('ravi', { reason: '  ' }, now))).status === 400);
  const sent = await resign('ravi', { reason: 'Better opportunity', note: 'Thank you for five years.' }, now);
  ok('sent: with the manager, last day by notice from the notice period', sent.resignation.status === 'with_manager' && sent.resignation.lastDayByNotice === addDays(T, 45) && sent.resignation.managerName === 'Meera Manager', sent.resignation);
  ok('only one open resignation', (await refusal(() => resign('ravi', { reason: 'Pay' }, now))).status === 409);
  ok('the tab shows it, and no new one', (await myResignation('ravi', now)).resignation?.id === sent.resignation.id && !(await myResignation('ravi', now)).canResign);

  console.log('the manager');
  const list = await managerResignations('mgr', now);
  ok('on the manager\'s Requests, with reason and note', list.resignations.length === 1 && list.resignations[0].reason === 'Better opportunity' && list.resignations[0].note.startsWith('Thank you'), list);
  ok('another manager cannot act on it', (await refusal(() => managerResignationAction('mgr2', sent.resignation.id, { action: 'accept' }, now))).status === 404);
  ok('an early release is before the notice day', (await refusal(() => managerResignationAction('mgr', sent.resignation.id, { action: 'release_early', date: addDays(T, 50) }, now))).status === 400);
  const asked = addDays(T, 40);
  const acted = await managerResignationAction('mgr', sent.resignation.id, { action: 'release_early', date: asked, note: 'Fine by me' }, now);
  ok('the manager agrees an early release: with HR', acted.resignation.status === 'with_hr' && acted.resignation.manager?.date === asked, acted.resignation);

  console.log('withdrawing');
  const w = await resign('wanda', { reason: 'Personal' }, now);
  const wd = await withdrawResignation('wanda', now);
  ok('withdrawn before HR accepts', wd.resignation.status === 'withdrawn' && !!(await resignations().findOne({ id: w.resignation.id }))?.withdrawnAt);
  ok('nothing left to withdraw', (await refusal(() => withdrawResignation('wanda', now))).status === 404);
  ok('…and they may resign again', (await myResignation('wanda', now)).canResign);

  console.log('the board, before HR accepts');
  const b1 = await offboardingBoard('hr', { tab: 'resignations' }, now);
  const withHr = b1.columns.find((c) => c.key === 'with_hr')!.cards;
  const pooja = withHr.find((c) => c.userId === 'ravi');
  ok('with HR, needs you, the early release on the card', !!pooja && pooja.flag?.key === 'needs_you' && pooja.lastDayLine.startsWith('Early release') && pooja.owner.role === 'hr', pooja);
  ok('a withdrawn resignation is not on the board', !b1.columns.some((c) => c.cards.some((x) => x.userId === 'wanda')));
  ok('the sidebar count is what waits on HR', b1.waitingOnHr === 1 && b1.counts.resignations === 1, { w: b1.waitingOnHr, c: b1.counts });
  const itBoard = await offboardingBoard('it', { tab: 'resignations' }, now);
  ok('IT staff see no resignations', itBoard.counts.resignations === 0 && itBoard.viewer.kind === 'team');
  const drawer0 = await offboardingDetail('hr', 'ravi', now);
  ok('the drawer before acceptance: reason, manager, track at Accepted', drawer0.resignation?.reason === 'Better opportunity' && drawer0.track.current === 1 && drawer0.details.some((d) => d.label === 'Early release'), drawer0.details);
  ok('IT staff cannot open a resignation', (await refusal(() => offboardingDetail('it', 'ravi', now))).status === 404);

  console.log('HR accepts');
  ok('only HR accepts', (await refusal(() => acceptResignation('it', sent.resignation.id, {}, now))).status === 403);
  const lr = await resign('lead', { reason: 'Relocation' }, now);
  const leadRefused = await refusal(() => acceptResignation('hr', lr.resignation.id, {}, now));
  ok('a manager needs a successor first (the live exit\'s rule), and nothing is written', leadRefused.status === 409 && /reports to Lata Lead/.test(leadRefused.message) && (await resignations().findOne({ id: lr.resignation.id }))?.status === 'with_manager' && !(await users().findOne({ userId: 'lead' }))?.exit, leadRefused);
  const accepted = await acceptResignation('hr', sent.resignation.id, {}, now);
  const ravi = await users().findOne({ userId: 'ravi' });
  ok('the exit is recorded: resigned, notice from the day sent, the agreed last day', ravi?.exit?.kind === 'resigned' && ravi.exit.noticeFrom === T && ravi.exit.lastWorkingDay === asked && ravi.lifecycleStatus === 'notice' && ravi.exit.noticeDays === 45, ravi?.exit);
  ok('an early release recovers no shortfall', ravi?.exit?.rules?.noticeRecovery === 'none', ravi?.exit?.rules);
  ok('the journey: accepted, Tl, from the template', !!accepted.journeyId && (await journeys().findOne({ id: accepted.journeyId }))?.status === 'accepted' && (await journeys().findOne({ id: accepted.journeyId }))?.tl === asked);
  ok('the exit carries the journey and the resignation', ravi?.exit?.offboarding?.journeyId === accepted.journeyId && ravi.exit.offboarding.resignationId === sent.resignation.id && ravi.exit.offboarding.showAppPage === true && ravi.exit.offboarding.exitType === 'resignation');
  ok('clearance: one item per team, the existing keys', JSON.stringify(ravi?.exit?.clearance?.map((c) => [c.key, c.team])) === JSON.stringify([['handover', 'manager'], ['laptop', 'it'], ['id_card', 'admin'], ['advances', 'finance']]), ravi?.exit?.clearance);
  const tasks0 = await journeyTasks().find({ journeyId: accepted.journeyId }).toArray();
  const statusOf = async (key: string) => (await journeyTasks().findOne({ journeyId: accepted.journeyId, systemKey: key as never }))?.status;
  ok('HR accept and "tell IT, Admin and Finance" are done; the handover checklist is to do', tasks0.length > 0 && (await statusOf('hr_accept_exit')) === 'done' && (await statusOf('tell_clearance_teams')) === 'done' && (await statusOf('handover_checklist')) === 'todo');
  ok('the resignation: accepted, by whom, the journey', accepted.resignation.status === 'accepted' && accepted.resignation.hrAcceptedByName === 'Hema HR' && accepted.resignation.journeyId === accepted.journeyId);
  ok('not twice', (await refusal(() => acceptResignation('hr', sent.resignation.id, {}, now))).status === 409);
  ok('no withdrawing after HR accepts', (await refusal(() => withdrawResignation('ravi', now))).status === 409);
  ok('still on People › Exits, with a team per clearance item', (await listExits('hr', now)).some((x) => x.userId === 'ravi' && x.clearance.every((c) => !!c.team)));
  const b2 = await offboardingBoard('hr', { tab: 'resignations' }, now);
  const acc = b2.columns.find((c) => c.key === 'accepted')!.cards.find((c) => c.userId === 'ravi');
  ok('the board: Accepted, the manager to share the checklist', !!acc && acc.owner.role === 'manager' && /handover checklist/.test(acc.nextStep), acc);

  console.log('the handover');
  ok('another manager cannot see the leaver', (await refusal(() => managerLeaver('mgr2', 'ravi', now))).status === 404);
  ok('the leaver is on the manager\'s list', (await managerLeavers('mgr', now)).leavers.some((l) => l.userId === 'ravi'));
  const set = await setHandoverChecklist('mgr', 'ravi', { items: ['Design system file', 'Open projects', 'Vendor list', 'Open projects'], note: 'Please share by the 20th.' }, now);
  ok('the checklist and the note (duplicates dropped)', set.handover.items.length === 3 && set.handover.note === 'Please share by the 20th.' && (await statusOf('handover_checklist')) === 'done', set.handover);
  ok('the manager sees the reason, never pay', set.resignation?.reason === 'Better opportunity' && !/paise|payable|salary/i.test(JSON.stringify(set)));
  const page = await myOffboarding('ravi', now);
  ok('the Off-boarding page: last day, the checklist, the note, the interview not open yet', page.tl === asked && page.handover.length === 3 && page.handoverNote === 'Please share by the 20th.' && page.interview.applies && !page.interview.open && page.interview.opensAt === addDays(asked, -5), page.interview);
  ok('no settlement figures in the app', !/paise|payable/i.test(JSON.stringify(page)));
  const [i1, i2, i3] = page.handover;
  ok('a link must be a link', (await refusal(() => uploadHandover('ravi', i1.id, { url: 'not a link' }, now))).status === 400);
  const up1 = await uploadHandover('ravi', i1.id, { url: 'https://docs.example/ds' }, now);
  ok('a link against an item', up1.item.upload?.kind === 'link' && up1.item.upload.url === 'https://docs.example/ds');
  const pdf = Buffer.from('%PDF-1.4\n% handover\n'.padEnd(200, ' '));
  const up2 = await uploadHandover('ravi', i2.id, { file: { name: 'projects.pdf', contentType: 'application/pdf', bytes: pdf } }, now);
  const fileRow = await lifecycleFiles().findOne({ journeyId: accepted.journeyId });
  ok('a file against an item (stored locally without S3)', up2.item.upload?.kind === 'file' && up2.item.upload.name === 'projects.pdf' && !!fileRow && fileRow.objectKey.startsWith(`lifecycle/${ORG}/`), up2.item);
  const served = await appHandoverFile('mgr', i2.id) as { bytes: Buffer };
  ok('the manager can open it', Buffer.isBuffer(served.bytes) && served.bytes.subarray(0, 5).toString() === '%PDF-');
  ok('someone else cannot', (await refusal(() => appHandoverFile('wanda', i2.id))).status === 404);
  ok('not someone else\'s item', (await refusal(() => uploadHandover('wanda', i3.id, { url: 'https://x.example' }, now))).status === 404);
  await removeHandoverUpload('ravi', i2.id);
  ok('an upload can be removed to replace it', !(await handoverItems().findOne({ id: i2.id }))?.upload);
  await uploadHandover('ravi', i2.id, { url: 'https://docs.example/projects' }, now);
  const b3 = await offboardingBoard('hr', { tab: 'notice' }, now);
  const ho = b3.columns.find((c) => c.key === 'handover')!.cards.find((c) => c.userId === 'ravi');
  ok('the board: Handover, 2 of 3 uploaded, waiting on the employee', !!ho && ho.nextStep === 'Handover: 2 of 3 items uploaded' && ho.owner.role === 'employee', ho);
  await uploadHandover('ravi', i3.id, { url: 'https://docs.example/vendors' }, now);
  ok('every item uploaded: the upload task is done', (await statusOf('upload_handover')) === 'done');
  const b4 = await offboardingBoard('hr', { tab: 'notice' }, now);
  const cl = b4.columns.find((c) => c.key === 'clearance')!.cards.find((c) => c.userId === 'ravi');
  ok('the board: Clearance 0 of 4, the manager first', !!cl && cl.nextStep === 'Clearance: 0 of 4 done' && cl.owner.role === 'manager', cl);
  await markHandoverDone('mgr', 'ravi', now);
  const afterDone = await users().findOne({ userId: 'ravi' });
  ok('handover done: the Manager clearance item ticks, the task is done', afterDone?.exit?.clearance?.find((c) => c.key === 'handover')?.done === true && (await statusOf('mark_handover_done')) === 'done');

  console.log('clearance by team');
  const itView = await offboardingDetail('it', 'ravi', now);
  ok('IT sees only its own item, no reason, no money', itView.clearance.length === 1 && itView.clearance[0].team === 'it' && !itView.resignation && !itView.settlement && !/Better opportunity/.test(JSON.stringify(itView)), itView.clearance);
  ok('IT cannot tick Finance\'s item', (await refusal(() => setOffboardingClearance('it', 'ravi', { key: 'advances', done: true }, now))).status === 403);
  await setOffboardingClearance('it', 'ravi', { key: 'laptop', done: true }, now);
  ok('IT ticks the laptop', (await users().findOne({ userId: 'ravi' }))?.exit?.clearance?.find((c) => c.key === 'laptop')?.done === true);
  ok('only Finance\'s item carries an amount', (await refusal(() => setOffboardingClearance('hr', 'ravi', { key: 'laptop', done: true, amountPaise: 100 }, now))).status === 400);
  await setOffboardingClearance('fin', 'ravi', { key: 'advances', done: false, amountPaise: 500000, note: 'Salary advance' }, now);
  const finView = await offboardingDetail('fin', 'ravi', now);
  ok('Finance (from its department) sees its amount', finView.clearance.length === 1 && finView.clearance[0].amountPaise === 500000, finView.clearance);
  const b5 = await offboardingBoard('hr', { tab: 'notice' }, now);
  const rec = b5.columns.flatMap((c) => c.cards).find((c) => c.userId === 'ravi');
  ok('an amount open on Finance\'s item flags Recovery', rec?.column === 'clearance' && rec.flag?.key === 'recovery', rec);
  const itCard = (await offboardingBoard('it', { tab: 'notice' }, now)).columns.flatMap((c) => c.cards).find((c) => c.userId === 'ravi');
  ok('on the IT board: only IT\'s item, done', itCard?.nextStep.endsWith(': done') === true && itCard.owner.role === 'it', itCard);
  await setOffboardingClearance('hr', 'ravi', { key: 'id_card', done: true }, now);
  ok('IT and Admin done: Return laptop and ID card is done', (await statusOf('return_assets')) === 'done');
  await setOffboardingClearance('fin', 'ravi', { key: 'advances', done: true, amountPaise: 500000 }, now);
  ok('Finance done: the Finance clearance task is done', (await statusOf('finance_clearance')) === 'done');
  ok('HR\'s own clearance tick (People › Exits) keeps the teams', (await setClearance('hr', 'ravi', { key: 'laptop', done: true }, now)).exit.clearance.every((c) => !!c.team));
  const b6 = (await offboardingBoard('hr', { tab: 'notice' }, now)).columns.flatMap((c) => c.cards).find((c) => c.userId === 'ravi');
  ok('all clear before the interview opens: Last week', b6?.column === 'last_week' && b6.flag?.key === 'all_clear', b6);

  console.log('moving the last day');
  const newTl = addDays(asked, -3);
  await changeLastDay('hr', 'ravi', { lastWorkingDay: newTl }, now);
  const moved = await users().findOne({ userId: 'ravi' });
  const upTask = await journeyTasks().findOne({ journeyId: accepted.journeyId, systemKey: 'exit_interview' });
  ok('the exit, the journey and the resignation move together; what was ticked stays', moved?.exit?.lastWorkingDay === newTl && (await journeys().findOne({ id: accepted.journeyId }))?.tl === newTl
    && (await resignations().findOne({ id: sent.resignation.id }))?.agreedLastDay === newTl && !!moved.exit.clearance?.every((c) => c.done) && moved.exit.offboarding?.journeyId === accepted.journeyId, moved?.exit);
  ok('a task dated from Tl has moved (the interview opens Tl − 5)', keyOf(upTask?.opensAt?.toISOString()) === addDays(newTl, -5), upTask?.opensAt);
  ok('moving to a day still in notice keeps no shortfall', moved?.exit?.rules?.noticeRecovery === 'none');

  console.log('the exit interview');
  const opensAt = addDays(newTl, -5);
  ok('not before it opens', (await refusal(() => sendExitInterview('ravi', { reason: 'Growth' }, at(addDays(opensAt, -1))))).status === 409);
  const job1 = await runOffboardingJobs(at(opensAt));
  const job2 = await runOffboardingJobs(at(opensAt, 15));
  ok('Tl − 5: the interview opens, pushed once', job1.interviewOpened === 1 && job2.interviewOpened === 0, [job1, job2]);
  const b7 = (await offboardingBoard('hr', {}, at(opensAt))).counts;
  const ei = (await offboardingBoard('hr', { tab: 'notice' }, at(opensAt))).columns.find((c) => c.key === 'exit_interview')!.cards.find((c) => c.userId === 'ravi');
  ok('the board: Exit interview, waiting on the employee', !!ei && ei.owner.role === 'employee' && b7.notice >= 1, ei);
  ok('a reason from the list', (await refusal(() => sendExitInterview('ravi', { reason: 'Boredom' }, at(opensAt)))).status === 400);
  ok('ratings are 1 to 5', (await refusal(() => sendExitInterview('ravi', { workingHere: 9 }, at(opensAt)))).status === 400);
  await sendExitInterview('ravi', { reason: 'Growth', workingHere: 4, manager: 3, comeBack: 'maybe', change: 'Clearer growth paths.' }, at(opensAt));
  const iv = (await users().findOne({ userId: 'ravi' }))?.exit?.interview;
  ok('saved on the exit for HR, as the employee\'s', iv?.reason === 'growth' && iv.workRating === 4 && iv.managerRating === 3 && iv.comeBack === 'maybe' && iv.filledBy === 'employee', iv);
  const row = await surveyResponses().findOne({ org: ORG, kind: 'exit' });
  ok('and anonymised: no person, no journey; department, tenure band, month; dated the 1st', !!row && !row.userId && !row.journeyId && row.department === 'Design' && row.tenureBand === '5y+' && row.month === opensAt.slice(0, 7)
    && row.createdAt.toISOString() === new Date(`${opensAt.slice(0, 7)}-01T00:00:00+05:30`).toISOString(), row);
  ok('once only', (await refusal(() => sendExitInterview('ravi', { reason: 'Pay' }, at(opensAt)))).status === 409);
  ok('the interview task is done', (await statusOf('exit_interview')) === 'done');
  const hrDrawer = await offboardingDetail('hr', 'ravi', at(opensAt));
  ok('the board never shows the answers', !/Clearer growth|growth paths/.test(JSON.stringify(hrDrawer)) && hrDrawer.details.some((d) => d.label === 'Exit interview' && d.value === 'Sent'), hrDrawer.details);

  console.log('the last day and after');
  const ld = (await offboardingBoard('hr', { tab: 'exit' }, at(newTl))).columns.find((c) => c.key === 'last_day')!.cards.find((c) => c.userId === 'ravi');
  ok('on Tl: Last day today, account closes tonight', !!ld && ld.nextStep === 'Account closes tonight', ld);
  ok('no closing before the settlement is sent', (await refusal(() => closeOffboarding('hr', 'ravi', {}, at(newTl)))).status === 409);
  // A settlement worked out by payroll (the plan checks cover the arithmetic): drafted, with gratuity.
  await exitSettlements().insertOne({ org: ORG, userId: 'ravi', status: 'draft', lines: [{ key: 'gratuity', side: 'earning', label: 'Gratuity', computedPaise: 9_000_00, amountPaise: 9_000_00 }], earningsPaise: 9_000_00, deductionsPaise: 0, payablePaise: 9_000_00, createdAt: now, updatedAt: now });
  const dayAfter = addDays(newTl, 1);
  await closeDueExits(at(dayAfter, 0));
  ok('Tl + 1: access ends (the live job)', !!(await users().findOne({ userId: 'ravi' }))?.exit?.accessEndedAt);
  const job3 = await runOffboardingJobs(at(dayAfter, 1));
  ok('the Close account task follows', job3.accountsClosed === 1 && (await statusOf('close_account')) === 'done', job3);
  const due = addWorkingDays(newTl, 2);
  const sd = (await offboardingBoard('hr', { tab: 'exit' }, at(dayAfter, 2))).columns.find((c) => c.key === 'settlement_due')!.cards.find((c) => c.userId === 'ravi');
  ok('Settlement due, needs you, due Tl + 2 working days', !!sd && sd.flag?.key === 'needs_you' && sd.due === due && /email the PDF/.test(sd.nextStep), sd);
  const job4 = await runOffboardingJobs(at(due));
  const job5 = await runOffboardingJobs(at(due, 15));
  ok('Tl + 2 working days: the settlement-due flag, once', job4.settlementDue === 1 && job5.settlementDue === 0 && (await journeys().findOne({ id: accepted.journeyId }))?.status === 'settlement_due', [job4, job5]);

  console.log('the settlement, emailed as a PDF');
  const goodPdf = Buffer.from('%PDF-1.4\n'.padEnd(400, '0')).toString('base64');
  ok('approve before emailing', (await refusal(() => emailSettlement('hr', 'ravi', { pdfBase64: goodPdf, to: 'ravi.m@example.com' }, at(due)))).status === 409);
  await exitSettlements().updateOne({ org: ORG, userId: 'ravi' }, { $set: { status: 'approved', approvedAt: at(due) } });
  const checks = await settlementChecks('hr', 'ravi', at(due));
  ok('the checks before sending: clearance 4 of 4, no personal email yet', checks.clearance.done === 4 && checks.clearance.total === 4 && !checks.personalEmail.ok && checks.open, checks);
  ok('IT staff cannot see a settlement', (await refusal(() => settlementChecks('it', 'ravi', at(due)))).status === 403);
  ok('a personal email is needed', (await refusal(() => emailSettlement('hr', 'ravi', { pdfBase64: goodPdf, to: 'nope' }, at(due)))).status === 400);
  ok('the PDF must be a PDF', (await refusal(() => emailSettlement('hr', 'ravi', { pdfBase64: Buffer.from('hello'.repeat(40)).toString('base64'), to: 'ravi.m@example.com' }, at(due)))).status === 400);
  const outBefore = lifecycleOutbox().length;
  await emailSettlement('hr', 'ravi', { pdfBase64: `data:application/pdf;base64,${goodPdf}`, to: 'Ravi.M@example.com' }, at(due));
  const mail = lifecycleOutbox()[outBefore];
  ok('emailed to the personal email with the PDF attached', !!mail && mail.to === 'ravi.m@example.com' && mail.attachments.length === 1 && mail.attachments[0].content.subarray(0, 5).toString() === '%PDF-' && mail.attachments[0].filename === 'Settlement_OC-1.pdf', mail && { to: mail.to, files: mail.attachments.map((a) => a.filename) });
  const afterMail = await users().findOne({ userId: 'ravi' });
  ok('kept: the personal email, when and to whom it went', afterMail?.personalEmail === 'ravi.m@example.com' && afterMail.exit?.offboarding?.settlementEmail?.to === 'ravi.m@example.com');
  ok('the journey: settlement sent, the settlement task done', (await journeys().findOne({ id: accepted.journeyId }))?.status === 'settlement_sent' && (await statusOf('final_settlement')) === 'done');
  const ss = (await offboardingBoard('hr', { tab: 'exit' }, at(due))).columns.find((c) => c.key === 'settlement_sent')!.cards.find((c) => c.userId === 'ravi');
  ok('Settlement sent: gratuity to pay (Finance)', !!ss && ss.nextStep === 'Gratuity to pay' && ss.owner.role === 'finance', ss);
  ok('IT cannot tick gratuity', (await refusal(() => offboardingTaskDone('it', 'ravi', 'gratuity', {}, at(due)))).status === 403);
  await offboardingTaskDone('fin', 'ravi', 'gratuity', {}, at(due));
  const ss2 = (await offboardingBoard('hr', { tab: 'exit' }, at(due))).columns.find((c) => c.key === 'settlement_sent')!.cards.find((c) => c.userId === 'ravi');
  ok('then the relieving letter (HR)', ss2?.nextStep === 'Send the relieving letter' && ss2.owner.role === 'hr', ss2);
  const job6 = await runOffboardingJobs(at(addDays(newTl, 30)));
  const job7 = await runOffboardingJobs(at(addDays(newTl, 31)));
  ok('Tl + 30: gratuity due, once (5 years and more)', job6.gratuityDue === 1 && job7.gratuityDue === 0, [job6, job7]);
  await closeOffboarding('hr', 'ravi', {}, at(due));
  const closed = (await offboardingBoard('hr', { tab: 'exit' }, at(due))).columns.find((c) => c.key === 'closed')!.cards.find((c) => c.userId === 'ravi');
  ok('closed', !!closed && closed.flag?.key === 'closed' && (await journeys().findOne({ id: accepted.journeyId }))?.status === 'closed', closed);
  ok('the jobs leave a closed journey alone', Object.values(await runOffboardingJobs(at(addDays(newTl, 40)))).every((n) => n === 0));

  console.log('Start an exit (O2)');
  ok('a known exit type', (await refusal(() => startExit('hr', 'tom', { exitType: 'vanished', lastWorkingDay: addDays(T, 10) }, now))).status === 400);
  ok('only HR', (await refusal(() => startExit('it', 'tom', { exitType: 'termination', lastWorkingDay: addDays(T, 10) }, now))).status === 403);
  ok('not someone who has resigned in the app', /Accept that resignation/.test((await refusal(() => startExit('hr', 'lead', { exitType: 'retirement', lastWorkingDay: addDays(T, 10) }, now))).message));
  ok('not someone with an exit already', (await refusal(() => startExit('hr', 'ravi', { exitType: 'retirement', lastWorkingDay: addDays(T, 10) }, now))).status === 409);
  const term = await startExit('hr', 'tom', { exitType: 'termination', lastWorkingDay: addDays(T, 10), noticeHandling: 'paid_in_lieu', hrNote: 'Policy breach' }, now);
  const tom = await users().findOne({ userId: 'tom' });
  ok('termination: kind terminated, paid in lieu, the app page off by default', tom?.exit?.kind === 'terminated' && tom.exit.rules?.noticePay === 'pay' && tom.exit.offboarding?.showAppPage === false && tom.exit.note === 'Policy breach' && !!term.journeyId, tom?.exit);
  ok('…its company rule ends access at once, as on People › Exits', !!tom?.exit?.accessEndedAt && tom.lifecycleStatus === 'terminated');
  const eoc = await startExit('hr', 'ivy', { exitType: 'end_of_contract', lastWorkingDay: addDays(T, 20), noticeHandling: 'waived', tellManagerNow: false }, now);
  const ivy = await users().findOne({ userId: 'ivy' });
  ok('end of contract: recorded as "other", its type kept, the page on, no interview', ivy?.exit?.kind === 'other' && ivy.exit.offboarding?.exitType === 'end_of_contract' && ivy.exit.offboarding.showAppPage && ivy.exit.rules?.noticeRecovery === 'none' && !!eoc.journeyId);
  const ivyPage = await myOffboarding('ivy', now);
  ok('…its page has no exit interview', !ivyPage.interview.applies);
  ok('the board names the type', eoc.card.exitTypeLabel === 'End of contract');
  const off = await setAppPage('hr', 'ivy', { showAppPage: false }, now);
  ok('HR can turn the page off', off.card.userId === 'ivy' && (await refusal(() => myOffboarding('ivy', now))).status === 404);

  console.log('Exit insights');
  const ins1 = await exitInsights('hr', { from: addDays(T, -400), to: addDays(T, 400) }, at(addDays(newTl, 2)));
  ok('under 5 answers: everything from the answers is hidden', ins1.hidden && ins1.reasons.length === 0 && ins1.workingHere === null && ins1.answered.count === 1, ins1);
  const month = opensAt.slice(0, 7);
  await surveyResponses().insertMany([4, 5, 3, 4, 2].map((w, i) => ({ id: `s${i}`, org: ORG, kind: 'exit' as const, department: i < 4 ? 'Design' : 'Sales', tenureBand: '1-2y' as const, month, answers: { reason: i < 3 ? 'growth' : 'pay', workingHere: w, manager: 3, comeBack: i % 2 ? 'yes' : 'no', change: 'secret words' }, theme: i < 2 ? 'Clearer growth paths' : undefined, createdAt: new Date(`${month}-01T00:00:00+05:30`) })));
  const ins = await exitInsights('hr', { from: addDays(T, -400), to: addDays(T, 400) }, at(addDays(newTl, 2)));
  const design = ins.groups.find((g) => g.key === 'Design');
  const sales = ins.groups.find((g) => g.key === 'Sales');
  ok('6 answers: reasons, averages and come-back show', !ins.hidden && ins.reasons[0]?.key === 'growth' && ins.reasons[0].count === 4 && ins.workingHere?.average === 3.7 && ins.comeBack?.yes === 2, { r: ins.reasons, w: ins.workingHere, c: ins.comeBack });
  ok('themes counted, quotes never returned', ins.themes[0]?.label === 'Clearer growth paths' && ins.themes[0].count === 2 && !/secret words|Clearer growth paths\./.test(JSON.stringify(ins)), ins.themes);
  ok('a department with 5 answers shows ratings; one with 1 is hidden', !!design && design.answers === 5 && design.workingHere !== null && !!sales && sales.answers === 1 && sales.workingHere === null && sales.hidden, ins.groups);
  ok('people who left: resigned and HR-started', ins.left.resigned === 1 && ins.left.hrStarted >= 0, ins.left);
  const byTenure = await exitInsights('hr', { from: addDays(T, -400), to: addDays(T, 400), groupBy: 'tenure' }, at(addDays(newTl, 2)));
  ok('by tenure band', byTenure.groups.some((g) => g.key === '1-2y' && g.answers === 5 && g.workingHere !== null), byTenure.groups);

  // Clean the local file this check wrote.
  await fs.rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', ORG), { recursive: true, force: true });
  console.log(`\n${failed ? `${failed} check(s) failed` : `all ${passed} offboarding checks passed`}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
