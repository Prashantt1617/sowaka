// People: find anyone, one person's details, headcount and teams. Reads the
// roster directly, scoped to the asker's company; never returns bank, PAN,
// salary or contact secrets. Every answer says which fields are empty on the
// record and which are hidden on purpose, so "not shown" is never read as
// "not set".
import { shiftTemplates, users } from '../../config/db';
import { User } from '../../models/user.model';
import { defineTools, num, str, SuwiContext } from '../tools';

export const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const isoDay = (d: unknown) => (d instanceof Date && !Number.isNaN(d.valueOf()) ? d.toISOString().slice(0, 10) : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

export type Person = Pick<User, 'userId' | 'name' | 'employeeId' | 'email' | 'designation' | 'department' | 'location' | 'branch' | 'managerUserId' | 'employeeType' | 'joiningDate' | 'gender' | 'phone' | 'birthday' | 'lifecycleStatus' | 'isDirector'>;
const PROJECTION = { _id: 0, userId: 1, name: 1, employeeId: 1, email: 1, designation: 1, department: 1, location: 1, branch: 1, managerUserId: 1, employeeType: 1, joiningDate: 1, gender: 1, phone: 1, birthday: 1, lifecycleStatus: 1, isDirector: 1 };

/** Everyone on the active roll of the asker's company. */
export async function roster(ctx: SuwiContext): Promise<Person[]> {
  return users().find({ org: ctx.org, ...ACTIVE } as never, { projection: PROJECTION }).toArray() as Promise<Person[]>;
}

/** The chain of managers above a person, nearest first, as names; stops at a loop. */
export function orgPathOf(userId: string, byId: Map<string, Person>): string[] {
  const path: string[] = [];
  const seen = new Set<string>([userId]);
  let cur = byId.get(userId)?.managerUserId;
  while (cur && !seen.has(cur) && byId.has(cur)) { seen.add(cur); path.push(byId.get(cur)!.name); cur = byId.get(cur)!.managerUserId; }
  return path;
}

/** Everyone under a manager: direct reports, or the whole tree below them. */
export function teamOf(managerId: string, all: Person[], indirect: boolean): Person[] {
  const direct = (id: string) => all.filter((p) => p.managerUserId === id);
  if (!indirect) return direct(managerId);
  const out: Person[] = [];
  const seen = new Set<string>([managerId]);
  const queue = [managerId];
  while (queue.length) for (const p of direct(queue.shift()!)) if (!seen.has(p.userId)) { seen.add(p.userId); out.push(p); queue.push(p.userId); }
  return out;
}

/**
 * One person from a userId, employee ID, email or name. A first name is enough
 * when only one person has it; otherwise the error names the candidates so
 * Claude can ask which one.
 */
export async function findPerson(ctx: SuwiContext, ref: unknown, all?: Person[]): Promise<Person> {
  const r = str(ref);
  if (!r) throw new Error('Say who: a name, employee ID or userId');
  const people = all ?? await roster(ctx);
  const exact = people.find((p) => p.userId === r || (p.employeeId && p.employeeId.toLowerCase() === r.toLowerCase()) || (p.email && p.email.toLowerCase() === r.toLowerCase()));
  if (exact) return exact;
  const n = norm(r);
  const full = people.filter((p) => norm(p.name) === n);
  if (full.length === 1) return full[0];
  const partial = full.length ? full : people.filter((p) => norm(p.name).split(' ').some((w) => w === n) || norm(p.name).includes(n));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`Nobody called "${r}" on the active roll`);
  throw new Error(`More than one person matches "${r}": ${partial.slice(0, 6).map((p) => `${p.name}${p.designation ? ` (${p.designation})` : ''}`).join(', ')}. Ask which one.`);
}

/** Fields that are blank on the record (so Claude can say "not set", not "not shown"). */
export const EMPTY_LABELS: [keyof Person, string][] = [
  ['employeeId', 'employee ID'], ['designation', 'designation'], ['department', 'department'], ['location', 'location'], ['managerUserId', 'reporting manager'],
  ['employeeType', 'employee type'], ['joiningDate', 'joining date'], ['email', 'email'], ['phone', 'mobile'], ['gender', 'gender'], ['birthday', 'date of birth'],
];
export const emptyFields = (p: Person, except: (keyof Person)[] = []) =>
  EMPTY_LABELS.filter(([k]) => !except.includes(k)).filter(([k]) => { const v = k === 'location' ? (p.location ?? p.branch) : p[k]; return v === undefined || v === null || String(v).trim() === ''; }).map(([, l]) => l);

/** What a people tool never includes, whatever the record holds. */
export const HIDDEN_NOTE = 'Not shown here (hidden on purpose, not necessarily empty): mobile, date of birth, bank account, PAN, UAN and pay. Pay and bank details come only through payroll tools, for people with payroll access.';

const view = (p: Person, byId: Map<string, Person>) => ({
  userId: p.userId, name: p.name, employeeId: p.employeeId || null, designation: p.designation || null, department: p.department || null,
  location: p.location || p.branch || null, manager: byId.get(p.managerUserId ?? '')?.name ?? null, type: p.employeeType ?? null,
  joined: isoDay(p.joiningDate), orgPath: orgPathOf(p.userId, byId).join(' › ') || null,
  empty: emptyFields(p, ['phone', 'birthday', 'gender', 'email']),
});

defineTools(
  {
    name: 'search_people',
    area: 'people',
    label: (i) => (i.reportsTo ? `${i.reportsTo}'s team` : i.text ? `People matching "${i.text}"` : 'The employee list'),
    description: "Find employees in this company. Filter by free text (name, employee ID, email, designation, department, location), by department, designation, location, a manager's team (reportsTo = manager's name; includeIndirect for everyone below them), employee type, joined after/before (YYYY-MM-DD), or people missing a detail. Each row has userId, name, employeeId, designation, department, location, manager, type, joining date, the org path (managers up to the top) and `empty`: the fields blank on the record. Fields not in the result are hidden, not empty.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' }, department: { type: 'string' }, designation: { type: 'string' }, location: { type: 'string' },
        reportsTo: { type: 'string', description: "Manager's name, employee ID or userId: their team" }, includeIndirect: { type: 'boolean', description: 'With reportsTo: everyone below them, not only direct reports' },
        manager: { type: 'string', description: "Manager's name (same as reportsTo, direct reports only)" }, employeeType: { type: 'string', enum: ['full_time', 'contract', 'intern'] },
        joinedAfter: { type: 'string' }, joinedBefore: { type: 'string' },
        missing: { type: 'string', enum: ['manager', 'designation', 'department', 'location', 'employeeId', 'phone', 'birthday', 'gender', 'joiningDate', 'email'] },
        limit: { type: 'number', description: 'Default 25, max 200' },
      },
    },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const all = await roster(ctx);
      const byId = new Map(all.map((p) => [p.userId, p]));
      let pool = all;
      let lead: Person | null = null;
      if (str(i.reportsTo) || str(i.manager)) {
        lead = await findPerson(ctx, str(i.reportsTo) || str(i.manager), all);
        pool = teamOf(lead.userId, all, i.includeIndirect === true);
      }
      const t = norm(i.text), dep = norm(i.department), des = norm(i.designation), loc = norm(i.location);
      const rows = pool.filter((p) => {
        const hay = norm([p.name, p.employeeId, p.email, p.designation, p.department, p.location ?? p.branch].join(' '));
        if (t && !t.split(' ').every((w) => hay.includes(w))) return false;
        if (dep && !norm(p.department).includes(dep)) return false;
        if (des && !norm(p.designation).includes(des)) return false;
        if (loc && !norm(p.location ?? p.branch).includes(loc)) return false;
        if (i.employeeType && p.employeeType !== i.employeeType) return false;
        const j = isoDay(p.joiningDate) ?? '';
        if (typeof i.joinedAfter === 'string' && (!j || j < i.joinedAfter)) return false;
        if (typeof i.joinedBefore === 'string' && (!j || j > i.joinedBefore)) return false;
        if (typeof i.missing === 'string') {
          const v = i.missing === 'manager' ? p.managerUserId : i.missing === 'location' ? (p.location ?? p.branch) : (p as Record<string, unknown>)[i.missing];
          if (v !== undefined && v !== null && String(v).trim() !== '') return false;
        }
        return true;
      });
      const limit = num(i.limit, 25, 1, 200);
      return {
        data: {
          total: rows.length,
          ...(lead ? { team: { of: lead.name, userId: lead.userId, designation: lead.designation || null, direct: teamOf(lead.userId, all, false).length, total: teamOf(lead.userId, all, true).length, showing: i.includeIndirect === true ? 'everyone below them' : 'direct reports' } } : {}),
          people: rows.slice(0, limit).map((p) => view(p, byId)),
          note: rows.length > limit ? `Showing ${limit} of ${rows.length}` : undefined,
          hidden: HIDDEN_NOTE,
        },
        links: [lead ? { label: `Open ${lead.name.split(' ')[0]}'s org chart`, userId: lead.userId, tab: 'orgchart' } : { label: 'Open employees', view: 'employees' }],
      };
    },
  },
  {
    name: 'person_details',
    area: 'people',
    label: (i) => `${str(i.person) || 'A person'}'s record`,
    description: "One person's record: employee ID, email, designation, department, location, type, joining date, manager, org path, direct reports, shift template, and exactly which fields are empty on the record versus hidden from this tool. Use for \"is X's joining date set?\", \"who does X report to?\", \"what's X's org path?\".",
    input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId' } }, required: ['person'] },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const all = await roster(ctx);
      const byId = new Map(all.map((p) => [p.userId, p]));
      const p = await findPerson(ctx, i.person, all);
      const reports = teamOf(p.userId, all, false);
      const shift = await shiftTemplates().findOne({ org: ctx.org, assignedUserIds: p.userId, deletedAt: { $exists: false } } as never, { projection: { name: 1 } });
      const manager = byId.get(p.managerUserId ?? '');
      return {
        data: {
          ...view(p, byId), email: p.email || null, status: p.lifecycleStatus, director: p.isDirector === true,
          manager: manager ? { userId: manager.userId, name: manager.name, designation: manager.designation || null } : null,
          directReports: { count: reports.length, people: reports.slice(0, 12).map((r) => ({ userId: r.userId, name: r.name, designation: r.designation || null })) },
          everyoneBelow: teamOf(p.userId, all, true).length,
          shiftTemplate: shift?.name ?? null,
          empty: emptyFields(p, ['phone', 'birthday', 'gender']),
          emptyNote: 'Empty means the record has no value for it; HR can fill it on the profile.',
          hidden: HIDDEN_NOTE,
        },
        links: [{ label: `Open ${p.name.split(' ')[0]}'s profile`, userId: p.userId }, { label: 'Org chart', userId: p.userId, tab: 'orgchart' }],
      };
    },
  },
  {
    name: 'headcount',
    area: 'people',
    label: (i) => (i.under ? `Team size under ${i.under}` : 'Headcount on the active roll'),
    description: "How many active employees there are, split by department, location, designation, employee type or manager. With `under`, a manager's team size (direct and everyone below) and its split.",
    input_schema: { type: 'object', properties: { by: { type: 'string', enum: ['department', 'location', 'designation', 'employeeType', 'manager'] }, under: { type: 'string', description: "Manager's name: count their team instead of the company" } } },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const all = await roster(ctx);
      const byId = new Map(all.map((p) => [p.userId, p]));
      let pool = all;
      let lead: Person | null = null;
      if (str(i.under)) { lead = await findPerson(ctx, i.under, all); pool = teamOf(lead.userId, all, true); }
      const count = (key: (p: Person) => string | undefined) => {
        const m: Record<string, number> = {};
        for (const p of pool) { const k = key(p)?.trim() || '(not set)'; m[k] = (m[k] ?? 0) + 1; }
        return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
      };
      const by = str(i.by);
      return {
        data: {
          total: pool.length,
          ...(lead ? { under: lead.name, direct: teamOf(lead.userId, all, false).length, everyoneBelow: pool.length } : {}),
          ...(by === '' || by === 'department' ? { byDepartment: count((p) => p.department) } : {}),
          ...(by === '' || by === 'location' ? { byLocation: count((p) => p.location ?? p.branch) } : {}),
          ...(by === 'designation' ? { byDesignation: count((p) => p.designation) } : {}),
          ...(by === 'manager' ? { byManager: count((p) => byId.get(p.managerUserId ?? '')?.name) } : {}),
          ...(by === '' || by === 'employeeType' ? { byType: count((p) => p.employeeType) } : {}),
          note: '"(not set)" means the field is empty on those records.',
        },
        links: [lead ? { label: `Open ${lead.name.split(' ')[0]}'s org chart`, userId: lead.userId, tab: 'orgchart' } : { label: 'Open employees', view: 'employees' }],
      };
    },
  },
);
