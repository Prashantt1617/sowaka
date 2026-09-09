// Policies › Late — the org-wide grace before an arrival counts as late or a
// departure counts as an early-out. Live: the app marks the day from this.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';

export function LatePolicy() {
  const { flash } = useStore();
  const [lateAfter, setLateAfter] = useState('10');
  const [earlyOut, setEarlyOut] = useState('10');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then((policy) => {
        setLateAfter(String(policy.lateGraceMinutes));
        setEarlyOut(String(policy.earlyOutGraceMinutes));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        lateGraceMinutes: Number(lateAfter),
        earlyOutGraceMinutes: Number(earlyOut),
      });
      flash(`Saved — the app now allows ${lateAfter} min before marking an arrival late`);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Late policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>

      <div style={banner}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          Grace before an arrival counts as <strong>late</strong> or a departure counts as an{' '}
          <strong>early-out</strong>. Measured against the start &amp; end times of the shift the
          employee is on, which each Shift Template sets.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Late & early grace" />
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Mark as late if late by"><Suffixed value={lateAfter} onChange={setLateAfter} suffix="min" /></Field>
            <Field label="Mark early-out if leaves early by"><Suffixed value={earlyOut} onChange={setEarlyOut} suffix="min" /></Field>
          </div>
          <div style={note}>
            On a 09:00–18:00 shift, arriving after {clock('09:00', Number(lateAfter) || 0)} is late,
            and leaving before {clock('18:00', -(Number(earlyOut) || 0))} is an early-out.
          </div>
        </div>
      </Card>
    </div>
  );
}

/** "09:00" plus a signed number of minutes, for the worked example above. */
function clock(base: string, delta: number): string {
  const at = Number(base.slice(0, 2)) * 60 + Number(base.slice(3, 5));
  const shifted = (at + delta + 24 * 60) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
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
const banner: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 16 };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
