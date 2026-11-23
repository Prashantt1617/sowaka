/**
 * The lifecycle engine (BE-journey) against its rules, in-process, on its own
 * scratch database: the seed is complete, due rules (working days and
 * holidays included) resolve, moving Tj moves only open tasks and tells each
 * owner once, statuses, columns, flags, day labels and plant stages follow
 * the journey, Up next orders, the survey summary stays private under three
 * answers, probation decides and extends, jobs fire exactly once, and the
 * switch off refuses everything.
 *
 *   npm run lifecycle:check      (MONGODB_DB=el_journey_check; local mongod only)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
import type { Request, Response } from 'express';
import type { Journey, JourneyTask, Meeting, SystemTaskKey, TemplateTask } from '../models/lifecycle.model';
import type { TaskView } from '../services/lifecycle/engine';

// Never the shared cluster: the URI is set here, before anything reads the environment.
process.env.MONGODB_URI = process.env.LIFECYCLE_CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_journey_check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
function eq(label: string, got: unknown, want: unknown) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
async function refusal(work: () => Promise<unknown>): Promise<{ status?: number; message: string }> {
  try { await work(); return { message: '' }; } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    return { status: e.statusCode, message: e.message ?? String(error) };
  }
}
const section = (title: string) => console.log(`\n${title}`);

const ORG = 'el-journey-check';

async function main() {
  if (!/^(mongodb:\/\/)(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:check runs on a local mongod only');
  if (!/^el_journey/.test(process.env.MONGODB_DB!)) throw new Error('lifecycle:check needs its own el_journey_* database');

  const db = await import('../config/db');
  const { connectDb, getDb, companies, users, holidays, journeys, journeyTasks, notifications, connectPosts, lifecycleMeetings, policyDocuments, surveyResponses, shiftPolicies, offers } = db;
  const rules = await import('../services/lifecycle/dueRules');
  const seed = await import('../services/lifecycle/seed');
  const templates = await import('../services/lifecycle/templates');
  const engine = await import('../services/lifecycle/engine');
  const board = await import('../services/lifecycle/board');
  const app = await import('../services/lifecycle/appOnboarding');
  const probation = await import('../services/lifecycle/probation');
  const jobs = await import('../services/lifecycle/jobs');
  const routes = await import('../routes/lifecycle-admin.routes');
  const tabs = await import('../models/dashboard-tabs');

  await connectDb();
  await getDb().dropDatabase();

  const now = new Date();
  const TODAY = rules.todayKey(now);
  const day = (offset: number) => rules.addDaysKey(TODAY, offset);
  const at = (key: string, time = '10:00') => new Date(`${key}T${time}:00+05:30`);

  await companies().insertOne({ id: ORG, name: 'Check Co', features: { lifecycle: true } } as never);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@check.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', ...extra,
  });
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true }),
    person('mgr', 'Neha Rao', { role: 'manager', designation: 'Design lead' }),
    person('mgr2', 'Other Manager', { role: 'manager' }),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => person(id, `Colleague ${i + 1}`, { managerUserId: 'mgr' })),
  ] as never[]);
  const me = (userId: string, name: string) => ({ userId, name, org: ORG });
  const HR = me('hr', 'Hema HR');
  const MGR = me('mgr', 'Neha Rao');

  const tellCount = async (userId: string, scenario: string) => notifications().countDocuments({ userId, scenario });

  // ───────────────────────────────────────────────────────── seed
  section('Seed (6Zs §2.1 / §2.2): every row, recommended ones off');
  const category = (t: TemplateTask) => (t.systemKey === 'starter_task' ? 'manager_to_employee' : t.ownerRole);
  const countBy = (tasks: readonly TemplateTask[], phase: string) => {
    const out: Record<string, number> = {};
    for (const t of tasks) if (t.phase === phase && !t.recommended) out[category(t)] = (out[category(t)] ?? 0) + 1;
    return out;
  };
  const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  // The team side's rows (Teams › Joiners) are checked in lifecycle:team-check.
  const OB = seed.ONBOARDING_SEED.filter((t) => !t.team);
  const OFF = seed.OFFBOARDING_SEED;
  eq('Pre-boarding: Employee 7 · HR 5 · Automatic 1 · Manager 1', sorted(countBy(OB, 'pre_boarding')), sorted({ employee: 7, hr: 5, automatic: 1, manager: 1 }));
  eq('First week: Employee 6 · Manager 3 · HR 2 · Manager + Employee 1 · IT 1 · Manager → Employee 1 · Automatic 1', sorted(countBy(OB, 'first_week')),
    sorted({ employee: 6, manager: 3, hr: 2, manager_employee: 1, it: 1, manager_to_employee: 1, automatic: 1 }));
  eq('Probation: Manager 2 · Manager + Employee 1 · Employee 1 · HR + Manager 1 · HR 1 · Automatic 1', sorted(countBy(OB, 'probation')),
    sorted({ manager: 2, manager_employee: 1, employee: 1, hr_manager: 1, hr: 1, automatic: 1 }));
  eq('Onboarding recommended: buddy, check logins, 30-day note', OB.filter((t) => t.recommended).map((t) => t.systemKey), ['assign_buddy', 'check_logins', 'manager_30day_note']);
  eq('Resignation: HR 2 · Employee 1 · Manager 1', sorted(countBy(OFF, 'resignation')), sorted({ hr: 2, employee: 1, manager: 1 }));
  eq('When accepted: Automatic 2 · Manager 1', sorted(countBy(OFF, 'when_accepted')), sorted({ automatic: 2, manager: 1 }));
  eq('Notice period: Employee 3 · Finance 1 · IT 1 · Automatic 1', sorted(countBy(OFF, 'notice_period')), sorted({ employee: 3, finance: 1, it: 1, automatic: 1 }));
  eq('Last day: Manager 1 · Automatic 1', sorted(countBy(OFF, 'last_day')), sorted({ manager: 1, automatic: 1 }));
  eq('After exit: HR 3 · Finance 1', sorted(countBy(OFF, 'after_exit')), sorted({ hr: 3, finance: 1 }));
  eq('Offboarding recommended: KT, thank-you, stay in touch, delete face data', OFF.filter((t) => t.recommended).map((t) => t.systemKey), ['kt_session', 'thank_you_note', 'stay_in_touch', 'delete_face_data']);
  eq('Rows: 39 onboarding (15 + 16 + 8), 23 offboarding (4 + 3 + 7 + 3 + 6)', [OB.length, OFF.length], [39, 23]);
  ok('Recommended rows are off and not added', [...OB, ...OFF].filter((t) => t.recommended).every((t) => !t.enabled && t.recommended!.added === false));
  ok('Every other row is on', [...OB, ...OFF].filter((t) => !t.recommended).every((t) => t.enabled));
  ok('System keys are unique', new Set([...OB, ...OFF].map((t) => t.systemKey)).size === OB.length + OFF.length);
  const rule = (list: readonly TemplateTask[], key: SystemTaskKey, which: 'opensRule' | 'dueRule') => rules.describeRule(list.find((t) => t.systemKey === key)?.[which]);
  eq('Decision 4: intro post Tj + 3, week-1 Tj + 5, survey opens Tj + 6 due Tj + 7, goals Tj + 7',
    [rule(OB, 'intro_post', 'dueRule'), rule(OB, 'week1_reels', 'dueRule'), rule(OB, 'day7_survey', 'opensRule'), rule(OB, 'day7_survey', 'dueRule'), rule(OB, 'probation_goals', 'dueRule')],
    ['Tj + 3', 'Tj + 5', 'Tj + 6', 'Tj + 7', 'Tj + 7']);
  eq('Decision 4: documents Tj − 5, letters Tj − 2, Day-1 pass opens Tj − 7',
    [rule(OB, 'upload_documents', 'dueRule'), rule(OB, 'sign_letters', 'dueRule'), rule(OB, 'day1_pass', 'opensRule')], ['Tj − 5', 'Tj − 2', 'Tj − 7']);
  eq('Decision 4: handover Tl − 7, exit interview opens Tl − 5, finance Tl − 2, settlement Tl + 2 working days, gratuity Tl + 30',
    [rule(OFF, 'upload_handover', 'dueRule'), rule(OFF, 'exit_interview', 'opensRule'), rule(OFF, 'finance_clearance', 'dueRule'), rule(OFF, 'final_settlement', 'dueRule'), rule(OFF, 'gratuity', 'dueRule')],
    ['Tl − 7', 'Tl − 5', 'Tl − 2', 'Tl + 2 working days', 'Tl + 30']);

  // ───────────────────────────────────────────────────────── due rules
  section('Due rules: days, months, working days, holidays');
  eq('31 Jan + 1 month = 28 Feb; 31 Jan 2028 + 1 = 29 Feb', [rules.addMonthsKey('2027-01-31', 1), rules.addMonthsKey('2028-01-31', 1)], ['2027-02-28', '2028-02-29']);
  eq('Tj 1 Dec: month 1 ends 31 Dec, month 6 is 1–31 May', [rules.probationMonthEnd('2026-12-01', 1), rules.probationMonthStart('2026-12-01', 6), rules.probationMonthEnd('2026-12-01', 6)], ['2026-12-31', '2027-05-01', '2027-05-31']);
  eq('Tj 15 Dec: month 1 ends 14 Jan', rules.probationMonthEnd('2026-12-15', 1), '2027-01-14');
  eq('Probation month on a day', [rules.probationMonthOn('2026-12-01', '2026-11-30', 6), rules.probationMonthOn('2026-12-01', '2026-12-31', 6), rules.probationMonthOn('2026-12-01', '2027-01-01', 6), rules.probationMonthOn('2026-12-01', '2027-09-01', 6)], [0, 1, 2, 6]);
  eq('Month rules: each / last / [3, 6] on a 3-month probation', [rules.monthsOfRule({ anchor: 'month_end', month: 'each' }, 3), rules.monthsOfRule({ anchor: 'month_start', month: 'last' }, 3), rules.monthsOfRule({ anchor: 'month_start', month: [3, 6] }, 3)], [[1, 2, 3], [3], [3]]);

  let cal = await rules.workCalendar(ORG);
  ok('No shift set: Saturday and Sunday are off', !rules.isWorkingDay('2026-12-05', cal) && !rules.isWorkingDay('2026-12-06', cal) && rules.isWorkingDay('2026-12-04', cal));
  eq('Fri 4 Dec + 1 working day = Mon 7 Dec; Mon 7 Dec − 1 = Fri 4 Dec; + 0 = itself',
    [rules.addWorkingDaysKey('2026-12-04', 1, cal), rules.addWorkingDaysKey('2026-12-07', -1, cal), rules.addWorkingDaysKey('2026-12-05', 0, cal)], ['2026-12-07', '2026-12-04', '2026-12-05']);
  await holidays().insertMany([
    { org: ORG, state: '*', type: 'Public', date: new Date('2026-12-07T00:00:00Z'), name: 'Check Day' },
    { org: ORG, state: '*', type: 'Restricted', date: new Date('2026-12-08T00:00:00Z'), name: 'Optional Day' },
    { org: ORG, state: 'pune', type: 'Public', date: new Date('2026-12-09T00:00:00Z'), name: 'Pune Day' },
  ] as never[]);
  cal = await rules.workCalendar(ORG);
  eq('A public holiday on Mon 7 Dec: Fri 4 Dec + 1 working day = Tue 8 Dec (a restricted day still works)', rules.addWorkingDaysKey('2026-12-04', 1, cal), '2026-12-08');
  eq('Another office’s holiday is a working day here', rules.addWorkingDaysKey('2026-12-08', 1, cal), '2026-12-09');
  const pune = await rules.workCalendar(ORG, { location: 'Pune' });
  eq('…and a day off for that office', rules.addWorkingDaysKey('2026-12-08', 1, pune), '2026-12-10');
  eq('addWorkingDays(org, date, n)', rules.keyOfDay(await rules.addWorkingDays(ORG, '2026-12-04', 2)), '2026-12-09');
  await shiftPolicies().insertOne({ org: ORG, weeklyOff: { '1': [6], '2': [6], '3': [6], '4': [6], '5': [6] } } as never);
  cal = await rules.workCalendar(ORG);
  ok('The company’s saved week-offs (Sunday only) replace the fallback: Saturday works', rules.isWorkingDay('2026-12-05', cal) && !rules.isWorkingDay('2026-12-06', cal));
  await shiftPolicies().deleteMany({ org: ORG });
  cal = await rules.workCalendar(ORG);
  const anchors = { tj: '2026-12-01', tl: '2027-01-29', accepted: new Date('2026-11-20T20:00:00Z') };
  const r = (x: Parameters<typeof rules.resolveRuleWith>[0], ctx: Partial<Parameters<typeof rules.resolveRuleWith>[2]> = {}) => {
    const d = rules.resolveRuleWith(x, anchors, { org: ORG, calendar: cal, probationMonths: 6, ...ctx });
    return d ? rules.keyOfDay(d) : null;
  };
  eq('Tj − 5, Tl + 2 working days, end of month 2, last month start, an event in IST',
    [r({ anchor: 'tj', offset: -5 }), r({ anchor: 'tl', offset: 2, unit: 'working_days' }), r({ anchor: 'month_end', month: 'each' }, { month: 2 }), r({ anchor: 'month_start', month: 'last' }), r({ anchor: 'accepted', offset: 1, unit: 'working_days' })],
    ['2026-11-26', '2027-02-02', '2027-01-31', '2027-05-01', '2026-11-23']);
  eq('A rule on an anchor not set yet has no date', r({ anchor: 'finalised' }), null);

  // ───────────────────────────────────────────────────────── templates
  section('Templates: one default per kind, snapshots');
  await templates.ensureDefaultTemplates(ORG);
  await templates.ensureDefaultTemplates(ORG);
  const list = await templates.listTemplates(ORG);
  eq('Standard onboarding + offboarding, each the default', list.map((t) => [t.kind, t.name, t.isDefault]), [['onboarding', 'Standard', true], ['offboarding', 'Standard', true]]);
  eq('Recommended not added: 3 onboarding, 4 offboarding', list.map((t) => t.recommendedNotAdded), [3, 4]);
  const faculty = await templates.createTemplate(ORG, { kind: 'onboarding', name: 'Faculty', copyFromId: list[0].id }, 'Hema HR');
  ok('A copy starts with the copied tasks', faculty.tasks.length === list[0].tasks.length && !faculty.isDefault);
  eq('The default cannot be deleted', (await refusal(async () => templates.deleteTemplate(ORG, list[0].id))).status, 409);
  const off = await templates.updateTemplate(ORG, list[1].id, { settings: { exitInterviewOpensDays: 7, settlementWorkingDays: 3 } });
  eq('Offboarding settings set the task rules (exit interview Tl − 7, settlement Tl + 3 working days)',
    [rules.describeRule(off.tasks.find((t) => t.systemKey === 'exit_interview')!.opensRule), rules.describeRule(off.tasks.find((t) => t.systemKey === 'final_settlement')!.dueRule)], ['Tl − 7', 'Tl + 3 working days']);
  eq('Settings are validated', (await refusal(async () => templates.updateTemplate(ORG, list[0].id, { settings: { probationMonths: 4 } }))).status, 400);

  // ───────────────────────────────────────────────────────── pre-boarding journey
  section('Pre-boarding: statuses, columns, flags');
  const cand = (n: string) => ({ name: n, personalEmail: `${n.toLowerCase().replace(/\s+/g, '.')}@example.com` });
  const J1 = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand('Kabir Mehta'), tj: day(20), managerUserId: 'mgr', designation: 'Product Designer', department: 'Design' });
  let t1 = await engine.tasksOf(J1.id);
  const byKey = (tasks: JourneyTask[], key: SystemTaskKey, month?: number) => tasks.find((t) => t.systemKey === key && (month === undefined || t.month === month))!;
  eq('Draft; 52 tasks (14 + 15 + 23 probation: goals, check-ins, reviews × 6, pulse × 2, discussion, letter, reveal)', [J1.status, t1.length], ['draft', 52]);
  eq('Recommended tasks not materialised', t1.filter((t) => ['assign_buddy', 'check_logins', 'manager_30day_note'].includes(t.systemKey!)).length, 0);
  eq('Send the offer is open; accepting waits for the offer', [byKey(t1, 'send_offer').status, byKey(t1, 'accept_offer').status], ['todo', 'locked']);
  eq('Rules resolve from Tj at creation (documents Tj − 5)', rules.keyOfDay(byKey(t1, 'upload_documents').dueAt!), day(15));
  eq('Manager tasks are owned by the manager', byKey(t1, 'manager_setup').ownerUserId, 'mgr');
  // Editing the template now never touches this journey.
  const std = await templates.getTemplate(ORG, list[0].id);
  await templates.updateTemplate(ORG, std.id, { tasks: std.tasks.map((t) => (t.systemKey === 'intro_post' ? { ...t, title: 'Renamed', dueRule: { anchor: 'tj', offset: 2 } } : t)) });
  const snap = (await engine.loadJourney(J1.id)).templateSnapshot.tasks.find((t) => t.systemKey === 'intro_post')!;
  ok('Template edits leave a running journey’s snapshot alone', snap.title === 'Intro post' && rules.describeRule(snap.dueRule) === 'Tj + 3');
  await templates.updateTemplate(ORG, std.id, { tasks: std.tasks });

  let j1 = await engine.setJourneyStatus(J1.id, 'offer_sent');
  t1 = await engine.tasksOf(J1.id);
  eq('Offer sent: send done, accept open, anchor stamped, column Offer sent', [byKey(t1, 'send_offer').status, byKey(t1, 'accept_offer').status, !!j1.anchors.offer_sent, j1.boardColumn], ['done', 'todo', true, 'offer_sent']);
  await offers().insertOne({ id: 'offer-1', org: ORG, journeyId: J1.id, versions: [{ version: 1, status: 'sent', fields: { validTill: day(3), probationMonths: 6 } }] } as never);
  j1 = await engine.refreshJourney(J1.id);
  ok('Expires in 3 days: flag and the accept due date from the offer', j1.flags!.includes('expires_soon') && rules.keyOfDay(byKey(await engine.tasksOf(J1.id), 'accept_offer').dueAt!) === day(3));
  j1 = await engine.setJourneyStatus(J1.id, 'accepted');
  t1 = await engine.tasksOf(J1.id);
  ok('Accepted: finalise opens, due 1 working day after acceptance; column Accepted; Needs you',
    byKey(t1, 'finalise_offer').status === 'todo' && byKey(t1, 'finalise_offer').dueAt && j1.boardColumn === 'accepted' && j1.flags!.includes('needs_you'));
  j1 = await engine.setJourneyStatus(J1.id, 'finalised');
  t1 = await engine.tasksOf(J1.id);
  eq('Finalised: sign-in, manager set-up, device request open', [byKey(t1, 'portal_sign_in').status, byKey(t1, 'manager_setup').status, byKey(t1, 'device_request').status, byKey(t1, 'upload_documents').status], ['todo', 'todo', 'todo', 'locked']);
  j1 = await engine.setJourneyStatus(J1.id, 'active');
  t1 = await engine.tasksOf(J1.id);
  eq('First sign-in: documents, about you, meet us open; column Documents', [byKey(t1, 'upload_documents').status, byKey(t1, 'about_you').status, byKey(t1, 'meet_us').status, j1.boardColumn], ['todo', 'todo', 'todo', 'documents']);
  eq('Review waits for an upload', byKey(t1, 'review_documents').status, 'locked');
  await engine.setTaskInReview(J1.id, 'upload_documents');
  eq('Uploaded: review opens for HR', byKey(await engine.tasksOf(J1.id), 'review_documents').status, 'todo');
  await engine.reopenTask(J1.id, 'upload_documents', 'ID proof is blurred', true);
  eq('Sent back with a note', [byKey(await engine.tasksOf(J1.id), 'upload_documents').status, byKey(await engine.tasksOf(J1.id), 'upload_documents').note], ['sent_back', 'ID proof is blurred']);
  await engine.completeTask(J1.id, 'upload_documents', { name: 'Kabir Mehta' });
  await engine.completeTask(J1.id, 'review_documents', { userId: 'hr', name: 'Hema HR' });
  t1 = await engine.tasksOf(J1.id);
  j1 = await engine.loadJourney(J1.id);
  eq('Last approval opens the letters; column Letters to sign', [byKey(t1, 'sign_letters').status, j1.boardColumn], ['todo', 'letters']);
  const again = await engine.completeTask(J1.id, 'review_documents');
  ok('completeTask again is a no-op that returns the task', again?.status === 'done' && again.doneByName === 'Hema HR');
  await engine.completeTask(J1.id, 'sign_letters');
  eq('Signed: Ready to join', (await engine.loadJourney(J1.id)).boardColumn, 'ready_to_join');

  section('Moving Tj moves only open tasks and tells each owner once');
  t1 = await engine.tasksOf(J1.id);
  const before = new Map(t1.map((t) => [t.id, t.dueAt ? rules.keyOfDay(t.dueAt) : null]));
  const mgrBefore = await tellCount('mgr', 'lifecycle_due_changed');
  await engine.moveTj(J1.id, day(27));
  const moved = await engine.tasksOf(J1.id);
  const shifted = (t: JourneyTask) => before.get(t.id) && t.dueAt && rules.daysBetween(before.get(t.id)!, rules.keyOfDay(t.dueAt));
  ok('Open Tj tasks moved 7 days (meet us, mark joined, set-up, survey)', ['meet_us', 'mark_joined', 'manager_setup', 'day7_survey'].every((k) => shifted(byKey(moved, k as SystemTaskKey)) === 7));
  ok('Done tasks did not move (documents, letters)', ['upload_documents', 'sign_letters'].every((k) => !shifted(byKey(moved, k as SystemTaskKey))));
  ok('Working-day rules moved by working days (finalise stays on its accepted anchor)', !shifted(byKey(moved, 'finalise_offer')));
  eq('The manager was told once, for all their moved tasks', (await tellCount('mgr', 'lifecycle_due_changed')) - mgrBefore, 1);
  await engine.moveTj(J1.id, day(27));
  eq('Same day again: nobody told', (await tellCount('mgr', 'lifecycle_due_changed')) - mgrBefore, 1);
  await engine.moveTj(J1.id, day(20));
  eq('Moved back: told once more', (await tellCount('mgr', 'lifecycle_due_changed')) - mgrBefore, 2);

  section('Reopening');
  const Jr = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand('Neha Tandon'), tj: day(25), managerUserId: 'mgr' });
  for (const s of ['offer_sent', 'accepted', 'finalised', 'active'] as const) await engine.setJourneyStatus(Jr.id, s);
  eq('Letters wait for the document review', byKey(await engine.tasksOf(Jr.id), 'sign_letters').status, 'locked');
  await engine.reopenTask(Jr.id, 'sign_letters');
  await engine.refreshJourney(Jr.id);
  eq('reopenTask opens a locked task (BE-offer: last document approved) and it stays open', byKey(await engine.tasksOf(Jr.id), 'sign_letters').status, 'todo');
  await engine.completeTask(Jr.id, 'about_you');
  await engine.moveTj(Jr.id, day(32));
  eq('A done task did not move with Tj', rules.keyOfDay(byKey(await engine.tasksOf(Jr.id), 'about_you').dueAt!), day(22));
  await engine.reopenTask(Jr.id, 'about_you', 'Phone number missing');
  eq('Reopened, it takes the date from the moved Tj', [byKey(await engine.tasksOf(Jr.id), 'about_you').status, rules.keyOfDay(byKey(await engine.tasksOf(Jr.id), 'about_you').dueAt!)], ['todo', day(29)]);
  await engine.setJourneyStatus(Jr.id, 'offer_sent');
  const resent = await engine.tasksOf(Jr.id);
  eq('A revised offer sent: accept again, finalise waits for the new acceptance', [byKey(resent, 'accept_offer').status, byKey(resent, 'finalise_offer').status], ['todo', 'locked']);
  await engine.closeJourney(Jr.id, 'declined', 'Said no by email');
  const reopened = await engine.reopenJourney(Jr.id, 'offer_sent');
  const rt = await engine.tasksOf(Jr.id);
  ok('reopenJourney: closedAt gone, cancelled tasks back by their rules, done ones still done',
    !reopened.closedAt && reopened.status === 'offer_sent' && byKey(rt, 'accept_offer').status === 'todo' && byKey(rt, 'about_you').status === 'todo' && byKey(rt, 'send_offer').status === 'done' && !rt.some((t) => t.status === 'cancelled'));
  eq('reopenJourney on an open journey is refused', (await refusal(async () => engine.reopenJourney(Jr.id, 'offer_sent'))).status, 409);
  await engine.closeJourney(Jr.id, 'declined');

  section('Pre-boarding flags');
  const quiet = { ...(await engine.loadJourney(J1.id)), status: 'active' as const, lastActivityAt: at(day(-4)) };
  const quietTasks = (await engine.tasksOf(J1.id)).map((t) => (t.systemKey === 'about_you' ? { ...t, status: 'todo' as const } : t));
  const qd = engine.deriveJourney(quiet, quietTasks, now);
  ok('4 days without portal activity: Quiet 4 days', qd.flags.includes('quiet') && qd.quietDays === 4, qd);
  const risk = engine.deriveJourney({ ...quiet, tj: day(4) }, quietTasks.map((t) => (t.systemKey === 'upload_documents' ? { ...t, status: 'todo' as const } : t)), now);
  ok('Tj − 4 with documents missing: Joining risk', risk.flags.includes('joining_risk'));
  const J0 = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand('Maya Das'), tj: day(20), managerUserId: 'mgr' });
  await engine.setJourneyStatus(J0.id, 'offer_sent');
  await engine.setJourneyStatus(J0.id, 'accepted');
  await engine.closeJourney(J0.id, 'not_joining', 'Took another offer');
  const t0 = await engine.tasksOf(J0.id);
  ok('Not joining: open tasks cancelled, done ones stay done, closedAt stamped',
    byKey(t0, 'accept_offer').status === 'done' && byKey(t0, 'finalise_offer').status === 'cancelled' && !!(await engine.loadJourney(J0.id)).closedAt);

  // ───────────────────────────────────────────────────────── labels and plant (pure)
  section('Day labels, columns, stages and the plant');
  const pure = { ...(await engine.loadJourney(J1.id)), tj: '2026-12-01', status: 'joined' as const, userId: 'x' };
  const label = (key: string) => engine.dayLabelFor(pure, key);
  eq('Day 1 on Tj only; Week 1 from Day 2; Week 2 at Tj + 7; Week 5 on 31 Dec; Month 2 from 1 Jan',
    [label('2026-12-01'), label('2026-12-02'), label('2026-12-07'), label('2026-12-08'), label('2026-12-31'), label('2027-01-01'), label('2027-05-15')],
    ['Day 1', 'Week 1', 'Week 1', 'Week 2', 'Week 5', 'Month 2', 'Month 6']);
  eq('Before Tj: In 7 days', engine.dayLabelFor({ ...pure, status: 'finalised', userId: undefined }, '2026-11-24'), 'In 7 days');
  const pt = await engine.tasksOf(J1.id);
  const d = (key: string, j: Journey = pure, tasks = pt) => engine.deriveJourney(j, tasks, at(key));
  eq('Columns: Day 1 → Week-1 tasks → Day-7 survey → Week done on Tj + 7 (the day the app shows it) → probation Month 1 → Months 2–5 → Final month',
    ['2026-12-01', '2026-12-03', '2026-12-07', '2026-12-08', '2026-12-09', '2027-02-10', '2027-05-03'].map((k) => `${d(k).tab}/${d(k).column}`),
    ['first_week/day1', 'first_week/week1_tasks', 'first_week/day7_survey', 'first_week/week_done', 'probation/month1', 'probation/months_2_5', 'probation/final_month']);
  eq('Stages: welcome → settling in → growing gains → final month', ['2026-12-03', '2026-12-08', '2027-02-10', '2027-05-03'].map((k) => d(k).stage), ['welcome_week1', 'settling_in', 'growing_gains', 'final_month']);
  eq('Plant: seed → sprout (Tj) → seedling (Tj + 7) → sapling (after month 1) → bud (final month) → bloom (confirmed)',
    [d('2026-11-20', { ...pure, status: 'finalised', userId: undefined }).plant.stage, d('2026-12-01').plant.stage, d('2026-12-08').plant.stage, d('2027-01-01').plant.stage, d('2027-05-01').plant.stage, d('2027-05-20', { ...pure, status: 'confirmed' }).plant.stage],
    [0, 1, 2, 3, 4, 5]);
  eq('Pre-boarding water: documents and letters done = 2', d('2026-11-20', { ...pure, status: 'finalised', userId: undefined }).plant.water, 2);
  const lateWeek = pt.map((t) => (t.systemKey === 'week1_reels' ? { ...t, status: 'todo' as const, dueAt: rules.dayDate('2026-12-06') } : t));
  const droop = d('2026-12-07', pure, lateWeek);
  ok('A late week-1 task: the plant droops (never red), Late, and Needs attention after Tj + 5', droop.plant.droop && droop.flags.includes('late') && droop.flags.includes('needs_attention'));
  const leafy = d('2026-12-05', pure, pt.map((t) => (t.systemKey === 'week1_reels' ? { ...t, status: 'done' as const } : t)));
  eq('A finished group adds a leaf', leafy.plant.leaves, 1);

  section('Up next');
  const tv = (id: string, extra: Record<string, unknown>) => ({ id, phase: 'first_week', title: id, ownerRole: 'employee', kind: 'form', surface: 'app', mustDo: false, status: 'todo', dueAt: null, late: false, ...extra }) as TaskView;
  const open = [tv('later', { dueAt: '2026-12-09T00:00:00.000Z' }), tv('soon', { dueAt: '2026-12-04T00:00:00.000Z' }), tv('must', { mustDo: true, dueAt: '2026-12-08T00:00:00.000Z' }), tv('back', { status: 'sent_back', dueAt: '2026-12-04T00:00:00.000Z' })];
  const meeting = (mins: number) => ({ id: 'm', title: 'Meet your manager', startsAt: new Date(now.getTime() + mins * 60_000), journeyTaskId: 'mtask', attendeeUserIds: [] }) as unknown as Meeting;
  eq('A meeting starting within 2 hours comes first', app.pickUpNext([...open, tv('mtask', { kind: 'meeting' })], [meeting(90)], now).meeting?.id, 'm');
  eq('…not one whose task is already done', app.pickUpNext(open, [meeting(90)], now).view?.id, 'must');
  eq('A read-only row (someone else does it) is never Up next', app.pickUpNext([{ ...tv('hr', { mustDo: true }), readOnly: true } as TaskView], [], now).view, undefined);
  eq('…not one 3 hours away: must-do first', app.pickUpNext(open, [meeting(180)], now).view?.id, 'must');
  eq('Then the soonest due, not started before sent back', app.pickUpNext(open.filter((v) => !v.mustDo), [], now).view?.id, 'soon');

  // ───────────────────────────────────────────────────────── joining and the first week (app)
  section('Joining and the first week in the app');
  const joinAt = async (name: string, userId: string, tjOffset: number, extra: Record<string, unknown> = {}) => {
    const j = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand(name), tj: day(tjOffset), managerUserId: 'mgr', designation: 'Analyst', department: 'Design' });
    for (const s of ['offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const) await engine.setJourneyStatus(j.id, s);
    await engine.completeTask(j.id, 'sign_letters');
    await users().insertOne(person(userId, name, { managerUserId: 'mgr', department: 'Design', ...extra }) as never);
    await engine.onJoined(j.id, userId);
    return engine.loadJourney(j.id);
  };
  const J2 = await joinAt('Isha Verma', 'isha', -6);
  const t2 = await engine.tasksOf(J2.id);
  eq('Joined: status, sprout, mark joined done, the joiner owns their tasks', [J2.status, J2.plant?.stage, byKey(t2, 'mark_joined').status, byKey(t2, 'week1_reels').ownerUserId], ['joined', 1, 'done', 'isha']);
  const ISHA = me('isha', 'Isha Verma');
  const meNow = await app.lifecycleMe(ISHA);
  eq('GET /lifecycle/me: the tile shows, Week 1', [meNow.enabled, (meNow as { onboarding?: { tileVisible: boolean; dayLabel: string } }).onboarding?.tileVisible, (meNow as { onboarding?: { dayLabel: string } }).onboarding?.dayLabel], [true, true, 'Week 1']);
  const home = await app.onboardingHome(ISHA);
  ok('Home: Up next is the must-do due soonest (Meet your manager, from Day 1), Day-7 survey is open today', home.upNext?.systemKey === 'meet_manager' && home.today.some((v) => v.systemKey === 'day7_survey' && v.status === 'todo'), home.upNext);
  type Row = TaskView & { readOnly?: boolean; doneBy?: string; meeting?: { startsAt: string; place?: string; with?: string; canConfirm?: boolean } };
  const rows = [...home.today, ...home.done, ...home.later] as Row[];
  ok('Home: someone else’s task shows only as a read-only row', rows.every((v) => v.ownerRole === 'employee' || v.ownerRole === 'manager_employee' || v.readOnly));
  const day1 = ['welcome_induction', 'vision_culture', 'laptop_setup', 'meet_team'];
  eq('Day 1 lists every item: induction, vision, laptop and Meet your team, read-only, with who does them',
    day1.map((k) => { const r = rows.find((v) => v.systemKey === k); return r ? [r.readOnly, r.doneBy] : null; }),
    [[true, 'HR'], [true, 'HR'], [true, 'IT'], [true, 'Your manager']]);
  const expectTotal = (await engine.tasksOf(J2.id)).filter((t) => t.phase === 'first_week' && t.status !== 'cancelled' && t.ownerRole !== 'automatic' && (['employee', 'manager_employee'].includes(t.ownerRole) || engine.joinerSeesReadOnly(t))).length;
  eq('…and they count toward the day (one count for the tile, the home and the profile card)', [home.progress.total, ((await app.lifecycleMe(ISHA)) as { onboarding?: { progress?: { total: number } } }).onboarding?.progress?.total], [expectTotal, expectTotal]);
  eq('The joiner cannot tick someone else’s task', (await refusal(async () => app.actOnOwnTask(ISHA, byKey(t2, 'welcome_induction').id, { action: 'done' }))).status, 404);
  ok('Joiner rows show app copy, never the template’s developer helper', !rows.some((v) => /push|Timed item|say hi|HR sees|Manager assigns/i.test(v.helper ?? '')) && rows.find((v) => v.systemKey === 'register_face')?.helper === '2 min · needed to punch in', rows.map((v) => v.helper));
  ok('A date-only due date is sent as a day, never a meeting time: no meeting row without its meeting', rows.filter((v) => v.kind === 'meeting' && !v.meeting).every((v) => !v.dueAt || v.dueAt.endsWith('T00:00:00.000Z')));
  eq('Product-driven tasks are done from their screens', (await refusal(async () => app.actOnOwnTask(ISHA, byKey(t2, 'intro_post').id, { action: 'done' }))).status, 409);
  eq('A must-do cannot be skipped', (await refusal(async () => app.actOnOwnTask(ISHA, byKey(t2, 'meet_manager').id, { action: 'skip' }))).status, 409);
  eq('The tour can be ticked', (await app.actOnOwnTask(ISHA, byKey(t2, 'app_tour').id, { action: 'done' })).task.status, 'done');

  await policyDocuments().insertOne({ org: ORG, key: 'leave', title: 'Leave', body: 'Take leave.', order: 1, active: true, createdAt: now, updatedAt: new Date('2026-10-01T00:00:00Z') } as never);
  eq('/me: the tile’s progress', ((await app.lifecycleMe(ISHA)) as { onboarding?: { progress?: { total: number } } }).onboarding?.progress?.total! > 0, true);
  await app.saveWeek1Step(ISHA, { step: 'policies', value: { versions: [{ id: 'leave', version: 'x' }], device: 'Check/1.0' } });
  const tax = await app.saveWeek1Step(ISHA, { step: 'tax', value: { regime: 'new' } });
  eq('Tax regime kept; payroll not set up here so not written there', [tax.taxRegime?.regime, tax.taxSavedToPayroll], ['new', false]);
  eq('A different regime in the same FY is refused (the app sends it bare)', (await refusal(async () => app.saveWeek1Step(ISHA, { step: 'tax', value: 'old' }))).status, 409);
  await app.saveWeek1Step(ISHA, { step: 'bank_pf', value: { change: { ifsc: 'HDFC0001234', accountNumber: '123456784417' } } });
  const jBank = await engine.loadJourney(J2.id);
  ok('A bank edit waits for HR (pending, only the last four in the clear)', jBank.bankPfRequest?.status === 'pending' && jBank.bankPfRequest.changes.accountLast4 === '4417' && !JSON.stringify(engine.sanitiseJourney(jBank)).includes('123456784417'));
  const w1 = await app.saveWeek1Step(ISHA, { step: 'goals', value: { read: true } });
  eq('week1 GET: the policy list, the ack apart, steps, manager name', [w1.policies.map((p) => p.id), !!w1.policiesAckAt, w1.steps, w1.managerName], [['leave'], true, { policies: true, tax: true, bank_pf: true, goals: true }, 'Neha Rao']);
  eq('Policies stored with versions and device', [w1.policiesAck?.versions, w1.policiesAck?.device], [[{ id: 'leave', version: '2026-10-01T00:00:00.000Z' }], 'Check/1.0']);
  // One acknowledgement record for every screen (nj-1120 L4): Week-1's agree writes each policy's own, the
  // counts are the same in GET /policies and the onboarding home, and an HR update brings it back as Updated.
  const pol = await import('../services/policy-document.service');
  await policyDocuments().insertOne({ org: ORG, key: 'travel', title: 'Travel', body: 'Book ahead.', order: 2, active: true, ackRequired: false, version: 1, createdAt: now, updatedAt: now } as never);
  const pol1 = await pol.policiesFor(ISHA);
  eq('Week-1 agree is each policy\'s acknowledgement too; a read-only one is not touched', pol1.map((p) => [p.key, p.acknowledgedVersion ?? null]), [['leave', 1], ['travel', null]]);
  eq('Counts: GET /policies and the home agree', [pol.policyAckCounts(pol1), (await app.onboardingHome(ISHA)).policies], [{ required: 1, acknowledged: 1, toAcknowledge: 0 }, { required: 1, acknowledged: 1, toAcknowledge: 0 }]);
  await pol.updatePolicy(ORG, 'leave', { body: 'Take leave. Casual leave is 8 days.', changeNote: 'Casual leave goes up from 6 to 8 days.' }, 'Hema HR');
  const pol2 = await pol.policiesFor(ISHA);
  const leave2 = pol2.find((p) => p.key === 'leave')!;
  eq('HR changes the text: version 2, Updated (acknowledged 1), what changed, 1 to acknowledge everywhere',
    [leave2.version, leave2.acknowledgedVersion, leave2.changeNote, pol.policyAckCounts(pol2).toAcknowledge, (await app.onboardingHome(ISHA)).policies.toAcknowledge],
    [2, 1, 'Casual leave goes up from 6 to 8 days.', 1, 1]);
  eq('An old version is refused', (await refusal(async () => pol.acknowledgePolicy(ISHA, 'leave', { version: 1 }))).status, 409);
  const acked = await pol.acknowledgePolicy(ISHA, 'leave', { version: 2 });
  eq('Acknowledging the update: none left', [acked.policy.acknowledgedVersion, pol.policyAckCounts(acked.policies).toAcknowledge, (await app.onboardingHome(ISHA)).policies.toAcknowledge], [2, 0, 0]);
  await pol.acknowledgePolicy(ISHA, 'travel', {});
  eq('A read-only policy can be acknowledged and never counts', pol.policyAckCounts(await pol.policiesFor(ISHA)), { required: 1, acknowledged: 1, toAcknowledge: 0 });
  // The tour: "For managers" only for someone with direct reports.
  eq('Tour: no manager lessons without reports', (await app.onboardingHome(ISHA)).tour.managerLessons, undefined);
  await users().insertOne(person('isha-report', 'Report of Isha', { managerUserId: 'isha' }) as never);
  eq('Tour: manager lessons once someone reports to her', (await app.onboardingHome(ISHA)).tour.managerLessons, ['approveLeave', 'approveOvertime']);
  eq('A lesson done answers the same tour', (await app.tourLessonDone(ISHA, 'missed')).managerLessons, ['approveLeave', 'approveOvertime']);
  await users().deleteOne({ userId: 'isha-report' });
  eq('All four reels: week-1 tasks done, a leaf', [byKey(await engine.tasksOf(J2.id), 'week1_reels').status, (await engine.loadJourney(J2.id)).plant?.leaves], ['done', 1]);
  const declined = await board.decideBankPfRequest(ORG, J2.id, { decision: 'decline', note: 'Send a cancelled cheque' }, HR);
  eq('HR declines the bank change; the joiner is told', [declined.journey.bankPfRequest?.status, await tellCount('isha', 'lifecycle_bank_pf_decided')], ['declined', 1]);

  await app.saveIntro(ISHA, { line: 'Designer who sketches on trains', funFacts: ['☕ Chai over coffee', '🥾 Weekend trekker'] });
  eq('One line is at most 80 characters', (await refusal(async () => app.saveIntro(ISHA, { line: 'x'.repeat(81) }))).status, 400);
  const posted = await app.postIntro(ISHA);
  const post = await connectPosts().findOne({ id: posted.connectPostId });
  ok('Intro post: a real Connect post in the new-joiner style by the joiner', post?.type === 'new_joinee' && post.author.userId === 'isha' && (post.body as { introPost?: boolean }).introPost === true);
  eq('…intro task done, the manager asked to say hi', [byKey(await engine.tasksOf(J2.id), 'intro_post').status, await tellCount('mgr', 'lifecycle_intro_post')], ['done', 1]);
  eq('Posting twice is refused', (await refusal(async () => app.postIntro(ISHA))).status, 409);
  eq('The preview’s bubble is the posted text (a full stop after the line)', [(post?.body as { message?: string }).message, app.introMessage('Hello!')], ['Hey everyone! Designer who sketches on trains. Excited to meet you all 🙌', 'Hey everyone! Hello! Excited to meet you all 🙌']);
  const introNow = await app.introView(ISHA) as { likes?: number; commentCount?: number };
  eq('Posted: the intro shows its likes and comments', [introNow.likes, introNow.commentCount], [0, 0]);

  await app.saveSetup(MGR, J2.id, { people: [{ userId: 'p1', why: 'Your buddy' }, { userId: 'p2' }], buddyUserId: 'p1', welcomeNote: { kind: 'text', text: 'Welcome!' }, goals: ['Ship the leave redesign'] });
  eq('Set-up: people, buddy, note and goals saved; set-up and goals tasks done', [(await app.peopleView(ISHA)).people.length, byKey(await engine.tasksOf(J2.id), 'manager_setup').status, byKey(await engine.tasksOf(J2.id), 'probation_goals').status], [2, 'done', 'done']);
  const ppl = (await app.peopleView(ISHA)).people;
  await app.actOnPerson(ISHA, ppl[0].id, { action: 'met' });
  eq('One of two met: not done yet', byKey(await engine.tasksOf(J2.id), 'people_to_meet').status, 'todo');
  await app.actOnPerson(ISHA, ppl[1].id, { action: 'met' });
  eq('Everyone met: people to meet done', byKey(await engine.tasksOf(J2.id), 'people_to_meet').status, 'done');

  const st = await app.assignStarterTask(MGR, J2.id, { title: 'Redesign the leave request screen', dueAt: day(2), note: 'Start with the research notes' });
  const pushed = await notifications().findOne({ userId: 'isha', scenario: 'lifecycle_starter_task' });
  eq('Push payload: scenario + data { destination, journeyId, starterTaskId }', pushed?.data, { journeyId: J2.id, starterTaskId: st.task.id, destination: 'lifecycle_starter_task' });
  eq('Starter tasks carry the assigner’s name', (await app.starterTasksForJoiner(ISHA)).tasks[0].assignedByName, 'Neha Rao');
  eq('Starter task: the joiner is pushed; the step is due when the task is', [await tellCount('isha', 'lifecycle_starter_task'), rules.keyOfDay(byKey(await engine.tasksOf(J2.id), 'starter_task').dueAt!)], [1, day(2)]);
  ok('It shows in the joiner’s list', (await app.onboardingHome(ISHA)).today.some((v) => v.id === st.task.id));
  await app.starterDone(ISHA, st.task.id, { note: 'First version is in the folder' });
  eq('Done: the manager is told, the step done', [await tellCount('mgr', 'lifecycle_starter_task_done'), byKey(await engine.tasksOf(J2.id), 'starter_task').status], [1, 'done']);
  await app.replyToStarterTask(MGR, st.task.id, { text: 'Nice start!' });
  eq('The reply reaches the joiner', await tellCount('isha', 'lifecycle_starter_task_reply'), 1);

  await app.addNote(MGR, J2.id, { text: 'Private thoughts', shared: false });
  await app.addNote(MGR, J2.id, { text: 'Settling in well', shared: true });
  const notes = await app.notesForJoiner(ISHA);
  eq('Only shared notes reach the joiner', notes.notes.map((n) => n.text), ['Settling in well']);
  await app.actOnNote(ISHA, notes.notes[0].id, { action: 'reply', text: 'Thanks!' });
  eq('A reply reaches the manager; 1:1 notes done', [await tellCount('mgr', 'lifecycle_note_reply'), byKey(await engine.tasksOf(J2.id), 'one_on_one_notes').status], [1, 'done']);

  const sv = await app.surveyView(ISHA);
  eq('Day-7 survey open on Tj + 6', [sv.kind, sv.open, sv.sent], ['day7', true, false]);
  eq('Answers are validated', (await refusal(async () => app.sendSurvey(ISHA, { answers: { q1: 6, q2: 'yes', q3: 3 } }))).status, 400);
  await app.sendSurvey(ISHA, { answers: { q1: 4, q2: 'mostly', q3: 5, q4: 'More coffee' } });
  eq('Sent once; twice refused', [byKey(await engine.tasksOf(J2.id), 'day7_survey').status, (await refusal(async () => app.sendSurvey(ISHA, { answers: { q1: 4, q2: 'yes', q3: 5 } }))).status], ['done', 409]);

  section('Survey privacy: per kind, 3+ different people, never a name');
  let mj = await app.joinerForManager(MGR, J2.id);
  ok('One answer: no summary', mj.surveySummary === undefined);
  // One person answering Day 7, M3 and M6 unlocks nothing (people, not responses; kinds never merged).
  await surveyResponses().insertMany([
    { id: 's-p3-m3', org: ORG, kind: 'm3', userId: 'isha', managerUserId: 'mgr', answers: { q1: 5, q2: 'yes', q3: 5, q4: null }, createdAt: now },
    { id: 's-p3-m6', org: ORG, kind: 'm6', userId: 'isha', managerUserId: 'mgr', answers: { q1: 5, q2: 'yes', q3: 5, q4: null }, createdAt: now },
  ] as never[]);
  mj = await app.joinerForManager(MGR, J2.id);
  ok('One person across Day 7, M3 and M6: still no summary', mj.surveySummary === undefined && !('surveySummaries' in mj), mj.surveySummary);
  await surveyResponses().insertOne({ id: 's2', org: ORG, kind: 'day7', userId: 'p3', managerUserId: 'mgr', answers: { q1: 2, q2: 'no', q3: 3, q4: null }, createdAt: now } as never);
  await surveyResponses().insertOne({ id: 's2b', org: ORG, kind: 'day7', userId: 'p3', managerUserId: 'mgr', answers: { q1: 2, q2: 'no', q3: 3, q4: null }, createdAt: now } as never);
  mj = await app.joinerForManager(MGR, J2.id);
  ok('Two people (one of them twice): still none', mj.surveySummary === undefined);
  await surveyResponses().insertOne({ id: 's3', org: ORG, kind: 'day7', userId: 'p4', managerUserId: 'mgr', answers: { q1: 3, q2: 'yes', q3: 4, q4: null }, createdAt: now } as never);
  mj = await app.joinerForManager(MGR, J2.id);
  eq('Three different people on Day 7: that kind only, count and average of people', [mj.surveySummary, mj.surveySummaries], [{ kind: 'day7', count: 3, avg: 3 }, [{ kind: 'day7', count: 3, avg: 3 }]]);
  ok('The summary carries no names or answers', !/Isha|q4|More coffee|userId/.test(JSON.stringify(mj.surveySummaries)));
  const hrSurveys = await board.surveyAnswers(ORG, 'day7');
  ok('HR sees every answer with the name', hrSurveys.responses.some((x) => x.name === 'Isha Verma' && x.answers.q4 === 'More coffee'));

  section('M2: the manager’s welcome post');
  const welcome = await app.postWelcome(MGR, J2.id, { text: 'Please welcome Isha to the design team!' });
  const wpost = await connectPosts().findOne({ id: welcome.welcomePost.connectPostId });
  ok('A new-joiner post on Connect by the manager, about the joiner', wpost?.type === 'new_joinee' && wpost.author.userId === 'mgr' && (wpost.body as { personUserId?: string; welcomePost?: boolean; managerNote?: string }).personUserId === 'isha' && (wpost.body as { welcomePost?: boolean }).welcomePost === true);
  eq('Once per joiner', (await refusal(async () => app.postWelcome(MGR, J2.id, { text: 'Again' }))).status, 409);
  eq('M2 no longer offers it', (await app.joinerForManager(MGR, J2.id)).welcomePost.canPost, false);
  eq('The joiner is told', await tellCount('isha', 'lifecycle_welcome_post'), 1);

  section('Manager access');
  const joiners = await app.joinersForManager(MGR);
  ok('Team › New joiners lists the manager’s joiners', joiners.joiners.some((x) => x.journeyId === J2.id));
  eq('…and nobody else’s', (await app.joinersForManager(me('mgr2', 'Other Manager'))).joiners.length, 0);
  eq('Another manager cannot open the joiner', (await refusal(async () => app.joinerForManager(me('mgr2', 'Other Manager'), J2.id))).status, 404);
  const J3 = await joinAt('Rohan Pillai', 'rohan', -8);
  eq('Goals lock at Tj + 7', (await refusal(async () => app.saveSetup(MGR, J3.id, { goals: ['Late goal'] }))).status, 409);
  ok('Rohan is Week 2 on the probation tab', (await engine.loadJourney(J3.id)).boardTab === 'probation');
  const ROHAN = me('rohan', 'Rohan Pillai');
  const rh = await app.onboardingHome(ROHAN);
  eq('A8: the server says “Week 1, done!” is due, with its stats', [rh.showWeekDone, typeof rh.weekDoneStats.tasksDone], [true, 'number']);
  await app.markWeekDoneSeen(ROHAN);
  eq('…and once seen it never shows again (on any device)', (await app.onboardingHome(ROHAN)).showWeekDone, false);
  const rohanMe = await app.lifecycleMe(ROHAN) as { onboarding?: { subtitle?: string } };
  ok('The Action tile’s subtitle follows the stage after week 1', /^Week 2 · /.test(rohanMe.onboarding?.subtitle ?? ''), rohanMe.onboarding);
  ok('…and counts steps in week 1', /^\d+ of \d+ steps done$/.test(((await app.lifecycleMe(ISHA)) as { onboarding?: { subtitle?: string } }).onboarding?.subtitle ?? ''));

  // ───────────────────────────────────────────────────────── the new joiner's home tiles
  section('The home’s Devices and accesses, Watch list and Your profile (new-joiner prototype, 20 Nov)');
  {
    const base = byKey(await engine.tasksOf(J2.id), 'laptop_setup');
    const crm = { ...base, id: `crm-${J2.id}`, systemKey: undefined, title: 'Admissions CRM access', helper: undefined, status: 'todo' as const, doneAt: undefined };
    delete (crm as { _id?: unknown })._id;
    await journeyTasks().insertOne(crm as never);
    const devices = (await app.onboardingHome(ISHA)).devices as Array<{ key: string; title: string; ready: boolean }>;
    eq('Devices: the laptop, the email, the app and the template’s own IT access row, each with its task’s status',
      devices.map((d) => [d.title, d.ready]), [['Laptop', byKey(await engine.tasksOf(J2.id), 'laptop_setup').status === 'done'], ['Email', true], ['Sowaka Connect', true], ['Admissions CRM access', false]]);
    await board.actOnTaskByHr(ORG, J2.id, crm.id, { action: 'done' }, HR);
    ok('…IT ticking it on the board makes it Ready in the app', ((await app.onboardingHome(ISHA)).devices as Array<{ title: string; ready: boolean }>).find((d) => d.title === 'Admissions CRM access')?.ready === true);

    eq('Watch list: nothing of its own while the company has no Meet us video', (await app.onboardingHome(ISHA)).watch, []);
    await companies().updateOne({ id: ORG }, { $set: { lifecyclePortal: { videoUrl: 'https://videos.check.test/life.mp4', videoTitle: 'Life at Check Co' } } });
    const portal = await import('../services/lifecycle/portal');
    const meet = (await portal.meetItems(await engine.loadJourney(J2.id))).filter((i) => i.videoUrl);
    const withVideo = await app.onboardingHome(ISHA);
    eq('…the portal’s Meet us videos, the same titles and links, and the company’s name',
      [withVideo.companyName, withVideo.watch.map((v) => [v.title, v.videoUrl])], ['Check Co', meet.map((i) => [i.title, i.videoUrl])]);

    const profile = await import('../services/lifecycle/profile');
    const portalProfile = await profile.profileView(await engine.loadJourney(J2.id));
    const panel = await board.journeyPanel(ORG, J2.id);
    eq('Your profile: the portal’s six sections (no photo step since 23 Nov), its count, and the dashboard joiner panel’s',
      [withVideo.profile.sections.map((x) => [x.title, x.done]), withVideo.profile.done, withVideo.profile.total, panel.journey.profileSections],
      [portalProfile.sections.map((x) => [x.title, x.done]), portalProfile.done, 6, { done: portalProfile.done, total: 6 }]);
    await journeys().updateOne({ id: J2.id }, { $set: { 'profile.personal': { fullName: 'Isha Verma', dob: '1999-01-01', gender: 'Female' } } });
    eq('…a section saved on the portal counts on all three', [(await app.onboardingHome(ISHA)).profile.done, (await board.journeyPanel(ORG, J2.id)).journey.profileSections.done], [portalProfile.done + 1, portalProfile.done + 1]);

    eq('Tour: no lesson done before the first punch-in', (await app.onboardingHome(ISHA)).tour.done.includes('punch'), false);
    const { attendanceRecords } = db;
    await attendanceRecords().insertOne({ userId: 'isha', org: ORG, workDate: J2.tj, punchIn: at(J2.tj!, '09:05') } as never);
    eq('…the first punch-in is “Punch in and out” done (the prototype’s first punch)', (await app.onboardingHome(ISHA)).tour.done[0], 'punch');
  }

  // ───────────────────────────────────────────────────────── board
  section('The HR board');
  const pre = await board.onboardingBoard(ORG, 'hr', { tab: 'pre_boarding' });
  const kabir = pre.columns.find((c) => c.key === 'ready_to_join')!.cards.find((c) => c.journeyId === J1.id);
  ok('Pre-boarding columns in order', pre.columns.map((c) => c.label).join(' · ') === 'Offer sent · Accepted · Documents · Letters to sign · Ready to join');
  ok('Kabir’s card: Ready to join, waits on someone, progress counted', !!kabir && kabir.waitingOn.length > 0 && kabir.progress.total > 0, kabir);
  ok('Closed journeys are off the board', !pre.columns.flatMap((c) => c.cards).some((c) => c.journeyId === J0.id));
  const week = await board.onboardingBoard(ORG, 'hr', { tab: 'first_week' });
  ok('First week: Isha in Day-7 survey or Week done', week.columns.flatMap((c) => c.cards).some((c) => c.journeyId === J2.id));
  eq('Counts per tab', [pre.counts.pre_boarding >= 1, week.counts.first_week >= 1, week.counts.probation >= 1], [true, true, true]);
  const search = await board.onboardingBoard(ORG, 'hr', { tab: 'pre_boarding', q: 'kabir' });
  eq('Search finds by name', search.columns.flatMap((c) => c.cards).map((c) => c.name), ['Kabir Mehta']);
  const ranged = await board.onboardingBoard(ORG, 'hr', { tab: 'pre_boarding', from: day(21), to: day(40) });
  eq('Joining date range filters', ranged.columns.flatMap((c) => c.cards).length, 0);
  eq('An unknown filter is refused', (await refusal(async () => board.onboardingBoard(ORG, 'hr', { filter: 'nope' }))).status, 400);
  const J1b = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand('Arjun Nair'), tj: day(20), managerUserId: 'mgr' });
  const panel = await board.journeyPanel(ORG, J1.id);
  ok('Side panel: tasks, the offer and its documents (BE-offer), batch on the same Tj', panel.tasks.length === 52 && panel.offer?.version === 1 && Array.isArray(panel.documents) && panel.documents.length === 8 && panel.batch.some((b) => b.journeyId === J1b.id), { tasks: panel.tasks.length, offer: panel.offer, documents: panel.documents, batch: panel.batch.length });
  ok('The panel hides the snapshot and encrypted fields', !('templateSnapshot' in panel.journey));
  const acted = await board.actOnTaskByHr(ORG, J1.id, byKey(await engine.tasksOf(J1.id), 'device_request').id, { action: 'done', note: 'Raised with IT' }, HR);
  eq('HR ticks a task', [acted.status, acted.doneByName, acted.note], ['done', 'Hema HR', 'Raised with IT']);
  eq('HR cannot skip a must-do', (await refusal(async () => board.actOnTaskByHr(ORG, J1.id, byKey(await engine.tasksOf(J1.id), 'mark_joined').id, { action: 'skip' }, HR))).status, 409);
  await board.updateJourneyByHr(ORG, J2.id, { day1Pass: { reportingTime: '09:30', place: 'Room 4B', agenda: [{ time: '11:00', title: 'Meet your manager', with: 'Neha' }] } });
  const meetings = await lifecycleMeetings().find({ journeyId: J2.id }).toArray();
  const mv = await app.meetingFor(ISHA, (await lifecycleMeetings().findOne({ journeyId: J2.id }))!.id);
  eq('Meeting: attendees with roles, what to expect, must-do', [mv.attendees.map((a) => a.role), mv.expect.length, mv.mustDo, mv.systemKey], [['joiner', 'manager'], 4, true, 'meet_manager']);
  ok('The home links the meeting to its task', (await app.onboardingHome(ISHA)).today.some((v) => v.systemKey === 'meet_manager' && (v as { meetingId?: string }).meetingId === mv.id));
  type MeetingRow = TaskView & { meeting?: { id: string; startsAt: string; place?: string; with?: string; canConfirm?: boolean } };
  const homeRow = ((await app.onboardingHome(ISHA)).today as MeetingRow[]).find((v) => v.systemKey === 'meet_manager');
  eq('Every meeting row carries its meeting (time, the room kept beside the person)', [homeRow?.meeting?.id, homeRow?.meeting?.startsAt, homeRow?.meeting?.place, homeRow?.meeting?.with, homeRow?.meeting?.canConfirm], [mv.id, at(J2.tj!, '11:00').toISOString(), 'Room 4B', 'Neha Rao', true]);
  const mgrRow = ((await app.joinerForManager(MGR, J2.id)).tasks as MeetingRow[]).find((v) => v.systemKey === 'meet_manager');
  eq('…on the manager’s M2 too, phrased for them', [mgrRow?.meeting?.id, mgrRow?.title], [mv.id, 'Meet Isha']);
  ok('The Day-1 agenda becomes a meeting tied to “Meet your manager”', meetings.length === 1 && meetings[0].journeyTaskId === byKey(await engine.tasksOf(J2.id), 'meet_manager').id && meetings[0].attendeeUserIds.includes('mgr'));
  eq('The template can change only on a draft', (await refusal(async () => board.updateJourneyByHr(ORG, J2.id, { templateId: faculty.id }))).status, 409);
  await board.updateJourneyByHr(ORG, J1b.id, { templateId: faculty.id });
  eq('A draft re-snapshots its new template', (await engine.loadJourney(J1b.id)).templateSnapshot.name, 'Faculty');

  // ───────────────────────────────────────────────────────── Day 1, done!
  section('Day 1, done! (New joiner artifact): people met, things done, How was today?');
  const homeBefore = await app.onboardingHome(ISHA);
  eq('Things done is the home’s own “steps done” count', homeBefore.day1.thingsDone, homeBefore.progress.done);
  await app.actOnMeeting(ISHA, mv.id, { met: 'yes' });
  const homeAfter = await app.onboardingHome(ISHA);
  ok('A meeting marked met counts its people (the manager), each once', homeAfter.day1.peopleMet >= 1 && homeAfter.day1.peopleMet <= homeBefore.day1.peopleMet + 1, { before: homeBefore.day1, after: homeAfter.day1 });
  eq('…and the meeting task done counts as a thing done', homeAfter.day1.thingsDone, homeAfter.progress.done);
  eq('An answer outside great / okay / tough is refused', (await refusal(async () => app.saveDay1Feeling(ISHA, { answer: 'meh' }))).status, 400);
  eq('How was today? is saved on the journey', (await app.saveDay1Feeling(ISHA, { answer: 'okay' })).feeling, 'okay');
  await app.saveDay1Feeling(ISHA, { answer: 'great' });
  eq('…answering again changes it; the home sends it back', (await app.onboardingHome(ISHA)).day1.feeling, 'great');
  eq('HR’s joiner panel shows the same answer', (await board.journeyPanel(ORG, J2.id)).journey.day1Feeling?.answer, 'great');

  // ───────────────────────────────────────────────────────── probation
  section('Probation: months, check-ins, decision, extension, reveal');
  const finalTj = rules.addDaysKey(rules.addMonthsKey(TODAY, -5), -3);
  const J4 = await joinAt('Sameer Khan', 'sameer', rules.daysBetween(TODAY, finalTj));
  let j4 = await engine.loadJourney(J4.id);
  ok('Final month: column Final month, Decide, bud', j4.boardColumn === 'final_month' && j4.flags!.includes('decide') && j4.plant?.stage === 4, [j4.boardColumn, j4.flags, j4.plant]);
  const SAMEER = me('sameer', 'Sameer Khan');
  const discussion = byKey(await engine.tasksOf(J4.id), 'confirmation_discussion', 6);
  const m2Sameer = await app.joinerForManager(MGR, J4.id);
  eq('M2: the Confirmation discussion shows to the manager without a Done', [(m2Sameer.tasks as Array<TaskView & { canMarkDone?: boolean }>).find((t) => t.id === discussion.id)?.canMarkDone, discussion.status], [false, 'todo']);
  eq('…and the server refuses the manager ticking it (HR records the decision)', (await refusal(async () => app.managerTaskDone(MGR, J4.id, discussion.id, { action: 'done' }))).status, 403);
  eq('…so HR’s decision window stays open', byKey(await engine.tasksOf(J4.id), 'confirmation_discussion', 6).status, 'todo');
  eq('The joiner rates a month 1–4', (await refusal(async () => app.checkinForMe(SAMEER, 1, { text: 'x', rating: 5 }))).status, 400);
  eq('The month-6 check-in is not open yet', (await refusal(async () => app.checkinForMe(SAMEER, 6, { text: 'Going well', rating: 4 }))).status, 409);
  await app.managerProbationMonth(MGR, J4.id, 1, { goals: ['Ship the first feature'] });
  eq('A self-rating per goal: one per goal', (await refusal(async () => app.checkinForMe(SAMEER, 1, { win: 'x', rating: 4, goalRatings: [4, 5] }))).status, 400);
  await app.checkinForMe(SAMEER, 1, { rating: 4, goalRatings: [4], win: 'Shipped the first feature', ask: 'Access to analytics' });
  const p1 = await app.managerProbationMonth(MGR, J4.id, 1, { checkin: { text: 'Agreed', rating: 4, goalRatings: [3] } });
  const m1 = p1.months.find((m) => m.monthNo === 1)!;
  eq('Both check-ins in: month-1 check-in done, goals locked', [byKey(await engine.tasksOf(J4.id), 'monthly_checkin', 1).status, !!m1.lockedAt], ['done', true]);
  eq('Locked goals refuse edits', (await refusal(async () => app.managerProbationMonth(MGR, J4.id, 1, { goals: ['Another'] }))).status, 409);
  eq('PB1/PB2 stored: per-goal ratings both sides, the win and the ask', [m1.checkinEmployee?.goalRatings, m1.checkinEmployee?.win, m1.checkinEmployee?.ask, m1.checkinManager?.goalRatings, m1.checkinEmployee?.text], [[4], 'Shipped the first feature', 'Access to analytics', [3], 'A win: Shipped the first feature\nWould help: Access to analytics']);
  eq('One-tap feedback is one of the four chips', (await refusal(async () => app.managerProbationMonth(MGR, J4.id, 1, { review: { feedback: ['Meh'] } }))).status, 400);
  const reviewed = await app.managerProbationMonth(MGR, J4.id, 1, { review: { feedback: ['Great start'], askAck: true, nextGoals: ['Own the weekly report'] } });
  eq('The review: chips and “On it” stored, next month’s goals set from it', [reviewed.months[0].review?.feedback, reviewed.months[0].review?.askAck, reviewed.months[1].goals], [['Great start'], true, [{ text: 'Own the weekly report' }]]);
  j4 = await engine.loadJourney(J4.id);
  eq('Review closes the cycle: review done, next month’s goals set, a leaf', [byKey(await engine.tasksOf(J4.id), 'monthly_review', 1).status, byKey(await engine.tasksOf(J4.id), 'monthly_goals', 2).status, j4.plant?.leaves], ['done', 'done', 1]);
  ok('The joiner does not see the manager’s check-in text', !JSON.stringify(await app.probationForMe(SAMEER)).includes('Agreed'));
  eq('Another manager cannot touch the month', (await refusal(async () => app.managerProbationMonth(me('mgr2', 'Other'), J4.id, 1, { goals: ['x'] }))).status, 404);
  eq('A bad outcome is refused', (await refusal(async () => probation.recordDecision(J4.id, HR, { outcome: 'maybe' }))).status, 400);
  const ext = await probation.recordDecision(J4.id, HR, { outcome: 'extend', extendMonths: 2 });
  const t4 = await engine.tasksOf(J4.id);
  j4 = await engine.loadJourney(J4.id);
  ok('Extend by 2: probation 8 months, months 7–8 added, a new final-month discussion, the old one done',
    ext.outcome === 'extend' && engine.totalProbationMonths(j4) === 8 && !!byKey(t4, 'monthly_checkin', 8) && byKey(t4, 'confirmation_discussion', 8)?.status === 'locked' && byKey(t4, 'confirmation_discussion', 6)?.status === 'done');
  eq('…back to Months 2–5, no Decide', [j4.boardColumn, j4.flags!.includes('decide')], ['months_2_5', false]);
  eq('A second decision waits for the new final month', (await refusal(async () => probation.recordDecision(J4.id, HR, { outcome: 'confirm' }))).status, 409);
  eq('The manager is told', await tellCount('mgr', 'lifecycle_decision'), 1);

  // D24-2: an offer shorter than the template (3 of 6 months) cancels months 4–6; extending by 2 brings months 4–5 back.
  const Jx = await joinAt('Runb Extend', 'runb', -10);
  await journeys().updateOne({ id: Jx.id }, { $set: { 'probation.months': 3 } });
  await engine.syncProbationTasks(Jx.id);
  const tShort = await engine.tasksOf(Jx.id);
  eq('A 3-month offer on a 6-month template: month 4–6 check-ins cancelled',
    [4, 5, 6].map((m) => byKey(tShort, 'monthly_checkin', m)?.status), ['cancelled', 'cancelled', 'cancelled']);
  await journeys().updateOne({ id: Jx.id }, { $set: { 'probation.extendedBy': 2 } });
  await engine.syncProbationTasks(Jx.id);
  const tx = await engine.tasksOf(Jx.id);
  eq('Extended by 2: months 4–5 check-in, review and goals back (not cancelled), month 6 stays cancelled, one task per month',
    [
      ...[4, 5].flatMap((m) => (['monthly_checkin', 'monthly_review', 'monthly_goals'] as SystemTaskKey[]).map((k) => byKey(tx, k, m)?.status === 'cancelled')),
      byKey(tx, 'monthly_checkin', 6)?.status,
      tx.filter((t) => t.systemKey === 'monthly_checkin' && t.month === 4).length,
    ],
    [false, false, false, false, false, false, 'cancelled', 1]);
  ok('…dated again by the refresh', [4, 5].every((m) => !!byKey(tx, 'monthly_checkin', m)?.dueAt));

  const J5 = await joinAt('Ishita Kaur', 'ishita', rules.daysBetween(TODAY, finalTj));
  const ISHITA = me('ishita', 'Ishita Kaur');
  const { kpiTemplates, kpiParameters } = db;
  const kp = await kpiParameters().insertOne({ org: ORG, title: 'Design quality', description: '', createdAt: now, updatedAt: now } as never);
  const kt = await kpiTemplates().insertOne({ org: ORG, name: 'Design IC', description: '', parameterIds: [String(kp.insertedId)], locations: [], designations: [], departments: [], managerUserIds: [], createdAt: now, updatedAt: now } as never);
  const conf = await probation.recordDecision(J5.id, HR, { outcome: 'confirm', salary: 1_600_000, designation: 'Senior designer', reportingToUserId: 'mgr', kpiTemplateId: String(kt.insertedId) });
  let j5 = await engine.loadJourney(J5.id);
  eq('Confirm: status confirmed, column Confirmed, bloom, flag Confirmed', [conf.outcome, j5.status, j5.boardColumn, j5.plant?.stage, j5.flags!.includes('confirmed')], ['confirm', 'confirmed', 'confirmed', 5, true]);
  eq('No reveal before the letter is sent', (await app.revealForMe(ISHITA)).ready, false);
  const j5LetterTask = byKey(await engine.tasksOf(J5.id), 'confirmation_letter').id;
  eq('The letter task cannot be ticked with no letter sent', (await refusal(() => board.actOnTaskByHr(ORG, J5.id, j5LetterTask, { action: 'done' }, HR))).status, 409);
  await db.letters().insertOne({ id: 'L-ishita', org: ORG, journeyId: J5.id, kind: 'confirmation', templateId: 't', refNo: 'CL-9', values: {}, createdAt: new Date(), email: { to: 'ishita@example.com', subject: 'Confirmed', body: 'x', sentAt: new Date() } } as never);
  await board.actOnTaskByHr(ORG, J5.id, byKey(await engine.tasksOf(J5.id), 'confirmation_letter').id, { action: 'done' }, HR);
  const rv = await app.revealForMe(ISHITA) as Record<string, unknown>;
  eq('Letter sent: the reveal shows the outcome, title, CTC (to them), manager and KPIs', [rv.ready, rv.outcome, rv.designation, rv.salary, rv.reportsTo, rv.kpis], [true, 'confirm', 'Senior designer', 1_600_000, 'Neha Rao', { name: 'Design IC', items: ['Design quality'] }]);
  const mgrView = await app.joinerForManager(MGR, J5.id);
  ok('The manager’s view: probation months and the decision, never the salary', mgrView.probation.months.length === 6 && mgrView.probation.decision?.outcome === 'confirm' && !JSON.stringify(mgrView).includes('1600000'));
  eq('Not seen yet', rv.seen, false);
  await jobs.runLifecycleJobs(at(TODAY), { full: true, orgs: [ORG] });
  await jobs.runLifecycleJobs(at(TODAY), { full: true, orgs: [ORG] });
  const p4 = byKey(await engine.tasksOf(J4.id), 'people_to_meet');
  eq('End of month 1: People to meet closes (skipped, no leaf), the unmet stay listed', [p4.status, p4.note, (await engine.loadJourney(J4.id)).plant?.leaves], ['skipped', 'Closed at the end of month 1', 1]);
  eq('…and the joiner sees it closed', (await app.peopleView(SAMEER)).closed, true);
  eq('M0: a probation joiner’s next event', (await app.joinersForManager(MGR)).joiners.find((x) => x.journeyId === J4.id)?.nextEvent?.split(' ')[0], 'Check-in');
  eq('The reveal push went once, to the reveal', [await tellCount('ishita', 'lifecycle_reveal_ready'), (await notifications().findOne({ userId: 'ishita', scenario: 'lifecycle_reveal_ready' }))?.data?.destination], [1, 'lifecycle_reveal']);
  await app.revealSeenForMe(ISHITA);
  j5 = await engine.loadJourney(J5.id);
  const meIshita = await app.lifecycleMe(ISHITA) as { onboarding?: { tileVisible: boolean } };
  eq('Seen: revealedAt stamped, the reveal task done, the tile goes', [!!j5.probation?.decision?.revealedAt, byKey(await engine.tasksOf(J5.id), 'confirmation_reveal').status, meIshita.onboarding?.tileVisible], [true, 'done', false]);

  // ───────────────────────────────────────────────────────── offboarding journey
  section('Offboarding journey (engine)');
  await users().insertOne(person('leaver', 'Pooja Iyer', { managerUserId: 'mgr' }) as never);
  const tl = day(30);
  const O1 = await engine.createOffboardingJourney(ORG, 'leaver', tl, 'resignation', 'hr');
  const to = await engine.tasksOf(O1.id);
  eq('Accepted; what led here is behind it', [O1.status, O1.exitType, byKey(to, 'send_resignation').status, byKey(to, 'hr_accept_exit').status, byKey(to, 'hr_start_exit').status], ['accepted', 'resignation', 'done', 'done', 'skipped']);
  eq('Handover checklist open, due in 3 days; uploads wait for it', [byKey(to, 'handover_checklist').status, rules.keyOfDay(byKey(to, 'handover_checklist').dueAt!), byKey(to, 'upload_handover').status], ['todo', day(3), 'locked']);
  eq('Exit interview opens Tl − 7 (template setting), settlement Tl + 3 working days', [rules.keyOfDay(byKey(to, 'exit_interview').opensAt!), rules.keyOfDay(byKey(to, 'final_settlement').dueAt!)],
    [rules.addDaysKey(tl, -7), rules.addWorkingDaysKey(tl, 3, await rules.workCalendar(ORG, { userId: 'leaver' }))]);
  await engine.moveTl(O1.id, rules.addDaysKey(tl, -10));
  eq('Moving Tl moves the open Tl tasks', rules.keyOfDay(byKey(await engine.tasksOf(O1.id), 'finance_clearance').dueAt!), rules.addDaysKey(tl, -12));
  eq('One exit at a time', (await refusal(async () => engine.createOffboardingJourney(ORG, 'leaver', tl, 'resignation', 'hr'))).status, 409);
  const meLeaver = await app.lifecycleMe(me('leaver', 'Pooja Iyer')) as { offboarding?: { pageVisible: boolean; tl: string } };
  eq('GET /lifecycle/me: the off-boarding page shows for a resignation', [meLeaver.offboarding?.pageVisible, meLeaver.offboarding?.tl], [true, rules.addDaysKey(tl, -10)]);

  // ───────────────────────────────────────────────────────── jobs
  section('Timed jobs fire exactly once');
  const J6 = await joinAt('Leo Pinto', 'leo', 0);
  const J7 = await joinAt('Dev Malhotra', 'dev', -8);
  await lifecycleMeetings().insertOne({ id: 'meet-soon', org: ORG, journeyId: J6.id, title: 'Meet your manager', startsAt: new Date(at(TODAY).getTime() + 20 * 60_000), attendeeUserIds: ['leo', 'mgr'] } as never);
  const early = await jobs.runLifecycleJobs(at(TODAY, '07:00'), { full: true, orgs: [ORG] });
  ok('Before 09:00 local no day job fires', !early.fired.some((f) => f.endsWith('tj_welcome')));
  const run1 = await jobs.runLifecycleJobs(at(TODAY), { full: true, orgs: [ORG] });
  const run2 = await jobs.runLifecycleJobs(at(TODAY), { full: true, orgs: [ORG] });
  const run3 = await jobs.runLifecycleJobs(new Date(at(TODAY).getTime() + 3_600_000), { full: true, orgs: [ORG] });
  ok('First run fires the day jobs (welcome on Tj, week done and portal close at Tj + 7)', run1.fired.includes(`${J6.id}:tj_welcome`) && run1.fired.includes(`${J7.id}:tj7_week_done`) && run1.fired.includes(`${J7.id}:portal_closed`), run1.fired);
  eq('Repeated runs fire nothing again', [run2.fired.length, run3.fired.length, run2.reminded, run3.reminded], [0, 0, 0, 0]);
  eq('Welcome told once, the manager told once', [await tellCount('leo', 'lifecycle_welcome'), await tellCount('mgr', 'lifecycle_joiner_today') >= 1], [1, true]);
  eq('The meeting reminder went once to both', [run1.meetings + early.meetings, run2.meetings, await tellCount('leo', 'lifecycle_meeting_soon'), await tellCount('mgr', 'lifecycle_meeting_soon')], [1, 0, 1, 1]);
  eq('Portal closed at Tj + 7: moved to app', (await engine.loadJourney(J7.id)).status, 'moved_to_app');
  const overdueRows = await notifications().find({ scenario: 'lifecycle_task_overdue' }).toArray();
  ok('Overdue tasks: each owner told once per task', overdueRows.length > 0 && new Set(overdueRows.map((n) => `${n.userId}:${(n.data as { taskId?: string }).taskId}`)).size === overdueRows.length);
  eq('Week 1 done for Dev (automatic at Tj + 7)', byKey(await engine.tasksOf(J7.id), 'week1_done').status, 'done');
  eq('Day-1 pass unlocked automatically at Tj − 7 for Kabir? (Tj + 20: not yet)', byKey(await engine.tasksOf(J1.id), 'day1_pass').status, 'locked');
  const J8 = await engine.createOnboardingJourney(ORG, 'hr', { candidate: cand('Farhan Ali'), tj: day(5), managerUserId: 'mgr' });
  await engine.setJourneyStatus(J8.id, 'offer_sent');
  await jobs.runLifecycleJobs(at(TODAY), { full: true, orgs: [ORG] });
  eq('Day-1 pass unlocked at Tj − 7 (Tj + 5 away)', byKey(await engine.tasksOf(J8.id), 'day1_pass').status, 'done');
  let extra = 0;
  jobs.registerLifecycleJob('check', async () => { extra += 1; });
  await jobs.runLifecycleJobs(at(TODAY), { full: false, orgs: [ORG] });
  eq('Another part’s job runs on the tick', extra, 1);

  // ───────────────────────────────────────────────────────── the switch
  section('Switch off: refused');
  eq('Tab rules: the board needs onboarding, templates their tab, /settings is open',
    [tabs.tabsForRequest('GET', '/admin/lifecycle/board'), tabs.tabsForRequest('PUT', '/admin/lifecycle/templates/x'), tabs.tabsForRequest('GET', '/admin/lifecycle/settings')], [['onboarding'], ['lifecycle_templates'], null]);
  await companies().updateOne({ id: ORG }, { $set: { 'features.lifecycle': false } });
  engine.forgetLifecycleFeature();
  eq('requireLifecycle: 404 Not available', await refusal(async () => engine.requireLifecycle(ORG)), { status: 404, message: 'Not available' });
  eq('GET /lifecycle/me: enabled false and nothing else', await app.lifecycleMe(ISHA), { enabled: false });
  const res = { code: 0, payload: undefined as unknown, status(c: number) { this.code = c; return this; }, json(p: unknown) { this.payload = p; return this; } };
  let passedOn = false;
  await routes.lifecycleGate({ auth: { user: { org: ORG } } } as unknown as Request, res as unknown as Response, () => { passedOn = true; });
  eq('The routes’ gate answers 404 { error: "Not available" }', [res.code, res.payload, passedOn], [404, { error: 'Not available' }, false]);
  const offRun = await jobs.runLifecycleJobs(at(day(1)), { full: true, orgs: [ORG] });
  eq('Jobs skip a company with the switch off', offRun.fired.length + offRun.meetings + offRun.reminded, 0);
  await companies().updateOne({ id: ORG }, { $set: { 'features.lifecycle': true } });
  engine.forgetLifecycleFeature();
  let on = false;
  await routes.lifecycleGate({ auth: { user: { org: ORG } } } as unknown as Request, res as unknown as Response, () => { on = true; });
  ok('Switched back on: the gate lets requests through', on);

  void journeys; void journeyTasks;
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.closeDb();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
