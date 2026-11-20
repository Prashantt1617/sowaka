import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, eyebrow, iconBtn, sentence, textareaStyle } from '../ds';
import { IconClose, IconInfo, IconOverride } from '../icons';

export function DrawerShell({
  width = 440,
  onClose,
  children,
  label,
  resetKey,
  onEscape,
  floating,
}: {
  width?: number;
  /** Floats 16 px in from the screen's edges with every corner rounded (the onboarding panel's design), instead of sitting flush right. */
  floating?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Names the drawer for screen readers and makes it a dialog that takes focus when it opens. */
  label?: string;
  /** When this changes (another person opened in the same drawer), the drawer scrolls back to the top. */
  resetKey?: string;
  /** Escape calls this; leave it out while a dialog of its own is open above the drawer. */
  onEscape?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [resetKey]);
  useEffect(() => { if (label) panel.current?.focus({ preventScroll: true }); }, [label]);
  useEffect(() => {
    if (!onEscape) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onEscape(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);
  // Drawn on the page body, not where it is used: a page that opens one from inside its own
  // (animated, transformed) view would otherwise pin it to that view, so on a scrolled list it
  // opened far up the page, off screen.
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end', ...(floating ? { padding: 16 } : {}) }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div ref={panel} className="scry" {...(label ? { role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1 } : {})}
        style={{ position: 'relative', width, maxWidth: '100%', height: '100%', background: 'var(--surface)', borderRadius: floating ? 24 : '24px 0 0 24px', boxShadow: 'var(--shadow-drawer)', overflowY: 'auto', display: 'flex', flexDirection: 'column', animation: 'drwIn .25s ease both', outline: 'none' }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} aria-label="Close" className="ds-icon-btn" style={iconBtn(42)}>
      <IconClose size={18} stroke="currentColor" />
    </button>
  );
}

export function DrawerHeader({
  name,
  userId,
  subtitle,
  onClose,
}: {
  name: string;
  /** Whose photo to show; the name is looked up when this is missing. */
  userId?: string;
  subtitle: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <PersonAvatar name={name} userId={userId} size={42} font={15} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, color: 'var(--ink)' }}>{name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

export function InfoGrid({ cells }: { cells: { label: string; value: ReactNode; wide?: boolean }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
      {cells.map((c) => (
        <div key={c.label} style={{ background: 'var(--surface)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, gridColumn: c.wide ? '1 / -1' : undefined }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.5 }}>{sentence(c.label)}</div>
          <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export function HrOverrideFooter({
  manager,
  declineOpen,
  declineText,
  onDeclineInput,
  onOpenDecline,
  onCancelDecline,
  onConfirmDecline,
  onApprove,
}: {
  manager: string;
  declineOpen: boolean;
  declineText: string;
  onDeclineInput: (v: string) => void;
  onOpenDecline: () => void;
  onCancelDecline: () => void;
  onConfirmDecline: () => void;
  onApprove: () => void;
}) {
  return (
    <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '16px 20px' }}>
      {declineOpen ? (
        <div style={{ animation: 'fade .16s ease both' }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>HR OVERRIDE · DECLINE</div>
          <textarea
            value={declineText}
            onChange={(e) => onDeclineInput(e.target.value)}
            placeholder="Reason for overriding — visible to employee & manager"
            className="ds-inp"
            style={{ ...textareaStyle, minHeight: 84, resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button onClick={onCancelDecline} className={btnClass()} style={btn()}>Cancel</button>
            <button onClick={onConfirmDecline} className={btnClass('danger')} style={btn('danger')}>Confirm decline</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', marginBottom: 12 }}>
            <IconInfo />
            <span style={{ fontSize: 12.5, fontWeight: 400 }}>Awaiting approval from {manager}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 12px' }}>
            <IconOverride />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>HR override</span>
            <button onClick={onOpenDecline} className={btnClass('no')} style={btn('no', 'sm')}>Decline</button>
            <button onClick={onApprove} className={btnClass('primary')} style={btn('primary', 'sm')}>Approve</button>
          </div>
        </>
      )}
    </div>
  );
}

export function RemarkBlock({
  label,
  text,
  filled,
  marginBottom,
}: {
  label: string;
  text: string;
  filled: boolean;
  marginBottom?: number;
}) {
  return (
    <div style={{ marginBottom }}>
      <div style={{ ...eyebrow, marginBottom: 8 }}>{label}</div>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: '12px 14px', fontSize: 13.5, color: filled ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.55, fontWeight: 400, fontStyle: filled ? 'normal' : 'italic' }}>
        {text}
      </div>
    </div>
  );
}
