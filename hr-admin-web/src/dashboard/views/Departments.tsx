// People › Departments — the org's departments, counted from the roster.
//
// Which department someone is in is a field on their own record, so the counts
// come from the roster and cannot drift from who is actually where. HR can also
// add a department before anyone is in it: it is saved for the company, shows
// here with nobody in it, and is offered when adding a user.
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { downloadCsv } from '../export';
import { IconDownload } from './peopleTable';
import { AddNameButton, useSavedNames } from './savedNames';

type Department = {
  name: string;
  employees: number;
  managers: number;
  locations: string[];
  /** Added here, and nobody is in it yet. */
  empty?: boolean;
};


export function Departments() {
  const { emps, loaded } = useStore();
  const { saved, busy, add, remove } = useSavedNames('departmentList');

  const departments = useMemo<Department[]>(() => {
    const byName = new Map<string, Department>();
    for (const person of emps) {
      const name = (person.team ?? '').trim();
      if (!name) continue;
      const row = byName.get(name) ?? { name, employees: 0, managers: 0, locations: [] };
      row.employees += 1;
      if (person.role?.toLowerCase().includes('manager') || person.role?.toLowerCase().includes('lead')) {
        row.managers += 1;
      }
      const location = (person.location ?? '').trim();
      if (location && !row.locations.includes(location)) row.locations.push(location);
      byName.set(name, row);
    }
    const held = [...byName.values()].sort((a, b) => b.employees - a.employees);
    const known = new Set(held.map((d) => d.name.toLowerCase()));
    const empty = saved
      .filter((name) => !known.has(name.toLowerCase()))
      .map((name) => ({ name, employees: 0, managers: 0, locations: [], empty: true }));
    return [...held, ...empty];
  }, [emps, saved]);

  const totalEmp = departments.reduce((s, d) => s + d.employees, 0);

  const download = () => downloadCsv('departments', [
    { header: 'Department', value: (d: Department) => d.name },
    { header: 'Employees', value: (d: Department) => d.employees },
    { header: 'Managers & leads', value: (d: Department) => d.managers },
    { header: 'Locations', value: (d: Department) => d.locations.join(' / ') },
  ], departments);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>
          {loaded ? `${departments.length} departments · ${totalEmp} people` : 'Loading…'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <AddNameButton noun="department" existing={departments.map((d) => d.name)} busy={busy} onAdd={add} />
          <button style={ghostBtn} onClick={download} disabled={departments.length === 0}>
            <IconDownload /> Download
          </button>
        </div>
      </div>

      <div style={note}>
        Add a department here to have it ready before anyone is in it; it is offered when adding a user.
        To move someone, set their department on their own profile under <strong>People › Employees</strong>.
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Department name</Th>
              <Th>Locations</Th>
              <Th right>Managers &amp; leads</Th>
              <Th right>Total employees</Th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.name}>
                <Td>
                  <strong style={{ color: '#0571A6' }}>{d.name}</strong>
                  {d.empty && (
                    <>
                      <span style={emptyTag}>No one yet</span>
                      <button style={linkBtn} disabled={busy} onClick={() => void remove(d.name)}>Remove</button>
                    </>
                  )}
                </Td>
                <Td muted>{d.locations.length ? d.locations.join(', ') : '—'}</Td>
                <Td right mono>{d.managers || '—'}</Td>
                <Td right mono>{d.employees}</Td>
              </tr>
            ))}
            {loaded && departments.length === 0 && (
              <tr><td colSpan={4}><EmptyRow text="No departments yet — nobody on the roster has one set." /></td></tr>
            )}
            <tr>
              <Td><strong>Total</strong></Td>
              <Td muted>—</Td>
              <Td right mono><strong>{departments.reduce((s, d) => s + d.managers, 0) || '—'}</strong></Td>
              <Td right mono><strong>{totalEmp}</strong></Td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}



function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const emptyTag: CSSProperties = { marginLeft: 10, fontSize: 12, fontWeight: 700, color: '#717171', background: '#F4F4F5', borderRadius: 99, padding: '3px 9px' };
const linkBtn: CSSProperties = { marginLeft: 8, background: 'none', border: 'none', padding: 0, color: '#C24141', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const note: CSSProperties = { fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
