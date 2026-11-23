// The joiner's journey, as the board design of 18 Nov draws it: nine steps (Offer sent, Offer
// confirmed, Employee profile, Joining day, Week 1, Month 1, Months 2–5, Final month, Confirmed),
// each with its circle, its line and, opened, what HR does there: the offer and its PDF, the
// portal, documents and letters, the Day-1 pass, manager and buddy, the tasks of each phase, the
// bank/PF change, probation and its decision. Drawn by the joiner panel (one step open at a time)
// and by the pre-boarding profile's Activity tab (every step open, the joiner's own tasks only).
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { Pill } from '../../ui';
import {
  AGENDA_TASK_KEYS, AGENDA_TASK_LABEL, decideBankPfRequest, decideDateRequest, fetchLifecycleFile, journeyTaskAction, listTemplates, reviewDocument, updateJourney,
} from '../../../services/lifecycle';
import type {
  BankPfRequest, CandidateDocumentView, ConfirmationDecision, Day1Pass, DesignReporting, JourneyDetail, LetterView, OwnerRole, TaskView, TemplateListItem,
} from '../../../services/lifecycle';
import { FilePreview, NoteDialog, OwnerChip, Pick, Field } from './shared';
import { IconChevronDown, IconDownload } from '../../icons';
import {
  PHASES, addDays, areaStyle, changedFieldsText, daysTo, dayTime, decisionLine, dueText, errText, fileSize, firstName, inputStyle, longDay, openDocuments, rupees, sectionLabel, shortDay, todayKey,
} from './format';
import { ConfirmationLetter } from './ConfirmationLetter';
import { DecisionDialog, ProbationMonths, RecommendationNote } from './Probation';
import { KIND_LABEL } from './letterDoc';
import { downloadFile } from './DocumentParts';
import { pctColour, weekOf } from './boardModel';
import { preboardingHref } from './preboardingLinks';

const TASK_STATUS: Record<string, { label: string; tone: { bg: string; fg: string } }> = {
  locked: { label: 'Not open yet', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' } },
  todo: { label: 'To do', tone: { bg: 'var(--attn-bg)', fg: 'var(--attn)' } },
  in_review: { label: 'In review', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  sent_back: { label: 'Sent back', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  done: { label: 'Done', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
  skipped: { label: 'Skipped', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
  cancelled: { label: 'Cancelled', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' } },
};
const DOC_STATUS: Record<string, { label: string; tone: { bg: string; fg: string } }> = {
  todo: { label: 'Not uploaded', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
  in_review: { label: 'With HR', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  approved: { label: 'Approved', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
  sent_back: { label: 'Sent back', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
};
const LETTER_STATE: Record<string, string> = { draft: 'Draft', sent: 'Sent', ready: 'Ready to sign', opened: 'Opened', signed: 'Signed' };
/** A task still waiting on someone. */
export const OPEN = new Set(['todo', 'in_review', 'sent_back']);
/** The statuses before joining. */
export const PRE_JOIN = new Set(['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved']);

/** The design's nine steps, and the step each board column is on. */
const STEPS = ['Offer sent', 'Offer confirmed', 'Employee profile', 'Joining day', 'Week 1 · onboarding tasks', 'Month 1 · settling in', 'Months 2–5 · growing', 'Final month · decision', 'Confirmed'];
const STEP_AT: Record<string, number> = {
  offer_sent: 0, accepted: 1, documents: 2, letters: 2, ready_to_join: 3, day1: 4, week1_tasks: 4, day7_survey: 4, week_done: 4,
  month1: 5, months_2_5: 6, final_month: 7, confirmed: 8,
};
/** The tasks the joiner owns (alone, or with their manager): the pre-boarding profile shows only these. */
const JOINER_OWNS = new Set<OwnerRole>(['employee', 'manager_employee']);

type StepDialog =
  | { kind: 'decision' }
  | { kind: 'task'; task: TaskView; action: 'done' | 'skip' | 'reopen' }
  | { kind: 'sendback'; doc: CandidateDocumentView }
  | { kind: 'date'; id: string; decision: 'approve' | 'decline'; day: string }
  | { kind: 'file'; id: string; name: string }
  | { kind: 'bankpf'; decision: 'approve' | 'decline' }
  | null;

/** The joiner's answer to "How was today?" on "Day 1, done!", as the app labels it. */
const DAY1_FEELING: Record<string, string> = { great: 'Great', okay: 'Okay', tough: 'Tough' };

/** Key facts, as the design's step lists them: a narrow label column, the value in medium weight. */
function Facts({ rows, strong = true }: { rows: [string, ReactNode][]; strong?: boolean }) {
  const shown = rows.filter(([, v]) => v != null && v !== '');
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '8px 14px', margin: 0, fontSize: 12.5 }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ink-3)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--ink)', fontWeight: strong ? 500 : 400, overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A smaller heading inside a step (Documents, Letters, Tasks…). */
const Sub = ({ children }: { children: ReactNode }) => <h4 style={{ ...sectionLabel, margin: '4px 0 0' }}>{children}</h4>;
const Para = ({ children }: { children: ReactNode }) => <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>{children}</p>;

const addr = (a?: { line: string; city: string; state: string; pin: string }) => (a ? `${a.line}, ${a.city}, ${a.state} ${a.pin}` : '');
const month = (m?: string) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'now');

/** What the candidate filled in on the portal's Employee profile (the secrets as their last four). */
type Contact = { name: string; relation: string; phone: string; altPhone?: string };
const contactLine = (c?: Contact) => (c ? `${c.name} (${c.relation}) · ${c.phone}${c.altPhone ? ` · ${c.altPhone}` : ''}` : '');
/**
 * The Employee profile's heading, with the link to the candidate's pre-boarding profile (its own page, in a
 * new tab), where HR sees every section and its documents and approves each section.
 */
function ProfileHead({ sections, href }: { sections?: { done: number; total: number }; href?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <Sub>Employee profile{sections ? ` · ${sections.done} of ${sections.total} sections done` : ''}</Sub>
      {href && (
        <a href={href} target="_blank" rel="noopener" className="pd-btn sm" title="Every section and its documents, to review and approve (opens in a new tab)">
          Employee profile
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </a>
      )}
    </div>
  );
}

function ProfileFacts({ profile: p, sections, href, emergency, emergency2, pf, onPhoto }: {
  profile: NonNullable<JourneyDetail['journey']['profile']>; sections?: { done: number; total: number }; href?: string; emergency?: Contact; emergency2?: Contact; pf?: { firstJob: boolean; uan?: string }; onPhoto: (id: string) => void;
}) {
  return (
    <>
      <ProfileHead sections={sections} href={href} />
      <Facts strong={false} rows={[
        ['Full name', p.personal ? `${p.personal.fullName}${p.personal.preferredName ? ` (${p.personal.preferredName})` : ''}` : ''],
        ['Date of birth', p.personal?.dob ? longDay(p.personal.dob) : ''],
        ['Gender', p.personal?.gender], ['Marital status', p.personal?.maritalStatus], ['Nationality', p.personal?.nationality],
        ['Mobile', p.contact?.mobile], ['Current address', addr(p.contact?.current)],
        ['Permanent address', p.contact ? (p.contact.permanentSame ? 'Same as current' : addr(p.contact.permanent)) : ''],
        ['Emergency contact', contactLine(emergency)],
        ['Second contact', contactLine(emergency2)],
        ['Bank', p.bank ? `${p.bank.holderName} · •••• ${p.bank.accountLast4} · ${p.bank.ifsc}${p.bank.bankName ? ` · ${p.bank.bankName}` : ''}` : ''],
        ['PF', pf ? (pf.firstJob ? 'First job: no UAN yet' : pf.uan ? `UAN ${pf.uan}` : 'Has a UAN, not given') : ''],
        ['Education', p.education ? `${p.education.qualification}, ${p.education.institution} (${p.education.year})` : ''],
        ['Experience', p.experience ? (p.experience.firstJob ? 'First job' : p.experience.jobs.map((j) => `${j.role} at ${j.company} (${month(j.from)} – ${month(j.to)})`).join('; ')) : ''],
        ['Aadhaar', p.ids?.aadhaarLast4 ? `•••• ${p.ids.aadhaarLast4}` : ''], ['PAN', p.ids?.panLast4 ? `••••••${p.ids.panLast4}` : ''],
        ['Photo', p.photoFileId ? <button key="ph" type="button" className="pd-btn sm" onClick={() => onPhoto(p.photoFileId!)}>View photo</button> : ''],
      ]} />
    </>
  );
}

/** The design's pencil, beside Edit offer. */
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
);

const doneOf = (list: TaskView[]) => list.filter((t) => t.status === 'done' || t.status === 'skipped').length;

/**
 * The Journey: its heading ("Step 4 of 9") and the nine steps. HR's actions inside a step (tasks, documents,
 * the Day-1 pass, manager and buddy, date requests, the bank/PF change, the decision) work in place; `busy` and
 * `setBusy` are the caller's, so its own buttons wait too, and `onChanged` reloads the journey after each one.
 *
 * `variant`:
 *  - 'panel' (the joiner panel): one step open at a time (`openStep`; null is the step they are on, -1 none),
 *    each opened and closed with its chevron, and every task and the team's app tasks.
 *  - 'profile' (the pre-boarding profile's Activity tab): every step open at once, no chevrons; only the
 *    joiner's own tasks (no "Team tasks in the app", no manager / buddy / HR / IT tasks); no link to the
 *    profile page it is already on.
 */
export function JourneySteps({ data, busy, setBusy, onChanged, variant = 'panel', openStep = null, onOpenStep, onDialogOpen }: {
  data: JourneyDetail; busy: string; setBusy: (key: string) => void; onChanged: () => void;
  variant?: 'panel' | 'profile';
  openStep?: number | null; onOpenStep?: (step: number) => void;
  /** Told when a dialog opens or closes (the panel then leaves Escape to the dialog). */
  onDialogOpen?: (open: boolean) => void;
}) {
  const s = useStore();
  const { user, emps, flash } = s;
  const pay = canSeePay(user);
  const [dialog, setDialog] = useState<StepDialog>(null);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const all = variant === 'profile';
  useEffect(() => { listTemplates('onboarding').then(setTemplates).catch(() => undefined); }, []);
  useEffect(() => { onDialogOpen?.(dialog !== null); }, [dialog, onDialogOpen]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(key);
    try { await fn(); if (ok) flash(ok); onChanged(); return true; } catch (e) { flash(errText(e), 'error'); return false; } finally { setBusy(''); }
  };
  const closeDialog = () => setDialog(null);

  const { journey, tasks, documents, letters, offer, dateRequests, probation, batch } = data;
  // This joiner's joining and reporting details (their copy of the template, from the server): what the portal's Day-1 pass
  // shows where HR has not typed this joiner's own. Never the template as it is now: an edit reaches new joiners only.
  const reporting: DesignReporting | null = data.reporting ?? null;
  const name = journey.candidate?.name ?? 'Joiner';
  const first = firstName(name);
  const status = String(journey.status);
  const closed = ['declined', 'expired', 'not_joining'].includes(status);
  // Optional documents (a last payslip) never hold anyone up, so the count is of the required ones.
  const requiredDocs = documents.filter((d) => d.required);
  const approved = requiredDocs.filter((d) => d.status === 'approved').length;
  const docsCount = requiredDocs.length ? `${approved} of ${requiredDocs.length} required approved` : documents.length ? 'All optional' : '';
  const reviewQueue = documents.filter((d) => d.status === 'in_review').length;
  const decision: ConfirmationDecision | undefined = probation.decision ?? journey.probation?.decision;
  const template = templates.find((t) => t.id === journey.templateId);
  // The onboarding tab alone (IT, Admin) sees each document's status, never the files.
  const seesDocuments = data.viewer?.seesDocuments !== false;
  const revisionWaiting = Boolean(offer && offer.status === 'draft' && offer.version > 1);
  const bankPf = journey.bankPfRequest && (journey.bankPfRequest.status === 'pending' || journey.bankPfRequest.decidedAt) ? journey.bankPfRequest : null;
  // The candidate's pre-boarding profile page: where HR approves each section (opens in a new tab). Not on that page itself.
  const profileHref = !all && canOpen(user, 'preboarding') ? preboardingHref(journey.id) : undefined;

  // Where they are on the nine steps; the Confirmed column has every step done.
  const cur = STEP_AT[journey.column] ?? 0;
  const allDone = journey.column === 'confirmed';
  const shownStep = openStep === null ? Math.min(cur, STEPS.length - 1) : openStep;

  // The tasks of each step: pre-boarding under Employee profile, the first week under Week 1, probation by month.
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const probationTotal = (journey.probation?.months ?? 0) + (journey.probation?.extendedBy ?? 0);
  const preTasks = live.filter((t) => t.phase === 'pre_boarding');
  const weekTasks = live.filter((t) => t.phase === 'first_week');
  const probTasks = live.filter((t) => t.phase === 'probation');
  const monthOneTasks = probTasks.filter((t) => t.month === 1);
  const finalTasks = probTasks.filter((t) => !t.month || (probationTotal > 1 && t.month >= probationTotal));
  const middleTasks = probTasks.filter((t) => !monthOneTasks.includes(t) && !finalTasks.includes(t));
  const profilePct = preTasks.length ? Math.round((doneOf(preTasks) / preTasks.length) * 100) : 0;
  // The tasks a step lists: every one on the panel, the joiner's own on the profile (the step lines still count them all).
  const shownTasks = (list: TaskView[]) => (all ? list.filter((t) => JOINER_OWNS.has(t.ownerRole)) : list);

  const downloadOffer = async () => {
    if (!offer?.pdfFileId) return;
    setBusy('pdf');
    try { downloadFile(await fetchLifecycleFile(offer.pdfFileId), `Offer letter · ${name} · v${offer.version}.pdf`); } catch (e) { flash(errText(e, 'Could not download the offer letter'), 'error'); } finally { setBusy(''); }
  };

  const sentAt = offer?.sentAt ?? [...(offer?.versions ?? [])].reverse().find((v) => v.sentAt)?.sentAt;
  const acceptedAt = offer?.acceptedAt ?? [...(offer?.versions ?? [])].reverse().find((v) => v.acceptedAt)?.acceptedAt;
  const replyIn = offer?.validTill ? daysTo(offer.validTill) : null;
  const portalSent = !['draft', 'offer_sent', 'accepted'].includes(status) && !closed;
  const pass = journey.day1Pass;
  const passFilled = Boolean(pass && (pass.reportingTime || pass.place || pass.meetingLink));
  // The Day-1 pass line: made by the server at Tj − 7 from the template unless HR fills it in first.
  const passLine = pass?.auto ? `Made automatically on ${shortDay(pass.auto.at)}`
    : passFilled ? 'Filled in'
      : journey.tj && PRE_JOIN.has(status) ? (addDays(journey.tj, -7) > todayKey() ? `Made automatically on ${shortDay(addDays(journey.tj, -7))}` : 'Being made from the template')
        : 'Not filled in';
  const pendingDates = dateRequests.filter((r) => r.status === 'pending').length;

  // Each step's line under its name.
  const sub = (i: number, state: 'done' | 'current' | 'todo'): { text: string; red?: boolean } => {
    // A probation step's line names its own next open task (never an older phase's late one).
    const own = i === 5 ? monthOneTasks : i === 6 ? middleTasks : finalTasks;
    const lead = own.filter((t) => OPEN.has(t.status)).sort((a, b) => String(a.dueAt ?? '9999').localeCompare(String(b.dueAt ?? '9999')))[0];
    const leadLine = lead ? { text: lead.dueAt ? `${lead.title} · ${dueText(lead.dueAt, lead.late)}` : lead.title, red: Boolean(lead.late) } : { text: 'Nothing waiting' };
    switch (i) {
      case 0:
        if (state === 'done') return { text: sentAt ? `Sent ${shortDay(sentAt)}` : 'Sent before joining' };
        if (status === 'draft') return { text: revisionWaiting ? 'Revision saved, not sent' : 'Not sent yet' };
        if (replyIn !== null && replyIn < 0) return { text: `Overdue by ${-replyIn} day${replyIn === -1 ? '' : 's'}`, red: true };
        return { text: `Sent ${shortDay(sentAt)}${offer?.validTill ? ` · reply by ${shortDay(offer.validTill)}` : ''}` };
      case 1:
        if (state === 'todo') return { text: `Waiting for ${first}’s reply` };
        if (state === 'done') return { text: `Accepted ${acceptedAt ? shortDay(acceptedAt) : ''} · portal sent` };
        return { text: `Accepted ${acceptedAt ? shortDay(acceptedAt) : ''} · portal not sent yet` };
      case 2:
        if (state === 'done') return { text: preTasks.length ? `${doneOf(preTasks)} of ${preTasks.length} done` : 'Done' };
        if (state === 'current') return { text: `${profilePct}% complete${reviewQueue ? ` · ${reviewQueue} to review` : ''}`, red: journey.flags?.includes('quiet') };
        return { text: 'Opens once the portal is sent' };
      case 3:
        if (state === 'done') return { text: `Joined ${shortDay(journey.tj)}` };
        return { text: journey.tj ? `${shortDay(journey.tj)}${state === 'current' ? ` · ${weekOf(journey.tj)}` : ''}` : 'Not set' };
      case 4:
        if (state === 'done') return { text: `${doneOf(weekTasks)} of ${weekTasks.length} done` };
        if (state === 'current') return { text: `${doneOf(weekTasks)} of ${weekTasks.length} done`, red: weekTasks.some((t) => t.late && OPEN.has(t.status)) };
        return { text: 'Starts on the joining day' };
      case 8:
        return state === 'done' || allDone ? { text: decision ? decisionLine(decision, pay) : 'Confirmed' } : { text: 'After probation' };
      default:
        if (state === 'done') return { text: 'Done' };
        if (state === 'current') return leadLine;
        return { text: 'Not started' };
    }
  };

  const taskList = (list: TaskView[]) => <TasksByPhase tasks={list} busy={busy} onAction={(task, action) => setDialog({ kind: 'task', task, action })} />;
  // A step's tasks, or `empty` when it has none; on the profile, a line when all of them are someone else's.
  const stepTasks = (list: TaskView[], empty?: string): ReactNode => {
    const shown = shownTasks(list);
    if (shown.length) return taskList(shown);
    if (list.length) return <Para>Nothing here for {first} to do. The rest of this step is the team’s.</Para>;
    return empty ? <Para>{empty}</Para> : null;
  };
  const preShown = shownTasks(preTasks);

  // What each step holds when opened.
  const body = (i: number): ReactNode => {
    switch (i) {
      case 0: return offer ? (
        <>
          <Facts rows={[
            ['Designation', offer.fields.designation], ['Department', offer.fields.department], ['Reporting to', offer.fields.managerName],
            ['Joining date', longDay(offer.fields.tj)], ['Work location', offer.fields.location],
            ['CTC', pay ? `${rupees(offer.fields.ctc)} a year` : 'Hidden · needs payroll access'],
            ['Probation', `${offer.fields.probationMonths} months`], ['Notice', `${offer.fields.noticeDays} days`],
            ['Offer', `Version ${offer.version}`], ['Sent on', sentAt ? longDay(sentAt) : '—'], ['Reply by', longDay(offer.validTill)],
            ['Personal email', journey.candidate?.personalEmail],
          ]} />
          {offer.changedFields && offer.changedFields.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Changed in this version: {changedFieldsText(offer.changedFields)}</div>}
          {revisionWaiting && <div className="pd-note" style={{ color: 'var(--warn)' }}>Saved as a draft. {first} still sees version {offer.version - 1} until you send this one.</div>}
          {offer.pdfFileId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
              <span aria-hidden style={{ width: 32, height: 40, borderRadius: 8, background: 'var(--bad-bg)', color: 'var(--bad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 600, flex: 'none' }}>PDF</span>
              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                <b style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Offer letter · {name} · v{offer.version}.pdf</b>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Version {offer.version}{sentAt ? ` · sent ${shortDay(sentAt)}` : ' · not sent yet'}</span>
              </span>
              <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'file', id: offer.pdfFileId!, name: `Offer letter – ${name}.pdf` })}>View</button>
              <button type="button" className="pd-btn sm" aria-label="Download offer letter" title="Download" disabled={busy === 'pdf'} onClick={() => void downloadOffer()}><IconDownload size={14} stroke="currentColor" /></button>
            </div>
          )}
          {offer.versions.length > 1 && (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
              {offer.versions.slice().reverse().map((v) => (
                <div key={v.version}>Version {v.version} · {v.status}{v.sentAt ? ` · sent ${shortDay(v.sentAt)}` : ''}{v.acceptedAt ? ` · accepted ${shortDay(v.acceptedAt)}` : ''}</div>
              ))}
            </div>
          )}
          {PRE_JOIN.has(status) && pay && <span><button type="button" className="pd-btn sm" onClick={() => openDocuments(s.setView, 'offer', journey.id)}><PencilIcon />Edit offer</button></span>}
          {PRE_JOIN.has(status) && pay && status !== 'draft' && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Editing makes version {offer.version + 1} of the offer letter. {first} keeps version {offer.version} until you send the new one.</div>}
        </>
      ) : <Para>No offer yet. New offer letter starts one.</Para>;
      case 1:
        if (cur < 1 && !allDone) return <Para>{first} gets the offer PDF by email and replies to you to accept it. Then Mark offer accepted sends the joining portal link, where they sign in with a code to their email.</Para>;
        return (
          <>
            <Para>{first} accepted the offer{acceptedAt ? ` on ${dayTime(acceptedAt)}` : ''}.{status === 'accepted' ? ' Mark offer accepted sends the joining portal link to their personal email.' : ''}</Para>
            <Facts rows={[['Joining portal', <span key="p" style={{ color: portalSent || cur > 1 ? 'var(--ok)' : 'var(--warn)' }}>{portalSent || cur > 1 ? 'Link sent' : 'Not sent yet'}</span>], ['Personal email', journey.candidate?.personalEmail], ['Work email', journey.candidate?.workEmail]]} />
          </>
        );
      case 2:
        if (cur < 2 && !allDone) return <Para>Opens once the offer is accepted and the joining portal is sent.</Para>;
        return (
          <>
            <span style={{ display: 'grid', gap: 5 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                <span style={{ color: 'var(--ink-3)' }}>{doneOf(preTasks)} of {preTasks.length} done{docsCount ? ` · documents ${docsCount}` : ''}</span>
                <b style={{ color: pctColour(profilePct), fontWeight: 600 }}>{profilePct}%</b>
              </span>
              <span style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${profilePct}%`, borderRadius: 99, background: pctColour(profilePct) }} /></span>
            </span>
            {journey.profile
              ? <ProfileFacts profile={journey.profile} sections={journey.profileSections} href={profileHref} emergency={journey.aboutYou?.emergencyContact} emergency2={journey.aboutYou?.emergencyContact2} pf={journey.aboutYou?.pf} onPhoto={(id) => setDialog({ kind: 'file', id, name: `Photo – ${name}` })} />
              : profileHref && <ProfileHead sections={journey.profileSections} href={profileHref} />}
            {documents.length > 0 && <Sub>Documents</Sub>}
            {documents.length > 0 && !seesDocuments && <div className="pd-note">Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
            {documents.map((d) => <DocumentRow key={d.id} doc={d} busy={busy === `doc:${d.id}`} canReview={seesDocuments}
              onOpen={(f) => setDialog({ kind: 'file', id: f.id, name: f.name })}
              onApprove={() => void run(`doc:${d.id}`, () => reviewDocument(d.id, 'approve'), `${d.label} approved`)}
              onSendBack={() => setDialog({ kind: 'sendback', doc: d })} />)}
            {letters.length > 0 && <Sub>Letters</Sub>}
            {letters.length > 0 && <div style={{ display: 'grid', gap: 8 }}>{letters.map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}</div>}
            {preShown.length > 0 && <Sub>Tasks</Sub>}
            {preShown.length > 0 && taskList(preShown)}
          </>
        );
      case 3:
        return (
          <>
            <Facts rows={[
              ['Joining date', journey.tj ? longDay(journey.tj) : 'Not set'], ['When', journey.tj ? weekOf(journey.tj) : ''],
              ['Reporting time', pass?.reportingTime ?? reporting?.time ?? 'Not set'], ['Reporting place', pass?.place ?? (pass?.meetingLink ? 'Online' : reporting?.place ?? 'Not set')],
              ['Report to', journey.managerName ?? 'Not picked'], ['Buddy', journey.buddyName ?? 'Not picked'],
              ['Day-1 pass', passLine], ['Template', template?.name],
              ['Joining with', batch.length ? batch.map((b) => b.name).join(', ') : ''],
            ]} />
            {dateRequests.length > 0 && <Sub>Joining date requests{pendingDates ? ` · ${pendingDates} waiting for you` : ''}</Sub>}
            {dateRequests.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0)).map((r) => (
              <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', fontSize: 13 }}>
                <div><b style={{ fontWeight: 500 }}>Asks to join on {longDay(r.requestedTj)}</b> · {r.reason}</div>
                {r.note && <div style={{ color: 'var(--ink-2)', marginTop: 2, overflowWrap: 'anywhere' }}>“{r.note}”</div>}
                {r.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="pd-btn sm primary" onClick={() => setDialog({ kind: 'date', id: r.id, decision: 'approve', day: r.requestedTj })}>Approve</button>
                    <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'date', id: r.id, decision: 'decline', day: r.requestedTj })}>Decline</button>
                  </div>
                ) : <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>{r.status === 'approved' ? 'Approved' : 'Declined'}{r.decidedByName ? ` by ${r.decidedByName}` : ''}{r.decidedAt ? ` · ${shortDay(r.decidedAt)}` : ''}</div>}
              </div>
            ))}
            {!closed && PRE_JOIN.has(status) && status !== 'draft' && (
              <>
                <Sub>Day-1 pass</Sub>
                <Day1PassEditor key={journey.id} value={journey.day1Pass} tj={journey.tj}
                  onSave={(p) => run('pass', () => updateJourney(journey.id, { day1Pass: p }), 'Day-1 pass saved')} busy={busy === 'pass'} />
              </>
            )}
            {!closed && (
              <>
                <Sub>Manager and buddy</Sub>
                <PeoplePicker key={`${journey.managerUserId}-${journey.buddyUserId}`} managerUserId={journey.managerUserId} buddyUserId={journey.buddyUserId} exclude={journey.userId}
                  emps={emps} busy={busy === 'people'} onSave={(patch) => run('people', () => updateJourney(journey.id, patch), 'Saved')} />
                {!all && data.teamRows && data.teamRows.length > 0 && (
                  <>
                    <Sub>Team tasks in the app</Sub>
                    <TeamRows rows={data.teamRows} />
                  </>
                )}
                {status === 'draft' && templates.length > 1 && (
                  <Field label="Onboarding template" hint="Can change until the offer is sent">
                    <Pick value={journey.templateId} onChange={(v) => void run('template', () => updateJourney(journey.id, { templateId: v }), 'Template changed')}>
                      {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                    </Pick>
                  </Field>
                )}
              </>
            )}
          </>
        );
      case 4:
        return (
          <>
            {journey.day1Feeling && <Facts rows={[['How was Day 1', `${DAY1_FEELING[journey.day1Feeling.answer] ?? journey.day1Feeling.answer} · ${shortDay(journey.day1Feeling.at)}`]]} />}
            {stepTasks(weekTasks, 'The week-1 tasks open on the joining day.')}
            {bankPf && <><Sub>Bank and PF change</Sub><BankPfCard request={bankPf} pay={pay} busy={Boolean(busy)} onDecide={(d) => setDialog({ kind: 'bankpf', decision: d })} /></>}
          </>
        );
      case 5: return stepTasks(monthOneTasks, 'Month-1 goals and check-ins open after the first week.');
      case 6: return stepTasks(middleTasks, 'A check-in each month until the final month.');
      case 7:
        return (
          <>
            {finalTasks.length > 0 && stepTasks(finalTasks)}
            {probation.months.length > 0 && <><Sub>Every month</Sub><ProbationMonths months={probation.months} total={probationTotal} /></>}
            {decision && <div className="pd-note">{decisionLine(decision, pay)}</div>}
            {!decision && <RecommendationNote recommendation={probation.recommendation ?? journey.probation?.recommendation} hodApproval={probation.hodApproval ?? journey.probation?.hodApproval} />}
            {journey.column === 'final_month' && <span><button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'decision' })}>{decision ? 'Change decision' : 'Record decision'}</button></span>}
            {!finalTasks.length && !probation.months.length && !decision && <Para>The final check-in and the decision to confirm or extend.</Para>}
          </>
        );
      default: {
        // Confirmed (the decision, or the journey): the confirmation letter is made, sent and resent here.
        const confirmed = decision?.outcome === 'confirm' || status === 'confirmed';
        return decision || confirmed ? (
          <>
            {decision && <Para>{decisionLine(decision, pay)}</Para>}
            {confirmed && (
              <ConfirmationLetter journeyId={journey.id} name={name} letters={letters} decision={decision} busy={busy} setBusy={setBusy} flash={flash} onChanged={onChanged}
                onView={(id, n) => setDialog({ kind: 'file', id, name: n })} />
            )}
            {letters.filter((l) => l.kind === 'extension' || (!confirmed && l.kind === 'confirmation')).map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}
          </>
        ) : <Para>The confirmation letter goes out once the decision is recorded.</Para>;
      }
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ ...sectionLabel, margin: 0 }}>Journey</h3>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{allDone ? 'Confirmed' : `Step ${Math.min(cur + 1, STEPS.length)} of ${STEPS.length}`}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        {STEPS.map((title, i) => {
          const state: 'done' | 'current' | 'todo' = allDone || i < cur ? 'done' : i === cur && !closed ? 'current' : 'todo';
          const line = sub(i, state);
          const open = all || shownStep === i;
          const tag = state === 'current' && i === 3 && journey.tj ? weekOf(journey.tj) : '';
          const last = i === STEPS.length - 1;
          const head = (
            <>
              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: state === 'current' ? 600 : 500, color: state === 'todo' ? 'var(--ink-3)' : 'var(--ink)' }}>{title}</span>
                <span style={{ fontSize: 11.5, color: line.red && state === 'current' ? 'var(--bad)' : state === 'current' ? 'var(--accent-ink)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>{line.text}</span>
              </span>
              {tag && <Pill dot={false} label={tag} tone={tag === 'This week' || tag === 'Today' ? { bg: 'var(--warn-bg)', fg: 'var(--warn)' } : { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }} fontSize={11} padding="2px 9px" />}
            </>
          );
          const headStyle = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 0, borderRadius: 12, padding: '10px 12px', textAlign: 'left', font: 'inherit', color: 'var(--ink)' } as const;
          return (
            <li key={title} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 12 }}>
              <span aria-hidden style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${state === 'done' ? 'var(--ok-solid)' : state === 'current' ? 'var(--accent)' : 'var(--line-2)'}`, background: state === 'done' ? 'var(--ok-solid)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  {state === 'done' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                </span>
                <span style={{ flex: 1, width: 2, minHeight: 12, background: last ? 'transparent' : state === 'done' ? 'color-mix(in srgb, var(--ok-solid) 45%, var(--surface))' : 'var(--line)' }} />
              </span>
              <div style={{ paddingBottom: 6, minWidth: 0 }}>
                {all ? (
                  // Every step open: the step's name and line as a plain heading, no chevron.
                  <div style={{ ...headStyle, background: state === 'current' ? 'var(--accent-soft)' : 'transparent' }}>{head}</div>
                ) : (
                  <button type="button" aria-expanded={open} aria-controls={`lf-step-${i}`} onClick={() => onOpenStep?.(shownStep === i ? -1 : i)}
                    style={{ ...headStyle, cursor: 'pointer', background: open ? 'var(--surface-2)' : state === 'current' ? 'var(--accent-soft)' : 'transparent' }}>
                    {head}
                    <IconChevronDown size={16} stroke="var(--ink-3)" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                  </button>
                )}
                {open && <div id={`lf-step-${i}`} style={{ display: 'grid', gap: 12, padding: '12px 12px 8px' }}>{body(i)}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      {dialog?.kind === 'decision' && <DecisionDialog journey={journey} onClose={closeDialog} onDone={() => { closeDialog(); onChanged(); }} />}
      {dialog?.kind === 'task' && (
        <NoteDialog
          title={dialog.action === 'done' ? `Mark “${dialog.task.title}” done` : dialog.action === 'skip' ? `Skip “${dialog.task.title}”` : `Reopen “${dialog.task.title}”`}
          sub={dialog.action === 'reopen' ? 'It goes back to the owner’s list, with your note.' : undefined}
          placeholder="Note (optional)" confirm={dialog.action === 'done' ? 'Mark done' : dialog.action === 'skip' ? 'Skip' : 'Reopen'}
          onClose={closeDialog}
          onConfirm={async (note) => { await journeyTaskAction(journey.id, dialog.task.id, dialog.action, note || undefined); closeDialog(); onChanged(); }} />
      )}
      {dialog?.kind === 'sendback' && (
        <NoteDialog title={`Send back ${dialog.doc.label}`} sub={`${first} sees your note first, at the top of Up next.`} label="What to fix" required
          placeholder="e.g. The scan is cut off at the bottom. Please upload the full page." confirm="Send back" tone="danger"
          onClose={closeDialog}
          onConfirm={async (note) => { await reviewDocument(dialog.doc.id, 'send_back', note); closeDialog(); flash(`${dialog.doc.label} sent back`); onChanged(); }} />
      )}
      {dialog?.kind === 'date' && (
        <NoteDialog
          title={dialog.decision === 'approve' ? `Move joining to ${longDay(dialog.day)}?` : 'Decline the new date'}
          sub={dialog.decision === 'approve' ? 'The offer is revised with the new joining day and every open due date moves with it.' : 'The joining day stays as it is.'}
          placeholder="Note to the candidate (optional)" confirm={dialog.decision === 'approve' ? 'Approve' : 'Decline'} tone={dialog.decision === 'approve' ? 'primary' : 'danger'}
          onClose={closeDialog}
          onConfirm={async (note) => { await decideDateRequest(dialog.id, dialog.decision, note || undefined); closeDialog(); flash(dialog.decision === 'approve' ? 'New joining date approved' : 'Request declined'); onChanged(); }} />
      )}
      {dialog?.kind === 'bankpf' && (
        <NoteDialog
          title={dialog.decision === 'approve' ? 'Approve the bank and PF change?' : 'Decline the bank and PF change'}
          sub={dialog.decision === 'approve' ? 'The new details go into payroll from the next run. They are told in the app.' : 'Payroll keeps the details it has. They see your note in the app.'}
          placeholder={dialog.decision === 'approve' ? 'Note (optional)' : 'What they should do instead (optional)'}
          confirm={dialog.decision === 'approve' ? 'Approve' : 'Decline'} tone={dialog.decision === 'approve' ? 'primary' : 'danger'}
          onClose={closeDialog}
          onConfirm={async (note) => { await decideBankPfRequest(journey.id, dialog.decision, note || undefined); closeDialog(); flash(dialog.decision === 'approve' ? 'Bank and PF details updated' : 'Change declined'); onChanged(); }} />
      )}
      {dialog?.kind === 'file' && <FilePreview fileId={dialog.id} name={dialog.name} onClose={closeDialog} />}
    </div>
  );
}

/** The week-1 bank / PF change the joiner asked for: payroll keeps the old details until someone with payroll access approves. */
function BankPfCard({ request, pay, busy, onDecide }: { request: BankPfRequest; pay: boolean; busy: boolean; onDecide: (d: 'approve' | 'decline') => void }) {
  const c = request.changes;
  const pending = request.status === 'pending';
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontWeight: 500, flex: 1 }}>{pending ? `Asked ${shortDay(request.requestedAt)}` : request.status === 'approved' ? 'Approved' : 'Declined'}</b>
        <Pill label={pending ? 'Waiting for HR' : request.status === 'approved' ? 'Approved' : 'Declined'} tone={pending ? { bg: 'var(--attn-bg)', fg: 'var(--attn)' } : request.status === 'approved' ? { bg: 'var(--ok-bg)', fg: 'var(--ok)' } : { bg: 'var(--surface-2)', fg: 'var(--ink-2)' }} fontSize={11} padding="2px 9px" />
      </div>
      <Facts rows={[
        ['Bank', c.bankName],
        ['IFSC', c.ifsc],
        ['Account', c.accountLast4 ? `•••• ${c.accountLast4}` : ''],
        ['UAN', c.uanLast4 ? `•••• ${c.uanLast4}` : ''],
        ['Their note', request.note],
        ['Decided', request.decidedAt ? `${shortDay(request.decidedAt)}${request.decidedByName ? ` by ${request.decidedByName}` : ''}` : ''],
        ['Your note', request.hrNote],
      ]} />
      {pending && (pay ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pd-btn sm primary" disabled={busy} onClick={() => onDecide('approve')}>Approve</button>
          <button type="button" className="pd-btn sm" disabled={busy} onClick={() => onDecide('decline')}>Decline</button>
        </div>
      ) : <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Someone with payroll access approves or declines this.</div>)}
    </div>
  );
}

function DocumentRow({ doc, busy, canReview, onOpen, onApprove, onSendBack }: { doc: CandidateDocumentView; busy: boolean; canReview: boolean; onOpen: (f: { id: string; name: string }) => void; onApprove: () => void; onSendBack: () => void }) {
  const st = DOC_STATUS[doc.status] ?? DOC_STATUS.todo;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{doc.label}{doc.required ? '' : <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · optional</span>}</b>
        <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />
      </div>
      {doc.files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {doc.files.map((f) => (
            <button key={f.id} type="button" className="pd-chip sm" onClick={() => onOpen(f)} title={`Preview ${f.name}`} style={{ maxWidth: '100%' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{f.name}</span><span className="c">{fileSize(f.size)}</span>
            </button>
          ))}
        </div>
      )}
      {doc.hrNote && doc.status === 'sent_back' && <div style={{ fontSize: 12.5, color: 'var(--warn)', overflowWrap: 'anywhere' }}>Your note: {doc.hrNote}</div>}
      {doc.reviewedAt && doc.status === 'approved' && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Approved {shortDay(doc.reviewedAt)}{doc.reviewedByName ? ` by ${doc.reviewedByName}` : ''}</div>}
      {doc.status === 'in_review' && canReview && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pd-btn sm primary" onClick={onApprove} disabled={busy}>{busy ? 'Approving…' : 'Approve'}</button>
          <button type="button" className="pd-btn sm" onClick={onSendBack} disabled={busy}>Send back with a note</button>
        </div>
      )}
    </div>
  );
}

function LetterRow({ letter, name, onOpen, onDocuments }: { letter: LetterView; name: string; onOpen: (id: string, name: string) => void; onDocuments: () => void }) {
  const file = letter.signedPdfFileId ?? letter.pdfFileId;
  return (
    <div className="pd-li" style={{ padding: '6px 0' }}>
      <span className="grow">
        <b>{KIND_LABEL[letter.kind]}{letter.refNo ? <span style={{ color: 'var(--ink-3)' }}> · {letter.refNo}</span> : null}</b>
        <span className="s">{LETTER_STATE[letter.state] ?? letter.state}{letter.signedAt ? ` ${shortDay(letter.signedAt)}` : letter.sentAt ? ` · sent ${shortDay(letter.sentAt)}` : ''}</span>
      </span>
      {file && <button type="button" className="pd-btn sm" onClick={() => onOpen(file, `${KIND_LABEL[letter.kind]} – ${name}${letter.signedPdfFileId ? ' (signed)' : ''}.pdf`)}>View</button>}
      {letter.state === 'draft' && <button type="button" className="pd-btn sm ghost" onClick={onDocuments}>Open in Documents</button>}
    </div>
  );
}

/** The team side's rows, read-only: what the manager, the buddy and the head of department ticked in the app. */
const TEAM_OWNER: Record<string, string> = { manager: 'Manager', buddy: 'Buddy', head_of_department: 'Head of department' };
function TeamRows({ rows }: { rows: NonNullable<JourneyDetail['teamRows']> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
          <span>{r.title} <span style={{ color: 'var(--ink-3)' }}>· {TEAM_OWNER[r.owner] ?? r.owner} · {r.step}</span></span>
          <span style={{ color: r.done ? 'var(--green, #15803D)' : 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.done ? `Done${r.doneByName ? ` · ${r.doneByName}` : ''}` : 'Not yet'}</span>
        </div>
      ))}
    </div>
  );
}

function TasksByPhase({ tasks, busy, onAction }: { tasks: TaskView[]; busy: string; onAction: (t: TaskView, a: 'done' | 'skip' | 'reopen') => void }) {
  const phases = PHASES.onboarding.filter((p) => tasks.some((t) => t.phase === p.key));
  if (!tasks.length) return <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No tasks yet. They come from the template once the offer is made.</div>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {phases.map((p) => {
        const list = tasks.filter((t) => t.phase === p.key).filter((t) => t.status !== 'cancelled');
        const done = list.filter((t) => t.status === 'done' || t.status === 'skipped').length;
        return (
          <div key={p.key}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 13.5, fontWeight: 600 }}>{p.title}</b>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{done} of {list.length} done</span>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {list.map((t) => {
                const st = TASK_STATUS[t.status] ?? TASK_STATUS.todo;
                const open = OPEN.has(t.status);
                return (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, padding: '8px 0', borderTop: '1px solid var(--line)', opacity: t.status === 'locked' ? 0.6 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>
                        {t.title}{t.month ? ` · month ${t.month}` : ''}
                        {t.mustDo && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--p-orange)' }}>Must-do</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
                        <OwnerChip role={t.ownerRole} name={t.ownerName} />
                        <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />
                        <span style={{ fontSize: 12, color: t.late ? 'var(--bad)' : 'var(--ink-3)' }}>
                          {t.status === 'done' ? `Done ${t.doneAt ? shortDay(t.doneAt) : ''}${t.doneByName ? ` by ${t.doneByName}` : ''}`
                            : t.status === 'locked' ? (t.opensAt ? `Opens ${shortDay(t.opensAt)}` : 'Opens later')
                              : t.dueLabel && !t.dueAt ? t.dueLabel : t.dueAt ? `Due ${dueText(t.dueAt, t.late)}` : ''}
                        </span>
                      </div>
                      {t.note && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, overflowWrap: 'anywhere' }}>{t.note}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                      {open && <button type="button" className="pd-btn sm" disabled={Boolean(busy)} onClick={() => onAction(t, 'done')}>Done</button>}
                      {open && !t.mustDo && <button type="button" className="pd-btn sm ghost" disabled={Boolean(busy)} onClick={() => onAction(t, 'skip')}>Skip</button>}
                      {(t.status === 'done' || t.status === 'skipped') && <button type="button" className="pd-btn sm ghost" disabled={Boolean(busy)} onClick={() => onAction(t, 'reopen')}>Reopen</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeoplePicker({ managerUserId, buddyUserId, exclude, emps, busy, onSave }: {
  managerUserId?: string; buddyUserId?: string; exclude?: string;
  emps: { id: string; name: string; role: string; exit?: { left: boolean } | null }[];
  busy: boolean; onSave: (patch: { managerUserId?: string; buddyUserId?: string }) => void;
}) {
  const [manager, setManager] = useState(managerUserId ?? '');
  const [buddy, setBuddy] = useState(buddyUserId ?? '');
  const people = useMemo(() => emps.filter((e) => !e.exit?.left && e.id !== exclude).sort((a, b) => a.name.localeCompare(b.name)), [emps, exclude]);
  const dirty = manager !== (managerUserId ?? '') || buddy !== (buddyUserId ?? '');
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Reporting manager" hint="Gets the set-up to-do in the app">
        <Pick value={manager} onChange={setManager}>
          <option value="">Not picked</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>)}
        </Pick>
      </Field>
      <Field label="Buddy" hint="A teammate for small questions; shows on the Day-1 pass">
        <Pick value={buddy} onChange={setBuddy}>
          <option value="">Not picked</option>
          {people.filter((p) => p.id !== manager).map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>)}
        </Pick>
      </Field>
      {dirty && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="pd-btn sm primary" disabled={busy} onClick={() => onSave({ ...(manager !== (managerUserId ?? '') ? { managerUserId: manager || undefined } : {}), ...(buddy !== (buddyUserId ?? '') ? { buddyUserId: buddy || undefined } : {}) })}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </div>
  );
}

/** The Day-1 pass HR fills in: shown to the candidate from Tj − 7. */
function Day1PassEditor({ value, tj, onSave, busy }: { value?: Day1Pass; tj?: string; onSave: (p: Day1Pass) => Promise<boolean>; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [p, setP] = useState<Day1Pass>(() => value ?? {});
  const [bring, setBring] = useState((value?.bring ?? []).join('\n'));
  const set = (patch: Partial<Day1Pass>) => setP((x) => ({ ...x, ...patch }));
  // What HR edits: the pass without the server's mark and the names it was made with.
  const editable = (v?: Day1Pass): Day1Pass => { const rest = { ...v }; delete rest.auto; delete rest.managerName; delete rest.buddyName; return rest; };
  const startEditing = () => { setP(editable(value)); setBring((value?.bring ?? []).join('\n')); setEditing(true); };
  if (!editing) {
    const auto = value?.auto;
    const filledIn = Boolean(auto || (value && (value.reportingTime || value.place || value.meetingLink)));
    // The server makes the pass from the template 7 days before joining (or on its next run, inside the week).
    const makesOn = tj ? addDays(tj, -7) : undefined;
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {auto && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Made automatically on {longDay(auto.at)} from the template. It follows the template and the joining date until you edit it.</div>}
        {filledIn ? (
          <Facts rows={[
            ['Date', longDay(auto ? tj : value?.date ?? tj)],
            ['Reporting time', value?.reportingTime],
            ['Place', value?.place],
            ['Map link', value?.mapLink ? <a key="m" href={value.mapLink} target="_blank" rel="noopener noreferrer">Directions</a> : ''],
            ['Meeting link', value?.meetingLink],
            ['Ask for', value?.askFor ? `${value.askFor.name}${value.askFor.phone ? ` · ${value.askFor.phone}` : ''}` : ''],
            ['Manager', auto ? value?.managerName : ''],
            ['Buddy', auto ? value?.buddyName : ''],
            ['HR contact', value?.hrContact ? [value.hrContact.name, value.hrContact.email, value.hrContact.phone].filter(Boolean).join(' · ') : ''],
            ['Bring', value?.bring?.length ? value.bring.join(', ') : ''],
            ['Agenda', value?.agenda?.length ? value.agenda.map((a) => `${a.time} ${a.title}${a.with ? ` (${a.with})` : ''}${a.taskKey ? ` · ${AGENDA_TASK_LABEL[a.taskKey]}` : ''}`).join(' · ') : ''],
          ]} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {makesOn && makesOn > todayKey()
              ? `Made automatically on ${longDay(makesOn)} from the template’s joining and reporting details, and shown to the candidate. You can fill it in yourself before then.`
              : 'Being made from the template’s joining and reporting details: it shows here within the hour. You can fill it in yourself instead.'}
          </div>
        )}
        <div><button type="button" className="pd-btn sm" onClick={startEditing}>{filledIn ? 'Edit pass' : 'Fill in now'}</button></div>
      </div>
    );
  }
  const agenda = p.agenda ?? [];
  type AgendaLine = NonNullable<Day1Pass['agenda']>[number];
  const setAgenda = (i: number, patch: Partial<AgendaLine>) => set({ agenda: agenda.map((a, n) => (n === i ? { ...a, ...patch } : a)) });
  // One line per task: a task picked on one line is not offered on another.
  const taken = (i: number) => new Set(agenda.filter((_, n) => n !== i).map((a) => a.taskKey).filter(Boolean));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Date"><input type="date" value={p.date ?? tj ?? ''} onChange={(e) => set({ date: e.target.value })} style={inputStyle} /></Field>
        <Field label="Reporting time"><input type="time" value={p.reportingTime ?? ''} onChange={(e) => set({ reportingTime: e.target.value })} style={inputStyle} /></Field>
      </div>
      <Field label="Place"><input value={p.place ?? ''} onChange={(e) => set({ place: e.target.value })} placeholder="e.g. Reception, Block A, Main Campus" style={inputStyle} /></Field>
      <Field label="Map link"><input value={p.mapLink ?? ''} onChange={(e) => set({ mapLink: e.target.value })} style={inputStyle} /></Field>
      <Field label="Meeting link" hint="For a remote first day"><input value={p.meetingLink ?? ''} onChange={(e) => set({ meetingLink: e.target.value })} style={inputStyle} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Ask for"><input value={p.askFor?.name ?? ''} onChange={(e) => set({ askFor: { ...p.askFor, name: e.target.value } })} placeholder="Name" style={inputStyle} /></Field>
        <Field label="Their phone"><input value={p.askFor?.phone ?? ''} onChange={(e) => set({ askFor: { name: p.askFor?.name ?? '', phone: e.target.value } })} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="HR contact"><input value={p.hrContact?.name ?? ''} onChange={(e) => set({ hrContact: { ...p.hrContact, name: e.target.value } })} placeholder="Name" style={inputStyle} /></Field>
        <Field label="HR email"><input value={p.hrContact?.email ?? ''} onChange={(e) => set({ hrContact: { name: p.hrContact?.name ?? '', ...p.hrContact, email: e.target.value } })} style={inputStyle} /></Field>
      </div>
      <Field label="What to bring" hint="One per line"><textarea value={bring} onChange={(e) => setBring(e.target.value)} style={{ ...areaStyle, minHeight: 70 }} placeholder={'Original ID proof\nTwo passport photos'} /></Field>
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Agenda</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {agenda.map((a, i) => (
            <div key={a.id ?? `new-${i}`} data-agenda-line={i} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) minmax(0, 0.8fr) auto', gap: 6, alignItems: 'center' }}>
              <input type="time" value={a.time} onChange={(e) => setAgenda(i, { time: e.target.value })} aria-label="Time" style={inputStyle} />
              <input value={a.title} onChange={(e) => setAgenda(i, { title: e.target.value })} placeholder="What" aria-label="What" style={inputStyle} />
              <input value={a.with ?? ''} onChange={(e) => setAgenda(i, { with: e.target.value })} placeholder="With / where" aria-label="With or where" style={inputStyle} />
              <button type="button" className="pd-btn sm ghost" aria-label="Remove" onClick={() => set({ agenda: agenda.filter((_, n) => n !== i) })}>×</button>
              {/* Which Day-1 task this line is: its meeting follows the pick, not the words in the title. */}
              <label style={{ gridColumn: '2 / 4', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>Meeting for</span>
                <span className="pd-pick" style={{ flex: 1, minWidth: 0 }}>
                  <select className="pd-inp" aria-label={`Meeting for, line ${i + 1}`} value={a.taskKey === undefined ? 'auto' : a.taskKey ?? ''}
                    onChange={(e) => setAgenda(i, { taskKey: e.target.value === 'auto' ? undefined : (e.target.value || null) as AgendaLine['taskKey'] })} style={{ width: '100%', height: 32, fontSize: 12.5 }}>
                    {a.taskKey === undefined && <option value="auto">From the title (decided when saved)</option>}
                    <option value="">No task, just on the agenda</option>
                    {AGENDA_TASK_KEYS.map((k) => <option key={k} value={k} disabled={taken(i).has(k)}>{AGENDA_TASK_LABEL[k]}{taken(i).has(k) ? ' (on another line)' : ''}</option>)}
                  </select>
                </span>
              </label>
            </div>
          ))}
          <div><button type="button" className="pd-btn sm" onClick={() => set({ agenda: [...agenda, { time: '10:00', title: '', taskKey: null }] })}>+ Add to the agenda</button></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="pd-btn sm" onClick={() => { setP(value ?? {}); setBring((value?.bring ?? []).join('\n')); setEditing(false); }} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn sm primary" disabled={busy} onClick={async () => {
          const clean: Day1Pass = { ...p, bring: bring.split('\n').map((x) => x.trim()).filter(Boolean), agenda: agenda.filter((a) => a.title.trim()) };
          if (await onSave(clean)) setEditing(false);
        }}>{busy ? 'Saving…' : 'Save pass'}</button>
      </div>
    </div>
  );
}
