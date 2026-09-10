// Shared chrome for the KPI screens, matching Payroll › Salary Components:
// a full-bleed centred modal with a panelled body, and tables built from Th/Td
// rather than CSS grid.
//
// Kept in its own module because a file that exports both components and plain
// values breaks React Fast Refresh, so editing a KPI screen would otherwise
// leave the page stale until a full reload.
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { CloseButton } from '../drawers/shell';
import { modalCard, modalFoot, modalHead } from './kpiStyles';

// —— Modal shell ————————————————————————————————————————————————————————

/**
 * Rendered through a portal on `document.body`.
 *
 * Several views wrap their content in `animation: fade … both`, and those
 * keyframes animate `transform`. A filled transform makes the element a
 * containing block, so a `position: fixed` child would anchor to the view
 * rather than the viewport — the modal would then scroll with the page and its
 * header could sit above the fold. The portal sidesteps that entirely.
 */
export function Modal({
  title, subtitle, onClose, children, footer, width = 980,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: number;
}) {
  return createPortal(
    // Inset from the left so the sidebar stays visible, as the payroll modals do.
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 244, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 14px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.4)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ ...modalCard, maxWidth: width }}>
        <div style={modalHead}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="scry" style={{ padding: '20px 26px', overflowY: 'auto', flex: 1 }}>{children}</div>
        <div style={modalFoot}>{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A full-page detail or form, replacing what used to be a dialog.
 *
 * The KPI screens all carry editable fields, usage breakdowns and destructive
 * actions — more than a modal should hold, and the list underneath is not
 * context anyone needs while reading one. Navigation is local state in each
 * screen: back returns to the list.
 */
export function DetailPage({
  title, subtitle, backLabel, onBack, actions, children, width = 900,
}: {
  title: string;
  subtitle?: ReactNode;
  backLabel: string;
  onBack: () => void;
  /** Rendered in a row under the content; the primary action goes last. */
  actions?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div style={{ maxWidth: width, animation: 'fade .2s ease both' }}>
      <button onClick={onBack} style={backBtn}>← {backLabel}</button>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.6px' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 15.5, color: '#717171', marginTop: 3 }}>{subtitle}</div>
        )}
      </div>
      {children}
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 18 }}>{actions}</div>
      )}
    </div>
  );
}

const backBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
  color: '#0571A6', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '2px 0',
  marginBottom: 14,
};

// —— Table ——————————————————————————————————————————————————————————————

export function Th({ children, right, width }: { children: ReactNode; right?: boolean; width?: number | string }) {
  return (
    <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 14px', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

export function Td({ children, muted, right, top }: { children: ReactNode; muted?: boolean; right?: boolean; top?: boolean }) {
  return (
    <td style={{ padding: '13px 14px', borderBottom: '1px solid #F0F0F2', color: muted ? '#484848' : '#222222', textAlign: right ? 'right' : 'left', verticalAlign: top ? 'top' : 'middle' }}>
      {children}
    </td>
  );
}

/** The clickable identifier in the first column of every catalogue table. */
export function NameCell({ name, tag, tagTone }: { name: string; tag?: string; tagTone?: 'green' | 'amber' | 'grey' }) {
  const tones = {
    green: { bg: '#E4EDE0', fg: '#0F6E56' },
    amber: { bg: '#F6E9D5', fg: '#9A6B25' },
    grey: { bg: '#F0F0F2', fg: '#717171' },
  };
  const tone = tones[tagTone ?? 'grey'];
  return (
    <span>
      <span style={{ fontWeight: 700, color: '#0571A6' }}>{name}</span>
      {tag && (
        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: tone.bg, color: tone.fg }}>
          {tag}
        </span>
      )}
    </span>
  );
}

/** Section switcher with counts, as on Salary Components. */
export function Tabs<T extends string>({
  tabs, value, onChange,
}: {
  tabs: { key: T; label: string; count: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: 4 }}>
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{ border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 700, padding: '7px 15px', borderRadius: 8, background: on ? '#0571A6' : 'transparent', color: on ? '#fff' : '#717171' }}
          >
            {t.label} <span style={{ opacity: 0.7 }}>· {t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// —— Form controls ——————————————————————————————————————————————————————

export function Field({ label, req, hint, children, style }: {
  label: string; req?: boolean; hint?: string; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>
        {label}{req && <span style={{ color: '#C4382E', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#717171', marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, sub, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: string; disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: disabled ? 0.55 : 1 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ flexShrink: 0, width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: disabled ? 'default' : 'pointer', border: `1.5px solid ${checked ? '#0571A6' : '#C7CBD2'}`, background: checked ? '#0571A6' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1, padding: 0 }}
      >
        {checked ? '✓' : ''}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, color: '#222222' }}>{label}</div>
        {sub && <div style={{ fontSize: 13, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  );
}
