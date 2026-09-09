// Policies › Half day — the org-wide worked-hour thresholds every shift is
// graded against. This is live: what is saved here is what the app shows on an
// employee's attendance calendar.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';

export function HalfDayPolicy() {
  const { flash } = useStore();
  const [minHalfDay, setMinHalfDay] = useState('4');
  const [minFullDay, setMinFullDay] = useState('8');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then((policy) => {
        setMinHalfDay(String(policy.minHalfDayHours));
        setMinFullDay(String(policy.minFullDayHours));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        minHalfDayHours: Number(minHalfDay),
        minFullDayHours: Number(minFullDay),
      });
      flash(`Saved — the app now counts ${minFullDay}h as a full day and ${minHalfDay}h as a half day`);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Half day policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>

      <div style={banner}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          Worked hours needed to earn a <strong>half day</strong> and a <strong>full day</strong>.
          Every shift is graded against these, and the app marks each attendance day from them.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Day thresholds" />
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Min hours for half day"><Suffixed value={minHalfDay} onChange={setMinHalfDay} suffix="hrs" /></Field>
            <Field label="Min hours for full day"><Suffixed value={minFullDay} onChange={setMinFullDay} suffix="hrs" /></Field>
          </div>
          <div style={note}>
            A day of {minFullDay || '—'}h or more counts as a full day; {minHalfDay || '—'}h up to{' '}
            {minFullDay || '—'}h is a half day; anything shorter is flagged for correction.
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
function Suffixed({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
      <input type="number" min="0" step="0.5" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>{suffix}</span>
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const banner: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 16 };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
