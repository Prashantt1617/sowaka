// Controls › Attendance Correction — org policy for how attendance corrections
// work: when they can be raised (tied to the shift's Attendance Rules), the
// reasons, who approves, override rights, and backdating limits.
// Live: saved to the org's shift policy.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';

// Trigger statuses come from the shift Attendance Rules.
const TRIGGERS = ['Missing punch', 'Half day', 'Absent', 'Marked late', 'Early check-out'];
const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
// Reasons are a controlled set (not free text) — each drives its own downstream action.
const REASON_CATALOG = ['WFH', 'On duty', 'Site visit', 'Forgot to punch', 'Apply leave'];

export function AttendanceCorrection() {
  const { flash } = useStore();
  const [triggers, setTriggers] = useState<Record<string, boolean>>({ 'Missing punch': true, 'Half day': true });
  const [approver, setApprover] = useState('Reporting manager');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([...REASON_CATALOG]);
  const [mgrWithoutEmployee, setMgrWithoutEmployee] = useState(true);
  const [hrOverride, setHrOverride] = useState(true);
  const [skipLevelOverride, setSkipLevelOverride] = useState(false);
  const [backEmployee, setBackEmployee] = useState(true);
  const [backManager, setBackManager] = useState(true);
  const [backDays, setBackDays] = useState('7');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then(({ correction }) => {
        setTriggers(Object.fromEntries(TRIGGERS.map((t) => [t, correction.triggers.includes(t)])));
        setApprover(correction.approver);
        setSelectedReasons(correction.reasons);
        setMgrWithoutEmployee(correction.managerWithoutEmployee);
        setHrOverride(correction.hrOverride);
        setSkipLevelOverride(correction.skipLevel);
        setBackEmployee(correction.backdateByEmployee);
        setBackManager(correction.backdateByManager);
        setBackDays(String(correction.backdateDays));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        correction: {
          triggers: TRIGGERS.filter((t) => triggers[t]),
          approver,
          reasons: selectedReasons,
          managerWithoutEmployee: mgrWithoutEmployee,
          hrOverride,
          skipLevel: skipLevelOverride,
          backdateByEmployee: backEmployee,
          backdateByManager: backManager,
          backdateDays: Number(backDays),
        },
      });
      flash('Attendance correction policy saved');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleTrigger = (t: string) => setTriggers((p) => ({ ...p, [t]: !p[t] }));
  const toggleReason = (r: string) => setSelectedReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const canBackdate = backEmployee || backManager;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Attendance correction policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save controls'}
          </button>
        </div>
      </div>

      {/* When & why */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="When can a correction be raised?" subtitle="An employee gets the option when their day is auto-marked (from the shift’s Attendance Rules) as:" />
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TRIGGERS.map((t) => (
              <button key={t} onClick={() => toggleTrigger(t)} style={chip(!!triggers[t])}>{t}</button>
            ))}
          </div>

          <SubLabel>Reasons an employee can pick</SubLabel>
          <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 8 }}>Select from the standard set — each reason drives its own action (e.g. “Apply leave” starts a leave request).</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {REASON_CATALOG.map((r) => (
              <button key={r} onClick={() => toggleReason(r)} style={chip(selectedReasons.includes(r))}>{r}</button>
            ))}
          </div>
        </div>
      </Card>

      {/* Approvals & overrides */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Approval & overrides" subtitle="Who signs off, and who can step in." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Who approves a correction?">
            <select value={approver} onChange={(e) => setApprover(e.target.value)} style={{ ...input, maxWidth: 340 }}>
              {APPROVERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <QRow label="Can a manager correct attendance without the employee applying?"><YesNo value={mgrWithoutEmployee} onChange={setMgrWithoutEmployee} /></QRow>
          <QRow label="Can HR override the decision?"><YesNo value={hrOverride} onChange={setHrOverride} /></QRow>
          <QRow label="Can the level above the manager override?"><YesNo value={skipLevelOverride} onChange={setSkipLevelOverride} /></QRow>
        </div>
      </Card>

      {/* Backdating */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Backdating" subtitle="Whether past-dated corrections are allowed, and how far back." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Backdated corrections allowed for">
            <div style={{ display: 'flex', gap: 18 }}>
              <label style={checkRow}><input type="checkbox" checked={backEmployee} onChange={(e) => setBackEmployee(e.target.checked)} /> Employee</label>
              <label style={checkRow}><input type="checkbox" checked={backManager} onChange={(e) => setBackManager(e.target.checked)} /> Manager</label>
            </div>
          </Field>
          <div style={{ opacity: canBackdate ? 1 : 0.5, pointerEvents: canBackdate ? 'auto' : 'none' }}>
            <Field label="How far back can they backdate?">
              <Suffixed value={backDays} onChange={setBackDays} suffix="days" />
            </Field>
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
function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '16px 0 8px' }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
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
function Suffixed({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: 200 }}>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>{suffix}</span>
    </div>
  );
}

function chip(active: boolean): CSSProperties {
  return { padding: '9px 15px', borderRadius: 10, border: `1px solid ${active ? '#0571A6' : '#EBEBEB'}`, background: active ? '#0571A6' : '#fff', color: active ? '#fff' : '#484848', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
}
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
