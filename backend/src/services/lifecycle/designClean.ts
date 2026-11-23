/**
 * Validation of a Final-designs row's `design` and the template's Final-designs settings
 * (FINAL-DESIGNS.md §2, §4.1). Shapes only; that ids belong to the org is checked in design.ts.
 */
import { randomUUID } from 'node:crypto';
import type {
  CheckinAnswerType, DesignItem, DesignMedia, DesignQuestion, DesignSection, DesignStage, DoScreen, FormAnswerType, JoinerTaskType,
  LifecycleKind, LifecycleTemplateSettings, MediaBackground, MeetWith, ReviewPage, TeamRole, TourLessonKey,
} from '../../models/lifecycle.model';
import { DESIGN_STAGES } from '../../models/lifecycle.model';
import { LifecycleError } from './errors';

export const SECTIONS: DesignSection[] = ['meeting', 'task', 'checkin', 'watch', 'training', 'access', 'team'];
export const TASK_TYPES: JoinerTaskType[] = ['do', 'review', 'ack', 'sign', 'other', 'form'];
export const DO_SCREENS: DoScreen[] = ['punch', 'profile', 'tax', 'payroll', 'leave', 'overtime'];
export const REVIEW_PAGES: ReviewPage[] = ['shift', 'payroll_policy', 'kpis', 'leave_balance'];
export const MEET_WITH: MeetWith[] = ['hr', 'manager', 'buddy', 'it', 'head_of_department'];
export const TEAM_ROLES: TeamRole[] = ['manager', 'buddy', 'hr', 'it', 'senior', 'head_of_department'];
export const CHECKIN_TYPES: CheckinAnswerType[] = ['rating', 'yes_no', 'short', 'long', 'choice'];
export const FORM_TYPES: FormAnswerType[] = ['short', 'long', 'choice', 'date', 'file'];
export const TOUR_LESSON_KEYS: TourLessonKey[] = ['punch', 'missed', 'leave', 'overtime', 'approveLeave', 'approveOvertime'];
export const BACKGROUNDS: MediaBackground[] = ['rust', 'blue', 'ink', 'green', 'purple', 'sand'];

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string, where: string): T => {
  if (!list.includes(v as T)) throw new LifecycleError(400, `${where}: ${what} is one of ${list.join(', ')}`);
  return v as T;
};

export function cleanLink(v: unknown, where: string): string | undefined {
  const link = str(v, 500);
  if (!link) return undefined;
  let url: URL;
  try { url = new URL(link); } catch { throw new LifecycleError(400, `${where}: the link is not a web address`); }
  if (url.protocol !== 'https:') throw new LifecycleError(400, `${where}: the link starts with https://`);
  return url.toString();
}

export function cleanQuestions(v: unknown, types: readonly string[], where: string): DesignQuestion[] {
  if (!Array.isArray(v)) throw new LifecycleError(400, `${where}: questions is a list`);
  if (v.length > 20) throw new LifecycleError(400, `${where}: at most 20 questions`);
  const seen = new Set<string>();
  return v.flatMap((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const text = str(r.text, 200);
    if (!text) return [];   // an empty question is dropped on save
    const type = oneOf(r.type, types, 'the answer type', `${where} question ${i + 1}`) as DesignQuestion['type'];
    let id = str(r.id, 40) ?? `q${randomUUID().slice(0, 8)}`;
    if (seen.has(id)) id = `q${randomUUID().slice(0, 8)}`;
    seen.add(id);
    const options = type === 'choice' && Array.isArray(r.options) ? r.options.map((o) => str(o, 80)).filter((o): o is string => !!o).slice(0, 10) : undefined;
    return [{ id, text, type, ...(options?.length ? { options } : {}) }];
  });
}

export function cleanAgendaPoints(v: unknown, where: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LifecycleError(400, `${where}: agenda is a list`);
  return v.map((a) => str(a, 160)).filter((a): a is string => !!a).slice(0, 12);
}

export function cleanMedia(v: unknown, types: ReadonlyArray<DesignMedia['type']>, where: string): DesignMedia {
  const r = (v ?? {}) as Record<string, unknown>;
  const type = oneOf(r.type, types, 'the type', where);
  const media: DesignMedia = { type };
  const fileId = str(r.fileId, 64);
  if (fileId && type !== 'text') media.fileId = fileId;
  // The uploaded file's name, shown in the dashboard editor (lane D).
  const name = str(r.name, 120);
  if (name && media.fileId) media.name = name;
  // A video's thumbnail (made in the dashboard when it is uploaded).
  const poster = str(r.posterFileId, 64);
  if (poster && media.fileId && type === 'video') media.posterFileId = poster;
  if (type === 'text') {
    const text = str(r.text, 160);
    if (text) media.text = text;
    media.bg = r.bg === undefined ? 'rust' : oneOf(r.bg, BACKGROUNDS, 'the background', where);
  }
  if (Number.isFinite(r.minutes) && Number(r.minutes) > 0) media.minutes = Math.min(600, Math.round(Number(r.minutes)));
  return media;
}

/** A row's `design`, cleaned (the older editor sends it back as it got it). */
export function cleanDesign(kind: LifecycleKind, raw: unknown, where: string): DesignItem {
  if (kind !== 'onboarding') throw new LifecycleError(400, `${where}: design rows are for onboarding`);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const section = oneOf(r.section, SECTIONS, 'section', where);
  const stage = oneOf(r.stage, DESIGN_STAGES, 'stage', where) as DesignStage;
  const d: DesignItem = { section, stage };
  if (section === 'meeting') {
    d.meetWith = oneOf(r.meetWith, MEET_WITH, 'meetWith', where);
    if (r.everyMonth === true) d.everyMonth = true;
  }
  if (section === 'task') {
    d.taskType = oneOf(r.taskType, TASK_TYPES, 'taskType', where);
    if (r.screen !== undefined && r.screen !== null) {
      d.screen = oneOf(r.screen, d.taskType === 'review' ? REVIEW_PAGES : DO_SCREENS, 'screen', where);
    }
    if (r.source === 'policies') d.source = 'policies';
    const link = cleanLink(r.link, where);
    if (link) d.link = link;
    const fileId = str(r.fileId, 64);
    if (fileId) d.fileId = fileId;
    const letterTemplateId = str(r.letterTemplateId, 64);
    if (letterTemplateId) d.letterTemplateId = letterTemplateId;
    if (Array.isArray(r.signDocs)) d.signDocs = [...new Set(r.signDocs.map((x) => str(x, 64)).filter((x): x is string => !!x))].slice(0, 10);
    if (d.taskType === 'form') d.questions = cleanQuestions(r.questions ?? [], FORM_TYPES, where);
  }
  if (section === 'checkin') d.questions = cleanQuestions(r.questions ?? [], CHECKIN_TYPES, where);
  if (section === 'watch') d.media = cleanMedia(r.media ?? { type: 'video' }, ['video', 'image', 'text'], where);
  if (section === 'training') d.media = cleanMedia(r.media ?? { type: 'video' }, ['video', 'pdf'], where);
  if (section === 'team') {
    d.role = oneOf(r.role, TEAM_ROLES, 'role', where);
    if (r.everyMonth === true) d.everyMonth = true;
  }
  if (section === 'access') d.role = r.role === 'hr' ? 'hr' : 'it';
  if (section === 'team' || section === 'meeting') {
    const how = str(r.how, 140);
    if (how) d.how = how;
  }
  return d;
}

/** The template's Final-designs settings, cleaned (absent keys are left as they are). */
export function cleanDesignSettings(s: Record<string, unknown>): Partial<LifecycleTemplateSettings> {
  const out: Partial<LifecycleTemplateSettings> = {};
  if (s.preboarding !== undefined) {
    const p = (s.preboarding ?? {}) as Record<string, unknown>;
    out.preboarding = { offerLetter: p.offerLetter !== false, joiningDetails: p.joiningDetails !== false, profile: p.profile !== false, watch: p.watch !== false };
  }
  if (s.reporting !== undefined) {
    const r = (s.reporting ?? {}) as Record<string, unknown>;
    const mapLink = str(r.mapLink, 500);
    if (mapLink && !/^https:\/\/\S+$/i.test(mapLink)) throw new LifecycleError(400, 'The maps link is a web address starting with https://');
    out.reporting = {
      ...(mapLink ? { mapLink } : {}),
      ...(hhmm(str(r.time, 20)) ? { time: hhmm(str(r.time, 20))! } : {}), ...(str(r.place, 200) ? { place: str(r.place, 200) } : {}),
      ...(str(r.bring, 300) ? { bring: str(r.bring, 300) } : {}), ...(str(r.notes, 300) ? { notes: str(r.notes, 300) } : {}),
      meets: r.meets === 'manager' || r.meets === 'buddy' ? r.meets : 'hr',
    };
  }
  if (s.tourLessons !== undefined) {
    if (!Array.isArray(s.tourLessons) || !s.tourLessons.every((k) => TOUR_LESSON_KEYS.includes(k as TourLessonKey))) {
      throw new LifecycleError(400, `tourLessons lists ${TOUR_LESSON_KEYS.join(', ')}`);
    }
    out.tourLessons = TOUR_LESSON_KEYS.filter((k) => (s.tourLessons as string[]).includes(k));
  }
  if (s.remindLateTeamTasks !== undefined) out.remindLateTeamTasks = s.remindLateTeamTasks !== false;
  if (s.assignees !== undefined) {
    const a = (s.assignees ?? {}) as Record<string, unknown>;
    out.assignees = {
      ...(str(a.hrUserId, 64) ? { hrUserId: str(a.hrUserId, 64) } : {}),
      ...(str(a.itUserId, 64) ? { itUserId: str(a.itUserId, 64) } : {}),
      ...(str(a.seniorUserId, 64) ? { seniorUserId: str(a.seniorUserId, 64) } : {}),
    };
  }
  if (s.probationShiftTemplateId !== undefined) {
    const id = str(s.probationShiftTemplateId, 64);
    if (id) out.probationShiftTemplateId = id;
  }
  return out;
}

/** The reporting time as 'HH:mm' (the Day-1 pass and its calendar file read it so): "9:30 AM", "9.30", "14:00". */
function hhmm(raw: string | undefined): string | undefined {
  const m = raw?.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return undefined;
  let h = Number(m[1]); const min = Number(m[2] ?? '0');
  if (min > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return undefined;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
