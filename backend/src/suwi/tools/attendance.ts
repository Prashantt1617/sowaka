// Attendance: who was late, absent, on leave or missed punches, from the same
// report the Attendance page shows (so the numbers always agree with it).
import { attendanceReport, employeeCalendar } from '../../services/attendance-report.service';
import { defineTools, num, str } from '../tools';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const range = (i: Record<string, unknown>, today: string) => {
  const ok = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const to = ok(i.to) ? String(i.to) : today;
  const from = ok(i.from) ? String(i.from) : `${to.slice(0, 7)}-01`;
  return from <= to ? { from, to } : { from: to, to: from };
};

defineTools(
  {
    name: 'attendance_summary',
    area: 'attendance',
    label: (i) => `Attendance ${i.from ?? 'from the 1st'} to ${i.to ?? 'today'}`,
    description: 'Attendance per person for a date range (default: this month to today): days present, half days, late arrivals, early exits, missed punches, absences, leave. Optionally only people with at least N lates / absences / missed punches, or one department. Use for "who was late 3+ times", "who is absent today" (from=to=today), "missed punches this week".',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
        minLate: { type: 'number' }, minAbsent: { type: 'number' }, minMissed: { type: 'number' },
        department: { type: 'string' }, status: { type: 'string', enum: ['absent', 'on_leave', 'missed_punch', 'half_day', 'present'], description: 'Only people with this status on at least one day' },
        limit: { type: 'number' },
      },
    },
    api: { method: 'GET', path: '/admin/reports/attendance' },
    async run(ctx, i) {
      const { from, to } = range(i, ctx.today);
      const r = await attendanceReport(ctx.userId, { from, to });
      const per = new Map<string, { present: number; halfDay: number; late: number; early: number; missed: number; absent: number; leave: number; lateDays: string[] }>();
      for (const [uid, date, status, late, , , , , early] of r.days) {
        const p = per.get(uid) ?? { present: 0, halfDay: 0, late: 0, early: 0, missed: 0, absent: 0, leave: 0, lateDays: [] };
        if (status === 'present') p.present++; else if (status === 'half_day') p.halfDay++; else if (status === 'missed_punch') p.missed++; else if (status === 'absent') p.absent++; else if (status === 'on_leave') p.leave++;
        if (late > 0) { p.late++; if (p.lateDays.length < 6) p.lateDays.push(date); }
        if (early > 0) p.early++;
        per.set(uid, p);
      }
      const dep = str(i.department).toLowerCase();
      const want = str(i.status);
      let rows = [...per.entries()].map(([userId, c]) => ({ userId, name: r.people[userId]?.name ?? userId, department: r.people[userId]?.department ?? '', manager: r.people[userId]?.manager ?? '', shift: r.people[userId]?.template ?? 'Default', ...c }));
      if (dep) rows = rows.filter((x) => x.department.toLowerCase().includes(dep));
      rows = rows.filter((x) => x.late >= num(i.minLate, 0) && x.absent >= num(i.minAbsent, 0) && x.missed >= num(i.minMissed, 0));
      if (want) rows = rows.filter((x) => (want === 'absent' ? x.absent : want === 'on_leave' ? x.leave : want === 'missed_punch' ? x.missed : want === 'half_day' ? x.halfDay : x.present) > 0);
      rows.sort((a, b) => b.late - a.late || b.absent - a.absent || b.missed - a.missed);
      const limit = num(i.limit, 25, 1, 300);
      return {
        data: { from, to, peopleInReport: Object.keys(r.people).length, matching: rows.length, rows: rows.slice(0, limit), note: 'Working days only; weekly offs and holidays follow each person\'s shift and location. Missed punches waiting on a device sync are not separated in this report.' },
        links: [{ label: 'Open attendance report', view: 'attendancereport' }],
      };
    },
  },
  {
    name: 'person_attendance',
    area: 'attendance',
    label: (i) => `${i.name ?? 'Their'} calendar for ${i.month ?? 'this month'}`,
    description: "One person's day-by-day attendance for a month: each day's mark (present, half day, late, missed punch, absent, leave, weekly off, holiday). Needs their userId (find it with search_people).",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string', description: 'Their name, for the label' }, month: { type: 'string', description: 'YYYY-MM' } }, required: ['userId'] },
    api: { method: 'GET', path: '/admin/employees/x/calendar' },
    async run(ctx, i) {
      const month = typeof i.month === 'string' && /^\d{4}-\d{2}$/.test(i.month) ? i.month : ctx.today.slice(0, 7);
      const cal = await employeeCalendar(ctx.userId, str(i.userId), month);
      return { data: cal, links: [{ label: `Open ${str(i.name) || 'their'} calendar`, userId: str(i.userId), tab: 'calendar' }] };
    },
  },
);
export { addDays };
