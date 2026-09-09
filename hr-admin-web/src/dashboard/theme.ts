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
  | 'policies'
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
  | 'statutorycomponents'
  | 'payruns'
  | 'departments'
  | 'designations'
  | 'employees'
  | 'orgchart'
  | 'usersroles'
  | 'cycle'
  | 'reimbursementtypes'
  | 'shiftbulk'
  | 'games';

export type LeaveType = 'Sick' | 'Casual' | 'Earned' | 'WFH' | 'Unpaid';
export type ReqStatus = 'Pending' | 'Approved' | 'Declined' | 'Paid';
export type FeedbackStatus = 'Submitted' | 'Acknowledged' | 'Pending' | 'Draft';
export type EmpType = 'Full-time' | 'Contract' | 'Intern';
export type OtDuration = 'Full day' | 'Half day';

// Avatar palette — colour is derived deterministically from the name.
const AV = [
  '#B0506A',
  '#7E5FB0',
  '#4A6FA5',
  '#6E7A4E',
  '#3E8E8A',
  '#C57F63',
  '#A85C84',
  '#5E9E7A',
  '#C98A3C',
  '#7C7A52',
];

export const TYPE: Record<LeaveType, string> = {
  Sick: '#C2607A',
  Casual: '#6E7AA8',
  Earned: '#5E9E7A',
  WFH: '#C98A3C',
  Unpaid: '#717171',
};

export const STAT: Record<ReqStatus, Pill> = {
  Pending: { bg: '#F6E9D5', fg: '#9A6B25' },
  Approved: { bg: '#E4EDE0', fg: '#4F7A52' },
  Declined: { bg: '#F4DEE2', fg: '#A8475F' },
  Paid: { bg: '#E7ECF4', fg: '#4A6FA5' },
};

export const FSTAT: Record<FeedbackStatus, Pill> = {
  Acknowledged: { bg: '#E4EDE0', fg: '#4F7A52' },
  Submitted: { bg: '#E7ECF4', fg: '#4A6FA5' },
  Pending: { bg: '#F6E9D5', fg: '#9A6B25' },
  Draft: { bg: '#F7F7F9', fg: '#717171' },
};

export const ETYPE: Record<EmpType, Pill> = {
  'Full-time': { bg: '#E4EDE0', fg: '#4F7A52' },
  Contract: { bg: '#F6E9D5', fg: '#9A6B25' },
  Intern: { bg: '#E7ECF4', fg: '#4A6FA5' },
};

export const OTDUR: Record<OtDuration, Pill> = {
  'Full day': { bg: '#E7F4FB', fg: '#0571A6' },
  'Half day': { bg: '#EEF0E6', fg: '#5E6B3E' },
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
  attendance: ['Attendance', 'People'],
  feedback: ['Performance Reviews', 'Performance · manager reviews & recognition'],
  kpi: ['KPI Parameters', 'Performance · define measurable KPIs'],
  kpitemplates: ['Templates', 'Performance · weighted sets of KPI parameters'],
  kpibulk: ['Bulk Assign', 'Performance · put a template on everyone its rules select'],
  shifttypes: ['Templates', 'Shifts · timings, breaks, segmentation & grace rules'],
  holidaybank: ['Holiday Bank', 'Shifts · master list of holidays, applied by location'],
  policies: ['Policies', 'Shifts · attendance, leave, overtime, late & half-day policies'],
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
  statutorycomponents: ['Statutory Components', 'Payroll · EPF, ESI, PT, LWF & more'],
  payruns: ['Payroll Runs', 'Payroll · monthly runs and payslips'],
  departments: ['Departments', 'People'],
  designations: ['Designations', 'People'],
  employees: ['Employees', 'People'],
  orgchart: ['Org chart', 'People'],
  usersroles: ['Accesses', 'People · users, roles and permissions'],
  cycle: ['Cycle', 'Performance · the monthly review cycle'],
  reimbursementtypes: ['Reimbursement Types', 'Claims · what can be claimed, and the cap on each'],
  shiftbulk: ['Bulk Assign', 'Shifts · put employees on a shift'],
  games: ['Games', 'Connect · hosted games and leaderboards'],
};

export type Placeholder = {
  title: string;
  soon: boolean;
  desc: string;
  fields: string[];
};

export const PH: Partial<Record<View, Placeholder>> = {
  attendance: {
    title: 'Attendance',
    soon: true,
    desc: 'Live clock-in, shift schedules and regularisation tracking are being wired up.',
    fields: [],
  },
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
  orgchart: {
    title: 'Org chart',
    soon: false,
    desc: 'Reporting structure as a top-down tree and an indented expandable view.',
    fields: [],
  },
};
