import { ObjectId } from 'mongodb';

/**
 * A kind of expense an employee may claim, configured per org.
 *
 * These replace the four categories that used to be hardcoded in the claim
 * model. Each carries its own cap, which is enforced when a claim is created —
 * both in the app before submitting and on the server, since the app's copy of
 * the list can be stale.
 */
export interface ReimbursementType {
  _id?: ObjectId;
  org: string;
  name: string;
  description?: string;
  /**
   * The most one claim of this type may be for, in rupees. Zero means no cap —
   * a limit of nothing is not a limit, and storing it as 0 keeps the field
   * present rather than making every consumer handle undefined.
   */
  maxLimit: number;
  /**
   * How far back a claim of this type may be dated, in days. Zero means today
   * only — unlike the cap, "no limit" is not a sensible default for a window
   * that exists to stop stale expenses arriving months later.
   */
  backdateDays: number;
  active: boolean;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}
