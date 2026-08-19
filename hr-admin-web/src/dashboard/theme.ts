// Design tokens, colour maps and helpers — mirrors the Sowaka HRMS design handoff.

export type Pill = { bg: string; fg: string };

export type View =
  | 'organisation'
  | 'overview'
  | 'leave'
  | 'overtime'
  | 'attendance'
  | 'feedback'
  | 'reimbursements'
  | 'onboarding'
  | 'exit'
  | 'payroll'
  | 'payschedule'
  | 'taxdetails'
  | 'payheads'
  | 'templates'
  | 'statutorycomponents'
  | 'salary'
  | 'payruns'
  | 'statutory'
  | 'departments'
  | 'designations'
  | 'employees'
  | 'orgchart'
  | 'usersroles'
  | 'settings'
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
  organisation: ['Organisation', 'The current organisation · Convrse Spaces'],
  overview: ['HR control room', 'Tuesday, 30 June · Convrse Spaces'],
  leave: ['Leave requests', 'Tracking time off · approved by reporting managers'],
  overtime: ['Overtime', 'Tracking overtime · approved by reporting managers'],
  attendance: ['Attendance', 'People · Convrse Spaces'],
  feedback: ['Feedback', 'People · Convrse Spaces'],
  reimbursements: ['Reimbursements', 'People · Convrse Spaces'],
  onboarding: ['Onboarding', 'People · Convrse Spaces'],
  exit: ['Exit', 'People · Convrse Spaces'],
  payroll: ['Payroll', 'People · Convrse Spaces'],
  payschedule: ['Pay Schedule', 'Payroll · how often and when payroll runs'],
  taxdetails: ['Tax Details', 'Payroll · org-level tax identity for filings'],
  payheads: ['Salary Components', 'Payroll · reusable component catalog'],
  templates: ['Salary Templates', 'Payroll · reusable pay groups'],
  statutorycomponents: ['Statutory Components', 'Payroll · EPF, ESI, PT, LWF & more'],
  salary: ['Salary Structure', 'Payroll · assign a template to an employee'],
  payruns: ['Payroll Runs', 'Payroll · monthly runs and payslips'],
  statutory: ['Statutory Rules', 'Payroll · per-state PT, LWF & bonus'],
  departments: ['Departments', 'People · Convrse Spaces'],
  designations: ['Designations', 'People · Convrse Spaces'],
  employees: ['Employees', 'People · Convrse Spaces'],
  orgchart: ['Org chart', 'People · Convrse Spaces'],
  usersroles: ['Accesses', 'People · users, roles and permissions'],
  settings: ['Settings', 'Organisation · Convrse Spaces'],
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
    desc: 'Live clock-in, shift schedules and regularisation tracking are being wired up for Convrse Spaces.',
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
