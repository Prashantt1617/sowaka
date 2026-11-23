/**
 * Nudge / Remind (6Zs §7.1 H1b and the board's cards): HR reminds whoever an
 * onboarding task waits on, once per task per day (in IST, the lifecycle's
 * mail day). A candidate who has not joined gets the lifecycle email; the
 * joiner after Mark joined, and the manager, get an app push with a
 * `lifecycle_*` destination. Tasks that wait on HR itself, on IT / Admin /
 * Finance (who work from the dashboard) or on nobody cannot be nudged.
 */
import { candidateAccounts, getDb, journeyTasks } from '../../config/db';
import type { Journey, JourneyTask, SystemTaskKey } from '../../models/lifecycle.model';
import { humanDay, keyOfDay } from './dueRules';
import { companyDisplayName, companyOf, fireOnce, istDate, mails, portalLink, sendLifecycleEmail } from './emails';
import { ACTIVE_STATUSES, LifecycleError, loadJourney, namesOf, type Destination, tell } from './engine';

const JOINER_SCREENS: Partial<Record<SystemTaskKey, Destination>> = {
  week1_reels: 'lifecycle_week1', intro_post: 'lifecycle_intro', people_to_meet: 'lifecycle_people', day7_survey: 'lifecycle_survey',
  pulse_survey: 'lifecycle_survey', monthly_checkin: 'lifecycle_checkin',
};
const EMPLOYEE_ROLES = ['employee', 'manager_employee'];
const MANAGER_ROLES = ['manager', 'hr_manager'];

/** The fired-key a nudge claims: one per task per IST day. */
export const nudgeKey = (taskId: string, now = new Date()) => `nudge:${taskId}:${istDate(now)}`;

export type NudgeTarget = { channel: 'email' | 'push'; who: 'candidate' | 'joiner' | 'manager'; userId?: string; email?: string };

/** Who a nudge for this task reaches, or why it cannot be sent. */
export function nudgeTarget(j: Pick<Journey, 'userId' | 'managerUserId' | 'candidate' | 'status'>, task: Pick<JourneyTask, 'ownerRole' | 'ownerUserId' | 'status'>): NudgeTarget | { reason: string } {
  if (!ACTIVE_STATUSES.includes(task.status)) return { reason: task.status === 'locked' ? 'This task has not opened yet' : 'This task is not open' };
  // An upload in review waits on HR's review, not on the joiner.
  if (task.status === 'in_review' && EMPLOYEE_ROLES.includes(task.ownerRole)) return { reason: 'This waits on HR’s review' };
  if (EMPLOYEE_ROLES.includes(task.ownerRole)) {
    if (j.userId) return { channel: 'push', who: 'joiner', userId: j.userId };
    if (j.candidate?.personalEmail) return { channel: 'email', who: 'candidate', email: j.candidate.personalEmail };
    return { reason: 'There is no email for them yet' };
  }
  if (MANAGER_ROLES.includes(task.ownerRole)) {
    const userId = task.ownerUserId ?? j.managerUserId;
    return userId ? { channel: 'push', who: 'manager', userId } : { reason: 'Pick their manager first' };
  }
  if (task.ownerRole === 'hr') return { reason: 'This one waits on HR' };
  if (task.ownerRole === 'automatic') return { reason: 'This happens on its own' };
  return { reason: 'IT, Admin and Finance see their tasks on the dashboard' };
}

/** Which of these tasks were nudged today (for the board and the panel). */
export async function nudgedToday(taskIds: string[], now = new Date()): Promise<Set<string>> {
  if (!taskIds.length) return new Set();
  const keys = taskIds.map((id) => nudgeKey(id, now));
  const rows = await getDb().collection<{ _id: string }>('lifecycle_portal_jobs').find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray();
  const hit = new Set(rows.map((r) => r._id));
  return new Set(taskIds.filter((id) => hit.has(nudgeKey(id, now))));
}



/**
 * POST /admin/lifecycle/journeys/:id/tasks/:taskId/nudge. Refused (409) for a
 * task nobody can be reminded of, and a second time on the same day.
 */
export async function nudgeTask(org: string, journeyId: string, taskId: string, hr: { userId: string; name: string }, now = new Date()) {
  const j = await loadJourney(journeyId);
  if (j.org !== org || j.kind !== 'onboarding') throw new LifecycleError(404, 'Journey not found');
  if (j.closedAt || ['declined', 'expired', 'not_joining'].includes(String(j.status))) throw new LifecycleError(409, 'This journey is closed');
  const task = await journeyTasks().findOne({ id: taskId, journeyId }, { projection: { _id: 0 } });
  if (!task) throw new LifecycleError(404, 'Task not found');
  const target = nudgeTarget(j, task);
  if ('reason' in target) throw new LifecycleError(409, target.reason);
  if (!(await fireOnce(nudgeKey(task.id, now), org))) throw new LifecycleError(409, 'Already reminded today. You can nudge again tomorrow.');

  const names = await namesOf([j.userId, target.userId]);
  const joinerName = (j.userId && names.get(j.userId)) || j.candidate?.name || 'Your joiner';
  const due = task.dueAt ? humanDay(keyOfDay(task.dueAt)) : '';
  const data: Record<string, string> = { journeyId, taskId: task.id, ...(task.month ? { month: String(task.month) } : {}) };
  let to: string;
  if (target.who === 'candidate') {
    const company = await companyOf(org);
    const companyName = companyDisplayName(company, org);
    const first = (j.candidate?.name ?? '').trim().split(/\s+/)[0] || 'there';
    const hasPortal = !!(await candidateAccounts().findOne({ journeyId }, { projection: { _id: 1 } }));
    const body = `Hi ${first},\n\nA quick reminder from ${hr.name} at ${companyName}: “${task.title}” is still waiting on you${due ? `, due ${due}` : ''}.\n\n${hasPortal ? 'It only takes a few minutes on your joining portal.' : 'Use the link in the offer email we sent you. If you can’t find it, just reply to this email.'}`;
    await sendLifecycleEmail(org, target.email!, `Reminder: ${task.title}`, mails.letter(companyName, body, hasPortal ? portalLink('/', org) : null));
    to = j.candidate?.name ?? target.email!;
  } else if (target.who === 'joiner') {
    await tell([target.userId], {
      scenario: 'lifecycle_nudge', destination: (task.systemKey && JOINER_SCREENS[task.systemKey]) ?? 'lifecycle_onboarding',
      title: `Reminder: ${task.title}`, body: `${hr.name} from HR is waiting on this${due ? `, due ${due}` : ''}.`, data,
    });
    to = joinerName;
  } else {
    await tell([target.userId], {
      // HR's own reminder to the manager: it opens the joiner's profile (there is no team task page in the app).
      scenario: 'lifecycle_nudge', destination: 'employee_profile',
      title: `${joinerName}: ${task.title}`, body: `${hr.name} from HR asked for this${due ? `, due ${due}` : ''}.`,
      data: { ...data, ...(j.userId ? { employeeUserId: j.userId } : {}) },
    });
    to = names.get(target.userId!) ?? 'their manager';
  }
  return { nudged: { taskId: task.id, channel: target.channel, who: target.who, to, at: now.toISOString() } };
}
