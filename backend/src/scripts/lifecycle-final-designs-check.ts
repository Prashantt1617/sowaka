/**
 * Onboarding · Final designs (docs/lifecycle/FINAL-DESIGNS.md) against their rules, in-process, on
 * its own scratch database: the seed is the canvas's, the editor's design view saves and validates,
 * stages place rows, and every surface reads the same tick — the joiner, the manager, the buddy,
 * the head of department, HR and IT & admin. Also the migration of an older template and an older
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

  const { connectDb, getDb, closeDb, companies, users, journeys, journeyTasks, lifecycleTemplates, policyDocuments } = await import('../config/db');
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
  let hrPage = await staff.staffJoinerPage(HR, J1);
  ok('…and HR sees the same row done', hrPage.tasks.find((t) => t.id === 'hr_welcome')?.done === true, hrPage.tasks.map((t) => [t.id, t.done]));
  await meetings.markMeetingRowMet(PRIYA, await engine.loadJourney(J1), welcome.id, { action: 'unmet' });
  ok('Unticked by the joiner: undone for HR too', (await staff.staffJoinerPage(HR, J1)).tasks.find((t) => t.id === 'hr_welcome')?.done === false);
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
  eq('Reach out after joining: 4 ways in a company without the Games tab (no dead "Send a game")', mgrPage.reachOut, ['feed', 'announcement', 'team_post', 'chat']);
  await companies().updateOne({ id: ORG }, { $set: { enabledTabs: ['games'] } });
  eq('…5 with it', (await team.teamJoinerPage(MGR, J1)).reachOut.length, 5);
  await companies().updateOne({ id: ORG }, { $unset: { enabledTabs: '' } });
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
  const invites = await pushTargets('lifecycle_meeting_invite', J1);
  ok('Invites: the joiner → her home; HR / IT & admin → their person page; the buddy → the Teams person page',
    invites.j1 === 'lifecycle_onboarding' && invites.hr === 'lifecycle_staff:hr' && invites.it === 'lifecycle_staff:it' && invites.rohan === 'lifecycle_joiner', invites);
  // Lane T: the page carries the joiner's step, the manager's schedule list, and my own notes and the time on my meeting rows.
  await team.teamRowNotes(MGR, J1, 'mgr_first_goals', { notes: ['Talk about the first week'] });
  const tPage = await team.teamJoinerPage(MGR, J1);
  const firstGoals = tPage.tasks.find((t) => t.id === 'mgr_first_goals');
  ok('Team page: the step, my notes and the time on my meeting, the first-week schedule with who', typeof tPage.joiner.step === 'number'
    && firstGoals?.notes?.[0] === 'Talk about the first week' && !!firstGoals?.startsAt
    && !!tPage.schedule?.length && tPage.schedule.every((m) => (m.step === 1 || m.step === 2) && !!m.startsAt) && tPage.schedule.some((m) => m.rowKey === 'hr_welcome' && !!m.withInitials), tPage.schedule);
  ok('…the schedule list is the manager’s only (the buddy gets none)', !(await team.teamJoinerPage(me('rohan', 'Rohan Das'), J1)).schedule);

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
  const hrPanel = await (await import('../services/lifecycle/board')).journeyPanel(ORG, J1);
  eq('HR’s journey panel marks the same four for Week 1’s Devices and accesses', hrPanel.tasks.filter((t) => t.section === 'access').map((t) => t.title).sort(), ['Laptop', 'Office Wi-Fi', 'Sowaka Connect', 'Work email']);
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
  // fd-flow lane H: the kit's ticks are kept as they are made, and saving one part keeps the others.
  await staff.staffTaskAction(HR, J1, 'hr_hand_kit', { ticks: [0, 2] });
  const handLeft = await staff.staffTaskScreen(HR, J1, 'hr_hand_kit') as { done: boolean; ticks?: number[] };
  eq('Hand over: the boxes ticked are kept before it is finished', [handLeft.ticks, handLeft.done], [[0, 2], false]);
  await staff.staffTaskAction(HR, J1, 'hr_hand_kit', { action: 'done', accessCardNo: 'AC-7781', ticks: [0, 2, 3] });
  await staff.staffTaskAction(HR, J1, 'hr_hand_kit', { ticks: [0, 2, 3, 4] });
  const handDone = await staff.staffTaskScreen(HR, J1, 'hr_hand_kit') as { done: boolean; ticks?: number[]; accessCardNo?: string };
  eq('…done with its ticks and the access card number, a later tick keeping the number', [handDone.done, handDone.ticks, handDone.accessCardNo], [true, [0, 2, 3, 4], 'AC-7781']);
  eq('…a body with nothing to keep and no action is refused', await refusal(() => staff.staffTaskAction(HR, J1, 'hr_hand_kit', {})), 400);
  const connect = (access.accesses.find((a) => a.title === 'Sowaka Connect')?.details ?? []) as Array<{ label: string; value: string }>;
  ok('IT: Sowaka Connect’s setup rows say the role', connect.some((d) => d.label === 'Role' && d.value === 'Employee'), connect);
  ok('HR’s bank section has no cheque row when the documents ask for none', !hrProfile.sections.find((s) => s.key === 'bank')?.rows.some((r) => r.label === 'Cancelled cheque'));
  eq('A task that is not HR’s: 404', await refusal(() => staff.staffTaskAction(HR, J1, 'mgr_kpis', { action: 'done' })), 404);
  eq('Someone who is neither HR nor IT for her: 404', await refusal(() => staff.staffJoinerPage(MGR, J1)), 404);

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
  const hrEmergency = (await staff.staffProfile(HR, J1)).sections.find((s) => s.key === 'emergency')?.rows.find((r) => r.label === 'Mobile')?.value;
  ok('Emergency saved where pre-boarding keeps it; HR reads it', !sec('emergency').editable && hrEmergency === '+919876500003', hrEmergency);
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
  eq('…HR is told', Object.keys(await pushTargets('lifecycle_bank_pf_request', J1)), ['hr']);
  eq('Sent once while HR has it', await refusal(() => jd.sendJoinerPayroll(PRIYA, payBody())), 409);
  const boardSvc = await import('../services/lifecycle/board');
  await boardSvc.decideBankPfRequest(ORG, J1, { decision: 'decline', note: 'Use your salary account' }, { userId: 'hr', name: 'Ritu Sharma' });
  payroll = await jd.joinerPayroll(PRIYA);
  eq('HR declines: editable again, with HR’s note', [payroll.state, payroll.editable, payroll.hrNote], ['declined', true, 'Use your salary account']);
  await jd.sendJoinerPayroll(PRIYA, payBody({ bank: { holderName: 'Priya Shah', bankName: 'ICICI Bank', ifsc: 'ICIC0004321', accountNumber: '555566667777', accountNumberAgain: '555566667777' }, nominees: [{ name: 'Asha Shah', relation: 'Mother', share: 100 }] }));
  await boardSvc.decideBankPfRequest(ORG, J1, { decision: 'approve' }, { userId: 'hr', name: 'Ritu Sharma' });
  const { employeePaymentDetails } = await import('../config/db');
  const paid = await employeePaymentDetails().findOne({ org: ORG, userId: 'j1' });
  eq('HR approves: payroll has the account, holder, IFSC, UAN and nominees', [paid?.accountLast4, paid?.accountHolder, paid?.ifsc, paid?.uanLast4, paid?.nominees], ['7777', 'Priya Shah', 'ICIC0004321', '0400', [{ name: 'Asha Shah', relation: 'Mother', share: 100 }]]);
  payroll = await jd.joinerPayroll(PRIYA);
  eq('…and the form reads approved, read-only', [payroll.state, payroll.editable, payroll.bank.bankName], ['approved', false, 'ICICI Bank']);
  if (keyBefore === undefined) delete process.env.PAYROLL_FIELD_KEY; else process.env.PAYROLL_FIELD_KEY = keyBefore;

  section('Reminders for late teammate tasks');
  const jobs = await import('../services/lifecycle/jobs');
  const sentNow = await jobs.lateTeamRowReminders(await engine.loadJourney(J1), await engine.tasksOf(J1), today);
  ok('Late rows remind whoever does them, once', sentNow > 0 && (await jobs.lateTeamRowReminders(await engine.loadJourney(J1), await engine.tasksOf(J1), today)) === 0, sentNow);
  const late = await pushTargets('lifecycle_team_task_late', J1);
  ok('…HR’s and IT & admin’s open their person page, the manager’s and the buddy’s the Teams person page',
    late.hr === 'lifecycle_staff:hr' && late.mgr === 'lifecycle_joiner' && late.rohan === 'lifecycle_joiner' && (late.it ?? 'lifecycle_staff:it') === 'lifecycle_staff:it', late);
  const { teammatePushTarget } = await import('../services/lifecycle/designRows');
  eq('A teammate push with no row: read from who they are (HR and manager → Teams page)', [teammatePushTarget({ hr: 'a', it: 'b', manager: 'a' }, 'a'), teammatePushTarget({ hr: 'a', it: 'b' }, 'b')],
    [{ destination: 'lifecycle_joiner' }, { destination: 'lifecycle_staff', as: 'it' }]);
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
  // Approve agrees with the manager: approving a recommendation to extend extends, by the manager's months.
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.recommendation.outcome': 'extend', 'probation.recommendation.extendMonths': 1 }, $unset: { 'probation.hodApproval': '', 'teamTasks.hod_approve': '' } });
  await team.answerApprovalV2(HOD, J2, { action: 'approve' });
  const approvedExt = (await engine.loadJourney(J2)).probation?.hodApproval;
  eq('Approving a recommendation to extend: extended, by the manager’s month', [approvedExt?.outcome, approvedExt?.extendMonths], ['extended', 1]);
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.recommendation.outcome': 'confirm', 'probation.hodApproval.extendMonths': 2 }, $unset: { 'probation.recommendation.extendMonths': '' } });
  const letterRow = async () => ((await staff.staffTaskScreen(HR, J2, 'hr_confirmation_letter')) as { done: boolean }).done;
  eq('HR’s letter row: not done before the letter', await letterRow(), false);
  // HR's decision on the board (its own rules are lifecycle:check's): confirm.
  await journeys().updateOne({ id: J2 }, { $set: { 'probation.decision': { outcome: 'confirm', decidedAt: new Date(), decidedByName: 'Ritu Sharma' } } });
  const lettersSvc = await import('../services/lifecycle/letters');
  await lettersSvc.closeLetterTask(HR, { id: 'letter-check', org: ORG, kind: 'confirmation', journeyId: J2 } as never);
  ok('…done once the confirmation letter is sent from the dashboard, on HR’s page too', await letterRow()
    && (await staff.staffJoinerPage(HR, J2)).tasks.find((t) => t.id === 'hr_confirmation_letter')?.done === true);

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
  ok('…and so does their manager’s and HR’s side', (await team.teamJoinerPage(MGR, J1)).tasks.every((t) => t.title !== 'Salary, tax and PF') && (await staff.staffJoinerPage(HR, J1)).tasks.some((t) => t.title === 'Salary and tax'));
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
  ok('…what it would switch off and add, and the running journey it would give the rows to', dry[0].switchedOff.includes('Week-1 tasks') && dry[0].added.length === 52 && dry[0].signOnDay1 && dry[0].journeys === 1, dry[0]);
  ok('…the dry run gives no journey anything', !(await engine.loadJourney(oldJ.id)).templateSnapshot.tasks.some((t) => t.design));
  await migrate.migrateTemplatesToFinalDesigns({ apply: true, org: ORG });
  const migrated = await templates.getTemplate(ORG, 'old-tpl');
  ok('Applied: design rows, old rows switched off (never deleted), probation kept at 3',
    migrated.tasks.filter((t) => t.design).length === 53 && migrated.tasks.some((t) => t.systemKey === 'week1_reels' && !t.enabled && t.replacedBy === 'final_designs') && migrated.settings.probationMonths === 3, migrated.tasks.length);
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
    [39, false, 3, false, true]);
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

  await closeDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

export {};
