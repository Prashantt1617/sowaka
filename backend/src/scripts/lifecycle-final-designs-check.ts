/**
 * Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md) against their rules, in-process, on
 * its own scratch database: the seed is the canvas's, the editor's design view saves and validates,
 * stages place rows, and every surface reads the same tick — the joiner, the manager, the buddy,
 * the head of department, HR and IT & admin. Also the migration of an older template and an older
 * journey still reading, and the kept templates dropped by a save.
 *
 *   npm run lifecycle:final-designs-check   (MONGODB_DB=el_final_designs_check; local mongod only)
 */
process.env.MONGODB_URI = process.env.LIFECYCLE_CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_final_designs_check';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); }
}
function eq(label: string, got: unknown, want: unknown) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
async function refusal(work: () => Promise<unknown>): Promise<number | undefined> {
  try { await work(); return undefined; } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1; }
}
const section = (title: string) => console.log(`\n${title}`);
const ORG = 'el-fd-check';

async function main() {
  if (!/^(mongodb:\/\/)(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:final-designs-check runs on a local mongod only');
  if (!/^el_final_designs/.test(process.env.MONGODB_DB!)) throw new Error('lifecycle:final-designs-check needs its own el_final_designs_* database');

  const { connectDb, getDb, closeDb, companies, users, journeys, journeyTasks, lifecycleTemplates, policyDocuments } = await import('../config/db');
  const designSeed = await import('../services/lifecycle/designSeed');
  const seed = await import('../services/lifecycle/seed');
  const templates = await import('../services/lifecycle/templates');
  const design = await import('../services/lifecycle/design');
  const engine = await import('../services/lifecycle/engine');
  const rules = await import('../services/lifecycle/dueRules');
  const joiner = await import('../services/lifecycle/joinerApp');
  const meetings = await import('../services/lifecycle/joinerMeetings');
  const team = await import('../services/lifecycle/teamApp');
  const oldTeam = await import('../services/lifecycle/teamTasks');
  const staff = await import('../services/lifecycle/staffApp');
  const probation = await import('../services/lifecycle/probation');
  const migrate = await import('../services/lifecycle/designMigrate');
  const app = await import('../services/lifecycle/appOnboarding');
  const readCache = await import('../services/lifecycle/readCache');

  await connectDb();
  await getDb().dropDatabase();
  await getDb().collection('lifecycle_checkin_answers').createIndex({ journeyId: 1, checkinId: 1 }, { unique: true });

  await companies().insertOne({ id: ORG, name: 'Sowaka Test', features: { lifecycle: true } } as never);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({ userId, name, email: `${userId}@check.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', ...extra });
  await users().insertMany([
    person('hr', 'Ritu Sharma', { dashboardAccess: true }),
    person('it', 'Imran Khan'),
    person('ceo', 'Neha Verma', { role: 'manager' }),
    person('hod', 'Anita Desai', { role: 'manager', managerUserId: 'ceo' }),
    person('mgr', 'Sunny Kapoor', { role: 'manager', managerUserId: 'hod', department: 'Operations' }),
    person('meera', 'Meera Joshi', { role: 'manager', managerUserId: 'hod', department: 'Operations', designation: 'Senior counsellor' }),
    person('rohan', 'Rohan Das', { managerUserId: 'mgr', department: 'Operations', designation: 'Senior operations executive' }),
    person('j1', 'Priya Shah', { managerUserId: 'mgr', department: 'Operations', hrPrimaryUserId: 'hr', phone: '9876543210' }),
    person('j2', 'Sana Khan', { managerUserId: 'meera', department: 'Operations', hrPrimaryUserId: 'hr' }),
  ] as never[]);
  const me = (userId: string, name: string) => ({ userId, name, org: ORG });
  const HR = me('hr', 'Ritu Sharma'), IT = me('it', 'Imran Khan'), MGR = me('mgr', 'Sunny Kapoor'), MEERA = me('meera', 'Meera Joshi'), HOD = me('hod', 'Anita Desai');
  const PRIYA = me('j1', 'Priya Shah'), SANA = me('j2', 'Sana Khan');

  // ───────────────────────────────────────────── seed
  section('The Standard template is the canvas’s');
  const rows = designSeed.finalDesignRows('Sowaka Test');
  const count = (s: string) => rows.filter((r) => r.design?.section === s).length;
  eq('53 items: 10 meetings, 10 tasks, 3 check-ins, 6 watch (2 before joining), 2 trainings, 4 accesses, 18 teammate rows',
    [rows.length, count('meeting'), count('task'), count('checkin'), count('watch'), count('training'), count('access'), count('team')], [53, 10, 10, 3, 6, 2, 4, 18]);
  eq('In the canvas’s order', rows.slice(0, 4).map((r) => r.title), ['Sign your joining documents', 'Welcome from HR', 'Meet the team', 'Assign a buddy']);
  ok('Team keys are unique', new Set(rows.filter((r) => r.team).map((r) => r.team!.key)).size === rows.filter((r) => r.team).length);
  eq('Welcome and documents names the company', rows.find((r) => r.title === 'Welcome and documents')?.agenda?.[0], 'Welcome to Sowaka Test and a quick office round');
  eq('Week 1 check-in: 9 questions, rating / yes-no / long', rows.find((r) => r.title === 'Week 1 check-in')?.design?.questions?.map((q) => q.type[0]).join(''), 'ryyyyyyrl');
  await templates.ensureDefaultTemplates(ORG);
  const def = await templates.defaultTemplate(ORG, 'onboarding');
  ok('A new company’s Standard onboarding is the Final designs', def.tasks.filter((t) => t.design).length === 53 && def.settings.signLettersOnDay1 === true, def.tasks.length);
  ok('…with the pre-boarding machinery kept (offer, portal, Mark joined)', ['send_offer', 'finalise_offer', 'mark_joined', 'confirmation_discussion'].every((k) => def.tasks.some((t) => t.systemKey === k)));
  ok('…and none of the rows the designs replace', !def.tasks.some((t) => t.systemKey === 'week1_reels' || t.team?.key === 'buddy_meet'));

  // ───────────────────────────────────────────── the editor's design view
  section('The editor: GET / PUT design, validation');
  const view = await design.templateDesign(ORG, def.id);
  eq('Design view: counts per tab', [view.preboarding.videos.length, view.meetings.length, view.tasks.length, view.checkins.length, view.watch.length, view.trainings.length, view.accesses.length, view.team.tasks.length, view.tour.length, view.probation.months, view.team.remindLate],
    [2, 10, 10, 3, 4, 2, 4, 18, 6, 6, true]);
  eq('Tasks group by kind (Do in Sowaka, Review, Read and acknowledge, Sign, More tasks)', ['do', 'review', 'ack', 'sign', 'other'].map((k) => view.tasks.filter((t) => t.type === k).length), [4, 3, 1, 1, 1]);
  await users().updateOne({ userId: 'it' }, { $set: { org: ORG } });
  const saved = await design.saveTemplateDesign(ORG, def.id, {
    ...view,
    meetings: view.meetings.map((m) => (m.title === 'First goals' ? { ...m, agenda: [...m.agenda, 'Your questions'] } : m)),
    team: { ...view.team, assignees: { hrUserId: 'hr', itUserId: 'it' }, tasks: [...view.team.tasks, { title: 'Take them for lunch on Day 1', role: 'buddy', stage: 'd1', how: 'The canteen on floor 2' }] },
    preboarding: { ...view.preboarding, reporting: { time: '9:30 AM', place: 'Reception, Pune office', meets: 'hr' } },
  } as never, 'Ritu Sharma');
  ok('Saved: an agenda point, a buddy task with its how-to, the assignees, the reporting details',
    saved.meetings.find((m) => m.title === 'First goals')?.agenda.length === 6 && saved.team.tasks.some((t) => t.title === 'Take them for lunch on Day 1' && t.how === 'The canteen on floor 2' && t.key.startsWith('custom_'))
    && saved.team.assignees.itUserId === 'it' && saved.preboarding.reporting.place === 'Reception, Pune office', saved.team);
  ok('Ids and team keys are kept on a save (ticks stay with them)', saved.team.tasks.find((t) => t.key === 'mgr_assign_buddy')?.id === view.team.tasks.find((t) => t.key === 'mgr_assign_buddy')?.id);
  const afterSave = await templates.getTemplate(ORG, def.id);
  ok('Rows the editor does not draw stay (machinery)', afterSave.tasks.some((t) => t.systemKey === 'send_offer') && afterSave.tasks.some((t) => t.systemKey === 'sign_letters' && !!t.design));
  eq('A stage outside the list is refused', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...saved, meetings: [{ title: 'X', meetWith: 'hr', stage: 'month9', agenda: [] }] } as never)), 400);
  eq('An http:// link is refused (https only)', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...saved, tasks: [...saved.tasks, { title: 'Form', type: 'other', stage: 'w1', link: 'http://x.test' }] } as never)), 400);
  eq('Another company’s file is refused', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...saved, watch: [{ title: 'V', stage: 'd1', media: { type: 'video', fileId: 'nope' } }] } as never)), 400);
  eq('A new Sign row is refused (only the template’s own)', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...saved, tasks: [...saved.tasks, { title: 'Sign more', type: 'sign', stage: 'd1' }] } as never)), 400);
  eq('An assignee who does not work here is refused', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...saved, team: { ...saved.team, assignees: { hrUserId: 'ghost' } } } as never)), 400);
  const preview = await design.templatePreview(ORG, def.id, 'pre') as Record<string, unknown>;
  ok('Employee preview before joining: joining details, offer letter, profile, watch list', preview.header === 'Welcome' && !!preview.joining && preview.offerLetter === true, preview);
  const previewD1 = await design.templatePreview(ORG, def.id, 'd1') as { tasks: { count: number }; devices: { count: number } | null };
  eq('Employee preview Day 1: 4 tasks, 4 devices', [previewD1.tasks.count, previewD1.devices?.count], [4, 4]);

  // ───────────────────────────────────────────── journeys
  const today = rules.todayKey();
  const mk = async (userId: string, name: string, managerUserId: string, tj: string, buddy?: string) => {
    const J = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name, personalEmail: `${userId}@mail.test`, phone: '9999999999' } as never, tj, managerUserId, department: 'Operations' });
    await journeys().updateOne({ id: J.id }, { $set: { status: 'joined', userId, 'anchors.finalised': new Date(Date.parse(`${tj}T00:00:00Z`) - 10 * 86_400_000), ...(buddy ? { buddyUserId: buddy } : {}) } });
    await engine.refreshJourney(J.id);
    return J.id;
  };
  const J1 = await mk('j1', 'Priya Shah', 'mgr', rules.addDaysKey(today, -5), 'meera');   // Week 1, check-in open
  const J2 = await mk('j2', 'Sana Khan', 'meera', rules.addDaysKey(today, -40));            // Month 2

  section('Rows become journey tasks only for tasks and accesses');
  const jt = await journeyTasks().find({ journeyId: J1 }).toArray();
  const snapshotDesign = new Map(def.tasks.filter((t) => t.design).map((t) => [t.id, t.design!.section]));
  const made = jt.map((t) => snapshotDesign.get(t.templateTaskId)).filter(Boolean);
  eq('10 tasks + 4 accesses; no meeting, check-in, watch item or teammate row', [made.filter((s) => s === 'task').length, made.filter((s) => s === 'access').length, made.filter((s) => s !== 'task' && s !== 'access').length], [10, 4, 0]);

  // ───────────────────────────────────────────── the joiner
  section('The joiner’s onboarding (Week 1)');
  let home = await joiner.joinerOnboarding(PRIYA);
  eq('Week 1: step, hero, the strip from Day 1 to Confirmed', [home.step, home.hero.label, home.steps.length, home.steps[0].state, home.steps[1].state], ['w1', 'Week 1', 9, 'done', 'current']);
  const welcome = home.meetings.find((m) => m.title === 'Welcome and documents')!;
  ok('A Day-1 meeting not met is carried ("From Day 1"), with HR as the person', welcome.carriedFrom === 'd1' && welcome.person?.name === 'Ritu Sharma' && welcome.roleLabel === 'HR', welcome);
  const monthly = home.meetings.filter((m) => m.title === 'Monthly goals');
  ok('Monthly goals: one per month, the first locked "Opens in Month 1"', monthly.length === 6 && monthly[0].locked && monthly[0].everyMonth && !!monthly[0].opensOn, monthly[0]);
  eq('Tasks end in their verb', home.tasks.map((t) => t.verb).sort().join(','), 'Open,Read,Review,Review,Review,Sign,Start,Start,Start,Start');
  const w1 = home.checkins.find((c) => c.title === 'Week 1 check-in')!;
  eq('Week 1 check-in is open (2 days before the end of Week 1); the others locked', [w1.state, home.checkins.filter((c) => c.state === 'locked').length, home.summary.checkinDue?.title], ['open', 2, 'Week 1 check-in']);
  eq('Watch list: pre-boarding videos show from Day 1, trainings apart', [home.watch.length, home.trainings.length, home.watch[0].step], [6, 2, 'd1']);
  eq('Devices and accesses: 4, none ready', [home.devices.length, home.summary.devices.ready], [4, 0]);
  eq('Tour: 4 lessons (no reports), today is Punch in and out', [home.tour.lessons.length, home.tour.today], [4, 'punch']);

  const portal = await import('../services/lifecycle/portal');
  const pass = await portal.portalPass(await engine.loadJourney(J1), new Date(), { anyDay: true });
  eq('The portal’s Day-1 pass reads the template’s joining and reporting details (who meets them: HR)', [pass.reportingTime, pass.place, pass.askFor?.name], ['9:30 AM', 'Reception, Pune office', 'Ritu Sharma']);

  section('Meetings: one tick, read by both sides');
  await meetings.markMeetingRowMet(PRIYA, await engine.loadJourney(J1), welcome.id, { action: 'met' });
  home = await joiner.joinerOnboarding(PRIYA);
  ok('The joiner sees it met', home.meetings.find((m) => m.id === welcome.id)?.met === true);
  let hrPage = await staff.staffJoinerPage(HR, J1);
  ok('…and HR sees the same row done', hrPage.tasks.find((t) => t.id === 'hr_welcome')?.done === true, hrPage.tasks.map((t) => [t.id, t.done]));
  await meetings.markMeetingRowMet(PRIYA, await engine.loadJourney(J1), welcome.id, { action: 'unmet' });
  ok('Unticked by the joiner: undone for HR too', (await staff.staffJoinerPage(HR, J1)).tasks.find((t) => t.id === 'hr_welcome')?.done === false);
  const j1Now = await engine.loadJourney(J1);
  eq('A locked meeting cannot be marked met', await refusal(() => meetings.markMeetingRowMet(PRIYA, j1Now, monthly[0].id, { action: 'met' })), 409);
  await meetings.saveMeetingRowNotes(PRIYA, await engine.loadJourney(J1), welcome.id, { notes: ['Bring the PAN card'] });
  ok('Own notes come back to the joiner only', (await joiner.joinerOnboarding(PRIYA)).meetings.find((m) => m.id === welcome.id)?.notes[0] === 'Bring the PAN card');

  section('Tasks');
  const review = home.tasks.find((t) => t.title === 'Review your shift details')!;
  await joiner.joinerTaskAction(PRIYA, review.id, { action: 'looks_good' });
  home = await joiner.joinerOnboarding(PRIYA);
  eq('Review → Looks good: done', home.tasks.find((t) => t.id === review.id)?.state, 'done');
  const policies = home.tasks.find((t) => t.title === 'Acknowledge company policies')!;
  eq('Policies tick from App policies, not a tap', await refusal(() => joiner.joinerTaskAction(PRIYA, policies.id, { action: 'acknowledged' })), 409);
  ok('No required policy: Acknowledge company policies ticks itself', policies.state === 'done', policies);
  await policyDocuments().insertOne({ id: 'pol1', org: ORG, title: 'Code of conduct', active: true, ackRequired: true, version: '2', order: 1, createdAt: new Date() } as never);
  const firstPunch = home.tasks.find((t) => t.title === 'First punch-in')!;
  eq('First punch-in waits for the punch (Start)', [firstPunch.state, firstPunch.verb, (firstPunch.opens as { screen?: string }).screen], ['todo', 'Start', 'punch']);
  eq('Do in Sowaka cannot be ticked by hand', await refusal(() => joiner.joinerTaskAction(PRIYA, firstPunch.id, { action: 'done' })), 409);
  const other = home.tasks.find((t) => t.title === 'Fill in the joining form')!;
  await joiner.joinerTaskAction(PRIYA, other.id, { action: 'opened' });
  eq('More tasks: opened → done', (await joiner.joinerOnboarding(PRIYA)).tasks.find((t) => t.id === other.id)?.state, 'done');

  section('Check-ins');
  const ci = await joiner.joinerCheckin(PRIYA, w1.id);
  eq('One question per screen: 9, in order', [ci.questions.length, ci.questions[0].type, ci.questions[8].type], [9, 'rating', 'long']);
  eq('A rating outside 1 to 5 is refused', await refusal(() => joiner.sendJoinerCheckin(PRIYA, w1.id, { answers: [{ questionId: 'q1', value: 7 }] })), 400);
  const answers = ci.questions.map((q) => ({ questionId: q.id, value: q.type === 'rating' ? 4 : q.type === 'yes_no' ? 'yes' : null }));
  const sent = await joiner.sendJoinerCheckin(PRIYA, w1.id, { answers });
  eq('Sent (a long answer skipped)', [sent.state, sent.answers?.[8]?.value], ['sent', null]);
  eq('Sent once', await refusal(() => joiner.sendJoinerCheckin(PRIYA, w1.id, { answers })), 409);
  let mgrPage = await team.teamJoinerPage(MGR, J1);
  const readRow = mgrPage.tasks.find((t) => t.checkinId === w1.id)!;
  eq('The manager: "Read Priya’s Week 1 check-in", Ready to read', [readRow.title, readRow.pill?.text], ['Read Priya’s Week 1 check-in', 'Ready to read']);
  const mgrCi = await team.teamCheckin(MGR, J1, w1.id);
  eq('…sees the answers', [mgrCi.state, mgrCi.answers.length], ['ready', 9]);
  eq('The buddy cannot read them', await refusal(() => team.teamCheckin(MEERA, J1, w1.id)), 403);
  await team.markCheckinRead(MGR, J1, w1.id);
  mgrPage = await team.teamJoinerPage(MGR, J1);
  eq('Mark as read: Read', mgrPage.tasks.find((t) => t.checkinId === w1.id)?.pill?.text, 'Read');

  section('Watch list');
  await joiner.markWatched(PRIYA, home.watch[0].id);
  ok('Watched', (await joiner.joinerOnboarding(PRIYA)).watch[0].watched === true);
  eq('Not on the list: 404', await refusal(() => joiner.markWatched(PRIYA, 'nope')), 404);

  section('Teams › Joiners');
  const meeraList = await oldTeam.teamJoiners(MEERA);
  const rel = new Map(meeraList.joiners.map((r) => [r.name, r as unknown as { relation: string; relationLine?: string; initials: string }]));
  ok('Meera: Sana (reports to her) and Priya (her buddy) in one list', rel.get('Sana Khan')?.relation === 'report' && rel.get('Priya Shah')?.relationLine === 'You’re the buddy' && rel.get('Priya Shah')?.initials === 'PS', meeraList.joiners);
  const anita = await oldTeam.teamJoiners(HOD);
  ok('The head of department: everyone in the line, "Reports to X"', anita.joiners.some((r) => (r as unknown as { relationLine?: string }).relationLine === 'Reports to Sunny Kapoor'));
  const buddyPage = await team.teamJoinerPage(MEERA, J1);
  eq('Buddy page: "Help Priya with", the buddy rows (custom one included), you’re the buddy', [buddyPage.card.title, buddyPage.joiner.buddy, buddyPage.tasks.some((t) => t.title === 'Take them for lunch on Day 1' && t.how === 'The canteen on floor 2')], ['Help Priya with', 'you', true]);
  ok('…the meeting with the buddy is a row too', buddyPage.tasks.some((t) => t.title === 'How the team works' && t.opens === 'meeting'));
  const around = buddyPage.tasks.find((t) => t.id === 'buddy_show_around')!;
  await team.teamRowAction(MEERA, J1, around.id, { action: 'done' });
  ok('Show them around: Done', (await team.teamJoinerPage(MEERA, J1)).tasks.find((t) => t.id === 'buddy_show_around')?.done === true);
  eq('A row of another role: 404', await refusal(() => team.teamRowAction(MEERA, J1, 'mgr_kpis', { action: 'done' })), 404);
  eq('Manager page: "Your tasks for Priya", reports to you, status', [mgrPage.card.title, mgrPage.joiner.reportsTo, mgrPage.joiner.status.label], ['Your tasks for Priya', 'you', '2 tasks delayed']);
  ok('Delayed: the earliest late one, waiting on whom', !!mgrPage.joiner.delayed && mgrPage.joiner.delayed.waitingDays >= 1, mgrPage.joiner.delayed);
  eq('View progress rows: meetings, check-ins, tasks, watch list, tour (devices only once one waits)', mgrPage.progress.rows.map((r) => r.key), ['meet', 'ci', 'tasks', 'watch', 'tour']);
  eq('Reach out after joining: 5 ways', mgrPage.reachOut.length, 5);
  const options = await team.buddyOptions(MGR, J1);
  ok('Buddy options: colleagues, the current buddy', options.options.some((o) => o.userId === 'rohan') && options.current === 'meera');
  await team.assignBuddy(MGR, J1, { buddyUserId: 'rohan' });
  eq('Assign: the journey’s buddy (one source)', (await engine.loadJourney(J1)).buddyUserId, 'rohan');
  ok('…Meera no longer sees Priya; Rohan does', !(await oldTeam.teamJoiners(MEERA)).joiners.some((r) => r.journeyId === J1) && (await oldTeam.teamJoiners(me('rohan', 'Rohan Das'))).joiners.some((r) => r.journeyId === J1));
  await team.sendWelcomeMessage(MGR, J1, { text: 'Hi Priya, see you soon!' });
  eq('Welcome message: the portal’s manager note', (await engine.loadJourney(J1)).meetUs?.managerNote?.text, 'Hi Priya, see you soon!');
  const firstWeek = (await joiner.joinerOnboarding(PRIYA)).meetings.filter((m) => m.step === 'd1' || m.step === 'w1');
  await team.scheduleMeetings(MGR, J1, { meetings: firstWeek.map((m, i) => ({ rowKey: m.id.slice(5), startsAt: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() })) });
  ok('Schedule: every first-week meeting has a time for the joiner, and the row ticks', (await joiner.joinerOnboarding(PRIYA)).meetings.filter((m) => m.step === 'd1' || m.step === 'w1').every((m) => !!m.startsAt)
    && (await team.teamJoinerPage(MGR, J1)).tasks.find((t) => t.id === 'mgr_schedule')?.done === true);

  section('Goals: the joiner’s "How’s it going?", the manager’s comments');
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 1, { goals: ['Close 20 tickets', 'Shadow 3 calls'] });
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 2, { goals: ['Own the queue'] });
  await joiner.saveJoinerGoal(SANA, '2', '0', { status: 'progress', note: 'Getting there' });
  let goals = await joiner.joinerGoals(SANA);
  eq('This month (2) and earlier months (1)', [goals.month, goals.current[0].status, goals.current[0].note, goals.earlier.map((e) => e.month)], [2, 'progress', 'Getting there', [1]]);
  ok('Next talk: the month’s end, with the manager', goals.nextTalk?.withName === 'Meera Joshi' && goals.nextTalk.inDays >= 0, goals.nextTalk);
  eq('A status outside the three is refused', await refusal(() => joiner.saveJoinerGoal(SANA, '2', '0', { status: 'done' })), 400);
  const g = await team.teamGoals(MEERA, J2, '2');
  eq('The manager sees status and note', [g.goals[0].status, g.goals[0].note], ['progress', 'Getting there']);
  await team.commentOnGoals(MEERA, J2, '2', { comments: [{ index: 0, text: 'Nice pace' }] });
  goals = await joiner.joinerGoals(SANA);
  eq('The comment reaches the joiner, with who wrote it', [goals.current[0].comment, goals.current[0].commentByName], ['Nice pace', 'Meera Joshi']);
  ok('…and ticks "Comment on Sana’s goals" for month 2', (await team.teamJoinerPage(MEERA, J2)).tasks.find((t) => t.id === 'mgr_goal_comments@2')?.done === true);
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 2, { goals: ['Own the queue', 'Train the next joiner'] });
  eq('Editing the goal list keeps a kept goal’s status and comment', ((await joiner.joinerGoals(SANA)).current[0] as { comment?: string }).comment, 'Nice pace');
  const sanaHome = await joiner.joinerOnboarding(SANA);
  eq('The goals card: 2 goals, month 2', [sanaHome.goals?.month, sanaHome.goals?.count], [2, 2]);

  section('HR and IT & admin');
  const hrBoard = await staff.staffOnboarding(HR);
  eq('HR: four cards; Priya in Week 1, Sana in Probation', [hrBoard.viewingAs, hrBoard.cards.map((c) => c.count)], ['hr', [0, 1, 0, 1]]);
  ok('…a late pill on the Week 1 card', hrBoard.cards[1].late === 1 && hrBoard.cards[1].people[0].pill.tone === 'red', hrBoard.cards[1]);
  const itBoard = await staff.staffOnboarding(IT);
  eq('IT: only the joiners whose template names them', itBoard.everyone.length, 2);
  const tile = await staff.staffTile(HR);
  ok('HR’s Actions tile: tasks, late', !!tile && tile.open > 0 && tile.late > 0 && tile.pill?.endsWith('late'), tile);
  hrPage = await staff.staffJoinerPage(HR, J1);
  ok('HR’s page: due pills on every open row', hrPage.tasks.filter((t) => !t.done && !t.locked && t.step <= 2).every((t) => !!t.due), hrPage.tasks);
  ok('…coming-up meetings locked, other tasks open early', hrPage.tasks.filter((t) => t.step > 2).every((t) => (t.kind === 'meet' ? t.locked : !t.locked)), hrPage.tasks.map((t) => [t.title, t.locked]));
  eq('…her onboarding: 7 rows, Profile first', [hrPage.onboarding.rows.length, hrPage.onboarding.rows[0].key], [7, 'prof']);
  const hrProfile = await staff.staffProfile(HR, J1);
  eq('HR’s profile: nine sections', hrProfile.sections.map((s) => s.key), ['personal', 'contact', 'emergency', 'education', 'ids', 'bank', 'pf', 'salary', 'tax']);
  eq('…its Profile % is the full profile’s (the same number the profile screen says)', (await staff.staffJoinerPage(HR, J1)).onboarding.rows[0].done, hrProfile.pct);
  const itProfile = await staff.staffProfile(IT, J1, 'it');
  eq('IT never sees bank, PF, salary or tax', itProfile.sections.length, 5);
  const access = await staff.staffTaskScreen(IT, J1, 'it_accesses', 'it') as { accesses: Array<{ id: string; title: string; ready: boolean; details: unknown[] }> };
  eq('IT: the four accesses', access.accesses.map((a) => a.title), ['Laptop', 'Work email', 'Office Wi-Fi', 'Sowaka Connect']);
  await staff.staffTaskAction(IT, J1, 'it_accesses', { accesses: Object.fromEntries(access.accesses.map((a) => [a.id, true])) }, 'it');
  home = await joiner.joinerOnboarding(PRIYA);
  eq('Ready on IT’s side → ready on the joiner’s Devices and accesses', [home.summary.devices.ready, home.summary.devices.total], [4, 4]);
  ok('…and "Set up Priya’s accesses" is done', (await staff.staffJoinerPage(IT, J1, 'it')).tasks.find((t) => t.id === 'it_accesses')?.done === true);
  await staff.staffTaskAction(IT, J1, 'it_accesses', { accesses: { [access.accesses[2].id]: false } }, 'it');
  eq('Not yet again: Setting up for the joiner', (await joiner.joinerOnboarding(PRIYA)).devices.find((d) => d.title === 'Office Wi-Fi')?.ready, false);
  await staff.staffTaskAction(HR, J1, 'hr_check_payroll', { checks: { bank: 'looks_right', pf: 'ask' }, action: 'done' });
  const payScreen = await staff.staffTaskScreen(HR, J1, 'hr_check_payroll') as { done: boolean; checks?: Record<string, string>; sections: Array<{ key: string }> };
  eq('Payroll check: bank, PF, tax; the checks kept; done', [payScreen.sections.map((s) => s.key), payScreen.checks, payScreen.done], [['bank', 'pf', 'tax'], { bank: 'looks_right', pf: 'ask' }, true]);
  // Lane H (the app's HR and IT screens): the facts the task screens draw.
  const kitScreen = await staff.staffTaskScreen(HR, J1, 'hr_prepare_kit') as { idCard: { company: string; name: string }; possessive: string };
  ok('Kit: the ID card names the company; a possessive for the copy', !!kitScreen.idCard.company && ['her', 'his', 'their'].includes(kitScreen.possessive), kitScreen);
  const letterScreen = await staff.staffTaskScreen(HR, J1, 'hr_confirmation_letter') as { preview: { head: string; title: string; paragraphs: string[] } };
  ok('Letter: a preview from the confirmation template', letterScreen.preview.title === 'Confirmation of employment' && letterScreen.preview.paragraphs.length > 2 && !letterScreen.preview.paragraphs.some((x) => x.includes('<')), letterScreen.preview);
  await staff.staffTaskNotes(HR, J1, 'hr_welcome', { notes: ['Bring the PAN original', ''] });
  const meetScreen = await staff.staffTaskScreen(HR, J1, 'hr_welcome') as { meeting: { agenda: string[]; notes: string[] } };
  eq('HR’s own notes on a meeting come back on its screen', meetScreen.meeting.notes[0], 'Bring the PAN original');
  eq('…and are HR’s alone (the joiner keeps her own)', (await joiner.joinerOnboarding(PRIYA)).meetings.find((m) => m.id === 'team:hr_welcome')?.notes, ['Bring the PAN card']);
  eq('A task that is not HR’s: 404', await refusal(() => staff.staffTaskAction(HR, J1, 'mgr_kpis', { action: 'done' })), 404);
  eq('Someone who is neither HR nor IT for her: 404', await refusal(() => staff.staffJoinerPage(MGR, J1)), 404);

  section('Reminders for late teammate tasks');
  const jobs = await import('../services/lifecycle/jobs');
  const sentNow = await jobs.lateTeamRowReminders(await engine.loadJourney(J1), await engine.tasksOf(J1), today);
  ok('Late rows remind whoever does them, once', sentNow > 0 && (await jobs.lateTeamRowReminders(await engine.loadJourney(J1), await engine.tasksOf(J1), today)) === 0, sentNow);
  const curT = await design.templateDesign(ORG, def.id);
  await design.saveTemplateDesign(ORG, def.id, { ...curT, team: { ...curT.team, remindLate: false } } as never);
  ok('Switched off in the template: a running joiner keeps the version they started with (still reminded)', (await jobs.lateTeamRowReminders(await engine.loadJourney(J2), await engine.tasksOf(J2), today)) > 0);
  await users().insertMany([person('j5', 'Kavya Iyer', { managerUserId: 'mgr', hrPrimaryUserId: 'hr' }), person('j6', 'Dev Arora', { managerUserId: 'mgr', hrPrimaryUserId: 'hr' })] as never[]);
  const J5 = await mk('j5', 'Kavya Iyer', 'mgr', rules.addDaysKey(today, -40));
  eq('…a joiner who starts after the save: none', await jobs.lateTeamRowReminders(await engine.loadJourney(J5), await engine.tasksOf(J5), today), 0);
  await design.saveTemplateDesign(ORG, def.id, { ...curT, team: { ...curT.team, remindLate: true } } as never);

  section('Confirmation: review → approval');
  await journeys().updateOne({ id: J2 }, { $set: { tj: rules.addDaysKey(today, -170) } });
  const reviewFacts = await team.reviewView(MEERA, J2);
  ok('Review facts: goals, check-ins, confirmation discussion', reviewFacts.facts.some((f) => f.label === 'Monthly goals') && reviewFacts.facts.some((f) => f.label === 'Check-ins'), reviewFacts);
  eq('Approval before the review: waiting', (await team.approvalViewV2(HOD, J2)).state, 'waiting');
  await team.sendReview(MEERA, J2, { outcome: 'confirm', kpis: 'Met most', strengths: 'Calm', next: 'Reports' });
  eq('The head of department: ready, the three answers', [(await team.approvalViewV2(HOD, J2)).state, (await team.approvalViewV2(HOD, J2)).recommendation?.strengths], ['ready', 'Calm']);
  await team.answerApprovalV2(HOD, J2, { action: 'extend', extendMonths: 2, comment: 'Two more months' });
  const sanaJ = await engine.loadJourney(J2);
  eq('Extend: on the confirmation record HR decides from', [sanaJ.probation?.hodApproval?.outcome, sanaJ.probation?.hodApproval?.extendMonths], ['extended', 2]);
  eq('Answered once', await refusal(() => team.answerApprovalV2(HOD, J2, { action: 'approve' })), 409);

  section('Kept templates: a save is read at once, and reaches new joiners only');
  readCache.enableLifecycleReadCache(true);
  const before = await design.onboardingTemplatesOf(ORG);
  const cur = await design.templateDesign(ORG, def.id);
  await design.saveTemplateDesign(ORG, def.id, { ...cur, meetings: cur.meetings.map((m) => (m.title === 'Salary and tax' ? { ...m, title: 'Salary, tax and PF' } : m)) } as never);
  const after = await design.onboardingTemplatesOf(ORG);
  ok('The kept copy is dropped by the save', before.get(def.id)?.tasks.some((t) => t.title === 'Salary and tax') && after.get(def.id)?.tasks.some((t) => t.title === 'Salary, tax and PF'));
  ok('A running joiner keeps the version they started with', (await joiner.joinerOnboarding(PRIYA)).meetings.some((m) => m.title === 'Salary and tax')
    && !(await joiner.joinerOnboarding(PRIYA)).meetings.some((m) => m.title === 'Salary, tax and PF'));
  ok('…and so does their manager’s and HR’s side', (await team.teamJoinerPage(MGR, J1)).tasks.every((t) => t.title !== 'Salary, tax and PF') && (await staff.staffJoinerPage(HR, J1)).tasks.some((t) => t.title === 'Salary and tax'));
  await mk('j6', 'Dev Arora', 'mgr', rules.addDaysKey(today, -3));
  ok('A joiner who starts after the save reads the new title', (await joiner.joinerOnboarding(me('j6', 'Dev Arora'))).meetings.some((m) => m.title === 'Salary, tax and PF'));
  readCache.enableLifecycleReadCache(false);

  section('Migration of an older template; an older journey still reads');
  templates.setOnboardingSeedKind('legacy');
  await lifecycleTemplates().insertOne({ id: 'old-tpl', org: ORG, kind: 'onboarding', name: 'Old', isDefault: false, active: true, settings: { ...seed.ONBOARDING_SETTINGS, probationMonths: 3 }, tasks: seed.onboardingSeed(), createdAt: new Date(), updatedAt: new Date() } as never);
  templates.setOnboardingSeedKind('final');
  const oldJ = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Rahul Verma', personalEmail: 'rahul@mail.test', phone: '9999999999' } as never, tj: rules.addDaysKey(today, -3), managerUserId: 'mgr', department: 'Operations', templateId: 'old-tpl' } as never);
  await users().insertOne(person('j3', 'Rahul Verma', { managerUserId: 'mgr', hrPrimaryUserId: 'hr' }) as never);
  await journeys().updateOne({ id: oldJ.id }, { $set: { status: 'joined', userId: 'j3' } });
  const oldTasksBefore = await journeyTasks().countDocuments({ journeyId: oldJ.id });
  const dry = await migrate.migrateTemplatesToFinalDesigns({ apply: false, org: ORG });
  ok('Dry run: lists the old template only, writes nothing', dry.length === 1 && dry[0].templateId === 'old-tpl' && !(await templates.getTemplate(ORG, 'old-tpl')).tasks.some((t) => t.design), dry);
  ok('…what it would switch off and add, and the running journey it would give the rows to', dry[0].switchedOff.includes('Week-1 tasks') && dry[0].added.length === 52 && dry[0].signOnDay1 && dry[0].journeys === 1, dry[0]);
  ok('…the dry run gives no journey anything', !(await engine.loadJourney(oldJ.id)).templateSnapshot.tasks.some((t) => t.design));
  await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG });
  const migrated = await templates.getTemplate(ORG, 'old-tpl');
  ok('Applied: design rows, old rows switched off (never deleted), probation kept at 3',
    migrated.tasks.filter((t) => t.design).length === 53 && migrated.tasks.some((t) => t.systemKey === 'week1_reels' && !t.enabled && t.replacedBy === 'final_designs') && migrated.settings.probationMonths === 3, migrated.tasks.length);
  eq('Again: nothing to do', (await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG })).length, 0);
  const keys = migrated.tasks.flatMap((t) => (t.team ? [t.team.key] : []));
  ok('No team key twice (the old Approve keeps its own)', new Set(keys).size === keys.length && keys.includes('hod_approve_20nov'), keys);
  const resaved = await templates.updateTemplate(ORG, 'old-tpl', { tasks: migrated.tasks });
  ok('The older editor can still save a migrated template', resaved.tasks.length === migrated.tasks.length);
  eq('The running journey keeps its tasks', await journeyTasks().countDocuments({ journeyId: oldJ.id }), oldTasksBefore);
  const oldSnap = (await engine.loadJourney(oldJ.id)).templateSnapshot;
  eq('…and gets the meetings, check-ins, watch list and teammate rows as its own snapshot (no tasks or accesses), its probation and signing place kept',
    [oldSnap.tasks.filter((t) => t.design).length, oldSnap.tasks.some((t) => t.design?.section === 'task' || t.design?.section === 'access'), oldSnap.settings.probationMonths, oldSnap.settings.signLettersOnDay1 === true, !!oldSnap.settings.preboarding],
    [39, false, 3, false, true]);
  const oldView = await design.templateDesign(ORG, 'old-tpl');
  await design.saveTemplateDesign(ORG, 'old-tpl', { ...oldView, meetings: oldView.meetings.map((m) => (m.title === 'First goals' ? { ...m, title: 'Your first goals' } : m)) } as never);
  ok('…so a later edit of the migrated template does not reach it', (await joiner.joinerOnboarding(me('j3', 'Rahul Verma'))).meetings.some((m) => m.title === 'First goals'));
  const oldHome = await joiner.joinerOnboarding(me('j3', 'Rahul Verma'));
  ok('…its new view reads: meetings from the template, its own tasks by kind', oldHome.meetings.length > 0 && oldHome.tasks.length > 0 && oldHome.step === 'w1', { m: oldHome.meetings.length, t: oldHome.tasks.length });
  ok('…and the 20 Nov home still answers for older app builds', !!(await app.onboardingHome(me('j3', 'Rahul Verma'))).journeyId);

  await closeDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

export {};
