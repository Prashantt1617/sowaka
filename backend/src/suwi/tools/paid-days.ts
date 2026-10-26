// Paid days templates: how attendance becomes paid days. Two prepared
// actions, both needing payroll access: give a person or a team a paid days
// template (the same call as Salary details › Paid days template), and create
// a new template from a plain-words description, with a worked example on a
// sample month. Confirm runs paidDaysTemplate.service as HR; Undo reverses.
import { paidDaysTemplates, payrollRuns, salaryStructures } from '../../config/db';
import { DEDUCTION_TRIGGER_LABELS, DEDUCTION_TRIGGERS, DeductionTrigger, SalaryDeductionRule } from '../../models/deduction.model';
import { DeductionCounts, payrollDeductions } from '../../services/deduction.service';
import { assignPaidDaysTemplate, createPaidDaysTemplate, deletePaidDaysTemplate, ensurePaidDaysTemplates } from '../../services/paidDaysTemplate.service';
import { parseDeductionRules } from '../../services/salaryTemplate.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { addDays, appShowsLine, istToday, norm, resolveTeam } from './team';

const PLURAL: Record<DeductionTrigger, [string, string]> = {
  late: ['late arrival', 'late arrivals'], early: ['early leave', 'early leaves'], absent: ['absent day', 'absent days'],
  half_day: ['half day', 'half days'], leave: ['leave day', 'leave days'], missed_punch: ['missed punch', 'missed punches'],
  unpaid_leave: ['day of leave without pay', 'days of leave without pay'],
};
const ruleWords = (r: SalaryDeductionRule) => `every ${r.every === 1 ? PLURAL[r.trigger][0] : `${r.every} ${PLURAL[r.trigger][1]}`} cost${r.every === 1 ? 's' : ''} ${r.deductDays} paid day${r.deductDays === 1 ? '' : 's'}${r.active ? '' : ' (switched off)'}`;

/** The template's rules in plain words. */
export function paidDaysWords(t: { allDaysPaid: boolean; deductionRules: SalaryDeductionRule[]; monthlyPaidLeaveDays: number }): string[] {
  if (t.allDaysPaid) return ['Every day of the month is paid; the attendance calendar is not read, except for leave without pay, which is always loss of pay.'];
  const ignored = t.deductionRules.filter((r) => r.trigger === 'absent' || r.trigger === 'half_day');
  return [
    'Loss of pay starts from the calendar: each absent day costs a paid day and each half day half a day (a missed punch costs what the shift says it counts as). The base is the days in the month.',
    t.deductionRules.filter((r) => !ignored.includes(r)).length ? `On top of that: ${t.deductionRules.filter((r) => !ignored.includes(r)).map(ruleWords).join('; ')}.` : 'No extra rules for lates, early leaves or missed punches.',
    ...(ignored.length ? ['Rules on absent days or half days are not applied again: the calendar already docks those.'] : []),
    t.monthlyPaidLeaveDays ? (t.monthlyPaidLeaveDays === 1 ? 'The first day docked each month is covered by paid leave.' : `The first ${t.monthlyPaidLeaveDays} days docked each month are covered by paid leave.`) : 'No paid-leave allowance offsets what is docked.',
    'Leave without pay is always loss of pay, a half day as half, and no allowance covers it.',
  ];
}

/** A worked example: what a sample month costs under the template, exactly as a payroll run computes it. */
export function workedExample(t: { allDaysPaid: boolean; deductionRules: SalaryDeductionRule[]; monthlyPaidLeaveDays: number }, month: string, sample?: Partial<Record<DeductionTrigger, number>>) {
  const [y, m] = month.split('-').map(Number);
  const base = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const s = { absent: 1, half_day: 2, late: 4, early: 2, missed_punch: 1, leave: 1, ...(sample ?? {}) };
  // The sample's missed punch counts as a half day, the commonest shift setting.
  const counts: DeductionCounts = { late: s.late, early: s.early, absent: s.absent, half_day: s.half_day, leave: s.leave, missed_punch: s.missed_punch, unpaid_leave: 0, missedPunchLopCount: 0, missedPunchLop: 0, unpaidLeaveLop: 0 };
  if (t.allDaysPaid) return { month, daysInMonth: base, sample: s, lines: [], lop: 0, paidDays: base, text: `In ${month} (${base} days) every day is paid, whatever the calendar says: ${base} paid days.` };
  const docked = payrollDeductions(t.deductionRules, counts);
  const lop = Math.max(0, docked.days - t.monthlyPaidLeaveDays);
  const lines = docked.lines.filter((l) => l.days > 0 || l.count > 0).map((l) => `${l.label}: ${l.count} → ${l.days} day${l.days === 1 ? '' : 's'}`);
  return {
    month, daysInMonth: base, sample: s, lines, docked: docked.days, allowance: t.monthlyPaidLeaveDays, lop, paidDays: base - lop,
    text: `Sample ${month} (${base} days) with ${s.absent} absent, ${s.half_day} half days, ${s.late} lates, ${s.early} early leaves, ${s.missed_punch} missed punch (counted present here), ${s.leave} approved leave: ${lines.join('; ')}${t.monthlyPaidLeaveDays ? `; minus ${t.monthlyPaidLeaveDays} paid leave` : ''} → loss of pay ${lop} day${lop === 1 ? '' : 's'}, paid days ${base - lop} of ${base}.`,
  };
}

/** The first payroll month a change reaches: this month unless its run is already submitted. */
async function firstRunMonth(ctx: SuwiContext) {
  const month = ctx.today.slice(0, 7);
  const done = await payrollRuns().findOne({ org: ctx.org, period: month, status: { $in: ['approved', 'paid'] } } as never, { projection: { _id: 1 } });
  if (!done) return month;
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

function rulesFrom(v: unknown): SalaryDeductionRule[] {
  try { return parseDeductionRules(v); } catch (e) { throw new Error((e as Error).message); }
}

defineTools(
  {
    name: 'prepare_assign_paid_days_template',
    area: 'attendance',
    acts: true,
    payroll: true,
    label: (i) => `Prepared: paid days template ${i.template} for ${i.department ? `the ${i.department} department` : i.manager ? `${i.manager}'s reports` : Array.isArray(i.names) ? i.names.join(', ') : 'people'}`,
    description: 'Prepare giving a person or a team a paid days template (how attendance becomes paid days in payroll). Pick people by userIds, names, a department, or a manager (their direct reports). Only people with a salary assigned can have one; others are listed as skipped. Picking the Default puts them back on it. Changes nothing until HR confirms; 10 or more need the count typed.',
    input_schema: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' } }, names: { type: 'array', items: { type: 'string' } }, department: { type: 'string' }, manager: { type: 'string' }, template: { type: 'string', description: 'Paid days template name or code' } }, required: ['template'] },
    api: { method: 'PUT', path: '/admin/payroll/salary-structures/x/paid-days-template' },
    async run(ctx, i) {
      await ensurePaidDaysTemplates(ctx.org);
      const all = await paidDaysTemplates().find({ org: ctx.org }).toArray();
      const n = norm(i.template);
      const tpl = all.find((t) => norm(t.name) === n || norm(t.code) === n) ?? all.find((t) => norm(t.name).includes(n));
      if (!tpl) return { data: { needs: ['template'], options: all.map((t) => t.name), message: `No paid days template called "${str(i.template)}".` } };
      const def = all.find((t) => t.isDefault);
      const { people, how } = await resolveTeam(ctx, i);
      const structures = await salaryStructures().find({ org: ctx.org, userId: { $in: people.map((p) => p.userId) } }, { projection: { _id: 0, userId: 1, paidDaysTemplateCode: 1 } }).toArray();
      const codeOf = new Map(structures.map((s) => [s.userId, s.paidDaysTemplateCode && all.some((t) => t.code === s.paidDaysTemplateCode) ? s.paidDaysTemplateCode : def?.code ?? null]));
      const noSalary = people.filter((p) => !codeOf.has(p.userId));
      const already = people.filter((p) => codeOf.has(p.userId) && codeOf.get(p.userId) === tpl.code);
      const moving = people.filter((p) => codeOf.has(p.userId) && codeOf.get(p.userId) !== tpl.code);
      if (!moving.length) return { data: { nothingToDo: true, alreadyOn: already.map((p) => p.name), noSalary: noSalary.map((p) => p.name), message: noSalary.length && !already.length ? 'None of them has a salary assigned yet; a paid days template needs one (Salary details).' : `Everyone with a salary is already on ${tpl.name}.` } };
      const month = await firstRunMonth(ctx);
      const nameOf = (code: string | null) => all.find((t) => t.code === code)?.name ?? 'Default';
      const fromCounts = new Map<string, number>();
      for (const p of moving) { const k = nameOf(codeOf.get(p.userId) ?? null); fromCounts.set(k, (fromCounts.get(k) ?? 0) + 1); }
      const who = moving.length === 1 ? moving[0].name : `${moving.length} people`;
      const ex = workedExample(tpl, month);
      const showsLine = await appShowsLine(moving[0].userId, addDays(ctx.today, 1), moving.length === 1 ? 'Their' : `${moving[0].name.split(' ')[0]}'s`);
      const title = `Put ${who} on the ${tpl.name} paid days template`;
      const proposalId = await propose(ctx, {
        kind: 'assign_paid_days', area: 'attendance', title,
        summary: `${moving.length > 1 ? `${how}: ` : ''}${who} move${moving.length === 1 ? 's' : ''} from ${[...fromCounts.entries()].map(([k, c]) => (moving.length > 1 ? `${k} (${c})` : k)).join(', ')} to ${tpl.name}. Payroll reads it from the ${month} run.`,
        lines: [
          ...paidDaysWords(tpl).map((text, k) => ({ text: k === 0 ? `${tpl.name}: ${text}` : text, ...(k === 0 ? { why: 'A paid days template decides how attendance becomes paid days in a payroll run; it is separate from the salary template, which decides what they are paid.' } : {}) })),
          { text: `Example: ${ex.text}`, why: 'Worked with the same calculation a payroll run uses, on a made-up month.' },
          { text: `Applies from the ${month} payroll run (a draft run picks it up when recalculated); runs already submitted keep what they paid.` },
          { text: `${showsLine.replace(/\.$/, '')}: the shift and the app do not change; only paid days in payroll do.` },
          ...(noSalary.length ? [{ text: `Skipped, no salary assigned yet: ${noSalary.slice(0, 6).map((p) => p.name).join(', ')}${noSalary.length > 6 ? ` and ${noSalary.length - 6} more` : ''}.`, tone: 'warn' as const }] : []),
          ...(already.length ? [{ text: `${already.length} already on ${tpl.name}; left as they are.`, tone: 'info' as const }] : []),
          ...(moving.length > 1 ? [{ text: `People: ${moving.slice(0, 8).map((p) => p.name).join(', ')}${moving.length > 8 ? ` and ${moving.length - 8} more` : ''}.` }] : []),
        ],
        effectiveFrom: `${month}-01`, undoable: true, typeToConfirm: moving.length >= 10 ? String(moving.length) : undefined,
        payload: { code: tpl.code, name: tpl.name, byUserId: ctx.userId, userIds: moving.map((p) => p.userId), before: Object.fromEntries(moving.map((p) => [p.userId, codeOf.get(p.userId) ?? null])), month },
      });
      return { data: { prepared: true, title, month, moving: moving.length, skippedNoSalary: noSalary.map((p) => p.name), example: ex.text, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open paid days templates', view: 'paiddays' }] };
    },
  },
  {
    name: 'prepare_create_paid_days_template',
    area: 'attendance',
    acts: true,
    payroll: true,
    label: (i) => `Prepared: new paid days template ${i.name ?? ''}`.trim(),
    description: `Prepare creating a paid days template from a plain-words description. Map it to: name; allDaysPaid (every day paid, calendar ignored); deductionRules, each {trigger: one of ${DEDUCTION_TRIGGERS.join(', ')}, every: N occurrences, deductDays: paid days per N, in halves} (e.g. "3 lates cost half a day" → {trigger:"late", every:3, deductDays:0.5}); monthlyPaidLeaveDays (paid days a month that offset what is docked). Absences and half days are always docked by the calendar, so rules on them are not needed. Returns {needs:[...]} if something is missing; otherwise a card with the rules in plain words and a worked example on a sample month (optionally give sample counts).`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, description: { type: 'string' }, allDaysPaid: { type: 'boolean' },
        deductionRules: { type: 'array', items: { type: 'object', properties: { trigger: { type: 'string', enum: DEDUCTION_TRIGGERS }, every: { type: 'number' }, deductDays: { type: 'number' } }, required: ['trigger', 'every', 'deductDays'] } },
        monthlyPaidLeaveDays: { type: 'number' },
        sample: { type: 'object', description: 'Counts for the worked example: absent, half_day, late, early, missed_punch, leave', properties: Object.fromEntries(DEDUCTION_TRIGGERS.map((t) => [t, { type: 'number' }])) },
      },
    },
    api: { method: 'POST', path: '/admin/payroll/paid-days-templates' },
    async run(ctx, i) {
      const needs: string[] = [];
      const name = str(i.name, 80);
      if (!name) needs.push('name');
      if (i.allDaysPaid === undefined && i.deductionRules === undefined && i.monthlyPaidLeaveDays === undefined) needs.push('how attendance should cost paid days: allDaysPaid, or deductionRules (e.g. 3 lates = ½ day) and/or monthlyPaidLeaveDays');
      if (needs.length) return { data: { needs, message: `To create the template I still need: ${needs.join('; ')}.` } };
      await ensurePaidDaysTemplates(ctx.org);
      const clash = await paidDaysTemplates().findOne({ org: ctx.org, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
      if (clash) throw new Error(`A paid days template called "${clash.name}" already exists`);
      const rules = rulesFrom(i.deductionRules ?? []);
      const leave = Math.round(num(i.monthlyPaidLeaveDays, 0, 0, 31) * 2) / 2;
      const t = { allDaysPaid: i.allDaysPaid === true, deductionRules: rules, monthlyPaidLeaveDays: leave };
      const sample = i.sample && typeof i.sample === 'object' ? Object.fromEntries(Object.entries(i.sample as Record<string, unknown>).filter(([k]) => DEDUCTION_TRIGGERS.includes(k as DeductionTrigger)).map(([k, v]) => [k, num(v, 0, 0, 31)])) : undefined;
      const month = ctx.today.slice(0, 7);
      const ex = workedExample(t, month, sample);
      const proposalId = await propose(ctx, {
        kind: 'create_paid_days_template', area: 'attendance', title: `Create the ${name} paid days template`,
        summary: `${paidDaysWords(t).join(' ')} Nobody is on it until HR assigns it.`,
        lines: [
          ...paidDaysWords(t).map((text) => ({ text })),
          ...rules.filter((r) => r.trigger === 'absent' || r.trigger === 'half_day').map((r) => ({ text: `"${DEDUCTION_TRIGGER_LABELS[r.trigger]}" rule is saved but has no effect: the calendar already docks those days.`, tone: 'warn' as const })),
          { text: `Example: ${ex.text}`, why: 'Worked with the same calculation a payroll run uses.' },
          { text: 'Nobody is on it yet, so no pay and no app changes until you assign it (Salary details, or ask me to assign it); the app never shows paid days templates.' },
          { text: 'Undo deletes the template, as long as nobody has been put on it.', tone: 'info' as const },
        ],
        undoable: true,
        payload: { byUserId: ctx.userId, input: { name, description: str(i.description, 500), ...t } },
      });
      return { data: { prepared: true, name, rules: paidDaysWords(t), example: ex, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open paid days templates', view: 'paiddays' }] };
    },
  },
);

defineExecutor('assign_paid_days', {
  async run(p) {
    const { code, name, byUserId, userIds, month } = p.payload as { code: string; name: string; byUserId: string; userIds: string[]; month: string };
    for (const id of userIds) await assignPaidDaysTemplate(byUserId, id, code);
    const seen = await appShowsLine(userIds[0], addDays(istToday(), 1), 'Their');
    return { message: `Put ${userIds.length === 1 ? 'them' : `${userIds.length} people`} on ${name} from the ${month} payroll run. ${seen.replace(/\.$/, '')} as before; only paid days change.` };
  },
  async undo(p) {
    const { byUserId, userIds, before } = p.payload as { byUserId: string; userIds: string[]; before: Record<string, string | null> };
    for (const id of userIds) await assignPaidDaysTemplate(byUserId, id, before[id] ?? null);
    return `Put ${userIds.length === 1 ? 'them' : `${userIds.length} people`} back on their previous paid days template. ${await appShowsLine(userIds[0], addDays(istToday(), 1))}`;
  },
});

defineExecutor('create_paid_days_template', {
  async run(p) {
    const { byUserId, input } = p.payload as { byUserId: string; input: Record<string, unknown> };
    const made = await createPaidDaysTemplate(byUserId, input);
    return { message: `Created the ${made.name} paid days template (code ${made.code}); nobody is on it yet, so no one's app or pay changes until it is assigned.`, undo: { code: made.code } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const code = String(p.undo?.code ?? '');
    await deletePaidDaysTemplate(byUserId, code);
    return `Deleted the ${String((p.payload.input as { name?: string }).name ?? code)} paid days template.`;
  },
});

