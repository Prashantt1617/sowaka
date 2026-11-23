/**
 * Onboarding · Final designs — the joiner's app (FINAL-DESIGNS.md §4.2): one answer for the home and
 * every tile's screen, and the joiner's writes (tasks, forms, check-ins, goals, watch list, Day-1
 * signing, media). Every count and state comes from here; the app only filters lists by `step` for
 * the look ahead.
 */
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  checkinAnswers, companies, employeePaymentDetails, journeys, leaves, letterTemplates, letters as lettersCol, lifecycleFiles, meetingNotes, overtimeRequests, probationMonths, taxDeclarations, users,
} from '../../config/db';
import type { CheckinAnswerType, Journey, JourneyTask, LetterKind, ProbationGoal, TemplateTask, TourLessonKey } from '../../models/lifecycle.model';
import { policiesFor, policyAckCounts } from '../policy-document.service';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { devicesFor, firstPunchOf, joinerJourney, tourDoneOf, TOUR_LESSONS, TOUR_MANAGER_LESSONS } from './appOnboarding';
import { designOf, journeyMayRead } from './design';
import { MEET_ROLE_LABEL, stepKey, stepLabels, stepOfStage } from './designRules';
import { accessTasks, firstOf, initialsOf, joinerDesignTasks, place, type Placed, type PlacedRow } from './designRows';
import { stepOfDay as stepOfDayKey } from './teamTasks';
import { dateKeyOf, daysBetween, dayDate, keyOfDay, probationMonthEnd, companyTimeZone } from './dueRules';
import { LifecycleError, deriveJourney, finishTaskById, isJoined, tasksOf } from './engine';
import { readFileBytes, storeFile, uploadName, checkUpload } from './files';
import { letterPdfForPortal, openLetter, portalLetters, signLetter, type PortalLetter } from './letters';
import { journeyDocumentsView } from './documents';
import { PROFILE_SECTIONS, appSectionTitle, sectionStates } from './profile';
import { sectionLocked } from './profileLock';
import { ensureMonths } from './probation';

type Me = { userId: string; name: string; org: string };

const done = (t: JourneyTask) => t.status === 'done' || t.status === 'skipped';
const VERB = { do: 'Start', review: 'Review', ack: 'Read', sign: 'Sign', other: 'Open', form: 'Start' } as const;

/** Product facts behind "Do in Sowaka" rows and "Acknowledge company policies": done when they hold. */
async function productFacts(me: Me, j: Journey) {
  const since = j.tj ? ObjectId.createFromTime(Math.floor(dayDate(j.tj).getTime() / 1000)) : undefined;
  const [firstPunch, docs, tax, pay, leave, overtime, policies] = await Promise.all([
    firstPunchOf(me.userId, j.tj),
    journeyDocumentsView(j.id),
    taxDeclarations().find({ org: me.org, userId: me.userId }, { projection: { _id: 0, status: 1, fy: 1 } }).sort({ fy: -1 }).limit(1).next(),
    employeePaymentDetails().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, accountLast4: 1 } }),
    since ? leaves().findOne({ userId: me.userId, _id: { $gte: since } } as never, { projection: { _id: 1 } }) : Promise.resolve(null),
    since ? overtimeRequests().findOne({ userId: me.userId, _id: { $gte: since } } as never, { projection: { _id: 1 } }) : Promise.resolve(null),
    policiesFor({ userId: me.userId, org: me.org }),
  ]);
  const sections = sectionStates(j, docs);
  const profileDone = PROFILE_SECTIONS.filter((k) => sections[k]).length;
  const counts = policyAckCounts(policies);
  return {
    firstPunch, sections, profileDone,
    screen: {
      punch: !!firstPunch.at,
      profile: profileDone === PROFILE_SECTIONS.length,
      tax: tax?.status === 'submitted',
      payroll: !!pay?.accountLast4,
      leave: !!leave,
      overtime: !!overtime,
    } as Record<string, boolean>,
    taxStarted: tax?.status === 'saved',
    policies: counts,
  };
}

/** Ticks the rows whose fact holds (once; the engine keeps who and when). */
async function syncFacts(me: Me, j: Journey, tasks: JourneyTask[], facts: Awaited<ReturnType<typeof productFacts>>): Promise<boolean> {
  let changed = false;
  const design = await designOf(j);
  for (const { task, row } of joinerDesignTasks(j, tasks, design)) {
    if (done(task) || task.status === 'locked') continue;
    const d = row.design!;
    const holds = d.taskType === 'do' ? !!(d.screen && facts.screen[d.screen])
      : d.taskType === 'ack' && d.source === 'policies' ? facts.policies.toAcknowledge === 0 : false;
    if (!holds) continue;
    await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name }).catch(() => undefined);
    changed = true;
  }
  return changed;
}

async function signDocNames(org: string, docs: string[] | undefined): Promise<string> {
  const list = docs?.length ? docs : ['appointment'];
  const ids = list.filter((d) => d !== 'appointment' && d !== 'nda');
  const named = ids.length ? await letterTemplates().find({ org, id: { $in: ids } }, { projection: { _id: 0, id: 1, name: 1 } }).toArray() : [];
  const names = new Map(named.map((t) => [t.id, t.name]));
  return list.map((d) => (d === 'appointment' ? 'Appointment letter' : d === 'nda' ? 'Non-disclosure agreement' : names.get(d) ?? '')).filter(Boolean).join(', ');
}

/** The kinds the Sign task lists (appointment, NDA; a Document template by its kind). */
async function signKinds(org: string, docs: string[] | undefined): Promise<LetterKind[]> {
  const list = docs?.length ? docs : ['appointment'];
  const ids = list.filter((d) => d !== 'appointment' && d !== 'nda');
  const kinds = ids.length ? (await letterTemplates().find({ org, id: { $in: ids } }, { projection: { _id: 0, kind: 1 } }).toArray()).map((t) => t.kind) : [];
  return [...new Set([...list.filter((d): d is LetterKind => d === 'appointment' || d === 'nda'), ...kinds])];
}

type Person = { userId: string; name: string; initials: string; photoUrl?: string };
async function personMap(ids: Array<string | undefined>): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await users().find<FaceFields & { name: string }>({ userId: { $in: list } }, { projection: { _id: 0, name: 1, ...FACE_PROJECTION } }).toArray();
  return new Map(rows.map((r) => {
    const photoUrl = faceUrlOf(r);
    return [r.userId, { userId: r.userId, name: r.name, initials: initialsOf(r.name), ...(photoUrl ? { photoUrl } : {}) }];
  }));
}

const mediaUrl = (fileId?: string) => (fileId ? `/lifecycle/joiner/media/${fileId}` : undefined);

/**
 * Whether a row of an earlier step is in the joiner's list now (the canvas's "From Day 1" rows): left open, or done only
 * since the current step began. Ticked now, it stays in the list, ticked and counted ("1 of 6 met"), until the step ends,
 * instead of vanishing as it is ticked (and taking the count's total down with it).
 */
export function carriedNow(j: Pick<Journey, 'tj' | 'org'>, step: number, months: number, rowStep: number, isDone: boolean, doneAt?: Date | string | null): boolean {
  if (rowStep >= step || step <= 0 || step >= 3 + months) return false;
  if (!isDone) return true;
  if (!doneAt || !j.tj) return false;
  return stepOfDayKey(j.tj, dateKeyOf(new Date(doneAt), companyTimeZone(j.org)), months) >= step;
}

function watchRowView(p: PlacedRow, months: number) {
  const m = p.row.design!.media ?? { type: 'video' as const };
  return {
    id: p.row.id, title: p.row.title, type: m.type, ...(m.minutes ? { minutes: m.minutes } : {}), ...(mediaUrl(m.fileId) ? { url: mediaUrl(m.fileId) } : {}),
    ...(m.text ? { text: m.text } : {}), ...(m.bg ? { bg: m.bg } : {}), step: stepKey(p.step, months), watched: p.done,
  };
}

/** GET /lifecycle/joiner/onboarding */
export async function joinerOnboarding(me: Me, now = new Date()) {
  const j0 = await joinerJourney(me.userId);
  let tasks = await tasksOf(j0.id);
  const design = await designOf(j0);
  let facts = await productFacts(me, j0);
  if (await syncFacts(me, j0, tasks, facts)) tasks = await tasksOf(j0.id);
  const j = (await journeys().findOne({ id: j0.id }, { projection: { _id: 0 } })) as Journey;
  const p = await place(j, now, design);
  const { months, step, today } = p;
  const company = await companies().findOne({ id: j.org }, { projection: { _id: 0, name: 1 } });
  const people = await personMap([p.people.manager, p.people.buddy, p.people.hr, p.people.it, p.people.head_of_department, p.people.senior]);
  const labels = stepLabels(months);
  const confirmed = step === 3 + months;
  const keyOf = (s: number) => stepKey(s, months);

  // Meetings.
  const notes = await meetingNotes().find({ journeyId: j.id, userId: me.userId }, { projection: { _id: 0, rowId: 1, notes: 1 } }).toArray();
  const notesOf = new Map(notes.map((n) => [n.rowId, n.notes]));
  const meetings = p.meetings.map((m) => {
    const withRole = m.row.design!.meetWith!;
    let who = p.people[withRole] ? people.get(p.people[withRole]!) : undefined;
    let roleLabel = MEET_ROLE_LABEL[withRole];
    // The confirmation discussion is with the manager and HR (New joiner canvas: "Sunny Kapoor and Ritu Sharma · Your manager and HR").
    const hr = p.people.hr ? people.get(p.people.hr) : undefined;
    if (m.row.team?.key === 'mgr_confirmation' && who && hr && hr.userId !== who.userId) {
      who = { ...who, name: `${who.name} and ${hr.name}` };
      roleLabel = 'Your manager and HR';
    }
    const locked = !!m.opensOn && today < m.opensOn && !m.done;
    const id = `team:${m.rowKey}`;
    return {
      id, title: m.row.title, withRole, roleLabel, ...(who ? { person: who } : {}),
      step: keyOf(m.step), everyMonth: !!m.row.design!.everyMonth, ...(m.month ? { month: m.month } : {}),
      met: m.done, ...(m.doneAt ? { metAt: new Date(m.doneAt).toISOString() } : {}), locked, ...(m.opensOn ? { opensOn: m.opensOn } : {}),
      ...(carriedNow(j, step, months, m.step, m.done, m.doneAt) ? { carriedFrom: keyOf(m.step) } : {}),
      agenda: [...(m.row.agenda ?? m.row.team?.agenda ?? [])], notes: notesOf.get(id) ?? [],
      ...(p.startsAt.get(m.rowKey) ? { startsAt: new Date(p.startsAt.get(m.rowKey)!).toISOString() } : {}),
    };
  });

  // Tasks.
  // First punch-in is the Day-1 card on top (editor: "Shown on top on Day 1"), and Complete your profile is the
  // "Your profile" card (24 Nov, HR: "it is already living outside"): neither is a row in Tasks.
  const designTasks = joinerDesignTasks(j, tasks, design).filter(({ row }) => row.design?.screen !== 'punch' && row.design?.screen !== 'profile');
  const taskRows = designTasks.length
    ? await Promise.all(designTasks.map(async ({ task, row }) => taskRowView(j, task, row, facts, months, step)))
    : legacyTaskRows(j, tasks, months, step);
  // Confirmed: the confirmation letter HR sent ("Read your confirmation letter · From HR").
  if (confirmed) {
    const letter = await lettersCol().find({ journeyId: j.id, kind: 'confirmation', 'email.sentAt': { $exists: true } }, { projection: { _id: 0, id: 1, openedAt: 1 } }).sort({ createdAt: -1 }).limit(1).next();
    if (letter) {
      taskRows.push({
        id: `letter:${letter.id}`, title: 'Read your confirmation letter', type: 'ack', verb: 'Read', meta: 'From HR', step: 'confirmed',
        state: letter.openedAt ? 'done' : 'todo', opens: { fileUrl: `/lifecycle/onboarding/letters/${letter.id}/pdf` },
      } as never);
    }
  }

  // Check-ins, watch list, devices, tour, profile, goals.
  // Every check-in, closed (missed) ones too: the app lists them all, upcoming ones locked (24 Nov, HR).
  const checkins = p.checkins.map((c) => ({
    id: c.row.id, title: c.row.title, step: keyOf(c.step), questions: (c.row.design!.questions ?? []).length, state: c.state,
    ...(c.opensOn ? { opensOn: c.opensOn } : {}), ...(c.answers ? { sentAt: c.answers.sentAt.toISOString() } : {}),
  }));
  const watch = p.watch.map((w) => watchRowView(w, months));
  const trainings = p.trainings.map((w) => watchRowView(w, months));
  const accessRows = accessTasks(j, tasks, design);
  const devices = accessRows.length
    ? accessRows.map((t) => ({ id: t.id, title: t.title, ready: done(t), ...(t.doneAt ? { readyAt: new Date(t.doneAt).toISOString() } : {}) }))
    // An older journey: the 20 Nov list (laptop, email, the app, the template's access rows).
    : devicesFor(tasks).map((d) => ({ id: 'id' in d && d.id ? d.id : d.key, title: d.title, ready: d.ready }));
  const tour = await tourView(me, j, facts.firstPunch, design.settings.tourLessons);
  const profile = {
    // `locked`: HR approved the section on the dashboard; the joiner can no longer change it.
    sections: PROFILE_SECTIONS.map((key) => ({ key, title: appSectionTitle(key), state: facts.sections[key] ? 'done' as const : 'todo' as const, locked: sectionLocked(j, key) })),
    done: facts.profileDone, total: PROFILE_SECTIONS.length, pct: Math.round((facts.profileDone / PROFILE_SECTIONS.length) * 100),
  };
  const goals = await goalsCard(j, p, people);

  // "Now" counts for the tiles.
  const nowRows = <T extends { step: string; carriedFrom?: string }>(list: T[]) => list.filter((r) => r.step === keyOf(step) || (!!r.carriedFrom && !confirmed));
  const nowMeetings = nowRows(meetings);
  const openTasks = nowRows(taskRows).filter((t) => t.state !== 'done');
  // UP NEXT is the first open row as the Tasks screen lists them: what was carried over comes first.
  const upNext = openTasks.find((t) => t.carriedFrom) ?? openTasks[0];
  const unwatched = [...watch, ...trainings].filter((w) => !w.watched && p.watch.concat(p.trainings).find((x) => x.row.id === w.id)!.step === Math.max(step, 1));
  const due = checkins.find((c) => c.state === 'open');
  const hero = confirmed ? { eyebrow: 'PROBATION COMPLETE' as const, label: 'Confirmed!' } : { eyebrow: 'YOU ARE HERE' as const, label: labels[Math.max(step, 1)] };
  return {
    journeyId: j.id, companyName: company?.name ?? '', firstName: firstOf(me.name),
    step: keyOf(step),
    steps: labels.slice(1).map((label, i) => ({ key: keyOf(i + 1), label, state: i + 1 < step ? 'done' as const : i + 1 === Math.max(step, 1) ? 'current' as const : 'future' as const })),
    hero, plant: deriveJourney(j, tasks, now).plant, firstPunch: facts.firstPunch,
    ...(goals ? { goals } : {}),
    meetings, tasks: taskRows, checkins, watch, trainings, devices, tour, profile,
    // HR's names for the sections it can rename (the template editor); the app falls back to its own words.
    labels: { trainings: design.settings.trainingsLabel || 'Trainings' },
    summary: {
      meetings: { met: nowMeetings.filter((m) => m.met).length, total: nowMeetings.length },
      tasks: { toDo: openTasks.length, ...(upNext ? { upNext: upNext.title } : {}) },
      watch: { count: unwatched.length, ...(unwatched[0] ? { first: unwatched[0].title, ...(unwatched[0].minutes ? { minutes: unwatched[0].minutes } : {}) } : {}) },
      devices: { ready: devices.filter((d) => d.ready).length, total: devices.length },
      ...(due ? { checkinDue: { id: due.id, title: due.title } } : {}),
      tour: { done: tour.done.filter((k) => tour.lessons.includes(k)).length, total: tour.lessons.length, ...(tour.today ? { today: tour.today } : {}) },
    },
  };
}

/**
 * A journey made before the Final designs (its snapshot has no design rows): its own tasks by kind
 * (an ack as Read and acknowledge, a sign as Sign, a review as Review, the rest as More tasks);
 * meetings, surveys and check-ins of the older design are not listed (FINAL-DESIGNS.md §7).
 */
function legacyTaskRows(j: Journey, tasks: JourneyTask[], months: number, step: number) {
  const LISTED = new Set(['ack', 'sign', 'review', 'form', 'upload', 'system', 'post', 'tour', 'face', 'reel', 'assign', 'letter']);
  return tasks.filter((t) => t.ownerRole === 'employee' && t.phase !== 'pre_boarding' && LISTED.has(t.kind) && t.status !== 'cancelled').map((t) => {
    // The face and the tour open their own screens (Do in Sowaka), as the design's rows do.
    const screen = t.kind === 'face' ? 'punch' : t.kind === 'tour' ? 'tour' : undefined;
    const type = screen ? 'do' as const : t.kind === 'ack' ? 'ack' as const : t.kind === 'sign' ? 'sign' as const : t.kind === 'review' ? 'review' as const : 'other' as const;
    const s = j.tj && (t.dueAt ?? t.opensAt) ? stepOfDayKey(j.tj, keyOfDay((t.dueAt ?? t.opensAt)!), months) : 2;
    const state = done(t) ? 'done' as const : t.status === 'locked' ? 'locked' as const : 'todo' as const;
    return {
      id: t.id, title: t.title, type, verb: VERB[type], step: stepKey(s, months), state, ...(t.dueAt ? { dueOn: keyOfDay(t.dueAt) } : {}),
      ...(carriedNow(j, step, months, s, state === 'done', t.doneAt) ? { carriedFrom: stepKey(s, months) } : {}), opens: screen ? { screen } : {},
    };
  });
}

async function taskRowView(j: Journey, task: JourneyTask, row: TemplateTask, facts: Awaited<ReturnType<typeof productFacts>>, months: number, step: number) {
  const d = row.design!;
  const type = d.taskType ?? 'other';
  const s = stepOfStage(d.stage, months);
  let state: 'todo' | 'in_progress' | 'done' | 'locked' = done(task) ? 'done' : task.status === 'locked' ? 'locked' : 'todo';
  if (state === 'todo' && type === 'do' && d.screen === 'tax' && facts.taxStarted) state = 'in_progress';
  const policies = type === 'ack' && d.source === 'policies';
  const meta = type === 'sign' ? await signDocNames(j.org, d.signDocs)
    : policies ? `${facts.policies.acknowledged} of ${facts.policies.required} done`
      : d.screen === 'payroll' ? 'Bank account, PF and nominees' : undefined;
  return {
    id: task.id, title: row.title, type, verb: state === 'in_progress' ? 'Continue' as const : VERB[type],
    ...(meta ? { meta } : {}), step: stepKey(s, months), state,
    ...(task.dueAt ? { dueOn: keyOfDay(task.dueAt) } : {}),
    ...(carriedNow(j, step, months, s, state === 'done', task.doneAt) ? { carriedFrom: stepKey(s, months) } : {}),
    ...(policies ? { progress: { done: facts.policies.acknowledged, total: facts.policies.required } } : {}),
    opens: {
      ...(d.screen ? { screen: d.screen } : {}), ...(policies ? { policies: true as const } : {}), ...(type === 'sign' ? { letters: true as const } : {}),
      ...(type === 'form' ? { form: true as const } : {}), ...(d.link ? { link: d.link } : {}),
      ...(type === 'ack' && !policies && d.fileId ? { fileUrl: mediaUrl(d.fileId) } : {}),
    },
  };
}

async function tourView(me: Me, j: Journey, firstPunch: { at?: string }, kept?: TourLessonKey[]) {
  const keep = (k: string) => !kept || kept.includes(k as TourLessonKey);
  const reports = await users().countDocuments({ org: j.org, managerUserId: me.userId, hiddenFromDirectory: { $ne: true }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, { limit: 1 });
  const lessons = TOUR_LESSONS.filter(keep) as TourLessonKey[];
  const managerLessons = reports > 0 ? (TOUR_MANAGER_LESSONS.filter(keep) as TourLessonKey[]) : [];
  const doneKeys = tourDoneOf(j, firstPunch) as TourLessonKey[];
  const today = lessons.find((k) => !doneKeys.includes(k));
  return { lessons, ...(managerLessons.length ? { managerLessons } : {}), done: doneKeys, ...(today ? { today } : {}) };
}

/** The monthly goals meeting's next time: its set time, else the month's end. */
function nextTalkOf(p: Placed, month: number, people: Map<string, Person>) {
  const key = p.meetings.find((m) => m.row.design!.everyMonth && m.month === month);
  const at = key ? p.startsAt.get(key.rowKey) : undefined;
  if (!p.j.tj) return undefined;
  const on = at ? dateKeyOf(new Date(at), companyTimeZone(p.j.org)) : probationMonthEnd(p.j.tj, month);
  const manager = p.people.manager ? people.get(p.people.manager)?.name : undefined;
  return { on, inDays: Math.max(0, daysBetween(p.today, on)), ...(manager ? { withName: manager } : {}) };
}

async function goalsCard(j: Journey, p: Placed, people: Map<string, Person>) {
  if (p.step < 3 || p.step >= 3 + p.months || !j.userId) return undefined;
  const month = p.step - 2;
  const row = await probationMonths().findOne({ journeyId: j.id, monthNo: month }, { projection: { _id: 0, goals: 1 } });
  const nextTalk = nextTalkOf(p, month, people);
  return { month, count: row?.goals?.length ?? 0, ...(nextTalk ? { nextTalk } : {}) };
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/** POST /lifecycle/joiner/tasks/:taskId */
export async function joinerTaskAction(me: Me, taskId: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  if (taskId.startsWith('letter:')) {
    // "Read your confirmation letter": opened.
    const id = taskId.slice(7);
    const res = await lettersCol().updateOne({ id, journeyId: j.id, kind: 'confirmation', 'email.sentAt': { $exists: true }, openedAt: { $exists: false } }, { $set: { openedAt: new Date() } });
    if (!res.matchedCount && !(await lettersCol().findOne({ id, journeyId: j.id }, { projection: { _id: 1 } }))) throw new LifecycleError(404, 'Task not found');
    return joinerOnboarding(me);
  }
  const tasks = await tasksOf(j.id);
  // The same rows the home lists (a journey from before the Final designs reads them from its template).
  const found = joinerDesignTasks(j, tasks, await designOf(j)).find((x) => x.task.id === taskId);
  if (!found) {
    // A journey from before the Final designs lists its own tasks by kind (legacyTaskRows): the same taps apply,
    // and what finishes itself elsewhere (signing, uploads, the face, the tour, forms) stays with its own screen.
    const old = tasks.find((t) => t.id === taskId && t.ownerRole === 'employee' && t.status !== 'cancelled');
    if (!old) throw new LifecycleError(404, 'Task not found');
    const action = String(body.action ?? '');
    const byKind: Record<string, string[]> = { ack: ['acknowledged'], review: ['looks_good'], reel: ['opened', 'done'], post: ['opened', 'done'], assign: ['opened', 'done'] };
    if (!(byKind[old.kind] ?? []).includes(action)) throw new LifecycleError(409, 'This one is done from its own screen');
    if (old.status === 'locked') throw new LifecycleError(409, 'This opens later');
    if (!done(old)) await finishTaskById(j.id, old.id, 'done', { userId: me.userId, name: me.name });
    return joinerOnboarding(me);
  }
  const { task, row } = found;
  const type = row.design!.taskType;
  const action = String(body.action ?? '');
  const allowed: Record<string, string[]> = { review: ['looks_good'], ack: row.design!.source === 'policies' ? [] : ['acknowledged'], other: ['opened', 'done'] };
  if (!(allowed[type ?? ''] ?? []).includes(action)) throw new LifecycleError(409, 'This one is done from its own screen');
  if (task.status === 'locked') throw new LifecycleError(409, 'This opens later');
  if (!done(task)) await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  return joinerOnboarding(me);
}

// ─── Forms (Fill in a form; answers saved to the profile) ───────────────────

async function formTask(me: Me, taskId: string) {
  const j = await joinerJourney(me.userId);
  const found = joinerDesignTasks(j, await tasksOf(j.id), await designOf(j)).find((x) => x.task.id === taskId && x.row.design!.taskType === 'form');
  if (!found) throw new LifecycleError(404, 'Form not found');
  return { j, ...found };
}

export async function joinerForm(me: Me, taskId: string) {
  const { j, row } = await formTask(me, taskId);
  const saved = j.forms?.[taskId];
  const questions = row.design!.questions ?? [];
  // A file answer is its file id: the read-only form shows the file's name.
  const fileIds = (saved?.answers ?? []).filter((a) => a.value && questions.find((q) => q.id === a.questionId)?.type === 'file').map((a) => String(a.value));
  const files = fileIds.length ? await lifecycleFiles().find({ id: { $in: fileIds }, journeyId: j.id }, { projection: { _id: 0, id: 1, name: 1 } }).toArray() : [];
  return {
    form: {
      taskId, title: row.title, questions,
      ...(saved ? { answers: saved.answers, sentAt: saved.sentAt } : {}),
      ...(files.length ? { files: Object.fromEntries(files.map((f) => [f.id, f.name])) } : {}),
    },
  };
}

export async function sendJoinerForm(me: Me, taskId: string, body: Record<string, unknown>) {
  const { j, task, row } = await formTask(me, taskId);
  if (task.status === 'locked') throw new LifecycleError(409, 'This opens later');
  const questions = row.design!.questions ?? [];
  if (!Array.isArray(body.answers)) throw new LifecycleError(400, 'answers is a list');
  const given = new Map((body.answers as Array<Record<string, unknown>>).map((a) => [String(a?.questionId ?? ''), a?.value]));
  const answers = await Promise.all(questions.map(async (q) => {
    const v = given.get(q.id);
    if (v === undefined || v === null || v === '') return { questionId: q.id, value: null };
    const text = String(v).trim().slice(0, q.type === 'long' ? 2000 : 300);
    if (q.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new LifecycleError(400, `${q.text}: a date is YYYY-MM-DD`);
    if (q.type === 'choice' && q.options?.length && !q.options.includes(text)) throw new LifecycleError(400, `${q.text}: pick one of the choices`);
    if (q.type === 'file' && !(await lifecycleFiles().findOne({ id: text, journeyId: j.id }, { projection: { _id: 1 } }))) throw new LifecycleError(400, `${q.text}: upload the file first`);
    return { questionId: q.id, value: text };
  }));
  const now = new Date();
  await journeys().updateOne({ id: j.id }, { $set: { [`forms.${taskId}`]: { answers, sentAt: now }, updatedAt: now } });
  if (!done(task)) await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  return joinerForm(me, taskId);
}

export async function uploadJoinerFormFile(me: Me, taskId: string, file: { originalname?: string; buffer: Buffer } | undefined) {
  const { j } = await formTask(me, taskId);
  if (!file?.buffer?.length) throw new LifecycleError(400, 'Choose a file');
  const stored = await storeFile(j.org, j.id, { name: uploadName(file.originalname ?? 'file'), contentType: checkUpload(file.buffer), bytes: file.buffer }, 'employee');
  return { fileId: stored.id, name: stored.name };
}

// ─── Check-ins ──────────────────────────────────────────────────────────────

async function checkinOf(me: Me, id: string) {
  const j = await joinerJourney(me.userId);
  const p = await place(j);
  const c = p.checkins.find((x) => x.row.id === id);
  if (!c) throw new LifecycleError(404, 'Check-in not found');
  return { j, p, c };
}

function checkinView(c: Placed['checkins'][number], months: number) {
  return {
    id: c.row.id, title: c.row.title, step: stepKey(c.step, months), state: c.state, ...(c.opensOn ? { opensOn: c.opensOn } : {}),
    ...(c.answers ? { sentAt: c.answers.sentAt.toISOString(), answers: c.answers.answers } : {}),
    questions: (c.answers?.questions ?? (c.row.design!.questions ?? []).filter((q) => (['rating', 'yes_no', 'short', 'long', 'choice'] as string[]).includes(q.type))).map((q) => ({ ...q })),
  };
}

export async function joinerCheckin(me: Me, id: string) {
  const { p, c } = await checkinOf(me, id);
  return checkinView(c, p.months);
}

/** POST /lifecycle/joiner/checkins/:id — the answers, once. Ratings 1–5, yes/no, text (null = skipped). */
export async function sendJoinerCheckin(me: Me, id: string, body: Record<string, unknown>) {
  const { j, p, c } = await checkinOf(me, id);
  if (c.state === 'sent') throw new LifecycleError(409, 'Sent already');
  if (c.state === 'closed') throw new LifecycleError(409, 'This check-in has closed');
  if (c.state === 'locked') throw new LifecycleError(409, c.opensOn ? `This opens on ${c.opensOn}` : 'This opens after confirmation');
  if (!Array.isArray(body.answers)) throw new LifecycleError(400, 'answers is a list');
  const given = new Map((body.answers as Array<Record<string, unknown>>).map((a) => [String(a?.questionId ?? ''), a?.value]));
  const questions = (c.row.design!.questions ?? []).map((q) => ({ id: q.id, text: q.text, type: q.type as CheckinAnswerType, ...(q.options ? { options: q.options } : {}) }));
  const answers = questions.map((q) => {
    const v = given.get(q.id);
    if (v === undefined || v === null || v === '') {
      if (q.type === 'rating' || q.type === 'yes_no') throw new LifecycleError(400, `Answer “${q.text}”`);
      return { questionId: q.id, value: null };
    }
    if (q.type === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new LifecycleError(400, `${q.text}: a rating is 1 to 5`);
      return { questionId: q.id, value: n };
    }
    if (q.type === 'yes_no') {
      if (v !== 'yes' && v !== 'no') throw new LifecycleError(400, `${q.text}: yes or no`);
      return { questionId: q.id, value: v };
    }
    const text = String(v).trim().slice(0, q.type === 'long' ? 2000 : 300);
    if (q.type === 'choice' && q.options?.length && !q.options.includes(text)) throw new LifecycleError(400, `${q.text}: pick one of the choices`);
    return { questionId: q.id, value: text || null };
  });
  try {
    await checkinAnswers().insertOne({ id: randomUUID(), org: j.org, journeyId: j.id, userId: me.userId, checkinId: c.row.id, title: c.row.title, questions, answers, sentAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new LifecycleError(409, 'Sent already');
    throw error;
  }
  await journeys().updateOne({ id: j.id }, { $set: { updatedAt: new Date() } });
  const after = await place((await journeys().findOne({ id: j.id }, { projection: { _id: 0 } })) as Journey);
  return checkinView(after.checkins.find((x) => x.row.id === id)!, p.months);
}

// ─── Goals ──────────────────────────────────────────────────────────────────

const goalView = (g: ProbationGoal, index: number) => ({
  index, text: g.text, ...(g.status ? { status: g.status } : {}), ...(g.note ? { note: g.note } : {}),
  ...(g.comment ? { comment: g.comment, ...(g.commentByName ? { commentByName: g.commentByName } : {}), ...(g.commentAt ? { commentAt: new Date(g.commentAt).toISOString() } : {}) } : {}),
});

export async function goalsOfJourney(j: Journey, p: Placed, viewerIsJoiner: boolean) {
  const rows = await ensureMonths(j);
  const month = Math.max(1, Math.min(p.months, p.step - 2));
  const people = await personMap([p.people.manager]);
  const nextTalk = nextTalkOf(p, month, people);
  const current = rows.find((r) => r.monthNo === month);
  return {
    month, ...(p.people.manager && people.get(p.people.manager) ? { managerName: people.get(p.people.manager)!.name } : {}), ...(nextTalk ? { nextTalk } : {}),
    current: (current?.goals ?? []).map(goalView),
    earlier: rows.filter((r) => r.monthNo < month && r.goals.length).sort((a, b) => b.monthNo - a.monthNo).map((r) => ({
      month: r.monthNo, goals: r.goals.map((g, i) => (viewerIsJoiner ? goalView(g, i) : goalView(g, i))),
    })),
  };
}

export async function joinerGoals(me: Me) {
  const j = await joinerJourney(me.userId);
  if (!isJoined(j)) throw new LifecycleError(409, 'Goals start after you join');
  return goalsOfJourney(j, await place(j), true);
}

/** PUT /lifecycle/joiner/goals/:month/:index — "How’s it going?" and the note. */
export async function saveJoinerGoal(me: Me, monthRaw: string, indexRaw: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const month = Number(monthRaw);
  const index = Number(indexRaw);
  const rows = await ensureMonths(j);
  const row = rows.find((r) => r.monthNo === month);
  if (!row || !Number.isInteger(index) || !row.goals[index]) throw new LifecycleError(404, 'Goal not found');
  const set: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!['start', 'progress', 'well'].includes(String(body.status))) throw new LifecycleError(400, 'status is start, progress or well');
    set[`goals.${index}.status`] = body.status;
  }
  const unset: Record<string, ''> = {};
  if (body.note !== undefined) {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (note) { set[`goals.${index}.note`] = note; set[`goals.${index}.noteAt`] = new Date(); } else { unset[`goals.${index}.note`] = ''; unset[`goals.${index}.noteAt`] = ''; }
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) throw new LifecycleError(400, 'Send status or note');
  await probationMonths().updateOne({ id: row.id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  await journeys().updateOne({ id: j.id }, { $set: { updatedAt: new Date() } });
  return joinerGoals(me);
}

// ─── Watch list and media ───────────────────────────────────────────────────

export async function markWatched(me: Me, itemId: string) {
  const j = await joinerJourney(me.userId);
  const { rows } = await designOf(j);
  if (!rows.some((r) => r.id === itemId && (r.design!.section === 'watch' || r.design!.section === 'training'))) throw new LifecycleError(404, 'Not on your watch list');
  const at = j.watched?.[itemId] ?? new Date();
  if (!j.watched?.[itemId]) await journeys().updateOne({ id: j.id }, { $set: { [`watched.${itemId}`]: at, updatedAt: new Date() } });
  return { watched: true, at };
}

export async function joinerMedia(me: Me, fileId: string): Promise<{ name: string; contentType: string; bytes: Buffer }> {
  const j = await joinerJourney(me.userId);
  if (!(await journeyMayRead(j, fileId))) throw new LifecycleError(404, 'File not found');
  const file = await lifecycleFiles().findOne({ org: j.org, id: fileId }, { projection: { _id: 0 } });
  if (!file) throw new LifecycleError(404, 'File not found');
  return { name: file.name, contentType: file.contentType, bytes: await readFileBytes(file) };
}

// ─── Day-1 signing ──────────────────────────────────────────────────────────

async function signOpts(j: Journey) {
  const row = joinerDesignTasks(j, await tasksOf(j.id), await designOf(j)).find((x) => x.row.design!.taskType === 'sign')?.row;
  return { app: true as const, kinds: await signKinds(j.org, row?.design?.signDocs) };
}

export async function joinerLetters(me: Me): Promise<{ letters: PortalLetter[] }> {
  const j = await joinerJourney(me.userId);
  return { letters: await portalLetters(j, await signOpts(j)) };
}
export async function joinerOpenLetter(me: Me, id: string) {
  const j = await joinerJourney(me.userId);
  return { letters: await openLetter(j, id, new Date(), await signOpts(j)) };
}
export async function joinerSignLetter(me: Me, id: string, body: Record<string, unknown>, meta: { ip: string; userAgent?: string }) {
  const j = await joinerJourney(me.userId);
  return { letters: await signLetter(j, id, body, meta, new Date(), await signOpts(j)) };
}
export async function joinerLetterPdf(me: Me, id: string) {
  const j = await joinerJourney(me.userId);
  return letterPdfForPortal(j, id, await signOpts(j));
}

/** The Actions tile (FINAL-DESIGNS.md §4.2 `/lifecycle/me` `onboarding.tile`). */
export async function joinerTile(j: Journey, now = new Date()): Promise<{ title: string; subtitle: string; badge: string } | undefined> {
  const design = await designOf(j);
  if (!design.isDesign || !isJoined(j)) return undefined;
  const p = await place(j, now, design);
  const label = stepLabels(p.months)[Math.max(p.step, 1)];
  const subtitle = p.step <= 1 && p.j.tj === p.today ? 'Today is your first day' : label;
  return { title: 'Onboarding', subtitle, badge: label };
}

