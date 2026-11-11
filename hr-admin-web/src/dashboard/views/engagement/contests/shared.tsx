// The bar row both Engagement pages draw for taking part by group.
import type { ReactNode } from 'react';
import * as L from '../../look';

/** A labelled horizontal bar: "Sales  ▇▇▇▇▁▁  6 of 12". */
export function BarRow({ label, value, total, right }: { label: ReactNode; value: number; total: number; right?: ReactNode }) {
  const w = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={L.barTrack}>
        <div style={{ width: `${w}%`, height: '100%', background: 'var(--accent)', borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{right ?? `${value} of ${total}`}</span>
    </div>
  );
}
