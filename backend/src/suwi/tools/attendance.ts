// Attendance: who was late, absent, on leave or missed punches, from the same
// report the Attendance page shows (so the numbers always agree with it).
// Lates are also clustered by weekday, and every count comes with the days
// behind it so an answer can link to them.
import { attendanceReport, employeeCalendar } from '../../services/attendance-report.service';
import { defineTools, num, str } from '../tools';
import { addDays, rangeOf, weekdayOf } from './team';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const emptyWeek = () => Object.fromEntries(WEEKDAYS.map((d) => [d, 0])) as Record<string, number>;

/**
 * Punches a device recorded but has not sent yet are not in Sowaka's data:
 * the biometric import only carries a day once the device has synced, and a
 * record has no "waiting on device" flag. So a missed punch cannot be told
 * apart from one still on an offline device; the answer says so rather than
 * guessing.
 */
const DEVICE_SYNC_NOTE = 'Punches still on an offline device are not in the data (an imported row only exists once the device has synced), so missed punches cannot be separated from punches waiting on a device sync. Check the device if several people on one biometric shift miss the same day.';

type Count = { present: number; halfDay: number; late: number; early: number; missed: number; absent: number; leave: number; unpaidLeave: number; notPunchedInYet: number; lateDays: string[]; earlyDays: string[]; missedDays: string[]; absentDays: string[]; lateByWeekday: Record<string, number> };
const empty = (): Count => ({ present: 0, halfDay: 0, late: 0, early: 0, missed: 0, absent: 0, leave: 0, unpaidLeave: 0, notPunchedInYet: 0, lateDays: [], earlyDays: [], missedDays: [], absentDays: [], lateByWeekday: emptyWeek() });

/** Per-person counts and the days behind them, from the org report's rows. */
export function countReport(days: Awaited<ReturnType<typeof attendanceReport>>['days'], keepDays = 8, today?: string) {
  const per = new Map<string, Count>();
  const push = (list: string[], d: string) => { if (list.length < keepDays) list.push(d); };
  for (const [uid, date, status, late, punchIn, punchOut, , , early] of days) {
    const p = per.get(uid) ?? empty();
    // Today isn't over: a working day with no punch yet is not an absence.
    if (today && date === today && status === 'absent' && !punchIn && !punchOut) p.notPunchedInYet++;
    else if (status === 'present') p.present++; else if (status === 'half_day') p.halfDay++; else if (status === 'missed_punch') { p.missed++; push(p.missedDays, date); } else if (status === 'absent') { p.absent++; push(p.absentDays, date); } else if (status === 'on_leave') p.leave++; else if (status === 'unpaid_leave') p.unpaidLeave++;
    // A single-punch day is already a missed punch; it is not also late or early (the same rule payroll uses).
    if (status !== 'missed_punch' && late > 0) { p.late++; push(p.lateDays, date); p.lateByWeekday[weekdayOf(date)]++; }
    if (status !== 'missed_punch' && early > 0) { p.early++; push(p.earlyDays, date); }
    per.set(uid, p);
  }
  return per;
}

defineTools(
  {
    name: 'attendance_summary',
    area: 'attendance',
    label: (i) => `Attendance ${i.from ?? 'from the 1st'} to ${i.to ?? 'today'}`,
    description: 'Attendance per person for a date range (default: this month to today): days present, half days, late arrivals (with the days and a count per weekday), early exits, missed punches, absences, leave, leave without pay (unpaidLeave: unpaid, not absent). Optionally only people with at least N lates / absences / missed punches / early exits, or one department or manager. Use for "who was late 3+ times", "missed punches this week", "which weekday are people late most". For "who is absent or on leave today", one call with from=to=today is enough. Today is not over, so a working day today with no punch yet is notPunchedInYet, not absent.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
        minLate: { type: 'number' }, minAbsent: { type: 'number' }, minMissed: { type: 'number' }, minEarly: { type: 'number' },
        department: { type: 'string' }, manager: { type: 'string', description: "Manager's name: only their reports" },
        status: { type: 'string', enum: ['absent', 'on_leave', 'unpaid_leave', 'missed_punch', 'half_day', 'present', 'late', 'early'], description: 'Only people with this on at least one day' },
        limit: { type: 'number' },
      },
    },
    api: { method: 'GET', path: '/admin/reports/attendance' },
    async run(ctx, i) {
      const { from, to } = rangeOf(i, ctx.today);
      const r = await attendanceReport(ctx.userId, { from, to });
      const per = countReport(r.days, 8, ctx.today);
      const dep = str(i.department).toLowerCase();
      const mgr = str(i.manager).toLowerCase();
      const want = str(i.status);
      let rows = [...per.entries()].map(([userId, c]) => ({ userId, name: r.people[userId]?.name ?? userId, department: r.people[userId]?.department ?? '', manager: r.people[userId]?.manager ?? '', shift: r.people[userId]?.template ?? 'Default', punchFormat: r.people[userId]?.punchFormat ?? '', ...c }));
      if (dep) rows = rows.filter((x) => x.department.toLowerCase().includes(dep));
      if (mgr) rows = rows.filter((x) => x.manager.toLowerCase().includes(mgr));
      rows = rows.filter((x) => x.late >= num(i.minLate, 0) && x.absent >= num(i.minAbsent, 0) && x.missed >= num(i.minMissed, 0) && x.early >= num(i.minEarly, 0));
      if (want) rows = rows.filter((x) => (want === 'absent' ? x.absent : want === 'on_leave' ? x.leave : want === 'unpaid_leave' ? x.unpaidLeave : want === 'missed_punch' ? x.missed : want === 'half_day' ? x.halfDay : want === 'late' ? x.late : want === 'early' ? x.early : x.present) > 0);
      rows.sort((a, b) => b.late - a.late || b.absent - a.absent || b.missed - a.missed || b.early - a.early);
      // Lates across everyone matching, per weekday, so "Monday lates" has a number.
      const lateByWeekday = emptyWeek();
      for (const x of rows) for (const d of WEEKDAYS) lateByWeekday[d] += x.lateByWeekday[d];
      const limit = num(i.limit, 25, 1, 300);
      return {
        data: {
          from, to, peopleInReport: Object.keys(r.people).length, matching: rows.length,
          lateByWeekday,
          totals: { late: rows.reduce((t, x) => t + x.late, 0), early: rows.reduce((t, x) => t + x.early, 0), missedPunches: rows.reduce((t, x) => t + x.missed, 0), absent: rows.reduce((t, x) => t + x.absent, 0), ...(to >= ctx.today ? { notPunchedInYetToday: rows.reduce((t, x) => t + x.notPunchedInYet, 0) } : {}) },
          rows: rows.slice(0, limit),
          note: `Working days only; weekly offs and holidays follow each person's shift and location. Day lists hold up to 8 dates each.${to >= ctx.today ? ' Today is not over: someone with no punch yet today is counted as notPunchedInYet, not absent.' : ''} ${DEVICE_SYNC_NOTE}`,
        },
        links: [{ label: 'Open attendance report', view: 'attendancereport' }],
      };
    },
  },
  {
    name: 'person_attendance',
    area: 'attendance',
    label: (i) => `${i.name ?? 'Their'} calendar for ${i.month ?? 'this month'}`,
    description: "One person's day-by-day attendance for a month: each day's mark (present, half day, late, early, missed punch and what it counts as, absent, leave, leave without pay, weekly off, holiday, HR's marks). Needs their userId (find it with search_people).",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string', description: 'Their name, for the label' }, month: { type: 'string', description: 'YYYY-MM' } }, required: ['userId'] },
    api: { method: 'GET', path: '/admin/employees/x/calendar' },
    async run(ctx, i) {
      const month = typeof i.month === 'string' && /^\d{4}-\d{2}$/.test(i.month) ? i.month : ctx.today.slice(0, 7);
      const cal = await employeeCalendar(ctx.userId, str(i.userId), month);
      const lateDays = cal.days.filter((d) => d.lateByMinutes > 0).map((d) => `${d.date} (${weekdayOf(d.date)}, ${d.lateByMinutes} min)`);
      const earlyDays = cal.days.filter((d) => d.earlyByMinutes > 0).map((d) => `${d.date} (${d.earlyByMinutes} min)`);
      const missedDays = cal.days.filter((d) => d.status === 'missed_punch').map((d) => `${d.date}: ${d.label}, counts as ${d.countsAs ?? '?'}`);
      return { data: { ...cal, lateDays, earlyDays, missedDays, note: DEVICE_SYNC_NOTE }, links: [{ label: `Open ${str(i.name) || 'their'} calendar`, userId: str(i.userId), tab: 'calendar' }] };
    },
  },
);
export { addDays, DEVICE_SYNC_NOTE };
