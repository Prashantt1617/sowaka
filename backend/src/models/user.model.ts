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

export interface EmployeeDocument {
  name: string;
  url: string;
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
  role?: 'manager' | 'employee';
  // Leadership have no manager and do not raise approval-gated requests.
  isLeadership?: boolean;
  // Grants access to the HR dashboard (org-wide view + request overrides).
  // Independent of the reporting role — a manager/employee may or may not have it.
  dashboardAccess?: boolean;
  createdAt?: number;
  updatedAt?: Date;
  lastLoginAt?: Date;
}
