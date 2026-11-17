/**
 * Lifecycle templates (S2–S4): one default per org per kind, created lazily
 * from the seed as "Standard". A journey snapshots its template when it
 * starts, so editing a template never touches a running journey.
 */
import { randomUUID } from 'node:crypto';
import { companies, journeys, lifecycleTemplates, users } from '../../config/db';
import type {
  LifecycleKind, LifecycleTemplate, LifecycleTemplateSettings, LifecyclePhase, OwnerRole, SystemTaskKey, TaskKind, TaskSurface, TemplateTask,
} from '../../models/lifecycle.model';
import { isValidRule } from './dueRules';
import { LifecycleError } from './errors';
import { OFFBOARDING_SETTINGS, ONBOARDING_SETTINGS, offboardingSeed, onboardingSeed } from './seed';

const KINDS: LifecycleKind[] = ['onboarding', 'offboarding'];
const PHASES: Record<LifecycleKind, LifecyclePhase[]> = {
  onboarding: ['pre_boarding', 'first_week', 'probation'],
  offboarding: ['resignation', 'when_accepted', 'notice_period', 'last_day', 'after_exit'],
};
const OWNERS: OwnerRole[] = ['employee', 'manager', 'hr', 'it', 'admin', 'finance', 'manager_employee', 'hr_manager', 'automatic'];
const TASK_KINDS: TaskKind[] = ['ack', 'form', 'upload', 'sign', 'meeting', 'reel', 'survey', 'assign', 'review', 'system', 'post', 'tour', 'face', 'checkin', 'letter'];
const SURFACES: TaskSurface[] = ['portal', 'app', 'dashboard', 'backend', 'outside'];
const EXIT_TYPES = ['resignation', 'retirement', 'end_of_contract', 'termination', 'absconding'] as const;

export function isKind(value: unknown): value is LifecycleKind {
  return KINDS.includes(value as LifecycleKind);
}

function fresh(org: string, kind: LifecycleKind, name: string, isDefault: boolean, byName?: string): LifecycleTemplate {
  const now = new Date();
  return {
    id: randomUUID(), org, kind, name, isDefault, active: true,
    settings: { ...(kind === 'onboarding' ? ONBOARDING_SETTINGS : OFFBOARDING_SETTINGS) },
    tasks: kind === 'onboarding' ? onboardingSeed() : offboardingSeed(),
    createdAt: now, updatedAt: now, ...(byName ? { updatedByName: byName } : {}),
  };
}

const strip = <T extends object>(doc: T & { _id?: unknown }): T => {
  const { _id, ...rest } = doc;
  return rest as T;
};

/** Makes sure the org has one default template of each kind ("Standard" from the seed when it has none). */
export async function ensureDefaultTemplates(org: string): Promise<void> {
  for (const kind of KINDS) {
    const hasDefault = await lifecycleTemplates().findOne({ org, kind, isDefault: true }, { projection: { _id: 1 } });
    if (hasDefault) continue;
    const oldest = await lifecycleTemplates().find({ org, kind, active: true }).sort({ createdAt: 1 }).limit(1).next();
    if (oldest) {
      await lifecycleTemplates().updateOne({ id: oldest.id }, { $set: { isDefault: true, updatedAt: new Date() } });
      continue;
    }
    // Keyed so two first visits at once still make one Standard.
    const doc = fresh(org, kind, 'Standard', true);
    // The company's own notice period (Payroll › Exit settings), not the seed's 60 days:
    // otherwise the first look at templates would quietly change everyone's last day.
    if (kind === 'offboarding') {
      const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNoticeDays: 1 } });
      if (typeof company?.exitNoticeDays === 'number' && company.exitNoticeDays > 0) doc.settings.noticeDays = company.exitNoticeDays;
    }
    try {
      await lifecycleTemplates().updateOne({ org, kind, isDefault: true }, { $setOnInsert: doc }, { upsert: true });
    } catch (error) {
      // Another first visit made it a moment ago (the one-Default index refused this one): that one stands.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
}

/**
 * Days of notice (a resignation's, and an offer's default): the default offboarding template's,
 * else the company's Exit settings, else 30. The template wins whenever it sets one.
 */
export async function noticeDaysFor(org: string): Promise<number> {
  const template = await lifecycleTemplates().findOne({ org, kind: 'offboarding', isDefault: true, active: { $ne: false } }, { projection: { _id: 0, settings: 1 } });
  if (typeof template?.settings?.noticeDays === 'number') return template.settings.noticeDays;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNoticeDays: 1 } });
  return typeof company?.exitNoticeDays === 'number' ? company.exitNoticeDays : 30;
}

export async function defaultTemplate(org: string, kind: LifecycleKind): Promise<LifecycleTemplate> {
  await ensureDefaultTemplates(org);
  const doc = await lifecycleTemplates().findOne({ org, kind, isDefault: true });
  if (!doc) throw new LifecycleError(500, 'No default template');
  return strip(doc);
}

export async function getTemplate(org: string, id: string): Promise<LifecycleTemplate> {
  const doc = await lifecycleTemplates().findOne({ org, id });
  if (!doc) throw new LifecycleError(404, 'Template not found');
  return strip(doc);
}

/** The template for a new journey: the given one (same org, kind, active) or the default. */
export async function templateForJourney(org: string, kind: LifecycleKind, templateId?: string): Promise<LifecycleTemplate> {
  if (!templateId) return defaultTemplate(org, kind);
  const doc = await getTemplate(org, templateId);
  if (doc.kind !== kind) throw new LifecycleError(400, `That is not an ${kind} template`);
  if (!doc.active) throw new LifecycleError(409, 'That template is switched off');
  return doc;
}

export async function listTemplates(org: string, kind?: LifecycleKind) {
  await ensureDefaultTemplates(org);
  const filter: Record<string, unknown> = { org };
  if (kind) filter.kind = kind;
  const docs = await lifecycleTemplates().find(filter).sort({ isDefault: -1, createdAt: 1 }).toArray();
  const using = await journeys().aggregate<{ _id: string; n: number }>([
    { $match: { org, closedAt: { $exists: false }, templateId: { $in: docs.map((d) => d.id) } } },
    { $group: { _id: '$templateId', n: { $sum: 1 } } },
  ]).toArray();
  const count = new Map(using.map((row) => [row._id, row.n]));
  return docs.map((doc) => ({
    ...strip(doc),
    journeysUsing: count.get(doc.id) ?? 0,
    recommendedNotAdded: doc.tasks.filter((t) => t.recommended && !t.recommended.added).length,
  }));
}

export async function createTemplate(org: string, input: Record<string, unknown>, byName?: string): Promise<LifecycleTemplate> {
  await ensureDefaultTemplates(org);
  const kind = input.kind;
  if (!isKind(kind)) throw new LifecycleError(400, 'kind must be onboarding or offboarding');
  const name = cleanName(input.name);
  const doc = fresh(org, kind, name, false, byName);
  if (typeof input.group === 'string' && input.group.trim()) doc.group = input.group.trim().slice(0, 80);
  if (input.copyFromId) {
    const from = await getTemplate(org, String(input.copyFromId));
    if (from.kind !== kind) throw new LifecycleError(400, 'Copy from a template of the same kind');
    doc.settings = structuredClone(from.settings);
    doc.tasks = structuredClone(from.tasks);
  } else if (kind === 'offboarding') {
    // As Standard does (ensureDefaultTemplates): a new template starts from the company's notice
    // (Payroll › Exit settings), not the seed's 60 days.
    const company = await companies().findOne({ id: org }, { projection: { _id: 0, exitNoticeDays: 1 } });
    if (typeof company?.exitNoticeDays === 'number' && company.exitNoticeDays > 0) doc.settings.noticeDays = company.exitNoticeDays;
  }
  await lifecycleTemplates().insertOne({ ...doc });
  return doc;
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new LifecycleError(400, 'Template name is required');
  if (name.length > 80) throw new LifecycleError(400, 'Template name cannot exceed 80 characters');
  return name;
}

function cleanSettings(kind: LifecycleKind, input: unknown, current: LifecycleTemplateSettings): LifecycleTemplateSettings {
  if (!input || typeof input !== 'object') throw new LifecycleError(400, 'settings must be an object');
  const s = input as Record<string, unknown>;
  const out: LifecycleTemplateSettings = { ...current };
  const int = (v: unknown, min: number, max: number, label: string) => {
    if (!Number.isInteger(v) || Number(v) < min || Number(v) > max) throw new LifecycleError(400, `${label} must be a whole number from ${min} to ${max}`);
    return Number(v);
  };
  if (kind === 'onboarding') {
    if (s.probationMonths !== undefined) {
      if (s.probationMonths !== 3 && s.probationMonths !== 6) throw new LifecycleError(400, 'Probation is 3 or 6 months');
      out.probationMonths = s.probationMonths;
    }
    if (s.portalOpenUntil !== undefined) {
      if (s.portalOpenUntil !== 'week_1' && s.portalOpenUntil !== 'month_1') throw new LifecycleError(400, 'Portal open until is week_1 or month_1');
      out.portalOpenUntil = s.portalOpenUntil;
    }
    if (s.signLettersOnDay1 !== undefined) out.signLettersOnDay1 = s.signLettersOnDay1 === true;
  } else {
    if (s.noticeDays !== undefined) out.noticeDays = int(s.noticeDays, 0, 365, 'Notice days');
    if (s.exitInterviewOpensDays !== undefined) out.exitInterviewOpensDays = int(s.exitInterviewOpensDays, 0, 60, 'Exit interview opens');
    if (s.accountCloses !== undefined) {
      if (s.accountCloses !== 'tl_plus_1' && s.accountCloses !== 'tl_end_of_shift') throw new LifecycleError(400, 'accountCloses is tl_plus_1 or tl_end_of_shift');
      out.accountCloses = s.accountCloses;
    }
    if (s.settlementWorkingDays !== undefined) out.settlementWorkingDays = int(s.settlementWorkingDays, 0, 60, 'Settlement working days');
    if (s.gratuityDays !== undefined) out.gratuityDays = int(s.gratuityDays, 0, 365, 'Gratuity days');
    if (s.appPageFor !== undefined) {
      if (!Array.isArray(s.appPageFor) || !s.appPageFor.every((v) => EXIT_TYPES.includes(v as (typeof EXIT_TYPES)[number]))) {
        throw new LifecycleError(400, 'appPageFor lists exit types');
      }
      out.appPageFor = [...new Set(s.appPageFor as NonNullable<LifecycleTemplateSettings['appPageFor']>)];
    }
  }
  return out;
}

/**
 * Where "Sign the appointment letter and NDA" sits. On the portal (the seed): pre-boarding, due
 * Tj − 2, after HR's review. "Sign on Day 1" (6Zs: "moves it to week 1 in the app"): week 1 in
 * the app, opening and due on Tj, waiting on nothing on the portal.
 */
const SIGN_ON_PORTAL: Pick<TemplateTask, 'phase' | 'surface' | 'opensRule' | 'dueRule' | 'after'> = {
  phase: 'pre_boarding', surface: 'portal', opensRule: null, dueRule: { anchor: 'tj', offset: -2, unit: 'days' }, after: { key: 'review_documents' },
};
const SIGN_ON_DAY1: Pick<TemplateTask, 'phase' | 'surface' | 'opensRule' | 'dueRule'> = {
  phase: 'first_week', surface: 'app', opensRule: { anchor: 'tj', offset: 0, unit: 'days' }, dueRule: { anchor: 'tj', offset: 0, unit: 'days' },
};

/** The settings are the editor's way of setting these rules; the task rules are what run (so every surface reads the same task). */
function applySettingsToTasks(kind: LifecycleKind, settings: LifecycleTemplateSettings, tasks: TemplateTask[]): TemplateTask[] {
  if (kind === 'onboarding') {
    return tasks.map((task) => {
      if (task.systemKey !== 'sign_letters') return task;
      if (settings.signLettersOnDay1 === true) {
        const { after: _after, ...rest } = task;
        return { ...rest, ...SIGN_ON_DAY1 };
      }
      return task.phase === 'first_week' ? { ...task, ...SIGN_ON_PORTAL } : task;
    });
  }
  return tasks.map((task) => {
    switch (task.systemKey) {
      case 'exit_interview':
        return settings.exitInterviewOpensDays === undefined ? task : { ...task, opensRule: { anchor: 'tl', offset: -settings.exitInterviewOpensDays, unit: 'days' } };
      case 'final_settlement':
      case 'relieving_letter':
        return settings.settlementWorkingDays === undefined ? task : { ...task, dueRule: { anchor: 'tl', offset: settings.settlementWorkingDays, unit: 'working_days' } };
      case 'gratuity':
        return settings.gratuityDays === undefined ? task : { ...task, dueRule: { anchor: 'tl', offset: settings.gratuityDays, unit: 'days' } };
      case 'close_account': {
        const offset = settings.accountCloses === 'tl_end_of_shift' ? 0 : 1;
        return { ...task, opensRule: { anchor: 'tl', offset, unit: 'days' }, dueRule: { anchor: 'tl', offset, unit: 'days' } };
      }
      default:
        return task;
    }
  });
}

const SYSTEM_KEYS = new Set<SystemTaskKey>([...onboardingSeed(), ...offboardingSeed()].map((t) => t.systemKey!));

function cleanTasks(kind: LifecycleKind, input: unknown): TemplateTask[] {
  if (!Array.isArray(input)) throw new LifecycleError(400, 'tasks must be a list');
  if (input.length > 200) throw new LifecycleError(400, 'A template holds at most 200 tasks');
  const seen = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new LifecycleError(400, `Task ${index + 1} is not an object`);
    const t = raw as Record<string, unknown>;
    const where = `Task ${index + 1}`;
    const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 64) : randomUUID();
    if (seen.has(id)) throw new LifecycleError(400, `${where}: duplicate id`);
    seen.add(id);
    const title = typeof t.title === 'string' ? t.title.trim() : '';
    if (!title || title.length > 120) throw new LifecycleError(400, `${where}: a title of up to 120 characters is required`);
    if (!PHASES[kind].includes(t.phase as LifecyclePhase)) throw new LifecycleError(400, `${where}: phase must be one of ${PHASES[kind].join(', ')}`);
    if (!OWNERS.includes(t.ownerRole as OwnerRole)) throw new LifecycleError(400, `${where}: unknown owner`);
    if (!TASK_KINDS.includes(t.kind as TaskKind)) throw new LifecycleError(400, `${where}: unknown kind`);
    if (!SURFACES.includes(t.surface as TaskSurface)) throw new LifecycleError(400, `${where}: unknown surface`);
    const rule = (value: unknown, label: string) => {
      if (value === undefined || value === null) return null;
      if (!isValidRule(value)) throw new LifecycleError(400, `${where}: the ${label} rule is not valid`);
      const r = value as unknown as Record<string, unknown>;
      return { anchor: r.anchor, ...(r.offset !== undefined ? { offset: r.offset } : {}), ...(r.unit ? { unit: r.unit } : {}), ...(r.month !== undefined ? { month: r.month } : {}) } as TemplateTask['dueRule'];
    };
    const systemKey = t.systemKey === undefined || t.systemKey === null ? undefined : String(t.systemKey) as SystemTaskKey;
    if (systemKey && !SYSTEM_KEYS.has(systemKey)) throw new LifecycleError(400, `${where}: unknown systemKey`);
    const task: TemplateTask = {
      id, phase: t.phase as LifecyclePhase, title,
      ownerRole: t.ownerRole as OwnerRole, kind: t.kind as TaskKind, surface: t.surface as TaskSurface,
      opensRule: rule(t.opensRule, 'opens'), dueRule: rule(t.dueRule, 'due'),
      mustDo: t.mustDo === true, enabled: t.enabled !== false,
      order: Number.isFinite(t.order) ? Number(t.order) : (index + 1) * 10,
    };
    if (typeof t.helper === 'string' && t.helper.trim()) task.helper = t.helper.trim().slice(0, 300);
    if (systemKey) task.systemKey = systemKey;
    if (typeof t.dueLabel === 'string' && t.dueLabel.trim()) task.dueLabel = t.dueLabel.trim().slice(0, 60);
    if (t.recommended && typeof t.recommended === 'object') {
      const r = t.recommended as Record<string, unknown>;
      task.recommended = { why: String(r.why ?? '').slice(0, 300), added: r.added === true };
      // A recommended task runs only once HR adds it.
      if (!task.recommended.added) task.enabled = false;
    }
    if (t.after && typeof t.after === 'object') {
      const a = t.after as Record<string, unknown>;
      if (!SYSTEM_KEYS.has(a.key as SystemTaskKey)) throw new LifecycleError(400, `${where}: after names an unknown task`);
      task.after = { key: a.key as SystemTaskKey, ...(a.when === 'started' ? { when: 'started' as const } : {}) };
    }
    if (Array.isArray(t.documents)) {
      task.documents = t.documents.slice(0, 20).map((d, i) => {
        const doc = (d ?? {}) as Record<string, unknown>;
        const label = String(doc.label ?? '').trim();
        if (!label) throw new LifecycleError(400, `${where}: document ${i + 1} needs a label`);
        const key = String(doc.key ?? '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
        return { key, label: label.slice(0, 80), required: doc.required !== false };
      });
    }
    return task;
  });
}

export async function updateTemplate(org: string, id: string, input: Record<string, unknown>, byName?: string): Promise<LifecycleTemplate> {
  const current = await getTemplate(org, id);
  const set: Partial<LifecycleTemplate> = { updatedAt: new Date(), ...(byName ? { updatedByName: byName } : {}) };
  if (input.name !== undefined) set.name = cleanName(input.name);
  if (input.group !== undefined) set.group = typeof input.group === 'string' ? input.group.trim().slice(0, 80) : undefined;
  if (input.active !== undefined) {
    if (input.active !== true && current.isDefault) throw new LifecycleError(409, 'The default template cannot be switched off; make another one the default first');
    set.active = input.active === true;
  }
  const settings = input.settings !== undefined ? cleanSettings(current.kind, input.settings, current.settings) : current.settings;
  if (input.settings !== undefined) set.settings = settings;
  if (input.tasks !== undefined || input.settings !== undefined) {
    const tasks = input.tasks !== undefined ? cleanTasks(current.kind, input.tasks) : current.tasks;
    set.tasks = applySettingsToTasks(current.kind, settings, tasks);
  }
  if (input.isDefault !== undefined) {
    if (input.isDefault === true) {
      if ((set.active ?? current.active) === false) throw new LifecycleError(409, 'A switched-off template cannot be the default');
      await lifecycleTemplates().updateMany({ org, kind: current.kind, id: { $ne: id }, isDefault: true }, { $set: { isDefault: false, updatedAt: new Date() } });
      set.isDefault = true;
    } else if (current.isDefault) {
      throw new LifecycleError(409, 'Make another template the default instead');
    }
  }
  await lifecycleTemplates().updateOne({ org, id }, { $set: set });
  return getTemplate(org, id);
}

export async function deleteTemplate(org: string, id: string): Promise<LifecycleTemplate> {
  const current = await getTemplate(org, id);
  if (current.isDefault) throw new LifecycleError(409, 'The default template cannot be deleted');
  const inUse = await journeys().countDocuments({ org, templateId: id, closedAt: { $exists: false } });
  if (inUse > 0) throw new LifecycleError(409, `${inUse} ${inUse === 1 ? 'person is' : 'people are'} following this template`);
  await lifecycleTemplates().deleteOne({ org, id });
  return current;
}

/**
 * S3's Joiners tab: the open journeys following this template (the same
 * count as "Joiners using it"). A running journey keeps the snapshot it
 * started with, so there is no moving one to another template: the tab lists
 * them and opens each one.
 */
export async function templateJourneys(org: string, id: string) {
  const template = await getTemplate(org, id);
  const rows = await journeys().find(
    { org, templateId: id, closedAt: { $exists: false } },
    { projection: { _id: 0, id: 1, kind: 1, userId: 1, candidate: 1, status: 1, tj: 1, tl: 1, designation: 1, department: 1, boardTab: 1, boardColumn: 1, createdAt: 1 } },
  ).sort({ tj: 1, tl: 1, createdAt: 1 }).limit(500).toArray();
  const ids = [...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u))];
  const people = ids.length ? await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1 } }).toArray() : [];
  const byId = new Map(people.map((p) => [p.userId, p]));
  return {
    template: { id: template.id, kind: template.kind, name: template.name },
    journeys: rows.map((r) => {
      const who = r.userId ? byId.get(r.userId) : undefined;
      return {
        journeyId: r.id, kind: r.kind, name: who?.name ?? r.candidate?.name ?? '—',
        ...((r.designation ?? who?.designation) ? { designation: r.designation ?? who?.designation } : {}),
        ...((r.department ?? who?.department) ? { department: r.department ?? who?.department } : {}),
        ...(r.userId ? { userId: r.userId } : {}), status: r.status, ...(r.tj ? { tj: r.tj } : {}), ...(r.tl ? { tl: r.tl } : {}),
        ...(r.boardTab ? { tab: r.boardTab } : {}), ...(r.boardColumn ? { column: r.boardColumn } : {}),
      };
    }),
  };
}
