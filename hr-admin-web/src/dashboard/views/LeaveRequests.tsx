import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, PageActions, SearchInput, SelectBox, StatusTabs, Th } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, SEG, segBtn, TH, toolbar } from '../ds';
import { IconDownload } from '../icons';
import { LeaveCalendar } from './LeaveCalendar';
import {
  chartDaysOf, dayLabel, leaveDates, needsActionSummary, overlaps, peopleTotals, pendingFacts, perDay, periodRange, plural,
  LEAVE_COLS, rangeProblem, SLOW_DAYS, startOf, todayISO,
} from './leaveDays';
import type { PeriodId } from './leaveDays';
import { CustomRange, DayBars, Flag, LeaveRow, LinkButton, NeedsActionShell, PendingChip, PeriodButtons, StatTile, Swatch, Waiting } from './leaveParts';

const NEEDS_ACTION_SHOWN = 5;
const PERIODS: [PeriodId, string][] = [['last', 'Last month'], ['week', 'This week'], ['month', 'This month'], ['next', 'Next month'], ['all', 'All dates'], ['custom', 'Custom']];
const startsIn = (n: number) => (n === 0 ? 'Starts today' : n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`);

function NeedsAction({ state, onAll }: { state: LoadState; onAll: () => void }) {
  const s = useStore();
  const sum = needsActionSummary(s.leaves);
  const today = todayISO();
  // The most urgent first: dates already gone, then the soonest to start.
  const list = sum.pending.slice().sort((a, b) => startOf(a).localeCompare(startOf(b)));
  if (state === 'ready' && list.length === 0) return null;
  const chips = [
    ...(sum.passed ? [{ tone: 'bad' as const, text: `${sum.passed} ${sum.passed === 1 ? 'date' : 'dates'} already passed` }] : []),
    ...(sum.soon ? [{ tone: 'warn' as const, text: `${sum.soon} start within 7 days` }] : []),
    ...(sum.slow ? [{ tone: 'mute' as const, text: `${sum.slow} waiting over ${SLOW_DAYS} days` }] : []),
  ];
  return (
    <NeedsActionShell
      id="leave-needs-action"
      state={state}
      summary={`${plural(list.length, 'request')} waiting for approval · all dates`}
      chips={chips}
      more={list.length > NEEDS_ACTION_SHOWN ? <LinkButton onClick={onAll}>View all {list.length} pending</LinkButton> : undefined}
    >
      {list.slice(0, NEEDS_ACTION_SHOWN).map((l) => {
        const f = pendingFacts(l, today);
        return (
          <div key={l.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) minmax(170px,1.2fr) minmax(150px,1.1fr) minmax(100px,.7fr) minmax(120px,auto)', alignItems: 'center', gap: 16, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <PersonAvatar name={l.name} userId={l.submitterId} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.eRemark}>{l.type}{l.eRemark ? ` · ${l.eRemark}` : ''}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13.5 }}>{l.from === l.to ? l.from : `${l.from} – ${l.to}`} · {l.days}</span>
              {f.passed ? <Flag tone="bad">Date passed, still pending</Flag> : <Flag tone={f.soon ? 'warn' : 'mute'}>{startsIn(f.toStart)}</Flag>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={cellSub}>Manager</span>
              <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.manager || '—'}</span>
            </div>
            <Waiting days={f.waited} slow={SLOW_DAYS} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PendingChip dot onClick={() => s.setDrawerId(l.id)} label={`Review ${l.name}'s leave request`} />
            </div>
          </div>
        );
      })}
      <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={5} />
    </NeedsActionShell>
  );
}

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

  const chartDays = chartDaysOf(range);
  const totals = useMemo(() => peopleTotals(perDay(inPeriod, chartDays)), [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const off = inPeriod.filter((l) => l.status === 'Approved' || l.status === 'Pending');
    const inside = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to);
    let days = 0;
    for (const l of inPeriod) if (l.status === 'Approved') days += Math.min(l.dayN || 0, leaveDates(l).filter(inside).length);
    let best = -1;
    totals.forEach((t, i) => { if (t.a + t.p > 0 && (best < 0 || t.a + t.p > totals[best].a + totals[best].p)) best = i; });
    return {
      people: new Set(off.map((l) => l.submitterId || l.name)).size,
      days: Math.round(days * 10) / 10,
      pending: inPeriod.filter((l) => l.status === 'Pending').length,
      approved: inPeriod.filter((l) => l.status === 'Approved').length,
      declined: inPeriod.filter((l) => l.status === 'Declined').length,
      busiest: best >= 0 ? { d: chartDays[best], n: totals[best].a + totals[best].p } : null,
    };
  }, [inPeriod, totals]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const problem = rangeProblem(draftFrom, draftTo);
    setRangeError(problem);
    if (problem) return;
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
  const openCalendar = (day: string | null) => {
    setCalDay(day);
    setView('calendar');
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
            <PeriodButtons periods={PERIODS} period={period} onPeriod={setPeriod} />
          </div>

          {period === 'custom' && (
            <CustomRange
              applied={!!s.leaveFrom}
              draftFrom={draftFrom}
              draftTo={draftTo}
              onDraftFrom={(v) => { setDraftFrom(v); setRangeError(''); }}
              onDraftTo={(v) => { setDraftTo(v); setRangeError(''); }}
              onApply={applyCustom}
              error={rangeError}
              hint="Pick a date range to see who is on leave in it."
            />
          )}

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <StatTile state={st} label="People on leave" value={stats.people} />
              <StatTile state={st} label="Leave days approved" value={stats.days} />
              <StatTile state={st} label="Pending" value={stats.pending} warn />
              <StatTile state={st} label="Approved · Declined" value={<>{stats.approved} <span style={{ fontSize: 17, color: 'var(--ink-3)' }}>· {stats.declined}</span></>} />
              <StatTile
                state={st}
                label="Most people off"
                value={stats.busiest ? stats.busiest.n : '—'}
                unit={stats.busiest ? 'off' : undefined}
                sub={stats.busiest ? <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{dayLabel(stats.busiest.d)}</span> : chartDays.length ? 'Nobody off' : 'Pick a shorter period'}
                action={stats.busiest ? <LinkButton onClick={() => openCalendar(stats.busiest!.d)}>See on calendar</LinkButton> : undefined}
              />
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>People on leave, day by day</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="approved" />Approved</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="pending" />Pending</span>
                  <LinkButton onClick={() => openCalendar(null)}>Open calendar</LinkButton>
                </div>
              </div>
              <DayBars days={chartDays} totals={totals} today={today} />
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
                  <div style={TH(LEAVE_COLS)}>
                    <Th>EMPLOYEE</Th>
                    <Th>TYPE</Th>
                    <Th>LEAVE DATES</Th>
                    <Th>DAYS</Th>
                    <Th>REASON</Th>
                    <Th>MANAGER</Th>
                    <Th>STATUS</Th>
                    <Th align="right">APPLIED</Th>
                  </div>
                  {rows.map((r, i) => <LeaveRow key={r.id} r={r} last={i === rows.length - 1} onOpen={() => s.setDrawerId(r.id)} />)}
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
