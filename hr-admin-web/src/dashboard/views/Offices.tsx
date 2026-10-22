// Shifts › Offices — where a geotagged punch may be taken from.
//
// An org has as many of these as it has sites. A punch is matched against the
// nearest one, and counts as "here" within the radius. Nothing else on the
// dashboard uses an office: the shift template says whether a team is
// geotagged at all, and what happens when a punch lands outside every office.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyRow, ListPending } from '../ui';
import { IconPlus } from '../icons';
import { IconInfo } from './peopleTable';
import { PdEdit, PdPin, PdTrash } from './pdIcons';
import './people.css';
import {
  createOffice, deleteOffice, getOffices, updateOffice,
  type OfficeDTO, type OfficeInput,
} from '../../services/hrms';

const EMPTY: OfficeInput = { name: '', city: '', latitude: NaN, longitude: NaN, radiusMeters: 200 };

export function Offices() {
  const { flash, setView } = useStore();
  const [offices, setOffices] = useState<OfficeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  // The first load failed: say so, with Retry, rather than "No offices yet".
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** null: list only; '' : adding; an id: editing that office. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<OfficeInput>(EMPTY);

  const reload = () =>
    getOffices()
      .then((o) => { setOffices(o); setFailed(false); })
      .catch((error: Error) => { setFailed(true); flash(error.message); })
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAdd = () => { setForm(EMPTY); setEditing(''); };
  const startEdit = (office: OfficeDTO) => {
    setForm({ name: office.name, city: office.city, latitude: office.latitude, longitude: office.longitude, radiusMeters: office.radiusMeters });
    setEditing(office.id);
  };
  const cancel = () => { setEditing(null); setForm(EMPTY); };

  const save = async () => {
    if (!form.name.trim()) { flash('Give the office a name'); return; }
    if (!Number.isFinite(form.latitude) || Math.abs(form.latitude) > 90) { flash('Latitude must be between -90 and 90'); return; }
    if (!Number.isFinite(form.longitude) || Math.abs(form.longitude) > 180) { flash('Longitude must be between -180 and 180'); return; }
    if (!Number.isFinite(form.radiusMeters) || form.radiusMeters < 20) { flash('Radius must be at least 20 metres'); return; }
    setSaving(true);
    try {
      const input = { ...form, name: form.name.trim(), city: form.city.trim() };
      const saved = editing ? await updateOffice(editing, input) : await createOffice(input);
      await reload();
      flash(`${saved.name} saved`);
      cancel();
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (office: OfficeDTO) => {
    if (!window.confirm(`Remove ${office.name}? Punches already taken there keep their record.`)) return;
    try {
      await deleteOffice(office.id);
      if (editing === office.id) cancel();
      await reload();
      flash(`${office.name} removed`);
    } catch (error) {
      flash((error as Error).message);
    }
  };

  /** Pasted from Google Maps as "28.4595, 77.0266" — both numbers in one go. */
  const pastePair = (text: string) => {
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return false;
    setForm((f) => ({ ...f, latitude: Number(match[1]), longitude: Number(match[2]) }));
    return true;
  };

  return (
    <div>
      <div className="pd-head" style={{ alignItems: 'center' }}>
        <p className="pd-lead">{offices.length} {offices.length === 1 ? 'office' : 'offices'}</p>
        <div className="pd-actions">
          <button onClick={() => (editing === '' ? cancel() : startAdd())} className="pd-btn primary">
            <IconPlus size={15} /> Add office
          </button>
        </div>
      </div>

      <div className="pd-note" style={{ marginBottom: 20 }}>
        <IconInfo />
        <span>
          A punch on a <strong>geotagged</strong> shift is checked against the nearest office here and counts as present
          within its radius. Turn geotag on per shift under <button onClick={() => setView('shifttypes')} style={linkBtn}>Templates</button>,
          where you also choose what happens when someone punches from outside every office.
        </span>
      </div>

      {editing !== null && (
        <section className="pd-card pd-form" style={{ marginBottom: 20, padding: 0 }}>
          <div className="pd-md-h">
            <h3>{editing ? 'Edit office' : 'New office'}</h3>
            <button onClick={cancel} aria-label="Close" title="Close" style={closeBtn}>×</button>
          </div>
          <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 150px', gap: 16, alignItems: 'end' }}>
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Gurgaon office" style={inputStyle} />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Gurgaon" style={inputStyle} />
            </Field>
            <Field label="Latitude">
              <input
                type="number" step="any" value={Number.isFinite(form.latitude) ? form.latitude : ''}
                onChange={(e) => setForm({ ...form, latitude: e.target.value === '' ? NaN : Number(e.target.value) })}
                onPaste={(e) => { if (pastePair(e.clipboardData.getData('text'))) e.preventDefault(); }}
                placeholder="28.4595" style={inputStyle}
              />
            </Field>
            <Field label="Longitude">
              <input
                type="number" step="any" value={Number.isFinite(form.longitude) ? form.longitude : ''}
                onChange={(e) => setForm({ ...form, longitude: e.target.value === '' ? NaN : Number(e.target.value) })}
                onPaste={(e) => { if (pastePair(e.clipboardData.getData('text'))) e.preventDefault(); }}
                placeholder="77.0266" style={inputStyle}
              />
            </Field>
            <Field label="Radius">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="20" step="10" value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) || 0 })} style={{ ...inputStyle, width: 84 }} />
                <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>m</span>
              </div>
            </Field>
          </div>
          <div className="pd-note" style={{ marginTop: 16 }}>
            <IconInfo />
            <span>
              Right-click the building in Google Maps and copy the coordinates; pasting “28.4595, 77.0266” into either box fills both.
              A phone indoors is often 50–80 m off, so 200 m covers a building and its car park without reaching the next street.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={cancel} disabled={saving} className="pd-btn">Cancel</button>
            <button onClick={() => void save()} disabled={saving} className="pd-btn primary">{saving ? 'Saving…' : editing ? 'Save changes' : 'Add office'}</button>
          </div>
          </div>
        </section>
      )}

      <section className="pd-card">
        {loading || (failed && offices.length === 0) ? (
          <ListPending state={loading ? 'loading' : 'error'} onRetry={() => { setLoading(true); void reload(); }} rows={3} cols={5} avatar={false} rowHeight={52} />
        ) : offices.length === 0 ? (
          <EmptyRow text="No offices yet. Add one so geotagged punches have somewhere to be checked against." />
        ) : (
          <table className="pd-t">
            <thead>
              <tr><Th>Office</Th><Th>City</Th><Th>Coordinates</Th><Th>Radius</Th><Th right> </Th></tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <span className="pd-who">
                      <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', flex: 'none' }}><PdPin size={15} /></span>
                      <b>{o.name}</b>
                    </span>
                  </Td>
                  <Td>{o.city || '—'}</Td>
                  <Td mono>
                    <a href={`https://maps.google.com/?q=${o.latitude},${o.longitude}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)', textDecoration: 'none', fontSize: 13 }}>
                      {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)}
                    </a>
                  </Td>
                  <Td>{o.radiusMeters} m</Td>
                  <Td right>
                    <span className="pd-acts">
                      <button onClick={() => startEdit(o)} className="pd-btn sm"><PdEdit size={15} /> Edit</button>
                      <button onClick={() => void remove(o)} className="pd-btn sm" title={`Remove ${o.name}`}><PdTrash size={15} /> Remove</button>
                    </span>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, marginBottom: 6, color: 'var(--ink-2)' }}>{label}</label>
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

const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer' };
const inputStyle: CSSProperties = { width: '100%', height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' };
const closeBtn: CSSProperties = { marginLeft: 'auto', width: 42, height: 42, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 20, lineHeight: 1, color: 'var(--ink-2)', cursor: 'pointer', padding: 0 };
