/**
 * The "Standard" templates every company starts with: the handover's task
 * tables T1 (onboarding) and T2 (offboarding), every row. Recommended rows are
 * in the template switched off (`recommended.added` false) until HR adds them.
 *
 * Due dates follow CONTRACT decision 4 (intro post Tj + 3, week-1 reels
 * Tj + 5, Day-7 survey opens Tj + 6 and is due Tj + 7, goals lock Tj + 7,
 * documents Tj − 5, letters Tj − 2, Day-1 pass Tj − 7, handover Tl − 7, exit
 * interview opens Tl − 5, finance Tl − 2, settlement Tl + 2 working days,
 * gratuity Tl + 30). The template's values win at runtime.
 */
import type { DueRule, LifecycleTemplateSettings, LifecyclePhase, OwnerRole, SystemTaskKey, TaskKind, TaskSurface, TeamTaskSpec, TemplateTask } from '../../models/lifecycle.model';

type Row = {
  key: SystemTaskKey;
  phase: LifecyclePhase;
  title: string;
  helper?: string;
  owner: OwnerRole;
  kind: TaskKind;
  surface: TaskSurface;
  opens?: DueRule | null;
  due?: DueRule | null;
  dueLabel?: string;
  mustDo?: boolean;
  recommended?: string;
  after?: TemplateTask['after'];
  documents?: TemplateTask['documents'];
  agenda?: string[];
};

const tj = (offset = 0, unit: DueRule['unit'] = 'days'): DueRule => ({ anchor: 'tj', offset, unit });
const tl = (offset = 0, unit: DueRule['unit'] = 'days'): DueRule => ({ anchor: 'tl', offset, unit });
const at = (anchor: DueRule['anchor'], offset = 0, unit: DueRule['unit'] = 'days'): DueRule => ({ anchor, offset, unit });
const monthStart = (month: DueRule['month'], offset = 0): DueRule => ({ anchor: 'month_start', month, offset, unit: 'days' });
const monthEnd = (month: DueRule['month'], offset = 0): DueRule => ({ anchor: 'month_end', month, offset, unit: 'days' });

const ONBOARDING_ROWS: Row[] = [
  // ── Pre-boarding · Employee 7 · HR 5 · Automatic 1 · Manager 1 (+ 1 recommended)
  { key: 'send_offer', phase: 'pre_boarding', title: 'Create the offer letter and send it', helper: 'From the offer-letter template in Documents. The email carries the PDF and a personal portal link', owner: 'hr', kind: 'letter', surface: 'dashboard', dueLabel: 'When the offer is made' },
  { key: 'accept_offer', phase: 'pre_boarding', title: 'Read and accept the offer', helper: 'Opens from the email link with no login. No decline button: a no comes by email and HR marks it declined', owner: 'employee', kind: 'ack', surface: 'portal', opens: at('offer_sent'), dueLabel: 'Offer valid till', mustDo: true },
  { key: 'finalise_offer', phase: 'pre_boarding', title: 'Finalise the accepted offer', helper: 'HR accepts from their end. The account is created and the login email + password goes out', owner: 'hr', kind: 'review', surface: 'dashboard', opens: at('accepted'), due: at('accepted', 1, 'working_days'), mustDo: true },
  { key: 'portal_sign_in', phase: 'pre_boarding', title: 'Sign in to the portal', helper: 'Email + password from HR. Forgot password by email. 5 wrong tries → 15 min lock', owner: 'employee', kind: 'system', surface: 'portal', opens: at('finalised'), due: at('finalised', 2) },
  {
    key: 'upload_documents', phase: 'pre_boarding', title: 'Upload documents', helper: 'PDF/JPG/PNG up to 10 MB, one reel per document, sent-back ones first', owner: 'employee', kind: 'upload', surface: 'portal', due: tj(-5), mustDo: true,
    after: { key: 'portal_sign_in' },
    documents: [
      { key: 'id_proof', label: 'ID proof (PAN and Aadhaar)', required: true },
      { key: 'address_proof', label: 'Address proof', required: true },
      { key: 'education', label: 'Education certificates', required: true },
      { key: 'last_payslip', label: 'Last payslip', required: false },
    ],
  },
  { key: 'review_documents', phase: 'pre_boarding', title: 'Review documents', helper: 'Approve, or send back with a note (the joiner sees it first in Up next)', owner: 'hr', kind: 'review', surface: 'dashboard', due: tj(-2), dueLabel: 'Each upload', after: { key: 'upload_documents', when: 'started' } },
  { key: 'about_you', phase: 'pre_boarding', title: 'Emergency contact and PF', helper: 'Two short steps (About you). UAN of 12 digits or “first job”', owner: 'employee', kind: 'form', surface: 'portal', due: tj(-3), after: { key: 'portal_sign_in' } },
  { key: 'meet_us', phase: 'pre_boarding', title: 'Meet us videos', helper: 'Manager note (text or video), culture, role and policies', owner: 'employee', kind: 'reel', surface: 'portal', due: tj(-1), after: { key: 'portal_sign_in' } },
  { key: 'device_request', phase: 'pre_boarding', title: 'Laptop and email request', helper: 'Raised with IT and Admin from the joiner card', owner: 'hr', kind: 'assign', surface: 'dashboard', opens: at('finalised'), due: tj(-5) },
  { key: 'sign_letters', phase: 'pre_boarding', title: 'Sign the appointment letter and NDA', helper: 'Generated from the accepted offer. Signing unlocks after the PDF is opened. Draw or type', owner: 'employee', kind: 'sign', surface: 'portal', due: tj(-2), mustDo: true, after: { key: 'review_documents' } },
  { key: 'day1_pass', phase: 'pre_boarding', title: 'Day-1 pass', helper: 'Date, time, place or link, HR contact, what to carry, agenda, add to calendar', owner: 'automatic', kind: 'system', surface: 'portal', opens: tj(-7) },
  { key: 'manager_setup', phase: 'pre_boarding', title: 'Set up the new joiner', helper: 'People to meet (6), welcome note or video, buddy. Arrives as an app to-do when HR finalises', owner: 'manager', kind: 'form', surface: 'app', opens: at('finalised'), due: tj(-1) },
  { key: 'mark_joined', phase: 'pre_boarding', title: 'Mark joined and create the work email', helper: 'The portal then shows the work email; the app signs in with it and a one-time code', owner: 'hr', kind: 'system', surface: 'dashboard', opens: tj(0), due: tj(0), mustDo: true },
  { key: 'new_joining_date', phase: 'pre_boarding', title: 'Ask for a new joining date', helper: 'Optional. Next 3 Mondays or Other, reason required. HR approval moves every due date', owner: 'employee', kind: 'form', surface: 'portal', after: { key: 'portal_sign_in' } },
  { key: 'assign_buddy', phase: 'pre_boarding', title: 'Assign a buddy', helper: 'A teammate for small questions; shows on the Day-1 pass', owner: 'manager', kind: 'assign', surface: 'app', opens: at('finalised'), due: tj(-3), recommended: 'Someone other than the manager they can ask small questions. Shows on the Day-1 pass.' },

  // ── First week · Employee 6 · Manager 3 · HR 2 · Manager + Employee 1 · IT / Admin 1 · Manager → Employee 1 · Automatic 1 (+ 1 recommended)
  { key: 'welcome_induction', phase: 'first_week', title: 'Welcome and induction', helper: 'First thing on the joining day', owner: 'hr', kind: 'meeting', surface: 'dashboard', opens: tj(0), due: tj(0), agenda: ['Your ID card and documents', 'Working hours and attendance', 'Payroll and your tax declaration', 'Who to ask for what'] },
  { key: 'meet_manager', phase: 'first_week', title: 'Meet your manager', helper: 'First 1:1. Timed item; push 30 min before', owner: 'manager_employee', kind: 'meeting', surface: 'app', opens: tj(0), due: tj(0), mustDo: true, agenda: ['What a good first month looks like', 'How you’ll work together', 'Your first goals', 'Who to meet first'] },
  { key: 'vision_culture', phase: 'first_week', title: 'Company vision and culture', helper: 'Batch session', owner: 'hr', kind: 'meeting', surface: 'dashboard', opens: tj(0), due: tj(0), agenda: ['Where the company is going and why', 'How we work together', 'Questions are welcome'] },
  { key: 'meet_team', phase: 'first_week', title: 'Meet your team', helper: 'Manager introduces the team', owner: 'manager', kind: 'meeting', surface: 'app', opens: tj(0), due: tj(0), mustDo: true, agenda: ['Who does what in the team', 'How the team works day to day'] },
  { key: 'laptop_setup', phase: 'first_week', title: 'Set up laptop and login', helper: 'Device handed over', owner: 'it', kind: 'assign', surface: 'dashboard', opens: tj(0), due: tj(0) },
  { key: 'register_face', phase: 'first_week', title: 'Register face for punch-in', helper: 'Only for people who punch in the app; uses the existing face-check flow', owner: 'employee', kind: 'face', surface: 'app', opens: tj(0), due: tj(1) },
  { key: 'app_tour', phase: 'first_week', title: 'Take the Sowaka tour', helper: 'The in-app spotlight tour', owner: 'employee', kind: 'tour', surface: 'app', opens: tj(0), due: tj(3) },
  { key: 'week1_reels', phase: 'first_week', title: 'Week-1 tasks', helper: '4 reels: policies (agree), tax regime (new by default), bank and PF (prefilled; edit goes to HR), probation goals (read-only)', owner: 'employee', kind: 'reel', surface: 'app', opens: tj(0), due: tj(5), mustDo: true },
  { key: 'intro_post', phase: 'first_week', title: 'Intro post', helper: 'Photo, one line (80 characters), up to 3 fun facts → preview → Post to Connect; manager gets a “say hi” push', owner: 'employee', kind: 'post', surface: 'app', opens: tj(0), due: tj(3) },
  { key: 'people_to_meet', phase: 'first_week', title: 'People to meet', helper: '6 people the manager picked. Book 15 min, “We met” fills a card', owner: 'employee', kind: 'meeting', surface: 'app', opens: tj(0), due: monthEnd(1) },
  { key: 'starter_task', phase: 'first_week', title: 'Starter task', helper: 'Manager assigns task, due and note; the joiner marks it done with an optional note', owner: 'manager', kind: 'assign', surface: 'app', opens: tj(0), dueLabel: 'Manager sets' },
  { key: 'one_on_one_notes', phase: 'first_week', title: '1:1 notes', helper: 'Private to manager and HR unless “Share with [name]” is on', owner: 'manager', kind: 'form', surface: 'app', due: tj(7), after: { key: 'meet_manager' } },
  { key: 'probation_goals', phase: 'first_week', title: 'Probation goals', helper: 'Manager can edit until Tj + 7, then they lock. Employee reads them in week-1 tasks', owner: 'manager', kind: 'form', surface: 'app', opens: tj(0), due: tj(7) },
  { key: 'day7_survey', phase: 'first_week', title: 'Day-7 survey', helper: '4 questions, one per reel. HR sees answers; manager a team summary (3+ answers)', owner: 'employee', kind: 'survey', surface: 'app', opens: tj(6), due: tj(7) },
  { key: 'week1_done', phase: 'first_week', title: 'Week 1 done', helper: 'Shown on the first open after Tj + 7', owner: 'automatic', kind: 'system', surface: 'app', opens: tj(7) },
  { key: 'check_logins', phase: 'first_week', title: 'Check logins work', helper: 'Email, the app and tools open', owner: 'employee', kind: 'ack', surface: 'app', opens: tj(0), due: tj(1), recommended: 'A quick tick that email, the app and tools open, so nothing blocks work on Day 2.' },

  // ── Probation · Manager 2 · Manager + Employee 1 · Employee 1 · HR + Manager 1 · HR 1 · Automatic 1 (+ 1 recommended)
  { key: 'monthly_goals', phase: 'probation', title: 'Monthly goals', helper: 'Set at the start of each probation month', owner: 'manager', kind: 'form', surface: 'app', opens: monthStart('each'), due: monthStart('each') },
  { key: 'monthly_checkin', phase: 'probation', title: 'Monthly check-in', helper: 'Employee and manager together, at the end of each month', owner: 'manager_employee', kind: 'checkin', surface: 'app', opens: monthEnd('each', -6), due: monthEnd('each'), mustDo: true, agenda: ['Progress on this month’s goals', 'Feedback both ways', 'Goals for next month'] },
  { key: 'monthly_review', phase: 'probation', title: 'Monthly review and next month’s goals', helper: 'Closes the month and opens the next', owner: 'manager', kind: 'review', surface: 'app', due: monthEnd('each'), after: { key: 'monthly_checkin' } },
  { key: 'pulse_survey', phase: 'probation', title: 'Pulse survey', helper: 'Same 4 questions as Day 7', owner: 'employee', kind: 'survey', surface: 'app', opens: monthStart([3, 6]) },
  { key: 'confirmation_discussion', phase: 'probation', title: 'Confirmation discussion', helper: 'Opens in the last probation month: confirm or extend, salary, KPIs, designation, reporting', owner: 'hr_manager', kind: 'review', surface: 'dashboard', opens: monthStart('last'), due: monthEnd('last'), mustDo: true, agenda: ['Your months here, looking back', 'Feedback both ways', 'What happens next'] },
  { key: 'confirmation_letter', phase: 'probation', title: 'Confirmation or extension letter', helper: 'From Documents; extension restarts a review cycle', owner: 'hr', kind: 'letter', surface: 'dashboard', after: { key: 'confirmation_discussion' } },
  { key: 'confirmation_reveal', phase: 'probation', title: 'Confirmation reveal', helper: 'The outcome moment in the app', owner: 'automatic', kind: 'system', surface: 'app', after: { key: 'confirmation_letter' } },
  { key: 'manager_30day_note', phase: 'probation', title: '30-day note from the manager', helper: 'Short written note; feeds the month-1 check-in', owner: 'manager', kind: 'form', surface: 'app', opens: tj(30), due: tj(30), recommended: 'A short written note on how the first month went. Feeds the month-1 check-in.' },
];

/**
 * The team side's tasks (Teams › Joiners, the Team side artifact of 20 Nov): the buddy's, the head
 * of department's, and the manager's that no row above covers. Never journey tasks: the app ticks
 * them on the journey (teamTasks.ts). The step is the due rule: before Tj → Before Day 1, Tj →
 * Day 1, Tj+1…6 → Week 1, a month's end → that month, none → once confirmed. HR edits the wording,
 * timing and switch in Templates like any row.
 */
type TeamRow = { key: string; owner: 'buddy' | 'head_of_department' | 'manager'; title: string; helper?: string; due: DueRule | null; team: Omit<TeamTaskSpec, 'key'> };
const BEFORE = tj(-1), DAY1 = tj(0), WEEK1 = tj(6);
const TEAM_ROWS: TeamRow[] = [
  // The buddy
  { key: 'buddy_meet', owner: 'buddy', title: 'Meet {n} on Day 1', due: DAY1, team: { kind: 'meet', pair: 'Your buddy', agenda: ['How the team works day to day', 'Tools and shortcuts', 'Where people have lunch', 'Anything {n} is unsure about'] } },
  { key: 'buddy_show_around', owner: 'buddy', title: 'Show {n} around the office', due: DAY1, team: { kind: 'team' } },
  { key: 'buddy_punch_in', owner: 'buddy', title: 'Tell {n} how punch-in works', due: DAY1, team: { kind: 'help', pair: 'Sowaka tour: Punch in and out' } },
  { key: 'buddy_policies', owner: 'buddy', title: 'Show {n} where policies and payslips are', due: DAY1, team: { kind: 'help' } },
  { key: 'buddy_week1', owner: 'buddy', title: 'Week-1 check-in', due: WEEK1, team: { kind: 'meet', agenda: ['How the first week went', 'Anything {n} is stuck on', 'Who {n} should meet next'] } },
  { key: 'buddy_tools', owner: 'buddy', title: 'Help {n} set up their work tools', due: WEEK1, team: { kind: 'help', early: true } },
  { key: 'buddy_intros', owner: 'buddy', title: 'Introduce {n} to three people outside the team', due: WEEK1, team: { kind: 'team', early: true } },
  { key: 'buddy_leave_ot', owner: 'buddy', title: 'Tell {n} how leave and overtime work', due: WEEK1, team: { kind: 'help', early: true, pair: 'Sowaka tour: leave and overtime' } },
  { key: 'buddy_month1', owner: 'buddy', title: 'Month-1 catch-up', due: monthEnd(1), team: { kind: 'meet', agenda: ['How the first month went', 'What would make next month easier'] } },
  // The head of department
  { key: 'hod_meet', owner: 'head_of_department', title: 'Meet {n}', helper: 'A short hello in the first week or two', due: WEEK1, team: { kind: 'meet', early: true, pair: 'Meet your head of department', agenda: ['How {n} is settling in', 'What the department is working on', 'Anything {n} needs from you'] } },
  { key: 'hod_approve', owner: 'head_of_department', title: 'Approve {p} confirmation', helper: 'After the manager recommends', due: monthEnd('last'), team: { kind: 'approve' } },
  // The manager's, beyond the rows above
  { key: 'mgr_plan_week', owner: 'manager', title: 'Plan {p} first week', helper: 'Who they meet, what they shadow', due: BEFORE, team: { kind: 'task' } },
  { key: 'mgr_welcome', owner: 'manager', title: 'Send {n} a welcome message', due: BEFORE, team: { kind: 'chat', early: true, pair: 'Message from your manager' } },
  { key: 'mgr_buddy_check', owner: 'manager', title: 'Check in with {p} buddy', due: WEEK1, team: { kind: 'meet', early: true, agenda: ['How {n} is settling in', 'Anything {n} is stuck on'] } },
  { key: 'mgr_week_chat', owner: 'manager', title: 'End-of-week chat', due: WEEK1, team: { kind: 'meet', early: true, agenda: ['Highlights of the week', 'Questions so far', 'Plan for next week'] } },
  { key: 'mgr_mid_feedback', owner: 'manager', title: 'Mid-probation feedback', due: monthEnd(3), team: { kind: 'doc', pair: 'Feedback from your manager' } },
  { key: 'mgr_write_review', owner: 'manager', title: 'Write {p} confirmation review', due: monthEnd('last'), team: { kind: 'doc' } },
  { key: 'mgr_recommend', owner: 'manager', title: 'Recommend: confirm or extend', helper: 'HR makes the final call', due: monthEnd('last'), team: { kind: 'doc' } },
  { key: 'mgr_share_news', owner: 'manager', title: 'Share the news with the team', due: null, team: { kind: 'team' } },
];

const TEAM_TASK_KIND: Record<TeamTaskSpec['kind'], TaskKind> = { help: 'ack', approve: 'review', review: 'review', task: 'form', meet: 'meeting', team: 'meeting', goal: 'form', doc: 'form', chat: 'post' };

/** The team rows as template tasks (ids `ob-team-<key>`), after the onboarding rows. */
export function teamSeed(startOrder = 10_000): TemplateTask[] {
  return TEAM_ROWS.map((row, i) => {
    const phase: LifecyclePhase = !row.due ? 'probation' : row.due.anchor === 'tj' ? ((row.due.offset ?? 0) < 0 ? 'pre_boarding' : 'first_week') : 'probation';
    return {
      id: `ob-team-${row.key.replaceAll('_', '-')}`, phase, title: row.title, ...(row.helper ? { helper: row.helper } : {}),
      ownerRole: row.owner, kind: TEAM_TASK_KIND[row.team.kind], surface: 'app' as TaskSurface, opensRule: null, dueRule: row.due ? { ...row.due } : null,
      ...(row.due ? {} : { dueLabel: 'Once confirmed' }), mustDo: false, enabled: true, order: startOrder + (i + 1) * 10,
      team: { key: row.key, ...row.team, ...(row.team.agenda ? { agenda: [...row.team.agenda] } : {}) },
    };
  });
}

const OFFBOARDING_ROWS: Row[] = [
  // ── Resignation · HR 2 · Employee 1 · Manager 1
  { key: 'send_resignation', phase: 'resignation', title: 'Send resignation', helper: 'Profile › Work detail › Resign. Reason (required) and an optional note. No last-day picker', owner: 'employee', kind: 'form', surface: 'app', dueLabel: 'Any time', mustDo: true },
  { key: 'manager_resignation_action', phase: 'resignation', title: 'Accept, change last day or release early', helper: 'Request card in Teams › Requests', owner: 'manager', kind: 'review', surface: 'app', dueLabel: 'Shown on the HR board' },
  { key: 'hr_accept_exit', phase: 'resignation', title: 'Accept and confirm the last day', helper: 'Accept, change last day, release early or confirm a manager-agreed day', owner: 'hr', kind: 'review', surface: 'dashboard', dueLabel: 'Within 2 days', mustDo: true },
  { key: 'hr_start_exit', phase: 'resignation', title: 'Start an HR-led exit', helper: 'Retirement, end of contract, termination, absconding. App page is off by default for termination and absconding', owner: 'hr', kind: 'form', surface: 'dashboard', dueLabel: 'Any time' },

  // ── When accepted · Automatic 2 · Manager 1
  { key: 'handover_checklist', phase: 'when_accepted', title: 'Handover checklist and note', helper: 'Manager adds items; the employee uploads against each', owner: 'manager', kind: 'form', surface: 'app', opens: at('exit_accepted'), due: at('exit_accepted', 3), mustDo: true },
  { key: 'tell_clearance_teams', phase: 'when_accepted', title: 'Tell IT, Admin and Finance', helper: 'Each gets its clearance item', owner: 'automatic', kind: 'system', surface: 'backend', opens: at('exit_accepted'), due: at('exit_accepted') },
  { key: 'offboarding_page', phase: 'when_accepted', title: 'Off-boarding page in the app', helper: 'Last day, before-you-go tasks, exit interview', owner: 'automatic', kind: 'system', surface: 'app', opens: at('exit_accepted'), due: at('exit_accepted') },

  // ── Notice period · Employee 3 · Finance 1 · IT / Admin 1 · Automatic 1 (+ 1 recommended)
  { key: 'upload_handover', phase: 'notice_period', title: 'Upload handover items', helper: 'File or link against each checklist item', owner: 'employee', kind: 'upload', surface: 'app', due: tl(-7), mustDo: true, after: { key: 'handover_checklist' } },
  { key: 'exit_interview', phase: 'notice_period', title: 'Exit interview', helper: 'Optional, 5 questions. Answers go to HR only and show anonymised in Exit insights', owner: 'employee', kind: 'survey', surface: 'app', opens: tl(-5), due: tl(0) },
  { key: 'save_documents', phase: 'notice_period', title: 'Save your documents', helper: 'Payslips and Form 16, before access ends', owner: 'employee', kind: 'ack', surface: 'app', opens: at('exit_accepted'), due: tl(0), dueLabel: 'Before access ends' },
  { key: 'finance_clearance', phase: 'notice_period', title: 'Finance clearance', helper: 'Advances, open claims, loans', owner: 'finance', kind: 'review', surface: 'dashboard', opens: at('exit_accepted'), due: tl(-2) },
  { key: 'return_assets', phase: 'notice_period', title: 'Return laptop and ID card', helper: 'The employee hands them in; IT and Admin mark them returned', owner: 'it', kind: 'review', surface: 'dashboard', opens: at('exit_accepted'), due: tl(0) },
  { key: 'salary_hold', phase: 'notice_period', title: 'Salary on hold', helper: 'Payslip shows “Held” when payroll sends that status (Payroll › Exit settings). The only payroll change', owner: 'automatic', kind: 'system', surface: 'app', dueLabel: 'Backend status' },
  { key: 'kt_session', phase: 'notice_period', title: 'Knowledge-transfer session', helper: 'With whoever takes over', owner: 'manager', kind: 'meeting', surface: 'app', opens: at('exit_accepted'), due: tl(-10), recommended: 'A session with whoever takes over, before the last week.' },

  // ── Last day · Manager 1 · Automatic 1 (+ 1 recommended)
  { key: 'mark_handover_done', phase: 'last_day', title: 'Mark handover done', helper: 'Manager confirms', owner: 'manager', kind: 'review', surface: 'app', opens: tl(0), due: tl(0) },
  { key: 'close_account', phase: 'last_day', title: 'Close app account and access', helper: 'Email, app, building access', owner: 'automatic', kind: 'system', surface: 'backend', opens: tl(1), due: tl(1) },
  { key: 'thank_you_note', phase: 'last_day', title: 'Thank-you note from the manager', helper: 'Private, on the last day', owner: 'manager', kind: 'form', surface: 'app', opens: tl(0), due: tl(0), recommended: 'A short private note from the manager on the last day.' },

  // ── After exit · HR 3 · Finance 1 (+ 2 recommended)
  { key: 'final_settlement', phase: 'after_exit', title: 'Final settlement PDF', helper: 'Emailed to the personal email; never shown in the app', owner: 'hr', kind: 'letter', surface: 'dashboard', opens: tl(0), due: tl(2, 'working_days'), mustDo: true },
  { key: 'relieving_letter', phase: 'after_exit', title: 'Relieving and experience letter', helper: 'From Documents', owner: 'hr', kind: 'letter', surface: 'dashboard', opens: tl(0), due: tl(2, 'working_days') },
  { key: 'epfo_exit', phase: 'after_exit', title: 'Mark exit date on EPFO', helper: 'So they can move their PF', owner: 'hr', kind: 'system', surface: 'outside', opens: tl(1), dueLabel: 'After Tl' },
  { key: 'gratuity', phase: 'after_exit', title: 'Gratuity, if eligible', helper: 'Paid separately', owner: 'finance', kind: 'review', surface: 'dashboard', opens: tl(0), due: tl(30) },
  { key: 'stay_in_touch', phase: 'after_exit', title: 'Ask to stay in touch', helper: 'Keep a personal email for rehire and referrals, only if they agree', owner: 'employee', kind: 'ack', surface: 'app', opens: tl(0), due: tl(0), recommended: 'Keep a personal email for rehire and referrals, only if they agree.' },
  { key: 'delete_face_data', phase: 'after_exit', title: 'Delete face data', helper: 'Data privacy: remove the face registration within 30 days of the exit', owner: 'hr', kind: 'system', surface: 'backend', opens: tl(0), due: tl(30), recommended: 'From the earlier task library (data privacy): face data is deleted within 30 days of the exit.' },
];

/**
 * What the app says on a seeded task's row, apart from the template's helper (which is HR's
 * note on how the step works, e.g. "Timed item; push 30 min before"). `employee` is the joiner's
 * meta line (6Zs §5.3 A2: "Any time · 2 min · needed to punch in"); `manager` and `managerTitle`
 * are M2's (§5.4: "Meet Kabir", "Introduce Kabir to the team"). `{name}` is the joiner's first
 * name. A task with no line here shows no helper in the app; HR's own tasks keep theirs.
 */
export interface AppCopy { employee?: string; manager?: string; managerTitle?: string }

export const APP_COPY: Partial<Record<SystemTaskKey, AppCopy>> = {
  // Pre-boarding steps still open when they join (the portal's, carried into the app).
  upload_documents: { employee: 'On your joining portal' },
  about_you: { employee: 'Emergency contact and PF · 2 min' },
  meet_us: { employee: 'Short videos from the team' },
  sign_letters: { employee: 'Read and sign on your joining portal' },
  manager_setup: { manager: 'People to meet, a buddy and a welcome note', managerTitle: 'Set up {name}' },
  assign_buddy: { manager: 'A teammate for small questions', managerTitle: 'Pick a buddy for {name}' },
  // First week.
  welcome_induction: { employee: 'With HR · your first morning' },
  meet_manager: { employee: 'Your first 1:1', manager: 'Your first 1:1', managerTitle: 'Meet {name}' },
  vision_culture: { employee: 'A session for your batch' },
  meet_team: { employee: 'Your manager introduces you', manager: 'Introduce them to the people they’ll work with', managerTitle: 'Introduce {name} to the team' },
  laptop_setup: { employee: 'IT hands over your laptop and logins' },
  register_face: { employee: '2 min · needed to punch in' },
  app_tour: { employee: '5 min' },
  week1_reels: { employee: 'Policies, tax regime, bank and PF, your goals' },
  intro_post: { employee: 'Say hello on Connect · 2 min' },
  people_to_meet: { employee: 'People your manager picked for you' },
  starter_task: { manager: 'Something small for their first week', managerTitle: 'Give {name} a starter task' },
  one_on_one_notes: { manager: 'After you meet', managerTitle: 'Add notes from your 1:1' },
  probation_goals: { manager: 'Editable until week 1 ends', managerTitle: 'Set {name}’s probation goals' },
  day7_survey: { employee: '4 quick questions' },
  check_logins: { employee: 'Email, the app and your tools open' },
  // Probation.
  monthly_goals: { manager: 'At the start of the month', managerTitle: 'Set {name}’s goals' },
  monthly_checkin: { employee: 'How the month went, with your manager', manager: 'Your side of the month-end check-in', managerTitle: 'Check in with {name}' },
  monthly_review: { manager: 'Closes the month and sets next month’s goals', managerTitle: 'Review {name}’s month' },
  pulse_survey: { employee: '4 quick questions' },
  confirmation_discussion: { manager: 'HR records the decision in the dashboard', managerTitle: 'Talk to HR about confirming {name}' },
  manager_30day_note: { manager: 'A short note on their first month', managerTitle: 'Write a 30-day note for {name}' },
};

function toTasks(prefix: string, rows: Row[]): TemplateTask[] {
  return rows.map((row, index) => ({
    id: `${prefix}-${row.key.replaceAll('_', '-')}`,
    phase: row.phase,
    title: row.title,
    ...(row.helper ? { helper: row.helper } : {}),
    ownerRole: row.owner,
    kind: row.kind,
    surface: row.surface,
    systemKey: row.key,
    opensRule: row.opens ?? null,
    dueRule: row.due ?? null,
    ...(row.dueLabel ? { dueLabel: row.dueLabel } : {}),
    mustDo: row.mustDo === true,
    enabled: !row.recommended,
    order: (index + 1) * 10,
    ...(row.recommended ? { recommended: { why: row.recommended, added: false } } : {}),
    ...(row.agenda ? { agenda: [...row.agenda] } : {}),
    ...(row.after ? { after: row.after } : {}),
    ...(row.documents ? { documents: row.documents.map((d) => ({ ...d })) } : {}),
  }));
}

/** 6Zs §2.1, every row; recommended ones off. Fresh copies each call. */
export function onboardingSeed(): TemplateTask[] { return [...toTasks('ob', ONBOARDING_ROWS), ...teamSeed()]; }
/** 6Zs §2.2, every row; recommended ones off. Fresh copies each call. */
export function offboardingSeed(): TemplateTask[] { return toTasks('off', OFFBOARDING_ROWS); }

export const ONBOARDING_SEED: readonly TemplateTask[] = Object.freeze(onboardingSeed());
export const OFFBOARDING_SEED: readonly TemplateTask[] = Object.freeze(offboardingSeed());

export const ONBOARDING_SETTINGS: LifecycleTemplateSettings = { probationMonths: 6, portalOpenUntil: 'week_1', signLettersOnDay1: false };
export const OFFBOARDING_SETTINGS: LifecycleTemplateSettings = {
  noticeDays: 60, exitInterviewOpensDays: 5, accountCloses: 'tl_plus_1', settlementWorkingDays: 2, gratuityDays: 30,
  appPageFor: ['resignation', 'retirement', 'end_of_contract'],
};
