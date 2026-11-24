// Leave balance: one person's balance per leave type for a year, from the
// same balance the app shows them. Approved leave counts as used; pending
// leave is shown separately so HR can see what is still waiting on a decision.
import { leaves, users } from '../../config/db';
import { getMyLeaveBalance, setLeaveTotal } from '../../services/leave.service';
import { leaveRulesFor } from '../../services/shift.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { LIGHT_USER, peopleWith } from '../toolCache';

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One person in this company, by userId or by name; several candidates when a name is ambiguous. */
async function findPerson(ctx: SuwiContext, userId: string, name: string) {
  const filter = { org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } };
  if (userId) return { person: await users().findOne({ ...filter, userId } as never, { projection: LIGHT_USER }), candidates: [] };
  const n = norm(name);
  if (!n) return { person: null, candidates: [] };
  const all = await peopleWith<{ userId: string; name: string; department?: string; employeeId?: string }>(ctx.org, ['userId', 'name', 'department', 'employeeId']);
  const exact = all.filter((p) => norm(p.name) === n);
  const loose = exact.length ? exact : all.filter((p) => n.split(' ').every((w) => norm(p.name).includes(w)));
  if (loose.length === 1) return { person: await users().findOne({ ...filter, userId: loose[0].userId } as never, { projection: LIGHT_USER }), candidates: [] };
  return { person: null, candidates: loose.slice(0, 8).map((p) => ({ userId: p.userId, name: p.name, department: p.department ?? null, employeeId: p.employeeId ?? null })) };
}

defineTools({
  name: 'leave_balance',
  area: 'attendance',
  label: (i) => `Leave balance for ${i.name || 'one person'}${i.year ? ` in ${i.year}` : ''}`,
  description: 'One person\'s leave balance per leave type for a year (this year unless given): total entitled, used (approved leave), left, and pending (applied, not yet decided). Give a userId from search_people, or a name. Monthly types show this month\'s figure.',
  input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, year: { type: 'number' } }, required: [] },
  api: { method: 'GET', path: '/admin/leaves' },
  async run(ctx, i) {
    const { person, candidates } = await findPerson(ctx, str(i.userId), str(i.name));
    if (!person) {
      if (candidates.length) return { data: { ambiguous: true, candidates, note: 'Several people match; ask with the userId.' } };
      throw new Error(str(i.userId) || str(i.name) ? 'No one by that name or id in this company' : 'Say whose balance: a name or userId');
    }
    const thisYear = Number(ctx.today.slice(0, 4));
    const year = num(i.year, thisYear, 2000, 2100);
    const rules = await leaveRulesFor(person.userId);
    const asOf = year === thisYear ? new Date(`${ctx.today}T00:00:00Z`) : new Date(Date.UTC(year, year < thisYear ? 11 : 0, year < thisYear ? 31 : 1));
    const balance = await getMyLeaveBalance(person.userId, year, asOf);
    const pending = await leaves().find({ userId: person.userId, status: 'pending', startDate: { $lte: new Date(Date.UTC(year, 11, 31)) }, endDate: { $gte: new Date(Date.UTC(year, 0, 1)) } }).toArray();
    const pendingBy: Record<string, { days: number; count: number }> = {};
    for (const l of pending) { const p = pendingBy[l.type] ?? { days: 0, count: 0 }; p.days += l.days ?? 1; p.count += 1; pendingBy[l.type] = p; }
    return {
      data: {
        userId: person.userId, name: person.name, department: person.department ?? null, year,
        balanceTracked: rules.balanceTracked,
        note: rules.balanceTracked ? 'Used counts approved leave only; pending is applied for and not yet decided, and is not yet taken off the balance.' : 'No balance is tracked for this person\'s team: leave is approved without counting it down.',
        types: balance.types.map((t) => ({
          key: t.key, name: t.name, total: t.total, used: t.used, remaining: t.remaining,
          pendingDays: pendingBy[t.key]?.days ?? 0, pendingRequests: pendingBy[t.key]?.count ?? 0,
          ...((t as { cadence?: string; period?: string }).cadence === 'monthly' ? { cadence: 'monthly', period: (t as { period?: string }).period } : {}),
          // No balance at all: total and remaining mean nothing, used is what was taken (and docked).
          ...((t as { unpaid?: boolean }).unpaid ? { leaveWithoutPay: true, balance: 'unlimited; every approved day is loss of pay' } : {}),
        })),
      },
      links: [{ label: `Open ${person.name.split(' ')[0]}'s requests`, userId: person.userId, tab: 'requests' }, { label: 'Open leave requests', view: 'leave' }],
    };
  },
});

// Setting one person's total for a leave type this year, exactly as Employees ›
// person › Requests › Leave balance does (setLeaveTotal). Taken days are not
// touched and the total cannot go below them; Undo puts the old total back.
type BalanceItem = { key: string; name: string; total: number; used: number; remaining: number; editable?: true; unpaid?: true };
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

defineTools({
  name: 'prepare_set_leave_total',
  area: 'attendance',
  acts: true,
  label: (i) => `Prepared: set ${i.name || 'their'} ${i.type ?? 'leave'} total to ${i.total}`,
  description: 'Prepare setting ONE person\'s total for a leave type this year (Employees › person › Requests › Leave balance). Give userId (or name), the leave type (key or name, as leave_balance shows it) and the new total in whole or half days. Taken leave is not touched; the total cannot go below what is already taken. Changes nothing until HR confirms; Undo puts the old total back.',
  input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', description: 'Leave type key or name' }, total: { type: 'number' } }, required: ['type', 'total'] },
  api: { method: 'PUT', path: '/admin/employees/x/leave-balance/x' },
  async run(ctx, i) {
    const { person, candidates } = await findPerson(ctx, str(i.userId), str(i.name));
    if (!person) {
      if (candidates.length) return { data: { ambiguous: true, candidates, note: 'Several people match; ask with the userId.' } };
      throw new Error('Say whose total: a name or userId');
    }
    const year = Number(ctx.today.slice(0, 4));
    const total = Number(i.total);
    if (!Number.isFinite(total) || total < 0 || total > 366) throw new Error('Enter a total between 0 and 366 days');
    if (Math.round(total * 2) !== total * 2) throw new Error('Use whole or half days');
    const balance = await getMyLeaveBalance(person.userId, year);
    const want = norm(i.type);
    const list = balance.types as BalanceItem[];
    const item = list.find((t) => norm(t.key) === want || norm(t.name) === want) ?? list.find((t) => norm(t.name).includes(want));
    if (!item) throw new Error(`That leave type is not on ${person.name}'s shift template. Their types: ${list.map((t) => t.name).join(', ') || 'none'}`);
    if (item.unpaid) throw new Error('Leave without pay has no total');
    if (!item.editable) throw new Error('This type resets every month, so its total cannot be set');
    if (total < item.used) throw new Error(`${item.used} days are already taken, so the total cannot be less than that`);
    if (total === item.total) return { data: { nothingToDo: true, message: `${person.name}'s ${item.name} total is already ${days(total)} for ${year}.` } };
    const first = person.name.split(' ')[0];
    const title = `Set ${first}'s ${item.name} total for ${year} to ${days(total)}`;
    const proposalId = await propose(ctx, {
      kind: 'set_leave_total', area: 'attendance', title,
      summary: `${item.name} for ${year}: total ${item.total} → ${total}, taken stays ${item.used}, available ${item.remaining} → ${total - item.used}.`,
      lines: [
        { text: `Now: total ${days(item.total)}, taken ${days(item.used)}, available ${days(item.remaining)}.` },
        { text: `After: total ${days(total)}, taken ${days(item.used)}, available ${days(total - item.used)}.`, why: 'Stored as a change on top of the worked-out total, so the months still to be credited add on top. The app, the apply check, exit settlement and the year-end close all read it.' },
        { text: 'Leave already taken is not touched; the total cannot go below it.', tone: 'info' as const },
        { text: `Undo puts the total back to ${days(item.total)}.`, tone: 'info' as const },
      ],
      effectiveFrom: ctx.today, undoable: true,
      preview: { field: `${item.name} ${year}`, rows: [{ name: person.name, current: `${item.total} total, ${item.remaining} available`, next: `${total} total, ${total - item.used} available` }], skipped: [] },
      payload: { byUserId: ctx.userId, userId: person.userId, name: person.name, type: item.key, typeName: item.name, year, from: item.total, to: total },
    });
    return { data: { prepared: true, title, before: { total: item.total, taken: item.used, available: item.remaining }, after: { total, taken: item.used, available: total - item.used }, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: `Open ${first}'s requests`, userId: person.userId, tab: 'requests' }] };
  },
});

const itemOf = (b: Awaited<ReturnType<typeof getMyLeaveBalance>>, key: string) => (b.types as BalanceItem[]).find((t) => t.key === key);

defineExecutor('set_leave_total', {
  async run(p) {
    const { byUserId, userId, name, type, typeName, year, to } = p.payload as { byUserId: string; userId: string; name: string; type: string; typeName: string; year: number; to: number };
    const after = itemOf(await setLeaveTotal(byUserId, userId, type, to, year), type);
    return { message: `${name.split(' ')[0]}'s ${typeName} for ${year}: total ${after?.total ?? to}, taken ${after?.used ?? '?'}, available ${after?.remaining ?? '?'}.` };
  },
  async undo(p) {
    const { byUserId, userId, name, type, typeName, year, from } = p.payload as { byUserId: string; userId: string; name: string; type: string; typeName: string; year: number; from: number };
    const after = itemOf(await setLeaveTotal(byUserId, userId, type, from, year), type);
    return `Put ${name.split(' ')[0]}'s ${typeName} total for ${year} back to ${after?.total ?? from} (available ${after?.remaining ?? '?'}).`;
  },
});
