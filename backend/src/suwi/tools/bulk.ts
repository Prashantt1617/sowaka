// Bulk assign: the same thing to many people at once, through Suwi only.
//
// One tool takes what to assign (a shift, an attendance source, a reporting
// manager, a department, a KPI template or a paid days template) and who gets
// it (everyone, a department, location, designation, manager's reports, names,
// or the employee IDs of an attached sheet). People it can't match are listed
// with the reason instead of failing the whole request. The card always shows
// a table of each person's current and new value.
//
// Shift, attendance source, KPI and paid days moves are prepared by the tools
// that already own them, so their rules (a shift starts tomorrow, KPI from the
// next cycle, paid days only with a salary) and their Undo stay as they are;
// this adds the table. Manager and department have their own executors here.
// Attendance source and leave policy live on the shift template, so setting a
// source is a move to the template that has it.
import { ObjectId } from 'mongodb';
import { paidDaysTemplates, salaryStructures, users } from '../../config/db';
import { updateEmployeeDetailsForAdmin } from '../../services/admin.service';
import { listKpiTemplates } from '../../services/kpi.service';
import { ensurePaidDaysTemplates } from '../../services/paidDaysTemplate.service';
import { assignManager, removeManager } from '../../services/reporting.service';
import { getOrgShiftPolicy, mergeTemplatePolicy, shiftPolicyViewOf } from '../../services/shift.service';
import type { ShiftTemplate } from '../../models/shift.model';
import { defineExecutor, propose } from '../proposals';
import { proposalsCol } from '../store';
import { defineTools, str, SuwiContext, toolAllowed, toolByName, type SuwiLink, type ToolOutput } from '../tools';
import type { SheetField } from '../sheet';
import { currentAssignments, cycles } from './kpi-templates';
import { orgPathOf, teamOf, type Person } from './people';
import { currentTemplatesFor, liveTemplates, prepareMove, templateNamed } from './shifts';
import { ACTIVE, norm } from './team';

const FIELDS = ['shift', 'attendance_source', 'reporting_manager', 'department', 'kpi_template', 'paid_days_template'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LABEL: Record<Field, string> = {
  shift: 'Shift', attendance_source: 'Attendance source', reporting_manager: 'Reporting manager',
  department: 'Department', kpi_template: 'KPI template', paid_days_template: 'Paid days template',
};
const SOURCES: Record<string, string> = {
  biometric: 'Biometric', geotag: 'Geotag (powered by Sowaka)', geo: 'Geotag (powered by Sowaka)',
  'in app': 'In-app punch in', app: 'In-app punch in', auto: 'Present by default (Auto Punch)', 'present by default': 'Present by default (Auto Punch)',
};
const sourceOf = (v: unknown) => {
  const k = norm(v);
  return Object.entries(SOURCES).find(([alias]) => k === alias || k.startsWith(alias))?.[1] ?? null;
};

type Picked = Person & { lifecycleStatus?: string };
type Skip = { who: string; reason: string };
const PROJECTION = { _id: 0, userId: 1, name: 1, employeeId: 1, email: 1, designation: 1, department: 1, location: 1, branch: 1, managerUserId: 1 } as const;

/**
 * Who a bulk change is for. Lists (names, employee IDs, userIds) are matched
 * one by one, and what can't be matched is skipped with the reason; filters
 * (department, location, designation, manager) narrow the lists, or the whole
 * company when no list is given. `everyone` is the whole active roll.
 */
export async function resolveBulk(ctx: SuwiContext, i: Record<string, unknown>) {
  const all = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: PROJECTION }).toArray() as unknown as Picked[];
  const byId = new Map(all.map((p) => [p.userId, p]));
  const skipped: Skip[] = [];
  const how: string[] = [];
  const listed = new Map<string, Picked>();
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean) : []);

  for (const id of list(i.employeeIds)) {
    const p = all.find((x) => norm(x.employeeId) === norm(id));
    if (p) listed.set(p.userId, p); else skipped.push({ who: id, reason: 'No active employee with this employee ID' });
  }
  for (const id of list(i.userIds)) {
    const p = byId.get(id);
    if (p) listed.set(p.userId, p); else skipped.push({ who: id, reason: 'Not an active employee here' });
  }
  for (const n of list(i.names)) {
    const k = norm(n);
    const exact = all.filter((p) => norm(p.name) === k || norm(p.email) === k);
    const loose = exact.length ? exact : all.filter((p) => norm(p.name).includes(k));
    if (loose.length === 1) listed.set(loose[0].userId, loose[0]);
    else skipped.push({ who: n, reason: loose.length ? `Matches ${loose.length} people (${loose.slice(0, 3).map((p) => p.name).join(', ')}); give the employee ID` : 'Nobody by this name on the active roll' });
  }
  // The attached sheet's rows, matched by employee ID, else email, else a name only one person has.
  const rowValue = new Map<string, Partial<Record<SheetField, string>>>();
  const sheet = i.fromSheet === true ? ctx.sheet : undefined;
  if (i.fromSheet === true && !sheet) throw new Error('No sheet is attached. Attach the Excel with an Employee ID column using the paperclip, then ask again.');
  if (sheet) {
    for (const r of sheet.rows) {
      const byName = r.name ? all.filter((x) => norm(x.name) === norm(r.name)) : [];
      const p = (r.employeeId ? all.find((x) => norm(x.employeeId) === norm(r.employeeId)) : undefined)
        ?? (r.email ? all.find((x) => (x.email ?? '').toLowerCase() === r.email) : undefined)
        ?? (!r.employeeId && !r.email && byName.length === 1 ? byName[0] : undefined);
      const who = `Row ${r.row}${r.employeeId ? ` (${r.employeeId})` : r.email ? ` (${r.email})` : r.name ? ` (${r.name})` : ''}`;
      if (!p) { skipped.push({ who, reason: r.employeeId ? 'No active employee with this employee ID' : r.email ? 'No active employee with this email' : byName.length > 1 ? `${byName.length} people have this name; add an Employee ID column` : 'Nobody by this name on the active roll' }); continue; }
      if (rowValue.has(p.userId)) { skipped.push({ who, reason: `${p.name} is listed twice; the first row is used` }); continue; }
      listed.set(p.userId, p);
      rowValue.set(p.userId, r.values);
    }
  }
  const anyList = list(i.employeeIds).length + list(i.userIds).length + list(i.names).length > 0 || Boolean(sheet);
  if (anyList) how.push(sheet ? `the ${listed.size} people in ${sheet.file}` : `${listed.size} named`);

  let picked: Picked[] = anyList ? [...listed.values()] : i.everyone === true ? all : [];
  const filters: [string, (p: Picked) => boolean, string][] = [];
  const dep = norm(i.department);
  if (dep) filters.push(['department', (p) => norm(p.department) === dep || norm(p.department).includes(dep), `the ${str(i.department)} department`]);
  const loc = norm(i.location);
  if (loc) filters.push(['location', (p) => norm(p.location).includes(loc) || norm(p.branch).includes(loc), `the ${str(i.location)} office`]);
  const des = norm(i.designation);
  if (des) filters.push(['designation', (p) => norm(p.designation).includes(des), `${str(i.designation)}s`]);
  const mgrRef = str(i.manager);
  if (mgrRef) {
    const k = norm(mgrRef);
    const m = byId.get(mgrRef) ?? all.filter((p) => norm(p.name) === k)[0] ?? all.filter((p) => norm(p.name).includes(k))[0];
    if (!m) throw new Error(`No manager called "${mgrRef}"`);
    filters.push(['manager', (p) => p.managerUserId === m.userId, `${m.name}'s reports`]);
  }
  if (filters.length) {
    const base = anyList || i.everyone === true ? picked : all;
    picked = base.filter((p) => filters.every(([, f]) => f(p)));
    how.push(...filters.map(([, , words]) => words));
  } else if (i.everyone === true && !anyList) how.push(`everyone (${all.length})`);
  if (!anyList && !filters.length && i.everyone !== true) throw new Error('Say who gets it: everyone, a department, location, designation, a manager\'s reports, names, or the employee IDs from the attached sheet');
  return { people: picked.slice(0, 1000), skipped, how: how.join(' in ') || 'the people named', all, rowValue };
}

const tableOf = (field: Field, rows: { name: string; current: string; next: string }[], skipped: Skip[]) => ({ field: FIELD_LABEL[field], rows: rows.slice(0, 300), skipped: skipped.slice(0, 100) });

/** Runs the tool that owns this kind of move, then puts the table on its card. */
async function delegate(ctx: SuwiContext, tool: string, input: Record<string, unknown>, preview: ReturnType<typeof tableOf>): Promise<ToolOutput> {
  const t = toolByName(tool);
  if (!t) throw new Error(`Suwi has no ${tool} tool`);
  if (!toolAllowed(ctx, t)) throw new Error(`Suwi isn't allowed to make ${t.area} changes in this company. Settings › Suwi can allow it.`);
  const out = await t.run(ctx, input);
  if (out.proposalId) await proposalsCol().updateOne({ _id: new ObjectId(out.proposalId) }, { $set: { preview } });
  return { ...out, data: { ...(out.data as object), preview: { field: preview.field, changing: preview.rows.filter((r) => r.current !== r.next).length, skipped: preview.skipped } } };
}

defineTools({
  name: 'prepare_bulk_assign',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: bulk ${FIELD_LABEL[i.field as Field] ?? 'change'} → ${i.value ?? ''}`,
  description: [
    'Bulk assign: give many people the same shift, attendance source, reporting manager, department, KPI template or paid days template in one card.',
    'Picked people with any of: everyone, department, location, designation, manager (their direct reports), names, employeeIds (e.g. the Employee ID column of an attached sheet: pass every ID in it), userIds. Lists are matched one by one and unmatched rows come back in `skipped` with the reason; filters narrow the lists.',
    'Changes nothing: it creates a card with a table of each person\'s current and new value and the rows that were skipped, for HR to confirm. Tell HR how many change, how many already have it, and each skipped row with its reason.',
    'Attendance source and leave policy belong to the shift template: setting a source moves people to the template that uses it (asks which if several do). A shift starts tomorrow; a KPI template applies from the next cycle; a paid days template needs a salary assigned.',
    'Full name and work email can\'t be bulk assigned.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      field: { type: 'string', enum: [...FIELDS] },
      value: { type: 'string', description: 'Empty with fromSheet to take each row\'s value from the sheet. Otherwise: shift template name; Biometric / Geotag / In-app / Auto punch; the manager\'s name or employee ID; department name; KPI template name; paid days template name' },
      template: { type: 'string', description: 'For attendance_source when several templates use that source: which one' },
      fromSheet: { type: 'boolean', description: 'The people are the rows of the attached sheet (matched by its Employee ID, email or name column). Leave value empty to use each row\'s own value from the sheet\'s column for this field.' },
      everyone: { type: 'boolean' },
      department: { type: 'string' },
      location: { type: 'string' },
      designation: { type: 'string' },
      manager: { type: 'string', description: 'Picked the direct reports of this manager (name or userId)' },
      names: { type: 'array', items: { type: 'string' } },
      employeeIds: { type: 'array', items: { type: 'string' } },
      userIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['field'],
  },
  api: { method: 'PATCH', path: '/admin/employees/x' },
  async run(ctx, i) {
    const field = FIELDS.find((f) => f === i.field);
    if (!field) {
      if (/name|email/i.test(String(i.field))) throw new Error('Full name and work email can\'t be changed in bulk, or through Suwi.');
      throw new Error(`Bulk assign covers ${FIELDS.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}`);
    }
    const value = str(i.value, 120);
    const picked = await resolveBulk(ctx, i);
    const column = !value && i.fromSheet === true ? ctx.sheet?.fieldColumns[field] : undefined;
    if (!value && !column) throw new Error(`Say which ${FIELD_LABEL[field].toLowerCase()} to assign${ctx.sheet ? `, or add a ${FIELD_LABEL[field]} column to the sheet` : ''}`);
    if (!column) return prepareOne(ctx, field, value, picked, i);

    // A value per row: one card for each value; the sheet's skipped rows go on the first card made.
    const groups = new Map<string, { value: string; people: Picked[] }>();
    const noValue: Skip[] = [];
    for (const p of picked.people) {
      const v = (picked.rowValue.get(p.userId)?.[field] ?? '').trim();
      if (!v) { noValue.push({ who: p.name, reason: `No ${FIELD_LABEL[field].toLowerCase()} in the "${column}" column` }); continue; }
      const g = groups.get(norm(v)) ?? { value: v, people: [] };
      g.people.push(p);
      groups.set(norm(v), g);
    }
    if (!groups.size) return { data: { nothingToDo: true, skipped: [...picked.skipped, ...noValue], message: `The "${column}" column is empty for everyone matched.` } };
    if (groups.size > 10) throw new Error(`The "${column}" column has ${groups.size} different values; Suwi prepares up to 10 cards at a time. Split the sheet, or say one value for everyone.`);
    const cards: { value: string; data: unknown; proposalId?: string; links?: SuwiLink[] }[] = [];
    for (const g of groups.values()) {
      try {
        const out = await prepareOne(ctx, field, g.value, { ...picked, people: g.people, skipped: [], how: `${g.people.length} in ${ctx.sheet!.file} with ${g.value}` }, i);
        cards.push({ value: g.value, data: out.data, proposalId: out.proposalId, links: out.links });
      } catch (e) {
        cards.push({ value: g.value, data: { error: (e as Error).message, people: g.people.map((p) => p.name) } });
      }
    }
    const allSkipped = [...picked.skipped, ...noValue];
    const firstCard = cards.find((c) => c.proposalId);
    if (firstCard && allSkipped.length) {
      await proposalsCol().updateOne({ _id: new ObjectId(firstCard.proposalId) }, { $set: { 'preview.skipped': allSkipped.slice(0, 100) } });
    }
    return {
      data: { cards: cards.map((c) => ({ value: c.value, ...(c.data as object) })), skipped: allSkipped },
      proposalIds: cards.map((c) => c.proposalId).filter((x): x is string => Boolean(x)),
      links: cards.flatMap((c) => c.links ?? []),
    };
  },
});

/** One bulk card: everyone in `picked` gets `value`. */
async function prepareOne(ctx: SuwiContext, field: Field, value: string, picked: Awaited<ReturnType<typeof resolveBulk>>, i: Record<string, unknown>): Promise<ToolOutput> {
  const { people, skipped, how, all } = picked;
  if (!people.length) return { data: { nothingToDo: true, skipped, message: skipped.length ? 'Nobody could be matched; see skipped.' : 'Nobody matched all of those filters.' } };
  const ids = people.map((p) => p.userId);
  const nameOf = new Map(all.map((p) => [p.userId, p.name]));

  if (field === 'shift' || field === 'attendance_source') {
    const live = (await liveTemplates(ctx)).filter((t) => t.active);
    const orgPolicy = await getOrgShiftPolicy(ctx.org);
    const def = live.find((t) => t.isDefault);
    const formatOf = (t: ShiftTemplate | undefined) => shiftPolicyViewOf(mergeTemplatePolicy(orgPolicy, t ?? def ?? null)).correction.punchFormat;
    const current = await currentTemplatesFor(ctx, ids);
    const now = (id: string) => current[id] ?? def;
    let target: ShiftTemplate | undefined;
    if (field === 'shift') {
      target = await templateNamed(ctx, value);
      if (!target) return { data: { needs: ['value'], options: live.map((t) => t.name), message: `No shift template called "${value}".` } };
    } else {
      const format = sourceOf(value);
      if (!format) return { data: { needs: ['value'], options: ['Biometric', 'Geotag', 'In-app', 'Auto punch'], message: `"${value}" isn't an attendance source.` } };
      const using = live.filter((t) => formatOf(t) === format);
      target = i.template ? using.find((t) => norm(t.name) === norm(i.template) || norm(t.name).includes(norm(i.template))) : using.length === 1 ? using[0] : undefined;
      if (!target) {
        return { data: { needs: using.length ? ['template'] : ['create_template'], options: using.map((t) => t.name), message: using.length ? `${using.length} shift templates use ${format}: ${using.map((t) => t.name).join(', ')}. Ask which one; the attendance source comes with the template, and so do its timings and leave types.` : `No shift template uses ${format} yet. A source comes with a shift template, so create one first (prepare_create_shift_template).` } };
      }
    }
    const rows = people.map((p) => ({
      name: p.name,
      current: field === 'shift' ? now(p.userId)?.name ?? 'Default' : `${formatOf(now(p.userId))} (${now(p.userId)?.name ?? 'Default'})`,
      next: field === 'shift' ? target!.name : `${formatOf(target)} (${target!.name})`,
    }));
    const preview = tableOf(field, rows, skipped);
    if (field === 'shift') return delegate(ctx, 'prepare_assign_shift', { userIds: ids, template: target.name }, preview);
    const t = toolByName('prepare_assign_shift');
    if (t && !toolAllowed(ctx, t)) throw new Error('Suwi isn\'t allowed to make attendance changes in this company. Settings › Suwi can allow it.');
    const out = await prepareMove(ctx, target, people, {
      title: `Set attendance source to ${formatOf(target)} for ${people.length === 1 ? people[0].name : `${people.length} people`}`,
      summaryPrefix: `${how[0]?.toUpperCase() ?? ''}${how.slice(1)}: `,
      extraLines: [{ text: `The attendance source comes with the shift template, so they move to ${target.name}, with its timings and leave types.`, tone: 'warn', why: 'Each shift template carries its punch format, its hours and its leave types together, so a day is always graded by one set of rules.' }],
    });
    if (out.proposalId) await proposalsCol().updateOne({ _id: new ObjectId(out.proposalId) }, { $set: { preview } });
    return { ...out, data: { ...(out.data as object), preview: { field: preview.field, skipped } } };
  }

  if (field === 'kpi_template') {
    const [templates, c] = await Promise.all([listKpiTemplates(ctx.userId), cycles(ctx)]);
    const tpl = templates.find((t) => norm(t.name) === norm(value)) ?? templates.find((t) => norm(t.name).includes(norm(value)));
    if (!tpl) return { data: { needs: ['value'], options: templates.map((t) => t.name), message: `No KPI template called "${value}".` } };
    const before = await currentAssignments(ctx, c.next, ids);
    const rows = people.map((p) => ({ name: p.name, current: templates.find((t) => t.id === before[p.userId]?.templateId)?.name ?? (before[p.userId] ? 'Own parameters' : '—'), next: tpl.name }));
    return delegate(ctx, 'prepare_assign_kpi_template', { userIds: ids, template: tpl.name }, tableOf(field, rows, skipped));
  }

  if (field === 'paid_days_template') {
    await ensurePaidDaysTemplates(ctx.org);
    const tpls = await paidDaysTemplates().find({ org: ctx.org }).toArray();
    const tpl = tpls.find((t) => norm(t.name) === norm(value) || norm(t.code) === norm(value)) ?? tpls.find((t) => norm(t.name).includes(norm(value)));
    if (!tpl) return { data: { needs: ['value'], options: tpls.map((t) => t.name), message: `No paid days template called "${value}".` } };
    const def = tpls.find((t) => t.isDefault);
    const structures = await salaryStructures().find({ org: ctx.org, userId: { $in: ids } }, { projection: { _id: 0, userId: 1, paidDaysTemplateCode: 1 } }).toArray();
    const has = new Map(structures.map((s) => [s.userId, s.paidDaysTemplateCode ?? null]));
    const withSalary = people.filter((p) => has.has(p.userId));
    const noSalary = people.filter((p) => !has.has(p.userId)).map((p) => ({ who: p.name, reason: 'No salary assigned yet' }));
    const rows = withSalary.map((p) => ({ name: p.name, current: tpls.find((t) => t.code === has.get(p.userId))?.name ?? def?.name ?? 'Default', next: tpl.name }));
    if (!withSalary.length) return { data: { nothingToDo: true, skipped: [...skipped, ...noSalary], message: 'None of them has a salary assigned yet; a paid days template needs one.' } };
    return delegate(ctx, 'prepare_assign_paid_days_template', { userIds: withSalary.map((p) => p.userId), template: tpl.name }, tableOf(field, rows, [...skipped, ...noSalary]));
  }

  if (field === 'reporting_manager') {
    const k = norm(value);
    const m = all.find((p) => norm(p.employeeId) === k) ?? all.find((p) => norm(p.name) === k) ?? all.find((p) => norm(p.name).includes(k));
    if (!m) throw new Error(`No active employee called "${value}" to report to`);
    const byId = new Map(all.map((p) => [p.userId, p]));
    const blocked: Skip[] = [];
    const moving: Picked[] = [];
    for (const p of people) {
      if (p.userId === m.userId) blocked.push({ who: p.name, reason: 'Can\'t report to themselves' });
      else if (orgPathOf(m.userId, byId).includes(p.name) || teamOf(p.userId, all, true).some((q) => q.userId === m.userId)) blocked.push({ who: p.name, reason: `${m.name} is below them in the org chart` });
      else moving.push(p);
    }
    const rows = moving.map((p) => ({ name: p.name, current: (p.managerUserId && nameOf.get(p.managerUserId)) || '—', next: m.name }));
    const changing = moving.filter((p) => p.managerUserId !== m.userId);
    if (!changing.length) return { data: { nothingToDo: true, skipped: [...skipped, ...blocked], message: `Everyone who can already reports to ${m.name}.` } };
    const title = `${changing.length === 1 ? changing[0].name : `${changing.length} people`} report to ${m.name}`;
    const proposalId = await propose(ctx, {
      kind: 'bulk_change_manager', area: 'people', title,
      summary: `${how[0]?.toUpperCase() ?? ''}${how.slice(1)}: ${changing.length} move under ${m.name}${m.designation ? ` (${m.designation})` : ''}, from the moment you confirm.`,
      lines: [
        { text: 'Requests still waiting on each old manager move to the new one; decided ones keep who decided them.', why: 'The same save as the profile\'s manager change, one person at a time, so nothing sits with someone who no longer manages them.' },
        ...(moving.length - changing.length ? [{ text: `${moving.length - changing.length} already report to ${m.name}; left as they are.`, tone: 'info' as const }] : []),
      ],
      effectiveFrom: ctx.today, undoable: true, typeToConfirm: changing.length >= 10 ? String(changing.length) : undefined,
      preview: tableOf(field, rows, [...skipped, ...blocked]),
      payload: { byUserId: ctx.userId, managerId: m.userId, managerName: m.name, people: changing.map((p) => ({ userId: p.userId, name: p.name, oldManagerId: p.managerUserId ?? null })) },
    });
    return { data: { prepared: true, title, changing: changing.length, already: moving.length - changing.length, skipped: [...skipped, ...blocked], note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
  }

  // department
  const known = new Set(all.map((p) => (p.department ?? '').trim()).filter(Boolean));
  const dept = [...known].find((d) => norm(d) === norm(value)) ?? value;
  const rows = people.map((p) => ({ name: p.name, current: p.department || '—', next: dept }));
  const changing = people.filter((p) => (p.department ?? '') !== dept);
  if (!changing.length) return { data: { nothingToDo: true, skipped, message: `Everyone named is already in ${dept}.` } };
  const title = `Move ${changing.length === 1 ? changing[0].name : `${changing.length} people`} to ${dept}`;
  const proposalId = await propose(ctx, {
    kind: 'bulk_set_department', area: 'people', title,
    summary: `${how[0]?.toUpperCase() ?? ''}${how.slice(1)}: ${changing.length} ${changing.length === 1 ? 'person moves' : 'people move'} to the ${dept} department on their profile.`,
    lines: [
      { text: 'Saved through the same Basic details save as the profile, and listed on each person\'s Activity tab.' },
      ...(known.has(dept) ? [] : [{ text: `${dept} is a new department name; nobody is in it yet.`, tone: 'warn' as const, why: 'Spelt differently from an existing department, it becomes a second one. Check it against People › Departments.' }]),
      ...(people.length - changing.length ? [{ text: `${people.length - changing.length} already in ${dept}; left as they are.`, tone: 'info' as const }] : []),
    ],
    effectiveFrom: ctx.today, undoable: true, typeToConfirm: changing.length >= 10 ? String(changing.length) : undefined,
    preview: tableOf(field, rows, skipped),
    payload: { byUserId: ctx.userId, department: dept, people: changing.map((p) => ({ userId: p.userId, name: p.name, old: p.department ?? '' })) },
  });
  return { data: { prepared: true, title, changing: changing.length, skipped, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
}

/** "Updated 18. Skipped 2: Asha (…), Ravi (…)." */
const report = (done: number, verb: string, failed: { name: string; reason: string }[]) =>
  `${verb} ${done}.${failed.length ? ` Skipped ${failed.length}: ${failed.slice(0, 5).map((f) => `${f.name} (${f.reason})`).join(', ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}`;

type ManagerPayload = { byUserId: string; managerId: string; managerName: string; people: { userId: string; name: string; oldManagerId: string | null }[] };
defineExecutor('bulk_change_manager', {
  async run(p) {
    const { byUserId, managerId, managerName, people } = p.payload as ManagerPayload;
    const failed: { name: string; reason: string }[] = [];
    let done = 0;
    for (const x of people) {
      try { await assignManager(byUserId, x.userId, managerId); done++; } catch (e) { failed.push({ name: x.name, reason: (e as Error).message }); }
    }
    if (!done && failed.length) throw new Error(failed[0].reason);
    return { message: report(done, `Now reporting to ${managerName}:`, failed) };
  },
  async undo(p) {
    const { byUserId, people } = p.payload as ManagerPayload;
    let done = 0;
    for (const x of people) {
      try { if (x.oldManagerId) await assignManager(byUserId, x.userId, x.oldManagerId); else await removeManager(byUserId, x.userId); done++; } catch { /* someone moved since; left as they are */ }
    }
    return `Put back the old reporting manager for ${done} of ${people.length}.`;
  },
});

type DeptPayload = { byUserId: string; department: string; people: { userId: string; name: string; old: string }[] };
defineExecutor('bulk_set_department', {
  async run(p) {
    const { byUserId, department, people } = p.payload as DeptPayload;
    const failed: { name: string; reason: string }[] = [];
    let done = 0;
    for (const x of people) {
      try { await updateEmployeeDetailsForAdmin(byUserId, x.userId, { department }); done++; } catch (e) { failed.push({ name: x.name, reason: (e as Error).message }); }
    }
    if (!done && failed.length) throw new Error(failed[0].reason);
    return { message: report(done, `Moved to ${department}:`, failed) };
  },
  async undo(p) {
    const { byUserId, people } = p.payload as DeptPayload;
    let done = 0;
    for (const x of people) {
      try { await updateEmployeeDetailsForAdmin(byUserId, x.userId, { department: x.old }); done++; } catch { /* left as it is */ }
    }
    return `Put back the old department for ${done} of ${people.length}.`;
  },
});
