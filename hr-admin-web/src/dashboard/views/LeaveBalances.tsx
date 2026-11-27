// Time office › Leave balances: every active employee's leave for the year, as
// their app shows it: available of the total per leave type on their template,
// and what they have taken. A total is changed inline (the same as the pencil on
// the profile's Requests › Leave balance; taken days never change), or for
// everyone at once from an Excel sheet of latest balances (Import).
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { getLeaveBalances, setEmployeeLeaveTotal } from '../../services/hrms';
import type { LeaveBalanceCellDTO, LeaveBalancePersonDTO, LeaveBalancesDTO } from '../../services/hrms';
import { ApiError } from '../../services/http';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, LoadError, SearchInput, Th } from '../ui';
import type { LoadState } from '../ui';
import { FiltersButton, FiltersPanel, LabeledSelect } from './LabeledSelect';
import { useFilterDraft } from './useFilterDraft';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, iconBtn, TH, toolbar, TR } from '../ds';
import { IconDownload, IconEye } from '../icons';
import { PdEdit } from './pdIcons';
import { canOpen } from '../access';
import { useAuth } from '../auth/AuthContext';
import { StatTile, ViewToggle } from './leaveParts';
import { Pager, usePaged } from './Pager';
import { LeaveBalanceImport } from './LeaveBalanceImport';
import './people.css';

const days = (n: number) => String(Math.round(n * 100) / 100);
/** A yearly, paid type: one with a total HR can set. */
const counted = (c: LeaveBalanceCellDTO) => c.editable === true;

/** What this session has already loaded: a revisit shows it at once while the fresh answer comes in. */
let memo: LeaveBalancesDTO | null = null;

export function LeaveBalances() {
  const s = useStore();
  const { user } = useAuth();
  const [data, setData] = useState<LeaveBalancesDTO | null>(memo);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'balances' | 'import'>('balances');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [location, setLocation] = useState('all');
  const [template, setTemplate] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('name');
  const [pick, setPick] = useState<'all' | 'none'>('all');
  const [editing, setEditing] = useState<{ userId: string; key: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const filters = useFilterDraft(
    { dept, location, template, type, sort },
    (v) => { setDept(v.dept); setLocation(v.location); setTemplate(v.template); setType(v.type); setSort(v.sort); },
    { dept: 'all', location: 'all', template: 'all', type: 'all', sort: 'name' },
  );

  useEffect(() => {
    let live = true;
    setError('');
    getLeaveBalances()
      .then((d) => { memo = d; if (live) setData(d); })
      .catch((e) => { if (live && !memo) setError(e instanceof Error ? e.message : 'Could not load the balances'); });
    return () => { live = false; };
  }, [attempt]);

  const state: LoadState = error ? 'error' : data ? 'ready' : 'loading';
  // Setting a total writes as the profile does (People › Employees, and the right to edit details).
  const canWrite = canOpen(user, 'employees') && user?.canEditEmployees === true;
  const people = useMemo(() => data?.people ?? [], [data]);
  const shownTypes = (data?.types ?? []).filter((t) => type === 'all' || t.key === type);
  const cellOf = (p: LeaveBalancePersonDTO, key: string) => p.types.find((t) => t.key === key);
  const runsOut = (p: LeaveBalancePersonDTO) => p.types.some((t) => counted(t) && t.total > 0 && t.remaining <= 0 && (type === 'all' || t.key === type));
  const availableOf = (p: LeaveBalancePersonDTO) => p.types.filter((t) => counted(t) && (type === 'all' || t.key === type)).reduce((a, t) => a + t.remaining, 0);
  const takenOf = (p: LeaveBalancePersonDTO) => p.types.filter((t) => !t.unpaid && (type === 'all' || t.key === type)).reduce((a, t) => a + t.used, 0);

  const departments = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean))].sort(), [people]);
  const locations = useMemo(() => [...new Set(people.map((p) => p.location).filter(Boolean))].sort(), [people]);
  const templates = useMemo(() => [...new Set(people.map((p) => p.template).filter(Boolean))].sort(), [people]);

  // Every filter but the tiles' own pick: the tiles and the list read this same set.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (dept !== 'all' && p.department !== dept) return false;
      if (location !== 'all' && p.location !== location) return false;
      if (template !== 'all' && p.template !== template) return false;
      if (type !== 'all' && !cellOf(p, type)) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.employeeId.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [people, search, dept, location, template, type]);
  const shown = useMemo(() => {
    const out = pick === 'none' ? base.filter(runsOut) : base.slice();
    if (sort === 'least') out.sort((a, b) => availableOf(a) - availableOf(b) || a.name.localeCompare(b.name));
    else if (sort === 'taken') out.sort((a, b) => takenOf(b) - takenOf(a) || a.name.localeCompare(b.name));
    else if (sort === 'code') out.sort((a, b) => (a.employeeId || '~').localeCompare(b.employeeId || '~', undefined, { numeric: true }));
    return out;
  }, [base, pick, sort, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const paged = usePaged(shown, `${pick}|${search}|${dept}|${location}|${template}|${type}|${sort}|${people.length}`);

  const stats = useMemo(() => ({
    people: base.length,
    templates: new Set(base.map((p) => p.template).filter(Boolean)).size,
    available: Math.round(base.reduce((a, p) => a + availableOf(p), 0) * 100) / 100,
    taken: Math.round(base.reduce((a, p) => a + takenOf(p), 0) * 100) / 100,
    none: base.filter(runsOut).length,
  }), [base, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportRows = () =>
    downloadCsv<LeaveBalancePersonDTO>(
      `leave-balances-${data?.year ?? ''}`,
      [
        { header: 'Employee', value: (p) => p.name },
        { header: 'Employee ID', value: (p) => p.employeeId },
        { header: 'Department', value: (p) => p.department },
        { header: 'Location', value: (p) => p.location },
        { header: 'Template', value: (p) => p.template },
        ...shownTypes.flatMap((t) => [
          { header: `${t.name} available`, value: (p: LeaveBalancePersonDTO) => { const c = cellOf(p, t.key); return p.unlimitedLeave ? 'Unlimited' : c && !c.unpaid ? days(c.remaining) : ''; } },
          { header: `${t.name} total`, value: (p: LeaveBalancePersonDTO) => { const c = cellOf(p, t.key); return p.unlimitedLeave ? 'Unlimited' : c && !c.unpaid ? days(c.total) : ''; } },
          { header: `${t.name} taken`, value: (p: LeaveBalancePersonDTO) => { const c = cellOf(p, t.key); return c ? days(c.used) : ''; } },
        ]),
      ],
      shown,
    );

  const save = async (p: LeaveBalancePersonDTO, c: LeaveBalanceCellDTO) => {
    if (!editing) return;
    const total = Number(editing.value);
    if (!Number.isFinite(total) || total < 0) { setEditError('Enter a number of days'); return; }
    if (total < c.used) { setEditError(`${days(c.used)} days are already taken, so the total can’t be less`); return; }
    setSaving(true);
    setEditError('');
    try {
      const next = await setEmployeeLeaveTotal(p.userId, c.key, total);
      setData((d) => {
        if (!d) return d;
        const out = { ...d, people: d.people.map((x) => (x.userId === p.userId ? { ...x, types: x.types.map((t) => ({ ...t, ...(next.types.find((n) => n.key === t.key) ?? {}) })) } : x)) };
        memo = out;
        return out;
      });
      setEditing(null);
      s.flash(`${p.name.split(' ')[0]}’s ${c.name} total is ${days(total)}`);
    } catch (e) {
      setEditError(e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t save the total');
    } finally {
      setSaving(false);
    }
  };

  const cols = `minmax(220px,1.7fr) minmax(110px,.8fr) ${shownTypes.map(() => 'minmax(130px,1fr)').join(' ')} 48px`;
  const canImport = data?.canImport === true && canWrite;
  const toggle = canImport ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 16px' }}>
      <ViewToggle value={view} onChange={setView} options={[
        { key: 'balances', label: 'Balances', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg> },
        { key: 'import', label: 'Import from Excel', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg> },
      ]} />
    </div>
  ) : null;

  if (view === 'import' && canImport && data) {
    return (
      <div style={{ animation: 'fade .3s ease both' }}>
        {toggle}
        <LeaveBalanceImport balances={data} onApplied={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {toggle}
      <Card padded>
        <section aria-labelledby="leave-balances-title" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 id="leave-balances-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{data ? `Leave balances · ${data.year}` : 'Leave balances'}</h2>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>What each person’s app shows: available of the total for the year, per leave type on their template, and what they have taken.</span>
          </div>

          {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

          <div>
            <div style={toolbar}>
              <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search employee, ID or email…" width="100%" />
              </div>
              <FiltersButton open={filters.open} active={filters.active} onClick={filters.toggle} />
              <button onClick={exportRows} disabled={shown.length === 0} className={btnClass()} style={btn()}>
                <IconDownload stroke="currentColor" /> Export
              </button>
            </div>
            {filters.open && (
              <FiltersPanel active={filters.active} dirty={filters.dirty} onApply={filters.apply} onClear={filters.clear}>
                <LabeledSelect label="Department" value={filters.draft.dept} onChange={(v) => filters.set('dept', v)} options={[['all', 'All departments'], ...departments.map((d): [string, string] => [d, d])]} />
                {locations.length > 0 && <LabeledSelect label="Location" value={filters.draft.location} onChange={(v) => filters.set('location', v)} options={[['all', 'All locations'], ...locations.map((d): [string, string] => [d, d])]} />}
                <LabeledSelect label="Template" value={filters.draft.template} onChange={(v) => filters.set('template', v)} options={[['all', 'All templates'], ...templates.map((d): [string, string] => [d, d])]} />
                <LabeledSelect label="Leave type" value={filters.draft.type} onChange={(v) => filters.set('type', v)} options={[['all', 'All types'], ...(data?.types ?? []).map((t): [string, string] => [t.key, t.name])]} />
                <LabeledSelect label="Sort" value={filters.draft.sort} onChange={(v) => filters.set('sort', v)}
                  options={[['name', 'Name A–Z'], ['code', 'Employee ID'], ['least', 'Least available'], ['taken', 'Most taken']]} />
              </FiltersPanel>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <StatTile state={state} label="Employees" value={stats.people} sub={`On ${stats.templates} ${stats.templates === 1 ? 'template' : 'templates'}`} onPick={() => setPick('all')} picked={pick === 'all'} />
            <StatTile state={state} label="Days available" value={days(stats.available)} sub={type === 'all' ? 'Every yearly leave type' : shownTypes[0]?.name} color="var(--p-green)" />
            <StatTile state={state} label="Days taken this year" value={days(stats.taken)} sub="Approved leave, as it stays" color="var(--p-blue)" />
            <StatTile state={state} label="None left" value={stats.none} sub={stats.none ? 'People with a type used up' : 'Everyone has some left'}
              onPick={() => setPick(pick === 'none' ? 'all' : 'none')} picked={pick === 'none'} color="var(--p-red)" />
          </div>

          <div>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 420 + shownTypes.length * 150 }}>
                <div style={TH(cols)}>
                  <Th>EMPLOYEE</Th>
                  <Th>TEMPLATE</Th>
                  {shownTypes.map((t) => <Th key={t.key}>{t.name.toUpperCase()}</Th>)}
                  <Th align="right"> </Th>
                </div>
                {paged.rows.map((p, i) => (
                  <div key={p.userId} className="dc-row" style={{ ...TR(cols, i === paged.rows.length - 1), alignItems: 'start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <PersonAvatar name={p.name} userId={p.userId} />
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.employeeId, p.department].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    <div style={{ alignSelf: 'center', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: p.template ? 'var(--ink)' : 'var(--ink-3)' }}>{p.template || '—'}</div>
                    {p.unlimitedLeave && !p.error && shownTypes.length > 0 && (
                      <div style={{ gridColumn: `span ${shownTypes.length}`, display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'center' }} title="Their template keeps no leave balance: leave is approved, never counted down">
                        <span>Unlimited leave</span>
                        <span style={cellSub}>{days(p.types.reduce((a, t) => a + (t.used || 0), 0))} taken this year</span>
                      </div>
                    )}
                    {!(p.unlimitedLeave && !p.error) && shownTypes.map((t) => {
                      const c = cellOf(p, t.key);
                      const open = editing?.userId === p.userId && editing.key === t.key;
                      if (p.error) return <div key={t.key} style={{ ...cellSub, alignSelf: 'center' }}>—</div>;
                      if (!c) return <div key={t.key} style={{ alignSelf: 'center', color: 'var(--ink-3)' }} title="Not on their template">—</div>;
                      if (c.unpaid) return (
                        <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'center' }}>
                          <span>Unpaid</span><span style={cellSub}>{days(c.used)} taken</span>
                        </div>
                      );
                      if (c.unlimited) return (
                        <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'center' }} title="Their template keeps no leave balance">
                          <span>Unlimited</span><span style={cellSub}>{days(c.used)} taken</span>
                        </div>
                      );
                      if (open && editing) return (
                        <form key={t.key} onSubmit={(e) => { e.preventDefault(); void save(p, c); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <label style={{ fontSize: 11.5, color: 'var(--ink-3)' }} htmlFor={`lb-${p.userId}-${c.key}`}>Total for the year</label>
                          <input id={`lb-${p.userId}-${c.key}`} type="number" min={c.used} step={0.5} autoFocus value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            style={{ height: 32, width: '100%', maxWidth: 120, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 8, font: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }} />
                          <span style={cellSub}>{days(c.used)} taken · stays as it is</span>
                          {editError && <span style={{ fontSize: 12, color: 'var(--bad)' }}>{editError}</span>}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="submit" className={btnClass('primary')} style={{ ...btn('primary'), height: 30, padding: '0 12px', fontSize: 12.5 }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                            <button type="button" className={btnClass()} style={{ ...btn(), height: 30, padding: '0 12px', fontSize: 12.5 }} disabled={saving} onClick={() => { setEditing(null); setEditError(''); }}>Cancel</button>
                          </div>
                        </form>
                      );
                      const out = counted(c) && c.total > 0 && c.remaining <= 0;
                      return (
                        <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: out ? 'var(--bad)' : 'var(--ink)' }}>
                              {days(c.remaining)}<span style={{ color: 'var(--ink-3)' }}> / {days(c.total)}</span>
                            </span>
                            {canWrite && p.canEdit && c.editable && (
                              <button type="button" className="pd-sec-act" aria-label={`Edit ${p.name}'s ${c.name} total`} title="Edit the total"
                                onClick={() => { setEditError(''); setEditing({ userId: p.userId, key: c.key, value: days(c.total) }); }}
                                style={{ padding: 2 }}><PdEdit size={14} /></button>
                            )}
                          </div>
                          <span style={cellSub}>{days(c.used)} taken{c.cadence === 'monthly' ? ' · this month' : ''}</span>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignSelf: 'center' }}>
                      {canOpen(user, 'employees') && (
                        <button type="button" onClick={() => s.openProfile(p.userId, 'requests')} aria-label={`Open ${p.name}'s profile`} title={p.error ?? 'Open their profile'} className="ds-icon-btn" style={iconBtn(34)}><IconEye stroke="currentColor" /></button>
                      )}
                    </div>
                  </div>
                ))}
                {state === 'loading' && <ListPending state="loading" cols={4} />}
                {state === 'ready' && shown.length === 0 && <EmptyRow text={people.length ? 'Nobody matches your filters.' : 'No active employees yet.'} />}
              </div>
              <Pager p={paged} />
            </div>
          </div>
        </section>
      </Card>
    </div>
  );
}
