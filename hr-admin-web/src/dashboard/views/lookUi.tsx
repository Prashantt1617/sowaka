// Table cells and the name cell in the HR Admin design, for the Performance,
// Reports, Payroll and Connect screens. Use inside <table className="lk-t">
// (look.css rounds the header strip and drops the last row's rule).
import type { ReactNode } from 'react';
import * as L from './look';
import './look.css';

export function Th({ children, right, width }: { children?: ReactNode; right?: boolean; width?: number | string }) {
  return <th style={{ ...L.th, textAlign: right ? 'right' : 'left', width }}>{children}</th>;
}

export function Td({ children, muted, right, top }: { children?: ReactNode; muted?: boolean; right?: boolean; top?: boolean }) {
  return (
    <td style={{ ...L.td, color: muted ? 'var(--ink-2)' : 'var(--ink)', textAlign: right ? 'right' : 'left', verticalAlign: top ? 'top' : 'middle' }}>
      {children}
    </td>
  );
}

/** The identifier in the first column: 14/500 ink, with an optional status tag. */
export function NameCell({ name, tag, tagTone }: { name: string; tag?: string; tagTone?: 'green' | 'amber' | 'grey' }) {
  const tone: L.Tone = tagTone === 'green' ? 'ok' : tagTone === 'amber' ? 'warn' : 'mute';
  return (
    <span>
      <span style={L.cellName}>{name}</span>
      {tag && <span style={{ ...L.pill(tone), marginLeft: 8, verticalAlign: 1 }}>{tag}</span>}
    </span>
  );
}

/** A table inside a padded card's body, as on the design's list screens. */
export function LookTable({ children }: { children: ReactNode }) {
  return <table className="lk-t" style={L.table}>{children}</table>;
}
