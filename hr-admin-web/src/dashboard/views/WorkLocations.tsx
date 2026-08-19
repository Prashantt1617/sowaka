// Organisation › Work locations — the physical sites employees are mapped to.
// A location's state drives its statutory rules (PT, LWF); one location is the
// registered/filing address.
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
import type { CSSProperties, ReactNode } from 'react';
import { Card } from '../ui';
import { IconPlus } from '../icons';

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

export function WorkLocations() {
  const total = LOCATIONS.length;
  const mapped = LOCATIONS.reduce((s, l) => s + l.employees, 0);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.5, maxWidth: 560 }}>
            The physical sites your employees are mapped to. A location’s <strong style={{ color: '#484848' }}>state</strong> drives its
            statutory rules (PT, LWF). One location is your <strong style={{ color: '#484848' }}>registered filing address</strong>.
          </div>
          <div style={{ fontSize: 14, color: '#717171', marginTop: 6 }}>
            {total} locations · {mapped} employees mapped
          </div>
        </div>
        <button style={{ ...primaryBtn, marginLeft: 'auto' }}><IconPlus size={15} /> Add work location</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {LOCATIONS.map((l) => (
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
const pinTile: CSSProperties = { width: 38, height: 38, borderRadius: 11, background: '#C57F63', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
