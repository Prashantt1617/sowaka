/**
 * "Suwi noticed": short nudges worked out from the same lists the dashboard
 * shows, with no model call at all. Each notice names what it saw, why it
 * matters, and the question to ask Suwi to see the detail. Only areas this
 * person can open are looked at, with the same tab rules as the API.
 */
import { connectPosts, relayEvents, reimbursementTypes } from '../config/db';
import { tabsForRequest } from '../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { getMyLeaveBalance, listAllLeavesForAdmin } from '../services/leave.service';
import { listAllOvertimeForAdmin } from '../services/overtime.service';
import { listAllRegularizationsForAdmin } from '../services/attendance.service';
import { listAllReimbursementsForAdmin } from '../services/reimbursement.service';
import { peopleTasks } from '../services/peopleTasks.service';
import { SuwiContext } from './tools';

/** Days a request may wait before Suwi calls it overdue (Sowaka has no escalation setting of its own). */
export const ESCALATION_DAYS = 3;

export interface SuwiNotice {
  key: string;
  /** A key the dashboard maps to a glyph: clock, check, rupee, receipt, spark, calendar. */
  icon: 'clock' | 'check' | 'rupee' | 'receipt' | 'spark' | 'calendar';
  title: string;
  why: string;
  /** The question to put to Suwi to see the detail. */
  ask: string;
  /** The dashboard view the notice is about, for the sidebar badge. */
  view: string;
  count: number;
}

const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / DAY);
const iso = (v: Date | string | undefined) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The same check the tools make: may this person read this dashboard API? */
function may(ctx: SuwiContext, path: string): boolean {
  if (hasAllDashboardTabs(ctx.user)) return true;
  const needed = tabsForRequest('GET', path);
  if (needed === null) return true;
  const mine = new Set(ctx.user.dashboardTabs ?? []);
  return needed.some((tab) => mine.has(tab));
}

async function quietly<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch { return null; }
}

export async function suwiNotices(ctx: SuwiContext): Promise<SuwiNotice[]> {
  const out: SuwiNotice[] = [];
  const today = ctx.today;

  // Requests waiting past the limit, and leave that looks fine to approve.
  if (may(ctx, '/admin/leaves')) {
    const leaves = (await quietly(() => listAllLeavesForAdmin(ctx.userId))) ?? [];
    const pending = leaves.filter((l) => l.status === 'pending');
    const overdue = pending.filter((l) => daysBetween(l.createdAt, today) >= ESCALATION_DAYS).length;
    let overdueTotal = overdue;
    if (may(ctx, '/admin/overtime')) {
      const ot = (await quietly(() => listAllOvertimeForAdmin(ctx.userId))) ?? [];
      overdueTotal += ot.filter((o) => o.status === 'pending' && daysBetween(iso(o.createdAt), today) >= ESCALATION_DAYS).length;
    }
    if (may(ctx, '/admin/regularizations')) {
      const corr = (await quietly(() => listAllRegularizationsForAdmin(ctx.userId))) ?? [];
      overdueTotal += corr.filter((c) => c.status === 'pending' && daysBetween(iso((c as { createdAt?: Date | string }).createdAt), today) >= ESCALATION_DAYS).length;
    }
    if (overdueTotal > 0) {
      out.push({
        key: 'requests_overdue', icon: 'clock', view: 'leave', count: overdueTotal,
        title: `${plural(overdueTotal, 'request')} waiting ${ESCALATION_DAYS}+ days`,
        why: `Nobody has decided ${overdueTotal === 1 ? 'it' : 'them'} since ${overdueTotal === 1 ? 'it was' : 'they were'} submitted; the person is waiting to plan around it.`,
        ask: `Which requests have been waiting ${ESCALATION_DAYS} days or more?`,
      });
    }

    // Leave that looks fine: enough balance, and nobody else in the team already off those days.
    const approved = leaves.filter((l) => l.status === 'approved');
    let easy = 0;
    const balances = new Map<string, Awaited<ReturnType<typeof getMyLeaveBalance>> | null>();
    for (const l of pending.slice(0, 40)) {
      const year = Number(l.startDate.slice(0, 4));
      const k = `${l.userId}|${year}`;
      if (!balances.has(k)) balances.set(k, await quietly(() => getMyLeaveBalance(l.userId, year)));
      const bal = balances.get(k);
      const type = bal?.types.find((t) => t.key === l.type);
      if (!type || type.remaining < l.days) continue;
      const clash = approved.some((a) => a.userId !== l.userId && a.employee.department && a.employee.department === l.employee.department && a.startDate <= l.endDate && a.endDate >= l.startDate);
      if (!clash) easy++;
    }
    if (easy > 0) {
      out.push({
        key: 'leave_easy', icon: 'check', view: 'leave', count: easy,
        title: `${plural(easy, 'leave request')} look${easy === 1 ? 's' : ''} fine to approve`,
        why: 'The balance covers the days asked for, and nobody else in the same department is already approved for those dates.',
        ask: 'Which pending leave requests look fine to approve?',
      });
    }
  }

  // Claims worth a closer look: no receipt, or more than the type's cap.
  if (may(ctx, '/admin/reimbursements')) {
    const claims = (await quietly(() => listAllReimbursementsForAdmin(ctx.userId))) ?? [];
    const types = await quietly(() => reimbursementTypes().find({ org: ctx.org }).project<{ name: string; maxLimit: number }>({ name: 1, maxLimit: 1 }).toArray());
    const cap = new Map((types ?? []).map((t) => [t.name.toLowerCase(), t.maxLimit]));
    const check = claims.filter((c) => c.status === 'pending' && (!c.hasReceipt || ((cap.get(String(c.category).toLowerCase()) ?? 0) > 0 && c.amount > (cap.get(String(c.category).toLowerCase()) ?? 0))));
    if (check.length) {
      const noReceipt = check.filter((c) => !c.hasReceipt).length;
      out.push({
        key: 'claims_check', icon: 'receipt', view: 'reimbursements', count: check.length,
        title: `${plural(check.length, 'claim')} to check before approving`,
        why: [noReceipt ? `${plural(noReceipt, 'claim has', 'claims have')} no receipt attached` : '', check.length - noReceipt ? `${plural(check.length - noReceipt, 'is', 'are')} over the type's cap` : ''].filter(Boolean).join('; ') + '.',
        ask: 'Which pending claims have no receipt or are over the limit?',
      });
    }
  }

  // People who would hold up payroll, and people on no shift.
  if (hasAllDashboardTabs(ctx.user) || ctx.user.dashboardTabs?.includes('employees')) {
    const tasks = await quietly(() => peopleTasks(ctx.userId));
    if (tasks) {
      if (ctx.payroll && tasks.payroll) {
        const blockers = tasks.people.filter((p) => p.tasks.some((t) => t.key === 'salary' || t.key === 'bank'));
        if (blockers.length) {
          out.push({
            key: 'payroll_blockers', icon: 'rupee', view: 'peopletasks', count: blockers.length,
            title: `${plural(blockers.length, 'person', 'people')} would block payroll`,
            why: 'No salary template, CTC, bank account, IFSC or PAN: the run cannot pay them until it is filled in.',
            ask: 'Who is missing salary, bank or PAN details before payroll can run?',
          });
        }
      }
      const noShift = tasks.people.filter((p) => p.tasks.some((t) => t.key === 'shift'));
      if (noShift.length) {
        out.push({
          key: 'no_shift', icon: 'calendar', view: 'peopletasks', count: noShift.length,
          title: `${plural(noShift.length, 'person', 'people')} on no shift template`,
          why: 'Without a template they are marked on the Default shift next week, which may not match their hours or weekly offs.',
          ask: 'Who is not on any shift template?',
        });
      }
    }
  }

  // Nothing on the engagement calendar.
  if (may(ctx, '/admin/relay')) {
    const [relay, recent] = await Promise.all([
      quietly(() => relayEvents().countDocuments({ org: ctx.org, status: { $in: ['scheduled', 'live'] } })),
      quietly(() => connectPosts().countDocuments({ org: ctx.org, systemKey: { $exists: false }, type: { $in: ['relay_game', 'live_game', 'survey', 'event', 'caption_challenge'] }, publishedAt: { $gte: new Date(Date.now() - 14 * DAY) } })),
    ]);
    if (relay === 0 && recent === 0) {
      out.push({
        key: 'engagement_quiet', icon: 'spark', view: 'engagementposts', count: 1,
        title: 'Nothing scheduled for engagement',
        why: 'No Relay game is scheduled and no engagement post went out in the last two weeks.',
        ask: 'What could we run for engagement this month?',
      });
    }
  }

  return out;
}

/** Sidebar badge counts by view, from the notices. */
export function noticeCounts(notices: SuwiNotice[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const n of notices) m[n.view] = (m[n.view] ?? 0) + n.count;
  return m;
}
