// Payroll › Pay Schedule (ORG-3) and Tax Details / statutory registration (ORG-2).
// Two standalone Payroll screens (each its own sidebar item). Organisation
// identity/address/contact live on the top-level Organisation screen.
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
// Reconnect getOrgSetup/updateOrgSetup when finalising.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';

type ScheduleForm = {
  payDay: string; // 'last_day' | '1'..'28'
  firstPayPeriod: string;
};
type RegForm = {
  pan: string;
  tan: string;
  tdsCircle: string;
  aoCode: string;
  taxPaymentFrequency: '' | 'monthly' | 'quarterly';
  deductorType: string;
  deductorName: string;
  deductorDesignation: string;
};

// —— Mock data for capture ——————————————————————————————————————————
const MOCK_SCHEDULE: ScheduleForm = {
  payDay: 'last_day',
  firstPayPeriod: '2026-04',
};

// Upcoming payroll runs — the schedule is locked while any run is Approved.
type RunStatus = 'Draft' | 'Approved' | 'Paid' | 'Rejected';
type PayRun = { id: string; period: string; payDate: string; net: string; status: RunStatus };
const MOCK_RUNS: PayRun[] = [
  { id: 'r-apr', period: 'April 2026', payDate: '30 Apr 2026', net: '₹8,42,500', status: 'Approved' },
  { id: 'r-may', period: 'May 2026', payDate: '31 May 2026', net: '₹8,42,500', status: 'Draft' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtPeriod = (p: string) => {
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`.trim();
};
const fmtPayDay = (d: string) => (d === 'last_day' ? 'Last day of the month' : `Day ${d}`);

const RUN_TONE: Record<RunStatus, { bg: string; fg: string }> = {
  Approved: { bg: '#E4EDE0', fg: '#4F7A52' },
  Draft: { bg: '#F7F7F9', fg: '#717171' },
  Paid: { bg: '#E7ECF4', fg: '#4A6FA5' },
  Rejected: { bg: '#F4DEE2', fg: '#A8475F' },
};
const MOCK_REG: RegForm = {
  pan: 'AACCS1234K',
  tan: 'BLRC12345E',
  tdsCircle: 'TDS Ward 3(2), Bengaluru',
  aoCode: 'BLR-W-32-1',
  taxPaymentFrequency: 'monthly',
  deductorType: 'Company',
  deductorName: 'Convrse Spaces Pvt. Ltd.',
  deductorDesignation: 'Director',
};

// —— Pay Schedule ——————————————————————————————————————————————————
export function PaySchedule() {
  const { flash } = useStore();
  const [sched, setSched] = useState<ScheduleForm>(MOCK_SCHEDULE);
  const [runs, setRuns] = useState<PayRun[]>(MOCK_RUNS);
  const [editing, setEditing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const approvedRuns = runs.filter((r) => r.status === 'Approved');
  const hasApproved = approvedRuns.length > 0;

  const setS = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) => setSched({ ...sched, [k]: v });

  const onEdit = () => {
    if (hasApproved) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setEditing(false);
      flash('Pay schedule saved');
    }, 400);
  };

  // Act on a run; when no approved run remains the schedule unlocks and the block clears.
  const applyRuns = (next: PayRun[], msg: string) => {
    setRuns(next);
    flash(msg);
    if (!next.some((r) => r.status === 'Approved')) setBlocked(false);
  };
  const payRun = (id: string, period: string) => applyRuns(runs.map((r) => (r.id === id ? { ...r, status: 'Paid' } : r)), `${period} pay run marked paid`);
  const rejectRun = (id: string, period: string) => applyRuns(runs.map((r) => (r.id === id ? { ...r, status: 'Rejected' } : r)), `${period} pay run rejected`);
  const deleteRun = (id: string, period: string) => applyRuns(runs.filter((r) => r.id !== id), `${period} pay run deleted`);

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
        {editing ? (
          <>
            <button onClick={cancel} style={ghostBtn}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        ) : (
          <button onClick={onEdit} style={ghostBtn}>Edit</button>
        )}
      </div>

      {/* Edit guard — an approved run locks the schedule. */}
      {blocked && hasApproved && (
        <div style={{ background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#9A6B25' }}>You have an approved pay run</div>
              <div style={{ fontSize: 14, color: '#8A6A20', marginTop: 3, lineHeight: 1.5 }}>
                The pay schedule can’t be changed while a run is approved. To make any changes, first <strong>pay</strong>, <strong>reject</strong> or <strong>delete</strong> the run{approvedRuns.length > 1 ? 's' : ''} below.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvedRuns.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>{r.period}</div>
                  <div style={{ fontSize: 13, color: '#717171' }}>Pay date {r.payDate} · Net {r.net}</div>
                </div>
                <button onClick={() => payRun(r.id, r.period)} style={{ ...miniBtn, background: '#0571A6', color: '#fff', border: 'none' }}>Pay</button>
                <button onClick={() => rejectRun(r.id, r.period)} style={miniBtn}>Reject</button>
                <button onClick={() => deleteRun(r.id, r.period)} style={{ ...miniBtn, color: '#A8475F', borderColor: '#EBD9DE' }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card style={{ padding: '18px 20px', marginBottom: 16 }}>
        <SectionTitle title="Pay schedule" sub="How often and when payroll runs." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          <Field label="Frequency">
            {editing ? <input value="Monthly" disabled style={{ ...inputStyle, background: '#F7F7F9', color: '#717171' }} /> : <ReadValue text="Monthly" />}
          </Field>
          <Field label="Pay day">
            {editing ? (
              <select value={sched.payDay} onChange={(e) => setS('payDay', e.target.value)} style={inputStyle}>
                <option value="last_day">Last day of the month</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>Day {d}</option>
                ))}
              </select>
            ) : (
              <ReadValue text={fmtPayDay(sched.payDay)} />
            )}
          </Field>
          <Field label="First pay period">
            {editing ? (
              <input type="month" value={sched.firstPayPeriod} onChange={(e) => setS('firstPayPeriod', e.target.value)} style={inputStyle} />
            ) : (
              <ReadValue text={fmtPeriod(sched.firstPayPeriod)} />
            )}
          </Field>
        </div>
      </Card>

      {/* Upcoming payrolls */}
      <Card style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#222222' }}>Upcoming payrolls</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 2, marginBottom: 14 }}>Scheduled runs and their approval status.</div>
        {runs.length === 0 ? (
          <div style={{ fontSize: 14, color: '#717171', padding: '10px 0' }}>No upcoming payroll runs.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runs.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #EBEBEB', borderRadius: 10, padding: '11px 13px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>{r.period}</div>
                  <div style={{ fontSize: 13, color: '#717171' }}>Pay date {r.payDate} · Net {r.net}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: RUN_TONE[r.status].fg, background: RUN_TONE[r.status].bg, borderRadius: 20, padding: '4px 11px' }}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ReadValue({ text }: { text: string }) {
  return <div style={{ fontSize: 16, fontWeight: 600, color: '#222222', padding: '4px 0' }}>{text}</div>;
}

// —— Tax Details (statutory registration) ————————————————————————————
export function TaxDetails() {
  const { flash } = useStore();
  const [reg, setReg] = useState<RegForm>(MOCK_REG);
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      flash('Tax details saved');
    }, 400);
  };
  const setR = <K extends keyof RegForm>(k: K, v: RegForm[K]) => setReg({ ...reg, [k]: v });

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <Card style={{ padding: '18px 20px' }}>
        <SectionTitle title="Tax details" sub="Org-level tax identity, required before any statutory filing output can be generated." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="PAN" hint="Format ABCDE1234F">
            <input value={reg.pan} onChange={(e) => setR('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" style={inputStyle} />
          </Field>
          <Field label="TAN" hint="Format ABCD12345E">
            <input value={reg.tan} onChange={(e) => setR('tan', e.target.value.toUpperCase())} placeholder="ABCD12345E" style={inputStyle} />
          </Field>
          <Field label="TDS circle">
            <input value={reg.tdsCircle} onChange={(e) => setR('tdsCircle', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Assessing officer (AO) code">
            <input value={reg.aoCode} onChange={(e) => setR('aoCode', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Tax payment frequency">
            <select value={reg.taxPaymentFrequency} onChange={(e) => setR('taxPaymentFrequency', e.target.value as RegForm['taxPaymentFrequency'])} style={inputStyle}>
              <option value="">Not set</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </Field>
        </div>

        <div style={{ fontSize: 14, fontWeight: 800, color: '#484848', margin: '18px 0 10px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Deductor details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Field label="Type">
            <input value={reg.deductorType} onChange={(e) => setR('deductorType', e.target.value)} placeholder="e.g. Company" style={inputStyle} />
          </Field>
          <Field label="Name">
            <input value={reg.deductorName} onChange={(e) => setR('deductorName', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Designation">
            <input value={reg.deductorDesignation} onChange={(e) => setR('deductorDesignation', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>{sub}</div>
    </div>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#717171', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const miniBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '7px 14px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
