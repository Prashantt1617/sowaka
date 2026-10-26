/**
 * Placements, for a company that is an HR placement agency: its clients (the
 * companies hiring), its customers (the candidates it places) and each
 * placement of a candidate in a position at a client. Only a company with
 * `features.placements` has them; see docs/placements-api.md for the API.
 */

export type PlacementStatus = 'shortlisted' | 'interviewing' | 'offered' | 'joined' | 'dropped';

/** In the order a placement moves through them, which is how lists and counts show them. */
export const PLACEMENT_STATUSES: readonly PlacementStatus[] = ['shortlisted', 'interviewing', 'offered', 'joined', 'dropped'];

/** One open role at a client, with what it pays. */
export interface PlacementDesignation {
  id: string;
  title: string;
  budgetRupees: number | null;
  budgetPeriod: 'month' | 'year';
  description: string;
}

/** What a client is charged once, when the agency takes it on, unless set otherwise. */
export const DEFAULT_ONBOARDING_FEE_RUPEES = 2500;

/** A company hiring. Collection `placement_clients`. */
export interface PlacementClient {
  id: string;
  org: string;
  name: string;
  /** The optional text fields are '' when not given. */
  contactName: string;
  phone: string;
  email: string;
  industry: string;
  /** Where the company is: a city or a full address. */
  city: string;
  notes: string;
  /** The roles open there. Absent on clients added before roles existed. */
  designations?: PlacementDesignation[];
  /** The one-time onboarding fee: how much, whether it was received, and its UPI reference. */
  feeRupees?: number | null;
  feePaid?: boolean;
  feePaidAt?: Date | null;
  feeReference?: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A candidate being placed. Collection `placement_customers`. */
export interface PlacementCustomer {
  id: string;
  org: string;
  name: string;
  phone: string;
  email: string;
  currentRole: string;
  experienceYears: number | null;
  skills: string[];
  city: string;
  /** Their full address. Absent on candidates added before it was asked. */
  address?: string;
  /** The introduction: skills, strengths and what they are looking for. */
  notes: string;
  /**
   * Taken off the agency's lists by the person who added them, with why. HR
   * sees them on the dashboard and can restore them. Absent or null: listed.
   */
  removedAt?: Date | null;
  removedReason?: string;
  removedByUserId?: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One status a placement had, and who set it. */
export interface PlacementStatusChange {
  status: PlacementStatus;
  at: Date;
  byUserId: string;
}

/** One candidate put forward for one position at one client. Collection `placements`. */
export interface Placement {
  id: string;
  org: string;
  customerId: string;
  clientId: string;
  position: string;
  status: PlacementStatus;
  /** Calendar days, 'YYYY-MM-DD'. */
  interviewDate: string | null;
  joiningDate: string | null;
  ctcRupees: number | null;
  feeRupees: number | null;
  notes: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  /** Every status it has had, oldest first, starting with the one it was created with. */
  history: PlacementStatusChange[];
}
