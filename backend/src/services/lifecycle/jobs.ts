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
import { forgetLifecycleReads } from './readCache';
import { companies, journeys, journeyTasks, lifecycleMeetings, users } from '../../config/db';
import type { Journey, JourneyTask, SystemTaskKey } from '../../models/lifecycle.model';
import { logger } from '../../utils/logger';
import { addDaysKey, companyTimeZone, localHour, probationMonthEnd, probationMonthStart, todayKey, keyOfDay } from './dueRules';
import { scopedJourneys, scriptScope } from './scriptScope';
import { finishTaskById, isJoined, isStaffRole, refreshJourney, type Destination, setJourneyStatus, taskLate, tasksOf, tell, totalProbationMonths } from './engine';

type Job = (now: Date) => Promise<unknown>;
const extraJobs = new Map<string, Job>();

/** Another part's job, run on every tick after these. */
export function registerLifecycleJob(name: string, job: Job): void {
  extraJobs.set(name, job);
}

import { designOf } from './design';
import { place, teammatePushTarget, teamRowTitle } from './designRows';
import { rowDone } from './teamApp';

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
  const scope = scriptScope();
  const filter: Record<string, unknown> = scope ? { id: scope.org } : { 'features.lifecycle': true };
  if (opts.orgs) filter.id = { $in: scope ? opts.orgs.filter((o) => o === scope.org) : opts.orgs };
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
  // Other parts' jobs are not scoped: a script's scope runs none of them.
  for (const [name, job] of scope ? [] : extraJobs) {
    try { await job(now); } catch (error) { logger.error(`Lifecycle job failed: ${name}`, {}, error); }
  }
  // The day jobs change journeys and tasks without a request: the kept boards go too. The
  // five-minute part (meeting reminders) changes nothing a board shows, so it leaves them.
  if (full || extraJobs.size) forgetLifecycleReads(null);
  return result;
}

/** 30 minutes before a meeting: a push to the joiner and the others in it. */
async function meetingReminders(org: string, now: Date): Promise<number> {
  const rows = await lifecycleMeetings().find({
    org, remindedAt: { $exists: false }, met: { $ne: 'yes' }, ...scopedJourneys('journeyId'),
    startsAt: { $gt: now, $lte: new Date(now.getTime() + MEETING_LEAD_MS) },
  }, { projection: { _id: 0 } }).toArray();
  let sent = 0;
  for (const m of rows) {
    const claimed = await lifecycleMeetings().updateOne({ id: m.id, remindedAt: { $exists: false } }, { $set: { remindedAt: now } });
    if (!claimed.modifiedCount) continue;
    const mins = Math.max(1, Math.round((m.startsAt.getTime() - now.getTime()) / 60_000));
    const j = await journeys().findOne({ id: m.journeyId }, { projection: { _id: 0 } });
    const joinerId = j?.userId;
    const push = {
      scenario: 'lifecycle_meeting_soon' as const, title: `${m.title} in ${mins} minutes`,
      body: [m.place, m.link ? 'Online' : undefined].filter(Boolean).join(' · ') || 'Tap for the details', data: { journeyId: m.journeyId, meetingId: m.id },
    };
    // A design meeting (one with a row key) opens the joiner's home for them; the 20 Nov meeting card otherwise.
    await tell(m.attendeeUserIds.filter((u) => u === joinerId), { ...push, destination: m.rowKey ? 'lifecycle_onboarding' : 'lifecycle_meeting' });
    // Teammates in it (the manager on the Day-1 pass): the joiner's profile. HR and IT & admin work from the dashboard: no push.
    const p = j ? await place(j as Journey, now) : null;
    const role = p && m.rowKey ? [...p.meetings, ...p.team].find((r) => r.rowKey === m.rowKey)?.role : undefined;
    for (const u of m.attendeeUserIds.filter((x) => x !== joinerId)) {
      const target = p ? teammatePushTarget(p.people, u, role) : { destination: 'employee_profile' as const };
      if (target) await tell([u], { ...push, destination: target.destination, data: { ...push.data, ...(joinerId ? { employeeUserId: joinerId } : {}) } });
    }
    sent += 1;
  }
  return sent;
}

async function orgJobs(org: string, companyName: string, now: Date, result: JobsResult): Promise<void> {
  const tz = companyTimeZone(org);
  const today = todayKey(now, tz);
  const dayJobsOn = localHour(now, tz) >= DAY_JOB_HOUR;
  const list = await journeys().find(
    { org, kind: 'onboarding', closedAt: { $exists: false }, status: { $nin: ['draft', 'declined', 'expired', 'not_joining'] }, ...scopedJourneys() },
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
        result.reminded += await lateTeamRowReminders(j, tasks, today);
      }
    } catch (error) {
      logger.error('Lifecycle job failed for a journey', { journeyId: id }, error);
    }
  }
}

/**
 * Final designs, "Remind teammates when a task is late" (template `remindLateTeamTasks`, on unless
 * HR switched it off): once per row, the day after its due day passes undone. HR assigns and follows
 * every other teammate row on the dashboard (24 Nov), so only the probation decision's two rows push
 * the app: the manager's confirmation review and the head of department's approval, each opening its
 * own screen.
 */
const LATE_IN_APP: Record<string, Destination> = { mgr_confirmation_review: 'lifecycle_confirmation_review', hod_approve: 'lifecycle_confirmation_approval' };

export async function lateTeamRowReminders(j: Journey, tasks: JourneyTask[], today: string): Promise<number> {
  if (!j.tj) return 0;
  const p = await place(j, new Date(), await designOf(j));
  if (!p.design.isDesign || p.design.settings.remindLateTeamTasks === false) return 0;
  let sent = 0;
  const name = j.candidate?.name ?? 'your new joiner';
  const first = name.split(/\s+/)[0] ?? name;
  for (const r of p.team) {
    const destination = LATE_IN_APP[r.row.team?.key ?? ''];
    if (!destination || !r.dueOn || r.dueOn >= today || !r.role || rowDone(r, j, tasks, p.design)) continue;
    // The approval waits on the review: it is late only once there is a recommendation to answer.
    if (r.row.team?.key === 'hod_approve' && !j.probation?.recommendation) continue;
    const owner = p.people[r.role as keyof typeof p.people];
    if (!owner || !(await claim(j.id, `team-late:${r.rowKey}`))) continue;
    await tell([owner], {
      scenario: 'lifecycle_team_task_late', destination, title: 'A task is late', body: teamRowTitle(r, first),
      data: { journeyId: j.id, rowKey: r.rowKey, name },
    });
    sent += 1;
  }
  return sent;
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

  // Tj: the tile appears, the plant sprouts, the joiner shows under Team › New joiners. The manager's push opens their profile.
  await fire('tj_welcome', tj, async () => {
    await tell([j.userId], { scenario: 'lifecycle_welcome', destination: 'lifecycle_onboarding', title: `Welcome to ${companyName}, ${first}`, body: 'Your onboarding is ready', data });
    await tell([j.managerUserId], { scenario: 'lifecycle_joiner_today', destination: 'employee_profile', title: `${name} joins today`, body: 'Say hello: they’re under Team › New joiners', data: { ...data, ...(j.userId ? { employeeUserId: j.userId } : {}) } });
  });
  if (!done(tasks, 'intro_post')) {
    await fire('tj3_intro_nudge', addDaysKey(tj, 3), () => tell([j.userId], { scenario: 'lifecycle_intro_nudge', destination: 'lifecycle_intro', title: 'Say hello to your team', body: 'Your intro post takes 2 minutes', data }));
  }
  if (!done(tasks, 'week1_reels')) {
    // "Your week-1 tasks are due today · 2 of 4 left" (6Zs A12).
    const w = j.week1 ?? {};
    const left = 4 - [w.policies, w.taxRegime, w.bankPf, w.goalsReadAt].filter(Boolean).length;
    await fire('tj5_week1_due', addDaysKey(tj, 5), () => tell([j.userId], { scenario: 'lifecycle_week1_due', destination: 'lifecycle_week1', title: 'Your week-1 tasks are due today', body: `${left} of 4 left · policies, tax regime, bank and PF, goals`, data }));
  }
  // End of month 1: People to meet closes. Whoever was not met stays on the list as "Not met"; no leaf.
  const peopleTask = tasks.find((t) => t.systemKey === 'people_to_meet' && (t.status === 'todo' || t.status === 'sent_back'));
  if (peopleTask && today > probationMonthEnd(tj, 1) && (await claim(j.id, 'm1_people_closed'))) {
    result.fired.push(`${j.id}:m1_people_closed`);
    try {
      await finishTaskById(j.id, peopleTask.id, 'skip', { name: 'Automatic' }, 'Closed at the end of month 1');
    } catch (error) {
      // A template that made it a must-do keeps it open (it then shows late, as before).
      logger.info('People to meet left open at the end of month 1', { journeyId: j.id, reason: (error as Error).message });
    }
  }
  // A survey not answered by its due day closes (the app refuses late answers); a must-do one stays open and shows late.
  for (const t of tasks) {
    if ((t.systemKey !== 'day7_survey' && t.systemKey !== 'pulse_survey') || (t.status !== 'todo' && t.status !== 'sent_back') || !t.dueAt || keyOfDay(t.dueAt) >= today || t.mustDo) continue;
    try { await finishTaskById(j.id, t.id, 'skip', { name: 'Automatic' }, 'Not answered by its deadline'); } catch (error) { logger.info('A survey past its deadline stayed open', { journeyId: j.id, reason: (error as Error).message }); }
  }
  if (!done(tasks, 'day7_survey')) {
    await fire('tj6_survey_open', addDaysKey(tj, 6), () => tell([j.userId], { scenario: 'lifecycle_survey_open', destination: 'lifecycle_survey', title: 'How was your first week?', body: '4 quick questions', data }));
  }
  // Tj + 7: goals lock, Week 1 done, stage Settling in (refreshJourney moved the stage and plant). No push to the
  // manager: their onboarding to-dos are HR's to assign on the dashboard (24 Nov).
  await fire('tj7_week_done', addDaysKey(tj, 7), async () => {
    await journeys().updateOne({ id: j.id, 'probation.goalsLockedAt': { $exists: false } }, { $set: { 'probation.goalsLockedAt': now } });
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
    // The month's goals and the check-in: the joiner hears; the manager does not (no onboarding to-dos in their app).
    const checkin = addDaysKey(probationMonthEnd(tj, m), -6);
    await fire(`m${m}_checkin`, checkin, async () => {
      const push = { scenario: 'lifecycle_checkin_reminder' as const, title: `Month-${m} check-in is open`, body: 'Due at the end of the month', data: { ...data, month: String(m) } };
      await tell([j.userId], { ...push, destination: 'lifecycle_checkin' });
    });
    if (m === 3 || m === 6) {
      await fire(`m${m}_pulse`, probationMonthStart(tj, m), () => tell([j.userId], { scenario: 'lifecycle_survey_open', destination: 'lifecycle_survey', title: `Month-${m} pulse survey`, body: '4 quick questions', data }));
    }
  }
  await fire(`final_${total}`, probationMonthStart(tj, total), async () => {
    // The confirmation review opens in the final month (Actions › "Confirmation review for …"); a template
    // without the review row: talk to HR, and the push opens the joiner's profile.
    const review = (await place(j, now)).team.some((r) => r.row.team?.key === 'mgr_confirmation_review');
    await tell([j.managerUserId], review
      ? { scenario: 'lifecycle_confirmation_window', destination: 'lifecycle_confirmation_review', title: `Final month for ${first}`, body: 'Write their confirmation review: it is under Actions', data }
      : { scenario: 'lifecycle_confirmation_window', destination: 'employee_profile', title: `Final month for ${first}`, body: 'Talk to HR about confirming or extending their probation', data: { ...data, ...(j.userId ? { employeeUserId: j.userId } : {}) } });
    // HR records the decision on the dashboard (the board flags Decide): no app push to HR.
  });
}

const JOINER_SCREENS: Partial<Record<SystemTaskKey, Destination>> = {
  week1_reels: 'lifecycle_week1', intro_post: 'lifecycle_intro', people_to_meet: 'lifecycle_people', day7_survey: 'lifecycle_survey',
  pulse_survey: 'lifecycle_survey', monthly_checkin: 'lifecycle_checkin',
};


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

/**
 * One of the joiner's own open tasks past its due date: they are told once. Everyone else's onboarding
 * tasks are HR's to follow on the dashboard (HR and IT & admin since 23 Nov; the manager, the buddy and
 * the head of department since 24 Nov): no app push for them.
 */
async function overdueReminders(j: Journey, tasks: JourneyTask[], today: string, now: Date): Promise<number> {
  let sent = 0;
  for (const task of tasks) {
    if (!task.ownerUserId || !j.userId || task.ownerUserId !== j.userId || task.remindedAt || !taskLate(task, today) || isStaffRole(task.ownerRole)) continue;
    const claimed = await journeyTasks().updateOne({ id: task.id, remindedAt: { $exists: false } }, { $set: { remindedAt: now } });
    if (!claimed.modifiedCount) continue;
    await tell([task.ownerUserId], {
      scenario: 'lifecycle_task_overdue', destination: (task.systemKey && JOINER_SCREENS[task.systemKey]) ?? 'lifecycle_onboarding', title: `Overdue: ${task.title}`,
      body: task.dueAt ? `It was due ${keyOfDay(task.dueAt) === addDaysKey(today, -1) ? 'yesterday' : keyOfDay(task.dueAt)}` : 'It is overdue', data: { journeyId: j.id, taskId: task.id, ...(task.month ? { month: String(task.month) } : {}) },
    });
    sent += 1;
  }
  return sent;
}
