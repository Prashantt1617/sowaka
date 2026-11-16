/**
 * The lifecycle's timed jobs (handover §1.3 §4, onboarding and probation),
 * run from the notification scheduler's five-minute tick. Idempotent: each
 * journey job is claimed once by a fired-key on the journey, each overdue
 * reminder by the task's `remindedAt`, each meeting reminder by the
 * meeting's `remindedAt`, so repeated or overlapping runs send nothing twice.
 * Days are the company's (Asia/Kolkata); day jobs go out from 09:00 local and
 * only within two days of their date (a late-created journey is not spammed
 * with old news).
 *
 * Offboarding's Tl jobs belong to the offboarding part and BE-offer's
 * candidate emails to theirs: either can add its job to the same tick with
 * `registerLifecycleJob`.
 */
import { companies, journeys, journeyTasks, lifecycleMeetings, users } from '../../config/db';
import type { Journey, JourneyTask, SystemTaskKey } from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { addDaysKey, companyTimeZone, localHour, probationMonthEnd, probationMonthStart, todayKey, keyOfDay } from './dueRules';
import { isJoined, refreshJourney, type Destination, setJourneyStatus, taskLate, tasksOf, tell, totalProbationMonths } from './engine';

type Job = (now: Date) => Promise<unknown>;
const extraJobs = new Map<string, Job>();

/** Another part's job, run on every tick after these. */
export function registerLifecycleJob(name: string, job: Job): void {
  extraJobs.set(name, job);
}

const DAY_JOB_HOUR = 9;
const WINDOW_DAYS = 2;
const MEETING_LEAD_MS = 30 * 60_000;

let lastFullHour = '';

/** Claims a journey job; true only for the one run that gets it. */
async function claim(journeyId: string, key: string): Promise<boolean> {
  const result = await journeys().updateOne({ id: journeyId, firedJobs: { $ne: key } }, { $addToSet: { firedJobs: key } });
  return result.modifiedCount === 1;
}

function due(today: string, day: string): boolean {
  return today >= day && today <= addDaysKey(day, WINDOW_DAYS);
}

const done = (tasks: JourneyTask[], key: SystemTaskKey) => {
  const list = tasks.filter((t) => t.systemKey === key && t.status !== 'cancelled');
  return list.length > 0 && list.every((t) => t.status === 'done' || t.status === 'skipped');
};

export interface JobsResult { fired: string[]; reminded: number; meetings: number }

/**
 * `runLifecycleJobs(now)` from the contract. `full: false` runs only the
 * meeting reminders (the five-minute part); by default the rest runs once an
 * hour.
 */
export async function runLifecycleJobs(now = new Date(), opts: { full?: boolean; orgs?: string[] } = {}): Promise<JobsResult> {
  const result: JobsResult = { fired: [], reminded: 0, meetings: 0 };
  const filter: Record<string, unknown> = { 'features.lifecycle': true };
  if (opts.orgs) filter.id = { $in: opts.orgs };
  const orgs = (await companies().find(filter, { projection: { _id: 0, id: 1, name: 1 } }).toArray());
  const hourKey = now.toISOString().slice(0, 13);
  const full = opts.full ?? hourKey !== lastFullHour;
  if (full && opts.full === undefined) lastFullHour = hourKey;
  for (const company of orgs) {
    try {
      result.meetings += await meetingReminders(company.id, now);
      if (full) await orgJobs(company.id, company.name ?? 'the company', now, result);
    } catch (error) {
      logger.error('Lifecycle jobs failed for a company', { org: company.id }, error);
    }
  }
  for (const [name, job] of extraJobs) {
    try { await job(now); } catch (error) { logger.error(`Lifecycle job failed: ${name}`, {}, error); }
  }
  return result;
}

/** 30 minutes before a meeting: a push to the joiner and the others in it. */
async function meetingReminders(org: string, now: Date): Promise<number> {
  const rows = await lifecycleMeetings().find({
    org, remindedAt: { $exists: false }, met: { $ne: 'yes' },
    startsAt: { $gt: now, $lte: new Date(now.getTime() + MEETING_LEAD_MS) },
  }, { projection: { _id: 0 } }).toArray();
  let sent = 0;
  for (const m of rows) {
    const claimed = await lifecycleMeetings().updateOne({ id: m.id, remindedAt: { $exists: false } }, { $set: { remindedAt: now } });
    if (!claimed.modifiedCount) continue;
    const mins = Math.max(1, Math.round((m.startsAt.getTime() - now.getTime()) / 60_000));
    const joinerId = (await journeys().findOne({ id: m.journeyId }, { projection: { _id: 0, userId: 1 } }))?.userId;
    const push = {
      scenario: 'lifecycle_meeting_soon' as const, title: `${m.title} in ${mins} minutes`,
      body: [m.place, m.link ? 'Online' : undefined].filter(Boolean).join(' · ') || 'Tap for the details', data: { journeyId: m.journeyId, meetingId: m.id },
    };
    await tell(m.attendeeUserIds.filter((u) => u === joinerId), { ...push, destination: 'lifecycle_meeting' });
    await tell(m.attendeeUserIds.filter((u) => u !== joinerId), { ...push, destination: 'lifecycle_joiner' });
    sent += 1;
  }
  return sent;
}

async function orgJobs(org: string, companyName: string, now: Date, result: JobsResult): Promise<void> {
  const tz = companyTimeZone(org);
  const today = todayKey(now, tz);
  const dayJobsOn = localHour(now, tz) >= DAY_JOB_HOUR;
  const list = await journeys().find(
    { org, kind: 'onboarding', closedAt: { $exists: false }, status: { $nin: ['draft', 'declined', 'expired', 'not_joining'] } },
    { projection: { _id: 0, id: 1 } },
  ).toArray();
  for (const { id } of list) {
    try {
      // Opens what is due to open, dates it, runs the automatic steps (Day-1 pass at Tj − 7, Week 1 done at Tj + 7).
      const j = await refreshJourney(id, now);
      const tasks = await tasksOf(id);
      if (dayJobsOn) {
        await journeyDayJobs(j, tasks, today, companyName, now, result);
        await revealReady(j, tasks, result);
        result.reminded += await overdueReminders(j, tasks, today, now);
      }
    } catch (error) {
      logger.error('Lifecycle job failed for a journey', { journeyId: id }, error);
    }
  }
}

async function journeyDayJobs(j: Journey, tasks: JourneyTask[], today: string, companyName: string, now: Date, result: JobsResult): Promise<void> {
  if (!j.tj || !isJoined(j)) return;
  const tj = j.tj;
  const fire = async (key: string, day: string, work: () => Promise<unknown>) => {
    if (!due(today, day)) return;
    if (!(await claim(j.id, key))) return;
    result.fired.push(`${j.id}:${key}`);
    await work();
  };
  const name = (await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }))?.name ?? 'Your new joiner';
  const first = name.split(/\s+/)[0];
  const data = { journeyId: j.id };

  // Tj: the tile appears, the plant sprouts, the joiner shows on the manager's Team tab.
  await fire('tj_welcome', tj, async () => {
    await tell([j.userId], { scenario: 'lifecycle_welcome', destination: 'lifecycle_onboarding', title: `Welcome to ${companyName}, ${first}`, body: 'Your onboarding is ready', data });
    await tell([j.managerUserId], { scenario: 'lifecycle_joiner_today', destination: 'lifecycle_joiner', title: `${name} joins today`, body: 'See their first week under Team › New joiners', data });
  });
  if (!done(tasks, 'intro_post')) {
    await fire('tj3_intro_nudge', addDaysKey(tj, 3), () => tell([j.userId], { scenario: 'lifecycle_intro_nudge', destination: 'lifecycle_intro', title: 'Say hello to your team', body: 'Your intro post takes 2 minutes', data }));
  }
  if (!done(tasks, 'week1_reels')) {
    await fire('tj5_week1_due', addDaysKey(tj, 5), () => tell([j.userId], { scenario: 'lifecycle_week1_due', destination: 'lifecycle_week1', title: 'Your week-1 tasks are due today', body: 'Policies, tax regime, bank and PF, probation goals', data }));
  }
  if (!done(tasks, 'day7_survey')) {
    await fire('tj6_survey_open', addDaysKey(tj, 6), () => tell([j.userId], { scenario: 'lifecycle_survey_open', destination: 'lifecycle_survey', title: 'How was your first week?', body: '4 quick questions', data }));
  }
  // Tj + 7: goals lock, Week 1 done, stage Settling in (refreshJourney moved the stage and plant).
  await fire('tj7_week_done', addDaysKey(tj, 7), async () => {
    await journeys().updateOne({ id: j.id, 'probation.goalsLockedAt': { $exists: false } }, { $set: { 'probation.goalsLockedAt': now } });
    await tell([j.managerUserId], { scenario: 'lifecycle_week_done', destination: 'lifecycle_joiner', title: `${name} finished week 1`, body: 'Their probation goals are locked. Month 1 goals next.', data });
  });
  // The portal closes at Tj + 7 or the end of month 1 (template); open tasks carry into the app.
  const closeOn = j.templateSnapshot.settings.portalOpenUntil === 'month_1' ? addDaysKey(probationMonthEnd(tj, 1), 1) : addDaysKey(tj, 7);
  if (j.status === 'joined' && today >= closeOn && (await claim(j.id, 'portal_closed'))) {
    result.fired.push(`${j.id}:portal_closed`);
    await setJourneyStatus(j.id, 'moved_to_app');
  }
  if (j.status === 'confirmed') return;
  const total = totalProbationMonths(j);
  for (let m = 1; m <= total; m += 1) {
    const start = m === 1 ? addDaysKey(tj, 7) : probationMonthStart(tj, m);
    await fire(`m${m}_goals`, start, () => tell([j.managerUserId], { scenario: 'lifecycle_goals_reminder', destination: 'lifecycle_probation_review', title: `Set ${first}'s month-${m} goals`, body: 'They check in against them at the end of the month', data: { ...data, month: String(m) } }));
    const checkin = addDaysKey(probationMonthEnd(tj, m), -6);
    await fire(`m${m}_checkin`, checkin, async () => {
      const push = { scenario: 'lifecycle_checkin_reminder' as const, title: `Month-${m} check-in is open`, body: 'Due at the end of the month', data: { ...data, month: String(m) } };
      await tell([j.userId], { ...push, destination: 'lifecycle_checkin' });
      await tell([j.managerUserId], { ...push, destination: 'lifecycle_probation_review' });
    });
    if (m === 3 || m === 6) {
      await fire(`m${m}_pulse`, probationMonthStart(tj, m), () => tell([j.userId], { scenario: 'lifecycle_survey_open', destination: 'lifecycle_survey', title: `Month-${m} pulse survey`, body: '4 quick questions', data }));
    }
  }
  await fire(`final_${total}`, probationMonthStart(tj, total), () => tell([j.managerUserId], {
    scenario: 'lifecycle_confirmation_window', destination: 'lifecycle_joiner', title: `Final month for ${first}`, body: 'Talk to HR about confirming or extending their probation', data,
  }));
}

const JOINER_SCREENS: Partial<Record<SystemTaskKey, Destination>> = {
  week1_reels: 'lifecycle_week1', intro_post: 'lifecycle_intro', people_to_meet: 'lifecycle_people', day7_survey: 'lifecycle_survey',
  pulse_survey: 'lifecycle_survey', monthly_checkin: 'lifecycle_checkin',
};
const MANAGER_SETUP_KEYS: SystemTaskKey[] = ['manager_setup', 'probation_goals', 'assign_buddy'];

function overdueDestination(task: JourneyTask, toJoiner: boolean): Destination {
  if (toJoiner) return (task.systemKey && JOINER_SCREENS[task.systemKey]) ?? 'lifecycle_onboarding';
  if (task.systemKey && MANAGER_SETUP_KEYS.includes(task.systemKey)) return 'lifecycle_joiner_setup';
  if (task.month && task.systemKey?.startsWith('monthly_')) return 'lifecycle_probation_review';
  return 'lifecycle_joiner';
}

/** The reveal is ready (letter sent, not yet seen): the joiner is told once per decision. */
async function revealReady(j: Journey, tasks: JourneyTask[], result: JobsResult): Promise<void> {
  const decision = j.probation?.decision;
  if (!decision || decision.revealedAt || !j.userId) return;
  if (!tasks.some((t) => t.systemKey === 'confirmation_letter' && t.status === 'done')) return;
  const key = `reveal_${new Date(decision.decidedAt).getTime()}`;
  if (!(await claim(j.id, key))) return;
  result.fired.push(`${j.id}:${key}`);
  await tell([j.userId], { scenario: 'lifecycle_reveal_ready', destination: 'lifecycle_reveal', title: 'Your probation outcome is here', body: 'Tap to reveal', data: { journeyId: j.id } });
}

/** An open task past its due date: its owner is told once. */
async function overdueReminders(j: Journey, tasks: JourneyTask[], today: string, now: Date): Promise<number> {
  let sent = 0;
  for (const task of tasks) {
    if (!task.ownerUserId || task.remindedAt || !taskLate(task, today)) continue;
    const claimed = await journeyTasks().updateOne({ id: task.id, remindedAt: { $exists: false } }, { $set: { remindedAt: now } });
    if (!claimed.modifiedCount) continue;
    await tell([task.ownerUserId], {
      scenario: 'lifecycle_task_overdue', destination: overdueDestination(task, task.ownerUserId === j.userId), title: `Overdue: ${task.title}`,
      body: task.dueAt ? `It was due ${keyOfDay(task.dueAt) === addDaysKey(today, -1) ? 'yesterday' : keyOfDay(task.dueAt)}` : 'It is overdue', data: { journeyId: j.id, taskId: task.id, ...(task.month ? { month: String(task.month) } : {}) },
    });
    sent += 1;
  }
  return sent;
}
