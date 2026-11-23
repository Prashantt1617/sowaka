/**
 * Onboarding · Final designs: the "Standard" template's rows, exactly the canvas's (Main.dc.html's
 * seed, in its order), plus the pre-boarding rows of the older seed that still run under the hood
 * (the offer, the portal, documents, letters, Mark joined, HR's confirmation decision) and are not
 * drawn in the editor. FINAL-DESIGNS.md §3.
 *
 * Meetings and teammate tasks are team rows (`team` set: never journey tasks; ticks on the journey);
 * joiner tasks and accesses become journey tasks with rules from their stage (designRules.ts).
 */
import type {
  DesignItem, DesignQuestion, DesignStage, LifecycleTemplateSettings, MeetWith, OwnerRole, SystemTaskKey, TaskKind, TeamRole, TeamTaskKind, TemplateTask,
} from '../../models/lifecycle.model';
import { rulesOfStage } from './designRules';
import { onboardingSeed } from './seed';

/** The older seed's rows that keep running (not drawn in the editor). */
export const MACHINERY_KEYS: SystemTaskKey[] = [
  'send_offer', 'accept_offer', 'finalise_offer', 'portal_sign_in', 'upload_documents', 'review_documents', 'about_you', 'meet_us',
  'day1_pass', 'mark_joined', 'new_joining_date', 'confirmation_discussion', 'confirmation_letter', 'confirmation_reveal',
];
/** The older seed's rows the Final designs replace (switched off by the migration; not in a new template). */
export const REPLACED_KEYS: SystemTaskKey[] = [
  'welcome_induction', 'meet_manager', 'vision_culture', 'meet_team', 'laptop_setup', 'register_face', 'app_tour', 'week1_reels', 'intro_post',
  'people_to_meet', 'starter_task', 'one_on_one_notes', 'probation_goals', 'day7_survey', 'week1_done', 'check_logins', 'monthly_goals',
  'monthly_checkin', 'monthly_review', 'pulse_survey', 'manager_30day_note', 'manager_setup', 'assign_buddy', 'device_request',
];
/** The 20 Nov team rows the Final designs replace. */
export const REPLACED_TEAM_KEYS = [
  'buddy_meet', 'buddy_show_around_old', 'buddy_policies', 'buddy_week1_old', 'buddy_tools', 'buddy_intros', 'buddy_leave_ot', 'buddy_month1_old',
  'hod_meet', 'mgr_plan_week', 'mgr_buddy_check', 'mgr_week_chat', 'mgr_mid_feedback', 'mgr_write_review', 'mgr_recommend', 'mgr_share_news',
];

/**
 * What each seeded teammate row says in the apps ({n} first name, {p} first name’s), beside the
 * template's title the dashboard shows ("Assign a buddy"), and the joiner step it pairs with.
 */
export const TEAM_APP_COPY: Record<string, { title: string; pair?: string; note?: string }> = {
  mgr_assign_buddy: { title: 'Assign {n} a buddy', pair: 'Your buddy' },
  mgr_schedule: { title: 'Schedule {p} first-week meetings', pair: 'Your first-week meetings' },
  mgr_welcome: { title: 'Send {n} a welcome message', pair: 'Message from your manager' },
  mgr_kpis: { title: 'Set {p} KPIs', pair: 'Review your KPIs' },
  mgr_feed_intro: { title: 'Introduce {n} on the feed' },
  mgr_read_checkin: { title: 'Read {p} {checkin}' },
  mgr_goal_comments: { title: 'Comment on {p} goals', pair: 'Your monthly goals' },
  mgr_confirmation_review: { title: 'Write {p} confirmation review' },
  buddy_show_around: { title: 'Show {n} around the office' },
  buddy_punch_in: { title: 'Tell {n} how punch-in works', pair: 'Sowaka tour: Punch in and out' },
  buddy_groups: { title: 'Add {n} to the team’s groups and channels' },
  hr_prepare_kit: { title: 'Prepare {p} onboarding kit' },
  hr_hand_kit: { title: 'Hand over the onboarding kit' },
  hr_check_payroll: { title: 'Check {p} payroll details', pair: 'Complete your payroll details' },
  hr_check_form: { title: 'Check {p} joining form', pair: 'Fill in the joining form' },
  hr_confirmation_letter: { title: 'Issue {p} confirmation letter' },
  it_accesses: { title: 'Set up {p} accesses', pair: 'Devices and accesses' },
  hr_accesses: { title: 'Set up {p} accesses', pair: 'Devices and accesses' },
  senior_meet: { title: 'Meet {n}, one to one or with other new joiners', pair: 'Meet someone senior' },
  hod_approve: { title: 'Approve {p} confirmation', note: 'After the manager recommends' },
};

/** The screen a seeded teammate row opens (custom rows: a tick, or HR's / IT's plain screen). */
export const TEAM_SCREEN: Record<string, string> = {
  mgr_assign_buddy: 'buddy', mgr_schedule: 'schedule', mgr_welcome: 'chat', mgr_kpis: 'plain', mgr_feed_intro: 'feed',
  mgr_read_checkin: 'checkin', mgr_goal_comments: 'goals', mgr_confirmation_review: 'review', buddy_show_around: 'around',
  buddy_groups: 'groups', hr_prepare_kit: 'kit', hr_hand_kit: 'handover', hr_check_payroll: 'payroll', hr_check_form: 'form',
  hr_confirmation_letter: 'letter', it_accesses: 'accesses', hr_accesses: 'accesses', senior_meet: 'invite', hod_approve: 'approval',
};
/** Rows a teammate may do before their step. */
export const TEAM_EARLY = new Set(['mgr_welcome', 'mgr_feed_intro', 'it_accesses', 'hr_accesses']);

const ROLE_OWNER: Record<TeamRole, OwnerRole> = { manager: 'manager', buddy: 'buddy', hr: 'hr', it: 'it', senior: 'senior', head_of_department: 'head_of_department' };
const MEET_OWNER: Record<MeetWith, OwnerRole> = { manager: 'manager', buddy: 'buddy', hr: 'hr', it: 'it', head_of_department: 'head_of_department' };
const TEAM_KIND_OF: Record<string, TeamTaskKind> = {
  mgr_assign_buddy: 'team', mgr_schedule: 'task', mgr_welcome: 'chat', mgr_kpis: 'goal', mgr_feed_intro: 'team', mgr_read_checkin: 'review',
  mgr_goal_comments: 'goal', mgr_confirmation_review: 'doc', buddy_show_around: 'team', buddy_punch_in: 'help', buddy_groups: 'help',
  hr_prepare_kit: 'task', hr_hand_kit: 'task', hr_check_payroll: 'review', hr_check_form: 'doc', hr_confirmation_letter: 'doc',
  it_accesses: 'task', senior_meet: 'meet', hod_approve: 'approve',
};
const TASK_KIND_OF_TEAM: Record<TeamTaskKind, TaskKind> = { help: 'ack', approve: 'review', review: 'review', task: 'form', meet: 'meeting', team: 'meeting', goal: 'form', doc: 'form', chat: 'post' };
const TASK_KIND_OF_TYPE: Record<NonNullable<DesignItem['taskType']>, TaskKind> = { do: 'system', review: 'review', ack: 'ack', sign: 'sign', other: 'form', form: 'form' };

const slug = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

let order = 0;
const nextOrder = () => (order += 10);

/** A meeting row (team row, owner by who they meet). */
export function meetingRow(input: { id?: string; key: string; title: string; meetWith: MeetWith; stage: DesignStage; agenda: string[]; everyMonth?: boolean; order?: number }): TemplateTask {
  const r = rulesOfStage({ section: 'meeting', stage: input.stage });
  return {
    id: input.id ?? `fd-meet-${slug(input.key)}`, phase: r.phase, title: input.title, ownerRole: MEET_OWNER[input.meetWith], kind: 'meeting', surface: 'app',
    opensRule: null, dueRule: r.dueRule, mustDo: false, enabled: true, order: input.order ?? nextOrder(),
    team: { key: input.key, kind: 'meet', ...(input.agenda.length ? { agenda: [...input.agenda] } : {}) },
    ...(input.agenda.length ? { agenda: [...input.agenda] } : {}),
    design: { section: 'meeting', stage: input.stage, meetWith: input.meetWith, ...(input.everyMonth ? { everyMonth: true } : {}) },
  };
}

/** A teammate row (team row). */
export function teamRow(input: { id?: string; key: string; title: string; role: TeamRole; stage: DesignStage; how?: string; everyMonth?: boolean; order?: number }): TemplateTask {
  const r = rulesOfStage({ section: 'team', stage: input.stage });
  const kind = TEAM_KIND_OF[input.key] ?? (input.role === 'buddy' ? 'help' : 'task');
  return {
    id: input.id ?? `fd-team-${slug(input.key)}`, phase: r.phase, title: input.title, ownerRole: ROLE_OWNER[input.role], kind: TASK_KIND_OF_TEAM[kind], surface: 'app',
    opensRule: null, dueRule: r.dueRule, mustDo: false, enabled: true, order: input.order ?? nextOrder(),
    team: { key: input.key, kind, ...(TEAM_EARLY.has(input.key) ? { early: true } : {}), ...(TEAM_APP_COPY[input.key]?.pair ? { pair: TEAM_APP_COPY[input.key].pair } : {}) },
    design: { section: 'team', stage: input.stage, role: input.role, ...(input.how ? { how: input.how } : {}), ...(input.everyMonth ? { everyMonth: true } : {}) },
  };
}

/** A joiner task (journey task through the engine). */
export function taskRow(input: { id?: string; title: string; stage: DesignStage; design: Omit<DesignItem, 'section' | 'stage'>; systemKey?: SystemTaskKey; order?: number }): TemplateTask {
  const d: DesignItem = { section: 'task', stage: input.stage, ...input.design };
  const r = rulesOfStage(d);
  return {
    id: input.id ?? `fd-task-${slug(input.title)}`, phase: r.phase, title: input.title, ownerRole: 'employee', kind: TASK_KIND_OF_TYPE[d.taskType ?? 'other'], surface: 'app',
    ...(input.systemKey ? { systemKey: input.systemKey } : {}),
    opensRule: r.opensRule, dueRule: r.dueRule, mustDo: false, enabled: true, order: input.order ?? nextOrder(), design: d,
  };
}

/** A device or access (journey task owned by IT & admin or HR). */
export function accessRow(input: { id?: string; title: string; role: 'it' | 'hr'; order?: number }): TemplateTask {
  const r = rulesOfStage({ section: 'access', stage: 'w1' });
  return {
    id: input.id ?? `fd-access-${slug(input.title)}`, phase: r.phase, title: input.title, ownerRole: input.role, kind: 'assign', surface: 'app',
    opensRule: r.opensRule, dueRule: r.dueRule, mustDo: false, enabled: true, order: input.order ?? nextOrder(),
    design: { section: 'access', stage: 'w1', role: input.role },
  };
}

/** A check-in, a watch-list item or a training (read-time rows: no journey task, no team tick). */
export function contentRow(input: { id?: string; section: 'checkin' | 'watch' | 'training'; title: string; stage: DesignStage; questions?: DesignQuestion[]; media?: DesignItem['media']; order?: number }): TemplateTask {
  const r = rulesOfStage({ section: input.section, stage: input.stage });
  return {
    id: input.id ?? `fd-${input.section}-${slug(input.title)}`, phase: r.phase, title: input.title, ownerRole: 'employee',
    kind: input.section === 'checkin' ? 'survey' : 'reel', surface: 'app', opensRule: null, dueRule: null, mustDo: false,
    // Never a journey task (engine.ts `runs` takes only task and access design rows).
    enabled: true, order: input.order ?? nextOrder(),
    design: { section: input.section, stage: input.stage, ...(input.questions ? { questions: input.questions.map((q) => ({ ...q })) } : {}), ...(input.media ? { media: { ...input.media } } : {}) },
  };
}

const q = (n: number, text: string, type: DesignQuestion['type']): DesignQuestion => ({ id: `q${n}`, text, type });

const W1_QUESTIONS: DesignQuestion[] = [
  q(1, 'How smooth was your first week?', 'rating'),
  q(2, 'Were your laptop, email and logins ready when you needed them?', 'yes_no'),
  q(3, 'Can you do the basics in the Sowaka app: punch in, apply for leave, find your payslip?', 'yes_no'),
  q(4, 'Have you met your team?', 'yes_no'),
  q(5, 'Have you had your first conversation with your manager?', 'yes_no'),
  q(6, 'Have you met someone senior in your department?', 'yes_no'),
  q(7, 'Do you know your way around the office: where to sit, eat, and who to ask?', 'yes_no'),
  q(8, 'Do you understand what your role is and what you’ll be working on?', 'rating'),
  q(9, 'What was the most confusing part of your first week?', 'long'),
];
const M1_QUESTIONS: DesignQuestion[] = [
  q(1, 'Is the role what you were told it would be?', 'rating'),
  q(2, 'Do you still feel this is the right job for you?', 'rating'),
  q(3, 'Do you feel welcome in your team?', 'rating'),
  q(4, 'Do you understand how your work connects to the company’s goals?', 'rating'),
  q(5, 'Do you get the support you need from your manager?', 'rating'),
  q(6, 'Is there any training or information you’re still missing?', 'long'),
  q(7, 'What has surprised you, good or bad, about working here?', 'long'),
];
const FIN_QUESTIONS: DesignQuestion[] = [
  q(1, 'Do you know exactly what your KPIs are?', 'yes_no'),
  q(2, 'Do you know how your performance will be measured from here?', 'rating'),
  q(3, 'How would you rate your journey from the offer to confirmation?', 'rating'),
  q(4, 'Which part of your onboarding helped you most?', 'long'),
  q(5, 'What should we change for the next person who joins?', 'long'),
  q(6, 'How likely are you to recommend working here to a friend?', 'rating'),
];

const AGENDA = {
  welcome: ['Welcome to {company} and a quick office round', 'Original documents checked against the offer', 'ID card, photo and access card', 'Attendance, punch-in and leave basics', 'Who to go to for what: HR, IT, payroll'],
  firstGoals: ['The role, and what good looks like by the end of probation', 'The team and the people you’ll work with most', 'Your plan for the first week', 'Goals for Month 1', 'How and when we’ll check in'],
  teamWorks: ['What a normal day in the team looks like', 'Tools, groups and channels the team uses', 'Lunch, breaks and where things are in the office', 'The unwritten rules', 'Who to ask for what'],
  laptop: ['Laptop and accessories handover', 'Email, Sowaka and other logins', 'Passwords and two-step sign-in', 'Wi-Fi, printers and shared drives', 'How to raise an IT request'],
  salary: ['Your salary structure and CTC break-up', 'Choosing a tax regime and declaring investments', 'PF, gratuity and insurance', 'Payday, payslips and reimbursements', 'Which proofs are needed, and by when'],
  week1: ['How the first week went', 'Anything you’re still unsure about', 'Who you haven’t met yet'],
  monthly: ['How you did on last month’s goals', 'What helped, and what got in the way', 'Goals for this month, up to three', 'The support you need'],
  month1Review: ['Your Month 1 check-in answers', 'What’s going well', 'What’s been hard', 'Progress on your KPIs', 'Feedback both ways', 'Focus for the next month'],
  month1: ['What feels easier now', 'What still feels hard', 'Anything you’d like help with'],
  confirmation: ['Your end of probation check-in', 'Your manager’s review against your KPIs', 'Feedback from the team', 'The decision: confirm or extend', 'Goals after confirmation'],
};

/** The canvas's 53 items, in its order; `company` fills "Welcome to <company> and a quick office round". */
export function finalDesignRows(company = 'the company'): TemplateTask[] {
  order = 0;
  const sign = onboardingSeed().find((t) => t.systemKey === 'sign_letters')!;
  const signRow: TemplateTask = {
    ...sign, title: 'Sign your joining documents', helper: undefined,
    ...rulesOfStage({ section: 'task', stage: 'd1' }), surface: 'app', order: nextOrder(),
    design: { section: 'task', stage: 'd1', taskType: 'sign', signDocs: ['appointment'] },
  };
  delete (signRow as Partial<TemplateTask>).helper;
  delete (signRow as Partial<TemplateTask>).after;
  return [
    signRow,
    contentRow({ section: 'watch', title: 'Welcome from HR', stage: 'pre', media: { type: 'video' } }),
    contentRow({ section: 'watch', title: 'Meet the team', stage: 'pre', media: { type: 'video' } }),
    teamRow({ key: 'mgr_schedule', title: 'Schedule their first-week meetings', role: 'manager', stage: 'pre', how: 'The meetings are already created. Pick a time for each one.' }),
    teamRow({ key: 'mgr_welcome', title: 'Send a welcome message', role: 'manager', stage: 'pre' }),
    teamRow({ key: 'mgr_kpis', title: 'Set their KPIs', role: 'manager', stage: 'pre', how: 'In Performance › KPIs. They review them in Week 1.' }),
    teamRow({ key: 'hr_prepare_kit', title: 'Prepare the onboarding kit', role: 'hr', stage: 'pre', how: 'ID card, welcome kit, notebook and pen.' }),
    taskRow({ title: 'First punch-in', stage: 'd1', design: { taskType: 'do', screen: 'punch' } }),
    taskRow({ title: 'Review your shift details', stage: 'd1', design: { taskType: 'review', screen: 'shift' } }),
    meetingRow({ key: 'hr_welcome', title: 'Welcome and documents', meetWith: 'hr', stage: 'd1', agenda: AGENDA.welcome.map((a) => a.replace('{company}', company)) }),
    meetingRow({ key: 'mgr_first_goals', title: 'First goals', meetWith: 'manager', stage: 'd1', agenda: AGENDA.firstGoals }),
    meetingRow({ key: 'buddy_team_works', title: 'How the team works', meetWith: 'buddy', stage: 'd1', agenda: AGENDA.teamWorks }),
    taskRow({ title: 'Complete your profile', stage: 'w1', design: { taskType: 'do', screen: 'profile' } }),
    taskRow({ title: 'Declare your tax and investments', stage: 'w1', design: { taskType: 'do', screen: 'tax' } }),
    taskRow({ title: 'Complete your payroll details', stage: 'w1', design: { taskType: 'do', screen: 'payroll' } }),
    taskRow({ title: 'Review your payroll policy and salary structure', stage: 'w1', design: { taskType: 'review', screen: 'payroll_policy' } }),
    taskRow({ title: 'Review your KPIs', stage: 'w1', design: { taskType: 'review', screen: 'kpis' } }),
    taskRow({ title: 'Acknowledge company policies', stage: 'd1', design: { taskType: 'ack', source: 'policies' } }),
    contentRow({ section: 'watch', title: 'Our values', stage: 'd1', media: { type: 'video' } }),
    contentRow({ section: 'watch', title: 'A day in your team', stage: 'd1', media: { type: 'video' } }),
    teamRow({ key: 'hr_hand_kit', title: 'Hand over the onboarding kit', role: 'hr', stage: 'd1', how: 'ID card, welcome kit, notebook and pen.' }),
    teamRow({ key: 'mgr_feed_intro', title: 'Introduce them on the feed', role: 'manager', stage: 'd1', how: 'Opens a ready-made post with their photo and role.' }),
    teamRow({ key: 'buddy_show_around', title: 'Show them around the office', role: 'buddy', stage: 'd1' }),
    teamRow({ key: 'buddy_punch_in', title: 'Tell them how punch-in works', role: 'buddy', stage: 'd1' }),
    teamRow({ key: 'buddy_groups', title: 'Add them to the team’s groups and channels', role: 'buddy', stage: 'd1' }),
    teamRow({ key: 'mgr_read_checkin', title: 'Read their check-ins', role: 'manager', stage: 'w1' }),
    teamRow({ key: 'hr_check_payroll', title: 'Check their payroll details', role: 'hr', stage: 'w1' }),
    teamRow({ key: 'senior_meet', title: 'Meet them, one to one or with other new joiners', role: 'senior', stage: 'w1' }),
    accessRow({ title: 'Laptop', role: 'it' }),
    accessRow({ title: 'Work email', role: 'it' }),
    accessRow({ title: 'Office Wi-Fi', role: 'it' }),
    accessRow({ title: 'Sowaka Connect', role: 'it' }),
    meetingRow({ key: 'it_laptop_help', title: 'Laptop and login help', meetWith: 'it', stage: 'w1', agenda: AGENDA.laptop }),
    meetingRow({ key: 'hr_salary_tax', title: 'Salary and tax', meetWith: 'hr', stage: 'w1', agenda: AGENDA.salary }),
    contentRow({ section: 'checkin', title: 'Week 1 check-in', stage: 'w1', questions: W1_QUESTIONS }),
    meetingRow({ key: 'buddy_week1', title: 'Week 1 catch-up', meetWith: 'buddy', stage: 'w1', agenda: AGENDA.week1 }),
    contentRow({ section: 'watch', title: 'How your department works', stage: 'w1', media: { type: 'video' } }),
    meetingRow({ key: 'mgr_monthly_goals', title: 'Monthly goals', meetWith: 'manager', stage: 'm1', agenda: AGENDA.monthly, everyMonth: true }),
    meetingRow({ key: 'mgr_month1_review', title: 'Month 1 review', meetWith: 'manager', stage: 'm1', agenda: AGENDA.month1Review }),
    contentRow({ section: 'training', title: 'Information security basics', stage: 'w1', media: { type: 'pdf' } }),
    contentRow({ section: 'training', title: 'POSH training', stage: 'm1', media: { type: 'video' } }),
    contentRow({ section: 'checkin', title: 'Month 1 check-in', stage: 'm1', questions: M1_QUESTIONS }),
    contentRow({ section: 'watch', title: 'Giving and asking for feedback', stage: 'm1', media: { type: 'video' } }),
    teamRow({ key: 'mgr_goal_comments', title: 'Comment on their goals after each monthly talk', role: 'manager', stage: 'm1', everyMonth: true }),
    meetingRow({ key: 'buddy_month1', title: 'Month 1 catch-up', meetWith: 'buddy', stage: 'm1', agenda: AGENDA.month1 }),
    contentRow({ section: 'checkin', title: 'End of probation check-in', stage: 'fin', questions: FIN_QUESTIONS }),
    meetingRow({ key: 'mgr_confirmation', title: 'Confirmation discussion', meetWith: 'manager', stage: 'fin', agenda: AGENDA.confirmation }),
    teamRow({ key: 'mgr_confirmation_review', title: 'Write the confirmation review', role: 'manager', stage: 'fin', how: 'In the app: the Actions card “Confirmation review for …”, from the final month.' }),
    teamRow({ key: 'hod_approve', title: 'Approve the confirmation', role: 'head_of_department', stage: 'fin' }),
    teamRow({ key: 'hr_confirmation_letter', title: 'Issue the confirmation letter', role: 'hr', stage: 'fin', how: 'From Document templates, once the confirmation is approved.' }),
  ];
}

/** Machinery rows from the older seed, as they are (orders kept below the design rows' orders by an offset). */
export function machineryRows(): TemplateTask[] {
  return onboardingSeed().filter((t) => t.systemKey && MACHINERY_KEYS.includes(t.systemKey)).map((t) => ({ ...t, order: 10_000 + t.order }));
}

/** A new company's Standard onboarding template: the canvas's items plus the machinery. */
export function finalOnboardingSeed(company?: string): TemplateTask[] {
  return [...finalDesignRows(company), ...machineryRows()];
}

export const FINAL_ONBOARDING_SETTINGS: LifecycleTemplateSettings = {
  probationMonths: 6, portalOpenUntil: 'week_1', signLettersOnDay1: true,
  preboarding: { offerLetter: true, joiningDetails: true, profile: true, watch: true },
  reporting: { meets: 'hr' },
  tourLessons: ['punch', 'missed', 'leave', 'overtime', 'approveLeave', 'approveOvertime'],
  remindLateTeamTasks: true,
  assignees: {},
};
