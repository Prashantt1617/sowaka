// "Not on this run": the people a pay run leaves out because they have no live
// salary (no salary template, or a template without a CTC). The run pays only
// people with an active salary structure, so without this they are missed in
// silence — a month's joiners most of all. Shown on Payroll Runs (for the
// period picked, and on a run) and on Salary templates. Each row has a template
// picker: choosing one asks for the CTC and the start date, as Edit employees does.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { listPayHeads, listSalaryStructures, listSalaryTemplates } from '../../services/payroll';
import type { PayHeadDTO, SalaryTemplateDTO } from '../../services/payroll';
import { dayLabel, getPeopleWithoutSalary, REASON_TEXT } from '../../services/salaryTemplatePeople';
import type { PeopleWithoutSalary, StructureRowWithFrom } from '../../services/salaryTemplatePeople';
import { AssignSalaryDialog } from './SalaryTemplatePeople';
import * as L from './look';

const SHOWN = 6;

export function MissingSalaryNotice({ period, where = 'run', note, refreshKey, onAssigned }: {
  /** 'YYYY-MM'; absent = the current pay period. */
  period?: string;
  /** On a run (with the button to Salary templates), or on Salary templates itself. */
  where?: 'run' | 'templates';
  /** A line under the list, e.g. what to do on this run once they have a salary. */
  note?: string;
  /** Changes when the page knows the answer may have changed (a run recalculated, people assigned). */
  refreshKey?: unknown;
  /** Someone was given a salary from the list's picker. */
  onAssigned?: () => void;
}) {
  const { setView, emps, flash } = useStore();
  const [data, setData] = useState<PeopleWithoutSalary | null>(null);
  const [failed, setFailed] = useState('');
  const [all, setAll] = useState(false);
  const [mine, setMine] = useState(0);
  // For the per-person template picker: the templates, pay heads (for the breakup) and who has which salary.
  const [templates, setTemplates] = useState<SalaryTemplateDTO[] | null>(null);
  const [payHeads, setPayHeads] = useState<PayHeadDTO[]>([]);
  const [structures, setStructures] = useState<StructureRowWithFrom[]>([]);
  const [assigning, setAssigning] = useState<{ userId: string; code: string } | null>(null);
  const hasPeople = !!data && data.people.length > 0;
  useEffect(() => {
    if (!hasPeople || templates) return;
    Promise.all([listSalaryTemplates(), listPayHeads(), listSalaryStructures()])
      .then(([t, ph, st]) => { setTemplates(t); setPayHeads(ph); setStructures(st as StructureRowWithFrom[]); })
      .catch(() => setTemplates([]));
  }, [hasPeople, templates, mine]);
  const live = useMemo(() => (templates ?? []).filter((t) => t.active), [templates]);
  const byUser = useMemo(() => new Map(structures.map((s) => [s.userId, s])), [structures]);
  const nameOf = useMemo(() => new Map((templates ?? []).map((t) => [t.code, t.name])), [templates]);
  const phByCode = useMemo(() => new Map(payHeads.map((p) => [p.code, p])), [payHeads]);
  const empOf = useMemo(() => new Map(emps.map((e) => [e.id, e])), [emps]);

  useEffect(() => {
    if (period !== undefined && !/^\d{4}-\d{2}$/.test(period)) { setData(null); return; }
    let live = true;
    setFailed('');
    getPeopleWithoutSalary(period)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); setFailed(e instanceof ApiError ? e.message : 'Could not check who is missing'); } });
    return () => { live = false; };
  }, [period, refreshKey, mine]);

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
        <table className="lk-t" style={{ ...L.table, minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Employee ID</th>
              <th style={th}>Joining date</th>
              <th style={th}>What is missing</th>
              <th style={th}>Salary template</th>
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
                <td style={td}>
                  {empOf.has(p.userId) ? (
                    <select id={`assign-${p.userId}`} aria-label={`Salary template for ${p.name}`} value=""
                      disabled={!templates || live.length === 0}
                      onChange={(e) => { if (e.target.value) setAssigning({ userId: p.userId, code: e.target.value }); }}
                      style={pick}>
                      <option value="">{!templates ? 'Loading…' : live.length === 0 ? 'No active templates' : 'Assign a template…'}</option>
                      {live.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    </select>
                  ) : <span style={{ color: 'var(--ink-3)' }}>Not in the employee list</span>}
                </td>
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
      {assigning && (() => {
        const template = live.find((t) => t.code === assigning.code);
        const emp = empOf.get(assigning.userId);
        if (!template || !emp) return null;
        return (
          <AssignSalaryDialog
            template={template}
            people={[emp]}
            byUser={byUser}
            nameOf={nameOf}
            phByCode={phByCode}
            current={data.current}
            onClose={() => setAssigning(null)}
            onSaved={async (saved, left) => {
              if (left.length === 0) setAssigning(null);
              if (saved > 0) {
                flash(`${emp.name} is on ${template.name}`);
                setTemplates(null);
                setMine((k) => k + 1);
                onAssigned?.();
              }
            }}
          />
        );
      })()}
    </section>
  );
}

const box: CSSProperties = {
  border: '1px solid var(--line)', borderLeft: '3px solid var(--warn)', borderRadius: 14, background: 'var(--surface)',
  padding: '14px 16px', margin: '0 0 20px',
};
const th: CSSProperties = { ...L.th, padding: '8px 10px' };
const td: CSSProperties = { ...L.td, padding: '8px 10px', fontSize: 13 };
const pick: CSSProperties = {
  font: 'inherit', fontSize: 13, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line)',
  borderRadius: 10, padding: '7px 10px', minWidth: 180, cursor: 'pointer',
};
