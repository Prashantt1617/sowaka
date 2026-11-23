/**
 * The reviews on a joiner's journey (the dashboard's joiner panel and the pre-boarding profile's
 * Activity tab): checks and decisions whose work lives somewhere else, each done by the action at
 * that place, never by a tick on the journey (24 Nov, HR: "If I review something, the click leads
 * me to the respective place, and it is marked done at its place only; I can later review it again").
 *
 *   Review documents            → the profile page's Documents card; done when every required one is approved
 *                                 (documents.ts), to do again when a required one is sent back
 *   Check the joining form      → the profile page's sections; done when the joining form's sections are all
 *                                 approved (approveProfileSection), to do again when one is unlocked or a
 *                                 document of one is sent back
 *   Check their payroll details → Salary details › Bank account and PF; done when HR approves the declaration
 *                                 (decideBankPfRequest), to do again when declined or declared anew
 *   Confirmation discussion     → the decision (recordDecision)
 *   Write the confirmation review, Approve the confirmation → the manager's and the head of department's,
 *                                 in the app; shown with the recommendation note they write
 *   Issue the confirmation letter → the Confirmed step's letter (letters.ts closeLetterTask)
 *
 * The team rows' ticks (journey.teamTasks) are written here so the app's HR screens read the same.
 */
import { journeys } from '../../config/db';
import type { Journey, JourneyTask, OwnerRole, ProfileSectionKey } from '../../models/lifecycle.model';
import type { CandidateDocumentView } from './documents';

/** The joining form HR checks (the app's "Check the joining form" screen shows these sections). */
export const JOINING_FORM_SECTIONS: readonly ProfileSectionKey[] = ['personal', 'contact', 'emergency', 'education'];

type By = { userId: string; name: string };
type Tickable = Pick<Journey, 'teamTasks'>;

async function tick(journeyId: string, key: string, by: By | null): Promise<void> {
  const now = new Date();
  if (by) await journeys().updateOne({ id: journeyId }, { $set: { [`teamTasks.${key}`]: { doneAt: now, byUserId: by.userId, byName: by.name }, updatedAt: now } });
  else await journeys().updateOne({ id: journeyId }, { $unset: { [`teamTasks.${key}`]: '' }, $set: { updatedAt: now } });
}

// ─── The joining form ───────────────────────────────────────────────────────

/** Done once every joining-form section is approved: by whoever approved the last one, then. */
export function joiningFormState(j: Pick<Journey, 'profileApprovals'> & Tickable): { done: boolean; approved: number; total: number; byName?: string; at?: Date } {
  const approvals = JOINING_FORM_SECTIONS.map((k) => j.profileApprovals?.[k]).filter((a): a is NonNullable<typeof a> => !!a);
  const all = approvals.length === JOINING_FORM_SECTIONS.length;
  const last = [...approvals].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  const t = j.teamTasks?.hr_check_form;
  if (t) return { done: true, approved: approvals.length, total: JOINING_FORM_SECTIONS.length, byName: t.byName, at: t.doneAt };
  return { done: all, approved: approvals.length, total: JOINING_FORM_SECTIONS.length, ...(all && last ? { byName: last.byName, at: last.at } : {}) };
}

/**
 * After a section is approved or unlocked (or a document of one sent back): "Check the joining form" is
 * done by the approval that completes the form, and to do again once one of its sections opens again.
 */
export async function syncJoiningFormCheck(journeyId: string, by: By | null): Promise<void> {
  const j = await journeys().findOne({ id: journeyId }, { projection: { _id: 0, profileApprovals: 1, teamTasks: 1 } });
  if (!j) return;
  const all = JOINING_FORM_SECTIONS.every((k) => !!j.profileApprovals?.[k]);
  const ticked = !!j.teamTasks?.hr_check_form;
  if (all && !ticked && by) await tick(journeyId, 'hr_check_form', by);
  else if (!all && ticked) await tick(journeyId, 'hr_check_form', null);
}

// ─── Payroll details (bank and PF) ──────────────────────────────────────────

/**
 * Done when HR approved the bank and PF the joiner declared; a declaration waiting, or one sent back, is
 * to do. With nothing declared, a tick from the app's HR screen stands.
 */
export function payrollCheckState(j: Pick<Journey, 'bankPfRequest'> & Tickable): { done: boolean; byName?: string; at?: Date; waiting?: 'declared' | 'sent_back' | 'nothing' } {
  const req = j.bankPfRequest;
  if (req?.status === 'approved') return { done: true, byName: req.decidedByName, at: req.decidedAt };
  if (req?.status === 'pending') return { done: false, waiting: 'declared' };
  if (req?.status === 'declined') return { done: false, waiting: 'sent_back' };
  const t = j.teamTasks?.hr_check_payroll;
  return t ? { done: true, byName: t.byName, at: t.doneAt } : { done: false, waiting: 'nothing' };
}

/** HR decided the declaration: approved is the check done (by them, now); declined is to do again. */
export async function payrollChecked(journeyId: string, decision: 'approve' | 'decline', by: By): Promise<void> {
  await tick(journeyId, 'hr_check_payroll', decision === 'approve' ? by : null);
}

// ─── The journey's review rows ──────────────────────────────────────────────

export type ReviewPlace = 'documents' | 'joining_form' | 'bank_pf' | 'tax' | 'decision' | 'recommendation' | 'letter';
export type ReviewStep = 'joining_day' | 'week_1' | 'final_month' | 'confirmed';
export interface ReviewRow {
  key: string;
  title: string;
  step: ReviewStep;
  /** Where it is done (the dashboard opens it there). */
  place: ReviewPlace;
  owner: OwnerRole;
  done: boolean;
  doneByName?: string;
  doneAt?: string;
  /** Not done: what it waits for. */
  line?: string;
  /** The joining form: the section to open (the first one not approved). */
  focus?: string;
}

const iso = (d?: Date | string) => (d ? new Date(d).toISOString() : undefined);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date | string) => { const x = new Date(d); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || 'them';
const fill = (text: string, first: string) => text.replace(/\{n\}/g, first).replace(/\{p\}/g, `${first}’s`);

/**
 * The rows, from what the journey already holds: its tasks, documents, team rows (the template's,
 * `teamDefs`: their key, title and owner) and their ticks, the bank/PF declaration and the probation record.
 * `managerName`: for "Waiting for Sunny".
 */
/** The joiner's income tax declaration for this financial year, as the app saved it (null: nothing yet). */
export interface TaxDeclarationState { status?: 'saved' | 'submitted'; regime?: string; submittedAt?: Date | string; updatedAt?: Date | string }

export function reviewRowsOf(j: Journey, tasks: JourneyTask[], documents: CandidateDocumentView[], teamDefs: Array<{ id: string; title: string; owner: OwnerRole }>, managerName?: string, tax?: TaxDeclarationState | null): ReviewRow[] {
  const first = firstOf(j.candidate?.name ?? '');
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const task = (key: string) => live.filter((t) => t.systemKey === key).sort((a, b) => (b.month ?? 0) - (a.month ?? 0))[0];
  const def = (...keys: string[]) => teamDefs.find((d) => keys.includes(d.id));
  const doneBy = (name?: string, at?: Date | string) => ({ ...(name ? { doneByName: name } : {}), ...(at ? { doneAt: iso(at) } : {}) });
  const rows: ReviewRow[] = [];

  // Joining day: the documents.
  const review = task('review_documents');
  if (review || documents.length) {
    const required = documents.filter((d) => d.required);
    const allApproved = required.length > 0 && required.every((d) => d.status === 'approved');
    const waiting = documents.filter((d) => d.status === 'in_review').length;
    const sentBack = documents.filter((d) => d.status === 'sent_back').length;
    const lastApproved = [...required].filter((d) => d.reviewedAt).sort((a, b) => new Date(b.reviewedAt!).getTime() - new Date(a.reviewedAt!).getTime())[0];
    const done = review ? review.status === 'done' || review.status === 'skipped' : allApproved;
    rows.push({
      key: 'review_documents', title: review?.title ?? 'Review documents', step: 'joining_day', place: 'documents', owner: 'hr', done,
      ...(done ? (review ? doneBy(review.doneByName, review.doneAt) : doneBy(lastApproved?.reviewedByName, lastApproved?.reviewedAt)) : {}),
      ...(!done ? { line: waiting ? `${waiting} to review` : sentBack ? `${sentBack} sent back, waiting for ${first}` : `Waiting for ${first}’s uploads` } : {}),
    });
  }

  // Week 1: payroll details (the joining form went on 24 Nov: the profile's sections are approved on the profile).
  const payroll = def('hr_check_payroll');
  if (payroll || j.bankPfRequest) {
    const s = payrollCheckState(j);
    const req = j.bankPfRequest;
    rows.push({
      key: 'hr_check_payroll', title: payroll ? fill(payroll.title, first) : 'Check the bank and PF change', step: 'week_1', place: 'bank_pf', owner: 'hr', done: s.done,
      ...(s.done ? doneBy(s.byName, s.at) : {
        line: s.waiting === 'declared' ? `Declared ${req ? day(req.requestedAt) : ''}, waiting for you`
          : s.waiting === 'sent_back' ? `Sent back${req?.decidedAt ? ` ${day(req.decidedAt)}` : ''}, waiting for ${first}`
            : `Waiting for ${first} to declare`,
      }),
    });
  }
  // Week 1: the income tax declaration (new or old regime) the joiner makes in the app; HR checks it on Salary details.
  {
    const submitted = tax?.status === 'submitted';
    rows.push({
      key: 'hr_check_tax', title: `Check ${first}’s tax declaration`, step: 'week_1', place: 'tax', owner: 'hr', done: submitted,
      ...(submitted ? doneBy(j.candidate?.name, tax?.submittedAt ?? tax?.updatedAt) : {
        line: tax?.status === 'saved' ? `Saved as a draft${tax.regime ? ` (${tax.regime} regime)` : ''}, not submitted yet` : `Waiting for ${first} to declare`,
      }),
    });
  }

  // Final month: the manager's review, the head of department's approval, HR's decision.
  const decision = j.probation?.decision;
  const rec = j.probation?.recommendation;
  const hod = j.probation?.hodApproval;
  const review2 = def('mgr_confirmation_review', 'mgr_recommend');
  if (review2) {
    rows.push({
      key: review2.id, title: fill(review2.title, first), step: 'final_month', place: 'recommendation', owner: 'manager', done: !!rec,
      ...(rec ? doneBy(rec.byName, rec.at) : { line: `Waiting for ${managerName ? firstOf(managerName) : 'the manager'}` }),
    });
  }
  const approve = def('hod_approve');
  if (approve) {
    const done = hod?.outcome === 'approved' || hod?.outcome === 'extended';
    rows.push({
      key: 'hod_approve', title: fill(approve.title, first), step: 'final_month', place: 'recommendation', owner: 'head_of_department', done,
      ...(done ? doneBy(hod?.byName, hod?.at) : { line: hod?.outcome === 'discuss' ? 'Asked to discuss' : rec ? 'Ready to approve' : 'After the manager’s review' }),
    });
  }
  const discussion = task('confirmation_discussion');
  if (discussion) {
    // The newest one (an extension opens another in the new final month).
    const done = discussion.status === 'done' || discussion.status === 'skipped';
    rows.push({
      key: 'confirmation_discussion', title: discussion.title, step: 'final_month', place: 'decision', owner: discussion.ownerRole, done,
      ...(done ? doneBy(discussion.doneByName ?? decision?.decidedByName, discussion.doneAt ?? decision?.decidedAt)
        : { line: discussion.status === 'locked' ? 'Opens in the final month' : 'Record the decision' }),
    });
  }

  // Confirmed: the letter.
  const letter = task('confirmation_letter');
  const letterRow = def('hr_confirmation_letter');
  if (letter || letterRow) {
    const done = letter ? letter.status === 'done' || letter.status === 'skipped' : !!decision?.letterId || !!j.teamTasks?.hr_confirmation_letter;
    const t = j.teamTasks?.hr_confirmation_letter;
    rows.push({
      key: 'confirmation_letter', title: letterRow ? fill(letterRow.title, first) : letter!.title, step: 'confirmed', place: 'letter', owner: 'hr', done,
      ...(done ? (letter?.doneAt ? doneBy(letter.doneByName, letter.doneAt) : doneBy(t?.byName, t?.doneAt))
        : { line: !decision ? 'After the decision' : decision.outcome === 'not_confirm' ? 'Not confirmed: no letter' : 'Not sent yet' }),
    });
  }
  return rows;
}
