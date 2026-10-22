// People › Designations — the org's job titles, counted from the roster.
//
// A job title is a field on each person's own record, so the counts come from
// the roster and cannot drift from who actually holds what. HR can also add a
// designation before anyone holds it: it is saved for the company, shows here
// (under All departments) with nobody in it, and is offered when adding a user.
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyRow, SearchInput, SelectBox } from '../ui';
import { downloadCsv } from '../export';
import { IconDownload, IconInfo } from './peopleTable';
import './people.css';
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

      <div className="pd-toolbar" style={{ gap: 8, marginBottom: 20 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search designation…" width={280} />
        <SelectBox value={department} onChange={setDepartment}>
          <option value="all">All departments</option>
          {departments.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </SelectBox>
        <p className="pd-lead">
          {loaded ? `${designations.length} designations · ${totalEmp} people` : 'Loading…'}
        </p>
        <div className="pd-actions" style={{ marginLeft: 'auto', alignItems: 'flex-start' }}>
          <button className="pd-btn" onClick={download} disabled={designations.length === 0}>
            <IconDownload /> Download
          </button>
          <AddNameButton noun="designation" existing={allNames} busy={busy} onAdd={add} />
        </div>
      </div>

      <div className="pd-note" style={{ marginBottom: 20 }}>
        <IconInfo />
        <span>
          Add a designation here to have it ready before anyone holds it; it is offered when adding a user.
          To change someone's job title, set it on their own profile under <strong>People › Employees</strong>.
        </span>
      </div>

      <section className="pd-card">
        <table className="pd-t">
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
                  <b>{d.name}</b>
                  {d.empty && (
                    <>
                      <span style={emptyTag}>No one yet</span>
                      <button style={linkBtn} disabled={busy} onClick={() => void remove(d.name)}>Remove</button>
                    </>
                  )}
                </Td>
                <Td>
                  {d.departments.length ? (
                    <span className="pd-tags">{d.departments.map((t) => (t === '—' ? <span key={t} className="muted">—</span> : <span key={t} className="pd-tag">{t}</span>))}</span>
                  ) : <span className="muted">—</span>}
                </Td>
                <Td right mono><b>{d.employees}</b></Td>
              </tr>
            ))}
            {loaded && designations.length === 0 && (
              <tr><td colSpan={3}><EmptyRow text={search.trim() ? 'No designation matches that search.' : department === 'all' ? 'No designations yet — nobody on the roster has a job title set.' : `Nobody in ${department} has a job title set.`} /></td></tr>
            )}
            <tr className="pd-total">
              <Td><b>Total</b></Td>
              <Td muted>—</Td>
              <Td right mono><b>{totalEmp}</b></Td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}


function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left' }}>{children}</th>;
}
function Td({ children, muted, right, mono }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean }) {
  return <td style={{ color: muted ? 'var(--ink-3)' : 'var(--ink)', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const emptyTag: CSSProperties = { marginLeft: 10, fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-3)', background: 'var(--surface)', border: '1px dashed var(--line-2)', borderRadius: 999, padding: '3px 9px' };
const linkBtn: CSSProperties = { marginLeft: 8, background: 'none', border: 'none', padding: 0, color: 'var(--bad)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' };
