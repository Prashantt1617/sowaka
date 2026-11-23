/**
 * Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md) against their rules, in-process, on
 * its own scratch database: the seed is the canvas's, the editor's design view saves and validates,
 * stages place rows, and every surface reads the same tick — the joiner, the manager, the buddy,
 * the head of department, and HR's dashboard (HR and IT & admin have no app side). Also the migration of an older template and an older
 * journey still reading, and the kept templates dropped by a save.
 *
 *   npm run lifecycle:final-designs-check   (MONGODB_DB=el_final_designs_check; local mongod only)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
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
/** Where a stored push about [journeyId] opens, per person: `destination` (+ `as`). */
async function pushTargets(scenario: string, journeyId: string): Promise<Record<string, string>> {
  const { notifications } = await import('../config/db');
  const rows = await notifications().find({ scenario, 'data.journeyId': journeyId } as never).toArray();
  return Object.fromEntries(rows.map((n) => {
    const data = (n as unknown as { data: Record<string, string> }).data;
    return [n.userId, [data.destination, data.as].filter(Boolean).join(':')];
  }));
}
const ORG = 'el-fd-check';

async function main() {
  if (!/^(mongodb:\/\/)(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:final-designs-check runs on a local mongod only');
  if (!/^el_final_designs/.test(process.env.MONGODB_DB!)) throw new Error('lifecycle:final-designs-check needs its own el_final_designs_* database');

  const { connectDb, getDb, closeDb, companies, users, journeys, journeyTasks, lifecycleTemplates, policyDocuments, probationMonths } = await import('../config/db');
  const designSeed = await import('../services/lifecycle/designSeed');
  const seed = await import('../services/lifecycle/seed');
  const templates = await import('../services/lifecycle/templates');
  const design = await import('../services/lifecycle/design');
  const designClean = await import('../services/lifecycle/designClean');
  const engine = await import('../services/lifecycle/engine');
  const rules = await import('../services/lifecycle/dueRules');
  const joiner = await import('../services/lifecycle/joinerApp');
  const meetings = await import('../services/lifecycle/joinerMeetings');
  const team = await import('../services/lifecycle/teamApp');
  const oldTeam = await import('../services/lifecycle/teamTasks');
  const designRows = await import('../services/lifecycle/designRows');
  const probation = await import('../services/lifecycle/probation');
  const migrate = await import('../services/lifecycle/designMigrate');
  const app = await import('../services/lifecycle/appOnboarding');
  const readCache = await import('../services/lifecycle/readCache');
  /** A teammate row's tick as every surface reads it (the joiner's, the Teams page's, the dashboard's). */
  const rowDoneNow = async (journeyId: string, key: string) => {
    const j = await engine.loadJourney(journeyId);
    const p = await designRows.place(j);
    const r = [...p.meetings, ...p.team].find((x) => x.rowKey === key);
    return r ? team.rowDone(r, j, await engine.tasksOf(journeyId), p.design) : undefined;
  };

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
  const HR = me('hr', 'Ritu Sharma'), IT = me('it', 'Imran Khan'), MEERA = me('meera', 'Meera Joshi'), HOD = me('hod', 'Anita Desai');
  const PRIYA = me('j1', 'Priya Shah'), SANA = me('j2', 'Sana Khan');

  // ───────────────────────────────────────────── seed
  section('The Standard template is the canvas’s');
  const rows = designSeed.finalDesignRows('Sowaka Test');
  const count = (s: string) => rows.filter((r) => r.design?.section === s).length;
  eq('52 items: 10 meetings, 10 tasks, 3 check-ins, 6 watch (2 before joining), 2 trainings, 4 accesses, 17 teammate rows (no manager "Assign a buddy": HR picks the buddy)',
    [rows.length, count('meeting'), count('task'), count('checkin'), count('watch'), count('training'), count('access'), count('team')], [52, 10, 10, 3, 6, 2, 4, 17]);
  eq('In the canvas’s order', rows.slice(0, 4).map((r) => r.title), ['Sign your joining documents', 'Welcome from HR', 'Meet the team', 'Schedule their first-week meetings']);
  ok('Team keys are unique', new Set(rows.filter((r) => r.team).map((r) => r.team!.key)).size === rows.filter((r) => r.team).length);
  eq('Welcome and documents names the company', rows.find((r) => r.title === 'Welcome and documents')?.agenda?.[0], 'Welcome to Sowaka Test and a quick office round');
  eq('Week 1 check-in: 9 questions, rating / yes-no / long', rows.find((r) => r.title === 'Week 1 check-in')?.design?.questions?.map((q) => q.type[0]).join(''), 'ryyyyyyrl');
  await templates.ensureDefaultTemplates(ORG);
  const def = await templates.defaultTemplate(ORG, 'onboarding');
  ok('A new company’s Standard onboarding is the Final designs', def.tasks.filter((t) => t.design).length === 52 && def.settings.signLettersOnDay1 === true, def.tasks.length);
  ok('…with the pre-boarding machinery kept (offer, portal, Mark joined)', ['send_offer', 'finalise_offer', 'mark_joined', 'confirmation_discussion'].every((k) => def.tasks.some((t) => t.systemKey === k)));
  ok('…and none of the rows the designs replace', !def.tasks.some((t) => t.systemKey === 'week1_reels' || t.team?.key === 'buddy_meet'));

  // ───────────────────────────────────────────── the editor's design view
  section('The editor: GET / PUT design, validation');
  const view = await design.templateDesign(ORG, def.id);
  eq('Design view: counts per tab', [view.preboarding.videos.length, view.meetings.length, view.tasks.length, view.checkins.length, view.watch.length, view.trainings.length, view.accesses.length, view.team.tasks.length, view.tour.length, view.probation.months, view.team.remindLate],
    [2, 10, 10, 3, 4, 2, 4, 17, 6, 6, true]);
  eq('Tasks group by kind (Do in Sowaka, Review, Read and acknowledge, Sign, More tasks)', ['do', 'review', 'ack', 'sign', 'other'].map((k) => view.tasks.filter((t) => t.type === k).length), [4, 3, 1, 1, 1]);
  await users().updateOne({ userId: 'it' }, { $set: { org: ORG } });
  const saved = await design.saveTemplateDesign(ORG, def.id, {
    ...view,
    meetings: view.meetings.map((m) => (m.title === 'First goals' ? { ...m, agenda: [...m.agenda, 'Your questions'] } : m)),
    team: { ...view.team, assignees: { hrUserId: 'hr', itUserId: 'it' }, tasks: [...view.team.tasks, { title: 'Take them for lunch on Day 1', role: 'buddy', stage: 'd1', how: 'The canteen on floor 2' }] },
    preboarding: { ...view.preboarding, reporting: { time: '9:30 AM', place: 'Reception, Pune office', mapLink: 'https://www.google.com/maps/search/?api=1&query=18.52,73.85', meets: 'hr' } },
  } as never, 'Ritu Sharma');
  eq('A maps link that is not a web address is refused', await refusal(() => design.saveTemplateDesign(ORG, def.id, { ...view, preboarding: { ...view.preboarding, reporting: { place: 'Lobby', mapLink: 'javascript:alert(1)', meets: 'hr' } } } as never)), 400);
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
  // Lane D: the editor keeps an uploaded file's name on its media (shown beside Replace).
  eq('Media keeps the uploaded file’s name (only with a file)', [designClean.cleanMedia({ type: 'video', fileId: 'f1', name: 'welcome.mp4' }, ['video'], 'x').name, designClean.cleanMedia({ type: 'video', name: 'x.mp4' }, ['video'], 'x').name], ['welcome.mp4', undefined]);
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
  eq('Tasks end in their verb', home.tasks.map((t) => t.verb).sort().join(','), 'Open,Read,Review,Review,Review,Sign,Start,Start,Start');
  ok('First punch-in is the Day-1 card, not a row in Tasks (editor: "Shown on top on Day 1")', !home.tasks.some((t) => t.title === 'First punch-in'), home.tasks.map((t) => t.title));
  const w1 = home.checkins.find((c) => c.title === 'Week 1 check-in')!;
  eq('Week 1 check-in is open (2 days before the end of Week 1); the others locked', [w1.state, home.checkins.filter((c) => c.state === 'locked').length, home.summary.checkinDue?.title], ['open', 2, 'Week 1 check-in']);
  eq('Watch list: pre-boarding videos show from Day 1, trainings apart', [home.watch.length, home.trainings.length, home.watch[0].step], [6, 2, 'd1']);
  eq('Devices and accesses: 4, none ready', [home.devices.length, home.summary.devices.ready], [4, 0]);
  eq('Tour: 4 lessons (no reports), today is Punch in and out', [home.tour.lessons.length, home.tour.today], [4, 'punch']);

  const portal = await import('../services/lifecycle/portal');
  const pass = await portal.portalPass(await engine.loadJourney(J1), new Date(), { anyDay: true });
  eq('The portal’s Day-1 pass reads the template’s joining and reporting details (saved as 09:30; who meets them: HR)', [pass.reportingTime, pass.place, pass.askFor?.name], ['09:30', 'Reception, Pune office', 'Ritu Sharma']);
  const details = await portal.joiningDetails(await engine.loadJourney(J1));
  eq('The pass carries the template’s maps link (directions on the Day-1 pass)', pass.mapLink, 'https://www.google.com/maps/search/?api=1&query=18.52,73.85');
  eq('…and so does the joining details tile (one reading)', [details.reportingTime, details.place, details.askFor?.name], ['09:30', 'Reception, Pune office', 'Ritu Sharma']);
  const preRows = (await engine.loadJourney(J1)).templateSnapshot.settings.preboarding!;
  await journeys().updateOne({ id: J1 }, { $set: { 'templateSnapshot.settings.preboarding': { ...preRows, joiningDetails: false } } });
  const hiddenPass = await portal.portalPass(await engine.loadJourney(J1), new Date(), { anyDay: true });
  const hiddenDetails = await portal.joiningDetails(await engine.loadJourney(J1));
  eq('Row removed in the template: neither the pass nor the tile shows its details', [hiddenPass.reportingTime, hiddenPass.place, hiddenPass.askFor, hiddenDetails.reportingTime, hiddenDetails.place], [undefined, undefined, undefined, undefined, undefined]);
  await journeys().updateOne({ id: J1 }, { $set: { 'templateSnapshot.settings.preboarding': preRows } });

  section('Meetings: one tick, read by both sides');
  await meetings.markMeetingRowMet(PRIYA, await engine.loadJourney(J1), welcome.id, { action: 'met' });
  home = await joiner.joinerOnboarding(PRIYA);
  ok('The joiner sees it met', home.meetings.find((m) => m.id === welcome.id)?.met === true);
  ok('…and HR’s row reads done (one tick)', (await rowDoneNow(J1, 'hr_welcome')) === true);
  await meetings.markMeetingRowMet(PRIYA, await engine.loadJourney(J1), welcome.id, { action: 'unmet' });
  ok('Unticked by the joiner: undone for HR too', (await rowDoneNow(J1, 'hr_welcome')) === false);
  const j1Now = await engine.loadJourney(J1);
  eq('A locked meeting cannot be marked met', await refusal(() => meetings.markMeetingRowMet(PRIYA, j1Now, monthly[0].id, { action: 'met' })), 409);
  await meetings.saveMeetingRowNotes(PRIYA, await engine.loadJourney(J1), welcome.id, { notes: ['Bring the PAN card'] });
  ok('Own notes come back to the joiner only', (await joiner.joinerOnboarding(PRIYA)).meetings.find((m) => m.id === welcome.id)?.notes[0] === 'Bring the PAN card');

  section('Tasks');
  // A journey migrated from before the Final designs: its own copy holds meetings and check-ins but no task rows
  // (they are read from its template). Tapping a task must still find it (23 Nov: every tap answered 404).
  const kept = (await journeys().findOne({ id: J1 }))!.templateSnapshot!;
  await journeys().updateOne({ id: J1 }, { $set: { 'templateSnapshot.tasks': kept.tasks.filter((t) => t.design?.section !== 'task') } });
  const review = home.tasks.find((t) => t.title === 'Review your shift details')!;
  await joiner.joinerTaskAction(PRIYA, review.id, { action: 'looks_good' });
  eq('A task opens on a journey whose own copy has no task rows', (await joiner.joinerOnboarding(PRIYA)).tasks.find((t) => t.id === review.id)?.state, 'done');
  await journeys().updateOne({ id: J1 }, { $set: { 'templateSnapshot.tasks': kept.tasks } });
  home = await joiner.joinerOnboarding(PRIYA);
  eq('Review → Looks good: done', home.tasks.find((t) => t.id === review.id)?.state, 'done');
  const policies = home.tasks.find((t) => t.title === 'Acknowledge company policies')!;
  eq('Policies tick from App policies, not a tap', await refusal(() => joiner.joinerTaskAction(PRIYA, policies.id, { action: 'acknowledged' })), 409);
  ok('No required policy: Acknowledge company policies ticks itself', policies.state === 'done', policies);
  await policyDocuments().insertOne({ id: 'pol1', org: ORG, title: 'Code of conduct', active: true, ackRequired: true, version: '2', order: 1, createdAt: new Date() } as never);
  const firstPunch = (await journeyTasks().findOne({ journeyId: home.journeyId, title: 'First punch-in' }))!;
  eq('First punch-in waits for the punch', firstPunch.status, 'todo');
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
  eq('No push to the manager about it (reading check-ins is no longer an app task of theirs)', Object.keys(await pushTargets('lifecycle_checkin_sent', J1)), []);

  section('Watch list');
  await joiner.markWatched(PRIYA, home.watch[0].id);
  ok('Watched', (await joiner.joinerOnboarding(PRIYA)).watch[0].watched === true);
  eq('Not on the list: 404', await refusal(() => joiner.markWatched(PRIYA, 'nope')), 404);

  section('No team task pages: Teams › New joiners is the one joiners list (24 Nov)');
  ok('The old Teams › Joiners services are gone (list, page, ticks, schedule, welcome message, feed post, goals, check-ins)',
    !('teamJoiners' in oldTeam) && !('teamJoiner' in oldTeam) && !('teamJoinerPage' in team) && !('teamRowAction' in team) && !('scheduleMeetings' in team)
    && !('sendWelcomeMessage' in team) && !('introduceOnFeed' in team) && !('commentOnGoals' in team) && !('teamCheckin' in team) && !('inviteSenior' in team));
  // The buddy is HR's (23 Nov): HR sets it on the dashboard.
  await (await import('../services/lifecycle/board')).updateJourneyByHr(ORG, J1, { buddyUserId: 'rohan' });
  eq('Assign by HR: the journey’s buddy (one source)', (await engine.loadJourney(J1)).buddyUserId, 'rohan');
  eq('No set-up push to the manager or the buddy', [...Object.keys(await pushTargets('lifecycle_joiner_setup', J1)), ...Object.keys(await pushTargets('lifecycle_meeting_invite', J1))], []);

  section('Goals: the joiner’s "How’s it going?"');
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 1, { goals: ['Close 20 tickets', 'Shadow 3 calls'] });
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 2, { goals: ['Own the queue'] });
  await joiner.saveJoinerGoal(SANA, '2', '0', { status: 'progress', note: 'Getting there' });
  let goals = await joiner.joinerGoals(SANA);
  eq('This month (2) and earlier months (1)', [goals.month, goals.current[0].status, goals.current[0].note, goals.earlier.map((e) => e.month)], [2, 'progress', 'Getting there', [1]]);
  ok('Next talk: the month’s end, with the manager', goals.nextTalk?.withName === 'Meera Joshi' && goals.nextTalk.inDays >= 0, goals.nextTalk);
  eq('A status outside the three is refused', await refusal(() => joiner.saveJoinerGoal(SANA, '2', '0', { status: 'done' })), 400);
  // A comment written before 24 Nov (the manager's goals screen is gone from the app) still reaches the joiner.
  await probationMonths().updateOne({ journeyId: J2, monthNo: 2 }, { $set: { 'goals.0.comment': 'Nice pace', 'goals.0.commentAt': new Date(), 'goals.0.commentByName': 'Meera Joshi' } });
  goals = await joiner.joinerGoals(SANA);
  eq('A comment reaches the joiner, with who wrote it', [goals.current[0].comment, goals.current[0].commentByName], ['Nice pace', 'Meera Joshi']);
  await probation.updateMonthByManager(J2, { userId: 'meera', name: 'Meera Joshi' }, 2, { goals: ['Own the queue', 'Train the next joiner'] });
  eq('Editing the goal list keeps a kept goal’s status and comment', ((await joiner.joinerGoals(SANA)).current[0] as { comment?: string }).comment, 'Nice pace');
  const sanaHome = await joiner.joinerOnboarding(SANA);
  eq('The goals card: 2 goals, month 2', [sanaHome.goals?.month, sanaHome.goals?.count], [2, 2]);

  section('HR and IT & admin: the dashboard only, nothing in the app');
  const hrMe = await app.lifecycleMe(HR), itMe = await app.lifecycleMe(IT);
  ok('GET /lifecycle/me has no staff tile for HR or IT & admin', !('staff' in hrMe) && !('staff' in itMe), { hrMe, itMe });
  const hrPanel = await (await import('../services/lifecycle/board')).journeyPanel(ORG, J1);
  const accessRows = hrPanel.tasks.filter((t) => t.section === 'access');
  eq('HR’s journey panel marks the four accesses for Week 1’s Devices and accesses', accessRows.map((t) => t.title).sort(), ['Laptop', 'Office Wi-Fi', 'Sowaka Connect', 'Work email']);
  {
    // Joining day's "Logged into the app": from lastLoginAt, the sessions and an app phone; no account is No.
    const board = await import('../services/lifecycle/board');
    const { authSessions, deviceTokens } = await import('../config/db');
    eq('Logged into the app: No before any sign-in', hrPanel.appSignIn, { signedIn: false });
    eq('…No with no account', await board.appSignInOf(undefined), { signedIn: false });
    const firstAt = new Date('2026-11-02T04:30:00.000Z'), lastAt = new Date('2026-11-20T05:00:00.000Z');
    await authSessions().insertOne({ tokenHash: 'fd-check-session', userId: 'j1', createdAt: firstAt, expiresAt: new Date(Date.now() + 86_400_000) });
    await users().updateOne({ userId: 'j1' }, { $set: { lastLoginAt: lastAt } });
    eq('…Yes once signed in: first from the session, last from lastLoginAt', (await board.journeyPanel(ORG, J1)).appSignIn, { signedIn: true, firstAt: firstAt.toISOString(), lastAt: lastAt.toISOString() });
    await deviceTokens().insertOne({ userId: 'rohan', token: 'fd-check-phone', platform: 'android', createdAt: firstAt, updatedAt: firstAt });
    eq('…an app phone alone counts as signed in', await board.appSignInOf('rohan'), { signedIn: true, firstAt: firstAt.toISOString(), lastAt: firstAt.toISOString() });
    await Promise.all([authSessions().deleteOne({ tokenHash: 'fd-check-session' }), deviceTokens().deleteOne({ token: 'fd-check-phone' }), users().updateOne({ userId: 'j1' }, { $unset: { lastLoginAt: 1 } })]);
  }
  const boardTick = (await import('../services/lifecycle/board')).actOnTaskByHr;
  for (const t of accessRows) await boardTick(ORG, J1, t.id, { action: 'done' }, { userId: 'it', name: 'Imran Khan' });
  home = await joiner.joinerOnboarding(PRIYA);
  eq('Ticked ready on the dashboard → ready on the joiner’s Devices and accesses', [home.summary.devices.ready, home.summary.devices.total], [4, 4]);
  ok('…and "Set up Priya’s accesses" reads done', (await rowDoneNow(J1, 'it_accesses')) === true);
  await boardTick(ORG, J1, accessRows.find((t) => t.title === 'Office Wi-Fi')!.id, { action: 'reopen' }, { userId: 'it', name: 'Imran Khan' });
  eq('Not yet again: Setting up for the joiner', (await joiner.joinerOnboarding(PRIYA)).devices.find((d) => d.title === 'Office Wi-Fi')?.ready, false);

  section('App build 90: the Employee profile’s empty sections, filled once in the app');
  const jd = await import('../services/lifecycle/joinerDetails');
  // A key for this section (the account number and UAN are kept encrypted; HR's approval decrypts them).
  const keyBefore = process.env.PAYROLL_FIELD_KEY;
  process.env.PAYROLL_FIELD_KEY = Buffer.alloc(32, 7).toString('base64');
  // Pre-boarding filled Personal details only.
  await journeys().updateOne({ id: J1 }, { $set: { 'profile.personal': { fullName: 'Priya Shah', dob: '1998-04-02', gender: 'Female', nationality: 'Indian' } } });
  let prof = await jd.joinerProfileDetails(PRIYA);
  const sec = (key: string) => prof.sections.find((s) => s.key === key)!;
  eq('Five sections (bank and PF is its own task since 24 Nov); the one filled before joining is read-only, the rest can be filled', [prof.sections.map((s) => `${s.key}:${s.editable}`), prof.total],
    [['personal:false', 'contact:true', 'emergency:true', 'education:true', 'ids:true'], 5]);
  eq('…with its answers to read', (prof.values as { personal?: { fullName: string } }).personal?.fullName, 'Priya Shah');
  eq('A section filled before joining cannot be changed here', await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'personal', { fullName: 'P', dob: '1998-04-02', gender: 'Female' })), 409);
  eq('A section outside the five is refused (the photo, bank and PF)', [await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'photo', {})), await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'bank', {}))], [400, 400]);
  eq('A bad answer is refused and saves nothing (still editable)', [await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'contact', { mobile: '12345' })), (await jd.joinerProfileDetails(PRIYA)).sections.find((s) => s.key === 'contact')?.editable], [400, true]);
  prof = await jd.saveJoinerProfileSection(PRIYA, 'contact', { mobile: '9876500001', current: { line: '12 MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' } });
  ok('Saved once: contact is read-only, saved in the app', !sec('contact').editable && sec('contact').filled && !!sec('contact').savedInAppAt, sec('contact'));
  eq('…a second save is refused', await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'contact', { mobile: '9876500002', current: { line: 'x', city: 'y', state: 'z', pin: '411001' } })), 409);
  eq('Emergency: the joiner’s own number is refused', await refusal(() => jd.saveJoinerProfileSection(PRIYA, 'emergency', { name: 'Asha Shah', relation: 'Parent', phone: '9999999999' })), 400);
  prof = await jd.saveJoinerProfileSection(PRIYA, 'emergency', { name: 'Asha Shah', relation: 'Parent', phone: '9876500003' });
  const hrEmergency = (await engine.loadJourney(J1)).aboutYou?.emergencyContact?.phone;
  ok('Emergency saved where pre-boarding keeps it (the dashboard reads it there)', !sec('emergency').editable && hrEmergency === '+919876500003', hrEmergency);
  // Bank and PF the portal kept before 24 Nov (still read: it prefills the payroll details below).
  const profileSvc = await import('../services/lifecycle/profile');
  await journeys().updateOne({ id: J1 }, { $set: {
    'profile.bank': profileSvc.sectionValue('bank', { holderName: 'Priya Shah', accountNumber: '123456789012', accountNumberAgain: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }, await engine.loadJourney(J1), new Date()).bank,
    'aboutYou.pf': { firstJob: false, uan: '100200300400' },
  } });
  const j1Prof = await engine.loadJourney(J1);
  eq('Bank and PF kept from before: the account as its last four (encrypted kept), PF in About you; not a profile section', [j1Prof.profile?.bank?.accountLast4, !!j1Prof.profile?.bank?.accountNumberEnc, j1Prof.aboutYou?.pf?.uan, (await jd.joinerProfileDetails(PRIYA)).sections.some((s) => s.key === 'bank')], ['9012', true, '100200300400', false]);
  eq('The joiner’s home counts the sections filled here (out of five); contact still waits for its address proof', [(await joiner.joinerOnboarding(PRIYA)).profile.sections.filter((s) => s.state === 'done').map((s) => s.key), (await joiner.joinerOnboarding(PRIYA)).profile.total], [['personal', 'emergency'], 5]);
  ok('…which the app’s profile says (saved, the document named)', sec('contact').state === 'saved' && (sec('contact').missingDocuments?.length ?? 0) > 0, sec('contact'));

  section('App build 90: payroll details (bank, PF, nominees) to HR, then payroll');
  let payroll = await jd.joinerPayroll(PRIYA);
  eq('Prefilled from pre-boarding (the account as its last four, the UAN in full)', [payroll.state, payroll.editable, payroll.bank.holderName, payroll.bank.ifsc, payroll.bank.accountLast4, payroll.pf.uan, payroll.taskDone],
    ['todo', true, 'Priya Shah', 'HDFC0001234', '9012', '100200300400', false]);
  const payBody = (extra: Record<string, unknown> = {}) => ({
    bank: { holderName: 'Priya Shah', bankName: 'HDFC Bank', ifsc: 'HDFC0001234' }, pf: { firstJob: false, uan: '100200300400' },
    nominees: [{ name: 'Asha Shah', relation: 'Mother', share: 60 }, { name: 'Ravi Shah', relation: 'Father', share: 40 }], ...extra,
  });
  eq('Shares must add up to 100', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody({ nominees: [{ name: 'Asha Shah', relation: 'Mother', share: 60 }, { name: 'Ravi Shah', relation: 'Father', share: 30 }] }))), 400);
  eq('At least one nominee', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody({ nominees: [] }))), 400);
  eq('A relation outside the list is refused', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody({ nominees: [{ name: 'Asha Shah', relation: 'Neighbour', share: 100 }] }))), 400);
  eq('A UAN is 12 digits', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody({ pf: { uan: '123' } }))), 400);
  eq('Two account numbers that differ are refused', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody({ bank: { holderName: 'Priya Shah', bankName: 'HDFC Bank', ifsc: 'HDFC0001234', accountNumber: '111122223333', accountNumberAgain: '111122223334' } }))), 400);
  payroll = await jd.sendJoinerPayroll(PRIYA, payBody());
  const payTask = (await joiner.joinerOnboarding(PRIYA)).tasks.find((t) => t.title === 'Complete your payroll details');
  eq('Sent: waiting for HR, read-only; the task is done', [payroll.state, payroll.editable, payroll.taskDone, payTask?.state], ['pending', false, true, 'done']);
  const sentReq = (await engine.loadJourney(J1)).bankPfRequest;
  ok('…the week-1 bank/PF change carries it: the account kept from pre-boarding, holder, UAN, nominees',
    sentReq?.source === 'payroll_task' && sentReq.changes.accountLast4 === '9012' && !!sentReq.changes.accountNumberEnc && sentReq.changes.accountHolder === 'Priya Shah' && sentReq.changes.uanLast4 === '0400' && sentReq.nominees?.length === 2, sentReq);
  eq('…HR gets no app push (the dashboard shows the request)', Object.keys(await pushTargets('lifecycle_bank_pf_request', J1)), []);
  eq('Sent once while HR has it', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody())), 409);
  const boardSvc = await import('../services/lifecycle/board');
  await boardSvc.decideBankPfRequest(ORG, J1, { decision: 'decline', note: 'Use your salary account' }, { userId: 'hr', name: 'Ritu Sharma' });
  payroll = await jd.joinerPayroll(PRIYA);
  eq('HR declines: editable again, with HR’s note', [payroll.state, payroll.editable, payroll.hrNote], ['declined', true, 'Use your salary account']);
  const payReview = async () => (await boardSvc.journeyPanel(ORG, J1)).reviews.find((r) => r.key === 'hr_check_payroll');
  let pr = await payReview();
  ok('Reviews: declined, "Check their payroll details" is to do again and it opens Bank account and PF',
    !(await engine.loadJourney(J1)).teamTasks?.hr_check_payroll && pr?.done === false && pr.place === 'bank_pf' && pr.step === 'week_1' && /Sent back/.test(pr.line ?? '')
    , pr);
  await jd.sendJoinerPayroll(PRIYA, payBody({ bank: { holderName: 'Priya Shah', bankName: 'ICICI Bank', ifsc: 'ICIC0004321', accountNumber: '555566667777', accountNumberAgain: '555566667777' }, nominees: [{ name: 'Asha Shah', relation: 'Mother', share: 100 }] }));
  await boardSvc.decideBankPfRequest(ORG, J1, { decision: 'approve' }, { userId: 'hr', name: 'Ritu Sharma' });
  const { employeePaymentDetails } = await import('../config/db');
  const paid = await employeePaymentDetails().findOne({ org: ORG, userId: 'j1' });
  eq('HR approves: payroll has the account, holder, IFSC, UAN and nominees', [paid?.accountLast4, paid?.accountHolder, paid?.ifsc, paid?.uanLast4, paid?.nominees], ['7777', 'Priya Shah', 'ICIC0004321', '0400', [{ name: 'Asha Shah', relation: 'Mother', share: 100 }]]);
  payroll = await jd.joinerPayroll(PRIYA);
  eq('…and the form reads approved, read-only', [payroll.state, payroll.editable, payroll.bank.bankName], ['approved', false, 'ICICI Bank']);
  pr = await payReview();
  ok('Reviews: approving at its place is "Check their payroll details" done, by HR, with when',
    pr?.done === true && pr.doneByName === 'Ritu Sharma' && !!pr.doneAt && (await engine.loadJourney(J1)).teamTasks?.hr_check_payroll?.byName === 'Ritu Sharma'
    , pr);
  {
    const rows = (await boardSvc.journeyPanel(ORG, J1)).reviews;
    eq('Reviews on the panel: each with where it opens', rows.map((r) => `${r.key}:${r.step}:${r.place}`), [
      'review_documents:joining_day:documents', 'hr_check_form:week_1:joining_form', 'hr_check_payroll:week_1:bank_pf',
      'mgr_confirmation_review:final_month:recommendation', 'hod_approve:final_month:recommendation', 'confirmation_discussion:final_month:decision', 'confirmation_letter:confirmed:letter',
    ]);
  }
  if (keyBefore === undefined) delete process.env.PAYROLL_FIELD_KEY; else process.env.PAYROLL_FIELD_KEY = keyBefore;

  section('Reminders for late teammate tasks');
  const jobs = await import('../services/lifecycle/jobs');
  eq('Late set-up rows (Priya, Week 1) push nobody: HR follows them on the dashboard', await jobs.lateTeamRowReminders(await engine.loadJourney(J1), await engine.tasksOf(J1), today), 0);
  eq('…none stored', Object.keys(await pushTargets('lifecycle_team_task_late', J1)), []);
  const { teammatePushTarget } = designRows;
  eq('A teammate push about a joiner (a meeting) opens the joiner’s profile; HR or IT only → none; an HR row → none',
    [teammatePushTarget({ hr: 'a', it: 'b', manager: 'a' }, 'a'), teammatePushTarget({ hr: 'a', it: 'b' }, 'b'), teammatePushTarget({ hr: 'a', manager: 'a' }, 'a', 'hr')],
    [{ destination: 'employee_profile' }, null, null]);
  const curT = await design.templateDesign(ORG, def.id);
  await design.saveTemplateDesign(ORG, def.id, { ...curT, team: { ...curT.team, remindLate: false } } as never);
  // Sana past her final month with no review: the manager's late confirmation review is the one row that pushes.
  const sanaTj = (await engine.loadJourney(J2)).tj!;
  await journeys().updateOne({ id: J2 }, { $set: { tj: rules.addDaysKey(today, -400) } });
  ok('Switched off in the template: a running joiner keeps the version they started with (still reminded)', (await jobs.lateTeamRowReminders(await engine.loadJourney(J2), await engine.tasksOf(J2), today)) === 1);
  eq('…only the late confirmation review, to Meera, opening the review', await pushTargets('lifecycle_team_task_late', J2), { meera: 'lifecycle_confirmation_review' });
  await journeys().updateOne({ id: J2 }, { $set: { tj: sanaTj } });
  await users().insertMany([person('j5', 'Kavya Iyer', { managerUserId: 'mgr', hrPrimaryUserId: 'hr' }), person('j6', 'Dev Arora', { managerUserId: 'mgr', hrPrimaryUserId: 'hr' })] as never[]);
  const J5 = await mk('j5', 'Kavya Iyer', 'mgr', rules.addDaysKey(today, -400));
  eq('…a joiner who starts after the save: none', await jobs.lateTeamRowReminders(await engine.loadJourney(J5), await engine.tasksOf(J5), today), 0);
  await design.saveTemplateDesign(ORG, def.id, { ...curT, team: { ...curT.team, remindLate: true } } as never);

  section('Confirmation: review → approval');
  await journeys().updateOne({ id: J2 }, { $set: { tj: rules.addDaysKey(today, -170) } });
  eq('The final month: Meera’s Actions card "Confirmation review for Sana"', (await team.confirmationsFor(MEERA)).map((c) => [c.journeyId, c.kind, c.title]), [[J2, 'review', 'Confirmation review for Sana']]);
  eq('…on /lifecycle/me too', ((await app.lifecycleMe(MEERA)) as { confirmations?: Array<{ kind: string }> }).confirmations?.map((c) => c.kind), ['review']);
  eq('…none for Anita yet', (await team.confirmationsFor(HOD)).length, 0);
  const reviewFacts = await team.reviewView(MEERA, J2);
  eq('The review carries the joiner for its header', [reviewFacts.joiner.name, reviewFacts.joiner.first, reviewFacts.joiner.initials], ['Sana Khan', 'Sana', 'SK']);
  ok('Review facts: goals, check-ins, confirmation discussion', reviewFacts.facts.some((f) => f.label === 'Monthly goals') && reviewFacts.facts.some((f) => f.label === 'Check-ins'), reviewFacts);
  eq('Approval before the review: waiting', (await team.approvalViewV2(HOD, J2)).state, 'waiting');
  const sentReview = await team.sendReview(MEERA, J2, { outcome: 'confirm', kpis: 'Met most', strengths: 'Calm', next: 'Reports' });
  eq('Sent: the answer is the review as it now is', sentReview.sent?.outcome, 'confirm');
  eq('…Meera’s card goes; Anita’s comes: "Approve Sana’s confirmation"', [(await team.confirmationsFor(MEERA)).length, (await team.confirmationsFor(HOD)).map((c) => c.title)], [0, ['Approve Sana’s confirmation']]);
  eq('…and Anita’s push opens the approval', (await pushTargets('lifecycle_confirmation_review', J2)).hod, 'lifecycle_confirmation_approval');
  eq('The head of department: ready, the three answers', [(await team.approvalViewV2(HOD, J2)).state, (await team.approvalViewV2(HOD, J2)).recommendation?.strengths], ['ready', 'Calm']);
  await team.answerApprovalV2(HOD, J2, { action: 'extend', extendMonths: 2, comment: 'Two more months' });
  const sanaJ = await engine.loadJourney(J2);
  eq('Extend: on the confirmation record HR decides from', [sanaJ.probation?.hodApproval?.outcome, sanaJ.probation?.hodApproval?.extendMonths], ['extended', 2]);
  eq('Answered once', await refusal(() => team.answerApprovalV2(HOD, J2, { action: 'approve' })), 409);
  eq('…Anita’s card goes', (await team.confirmationsFor(HOD)).length, 0);
  // Approve agrees with the manager: approving a recommendation to extend extends, by the manager's months.
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.recommendation.outcome': 'extend', 'probation.recommendation.extendMonths': 1 }, $unset: { 'probation.hodApproval': '', 'teamTasks.hod_approve': '' } });
  await team.answerApprovalV2(HOD, J2, { action: 'approve' });
  const approvedExt = (await engine.loadJourney(J2)).probation?.hodApproval;
  eq('Approving a recommendation to extend: extended, by the manager’s month', [approvedExt?.outcome, approvedExt?.extendMonths], ['extended', 1]);
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.recommendation.outcome': 'confirm', 'probation.hodApproval.extendMonths': 2 }, $unset: { 'probation.recommendation.extendMonths': '' } });
  const letterRow = async () => (await rowDoneNow(J2, 'hr_confirmation_letter')) === true;
  eq('HR’s letter row: not done before the letter', await letterRow(), false);
  // HR's decision on the board (its own rules are lifecycle:check's): confirm.
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.decision': { outcome: 'confirm', decidedAt: new Date(), decidedByName: 'Ritu Sharma' } } });
  const lettersSvc = await import('../services/lifecycle/letters');
  await lettersSvc.closeLetterTask(HR, { id: 'letter-check', org: ORG, kind: 'confirmation', journeyId: J2 } as never);
  ok('…done once the confirmation letter is sent from the dashboard', await letterRow());

  section('Kept templates: a save is read at once, and reaches new joiners only');
  readCache.enableLifecycleReadCache(true);
  const before = await design.onboardingTemplatesOf(ORG);
  const cur = await design.templateDesign(ORG, def.id);
  await design.saveTemplateDesign(ORG, def.id, {
    ...cur, meetings: cur.meetings.map((m) => (m.title === 'Salary and tax' ? { ...m, title: 'Salary, tax and PF' } : m)),
    // A "Fill in a form" task with the five answer types (the app's one renderer).
    tasks: [...cur.tasks, { title: 'Your welcome kit', type: 'form', stage: 'd1', questions: [
      { text: 'Your name on the ID card', type: 'short' }, { text: 'Anything we should know', type: 'long' },
      { text: 'T-shirt size', type: 'choice', options: ['S', 'M', 'L'] }, { text: 'Date of birth', type: 'date' }, { text: 'A photo for the ID card', type: 'file' },
    ] }],
  } as never);
  const after = await design.onboardingTemplatesOf(ORG);
  ok('The kept copy is dropped by the save', before.get(def.id)?.tasks.some((t) => t.title === 'Salary and tax') && after.get(def.id)?.tasks.some((t) => t.title === 'Salary, tax and PF'));
  ok('A running joiner keeps the version they started with', (await joiner.joinerOnboarding(PRIYA)).meetings.some((m) => m.title === 'Salary and tax')
    && !(await joiner.joinerOnboarding(PRIYA)).meetings.some((m) => m.title === 'Salary, tax and PF'));
  await mk('j6', 'Dev Arora', 'mgr', rules.addDaysKey(today, -3));
  ok('A joiner who starts after the save reads the new title', (await joiner.joinerOnboarding(me('j6', 'Dev Arora'))).meetings.some((m) => m.title === 'Salary, tax and PF'));
  const DEV = me('j6', 'Dev Arora');
  const formRow = (await joiner.joinerOnboarding(DEV)).tasks.find((t) => t.title === 'Your welcome kit')!;
  ok('Form task: opens the form', !!(formRow?.opens as { form?: true }).form && formRow.type === 'form', formRow);
  const blank = (await joiner.joinerForm(DEV, formRow.id)).form;
  eq('…the five types in order, the choice’s options', [blank.questions.map((q) => q.type), blank.questions[2].options, 'sentAt' in blank], [['short', 'long', 'choice', 'date', 'file'], ['S', 'M', 'L'], false]);
  eq('…a choice outside its options is refused', await refusal(() => joiner.sendJoinerForm(DEV, formRow.id, { answers: [{ questionId: blank.questions[2].id, value: 'XL' }] })), 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await joiner.uploadJoinerFormFile(DEV, formRow.id, { originalname: 'me.png', buffer: png });
  const q = blank.questions;
  const formSent = (await joiner.sendJoinerForm(DEV, formRow.id, { answers: [
    { questionId: q[0].id, value: 'Dev Arora' }, { questionId: q[1].id, value: '' }, { questionId: q[2].id, value: 'M' }, { questionId: q[3].id, value: '1999-04-02' }, { questionId: q[4].id, value: up.fileId },
  ] })).form as typeof blank & { files?: Record<string, string> };
  ok('Submit: saved to the profile, read back with the file’s name; the task is done', !!formSent.sentAt && formSent.answers?.[2].value === 'M' && formSent.answers?.[1].value === null && formSent.files?.[up.fileId] === up.name
    && (await engine.loadJourney((await joiner.joinerOnboarding(DEV)).journeyId)).forms?.[formRow.id]?.answers.length === 5
    && (await joiner.joinerOnboarding(DEV)).tasks.find((t) => t.id === formRow.id)?.state === 'done', formSent);
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
  ok('…what it would switch off and add, and the running journey it would give the rows to', dry[0].switchedOff.includes('Week-1 tasks') && dry[0].added.length === 51 && dry[0].signOnDay1 && dry[0].journeys === 1, dry[0]);
  ok('…the dry run gives no journey anything', !(await engine.loadJourney(oldJ.id)).templateSnapshot.tasks.some((t) => t.design));
  await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG });
  const migrated = await templates.getTemplate(ORG, 'old-tpl');
  ok('Applied: design rows, old rows switched off (never deleted), probation kept at 3',
    migrated.tasks.filter((t) => t.design).length === 52 && migrated.tasks.some((t) => t.systemKey === 'week1_reels' && !t.enabled && t.replacedBy === 'final_designs') && migrated.settings.probationMonths === 3, migrated.tasks.length);
  eq('Again: nothing to do', (await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG })).length, 0);
  const standard = (await templates.getTemplate(ORG, def.id)).tasks.filter((t) => ['hr_hand_kit', 'hr_check_form', 'hr_confirmation_letter'].includes(t.team?.key ?? ''));
  eq('HR’s hand over, joining form and letter rows carry the canvas’s how-to lines', standard.map((t) => t.design?.how),
    ['ID card, welcome kit, notebook and pen.', 'Answers arrive in the HR inbox. Tick this once they’re in.', 'From Document templates, once the confirmation is approved.']);
  // A design template saved before those lines existed: the migration adds them (dry run first).
  await lifecycleTemplates().updateOne({ org: ORG, id: 'old-tpl' }, { $unset: { 'tasks.$[t].design.how': '' } }, { arrayFilters: [{ 't.team.key': { $in: ['hr_hand_kit', 'hr_check_form', 'hr_confirmation_letter'] } }] });
  const howDry = await migrate.migrateTemplatesToFinalDesigns({ apply: false, org: ORG });
  ok('Dry run: lists the three how-to lines, writes nothing', howDry.length === 1 && howDry[0].howAdded?.length === 3
    && !(await templates.getTemplate(ORG, 'old-tpl')).tasks.some((t) => t.team?.key === 'hr_check_form' && t.design?.how), howDry);
  await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG });
  ok('Applied: the lines are on the template; again: nothing to do', (await templates.getTemplate(ORG, 'old-tpl')).tasks.find((t) => t.team?.key === 'hr_check_form')?.design?.how === 'Answers arrive in the HR inbox. Tick this once they’re in.'
    && (await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG })).length === 0);
  const keys = migrated.tasks.flatMap((t) => (t.team ? [t.team.key] : []));
  ok('No team key twice (the old Approve keeps its own)', new Set(keys).size === keys.length && keys.includes('hod_approve_20nov'), keys);
  const resaved = await templates.updateTemplate(ORG, 'old-tpl', { tasks: migrated.tasks });
  ok('The older editor can still save a migrated template', resaved.tasks.length === migrated.tasks.length);
  eq('The running journey keeps its tasks', await journeyTasks().countDocuments({ journeyId: oldJ.id }), oldTasksBefore);
  const oldSnap = (await engine.loadJourney(oldJ.id)).templateSnapshot;
  eq('…and gets the meetings, check-ins, watch list and teammate rows as its own snapshot (no tasks or accesses), its probation and signing place kept',
    [oldSnap.tasks.filter((t) => t.design).length, oldSnap.tasks.some((t) => t.design?.section === 'task' || t.design?.section === 'access'), oldSnap.settings.probationMonths, oldSnap.settings.signLettersOnDay1 === true, !!oldSnap.settings.preboarding],
    [38, false, 3, false, true]);
  const oldView = await design.templateDesign(ORG, 'old-tpl');
  await design.saveTemplateDesign(ORG, 'old-tpl', { ...oldView, meetings: oldView.meetings.map((m) => (m.title === 'First goals' ? { ...m, title: 'Your first goals' } : m)) } as never);
  ok('…so a later edit of the migrated template does not reach it', (await joiner.joinerOnboarding(me('j3', 'Rahul Verma'))).meetings.some((m) => m.title === 'First goals'));
  const oldHome = await joiner.joinerOnboarding(me('j3', 'Rahul Verma'));
  ok('…its new view reads: meetings from the template, its own tasks by kind', oldHome.meetings.length > 0 && oldHome.tasks.length > 0 && oldHome.step === 'w1', { m: oldHome.meetings.length, t: oldHome.tasks.length });
  ok('…and the 20 Nov home still answers for older app builds', !!(await app.onboardingHome(me('j3', 'Rahul Verma'))).journeyId);
  // 23 Nov: on such a journey every tap on an old task answered 404. A Read and acknowledge one now ticks; the tour
  // and the face stay with their own screens.
  const oldAck = (await engine.tasksOf(oldJ.id)).find((t) => t.kind === 'ack' && t.ownerRole === 'employee' && t.status !== 'done' && t.status !== 'locked' && t.status !== 'cancelled');
  if (oldAck) eq('An old task taps through (Read and acknowledge)', (await joiner.joinerTaskAction(me('j3', 'Rahul Verma'), oldAck.id, { action: 'acknowledged' })).tasks.find((t) => t.id === oldAck.id)?.state, 'done');
  const oldTour = (await engine.tasksOf(oldJ.id)).find((t) => t.kind === 'tour' && t.ownerRole === 'employee');
  if (oldTour) eq('…an old tour task is done from its own screen (409, not 404)', await refusal(() => joiner.joinerTaskAction(me('j3', 'Rahul Verma'), oldTour.id, { action: 'opened' })), 409);

  section('Adopting the design on a running journey');
  const dryAdopt = await engine.adoptTemplateDesign(oldJ.id, { dry: true });
  ok('Dry run: lists the design tasks it would add and the old open tasks it would cancel, changes nothing',
    dryAdopt.added.includes('Review your shift details') && dryAdopt.cancelled.includes('Week-1 tasks') && !(await engine.loadJourney(oldJ.id)).templateSnapshot.tasks.some((t) => t.design?.section === 'task'), dryAdopt);
  const doneBefore = (await engine.tasksOf(oldJ.id)).filter((t) => t.status === 'done').length;
  await engine.adoptTemplateDesign(oldJ.id);
  const adopted = await joiner.joinerOnboarding(me('j3', 'Rahul Verma'));
  ok('Applied: the joiner sees the design tasks (and no old Week-1 tasks)', adopted.tasks.some((t) => t.title === 'Review your shift details') && !adopted.tasks.some((t) => t.title === 'Week-1 tasks'), adopted.tasks.map((t) => t.title));
  eq('…done tasks stay done', (await engine.tasksOf(oldJ.id)).filter((t) => t.status === 'done').length >= doneBefore, true);
  const shift = adopted.tasks.find((t) => t.title === 'Review your shift details')!;
  eq('…and a design task taps through (Looks good)', (await joiner.joinerTaskAction(me('j3', 'Rahul Verma'), shift.id, { action: 'looks_good' })).tasks.find((t) => t.id === shift.id)?.state, 'done');
  eq('Again: nothing more to add', (await engine.adoptTemplateDesign(oldJ.id, { dry: true })).added.length, 0);

  // ───────────────────────────────────────────── the automatic Day-1 pass
  section('Day-1 pass: made by the server at Tj − 7 from the template');
  const autoPass = await import('../services/lifecycle/day1PassAuto');
  const board = await import('../services/lifecycle/board');
  const { lifecycleMeetings, letters: lettersCol } = await import('../config/db');
  const emails = await import('../services/lifecycle/emails');
  const portalSvc = await import('../services/lifecycle/portal');
  const nowAt = new Date();
  const preJoin = async (name: string, tj: string) => {
    const J = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name, personalEmail: `${name.split(' ')[0].toLowerCase()}@mail.test` } as never, tj, managerUserId: 'mgr', department: 'Operations' });
    await journeys().updateOne({ id: J.id }, { $set: { status: 'docs_approved', buddyUserId: 'meera' } });
    return J.id;
  };
  const P1 = await preJoin('Arjun Nair', rules.addDaysKey(today, 12));
  const P2 = await preJoin('Bela Roy', rules.addDaysKey(today, 5));   // already inside the week, no pass yet
  eq('More than a week away: no pass yet', [await autoPass.ensureAutoDay1Pass(await engine.loadJourney(P1), nowAt), (await engine.loadJourney(P1)).day1Pass], [null, undefined]);
  await portalSvc.runPortalJobs(nowAt);
  const autoMade = (await engine.loadJourney(P2)).day1Pass!;
  ok('Inside the week with no pass: the next job run makes it, marked automatic', !!autoMade?.auto?.at && autoMade.date === rules.addDaysKey(today, 5), autoMade);
  eq('…from the template: reporting time, place, map link, who to ask for (HR), manager, buddy',
    [autoMade.reportingTime, autoMade.place, autoMade.mapLink, autoMade.askFor?.name, autoMade.managerName, autoMade.buddyName],
    ['09:30', 'Reception, Pune office', 'https://www.google.com/maps/search/?api=1&query=18.52,73.85', 'Ritu Sharma', 'Sunny Kapoor', 'Meera Joshi']);
  eq('…the agenda: the template’s Day-1 meetings, one after another from the reporting time, with who',
    autoMade.agenda?.map((a) => `${a.time} ${a.title} · ${a.with}`), ['10:00 Welcome and documents · Ritu Sharma', '10:30 First goals · Sunny Kapoor', '11:00 How the team works · Meera Joshi']);
  ok('…its lines are the template’s (tpl- ids, no task of their own)', autoMade.agenda!.every((a) => a.id!.startsWith('tpl-') && a.taskKey === null), autoMade.agenda);
  ok('…and an HR contact', !!autoMade.hrContact?.name, autoMade.hrContact);
  eq('Still more than a week away after the job: none for the other joiner', (await engine.loadJourney(P1)).day1Pass, undefined);
  const passRead = await portalSvc.portalPass(await engine.loadJourney(P2), nowAt);
  eq('The portal’s pass reads it (manager named as now)', [passRead.date, passRead.reportingTime, passRead.place, passRead.managerName, passRead.agenda?.length], [rules.addDaysKey(today, 5), '09:30', 'Reception, Pune office', 'Sunny Kapoor', 3]);
  eq('Run again: nothing changes (same pass, same day made)', [await autoPass.ensureAutoDay1Pass(await engine.loadJourney(P2), new Date(nowAt.getTime() + 3_600_000)), String((await engine.loadJourney(P2)).day1Pass?.auto?.at)], [null, String(autoMade.auto!.at)]);
  await board.updateJourneyByHr(ORG, P2, { buddyUserId: 'rohan' });
  eq('A new buddy: the automatic pass names them at once', (await engine.loadJourney(P2)).day1Pass?.buddyName, 'Rohan Das');
  await engine.moveTj(P2, rules.addDaysKey(today, 6));
  const moved = (await engine.loadJourney(P2)).day1Pass;
  eq('The joining date moves within the week: the pass follows it (still automatic)', [moved?.date, !!moved?.auto], [rules.addDaysKey(today, 6), true]);
  await engine.moveTj(P2, rules.addDaysKey(today, 20));
  eq('…moves more than a week away: cleared, to be made again at the new Tj − 7', (await engine.loadJourney(P2)).day1Pass, undefined);
  await engine.moveTj(P2, rules.addDaysKey(today, 4));
  await autoPass.makeAutoDay1Passes([ORG], nowAt);
  ok('…and made again once inside the week', (await engine.loadJourney(P2)).day1Pass?.date === rules.addDaysKey(today, 4) && !!(await engine.loadJourney(P2)).day1Pass?.auto);
  // Templates › Edit joiners: a joiner moved to another template gets that template's Day-1 meetings on the automatic pass.
  const onTpl = await templates.getTemplate(ORG, (await engine.loadJourney(P2)).templateId);
  const opsTpl = await templates.createTemplate(ORG, { kind: 'onboarding', name: 'Operations joiners', copyFromId: onTpl.id }, 'HR');
  const opsDesign = await design.templateDesign(ORG, opsTpl.id);
  await design.saveTemplateDesign(ORG, opsTpl.id, { ...opsDesign, meetings: opsDesign.meetings.map((m) => (m.title === 'First goals' ? { ...m, title: 'Your first goals' } : m)) } as never, 'HR');
  const movedOps = await board.moveJourneysToTemplate(ORG, opsTpl.id, { journeyIds: [P2] });
  const opsPass = (await engine.loadJourney(P2)).day1Pass;
  eq('Moved to another template (Edit joiners): the automatic pass takes its Day-1 meetings',
    [movedOps.moved.length, (await engine.loadJourney(P2)).templateId === opsTpl.id, opsPass?.agenda?.map((a) => a.title), !!opsPass?.auto], [1, true, ['Welcome and documents', 'Your first goals', 'How the team works'], true]);
  await board.moveJourneysToTemplate(ORG, onTpl.id, { journeyIds: [P2] });
  eq('…and moved back, the template’s own again', (await engine.loadJourney(P2)).day1Pass?.agenda?.map((a) => a.title), ['Welcome and documents', 'First goals', 'How the team works']);
  await board.updateJourneyByHr(ORG, P2, { day1Pass: { ...(await engine.loadJourney(P2)).day1Pass, reportingTime: '08:45' } });
  const hrPass = (await engine.loadJourney(P2)).day1Pass!;
  eq('HR edits it: HR’s pass now (no automatic mark), HR’s time kept', [hrPass.auto, hrPass.reportingTime, hrPass.place], [undefined, '08:45', 'Reception, Pune office']);
  await portalSvc.runPortalJobs(new Date(nowAt.getTime() + 2 * 3_600_000));
  await engine.moveTj(P2, rules.addDaysKey(today, 3));
  const afterHr = (await engine.loadJourney(P2)).day1Pass!;
  eq('…the job and a moved joining date leave HR’s pass alone', [afterHr.auto, afterHr.reportingTime, afterHr.date], [undefined, '08:45', rules.addDaysKey(today, 4)]);
  // Its agenda lines are the template's Day-1 meetings: they make no meeting rows of their own.
  await engine.moveTj(P1, rules.addDaysKey(today, 2));
  await autoPass.makeAutoDay1Passes([ORG], nowAt);
  await journeys().updateOne({ id: P1 }, { $set: { userId: 'rohan' } });
  await engine.syncDay1Meetings(P1);
  eq('The automatic agenda makes no meeting rows (the template’s meetings are already the joiner’s)', [(await engine.loadJourney(P1)).day1Pass?.agenda?.length, await lifecycleMeetings().countDocuments({ journeyId: P1 })], [3, 0]);
  await journeys().updateOne({ id: P1 }, { $unset: { userId: '' } });

  // ───────────────────────────────────────────── the confirmation letter
  section('Confirmed: the confirmation letter to the work email');
  await users().insertOne(person('j7', 'Tara Menon', { managerUserId: 'mgr', department: 'Operations', designation: 'Counsellor', employeeId: 'SWT-077' }) as never);
  const J7 = await mk('j7', 'Tara Menon', 'mgr', rules.addDaysKey(today, -182));
  const HR_ACTOR = { org: ORG, userId: 'hr', name: 'Ritu Sharma', seesPay: true };
  eq('Before the decision: no "Confirmed on" value', (await lettersSvc.mergeValues(ORG, { kind: 'confirmation', journeyId: J7 }, 'Ritu Sharma')).values.confirmedOn, '');
  const draft = await lettersSvc.createLetter(HR_ACTOR, { kind: 'confirmation', journeyId: J7 });
  eq('Sending before the decision to confirm is refused', await refusal(() => lettersSvc.sendConfirmationLetter(HR_ACTOR, draft.id)), 409);
  await journeys().updateOne({ id: J7 }, { $set: { 'probation.decision': { outcome: 'confirm', decidedAt: new Date('2026-11-20T06:00:00Z'), decidedByName: 'Ritu Sharma' } } });
  const merged7 = await lettersSvc.mergeValues(ORG, { kind: 'confirmation', journeyId: J7 }, 'Ritu Sharma');
  eq('The letter is stamped with the decision date ("Confirmed on")', merged7.values.confirmedOn, emails.formatDay('2026-11-20'));
  const confLetter = await lettersSvc.createLetter(HR_ACTOR, { kind: 'confirmation', journeyId: J7 });
  eq('…kept on the letter it makes', confLetter.values.confirmedOn, emails.formatDay('2026-11-20'));
  eq('No PDF yet: refused', await refusal(() => lettersSvc.sendConfirmationLetter(HR_ACTOR, confLetter.id)), 409);
  const { PDFDocument: PdfDoc } = await import('pdf-lib');
  const pdfDoc = await PdfDoc.create();
  pdfDoc.addPage();
  await lettersSvc.uploadLetterPdf(HR_ACTOR, confLetter.id, { originalname: 'Confirmation letter – Tara Menon.pdf', buffer: Buffer.from(await pdfDoc.save()) });
  await users().updateOne({ userId: 'j7' }, { $unset: { email: '' } });
  const noEmail = await lettersSvc.sendConfirmationLetter(HR_ACTOR, confLetter.id).then(() => null, (e: { statusCode?: number; message?: string }) => e);
  ok('No work email on the account: a clear refusal', noEmail?.statusCode === 409 && /no work email/.test(noEmail.message ?? ''), noEmail);
  await users().updateOne({ userId: 'j7' }, { $set: { email: 'Tara.Menon@check.test' } });
  eq('Another company’s HR cannot send it', await refusal(() => lettersSvc.sendConfirmationLetter({ ...HR_ACTOR, org: 'someone-else' }, confLetter.id)), 404);
  emails.clearLifecycleOutbox();
  const sentConf = await lettersSvc.sendConfirmationLetter(HR_ACTOR, confLetter.id);
  const confMails = emails.lifecycleOutbox().filter((m) => m.subject === 'Your confirmation letter');
  eq('Sent to the work email (their account’s), with the PDF', [sentConf.sentTo, confMails.length, confMails[0]?.to, confMails[0]?.attachments?.length], ['tara.menon@check.test', 1, 'tara.menon@check.test', 1]);
  ok('…the mail says when they were confirmed', (confMails[0]?.html ?? '').includes(`confirmed on ${emails.formatDay('2026-11-20')}`), confMails[0]?.html?.slice(0, 600));
  eq('Stored on the journey as the confirmation letter', (await engine.loadJourney(J7)).probation?.decision?.letterId, confLetter.id);
  const panelLetter = (await lettersSvc.journeyLettersView(J7)).find((l) => l.id === confLetter.id);
  eq('The panel reads it: sent, to whom', [panelLetter?.state, panelLetter?.sentTo, !!panelLetter?.pdfFileId], ['sent', 'tara.menon@check.test', true]);
  const extensionLetter = await lettersSvc.createLetter(HR_ACTOR, { kind: 'extension', journeyId: J7 });
  eq('Not a confirmation letter: refused', await refusal(() => lettersSvc.sendConfirmationLetter(HR_ACTOR, extensionLetter.id)), 400);
  await new Promise((r) => setTimeout(r, 5));
  const resent = await lettersSvc.sendConfirmationLetter(HR_ACTOR, confLetter.id);
  ok('Resend: the same letter again, a second mail', resent.sentAt > sentConf.sentAt && emails.lifecycleOutbox().filter((m) => m.subject === 'Your confirmation letter').length === 2
    && (await lettersCol().countDocuments({ journeyId: J7, kind: 'confirmation', 'email.sentAt': { $exists: true } })) === 1);

  section('Teams › New joiners: every teammate, Tj − 1 to Tj + 30, profile only');
  const newJoiners = await import('../services/lifecycle/teamNewJoiners');
  await users().insertMany([
    person('dev', 'Dev Malhotra', { managerUserId: 'ceo', department: 'Design', designation: 'Designer' }),
    person('j10', 'Old Joiner', { managerUserId: 'mgr', department: 'Operations' }),
    person('j11', 'Month Joiner', { managerUserId: 'mgr', department: 'Operations' }),
  ] as never[]);
  const plain = async (name: string, managerUserId: string, tj: string, department: string, status: 'finalised' | 'declined') => {
    const J = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name, personalEmail: `${name.split(' ')[0].toLowerCase()}@mail.test`, phone: '9999999999' } as never, tj, managerUserId, department, designation: 'Product designer' });
    await journeys().updateOne({ id: J.id }, { $set: { status } });
    return J.id;
  };
  const tomorrow = rules.addDaysKey(today, 1);
  const J8 = await plain('Kavya Rao', 'hod', tomorrow, 'Design', 'finalised');          // tomorrow, no account yet
  const J9 = await plain('Too Early', 'mgr', rules.addDaysKey(today, 2), 'Operations', 'finalised');
  const J12 = await plain('Not Coming', 'mgr', tomorrow, 'Operations', 'declined');
  const J10 = await mk('j10', 'Old Joiner', 'mgr', rules.addDaysKey(today, -31));
  const J11 = await mk('j11', 'Month Joiner', 'mgr', rules.addDaysKey(today, -30));
  await journeys().insertOne({ id: 'other-co-j', org: 'other-co', kind: 'onboarding', status: 'finalised', tj: today, managerUserId: 'mgr', department: 'Operations', candidate: { name: 'Elsewhere Person', personalEmail: 'x@mail.test' }, anchors: {} } as never);
  const seen = async (userId: string, name: string) => (await newJoiners.newJoinersForTeammate(me(userId, name))).joiners;
  const ids = (list: Array<{ journeyId: string }>) => list.map((r) => r.journeyId);
  const rohanSees = await seen('rohan', 'Rohan Das');
  eq('Rohan (Operations, reports to Sunny): Priya as her buddy, Month Joiner (Tj + 30) as a peer',
    [rohanSees.find((r) => r.journeyId === J1)?.relation, rohanSees.find((r) => r.journeyId === J11)?.relation], ['buddy', 'peer']);
  ok('…not Tj + 31, Tj − 2, a declined offer, nor the other company’s joiner', ![J10, J9, J12, 'other-co-j'].some((id) => ids(rohanSees).includes(id)));
  const priyaCard = rohanSees.find((r) => r.journeyId === J1)!;
  eq('Priya’s card: her account opens the profile, "Joined <day>", role and department',
    [priyaCard.userId, priyaCard.joiningLine, priyaCard.department, priyaCard.initials, priyaCard.profileNote], ['j1', `Joined ${newJoiners.dayLabel(rules.addDaysKey(today, -5))}`, 'Operations', 'PS', undefined]);
  const meeraSees = await seen('meera', 'Meera Joshi');
  const kavya = meeraSees.find((r) => r.journeyId === J8);
  eq('Meera (reports to Anita, like Kavya): Kavya as a peer, "Joins tomorrow", no account yet; Priya by department',
    [kavya?.relation, kavya?.joiningLine, kavya?.userId, kavya?.profileNote, kavya?.designation, meeraSees.find((r) => r.journeyId === J1)?.relation],
    ['peer', 'Joins tomorrow', undefined, 'Profile opens on their first day', 'Product designer', 'department']);
  eq('Newest first: joining tomorrow on top', ids(meeraSees)[0], J8);
  eq('Dev (Design): only Kavya, by department', [ids(await seen('dev', 'Dev Malhotra')), (await seen('dev', 'Dev Malhotra'))[0]?.relation], [[J8], 'department']);
  eq('Sunny (the manager) sees his joiners as their manager', (await seen('mgr', 'Sunny Kapoor')).find((r) => r.journeyId === J1)?.relation, 'manager');
  eq('The head of department sees them too: Anita (Sunny’s manager) Priya, Neha (Anita’s manager) Kavya',
    [(await seen('hod', 'Anita Desai')).find((r) => r.journeyId === J1)?.relation, (await seen('ceo', 'Neha Verma')).find((r) => r.journeyId === J8)?.relation], ['head', 'head']);
  ok('Priya does not see herself', !ids(await seen('j1', 'Priya Shah')).includes(J1));
  eq('No department and no manager in common: nothing', (await seen('it', 'Imran Khan')).length, 0);
  eq('Another company’s viewer: nothing of this one', (await newJoiners.newJoinersForTeammate({ userId: 'rohan', name: 'Rohan Das', org: 'other-co' })).joiners.length, 0);
  await journeys().updateOne({ id: J8 }, { $set: { appAccess: { userId: 'dev', createdAt: new Date(), byUserId: 'hr', byName: 'Ritu Sharma' } } });
  eq('An account made before joining ("Generate app access") opens the profile', (await seen('meera', 'Meera Joshi')).find((r) => r.journeyId === J8)?.userId, 'dev');
  await users().updateOne({ userId: 'dev' }, { $set: { hiddenFromDirectory: true } });
  eq('…unless the directory hides it', (await seen('meera', 'Meera Joshi')).find((r) => r.journeyId === J8)?.profileNote, 'Profile opens on their first day');
  await users().updateOne({ userId: 'dev' }, { $unset: { hiddenFromDirectory: '' } });
  await journeys().updateOne({ id: J8 }, { $unset: { appAccess: '' } });
  eq('Joining lines: tomorrow, today (not yet marked joined / joined), a later date', [newJoiners.joiningLine('2026-12-01', '2026-11-30', false), newJoiners.joiningLine('2026-11-30', '2026-11-30', false), newJoiners.joiningLine('2026-11-30', '2026-11-30', true), newJoiners.joiningLine('2026-11-30', '2026-12-05', true)],
    ['Joins tomorrow', 'Joins today', 'Joined today', 'Joined Mon 30 Nov']);
  ok('Kept per company and dropped by every lifecycle write', readCache.kindsChangedBy('/lifecycle/team/joiners/x/review').includes('lc-new-joiners' as never));

  await closeDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

export {};
