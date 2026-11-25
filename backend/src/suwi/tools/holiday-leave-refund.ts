// Giving back leave for days later made holidays (24 Nov, Suwi training: time). A leave counts its days
// when it is applied for, leaving out the holidays known then (applyForLeave); a Holiday Bank day added
// afterwards shows as a holiday on the calendar and in payroll (a holiday outranks leave in grading),
// but the leave keeps charging the balance for it. The leave service has no step that re-counts an
// approved leave or cancels single days of it, so the clean way back is the one the dashboard offers
// HR: raise that person's total for the type by the days charged on holidays (setLeaveTotal, Employees ›
// person › Requests › Leave balance). One card for everyone; Undo lowers each total again.
import { leaves, users } from '../../config/db';
import { Leave } from '../../models/leave.model';
import { getMyLeaveBalance, setLeaveTotal } from '../../services/leave.service';
import { holidaysForUser } from '../../services/holiday.service';
import { isWeekOffDay, leaveRulesFor, weekOffGridFor } from '../../services/shift.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { proposalsCol } from '../store';
import { ACTIVE, isDate, niceDate, norm } from './team';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
type Group = { userId: string; name: string; type: string; typeName: string; year: number; days: number; leaveIds: string[]; holidays: string[] };

/** Approved leave that charged days now in the Holiday Bank, grouped by person, type and year. */
export async function holidayLeaveRefunds(ctx: { org: string }, from: string, to: string, who: string[] = []) {
  const people = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, org: 1, location: 1, state: 1, branch: 1 } }).toArray();
  const scope = who.length ? people.filter((p) => who.some((n) => norm(p.name).includes(norm(n)))) : people;
  const byId = new Map(scope.map((p) => [p.userId, p]));
  const rows = await leaves().find({ userId: { $in: [...byId.keys()] }, status: 'approved', startDate: { $lte: new Date(`${to}T00:00:00.000Z`) }, endDate: { $gte: new Date(`${from}T00:00:00.000Z`) } }).toArray();
  // Leaves already given back through an earlier confirmed card are not given back twice.
  const earlier = await proposalsCol().find({ org: ctx.org, kind: 'refund_holiday_leave', status: 'done' }, { projection: { payload: 1, decidedAt: 1 } }).toArray();
  const refunded = new Map<string, Date | undefined>();
  for (const p of earlier) for (const g of ((p.payload as { groups?: Group[] }).groups ?? [])) for (const id of g.leaveIds) refunded.set(id, p.decidedAt);
  const groups = new Map<string, Group>();
  const skipped: { who: string; reason: string }[] = [];
  const rulesOf = new Map<string, Awaited<ReturnType<typeof leaveRulesFor>>>();
  for (const l of rows as (Leave & { _id: { toHexString(): string } })[]) {
    const p = byId.get(l.userId)!;
    const span = `${niceDate(day(l.startDate))}${l.endDate > l.startDate ? ` to ${niceDate(day(l.endDate))}` : ''}`;
    const hols = (await holidaysForUser(p as never, { from: l.startDate, to: l.endDate }));
    if (!hols.length) continue;
    if (!rulesOf.has(l.userId)) rulesOf.set(l.userId, await leaveRulesFor(l.userId));
    const rules = rulesOf.get(l.userId)!;
    // Week-offs from the person's shift: a holiday on a week-off was never charged.
    const weeklyOff = await weekOffGridFor(l.userId);
    const holDays = [...new Set(hols.map((h) => day(h.date)))].filter((d) => !isWeekOffDay(new Date(`${d}T00:00:00.000Z`), weeklyOff));
    if (!holDays.length) continue;
    const id = l._id.toHexString();
    const rule = rules.types.find((t) => t.key === l.type);
    const label = `${p.name}, ${rule?.name ?? l.type} ${span}`;
    if (refunded.has(id)) { skipped.push({ who: label, reason: `Already given back via Suwi${refunded.get(id) ? ` on ${niceDate(day(refunded.get(id)!))}` : ''}` }); continue; }
    if (l.days == null) { skipped.push({ who: label, reason: 'An old leave without a day count: check it by hand' }); continue; }
    // What the leave would count today, with today's Holiday Bank.
    let now = 0;
    if (l.halfDay) now = holDays.includes(day(l.startDate)) ? 0 : 0.5;
    else for (let d = new Date(l.startDate); d <= l.endDate; d = new Date(d.getTime() + 86_400_000)) if (!isWeekOffDay(d, weeklyOff) && !holDays.includes(day(d))) now += 1;
    const back = Math.min(l.days - now, l.halfDay ? 0.5 : holDays.length);
    if (back <= 0) continue; // The holiday was known when the leave was applied for: never charged.
    if (!rules.balanceTracked) { skipped.push({ who: label, reason: 'Unlimited leave: no balance is kept, so nothing to give back' }); continue; }
    if (!rule) { skipped.push({ who: label, reason: 'That leave type is no longer on their shift template' }); continue; }
    if (rule.unpaid) { skipped.push({ who: label, reason: 'Leave without pay keeps no balance; the holiday already is not loss of pay' }); continue; }
    if (rule.resetOn === 'monthly') { skipped.push({ who: label, reason: `${rule.name} closes every month, so its total cannot be raised; cancel the leave and have it applied again for the working days` }); continue; }
    const year = l.startDate.getUTCFullYear();
    const key = `${l.userId}|${l.type}|${year}`;
    const g = groups.get(key) ?? { userId: l.userId, name: p.name, type: l.type, typeName: rule.name, year, days: 0, leaveIds: [], holidays: [] };
    g.days += back; g.leaveIds.push(id);
    for (const h of hols.filter((x) => holDays.includes(day(x.date)))) g.holidays.push(`${h.name} (${niceDate(day(h.date))})`);
    groups.set(key, g);
  }
  return { groups: [...groups.values()], skipped, checked: rows.length };
}

defineTools({
  name: 'prepare_refund_holiday_leave',
  area: 'attendance',
  acts: true,
  label: () => 'Prepared: give back leave taken on holidays',
  description: 'Prepare ONE card that gives back leave days charged on days that were later added to the Holiday Bank ("refund leave on the days we made holidays", "we declared 7 Nov a holiday, give back the leave"). It finds approved leave in a date range (default this year) that still charges a holiday the person observes (their location\'s or all-locations), works out the days charged on it, and raises each person\'s total for that type by those days, the same change as Employees › person › Requests › Leave balance. Optionally only some people (names). Leave types that close every month and leave without pay are listed as left out with the reason. Changes nothing until HR confirms; Undo lowers each total back. A leave given back once is never given back again.',
  input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD (default 1 Jan this year)' }, to: { type: 'string', description: 'YYYY-MM-DD (default 31 Dec this year)' }, names: { type: 'array', items: { type: 'string' } } } },
  api: { method: 'PUT', path: '/admin/employees/x/leave-balance/x' },
  async run(ctx, i) {
    const year = ctx.today.slice(0, 4);
    const from = isDate(i.from) ? i.from : `${year}-01-01`;
    const to = isDate(i.to) ? i.to : `${year}-12-31`;
    const who = Array.isArray(i.names) ? i.names.map((n) => str(n, 80)).filter(Boolean) : [];
    const { groups, skipped, checked } = await holidayLeaveRefunds(ctx, from, to, who);
    if (!groups.length) return { data: { nothingToDo: true, message: `No approved leave between ${niceDate(from)} and ${niceDate(to)} is charging a Holiday Bank day.`, leavesChecked: checked, skipped } };
    const rows: { name: string; current: string; next: string }[] = [];
    for (const g of groups) {
      const b = (await getMyLeaveBalance(g.userId, g.year)).types.find((t) => t.key === g.type);
      rows.push({ name: `${g.name}: ${g.typeName} ${g.year}`, current: b ? `total ${b.total}, available ${b.remaining}` : '?', next: b ? `total ${b.total + g.days}, available ${b.remaining + g.days} (+${g.days} for ${[...new Set(g.holidays)].join(', ')})` : `+${g.days}` });
    }
    const days = groups.reduce((s, g) => s + g.days, 0);
    const people = new Set(groups.map((g) => g.userId)).size;
    const title = `Give back ${plural(days, 'day')} of leave charged on holidays to ${plural(people, 'person', 'people')}`;
    const proposalId = await propose(ctx, {
      kind: 'refund_holiday_leave', area: 'attendance', title,
      summary: `${groups.map((g) => `${g.name.split(' ')[0]} +${g.days} ${g.typeName}`).slice(0, 6).join(', ')}${groups.length > 6 ? ` and ${groups.length - 6} more` : ''}.`,
      lines: [
        { text: `Each person's total for that leave type and year goes up by the days their leave charged on a holiday (the table lists them, with the holidays).` },
        { text: 'The leave itself stays approved as it is; the calendar and payroll already show those days as holidays, so pay is not affected. Only the balance changes.', why: 'A leave counts its days when applied for. A holiday added later outranks the leave on the calendar, but the leave kept charging the balance; Sowaka has no step that re-counts an approved leave, so the days are given back as a change to the total, the same as the Leave balance pencil on the profile.' },
        { text: 'Each change shows on the person\'s Activity as a change to their total, by you via Suwi.', tone: 'info' },
        ...(skipped.length ? [{ text: `Left out: ${skipped.length} (listed under the table).`, tone: 'warn' as const }] : []),
        { text: 'Undo lowers each total back by the same days.', tone: 'info' },
      ],
      effectiveFrom: ctx.today, undoable: true,
      typeToConfirm: groups.length >= 10 ? String(groups.length) : undefined,
      preview: { field: 'Leave given back', rows, skipped: skipped.slice(0, 100) },
      payload: { byUserId: ctx.userId, groups },
    });
    return { data: { prepared: true, title, people, days, leftOut: skipped.length, skippedSample: skipped.slice(0, 5), note: 'Nothing changes until HR presses Confirm on the card. HR sees each person in the table.' }, proposalId, links: [{ label: 'Open leave balances', view: 'leavebalances' }] };
  },
});

defineExecutor('refund_holiday_leave', {
  async run(p) {
    const { byUserId, groups } = p.payload as { byUserId: string; groups: Group[] };
    const done: Group[] = [];
    const failed: string[] = [];
    for (const g of groups) {
      try {
        const now = (await getMyLeaveBalance(g.userId, g.year)).types.find((t) => t.key === g.type);
        if (!now) throw new Error('type no longer on their template');
        await setLeaveTotal(byUserId, g.userId, g.type, now.total + g.days, g.year);
        done.push(g);
      } catch (e) { failed.push(`${g.name} (${(e as Error).message})`); }
    }
    if (!done.length) throw new Error(`Nothing was given back: ${failed.join('; ')}`);
    const days = done.reduce((s, g) => s + g.days, 0);
    return { message: `Gave back ${plural(days, 'day')} of leave to ${plural(new Set(done.map((g) => g.userId)).size, 'person', 'people')}.${failed.length ? ` Not done: ${failed.join('; ')}.` : ''}`, undo: { done } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const done = ((p.undo as { done?: Group[] } | undefined)?.done) ?? [];
    const failed: string[] = [];
    for (const g of done) {
      try {
        const now = (await getMyLeaveBalance(g.userId, g.year)).types.find((t) => t.key === g.type);
        if (!now) throw new Error('type no longer on their template');
        await setLeaveTotal(byUserId, g.userId, g.type, now.total - g.days, g.year);
      } catch (e) { failed.push(`${g.name} (${(e as Error).message})`); }
    }
    return `Took the given-back days off again${failed.length ? `, except: ${failed.join('; ')}` : ''}.`;
  },
});
