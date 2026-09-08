// Templates — a shift template is created by COPYING the org-wide policies
// (Policies section) as a starting point, then editing them for this shift.
// Each policy is a collapsed section here ("Shift Policy", "Overtime Policy", …)
// and every subsection inside a policy is itself a collapsed sub-section, so HR
// expands only what they want to override for this particular shift.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { LeaveTypes } from './LeaveTypes';

/** "HH:MM" -> minutes since midnight, or null if malformed. */
function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
/** Minutes -> "9h 00m". */
function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const MARK_OPTIONS = ['Absent', 'Half Day', 'Present', 'Pending Regularisation'];
const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
const TRIGGERS = ['Missing punch', 'Half day', 'Absent', 'Marked late', 'Early check-out'];
const REASON_CATALOG = ['WFH', 'On duty', 'Site visit', 'Forgot to punch', 'Apply leave'];
const SHIFT_TEMPLATES = [
  { name: 'Tech', start: '09:30', end: '18:30', active: true },
  { name: 'Sales', start: '10:00', end: '19:00', active: true },
  { name: 'Gurgaon 3D', start: '09:00', end: '18:00', active: true },
  { name: 'Kolkata 3D Team', start: '11:00', end: '20:00', active: true },
];
const DOW = [
  { key: 0, label: 'M', long: 'Mon' },
  { key: 1, label: 'T', long: 'Tue' },
  { key: 2, label: 'W', long: 'Wed' },
  { key: 3, label: 'T', long: 'Thu' },
  { key: 4, label: 'F', long: 'Fri' },
  { key: 5, label: 'S', long: 'Sat' },
  { key: 6, label: 'S', long: 'Sun' },
];
const WEEK_ROWS = [1, 2, 3, 4, 5];

function cellBtn(active: boolean): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${active ? '#0571A6' : '#DADFE4'}`,
    background: active ? '#0571A6' : '#fff',
    cursor: 'pointer',
    display: 'inline-block',
  };
}
const rowHead: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#333333', paddingRight: 14, whiteSpace: 'nowrap' };

export function ShiftTemplates() {
  const { flash } = useStore();
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  // Shift name (always visible)
  const [name, setName] = useState('');
  // ── Shift Policy ──────────────────────────────────────────────
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [minHalfDay, setMinHalfDay] = useState('4');
  const [minFullDay, setMinFullDay] = useState('8');
  const [punchInMissing, setPunchInMissing] = useState('Pending Regularisation');
  const [punchOutMissing, setPunchOutMissing] = useState('Pending Regularisation');
  const [bothMissing, setBothMissing] = useState('Absent');
  const [lateAfter, setLateAfter] = useState('10');
  const [earlyOut, setEarlyOut] = useState('10');
  const [weekGrid, setWeekGrid] = useState<Record<number, Set<number>>>({
    1: new Set([6]), 2: new Set([6]), 3: new Set([6]), 4: new Set([6]), 5: new Set([6]), // Sunday off by default
  });
  // ── Overtime Policy ───────────────────────────────────────────
  const [otEligible, setOtEligible] = useState(true);
  const [otHoliday, setOtHoliday] = useState(true);
  const [otWeeklyOff, setOtWeeklyOff] = useState(true);
  const [otBeyondShift, setOtBeyondShift] = useState(false);
  const [otBeyondHours, setOtBeyondHours] = useState('1');
  // ── Attendance Policy ─────────────────────────────────────────
  const [triggers, setTriggers] = useState<Record<string, boolean>>({ 'Missing punch': true, 'Half day': true });
  const [attApprover, setAttApprover] = useState('Reporting manager');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([...REASON_CATALOG]);
  const [mgrWithoutEmployee, setMgrWithoutEmployee] = useState(true);
  const [attHrOverride, setAttHrOverride] = useState(true);
  const [attSkipLevel, setAttSkipLevel] = useState(false);
  const [backEmployee, setBackEmployee] = useState(true);
  const [backManager, setBackManager] = useState(true);
  const [backDays, setBackDays] = useState('7');
  // ── Leave Policy ──────────────────────────────────────────────
  const [advanceDays, setAdvanceDays] = useState('30');
  const [allowBackdated, setAllowBackdated] = useState(true);
  const [backdatedDays, setBackdatedDays] = useState('3');
  const [leaveApprover, setLeaveApprover] = useState('Reporting manager');
  const [mgrOnBehalf, setMgrOnBehalf] = useState(false);
  const [leaveHrOverride, setLeaveHrOverride] = useState(true);
  const [leaveSkipLevel, setLeaveSkipLevel] = useState(false);

  const toggleWeekCell = (w: number, d: number) =>
    setWeekGrid((prev) => {
      const cur = new Set(prev[w] ?? []);
      if (cur.has(d)) cur.delete(d);
      else cur.add(d);
      return { ...prev, [w]: cur };
    });
  const cellActive = (w: number, d: number) => weekGrid[w]?.has(d) ?? false;
  const toggleTrigger = (t: string) => setTriggers((p) => ({ ...p, [t]: !p[t] }));
  const toggleReason = (r: string) => setSelectedReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const canBackdate = backEmployee || backManager;

  const openTemplate = (t: { name: string; start: string; end: string }) => {
    setName(t.name);
    setStart(t.start);
    setEnd(t.end);
    setMode('edit');
  };
  const newTemplate = () => {
    setName('');
    setStart('09:00');
    setEnd('18:00');
    setMode('edit');
  };

  const s = toMinutes(start);
  const e = toMinutes(end);
  let durationMins: number | null = null;
  let overnight = false;
  if (s != null && e != null) {
    durationMins = e - s;
    if (durationMins <= 0) {
      durationMins += 24 * 60;
      overnight = true;
    }
  }

  if (mode === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={newTemplate} style={primaryBtn}>+ Create New</button>
        </div>
        <Card>
          <table style={tableStyle}>
            <thead>
              <tr><Th>Template Name</Th><Th>Shift window</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {SHIFT_TEMPLATES.map((t) => {
                const sm = toMinutes(t.start);
                const em = toMinutes(t.end);
                let d = sm != null && em != null ? em - sm : 0;
                if (d <= 0) d += 24 * 60;
                return (
                  <tr key={t.name} onClick={() => openTemplate(t)} style={{ cursor: 'pointer' }}>
                    <Td><strong style={{ color: '#0571A6' }}>{t.name}</strong></Td>
                    <Td muted>{t.start} – {t.end} · {formatDuration(d)}</Td>
                    <Td><StatusText on={t.active} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => setMode('list')} style={ghostBtn}>← All templates</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          <button onClick={() => { flash('Shift template saved (prototype)'); setMode('list'); }} style={primaryBtn}>Save template</button>
        </div>
      </div>

      {/* Shift name — always visible, outside the collapsible policies */}
      <Card style={{ padding: '16px 20px', marginBottom: 14 }}>
        <Field label="Shift Name" required>
          <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. General Day, Night Shift" style={input} />
        </Field>
      </Card>

      {/* Inheritance banner */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 14 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          These policies were <strong>copied from your global Policies</strong> when the template was created. Each one below currently follows the global policy — expand a policy (and its sections) to override it <strong>for this shift only</strong>.
        </div>
      </div>

      {/* ── Shift Policy ──────────────────────────────────────── */}
      <PolicySection title="Shift Policy" subtitle="Working window, missing punches & weekly-off.">
        <SubSection title="Working window">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
            <Field label="Shift Start Time"><input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} style={input} /></Field>
            <Field label="Shift End Time"><input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} style={input} /></Field>
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>Duration</label>
              <div style={durationBox}>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>{durationMins != null ? formatDuration(durationMins) : '—'}</span>
                {overnight && <span style={overnightTag}>overnight · +1 day</span>}
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="Missing punches">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Punch-in missing — mark as"><Select value={punchInMissing} onChange={setPunchInMissing} options={MARK_OPTIONS} /></Field>
            <Field label="Punch-out missing — mark as"><Select value={punchOutMissing} onChange={setPunchOutMissing} options={MARK_OPTIONS} /></Field>
            <Field label="Both punches missing — mark as"><Select value={bothMissing} onChange={setBothMissing} options={MARK_OPTIONS} /></Field>
          </div>
        </SubSection>

        <SubSection title="Weekly-off">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '8px 8px' }}>
              <thead>
                <tr>
                  <th />
                  {DOW.map((dw) => (
                    <th key={dw.long} title={dw.long} style={{ fontSize: 13, fontWeight: 800, color: '#717171', width: 34 }}>{dw.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEK_ROWS.map((w) => (
                  <tr key={w}>
                    <td style={rowHead}>Week {w}</td>
                    {DOW.map((dw) => (
                      <td key={dw.long} style={{ textAlign: 'center' }}>
                        <button onClick={() => toggleWeekCell(w, dw.key)} style={cellBtn(cellActive(w, dw.key))} title={`${dw.long} — week ${w}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SubSection>
      </PolicySection>

      {/* ── Late Policy ───────────────────────────────────────── */}
      <PolicySection title="Late Policy" subtitle="Grace before an arrival is late or a departure is an early-out.">
        <SubSection title="Late & early grace">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Mark as late if late by"><Suffixed value={lateAfter} onChange={setLateAfter} suffix="min" /></Field>
            <Field label="Mark early-out if leaves early by"><Suffixed value={earlyOut} onChange={setEarlyOut} suffix="min" /></Field>
          </div>
        </SubSection>
      </PolicySection>

      {/* ── Half day Policy ───────────────────────────────────── */}
      <PolicySection title="Half day Policy" subtitle="Worked-hour thresholds for a half day vs a full day.">
        <SubSection title="Day thresholds">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Min hours for half day"><Suffixed value={minHalfDay} onChange={setMinHalfDay} suffix="hrs" /></Field>
            <Field label="Min hours for full day"><Suffixed value={minFullDay} onChange={setMinFullDay} suffix="hrs" /></Field>
          </div>
        </SubSection>
      </PolicySection>

      {/* ── Overtime Policy ───────────────────────────────────── */}
      <PolicySection title="Overtime Policy" subtitle="Whether this shift qualifies for overtime, and when it applies.">
        <SubSection title="Eligibility">
          <Field label="Are employees on this shift eligible for overtime?">
            <YesNo value={otEligible} onChange={setOtEligible} />
          </Field>
        </SubSection>
        <SubSection title="Counts as overtime when…">
          <div style={{ opacity: otEligible ? 1 : 0.5, pointerEvents: otEligible ? 'auto' : 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!otEligible && <div style={{ fontSize: 13, color: '#9197A2' }}>This shift isn’t eligible for overtime.</div>}
            <label style={checkRow}><input type="checkbox" checked={otHoliday} onChange={(ev) => setOtHoliday(ev.target.checked)} /> On a holiday</label>
            <label style={checkRow}><input type="checkbox" checked={otWeeklyOff} onChange={(ev) => setOtWeeklyOff(ev.target.checked)} /> On a weekly-off</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={checkRow}><input type="checkbox" checked={otBeyondShift} onChange={(ev) => setOtBeyondShift(ev.target.checked)} /> Beyond shift hours by</label>
              <div style={{ opacity: otBeyondShift ? 1 : 0.5, pointerEvents: otBeyondShift ? 'auto' : 'none' }}>
                <Suffixed value={otBeyondHours} onChange={setOtBeyondHours} suffix="hrs" width={120} />
              </div>
            </div>
          </div>
        </SubSection>
      </PolicySection>

      {/* ── Attendance Policy ─────────────────────────────────── */}
      <PolicySection title="Attendance Correction Policy" subtitle="When corrections can be raised, who approves, and backdating limits.">
        <SubSection title="When can a correction be raised?">
          <div style={{ fontSize: 13, color: '#717171', marginBottom: 10 }}>An employee gets the option when their day is auto-marked (from the Shift Policy) as:</div>
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
        </SubSection>

        <SubSection title="Approval & overrides">
          <Field label="Who approves a correction?">
            <select value={attApprover} onChange={(ev) => setAttApprover(ev.target.value)} style={{ ...input, maxWidth: 340 }}>
              {APPROVERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <QRow label="Can a manager correct attendance without the employee applying?"><YesNo value={mgrWithoutEmployee} onChange={setMgrWithoutEmployee} /></QRow>
          <QRow label="Can HR override the decision?"><YesNo value={attHrOverride} onChange={setAttHrOverride} /></QRow>
          <QRow label="Can the level above the manager override?"><YesNo value={attSkipLevel} onChange={setAttSkipLevel} /></QRow>
        </SubSection>

        <SubSection title="Backdating">
          <Field label="Backdated corrections allowed for">
            <div style={{ display: 'flex', gap: 18 }}>
              <label style={checkRow}><input type="checkbox" checked={backEmployee} onChange={(ev) => setBackEmployee(ev.target.checked)} /> Employee</label>
              <label style={checkRow}><input type="checkbox" checked={backManager} onChange={(ev) => setBackManager(ev.target.checked)} /> Manager</label>
            </div>
          </Field>
          <div style={{ opacity: canBackdate ? 1 : 0.5, pointerEvents: canBackdate ? 'auto' : 'none' }}>
            <Field label="How far back can they backdate?">
              <Suffixed value={backDays} onChange={setBackDays} suffix="days" width={200} />
            </Field>
          </div>
        </SubSection>
      </PolicySection>

      {/* ── Leave Policy ──────────────────────────────────────── */}
      <PolicySection title="Leave Policy" subtitle="Leave types & accrual, the application window and the approval flow.">
        <SubSection title="Leave types">
          <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 12 }}>
            Monthly accrual and reset (lapse / carry-forward / encash) per leave type. Copied from the global Leave policy — edit for this shift only.
          </div>
          <LeaveTypes />
        </SubSection>

        <SubSection title="When can leave be applied?">
          <Field label="How far in advance can leave be applied?">
            <Suffixed value={advanceDays} onChange={setAdvanceDays} suffix="days ahead" width={220} />
          </Field>
          <QRow label="Allow backdated leave applications?"><YesNo value={allowBackdated} onChange={setAllowBackdated} /></QRow>
          <div style={{ opacity: allowBackdated ? 1 : 0.5, pointerEvents: allowBackdated ? 'auto' : 'none', marginTop: 14 }}>
            <Field label="How far backdated can leave be applied?">
              <Suffixed value={backdatedDays} onChange={setBackdatedDays} suffix="days back" width={220} />
            </Field>
          </div>
        </SubSection>

        <SubSection title="Approval & overrides">
          <Field label="Who approves a leave request?">
            <select value={leaveApprover} onChange={(ev) => setLeaveApprover(ev.target.value)} style={{ ...input, maxWidth: 340 }}>
              {APPROVERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <QRow label="Can a manager apply leave on behalf of the employee?"><YesNo value={mgrOnBehalf} onChange={setMgrOnBehalf} /></QRow>
          <QRow label="Can HR override the decision?"><YesNo value={leaveHrOverride} onChange={setLeaveHrOverride} /></QRow>
          <QRow label="Can the level above the manager override?"><YesNo value={leaveSkipLevel} onChange={setLeaveSkipLevel} /></QRow>
        </SubSection>
      </PolicySection>

      {/* Holidays are not configured on the shift — they come from the Holiday Bank master, by location. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '14px 16px', marginTop: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          <strong>Holidays aren’t set on the shift.</strong> They’re assigned automatically from the <strong>Holiday Bank</strong> master based on each employee’s work location — so the same shift observes different holidays across locations.
        </div>
      </div>
    </div>
  );
}

/** Outer collapsible — one org policy, copied into the template. Collapsed by default. */
function PolicySection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: '#FBFBFC', border: 'none', borderBottom: open ? '1px solid #EBEBEB' : 'none', padding: '16px 22px', cursor: 'pointer' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {!open && <span style={followingPill}>Following global policy</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9197A2" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </Card>
  );
}

/** Inner collapsible — one subsection of a policy. Collapsed by default. */
function SubSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid #EDEDF0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: '#FCFCFD', border: 'none', borderBottom: open ? '1px solid #EDEDF0' : 'none', padding: '12px 16px', cursor: 'pointer' }}
      >
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: '#333333' }}>{title}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B0B4BC" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div style={{ padding: '16px' }}>{children}</div>}
    </div>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '16px 0 8px' }}>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}{required && <span style={{ color: '#C4382E' }}> *</span>}</label>
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
function Suffixed({ value, onChange, suffix, width }: { value: string; onChange: (v: string) => void; suffix: string; width?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" value={value} onChange={(ev) => onChange(ev.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>
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
            padding: '8px 22px',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            border: 'none',
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
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} style={{ ...input, cursor: 'pointer' }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <td style={{ padding: '13px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222' }}>{children}</td>;
}
function StatusText({ on }: { on: boolean }) {
  return <span style={{ fontSize: 14, fontWeight: 700, color: on ? '#4F7A52' : '#9197A2' }}>{on ? 'Active' : 'Inactive'}</span>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const durationBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', minHeight: 40, border: '1px solid #E7F0F5', borderRadius: 9, background: '#F1F8FC', whiteSpace: 'nowrap' };
const overnightTag: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#8A6D1F', background: '#FBF3DD', borderRadius: 20, padding: '2px 9px' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer' };
const followingPill: CSSProperties = { flexShrink: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#4F7A52', background: '#EAF3EA', border: '1px solid #D6E8D6', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' };
const chip = (active: boolean): CSSProperties => ({ padding: '9px 15px', borderRadius: 10, border: `1px solid ${active ? '#0571A6' : '#EBEBEB'}`, background: active ? '#0571A6' : '#fff', color: active ? '#fff' : '#484848', fontWeight: 700, fontSize: 14, cursor: 'pointer' });
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
