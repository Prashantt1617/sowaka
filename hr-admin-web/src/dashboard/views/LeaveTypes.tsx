// Leave types — monthly accrual + what happens to the balance at reset
// (lapse / carry-forward / encash). Shared by Policies › Leaves (org-wide) and
// each Shift Template's Leave Policy (copied in, overridable per shift).
// Prototype: local state only, no API.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TYPE } from '../theme';
import type { LeaveType } from '../theme';
import { Card } from '../ui';

const RESET_OPTIONS = ['End of calendar year', 'End of financial year', 'On work anniversary'];

export type LeaveRow = {
  key: LeaveType;
  name: string;
  perMonth: string;
  reset: string;
  lapse: string;
  carry: string;
  encash: string;
  cap: string;
};

export const DEFAULT_LEAVE_ROWS: LeaveRow[] = [
  { key: 'Sick', name: 'Sick Leave', perMonth: '1', reset: 'End of calendar year', lapse: '100', carry: '0', encash: '0', cap: '0' },
  { key: 'Casual', name: 'Casual Leave', perMonth: '1', reset: 'End of calendar year', lapse: '0', carry: '100', encash: '0', cap: '30' },
  { key: 'Earned', name: 'Earned Leave', perMonth: '1.5', reset: 'End of financial year', lapse: '0', carry: '50', encash: '50', cap: '45' },
];

export function LeaveTypes() {
  const [rows, setRows] = useState<LeaveRow[]>(DEFAULT_LEAVE_ROWS);
  const update = (i: number, patch: Partial<LeaveRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <>
      {rows.map((r, i) => (
        <LeaveTypeCard key={r.key} row={r} onChange={(patch) => update(i, patch)} />
      ))}
    </>
  );
}

function LeaveTypeCard({ row, onChange }: { row: LeaveRow; onChange: (patch: Partial<LeaveRow>) => void }) {
  const perMonth = parseFloat(row.perMonth) || 0;
  const annual = +(perMonth * 12).toFixed(1);
  const lapse = parseFloat(row.lapse) || 0;
  const carry = parseFloat(row.carry) || 0;
  const encash = parseFloat(row.encash) || 0;
  const total = lapse + carry + encash;
  const balanced = Math.round(total) === 100;
  const canCarry = carry > 0;
  const color = TYPE[row.key];

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: color, flexShrink: 0 }} />
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>{row.name}</div>
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#4A6FA5', background: '#EEF3FA', border: '1px solid #DEE8F4', borderRadius: 20, padding: '3px 11px' }}>
          {annual} days / year
        </span>
      </div>

      <div style={{ padding: '18px 20px' }}>
        <MiniLabel>Accrual</MiniLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848' }}>Leaves earned per month</div>
          <Suffixed value={row.perMonth} onChange={(v) => onChange({ perMonth: v })} suffix="/ month" width={150} step="0.5" />
          <span style={{ fontSize: 14, color: '#717171' }}>= <strong style={{ color: '#333' }}>{annual}</strong> / year</span>
        </div>

        <MiniLabel>At reset · carry-forward</MiniLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#484848' }}>Balance resets</div>
          <select value={row.reset} onChange={(e) => onChange({ reset: e.target.value })} style={{ ...input, width: 'auto', cursor: 'pointer' }}>
            {RESET_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 10 }}>At reset, split the unused balance — must total 100%.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <SplitInput label="Lapse" color="#C2607A" value={row.lapse} onChange={(v) => onChange({ lapse: v })} />
          <SplitInput label="Carry forward" color="#4A6FA5" value={row.carry} onChange={(v) => onChange({ carry: v })} />
          <SplitInput label="Encash" color="#5E9E7A" value={row.encash} onChange={(v) => onChange({ encash: v })} />
        </div>

        <div style={{ display: 'flex', height: 8, borderRadius: 6, overflow: 'hidden', marginTop: 12, background: '#F0F0F2' }}>
          {lapse > 0 && <div style={{ width: `${lapse}%`, background: '#C2607A' }} />}
          {carry > 0 && <div style={{ width: `${carry}%`, background: '#4A6FA5' }} />}
          {encash > 0 && <div style={{ width: `${encash}%`, background: '#5E9E7A' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: balanced ? '#4F7A52' : '#A8475F' }}>
            {balanced ? '✓ Totals 100%' : `Totals ${total}% — must equal 100%`}
          </span>
        </div>

        <div style={{ marginTop: 14, opacity: canCarry ? 1 : 0.5, pointerEvents: canCarry ? 'auto' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#484848' }}>Max days that can be carried forward</div>
            <Suffixed value={row.cap} onChange={(v) => onChange({ cap: v })} suffix="days" width={140} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function SplitInput({ label, color, value, onChange }: { label: string; color: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#484848' }}>{label}</label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
        <input type="number" min="0" max="100" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
        <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>%</span>
      </div>
    </div>
  );
}

function MiniLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#B0B4BC', margin: '4px 0 10px' }}>{children}</div>;
}
function Suffixed({ value, onChange, suffix, width, step }: { value: string; onChange: (v: string) => void; suffix: string; width?: number; step?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
