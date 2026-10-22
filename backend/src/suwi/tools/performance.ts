// Performance: where the review cycle stands (which managers still have
// reviews to send), a KPI by month for a person or a team with the feedback
// texts behind it, and everything a manager needs to draft one person's review.
// Suwi reads scores and the words managers wrote; it never grades anyone
// itself. The one action here reminds managers, through the same notification
// the app's own Friday reminder uses.
import { users } from '../../config/db';
import { User } from '../../models/user.model';
import { listAllFeedbackForAdmin } from '../../services/admin.service';
import { cycleInfoFor, cycleWindow, previousPeriod } from '../../services/cycle';
import { cycleName, feedbackProgress } from '../../services/feedback-notifications.service';
import { assignedParametersFor } from '../../services/kpi.service';
import { notifyUsers } from '../../services/notification.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isPeriod = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
/** "4 Nov 2026" from YYYY-MM-DD. */
const dmy = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

type Person = Pick<User, 'userId' | 'name' | 'designation' | 'department' | 'managerUserId' | 'org' | 'email' | 'lifecycleStatus'>;

async function roster(ctx: SuwiContext): Promise<Person[]> {
  return users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1, managerUserId: 1, org: 1, email: 1, lifecycleStatus: 1 } }).toArray();
}

/** The live cycle, or the one asked for, with its first and last day. */
async function cycleOf(ctx: SuwiContext, period: unknown) {
  const live = await cycleInfoFor(ctx.org);
  const p = isPeriod(period) ? period : live.period;
  const w = cycleWindow(p, live.startDay);
  const start = w.start.toISOString().slice(0, 10);
  const lastDay = addDays(w.end.toISOString().slice(0, 10), -1);
  const daysLeft = Math.max(0, Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000));
  return { period: p, name: cycleName(p), start, lastDay, isLive: p === live.period, next: live.next, daysLeft };
}

/** Everyone with at least one active direct report, with where each stands this cycle. */
async function managersProgress(ctx: SuwiContext, period: string, all: Person[]) {
  const hasReports = new Set(all.map((u) => u.managerUserId).filter(Boolean) as string[]);
  const managers = all.filter((u) => hasReports.has(u.userId)).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(managers.map(async (m) => {
    const { reports, done, pending } = await feedbackProgress(m as User, period);
    return { userId: m.userId, name: m.name, department: m.department ?? null, reports: reports.length, done: done.length, pending: pending.length, pendingFor: pending.map((p) => ({ userId: p.userId, name: p.name })) };
  }));
}

/** Sent reviews for this company, newest first, as the Feedback page lists them. */
async function sentReviews(ctx: SuwiContext) {
  return (await listAllFeedbackForAdmin(ctx.userId)).filter((r) => r.status === 'sent');
}

/** The cycles from `to` back `count` steps, oldest first. */
function periodsBack(to: string, count: number): string[] {
  const out = [to];
  while (out.length < count) out.unshift(previousPeriod(out[0]));
  return out;
}

defineTools(
  {
    name: 'review_progress',
    area: 'performance',
    label: (i) => `Review progress for the ${isPeriod(i.period) ? i.period : 'current'} cycle`,
    description: 'Where the performance review cycle stands: the cycle dates, and for each manager how many of their reports have a sent review and who is still pending. Use for "reviews pending", "which managers still have reviews to do", "how far is the cycle". Default is the cycle in progress; give period YYYY-MM for an earlier one.',
    input_schema: { type: 'object', properties: { period: { type: 'string', description: 'YYYY-MM cycle key' }, manager: { type: 'string', description: "Only this manager (name)" }, onlyPending: { type: 'boolean' } } },
    api: { method: 'GET', path: '/admin/feedback' },
    async run(ctx, i) {
      const cycle = await cycleOf(ctx, i.period);
      const all = await roster(ctx);
      let rows = await managersProgress(ctx, cycle.period, all);
      const mgr = norm(i.manager);
      if (mgr) rows = rows.filter((r) => norm(r.name).includes(mgr));
      if (i.onlyPending) rows = rows.filter((r) => r.pending > 0);
      rows.sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
      const totals = rows.reduce((t, r) => ({ reviewsDue: t.reviewsDue + r.reports, done: t.done + r.done, pending: t.pending + r.pending }), { reviewsDue: 0, done: 0, pending: 0 });
      return {
        data: {
          cycle: { period: cycle.period, name: cycle.name, start: cycle.start, lastDay: cycle.lastDay, daysLeft: cycle.isLive ? cycle.daysLeft : 0, isLive: cycle.isLive },
          totals: { managers: rows.length, managersWithPending: rows.filter((r) => r.pending > 0).length, ...totals },
          managers: rows.slice(0, 40).map((r) => ({ ...r, pendingFor: r.pendingFor.slice(0, 8).map((p) => p.name), morePending: Math.max(0, r.pendingFor.length - 8) })),
          note: rows.length > 40 ? `Showing 40 of ${rows.length} managers` : undefined,
        },
        links: [{ label: 'Open feedback', view: 'feedback' }, { label: 'Open review cycle', view: 'cycle' }],
      };
    },
  },
  {
    name: 'kpi_trend',
    area: 'performance',
    label: (i) => `${i.parameter ? `KPI "${i.parameter}"` : 'Overall review score'} by cycle${i.department ? ` for ${i.department}` : i.manager ? ` for ${i.manager}'s team` : ''}`,
    description: "One KPI parameter (or the overall score when no parameter is given) by review cycle for one person (userId), a department, a manager's team (manager name) or the whole company: the average score each cycle, how many reviews it rests on, the change between cycles, and the feedback texts managers wrote on it. Sent reviews only. Default: the last 6 cycles. Report the texts' themes without judging anyone.",
    input_schema: {
      type: 'object',
      properties: {
        parameter: { type: 'string', description: 'KPI parameter name, e.g. "Communication"; omit for the overall score' },
        userId: { type: 'string' }, department: { type: 'string' }, manager: { type: 'string', description: "Manager's name: their direct reports" },
        to: { type: 'string', description: 'Latest cycle YYYY-MM (default: the cycle in progress)' }, cycles: { type: 'number', description: 'How many cycles back, default 6, max 12' },
      },
    },
    api: { method: 'GET', path: '/admin/feedback' },
    async run(ctx, i) {
      const live = await cycleOf(ctx, undefined);
      const periods = periodsBack(isPeriod(i.to) ? i.to : live.period, num(i.cycles, 6, 1, 12));
      const all = await roster(ctx);
      const byId = new Map(all.map((p) => [p.userId, p]));
      const dep = norm(i.department), mgr = norm(i.manager), uid = str(i.userId);
      const managerIds = mgr ? new Set(all.filter((p) => norm(p.name).includes(mgr)).map((p) => p.userId)) : null;
      const inScope = (p: Person | undefined) => {
        if (!p) return false;
        if (uid) return p.userId === uid;
        if (dep && !norm(p.department).includes(dep)) return false;
        if (managerIds && !managerIds.has(p.managerUserId ?? '')) return false;
        return true;
      };
      const param = norm(i.parameter);
      const reviews = (await sentReviews(ctx)).filter((r) => periods.includes(r.period) && inScope(byId.get(r.employeeUserId)));
      const people = new Set(reviews.map((r) => r.employeeUserId));
      // One score and text per review: the parameter's line, or the overall score and closing note.
      const points = reviews.flatMap((r) => {
        if (!param) return [{ period: r.period, employee: r.employeeName, manager: r.managerName ?? null, score: r.overallScore, text: r.extra }];
        const line = r.parameters.find((p) => norm(p.name) === param) ?? r.parameters.find((p) => norm(p.name).includes(param));
        return line ? [{ period: r.period, employee: r.employeeName, manager: r.managerName ?? null, score: line.score, text: line.note }] : [];
      });
      const byPeriod = periods.map((period) => {
        const ps = points.filter((p) => p.period === period);
        return { period, name: cycleName(period), reviews: ps.length, average: ps.length ? round1(ps.reduce((s, p) => s + p.score, 0) / ps.length) : null };
      });
      const withData = byPeriod.filter((b) => b.average !== null);
      const last = withData.at(-1), prev = withData.at(-2), first = withData[0];
      const texts = points.filter((p) => p.text?.trim()).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 40)
        .map((p) => ({ period: p.period, employee: p.employee, manager: p.manager, score: p.score, text: p.text.trim().slice(0, 300) }));
      return {
        data: {
          parameter: i.parameter ? str(i.parameter) : 'Overall score',
          scope: uid ? byId.get(uid)?.name ?? uid : dep ? `${str(i.department)} department` : mgr ? `${str(i.manager)}'s team` : 'whole company',
          people: people.size, cycles: periods, scale: '0–5',
          byCycle: byPeriod,
          change: last && prev ? { fromPrevious: round1(last.average! - prev.average!), previous: prev.period, latest: last.period } : null,
          changeOverRange: last && first && last !== first ? { from: first.period, to: last.period, change: round1(last.average! - first.average!) } : null,
          feedbackTexts: texts,
          note: points.length > 40 ? `Texts: the 40 most recent of ${points.length}` : points.length === 0 ? 'No sent reviews match' : undefined,
        },
        links: [{ label: 'Open feedback', view: 'feedback' }],
      };
    },
  },
  {
    name: 'review_material',
    area: 'performance',
    label: () => 'Review material: KPIs and feedback for one person',
    description: "Everything behind one person's review, structured: who they are, the KPI parameters (with guidance and weights) they are reviewed on this cycle, any draft their manager has saved, and their sent reviews from earlier cycles with each parameter's score and the manager's note. Use it to draft a review for the manager to edit (the draft is text only; nothing is saved). Find the userId with search_people first.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, period: { type: 'string', description: 'Cycle YYYY-MM, default the one in progress' }, cycles: { type: 'number', description: 'Earlier cycles to include, default 3, max 12' } }, required: ['userId'] },
    api: { method: 'GET', path: '/admin/feedback' },
    async run(ctx, i) {
      const uid = str(i.userId);
      const all = await roster(ctx);
      const person = all.find((p) => p.userId === uid);
      if (!person) throw new Error('No active employee with that userId in this company');
      const cycle = await cycleOf(ctx, i.period);
      const manager = all.find((p) => p.userId === person.managerUserId);
      const assigned = await assignedParametersFor(ctx.org, uid, cycle.period, { fallbackToLatest: true });
      const records = (await listAllFeedbackForAdmin(ctx.userId)).filter((r) => r.employeeUserId === uid);
      const draft = records.find((r) => r.period === cycle.period && r.status === 'saved');
      const thisCycle = records.find((r) => r.period === cycle.period && r.status === 'sent');
      const earlier = periodsBack(previousPeriod(cycle.period), num(i.cycles, 3, 1, 12));
      const view = (r: (typeof records)[number]) => ({
        period: r.period, cycle: cycleName(r.period), manager: r.managerName ?? null, overallScore: r.overallScore,
        parameters: r.parameters.map((p) => ({ name: p.name, weight: p.weight ?? null, score: p.score, note: p.note?.trim().slice(0, 600) || '' })),
        closingNote: r.extra?.trim().slice(0, 600) || '', sentAt: r.sentAt?.slice(0, 10) ?? null,
      });
      return {
        data: {
          person: { userId: person.userId, name: person.name, designation: person.designation ?? null, department: person.department ?? null, manager: manager ? { userId: manager.userId, name: manager.name } : null },
          cycle: { period: cycle.period, name: cycle.name, start: cycle.start, lastDay: cycle.lastDay, isLive: cycle.isLive },
          reviewedOn: assigned.map((p) => ({ parameter: p.title, guidance: p.description, weight: p.weight })),
          assignedNote: assigned.length ? undefined : 'No KPI parameters assigned for this cycle or any earlier one, so a review cannot be given until HR assigns a set.',
          thisCycle: thisCycle ? { status: 'sent', ...view(thisCycle) } : draft ? { status: 'draft (saved, not sent)', ...view(draft) } : null,
          earlierReviews: records.filter((r) => r.status === 'sent' && earlier.includes(r.period)).sort((a, b) => b.period.localeCompare(a.period)).map(view),
          scale: '0–5 per parameter; the overall score is the weighted mean',
          note: 'A draft written from this is for the manager to edit and send in the app; Suwi does not save reviews.',
        },
        links: [{ label: 'Open feedback', view: 'feedback' }, { label: `Open ${person.name.split(' ')[0]}'s profile`, view: 'employees', userId: person.userId }],
      };
    },
  },
  {
    name: 'prepare_remind_managers',
    area: 'performance',
    acts: true,
    label: (i) => {
      const n = Array.isArray(i.managerUserIds) ? i.managerUserIds.length : 0;
      return `Prepared: remind ${n === 1 ? 'a manager' : n ? `${n} managers` : 'managers'} with reviews pending`;
    },
    description: 'Prepare a reminder to managers who still have reviews to send this cycle: an in-app notification (and phone push) like the app\'s own Friday reminder, saying how many are done and pending and the cycle\'s last day. Changes nothing until HR confirms. Default: every manager with something pending; or give managerUserIds from review_progress.',
    input_schema: { type: 'object', properties: { managerUserIds: { type: 'array', items: { type: 'string' } } } },
    api: { method: 'GET', path: '/admin/feedback' },
    async run(ctx, i) {
      // Only the cycle in progress: a reminder about a closed cycle is noise.
      const cycle = await cycleOf(ctx, undefined);
      const all = await roster(ctx);
      const rows = (await managersProgress(ctx, cycle.period, all)).filter((r) => r.pending > 0);
      return prepareReminder(ctx, cycle, rows, i);
    },
  },
);

type Progress = Awaited<ReturnType<typeof managersProgress>>[number];
async function prepareReminder(ctx: SuwiContext, cycle: Awaited<ReturnType<typeof cycleOf>>, rows: Progress[], i: Record<string, unknown>) {
  const only = Array.isArray(i.managerUserIds) ? new Set(i.managerUserIds.map(String)) : null;
  const chosen = only ? rows.filter((r) => only.has(r.userId)) : rows;
  if (!chosen.length) return { data: { nothingToDo: true, message: only ? 'None of those managers has a review pending this cycle.' : `Every manager has sent all their reviews for the ${cycle.name} cycle.` } };
  const who = chosen.length === 1 ? chosen[0].name : `${chosen.length} managers`;
  const title = `Remind ${who} about ${cycle.name} reviews`;
  const proposalId = await propose(ctx, {
    kind: 'remind_managers', area: 'performance', title,
    summary: `Sends ${who} an in-app notification (and a phone push) saying how many of their team's ${cycle.name} reviews are done and pending, and that the cycle's last day is ${dmy(cycle.lastDay)}. No email.`,
    lines: [
      { text: `${chosen.reduce((s, r) => s + r.pending, 0)} reviews pending across ${who}; each manager gets one message.`, why: 'The same wording and route as the app\'s own Friday reminder, so managers see nothing unfamiliar. Only managers with at least one report without a sent review this cycle are included; the counts are worked out again at the moment you confirm, from the reporting line and the sent reviews.' },
      ...chosen.slice(0, 8).map((r) => ({ text: `${r.name}: ${r.done} of ${r.reports} done, ${r.pending} pending (${r.pendingFor.slice(0, 5).map((p) => p.name).join(', ')}${r.pendingFor.length > 5 ? ` and ${r.pendingFor.length - 5} more` : ''}).` })),
      ...(chosen.length > 8 ? [{ text: `And ${chosen.length - 8} more managers.` }] : []),
      { text: `The ${cycle.name} cycle closes on ${dmy(cycle.lastDay)} (${cycle.daysLeft} days left).` },
      { text: 'A sent notification cannot be taken back, so there is no Undo.', tone: 'warn' as const },
    ],
    effectiveFrom: ctx.today, undoable: false, typeToConfirm: chosen.length >= 10 ? String(chosen.length) : undefined,
    payload: { period: cycle.period, lastDay: cycle.lastDay, managerUserIds: chosen.map((r) => r.userId), byUserId: ctx.userId },
  });
  return { data: { prepared: true, title, managers: chosen.map((r) => ({ name: r.name, pending: r.pending })), note: 'Nothing is sent until HR presses Confirm on the card.' }, proposalId };
}

defineExecutor('remind_managers', {
  async run(p) {
    const { period, lastDay, managerUserIds } = p.payload as { period: string; lastDay: string; managerUserIds: string[] };
    const month = cycleName(period).split(' ')[0];
    const due = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${lastDay}T00:00:00Z`));
    const managers = await users().find({ userId: { $in: managerUserIds }, org: p.org, ...ACTIVE } as never).toArray();
    let sent = 0;
    for (const m of managers) {
      // Fresh counts: a manager who finished since the card was prepared hears nothing.
      const { reports, done, pending } = await feedbackProgress(m, period);
      if (!pending.length) continue;
      await notifyUsers([m.userId], {
        scenario: 'feedback_reminder',
        title: `${month} feedback: ${pending.length} still to go`,
        body: `${done.length} of ${reports.length} done. Due ${due}.`,
        data: { destination: 'grow_feedback', period, via: 'suwi' },
      });
      sent += 1;
    }
    const skipped = managerUserIds.length - sent;
    return { message: `Reminded ${sent} manager${sent === 1 ? '' : 's'} about ${cycleName(period)} reviews.${skipped ? ` ${skipped} had nothing pending any more and got no message.` : ''}` };
  },
});
