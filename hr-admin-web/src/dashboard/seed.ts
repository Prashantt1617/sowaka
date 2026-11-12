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
  /** Last day of the leave, YYYY-MM-DD…; the start date when absent. */
  endISO?: string;
  submitterId?: string;
  byAdmin?: boolean;
  /**
   * What the status pill reads: the status, except for a cancelled leave, which says what it had
   * been ("Cancelled pending leave" / "Cancelled approved leave").
   */
  statusLabel: string;
  /** The employee's note when they cancelled it (or asked to). */
  cancelNote: string;
  cancelledOn?: string;
  /** The employee's request to cancel this leave once approved. */
  cancelRequest?: {
    status: 'Pending' | 'Approved' | 'Declined';
    requested: string;
    note: string;
    decisionNote: string;
    byAdmin: boolean;
  };
};

/** An overtime pay / comp-off choice as a select value. */
export type OtChoice = 'pay' | 'comp_off_1' | 'comp_off_0.5';

export type Overtime = {
  id: string;
  name: string;
  team: string;
  appliedOn: string;
  otDate: string;
  duration: OtDuration;
  /** The employee's preference: "Overtime Pay", or "Leave (Comp-off) · Full day"; empty on a request from before the choice. */
  preference?: string;
  /** "+1 Comp-off" / "+0.5 Comp-off" when the preference is comp-off; empty otherwise. */
  preferenceCredit?: string;
  /** The preference as a decision select value, to start HR's select from. */
  preferredChoice?: OtChoice;
  /** The final call once approved, in the same words; empty while pending, declined, or on an older request with none. */
  decision?: string;
  /** "+1 Comp-off" / "+0.5 Comp-off" when decided as comp-off. */
  decisionCredit?: string;
  /** Whether the decision differs from what the employee asked for. */
  decisionDiffers?: boolean;
  /** Whether comp-off can be decided for this person (HR has a Comp-off leave type for them). */
  compOffAvailable: boolean;
  hours: number;
  day: string;
  status: ReqStatus;
  manager: string;
  eRemark: string; // employee note / reason
  mRemark: string;
  ord: number;
  refISO: string; // canonical date for range filtering (overtime work date)
  submitterId?: string;
  byAdmin?: boolean;
};

/** An attendance correction as the dashboard table reads it. */
export type Correction = {
  id: string;
  name: string;
  team: string;
  employeeCode: string;
  appliedOn: string;
  workDate: string;
  day: string;
  dayType: string;
  status: ReqStatus;
  manager: string;
  eRemark: string;
  mRemark: string;
  /** What the device recorded, so HR can see what is being corrected. */
  recorded: string;
  ord: number;
  refISO: string;
  submitterId?: string;
  byAdmin?: boolean;
  /** What is being corrected: a missing punch (which), or a punch away from every office. */
  kind?: 'out' | 'in' | 'both' | 'day' | 'ool';
  /** What they asked the day to count as: "Full day", "Half day", "Work from home"… */
  askedFor?: string;
  /** Raw punch times, ISO, for the detail panel. */
  punchInISO?: string;
  punchOutISO?: string;
  /** Out of location only. */
  ool?: { reason: string; place: string; latitude: number; longitude: number; at: string };
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

export type FbCycleParam = { name: string; score: number; note: string };

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
  /** Loadable image URL, or empty when they have not added one. */
  photoUrl: string;
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
  /** YYYY-MM-DD, or empty: what the Edit details form starts from. */
  joiningDate: string;
  birthday: string;
  gender: string;
  phone: string;
  isDirector: boolean;
  /** What HR has filed against them — offer letter, ID proof and the like. */
  documents: EmpDocument[];
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

export type EmpDocument = {
  id: string;
  name: string;
  type: string;
  url?: string;
  /** "10 Sep", or '' when the record predates uploads. */
  uploadedOn: string;
};

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
