/**
 * The app's onboarding (A1–A12) for the joiner and the manager's joiner
 * screens (M0–M3), handover §5. Every date comes from the journey; the
 * engine owns task state, this file owns the app's records (week-1 reels,
 * intro post, people to meet, starter tasks, 1:1 notes, meetings, surveys).
 */
import { randomUUID } from 'node:crypto';
import {
  employeePaymentDetails, journeys, lifecycleMeetings, oneOnOneNotes, peopleToMeet, resignations, starterTasks, surveyResponses, users,
} from '../../config/db';
import type {
  AboutYou, IntroPost, Journey, JourneyTask, Meeting, OnboardingStage, SurveyKind, SystemTaskKey, Week1Reels,
} from '../../models/lifecycle.model';
import type { User } from '../../models/user.model';
import { createConnectPost } from '../connect.service';
import { saveMyDeclaration } from '../employeePayroll.declaration';
import { encryptField, fieldKeyConfigured, maskTail } from '../fieldCrypto';
import { policiesFor } from '../policy-document.service';
import { resolveProfilePhoto } from '../s3-connect-media.service';
import { logger } from '../../utils/logger';
import {
  addDaysKey, companyTimeZone, dateKeyOf, dayDate, daysBetween, humanDay, isDateKey, keyOfDay, probationMonthEnd, todayKey,
} from './dueRules';
import {
  ACTIVE_STATUSES, LifecycleError, OPEN_STATUSES, completeTask, deriveJourney, finishTaskById, isJoined, lifecycleEnabled,
  loadJourney, namesOf, refreshJourney, setTaskDue, stageName, taskLate, taskView, tasksOf, tell, totalProbationMonths, visibleTo,
  type TaskView,
} from './engine';
import { groupTasks, progressOf } from './board';
import { cleanGoals, checkinByJoiner, markRevealSeen, probationForJoiner, revealFor, updateMonthByManager } from './probation';

type Me = { userId: string; name: string; org: string };

const strip = <T extends object>(doc: T & { _id?: unknown }): T => {
  const { _id, ...rest } = doc;
  return rest as T;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

async function photoOf(user?: Pick<User, 'profilePhotoKey'> | null): Promise<string | undefined> {
  return user?.profilePhotoKey ? resolveProfilePhoto({ profilePhotoKey: user.profilePhotoKey }) : undefined;
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
    const derived = deriveJourney(j, await tasksOf(j.id), now);
    out.onboarding = { journeyId: j.id, stage: derived.stage, dayLabel: derived.dayLabel, plant: derived.plant, tileVisible: tileVisible(j) };
  }
  // MERGE (el/offboarding): replace this block with `out.offboarding = await offboardingMe(me.userId)`
  // from ./offboarding when that part lands; the lines below are the stand-in until then.
  const leaving = await journeys().find({ userId: me.userId, kind: 'offboarding', closedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(1).next();
  const resignation = await resignations().find({ userId: me.userId, status: { $ne: 'withdrawn' } }).sort({ submittedAt: -1 }).limit(1).next();
  if (leaving || (resignation && resignation.status !== 'accepted')) {
    const appPageFor = leaving?.templateSnapshot.settings.appPageFor ?? ['resignation', 'retirement', 'end_of_contract'];
    out.offboarding = {
      ...(leaving ? { journeyId: leaving.id } : {}),
      ...(resignation ? { resignationId: resignation.id } : {}),
      status: leaving?.status ?? resignation!.status,
      ...(leaving?.tl ? { tl: leaving.tl } : {}),
      pageVisible: !!leaving && (leaving.showAppPage ?? appPageFor.includes(leaving.exitType ?? 'resignation')),
    };
  }
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

function meetingView(m: Meeting, names: Map<string, string>) {
  return {
    id: m.id, title: m.title, startsAt: m.startsAt.toISOString(), ...(m.endsAt ? { endsAt: m.endsAt.toISOString() } : {}),
    ...(m.place ? { place: m.place } : {}), ...(m.link ? { link: m.link } : {}),
    attendees: m.attendeeUserIds.map((id) => ({ userId: id, name: names.get(id) ?? '' })),
    ...(m.met ? { met: m.met } : {}), ...(m.newTime ? { newTime: m.newTime.toISOString() } : {}),
    ...(m.journeyTaskId ? { taskId: m.journeyTaskId } : {}),
  };
}

const dueKey = (v: TaskView) => (v.dueAt ? v.dueAt.slice(0, 10) : '9999-12-31');

/** Up next: the next timed item if it starts within 2 h, else must-do → due soonest → not started. */
export function pickUpNext(open: TaskView[], meetings: Meeting[], now: Date): { view?: TaskView; meeting?: Meeting } {
  const soon = meetings
    .filter((m) => m.met !== 'yes' && m.startsAt.getTime() >= now.getTime() - 30 * 60_000 && m.startsAt.getTime() <= now.getTime() + 2 * 3_600_000)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (soon) return { view: open.find((v) => v.id === soon.journeyTaskId), meeting: soon };
  const candidates = open.filter((v) => v.status === 'todo' || v.status === 'sent_back');
  candidates.sort((a, b) => Number(b.mustDo) - Number(a.mustDo) || dueKey(a).localeCompare(dueKey(b)) || Number(a.status !== 'todo') - Number(b.status !== 'todo'));
  return { view: candidates[0] };
}

async function starterViews(j: Journey, names: Map<string, string>, now: Date): Promise<TaskView[]> {
  const today = todayKey(now, companyTimeZone(j.org));
  const rows = await starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray();
  return rows.map((s) => ({
    id: s.id, systemKey: 'starter_task' as const, phase: 'first_week' as const, title: s.title,
    helper: `From ${names.get(s.assignedByUserId) ?? 'your manager'}`, ownerRole: 'employee' as const, kind: 'assign' as const, surface: 'app' as const,
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
  // Their own tasks; finished pre-boarding steps stay behind on the portal.
  const mine = tasks.filter((t) => visibleTo('employee', t) && (t.phase !== 'pre_boarding' || ACTIVE_STATUSES.includes(t.status)));
  const views = mine.map((t) => taskView(t, j, names, now));
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
  const meetings = (await lifecycleMeetings().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ startsAt: 1 }).toArray()).map(strip);
  const open = views.filter((v) => ACTIVE_STATUSES.includes(v.status));
  const isDone = (v: TaskView) => v.status === 'done' || v.status === 'skipped';
  const locked = views.filter((v) => v.status === 'locked');
  const soonLocked = locked.filter((v) => v.opensAt && v.opensAt.slice(0, 10) <= weekEnd);
  const { view, meeting } = pickUpNext(open, meetings, now);
  const meetingNames = await namesOf(meetings.flatMap((m) => m.attendeeUserIds));
  const upNext = view || meeting
    ? { ...(view ?? {
      id: meeting!.id, phase: 'first_week' as const, title: meeting!.title, ownerRole: 'employee' as const, kind: 'meeting' as const,
      surface: 'app' as const, mustDo: false, status: 'todo' as const, dueAt: meeting!.startsAt.toISOString(), late: false,
    }), ...(meeting ? { meeting: meetingView(meeting, meetingNames) } : {}) }
    : undefined;
  const byDue = (a: TaskView, b: TaskView) => dueKey(a).localeCompare(dueKey(b));
  return {
    journeyId: j.id, stage: derived.stage, stageName: stageName(derived.stage), dayLabel: derived.dayLabel, tj: j.tj, plant: derived.plant,
    ...(upNext ? { upNext } : {}),
    today: [...open.sort(byDue), ...soonLocked.sort(byDue)],
    later: locked.filter((v) => !soonLocked.includes(v)).sort(byDue),
    done: views.filter(isDone).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    journey: stagesFor(j, derived.stage),
    meetings: meetings.map((m) => meetingView(m, meetingNames)),
    showWeekDone: !!j.tj && today >= addDaysKey(j.tj, 7) && !j.week1DoneSeenAt,
  };
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
  const uan = payment?.uanLast4 ? maskTail(payment.uanLast4) : about?.pf?.uan ? maskTail(about.pf.uan.slice(-4)) : undefined;
  return {
    ...(j.week1 ?? {}),
    policies: policies.map((p) => ({ id: p.key, title: p.title, version: p.updatedAt })),
    policiesAck: j.week1?.policies,
    bank: { masked: payment?.accountLast4 ? maskTail(payment.accountLast4) ?? '' : '', ...(payment?.bankName ? { bankName: payment.bankName } : {}), ...(payment?.ifsc ? { ifsc: payment.ifsc } : {}) },
    pf: { ...(uan ? { uan } : {}), ...(about?.pf?.firstJob ? { firstJob: true } : {}) },
    goals: j.probation?.goals ?? [],
    probationMonths: totalProbationMonths(j),
    ...(j.tj ? { goalsLockOn: addDaysKey(j.tj, 7) } : {}),
    ...(j.bankPfRequest ? { bankPfRequest: { status: j.bankPfRequest.status, requestedAt: j.bankPfRequest.requestedAt } } : {}),
  };
}

export async function saveWeek1Step(me: Me, body: Record<string, unknown>, device?: string) {
  const j = await joinerJourney(me.userId);
  const value = (body.value ?? {}) as Record<string, unknown>;
  const now = new Date();
  const tz = companyTimeZone(j.org);
  const week1: Week1Reels = { ...(j.week1 ?? {}) };
  const set: Partial<Journey> = {};
  let taxSavedToPayroll: boolean | undefined;
  switch (body.step) {
    case 'policies': {
      if (value.agreed !== true) throw new LifecycleError(400, 'Tick “I have read and agree” first');
      const policies = await policiesFor({ userId: me.userId, org: me.org });
      week1.policies = { versions: policies.map((p) => ({ id: p.key, version: p.updatedAt })), at: now, ...(device ? { device: device.slice(0, 200) } : {}) };
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
      } else if (value.confirm === true) {
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
  const photoKey = typeof body.photoKey === 'string' && body.photoKey.trim() ? body.photoKey.trim() : current?.photoKey;
  return { line, funFacts, ...(photoKey ? { photoKey } : {}) };
}

export async function introView(me: Me) {
  const j = await joinerJourney(me.userId);
  const user = await users().findOne({ userId: me.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1 } });
  return { ...(j.intro ?? { line: '', funFacts: [] }), name: user?.name ?? me.name, designation: j.designation ?? user?.designation, department: j.department ?? user?.department };
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
      message: `Hey everyone! ${intro.line} Excited to meet you all 🙌`,
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
  await tell([managerId], { scenario: 'lifecycle_intro_post', title: `${name} said hello`, body: `${name} posted their intro on Connect. Say hi 👋`, data: { journeyId: j.id, ...(postId ? { postId } : {}) } });
  return { ...(await introView(me)), ...(postId ? { connectPostId: postId } : {}) };
}

// ─── People to meet (A6) ────────────────────────────────────────────────────

async function peopleViews(journeyId: string) {
  const rows = (await peopleToMeet().find({ journeyId }, { projection: { _id: 0 } }).toArray()).map(strip);
  const folks = await users().find({ userId: { $in: rows.map((r) => r.personUserId) } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, profilePhotoKey: 1 } }).toArray();
  const by = new Map(folks.map((f) => [f.userId, f]));
  return Promise.all(rows.map(async (r) => {
    const person = by.get(r.personUserId);
    const photoUrl = await photoOf(person);
    return {
      id: r.id, userId: r.personUserId, name: person?.name ?? '—', ...(person?.designation ? { designation: person.designation } : {}),
      ...(photoUrl ? { photoUrl } : {}), ...(r.why ? { why: r.why } : {}), ...(r.metAt ? { metAt: r.metAt } : {}), ...(r.skippedAt ? { skippedAt: r.skippedAt } : {}),
    };
  }));
}

export async function peopleView(me: Me) {
  const j = await joinerJourney(me.userId);
  return { people: await peopleViews(j.id), ...(j.tj ? { meetBy: probationMonthEnd(j.tj, 1) } : {}) };
}

export async function actOnPerson(me: Me, id: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const row = await peopleToMeet().findOne({ id, journeyId: j.id });
  if (!row) throw new LifecycleError(404, 'Not on your list');
  if (body.action === 'met') await peopleToMeet().updateOne({ id }, { $set: { metAt: new Date() }, $unset: { skippedAt: '' } });
  else if (body.action === 'not_yet') await peopleToMeet().updateOne({ id }, { $set: { skippedAt: new Date() } });
  else throw new LifecycleError(400, 'action is met or not_yet');
  const all = await peopleToMeet().find({ journeyId: j.id }).toArray();
  if (all.length && all.every((p) => p.metAt)) await completeTask(j.id, 'people_to_meet', { userId: me.userId, name: me.name });
  return { people: await peopleViews(j.id) };
}

// ─── Starter tasks (A9, M2a, M3) ────────────────────────────────────────────

export async function starterTasksForJoiner(me: Me) {
  const j = await joinerJourney(me.userId);
  return { tasks: (await starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray()) };
}

export async function starterDone(me: Me, id: string, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const row = await starterTasks().findOne({ id, journeyId: j.id });
  if (!row) throw new LifecycleError(404, 'Starter task not found');
  if (!row.doneAt) {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    await starterTasks().updateOne({ id }, { $set: { doneAt: new Date(), ...(note ? { doneNote: note } : {}) } });
    await tell([row.assignedByUserId], { scenario: 'lifecycle_starter_task_done', title: `${me.name} finished a task`, body: row.title, data: { journeyId: j.id, starterTaskId: id } });
    const open = await starterTasks().countDocuments({ journeyId: j.id, doneAt: { $exists: false } });
    if (!open) await completeTask(j.id, 'starter_task', { userId: me.userId, name: me.name });
    else await refreshJourney(j.id);
  }
  return starterTasksForJoiner(me);
}

// ─── 1:1 notes (A10, M2b) ───────────────────────────────────────────────────

async function notesFor(journeyId: string, sharedOnly: boolean) {
  const rows = await oneOnOneNotes().find({ journeyId, ...(sharedOnly ? { shared: true } : {}) }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  const names = await namesOf(rows.flatMap((r) => [r.authorUserId, ...(r.replies ?? []).map((x) => x.byUserId)]));
  return rows.map((r) => ({
    id: r.id, authorUserId: r.authorUserId, authorName: names.get(r.authorUserId) ?? '', text: r.text, shared: r.shared,
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
    await tell([note.authorUserId], { scenario: 'lifecycle_note_reply', title: `${me.name} replied`, body: text.slice(0, 120), data: { journeyId: j.id, noteId: id } });
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
  const { m } = await myMeeting(me, id);
  return meetingView(m, await namesOf(m.attendeeUserIds));
}

export async function actOnMeeting(me: Me, id: string, body: Record<string, unknown>) {
  const { j, m } = await myMeeting(me, id);
  if (body.met === 'yes') {
    await lifecycleMeetings().updateOne({ id }, { $set: { met: 'yes' } });
    const task = m.journeyTaskId ? (await tasksOf(j.id)).find((t) => t.id === m.journeyTaskId) : undefined;
    if (task && OPEN_STATUSES.includes(task.status) && task.status !== 'locked') await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  } else if (body.met === 'moved') {
    const at = typeof body.newTime === 'string' ? new Date(body.newTime) : null;
    if (!at || Number.isNaN(at.getTime())) throw new LifecycleError(400, 'newTime is an ISO time');
    // Moved is not met: it is reminded and asked again at the new time.
    await lifecycleMeetings().updateOne({ id }, { $set: { met: 'moved', newTime: at, startsAt: at, endsAt: new Date(at.getTime() + 30 * 60_000) }, $unset: { remindedAt: '' } });
    await tell(m.attendeeUserIds.filter((u) => u !== me.userId), { scenario: 'lifecycle_meeting_moved', title: `${m.title} moved`, body: `New time: ${humanDay(dateKeyOf(at))}`, data: { journeyId: j.id, meetingId: id } });
  } else throw new LifecycleError(400, 'met is yes or moved');
  return meetingFor(me, id);
}

// ─── Surveys (A7) ───────────────────────────────────────────────────────────

/** The survey that is open now, else the next one coming. */
function currentSurvey(tasks: JourneyTask[]): { kind: SurveyKind; task?: JourneyTask } {
  const day7 = tasks.find((t) => t.systemKey === 'day7_survey' && t.status !== 'cancelled');
  const pulses = tasks.filter((t) => t.systemKey === 'pulse_survey' && t.status !== 'cancelled').sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
  const open = [day7, ...pulses].find((t) => t && (t.status === 'todo' || t.status === 'sent_back'));
  const pick = open ?? [day7, ...pulses].find((t) => t && t.status === 'locked') ?? pulses.at(-1) ?? day7;
  const kind: SurveyKind = !pick || pick.systemKey === 'day7_survey' ? 'day7' : pick.month === 3 ? 'm3' : 'm6';
  return { kind, task: pick };
}

export async function surveyView(me: Me) {
  const j = await joinerJourney(me.userId);
  const { kind, task } = currentSurvey(await tasksOf(j.id));
  const sent = !!(await surveyResponses().findOne({ journeyId: j.id, kind }, { projection: { _id: 1 } }));
  return { kind, open: !!task && (task.status === 'todo' || task.status === 'sent_back') && !sent, sent, ...(task?.opensAt ? { opensAt: task.opensAt } : {}), ...(task?.dueAt ? { dueAt: task.dueAt } : {}) };
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

export async function sendSurvey(me: Me, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  const tasks = await tasksOf(j.id);
  const { kind, task } = currentSurvey(tasks);
  if (!task || (task.status !== 'todo' && task.status !== 'sent_back')) throw new LifecycleError(409, 'No survey is open');
  const answers = cleanSurveyAnswers(body.answers);
  const user = await users().findOne({ userId: me.userId }, { projection: { _id: 0, department: 1 } });
  const now = new Date();
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

/** The manager's team summary: only with 3 or more answers, never a name. */
export async function surveySummaryFor(managerUserId: string): Promise<{ count: number; avg: number } | undefined> {
  const rows = await surveyResponses().find({ managerUserId, kind: { $in: ['day7', 'm3', 'm6'] } }, { projection: { _id: 0, answers: 1 } }).toArray();
  if (rows.length < 3) return undefined;
  const scores = rows.map((r) => Number(r.answers.q1)).filter((n) => Number.isFinite(n));
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  return { count: rows.length, avg };
}

// ─── Probation and the reveal (joiner) ──────────────────────────────────────

export async function probationForMe(me: Me) {
  const j = await joinerJourney(me.userId);
  return probationForJoiner(j.id);
}

export async function checkinForMe(me: Me, month: number, body: Record<string, unknown>) {
  const j = await joinerJourney(me.userId);
  return checkinByJoiner(j.id, me, month, body);
}

export async function revealForMe(me: Me) {
  const j = await joinerJourney(me.userId);
  const reveal = await revealFor(j.id);
  return { ...reveal, letterUrl: undefined as string | undefined };
}

export async function revealSeenForMe(me: Me) {
  const j = await joinerJourney(me.userId);
  return markRevealSeen(j.id, me);
}

// ─── Manager (M0–M3) ────────────────────────────────────────────────────────

const MANAGER_OWNED = ['manager', 'manager_employee', 'hr_manager'];

export async function joinersForManager(me: Me, now = new Date()) {
  const rows = (await journeys().find({
    org: me.org, kind: 'onboarding', managerUserId: me.userId, closedAt: { $exists: false },
    status: { $nin: ['draft', 'offer_sent', 'accepted', 'declined', 'expired', 'not_joining'] },
  }).toArray()).map(strip).filter((j) => !(j.status === 'confirmed' && j.probation?.decision?.revealedAt));
  const ids = rows.map((j) => j.id);
  const allTasks = await groupTasks(ids);
  const folks = await users().find({ userId: { $in: rows.map((j) => j.userId).filter((u): u is string => !!u) } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, profilePhotoKey: 1 } }).toArray();
  const by = new Map(folks.map((f) => [f.userId, f]));
  const out = await Promise.all(rows.map(async (j) => {
    const tasks = allTasks.get(j.id) ?? [];
    const today = todayKey(now, companyTimeZone(j.org));
    const derived = deriveJourney(j, tasks, now);
    const mineOpen = tasks.filter((t) => MANAGER_OWNED.includes(t.ownerRole) && ACTIVE_STATUSES.includes(t.status));
    const person = j.userId ? by.get(j.userId) : undefined;
    const photoUrl = await photoOf(person);
    return {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name: person?.name ?? j.candidate?.name ?? '—',
      ...(photoUrl ? { photoUrl } : {}), ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      dayLabel: derived.dayLabel, stage: derived.stage, plant: derived.plant,
      todayCount: mineOpen.filter((t) => !t.dueAt || keyOfDay(t.dueAt) <= today).length,
      overdue: mineOpen.filter((t) => taskLate(t, today)).length,
      preboarding: !isJoined(j), ...(j.tj ? { tj: j.tj } : {}),
    };
  }));
  out.sort((a, b) => b.overdue - a.overdue || b.todayCount - a.todayCount || (a.tj ?? '').localeCompare(b.tj ?? ''));
  return { joiners: out };
}

export async function joinerForManager(me: Me, journeyId: string, now = new Date()) {
  const j = await managedJourney(me.userId, journeyId);
  const tasks = await tasksOf(j.id);
  const derived = deriveJourney(j, tasks, now);
  const person = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, profilePhotoKey: 1 } }) : null;
  const names = await namesOf([j.userId, j.buddyUserId, ...tasks.map((t) => t.ownerUserId)]);
  const visible = tasks.filter((t) => visibleTo('manager', t));
  const [people, starters, notes, meetings, summary] = await Promise.all([
    peopleViews(j.id),
    starterTasks().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ assignedAt: 1 }).toArray(),
    notesFor(j.id, false),
    lifecycleMeetings().find({ journeyId: j.id }, { projection: { _id: 0 } }).sort({ startsAt: 1 }).toArray(),
    surveySummaryFor(me.userId),
  ]);
  const meetingNames = await namesOf(meetings.flatMap((m) => m.attendeeUserIds));
  const photoUrl = await photoOf(person);
  const own = tasks.filter((t) => visibleTo('employee', t));
  return {
    joiner: {
      journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name: person?.name ?? j.candidate?.name ?? '—', ...(photoUrl ? { photoUrl } : {}),
      ...((j.designation ?? person?.designation) ? { designation: j.designation ?? person?.designation } : {}),
      ...((j.department ?? person?.department) ? { department: j.department ?? person?.department } : {}),
      tj: j.tj, dayLabel: derived.dayLabel, stage: derived.stage, stageName: stageName(derived.stage), plant: derived.plant,
      preboarding: !isJoined(j), probationMonths: totalProbationMonths(j),
      ownProgress: { done: own.filter((t) => t.status === 'done' || t.status === 'skipped').length, total: own.filter((t) => t.status !== 'cancelled').length },
      progress: progressOf(tasks, derived.tab),
    },
    tasks: visible.map((t) => taskView(t, j, names, now)),
    setup: {
      people,
      ...(j.buddyUserId ? { buddy: { userId: j.buddyUserId, name: names.get(j.buddyUserId) ?? '' } } : {}),
      ...(j.meetUs?.managerNote ? { welcomeNote: j.meetUs.managerNote } : {}),
      goals: j.probation?.goals ?? [],
      goalsLocked: goalsLocked(j, now),
    },
    starterTasks: starters, notes, meetings: meetings.map((m) => meetingView(m, meetingNames)),
    ...(summary ? { surveySummary: summary } : {}),
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
      const x = (p ?? {}) as Record<string, unknown>;
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
  await tell([j.userId], { scenario: 'lifecycle_starter_task', title: `${me.name} gave you a starter task`, body: `${title}${dueAt ? ` · Due ${humanDay(keyOfDay(dueAt))}` : ''}`, data: { journeyId: j.id, starterTaskId: row.id } });
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
  await tell([j.userId], { scenario: 'lifecycle_starter_task_reply', title: `${me.name} replied`, body: text.slice(0, 120), data: { journeyId: j.id, starterTaskId: id } });
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
  if (shared) await tell([j.userId], { scenario: 'lifecycle_note_shared', title: `${me.name} shared notes from your 1:1`, body: 'Tap to read and reply', data: { journeyId: j.id, noteId: note.id } });
  return { note };
}

const MANAGER_SCREEN_KEYS = new Set<SystemTaskKey>(['starter_task', 'one_on_one_notes', 'probation_goals', 'monthly_goals', 'monthly_checkin', 'monthly_review', 'manager_setup', 'assign_buddy']);

export async function managerTaskDone(me: Me, journeyId: string, taskId: string, body: Record<string, unknown>) {
  const j = await managedJourney(me.userId, journeyId);
  if (body.action !== 'done') throw new LifecycleError(400, 'action is done');
  const task = (await tasksOf(j.id)).find((t) => t.id === taskId);
  if (!task || !MANAGER_OWNED.includes(task.ownerRole)) throw new LifecycleError(404, 'Task not found');
  if (task.systemKey && MANAGER_SCREEN_KEYS.has(task.systemKey)) throw new LifecycleError(409, 'This one is done from its own screen');
  const done = await finishTaskById(j.id, taskId, 'done', { userId: me.userId, name: me.name });
  return { task: taskView(done, j, await namesOf([done.ownerUserId])) };
}

export async function managerProbationMonth(me: Me, journeyId: string, month: number, body: Record<string, unknown>) {
  await managedJourney(me.userId, journeyId);
  return updateMonthByManager(journeyId, me, month, body);
}

export { daysBetween };
