// What the Suwi panel shows when Bulk assign opens: who it is for, how to type
// a request, examples that fit the section it was opened from, and how people
// are picked. The examples fill the field; HR edits and sends them.
import type { SuwiBulkArea } from '../store';

export interface BulkGuide {
  intro: string;
  whoFor: string;
  examples: string[];
  picking: string;
  cannot: string;
}

const PICKING = 'by department, location, designation, reporting manager, a list of names or employee IDs, or an attached Excel with an Employee ID column.';
const CANNOT = "Suwi can't change full name or work email.";

export const BULK_GUIDES: Record<SuwiBulkArea, BulkGuide> = {
  any: {
    intro: "Bulk assign. Tell me what to assign and who should get it. I'll show a preview before anything changes.",
    whoFor: 'HR admins assigning the same thing to many employees at once: a shift, an attendance source, a reporting manager, a leave policy or a department.',
    examples: [
      'Assign General Shift to everyone in Sales',
      'Set attendance source to Biometric for all employees in the Gurugram office',
      'Change reporting manager to Rohan Mehta for the employees in the attached sheet',
    ],
    picking: PICKING,
    cannot: CANNOT,
  },
  shifts: {
    intro: "Bulk assign for shifts. Tell me which shift or attendance source, and who gets it. I'll show a preview before anything changes; a shift change starts tomorrow.",
    whoFor: 'HR admins putting many employees on a shift template at once. The attendance source and leave policy come with the template.',
    examples: [
      'Assign General Shift to everyone in Sales',
      'Set attendance source to Biometric for all employees in the Gurugram office',
      'Move the employees in the attached sheet to the Night shift',
    ],
    picking: PICKING,
    cannot: CANNOT,
  },
  performance: {
    intro: "Bulk assign for performance. Tell me which KPI template and who gets it. I'll show a preview before anything changes; it applies from the next review cycle.",
    whoFor: 'HR admins putting many employees on the same KPI template, or moving them under one reporting manager for reviews.',
    examples: [
      'Assign the Sales KPI template to everyone in Sales',
      "Give the Engineering KPI template to Kabir Shah's reports",
      'Assign the Support KPI template to the employees in the attached sheet',
    ],
    picking: PICKING,
    cannot: CANNOT,
  },
  payroll: {
    intro: "Bulk assign for payroll. Tell me which paid days template and who gets it. I'll show a preview before anything changes; payroll reads it from the next run.",
    whoFor: 'HR admins putting many employees on the same paid days template. Only people with a salary assigned can have one; the rest are listed as skipped.',
    examples: [
      'Put everyone in Operations on the Field Staff paid days template',
      'Give the Interns paid days template to the employees in the attached sheet',
      'Move everyone in the Noida office to the Default paid days template',
    ],
    picking: PICKING,
    cannot: CANNOT,
  },
};
