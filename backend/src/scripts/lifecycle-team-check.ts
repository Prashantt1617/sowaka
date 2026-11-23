/**
 * The team side (services/lifecycle/teamTasks.ts, teamApp.ts, teamNewJoiners.ts) against its rules,
 * in-process, on its own scratch database: the team rows as template rows (seeded, HR-editable, never
 * journey tasks, the migration adds them once, HR's panel reads them); one joiners list (Teams › New
 * joiners) for the manager, the buddy and the head of department, with no task pages for them any more
 * (24 Nov: HR assigns every onboarding task); the one approver (the department head the company records,
 * else the manager's manager); and the manager's confirmation review and the head of department's answer,
 * reached from an Actions card, on the confirmation record HR decides from. No set-up pushes to the team.
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
  const teamApp = await import('../services/lifecycle/teamApp');
  const newJoiners = await import('../services/lifecycle/teamNewJoiners');
  const readCache = await import('../services/lifecycle/readCache');
  const app = await import('../services/lifecycle/appOnboarding');
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

  // HR edits wording, timing and the switch; HR's panel follows (the buddy has no task page in the app any more).
  const edited = def.tasks.map((t) => (t.team?.key === 'buddy_show_around' ? { ...t, title: 'Walk {n} round the building' } : t.team?.key === 'buddy_policies' ? { ...t, enabled: false } : t));
  const saved = await templates.updateTemplate(ORG, def.id, { tasks: edited }, 'Hema HR');
  ok('Saving keeps each row’s team spec', saved.tasks.filter((t) => t.team).length === rows.length && saved.tasks.find((t) => t.team?.key === 'buddy_meet')?.team?.agenda?.length === 4);
  const hrRows = async () => team.teamRowsForHr(await engine.loadJourney(J.id));
  ok('HR’s wording shows on HR’s panel', (await hrRows()).some((t) => t.title === 'Walk Priya round the building'), (await hrRows()).map((t) => t.title));
  ok('A row HR switched off is gone', !(await hrRows()).some((t) => t.id === 'buddy_policies'));
  eq('A buddy row on Day 1 sits on the Day 1 step', (await hrRows()).find((t) => t.id === 'buddy_meet')?.step, 'Day 1');
  eq('A buddy owner is accepted, an unknown one is refused', await refusal(() => templates.updateTemplate(ORG, def.id, { tasks: [...saved.tasks.map((t) => (t.team?.key === 'buddy_meet' ? { ...t, ownerRole: 'nobody' } : t))] })), 400);

  // A tick survives an edit (kept by team key).
  await team.setTick(J, 'buddy_meet', { doneAt: new Date(), byUserId: 'buddy', byName: 'Meera Buddy' });
  await templates.updateTemplate(ORG, def.id, { tasks: saved.tasks.map((t) => (t.team?.key === 'buddy_meet' ? { ...t, title: 'Say hello to {n}' } : t)) });
  ok('A tick stays when HR rewords the row', (await hrRows()).find((t) => t.id === 'buddy_meet')?.done === true);

  // The migration: an old template without team rows.
  await lifecycleTemplates().insertOne({ ...def, id: 'old-tpl', name: 'Old', isDefault: false, tasks: def.tasks.filter((t) => !t.team) } as never);
  const dry = await templates.addTeamRowsToTemplates({ apply: false, org: ORG });
  eq('Migration dry run: lists the old template only, writes nothing', [dry.map((d) => d.templateId), (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length], [['old-tpl'], 0]);
  await templates.addTeamRowsToTemplates({ apply: true, org: ORG });
  eq('Migration --apply: adds every team row', (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length, rows.length);
  eq('Migration again: nothing to add', (await templates.addTeamRowsToTemplates({ apply: true, org: ORG })).length, 0);
  eq('…and no duplicates', (await templates.getTemplate(ORG, 'old-tpl')).tasks.filter((t) => t.team).length, rows.length);

  // ───────────────────────────────────────────── one joiners list, no task pages
  section('Teams › New joiners is the one joiners list: the manager, the buddy and the head of department see the joiner there');
  const listed = async (who: { userId: string; name: string; org: string }) => (await newJoiners.newJoinersForTeammate(who)).joiners.find((c) => c.journeyId === J.id);
  eq('The manager: listed as their manager', (await listed(MGR))?.relation, 'manager');
  eq('The buddy: listed as their buddy', (await listed(BUDDY))?.relation, 'buddy');
  eq('The head of department (the manager’s manager): listed', (await listed(HOD))?.relation, 'head');
  eq('Further up the line, outside the department: not listed', await listed(CEO), undefined);
  eq('The card opens the joiner’s profile', (await listed(MGR))?.userId, 'j1');
  ok('The old task routes are gone (no teamJoiners / teamJoiner / teamTaskAction / answerApproval)', !('teamJoiners' in team) && !('teamJoiner' in team) && !('teamTaskAction' in team) && !('answerApproval' in team));

  // ───────────────────────────────────────────── the one approver
  section('One approver: the department head, else the manager’s manager');
  eq('No department head recorded: the manager’s manager', await team.approverOf(await engine.loadJourney(J.id)), 'hod');
  await companies().updateOne({ id: ORG }, { $set: { departmentHeads: [{ department: 'admissions', userId: 'dh' }] } });
  eq('A department head recorded: they approve', await team.approverOf(await engine.loadJourney(J.id)), 'dh');
  readCache.forgetLifecycleReads(null);
  eq('…and they see the joiner under New joiners though outside the tree', (await listed(DH))?.relation, 'head');
  await companies().updateOne({ id: ORG }, { $set: { departmentHeads: [{ department: 'Admissions', userId: 'mgr' }] } });
  eq('A department head who is the manager: the manager’s manager instead', await team.approverOf(await engine.loadJourney(J.id)), 'hod');
  await companies().updateOne({ id: ORG }, { $unset: { departmentHeads: '' } });
  readCache.forgetLifecycleReads(null);

  // ───────────────────────────────────────────── recommendation → approval → HR
  section('The confirmation review and the approval reach HR’s decision (reached from an Actions card)');
  const noneYet = await teamApp.confirmationsFor(MGR);
  eq('Before the final month: no review waits on the manager', noneYet.length, 0);
  // Into the final month of a six-month probation: Tj about five and a half months back.
  await journeys().updateOne({ id: J.id }, { $set: { tj: rules.addDaysKey(rules.todayKey(), -165) } });
  const waiting = await teamApp.confirmationsFor(MGR);
  eq('Final month: "Confirmation review for Priya" waits on the manager', waiting.map((c) => [c.kind, c.title]), [['review', 'Confirmation review for Priya']]);
  eq('…and on /lifecycle/me', ((await app.lifecycleMe(MGR)) as { confirmations?: unknown[] }).confirmations?.length, 1);
  eq('Nothing for the head of department yet', (await teamApp.confirmationsFor(HOD)).length, 0);
  eq('Approving before the manager recommends is refused', await refusal(() => teamApp.answerApprovalV2(HOD, J.id, { action: 'approve' })), 409);
  eq('Someone else up the line cannot review', await refusal(() => teamApp.reviewView(CEO, J.id)), 403);
  const reviewed = await teamApp.sendReview(MGR, J.id, { outcome: 'confirm', kpis: 'Met them', strengths: 'Calm', next: 'Reports' });
  ok('Sent: the review answers with the joiner and what was sent', reviewed.joiner.name === 'Priya Joiner' && reviewed.sent?.outcome === 'confirm', reviewed);
  let j = await engine.loadJourney(J.id);
  eq('The recommendation is on the confirmation record', [j.probation?.recommendation?.outcome, j.probation?.recommendation?.byName], ['confirm', 'Sunny Manager']);
  eq('…the manager’s card goes', (await teamApp.confirmationsFor(MGR)).length, 0);
  eq('…and the head of department’s comes: "Approve Priya’s confirmation"', (await teamApp.confirmationsFor(HOD)).map((c) => [c.kind, c.title]), [['approval', 'Approve Priya’s confirmation']]);
  const hodPush = await notifications().findOne({ userId: 'hod', scenario: 'lifecycle_confirmation_review' });
  eq('The head of department’s push opens the approval', (hodPush as unknown as { data?: Record<string, string> })?.data?.destination, 'lifecycle_confirmation_approval');
  eq('The head of department sees it ready, with the joiner', [(await teamApp.approvalViewV2(HOD, J.id)).state, (await teamApp.approvalViewV2(HOD, J.id)).joiner.first], ['ready', 'Priya']);
  eq('The manager cannot approve', await refusal(() => teamApp.answerApprovalV2(MGR, J.id, { action: 'approve' })), 403);
  const before = await notifications().countDocuments({ userId: 'hr', scenario: 'lifecycle_confirmation_window_hr' });
  await teamApp.answerApprovalV2(HOD, J.id, { action: 'approve', comment: 'Agreed' });
  j = await engine.loadJourney(J.id);
  eq('Approved: by whom, on the record', [j.probation?.hodApproval?.outcome, j.probation?.hodApproval?.byName], ['approved', 'Rahul Head']);
  ok('HR gets no app push when the approval lands (the dashboard shows it)', (await notifications().countDocuments({ userId: 'hr', scenario: 'lifecycle_confirmation_window_hr' })) === before);
  const mgrPush = await notifications().findOne({ userId: 'mgr', scenario: 'lifecycle_confirmation_window_hr' });
  eq('The manager hears, and the push opens their review', (mgrPush as unknown as { data?: Record<string, string> })?.data?.destination, 'lifecycle_confirmation_review');
  eq('…the head of department’s card goes', (await teamApp.confirmationsFor(HOD)).length, 0);
  eq('Approving twice is refused', await refusal(() => teamApp.answerApprovalV2(HOD, J.id, { action: 'approve' })), 409);
  const panel = await board.journeyPanel(ORG, J.id);
  eq('HR’s panel shows the recommendation and the approval', [panel.probation.recommendation?.outcome, panel.probation.recommendation?.byName, panel.probation.hodApproval?.outcome, panel.probation.hodApproval?.byName], ['confirm', 'Sunny Manager', 'approved', 'Rahul Head']);
  ok('HR’s joiner panel lists the team rows (the approval done)', panel.teamRows.some((r) => r.id === 'hod_approve' && r.done) && panel.teamRows.some((r) => r.id === 'buddy_meet' && r.done && r.owner === 'buddy') && panel.teamRows.some((r) => r.id === 'mgr_plan_week' && !r.done), panel.teamRows.slice(0, 3));

  // ───────────────────────────────────────────── no set-up pushes to the team
  section('No onboarding set-up pushes to the manager, the buddy or the head of department');
  const teamPushes = await notifications().find({ userId: { $in: ['mgr', 'buddy', 'hod', 'dh', 'ceo'] } }).toArray();
  const setUp = teamPushes.filter((n) => ['lifecycle_joiner_setup', 'lifecycle_task_overdue', 'lifecycle_due_changed', 'lifecycle_goals_reminder', 'lifecycle_checkin_sent', 'lifecycle_week_done', 'lifecycle_team_task_late'].includes(String(n.scenario)));
  eq('None of the set-up scenarios reached them', setUp.map((n) => n.scenario), []);
  const oldDestinations = teamPushes.filter((n) => ['lifecycle_joiner', 'lifecycle_joiner_setup', 'lifecycle_probation_review', 'lifecycle_starter_task_done'].includes(String((n as unknown as { data?: Record<string, string> }).data?.destination)));
  eq('No push opens the old team page', oldDestinations.map((n) => n.scenario), []);

  await getDb().dropDatabase();
  await closeDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
