/**
 * Onboarding · Final designs: the template's design view (the dashboard's Setup › Employee
 * lifecycle › Onboarding templates editor reads and writes this, never raw rows), the kept copy of
 * an org's templates every app view reads (`lc-templates`), a journey's design rows, template media,
 * and the Employee preview. FINAL-DESIGNS.md §2–§5.
 */
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { letterTemplates, lifecycleFiles, lifecycleTemplates, shiftTemplates, users } from '../../config/db';
import type {
  DesignItem, DesignMedia, DesignQuestion, DesignStage, Journey, JoinerTaskType, LifecycleTemplate, LifecycleTemplateSettings, MeetWith, TeamRole,
  TemplateTask, TourLessonKey,
} from '../../models/lifecycle.model';
import { DESIGN_STAGES } from '../../models/lifecycle.model';
import { cachedLifecycle, forgetLifecycleReads } from './readCache';
import {
  CHECKIN_TYPES, MEET_WITH, TEAM_ROLES, TOUR_LESSON_KEYS, cleanAgendaPoints, cleanDesign, cleanDesignSettings, cleanMedia, cleanQuestions,
} from './designClean';
import { STAGE_LABEL, rulesOfStage } from './designRules';
import { FINAL_ONBOARDING_SETTINGS, TEAM_APP_COPY, accessRow, contentRow, meetingRow, taskRow, teamRow } from './designSeed';
import { LifecycleError } from './errors';
import { checkUpload, pdfPageCount, readFileBytes, storeFile, uploadName } from './files';
import { getTemplate } from './templates';

// ─── The kept templates ─────────────────────────────────────────────────────

type KeptTemplate = Pick<LifecycleTemplate, 'id' | 'name' | 'isDefault' | 'settings' | 'tasks' | 'updatedAt' | 'updatedByName'>;

/** An org's onboarding templates, kept (swr-cache `lc-templates`; dropped by every write in the org). */
export async function onboardingTemplatesOf(org: string): Promise<Map<string, KeptTemplate>> {
  const list = await cachedLifecycle(org, 'lc-templates', null, async () => (await lifecycleTemplates().find(
    { org, kind: 'onboarding' },
    { projection: { _id: 0, id: 1, name: 1, isDefault: 1, settings: 1, tasks: 1, updatedAt: 1, updatedByName: 1 } },
  ).toArray()) as KeptTemplate[]);
  return new Map(list.map((t) => [t.id, t]));
}

export const isDesignRow = (t: Pick<TemplateTask, 'design'>) => !!t.design;
const live = (t: TemplateTask) => t.enabled !== false && (!t.recommended || t.recommended.added);

export interface JourneyDesign {
  /** The design rows, switched on, in order: the template as it was when the journey started (its snapshot). */
  rows: TemplateTask[];
  settings: LifecycleTemplateSettings;
  /** The journey has design rows (else: an older journey on an older template). */
  isDesign: boolean;
}

/**
 * A journey's design rows: everything (meetings, check-ins and their questions, the watch list,
 * trainings, teammate rows, the settings) is the template as it was when the journey started — the
 * journey's snapshot — so a template edit reaches new joiners only ("New joiners get this from now
 * on"). The migration writes the design rows into running journeys' snapshots. Only a journey the
 * migration has not reached reads its template as it is now (and has no design rows if that has none).
 * The journey must be read with `templateSnapshot.tasks` (the board's kept copy is not).
 */
export async function designOf(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot'>): Promise<JourneyDesign> {
  const fromSnapshot = (j.templateSnapshot?.tasks ?? []).filter(isDesignRow);
  if (fromSnapshot.length) {
    return { rows: fromSnapshot.filter(live).sort((a, b) => a.order - b.order), settings: { ...(j.templateSnapshot?.settings ?? {}) }, isDesign: true };
  }
  const template = j.templateId ? (await onboardingTemplatesOf(j.org)).get(j.templateId) : undefined;
  const rows = (template?.tasks ?? []).filter(isDesignRow).filter(live).sort((a, b) => a.order - b.order);
  const settings = { ...(j.templateSnapshot?.settings ?? {}), ...(template?.settings ?? {}) };
  return { rows, settings, isDesign: rows.length > 0 };
}

/**
 * The pre-boarding watch list a joiner sees on the portal: the template's as it is NOW (HR adding a video
 * reaches everyone still pre-boarding), else their own copy when the template is gone. Off when the
 * template switched the watch list off.
 */
export async function preboardingWatchOf(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot'>): Promise<TemplateTask[]> {
  const template = j.templateId ? (await onboardingTemplatesOf(j.org)).get(j.templateId) : undefined;
  const source = template ?? j.templateSnapshot;
  if (source?.settings?.preboarding?.watch === false) return [];
  return (source?.tasks ?? []).filter(isDesignRow).filter(live)
    .filter((r) => r.design?.section === 'watch' && r.design.stage === 'pre' && !!r.design.media)
    .sort((a, b) => a.order - b.order);
}

/**
 * The template's "Joining and reporting details" a joiner reads (portal Day-1 pass and joining details, the
 * teammates' JOINING DETAILS): none when the template removed that pre-boarding row. What HR typed on the
 * joiner (`journey.day1Pass`) wins over it wherever it is read.
 */
export function templateReporting(settings: LifecycleTemplateSettings): LifecycleTemplateSettings['reporting'] {
  return settings.preboarding?.joiningDetails === false ? undefined : settings.reporting;
}

/**
 * The joining and reporting details a joiner sees, everywhere (portal, Day-1 pass, the dashboard panel,
 * the teammates' pages): before they join, the template's as it is NOW (HR filling them in or changing
 * them reaches everyone still to join); from the joining day, their own copy. HR's typed day1Pass still wins
 * where the pass is read.
 */
export async function reportingFor(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot' | 'userId' | 'status'>): Promise<LifecycleTemplateSettings['reporting']> {
  const joined = !!j.userId || ['joined', 'confirmed', 'closed'].includes(String(j.status));
  if (!joined && j.templateId) {
    const template = (await onboardingTemplatesOf(j.org)).get(j.templateId);
    if (template?.settings) return templateReporting(template.settings);
  }
  return templateReporting((await designOf(j)).settings);
}

/** The template row behind a journey task (its snapshot first: the task was made from it). */
export function designRowOfTask(j: Pick<Journey, 'templateSnapshot'>, templateTaskId: string, design?: JourneyDesign): TemplateTask | undefined {
  return j.templateSnapshot?.tasks?.find((t) => t.id === templateTaskId && !!t.design) ?? design?.rows.find((t) => t.id === templateTaskId);
}

// ─── The design view ────────────────────────────────────────────────────────

/** The app's default name for the trainings section. */
export const TRAININGS_LABEL = 'Trainings';

export interface WatchItemView { id: string; title: string; stage: DesignStage; media: DesignMedia }
export interface TemplateDesign {
  templateId: string; name: string; isDefault: boolean; updatedAt?: string; updatedByName?: string;
  preboarding: {
    rows: { offerLetter: boolean; joiningDetails: boolean; profile: boolean; watch: boolean };
    reporting: NonNullable<LifecycleTemplateSettings['reporting']>;
    videos: WatchItemView[];
  };
  meetings: Array<{ id: string; title: string; meetWith: MeetWith; stage: DesignStage; agenda: string[]; everyMonth?: boolean }>;
  tasks: Array<{ id: string; title: string; type: JoinerTaskType; stage: DesignStage; screen?: string; source?: 'policies'; link?: string; fileId?: string; letterTemplateId?: string; signDocs?: string[]; questions?: DesignQuestion[] }>;
  checkins: Array<{ id: string; title: string; stage: DesignStage; questions: DesignQuestion[] }>;
  tour: TourLessonKey[];
  watch: WatchItemView[];
  trainings: WatchItemView[];
  /** What the app calls the sections HR can rename. */
  labels: { trainings: string };
  accesses: Array<{ id: string; title: string; role: 'it' | 'hr' }>;
  probation: { months: 3 | 6; shiftTemplateId?: string };
  team: {
    remindLate: boolean;
    assignees: { hrUserId?: string; itUserId?: string; seniorUserId?: string };
    tasks: Array<{ id: string; key: string; title: string; role: TeamRole; stage: DesignStage; how?: string; everyMonth?: boolean }>;
  };
}

function viewOf(t: Pick<LifecycleTemplate, 'id' | 'name' | 'isDefault' | 'settings' | 'tasks' | 'updatedAt' | 'updatedByName'>): TemplateDesign {
  const rows = t.tasks.filter(isDesignRow).sort((a, b) => a.order - b.order);
  const of = (section: DesignItem['section']) => rows.filter((r) => r.design!.section === section);
  // Switched off in the editor: kept, shown off, reaching no joiner.
  const off = (r: TemplateTask) => (r.enabled === false ? { enabled: false as const } : {});
  const watchView = (r: TemplateTask): WatchItemView => ({ id: r.id, title: r.title, stage: r.design!.stage, media: { ...(r.design!.media ?? { type: 'video' }) }, ...off(r) });
  const s = t.settings ?? {};
  return {
    templateId: t.id, name: t.name, isDefault: t.isDefault,
    ...(t.updatedAt ? { updatedAt: new Date(t.updatedAt).toISOString() } : {}), ...(t.updatedByName ? { updatedByName: t.updatedByName } : {}),
    preboarding: {
      rows: { ...(FINAL_ONBOARDING_SETTINGS.preboarding!), ...(s.preboarding ?? {}) },
      reporting: { ...(s.reporting ?? { meets: 'hr' }) },
      videos: of('watch').filter((r) => r.design!.stage === 'pre').map(watchView),
    },
    meetings: of('meeting').map((r) => ({
      id: r.id, title: r.title, meetWith: r.design!.meetWith!, stage: r.design!.stage, agenda: [...(r.agenda ?? r.team?.agenda ?? [])],
      ...(r.design!.everyMonth ? { everyMonth: true } : {}), ...off(r),
    })),
    tasks: of('task').map((r) => {
      const d = r.design!;
      return {
        id: r.id, title: r.title, type: d.taskType ?? 'other', stage: d.stage,
        ...(d.screen ? { screen: d.screen } : {}), ...(d.source ? { source: d.source } : {}), ...(d.link ? { link: d.link } : {}),
        ...(d.fileId ? { fileId: d.fileId } : {}), ...(d.letterTemplateId ? { letterTemplateId: d.letterTemplateId } : {}),
        ...(d.signDocs ? { signDocs: [...d.signDocs] } : {}), ...(d.questions ? { questions: d.questions.map((q) => ({ ...q })) } : {}), ...off(r),
      };
    }),
    checkins: of('checkin').map((r) => ({ id: r.id, title: r.title, stage: r.design!.stage, questions: (r.design!.questions ?? []).map((q) => ({ ...q })), ...off(r) })),
    tour: s.tourLessons ? [...s.tourLessons] : [...TOUR_LESSON_KEYS],
    watch: of('watch').filter((r) => r.design!.stage !== 'pre').map(watchView),
    trainings: of('training').map(watchView),
    labels: { trainings: s.trainingsLabel || TRAININGS_LABEL },
    accesses: of('access').map((r) => ({ id: r.id, title: r.title, role: r.design!.role === 'hr' ? 'hr' as const : 'it' as const, ...off(r) })),
    probation: { months: s.probationMonths === 3 ? 3 : 6, ...(s.probationShiftTemplateId ? { shiftTemplateId: s.probationShiftTemplateId } : {}) },
    team: {
      remindLate: s.remindLateTeamTasks !== false,
      assignees: { ...(s.assignees ?? {}) },
      tasks: of('team').map((r) => ({
        id: r.id, key: r.team?.key ?? r.id, title: r.title, role: r.design!.role!, stage: r.design!.stage,
        ...(r.design!.how ? { how: r.design!.how } : {}), ...(r.design!.everyMonth ? { everyMonth: true } : {}), ...off(r),
      })),
    },
  };
}

/** GET /admin/lifecycle/templates/:id/design */
export async function templateDesign(org: string, id: string): Promise<TemplateDesign> {
  const t = await getTemplate(org, id);
  if (t.kind !== 'onboarding') throw new LifecycleError(400, 'Only onboarding templates have this editor');
  return viewOf(t);
}

const list = (v: unknown, what: string): Array<Record<string, unknown>> => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LifecycleError(400, `${what} is a list`);
  if (v.length > 120) throw new LifecycleError(400, `${what}: at most 120`);
  return v.map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>);
};
const title = (v: unknown, where: string): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 120) throw new LifecycleError(400, `${where}: a title of up to 120 characters is required`);
  return s;
};
const stageOf = (v: unknown, where: string, allowPre = true): DesignStage => {
  if (!DESIGN_STAGES.includes(v as DesignStage) || (!allowPre && v === 'pre')) throw new LifecycleError(400, `${where}: stage is one of ${DESIGN_STAGES.filter((s) => allowPre || s !== 'pre').join(', ')}`);
  return v as DesignStage;
};

/**
 * PUT /admin/lifecycle/templates/:id/design — the whole editor ("Save template"). The rows the
 * editor does not draw (the offer, the portal, documents, letters, Mark joined, HR's decision, and an
 * older template's own rows) are kept as they are. A row sent back with its id keeps that id (and its
 * team key, so ticks on running journeys stay with it); a new one gets a new id.
 */
export async function saveTemplateDesign(org: string, id: string, input: Record<string, unknown>, byName?: string): Promise<TemplateDesign> {
  const current = await getTemplate(org, id);
  if (current.kind !== 'onboarding') throw new LifecycleError(400, 'Only onboarding templates have this editor');
  const before = new Map(current.tasks.map((t) => [t.id, t]));
  const kept = current.tasks.filter((t) => !isDesignRow(t));
  const rows: TemplateTask[] = [];
  let order = 0;
  const next = () => (order += 10);
  const prior = (rawId: unknown, section: DesignItem['section']) => {
    const row = typeof rawId === 'string' ? before.get(rawId) : undefined;
    return row?.design?.section === section ? row : undefined;
  };
  const files: string[] = [];
  const letters: string[] = [];
  // A row HR switched off stays in the template (enabled: false) and reaches no joiner; switched on again later.
  const mark = (raw: Record<string, unknown>) => { const r = rows[rows.length - 1]; if (r) r.enabled = raw.enabled !== false; };

  // Pre-boarding videos, the watch list and trainings.
  const watchOf = (raw: Record<string, unknown>, section: 'watch' | 'training', where: string, pre: boolean) => {
    const was = prior(raw.id, section);
    const stage = pre ? 'pre' : stageOf(raw.stage, where, false);
    const media = cleanMedia(raw.media ?? { type: 'video' }, section === 'training' ? ['video', 'pdf'] : ['video', 'image', 'text'], where);
    if (media.fileId) files.push(media.fileId);
    rows.push(contentRow({ id: was?.id ?? `fd-${section}-${randomUUID().slice(0, 8)}`, section, title: title(raw.title ?? (media.type === 'text' ? 'A note from us' : 'Untitled'), where), stage, media, order: next() }));
    mark(raw);
  };
  const pre = (input.preboarding ?? {}) as Record<string, unknown>;
  list(pre.videos, 'preboarding.videos').forEach((v, i) => watchOf(v, 'watch', `Pre-boarding video ${i + 1}`, true));
  list(input.meetings, 'meetings').forEach((m, i) => {
    const where = `Meeting ${i + 1}`;
    const was = prior(m.id, 'meeting');
    const meetWith = m.meetWith as MeetWith;
    if (!MEET_WITH.includes(meetWith)) throw new LifecycleError(400, `${where}: meetWith is one of ${MEET_WITH.join(', ')}`);
    const row = meetingRow({
      id: was?.id, key: was?.team?.key ?? `meet_${randomUUID().slice(0, 8)}`, title: title(m.title, where), meetWith,
      stage: stageOf(m.stage, where, false), agenda: cleanAgendaPoints(m.agenda, where), everyMonth: m.everyMonth === true, order: next(),
    });
    rows.push(row);
    mark(m);
  });
  list(input.tasks, 'tasks').forEach((t, i) => {
    const where = `Task ${i + 1}`;
    const was = prior(t.id, 'task');
    const type = t.type as JoinerTaskType;
    if (type === 'sign' && was?.systemKey !== 'sign_letters') throw new LifecycleError(400, `${where}: documents to sign are the template's own Sign row`);
    const design = cleanDesign('onboarding', { ...t, section: 'task', taskType: type, stage: t.stage }, where);
    if (design.stage === 'pre') throw new LifecycleError(400, `${where}: tasks start on Day 1`);
    if (design.fileId) files.push(design.fileId);
    if (design.letterTemplateId) letters.push(design.letterTemplateId);
    for (const doc of design.signDocs ?? []) if (doc !== 'appointment') letters.push(doc);
    const { section: _s, stage: _st, ...rest } = design;
    const row = taskRow({ id: was?.id ?? `fd-task-${randomUUID().slice(0, 8)}`, title: title(t.title, where), stage: design.stage, design: rest, ...(was?.systemKey ? { systemKey: was.systemKey } : {}), order: next() });
    if (was?.systemKey === 'sign_letters') rows.push({ ...was, ...row, ...rulesOfStage(design), surface: 'app' });
    else rows.push(row);
    mark(t);
  });
  list(input.checkins, 'checkins').forEach((c, i) => {
    const where = `Check-in ${i + 1}`;
    const was = prior(c.id, 'checkin');
    const stage = stageOf(c.stage, where, false);
    if (stage === 'm1' || stage === 'w1' || stage === 'd1' || stage === 'mid' || stage === 'fin') {
      rows.push(contentRow({ id: was?.id ?? `fd-checkin-${randomUUID().slice(0, 8)}`, section: 'checkin', title: title(c.title, where), stage, questions: cleanQuestions(c.questions ?? [], CHECKIN_TYPES, where), order: next() }));
      mark(c);
    }
  });
  list(input.watch, 'watch').forEach((w, i) => watchOf(w, 'watch', `Watch list item ${i + 1}`, false));
  list(input.trainings, 'trainings').forEach((w, i) => watchOf(w, 'training', `Training ${i + 1}`, false));
  list(input.accesses, 'accesses').forEach((a, i) => {
    const where = `Device or access ${i + 1}`;
    const was = prior(a.id, 'access');
    rows.push(accessRow({ id: was?.id ?? `fd-access-${randomUUID().slice(0, 8)}`, title: title(a.title, where), role: a.role === 'hr' ? 'hr' : 'it', order: next() }));
    mark(a);
  });
  const team = (input.team ?? {}) as Record<string, unknown>;
  const keys = new Set<string>();
  list(team.tasks, 'team.tasks').forEach((t, i) => {
    const where = `Team task ${i + 1}`;
    const was = prior(t.id, 'team');
    const role = t.role as TeamRole;
    if (!TEAM_ROLES.includes(role)) throw new LifecycleError(400, `${where}: role is one of ${TEAM_ROLES.join(', ')}`);
    const key = was?.team?.key ?? `custom_${randomUUID().slice(0, 8)}`;
    if (keys.has(key)) throw new LifecycleError(400, `${where}: listed twice`);
    keys.add(key);
    const how = typeof t.how === 'string' ? t.how.trim().slice(0, 140) : '';
    rows.push(teamRow({
      id: was?.id ?? `fd-team-${randomUUID().slice(0, 8)}`, key, title: title(t.title, where), role, stage: stageOf(t.stage, where),
      ...(how ? { how } : {}), everyMonth: was?.design?.everyMonth === true || t.everyMonth === true, order: next(),
    }));
    mark(t);
  });
  for (const r of rows) if (r.team?.key && keys.has(r.team.key) && r.design?.section === 'meeting') throw new LifecycleError(400, `${r.title}: a meeting and a team task share a key`);

  // Settings.
  const prob = (input.probation ?? {}) as Record<string, unknown>;
  const months = prob.months === 3 ? 3 : prob.months === 6 || prob.months === undefined ? (prob.months === undefined ? (current.settings.probationMonths ?? 6) : 6) : null;
  if (months === null) throw new LifecycleError(400, 'Probation is 3 or 6 months');
  const settings: LifecycleTemplateSettings = {
    ...current.settings,
    probationMonths: months as 3 | 6,
    ...cleanDesignSettings({
      preboarding: pre.rows ?? current.settings.preboarding ?? FINAL_ONBOARDING_SETTINGS.preboarding,
      reporting: pre.reporting ?? current.settings.reporting ?? { meets: 'hr' },
      tourLessons: input.tour ?? current.settings.tourLessons ?? TOUR_LESSON_KEYS,
      remindLateTeamTasks: team.remindLate ?? current.settings.remindLateTeamTasks ?? true,
      assignees: team.assignees ?? current.settings.assignees ?? {},
    }),
    signLettersOnDay1: rows.some((r) => r.systemKey === 'sign_letters'),
  };
  {
    const label = (input.labels as { trainings?: unknown } | undefined)?.trainings;
    if (label !== undefined) {
      const v = typeof label === 'string' ? label.trim() : '';
      if (v.length > 40) throw new LifecycleError(400, 'The trainings section name is at most 40 characters');
      if (v && v !== TRAININGS_LABEL) settings.trainingsLabel = v; else delete settings.trainingsLabel;
    }
  }
  delete settings.probationShiftTemplateId;
  if (typeof prob.shiftTemplateId === 'string' && prob.shiftTemplateId.trim()) settings.probationShiftTemplateId = prob.shiftTemplateId.trim();

  // Ids that must be the org's own.
  await checkOwnIds(org, { files, letters, shiftTemplateId: settings.probationShiftTemplateId, assignees: settings.assignees ?? {} });

  const tasks = [...rows, ...kept.filter((t) => !rows.some((r) => r.id === t.id))];
  const now = new Date();
  await lifecycleTemplates().updateOne({ org, id }, { $set: { tasks, settings, updatedAt: now, ...(byName ? { updatedByName: byName } : {}) } });
  forgetLifecycleReads(org);
  // Everyone on this template follows it now, not only new joiners.
  const { followTemplate } = await import('./engine');
  await followTemplate(org, id);
  forgetLifecycleReads(org);
  return templateDesign(org, id);
}

async function checkOwnIds(org: string, ids: { files: string[]; letters: string[]; shiftTemplateId?: string; assignees: NonNullable<LifecycleTemplateSettings['assignees']> }): Promise<void> {
  const files = [...new Set(ids.files)];
  if (files.length && (await lifecycleFiles().countDocuments({ org, id: { $in: files } })) !== files.length) throw new LifecycleError(400, 'A file is not one of this company’s uploads');
  const letters = [...new Set(ids.letters)];
  if (letters.length && (await letterTemplates().countDocuments({ org, id: { $in: letters } })) !== letters.length) throw new LifecycleError(400, 'A document is not one of this company’s Document templates');
  if (ids.shiftTemplateId) {
    const oid = ObjectId.isValid(ids.shiftTemplateId) ? new ObjectId(ids.shiftTemplateId) : null;
    const shift = oid ? await shiftTemplates().findOne({ _id: oid, org, active: true, deletedAt: { $exists: false } }, { projection: { _id: 1 } }) : null;
    if (!shift) throw new LifecycleError(400, 'The probation template is not one of this company’s shift templates');
  }
  const people = [...new Set(Object.values(ids.assignees).filter((x): x is string => !!x))];
  if (people.length) {
    const found = await users().countDocuments({ org, userId: { $in: people }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never);
    if (found !== people.length) throw new LifecycleError(400, 'Pick people who work here');
  }
}

// ─── Media ──────────────────────────────────────────────────────────────────

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** MP4 / MOV (an `ftyp` box first). */
function isVideo(bytes: Buffer): 'video/mp4' | 'video/quicktime' | undefined {
  if (bytes.length < 12 || bytes.toString('latin1', 4, 8) !== 'ftyp') return undefined;
  return bytes.toString('latin1', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
}

/** A video's length in seconds, from its `mvhd` box (absent when it cannot be read). */
export function videoSeconds(bytes: Buffer): number | undefined {
  const at = bytes.indexOf('mvhd', 0, 'latin1');
  if (at < 4 || at + 24 > bytes.length) return undefined;
  const version = bytes[at + 4];
  try {
    if (version === 1) {
      const timescale = bytes.readUInt32BE(at + 24);
      const duration = Number(bytes.readBigUInt64BE(at + 28));
      return timescale ? duration / timescale : undefined;
    }
    const timescale = bytes.readUInt32BE(at + 16);
    const duration = bytes.readUInt32BE(at + 20);
    return timescale ? duration / timescale : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /admin/lifecycle/templates/:id/media — a pre-boarding or watch-list video, an image, or a
 * training PDF. `minutes` (a video's length, or a PDF's pages at a minute each) goes into the row's
 * `media.minutes` ("3 min", "5 min read").
 */
export async function uploadTemplateMedia(org: string, templateId: string, file: { originalname?: string; buffer: Buffer } | undefined) {
  await getTemplate(org, templateId);
  if (!file?.buffer?.length) throw new LifecycleError(400, 'Choose a file');
  const video = isVideo(file.buffer);
  let contentType: string;
  if (video) {
    if (file.buffer.length > MAX_VIDEO_BYTES) throw new LifecycleError(400, 'A video can be up to 50 MB');
    contentType = video;
  } else {
    contentType = checkUpload(file.buffer);
  }
  const stored = await storeFile(org, undefined, { name: uploadName(file.originalname ?? 'file'), contentType, bytes: file.buffer }, 'hr');
  let minutes: number | undefined;
  if (video) {
    const seconds = videoSeconds(file.buffer);
    if (seconds) minutes = Math.max(1, Math.round(seconds / 60));
  } else if (contentType === 'application/pdf') {
    const pages = await pdfPageCount(stored).catch(() => undefined);
    if (pages) minutes = pages;
  }
  return { file: { id: stored.id, name: stored.name, contentType: stored.contentType, size: stored.size, ...(minutes ? { minutes } : {}) } };
}

/** The bytes of a template media file of the org (dashboard preview; the joiner's app checks its own template first). */
export async function templateMediaBytes(org: string, fileId: string): Promise<{ name: string; contentType: string; bytes: Buffer }> {
  const file = await lifecycleFiles().findOne({ org, id: fileId, journeyId: { $exists: false } }, { projection: { _id: 0 } });
  if (!file) throw new LifecycleError(404, 'File not found');
  return { name: file.name, contentType: file.contentType, bytes: await readFileBytes(file) };
}

/** Whether a file is media of one of the journey's design rows (the joiner may read it). */
export async function journeyMayRead(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot'>, fileId: string): Promise<boolean> {
  const { rows } = await designOf(j);
  if (rows.some((r) => r.design?.media?.fileId === fileId || r.design?.media?.posterFileId === fileId || r.design?.fileId === fileId)) return true;
  // The template's current pre-boarding watch list (preboardingWatchOf) is theirs to watch too.
  return (await preboardingWatchOf(j)).some((r) => r.design?.media?.fileId === fileId || r.design?.media?.posterFileId === fileId);
}

// ─── Employee preview ───────────────────────────────────────────────────────

/** GET /admin/lifecycle/templates/:id/preview?stage= — what the phone shows at that stage. */
export async function templatePreview(org: string, id: string, stageRaw: unknown) {
  const t = await getTemplate(org, id);
  const view = viewOf(t);
  const stage = (DESIGN_STAGES.includes(stageRaw as DesignStage) ? stageRaw : 'd1') as DesignStage;
  const months = view.probation.months;
  const order = DESIGN_STAGES.indexOf(stage);
  const at = (s: DesignStage) => s === stage;
  // The Watch list tile counts the watch list (the canvas: its videos up to this stage, not the trainings).
  const watchAll = stage === 'pre' ? view.preboarding.videos : view.watch.filter((w) => DESIGN_STAGES.indexOf(w.stage) <= order);
  if (stage === 'pre') {
    return {
      stage, header: 'Welcome' as const, stageLabel: STAGE_LABEL(stage, months),
      joining: view.preboarding.rows.joiningDetails ? { ...view.preboarding.reporting } : null,
      offerLetter: view.preboarding.rows.offerLetter,
      profile: view.preboarding.rows.profile ? { sections: 7 } : null,
      watch: view.preboarding.rows.watch && watchAll.length ? { first: watchAll[0].title, ready: watchAll.filter((w) => !!w.media.fileId || w.media.type === 'text').length, total: watchAll.length } : null,
    };
  }
  const meetings = view.meetings.filter((m) => at(m.stage));
  const tasks = view.tasks.filter((x) => at(x.stage));
  const early = stage === 'd1' || stage === 'w1';
  return {
    stage, header: 'Onboarding' as const, stageLabel: STAGE_LABEL(stage, months),
    meetings: { count: meetings.length, who: meetings.map((m) => m.meetWith).slice(0, 3) },
    tasks: { first: tasks[0]?.title, count: tasks.length },
    tour: early && view.tour.length ? { first: stage === 'd1' ? 'punch' : view.tour.find((l) => l !== 'punch') ?? null } : null,
    watch: order <= DESIGN_STAGES.indexOf('m1') && watchAll.length ? { first: watchAll[0].title, ready: watchAll.filter((w) => !!w.media.fileId || w.media.type === 'text').length, total: watchAll.length } : null,
    devices: early && view.accesses.length ? { count: view.accesses.length } : null,
    profile: true,
  };
}

/** The app wording of a seeded teammate row ("Assign {n} a buddy"); a custom row says its title. */
export const teamAppTitle = (key: string, templateTitle: string) => TEAM_APP_COPY[key]?.title ?? templateTitle;
