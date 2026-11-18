// H1b · the joiner side panel, as the design draws it: where they are on the
// journey, what waits on whom (grey tiles), the key facts, and a footer with
// Open profile, Nudge and the one thing to do next. Everything else HR does for
// one joiner folds under that: the offer and its versions, joining-date
// requests, the bank/PF change, documents (preview, approve, send back),
// letters, tasks by phase, the Day-1 pass, manager and buddy, the batch and
// probation with its decision.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { LoadError, Pill, SkeletonLines } from '../../ui';
import {
  AGENDA_TASK_KEYS, AGENDA_TASK_LABEL, decideBankPfRequest, decideDateRequest, getJourney, isNotAvailable, journeyTaskAction, listTemplates, nudgeTask, offerStatusAction, reviewDocument, updateJourney,
} from '../../../services/lifecycle';
import type {
  BankPfRequest, CandidateDocumentView, ConfirmationDecision, Day1Pass, JourneyDetail, LetterKind, LetterView, TaskView, TemplateListItem,
} from '../../../services/lifecycle';
import { FilePreview, NoteDialog, OwnerChip, Pick, PlantFace, Field } from './shared';
import { IconChevronDown } from '../../icons';
import {
  DOCS_OPEN_KEY, OWNER_LABEL, PHASES, areaStyle, changedFieldsText, nudgeLabel, daysTo, dayTime, decisionLine, dueText, errText, fileSize, firstName, inputStyle, longDay, rupees, sectionLabel, shortDay, todayKey,
} from './format';
import { FinaliseDialog, MarkJoinedDialog, OfferWizard } from './OfferDialogs';
import { DecisionDialog, ProbationMonths } from './Probation';
import { KIND_LABEL } from './letterDoc';

const TAB_LABEL = { pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation' } as const;
const COLUMN_LABEL: Record<string, string> = {
  offer_sent: 'Offer sent', accepted: 'Accepted', documents: 'Documents', letters: 'Letters to sign', ready_to_join: 'Ready to join',
  day1: 'Day 1', week1_tasks: 'Week-1 tasks', day7_survey: 'Day-7 survey', week_done: 'Week done',
  month1: 'Month 1', months_2_5: 'Months 2–5', final_month: 'Final month', confirmed: 'Confirmed',
};
const TRACK = ['Offer', 'Pre-boarding', 'First week', 'Month 1', 'Months 2–5', 'Final month', 'Confirmed'];
const TRACK_AT: Record<string, number> = {
  offer_sent: 0, accepted: 0, documents: 1, letters: 1, ready_to_join: 1, day1: 2, week1_tasks: 2, day7_survey: 2, week_done: 2,
  month1: 3, months_2_5: 4, final_month: 5, confirmed: 6,
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Offer not sent yet', offer_sent: 'Offer sent', accepted: 'Accepted, waiting for HR', finalised: 'Finalised, login sent', active: 'On the portal',
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

type Dialog =
  | { kind: 'offer'; mode: 'revise' | 'send'; start?: 'details' | 'letter' | 'email' }
  | { kind: 'finalise' } | { kind: 'joined' } | { kind: 'decision' }
  | { kind: 'status'; action: 'decline' | 'reopen' | 'not-joining' }
  | { kind: 'task'; task: TaskView; action: 'done' | 'skip' | 'reopen' }
  | { kind: 'sendback'; doc: CandidateDocumentView }
  | { kind: 'date'; id: string; decision: 'approve' | 'decline'; day: string }
  | { kind: 'file'; id: string; name: string }
  | { kind: 'bankpf'; decision: 'approve' | 'decline' }
  | null;

/**
 * One of the panel's further sections (offer, documents, tasks, Day-1 pass, probation…), folded
 * under the design's short card: a row with its title and a one-line summary that opens in place.
 */
function Fold({ id, title, summary, open, onToggle, actions, children }: {
  id: string; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={`lf-panel-${id}`} style={{ borderTop: '1px solid var(--line)' }}>
      <h3 style={{ margin: 0, font: 'inherit' }}>
        <button type="button" aria-expanded={open} aria-controls={`lf-fold-${id}`} onClick={onToggle}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 0', background: 'none', border: 0, font: 'inherit', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500 }}>{title}</span>
          {summary && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}>{summary}</span>}
          <IconChevronDown size={14} stroke="var(--ink-3)" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </button>
      </h3>
      {open && (
        <div id={`lf-fold-${id}`} style={{ paddingBottom: 16, display: 'grid', gap: 10 }}>
          {children}
          {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div>}
        </div>
      )}
    </section>
  );
}

/** Key facts, as the design's card lists them: a narrow label column, the value in medium weight. */
function Facts({ rows, strong = true }: { rows: [string, ReactNode][]; strong?: boolean }) {
  const shown = rows.filter(([, v]) => v != null && v !== '');
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '10px 16px', margin: 0, fontSize: 13 }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ink-3)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--ink)', fontWeight: strong ? 500 : 400, overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Opens Documents on a letter kind for this joiner. */
function openDocuments(setView: (v: 'lifecycle_documents') => void, kind: LetterKind, journeyId: string) {
  try { sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind, journeyId })); } catch { /* Documents opens on its own first choice */ }
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
  // Which folded sections HR opened or closed for this person (the rest keep their default).
  const [folds, setFolds] = useState<Record<string, boolean>>({});
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
  useEffect(() => { setFolds({}); setNudgeMenu(false); }, [journeyId]);
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
      <DrawerShell width={440} onClose={onClose} label="Joiner" resetKey={journeyId} onEscape={dialog ? undefined : onClose}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end' }}><CloseButton onClose={onClose} /></div>
        {error ? <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /> : <div style={{ padding: 20 }}><SkeletonLines lines={8} /></div>}
      </DrawerShell>
    );
  }

  const { journey, tasks, documents, letters, offer, dateRequests, probation, batch } = data;
  const name = journey.candidate?.name ?? 'Joiner';
  const status = String(journey.status);
  const role = [journey.designation ?? offer?.fields.designation, journey.department ?? offer?.fields.department].filter(Boolean).join(' · ');
  const at = TRACK_AT[journey.column] ?? 0;
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
  const pendingDates = dateRequests.filter((r) => r.status === 'pending').length;
  const bankPf = journey.bankPfRequest && (journey.bankPfRequest.status === 'pending' || journey.bankPfRequest.decidedAt) ? journey.bankPfRequest : null;

  // A section's default: folded, unless something in it waits on HR.
  const foldDefault: Record<string, boolean> = { offer: revisionWaiting, dates: pendingDates > 0, bankpf: bankPf?.status === 'pending', docs: false };
  const isOpen = (k: string) => folds[k] ?? foldDefault[k] ?? false;
  const toggle = (k: string) => setFolds((f) => ({ ...f, [k]: !isOpen(k) }));
  const reveal = (k: string) => {
    setFolds((f) => ({ ...f, [k]: true }));
    requestAnimationFrame(() => document.getElementById(`lf-panel-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // The one thing to do next, as the board's card names it (the footer's main button).
  // A revision (or an approved new joining date) stays HR's draft until sent: the candidate still sees the last version they got.
  let primary: { label: string; go: () => void } | null = null;
  if (closed) primary = { label: 'Reopen', go: () => setDialog({ kind: 'status', action: 'reopen' }) };
  else if (revisionWaiting && pay) primary = { label: 'Send revised offer', go: () => setDialog({ kind: 'offer', mode: 'send', start: 'letter' }) };
  else if (status === 'draft') primary = { label: 'Send offer', go: () => setDialog({ kind: 'offer', mode: 'send', start: offer?.pdfFileId ? 'email' : 'letter' }) };
  else if (status === 'offer_sent') primary = { label: 'Resend offer email', go: () => setDialog({ kind: 'offer', mode: 'send', start: offer?.pdfFileId ? 'email' : 'letter' }) };
  else if (status === 'accepted') primary = { label: 'Finalise', go: () => setDialog({ kind: 'finalise' }) };
  else if (canJoin) primary = { label: 'Mark joined', go: () => setDialog({ kind: 'joined' }) };
  else if (reviewQueue > 0) primary = { label: 'Review documents', go: () => reveal('docs') };
  else if (status === 'docs_approved' && !letters.some((l) => l.kind === 'appointment')) primary = { label: 'Make the appointment letter', go: () => openDocuments(s.setView, 'appointment', journey.id) };
  else if (journey.column === 'final_month' && !decision) primary = { label: 'Record decision', go: () => setDialog({ kind: 'decision' }) };
  else if (decisionLetter && !hasDecisionLetter) primary = { label: `Make the ${decisionLetter} letter`, go: () => openDocuments(s.setView, decisionLetter, journey.id) };

  // The offer's own actions sit with the offer.
  const offerActions: { label: string; go: () => void; danger?: boolean }[] = [];
  if (offer && PRE_JOIN.has(status) && pay) offerActions.push({ label: status === 'draft' ? 'Edit offer' : 'Revise offer', go: () => setDialog({ kind: 'offer', mode: 'revise', start: 'details' }) });
  if (status === 'offer_sent') offerActions.push({ label: 'Mark declined', go: () => setDialog({ kind: 'status', action: 'decline' }), danger: true });
  if (['accepted', 'finalised', 'active', 'docs_approved'].includes(status)) offerActions.push({ label: 'Not joining', go: () => setDialog({ kind: 'status', action: 'not-joining' }), danger: true });
  const actionButtons = (list: typeof offerActions) => list.map((b) => <button key={b.label} type="button" className="pd-btn sm" onClick={b.go} disabled={Boolean(busy)} style={b.danger ? { color: 'var(--bad)' } : undefined}>{b.label}</button>);

  const nudge = (t: TaskView) => {
    setNudgeMenu(false);
    void run('nudge', async () => { const r = await nudgeTask(journey.id, t.id); flash(r.channel === 'email' ? `Reminder emailed to ${r.to}` : `Reminder sent to ${r.to} in the app`); });
  };

  const offerFacts: [string, ReactNode][] = offer ? [
    ['Role', offer.fields.designation],
    ['Team', offer.fields.department],
    ['Location', offer.fields.location],
    ['Reports to', offer.fields.managerName],
    ['Joining', longDay(offer.fields.tj)],
    ['Yearly CTC', pay ? rupees(offer.fields.ctc) : 'Hidden · needs payroll access'],
    ['Probation', `${offer.fields.probationMonths} months`],
    ['Notice', `${offer.fields.noticeDays} days`],
    ['Valid till', longDay(offer.validTill)],
    ['Accepted', offer.acceptedAt ? dayTime(offer.acceptedAt) : ''],
  ] : [];
  const tasksLive = tasks.filter((t) => t.status !== 'cancelled');
  const tasksDone = tasksLive.filter((t) => t.status === 'done' || t.status === 'skipped').length;
  const passFilled = Boolean(journey.day1Pass && (journey.day1Pass.reportingTime || journey.day1Pass.place || journey.day1Pass.meetingLink));
  const probationTotal = (journey.probation?.months ?? 0) + (journey.probation?.extendedBy ?? 0);

  return (
    <DrawerShell width={440} onClose={onClose} label={name} resetKey={journeyId} onEscape={dialog ? undefined : nudgeMenu ? () => setNudgeMenu(false) : onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>{TAB_LABEL[journey.tab] ?? ''} · {COLUMN_LABEL[journey.column] ?? journey.column}</div>
        <CloseButton onClose={onClose} />
      </div>

      <div style={{ padding: 20, display: 'grid', gap: 20, alignContent: 'start', flex: 1 }}>
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

        <div style={{ display: 'grid', gap: 6 }}>
          <div role="img" aria-label={`Journey: ${TRACK[at]}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${TRACK.length}, 1fr)`, gap: 4 }}>
            {TRACK.map((t, i) => <span key={t} title={t} style={{ height: 8, borderRadius: 99, background: closed ? 'var(--line-2)' : i < at ? 'var(--ok-solid)' : i === at ? 'var(--accent)' : 'var(--line)' }} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--ink-3)' }}>
            <span>Offer</span><span>Confirmed</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ ...sectionLabel, margin: 0 }}>Waiting on</h3>
          {(waiting.length ? waiting : [null]).map((t) => (
            <div key={t?.id ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 12, fontSize: 13, minWidth: 0 }}>
              {t ? <OwnerChip role={t.ownerRole} label={OWNER_LABEL[t.ownerRole]} title={t.ownerRole === 'hr' ? 'HR · you' : t.ownerName ? `${OWNER_LABEL[t.ownerRole]} (${t.ownerName})` : undefined} /> : <OwnerChip role="automatic" />}
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{t ? t.title : 'Nothing waiting'}</span>
              <span style={{ fontSize: 12, whiteSpace: 'nowrap', color: t?.late ? 'var(--bad)' : 'var(--ink-3)', fontWeight: t?.late ? 500 : 400 }}>{t ? dueText(t.dueAt, t.late) : '—'}</span>
            </div>
          ))}
        </div>

        {/* The design's key facts; the offer's version and acceptance, the buddy and probation sit in their sections below. */}
        <Facts rows={[
          ['Joining', journey.tj ? longDay(journey.tj) : ''],
          ['Manager', journey.managerName],
          ['Documents', docsCount],
          ['Template', template?.name],
          ['Personal email', journey.candidate?.personalEmail],
          ['Work email', journey.candidate?.workEmail],
          ['Decision', decision ? decisionLine(decision, pay) : ''],
          ['Closed', journey.closedAt ? `${longDay(journey.closedAt)}${journey.closedReason ? ` · ${journey.closedReason}` : ''}` : ''],
        ]} />
        {!offer && offerActions.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actionButtons(offerActions)}</div>}

        <div style={{ borderBottom: '1px solid var(--line)' }}>
          {offer && (
            <Fold id="offer" title="Offer" summary={`Version ${offer.version} · ${offer.status}`} open={isOpen('offer')} onToggle={() => toggle('offer')}
              actions={(offer.pdfFileId || offerActions.length > 0) && <>
                {offer.pdfFileId && <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'file', id: offer.pdfFileId!, name: `Offer letter – ${name}.pdf` })}>View PDF</button>}
                {actionButtons(offerActions)}
              </>}>
              <Facts strong={false} rows={offerFacts} />
              {offer.changedFields && offer.changedFields.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Changed in this version: {changedFieldsText(offer.changedFields)}</div>}
              {revisionWaiting && (
                <div className="pd-note" style={{ color: 'var(--warn)' }}>
                  Saved as a draft. {firstName(name)} still sees version {offer.version - 1} until you send this one.
                </div>
              )}
              {offer.versions.length > 1 && (
                <div style={{ display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {offer.versions.slice().reverse().map((v) => (
                    <div key={v.version}>Version {v.version} · {v.status}{v.sentAt ? ` · sent ${shortDay(v.sentAt)}` : ''}{v.acceptedAt ? ` · accepted ${shortDay(v.acceptedAt)}` : ''}</div>
                  ))}
                </div>
              )}
            </Fold>
          )}

          {dateRequests.length > 0 && (
            <Fold id="dates" title="Joining date requests" summary={pendingDates ? `${pendingDates} waiting for you` : `${dateRequests.length} decided`} open={isOpen('dates')} onToggle={() => toggle('dates')}>
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
            </Fold>
          )}

          {bankPf && (
            <Fold id="bankpf" title="Bank and PF change" summary={bankPf.status === 'pending' ? 'Waiting for HR' : bankPf.status === 'approved' ? 'Approved' : 'Declined'} open={isOpen('bankpf')} onToggle={() => toggle('bankpf')}>
              <BankPfCard request={bankPf} pay={pay} busy={Boolean(busy)} onDecide={(d) => setDialog({ kind: 'bankpf', decision: d })} />
            </Fold>
          )}

          {documents.length > 0 && (
            <Fold id="docs" title="Documents" summary={reviewQueue ? `${reviewQueue} to review · ${docsCount}` : docsCount} open={isOpen('docs')} onToggle={() => toggle('docs')}>
              {!seesDocuments && <div className="pd-note">Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
              {documents.map((d) => <DocumentRow key={d.id} doc={d} busy={busy === `doc:${d.id}`} canReview={seesDocuments}
                onOpen={(f) => setDialog({ kind: 'file', id: f.id, name: f.name })}
                onApprove={() => void run(`doc:${d.id}`, () => reviewDocument(d.id, 'approve'), `${d.label} approved`)}
                onSendBack={() => setDialog({ kind: 'sendback', doc: d })} />)}
            </Fold>
          )}

          {letters.length > 0 && (
            <Fold id="letters" title="Letters" summary={letters.map((l) => `${KIND_LABEL[l.kind]}: ${LETTER_STATE[l.state] ?? l.state}`).join(' · ')} open={isOpen('letters')} onToggle={() => toggle('letters')}>
              <div style={{ display: 'grid', gap: 8 }}>
                {letters.map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}
              </div>
            </Fold>
          )}

          <Fold id="tasks" title="Tasks" summary={tasksLive.length ? `${tasksDone} of ${tasksLive.length} done` : 'None yet'} open={isOpen('tasks')} onToggle={() => toggle('tasks')}>
            <TasksByPhase tasks={tasks} busy={busy} onAction={(task, action) => setDialog({ kind: 'task', task, action })} />
          </Fold>

          {!closed && PRE_JOIN.has(status) && status !== 'draft' && (
            <Fold id="pass" title="Day-1 pass" summary={passFilled ? 'Filled in' : 'Not filled in yet'} open={isOpen('pass')} onToggle={() => toggle('pass')}>
              <Day1PassEditor key={journey.id} value={journey.day1Pass} tj={journey.tj}
                onSave={(p) => run('pass', () => updateJourney(journey.id, { day1Pass: p }), 'Day-1 pass saved')} busy={busy === 'pass'} />
            </Fold>
          )}

          {!closed && (
            <Fold id="people" title="Manager and buddy" summary={[journey.managerName, journey.buddyName].filter(Boolean).join(' · ') || 'Not picked'} open={isOpen('people')} onToggle={() => toggle('people')}>
              <PeoplePicker key={`${journey.managerUserId}-${journey.buddyUserId}`} managerUserId={journey.managerUserId} buddyUserId={journey.buddyUserId} exclude={journey.userId}
                emps={emps} busy={busy === 'people'}
                onSave={(patch) => run('people', () => updateJourney(journey.id, patch), 'Saved')} />
              {status === 'draft' && templates.length > 1 && (
                <Field label="Onboarding template" hint="Can change until the offer is sent">
                  <Pick value={journey.templateId} onChange={(v) => void run('template', () => updateJourney(journey.id, { templateId: v }), 'Template changed')}>
                    {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                  </Pick>
                </Field>
              )}
            </Fold>
          )}

          {batch.length > 0 && (
            <Fold id="batch" title="Joining the same day" summary={`${batch.length} ${batch.length === 1 ? 'person' : 'people'}`} open={isOpen('batch')} onToggle={() => toggle('batch')}>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{batch.map((b) => b.name).join(', ')}</div>
            </Fold>
          )}

          {(journey.userId || probation.months.length > 0) && (
            <Fold id="probation" title="Probation" summary={decision ? decisionLine(decision, pay) : journey.probation ? `${journey.probation.months} months${journey.probation.extendedBy ? `, extended by ${journey.probation.extendedBy}` : ''}` : undefined} open={isOpen('probation')} onToggle={() => toggle('probation')}
              actions={journey.column === 'final_month' ? <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'decision' })}>{decision ? 'Change decision' : 'Record decision'}</button> : undefined}>
              {decision && <div className="pd-note">{decisionLine(decision, pay)}</div>}
              <ProbationMonths months={probation.months} total={probationTotal} />
            </Fold>
          )}
        </div>
      </div>

      {/* The design's footer: Open profile, Nudge, then the one thing to do next. */}
      <div ref={nudgeRef} style={{ position: 'sticky', bottom: 0, flexShrink: 0, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', padding: '16px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button type="button" className="pd-btn" disabled={!journey.userId} title={journey.userId ? undefined : 'Their profile is made when HR finalises the offer'}
          onClick={() => { if (journey.userId) { onClose(); s.openProfile(journey.userId); } }}>Open profile</button>
        {nudgeable.length > 0 && (
          <>
            <button type="button" className="pd-btn" disabled={Boolean(busy) || nudgeOpen.length === 0}
              aria-haspopup={nudgeOpen.length > 1 ? 'menu' : undefined} aria-expanded={nudgeOpen.length > 1 ? nudgeMenu : undefined}
              title={nudgeOpen.length === 0 ? 'Reminded today. You can remind again tomorrow.' : nudgeOpen.length === 1 ? `${nudgeLabel(nudgeOpen[0].ownerRole, nudgeOpen[0].ownerName)}: ${nudgeOpen[0].title}` : 'Pick who to remind'}
              onClick={() => (nudgeOpen.length === 1 ? nudge(nudgeOpen[0]) : setNudgeMenu((v) => !v))}>
              {busy === 'nudge' ? 'Sending…' : nudgeOpen.length === 0 ? 'Reminded today' : 'Nudge'}
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

      {dialog?.kind === 'offer' && (
        <OfferWizard mode={dialog.mode} start={dialog.start} journey={journey} offer={offer} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); changed(); }} />
      )}
      {dialog?.kind === 'finalise' && <FinaliseDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'joined' && <MarkJoinedDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'decision' && <DecisionDialog journey={journey} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(); }} />}
      {dialog?.kind === 'status' && (
        <NoteDialog
          title={dialog.action === 'decline' ? `${firstName(name)} declined the offer` : dialog.action === 'reopen' ? `Reopen ${firstName(name)}’s journey` : `${firstName(name)} is not joining`}
          sub={dialog.action === 'decline' ? 'Their no came by email. The offer closes and the portal link stops working.'
            : dialog.action === 'reopen' ? 'The offer opens again where it was. Revise it if the terms change.'
              : 'Open tasks are cancelled, the device request is recalled and the portal locks.'}
          placeholder={dialog.action === 'reopen' ? 'Why it is reopened (optional)' : 'What they said (optional, HR only)'}
          confirm={dialog.action === 'decline' ? 'Mark declined' : dialog.action === 'reopen' ? 'Reopen' : 'Mark not joining'}
          tone={dialog.action === 'reopen' ? 'primary' : 'danger'}
          onClose={() => setDialog(null)}
          onConfirm={async (note) => { await offerStatusAction(journey.id, dialog.action, note || undefined); setDialog(null); flash('Saved'); changed(); }} />
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
        <NoteDialog title={`Send back ${dialog.doc.label}`} sub={`${firstName(name)} sees your note first, at the top of Up next.`} label="What to fix" required
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
