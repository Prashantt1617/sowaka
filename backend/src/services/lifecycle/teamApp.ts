/**
 * Onboarding · Final designs — Teams › Joiners for the manager, the buddy and the head of department
 * (and someone senior), and the shared parts HR's and IT's person page reads (FINAL-DESIGNS.md §4.3,
 * §4.4). The rows are the template's meeting and teammate rows placed by designRows.ts; their ticks
 * are the journey's `teamTasks` (one tick per row, shared with the joiner for meetings).
 */
import { randomUUID } from 'node:crypto';
import { companies, journeys, leaves, lifecycleMeetings, meetingNotes, probationMonths, users } from '../../config/db';
import type { Journey, JourneyTask, TeamRole } from '../../models/lifecycle.model';
import { reportDaysOfPerson } from '../attendance-report.service';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { postWelcome } from './appOnboarding';
import { templateReporting } from './design';
import { dueText, shortDay, stepLabels, stepOfStage } from './designRules';
import { TEAM_APP_COPY, TEAM_EARLY, TEAM_SCREEN } from './designSeed';
import { accessTasks, fillNames, firstOf, initialsOf, joinerDesignTasks, place, setRowTick, teammatePushTarget, teamRowTitle, type Placed, type PlacedRow } from './designRows';
import { daysBetween, keyOfDay } from './dueRules';
import { LifecycleError, deriveJourney, isJoined, loadJourney, tasksOf, tell } from './engine';
import { carriedNow, goalsOfJourney } from './joinerApp';
import { saveMeetingRowNotes } from './joinerMeetings';
import { PROFILE_SECTIONS, appSectionTitle, sectionStates } from './profile';
import { journeyDocumentsView } from './documents';
import { relationTo, type TeamRelation } from './teamTasks';

type Me = { userId: string; name: string; org: string };
export type Viewer = 'team' | 'hr' | 'it';

const TOUR_TITLES: Record<string, string> = {
  punch: 'Punch in and out', missed: 'Fix a missed punch', leave: 'Leave policy and applying for leave', overtime: 'Applying for overtime',
  approveLeave: 'Approving leave', approveOvertime: 'Approving overtime',
};

// ─── Who I am to the joiner ─────────────────────────────────────────────────

export interface Link { rel: TeamRelation | 'senior'; roles: TeamRole[]; approver: boolean }

/** My roles for a joiner on the team side (never HR or IT: they work from Actions › Onboarding). */
export async function teamLink(me: Me, j: Journey, p: Placed): Promise<Link | null> {
  const link = await relationTo(me, j);
  const roles: TeamRole[] = [];
  if (link?.rel === 'report') roles.push('manager');
  if (link?.rel === 'buddy' || j.buddyUserId === me.userId) roles.push('buddy');
  if (link?.approver) roles.push('head_of_department');
  if (p.people.senior === me.userId) roles.push('senior');
  if (!link && !roles.length) return null;
  return { rel: link?.rel ?? 'senior', roles: [...new Set(roles)], approver: !!link?.approver };
}

async function teamJourney(me: Me, journeyId: string): Promise<{ j: Journey; p: Placed; link: Link }> {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || j.org !== me.org || j.closedAt) throw new LifecycleError(404, 'Joiner not found');
  const p = await place(j);
  const link = await teamLink(me, j, p);
  if (!link) throw new LifecycleError(404, 'Joiner not found');
  return { j, p, link };
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** A row's done state, from its tick or the record its screen writes. */
export function rowDone(r: PlacedRow, j: Journey, tasks: JourneyTask[], design?: Placed['design']): boolean {
  const key = r.row.team?.key ?? '';
  if (key === 'mgr_assign_buddy') return r.done || !!j.buddyUserId;
  if (key === 'mgr_welcome') return r.done || !!j.meetUs?.managerNote;
  if (key === 'mgr_feed_intro') return r.done || !!j.managerWelcome;
  if (key === 'mgr_confirmation_review') return !!j.probation?.recommendation;
  // HR's letter row: done when the confirmation (or extension) letter is sent from the dashboard (the app draws no button).
  if (key === 'hr_confirmation_letter') return r.done || !!j.probation?.decision?.letterId || tasks.some((t) => t.systemKey === 'confirmation_letter' && t.status === 'done');
  if (key === 'hod_approve') return j.probation?.hodApproval?.outcome === 'approved' || j.probation?.hodApproval?.outcome === 'extended';
  if (key === 'it_accesses' || key === 'hr_accesses') {
    const list = accessTasks(j, tasks, design).filter((t) => t.ownerRole === (key === 'it_accesses' ? 'it' : 'hr'));
    return list.length > 0 && list.every((t) => t.status === 'done' || t.status === 'skipped');
  }
  return r.done;
}

export interface RowView {
  id: string; title: string; kind: string; step: number; stepLabel: string; early: boolean; done: boolean; locked: boolean;
  pair?: string; how?: string; note?: string;
  pill?: { text: string; tone: 'blue' | 'green' | 'grey' | 'amber' | 'red' };
  opens: string | null; canTick: boolean; agenda?: string[]; month?: number; checkinId?: string; doneByName?: string;
  dueOn?: string; due?: { text: string; tone: 'red' | 'amber' | 'grey' }; late?: boolean;
  /** Team page meetings only (lane T): my own agenda notes and the time set for it. */
  notes?: string[]; startsAt?: string;
  /** Team page, the welcome message and the feed post once sent: the words that went out. */
  sent?: string;
}

/** One of my rows, as Teams › Joiners (viewer 'team') or HR / IT (viewer 'hr' | 'it') shows it. */
export function rowView(r: PlacedRow, p: Placed, tasks: JourneyTask[], first: string, viewer: Viewer, names: Map<string, string>): RowView {
  const j = p.j;
  const labels = stepLabels(p.months);
  const key = r.row.team?.key ?? '';
  const meeting = r.row.design?.section === 'meeting';
  const done = rowDone(r, j, tasks, p.design);
  // The feed post goes out on Connect, which the joiner is on only once they have joined: before then it waits for Day 1.
  const early = (TEAM_EARLY.has(key) && !(key === 'mgr_feed_intro' && !isJoined(j))) || (viewer !== 'team' && !meeting);
  const locked = !done && r.step > p.step && !early;
  const copy = TEAM_APP_COPY[key];
  const screen = meeting ? 'meeting' : TEAM_SCREEN[key] ?? (viewer === 'team' ? null : 'plain');
  let pill: RowView['pill'];
  if (key === 'mgr_read_checkin' && r.checkin) {
    const c = p.checkins.find((x) => x.row.id === r.checkin!.id);
    pill = done ? { text: 'Read', tone: 'green' } : c?.answers ? { text: 'Ready to read', tone: 'blue' } : { text: `Waiting for ${first}`, tone: 'grey' };
  } else if (key === 'hod_approve') {
    const a = j.probation?.hodApproval;
    const managerFirst = firstOf(names.get(j.managerUserId ?? '') ?? '');
    pill = a?.outcome === 'approved' ? { text: 'Approved', tone: 'green' } : a?.outcome === 'extended' ? { text: 'Extended', tone: 'green' }
      : j.probation?.recommendation ? { text: 'Ready to approve', tone: 'blue' } : { text: `Waiting for ${managerFirst}`, tone: 'grey' };
  } else if (!done && r.step > p.step && early) {
    pill = { text: r.step === 0 ? 'Before Day 1' : labels[r.step], tone: 'grey' };
  }
  const waiting = pill?.text.startsWith('Waiting for');
  const view: RowView = {
    id: r.rowKey, title: teamRowTitle(r, first), kind: meeting ? 'meet' : r.row.team?.kind ?? 'task', step: r.step,
    stepLabel: r.step === 0 ? 'Before Day 1' : labels[r.step], early, done, locked,
    ...(key === 'mgr_read_checkin' && r.checkin ? { pair: r.checkin.title } : copy?.pair ? { pair: copy.pair } : {}),
    ...(r.row.design?.how ? { how: r.row.design.how } : {}), ...(copy?.note ? { note: copy.note } : {}),
    ...(pill ? { pill } : {}),
    opens: waiting ? null : screen,
    canTick: viewer === 'team' && !waiting && !locked && (screen === null || screen === 'plain' || screen === 'meeting'),
    ...(meeting ? { agenda: (r.row.agenda ?? r.row.team?.agenda ?? []).map((a) => fillNames(a, first)) } : {}),
    ...(r.month ? { month: r.month } : {}), ...(r.checkin ? { checkinId: r.checkin.id } : {}), ...(r.doneByName && done ? { doneByName: r.doneByName } : {}),
  };
  if (viewer !== 'team' && r.dueOn) {
    view.dueOn = r.dueOn;
    if (!done && !locked) {
      if (r.step > p.step && !TEAM_EARLY.has(key)) view.pill = { text: labels[r.step] ?? 'Before Day 1', tone: 'grey' };
      else { const d = dueText(r.dueOn, p.today); view.due = { text: d.text, tone: d.tone }; view.late = d.late; }
    }
  }
  return view;
}

/** My rows for a joiner (roles' teammate rows and meetings), in step order. */
export function rowsFor(p: Placed, roles: TeamRole[]): PlacedRow[] {
  const mine = (r: PlacedRow) => !!r.role && roles.includes(r.role);
  // IT's access rows are one row ("Set up {p} accesses"), seeded as a teammate row of IT.
  return [...p.meetings.filter(mine), ...p.team.filter(mine)]
    .map((r, i) => ({ r, i })).sort((a, b) => a.r.step - b.r.step || a.r.row.order - b.r.row.order || a.i - b.i).map((x) => x.r);
}

// ─── Progress (View progress, and HR's / IT's "<first>’s onboarding") ───────

type Tone = 'ok' | 'todo' | 'warn' | 'soon';
export interface ListRow { title: string; meta?: string; status: string; tone: Tone; comingUp: boolean }

export async function progressOf(p: Placed, tasks: JourneyTask[], viewer: Viewer, names: Map<string, string>) {
  const j = p.j;
  const labels = stepLabels(p.months);
  const at = (step: number) => step <= Math.max(p.step, 1);
  const soon = (step: number): ListRow['status'] => (step >= 3 + p.months ? 'Confirmed' : labels[step] ?? 'Before Day 1');
  const people = await users().find({ userId: { $in: Object.values(p.people).filter(Boolean) as string[] } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  const nameOf = new Map(people.map((u) => [u.userId, u.name]));
  const lists: Record<'meet' | 'tasks' | 'ci' | 'watch' | 'tour' | 'dev' | 'prof', ListRow[]> = { meet: [], tasks: [], ci: [], watch: [], tour: [], dev: [], prof: [] };
  // Teams › View progress reads the joiner's own lists (MgrTeamsProto "her journey, read-only, from the same
  // pieces as her own screen"): this stage's rows and what is still open from an earlier one, then the next
  // stage that has any under COMING UP. HR and IT & admin keep the whole journey.
  const team = viewer === 'team';
  const confirmed = p.step >= 3 + p.months;
  // A row carried from an earlier stage stays (ticked and counted) until this stage ends, as on the joiner's own screen.
  const mine = (step: number, done: boolean, doneAt?: Date | string | null) =>
    (team ? step === Math.max(p.step, 1) || (!confirmed && carriedNow(j, Math.max(p.step, 1), p.months, step, done, doneAt)) : at(step));
  const nextStage = (steps: number[]) => { const later = steps.filter((x) => !at(x)); return later.length ? Math.min(...later) : null; };
  const monthlyNow = p.meetings.some((m) => !!m.row.design?.everyMonth && mine(m.step, m.done, m.doneAt));
  // A monthly meeting shows once: now, or else only its next time.
  let monthlyAhead = monthlyNow;
  const aheadMeetings = p.meetings.filter((m) => {
    if (at(m.step)) return false;
    if (!m.row.design?.everyMonth) return true;
    if (monthlyAhead) return false;
    monthlyAhead = true;
    return true;
  });
  const meetNext = nextStage(aheadMeetings.map((m) => m.step));
  for (const m of p.meetings) {
    const now = mine(m.step, m.done, m.doneAt);
    if (team && !now && !(aheadMeetings.includes(m) && m.step === meetNext)) continue;
    const who = p.people[m.role as keyof typeof p.people];
    lists.meet.push({ title: m.row.title, ...(who && nameOf.get(who) ? { meta: nameOf.get(who) } : {}), status: m.done ? 'Met' : now ? 'Not yet' : soon(m.step), tone: m.done ? 'ok' : now ? 'todo' : 'soon', comingUp: !now });
  }
  const design = joinerDesignTasks(j, tasks, p.design);
  const taskNext = nextStage(design.map(({ row }) => stepOfStage(row.design!.stage, p.months)));
  for (const { task, row } of design) {
    const s = stepOfStage(row.design!.stage, p.months);
    const isDone = task.status === 'done' || task.status === 'skipped';
    const now = mine(s, isDone, task.doneAt);
    if (team && !now && s !== taskNext) continue;
    lists.tasks.push({ title: row.title, status: isDone ? 'Done' : now ? 'To do' : soon(s), tone: isDone ? 'ok' : now ? 'todo' : 'soon', comingUp: !now });
  }
  for (const c of p.checkins.filter((x) => x.state !== 'closed')) lists.ci.push({ title: c.row.title, status: c.state === 'sent' ? 'Sent' : c.state === 'open' ? 'Not yet' : soon(c.step), tone: c.state === 'sent' ? 'ok' : c.state === 'open' ? 'todo' : 'soon', comingUp: c.state === 'locked' });
  // The watch list keeps everything so far (before Day 1: the pre-joining videos), then the next stage's.
  const watchNow = (w: PlacedRow) => (team ? (p.step === 0 ? w.row.design?.stage === 'pre' : w.step <= p.step) : at(w.step));
  const watchAll = [...p.watch, ...p.trainings];
  const watchLater = watchAll.filter((w) => !watchNow(w)).map((w) => w.step);
  const watchNext = watchLater.length ? Math.min(...watchLater) : null;
  for (const w of watchAll) {
    const now = watchNow(w);
    if (team && !now && w.step !== watchNext) continue;
    const m = w.row.design!.media;
    lists.watch.push({ title: w.row.title, ...(m?.type === 'pdf' ? { meta: 'PDF' } : m?.minutes ? { meta: `${m.minutes} min` } : {}), status: w.done ? (team ? 'Done' : 'Watched') : now ? 'Not yet' : soon(w.step), tone: w.done ? 'ok' : now ? 'todo' : 'soon', comingUp: !now });
  }
  const tourDone = new Set(j.tour?.done ?? []);
  const lessons = (p.design.settings.tourLessons ?? ['punch', 'missed', 'leave', 'overtime']).filter((k) => !k.startsWith('approve'));
  for (const [i, k] of lessons.entries()) {
    // Teams (MgrTeamsProto): on Day 1 only the first lesson is on; the rest come in Week 1.
    const later = team && p.step === 1 && i > 0 && !tourDone.has(k);
    lists.tour.push({ title: TOUR_TITLES[k] ?? k, status: tourDone.has(k) ? 'Done' : later ? labels[2] : team ? 'To do' : 'Not yet', tone: tourDone.has(k) ? 'ok' : later ? 'soon' : 'todo', comingUp: later });
  }
  const access = accessTasks(j, tasks, p.design);
  for (const t of access) {
    const ready = t.status === 'done' || t.status === 'skipped';
    const late = !ready && t.dueAt ? daysBetween(keyOfDay(t.dueAt), p.today) : 0;
    lists.dev.push({ title: t.title, status: ready ? 'Ready' : late > 0 ? `Waiting ${late} day${late === 1 ? '' : 's'}` : 'Setting up', tone: ready ? 'ok' : 'warn', comingUp: false });
  }
  const sections = sectionStates(j, await journeyDocumentsView(j.id));
  for (const k of PROFILE_SECTIONS) lists.prof.push({ title: appSectionTitle(k), status: sections[k] ? 'Done' : 'To do', tone: sections[k] ? 'ok' : 'todo', comingUp: false });
  const profilePct = Math.round((PROFILE_SECTIONS.filter((k) => sections[k]).length / PROFILE_SECTIONS.length) * 100);

  type Stat = { key: keyof typeof lists; title: string; done: number; total: number; unit: string; flag: { text: string; tone: 'ok' | 'warn' | 'todo' } };
  const count = (key: keyof typeof lists, okStatus: string[], all: boolean) => {
    const rows = lists[key].filter((r) => all || !r.comingUp);
    return { done: rows.filter((r) => okStatus.includes(r.status)).length, total: rows.length, pending: rows.filter((r) => !r.comingUp && !okStatus.includes(r.status)).length };
  };
  const TITLES = { meet: 'Meetings', ci: 'Check-ins', tasks: 'Tasks', watch: 'Watch list', tour: 'Sowaka tour', dev: 'Devices and accesses', prof: 'Profile' } as const;
  const UNITS = { meet: 'met', ci: 'sent', tasks: 'done', watch: 'watched', tour: 'lessons', dev: 'ready', prof: 'filled in' } as const;
  const OK: Record<keyof typeof lists, string[]> = { meet: ['Met'], ci: ['Sent'], tasks: ['Done'], watch: ['Watched', 'Done'], tour: ['Done'], dev: ['Ready'], prof: ['Done'] };
  const delayedAccess = lists.dev.find((r) => r.status.startsWith('Waiting'));
  const rows: Stat[] = [];
  if (viewer === 'team') {
    const teamFlag: Record<string, (n: number) => string> = { meet: (n) => `${n} to go`, ci: (n) => `${n} not sent`, tasks: (n) => `${n} not done`, watch: (n) => `${n} to watch`, tour: (n) => `${n} to go` };
    if (p.step === 0) {
      // Before Day 1 (MgrTeamsProto, Kavya): the videos to watch before joining, then devices and the profile.
      const watch = count('watch', OK.watch, true);
      if (watch.total) rows.push({ key: 'watch', title: TITLES.watch, done: watch.done, total: watch.total, unit: UNITS.watch, flag: watch.done === watch.total ? { text: 'Done', tone: 'ok' } : { text: teamFlag.watch(watch.total - watch.done), tone: 'todo' } });
      const dev = count('dev', OK.dev, true);
      if (dev.total) rows.push({ key: 'dev', title: TITLES.dev, done: dev.done, total: dev.total, unit: UNITS.dev, flag: dev.done === dev.total ? { text: 'Done', tone: 'ok' } : { text: `${dev.total - dev.done} setting up`, tone: 'warn' } });
      rows.push({ key: 'prof', title: TITLES.prof, done: profilePct, total: 100, unit: UNITS.prof, flag: profilePct === 100 ? { text: 'Done', tone: 'ok' } : { text: 'Not complete', tone: 'warn' } });
    } else {
      for (const key of ['meet', 'ci', 'tasks', 'watch', 'tour'] as const) {
        // The watch list counts what it lists, COMING UP too (MgrTeamsProto: "2/6 watched · 4 to watch").
        const c = count(key, OK[key], key === 'watch' || key === 'tour');
        if (!c.total) continue;
        rows.push({ key, title: TITLES[key], done: c.done, total: c.total, unit: UNITS[key], flag: c.done === c.total ? { text: 'Done', tone: 'ok' } : { text: teamFlag[key](c.total - c.done), tone: 'todo' } });
      }
      if (delayedAccess) {
        const c = count('dev', OK.dev, true);
        rows.push({ key: 'dev', title: TITLES.dev, done: c.done, total: c.total, unit: UNITS.dev, flag: { text: `${lists.dev.filter((r) => r.status.startsWith('Waiting')).length} delayed`, tone: 'warn' } });
      }
    }
  } else {
    rows.push({ key: 'prof', title: TITLES.prof, done: profilePct, total: 100, unit: 'complete', flag: profilePct === 100 ? { text: 'Done', tone: 'ok' } : { text: `${100 - profilePct}% to go`, tone: 'warn' } });
    for (const key of ['meet', 'tasks', 'ci', 'tour', 'watch', 'dev'] as const) {
      const c = count(key, OK[key], true);
      rows.push({ key, title: TITLES[key], done: c.done, total: c.total, unit: UNITS[key], flag: c.total && c.done === c.total ? { text: 'Done', tone: 'ok' } : c.pending ? { text: `${c.pending} pending`, tone: 'warn' } : { text: 'On track', tone: 'ok' } });
    }
  }
  void names;
  return { rows, lists, profilePct };
}

/** "On track", "Joining soon", "Confirmation due", or "n task(s) delayed" with the first one. */
export function statusOf(p: Placed, tasks: JourneyTask[], first: string) {
  const late = [...joinerDesignTasks(p.j, tasks, p.design).map((x) => ({ t: x.task, title: x.row.title })), ...accessTasks(p.j, tasks, p.design).map((t) => ({ t, title: t.title }))]
    .filter(({ t }) => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'locked' && !!t.dueAt && keyOfDay(t.dueAt) < p.today)
    .sort((a, b) => keyOfDay(a.t.dueAt!).localeCompare(keyOfDay(b.t.dueAt!)));
  if (late.length) {
    const firstLate = late[0];
    const owner = firstLate.t.ownerRole === 'it' ? 'IT' : firstLate.t.ownerRole === 'hr' ? 'HR' : first;
    return {
      status: { label: `${late.length} task${late.length === 1 ? '' : 's'} delayed`, warn: true },
      delayed: { title: firstLate.title, waitingDays: daysBetween(keyOfDay(firstLate.t.dueAt!), p.today), ownerLabel: owner },
    };
  }
  const label = p.step === 0 ? 'Joining soon' : p.step === 2 + p.months ? 'Confirmation due' : 'On track';
  return { status: { label, warn: false } };
}

/** The joiner's card at the top of every person page. */
export async function heroOf(p: Placed, me: Me, tasks: JourneyTask[]) {
  const j = p.j;
  const ids = [j.userId, j.managerUserId, j.buddyUserId].filter((x): x is string => !!x);
  const rows = await users().find<FaceFields & { name: string; designation?: string; department?: string; email?: string; location?: string }>(
    { userId: { $in: ids } }, { projection: { _id: 0, name: 1, designation: 1, department: 1, email: 1, location: 1, ...FACE_PROJECTION } },
  ).toArray();
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const person = j.userId ? byId.get(j.userId) : undefined;
  const name = person?.name ?? j.candidate?.name ?? '—';
  const first = firstOf(name);
  const photoUrl = person ? faceUrlOf(person) : null;
  const labels = stepLabels(p.months);
  const stepLabel = p.step === 0 && j.tj ? `Joins ${shortDay(j.tj)}` : labels[p.step];
  const s = statusOf(p, tasks, first);
  return {
    first,
    joiner: {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name, first, initials: initialsOf(name), ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      ...((j.department ?? person?.department) ? { department: j.department ?? person?.department } : {}),
      ...(j.location ? { location: j.location } : {}),
      ...((j.candidate?.workEmail ?? person?.email) ? { workEmail: j.candidate?.workEmail ?? person?.email } : {}),
      ...(j.tj ? { tj: j.tj } : {}),
      reportsTo: j.managerUserId === me.userId ? 'you' : byId.get(j.managerUserId ?? '')?.name ?? '',
      ...(j.buddyUserId ? { buddy: j.buddyUserId === me.userId ? 'you' : byId.get(j.buddyUserId)?.name ?? '' } : {}),
      stepLabel, plantStage: deriveJourney(j, tasks, new Date()).plant.stage, preboarding: !isJoined(j),
      ...s,
    },
    names: new Map(rows.map((r) => [r.userId, r.name])),
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** GET /lifecycle/team/joiners/:journeyId/page */
export async function teamJoinerPage(me: Me, journeyId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  const tasks = await tasksOf(j.id);
  const { first, joiner, names } = await heroOf(p, me, tasks);
  // Lane T (MgrMeeting, MgrSchedule, MgrWelcome): my own notes and the set time on my meeting rows,
  // and, for the manager, every Day-1 / Week-1 meeting with who it is with and its time.
  const own = await meetingNotes().find({ journeyId: j.id, userId: me.userId }, { projection: { _id: 0, rowId: 1, notes: 1 } }).toArray();
  const notesOf = new Map(own.map((n) => [n.rowId, n.notes]));
  const mine = rowsFor(p, link.roles).map((r) => {
    const v = rowView(r, p, tasks, first, 'team', names);
    if (r.row.design?.section === 'meeting') {
      v.notes = notesOf.get(`team:${r.rowKey}`) ?? [];
      const at = p.startsAt.get(r.rowKey);
      if (at) v.startsAt = at.toISOString();
    }
    // MgrWelcome / MgrFeed, opened again once done: what was sent, not a fresh draft.
    const sent = r.row.team?.key === 'mgr_welcome' ? j.meetUs?.managerNote?.text : r.row.team?.key === 'mgr_feed_intro' ? j.managerWelcome?.text : undefined;
    if (sent) v.sent = sent;
    return v;
  });
  const progress = await progressOf(p, tasks, 'team', names);
  const reporting = templateReporting(p.design.settings);
  let schedule: Array<{ rowKey: string; title: string; step: number; withName?: string; withInitials?: string; startsAt?: string }> | undefined;
  if (link.roles.includes('manager')) {
    const firstWeek = p.meetings.filter((m) => m.step === 1 || m.step === 2);
    const ids = [...new Set(firstWeek.map((m) => p.people[m.role as keyof typeof p.people]).filter((x): x is string => !!x))];
    const who = new Map((await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray()).map((u) => [u.userId, u.name]));
    schedule = firstWeek.map((m) => {
      const name = who.get(p.people[m.role as keyof typeof p.people] ?? '');
      const at = p.startsAt.get(m.rowKey);
      return { rowKey: m.rowKey, title: m.row.title, step: m.step, ...(name ? { withName: name, withInitials: initialsOf(name) } : {}), ...(at ? { startsAt: at.toISOString() } : {}) };
    });
  }
  // Reach out: a block only where its tap has somewhere to go. "Send a game" needs the company's Games tab;
  // before Day 1 the joiner has no app yet, so the welcome message is the manager's note on the portal.
  const company = await companies().findOne({ id: j.org }, { projection: { _id: 0, enabledTabs: 1 } });
  const games = !!company?.enabledTabs?.includes('games');
  const reachOut = isJoined(j)
    ? ['feed', ...(games ? ['game'] : []), 'announcement', 'team_post', 'chat']
    : [...(link.roles.includes('manager') ? ['welcome_message'] : []), 'announcement'];
  return {
    joiner: { ...joiner, step: p.step }, relation: link.rel, readOnly: !link.roles.length,
    card: { title: link.roles.length === 1 && link.roles[0] === 'buddy' ? `Help ${first} with` : `Your tasks for ${first}`, toDo: mine.filter((t) => !t.done && !t.locked && t.step <= p.step).length },
    tasks: mine,
    progress: { rows: progress.rows, ...(p.step === 0 && j.tj ? { joining: { on: j.tj, ...(j.day1Pass?.reportingTime ?? reporting?.time ? { time: j.day1Pass?.reportingTime ?? reporting?.time } : {}), ...(j.day1Pass?.place ?? reporting?.place ? { place: j.day1Pass?.place ?? reporting?.place } : {}) } } : {}) },
    lists: progress.lists,
    reachOut,
    ...(schedule ? { schedule } : {}),
  };
}

/** GET /lifecycle/team/joiners additions: initials, relation line, plant stage (FINAL-DESIGNS.md §4.3). */
export function listExtras(row: { name: string; relation: TeamRelation; managerName?: string; plant?: { stage: number } }): { initials: string; relationLine?: string; plantStage: number } {
  return {
    initials: initialsOf(row.name),
    ...(row.relation === 'buddy' ? { relationLine: 'You’re the buddy' } : row.relation === 'line' && row.managerName ? { relationLine: `Reports to ${row.managerName}` } : {}),
    plantStage: row.plant?.stage ?? 0,
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

function myRow(p: Placed, link: Link, rowKey: string): PlacedRow {
  const r = rowsFor(p, link.roles).find((x) => x.rowKey === rowKey);
  if (!r) throw new LifecycleError(404, 'Task not found');
  return r;
}

/** POST /lifecycle/team/joiners/:journeyId/rows/:rowId — a tick (meetings: the shared one). */
export async function teamRowAction(me: Me, journeyId: string, rowKey: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  const r = myRow(p, link, rowKey);
  const tasks = await tasksOf(j.id);
  const view = rowView(r, p, tasks, 'them', 'team', new Map());
  const tickable = view.canTick || view.opens === 'around' || view.opens === 'groups' || view.opens === 'plain';
  if (!tickable) throw new LifecycleError(409, 'This one is done from its own screen');
  if (view.locked) throw new LifecycleError(409, `This opens in ${view.stepLabel}`);
  if (body.action === 'done') await setRowTick(j.id, rowKey, me);
  else if (body.action === 'undo') await setRowTick(j.id, rowKey, null);
  else throw new LifecycleError(400, 'action is done or undo');
  return teamJoinerPage(me, journeyId);
}

/** PUT /lifecycle/team/joiners/:journeyId/rows/:rowId/notes — my own notes on a meeting's agenda. */
export async function teamRowNotes(me: Me, journeyId: string, rowKey: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  const r = myRow(p, link, rowKey);
  if (r.row.design?.section !== 'meeting') throw new LifecycleError(404, 'Meeting not found');
  return saveMeetingRowNotes(me, j, `team:${rowKey}`, body);
}

function requireRole(link: Link, role: TeamRole) {
  if (!link.roles.includes(role)) throw new LifecycleError(403, role === 'manager' ? 'Only their manager can do this' : role === 'head_of_department' ? 'Only the head of department approves' : 'Not yours to do');
}

/** GET /lifecycle/team/joiners/:journeyId/buddy-options */
export async function buddyOptions(me: Me, journeyId: string) {
  const { j, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const department = j.department ?? (j.userId ? (await users().findOne({ userId: j.userId }, { projection: { _id: 0, department: 1 } }))?.department : undefined);
  const filter: Record<string, unknown> = {
    org: j.org, userId: { $nin: [j.userId, j.managerUserId].filter(Boolean) }, hiddenFromDirectory: { $ne: true }, lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    $or: [{ managerUserId: j.managerUserId }, ...(department ? [{ department }] : [])],
  };
  const rows = await users().find<FaceFields & { name: string; designation?: string }>(filter as never, { projection: { _id: 0, name: 1, designation: 1, ...FACE_PROJECTION } }).sort({ name: 1 }).limit(50).toArray();
  return {
    options: rows.map((r) => ({ userId: r.userId, name: r.name, ...(r.designation ? { designation: r.designation } : {}), ...(faceUrlOf(r) ? { photoUrl: faceUrlOf(r)! } : {}) })),
    ...(j.buddyUserId ? { current: j.buddyUserId } : {}),
  };
}

/** POST /lifecycle/team/joiners/:journeyId/buddy `{ buddyUserId }` */
export async function assignBuddy(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const buddy = typeof body.buddyUserId === 'string' ? body.buddyUserId : '';
  if (!buddy || buddy === j.userId || buddy === j.managerUserId) throw new LifecycleError(400, 'Pick someone first');
  const found = await users().findOne({ org: j.org, userId: buddy, lifecycleStatus: { $nin: ['offboarded', 'terminated'] } } as never, { projection: { _id: 0, name: 1 } });
  if (!found) throw new LifecycleError(400, 'Pick someone who works here');
  await journeys().updateOne({ id: j.id }, { $set: { buddyUserId: buddy, updatedAt: new Date() } });
  await setRowTick(j.id, 'mgr_assign_buddy', me);
  return teamJoinerPage(me, journeyId);
}

/** POST /lifecycle/team/joiners/:journeyId/schedule `{ meetings: [{ rowKey, startsAt }] }` — Day 1 and Week 1 meetings. */
export async function scheduleMeetings(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  if (!Array.isArray(body.meetings) || !body.meetings.length) throw new LifecycleError(400, 'Pick a time for a meeting');
  const firstWeek = p.meetings.filter((m) => m.step === 1 || m.step === 2);
  for (const raw of body.meetings as Array<Record<string, unknown>>) {
    const m = firstWeek.find((x) => x.rowKey === raw?.rowKey);
    if (!m) throw new LifecycleError(400, 'Only Day 1 and Week 1 meetings are scheduled here');
    const at = new Date(String(raw.startsAt ?? ''));
    if (Number.isNaN(at.getTime())) throw new LifecycleError(400, `${m.row.title}: pick a time`);
    const owner = p.people[m.role as keyof typeof p.people];
    const attendees = [j.userId, owner].filter((x): x is string => !!x);
    await lifecycleMeetings().updateOne(
      { journeyId: j.id, rowKey: m.rowKey },
      { $set: { title: m.row.title, startsAt: at, attendeeUserIds: attendees, org: j.org }, $setOnInsert: { id: randomUUID(), journeyId: j.id, rowKey: m.rowKey } },
      { upsert: true },
    );
    const invite = { scenario: 'lifecycle_meeting_invite' as const, title: m.row.title, body: `${me.name} set a time: ${at.toISOString()}` };
    // The joiner: their home; HR / IT & admin: their person page; the buddy and others: the Teams person page.
    if (j.userId && j.userId !== me.userId) await tell([j.userId], { ...invite, destination: 'lifecycle_onboarding', data: { journeyId: j.id, rowKey: m.rowKey } });
    if (owner && owner !== me.userId && owner !== j.userId) {
      const target = teammatePushTarget(p.people, owner, m.role);
      await tell([owner], { ...invite, destination: target.destination, data: { journeyId: j.id, rowKey: m.rowKey, ...(target.as ? { as: target.as } : {}) } });
    }
  }
  const set = await lifecycleMeetings().countDocuments({ journeyId: j.id, rowKey: { $in: firstWeek.map((m) => m.rowKey) } });
  if (set >= firstWeek.length) await setRowTick(j.id, 'mgr_schedule', me);
  return teamJoinerPage(me, journeyId);
}

/** POST /lifecycle/team/joiners/:journeyId/welcome-message `{ text }` — the portal's Meet us note from the manager. */
export async function sendWelcomeMessage(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 1000) throw new LifecycleError(400, 'A message of up to 1000 characters');
  const now = new Date();
  await journeys().updateOne({ id: j.id }, { $set: { 'meetUs.managerNote': { kind: 'text', text, at: now }, updatedAt: now } });
  await setRowTick(j.id, 'mgr_welcome', me);
  if (j.userId) await tell([j.userId], { scenario: 'lifecycle_welcome_message', title: 'A message from your manager', body: text.slice(0, 140), data: { journeyId: j.id } });
  return teamJoinerPage(me, journeyId);
}

/** POST /lifecycle/team/joiners/:journeyId/feed `{ text }` — the welcome post on the feed. */
export async function introduceOnFeed(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  await postWelcome(me, j.id, body);
  await setRowTick(j.id, 'mgr_feed_intro', me);
  return teamJoinerPage(me, journeyId);
}

/** GET /lifecycle/team/joiners/:journeyId/goals/:month */
export async function teamGoals(me: Me, journeyId: string, monthRaw: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const month = Number(monthRaw);
  const row = await probationMonths().findOne({ journeyId: j.id, monthNo: month }, { projection: { _id: 0 } });
  if (!row) {
    const g = await goalsOfJourney(j, p, false);
    if (g.month !== month) throw new LifecycleError(404, 'No goals for that month');
  }
  const goals = (row?.goals ?? []).map((g, index) => ({
    index, text: g.text, ...(g.status ? { status: g.status } : {}), ...(g.note ? { note: g.note } : {}),
    ...(g.comment ? { comment: g.comment, ...(g.commentAt ? { commentAt: new Date(g.commentAt).toISOString() } : {}) } : {}),
  }));
  return { month, goals };
}

/** POST /lifecycle/team/joiners/:journeyId/goals/:month `{ comments: [{ index, text }] }` — "Send to <first>". */
export async function commentOnGoals(me: Me, journeyId: string, monthRaw: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const month = Number(monthRaw);
  const row = await probationMonths().findOne({ journeyId: j.id, monthNo: month });
  if (!row?.goals.length) throw new LifecycleError(404, 'No goals for that month');
  if (!Array.isArray(body.comments)) throw new LifecycleError(400, 'comments is a list');
  const now = new Date();
  const set: Record<string, unknown> = {};
  for (const c of body.comments as Array<Record<string, unknown>>) {
    const index = Number(c?.index);
    const text = typeof c?.text === 'string' ? c.text.trim().slice(0, 1000) : '';
    if (!Number.isInteger(index) || !row.goals[index]) throw new LifecycleError(400, 'A comment names a goal that is not there');
    if (!text) continue;
    set[`goals.${index}.comment`] = text;
    set[`goals.${index}.commentAt`] = now;
    set[`goals.${index}.commentByName`] = me.name;
  }
  if (!Object.keys(set).length) throw new LifecycleError(400, 'Write a comment');
  await probationMonths().updateOne({ id: row.id }, { $set: set });
  const key = p.team.find((r) => r.row.team?.key === 'mgr_goal_comments' && r.month === month)?.rowKey;
  if (key) await setRowTick(j.id, key, me);
  if (j.userId) await tell([j.userId], { scenario: 'lifecycle_goal_comments', title: 'Comments on your goals', body: `${me.name} commented on your Month ${month} goals.`, data: { journeyId: j.id, month: String(month) } });
  return teamGoals(me, journeyId, monthRaw);
}

/** GET /lifecycle/team/joiners/:journeyId/checkins/:checkinId — the manager reads what they answered. */
export async function teamCheckin(me: Me, journeyId: string, checkinId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const c = p.checkins.find((x) => x.row.id === checkinId);
  if (!c) throw new LifecycleError(404, 'Check-in not found');
  const read = !!j.teamTasks?.[`mgr_read_checkin@${checkinId}`];
  return {
    title: c.row.title, ...(c.answers ? { sentAt: c.answers.sentAt.toISOString() } : {}), state: read ? 'read' : c.answers ? 'ready' : 'waiting',
    questions: c.answers?.questions ?? (c.row.design!.questions ?? []), answers: c.answers?.answers ?? [],
  };
}

/** POST /lifecycle/team/joiners/:journeyId/checkins/:checkinId/read — "Mark as read". */
export async function markCheckinRead(me: Me, journeyId: string, checkinId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const c = p.checkins.find((x) => x.row.id === checkinId);
  if (!c?.answers) throw new LifecycleError(409, 'Nothing to read yet');
  await setRowTick(j.id, `mgr_read_checkin@${checkinId}`, me);
  return teamCheckin(me, journeyId, checkinId);
}

/** The facts the confirmation review and the approval show (MgrConfReview, HodApprove). */
async function probationFacts(j: Journey, p: Placed) {
  const months = await probationMonths().find({ journeyId: j.id }, { projection: { _id: 0, monthNo: 1, goals: 1 } }).toArray();
  const withGoals = months.filter((m) => m.goals.length);
  const met = withGoals.filter((m) => m.goals.every((g) => g.status === 'well')).length;
  const sent = p.checkins.filter((c) => c.state === 'sent').map((c) => c.row.title.replace(/ check-in$/, ''));
  const facts: Array<{ label: string; value: string }> = [];
  if (withGoals.length) facts.push({ label: 'Monthly goals', value: `Met in ${met} of ${withGoals.length} months` });
  facts.push({ label: 'Check-ins', value: sent.length ? `${sent.join(' and ')} sent` : 'None sent' });
  if (j.userId && j.tj) {
    const days = await reportDaysOfPerson(j.org, j.userId, j.tj, p.today).catch(() => null);
    const worked = (days?.days ?? []).filter((d) => d[4]);
    if (worked.length) facts.push({ label: 'Attendance', value: `On time on ${Math.round((worked.filter((d) => d[3] === 0).length / worked.length) * 100)}% of days` });
    const taken = await leaves().find({ userId: j.userId, status: 'approved', startDate: { $gte: new Date(`${j.tj}T00:00:00Z`) } } as never, { projection: { _id: 0, days: 1 } }).toArray();
    const total = taken.reduce((sum, l) => sum + (l.days ?? 0), 0);
    facts.push({ label: 'Leave taken', value: `${total} day${total === 1 ? '' : 's'}` });
  }
  const disc = p.meetings.find((m) => m.row.team?.key === 'mgr_confirmation');
  if (disc) facts.push({ label: 'Confirmation discussion', value: disc.done && disc.doneAt ? `Done on ${shortDay(new Date(disc.doneAt).toISOString().slice(0, 10))}` : 'Not yet' });
  return facts;
}

/** GET /lifecycle/team/joiners/:journeyId/review — the facts and who approves. */
export async function reviewView(me: Me, journeyId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  const approver = p.people.head_of_department ? await users().findOne({ userId: p.people.head_of_department }, { projection: { _id: 0, name: 1 } }) : null;
  const rec = j.probation?.recommendation;
  return {
    facts: await probationFacts(j, p), ...(approver ? { approverName: approver.name } : {}),
    ...(rec ? { sent: { outcome: rec.outcome, ...(rec.extendMonths ? { extendMonths: rec.extendMonths } : {}), ...(rec.review ?? {}), at: rec.at } } : {}),
  };
}

const cleanText = (v: unknown, label: string) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new LifecycleError(400, `${label} is needed`);
  return t.slice(0, 2000);
};

/** POST /lifecycle/team/joiners/:journeyId/review — the recommendation, to the head of department. */
export async function sendReview(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'manager');
  if (j.probation?.decision) throw new LifecycleError(409, 'HR has decided already');
  const a = j.probation?.hodApproval;
  if (a && a.outcome !== 'discuss') throw new LifecycleError(409, 'The head of department has answered already');
  const outcome = body.outcome === 'extend' ? 'extend' : body.outcome === 'confirm' ? 'confirm' : null;
  if (!outcome) throw new LifecycleError(400, 'outcome is confirm or extend');
  const extendMonths = outcome === 'extend' ? Number(body.extendMonths ?? 3) : undefined;
  if (extendMonths !== undefined && ![1, 2, 3].includes(extendMonths)) throw new LifecycleError(400, 'Extend by 1, 2 or 3 months');
  const review = { kpis: cleanText(body.kpis, 'How they did against their KPIs and goals'), strengths: cleanText(body.strengths, 'What they do well'), next: cleanText(body.next, 'What to work on next') };
  const at = new Date();
  await journeys().updateOne({ id: j.id }, {
    $set: { 'probation.recommendation': { outcome, ...(extendMonths ? { extendMonths } : {}), review, byUserId: me.userId, byName: me.name, at }, updatedAt: at },
    $unset: { 'probation.hodApproval': '' },
  });
  await setRowTick(j.id, 'mgr_confirmation_review', me);
  if (p.people.head_of_department) {
    await tell([p.people.head_of_department], { scenario: 'lifecycle_confirmation_review', title: 'A confirmation to approve', body: `${me.name} recommends: ${outcome === 'confirm' ? 'Confirm' : 'Extend'}.`, data: { journeyId: j.id } });
  }
  return teamJoinerPage(me, journeyId);
}

/** GET /lifecycle/team/joiners/:journeyId/approval (Final designs shape) */
export async function approvalViewV2(me: Me, journeyId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'head_of_department');
  const rec = j.probation?.recommendation;
  const a = j.probation?.hodApproval;
  return {
    state: a?.outcome === 'approved' ? 'approved' : a?.outcome === 'extended' ? 'extended' : rec ? 'ready' : 'waiting',
    ...(rec ? { recommendation: { byName: rec.byName ?? '', outcome: rec.outcome, ...(rec.extendMonths ? { extendMonths: rec.extendMonths } : {}), ...(rec.review ?? {}), ...(rec.note ? { note: rec.note } : {}), at: rec.at } } : {}),
    // HodApprove lists three: the monthly goals, the confirmation discussion (Done / Not yet) and attendance.
    facts: ((all) => ['Monthly goals', 'Confirmation discussion', 'Attendance']
      .map((label) => all.find((f) => f.label === label)).filter((f): f is { label: string; value: string } => !!f)
      .map((f) => (f.label === 'Confirmation discussion' && f.value.startsWith('Done') ? { ...f, value: 'Done' } : f)))(await probationFacts(j, p)),
    ...(a ? { answer: { outcome: a.outcome, ...(a.extendMonths ? { extendMonths: a.extendMonths } : {}), ...(a.comment ? { comment: a.comment } : {}), at: a.at, byName: a.byName } } : {}),
  };
}

/** POST /lifecycle/team/joiners/:journeyId/approval `{ action: 'approve' | 'extend', extendMonths?, comment? }` */
export async function answerApprovalV2(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, link } = await teamJourney(me, journeyId);
  requireRole(link, 'head_of_department');
  if (!j.probation?.recommendation) throw new LifecycleError(409, 'Waiting for the manager’s recommendation');
  if (j.probation?.decision) throw new LifecycleError(409, 'HR has decided already');
  const before = j.probation?.hodApproval;
  if (before && before.outcome !== 'discuss') throw new LifecycleError(409, 'Answered already');
  // Approve agrees with the manager's recommendation: when that is to extend, approving it extends (by their months).
  const rec = j.probation.recommendation;
  const approvesExtension = body.action === 'approve' && rec.outcome === 'extend';
  const outcome = body.action === 'approve' ? (approvesExtension ? 'extended' : 'approved') : body.action === 'extend' ? 'extended' : null;
  if (!outcome) throw new LifecycleError(400, 'action is approve or extend');
  const extendMonths = outcome === 'extended' ? Number((approvesExtension ? rec.extendMonths : body.extendMonths) ?? 3) : undefined;
  if (extendMonths !== undefined && ![1, 2, 3].includes(extendMonths)) throw new LifecycleError(400, 'Extend by 1, 2 or 3 months');
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
  const at = new Date();
  await journeys().updateOne({ id: j.id }, { $set: {
    'probation.hodApproval': { outcome, ...(extendMonths ? { extendMonths } : {}), ...(comment ? { comment } : {}), byUserId: me.userId, byName: me.name, at },
    'teamTasks.hod_approve': { doneAt: at, byUserId: me.userId, byName: me.name, outcome, ...(comment ? { note: comment } : {}) }, updatedAt: at,
  } });
  const joiner = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, hrPrimaryUserId: 1 } }) : null;
  const name = joiner?.name ?? j.candidate?.name ?? 'the joiner';
  const notify = [joiner?.hrPrimaryUserId, j.managerUserId].filter((x): x is string => !!x);
  await tell(notify, {
    scenario: 'lifecycle_confirmation_window_hr', title: `${name}’s confirmation`,
    body: outcome === 'approved' ? `${me.name} approved the confirmation.` : `${me.name} extended probation by ${extendMonths} month${extendMonths === 1 ? '' : 's'}.`,
    data: { journeyId: j.id },
  });
  return approvalViewV2(me, journeyId);
}

/** POST /lifecycle/team/joiners/:journeyId/senior-meeting `{ mode: 'one' | 'group', startsAt, journeyIds? }` */
export async function inviteSenior(me: Me, journeyId: string, body: Record<string, unknown>) {
  const { j, p, link } = await teamJourney(me, journeyId);
  if (!link.roles.includes('senior')) throw new LifecycleError(403, 'Not yours to do');
  const at = new Date(String(body.startsAt ?? ''));
  if (Number.isNaN(at.getTime())) throw new LifecycleError(400, 'Pick a time');
  const mode = body.mode === 'one' ? 'one' : 'group';
  const ids = mode === 'group' && Array.isArray(body.journeyIds) ? [...new Set([journeyId, ...body.journeyIds.map(String)])] : [journeyId];
  const row = p.team.find((r) => r.row.team?.key === 'senior_meet');
  const title = row ? row.row.title : 'Meet someone senior';
  for (const id of ids) {
    const other = id === journeyId ? { j, p, link } : await teamJourney(me, id);
    if (!other.link.roles.includes('senior')) throw new LifecycleError(403, 'One of them is not yours to meet');
    // The others are this week's new joiners; the row's own joiner can still be met later while the row is open.
    if (other.p.step < 1 || (id !== journeyId && other.p.step > 2)) throw new LifecycleError(409, 'Only new joiners in their first week');
    await lifecycleMeetings().updateOne(
      { journeyId: id, rowKey: 'senior_meet' },
      { $set: { title, startsAt: at, attendeeUserIds: [other.j.userId, me.userId].filter((x): x is string => !!x), org: j.org }, $setOnInsert: { id: randomUUID(), journeyId: id, rowKey: 'senior_meet' } },
      { upsert: true },
    );
    await setRowTick(id, 'senior_meet', me);
    if (other.j.userId) await tell([other.j.userId], { scenario: 'lifecycle_meeting_invite', destination: 'lifecycle_onboarding', title: `${me.name} would like to meet you`, body: at.toISOString(), data: { journeyId: id } });
  }
  return teamJoinerPage(me, journeyId);
}

