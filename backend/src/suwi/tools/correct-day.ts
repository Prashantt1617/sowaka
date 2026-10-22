// Correcting one day of one person's attendance: HR's mark on the calendar
// (the same override the dashboard's calendar sets), prepared as a card that
// shows the day's current mark, the new one, the effect in paid days, and the
// rule that a mark only reaches the current month (or a month whose payroll
// run is still open). Undo clears the mark, or puts back the one it replaced.
import { attendanceOverrides, paidDaysTemplates, payrollRuns, salaryStructures, users } from '../../config/db';
import { HR_DAY_STATUSES, HrDayStatus } from '../../models/attendance.model';
import { clearAttendanceOverride, currentMonthIst, setAttendanceOverride } from '../../services/attendance-override.service';
import { CalendarDay, employeeCalendar, employeeDayStatuses } from '../../services/attendance-report.service';
import { policyForUser, shiftPolicyViewOf } from '../../services/shift.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { isDate, niceDate } from './team';

const LABEL: Record<string, string> = { present: 'Present', half_day: 'Half day', absent: 'Absent', on_leave: 'On leave', week_off: 'Week off', holiday: 'Holiday', missed_punch: 'Missed punch', upcoming: 'Upcoming' };

/** Paid days a graded day costs: an absence a day, a half day half, a missed punch whatever the shift says. */
function lopOf(day: Pick<CalendarDay, 'status' | 'countsAs'>): number {
  if (day.status === 'absent') return 1;
  if (day.status === 'half_day') return 0.5;
  if (day.status === 'missed_punch') return day.countsAs === 'Absent' ? 1 : day.countsAs === 'Half Day' ? 0.5 : 0;
  return 0;
}
/** An ISO instant as India wall-clock HH:MM. */
const ist = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(11, 16);
const lopOfMark = (s: HrDayStatus) => (s === 'absent' ? 1 : s === 'half_day' ? 0.5 : 0);
const describe = (day: CalendarDay) => `${LABEL[day.status] ?? day.status}${day.label ? ` (${day.label}${day.status === 'missed_punch' && day.countsAs ? `, counts as ${day.countsAs}` : ''})` : ''}${day.hr ? ', marked by HR' : ''}`;

defineTools(
  {
    name: 'prepare_correct_day',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: mark ${i.name ?? 'their'} ${i.date} as ${i.status}`,
    description: "Prepare correcting one day of a person's attendance with HR's mark (present, half_day, absent, on_leave, week_off, holiday), the same as tapping the day on their calendar. Changes nothing: the card shows the day's current mark, the new mark, the effect in paid days, and that a mark only reaches the current month (or a month whose payroll run is still open). Needs their userId and the date.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, status: { type: 'string', enum: HR_DAY_STATUSES }, note: { type: 'string', description: 'Why, in a few words (shown on the calendar)' } }, required: ['userId', 'date', 'status'] },
    api: { method: 'PUT', path: '/admin/employees/x/calendar/x' },
    async run(ctx, i) {
      const userId = str(i.userId);
      const date = str(i.date);
      const status = str(i.status) as HrDayStatus;
      if (!isDate(date)) throw new Error('The date must be YYYY-MM-DD');
      if (!HR_DAY_STATUSES.includes(status)) throw new Error(`Mark the day as one of: ${HR_DAY_STATUSES.join(', ')}`);
      if (userId === ctx.userId) throw new Error('You cannot mark your own attendance; another admin has to');
      if (date > ctx.today) throw new Error(`${niceDate(date)} has not happened yet`);
      const person = await users().findOne({ org: ctx.org, userId }, { projection: { _id: 0, name: 1 } });
      if (!person) throw new Error('That person is not in this company');
      // The same month rule the calendar applies, checked here so the card never promises what Confirm would refuse.
      const month = date.slice(0, 7);
      const thisMonth = currentMonthIst();
      const openRun = month < thisMonth ? await payrollRuns().findOne({ org: ctx.org, period: month, status: { $in: ['draft', 'pending_approval'] } } as never, { projection: { _id: 1 } }) : null;
      const finished = await payrollRuns().findOne({ org: ctx.org, period: month, status: { $in: ['approved', 'paid'] } } as never, { projection: { _id: 1 } });
      if (finished) throw new Error(`Payroll for ${month} is submitted: its days can no longer be changed`);
      if (month !== thisMonth && !openRun) throw new Error(`Only the current month (${thisMonth}) can be corrected, or an earlier month whose payroll run is still open; ${month} is neither`);

      const cal = await employeeCalendar(ctx.userId, userId, month);
      const day = cal.days.find((d) => d.date === date);
      if (!day) throw new Error('That day is not on their calendar');
      const before = lopOf(day.hr ? { status: day.hr.previousStatus, countsAs: day.countsAs } : day);
      const currentLop = day.hr ? lopOfMark(day.status as HrDayStatus) : before;
      const after = lopOfMark(status);
      const delta = Math.round((currentLop - after) * 2) / 2; // paid days gained
      const [y, m] = month.split('-').map(Number);
      const base = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const structure = await salaryStructures().findOne({ org: ctx.org, userId }, { projection: { _id: 0, paidDaysTemplateCode: 1 } });
      const pdt = structure ? await paidDaysTemplates().findOne(structure.paidDaysTemplateCode ? { org: ctx.org, code: structure.paidDaysTemplateCode } : { org: ctx.org, isDefault: true }) : null;
      const allPaid = pdt?.allDaysPaid === true;
      const existing = await attendanceOverrides().findOne({ org: ctx.org, userId, workDate: date }, { projection: { _id: 0 } });
      if (existing?.status === status && (existing.note ?? '') === str(i.note)) return { data: { nothingToDo: true, message: `${date} is already marked ${LABEL[status]} by HR.` } };
      const policy = shiftPolicyViewOf(await policyForUser(userId, date));
      const first = person.name.split(' ')[0];
      const payLine = allPaid
        ? `No pay effect: ${first}'s paid-days template (${pdt!.name}) pays every day of the month, so the calendar is not read by payroll.`
        : delta === 0
          ? `No change in paid days: ${LABEL[day.status]} and ${LABEL[status]} cost the same (${after} of ${base} days in ${month}).`
          : `${delta > 0 ? `+${delta}` : delta} paid day${Math.abs(delta) === 1 ? '' : 's'} for ${month} (out of ${base}): the day cost ${currentLop} and will cost ${after}.`;
      const title = `Mark ${first}'s ${niceDate(date)} as ${LABEL[status]}`;
      const proposalId = await propose(ctx, {
        kind: 'correct_day', area: 'attendance', title,
        summary: `${niceDate(date)} is ${describe(day)}; it becomes ${LABEL[status]}${str(i.note) ? ` ("${str(i.note)}")` : ''}. ${payLine}`,
        lines: [
          { text: `Now: ${describe(day)}${day.punchIn ? `, in ${ist(day.punchIn)}` : ''}${day.punchOut ? `, out ${ist(day.punchOut)}` : ''}${day.lateByMinutes ? `, late by ${day.lateByMinutes} min` : ''}.`, why: `Graded by ${cal.shift} (${cal.window}, ${cal.punchFormat}). HR's mark replaces the graded day everywhere: the report, the calendar, payroll and the app.` },
          { text: `New: ${LABEL[status]}, marked by ${ctx.user.name}${str(i.note) ? ` with the note "${str(i.note)}"` : ''}.` },
          { text: payLine, why: 'Loss of pay = calendar absences + ½ per half day (+ missed punches as the shift counts them), on top of the rules in their paid-days template; the base is the days in the month.', tone: allPaid || delta >= 0 ? 'info' : 'warn' },
          { text: openRun ? `${month} is an earlier month, allowed because its payroll run is still open; the run picks up the change when it is recalculated.` : `Only the current month can be marked (${thisMonth}); once ${month}'s payroll is submitted the day stays as paid.`, why: 'A mark moves pay, so it can only land where pay has not been settled.' },
          { text: `Their app shows ${niceDate(date)} as ${LABEL[status]} (marked by HR) from the moment you confirm; the shift stays ${policy.name} (${policy.startTime}–${policy.endTime}).` },
          ...(existing ? [{ text: `This replaces HR's earlier mark (${LABEL[existing.status]}${existing.setByName ? ` by ${existing.setByName}` : ''}); Undo puts that mark back.`, tone: 'info' as const }] : [{ text: 'Undo removes the mark and the day goes back to what the punches say.', tone: 'info' as const }]),
        ],
        effectiveFrom: date, undoable: true,
        payload: { userId, date, status, note: str(i.note), byUserId: ctx.userId, name: person.name, previous: existing ? { status: existing.status, note: existing.note ?? '' } : null },
      });
      return { data: { prepared: true, title, current: describe(day), newMark: LABEL[status], payEffect: payLine, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: `Open ${first}'s calendar`, userId, tab: 'calendar' }] };
    },
  },
);

async function readBack(org: string, userId: string, date: string) {
  const d = (await employeeDayStatuses(org, userId, date, date))?.[0];
  return d ? `Their app now shows ${niceDate(date)} as ${LABEL[d.status] ?? d.status}${d.reason ? ` (${d.reason})` : ''}.` : '';
}

defineExecutor('correct_day', {
  async run(p) {
    const { userId, date, status, note, byUserId, name } = p.payload as { userId: string; date: string; status: HrDayStatus; note: string; byUserId: string; name: string };
    await setAttendanceOverride(byUserId, userId, date, { status, note });
    return { message: `Marked ${name.split(' ')[0]}'s ${niceDate(date)} as ${LABEL[status]}. ${await readBack(p.org, userId, date)}`.trim() };
  },
  async undo(p) {
    const { userId, date, byUserId, name, previous } = p.payload as { userId: string; date: string; byUserId: string; name: string; previous: { status: HrDayStatus; note: string } | null };
    if (previous) await setAttendanceOverride(byUserId, userId, date, previous);
    else await clearAttendanceOverride(byUserId, userId, date);
    return `${previous ? `Put back HR's earlier mark (${LABEL[previous.status]}) on` : 'Removed the mark from'} ${name.split(' ')[0]}'s ${niceDate(date)}. ${await readBack(p.org, userId, date)}`.trim();
  },
});
