// H1b · the joiner side panel, as the board design of 18 Nov draws it: the plant
// and who they are, then one journey timeline for every tab (Offer sent, Offer
// confirmed, Joining day (with the employee profile's progress), Week 1, Month 1, Months 2–5, Final
// month, Confirmed; drawn by JourneySteps, which the pre-boarding profile's
// Activity tab shares). The step they are on opens by itself; any step opens in
// place with what HR does there. The footer keeps Open profile, Nudge and the one
// thing to do next; closing an offer asks in place.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { useStore } from '../../store';
import { canOpen, canSeePay } from '../../access';
import { LoadError, SkeletonLines } from '../../ui';
import { getJourney, isNotAvailable, nudgeTask, offerStatusAction } from '../../../services/lifecycle';
import type { ConfirmationDecision, JourneyDetail, LetterKind, TaskView } from '../../../services/lifecycle';
import { CloseOfferBox, NoteDialog, PlantFace } from './shared';
import type { CloseOfferAction } from './format';
import { closeActionOf, nudgeLabel, daysTo, errText, firstName, longDay, openDocuments, shortDay, todayKey } from './format';
import { FinaliseDialog, MarkJoinedDialog } from './OfferDialogs';
import { DecisionDialog } from './Probation';
import { TAB_LABELS, columnLabel } from './boardModel';
import { preboardingHref } from './preboardingLinks';
import { CONFIRMED_STEP, JourneySteps, OPEN, PRE_JOIN } from './JourneySteps';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Offer not sent yet', offer_sent: 'Offer sent', accepted: 'Accepted, portal not sent', finalised: 'Finalised, portal sent', active: 'On the portal',
  docs_approved: 'Documents approved', joined: 'Joined', moved_to_app: 'On the app', confirmed: 'Confirmed', declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining',
};

type Dialog = { kind: 'finalise' } | { kind: 'joined' } | { kind: 'decision' } | { kind: 'status'; action: 'reopen' } | null;

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
  const { user, flash } = s;
  const pay = canSeePay(user);
  const [data, setData] = useState<JourneyDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  // A dialog opened inside a step (tasks, documents, dates…): Escape is the dialog's then.
  const [stepDialog, setStepDialog] = useState(false);
  const [busy, setBusy] = useState('');
  // The step HR opened (null: the step they are on; -1: all closed).
  const [openStep, setOpenStep] = useState<number | null>(null);
  // Closing the offer (declined / not joining) asks in place, as the design's revoke box does.
  const [closing, setClosing] = useState<null | CloseOfferAction>(null);
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
  useEffect(() => { setOpenStep(null); setNudgeMenu(false); setClosing(null); }, [journeyId]);
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
  const anyDialog = dialog !== null || stepDialog;

  if (!data) {
    return (
      <DrawerShell width={480} floating onClose={onClose} label="Joiner" resetKey={journeyId} onEscape={anyDialog ? undefined : onClose}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end' }}><CloseButton onClose={onClose} /></div>
        {error ? <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /> : <div style={{ padding: 20 }}><SkeletonLines lines={8} /></div>}
      </DrawerShell>
    );
  }

  const { journey, tasks, documents, letters, offer, probation } = data;
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
  const reviewQueue = documents.filter((d) => d.status === 'in_review').length;
  const decision: ConfirmationDecision | undefined = probation.decision ?? journey.probation?.decision;
  const decisionLetter: LetterKind | null = decision?.outcome === 'confirm' ? 'confirmation' : decision?.outcome === 'extend' ? 'extension' : null;
  const hasDecisionLetter = decisionLetter ? letters.some((l) => l.kind === decisionLetter && l.state !== 'draft') : true;
  // Nudge (the footer): whoever a waiting step can remind; once a day per step.
  const nudgeable = closed ? [] : waiting.filter((t) => t.canNudge);
  const nudgeOpen = nudgeable.filter((t) => !t.nudgedToday);
  const revisionWaiting = Boolean(offer && offer.status === 'draft' && offer.version > 1);
  // The candidate's pre-boarding profile page: where HR approves each section (opens in a new tab).
  const profileHref = canOpen(user, 'preboarding') ? preboardingHref(journey.id) : undefined;

  // The one thing to do next, as the board's card names it (the footer's main button).
  // A revision (or an approved new joining date) stays HR's draft until sent: the candidate still sees the last version they got.
  let primary: { label: string; go: () => void } | null = null;
  if (closed) primary = { label: 'Reopen', go: () => setDialog({ kind: 'status', action: 'reopen' }) };
  else if (revisionWaiting && pay) primary = { label: 'Send revised offer', go: () => openDocuments(s.setView, 'offer', journey.id) };
  else if (status === 'draft') primary = { label: 'Send offer', go: () => openDocuments(s.setView, 'offer', journey.id, Boolean(offer?.pdfFileId)) };
  // The candidate replies to HR's email to accept; HR marks it accepted here, which sends the joining portal.
  else if (status === 'offer_sent' || status === 'accepted') primary = { label: 'Mark offer accepted', go: () => setDialog({ kind: 'finalise' }) };
  else if (canJoin) primary = { label: 'Mark joined', go: () => setDialog({ kind: 'joined' }) };
  // Documents are reviewed on the employee profile page (its Documents card), opened in a new tab.
  else if (reviewQueue > 0) primary = { label: 'Review documents', go: () => { window.open(preboardingHref(journey.id), '_blank', 'noopener'); } };
  else if (status === 'docs_approved' && !letters.some((l) => l.kind === 'appointment')) primary = { label: 'Make the appointment letter', go: () => openDocuments(s.setView, 'appointment', journey.id) };
  else if (journey.column === 'final_month' && !decision) primary = { label: 'Record decision', go: () => setDialog({ kind: 'decision' }) };
  // The confirmation letter is made and sent on the Confirmed step; an extension letter in Documents.
  else if (decisionLetter === 'confirmation' && !hasDecisionLetter) primary = { label: 'Generate confirmation letter', go: () => setOpenStep(CONFIRMED_STEP) };
  else if (decisionLetter && !hasDecisionLetter) primary = { label: `Make the ${decisionLetter} letter`, go: () => openDocuments(s.setView, decisionLetter, journey.id) };

  // Ending the offer (the design's Revoke offer, on the footer's left): declined while it waits, not joining once accepted.
  const closeAction = closeActionOf(status);

  const nudge = (t: TaskView) => {
    setNudgeMenu(false);
    void run('nudge', async () => { const r = await nudgeTask(journey.id, t.id); flash(r.channel === 'email' ? `Reminder emailed to ${r.to}` : `Reminder sent to ${r.to} in the app`); });
  };

  return (
    <DrawerShell width={480} floating onClose={onClose} label={name} resetKey={journeyId} onEscape={anyDialog ? undefined : nudgeMenu ? () => setNudgeMenu(false) : closing ? () => setClosing(null) : onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>{closed ? `Closed · ${STATUS_LABEL[status] ?? status}` : `${TAB_LABELS[journey.tab] ?? ''} · ${columnLabel(journey.column)}`}</div>
        <CloseButton onClose={onClose} />
      </div>

      <div style={{ padding: 20, display: 'grid', gap: 18, alignContent: 'start', flex: 1 }}>
        <a href={profileHref} target={profileHref ? '_blank' : undefined} rel={profileHref ? 'noopener' : undefined}
          title={profileHref ? `Open ${name}'s employee profile (new tab)` : undefined}
          className={profileHref ? 'pd-headlink' : undefined}
          style={{ display: 'flex', gap: 14, alignItems: 'flex-end', color: 'inherit', textDecoration: 'none', borderRadius: 16, margin: -8, padding: 8, cursor: profileHref ? 'pointer' : 'default' }}>
          <span style={{ width: 76, height: 84, borderRadius: 20, background: closed ? 'var(--surface-2)' : TINT[journey.tab] ?? 'var(--surface-2)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flex: 'none', overflow: 'hidden' }}>
            <PlantFace plant={journey.plant} size={66} name={name} userId={journey.userId} />
          </span>
          <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{name}</div>
            {role && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{role}</div>}
            <div style={{ fontSize: 13, fontWeight: 500, color: closed ? 'var(--ink-2)' : 'var(--accent-ink)' }}>{closed ? STATUS_LABEL[status] ?? status : journeyLine(status, journey.tj, journey.dayLabel)}</div>
          </div>
          {profileHref && <span aria-hidden="true" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 18, color: 'var(--ink-3)' }}>↗</span>}
        </a>

        {closed && (
          <div className="pd-note">
            {STATUS_LABEL[status] ?? status}{journey.closedAt ? ` on ${longDay(journey.closedAt)}` : ''}{journey.closedReason ? `. ${journey.closedReason}` : ''}
          </div>
        )}

        <JourneySteps data={data} busy={busy} setBusy={setBusy} onChanged={changed} openStep={openStep} onOpenStep={setOpenStep} onDialogOpen={setStepDialog} />

        {closing && (
          <CloseOfferBox first={first} action={closing} busy={Boolean(busy)} onKeep={() => setClosing(null)}
            onConfirm={(note) => run('close', () => offerStatusAction(journey.id, closing, note), closing === 'decline' ? `${first}’s offer is closed as declined` : `${first} is marked not joining`).then((ok) => { if (ok) setClosing(null); return ok; })} />
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
    </DrawerShell>
  );
}
