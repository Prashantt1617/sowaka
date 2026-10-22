// Payroll › Pay Schedule (ORG-3) and Tax Details / statutory registration (ORG-2).
// Two standalone Payroll screens (each its own sidebar item). Organisation
// identity/address/contact live on the top-level Organisation screen.
// Both read and save the company's own settings (GET/PUT /admin/payroll/org-setup).
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { ApiError } from '../../services/http';
import { getOrgSetup, listRuns, updateOrgSetup } from '../../services/payroll';
import type { OrgSetupDTO, PayrollRunDTO } from '../../services/payroll';
import * as L from './look';
import './look.css';

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtPeriod = (p: string) => {
  if (!p) return 'Not set';
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`.trim();
};
const fmtPayDay = (d: string) => (d === 'last_day' ? 'Last day of the month' : `Day ${d}`);
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

const RUN_TONE: Record<PayrollRunDTO['status'], { tone: L.Tone; label: string }> = {
  draft: { tone: 'mute', label: 'Draft' },
  pending_approval: { tone: 'warn', label: 'Pending approval' },
  approved: { tone: 'ok', label: 'Approved' },
  rejected: { tone: 'bad', label: 'Rejected' },
  paid: { tone: 'ok', label: 'Paid' },
};

const scheduleFrom = (s: OrgSetupDTO): ScheduleForm => ({
  payDay: String(s.paySchedule?.payDay ?? 'last_day'),
  firstPayPeriod: s.paySchedule?.firstPayPeriod ?? '',
});
const regFrom = (s: OrgSetupDTO): RegForm => {
  const r = s.statutoryRegistration ?? {};
  return {
    pan: r.pan ?? '',
    tan: r.tan ?? '',
    tdsCircle: r.tdsCircle ?? '',
    aoCode: r.aoCode ?? '',
    taxPaymentFrequency: r.taxPaymentFrequency ?? '',
    deductorType: r.deductor?.type ?? '',
    deductorName: r.deductor?.name ?? '',
    deductorDesignation: r.deductor?.designation ?? '',
  };
};

/** The company's saved setup, loaded once per screen. */
function useOrgSetup() {
  const { flash } = useStore();
  const [setup, setSetup] = useState<OrgSetupDTO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getOrgSetup().then(setSetup).catch((e) => {
      setFailed(true);
      flash(e instanceof ApiError ? e.message : 'Could not load the payroll setup');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { setup, setSetup, failed };
}

function Loading({ failed }: { failed: boolean }) {
  return <Card style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>{failed ? 'The payroll setup could not be loaded.' : 'Loading…'}</Card>;
}

// —— Pay Schedule ——————————————————————————————————————————————————
export function PaySchedule() {
  const { flash } = useStore();
  const { setup, setSetup, failed } = useOrgSetup();
  const [sched, setSched] = useState<ScheduleForm>({ payDay: 'last_day', firstPayPeriod: '' });
  const [runs, setRuns] = useState<PayrollRunDTO[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (setup) setSched(scheduleFrom(setup)); }, [setup]);
  // The runs list is a convenience: without Payroll Runs access it stays empty.
  useEffect(() => { listRuns().then(setRuns).catch(() => setRuns([])); }, []);

  if (!setup) return <Loading failed={failed} />;
  const locked = setup.payScheduleLocked;
  const setS = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) => setSched({ ...sched, [k]: v });

  const cancel = () => { setSched(scheduleFrom(setup)); setEditing(false); };
  const save = async () => {
    setSaving(true);
    try {
      const next = await updateOrgSetup({
        paySchedule: {
          frequency: 'monthly',
          payDay: sched.payDay === 'last_day' ? 'last_day' : Number(sched.payDay),
          ...(sched.firstPayPeriod ? { firstPayPeriod: sched.firstPayPeriod } : {}),
          // The cadence is fixed once the first payroll has run.
          lockedAfterFirstRun: true,
        },
      });
      setSetup(next);
      setEditing(false);
      flash('Pay schedule saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the pay schedule');
    } finally {
      setSaving(false);
    }
  };
  const recent = [...runs].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 20, minHeight: 40 }}>
        {editing ? (
          <>
            <button onClick={cancel} className="lk-btn" style={ghostBtn}>Cancel</button>
            <button onClick={() => void save()} disabled={saving} className="lk-btn-p" style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        ) : (
          !locked && <button onClick={() => setEditing(true)} className="lk-btn" style={ghostBtn}>Edit</button>
        )}
      </div>

      {locked && (
        <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 13 }}>🔒</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>Locked after the first payroll run</div>
            <div style={{ fontSize: 13, color: 'var(--warn)', marginTop: 3, lineHeight: 1.5 }}>
              Payroll has already run on this schedule, so its pay day and first period can no longer change.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(0, 1fr)', gap: 20, alignItems: 'stretch' }}>
      <Card style={{ padding: 20, order: 2 }}>
        <SectionTitle title="Pay schedule" sub="How often and when payroll runs." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: editing ? 16 : 10 }}>
          <Field inline={!editing} label="Frequency">
            {editing ? <input value="Monthly" disabled style={{ ...inputStyle, background: 'var(--surface-2)', color: 'var(--ink-3)' }} /> : <ReadValue text="Monthly" />}
          </Field>
          <Field inline={!editing} label="Pay day">
            {editing ? (
              <select value={sched.payDay} onChange={(e) => setS('payDay', e.target.value)} className="lk-in" style={inputStyle}>
                <option value="last_day">Last day of the month</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>Day {d}</option>
                ))}
              </select>
            ) : (
              <ReadValue text={fmtPayDay(sched.payDay)} />
            )}
          </Field>
          <Field inline={!editing} label="First pay period">
            {editing ? (
              <input type="month" value={sched.firstPayPeriod} onChange={(e) => setS('firstPayPeriod', e.target.value)} className="lk-in" style={inputStyle} />
            ) : (
              <ReadValue text={fmtPeriod(sched.firstPayPeriod)} />
            )}
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 20, order: 1 }}>
        <div style={L.cardTitle}>Recent payrolls</div>
        <div style={{ ...L.cardNote, marginTop: 2, marginBottom: 12 }}>The latest runs and where they stand. Open Payroll Runs to work on one.</div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '10px 0' }}>No payroll runs yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recent.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: i === recent.length - 1 ? 'none' : '1px solid var(--line)', padding: '12px 0' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{fmtPeriod(r.period)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.employeeCount} people{r.totals ? ` · Net ${rupees(r.totals.netPaise)}` : ''}</div>
                </div>
                <span style={L.pill(RUN_TONE[r.status].tone)}>
                  <span aria-hidden style={L.pillDot} />{RUN_TONE[r.status].label}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

function ReadValue({ text }: { text: string }) {
  return <div style={{ ...L.kvDd }}>{text}</div>;
}

// —— Tax Details (statutory registration) ————————————————————————————
export function TaxDetails() {
  const { flash } = useStore();
  const { setup, setSetup, failed } = useOrgSetup();
  const [reg, setReg] = useState<RegForm>(regFrom({ paySchedule: { frequency: 'monthly', payDay: 'last_day' }, statutoryRegistration: {}, payScheduleLocked: false, hasRuns: false }));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (setup) setReg(regFrom(setup)); }, [setup]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateOrgSetup({
        statutoryRegistration: {
          ...(reg.pan.trim() ? { pan: reg.pan.trim() } : {}),
          ...(reg.tan.trim() ? { tan: reg.tan.trim() } : {}),
          ...(reg.tdsCircle.trim() ? { tdsCircle: reg.tdsCircle.trim() } : {}),
          ...(reg.aoCode.trim() ? { aoCode: reg.aoCode.trim() } : {}),
          ...(reg.taxPaymentFrequency ? { taxPaymentFrequency: reg.taxPaymentFrequency } : {}),
          deductor: { type: reg.deductorType.trim(), name: reg.deductorName.trim(), designation: reg.deductorDesignation.trim() },
        },
      });
      setSetup(next);
      flash('Tax details saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the tax details');
    } finally {
      setSaving(false);
    }
  };
  if (!setup) return <Loading failed={failed} />;
  const setR = <K extends keyof RegForm>(k: K, v: RegForm[K]) => setReg({ ...reg, [k]: v });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button onClick={() => void save()} disabled={saving} className="lk-btn-p" style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20, alignItems: 'stretch' }}>
      <Card style={{ padding: 20 }}>
        <SectionTitle title="Tax details" sub="Org-level tax identity, required before any statutory filing output can be generated." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="PAN" hint="Format ABCDE1234F">
            <input value={reg.pan} onChange={(e) => setR('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" className="lk-in" style={inputStyle} />
          </Field>
          <Field label="TAN" hint="Format ABCD12345E">
            <input value={reg.tan} onChange={(e) => setR('tan', e.target.value.toUpperCase())} placeholder="ABCD12345E" className="lk-in" style={inputStyle} />
          </Field>
          <Field label="TDS circle">
            <input value={reg.tdsCircle} onChange={(e) => setR('tdsCircle', e.target.value)} className="lk-in" style={inputStyle} />
          </Field>
          <Field label="Assessing officer (AO) code">
            <input value={reg.aoCode} onChange={(e) => setR('aoCode', e.target.value)} className="lk-in" style={inputStyle} />
          </Field>
          <Field label="Tax payment frequency">
            <select value={reg.taxPaymentFrequency} onChange={(e) => setR('taxPaymentFrequency', e.target.value as RegForm['taxPaymentFrequency'])} className="lk-in" style={inputStyle}>
              <option value="">Not set</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </Field>
        </div>

      </Card>
      <Card style={{ padding: 20 }}>
        <div style={{ ...L.cardTitle, marginBottom: 16 }}>Deductor details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          <Field label="Type">
            <input value={reg.deductorType} onChange={(e) => setR('deductorType', e.target.value)} placeholder="e.g. Company" className="lk-in" style={inputStyle} />
          </Field>
          <Field label="Name">
            <input value={reg.deductorName} onChange={(e) => setR('deductorName', e.target.value)} className="lk-in" style={inputStyle} />
          </Field>
          <Field label="Designation">
            <input value={reg.deductorDesignation} onChange={(e) => setR('deductorDesignation', e.target.value)} className="lk-in" style={inputStyle} />
          </Field>
        </div>
      </Card>
      </div>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={L.cardTitle}>{title}</div>
      <div style={{ ...L.cardNote, marginTop: 2 }}>{sub}</div>
    </div>
  );
}
function Field({ label, hint, inline, children }: { label: string; hint?: string; inline?: boolean; children: ReactNode }) {
  // Read-only values sit beside their label, as key–value rows.
  if (inline) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '136px minmax(0, 1fr)', gap: 16, alignItems: 'baseline' }}>
        <label style={L.kvDt}>{label}</label>
        {children}
      </div>
    );
  }
  return (
    <div>
      <label style={L.label}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

const inputStyle: CSSProperties = { ...L.input };
const primaryBtn: CSSProperties = { ...L.btnPrimary };
const ghostBtn: CSSProperties = { ...L.btn };
