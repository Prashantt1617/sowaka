// Shifts: which template people are on, what a person's app reads on a date
// and what changed since when, and the first action Suwi can take — moving a
// team to a shift template. The card spells out, in plain words, the policy
// each person's app will show from tomorrow; Confirm moves them through the
// same service the Bulk Assign page uses, and Undo moves them back.
import { ObjectId } from 'mongodb';
import { shiftAssignments, shiftTemplates, users } from '../../config/db';
import { ShiftTemplate } from '../../models/shift.model';
import { assignShiftToUsers, getOrgShiftPolicy, mergeTemplatePolicy, policyForUser, shiftPolicyViewOf, unassignShiftUsers } from '../../services/shift.service';
import { defineTools, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { ACTIVE, addDays, appShowsLine, isDate, istToday, niceDate, norm, resolveTeam } from './team';

/** Weekday names in the policy's own order: 0 = Monday … 6 = Sunday. */
const DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];

/** "Sundays and 2nd and 4th Saturdays off", from the week-of-month grid. */
export function weeklyOffWords(grid: Record<string, number[]> | undefined): string {
  if (!grid) return 'no weekly offs';
  const weeksOf = (d: number) => ['1', '2', '3', '4', '5'].filter((w) => (grid[w] ?? []).includes(d));
  const parts: string[] = [];
  for (let d = 0; d < 7; d++) {
    const weeks = weeksOf(d);
    if (!weeks.length) continue;
    if (weeks.length >= 4) parts.push(DAYS[d]);
    else parts.push(`${weeks.map((w) => ORD[Number(w) - 1]).join(' and ')} ${DAYS[d]}`);
  }
  return parts.length ? `${parts.join(' and ')} off` : 'no weekly offs';
}

/** A policy in a sentence or three, as HR and the employee read it. */
export function policySummary(v: ReturnType<typeof shiftPolicyViewOf>): string {
  const parts = [`${v.startTime}–${v.endTime}`];
  parts.push(v.lateMarkingEnabled ? `late after ${v.lateGraceMinutes ?? 0} minutes' grace` : 'no late marks');
  if (v.halfDay?.minFullDayEnabled) parts.push(`under ${v.minFullDayHours} h is a half day`);
  if (v.halfDay?.minHalfDayEnabled) parts.push(`under ${v.minHalfDayHours} h is absent`);
  parts.push(weeklyOffWords(v.weeklyOff));
  parts.push(`punches by ${String(v.correction?.punchFormat ?? 'app')}`);
  if (v.leaveTypes?.length) parts.push(`leave types: ${v.leaveTypes.map((t) => t.name).join(', ')}`);
  return `${v.name}: ${parts.join('; ')}.`;
}

/** The same policy as 3–4 short lines for a card or an answer. */
export function policyLines(v: ReturnType<typeof shiftPolicyViewOf>): string[] {
  const missed = `missing punch-in counts as ${v.missingPunchIn}, punch-out ${v.missingPunchOut}, both ${v.missingBoth}`;
  return [
    `Shift ${v.name}: ${v.startTime}–${v.endTime}, ${weeklyOffWords(v.weeklyOff)}.`,
    `${v.lateMarkingEnabled ? `Late after ${v.lateGraceMinutes} min grace` : 'Nobody is marked late'}; ${v.earlyMarkingEnabled ? `early if out more than ${v.earlyOutGraceMinutes} min before ${v.endTime}` : 'nobody is marked early'}; ${v.halfDay?.minFullDayEnabled ? `under ${v.minFullDayHours} h is a half day` : 'no minimum hours for a full day'}${v.halfDay?.minHalfDayEnabled ? `, under ${v.minHalfDayHours} h absent` : ''}.`,
    `Punches by ${v.correction.punchFormat} (${v.correction.punchMode}); ${missed}.`,
    `Leave: ${v.leaveTypes.length ? v.leaveTypes.map((t) => t.name).join(', ') : 'no types'}; ${v.leaveBalanceTracked ? 'balances tracked' : 'unlimited, no balance'}; overtime ${v.overtimeEligible ? 'allowed' : 'not allowed'}.`,
  ];
}

export async function liveTemplates(ctx: SuwiContext) {
  return shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false } } as never).toArray();
}

export async function templateNamed(ctx: SuwiContext, name: string) {
  const all = await liveTemplates(ctx);
  const n = norm(name);
  return all.find((t) => norm(t.name) === n) ?? all.filter((t) => norm(t.name).includes(n)).sort((a, b) => a.name.length - b.name.length)[0];
}

/** The template each of these people is explicitly on now (undefined = the Default). */
export async function currentTemplatesFor(ctx: SuwiContext, ids: string[]) {
  const current = await shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false }, active: true, assignedUserIds: { $in: ids } } as never, { projection: { _id: 1, name: 1, assignedUserIds: 1 } }).toArray();
  return Object.fromEntries(ids.map((id) => [id, current.find((t) => (t.assignedUserIds ?? []).includes(id))])) as Record<string, ShiftTemplate | undefined>;
}

/** The card for moving people to a template, shared with the geotag move. */
export async function prepareMove(ctx: SuwiContext, tpl: ShiftTemplate, people: { userId: string; name: string }[], opts: { kind?: string; title?: string; extraLines?: { text: string; why?: string; tone?: 'info' | 'warn' }[]; summaryPrefix?: string } = {}) {
  const ids = people.map((p) => p.userId);
  const from = addDays(ctx.today, 1);
  const orgPolicy = await getOrgShiftPolicy(ctx.org);
  const after = shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, tpl));
  const before = await currentTemplatesFor(ctx, ids);
  const already = ids.filter((id) => before[id]?._id?.equals(tpl._id!));
  const moving = people.filter((p) => !already.includes(p.userId));
  if (!moving.length) return { data: { nothingToDo: true, message: `Everyone named is already on ${tpl.name}.` } };
  const nowPolicy = moving.length === 1 ? shiftPolicyViewOf(await policyForUser(moving[0].userId)) : null;
  const who = moving.length === 1 ? moving[0].name : `${moving.length} people`;
  const title = opts.title ?? `Move ${who} to ${tpl.name}`;
  const proposalId = await propose(ctx, {
    kind: opts.kind ?? 'assign_shift', area: 'attendance', title,
    summary: `${opts.summaryPrefix ?? ''}From ${niceDate(from)}, ${policySummary(after)}${nowPolicy ? ` Today ${moving[0].name.split(' ')[0]} is on ${nowPolicy.name} (${nowPolicy.startTime}–${nowPolicy.endTime}).` : ''}`,
    lines: [
      { text: `Starts tomorrow (${niceDate(from)}); today stays on the current shift.`, why: 'A shift change always starts the next day, so a day already underway is never re-marked under rules nobody knew about.' },
      { text: `Late marks, half days and absences are graded on ${after.startTime}–${after.endTime} from then on; ${weeklyOffWords(after.weeklyOff)}.`, why: 'Each day is graded by the template that covered it on that date, so days already worked keep their marks.' },
      ...(opts.extraLines ?? []),
      { text: `${moving.length === 1 ? 'Their' : 'Each person\'s'} app shows ${after.name} (${after.startTime}–${after.endTime}, punches by ${after.correction.punchFormat}, ${after.leaveTypes.map((t) => t.name).join(', ') || 'no leave types'}) from ${niceDate(from)}, and they get a notification.` },
      ...(moving.length > 1 ? [{ text: `Now on: ${[...moving.reduce((m, p) => m.set(before[p.userId]?.name ?? 'the Default', (m.get(before[p.userId]?.name ?? 'the Default') ?? 0) + 1), new Map<string, number>())].map(([k, c]) => `${k} (${c})`).join(', ')}.` }] : []),
      ...(already.length ? [{ text: `${already.length} already on ${tpl.name}; left as they are.`, tone: 'info' as const }] : []),
      ...(moving.length > 1 ? [{ text: `People: ${moving.slice(0, 8).map((p) => p.name).join(', ')}${moving.length > 8 ? ` and ${moving.length - 8} more` : ''}.` }] : []),
    ],
    effectiveFrom: from, undoable: true, typeToConfirm: moving.length >= 10 ? String(moving.length) : undefined,
    payload: { templateId: tpl._id!.toHexString(), templateName: tpl.name, userIds: moving.map((p) => p.userId), byUserId: ctx.userId, before: Object.fromEntries(moving.map((p) => [p.userId, before[p.userId]?._id?.toHexString() ?? null])) },
  });
  return { data: { prepared: true, title, from, newPolicy: policySummary(after), people: moving.length, alreadyThere: already.length, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
}

defineTools(
  {
    name: 'shift_templates',
    area: 'attendance',
    label: () => 'Shift templates and who is on them',
    description: 'The shift templates in this company: name, timings, punch format, how many people are on each, which is the Default, and (if asked) everyone not explicitly assigned to a template.',
    input_schema: { type: 'object', properties: { includeUnassigned: { type: 'boolean' } } },
    api: { method: 'GET', path: '/admin/shifts' },
    async run(ctx, i) {
      const all = await liveTemplates(ctx);
      const orgPolicy = await getOrgShiftPolicy(ctx.org);
      const assigned = new Set(all.filter((t) => t.active).flatMap((t) => t.assignedUserIds ?? []));
      const data: Record<string, unknown> = {
        templates: all.map((t) => {
          const v = shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, t));
          return { name: t.name, people: (t.assignedUserIds ?? []).length, isDefault: Boolean(t.isDefault), active: t.active, start: v.startTime, end: v.endTime, punchFormat: v.correction.punchFormat, weeklyOff: weeklyOffWords(v.weeklyOff), lateGraceMinutes: v.lateMarkingEnabled ? v.lateGraceMinutes : null };
        }),
      };
      if (i.includeUnassigned) {
        const people = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, department: 1 } }).toArray();
        const un = people.filter((p) => !assigned.has(p.userId));
        data.notAssigned = { count: un.length, onTemplate: all.find((t) => t.isDefault)?.name ?? 'the org policy', people: un.slice(0, 40) };
      }
      return { data, links: [{ label: 'Open shift templates', view: 'shifttypes' }, { label: 'Open bulk assign', view: 'shiftbulk' }] };
    },
  },
  {
    name: 'person_policy_summary',
    area: 'attendance',
    label: (i) => `${i.name ?? 'Their'} policy${i.date ? ` on ${i.date}` : ''}${i.since ? ` and changes since ${i.since}` : ''}`,
    description: "The policy one person's app reads on a date (default today): shift, timings, grace, half-day rules, weekly offs, punch format, missed-punch marks, leave types; in 3–4 plain lines. With `since`, also what changed for them since that date (template moves from the assignment history, and whether their template was edited). Needs their userId.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string', description: 'Their name, for the label' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, since: { type: 'string', description: 'YYYY-MM-DD: list what changed since then' } }, required: ['userId'] },
    api: { method: 'GET', path: '/admin/shifts' },
    async run(ctx, i) {
      const userId = str(i.userId);
      const person = await users().findOne({ org: ctx.org, userId }, { projection: { _id: 0, name: 1 } });
      if (!person) throw new Error('That person is not in this company');
      const date = isDate(i.date) ? i.date : ctx.today;
      const policy = await policyForUser(userId, date);
      const v = shiftPolicyViewOf(policy);
      const data: Record<string, unknown> = {
        name: person.name, date, lines: policyLines(v), appShows: `${person.name.split(' ')[0]}'s app shows ${v.name} (${v.startTime}–${v.endTime}) on ${niceDate(date)}.`,
        fields: { shift: v.name, startTime: v.startTime, endTime: v.endTime, lateGraceMinutes: v.lateMarkingEnabled ? v.lateGraceMinutes : null, earlyOutGraceMinutes: v.earlyMarkingEnabled ? v.earlyOutGraceMinutes : null, minHalfDayHours: v.halfDay?.minHalfDayEnabled ? v.minHalfDayHours : null, minFullDayHours: v.halfDay?.minFullDayEnabled ? v.minFullDayHours : null, halfDayRules: v.halfDay, weeklyOff: weeklyOffWords(v.weeklyOff), punchFormat: v.correction.punchFormat, punchMode: v.correction.punchMode, missingPunchIn: v.missingPunchIn, missingPunchOut: v.missingPunchOut, missingBoth: v.missingBoth, outsideLocation: v.correction.outsideLocation, leaveTypes: v.leaveTypes.map((t) => t.name), leaveBalanceTracked: v.leaveBalanceTracked, overtimeEligible: v.overtimeEligible },
      };
      if (isDate(i.since)) {
        const rows = await shiftAssignments().find({ userId, effectiveFrom: { $gt: i.since } } as never).sort({ effectiveFrom: 1, createdAt: 1 }).toArray();
        const all = await shiftTemplates().find({ org: ctx.org } as never, { projection: { _id: 1, name: 1, updatedAt: 1, deletedAt: 1 } }).toArray();
        const nameOf = (id: ObjectId | null) => (id ? all.find((t) => t._id!.equals(id))?.name ?? 'a deleted template' : 'the org policy');
        const moves = rows.map((r) => ({ from: r.effectiveFrom, to: nameOf(r.templateId), pending: r.effectiveFrom > ctx.today }));
        const sinceDate = new Date(`${i.since}T00:00:00Z`);
        const tpl = all.find((t) => t.name === policy.shiftName);
        const edited = tpl?.updatedAt && tpl.updatedAt > sinceDate ? `${tpl.name} itself was edited on ${niceDate(tpl.updatedAt.toISOString().slice(0, 10))}, which changes the rules for everyone on it from that day.` : null;
        data.changesSince = { since: i.since, moves, templateEdited: edited, note: moves.length || edited ? undefined : `No shift changes for ${person.name} since ${niceDate(i.since)}.` };
      }
      return { data, links: [{ label: `Open ${person.name.split(' ')[0]}'s calendar`, userId, tab: 'calendar' }, { label: 'Open shift templates', view: 'shifttypes' }] };
    },
  },
  {
    name: 'prepare_assign_shift',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: move ${i.department ? `the ${i.department} department` : i.manager ? `${i.manager}'s reports` : Array.isArray(i.userIds) ? `${i.userIds.length} people` : Array.isArray(i.names) ? i.names.join(', ') : 'people'} to ${i.template}`,
    description: 'Prepare moving a person or a team to a shift template. Pick the team by userIds, names, a department, or a manager (their direct reports); filters combine. Changes nothing: it creates a "What will happen" card with each person\'s new policy (as their app will show it, from tomorrow) for HR to confirm; 10 or more people need the count typed to confirm.',
    input_schema: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' } }, names: { type: 'array', items: { type: 'string' } }, department: { type: 'string' }, manager: { type: 'string', description: "Manager's name or userId: their direct reports" }, template: { type: 'string', description: 'Shift template name' } }, required: ['template'] },
    api: { method: 'POST', path: '/admin/shifts/x/assign' },
    async run(ctx, i) {
      const tpl = await templateNamed(ctx, str(i.template));
      if (!tpl) throw new Error(`No shift template called "${str(i.template)}"`);
      if (!tpl.active) throw new Error(`${tpl.name} is inactive; make it active on Shift Templates first`);
      const { people, how } = await resolveTeam(ctx, i);
      return prepareMove(ctx, tpl, people.slice(0, 500), { summaryPrefix: people.length > 1 ? `${how[0].toUpperCase()}${how.slice(1)}: ` : '' });
    },
  },
);

defineExecutor('assign_shift', {
  async run(p) {
    const { templateId, templateName, userIds, byUserId } = p.payload as { templateId: string; templateName: string; userIds: string[]; byUserId: string };
    await assignShiftToUsers(byUserId, templateId, userIds);
    // Check what the app will read for them from tomorrow.
    const tomorrow = addDays(istToday(), 1);
    const seen = userIds[0] ? await appShowsLine(userIds[0], tomorrow, userIds.length === 1 ? 'Their' : 'Each app') : '';
    return { message: `${userIds.length === 1 ? 'Moved' : `Moved ${userIds.length} people`} to ${templateName} from ${niceDate(tomorrow)}. ${seen}`.trim() };
  },
  async undo(p) {
    const { templateId, userIds, byUserId, before } = p.payload as { templateId: string; userIds: string[]; byUserId: string; before: Record<string, string | null> };
    const back = new Map<string, string[]>();
    const toDefault: string[] = [];
    for (const id of userIds) { const b = before[id]; if (b) back.set(b, [...(back.get(b) ?? []), id]); else toDefault.push(id); }
    for (const [tid, ids] of back) if (ObjectId.isValid(tid)) await assignShiftToUsers(byUserId, tid, ids);
    if (toDefault.length) await unassignShiftUsers(byUserId, templateId, toDefault);
    const tomorrow = addDays(istToday(), 1);
    const seen = userIds[0] ? await appShowsLine(userIds[0], tomorrow, userIds.length === 1 ? 'Their' : 'Each app') : '';
    return `Put ${userIds.length === 1 ? 'them' : `${userIds.length} people`} back on their previous shift from ${niceDate(tomorrow)}. ${seen}`.trim();
  },
});
