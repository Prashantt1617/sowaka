// Policies › Shift — the org-wide shift rules every Shift Template inherits.
// (Per-shift start/end times live on the template.) Live: saved to the org's
// shift policy, the same document the Half day and Late tabs write to.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy, type DayMark } from '../../services/hrms';

const MARK_OPTIONS: DayMark[] = ['Absent', 'Half Day', 'Present', 'Pending Regularisation'];
const WEEKS = [1, 2, 3, 4, 5];

export function ShiftPolicy() {
  const { flash } = useStore();
  const [punchIn, setPunchIn] = useState<DayMark>('Pending Regularisation');
  const [punchOut, setPunchOut] = useState<DayMark>('Pending Regularisation');
  const [bothMissing, setBothMissing] = useState<DayMark>('Absent');
  const [weekGrid, setWeekGrid] = useState<Record<number, Set<number>>>({
    1: new Set([6]), 2: new Set([6]), 3: new Set([6]), 4: new Set([6]), 5: new Set([6]),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then((policy) => {
        setPunchIn(policy.missingPunchIn);
        setPunchOut(policy.missingPunchOut);
        setBothMissing(policy.missingBoth);
        setWeekGrid(Object.fromEntries(WEEKS.map((w) => [w, new Set(policy.weeklyOff?.[String(w)] ?? [])])));
      })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveShiftPolicy({
        missingPunchIn: punchIn,
        missingPunchOut: punchOut,
        missingBoth: bothMissing,
        weeklyOff: Object.fromEntries(WEEKS.map((w) => [String(w), [...(weekGrid[w] ?? [])]])),
      });
      flash('Shift policy saved');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
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
          These are the org-wide rules every <strong>Shift Template</strong> inherits — this is where the setup is done. Day thresholds, late/early grace and overtime live on their own policy tabs; shift start/end times are set on each template.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <SectionHeader title="Missing punches" />
        <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Punch-in missing — mark as"><Select value={punchIn} onChange={setPunchIn} options={MARK_OPTIONS} /></Field>
          <Field label="Punch-out missing — mark as"><Select value={punchOut} onChange={setPunchOut} options={MARK_OPTIONS} /></Field>
          <Field label="Both punches missing — mark as"><Select value={bothMissing} onChange={setBothMissing} options={MARK_OPTIONS} /></Field>
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
function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly T[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} style={{ ...input, cursor: 'pointer' }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
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
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
