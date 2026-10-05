// Shifts › Offices — where a geotagged punch may be taken from.
//
// An org has as many of these as it has sites. A punch is matched against the
// nearest one, and counts as "here" within the radius. Nothing else on the
// dashboard uses an office: the shift template says whether a team is
// geotagged at all, and what happens when a punch lands outside every office.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { IconPlus } from '../icons';
import {
  createOffice, deleteOffice, getOffices, updateOffice,
  type OfficeDTO, type OfficeInput,
} from '../../services/hrms';

const EMPTY: OfficeInput = { name: '', city: '', latitude: NaN, longitude: NaN, radiusMeters: 200 };

export function Offices() {
  const { flash, setView } = useStore();
  const [offices, setOffices] = useState<OfficeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** null: list only; '' : adding; an id: editing that office. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<OfficeInput>(EMPTY);

  const reload = () =>
    getOffices()
      .then(setOffices)
      .catch((error: Error) => flash(error.message))
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>{offices.length} {offices.length === 1 ? 'office' : 'offices'}</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => (editing === '' ? cancel() : startAdd())} style={primaryBtn}>
            <IconPlus size={15} /> Add office
          </button>
        </div>
      </div>

      <div style={note}>
        A punch on a <strong>geotagged</strong> shift is checked against the nearest office here and counts as present
        within its radius. Turn geotag on per shift under <button onClick={() => setView('shifttypes')} style={linkBtn}>Templates</button>,
        where you also choose what happens when someone punches from outside every office.
      </div>

      {editing !== null && (
        <Card style={{ padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#222222' }}>{editing ? 'Edit office' : 'New office'}</div>
            <button onClick={cancel} aria-label="Close" title="Close" style={closeBtn}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 150px', gap: 12, alignItems: 'end' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                <input type="number" min="20" step="10" value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) || 0 })} style={{ ...inputStyle, border: 'none', borderRadius: 0 }} />
                <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14 }}>m</span>
              </div>
            </Field>
          </div>
          <div style={{ fontSize: 13, color: '#717171', marginTop: 8, lineHeight: 1.5 }}>
            Right-click the building in Google Maps and copy the coordinates; pasting “28.4595, 77.0266” into either box fills both.
            A phone indoors is often 50–80 m off, so 200 m covers a building and its car park without reaching the next street.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={() => void save()} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add office'}</button>
            <button onClick={cancel} disabled={saving} style={ghostBtn}>Cancel</button>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <EmptyRow text="Loading offices…" />
        ) : offices.length === 0 ? (
          <EmptyRow text="No offices yet. Add one so geotagged punches have somewhere to be checked against." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><Th>Office</Th><Th>City</Th><Th>Coordinates</Th><Th>Radius</Th><Th> </Th></tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <Td><strong style={{ color: '#222222' }}>{o.name}</strong></Td>
                  <Td muted>{o.city || '—'}</Td>
                  <Td mono>
                    <a href={`https://maps.google.com/?q=${o.latitude},${o.longitude}`} target="_blank" rel="noreferrer" style={{ color: '#0571A6', textDecoration: 'none' }}>
                      {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)}
                    </a>
                  </Td>
                  <Td muted>{o.radiusMeters} m</Td>
                  <Td>
                    <button onClick={() => startEdit(o)} style={editBtn}>Edit</button>
                    <button onClick={() => void remove(o)} style={removeBtn} title={`Remove ${o.name}`}>Remove</button>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{label}</label>
      {children}
    </div>
  );
}
function Th({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, mono }: { children: ReactNode; muted?: boolean; mono?: boolean }) {
  return <td style={{ padding: '13px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const note: CSSProperties = { fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: '#0571A6', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const editBtn: CSSProperties = { background: 'none', border: 'none', padding: '4px 6px', font: 'inherit', fontSize: 14, fontWeight: 700, color: '#0571A6', cursor: 'pointer' };
const removeBtn: CSSProperties = { background: 'none', border: 'none', padding: '4px 6px', font: 'inherit', fontSize: 14, fontWeight: 700, color: '#C4382E', cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer' };
const closeBtn: CSSProperties = { marginLeft: 'auto', background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: '#9197A2', cursor: 'pointer', padding: '0 4px' };
