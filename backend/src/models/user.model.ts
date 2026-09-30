export type EmployeeType = 'intern' | 'full_time' | 'contract';

export type UserLifecycleStatus =
  | 'active'
  | 'onboarding'
  | 'on_leave'
  | 'notice'
  | 'offboarded'
  | 'terminated';

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';

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
  // Grants access to the HR dashboard (org-wide view + request overrides).
  // Independent of the reporting role — a manager/employee may or may not have it.
  dashboardAccess?: boolean;
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
  counsellor?: CounsellorProfile;
  /**
   * Help: the four answers given on the first open, and the counsellor they
   * led to. Read by the person and, later, by Sowaka's counsellor dashboard;
   * never by the company's HR dashboard or any report.
   */
  helpIntake?: HelpIntake;
  helpMatch?: HelpMatch;
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
