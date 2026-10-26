/**
 * What each dashboard page does and how the common jobs are done, for
 * Suwi's dashboard_help tool. Suwi answers "where is it / how does it work"
 * only from this file, so it never describes a feature Sowaka doesn't have.
 * View keys match hr-admin-web/src/dashboard/theme.ts TITLES.
 */

export interface HelpEntry {
  view: string;
  title: string;
  section: string;
  /** 1–3 sentences: what the page is for. */
  what: string;
  /** Words people use when asking about it. */
  keywords: string[];
}

export interface HowTo {
  key: string;
  title: string;
  view: string;
  steps: string[];
  keywords: string[];
}

export const VIEWS: HelpEntry[] = [
  { view: 'overview', title: 'HR control room', section: 'Home', what: 'The day at a glance: leaves pending, claims to review, feedback pending, who is on leave this week and recent overtime requests. Suwi\'s notices and morning digest sit here too.', keywords: ['overview', 'home', 'dashboard', 'control room', 'digest'] },
  { view: 'organisation', title: 'Organisation', section: 'Company', what: 'The company profile: registered and display names, address, contact emails and identity details used on documents.', keywords: ['organisation', 'organization', 'company profile', 'company details', 'address', 'logo'] },
  { view: 'leave', title: 'Leave requests', section: 'Requests', what: 'Every leave request in the company: pending ones to approve or decline (with a note), and the history. Managers decide their team\'s in the app; HR can decide any here.', keywords: ['leave', 'leave request', 'approve leave', 'decline leave', 'time off', 'sick', 'casual'] },
  { view: 'overtime', title: 'Overtime', section: 'Requests', what: 'Overtime requests with hours worked, to approve or decline. Approved overtime earns comp-off where the shift template allows it.', keywords: ['overtime', 'ot', 'extra hours', 'comp off', 'comp-off'] },
  { view: 'attendance', title: 'Attendance corrections', section: 'Requests', what: 'Days employees asked to have corrected: a missed punch, a wrong time, a day marked absent. Approve or decline with a note.', keywords: ['correction', 'regularization', 'regularisation', 'missed punch', 'fix attendance', 'attendance request'] },
  { view: 'oolcheckins', title: 'OOL check-ins', section: 'Requests', what: 'Punches taken away from every office (out of location), with where the person was, for HR to review.', keywords: ['out of location', 'ool', 'check-in', 'remote punch', 'geofence'] },
  { view: 'support', title: 'Support desk', section: 'Support', what: 'Tickets employees raised from the app, with replies and status. Only people given a Support role see it.', keywords: ['support', 'ticket', 'helpdesk', 'query'] },
  { view: 'employees', title: 'Employees', section: 'People', what: 'The employee list and each person\'s profile: details, reporting manager, calendar, documents, and (with payroll access) salary and bank details. Add, edit or offboard people here.', keywords: ['employee', 'employees', 'profile', 'add employee', 'new joiner', 'offboard', 'edit details', 'manager'] },
  { view: 'employeeimport', title: 'Import employees', section: 'People', what: 'Update many people\'s details from a spreadsheet: upload any sheet, map its columns, review every change, then approve before it saves.', keywords: ['import', 'spreadsheet', 'excel', 'csv', 'bulk update', 'upload sheet'] },
  { view: 'peopletasks', title: 'Tasks', section: 'People', what: 'Who still needs setting up: basic details, a shift template, KPIs, a salary, or bank details and PAN. Nothing is stored; a task clears when the data is there.', keywords: ['tasks', 'setup', 'incomplete', 'missing details', 'pending setup'] },
  { view: 'departments', title: 'Departments', section: 'People', what: 'The list of departments people are placed in.', keywords: ['department', 'departments', 'team'] },
  { view: 'designations', title: 'Designations', section: 'People', what: 'The list of job titles (designations) people can hold.', keywords: ['designation', 'designations', 'job title', 'role title'] },
  { view: 'orgchart', title: 'Org chart', section: 'People', what: 'Who reports to whom, as a tree. Reporting lines are set on each employee\'s profile.', keywords: ['org chart', 'reporting line', 'hierarchy', 'reports to'] },
  { view: 'usersroles', title: 'Accesses', section: 'People', what: 'Who can open this dashboard and which tabs they get; payroll access is given here too. Admins only.', keywords: ['access', 'accesses', 'permission', 'role', 'dashboard user', 'admin', 'tabs'] },
  { view: 'shifttypes', title: 'Shift templates', section: 'Shifts', what: 'Shift templates: timings, grace, half-day and absent rules, weekly offs, punch rules and the leave types with their entitlements. One template is the Default for anyone not assigned.', keywords: ['shift', 'shift template', 'timings', 'grace', 'late mark', 'half day', 'weekly off', 'leave type', 'leave policy', 'entitlement'] },
  { view: 'shiftbulk', title: 'Bulk Assign', section: 'Shifts', what: 'Bulk assign runs through Suwi: say what to assign and who gets it (or attach a sheet of employee IDs), check the preview table, then confirm. A shift change starts the next day.', keywords: ['assign shift', 'bulk assign', 'move to shift', 'change shift'] },
  { view: 'holidaybank', title: 'Holiday Bank', section: 'Shifts', what: 'The master list of holidays, each for one work location or all. Attendance and leave counts skip them.', keywords: ['holiday', 'holidays', 'public holiday', 'holiday list', 'holiday bank'] },
  { view: 'offices', title: 'Offices', section: 'Shifts', what: 'Office locations with a radius: where a geotagged punch may be taken from.', keywords: ['office', 'offices', 'location', 'geofence', 'radius'] },
  { view: 'roster', title: 'Roster', section: 'Shifts', what: 'Schedule employees onto shifts by day.', keywords: ['roster', 'schedule', 'rota'] },
  { view: 'shiftswaps', title: 'Swap Requests', section: 'Shifts', what: 'Shift swap and change approvals.', keywords: ['swap', 'shift swap', 'shift change'] },
  { view: 'attendancereport', title: 'Attendance report', section: 'Reports', what: 'Per-person attendance for any date range: present, half days, lates, early exits, missed punches, absences and leave, with each person\'s calendar a click away. Export to a sheet.', keywords: ['attendance report', 'report', 'late', 'absent', 'present', 'export attendance', 'monthly attendance'] },
  { view: 'kpi', title: 'KPI Parameters', section: 'Performance', what: 'Define the measurable KPIs people are reviewed on.', keywords: ['kpi', 'kpi parameter', 'metric'] },
  { view: 'kpitemplates', title: 'KPI Templates', section: 'Performance', what: 'Weighted sets of KPI parameters, assigned to people for a review cycle.', keywords: ['kpi template', 'review template', 'weights'] },
  { view: 'kpibulk', title: 'KPI Bulk Assign', section: 'Performance', what: 'Bulk assign runs through Suwi: say which KPI template and who gets it, check the preview, then confirm. It applies from the next cycle.', keywords: ['assign kpi', 'kpi bulk'] },
  { view: 'feedback', title: 'Performance Reviews', section: 'Performance', what: 'Managers\' reviews and recognition for the cycle, and who has not yet been reviewed.', keywords: ['review', 'performance review', 'feedback', 'appraisal', 'recognition'] },
  { view: 'cycle', title: 'Cycle', section: 'Performance', what: 'The monthly review cycle: when it opens, reminders and the closing date.', keywords: ['cycle', 'review cycle', 'review period'] },
  { view: 'payschedule', title: 'Pay Schedule', section: 'Payroll', what: 'How often and on which day payroll runs, and the first pay period.', keywords: ['pay schedule', 'pay day', 'payroll date', 'pay period'] },
  { view: 'taxdetails', title: 'Tax Details', section: 'Payroll', what: 'The company\'s PAN, TAN, TDS circle and deductor details used on filings.', keywords: ['tax details', 'tan', 'pan', 'deductor', 'tds circle'] },
  { view: 'payheads', title: 'Salary Components', section: 'Payroll', what: 'The catalogue of earnings, deductions and reimbursement components salary templates are built from.', keywords: ['salary component', 'pay head', 'earning', 'deduction', 'allowance', 'hra', 'basic'] },
  { view: 'templates', title: 'Salary Templates', section: 'Payroll', what: 'Reusable pay structures: which components, in what proportion of CTC. Assign a template and CTC to each person from here or their Salary details tab.', keywords: ['salary template', 'ctc', 'pay structure', 'salary structure', 'assign salary'] },
  { view: 'paiddays', title: 'Paid Days Templates', section: 'Payroll', what: 'How attendance becomes paid days: which absences, half days, lates and early exits deduct pay. One Default per company.', keywords: ['paid days', 'lop', 'loss of pay', 'deduction rule', 'attendance deduction'] },
  { view: 'statutorycomponents', title: 'Statutory Components', section: 'Payroll', what: 'EPF, ESI, statutory bonus and TDS settings, plus Professional Tax slabs and Labour Welfare Fund by work state.', keywords: ['statutory', 'epf', 'pf', 'esi', 'professional tax', 'pt', 'pt slab', 'slabs', 'lwf', 'labour welfare', 'bonus', 'tds setting', 'minimum wage'] },
  { view: 'payrolldash', title: 'Payroll Dashboard', section: 'Payroll', what: 'The pay month at a glance: headcount paid, gross, deductions, net and what is still open.', keywords: ['payroll dashboard', 'payroll summary', 'payroll overview'] },
  { view: 'payrollreports', title: 'Payroll Reports', section: 'Payroll', what: 'Salary register, statutory reports (PF, ESI, PT) and summaries to download.', keywords: ['payroll report', 'salary register', 'pf report', 'esi report', 'pt report', 'register'] },
  { view: 'payruns', title: 'Payroll Runs', section: 'Payroll', what: 'Run payroll for a month: review inputs and attendance, check each person, approve, then payslips go to the app.', keywords: ['payroll run', 'run payroll', 'payslip', 'process payroll', 'approve payroll', 'salary run'] },
  { view: 'reimbursements', title: 'Reimbursements', section: 'Claims', what: 'Expense claims employees submitted with receipts: approve, decline or mark paid. Approved claims of a salary component type become tax-free bills on the next run.', keywords: ['reimbursement', 'claim', 'expense', 'receipt', 'bill', 'approve claim'] },
  { view: 'reimbursementtypes', title: 'Reimbursement Types', section: 'Claims', what: 'What can be claimed: each type with its cap per claim, how far back a claim may be dated, and the salary component it is the bills for.', keywords: ['reimbursement type', 'claim type', 'claim limit', 'cap', 'fuel', 'expense category'] },
  { view: 'games', title: 'Games', section: 'Connect', what: 'Hosted games and leaderboards employees play in the app.', keywords: ['game', 'games', 'leaderboard'] },
  { view: 'relaygame', title: 'Relay game', section: 'Connect', what: 'Set up a launch-event Hint Relay: teams, questions and the schedule.', keywords: ['relay', 'hint relay', 'launch event', 'team game'] },
  { view: 'engagementposts', title: 'Engagement posts', section: 'Connect', what: 'Challenges and engagement content published for people to play or respond to in Connect.', keywords: ['engagement', 'engagement post', 'challenge', 'poll', 'survey', 'connect post', 'announcement'] },
  { view: 'contentreports', title: 'Reported content', section: 'Connect', what: 'Posts and comments employees reported, for a human to review. Suwi never moderates.', keywords: ['reported', 'report content', 'moderation', 'flagged'] },
  { view: 'suwi', title: 'Suwi', section: 'Suwi', what: 'Suwi\'s own settings: on or off, the monthly budget, what it may do in each area, and the log of every question and action.', keywords: ['suwi', 'assistant', 'budget', 'suwi settings', 'activity log'] },
];

export const HOW_TOS: HowTo[] = [
  { key: 'add_holiday', title: 'Add a holiday', view: 'holidaybank', keywords: ['add holiday', 'new holiday', 'holiday', 'diwali', 'public holiday'], steps: ['Open Shifts › Holiday Bank.', 'Press Add holiday, give the name and date, and pick the work location it applies to (or all).', 'Save. Attendance and leave counts skip it from then on; no app release needed.'] },
  { key: 'assign_shift', title: 'Assign a shift', view: 'shiftbulk', keywords: ['assign shift', 'put on shift', 'change shift', 'move to shift', 'shift'], steps: ['One person: open their profile under Employees and pick the template on their Shift tab.', 'Many people: open Shifts › Bulk Assign (it opens Suwi), say which shift and who gets it, check the preview table and confirm.', 'The new shift applies from the next day; today stays as it was. Or ask Suwi to prepare the move and confirm it.'] },
  { key: 'add_employee', title: 'Add an employee', view: 'employees', keywords: ['add employee', 'new employee', 'new joiner', 'onboard', 'create user'], steps: ['Open People › Employees and press Add employee.', 'Enter name, email, phone, employee ID, designation, department, work location, joining date and reporting manager.', 'Save. They get a sign-in by email; People › Tasks then lists what is still missing (shift template, KPIs, salary, bank details).'] },
  { key: 'import', title: 'Import employee details from a sheet', view: 'employeeimport', keywords: ['import', 'upload sheet', 'excel', 'csv', 'bulk update', 'spreadsheet'], steps: ['Open People › Import employees and upload the sheet (any layout).', 'Match the sheet\'s columns to Sowaka\'s fields; new people and changed details are shown row by row.', 'Read Suwi\'s line above the preview: it names what in this import could hurt, most serious first.', 'Before approving, check: anyone losing their reporting manager; work emails changing (they sign in with the new one); employee IDs changing (attendance is matched on them); blank cells that remove a value; new people with no reporting manager (they can\'t apply for leave until they have one) or no employee ID; joining date changes (leave accrual and tenure use them) and CTC changes; rows not imported and cells skipped; and the plan\'s account limit.', 'Review and approve; nothing saves until you do.'] },
  { key: 'run_payroll', title: 'Run payroll', view: 'payruns', keywords: ['run payroll', 'process payroll', 'payroll', 'payslips', 'salary run', 'pay month'], steps: ['Check People › Tasks: everyone needs a salary template, CTC, bank details and PAN.', 'Open Payroll › Payroll Runs, start the month, and review attendance-based paid days and any inputs (bonus, arrears, reimbursement bills).', 'Check each person\'s line, then approve. Payslips appear in the app and the reports update.'] },
  { key: 'reimbursement_types', title: 'Set up reimbursement types', view: 'reimbursementtypes', keywords: ['reimbursement type', 'claim type', 'expense type', 'claim cap', 'fuel', 'set up claims'], steps: ['Open Claims › Reimbursement Types and press Add type.', 'Give a name, the cap per claim (0 for none), how many days back a claim may be dated, and optionally the salary component it is the bills for.', 'Save. The app shows the type to employees straight away.'] },
  { key: 'approvals', title: 'Approvals: who decides what', view: 'leave', keywords: ['approval', 'approve', 'who approves', 'approver', 'decline', 'manager approval'], steps: ['Leave, overtime and attendance corrections go to the person\'s reporting manager in the app; HR can decide any of them from Requests on this dashboard.', 'Whether a manager or HR decides is set per shift template (approval rules).', 'Reimbursements are decided only from the dashboard, under Claims › Reimbursements.'] },
  { key: 'leave_types', title: 'Add or change a leave type', view: 'shifttypes', keywords: ['leave type', 'leave policy', 'entitlement', 'leave balance', 'carry forward', 'new leave'], steps: ['Open Shifts › Shift templates and edit the template the people are on.', 'Under leave types, add the type with its per-month accrual, carry-forward and reset rules.', 'Save. Balances recalculate from the template; the app shows the type without a release.'] },
  { key: 'salary_template', title: 'Assign a salary template and CTC', view: 'templates', keywords: ['salary', 'ctc', 'assign salary', 'salary template', 'pay structure'], steps: ['Open Payroll › Salary Templates (or the person\'s Salary details tab) with payroll access.', 'Pick the template and enter the annual CTC; the components fill in by proportion.', 'Save. The next payroll run uses it.'] },
  { key: 'dashboard_access', title: 'Give someone dashboard access', view: 'usersroles', keywords: ['access', 'give access', 'dashboard user', 'permission', 'payroll access', 'admin'], steps: ['Open People › Accesses (admins only).', 'Pick the person, choose the tabs they may open and whether they get payroll access.', 'Save; they sign in with the same account as the app.'] },
  { key: 'attendance_report', title: 'Export the attendance report', view: 'attendancereport', keywords: ['export attendance', 'attendance report', 'monthly attendance', 'download attendance'], steps: ['Open Reports › Attendance report and pick the date range.', 'Filter by department if needed, then press Export for a sheet.'] },
];

/** What Sowaka does not do, so Suwi says so plainly instead of guessing. */
export const NOT_SUPPORTED: { what: string; keywords: string[] }[] = [
  { what: 'Recruitment, job postings or applicant tracking', keywords: ['recruit', 'recruitment', 'hiring', 'job posting', 'job opening', 'vacancy', 'applicant', 'candidate', 'interview', 'ats'] },
  { what: 'Onboarding checklists and exit workflows (the pages are placeholders for now)', keywords: ['onboarding checklist', 'exit interview', 'exit workflow', 'full and final', 'fnf', 'resignation workflow'] },
  { what: 'Learning or training courses', keywords: ['training', 'course', 'learning', 'lms'] },
  { what: 'Asset tracking (laptops, ID cards)', keywords: ['asset', 'laptop', 'id card', 'inventory'] },
  { what: 'Filing PF, ESI, PT or TDS returns with the government (Sowaka produces the reports; filing is done on the portals)', keywords: ['file return', 'filing', 'ecr', 'file pf', 'file tds', 'form 24q', 'challan'] },
  { what: 'Paying salaries out of Sowaka (there is no bank integration; use the salary register with your bank)', keywords: ['bank transfer', 'pay out', 'payout', 'disburse', 'bank integration', 'neft'] },
  { what: 'Biometric device integration (punches come from the app)', keywords: ['biometric', 'fingerprint', 'device sync', 'essl', 'face machine'] },
  { what: 'Editing a policy document from the dashboard (Suwi can draft and publish one for you)', keywords: ['edit policy', 'policy document', 'upload policy', 'handbook'] },
  { what: 'Automatic escalation of requests a manager has not decided (Suwi shows them as waiting instead)', keywords: ['escalate', 'escalation', 'auto approve', 'auto-approve'] },
  { what: 'Changing who can see what from Suwi (People › Accesses is admin-only)', keywords: ['suwi give access', 'suwi permission'] },
];
