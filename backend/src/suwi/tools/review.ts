// Requests review: what is overdue, what is waiting on which manager, and
// which leave requests look safe to approve (enough balance, no clash in the
// team, HR's turn to decide). Plus the first action in this area: reminding
// the managers who haven't acted, with the same push and inbox entry Sowaka
// sends them on Tuesdays and Thursdays. A notification can't be unsent, so
// the card says so and offers no Undo.
import { ObjectId } from 'mongodb';
import { leaves, users } from '../../config/db';
import { notifyUsers } from '../../services/notification.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { Check, leaveChecks, managerStepCheck, OVERDUE_DAYS, ownRequestCheck } from '../insight';
import { pendingRows, PendingRow, REQUEST_LINKS } from './requests';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STEP_KIND = { leave: 'leave', overtime: 'overtime', correction: 'correction', checkin: 'correction' } as const;

/** Each pending request with whose call it is: a manager who hasn't acted, or HR. */
async function withApprover(ctx: SuwiContext, rows: PendingRow[]) {
  const people = await users().find({ org: ctx.org, userId: { $in: [...new Set(rows.map((r) => r.userId))] } }).toArray();
  const byId = new Map(people.map((p) => [p.userId, p]));
  const cache = new Map<string, Promise<Check & { managerUserId?: string; managerName?: string }>>();
  return Promise.all(rows.map(async (r) => {
    const employee = byId.get(r.userId);
    if (r.type === 'claim' || !employee) return { ...r, waitingOn: 'HR' as const, managerUserId: undefined as string | undefined, managerName: undefined as string | undefined };
    const key = `${r.userId}|${STEP_KIND[r.type]}`;
    if (!cache.has(key)) cache.set(key, managerStepCheck(employee, STEP_KIND[r.type], r.submitted, ctx.today));
    const step = await cache.get(key)!;
    return { ...r, waitingOn: step.managerUserId ? ('manager' as const) : ('HR' as const), managerUserId: step.managerUserId, managerName: step.managerName };
  }));
}

/** Managers with requests waiting on them: how many, the oldest, which kinds. */
function byManager(rows: Awaited<ReturnType<typeof withApprover>>) {
  const groups = new Map<string, { managerUserId: string; manager: string; count: number; oldestDays: number; leave: number; overtime: number; attendance: number }>();
  for (const r of rows) {
    if (!r.managerUserId) continue;
    const g = groups.get(r.managerUserId) ?? { managerUserId: r.managerUserId, manager: r.managerName ?? 'Manager', count: 0, oldestDays: 0, leave: 0, overtime: 0, attendance: 0 };
    g.count += 1; g.oldestDays = Math.max(g.oldestDays, r.daysWaiting);
    if (r.type === 'leave') g.leave += 1; else if (r.type === 'overtime') g.overtime += 1; else g.attendance += 1;
    groups.set(r.managerUserId, g);
  }
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays);
}

defineTools(
  {
    name: 'review_requests',
    area: 'requests',
    label: (i) => `Requests overdue, waiting on managers and safe to approve${i.overdueDays ? ` (${i.overdueDays}-day limit)` : ''}`,
    description: `Review the pending pile: what is past the overdue limit (${OVERDUE_DAYS} days unless given; Sowaka has no escalation setting, managers are only reminded on Tuesdays and Thursdays), which managers have requests waiting on them, and which pending leave requests look safe to approve: enough balance this year, nobody in the same department off on overlapping dates, HR's turn to decide (no manager who still hasn't acted), and not the asker's own request. Each leave not on the safe list comes with what to check first. Optionally one type.`,
    input_schema: { type: 'object', properties: { overdueDays: { type: 'number', description: `Days after which a request counts as overdue; default ${OVERDUE_DAYS}` }, type: { type: 'string', enum: ['leave', 'overtime', 'corrections', 'checkins', 'claims'] }, limit: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/leaves' },
    async run(ctx, i) {
      const limit = num(i.overdueDays, OVERDUE_DAYS, 1, 365);
      const type = str(i.type);
      const rows = await withApprover(ctx, await pendingRows(ctx, type));
      rows.sort((a, b) => b.daysWaiting - a.daysWaiting);
      const show = num(i.limit, 15, 1, 100);
      const brief = (r: (typeof rows)[number]) => ({ type: r.type, id: r.id, userId: r.userId, name: r.name, what: r.what, dates: r.dates, daysWaiting: r.daysWaiting, waitingOn: r.waitingOn === 'manager' ? r.managerName : 'HR' });
      const overdue = rows.filter((r) => r.daysWaiting >= limit);
      const counts = rows.reduce<Record<string, number>>((m, x) => ({ ...m, [x.type]: (m[x.type] ?? 0) + 1 }), {});

      // Leave: the full checks, on the raw rows, for the safe-to-approve list.
      const safe: (ReturnType<typeof brief> & { checks: string[] })[] = [];
      const checkFirst: (ReturnType<typeof brief> & { issues: string[] })[] = [];
      const leaveRows = rows.filter((r) => r.type === 'leave' && ObjectId.isValid(r.id)).slice(0, 40);
      if (leaveRows.length) {
        const docs = await leaves().find({ _id: { $in: leaveRows.map((r) => new ObjectId(r.id)) } }).toArray();
        const people = new Map((await users().find({ org: ctx.org, userId: { $in: leaveRows.map((r) => r.userId) } }).toArray()).map((p) => [p.userId, p]));
        for (const r of leaveRows) {
          const doc = docs.find((d) => d._id.toHexString() === r.id);
          const employee = people.get(r.userId);
          if (!doc || !employee) continue;
          const checks = [...(r.userId === ctx.userId ? [ownRequestCheck] : []), ...(await leaveChecks(doc, employee, ctx.today, limit))];
          if (checks.every((c) => c.ok)) safe.push({ ...brief(r), checks: checks.map((c) => c.text) });
          else checkFirst.push({ ...brief(r), issues: checks.filter((c) => !c.ok).map((c) => c.text) });
        }
      }
      return {
        data: {
          overdueLimitDays: limit,
          note: `Sowaka has no escalation setting: nothing moves to HR by itself; approvers get a reminder on Tuesdays and Thursdays. Overdue here means waiting ${limit} days or more.`,
          total: rows.length, counts,
          overdue: { count: overdue.length, rows: overdue.slice(0, show).map(brief) },
          waitingOnManagers: byManager(rows),
          waitingOnHr: rows.filter((r) => r.waitingOn === 'HR').length,
          ...(!type || type === 'leave' ? { leave: { safeToApprove: safe.slice(0, show), checkFirst: checkFirst.slice(0, show), checked: leaveRows.length, note: 'Safe means: balance covers it, no one in the same department is on approved leave for those dates, and it is HR\'s turn to decide. HR still decides.' } } : {}),
        },
        links: Object.entries(REQUEST_LINKS).filter(([k]) => !type || type === k).map(([, l]) => l),
      };
    },
  },
  {
    name: 'prepare_remind_managers',
    area: 'requests',
    acts: true,
    label: (i) => `Prepared: remind ${i.managerName ? String(i.managerName) : 'the managers'} about requests waiting on them`,
    description: `Prepare a reminder to the managers who have pending leave, overtime or attendance requests waiting on them for at least N days (default ${OVERDUE_DAYS}). Changes nothing: it creates a "What will happen" card for HR to confirm. Each manager then gets the same push and inbox entry Sowaka sends on Tuesdays and Thursdays ("N requests waiting on you"). Optionally one manager by name. Cannot be undone once sent.`,
    input_schema: { type: 'object', properties: { minDaysWaiting: { type: 'number', description: `Only managers with a request waiting at least this many days; default ${OVERDUE_DAYS}. 0 means everyone with anything pending.` }, managerName: { type: 'string' } } },
    api: { method: 'POST', path: '/admin/leaves/remind' },
    async run(ctx, i) {
      const minDays = num(i.minDaysWaiting, OVERDUE_DAYS, 0, 365);
      const wanted = str(i.managerName).toLowerCase();
      const rows = await withApprover(ctx, await pendingRows(ctx, ''));
      // Not the person asking: they can open their own inbox.
      const groups = byManager(rows).filter((g) => g.managerUserId !== ctx.userId && g.oldestDays >= minDays && (!wanted || g.manager.toLowerCase().includes(wanted)));
      if (!groups.length) return { data: { nothingToDo: true, message: wanted ? `No pending request is waiting on a manager called "${str(i.managerName)}"${minDays ? ` for ${minDays} days or more` : ''}.` : `No manager has a request waiting ${minDays ? `${minDays} days or more` : 'on them'}.` } };
      const parts = (g: (typeof groups)[number]) => [g.leave ? `${g.leave} leave` : '', g.overtime ? `${g.overtime} overtime` : '', g.attendance ? `${g.attendance} attendance` : ''].filter(Boolean).join(', ');
      const who = groups.length === 1 ? groups[0].manager : `${groups.length} managers`;
      const proposalId = await propose(ctx, {
        kind: 'remind_managers', area: 'requests', title: `Remind ${who} about requests waiting on them`,
        summary: `${groups.length === 1 ? `${groups[0].manager} gets` : `${groups.length} managers each get`} a push and an inbox entry saying how many requests are waiting on them, the oldest from ${Math.max(...groups.map((g) => g.oldestDays))} days ago. Nothing is approved or declined.`,
        lines: [
          ...groups.slice(0, 8).map((g) => ({ text: `${g.manager}: ${plural(g.count, 'request')} (${parts(g)}), oldest ${plural(g.oldestDays, 'day')}.`, why: 'These are their team\'s pending requests where the policy makes the reporting manager the approver, so only they, or an HR override, can close them.' })),
          ...(groups.length > 8 ? [{ text: `and ${groups.length - 8} more managers.` }] : []),
          { text: 'Each gets a push to their phone and an inbox entry: "N requests waiting on you", opening their inbox.', why: 'The same reminder Sowaka sends every Tuesday and Thursday at 14:00; this sends it now, once.' },
          { text: 'Cannot be undone: a notification can\'t be unsent.', tone: 'warn' as const },
        ],
        effectiveFrom: ctx.today, undoable: false, typeToConfirm: groups.length >= 5 ? String(groups.length) : undefined,
        payload: { byUserId: ctx.userId, dateKey: ctx.today, reminders: groups.map((g) => ({ managerUserId: g.managerUserId, manager: g.manager, count: g.count, leave: g.leave, overtime: g.overtime, attendance: g.attendance, oldestDays: g.oldestDays })) },
      });
      return { data: { prepared: true, title: `Remind ${who}`, managers: groups.map((g) => ({ manager: g.manager, requests: g.count, oldestDays: g.oldestDays })), note: 'Nothing is sent until HR presses Confirm on the card. It cannot be undone afterwards.' }, proposalId };
    },
  },
);

defineExecutor('remind_managers', {
  async run(p) {
    const { dateKey, reminders } = p.payload as { dateKey: string; reminders: { managerUserId: string; manager: string; count: number; leave: number; overtime: number; attendance: number; oldestDays: number }[] };
    const sent: string[] = [];
    for (const r of reminders) {
      const parts = [r.leave ? `${r.leave} leave` : '', r.overtime ? `${r.overtime} overtime` : '', r.attendance ? `${r.attendance} attendance` : '', r.oldestDays ? `oldest ${plural(r.oldestDays, 'day')} ago` : ''].filter(Boolean);
      await notifyUsers([r.managerUserId], {
        scenario: 'pending_requests_reminder',
        title: `${r.count} ${r.count === 1 ? 'request' : 'requests'} waiting on you`,
        body: parts.join(' · '),
        data: { destination: 'manage_leave', type: 'leave', view: 'inbox', dateKey, via: 'suwi' },
      });
      sent.push(r.manager);
    }
    return { message: `Reminded ${sent.length === 1 ? sent[0] : `${sent.length} managers (${sent.slice(0, 5).join(', ')}${sent.length > 5 ? '…' : ''})`}.` };
  },
});
