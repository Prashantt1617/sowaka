// People › Designations — the org's job titles, counted from the roster.
//
// A job title is a field on each person's own record, so the counts come from
// the roster and cannot drift from who actually holds what. HR can also add a
// designation before anyone holds it: it is saved for the company, shows here
// (under All departments) with nobody in it, and is offered when adding a user.
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow, SearchInput, SelectBox } from '../ui';
import { downloadCsv } from '../export';
import { IconDownload } from './peopleTable';
import { AddNameButton, useSavedNames } from './savedNames';

type Designation = {
  name: string;
  employees: number;
  departments: string[];
  /** Added here, and nobody holds it yet. */
  empty?: boolean;
};


export function Designations() {
  const { emps, loaded } = useStore();
  const { saved, busy, add, remove } = useSavedNames('designationList');
  // One department, or all of them. With one chosen the list is the titles
  // held there and the counts are the people there who hold them.
  const [department, setDepartment] = useState('all');
  const [search, setSearch] = useState('');

  const departments = useMemo(
    () => [...new Set(emps.map((e) => (e.team ?? '').trim()).filter((t) => t && t !== '—'))].sort(),
    [emps],
  );

  const designations = useMemo<Designation[]>(() => {
    const byName = new Map<string, Designation>();
    for (const person of emps) {
      const name = (person.role ?? '').trim();
      if (!name) continue;
      if (department !== 'all' && (person.team ?? '').trim() !== department) continue;
      const row = byName.get(name) ?? { name, employees: 0, departments: [] };
      row.employees += 1;
      const team = (person.team ?? '').trim();
      if (team && !row.departments.includes(team)) row.departments.push(team);
      byName.set(name, row);
    }
    const q = search.trim().toLowerCase();
    const held = [...byName.values()].sort((a, b) => b.employees - a.employees);
    // A saved title nobody holds belongs to no department yet: it shows under All departments.
    const anyone = new Set(emps.map((p) => (p.role ?? '').trim().toLowerCase()).filter(Boolean));
    const empty = department !== 'all' ? [] : saved
      .filter((name) => !anyone.has(name.toLowerCase()))
      .map((name) => ({ name, employees: 0, departments: [], empty: true }));
    return [...held, ...empty].filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [emps, department, search, saved]);

  // Every title anyone holds or HR saved, whatever the filter: a repeat is caught when adding.
  const allNames = useMemo(
    () => [...emps.map((p) => (p.role ?? '').trim()).filter(Boolean), ...saved],
    [emps, saved],
  );

  const totalEmp = designations.reduce((s, d) => s + d.employees, 0);

  const download = () => downloadCsv('designations', [
    { header: 'Designation', value: (d: Designation) => d.name },
    { header: 'Departments', value: (d: Designation) => d.departments.join(' / ') },
    { header: 'Employees', value: (d: Designation) => d.employees },
  ], designations);

  return (
    <div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search designation…" width={280} />
        <SelectBox value={department} onChange={setDepartment}>
          <option value="all">All departments</option>
          {departments.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </SelectBox>
        <div style={{ fontSize: 13, color: '#717171' }}>
          {loaded ? `${designations.length} designations · ${totalEmp} people` : 'Loading…'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <AddNameButton noun="designation" existing={allNames} busy={busy} onAdd={add} />
          <button style={ghostBtn} onClick={download} disabled={designations.length === 0}>
            <IconDownload /> Download
          </button>
        </div>
      </div>

      <div style={note}>
        Add a designation here to have it ready before anyone holds it; it is offered when adding a user.
        To change someone's job title, set it on their own profile under <strong>People › Employees</strong>.
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
                <Td>
                  <strong style={{ color: '#0571A6' }}>{d.name}</strong>
                  {d.empty && (
                    <>
                      <span style={emptyTag}>No one yet</span>
                      <button style={linkBtn} disabled={busy} onClick={() => void remove(d.name)}>Remove</button>
                    </>
                  )}
                </Td>
                <Td muted>{d.departments.length ? d.departments.join(', ') : '—'}</Td>
                <Td right mono>{d.employees}</Td>
              </tr>
            ))}
            {loaded && designations.length === 0 && (
              <tr><td colSpan={3}><EmptyRow text={search.trim() ? 'No designation matches that search.' : department === 'all' ? 'No designations yet — nobody on the roster has a job title set.' : `Nobody in ${department} has a job title set.`} /></td></tr>
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
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 11.5, textTransform: 'none', letterSpacing: 0, color: '#717171', fontWeight: 400, padding: '11px 16px', borderBottom: '1px solid #EBEBEB', background: 'var(--surface-2)' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F2', color: muted ? '#717171' : '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const emptyTag: CSSProperties = { marginLeft: 10, fontSize: 11.5, fontWeight: 500, color: '#717171', background: '#F4F4F5', borderRadius: 99, padding: '3px 9px' };
const linkBtn: CSSProperties = { marginLeft: 8, background: 'none', border: 'none', padding: 0, color: '#C24141', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };
const note: CSSProperties = { fontSize: 12.5, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '10px 14px', marginBottom: 14, lineHeight: 1.55 };
