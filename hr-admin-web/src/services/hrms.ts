// Typed calls against the org-wide HR-admin (dashboard) endpoints.
import { api, apiUpload } from './http';

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

/** An attendance correction — what the employee says the day should have been. */
export type RegularizationDTO = {
  id: string;
  userId: string;
  employeeId: string;
  employeeCode?: string;
  managerUserId: string;
  manager?: string;
  employee: { name: string; department?: string };
  workDate: string;
  requestedDayType?: 'full_day' | 'half_day' | 'wfh' | 'client_visit' | 'office_visit' | 'leave';
  note?: string;
  status: 'pending' | 'approved' | 'declined';
  managerNote?: string;
  createdAt: string;
  decidedAt?: string;
  decidedByRole?: DecidedByRole;
  /** What the device actually recorded for the day, for comparison. */
  punchIn?: string;
  punchOut?: string;
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
export const getRegularizationInbox = () =>
  api<{ regularizations: RegularizationDTO[] }>('/admin/regularizations').then((r) => r.regularizations);

export const decideRegularization = (
  id: string,
  decision: 'approved' | 'declined',
  managerNote?: string,
) =>
  api<{ regularization: RegularizationDTO }>(`/admin/regularizations/${id}/decision`, {
    method: 'PATCH',
    body: { decision, ...(managerNote ? { managerNote } : {}) },
  }).then((r) => r.regularization);

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
  /** Absolute, or root-relative to the API when served from its fallback store. */
  profilePhotoUrl?: string;
  documents?: EmployeeDocumentDTO[];
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
  employeeId?: string; gender?: string; mobile?: string; branch?: string;
};

/** One employee's month, every day named — including the ones nobody worked. */
export type CalendarDayStatus = ReportStatus | 'week_off' | 'holiday' | 'upcoming';
export type CalendarDayDTO = {
  date: string;
  status: CalendarDayStatus;
  label: string | null;
  punchIn: string | null;
  punchOut: string | null;
  lateByMinutes: number;
  earlyByMinutes?: number;
};
export type EmployeeCalendarDTO = {
  month: string;
  shift: string;
  window: string;
  punchFormat: string;
  days: CalendarDayDTO[];
  totals: Record<CalendarDayStatus, number>;
};
export const getEmployeeCalendar = (userId: string, month: string) =>
  api<{ calendar: EmployeeCalendarDTO }>(`/admin/employees/${userId}/calendar?month=${month}`).then((r) => r.calendar);

/** What HR may file against an employee. Mirrors the server's list. */
export const EMPLOYEE_DOCUMENT_TYPES = ['Offer letter', 'ID proof', 'Address proof', 'Experience letter', 'Resume'] as const;

export type EmployeeDocumentDTO = {
  id: string;
  name: string;
  type: string | null;
  /** A link the browser can open; short-lived for stored files. */
  url?: string;
  uploadedAt: string | null;
  size: number | null;
};

/** Uploads one document and returns the employee's whole list, as the server now has it. */
export const addEmployeeDocument = (userId: string, type: string, file: File) => {
  const form = new FormData();
  form.append('type', type);
  form.append('document', file);
  return apiUpload<{ documents: EmployeeDocumentDTO[] }>(`/admin/employees/${userId}/documents`, form)
    .then((r) => r.documents);
};

export const removeEmployeeDocument = (userId: string, documentId: string) =>
  api<{ documents: EmployeeDocumentDTO[] }>(`/admin/employees/${userId}/documents/${documentId}`, { method: 'DELETE' })
    .then((r) => r.documents);

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
export type DayMark = 'Absent' | 'Half Day' | 'Present';

export type LeaveTypeKey = 'sick' | 'casual' | 'earned' | 'comp_off';

/**
 * One leave type's accrual and what happens to an unused balance at year end.
 * Carry forward first, then encash what is left; anything still remaining
 * lapses, which is why lapse is shown rather than set.
 */
export type LeaveTypeRule = {
  key: LeaveTypeKey;
  name: string;
  /** Days earned per month. Always 0 for comp-off, which overtime credits. */
  perMonth: number;
  /** 'monthly' closes the balance at the end of every month instead of once a year. */
  resetOn: 'calendar_year' | 'financial_year' | 'monthly';
  carryForwardDays: number;
  encashment: 'none' | 'all' | 'limit';
  encashLimitDays: number;
  /** How far ahead this type can be applied for. */
  advanceDays: number;
  allowBackdated: boolean;
  backdatedDays: number;
  /** Off means nobody can apply for it; leave already taken keeps reading. */
  active: boolean;
};

/** Year-end split for one balance — mirrors processYearEnd on the server. */
export function processYearEnd(closing: number, rule: LeaveTypeRule) {
  const balance = Math.max(0, closing);
  const carried = Math.min(balance, Math.max(0, rule.carryForwardDays));
  const remainder = balance - carried;
  const encashed =
    rule.encashment === 'all'
      ? remainder
      : rule.encashment === 'limit'
        ? Math.min(remainder, Math.max(0, rule.encashLimitDays))
        : 0;
  return { carried, encashed, lapsed: remainder - encashed };
}

/**
 * How an employee's punches are captured. Set per shift template, so teams on
 * different hardware can run side by side. Only Biometric is wired end to end
 * today; in-app punch-in can be configured ahead of its screens.
 */
export type PunchFormat =
  | 'Biometric'
  | 'Geotag (powered by Sowaka)'
  | 'Present by default (Auto Punch)'
  | 'In-app punch in';

/** Whether a day is built from one punch or two. */
export type PunchMode = 'Both punches' | 'Single punch';

/** What an employee may ask an absent day to be changed to. */
export type CorrectionOutcome = 'Full day' | 'Half day' | 'Leave';

// A template is a named override of the org policy plus the people it covers.
// It starts as a copy of the org policy and every field is editable; anyone it
// is not assigned to stays on the org policy.
export type ShiftDTO = {
  id: string;
  name: string;
  active: boolean;
  policy: ShiftPolicyDTO;
  /** How this template's people punch. Empty means the org's setting applies. */
  punchFormat: PunchFormat | '';
  punchMode: PunchMode | '';
  /** Whether this shift may claim overtime; null takes the org's answer. */
  overtimeEligible: boolean | null;
  /** The template everyone not assigned elsewhere follows. One per org. */
  isDefault: boolean;
  createdAt?: string;
  assignedUserIds: string[];
  assignedCount: number;
};

export type ShiftInput = {
  name: string;
  active?: boolean;
  /** Only the fields being changed; the rest keep the template's current values. */
  policy?: Partial<ShiftPolicyDTO>;
  /** How this template's people punch. Empty inherits the org's setting. */
  punchFormat?: PunchFormat | '';
  punchMode?: PunchMode | '';
  /** Sent only when this shift overrides the org's overtime answer. */
  overtimeEligible?: boolean;
};

/** One person a rule set selected, and the shift they are on today. */
export type ShiftAudienceMember = {
  userId: string;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  location: string;
  managerName: string;
  currentShift: { id: string; name: string } | null;
};

export type ShiftRules = {
  locations?: string[];
  designations?: string[];
  departments?: string[];
  managerUserIds?: string[];
};

export const resolveShiftAudience = (rules: ShiftRules) =>
  api<{ rules: Required<ShiftRules>; members: ShiftAudienceMember[] }>('/admin/shifts/audience', {
    method: 'POST', body: rules,
  });

// A move takes effect the day after it is made — the day already under way was
// worked under the old shift — and the server says which day that is.
export const assignShift = (id: string, userIds: string[]) =>
  api<{ shift: ShiftDTO & { effectiveFrom?: string } }>(`/admin/shifts/${id}/assign`, { method: 'POST', body: { userIds } })
    .then((r) => r.shift);

export const unassignShift = (id: string, userIds: string[]) =>
  api<{ shift: ShiftDTO & { effectiveFrom?: string } }>(`/admin/shifts/${id}/unassign`, { method: 'POST', body: { userIds } })
    .then((r) => r.shift);

// The org-wide policy behind Shifts › Policies. This is the setup: what HR
// saves here is what the app grades every attendance day against. Each tab
// patches only the fields it owns.
export type ShiftHalfDayRulesDTO = {
  /** Fewer hours than the half-day minimum is absent, not a half day. */
  minHalfDayEnabled: boolean;
  /** Fewer hours than the full-day minimum is a half day. */
  minFullDayEnabled: boolean;
  lateArrivalEnabled: boolean;
  lateArrivalMinutes: number;
  earlyLeaveEnabled: boolean;
  earlyLeaveMinutes: number;
};

export type ShiftPolicyDTO = {
  /** "HH:MM". An end at or before the start means the shift runs overnight. */
  startTime: string;
  endTime: string;
  missingPunchIn: DayMark;
  missingPunchOut: DayMark;
  missingBoth: DayMark;
  /** Week of month ("1".."5") -> weekday indexes off, 0 = Mon .. 6 = Sun. */
  weeklyOff: Record<string, number[]>;
  /** The four half-day rules, each on or off. */
  halfDay: ShiftHalfDayRulesDTO;
  minHalfDayHours: number;
  minFullDayHours: number;
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
  overtime: {
    /** Whether the org offers overtime at all — the per-employee and per-team
     *  switches still apply on top. */
    eligible: boolean;
    /** How far back an overtime claim can reach, in days. */
    backdateDays: number;
  };
  correction: {
    /** Which missing-punch outcomes an employee may correct. */
    triggers: string[];
    /** Where punch data comes from. */
    punchFormat: PunchFormat;
    /** Whether the day is built from one punch or two. */
    punchMode: PunchMode;
    /** What an absent day may be corrected to. A half day is fixed to a full day. */
    absentOutcomes: CorrectionOutcome[];
    approver: string;
    managerWithoutEmployee: boolean; hrOverride: boolean; skipLevel: boolean;
    /** How far back a correction may reach, in days. */
    backdateDays: number;
  };
  leave: {
    approver: string;
    hrOverride: boolean;
    /**
     * Whether these employees have a leave balance. Off means unlimited leave:
     * nothing is counted down, and the accrual below describes nothing.
     */
    balanceTracked: boolean;
    /** Accrual, year-end handling and the application window, per leave type. */
    types: LeaveTypeRule[];
  };
  updatedAt?: string;
};

export const setDefaultShift = (id: string) =>
  api<{ shift: ShiftDTO }>(`/admin/shifts/${id}/default`, { method: 'POST', body: {} }).then((r) => r.shift);

/**
 * What a template starts from when an org has no default template yet — the
 * same figures the server falls back to. Once an org has a default, a new
 * template copies that instead.
 */
export const DEFAULT_SHIFT_POLICY: ShiftPolicyDTO = {
  startTime: '09:00',
  endTime: '18:00',
  missingPunchIn: 'Absent',
  missingPunchOut: 'Absent',
  missingBoth: 'Absent',
  weeklyOff: { '1': [6], '2': [6], '3': [6], '4': [6], '5': [6] },
  halfDay: { minHalfDayEnabled: false, minFullDayEnabled: true, lateArrivalEnabled: false, lateArrivalMinutes: 120, earlyLeaveEnabled: false, earlyLeaveMinutes: 60 },
  minHalfDayHours: 4,
  minFullDayHours: 8,
  lateGraceMinutes: 10,
  earlyOutGraceMinutes: 10,
  overtime: { eligible: true, backdateDays: 7 },
  correction: {
    triggers: ['Missing punch-in', 'Missing punch-out', 'Both punches missing'],
    punchFormat: 'Present by default (Auto Punch)',
    punchMode: 'Both punches',
    absentOutcomes: ['Full day', 'Half day', 'Leave'],
    approver: 'Reporting manager',
    managerWithoutEmployee: true, hrOverride: true, skipLevel: false,
    backdateDays: 7,
  },
  leave: {
    approver: 'Reporting manager',
    hrOverride: true,
    balanceTracked: true,
    types: [
      { key: 'casual', name: 'Casual Leave', perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 15, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 3, active: true },
      { key: 'earned', name: 'Earned Leave', perMonth: 1.5, resetOn: 'financial_year', carryForwardDays: 15, encashment: 'all', encashLimitDays: 0, advanceDays: 90, allowBackdated: false, backdatedDays: 0, active: true },
      { key: 'comp_off', name: 'Comp-off', perMonth: 0, resetOn: 'calendar_year', carryForwardDays: 5, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: false, backdatedDays: 0, active: true },
    ],
  },
};

export const getShifts = () => api<{ shifts: ShiftDTO[] }>('/admin/shifts').then((r) => r.shifts);

export const createShift = (input: ShiftInput) =>
  api<{ shift: ShiftDTO }>('/admin/shifts', { method: 'POST', body: input }).then((r) => r.shift);

export const updateShift = (id: string, input: ShiftInput) =>
  api<{ shift: ShiftDTO }>(`/admin/shifts/${id}`, { method: 'PATCH', body: input }).then((r) => r.shift);

export const deleteShift = (id: string) => api<{ newDefault: string | null }>(`/admin/shifts/${id}`, { method: 'DELETE' });

// ---- Holiday bank ----
// A holiday is assigned to employees by their work location; `*` is everyone.
export type HolidayType = 'Public' | 'Restricted' | 'Optional';
export const ALL_LOCATIONS = '*';

export type HolidayDTO = {
  id: string;
  /** Work location, or `*` for every location. */
  state: string;
  type: HolidayType;
  /** YYYY-MM-DD */
  date: string;
  name: string;
};

/** The whole org's master list, across every location. */
export const getHolidays = () =>
  api<{ holidays: HolidayDTO[] }>('/holidays?state=*').then((r) => r.holidays);

export const createHoliday = (input: { date: string; name: string; state: string; type: HolidayType }) =>
  api<{ holiday: HolidayDTO }>('/holidays', { method: 'POST', body: input }).then((r) => r.holiday);

export const deleteHoliday = (id: string) => api(`/holidays/${id}`, { method: 'DELETE' });

// ---- Claims › reimbursement types ----
// The expense types an org lets people claim against. Each carries its own cap,
// which the app checks before submitting and the server enforces on save.
export type ReimbursementTypeDTO = {
  id: string;
  name: string;
  description: string;
  /** Rupees. Zero means uncapped. */
  maxLimit: number;
  /** How far back a claim may be dated, in days. Zero means today only. */
  backdateDays: number;
  active: boolean;
};

export type ReimbursementTypeInput = Omit<ReimbursementTypeDTO, 'id'>;

export const getReimbursementTypes = () =>
  api<{ types: ReimbursementTypeDTO[] }>('/admin/reimbursement-types').then((r) => r.types);

export const createReimbursementType = (input: ReimbursementTypeInput) =>
  api<{ type: ReimbursementTypeDTO }>('/admin/reimbursement-types', { method: 'POST', body: input })
    .then((r) => r.type);

export const updateReimbursementType = (id: string, input: ReimbursementTypeInput) =>
  api<{ type: ReimbursementTypeDTO }>(`/admin/reimbursement-types/${id}`, { method: 'PATCH', body: input })
    .then((r) => r.type);

export const deleteReimbursementType = (id: string) =>
  api(`/admin/reimbursement-types/${id}`, { method: 'DELETE' });

// ---- Connect moderation (what employees reported from the app's feed) ----
export type ContentReportDTO = {
  id: string;
  postId: string;
  commentId?: string;
  target: 'post' | 'comment';
  reason: string;
  reasonLabel: string;
  note?: string;
  reporterUserId: string;
  reporterName: string;
  authorUserId?: string;
  authorName: string;
  excerpt: string;
  currentText: string;
  postTag: string;
  postType: string;
  /** False once the post or comment has been deleted. */
  stillPresent: boolean;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: string;
  reviewedAt?: string;
  reviewedByName?: string;
  reviewNote?: string;
};

export const getContentReports = (status?: string) =>
  api<{ reports: ContentReportDTO[] }>(
    `/admin/connect/reports${status && status !== 'all' ? `?status=${status}` : ''}`,
  ).then((r) => r.reports);

export const reviewContentReport = (id: string, input: { status: string; note?: string }) =>
  api(`/admin/connect/reports/${id}`, { method: 'PATCH', body: input });

/** Takes the reported post down. Comments are removed by editing the post. */
export const removeReportedPost = (postId: string) =>
  api(`/connect/posts/${postId}`, { method: 'DELETE' });

// ---------------------------------------------------------- engagement posts

/**
 * The engagement formats HR can publish into Connect. One today; the list is
 * what the composer offers, so a new template becomes a new entry here plus a
 * field set below rather than a new screen.
 */
export type EngagementPostType =
  | 'caption_challenge'
  | 'photo_story_challenge'
  | 'most_likely';

export type EngagementPostDTO = {
  id: string;
  type: string;
  tag: string;
  tagIcon: string;
  author: { name: string };
  body: Record<string, unknown>;
  publishedAt: string;
};

export type CaptionChallengeInput = {
  type: EngagementPostType;
  title: string;
  /**
   * The whole brief, in one field. This was a bold opening line plus a
   * paragraph under it, which asked whoever wrote it to split one thought in
   * two — and the card ran them together anyway.
   */
  task: string;
  pointsPerVote: number;
  /** When entries close, as an ISO instant. Empty leaves it open. */
  closesAt: string;
  photo: File | null;
  /** Most Likely only — the question card. */
  label: string;
  question: string;
};

/**
 * Publishes a caption challenge to the feed.
 *
 * Sent as multipart because the picture is the post — a caption challenge
 * without one is nothing to caption.
 */
export function publishCaptionChallenge(input: CaptionChallengeInput) {
  const form = new FormData();
  form.append('type', input.type);
  form.append('removeMedia', 'false');
  form.append(
    'body',
    JSON.stringify({
      title: input.title,
      task: input.task,
      pointsPerVote: input.pointsPerVote,
      closesAt: input.closesAt,
      label: input.label,
      question: input.question,
    }),
  );
  if (input.photo) form.append('media', input.photo);
  return apiUpload<{ post: EngagementPostDTO }>('/connect/posts', form);
}

/**
 * Engagement posts already in the feed, newest first.
 *
 * The server does the narrowing. Asking for the whole feed and filtering here
 * meant the page of 50 was spent on ordinary posts, so older challenges
 * dropped off the list entirely once enough of them piled up — and every
 * photo on those posts was signed just to be discarded.
 */
export async function getEngagementPosts(): Promise<EngagementPostDTO[]> {
  const types = 'caption_challenge,photo_story_challenge,most_likely';
  const data = await api<{ posts: EngagementPostDTO[] }>(
    `/connect/feed?types=${encodeURIComponent(types)}`,
  );
  return data.posts ?? [];
}

export function deleteEngagementPost(postId: string) {
  return api<void>(`/connect/posts/${postId}`, { method: 'DELETE' });
}

// ---- Reports › Attendance ----

export type ReportStatus = 'present' | 'half_day' | 'missed_punch' | 'on_leave' | 'absent';

export type ReportPersonDTO = {
  name: string;
  employeeId: string;
  department: string;
  location: string;
  /** Null when they follow the org policy rather than a template. */
  template: string | null;
  punchFormat: string;
  /** Who they report to, by name; empty at the top of the tree. */
  manager: string;
};

/** [userId, date, status, lateByMinutes, punchIn, punchOut, leaveType, source] */
export type ReportDayDTO = [string, string, ReportStatus, number, string | null, string | null, string | null, string | null, number?];

export type AttendanceReportDTO = {
  from: string;
  to: string;
  departments: string[];
  templates: string[];
  leaveTypes: string[];
  punchFormats: string[];
  managers: string[];
  people: Record<string, ReportPersonDTO>;
  days: ReportDayDTO[];
};

/** One employee's one day, with who they are folded back in. */
export type ReportRow = ReportPersonDTO & {
  userId: string;
  date: string;
  status: ReportStatus;
  /** An overlay on a day that has a punch-in, not a status of its own. */
  late: boolean;
  lateByMinutes: number;
  punchIn: string | null;
  punchOut: string | null;
  leaveType: string | null;
  source: string | null;
};

/** The wire shape is tuples pointing at people; the page wants rows. */
export function expandReport(report: AttendanceReportDTO): ReportRow[] {
  return report.days.map(([userId, date, status, lateBy, punchIn, punchOut, leaveType, source, earlyBy]) => ({
    ...(report.people[userId] ?? { name: '—', employeeId: '—', department: '—', location: '—', template: null, punchFormat: '—', manager: '' }),
    userId, date, status, late: lateBy > 0, lateByMinutes: lateBy, earlyByMinutes: earlyBy ?? 0, punchIn, punchOut, leaveType, source,
  }));
}

/** Every working day in a range, graded per employee against their own policy. */
export const getAttendanceReport = (input: { from: string; to: string }) =>
  api<{ report: AttendanceReportDTO }>(
    `/admin/reports/attendance?${new URLSearchParams({ from: input.from, to: input.to })}`,
  ).then((r) => r.report);
