// People › Tasks — everyone whose setup isn't finished: no shift template, no
// KPIs for the cycle, no salary, no bank details, or basic details missing.
// Each task opens that person's profile at the place to fix it; when HR comes
// back, the list is worked out again and what was fixed shows as done.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { ListPending, LoadingFigure, Spinner } from '../ui';
import type { LoadState } from '../ui';
import './people.css';
import { getPeopleTasks, type PeopleTaskKey, type PeopleTasksDTO } from '../../services/hrms';
import { EmployeeProfile, type ProfileTab } from './EmployeeProfile';

/** Where each task is fixed on the profile. */
const WHERE: Record<PeopleTaskKey, { tab: ProfileTab; label: string; tone: [string, string] }> = {
  shift: { tab: 'profile', label: 'Shift template', tone: ['var(--accent-soft)', 'var(--accent-ink)'] },
  kpi: { tab: 'performance', label: 'KPI template', tone: ['var(--t-lilac)', 'var(--t-lilac-i)'] },
  salary: { tab: 'salary', label: 'Salary', tone: ['var(--ok-bg)', 'var(--ok)'] },
  bank: { tab: 'profile', label: 'Bank & PAN', tone: ['var(--warn-bg)', 'var(--warn)'] },
  details: { tab: 'profile', label: 'Basic details', tone: ['var(--surface-2)', 'var(--ink-2)'] },
};
const MISSING: Record<PeopleTaskKey, string> = { shift: 'No shift template', kpi: 'No KPI template', salary: 'No salary', bank: 'Bank or PAN missing', details: 'Basic details missing' };
const ORDER: PeopleTaskKey[] = ['shift', 'kpi', 'salary', 'bank', 'details'];

export function PeopleTasks() {
  const s = useStore();
  const [data, setData] = useState<PeopleTasksDTO | null>(null);
  const [filter, setFilter] = useState<PeopleTaskKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ userId: string; key: PeopleTaskKey } | null>(null);
  const [done, setDone] = useState<{ name: string; label: string }[]>([]);
  // The first load failed: the list says so, with Retry.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getPeopleTasks();
      setData(d);
      setFailed(false);
      return d;
    } catch (e) {
      setFailed(true);
      s.flash(e instanceof ApiError ? e.message : 'Could not load tasks', 'error');
      return null;
    }
  }, [s]);
  const state: LoadState = data ? 'ready' : failed ? 'error' : 'loading';
  useEffect(() => { void load(); }, [load]);

  const back = async () => {
    const was = open;
    setOpen(null);
    const fresh = await load();
    if (!was || !fresh) return;
    const still = fresh.people.find((p) => p.userId === was.userId)?.tasks.some((t) => t.key === was.key);
    const name = data?.people.find((p) => p.userId === was.userId)?.name ?? '';
    if (!still) {
      setDone((d) => [{ name, label: WHERE[was.key].label }, ...d]);
      s.flash(`Done: ${WHERE[was.key].label} for ${name}`);
    }
  };

  if (open) {
    const emp = s.emps.find((e) => e.id === open.userId);
    if (emp) return <EmployeeProfile emp={emp} onBack={() => void back()} initialTab={WHERE[open.key].tab} focus={open.key} backLabel="← Back to tasks" />;
  }

  const people = (data?.people ?? []).filter((p) => (filter === 'all' || p.tasks.some((t) => t.key === filter)) && (!search.trim() || `${p.name} ${p.employeeId} ${p.designation}`.toLowerCase().includes(search.trim().toLowerCase())));
  const count = (k: PeopleTaskKey) => (data?.people ?? []).filter((p) => p.tasks.some((t) => t.key === k)).length;
  const keys = ORDER.filter((k) => data?.payroll || (k !== 'salary' && k !== 'bank'));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="pd-card">
        <div className="pd-card-h" style={{ marginBottom: 14 }}>
          <div>
            <h3>People who still need setting up</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
              {data ? <><strong style={{ fontWeight: 500, color: 'var(--ink)' }}>{data.people.length}</strong> of {data.total} people have something missing. </> : state === 'loading' ? <><Spinner />{' '}</> : null}
              Click a task to open that person's profile at the right place; once it's assigned, it drops off this list.
              {data && !data.payroll && ' Salary and bank tasks show for people with payroll access.'}
            </div>
          </div>
        </div>
        <div className="pd-chips">
          <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} label="Everyone" value={<LoadingFigure state={state} w={14} h={12}>{data?.people.length ?? 0}</LoadingFigure>} />
          {keys.map((k) => <FilterChip key={k} on={filter === k} onClick={() => setFilter(k)} label={MISSING[k]} value={<LoadingFigure state={state} w={14} h={12}>{count(k)}</LoadingFigure>} tone={WHERE[k].tone} />)}
          <label className="pd-field" style={{ marginLeft: 'auto', minWidth: 240 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID" />
          </label>
        </div>
      </section>

      {done.length > 0 && (
        <section className="pd-card" style={{ padding: '14px 20px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ok)' }}>Done just now</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {done.map((d, i) => <span key={i} style={{ ...pill, background: 'var(--p-green)', color: '#fff' }}>✓ {d.label} · {d.name}</span>)}
          </div>
        </section>
      )}

      <section className="pd-card">
        {!data ? (
          <ListPending state={state} onRetry={() => { setFailed(false); void load(); }} rows={6} cols={3} avatar={false} rowHeight={56} />
        ) : people.length === 0 ? (
          <div className="pd-empty" style={{ padding: 28 }}>{data.people.length === 0 ? 'Everyone is set up. Nothing to do.' : 'Nobody matches this filter.'}</div>
        ) : (
          <div className="pd-tbl-wrap">
            <table className="pd-t">
              <thead><tr><th>Employee</th><th>Joined</th><th>To do (click to fix)</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.userId}>
                  <td style={{ minWidth: 220 }}>
                    <span className="pd-who" style={{ display: 'block' }}>
                      <b>{p.name}</b>
                      <span className="sub" style={{ marginTop: 2 }}>{[p.employeeId, p.designation, p.department].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.joiningDate ? new Date(`${p.joiningDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {p.tasks.filter((t) => filter === 'all' || t.key === filter).map((t) => (
                        <button key={t.key} type="button" title={t.detail} onClick={() => setOpen({ userId: p.userId, key: t.key })} style={{ ...pill, background: WHERE[t.key].tone[0], color: WHERE[t.key].tone[1], border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          {t.label}{t.key === 'details' || t.key === 'bank' ? <span style={{ fontWeight: 400 }}>: {t.detail}</span> : ''} ›
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterChip({ on, onClick, label, value, tone = ['var(--surface-2)', 'var(--ink-2)'] }: { on: boolean; onClick: () => void; label: string; value: ReactNode; tone?: [string, string] }) {
  return (
    <button type="button" onClick={onClick} className={on ? 'pd-chip on' : 'pd-chip'}>
      {!on && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: tone[1], opacity: 0.85 }} />}
      {label} <span className="c">{value}</span>
    </button>
  );
}

const pill: CSSProperties = { display: 'inline-block', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5 };
