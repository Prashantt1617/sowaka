// Company leave settings from Suwi (24 Nov, Suwi training: time). Leave types live on each shift
// template (Shift templates › Leaves): there is no separate company list, so "add 2 days of bereavement
// leave" is a change to the templates' leave types, saved through updateShift as the template editor's
// Save does. Read first (leave_type_settings), then one card for every template it touches; Undo puts
// each template's leave block back. Also the month's leave credit: Sowaka credits leave on the 1st of
// every month by itself (worked out from the template's rate, PR #194; there is no job to run), so
// leave_monthly_credit only answers what was or will be credited.
import { ObjectId } from 'mongodb';
import { shiftTemplates, users } from '../../config/db';
import { LeaveTypeRule, MAX_LEAVE_TYPES, ShiftLeaveRules, ShiftTemplate } from '../../models/shift.model';
import { getMyLeaveBalance } from '../../services/leave.service';
import { leaveKeyFrom, policiesForUsers, updateShift } from '../../services/shift.service';
import { defineTools, monthOf, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { liveTemplates, templateNamed } from './shifts';
import { peopleOn, updateBody } from './shift-template-edit';
import { ACTIVE, norm } from './team';
import { findPerson } from './people';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RESET_WORDS: Record<LeaveTypeRule['resetOn'], string> = { calendar_year: 'calendar year', financial_year: 'financial year', monthly: 'every month' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** A leave type in one line, as HR reads it. */
export function ruleWords(t: LeaveTypeRule): string {
  if (t.unpaid) return `${t.name}: leave without pay (no balance; every day is loss of pay)`;
  if (t.key === 'comp_off') return `${t.name}: earned by approved overtime`;
  const year = t.perMonth * 12;
  return `${t.name}: ${t.perMonth} a month (${year} a year), ${t.resetOn === 'monthly' ? 'closes every month' : `closes at the end of the ${RESET_WORDS[t.resetOn]}`}, carry forward up to ${t.carryForwardDays}, encash ${t.encashment === 'all' ? 'the rest' : t.encashment === 'limit' ? `up to ${t.encashLimitDays}` : 'none'}; apply up to ${t.advanceDays} days ahead${t.allowBackdated ? `, ${t.backdatedDays} back` : ', not backdated'}`;
}

const leaveOf = (t: ShiftTemplate): ShiftLeaveRules => t.policy?.leave ?? { approver: 'Reporting manager', hrOverride: true, balanceTracked: true, types: [] };
const findType = (types: LeaveTypeRule[], name: string) => {
  const n = norm(name);
  const k = leaveKeyFrom(name);
  return types.find((t) => t.key === name || norm(t.name) === n || (k && t.key === k)) ?? types.find((t) => norm(t.name).includes(n));
};

type Op = { action: 'add' | 'edit' | 'remove'; name: string; set: Partial<LeaveTypeRule> };

/** The template's types after the change, or why this template is left as it is. */
function applyOp(types: LeaveTypeRule[], op: Op): { types: LeaveTypeRule[]; before?: LeaveTypeRule; after?: LeaveTypeRule } | { skip: string } {
  if (op.action === 'add') {
    const want = op.set.name ?? op.name;
    const same = types.find((t) => t.key === leaveKeyFrom(want) || norm(t.name) === norm(want));
    if (same) return { skip: `Already has ${same.name}` };
    if (types.length >= MAX_LEAVE_TYPES) return { skip: `Already has the most leave types a template can (${MAX_LEAVE_TYPES})` };
    const base = leaveKeyFrom(op.set.name ?? op.name) || 'leave';
    let key = base;
    for (let n = 2; types.some((t) => t.key === key); n += 1) key = `${base.slice(0, 32 - `_${n}`.length)}_${n}`;
    const rule: LeaveTypeRule = { key, name: op.set.name ?? op.name, perMonth: 0, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 3, ...op.set };
    if (!rule.unpaid) delete rule.unpaid;
    return { types: [...types, rule], after: rule };
  }
  const found = findType(types, op.name);
  if (!found) return { skip: `Has no ${op.name}` };
  if (op.action === 'remove') return { types: types.filter((t) => t.key !== found.key), before: found };
  const rule = { ...found, ...op.set, key: found.key };
  if (!rule.unpaid) delete rule.unpaid;
  if (found.key === 'comp_off') rule.perMonth = 0;
  return { types: types.map((t) => (t.key === found.key ? rule : t)), before: found, after: rule };
}

/** The months credited so far this year for a type added today: what everyone on it gets at once. */
const monthsSoFar = (today: string) => Number(today.slice(5, 7));

defineTools(
  {
    name: 'leave_type_settings',
    area: 'attendance',
    label: (i) => (i.template ? `Leave types on ${i.template}` : 'Leave types on every shift template'),
    description: 'The company\'s leave settings: each shift template\'s leave types (leave types live on the templates, Shifts › Shift templates › Leaves), with the monthly rate and yearly equivalent, when the balance closes (calendar year, financial year, or every month), carry-forward, encashment, how far ahead / back it can be applied, whether it is leave without pay, whether balances are tracked at all, and how many people are on each template. Read this before prepare_leave_type_change. Optionally one template by name.',
    input_schema: { type: 'object', properties: { template: { type: 'string' } } },
    api: { method: 'GET', path: '/admin/shifts' },
    async run(ctx, i) {
      const list = str(i.template) ? [await templateNamed(ctx, str(i.template))].filter(Boolean) as ShiftTemplate[] : await liveTemplates(ctx);
      if (!list.length) throw new Error(str(i.template) ? `No shift template called "${str(i.template)}"` : 'This company has no shift templates yet');
      const rows = [];
      for (const t of list) {
        const leave = leaveOf(t);
        rows.push({
          template: t.name, isDefault: t.isDefault === true, active: t.active !== false, people: await peopleOn(ctx, t), balanceTracked: leave.balanceTracked !== false,
          types: leave.types.map((x) => ({ key: x.key, name: x.name, perMonth: x.perMonth, perYear: x.perMonth * 12, closes: RESET_WORDS[x.resetOn], carryForwardDays: x.carryForwardDays, encashment: x.encashment, encashLimitDays: x.encashLimitDays, advanceDays: x.advanceDays, backdatedDays: x.allowBackdated ? x.backdatedDays : 0, unpaid: x.unpaid === true })),
        });
      }
      return {
        data: { templates: rows, note: 'Leave is credited on the 1st of every month at the monthly rate (from January, or the joining month). Comp-off is earned by approved overtime, not credited. A rate is set in steps of half a day a month.' },
        tables: [{ title: 'Leave types by shift template', columns: ['Template', 'Leave type', 'Per month', 'Per year', 'Closes', 'Carry forward', 'Apply ahead / back'], rows: rows.flatMap((r) => r.types.map((x) => [r.template, x.name, x.unpaid ? 'unpaid' : x.key === 'comp_off' ? 'by overtime' : x.perMonth, x.unpaid || x.key === 'comp_off' ? '' : x.perYear, x.closes, x.carryForwardDays, `${x.advanceDays} / ${x.backdatedDays} days`])) }],
        links: [{ label: 'Open shift templates', view: 'shifttypes' }],
      };
    },
  },
  {
    name: 'prepare_leave_type_change',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: ${i.action ?? 'change'} ${i.name ?? 'a leave type'}`,
    description: 'Prepare adding, changing or removing a leave type in the company\'s leave settings, e.g. "add 2 days of bereavement leave", "make casual leave 1.5 a month", "let earned leave carry forward 30 days", "remove sick leave". Leave types live on the shift templates, so the change is made on every live template (or only the templates named). action: add | edit | remove; name: the type (for add, its name). Fields to set: perMonth (half-day steps) or daysPerYear (must be a multiple of 6, as leave is credited monthly in half days), resetOn (calendar_year | financial_year | monthly), carryForwardDays, encashment (none | all | limit) and encashLimitDays, advanceDays, allowBackdated, backdatedDays, unpaid (leave without pay: no balance), newName (edit). Call leave_type_settings first to see what exists. A yearly allowance that is not a multiple of 6 (2 days of bereavement leave) cannot be a monthly rate: the tool says so and gives the options; do not round it yourself. Changes nothing until HR confirms; Undo puts each template\'s leave types back. Changing one person\'s total is prepare_set_leave_total.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'edit', 'remove'] }, name: { type: 'string', description: 'Leave type name (or key)' },
        templates: { type: 'array', items: { type: 'string' }, description: 'Only these shift templates (default: every live template)' },
        newName: { type: 'string' }, perMonth: { type: 'number' }, daysPerYear: { type: 'number' },
        resetOn: { type: 'string', enum: ['calendar_year', 'financial_year', 'monthly'] }, carryForwardDays: { type: 'number' },
        encashment: { type: 'string', enum: ['none', 'all', 'limit'] }, encashLimitDays: { type: 'number' },
        advanceDays: { type: 'number' }, allowBackdated: { type: 'boolean' }, backdatedDays: { type: 'number' }, unpaid: { type: 'boolean' },
      },
      required: ['action', 'name'],
    },
    api: { method: 'PATCH', path: '/admin/shifts/x' },
    async run(ctx, i) {
      const action = str(i.action) as Op['action'];
      if (!['add', 'edit', 'remove'].includes(action)) throw new Error('action must be add, edit or remove');
      const name = str(i.name, 40);
      if (!name) throw new Error('Say which leave type');
      const set: Partial<LeaveTypeRule> = {};
      const problems: string[] = [];
      const wholeDays = (k: 'carryForwardDays' | 'encashLimitDays' | 'advanceDays' | 'backdatedDays') => {
        if (i[k] === undefined) return;
        const n = Number(i[k]);
        if (!Number.isInteger(n) || n < 0 || n > 365) problems.push(`${k} must be a whole number of days, up to 365`); else set[k] = n;
      };
      (['carryForwardDays', 'encashLimitDays', 'advanceDays', 'backdatedDays'] as const).forEach(wholeDays);
      if (i.resetOn !== undefined) { if (['calendar_year', 'financial_year', 'monthly'].includes(str(i.resetOn))) set.resetOn = str(i.resetOn) as LeaveTypeRule['resetOn']; else problems.push('resetOn must be calendar_year, financial_year or monthly'); }
      if (i.encashment !== undefined) { if (['none', 'all', 'limit'].includes(str(i.encashment))) set.encashment = str(i.encashment) as LeaveTypeRule['encashment']; else problems.push('encashment must be none, all or limit'); }
      if (typeof i.allowBackdated === 'boolean') set.allowBackdated = i.allowBackdated;
      if (typeof i.unpaid === 'boolean') set.unpaid = i.unpaid;
      if (action === 'edit' && str(i.newName, 40)) set.name = str(i.newName, 40);
      if (action === 'add') set.name = name;
      if (i.daysPerYear !== undefined && i.perMonth === undefined) {
        const year = Number(i.daysPerYear);
        if (!Number.isFinite(year) || year < 0 || year > 288) problems.push('daysPerYear must be between 0 and 288');
        else if ((year / 12) * 2 !== Math.round((year / 12) * 2)) {
          const near = [...new Set([Math.floor(year / 6) * 6, Math.ceil(year / 6) * 6])].filter((y) => y > 0);
          return {
            data: {
              cannotSetAsAsked: true,
              message: `Sowaka credits leave on the 1st of every month in steps of half a day, so ${year} days a year cannot be a monthly rate (the nearest: ${near.join(' or ')} a year).`,
              options: [
                `Use a monthly rate: ${near.map((y) => `${y / 12} a month (${y} a year)`).join(' or ')}.`,
                `Add it at 0 a month and give the ${year} days to the people who need them with prepare_set_leave_total (per person, for this year).`,
                'Add it as leave without pay (unpaid true): no balance, approval is the only control, every day is loss of pay.',
              ],
              note: 'Ask HR which they want; do not pick for them.',
            },
          };
        } else set.perMonth = year / 12;
      }
      if (i.perMonth !== undefined) {
        const m = Number(i.perMonth);
        if (!Number.isFinite(m) || m < 0 || m > 24 || Math.round(m * 2) !== m * 2) problems.push('perMonth must be in half-day steps between 0 and 24'); else set.perMonth = m;
      }
      if (action === 'add' && set.perMonth === undefined && !set.unpaid) return { data: { needs: ['perMonth or daysPerYear (or unpaid true)'], message: `How much ${name} does each person get: a monthly rate (half-day steps), days a year (a multiple of 6), or is it leave without pay?` } };
      if (action === 'edit' && !Object.keys(set).length) return { data: { needs: ['what to change'], message: `What should change on ${name}?` } };
      if (problems.length) return { data: { problems, message: problems.join('. ') } };

      const names = Array.isArray(i.templates) ? i.templates.map((t) => str(t, 60)).filter(Boolean) : [];
      const targets: ShiftTemplate[] = [];
      const skipped: { who: string; reason: string }[] = [];
      if (names.length) for (const n of names) { const t = await templateNamed(ctx, n); if (t) targets.push(t); else skipped.push({ who: n, reason: 'No such shift template' }); }
      else targets.push(...(await liveTemplates(ctx)));
      if (!targets.length) throw new Error('This company has no shift templates to change');
      const op: Op = { action, name, set };
      const rows: { name: string; current: string; next: string }[] = [];
      const touched: { id: string; name: string; people: number }[] = [];
      let example: LeaveTypeRule | undefined;
      let removed: LeaveTypeRule | undefined;
      for (const t of targets) {
        const leave = leaveOf(t);
        const r = applyOp(leave.types, op);
        if ('skip' in r) { skipped.push({ who: t.name, reason: r.skip }); continue; }
        if (!leave.balanceTracked && action === 'add' && !set.unpaid) skipped.push({ who: t.name, reason: 'Unlimited leave (no balance tracked): the type is added but nothing is counted' });
        example = r.after ?? example;
        removed = r.before && action === 'remove' ? r.before : removed;
        touched.push({ id: t._id!.toHexString(), name: t.name, people: await peopleOn(ctx, t) });
        rows.push({ name: t.name, current: r.before ? ruleWords(r.before) : 'Not offered', next: r.after ? ruleWords(r.after) : 'Removed' });
      }
      if (!touched.length) return { data: { nothingToDo: true, message: 'No template would change.', skipped } };
      const people = touched.reduce((s, t) => s + t.people, 0);
      const label = example?.name ?? removed?.name ?? name;
      const title = action === 'add' ? `Add ${label} to ${plural(touched.length, 'shift template')}` : action === 'remove' ? `Remove ${label} from ${plural(touched.length, 'shift template')}` : `Change ${label} on ${plural(touched.length, 'shift template')}`;
      const soFar = example && !example.unpaid && example.key !== 'comp_off' ? example.perMonth * monthsSoFar(ctx.today) : 0;
      const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [
        ...(example ? [{ text: ruleWords(example) + '.' }] : []),
        { text: `Templates: ${touched.map((t) => `${t.name} (${plural(t.people, 'person', 'people')})`).join(', ')}; ${plural(people, 'person', 'people')} in all.` },
      ];
      if (action === 'add' && soFar > 0) lines.push({ text: `Credited from January (or the joining month), so everyone on these templates has ${soFar} days of ${label} as soon as this is saved, and ${example!.perMonth} more on the 1st of each month.`, why: 'A balance counts every month of the year so far at the template\'s rate; it is worked out, not run by a job.', tone: 'warn' });
      if (action === 'edit' && set.perMonth !== undefined) lines.push({ text: `The new rate applies to the whole year so far, not just from next month: each balance becomes ${set.perMonth} × the months credited this year, plus what carried in and HR's changes.`, tone: 'warn' });
      if (action === 'add' && set.unpaid) lines.push({ text: 'Leave without pay keeps no balance: people can always apply, and every approved day is loss of pay in payroll.', tone: 'info' });
      if (action === 'remove') lines.push({ text: `People can no longer apply for ${label}. Leave already taken or approved against it still shows; any balance left is no longer offered.`, tone: 'warn' });
      lines.push({ text: 'The app shows the change as soon as it is saved (no app update needed).' });
      lines.push({ text: 'Undo puts each template\'s leave types back as they are now.', tone: 'info' });
      const proposalId = await propose(ctx, {
        kind: 'leave_type_change', area: 'attendance', title,
        summary: `${title}: ${plural(people, 'person', 'people')} affected.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
        lines, effectiveFrom: ctx.today, undoable: true,
        preview: { field: label, rows, skipped },
        payload: { byUserId: ctx.userId, op, templates: touched },
      });
      return { data: { prepared: true, title, templates: touched, skipped, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open shift templates', view: 'shifttypes' }] };
    },
  },
  {
    name: 'leave_monthly_credit',
    area: 'attendance',
    label: (i) => `Leave credit for ${i.month ?? 'this month'}${i.name ? `, ${i.name}` : ''}`,
    description: 'What a month\'s leave credit is (or was): Sowaka credits leave by itself on the 1st of every month at each shift template\'s monthly rate (comp-off is earned by overtime instead, leave without pay has no balance, a template with untracked balances gets none, people who join later start from their joining month). Answers "credit December leave", "what leave gets credited on 1 Dec", "was November leave credited": per template and type, how many people and how many days. With a person (name or userId): their credit for the month and their balance as of the 1st. There is nothing to run: the credit is part of the balance from the 1st, so never offer to "run" it.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (default this month)' }, userId: { type: 'string' }, name: { type: 'string' } } },
    api: { method: 'GET', path: '/admin/leave-balances' },
    async run(ctx, i) {
      const month = monthOf(i.month, ctx.today);
      const first = `${month}-01`;
      const status = month < ctx.today.slice(0, 7) ? `was credited on 1 ${monthName(month)}` : month === ctx.today.slice(0, 7) ? `was credited on 1 ${monthName(month)} and is in today's balances` : `will be credited on 1 ${monthName(month)}, automatically`;
      const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
      if (str(i.userId) || str(i.name)) {
        const p = await findPerson(ctx, str(i.userId) || str(i.name));
        const [pol] = [...(await policiesForUsers([p.userId], first)).values()];
        const joined = p.joiningDate ? new Date(p.joiningDate) : null;
        const types = (pol?.leave.types ?? []).filter((t) => !t.unpaid && t.key !== 'comp_off');
        const before = joined && joined > monthEnd;
        const bal = await getMyLeaveBalance(p.userId, Number(month.slice(0, 4)), new Date(`${first}T00:00:00Z`));
        return {
          data: {
            name: p.name, month, status, shift: pol?.shiftName ?? 'company policy', balanceTracked: pol?.leave.balanceTracked !== false,
            credit: pol?.leave.balanceTracked === false || before ? [] : types.map((t) => ({ type: t.name, days: t.perMonth, closes: RESET_WORDS[t.resetOn] })),
            ...(before ? { note: `${p.name} joins after ${monthName(month)}: nothing is credited yet.` } : {}),
            balanceOnThe1st: bal.types.map((t) => ({ type: t.name, total: t.total, used: t.used, remaining: t.remaining })),
            nothingToRun: 'The credit is part of the balance from the 1st; there is no step to run.',
          },
          links: [{ label: `Open ${p.name.split(' ')[0]}'s requests`, userId: p.userId, tab: 'requests' }],
        };
      }
      const people = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, joiningDate: 1 } }).toArray();
      const policies = await policiesForUsers(people.map((u) => u.userId), first);
      const groups = new Map<string, { template: string; type: string; perMonth: number; closes: string; people: number; days: number }>();
      let untracked = 0, notJoined = 0;
      for (const u of people) {
        const pol = policies.get(u.userId);
        if (!pol) continue;
        if (pol.leave.balanceTracked === false) { untracked++; continue; }
        if (u.joiningDate && new Date(u.joiningDate) > monthEnd) { notJoined++; continue; }
        for (const t of pol.leave.types) {
          if (t.unpaid || t.key === 'comp_off' || !t.perMonth) continue;
          const key = `${pol.shiftName ?? 'Company policy'}|${t.key}`;
          const g = groups.get(key) ?? { template: pol.shiftName ?? 'Company policy', type: t.name, perMonth: t.perMonth, closes: RESET_WORDS[t.resetOn], people: 0, days: 0 };
          g.people += 1; g.days += t.perMonth;
          groups.set(key, g);
        }
      }
      const rows = [...groups.values()].sort((a, b) => a.template.localeCompare(b.template) || a.type.localeCompare(b.type));
      return {
        data: {
          month, status, credits: rows, totalDays: rows.reduce((s, r) => s + r.days, 0),
          leftOut: { unlimitedLeave: untracked, joiningLater: notJoined },
          nothingToRun: 'Sowaka has no "run the credit" step: each balance counts the month from its 1st, so nothing needs to be (or can be) triggered. Types that close every month start the month with their credit plus what carried forward.',
        },
        tables: rows.length ? [{ title: `Leave credited on 1 ${monthName(month)}`, columns: ['Template', 'Leave type', 'Per person', 'People', 'Days in all'], rows: rows.map((r) => [r.template, r.type, r.perMonth, r.people, Math.round(r.days * 100) / 100]) }] : [],
        links: [{ label: 'Open leave balances', view: 'leavebalances' }],
      };
    },
  },
);

defineExecutor('leave_type_change', {
  async run(p) {
    const { byUserId, op, templates } = p.payload as { byUserId: string; op: Op; templates: { id: string; name: string }[] };
    const before: Record<string, ShiftLeaveRules> = {};
    const done: string[] = [];
    const failed: string[] = [];
    for (const t of templates) {
      try {
        const now = await shiftTemplates().findOne({ _id: new ObjectId(t.id), deletedAt: { $exists: false } } as never);
        if (!now) throw new Error('no longer exists');
        const leave = leaveOf(now);
        const r = applyOp(leave.types, op);
        if ('skip' in r) throw new Error(r.skip);
        await updateShift(byUserId, t.id, updateBody(now, { leave: { ...leave, types: r.types } }));
        before[t.id] = leave;
        done.push(t.name);
      } catch (e) { failed.push(`${t.name} (${(e as Error).message})`); }
    }
    if (!done.length) throw new Error(`No template changed: ${failed.join('; ')}`);
    return { message: `Saved on ${done.join(', ')}.${failed.length ? ` Not changed: ${failed.join('; ')}.` : ''} The app shows it now.`, undo: { before } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const before = (p.undo as { before: Record<string, ShiftLeaveRules> }).before;
    const back: string[] = [];
    for (const [id, leave] of Object.entries(before)) {
      const now = await shiftTemplates().findOne({ _id: new ObjectId(id) });
      if (!now || now.deletedAt) continue;
      await updateShift(byUserId, id, updateBody(now, { leave }));
      back.push(now.name);
    }
    return `Put the leave types back on ${back.join(', ') || 'no template (they were deleted)'}.`;
  },
});
