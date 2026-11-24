// Deciding overtime and out-of-location check-ins from Suwi (24 Nov, Suwi training: time). Each tool
// prepares ONE card for one or many pending requests, picked by id, name, work date range or age, so
// "approve the overtime from last week" or "approve yesterday's site visits" is one confirm. Nothing
// changes until HR presses Confirm; the executors call the same services the dashboard's own buttons
// call (adminDecideOvertime, adminDecideRegularization), one request at a time, and report each
// failure instead of stopping. A decision has no inverse in the dashboard, so these cannot be undone.
import { ObjectId } from 'mongodb';
import { adminDecideOvertime } from '../../services/overtime.service';
import { adminDecideRegularization } from '../../services/attendance.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { proposalsCol } from '../store';
import { pendingRows, PendingRow } from './requests';
import { isDate } from './team';

type Item = { id: string; name: string; what: string; dates: string };
const list = (v: unknown, max = 80) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean) : str(v, max) ? [str(v, max)] : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Picks rows from the waiting pile by id, name, work date range or age. Something must narrow it, or `all`. */
export function pickRows(rows: PendingRow[], i: Record<string, unknown>, askerId: string) {
  const want = list(i.ids, 40);
  const who = list(i.names).map((n) => n.toLowerCase());
  const older = num(i.olderThanDays, 0, 0, 3650);
  const from = isDate(i.from) ? i.from : '';
  const to = isDate(i.to) ? i.to : from;
  if (!want.length && !who.length && !older && !from && !i.all) throw new Error('Say which requests: their ids, people\'s names, a work date range (from/to), olderThanDays, or all true for every pending one');
  const skipped: { who: string; reason: string }[] = [];
  let out = rows;
  if (want.length) {
    const set = new Set(want);
    out = out.filter((r) => set.has(r.id));
    for (const id of want) if (!rows.some((r) => r.id === id)) skipped.push({ who: id, reason: 'Not a pending request you can see' });
  }
  if (who.length) out = out.filter((r) => who.some((n) => r.name.toLowerCase().includes(n)));
  if (from) out = out.filter((r) => r.dates.slice(0, 10) >= from && r.dates.slice(0, 10) <= to);
  if (older) out = out.filter((r) => r.daysWaiting > older);
  for (const r of out.filter((x) => x.userId === askerId)) skipped.push({ who: r.name, reason: 'Your own request: another admin has to decide it' });
  return { chosen: out.filter((r) => r.userId !== askerId), skipped };
}

const PICK_PROPS = {
  decision: { type: 'string', enum: ['approved', 'declined'] },
  ids: { type: 'array', items: { type: 'string' }, description: 'Request ids (from pending_requests)' },
  names: { type: 'array', items: { type: 'string' }, description: "People's names: only their pending requests" },
  from: { type: 'string', description: 'YYYY-MM-DD: only requests for work dates from this day (work out "last week", "yesterday" from today)' },
  to: { type: 'string', description: 'YYYY-MM-DD: last work date (defaults to from)' },
  olderThanDays: { type: 'number', description: 'Only requests waiting more than this many days' },
  all: { type: 'boolean', description: 'Every pending request of this kind (names/dates still narrow it)' },
  note: { type: 'string', description: 'Note to the employee, shown with the decision (max 500 characters)' },
};

async function card(ctx: SuwiContext, kind: string, title: string, lines: { text: string; tone?: 'info' | 'warn' }[], payload: Record<string, unknown>, items: Item[], skipped: { who: string; reason: string }[], field: string) {
  const proposalId = await propose(ctx, {
    kind, area: 'requests', title,
    summary: `${title}.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
    lines: [
      ...lines,
      ...(skipped.length ? [{ text: `Left out: ${skipped.length} (listed under the table).`, tone: 'warn' as const }] : []),
      { text: 'This cannot be undone from Suwi: once decided, a request stays decided (the dashboard has no undecide either).', tone: 'warn' },
    ],
    effectiveFrom: ctx.today, undoable: false,
    typeToConfirm: items.length >= 10 ? String(items.length) : undefined,
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
  if (!done) throw new Error(`Nothing was decided: ${failed.slice(0, 3).join('; ')}`);
  return { message: `${verb} ${plural(done, 'request')}.${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
}

const decisionOf = (v: unknown) => (str(v) === 'declined' ? 'declined' : str(v) === 'approved' ? 'approved' : '');

defineTools(
  {
    name: 'prepare_decide_overtime',
    area: 'requests',
    acts: true,
    label: (i) => `Prepared: ${i.decision === 'declined' ? 'decline' : 'approve'} overtime requests`,
    description: 'Prepare ONE card that approves or declines one or MANY pending overtime requests (never one card per request), e.g. "approve the overtime from last week". Pick them by ids (from pending_requests), names, work dates (from/to, YYYY-MM-DD: turn "last week" into dates from today), olderThanDays, or all true. On approval each person gets what they asked for (overtime pay or comp-off) unless compensation is given: "pay" for everyone, or "comp_off" (credited as a half or full day by the overtime claimed; refused for anyone whose shift has no Comp-off leave type). Changes nothing until HR confirms; cannot be undone. Own requests are left out. Not for leave or attendance corrections (prepare_decide_leave, prepare_decide_correction) or out-of-location check-ins (prepare_decide_checkins).',
    input_schema: { type: 'object', properties: { ...PICK_PROPS, compensation: { type: 'string', enum: ['pay', 'comp_off'], description: 'Only when HR says so: overrides each person\'s own choice on approval' } }, required: ['decision'] },
    api: { method: 'PATCH', path: '/admin/overtime/x/decision' },
    async run(ctx, i) {
      const decision = decisionOf(i.decision);
      if (!decision) throw new Error('decision must be approved or declined');
      const note = str(i.note, 500);
      const comp = decision === 'approved' && ['pay', 'comp_off'].includes(str(i.compensation)) ? str(i.compensation) : '';
      const { chosen, skipped } = pickRows(await pendingRows(ctx, 'overtime'), i, ctx.userId);
      if (!chosen.length) return { data: { prepared: false, message: 'No pending overtime request matches.', skipped: skipped.slice(0, 20) } };
      const items = chosen.map((r) => ({ id: r.id, name: r.name, what: r.what, dates: r.dates }));
      const verb = decision === 'approved' ? 'Approve' : 'Decline';
      const hours = chosen.reduce((s, r) => s + (Number(/^([\d.]+) h/.exec(r.what)?.[1]) || 0), 0);
      return card(ctx, 'decide_overtime', `${verb} ${plural(items.length, 'overtime request')}`, [
        { text: `${verb} ${plural(items.length, 'pending overtime request')} from ${plural(new Set(chosen.map((r) => r.userId)).size, 'person', 'people')} (${Math.round(hours * 10) / 10} h in all, listed in the table)${note ? ` with the note "${note}"` : ''}, decided by ${ctx.user.name} as HR.` },
        {
          text: decision === 'declined'
            ? 'Nothing is paid and no comp-off is credited for these days.'
            : comp === 'pay' ? 'Each is paid as overtime in the next payroll run (no comp-off), whatever the person preferred.'
              : comp === 'comp_off' ? 'Each is credited as comp-off (half or full day, by the overtime claimed) to the person\'s Comp-off balance instead of pay. Anyone whose shift has no Comp-off leave type will fail and be reported.'
                : 'Each person gets what they asked for: overtime pay in the next payroll run, or comp-off credited to their Comp-off balance (the table shows each preference).',
          tone: 'info',
        },
        { text: 'Each person gets a notification with the decision.' },
      ], { decision, note, compensation: comp }, items, skipped, decision === 'approved' ? 'Approved' : 'Declined');
    },
  },
  {
    name: 'prepare_decide_checkins',
    area: 'requests',
    acts: true,
    label: (i) => `Prepared: ${i.decision === 'declined' ? 'decline' : 'approve'} out-of-location check-ins`,
    description: 'Prepare ONE card that approves or declines one or MANY pending out-of-location check-ins (OOL check-ins: punches from outside the office, e.g. site or client visits, waiting on a decision), never one card per request. Use for "approve yesterday\'s site visits". Pick them by ids (from pending_requests type checkins), names, work dates (from/to, YYYY-MM-DD), olderThanDays, or all true. Approved: the day counts as worked from the real punch; declined: the day stays as the punches show it (usually absent). Changes nothing until HR confirms; cannot be undone. Own requests are left out. Not for attendance corrections (prepare_decide_correction).',
    input_schema: { type: 'object', properties: PICK_PROPS, required: ['decision'] },
    api: { method: 'PATCH', path: '/admin/regularizations/x/decision' },
    async run(ctx, i) {
      const decision = decisionOf(i.decision);
      if (!decision) throw new Error('decision must be approved or declined');
      const note = str(i.note, 500);
      const { chosen, skipped } = pickRows(await pendingRows(ctx, 'checkins'), i, ctx.userId);
      if (!chosen.length) return { data: { prepared: false, message: 'No pending out-of-location check-in matches.', skipped: skipped.slice(0, 20) } };
      const items = chosen.map((r) => ({ id: r.id, name: r.name, what: r.what.replace(/^Out-of-location check-in: /, ''), dates: r.dates }));
      const verb = decision === 'approved' ? 'Approve' : 'Decline';
      return card(ctx, 'decide_checkins', `${verb} ${plural(items.length, 'out-of-location check-in')}`, [
        { text: `${verb} ${plural(items.length, 'pending out-of-location check-in')} (reason and place listed in the table)${note ? ` with the note "${note}"` : ''}, decided by ${ctx.user.name} as HR.` },
        { text: decision === 'approved' ? 'Each day counts as worked from the punch the person actually made (and their punch-out, if they took one); the report, calendar and payroll follow.' : 'Each day stays as the punches show it: with no punch-in recorded, it is absent unless HR marks it otherwise.', tone: decision === 'approved' ? 'info' : 'warn' },
      ], { decision, note }, items, skipped, decision === 'approved' ? 'Approved' : 'Declined');
    },
  },
);

defineExecutor('decide_overtime', {
  async run(p) {
    const { decision, note, compensation, byUserId, items } = p.payload as { decision: string; note: string; compensation: string; byUserId: string; items: Item[] };
    // A comp-off decision is credited as the full day it can be; the service refuses more than the overtime earned.
    return runEach(items, async (x) => {
      const comp = compensation === 'pay' ? { kind: 'pay' } : compensation === 'comp_off' ? { kind: 'comp_off', days: /full day/.test(x.what) ? 1 : 0.5 } : undefined;
      await adminDecideOvertime(byUserId, x.id, { decision, managerNote: note || undefined, ...(comp ? { compensation: comp } : {}) });
    }, decision === 'approved' ? 'Approved' : 'Declined');
  },
});

defineExecutor('decide_checkins', {
  async run(p) {
    const { decision, note, byUserId, items } = p.payload as { decision: string; note: string; byUserId: string; items: Item[] };
    return runEach(items, (x) => adminDecideRegularization(byUserId, x.id, { decision, managerNote: note || undefined }), decision === 'approved' ? 'Approved' : 'Declined');
  },
});
