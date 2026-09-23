export interface OtpChallenge {
  email: string;
  otpHash: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

export interface AuthSessionDocument {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Shape returned to clients (mobile app) on successful auth. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'manager' | 'employee';
  dashboardAccess?: boolean;
  isLeadership?: boolean;
  company: string;
  /** The company's id, which is what branding is chosen by. */
  org?: string;
  profilePhotoUrl?: string;
  /** What they said they are into, from onboarding. Captured, not yet used. */
  interests?: string[];
  location?: string;
  state?: string;
  designation?: string;
  employmentType?: string;
  department?: string;
  teamDescription?: string;
  managerName?: string;
  joiningDate?: string;
  birthday?: string;
  recognition?: {
    label: string;
    period: string;
  };
}
