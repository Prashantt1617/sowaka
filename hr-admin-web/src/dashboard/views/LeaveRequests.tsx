import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { STAT, typeColor } from '../theme';
import type { ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, LoadingFigure, PageActions, Pill, SearchInput, SelectBox, StatusTabs, Th } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, SEG, segBtn, TH, TILE, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { LeaveCalendar } from './LeaveCalendar';
import {
  addDays, dateOf, dayLabel, daysBetween, daysIn, isoOf, leaveDates, MON, MONTH, needsActionSummary, overlaps,
  pendingFacts, perDay, SLOW_DAYS, startOf, todayISO,
} from './leaveDays';
import { DayBars, Swatch } from './leaveParts';

const COLS = '1.7fr 1fr 1.3fr .6fr 1.7fr 1.3fr 1.1fr .8fr';
const NEEDS_ACTION_SHOWN = 5;

export type PeriodId = 'last' | 'week' | 'month' | 'next' | 'all' | 'custom';
const PERIODS: [PeriodId, string][] = [['last', 'Last month'], ['week', 'This week'], ['month', 'This month'], ['next', 'Next month'], ['all', 'All dates'], ['custom', 'Custom']];

/** The bounds of a period, and its heading. Empty bounds are open. */
function periodRange(id: PeriodId, customFrom: string, customTo: string): { from: string; to: string; title: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const month = (k: number) => {
    const first = new Date(y, m + k, 1);
    return { from: isoOf(first), to: isoOf(new Date(first.getFullYear(), first.getMonth() + 1, 0)), title: `${MONTH[first.getMonth()]} ${first.getFullYear()}` };
  };
  if (id === 'last') return month(-1);
  if (id === 'next') return month(1);
  if (id === 'month') return month(0);
  if (id === 'week') {
    const back = (now.getDay() + 6) % 7; // Monday starts the week
    const from = addDays(todayISO(), -back);
    const to = addDays(from, 6);
    const f = dateOf(from), t = dateOf(to);
    const span = f.getMonth() === t.getMonth() ? `${f.getDate()}–${t.getDate()} ${MON[t.getMonth()]}` : `${f.getDate()} ${MON[f.getMonth()]} – ${t.getDate()} ${MON[t.getMonth()]}`;
    return { from, to, title: `This week · ${span}` };
  }
  if (id === 'custom') {
    if (!customFrom) return { from: '', to: '', title: 'Custom range' };
    return { from: customFrom, to: customTo, title: customFrom === customTo ? dayLabel(customFrom) : `${dayLabel(customFrom)} – ${dayLabel(customTo)}` };
  }
  return { from: '', to: '', title: 'All dates' };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const startsIn = (n: number) => (n === 0 ? 'Starts today' : n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`);

const FLAG: Record<'bad' | 'warn' | 'mute', CSSProperties> = {
  bad: { background: 'var(--bad-bg)', color: 'var(--bad)' },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn)' },
  mute: { background: 'var(--mute-bg)', color: 'var(--ink-2)' },
};
const chip = (tone: keyof typeof FLAG, small = false): CSSProperties => ({
  ...FLAG[tone],
  display: 'inline-block',
  alignSelf: 'flex-start',
  fontSize: small ? 11.5 : 12.5,
  fontWeight: 500,
  padding: small ? '2px 8px' : '4px 10px',
  borderRadius: small ? 6 : 999,
  whiteSpace: 'nowrap',
});

function NeedsAction({ state, onAll }: { state: LoadState; onAll: () => void }) {
  const s = useStore();
  const sum = needsActionSummary(s.leaves);
  const today = todayISO();
  // The most urgent first: dates already gone, then the soonest to start.
  const list = sum.pending.slice().sort((a, b) => startOf(a).localeCompare(startOf(b)));
  if (state === 'ready' && list.length === 0) return null;
  return (
    <section aria-labelledby="leave-needs-action" style={{ ...TILE, padding: 0, overflow: 'hidden', border: '1px solid var(--warn-line)', marginBottom: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 22px', background: 'var(--warn-bg)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
          <h2 id="leave-needs-action" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Needs action</h2>
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
            <LoadingFigure state={state} w={140} h={14}>{plural(list.length, 'request')} waiting for approval · all dates</LoadingFigure>
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {sum.passed > 0 && <span style={chip('bad')}>{sum.passed} {sum.passed === 1 ? 'date' : 'dates'} already passed</span>}
          {sum.soon > 0 && <span style={chip('warn')}>{sum.soon} start within 7 days</span>}
          {sum.slow > 0 && <span style={chip('mute')}>{sum.slow} waiting over {SLOW_DAYS} days</span>}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          {list.slice(0, NEEDS_ACTION_SHOWN).map((l) => {
            const f = pendingFacts(l, today);
            const flag = f.passed ? { text: 'Date passed, still pending', tone: 'bad' as const } : { text: startsIn(f.toStart), tone: f.soon ? ('warn' as const) : ('mute' as const) };
            const waitColor = f.waited > SLOW_DAYS ? 'var(--bad)' : f.waited === SLOW_DAYS ? 'var(--warn)' : 'var(--ink)';
            return (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) minmax(170px,1.2fr) minmax(150px,1.1fr) minmax(100px,.7fr) auto', alignItems: 'center', gap: 16, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <PersonAvatar name={l.name} userId={l.submitterId} />
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                    <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.eRemark}>{l.type}{l.eRemark ? ` · ${l.eRemark}` : ''}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13.5 }}>{l.from === l.to ? l.from : `${l.from} – ${l.to}`} · {l.days}</span>
                  <span style={chip(flag.tone, true)}>{flag.text}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={cellSub}>Manager</span>
                  <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.manager || '—'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={cellSub}>Waiting</span>
                  <span style={{ fontSize: 13.5, fontWeight: f.waited >= SLOW_DAYS ? 600 : 400, color: waitColor }}>{f.waited === 0 ? 'Today' : plural(f.waited, 'day')}</span>
                </div>
                <button type="button" onClick={() => s.setDrawerId(l.id)} className={btnClass('dark')} style={btn('dark', 'sm')}>Review</button>
              </div>
            );
          })}
          <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={5} />
        </div>
      </div>
      {list.length > NEEDS_ACTION_SHOWN && (
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onAll} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>View all {list.length} pending</button>
        </div>
      )}
    </section>
  );
}


const statTile: CSSProperties = { border: '1px solid var(--line)', borderRadius: 16, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6 };
const statNum: CSSProperties = { fontSize: 26, fontWeight: 400, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' };

export function LeaveRequests() {
  const s = useStore();
  const st = s.listState('leaves');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calDay, setCalDay] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodId>('month');
  const [draftFrom, setDraftFrom] = useState(s.leaveFrom);
  const [draftTo, setDraftTo] = useState(s.leaveTo);
  const [rangeError, setRangeError] = useState('');
  const [dept, setDept] = useState('all');
  const today = todayISO();

  const range = periodRange(period, s.leaveFrom, s.leaveTo);
  const waitingForDates = period === 'custom' && !s.leaveFrom;
  const inPeriod = useMemo(() => s.leaves.filter((l) => overlaps(l, range.from, range.to)), [s.leaves, range.from, range.to]);

  // The chart's days: the period itself, or for All dates nothing (too long to draw).
  const chartDays = range.from && range.to && daysBetween(range.from, range.to) <= 62 && range.from <= range.to ? daysIn(range.from, range.to) : [];
  const counts = useMemo(() => perDay(inPeriod, chartDays), [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const off = inPeriod.filter((l) => l.status === 'Approved' || l.status === 'Pending');
    const inside = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to);
    let days = 0;
    for (const l of inPeriod) if (l.status === 'Approved') days += Math.min(l.dayN || 0, leaveDates(l).filter(inside).length);
    let busiest: { d: string; n: number } | null = null;
    counts.forEach((c, i) => {
      const n = new Set([...c.approved, ...c.pending].map((l) => l.submitterId || l.name)).size;
      if (n > 0 && (!busiest || n > busiest.n)) busiest = { d: chartDays[i], n };
    });
    return {
      people: new Set(off.map((l) => l.submitterId || l.name)).size,
      days: Math.round(days * 10) / 10,
      approved: inPeriod.filter((l) => l.status === 'Approved').length,
      declined: inPeriod.filter((l) => l.status === 'Declined').length,
      busiest: busiest as { d: string; n: number } | null,
    };
  }, [inPeriod, counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(() => [...new Set(s.leaves.map((l) => l.team))].sort(), [s.leaves]);
  const rows = useMemo(() => {
    let out = inPeriod.slice();
    const q = s.leaveSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    if (s.leaveStatus !== 'all') out = out.filter((r) => r.status === s.leaveStatus);
    if (s.leaveType !== 'all') out = out.filter((r) => r.type === s.leaveType);
    if (dept !== 'all') out = out.filter((r) => r.team === dept);
    const sort = s.leaveSort;
    if (sort === 'recent') out.sort((a, b) => b.ord - a.ord);
    else if (sort === 'oldest') out.sort((a, b) => a.ord - b.ord);
    else if (sort === 'date') out.sort((a, b) => startOf(a).localeCompare(startOf(b)));
    else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'days') out.sort((a, b) => b.dayN - a.dayN);
    return out;
  }, [inPeriod, s.leaveSearch, s.leaveStatus, s.leaveType, s.leaveSort, dept]);

  const statusCounts = useMemo(() => {
    const c: Partial<Record<ReqStatus | 'all', number>> = { all: inPeriod.length };
    for (const l of inPeriod) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [inPeriod]);

  const exportRows = () =>
    downloadCsv<Leave>(
      'leaves',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Type', value: (r) => r.type },
        { header: 'From', value: (r) => r.from },
        { header: 'To', value: (r) => r.to },
        { header: 'Days', value: (r) => r.dayN },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.status === 'Cancelled' ? 'employee (cancelled)' : r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
        { header: 'Applied', value: (r) => r.applied },
      ],
      rows,
    );

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return setRangeError('Pick both a start and an end date.');
    if (draftTo < draftFrom) return setRangeError('The end date is before the start date.');
    setRangeError('');
    s.setLeaveFrom(draftFrom);
    s.setLeaveTo(draftTo);
  };
  /** Pending, every date: where Needs action's "View all" and the calendar's banner lead. */
  const showAllPending = () => {
    setView('list');
    setPeriod('all');
    s.setLeaveStatus('Pending');
  };
  /** One day in the list: from the calendar's "Open in list view". */
  const showDay = (iso: string) => {
    setView('list');
    setPeriod('custom');
    setDraftFrom(iso);
    setDraftTo(iso);
    s.setLeaveFrom(iso);
    s.setLeaveTo(iso);
  };

  const viewToggle = (
    <div role="group" aria-label="View" style={SEG}>
      <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} style={segBtn(view === 'list')}>List</button>
      <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')} style={segBtn(view === 'calendar')}>Calendar</button>
    </div>
  );

  if (view === 'calendar') {
    return (
      <div style={{ animation: 'fade .3s ease both' }}>
        <PageActions>{viewToggle}</PageActions>
        <LeaveCalendar state={st} initialDay={calDay} onPending={showAllPending} onOpenDay={showDay} />
      </div>
    );
  }

  const dateInput: CSSProperties = { height: 40, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 10, font: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        {viewToggle}
        <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export
        </button>
      </PageActions>

      <NeedsAction state={st} onAll={showAllPending} />

      <Card padded>
        <section aria-labelledby="leave-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="leave-period" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{range.title}</h2>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>By the dates people are on leave. A leave that overlaps the period is included.</span>
            </div>
            <div role="group" aria-label="Period" style={SEG}>
              {PERIODS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={segBtn(period === id)}>{label}</button>
              ))}
            </div>
          </div>

          {period === 'custom' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: 16, borderRadius: 14, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
              <span style={{ flex: '1 1 100%', fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>
                {s.leaveFrom ? 'Change the dates and apply again to see a different range.' : 'Pick a date range to see who is on leave in it.'}
              </span>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>From<input type="date" value={draftFrom} onChange={(e) => { setDraftFrom(e.target.value); setRangeError(''); }} style={dateInput} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>To<input type="date" value={draftTo} onChange={(e) => { setDraftTo(e.target.value); setRangeError(''); }} style={dateInput} /></label>
              <button type="button" onClick={applyCustom} className={btnClass('dark')} style={btn('dark')}>Apply</button>
              {rangeError && <span role="alert" style={{ flex: '1 1 100%', fontSize: 12.5, color: 'var(--bad)' }}>{rangeError}</span>}
            </div>
          )}

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={statTile}><span style={cellSub}>People on leave</span><span style={statNum}><LoadingFigure state={st}>{stats.people}</LoadingFigure></span></div>
              <div style={statTile}><span style={cellSub}>Leave days approved</span><span style={statNum}><LoadingFigure state={st}>{stats.days}</LoadingFigure></span></div>
              <div style={statTile}>
                <span style={cellSub}>Approved · Declined</span>
                <span style={statNum}><LoadingFigure state={st}>{stats.approved} <span style={{ fontSize: 17, color: 'var(--ink-3)' }}>· {stats.declined}</span></LoadingFigure></span>
              </div>
              {stats.busiest ? (
                <button type="button" onClick={() => { setCalDay(stats.busiest!.d); setView('calendar'); }} style={{ ...statTile, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--ink)' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--accent-ink)' }}>Busiest day</span>
                  <span style={{ fontSize: 19, fontWeight: 500 }}>{dayLabel(stats.busiest.d)} · {stats.busiest.n} off</span>
                  <span style={{ fontSize: 12.5, color: 'var(--accent-ink)' }}>See on calendar</span>
                </button>
              ) : (
                <div style={statTile}><span style={cellSub}>Busiest day</span><span style={{ fontSize: 19 }}>{chartDays.length ? 'Nobody off' : '—'}</span></div>
              )}
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>People on leave, day by day</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="approved" />Approved</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="pending" />Pending</span>
                  <button type="button" onClick={() => { setCalDay(null); setView('calendar'); }} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)' }}>Open calendar</button>
                </div>
              </div>
              <DayBars days={chartDays} counts={counts} today={today} />
            </div>
          )}

          {!waitingForDates && (
            <div>
              <div style={toolbar}>
                <StatusTabs<ReqStatus | 'all'>
                  options={['all', 'Pending', 'Approved', 'Declined', 'Cancelled']}
                  active={s.leaveStatus}
                  onSelect={s.setLeaveStatus}
                  counts={st === 'ready' ? statusCounts : undefined}
                />
              </div>
              <div style={toolbar}>
                <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                  <SearchInput value={s.leaveSearch} onChange={s.setLeaveSearch} placeholder="Search by employee…" width="100%" />
                </div>
                <SelectBox value={dept} onChange={setDept}>
                  <option value="all">All departments</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </SelectBox>
                <SelectBox value={s.leaveType} onChange={s.setLeaveType}>
                  <option value="all">All types</option>
                  {/* The types that actually appear, so one HR adds shows up here too. */}
                  {[...new Set(s.leaves.map((r) => r.type))].sort().map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </SelectBox>
                <SelectBox value={s.leaveSort} onChange={s.setLeaveSort}>
                  <option value="recent">Applied, newest</option>
                  <option value="oldest">Applied, oldest</option>
                  <option value="date">Leave date</option>
                  <option value="name">Name A–Z</option>
                  <option value="days">Most days</option>
                </SelectBox>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 980 }}>
                  <div style={TH(COLS)}>
                    <Th>EMPLOYEE</Th>
                    <Th>TYPE</Th>
                    <Th>LEAVE DATES</Th>
                    <Th>DAYS</Th>
                    <Th>REASON</Th>
                    <Th>MANAGER</Th>
                    <Th>STATUS</Th>
                    <Th align="right">APPLIED</Th>
                  </div>
                  {rows.map((r, i) => {
                    const pend = r.status === 'Pending';
                    return (
                      <div
                        key={r.id}
                        className="dc-row"
                        onClick={() => s.setDrawerId(r.id)}
                        style={{ ...TR(COLS, i === rows.length - 1), position: 'relative', cursor: 'pointer', ...(pend ? { background: 'var(--warn-bg)', boxShadow: 'inset 3px 0 0 var(--warn)' } : null) }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <PersonAvatar name={r.name} userId={r.submitterId} />
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={cellSub}>{r.team}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: typeColor(r.type) }} />
                          <span>{r.type}</span>
                        </div>
                        <div style={{ whiteSpace: 'nowrap' }}>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</div>
                        <div style={{ whiteSpace: 'nowrap' }}>{r.days}</div>
                        <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
                        <div>
                          <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
                        </div>
                        <div style={{ textAlign: 'right', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.applied}</div>
                      </div>
                    );
                  })}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No requests match your filters." />}
                </div>
              </div>
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}
