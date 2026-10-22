// Requests: the waiting pile (leave, overtime, claims), oldest first, from the
// same lists the Requests pages show. Suwi never approves or rejects here.
import { listAllLeavesForAdmin } from '../../services/leave.service';
import { listAllOvertimeForAdmin } from '../../services/overtime.service';
import { listAllReimbursementsForAdmin } from '../../services/reimbursement.service';
import { defineTools, num, str } from '../tools';

const daysSince = (iso: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(iso.slice(0, 10) + 'T00:00:00Z')) / 86_400_000));

defineTools({
  name: 'pending_requests',
  area: 'requests',
  label: (i) => (i.type ? `Pending ${i.type} requests` : 'Everything waiting on HR'),
  description: 'Pending requests waiting for a decision: leave, overtime and reimbursement claims. For each: who, what, dates, days waiting. Optionally one type, or only those waiting at least N days.',
  input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['leave', 'overtime', 'claims'] }, minDaysWaiting: { type: 'number' }, limit: { type: 'number' } } },
  api: { method: 'GET', path: '/admin/leaves' },
  async run(ctx, i) {
    const type = str(i.type);
    const minWait = num(i.minDaysWaiting, 0, 0);
    const out: { type: string; userId: string; name: string; what: string; dates: string; submitted: string; daysWaiting: number }[] = [];
    if (!type || type === 'leave') {
      for (const l of (await listAllLeavesForAdmin(ctx.userId)).filter((x) => x.status === 'pending')) {
        out.push({ type: 'leave', userId: l.userId, name: l.employee.name, what: `${l.typeName}${l.halfDay ? ' (half day)' : ''}, ${l.days} day${l.days === 1 ? '' : 's'}`, dates: l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`, submitted: l.createdAt.slice(0, 10), daysWaiting: daysSince(l.createdAt, ctx.today) });
      }
    }
    if (!type || type === 'overtime') {
      for (const o of (await listAllOvertimeForAdmin(ctx.userId)).filter((x) => x.status === 'pending')) {
        out.push({ type: 'overtime', userId: o.userId, name: o.employee.name, what: `${o.hours} h overtime`, dates: o.workDate, submitted: o.createdAt.slice(0, 10), daysWaiting: daysSince(o.createdAt, ctx.today) });
      }
    }
    if (!type || type === 'claims') {
      for (const c of (await listAllReimbursementsForAdmin(ctx.userId)).filter((x) => x.status === 'pending') as { userId: string; employee: { name: string }; createdAt: string; typeName?: string; category?: string; amountPaise?: number; expenseDate?: string }[]) {
        out.push({ type: 'claim', userId: c.userId, name: c.employee.name, what: `${c.typeName ?? c.category ?? 'Claim'}${typeof c.amountPaise === 'number' ? `, ₹${Math.round(c.amountPaise / 100).toLocaleString('en-IN')}` : ''}`, dates: c.expenseDate ?? '', submitted: c.createdAt.slice(0, 10), daysWaiting: daysSince(c.createdAt, ctx.today) });
      }
    }
    const rows = out.filter((x) => x.daysWaiting >= minWait).sort((a, b) => b.daysWaiting - a.daysWaiting);
    const counts = rows.reduce<Record<string, number>>((m, x) => ({ ...m, [x.type]: (m[x.type] ?? 0) + 1 }), {});
    return {
      data: { total: rows.length, counts, oldest: rows[0] ?? null, rows: rows.slice(0, num(i.limit, 20, 1, 200)) },
      links: [
        ...(!type || type === 'leave' ? [{ label: 'Open leave requests', view: 'leave' }] : []),
        ...(!type || type === 'overtime' ? [{ label: 'Open overtime', view: 'overtime' }] : []),
        ...(!type || type === 'claims' ? [{ label: 'Open reimbursements', view: 'reimbursements' }] : []),
      ],
    };
  },
});
