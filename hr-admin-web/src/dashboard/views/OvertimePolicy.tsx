// Policies › Overtime — whether the org offers overtime at all, and what an
// approved one is worth. Live: saved to the org's shift policy.
//
// There is nothing here about what *qualifies* as overtime. Overtime is applied
// for, as a half day or a full day, and approved by a manager — a rule engine
// deciding it after the fact would only disagree with the approval.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import {
  getCompanySettings, getShiftPolicy, saveShiftPolicy, updateCompanySettings,
} from '../../services/hrms';

export function OvertimePolicy() {
  const { flash, setView } = useStore();
  const [eligible, setEligible] = useState(true);
  const [backdateDays, setBackdateDays] = useState('7');
  // Per-team switch, from company settings — the second of the three gates.
  const [departments, setDepartments] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then(({ overtime }) => {
        setEligible(overtime.eligible);
        setBackdateDays(String(overtime.backdateDays));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    getCompanySettings()
      .then((s) => { setDepartments(s.departments); setDisabled(s.overtimeDisabledDepartments); })
      .catch((error: Error) => flash(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        saveShiftPolicy({ overtime: { eligible, backdateDays: Number(backdateDays) } }),
        updateCompanySettings({ overtimeDisabledDepartments: disabled }),
      ]);
      flash(eligible ? 'Overtime is on for the org' : 'Overtime is off for the org');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Overtime policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Eligibility" subtitle="Whether the org offers overtime at all." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Are employees eligible for overtime?">
            <YesNo value={eligible} onChange={setEligible} />
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="How overtime is applied" subtitle="The only two durations an employee can claim." />
        <div style={{ padding: '18px 22px' }}>
          <Readout rows={[
            ['Full day', ''],
            ['Half day', ''],
          ]} />
          <div style={fixedRow}>
            <span style={fixedTag}>not configurable</span>
            <span>
              An employee applies for overtime as a full day or a half day, and a manager approves
              it. There are no other durations.
            </span>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Overtime by team" subtitle="Turn overtime off for particular teams — those employees won’t see the option in the app." />
        <div style={{ padding: '18px 22px', opacity: eligible ? 1 : 0.5, pointerEvents: eligible ? 'auto' : 'none' }}>
          {!eligible && <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 10 }}>Overtime is off for the whole org.</div>}
          {departments.length === 0 ? (
            <div style={{ fontSize: 15, color: '#717171' }}>No teams found in your organisation yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {departments.map((dep) => {
                const on = !disabled.includes(dep);
                return (
                  <div key={dep} style={teamRow}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#333333' }}>{dep}</div>
                    <button
                      onClick={() => setDisabled((prev) => (on ? [...prev, dep] : prev.filter((d) => d !== dep)))}
                      style={{
                        marginLeft: 'auto', padding: '6px 16px', fontSize: 14, fontWeight: 700,
                        cursor: 'pointer', borderRadius: 20,
                        border: `1px solid ${on ? '#D6E8D6' : '#EBEBEB'}`,
                        background: on ? '#EAF3EA' : '#F7F7F9',
                        color: on ? '#4F7A52' : '#9197A2',
                      }}
                    >
                      {on ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Backdating" subtitle="How far back an overtime claim can reach." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="How far back can overtime be claimed?">
            <Suffixed value={backdateDays} onChange={setBackdateDays} suffix="days" />
          </Field>
          <div style={note}>
            Overtime is worked before it is claimed, so a window that is too short leaves people
            unable to file for a day they actually worked.
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="What it earns — comp-off" subtitle="Approved overtime is paid back as compensatory leave." />
        <div style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 15, color: '#333333', lineHeight: 1.6 }}>
            <strong>Comp-off</strong> is a leave type of its own. It is not accrued monthly like sick
            or casual leave — the balance only moves when overtime is approved:
          </div>
          <div style={{ marginTop: 14 }}>
            <Readout rows={[
              ['A full day of approved overtime', '+1 comp-off day'],
              ['A half day of approved overtime', '+0.5 comp-off day'],
            ]} />
          </div>
          <div style={note}>
            The employee then applies for comp-off the way they apply for any other leave, and it is
            drawn from this balance. Accrual and expiry for the other leave types are set under{' '}
            <button onClick={() => setView('policies')} style={linkBtn}>Leaves</button>.
          </div>
        </div>
      </Card>
    </div>
  );
}

function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ border: '1px solid #EDEDF0', borderRadius: 10, overflow: 'hidden' }}>
      {rows.map(([label, value], index) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', borderTop: index === 0 ? 'none' : '1px solid #F4F4F6' }}>
          <div style={{ flex: 1, fontSize: 15, color: '#484848' }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        </div>
      ))}
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
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', maxWidth: 260 }}>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>{suffix}</span>
    </div>
  );
}
function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opts: { v: boolean; l: string }[] = [{ v: true, l: 'Yes' }, { v: false, l: 'No' }];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button
          key={o.l}
          onClick={() => onChange(o.v)}
          style={{
            padding: '8px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer', border: 'none',
            borderLeft: o.v ? 'none' : '1px solid #EBEBEB',
            background: value === o.v ? '#0571A6' : '#fff',
            color: value === o.v ? '#fff' : '#484848',
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.6 };
const fixedRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, fontSize: 13, color: '#717171', lineHeight: 1.55 };
const fixedTag: CSSProperties = { flexShrink: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#717171', background: '#EDEDF0', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#0571A6', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' };
const teamRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: '1px solid #F0F0F2', borderRadius: 12, background: '#FBFBFC' };
