// STUB — replaced by el/be-journey's engine at merge
import { randomUUID } from 'node:crypto';
import { journeys, journeyTasks, lifecycleTemplates, users } from '../../config/db';
import type {
  CandidateDetails, DueRule, ExitType, Journey, JourneyTask, JourneyTaskStatus, LifecyclePhase, OffboardingStatus,
  OnboardingStatus, OwnerRole, SystemTaskKey, TaskKind, TaskSurface,
} from '../../models/lifecycle.model';

export interface TaskView {
  id: string; systemKey?: SystemTaskKey; phase: LifecyclePhase; title: string; helper?: string;
  ownerRole: OwnerRole; ownerName?: string; kind: TaskKind; surface: TaskSurface; mustDo: boolean;
  status: JourneyTaskStatus; opensAt?: string | null; dueAt?: string | null; dueLabel?: string;
  doneAt?: string; doneByName?: string; note?: string; late: boolean; month?: number;
}

const OPEN: JourneyTaskStatus[] = ['locked', 'todo', 'in_review', 'sent_back'];
const dayAt = (tj: string, offset: number) => new Date(Date.parse(`${tj}T00:00:00+05:30`) + offset * 86_400_000);
function resolve(rule: DueRule | null | undefined, journey: Pick<Journey, 'tj' | 'anchors'>): Date | null {
  if (!rule) return null;
  if (rule.anchor === 'tj') return journey.tj ? dayAt(journey.tj, rule.offset ?? 0) : null;
  const at = (journey.anchors as Record<string, Date | undefined>)[rule.anchor];
  return at ? new Date(at.getTime() + (rule.offset ?? 0) * 86_400_000) : null;
}

export async function createOnboardingJourney(org: string, byUserId: string, input: {
  candidate: CandidateDetails; tj: string; managerUserId?: string; designation?: string;
  department?: string; location?: string; templateId?: string; offerId?: string;
}): Promise<Journey> {
  const template = await lifecycleTemplates().findOne(input.templateId ? { org, id: input.templateId } : { org, kind: 'onboarding', isDefault: true });
  const now = new Date();
  const journey: Journey = {
    id: randomUUID(), org, kind: 'onboarding', candidate: input.candidate, managerUserId: input.managerUserId,
    templateId: template?.id ?? 'none', templateSnapshot: { name: template?.name ?? 'Standard', settings: template?.settings ?? {}, tasks: template?.tasks ?? [] },
    status: 'draft', tj: input.tj, anchors: {}, offerId: input.offerId, designation: input.designation,
    department: input.department, location: input.location, createdAt: now, createdByUserId: byUserId, updatedAt: now,
  };
  await journeys().insertOne({ ...journey });
  const tasks: JourneyTask[] = journey.templateSnapshot.tasks
    .filter((t) => t.enabled && (!t.recommended || t.recommended.added))
    .map((t) => {
      const opensAt = resolve(t.opensRule, journey);
      return {
        id: randomUUID(), org, journeyId: journey.id, templateTaskId: t.id, systemKey: t.systemKey, phase: t.phase, title: t.title,
        helper: t.helper, ownerRole: t.ownerRole, kind: t.kind, surface: t.surface, mustDo: t.mustDo, order: t.order,
        status: t.opensRule && t.opensRule.anchor !== 'tj' ? 'locked' : 'todo', opensAt, dueAt: resolve(t.dueRule, journey), dueLabel: t.dueLabel,
      };
    });
  if (tasks.length) await journeyTasks().insertMany(tasks);
  return journey;
}

export async function setJourneyStatus(journeyId: string, status: OnboardingStatus | OffboardingStatus, extra?: Partial<Journey>): Promise<Journey> {
  const anchor = ({ offer_sent: 'offer_sent', accepted: 'accepted', finalised: 'finalised' } as Record<string, 'offer_sent' | 'accepted' | 'finalised'>)[status];
  const set: Record<string, unknown> = { ...(extra ?? {}), status, updatedAt: new Date() };
  if (anchor) set[`anchors.${anchor}`] = new Date();
  const journey = await journeys().findOneAndUpdate({ id: journeyId }, { $set: set }, { returnDocument: 'after' });
  if (!journey) throw new Error('Journey not found');
  if (anchor) await openAnchored(journeyId, anchor);
  return journey;
}

async function openAnchored(journeyId: string, anchor: string) {
  const journey = await journeys().findOne({ id: journeyId });
  const tasks = await journeyTasks().find({ journeyId, status: 'locked' }).toArray();
  for (const task of tasks) {
    const rule = journey?.templateSnapshot.tasks.find((t) => t.id === task.templateTaskId)?.opensRule;
    if (rule?.anchor === anchor) await journeyTasks().updateOne({ id: task.id }, { $set: { status: 'todo', opensAt: new Date() } });
  }
}

export async function setAnchor(journeyId: string, anchor: 'offer_sent' | 'accepted' | 'finalised' | 'exit_accepted', at: Date): Promise<void> {
  await journeys().updateOne({ id: journeyId }, { $set: { [`anchors.${anchor}`]: at, updatedAt: new Date() } });
  await openAnchored(journeyId, anchor);
}

export async function moveTj(journeyId: string, tj: string): Promise<void> {
  const journey = await journeys().findOneAndUpdate({ id: journeyId }, { $set: { tj, updatedAt: new Date() } }, { returnDocument: 'after' });
  if (!journey) return;
  for (const task of await journeyTasks().find({ journeyId, status: { $in: OPEN } }).toArray()) {
    const t = journey.templateSnapshot.tasks.find((x) => x.id === task.templateTaskId);
    if (t?.dueRule?.anchor === 'tj') await journeyTasks().updateOne({ id: task.id }, { $set: { dueAt: resolve(t.dueRule, journey), dueChangedAt: new Date() } });
  }
}

export async function moveTl(journeyId: string, tl: string): Promise<void> {
  await journeys().updateOne({ id: journeyId }, { $set: { tl, updatedAt: new Date() } });
}

export async function completeTask(journeyId: string, systemKey: SystemTaskKey, by?: { userId?: string; name?: string }, note?: string): Promise<JourneyTask | null> {
  const task = await journeyTasks().findOne({ journeyId, systemKey });
  if (!task) return null;
  if (task.status === 'done') return task;
  return journeyTasks().findOneAndUpdate({ id: task.id }, { $set: { status: 'done', doneAt: new Date(), doneByUserId: by?.userId, doneByName: by?.name, ...(note ? { note } : {}) } }, { returnDocument: 'after' });
}

export async function reopenTask(journeyId: string, systemKey: SystemTaskKey, note?: string, sentBack?: boolean): Promise<JourneyTask | null> {
  return journeyTasks().findOneAndUpdate({ journeyId, systemKey }, { $set: { status: sentBack ? 'sent_back' : 'todo', ...(note ? { note } : {}) }, $unset: { doneAt: '' } }, { returnDocument: 'after' });
}

export async function setTaskInReview(journeyId: string, systemKey: SystemTaskKey): Promise<JourneyTask | null> {
  return journeyTasks().findOneAndUpdate({ journeyId, systemKey, status: { $ne: 'done' } }, { $set: { status: 'in_review' } }, { returnDocument: 'after' });
}

export async function onJoined(journeyId: string, userId: string): Promise<void> {
  await journeys().updateOne({ id: journeyId }, { $set: { userId, status: 'joined', stage: 'welcome_week1', plant: { stage: 1, water: 3, leaves: 0, droop: false }, updatedAt: new Date() } });
  await journeyTasks().updateMany({ journeyId, ownerRole: 'employee' }, { $set: { ownerUserId: userId } });
}

export async function closeJourney(journeyId: string, status: OnboardingStatus | OffboardingStatus, reason?: string): Promise<void> {
  await journeyTasks().updateMany({ journeyId, status: { $in: OPEN } }, { $set: { status: 'cancelled' } });
  await journeys().updateOne({ id: journeyId }, { $set: { status, closedAt: new Date(), closedReason: reason, updatedAt: new Date() } });
}

export async function createOffboardingJourney(org: string, userId: string, tl: string, exitType: ExitType, byUserId: string, templateId?: string): Promise<Journey> {
  void exitType;
  const now = new Date();
  const journey: Journey = {
    id: randomUUID(), org, kind: 'offboarding', userId, templateId: templateId ?? 'none', templateSnapshot: { name: 'Standard', settings: {}, tasks: [] },
    status: 'accepted', tl, anchors: { exit_accepted: now }, createdAt: now, createdByUserId: byUserId, updatedAt: now,
  };
  await journeys().insertOne({ ...journey });
  return journey;
}

export async function refreshJourney(journeyId: string): Promise<Journey> {
  const journey = await journeys().findOne({ id: journeyId });
  if (!journey) throw new Error('Journey not found');
  return journey;
}

export async function journeyTasksView(journeyId: string, viewer: 'hr' | 'manager' | 'employee' | `team:${'it' | 'admin' | 'finance'}`): Promise<TaskView[]> {
  const roles: Record<string, OwnerRole[]> = { manager: ['manager', 'manager_employee', 'employee'], employee: ['employee', 'manager_employee'] };
  const filter = viewer === 'hr' ? {} : viewer.startsWith('team:') ? { ownerRole: viewer.slice(5) as OwnerRole } : { ownerRole: { $in: roles[viewer] } };
  const tasks = await journeyTasks().find({ journeyId, ...filter }).sort({ order: 1 }).toArray();
  const owners = await users().find({ userId: { $in: tasks.map((t) => t.ownerUserId).filter((id): id is string => Boolean(id)) } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  const now = Date.now();
  return tasks.map((t) => ({
    id: t.id, systemKey: t.systemKey, phase: t.phase, title: t.title, helper: t.helper, ownerRole: t.ownerRole,
    ownerName: owners.find((o) => o.userId === t.ownerUserId)?.name, kind: t.kind, surface: t.surface, mustDo: t.mustDo, status: t.status,
    opensAt: t.opensAt ? t.opensAt.toISOString() : null, dueAt: t.dueAt ? t.dueAt.toISOString() : null, dueLabel: t.dueLabel,
    doneAt: t.doneAt?.toISOString(), doneByName: t.doneByName, note: t.note, month: t.month,
    late: Boolean(t.dueAt && t.dueAt.getTime() < now && OPEN.includes(t.status)),
  }));
}
