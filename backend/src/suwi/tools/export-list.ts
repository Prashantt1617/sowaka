// A list HR wants as a spreadsheet ("Export November attendance", "Export everyone in Interiors"): the
// month's attendance per person, leave taken in a month, the people list with the columns HR names, or
// everything waiting on a decision. Built from the same services the dashboard pages export from
// (attendanceReport for Reports › Attendance, listAllLeavesForAdmin for Leave requests, the roster for
// Employees, pendingRows for the waiting pile), each only when this person may open that page. The
// Suwi panel has no file download yet, so the whole list comes back as a table under the answer, with a
// link to the page whose Export button downloads it. Never mobile, date of birth, bank, PAN or pay.
import { attendanceReport } from '../../services/attendance-report.service';
import { listAllLeavesForAdmin } from '../../services/leave.service';
import { mayRead } from '../insight';
import { defineTools, monthOf, str, SuwiContext, SuwiLink, SuwiTable } from '../tools';
import { isoDay, norm, roster } from './people';
import { pendingRows } from './requests';

const LISTS = ['attendance', 'leave', 'people', 'pending'] as const;
type List = (typeof LISTS)[number];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', contract: 'Contract', intern: 'Intern' };

/** The people list's columns HR may ask for (never mobile, birthday or anything from payroll). */
const PEOPLE_FIELDS = {
  employeeId: 'Employee ID', name: 'Name', email: 'Work email', designation: 'Designation', department: 'Department', location: 'Location',
  manager: 'Reporting manager', employeeType: 'Employee type', joiningDate: 'Joining date', gender: 'Gender', status: 'Status',
} as const;
type PeopleField = keyof typeof PEOPLE_FIELDS;
const DEFAULT_FIELDS: PeopleField[] = ['employeeId', 'name', 'email', 'designation', 'department', 'location', 'manager', 'joiningDate'];

function filterOf(i: Record<string, unknown>) {
  const dep = norm(i.department), who = norm(i.name), loc = norm(i.location);
  return (x: { name?: string; department?: string; location?: string }) => (!dep || norm(x.department).includes(dep)) && (!who || norm(x.name).includes(who)) && (!loc || norm(x.location).includes(loc));
}

async function build(ctx: SuwiContext, list: List, i: Record<string, unknown>): Promise<{ table: SuwiTable; link: SuwiLink; criteria: string[] } | { denied: string }> {
  const keep = filterOf(i);
  const criteria = [str(i.department) && `Department: ${str(i.department)}`, str(i.location) && `Location: ${str(i.location)}`, str(i.name) && `Name: ${str(i.name)}`].filter(Boolean) as string[];
  if (list === 'attendance') {
    if (!mayRead(ctx.user, '/admin/reports/attendance')) return { denied: 'Reports › Attendance' };
    const month = monthOf(i.month, ctx.today);
    const from = `${month}-01`;
    const to = lastDay(month) < ctx.today ? lastDay(month) : ctx.today;
    if (from > ctx.today) throw new Error(`${monthName(month)} has not started yet`);
    const r = await attendanceReport(ctx.userId, { from, to });
    const per = new Map<string, number[]>();
    for (const [uid, , status, late, , , , , early] of r.days) {
      const c = per.get(uid) ?? [0, 0, 0, 0, 0, 0, 0, 0];
      const at = ['present', 'half_day', 'missed_punch', 'absent', 'on_leave', 'unpaid_leave'].indexOf(status);
      if (at >= 0) c[at] += 1;
      if (late > 0) c[6] += 1;
      if (early > 0) c[7] += 1;
      per.set(uid, c);
    }
    const rows = Object.entries(r.people).filter(([, p]) => keep(p)).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([uid, p]) => { const c = per.get(uid) ?? [0, 0, 0, 0, 0, 0, 0, 0]; return [p.employeeId || '', p.name, p.department || '', p.location || '', c[0], c[1], c[6], c[7], c[2], c[3], c[4], c[5]]; });
    criteria.unshift(`${from} to ${to}`);
    return {
      table: { title: `Attendance, ${monthName(month)}${to < lastDay(month) ? ` (to ${to})` : ''}`, columns: ['Employee ID', 'Name', 'Department', 'Location', 'Present', 'Half days', 'Late', 'Early exits', 'Missed punches', 'Absent', 'Leave', 'Unpaid leave'], rows },
      link: { label: 'Open Attendance report (Export Excel)', view: 'attendancereport' }, criteria,
    };
  }
  if (list === 'leave') {
    if (!mayRead(ctx.user, '/admin/leaves')) return { denied: 'Leave requests' };
    const month = monthOf(i.month, ctx.today);
    const from = `${month}-01`, to = lastDay(month);
    const all = await listAllLeavesForAdmin(ctx.userId, { status: 'approved' });
    const rows = all.filter((l) => l.startDate <= to && l.endDate >= from && keep({ name: l.employee.name, department: l.employee.department }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.name.localeCompare(b.employee.name))
      .map((l) => [l.employee.name, l.employee.department ?? '', l.typeName, l.startDate, l.endDate, l.days, l.halfDay ? 'Yes' : '', l.unpaid ? 'Unpaid' : 'Paid']);
    criteria.unshift(`Approved leave overlapping ${monthName(month)}`);
    return { table: { title: `Leave taken, ${monthName(month)}`, columns: ['Name', 'Department', 'Type', 'From', 'To', 'Days', 'Half day', 'Paid'], rows }, link: { label: 'Open Leave requests (Export)', view: 'leave' }, criteria };
  }
  if (list === 'people') {
    const asked = Array.isArray(i.fields) ? (i.fields as unknown[]).map((f) => str(f) as PeopleField).filter((f) => f in PEOPLE_FIELDS) : [];
    const fields: PeopleField[] = asked.length ? [...new Set(['name' as PeopleField, ...asked])] : DEFAULT_FIELDS;
    const people = await roster(ctx);
    const nameOf = new Map(people.map((p) => [p.userId, p.name]));
    const value = (p: (typeof people)[number], f: PeopleField): string => {
      switch (f) {
        case 'manager': return nameOf.get(p.managerUserId ?? '') ?? '';
        case 'employeeType': return TYPE_LABEL[p.employeeType ?? ''] ?? '';
        case 'joiningDate': return isoDay(p.joiningDate) ?? '';
        case 'location': return p.location || p.branch || '';
        case 'status': return p.lifecycleStatus ?? 'active';
        default: return String(p[f] ?? '');
      }
    };
    const rows = people.filter((p) => keep({ name: p.name, department: p.department, location: p.location || p.branch })).sort((a, b) => a.name.localeCompare(b.name)).map((p) => fields.map((f) => value(p, f)));
    return { table: { title: `People${criteria.length ? ` (${criteria.join(', ')})` : ''}`, columns: fields.map((f) => PEOPLE_FIELDS[f]), rows }, link: { label: 'Open Employees (Export list)', view: 'employees' }, criteria: [...criteria, 'Active roll (not people who have left)'] };
  }
  const rows = (await pendingRows(ctx, str(i.type))).filter((r) => keep(r)).sort((a, b) => b.daysWaiting - a.daysWaiting)
    .map((r) => [r.name, r.department ?? '', r.type, r.what, r.dates, r.submitted, r.daysWaiting]);
  return { table: { title: 'Waiting on a decision', columns: ['Name', 'Department', 'Type', 'What', 'Dates', 'Submitted', 'Days waiting'], rows }, link: { label: 'Open the Overview', view: 'overview' }, criteria: [...criteria, 'Only the request types you can open'] };
}

defineTools({
  name: 'export_list',
  area: 'people',
  label: (i) => `Export: the ${str(i.list) || 'people'} list${str(i.month) ? ` for ${str(i.month)}` : ''}`,
  description: `Build a list HR asked to export or download as a spreadsheet. list: attendance (per person for a month: present, half days, late, early exits, missed punches, absent, leave, unpaid leave), leave (approved leave overlapping a month: who, type, dates, days), people (the active roll with the columns in fields: ${Object.keys(PEOPLE_FIELDS).join(', ')}), pending (every request waiting on a decision; type narrows it: leave, overtime, corrections, checkins, claims). month is YYYY-MM (this month if left out). Filters: department, location, name. Examples: "Export November attendance" → list attendance, month 2026-11; "Export everyone in Interiors" → list people, department Interiors. HR gets every row as a table under the answer and a link to the page whose Export button downloads the file: say so, give the row count, and do not write the rows out.`,
  input_schema: {
    type: 'object',
    properties: {
      list: { type: 'string', enum: LISTS }, month: { type: 'string', description: 'YYYY-MM' },
      fields: { type: 'array', items: { type: 'string', enum: Object.keys(PEOPLE_FIELDS) }, description: 'people only: the columns' },
      department: { type: 'string' }, location: { type: 'string' }, name: { type: 'string' },
      type: { type: 'string', enum: ['leave', 'overtime', 'corrections', 'checkins', 'claims'], description: 'pending only' },
    },
    required: ['list'],
  },
  api: { method: 'GET', path: '/admin/employees' },
  async run(ctx, i) {
    const list = (LISTS as readonly string[]).includes(str(i.list)) ? str(i.list) as List : 'people';
    const out = await build(ctx, list, i);
    if ('denied' in out) return { data: { note: `You don't have access to ${out.denied}, so Suwi can't export it.` } };
    const { table, link, criteria } = out;
    return {
      data: {
        list, title: table.title, rows: table.rows.length, columns: table.columns, criteria,
        note: table.rows.length
          ? `HR sees all ${table.rows.length} rows in the table under your answer: do not list them. Suwi can't hand over a file yet: the ${link.label.replace(/^Open /, '')} button opens the page that downloads it.`
          : 'Nothing matches, so there is nothing to export.',
      },
      ...(table.rows.length ? { tables: [table] } : {}),
      links: [link],
    };
  },
});
