// People › Departments — the org's departments, counted from the roster.
//
// Which department someone is in is a field on their own record, so the counts
// come from the roster and cannot drift from who is actually where. HR can also
// add a department before anyone is in it: it is saved for the company, shows
// here with nobody in it, and is offered when adding a user.
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyRow } from '../ui';
import { downloadCsv } from '../export';
import { IconDownload, IconInfo } from './peopleTable';
import './people.css';
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
      <div className="pd-head">
        <p className="pd-lead">
          {loaded ? `${departments.length} departments · ${totalEmp} people` : 'Loading…'}
        </p>
        <div className="pd-actions" style={{ alignItems: 'flex-start' }}>
          <button className="pd-btn" onClick={download} disabled={departments.length === 0}>
            <IconDownload /> Download
          </button>
          <AddNameButton noun="department" existing={departments.map((d) => d.name)} busy={busy} onAdd={add} />
        </div>
      </div>

      <div className="pd-note" style={{ marginBottom: 20 }}>
        <IconInfo />
        <span>
          Add a department here to have it ready before anyone is in it; it is offered when adding a user.
          To move someone, set their department on their own profile under <strong>People › Employees</strong>.
        </span>
      </div>

      <section className="pd-card">
        <table className="pd-t">
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
                  <b>{d.name}</b>
                  {d.empty && (
                    <>
                      <span style={emptyTag}>No one yet</span>
                      <button style={linkBtn} disabled={busy} onClick={() => void remove(d.name)}>Remove</button>
                    </>
                  )}
                </Td>
                <Td>
                  {d.locations.length ? (
                    <span className="pd-tags">{d.locations.map((l) => (l === '—' ? <span key={l} className="muted">—</span> : <span key={l} className="pd-tag">{l}</span>))}</span>
                  ) : <span className="muted">—</span>}
                </Td>
                <Td right mono>{d.managers || <span className="muted">—</span>}</Td>
                <Td right mono><b>{d.employees}</b></Td>
              </tr>
            ))}
            {loaded && departments.length === 0 && (
              <tr><td colSpan={4}><EmptyRow text="No departments yet — nobody on the roster has one set." /></td></tr>
            )}
            <tr className="pd-total">
              <Td><b>Total</b></Td>
              <Td muted>—</Td>
              <Td right mono><b>{departments.reduce((s, d) => s + d.managers, 0) || '—'}</b></Td>
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
