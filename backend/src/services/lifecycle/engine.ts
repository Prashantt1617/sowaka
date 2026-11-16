// STUB — replaced by el/be-journey's engine at merge
/**
 * Only what the offboarding part and its check need, with the signatures in
 * ENGINE-API.md: an offboarding journey from the default offboarding template
 * (or a short built-in list of the T2 tasks when there is none), tasks dated
 * from Tl (working days skip Saturday and Sunday here), moving Tl, completing a
 * task by systemKey, status, closing, and the viewer's task list.
 */
import { randomUUID } from 'node:crypto';
import { journeys, journeyTasks, lifecycleTemplates, users } from '../../config/db';
import type {
  DueRule, ExitType, Journey, JourneyTask, JourneyTaskStatus, LifecyclePhase, OffboardingStatus, OnboardingStatus, OwnerRole,
  SystemTaskKey, TaskKind, TaskSurface, TemplateTask,
} from '../../models/lifecycle.model';

export interface TaskView {
  id: string; systemKey?: SystemTaskKey; phase: LifecyclePhase; title: string; helper?: string;
  ownerRole: OwnerRole; ownerName?: string; kind: TaskKind; surface: TaskSurface; mustDo: boolean;
  status: JourneyTaskStatus; opensAt?: string | null; dueAt?: string | null; dueLabel?: string;
  doneAt?: string; doneByName?: string; note?: string; late: boolean; month?: number;
}

const t = (id: string, phase: LifecyclePhase, title: string, ownerRole: OwnerRole, kind: TaskKind, surface: TaskSurface, systemKey: SystemTaskKey, mustDo: boolean, dueRule: DueRule | null, opensRule: DueRule | null = null): TemplateTask =>
  ({ id, phase, title, ownerRole, kind, surface, systemKey, mustDo, dueRule, opensRule, enabled: true, order: 0 });
const STUB_TASKS: TemplateTask[] = [
  t('hr_accept', 'resignation', 'Accept and confirm the last day', 'hr', 'review', 'dashboard', 'hr_accept_exit', true, { anchor: 'exit_accepted' }),
  t('checklist', 'when_accepted', 'Handover checklist and note', 'manager', 'assign', 'app', 'handover_checklist', true, { anchor: 'exit_accepted', offset: 3 }),
  t('tell', 'when_accepted', 'Tell IT, Admin and Finance', 'automatic', 'system', 'backend', 'tell_clearance_teams', false, { anchor: 'exit_accepted' }),
  t('page', 'when_accepted', 'Off-boarding page in the app', 'automatic', 'system', 'app', 'offboarding_page', false, { anchor: 'exit_accepted' }),
  t('upload', 'notice_period', 'Upload handover items', 'employee', 'upload', 'app', 'upload_handover', true, { anchor: 'tl', offset: -7 }),
  t('interview', 'notice_period', 'Exit interview', 'employee', 'survey', 'app', 'exit_interview', false, { anchor: 'tl' }, { anchor: 'tl', offset: -5 }),
  t('documents', 'notice_period', 'Save your documents', 'employee', 'ack', 'app', 'save_documents', false, { anchor: 'tl' }),
  t('finance', 'notice_period', 'Finance clearance', 'finance', 'review', 'dashboard', 'finance_clearance', false, { anchor: 'tl', offset: -2 }),
  t('assets', 'notice_period', 'Return laptop and ID card', 'it', 'review', 'dashboard', 'return_assets', false, { anchor: 'tl' }),
  t('handover_done', 'last_day', 'Mark handover done', 'manager', 'review', 'app', 'mark_handover_done', false, { anchor: 'tl' }, { anchor: 'tl' }),
  t('close', 'last_day', 'Close app account and access', 'automatic', 'system', 'backend', 'close_account', false, { anchor: 'tl', offset: 1 }),
  t('settlement', 'after_exit', 'Final settlement PDF', 'hr', 'letter', 'dashboard', 'final_settlement', true, { anchor: 'tl', offset: 2, unit: 'working_days' }, { anchor: 'tl' }),
  t('relieving', 'after_exit', 'Relieving and experience letter', 'hr', 'letter', 'dashboard', 'relieving_letter', false, { anchor: 'tl', offset: 2, unit: 'working_days' }, { anchor: 'tl' }),
  t('epfo', 'after_exit', 'Mark exit date on EPFO', 'hr', 'system', 'outside', 'epfo_exit', false, null, { anchor: 'tl' }),
  t('gratuity', 'after_exit', 'Gratuity, if eligible', 'finance', 'review', 'dashboard', 'gratuity', false, { anchor: 'tl', offset: 30 }, { anchor: 'tl' }),
].map((x, i) => ({ ...x, order: i }));

const DAY = 86_400_000;
const keyOf = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const atKey = (key: string) => new Date(`${key}T12:00:00+05:30`);
function resolve(rule: DueRule | null | undefined, j: Pick<Journey, 'tl' | 'anchors'>): Date | null {
  if (!rule) return null;
  const base = rule.anchor === 'tl' ? j.tl : rule.anchor === 'exit_accepted' && j.anchors.exit_accepted ? keyOf(j.anchors.exit_accepted) : undefined;
  if (!base) return null;
  const n = rule.offset ?? 0;
  if (rule.unit !== 'working_days') return atKey(new Date(Date.parse(`${base}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10));
  let d = Date.parse(`${base}T00:00:00Z`);
  for (let left = Math.abs(n); left > 0;) { d += Math.sign(n) * DAY; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return atKey(new Date(d).toISOString().slice(0, 10));
}

export async function createOffboardingJourney(org: string, userId: string, tl: string, exitType: ExitType, byUserId: string, templateId?: string): Promise<Journey> {
  void exitType;
  const now = new Date();
  const user = await users().findOne({ userId, org }, { projection: { _id: 0, managerUserId: 1, designation: 1, department: 1, location: 1 } });
  const template = await lifecycleTemplates().findOne(templateId ? { id: templateId, org } : { org, kind: 'offboarding', isDefault: true });
  const tasks = template?.tasks?.filter((x) => x.enabled) ?? STUB_TASKS;
  const journey: Journey = {
    id: randomUUID(), org, kind: 'offboarding', userId, ...(user?.managerUserId ? { managerUserId: user.managerUserId } : {}),
    templateId: template?.id ?? 'stub', templateSnapshot: { name: template?.name ?? 'Standard', settings: template?.settings ?? { noticeDays: 30, exitInterviewOpensDays: 5 }, tasks },
    status: 'accepted', tl, anchors: { exit_accepted: now },
    ...(user?.designation ? { designation: user.designation } : {}), ...(user?.department ? { department: user.department } : {}),
    createdAt: now, createdByUserId: byUserId, updatedAt: now,
  };
  await journeys().insertOne({ ...journey });
  const rows: JourneyTask[] = tasks.map((x) => {
    const opensAt = resolve(x.opensRule, journey);
    const owner = x.ownerRole === 'employee' ? userId : x.ownerRole === 'manager' ? user?.managerUserId : undefined;
    return {
      id: randomUUID(), org, journeyId: journey.id, templateTaskId: x.id, ...(x.systemKey ? { systemKey: x.systemKey } : {}), phase: x.phase, title: x.title,
      ownerRole: x.ownerRole, ...(owner ? { ownerUserId: owner } : {}), kind: x.kind, surface: x.surface, mustDo: x.mustDo, order: x.order,
      status: opensAt && opensAt > now ? 'locked' : 'todo', opensAt, dueAt: resolve(x.dueRule, journey), ...(x.dueLabel ? { dueLabel: x.dueLabel } : {}),
    };
  });
  if (rows.length) await journeyTasks().insertMany(rows.map((r) => ({ ...r })));
  return journey;
}

export async function setJourneyStatus(journeyId: string, status: OnboardingStatus | OffboardingStatus, extra: Partial<Journey> = {}): Promise<Journey> {
  await journeys().updateOne({ id: journeyId }, { $set: { ...extra, status, updatedAt: new Date() } });
  return (await journeys().findOne({ id: journeyId }, { projection: { _id: 0 } })) as Journey;
}

const OPEN: JourneyTaskStatus[] = ['locked', 'todo', 'in_review', 'sent_back'];

export async function moveTl(journeyId: string, tl: string): Promise<void> {
  const journey = await journeys().findOne({ id: journeyId });
  if (!journey) return;
  await journeys().updateOne({ id: journeyId }, { $set: { tl, updatedAt: new Date() } });
  const moved = { ...journey, tl };
  for (const task of await journeyTasks().find({ journeyId, status: { $in: OPEN } }).toArray()) {
    const rule = journey.templateSnapshot.tasks.find((x) => x.id === task.templateTaskId);
    if (!rule) continue;
    await journeyTasks().updateOne({ id: task.id }, { $set: { opensAt: resolve(rule.opensRule, moved), dueAt: resolve(rule.dueRule, moved) } });
  }
}

export async function completeTask(journeyId: string, systemKey: SystemTaskKey, by?: { userId?: string; name?: string }, note?: string): Promise<JourneyTask | null> {
  const task = await journeyTasks().findOne({ journeyId, systemKey });
  if (!task) return null;
  if (task.status === 'done') return task;
  const set = { status: 'done' as const, doneAt: new Date(), ...(by?.userId ? { doneByUserId: by.userId } : {}), ...(by?.name ? { doneByName: by.name } : {}), ...(note ? { note } : {}) };
  await journeyTasks().updateOne({ id: task.id }, { $set: set });
  return { ...task, ...set };
}

export async function closeJourney(journeyId: string, status: OnboardingStatus | OffboardingStatus, reason?: string): Promise<void> {
  const now = new Date();
  await journeys().updateOne({ id: journeyId }, { $set: { status, closedAt: now, ...(reason ? { closedReason: reason } : {}), updatedAt: now } });
  await journeyTasks().updateMany({ journeyId, status: { $in: OPEN } }, { $set: { status: 'cancelled' } });
}

export async function refreshJourney(journeyId: string): Promise<Journey> {
  return (await journeys().findOne({ id: journeyId }, { projection: { _id: 0 } })) as Journey;
}

export async function journeyTasksView(journeyId: string, viewer: 'hr' | 'manager' | 'employee' | `team:${'it' | 'admin' | 'finance'}`): Promise<TaskView[]> {
  const rows = await journeyTasks().find({ journeyId }).sort({ order: 1 }).toArray();
  const sees = (r: OwnerRole) => viewer === 'hr' || (viewer === 'manager' ? ['manager', 'manager_employee', 'employee'].includes(r)
    : viewer === 'employee' ? ['employee', 'manager_employee'].includes(r) : r === viewer.slice(5));
  const names = new Map((await users().find({ userId: { $in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((u) => [u.userId, u.name]));
  const now = Date.now();
  return rows.filter((r) => sees(r.ownerRole)).map((r) => ({
    id: r.id, ...(r.systemKey ? { systemKey: r.systemKey } : {}), phase: r.phase, title: r.title, ...(r.helper ? { helper: r.helper } : {}),
    ownerRole: r.ownerRole, ...(r.ownerUserId && names.get(r.ownerUserId) ? { ownerName: names.get(r.ownerUserId) } : {}), kind: r.kind, surface: r.surface, mustDo: r.mustDo,
    status: r.status, opensAt: r.opensAt ? r.opensAt.toISOString() : null, dueAt: r.dueAt ? r.dueAt.toISOString() : null, ...(r.dueLabel ? { dueLabel: r.dueLabel } : {}),
    ...(r.doneAt ? { doneAt: r.doneAt.toISOString() } : {}), ...(r.doneByName ? { doneByName: r.doneByName } : {}), ...(r.note ? { note: r.note } : {}),
    late: !!r.dueAt && r.dueAt.getTime() < now && OPEN.includes(r.status),
  }));
}
