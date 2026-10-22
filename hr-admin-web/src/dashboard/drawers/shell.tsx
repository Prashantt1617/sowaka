import type { ReactNode } from 'react';
import { Avatar } from '../ui';
import { btn, btnClass, eyebrow, iconBtn, sentence, textareaStyle } from '../ds';
import { IconClose, IconInfo, IconOverride } from '../icons';

export function DrawerShell({
  width = 440,
  onClose,
  children,
}: {
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ position: 'relative', width, maxWidth: '100%', height: '100%', background: 'var(--surface)', borderRadius: '24px 0 0 24px', boxShadow: 'var(--shadow-drawer)', overflowY: 'auto', display: 'flex', flexDirection: 'column', animation: 'drwIn .25s ease both' }}>
        {children}
      </div>
    </div>
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
  subtitle,
  onClose,
}: {
  name: string;
  subtitle: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <Avatar name={name} size={42} font={15} />
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
