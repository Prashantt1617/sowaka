import { ObjectId } from 'mongodb';

/**
 * The KPI module: HR authors the parameters an employee is scored on, groups
 * them into templates, and assigns a set to each employee for one review cycle.
 *
 * Parameters were previously a hardcoded list of four shared by everyone. They
 * are now org data, which changes two things that matter elsewhere:
 *
 * - The copy shown under each parameter on the feedback form (its subtitle and
 *   the longer guidance behind the info toggle) used to live in the app as
 *   static presentation text keyed on the parameter's name. It is record data
 *   now and travels with the parameter.
 * - A sent review must keep reading the way it read when it was sent, so
 *   `FeedbackRecord` snapshots the copy rather than referencing it. Parameters
 *   are archived instead of deleted for the same reason.
 */

export interface KpiParameter {
  _id?: ObjectId;
  org: string;
  /** Shown as the parameter's heading, e.g. "Performance". */
  title: string;
  /** One line under the heading, e.g. "Delivers quality work consistently". */
  subtitle: string;
  /** Longer guidance revealed by the info toggle on the parameter card. */
  description: string;
  /**
   * Archived parameters disappear from pickers but stay resolvable, because
   * templates, assignments and sent reviews still reference them.
   */
  archived: boolean;
  /** HR user who authored it. Absent on parameters created before this was
   *  recorded, which read as an unknown author rather than a wrong one. */
  createdByUserId?: string;
  /**
   * Wording edited mid-cycle, held until the cycle it takes effect in.
   *
   * Managers are scoring against the live wording right now, so changing it
   * underneath them would mean two managers in the same cycle judged against
   * different text. The edit is staged instead and promoted into the fields
   * above once `effectiveFrom` opens.
   */
  pendingEdit?: {
    subtitle: string;
    description: string;
    /** Cycle key this wording becomes live in. */
    effectiveFrom: string;
    editedByUserId?: string;
    editedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface KpiTemplate {
  _id?: ObjectId;
  org: string;
  /** HR-facing name, e.g. "Engineering IC". */
  name: string;
  description: string;
  /** Ordered: the feedback form renders parameters in this order. */
  parameterIds: string[];
  /**
   * Percentage weight per parameter id, as whole numbers summing to 100.
   *
   * Sales might weigh Communication at 40 while Engineering weighs it at 15.
   * The overall score is the weighted mean of the parameter scores, so it stays
   * on the same 0-5 scale as each parameter. Absent on templates created before
   * weighting existed, which are read as an even split.
   */
  weights?: Record<string, number>;
  /**
   * Who this template is offered for. Each populated facet narrows the match
   * and they combine as an intersection, so a template with designations
   * ["Backend Engineer"] and locations ["Gurugram"] targets Gurugram backend
   * engineers, not everyone who is either. An empty facet places no constraint.
   *
   * This only decides who HR is *offered* in bulk assignment; it never resolves
   * at feedback time, since every employee's set is materialised onto their own
   * assignment.
   */
  locations: string[];
  designations: string[];
  departments: string[];
  /** Reports-to, matched against `User.managerUserId`. */
  managerUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One employee's parameters for one cycle. Materialised rather than resolved
 * through the template on every read: HR can add or remove parameters for a
 * single person after assigning, and an assignment must not shift underneath a
 * manager because a template was edited mid-cycle.
 *
 * `templateId` is provenance only — it records what the assignment was created
 * from so the UI can show "Engineering IC (modified)". Editing that template
 * later does not change this record.
 */
export interface KpiAssignment {
  _id?: ObjectId;
  org: string;
  userId: string;
  /** Review cycle, `YYYY-MM`. Assignments do not carry over between cycles. */
  period: string;
  /** Ordered, and the order the manager sees. */
  parameterIds: string[];
  /**
   * Percentage weight per parameter id, whole numbers summing to 100.
   *
   * Copied from the template at assign time and then editable for this one
   * person — adding a parameter for someone means re-weighting so the set still
   * sums to 100, which is what keeps their overall score on the 0-5 scale.
   */
  weights?: Record<string, number>;
  templateId?: string;
  assignedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
