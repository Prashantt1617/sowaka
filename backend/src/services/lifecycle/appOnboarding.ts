/**
 * The app's onboarding (A1–A12) for the joiner and the manager's joiner
 * screens (M0–M3), handover §5. Every date comes from the journey; the
 * engine owns task state, this file owns the app's records (week-1 reels,
 * intro post, people to meet, starter tasks, 1:1 notes, meetings, surveys).
 */
import { offboardingMe } from './offboarding';
import { portalJourneyForAppUser } from './portalAuth';
import { randomUUID } from 'node:crypto';
import {
  attendanceRecords, connectPosts, employeePaymentDetails, journeyTasks, journeys, lifecycleMeetings, oneOnOneNotes, peopleToMeet, starterTasks, surveyResponses, users,
} from '../../config/db';
import type {
  AboutYou, IntroPost, Journey, JourneyTask, Meeting, OnboardingStage, SurveyKind, SystemTaskKey, Week1Reels,
} from '../../models/lifecycle.model';
import { createConnectPost } from '../connect.service';
import { saveMyDeclaration } from '../employeePayroll.declaration';
import { encryptField, fieldKeyConfigured, maskTail } from '../fieldCrypto';
import { allPoliciesAcknowledged, policiesFor, type PublicPolicy } from '../policy-document.service';
import { FACE_PROJECTION, faceUrlOf, faceUrlsFor, type FaceFields } from '../face-photos';
import { logger } from '../../utils/logger';
import {
  addDaysKey, companyTimeZone, dateKeyOf, dayDate, daysBetween, humanDay, isDateKey, keyOfDay, probationMonthEnd, probationMonthOn, todayKey,
} from './dueRules';
import {
  ACTIVE_STATUSES, LifecycleError, OPEN_STATUSES, completeTask, deriveJourney, finishTaskById, isJoined, isManagerMeetingRow, isWeek1Done, lifecycleEnabled,
  joinerSeesReadOnly, loadJourney, meetingWithName, namesOf, refreshJourney, setTaskDue, stageName, taskLate, taskView, tasksOf, tell, totalProbationMonths, visibleTo,
  type TaskView,
} from './engine';
import { APP_COPY } from './seed';
import { groupTasks, progressOf } from './board';
import { cleanGoals, checkinByJoiner, markRevealSeen, probationForJoiner, probationOf, revealFor, updateMonthByManager } from './probation';

type Me = { userId: string; name: string; org: string };

const strip = <T extends object>(doc: T & { _id?: unknown }): T => {
  const { _id, ...rest } = doc;
  return rest as T;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** A face read with FACE_PROJECTION (an upload, a link, or an older inline photo by its address). */
async function photoOf(user?: Partial<FaceFields> | null): Promise<string | undefined> {
  return (user?.userId ? faceUrlOf(user as FaceFields) : null) ?? undefined;
}

/** The signed-in person's own onboarding journey (joined, not closed). */
export async function joinerJourney(userId: string): Promise<Journey> {
  const doc = await journeys().find({ userId, kind: 'onboarding', closedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(1).next();
  if (!doc) throw new LifecycleError(404, 'No onboarding for you');
  return strip(doc);
}

/** A journey the signed-in manager manages (pre-boarding included). */
async function managedJourney(managerUserId: string, journeyId: string): Promise<Journey> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || j.managerUserId !== managerUserId) throw new LifecycleError(404, 'Joiner not found');
  if (j.closedAt) throw new LifecycleError(409, 'This onboarding is closed');
  return j;
}

const tileVisible = (j: Journey) =>
  !j.closedAt && isJoined(j) && (j.status !== 'confirmed' || !j.probation?.decision?.revealedAt);

// ─── GET /lifecycle/me ──────────────────────────────────────────────────────

export async function lifecycleMe(me: Me, now = new Date()) {
  if (!(await lifecycleEnabled(me.org))) return { enabled: false };
  const out: Record<string, unknown> = { enabled: true };
  const onboarding = await journeys().find({ userId: me.userId, kind: 'onboarding', closedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(1).next();
  if (onboarding) {
    const j = strip(onboarding);
    const tasks = await tasksOf(j.id);
    const derived = deriveJourney(j, tasks, now);
    const progress = ownProgress(tasks, derived.tab);
    out.onboarding = {
      journeyId: j.id, stage: derived.stage, dayLabel: derived.dayLabel, plant: derived.plant, tileVisible: tileVisible(j),
      progress, subtitle: tileSubtitle(j, tasks, derived, progress, now),
      // Before Day 1 the Action tab is their joining portal (portalJourneyForAppUser); from Tj on, never.
      portal: (await portalJourneyForAppUser(me.userId, me.org, now))?.id === j.id,
    };
  } else {
    // Signed in to the app before Mark joined binds the journey: only the portal, until Day 1.
    const pre = await portalJourneyForAppUser(me.userId, me.org, now);
    if (pre) out.onboarding = { journeyId: pre.id, stage: 'pre_boarding', ...(pre.tj ? { tj: pre.tj } : {}), tileVisible: false, portal: true };
  }
  // Resigning / on notice: the Resignation tab and the Off-boarding page (offboarding.ts).
  const leaving = await offboardingMe(me.userId);
  if (leaving) out.offboarding = leaving;
  return out;
}

// ─── The joiner's home (A2) ─────────────────────────────────────────────────

const PRODUCT_DRIVEN = new Set<SystemTaskKey>([
  'week1_reels', 'intro_post', 'day7_survey', 'pulse_survey', 'people_to_meet', 'starter_task', 'monthly_checkin', 'confirmation_reveal', 'one_on_one_notes',
]);

function stagesFor(j: Journey, current: OnboardingStage) {
  const total = totalProbationMonths(j);
  const list: Array<{ key: OnboardingStage; label: string }> = [
    { key: 'pre_boarding', label: 'Pre-boarding' },
    { key: 'welcome_week1', label: 'Week 1' },
    { key: 'settling_in', label: 'Month 1' },
    { key: 'growing_gains', label: total > 3 ? `Months 2–${total - 1}` : 'Month 2' },
    { key: 'final_month', label: 'Final month' },
    { key: 'ready_to_perform', label: 'Confirmed' },
  ];
  const at = list.findIndex((s) => s.key === current);
  return list.map((s, i) => ({ ...s, state: i < at ? 'done' as const : i === at ? 'current' as const : 'todo' as const }));
}

/** What the joiner sees on their list: their own tasks, and the Day-1 items others do (read-only). */
const onJoinerList = (t: JourneyTask) => visibleTo('employee', t) || joinerSeesReadOnly(t);

/**
 * The joiner's steps in the current phase (the tile's "2 of 9 steps done", the home's and the
 * profile card's count: one source). The Day-1 items others do count toward the day.
 */
function ownProgress(tasks: JourneyTask[], tab: 'pre_boarding' | 'first_week' | 'probation') {
  const phase = tasks.filter((t) => t.phase === tab && onJoinerList(t) && t.ownerRole !== 'automatic' && t.status !== 'cancelled' && t.systemKey !== 'new_joining_date');
  return { done: phase.filter((t) => t.status === 'done' || t.status === 'skipped').length, total: phase.length };
}

/**
 * The Action tile's subtitle follows the stage (6Zs §5.3 A1): steps in week 1, then the next
 * thing in probation ("Month 2 · check-in opens Fri 26 Dec"), then the outcome.
 */
function tileSubtitle(j: Journey, tasks: JourneyTask[], derived: ReturnType<typeof deriveJourney>, progress: { done: number; total: number }, now: Date): string {
  if (derived.stage === 'pre_boarding' || derived.stage === 'welcome_week1') return progress.total ? `${progress.done} of ${progress.total} steps done` : derived.dayLabel;
  if (derived.stage === 'ready_to_perform') return 'Confirmed · see your outcome';
  const today = todayKey(now, companyTimeZone(j.org));
  const open = tasks.filter((t) => onJoinerList(t) && ACTIVE_STATUSES.includes(t.status) && t.phase === 'probation');
  const next = tasks
    .filter((t) => onJoinerList(t) && (ACTIVE_STATUSES.includes(t.status) || t.status === 'locked') && t.phase === 'probation' && (t.opensAt || t.dueAt))
    .map((t) => ({ t, on: t.status === 'locked' && t.opensAt ? keyOfDay(t.opensAt) : t.dueAt ? keyOfDay(t.dueAt) : '' }))
    .filter((x) => x.on && x.on >= today)
    .sort((a, b) => a.on.localeCompare(b.on))[0];
  const what = (t: JourneyTask) => (t.systemKey === 'monthly_checkin' ? 'check-in' : t.systemKey === 'pulse_survey' ? 'pulse survey' : t.title.toLowerCase());
  if (open.length && !next) return `${derived.dayLabel} · ${open.length} to do`;
  if (!next) return `${derived.dayLabel} · ${stageName(derived.stage)}`;
  const verb = next.t.status === 'locked' ? 'opens' : 'due';
  return `${derived.dayLabel} · ${what(next.t)} ${verb} ${next.on === today ? 'today' : humanDay(next.on)}`;
}

const EXPECT: Partial<Record<SystemTaskKey, string[]>> = {
  meet_manager: ['How your first week will go and who to meet', 'Your probation goals, and what good looks like by month 1', 'Bring any questions, nothing to prepare'],
  meet_team: ['Who does what in the team', 'How the team works day to day', 'Nothing to prepare'],
  welcome_induction: ['Your first morning: the office, your batch and HR', 'What happens this week', 'Bring the documents on your Day-1 pass'],
  vision_culture: ['Where the company is going and why', 'How we work together', 'Questions are welcome'],
};

type Person = { name: string; designation?: string; photoUrl?: string };

async function peopleOf(ids: string[]): Promise<Map<string, Person>> {
  const rows = ids.length
    ? await users().find<FaceFields & { name: string; designation?: string }>({ userId: { $in: [...new Set(ids)] } }, { projection: { _id: 0, name: 1, designation: 1, ...FACE_PROJECTION } }).toArray()
    : [];
  return new Map(rows.map((r) => {
    const photoUrl = faceUrlOf(r);
    return [r.userId, { name: r.name, ...(r.designation ? { designation: r.designation } : {}), ...(photoUrl ? { photoUrl } : {}) }];
  }));
}

type MeetingCtx = { joinerId?: string; managerId?: string; buddyId?: string; task?: JourneyTask; managerName?: string; journey?: Pick<Journey, 'day1Pass'> };

function meetingView(m: Meeting, people: Map<string, Person>, ctx: MeetingCtx = {}) {
  const role = (id: string) => (id === ctx.joinerId ? 'joiner' : id === ctx.managerId ? 'manager' : id === ctx.buddyId ? 'buddy' : 'colleague');
  // The joiner answers "Did you meet?" only for their own meetings; HR ticks induction and the batch session.
  const canConfirm = !ctx.task || visibleTo('employee', ctx.task);
  return {
    id: m.id, title: m.title, startsAt: m.startsAt.toISOString(), ...(m.endsAt ? { endsAt: m.endsAt.toISOString() } : {}),
    ...(m.place ? { place: m.place } : {}), ...(m.link ? { link: m.link } : {}),
    // The manager meeting names the journey's manager as it is now, as the Day-1 pass does (not the name stored when it was made).
    ...((w) => (w ? { with: w } : {}))(meetingWithName(isManagerMeetingRow(m, ctx.task, ctx.journey ?? {}), m.with, ctx.managerName)),
    canConfirm,
    attendees: m.attendeeUserIds.map((id) => ({ userId: id, name: people.get(id)?.name ?? '', ...(people.get(id)?.designation ? { designation: people.get(id)!.designation } : {}), ...(people.get(id)?.photoUrl ? { photoUrl: people.get(id)!.photoUrl } : {}), role: role(id) })),
    expect: (ctx.task?.systemKey && EXPECT[ctx.task.systemKey]) ?? [],
    mustDo: ctx.task?.mustDo ?? false,
    ...(ctx.task?.systemKey ? { systemKey: ctx.task.systemKey } : {}),
    ...(m.met ? { met: m.met } : {}), ...(m.newTime ? { newTime: m.newTime.toISOString() } : {}),
    ...(m.journeyTaskId ? { taskId: m.journeyTaskId } : {}),
  };
}

const dueKey = (v: TaskView) => (v.dueAt ? v.dueAt.slice(0, 10) : '9999-12-31');

/**
 * Up next: the next timed item if it starts within 2 h (not one whose task is already done),
 * else must-do → due soonest → not started, among what the joiner can do themselves.
 */
export function pickUpNext(open: Array<TaskView & { readOnly?: boolean }>, meetings: Meeting[], now: Date): { view?: TaskView; meeting?: Meeting } {
  const soon = meetings
    .filter((m) => m.met !== 'yes' && (!m.journeyTaskId || open.some((v) => v.id === m.journeyTaskId)))
    .filter((m) => m.startsAt.getTime() >= now.getTime() - 30 * 60_000 && m.startsAt.getTime() <= now.getTime() + 2 * 3_600_000)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (soon) return { view: open.find((v) => v.id === soon.journeyTaskId), meeting: soon };
  const candidates = open.filter((v) => !v.readOnly && (v.status === 'todo' || v.status === 'sent_back'));
  candidates.sort((a, b) => Number(b.mustDo) - Number(a.mustDo) || dueKey(a).localeCompare(dueKey(b)) || Number(a.status !== 'todo') - Number(b.status !== 'todo'));
  return { view: candidates[0] };
}

/** Who does a read-only row ("HR does this"). */
const DOER: Partial<Record<JourneyTask['ownerRole'], string>> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Your manager', hr_manager: 'HR and your manager' };

/** A task as the joiner's list shows it: the app's own copy (never HR's helper on a seeded task), read-only when someone else does it. */
function joinerTaskView(t: JourneyTask, j: Journey, names: Map<string, string>, now: Date): TaskView & { readOnly?: boolean; doneBy?: string } {
  const view = taskView(t, j, names, now);
  // Letters signed on Day 1 (the template's switch): no longer on the portal.
  const copy = t.systemKey === 'sign_letters' && t.phase === 'first_week' ? 'With HR on your first day' : t.systemKey ? APP_COPY[t.systemKey]?.employee : t.helper;
  const { helper: _hrHelper, ...rest } = view;
  const readOnly = !visibleTo('employee', t);
  return { ...rest, ...(copy ? { helper: copy } : {}), ...(readOnly ? { readOnly: true, doneBy: DOER[t.ownerRole] ?? 'Someone else' } : {}) };
}

/** A task as the manager's M2 shows it: phrased for them ("Meet Kabir"), and whether they can tick it there. */
function managerTaskView(t: JourneyTask, j: Journey, names: Map<string, string>, now: Date, first: string): TaskView & { canMarkDone: boolean } {
  const view = taskView(t, j, names, now);
  const copy = t.systemKey ? APP_COPY[t.systemKey] : undefined;
  const { helper: _hrHelper, ...rest } = view;
  const helper = copy ? copy.manager : t.helper;
  return {
    ...rest,
    ...(copy?.managerTitle && (t.ownerRole !== 'employee') ? { title: `${copy.managerTitle.replaceAll('{name}', first)}${t.month ? ` · month ${t.month}` : ''}` } : {}),
    ...(helper && t.ownerRole !== 'employee' ? { helper } : {}),
    canMarkDone: managerMayTick(t),
  };
}

async function starterViews(j: Journey, names: Map<string, string>, now: Date): Promise<Array<TaskView & { assignedByName: string }>> {
  const today = todayKey(now, companyTimeZone(j.org));
  const rows = await starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray();
  return rows.map((s) => ({
    id: s.id, systemKey: 'starter_task' as const, phase: 'first_week' as const, title: s.title,
    helper: `From ${names.get(s.assignedByUserId) ?? 'your manager'}`, assignedByName: names.get(s.assignedByUserId) ?? '', ownerRole: 'employee' as const, kind: 'assign' as const, surface: 'app' as const,
    mustDo: false, status: s.doneAt ? 'done' as const : 'todo' as const, opensAt: s.assignedAt.toISOString(),
    dueAt: s.dueAt ? s.dueAt.toISOString() : null, ...(s.dueAt ? { dueLabel: humanDay(keyOfDay(s.dueAt)) } : {}),
    ...(s.doneAt ? { doneAt: s.doneAt.toISOString() } : {}), ...(s.doneNote ? { note: s.doneNote } : {}),
    late: !s.doneAt && !!s.dueAt && keyOfDay(s.dueAt) < today,
  }));
}

export async function onboardingHome(me: Me, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const tasks = await tasksOf(j.id);
  const derived = deriveJourney(j, tasks, now);
  const today = todayKey(now, companyTimeZone(j.org));
  const weekEnd = addDaysKey(today, 6);
  const names = await namesOf([j.managerUserId, ...tasks.map((t) => t.ownerUserId)]);
  // Their own tasks and the Day-1 items others do (read-only); finished pre-boarding steps stay behind on the portal.
  const mine = tasks.filter((t) => onJoinerList(t) && (t.phase !== 'pre_boarding' || ACTIVE_STATUSES.includes(t.status)));
  const meetings = (await lifecycleMeetings().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ startsAt: 1 }).toArray()).map(strip);
  const meetingOf = new Map(meetings.filter((m) => m.journeyTaskId).map((m) => [m.journeyTaskId!, m]));
  const meetingPeople = await peopleOf(meetings.flatMap((m) => m.attendeeUserIds));
  const ctxOf = (m: Meeting) => ({ joinerId: j.userId, managerId: j.managerUserId, buddyId: j.buddyUserId, task: tasks.find((t) => t.id === m.journeyTaskId), managerName: j.managerUserId ? names.get(j.managerUserId) : undefined, journey: j });
  const badges = await countBadges(j);
  // Every meeting row carries its meeting (time, place, who, link), not only Up next.
  const views: Array<TaskView & { meetingId?: string; meeting?: ReturnType<typeof meetingView>; readOnly?: boolean; progress?: { done: number; total: number } }> = mine.map((t) => {
    const m = meetingOf.get(t.id);
    return {
      ...joinerTaskView(t, j, names, now),
      ...(m ? { meetingId: m.id, meeting: meetingView(m, meetingPeople, ctxOf(m)) } : {}),
      ...(t.systemKey && badges[t.systemKey] ? { progress: badges[t.systemKey] } : {}),
    };
  });
  views.push(...(await starterViews(j, names, now)));
  const shared = await oneOnOneNotes().find({ journeyId: j.id, shared: true }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  if (shared.length) {
    const unseen = shared.filter((n) => !n.seenAt).length;
    views.push({
      id: 'notes', systemKey: 'one_on_one_notes', phase: 'first_week', title: 'Notes from your 1:1',
      helper: `Shared by ${names.get(shared[0].authorUserId) ?? 'your manager'}`, ownerRole: 'employee', kind: 'form', surface: 'app',
      mustDo: false, status: unseen ? 'todo' : 'done', opensAt: shared[0].createdAt.toISOString(), dueAt: null,
      ...(unseen ? { dueLabel: `${unseen} new` } : {}), late: false,
    });
  }
  const open = views.filter((v) => ACTIVE_STATUSES.includes(v.status));
  const isDone = (v: TaskView) => v.status === 'done' || v.status === 'skipped';
  const locked = views.filter((v) => v.status === 'locked');
  const soonLocked = locked.filter((v) => v.opensAt && v.opensAt.slice(0, 10) <= weekEnd);
  const { view, meeting } = pickUpNext(open, meetings, now);
  const upNext = view || meeting
    ? { ...(view ?? {
      id: meeting!.id, phase: 'first_week' as const, title: meeting!.title, ownerRole: 'employee' as const, kind: 'meeting' as const,
      surface: 'app' as const, mustDo: false, status: 'todo' as const, dueAt: meeting!.startsAt.toISOString(), late: false,
    }), ...(meeting ? { meetingId: meeting.id, meeting: meetingView(meeting, meetingPeople, ctxOf(meeting)) } : {}) }
    : undefined;
  const byDue = (a: TaskView, b: TaskView) => dueKey(a).localeCompare(dueKey(b));
  return {
    journeyId: j.id, stage: derived.stage, stageName: stageName(derived.stage), dayLabel: derived.dayLabel, tj: j.tj, plant: derived.plant,
    ...(j.managerUserId && names.get(j.managerUserId) ? { managerName: names.get(j.managerUserId) } : {}),
    progress: ownProgress(tasks, derived.tab),
    ...(upNext ? { upNext } : {}),
    today: [...open.sort(byDue), ...soonLocked.sort(byDue)],
    later: locked.filter((v) => !soonLocked.includes(v)).sort(byDue),
    done: views.filter(isDone).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    journey: stagesFor(j, derived.stage),
    meetings: meetings.map((m) => meetingView(m, meetingPeople, ctxOf(m))),
    showWeekDone: isWeek1Done(j.tj, today) && !j.week1DoneSeenAt,
    ...(j.week1DoneSeenAt ? { weekDoneSeenAt: j.week1DoneSeenAt } : {}),
    weekDoneStats: weekDoneStats(tasks, await countBadges(j), derived.plant.leaves),
    firstPunch: await firstPunchOf(me.userId, j.tj),
    tour: { lessons: [...TOUR_LESSONS], done: (j.tour?.done ?? []).filter((k) => (TOUR_ALL_LESSONS as readonly string[]).includes(k)) },
    devices: devicesFor(tasks),
  };
}

/**
 * Day 1's "Your first punch-in" (app-lifecycle-1120, J1): when the joiner
 * first punched in on or after joining (absent until they have), and whether
 * a face is on their record, so the app can say "Face registered" after it.
 */
async function firstPunchOf(userId: string, tj: string | undefined): Promise<{ at?: string; faceEnrolled: boolean }> {
  const [punch, user] = await Promise.all([
    attendanceRecords().findOne(
      { userId, ...(tj ? { workDate: { $gte: tj } } : {}), punchIn: { $exists: true } },
      { projection: { _id: 0, punchIn: 1 }, sort: { workDate: 1 } },
    ),
    users().findOne({ userId }, { projection: { _id: 0, 'faceId.faceId': 1 } }),
  ]);
  const faceEnrolled = Boolean((user as { faceId?: { faceId?: string } } | null)?.faceId?.faceId);
  return { ...(punch?.punchIn ? { at: new Date(punch.punchIn).toISOString() } : {}), faceEnrolled };
}

/**
 * The Sowaka tour (new-joiner artifact, "Sowaka tour"): one lesson a day in
 * this order; the app holds each lesson's steps. Managers also get
 * [TOUR_MANAGER_LESSONS]. All of [TOUR_LESSONS] done completes `app_tour`.
 */
export const TOUR_LESSONS = ['punch', 'missed', 'leave', 'overtime'] as const;
export const TOUR_MANAGER_LESSONS = ['approveLeave', 'approveOvertime'] as const;
const TOUR_ALL_LESSONS = [...TOUR_LESSONS, ...TOUR_MANAGER_LESSONS] as const;

/**
 * "Devices and accesses": what IT and HR set up, from the tasks that do it —
 * the laptop (`laptop_setup`), the work email (`mark_joined` creates it) and
 * this app (ready: they are in it). Ready once its task is done.
 */
function devicesFor(tasks: JourneyTask[]) {
  const done = (key: SystemTaskKey) => tasks.some((t) => t.systemKey === key && (t.status === 'done' || t.status === 'skipped'));
  const has = (key: SystemTaskKey) => tasks.some((t) => t.systemKey === key);
  return [
    ...(has('laptop_setup') ? [{ key: 'laptop', title: 'Laptop', ready: done('laptop_setup') }] : []),
    ...(has('mark_joined') ? [{ key: 'email', title: 'Email', ready: done('mark_joined') }] : []),
    { key: 'app', title: 'Sowaka Connect', ready: true },
  ];
}

/** A tour lesson finished (`{ done: true }`) or replayed from the start (`{ done: false }` is ignored: done stays done). */
export async function tourLessonDone(me: Me, lesson: string) {
  if (!(TOUR_ALL_LESSONS as readonly string[]).includes(lesson)) throw new LifecycleError(400, `lesson is one of ${TOUR_ALL_LESSONS.join(', ')}`);
  const j = await joinerJourney(me.userId);
  const done = [...(j.tour?.done ?? [])];
  if (!done.includes(lesson)) {
    done.push(lesson);
    const now = new Date();
    await journeys().updateOne({ id: j.id }, { $set: { tour: { done, updatedAt: now }, updatedAt: now } });
    if (TOUR_LESSONS.every((k) => done.includes(k))) await completeTask(j.id, 'app_tour', { userId: me.userId, name: me.name }).catch(() => undefined);
  }
  return { lessons: [...TOUR_LESSONS], done };
}

/** "Week 1, done!" (A8): tasks done in week 1, people met, leaves grown. */
function weekDoneStats(tasks: JourneyTask[], badges: Awaited<ReturnType<typeof countBadges>>, leaves: number) {
  const week = tasks.filter((t) => t.phase === 'first_week' && onJoinerList(t));
  return { tasksDone: week.filter((t) => t.status === 'done').length, peopleMet: badges.people_to_meet?.done ?? 0, leaves };
}

/** The joiner marks one of their own tasks done or skips it (tour, face, logins, "Did you meet?"). */
export async function actOnOwnTask(me: Me, taskId: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const task = (await tasksOf(j.id)).find((t) => t.id === taskId);
  if (!task || !visibleTo('employee', task)) throw new LifecycleError(404, 'Task not found');
  if (task.systemKey && PRODUCT_DRIVEN.has(task.systemKey)) throw new LifecycleError(409, 'This one is done from its own screen');
  if (body.action !== 'done' && body.action !== 'skip') throw new LifecycleError(400, 'action is done or skip');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : undefined;
  const done = await finishTaskById(j.id, taskId, body.action, { userId: me.userId, name: me.name }, note);
  return { task: taskView(done, j, await namesOf([done.ownerUserId])) };
}

/** "Week 1, done!" (A8) shows once. */
export async function markWeekDoneSeen(me: Me) {
  const j = await joinerJourney(me.userId);
  if (!j.week1DoneSeenAt) await journeys().updateOne({ id: j.id }, { $set: { week1DoneSeenAt: new Date() } });
  return { ok: true };
}

// ─── Week-1 reels (A4) ──────────────────────────────────────────────────────

function fyOf(at: Date, tz: string): string {
  const [y, m] = dateKeyOf(at, tz).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export async function week1View(me: Me) {
  const j = await joinerJourney(me.userId);
  const [policies, payment] = await Promise.all([
    policiesFor({ userId: me.userId, org: me.org }),
    employeePaymentDetails().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, bankName: 1, ifsc: 1, accountLast4: 1, uanLast4: 1 } }),
  ]);
  const about = (j as Journey & { about?: AboutYou }).about;
  const managerName = j.managerUserId ? (await namesOf([j.managerUserId])).get(j.managerUserId) : undefined;
  const uan = payment?.uanLast4 ? maskTail(payment.uanLast4) : about?.pf?.uan ? maskTail(about.pf.uan.slice(-4)) : undefined;
  return {
    ...(j.week1 ?? {}),
    // `version` is what the acknowledgement stores; the rest is for reading: when it changed, how long, the text.
    policies: policies.map((p) => ({
      id: p.key, title: p.title, version: p.updatedAt, ...(isDateKey(String(p.updatedAt).slice(0, 10)) ? { updatedOn: String(p.updatedAt).slice(0, 10) } : {}),
      readMinutes: Math.max(1, Math.ceil(p.body.split(/\s+/).filter(Boolean).length / 200)), ...(p.summary ? { summary: p.summary } : {}), body: p.body,
    })),
    policiesAck: j.week1?.policies,
    ...(j.week1?.policies?.at ? { policiesAckAt: j.week1.policies.at } : {}),
    steps: { policies: !!j.week1?.policies, tax: !!j.week1?.taxRegime, bank_pf: !!j.week1?.bankPf, goals: !!j.week1?.goalsReadAt },
    ...(managerName ? { managerName } : {}), ...(j.managerUserId ? { managerUserId: j.managerUserId } : {}),
    bank: { masked: payment?.accountLast4 ? maskTail(payment.accountLast4) ?? '' : '', ...(payment?.bankName ? { name: payment.bankName, bankName: payment.bankName } : {}), ...(payment?.ifsc ? { ifsc: payment.ifsc } : {}) },
    pf: { ...(uan ? { uan } : {}), ...(about?.pf?.firstJob ? { firstJob: true } : {}) },
    goals: j.probation?.goals ?? [],
    probationMonths: totalProbationMonths(j),
    ...(j.tj ? { goalsLockOn: addDaysKey(j.tj, 7) } : {}),
    ...(j.bankPfRequest ? { bankPfRequest: { status: j.bankPfRequest.status, requestedAt: j.bankPfRequest.requestedAt } } : {}),
  };
}

/**
 * Policies › Acknowledge, for a joiner: once every policy that needs it is
 * acknowledged at its current version, the Week-1 policies step is done too
 * (the same record the Week-1 reel writes), so the "Acknowledge policies" task
 * ticks itself. No onboarding, or the step already done: nothing to do.
 */
export async function policiesAcknowledgedByJoiner(me: Me, policies: PublicPolicy[], device?: string): Promise<boolean> {
  if (!allPoliciesAcknowledged(policies)) return false;
  let j: Journey;
  try {
    j = await joinerJourney(me.userId);
  } catch {
    return false;
  }
  if (j.org !== me.org || j.week1?.policies) return false;
  const now = new Date();
  const week1: Week1Reels = {
    ...(j.week1 ?? {}),
    policies: { versions: policies.map((p) => ({ id: p.key, version: p.updatedAt })), at: now, ...(device ? { device: device.slice(0, 200) } : {}) },
  };
  await journeys().updateOne({ id: j.id }, { $set: { week1, updatedAt: now } });
  if (week1.policies && week1.taxRegime && week1.bankPf && week1.goalsReadAt) await completeTask(j.id, 'week1_reels', { userId: me.userId, name: me.name });
  else await refreshJourney(j.id);
  return true;
}

export async function saveWeek1Step(me: Me, body: Record<string, unknown>, device?: string) {
  const j = await joinerJourney(me.userId);
  // The app sends the tax regime as a bare 'new' | 'old'; every other step as an object.
  const raw = body.value;
  const value = (typeof raw === 'string' ? { regime: raw } : raw ?? {}) as Record<string, unknown>;
  const now = new Date();
  const tz = companyTimeZone(j.org);
  const week1: Week1Reels = { ...(j.week1 ?? {}) };
  const set: Partial<Journey> = {};
  let taxSavedToPayroll: boolean | undefined;
  switch (body.step) {
    case 'policies': {
      // Agreeing: `{ agreed: true }` or the versions read (`{ versions, device }`). The versions stored are the
      // company's current ones, so an old app cannot acknowledge a policy text that is no longer in force.
      if (value.agreed !== true && !Array.isArray(value.versions)) throw new LifecycleError(400, 'Tick “I have read and agree” first');
      const policies = await policiesFor({ userId: me.userId, org: me.org });
      const where = typeof value.device === 'string' && value.device.trim() ? value.device.trim() : device;
      week1.policies = { versions: policies.map((p) => ({ id: p.key, version: p.updatedAt })), at: now, ...(where ? { device: where.slice(0, 200) } : {}) };
      break;
    }
    case 'tax': {
      const regime = value.regime ?? 'new';
      if (regime !== 'new' && regime !== 'old') throw new LifecycleError(400, 'regime is new or old');
      const before = week1.taxRegime;
      if (before && before.regime !== regime && fyOf(before.at, tz) === fyOf(now, tz)) {
        throw new LifecycleError(409, `You chose the ${before.regime} regime for FY ${fyOf(now, tz)}. It can change once a year, from Payroll.`);
      }
      try {
        await saveMyDeclaration(me.userId, undefined, { regime }, now);
        taxSavedToPayroll = true;
      } catch (error) {
        // Payroll not set up (or the declaration window closed): the choice is kept here and HR sees it.
        taxSavedToPayroll = false;
        logger.info('Week-1 tax regime not saved to payroll', { journeyId: j.id, reason: (error as Error).message });
      }
      week1.taxRegime = { regime, at: before?.regime === regime ? before.at : now };
      break;
    }
    case 'bank_pf': {
      if (value.change && typeof value.change === 'object') {
        const c = value.change as Record<string, unknown>;
        const changes: NonNullable<Journey['bankPfRequest']>['changes'] = {};
        const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
        if (text(c.bankName)) changes.bankName = text(c.bankName).slice(0, 120);
        if (text(c.ifsc)) {
          const ifsc = text(c.ifsc).toUpperCase();
          if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new LifecycleError(400, 'That IFSC is not valid');
          changes.ifsc = ifsc;
        }
        if (text(c.accountNumber)) {
          const acc = text(c.accountNumber).replace(/\s+/g, '');
          if (!/^\d{6,20}$/.test(acc)) throw new LifecycleError(400, 'An account number is 6 to 20 digits');
          changes.accountLast4 = acc.slice(-4);
          if (fieldKeyConfigured()) changes.accountNumberEnc = encryptField(acc);
        }
        if (text(c.uan)) {
          const uan = text(c.uan).replace(/\s+/g, '');
          if (!/^\d{12}$/.test(uan)) throw new LifecycleError(400, 'A UAN is 12 digits');
          changes.uanLast4 = uan.slice(-4);
          if (fieldKeyConfigured()) changes.uanEnc = encryptField(uan);
        }
        if (!Object.keys(changes).length && !text(value.note)) throw new LifecycleError(400, 'Say what should change');
        set.bankPfRequest = { status: 'pending', changes, ...(text(value.note) ? { note: text(value.note).slice(0, 500) } : {}), requestedAt: now };
        week1.bankPf = { confirmedAt: now, changeRequested: true };
        const hr = (await users().findOne({ userId: me.userId }, { projection: { _id: 0, hrPrimaryUserId: 1 } }))?.hrPrimaryUserId;
        await tell([hr], { scenario: 'lifecycle_bank_pf_request', title: 'Bank or PF change to approve', body: `${me.name} asked to change their bank or PF details.`, data: { journeyId: j.id } });
      } else if (value.confirm === true || value.confirmed === true) {
        week1.bankPf = { confirmedAt: now, ...(week1.bankPf?.changeRequested ? { changeRequested: true } : {}) };
      } else {
        throw new LifecycleError(400, 'Confirm the details or send a change');
      }
      break;
    }
    case 'goals':
      if (value.read !== true) throw new LifecycleError(400, 'value.read must be true');
      week1.goalsReadAt = now;
      break;
    default:
      throw new LifecycleError(400, 'step is policies, tax, bank_pf or goals');
  }
  set.week1 = week1;
  await journeys().updateOne({ id: j.id }, { $set: { ...set, updatedAt: now } });
  if (week1.policies && week1.taxRegime && week1.bankPf && week1.goalsReadAt) await completeTask(j.id, 'week1_reels', { userId: me.userId, name: me.name });
  else await refreshJourney(j.id);
  return { ...(await week1View(me)), ...(taxSavedToPayroll !== undefined ? { taxSavedToPayroll } : {}) };
}

// ─── Intro post (A5) ────────────────────────────────────────────────────────

function cleanIntro(body: Record<string, unknown>, current?: IntroPost): IntroPost {
  const line = typeof body.line === 'string' ? body.line.trim() : current?.line ?? '';
  if (line.length > 80) throw new LifecycleError(400, 'One line is at most 80 characters');
  const facts = body.funFacts === undefined ? current?.funFacts ?? [] : body.funFacts;
  if (!Array.isArray(facts) || facts.length > 3) throw new LifecycleError(400, 'Pick up to 3 fun facts');
  const funFacts = facts.map((f) => String(f).trim().slice(0, 40)).filter(Boolean);
  // The app sends the profile photo it has, which may be a URL: only a storage key is kept (a URL falls back to the profile photo).
  const sent = typeof body.photoKey === 'string' ? body.photoKey.trim() : '';
  const photoKey = sent && !/^(https?:|data:|\/)/i.test(sent) ? sent : current?.photoKey;
  return { line, funFacts, ...(photoKey ? { photoKey } : {}) };
}

/** The post's bubble, as the preview shows it: the line gets a full stop unless it already ends a sentence. */
export function introMessage(line: string): string {
  const said = line.trim();
  // Ends a sentence: punctuation, or an emoji / symbol (the app's preview uses the same rule).
  const last = [...said].at(-1)?.codePointAt(0) ?? 0;
  const ends = /[.!?…)]$/.test(said) || last >= 0x2190;
  return `Hey everyone! ${said}${ends ? '' : '.'} Excited to meet you all 🙌`;
}

export async function introView(me: Me) {
  const j = await joinerJourney(me.userId);
  const user = await users().findOne({ userId: me.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1 } });
  // Once posted: how it is doing on Connect (likes, comments, the latest two).
  const post = j.intro?.connectPostId ? await connectPosts().findOne({ id: j.intro.connectPostId }, { projection: { _id: 0, likedBy: 1, comments: 1 } }) : null;
  const comments = (post?.comments ?? []).filter((c) => !c.parentId);
  const commentFaces = await faceUrlsFor(comments.slice(-2).map((c) => c.userId));
  return {
    ...(j.intro ?? { line: '', funFacts: [] }), name: user?.name ?? me.name, designation: j.designation ?? user?.designation, department: j.department ?? user?.department,
    ...(j.intro?.line ? { message: introMessage(j.intro.line) } : {}),
    ...(post ? {
      likes: post.likedBy?.length ?? 0, commentCount: comments.length,
      comments: comments.slice(-2).map((c) => ({ name: c.name, text: c.text, at: c.createdAt, ...(commentFaces.get(c.userId) ? { photoUrl: commentFaces.get(c.userId)! } : {}) })),
    } : {}),
  };
}

export async function saveIntro(me: Me, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  if (j.intro?.postedAt) throw new LifecycleError(409, 'Your intro is already posted');
  await journeys().updateOne({ id: j.id }, { $set: { intro: cleanIntro(body, j.intro), updatedAt: new Date() } });
  return introView(me);
}

/** Posts to Connect in the new-joiner style and asks the manager to say hi. */
export async function postIntro(me: Me, body: Record<string, unknown> = {}) {
  const j = await joinerJourney(me.userId);
  if (j.intro?.postedAt) throw new LifecycleError(409, 'Your intro is already posted');
  const intro = cleanIntro(body, j.intro);
  if (!intro.line) throw new LifecycleError(400, 'Write one line about you first');
  const user = await users().findOne({ userId: me.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, profilePhotoKey: 1, managerUserId: 1 } });
  const name = user?.name ?? me.name;
  const designation = j.designation ?? user?.designation;
  const department = j.department ?? user?.department;
  const managerId = j.managerUserId ?? user?.managerUserId;
  const manager = managerId ? await users().findOne({ userId: managerId }, { projection: { _id: 0, name: 1, designation: 1 } }) : null;
  const joinedOn = j.tj ? dayDate(j.tj).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : undefined;
  const post = await createConnectPost(me.userId, {
    type: 'new_joinee',
    body: {
      personUserId: me.userId, personName: name, personInitials: initials(name),
      photoKey: intro.photoKey ?? user?.profilePhotoKey,
      subtitle: [designation, department ? `${department}${joinedOn ? ` · Joined ${joinedOn}` : ''}` : joinedOn ? `Joined ${joinedOn}` : undefined].filter(Boolean).join(' · ') || 'Teammate',
      message: introMessage(intro.line),
      line: intro.line, funFacts: intro.funFacts, facts: intro.funFacts.join(' · '),
      introPost: true,
      ...(manager ? { managerName: manager.name, managerInitials: initials(manager.name), managerDesignation: manager.designation ?? 'Manager' } : {}),
      actionLabel: 'Say hi', actionDoneLabel: 'Said hi!',
    },
  });
  const postId = (post as { id?: string }).id;
  const posted: IntroPost = { ...intro, postedAt: new Date(), ...(postId ? { connectPostId: postId } : {}) };
  await journeys().updateOne({ id: j.id }, { $set: { intro: posted, updatedAt: new Date() } });
  await completeTask(j.id, 'intro_post', { userId: me.userId, name: me.name });
  await tell([managerId], { scenario: 'lifecycle_intro_post', destination: 'lifecycle_joiner', title: `${name} said hello`, body: `${name} posted their intro on Connect. Say hi 👋`, data: { journeyId: j.id, ...(postId ? { postId } : {}) } });
  return { ...(await introView(me)), ...(postId ? { connectPostId: postId } : {}) };
}

// ─── People to meet (A6) ────────────────────────────────────────────────────

/** People to meet closes at the end of month 1 (a job skips the task); the ones not met stay listed as "Not met". */
async function peopleClosed(journeyId: string): Promise<boolean> {
  const task = (await tasksOf(journeyId)).find((t) => t.systemKey === 'people_to_meet' && t.status !== 'cancelled');
  return task?.status === 'skipped';
}

async function peopleViews(j: Pick<Journey, 'id' | 'managerUserId' | 'buddyUserId'>) {
  const rows = (await peopleToMeet().find({ journeyId: j.id }, { projection: { _id: 0 } }).toArray()).map(strip);
  const folks = await users().find({ userId: { $in: rows.map((r) => r.personUserId) } }, { projection: { _id: 0, name: 1, designation: 1, ...FACE_PROJECTION } }).toArray();
  const by = new Map(folks.map((f) => [f.userId, f]));
  return Promise.all(rows.map(async (r) => {
    const person = by.get(r.personUserId);
    const photoUrl = await photoOf(person);
    const role = r.personUserId === j.managerUserId ? 'your manager' : r.personUserId === j.buddyUserId ? 'your buddy' : undefined;
    return {
      id: r.id, userId: r.personUserId, name: person?.name ?? '—', ...(person?.designation ? { designation: person.designation } : {}), ...(role ? { role } : {}),
      ...(photoUrl ? { photoUrl } : {}), ...(r.why ? { why: r.why } : {}), ...(r.metAt ? { metAt: r.metAt } : {}), ...(r.skippedAt ? { skippedAt: r.skippedAt } : {}),
    };
  }));
}

export async function peopleView(me: Me) {
  const j = await joinerJourney(me.userId);
  const managerName = j.managerUserId ? (await namesOf([j.managerUserId])).get(j.managerUserId) : undefined;
  return {
    people: await peopleViews(j), ...(j.tj ? { meetBy: probationMonthEnd(j.tj, 1) } : {}), closed: await peopleClosed(j.id),
    ...(managerName ? { managerName } : {}),
  };
}

export async function actOnPerson(me: Me, id: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const row = await peopleToMeet().findOne({ id, journeyId: j.id });
  if (!row) throw new LifecycleError(404, 'Not on your list');
  if (await peopleClosed(j.id)) throw new LifecycleError(409, 'People to meet closed at the end of month 1');
  if (body.action === 'met') await peopleToMeet().updateOne({ id }, { $set: { metAt: new Date() }, $unset: { skippedAt: '' } });
  else if (body.action === 'not_yet') await peopleToMeet().updateOne({ id }, { $set: { skippedAt: new Date() } });
  else throw new LifecycleError(400, 'action is met or not_yet');
  const all = await peopleToMeet().find({ journeyId: j.id }).toArray();
  if (all.length && all.every((p) => p.metAt)) await completeTask(j.id, 'people_to_meet', { userId: me.userId, name: me.name });
  return { people: await peopleViews(j), closed: false };
}

// ─── Starter tasks (A9, M2a, M3) ────────────────────────────────────────────

export async function starterTasksForJoiner(me: Me) {
  const j = await joinerJourney(me.userId);
  const rows = await starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray();
  const people = await peopleOf(rows.map((r) => r.assignedByUserId));
  return { tasks: rows.map((r) => ({
    ...r, assignedByName: people.get(r.assignedByUserId)?.name ?? '',
    ...(people.get(r.assignedByUserId)?.designation ? { assignedByDesignation: people.get(r.assignedByUserId)!.designation } : {}),
    ...(people.get(r.assignedByUserId)?.photoUrl ? { assignedByPhotoUrl: people.get(r.assignedByUserId)!.photoUrl } : {}),
  })) };
}

export async function starterDone(me: Me, id: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const row = await starterTasks().findOne({ id, journeyId: j.id });
  if (!row) throw new LifecycleError(404, 'Starter task not found');
  if (!row.doneAt) {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    await starterTasks().updateOne({ id }, { $set: { doneAt: new Date(), ...(note ? { doneNote: note } : {}) } });
    await tell([row.assignedByUserId], { scenario: 'lifecycle_starter_task_done', destination: 'lifecycle_starter_task_done', title: `${me.name} finished a task`, body: row.title, data: { journeyId: j.id, starterTaskId: id } });
    const open = await starterTasks().countDocuments({ journeyId: j.id, doneAt: { $exists: false } });
    if (!open) await completeTask(j.id, 'starter_task', { userId: me.userId, name: me.name });
    else await refreshJourney(j.id);
  }
  // The list, and the one just done (the app's screen shows it as it now stands).
  const list = await starterTasksForJoiner(me);
  const task = list.tasks.find((t) => t.id === id);
  return { ...list, ...(task ? { task } : {}) };
}

// ─── 1:1 notes (A10, M2b) ───────────────────────────────────────────────────

async function notesFor(journeyId: string, sharedOnly: boolean) {
  const rows = await oneOnOneNotes().find({ journeyId, ...(sharedOnly ? { shared: true } : {}) }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  const [names, faces] = await Promise.all([
    namesOf(rows.flatMap((r) => [r.authorUserId, ...(r.replies ?? []).map((x) => x.byUserId)])),
    faceUrlsFor(rows.map((r) => r.authorUserId)),
  ]);
  return rows.map((r) => ({
    id: r.id, authorUserId: r.authorUserId, authorName: names.get(r.authorUserId) ?? '',
    ...(faces.get(r.authorUserId) ? { authorPhotoUrl: faces.get(r.authorUserId)! } : {}), text: r.text, shared: r.shared,
    ...(r.sharedAt ? { sharedAt: r.sharedAt } : {}), ...(r.seenAt ? { seenAt: r.seenAt } : {}), createdAt: r.createdAt,
    replies: (r.replies ?? []).map((x) => ({ ...x, byName: names.get(x.byUserId) ?? '' })),
  }));
}

export async function notesForJoiner(me: Me) {
  const j = await joinerJourney(me.userId);
  return { notes: await notesFor(j.id, true) };
}

export async function actOnNote(me: Me, id: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const note = await oneOnOneNotes().findOne({ id, journeyId: j.id, shared: true });
  if (!note) throw new LifecycleError(404, 'Note not found');
  if (body.action === 'seen') {
    if (!note.seenAt) await oneOnOneNotes().updateOne({ id }, { $set: { seenAt: new Date() } });
  } else if (body.action === 'reply') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 1000) throw new LifecycleError(400, 'A reply of up to 1000 characters');
    await oneOnOneNotes().updateOne({ id }, { $push: { replies: { byUserId: me.userId, text, at: new Date() } }, $set: { seenAt: note.seenAt ?? new Date() } });
    await tell([note.authorUserId], { scenario: 'lifecycle_note_reply', destination: 'lifecycle_joiner', title: `${me.name} replied`, body: text.slice(0, 120), data: { journeyId: j.id, noteId: id } });
  } else throw new LifecycleError(400, 'action is seen or reply');
  return notesForJoiner(me);
}

// ─── Meetings (A3) ──────────────────────────────────────────────────────────

async function myMeeting(me: Me, id: string): Promise<{ j: Journey; m: Meeting }> {
  const j = await joinerJourney(me.userId);
  const m = await lifecycleMeetings().findOne({ id, journeyId: j.id }, { projection: { _id: 0 } });
  if (!m) throw new LifecycleError(404, 'Meeting not found');
  return { j, m };
}

export async function meetingFor(me: Me, id: string) {
  const { j, m } = await myMeeting(me, id);
  const task = m.journeyTaskId ? (await tasksOf(j.id)).find((t) => t.id === m.journeyTaskId) : undefined;
  const managerName = j.managerUserId ? (await namesOf([j.managerUserId])).get(j.managerUserId) : undefined;
  return meetingView(m, await peopleOf(m.attendeeUserIds), { joinerId: j.userId, managerId: j.managerUserId, buddyId: j.buddyUserId, task, managerName, journey: j });
}

export async function actOnMeeting(me: Me, id: string, body: Record<string, unknown>) {
  const { j, m } = await myMeeting(me, id);
  if (body.met === 'yes') {
    const task = m.journeyTaskId ? (await tasksOf(j.id)).find((t) => t.id === m.journeyTaskId) : undefined;
    // Only their own (or shared) meeting's task: HR ticks induction and the batch session.
    if (task && !visibleTo('employee', task)) throw new LifecycleError(409, 'HR or your manager marks this one');
    await lifecycleMeetings().updateOne({ id }, { $set: { met: 'yes' } });
    if (task && OPEN_STATUSES.includes(task.status) && task.status !== 'locked') await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  } else if (body.met === 'moved') {
    const at = typeof body.newTime === 'string' ? new Date(body.newTime) : null;
    if (!at || Number.isNaN(at.getTime())) throw new LifecycleError(400, 'newTime is an ISO time');
    // Moved is not met: it is reminded and asked again at the new time.
    await lifecycleMeetings().updateOne({ id }, { $set: { met: 'moved', newTime: at, startsAt: at, endsAt: new Date(at.getTime() + 30 * 60_000) }, $unset: { remindedAt: '' } });
    await tell(m.attendeeUserIds.filter((u) => u !== me.userId), { scenario: 'lifecycle_meeting_moved', destination: 'lifecycle_joiner', title: `${m.title} moved`, body: `New time: ${humanDay(dateKeyOf(at))}`, data: { journeyId: j.id, meetingId: id } });
  } else throw new LifecycleError(400, 'met is yes or moved');
  return meetingFor(me, id);
}

// ─── Surveys (A7) ───────────────────────────────────────────────────────────

/** A survey closes at the end of its due day (company day): late answers are refused. */
export const surveyClosed = (t: JourneyTask | undefined, today: string) => !!t?.dueAt && keyOfDay(t.dueAt) < today;

/** The survey that is open now, else the next one coming. */
function currentSurvey(tasks: JourneyTask[], today: string): { kind: SurveyKind; task?: JourneyTask } {
  const day7 = tasks.find((t) => t.systemKey === 'day7_survey' && t.status !== 'cancelled');
  const pulses = tasks.filter((t) => t.systemKey === 'pulse_survey' && t.status !== 'cancelled').sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
  const open = [day7, ...pulses].find((t) => t && (t.status === 'todo' || t.status === 'sent_back') && !surveyClosed(t, today));
  const pick = open ?? [day7, ...pulses].find((t) => t && t.status === 'locked') ?? pulses.at(-1) ?? day7;
  const kind: SurveyKind = !pick || pick.systemKey === 'day7_survey' ? 'day7' : pick.month === 3 ? 'm3' : 'm6';
  return { kind, task: pick };
}

export async function surveyView(me: Me, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const today = todayKey(now, companyTimeZone(j.org));
  const { kind, task } = currentSurvey(await tasksOf(j.id), today);
  const sent = !!(await surveyResponses().findOne({ journeyId: j.id, kind }, { projection: { _id: 1 } }));
  const closed = !sent && surveyClosed(task, today);
  return { kind, open: !!task && (task.status === 'todo' || task.status === 'sent_back') && !sent && !closed, sent, ...(closed ? { closed: true } : {}), ...(task?.opensAt ? { opensAt: task.opensAt } : {}), ...(task?.dueAt ? { dueAt: task.dueAt } : {}) };
}

export function cleanSurveyAnswers(input: unknown): Record<string, string | number | null> {
  const a = (input ?? {}) as Record<string, unknown>;
  const scale = (v: unknown, label: string) => {
    if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 5) throw new LifecycleError(400, `${label} is 1 to 5`);
    return Number(v);
  };
  if (a.q2 !== 'yes' && a.q2 !== 'mostly' && a.q2 !== 'no') throw new LifecycleError(400, 'q2 is yes, mostly or no');
  const q4 = typeof a.q4 === 'string' ? a.q4.trim() : '';
  if (q4.length > 1000) throw new LifecycleError(400, 'q4 is at most 1000 characters');
  return { q1: scale(a.q1, 'q1'), q2: a.q2, q3: scale(a.q3, 'q3'), q4: q4 || null };
}

export async function sendSurvey(me: Me, body: Record<string, unknown>, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const tasks = await tasksOf(j.id);
  const today = todayKey(now, companyTimeZone(j.org));
  const { kind, task } = currentSurvey(tasks, today);
  if (surveyClosed(task, today)) throw new LifecycleError(409, `This survey closed on ${humanDay(keyOfDay(task!.dueAt!))}`);
  if (!task || (task.status !== 'todo' && task.status !== 'sent_back')) throw new LifecycleError(409, 'No survey is open');
  const answers = cleanSurveyAnswers(body.answers);
  const user = await users().findOne({ userId: me.userId }, { projection: { _id: 0, department: 1 } });
  const claimed = await surveyResponses().updateOne(
    { journeyId: j.id, kind },
    { $setOnInsert: {
      id: randomUUID(), org: j.org, kind, journeyId: j.id, userId: me.userId,
      ...(j.managerUserId ? { managerUserId: j.managerUserId } : {}), ...((j.department ?? user?.department) ? { department: j.department ?? user?.department } : {}),
      month: dateKeyOf(now, companyTimeZone(j.org)).slice(0, 7), answers, createdAt: now,
    } },
    { upsert: true },
  );
  if (!claimed.upsertedCount) throw new LifecycleError(409, 'You already sent this survey');
  await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  return { kind, open: false, sent: true };
}

export type SurveySummary = { kind: 'day7' | 'm3' | 'm6'; count: number; avg: number };
export const SURVEY_MIN_PEOPLE = 3;

/**
 * The manager's team summary, one per survey kind (Day 7, month 3, month 6), never merged:
 * a kind shows only once 3 or more different people in the team have answered it, and it
 * counts people, not responses (one person answering Day 7, M3 and M6 unlocks nothing).
 * Each person's latest answer of that kind counts once. Never a name or an answer.
 */
export async function surveySummariesFor(managerUserId: string): Promise<SurveySummary[]> {
  const rows = await surveyResponses().find({ managerUserId, kind: { $in: ['day7', 'm3', 'm6'] } }, { projection: { _id: 0, kind: 1, userId: 1, answers: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
  const out: SurveySummary[] = [];
  for (const kind of ['day7', 'm3', 'm6'] as const) {
    const byPerson = new Map<string, number>();
    for (const r of rows) if (r.kind === kind && r.userId) byPerson.set(r.userId, Number(r.answers?.q1));
    if (byPerson.size < SURVEY_MIN_PEOPLE) continue;
    const scores = [...byPerson.values()].filter((n) => Number.isFinite(n));
    const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    out.push({ kind, count: byPerson.size, avg });
  }
  return out;
}

// ─── Probation and the reveal (joiner) ──────────────────────────────────────

export async function probationForMe(me: Me, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const total = totalProbationMonths(j);
  const current = j.tj ? probationMonthOn(j.tj, todayKey(now, companyTimeZone(j.org)), total) : 0;
  const managerName = j.managerUserId ? (await namesOf([j.managerUserId])).get(j.managerUserId) : undefined;
  // The screen's header ("6 months of probation"), the month being worked on, and whose goals they are.
  return { ...(await probationForJoiner(j.id)), totalMonths: total, ...(current ? { currentMonth: current } : {}), ...(managerName ? { managerName } : {}) };
}

export async function checkinForMe(me: Me, month: number, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  return checkinByJoiner(j.id, me, month, body);
}

/** PB3 for the joiner: the outcome, their own new CTC (only to them), title, manager, KPIs, and the letter when the server has one. */
export async function revealForMe(me: Me) {
  const j = await joinerJourney(me.userId);
  const reveal = await revealFor(j.id);
  // letterUrl: their own letter PDF, served by GET /lifecycle/onboarding/letters/:id/pdf.
  return { ...reveal, seen: 'revealedAt' in reveal && !!reveal.revealedAt };
}

export async function revealSeenForMe(me: Me) {
  const j = await joinerJourney(me.userId);
  return markRevealSeen(j.id, me);
}

// ─── Manager (M0–M3) ────────────────────────────────────────────────────────

export const MANAGER_OWNED = ['manager', 'manager_employee', 'hr_manager'];

/** What a manager has to do on M0's card: their own tasks (HR's decision is HR's, not counted as theirs to tick). */
const managerToDo = (t: JourneyTask) => MANAGER_OWNED.includes(t.ownerRole) && ACTIVE_STATUSES.includes(t.status);

/** The next thing in probation for M0's pill ("Month 2 · Check-in Fri"). */
function nextEventLabel(j: Journey, tasks: JourneyTask[], today: string): string | undefined {
  const next = tasks
    .filter((t) => t.phase === 'probation' && (t.systemKey === 'monthly_checkin' || t.systemKey === 'monthly_review' || t.systemKey === 'monthly_goals' || t.systemKey === 'confirmation_discussion') && (ACTIVE_STATUSES.includes(t.status) || t.status === 'locked'))
    .map((t) => ({ t, on: t.status === 'locked' && t.opensAt ? keyOfDay(t.opensAt) : t.dueAt ? keyOfDay(t.dueAt) : '' }))
    .filter((x) => x.on && x.on >= today)
    .sort((a, b) => a.on.localeCompare(b.on))[0];
  if (!next) return undefined;
  const what = next.t.systemKey === 'monthly_checkin' ? 'Check-in' : next.t.systemKey === 'monthly_review' ? 'Review' : next.t.systemKey === 'monthly_goals' ? 'Goals' : 'Final talk';
  const days = daysBetween(today, next.on);
  const when = days === 0 ? 'today' : days < 7 ? dayDate(next.on).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }) : humanDay(next.on);
  return `${what} ${when}`;
}

/** The tasks of a journey that M0's row reads: the plant's keys, the manager's open tasks, what can be late, the next probation event. */
const LIST_KEYS: SystemTaskKey[] = ['upload_documents', 'about_you', 'meet_us', 'sign_letters', 'week1_reels', 'people_to_meet', 'day7_survey', 'confirmation_discussion'];
const MONTH_KEYS: SystemTaskKey[] = ['monthly_checkin', 'monthly_review', 'monthly_goals'];
/** Only the fields M0's row reads (the stage, plant, counts and next event): the list stays small on a slow database link. */
const LIST_TASK_PROJECTION = {
  _id: 0, journeyId: 1, systemKey: 1, status: 1, dueAt: 1, opensAt: 1, month: 1, ownerRole: 1, phase: 1, surface: 1, order: 1,
} as const;

/**
 * M0's tasks, without the rest (a probation journey has ~50, most of them later months'):
 * every task that can change a row's plant, counts or next event, and nothing else. A superset by
 * date (a day either side of today, the next 62 days of month tasks), so the row's own rules decide.
 */
async function listTasks(ids: string[], now: Date): Promise<Map<string, JourneyTask[]>> {
  if (!ids.length) return new Map();
  const DAY = 86_400_000;
  const soon = new Date(now.getTime() + 2 * DAY);
  const from = new Date(now.getTime() - 2 * DAY);
  const until = new Date(now.getTime() + 62 * DAY);
  const rows = await journeyTasks().find({
    journeyId: { $in: ids }, status: { $ne: 'cancelled' },
    $or: [
      { systemKey: { $in: LIST_KEYS } },
      // Leaves: a month's check-in and review both done.
      { systemKey: { $in: ['monthly_checkin', 'monthly_review'] }, status: 'done' },
      // The next probation event (M0's pill): open or locked, opening or due from about today.
      { systemKey: { $in: MONTH_KEYS }, status: { $in: [...ACTIVE_STATUSES, 'locked'] }, $or: [{ opensAt: { $gte: from, $lte: until } }, { dueAt: { $gte: from, $lte: until } }] },
      // The manager's own open tasks (today's count, overdue).
      { ownerRole: { $in: MANAGER_OWNED }, status: { $in: ACTIVE_STATUSES } },
      // Anything that can be late by today (the plant droops).
      { status: { $in: ['todo', 'sent_back'] }, dueAt: { $lt: soon } },
    ],
  } as never, { projection: LIST_TASK_PROJECTION }).sort({ order: 1, month: 1 }).toArray();
  const out = new Map<string, JourneyTask[]>();
  for (const row of rows as JourneyTask[]) {
    const list = out.get(row.journeyId) ?? [];
    list.push(row);
    out.set(row.journeyId, list);
  }
  return out;
}

/** The journey fields M0's row reads (deriveJourney's stage, plant and day label; the name and role). */
const LIST_JOURNEY_PROJECTION = {
  _id: 0, id: 1, org: 1, kind: 1, userId: 1, managerUserId: 1, status: 1, tj: 1, tl: 1, anchors: 1, designation: 1, lastActivityAt: 1, closedAt: 1,
  'candidate.name': 1, 'templateSnapshot.settings': 1,
  'probation.months': 1, 'probation.extendedBy': 1, 'probation.goalsLockedAt': 1,
  'probation.decision.outcome': 1, 'probation.decision.decidedAt': 1, 'probation.decision.revealedAt': 1,
} as const;

/** `fullTasks`: read whole journeys and every task (the checks compare the two, so the slim read never changes a row). */
export async function joinersForManager(me: Me, now = new Date(), opts: { fullTasks?: boolean } = {}) {
  const rows = (await journeys().find({
    org: me.org, kind: 'onboarding', managerUserId: me.userId, closedAt: { $exists: false },
    status: { $nin: ['draft', 'offer_sent', 'accepted', 'declined', 'expired', 'not_joining'] },
  }, opts.fullTasks ? {} : { projection: LIST_JOURNEY_PROJECTION }).toArray()).map(strip).filter((j) => !(j.status === 'confirmed' && j.probation?.decision?.revealedAt));
  const ids = rows.map((j) => j.id);
  const [allTasks, folks] = await Promise.all([
    opts.fullTasks ? groupTasks(ids) : listTasks(ids, now),
    users().find({ userId: { $in: rows.map((j) => j.userId).filter((u): u is string => !!u) } }, { projection: { _id: 0, name: 1, designation: 1, ...FACE_PROJECTION } }).toArray(),
  ]);
  const by = new Map(folks.map((f) => [f.userId, f]));
  const out = await Promise.all(rows.map(async (j) => {
    const tasks = allTasks.get(j.id) ?? [];
    const today = todayKey(now, companyTimeZone(j.org));
    const derived = deriveJourney(j, tasks, now);
    const mineOpen = tasks.filter(managerToDo);
    const person = j.userId ? by.get(j.userId) : undefined;
    const photoUrl = await photoOf(person);
    const nextEvent = derived.tab === 'probation' ? nextEventLabel(j, tasks, today) : undefined;
    return {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name: person?.name ?? j.candidate?.name ?? '—',
      ...(photoUrl ? { photoUrl } : {}), ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      dayLabel: derived.dayLabel, stage: derived.stage, plant: derived.plant, ...(nextEvent ? { nextEvent } : {}),
      // Today: what is due by today (an undated task, e.g. a starter task not yet given, is not "today" every day).
      todayCount: mineOpen.filter((t) => !!t.dueAt && keyOfDay(t.dueAt) <= today).length,
      overdue: mineOpen.filter((t) => taskLate(t, today)).length,
      preboarding: !isJoined(j), ...(j.tj ? { tj: j.tj } : {}),
    };
  }));
  out.sort((a, b) => b.overdue - a.overdue || b.todayCount - a.todayCount || (a.tj ?? '').localeCompare(b.tj ?? ''));
  return { joiners: out };
}

export async function joinerForManager(me: Me, journeyId: string, now = new Date()) {
  const j = await managedJourney(me.userId, journeyId);
  // Everything that needs only the journey, at once (the database link is slow; one wait, not eight).
  const [tasks, person, people, starters, notes, meetings, summaries, probation] = await Promise.all([
    tasksOf(j.id),
    j.userId ? users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, ...FACE_PROJECTION } }) : Promise.resolve(null),
    peopleViews(j),
    starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray(),
    notesFor(j.id, false),
    lifecycleMeetings().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ startsAt: 1 }).toArray(),
    surveySummariesFor(me.userId),
    probationOf(j.id),
  ]);
  const derived = deriveJourney(j, tasks, now);
  // Then the names and photo those point to, at once too.
  const [names, meetingPeople, starterNames, photoUrl, buddyFace] = await Promise.all([
    namesOf([j.userId, j.buddyUserId, j.managerUserId, ...tasks.map((t) => t.ownerUserId)]),
    peopleOf(meetings.flatMap((m) => m.attendeeUserIds)),
    namesOf(starters.map((s) => s.assignedByUserId)),
    photoOf(person),
    j.buddyUserId ? faceUrlsFor([j.buddyUserId]).then((faces) => faces.get(j.buddyUserId!) ?? null) : Promise.resolve(null),
  ]);
  const visible = tasks.filter((t) => visibleTo('manager', t));
  const meetingCtx = (m: Meeting) => ({ joinerId: j.userId, managerId: j.managerUserId, buddyId: j.buddyUserId, task: tasks.find((t) => t.id === m.journeyTaskId), managerName: j.managerUserId ? names.get(j.managerUserId) : undefined, journey: j });
  const meetingOf = new Map(meetings.filter((m) => m.journeyTaskId).map((m) => [m.journeyTaskId!, m]));
  const first = (person?.name ?? j.candidate?.name ?? '').split(/\s+/)[0] || 'them';
  // Managers never see pay: the decision reaches them without the salary.
  const decision = probation.decision ? (({ salary: _salary, ...rest }) => rest)(probation.decision) : undefined;
  const own = tasks.filter((t) => visibleTo('employee', t));
  const today = todayKey(now, companyTimeZone(j.org));
  // "On track. Week-1 tasks are due Fri 5 Dec." — the joiner's next must-do still open.
  const nextDue = own
    .filter((t) => ACTIVE_STATUSES.includes(t.status) && t.dueAt && keyOfDay(t.dueAt) >= today && t.phase === derived.tab)
    .sort((a, b) => Number(b.mustDo) - Number(a.mustDo) || keyOfDay(a.dueAt!).localeCompare(keyOfDay(b.dueAt!)))[0];
  return {
    joiner: {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name: person?.name ?? j.candidate?.name ?? '—', ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      ...((j.department ?? person?.department) ? { department: j.department ?? person?.department } : {}),
      tj: j.tj, dayLabel: derived.dayLabel, stage: derived.stage, stageName: stageName(derived.stage), plant: derived.plant,
      preboarding: !isJoined(j), probationMonths: totalProbationMonths(j), goalsLocked: goalsLocked(j, now),
      ownProgress: { done: own.filter((t) => t.status === 'done' || t.status === 'skipped').length, total: own.filter((t) => t.status !== 'cancelled').length },
      progress: progressOf(tasks, derived.tab),
    },
    tasks: visible.map((t) => {
      const m = meetingOf.get(t.id);
      return { ...managerTaskView(t, j, names, now, first), ...(m ? { meetingId: m.id, meeting: meetingView(m, meetingPeople, meetingCtx(m)) } : {}) };
    }),
    journey: stagesFor(j, derived.stage),
    ...(nextDue ? { joinerNextDue: { title: nextDue.title, dueAt: keyOfDay(nextDue.dueAt!), dueLabel: humanDay(keyOfDay(nextDue.dueAt!)) } } : {}),
    welcomePost: {
      canPost: isJoined(j) && !j.managerWelcome,
      ...(j.managerWelcome ? { postedAt: j.managerWelcome.postedAt, text: j.managerWelcome.text, ...(j.managerWelcome.connectPostId ? { connectPostId: j.managerWelcome.connectPostId } : {}) } : {}),
    },
    setup: {
      people,
      ...(j.buddyUserId ? { buddy: { userId: j.buddyUserId, name: names.get(j.buddyUserId) ?? '', ...(buddyFace ? { photoUrl: buddyFace } : {}) } } : {}),
      ...(j.meetUs?.managerNote ? { welcomeNote: j.meetUs.managerNote } : {}),
      goals: j.probation?.goals ?? [],
      goalsLocked: goalsLocked(j, now),
    },
    goalsLocked: goalsLocked(j, now),
    probation: { months: probation.months, ...(decision ? { decision } : {}) },
    starterTasks: starters.map((s) => ({ ...s, assignedByName: starterNames.get(s.assignedByUserId) ?? '' })), notes,
    meetings: meetings.map((m) => meetingView(m, meetingPeople, meetingCtx(m))),
    // One summary per survey kind with 3+ people; `surveySummary` (CONTRACT) is the first of them, labelled by its kind.
    ...(summaries.length ? { surveySummary: summaries[0], surveySummaries: summaries } : {}),
  };
}

/** Count badges ("2 of 4", "2 of 6") for the week-1 reels and people to meet. */
async function countBadges(j: Journey): Promise<Partial<Record<SystemTaskKey, { done: number; total: number }>>> {
  const w = j.week1 ?? {};
  const people = await peopleToMeet().find({ journeyId: j.id }, { projection: { _id: 0, metAt: 1 } }).toArray();
  return {
    week1_reels: { done: [w.policies, w.taxRegime, w.bankPf, w.goalsReadAt].filter(Boolean).length, total: 4 },
    ...(people.length ? { people_to_meet: { done: people.filter((p) => p.metAt).length, total: people.length } } : {}),
  };
}

function goalsLocked(j: Journey, now: Date): boolean {
  if (j.probation?.goalsLockedAt) return true;
  return !!j.tj && isJoined(j) && todayKey(now, companyTimeZone(j.org)) >= addDaysKey(j.tj, 7);
}

export async function saveSetup(me: Me, journeyId: string, body: Record<string, unknown>, now = new Date()) {
  const j = await managedJourney(me.userId, journeyId);
  const set: Record<string, unknown> = { updatedAt: now };
  let setupSaved = false;
  if (body.people !== undefined) {
    if (!Array.isArray(body.people) || body.people.length > 6) throw new LifecycleError(400, 'Pick up to 6 people');
    const picks = body.people.map((p, i) => {
      const x = (typeof p === 'string' ? { userId: p } : p ?? {}) as Record<string, unknown>;
      if (typeof x.userId !== 'string' || !x.userId) throw new LifecycleError(400, `Person ${i + 1}: userId is required`);
      const why = typeof x.why === 'string' ? x.why.trim().slice(0, 200) : '';
      return { userId: x.userId, why };
    });
    const ids = [...new Set(picks.map((p) => p.userId))];
    if (ids.length !== picks.length) throw new LifecycleError(400, 'Each person once');
    if (j.userId && ids.includes(j.userId)) throw new LifecycleError(400, 'Not the joiner themself');
    const found = await users().countDocuments({ userId: { $in: ids }, org: j.org, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } });
    if (found !== ids.length) throw new LifecycleError(400, 'Everyone must be at the company');
    // People already met stay on the list; the rest follow the new picks.
    await peopleToMeet().deleteMany({ journeyId: j.id, personUserId: { $nin: ids }, metAt: { $exists: false } });
    for (const p of picks) {
      await peopleToMeet().updateOne({ journeyId: j.id, personUserId: p.userId }, {
        $set: { ...(p.why ? { why: p.why } : {}) },
        $setOnInsert: { id: randomUUID(), org: j.org, journeyId: j.id, personUserId: p.userId },
      }, { upsert: true });
    }
    setupSaved = setupSaved || picks.length > 0;
  }
  if (body.buddyUserId !== undefined) {
    if (body.buddyUserId === null || body.buddyUserId === '') {
      await journeys().updateOne({ id: j.id }, { $unset: { buddyUserId: '' } });
    } else {
      const buddy = await users().findOne({ userId: String(body.buddyUserId), org: j.org }, { projection: { _id: 1 } });
      if (!buddy || body.buddyUserId === me.userId || body.buddyUserId === j.userId) throw new LifecycleError(400, 'A buddy is a teammate other than you and the joiner');
      set.buddyUserId = String(body.buddyUserId);
      setupSaved = true;
    }
  }
  if (body.welcomeNote !== undefined) {
    const note = (body.welcomeNote ?? {}) as Record<string, unknown>;
    const text = typeof note.text === 'string' ? note.text.trim() : '';
    if (!text || text.length > 1000) throw new LifecycleError(400, 'A welcome note of up to 1000 characters');
    set['meetUs.managerNote'] = { kind: 'text', text, at: now };
    setupSaved = true;
  }
  let goalsSaved = false;
  if (body.goals !== undefined) {
    if (goalsLocked(j, now)) throw new LifecycleError(409, 'Probation goals are locked');
    set['probation.goals'] = cleanGoals(body.goals);
    goalsSaved = (set['probation.goals'] as string[]).length > 0;
  }
  await journeys().updateOne({ id: j.id }, { $set: set });
  const by = { userId: me.userId, name: me.name };
  if (setupSaved) await completeTask(j.id, 'manager_setup', by);
  if (set.buddyUserId) await completeTask(j.id, 'assign_buddy', by);
  if (goalsSaved) await completeTask(j.id, 'probation_goals', by);
  await refreshJourney(j.id);
  return joinerForManager(me, journeyId, now);
}

export async function assignStarterTask(me: Me, journeyId: string, body: Record<string, unknown>) {
  const j = await managedJourney(me.userId, journeyId);
  if (!j.userId) throw new LifecycleError(409, 'Give a starter task once they have joined');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) throw new LifecycleError(400, 'A task of up to 120 characters is required');
  const links = Array.isArray(body.links) ? body.links.slice(0, 3).map((l) => String(l).trim()).filter((l) => /^https?:\/\//i.test(l)).map((l) => l.slice(0, 500)) : [];
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  let dueAt: Date | undefined;
  if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== '') {
    if (!isDateKey(body.dueAt)) throw new LifecycleError(400, 'dueAt is YYYY-MM-DD');
    if (body.dueAt < todayKey(new Date(), companyTimeZone(j.org))) throw new LifecycleError(400, 'The due date is in the past');
    dueAt = dayDate(body.dueAt);
  }
  const row = {
    id: randomUUID(), org: j.org, journeyId: j.id, title, ...(links.length ? { links } : {}), ...(note ? { note } : {}),
    ...(dueAt ? { dueAt } : {}), assignedByUserId: me.userId, assignedAt: new Date(),
  };
  await starterTasks().insertOne({ ...row });
  // The journey's starter-task step is due when the earliest open one is.
  const open = await starterTasks().find({ journeyId: j.id, doneAt: { $exists: false }, dueAt: { $exists: true } }).sort({ dueAt: 1 }).limit(1).next();
  await setTaskDue(j.id, 'starter_task', open?.dueAt ?? null);
  await tell([j.userId], { scenario: 'lifecycle_starter_task', destination: 'lifecycle_starter_task', title: `${me.name} gave you a starter task`, body: `${title}${dueAt ? ` · Due ${humanDay(keyOfDay(dueAt))}` : ''}`, data: { journeyId: j.id, starterTaskId: row.id } });
  await refreshJourney(j.id);
  return { task: row };
}

export async function replyToStarterTask(me: Me, id: string, body: Record<string, unknown>) {
  const row = await starterTasks().findOne({ id }, { projection: { _id: 0 } });
  if (!row) throw new LifecycleError(404, 'Starter task not found');
  const j = await managedJourney(me.userId, row.journeyId);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 1000) throw new LifecycleError(400, 'A reply of up to 1000 characters');
  await starterTasks().updateOne({ id }, { $set: { managerReply: text } });
  await tell([j.userId], { scenario: 'lifecycle_starter_task_reply', destination: 'lifecycle_starter_task', title: `${me.name} replied`, body: text.slice(0, 120), data: { journeyId: j.id, starterTaskId: id } });
  return { task: { ...row, managerReply: text } };
}

export async function addNote(me: Me, journeyId: string, body: Record<string, unknown>) {
  const j = await managedJourney(me.userId, journeyId);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) throw new LifecycleError(400, 'Notes of up to 2000 characters');
  const shared = body.shared === true;
  if (shared && !j.userId) throw new LifecycleError(409, 'Share notes once they have joined');
  const now = new Date();
  const note = { id: randomUUID(), org: j.org, journeyId: j.id, authorUserId: me.userId, text, shared, ...(shared ? { sharedAt: now } : {}), createdAt: now };
  await oneOnOneNotes().insertOne({ ...note });
  await completeTask(j.id, 'one_on_one_notes', { userId: me.userId, name: me.name });
  if (shared) await tell([j.userId], { scenario: 'lifecycle_note_shared', destination: 'lifecycle_notes', title: `${me.name} shared notes from your 1:1`, body: 'Tap to read and reply', data: { journeyId: j.id, noteId: note.id } });
  return { note };
}

/**
 * M2 "Post a welcome": the manager's own welcome for the joiner on Connect, in the new-joiner
 * style (their note on the joiner's card), once per joiner. Separate from the joiner's intro post.
 */
export async function postWelcome(me: Me, journeyId: string, body: Record<string, unknown>) {
  const j = await managedJourney(me.userId, journeyId);
  if (!j.userId || !isJoined(j)) throw new LifecycleError(409, 'Post a welcome once they have joined');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 500) throw new LifecycleError(400, 'A welcome of up to 500 characters');
  const now = new Date();
  // Claimed first, so two taps never make two posts.
  const claimed = await journeys().updateOne({ id: j.id, managerWelcome: { $exists: false } }, { $set: { managerWelcome: { text, postedAt: now } } });
  if (!claimed.modifiedCount) throw new LifecycleError(409, 'You already posted a welcome');
  const joiner = await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, profilePhotoKey: 1 } });
  const manager = await users().findOne({ userId: me.userId }, { projection: { _id: 0, name: 1, designation: 1 } });
  const name = joiner?.name ?? j.candidate?.name ?? 'Our new joiner';
  const joinedOn = j.tj ? dayDate(j.tj).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : undefined;
  const designation = j.designation ?? joiner?.designation;
  const department = j.department ?? joiner?.department;
  let postId: string | undefined;
  try {
    const post = await createConnectPost(me.userId, {
      type: 'new_joinee',
      body: {
        personUserId: j.userId, personName: name, personInitials: initials(name), photoKey: joiner?.profilePhotoKey,
        subtitle: [designation, department ? `${department}${joinedOn ? ` · Joined ${joinedOn}` : ''}` : joinedOn ? `Joined ${joinedOn}` : undefined].filter(Boolean).join(' · ') || 'Teammate',
        managerName: manager?.name ?? me.name, managerInitials: initials(manager?.name ?? me.name), managerDesignation: manager?.designation ?? 'Manager',
        managerNote: text, welcomePost: true,
        actionLabel: 'Say hi', actionDoneLabel: 'Said hi!',
      },
    });
    postId = (post as { id?: string }).id;
  } catch (error) {
    await journeys().updateOne({ id: j.id }, { $unset: { managerWelcome: '' } });
    throw error;
  }
  if (postId) await journeys().updateOne({ id: j.id }, { $set: { 'managerWelcome.connectPostId': postId } });
  await tell([j.userId], { scenario: 'lifecycle_welcome_post', destination: 'lifecycle_onboarding', title: `${manager?.name ?? me.name} welcomed you on Connect`, body: text.slice(0, 120), data: { journeyId: j.id, ...(postId ? { postId } : {}) } });
  return { welcomePost: { canPost: false, postedAt: now, text, ...(postId ? { connectPostId: postId } : {}) } };
}

const MANAGER_SCREEN_KEYS = new Set<SystemTaskKey>(['starter_task', 'one_on_one_notes', 'probation_goals', 'monthly_goals', 'monthly_checkin', 'monthly_review', 'manager_setup', 'assign_buddy']);

/**
 * Whether the manager can tick a task straight from M2 ("Done"): their own (or shared with the
 * joiner) and not done on a screen of its own. HR's decision tasks (`hr_manager`, e.g. the
 * Confirmation discussion) are HR's to record in the dashboard: ticking one here would close the
 * decision window and lock HR out.
 */
export function managerMayTick(t: JourneyTask): boolean {
  if (t.ownerRole !== 'manager' && t.ownerRole !== 'manager_employee') return false;
  if (t.systemKey && MANAGER_SCREEN_KEYS.has(t.systemKey)) return false;
  return t.status === 'todo' || t.status === 'sent_back';
}

export async function managerTaskDone(me: Me, journeyId: string, taskId: string, body: Record<string, unknown>) {
  const j = await managedJourney(me.userId, journeyId);
  if (body.action !== 'done') throw new LifecycleError(400, 'action is done');
  const task = (await tasksOf(j.id)).find((t) => t.id === taskId);
  if (!task || !MANAGER_OWNED.includes(task.ownerRole)) throw new LifecycleError(404, 'Task not found');
  if (task.ownerRole === 'hr_manager') throw new LifecycleError(403, 'HR records this one in the dashboard');
  if (task.systemKey && MANAGER_SCREEN_KEYS.has(task.systemKey)) throw new LifecycleError(409, 'This one is done from its own screen');
  const done = await finishTaskById(j.id, taskId, 'done', { userId: me.userId, name: me.name });
  return { task: taskView(done, j, await namesOf([done.ownerUserId])) };
}

export async function managerProbationMonth(me: Me, journeyId: string, month: number, body: Record<string, unknown>) {
  await managedJourney(me.userId, journeyId);
  return updateMonthByManager(journeyId, me, month, body);
}

export { daysBetween };
