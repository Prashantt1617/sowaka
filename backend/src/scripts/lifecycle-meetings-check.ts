/**
 * The joiner's Meetings, Tasks and Your team (services/lifecycle/joinerMeetings.ts, new-joiner
 * prototype of 20 Nov) against the one-record rule, in-process, on its own scratch database:
 *
 * - the agenda is the template's (HR's edit shows at once, to the joiner and to the manager);
 * - Mark as met lands on the record the other side reads (the journey task for the manager meeting,
 *   journey.teamTasks for the buddy's), and HR's meetings stay HR's;
 * - the joiner's notes are kept for them and in no manager or HR view;
 * - Acknowledge policies counts the same acknowledgements Policies reads;
 * - Your team is the joiner's department, manager and buddy tagged.
 *
 *   npm run lifecycle:meetings-check      (MONGODB_DB=el_journey_meetings_check; local mongod only)
 */
// These flows start with the candidate accepting online, which the live server no longer allows.
process.env.OFFER_ONLINE_ACCEPT ??= '1';
process.env.MONGODB_URI = process.env.LIFECYCLE_CHECK_MONGODB_URI ?? 'mongodb://127.0.0.1:27133';
process.env.MONGODB_DB = process.env.MONGODB_DB ?? 'el_journey_meetings_check';

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
const ORG = 'el-meetings-check';

type Row = { id: string; title: string; status: string; agenda?: string[]; canTick?: boolean; withName?: string; myNotes?: string[]; systemKey?: string; progress?: { done: number; total: number } };

async function main() {
  if (!/^(mongodb:\/\/)(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI!)) throw new Error('lifecycle:meetings-check runs on a local mongod only');
  if (!/^el_journey/.test(process.env.MONGODB_DB!)) throw new Error('lifecycle:meetings-check needs its own el_journey_* database');

  const { connectDb, getDb, closeDb, companies, users, journeys, journeyTasks, meetingNotes, peopleToMeet, policyDocuments, policyAcknowledgements } = await import('../config/db');
  const templates = await import('../services/lifecycle/templates');
  const engine = await import('../services/lifecycle/engine');
  const team = await import('../services/lifecycle/teamTasks');
  const app = await import('../services/lifecycle/appOnboarding');
  const rules = await import('../services/lifecycle/dueRules');
  const seed = await import('../services/lifecycle/seed');

  await connectDb();
  await getDb().dropDatabase();

  await companies().insertOne({ id: ORG, name: 'Meetings Check Co', features: { lifecycle: true } } as never);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({ userId, name, email: `${userId}@check.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', ...extra });
  await users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true }),
    person('hod', 'Rahul Head', { role: 'manager' }),
    person('mgr', 'Sunny Manager', { role: 'manager', managerUserId: 'hod', department: 'Admissions', designation: 'Admissions lead' }),
    person('buddy', 'Meera Buddy', { managerUserId: 'mgr', department: 'Admissions', designation: 'Senior counsellor' }),
    person('col', 'Arun Colleague', { managerUserId: 'mgr', department: ' admissions ', designation: 'Counsellor' }),
    person('it', 'Imran IT', { department: 'IT', designation: 'IT helpdesk' }),
    person('gone', 'Gita Gone', { department: 'Admissions', lifecycleStatus: 'offboarded' }),
    person('svc', 'Support', { department: 'Admissions', hiddenFromDirectory: true }),
    person('j1', 'Priya Joiner', { managerUserId: 'mgr', department: 'Admissions', hrPrimaryUserId: 'hr' }),
  ] as never[]);
  const me = (userId: string, name: string) => ({ userId, name, org: ORG });
  const J1 = me('j1', 'Priya Joiner'), MGR = me('mgr', 'Sunny Manager'), BUDDY = me('buddy', 'Meera Buddy');

  await templates.ensureDefaultTemplates(ORG);
  const def = await templates.defaultTemplate(ORG, 'onboarding');
  const tj = rules.addDaysKey(rules.todayKey(), -2);
  const J = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name: 'Priya Joiner', personalEmail: 'priya@check.test', phone: '9999999999' } as never, tj, managerUserId: 'mgr', department: 'Admissions' });
  await journeys().updateOne({ id: J.id }, { $set: { status: 'joined', userId: 'j1', buddyUserId: 'buddy' } });
  await engine.refreshJourney(J.id);
  await peopleToMeet().insertOne({ id: 'p-it', org: ORG, journeyId: J.id, personUserId: 'it', why: 'Laptop and logins' });

  const rowsOf = async () => {
    const h = (await app.onboardingHome(J1)) as unknown as { today: Row[]; later: Row[]; done: Row[] };
    return [...h.today, ...h.later, ...h.done];
  };
  const tasks = await journeyTasks().find({ journeyId: J.id }).toArray();
  const meetManager = tasks.find((t) => t.systemKey === 'meet_manager')!;
  const induction = tasks.find((t) => t.systemKey === 'welcome_induction')!;

  // ───────────────────────────────────────────── agenda
  section('The agenda is the template’s, the same on both sides');
  let rows = await rowsOf();
  const seedAgenda = seed.ONBOARDING_SEED.find((t) => t.systemKey === 'meet_manager')!.agenda;
  eq('Meet your manager: the seed’s agenda', rows.find((r) => r.id === meetManager.id)?.agenda, seedAgenda);
  eq('…with the manager, tickable by the joiner', [rows.find((r) => r.id === meetManager.id)?.withName, rows.find((r) => r.id === meetManager.id)?.canTick], ['Sunny Manager', true]);
  eq('Welcome and induction: with HR, HR ticks it', [rows.find((r) => r.id === induction.id)?.withName, rows.find((r) => r.id === induction.id)?.canTick], ['Hema HR', false]);
  const buddyRow = rows.find((r) => r.id === 'team:buddy_meet');
  eq('Your buddy: a row from the buddy’s team meeting, said to the joiner', [buddyRow?.title, buddyRow?.withName, buddyRow?.agenda?.at(-1)], ['Your buddy', 'Meera Buddy', 'Anything you’re unsure about']);
  const itRow = rows.find((r) => r.id === 'person:p-it');
  eq('Someone the manager picked: their role, name and why', [itRow?.title, itRow?.withName, itRow?.agenda], ['IT helpdesk', 'Imran IT', ['Laptop and logins']]);
  ok('People to meet itself is not a meeting row (its people are)', rows.find((r) => r.systemKey === 'people_to_meet') ? !('agenda' in rows.find((r) => r.systemKey === 'people_to_meet')!) : true);

  const edited = def.tasks.map((t) => (t.systemKey === 'meet_manager' ? { ...t, agenda: ['Your role', ' Your first goals ', ''] } : t));
  await templates.updateTemplate(ORG, def.id, { tasks: edited }, 'Hema HR');
  rows = await rowsOf();
  eq('HR’s edit shows to the joiner at once (blanks dropped, trimmed)', rows.find((r) => r.id === meetManager.id)?.agenda, ['Your role', 'Your first goals']);
  const mgrPage = await team.teamJoiner(MGR, J.id);
  eq('…and to the manager on the same meeting', (mgrPage.tasks.find((t) => t.id === meetManager.id) as { agenda?: string[] } | undefined)?.agenda, ['Your role', 'Your first goals']);
  const legacy = (await app.joinerForManager(MGR, J.id)) as unknown as { tasks: Array<{ id: string; meeting?: { expect: string[] } }> };
  const legacyMeet = legacy.tasks.find((t) => t.id === meetManager.id);
  ok('…and on the meeting record the manager’s meeting screen reads (when there is one)', !legacyMeet?.meeting || JSON.stringify(legacyMeet.meeting.expect) === JSON.stringify(['Your role', 'Your first goals']), legacyMeet?.meeting);

  // ───────────────────────────────────────────── mark as met
  section('Mark as met lands on the record the other side reads');
  await app.meetingRowMet(J1, meetManager.id, { action: 'met' });
  eq('The manager meeting’s journey task is done', (await journeyTasks().findOne({ id: meetManager.id }))?.status, 'done');
  ok('…the manager’s team side shows it done', (await team.teamJoiner(MGR, J.id)).tasks.find((t) => t.id === meetManager.id)?.done === true);
  await app.meetingRowMet(J1, 'team:buddy_meet', { action: 'met' });
  ok('Your buddy: journey.teamTasks.buddy_meet, the buddy’s own tick', !!(await journeys().findOne({ id: J.id }))?.teamTasks?.buddy_meet);
  ok('…the buddy’s Teams › Joiners shows it done', (await team.teamJoiner(BUDDY, J.id)).tasks.find((t) => t.id === 'buddy_meet')?.done === true);
  rows = await rowsOf();
  eq('…and the joiner’s rows read done, no longer tickable', [rows.find((r) => r.id === 'team:buddy_meet')?.status, rows.find((r) => r.id === 'team:buddy_meet')?.canTick], ['done', false]);
  await app.meetingRowMet(J1, 'person:p-it', { action: 'met' });
  ok('Someone picked: their People to meet card is met', !!(await peopleToMeet().findOne({ id: 'p-it' }))?.metAt);
  eq('HR’s induction stays HR’s', await refusal(() => app.meetingRowMet(J1, induction.id, { action: 'met' })), 409);
  eq('An unknown row', await refusal(() => app.meetingRowMet(J1, 'team:nope', { action: 'met' })), 404);
  eq('A wrong action', await refusal(() => app.meetingRowMet(J1, meetManager.id, { action: 'undo' })), 400);

  // ───────────────────────────────────────────── notes
  section('The joiner’s notes are theirs');
  await app.meetingRowNotes(J1, meetManager.id, { notes: ['Ask about the CRM', ''] });
  rows = await rowsOf();
  eq('Kept and read back on the row', rows.find((r) => r.id === meetManager.id)?.myNotes, ['Ask about the CRM', '']);
  ok('Not in the manager’s team page', !JSON.stringify(await team.teamJoiner(MGR, J.id)).includes('Ask about the CRM'));
  ok('Not in the manager’s joiner view', !JSON.stringify(await app.joinerForManager(MGR, J.id)).includes('Ask about the CRM'));
  ok('Not on the journey HR reads', !JSON.stringify(await journeys().findOne({ id: J.id })).includes('Ask about the CRM'));
  await app.meetingRowNotes(J1, meetManager.id, { notes: ['', ''] });
  eq('Emptied: the record goes', await meetingNotes().countDocuments({ journeyId: J.id }), 0);
  eq('Not a list', await refusal(() => app.meetingRowNotes(J1, meetManager.id, { notes: 'x' })), 400);

  // ───────────────────────────────────────────── policies
  section('Acknowledge policies counts what Policies reads');
  rows = await rowsOf();
  ok('No policy needs acknowledging: no row', !rows.some((r) => r.id === 'policies'));
  const now = new Date();
  await policyDocuments().insertMany([
    { org: ORG, key: 'leave', title: 'Leave', summary: '', body: 'b', active: true, ackRequired: true, order: 1, createdAt: now, updatedAt: now },
    { org: ORG, key: 'posh', title: 'POSH', summary: '', body: 'b', active: true, ackRequired: true, order: 2, createdAt: now, updatedAt: now },
    { org: ORG, key: 'faq', title: 'FAQ', summary: '', body: 'b', active: true, ackRequired: false, order: 3, createdAt: now, updatedAt: now },
  ] as never[]);
  const { policiesFor } = await import('../services/policy-document.service');
  const leave = (await policiesFor({ userId: 'j1', org: ORG })).find((p) => p.key === 'leave')!;
  await policyAcknowledgements().insertOne({ org: ORG, userId: 'j1', key: 'leave', version: leave.version, at: now } as never);
  rows = await rowsOf();
  const pol = rows.find((r) => r.id === 'policies');
  eq('1 of 2 done, open', [pol?.title, pol?.progress, pol?.status], ['Acknowledge policies', { done: 1, total: 2 }, 'todo']);

  // ───────────────────────────────────────────── your team
  section('Your team is the department');
  const t = await app.teamForJoiner(J1);
  eq('Admissions, manager and buddy first, the leaver and the service account left out', [t.department, t.people.map((p) => [p.name, p.tag ?? ''])], ['Admissions', [['Sunny Manager', 'manager'], ['Meera Buddy', 'buddy'], ['Arun Colleague', '']]]);

  console.log(`\n${passed} passed, ${failed} failed`);
  await closeDb();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

export {};
