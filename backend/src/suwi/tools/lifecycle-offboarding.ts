// Offboarding (employee lifecycle, 24 Nov Suwi training): "Who is leaving and what is pending?" from
// the Offboarding board, and one card to accept a resignation with a last day, move the last day,
// release someone early, tick clearance items or close an exit. Each runs the same service as the
// Offboarding page (services/lifecycle/resignations.ts, offboarding.ts) as the HR person confirming.
// Notice comes from the person's own offer letter (noticeDaysForUser, fixed when they resigned): Suwi
// never asks for or sets notice pay or a recovery (leaving early is paid for the days worked).
import { resignations, users } from '../../config/db';
import type { Resignation } from '../../models/lifecycle.model';
import type { User, UserExit } from '../../models/user.model';
import { clearanceOf } from '../../services/exit.service';
import { changeLastDay, closeOffboarding, dashboardActor, offboardingBoard, setOffboardingClearance } from '../../services/lifecycle/offboarding';
import { acceptResignation } from '../../services/lifecycle/resignations';
import { noticeDaysForUser } from '../../services/lifecycle/templates';
import { defineExecutor, propose } from '../proposals';
import { defineTools, str, SuwiContext } from '../tools';
import { dayText, isDay, lifecycleOff, namesOf, plural } from './lifecycle-common';
import { findPerson, norm, roster } from './people';

const OFFBOARDING_LINK = { label: 'Open Offboarding', view: 'offboarding' };
const TABS = ['resignations', 'notice', 'exit'] as const;
const OPEN: Resignation['status'][] = ['with_manager', 'with_hr'];
const TEAM_LABEL: Record<string, string> = { manager: 'Manager', it: 'IT', admin: 'Admin', finance: 'Finance' };

defineTools({
  name: 'lifecycle_offboarding_board',
  area: 'people',
  label: () => 'Offboarding board',
  description: 'The Offboarding board (employee lifecycle): everyone leaving, from a resignation not yet accepted to the settlement, with their stage, exit type, last day, the next step and who holds it (late or not), and the clearance items still open (laptop, ID card, advances, handover). Use for "Who is leaving and what is pending?", "Whose last day is this week?", "What is waiting on HR?". includeClosed adds exits closed in the last 90 days. To act use prepare_offboarding_step.',
  input_schema: {
    type: 'object',
    properties: {
      stage: { type: 'string', enum: [...TABS], description: 'resignations (not yet accepted), notice (serving notice), exit (last day and after); default all' },
      name: { type: 'string', description: 'Only people whose name, ID, team or role matches' },
      waitingOnHr: { type: 'boolean', description: 'Only those whose next step is HR\'s' },
      includeClosed: { type: 'boolean' },
    },
  },
  api: { method: 'GET', path: '/admin/lifecycle/offboarding/board' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const tabs = TABS.includes(str(i.stage) as (typeof TABS)[number]) ? [str(i.stage) as (typeof TABS)[number]] : [...TABS];
    const boards = await Promise.all(tabs.map((tab) => offboardingBoard(ctx.userId, { tab, ...(str(i.name) ? { q: str(i.name) } : {}) })));
    let cards = boards.flatMap((b) => b.columns.flatMap((c) => c.cards.map((card) => ({ ...card, columnLabel: c.label }))));
    if (!i.includeClosed) cards = cards.filter((c) => c.column !== 'closed');
    if (i.waitingOnHr) cards = cards.filter((c) => c.waitingOnHr);
    const viewer = boards[0]?.viewer;
    const exits = cards.length ? await users().find({ org: ctx.org, userId: { $in: cards.map((c) => c.userId) }, exit: { $exists: true } }, { projection: { _id: 0, userId: 1, exit: 1 } }).toArray() : [];
    const openItems = new Map(exits.map((u) => [u.userId, clearanceOf(u.exit as UserExit)
      .filter((c) => !c.done && (viewer?.kind === 'hr' || (viewer?.kind === 'team' && c.team === viewer.team)))
      .map((c) => `${c.label} (${TEAM_LABEL[c.team ?? 'manager'] ?? c.team})`)]));
    const rows = cards.map((c) => ({
      userId: c.userId, name: c.name, role: c.designation || null, department: c.department || null, stage: c.columnLabel, exitType: c.exitTypeLabel,
      lastDay: c.tl, lastDayLine: c.lastDayLine, nextStep: c.nextStep, holder: c.owner.name ?? c.owner.role, due: c.due, late: c.late, waitingOnHr: c.waitingOnHr,
      clearanceOpen: openItems.get(c.userId) ?? [],
    }));
    return {
      data: {
        leaving: rows.length, waitingOnHr: boards.reduce((n, b) => Math.max(n, b.waitingOnHr), 0), counts: boards[0]?.counts,
        people: rows.slice(0, 60), ...(rows.length > 60 ? { more: rows.length - 60 } : {}),
        note: 'Notice periods come from each person\'s offer letter. Leaving early is paid for the days worked: no notice pay and nothing recovered.',
      },
      tables: rows.length ? [{
        title: 'Leaving', columns: ['Name', 'Stage', 'Last day', 'Next step', 'With', 'Clearance open'],
        rows: rows.slice(0, 200).map((r) => [r.name, r.stage, dayText(r.lastDay), `${r.nextStep}${r.late ? ' (late)' : ''}`, String(r.holder), r.clearanceOpen.join(', ') || '—']),
      }] : undefined,
      links: [OFFBOARDING_LINK],
    };
  },
});

// ─── prepare_offboarding_step ───────────────────────────────────────────────

const ACTIONS = ['accept_resignation', 'change_last_day', 'release_early', 'tick_clearance', 'close_exit'] as const;
type Action = (typeof ACTIONS)[number];
type Leaver = Pick<User, 'userId' | 'name' | 'employeeId' | 'managerUserId' | 'exit' | 'joiningDate'>;

/** People leaving: an open resignation or a recorded exit (even after their access ended). */
async function leavers(ctx: SuwiContext): Promise<{ people: Leaver[]; open: Map<string, Resignation> }> {
  const open = await resignations().find({ org: ctx.org, status: { $in: OPEN } }, { projection: { _id: 0 } }).toArray() as Resignation[];
  const people = await users().find(
    { org: ctx.org, $or: [{ exit: { $exists: true } }, { userId: { $in: open.map((r) => r.userId) } }] },
    { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, managerUserId: 1, exit: 1, joiningDate: 1 } },
  ).toArray() as Leaver[];
  return { people, open: new Map(open.map((r) => [r.userId, r])) };
}

function pickLeaver(people: Leaver[], ref: unknown): Leaver {
  const r = str(ref, 120);
  if (!r) throw new Error('Say who: the person\'s name');
  const exact = people.find((p) => p.userId === r || (p.employeeId ?? '').toLowerCase() === r.toLowerCase());
  if (exact) return exact;
  const n = norm(r);
  const full = people.filter((p) => norm(p.name) === n);
  if (full.length === 1) return full[0];
  const partial = full.length ? full : people.filter((p) => norm(p.name).split(' ').includes(n) || norm(p.name).includes(n));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`Nobody called "${r}" has resigned or has an exit recorded. To start an exit for someone who has not resigned, use the Offboarding page's Start an exit.`);
  throw new Error(`More than one leaver matches "${r}": ${partial.slice(0, 6).map((p) => p.name).join(', ')}. Ask which one.`);
}

defineTools({
  name: 'prepare_offboarding_step',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${String(i.action ?? 'offboarding').replace(/_/g, ' ')} for ${str(i.person) || 'a leaver'}`,
  description: 'Prepare ONE card for someone leaving (employee lifecycle, Offboarding). action accept_resignation: HR accepts their resignation with lastDay (YYYY-MM-DD; default the day their manager agreed, else the last day by notice) ("Accept Simran\'s resignation with 23 Jan as last day"); newManager when people report to them. action change_last_day: move the last day (an unaccepted resignation is accepted with it). action release_early: let them go before the notice ends (lastDay earlier than the last day by notice). action tick_clearance: mark clearance items done (or done false to open them again): items by label, e.g. "Laptop", "ID card", "Advances", "Work handed over". action close_exit: close the exit once the settlement is emailed. The notice period comes from the person\'s offer letter: never ask for it, and never ask about or set notice pay or recovery (leaving early is paid for the days worked, nothing recovered). Changes nothing until HR confirms.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...ACTIONS] },
      person: { type: 'string', description: 'The leaver\'s name, employee ID or userId' },
      lastDay: { type: 'string', description: 'YYYY-MM-DD' },
      newManager: { type: 'string', description: 'accept: who their reports move to (name), when they lead a team' },
      items: { type: 'array', items: { type: 'string' }, description: 'tick_clearance: clearance item labels or keys' },
      done: { type: 'boolean', description: 'tick_clearance: false opens the items again (default true)' },
      note: { type: 'string', description: 'HR\'s note (accept, close): never shown to the employee' },
    },
    required: ['action', 'person'],
  },
  api: { method: 'POST', path: '/admin/lifecycle/resignations/x/accept' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    let action = str(i.action) as Action;
    if (!ACTIONS.includes(action)) throw new Error(`action is one of ${ACTIONS.join(', ')}`);
    const actor = await dashboardActor(ctx.userId);
    if (actor.viewer.kind !== 'hr' && action !== 'tick_clearance') return { data: { prepared: false, message: 'Only HR (an admin, or someone with People › Employees) can do this on an exit.' } };
    const { people, open } = await leavers(ctx);
    if (actor.teamIds) people.splice(0, people.length, ...people.filter((p) => actor.teamIds!.has(p.userId)));
    const p = pickLeaver(people, i.person);
    const first = p.name.split(' ')[0];
    const note = str(i.note, 1000);
    const lastDay = str(i.lastDay, 10);
    if (lastDay && !isDay(lastDay)) throw new Error('lastDay is YYYY-MM-DD');
    const resignation = open.get(p.userId);
    const e = p.exit;

    // An unaccepted resignation: a new last day (or an early release) is its acceptance.
    if (!e && resignation && (action === 'change_last_day' || action === 'release_early')) action = 'accept_resignation';
    if (action === 'accept_resignation') {
      if (!resignation) return { data: { prepared: false, message: e ? `${p.name}'s exit is already recorded (last day ${dayText(e.lastWorkingDay)}). Use change_last_day to move it.` : `${p.name} has no resignation waiting.` }, links: [OFFBOARDING_LINK] };
      const day = lastDay || resignation.manager?.date || resignation.lastDayByNotice;
      const sent = new Date(resignation.submittedAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      if (day < sent) throw new Error(`The last day cannot be before the resignation (${dayText(sent)})`);
      if (str(i.action) === 'release_early' && day >= resignation.lastDayByNotice) throw new Error(`An early release is before the last day by notice (${dayText(resignation.lastDayByNotice)}): give an earlier lastDay`);
      const all = await roster(ctx);
      const reports = all.filter((x) => x.managerUserId === p.userId);
      let newManagerUserId: string | undefined;
      let newManagerName: string | undefined;
      if (str(i.newManager)) { const m = await findPerson(ctx, i.newManager, all); newManagerUserId = m.userId; newManagerName = m.name; }
      if (reports.length && !newManagerUserId) {
        return { data: { prepared: false, needs: 'newManager', message: `${plural(reports.length, 'person reports', 'people report')} to ${p.name} (${reports.slice(0, 6).map((x) => x.name).join(', ')}). Ask who they report to after ${first} leaves, then prepare again with newManager.` } };
      }
      const early = day < resignation.lastDayByNotice;
      const asked = resignation.manager ? (resignation.manager.action === 'accept' ? `${resignation.manager.byName} accepted it` : `${resignation.manager.byName} asked for ${dayText(resignation.manager.date)}${resignation.manager.action === 'release_early' ? ' (early release)' : ''}`) : 'their manager has not answered yet';
      const title = `Accept ${p.name}'s resignation`;
      const proposalId = await propose(ctx, {
        kind: 'lifecycle_offboarding', area: 'people', title,
        summary: `${p.name}'s last working day is ${dayText(day)}${early ? ' (released early)' : ''}.`,
        lines: [
          { text: `Accepts ${p.name}'s resignation of ${dayText(sent)} (${resignation.reason}); ${asked}. Last working day: ${dayText(day)}.` },
          { text: `Notice: ${resignation.noticeDays} days from their offer letter, so the last day by notice is ${dayText(resignation.lastDayByNotice)}.${early ? ` ${dayText(day)} is earlier: an early release, paid for the days worked, with no notice pay and nothing recovered.` : ''}`, tone: 'info', why: 'The notice period is the one in their offer letter (60 days when it does not say); it only sets the suggested last day.' },
          { text: `The exit is recorded and offboarding starts: ${first} sees the Off-boarding page in the app, the manager is asked for the handover checklist, and IT, Admin and Finance get their clearance items.${newManagerName ? ` ${plural(reports.length, 'person', 'people')} reporting to ${first} move to ${newManagerName} the day after the last day.` : ''}` },
          { text: 'Cannot be undone from Suwi: the last day can still be moved (change_last_day).', tone: 'warn' },
        ],
        effectiveFrom: day, undoable: false,
        payload: { hrUserId: ctx.userId, action: 'accept_resignation', userId: p.userId, name: p.name, resignationId: resignation.id, lastWorkingDay: day, ...(note ? { note } : {}), ...(newManagerUserId ? { newManagerUserId } : {}) },
      });
      return { data: { prepared: true, title, lastDay: day, noticeDays: resignation.noticeDays, lastDayByNotice: resignation.lastDayByNotice, note: 'Nothing changes until HR confirms.' }, proposalId, links: [OFFBOARDING_LINK] };
    }

    if (!e) return { data: { prepared: false, message: `${p.name} has no exit recorded yet${resignation ? ': accept the resignation first' : ''}.` }, links: [OFFBOARDING_LINK] };

    if (action === 'change_last_day' || action === 'release_early') {
      if (!lastDay) throw new Error('Give the new last day (lastDay, YYYY-MM-DD)');
      if (e.accessEndedAt) return { data: { prepared: false, message: `${p.name} has already left; the last day can no longer move.` } };
      if (lastDay === e.lastWorkingDay) return { data: { prepared: false, message: `${p.name}'s last day is already ${dayText(lastDay)}.` } };
      const byNotice = e.noticeFrom && e.noticeDays != null
        ? new Date(Date.parse(`${e.noticeFrom}T00:00:00Z`) + e.noticeDays * 86_400_000).toISOString().slice(0, 10)
        : null;
      if (action === 'release_early' && byNotice && lastDay >= byNotice) throw new Error(`An early release is before the last day by notice (${dayText(byNotice)}): give an earlier lastDay`);
      const notice = e.noticeDays ?? await noticeDaysForUser(ctx.org, p.userId);
      const early = !!byNotice && lastDay < byNotice;
      const title = `Move ${p.name}'s last day to ${dayText(lastDay)}`;
      const proposalId = await propose(ctx, {
        kind: 'lifecycle_offboarding', area: 'people', title,
        summary: `${p.name}'s last working day moves from ${dayText(e.lastWorkingDay)} to ${dayText(lastDay)}.`,
        lines: [
          { text: `${p.name}'s last working day moves from ${dayText(e.lastWorkingDay)} to ${dayText(lastDay)}; every open offboarding task dated from the last day moves with it, and ${first} and their manager are told.` },
          { text: `Notice: ${notice} days${byNotice ? `, so the last day by notice is ${dayText(byNotice)}` : ''}.${early ? ' The new day is earlier: an early release, paid for the days worked, with no notice pay and nothing recovered.' : ''}`, tone: 'info' },
          { text: `Undo moves it back to ${dayText(e.lastWorkingDay)} (while ${first} has not left).`, tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        preview: { field: 'Last working day', rows: [{ name: p.name, current: dayText(e.lastWorkingDay), next: dayText(lastDay) }], skipped: [] },
        payload: { hrUserId: ctx.userId, action: 'change_last_day', userId: p.userId, name: p.name, lastWorkingDay: lastDay, previous: e.lastWorkingDay },
      });
      return { data: { prepared: true, title, note: 'Nothing changes until HR confirms.' }, proposalId, links: [OFFBOARDING_LINK] };
    }

    if (action === 'tick_clearance') {
      const done = i.done !== false;
      const list = clearanceOf(e);
      const wanted = namesOf(i.items).map((x) => norm(x));
      if (!wanted.length) throw new Error(`Say which clearance items: ${list.map((c) => c.label).join(', ')}`);
      const mine = (team: string | undefined) => actor.viewer.kind === 'hr' || (actor.viewer.kind === 'team' && actor.viewer.team === team);
      const picked = list.filter((c) => wanted.some((w) => norm(c.key) === w || norm(c.label).includes(w) || w.split(' ').some((word) => word.length > 2 && norm(c.label).split(' ').includes(word))));
      const rows = picked.filter((c) => c.done !== done && mine(c.team)).map((c) => ({ name: c.label, current: c.done ? 'Done' : 'Open', next: done ? 'Done' : 'Open' }));
      const skipped = [
        ...picked.filter((c) => c.done === done).map((c) => ({ who: c.label, reason: done ? 'Already done' : 'Already open' })),
        ...picked.filter((c) => c.done !== done && !mine(c.team)).map((c) => ({ who: c.label, reason: `${TEAM_LABEL[c.team ?? 'manager']}'s item, not yours to tick` })),
        ...wanted.filter((w) => !picked.some((c) => norm(c.key) === w || norm(c.label).includes(w) || w.split(' ').some((word) => word.length > 2 && norm(c.label).split(' ').includes(word)))).map((w) => ({ who: w, reason: `Not on ${first}'s clearance list (${list.map((c) => c.label).join(', ')})` })),
      ];
      if (!rows.length) return { data: { prepared: false, message: 'No clearance item to change.', skipped } };
      const keys = picked.filter((c) => c.done !== done && mine(c.team)).map((c) => ({ key: c.key, label: c.label, was: c.done }));
      const title = `${done ? 'Tick' : 'Open again'} ${plural(keys.length, 'clearance item')} for ${p.name}`;
      const proposalId = await propose(ctx, {
        kind: 'lifecycle_offboarding', area: 'people', title,
        summary: `${keys.map((k) => k.label).join(', ')}: ${done ? 'done' : 'open again'}.`,
        lines: [
          { text: `On ${p.name}'s clearance list, ${keys.map((k) => k.label).join(', ')} ${keys.length === 1 ? 'is' : 'are'} marked ${done ? 'done' : 'not done'} by ${ctx.user.name}. When a team's items are all done, its offboarding task (handover, asset return, finance clearance) closes too.` },
          { text: 'Undo puts each item back as it was.', tone: 'info' },
        ],
        effectiveFrom: ctx.today, undoable: true,
        preview: { field: 'Clearance', rows, skipped },
        payload: { hrUserId: ctx.userId, action: 'tick_clearance', userId: p.userId, name: p.name, done, keys },
      });
      return { data: { prepared: true, title, leftOut: skipped, note: 'Nothing changes until HR confirms.' }, proposalId, links: [OFFBOARDING_LINK] };
    }

    // close_exit
    if (!e.offboarding?.journeyId) return { data: { prepared: false, message: `${p.name}'s exit closes when its settlement is marked paid (People › Exits).` } };
    if (!e.offboarding.settlementEmail) return { data: { prepared: false, blocked: 'Email the settlement PDF before closing the exit', message: `${p.name}'s final settlement has not been emailed yet. Email it from Offboarding › ${first} › Settlement, then close the exit.` }, links: [OFFBOARDING_LINK] };
    const title = `Close ${p.name}'s exit`;
    const proposalId = await propose(ctx, {
      kind: 'lifecycle_offboarding', area: 'people', title,
      summary: `${p.name}'s offboarding is closed.`,
      lines: [
        { text: `Closes ${p.name}'s offboarding (last day ${dayText(e.lastWorkingDay)}; settlement emailed ${dayText(new Date(e.offboarding.settlementEmail.at).toISOString().slice(0, 10))}). Their card moves to Closed; any task still open on it is closed with it.` },
        { text: 'Cannot be undone from Suwi.', tone: 'warn' },
      ],
      effectiveFrom: ctx.today, undoable: false,
      payload: { hrUserId: ctx.userId, action: 'close_exit', userId: p.userId, name: p.name, ...(note ? { note } : {}) },
    });
    return { data: { prepared: true, title, note: 'Nothing changes until HR confirms.' }, proposalId, links: [OFFBOARDING_LINK] };
  },
});

type Payload = {
  hrUserId: string; action: Action; userId: string; name: string; resignationId?: string; lastWorkingDay?: string; previous?: string;
  note?: string; newManagerUserId?: string; done?: boolean; keys?: Array<{ key: string; label: string; was: boolean }>;
};

defineExecutor('lifecycle_offboarding', {
  async run(p) {
    const x = p.payload as Payload;
    if (x.action === 'accept_resignation') {
      await acceptResignation(x.hrUserId, x.resignationId!, { lastWorkingDay: x.lastWorkingDay, ...(x.note ? { note: x.note } : {}), ...(x.newManagerUserId ? { newManagerUserId: x.newManagerUserId } : {}) });
      return { message: `${x.name}'s resignation is accepted: last working day ${dayText(x.lastWorkingDay)}. Offboarding has started.` };
    }
    if (x.action === 'change_last_day') {
      await changeLastDay(x.hrUserId, x.userId, { lastWorkingDay: x.lastWorkingDay });
      return { message: `${x.name}'s last working day is now ${dayText(x.lastWorkingDay)}.`, undo: { lastWorkingDay: x.previous } };
    }
    if (x.action === 'tick_clearance') {
      for (const k of x.keys ?? []) await setOffboardingClearance(x.hrUserId, x.userId, { key: k.key, done: x.done });
      return { message: `${(x.keys ?? []).map((k) => k.label).join(', ')} ${x.done ? 'ticked' : 'opened again'} for ${x.name}.`, undo: { keys: x.keys } };
    }
    await closeOffboarding(x.hrUserId, x.userId, { ...(x.note ? { note: x.note } : {}) });
    return { message: `${x.name}'s exit is closed.` };
  },
  async undo(p) {
    const x = p.payload as Payload;
    if (x.action === 'change_last_day') {
      const back = (p.undo as { lastWorkingDay?: string } | undefined)?.lastWorkingDay;
      if (!back) throw new Error('Nothing to put back');
      await changeLastDay(x.hrUserId, x.userId, { lastWorkingDay: back });
      return `${x.name}'s last working day is back to ${dayText(back)}.`;
    }
    if (x.action === 'tick_clearance') {
      const keys = (p.undo as { keys?: Payload['keys'] } | undefined)?.keys ?? [];
      for (const k of keys) await setOffboardingClearance(x.hrUserId, x.userId, { key: k.key, done: k.was });
      return `${keys.map((k) => k.label).join(', ')} put back as they were for ${x.name}.`;
    }
    throw new Error('This action cannot be undone');
  },
});
