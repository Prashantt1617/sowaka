// People › Employees › Pre-boarding › a candidate (`#preboarding/<journeyId>`): their
// Employee profile from the joining portal, one card per section with every field
// and its documents. HR reviews each document (the board panel's own review calls)
// and approves a section once it is complete, which locks it: the candidate can no
// longer edit it on the portal or the app. Unlock hands it back. Its own address, so
// the onboarding board's panel opens it in a new tab.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen } from '../../access';
import { usePageHead } from '../../pageHead';
import { Avatar, LoadError, Pill, SkeletonLines } from '../../ui';
import { ApiError } from '../../../services/http';
import { getPreboardingProfile, isNotAvailable, reviewDocument, setPreboardingSectionApproved } from '../../../services/lifecycle';
import type { PreboardingDocument, PreboardingProfile as Profile, PreboardingSection } from '../../../services/lifecycle';
import { NoteDialog, NotSwitchedOn } from './shared';
import { errText, firstName, longDay, shortDay } from './format';
import { pctColour, pctOf } from './boardModel';
import { FileChips } from './preboardingParts';
import { candidateStatus, docStatus, rememberPreboardingList } from './preboardingLinks';
import '../people.css';

type Tone = { bg: string; fg: string };
const STATE: Record<'todo' | 'done' | 'approved', { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: { bg: 'var(--attn-bg)', fg: 'var(--attn)' } },
  done: { label: 'Done', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  approved: { label: 'Approved', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
};

export function PreboardingProfile() {
  const s = useStore();
  const { flash, user } = s;
  const journeyId = s.viewParam;
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<{ text: string; off?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [sendBack, setSendBack] = useState<PreboardingDocument | null>(null);
  // Candidates' documents are HR's (People › Employees or full access); the onboarding tab alone sees where each one is.
  const seesDocuments = canOpen(user, 'employees');

  const back = useCallback(() => { rememberPreboardingList(); s.setView('employees'); }, [s]);
  usePageHead({ title: data?.candidate.name ?? 'Pre-boarding profile', eyebrow: 'People · Employees · Pre-boarding', onBack: back, backLabel: 'Back to the Pre-boarding list' });

  useEffect(() => {
    if (!journeyId) return undefined;
    let live = true;
    setError(null);
    // Another candidate in the same tab (Back, Forward): never show the last one's details while theirs load.
    setData((d) => (d && d.journeyId !== journeyId ? null : d));
    getPreboardingProfile(journeyId)
      .then((d) => { if (live) setData(d); })
      .catch((e: unknown) => {
        if (!live) return;
        if (isNotAvailable(e)) setError({ text: '', off: true });
        else if (e instanceof ApiError && e.status === 404) setError({ text: 'This candidate could not be found. They may have been removed, or the link is from another company.' });
        else if (e instanceof ApiError && e.status === 403) setError({ text: 'You do not have access to this candidate’s profile.' });
        else setError({ text: errText(e, 'Could not load this profile') });
      });
    return () => { live = false; };
  }, [journeyId, attempt]);

  if (!journeyId) {
    return (
      <section className="pd-card" style={{ padding: 28, textAlign: 'center', color: 'var(--ink-2)', fontSize: 13, display: 'grid', gap: 14, justifyItems: 'center' }}>
        <span>No candidate is picked. Open one from the Pre-boarding list on Employees.</span>
        <button type="button" className="pd-btn" onClick={back}>Open the Pre-boarding list</button>
      </section>
    );
  }
  if (error?.off) return <NotSwitchedOn />;
  if (!data) {
    return error
      ? <section className="pd-card"><LoadError text={error.text} onRetry={() => setAttempt((n) => n + 1)} /></section>
      : (
        <div className="pd-psecs">
          <section className="pd-card" style={{ padding: 20 }}><SkeletonLines lines={4} /></section>
          <section className="pd-card" style={{ padding: 20 }}><SkeletonLines lines={6} /></section>
          <section className="pd-card" style={{ padding: 20 }}><SkeletonLines lines={6} /></section>
        </div>
      );
  }

  const { candidate } = data;
  const first = firstName(candidate.name);
  const role = [candidate.designation, candidate.department].filter(Boolean).join(' · ');
  const pct = pctOf(data);
  const approvedCount = data.sections.filter((x) => x.approved).length;

  const approve = async (section: PreboardingSection, on: boolean) => {
    setBusy(`sec:${section.key}`);
    try {
      setData(await setPreboardingSectionApproved(data.journeyId, section.key, on));
      flash(on ? `${section.title} approved and locked` : `${section.title} unlocked. ${first} can edit it again.`);
    } catch (e) {
      flash(errText(e, on ? 'Could not approve this section' : 'Could not unlock this section'), 'error');
    } finally { setBusy(''); }
  };
  const approveDoc = async (doc: PreboardingDocument) => {
    setBusy(`doc:${doc.id}`);
    try {
      await reviewDocument(doc.id, 'approve');
      flash(`${doc.label} approved`);
      setAttempt((n) => n + 1);
    } catch (e) {
      flash(errText(e, 'Could not approve the document'), 'error');
    } finally { setBusy(''); }
  };

  return (
    <div className="pd-prof" style={{ animation: 'fade .3s ease both' }}>
      <section className="pd-card pd-phead">
        <div className="ph-id">
          <Avatar name={candidate.name} size={52} font={21} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pn">
              <h1>{candidate.name}</h1>
              <Pill label={candidateStatus(String(candidate.status))} tone={{ bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }} />
            </div>
            <span className="sub">{role || 'Role not set'}</span>
          </div>
        </div>
        <div className="pd-facts">
          <HeadFact label="Joining date" value={candidate.tj ? longDay(candidate.tj) : 'Not set'} />
          <HeadFact label="Personal email" value={candidate.personalEmail || '—'} />
          <HeadFact label="Phone" value={candidate.phone || '—'} />
          <HeadFact label="Profile" value={
            <span style={{ display: 'grid', gap: 6 }}>
              <span>{data.done} of {data.total} sections done</span>
              <span style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', maxWidth: 200 }}>
                <i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} />
              </span>
            </span>
          } />
          <HeadFact label="Approved" value={`${approvedCount} of ${data.sections.length} sections`} />
          <HeadFact label="Status" value={candidateStatus(String(candidate.status))} />
        </div>
      </section>

      {data.sections.length === 0 ? (
        <section className="pd-card" style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          {first} has not started the Employee profile on the joining portal yet.
        </section>
      ) : (
        <div className="pd-psecs">
          {data.sections.map((sec) => (
            <SectionCard key={sec.key} section={sec} first={first} busy={busy} seesDocuments={seesDocuments}
              onApprove={() => void approve(sec, true)} onUnlock={() => void approve(sec, false)}
              onApproveDoc={(d) => void approveDoc(d)} onSendBack={setSendBack} />
          ))}
        </div>
      )}

      {sendBack && (
        <NoteDialog title={`Send back ${sendBack.label}`} sub={`${first} sees your note first, at the top of Up next.`} label="What to fix" required
          placeholder="e.g. The scan is cut off at the bottom. Please upload the full page." confirm="Send back" tone="danger"
          onClose={() => setSendBack(null)}
          onConfirm={async (note) => { await reviewDocument(sendBack.id, 'send_back', note); flash(`${sendBack.label} sent back`); setSendBack(null); setAttempt((n) => n + 1); }} />
      )}
    </div>
  );
}

function HeadFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="pd-fact">
      <span className="pd-eyebrow">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function SectionCard({ section: sec, first, busy, seesDocuments, onApprove, onUnlock, onApproveDoc, onSendBack }: {
  section: PreboardingSection; first: string; busy: string; seesDocuments: boolean;
  onApprove: () => void; onUnlock: () => void; onApproveDoc: (d: PreboardingDocument) => void; onSendBack: (d: PreboardingDocument) => void;
}) {
  const state = sec.approved ? 'approved' : sec.done ? 'done' : 'todo';
  const st = STATE[state];
  const working = busy === `sec:${sec.key}`;
  const action = sec.approved
    ? <button type="button" className="pd-btn sm" disabled={Boolean(busy)} onClick={onUnlock}>{working ? 'Unlocking…' : 'Unlock'}</button>
    : <button type="button" className="pd-btn sm primary" disabled={!sec.done || Boolean(busy)} title={sec.done ? undefined : `${first} has not finished this section yet`} onClick={onApprove}>{working ? 'Approving…' : 'Approve section'}</button>;
  return (
    <section className="pd-card pd-psec" aria-labelledby={`pb-sec-${sec.key}`}>
      <div className="pd-sec-h" style={{ gap: 10, flexWrap: 'wrap' }}>
        <h3 id={`pb-sec-${sec.key}`}>{sec.title}</h3>
        <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />
        {action}
      </div>
      <div className="pd-sec-b" style={{ display: 'grid', gap: 14 }}>
        {sec.approved && (
          <div className="pd-note">
            <span>Approved by <b>{sec.approved.byName}</b> on {shortDay(sec.approved.at)}. {first} can no longer edit this section on the portal or the app.</span>
          </div>
        )}
        {sec.fields.length > 0 ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px 24px', margin: 0 }}>
            {sec.fields.map((f, i) => (
              <div key={`${f.label}-${i}`} style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                <dt style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{f.label}</dt>
                <dd style={{ margin: 0, fontSize: 13, color: f.value ? 'var(--ink)' : 'var(--ink-4)', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{f.value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Nothing filled in yet.</div>}
        {sec.documents.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Documents</h4>
            {!seesDocuments && <div className="pd-note">Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
            {sec.documents.map((d) => (
              <DocumentRow key={d.id} doc={d} canReview={seesDocuments} busy={busy === `doc:${d.id}`} disabled={Boolean(busy)}
                onApprove={() => onApproveDoc(d)} onSendBack={() => onSendBack(d)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DocumentRow({ doc, canReview, busy, disabled, onApprove, onSendBack }: { doc: PreboardingDocument; canReview: boolean; busy: boolean; disabled: boolean; onApprove: () => void; onSendBack: () => void }) {
  const st = docStatus(doc.status) ?? docStatus('todo')!;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{doc.label}{doc.required ? '' : <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · optional</span>}</b>
        <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />
      </div>
      {canReview && <FileChips files={doc.files} />}
      {doc.hrNote && doc.status === 'sent_back' && <div style={{ fontSize: 12.5, color: 'var(--warn)', overflowWrap: 'anywhere' }}>Your note: {doc.hrNote}</div>}
      {doc.status === 'in_review' && canReview && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="pd-btn sm primary" onClick={onApprove} disabled={disabled}>{busy ? 'Approving…' : 'Approve'}</button>
          <button type="button" className="pd-btn sm" onClick={onSendBack} disabled={disabled}>Send back with a note</button>
        </div>
      )}
    </div>
  );
}
