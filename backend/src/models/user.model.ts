import type { UserFaceId } from './face.model';

export type EmployeeType = 'intern' | 'full_time' | 'contract';

export type UserLifecycleStatus =
  | 'active'
  | 'onboarding'
  | 'on_leave'
  | 'notice'
  | 'offboarded'
  | 'terminated';

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';

/** Why someone is leaving. 'consultant' (PF employee to consultant) keeps them working; recording one comes with step 3. */
export type ExitKind = 'resigned' | 'terminated' | 'absconded' | 'retired' | 'other';
export const EXIT_KINDS: ExitKind[] = ['resigned', 'terminated', 'absconded', 'retired', 'other'];
export type ExitRuleKind = ExitKind | 'consultant';
export const EXIT_RULE_KINDS: ExitRuleKind[] = ['resigned', 'terminated', 'absconded', 'consultant', 'retired', 'other'];

/**
 * What an exit does, per kind: the company's defaults (Setup › Payroll › Exit settings),
 * copied onto each exit when it is recorded and changeable for that one person.
 * holdPay and access act now; the notice lines are read by the final settlement.
 * Gratuity (the law: 5 years or more) and leave encashment (each leave type's own
 * encashment rule) are not exit settings.
 */
export interface ExitRules {
  /** Hold their pay from the day notice begins, paid with the settlement. */
  holdPay: boolean;
  /** When app access ends. */
  access: 'day_after' | 'at_once' | 'never';
  /** Paid instead of notice (the company ends the job early). */
  noticePay: 'none' | 'hr_chooses' | 'pay';
  /** Recovered when the employee leaves without serving the notice. */
  noticeRecovery: 'none' | 'days_not_served' | 'whole_notice';
}
export const EXIT_RULE_CHOICES: { [K in keyof ExitRules]: ExitRules[K][] } = {
  holdPay: [true, false],
  access: ['day_after', 'at_once', 'never'],
  noticePay: ['none', 'hr_chooses', 'pay'],
  noticeRecovery: ['none', 'days_not_served', 'whole_notice'],
};
/** The starting point for every company until HR changes it (the plan's table). */
export const DEFAULT_EXIT_RULES: Record<ExitRuleKind, ExitRules> = {
  resigned: { holdPay: true, access: 'day_after', noticePay: 'none', noticeRecovery: 'days_not_served' },
  terminated: { holdPay: true, access: 'at_once', noticePay: 'hr_chooses', noticeRecovery: 'none' },
  absconded: { holdPay: true, access: 'at_once', noticePay: 'none', noticeRecovery: 'whole_notice' },
  consultant: { holdPay: false, access: 'never', noticePay: 'none', noticeRecovery: 'none' },
  retired: { holdPay: true, access: 'day_after', noticePay: 'none', noticeRecovery: 'none' },
  other: { holdPay: true, access: 'day_after', noticePay: 'none', noticeRecovery: 'none' },
};

/**
 * An exit HR has recorded. Until the last working day the person is on notice
 * and uses the app as before; from the day after (00:00 IST, or at once when HR
 * ends access) they are offboarded (terminated, for a termination or an
 * absconding), their sessions and device tokens go, and payroll pays nothing
 * after the last working day. `endDate` on the user mirrors `lastWorkingDay`.
 */
export interface UserExit {
  kind: ExitKind;
  /** 'YYYY-MM-DD': when they resigned or were told; the notice counts from it. */
  noticeFrom?: string;
  /** 'YYYY-MM-DD': their last day at work, paid in full. */
  lastWorkingDay: string;
  /** Notice the role requires, in days (as HR enters it). */
  noticeDays?: number;
  note?: string;
  recordedByUserId: string;
  recordedByName?: string;
  recordedAt: Date;
  /** When their access ended (the nightly job or HR's "End access now"). */
  accessEndedAt?: Date;
  /** Who takes over their team, when they have one. */
  newManagerUserId?: string;
  /**
   * When the team moves to the new manager: the day after the last working day
   * (so the leaving manager still approves during notice), or at once ("Move
   * them now", a termination, an absconding). `teamMovedAt` is when it happened;
   * `teamToldAt` when the heads-up went to the team and the new manager.
   */
  teamMove?: 'day_after' | 'now';
  teamMovedAt?: Date;
  teamToldAt?: Date;
  /** The rules for this exit: the company's for its kind when recorded, with HR's changes. */
  rules?: ExitRules;
  /** What must come back or be closed before the settlement is approved; HR ticks each. */
  clearance?: ExitClearanceItem[];
  /** The exit interview: the employee's answers (the app) or HR's after a conversation. HR only. */
  interview?: ExitInterview;
  /** An absconding: when HR closed the case, which starts its settlement. */
  caseClosedAt?: Date;
  caseClosedByName?: string;
}

export interface ExitClearanceItem {
  key: string;
  label: string;
  done: boolean;
  doneAt?: Date;
  doneByName?: string;
}
/** The list every exit starts with. */
export const DEFAULT_EXIT_CLEARANCE: { key: string; label: string }[] = [
  { key: 'handover', label: 'Work handed over' },
  { key: 'laptop', label: 'Laptop and accessories returned' },
  { key: 'id_card', label: 'ID card and access cards returned' },
  { key: 'advances', label: 'Advances and loans cleared' },
];

export const EXIT_INTERVIEW_REASONS = ['pay', 'growth', 'manager', 'work_life', 'relocation', 'studies', 'other'] as const;
export type ExitInterviewReason = (typeof EXIT_INTERVIEW_REASONS)[number];
export interface ExitInterview {
  reason?: ExitInterviewReason;
  /** 1 to 5. */
  workRating?: number;
  managerRating?: number;
  comeBack?: 'yes' | 'maybe' | 'no';
  change?: string;
  filledBy: 'employee' | 'hr';
  filledByName?: string;
  filledAt: Date;
}

/** How the notice lines of a settlement are worked out (Setup › Payroll › Exit settings); each has a default. */
export interface ExitNoticeSettings {
  /** A day of notice not given is recovered at… */
  recoveryBasis: 'basic_30' | 'gross_30' | 'basic_month';
  /** A day of notice pay is paid at… */
  noticePayBasis: 'gross_30' | 'basic_30' | 'gross_month';
  /** Unused leave covers the days not given first; only the rest is recovered. */
  leaveCoversShortfall: boolean;
  /** How many days before the last day the team and the new manager are told. */
  teamNoticeDays: number;
}
export const DEFAULT_EXIT_NOTICE: ExitNoticeSettings = { recoveryBasis: 'basic_30', noticePayBasis: 'gross_30', leaveCoversShortfall: false, teamNoticeDays: 7 };
export const EXIT_NOTICE_CHOICES = {
  recoveryBasis: ['basic_30', 'gross_30', 'basic_month'],
  noticePayBasis: ['gross_30', 'basic_30', 'gross_month'],
} as const;

export type NoticeStatus = 'none' | 'serving' | 'completed';

/**
 * A document HR has filed against an employee — an offer letter, an ID proof.
 *
 * Uploaded ones carry an `objectKey` and are presigned on every read, the way
 * profile photos are; `url` only remains for records written before uploads
 * existed, which pointed at a link rather than a stored file.
 */
export interface EmployeeDocument {
  id?: string;
  name: string;
  url?: string;
  objectKey?: string;
  contentType?: string;
  size?: number;
  type?: string;
  uploadedAt?: Date;
}

export interface UserRecognition {
  label: string;
  period: string;
}

/**
 * Master user / employee record. Created (minimally) on first login by the auth
 * flow and enriched by HR. Identity for the rest of the system is `userId`.
 */
export interface User {
  employeeId?: string;
  name: string;
  email: string;
  userId: string;
  birthday?: Date;
  joiningDate?: Date;
  endDate?: Date | null;
  /** An exit HR has recorded (see UserExit); absent for everyone still employed. */
  exit?: UserExit;
  documents?: EmployeeDocument[];
  lifecycleStatus: UserLifecycleStatus;
  /**
   * Storage key for the profile photo, resolved to a URL per read. Never store
   * the resolved value here: without S3 it resolves to a `data:` URI hundreds
   * of KB long, and this document is fetched on every authenticated request.
   */
  profilePhotoKey?: string;
  /** @deprecated Legacy inline `data:` URI — read-only, migrated to `profilePhotoKey`. */
  profilePhotoUrl?: string;
  location?: string;
  state?: string;
  /**
   * What the person said they are into, picked once during onboarding.
   *
   * Stored as given and read by nothing yet: the point today is to have it
   * when something — a feed that knows what you like, a club, a game — asks.
   */
  interests?: string[];
  /** Free text: the roster records what people tell HR, not a fixed set. */
  gender?: string;
  /** Personal mobile, captured when HR adds the employee. */
  phone?: string;
  /** Personal email (from the candidate's offer, set at Mark joined): where the final settlement goes after they leave. */
  personalEmail?: string;
  designation?: string;
  department?: string;
  teamDescription?: string;
  managerUserId?: string; // -> User.userId
  org?: string; // -> Company.id
  hrPrimaryUserId?: string; // -> User.userId
  employeeType?: EmployeeType;
  onboardingStatus?: OnboardingStatus;
  noticeStatus?: NoticeStatus;
  leaveBalance?: number;
  branch?: string;
  recognition?: UserRecognition;
  /**
   * Engagement points, earned from Connect — currently ten per vote a caption
   * receives. Accumulated now and not spent anywhere yet: the balance is what
   * a later rewards flow will read, so it has to be accurate from the first
   * challenge rather than backfilled from votes nobody kept.
   *
   * Absent on everyone who joined before this existed, which reads as zero.
   */
  points?: number;
  role?: 'manager' | 'employee';
  // Leadership have no manager and do not raise approval-gated requests.
  isLeadership?: boolean;
  /**
   * May start a contest in Connect (caption, photo story, Most Likely).
   * Granted per person; absent means no. Entering and voting need nothing.
   */
  canCreateContests?: boolean;
  // Grants access to the HR dashboard (org-wide view + request overrides).
  // Independent of the reporting role — a manager/employee may or may not have it.
  dashboardAccess?: boolean;
  /** Manages who sees which dashboard tabs (People › Accesses); sees every tab. */
  dashboardAdmin?: boolean;
  /**
   * The dashboard tabs this person may open, by view key. Absent means every
   * tab, which is what everyone with access had before tabs were assignable.
   */
  dashboardTabs?: string[];
  /**
   * Support desk role, set only by a dashboard admin in People › Accesses.
   * 'head' sees and assigns every ticket of the org; 'staff' sees only the
   * tickets assigned to them. Never implied by dashboard access or admin, and
   * only effective alongside `dashboardAccess`. Absent: no Support desk.
   */
  supportRole?: 'head' | 'staff';
  supportRoleSetBy?: string;
  supportRoleSetAt?: Date;
  /**
   * May edit every field of the employee profile on the dashboard — their own
   * and that of everyone below them in the reporting line. Given per person by
   * script (today cde's founder alone); absent means no.
   */
  canEditEmployeeDetails?: boolean;
  /** A director / person with substantial interest (Form 12BA). Absent means no. */
  isDirector?: boolean;
  /**
   * Per-employee overtime eligibility, set by HR from the dashboard. Absent
   * means eligible, so existing employees keep the behaviour they had before
   * this flag existed. Applied on top of the department-level gate
   * (`Company.overtimeDisabledDepartments`) — either one blocks.
   */
  overtimeEligible?: boolean;
  /**
   * Offers counselling sessions through Talk. Counsellors are one pool across
   * every company: a Toyota employee books a Sowaka counsellor. Profiles and
   * hours are Sowaka's to manage, from the control dashboard later and by
   * script until then.
   */
  isCounsellor?: boolean;
  /**
   * A service account (a support or admin login), not a colleague: left out of
   * the Employees list, the org chart and every colleague list in the app, in
   * the dashboard's attendance and payroll rosters too. Still on Accesses, so
   * its dashboard access can be managed.
   */
  hiddenFromDirectory?: boolean;
  counsellor?: CounsellorProfile;
  /**
   * Help: the four answers given on the first open, and the counsellor they
   * led to. Read by the person and, later, by Sowaka's counsellor dashboard;
   * never by the company's HR dashboard or any report.
   */
  helpIntake?: HelpIntake;
  helpMatch?: HelpMatch;
  /** The face enrolled for Face ID; absent until they set it up, or after HR resets it. */
  faceId?: UserFaceId;
  createdAt?: number;
  updatedAt?: Date;
  lastLoginAt?: Date;
}

/** One stretch of a counsellor's day they take bookings in. */
export interface CounsellorHours {
  /** JS weekday, 0 = Sunday .. 6 = Saturday. */
  weekday: number;
  /** 'HH:mm' in the counsellor's timezone. */
  start: string;
  end: string;
}

export interface CounsellorProfile {
  /** Their login in Sowaka's Zoom account; meetings are created as this user. */
  zoomUserId: string;
  workingHours: CounsellorHours[];
  slotMinutes: number;
  /** IANA name, e.g. Asia/Kolkata. */
  timezone: string;
  /** A line under their name on the picker. */
  headline?: string;
  /** A paragraph on their approach, on the profile. */
  about?: string;
  yearsExperience?: number;
  /** Languages they hold sessions in, as the intake names them. */
  languages?: string[];
  /** Topic ids from the intake they have experience with. */
  focusAreas?: string[];
  /** Difficulty ids from the intake they support people with. */
  supports?: string[];
  /** Goal ids from the intake their approach suits. */
  goals?: string[];
  ageRange?: CounsellorAgeRange;
  gender?: CounsellorGender;
}

export type CounsellorAgeRange = 'young' | 'mid' | 'older';
export type CounsellorGender = 'woman' | 'man' | 'nonbinary';

/** What someone answered on the first open of Help. Skipped is empty. */
export interface HelpIntake {
  topics: string[];
  needs: string[];
  goal: string;
  languages: string[];
  ageRange: string;
  gender: string;
  answeredAt: Date;
}

export interface HelpMatch {
  counsellorUserId: string;
  reasons: string[];
  /** Preferences this counsellor does not meet; empty on a true match. */
  unmet: string[];
  /** How it was set: from the answers, accepted as the closest, or by Sowaka. */
  source: 'intake' | 'fallback' | 'dashboard';
  setAt: Date;
}
