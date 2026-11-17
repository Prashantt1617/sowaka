/**
 * The fixes for the test tracker's reports (17 Nov 2026), each against the case that showed it:
 * the reveal's letter, the closed account's HR email, Exit insights' share, the exit-interview task,
 * the Day-1 pass manager, handover file types and "handover done" for the leaver, the settlement sent
 * twice and "Not set up", a leaving manager's joiners, two HR accepts at once, the template picked at
 * accept, and one Default template per company. On a scratch database only:
 *   MONGODB_URI=mongodb://127.0.0.1:27133 MONGODB_DB=el_off_tracker NOTIFY_ORGS=nobody-scratch EMAIL_ORGS=trackfix AWS_S3_BUCKET= npm run tracker:check
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { companies, connectDb, exitSettlements, getDb, handoverItems, journeyTasks, journeys, letters, lifecycleMeetings, lifecycleTemplates, peopleToMeet, resignations, salaryStructures, surveyResponses, users } from '../config/db';
import type { User } from '../models/user.model';
import { accountClosedFor } from '../services/auth.service';
import { recordExit } from '../services/exit.service';
import { computeSettlement } from '../services/exitSettlement.service';
import { actOnTaskByHr, updateJourneyByHr } from '../services/lifecycle/board';
import { sendSurvey, surveyView } from '../services/lifecycle/appOnboarding';
import { runLifecycleJobs } from '../services/lifecycle/jobs';
import { createOffer } from '../services/lifecycle/offers';
import { createOnboardingJourney, deriveJourney, isWeek1Done, onJoined, tasksOf } from '../services/lifecycle/engine';
import { handoverFileType } from '../services/lifecycle/handoverFiles';
import { checkUpload, MAX_UPLOAD_BYTES, MULTER_FILE_LIMIT } from '../services/lifecycle/files';
import express from 'express';
import multer from 'multer';
import { exitInsights } from '../services/lifecycle/insights';
import { addDays, emailSettlement, markHandoverDone, myOffboarding, runOffboardingJobs, setHandoverChecklist, startExit, todayKey, uploadHandover } from '../services/lifecycle/offboarding';
import { portalPass } from '../services/lifecycle/portal';
import { revealFor } from '../services/lifecycle/probation';
import { acceptResignation, resign } from '../services/lifecycle/resignations';
import { ensureDefaultTemplates } from '../services/lifecycle/templates';

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

const ORG = 'trackfix';
const person = (userId: string, extra: Partial<User> = {}): User => ({
  userId, name: userId, email: `${userId}@trackfix.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
  joiningDate: new Date('2024-01-01T00:00:00Z'), managerUserId: 'mgr', ...extra,
} as User);
const HR = { userId: 'hr', name: 'Hema HR' };

(async () => {
  await connectDb();
  const db = getDb();
  if (!/^el_off/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  // A fresh connection runs the startup indexes again (the drop took them), as on a server start.
  const { closeDb } = await import('../config/db');
  await closeDb();
  await connectDb();
  const now = new Date();
  const T = todayKey(now);

  await companies().insertMany([{ id: ORG, name: 'Track Fix Pvt Ltd', features: { exits: true, lifecycle: true }, exitNoticeDays: 60 }] as never[]);
  await users().insertMany([
    person('hr', { name: 'Hema HR', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined, email: 'hema@trackfix.test' }),
    person('support', { name: 'Support', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined, email: 'support@getsowaka.com', hiddenFromDirectory: true }),
    person('mgr', { name: 'Meera Manager', role: 'manager', managerUserId: 'hr' }),
    person('mgr2', { name: 'Mohan Next', role: 'manager', managerUserId: 'hr' }),
    person('lead', { name: 'Lata Lead', role: 'manager', managerUserId: 'hr' }),
    person('rita', { name: 'Rita Resigns', employeeId: 'TF-1', department: 'Design' }),
    person('dan', { name: 'Dan Double', employeeId: 'TF-2', department: 'Design' }),
    person('tess', { name: 'Tess Template', employeeId: 'TF-3', department: 'Design' }),
    person('cora', { name: 'Cora Contract', employeeId: 'TF-4', department: 'Sales' }),
    person('joy', { name: 'Joy Joiner', employeeId: 'TF-5', department: 'Design', joiningDate: new Date(`${addDays(T, -200)}T00:00:00Z`) }),
    person('wes', { name: 'Wes Week', employeeId: 'TF-6', department: 'Design', joiningDate: new Date(`${addDays(T, -6)}T00:00:00Z`) }),
  ]);

  console.log('one Default template per company');
  await Promise.all([ensureDefaultTemplates(ORG), ensureDefaultTemplates(ORG), ensureDefaultTemplates(ORG)]);
  ok('three first visits at once make one Default of each kind', (await lifecycleTemplates().countDocuments({ org: ORG, kind: 'onboarding', isDefault: true })) === 1 && (await lifecycleTemplates().countDocuments({ org: ORG, kind: 'offboarding', isDefault: true })) === 1);
  const dupe = await refusal(() => lifecycleTemplates().insertOne({ id: randomUUID(), org: ORG, kind: 'onboarding', name: 'Standard', isDefault: true, active: true } as never));
  ok('the database refuses a second Default', /E11000|duplicate key/.test(dupe.message), dupe);
  await lifecycleTemplates().updateOne({ org: ORG, kind: 'offboarding', isDefault: true }, { $set: { 'settings.noticeDays': 45, 'settings.exitInterviewOpensDays': 5 } });

  console.log('handover file types');
  const pdf = Buffer.from('%PDF-1.4\n'.padEnd(400, '0'));
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  ok('a PDF, a Word file, a ZIP and a CSV are taken', handoverFileType('notes.pdf', pdf)?.contentType === 'application/pdf' && handoverFileType('plan.docx', zip)?.ext === '.docx' && handoverFileType('all.zip', zip)?.contentType === 'application/zip' && handoverFileType('list.csv', Buffer.from('a,b\n1,2\n'))?.contentType === 'text/csv');
  ok('a program is refused by its bytes, whatever its name', handoverFileType('report.pdf', exe) === null && handoverFileType('tool.exe', exe) === null);
  ok('a program name is refused even with document bytes', handoverFileType('setup.exe', pdf) === null && handoverFileType('run.sh', Buffer.from('echo hi')) === null);
  ok('a script with #! and binary text are refused', handoverFileType('notes.txt', Buffer.from('#!/bin/sh\nrm -rf /')) === null && handoverFileType('notes.txt', Buffer.from([0x00, 0x01, 0x02])) === null);

  console.log('two HR accepts at once, and "handover done" on the leaver\'s page');
  const dr = await resign('dan', { reason: 'Growth' }, now);
  const both = await Promise.allSettled([acceptResignation('hr', dr.resignation.id, {}, now), acceptResignation('hr', dr.resignation.id, {}, now)]);
  const wins = both.filter((r) => r.status === 'fulfilled').length;
  const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  ok('one accept wins, the other is refused', wins === 1 && (lost?.reason as { statusCode?: number })?.statusCode === 409, both.map((b) => b.status));
  ok('…and one offboarding journey for the person', (await journeys().countDocuments({ org: ORG, kind: 'offboarding', userId: 'dan' })) === 1);
  const danJourney = (await users().findOne({ userId: 'dan' }))!.exit!.offboarding!.journeyId!;
  await setHandoverChecklist('mgr', 'dan', { items: ['Design files', 'Vendor list'], note: 'Thanks' }, now);
  const items = await handoverItems().find({ journeyId: danJourney }).toArray();
  const refused = await refusal(() => uploadHandover('dan', items[0].id, { file: { name: 'tool.pdf', contentType: 'application/pdf', bytes: exe } }, now));
  ok('a handover upload that is a program is refused (415)', refused.status === 415, refused);
  const up = await uploadHandover('dan', items[0].id, { file: { name: 'files.zip', contentType: 'application/octet-stream', bytes: zip } }, now);
  ok('an archive is taken', up.item.upload?.kind === 'file');
  const firstFile = (await handoverItems().findOne({ id: items[0].id }))!.upload!.fileId!;
  await uploadHandover('dan', items[0].id, { file: { name: 'files.pdf', contentType: 'application/pdf', bytes: pdf } }, now);
  ok('replacing an upload removes the old file (its row and its object)', !(await getDb().collection('lifecycle_files').findOne({ id: firstFile })), firstFile);
  await uploadHandover('dan', items[1].id, { url: 'https://docs.example/vendors' }, now);
  await markHandoverDone('mgr', 'dan', now);
  const page = await myOffboarding('dan', now);
  ok('the leaver sees the manager\'s "handover done", with its date', page.handoverDone === true && !!page.handoverDoneAt, { done: page.handoverDone, at: page.handoverDoneAt });
  // Clean the local file written above.
  await fs.rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', ORG), { recursive: true, force: true });

  console.log('the template picked at accept');
  const shortTpl = { ...(await lifecycleTemplates().findOne({ org: ORG, kind: 'offboarding', isDefault: true }, { projection: { _id: 0 } }))!, id: 'tpl-short', name: 'Short notice', isDefault: false };
  shortTpl.settings = { ...shortTpl.settings, noticeDays: 30, accountCloses: 'tl_end_of_shift' };
  await lifecycleTemplates().insertOne(shortTpl as never);
  const tr = await resign('tess', { reason: 'Pay' }, now);
  ok('the resignation is sent with the Default\'s notice (45 days)', tr.resignation.lastDayByNotice === addDays(T, 45));
  await acceptResignation('hr', tr.resignation.id, { templateId: 'tpl-short' }, now);
  const tess = await users().findOne({ userId: 'tess' });
  const tessJ = await journeys().findOne({ id: tess!.exit!.offboarding!.journeyId });
  ok('the picked template sets the notice and the last day (30 days)', tess?.exit?.noticeDays === 30 && tess.exit.lastWorkingDay === addDays(T, 30), tess?.exit);
  ok('…and the account closes as it says (end of shift, from its journey)', tessJ?.templateSnapshot?.settings?.accountCloses === 'tl_end_of_shift');
  ok('the resignation keeps the notice it was accepted with', (await resignations().findOne({ id: tr.resignation.id }))?.noticeDays === 30);

  console.log('exactly 10 MB is taken, one byte more is not');
  const N = MAX_UPLOAD_BYTES;
  const app = express();
  app.post('/u', (req, res) => multer({ storage: multer.memoryStorage(), limits: { fileSize: MULTER_FILE_LIMIT } }).single('file')(req, res, (e: unknown) => res.status(e ? 413 : 200).end()));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const post = async (size: number) => { const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(size)]), 'f.pdf'); return (await fetch(`http://127.0.0.1:${port}/u`, { method: 'POST', body: fd })).status; };
  const edges = [await post(N), await post(N + 1)];
  server.close();
  ok('the upload limit (every upload route): 10,485,760 bytes in, 10,485,761 refused', edges[0] === 200 && edges[1] === 413, edges);
  const pdfOf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9)]);
  ok('a candidate document of exactly 10 MB passes the check; one byte more is 413', checkUpload(pdfOf(N)) === 'application/pdf' && (await refusal(async () => checkUpload(pdfOf(N + 1)))).status === 413);
  await setHandoverChecklist('mgr', 'tess', { items: ['Big file'] }, now);
  const big = (await handoverItems().findOne({ journeyId: tessJ!.id }))!;
  const at10 = await uploadHandover('tess', big.id, { file: { name: 'big.pdf', contentType: 'application/pdf', bytes: pdfOf(N) } }, now);
  const over = await refusal(() => uploadHandover('tess', big.id, { file: { name: 'big.pdf', contentType: 'application/pdf', bytes: pdfOf(N + 1) } }, now));
  ok('a handover file of exactly 10 MB is taken; one byte more is 413', at10.item.upload?.kind === 'file' && over.status === 413, over);
  await fs.rm(path.resolve(__dirname, '../../.local-uploads/lifecycle', ORG), { recursive: true, force: true });

  console.log('the exit-interview task');
  await startExit('hr', 'cora', { exitType: 'end_of_contract', lastWorkingDay: addDays(T, 3), noticeHandling: 'not_applicable' }, now);
  const coraJ = (await users().findOne({ userId: 'cora' }))!.exit!.offboarding!.journeyId!;
  ok('an exit with no interview: its interview task is skipped at once', (await journeyTasks().findOne({ journeyId: coraJ, systemKey: 'exit_interview' }))?.status === 'skipped');
  // Rita's interview opens 5 days before her last day: the hourly job opens the task on that day.
  const rr = await resign('rita', { reason: 'Growth' }, now);
  await acceptResignation('hr', rr.resignation.id, { lastWorkingDay: addDays(T, 8) }, now);
  const ritaJ = (await users().findOne({ userId: 'rita' }))!.exit!.offboarding!.journeyId!;
  ok('before its day the interview task is locked', (await journeyTasks().findOne({ journeyId: ritaJ, systemKey: 'exit_interview' }))?.status === 'locked');
  await runOffboardingJobs(new Date(`${addDays(T, 3)}T11:00:00+05:30`));
  ok('on its day the hourly job opens it (todo), as the app\'s interview does', (await journeyTasks().findOne({ journeyId: ritaJ, systemKey: 'exit_interview' }))?.status === 'todo');

  console.log('the closed account\'s HR email');
  await users().updateOne({ userId: 'cora' }, { $set: { lifecycleStatus: 'offboarded' } });
  const cora = await users().findOne({ userId: 'cora' });
  const closed = await accountClosedFor(cora!);
  ok('no company email: the HR who recorded the exit', closed?.hrEmail === 'hema@trackfix.test', closed);
  await users().updateOne({ userId: 'hr' }, { $set: { email: '' } });
  const closed2 = await accountClosedFor((await users().findOne({ userId: 'cora' }))!);
  ok('…then a dashboard admin, never the hidden support account (none left here: empty)', closed2?.hrEmail === '', closed2);
  await users().updateOne({ userId: 'hr' }, { $set: { email: 'hema@trackfix.test' } });

  console.log('Exit insights');
  // Cora left in the window (no interview); Dan answers while still on notice; two old rows from earlier exits.
  await users().updateOne({ userId: 'cora' }, { $set: { 'exit.lastWorkingDay': addDays(T, -1) } });
  await users().updateOne({ userId: 'dan' }, { $set: { 'exit.interview': { filledAt: now, filledBy: 'employee' } } });
  for (let i = 0; i < 3; i += 1) await surveyResponses().insertOne({ id: randomUUID(), org: ORG, kind: 'exit', department: 'Design', month: T.slice(0, 7), answers: { reason: 'growth' }, createdAt: now });
  const ins = await exitInsights('hr', { from: addDays(T, -30), to: T }, now);
  ok('the share is over the people offered an interview (Dan, answered on notice), never above 100%', ins.answered.offered === 1 && ins.answered.percent === 100, ins.answered);
  ok('every group shows answers out of people offered', ins.groups.every((g) => typeof g.offered === 'number'), ins.groups);

  console.log('the reveal and its letter');
  const jj = await createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Joy Joiner', personalEmail: 'joy@example.com' }, tj: addDays(T, -200), managerUserId: 'mgr' });
  await onJoined(jj.id, 'joy');
  await journeys().updateOne({ id: jj.id }, { $set: { 'probation.decision': { outcome: 'confirm', decidedAt: new Date(now.getTime() - 3_600_000), decidedByUserId: 'hr' } } });
  const letterTask = await journeyTasks().findOne({ journeyId: jj.id, systemKey: 'confirmation_letter' });
  if (letterTask) await journeyTasks().updateOne({ id: letterTask.id }, { $set: { status: 'todo' } });
  const tick = await refusal(() => actOnTaskByHr(ORG, jj.id, letterTask!.id, { action: 'done', note: 'Emailed' }, HR));
  ok('the letter task cannot be ticked by hand with no letter sent', tick.status === 409 && /Send the letter from Documents/.test(tick.message), tick);
  await letters().insertOne({ id: 'L-joy', org: ORG, journeyId: jj.id, userId: 'joy', kind: 'confirmation', templateId: 't', refNo: 'CL-1', values: {}, createdAt: now, email: { to: 'joy@example.com', subject: 'Confirmed', body: 'x', sentAt: now } } as never);
  await actOnTaskByHr(ORG, jj.id, letterTask!.id, { action: 'done' }, HR);
  const reveal = await revealFor(jj.id) as { ready: boolean; letterId?: string };
  ok('with the letter sent, the tick links it and the reveal has Read your letter', reveal.ready && reveal.letterId === 'L-joy', reveal);

  console.log('the Day-1 pass names the current manager');
  const pj = await createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Pia Prejoin', personalEmail: 'pia@example.com' }, tj: addDays(T, 3), managerUserId: 'lead' });
  await journeys().updateOne({ id: pj.id }, { $set: { status: 'active', day1Pass: { reportingTime: '09:30', agenda: [{ time: '11:00', title: 'Meet your manager', with: 'Lata L.' }, { time: '12:00', title: 'Induction', with: 'HR team' }] } } });
  const pass1 = await portalPass((await journeys().findOne({ id: pj.id }))!, now);
  ok('the manager meeting names the journey\'s manager', pass1.agenda?.[0].with === 'Lata Lead' && pass1.agenda?.[1].with === 'HR team', pass1.agenda);

  console.log('a leaving manager\'s joiners');
  await lifecycleMeetings().insertOne({ id: 'm-pia', org: ORG, journeyId: pj.id, title: 'Meet your manager', startsAt: new Date(`${addDays(T, 3)}T11:00:00+05:30`), attendeeUserIds: ['lead'] } as never);
  await peopleToMeet().insertOne({ id: 'p-pia', org: ORG, journeyId: pj.id, personUserId: 'lead', why: 'Your manager' });
  const noSuccessor = await refusal(() => recordExit('hr', 'lead', { kind: 'resigned', lastWorkingDay: addDays(T, 20) }, now));
  ok('a manager with someone joining under them needs a successor', noSuccessor.status === 409 && /joining under Lata Lead/.test(noSuccessor.message), noSuccessor);
  await recordExit('hr', 'lead', { kind: 'resigned', lastWorkingDay: addDays(T, 20), newManagerUserId: 'mgr2', moveTeamNow: true }, now);
  const moved = await journeys().findOne({ id: pj.id });
  const meeting = await lifecycleMeetings().findOne({ id: 'm-pia' });
  ok('the joiner moves to the successor: journey, meeting, people to meet', moved?.managerUserId === 'mgr2' && !!meeting?.attendeeUserIds.includes('mgr2') && !meeting.attendeeUserIds.includes('lead') && (await peopleToMeet().findOne({ id: 'p-pia' }))?.personUserId === 'mgr2', { m: moved?.managerUserId, a: meeting?.attendeeUserIds });
  const pass2 = await portalPass(moved!, now);
  ok('…and the Day-1 pass names the new manager', pass2.agenda?.[0].with === 'Mohan Next', pass2.agenda);

  console.log('the settlement: Not set up, and sent twice');
  const danUser = (await users().findOne({ userId: 'dan' }))!;
  const noStructure = await computeSettlement({ ...danUser, exit: { ...danUser.exit!, lastWorkingDay: T } });
  ok('no salary structure: Not set up and no ₹0 lines', noStructure.lines.length === 0 && /No salary structure/.test(noStructure.notSetUp ?? ''), noStructure);
  await exitSettlements().insertOne({ org: ORG, userId: 'dan', status: 'approved', lines: [{ key: 'gratuity', side: 'earning', label: 'Gratuity', computedPaise: 100, amountPaise: 100 }], earningsPaise: 100, deductionsPaise: 0, payablePaise: 100, createdAt: now, updatedAt: now, approvedAt: now } as never);
  const goodPdf = Buffer.from('%PDF-1.4\n'.padEnd(400, '0')).toString('base64');
  const body = { pdfBase64: goodPdf, to: 'dan@example.com', overrideReason: 'Check run' };
  await emailSettlement('hr', 'dan', body, now);
  const again = await refusal(() => emailSettlement('hr', 'dan', body, new Date(now.getTime() + 3000)));
  ok('a second send a moment later asks to confirm (409)', again.status === 409 && /already emailed/.test(again.message), again);
  await emailSettlement('hr', 'dan', { ...body, resend: true }, new Date(now.getTime() + 4000));
  ok('…and goes with resend: true', true);
  const at11 = new Date(now.getTime() + 11 * 60_000);
  await emailSettlement('hr', 'dan', body, at11);
  ok('after ten minutes it goes without asking', true);
  const race = await Promise.allSettled([emailSettlement('hr', 'dan', { ...body, resend: true }, new Date(at11.getTime() + 1)), emailSettlement('hr', 'dan', { ...body, resend: true }, new Date(at11.getTime() + 2))]);
  ok('two sends at the same moment: one goes', race.filter((r) => r.status === 'fulfilled').length === 1, race.map((r) => r.status));
  ok('the sending mark is cleared after', !(await users().findOne({ userId: 'dan' }))?.exit?.offboarding?.settlementSendingAt);
  void salaryStructures;

  console.log('the Day-7 survey closes at its deadline');
  // Sue joined 10 days ago: her Day-7 survey was due 3 days ago; no later survey is open yet.
  await users().insertOne(person('sue', { name: 'Sue Survey', employeeId: 'TF-7', department: 'Design', joiningDate: new Date(`${addDays(T, -10)}T00:00:00Z`) }));
  const sj = await createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Sue Survey', personalEmail: 'sue@example.com' }, tj: addDays(T, -10), managerUserId: 'mgr' });
  await onJoined(sj.id, 'sue');
  const SUE = { userId: 'sue', name: 'Sue Survey', org: ORG };
  const sv = await surveyView(SUE, now) as { open: boolean; kind: string };
  ok('past its due day the Day-7 survey is not open', !sv.open, sv);
  const late = await refusal(() => sendSurvey(SUE, { answers: { q1: 4, q2: 'yes', q3: 4, q4: '' } }, now));
  ok('a late answer is refused (409)', late.status === 409, late);
  await runLifecycleJobs(new Date(`${T}T10:00:00+05:30`), { orgs: [ORG] });
  ok('the day job closes the unanswered survey (skipped)', (await journeyTasks().findOne({ journeyId: sj.id, systemKey: 'day7_survey' }))?.status === 'skipped');
  // On its due day it is still open, and an answer is taken.
  await users().insertOne(person('ona', { name: 'Ona Time', employeeId: 'TF-8', department: 'Design', joiningDate: new Date(`${addDays(T, -7)}T00:00:00Z`) }));
  const oj = await createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Ona Time', personalEmail: 'ona@example.com' }, tj: addDays(T, -7), managerUserId: 'mgr' });
  await onJoined(oj.id, 'ona');
  const ONA = { userId: 'ona', name: 'Ona Time', org: ORG };
  ok('on its due day the survey is open', (await surveyView(ONA, now) as { open: boolean }).open);
  ok('…and an answer is taken', (await sendSurvey(ONA, { answers: { q1: 4, q2: 'yes', q3: 4, q4: '' } }, now)).sent === true);

  console.log('Day-1 agenda lines and their meetings');
  await updateJourneyByHr(ORG, jj.id, { day1Pass: { agenda: [{ time: '10:00', title: 'Meet your manager' }, { time: '16:00', title: 'Late call with the LA team', taskKey: null }, { time: '12:00', title: 'Team lunch' }] } });
  const pass = (await journeys().findOne({ id: jj.id }))!.day1Pass!;
  ok('each line gets an id; the old words still pick the manager meeting once', pass.agenda!.every((a) => !!a.id) && pass.agenda![0].taskKey === 'meet_manager' && pass.agenda![1].taskKey === null && pass.agenda![2].taskKey === 'meet_team', pass.agenda);
  const ms1 = await lifecycleMeetings().find({ journeyId: jj.id }).toArray();
  const lateCall = ms1.find((m) => m.title === 'Late call with the LA team');
  ok('a line with "team" in it is not the team intro unless HR says so', !!lateCall && !lateCall.journeyTaskId && !lateCall.attendeeUserIds.includes('mgr'), lateCall);
  ok('one meeting per line, by the line\'s id', ms1.length === 3 && ms1.every((m) => !!m.agendaId), ms1.map((m) => [m.title, m.agendaId]));
  const keepIds = pass.agenda!.filter((a) => a.title !== 'Team lunch');
  await updateJourneyByHr(ORG, jj.id, { day1Pass: { agenda: keepIds.map((a) => (a.title === 'Late call with the LA team' ? { ...a, title: 'Late call (LA)' } : a)) } });
  const ms2 = await lifecycleMeetings().find({ journeyId: jj.id }).toArray();
  ok('a renamed line keeps its meeting; a removed line removes its meeting', ms2.length === 2 && ms2.some((m) => m.title === 'Late call (LA)' && m.id === lateCall!.id) && !ms2.some((m) => m.title === 'Team lunch'), ms2.map((m) => m.title));

  console.log('a manager change moves the meetings');
  await updateJourneyByHr(ORG, jj.id, { managerUserId: 'mgr2' });
  const ms3 = await lifecycleMeetings().find({ journeyId: jj.id }).toArray();
  const mgrMeeting = ms3.find((m) => m.title === 'Meet your manager');
  ok('the manager meeting now has the new manager, by name too', !!mgrMeeting && mgrMeeting.attendeeUserIds.includes('mgr2') && !mgrMeeting.attendeeUserIds.includes('mgr') && mgrMeeting.with === 'Mohan Next', mgrMeeting);

  console.log('Week 1 done: one rule for the board and the app');
  const wj = await createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Wes Week', personalEmail: 'wes@example.com' }, tj: addDays(T, -6), managerUserId: 'mgr' });
  await onJoined(wj.id, 'wes');
  await journeyTasks().updateMany({ journeyId: wj.id, systemKey: { $in: ['week1_reels', 'intro_post', 'day7_survey'] } }, { $set: { status: 'done', doneAt: now } });
  const wjDoc = (await journeys().findOne({ id: wj.id }))!;
  const d6 = deriveJourney(wjDoc, await tasksOf(wj.id), now);
  ok('day 6 with every week-1 task done: not Week done yet, All set', d6.column === 'day7_survey' && d6.flags.includes('all_set') && !isWeek1Done(wjDoc.tj, T), { col: d6.column, flags: d6.flags });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const d7 = deriveJourney(wjDoc, await tasksOf(wj.id), tomorrow);
  ok('day 7: Week done on the board, the same day the app shows it', d7.tab === 'first_week' && d7.column === 'week_done' && isWeek1Done(wjDoc.tj, addDays(T, 1)), { tab: d7.tab, col: d7.column });

  console.log('joining-date rules on an offer');
  const HRA = { userId: 'hr', name: 'Hema HR', org: ORG, seesPay: true };
  const past = await refusal(() => createOffer(HRA, { candidate: { name: 'Past Pat', personalEmail: 'pat@example.com' }, fields: { designation: 'Artist', ctc: 600000, tj: addDays(T, -2) } }));
  ok('a joining date in the past is refused with a reason', past.status === 400 && /after today/.test(past.message), past);
  const early = await refusal(() => createOffer(HRA, { candidate: { name: 'Early Eva', personalEmail: 'eva@example.com' }, fields: { designation: 'Artist', ctc: 600000, tj: addDays(T, 5), validTill: addDays(T, 9) } }));
  ok('a joining date before the valid-till is refused with a reason', early.status === 400 && /before the offer’s valid-till/.test(early.message), early);
  const soon = await createOffer(HRA, { candidate: { name: 'Soon Sam', personalEmail: 'sam@example.com' }, fields: { designation: 'Artist', ctc: 600000, tj: addDays(T, 3) } });
  ok('with no valid-till given it is never past the joining day', soon.offer.fields.validTill <= addDays(T, 3), soon.offer.fields);

  console.log(`\n${failed ? `${failed} check(s) failed` : `all ${passed} tracker-fix checks passed`}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
