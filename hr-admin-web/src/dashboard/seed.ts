// View-model types for the dashboard. Data now comes from the live API
// (see services/hrms.ts + adapters.ts); ids are backend ObjectId hex / userId strings.
import type { EmpType, FeedbackStatus, LeaveType, OtDuration, ReqStatus } from './theme';

export type Leave = {
  id: string;
  name: string;
  team: string;
  type: LeaveType;
  from: string;
  to: string;
  days: string;
  dayN: number;
  status: ReqStatus;
  manager: string;
  applied: string;
  ord: number;
  eRemark: string;
  mRemark: string;
  refISO: string; // canonical date for range filtering (leave start date)
  submitterId?: string;
  byAdmin?: boolean;
};

export type Overtime = {
  id: string;
  name: string;
  team: string;
  appliedOn: string;
  otDate: string;
  duration: OtDuration;
  day: string;
  status: ReqStatus;
  manager: string;
  eRemark: string; // employee note / reason
  project: string;
  mRemark: string;
  ord: number;
  refISO: string; // canonical date for range filtering (overtime work date)
  submitterId?: string;
  byAdmin?: boolean;
};

export type FbMgr = {
  id: string;
  name: string;
  scope: string;
  /** Direct reports on the roster — the denominator, whether or not a review exists. */
  total: number;
  /** Reports whose review for the cycle has been sent. */
  done: number;
  reminded: boolean;
};

/**
 * One roster employee and the state of their review for the cycle. Built from
 * the employee list rather than from feedback records, so people nobody has
 * reviewed yet are present with `status: 'none'` instead of missing.
 */
export type FbEmp = {
  userId: string;
  name: string;
  team: string;
  designation: string;
  managerId: string;
  managerName: string;
  /**
   * Submitted or not. An unsent draft counts as `none` here: HR reads this page
   * for reviews that have actually landed, and a half-filled form is not one.
   */
  status: 'sent' | 'none';
  /** Mean across every parameter. Only meaningful once the review is sent. */
  overall: number;
  date: string;
  params: FbCycleParam[];
  extra: string;
  /** Sent reviews from earlier cycles, newest first, in full so any of them can
   *  be opened. Gaps are real — a cycle a manager missed simply has no entry. */
  history: FbCycle[];
};

export type FbCycleParam = { name: string; subtitle: string; score: number; note: string };

/** One completed review, as shown when a past cycle is opened. */
export type FbCycle = {
  period: string;
  overall: number;
  date: string;
  params: FbCycleParam[];
  extra: string;
};

export type Feedback = {
  id: string;
  name: string;
  team: string;
  manager: string;
  parameter: string;
  rating: number;
  ratingDesc: string; // human label for the rating (e.g. "Exceeds expectation")
  isOverall: boolean;
  status: FeedbackStatus;
  date: string;
  ord: number;
  refISO: string;
  note: string; // note for this specific parameter (or overall summary text)
  text: string; // full manager summary (extra)
};

export type Reimb = {
  id: string;
  name: string;
  team: string;
  manager: string;
  type: string;
  amount: string;
  amountN: number;
  billDate: string;
  applyDate: string;
  status: ReqStatus;
  bill: string;
  hasBill?: boolean;
  ord: number;
  eRemark: string; // employee remark / note
  mRemark: string;
  refISO: string; // canonical date for range filtering (expense date)
  submitterId?: string;
  byAdmin?: boolean;
};

export type Emp = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  role: string;
  team: string;
  location: string;
  branch: string;
  recognition: string;
  empType: EmpType;
  manager: string;
  managerId: string;
  dob: string;
  joining: string;
  docs: number;
};

export type UserForm = {
  name: string;
  email: string;
  role: string;
  team: string;
  location: string;
  empType: EmpType;
  manager: string;
  joining: string;
  dob: string;
};

export const DOCS = [
  'Offer letter.pdf',
  'Aadhaar card.pdf',
  'PAN card.pdf',
  'Bank details.pdf',
  'Education certificate.pdf',
  'Experience letter.pdf',
  'Address proof.pdf',
  'Form 16.pdf',
];

export const emptyForm = (): UserForm => ({
  name: '',
  email: '',
  role: '',
  team: 'Design',
  location: 'Bengaluru',
  empType: 'Full-time',
  manager: 'Aanya Verma',
  joining: '',
  dob: '',
});
