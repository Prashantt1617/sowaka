// Holiday Bank — the org's master list. A holiday is assigned to employees by
// their work LOCATION, and by nothing else: not the shift, not the department.
// A holiday is a non-working day the same way a week-off is, so leave spanning
// one is not charged for it.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyRow, ListPending } from '../ui';
import { IconPlus } from '../icons';
import { IconInfo } from './peopleTable';
import { PdPin, PdTrash } from './pdIcons';
import './people.css';
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
  Public: { bg: 'var(--p-green)', fg: '#fff' },
  Restricted: { bg: 'var(--p-yellow)', fg: 'var(--p-yellow-ink)' },
  Optional: { bg: 'var(--p-blue)', fg: '#fff' },
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
  // The first load failed: say so, with Retry, rather than "No holidays".
  const [failed, setFailed] = useState(false);
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
      .then((h) => { setHolidays(h); setFailed(false); })
      .catch((error: Error) => { setFailed(true); flash(error.message); })
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
      <div className="pd-head" style={{ alignItems: 'center' }}>
        <div className="pd-actions">
          <label className="pd-field" style={{ width: 220, paddingRight: 8 }}>
            <PdPin size={15} />
            <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
              <option value="All">All locations</option>
              {locations.map((l) => <option key={l} value={l}>{label(l)}</option>)}
            </select>
          </label>
          <p className="pd-lead">Calendar year {year}</p>
        </div>
        <div className="pd-actions">
          <button onClick={() => (adding ? cancelAdd() : setAdding(true))} className="pd-btn primary">
            <IconPlus size={15} /> Add holiday
          </button>
        </div>
      </div>

      <div className="pd-note" style={{ marginBottom: 20 }}>
        <IconInfo />
        <span>
          This is the org-wide holiday master. Each holiday is assigned to employees by their <strong>work location</strong> — “{ALL}” applies to everyone. A holiday is a non-working day the same way a week-off is: leave spanning one is not charged for it.
        </span>
      </div>

      {adding && (
        <section className="pd-card pd-form" style={{ marginBottom: 20, padding: 0 }}>
          <div className="pd-md-h">
            <h3>New holiday</h3>
            <button onClick={cancelAdd} aria-label="Close" title="Close" style={closeBtn}>×</button>
          </div>
          <div style={{ padding: 20 }}>
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
            <button onClick={() => void add()} disabled={saving} className="pd-btn primary" style={{ marginBottom: 1 }}>
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button onClick={cancelAdd} disabled={saving} className="pd-btn" style={{ marginBottom: 1 }}>Cancel</button>
          </div>
          </div>
        </section>
      )}

      <section className="pd-card">
        {loading || (failed && holidays.length === 0) ? (
          <ListPending state={loading ? 'loading' : 'error'} onRetry={() => { setLoading(true); void reload(); }} rows={6} cols={5} avatar={false} rowHeight={48} />
        ) : rows.length === 0 ? (
          <EmptyRow text="No holidays for this location yet." />
        ) : (
          <table className="pd-t">
            <thead>
              <tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th><Th>Location</Th><Th>Type</Th><Th right> </Th></tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <Td mono>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <span className="pd-datechip" aria-hidden>
                        <small>{new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</small>
                        <b>{Number(h.date.slice(8))}</b>
                      </span>
                      {fmtDate(h.date)}
                    </span>
                  </Td>
                  <Td muted>{weekday(h.date)}</Td>
                  <Td><b>{h.name}</b></Td>
                  <Td>{h.state === ALL_LOCATIONS ? <span>{label(h.state)}</span> : <span className="pd-tag">{label(h.state)}</span>}</Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, padding: '3px 10px', borderRadius: 99, background: TYPE_TONE[h.type].bg, color: TYPE_TONE[h.type].fg }}>
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.85 }} />{h.type}
                    </span>
                  </Td>
                  <Td right>
                    <button onClick={() => void remove(h)} className="pd-btn sm" title={`Remove ${h.name}`}><PdTrash size={15} /> Remove</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, marginBottom: 6, color: 'var(--ink-2)' }}>{text}</label>
      {children}
    </div>
  );
}
function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left' }}>{children}</th>;
}
function Td({ children, muted, mono, right }: { children: ReactNode; muted?: boolean; mono?: boolean; right?: boolean }) {
  return <td style={{ color: muted ? 'var(--ink-3)' : 'var(--ink)', textAlign: right ? 'right' : undefined, fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const selectStyle: CSSProperties = { height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', boxSizing: 'border-box' };
const inputStyle: CSSProperties = { width: '100%', height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' };
const closeBtn: CSSProperties = { marginLeft: 'auto', width: 42, height: 42, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 20, lineHeight: 1, color: 'var(--ink-2)', cursor: 'pointer', padding: 0 };
