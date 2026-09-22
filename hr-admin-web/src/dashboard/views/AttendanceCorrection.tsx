// Controls › Attendance Correction — org policy for how attendance is captured
// and how a day comes out of it: how many punches a day is built from, what an
// incomplete day is marked as, whether the employee may dispute it, and what
// they may ask it to become.
// Live: saved to the org's shift policy.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { DayOutcomeGrid, OUTCOMES, TRIGGERS } from '../components/DayOutcomeGrid';
import {
  getShiftPolicy,
  saveShiftPolicy,
  type CorrectionOutcome,
  type DayMark,
  type PunchFormat,
  type PunchMode,
} from '../../services/hrms';

// Only a missing punch can be corrected: a short or late day is a fact about
// the hours worked, not a gap in the record.
// The four ways a day can come out, in the order the punches happen. A
// complete day is on the list because it can still be disputed — someone
// graded a half day has something to contest even with both punches present.

const APPROVERS = ['Reporting manager', 'HR', 'Reporting manager, then HR'];
// What a day is marked as when a punch never arrived. This is what puts a day
// in front of an employee to correct, so it belongs with the rest of the flow.
// Where punch data comes from. Assigned per shift template, so teams on
// different hardware run side by side. Auto Punch marks everyone present
// without a device, which is why it is the default for an org with none.
const PUNCH_FORMATS: PunchFormat[] = [
  'Biometric',
  'Geotag (powered by Sowaka)',
  'Present by default (Auto Punch)',
  'In-app punch in',
];
const FORMAT_NOTES: Record<PunchFormat, string> = {
  Biometric:
    'Punches are imported from the biometric device. A day with no record is a missing punch.',
  'Geotag (powered by Sowaka)':
    'Employees punch in the app and their location is captured with the time, checked against the office they are tagged to.',
  'Present by default (Auto Punch)':
    'Everyone is marked present without punching. Corrections still apply where a day needs adjusting.',
  'In-app punch in':
    'Employees punch from the app without a location check. The app screens for this are not built yet, so people on it are not punching today.',
};
// What an absent day may be asked to become. A half day has one possible
// answer and it is fixed, so it is not offered here.

export function AttendanceCorrection() {
  const { flash } = useStore();
  const [triggers, setTriggers] = useState<Record<string, boolean>>(
    Object.fromEntries(TRIGGERS.map((t) => [t, true])),
  );
  const [approver, setApprover] = useState('Reporting manager');
  const [punchFormat, setPunchFormat] = useState<PunchFormat>('Present by default (Auto Punch)');
  const [punchMode, setPunchMode] = useState<PunchMode>('Both punches');
  const [absentOutcomes, setAbsentOutcomes] = useState<CorrectionOutcome[]>([...OUTCOMES]);
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
        setPunchMode(correction.punchMode ?? 'Both punches');
        setAbsentOutcomes(correction.absentOutcomes ?? [...OUTCOMES]);
        setMgrWithoutEmployee(correction.managerWithoutEmployee);
        setHrOverride(correction.hrOverride);
        setSkipLevelOverride(correction.skipLevel);
        setBackDays(String(correction.backdateDays));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const singlePunch = punchMode === 'Single punch';
  // Nobody punches on auto punch, so there is no punch to be missing and
  // nothing for the grid below to decide. Every working day is a full day.
  const autoPresent = punchFormat === 'Present by default (Auto Punch)';


  const toggleOutcome = (outcome: CorrectionOutcome) =>
    setAbsentOutcomes((current) =>
      current.includes(outcome)
        ? current.filter((item) => item !== outcome)
        : [...OUTCOMES.filter((item) => current.includes(item) || item === outcome)],
    );

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
          punchMode,
          absentOutcomes,
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
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Attendance correction policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save controls'}
          </button>
        </div>
      </div>

      {/* Asked first: how the punches arrive, and how many of them there are.
          Both answers decide which rows the grid below can even have. */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader
          title="Punch format"
          subtitle="How attendance is captured, and how many punches a day is built from."
        />
        <div style={{ padding: '18px 22px' }}>
          <Field label="Punch in / punch out data comes from">
            <select value={punchFormat} onChange={(e) => setPunchFormat(e.target.value as PunchFormat)} style={{ ...input, maxWidth: 340 }}>
              {PUNCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          {!autoPresent && (
            <Field label="How many punches does a day have?">
              <select value={punchMode} onChange={(e) => setPunchMode(e.target.value as PunchMode)} style={{ ...input, maxWidth: 340 }}>
                <option value="Both punches">Punch in and punch out</option>
                <option value="Single punch">Punch in only</option>
              </select>
            </Field>
          )}
          <div style={note}>
            {FORMAT_NOTES[punchFormat]}{' '}
            {autoPresent
              ? 'Nobody punches, so there is no punch to be missing — every working day is a full day and the grid below does not apply.'
              : singlePunch
              ? 'With one punch a day cannot be graded on hours worked, so a recorded punch counts as a full day.'
              : 'Hours worked are measured between the two punches and graded against the Shift tab’s thresholds.'}{' '}
            This is the org default — a shift template can set a different format for the people it covers.
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader
          title="How a day comes out"
          subtitle={
            autoPresent
              ? 'Every working day, for everyone on this policy.'
              : singlePunch
                ? 'Whether the punch arrived, what the day is marked as, and what the employee may raise against it.'
                : 'The four ways a day can land, what each is marked as, and what the employee may raise against it.'
          }
        />
        <DayOutcomeGrid
          singlePunch={singlePunch}
          autoPresent={autoPresent}
          missingPunchIn={punchIn}
          missingPunchOut={punchOut}
          missingBoth={bothMissing}
          onMissingPunchIn={setPunchIn}
          onMissingPunchOut={setPunchOut}
          onMissingBoth={setBothMissing}
          triggers={triggers}
          onTrigger={(trigger, allowed) => setTriggers((p) => ({ ...p, [trigger]: allowed }))}
          absentOutcomes={absentOutcomes}
          onToggleOutcome={toggleOutcome}
          minHalfDayHours={minHalfDay}
          minFullDayHours={minFullDay}
          thresholdsLocation="the Shift tab’s thresholds"
        />
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
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
