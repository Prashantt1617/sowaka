// The Support desk's confirm dialogs: send a ticket back to the head (staff,
// optional note), and resolve (final: there is no reopen in phase 1).
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// While the action is on its way the dialog stays: closing it then would free
// the desk underneath before the action has landed.
function DialogShell({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.35)', animation: 'ovl .2s ease both' }} />
      <div style={{ position: 'relative', width: 'min(480px, 100%)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(34,34,34,.25)', padding: '20px 22px', animation: 'pop .18s ease both' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Buttons({ busy, onClose, onConfirm, label, busyLabel, tone = '#0571A6', disabled }: { busy: boolean; onClose: () => void; onConfirm: () => void; label: string; busyLabel: string; tone?: string; disabled?: boolean }) {
  const off = busy || disabled;
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
      <button type="button" disabled={busy} onClick={onClose} style={{ ...ghostBtn, opacity: busy ? 0.55 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>Cancel</button>
      <button type="button" disabled={off} onClick={onConfirm} style={{ ...primaryBtn, background: tone, opacity: off ? 0.55 : 1, cursor: off ? 'not-allowed' : 'pointer' }}>
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

export function SendBackDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <DialogShell title="Send back to the Support head?" busy={busy} onClose={onClose}>
      <div style={{ fontSize: 14.5, color: '#484848', lineHeight: 1.55, marginTop: 8 }}>
        The ticket leaves your desk and goes back to the head’s queue with its conversation. The employee isn’t told.
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#717171', margin: '16px 0 6px' }}>NOTE FOR THE HEAD · OPTIONAL</div>
      <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="e.g. This is a leave question, not payroll" style={textarea} />
      <Buttons busy={busy} onClose={onClose} onConfirm={() => onConfirm(note.trim())} label="Send back" busyLabel="Sending…" />
    </DialogShell>
  );
}

export function ConfirmResolveDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <DialogShell title="Resolve this ticket?" busy={busy} onClose={onClose}>
      <div style={{ fontSize: 14.5, color: '#484848', lineHeight: 1.55, marginTop: 8 }}>
        The conversation closes for good. The employee is notified and can’t reply here; to continue they raise a new ticket.
      </div>
      <Buttons busy={busy} onClose={onClose} onConfirm={onConfirm} label="Resolve" busyLabel="Resolving…" tone="#4F7A52" />
    </DialogShell>
  );
}

const textarea: CSSProperties = { width: '100%', resize: 'vertical', border: '1px solid #EBEBEB', borderRadius: 10, padding: '9px 11px', fontSize: 14.5, lineHeight: 1.45, fontFamily: 'inherit', outline: 'none', color: '#222222' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
