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
  createdAt?: number;
  updatedAt?: Date;
  lastLoginAt?: Date;
}
