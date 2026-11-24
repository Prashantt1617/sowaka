// Onboarding and offboarding templates (employee lifecycle, 24 Nov Suwi training): their steps as an
// answer, and one card to add, rename, move or remove a step. The change is worked out again from the
// template as it is at Confirm and saved through the same service as Templates' Save
// (services/lifecycle/templates.ts updateTemplate); Undo puts the template's steps back as they were.
import type { DueRule, LifecycleKind, LifecyclePhase, OwnerRole, TemplateTask } from '../../models/lifecycle.model';
import { getTemplate, listTemplates, updateTemplate } from '../../services/lifecycle/templates';
import { defineExecutor, propose } from '../proposals';
import { defineTools, num, str, SuwiContext } from '../tools';
import { lifecycleOff } from './lifecycle-common';
import { norm } from './people';

const TEMPLATES_LINK = { label: 'Open Templates', view: 'lifecycle_templates' };
const PHASES: Record<LifecycleKind, LifecyclePhase[]> = {
  onboarding: ['pre_boarding', 'first_week', 'probation'],
  offboarding: ['resignation', 'when_accepted', 'notice_period', 'last_day', 'after_exit'],
};
const PHASE_LABEL: Record<string, string> = {
  pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation',
  resignation: 'Resignation', when_accepted: 'When accepted', notice_period: 'Notice period', last_day: 'Last day', after_exit: 'After exit',
};
const OWNER_LABEL: Record<string, string> = {
  employee: 'Employee', manager: 'Manager', hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager_employee: 'Manager and employee',
  hr_manager: 'HR and manager', automatic: 'Automatic', buddy: 'Buddy', head_of_department: 'Head of department', senior: 'Someone senior',
};
const ADD_OWNERS: OwnerRole[] = ['employee', 'manager', 'hr', 'it', 'admin', 'finance'];
const ANCHOR_OF: Record<string, DueRule['anchor']> = {
  last_day: 'tl', joining_day: 'tj', exit_accepted: 'exit_accepted', offer_sent: 'offer_sent', offer_accepted: 'accepted', finalised: 'finalised',
};
const ANCHOR_LABEL: Record<string, string> = {
  tl: 'the last day', tj: 'the joining day', exit_accepted: 'the exit is accepted', offer_sent: 'the offer is sent', accepted: 'the offer is accepted',
  finalised: 'the offer is finalised', month_start: 'the probation month starts', month_end: 'the probation month ends',
};

export function ruleText(r: DueRule | null | undefined, label?: string): string {
  if (label) return label;
  if (!r) return '—';
  const n = r.offset ?? 0;
  const unit = r.unit === 'working_days' ? 'working day' : 'day';
  const what = ANCHOR_LABEL[r.anchor] ?? r.anchor;
  const month = r.month === undefined ? '' : r.month === 'each' ? ' (each month)' : r.month === 'last' ? ' (final month)' : ` (month ${Array.isArray(r.month) ? r.month.join(', ') : r.month})`;
  if (!n) return `on ${what}${month}`;
  return `${Math.abs(n)} ${unit}${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'} ${what}${month}`;
}

/** The template named (or the default of the kind). */
async function pickTemplate(ctx: SuwiContext, i: Record<string, unknown>) {
  const kind = str(i.kind) as LifecycleKind;
  const all = await listTemplates(ctx.org, kind === 'onboarding' || kind === 'offboarding' ? kind : undefined);
  const want = norm(i.template);
  if (want) {
    const hit = all.filter((t) => t.id === str(i.template) || norm(t.name) === want || norm(t.name).includes(want));
    if (hit.length === 1) return hit[0];
    if (!hit.length) throw new Error(`No template called "${str(i.template)}". Templates: ${all.map((t) => `${t.name} (${t.kind})`).join(', ')}`);
    throw new Error(`More than one template matches: ${hit.map((t) => `${t.name} (${t.kind})`).join(', ')}. Ask which one.`);
  }
  if (kind !== 'onboarding' && kind !== 'offboarding') throw new Error('Say which template: kind onboarding or offboarding (its default), or the template\'s name');
  const def = all.find((t) => t.isDefault && t.kind === kind) ?? all.find((t) => t.kind === kind);
  if (!def) throw new Error(`No ${kind} template yet`);
  return def;
}

const stepView = (t: TemplateTask) => ({
  title: t.title, phase: PHASE_LABEL[t.phase] ?? t.phase, owner: OWNER_LABEL[t.ownerRole] ?? t.ownerRole, due: ruleText(t.dueRule, t.dueLabel),
  ...(t.mustDo ? { mustDo: true } : {}), ...(t.systemKey ? { builtIn: true } : {}), ...(t.enabled === false ? { off: true } : {}),
});

defineTools({
  name: 'lifecycle_templates',
  area: 'people',
  label: (i) => `Lifecycle template${str(i.template) ? ` ${str(i.template)}` : str(i.kind) ? ` (${str(i.kind)})` : 's'}`,
  description: 'The employee lifecycle\'s onboarding and offboarding templates: the list, and one template\'s steps in order (title, phase, owner, when it is due, must-do, built-in, switched off). Give kind (onboarding/offboarding: its default template) or template (a name). Use it before renaming, moving or removing a step, to get the step\'s exact title. To change a template use prepare_lifecycle_template.',
  input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['onboarding', 'offboarding'] }, template: { type: 'string' } } },
  api: { method: 'GET', path: '/admin/lifecycle/templates' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const all = await listTemplates(ctx.org);
    const list = all.map((t) => ({ name: t.name, kind: t.kind, default: t.isDefault, active: t.active, joinersUsing: t.journeysUsing }));
    if (!str(i.kind) && !str(i.template)) return { data: { templates: list }, links: [TEMPLATES_LINK] };
    const t = await pickTemplate(ctx, i);
    const steps = [...t.tasks].sort((a, b) => PHASES[t.kind].indexOf(a.phase) - PHASES[t.kind].indexOf(b.phase) || a.order - b.order).map(stepView);
    return {
      data: { template: { name: t.name, kind: t.kind, default: t.isDefault, designEditor: t.design }, steps, otherTemplates: list.filter((x) => x.name !== t.name) },
      tables: [{ title: `${t.name} (${t.kind})`, columns: ['Step', 'Phase', 'Owner', 'Due', 'Notes'], rows: steps.map((s) => [s.title, s.phase, s.owner, s.due, [s.mustDo && 'must-do', s.builtIn && 'built-in', s.off && 'off'].filter(Boolean).join(', ') || '—']) }],
      links: [TEMPLATES_LINK],
    };
  },
});

// ─── prepare_lifecycle_template ─────────────────────────────────────────────

type Op = {
  action: 'add' | 'rename' | 'move' | 'remove';
  step?: string; title?: string; phase?: LifecyclePhase; owner?: OwnerRole; due?: DueRule | null;
  before?: string; after?: string; mustDo?: boolean;
};

const findStep = (tasks: TemplateTask[], ref: string | undefined, what = 'step') => {
  const want = norm(ref);
  if (!want) throw new Error(`Say which ${what} (its title)`);
  const exact = tasks.filter((t) => norm(t.title) === want);
  if (exact.length === 1) return exact[0];
  const near = exact.length ? exact : tasks.filter((t) => norm(t.title).includes(want));
  if (near.length === 1) return near[0];
  if (!near.length) throw new Error(`No step called "${ref}" (see lifecycle_templates for the titles)`);
  throw new Error(`More than one step matches "${ref}": ${near.slice(0, 6).map((t) => t.title).join('; ')}. Ask which one.`);
};

/** The template's steps with the change made; also what the card says. */
function applyOp(kind: LifecycleKind, design: boolean, tasks: TemplateTask[], op: Op): { tasks: TemplateTask[]; line: string; row: { name: string; current: string; next: string } } {
  const next = tasks.map((t) => ({ ...t }));
  const placeNear = (moving: TemplateTask) => {
    const anchorTitle = op.before ?? op.after;
    if (!anchorTitle) {
      // Last in its phase.
      const same = next.filter((t) => t.phase === moving.phase && t.id !== moving.id);
      moving.order = (same.length ? Math.max(...same.map((t) => t.order)) : 0) + 10;
      return;
    }
    const anchor = findStep(next.filter((t) => t.id !== moving.id), anchorTitle, 'step to place it next to');
    moving.phase = anchor.phase;
    const same = next.filter((t) => t.phase === anchor.phase && t.id !== moving.id).sort((a, b) => a.order - b.order);
    const at = same.findIndex((t) => t.id === anchor.id) + (op.before ? 0 : 1);
    same.splice(at, 0, moving);
    same.forEach((t, n) => { t.order = (n + 1) * 10; });
  };
  if (op.action === 'add') {
    if (design && kind === 'onboarding') throw new Error('This onboarding template is built in the design editor: add the step on the Templates page');
    const title = (op.title ?? '').trim();
    if (!title || title.length > 120) throw new Error('Give the new step\'s title (up to 120 characters)');
    if (next.some((t) => norm(t.title) === norm(title))) throw new Error(`The template already has a step called "${title}"`);
    const owner = op.owner ?? 'hr';
    const phase = op.phase ?? (kind === 'offboarding' ? 'notice_period' : 'first_week');
    const staff = ['hr', 'it', 'admin', 'finance'].includes(owner);
    const task: TemplateTask = {
      id: `suwi-${Date.now().toString(36)}`, phase, title, ownerRole: owner,
      kind: owner === 'employee' ? 'ack' : 'review', surface: staff ? 'dashboard' : 'app',
      opensRule: kind === 'offboarding' ? { anchor: 'exit_accepted' } : null, dueRule: op.due ?? null,
      mustDo: op.mustDo === true, enabled: true, order: 0,
    };
    next.push(task);
    placeNear(task);
    return { tasks: next, line: `Adds the step "${title}" to ${PHASE_LABEL[phase]}, owned by ${OWNER_LABEL[owner]}, due ${ruleText(task.dueRule)}${task.mustDo ? ', must-do' : ''}.`, row: { name: title, current: '—', next: `${PHASE_LABEL[task.phase]} · ${OWNER_LABEL[owner]} · due ${ruleText(task.dueRule)}` } };
  }
  const step = findStep(next, op.step);
  if (op.action === 'rename') {
    const title = (op.title ?? '').trim();
    if (!title || title.length > 120) throw new Error('Give the new title (up to 120 characters)');
    const was = step.title;
    step.title = title;
    return { tasks: next, line: `Renames "${was}" to "${title}". Everything else about the step stays.`, row: { name: was, current: was, next: title } };
  }
  if (op.action === 'move') {
    if (design && kind === 'onboarding') throw new Error('This onboarding template is built in the design editor: move the step on the Templates page');
    if (op.phase && !op.before && !op.after) { if (!PHASES[kind].includes(op.phase)) throw new Error(`phase is one of ${PHASES[kind].join(', ')}`); step.phase = op.phase; }
    const was = `${PHASE_LABEL[tasks.find((t) => t.id === step.id)!.phase]}`;
    placeNear(step);
    if (op.due !== undefined) step.dueRule = op.due;
    const where = op.before ? `before "${op.before}"` : op.after ? `after "${op.after}"` : `to the end of ${PHASE_LABEL[step.phase]}`;
    return { tasks: next, line: `Moves "${step.title}" ${where}${op.due !== undefined ? `, now due ${ruleText(step.dueRule)}` : ''}.`, row: { name: step.title, current: was, next: `${PHASE_LABEL[step.phase]}${op.due !== undefined ? ` · due ${ruleText(step.dueRule)}` : ''}` } };
  }
  // remove
  if (step.mustDo) throw new Error(`"${step.title}" is a must-do step and cannot be removed`);
  if (step.systemKey) {
    step.enabled = false;
    return { tasks: next, line: `Switches off the built-in step "${step.title}" (built-in steps are switched off rather than deleted; it can be switched on again on the Templates page).`, row: { name: step.title, current: 'On', next: 'Off' } };
  }
  return { tasks: next.filter((t) => t.id !== step.id), line: `Removes the step "${step.title}".`, row: { name: step.title, current: 'In the template', next: 'Removed' } };
}

defineTools({
  name: 'prepare_lifecycle_template',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${str(i.action) || 'change'} a template step`,
  description: 'Prepare ONE card that changes an onboarding or offboarding template (employee lifecycle): action add (title, owner employee/manager/hr/it/admin/finance, phase, when due), rename (step = current title, title = new title), move (step, then before/after another step\'s title, or phase; may change when it is due), remove (step; built-in steps are switched off, must-do steps cannot go). When due: dueFrom last_day / joining_day / exit_accepted / offer_sent / offer_accepted with dueDays (negative = before, e.g. "2 days before the last day" = dueFrom last_day, dueDays -2) and workingDays true for working days. Template: kind (its default) or template (name). "Add a laptop return step to offboarding, due 2 days before the last day" = action add, kind offboarding, title "Return laptop", owner it, dueFrom last_day, dueDays -2. Onboarding templates follow on to joiners already on them. Changes nothing until HR confirms; Undo puts the template back.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'rename', 'move', 'remove'] },
      kind: { type: 'string', enum: ['onboarding', 'offboarding'] },
      template: { type: 'string', description: 'Template name (default: the kind\'s default template)' },
      step: { type: 'string', description: 'The existing step\'s title (rename, move, remove)' },
      title: { type: 'string', description: 'The new step\'s title (add) or the new title (rename)' },
      owner: { type: 'string', enum: ADD_OWNERS },
      phase: { type: 'string', description: 'onboarding: pre_boarding, first_week, probation; offboarding: resignation, when_accepted, notice_period, last_day, after_exit' },
      before: { type: 'string', description: 'Place it just before this step (title)' },
      after: { type: 'string', description: 'Place it just after this step (title)' },
      dueFrom: { type: 'string', enum: Object.keys(ANCHOR_OF) },
      dueDays: { type: 'number', description: 'Days from dueFrom: negative before, positive after' },
      workingDays: { type: 'boolean' },
      mustDo: { type: 'boolean' },
    },
    required: ['action'],
  },
  api: { method: 'PUT', path: '/admin/lifecycle/templates/x' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const action = str(i.action) as Op['action'];
    if (!['add', 'rename', 'move', 'remove'].includes(action)) throw new Error('action is add, rename, move or remove');
    const t = await pickTemplate(ctx, i);
    const phase = str(i.phase) ? str(i.phase) as LifecyclePhase : undefined;
    if (phase && !PHASES[t.kind].includes(phase)) throw new Error(`phase is one of ${PHASES[t.kind].join(', ')} for an ${t.kind} template`);
    if (str(i.owner) && !ADD_OWNERS.includes(str(i.owner) as OwnerRole)) throw new Error(`owner is one of ${ADD_OWNERS.join(', ')}`);
    let due: DueRule | null | undefined;
    if (str(i.dueFrom)) {
      const anchor = ANCHOR_OF[str(i.dueFrom)];
      if (!anchor) throw new Error(`dueFrom is one of ${Object.keys(ANCHOR_OF).join(', ')}`);
      if (t.kind === 'offboarding' && !['tl', 'exit_accepted'].includes(anchor)) throw new Error('An offboarding step is due from last_day or exit_accepted');
      if (t.kind === 'onboarding' && ['tl', 'exit_accepted'].includes(anchor)) throw new Error('An onboarding step is due from joining_day, offer_sent, offer_accepted or finalised');
      const days = num(i.dueDays, 0, -400, 400);
      due = { anchor, ...(days ? { offset: Math.round(days) } : {}), ...(i.workingDays === true ? { unit: 'working_days' as const } : {}) };
    }
    const op: Op = {
      action, step: str(i.step, 120) || undefined, title: str(i.title, 120) || undefined, phase, owner: (str(i.owner) || undefined) as OwnerRole | undefined,
      due, before: str(i.before, 120) || undefined, after: str(i.after, 120) || undefined, ...(i.mustDo !== undefined ? { mustDo: i.mustDo === true } : {}),
    };
    const { line, row } = applyOp(t.kind, t.design, t.tasks, op);
    const title = `${action === 'add' ? 'Add a step to' : action === 'rename' ? 'Rename a step in' : action === 'move' ? 'Move a step in' : 'Remove a step from'} ${t.name}`;
    const proposalId = await propose(ctx, {
      kind: 'lifecycle_template', area: 'people', title,
      summary: line,
      lines: [
        { text: `${line} Template: ${t.name} (${t.kind}${t.isDefault ? ', the default' : ''}).` },
        t.kind === 'onboarding'
          ? { text: `Joiners already on this template (${t.journeysUsing}) follow the change too; new joiners get it from now.`, tone: 'info' }
          : { text: 'Exits started from now get it; exits already under way keep the steps they started with.', tone: 'info' },
        { text: 'Undo puts the template\'s steps back as they were.', tone: 'info' },
      ],
      effectiveFrom: ctx.today, undoable: true,
      preview: { field: 'Step', rows: [row], skipped: [] },
      payload: { org: ctx.org, templateId: t.id, name: t.name, byName: ctx.user.name, op },
    });
    return { data: { prepared: true, title, change: line, note: 'Nothing changes until HR confirms.' }, proposalId, links: [TEMPLATES_LINK] };
  },
});

defineExecutor('lifecycle_template', {
  async run(p) {
    const { org, templateId, name, byName, op } = p.payload as { org: string; templateId: string; name: string; byName: string; op: Op };
    // Worked out again from the template as it is now, so an edit made since is kept.
    const t = await getTemplate(org, templateId);
    const design = t.tasks.some((x) => !!x.design);
    const { tasks, line } = applyOp(t.kind, design, t.tasks, op);
    await updateTemplate(org, templateId, { tasks }, byName);
    return { message: `${name} is saved. ${line}`, undo: { tasks: t.tasks } };
  },
  async undo(p) {
    const { org, templateId, name, byName } = p.payload as { org: string; templateId: string; name: string; byName: string };
    const before = (p.undo as { tasks?: TemplateTask[] } | undefined)?.tasks;
    if (!before) throw new Error('Nothing to put back');
    await updateTemplate(org, templateId, { tasks: before }, byName);
    return `${name} has its earlier steps back.`;
  },
});
