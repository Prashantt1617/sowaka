// Policies › Overtime — the GLOBAL overtime defaults every Shift Template
// inherits: whether a shift is OT-eligible and what counts as overtime.
// Prototype: local state only.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';

export function OvertimePolicy() {
  const { flash } = useStore();
  const [eligible, setEligible] = useState(true);
  const [onHoliday, setOnHoliday] = useState(true);
  const [onWeeklyOff, setOnWeeklyOff] = useState(true);
  const [beyondShift, setBeyondShift] = useState(false);
  const [beyondHours, setBeyondHours] = useState('1');

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Overtime policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => flash('Overtime policy saved (prototype)')} style={primaryBtn}>Save policy</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          The org-wide overtime rule every <strong>Shift Template</strong> inherits. A template can override it for that shift only.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Eligibility" />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Are employees eligible for overtime?">
            <YesNo value={eligible} onChange={setEligible} />
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Counts as overtime when…" subtitle="What qualifies an employee’s time as overtime." />
        <div style={{ padding: '18px 22px', opacity: eligible ? 1 : 0.5, pointerEvents: eligible ? 'auto' : 'none' }}>
          {!eligible && <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 10 }}>Employees aren’t eligible for overtime.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={checkRow}><input type="checkbox" checked={onHoliday} onChange={(e) => setOnHoliday(e.target.checked)} /> They come in on a holiday</label>
            <label style={checkRow}><input type="checkbox" checked={onWeeklyOff} onChange={(e) => setOnWeeklyOff(e.target.checked)} /> They come in on a weekly-off</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={checkRow}><input type="checkbox" checked={beyondShift} onChange={(e) => setBeyondShift(e.target.checked)} /> They work beyond shift hours by</label>
              <div style={{ opacity: beyondShift ? 1 : 0.5, pointerEvents: beyondShift ? 'auto' : 'none' }}>
                <Suffixed value={beyondHours} onChange={setBeyondHours} suffix="hrs" width={120} />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: '16px 22px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' }}>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>{label}</label>
      {children}
    </div>
  );
}
function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opts: { v: boolean; l: string }[] = [{ v: true, l: 'Yes' }, { v: false, l: 'No' }];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button key={o.l} onClick={() => onChange(o.v)} style={{ padding: '8px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer', border: 'none', borderLeft: o.v ? 'none' : '1px solid #EBEBEB', background: value === o.v ? '#0571A6' : '#fff', color: value === o.v ? '#fff' : '#484848' }}>{o.l}</button>
      ))}
    </div>
  );
}
function Suffixed({ value, onChange, suffix, width }: { value: string; onChange: (v: string) => void; suffix: string; width?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
