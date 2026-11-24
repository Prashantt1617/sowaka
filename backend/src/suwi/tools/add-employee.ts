// Adding one employee from a question (People › Employees › Add user, then "Confirm new user"). The card
// lists every field it will set and what is still missing afterwards (shift, salary, bank details...), and
// Confirm runs the same service the dashboard's Add user form posts to (createEmployeeForAdmin), as the HR
// person. A work email is required by that service, so without one nothing is prepared and Suwi asks for it.
// No Undo: removing a new person is a delete (with its onboarding journey), done from their profile.
import { users } from '../../config/db';
import { accountLimitForAdmin, createEmployeeForAdmin, type CreateEmployeeInput } from '../../services/admin.service';
import { getCompanySettings } from '../../services/company-settings.service';
import { defaultTemplateFor } from '../../services/shift.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { findPerson, norm, roster } from './people';
import { isDate, niceDate } from './team';

const TYPES: Record<string, 'full_time' | 'contract' | 'intern'> = { full_time: 'full_time', 'full time': 'full_time', fulltime: 'full_time', permanent: 'full_time', contract: 'contract', contractor: 'contract', consultant: 'contract', intern: 'intern', internship: 'intern' };
const TYPE_LABEL = { full_time: 'Full-time', contract: 'Contract', intern: 'Intern' } as const;
const EMAIL = /^\S+@\S+\.\S+$/;

/** The company's own spelling of a department or designation, when it has one ("exterior" → "Exterior"). */
const spelled = (v: string, list: string[]) => list.find((x) => norm(x) === norm(v)) ?? null;

defineTools({
  name: 'prepare_add_employee',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: add ${str(i.name) || 'a new employee'}`,
  description: 'Prepare adding ONE new employee (People › Employees › Add user), e.g. "Add Ira Kapoor as a 3D Visualiser in Exterior from 1 Dec, reporting to Dev". Inputs: name (required), email = their WORK email (required by the form: never invent or guess one; if HR did not give it, call without it and ask HR for it), joiningDate YYYY-MM-DD, designation, department, manager (name, employee ID or userId of the reporting manager), location, branch, employeeType (full_time, contract, intern), employeeId, mobile, gender, birthday YYYY-MM-DD, personalEmail. Changes nothing: the card lists every field it sets and what is still missing (shift template, salary, bank details, KPI template...). For many joiners from a spreadsheet use prepare_people_import instead.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' }, email: { type: 'string', description: 'Work email (required; ask HR, never guess)' },
      joiningDate: { type: 'string', description: 'YYYY-MM-DD; today when left out' }, designation: { type: 'string' }, department: { type: 'string' },
      manager: { type: 'string', description: 'Reporting manager: name, employee ID or userId' }, location: { type: 'string' }, branch: { type: 'string' },
      employeeType: { type: 'string', enum: ['full_time', 'contract', 'intern'] }, employeeId: { type: 'string' }, mobile: { type: 'string' },
      gender: { type: 'string' }, birthday: { type: 'string', description: 'YYYY-MM-DD' }, personalEmail: { type: 'string' },
    },
    required: ['name'],
  },
  api: { method: 'POST', path: '/admin/employees' },
  async run(ctx, i) {
    const name = str(i.name, 120).replace(/\s+/g, ' ');
    if (!name) throw new Error('Give the new employee\'s full name');
    const email = str(i.email, 254).toLowerCase();
    const personalEmail = str(i.personalEmail, 254).toLowerCase();
    const joiningDate = str(i.joiningDate) || ctx.today;
    if (!isDate(joiningDate)) throw new Error('joiningDate must be YYYY-MM-DD');
    const birthday = str(i.birthday);
    if (birthday && !isDate(birthday)) throw new Error('birthday must be YYYY-MM-DD');
    const type = TYPES[norm(i.employeeType).replace(/ /g, '_')] ?? TYPES[norm(i.employeeType)] ?? 'full_time';
    const problems: string[] = [];
    if (email && !EMAIL.test(email)) problems.push(`"${email}" is not a valid work email`);
    if (personalEmail && !EMAIL.test(personalEmail)) problems.push(`"${personalEmail}" is not a valid personal email`);
    if (email && await users().findOne({ email }, { projection: { _id: 1 } })) problems.push(`Someone already signs in with ${email}`);
    const employeeId = str(i.employeeId, 40);
    if (employeeId && await users().findOne({ org: ctx.org, employeeId }, { projection: { _id: 1 } })) problems.push(`Employee ID ${employeeId} is already in use`);
    const all = await roster(ctx);
    let manager: { userId: string; name: string } | null = null;
    if (str(i.manager)) {
      try { const m = await findPerson(ctx, i.manager, all); manager = { userId: m.userId, name: m.name }; } catch (e) { problems.push((e as Error).message); }
    }
    const limit = await accountLimitForAdmin(ctx.userId);
    if (limit.max !== null && limit.used >= limit.max) problems.push(`Your plan allows up to ${limit.max} accounts and ${limit.used} are in use. Contact Sowaka to add more.`);
    if (problems.length) return { data: { prepared: false, problems, note: 'Nothing was prepared. Tell HR what to fix.' } };

    const settings = await getCompanySettings(ctx.userId);
    const department = str(i.department, 120), designation = str(i.designation, 120);
    const dep = department ? spelled(department, settings.departments) ?? department : '';
    const des = designation ? spelled(designation, settings.designations) ?? designation : '';
    const set: [string, string][] = [
      ['Full name', name], ['Work email', email || '—'], ['Joining date', niceDate(joiningDate)], ['Designation', des || '—'], ['Department', dep || '—'],
      ['Reporting manager', manager?.name ?? '—'], ['Employee type', TYPE_LABEL[type]], ['Employee ID', employeeId || '—'], ['Location', str(i.location, 120) || '—'],
      ...(str(i.branch) ? [['Branch', str(i.branch, 120)] as [string, string]] : []),
      ...(str(i.mobile) ? [['Mobile', str(i.mobile, 20)] as [string, string]] : []), ...(str(i.gender) ? [['Gender', str(i.gender, 20)] as [string, string]] : []),
      ...(birthday ? [['Date of birth', niceDate(birthday)] as [string, string]] : []), ...(personalEmail ? [['Personal email', personalEmail] as [string, string]] : []),
    ];
    if (!email) {
      return { data: { prepared: false, needs: ['work email'], wouldSet: Object.fromEntries(set.filter(([k]) => k !== 'Work email')), note: 'The Add user form needs a work email. Ask HR for it (never make one up), then call again with email.' } };
    }
    const shift = await defaultTemplateFor(ctx.org);
    const missing = [
      ...(!employeeId ? ['employee ID (attendance from a biometric device is matched on it)'] : []),
      ...(!manager ? ['reporting manager (they cannot apply for leave until they have one)'] : []),
      ...(!dep ? ['department'] : []), ...(!des ? ['designation'] : []), ...(!str(i.location) ? ['work location'] : []),
      `shift template (${shift ? `they follow the default, ${shift.name}, until one is assigned` : 'none assigned yet'})`,
      'salary structure and paid days template (Payroll: nothing is paid until a salary is set)', 'bank, PAN and UAN details', 'KPI template',
      ...(!str(i.mobile) ? ['mobile'] : []), ...(!birthday ? ['date of birth'] : []), ...(!str(i.gender) ? ['gender'] : []),
    ];
    const newLists = [dep && !spelled(dep, settings.departments) ? `department "${dep}"` : '', des && !spelled(des, settings.designations) ? `designation "${des}"` : ''].filter(Boolean);
    const input: CreateEmployeeInput = {
      name, email, joiningDate, employeeType: type,
      ...(dep ? { department: dep } : {}), ...(des ? { designation: des } : {}), ...(manager ? { managerUserId: manager.userId } : {}),
      ...(employeeId ? { employeeId } : {}), ...(str(i.location) ? { location: str(i.location, 120) } : {}), ...(str(i.branch) ? { branch: str(i.branch, 120) } : {}),
      ...(str(i.mobile) ? { mobile: str(i.mobile, 20) } : {}), ...(str(i.gender) ? { gender: str(i.gender, 20) } : {}), ...(birthday ? { birthday } : {}),
      ...(personalEmail ? { personalEmail } : {}),
    };
    const title = `Add ${name}${des ? ` as ${des}` : ''}${dep ? ` in ${dep}` : ''}`;
    const proposalId = await propose(ctx, {
      kind: 'add_employee', area: 'people', title,
      summary: `${name} is added to the company${joiningDate > ctx.today ? `, joining on ${niceDate(joiningDate)}` : ''}, with the details in the table. They can sign in to the app with ${email}.`,
      lines: [
        { text: `Sets: ${set.filter(([, v]) => v !== '—').map(([k, v]) => `${k} ${v}`).join('; ')}.` },
        { text: `They start as Onboarding: a recent joiner gets the company's onboarding journey and shows on the Onboarding board.`, tone: 'info' },
        ...(limit.max !== null ? [{ text: `Uses one account of your plan's ${limit.max} (${limit.used + 1} after this).`, tone: 'info' as const }] : []),
        ...(newLists.length ? [{ text: `New to the company's lists: ${newLists.join(' and ')}. Check the spelling.`, tone: 'warn' as const }] : []),
        { text: `Still missing after this: ${missing.join('; ')}.`, tone: 'warn', why: 'The Add user form saves the basic record only; shift, salary, bank and KPI details are set separately (Suwi can prepare those next).' },
        { text: 'No Undo from Suwi: to take it back, delete the new record from their profile.', tone: 'warn' },
      ],
      effectiveFrom: joiningDate, undoable: false,
      preview: { field: 'New employee', rows: set.map(([k, v]) => ({ name: k, current: '—', next: v })), skipped: [] },
      payload: { byUserId: ctx.userId, input },
    });
    return { data: { prepared: true, title, sets: Object.fromEntries(set), stillMissing: missing, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open employees', view: 'employees' }] };
  },
});

defineExecutor('add_employee', {
  async run(p) {
    const { byUserId, input } = p.payload as { byUserId: string; input: CreateEmployeeInput };
    const e = await createEmployeeForAdmin(byUserId, input);
    return { message: `${e.name} has been added${input.joiningDate ? `, joining ${niceDate(input.joiningDate)}` : ''}. Next: their shift template, salary and bank details.` };
  },
});
