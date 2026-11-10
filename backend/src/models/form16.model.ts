/**
 * A Form 16 HR filed for one employee and one FY (`form16_documents`).
 *
 * Sowaka does not generate Form 16: HR downloads Part A from TRACES and
 * Part B from their payroll or tax tool and uploads the PDFs on the
 * dashboard, one file per person or a batch named by PAN or employee ID. The
 * app's Downloads › Form 16 lists them and opens them through a short-lived
 * link.
 *
 * A person has either one combined file for a FY or a Part A and a Part B:
 * a combined upload replaces both parts, a part replaces the combined file.
 */
export type Form16Part = 'A' | 'B' | 'combined';

export const FORM16_PARTS: readonly Form16Part[] = ['A', 'B', 'combined'];

export interface Form16Document {
  org: string;
  userId: string;
  /** "2025-26". */
  fy: string;
  part: Form16Part;
  /** Where the PDF is in the bucket: `…/form16/<org>/<userId>/<random>.pdf`. */
  objectKey: string;
  /** The name HR's file had, shown back to HR and used for the download. */
  fileName: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
}
