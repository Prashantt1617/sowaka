// Shifts › Templates — a template is a named working window, and the vehicle a
// policy is assigned to people by. It carries no rules of its own: the
// thresholds, grace, missing-punch marks and weekly-off all come from the org
// policy saved under Shifts › Policies, and are shown here as HR saved them.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import {
  createShift, deleteShift as deleteShiftApi, getShiftPolicy, getShifts, updateShift,
  type ShiftDTO, type ShiftPolicyDTO,
} from '../../services/hrms';

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
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
/** "09:00" plus a signed number of minutes, for the worked examples below. */
function clock(base: string, delta: number): string {
  const at = toMinutes(base);
  if (at == null) return '—';
  const shifted = (at + delta + 24 * 60) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
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

export function ShiftTemplates() {
  const { flash, setView } = useStore();
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [policy, setPolicy] = useState<ShiftPolicyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** The template being edited, or null while creating a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');

  const reload = () =>
    Promise.all([getShifts(), getShiftPolicy()])
      .then(([rows, saved]) => { setShifts(rows); setPolicy(saved); })
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTemplate = (t: ShiftDTO) => {
    setEditingId(t.id);
    setName(t.name);
    setActive(t.active);
    setIsDefault(t.isDefault);
    setStart(t.startTime);
    setEnd(t.endTime);
    setMode('edit');
  };

  const newTemplate = () => {
    setEditingId(null);
    setName('');
    setActive(true);
    // The org's first template becomes the default whatever this says — the
    // backend makes sure the app always has one window to measure against.
    setIsDefault(shifts.length === 0);
    setStart('09:00');
    setEnd('18:00');
    setMode('edit');
  };

  const save = async () => {
    if (!name.trim()) { flash('Give the shift a name'); return; }
    setSaving(true);
    try {
      const input = { name: name.trim(), active, isDefault, startTime: start, endTime: end };
      if (editingId) await updateShift(editingId, input);
      else await createShift(input);
      await reload();
      flash(`Shift saved — ${input.startTime}–${input.endTime}`);
      setMode('list');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    if (!window.confirm(`Delete the "${name}" shift?`)) return;
    setSaving(true);
    try {
      await deleteShiftApi(editingId);
      await reload();
      flash('Shift deleted');
      setMode('list');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const s = toMinutes(start);
  const e = toMinutes(end);
  let durationMins: number | null = null;
  let overnight = false;
  if (s != null && e != null) {
    durationMins = e - s;
    if (durationMins <= 0) { durationMins += 24 * 60; overnight = true; }
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
              {shifts.map((t) => {
                const sm = toMinutes(t.startTime);
                const em = toMinutes(t.endTime);
                let d = sm != null && em != null ? em - sm : 0;
                if (d <= 0) d += 24 * 60;
                return (
                  <tr key={t.id} onClick={() => openTemplate(t)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <strong style={{ color: '#0571A6' }}>{t.name}</strong>
                      {t.isDefault && <span style={defaultPill}>Default</span>}
                    </Td>
                    <Td muted>{t.startTime} – {t.endTime} · {formatDuration(d)}</Td>
                    <Td><StatusText on={t.active} /></Td>
                  </tr>
                );
              })}
              {!loading && shifts.length === 0 && (
                <tr>
                  <td colSpan={3} style={emptyCell}>
                    No shifts yet. Create one to give the org a working window —
                    the rules it is graded by are set under Shifts › Policies.
                  </td>
                </tr>
              )}
              {loading && <tr><td colSpan={3} style={emptyCell}>Loading…</td></tr>}
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
          {editingId && <button onClick={() => void remove()} disabled={saving} style={dangerBtn}>Delete</button>}
          <button onClick={() => void save()} disabled={saving} style={primaryBtn}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      <Card style={{ padding: '16px 20px', marginBottom: 14 }}>
        <Field label="Shift Name" required>
          <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. General Day, Night Shift" style={input} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="Shift Start Time"><input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} style={input} /></Field>
          <Field label="Shift End Time"><input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} style={input} /></Field>
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabel}>Duration</label>
            <div style={durationBox}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0571A6', fontVariantNumeric: 'tabular-nums' }}>
                {durationMins != null ? formatDuration(durationMins) : '—'}
              </span>
              {overnight && <span style={overnightTag}>overnight · +1 day</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <label style={checkRow}>
            <input type="checkbox" checked={active} onChange={(ev) => setActive(ev.target.checked)} /> Active
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={isDefault} onChange={(ev) => setIsDefault(ev.target.checked)} /> Default shift
          </label>
        </div>
        <div style={{ fontSize: 13, color: '#717171', marginTop: 8, lineHeight: 1.5 }}>
          Everyone is measured against the default shift’s window until shifts are assigned per employee.
        </div>
      </Card>

      {/* What this shift inherits. Read-only on purpose — one place to change it. */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>Policy this shift follows</div>
            <div style={{ fontSize: 13, color: '#717171', marginTop: 2 }}>
              As saved under Shifts › Policies. Changing it there changes it for every shift.
            </div>
          </div>
          <button onClick={() => setView('policies')} style={ghostBtn}>Edit in Policies</button>
        </div>
        <div style={{ padding: '4px 20px 18px' }}>
          {!policy ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: '#9197A2', fontSize: 15 }}>Loading policy…</div>
          ) : (
            <>
              <SubLabel>Half day &amp; full day</SubLabel>
              <Readout rows={[
                ['Min hours for half day', `${policy.minHalfDayHours} hrs`],
                ['Min hours for full day', `${policy.minFullDayHours} hrs`],
              ]} />
              <div style={note}>
                On this shift, {policy.minFullDayHours}h or more is a full day; {policy.minHalfDayHours}h up
                to {policy.minFullDayHours}h is a half day; anything shorter is flagged for correction.
              </div>

              <SubLabel>Late &amp; early grace</SubLabel>
              <Readout rows={[
                ['Mark as late if late by', `${policy.lateGraceMinutes} min`],
                ['Mark early-out if leaves early by', `${policy.earlyOutGraceMinutes} min`],
              ]} />
              <div style={note}>
                On this shift, arriving after {clock(start, policy.lateGraceMinutes)} is late, and leaving
                before {clock(end, -policy.earlyOutGraceMinutes)} is an early-out.
              </div>

              <SubLabel>Missing punches</SubLabel>
              <Readout rows={[
                ['Punch-in missing', policy.missingPunchIn],
                ['Punch-out missing', policy.missingPunchOut],
                ['Both punches missing', policy.missingBoth],
              ]} />

              <SubLabel>Weekly-off</SubLabel>
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
                            <span style={cell(policy.weeklyOff?.[String(w)]?.includes(dw.key) ?? false)} title={`${dw.long} — week ${w}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Holidays are not configured on the shift — they come from the Holiday Bank master, by location. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 12, padding: '14px 16px', marginTop: 16 }}>
        <span style={{ fontSize: 16, lineHeight: 1.3 }}>ℹ️</span>
        <div style={{ fontSize: 14, color: '#3A5A6B', lineHeight: 1.55 }}>
          <strong>Holidays aren’t set on the shift.</strong> They’re assigned automatically from the{' '}
          <strong>Holiday Bank</strong> master based on each employee’s work location — so the same shift
          observes different holidays across locations.
        </div>
      </div>
    </div>
  );
}

function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ border: '1px solid #EDEDF0', borderRadius: 10, overflow: 'hidden' }}>
      {rows.map(([label, value], index) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 14px', borderTop: index === 0 ? 'none' : '1px solid #F4F4F6' }}>
          <div style={{ flex: 1, fontSize: 15, color: '#484848' }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}
function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '18px 0 8px' }}>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}{required && <span style={{ color: '#C4382E' }}> *</span>}</label>
      {children}
    </div>
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

const cell = (on: boolean): CSSProperties => ({
  width: 30, height: 30, borderRadius: 8, display: 'inline-block',
  border: `1px solid ${on ? '#0571A6' : '#DADFE4'}`, background: on ? '#0571A6' : '#fff',
});
const rowHead: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#333333', paddingRight: 14, whiteSpace: 'nowrap' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const emptyCell: CSSProperties = { padding: '44px 20px', textAlign: 'center', color: '#9197A2', fontSize: 15 };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const dangerBtn: CSSProperties = { background: '#fff', color: '#C4382E', border: '1px solid #F0D6D3', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const defaultPill: CSSProperties = { marginLeft: 8, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#4F7A52', background: '#EAF3EA', border: '1px solid #D6E8D6', borderRadius: 20, padding: '2px 9px' };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const durationBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', minHeight: 40, border: '1px solid #E7F0F5', borderRadius: 9, background: '#F1F8FC', whiteSpace: 'nowrap' };
const overnightTag: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#8A6D1F', background: '#FBF3DD', borderRadius: 20, padding: '2px 9px' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#333333', cursor: 'pointer' };
const note: CSSProperties = { marginTop: 10, fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
