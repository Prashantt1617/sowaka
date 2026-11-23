// "Not on this run": the people a pay run leaves out because they have no live
// salary (no salary template, or a template without a CTC). The run pays only
// people with an active salary structure, so without this they are missed in
// silence — a month's joiners most of all. Shown on Payroll Runs (for the
// period picked, and on a run) and on Salary templates.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { dayLabel, getPeopleWithoutSalary, REASON_TEXT } from '../../services/salaryTemplatePeople';
import type { PeopleWithoutSalary } from '../../services/salaryTemplatePeople';
import * as L from './look';

const SHOWN = 6;

export function MissingSalaryNotice({ period, where = 'run', note, refreshKey }: {
  /** 'YYYY-MM'; absent = the current pay period. */
  period?: string;
  /** On a run (with the button to Salary templates), or on Salary templates itself. */
  where?: 'run' | 'templates';
  /** A line under the list, e.g. what to do on this run once they have a salary. */
  note?: string;
  /** Changes when the page knows the answer may have changed (a run recalculated, people assigned). */
  refreshKey?: unknown;
}) {
  const { setView } = useStore();
  const [data, setData] = useState<PeopleWithoutSalary | null>(null);
  const [failed, setFailed] = useState('');
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (period !== undefined && !/^\d{4}-\d{2}$/.test(period)) { setData(null); return; }
    let live = true;
    setFailed('');
    getPeopleWithoutSalary(period)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); setFailed(e instanceof ApiError ? e.message : 'Could not check who is missing'); } });
    return () => { live = false; };
  }, [period, refreshKey]);

  if (failed) return <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 16px' }}>Could not check who has no salary template: {failed}</div>;
  if (!data || data.people.length === 0) return null;

  const n = data.people.length;
  const onlyNoTemplate = data.people.every((p) => p.reason === 'none' || p.reason === 'no_template');
  const what = onlyNoTemplate ? 'no salary template' : 'no salary template or CTC';
  const title = where === 'run'
    ? `Not on this run: ${n} ${n === 1 ? 'person has' : 'people have'} ${what}`
    : `${n} ${n === 1 ? 'person has' : 'people have'} ${what}, so payroll runs leave them out`;
  const rows = all ? data.people : data.people.slice(0, SHOWN);

  return (
    <section id="missing-salary" style={box} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
            Still with the company and joined by {dayLabel(data.to)} (the {data.period} pay period ends then).
            {where === 'run'
              ? ' A run pays only people with a salary template and an annual CTC.'
              : ' Open the template they should be on, then Edit employees › Add, with each person’s CTC.'}
          </div>
        </div>
        {where === 'run' && (
          <button type="button" onClick={() => setView('templates')} className="lk-btn-p" style={L.btnSmPrimary}>Assign salary templates</button>
        )}
      </div>

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="lk-t" style={{ ...L.table, minWidth: 520 }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Employee ID</th>
              <th style={th}>Joining date</th>
              <th style={th}>What is missing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.userId}>
                <td style={td}>
                  <div style={{ ...L.cellName, fontSize: 13.5 }}>{p.name}</div>
                  {(p.department || p.designation) && <div style={L.cellSub}>{[p.designation, p.department].filter(Boolean).join(' · ')}</div>}
                </td>
                <td style={td}>{p.employeeId || '—'}</td>
                <td style={td}>{dayLabel(p.joiningDate)}</td>
                <td style={{ ...td, color: 'var(--ink-2)' }}>{REASON_TEXT[p.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {n > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="lk-ghost" style={{ ...L.btnGhost, marginTop: 6, marginLeft: -12 }}>
          {all ? 'Show fewer' : `Show all ${n}`}
        </button>
      )}
      {note && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{note}</div>}
    </section>
  );
}

const box: CSSProperties = {
  border: '1px solid var(--line)', borderLeft: '3px solid var(--warn)', borderRadius: 14, background: 'var(--surface)',
  padding: '14px 16px', margin: '0 0 20px',
};
const th: CSSProperties = { ...L.th, padding: '8px 10px' };
const td: CSSProperties = { ...L.td, padding: '8px 10px', fontSize: 13 };
