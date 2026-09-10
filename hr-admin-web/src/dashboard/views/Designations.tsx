// People › Designations — the org's job titles, derived from the roster.
//
// Like departments, there is no separate master: a designation exists because
// someone holds it, and it is a field on their own record. Counting the roster
// means this cannot drift from who actually holds what.
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow } from '../ui';
import { downloadCsv } from '../export';
import { IconDownload } from './peopleTable';

type Designation = {
  name: string;
  employees: number;
  departments: string[];
};


export function Designations() {
  const { emps, loaded } = useStore();

  const designations = useMemo<Designation[]>(() => {
    const byName = new Map<string, Designation>();
    for (const person of emps) {
      const name = (person.role ?? '').trim();
      if (!name) continue;
      const row = byName.get(name) ?? { name, employees: 0, departments: [] };
      row.employees += 1;
      const team = (person.team ?? '').trim();
      if (team && !row.departments.includes(team)) row.departments.push(team);
      byName.set(name, row);
    }
    return [...byName.values()].sort((a, b) => b.employees - a.employees);
  }, [emps]);

  const totalEmp = designations.reduce((s, d) => s + d.employees, 0);

  const download = () => downloadCsv('designations', [
    { header: 'Designation', value: (d: Designation) => d.name },
    { header: 'Departments', value: (d: Designation) => d.departments.join(' / ') },
    { header: 'Employees', value: (d: Designation) => d.employees },
  ], designations);

  return (
    <div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#717171' }}>
          {loaded ? `${designations.length} designations · ${totalEmp} people` : 'Loading…'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          <button style={ghostBtn} onClick={download} disabled={designations.length === 0}>
            <IconDownload /> Download
          </button>
        </div>
      </div>

      <div style={note}>
        A designation exists because someone holds it. To change a job title, or introduce a new
        one, set it on the employee's own profile under <strong>People › Employees</strong>.
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Designation name</Th>
              <Th>Departments</Th>
              <Th right>Total employees</Th>
            </tr>
          </thead>
          <tbody>
            {designations.map((d) => (
              <tr key={d.name}>
                <Td><strong style={{ color: '#0571A6' }}>{d.name}</strong></Td>
                <Td muted>{d.departments.length ? d.departments.join(', ') : '—'}</Td>
                <Td right mono>{d.employees}</Td>
              </tr>
            ))}
            {loaded && designations.length === 0 && (
              <tr><td colSpan={3}><EmptyRow text="No designations yet — nobody on the roster has a job title set." /></td></tr>
            )}
            <tr>
              <Td><strong>Total</strong></Td>
              <Td muted>—</Td>
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
const note: CSSProperties = { fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
