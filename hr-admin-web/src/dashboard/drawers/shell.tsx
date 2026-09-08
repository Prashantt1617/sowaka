import type { ReactNode } from 'react';
import { Avatar } from '../ui';
import { IconClose, IconInfo, IconOverride } from '../icons';

export function DrawerShell({
  width = 430,
  onClose,
  children,
}: {
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.32)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ position: 'relative', width, height: '100%', background: '#F7F7F9', boxShadow: '-20px 0 50px rgba(60,40,24,.16)', overflowY: 'auto', animation: 'drwIn .26s cubic-bezier(.2,.8,.2,1) both' }}>
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid #EBEBEB', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <IconClose />
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
    <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <Avatar name={name} size={48} font={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{name}</div>
        <div style={{ fontSize: 14, color: '#717171', fontWeight: 600, marginTop: 2 }}>{subtitle}</div>
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

export function InfoGrid({ cells }: { cells: { label: string; value: ReactNode }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#EBEBEB', border: '1px solid #EBEBEB', borderRadius: 13, overflow: 'hidden', marginBottom: 20 }}>
      {cells.map((c) => (
        <div key={c.label} style={{ background: '#fff', padding: '13px 15px' }}>
          <div style={{ fontSize: 12, color: '#717171', fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{c.value}</div>
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
    <div style={{ position: 'sticky', bottom: 0, background: '#F7F7F9', borderTop: '1px solid #EBEBEB', padding: '14px 24px 16px' }}>
      {declineOpen ? (
        <div style={{ animation: 'fade .16s ease both' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0571A6', letterSpacing: '.3px', marginBottom: 8 }}>HR OVERRIDE · DECLINE</div>
          <textarea
            value={declineText}
            onChange={(e) => onDeclineInput(e.target.value)}
            placeholder="Reason for overriding — visible to employee & manager"
            style={{ width: '100%', height: 60, resize: 'none', border: '1px solid #EBEBEB', borderRadius: 10, padding: '9px 11px', fontSize: 14, outline: 'none', color: '#222222' }}
          />
          <div style={{ display: 'flex', gap: 9, marginTop: 10 }}>
            <button onClick={onCancelDecline} style={{ flex: 1, border: '1px solid #EBEBEB', background: '#fff', color: '#484848', borderRadius: 11, padding: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
            <button onClick={onConfirmDecline} style={{ flex: 1.3, border: 'none', background: '#A8475F', color: '#fff', borderRadius: 11, padding: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Confirm decline</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#717171', marginBottom: 12 }}>
            <IconInfo />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Awaiting approval from {manager}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 12, padding: '10px 12px' }}>
            <IconOverride />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0571A6', flex: 1 }}>HR override</span>
            <button onClick={onOpenDecline} style={{ border: '1px solid #EBD9DE', background: '#fff', color: '#A8475F', borderRadius: 9, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Decline</button>
            <button onClick={onApprove} style={{ border: 'none', background: '#4F7A52', color: '#fff', borderRadius: 9, padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Approve</button>
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
      <div style={{ fontSize: 14, color: '#717171', fontWeight: 700, letterSpacing: '.3px', marginBottom: 7 }}>{label}</div>
      <div style={{ background: filled ? '#fff' : '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 12, padding: '13px 15px', fontSize: 16, color: '#484848', lineHeight: 1.5, fontWeight: 500, fontStyle: filled ? 'normal' : 'italic' }}>
        {text}
      </div>
    </div>
  );
}
