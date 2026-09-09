// Policies › Shift — the org-wide shift rules every Shift Template inherits.
// (Per-shift start/end times live on the template.) Live: saved to the org's
// shift policy, the same document the Half day and Late tabs write to.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';

const WEEKS = [1, 2, 3, 4, 5];

export function ShiftPolicy() {
  const { flash } = useStore();
  const [weekGrid, setWeekGrid] = useState<Record<number, Set<number>>>({
    1: new Set([6]), 2: new Set([6]), 3: new Set([6]), 4: new Set([6]), 5: new Set([6]),
  });
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [minHalfDay, setMinHalfDay] = useState('4');
  const [minFullDay, setMinFullDay] = useState('8');
  const [lateAfter, setLateAfter] = useState('10');
  const [earlyOut, setEarlyOut] = useState('10');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then((policy) => {
        setWeekGrid(Object.fromEntries(WEEKS.map((w) => [w, new Set(policy.weeklyOff?.[String(w)] ?? [])])));
        setStart(policy.startTime);
        setEnd(policy.endTime);
        setMinHalfDay(String(policy.minHalfDayHours));
        setMinFullDay(String(policy.minFullDayHours));
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
        weeklyOff: Object.fromEntries(WEEKS.map((w) => [String(w), [...(weekGrid[w] ?? [])]])),
        startTime: start,
        endTime: end,
        minHalfDayHours: Number(minHalfDay),
        minFullDayHours: Number(minFullDay),
        lateGraceMinutes: Number(lateAfter),
        earlyOutGraceMinutes: Number(earlyOut),
      });
      flash(`Saved — a full day is ${minFullDay}h, and an arrival is late after ${lateAfter} min`);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const startMins = toMinutes(start);
  const endMins = toMinutes(end);
  let windowMins: number | null = null;
  let overnight = false;
  if (startMins != null && endMins != null) {
    windowMins = endMins - startMins;
    if (windowMins <= 0) { windowMins += 24 * 60; overnight = true; }
  }
  const windowLabel = windowMins == null ? '—' : `${Math.floor(windowMins / 60)}h ${String(windowMins % 60).padStart(2, '0')}m`;

  const toggleWeekCell = (w: number, d: number) =>
    setWeekGrid((prev) => {
      const cur = new Set(prev[w] ?? []);
      if (cur.has(d)) cur.delete(d);
      else cur.add(d);
      return { ...prev, [w]: cur };
    });
  const cellActive = (w: number, d: number) => weekGrid[w]?.has(d) ?? false;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 600 }}>Global shift policy</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => void save()} disabled={saving || loading} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '13px 16px', marginBottom: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          These are the org-wide rules every <strong>Shift Template</strong> inherits — this is where the setup is done, and what the app grades every attendance day against. What a missing punch is marked as sits on the <strong>Attendance correction</strong> tab, since that is what raises a correction; shift start/end times are set on each template.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Working window" subtitle="When the shift opens and closes. Lateness and early-outs are measured against these." />
        <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="Shift start time (in)"><input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} style={timeInput} /></Field>
          <Field label="Shift end time (out)"><input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} style={timeInput} /></Field>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6, color: '#484848' }}>Duration</label>
            <div style={durationBox}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>{windowLabel}</span>
              {overnight && <span style={overnightTag}>overnight · +1 day</span>}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Day thresholds" subtitle="Worked hours that earn a half day and a full day." />
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

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Late & early grace" subtitle="Measured against the start & end times of the shift the employee is on." />
        <div style={{ padding: '18px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Mark as late if late by"><Suffixed value={lateAfter} onChange={setLateAfter} suffix="min" /></Field>
            <Field label="Mark early-out if leaves early by"><Suffixed value={earlyOut} onChange={setEarlyOut} suffix="min" /></Field>
          </div>
          <div style={note}>
            On this {start}–{end} shift, arriving after {clock(start, Number(lateAfter) || 0)} is late,
            and leaving before {clock(end, -(Number(earlyOut) || 0))} is an early-out.
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader title="Weekly-off" subtitle="Default off day(s) per week — a template can override this." />
        <div style={{ padding: '18px 22px', overflowX: 'auto' }}>
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
      </Card>
    </div>
  );
}

/** "HH:MM" -> minutes since midnight, or null if malformed. */
function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** A shift time plus a signed number of minutes, for the worked examples. */
function clock(base: string, delta: number): string {
  const at = toMinutes(base);
  if (at == null) return '—';
  const shifted = (at + delta + 24 * 60) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

function Suffixed({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff' }}>
      <input type="number" min="0" step={suffix === 'hrs' ? '0.5' : '1'} value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>{suffix}</span>
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
  return { width: 30, height: 30, borderRadius: 8, border: `1px solid ${active ? '#0571A6' : '#DADFE4'}`, background: active ? '#0571A6' : '#fff', cursor: 'pointer', display: 'inline-block' };
}
const rowHead: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#333333', paddingRight: 14, whiteSpace: 'nowrap' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const note: CSSProperties = { marginTop: 16, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const timeInput: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const durationBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', minHeight: 40, border: '1px solid #E7F0F5', borderRadius: 9, background: '#F1F8FC', whiteSpace: 'nowrap' };
const overnightTag: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#8A6D1F', background: '#FBF3DD', borderRadius: 20, padding: '2px 9px' };
