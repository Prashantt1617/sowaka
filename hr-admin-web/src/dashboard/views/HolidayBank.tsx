// Holiday Bank — a master list of holidays. Holidays are applied to employees by
// their work LOCATION (not configured on the shift template). Prototype: local
// mock data, no API.
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { IconPlus } from '../icons';

type HolidayType = 'Public' | 'Restricted' | 'Optional';
type Holiday = { date: string; name: string; location: string; type: HolidayType };

const ALL = 'All locations';
const MOCK: Holiday[] = [
  { date: '2026-01-01', name: "New Year's Day", location: ALL, type: 'Public' },
  { date: '2026-01-14', name: 'Makar Sankranti / Pongal', location: 'Bengaluru', type: 'Restricted' },
  { date: '2026-01-26', name: 'Republic Day', location: ALL, type: 'Public' },
  { date: '2026-03-06', name: 'Holi', location: 'Delhi', type: 'Public' },
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti', location: 'Bengaluru', type: 'Public' },
  { date: '2026-05-01', name: 'Maharashtra Day', location: 'Mumbai', type: 'Public' },
  { date: '2026-08-15', name: 'Independence Day', location: ALL, type: 'Public' },
  { date: '2026-10-02', name: 'Gandhi Jayanti', location: ALL, type: 'Public' },
  { date: '2026-11-01', name: 'Kannada Rajyotsava', location: 'Bengaluru', type: 'Public' },
  { date: '2026-11-08', name: 'Diwali', location: ALL, type: 'Public' },
  { date: '2026-12-25', name: 'Christmas', location: ALL, type: 'Optional' },
];

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
  const [year] = useState('2026');

  const locations = useMemo(() => Array.from(new Set(MOCK.map((h) => h.location).filter((l) => l !== ALL))).sort(), []);
  const rows = useMemo(
    () => MOCK.filter((h) => location === 'All' || h.location === location || h.location === ALL).sort((a, b) => a.date.localeCompare(b.date)),
    [location],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <select value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...selectStyle, width: 220 }}>
          <option value="All">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <div style={{ fontSize: 14, color: '#717171' }}>Calendar year {year}</div>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => flash('Add holiday (prototype)')} style={primaryBtn}><IconPlus size={15} /> Add holiday</button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        This is the org-wide holiday master. Each holiday is assigned to employees by their <strong>work location</strong> — “{ALL}” applies to everyone.
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyRow text="No holidays for this location." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th><Th>Location</Th><Th>Type</Th></tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.date + h.name}>
                  <Td mono>{fmtDate(h.date)}</Td>
                  <Td muted>{weekday(h.date)}</Td>
                  <Td><strong style={{ color: '#222222' }}>{h.name}</strong></Td>
                  <Td muted>{h.location}</Td>
                  <Td>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: TYPE_TONE[h.type].bg, color: TYPE_TONE[h.type].fg }}>{h.type}</span>
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

function Th({ children }: { children: ReactNode }) {
  return <th style={{ textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, mono }: { children: ReactNode; muted?: boolean; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const selectStyle: CSSProperties = { padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222', cursor: 'pointer' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
