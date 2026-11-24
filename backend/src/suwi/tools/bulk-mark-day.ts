// Marking one day for many people at once (24 Nov, HR asked on Convrse: "those who were present on
// 10 Nov, mark a holiday for them on 11 Nov"). Before this, Suwi prepared one card per person with
// prepare_correct_day and ran out of steps after four people. This prepares ONE card for the whole
// group: who (everyone, a department, location, designation, a manager's reports, names, employee
// IDs, the attached sheet) narrowed by what their day was on another date (present, absent, on leave,
// half day, missed punch), the date to mark and the mark. The card has a table of each person's
// current day and the new mark; Confirm sets HR's mark for every one of them (the same override the
// calendar sets), Undo puts every day back.
import { attendanceOverrides, users } from '../../config/db';
import { HR_DAY_STATUSES, HrDayStatus } from '../../models/attendance.model';
import { clearAttendanceOverride, setAttendanceOverride } from '../../services/attendance-override.service';
import { attendanceReport } from '../../services/attendance-report.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { proposalsCol } from '../store';
import { ObjectId } from 'mongodb';
import { isDate, niceDate } from './team';
import { resolveBulk } from './bulk';
import { LABEL, markableMonth } from './correct-day';

/** What someone's day was on the date that picks them. `present` is anyone who came in at all. */
const HAD = ['present', 'full_day', 'late', 'half_day', 'absent', 'on_leave', 'missed_punch'] as const;
type Had = (typeof HAD)[number];
const HAD_WORDS: Record<Had, string> = {
  present: 'came in (full day, late, half day or a missed punch)', full_day: 'were present for the full day', late: 'came in late',
  half_day: 'had a half day', absent: 'were absent', on_leave: 'were on leave', missed_punch: 'missed a punch',
};

type Person = { userId: string; name: string; previous: { status: HrDayStatus; note: string } | null };
type Report = Awaited<ReturnType<typeof attendanceReport>>;

/** Each person's day on `date` from the report: the graded status, late minutes and whether they punched at all. */
function daysOn(r: Report, date: string) {
  const out = new Map<string, { status: string; late: number; punched: boolean }>();
  for (const d of r.days) if (d[1] === date) out.set(d[0], { status: d[2], late: d[3], punched: Boolean(d[4] || d[5]) });
  for (const [uid, on, status] of r.offDays) if (on === date && !out.has(uid)) out.set(uid, { status, late: 0, punched: false });
  return out;
}
function matches(day: { status: string; late: number; punched: boolean } | undefined, had: Had): boolean {
  if (!day) return false;
  if (had === 'present') return day.status === 'present' || day.status === 'half_day' || (day.status === 'missed_punch' && day.punched);
  if (had === 'full_day') return day.status === 'present';
  if (had === 'late') return day.late > 0 && day.status !== 'missed_punch';
  if (had === 'on_leave') return day.status === 'on_leave' || day.status === 'unpaid_leave';
  return day.status === had;
}
const lopOf = (s: string) => (s === 'absent' || s === 'unpaid_leave' ? 1 : s === 'half_day' ? 0.5 : 0);

defineTools({
  name: 'prepare_bulk_mark_day',
  area: 'attendance',
  acts: true,
  label: (i) => `Prepared: mark ${i.date} as ${i.status} for ${i.onDate ? `those ${i.hadStatus ?? 'present'} on ${i.onDate}` : 'a group'}`,
  description: "Prepare HR's mark on ONE date (present, half_day, absent, on_leave, week_off, holiday) for MANY people in a single card: always use this instead of calling prepare_correct_day once per person. Who: everyone, department, location, designation, manager (their reports), names, employeeIds, userIds or fromSheet; narrow it with onDate + hadStatus to the people whose day on onDate was that (e.g. \"those present on 10 Nov get 11 Nov as a holiday\": date 11 Nov, status holiday, everyone true, onDate 10 Nov, hadStatus present). hadStatus present means came in at all (full day, late, half day, or a missed punch with a punch). Changes nothing: the card lists each person's current day and the new mark; HR confirms once for all. People already carrying that mark, joined after the date, or the asker themself are left out and listed.",
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD: the day to mark' },
      status: { type: 'string', enum: HR_DAY_STATUSES },
      note: { type: 'string', description: 'Why, in a few words (shown on the calendar), e.g. "Holiday for working on 10 Nov"' },
      everyone: { type: 'boolean' },
      department: { type: 'string' }, location: { type: 'string' }, designation: { type: 'string' },
      manager: { type: 'string', description: "Manager's name: only their reports" },
      names: { type: 'array', items: { type: 'string' } }, employeeIds: { type: 'array', items: { type: 'string' } },
      userIds: { type: 'array', items: { type: 'string' } }, fromSheet: { type: 'boolean' },
      onDate: { type: 'string', description: 'YYYY-MM-DD: pick only the people whose day on this date was hadStatus' },
      hadStatus: { type: 'string', enum: [...HAD], description: 'With onDate (default present)' },
    },
    required: ['date', 'status'],
  },
  api: { method: 'PUT', path: '/admin/employees/x/calendar/x' },
  async run(ctx, i) {
    const date = str(i.date);
    const status = str(i.status) as HrDayStatus;
    const note = str(i.note).slice(0, 200);
    if (!isDate(date)) throw new Error('The date must be YYYY-MM-DD');
    if (!HR_DAY_STATUSES.includes(status)) throw new Error(`Mark the day as one of: ${HR_DAY_STATUSES.join(', ')}`);
    if (date > ctx.today) throw new Error(`${niceDate(date)} has not happened yet`);
    const { M, openRun } = await markableMonth(ctx.org, date);
    const onDate = str(i.onDate);
    const had = (HAD.includes(str(i.hadStatus) as Had) ? str(i.hadStatus) : 'present') as Had;
    if (onDate && !isDate(onDate)) throw new Error('onDate must be YYYY-MM-DD');
    if (onDate && onDate > ctx.today) throw new Error(`${niceDate(onDate)} has not happened yet`);

    // Who: the bulk picker; with onDate alone (no one named), the whole company.
    const who = await resolveBulk(ctx, onDate && !i.everyone && !i.department && !i.location && !i.designation && !i.manager && !i.names && !i.employeeIds && !i.userIds && !i.fromSheet ? { ...i, everyone: true } : i);
    const skipped = [...who.skipped];
    const markDay = daysOn(await attendanceReport(ctx.userId, { from: date, to: date }), date);
    let people = who.people;
    let how = who.how;
    if (onDate) {
      const pickDay = onDate === date ? markDay : daysOn(await attendanceReport(ctx.userId, { from: onDate, to: onDate }), onDate);
      people = people.filter((p) => matches(pickDay.get(p.userId), had));
      how = `${how}: those who ${HAD_WORDS[had]} on ${niceDate(onDate)}`;
    }
    if (!people.length) {
      return { data: { prepared: false, nobody: true, message: `Nobody matches (${how}).`, skipped: skipped.slice(0, 20) } };
    }
    const ids = people.map((p) => p.userId);
    const [joined, existing] = await Promise.all([
      users().find({ org: ctx.org, userId: { $in: ids } }, { projection: { _id: 0, userId: 1, joiningDate: 1 } }).toArray(),
      attendanceOverrides().find({ org: ctx.org, userId: { $in: ids }, workDate: date }, { projection: { _id: 0, userId: 1, status: 1, note: 1 } }).toArray(),
    ]);
    const joinedOn = new Map(joined.map((u) => [u.userId, u.joiningDate ? new Date(u.joiningDate).toISOString().slice(0, 10) : '']));
    const marked = new Map(existing.map((o) => [o.userId, o]));
    const chosen: Person[] = [];
    const rows: { name: string; current: string; next: string }[] = [];
    let gained = 0;
    for (const p of people) {
      if (p.userId === ctx.userId) { skipped.push({ who: p.name, reason: 'You cannot mark your own attendance; another admin has to' }); continue; }
      const j = joinedOn.get(p.userId);
      if (j && j > date) { skipped.push({ who: p.name, reason: `Joined on ${niceDate(j)}, after ${niceDate(date)}` }); continue; }
      const prev = marked.get(p.userId);
      if (prev?.status === status) { skipped.push({ who: p.name, reason: `Already marked ${LABEL[status]} by HR` }); continue; }
      const now = markDay.get(p.userId);
      const current = prev ? `${LABEL[prev.status] ?? prev.status} (HR)` : now ? LABEL[now.status] ?? now.status : 'Not on their calendar';
      gained += Math.max(0, lopOf(prev?.status ?? now?.status ?? '') - lopOf(status));
      chosen.push({ userId: p.userId, name: p.name, previous: prev ? { status: prev.status as HrDayStatus, note: prev.note ?? '' } : null });
      rows.push({ name: p.name, current, next: LABEL[status] });
    }
    if (!chosen.length) return { data: { prepared: false, message: 'Everyone picked is left out (see skipped).', skipped: skipped.slice(0, 20) } };

    const title = `Mark ${niceDate(date)} as ${LABEL[status]} for ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}`;
    const proposalId = await propose(ctx, {
      kind: 'bulk_correct_day', area: 'attendance', title,
      summary: `${chosen.length} ${chosen.length === 1 ? 'person' : 'people'} (${how}) get ${niceDate(date)} marked ${LABEL[status]}${note ? ` ("${note}")` : ''}.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
      lines: [
        { text: `Who: ${how}. ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'} in the table below.` },
        { text: `New: ${niceDate(date)} becomes ${LABEL[status]}, marked by ${ctx.user.name}${note ? ` with the note "${note}"` : ''}. HR's mark replaces the graded day everywhere: the report, the calendar, payroll and the app.` },
        { text: gained > 0 ? `Pay: up to +${gained} paid day${gained === 1 ? '' : 's'} in all for ${M}, from days that were absent or half days (a paid-days template that pays every day is not affected).` : `Pay: no loss of pay changes for ${M} from what the days show now.`, tone: 'info' },
        { text: openRun ? `${M} is an earlier month, allowed because its payroll run is still open; the run picks up the change when it is recalculated.` : `Only the current month can be marked; after ${M}'s payroll is submitted, these days can no longer be changed.` },
        ...(skipped.length ? [{ text: `Left out: ${skipped.length} (listed under the table).`, tone: 'warn' as const }] : []),
        { text: 'Undo puts every day back as it was (HR\'s earlier mark, or what the punches say).', tone: 'info' },
      ],
      effectiveFrom: date, undoable: true,
      payload: { date, status, note, byUserId: ctx.userId, people: chosen },
    });
    await proposalsCol().updateOne({ _id: new ObjectId(proposalId) }, { $set: { preview: { field: `${niceDate(date)}`, rows: rows.slice(0, 300), skipped: skipped.slice(0, 100) } } });
    return {
      data: { prepared: true, title, people: chosen.length, leftOut: skipped.length, skippedSample: skipped.slice(0, 5), who: how, note: 'Nothing is saved until HR presses Confirm on the card. HR sees every person in the card\'s table: do not list them.' },
      proposalId,
    };
  },
});

defineExecutor('bulk_correct_day', {
  async run(p) {
    const { date, status, note, byUserId, people } = p.payload as { date: string; status: HrDayStatus; note: string; byUserId: string; people: Person[] };
    const failed: string[] = [];
    for (const x of people) {
      try { await setAttendanceOverride(byUserId, x.userId, date, { status, note }); }
      catch (e) { failed.push(`${x.name} (${(e as Error).message})`); }
    }
    const done = people.length - failed.length;
    return { message: `Marked ${niceDate(date)} as ${LABEL[status]} for ${done} ${done === 1 ? 'person' : 'people'}.${failed.length ? ` Not marked: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
  },
  async undo(p) {
    const { date, byUserId, people } = p.payload as { date: string; byUserId: string; people: Person[] };
    let n = 0;
    for (const x of people) {
      try {
        if (x.previous) await setAttendanceOverride(byUserId, x.userId, date, x.previous);
        else await clearAttendanceOverride(byUserId, x.userId, date);
        n += 1;
      } catch { /* the rest still go back */ }
    }
    return `Put back ${niceDate(date)} for ${n} of ${people.length} people.`;
  },
});
