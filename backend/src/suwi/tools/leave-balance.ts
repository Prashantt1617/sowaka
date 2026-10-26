// Leave balance: one person's balance per leave type for a year, from the
// same balance the app shows them. Approved leave counts as used; pending
// leave is shown separately so HR can see what is still waiting on a decision.
import { leaves, users } from '../../config/db';
import { getMyLeaveBalance } from '../../services/leave.service';
import { leaveRulesFor } from '../../services/shift.service';
import { defineTools, num, str, SuwiContext } from '../tools';

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One person in this company, by userId or by name; several candidates when a name is ambiguous. */
async function findPerson(ctx: SuwiContext, userId: string, name: string) {
  const filter = { org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } };
  if (userId) return { person: await users().findOne({ ...filter, userId } as never), candidates: [] };
  const n = norm(name);
  if (!n) return { person: null, candidates: [] };
  const all = await users().find(filter as never, { projection: { _id: 0, userId: 1, name: 1, department: 1, employeeId: 1 } }).toArray();
  const exact = all.filter((p) => norm(p.name) === n);
  const loose = exact.length ? exact : all.filter((p) => n.split(' ').every((w) => norm(p.name).includes(w)));
  if (loose.length === 1) return { person: await users().findOne({ ...filter, userId: loose[0].userId } as never), candidates: [] };
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
