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
import { companies, lifecycleTemplates } from '../../config/db';
import type { LifecycleTemplate, TemplateTask } from '../../models/lifecycle.model';
import { rulesOfStage } from './designRules';
import { FINAL_ONBOARDING_SETTINGS, REPLACED_KEYS, finalDesignRows } from './designSeed';
import { teamSeed } from './seed';

const OLD_TEAM_KEYS = new Set(teamSeed().map((t) => t.team!.key));

export interface TemplateMigration {
  org: string; templateId: string; name: string;
  added: string[]; switchedOff: string[]; keptCustom: string[]; signOnDay1: boolean;
}

/** What the migration does to one template (the new tasks and settings), without writing. */
export function migrateTemplate(t: Pick<LifecycleTemplate, 'tasks' | 'settings'>, company?: string): { tasks: TemplateTask[]; settings: LifecycleTemplate['settings']; report: Omit<TemplateMigration, 'org' | 'templateId' | 'name'> } {
  const design = finalDesignRows(company);
  const signDesign = design.find((r) => r.design?.taskType === 'sign')!;
  const switchedOff: string[] = [];
  const keptCustom: string[] = [];
  const old = t.tasks.map((row): TemplateTask => {
    if (row.systemKey === 'sign_letters') {
      return { ...row, title: signDesign.title, ...rulesOfStage(signDesign.design!), surface: 'app', order: signDesign.order, design: { ...signDesign.design! } };
    }
    const replaced = (row.systemKey && REPLACED_KEYS.includes(row.systemKey)) || (row.team && OLD_TEAM_KEYS.has(row.team.key));
    if (replaced) {
      if (row.enabled !== false) switchedOff.push(row.title);
      return { ...row, enabled: false, replacedBy: 'final_designs' };
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
    out.push({ org: doc.org, templateId: doc.id, name: doc.name, ...report });
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
