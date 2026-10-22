/**
 * Plain company letter templates Suwi drafts from an employee's record, as
 * markdown for HR to copy into their letterhead. Anything the record doesn't
 * hold stays as a [bracketed] blank so nothing is invented. Salary figures
 * appear only when the drafter has payroll access and the figure is known.
 */
export type LetterType = 'offer' | 'confirmation' | 'experience' | 'salary_revision';
export const LETTER_TYPES: LetterType[] = ['offer', 'confirmation', 'experience', 'salary_revision'];
export const LETTER_LABEL: Record<LetterType, string> = { offer: 'Offer letter', confirmation: 'Confirmation letter', experience: 'Experience letter', salary_revision: 'Salary revision letter' };

export interface LetterFacts {
  company: string;
  companyAddress?: string;
  /** DD Mon YYYY */
  today: string;
  name: string;
  designation?: string;
  department?: string;
  joiningDate?: string;
  manager?: string;
  managerDesignation?: string;
  location?: string;
  employeeType?: string;
  /** Rupees a year, already formatted (₹6,00,000); only with payroll access. */
  annualCtc?: string;
  newAnnualCtc?: string;
  effectiveFrom?: string;
  lastWorkingDay?: string;
  /** Who signs: the HR person drafting it. */
  signatory: string;
  signatoryDesignation?: string;
}

/** A value or a blank to fill, and a note of what was blank. */
function fill(f: LetterFacts) {
  const blanks: string[] = [];
  const v = (value: string | undefined, label: string) => { if (value) return value; blanks.push(label); return `[${label}]`; };
  return { v, blanks };
}

const sign = (f: LetterFacts) => `\n\nWith regards,\n\n\n**${f.signatory}**${f.signatoryDesignation ? `  \n${f.signatoryDesignation}` : ''}  \n${f.company}`;
const head = (f: LetterFacts, title: string) => `**${f.company}**${f.companyAddress ? `  \n${f.companyAddress}` : ''}\n\n${f.today}\n\n**${f.name}**\n\n### ${title}\n\nDear ${f.name.split(' ')[0]},\n\n`;

export const LETTERS: Record<LetterType, (f: LetterFacts) => { markdown: string; blanks: string[] }> = {
  offer(f) {
    const { v, blanks } = fill(f);
    const md = head(f, 'Offer of employment')
      + `We are pleased to offer you the position of **${v(f.designation, 'designation')}** in the ${v(f.department, 'department')} team at ${f.company}, based in ${v(f.location, 'work location')}. You will report to ${v(f.manager, 'reporting manager')}${f.managerDesignation ? ` (${f.managerDesignation})` : ''}.\n\n`
      + `Your employment will begin on **${v(f.joiningDate, 'joining date')}**${f.employeeType ? ` as a ${f.employeeType} employee` : ''}.`
      + (f.annualCtc ? ` Your annual cost to company will be **${f.annualCtc}**; the break-up is set out in the annexure.` : ' Your compensation is set out in the annexure.')
      + `\n\nThis offer is subject to the verification of your documents and the terms of the employment agreement, which will be shared on joining. Please sign and return a copy of this letter by [acceptance date] to confirm your acceptance.\n\nWe look forward to working with you.`
      + sign(f)
      + `\n\n---\n\nAccepted by: ______________________  Date: ____________`;
    return { markdown: md, blanks };
  },
  confirmation(f) {
    const { v, blanks } = fill(f);
    const md = head(f, 'Confirmation of employment')
      + `We are pleased to confirm your employment with ${f.company} as **${v(f.designation, 'designation')}** in the ${v(f.department, 'department')} team, with effect from **${v(f.effectiveFrom, 'confirmation date')}**.\n\n`
      + `You joined us on ${v(f.joiningDate, 'joining date')} and have completed your probation satisfactorily. All other terms of your employment remain as set out in your appointment letter.\n\n`
      + `We thank you for your contribution so far and wish you continued success with us.`
      + sign(f);
    return { markdown: md, blanks };
  },
  experience(f) {
    const { v, blanks } = fill(f);
    const md = `**${f.company}**${f.companyAddress ? `  \n${f.companyAddress}` : ''}\n\n${f.today}\n\n### To whom it may concern\n\n`
      + `This is to certify that **${f.name}** was employed with ${f.company} from **${v(f.joiningDate, 'joining date')}** to **${v(f.lastWorkingDay, 'last working day')}**, most recently as **${v(f.designation, 'designation')}** in the ${v(f.department, 'department')} team${f.location ? `, ${f.location}` : ''}.\n\n`
      + `During this period, ${f.name.split(' ')[0]}'s conduct and performance were found to be satisfactory. We wish ${f.name.split(' ')[0]} every success in future endeavours.\n\n`
      + `This letter is issued at the employee's request and carries no liability on the company.`
      + sign(f);
    return { markdown: md, blanks };
  },
  salary_revision(f) {
    const { v, blanks } = fill(f);
    const md = head(f, 'Revision of compensation')
      + `We are pleased to inform you that, in recognition of your contribution as **${v(f.designation, 'designation')}**, your compensation has been revised with effect from **${v(f.effectiveFrom, 'effective date')}**.\n\n`
      + `| | Annual cost to company |\n|---|---|\n| Current | ${v(f.annualCtc, 'current annual CTC')} |\n| Revised | ${v(f.newAnnualCtc, 'revised annual CTC')} |\n\n`
      + `The revised break-up will appear in your salary details and from the payslip for the month in which the revision takes effect. All other terms of your employment remain unchanged.\n\n`
      + `We thank you for your work and look forward to your continued contribution.`
      + sign(f);
    return { markdown: md, blanks };
  },
};
