import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import type { ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, PageActions, SearchInput, SelectBox, StatusTabs, Th } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, TH, toolbar } from '../ds';
import { IconDownload } from '../icons';
import { LeaveCalendar } from './LeaveCalendar';
import {
  chartDaysOf, leaveDates, needsActionSummary, overlaps, peopleTotals, pendingFacts, perDay, periodRange, plural,
  LEAVE_COLS, rangeProblem, SLOW_DAYS, startOf, todayISO,
} from './leaveDays';
import type { PeriodId } from './leaveDays';
import { CustomRange, Flag, LeaveRow, NeedsActionShell, PendingChip, PeriodButtons, StatTile, Waiting } from './leaveParts';
import { Pager, usePaged } from './Pager';

const NEEDS_ACTION_SHOWN = 3;
const PERIODS: [PeriodId, string][] = [['last', 'Last month'], ['week', 'This week'], ['month', 'This month'], ['next', 'Next month'], ['custom', 'Custom']];
const startsIn = (n: number) => (n === 0 ? 'Starts today' : n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`);

/** Needs action's tags: all of it, or one kind. Picking one shows exactly those requests in the list below. */
type NeedsPick = 'all' | 'passed' | 'soon' | 'slow' | 'cancel';
const NEEDS_LABEL: Record<Exclude<NeedsPick, 'all'>, string> = { passed: 'Date already passed', soon: 'Start within 7 days', slow: `Waiting over ${SLOW_DAYS} days`, cancel: 'Cancellation requests' };
function fitsNeeds(l: Leave, k: NeedsPick, today: string): boolean {
  if (k === 'all') return true;
  if (k === 'cancel') return l.status !== 'Pending';
  const f = pendingFacts(l, today);
  if (k === 'slow') return f.slow;
  return l.status === 'Pending' && (k === 'passed' ? f.passed : f.soon);
}

function NeedsAction({ state }: { state: LoadState }) {
  const s = useStore();
  const sum = needsActionSummary(s.leaves);
  const today = todayISO();
  // The most urgent first: dates already gone, then the soonest to start. Cancellation requests too,
  // so the count matches the sidebar badge and Overview.
  const everything = sum.all.slice().sort((a, b) => startOf(a).localeCompare(startOf(b)));
  // The tags filter this table only (the list below stays as it is): none picked shows the first few,
  // a tag shows every request of its kind here, a page at a time.
  const [pick, setPick] = useState<NeedsPick | null>(null);
  const matching = everything.filter((l) => fitsNeeds(l, pick ?? 'all', today));
  const paged = usePaged(matching, pick);
  if (state === 'ready' && everything.length === 0) return null;
  const list = pick ? paged.rows : matching.slice(0, NEEDS_ACTION_SHOWN);
  const tag = (k: NeedsPick, tone: 'bad' | 'attn' | 'mute', text: string, count: number) => ({ tone, text, count, picked: pick === k, onPick: () => setPick(pick === k ? null : k) });
  const chips = [
    ...(sum.passed ? [tag('passed', 'bad', NEEDS_LABEL.passed, sum.passed)] : []),
    ...(sum.soon ? [tag('soon', 'attn', NEEDS_LABEL.soon, sum.soon)] : []),
    ...(sum.slow ? [tag('slow', 'mute', NEEDS_LABEL.slow, sum.slow)] : []),
    ...(sum.cancellations.length ? [tag('cancel', 'attn', NEEDS_LABEL.cancel, sum.cancellations.length)] : []),
    tag('all', 'mute', 'All', everything.length),
  ];
  const summary = sum.cancellations.length
    ? `${plural(sum.pending.length, 'request')} waiting for approval, ${plural(sum.cancellations.length, 'cancellation request')} · all dates`
    : `${plural(everything.length, 'request')} waiting for approval · all dates`;
  return (
    <NeedsActionShell
      id="leave-needs-action"
      state={state}
      summary={summary}
      chips={chips}
    >
      {list.map((l) => {
        const f = pendingFacts(l, today);
        const cancel = l.status !== 'Pending';
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
              {cancel
                ? <Flag tone="attn">Cancellation requested{l.cancelRequest?.requested ? ` · ${l.cancelRequest.requested}` : ''}</Flag>
                : f.passed ? <Flag tone="bad">Date passed, still pending</Flag> : <Flag tone={f.soon ? 'attn' : 'mute'}>{startsIn(f.toStart)}</Flag>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={cellSub}>Manager</span>
              <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.manager || '—'}</span>
            </div>
            <Waiting days={f.waited} slow={SLOW_DAYS} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PendingChip dot onClick={() => s.setDrawerId(l.id)} label={cancel ? `Review ${l.name}'s cancellation request` : `Review ${l.name}'s leave request`} />
            </div>
          </div>
        );
      })}
      <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={5} />
      {pick && <div style={{ padding: '0 18px 12px' }}><Pager p={paged} /></div>}
    </NeedsActionShell>
  );
}

export function LeaveRequests() {
  const s = useStore();
  const st = s.listState('leaves');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [period, setPeriod] = useState<PeriodId>('month');
  const [draftFrom, setDraftFrom] = useState(s.leaveFrom);
  const [draftTo, setDraftTo] = useState(s.leaveTo);
  const [rangeError, setRangeError] = useState('');
  const [dept, setDept] = useState('all');

  const range = periodRange(period, s.leaveFrom, s.leaveTo);
  const waitingForDates = period === 'custom' && !s.leaveFrom;
  const inPeriod = useMemo(() => s.leaves.filter((l) => overlaps(l, range.from, range.to)), [s.leaves, range.from, range.to]);

  const chartDays = chartDaysOf(range);
  const totals = useMemo(() => peopleTotals(perDay(inPeriod, chartDays)), [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const off = inPeriod.filter((l) => l.status === 'Approved' || l.status === 'Pending');
    const inside = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to);
    let days = 0;
    // A leave wholly inside the period counts the server's days. One that runs past either end is cut
    // by its dates with Saturday and Sunday taken out: nobody's week offs or holidays are at hand here,
    // so that figure is approximate, and the tile says so.
    let approx = false;
    for (const l of inPeriod) {
      if (l.status !== 'Approved') continue;
      const dates = leaveDates(l);
      const kept = dates.filter(inside).length;
      if (kept < dates.length) approx = true;
      days += kept < dates.length ? Math.min(l.dayN || 0, kept) : l.dayN || 0;
    }
    let best = -1;
    totals.forEach((t, i) => { if (t.a + t.p > 0 && (best < 0 || t.a + t.p > totals[best].a + totals[best].p)) best = i; });
    return {
      people: new Set(off.map((l) => l.submitterId || l.name)).size,
      days: Math.round(days * 10) / 10,
      approx,
      pending: inPeriod.filter((l) => l.status === 'Pending').length,
      approved: inPeriod.filter((l) => l.status === 'Approved').length,
      declined: inPeriod.filter((l) => l.status === 'Declined').length,
      busiest: best >= 0 ? { d: chartDays[best], n: totals[best].a + totals[best].p } : null,
    };
  }, [inPeriod, totals]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(() => [...new Set(s.leaves.map((l) => l.team))].sort(), [s.leaves]);
  // A cancellation request waits on HR whatever its leave's dates, so its tab reads every date.
  const cancellations = useMemo(() => s.leaves.filter((r) => r.cancelRequest?.status === 'Pending'), [s.leaves]);
  const rows = useMemo(() => {
    let out = s.leaveStatus === 'Cancellation' ? cancellations.slice() : inPeriod.slice();
    const q = s.leaveSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    if (s.leaveStatus !== 'all' && s.leaveStatus !== 'Cancellation') out = out.filter((r) => r.status === s.leaveStatus);
    if (s.leaveType !== 'all') out = out.filter((r) => r.type === s.leaveType);
    if (dept !== 'all') out = out.filter((r) => r.team === dept);
    const sort = s.leaveSort;
    if (sort === 'recent') out.sort((a, b) => b.ord - a.ord);
    else if (sort === 'oldest') out.sort((a, b) => a.ord - b.ord);
    else if (sort === 'date') out.sort((a, b) => startOf(a).localeCompare(startOf(b)));
    else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'days') out.sort((a, b) => b.dayN - a.dayN);
    return out;
  }, [inPeriod, cancellations, s.leaveSearch, s.leaveStatus, s.leaveType, s.leaveSort, dept]);
  const paged = usePaged(rows, `${rows.length}|${rows[0]?.id ?? ''}`);

  const statusCounts = useMemo(() => {
    const c: Partial<Record<ReqStatus | 'all' | 'Cancellation', number>> = { all: inPeriod.length };
    for (const l of inPeriod) c[l.status] = (c[l.status] ?? 0) + 1;
    // Every date, as the tab lists them.
    if (cancellations.length) c.Cancellation = cancellations.length;
    return c;
  }, [inPeriod, cancellations]);

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
        { header: 'Status', value: (r) => r.statusLabel },
        { header: 'Decided by', value: (r) => (r.status === 'Cancelled' && !r.cancelRequest ? 'employee (cancelled)' : r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
        { header: 'Cancellation request', value: (r) => (r.cancelRequest ? `${r.cancelRequest.status}${r.cancelRequest.byAdmin ? ' (admin)' : ''}` : '') },
        { header: 'Cancellation note', value: (r) => r.cancelNote },
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
  /** Brings the request list (its status tabs) to the top of the screen, once it has rendered. */
  const toList = () => {
    let tries = 0;
    const go = () => {
      const el = document.getElementById('leave-list');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tries++ < 20) setTimeout(go, 50);
    };
    setTimeout(go, 50);
  };
  /** Pending, every date: where Needs action's "View all" and the calendar's banner lead. */
  const showAllPending = () => {
    setView('list');
    setPeriod('all');
    s.setLeaveStatus('Pending');
    toList();
  };
  /** Cancellation requests, which read every date whatever the period. */
  const showCancellations = () => {
    setView('list');
    s.setLeaveStatus('Cancellation');
    toList();
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

  const toggleBtn = (on: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 18px', borderRadius: 999, border: 0, cursor: 'pointer',
    font: 'inherit', fontSize: 14, fontWeight: 600, transition: 'background .15s, color .15s',
    background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--accent-ink)',
    boxShadow: on ? '0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent)' : undefined,
  });
  const viewToggle = (
    <div role="group" aria-label="View" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: 'var(--accent-soft)', border: '1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)' }}>
      <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} style={toggleBtn(view === 'list')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
        List
      </button>
      <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')} style={toggleBtn(view === 'calendar')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
        Calendar
      </button>
    </div>
  );

  if (view === 'calendar') {
    return (
      <div style={{ animation: 'fade .3s ease both' }}>
        <PageActions>{viewToggle}</PageActions>
        <LeaveCalendar state={st} initialDay={null} onPending={showAllPending} onCancellations={showCancellations} onOpenDay={showDay} />
      </div>
    );
  }

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        {viewToggle}
      </PageActions>

      <NeedsAction state={st} />

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
              {/* Each tile filters the list below to what it counts, and brings the list into view. */}
              <StatTile state={st} label="People on leave" value={stats.people}
                onPick={() => { s.setLeaveStatus('all'); toList(); }} picked={s.leaveStatus === 'all'} />
              <StatTile
                state={st}
                label="Leave days approved"
                value={stats.approx ? <>≈ {stats.days}</> : stats.days}
                sub={`${stats.approved} ${stats.approved === 1 ? 'request' : 'requests'}`}
                onPick={() => { s.setLeaveStatus('Approved'); toList(); }} picked={s.leaveStatus === 'Approved'} color="var(--p-green)"
              />
              <StatTile state={st} label="Pending" value={stats.pending} attn={s.leaveStatus !== 'Pending'}
                onPick={() => { s.setLeaveStatus('Pending'); toList(); }} picked={s.leaveStatus === 'Pending'} color="var(--p-yellow)" />
              <StatTile state={st} label="Declined" value={stats.declined}
                onPick={() => { s.setLeaveStatus('Declined'); toList(); }} picked={s.leaveStatus === 'Declined'} color="var(--p-red)" />
            </div>
          )}


          {!waitingForDates && (
            <div id="leave-list" style={{ scrollMarginTop: 96 }}>
              <div style={toolbar}>
                <StatusTabs<ReqStatus | 'all' | 'Cancellation'>
                  options={['all', 'Pending', 'Approved', 'Declined', 'Cancelled', 'Cancellation']}
                  labels={{ Cancellation: 'Cancellation requests' }}
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
                <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
                  <IconDownload stroke="currentColor" /> Export
                </button>
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
                  {paged.rows.map((r, i) => <LeaveRow key={r.id} r={r} last={i === paged.rows.length - 1} onOpen={() => s.setDrawerId(r.id)} />)}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No requests match your filters." />}
                </div>
                <Pager p={paged} />
              </div>
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}
