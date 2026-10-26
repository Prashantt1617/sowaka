// Basic details: Suwi edits one person's profile fields the way the profile's
// Edit does, through the same save, with the same rule: full name and work
// email are never edited here. The reporting manager has its own card
// (prepare_change_manager), which also moves the requests waiting on them.
// Undo puts every field back as it was.
import { updateEmployeeDetailsForAdmin } from '../../services/admin.service';
import { detailChanges } from '../../services/employee-activity.service';
import type { EmployeeDetailsInput } from '../../services/admin.service';
import { defineExecutor, propose } from '../proposals';
import { defineTools, str } from '../tools';
import { findPerson, isoDay, type Person } from './people';

const LOCKED = 'Full name and work email can\'t be edited, on the profile or through Suwi.';
const TYPES = ['full_time', 'contract', 'intern'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The fields HR may change, as the tool takes them → the record's own field name. */
const FIELDS: Record<string, keyof Person> = {
  employeeId: 'employeeId', joiningDate: 'joiningDate', birthday: 'birthday', mobile: 'phone', gender: 'gender',
  designation: 'designation', department: 'department', location: 'location', employeeType: 'employeeType', isDirector: 'isDirector',
};

/** The save's input that puts `p` back as it is now, for the fields in `input`. */
function restoreInput(p: Person, input: EmployeeDetailsInput): EmployeeDetailsInput {
  const back: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const v = p[FIELDS[key]];
    if (key === 'joiningDate' || key === 'birthday') {
      const d = isoDay(v);
      // A joining date can't be cleared, so one added where there was none stays.
      if (d || key === 'birthday') back[key] = d ?? '';
    } else if (key === 'isDirector') back[key] = v === true;
    else if (key === 'employeeType') { if (v) back[key] = v; }
    else back[key] = v ?? '';
  }
  return back as EmployeeDetailsInput;
}

defineTools({
  name: 'prepare_edit_details',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: update ${i.person}'s basic details`,
  description: `Prepare changing one person's basic details: employee ID, joining date, date of birth, mobile, gender, designation, department, work location, employee type or the director flag. Pass only the fields to change; an empty string clears an optional field. Changes nothing: it creates a card listing each field's current and new value for HR to confirm, and Undo restores them. ${LOCKED} For the reporting manager use prepare_change_manager instead. For many people at once, or renaming a designation or department everywhere, use prepare_rename_titles.`,
  input_schema: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Name, employee ID or userId' },
      employeeId: { type: 'string' },
      joiningDate: { type: 'string', description: 'YYYY-MM-DD' },
      birthday: { type: 'string', description: 'Date of birth, YYYY-MM-DD' },
      mobile: { type: 'string' },
      gender: { type: 'string' },
      designation: { type: 'string' },
      department: { type: 'string' },
      location: { type: 'string', description: 'Work location' },
      employeeType: { type: 'string', enum: [...TYPES] },
      isDirector: { type: 'boolean', description: 'Director or holds a substantial interest' },
    },
    required: ['person'],
  },
  api: { method: 'PATCH', path: '/admin/employees/x' },
  async run(ctx, i) {
    if (['name', 'fullName', 'email', 'workEmail'].some((k) => i[k] !== undefined)) throw new Error(LOCKED);
    if (i.manager !== undefined || i.reportingManager !== undefined) throw new Error('Change the reporting manager with prepare_change_manager.');
    if (ctx.user.canEditEmployeeDetails !== true) throw new Error('You cannot edit employee details. Ask a dashboard admin for that right in People › Accesses.');
    const person = await findPerson(ctx, i.person);
    const input: Record<string, unknown> = {};
    for (const key of Object.keys(FIELDS)) {
      if (i[key] === undefined || i[key] === null) continue;
      if (key === 'isDirector') { input[key] = i[key] === true || i[key] === 'true'; continue; }
      const v = str(i[key], 120);
      if ((key === 'joiningDate' || key === 'birthday') && v && !DAY.test(v)) throw new Error(`Give ${key === 'birthday' ? 'the date of birth' : 'the joining date'} as YYYY-MM-DD`);
      if (key === 'joiningDate' && !v) throw new Error('A joining date can\'t be cleared');
      if (key === 'employeeType' && !TYPES.includes(v as typeof TYPES[number])) throw new Error('Employee type is full_time, contract or intern');
      input[key] = v;
    }
    // What the record would hold, in its own field names, to compare with now.
    const set: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(input)) {
      set[FIELDS[key]] = (key === 'joiningDate' || key === 'birthday') && v ? new Date(`${v}T00:00:00.000Z`) : v;
    }
    const changes = detailChanges(person, set);
    if (!changes.length) return { data: { nothingToDo: true, message: `${person.name}'s details already say that.` } };
    const changed = new Set(changes.map((c) => c.field));
    const save = Object.fromEntries(Object.entries(input).filter(([key]) => changed.has(FIELDS[key]))) as EmployeeDetailsInput;
    const title = `Update ${person.name}'s basic details`;
    const proposalId = await propose(ctx, {
      kind: 'edit_details', area: 'people', title,
      summary: `${changes.length === 1 ? 'One field changes' : `${changes.length} fields change`} on ${person.name}'s profile, from the moment you confirm.`,
      lines: [
        ...changes.map((c) => ({ text: `${c.label}: ${c.from || 'empty'} → ${c.to || 'empty'}.` })),
        { text: 'Saved through the same Basic details save as the profile, and listed on their Activity tab.', why: 'One save path keeps the same checks, such as a unique employee ID, whichever way the change is made.' },
      ],
      effectiveFrom: ctx.today, undoable: true,
      payload: { userId: person.userId, personName: person.name, input: save, undoInput: restoreInput(person, save), byUserId: ctx.userId },
    });
    return {
      data: { prepared: true, title, changes, note: 'Nothing is saved until HR presses Confirm on the card.' },
      proposalId,
      links: [{ label: `Open ${person.name.split(' ')[0]}'s profile`, userId: person.userId, tab: 'profile' }],
    };
  },
});

defineExecutor('edit_details', {
  async run(p) {
    const { userId, personName, input, byUserId } = p.payload as { userId: string; personName: string; input: EmployeeDetailsInput; byUserId: string };
    await updateEmployeeDetailsForAdmin(byUserId, userId, input);
    return { message: `Basic details updated for ${personName}.` };
  },
  async undo(p) {
    const { userId, personName, undoInput, byUserId } = p.payload as { userId: string; personName: string; undoInput: EmployeeDetailsInput; byUserId: string };
    await updateEmployeeDetailsForAdmin(byUserId, userId, undoInput);
    return `${personName}'s basic details are back as they were.`;
  },
});
