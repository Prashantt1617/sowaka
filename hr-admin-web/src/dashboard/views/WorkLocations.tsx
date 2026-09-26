// Organisation › Work locations — the physical sites employees are mapped to.
// A location's state drives its statutory rules (PT, LWF); one location is the
// registered/filing address.
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Card } from '../ui';
import { IconPlus } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { useStore } from '../store';

type WorkLocation = {
  id: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  employees: number;
  status: 'active' | 'inactive';
  filingAddress?: boolean;
};

// —— Mock data for capture ————————————————————————————————————————————
const LOCATIONS: WorkLocation[] = [
  {
    id: 'hq',
    name: 'Head Office — Bengaluru',
    line1: 'WeWork Prestige Central, 3rd Floor',
    line2: '36 Infantry Road, Tasker Town',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    country: 'India',
    employees: 42,
    status: 'active',
    filingAddress: true,
  },
  {
    id: 'mum',
    name: 'Mumbai Sales Office',
    line1: 'Level 2, Trade World, B Wing',
    line2: 'Kamala Mills, Lower Parel',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400013',
    country: 'India',
    employees: 9,
    status: 'active',
  },
  {
    id: 'ncr',
    name: 'Delhi NCR Hub',
    line1: 'Tower B, DLF Cyber City',
    line2: 'Sector 24, Gurugram',
    city: 'Gurugram',
    state: 'Haryana',
    pincode: '122002',
    country: 'India',
    employees: 14,
    status: 'active',
  },
  {
    id: 'remote',
    name: 'Remote — India',
    line1: 'No fixed office',
    line2: 'Employees working from home across India',
    city: '—',
    state: 'Karnataka',
    pincode: '—',
    country: 'India',
    employees: 6,
    status: 'inactive',
  },
];

// One Delhi campus, with everyone on the roster mapped to it.
const acmtLocations = (headcount: number): WorkLocation[] => [{
  id: 'campus',
  name: 'ACMT Campus — Delhi',
  line1: 'ACMT Campus, Sector 20',
  line2: 'Near Metro Station',
  city: 'New Delhi',
  state: 'Delhi',
  pincode: '110001',
  country: 'India',
  employees: headcount,
  status: 'active',
  filingAddress: true,
}];

const IN_STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

type Draft = { name: string; line1: string; line2: string; city: string; state: string; pincode: string; filingAddress: boolean; active: boolean };
const EMPTY_DRAFT: Draft = { name: '', line1: '', line2: '', city: '', state: '', pincode: '', filingAddress: false, active: true };

export function WorkLocations() {
  const { user } = useAuth();
  const { emps, flash } = useStore();
  // Seeded per organisation; additions live in this tab only — nothing is sent anywhere yet.
  const [locations, setLocations] = useState<WorkLocation[]>(() =>
    user?.org === 'acmt' ? acmtLocations(emps.length) : LOCATIONS,
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const setD = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const missing = {
    name: !draft.name.trim(), line1: !draft.line1.trim(), city: !draft.city.trim(),
    state: !draft.state, pincode: !/^\d{6}$/.test(draft.pincode),
  };
  const addLocation = () => {
    setTouched(true);
    if (Object.values(missing).some(Boolean)) return;
    const next: WorkLocation = {
      id: `loc-${Date.now()}`, name: draft.name.trim(), line1: draft.line1.trim(), line2: draft.line2.trim() || undefined,
      city: draft.city.trim(), state: draft.state, pincode: draft.pincode, country: 'India', employees: 0,
      status: draft.active ? 'active' : 'inactive', filingAddress: draft.filingAddress,
    };
    // Only one location can be the filing address.
    setLocations((ls) => [...(next.filingAddress ? ls.map((l) => ({ ...l, filingAddress: false })) : ls), next]);
    setDraft(EMPTY_DRAFT); setTouched(false); setAdding(false);
    flash(`${next.name} added`);
  };
  const total = locations.length;
  const mapped = locations.reduce((s, l) => s + l.employees, 0);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, color: '#717171' }}>
            {total} locations · {mapped} employees mapped
          </div>
        </div>
        <button type="button" onClick={() => setAdding(true)} disabled={adding} style={{ ...primaryBtn, marginLeft: 'auto', opacity: adding ? 0.6 : 1 }}><IconPlus size={15} /> Add work location</button>
      </div>

      {adding && (
        <Card style={{ padding: '18px 20px', marginBottom: 14, border: '1px solid #BFDCEB' }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>New work location</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Location name" required error={touched && missing.name} full>
              <input value={draft.name} onChange={(e) => setD('name', e.target.value)} placeholder="e.g. Noida Campus" style={inputStyle} />
            </FormField>
            <FormField label="Address line 1" required error={touched && missing.line1} full>
              <input value={draft.line1} onChange={(e) => setD('line1', e.target.value)} placeholder="Building / street" style={inputStyle} />
            </FormField>
            <FormField label="Address line 2" full>
              <input value={draft.line2} onChange={(e) => setD('line2', e.target.value)} placeholder="Area / landmark (optional)" style={inputStyle} />
            </FormField>
            <FormField label="City" required error={touched && missing.city}>
              <input value={draft.city} onChange={(e) => setD('city', e.target.value)} style={inputStyle} />
            </FormField>
            <FormField label="State (statutory)" required error={touched && missing.state}>
              <select value={draft.state} onChange={(e) => setD('state', e.target.value)} style={{ ...inputStyle, color: draft.state ? '#222222' : '#717171' }}>
                <option value="">Select state</option>
                {IN_STATES.map((st) => <option key={st} value={st} style={{ color: '#222222' }}>{st}</option>)}
              </select>
            </FormField>
            <FormField label="PIN code" required error={touched && missing.pincode}>
              <input value={draft.pincode} onChange={(e) => setD('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} style={inputStyle} />
            </FormField>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, paddingTop: 26 }}>
              <label style={checkLabel}><input type="checkbox" checked={draft.active} onChange={(e) => setD('active', e.target.checked)} /> Active</label>
              <label style={checkLabel}><input type="checkbox" checked={draft.filingAddress} onChange={(e) => setD('filingAddress', e.target.checked)} /> Registered filing address</label>
            </div>
          </div>
          {touched && Object.values(missing).some(Boolean) && (
            <div style={{ fontSize: 14, color: '#C4382E', fontWeight: 600, marginTop: 10 }}>Fill the fields marked with an asterisk — the PIN code is six digits.</div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={addLocation} style={primaryBtn}>Add location</button>
            <button type="button" onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); setTouched(false); }} style={ghostBtn}>Cancel</button>
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {locations.map((l) => (
          <Card key={l.id} style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={pinTile}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.6" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#222222' }}>{l.name}</span>
                  {l.filingAddress && <Tag bg="#E7F4FB" fg="#0571A6">Registered · filing address</Tag>}
                  <Tag bg={l.status === 'active' ? '#E4EDE0' : '#F7F7F9'} fg={l.status === 'active' ? '#4F7A52' : '#717171'}>
                    {l.status === 'active' ? 'Active' : 'Inactive'}
                  </Tag>
                </div>
                <div style={{ fontSize: 14, color: '#717171', marginTop: 5, lineHeight: 1.5 }}>
                  {l.line1}{l.line2 ? `, ${l.line2}` : ''}
                  <br />
                  {l.city !== '—' ? `${l.city}, ` : ''}{l.state} {l.pincode !== '—' ? l.pincode : ''} · {l.country}
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
                  <Meta label="State (statutory)" value={l.state} />
                  <Meta label="Employees" value={String(l.employees)} />
                </div>
              </div>
              <button style={ghostBtn}>Edit</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FormField({ label, required, error, full, children }: { label: string; required?: boolean; error?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: error ? '#C4382E' : '#484848' }}>
        {label}{required && <span style={{ color: '#C4382E' }}> *</span>}
      </label>
      {children}
    </div>
  );
}
function Tag({ children, bg, fg }: { children: ReactNode; bg: string; fg: string }) {
  return <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: bg, color: fg }}>{children}</span>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', color: '#9197A2', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#484848', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '7px 14px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', flexShrink: 0 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const checkLabel: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: '#484848', cursor: 'pointer' };
const pinTile: CSSProperties = { width: 38, height: 38, borderRadius: 11, background: '#C57F63', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
