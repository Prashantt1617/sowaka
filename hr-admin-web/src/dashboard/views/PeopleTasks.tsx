// People › Tasks — everyone whose setup isn't finished: no shift template, no
// KPIs for the cycle, no salary, no bank details, or basic details missing.
// Each task opens that person's profile at the place to fix it; when HR comes
// back, the list is worked out again and what was fixed shows as done.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card } from '../ui';
import { getPeopleTasks, type PeopleTaskKey, type PeopleTasksDTO } from '../../services/hrms';
import { EmployeeProfile, type ProfileTab } from './EmployeeProfile';

/** Where each task is fixed on the profile. */
const WHERE: Record<PeopleTaskKey, { tab: ProfileTab; label: string; tone: [string, string] }> = {
  shift: { tab: 'profile', label: 'Shift template', tone: ['#E7F1FB', '#0571A6'] },
  kpi: { tab: 'performance', label: 'KPI template', tone: ['#F1ECF8', '#6B4FA0'] },
  salary: { tab: 'salary', label: 'Salary', tone: ['#E5F4E4', '#2F6B33'] },
  bank: { tab: 'profile', label: 'Bank & PAN', tone: ['#FFF4DE', '#9A6200'] },
  details: { tab: 'profile', label: 'Basic details', tone: ['#F4F4F6', '#484848'] },
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

  const load = useCallback(async () => {
    try {
      const d = await getPeopleTasks();
      setData(d);
      return d;
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : 'Could not load tasks', 'error');
      return null;
    }
  }, [s]);
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
    <div style={{ display: 'grid', gap: 16, maxWidth: 1180 }}>
      <Card style={{ padding: '18px 22px' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>People who still need setting up</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 4, lineHeight: 1.5 }}>
          {data ? <><strong>{data.people.length}</strong> of {data.total} people have something missing. </> : 'Loading… '}
          Click a task to open that person's profile at the right place; once it's assigned, it drops off this list.
          {data && !data.payroll && ' Salary and bank tasks show for people with payroll access.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} label="Everyone" value={data?.people.length ?? 0} />
          {keys.map((k) => <FilterChip key={k} on={filter === k} onClick={() => setFilter(k)} label={MISSING[k]} value={count(k)} tone={WHERE[k].tone} />)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID" style={{ marginLeft: 'auto', padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'inherit', fontSize: 14, minWidth: 200 }} />
        </div>
      </Card>

      {done.length > 0 && (
        <Card style={{ padding: '12px 22px', background: '#F3FAF2' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2F6B33' }}>Done just now</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {done.map((d, i) => <span key={i} style={{ ...pill, background: '#E5F4E4', color: '#2F6B33' }}>✓ {d.label} · {d.name}</span>)}
          </div>
        </Card>
      )}

      <Card>
        {data && people.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#717171', fontSize: 15 }}>{data.people.length === 0 ? 'Everyone is set up. Nothing to do.' : 'Nobody matches this filter.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr><th style={th}>Employee</th><th style={th}>Joined</th><th style={th}>To do (click to fix)</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.userId}>
                  <td style={{ ...td, minWidth: 220 }}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: '#717171' }}>{[p.employeeId, p.designation, p.department].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#717171' }}>{p.joiningDate ? new Date(`${p.joiningDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {p.tasks.filter((t) => filter === 'all' || t.key === filter).map((t) => (
                        <button key={t.key} type="button" title={t.detail} onClick={() => setOpen({ userId: p.userId, key: t.key })} style={{ ...pill, background: WHERE[t.key].tone[0], color: WHERE[t.key].tone[1], border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          {t.label}{t.key === 'details' || t.key === 'bank' ? <span style={{ fontWeight: 500 }}>: {t.detail}</span> : ''} ›
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FilterChip({ on, onClick, label, value, tone = ['#F4F4F6', '#484848'] }: { on: boolean; onClick: () => void; label: string; value: number; tone?: [string, string] }) {
  return (
    <button type="button" onClick={onClick} style={{ ...pill, cursor: 'pointer', fontFamily: 'inherit', border: on ? `2px solid ${tone[1]}` : '2px solid transparent', background: tone[0], color: tone[1], padding: '6px 12px' }}>
      {label} <span style={{ fontSize: 14.5 }}>{value}</span>
    </button>
  );
}

const pill: CSSProperties = { borderRadius: 9, padding: '5px 10px', fontSize: 13, fontWeight: 700 };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '10px 14px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '10px 14px', borderBottom: '1px solid #F4F4F6', verticalAlign: 'top' };
