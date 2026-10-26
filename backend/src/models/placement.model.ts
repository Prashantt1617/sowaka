/**
 * Placements, for a company that is an HR placement agency: its clients (the
 * companies hiring), its customers (the candidates it places) and each
 * placement of a candidate in a position at a client. Only a company with
 * `features.placements` has them; see docs/placements-api.md for the API.
 */

export type PlacementStatus = 'shortlisted' | 'interviewing' | 'offered' | 'joined' | 'dropped';

/** In the order a placement moves through them, which is how lists and counts show them. */
export const PLACEMENT_STATUSES: readonly PlacementStatus[] = ['shortlisted', 'interviewing', 'offered', 'joined', 'dropped'];

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
  city: string;
  notes: string;
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
  notes: string;
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
