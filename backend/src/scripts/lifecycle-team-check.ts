/**
 * Teams › Joiners (services/lifecycle/teamTasks.ts) against its rules, in-process, on its own
 * scratch database: the one approver (the department head the company records, else the
 * manager's manager; everyone else up the line follows along read-only), the team rows as
 * template rows (seeded, HR-editable, never journey tasks, the migration adds them once), and
 * the manager's recommendation and the head of department's answer on the confirmation record
 * HR decides from, with HR told.
 *
 *   npm run lifecycle:team-check      (MONGODB_DB=el_journey_team_check; local mongod only)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
process.env.MONGODB_URI = process.env.LIFECYCLE_CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_journey_team_check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
function eq(label: string, got: unknown, want: unknown) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
async function refusal(work: () => Promise<unknown>): Promise<number | undefined> {
  try { await work(); return undefined; } catch (error) { return (error as { statusCode?: number }).statusCode; }
}
const section = (title: string) => console.log(`\n${title}`);
const ORG = 'el-team-check';

async function main() {
  if (!/^(mongodb:\/\/)(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:team-check runs on a local mongod only');
  if (!/^el_journey/.test(process.env.MONGODB_DB!)) throw new Error('lifecycle:team-check needs its own el_journey_* database');

  const { connectDb, getDb, closeDb, companies, users, journeys, journeyTasks, lifecycleTemplates, notifications } = await import('../config/db');
  const seed = await import('../services/lifecycle/seed');
  const templates = await import('../services/lifecycle/templates');
  const engine = await import('../services/lifecycle/engine');
  const team = await import('../services/lifecycle/teamTasks');
  const board = await import('../services/lifecycle/board');
  const rules = await import('../services/lifecycle/dueRules');

  await connectDb();
  await getDb().dropDatabase();

  await companies().insertOne({ id: ORG, name: 'Team Check Co', features: { lifecycle: true } } as never);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({ userId, name, email: `${userId}@check.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', ...extra });
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true }),
    person('ceo', 'Cyrus CEO', { role: 'manager' }),
    person('hod', 'Rahul Head', { role: 'manager', managerUserId: 'ceo' }),
    person('mgr', 'Sunny Manager', { role: 'manager', managerUserId: 'hod' }),
    person('buddy', 'Meera Buddy', { managerUserId: 'mgr' }),
    person('dh', 'Dina DeptHead', { role: 'manager', managerUserId: 'ceo' }),
    person('j1', 'Priya Joiner', { managerUserId: 'mgr', department: 'Admissions', hrPrimaryUserId: 'hr' }),
  ] as never[]);
  const me = (userId: string, name: string) => ({ userId, name, org: ORG });
  const MGR = me('mgr', 'Sunny Manager'), HOD = me('hod', 'Rahul Head'), CEO = me('ceo', 'Cyrus CEO'), BUDDY = me('buddy', 'Meera Buddy'), DH = me('dh', 'Dina DeptHead');

  // ───────────────────────────────────────────── template rows
  section('Team rows are template rows: seeded, editable, never journey tasks');
  const rows = seed.ONBOARDING_SEED.filter((t) => t.team);
  eq('Seed: 9 buddy · 2 head of department · 8 manager team rows', [rows.filter((t) => t.ownerRole === 'buddy').length, rows.filter((t) => t.ownerRole === 'head_of_department').length, rows.filter((t) => t.ownerRole === 'manager').length], [9, 2, 8]);
  ok('Seed: team keys are unique', new Set(rows.map((t) => t.team!.key)).size === rows.length);
  await templates.ensureDefaultTemplates(ORG);
  const def = await templates.defaultTemplate(ORG, 'onboarding');
  eq('The Default onboarding template lists them', def.tasks.filter((t) => t.team).length, rows.length);

  const tj = rules.addDaysKey(rules.todayKey(), -2);
  const J = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Priya Joiner', personalEmail: 'priya@check.test', phone: '9999999999' } as never, tj, managerUserId: 'mgr', department: 'Admissions' });
  await journeys().updateOne({ id: J.id }, { $set: { status: 'joined', userId: 'j1', buddyUserId: 'buddy' } });
  const jt = await journeyTasks().find({ journeyId: J.id }).toArray();
  ok('No journey task is made from a team row', jt.every((t) => !String(t.templateTaskId).startsWith('ob-team-')) && jt.length > 0, jt.length);

  // HR edits wording, timing and the switch.
  const edited = def.tasks.map((t) => (t.team?.key === 'buddy_show_around' ? { ...t, title: 'Walk {n} round the building' } : t.team?.key === 'buddy_policies' ? { ...t, enabled: false } : t));
  const saved = await templates.updateTemplate(ORG, def.id, { tasks: edited }, 'Hema HR');
  ok('Saving keeps each row’s team spec', saved.tasks.filter((t) => t.team).length === rows.length && saved.tasks.find((t) => t.team?.key === 'buddy_meet')?.team?.agenda?.length === 4);
  const buddyPage = await team.teamJoiner(BUDDY, J.id);
  ok('HR’s wording shows to the buddy', buddyPage.tasks.some((t) => t.title === 'Walk Priya round the building'), buddyPage.tasks.map((t) => t.title));
  ok('A row HR switched off is gone', !buddyPage.tasks.some((t) => t.id === 'buddy_policies'));
  eq('A buddy row on Day 1 sits on the Day 1 step', buddyPage.tasks.find((t) => t.id === 'buddy_meet')?.step, 1);
  eq('A buddy owner is accepted, an unknown one is refused', await refusal(() => templates.updateTemplate(ORG, def.id, { tasks: [...saved.tasks.map((t) => (t.team?.key === 'buddy_meet' ? { ...t, ownerRole: 'nobody' } : t))] })), 400);

  // A tick survives an edit (kept by team key).
  await team.teamTaskAction(BUDDY, J.id, 'buddy_meet', { action: 'done' });
  await templates.updateTemplate(ORG, def.id, { tasks: saved.tasks.map((t) => (t.team?.key === 'buddy_meet' ? { ...t, title: 'Say hello to {n}' } : t)) });
  ok('A tick stays when HR rewords the row', (await team.teamJoiner(BUDDY, J.id)).tasks.find((t) => t.id === 'buddy_meet')?.done === true);

  // The migration: an old template without team rows.
  await lifecycleTemplates().insertOne({ ...def, id: 'old-tpl', name: 'Old', isDefault: false, tasks: def.tasks.filter((t) => !t.team) } as never);
  const dry = await templates.addTeamRowsToTemplates({ apply: false, org: ORG });
  eq('Migration dry run: lists the old template only, writes nothing', [dry.map((d) => d.templateId), (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length], [['old-tpl'], 0]);
  await templates.addTeamRowsToTemplates({ apply: true, org: ORG });
  eq('Migration --apply: adds every team row', (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length, rows.length);
  eq('Migration again: nothing to add', (await templates.addTeamRowsToTemplates({ apply: true, org: ORG })).length, 0);
  eq('…and no duplicates', (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length, rows.length);

  // ───────────────────────────────────────────── the one approver
  section('One approver: the department head, else the manager’s manager');
  eq('No department head recorded: the manager’s manager', await team.approverOf(await engine.loadJourney(J.id)), 'hod');
  const hodPage = await team.teamJoiner(HOD, J.id);
  ok('The head of department gets Meet and Approve', hodPage.relation === 'line' && !hodPage.readOnly && hodPage.tasks.some((t) => t.id === 'hod_approve') && hodPage.approverIsYou, hodPage);
  const ceoPage = await team.teamJoiner(CEO, J.id);
  ok('Further up the line: read-only, no tasks, the approver named', ceoPage.readOnly && ceoPage.tasks.length === 0 && ceoPage.approverName === 'Rahul Head', ceoPage);
  eq('…and cannot approve', await refusal(() => team.answerApproval(CEO, J.id, { action: 'approve' })), 403);
  eq('The manager sees who approves', (await team.teamJoiner(MGR, J.id)).approverName, 'Rahul Head');

  await companies().updateOne({ id: ORG }, { $set: { departmentHeads: [{ department: 'admissions', userId: 'dh' }] } });
  eq('A department head recorded: they approve', await team.approverOf(await engine.loadJourney(J.id)), 'dh');
  ok('The department head lists the joiner though outside the tree', (await team.teamJoiners(DH)).joiners.some((r) => r.journeyId === J.id && r.approverIsYou));
  ok('The manager’s manager now follows along read-only', (await team.teamJoiner(HOD, J.id)).readOnly === true);
  await companies().updateOne({ id: ORG }, { $set: { departmentHeads: [{ department: 'Admissions', userId: 'mgr' }] } });
  eq('A department head who is the manager: the manager’s manager instead', await team.approverOf(await engine.loadJourney(J.id)), 'hod');
  await companies().updateOne({ id: ORG }, { $unset: { departmentHeads: '' } });

  // ───────────────────────────────────────────── recommendation → approval → HR
  section('The recommendation and the approval reach HR’s decision');
  eq('Approving before the manager recommends is refused', await refusal(() => team.answerApproval(HOD, J.id, { action: 'approve' })), 409);
  await team.teamTaskAction(MGR, J.id, 'mgr_recommend', { action: 'recommend', outcome: 'confirm', note: 'Ready to confirm' });
  let j = await engine.loadJourney(J.id);
  eq('The recommendation is on the confirmation record', [j.probation?.recommendation?.outcome, j.probation?.recommendation?.byName, j.probation?.recommendation?.note], ['confirm', 'Sunny Manager', 'Ready to confirm']);
  eq('The head of department sees it ready', (await team.teamApproval(HOD, J.id)).state, 'ready');
  await team.answerApproval(HOD, J.id, { action: 'discuss', comment: 'Talk about the Pune targets' });
  j = await engine.loadJourney(J.id);
  eq('Asked to discuss: on the record with the comment', [j.probation?.hodApproval?.outcome, j.probation?.hodApproval?.comment], ['discuss', 'Talk about the Pune targets']);
  await team.teamTaskAction(MGR, J.id, 'mgr_recommend', { action: 'recommend', outcome: 'confirm' });
  ok('A new recommendation reopens the answer', !(await engine.loadJourney(J.id)).probation?.hodApproval);
  const before = await notifications().countDocuments({ userId: 'hr', scenario: 'lifecycle_confirmation_window_hr' });
  await team.answerApproval(HOD, J.id, { action: 'approve', comment: 'Agreed' });
  j = await engine.loadJourney(J.id);
  eq('Approved: by whom, on the record', [j.probation?.hodApproval?.outcome, j.probation?.hodApproval?.byName], ['approved', 'Rahul Head']);
  ok('HR gets no app push when the approval lands (the dashboard shows it)', (await notifications().countDocuments({ userId: 'hr', scenario: 'lifecycle_confirmation_window_hr' })) === before);
  eq('Approving twice is refused', await refusal(() => team.answerApproval(HOD, J.id, { action: 'approve' })), 409);
  const panel = await board.journeyPanel(ORG, J.id);
  eq('HR’s panel shows the recommendation and the approval', [panel.probation.recommendation?.outcome, panel.probation.recommendation?.byName, panel.probation.hodApproval?.outcome, panel.probation.hodApproval?.byName], ['confirm', 'Sunny Manager', 'approved', 'Rahul Head']);
  ok('The approval row reads Approved for the head of department', (await team.teamJoiner(HOD, J.id)).tasks.find((t) => t.id === 'hod_approve')?.reviewState === 'reviewed');

  // ───────────────────────────────────────────── the manager's page (MgrTeamsProto, 20 Nov)
  section('The manager’s page: journey rows open their screens; the self check-in review; View progress');
  const probation = await import('../services/lifecycle/probation');
  const app = await import('../services/lifecycle/appOnboarding');
  let mgrPage = await team.teamJoiner(MGR, J.id);
  const meet = mgrPage.tasks.find((t) => t.systemKey === 'meet_manager');
  ok('Meet the joiner: a meeting with its agenda', meet?.opens === 'meeting' && (meet.agenda?.length ?? 0) === 4, meet);
  ok('Screen steps open their screen, never a bare tick', mgrPage.tasks.filter((t) => t.systemKey === 'starter_task' || t.systemKey === 'probation_goals').every((t) => t.opens === 'screen' && !t.canTick));
  const review1 = () => team.teamJoiner(MGR, J.id).then((p) => p.tasks.find((t) => t.systemKey === 'monthly_review' && t.month === 1));
  eq('Month 1’s review waits for the joiner', [(await review1())?.opens, (await review1())?.reviewState], ['review', 'waiting']);
  const home = await app.onboardingHome({ userId: 'j1', name: 'Priya Joiner', org: ORG });
  eq('View progress is the joiner’s own home (same rows, same tour, same devices)', [mgrPage.progress.today.length, mgrPage.progress.later.length, mgrPage.progress.done.length, mgrPage.progress.devices.length], [home.today.length, home.later.length, home.done.length, home.devices.length]);
  ok('…without the meetings’ details or the notes', [...mgrPage.progress.today, ...mgrPage.progress.done].every((t) => !('meeting' in t) && !('note' in t)));
  // Open month 1's check-in (it opens near the month's end) and let the joiner send theirs.
  const checkin = (await journeyTasks().find({ journeyId: J.id, systemKey: 'monthly_checkin', month: 1 }).toArray())[0];
  // (A save re-reads the rules and closes it again before its day: open it before each step here.)
  const openCheckin = () => journeyTasks().updateOne({ id: checkin.id, status: 'locked' }, { $set: { status: 'todo' } });
  await openCheckin();
  const JOINER = { userId: 'j1', name: 'Priya Joiner' };
  await probation.checkinByJoiner(J.id, JOINER, 1, { rating: 3, win: 'Ran my first webinar', ask: 'Time with Finance' });
  eq('Sent: ready to review', (await review1())?.reviewState, 'ready');
  const told = await notifications().countDocuments({ userId: 'j1', scenario: 'lifecycle_monthly_review' });
  await probation.updateMonthByManager(J.id, MGR, 1, { sendBack: { text: 'Add your goals' } });
  eq('Send back: the row reads Sent back', (await review1())?.reviewState, 'back');
  ok('…and the joiner is told', (await notifications().countDocuments({ userId: 'j1', scenario: 'lifecycle_monthly_review' })) === told + 1);
  await new Promise((r) => setTimeout(r, 5));
  await openCheckin();
  await probation.checkinByJoiner(J.id, JOINER, 1, { rating: 3, win: 'Ran two webinars', ask: 'Time with Finance' });
  eq('Sent again: ready again', (await review1())?.reviewState, 'ready');
  await openCheckin();
  mgrPage = await team.teamJoiner(MGR, J.id);
  const check1 = mgrPage.tasks.find((t) => t.systemKey === 'monthly_checkin' && t.month === 1);
  ok('The month’s check-in is a meeting the manager can mark done', check1?.opens === 'meeting' && check1.canTick === true, check1);
  await openCheckin();
  await team.teamTaskAction(MGR, J.id, check1!.id, { action: 'done', notes: 'Webinars went well' });
  let months = (await probation.probationOf(J.id)).months;
  eq('Marked done: the notes are the manager’s side of the check-in', months[0].checkinManager?.text, 'Webinars went well');
  ok('…and the row is done', (await team.teamJoiner(MGR, J.id)).tasks.find((t) => t.id === check1!.id)?.done === true);
  const reviewTask = (await journeyTasks().find({ journeyId: J.id, systemKey: 'monthly_review', month: 1 }).toArray())[0];
  await journeyTasks().updateOne({ id: reviewTask.id, status: 'locked' }, { $set: { status: 'todo' } });
  await probation.updateMonthByManager(J.id, MGR, 1, { review: { text: '', reviewed: true } });
  months = (await probation.probationOf(J.id)).months;
  ok('Mark as reviewed without comments: the month is reviewed (HR’s probation panel reads it)', !!months[0].review, months[0].review);
  eq('…the row reads Reviewed', (await review1())?.reviewState, 'reviewed');
  eq('Sending back a reviewed month is refused', await refusal(() => probation.updateMonthByManager(J.id, MGR, 1, { sendBack: {} })), 409);

  const hrPanel = await board.journeyPanel(ORG, J.id);
  ok('HR’s joiner panel lists the team rows as the app ticked them', hrPanel.teamRows.some((r) => r.id === 'buddy_meet' && r.done && r.owner === 'buddy') && hrPanel.teamRows.some((r) => r.id === 'mgr_plan_week' && !r.done), hrPanel.teamRows.slice(0, 3));

  await getDb().dropDatabase();
  await closeDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
