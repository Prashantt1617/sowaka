// Editing an existing shift template from Suwi (24 Nov, Suwi training: time): timings, grace, the four
// half-day rules, missed-punch marks, punch format and mode, weekly offs, overtime, the correction
// window, or its name. The card shows each field that changes, before → after, and how many people the
// template grades. Confirm saves through updateShift, the service behind the Shift Templates page's
// Save; the template as it stood is kept on the proposal, so Undo saves it back the same way.
import { ObjectId } from 'mongodb';
import { shiftTemplates, users } from '../../config/db';
import { DayMark, PUNCH_FORMATS, PUNCH_MODES, PunchFormat, ShiftPolicyRules, ShiftTemplate } from '../../models/shift.model';
import { getOrgShiftPolicy, mergeTemplatePolicy, shiftPolicyViewOf, ShiftPolicyView, updateShift } from '../../services/shift.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { liveTemplates, templateNamed, weeklyOffWords } from './shifts';
import { toTime, weeklyOffGrid } from './shift-template';
import { ACTIVE, niceDate } from './team';

const MARKS: DayMark[] = ['Absent', 'Half Day', 'Present'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a template is saved with, so Undo can save it back exactly. */
export type TemplateSnapshot = { name: string; active: boolean; policy: ShiftPolicyRules; punchFormat?: string; punchMode?: string; overtimeEligible?: boolean };
export const snapshotOf = (t: ShiftTemplate): TemplateSnapshot => ({
  name: t.name, active: t.active, policy: t.policy,
  ...(t.punchFormat ? { punchFormat: t.punchFormat } : {}), ...(t.punchMode ? { punchMode: t.punchMode } : {}),
  ...(typeof t.overtimeEligible === 'boolean' ? { overtimeEligible: t.overtimeEligible } : {}),
});

/**
 * The body updateShift takes. It clears any capture override not sent, so the template's own are
 * passed back unless changed; policy keys not sent keep their value (toPolicyRules falls back per key).
 */
export function updateBody(t: ShiftTemplate, policy: Record<string, unknown>, extra: { name?: string; punchFormat?: string; punchMode?: string; overtimeEligible?: boolean } = {}) {
  const keep = snapshotOf(t);
  const pf = extra.punchFormat ?? keep.punchFormat;
  const pm = extra.punchMode ?? keep.punchMode;
  const ot = extra.overtimeEligible ?? keep.overtimeEligible;
  return { name: extra.name ?? t.name, active: t.active, policy, ...(pf ? { punchFormat: pf } : {}), ...(pm ? { punchMode: pm } : {}), ...(typeof ot === 'boolean' ? { overtimeEligible: ot } : {}) };
}

/** Saves a snapshot back (Undo). */
export async function restoreTemplate(byUserId: string, id: string, s: TemplateSnapshot) {
  return updateShift(byUserId, id, { name: s.name, active: s.active, policy: s.policy as unknown as Record<string, unknown>, ...(s.punchFormat ? { punchFormat: s.punchFormat } : {}), ...(s.punchMode ? { punchMode: s.punchMode } : {}), ...(typeof s.overtimeEligible === 'boolean' ? { overtimeEligible: s.overtimeEligible } : {}) });
}

/** How many people a template grades today: those assigned, plus everyone on no template for the Default. */
export async function peopleOn(ctx: SuwiContext, t: ShiftTemplate): Promise<number> {
  const assigned = (t.assignedUserIds ?? []).length;
  if (!t.isDefault) return assigned;
  const onSome = new Set((await liveTemplates(ctx)).filter((x) => x.active !== false).flatMap((x) => x.assignedUserIds ?? []));
  const everyone = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1 } }).toArray();
  return assigned + everyone.filter((u) => !onSome.has(u.userId)).length;
}

/** Each field as HR reads it on the Shift Templates page. */
function fieldsOf(v: ShiftPolicyView): Record<string, string> {
  const h = v.halfDay;
  return {
    Name: v.name,
    'Shift window': `${v.startTime} – ${v.endTime}`,
    'Late mark': v.lateMarkingEnabled ? `after ${v.lateGraceMinutes} min grace` : 'off',
    'Early mark': v.earlyMarkingEnabled ? `out more than ${v.earlyOutGraceMinutes} min before the end` : 'off',
    'Half day if worked under': h.minFullDayEnabled ? `${v.minFullDayHours} h` : 'off',
    'Absent if worked under': h.minHalfDayEnabled ? `${v.minHalfDayHours} h` : 'off',
    'Half day if late by more than': h.lateArrivalEnabled ? `${h.lateArrivalMinutes} min` : 'off',
    'Half day if out early by more than': h.earlyLeaveEnabled ? `${h.earlyLeaveMinutes} min` : 'off',
    'No punch-in counts as': v.missingPunchIn,
    'No punch-out counts as': v.missingPunchOut,
    'No punches counts as': v.missingBoth,
    'Weekly offs': weeklyOffWords(v.weeklyOff),
    'Punch format': v.correction.punchFormat,
    'Punch mode': v.correction.punchMode,
    Overtime: v.overtimeEligible ? 'allowed' : 'not allowed',
    'Corrections allowed back': `${v.correction.backdateDays} days`,
  };
}

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

defineTools({
  name: 'prepare_edit_shift_template',
  area: 'attendance',
  acts: true,
  label: (i) => `Prepared: change the ${i.template ?? ''} shift template`.replace(/\s+/g, ' '),
  description: `Prepare changing an EXISTING shift template (Shifts › Shift templates), e.g. "change grace on the General shift to 20 minutes", "make Saturday off on Night shift", "switch Field team to geotag punching". Give template (its name) and only the fields HR asked to change: newName; startTime/endTime ("9:30", "6:30pm"); lateGraceMinutes or lateMarking false; earlyOutGraceMinutes or earlyMarking false; minFullDayHours (under it = half day; halfDayIfUnderFullDay false switches that rule off); minHalfDayHours (under it = absent; absentIfUnderHalfDay false switches off); halfDayIfLateByMinutes (halfDayIfLate false switches off); halfDayIfEarlyByMinutes (halfDayIfEarly false switches off); missingPunchIn/missingPunchOut/missingBoth (Absent | Half Day | Present); weeklyOff (the WHOLE new list, like ["Sunday", "2nd Saturday", "4th Saturday"]); punchFormat (${PUNCH_FORMATS.join(' | ')}); punchMode (${PUNCH_MODES.join(' | ')}); overtimeEligible; correctionBackdateDays. Changes nothing until HR confirms: the card shows each changed field before → after and how many people are on the template. Undo puts the template back as it was. Leave types on a template are changed with prepare_leave_type_change; a NEW template is prepare_create_shift_template; moving people is prepare_assign_shift.`,
  input_schema: {
    type: 'object',
    properties: {
      template: { type: 'string', description: 'The template to change, by name' }, newName: { type: 'string' },
      startTime: { type: 'string' }, endTime: { type: 'string' },
      lateGraceMinutes: { type: 'number' }, lateMarking: { type: 'boolean' }, earlyOutGraceMinutes: { type: 'number' }, earlyMarking: { type: 'boolean' },
      minFullDayHours: { type: 'number' }, halfDayIfUnderFullDay: { type: 'boolean' }, minHalfDayHours: { type: 'number' }, absentIfUnderHalfDay: { type: 'boolean' },
      halfDayIfLateByMinutes: { type: 'number' }, halfDayIfLate: { type: 'boolean' }, halfDayIfEarlyByMinutes: { type: 'number' }, halfDayIfEarly: { type: 'boolean' },
      missingPunchIn: { type: 'string', enum: MARKS }, missingPunchOut: { type: 'string', enum: MARKS }, missingBoth: { type: 'string', enum: MARKS },
      weeklyOff: { type: 'array', items: { type: 'string' } },
      punchFormat: { type: 'string', enum: PUNCH_FORMATS }, punchMode: { type: 'string', enum: PUNCH_MODES },
      overtimeEligible: { type: 'boolean' }, correctionBackdateDays: { type: 'number' },
    },
    required: ['template'],
  },
  api: { method: 'PATCH', path: '/admin/shifts/x' },
  async run(ctx, i) {
    const tpl = await templateNamed(ctx, str(i.template, 60));
    if (!tpl) throw new Error(`No shift template called "${str(i.template, 60)}". Templates: ${(await liveTemplates(ctx)).map((t) => t.name).join(', ') || 'none'}`);
    const problems: string[] = [];
    const base = tpl.policy ?? (await getOrgShiftPolicy(ctx.org) as ShiftPolicyRules);
    const policy: Record<string, unknown> = {};
    const time = (k: 'startTime' | 'endTime') => {
      if (i[k] === undefined) return;
      const t = toTime(i[k]);
      if (!t) problems.push(`I can't read "${String(i[k])}" as a time`); else policy[k] = t;
    };
    time('startTime'); time('endTime');
    const mins = (v: unknown, what: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 720) { problems.push(`${what} must be a whole number of minutes, 0 to 720`); return undefined; }
      return n;
    };
    if (i.lateGraceMinutes !== undefined) { const n = mins(i.lateGraceMinutes, 'Late grace'); if (n !== undefined) { policy.lateGraceMinutes = n; policy.lateMarkingEnabled = true; } }
    if (bool(i.lateMarking) !== undefined) policy.lateMarkingEnabled = i.lateMarking;
    if (i.earlyOutGraceMinutes !== undefined) { const n = mins(i.earlyOutGraceMinutes, 'Early grace'); if (n !== undefined) { policy.earlyOutGraceMinutes = n; policy.earlyMarkingEnabled = true; } }
    if (bool(i.earlyMarking) !== undefined) policy.earlyMarkingEnabled = i.earlyMarking;
    const halfDay = { ...base.halfDay };
    // Only the half-day keys HR named go on the proposal, so Confirm lays them over the template as it is then.
    const halfDelta: Partial<typeof halfDay> = {};
    const setHalf = <K extends keyof typeof halfDay>(k: K, v: (typeof halfDay)[K] | undefined) => { if (v !== undefined) { halfDay[k] = v; halfDelta[k] = v; } };
    if (i.minFullDayHours !== undefined) { policy.minFullDayHours = num(i.minFullDayHours, base.minFullDayHours, 0, 24); setHalf('minFullDayEnabled', true); }
    if (i.minHalfDayHours !== undefined) { policy.minHalfDayHours = num(i.minHalfDayHours, base.minHalfDayHours, 0, 24); setHalf('minHalfDayEnabled', true); }
    setHalf('minFullDayEnabled', bool(i.halfDayIfUnderFullDay));
    setHalf('minHalfDayEnabled', bool(i.absentIfUnderHalfDay));
    if (i.halfDayIfLateByMinutes !== undefined) { const n = mins(i.halfDayIfLateByMinutes, 'Very-late cut-off'); if (n !== undefined) { setHalf('lateArrivalMinutes', n); setHalf('lateArrivalEnabled', true); } }
    setHalf('lateArrivalEnabled', bool(i.halfDayIfLate));
    if (i.halfDayIfEarlyByMinutes !== undefined) { const n = mins(i.halfDayIfEarlyByMinutes, 'Very-early cut-off'); if (n !== undefined) { setHalf('earlyLeaveMinutes', n); setHalf('earlyLeaveEnabled', true); } }
    setHalf('earlyLeaveEnabled', bool(i.halfDayIfEarly));
    if (Object.keys(halfDelta).length) policy.halfDay = halfDay;
    const full = Number(policy.minFullDayHours ?? base.minFullDayHours), half = Number(policy.minHalfDayHours ?? base.minHalfDayHours);
    if (full < half) problems.push('Full-day hours cannot be fewer than half-day hours');
    for (const k of ['missingPunchIn', 'missingPunchOut', 'missingBoth'] as const) {
      if (i[k] === undefined) continue;
      if (MARKS.includes(i[k] as DayMark)) policy[k] = i[k]; else problems.push(`${k} must be Absent, Half Day or Present`);
    }
    if (i.weeklyOff !== undefined) { const g = weeklyOffGrid(i.weeklyOff); if (typeof g === 'string') problems.push(g); else policy.weeklyOff = g; }
    if (i.correctionBackdateDays !== undefined) {
      const n = Number(i.correctionBackdateDays);
      if (!Number.isInteger(n) || n < 0 || n > 365) problems.push('Correction window must be a whole number of days, up to 365');
      // The correction block is validated whole, so it is sent whole.
      else policy.correction = { ...base.correction, backdateDays: n };
    }
    const extra: { name?: string; punchFormat?: string; punchMode?: string; overtimeEligible?: boolean } = {};
    if (str(i.newName, 60) && str(i.newName, 60) !== tpl.name) {
      extra.name = str(i.newName, 60);
      const clash = await shiftTemplates().findOne({ org: ctx.org, name: extra.name, _id: { $ne: tpl._id } } as never);
      if (clash) problems.push(`A shift called "${extra.name}" already exists`);
    }
    if (i.punchFormat !== undefined) { if (PUNCH_FORMATS.includes(i.punchFormat as PunchFormat)) extra.punchFormat = String(i.punchFormat); else problems.push(`Punch format must be one of: ${PUNCH_FORMATS.join(', ')}`); }
    if (i.punchMode !== undefined) { if (PUNCH_MODES.includes(i.punchMode as never)) extra.punchMode = String(i.punchMode); else problems.push(`Punch mode must be one of: ${PUNCH_MODES.join(', ')}`); }
    if (bool(i.overtimeEligible) !== undefined) extra.overtimeEligible = i.overtimeEligible as boolean;
    if (problems.length) return { data: { problems, message: problems.join('. ') } };

    const orgPolicy = await getOrgShiftPolicy(ctx.org);
    const before = fieldsOf(shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, tpl)));
    const draft = { ...tpl, name: extra.name ?? tpl.name, policy: { ...base, ...policy } as ShiftPolicyRules, ...(extra.punchFormat ? { punchFormat: extra.punchFormat } : {}), ...(extra.punchMode ? { punchMode: extra.punchMode } : {}), ...(extra.overtimeEligible !== undefined ? { overtimeEligible: extra.overtimeEligible } : {}) } as ShiftTemplate;
    const after = fieldsOf(shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, draft)));
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    if (!changed.length) return { data: { nothingToDo: true, message: `${tpl.name} already reads that way: nothing to change.`, now: before } };
    const people = await peopleOn(ctx, tpl);
    const from = ctx.today;
    const title = changed.length === 1 ? `${tpl.name}: ${changed[0].toLowerCase()} ${before[changed[0]]} → ${after[changed[0]]}` : `Change ${plural(changed.length, 'setting')} on the ${tpl.name} shift template`;
    const geotag = extra.punchFormat === 'Geotag (powered by Sowaka)';
    const proposalId = await propose(ctx, {
      kind: 'edit_shift_template', area: 'attendance', title,
      summary: `${changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join('; ')}. ${plural(people, 'person', 'people')} ${people === 1 ? 'is' : 'are'} on ${tpl.name}${tpl.isDefault ? ' (the Default: everyone not on another template)' : ''}.`,
      lines: [
        ...changed.map((k) => ({ text: `${k}: ${before[k]} → ${after[k]}.` })),
        { text: `Applies to the ${plural(people, 'person', 'people')} on ${tpl.name} as soon as it is saved: their app reads the new rules at once, and today's punches and every day still to come are graded on them (from ${niceDate(from)}).`, why: 'A template edit changes the template itself, the same as Save on the Shift Templates page. Days already graded in past months keep their marks; HR marks on a day still outrank it.' },
        ...(geotag ? [{ text: 'Geotag punching checks each punch against an office radius on the Offices page; set the offices up first if there are none.', tone: 'warn' as const }] : []),
        ...(changed.includes('Weekly offs') ? [{ text: 'Weekly offs change which days count as working days, so leave counts and loss of pay follow from now on.', tone: 'info' as const }] : []),
        { text: 'Undo saves the template back exactly as it is now.', tone: 'info' as const },
      ],
      effectiveFrom: from, undoable: true,
      preview: { field: tpl.name, rows: changed.map((k) => ({ name: k, current: before[k], next: after[k] })), skipped: [] },
      payload: { byUserId: ctx.userId, templateId: tpl._id!.toHexString(), templateName: tpl.name, policy: { ...policy, ...(policy.halfDay ? { halfDay: halfDelta } : {}) }, extra, changed },
    });
    return { data: { prepared: true, title, template: tpl.name, people, changes: changed.map((k) => ({ field: k, before: before[k], after: after[k] })), note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open shift templates', view: 'shifttypes' }] };
  },
});

defineExecutor('edit_shift_template', {
  async run(p) {
    const { byUserId, templateId, policy, extra, changed } = p.payload as { byUserId: string; templateId: string; templateName: string; policy: Record<string, unknown>; extra: Record<string, string | boolean>; changed: string[] };
    const now = await shiftTemplates().findOne({ _id: new ObjectId(templateId), deletedAt: { $exists: false } } as never);
    if (!now) throw new Error('That shift template no longer exists');
    // Nested blocks are laid over the template as it stands at Confirm, not as it was when prepared.
    const body = { ...policy };
    if (body.halfDay) body.halfDay = { ...now.policy?.halfDay, ...(policy.halfDay as object) };
    if (body.correction) body.correction = { ...now.policy?.correction, backdateDays: (policy.correction as { backdateDays: number }).backdateDays };
    const saved = await updateShift(byUserId, templateId, updateBody(now, body, extra as never));
    return { message: `Saved ${saved.name}: ${changed.join(', ').toLowerCase()} changed. The people on it see the new rules in their app now.`, undo: { before: snapshotOf(now) } };
  },
  async undo(p) {
    const { byUserId, templateId } = p.payload as { byUserId: string; templateId: string };
    const before = (p.undo as { before: TemplateSnapshot }).before;
    await restoreTemplate(byUserId, templateId, before);
    return `Put the ${before.name} shift template back as it was.`;
  },
});
