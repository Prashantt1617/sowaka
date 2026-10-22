// Design tokens, colour maps and helpers — mirrors the Sowaka HRMS design handoff.

export type Pill = { bg: string; fg: string };

export type View =
  | 'organisation'
  | 'overview'
  | 'leave'
  | 'overtime'
  | 'attendance'
  | 'feedback'
  | 'kpi'
  | 'kpitemplates'
  | 'kpibulk'
  | 'shifttypes'
  | 'holidaybank'
  | 'offices'
  | 'oolcheckins'
  | 'support'
  | 'roster'
  | 'shiftswaps'
  | 'reimbursements'
  | 'onboarding'
  | 'exit'
  | 'payroll'
  | 'payschedule'
  | 'taxdetails'
  | 'payheads'
  | 'templates'
  | 'paiddays'
  | 'payrolldash'
  | 'payrollreports'
  | 'statutorycomponents'
  | 'payruns'
  | 'departments'
  | 'designations'
  | 'employees'
  | 'employeeimport'
  | 'peopletasks'
  | 'orgchart'
  | 'attendancereport'
  | 'usersroles'
  | 'cycle'
  | 'reimbursementtypes'
  | 'shiftbulk'
  | 'games'
  | 'relaygame'
  | 'engagementposts'
  | 'contentreports'
  | 'suwi';

/** A leave type as the lists show it: 'Casual', 'Comp-off', or a type HR added, 'Emergency'. */
export type LeaveType = string;
export type ReqStatus = 'Pending' | 'Approved' | 'Declined' | 'Paid';
export type FeedbackStatus = 'Submitted' | 'Acknowledged' | 'Pending' | 'Draft';
export type EmpType = 'Full-time' | 'Contract' | 'Intern';
export type OtDuration = 'Full day' | 'Half day';

// Avatar palette — colour is derived deterministically from the name. The
// avatar shows a soft tint of it with the initials in the full colour.
const AV = [
  '#B0506A',
  '#5E57D6',
  '#0A6AD1',
  'var(--t-olive-i)',
  '#23806A',
  '#C2562A',
  '#A85C84',
  '#3E8E63',
  '#8A6A12',
  '#4E4E56',
];

/** The dot colour for a type; a type HR added uses the neutral one. */
export const typeColor = (type: string): string => TYPE[type] ?? 'var(--ink-3)';

export const TYPE: Record<LeaveType, string> = {
  Sick: '#BF494B',
  Casual: '#857FEB',
  Earned: '#49B195',
  WFH: '#E9C04F',
  Unpaid: '#8A8A93',
};

// Status pills are solid: green done, yellow waiting, red refused, blue paid.
const SOLID = {
  ok: { bg: 'var(--p-green)', fg: 'var(--on-accent)' },
  warn: { bg: 'var(--p-yellow)', fg: 'var(--p-yellow-ink)' },
  bad: { bg: 'var(--p-red)', fg: 'var(--on-accent)' },
  info: { bg: 'var(--p-blue)', fg: 'var(--on-accent)' },
  mute: { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
} satisfies Record<string, Pill>;

export const STAT: Record<ReqStatus, Pill> = {
  Pending: SOLID.warn,
  Approved: SOLID.ok,
  Declined: SOLID.bad,
  Paid: SOLID.info,
};

export const FSTAT: Record<FeedbackStatus, Pill> = {
  Acknowledged: SOLID.ok,
  Submitted: SOLID.info,
  Pending: SOLID.warn,
  Draft: SOLID.mute,
};

export const ETYPE: Record<EmpType, Pill> = {
  'Full-time': SOLID.ok,
  Contract: SOLID.warn,
  Intern: SOLID.info,
};

export const OTDUR: Record<OtDuration, Pill> = {
  'Full day': { bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  'Half day': { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
};

export function avColor(name: string): string {
  let s = 0;
  for (let i = 0; i < name.length; i++) s += name.charCodeAt(i);
  return AV[s % AV.length];
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

// [title, meta] per section.
export const TITLES: Record<View, [string, string]> = {
  organisation: ['Organisation', 'Company profile, identity & contact details'],
  overview: ['HR control room', 'Tuesday, 30 June'],
  leave: ['Leave requests', 'Tracking time off · approved by reporting managers'],
  overtime: ['Overtime', 'Tracking overtime · approved by reporting managers'],
  attendance: ['Attendance corrections', 'Requests · days employees asked to have corrected'],
  feedback: ['Performance Reviews', 'Performance · manager reviews & recognition'],
  kpi: ['KPI Parameters', 'Performance · define measurable KPIs'],
  kpitemplates: ['Templates', 'Performance · weighted sets of KPI parameters'],
  kpibulk: ['Bulk Assign', 'Performance · put a template on everyone its rules select'],
  shifttypes: ['Templates', 'Shifts · timings, breaks, segmentation & grace rules'],
  holidaybank: ['Holiday Bank', 'Shifts · master list of holidays, applied by location'],
  offices: ['Offices', 'Shifts · where a geotagged punch may be taken from'],
  oolcheckins: ['OOL check-ins', 'Requests · punches taken away from every office'],
  support: ['Support desk', 'Support · tickets employees raised from the app'],
  roster: ['Roster', 'Shifts · schedule employees onto shifts'],
  shiftswaps: ['Swap Requests', 'Shifts · shift swap & change approvals'],
  reimbursements: ['Reimbursements', 'People'],
  onboarding: ['Onboarding', 'People'],
  exit: ['Exit', 'People'],
  payroll: ['Payroll', 'People'],
  payschedule: ['Pay Schedule', 'Payroll · how often and when payroll runs'],
  taxdetails: ['Tax Details', 'Payroll · org-level tax identity for filings'],
  payheads: ['Salary Components', 'Payroll · reusable component catalog'],
  templates: ['Salary Templates', 'Payroll · reusable pay groups'],
  paiddays: ['Paid Days Templates', 'Payroll · how attendance becomes paid days'],
  payrolldash: ['Payroll Dashboard', 'Payroll · the month at a glance'],
  payrollreports: ['Payroll Reports', 'Payroll · summaries, registers and statutory reports'],
  statutorycomponents: ['Statutory Components', 'Payroll · EPF, ESI, PT, LWF & more'],
  payruns: ['Payroll Runs', 'Payroll · monthly runs and payslips'],
  departments: ['Departments', 'People'],
  designations: ['Designations', 'People'],
  employees: ['Employees', 'People'],
  employeeimport: ['Import employees', 'People · update details from a sheet, approved before it saves'],
  peopletasks: ['Tasks', 'People · who still needs a template, salary, bank details or basic details'],
  orgchart: ['Org chart', 'People'],
  attendancereport: ['Attendance report', 'Reports'],
  usersroles: ['Accesses', 'People · users, roles and permissions'],
  cycle: ['Cycle', 'Performance · the monthly review cycle'],
  reimbursementtypes: ['Reimbursement Types', 'Claims · what can be claimed, and the cap on each'],
  shiftbulk: ['Bulk Assign', 'Shifts · put employees on a shift'],
  games: ['Games', 'Connect · hosted games and leaderboards'],
  relaygame: ['Relay game', 'Connect · launch-event teams and questions'],
  engagementposts: ['Engagement posts', 'Connect · challenges published for people to play'],
  contentreports: ['Reported content', 'Connect · posts and comments employees have reported'],
  suwi: ['Suwi', 'Your HR assistant · what it may do, and what it did'],
};

export type Placeholder = {
  title: string;
  soon: boolean;
  desc: string;
  fields: string[];
};

export const PH: Partial<Record<View, Placeholder>> = {
  onboarding: {
    title: 'Onboarding',
    soon: true,
    desc: 'New-hire checklists, document collection and welcome flows are on the way.',
    fields: [],
  },
  exit: {
    title: 'Exit',
    soon: true,
    desc: 'Resignations, clearance approvals and full-and-final settlements will live here.',
    fields: [],
  },
  payroll: {
    title: 'Payroll',
    soon: true,
    desc: 'Salary runs, payslips and tax declarations are coming soon.',
    fields: [],
  },
  attendancereport: {
    title: 'Attendance report',
    soon: false,
    desc: 'Attendance for a date range, grouped by how each team\'s punches are captured.',
    fields: [],
  },
  orgchart: {
    title: 'Org chart',
    soon: false,
    desc: 'Reporting structure as a top-down tree and an indented expandable view.',
    fields: [],
  },
};
