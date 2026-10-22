// People: find anyone, headcount. Reads the roster directly, scoped to the
// asker's company; never returns bank, PAN, salary or contact secrets.
import { users } from '../../config/db';
import { defineTools, num, str, SuwiContext } from '../tools';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function roster(ctx: SuwiContext) {
  return users().find({ org: ctx.org, ...ACTIVE } as never, {
    projection: { _id: 0, userId: 1, name: 1, employeeId: 1, email: 1, designation: 1, department: 1, location: 1, branch: 1, managerUserId: 1, employeeType: 1, joiningDate: 1, gender: 1, phone: 1, birthday: 1 },
  }).toArray();
}

defineTools(
  {
    name: 'search_people',
    area: 'people',
    label: (i) => (i.text ? `People matching "${i.text}"` : 'The employee list'),
    description: 'Find employees in this company. Filter by free text (name, employee ID, email, designation, department, location), by department, designation, location, manager name, employee type, joined after/before (YYYY-MM-DD), or people missing a detail. Returns userId, name, employeeId, designation, department, location, manager, type and joining date.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' }, department: { type: 'string' }, designation: { type: 'string' }, location: { type: 'string' },
        manager: { type: 'string', description: "Manager's name" }, employeeType: { type: 'string', enum: ['full_time', 'contract', 'intern'] },
        joinedAfter: { type: 'string' }, joinedBefore: { type: 'string' },
        missing: { type: 'string', enum: ['manager', 'designation', 'department', 'location', 'employeeId', 'phone', 'birthday', 'gender', 'joiningDate'] },
        limit: { type: 'number', description: 'Default 25, max 200' },
      },
    },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const all = await roster(ctx);
      const nameById = new Map(all.map((p) => [p.userId, p.name]));
      const t = norm(i.text), dep = norm(i.department), des = norm(i.designation), loc = norm(i.location), mgr = norm(i.manager);
      const rows = all.filter((p) => {
        const hay = norm([p.name, p.employeeId, p.email, p.designation, p.department, p.location ?? p.branch].join(' '));
        if (t && !t.split(' ').every((w) => hay.includes(w))) return false;
        if (dep && !norm(p.department).includes(dep)) return false;
        if (des && !norm(p.designation).includes(des)) return false;
        if (loc && !norm(p.location ?? p.branch).includes(loc)) return false;
        if (mgr && !norm(nameById.get(p.managerUserId ?? '')).includes(mgr)) return false;
        if (i.employeeType && p.employeeType !== i.employeeType) return false;
        const j = p.joiningDate ? p.joiningDate.toISOString().slice(0, 10) : '';
        if (typeof i.joinedAfter === 'string' && (!j || j < i.joinedAfter)) return false;
        if (typeof i.joinedBefore === 'string' && (!j || j > i.joinedBefore)) return false;
        if (typeof i.missing === 'string') {
          const v = i.missing === 'manager' ? p.managerUserId : (p as Record<string, unknown>)[i.missing];
          if (v !== undefined && v !== null && String(v).trim() !== '') return false;
        }
        return true;
      });
      const limit = num(i.limit, 25, 1, 200);
      return {
        data: {
          total: rows.length,
          people: rows.slice(0, limit).map((p) => ({
            userId: p.userId, name: p.name, employeeId: p.employeeId ?? null, designation: p.designation ?? null, department: p.department ?? null,
            location: p.location ?? p.branch ?? null, manager: nameById.get(p.managerUserId ?? '') ?? null, type: p.employeeType ?? null,
            joined: p.joiningDate ? p.joiningDate.toISOString().slice(0, 10) : null,
          })),
          note: rows.length > limit ? `Showing ${limit} of ${rows.length}` : undefined,
        },
        links: [{ label: 'Open employees', view: 'employees' }],
      };
    },
  },
  {
    name: 'headcount',
    area: 'people',
    label: () => 'Headcount on the active roll',
    description: 'How many active employees there are, split by department, location, designation and employee type.',
    input_schema: { type: 'object', properties: { by: { type: 'string', enum: ['department', 'location', 'designation', 'employeeType'] } } },
    api: { method: 'GET', path: '/admin/employees' },
    async run(ctx, i) {
      const all = await roster(ctx);
      const count = (key: (p: (typeof all)[number]) => string | undefined) => {
        const m: Record<string, number> = {};
        for (const p of all) { const k = key(p)?.trim() || '(not set)'; m[k] = (m[k] ?? 0) + 1; }
        return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
      };
      const by = str(i.by);
      return {
        data: {
          total: all.length,
          ...(by === '' || by === 'department' ? { byDepartment: count((p) => p.department) } : {}),
          ...(by === '' || by === 'location' ? { byLocation: count((p) => p.location ?? p.branch) } : {}),
          ...(by === 'designation' ? { byDesignation: count((p) => p.designation) } : {}),
          ...(by === '' || by === 'employeeType' ? { byType: count((p) => p.employeeType) } : {}),
        },
        links: [{ label: 'Open employees', view: 'employees' }],
      };
    },
  },
);
