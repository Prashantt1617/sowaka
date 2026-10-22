// KPI set-up: the parameters and templates a company scores on, a suggested
// set per department, and two prepared actions — building a template from a
// plain-words list (reusing parameters that already exist by name, creating
// the rest) and assigning a template from the next cycle. The cycle in
// progress is never touched: the service refuses it, and the card says so.
import { users } from '../../config/db';
import { currentPeriodFor, cycleInfoFor, nextPeriod } from '../../services/cycle';
import { cycleName } from '../../services/feedback-notifications.service';
import {
  assignKpis, assignTemplateToUsers, createKpiParameter, createKpiTemplate, deleteKpiParameter, deleteKpiTemplate,
  listKpiAssignments, listKpiParameters, listKpiTemplates, removeKpiAssignment,
} from '../../services/kpi.service';
import { DEPARTMENT_KPI_DEFAULTS, GENERIC_KPI_DEFAULTS, normaliseName, suggestionFor } from '../content/kpiSuggestions';
import { defineTools, num, str, SuwiContext } from '../tools';
import { defineExecutor, propose, SuwiActionError } from '../proposals';

const ACTIVE = { lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as const;
const MAX_PARAMETERS = 10;
/** "5 Nov 2026" from YYYY-MM-DD. */
const dmy = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

async function roster(ctx: SuwiContext) {
  return users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1, managerUserId: 1 } }).toArray();
}

/** The live cycle and the first one a change can land in, with its first day. */
async function cycles(ctx: SuwiContext) {
  const live = await cycleInfoFor(ctx.org);
  const next = nextPeriod(live.period);
  const [y, m] = next.split('-').map(Number);
  const nextStart = new Date(Date.UTC(y, m - 1, live.startDay)).toISOString().slice(0, 10);
  return { live: live.period, liveName: cycleName(live.period), next, nextName: cycleName(next), nextStart };
}

type Parameter = Awaited<ReturnType<typeof listKpiParameters>>[number];
const findParameter = (all: Parameter[], title: string) => all.find((p) => normaliseName(p.title) === normaliseName(title));

/** The people a template action is for: explicit ids, or everyone active in a department. */
async function peopleFor(ctx: SuwiContext, i: Record<string, unknown>) {
  const all = await roster(ctx);
  const ids = Array.isArray(i.userIds) ? new Set(i.userIds.map(String)) : null;
  const dep = normaliseName(i.department);
  if (!ids && !dep) return [];
  const chosen = all.filter((p) => (ids ? ids.has(p.userId) : normaliseName(p.department) === dep));
  if (ids && chosen.length !== ids.size) throw new Error('Some of those people are not active in this company');
  return chosen.slice(0, 500);
}

/** What each person holds for the cycle now, so the card can warn and Undo can restore. */
async function currentAssignments(ctx: SuwiContext, period: string, userIds: string[]) {
  const rows = await listKpiAssignments(ctx.userId, period);
  const out: Record<string, { parameterIds: string[]; weights: Record<string, number>; templateId: string | null } | null> = {};
  for (const id of userIds) {
    const a = rows.find((r) => r.userId === id);
    out[id] = a ? { parameterIds: a.parameters.map((p) => p.id), weights: a.weights, templateId: a.templateId ?? null } : null;
  }
  return out;
}

defineTools(
  {
    name: 'kpi_setup',
    area: 'performance',
    label: () => 'KPI parameters, templates and the review cycle',
    description: 'The KPI parameters this company scores on (title and guidance), the templates that group them (with weights, how many people are on each this cycle, and which departments or designations they are meant for), and the review cycle: the one in progress and the next one, which is the earliest any change can apply to.',
    input_schema: { type: 'object', properties: { includeArchived: { type: 'boolean' } } },
    api: { method: 'GET', path: '/admin/kpi/templates' },
    async run(ctx, i) {
      const [params, templates, c] = await Promise.all([listKpiParameters(ctx.userId, Boolean(i.includeArchived)), listKpiTemplates(ctx.userId), cycles(ctx)]);
      const titleById = new Map(params.map((p) => [p.id, p.title]));
      return {
        data: {
          cycle: { inProgress: c.live, inProgressName: c.liveName, next: c.next, nextName: c.nextName, nextStarts: c.nextStart, rule: 'Templates and parameters can be created any time; assignments and wording changes apply from the next cycle, never the one in progress.' },
          parameters: params.map((p) => ({ title: p.title, guidance: p.description, ...(p.archived ? { archived: true } : {}), ...(p.pendingEdit ? { guidanceFrom: p.pendingEdit.effectiveFrom, newGuidance: p.pendingEdit.description } : {}) })),
          templates: templates.map((t) => ({
            name: t.name, description: t.description || undefined,
            parameters: t.parameterIds.map((id) => ({ title: titleById.get(id) ?? '(archived)', weight: t.weights[id] })),
            peopleThisCycle: t.employeeCount, peopleNextCycle: t.upcomingCount,
            ...(t.departments.length ? { departments: t.departments } : {}), ...(t.designations.length ? { designations: t.designations } : {}), ...(t.locations.length ? { locations: t.locations } : {}),
          })),
        },
        links: [{ label: 'Open KPI parameters', view: 'kpi' }, { label: 'Open KPI templates', view: 'kpitemplates' }],
      };
    },
  },
  {
    name: 'kpi_suggestions',
    area: 'performance',
    label: (i) => `Suggested KPIs for ${i.department ? String(i.department) : 'each department'}`,
    description: 'A suggested KPI parameter set per department (one department, or all of them), with one-line guidance and weights adding to 100, based on the department\'s designations and headcount. Marks which parameters already exist in this company so they are reused rather than duplicated, and which templates already target the department. Adapt the suggestion to what HR says, then use prepare_kpi_template to create it.',
    input_schema: { type: 'object', properties: { department: { type: 'string' } } },
    api: { method: 'GET', path: '/admin/kpi/parameters' },
    async run(ctx, i) {
      const [all, params, templates] = await Promise.all([roster(ctx), listKpiParameters(ctx.userId), listKpiTemplates(ctx.userId)]);
      const want = normaliseName(i.department);
      const groups = new Map<string, typeof all>();
      for (const p of all) { const d = p.department?.trim() || '(no department)'; groups.set(d, [...(groups.get(d) ?? []), p]); }
      const hasReports = new Set(all.map((p) => p.managerUserId).filter(Boolean));
      const departments = [...groups].filter(([d]) => !want || normaliseName(d) === want || normaliseName(d).includes(want));
      if (!departments.length) throw new Error(want ? `No active employee has the department "${str(i.department)}"` : 'No employees found');
      const annotate = (s: { title: string; guidance: string; weight: number }) => {
        const hit = findParameter(params, s.title);
        const words = normaliseName(s.title).split(' ');
        const similar = hit ? [] : params.filter((p) => words.some((w) => w.length > 3 && normaliseName(p.title).split(' ').includes(w))).map((p) => p.title);
        return { title: s.title, guidance: hit ? hit.description : s.guidance, weight: s.weight, exists: Boolean(hit), ...(similar.length ? { similarExisting: similar } : {}) };
      };
      return {
        data: {
          departments: departments.sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([name, people]) => {
            const match = suggestionFor(name);
            const designations: Record<string, number> = {};
            for (const p of people) { const d = p.designation?.trim() || '(not set)'; designations[d] = (designations[d] ?? 0) + 1; }
            const managers = people.filter((p) => hasReports.has(p.userId)).length;
            return {
              department: name, headcount: people.length, designations, managers,
              basedOn: match ? `the ${match.department} default set` : 'the generic default set (no department-specific one matched)',
              parameters: (match?.parameters ?? GENERIC_KPI_DEFAULTS).map(annotate),
              ...(managers && match?.forManagers ? { forManagers: { ...annotate(match.forManagers), note: `${managers} ${managers === 1 ? 'person' : 'people'} here ${managers === 1 ? 'has' : 'have'} reports; a separate managers' template could add this at about ${match.forManagers.weight}% and lower the others to keep 100.` } } : {}),
              existingTemplates: templates.filter((t) => t.departments.some((d) => normaliseName(d) === normaliseName(name))).map((t) => t.name),
            };
          }),
          existingParameters: params.map((p) => p.title),
          knownSets: DEPARTMENT_KPI_DEFAULTS.map((d) => d.department),
          next: 'Adjust names, guidance and weights with HR, then call prepare_kpi_template once per department (weights must add to 100).',
        },
        links: [{ label: 'Open KPI templates', view: 'kpitemplates' }],
      };
    },
  },
  {
    name: 'prepare_kpi_template',
    area: 'performance',
    acts: true,
    label: (i) => `Prepared: KPI template "${i.name ?? ''}"`,
    description: 'Prepare a KPI template from a plain-words list: each parameter with a whole-number weight (all weights must add to 100) and one line of guidance for any parameter that does not exist yet. Parameters whose name matches an existing one (ignoring case and punctuation) are reused, the rest are created. Optionally target departments or designations, and optionally assign it to people (userIds) or a whole department from the next cycle. Changes nothing until HR confirms; Undo removes the template and the parameters it created.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, description: { type: 'string' },
        parameters: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, weight: { type: 'number' }, guidance: { type: 'string', description: 'One line shown under the parameter on the form; needed for new parameters' } }, required: ['title', 'weight'] } },
        departments: { type: 'array', items: { type: 'string' }, description: 'Departments the template is meant for (used by Bulk assign)' },
        designations: { type: 'array', items: { type: 'string' } },
        assignTo: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' } }, department: { type: 'string' } }, description: 'Also assign it from the next cycle to these people or this department' },
      },
      required: ['name', 'parameters'],
    },
    api: { method: 'POST', path: '/admin/kpi/templates' },
    async run(ctx, i) {
      const name = str(i.name, 80);
      if (!name) throw new Error('The template needs a name');
      const list = Array.isArray(i.parameters) ? (i.parameters as Record<string, unknown>[]) : [];
      if (!list.length || list.length > MAX_PARAMETERS) throw new Error(`Give between 1 and ${MAX_PARAMETERS} parameters`);
      const wanted = list.map((p) => ({ title: str(p.title, 80), weight: num(p.weight, NaN), guidance: str(p.guidance, 600) }));
      if (wanted.some((p) => !p.title)) throw new Error('Every parameter needs a title');
      if (new Set(wanted.map((p) => normaliseName(p.title))).size !== wanted.length) throw new Error('Parameters must be unique');
      if (wanted.some((p) => !Number.isInteger(p.weight) || p.weight < 1 || p.weight > 100)) throw new Error('Each weight must be a whole number from 1 to 100');
      const total = wanted.reduce((s, p) => s + p.weight, 0);
      if (total !== 100) throw new Error(`Weights must add up to 100; these add up to ${total}. Adjust them and try again.`);

      const [params, templates, c] = await Promise.all([listKpiParameters(ctx.userId, true), listKpiTemplates(ctx.userId), cycles(ctx)]);
      if (templates.some((t) => normaliseName(t.name) === normaliseName(name))) throw new Error(`A template called "${name}" already exists`);
      const archived = wanted.map((p) => findParameter(params, p.title)).filter((p) => p?.archived).map((p) => p!.title);
      if (archived.length) throw new Error(`${archived.join(', ')} ${archived.length === 1 ? 'is' : 'are'} archived. Restore ${archived.length === 1 ? 'it' : 'them'} under KPI parameters first, or use a different name.`);
      const resolved = wanted.map((p) => {
        const hit = findParameter(params, p.title);
        return hit ? { ...p, title: hit.title, existingId: hit.id, guidance: hit.description } : { ...p, existingId: null, guidance: p.guidance || `What did this cycle show on ${p.title.toLowerCase()}? Note the evidence, not the impression.` };
      });
      const reused = resolved.filter((p) => p.existingId), created = resolved.filter((p) => !p.existingId);
      const departments = Array.isArray(i.departments) ? [...new Set(i.departments.map((d) => str(d, 80)).filter(Boolean))] : [];
      const designations = Array.isArray(i.designations) ? [...new Set(i.designations.map((d) => str(d, 80)).filter(Boolean))] : [];

      // Optional second step: assign it from the next cycle.
      const assignTo = i.assignTo && typeof i.assignTo === 'object' ? (i.assignTo as Record<string, unknown>) : null;
      const people = assignTo ? await peopleFor(ctx, assignTo) : [];
      if (assignTo && !people.length) throw new Error('assignTo matched nobody: give userIds or a department with active employees');
      const before = people.length ? await currentAssignments(ctx, c.next, people.map((p) => p.userId)) : {};
      const replaced = people.filter((p) => before[p.userId]);

      const weightsLine = resolved.map((p) => `${p.title} ${p.weight}%`).join(', ');
      const proposalId = await propose(ctx, {
        kind: 'create_kpi_template', area: 'performance', title: `Create KPI template "${name}"`,
        summary: `Creates the template "${name}" with ${resolved.length} parameters (${weightsLine})${created.length ? `, creating ${created.length} new parameter${created.length === 1 ? '' : 's'}` : ''}${reused.length ? ` and reusing ${reused.length} that already exist` : ''}.${people.length ? ` Then assigns it to ${people.length} ${people.length === 1 ? 'person' : 'people'} from the ${c.nextName} cycle (starts ${dmy(c.nextStart)}).` : ' Nothing is assigned to anyone yet.'}`,
        lines: [
          ...(created.length ? [{ text: `New parameters: ${created.map((p) => `${p.title} ("${p.guidance}")`).join('; ')}.`, why: 'A parameter is the heading a manager scores 0–5 against; its guidance is the line shown under it on the manager\'s form and on the employee\'s Grow page, so they both know what the month is reviewed on.' }] : []),
          ...(reused.length ? [{ text: `Reused as they are: ${reused.map((p) => p.title).join(', ')}.`, why: 'Matched by name, so scores on these stay comparable with earlier reviews instead of starting a duplicate.' }] : []),
          { text: `Weights: ${weightsLine}.`, why: 'Weights add to 100 so the overall score is a weighted mean on the same 0–5 scale as each parameter.' },
          ...(departments.length || designations.length ? [{ text: `Meant for ${[departments.length ? `the ${departments.join(', ')} ${departments.length === 1 ? 'department' : 'departments'}` : '', designations.length ? `${designations.join(', ')}` : ''].filter(Boolean).join(' and ')}: Bulk assign offers these people first.` }] : []),
          ...(people.length
            ? [
                { text: `Assigned to ${people.length === 1 ? people[0].name : `${people.length} people`} for the ${c.nextName} cycle (from ${dmy(c.nextStart)}); the ${c.liveName} cycle in progress is unchanged.`, why: 'Assignments are written only for a cycle that has not opened, so a manager scoring now never has the parameters change underneath them.' },
                ...(people.length > 1 ? [{ text: `People: ${people.slice(0, 8).map((p) => p.name).join(', ')}${people.length > 8 ? ` and ${people.length - 8} more` : ''}.` }] : []),
                ...(replaced.length ? [{ text: `${replaced.length} of them already ${replaced.length === 1 ? 'has' : 'have'} a ${c.nextName} assignment (${replaced.slice(0, 5).map((p) => p.name).join(', ')}${replaced.length > 5 ? ` and ${replaced.length - 5} more` : ''}); it would be replaced.`, tone: 'warn' as const }] : []),
              ]
            : [{ text: `Nobody is assigned yet. Ask Suwi to assign it from the ${c.nextName} cycle, or use Bulk assign.` }]),
          { text: `Undo removes the template${created.length ? ' and the new parameters (if nothing else uses them by then)' : ''}${people.length ? ' and puts back what each person had for that cycle' : ''}.` },
        ],
        effectiveFrom: people.length ? c.nextStart : ctx.today, undoable: true, typeToConfirm: people.length >= 10 ? String(people.length) : undefined,
        payload: {
          byUserId: ctx.userId, name, description: str(i.description, 160), departments, designations,
          parameters: resolved.map((p) => ({ title: p.title, weight: p.weight, guidance: p.guidance, existingId: p.existingId })),
          assign: people.length ? { period: c.next, userIds: people.map((p) => p.userId), before } : null,
        },
      });
      return {
        data: { prepared: true, title: `Create KPI template "${name}"`, creating: created.map((p) => p.title), reusing: reused.map((p) => p.title), weights: weightsLine, assigning: people.length ? { people: people.length, fromCycle: c.next } : null, note: 'Nothing is saved until HR presses Confirm on the card.' },
        proposalId,
      };
    },
  },
  {
    name: 'prepare_assign_kpi_template',
    area: 'performance',
    acts: true,
    label: (i) => `Prepared: assign "${i.template ?? ''}" from the next cycle`,
    description: 'Prepare assigning an existing KPI template to people (userIds) or a whole department from the next review cycle; the cycle in progress is never changed. Shows who would have an existing assignment replaced. Changes nothing until HR confirms; Undo puts back what each person had.',
    input_schema: { type: 'object', properties: { template: { type: 'string', description: 'Template name' }, userIds: { type: 'array', items: { type: 'string' } }, department: { type: 'string' } }, required: ['template'] },
    api: { method: 'POST', path: '/admin/kpi/templates/x/assign' },
    async run(ctx, i) {
      const [templates, c] = await Promise.all([listKpiTemplates(ctx.userId), cycles(ctx)]);
      const want = normaliseName(i.template);
      const tpl = templates.find((t) => normaliseName(t.name) === want) ?? templates.filter((t) => normaliseName(t.name).includes(want)).sort((a, b) => a.name.length - b.name.length)[0];
      if (!tpl) throw new Error(`No KPI template called "${str(i.template)}"`);
      const people = await peopleFor(ctx, i);
      if (!people.length) throw new Error('Give userIds or a department with active employees');
      const before = await currentAssignments(ctx, c.next, people.map((p) => p.userId));
      const already = people.filter((p) => before[p.userId]?.templateId === tpl.id);
      const moving = people.filter((p) => before[p.userId]?.templateId !== tpl.id);
      if (!moving.length) return { data: { nothingToDo: true, message: `Everyone named is already on "${tpl.name}" for the ${c.nextName} cycle.` } };
      const replaced = moving.filter((p) => before[p.userId]);
      const who = moving.length === 1 ? moving[0].name : `${moving.length} people`;
      const title = `Assign "${tpl.name}" to ${who} from ${c.nextName}`;
      const proposalId = await propose(ctx, {
        kind: 'assign_kpi_template', area: 'performance', title,
        summary: `From the ${c.nextName} cycle (starts ${dmy(c.nextStart)}), ${who} ${moving.length === 1 ? 'is' : 'are'} reviewed on "${tpl.name}" (${tpl.parameterIds.length} parameters). The ${c.liveName} cycle in progress is unchanged.`,
        lines: [
          { text: `Applies to the ${c.nextName} cycle only; ${c.liveName} reviews carry on with what is assigned now.`, why: 'Assignments are written only for a cycle that has not opened, so a manager scoring now never has the parameters change underneath them, and two managers in one cycle never judge against different sets.' },
          { text: `Each person gets the template's parameters and weights copied onto their own assignment; HR can still adjust one person afterwards without touching the template.` },
          ...(moving.length > 1 ? [{ text: `People: ${moving.slice(0, 8).map((p) => p.name).join(', ')}${moving.length > 8 ? ` and ${moving.length - 8} more` : ''}.` }] : []),
          ...(replaced.length ? [{ text: `${replaced.length} already ${replaced.length === 1 ? 'has' : 'have'} a ${c.nextName} assignment (${replaced.slice(0, 5).map((p) => p.name).join(', ')}${replaced.length > 5 ? ` and ${replaced.length - 5} more` : ''}); it would be replaced.`, tone: 'warn' as const }] : []),
          ...(already.length ? [{ text: `${already.length} already on "${tpl.name}" for ${c.nextName}; left as they are.`, tone: 'info' as const }] : []),
        ],
        effectiveFrom: c.nextStart, undoable: true, typeToConfirm: moving.length >= 10 ? String(moving.length) : undefined,
        payload: { byUserId: ctx.userId, templateId: tpl.id, templateName: tpl.name, period: c.next, userIds: moving.map((p) => p.userId), before: Object.fromEntries(moving.map((p) => [p.userId, before[p.userId]])) },
      });
      return { data: { prepared: true, title, people: moving.length, fromCycle: c.next, replacing: replaced.length, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId };
    },
  },
);

type Before = Record<string, { parameterIds: string[]; weights: Record<string, number>; templateId: string | null } | null>;

/**
 * Puts back what each person held for the cycle: their earlier set, or nothing.
 * Only while that cycle has not opened (managers may be scoring against it),
 * and only for people still on this template: anyone HR has since moved by
 * hand keeps what HR gave them.
 */
async function restoreAssignments(org: string, byUserId: string, templateId: string, period: string, userIds: string[], before: Before) {
  if (period <= await currentPeriodFor(org)) {
    throw new SuwiActionError(409, `The ${cycleName(period)} cycle has started, so its assignments can no longer be undone here. Change them under KPI › Bulk assign.`);
  }
  const now = await listKpiAssignments(byUserId, period);
  const stillOnIt = new Set(now.filter((a) => a.templateId === templateId).map((a) => a.userId));
  let restored = 0;
  for (const userId of userIds) {
    if (!stillOnIt.has(userId)) continue;
    const b = before[userId];
    if (b) await assignKpis(byUserId, { userId, period, templateId: b.templateId ?? undefined, parameterIds: b.parameterIds, weights: b.weights });
    else await removeKpiAssignment(byUserId, userId, period);
    restored += 1;
  }
  return { restored, leftAlone: userIds.length - restored };
}

defineExecutor('create_kpi_template', {
  async run(p) {
    const { byUserId, name, description, departments, designations, parameters, assign } = p.payload as {
      byUserId: string; name: string; description: string; departments: string[]; designations: string[];
      parameters: { title: string; weight: number; guidance: string; existingId: string | null }[];
      assign: { period: string; userIds: string[]; before: Before } | null;
    };
    const createdIds: string[] = [];
    const ids: string[] = [];
    let templateId: string | null = null;
    try {
      for (const param of parameters) {
        if (param.existingId) { ids.push(param.existingId); continue; }
        const made = await createKpiParameter(byUserId, { title: param.title, description: param.guidance });
        createdIds.push(made.id); ids.push(made.id);
      }
      const weights = Object.fromEntries(parameters.map((param, k) => [ids[k], param.weight]));
      templateId = (await createKpiTemplate(byUserId, { name, description, parameterIds: ids, weights, departments, designations })).id;
      let assigned = 0;
      if (assign) assigned = (await assignTemplateToUsers(byUserId, templateId, { userIds: assign.userIds, period: assign.period })).assigned;
      return {
        message: `Created "${name}" with ${ids.length} parameters${createdIds.length ? ` (${createdIds.length} new)` : ''}.${assign ? ` Assigned to ${assigned} ${assigned === 1 ? 'person' : 'people'} from the ${cycleName(assign.period)} cycle.` : ''}`,
        undo: { templateId, createdParameterIds: createdIds },
      };
    } catch (e) {
      // Half-made set-up is worse than none: take back what this run created.
      // (assignTemplateToUsers writes in one bulk call, so a failure there left no assignments.)
      if (templateId) await deleteKpiTemplate(byUserId, templateId).catch(() => undefined);
      for (const id of createdIds) await deleteKpiParameter(byUserId, id).catch(() => undefined);
      throw e;
    }
  },
  async undo(p) {
    const { byUserId, name, assign } = p.payload as { byUserId: string; name: string; assign: { period: string; userIds: string[]; before: Before } | null };
    const { templateId, createdParameterIds } = (p.undo ?? {}) as { templateId?: string; createdParameterIds?: string[] };
    if (!templateId) throw new SuwiActionError(409, 'Nothing to undo');
    const r = assign ? await restoreAssignments(p.org, byUserId, templateId, assign.period, assign.userIds, assign.before) : null;
    // Refuses, with the reason, if anyone is still on it (someone assigned it by hand since).
    await deleteKpiTemplate(byUserId, templateId);
    const kept: string[] = [];
    for (const id of createdParameterIds ?? []) {
      try { await deleteKpiParameter(byUserId, id); } catch (e) { kept.push((e as Error).message); }
    }
    return `Removed the template "${name}"${createdParameterIds?.length ? ` and ${createdParameterIds.length - kept.length} of its ${createdParameterIds.length} new parameters` : ''}${r ? `, and put back what ${r.restored} ${r.restored === 1 ? 'person' : 'people'} had for ${cycleName(assign!.period)}` : ''}.${kept.length ? ` Kept: ${kept.join(' ')}` : ''}`;
  },
});

defineExecutor('assign_kpi_template', {
  async run(p) {
    const { byUserId, templateId, templateName, period, userIds } = p.payload as { byUserId: string; templateId: string; templateName: string; period: string; userIds: string[] };
    const r = await assignTemplateToUsers(byUserId, templateId, { userIds, period });
    return { message: `Assigned "${templateName}" to ${r.assigned} ${r.assigned === 1 ? 'person' : 'people'} for the ${cycleName(period)} cycle.` };
  },
  async undo(p) {
    const { byUserId, templateId, templateName, period, userIds, before } = p.payload as { byUserId: string; templateId: string; templateName: string; period: string; userIds: string[]; before: Before };
    const r = await restoreAssignments(p.org, byUserId, templateId, period, userIds, before);
    return `Took "${templateName}" off ${r.restored === 1 ? '1 person' : `${r.restored} people`} for the ${cycleName(period)} cycle and put back what they had.${r.leftAlone ? ` ${r.leftAlone} had been changed since and were left as they are.` : ''}`;
  },
});
