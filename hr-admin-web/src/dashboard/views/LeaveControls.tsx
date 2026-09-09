// Policies › Leaves — the full leave policy:
//   1. Leave types — monthly accrual + what happens at reset (lapse / carry / encash).
//   2. Application window — how far ahead / backdated a request can be.
//   3. Approval & overrides — who signs off and who can step in.
// The application window and approval flow are live: saved to the org's shift
// policy. Leave types below are still local.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { LeaveTypes } from './LeaveTypes';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';

const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];

export function LeaveControls() {
  const { flash } = useStore();
  // Application window
  const [advanceDays, setAdvanceDays] = useState('30');
  const [allowBackdated, setAllowBackdated] = useState(true);
  const [backdatedDays, setBackdatedDays] = useState('3');
  // Approval flow
  const [approver, setApprover] = useState('Reporting manager');
  const [mgrOnBehalf, setMgrOnBehalf] = useState(false);
  const [hrOverride, setHrOverride] = useState(true);
  const [skipLevelOverride, setSkipLevelOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then(({ leave }) => {
        setAdvanceDays(String(leave.advanceDays));
        setAllowBackdated(leave.allowBackdated);
        setBackdatedDays(String(leave.backdatedDays));
        setApprover(leave.approver);
        setMgrOnBehalf(leave.managerOnBehalf);
        setHrOverride(leave.hrOverride);
        setSkipLevelOverride(leave.skipLevel);
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        leave: {
          advanceDays: Number(advanceDays),
          allowBackdated,
          backdatedDays: Number(backdatedDays),
          approver,
          managerOnBehalf: mgrOnBehalf,
          hrOverride,
          skipLevel: skipLevelOverride,
        },
      });
      flash('Leave policy saved');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Leave policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>

      {/* 1 — Leave types */}
      <SubLabel>Leave types</SubLabel>
      <div style={{ fontSize: 13, color: '#9197A2', marginTop: -4, marginBottom: 12 }}>
        How many leaves of each type accrue every month, and what happens to the balance at reset.
      </div>
      <LeaveTypes />

      {/* 2 — Application window */}
      <SubLabel>Application window</SubLabel>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="When can leave be applied?" subtitle="The window, relative to the leave date, in which an employee can submit a request." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="How far in advance can leave be applied?">
            <Suffixed value={advanceDays} onChange={setAdvanceDays} suffix="days ahead" width={220} />
          </Field>
          <QRow label="Allow backdated leave applications?"><YesNo value={allowBackdated} onChange={setAllowBackdated} /></QRow>
          <div style={{ opacity: allowBackdated ? 1 : 0.5, pointerEvents: allowBackdated ? 'auto' : 'none', marginTop: 14 }}>
            <Field label="How far backdated can leave be applied?">
              <Suffixed value={backdatedDays} onChange={setBackdatedDays} suffix="days back" width={220} />
            </Field>
          </div>
        </div>
      </Card>

      {/* 3 — Approval & overrides */}
      <SubLabel>Approval flow</SubLabel>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Approval & overrides" subtitle="Who signs off, and who can step in." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Who approves a leave request?">
            <select value={approver} onChange={(e) => setApprover(e.target.value)} style={{ ...input, maxWidth: 340 }}>
              {APPROVERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <QRow label="Can a manager apply leave on behalf of the employee?"><YesNo value={mgrOnBehalf} onChange={setMgrOnBehalf} /></QRow>
          <QRow label="Can HR override the decision?"><YesNo value={hrOverride} onChange={setHrOverride} /></QRow>
          <QRow label="Can the level above the manager override?"><YesNo value={skipLevelOverride} onChange={setSkipLevelOverride} /></QRow>
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
function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '18px 0 10px' }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>{label}</label>
      {children}
    </div>
  );
}
function QRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid #F4F4F6' }}>
      <div style={{ flex: 1, fontSize: 15, color: '#333333', fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opts: { v: boolean; l: string }[] = [{ v: true, l: 'Yes' }, { v: false, l: 'No' }];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button key={o.l} onClick={() => onChange(o.v)} style={{ padding: '7px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', borderLeft: o.v ? 'none' : '1px solid #EBEBEB', background: value === o.v ? '#0571A6' : '#fff', color: value === o.v ? '#fff' : '#484848' }}>{o.l}</button>
      ))}
    </div>
  );
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
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
