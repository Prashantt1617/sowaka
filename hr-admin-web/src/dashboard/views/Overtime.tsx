import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { OTDUR, STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Overtime as OvertimeRow } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, PageActions, Pill, SearchInput, SelectBox, StatusTabs, Th } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { chartDaysOf, dayLabel, daysSince, periodRange, plural, rangeProblem, SLOW_DAYS, todayISO } from './leaveDays';
import type { PeriodId } from './leaveDays';
import { CustomRange, DayBars, NeedsActionShell, PendingChip, PeriodButtons, StatTile, Swatch, Waiting } from './leaveParts';

const COLS = '1.7fr 1.1fr .9fr 2fr 1.1fr .9fr .8fr';
const PERIODS: [PeriodId, string][] = [['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['all', 'All dates'], ['custom', 'Custom']];
/** Comp-off an approved overtime credits, as the server credits it. */
const CREDIT: Record<OvertimeRow['duration'], number> = { 'Half day': 0.5, 'Full day': 1 };
const workDay = (r: OvertimeRow) => (r.refISO || '').slice(0, 10);
const worked = (r: OvertimeRow) => (workDay(r) ? dayLabel(workDay(r)) : r.otDate);

function NeedsAction({ state }: { state: LoadState }) {
  const s = useStore();
  // The longest wait first.
  const list = s.ots.filter((r) => r.status === 'Pending').sort((a, b) => a.ord - b.ord);
  if (state === 'ready' && list.length === 0) return null;
  const slow = list.filter((r) => daysSince(r.ord) > SLOW_DAYS).length;
  return (
    <NeedsActionShell
      id="ot-needs-action"
      state={state}
      summary={`${plural(list.length, 'request')} waiting for a decision · all dates`}
      chips={slow ? [{ tone: 'bad', text: `${slow} waiting over ${SLOW_DAYS} days` }] : []}
    >
      {list.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.6fr) minmax(190px,1.3fr) minmax(110px,.7fr) minmax(120px,1fr)', alignItems: 'center', gap: 16, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <PersonAvatar name={r.name} userId={r.submitterId} />
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark}>{r.team}{r.eRemark ? ` · ${r.eRemark}` : ''}</span>
            </div>
          </div>
          <span style={{ fontSize: 13.5 }}>{worked(r)} · {r.duration}</span>
          <Waiting days={daysSince(r.ord)} slow={SLOW_DAYS} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PendingChip dot onClick={() => s.setOtDrawerId(r.id)} label={`Review ${r.name}'s overtime request`} />
          </div>
        </div>
      ))}
      <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={4} />
    </NeedsActionShell>
  );
}

export function Overtime() {
  const s = useStore();
  const st = s.listState('overtime');
  const [period, setPeriod] = useState<PeriodId>('month');
  const [draftFrom, setDraftFrom] = useState(s.otFrom);
  const [draftTo, setDraftTo] = useState(s.otTo);
  const [rangeError, setRangeError] = useState('');
  const [dept, setDept] = useState('all');
  const today = todayISO();

  const range = periodRange(period, s.otFrom, s.otTo);
  const waitingForDates = period === 'custom' && !s.otFrom;
  // By the day the overtime was worked.
  const inPeriod = useMemo(() => s.ots.filter((r) => inDateRange(r.refISO, range.from, range.to)), [s.ots, range.from, range.to]);

  const chartDays = chartDaysOf(range);
  const totals = useMemo(() => {
    const ix = new Map(chartDays.map((d, i) => [d, i]));
    const t = chartDays.map(() => ({ a: 0, p: 0 }));
    for (const r of inPeriod) {
      const i = ix.get(workDay(r));
      if (i === undefined) continue;
      if (r.status === 'Approved') t[i].a++;
      else if (r.status === 'Pending') t[i].p++;
    }
    return t;
  }, [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const approved = inPeriod.filter((r) => r.status === 'Approved');
    let best = -1;
    totals.forEach((t, i) => { if (t.a + t.p > 0 && (best < 0 || t.a + t.p > totals[best].a + totals[best].p)) best = i; });
    return {
      requests: inPeriod.length,
      approved: approved.length,
      declined: inPeriod.filter((r) => r.status === 'Declined').length,
      pending: inPeriod.filter((r) => r.status === 'Pending').length,
      compOff: approved.reduce((a, r) => a + (CREDIT[r.duration] ?? 0), 0),
      busiest: best >= 0 ? { d: chartDays[best], n: totals[best].a + totals[best].p } : null,
    };
  }, [inPeriod, totals]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(() => [...new Set(s.ots.map((r) => r.team))].sort(), [s.ots]);
  const rows = useMemo(() => {
    let out = inPeriod.slice();
    const q = s.otSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    if (s.otStatus !== 'all') out = out.filter((r) => r.status === s.otStatus);
    if (dept !== 'all') out = out.filter((r) => r.team === dept);
    return out.sort((a, b) => b.ord - a.ord);
  }, [inPeriod, s.otSearch, s.otStatus, dept]);

  const statusCounts = useMemo(() => {
    const c: Partial<Record<ReqStatus | 'all', number>> = { all: inPeriod.length };
    for (const r of inPeriod) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [inPeriod]);

  const exportRows = () =>
    downloadCsv<OvertimeRow>(
      'overtime',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Applied on', value: (r) => r.appliedOn },
        { header: 'Overtime date', value: (r) => r.otDate },
        { header: 'Day', value: (r) => r.day },
        { header: 'Duration', value: (r) => r.duration },
        { header: 'Hours', value: (r) => String(r.hours) },
        { header: 'Note', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
      ],
      rows,
    );

  const applyCustom = () => {
    const problem = rangeProblem(draftFrom, draftTo);
    setRangeError(problem);
    if (problem) return;
    s.setOtFrom(draftFrom);
    s.setOtTo(draftTo);
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export
        </button>
      </PageActions>

      <NeedsAction state={st} />

      <Card padded>
        <section aria-labelledby="ot-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="ot-period" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{range.title}</h2>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>By the date the overtime was worked.</span>
            </div>
            <PeriodButtons periods={PERIODS} period={period} onPeriod={setPeriod} />
          </div>

          {period === 'custom' && (
            <CustomRange
              applied={!!s.otFrom}
              draftFrom={draftFrom}
              draftTo={draftTo}
              onDraftFrom={(v) => { setDraftFrom(v); setRangeError(''); }}
              onDraftTo={(v) => { setDraftTo(v); setRangeError(''); }}
              onApply={applyCustom}
              error={rangeError}
              hint="Pick a date range to see overtime worked in it."
              max={today}
            />
          )}

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <StatTile state={st} label="Overtime requests" value={stats.requests} sub={`${stats.approved} approved · ${stats.declined} declined`} />
              <StatTile state={st} label="Pending" value={stats.pending} sub="Waiting for a decision" warn />
              <StatTile state={st} label="Comp-off credited" value={stats.compOff} unit={stats.compOff === 1 ? 'day' : 'days'} sub="Added to leave balances" />
              <StatTile
                state={st}
                label="Most overtime in a day"
                value={stats.busiest ? stats.busiest.n : '—'}
                unit={stats.busiest ? 'worked' : undefined}
                sub={stats.busiest ? <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{dayLabel(stats.busiest.d)}</span> : chartDays.length ? 'No overtime' : 'Pick a shorter period'}
              />
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Overtime worked, day by day</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="approved" />Approved</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="pending" />Pending</span>
                </div>
              </div>
              <DayBars days={chartDays} totals={totals} today={today} shadeFuture />
            </div>
          )}

          {!waitingForDates && (
            <div>
              <div style={toolbar}>
                <StatusTabs<ReqStatus | 'all'>
                  options={['all', 'Pending', 'Approved', 'Declined']}
                  active={s.otStatus}
                  onSelect={s.setOtStatus}
                  counts={st === 'ready' ? statusCounts : undefined}
                />
              </div>
              <div style={toolbar}>
                <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                  <SearchInput value={s.otSearch} onChange={s.setOtSearch} placeholder="Search by employee…" width="100%" />
                </div>
                <SelectBox value={dept} onChange={setDept}>
                  <option value="all">All departments</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </SelectBox>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 980 }}>
                  <div style={TH(COLS)}>
                    <Th>EMPLOYEE</Th>
                    <Th>WORKED ON</Th>
                    <Th>DURATION</Th>
                    <Th>NOTE</Th>
                    <Th>STATUS</Th>
                    <Th>DECIDED BY</Th>
                    <Th align="right">APPLIED</Th>
                  </div>
                  {rows.map((r, i) => {
                    const pend = r.status === 'Pending';
                    const open = () => s.setOtDrawerId(r.id);
                    return (
                      <div key={r.id} className="dc-row" onClick={open} style={{ ...TR(COLS, i === rows.length - 1), cursor: 'pointer', ...(pend ? { background: 'var(--warn-bg)', boxShadow: 'inset 3px 0 0 var(--warn)' } : null) }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <PersonAvatar name={r.name} userId={r.submitterId} />
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={cellSub}>{r.team}</div>
                          </div>
                        </div>
                        <div style={{ whiteSpace: 'nowrap' }}>{worked(r)}</div>
                        <div><Pill label={r.duration} tone={OTDUR[r.duration]} /></div>
                        <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
                        <div>{pend ? <PendingChip onClick={open} label={`Review ${r.name}'s overtime request`} /> : <Pill label={r.status} tone={STAT[r.status]} />}</div>
                        <div style={{ color: pend ? 'var(--ink-3)' : 'var(--ink)' }}>{pend ? '—' : r.byAdmin ? 'HR' : 'Manager'}</div>
                        <div style={{ textAlign: 'right', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.appliedOn}</div>
                      </div>
                    );
                  })}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={7} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No overtime requests match your filters." />}
                </div>
              </div>
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}
