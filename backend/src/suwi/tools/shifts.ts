// Shifts: which template people are on, and the first action Suwi can take —
// moving people to a shift template. The card spells out, in plain words, the
// policy each person's app will show from tomorrow; Confirm moves them through
// the same service the Bulk Assign page uses, and Undo moves them back.
import { ObjectId } from 'mongodb';
import { shiftTemplates, users } from '../../config/db';
import { assignShiftToUsers, getOrgShiftPolicy, mergeTemplatePolicy, policyForUser, shiftPolicyViewOf, unassignShiftUsers } from '../../services/shift.service';
import { defineTools, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A policy in a sentence or three, as HR and the employee read it. */
export function policySummary(v: ReturnType<typeof shiftPolicyViewOf>): string {
  const parts = [`${v.startTime}–${v.endTime}`];
  if (v.lateMarkingEnabled) parts.push(`${v.lateGraceMinutes ?? 0} minutes' grace`);
  else parts.push('no late marks');
  if (v.minHalfDayHours) parts.push(`under ${v.minFullDayHours ?? '?'} h is a half day, under ${v.minHalfDayHours} h absent`);
  const offs = (v.weeklyOff as unknown as Record<string, number[]> | number[] | undefined);
  const offDays = Array.isArray(offs) ? offs : offs && typeof offs === 'object' ? Object.entries(offs).filter(([, w]) => Array.isArray(w) && w.length >= 4).map(([d]) => d) : [];
  if (offDays.length) parts.push(`${offDays.map((d) => DAYS[Number(d)] ?? d).join(' and ')} off`);
  parts.push(`punches by ${String(v.correction?.punchFormat ?? 'app').toLowerCase()}`);
  if (v.leaveTypes?.length) parts.push(`leave types: ${v.leaveTypes.map((t) => t.name).join(', ')}`);
  return `${v.name}: ${parts.join('; ')}.`;
}

async function templateNamed(ctx: SuwiContext, name: string) {
  const all = await shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false } } as never).toArray();
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return all.find((t) => t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === n) ?? all.filter((t) => t.name.toLowerCase().includes(n)).sort((a, b) => a.name.length - b.name.length)[0];
}

defineTools(
  {
    name: 'shift_templates',
    area: 'attendance',
    label: () => 'Shift templates and who is on them',
    description: 'The shift templates in this company: name, timings, how many people are on each, which is the Default, and (if asked) everyone not explicitly assigned to a template.',
    input_schema: { type: 'object', properties: { includeUnassigned: { type: 'boolean' } } },
    api: { method: 'GET', path: '/admin/shifts' },
    async run(ctx, i) {
      const all = await shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false } } as never).toArray();
      const assigned = new Set(all.flatMap((t) => t.assignedUserIds ?? []));
      const data: Record<string, unknown> = {
        templates: all.map((t) => ({ name: t.name, people: (t.assignedUserIds ?? []).length, isDefault: Boolean((t as { isDefault?: boolean }).isDefault), start: t.policy?.startTime, end: t.policy?.endTime })),
      };
      if (i.includeUnassigned) {
        const people = await users().find({ org: ctx.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, { projection: { _id: 0, userId: 1, name: 1, department: 1 } }).toArray();
        const un = people.filter((p) => !assigned.has(p.userId));
        data.notAssigned = { count: un.length, people: un.slice(0, 40) };
      }
      return { data, links: [{ label: 'Open shift templates', view: 'shifttypes' }, { label: 'Open bulk assign', view: 'shiftbulk' }] };
    },
  },
  {
    name: 'prepare_assign_shift',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: move ${Array.isArray(i.userIds) ? i.userIds.length : 0} to ${i.template}`,
    description: 'Prepare moving one or more people to a shift template. Changes nothing: it creates a "What will happen" card with each person\'s new policy (as their app will show it, from tomorrow) for HR to confirm. Find userIds with search_people first.',
    input_schema: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' } }, template: { type: 'string', description: 'Shift template name' } }, required: ['userIds', 'template'] },
    api: { method: 'POST', path: '/admin/shifts/x/assign' },
    async run(ctx, i) {
      const ids = Array.isArray(i.userIds) ? [...new Set(i.userIds.map(String))].slice(0, 500) : [];
      if (!ids.length) throw new Error('No people given');
      const tpl = await templateNamed(ctx, str(i.template));
      if (!tpl) throw new Error(`No shift template called "${str(i.template)}"`);
      const people = await users().find({ org: ctx.org, userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
      if (people.length !== ids.length) throw new Error('Some of those people are not in this company');
      const from = addDays(ctx.today, 1);
      const orgPolicy = await getOrgShiftPolicy(ctx.org);
      const after = shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, tpl));
      // What each is on now, so the card can say what changes and Undo can put it back.
      const current = await shiftTemplates().find({ org: ctx.org, assignedUserIds: { $in: ids } } as never, { projection: { _id: 1, name: 1, assignedUserIds: 1 } }).toArray();
      const before = Object.fromEntries(ids.map((id) => [id, current.find((t) => (t.assignedUserIds ?? []).includes(id))]));
      const already = ids.filter((id) => before[id]?._id?.equals(tpl._id!));
      const moving = people.filter((p) => !already.includes(p.userId));
      if (!moving.length) return { data: { nothingToDo: true, message: `Everyone named is already on ${tpl.name}.` } };
      const nowPolicy = moving.length === 1 ? shiftPolicyViewOf(await policyForUser(moving[0].userId)) : null;
      const who = moving.length === 1 ? moving[0].name : `${moving.length} people`;
      const proposalId = await propose(ctx, {
        kind: 'assign_shift', area: 'attendance', title: `Move ${who} to ${tpl.name}`,
        summary: `From ${from}, ${policySummary(after)}${nowPolicy ? ` Today ${moving[0].name.split(' ')[0]} is on ${nowPolicy.name} (${nowPolicy.startTime}–${nowPolicy.endTime}).` : ''}`,
        lines: [
          { text: `Starts tomorrow (${from}); today stays on the current shift.`, why: 'A shift change always starts the next day, so a day already underway is never re-marked under rules nobody knew about.' },
          { text: `Late marks, half days and absences are graded on ${after.startTime}–${after.endTime} from then on.` },
          { text: `${moving.length === 1 ? 'Their' : 'Each person\'s'} app shows the new shift, weekly offs and leave types from ${from}, and they get a notification.` },
          ...(already.length ? [{ text: `${already.length} already on ${tpl.name}; left as they are.`, tone: 'info' as const }] : []),
          ...(moving.length > 1 ? [{ text: `People: ${moving.slice(0, 8).map((p) => p.name).join(', ')}${moving.length > 8 ? ` and ${moving.length - 8} more` : ''}.` }] : []),
        ],
        effectiveFrom: from, undoable: true, typeToConfirm: moving.length >= 10 ? String(moving.length) : undefined,
        payload: { templateId: tpl._id!.toHexString(), templateName: tpl.name, userIds: moving.map((p) => p.userId), byUserId: ctx.userId, before: Object.fromEntries(moving.map((p) => [p.userId, before[p.userId]?._id?.toHexString() ?? null])) },
      });
      return { data: { prepared: true, title: `Move ${who} to ${tpl.name}`, from, newPolicy: policySummary(after), people: moving.length, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
    },
  },
);

defineExecutor('assign_shift', {
  async run(p) {
    const { templateId, templateName, userIds, byUserId } = p.payload as { templateId: string; templateName: string; userIds: string[]; byUserId: string };
    await assignShiftToUsers(byUserId, templateId, userIds);
    // Check what the app will read for them from tomorrow.
    const first = userIds[0];
    const tomorrow = addDays(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), 1);
    const seen = first ? (await policyForUser(first, tomorrow)).shiftName : null;
    return { message: `${userIds.length === 1 ? 'Moved' : `Moved ${userIds.length} people`} to ${templateName} from ${tomorrow}.${seen ? ` Their app now shows ${seen} from that day.` : ''}` };
  },
  async undo(p) {
    const { templateId, userIds, byUserId, before } = p.payload as { templateId: string; userIds: string[]; byUserId: string; before: Record<string, string | null> };
    const back = new Map<string, string[]>();
    const toDefault: string[] = [];
    for (const id of userIds) { const b = before[id]; if (b) back.set(b, [...(back.get(b) ?? []), id]); else toDefault.push(id); }
    for (const [tid, ids] of back) if (ObjectId.isValid(tid)) await assignShiftToUsers(byUserId, tid, ids);
    if (toDefault.length) await unassignShiftUsers(byUserId, templateId, toDefault);
    return `Put ${userIds.length === 1 ? 'them' : `${userIds.length} people`} back on their previous shift from tomorrow.`;
  },
});
