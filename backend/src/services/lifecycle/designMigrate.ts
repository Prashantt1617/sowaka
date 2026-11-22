/**
 * Onboarding · Final designs: moving an older onboarding template to the design rows, without
 * losing anything (FINAL-DESIGNS.md §7). Per template that has no design rows yet:
 *
 * 1. adds the canvas's rows (designSeed.ts), keeping the template's probation length;
 * 2. switches off (`enabled: false`, `replacedBy: 'final_designs'`) the older rows they replace and the
 *    20 Nov team rows; nothing is deleted, so running journeys and their ticks read as before;
 * 3. makes `sign_letters` the Day-1 Sign task (the same row, so a running journey's task keeps going).
 *
 * HR's own rows (no systemKey, not a seeded team row) stay as they are and are listed.
 */
import { companies, journeys, lifecycleTemplates } from '../../config/db';
import type { LifecycleTemplate, TemplateTask } from '../../models/lifecycle.model';
import { rulesOfStage } from './designRules';
import { FINAL_ONBOARDING_SETTINGS, REPLACED_KEYS, finalDesignRows } from './designSeed';
import { teamSeed } from './seed';

const OLD_TEAM_KEYS = new Set(teamSeed().map((t) => t.team!.key));

export interface TemplateMigration {
  org: string; templateId: string; name: string;
  added: string[]; switchedOff: string[]; keptCustom: string[]; signOnDay1: boolean;
  /** Running journeys on it that get the design rows as their own snapshot (their view as it is today). */
  journeys: number;
}

/** The Final-designs settings a running journey's snapshot gains (never its probation length or signing place). */
const DESIGN_SETTING_KEYS = ['preboarding', 'reporting', 'tourLessons', 'remindLateTeamTasks', 'assignees'] as const;

/** What the migration does to one template (the new tasks and settings), without writing. */
export function migrateTemplate(t: Pick<LifecycleTemplate, 'tasks' | 'settings'>, company?: string): { tasks: TemplateTask[]; settings: LifecycleTemplate['settings']; report: Omit<TemplateMigration, 'org' | 'templateId' | 'name' | 'journeys'> } {
  const design = finalDesignRows(company);
  const signDesign = design.find((r) => r.design?.taskType === 'sign')!;
  const newKeys = new Set(design.flatMap((r) => (r.team ? [r.team.key] : [])));
  const switchedOff: string[] = [];
  const keptCustom: string[] = [];
  const old = t.tasks.map((row): TemplateTask => {
    if (row.systemKey === 'sign_letters') {
      return { ...row, title: signDesign.title, ...rulesOfStage(signDesign.design!), surface: 'app', order: signDesign.order, design: { ...signDesign.design! } };
    }
    const replaced = (row.systemKey && REPLACED_KEYS.includes(row.systemKey)) || (row.team && OLD_TEAM_KEYS.has(row.team.key));
    if (replaced) {
      if (row.enabled !== false) switchedOff.push(row.title);
      // A 20 Nov row whose key the designs reuse (hod_approve, mgr_welcome): the new row takes the key
      // (and the ticks under it, which mean the same); the old one keeps a key of its own, so a
      // template never lists one key twice.
      const team = row.team && newKeys.has(row.team.key) ? { ...row.team, key: `${row.team.key}_20nov` } : row.team;
      return { ...row, ...(team ? { team } : {}), enabled: false, replacedBy: 'final_designs' };
    }
    if (!row.systemKey && !row.team) keptCustom.push(row.title);
    return row;
  });
  const hasSign = old.some((r) => r.systemKey === 'sign_letters');
  const add = design.filter((r) => r.systemKey !== 'sign_letters' && !old.some((o) => o.id === r.id));
  // A template without the portal's sign row gets none (its company signs elsewhere).
  const tasks = [...old.map((r) => (r.systemKey === 'sign_letters' ? r : { ...r, order: r.design ? r.order : 10_000 + r.order })), ...add];
  const settings = {
    ...FINAL_ONBOARDING_SETTINGS, ...t.settings,
    probationMonths: t.settings.probationMonths ?? 6,
    signLettersOnDay1: hasSign ? true : t.settings.signLettersOnDay1 === true,
    preboarding: t.settings.preboarding ?? FINAL_ONBOARDING_SETTINGS.preboarding,
    reporting: t.settings.reporting ?? FINAL_ONBOARDING_SETTINGS.reporting,
    tourLessons: t.settings.tourLessons ?? FINAL_ONBOARDING_SETTINGS.tourLessons,
    remindLateTeamTasks: t.settings.remindLateTeamTasks ?? true,
    assignees: t.settings.assignees ?? {},
  };
  return { tasks, settings, report: { added: add.map((r) => r.title), switchedOff, keptCustom, signOnDay1: hasSign } };
}

/** Every onboarding template without design rows (one org, or all); `apply` false only reports. */
export async function migrateTemplatesToFinalDesigns(opts: { apply: boolean; org?: string }): Promise<TemplateMigration[]> {
  const docs = await lifecycleTemplates().find({ kind: 'onboarding', ...(opts.org ? { org: opts.org } : {}) }, { projection: { _id: 0 } }).toArray();
  const out: TemplateMigration[] = [];
  const names = new Map<string, string | undefined>();
  for (const doc of docs) {
    if (doc.tasks.some((t) => !!t.design)) continue;
    if (!names.has(doc.org)) names.set(doc.org, (await companies().findOne({ id: doc.org }, { projection: { _id: 0, name: 1 } }))?.name);
    const { tasks, settings, report } = migrateTemplate(doc, names.get(doc.org));
    // Running journeys on it: each keeps the version it started with, so the design rows it reads (meetings,
    // check-ins, watch list, teammate rows: never tasks or accesses, which stay its own journey tasks) go into
    // its snapshot now, as the template has them after the migration — the view it has today.
    const readRows = tasks.filter((t) => t.design && t.design.section !== 'task' && t.design.section !== 'access');
    const running = { org: doc.org, kind: 'onboarding' as const, templateId: doc.id, closedAt: { $exists: false }, 'templateSnapshot.tasks.design': { $exists: false } };
    const count = await journeys().countDocuments(running);
    out.push({ org: doc.org, templateId: doc.id, name: doc.name, ...report, journeys: count });
    if (opts.apply && count) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of DESIGN_SETTING_KEYS) if (settings[k] !== undefined) set[`templateSnapshot.settings.${k}`] = settings[k];
      await journeys().updateMany(running, { $push: { 'templateSnapshot.tasks': { $each: readRows } }, $set: set } as never);
    }
    if (opts.apply) {
      // Only while it still has no design rows (a second run, or a save meanwhile, writes nothing).
      await lifecycleTemplates().updateOne(
        { org: doc.org, id: doc.id, 'tasks.design': { $exists: false } },
        { $set: { tasks, settings, updatedAt: new Date() } },
      );
    }
  }
  return out;
}
