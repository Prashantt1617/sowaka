/**
 * Onboarding · Final designs: one journey's design rows placed in time (step, due, opens), with the
 * people behind each role, read the same way by the joiner's app, the teammates', HR's and IT's.
 * FINAL-DESIGNS.md §1–§4.
 */
import { checkinAnswers, journeys, lifecycleMeetings, users } from '../../config/db';
import type { CheckinAnswers, Journey, JourneyTask, LifecycleTemplateSettings, MeetWith, TeamRole, TemplateTask } from '../../models/lifecycle.model';
import { checkinOpensDay, dueDayOf, opensDayOf, stepOfStage } from './designRules';
import { TEAM_APP_COPY } from './designSeed';
import { designOf, type JourneyDesign } from './design';
import { companyTimeZone, todayKey } from './dueRules';
import { isJoined, totalProbationMonths } from './engine';
import { approverOf, currentStep } from './teamTasks';

/** One placed row: a meeting or teammate row (expanded per month when every month), a check-in, a watch item. */
export interface PlacedRow {
  row: TemplateTask;
  /** The tick key on `journey.teamTasks` (`<key>` or `<key>@<month>`; check-in reads `mgr_read_checkin@<checkinId>`). */
  rowKey: string;
  month?: number;
  /** For a check-in read row: the check-in it reads. */
  checkin?: TemplateTask;
  step: number;
  /** YYYY-MM-DD; absent before the joining day is known. */
  dueOn?: string;
  opensOn?: string;
  role?: TeamRole;
  done: boolean;
  doneAt?: Date;
  doneByName?: string;
}

export interface People {
  manager?: string; buddy?: string; hr?: string; it?: string; senior?: string; head_of_department?: string;
}

/** Who does each role for this joiner (FINAL-DESIGNS.md §4.4). */
export async function peopleOf(j: Journey, settings: LifecycleTemplateSettings): Promise<People> {
  const [hod, joiner] = await Promise.all([
    approverOf(j),
    j.userId ? users().findOne({ userId: j.userId }, { projection: { _id: 0, hrPrimaryUserId: 1 } }) : Promise.resolve(null),
  ]);
  const a = settings.assignees ?? {};
  return {
    ...(j.managerUserId ? { manager: j.managerUserId } : {}),
    ...(j.buddyUserId ? { buddy: j.buddyUserId } : {}),
    hr: a.hrUserId ?? joiner?.hrPrimaryUserId ?? j.createdByUserId,
    ...(a.itUserId ? { it: a.itUserId } : {}),
    ...((a.seniorUserId ?? hod) ? { senior: a.seniorUserId ?? hod } : {}),
    ...(hod ? { head_of_department: hod } : {}),
  };
}

/**
 * Where a teammate's push about a joiner opens (FINAL-DESIGNS.md §4.4): HR and IT & admin work from
 * Actions › Onboarding, so theirs open their person page (`lifecycle_staff`, `as`); the manager, the
 * buddy, someone senior and the head of department open the Teams person page (`lifecycle_joiner`).
 * [role] is the row's when known; otherwise the role is read from who [userId] is to the joiner.
 */
export function teammatePushTarget(people: People, userId: string, role?: TeamRole): { destination: 'lifecycle_staff' | 'lifecycle_joiner'; as?: 'hr' | 'it' } {
  const team = (['manager', 'buddy', 'senior', 'head_of_department'] as const).some((r) => people[r] === userId);
  const staff = role === 'hr' || role === 'it' ? role
    : role || team ? undefined
      : people.hr === userId ? 'hr' : people.it === userId ? 'it' : undefined;
  return staff ? { destination: 'lifecycle_staff', as: staff } : { destination: 'lifecycle_joiner' };
}

export const roleOfRow = (row: TemplateTask): TeamRole | undefined =>
  row.design?.section === 'meeting' ? (row.design.meetWith as MeetWith) as TeamRole
    : row.design?.section === 'team' ? row.design.role : row.design?.section === 'access' ? (row.design.role === 'hr' ? 'hr' : 'it') : undefined;

export interface Placed {
  j: Journey;
  design: JourneyDesign;
  months: number;
  today: string;
  /** Where the joiner is (0 Before Day 1 … 3 + months Confirmed). */
  step: number;
  meetings: PlacedRow[];
  team: PlacedRow[];
  checkins: Array<PlacedRow & { answers?: CheckinAnswers; state: 'locked' | 'open' | 'sent' | 'closed' }>;
  watch: PlacedRow[];
  trainings: PlacedRow[];
  people: People;
  /** Times set for meetings (Schedule first-week meetings, the senior meeting), by row key. */
  startsAt: Map<string, Date>;
}

/** Everything a view needs to place a journey's design rows. */
export async function place(j: Journey, now = new Date(), design?: JourneyDesign): Promise<Placed> {
  const d = design ?? await designOf(j);
  const months = totalProbationMonths(j);
  const today = todayKey(now, companyTimeZone(j.org));
  const step = currentStep(j, today);
  const ticks = j.teamTasks ?? {};
  const [people, answers, times] = await Promise.all([
    peopleOf(j, d.settings),
    checkinAnswers().find({ journeyId: j.id }, { projection: { _id: 0 } }).toArray(),
    lifecycleMeetings().find({ journeyId: j.id, rowKey: { $exists: true } }, { projection: { _id: 0, rowKey: 1, startsAt: 1 } }).toArray(),
  ]);
  const startsAt = new Map(times.map((m) => [m.rowKey!, m.startsAt]));
  const tj = j.tj;
  const placed = (row: TemplateTask, rowKey: string, month?: number, extra: Partial<PlacedRow> = {}): PlacedRow => {
    const tick = ticks[rowKey];
    return {
      row, rowKey, ...(month ? { month } : {}), step: stepOfStage(row.design!.stage, months, month),
      ...(tj ? { dueOn: dueDayOf(row.design!, tj, months, month) } : {}),
      ...(tj && opensDayOf(row.design!, tj, months, month) ? { opensOn: opensDayOf(row.design!, tj, months, month) } : {}),
      ...(roleOfRow(row) ? { role: roleOfRow(row) } : {}),
      done: !!tick, ...(tick ? { doneAt: tick.doneAt, ...(tick.byName ? { doneByName: tick.byName } : {}) } : {}),
      ...extra,
    };
  };
  const expand = (row: TemplateTask): PlacedRow[] => {
    const key = row.team?.key ?? row.id;
    if (!row.design!.everyMonth) return [placed(row, key)];
    return Array.from({ length: months }, (_, i) => placed(row, `${key}@${i + 1}`, i + 1));
  };
  const of = (section: string) => d.rows.filter((r) => r.design!.section === section);
  const checkinRows = of('checkin');
  const team: PlacedRow[] = [];
  for (const row of of('team')) {
    if (row.team?.key === 'mgr_read_checkin') {
      // "Read their check-ins": one row per check-in the joiner sends before confirmation, at its step.
      for (const c of checkinRows.filter((c) => c.design!.stage !== 'fin')) {
        team.push(placed(row, `mgr_read_checkin@${c.id}`, undefined, {
          checkin: c, step: stepOfStage(c.design!.stage, months),
          ...(tj ? { dueOn: dueDayOf(c.design!, tj, months) } : {}),
        }));
      }
      continue;
    }
    team.push(...expand(row));
  }
  // IT & admin's (and HR's) accesses are one row each on their side: "Set up {p} accesses" (the access rows are the joiner's devices).
  for (const role of ['it', 'hr'] as const) {
    if (!of('access').some((r) => (r.design!.role === 'hr' ? 'hr' : 'it') === role)) continue;
    const key = `${role}_accesses`;
    const synthetic: TemplateTask = {
      id: `fd-${key}`, phase: 'first_week', title: 'Set up {p} accesses', ownerRole: role, kind: 'assign', surface: 'app', opensRule: null, dueRule: null,
      mustDo: false, enabled: true, order: Math.min(...of('access').map((r) => r.order)), team: { key, kind: 'task', early: true, pair: 'Devices and accesses' },
      design: { section: 'team', stage: 'w1', role },
    };
    team.push({ ...placed(synthetic, key), ...(tj ? { dueOn: dueDayOf({ section: 'access', stage: 'w1' }, tj, months) } : {}) });
  }
  const byCheckin = new Map(answers.map((a) => [a.checkinId, a]));
  const confirmed = j.status === 'confirmed' || j.probation?.decision?.outcome === 'confirm';
  const checkins = checkinRows.map((c) => {
    const fin = c.design!.stage === 'fin';
    const opens = tj ? checkinOpensDay(c.design!.stage, tj, months) : null;
    const sent = byCheckin.get(c.id);
    const state: 'locked' | 'open' | 'sent' = sent ? 'sent' : fin ? (confirmed ? 'open' : 'locked') : opens && isJoined(j) && today >= opens ? 'open' : 'locked';
    const base = placed(c, c.id, undefined, {
      step: fin ? 3 + months : stepOfStage(c.design!.stage, months),
      ...(opens ? { opensOn: opens } : {}), done: !!sent, ...(sent ? { doneAt: sent.sentAt } : {}),
    });
    return { ...base, ...(sent ? { answers: sent } : {}), state: state as 'locked' | 'open' | 'sent' | 'closed' };
  });
  // One check-in at a time, as the canvas draws it: an unsent one closes once the joiner has moved past its stage,
  // a later one opens or is sent, or the joiner is confirmed (Month 1 shows "Week 1 check-in · Done"-style history only).
  for (const c of checkins) {
    if (c.state !== 'open' || c.row.design?.stage === 'fin') continue;
    if (confirmed || step > c.step || checkins.some((x) => x !== c && x.step > c.step && (x.state === 'open' || x.state === 'sent'))) c.state = 'closed';
  }
  const watched = j.watched ?? {};
  const watchRow = (row: TemplateTask): PlacedRow => ({
    ...placed(row, row.id), step: row.design!.stage === 'pre' ? 1 : stepOfStage(row.design!.stage, months),
    done: !!watched[row.id], ...(watched[row.id] ? { doneAt: watched[row.id] } : {}),
  });
  return {
    j, design: d, months, today, step, people, startsAt,
    meetings: of('meeting').flatMap(expand),
    team,
    checkins,
    watch: of('watch').map(watchRow),
    trainings: of('training').map(watchRow),
  };
}

/** The joiner's access journey tasks (Devices and accesses), from the template rows they were made from. */
export function accessTasks(j: Pick<Journey, 'templateSnapshot'>, tasks: JourneyTask[], design?: Pick<JourneyDesign, 'rows'>): JourneyTask[] {
  const accessIds = new Set([...(j.templateSnapshot?.tasks ?? []), ...(design?.rows ?? [])].filter((t) => t.design?.section === 'access').map((t) => t.id));
  return tasks.filter((t) => accessIds.has(t.templateTaskId) && t.status !== 'cancelled');
}

/** The joiner's own design task journey tasks (Tasks). */
export function joinerDesignTasks(j: Pick<Journey, 'templateSnapshot'>, tasks: JourneyTask[], design?: Pick<JourneyDesign, 'rows'>): Array<{ task: JourneyTask; row: TemplateTask }> {
  // The journey's snapshot first (the task was made from it); a journey read without it (the board's kept copy) uses the template's.
  const rows = new Map([...(design?.rows ?? []), ...(j.templateSnapshot?.tasks ?? [])].filter((t) => t.design?.section === 'task').map((t) => [t.id, t]));
  return tasks.filter((t) => rows.has(t.templateTaskId) && t.status !== 'cancelled').map((task) => ({ task, row: rows.get(task.templateTaskId)! }));
}

/** First name ’s, and {n}/{p} filled. */
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || 'them';
export const fillNames = (text: string, first: string) => text.replace(/\{n\}/g, first).replace(/\{p\}/g, `${first}’s`);
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** A teammate row's words in the apps. */
export function teamRowTitle(p: PlacedRow, first: string): string {
  const key = p.row.team?.key ?? '';
  const copy = TEAM_APP_COPY[key];
  if (key === 'mgr_read_checkin' && p.checkin) return fillNames(`Read {p} ${p.checkin.title}`, first);
  if (p.row.design?.section === 'meeting') return p.row.title;
  return fillNames(copy?.title ?? p.row.title, first);
}

/** Writes one shared tick (meetings: the joiner's Mark as met and the teammate's Mark as done are the same). */
export async function setRowTick(journeyId: string, rowKey: string, by: { userId: string; name: string } | null, extra: Record<string, unknown> = {}): Promise<void> {
  const now = new Date();
  if (by) await journeys().updateOne({ id: journeyId }, { $set: { [`teamTasks.${rowKey}`]: { doneAt: now, byUserId: by.userId, byName: by.name, ...extra }, updatedAt: now } });
  else await journeys().updateOne({ id: journeyId }, { $unset: { [`teamTasks.${rowKey}`]: '' }, $set: { updatedAt: now } });
}
