// Holiday Bank — the org's master list. A holiday is assigned to employees by
// their work LOCATION, and by nothing else: not the shift, not the department.
// A holiday is a non-working day the same way a week-off is, so leave spanning
// one is not charged for it.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { IconPlus } from '../icons';
import {
  ALL_LOCATIONS, createHoliday, deleteHoliday, getAllEmployees, getHolidays,
  type HolidayDTO, type HolidayType,
} from '../../services/hrms';

const ALL = 'All locations';
const TYPES: HolidayType[] = ['Public', 'Restricted', 'Optional'];

/** Stored lowercase; shown the way it was typed as far as we can. */
const label = (state: string) =>
  state === ALL_LOCATIONS ? ALL : state.replace(/\b\w/g, (c) => c.toUpperCase());

const TYPE_TONE: Record<HolidayType, { bg: string; fg: string }> = {
  Public: { bg: '#E4EDE0', fg: '#4F7A52' },
  Restricted: { bg: '#F6E9D5', fg: '#9A6B25' },
  Optional: { bg: '#E7ECF4', fg: '#4A6FA5' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function weekday(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

export function HolidayBank() {
  const { flash } = useStore();
  const [location, setLocation] = useState('All');
  const [holidays, setHolidays] = useState<HolidayDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const year = String(new Date().getFullYear());

  // New-holiday form.
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState(ALL_LOCATIONS);
  const [type, setType] = useState<HolidayType>('Public');
  /** Work locations on the roster, so a holiday can only target a real one. */
  const [orgLocations, setOrgLocations] = useState<string[]>([]);

  const reload = () =>
    getHolidays()
      .then(setHolidays)
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    getAllEmployees()
      .then((people) =>
        setOrgLocations(
          Array.from(new Set(people.map((p) => (p.location ?? '').trim()).filter(Boolean))).sort(),
        ),
      )
      .catch(() => setOrgLocations([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locations = useMemo(
    () => Array.from(new Set([
      ...holidays.map((h) => h.state).filter((s) => s !== ALL_LOCATIONS),
      ...orgLocations.map((l) => l.toLowerCase()),
    ])).sort(),
    [holidays, orgLocations],
  );
  const rows = useMemo(
    () => holidays
      .filter((h) => location === 'All' || h.state === location || h.state === ALL_LOCATIONS)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [holidays, location],
  );

  /** Leaves the form as it was found, so reopening it starts clean. */
  const cancelAdd = () => {
    setAdding(false); setDate(''); setName(''); setState(ALL_LOCATIONS); setType('Public');
  };

  const add = async () => {
    if (!date) { flash('Pick a date'); return; }
    if (!name.trim()) { flash('Give the holiday a name'); return; }
    setSaving(true);
    try {
      await createHoliday({ date, name: name.trim(), state, type });
      await reload();
      flash(`${name.trim()} added for ${label(state)}`);
      cancelAdd();
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (holiday: HolidayDTO) => {
    if (!window.confirm(`Remove ${holiday.name} (${label(holiday.state)})?`)) return;
    try {
      await deleteHoliday(holiday.id);
      await reload();
      flash(`${holiday.name} removed`);
    } catch (error) {
      flash((error as Error).message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <select value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...selectStyle, width: 220 }}>
          <option value="All">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{label(l)}</option>)}
        </select>
        <div style={{ fontSize: 14, color: '#717171' }}>Calendar year {year}</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => (adding ? cancelAdd() : setAdding(true))} style={primaryBtn}>
            <IconPlus size={15} /> Add holiday
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        This is the org-wide holiday master. Each holiday is assigned to employees by their <strong>work location</strong> — “{ALL}” applies to everyone. A holiday is a non-working day the same way a week-off is: leave spanning one is not charged for it.
      </div>

      {adding && (
        <Card style={{ padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#222222' }}>New holiday</div>
            <button onClick={cancelAdd} aria-label="Close" title="Close" style={closeBtn}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 200px 150px auto auto', gap: 12, alignItems: 'end' }}>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Holiday">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" style={inputStyle} />
            </Field>
            <Field label="Location">
              <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                <option value={ALL_LOCATIONS}>{ALL}</option>
                {locations.map((l) => <option key={l} value={l}>{label(l)}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value as HolidayType)} style={{ ...selectStyle, width: '100%' }}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <button onClick={() => void add()} disabled={saving} style={{ ...primaryBtn, marginBottom: 1 }}>
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button onClick={cancelAdd} disabled={saving} style={{ ...ghostBtn, marginBottom: 1 }}>Cancel</button>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <EmptyRow text="Loading holidays…" />
        ) : rows.length === 0 ? (
          <EmptyRow text="No holidays for this location yet." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th><Th>Location</Th><Th>Type</Th><Th> </Th></tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <Td mono>{fmtDate(h.date)}</Td>
                  <Td muted>{weekday(h.date)}</Td>
                  <Td><strong style={{ color: '#222222' }}>{h.name}</strong></Td>
                  <Td muted>{label(h.state)}</Td>
                  <Td>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: TYPE_TONE[h.type].bg, color: TYPE_TONE[h.type].fg }}>{h.type}</span>
                  </Td>
                  <Td>
                    <button onClick={() => void remove(h)} style={removeBtn} title={`Remove ${h.name}`}>Remove</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{text}</label>
      {children}
    </div>
  );
}
function Th({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, mono }: { children: ReactNode; muted?: boolean; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const selectStyle: CSSProperties = { padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const removeBtn: CSSProperties = { background: 'none', border: 'none', padding: '4px 6px', font: 'inherit', fontSize: 14, fontWeight: 700, color: '#C4382E', cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer' };
const closeBtn: CSSProperties = { marginLeft: 'auto', background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: '#9197A2', cursor: 'pointer', padding: '0 4px' };
