/**
 * Onboarding · Final designs on the team side, what is left of it (24 Nov): HR assigns every onboarding
 * task on the dashboard, so the manager, the buddy and the head of department have no task page in the
 * app any more (Teams › New joiners lists the joiner and opens their profile, teamNewJoiners.ts). What
 * stays in the app is the probation decision: the manager's confirmation review and the head of
 * department's approval (FINAL-DESIGNS.md §4.3 MgrConfReview, HodApprove), reached from an Actions card
 * while one waits (`confirmationsFor`, sent on `/lifecycle/me`) and from their pushes.
 *
 * Also the shared tick reading (`rowDone`) HR's panel, the joiner's lists and the jobs use.
 */
import { journeys, leaves, probationMonths, users } from '../../config/db';
import type { Journey, JourneyTask, TeamRole } from '../../models/lifecycle.model';
import { reportDaysOfPerson } from '../attendance-report.service';
import { FACE_PROJECTION, faceUrlOf, type FaceFields } from '../face-photos';
import { shortDay } from './designRules';
import { accessTasks, firstOf, initialsOf, place, setRowTick, type Placed, type PlacedRow } from './designRows';
import { LifecycleError, isJoined, loadJourney, tell } from './engine';
import { joiningFormState, payrollCheckState } from './hrReviews';
import { OPEN_ONBOARDING, approverOf, relationTo, stepOfRule, teamDefsFor, type TeamRelation } from './teamTasks';

type Me = { userId: string; name: string; org: string };

// ─── Who I am to the joiner ─────────────────────────────────────────────────

export interface Link { rel: TeamRelation | 'senior'; roles: TeamRole[]; approver: boolean }

/** My roles for a joiner on the team side (never HR or IT: they work from the dashboard). */
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

function requireRole(link: Link, role: TeamRole) {
  if (!link.roles.includes(role)) throw new LifecycleError(403, role === 'manager' ? 'Only their manager can do this' : role === 'head_of_department' ? 'Only the head of department approves' : 'Not yours to do');
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
  // HR's checks are done where they are done (hrReviews.ts): the declaration approved, the joining form's sections approved.
  if (key === 'hr_check_payroll') return payrollCheckState(j).done;
  if (key === 'hr_check_form') return joiningFormState(j).done;
  if (key === 'hod_approve') return j.probation?.hodApproval?.outcome === 'approved' || j.probation?.hodApproval?.outcome === 'extended';
  if (key === 'it_accesses' || key === 'hr_accesses') {
    const list = accessTasks(j, tasks, design).filter((t) => t.ownerRole === (key === 'it_accesses' ? 'it' : 'hr'));
    return list.length > 0 && list.every((t) => t.status === 'done' || t.status === 'skipped');
  }
  return r.done;
}

// ─── The joiner, at the top of the review and the approval ──────────────────

export interface ConfirmationJoiner {
  journeyId: string; userId?: string; name: string; first: string; initials: string; photoUrl?: string; designation?: string; department?: string;
}

async function joinerOf(j: Journey): Promise<ConfirmationJoiner> {
  const person = j.userId
    ? await users().findOne<FaceFields & { name: string; designation?: string; department?: string }>({ userId: j.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, ...FACE_PROJECTION } })
    : null;
  const name = person?.name ?? j.candidate?.name ?? '—';
  const photoUrl = person ? faceUrlOf(person) : null;
  const designation = j.designation ?? person?.designation;
  const department = j.department ?? person?.department;
  return {
    journeyId: j.id, ...(j.userId ? { userId: j.userId } : {}), name, first: firstOf(name), initials: initialsOf(name),
    ...(photoUrl ? { photoUrl } : {}), ...(designation ? { designation } : {}), ...(department ? { department } : {}),
  };
}

// ─── What waits on me (the Actions card) ────────────────────────────────────

/** One confirmation waiting on the viewer: the manager's review to write, or the head of department's approval. */
export interface PendingConfirmation {
  journeyId: string;
  kind: 'review' | 'approval';
  name: string;
  /** "Confirmation review for Priya", "Approve Priya’s confirmation". */
  title: string;
}

/**
 * The confirmations waiting on me, for the Actions card (`/lifecycle/me` `confirmations`): as the manager,
 * a joiner whose "Write the confirmation review" row has opened (its stage, usually the final month) and
 * who has no recommendation yet; as the head of department (approverOf), a recommendation not yet answered.
 * A row HR switched off in the joiner's template waits on nobody. None once HR has decided.
 */
const REVIEW_ROWS = ['mgr_confirmation_review', 'mgr_recommend'];

export async function confirmationsFor(me: Me, now = new Date()): Promise<PendingConfirmation[]> {
  const rows = (await journeys().find(
    {
      org: me.org, ...OPEN_ONBOARDING, status: { $nin: [...OPEN_ONBOARDING.status.$nin, 'confirmed'] }, 'probation.decision': { $exists: false },
      $or: [{ managerUserId: me.userId }, { 'probation.recommendation': { $exists: true } }],
    } as never,
    { projection: { _id: 0 } },
  ).toArray()) as Journey[];
  if (!rows.length) return [];
  const out: Array<PendingConfirmation & { tj: string }> = [];
  for (const j of rows) {
    if (!j.tj || !isJoined(j)) continue;
    const rec = j.probation?.recommendation;
    const answer = j.probation?.hodApproval;
    const mine = j.managerUserId === me.userId && (!rec || answer?.outcome === 'discuss');
    const toApprove = !mine && !!rec && (!answer || answer.outcome === 'discuss') && (await approverOf(j)) === me.userId;
    if (!mine && !toApprove) continue;
    // Its row (the Final designs' review, an older template's "Recommend"; the approval) switched off, or the
    // review not open yet: nothing waits.
    const keys = mine ? REVIEW_ROWS : ['hod_approve'];
    const p = await place(j, now);
    if (p.design.isDesign) {
      const row = p.team.find((r) => keys.includes(r.row.team?.key ?? ''));
      if (!row || (mine && row.step > p.step)) continue;
    } else {
      const def = (await teamDefsFor(j)).find((d) => keys.includes(d.id));
      if (!def || (mine && stepOfRule(def.dueRule, p.months, j.tj) > p.step)) continue;
    }
    const account = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }) : null;
    const name = account?.name ?? j.candidate?.name ?? '';
    const first = firstOf(name);
    out.push({ journeyId: j.id, kind: mine ? 'review' : 'approval', name, title: mine ? `Confirmation review for ${first}` : `Approve ${first}’s confirmation`, tj: j.tj });
  }
  return out.sort((a, b) => a.tj.localeCompare(b.tj) || a.name.localeCompare(b.name)).map((c) => ({ journeyId: c.journeyId, kind: c.kind, name: c.name, title: c.title }));
}

/** The same, never failing the read it rides on (`/lifecycle/me`). */
export async function confirmationsQuietly(me: Me, now = new Date()): Promise<PendingConfirmation[]> {
  try {
    return await confirmationsFor(me, now);
  } catch {
    return [];
  }
}

// ─── The confirmation review and the approval ───────────────────────────────

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
    joiner: await joinerOf(j),
    facts: await probationFacts(j, p), ...(approver ? { approverName: approver.name } : {}),
    ...(rec ? { sent: { outcome: rec.outcome, ...(rec.extendMonths ? { extendMonths: rec.extendMonths } : {}), ...(rec.review ?? {}), at: rec.at } } : {}),
  };
}

const cleanText = (v: unknown, label: string) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new LifecycleError(400, `${label} is needed`);
  return t.slice(0, 2000);
};

/** POST /lifecycle/team/joiners/:journeyId/review — the recommendation, to the head of department. Answers the review as it now is. */
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
    await tell([p.people.head_of_department], {
      scenario: 'lifecycle_confirmation_review', destination: 'lifecycle_confirmation_approval', title: 'A confirmation to approve',
      body: `${me.name} recommends: ${outcome === 'confirm' ? 'Confirm' : 'Extend'}.`, data: { journeyId: j.id },
    });
  }
  return reviewView(me, journeyId);
}

/** GET /lifecycle/team/joiners/:journeyId/confirmation — the head of department's approval. */
export async function approvalViewV2(me: Me, journeyId: string) {
  const { j, p, link } = await teamJourney(me, journeyId);
  requireRole(link, 'head_of_department');
  const rec = j.probation?.recommendation;
  const a = j.probation?.hodApproval;
  return {
    joiner: await joinerOf(j),
    state: a?.outcome === 'approved' ? 'approved' : a?.outcome === 'extended' ? 'extended' : rec ? 'ready' : 'waiting',
    ...(rec ? { recommendation: { byName: rec.byName ?? '', outcome: rec.outcome, ...(rec.extendMonths ? { extendMonths: rec.extendMonths } : {}), ...(rec.review ?? {}), ...(rec.note ? { note: rec.note } : {}), at: rec.at } } : {}),
    // HodApprove lists three: the monthly goals, the confirmation discussion (Done / Not yet) and attendance.
    facts: ((all) => ['Monthly goals', 'Confirmation discussion', 'Attendance']
      .map((label) => all.find((f) => f.label === label)).filter((f): f is { label: string; value: string } => !!f)
      .map((f) => (f.label === 'Confirmation discussion' && f.value.startsWith('Done') ? { ...f, value: 'Done' } : f)))(await probationFacts(j, p)),
    ...(a ? { answer: { outcome: a.outcome, ...(a.extendMonths ? { extendMonths: a.extendMonths } : {}), ...(a.comment ? { comment: a.comment } : {}), at: a.at, byName: a.byName } } : {}),
  };
}

/** POST /lifecycle/team/joiners/:journeyId/confirmation `{ action: 'approve' | 'extend', extendMonths?, comment? }` */
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
  const joiner = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }) : null;
  const name = joiner?.name ?? j.candidate?.name ?? 'the joiner';
  // The manager hears; HR sees it on the dashboard's Onboarding board (no app push to HR).
  await tell([j.managerUserId], {
    scenario: 'lifecycle_confirmation_window_hr', destination: 'lifecycle_confirmation_review', title: `${name}’s confirmation`,
    body: outcome === 'approved' ? `${me.name} approved the confirmation.` : `${me.name} extended probation by ${extendMonths} month${extendMonths === 1 ? '' : 's'}.`,
    data: { journeyId: j.id },
  });
  return approvalViewV2(me, journeyId);
}

