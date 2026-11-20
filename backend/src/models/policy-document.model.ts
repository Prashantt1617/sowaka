/**
 * One of a company's policies as the app shows it under Actions › View
 * Policies, kept in the database so its words change without an app release
 * or a deploy.
 *
 * The text is `body`: plain text with a little formatting the app draws for
 * itself. Paragraphs are separated by a blank line, a line starting "- " is a
 * bullet, and a line starting "## " is a section heading. Nothing else is
 * read as formatting, and no HTML: whatever is written is shown as written.
 *
 * Written by Sowaka with `src/scripts/policies.ts`, from the text files kept
 * under `backend/policies/`, not from any company's dashboard. A company with
 * no documents keeps the policies the app writes for itself from its shift
 * rules, so nothing changes for a company until it is given its own.
 */
export interface PolicyDocument {
  /** The company it belongs to: `Company.id`. */
  org: string;
  /**
   * Stable id within the company, lowercase with dashes: 'leave',
   * 'attendance', 'overtime', 'claims', or any other. The app opens the
   * 'leave' one from the Leave screen's "leave policy" link.
   */
  key: string;
  /** Its name in the list and on its page: 'Leave'. */
  title: string;
  /** One line under the name, when there is one. */
  summary?: string;
  /** The policy itself; see the formatting above. */
  body: string;
  /** Shown in ascending order. */
  order: number;
  /** False hides it from the app without deleting it. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Who last wrote it, as the script was told or the machine's user. */
  updatedBy?: string;
  /**
   * The text's version: 1 when written, one more each time `body` changes
   * (a rename or a reorder is not a new version). An acknowledgement is of a
   * version, so a changed text comes back to everyone as "Updated". Missing
   * on documents written before acknowledgements: read as 1.
   */
  version?: number;
  /** When `body` last changed (`updatedAt` also moves on a reorder). Missing: `updatedAt`. */
  textUpdatedAt?: Date;
  /** False: the app shows it to read only, with no Acknowledge. Missing: true. */
  ackRequired?: boolean;
  /** What changed in this version, in a line or two, shown above the text with "Updated". */
  changeNote?: string;
}

/**
 * One person's acknowledgement of one policy, at the version they read
 * (`policy_acknowledgements`, unique on org + userId + key). A newer version
 * of the policy makes it stale: the app shows that policy as Updated.
 */
export interface PolicyAcknowledgement {
  org: string;
  userId: string;
  key: string;
  version: number;
  at: Date;
  /** The app's user agent, for HR's record. */
  device?: string;
}

export const POLICY_CHANGE_NOTE_MAX = 400;

export const POLICY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Generous for a policy; a page of this is already a long read on a phone. */
export const POLICY_BODY_MAX_BYTES = 64 * 1024;
export const POLICY_TITLE_MAX = 80;
export const POLICY_SUMMARY_MAX = 200;
