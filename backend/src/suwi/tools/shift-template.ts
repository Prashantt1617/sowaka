// Shift templates in plain words: create one from a description (mapped to
// the fields createShift accepts, asking for what is missing), and explain
// one — every rule with its exact value — with a "what would happen if" for
// a sample punch, worked by the same functions that grade real days.
import { CORRECTION_OUTCOMES, DayMark, DEFAULT_LEAVE_TYPES, LeaveTypeRule, OUTSIDE_LOCATION_OUTCOMES, PUNCH_FORMATS, PUNCH_MODES, PunchFormat, ShiftPolicyRules, ShiftTemplate } from '../../models/shift.model';
import { markForDay, minutesAfterShiftStart, minutesBeforeShiftEnd } from '../../services/attendance.service';
import { createShift, defaultTemplateFor, deleteShift, getOrgShiftPolicy, leaveKeyFrom, mergeTemplatePolicy, policyForUser, ShiftPolicyView, shiftPolicyViewOf } from '../../services/shift.service';
import { offices, shiftTemplates, users } from '../../config/db';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { policyLines, templateNamed, weeklyOffWords } from './shifts';
import { isDate, norm } from './team';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MARKS: DayMark[] = ['Absent', 'Half Day', 'Present'];
const WEEKDAY: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const GEOTAG: PunchFormat = 'Geotag (powered by Sowaka)';

/** "9", "9am", "9:30 pm", "21:00" → "HH:MM", else ''. */
export function toTime(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::|\.)?(\d{2})?(am|pm)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  const t = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return TIME.test(t) ? t : '';
}

/** ["Sunday", "2nd Saturday", "4th Saturday"] → the week-of-month grid (0 = Mon). */
export function weeklyOffGrid(list: unknown): Record<string, number[]> | string {
  const grid: Record<string, number[]> = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  if (!Array.isArray(list)) return 'weeklyOff must be a list like ["Sunday", "2nd Saturday"]';
  for (const raw of list) {
    const s = String(raw).toLowerCase();
    const day = Object.keys(WEEKDAY).find((d) => s.includes(d));
    if (!day) return `I can't read "${raw}" as a weekday`;
    const weeks = [...s.matchAll(/([1-5])(?:st|nd|rd|th)/g)].map((m) => m[1]);
    const alternate = /alternate/.test(s) ? ['2', '4'] : [];
    for (const w of weeks.length ? weeks : alternate.length ? alternate : ['1', '2', '3', '4', '5']) {
      if (!grid[w].includes(WEEKDAY[day])) grid[w].push(WEEKDAY[day]);
    }
  }
  for (const w of Object.keys(grid)) grid[w].sort((a, b) => a - b);
  return grid;
}

/** The row the Shift Templates page shows, plus the columns its export adds. */
function pageRow(name: string, v: ShiftPolicyView, people: number) {
  return {
    Template: name, 'Shift window': `${v.startTime} – ${v.endTime}`, 'Employees using it': people,
    'Half day (hrs)': v.minHalfDayHours, 'Full day (hrs)': v.minFullDayHours,
    'Late after (min)': v.lateMarkingEnabled ? v.lateGraceMinutes : 'Not marked', 'Early before (min)': v.earlyMarkingEnabled ? v.earlyOutGraceMinutes : 'Not marked',
    'Punch format': v.correction.punchFormat, 'Overtime eligible': v.overtimeEligible ? 'Yes' : 'No',
  };
}

/** Every rule of a policy as {rule, value, means}: the field and its exact value, then what it does. */
export function explainPolicy(v: ShiftPolicyView) {
  const h = v.halfDay;
  return [
    { rule: 'Shift window', value: `startTime ${v.startTime}, endTime ${v.endTime}`, means: v.endTime <= v.startTime ? 'An overnight shift: it ends the next morning.' : `The working day runs ${v.startTime} to ${v.endTime}, India time.` },
    { rule: 'Late mark', value: `lateMarkingEnabled ${v.lateMarkingEnabled}, lateGraceMinutes ${v.lateGraceMinutes}`, means: v.lateMarkingEnabled ? `A punch-in more than ${v.lateGraceMinutes} min after ${v.startTime} is marked late, by the minutes past the grace. A late mark alone does not change the day; it counts towards any late rule in the paid days template.` : 'Nobody on this shift is marked late.' },
    { rule: 'Early mark', value: `earlyMarkingEnabled ${v.earlyMarkingEnabled}, earlyOutGraceMinutes ${v.earlyOutGraceMinutes}`, means: v.earlyMarkingEnabled ? `A punch-out more than ${v.earlyOutGraceMinutes} min before ${v.endTime} is an early exit.` : 'Nobody is marked as leaving early.' },
    { rule: 'Full-day hours', value: `minFullDayEnabled ${h.minFullDayEnabled}, minFullDayHours ${v.minFullDayHours}`, means: h.minFullDayEnabled ? `Fewer than ${v.minFullDayHours} h between punches is a half day.` : 'Hours worked do not decide a full day.' },
    { rule: 'Half-day hours', value: `minHalfDayEnabled ${h.minHalfDayEnabled}, minHalfDayHours ${v.minHalfDayHours}`, means: h.minHalfDayEnabled ? `Fewer than ${v.minHalfDayHours} h is not even a half day: absent.` : 'No minimum: any day with both punches is at least a half day.' },
    { rule: 'Very late arrival', value: `lateArrivalEnabled ${h.lateArrivalEnabled}, lateArrivalMinutes ${h.lateArrivalMinutes}`, means: h.lateArrivalEnabled ? `In more than ${h.lateArrivalMinutes} min after ${v.startTime} makes the day a half day.` : 'Arriving late never makes the day a half day by itself.' },
    { rule: 'Very early exit', value: `earlyLeaveEnabled ${h.earlyLeaveEnabled}, earlyLeaveMinutes ${h.earlyLeaveMinutes}`, means: h.earlyLeaveEnabled ? `Out more than ${h.earlyLeaveMinutes} min before ${v.endTime} makes the day a half day.` : 'Leaving early never makes the day a half day by itself.' },
    { rule: 'Missed punches', value: `missingPunchIn ${v.missingPunchIn}, missingPunchOut ${v.missingPunchOut}, missingBoth ${v.missingBoth}`, means: `A day with no punch-in counts as ${v.missingPunchIn}, no punch-out as ${v.missingPunchOut}; no punches at all is ${v.missingBoth}. That is what payroll pays it as.` },
    { rule: 'Weekly offs', value: JSON.stringify(v.weeklyOff), means: `${weeklyOffWords(v.weeklyOff)} (weeks counted from the 1st in blocks of seven).` },
    { rule: 'Punching', value: `punchFormat ${v.correction.punchFormat}, punchMode ${v.correction.punchMode}`, means: v.correction.punchFormat === 'Present by default (Auto Punch)' ? 'Nobody punches: every working day is present unless marked otherwise.' : v.correction.punchFormat === GEOTAG ? `Punches from the app need a location inside an office radius; outside, ${v.correction.outsideLocation.outcome === 'request' ? 'a request goes to the manager and the day is absent until approved' : 'the day is marked present with a remark'}.` : `Punches come from ${v.correction.punchFormat}${v.correction.punchMode === 'Single punch' ? ', one punch a day' : ', a punch in and a punch out'}.` },
    { rule: 'Corrections', value: `triggers ${v.correction.triggers.join(', ')}; backdateDays ${v.correction.backdateDays}; absentOutcomes ${v.correction.absentOutcomes.join(', ')}`, means: `An employee may ask to correct: ${v.correction.triggers.join(', ') || 'nothing'}, up to ${v.correction.backdateDays} days back; an absent day may become ${v.correction.absentOutcomes.join(' or ') || 'nothing'}, a half day only a full day.` },
    { rule: 'Leave', value: v.leaveTypes.map((t) => `${t.name} (apply ${t.advanceDays} days ahead${t.allowBackdated ? `, ${t.backdatedDays} back` : ''})`).join('; ') || 'none', means: v.leaveBalanceTracked ? 'Balances are tracked per type.' : 'Unlimited leave: no balance is kept.' },
    { rule: 'Overtime', value: `eligible ${v.overtimeEligible}, backdateDays ${v.overtimeBackdateDays}`, means: v.overtimeEligible ? `Overtime may be claimed up to ${v.overtimeBackdateDays} days back.` : 'No overtime on this shift.' },
  ];
}

/** "What would happen if": a sample punch graded on the policy's real fields, with the reason. */
export function whatIf(policy: ShiftPolicyRules, date: string, input: { punchIn?: string; punchOut?: string; hours?: number }) {
  const v = shiftPolicyViewOf({ ...policy, shiftName: null });
  const at = (t: string, plusDay = 0) => new Date(Date.parse(`${date}T${t}:00.000+05:30`) + plusDay * 86_400_000);
  const inT = input.punchIn ? toTime(input.punchIn) : '';
  let outT = input.punchOut ? toTime(input.punchOut) : '';
  if (input.punchIn && !inT) throw new Error(`I can't read "${input.punchIn}" as a time`);
  if (input.punchOut && !outT) throw new Error(`I can't read "${input.punchOut}" as a time`);
  let punchIn: Date | null = inT ? at(inT) : null;
  let punchOut: Date | null = null;
  const steps0: string[] = [];
  if (input.hours !== undefined) {
    punchIn = punchIn ?? at(policy.startTime);
    punchOut = new Date(punchIn.getTime() + input.hours * 3_600_000);
    outT = new Date(punchOut.getTime() + 5.5 * 3_600_000).toISOString().slice(11, 16);
    if (!inT) steps0.push(`Only hours given: taken as in at the ${policy.startTime} start and out ${input.hours} h later.`);
  } else if (outT) punchOut = at(outT, punchIn && outT <= inT ? 1 : 0);
  const steps: string[] = [...steps0];
  let lateMark = false;
  let earlyMark = false;
  if (punchIn) {
    const after = minutesAfterShiftStart(punchIn, policy.startTime);
    lateMark = v.lateMarkingEnabled && after > v.lateGraceMinutes;
    steps.push(after > 0
      ? `In at ${inT || policy.startTime}: ${after} min after the ${policy.startTime} start; grace is ${v.lateGraceMinutes} min, so ${!v.lateMarkingEnabled ? 'no late mark (late marking is off)' : lateMark ? `a late mark (late by ${after - v.lateGraceMinutes} min past grace)` : 'no late mark'}.`
      : `In at ${inT || policy.startTime}: on time (${-after} min before the start).`);
    if (v.halfDay.lateArrivalEnabled) steps.push(after > v.halfDay.lateArrivalMinutes ? `That is more than the ${v.halfDay.lateArrivalMinutes}-min very-late cut-off, so the day is a half day.` : `Under the ${v.halfDay.lateArrivalMinutes}-min very-late cut-off, so arrival alone does not make it a half day.`);
  }
  if (punchOut && policy.correction?.punchMode !== 'Single punch') {
    const before = minutesBeforeShiftEnd(punchOut, policy.startTime, policy.endTime);
    earlyMark = v.earlyMarkingEnabled && before > v.earlyOutGraceMinutes;
    steps.push(before > 0 ? `Out at ${outT}: ${before} min before the ${policy.endTime} end; early grace ${v.earlyOutGraceMinutes} min, so ${earlyMark ? 'an early exit' : 'not an early exit'}.` : `Out at ${outT}: at or after the end.`);
    if (punchIn) {
      const worked = Math.round(((punchOut.getTime() - punchIn.getTime()) / 3_600_000) * 100) / 100;
      steps.push(`${worked} h between punches: ${v.halfDay.minHalfDayEnabled && worked < v.minHalfDayHours ? `under the ${v.minHalfDayHours} h half-day minimum, so absent` : v.halfDay.minFullDayEnabled && worked < v.minFullDayHours ? `under the ${v.minFullDayHours} h full-day minimum, so a half day` : v.halfDay.minFullDayEnabled ? `at least ${v.minFullDayHours} h, enough for a full day` : 'hours are not checked on this shift'}.`);
    }
    if (v.halfDay.earlyLeaveEnabled && before > v.halfDay.earlyLeaveMinutes) steps.push(`Out more than the ${v.halfDay.earlyLeaveMinutes}-min very-early cut-off: a half day.`);
  } else if (punchIn && policy.correction?.punchMode !== 'Single punch') steps.push(`No punch-out: a missed punch, which this shift counts as ${v.missingPunchOut}.`);
  if (!punchIn && !punchOut) steps.push(`No punches: counts as ${v.missingBoth}.`);
  // The out-time a full day needs is counted from this punch-in, not the shift end.
  let fullDayOutAt: string | null = null;
  if (punchIn && v.halfDay.minFullDayEnabled && policy.correction?.punchMode !== 'Single punch') {
    fullDayOutAt = new Date(punchIn.getTime() + v.minFullDayHours * 3_600_000 + 5.5 * 3_600_000).toISOString().slice(11, 16);
    const [eh, em] = policy.endTime.split(':').map(Number);
    const cut = (((eh * 60 + em - v.earlyOutGraceMinutes) % 1440) + 1440) % 1440;
    const earlyCut = `${String(Math.floor(cut / 60)).padStart(2, '0')}:${String(cut % 60).padStart(2, '0')}`;
    steps.push(`For a full day, punch out at or after ${fullDayOutAt}: ${inT || policy.startTime} plus the ${v.minFullDayHours} h full-day minimum.${v.earlyMarkingEnabled ? ` Out before ${earlyCut} is also marked as an early exit.` : ''}`);
  }
  const mark = markForDay(policy, punchIn, punchOut);
  const lop = mark === 'Absent' ? 1 : mark === 'Half Day' ? 0.5 : 0;
  return { punchIn: inT || (punchIn ? policy.startTime : null), punchOut: outT || null, steps, dayMark: mark, lateMark, earlyExit: earlyMark, fullDayOutAt, lossOfPayDays: lop, answer: `${mark}${lateMark ? ', with a late mark' : ''}${earlyMark ? ', with an early exit' : ''}; costs ${lop} paid day${lop === 1 ? '' : 's'} by the calendar.` };
}

async function baseRules(ctx: SuwiContext): Promise<ShiftPolicyRules> {
  const def = await defaultTemplateFor(ctx.org);
  if (def?.policy) return def.policy;
  const { updatedAt: _u, updatedByUserId: _b, ...rules } = await getOrgShiftPolicy(ctx.org) as ShiftPolicyRules & { updatedAt?: Date; updatedByUserId?: string };
  return rules;
}

defineTools(
  {
    name: 'prepare_create_shift_template',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: new shift template ${i.name ?? ''}`.trim(),
    description: `Prepare creating a shift template from a plain-words description. Map what HR said to these fields; leave out what they didn't say (it is copied from the Default template): name; startTime/endTime ("9:30", "6:30pm"); lateGraceMinutes (or lateMarking false); earlyOutGraceMinutes (or earlyMarking false); minFullDayHours (under it = half day); minHalfDayHours (under it = absent); halfDayIfLateByMinutes; halfDayIfEarlyByMinutes; missingPunchIn/missingPunchOut/missingBoth (Absent | Half Day | Present); weeklyOff (list like ["Sunday", "2nd Saturday", "4th Saturday"]); punchFormat (${PUNCH_FORMATS.join(' | ')}); punchMode (${PUNCH_MODES.join(' | ')}); office and radiusMeters (geotag: which office; the radius belongs to the office); outsideLocation (request | present) and outsideLocationReasons; correctionBackdateDays; absentCorrectionOutcomes (${CORRECTION_OUTCOMES.join(', ')}); leaveTypes (list of {name, perMonth}); overtimeEligible. Returns {needs:[...]} for anything required that is missing; otherwise a card previewing the template as the Shift Templates page shows it.`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' },
        lateGraceMinutes: { type: 'number' }, lateMarking: { type: 'boolean' }, earlyOutGraceMinutes: { type: 'number' }, earlyMarking: { type: 'boolean' },
        minFullDayHours: { type: 'number' }, minHalfDayHours: { type: 'number' }, halfDayIfLateByMinutes: { type: 'number' }, halfDayIfEarlyByMinutes: { type: 'number' },
        missingPunchIn: { type: 'string', enum: MARKS }, missingPunchOut: { type: 'string', enum: MARKS }, missingBoth: { type: 'string', enum: MARKS },
        weeklyOff: { type: 'array', items: { type: 'string' } },
        punchFormat: { type: 'string', enum: PUNCH_FORMATS }, punchMode: { type: 'string', enum: PUNCH_MODES },
        office: { type: 'string' }, radiusMeters: { type: 'number' },
        outsideLocation: { type: 'string', enum: OUTSIDE_LOCATION_OUTCOMES }, outsideLocationReasons: { type: 'array', items: { type: 'string' } },
        correctionBackdateDays: { type: 'number' }, absentCorrectionOutcomes: { type: 'array', items: { type: 'string', enum: CORRECTION_OUTCOMES } },
        leaveTypes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, perMonth: { type: 'number' } }, required: ['name'] } },
        overtimeEligible: { type: 'boolean' },
      },
    },
    api: { method: 'POST', path: '/admin/shifts' },
    async run(ctx, i) {
      const needs: string[] = [];
      const problems: string[] = [];
      const name = str(i.name, 60);
      if (!name) needs.push('name');
      const startTime = toTime(i.startTime);
      const endTime = toTime(i.endTime);
      if (!i.startTime) needs.push('startTime'); else if (!startTime) problems.push(`I can't read "${i.startTime}" as a start time`);
      if (!i.endTime) needs.push('endTime'); else if (!endTime) problems.push(`I can't read "${i.endTime}" as an end time`);
      const format = str(i.punchFormat) as PunchFormat;
      if (format && !PUNCH_FORMATS.includes(format)) problems.push(`Punch format must be one of: ${PUNCH_FORMATS.join(', ')}`);
      const sites = await offices().find({ org: ctx.org, active: true }).toArray();
      const office = str(i.office) ? sites.find((o) => norm(o.name).includes(norm(i.office)) || norm(o.city).includes(norm(i.office))) : undefined;
      if (str(i.office) && !office) problems.push(`No active office matches "${str(i.office)}"; offices are set up on the Offices page (${sites.map((o) => o.name).join(', ') || 'none yet'})`);
      if (format === GEOTAG && !sites.length) needs.push('an office under Offices (geotag punches are checked against office locations; none is set up)');
      if (name) {
        const clash = await shiftTemplates().findOne({ org: ctx.org, name } as never);
        if (clash) problems.push(clash.deletedAt ? 'A deleted shift still holds that name; choose a different name' : `A shift called "${name}" already exists`);
      }
      const grid = i.weeklyOff !== undefined ? weeklyOffGrid(i.weeklyOff) : undefined;
      if (typeof grid === 'string') problems.push(grid);
      if (needs.length || problems.length) return { data: { needs, problems, message: [needs.length ? `To create the template I still need: ${needs.join('; ')}.` : '', problems.join('. ')].filter(Boolean).join(' ') } };

      const base = await baseRules(ctx);
      const policy: Record<string, unknown> = { startTime, endTime };
      const set = (k: string, v: unknown) => { if (v !== undefined) policy[k] = v; };
      set('lateGraceMinutes', i.lateGraceMinutes !== undefined ? Math.round(num(i.lateGraceMinutes, 0, 0, 720)) : undefined);
      set('lateMarkingEnabled', typeof i.lateMarking === 'boolean' ? i.lateMarking : i.lateGraceMinutes !== undefined ? true : undefined);
      set('earlyOutGraceMinutes', i.earlyOutGraceMinutes !== undefined ? Math.round(num(i.earlyOutGraceMinutes, 0, 0, 720)) : undefined);
      set('earlyMarkingEnabled', typeof i.earlyMarking === 'boolean' ? i.earlyMarking : i.earlyOutGraceMinutes !== undefined ? true : undefined);
      set('minFullDayHours', i.minFullDayHours !== undefined ? num(i.minFullDayHours, base.minFullDayHours, 0, 24) : undefined);
      set('minHalfDayHours', i.minHalfDayHours !== undefined ? num(i.minHalfDayHours, base.minHalfDayHours, 0, 24) : undefined);
      for (const k of ['missingPunchIn', 'missingPunchOut', 'missingBoth']) if (MARKS.includes(i[k] as DayMark)) policy[k] = i[k];
      if (grid) policy.weeklyOff = grid;
      const halfDay = { ...base.halfDay };
      if (i.minFullDayHours !== undefined) halfDay.minFullDayEnabled = true;
      if (i.minHalfDayHours !== undefined) halfDay.minHalfDayEnabled = true;
      if (i.halfDayIfLateByMinutes !== undefined) { halfDay.lateArrivalEnabled = true; halfDay.lateArrivalMinutes = Math.round(num(i.halfDayIfLateByMinutes, 120, 0, 720)); }
      if (i.halfDayIfEarlyByMinutes !== undefined) { halfDay.earlyLeaveEnabled = true; halfDay.earlyLeaveMinutes = Math.round(num(i.halfDayIfEarlyByMinutes, 60, 0, 720)); }
      policy.halfDay = halfDay;
      // Nested blocks are sent whole: the service validates them without merging over the base.
      const correction = { ...base.correction, ...(format ? { punchFormat: format } : {}), ...(PUNCH_MODES.includes(i.punchMode as never) ? { punchMode: i.punchMode } : {}) } as Record<string, unknown>;
      if (i.correctionBackdateDays !== undefined) correction.backdateDays = Math.round(num(i.correctionBackdateDays, 7, 0, 365));
      if (Array.isArray(i.absentCorrectionOutcomes)) correction.absentOutcomes = i.absentCorrectionOutcomes.filter((o) => CORRECTION_OUTCOMES.includes(o as never));
      if (i.outsideLocation !== undefined || Array.isArray(i.outsideLocationReasons)) {
        correction.outsideLocation = { outcome: OUTSIDE_LOCATION_OUTCOMES.includes(i.outsideLocation as never) ? i.outsideLocation : base.correction.outsideLocation?.outcome ?? 'request', reasons: Array.isArray(i.outsideLocationReasons) ? i.outsideLocationReasons.map(String) : base.correction.outsideLocation?.reasons ?? ['Working from home', 'Client visit', 'Out of office'] };
      }
      policy.correction = correction;
      policy.overtime = { ...base.overtime, ...(typeof i.overtimeEligible === 'boolean' ? { eligible: i.overtimeEligible } : {}) };
      if (Array.isArray(i.leaveTypes) && i.leaveTypes.length) {
        const known = [...(base.leave?.types ?? []), ...DEFAULT_LEAVE_TYPES];
        const types: LeaveTypeRule[] = (i.leaveTypes as { name?: unknown; perMonth?: unknown }[]).map((t) => {
          const nm = str(t.name, 40);
          const key = leaveKeyFrom(nm) || 'leave';
          const like = known.find((k) => k.key === key || norm(k.name) === norm(nm));
          return { ...(like ?? { key, name: nm, perMonth: 1, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none', encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 3 }), name: nm || like!.name, ...(t.perMonth !== undefined ? { perMonth: num(t.perMonth, 1, 0, 31) } : {}) } as LeaveTypeRule;
        });
        policy.leave = { ...base.leave, types };
      }
      const input = { name, active: true, policy, ...(format ? { punchFormat: format } : {}), ...(PUNCH_MODES.includes(i.punchMode as never) ? { punchMode: i.punchMode } : {}), ...(typeof i.overtimeEligible === 'boolean' ? { overtimeEligible: i.overtimeEligible } : {}) };

      // Preview: the template as the app and the Shift Templates page will read it.
      const draft = { name, policy: { ...base, ...policy } as ShiftPolicyRules, punchFormat: format || undefined, active: true, org: ctx.org, assignedUserIds: [], createdAt: new Date(), updatedAt: new Date() } as ShiftTemplate;
      const v = shiftPolicyViewOf(mergeTemplatePolicy(await getOrgShiftPolicy(ctx.org), draft));
      const fromDefault = Object.keys(policy).length < 12 ? `Anything not described is copied from the ${(await defaultTemplateFor(ctx.org))?.name ?? 'org'} template.` : '';
      const geotagLines = v.correction.punchFormat === GEOTAG ? [
        { text: `Geotag: punches must be inside an office radius (${(office ? [office] : sites).map((o) => `${o.name} ${o.radiusMeters} m`).join('; ')}).`, why: 'The radius belongs to the office on the Offices page and applies to everyone punching there; a template cannot set its own.' },
        ...(i.radiusMeters !== undefined && office && num(i.radiusMeters, 0) !== office.radiusMeters ? [{ text: `You asked for ${num(i.radiusMeters, 0)} m, but ${office.name} uses ${office.radiusMeters} m; change it on the Offices page if it should differ (it changes it for everyone there).`, tone: 'warn' as const }] : []),
      ] : (i.office || i.radiusMeters !== undefined ? [{ text: 'An office and radius only matter for geotag punching; this template does not use it.', tone: 'warn' as const }] : []);
      const proposalId = await propose(ctx, {
        kind: 'create_shift_template', area: 'attendance', title: `Create the ${name} shift template`,
        summary: `${policyLines(v).join(' ')} Nobody is on it yet.`,
        lines: [
          { text: `On Shift Templates it shows as: ${name} | ${v.startTime} – ${v.endTime} | 0 employees.` },
          ...policyLines(v).map((text) => ({ text })),
          ...geotagLines,
          ...(fromDefault ? [{ text: fromDefault, tone: 'info' as const }] : []),
          { text: `Nobody's app changes now; anyone moved to ${name} later sees it in their app from the day after the move.`, why: 'Shift moves always start the next day.' },
          { text: 'Undo deletes the template, as long as nobody has been moved to it. The name stays reserved by the deleted template.', tone: 'info' as const },
        ],
        undoable: true,
        payload: { byUserId: ctx.userId, input },
      });
      return { data: { prepared: true, preview: pageRow(name, v, 0), rules: policyLines(v), note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open shift templates', view: 'shifttypes' }] };
    },
  },
  {
    name: 'explain_shift_template',
    area: 'attendance',
    label: (i) => `How ${i.template ?? i.name ?? 'the shift'} works${i.punchIn || i.hours ? ' with a sample punch' : ''}`,
    description: 'Explain a shift template (by name, or the one a person is on via userId; default: the Default template): every rule in plain words with its exact field values. Optionally a "what would happen if" for a sample punch: punchIn ("10:12"), punchOut ("19:00"), or hours worked (3.5) → late mark yes/no and by how much, early exit, the day\'s mark (present / half day / absent) and its cost in paid days, worked by the same functions that grade real days.',
    input_schema: { type: 'object', properties: { template: { type: 'string' }, userId: { type: 'string' }, name: { type: 'string', description: "The person's name, for the label" }, date: { type: 'string', description: 'For a person: their policy on this date' }, punchIn: { type: 'string' }, punchOut: { type: 'string' }, hours: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/shifts' },
    async run(ctx, i) {
      const orgPolicy = await getOrgShiftPolicy(ctx.org);
      let policy: ShiftPolicyRules & { shiftName: string | null };
      let people = 0;
      if (str(i.userId)) {
        const u = await users().findOne({ org: ctx.org, userId: str(i.userId) }, { projection: { _id: 0, name: 1 } });
        if (!u) throw new Error('That person is not in this company');
        policy = await policyForUser(str(i.userId), isDate(i.date) ? i.date : ctx.today);
      } else {
        const tpl = str(i.template) ? await templateNamed(ctx, str(i.template)) : await defaultTemplateFor(ctx.org);
        if (!tpl) throw new Error(str(i.template) ? `No shift template called "${str(i.template)}"` : 'This company has no Default template');
        policy = mergeTemplatePolicy(orgPolicy, tpl);
        people = (tpl.assignedUserIds ?? []).length;
      }
      const v = shiftPolicyViewOf(policy);
      const sample = i.punchIn || i.punchOut || i.hours !== undefined
        ? whatIf(policy, ctx.today, { punchIn: str(i.punchIn) || undefined, punchOut: str(i.punchOut) || undefined, hours: i.hours !== undefined ? num(i.hours, 0, 0, 24) : undefined })
        : undefined;
      const data = { template: v.name, ...(sample ? { whatIf: sample } : {}), summary: policyLines(v), onPage: pageRow(v.name, v, people), rules: explainPolicy(v) };
      return { data, links: [{ label: 'Open shift templates', view: 'shifttypes' }] };
    },
  },
);

defineExecutor('create_shift_template', {
  async run(p) {
    const { byUserId, input } = p.payload as { byUserId: string; input: Record<string, unknown> };
    const made = await createShift(byUserId, input);
    return { message: `Created the ${made.name} shift template (${made.policy.startTime}–${made.policy.endTime}, ${made.punchFormat || made.policy.correction.punchFormat}). Nobody is on it, so no app changes yet; anyone moved to it sees ${made.name} in their app from the day after the move.`, undo: { id: made.id } };
  },
  async undo(p) {
    const { byUserId, input } = p.payload as { byUserId: string; input: { name: string } };
    await deleteShift(byUserId, String(p.undo?.id ?? ''));
    return `Deleted the ${input.name} shift template; nobody's app changed. Its name stays reserved by the deleted template.`;
  },
});

