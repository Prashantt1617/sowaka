/**
 * The HR onboarding board (H1, H1b, H1c): three phase tabs, a column per
 * step, a card per joiner with who it waits on, flags and progress; the side
 * panel; and HR's actions on a journey (manager, buddy, Day-1 pass, template,
 * a task, a bank/PF change).
 */
import { randomUUID } from 'node:crypto';
import { dateChangeRequests, journeys, journeyTasks, offers, surveyResponses, users } from '../../config/db';
import type {
  Day1Pass, Journey, JourneyFlag, JourneyTask, OnboardingBoardColumn, OnboardingBoardTab, OwnerRole, SurveyKind,
} from '../../models/lifecycle.model';
import { decryptField, fieldKeyConfigured } from '../fieldCrypto';
import { resolveProfilePhoto } from '../s3-connect-media.service';
import { setPaymentDetails } from '../employeePayment.service';
import { companyTimeZone, isDateKey, keyOfDay, todayKey } from './dueRules';
import {
  ACTIVE_STATUSES, AGENDA_TASK_KEYS, LifecycleError, deriveJourney, finishTaskById, guessAgendaTask, isCounted, isJoined, loadJourney, namesOf, reassignManager,
  refreshJourney, rematerialiseDraft, reopenTaskById, sanitiseJourney, syncDay1Meetings, taskLate, taskView, tasksOf, tell, completeTask,
  type AgendaTaskKey, type Derived, type TaskView,
} from './engine';
import { journeyDocumentsView } from './documents';
import { journeyLettersView } from './letters';
import { offerView } from './offers';
import { probationOf, sentDecisionLetter } from './probation';
import { templateForJourney } from './templates';
import { nudgedToday, nudgeTarget } from './nudges';

export const BOARD_COLUMNS: Record<OnboardingBoardTab, Array<{ key: OnboardingBoardColumn; label: string }>> = {
  pre_boarding: [
    { key: 'offer_sent', label: 'Offer sent' }, { key: 'accepted', label: 'Accepted' }, { key: 'documents', label: 'Documents' },
    { key: 'letters', label: 'Letters to sign' }, { key: 'ready_to_join', label: 'Ready to join' },
  ],
  first_week: [
    { key: 'day1', label: 'Day 1' }, { key: 'week1_tasks', label: 'Week-1 tasks' }, { key: 'day7_survey', label: 'Day-7 survey' }, { key: 'week_done', label: 'Week done' },
  ],
  probation: [
    { key: 'month1', label: 'Month 1' }, { key: 'months_2_5', label: 'Months 2–5' }, { key: 'final_month', label: 'Final month' }, { key: 'confirmed', label: 'Confirmed' },
  ],
};
const TABS: OnboardingBoardTab[] = ['pre_boarding', 'first_week', 'probation'];
const FILTERS = ['needs_you', 'late', 'needs_attention', 'quiet', 'joining_risk', 'due_soon', 'mine'] as const;
type QuickFilter = (typeof FILTERS)[number];
/** Confirmed joiners stay on the board this long. */
const CONFIRMED_DAYS = 30;

/** `taskId` and `canNudge` power the Nudge / Remind buttons; `nudgedToday` once one went out today. */
export interface WaitingOn { taskId: string; ownerRole: OwnerRole; ownerName?: string; title: string; dueAt?: string; late?: boolean; canNudge: boolean; nudgedToday?: boolean }

export interface BoardCard {
  journeyId: string; name: string; designation?: string; department?: string; managerName?: string; photoUrl?: string; tj?: string;
  dayLabel: string; status: Journey['status']; statusLabel: string; column: OnboardingBoardColumn; flags: JourneyFlag[];
  waitingOn: WaitingOn[]; progress: { done: number; total: number }; plant: Derived['plant'];
  quietDays?: number; expiresInDays?: number;
}

// ─── Who is asking ──────────────────────────────────────────────────────────

/** The tabs that carry pay, as the dashboard's `canSeePay` reads them (Payroll runs, Salary details). */
export const PAY_TABS = ['payruns', 'salarydetails'];

/**
 * What a dashboard user may see on a joiner. `seesPay`: an admin, someone
 * never limited to some tabs, or a payroll tab holder (the dashboard's
 * `canSeePay`). `seesDocuments`: HR, i.e. an admin, someone never limited, or
 * someone who also holds People › Employees; a holder of only the onboarding
 * tab (IT, Admin) sees each document's status, never the files.
 */
export interface PanelViewer { seesPay: boolean; seesDocuments: boolean }
export function lifecycleViewer(user: { dashboardAdmin?: boolean; dashboardTabs?: string[] } | undefined): PanelViewer {
  const all = user?.dashboardAdmin === true || !Array.isArray(user?.dashboardTabs);
  const tabs = new Set(user?.dashboardTabs ?? []);
  return { seesPay: all || PAY_TABS.some((t) => tabs.has(t)), seesDocuments: all || tabs.has('employees') };
}
export const FULL_VIEW: PanelViewer = { seesPay: true, seesDocuments: true };

/** A decision without its salary (pay is for payroll tab holders only). */
export function decisionWithoutPay<T extends { salary?: number } | undefined>(decision: T): T {
  if (!decision) return decision;
  const { salary: _s, ...rest } = decision as { salary?: number };
  return rest as T;
}

/** A journey as someone without pay access (or without HR's view) may see it. */
export function journeyForViewer<T extends Partial<Pick<Journey, 'probation' | 'aboutYou' | 'bankPfRequest'>>>(journey: T, viewer: PanelViewer): T {
  let out = journey;
  if (!viewer.seesPay && out.probation?.decision) out = { ...out, probation: { ...out.probation, decision: decisionWithoutPay(out.probation.decision) } };
  if (!viewer.seesDocuments) {
    // Emergency contact, PF and bank details are HR's, like the documents.
    const { aboutYou: _a, bankPfRequest: _b, ...rest } = out;
    out = rest as T;
  }
  return out;
}

async function markNudged(waiting: WaitingOn[], now: Date): Promise<void> {
  const done = await nudgedToday(waiting.filter((w) => w.canNudge).map((w) => w.taskId), now);
  for (const w of waiting) if (done.has(w.taskId)) w.nudgedToday = true;
}

const TAB_PHASE: Record<OnboardingBoardTab, JourneyTask['phase']> = { pre_boarding: 'pre_boarding', first_week: 'first_week', probation: 'probation' };

/** Who the journey waits on: open tasks, late first, then must-do, then by due date. */
export function waitingOnOf(j: Journey, tasks: JourneyTask[], names: Map<string, string>, now: Date, limit = 3): WaitingOn[] {
  const today = todayKey(now, companyTimeZone(j.org));
  const open = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status) && isCounted(t))
    // An upload in review waits on HR's review, not on the joiner.
    .filter((t) => !(t.status === 'in_review' && t.ownerRole === 'employee'))
    // Optional things with no date (asking for another joining day) are nobody's to wait on.
    .filter((t) => t.mustDo || !!t.dueAt);
  const due = (t: JourneyTask) => (t.dueAt ? keyOfDay(t.dueAt) : '9999-12-31');
  open.sort((a, b) => Number(taskLate(b, today)) - Number(taskLate(a, today)) || Number(b.mustDo) - Number(a.mustDo) || due(a).localeCompare(due(b)) || a.order - b.order);
  return open.slice(0, limit).map((t) => {
    const ownerName = t.ownerUserId ? names.get(t.ownerUserId) : t.ownerRole === 'employee' ? j.candidate?.name : undefined;
    return {
      taskId: t.id, ownerRole: t.ownerRole, ...(ownerName ? { ownerName } : {}), title: t.title,
      ...(t.dueAt ? { dueAt: t.dueAt.toISOString() } : {}), ...(taskLate(t, today) ? { late: true } : {}),
      canNudge: !('reason' in nudgeTarget(j, t)),
    };
  });
}

export function progressOf(tasks: JourneyTask[], tab: OnboardingBoardTab): { done: number; total: number } {
  const phase = tasks.filter((t) => t.phase === TAB_PHASE[tab] && isCounted(t));
  return { done: phase.filter((t) => t.status === 'done' || t.status === 'skipped').length, total: phase.length };
}

async function boardJourneys(org: string, now: Date): Promise<Journey[]> {
  const since = new Date(now.getTime() - CONFIRMED_DAYS * 86_400_000);
  const rows = await journeys().find({
    org, kind: 'onboarding', closedAt: { $exists: false },
    $or: [{ status: { $ne: 'confirmed' } }, { 'probation.decision.decidedAt': { $gte: since } }],
  }, { projection: { _id: 0, templateSnapshot: 1, id: 1, org: 1, kind: 1, userId: 1, candidate: 1, managerUserId: 1, buddyUserId: 1, templateId: 1, status: 1, stage: 1, tj: 1, anchors: 1, designation: 1, department: 1, location: 1, plant: 1, probation: 1, lastActivityAt: 1, createdAt: 1, createdByUserId: 1, updatedAt: 1 } }).toArray();
  return rows as Journey[];
}

async function validTills(ids: string[]): Promise<Map<string, string>> {
  const rows = await offers().find({ journeyId: { $in: ids } }, { projection: { _id: 0, journeyId: 1, versions: 1 } }).toArray();
  const out = new Map<string, string>();
  for (const row of rows) {
    const till = row.versions?.at(-1)?.fields?.validTill;
    if (till && isDateKey(till)) out.set(row.journeyId, till);
  }
  return out;
}

export async function groupTasks(ids: string[]): Promise<Map<string, JourneyTask[]>> {
  const rows = await journeyTasks().find({ journeyId: { $in: ids } }, { projection: { _id: 0 } }).sort({ order: 1, month: 1 }).toArray();
  const out = new Map<string, JourneyTask[]>();
  for (const row of rows) {
    const list = out.get(row.journeyId) ?? [];
    list.push(row);
    out.set(row.journeyId, list);
  }
  return out;
}

async function people(ids: Array<string | undefined>) {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (!list.length) return new Map<string, { name: string; designation?: string; department?: string; profilePhotoKey?: string }>();
  const rows = await users().find({ userId: { $in: list } }, { projection: { _id: 0, userId: 1, name: 1, designation: 1, department: 1, profilePhotoKey: 1 } }).toArray();
  return new Map(rows.map((row) => [row.userId, row]));
}

function cardFor(j: Journey, tasks: JourneyTask[], derived: Derived, names: Map<string, string>, now: Date, who?: { name: string; designation?: string; department?: string }, photoUrl?: string): BoardCard {
  const managerName = j.managerUserId ? names.get(j.managerUserId) : undefined;
  return {
    journeyId: j.id,
    name: who?.name ?? j.candidate?.name ?? '—',
    ...((j.designation ?? who?.designation) ? { designation: j.designation ?? who?.designation } : {}),
    ...((j.department ?? who?.department) ? { department: j.department ?? who?.department } : {}),
    ...(managerName ? { managerName } : {}), ...(photoUrl ? { photoUrl } : {}), ...(j.tj ? { tj: j.tj } : {}),
    dayLabel: derived.dayLabel, status: j.status, statusLabel: derived.statusLabel, column: derived.column, flags: derived.flags,
    waitingOn: waitingOnOf(j, tasks, names, now), progress: progressOf(tasks, derived.tab), plant: derived.plant,
    ...(derived.quietDays !== undefined ? { quietDays: derived.quietDays } : {}),
    ...(derived.expiresInDays !== undefined ? { expiresInDays: derived.expiresInDays } : {}),
  };
}

function matchesFilter(card: BoardCard, filter: QuickFilter, tasks: JourneyTask[], viewerUserId: string): boolean {
  switch (filter) {
    case 'needs_you': return card.flags.includes('needs_you');
    case 'late': return card.flags.includes('late');
    case 'needs_attention': return card.flags.includes('needs_attention');
    case 'quiet': return card.flags.includes('quiet');
    case 'joining_risk': return card.flags.includes('joining_risk');
    case 'due_soon': return card.flags.includes('due_soon');
    case 'mine': return card.waitingOn.some((w) => w.ownerRole === 'hr' || w.ownerRole === 'hr_manager')
      || tasks.some((t) => ACTIVE_STATUSES.includes(t.status) && t.ownerUserId === viewerUserId);
    default: return true;
  }
}

const URGENCY: JourneyFlag[] = ['late', 'needs_you', 'joining_risk', 'needs_attention', 'decide', 'quiet', 'expires_soon', 'due_soon'];
const urgency = (card: BoardCard) => {
  const i = card.flags.map((f) => URGENCY.indexOf(f)).filter((n) => n >= 0);
  return i.length ? Math.min(...i) : URGENCY.length;
};

export async function onboardingBoard(org: string, viewerUserId: string, query: Record<string, unknown>, now = new Date()) {
  const tab = (TABS.includes(query.tab as OnboardingBoardTab) ? query.tab : 'pre_boarding') as OnboardingBoardTab;
  const filter = query.filter ? String(query.filter) : '';
  if (filter && !FILTERS.includes(filter as QuickFilter)) throw new LifecycleError(400, `filter is one of ${FILTERS.join(', ')}`);
  const from = query.from ? String(query.from) : '';
  const to = query.to ? String(query.to) : '';
  if ((from && !isDateKey(from)) || (to && !isDateKey(to))) throw new LifecycleError(400, 'from and to are YYYY-MM-DD');
  const q = String(query.q ?? '').trim().toLowerCase();

  const all = await boardJourneys(org, now);
  const ids = all.map((j) => j.id);
  const [tasksBy, tills] = await Promise.all([groupTasks(ids), validTills(ids)]);
  const folks = await people(all.flatMap((j) => [j.userId, j.managerUserId]));
  const names = await namesOf([...all.flatMap((j) => [j.managerUserId, j.buddyUserId, j.userId]), ...[...tasksBy.values()].flat().map((t) => t.ownerUserId)]);

  const counts: Record<OnboardingBoardTab, number> = { pre_boarding: 0, first_week: 0, probation: 0 };
  const columns = BOARD_COLUMNS[tab].map((c) => ({ ...c, cards: [] as BoardCard[] }));
  for (const j of all) {
    if (from && (!j.tj || j.tj < from)) continue;
    if (to && (!j.tj || j.tj > to)) continue;
    const tasks = tasksBy.get(j.id) ?? [];
    const who = j.userId ? folks.get(j.userId) : undefined;
    const derived = deriveJourney(j, tasks, now, { offerValidTill: tills.get(j.id) });
    const managerName = j.managerUserId ? folks.get(j.managerUserId)?.name : undefined;
    if (q) {
      const hay = [who?.name, j.candidate?.name, j.designation, j.department, managerName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    counts[derived.tab] += 1;
    if (derived.tab !== tab) continue;
    const photoUrl = who?.profilePhotoKey ? await resolveProfilePhoto({ profilePhotoKey: who.profilePhotoKey }) : undefined;
    const card = cardFor(j, tasks, derived, names, now, who, photoUrl);
    if (filter && !matchesFilter(card, filter as QuickFilter, tasks, viewerUserId)) continue;
    columns.find((c) => c.key === derived.column)?.cards.push(card);
  }
  for (const column of columns) column.cards.sort((a, b) => urgency(a) - urgency(b) || (a.tj ?? '').localeCompare(b.tj ?? '') || a.name.localeCompare(b.name));
  await markNudged(columns.flatMap((c) => c.cards.flatMap((card) => card.waitingOn)), now);
  return { tab, columns, counts };
}

async function requireOnboarding(org: string, journeyId: string): Promise<Journey> {
  const j = await loadJourney(journeyId);
  if (j.org !== org) throw new LifecycleError(404, 'Journey not found');
  return j;
}

/**
 * The sidebar's Onboarding badge: joiners on the board that need HR now
 * (Needs you) or are late, each counted once.
 */
export async function onboardingCounts(org: string, now = new Date()) {
  const all = await boardJourneys(org, now);
  const ids = all.map((j) => j.id);
  const [tasksBy, tills] = await Promise.all([groupTasks(ids), validTills(ids)]);
  let needsYou = 0; let late = 0; let badge = 0;
  for (const j of all) {
    const { flags } = deriveJourney(j, tasksBy.get(j.id) ?? [], now, { offerValidTill: tills.get(j.id) });
    const ny = flags.includes('needs_you'); const lt = flags.includes('late');
    if (ny) needsYou += 1;
    if (lt) late += 1;
    if (ny || lt) badge += 1;
  }
  return { onboarding: { badge, needsYou, late } };
}

/**
 * The side panel (H1b). Without pay access the offer's CTC and the decision's
 * salary are left out; without HR's view the documents come as status only
 * (no files) and the About-you and bank/PF details are left out.
 */
export async function journeyPanel(org: string, journeyId: string, now = new Date(), viewer: PanelViewer = FULL_VIEW) {
  const j = await requireOnboarding(org, journeyId);
  if (j.kind !== 'onboarding') throw new LifecycleError(404, 'Journey not found');
  const tasks = await tasksOf(journeyId);
  const tills = await validTills([journeyId]);
  const derived = deriveJourney(j, tasks, now, { offerValidTill: tills.get(journeyId) });
  const names = await namesOf([j.managerUserId, j.buddyUserId, j.userId, ...tasks.map((t) => t.ownerUserId)]);
  const [documents, letters, offer, dateRequests, probation, batch] = await Promise.all([
    journeyDocumentsView(journeyId).then((docs) => (viewer.seesDocuments ? docs : docs.map(documentStatusOnly))),
    journeyLettersView(journeyId),
    offerView(journeyId, { hidePay: !viewer.seesPay }),
    dateChangeRequests().find({ journeyId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
    probationOf(journeyId),
    batchOf(j),
  ]);
  const journey = {
    ...journeyForViewer(sanitiseJourney(j), viewer),
    ...(j.managerUserId && names.get(j.managerUserId) ? { managerName: names.get(j.managerUserId) } : {}),
    ...(j.buddyUserId && names.get(j.buddyUserId) ? { buddyName: names.get(j.buddyUserId) } : {}),
    dayLabel: derived.dayLabel, statusLabel: derived.statusLabel, flags: derived.flags, column: derived.column, tab: derived.tab,
    stage: derived.stage, plant: derived.plant,
    waitingOn: waitingOnOf(j, tasks, names, now, 10), progress: progressOf(tasks, derived.tab),
  };
  await markNudged(journey.waitingOn, now);
  const nudged = await nudgedToday(tasks.map((t) => t.id), now);
  const views = tasks.map((t) => ({ ...taskView(t, j, names, now), canNudge: !('reason' in nudgeTarget(j, t)), ...(nudged.has(t.id) ? { nudgedToday: true } : {}) }));
  const probationView = viewer.seesPay ? probation : { ...probation, decision: decisionWithoutPay(probation.decision) };
  return { journey, tasks: views, documents, letters, offer, dateRequests, probation: probationView, batch, viewer };
}

/** A candidate document without its files: what someone outside HR may see. */
export function documentStatusOnly<T extends { fileIds: string[]; files: unknown[]; hrNote?: string }>(doc: T): T {
  const { hrNote: _n, ...rest } = doc;
  return { ...rest, fileIds: [], files: [] } as unknown as T;
}

/** Others joining on the same day ("6 people join with you"). */
export async function batchOf(j: Pick<Journey, 'id' | 'org' | 'tj'>): Promise<Array<{ journeyId: string; name: string }>> {
  if (!j.tj) return [];
  const rows = await journeys().find(
    { org: j.org, kind: 'onboarding', tj: j.tj, id: { $ne: j.id }, closedAt: { $exists: false }, status: { $nin: ['declined', 'expired', 'not_joining'] } },
    { projection: { _id: 0, id: 1, candidate: 1, userId: 1 } },
  ).toArray();
  const names = await namesOf(rows.map((r) => r.userId));
  return rows.map((r) => ({ journeyId: r.id, name: (r.userId && names.get(r.userId)) || r.candidate?.name || '—' }));
}

function cleanDay1Pass(input: unknown, previous?: Day1Pass): Day1Pass {
  if (!input || typeof input !== 'object') throw new LifecycleError(400, 'day1Pass must be an object');
  const p = input as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const out: Day1Pass = {};
  if (p.date !== undefined && p.date !== null && p.date !== '') {
    if (!isDateKey(p.date)) throw new LifecycleError(400, 'day1Pass.date is YYYY-MM-DD');
    out.date = p.date;
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (p.reportingTime !== undefined && p.reportingTime !== '') {
    if (typeof p.reportingTime !== 'string' || !time.test(p.reportingTime)) throw new LifecycleError(400, 'reportingTime is HH:mm');
    out.reportingTime = p.reportingTime;
  }
  for (const key of ['place', 'mapLink', 'meetingLink'] as const) { const v = text(p[key], 300); if (v) out[key] = v; }
  if (p.askFor && typeof p.askFor === 'object') {
    const a = p.askFor as Record<string, unknown>;
    const name = text(a.name, 120);
    if (name) out.askFor = { name, ...(text(a.phone, 20) ? { phone: text(a.phone, 20) } : {}) };
  }
  if (p.hrContact && typeof p.hrContact === 'object') {
    const h = p.hrContact as Record<string, unknown>;
    const name = text(h.name, 120);
    if (name) out.hrContact = { name, ...(text(h.email, 200) ? { email: text(h.email, 200) } : {}), ...(text(h.phone, 20) ? { phone: text(h.phone, 20) } : {}) };
  }
  if (Array.isArray(p.bring)) out.bring = p.bring.slice(0, 20).map((b) => text(b, 120)).filter((b): b is string => !!b);
  if (Array.isArray(p.agenda)) {
    out.agenda = p.agenda.slice(0, 20).map((raw, i) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      if (typeof a.time !== 'string' || !time.test(a.time)) throw new LifecycleError(400, `Agenda item ${i + 1}: time is HH:mm`);
      const title = text(a.title, 120);
      if (!title) throw new LifecycleError(400, `Agenda item ${i + 1}: a title is required`);
      // Each line keeps its own id (its meeting follows it). A line sent without one takes the id of the
      // same line already on the pass (time and title), else a new one.
      const before = previous?.agenda?.find((x) => x.time === a.time && x.title === title);
      const id = typeof a.id === 'string' && /^[\w-]{6,64}$/.test(a.id) ? a.id : before?.id ?? randomUUID();
      // The task it is: what HR picked; else what it was; else (a line from before) what its words say.
      let taskKey: AgendaTaskKey | null;
      if (a.taskKey === null || a.taskKey === '') taskKey = null;
      else if (a.taskKey !== undefined) {
        if (!AGENDA_TASK_KEYS.includes(a.taskKey as AgendaTaskKey)) throw new LifecycleError(400, `Agenda item ${i + 1}: taskKey is one of ${AGENDA_TASK_KEYS.join(', ')}, or null`);
        taskKey = a.taskKey as AgendaTaskKey;
      } else taskKey = before && before.taskKey !== undefined ? before.taskKey : guessAgendaTask(title) ?? null;
      return { id, time: a.time, title, ...(text(a.with, 120) ? { with: text(a.with, 120) } : {}), taskKey };
    });
    // One line per task: a second line naming the same task is just a meeting.
    const seen = new Set<string>();
    for (const line of out.agenda) { if (line.taskKey && seen.has(line.taskKey)) line.taskKey = null; else if (line.taskKey) seen.add(line.taskKey); }
  }
  return out;
}

/** PUT /admin/lifecycle/journeys/:id — manager, buddy, Day-1 pass, template (only before the offer is sent). */
export async function updateJourneyByHr(org: string, journeyId: string, body: Record<string, unknown>) {
  const j = await requireOnboarding(org, journeyId);
  const set: Partial<Journey> = { updatedAt: new Date() };
  const unset: Record<string, ''> = {};
  const colleague = async (userId: unknown, what: string) => {
    if (typeof userId !== 'string' || !userId) throw new LifecycleError(400, `${what} is a userId`);
    const found = await users().findOne({ userId, org }, { projection: { _id: 1 } });
    if (!found) throw new LifecycleError(400, `The ${what} is not someone at this company`);
    return userId;
  };
  if (body.managerUserId !== undefined) set.managerUserId = await colleague(body.managerUserId, 'manager');
  if (body.buddyUserId !== undefined) {
    if (body.buddyUserId === null || body.buddyUserId === '') unset.buddyUserId = '';
    else set.buddyUserId = await colleague(body.buddyUserId, 'buddy');
  }
  if (body.day1Pass !== undefined) set.day1Pass = cleanDay1Pass(body.day1Pass, j.day1Pass);
  let rematerialise = false;
  if (body.templateId !== undefined) {
    if (j.status !== 'draft') throw new LifecycleError(409, 'The template can only change before the offer is sent');
    const template = await templateForJourney(org, 'onboarding', String(body.templateId));
    set.templateId = template.id;
    set.templateSnapshot = structuredClone({ name: template.name, settings: template.settings, tasks: template.tasks });
    set.probation = { months: template.settings.probationMonths ?? 6 };
    rematerialise = true;
  }
  await journeys().updateOne({ id: journeyId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  if (set.managerUserId && set.managerUserId !== j.managerUserId) await reassignManager(journeyId, set.managerUserId, j.managerUserId);
  if (set.buddyUserId) await completeTask(journeyId, 'assign_buddy', { name: 'HR' });
  if (rematerialise) await rematerialiseDraft(journeyId);
  if (set.day1Pass || (set.managerUserId && set.managerUserId !== j.managerUserId)) await syncDay1Meetings(journeyId);
  const fresh = await refreshJourney(journeyId);
  return { journey: sanitiseJourney(fresh) };
}

/** POST /admin/lifecycle/journeys/:id/tasks/:taskId — done, reopen or skip, by HR. */
export async function actOnTaskByHr(org: string, journeyId: string, taskId: string, body: Record<string, unknown>, hr: { userId: string; name: string }): Promise<TaskView> {
  const j = await requireOnboarding(org, journeyId);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : undefined;
  let task: JourneyTask;
  if (body.action === 'done') {
    // The letter task is the reveal's trigger and its "Read your letter": it is done by sending the
    // letter from Documents, never by a tick alone (a tick gave a reveal with no letter to read).
    const target = await journeyTasks().findOne({ id: taskId, journeyId }, { projection: { _id: 0, systemKey: 1, status: 1 } });
    if (target?.systemKey === 'confirmation_letter' && target.status !== 'done') {
      const letterId = await sentDecisionLetter(j);
      if (!letterId) throw new LifecycleError(409, 'Send the letter from Documents first: the joiner’s reveal opens with it');
      await journeys().updateOne({ id: journeyId }, { $set: { 'probation.decision.letterId': letterId } });
    }
  }
  if (body.action === 'done' || body.action === 'skip') task = await finishTaskById(journeyId, taskId, body.action, hr, note);
  else if (body.action === 'reopen') task = await reopenTaskById(journeyId, taskId, note);
  else throw new LifecycleError(400, 'action is done, reopen or skip');
  const names = await namesOf([task.ownerUserId]);
  return taskView(task, j, names);
}

/** GET /admin/lifecycle/surveys — HR only: every answer with the person's name. */
export async function surveyAnswers(org: string, kind?: unknown) {
  const kinds: SurveyKind[] = ['day7', 'm3', 'm6'];
  if (kind !== undefined && kind !== '' && !kinds.includes(kind as SurveyKind)) throw new LifecycleError(400, 'kind is day7, m3 or m6');
  const rows = await surveyResponses().find({ org, kind: kind ? (kind as SurveyKind) : { $in: kinds } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
  const names = await namesOf(rows.map((r) => r.userId));
  return { responses: rows.map((r) => ({ id: r.id, kind: r.kind, journeyId: r.journeyId, name: (r.userId && names.get(r.userId)) || '—', answers: r.answers, createdAt: r.createdAt })) };
}

/** HR decides a bank/PF change the joiner asked for in the week-1 reel. Approving writes it to payroll (payroll access needed). */
export async function decideBankPfRequest(org: string, journeyId: string, body: Record<string, unknown>, hr: { userId: string; name: string }, viewer: PanelViewer = FULL_VIEW) {
  if (!viewer.seesPay) throw new LifecycleError(403, 'Only someone with payroll access can decide a bank or PF change');
  const j = await requireOnboarding(org, journeyId);
  const request = j.bankPfRequest;
  if (!request || request.status !== 'pending') throw new LifecycleError(409, 'No change is waiting');
  if (body.decision !== 'approve' && body.decision !== 'decline') throw new LifecycleError(400, 'decision is approve or decline');
  if (!j.userId) throw new LifecycleError(409, 'They have not joined yet');
  if (body.decision === 'approve') {
    const fields: Record<string, unknown> = {};
    if (request.changes.bankName) fields.bankName = request.changes.bankName;
    if (request.changes.ifsc) fields.ifsc = request.changes.ifsc;
    if (fieldKeyConfigured()) {
      if (request.changes.accountNumberEnc) fields.accountNumber = decryptField(request.changes.accountNumberEnc);
      if (request.changes.uanEnc) fields.uan = decryptField(request.changes.uanEnc);
    }
    if (Object.keys(fields).length) await setPaymentDetails(hr.userId, j.userId, fields);
  }
  const hrNote = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined;
  await journeys().updateOne({ id: journeyId }, { $set: {
    'bankPfRequest.status': body.decision === 'approve' ? 'approved' : 'declined',
    'bankPfRequest.decidedAt': new Date(), 'bankPfRequest.decidedByName': hr.name, ...(hrNote ? { 'bankPfRequest.hrNote': hrNote } : {}),
  } });
  await tell([j.userId], {
    scenario: 'lifecycle_bank_pf_decided', destination: 'lifecycle_week1', title: body.decision === 'approve' ? 'Bank and PF details updated' : 'Bank and PF change declined',
    body: body.decision === 'approve' ? 'HR approved the change you asked for.' : `HR did not make the change${hrNote ? `: ${hrNote}` : ''}.`, data: { journeyId },
  });
  return { journey: sanitiseJourney(await loadJourney(journeyId)) };
}

export { isJoined };
