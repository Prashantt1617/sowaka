// Controls › Attendance Correction — org policy for how attendance corrections
// work: when they can be raised (tied to the shift's Attendance Rules), the
// reasons, who approves, override rights, and backdating limits.
// Live: saved to the org's shift policy.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy, type DayMark, type PunchFormat } from '../../services/hrms';

// Only a missing punch can be corrected: a short or late day is a fact about
// the hours worked, not a gap in the record.
// The four ways a day can come out, in the order the punches happen. A
// complete day is on the list because it can still be disputed — someone
// graded a half day has something to contest even with both punches present.
const TRIGGERS = [
  'Missing punch-in',
  'Missing punch-out',
  'Both punches missing',
  'Both punches present',
];
const YES_NO = ['Yes', 'No'] as const;

/** Stored values keep their meaning; the labels say it in day terms. */
const markLabel = (mark: DayMark) =>
  mark === 'Present' ? 'Full day' : mark === 'Half Day' ? 'Half day' : mark;
const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
// What a day is marked as when a punch never arrived. This is what puts a day
// in front of an employee to correct, so it belongs with the rest of the flow.
const MARK_OPTIONS: DayMark[] = ['Absent', 'Half Day', 'Present'];
// Where punch data comes from. Auto Punch marks everyone present without a
// device, which is why it is the default for an org with no hardware.
const PUNCH_FORMATS: PunchFormat[] = [
  'Biometric',
  'Geotag (powered by Sowaka)',
  'Present by default (Auto Punch)',
];

export function AttendanceCorrection() {
  const { flash } = useStore();
  const [triggers, setTriggers] = useState<Record<string, boolean>>(
    Object.fromEntries(TRIGGERS.map((t) => [t, true])),
  );
  const [approver, setApprover] = useState('Reporting manager');
  const [punchFormat, setPunchFormat] = useState<PunchFormat>('Present by default (Auto Punch)');
  const [mgrWithoutEmployee, setMgrWithoutEmployee] = useState(true);
  const [hrOverride, setHrOverride] = useState(true);
  const [skipLevelOverride, setSkipLevelOverride] = useState(false);
  const [backDays, setBackDays] = useState('7');
  const [punchIn, setPunchIn] = useState<DayMark>('Absent');
  const [punchOut, setPunchOut] = useState<DayMark>('Absent');
  const [bothMissing, setBothMissing] = useState<DayMark>('Absent');
  // Read-only here: a complete day is graded by the Shift tab's thresholds, and
  // this row shows what those currently are rather than restating them.
  const [minHalfDay, setMinHalfDay] = useState<number | null>(null);
  const [minFullDay, setMinFullDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then((policy) => {
        const { correction } = policy;
        setPunchIn(policy.missingPunchIn);
        setPunchOut(policy.missingPunchOut);
        setBothMissing(policy.missingBoth);
        setMinHalfDay(policy.minHalfDayHours);
        setMinFullDay(policy.minFullDayHours);
        setTriggers(Object.fromEntries(TRIGGERS.map((t) => [t, correction.triggers.includes(t)])));
        setApprover(correction.approver);
        setPunchFormat(correction.punchFormat);
        setMgrWithoutEmployee(correction.managerWithoutEmployee);
        setHrOverride(correction.hrOverride);
        setSkipLevelOverride(correction.skipLevel);
        setBackDays(String(correction.backdateDays));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const CASES: {
    trigger: string;
    hasIn: boolean;
    hasOut: boolean;
    value?: DayMark;
    set?: (v: DayMark) => void;
  }[] = [
    { trigger: 'Missing punch-in', hasIn: false, hasOut: true, value: punchIn, set: setPunchIn },
    { trigger: 'Missing punch-out', hasIn: true, hasOut: false, value: punchOut, set: setPunchOut },
    { trigger: 'Both punches missing', hasIn: false, hasOut: false, value: bothMissing, set: setBothMissing },
    { trigger: 'Both punches present', hasIn: true, hasOut: true },
  ];

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        missingPunchIn: punchIn,
        missingPunchOut: punchOut,
        missingBoth: bothMissing,
        correction: {
          triggers: TRIGGERS.filter((t) => triggers[t]),
          approver,
          punchFormat,
          managerWithoutEmployee: mgrWithoutEmployee,
          hrOverride,
          skipLevel: skipLevelOverride,
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

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader
          title="How a day comes out"
          subtitle="The four ways a day can land, what each is marked as, and whether the employee may raise a correction against it."
        />
        <div style={{ padding: '4px 22px 18px', overflowX: 'auto' }}>
          <table style={caseTable}>
            <thead>
              <tr>
                <Th center width={110}>Punch in</Th>
                <Th center width={110}>Punch out</Th>
                <Th>Marked as</Th>
                <Th width={190}>Correction allowed?</Th>
              </tr>
            </thead>
            <tbody>
              {CASES.map((row) => (
                <tr key={row.trigger}>
                  <Td center><Mark on={row.hasIn} /></Td>
                  <Td center><Mark on={row.hasOut} /></Td>
                  <Td>
                    {row.trigger === 'Both punches present' ? (
                      // Not a choice: a complete day is half or full on the
                      // hours worked, against the Shift tab's thresholds.
                      <div style={fixedValue}>
                        <span>Half day or full day</span>
                        <span style={fixedTag}>by hours worked</span>
                      </div>
                    ) : (
                      <Select value={row.value!} onChange={row.set!} options={MARK_OPTIONS} render={markLabel} />
                    )}
                  </Td>
                  <Td>
                    <Select
                      value={triggers[row.trigger] ? 'Yes' : 'No'}
                      onChange={(v) => setTriggers((p) => ({ ...p, [row.trigger]: v === 'Yes' }))}
                      options={YES_NO}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={note}>
            {minFullDay == null || minHalfDay == null ? (
              'A day with both punches is graded on the hours worked, against the thresholds on the Shift tab.'
            ) : (
              <>
                A day with both punches is graded on the hours worked, against the{' '}
                <strong>Shift</strong> tab’s thresholds: <strong>{minFullDay}h</strong> or more is a
                full day, <strong>{minHalfDay}h</strong> up to {minFullDay}h is a half day, and
                anything shorter is flagged for correction. Change the split there, not here.
              </>
            )}{' '}
            An employee raises a correction from their attendance calendar.
          </div>
        </div>
      </Card>

      {/* Where the punches come from in the first place. */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Punch format" subtitle="How punch-in and punch-out are captured for this org." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Punch in / punch out data comes from">
            <select value={punchFormat} onChange={(e) => setPunchFormat(e.target.value as PunchFormat)} style={{ ...input, maxWidth: 340 }}>
              {PUNCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <div style={note}>
            {punchFormat === 'Biometric'
              ? 'Punches are imported from the biometric device. A day with no record is a missing punch, and can be corrected.'
              : punchFormat === 'Geotag (powered by Sowaka)'
              ? 'Employees punch in the app and the location is captured with the time.'
              : 'Everyone is marked present without punching. Corrections still apply where a day needs adjusting.'}
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
          <QRow label="Can HR override the decision?"><YesNo value={hrOverride} onChange={setHrOverride} /></QRow>
        </div>
      </Card>

      {/* Backdating */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Backdating" subtitle="How far back a correction can reach." />
        <div style={{ padding: '18px 22px' }}>
          <Field label="How far back can a correction be raised?">
            <Suffixed value={backDays} onChange={setBackDays} suffix="days" />
          </Field>
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
function Select<T extends string>({ value, onChange, options, render }: {
  value: T; onChange: (v: T) => void; options: readonly T[]; render?: (v: T) => string;
}) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value as T)} style={selectStyle}>
      {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
    </select>
  );
}

/** A tick or a cross for whether that punch is there in this case. */
function Mark({ on }: { on: boolean }) {
  return on ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4F7A52" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="present">
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4382E" strokeWidth="3" strokeLinecap="round" aria-label="missing">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Th({ children, center, width }: { children: ReactNode; center?: boolean; width?: number }) {
  return (
    <th style={{
      textAlign: center ? 'center' : 'left', width,
      fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171',
      fontWeight: 700, padding: '11px 12px', borderBottom: '1px solid #EBEBEB',
    }}>{children}</th>
  );
}
function Td({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <td style={{
      padding: '12px', borderBottom: '1px solid #F0F0F2',
      textAlign: center ? 'center' : 'left', verticalAlign: 'middle',
    }}>{children}</td>
  );
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

const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const selectStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const fixedValue: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, background: '#F7F7F9', color: '#717171' };
const fixedTag: CSSProperties = { marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#717171', background: '#EDEDF0', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const caseTable: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 15 };
