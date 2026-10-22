// Requests: the waiting pile (leave, overtime, attendance corrections,
// out-of-location check-ins, claims), oldest first, from the same lists the
// Requests pages show. Each type is only included when this person has that
// page. Suwi never approves or rejects here.
import { listAllLeavesForAdmin } from '../../services/leave.service';
import { listAllOvertimeForAdmin } from '../../services/overtime.service';
import { listAllRegularizationsForAdmin } from '../../services/attendance.service';
import { listAllReimbursementsForAdmin } from '../../services/reimbursement.service';
import { defineTools, num, str } from '../tools';
import { daysWaiting, INSIGHT_ROUTE, mayRead } from '../insight';

export type PendingRow = { type: 'leave' | 'overtime' | 'correction' | 'checkin' | 'claim'; id: string; userId: string; name: string; department?: string; what: string; dates: string; submitted: string; daysWaiting: number; manager?: string };

/** Every pending request this person may see, newest last. */
export async function pendingRows(ctx: { userId: string; today: string; user: { dashboardAdmin?: boolean; dashboardTabs?: string[] } }, type: string): Promise<PendingRow[]> {
  const out: PendingRow[] = [];
  const day = (d: Date | string | number | undefined) => (d == null ? '' : new Date(d).toISOString().slice(0, 10));
  const want = (t: string, route: string) => (!type || type === t) && mayRead(ctx.user, route);
  const wantRegs = want('corrections', INSIGHT_ROUTE.correction) || want('checkins', INSIGHT_ROUTE.ool);
  // The four lists are independent; fetch them side by side.
  const [leaveList, otList, regList, claimList] = await Promise.all([
    want('leave', INSIGHT_ROUTE.leave) ? listAllLeavesForAdmin(ctx.userId) : null,
    want('overtime', INSIGHT_ROUTE.overtime) ? listAllOvertimeForAdmin(ctx.userId) : null,
    wantRegs ? listAllRegularizationsForAdmin(ctx.userId) : null,
    want('claims', INSIGHT_ROUTE.claim) ? listAllReimbursementsForAdmin(ctx.userId) : null,
  ]);
  if (leaveList) {
    for (const l of leaveList.filter((x) => x.status === 'pending')) {
      out.push({ type: 'leave', id: l.id, userId: l.userId, name: l.employee.name, department: l.employee.department, what: `${l.typeName}${l.halfDay ? ' (half day)' : ''}, ${l.days} day${l.days === 1 ? '' : 's'}`, dates: l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`, submitted: day(l.createdAt), daysWaiting: daysWaiting(l.createdAt, ctx.today) });
    }
  }
  if (otList) {
    for (const o of otList.filter((x) => x.status === 'pending')) {
      out.push({ type: 'overtime', id: o.id, userId: o.userId, name: o.employee.name, department: o.employee.department, what: `${o.hours} h overtime (${o.duration === 'full_day' ? 'full day' : 'half day'})`, dates: o.workDate, submitted: day(o.createdAt), daysWaiting: daysWaiting(o.createdAt, ctx.today) });
    }
  }
  if (regList) {
    const DAY_TYPE: Record<string, string> = { full_day: 'full day', half_day: 'half day', wfh: 'work from home', client_visit: 'client visit', office_visit: 'client visit', leave: 'leave' };
    for (const r of regList.filter((x) => x.status === 'pending')) {
      const ool = r.kind === 'out_of_location';
      if (ool ? !want('checkins', INSIGHT_ROUTE.ool) : !want('corrections', INSIGHT_ROUTE.correction)) continue;
      out.push({
        type: ool ? 'checkin' : 'correction', id: r.id ?? '', userId: r.userId, name: r.employee.name, department: r.employee.department, manager: r.manager || undefined,
        what: ool ? `Out-of-location check-in: ${r.outsideLocation?.reason ?? 'away'}${r.outsideLocation?.place ? `, ${r.outsideLocation.place}` : ''}` : `Attendance correction: mark as ${DAY_TYPE[r.requestedDayType ?? ''] ?? 'corrected'}`,
        dates: r.workDate, submitted: day(r.createdAt), daysWaiting: daysWaiting(r.createdAt, ctx.today),
      });
    }
  }
  if (claimList) {
    for (const c of claimList.filter((x) => x.status === 'pending')) {
      out.push({ type: 'claim', id: c.id, userId: c.userId, name: c.employee.name, department: c.employee.department, what: `${c.category} claim, ₹${Math.round(c.amount).toLocaleString('en-IN')}`, dates: c.expenseDate, submitted: day(c.createdAt), daysWaiting: daysWaiting(c.createdAt, ctx.today) });
    }
  }
  return out;
}

export const REQUEST_LINKS: Record<string, { label: string; view: string }> = {
  leave: { label: 'Open leave requests', view: 'leave' },
  overtime: { label: 'Open overtime', view: 'overtime' },
  corrections: { label: 'Open attendance corrections', view: 'attendance' },
  checkins: { label: 'Open OOL check-ins', view: 'oolcheckins' },
  claims: { label: 'Open reimbursements', view: 'reimbursements' },
};

defineTools({
  name: 'pending_requests',
  area: 'requests',
  label: (i) => (i.type ? `Pending ${i.type === 'checkins' ? 'out-of-location check-ins' : i.type === 'corrections' ? 'attendance corrections' : String(i.type)}` : 'Everything waiting on a decision'),
  description: 'Pending requests waiting for a decision: leave, overtime, attendance corrections, out-of-location check-ins (checkins) and reimbursement claims. For each: who, what, dates, days waiting. Optionally one type, or only those waiting at least N days. Use review_requests for what is overdue or safe to approve.',
  input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['leave', 'overtime', 'corrections', 'checkins', 'claims'] }, minDaysWaiting: { type: 'number' }, limit: { type: 'number' } } },
  api: { method: 'GET', path: '/admin/leaves' },
  async run(ctx, i) {
    const type = str(i.type);
    const minWait = num(i.minDaysWaiting, 0, 0);
    const rows = (await pendingRows(ctx, type)).filter((x) => x.daysWaiting >= minWait).sort((a, b) => b.daysWaiting - a.daysWaiting);
    const counts = rows.reduce<Record<string, number>>((m, x) => ({ ...m, [x.type]: (m[x.type] ?? 0) + 1 }), {});
    return {
      data: { total: rows.length, counts, oldest: rows[0] ?? null, rows: rows.slice(0, num(i.limit, 20, 1, 200)) },
      links: Object.entries(REQUEST_LINKS).filter(([k]) => !type || type === k).map(([, l]) => l),
    };
  },
});
