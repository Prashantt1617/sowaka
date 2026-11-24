// Deciding requests from Suwi (24 Nov, HR asked that Suwi can do what the dashboard does: until now
// Suwi could list the waiting pile but not decide it). Three tools, each preparing ONE card for one or
// many requests: approve/decline leave, approve/decline attendance corrections, and HR cancelling an
// approved leave or answering an employee's cancellation request. Nothing changes until HR presses
// Confirm; the executors call the same services the dashboard routes call, one request at a time, and
// collect each failure instead of stopping. Decisions cannot be undone from the card (the dashboard has
// no "undecide" either), and the card says so.
import { ObjectId } from 'mongodb';
import { leaves, users } from '../../config/db';
import { adminCancelLeave, adminDecideLeave, decideLeaveCancellation } from '../../services/leave.service';
import { adminDecideRegularization } from '../../services/attendance.service';
import { defineTools, num, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { proposalsCol } from '../store';
import { pendingRows, PendingRow } from './requests';

type Item = { id: string; name: string; what: string; dates: string };
const ids = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 40)).filter(Boolean) : []);
const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 80).toLowerCase()).filter(Boolean) : str(v, 80) ? [str(v, 80).toLowerCase()] : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Picks rows from the waiting pile by id, name or age. `all` must be set to take everything. */
function pick(rows: PendingRow[], i: Record<string, unknown>, ctxUserId: string) {
  const want = ids(i.ids ?? i.leaveIds ?? i.correctionIds);
  const who = names(i.names ?? i.name);
  const older = num(i.olderThanDays, 0, 0, 3650);
  if (!want.length && !who.length && !older && !i.all) throw new Error('Say which requests: their ids, people\'s names, olderThanDays, or all true for every pending one');
  const skipped: { who: string; reason: string }[] = [];
  let out = rows;
  if (want.length) {
    const set = new Set(want);
    out = out.filter((r) => set.has(r.id));
    for (const id of want) if (!rows.some((r) => r.id === id)) skipped.push({ who: id, reason: 'Not a pending request you can see' });
  }
  if (who.length) out = out.filter((r) => who.some((n) => r.name.toLowerCase().includes(n)));
  if (older) out = out.filter((r) => r.daysWaiting > older);
  const mine = out.filter((r) => r.userId === ctxUserId);
  for (const r of mine) skipped.push({ who: r.name, reason: 'Your own request: another admin has to decide it' });
  return { chosen: out.filter((r) => r.userId !== ctxUserId), skipped };
}

const DECISION = { type: 'string', enum: ['approved', 'declined'] };
const PICK_PROPS = {
  names: { type: 'array', items: { type: 'string' }, description: "People's names: only their pending requests" },
  olderThanDays: { type: 'number', description: 'Only requests waiting more than this many days' },
  all: { type: 'boolean', description: 'Every pending request of this kind (with names/olderThanDays narrowing it)' },
  note: { type: 'string', description: 'Note to the employee, shown with the decision (max 500 characters)' },
};

async function card(
  ctx: Parameters<Parameters<typeof defineTools>[0]['run']>[0],
  kind: string, title: string, lines: { text: string; tone?: 'info' | 'warn' }[], payload: Record<string, unknown>,
  items: Item[], skipped: { who: string; reason: string }[], field: string,
) {
  const proposalId = await propose(ctx, {
    kind, area: 'requests', title,
    summary: `${title}.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
    lines: [
      ...lines,
      ...(skipped.length ? [{ text: `Left out: ${skipped.length} (listed under the table).`, tone: 'warn' as const }] : []),
      { text: 'This cannot be undone from Suwi: once decided, a request stays decided (an approved leave can still be cancelled later).', tone: 'warn' },
    ],
    effectiveFrom: ctx.today, undoable: false,
    payload: { ...payload, byUserId: ctx.userId, items },
  });
  await proposalsCol().updateOne({ _id: new ObjectId(proposalId) }, {
    $set: { preview: { field, rows: items.slice(0, 300).map((x) => ({ name: x.name, current: `${x.what}, ${x.dates}`, next: field })), skipped: skipped.slice(0, 100) } },
  });
  return {
    data: { prepared: true, title, requests: items.length, leftOut: skipped.length, skippedSample: skipped.slice(0, 5), note: 'Nothing is decided until HR presses Confirm on the card. HR sees every request in the card\'s table: do not list them.' },
    proposalId,
  };
}

async function runEach(items: Item[], fn: (x: Item) => Promise<unknown>, verb: string) {
  const failed: string[] = [];
  for (const x of items) {
    try { await fn(x); } catch (e) { failed.push(`${x.name}, ${x.dates} (${(e as Error).message})`); }
  }
  const done = items.length - failed.length;
  return { message: `${verb} ${plural(done, 'request')}.${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
}

defineTools(
  {
    name: 'prepare_decide_leave',
    area: 'requests',
    acts: true,
    label: (i) => `Prepared: ${i.decision === 'declined' ? 'decline' : 'approve'} leave requests`,
    description: 'Prepare ONE card that approves or declines one or MANY pending leave requests (never one card per request). Pick them by ids (from pending_requests), names, olderThanDays, or all true. Changes nothing: the card lists each request (who, type, dates, days) and what the decision does to their balance; HR confirms once. Own requests are left out.',
    input_schema: { type: 'object', properties: { decision: DECISION, ids: { type: 'array', items: { type: 'string' }, description: 'Leave request ids' }, ...PICK_PROPS }, required: ['decision'] },
    api: { method: 'PATCH', path: '/admin/leaves/x/decision' },
    async run(ctx, i) {
      const decision = str(i.decision) === 'declined' ? 'declined' : str(i.decision) === 'approved' ? 'approved' : '';
      if (!decision) throw new Error('decision must be approved or declined');
      const note = str(i.note, 500);
      const { chosen, skipped } = pick(await pendingRows(ctx, 'leave'), i, ctx.userId);
      if (!chosen.length) return { data: { prepared: false, message: 'No pending leave request matches.', skipped: skipped.slice(0, 20) } };
      const items = chosen.map((r) => ({ id: r.id, name: r.name, what: r.what, dates: r.dates }));
      const verb = decision === 'approved' ? 'Approve' : 'Decline';
      return card(ctx, 'decide_leave', `${verb} ${plural(items.length, 'leave request')}`, [
        { text: `${verb} ${plural(items.length, 'pending leave request')} (listed in the table)${note ? ` with the note "${note}"` : ''}, decided by ${ctx.user.name} as HR.` },
        { text: decision === 'approved' ? 'Balance: each approved leave is taken from that person\'s balance of its type (unpaid leave becomes loss of pay), and the days show as leave on the calendar and in payroll.' : 'Balance: nothing is taken; the days held for these requests go back to each person\'s balance.', tone: 'info' },
      ], { decision, note }, items, skipped, decision === 'approved' ? 'Approved' : 'Declined');
    },
  },
  {
    name: 'prepare_decide_correction',
    area: 'requests',
    acts: true,
    label: (i) => `Prepared: ${i.decision === 'declined' ? 'decline' : 'approve'} attendance corrections`,
    description: 'Prepare ONE card that approves or declines one or MANY pending attendance corrections (regularizations), never one card per request. Pick them by ids (from pending_requests), names, olderThanDays, or all true. Out-of-location check-ins are included only when checkins is true. Changes nothing until HR confirms. Own requests are left out.',
    input_schema: { type: 'object', properties: { decision: DECISION, ids: { type: 'array', items: { type: 'string' }, description: 'Correction request ids' }, checkins: { type: 'boolean', description: 'Decide out-of-location check-ins instead of corrections' }, ...PICK_PROPS }, required: ['decision'] },
    api: { method: 'PATCH', path: '/admin/regularizations/x/decision' },
    async run(ctx, i) {
      const decision = str(i.decision) === 'declined' ? 'declined' : str(i.decision) === 'approved' ? 'approved' : '';
      if (!decision) throw new Error('decision must be approved or declined');
      const note = str(i.note, 500);
      const { chosen, skipped } = pick(await pendingRows(ctx, i.checkins ? 'checkins' : 'corrections'), i, ctx.userId);
      if (!chosen.length) return { data: { prepared: false, message: 'No pending correction matches.', skipped: skipped.slice(0, 20) } };
      const items = chosen.map((r) => ({ id: r.id, name: r.name, what: r.what, dates: r.dates }));
      const verb = decision === 'approved' ? 'Approve' : 'Decline';
      const what = i.checkins ? 'out-of-location check-in' : 'attendance correction';
      return card(ctx, 'decide_correction', `${verb} ${plural(items.length, what)}`, [
        { text: `${verb} ${plural(items.length, `pending ${what}`)} (listed in the table)${note ? ` with the note "${note}"` : ''}, decided by ${ctx.user.name} as HR.` },
        { text: decision === 'approved' ? 'Each day is recorded as asked (the report, calendar and payroll follow).' : 'Each day stays as the punches show it.', tone: 'info' },
      ], { decision, note }, items, skipped, decision === 'approved' ? 'Approved' : 'Declined');
    },
  },
  {
    name: 'prepare_cancel_leave',
    area: 'requests',
    acts: true,
    label: (i) => (i.action === 'cancel' ? 'Prepared: cancel leave' : `Prepared: ${i.action === 'decline_cancellation' ? 'decline' : 'approve'} cancellation requests`),
    description: "Prepare ONE card for leave cancellations. action cancel: HR cancels approved (or pending) leaves for someone (by leave ids, or names + from/to dates). action approve_cancellation / decline_cancellation: answer employees' requests to cancel an approved leave (by ids, names, or all true). Changes nothing until HR confirms.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['cancel', 'approve_cancellation', 'decline_cancellation'] },
        ids: { type: 'array', items: { type: 'string' }, description: 'Leave ids' },
        names: { type: 'array', items: { type: 'string' } },
        from: { type: 'string', description: 'YYYY-MM-DD: leaves overlapping this range (with to)' }, to: { type: 'string' },
        all: { type: 'boolean', description: 'Every waiting cancellation request (approve/decline only)' },
        note: { type: 'string' },
      },
      required: ['action'],
    },
    api: { method: 'POST', path: '/admin/leaves/x/cancel' },
    async run(ctx, i) {
      const action = str(i.action);
      if (!['cancel', 'approve_cancellation', 'decline_cancellation'].includes(action)) throw new Error('action must be cancel, approve_cancellation or decline_cancellation');
      const note = str(i.note, 500);
      const want = ids(i.ids).filter((x) => ObjectId.isValid(x));
      const who = names(i.names);
      const from = str(i.from), to = str(i.to) || from;
      if (!want.length && !who.length && !i.all) throw new Error('Say which leaves: ids, names (with from/to for cancel), or all true for every waiting cancellation request');
      if (action === 'cancel' && !want.length && !from) throw new Error('To cancel by name, give the dates (from, to) of the leave');
      const people = await users().find({ org: ctx.org }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
      const nameOf = new Map(people.map((u) => [u.userId, u.name ?? u.userId]));
      const scope = who.length ? people.filter((u) => who.some((n) => (u.name ?? '').toLowerCase().includes(n))).map((u) => u.userId) : [...nameOf.keys()];
      const q: Record<string, unknown> = { userId: { $in: scope } };
      if (want.length) q._id = { $in: want.map((x) => new ObjectId(x)) };
      if (action === 'cancel') {
        q.status = { $in: ['approved', 'pending'] };
        if (from) { q.startDate = { $lte: new Date(`${to}T23:59:59.999Z`) }; q.endDate = { $gte: new Date(`${from}T00:00:00.000Z`) }; }
      } else { q.status = 'approved'; q['cancelRequest.status'] = 'pending'; }
      const rows = await leaves().find(q).sort({ startDate: 1 }).limit(300).toArray();
      const skipped: { who: string; reason: string }[] = [];
      const items: Item[] = [];
      for (const l of rows) {
        const name = nameOf.get(l.userId) ?? l.userId;
        if (l.userId === ctx.userId) { skipped.push({ who: name, reason: 'Your own leave: another admin has to' }); continue; }
        const s = l.startDate.toISOString().slice(0, 10), e = l.endDate.toISOString().slice(0, 10);
        items.push({ id: l._id!.toHexString(), name, what: `${l.type}${l.halfDay ? ' (half day)' : ''}, ${l.days ?? '?'} day${l.days === 1 ? '' : 's'} (${l.status})`, dates: s === e ? s : `${s} to ${e}` });
      }
      for (const id of want) if (!rows.some((l) => l._id!.toHexString() === id)) skipped.push({ who: id, reason: action === 'cancel' ? 'Not an approved or pending leave in your company' : 'No waiting cancellation request on this leave' });
      if (!items.length) return { data: { prepared: false, message: 'No leave matches.', skipped: skipped.slice(0, 20) } };
      const title = action === 'cancel' ? `Cancel ${plural(items.length, 'leave')}` : `${action === 'approve_cancellation' ? 'Approve' : 'Decline'} ${plural(items.length, 'cancellation request')}`;
      const effect = action === 'decline_cancellation'
        ? 'Each leave stays approved and keeps counting against the balance.'
        : 'Each leave is cancelled: its days go back to the person\'s balance and the calendar and payroll stop counting them. Leaves in a month whose payroll is locked cannot be cancelled and will be reported.';
      return card(ctx, 'cancel_leave', title, [
        { text: `${title} (listed in the table)${note ? ` with the note "${note}"` : ''}, by ${ctx.user.name} as HR.` },
        { text: effect, tone: 'info' },
      ], { action, note }, items, skipped, action === 'decline_cancellation' ? 'Stays approved' : 'Cancelled');
    },
  },
);

defineExecutor('decide_leave', {
  async run(p) {
    const { decision, note, byUserId, items } = p.payload as { decision: string; note: string; byUserId: string; items: Item[] };
    return runEach(items, (x) => adminDecideLeave(byUserId, x.id, { decision, managerNote: note || undefined }), decision === 'approved' ? 'Approved' : 'Declined');
  },
});

defineExecutor('decide_correction', {
  async run(p) {
    const { decision, note, byUserId, items } = p.payload as { decision: string; note: string; byUserId: string; items: Item[] };
    return runEach(items, (x) => adminDecideRegularization(byUserId, x.id, { decision, managerNote: note || undefined }), decision === 'approved' ? 'Approved' : 'Declined');
  },
});

defineExecutor('cancel_leave', {
  async run(p) {
    const { action, note, byUserId, items } = p.payload as { action: string; note: string; byUserId: string; items: Item[] };
    if (action === 'cancel') return runEach(items, (x) => adminCancelLeave(byUserId, x.id, { note: note || undefined }), 'Cancelled');
    const decision = action === 'approve_cancellation' ? 'approved' : 'declined';
    return runEach(items, (x) => decideLeaveCancellation(byUserId, x.id, { decision, note: note || undefined }, 'admin'), decision === 'approved' ? 'Approved the cancellation of' : 'Declined the cancellation of');
  },
});
