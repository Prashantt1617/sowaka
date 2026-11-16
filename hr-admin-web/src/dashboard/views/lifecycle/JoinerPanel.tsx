// H1b · the joiner side panel: where they are on the journey, what waits on
// whom, the key facts, and everything HR does for one joiner: the offer and
// its versions, joining-date requests, documents (preview, approve, send back),
// letters, tasks by phase, the Day-1 pass, manager and buddy, the batch and
// probation with its decision.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DrawerShell, CloseButton } from '../../drawers/shell';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { LoadError, Pill, SkeletonLines } from '../../ui';
import {
  decideBankPfRequest, decideDateRequest, getJourney, isNotAvailable, journeyTaskAction, listTemplates, nudgeTask, offerStatusAction, reviewDocument, updateJourney,
} from '../../../services/lifecycle';
import type {
  BankPfRequest, CandidateDocumentView, ConfirmationDecision, Day1Pass, JourneyDetail, LetterKind, LetterView, TaskView, TemplateListItem,
} from '../../../services/lifecycle';
import { FilePreview, NoteDialog, NudgeButton, OwnerChip, Pick, Plant, Field, nudgeLabel } from './shared';
import {
  DOCS_OPEN_KEY, PHASES, areaStyle, daysTo, dayTime, decisionLine, dueText, errText, fileSize, firstName, inputStyle, longDay, rupees, sectionLabel, shortDay, todayKey,
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

function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} style={{ padding: '16px 20px', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h3 style={{ ...sectionLabel, margin: 0, flex: 1 }}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v != null && v !== '');
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 34%) minmax(0, 1fr)', gap: '6px 12px', margin: 0, fontSize: 13 }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ink-3)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{v}</dd>
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

  useEffect(() => {
    let live = true;
    setError('');
    getJourney(journeyId)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(isNotAvailable(e) ? 'Employee lifecycle is not switched on for your company.' : errText(e, 'Could not load this joiner')); });
    return () => { live = false; };
  }, [journeyId, attempt]);
  useEffect(() => { listTemplates('onboarding').then(setTemplates).catch(() => undefined); }, []);

  const changed = useCallback(() => { setAttempt((n) => n + 1); onChanged(); }, [onChanged]);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(key);
    try { await fn(); if (ok) flash(ok); changed(); return true; } catch (e) { flash(errText(e), 'error'); return false; } finally { setBusy(''); }
  };

  if (!data) {
    return (
      <DrawerShell width={460} onClose={onClose}>
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
  const waiting = tasks.filter((t) => OPEN.has(t.status) && (!t.opensAt || t.opensAt.slice(0, 10) <= today))
    .sort((a, b) => String(a.dueAt ?? '9999').localeCompare(String(b.dueAt ?? '9999'))).slice(0, 6);
  const approved = documents.filter((d) => d.status === 'approved').length;
  const reviewQueue = documents.filter((d) => d.status === 'in_review').length;
  const decision: ConfirmationDecision | undefined = probation.decision ?? journey.probation?.decision;
  const decisionLetter: LetterKind | null = decision?.outcome === 'confirm' ? 'confirmation' : decision?.outcome === 'extend' ? 'extension' : null;
  const hasDecisionLetter = decisionLetter ? letters.some((l) => l.kind === decisionLetter && l.state !== 'draft') : true;
  const template = templates.find((t) => t.id === journey.templateId);
  // The onboarding tab alone (IT, Admin) sees each document's status, never the files.
  const seesDocuments = data.viewer?.seesDocuments !== false;
  // Nudge: the first thing waiting that can be reminded and was not today.
  const nudgeable = waiting.find((t) => t.canNudge && !t.nudgedToday);

  // The one thing to do next, as the board's card names it.
  let primary: { label: string; go: () => void } | null = null;
  if (closed) primary = { label: 'Reopen', go: () => setDialog({ kind: 'status', action: 'reopen' }) };
  else if (status === 'draft') primary = { label: 'Send offer', go: () => setDialog({ kind: 'offer', mode: 'send', start: offer?.pdfFileId ? 'email' : 'letter' }) };
  else if (status === 'offer_sent') primary = { label: 'Resend offer email', go: () => setDialog({ kind: 'offer', mode: 'send', start: offer?.pdfFileId ? 'email' : 'letter' }) };
  else if (status === 'accepted') primary = { label: 'Finalise', go: () => setDialog({ kind: 'finalise' }) };
  else if (canJoin) primary = { label: 'Mark joined', go: () => setDialog({ kind: 'joined' }) };
  else if (reviewQueue > 0) primary = { label: 'Review documents', go: () => document.getElementById('lf-panel-docs')?.scrollIntoView({ behavior: 'smooth' }) };
  else if (status === 'docs_approved' && !letters.some((l) => l.kind === 'appointment')) primary = { label: 'Make the appointment letter', go: () => openDocuments(s.setView, 'appointment', journey.id) };
  else if (journey.column === 'final_month' && !decision) primary = { label: 'Record decision', go: () => setDialog({ kind: 'decision' }) };
  else if (decisionLetter && !hasDecisionLetter) primary = { label: `Make the ${decisionLetter} letter`, go: () => openDocuments(s.setView, decisionLetter, journey.id) };

  const secondary: { label: string; go: () => void; danger?: boolean }[] = [];
  if (journey.userId) secondary.push({ label: 'Open profile', go: () => { onClose(); s.openProfile(journey.userId!); } });
  if (offer && PRE_JOIN.has(status) && pay) secondary.push({ label: status === 'draft' ? 'Edit offer' : 'Revise offer', go: () => setDialog({ kind: 'offer', mode: 'revise', start: 'details' }) });
  if (status === 'offer_sent') secondary.push({ label: 'Mark declined', go: () => setDialog({ kind: 'status', action: 'decline' }), danger: true });
  if (['accepted', 'finalised', 'active', 'docs_approved'].includes(status)) secondary.push({ label: 'Not joining', go: () => setDialog({ kind: 'status', action: 'not-joining' }), danger: true });
  if (journey.column === 'final_month' && decision) secondary.push({ label: 'Change decision', go: () => setDialog({ kind: 'decision' }) });
  if (nudgeable && !closed) {
    secondary.push({
      label: busy === 'nudge' ? 'Sending…' : nudgeLabel(nudgeable.ownerRole, nudgeable.ownerName),
      go: () => void run('nudge', async () => { const r = await nudgeTask(journey.id, nudgeable.id); flash(r.channel === 'email' ? `Reminder emailed to ${r.to}` : `Reminder sent to ${r.to} in the app`); }),
    });
  }

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
  ] : [];

  return (
    <DrawerShell width={460} onClose={onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--hi)' }}>{TAB_LABEL[journey.tab] ?? ''} · {COLUMN_LABEL[journey.column] ?? journey.column}</div>
        <CloseButton onClose={onClose} />
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', gap: 14, alignItems: 'center' }}>
        <Plant plant={journey.plant} size={66} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{name}</div>
          {role && <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{role}</div>}
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{journey.dayLabel || STATUS_LABEL[status] || status}</div>
        </div>
      </div>

      <div style={{ padding: '0 20px 16px' }}>
        <div role="img" aria-label={`Journey: ${TRACK[at]}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${TRACK.length}, 1fr)`, gap: 4 }}>
          {TRACK.map((t, i) => <span key={t} title={t} style={{ height: 6, borderRadius: 99, background: closed ? 'var(--line-2)' : i < at ? 'var(--ok-solid)' : i === at ? 'var(--accent)' : 'var(--line)' }} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
          <span>Offer</span><span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{closed ? STATUS_LABEL[status] : TRACK[at]}</span><span>Confirmed</span>
        </div>
      </div>

      {(primary || secondary.length > 0) && (
        <div style={{ padding: '0 20px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {primary && <button type="button" className="pd-btn primary" onClick={primary.go}>{primary.label}</button>}
          {secondary.map((b) => <button key={b.label} type="button" className="pd-btn" onClick={b.go} disabled={Boolean(busy)} style={b.danger ? { color: 'var(--bad)' } : undefined}>{b.label}</button>)}
        </div>
      )}

      <Section title="Waiting on">
        {waiting.length === 0 ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}><OwnerChip role="automatic" /><span style={{ flex: 1 }}>Nothing waiting</span><span style={{ color: 'var(--ink-3)' }}>—</span></div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {waiting.map((t) => (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', fontSize: 13 }}>
                <OwnerChip role={t.ownerRole} name={t.ownerName} />
                <span style={{ overflowWrap: 'anywhere' }}>{t.title}</span>
                <span style={{ color: t.late ? 'var(--bad)' : 'var(--ink-3)', whiteSpace: 'nowrap', fontWeight: t.late ? 500 : 400 }}>{dueText(t.dueAt, t.late)}</span>
                {t.canNudge && !closed && (
                  <span style={{ gridColumn: '2 / 4', justifySelf: 'end' }}>
                    <NudgeButton compact journeyId={journey.id} taskId={t.id} role={t.ownerRole} name={t.ownerName} done={t.nudgedToday} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Details">
        <Facts rows={[
          ['Joining', journey.tj ? `${longDay(journey.tj)}${daysTo(journey.tj) > 0 && PRE_JOIN.has(status) ? ` · ${daysTo(journey.tj)} days to go` : ''}` : ''],
          ['Personal email', journey.candidate?.personalEmail],
          ['Work email', journey.candidate?.workEmail],
          ['Manager', journey.managerName],
          ['Buddy', journey.buddyName],
          ['Template', template?.name],
          ['Documents', documents.length ? `${approved} of ${documents.length} approved` : ''],
          ['Offer', offer ? `Version ${offer.version} · ${offer.status}` : ''],
          ['Accepted', offer?.acceptedAt ? dayTime(offer.acceptedAt) : ''],
          ['Probation', journey.probation ? `${journey.probation.months} months${journey.probation.extendedBy ? `, extended by ${journey.probation.extendedBy}` : ''}` : ''],
          ['Decision', decision ? decisionLine(decision, pay) : ''],
          ['Closed', journey.closedAt ? `${longDay(journey.closedAt)}${journey.closedReason ? ` · ${journey.closedReason}` : ''}` : ''],
        ]} />
      </Section>

      {offer && (
        <Section title={`Offer · version ${offer.version}`} aside={offer.pdfFileId ? <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'file', id: offer.pdfFileId!, name: `Offer letter – ${name}.pdf` })}>View PDF</button> : undefined}>
          <Facts rows={offerFacts} />
          {offer.changedFields && offer.changedFields.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Changed in this version: {offer.changedFields.join(', ')}</div>}
          {offer.versions.length > 1 && (
            <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>
              {offer.versions.slice().reverse().map((v) => (
                <div key={v.version}>Version {v.version} · {v.status}{v.sentAt ? ` · sent ${shortDay(v.sentAt)}` : ''}{v.acceptedAt ? ` · accepted ${shortDay(v.acceptedAt)}` : ''}</div>
              ))}
            </div>
          )}
        </Section>
      )}

      {dateRequests.length > 0 && (
        <Section title="Joining date requests">
          <div style={{ display: 'grid', gap: 10 }}>
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
          </div>
        </Section>
      )}

      {journey.bankPfRequest && (journey.bankPfRequest.status === 'pending' || journey.bankPfRequest.decidedAt) && (
        <Section title="Bank and PF change">
          <BankPfCard request={journey.bankPfRequest} pay={pay} busy={Boolean(busy)} onDecide={(d) => setDialog({ kind: 'bankpf', decision: d })} />
        </Section>
      )}

      {documents.length > 0 && (
        <Section id="lf-panel-docs" title={`Documents · ${approved} of ${documents.length} approved`}>
          {!seesDocuments && <div className="pd-note" style={{ marginBottom: 10 }}>Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {documents.map((d) => <DocumentRow key={d.id} doc={d} busy={busy === `doc:${d.id}`} canReview={seesDocuments}
              onOpen={(f) => setDialog({ kind: 'file', id: f.id, name: f.name })}
              onApprove={() => void run(`doc:${d.id}`, () => reviewDocument(d.id, 'approve'), `${d.label} approved`)}
              onSendBack={() => setDialog({ kind: 'sendback', doc: d })} />)}
          </div>
        </Section>
      )}

      {letters.length > 0 && (
        <Section title="Letters">
          <div style={{ display: 'grid', gap: 8 }}>
            {letters.map((l) => <LetterRow key={l.id} letter={l} name={name} onOpen={(id, n) => setDialog({ kind: 'file', id, name: n })} onDocuments={() => openDocuments(s.setView, l.kind, journey.id)} />)}
          </div>
        </Section>
      )}

      <Section title="Tasks">
        <TasksByPhase tasks={tasks} busy={busy} onAction={(task, action) => setDialog({ kind: 'task', task, action })} />
      </Section>

      {!closed && PRE_JOIN.has(status) && status !== 'draft' && (
        <Section title="Day-1 pass">
          <Day1PassEditor key={journey.id} value={journey.day1Pass} tj={journey.tj}
            onSave={(p) => run('pass', () => updateJourney(journey.id, { day1Pass: p }), 'Day-1 pass saved')} busy={busy === 'pass'} />
        </Section>
      )}

      {!closed && (
        <Section title="Manager and buddy">
          <PeoplePicker key={`${journey.managerUserId}-${journey.buddyUserId}`} managerUserId={journey.managerUserId} buddyUserId={journey.buddyUserId} exclude={journey.userId}
            emps={emps} busy={busy === 'people'}
            onSave={(patch) => run('people', () => updateJourney(journey.id, patch), 'Saved')} />
          {status === 'draft' && templates.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <Field label="Onboarding template" hint="Can change until the offer is sent">
                <Pick value={journey.templateId} onChange={(v) => void run('template', () => updateJourney(journey.id, { templateId: v }), 'Template changed')}>
                  {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>)}
                </Pick>
              </Field>
            </div>
          )}
        </Section>
      )}

      {batch.length > 0 && (
        <Section title={`Joining the same day · ${batch.length}`}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{batch.map((b) => b.name).join(', ')}</div>
        </Section>
      )}

      {(journey.userId || probation.months.length > 0) && (
        <Section title={`Probation${journey.probation ? ` · ${journey.probation.months + (journey.probation.extendedBy ?? 0)} months` : ''}`}
          aside={journey.column === 'final_month' ? <button type="button" className="pd-btn sm" onClick={() => setDialog({ kind: 'decision' })}>{decision ? 'Change decision' : 'Record decision'}</button> : undefined}>
          {decision && <div className="pd-note" style={{ marginBottom: 10 }}>{decisionLine(decision, pay)}</div>}
          <ProbationMonths months={probation.months} total={(journey.probation?.months ?? 0) + (journey.probation?.extendedBy ?? 0)} />
        </Section>
      )}

      <div style={{ height: 24, flexShrink: 0 }} />

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
            ['Agenda', value?.agenda?.length ? value.agenda.map((a) => `${a.time} ${a.title}${a.with ? ` (${a.with})` : ''}`).join(' · ') : ''],
          ]} />
        ) : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Not filled in yet. The candidate sees it from 7 days before joining: time, place or link, who to ask for, what to bring and the day’s agenda.</div>}
        <div><button type="button" className="pd-btn sm" onClick={() => setEditing(true)}>{filledIn ? 'Edit pass' : 'Fill in the pass'}</button></div>
      </div>
    );
  }
  const agenda = p.agenda ?? [];
  const setAgenda = (i: number, patch: Partial<{ time: string; title: string; with?: string }>) => set({ agenda: agenda.map((a, n) => (n === i ? { ...a, ...patch } : a)) });
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
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) minmax(0, 0.8fr) auto', gap: 6 }}>
              <input type="time" value={a.time} onChange={(e) => setAgenda(i, { time: e.target.value })} aria-label="Time" style={inputStyle} />
              <input value={a.title} onChange={(e) => setAgenda(i, { title: e.target.value })} placeholder="What" aria-label="What" style={inputStyle} />
              <input value={a.with ?? ''} onChange={(e) => setAgenda(i, { with: e.target.value })} placeholder="With / where" aria-label="With or where" style={inputStyle} />
              <button type="button" className="pd-btn sm ghost" aria-label="Remove" onClick={() => set({ agenda: agenda.filter((_, n) => n !== i) })}>×</button>
            </div>
          ))}
          <div><button type="button" className="pd-btn sm" onClick={() => set({ agenda: [...agenda, { time: '10:00', title: '' }] })}>+ Add to the agenda</button></div>
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
