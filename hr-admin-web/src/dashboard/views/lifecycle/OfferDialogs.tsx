// The offer's dialogs on the board: Finalise and Mark joined, and the letter
// preview Document templates uses. Making, revising and sending an offer is on
// Documents › Offer letter (OfferWorkbench.tsx), which replaced the New offer
// letter dialog.
import { useState } from 'react';
import { useStore } from '../../store';
import { finaliseOffer, markJoined } from '../../../services/lifecycle';
import type { JourneyView } from '../../../services/lifecycle';
import { Field, Modal } from './shared';
import { errText, firstName, inputStyle, longDay, todayKey } from './format';
import { LETTER_CSS } from './letterDoc';

/** The letter as it will print: a white page, highlighted fields. */
export function LetterPreview({ html, caption = true }: { html: string; caption?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <style>{LETTER_CSS}</style>
      <div style={{ background: '#fff', color: '#141416', borderRadius: 6, border: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: '28px 30px', maxHeight: '62vh', overflowY: 'auto', colorScheme: 'light', overflowWrap: 'anywhere' }}
        dangerouslySetInnerHTML={{ __html: html }} />
      {caption && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Highlighted text comes from the details on the left. Orange means it is still missing.</div>}
    </div>
  );
}

/** Mark offer accepted: the candidate replied to accept; the portal account is made and its link emailed. */
export function FinaliseDialog({ journey, onClose, onDone }: { journey: JourneyView; onClose: () => void; onDone: () => void }) {
  const { flash } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = journey.candidate?.name ?? 'the candidate';
  const go = async () => {
    setBusy(true); setError('');
    try {
      await finaliseOffer(journey.id);
      flash(`Marked accepted. ${firstName(name)}’s joining portal is on its way`);
      onDone();
    } catch (e) { setError(errText(e, 'Could not mark it accepted')); setBusy(false); }
  };
  return (
    <Modal title={`Mark ${firstName(name)}’s offer accepted`} onClose={onClose} busy={busy} width={480}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Sending…' : 'Mark accepted and send portal'}</button></>}>
      <p style={{ margin: 0 }}>Did {name} reply to accept the offer? Marking it accepted creates their joining portal and emails the link to <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{journey.candidate?.personalEmail ?? 'their personal email'}</b>. They sign in with a code sent to that email.</p>
      <p style={{ margin: 0 }}>You assign and follow their onboarding tasks here. {journey.managerName ?? 'Their manager'} sees them under Team › New joiners in the app from the day before they join.</p>
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}

/** Mark joined: on the joining day, the employee record and the work email the app signs in with. */
export function MarkJoinedDialog({ journey, onClose, onDone }: { journey: JourneyView; onClose: () => void; onDone: (userId: string) => void }) {
  const { flash } = useStore();
  const [workEmail, setWorkEmail] = useState(journey.candidate?.workEmail ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = journey.candidate?.name ?? 'They';
  const early = journey.tj ? journey.tj > todayKey() : false;
  const go = async () => {
    if (!/^\S+@\S+\.\S+$/.test(workEmail.trim())) { setError('Enter the work email'); return; }
    setBusy(true); setError('');
    try {
      const r = await markJoined(journey.id, { workEmail: workEmail.trim(), employeeId: employeeId.trim() || undefined });
      flash(`${firstName(name)} has joined. Their app signs in with ${workEmail.trim()}`);
      onDone(r.userId);
    } catch (e) { setError(errText(e, 'Could not mark them joined')); setBusy(false); }
  };
  return (
    <Modal title={`Mark ${firstName(name)} joined`} sub={journey.tj ? `Joining day ${longDay(journey.tj)}` : undefined} onClose={onClose} busy={busy} width={480}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy || early}>{busy ? 'Saving…' : 'Mark joined'}</button></>}>
      {early && <div className="pd-note">This opens on the joining day. If they are joining on another day, approve a new joining date first.</div>}
      <p style={{ margin: 0 }}>This adds them to the directory with the details from their accepted offer. The portal then shows the work email, and the app signs in with it and a one-time code.</p>
      <Field label="Work email" required>
        <input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="name@company.com" style={inputStyle} autoFocus />
      </Field>
      <Field label="Employee ID" hint="Optional. Leave empty to add it later from their profile.">
        <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={inputStyle} />
      </Field>
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}
