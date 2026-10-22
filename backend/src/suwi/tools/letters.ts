// Letters: an offer, confirmation, experience or salary-revision letter
// drafted from the person's record on a plain company template, returned as
// markdown for HR to copy. Nothing is saved or sent. Salary figures only with
// payroll access; anything the record lacks is left as a [blank].
import { companies, salaryStructures } from '../../config/db';
import { LETTER_LABEL, LETTER_TYPES, LETTERS, LetterFacts, LetterType } from '../content/letters';
import { defineTools, num, rupees, str } from '../tools';
import { findPerson, isoDay, roster } from './people';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** YYYY-MM-DD as DD Mon YYYY; anything else as given. */
export const longDate = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const TYPE_LABEL: Record<string, string> = { full_time: 'full-time', contract: 'contract', intern: 'intern' };

defineTools({
  name: 'draft_letter',
  area: 'people',
  label: (i) => `${LETTER_LABEL[str(i.type) as LetterType] ?? 'Letter'} for ${str(i.person) || 'a person'}`,
  description: "Draft a letter for an employee from their record (name, designation, department, joining date, manager, location) on a plain company template: offer, confirmation, experience or salary_revision. Returns markdown for HR to copy; nothing is saved or sent. Salary figures appear only with payroll access. For a salary revision give newAnnualCtc in rupees and effectiveFrom; for an experience letter give lastWorkingDay; for a confirmation give effectiveFrom. Fields the record lacks come back as [blanks] to fill in.",
  input_schema: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Name, employee ID or userId' },
      type: { type: 'string', enum: LETTER_TYPES },
      effectiveFrom: { type: 'string', description: 'YYYY-MM-DD (confirmation or revision date)' },
      lastWorkingDay: { type: 'string', description: 'YYYY-MM-DD (experience letter)' },
      newAnnualCtc: { type: 'number', description: 'Rupees a year (salary revision)' },
    },
    required: ['person', 'type'],
  },
  api: { method: 'GET', path: '/admin/employees' },
  async run(ctx, i) {
    const type = str(i.type) as LetterType;
    if (!LETTER_TYPES.includes(type)) throw new Error(`Letter type must be one of ${LETTER_TYPES.join(', ')}`);
    const all = await roster(ctx);
    const p = await findPerson(ctx, i.person, all);
    const manager = all.find((x) => x.userId === p.managerUserId);
    const company = await companies().findOne({ id: ctx.org }, { projection: { _id: 0, name: 1, profile: 1, address: 1 } });
    const prof = company?.profile;
    const address = prof ? [prof.addressLine1, prof.addressLine2, [prof.city, prof.state, prof.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : company?.address;
    let annualCtc: string | undefined;
    if (ctx.payroll) {
      const s = await salaryStructures().findOne({ org: ctx.org, userId: p.userId }, { projection: { _id: 0, annualCtcPaise: 1 } });
      if (s?.annualCtcPaise) annualCtc = rupees(s.annualCtcPaise);
    }
    const newCtc = num(i.newAnnualCtc, 0, 0);
    if (type === 'salary_revision' && !ctx.payroll) throw new Error('A salary revision letter needs payroll access');
    const facts: LetterFacts = {
      company: prof?.displayName || prof?.registeredName || company?.name || 'the company', companyAddress: address || undefined,
      today: longDate(ctx.today)!, name: p.name, designation: p.designation || undefined, department: p.department || undefined,
      joiningDate: longDate(isoDay(p.joiningDate)), manager: manager?.name, managerDesignation: manager?.designation || undefined,
      location: p.location || p.branch || undefined, employeeType: TYPE_LABEL[p.employeeType ?? ''],
      annualCtc, newAnnualCtc: newCtc ? rupees(newCtc * 100) : undefined,
      effectiveFrom: longDate(str(i.effectiveFrom)) || undefined, lastWorkingDay: longDate(str(i.lastWorkingDay)) || undefined,
      signatory: ctx.user.name, signatoryDesignation: ctx.user.designation || undefined,
    };
    const { markdown, blanks } = LETTERS[type](facts);
    return {
      data: {
        type, label: LETTER_LABEL[type], person: { userId: p.userId, name: p.name }, markdown,
        fillIn: blanks, ...(blanks.length ? { note: `Left blank (not on the record or not given): ${blanks.join(', ')}. Fill these in before sending.` } : {}),
        ...(!ctx.payroll && type === 'offer' ? { salaryNote: 'No salary figure: it needs payroll access.' } : {}),
        howToUse: 'Show the whole letter as markdown for HR to copy. Nothing has been saved or sent.',
      },
      links: [{ label: `Open ${p.name.split(' ')[0]}'s profile`, userId: p.userId }],
    };
  },
});
