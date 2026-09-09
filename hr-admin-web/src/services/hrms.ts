// Typed calls against the org-wide HR-admin (dashboard) endpoints.
import { api } from './http';

// 'admin' = the request was overridden/decided from the HR dashboard (rules 6/7).
export type DecidedByRole = 'manager' | 'admin';

export type LeaveDTO = {
  id: string;
  userId: string;
  employee: { name: string; email?: string; department?: string; designation?: string };
  type: 'sick' | 'casual' | 'earned';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  managerNote?: string;
  createdAt: string;
  decidedAt?: string;
  decidedByRole?: DecidedByRole;
};

export type OvertimeDTO = {
  id: string;
  userId: string;
  employee: { name: string; department?: string };
  workDate: string;
  duration: 'half_day' | 'full_day';
  hours: number;
  project: string;
  note?: string;
  managerNote?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  decidedAt?: string;
  decidedByRole?: DecidedByRole;
};

export type ClaimDTO = {
  id: string;
  userId: string;
  employee: { name: string; department?: string };
  expenseDate: string;
  amount: number;
  category: 'travel' | 'meals' | 'internet' | 'other';
  receiptName?: string;
  hasReceipt?: boolean;
  note?: string;
  managerNote?: string;
  status: 'pending' | 'approved' | 'declined' | 'paid';
  createdAt: string;
  decidedAt?: string;
  paidAt?: string;
  decidedByRole?: DecidedByRole;
};

export type TeamMember = {
  userId: string;
  name: string;
  department: string;
  score: number;
  nextDate: string;
  feedbackStatus: 'pending' | 'saved' | 'sent';
  missedMonths: number;
  parameters: { name: string; score: number; note: string }[];
  extra: string;
};

export type WorkspaceDTO = {
  period: string;
  approverName: string;
  managerScore: number;
  team: TeamMember[];
  recognitionCandidates: TeamMember[];
  nominations: { category: string; employeeUserId: string }[];
};

// ---- Leaves (org-wide) ----
export const getLeaveInbox = () =>
  api<{ leaves: LeaveDTO[] }>('/admin/leaves').then((r) => r.leaves);

// Dashboard override — records the decision as made by admin (rules 6/7).
export const decideLeave = (id: string, decision: 'approved' | 'declined', managerNote?: string) =>
  api<{ leave: LeaveDTO }>(`/admin/leaves/${id}/decision`, {
    method: 'PATCH',
    body: { decision, ...(managerNote ? { managerNote } : {}) },
  }).then((r) => r.leave);

// ---- Overtime (org-wide) ----
export const getOvertimeInbox = () =>
  api<{ overtime: OvertimeDTO[] }>('/admin/overtime').then((r) => r.overtime);

export const decideOvertime = (id: string, decision: 'approved' | 'declined', managerNote?: string) =>
  api<{ overtime: OvertimeDTO }>(`/admin/overtime/${id}/decision`, {
    method: 'PATCH',
    body: { decision, ...(managerNote ? { managerNote } : {}) },
  }).then((r) => r.overtime);

// ---- Reimbursements (org-wide, dashboard-only decisions) ----
export const getReimbInbox = () =>
  api<{ claims: ClaimDTO[] }>('/admin/reimbursements').then((r) => r.claims);

export const decideReimb = (
  id: string,
  decision: 'approved' | 'declined' | 'paid',
  managerNote?: string,
) =>
  api<{ claim: ClaimDTO }>(`/admin/reimbursements/${id}/decision`, {
    method: 'PATCH',
    body: { decision, ...(managerNote ? { managerNote } : {}) },
  }).then((r) => r.claim);

// ---- Company settings (week-off days + per-team overtime) ----
export type CompanySettings = {
  weekoffDays: number[]; // 0 = Sunday .. 6 = Saturday
  overtimeDisabledDepartments: string[];
  departments: string[]; // all departments in the org, for building toggles
  /** Day of month review cycles open on (1-28). */
  reviewCycleStartDay: number;
  /** Where that day currently puts the org — `YYYY-MM` plus its date bounds. */
  currentCycle: { period: string; start: string; end: string };
};

export const getCompanySettings = () =>
  api<{ settings: CompanySettings }>('/admin/company/settings').then((r) => r.settings);

export const updateCompanySettings = (
  patch: Partial<
    Pick<CompanySettings, 'weekoffDays' | 'overtimeDisabledDepartments' | 'reviewCycleStartDay'>
  >,
) =>
  api<{ settings: CompanySettings }>('/admin/company/settings', {
    method: 'PATCH',
    body: patch,
  }).then((r) => r.settings);

// Presigned URL to view the uploaded bill for a claim.
export const getReimbReceiptUrl = (id: string) =>
  api<{ receipt: { url: string; receiptName: string } }>(`/reimbursements/${id}/receipt-url`).then(
    (r) => r.receipt,
  );

// ---- Feedback (org-wide) ----
export type FeedbackDTO = {
  id: string;
  employeeUserId: string;
  employeeName: string;
  department?: string;
  managerUserId: string;
  managerName?: string;
  period: string;
  status: 'saved' | 'sent';
  overallScore: number;
  // `subtitle` is snapshotted onto the record when the review is saved, so a
  // sent review keeps reading the way it did even if HR later renames the KPI.
  parameters: { name: string; subtitle?: string; score: number; note: string }[];
  extra: string;
  updatedAt?: string;
  sentAt?: string;
};

export const getAllFeedback = () =>
  api<{ feedback: FeedbackDTO[] }>('/admin/feedback').then((r) => r.feedback);

// ---- Employees (org-wide) ----
export type EmployeeDTO = {
  userId: string;
  name: string;
  email?: string;
  department?: string;
  designation?: string;
  role: 'manager' | 'employee';
  isLeadership: boolean;
  dashboardAccess: boolean;
  managerUserId?: string;
  managerName?: string;
  lifecycleStatus?: string;
  employeeId?: string;
  location?: string;
  branch?: string;
  /** `User.recognition.label`, when they hold one. */
  recognition?: string;
  employeeType?: string;
  /** YYYY-MM-DD */
  joiningDate?: string;
  /** YYYY-MM-DD */
  birthday?: string;
};

export const getAllEmployees = () =>
  api<{ employees: EmployeeDTO[] }>('/admin/employees').then((r) => r.employees);

export type CreateEmployeeInput = {
  name: string; email: string; designation?: string; department?: string;
  location?: string; employeeType?: string; managerUserId?: string;
  birthday?: string; joiningDate?: string;
};

export const createEmployee = (input: CreateEmployeeInput) =>
  api<{ employee: EmployeeDTO }>('/admin/employees', { method: 'POST', body: input })
    .then((r) => r.employee);

export type LeaderboardEntryDTO = { rank: number; userId: string; playerName: string; score: number; achievedAt: string };
export type GameDTO = {
  id: string; name: string; description: string; hostedUrl: string;
  technology: 'vanilla_js' | 'react_js'; accentColor: string; instructions?: string;
  active: boolean; leaderboard?: LeaderboardEntryDTO[];
};
export type GameInput = Omit<GameDTO, 'id' | 'leaderboard'>;

export const getGames = () => api<{ games: GameDTO[] }>('/admin/games').then((r) => r.games);
export const createGame = (input: GameInput) => api<{ game: GameDTO }>('/admin/games', { method: 'POST', body: input }).then((r) => r.game);
export const updateGame = (id: string, input: GameInput) => api<{ game: GameDTO }>(`/admin/games/${id}`, { method: 'PATCH', body: input }).then((r) => r.game);
export const deleteGame = (id: string) => api(`/admin/games/${id}`, { method: 'DELETE' });
export const publishGame = (id: string) => api(`/admin/games/${id}/publish`, { method: 'POST' });

// ---- Manager workspace (the dashboard user's own feedback-giving context) ----
export const getWorkspace = () => api<WorkspaceDTO>('/manager/workspace');

// ---- Shift templates ----
// A shift carries the thresholds attendance is graded against, so these are
// live records: what HR saves here is what the app reads.
export type DayMark = 'Absent' | 'Half Day' | 'Present' | 'Pending Regularisation';

// A template is a working window, nothing more. Every rule it is graded by
// comes from the org policy below.
export type ShiftDTO = {
  id: string;
  name: string;
  active: boolean;
  /** "HH:MM". An end at or before the start means the shift runs overnight. */
  startTime: string;
  endTime: string;
  /** The shift everyone without one of their own is graded against. */
  isDefault: boolean;
};

export type ShiftInput = Omit<ShiftDTO, 'id'>;

// The org-wide policy behind Shifts › Policies. This is the setup: what HR
// saves here is what the app grades every attendance day against. Each tab
// patches only the fields it owns.
export type ShiftPolicyDTO = {
  missingPunchIn: DayMark;
  missingPunchOut: DayMark;
  missingBoth: DayMark;
  /** Week of month ("1".."5") -> weekday indexes off, 0 = Mon .. 6 = Sun. */
  weeklyOff: Record<string, number[]>;
  minHalfDayHours: number;
  minFullDayHours: number;
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
  overtime: {
    eligible: boolean; onHoliday: boolean; onWeeklyOff: boolean;
    beyondShift: boolean; beyondShiftHours: number;
  };
  correction: {
    triggers: string[]; approver: string; reasons: string[];
    managerWithoutEmployee: boolean; hrOverride: boolean; skipLevel: boolean;
    backdateByEmployee: boolean; backdateByManager: boolean; backdateDays: number;
  };
  leave: {
    advanceDays: number; allowBackdated: boolean; backdatedDays: number;
    approver: string; managerOnBehalf: boolean; hrOverride: boolean; skipLevel: boolean;
  };
  updatedAt?: string;
};

export const getShiftPolicy = () =>
  api<{ policy: ShiftPolicyDTO }>('/admin/shift-policy').then((r) => r.policy);

export const saveShiftPolicy = (patch: Partial<ShiftPolicyDTO>) =>
  api<{ policy: ShiftPolicyDTO }>('/admin/shift-policy', { method: 'PATCH', body: patch })
    .then((r) => r.policy);

export const getShifts = () => api<{ shifts: ShiftDTO[] }>('/admin/shifts').then((r) => r.shifts);

export const createShift = (input: ShiftInput) =>
  api<{ shift: ShiftDTO }>('/admin/shifts', { method: 'POST', body: input }).then((r) => r.shift);

export const updateShift = (id: string, input: ShiftInput) =>
  api<{ shift: ShiftDTO }>(`/admin/shifts/${id}`, { method: 'PATCH', body: input }).then((r) => r.shift);

export const deleteShift = (id: string) => api(`/admin/shifts/${id}`, { method: 'DELETE' });
