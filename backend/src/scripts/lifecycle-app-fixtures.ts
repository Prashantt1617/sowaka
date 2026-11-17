/**
 * The app's lifecycle endpoints, answered for real: a scratch company (features exits +
 * lifecycle), an HR admin, a manager, a joiner walked to joined / week 1 through the engine,
 * a second joiner confirmed at the end of probation (the reveal), and a leaver who resigns,
 * is accepted by the manager and HR, hands over, sends the exit interview and leaves. Every
 * app endpoint (mobile-app/lib/features/lifecycle/{onboarding,offboarding}) is called through
 * the service function its route calls, and the answer is written as the route sends it
 * (`JSON.parse(JSON.stringify(x))`, so Dates are ISO strings as over HTTP; offboarding routes
 * add `success: true`) to mobile-app/test/fixtures/lifecycle/<name>.json. The app's
 * test/lifecycle_server_fixtures_test.dart runs the app's parsers on those files.
 *
 * In-process, no HTTP server, on its own scratch database:
 *   MONGODB_URI=mongodb://127.0.0.1:27133 npm run lifecycle:fixtures
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_fixtures_scratch';

const ORG = 'el-fixtures';
const OFF_ORG = 'el-fixtures-off';
const OUT = path.resolve(__dirname, '../../../mobile-app/test/fixtures/lifecycle');

let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 600)}`}`); }
}

const written: string[] = [];
/** As the route sends it: Dates to ISO strings, undefined dropped. */
const wire = (x: unknown) => JSON.parse(JSON.stringify(x ?? null));
async function save(name: string, body: unknown) {
  await fs.writeFile(path.join(OUT, `${name}.json`), `${JSON.stringify(wire(body), null, 2)}\n`);
  written.push(name);
}
/** The offboarding router's `send`: `{ success: true, ...out }`. */
const sent = (out: unknown) => ({ success: true, ...(out as object) });

async function main() {
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:fixtures runs on a local mongod only');
  if (process.env.MONGODB_DB !== 'el_fixtures_scratch') throw new Error('lifecycle:fixtures needs the el_fixtures_scratch database');

  const db = await import('../config/db');
  const { connectDb, getDb, companies, users, policyDocuments, lifecycleMeetings, notifications, authSessions, lifecycleTemplates } = db;
  const rules = await import('../services/lifecycle/dueRules');
  const engine = await import('../services/lifecycle/engine');
  const board = await import('../services/lifecycle/board');
  const app = await import('../services/lifecycle/appOnboarding');
  const probation = await import('../services/lifecycle/probation');
  const templates = await import('../services/lifecycle/templates');
  const off = await import('../services/lifecycle/offboarding');
  const res = await import('../services/lifecycle/resignations');
  const exits = await import('../services/exit.service');
  const auth = await import('../services/auth.service');
  const { requireAuth } = await import('../middleware/auth.middleware');
  const { errorHandler } = await import('../middleware/error.middleware');

  await connectDb();
  if (getDb().databaseName !== 'el_fixtures_scratch') throw new Error(`refusing to run against ${getDb().databaseName}`);
  await getDb().dropDatabase();
  await connectDb();
  await fs.mkdir(OUT, { recursive: true });
  for (const f of await fs.readdir(OUT)) if (f.endsWith('.json')) await fs.unlink(path.join(OUT, f));

  const now = new Date();
  const TODAY = rules.todayKey(now);
  const day = (offset: number) => rules.addDaysKey(TODAY, offset);

  await companies().insertMany([
    { id: ORG, name: 'Fixture Works Pvt Ltd', features: { exits: true, lifecycle: true }, exitNoticeDays: 30, profile: { displayName: 'Fixture Works', replyToEmail: 'people@fixture.test' } },
    { id: OFF_ORG, name: 'No Lifecycle Co', features: { exits: true } },
  ] as never[]);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@fixture.test`, org: ORG, lifecycleStatus: 'active', role: 'employee',
    joiningDate: new Date('2023-04-03T00:00:00Z'), ...extra,
  });
  await users().insertMany([
    person('hr', 'Hema Rao', { dashboardAccess: true, dashboardAdmin: true }),
    person('mgr', 'Meera Iyer', { role: 'manager', designation: 'Design Lead', department: 'Design', managerUserId: 'hr' }),
    person('p1', 'Kiran Shah', { designation: 'Designer', department: 'Design', managerUserId: 'mgr' }),
    person('p2', 'Tara Bose', { designation: 'Researcher', department: 'Design', managerUserId: 'mgr' }),
    person('ravi', 'Ravi Menon', { designation: 'Senior Designer', department: 'Design', managerUserId: 'mgr', employeeId: 'FX-7' }),
    person('wanda', 'Wanda Pillai', { department: 'Design', managerUserId: 'mgr' }),
    person('olga', 'Olga Dsouza', { org: OFF_ORG, lifecycleStatus: 'offboarded', exit: { kind: 'resigned', lastWorkingDay: day(-10), noticeFrom: day(-40), noticeDays: 30, recordedAt: now } }),
  ] as never[]);
  const me = (userId: string, name: string) => ({ userId, name, org: ORG });
  const HR = me('hr', 'Hema Rao');
  const MGR = me('mgr', 'Meera Iyer');
  const cand = (n: string) => ({ name: n, personalEmail: `${n.toLowerCase().replace(/\s+/g, '.')}@example.com` });
  const byKey = <T extends { systemKey?: string; month?: number }>(tasks: T[], key: string, month?: number): T => tasks.find((t) => t.systemKey === key && (month === undefined || t.month === month))!;

  /** Offer → accepted → finalised → documents → letters → joined, as the dashboard and portal walk it. */
  const joinAt = async (name: string, userId: string, tjOffset: number) => {
    const j = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand(name), tj: day(tjOffset), managerUserId: 'mgr', designation: 'Product Designer', department: 'Design' });
    for (const s of ['offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const) await engine.setJourneyStatus(j.id, s);
    await engine.completeTask(j.id, 'sign_letters');
    await users().insertOne(person(userId, name, { managerUserId: 'mgr', department: 'Design', designation: 'Product Designer', joiningDate: rules.dayDate(day(tjOffset)) }) as never);
    await engine.onJoined(j.id, userId);
    return engine.loadJourney(j.id);
  };

  // ─────────────────────────────────────────────────────────────── the joiner (week 1)
  console.log('the joiner');
  const J = await joinAt('Isha Verma', 'isha', -6);
  const ISHA = me('isha', 'Isha Verma');
  await policyDocuments().insertMany([
    { org: ORG, key: 'leave', title: 'Leave policy', body: 'Take leave.', order: 1, active: true, createdAt: now, updatedAt: new Date('2026-10-01T00:00:00Z') },
    { org: ORG, key: 'conduct', title: 'Code of conduct', body: 'Be kind.', order: 2, active: true, createdAt: now, updatedAt: new Date('2026-09-15T00:00:00Z') },
  ] as never[]);
  const tasks0 = await engine.tasksOf(J.id);
  // The 1:1 with the manager in 20 minutes, tied to its task (Up next carries it).
  await lifecycleMeetings().insertOne({
    id: 'fx-meeting', org: ORG, journeyId: J.id, title: 'Meet your manager', startsAt: new Date(now.getTime() + 20 * 60_000), endsAt: new Date(now.getTime() + 50 * 60_000),
    place: 'Room 4B', attendeeUserIds: ['isha', 'mgr'], journeyTaskId: byKey(tasks0, 'meet_manager').id,
  } as never);

  // The manager sets up first: people to meet, buddy, welcome note, goals.
  await save('manager_setup_put', await app.saveSetup(MGR, J.id, { people: [{ userId: 'p1', why: 'Your buddy for the first month' }, { userId: 'p2' }], buddyUserId: 'p1', welcomeNote: { kind: 'text', text: 'Welcome aboard, Isha!' }, goals: ['Ship the leave redesign', 'Meet every designer'] }));

  await save('me_joiner', await app.lifecycleMe(ISHA));
  await save('onboarding_home', await app.onboardingHome(ISHA));
  await save('onboarding_task_action', await app.actOnOwnTask(ISHA, byKey(tasks0, 'app_tour').id, { action: 'done' }));

  await save('week1_get', await app.week1View(ISHA));
  await save('week1_put_policies', await app.saveWeek1Step(ISHA, { step: 'policies', value: { agreed: true, device: 'Fixture/1.0' } }));
  await save('week1_put_tax', await app.saveWeek1Step(ISHA, { step: 'tax', value: 'new' }));

  await save('intro_get', await app.introView(ISHA));
  await save('intro_put', await app.saveIntro(ISHA, { line: 'Designer who sketches on trains', funFacts: ['Chai over coffee', 'Weekend trekker'] }));
  await save('intro_post', await app.postIntro(ISHA));

  await save('people_get', await app.peopleView(ISHA));
  const people = (await app.peopleView(ISHA)).people;
  await save('people_post', await app.actOnPerson(ISHA, people[0].id, { action: 'met' }));

  const st = await app.assignStarterTask(MGR, J.id, { title: 'Redesign the leave request screen', dueAt: day(2), note: 'Start with the research notes', links: ['https://docs.example/leave'] });
  await save('manager_starter_task_post', st);
  await save('starter_tasks_get', await app.starterTasksForJoiner(ISHA));
  await save('starter_task_done', await app.starterDone(ISHA, st.task.id, { note: 'First version is in the folder' }));
  await save('manager_starter_task_reply', await app.replyToStarterTask(MGR, st.task.id, { text: 'Nice start!' }));

  await app.addNote(MGR, J.id, { text: 'Private thoughts', shared: false });
  await save('manager_note_post', await app.addNote(MGR, J.id, { text: 'Settling in well. Next: the design crit.', shared: true }));
  const notes = await app.notesForJoiner(ISHA);
  await save('notes_get', notes);
  await save('note_action', await app.actOnNote(ISHA, notes.notes[0].id, { action: 'reply', text: 'Thanks, Meera!' }));

  await save('meeting_get', await app.meetingFor(ISHA, 'fx-meeting'));
  await save('home_with_meeting', await app.onboardingHome(ISHA));
  await save('meeting_post_moved', await app.actOnMeeting(ISHA, 'fx-meeting', { met: 'moved', newTime: new Date(now.getTime() + 26 * 3_600_000).toISOString() }));

  await save('survey_get', await app.surveyView(ISHA));
  await save('survey_post', await app.sendSurvey(ISHA, { answers: { q1: 4, q2: 'mostly', q3: 5, q4: 'More coffee' } }));

  await save('probation_get', await app.probationForMe(ISHA));
  await save('reveal_not_ready', await app.revealForMe(ISHA));

  await save('manager_joiners', await app.joinersForManager(MGR));
  await save('manager_joiner', await app.joinerForManager(MGR, J.id));
  // A task the manager ticks on M2 (never HR's decision: hr_manager tasks are refused).
  const managerTask = (await engine.tasksOf(J.id)).find((t) => ['manager', 'manager_employee'].includes(t.ownerRole) && !!t.systemKey
    && !['starter_task', 'one_on_one_notes', 'probation_goals', 'monthly_goals', 'monthly_checkin', 'monthly_review', 'manager_setup', 'assign_buddy'].includes(t.systemKey)
    && (t.status === 'todo' || t.status === 'sent_back'));
  if (managerTask) await save('manager_task_done', await app.managerTaskDone(MGR, J.id, managerTask.id, { action: 'done' }));
  await save('manager_probation_month', await app.managerProbationMonth(MGR, J.id, 1, { goals: ['Ship the leave redesign', 'Run one crit'] }));
  await save('manager_welcome_post', await app.postWelcome(MGR, J.id, { text: 'Please welcome Isha to the design team!' }));
  await save('manager_joiner_after_welcome', await app.joinerForManager(MGR, J.id));

  // The rest of the week-1 reels: the manager's goals are in, so the last reel reads them.
  await app.saveWeek1Step(ISHA, { step: 'bank_pf', value: { confirm: true } });
  await save('week1_done', await app.saveWeek1Step(ISHA, { step: 'goals', value: { read: true } }));
  await save('me_joiner_after_week1', await app.lifecycleMe(ISHA));

  // ─────────────────────────────────────────────────────────────── a joiner past week 1 ("Week 1, done!" from the server)
  console.log('week 1 done');
  await joinAt('Rohan Pillai', 'rohan', -8);
  const ROHAN = me('rohan', 'Rohan Pillai');
  const rohanHome = await app.onboardingHome(ROHAN);
  ok('Rohan: the server says Week 1, done! is due', rohanHome.showWeekDone === true);
  await save('home_week_done', rohanHome);
  await save('week_done_seen', await app.markWeekDoneSeen(ROHAN));
  await save('me_settling_in', await app.lifecycleMe(ROHAN));

  // ─────────────────────────────────────────────────────────────── a second joiner, confirmed (the reveal)
  console.log('the reveal');
  const finalTj = rules.addDaysKey(rules.addMonthsKey(TODAY, -5), -3);
  const J5 = await joinAt('Ishita Kaur', 'ishita', rules.daysBetween(TODAY, finalTj));
  const ISHITA = me('ishita', 'Ishita Kaur');
  // The month-1 check-in and review on the new shape (per-goal ratings, win/ask, chips, next goals).
  await app.managerProbationMonth(MGR, J5.id, 1, { goals: ['Ship the first feature', 'Own the weekly report'] });
  await save('probation_checkin_put', await app.checkinForMe(ISHITA, 1, { rating: 3, goalRatings: [4, 5], win: 'Shipped the onboarding flow', ask: 'Access to analytics' }));
  await app.managerProbationMonth(MGR, J5.id, 1, { checkin: { text: 'Good month', rating: 4, goalRatings: [4, 4] } });
  await save('manager_probation_review', await app.managerProbationMonth(MGR, J5.id, 1, { review: { text: 'Great start', feedback: ['Great start', 'Keep going'], askAck: true, nextGoals: ['Pair with two teams'] } }));
  await save('manager_joiner_probation', await app.joinerForManager(MGR, J5.id));
  await probation.recordDecision(J5.id, HR, { outcome: 'confirm', salary: 1_600_000, designation: 'Senior Product Designer', reportingToUserId: 'mgr' });
  await board.actOnTaskByHr(ORG, J5.id, byKey(await engine.tasksOf(J5.id), 'confirmation_letter').id, { action: 'done' }, HR);
  await save('probation_final_month', await app.probationForMe(ISHITA));
  await save('reveal_ready', await app.revealForMe(ISHITA));
  await save('reveal_seen', await app.revealSeenForMe(ISHITA));

  // ─────────────────────────────────────────────────────────────── the leaver
  console.log('the leaver');
  await templates.ensureDefaultTemplates(ORG);
  await lifecycleTemplates().updateOne({ org: ORG, kind: 'offboarding', isDefault: true }, { $set: { 'settings.noticeDays': 30, 'settings.exitInterviewOpensDays': 5 } });
  await save('me_before_resigning', await app.lifecycleMe(me('ravi', 'Ravi Menon')));
  await save('resignation_get_none', sent(await res.myResignation('ravi', now)));
  const resigned = await res.resign('ravi', { reason: 'Better opportunity', note: 'Thank you for three great years.' }, now);
  await save('resignation_post', sent(resigned));
  await save('resignation_get_with_manager', sent(await res.myResignation('ravi', now)));
  await save('me_with_manager', await app.lifecycleMe(me('ravi', 'Ravi Menon')));
  await save('manager_resignations_with_manager', sent(await res.managerResignations('mgr', now)));
  const lastDay = day(4);
  await save('manager_resignation_action', sent(await res.managerResignationAction('mgr', resigned.resignation.id, { action: 'release_early', date: lastDay, note: 'Fine by me' }, now)));
  await save('resignation_get_with_hr', sent(await res.myResignation('ravi', now)));

  // Withdrawing (another report).
  await res.resign('wanda', { reason: 'Personal' }, now);
  await save('resignation_withdraw', sent(await res.withdrawResignation('wanda', now)));

  const accepted = await res.acceptResignation('hr', resigned.resignation.id, { lastWorkingDay: lastDay }, now);
  ok('HR accepted: the exit and the journey', !!accepted.journeyId && accepted.resignation.status === 'accepted');
  await save('me_on_notice', await app.lifecycleMe(me('ravi', 'Ravi Menon')));
  await save('resignation_get_accepted', sent(await res.myResignation('ravi', now)));
  await save('manager_resignations_accepted', sent(await res.managerResignations('mgr', now)));
  await save('offboarding_get_before_checklist', sent(await off.myOffboarding('ravi', now)));
  await save('manager_leaver_before_checklist', sent(await off.managerLeaver('mgr', 'ravi', now)));
  await save('manager_leaver_handover_put', sent(await off.setHandoverChecklist('mgr', 'ravi', { items: ['Design system file', 'Open projects', 'Vendor list'], note: 'Please share by Friday.' }, now)));
  const page = await off.myOffboarding('ravi', now);
  const [i1, i2] = page.handover;
  await save('handover_upload_link', sent(await off.uploadHandover('ravi', i1.id, { url: 'https://docs.example/design-system' }, now)));
  const pdf = Buffer.from('%PDF-1.4\n% fixture handover\n'.padEnd(200, ' '));
  await save('handover_upload_file', sent(await off.uploadHandover('ravi', i2.id, { file: { name: 'open-projects.pdf', contentType: 'application/pdf', bytes: pdf } }, now)));
  await save('handover_remove', sent(await off.removeHandoverUpload('ravi', i2.id)));
  await off.uploadHandover('ravi', i2.id, { url: 'https://docs.example/projects' }, now);
  await save('offboarding_get', sent(await off.myOffboarding('ravi', now)));
  await save('manager_leaver', sent(await off.managerLeaver('mgr', 'ravi', now)));
  await save('manager_leaver_handover_done', sent(await off.markHandoverDone('mgr', 'ravi', now)));
  // The interview opened at Tl − 5 (the job's push), before the answers go in.
  await off.runOffboardingJobs(now);
  await save('exit_interview_post', sent(await off.sendExitInterview('ravi', { reason: 'growth', workingHere: 4, manager: 5, comeBack: 'maybe', change: 'Clearer growth paths' }, now)));
  await save('offboarding_get_after_interview', sent(await off.myOffboarding('ravi', now)));

  // ─────────────────────────────────────────────────────────────── an exit HR started (no resignation)
  console.log('an exit HR started');
  const tara = await off.startExit('hr', 'p2', { exitType: 'retirement', lastWorkingDay: day(20), noticeHandling: 'served' }, now);
  ok('HR started a retirement: the journey, the page on', !!tara.journeyId);
  await save('me_hr_started', await app.lifecycleMe(me('p2', 'Tara Bose')));
  await save('resignation_get_hr_started', sent(await res.myResignation('p2', now)));
  await save('offboarding_get_hr_started', sent(await off.myOffboarding('p2', now)));
  await save('manager_leavers', sent(await off.managerLeavers('mgr', now)));
  await save('manager_leaver_hr_started', sent(await off.managerLeaver('mgr', 'p2', now)));

  // ─────────────────────────────────────────────────────────────── pushes
  const pushes = await notifications().find({ userId: { $in: ['isha', 'ishita', 'mgr', 'ravi', 'p2'] }, scenario: /^lifecycle_/ }, { projection: { _id: 0, userId: 1, scenario: 1, title: 1, body: 1, data: 1 } }).sort({ createdAt: 1 }).toArray();
  ok('pushes were recorded', pushes.length > 5, pushes.length);
  const leavingPushes = pushes.filter((p) => ['lifecycle_offboarding', 'lifecycle_resignation'].includes(String((p.data as Record<string, unknown> | undefined)?.type)));
  ok('every offboarding push names where the app opens it', leavingPushes.length >= 8 && leavingPushes.every((p) => typeof p.data?.destination === 'string' && String(p.data.destination).startsWith('lifecycle_')), leavingPushes.map((p) => [p.scenario, p.data?.destination]));
  for (const scenario of ['lifecycle_resignation', 'lifecycle_resignation_with_hr', 'lifecycle_resignation_withdrawn', 'lifecycle_offboarding_open', 'lifecycle_handover_checklist', 'lifecycle_handover_shared', 'lifecycle_handover_uploaded', 'lifecycle_exit_interview_open']) {
    ok(`a ${scenario} push went out`, leavingPushes.some((p) => p.scenario === scenario), leavingPushes.map((p) => p.scenario));
  }
  await save('push_payloads', { pushes });

  // ─────────────────────────────────────────────────────────────── the account closes (R6)
  console.log('the account closes');
  await exits.closeDueExits(new Date(`${rules.addDaysKey(lastDay, 1)}T10:00:00+05:30`));
  ok('access ended the day after the last day', (await users().findOne({ userId: 'ravi' }))?.lifecycleStatus === 'offboarded');
  /** The body the error handler sends for a refusal. */
  const refusedBody = async (work: () => Promise<unknown>) => {
    let body: unknown = null;
    let status = 0;
    try { await work(); } catch (error) {
      const out = { status(code: number) { status = code; return out; }, json(b: unknown) { body = b; return out; } };
      errorHandler(error, { requestId: 'fixture', method: 'POST', originalUrl: '/auth/request-otp', headers: {} } as unknown as Request, out as unknown as Response, (() => {}) as NextFunction);
    }
    return { status, body };
  };
  const closed = await refusedBody(() => auth.requestLoginOtp('ravi@fixture.test'));
  ok('request-otp for the ended account: 403 with accountClosed', closed.status === 403 && !!(closed.body as { accountClosed?: unknown }).accountClosed, closed);
  await save('auth_request_otp_closed', closed);
  const verify = await refusedBody(() => auth.verifyLoginOtp('ravi@fixture.test', '123456'));
  ok('verify-otp too', verify.status === 403 && !!(verify.body as { accountClosed?: unknown }).accountClosed, verify);
  const meClosed = await refusedBody(() => auth.getCurrentAuthUser('ravi'));
  ok('/auth/me for the ended account: 401 with accountClosed', meClosed.status === 401 && !!(meClosed.body as { accountClosed?: unknown }).accountClosed, meClosed);
  await save('auth_me_closed', meClosed);
  const unknown = await refusedBody(() => auth.requestLoginOtp('nobody@fixture.test'));
  ok('an unknown email: no accountClosed', unknown.status === 403 && !(unknown.body as { accountClosed?: unknown }).accountClosed, unknown);
  await save('auth_request_otp_unknown', unknown);
  const elsewhere = await refusedBody(() => auth.requestLoginOtp('olga@fixture.test'));
  ok('an ended account where the lifecycle is off: no accountClosed', elsewhere.status === 403 && !(elsewhere.body as { accountClosed?: unknown }).accountClosed, elsewhere);
  await save('auth_request_otp_closed_lifecycle_off', elsewhere);
  // A session that outlived the account (access ended elsewhere): the auth check's own refusal.
  const token = 'fixture-session-token';
  await authSessions().insertOne({ tokenHash: auth.hashSessionToken(token), userId: 'ravi', createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) } as never);
  const mw = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 0;
    const out = { status(code: number) { status = code; return out; }, json(b: unknown) { resolve({ status, body: b }); return out; } };
    void requireAuth({ header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), requestId: 'fixture', method: 'GET', originalUrl: '/auth/me' } as unknown as Request, out as unknown as Response, ((e?: unknown) => (e ? reject(e) : reject(new Error('passed the auth check')))) as NextFunction);
  });
  ok('a live session of an ended account: 401 with accountClosed', mw.status === 401 && !!(mw.body as { accountClosed?: unknown }).accountClosed, mw);
  await save('auth_session_closed', mw);

  console.log(`\n${written.length} fixtures in ${path.relative(process.cwd(), OUT)}${failed ? ` · ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
