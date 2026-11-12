/**
 * "Suwi noticed": short nudges worked out from the same lists the dashboard
 * shows, with no model call at all. Each notice names what it saw, why it
 * matters, and the question to ask Suwi to see the detail. Only areas this
 * person can open are looked at, with the same tab rules as the API.
 */
import { connectPosts, relayEvents, reimbursementTypes } from '../config/db';
import { tabsForRequest } from '../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { peopleTasks } from '../services/peopleTasks.service';
import { SuwiContext } from './tools';
import { leaveSafety } from './insight';
import { pendingRows, sharedAdminLists } from './tools/requests';
import { attendanceReport } from '../services/attendance-report.service';

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
/** Minutes past midnight, IST. */
const istMinutes = (d: Date) => { const t = new Date(d.getTime() + 330 * 60_000); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
/** "09:30" → 570; null when unreadable. */
const hhmm = (v: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(v ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
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

const CACHE = new Map<string, { at: number; notices: SuwiNotice[] }>();
const CACHE_MS = 3 * 60_000;

/** The notices for this person, computed at most every three minutes. */
export async function suwiNotices(ctx: SuwiContext, fresh = false): Promise<SuwiNotice[]> {
  const key = `${ctx.org}|${ctx.userId}|${ctx.payroll}|${ctx.today}`;
  const hit = CACHE.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.notices;
  const notices = await computeNotices(ctx);
  CACHE.set(key, { at: Date.now(), notices });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value!);
  return notices;
}

async function computeNotices(ctx: SuwiContext): Promise<SuwiNotice[]> {
  const out: SuwiNotice[] = [];
  const today = ctx.today;
  const seesPeople = hasAllDashboardTabs(ctx.user) || Boolean(ctx.user.dashboardTabs?.includes('employees'));
  // The leave safety checks are the slowest part and need only the pending
  // leave, so they start as soon as the leave list is in rather than after
  // every list (overtime is the slowest): the same leave rows pendingRows
  // gives below, read on their own.
  //
  // The leave and the claims lists are each wanted twice here (the pile, and
  // the safety checks or the claims notice), so each is read once and shared.
  const lists = sharedAdminLists();
  const leaveSafe = quietly(() => pendingRows(ctx, 'leave', lists)).then((rows) => (rows ? quietly(() => leaveSafety(ctx.org, ctx.userId, today, rows)) : null));
  // Every list at once: each is a few round trips to the database.
  // The waiting pile is the same rows pending_requests and review_requests read, so the counts agree.
  const [pending, claims, types, tasks, relay, recent, todayReport] = await Promise.all([
    quietly(() => pendingRows(ctx, '', lists)),
    may(ctx, '/admin/reimbursements') ? quietly(() => lists.claims(ctx.userId)) : null,
    may(ctx, '/admin/reimbursements') ? quietly(() => reimbursementTypes().find({ org: ctx.org }).project<{ name: string; maxLimit: number }>({ name: 1, maxLimit: 1 }).toArray()) : null,
    seesPeople ? quietly(() => peopleTasks(ctx.userId)) : null,
    may(ctx, '/admin/relay') ? quietly(() => relayEvents().countDocuments({ org: ctx.org, status: { $in: ['scheduled', 'live'] } })) : null,
    may(ctx, '/admin/relay') ? quietly(() => connectPosts().countDocuments({ org: ctx.org, systemKey: { $exists: false }, type: { $in: ['relay_game', 'live_game', 'survey', 'event', 'caption_challenge'] }, publishedAt: { $gte: new Date(Date.now() - 14 * DAY) } })) : null,
    may(ctx, '/admin/reports/attendance') ? quietly(() => attendanceReport(ctx.userId, { from: today, to: today })) : null,
  ]);

  // Today: who is on leave, and who should have punched in by now and hasn't.
  // Count 0: these are for reading, not a badge on the sidebar.
  if (todayReport) {
    const nowMin = istMinutes(new Date());
    const onLeave = todayReport.days.filter((d) => d[1] === today && (d[2] === 'on_leave' || d[2] === 'unpaid_leave')).length;
    // A working day graded absent with no punch at all, on a shift that punches
    // (not Auto Punch), once the shift's start and grace have gone by.
    const notIn = todayReport.days.filter((d) => {
      if (d[1] !== today || d[2] !== 'absent' || d[4] || d[5]) return false;
      const p = todayReport.people[d[0]];
      if (!p || /Auto Punch/.test(p.punchFormat)) return false;
      const start = hhmm(p.shiftStart);
      return start !== null && nowMin >= start + (p.lateGraceMinutes ?? 0);
    }).length;
    out.push({
      key: 'today_leave', icon: 'calendar', view: 'attendancereport', count: 0,
      title: onLeave ? `${plural(onLeave, 'person is', 'people are')} on leave today` : 'Nobody is on leave today',
      why: 'Approved leave for today, paid or unpaid.',
      ask: 'Who is on leave today?',
    });
    out.push({
      key: 'today_not_punched', icon: 'clock', view: 'attendancereport', count: 0,
      title: notIn ? `${plural(notIn, 'person has', 'people have')} not punched in today` : 'Everyone due has punched in today',
      why: 'Working today, not on leave, and their shift started (with its grace time) but there is no punch-in yet. Auto Punch shifts are left out.',
      ask: 'Who has not punched in today?',
    });
  }

  // Requests waiting past the limit (every type this person can see, claims included), and leave that looks fine to approve.
  if (pending) {
    const overdueTotal = pending.filter((r) => r.daysWaiting >= ESCALATION_DAYS).length;
    if (overdueTotal > 0) {
      out.push({
        key: 'requests_overdue', icon: 'clock', view: 'leave', count: overdueTotal,
        title: `${plural(overdueTotal, 'request')} waiting ${ESCALATION_DAYS}+ days`,
        why: `Nobody has decided ${overdueTotal === 1 ? 'it' : 'them'} since ${overdueTotal === 1 ? 'it was' : 'they were'} submitted; the person is waiting to plan around it.`,
        ask: `Which requests have been waiting ${ESCALATION_DAYS} days or more?`,
      });
    }

    // Leave that looks fine: the same checks review_requests makes for its safe-to-approve list.
    const easy = (await leaveSafe)?.safe.length ?? 0;
    if (easy > 0) {
      out.push({
        key: 'leave_easy', icon: 'check', view: 'leave', count: easy,
        title: `${plural(easy, 'leave request')} look${easy === 1 ? 's' : ''} fine to approve`,
        why: 'The balance covers the days asked for, nobody else in the same department is already approved for those dates, no manager still has to act, and none is your own.',
        ask: 'Which pending leave requests look fine to approve?',
      });
    }
  }

  // Claims worth a closer look: no receipt, or more than the type's cap.
  if (claims) {
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
  {
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
          why: 'Without a template they are marked on the Default shift, which may not match their hours or weekly offs.',
          ask: 'Who is not on any shift template?',
        });
      }
    }
  }

  // Nothing on the engagement calendar.
  {
    if (relay === 0 && recent === 0) {
      out.push({
        key: 'engagement_quiet', icon: 'spark', view: 'feed', count: 1,
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
