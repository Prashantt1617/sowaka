// H1b · the joiner side panel, as the board design of 18 Nov draws it: the plant
// and who they are, then one journey timeline for every tab (Offer sent, Offer
// confirmed, Employee profile, Joining day, Week 1, Month 1, Months 2–5, Final
// month, Confirmed). The step they are on opens by itself; any step opens in
// place with what HR does there: the offer and its PDF, the portal, documents
// and letters, the Day-1 pass, manager and buddy, the tasks of each phase, the
// bank/PF change, probation and its decision. The footer keeps Open profile,
// Nudge and the one thing to do next; closing an offer asks in place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { LoadError, Pill, SkeletonLines } from '../../ui';
import {
  AGENDA_TASK_KEYS, AGENDA_TASK_LABEL, decideBankPfRequest, decideDateRequest, fetchLifecycleFile, getJourney, isNotAvailable, journeyTaskAction, listTemplates, nudgeTask, offerStatusAction, reviewDocument, updateJourney,
} from '../../../services/lifecycle';
import type {
  BankPfRequest, CandidateDocumentView, ConfirmationDecision, Day1Pass, JourneyDetail, LetterKind, LetterView, TaskView, TemplateListItem,
} from '../../../services/lifecycle';
import { FilePreview, NoteDialog, OwnerChip, Pick, PlantFace, Field } from './shared';
import { IconChevronDown } from '../../icons';
import {
  DOCS_OPEN_KEY, PHASES, areaStyle, changedFieldsText, nudgeLabel, daysTo, dayTime, decisionLine, dueText, errText, fileSize, firstName, inputStyle, labelStyle, longDay, rupees, sectionLabel, shortDay, todayKey,
} from './format';
import { FinaliseDialog, MarkJoinedDialog } from './OfferDialogs';
import { DecisionDialog, ProbationMonths, RecommendationNote } from './Probation';
import { KIND_LABEL } from './letterDoc';
import { downloadFile } from './DocumentParts';
import { TAB_LABELS, columnLabel, pctColour, weekOf } from './boardModel';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Offer not sent yet', offer_sent: 'Offer sent', accepted: 'Accepted, waiting for HR', finalised: 'Finalised, portal sent', active: 'On the portal',
  docs_approved: 'Documents approved', joined: 'Joined', moved_to_app: 'On the app', confirmed: 'Confirmed', declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining',
};
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
const OPEN = new Set(['todo', 'in_review', 'sent_back']);
const PRE_JOIN = new Set(['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved']);

/** The design's nine steps, and the step each board column is on. */
const STEPS = ['Offer sent', 'Offer confirmed', 'Employee profile', 'Joining day', 'Week 1 · onboarding tasks', 'Month 1 · settling in', 'Months 2–5 · growing', 'Final month · decision', 'Confirmed'];
const STEP_AT: Record<string, number> = {
  offer_sent: 0, accepted: 1, documents: 2, letters: 2, ready_to_join: 3, day1: 4, week1_tasks: 4, day7_survey: 4, week_done: 4,
  month1: 5, months_2_5: 6, final_month: 7, confirmed: 8,
};

type Dialog =
  | { kind: 'finalise' } | { kind: 'joined' } | { kind: 'decision' }
  | { kind: 'status'; action: 'reopen' }
  | { kind: 'task'; task: TaskView; action: 'done' | 'skip' | 'reopen' }
  | { kind: 'sendback'; doc: CandidateDocumentView }
  | { kind: 'date'; id: string; decision: 'approve' | 'decline'; day: string }
  | { kind: 'file'; id: string; name: string }
  | { kind: 'bankpf'; decision: 'approve' | 'decline' }
  | null;

/** Key facts, as the design's step lists them: a narrow label column, the value in medium weight. */
/** The joiner's answer to "How was today?" on "Day 1, done!", as the app labels it. */
const DAY1_FEELING: Record<string, string> = { great: 'Great', okay: 'Okay', tough: 'Tough' };

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

/** Opens Documents on a letter kind for this joiner (the offer letter is where an offer is edited and sent; `mail` opens its email). */
function openDocuments(setView: (v: 'lifecycle_documents') => void, kind: LetterKind, journeyId: string, mail?: boolean) {
  try { sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind, journeyId, ...(mail ? { mail: true } : {}) })); } catch { /* Documents opens on its own first choice */ }
  setView('lifecycle_documents');
}

/** The tile behind the plant, by phase (the board's card uses the same). */
const TINT: Record<string, string> = { pre_boarding: 'var(--surface-2)', first_week: 'var(--accent-soft)', probation: 'var(--ok-bg)' };

/** The blue line under the name: "Joins Mon 8 Dec · 7 days to go" before joining, then where they are. */
function journeyLine(status: string, tj: string | undefined, dayLabel: string | undefined): string {
  if (PRE_JOIN.has(status) && tj) {
    const n = daysTo(tj);
    if (n > 1) return `Joins ${shortDay(tj)} · ${n} days to go`;
    if (n === 1) return `Joins tomorrow, ${shortDay(tj)}`;
    if (n === 0) return `Joins today, ${shortDay(tj)}`;
    return `Was to join ${shortDay(tj)}`;
  }
  return dayLabel || STATUS_LABEL[status] || status;
}

const addr = (a?: { line: string; city: string; state: string; pin: string }) => (a ? `${a.line}, ${a.city}, ${a.state} ${a.pin}` : '');
const month = (m?: string) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'now');

/** What the candidate filled in on the portal's Employee profile (the secrets as their last four). */
function ProfileFacts({ profile: p, emergency, pf, onPhoto }: {
  profile: NonNullable<JourneyDetail['journey']['profile']>; emergency?: { name: string; relation: string; phone: string }; pf?: { firstJob: boolean; uan?: string }; onPhoto: (id: string) => void;
}) {
  return (
    <>
      <Sub>Employee profile</Sub>
      <Facts strong={false} rows={[
        ['Full name', p.personal ? `${p.personal.fullName}${p.personal.preferredName ? ` (${p.personal.preferredName})` : ''}` : ''],
        ['Date of birth', p.personal?.dob ? longDay(p.personal.dob) : ''],
        ['Gender', p.personal?.gender], ['Marital status', p.personal?.maritalStatus], ['Nationality', p.personal?.nationality],
        ['Mobile', p.contact?.mobile], ['Current address', addr(p.contact?.current)],
        ['Permanent address', p.contact ? (p.contact.permanentSame ? 'Same as current' : addr(p.contact.permanent)) : ''],
        ['Emergency contact', emergency ? `${emergency.name} (${emergency.relation}) · ${emergency.phone}` : ''],
        ['Bank', p.bank ? `${p.bank.holderName} · •••• ${p.bank.accountLast4} · ${p.bank.ifsc}${p.bank.bankName ? ` · ${p.bank.bankName}` : ''}` : ''],
        ['PF', pf ? (pf.firstJob ? 'First job: no UAN yet' : `UAN ${pf.uan ?? ''}`) : ''],
        ['Education', p.education ? `${p.education.qualification}, ${p.education.institution} (${p.education.year})` : ''],
        ['Experience', p.experience ? (p.experience.firstJob ? 'First job' : p.experience.jobs.map((j) => `${j.role} at ${j.company} (${month(j.from)} – ${month(j.to)})`).join('; ')) : ''],
        ['Aadhaar', p.ids?.aadhaarLast4 ? `•••• ${p.ids.aadhaarLast4}` : ''], ['PAN', p.ids?.panLast4 ? `••••••${p.ids.panLast4}` : ''],
        ['Photo', p.photoFileId ? <button key="ph" type="button" className="pd-btn sm" onClick={() => onPhoto(p.photoFileId!)}>View photo</button> : ''],
      ]} />
    </>
  );
}

const doneOf = (list: TaskView[]) => list.filter((t) => t.status === 'done' || t.status === 'skipped').length;

export function JoinerPanel({ journeyId, onClose, onChanged }: { journeyId: string; onClose: () => void; onChanged: () => void }) {
  const s = useStore();
  const { user, emps, flash } = s;
  const pay = canSeePay(user);
  const [data, setData] = useState<JourneyDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [busy, setBusy] = useState('');
  // The step HR opened (null: the step they are on; -1: all closed).
  const [openStep, setOpenStep] = useState<number | null>(null);
  // Closing the offer (declined / not joining) asks in place, as the design's revoke box does.
  const [closing, setClosing] = useState<null | 'decline' | 'not-joining'>(null);
  const [closeNote, setCloseNote] = useState('');
  const [nudgeMenu, setNudgeMenu] = useState(false);
  const nudgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setError('');
    // Another person opened in the same panel: never show the last one's details while theirs load.
    setData((d) => (d && d.journey.id !== journeyId ? null : d));
    getJourney(journeyId)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(isNotAvailable(e) ? 'Employee lifecycle is not switched on for your company.' : errText(e, 'Could not load this joiner')); });
    return () => { live = false; };
  }, [journeyId, attempt]);
  useEffect(() => { setOpenStep(null); setNudgeMenu(false); setClosing(null); setCloseNote(''); }, [journeyId]);
  useEffect(() => { listTemplates('onboarding').then(setTemplates).catch(() => undefined); }, []);
  useEffect(() => {
    if (!nudgeMenu) return undefined;
    const close = (e: globalThis.MouseEvent) => { if (!nudgeRef.current?.contains(e.target as Node)) setNudgeMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [nudgeMenu]);

  const changed = useCallback(() => { setAttempt((n) => n + 1); onChanged(); }, [onChanged]);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(key);
    try { await fn(); if (ok) flash(ok); changed(); return true; } catch (e) { flash(errText(e), 'error'); return false; } finally { setBusy(''); }
  };

  if (!data) {
    return (
      <DrawerShell width={520} onClose={onClose} label="Joiner" resetKey={journeyId} onEscape={dialog ? undefined : onClose}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end' }}><CloseButton onClose={onClose} /></div>
        {error ? <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /> : <div style={{ padding: 20 }}><SkeletonLines lines={8} /></div>}
      </DrawerShell>
    );
  }

  const { journey, tasks, documents, letters, offer, dateRequests, probation, batch } = data;
  const name = journey.candidate?.name ?? 'Joiner';
  const first = firstName(name);
  const status = String(journey.status);
  const role = [journey.designation ?? offer?.fields.designation, journey.department ?? offer?.fields.department].filter(Boolean).join(' · ');
  const closed = ['declined', 'expired', 'not_joining'].includes(status);
  const today = todayKey();
  const canJoin = PRE_JOIN.has(status) && status !== 'draft' && status !== 'offer_sent' && status !== 'accepted' && Boolean(journey.tj) && journey.tj! <= today;
  // As the board's waiting-on: optional things with no date (asking for another joining day) wait on nobody.
  // Sending an unsent offer has no date, yet nothing moves until HR sends it (the board says the same).
  const waiting = tasks.filter((t) => OPEN.has(t.status) && (!t.opensAt || t.opensAt.slice(0, 10) <= today) && (t.mustDo || Boolean(t.dueAt) || t.systemKey === 'send_offer'))
    .sort((a, b) => String(a.dueAt ?? '9999').localeCompare(String(b.dueAt ?? '9999'))).slice(0, 6);
  // Optional documents (a last payslip) never hold anyone up, so the count is of the required ones.
  const requiredDocs = documents.filter((d) => d.required);
  const approved = requiredDocs.filter((d) => d.status === 'approved').length;
  const docsCount = requiredDocs.length ? `${approved} of ${requiredDocs.length} required approved` : documents.length ? 'All optional' : '';
  const reviewQueue = documents.filter((d) => d.status === 'in_review').length;
  const decision: ConfirmationDecision | undefined = probation.decision ?? journey.probation?.decision;
  const decisionLetter: LetterKind | null = decision?.outcome === 'confirm' ? 'confirmation' : decision?.outcome === 'extend' ? 'extension' : null;
  const hasDecisionLetter = decisionLetter ? letters.some((l) => l.kind === decisionLetter && l.state !== 'draft') : true;
  const template = templates.find((t) => t.id === journey.templateId);
  // The onboarding tab alone (IT, Admin) sees each document's status, never the files.
  const seesDocuments = data.viewer?.seesDocuments !== false;
  // Nudge (the footer): whoever a waiting step can remind; once a day per step.
  const nudgeable = closed ? [] : waiting.filter((t) => t.canNudge);
  const nudgeOpen = nudgeable.filter((t) => !t.nudgedToday);
  const revisionWaiting = Boolean(offer && offer.status === 'draft' && offer.version > 1);
  const bankPf = journey.bankPfRequest && (journey.bankPfRequest.status === 'pending' || journey.bankPfRequest.decidedAt) ? journey.bankPfRequest : null;

  // Where they are on the nine steps; the Confirmed column has every step done.
  const cur = STEP_AT[journey.column] ?? 0;
  const allDone = journey.column === 'confirmed';
  const shownStep = openStep === null ? Math.min(cur, STEPS.length - 1) : openStep;
  const toggleStep = (i: number) => setOpenStep(shownStep === i ? -1 : i);

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

  // The one thing to do next, as the board's card names it (the footer's main button).
  // A revision (or an approved new joining date) stays HR's draft until sent: the candidate still sees the last version they got.
  let primary: { label: string; go: () => void } | null = null;
  if (closed) primary = { label: 'Reopen', go: () => setDialog({ kind: 'status', action: 'reopen' }) };
  else if (revisionWaiting && pay) primary = { label: 'Send revised offer', go: () => openDocuments(s.setView, 'offer', journey.id) };
  else if (status === 'draft') primary = { label: 'Send offer', go: () => openDocuments(s.setView, 'offer', journey.id, Boolean(offer?.pdfFileId)) };
  else if (status === 'offer_sent') primary = { label: 'Resend offer email', go: () => openDocuments(s.setView, 'offer', journey.id, Boolean(offer?.pdfFileId)) };
  else if (status === 'accepted') primary = { label: 'Finalise and send the portal', go: () => setDialog({ kind: 'finalise' }) };
  else if (canJoin) primary = { label: 'Mark joined', go: () => setDialog({ kind: 'joined' }) };
  else if (reviewQueue > 0) primary = { label: 'Review documents', go: () => setOpenStep(2) };
  else if (status === 'docs_approved' && !letters.some((l) => l.kind === 'appointment')) primary = { label: 'Make the appointment letter', go: () => openDocuments(s.setView, 'appointment', journey.id) };
  else if (journey.column === 'final_month' && !decision) primary = { label: 'Record decision', go: () => setDialog({ kind: 'decision' }) };
  else if (decisionLetter && !hasDecisionLetter) primary = { label: `Make the ${decisionLetter} letter`, go: () => openDocuments(s.setView, decisionLetter, journey.id) };

  // Ending the offer (the design's Revoke offer, on the footer's left): declined while it waits, not joining once accepted.
  const closeAction: null | 'decline' | 'not-joining' = status === 'offer_sent' ? 'decline' : ['accepted', 'finalised', 'active', 'docs_approved'].includes(status) ? 'not-joining' : null;

  const nudge = (t: TaskView) => {
    setNudgeMenu(false);
    void run('nudge', async () => { const r = await nudgeTask(journey.id, t.id); flash(r.channel === 'email' ? `Reminder emailed to ${r.to}` : `Reminder sent to ${r.to} in the app`); });
  };
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
              <button type="button" className="pd-btn sm" aria-label="Download offer letter" title="Download" disabled={busy === 'pdf'} onClick={() => void downloadOffer()}>↓</button>
            </div>
          )}
          {offer.versions.length > 1 && (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
              {offer.versions.slice().reverse().map((v) => (
                <div key={v.version}>Version {v.version} · {v.status}{v.sentAt ? ` · sent ${shortDay(v.sentAt)}` : ''}{v.acceptedAt ? ` · accepted ${shortDay(v.acceptedAt)}` : ''}</div>
              ))}
            </div>
          )}
          {PRE_JOIN.has(status) && pay && <span><button type="button" className="pd-btn sm" onClick={() => openDocuments(s.setView, 'offer', journey.id)}>{status === 'draft' ? 'Edit offer' : 'Edit offer'}</button></span>}
          {PRE_JOIN.has(status) && pay && status !== 'draft' && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Editing makes version {offer.version + 1} of the offer letter. {first} keeps version {offer.version} until you send the new one.</div>}
        </>
      ) : <Para>No offer yet. New offer letter starts one.</Para>;
      case 1:
        if (cur < 1 && !allDone) return <Para>{first} gets the offer PDF by email with a link to accept it. Once they accept, Finalise sends the joining portal link, where they sign in with a code to their email.</Para>;
        return (
          <>
            <Para>{first} accepted the offer{acceptedAt ? ` on ${dayTime(acceptedAt)}` : ''}.{status === 'accepted' ? ' Finalise sends the joining portal link to their personal email.' : ''}</Para>
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
            {journey.profile && <ProfileFacts profile={journey.profile} emergency={journey.aboutYou?.emergencyContact} pf={journey.aboutYou?.pf} onPhoto={(id) => setDialog({ kind: 'file', id, name: `Photo – ${name}` })} />}
            {documents.length > 0 && <Sub>Documents</Sub>}
            {documents.length > 0 && !seesDocuments && <div className="pd-note">Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
            {documents.map((d) => <DocumentRow key={d.id} doc={d} busy={busy === `doc:${d.id}`} canReview={seesDocuments}
              onOpen={(f) => setDialog({ kind: 'file', id: f.id, name: f.name })}
              onApprove={() => void run(`doc:${d.id}`, () => reviewDocument(d.id, 'approve'), `${d.label} approved`)}
              onSendBack={() => setDialog({ kind: 'sendback', doc: d })} />)}
            {letters.length > 0 && <Sub>Letters</Sub>}
            {letters.length > 0 && <div style={{ display: 'grid', gap: 8 }}>{letters.map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}</div>}
            {preTasks.length > 0 && <Sub>Tasks</Sub>}
            {preTasks.length > 0 && taskList(preTasks)}
          </>
        );
      case 3:
        return (
          <>
            <Facts rows={[
              ['Joining date', journey.tj ? longDay(journey.tj) : 'Not set'], ['When', journey.tj ? weekOf(journey.tj) : ''],
              ['Reporting time', pass?.reportingTime ?? 'Not set'], ['Reporting place', pass?.place ?? (pass?.meetingLink ? 'Online' : 'Not set')],
              ['Report to', journey.managerName ?? 'Not picked'], ['Buddy', journey.buddyName ?? 'Not picked'],
              ['Day-1 pass', passFilled ? 'Filled in' : 'Not filled in yet'], ['Template', template?.name],
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
            {weekTasks.length ? taskList(weekTasks) : <Para>The week-1 tasks open on the joining day.</Para>}
            {bankPf && <><Sub>Bank and PF change</Sub><BankPfCard request={bankPf} pay={pay} busy={Boolean(busy)} onDecide={(d) => setDialog({ kind: 'bankpf', decision: d })} /></>}
          </>
        );
      case 5: return monthOneTasks.length ? taskList(monthOneTasks) : <Para>Month-1 goals and check-ins open after the first week.</Para>;
      case 6: return middleTasks.length ? taskList(middleTasks) : <Para>A check-in each month until the final month.</Para>;
      case 7:
        return (
          <>
            {finalTasks.length > 0 && taskList(finalTasks)}
            {probation.months.length > 0 && <><Sub>Every month</Sub><ProbationMonths months={probation.months} total={probationTotal} /></>}
            {decision && <div className="pd-note">{decisionLine(decision, pay)}</div>}
            {!decision && <RecommendationNote recommendation={probation.recommendation ?? journey.probation?.recommendation} hodApproval={probation.hodApproval ?? journey.probation?.hodApproval} />}
            {journey.column === 'final_month' && <span><button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'decision' })}>{decision ? 'Change decision' : 'Record decision'}</button></span>}
            {!finalTasks.length && !probation.months.length && !decision && <Para>The final check-in and the decision to confirm or extend.</Para>}
          </>
        );
      default:
        return decision ? (
          <>
            <Para>{decisionLine(decision, pay)}</Para>
            {letters.filter((l) => l.kind === 'confirmation' || l.kind === 'extension').map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}
          </>
        ) : <Para>The confirmation letter goes out once the decision is recorded.</Para>;
    }
  };

  return (
    <DrawerShell width={520} onClose={onClose} label={name} resetKey={journeyId} onEscape={dialog ? undefined : nudgeMenu ? () => setNudgeMenu(false) : closing ? () => setClosing(null) : onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>{closed ? `Closed · ${STATUS_LABEL[status] ?? status}` : `${TAB_LABELS[journey.tab] ?? ''} · ${columnLabel(journey.column)}`}</div>
        <CloseButton onClose={onClose} />
      </div>

      <div style={{ padding: 20, display: 'grid', gap: 18, alignContent: 'start', flex: 1 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
          <span style={{ width: 76, height: 84, borderRadius: 20, background: closed ? 'var(--surface-2)' : TINT[journey.tab] ?? 'var(--surface-2)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flex: 'none', overflow: 'hidden' }}>
            <PlantFace plant={journey.plant} size={66} name={name} userId={journey.userId} />
          </span>
          <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{name}</div>
            {role && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{role}</div>}
            <div style={{ fontSize: 13, fontWeight: 500, color: closed ? 'var(--ink-2)' : 'var(--accent-ink)' }}>{closed ? STATUS_LABEL[status] ?? status : journeyLine(status, journey.tj, journey.dayLabel)}</div>
          </div>
        </div>

        {closed && (
          <div className="pd-note">
            {STATUS_LABEL[status] ?? status}{journey.closedAt ? ` on ${longDay(journey.closedAt)}` : ''}{journey.closedReason ? `. ${journey.closedReason}` : ''}
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={{ ...sectionLabel, margin: 0 }}>Journey</h3>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{allDone ? 'Confirmed' : `Step ${Math.min(cur + 1, STEPS.length)} of ${STEPS.length}`}</span>
          </div>
          <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
            {STEPS.map((title, i) => {
              const state: 'done' | 'current' | 'todo' = allDone || i < cur ? 'done' : i === cur && !closed ? 'current' : 'todo';
              const line = sub(i, state);
              const open = shownStep === i;
              const tag = state === 'current' && i === 3 && journey.tj ? weekOf(journey.tj) : '';
              const last = i === STEPS.length - 1;
              return (
                <li key={title} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 12 }}>
                  <span aria-hidden style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${state === 'done' ? 'var(--ok-solid)' : state === 'current' ? 'var(--accent)' : 'var(--line-2)'}`, background: state === 'done' ? 'var(--ok-solid)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      {state === 'done' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                    </span>
                    <span style={{ flex: 1, width: 2, minHeight: 12, background: last ? 'transparent' : state === 'done' ? 'color-mix(in srgb, var(--ok-solid) 45%, var(--surface))' : 'var(--line)' }} />
                  </span>
                  <div style={{ paddingBottom: 6, minWidth: 0 }}>
                    <button type="button" aria-expanded={open} aria-controls={`lf-step-${i}`} onClick={() => toggleStep(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 0, borderRadius: 12, padding: '10px 12px', textAlign: 'left', font: 'inherit', cursor: 'pointer', color: 'var(--ink)', background: open ? 'var(--surface-2)' : state === 'current' ? 'var(--accent-soft)' : 'transparent' }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 13.5, fontWeight: state === 'current' ? 600 : 500, color: state === 'todo' ? 'var(--ink-3)' : 'var(--ink)' }}>{title}</span>
                        <span style={{ fontSize: 11.5, color: line.red && state === 'current' ? 'var(--bad)' : state === 'current' ? 'var(--accent-ink)' : 'var(--ink-3)', overflowWrap: 'anywhere' }}>{line.text}</span>
                      </span>
                      {tag && <Pill label={tag} tone={tag === 'This week' || tag === 'Today' ? { bg: 'var(--warn-bg)', fg: 'var(--warn)' } : { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }} fontSize={11} padding="2px 9px" />}
                      <IconChevronDown size={16} stroke="var(--ink-3)" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                    </button>
                    {open && <div id={`lf-step-${i}`} style={{ display: 'grid', gap: 12, padding: '12px 12px 8px' }}>{body(i)}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {closing && (
          <div style={{ display: 'grid', gap: 12, padding: 14, border: '1px solid color-mix(in srgb, var(--bad) 25%, var(--line))', background: 'color-mix(in srgb, var(--bad-bg) 55%, var(--surface))', borderRadius: 14 }}>
            <b style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--bad)' }}>{closing === 'decline' ? `Did ${first} decline the offer?` : `Is ${first} not joining?`}</b>
            <Para>{closing === 'decline' ? 'Their no came by email. The offer closes, the portal link stops working and the card moves to Closed.'
              : 'Open tasks are cancelled, the device request is recalled, the portal locks and the card moves to Closed. Reopen brings it back.'}</Para>
            <label style={labelStyle}>What they said (only HR sees this)
              <textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Optional" style={{ ...areaStyle, minHeight: 64 }} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="pd-btn" onClick={() => { setClosing(null); setCloseNote(''); }}>Keep the offer</button>
              <button type="button" className="pd-btn primary" disabled={Boolean(busy)} style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
                onClick={() => void run('close', () => offerStatusAction(journey.id, closing, closeNote.trim() || undefined), closing === 'decline' ? `${first}’s offer is closed as declined` : `${first} is marked not joining`).then((ok) => { if (ok) { setClosing(null); setCloseNote(''); } })}>
                {closing === 'decline' ? 'Mark declined' : 'Mark not joining'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The design's footer: ending the offer on the left; Open profile, Nudge, then the one thing to do next. */}
      <div ref={nudgeRef} style={{ position: 'sticky', bottom: 0, flexShrink: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '16px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        {closeAction && !closing && <button type="button" className="pd-btn" style={{ color: 'var(--bad)' }} onClick={() => setClosing(closeAction)}>{closeAction === 'decline' ? 'Mark declined' : 'Not joining'}</button>}
        <span style={{ flex: 1 }} />
        {/* Their profile is made when HR finalises the offer: until then there is nothing to open. */}
        {journey.userId && <button type="button" className="pd-btn" onClick={() => { onClose(); s.openProfile(journey.userId!); }}>Open profile</button>}
        {nudgeable.length > 0 && (
          <>
            <button type="button" className="pd-btn" disabled={Boolean(busy) || nudgeOpen.length === 0}
              aria-haspopup={nudgeOpen.length > 1 ? 'menu' : undefined} aria-expanded={nudgeOpen.length > 1 ? nudgeMenu : undefined}
              title={nudgeOpen.length === 0 ? 'Reminded today. You can remind again tomorrow.' : nudgeOpen.length === 1 ? `${nudgeLabel(nudgeOpen[0].ownerRole, nudgeOpen[0].ownerName)}: ${nudgeOpen[0].title}` : 'Pick who to remind'}
              onClick={() => (nudgeOpen.length === 1 ? nudge(nudgeOpen[0]) : setNudgeMenu((v) => !v))}>
              {busy === 'nudge' ? 'Sending…' : nudgeOpen.length === 0 ? 'Reminded today' : nudgeOpen.length === 1 ? nudgeLabel(nudgeOpen[0].ownerRole, nudgeOpen[0].ownerName) : 'Nudge'}
            </button>
            {nudgeMenu && (
              <div role="menu" style={{ position: 'absolute', right: 20, bottom: 'calc(100% - 8px)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 5, minWidth: 260, display: 'grid' }}>
                {nudgeable.map((t) => (
                  <button key={t.id} type="button" role="menuitem" disabled={t.nudgedToday} onClick={() => nudge(t)}
                    style={{ display: 'grid', gap: 2, textAlign: 'left', background: 'none', border: 0, borderRadius: 10, padding: '8px 10px', font: 'inherit', cursor: t.nudgedToday ? 'default' : 'pointer', color: t.nudgedToday ? 'var(--ink-4)' : 'var(--ink)' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{t.nudgedToday ? `${nudgeLabel(t.ownerRole, t.ownerName)} · reminded today` : nudgeLabel(t.ownerRole, t.ownerName)}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.title}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {primary && <button type="button" className="pd-btn primary" onClick={primary.go} disabled={Boolean(busy)}>{primary.label}</button>}
      </div>
      {dialog?.kind === 'finalise' && <FinaliseDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'joined' && <MarkJoinedDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'decision' && <DecisionDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'status' && (
        <NoteDialog title={`Reopen ${first}’s journey`} sub="The offer opens again where it was. Revise it if the terms change."
          placeholder="Why it is reopened (optional)" confirm="Reopen" tone="primary"
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await offerStatusAction(journey.id, 'reopen', note || undefined); setDialog(null); flash('Saved'); changed(); }} />
      )}
      {dialog?.kind === 'task' && (
        <NoteDialog
          title={dialog.action === 'done' ? `Mark “${dialog.task.title}” done` : dialog.action === 'skip' ? `Skip “${dialog.task.title}”` : `Reopen “${dialog.task.title}”`}
          sub={dialog.action === 'reopen' ? 'It goes back to the owner’s list, with your note.' : undefined}
          placeholder="Note (optional)" confirm={dialog.action === 'done' ? 'Mark done' : dialog.action === 'skip' ? 'Skip' : 'Reopen'}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await journeyTaskAction(journey.id, dialog.task.id, dialog.action, note || undefined); setDialog(null); changed(); }} />
      )}
      {dialog?.kind === 'sendback' && (
        <NoteDialog title={`Send back ${dialog.doc.label}`} sub={`${first} sees your note first, at the top of Up next.`} label="What to fix" required
          placeholder="e.g. The scan is cut off at the bottom. Please upload the full page." confirm="Send back" tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await reviewDocument(dialog.doc.id, 'send_back', note); setDialog(null); flash(`${dialog.doc.label} sent back`); changed(); }} />
      )}
      {dialog?.kind === 'date' && (
        <NoteDialog
          title={dialog.decision === 'approve' ? `Move joining to ${longDay(dialog.day)}?` : 'Decline the new date'}
          sub={dialog.decision === 'approve' ? 'The offer is revised with the new joining day and every open due date moves with it.' : 'The joining day stays as it is.'}
          placeholder="Note to the candidate (optional)" confirm={dialog.decision === 'approve' ? 'Approve' : 'Decline'} tone={dialog.decision === 'approve' ? 'primary' : 'danger'}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await decideDateRequest(dialog.id, dialog.decision, note || undefined); setDialog(null); flash(dialog.decision === 'approve' ? 'New joining date approved' : 'Request declined'); changed(); }} />
      )}
      {dialog?.kind === 'bankpf' && (
        <NoteDialog
          title={dialog.decision === 'approve' ? 'Approve the bank and PF change?' : 'Decline the bank and PF change'}
          sub={dialog.decision === 'approve' ? 'The new details go into payroll from the next run. They are told in the app.' : 'Payroll keeps the details it has. They see your note in the app.'}
          placeholder={dialog.decision === 'approve' ? 'Note (optional)' : 'What they should do instead (optional)'}
          confirm={dialog.decision === 'approve' ? 'Approve' : 'Decline'} tone={dialog.decision === 'approve' ? 'primary' : 'danger'}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await decideBankPfRequest(journey.id, dialog.decision, note || undefined); setDialog(null); flash(dialog.decision === 'approve' ? 'Bank and PF details updated' : 'Change declined'); changed(); }} />
      )}
      {dialog?.kind === 'file' && <FilePreview fileId={dialog.id} name={dialog.name} onClose={() => setDialog(null)} />}
    </DrawerShell>
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
  if (!editing) {
    const filledIn = Boolean(value && (value.reportingTime || value.place || value.meetingLink));
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {filledIn ? (
          <Facts rows={[
            ['Date', longDay(value?.date ?? tj)],
            ['Reporting time', value?.reportingTime],
            ['Place', value?.place],
            ['Meeting link', value?.meetingLink],
            ['Ask for', value?.askFor ? `${value.askFor.name}${value.askFor.phone ? ` · ${value.askFor.phone}` : ''}` : ''],
            ['HR contact', value?.hrContact ? [value.hrContact.name, value.hrContact.email, value.hrContact.phone].filter(Boolean).join(' · ') : ''],
            ['Bring', value?.bring?.length ? value.bring.join(', ') : ''],
            ['Agenda', value?.agenda?.length ? value.agenda.map((a) => `${a.time} ${a.title}${a.with ? ` (${a.with})` : ''}${a.taskKey ? ` · ${AGENDA_TASK_LABEL[a.taskKey]}` : ''}`).join(' · ') : ''],
          ]} />
        ) : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Not filled in yet. The candidate sees it from 7 days before joining: time, place or link, who to ask for, what to bring and the day’s agenda.</div>}
        <div><button type="button" className="pd-btn sm" onClick={() => { setP(value ?? {}); setBring((value?.bring ?? []).join('\n')); setEditing(true); }}>{filledIn ? 'Edit pass' : 'Fill in the pass'}</button></div>
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
