// Policies › Half day — the GLOBAL day-length thresholds every Shift Template
// inherits: how many worked hours make a half day vs a full day.
// Prototype: local state only.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';

export function HalfDayPolicy() {
  const { flash } = useStore();
  const [minHalfDay, setMinHalfDay] = useState('4');
  const [minFullDay, setMinFullDay] = useState('8');

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Half day policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => flash('Half day policy saved (prototype)')} style={primaryBtn}>Save policy</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          Worked-hour thresholds that decide whether a day is a <strong>half day</strong> or a <strong>full day</strong> (below the half-day mark counts as absent). A template can override this for that shift only.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Day thresholds" />
        <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Min hours for half day"><Suffixed value={minHalfDay} onChange={setMinHalfDay} suffix="hrs" /></Field>
          <Field label="Min hours for full day"><Suffixed value={minFullDay} onChange={setMinFullDay} suffix="hrs" /></Field>
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
function Suffixed({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>{suffix}</span>
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
