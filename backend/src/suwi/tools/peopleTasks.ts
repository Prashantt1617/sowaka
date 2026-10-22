// Missing employee details: the same list as People › Tasks (basic details,
// shift, KPIs, salary, bank/PAN), read through the service that builds that
// page, so salary and bank tasks appear only for people with payroll access.
// Each task carries a link to the profile tab where it is fixed.
import { peopleTasks, TaskKey } from '../../services/peopleTasks.service';
import { defineTools, num, str, SuwiLink } from '../tools';
import { norm } from './people';

/** The profile tab the dashboard opens for each task (anything else is the Profile tab). */
const TAB: Record<TaskKey, string | undefined> = { details: undefined, shift: undefined, kpi: 'performance', salary: 'salary', bank: undefined };
const TASKS: TaskKey[] = ['details', 'shift', 'kpi', 'salary', 'bank'];

defineTools({
  name: 'missing_details',
  area: 'people',
  label: (i) => (i.task ? `People missing ${str(i.task)}` : 'People still being set up'),
  description: 'Who still needs setting up, as People › Tasks shows it: basic details missing (which ones), no shift template, no KPIs for the current cycle, no salary, no bank/PAN (salary and bank only when the asker has payroll access). Filter by task, department or name. Each row says what is missing and which profile tab fixes it.',
  input_schema: {
    type: 'object',
    properties: {
      task: { type: 'string', enum: TASKS, description: 'Only people with this task' },
      department: { type: 'string' },
      text: { type: 'string', description: 'Part of a name or employee ID' },
      limit: { type: 'number', description: 'Default 20, max 200' },
    },
  },
  api: { method: 'GET', path: '/admin/employees/tasks' },
  async run(ctx, i) {
    const r = await peopleTasks(ctx.userId);
    const task = TASKS.includes(str(i.task) as TaskKey) ? (str(i.task) as TaskKey) : null;
    const dep = norm(i.department), t = norm(i.text);
    const rows = r.people.filter((p) => (!task || p.tasks.some((x) => x.key === task)) && (!dep || norm(p.department).includes(dep)) && (!t || norm(`${p.name} ${p.employeeId}`).includes(t)));
    const counts: Record<string, number> = {};
    for (const p of r.people) for (const x of p.tasks) counts[x.key] = (counts[x.key] ?? 0) + 1;
    const limit = num(i.limit, 20, 1, 200);
    const shown = rows.slice(0, limit);
    const links: SuwiLink[] = [{ label: 'Open People › Tasks', view: 'peopletasks' }];
    for (const p of shown.slice(0, 3)) {
      const first = task ? p.tasks.find((x) => x.key === task) : p.tasks[0];
      links.push({ label: `Open ${p.name.split(' ')[0]}'s profile`, userId: p.userId, tab: first ? TAB[first.key] : undefined });
    }
    return {
      data: {
        period: r.period, activePeople: r.total, peopleWithTasks: r.people.length, matching: rows.length,
        countsByTask: counts,
        payrollChecked: r.payroll, ...(r.payroll ? {} : { note: 'Salary and bank/PAN tasks are not included: they need payroll access.' }),
        people: shown.map((p) => ({
          userId: p.userId, name: p.name, employeeId: p.employeeId || null, designation: p.designation || null, department: p.department || null, joined: p.joiningDate || null,
          tasks: (task ? p.tasks.filter((x) => x.key === task) : p.tasks).map((x) => ({ key: x.key, label: x.label, missing: x.detail, tab: TAB[x.key] ?? 'profile' })),
        })),
        more: rows.length > limit ? rows.length - limit : 0,
      },
      links,
    };
  },
});
