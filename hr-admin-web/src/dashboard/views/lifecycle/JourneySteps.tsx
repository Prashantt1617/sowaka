// The joiner's journey, as the board design of 18 Nov draws it: eight steps (Offer sent, Offer
// confirmed, Joining day, Week 1, Month 1, Months 2–5, Final month, Confirmed), each with its
// circle, its line and, opened, what HR does there: the offer and its PDF, the portal, the
// employee profile's progress, documents and letters, the Day-1 pass, manager and buddy, the tasks
// of each phase, the bank/PF change, probation and its decision. The employee profile is not a step
// of its own (23 Nov): it fills in as pre-boarding goes on, so Joining day carries its progress. Week 1
// (23 Nov) is HR's setup (KPI, salary and shift templates, assigned in place) and Devices and accesses,
// not the joiner's own week-1 list (they do that in the app). Drawn by the joiner panel and by the
// pre-boarding profile's Activity tab, identically.
//
// Reviews (24 Nov): a check or decision whose work lives elsewhere (Review documents, Check the joining
// form, Check their payroll details, the confirmation review, approval, decision and letter) is a row with
// Open, never Done / Skip: Open goes to where it is done (the profile page's card, the decision, the
// letter), the action there marks it done (the server's `reviews`), and Open stays to look again. HR's, IT's
// and Admin's own tasks (Devices and accesses) have no "not open yet": Done / Skip from the start, and
// Delayed once their day has passed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { Pill } from '../../ui';
import {
  decideDateRequest, fetchLifecycleFile, journeyTaskAction, listTemplates, reviewDocument, updateJourney,
} from '../../../services/lifecycle';
import type {
  BankPfRequest, CandidateDocumentView, ConfirmationDecision, JourneyDetail, JourneyReview, LetterView, OwnerRole, TaskView, TemplateListItem,
} from '../../../services/lifecycle';
import { FilePreview, NoteDialog, OwnerChip, Pick, Field } from './shared';
import { IconChevronDown, IconDownload } from '../../icons';
import {
  PHASES, changedFieldsText, daysTo, dayTime, decisionLine, dueText, errText, firstName, longDay, openDocuments, rupees, sectionLabel, shortDay, todayKey,
} from './format';
import { Day1PassBlock } from './Day1Pass';
import { ConfirmationLetter } from './ConfirmationLetter';
import { DecisionDialog, ProbationMonths, RecommendationNote } from './Probation';
import { KIND_LABEL } from './letterDoc';
import { downloadFile } from './DocumentParts';
import { pctColour, weekOf } from './boardModel';
import { preboardingHref } from './preboardingLinks';
import { AssignSetupDialog, HrSetupRows } from './Week1Setup';
import { SETUP_KINDS, setupDoneCount, useWeek1Setup } from './week1SetupData';
import type { SetupKind } from './week1SetupData';

const TASK_STATUS: Record<string, { label: string; tone: { bg: string; fg: string } }> = {
  locked: { label: 'Not open yet', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' } },
  todo: { label: 'To do', tone: { bg: 'var(--attn-bg)', fg: 'var(--attn)' } },
  in_review: { label: 'In review', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  sent_back: { label: 'Sent back', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  done: { label: 'Done', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
  skipped: { label: 'Skipped', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
  cancelled: { label: 'Cancelled', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' } },
};
const LETTER_STATE: Record<string, string> = { draft: 'Draft', sent: 'Sent', ready: 'Ready to sign', opened: 'Opened', signed: 'Signed' };
/** A task still waiting on someone. */
export const OPEN = new Set(['todo', 'in_review', 'sent_back']);
/** The statuses before joining. */
export const PRE_JOIN = new Set(['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved']);

/** The eight steps, and the step each board column is on (pre-boarding's documents and letters are on Joining day). */
const STEPS = ['Offer sent', 'Offer confirmed', 'Joining day', 'Week 1 · onboarding tasks', 'Month 1 · settling in', 'Months 2–5 · growing', 'Final month · decision', 'Confirmed'];
/** The steps the panel's own buttons open (Review documents, Generate confirmation letter). */
export const JOINING_STEP = 2;
export const CONFIRMED_STEP = 7;
const STEP_AT: Record<string, number> = {
  offer_sent: 0, accepted: 1, documents: 2, letters: 2, ready_to_join: 2, day1: 3, week1_tasks: 3, day7_survey: 3, week_done: 3,
  month1: 4, months_2_5: 5, final_month: 6, confirmed: 7,
};
/** The tasks the joiner owns (alone, or with their manager): the tasks the journey lists (panel and profile alike), outside Week 1. */
const JOINER_OWNS = new Set<OwnerRole>(['employee', 'manager_employee']);
/**
 * Week 1's Devices and accesses: the template's access rows (Laptop, Work email, Office Wi-Fi, Sowaka Connect;
 * the server marks them), or on an older template the first-week tasks IT or Admin own (Set up laptop and login).
 */
/** The tasks HR and the teams do from the dashboard: never "not open yet", Done / Skip from the start (the server agrees). */
const STAFF_OWNS = new Set<OwnerRole>(['hr', 'it', 'admin', 'finance']);
/** Not done and its day has passed: Delayed (a task HR or a team does, whether or not it has opened). */
const isDelayed = (t: TaskView) => (OPEN.has(t.status) || (t.status === 'locked' && STAFF_OWNS.has(t.ownerRole))) && Boolean(t.dueAt) && t.dueAt!.slice(0, 10) < todayKey();
const isDeviceTask = (t: TaskView) => t.section === 'access' || (!t.section && t.phase === 'first_week' && (t.ownerRole === 'it' || t.ownerRole === 'admin') && t.kind !== 'meeting');

type StepDialog =
  | { kind: 'decision' }
  | { kind: 'task'; task: TaskView; action: 'done' | 'skip' | 'reopen' }
  | { kind: 'sendback'; doc: CandidateDocumentView }
  | { kind: 'date'; id: string; decision: 'approve' | 'decline'; day: string }
  | { kind: 'file'; id: string; name: string }
  | { kind: 'assign'; what: SetupKind }
  | null;

/** Each review's step on the journey. */
const REVIEW_STEP: Record<JourneyReview['step'], number> = { joining_day: 2, week_1: 3, final_month: 6, confirmed: 7 };

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

/**
 * The employee profile on Joining day: one row, its progress (the portal's "n of 5 sections done") and the link
 * to the candidate's pre-boarding profile (its own page, in a new tab), where HR sees every section and its
 * documents and approves each one. No link on that page itself.
 */
function ProfileRow({ text, pct, href }: { text: string; pct: number; href?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13, fontWeight: 500 }}>Employee profile</b>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{text} · <b style={{ color: pctColour(pct), fontWeight: 600 }}>{pct}%</b></span>
        </span>
        <span style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} /></span>
      </span>
      {href && (
        <a href={href} target="_blank" rel="noopener" className="pd-btn sm" style={{ flex: 'none' }} title="Every section and its documents, to review and approve (opens in a new tab)">
          Open
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </a>
      )}
    </div>
  );
}

/** The design's pencil, beside Edit offer. */
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
);

const doneOf = (list: TaskView[]) => list.filter((t) => t.status === 'done' || t.status === 'skipped').length;

/**
 * The Journey: its heading ("Step 3 of 8") and the eight steps. HR's actions inside a step (tasks, documents,
 * the Day-1 pass, manager and buddy, date requests, the bank/PF change, the decision) work in place; `busy` and
 * `setBusy` are the caller's, so its own buttons wait too, and `onChanged` reloads the journey after each one.
 *
 * The joiner panel and the pre-boarding profile's Activity tab draw the same steps and rows: the joiner's own
 * tasks (no manager / buddy / HR / head-of-department tasks, no team tasks from the app, 23 Nov), except Week 1,
 * which is HR's setup (KPI, salary and shift templates) and the IT access rows under Devices and accesses.
 * Every step starts closed and opens with its chevron (several at once); `openStep` opens one from outside.
 *
 * `variant` only decides the Employee profile link on Joining day: 'panel' (the joiner panel) has it,
 * 'profile' (the pre-boarding profile's Activity tab) does not, being on that page already; there a review's
 * Open brings the page's own card into view (`onOpenCard`) instead of a new tab.
 *
 * One step is open at a time (opening one closes the other); all start closed.
 */
export function JourneySteps({ data, busy, setBusy, onChanged, variant = 'panel', openStep = null, onOpenStep, onDialogOpen, onOpenCard }: {
  data: JourneyDetail; busy: string; setBusy: (key: string) => void; onChanged: () => void;
  variant?: 'panel' | 'profile';
  openStep?: number | null; onOpenStep?: (step: number) => void;
  /** On the pre-boarding profile page: a review done on one of its cards opens that card in place (not a new tab). */
  onOpenCard?: (card: string) => void;
  /** Told when a dialog opens or closes (the panel then leaves Escape to the dialog). */
  onDialogOpen?: (open: boolean) => void;
}) {
  const s = useStore();
  const { user, emps, flash } = s;
  const pay = canSeePay(user);
  const [dialog, setDialog] = useState<StepDialog>(null);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const onProfilePage = variant === 'profile';
  useEffect(() => { listTemplates('onboarding').then(setTemplates).catch(() => undefined); }, []);
  useEffect(() => { onDialogOpen?.(dialog !== null); }, [dialog, onDialogOpen]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(key);
    try { await fn(); if (ok) flash(ok); onChanged(); return true; } catch (e) { flash(errText(e), 'error'); return false; } finally { setBusy(''); }
  };
  const closeDialog = () => setDialog(null);

  const { journey, tasks, documents, letters, offer, dateRequests, probation } = data;
  // This joiner's joining and reporting details (their copy of the template, from the server): what the portal's Day-1 pass
  // shows where HR has not typed this joiner's own. Never the template as it is now: an edit reaches new joiners only.
  const name = journey.candidate?.name ?? 'Joiner';
  const first = firstName(name);
  const status = String(journey.status);
  const closed = ['declined', 'expired', 'not_joining'].includes(status);
  const reviewQueue = documents.filter((d) => d.status === 'in_review').length;
  const decision: ConfirmationDecision | undefined = probation.decision ?? journey.probation?.decision;
  const revisionWaiting = Boolean(offer && offer.status === 'draft' && offer.version > 1);
  // The candidate's pre-boarding profile page: where HR approves each section (opens in a new tab). Not on that page itself.
  const profileHref = !onProfilePage && canOpen(user, 'preboarding') ? preboardingHref(journey.id) : undefined;

  // Where they are on the eight steps; the Confirmed column has every step done.
  const cur = STEP_AT[journey.column] ?? 0;
  const allDone = journey.column === 'confirmed';
  // Every step starts closed (both screens, 23 Nov); its chevron opens it and closes the one open (24 Nov: one at a time).
  // The panel's own buttons (Generate confirmation letter) open a step through `openStep`.
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => { setOpened(null); }, [journey.id]);
  useEffect(() => { if (openStep !== null && openStep >= 0) setOpened(openStep); }, [openStep]);
  const toggle = (i: number) => {
    setOpened((cur) => (cur === i ? null : i));
    onOpenStep?.(-1); // the panel's buttons can open the same step again later
  };
  // A review whose place is on the journey itself (the decision, the recommendation, the letter): its step opens
  // and the place is brought into view.
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollTo, setScrollTo] = useState<{ place: string; n: number } | null>(null);
  useEffect(() => {
    if (!scrollTo) return undefined;
    const t = window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-place="${scrollTo.place}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow .3s'; el.style.borderRadius = '12px';
      el.style.boxShadow = '0 0 0 3px var(--accent)';
      window.setTimeout(() => { el.style.boxShadow = 'none'; }, 2200);
    }, 60);
    return () => window.clearTimeout(t);
  }, [scrollTo]);
  const showPlace = (step: number, place: string) => { setOpened(step); setScrollTo((c) => ({ place, n: (c?.n ?? 0) + 1 })); };

  // The tasks of each step (the joiner's own only, lines and lists alike): pre-boarding under Joining day,
  // the first week under Week 1, probation by month.
  const live = tasks.filter((t) => t.status !== 'cancelled' && JOINER_OWNS.has(t.ownerRole));
  const probationTotal = (journey.probation?.months ?? 0) + (journey.probation?.extendedBy ?? 0);
  const preTasks = live.filter((t) => t.phase === 'pre_boarding');
  // Week 1: HR's setup (what they are on now, loaded once they have an account: joined, or app access given; before
  // that, what HR chose for when they join, `journey.pendingSetup`) and the IT access rows. The joiner's own week-1
  // tasks are theirs in the app, not listed here.
  const accountId = journey.userId ?? journey.appAccess?.userId;
  const hasAccount = Boolean(accountId);
  const setup = useWeek1Setup(accountId);
  const devices = tasks.filter((t) => t.status !== 'cancelled' && isDeviceTask(t));
  const { done: setupDone, known: setupKnown } = setupDoneCount(setup, hasAccount, journey.pendingSetup);
  const setupLine = setupKnown ? `${setupDone} of ${SETUP_KINDS.length} set up` : '';
  const probTasks = live.filter((t) => t.phase === 'probation');
  const monthOneTasks = probTasks.filter((t) => t.month === 1);
  const finalTasks = probTasks.filter((t) => !t.month || (probationTotal > 1 && t.month >= probationTotal));
  const middleTasks = probTasks.filter((t) => !monthOneTasks.includes(t) && !finalTasks.includes(t));
  // The employee profile's progress on Joining day: its sections (the portal's "n of 5"), else the pre-boarding tasks.
  const sections = journey.profileSections;
  const profilePct = sections?.total ? Math.round((sections.done / sections.total) * 100) : preTasks.length ? Math.round((doneOf(preTasks) / preTasks.length) * 100) : 0;
  const profileText = sections?.total ? `${sections.done} of ${sections.total} sections done` : `${doneOf(preTasks)} of ${preTasks.length} tasks done`;

  const downloadOffer = async () => {
    if (!offer?.pdfFileId) return;
    setBusy('pdf');
    try { downloadFile(await fetchLifecycleFile(offer.pdfFileId), `Offer letter · ${name} · v${offer.version}.pdf`); } catch (e) { flash(errText(e, 'Could not download the offer letter'), 'error'); } finally { setBusy(''); }
  };

  const sentAt = offer?.sentAt ?? [...(offer?.versions ?? [])].reverse().find((v) => v.sentAt)?.sentAt;
  const acceptedAt = offer?.acceptedAt ?? [...(offer?.versions ?? [])].reverse().find((v) => v.acceptedAt)?.acceptedAt;
  const replyIn = offer?.validTill ? daysTo(offer.validTill) : null;
  // Add user › Confirm new user: the offer was given outside the app, and its portal sign-in emailed only if HR asked.
  const outside = offer?.outsideApp;
  const portalSent = !['draft', 'offer_sent', 'accepted'].includes(status) && !closed && (!outside || outside.portalEmailed);
  const outsideLine = outside ? `Offer given outside the app · confirmed by ${outside.byName} on ${longDay(outside.at)}` : '';
  const pendingDates = dateRequests.filter((r) => r.status === 'pending').length;

  // Each step's line under its name.
  const sub = (i: number, state: 'done' | 'current' | 'todo'): { text: string; red?: boolean } => {
    // A probation step's line names its own next open task (never an older phase's late one).
    const own = i === 4 ? monthOneTasks : i === 5 ? middleTasks : finalTasks;
    const lead = own.filter((t) => OPEN.has(t.status)).sort((a, b) => String(a.dueAt ?? '9999').localeCompare(String(b.dueAt ?? '9999')))[0];
    const leadLine = lead ? { text: lead.dueAt ? `${lead.title} · ${dueText(lead.dueAt, lead.late)}` : lead.title, red: Boolean(lead.late) } : { text: 'Nothing waiting' };
    switch (i) {
      case 0:
        if (outside) return { text: 'Given outside the app' };
        if (state === 'done') return { text: sentAt ? `Sent ${shortDay(sentAt)}` : 'Sent before joining' };
        if (status === 'draft') return { text: revisionWaiting ? 'Revision saved, not sent' : 'Not sent yet' };
        if (replyIn !== null && replyIn < 0) return { text: `Overdue by ${-replyIn} day${replyIn === -1 ? '' : 's'}`, red: true };
        return { text: `Sent ${shortDay(sentAt)}${offer?.validTill ? ` · reply by ${shortDay(offer.validTill)}` : ''}` };
      case 1:
        if (outside) return { text: `Confirmed ${shortDay(outside.at)} · ${outside.portalEmailed ? 'portal sent' : 'portal not emailed'}` };
        if (state === 'todo') return { text: `Waiting for ${first}’s reply` };
        if (state === 'done') return { text: `Accepted ${acceptedAt ? shortDay(acceptedAt) : ''} · portal sent` };
        return { text: `Accepted ${acceptedAt ? shortDay(acceptedAt) : ''} · portal not sent yet` };
      case 2:
        if (state === 'done') return { text: `Joined ${shortDay(journey.tj)}` };
        return { text: `${journey.tj ? `${shortDay(journey.tj)}${state === 'current' ? ` · ${weekOf(journey.tj)}` : ''}` : 'Not set'}${state === 'current' && reviewQueue ? ` · ${reviewQueue} to review` : ''}` };
      case 3: {
        // Choices made before joining count as set up.
        if (state === 'todo') return { text: setupDone ? `Starts on the joining day · ${setupLine}` : 'Starts on the joining day' };
        const parts = [
          setupLine,
          devices.length ? `${doneOf(devices)} of ${devices.length} devices and accesses` : '',
        ].filter(Boolean);
        return { text: parts.join(' · ') || 'Nothing waiting', red: state === 'current' && devices.some(isDelayed) };
      }
      case 7:
        return state === 'done' || allDone ? { text: decision ? decisionLine(decision, pay) : 'Confirmed' } : { text: 'After probation' };
      default:
        if (state === 'done') return { text: 'Done' };
        if (state === 'current') return leadLine;
        return { text: 'Not started' };
    }
  };

  // The reviews (the server's, each done where it lives) and where Open takes HR.
  const reviews = data.reviews ?? [];
  const canProfile = canOpen(user, 'preboarding');
  const cardOf = (r: JourneyReview) => (r.place === 'documents' ? 'documents' : r.place === 'bank_pf' ? 'bank' : r.place === 'tax' ? 'tax' : r.place === 'joining_form' ? r.focus ?? 'personal' : undefined);
  const reviewOpen = (r: JourneyReview): ReviewOpen | null => {
    const card = cardOf(r);
    if (card) {
      if (onProfilePage) return onOpenCard ? { go: () => onOpenCard(card), hint: 'Opens the card on this page' } : null;
      return canProfile ? { href: preboardingHref(journey.id, card), hint: `Opens ${first}’s profile page on the card (new tab)` } : null;
    }
    if (r.place === 'decision') {
      const canDecide = journey.column === 'final_month' && status !== 'confirmed';
      return canDecide ? { go: () => setDialog({ kind: 'decision' }), hint: 'The decision: confirm, extend or not confirm' } : { go: () => showPlace(6, 'decision'), hint: 'The decision on Final month' };
    }
    // Theirs, in the app: Open shows what they sent once there is something to show.
    if (r.place === 'recommendation') {
      const sent = probation.recommendation ?? journey.probation?.recommendation ?? probation.hodApproval ?? journey.probation?.hodApproval;
      return sent ? { go: () => showPlace(6, 'recommendation'), hint: 'What the manager and the head of department sent from the app' } : null;
    }
    if (r.place === 'letter') {
      if (decision?.outcome === 'extend') return { go: () => openDocuments(s.setView, 'extension', journey.id), hint: 'The extension letter, in Documents' };
      return { go: () => showPlace(7, 'letter'), hint: 'The confirmation letter on Confirmed' };
    }
    return null;
  };
  const reviewRows = (i: number) => {
    const list = reviews.filter((r) => REVIEW_STEP[r.step] === i);
    return list.length ? <div style={{ display: 'grid', gap: 8 }}>{list.map((r) => <ReviewRow key={r.key} review={r} open={reviewOpen(r)} />)}</div> : null;
  };

  const taskList = (list: TaskView[]) => <TasksByPhase tasks={list} busy={busy} onAction={(task, action) => setDialog({ kind: 'task', task, action })} />;
  // A step's tasks; when it has none, `empty` before the step is reached, a plain line once it is.
  const stepTasks = (i: number, list: TaskView[], empty?: string): ReactNode => {
    if (list.length) return taskList(list);
    if (allDone || i <= cur) return <Para>Nothing here for {first} to do.</Para>;
    return empty ? <Para>{empty}</Para> : null;
  };

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
            ['Offer', `Version ${offer.version}`],
            ...(outside ? [['Given', 'Outside the app'] as [string, ReactNode]] : [['Sent on', sentAt ? longDay(sentAt) : '—'] as [string, ReactNode], ['Reply by', longDay(offer.validTill)] as [string, ReactNode]]),
            ['Personal email', journey.candidate?.personalEmail],
          ]} />
          {outside && <Para>{outsideLine}. No offer letter went from the app.</Para>}
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
      ) : <Para>No offer yet. Add user › Create new offer starts one.</Para>;
      case 1:
        if (outside) {
          return (
            <>
              <Para>{outsideLine}.{outside.portalEmailed ? ' Their joining portal sign-in went to their personal email.' : ' Nothing was emailed: their joining portal is ready, and they sign in with a code sent to their personal email.'}</Para>
              <Facts rows={[['Joining portal', <span key="p" style={{ color: outside.portalEmailed ? 'var(--ok)' : 'var(--warn)' }}>{outside.portalEmailed ? 'Link sent' : 'Ready · not emailed'}</span>], ['Personal email', journey.candidate?.personalEmail], ['Work email', journey.candidate?.workEmail]]} />
            </>
          );
        }
        if (cur < 1 && !allDone) return <Para>{first} gets the offer PDF by email and replies to you to accept it. Then Mark offer accepted sends the joining portal link, where they sign in with a code to their email.</Para>;
        return (
          <>
            <Para>{first} accepted the offer{acceptedAt ? ` on ${dayTime(acceptedAt)}` : ''}.{status === 'accepted' ? ' Mark offer accepted sends the joining portal link to their personal email.' : ''}</Para>
            <Facts rows={[['Joining portal', <span key="p" style={{ color: portalSent || cur > 1 ? 'var(--ok)' : 'var(--warn)' }}>{portalSent || cur > 1 ? 'Link sent' : 'Not sent yet'}</span>], ['Personal email', journey.candidate?.personalEmail], ['Work email', journey.candidate?.workEmail]]} />
          </>
        );
      case 2:
        // Joining day: the employee profile's progress first (its documents are reviewed on the profile page),
        // the letters, then the joining details (date requests, the Day-1 pass, manager and buddy).
        return (
          <>
            {cur >= 2 || allDone
              ? <ProfileRow text={profileText} pct={profilePct} href={profileHref} />
              : <Para>The employee profile opens once the offer is accepted and the joining portal is sent.</Para>}
            {/* For HR: have they got the app and used it (signed in, punched in)? */}
            <Facts rows={[
              ['Logged into the app', data.appSignIn?.signedIn ? `Yes${data.appSignIn.firstAt ? ` · ${shortDay(data.appSignIn.firstAt)}` : ''}` : 'No'],
              ['Punched in', data.firstPunch?.punched ? `Yes${data.firstPunch.at ? ` · ${shortDay(data.firstPunch.at)}` : ''}` : 'No'],
            ]} />
            {reviewRows(2)}
            {letters.length > 0 && <Sub>Letters</Sub>}
            {letters.length > 0 && <div style={{ display: 'grid', gap: 8 }}>{letters.map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}</div>}
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
                <Day1PassBlock key={journey.id} value={journey.day1Pass} tj={journey.tj} reporting={data.reporting}
                  people={{ name, designation: journey.designation ?? offer?.fields.designation, department: journey.department ?? offer?.fields.department, managerName: journey.managerName, buddyName: journey.buddyName }}
                  onSave={(p) => run('pass', () => updateJourney(journey.id, { day1Pass: p }), 'Day-1 pass saved')} busy={busy === 'pass'} />
              </>
            )}
            {!closed && (
              <>
                <Sub>Manager and buddy</Sub>
                <PeoplePicker key={`${journey.managerUserId}-${journey.buddyUserId}`} managerUserId={journey.managerUserId} buddyUserId={journey.buddyUserId} exclude={journey.userId}
                  emps={emps} busy={busy === 'people'} onSave={(patch) => run('people', () => updateJourney(journey.id, patch), 'Saved')} />
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
      case 3:
        return (
          <>
            <HrSetupRows setup={setup} hasAccount={hasAccount} pending={journey.pendingSetup} busy={Boolean(busy)} onAssign={(what) => setDialog({ kind: 'assign', what })} />
            {devices.length > 0 && <DevicesBlock key={journey.id} tasks={devices} busy={busy} onAction={(task, action) => setDialog({ kind: 'task', task, action })} />}
            {reviewRows(3)}
            {journey.day1Feeling && <Facts rows={[['How was Day 1', `${DAY1_FEELING[journey.day1Feeling.answer] ?? journey.day1Feeling.answer} · ${shortDay(journey.day1Feeling.at)}`]]} />}
          </>
        );
      case 4: return stepTasks(4, monthOneTasks, 'Month-1 goals and check-ins open after the first week.');
      case 5: return stepTasks(5, middleTasks, 'A check-in each month until the final month.');
      case 6:
        return (
          <>
            {reviewRows(6)}
            {finalTasks.length > 0 && taskList(finalTasks)}
            {probation.months.length > 0 && <><Sub>Every month</Sub><ProbationMonths months={probation.months} total={probationTotal} /></>}
            <div data-place="recommendation"><RecommendationNote recommendation={probation.recommendation ?? journey.probation?.recommendation} hodApproval={probation.hodApproval ?? journey.probation?.hodApproval} /></div>
            <div data-place="decision" style={{ display: 'grid', gap: 8 }}>
              {decision && <div className="pd-note">{decisionLine(decision, pay)}</div>}
              {journey.column === 'final_month' && status !== 'confirmed' && <span><button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'decision' })}>{decision ? 'Change decision' : 'Record decision'}</button></span>}
            </div>
            {!finalTasks.length && !probation.months.length && !decision && !reviews.some((r) => REVIEW_STEP[r.step] === 6) && <Para>The final check-in and the decision to confirm or extend.</Para>}
          </>
        );
      default: {
        // Confirmed (the decision, or the journey): the confirmation letter is made, sent and resent here.
        const confirmed = decision?.outcome === 'confirm' || status === 'confirmed';
        return decision || confirmed ? (
          <>
            {reviewRows(7)}
            {decision && <Para>{decisionLine(decision, pay)}</Para>}
            {confirmed && (
              <div data-place="letter">
                <ConfirmationLetter journeyId={journey.id} name={name} letters={letters} decision={decision} busy={busy} setBusy={setBusy} flash={flash} onChanged={onChanged}
                  onView={(id, n) => setDialog({ kind: 'file', id, name: n })} />
              </div>
            )}
            {letters.filter((l) => l.kind === 'extension' || (!confirmed && l.kind === 'confirmation')).map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}
          </>
        ) : <>{reviewRows(7)}<Para>The confirmation letter goes out once the decision is recorded.</Para></>;
      }
    }
  };

  return (
    <div ref={rootRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ ...sectionLabel, margin: 0 }}>Journey</h3>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{allDone ? 'Confirmed' : `Step ${Math.min(cur + 1, STEPS.length)} of ${STEPS.length}`}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        {STEPS.map((title, i) => {
          const state: 'done' | 'current' | 'todo' = allDone || i < cur ? 'done' : i === cur && !closed ? 'current' : 'todo';
          const line = sub(i, state);
          const open = opened === i;
          const tag = state === 'current' && i === JOINING_STEP && journey.tj ? weekOf(journey.tj) : '';
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
                <button type="button" aria-expanded={open} aria-controls={`lf-step-${i}`} onClick={() => toggle(i)}
                  style={{ ...headStyle, cursor: 'pointer', background: open ? 'var(--surface-2)' : state === 'current' ? 'var(--accent-soft)' : 'transparent' }}>
                  {head}
                  <IconChevronDown size={16} stroke="var(--ink-3)" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                </button>
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
      {dialog?.kind === 'file' && <FilePreview fileId={dialog.id} name={dialog.name} onClose={closeDialog} />}
      {dialog?.kind === 'assign' && (
        <AssignSetupDialog kind={dialog.what} setup={setup} journeyId={journey.id} userId={accountId} pending={journey.pendingSetup} name={name}
          offerCtc={offer?.fields.ctc} tj={journey.tj ?? offer?.fields.tj}
          onClose={closeDialog} onDone={(message, changed) => { closeDialog(); flash(message); if (changed) onChanged(); }} />
      )}
    </div>
  );
}

/**
 * An older week-1 bank / PF change the joiner asked for (the profile page's Salary details shows it under Bank
 * account and PF, where HR decides it): payroll keeps the old details until someone with payroll access approves.
 */
export function BankPfRequestCard({ request, pay, busy, onDecide }: { request: BankPfRequest; pay: boolean; busy: boolean; onDecide: (d: 'approve' | 'decline') => void }) {
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

function TasksByPhase({ tasks, busy, onAction }: { tasks: TaskView[]; busy: string; onAction: (t: TaskView, a: TaskAction) => void }) {
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
              {list.map((t) => <TaskRow key={t.id} task={t} busy={busy} onAction={onAction} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TaskAction = 'done' | 'skip' | 'reopen';

/** Where a review's Open goes: a link (the profile page, a new tab) or an action here. */
type ReviewOpen = { href?: string; go?: () => void; hint: string };

const ExternalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);

/**
 * A review: what it is, whose (the manager's and the head of department's are theirs, in the app), Done with
 * who and when or what it waits for, and Open to where it is done. No Done / Skip: the action there does it,
 * and Open stays once it is done, to look again.
 */
function ReviewRow({ review: r, open }: { review: JourneyReview; open: ReviewOpen | null }) {
  const tone = r.done ? TASK_STATUS.done.tone : TASK_STATUS.todo.tone;
  return (
    <div data-review={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        <b style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{r.title}</b>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {r.owner !== 'hr' && <OwnerChip role={r.owner} />}
          <Pill label={r.done ? 'Done' : 'To do'} tone={tone} fontSize={11} padding="2px 9px" />
          <span style={{ fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
            {r.done ? `${r.doneAt ? shortDay(r.doneAt) : ''}${r.doneByName ? ` by ${r.doneByName}` : ''}`.trim() : r.line}
          </span>
        </span>
      </span>
      {open && (open.href
        ? <a href={open.href} target="_blank" rel="noopener" className="pd-btn sm" style={{ flex: 'none' }} title={open.hint}>Open<ExternalIcon /></a>
        : <button type="button" className="pd-btn sm" style={{ flex: 'none' }} title={open.hint} onClick={open.go}>Open</button>)}
    </div>
  );
}

const DELAYED = { bg: 'var(--bad-bg)', fg: 'var(--bad)' };

/**
 * One task: its title, owner, status and due day, and Done / Skip / Reopen. HR's, IT's and Admin's own tasks
 * have no "not open yet" (24 Nov): To do with Done / Skip from the start; Delayed once their day has passed.
 */
function TaskRow({ task: t, busy, onAction }: { task: TaskView; busy: string; onAction: (t: TaskView, a: TaskAction) => void }) {
  const early = t.status === 'locked' && STAFF_OWNS.has(t.ownerRole);
  const st = TASK_STATUS[early ? 'todo' : t.status] ?? TASK_STATUS.todo;
  const open = OPEN.has(t.status) || early;
  const delayed = isDelayed(t);
  const locked = t.status === 'locked' && !early;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, padding: '8px 0', borderTop: '1px solid var(--line)', opacity: locked ? 0.6 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>
          {t.title}{t.month ? ` · month ${t.month}` : ''}
          {t.mustDo && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--p-orange)' }}>Must-do</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <OwnerChip role={t.ownerRole} name={t.ownerName} />
          {delayed ? <Pill label="Delayed" tone={DELAYED} fontSize={11} padding="2px 9px" /> : <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />}
          <span style={{ fontSize: 12, color: delayed ? 'var(--bad)' : 'var(--ink-3)' }}>
            {t.status === 'done' ? `Done ${t.doneAt ? shortDay(t.doneAt) : ''}${t.doneByName ? ` by ${t.doneByName}` : ''}`
              : delayed ? `Was due ${shortDay(t.dueAt!)}`
                : locked ? (t.opensAt ? `Opens ${shortDay(t.opensAt)}` : 'Opens later')
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
}

/**
 * Week 1's Devices and accesses: IT's (and HR's) access rows behind one line with its progress bar
 * ("x of N done") and a chevron. Closed until HR opens it; the rows keep their Done / Skip / Reopen.
 */
function DevicesBlock({ tasks, busy, onAction }: { tasks: TaskView[]; busy: string; onAction: (t: TaskView, a: TaskAction) => void }) {
  const [open, setOpen] = useState(false);
  const done = doneOf(tasks);
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const late = tasks.some(isDelayed);
  return (
    <div data-devices style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
      <button type="button" aria-expanded={open} aria-controls="lf-devices" onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: 0, background: 'transparent', padding: '10px 12px', textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13, fontWeight: 500 }}>Devices and accesses</b>
            <span style={{ fontSize: 11.5, color: late ? 'var(--bad)' : 'var(--ink-3)' }}>{done} of {tasks.length} done{late ? ' · delayed' : ''}</span>
          </span>
          <span style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} /></span>
        </span>
        <IconChevronDown size={16} stroke="var(--ink-3)" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <div id="lf-devices" style={{ display: 'grid', gap: 2, padding: '0 12px 4px' }}>
          {tasks.map((t) => <TaskRow key={t.id} task={t} busy={busy} onAction={onAction} />)}
        </div>
      )}
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
      <Field label="Reporting manager" hint="Their reporting manager; shows on the Day-1 pass">
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
