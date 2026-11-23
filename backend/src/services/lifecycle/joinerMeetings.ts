/**
 * The joiner's Meetings (new-joiner prototype of 20 Nov, "People to meet" and "A meeting: agenda
 * and your notes"): one row per meeting, whatever record it lives on, so the joiner, the manager's
 * team side and HR read the same tick.
 *
 * - A journey task that is a meeting (a meeting, a check-in, the confirmation discussion): its
 *   status is the tick (HR's joiner panel and the manager's team side read it). The joiner marks it
 *   met when the engine lets them finish it; HR's and the product-driven ones (a check-in is done
 *   from its check-in) show their state read-only.
 * - A team meeting with a joiner side (`TemplateTask.team.pair`, e.g. the buddy's "Meet {n} on Day
 *   1" ↔ "Your buddy"): `team:<key>`, ticked on `journey.teamTasks` (teamTasks.ts), the record the
 *   buddy's or head of department's Teams › Joiners page reads.
 * - Someone the manager picked to meet (lifecycle_people_to_meet): `person:<id>`, its `metAt`.
 *
 * The agenda is the template's (`TemplateTask.agenda`, HR edits it in Templates; the seed's for an
 * older template) and is the same list the manager's meeting screen shows. The joiner's notes on it
 * are theirs alone (lifecycle_meeting_notes, never read by an HR or manager view).
 */
import { lifecycleMeetings, lifecycleTemplates, meetingNotes, peopleToMeet, users } from '../../config/db';
import type { Journey, JourneyTask, OwnerRole, TemplateTask } from '../../models/lifecycle.model';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { addDaysKey, dayDate, probationMonthEnd, probationMonthStart } from './dueRules';
import { LifecycleError, completeTask, finishTaskById, joinerSeesReadOnly, tasksOf, visibleTo, type TaskView } from './engine';
import { ONBOARDING_SEED } from './seed';
import { approverOf, setTick, teamDefsFor, type TeamTaskDef } from './teamTasks';
import { place, setRowTick, type PlacedRow } from './designRows';

type Me = { userId: string; name: string; org: string };

/** What the joiner's meeting screen needs on top of a task row. */
export interface MeetingRowFields {
  /** The agenda points, in order. */
  agenda: string[];
  /** Who it is with ("Sunny Kapoor", "Sunny Kapoor and Ritu Sharma"). */
  withName?: string;
  withUserId?: string;
  withPhotoUrl?: string;
  /** Whether the joiner can mark it met (else its tick is someone else's). */
  canTick: boolean;
  /** The joiner's own notes, one per agenda point. */
  myNotes?: string[];
}

export type MeetingRow = TaskView & MeetingRowFields & { meetingRow: true };

/** Product-driven journey tasks: finished from their own screen, never from a tick. */
const DONE_ELSEWHERE = new Set(['monthly_checkin', 'people_to_meet', 'confirmation_reveal']);

/** A journey task the Meetings list shows (People to meet is shown as its people). */
export const isMeetingTask = (t: Pick<JourneyTask, 'kind' | 'systemKey'>) =>
  (t.kind === 'meeting' || t.kind === 'checkin' || t.systemKey === 'confirmation_discussion') && t.systemKey !== 'people_to_meet';

/** The joiner may tick a journey meeting: their own (or shared) one, open, not driven by a screen. */
export const joinerMayTick = (t: JourneyTask) =>
  visibleTo('employee', t) && !(t.systemKey && DONE_ELSEWHERE.has(t.systemKey)) && (t.status === 'todo' || t.status === 'sent_back');

/** Team wording said to the joiner: "{n} is" → "you’re", "{p}" → "your", "{n}" → "you". */
export const forJoiner = (text: string) =>
  text.replace(/\{n\} is\b/g, 'you’re').replace(/\{p\}/g, 'your').replace(/\{n\}/g, 'you');

/**
 * The agenda of each of a journey's tasks: the template's row as it is now (HR's edits apply at
 * once), else the journey's snapshot, else the seed's for its systemKey.
 */
export async function agendaResolver(j: Pick<Journey, 'org' | 'templateId' | 'templateSnapshot'>): Promise<(t: Pick<JourneyTask, 'templateTaskId' | 'systemKey'>) => string[]> {
  // A Final-designs journey reads its own copy only (a template edit reaches new joiners only; design.ts designOf).
  const design = (j.templateSnapshot?.tasks ?? []).some((t) => !!t.design);
  const template = !design && j.templateId ? await lifecycleTemplates().findOne({ org: j.org, id: j.templateId }, { projection: { _id: 0, tasks: 1 } }) : null;
  const rows = new Map<string, TemplateTask>();
  for (const t of j.templateSnapshot?.tasks ?? []) rows.set(t.id, t);
  for (const t of template?.tasks ?? []) rows.set(t.id, t);
  return (t) => {
    const own = rows.get(t.templateTaskId)?.agenda;
    if (own?.length) return [...own];
    const seed = t.systemKey ? ONBOARDING_SEED.find((s) => s.systemKey === t.systemKey)?.agenda : undefined;
    return seed ? [...seed] : [];
  };
}

type Person = { userId: string; name: string; photoUrl?: string; designation?: string };

async function peopleById(ids: Array<string | undefined>): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await users().find<FaceFields & { name: string; designation?: string }>({ userId: { $in: list } }, { projection: { _id: 0, name: 1, designation: 1, ...FACE_PROJECTION } }).toArray();
  return new Map(rows.map((r) => {
    const photoUrl = faceUrlOf(r);
    return [r.userId, { userId: r.userId, name: r.name, ...(photoUrl ? { photoUrl } : {}), ...(r.designation ? { designation: r.designation } : {}) }];
  }));
}

/** When a team row falls for the joiner's lists: its phase and date, or its probation month. */
function placeOf(d: TeamTaskDef, tj?: string): Pick<TaskView, 'phase' | 'dueAt' | 'month'> {
  const rule = d.dueRule;
  if (!rule) return { phase: 'probation', dueAt: null };
  if (rule.anchor === 'tj') {
    const offset = rule.offset ?? 0;
    return { phase: offset < 0 ? 'pre_boarding' : 'first_week', dueAt: tj ? dayDate(addDaysKey(tj, offset)).toISOString() : null };
  }
  if (rule.anchor === 'month_start' || rule.anchor === 'month_end') {
    const m = rule.month === 'last' ? undefined : Array.isArray(rule.month) ? rule.month[0] : typeof rule.month === 'number' ? rule.month : 1;
    const day = tj && m ? (rule.anchor === 'month_end' ? probationMonthEnd(tj, m) : probationMonthStart(tj, m)) : undefined;
    return { phase: 'probation', ...(m ? { month: m } : {}), dueAt: day ? dayDate(day).toISOString() : null };
  }
  return { phase: 'pre_boarding', dueAt: null };
}

/** Who a journey meeting is with, by who does it. */
function withOf(t: JourneyTask, people: Map<string, Person>, j: Journey, hrUserId?: string): Person | undefined {
  if (t.ownerUserId && people.get(t.ownerUserId)) return people.get(t.ownerUserId);
  const manager = j.managerUserId ? people.get(j.managerUserId) : undefined;
  const hr = hrUserId ? people.get(hrUserId) : undefined;
  const byOwner: Partial<Record<OwnerRole, Person | undefined>> = {
    manager, manager_employee: manager, hr, buddy: j.buddyUserId ? people.get(j.buddyUserId) : undefined,
    hr_manager: manager && hr ? { userId: manager.userId, name: `${manager.name} and ${hr.name}`, ...(manager.photoUrl ? { photoUrl: manager.photoUrl } : {}) } : (manager ?? hr),
  };
  return byOwner[t.ownerRole];
}

/**
 * The joiner's meeting rows: the fields to add to their journey meeting tasks (by task id), and the
 * rows that are not journey tasks (team meetings with a joiner side, the people the manager picked).
 */
export async function joinerMeetingRows(j: Journey, tasks: JourneyTask[]): Promise<{ extra: Map<string, MeetingRowFields>; rows: MeetingRow[] }> {
  const [agendaOf, defs, approver, joiner, picked, notes, meetings] = await Promise.all([
    agendaResolver(j),
    teamDefsFor(j),
    approverOf(j),
    j.userId ? users().findOne({ userId: j.userId }, { projection: { _id: 0, hrPrimaryUserId: 1 } }) : Promise.resolve(null),
    peopleToMeet().find({ journeyId: j.id }, { projection: { _id: 0 } }).toArray(),
    j.userId ? meetingNotes().find({ journeyId: j.id, userId: j.userId }, { projection: { _id: 0, rowId: 1, notes: 1 } }).toArray() : Promise.resolve([]),
    lifecycleMeetings().find({ journeyId: j.id }, { projection: { _id: 0, journeyTaskId: 1, with: 1 } }).toArray(),
  ]);
  const hrUserId = joiner?.hrPrimaryUserId;
  const ownerOf: Partial<Record<OwnerRole, string | undefined>> = { manager: j.managerUserId, buddy: j.buddyUserId, head_of_department: approver };
  const teamMeets = defs.filter((d) => d.team.kind === 'meet' && !!d.team.pair && !!ownerOf[d.owner]);
  const people = await peopleById([
    j.managerUserId, j.buddyUserId, hrUserId, approver, ...tasks.map((t) => t.ownerUserId), ...picked.map((p) => p.personUserId),
  ]);
  const notesOf = new Map(notes.map((n) => [n.rowId, n.notes]));
  const withOfMeeting = new Map(meetings.filter((m) => m.journeyTaskId && m.with).map((m) => [m.journeyTaskId!, m.with!]));
  const fields = (id: string, agenda: string[], canTick: boolean, who?: Person, name?: string): MeetingRowFields => ({
    agenda, canTick,
    ...((name ?? who?.name) ? { withName: name ?? who!.name } : {}),
    ...(who ? { withUserId: who.userId } : {}), ...(who?.photoUrl ? { withPhotoUrl: who.photoUrl } : {}),
    ...(notesOf.get(id)?.length ? { myNotes: notesOf.get(id) } : {}),
  });

  const extra = new Map<string, MeetingRowFields>();
  for (const t of tasks) {
    if (!isMeetingTask(t) || t.status === 'cancelled') continue;
    extra.set(t.id, fields(t.id, agendaOf(t), joinerMayTick(t), withOf(t, people, j, hrUserId), withOfMeeting.get(t.id)));
  }

  const rows: MeetingRow[] = [];
  const base = { surface: 'app' as const, mustDo: false, opensAt: null, late: false, meetingRow: true as const };
  for (const d of teamMeets) {
    const who = people.get(ownerOf[d.owner]!);
    const tick = j.teamTasks?.[d.id];
    const id = `team:${d.id}`;
    rows.push({
      ...base, id, title: d.team.pair!, ownerRole: d.owner, ...(who ? { ownerName: who.name } : {}), kind: 'meeting', ...placeOf(d, j.tj),
      status: tick ? 'done' : 'todo', ...(tick ? { doneAt: new Date(tick.doneAt).toISOString(), ...(tick.byName ? { doneByName: tick.byName } : {}) } : {}),
      ...fields(id, (d.team.agenda ?? []).map(forJoiner), !tick, who),
    });
  }
  const container = tasks.find((t) => t.systemKey === 'people_to_meet' && t.status !== 'cancelled');
  if (container) {
    const closed = container.status === 'skipped';
    for (const p of picked) {
      // The manager and the buddy have their own meetings above.
      if (p.personUserId === j.managerUserId || p.personUserId === j.buddyUserId) continue;
      const who = people.get(p.personUserId);
      const id = `person:${p.id}`;
      rows.push({
        ...base, id, title: who?.designation ?? who?.name ?? 'Someone to meet', ownerRole: 'employee', ...(who ? { ownerName: who.name } : {}), kind: 'meeting',
        phase: 'first_week', dueAt: container.dueAt ? new Date(container.dueAt).toISOString() : null,
        status: p.metAt ? 'done' : closed ? 'skipped' : 'todo', ...(p.metAt ? { doneAt: new Date(p.metAt).toISOString() } : {}),
        ...fields(id, p.why ? [p.why] : [], !p.metAt && !closed, who),
      });
    }
  }
  return { extra, rows };
}

/** The row behind an id, checked against the joiner's journey. */
async function rowOf(j: Journey, rowId: string): Promise<{ kind: 'task'; task: JourneyTask } | { kind: 'team'; def: TeamTaskDef } | { kind: 'person'; id: string } | { kind: 'design'; row: PlacedRow; today: string }> {
  if (rowId.startsWith('team:')) {
    // Final designs: a meeting row of the template (`team:<key>` or `team:<key>@<month>`).
    const p = await place(j);
    const row = p.meetings.find((m) => `team:${m.rowKey}` === rowId);
    if (row) return { kind: 'design', row, today: p.today };
    if (p.design.isDesign) throw new LifecycleError(404, 'Meeting not found');
    const key = rowId.slice(5);
    const approver = await approverOf(j);
    const ownerOf: Partial<Record<OwnerRole, string | undefined>> = { manager: j.managerUserId, buddy: j.buddyUserId, head_of_department: approver };
    const def = (await teamDefsFor(j)).find((d) => d.id === key && d.team.kind === 'meet' && !!d.team.pair && !!ownerOf[d.owner]);
    if (!def) throw new LifecycleError(404, 'Meeting not found');
    return { kind: 'team', def };
  }
  if (rowId.startsWith('person:')) {
    const id = rowId.slice(7);
    if (!(await peopleToMeet().findOne({ id, journeyId: j.id }, { projection: { _id: 1 } }))) throw new LifecycleError(404, 'Not on your list');
    return { kind: 'person', id };
  }
  const task = (await tasksOf(j.id)).find((t) => t.id === rowId);
  if (!task || !isMeetingTask(task) || !(visibleTo('employee', task) || joinerSeesReadOnly(task))) throw new LifecycleError(404, 'Meeting not found');
  return { kind: 'task', task };
}

/**
 * POST /lifecycle/onboarding/meeting-rows/:rowId `{ action: 'met' }` — Mark as met, onto the record
 * the other side reads (see the top of this file). There is no undo: a journey task is finished
 * through the engine, which has none.
 */
export async function markMeetingRowMet(me: Me, j: Journey, rowId: string, body: Record<string, unknown>): Promise<void> {
  if (body.action !== 'met' && body.action !== 'unmet') throw new LifecycleError(400, 'action is met or unmet');
  const row = await rowOf(j, rowId);
  const by = { userId: me.userId, name: me.name };
  if (row.kind === 'design') {
    // The tick both people read (FINAL-DESIGNS.md §1): Mark as met here, Mark as done on the teammate's side.
    if (row.row.opensOn && row.today < row.row.opensOn) throw new LifecycleError(409, 'This meeting opens later');
    await setRowTick(j.id, row.row.rowKey, body.action === 'met' ? by : null);
    return;
  }
  if (body.action !== 'met') throw new LifecycleError(400, 'action is met');
  if (row.kind === 'task') {
    if (row.task.status === 'done') return;
    if (!joinerMayTick(row.task)) throw new LifecycleError(409, 'Someone else marks this one');
    await lifecycleMeetings().updateOne({ journeyId: j.id, journeyTaskId: row.task.id }, { $set: { met: 'yes' } });
    await finishTaskById(j.id, row.task.id, 'done', by);
  } else if (row.kind === 'team') {
    if (j.teamTasks?.[row.def.id]) return;
    await setTick(j, row.def.id, { doneAt: new Date(), byUserId: me.userId, byName: me.name });
  } else {
    const container = (await tasksOf(j.id)).find((t) => t.systemKey === 'people_to_meet' && t.status !== 'cancelled');
    if (container?.status === 'skipped') throw new LifecycleError(409, 'People to meet closed at the end of month 1');
    await peopleToMeet().updateOne({ id: row.id, journeyId: j.id }, { $set: { metAt: new Date() }, $unset: { skippedAt: '' } });
    const all = await peopleToMeet().find({ journeyId: j.id }).toArray();
    if (all.length && all.every((p) => p.metAt)) await completeTask(j.id, 'people_to_meet', by);
  }
}

/** PUT /lifecycle/onboarding/meeting-rows/:rowId/notes `{ notes: string[] }` — the joiner's own notes, one per agenda point. */
export async function saveMeetingRowNotes(me: Me, j: Journey, rowId: string, body: Record<string, unknown>): Promise<{ notes: string[] }> {
  if (!Array.isArray(body.notes)) throw new LifecycleError(400, 'notes is a list');
  if (body.notes.length > 12) throw new LifecycleError(400, "At most 12 notes");
  await rowOf(j, rowId);
  const notes = body.notes.map((n) => (typeof n === 'string' ? n.slice(0, 2000) : ''));
  const id = `${j.id}:${rowId}:${me.userId}`;
  if (notes.every((n) => !n.trim())) {
    await meetingNotes().deleteOne({ id });
    return { notes: [] };
  }
  await meetingNotes().updateOne(
    { id },
    { $set: { org: j.org, journeyId: j.id, rowId, userId: me.userId, notes, updatedAt: new Date() } },
    { upsert: true },
  );
  return { notes };
}
