// Pieces every employee-lifecycle page shares: the plant, owner chips, flag
// pills, the on/off switch, a centred dialog, a file preview, and the date
// and label helpers. Drawn with the dashboard's own tokens and pd-* classes
// so the lifecycle pages read like the rest of the dashboard.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pill, Spinner } from '../../ui';
import { iconBtn } from '../../ds';
import { IconClose } from '../../icons';
import type { JourneyFlag, OwnerRole, PlantState } from '../../../services/lifecycle';
import { fetchLifecycleFile } from '../../../services/lifecycle';
import '../people.css';
import { areaStyle, errText, FLAG, inputStyle, labelStyle, OWNER_LABEL, OWNER_TONE } from './format';

/** Who a task waits on: Employee (Arjun), HR · you, Automatic. */
export function OwnerChip({ role, name, you }: { role: OwnerRole; name?: string; you?: boolean }) {
  const t = OWNER_TONE[role] ?? OWNER_TONE.automatic;
  const label = you && (role === 'hr' || role === 'hr_manager') ? `${OWNER_LABEL[role]} · you` : name ? `${OWNER_LABEL[role]} (${name})` : OWNER_LABEL[role];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, padding: '2px 9px', borderRadius: 999, background: t.bg, color: t.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {label}
    </span>
  );
}

export function FlagPill({ flag }: { flag: JourneyFlag }) {
  const f = FLAG[flag];
  if (!f) return null;
  return <Pill label={f.label} tone={f.tone} fontSize={11} padding="2px 9px" />;
}

// —— Plant ———————————————————————————————————————————————————————————————

const STAGE_NAMES = ['seed', 'sprout', 'seedling', 'sapling', 'bud', 'bloom'];
/** The growth plant: seed (watered 0–3 in pre-boarding) to bloom on confirmation; droops when something is overdue, never red. */
export function Plant({ plant, size = 26 }: { plant?: PlantState | null; size?: number }) {
  const stage = plant?.stage ?? 0;
  const water = plant?.water ?? 0;
  const droop = plant?.droop === true;
  const leaf = droop ? '#9DB8A6' : '#3E9C6B';
  const leafDark = droop ? '#86A08F' : '#23806A';
  const label = `Plant at ${STAGE_NAMES[stage]} stage${stage === 0 ? `, watered ${water} of 3` : ''}${droop ? ', needs water' : ''}`;
  const tilt = droop ? 'rotate(-14 24 38)' : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={label} style={{ flexShrink: 0, display: 'block' }}>
      <title>{label}</title>
      <path d="M14 36h20l-2.4 9.2a2 2 0 0 1-1.9 1.5H18.3a2 2 0 0 1-1.9-1.5z" fill="#C9835A" />
      <rect x="12" y="33" width="24" height="4.5" rx="2" fill="#B5703F" />
      {stage === 0 ? (
        <g>
          <ellipse cx="24" cy="31" rx="4.2" ry="3" fill="#8A6A3C" />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${17 + i * 7} ${18 - (i === 1 ? 3 : 0)}c0 2-1.5 3-1.5 4.2a1.5 1.5 0 0 0 3 0c0-1.2-1.5-2.2-1.5-4.2z`} fill={i < water ? '#3B8FD9' : 'var(--line-2)'} />
          ))}
        </g>
      ) : (
        <g transform={tilt}>
          <path d={`M24 34V${stage >= 3 ? 14 : stage === 2 ? 20 : 25}`} stroke={leafDark} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 28c-1-4-4.5-6-9-5.5 1 4 4.5 6 9 5.5z" fill={leaf} />
          {stage >= 2 && <path d="M24 23c1-4 4.5-6 9-5.5-1 4-4.5 6-9 5.5z" fill={leaf} />}
          {stage >= 3 && <path d="M24 18c-1-3.5-4-5.4-8-5-.2 3.6 3.6 5.6 8 5z" fill={leafDark} />}
          {stage === 4 && <ellipse cx="24" cy="12" rx="3.2" ry="4.2" fill="#E7A2B4" />}
          {stage === 5 && (
            <g>
              {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="24" cy="7.5" rx="3" ry="4.6" fill="#F0A6BC" transform={`rotate(${a} 24 12)`} />)}
              <circle cx="24" cy="12" r="2.6" fill="#F2C14E" />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}

// —— Controls —————————————————————————————————————————————————————————————

/** On/off switch (role="switch"), green when on. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      style={{ width: 42, height: 24, borderRadius: 99, border: 'none', padding: 3, cursor: disabled ? 'default' : 'pointer', transition: 'background .15s', display: 'flex', flexShrink: 0, opacity: disabled ? 0.5 : 1,
        background: on ? 'var(--ok-solid)' : 'var(--line-2)', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}

export function Field({ label, required, hint, error, children, wide }: { label: string; required?: boolean; hint?: ReactNode; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label style={{ ...labelStyle, gridColumn: wide ? '1 / -1' : undefined }}>
      <span>{label}{required && <span style={{ color: 'var(--bad)' }}> *</span>}</span>
      {children}
      {error ? <span style={{ fontSize: 11.5, color: 'var(--bad)' }}>{error}</span> : hint ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{hint}</span> : null}
    </label>
  );
}

/** A select in the dashboard's field style, with its chevron. */
export function Pick({ value, onChange, children, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <span className="pd-pick">
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel} style={{ ...inputStyle, cursor: disabled ? 'default' : 'pointer' }}>
        {children}
      </select>
    </span>
  );
}

// —— Dialog ——————————————————————————————————————————————————————————————

/**
 * A dialog in the middle of the window, drawn on the page body (a view's
 * fade-in transform would otherwise pin it to the view). Escape closes it.
 */
export function Modal({ title, sub, onClose, children, footer, width = 520, busy }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; busy?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return createPortal(
    <div className="pd-scrim" style={{ zIndex: 75 }}>
      <div className="bg" onClick={() => { if (!busy) onClose(); }} />
      <div role="dialog" aria-modal="true" className="pd-modal pd-form" style={{ width: `min(${width}px, 100%)` }}>
        <div className="pd-md-h">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="ds-icon-btn" style={iconBtn(36)}><IconClose size={16} stroke="currentColor" /></button>
        </div>
        <div className="pd-md-b">{children}</div>
        {footer && <div className="pd-md-f line">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A dialog that asks for an optional (or required) note, then does one thing. */
export function NoteDialog({ title, sub, label = 'Note', placeholder, required, confirm, tone = 'primary', onClose, onConfirm }: {
  title: string; sub?: ReactNode; label?: string; placeholder?: string; required?: boolean; confirm: string; tone?: 'primary' | 'danger';
  onClose: () => void; onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (required && !note.trim()) { setError('Add a note first'); return; }
    setBusy(true); setError('');
    try { await onConfirm(note.trim()); } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={title} sub={sub} onClose={onClose} busy={busy} width={480}
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`pd-btn ${tone}`} onClick={() => void go()} disabled={busy}>{busy ? 'Working…' : confirm}</button>
      </>}>
      <Field label={label} required={required} error={error}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} style={areaStyle} autoFocus />
      </Field>
    </Modal>
  );
}

// —— Files ———————————————————————————————————————————————————————————————

/** A stored file opened in a dialog: the PDF or picture itself, fetched with the session. */
export function FilePreview({ fileId, name, onClose }: { fileId: string; name: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let made = '';
    fetchLifecycleFile(fileId)
      .then((blob) => { if (!live) return; made = URL.createObjectURL(blob); setType(blob.type); setUrl(made); })
      .catch((e) => { if (live) setError(errText(e, 'Could not open the file')); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [fileId]);
  return (
    <Modal title={name} onClose={onClose} width={860}
      footer={url ? <a href={url} download={name} className="pd-btn">Download</a> : undefined}>
      {error ? <div style={{ color: 'var(--bad)' }}>{error}</div>
        : !url ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner label="Opening…" /></div>
          : type.startsWith('image/') ? <img src={url} alt={name} style={{ maxWidth: '100%', borderRadius: 12, display: 'block', margin: '0 auto' }} />
            : <iframe title={name} src={url} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }} />}
    </Modal>
  );
}

/** A local blob (a PDF just made) in the same dialog. */
export function BlobPreview({ blob, name, onClose }: { blob: Blob; name: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <Modal title={name} onClose={onClose} width={860} footer={url ? <a href={url} download={name} className="pd-btn">Download</a> : undefined}>
      {url && <iframe title={name} src={url} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }} />}
    </Modal>
  );
}

/** The panel and page state for a company with the lifecycle switched off. */
export function NotSwitchedOn() {
  return (
    <section className="pd-card" style={{ textAlign: 'center', padding: 44 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Employee lifecycle is not switched on</h2>
      <p className="pd-lead" style={{ margin: '8px auto 0' }}>Onboarding, offboarding and letters are not available for your company yet. Ask Sowaka to switch them on.</p>
    </section>
  );
}

/** A plain confirm, for actions that need no note. */
export function ConfirmDialog({ title, body, confirm, onClose, onConfirm }: { title: string; body: ReactNode; confirm: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={title} onClose={onClose} busy={busy} width={460}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(); } catch (e) { setError(errText(e)); setBusy(false); } }}>{busy ? 'Working…' : confirm}</button></>}>
      <div>{body}</div>
      {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}
