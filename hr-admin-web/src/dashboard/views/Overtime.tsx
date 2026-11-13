import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { OTDUR, TO_STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Overtime as OvertimeRow } from '../seed';
import { inDateRange, otShortLabel } from '../adapters';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, Pill, SearchInput, StatusTabs, Th } from '../ui';
import { FiltersButton, FiltersPanel, LabeledSelect } from './LabeledSelect';
import { useFilterDraft } from './useFilterDraft';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { chartDaysOf, dayLabel, daysSince, PENDING_ROW, plural, SLOW_DAYS, stepRange, todayISO } from './leaveDays';
import { DayBars, NeedsActionShell, PendingChip, PeriodStepper, StatTile, Swatch, Waiting } from './leaveParts';
import { Pager, usePaged } from './Pager';

const COLS = '1.5fr .95fr .9fr 1.35fr 1.15fr 1.25fr 1fr .75fr';
type Given = 'all' | 'pay' | 'comp';
/**
 * Pay, comp-off or both, as the "Pay and comp-off" filter reads a request: an
 * approved one by what it was given as (a request from before the choice is
 * comp-off, as overtime always was then), any other by what was asked for.
 */
const givenAs = (r: OvertimeRow): { pay: boolean; comp: boolean } =>
  r.status === 'Approved'
    ? { pay: r.paidInPayroll, comp: r.compOffDays > 0 }
    : { pay: r.preferredChoice === 'pay', comp: Boolean(r.preferredChoice && r.preferredChoice !== 'pay') };

/** "Leave (Comp-off) · Full day (+1 Comp-off)", for the CSV and a cell's tooltip. */
const withCredit = (label?: string, credit?: string) => (label ? `${label}${credit ? ` (${credit})` : ''}` : '');
const NEEDS_ACTION_SHOWN = 3;
const workDay = (r: OvertimeRow) => (r.refISO || '').slice(0, 10);
const worked = (r: OvertimeRow) => (workDay(r) ? dayLabel(workDay(r)) : r.otDate);

function NeedsAction({ state }: { state: LoadState }) {
  const s = useStore();
  // The longest wait first.
  const everything = s.ots.filter((r) => r.status === 'Pending').sort((a, b) => a.ord - b.ord);
  // As on Leave requests: the tags filter this table only; none picked shows the first few,
  // a tag shows every request of its kind here, a page at a time.
  const [pick, setPick] = useState<'all' | 'slow' | null>(null);
  const isSlow = (r: OvertimeRow) => daysSince(r.ord) > SLOW_DAYS;
  const matching = pick === 'slow' ? everything.filter(isSlow) : everything;
  const paged = usePaged(matching, pick);
  if (state === 'ready' && everything.length === 0) return null;
  const slow = everything.filter(isSlow).length;
  const list = pick ? paged.rows : matching.slice(0, NEEDS_ACTION_SHOWN);
  const tag = (k: 'all' | 'slow', tone: 'bad' | 'mute', text: string, count: number) => ({ tone, text, count, picked: pick === k, onPick: () => setPick(pick === k ? null : k) });
  return (
    <NeedsActionShell
      id="ot-needs-action"
      state={state}
      summary={`${plural(everything.length, 'request')} waiting for a decision · all dates`}
      chips={[...(slow ? [tag('slow', 'bad', `Waiting over ${SLOW_DAYS} days`, slow)] : []), tag('all', 'mute', 'All', everything.length)]}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13.5 }}>{worked(r)} · {r.duration}</span>
            {/* Asked for: the employee's preference; "Give as" is decided in the drawer. */}
            <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.preference ? withCredit(r.preference, r.preferenceCredit) : 'Not chosen — a request from before the choice'}>
              Asked for {r.preference ? otShortLabel(r.preference, r.preferenceCredit) : 'nothing chosen'}
            </span>
          </div>
          <Waiting days={daysSince(r.ord)} slow={SLOW_DAYS} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PendingChip onClick={() => s.setOtDrawerId(r.id)} label={`Review ${r.name}'s overtime request`} />
          </div>
        </div>
      ))}
      <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={4} />
      {pick && <div style={{ padding: '0 18px 12px' }}><Pager p={paged} /></div>}
    </NeedsActionShell>
  );
}

export function Overtime() {
  const s = useStore();
  const st = s.listState('overtime');
  // A week or a month, stepped back and forward with the arrows by the title.
  const [unit, setUnit] = useState<'week' | 'month'>('month');
  const [offset, setOffset] = useState(0);
  const [dept, setDept] = useState('all');
  const [given, setGiven] = useState<Given>('all');
  const filters = useFilterDraft(
    { dept, given },
    (v) => { setDept(v.dept); setGiven(v.given as Given); },
    { dept: 'all', given: 'all' },
  );
  const today = todayISO();

  const range = stepRange(unit, offset);
  const waitingForDates = false;
  // By the day the overtime was worked.
  const inPeriod = useMemo(() => s.ots.filter((r) => inDateRange(r.refISO, range.from, range.to)), [s.ots, range.from, range.to]);

  const chartDays = chartDaysOf(range);
  const totals = useMemo(() => {
    const ix = new Map(chartDays.map((d, i) => [d, i]));
    // a: approved as pay, c: as comp-off (a request from before the choice is comp-off).
    const t = chartDays.map(() => ({ a: 0, p: 0, c: 0 }));
    for (const r of inPeriod) {
      const i = ix.get(workDay(r));
      if (i === undefined) continue;
      if (r.status === 'Approved') { if (r.paidInPayroll) t[i].a++; else t[i].c++; }
      else if (r.status === 'Pending') t[i].p++;
    }
    return t;
  }, [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const approved = inPeriod.filter((r) => r.status === 'Approved');
    let best = -1;
    const sum = (t: { a: number; p: number; c: number }) => t.a + t.p + t.c;
    totals.forEach((t, i) => { if (sum(t) > 0 && (best < 0 || sum(t) > sum(totals[best]))) best = i; });
    return {
      requests: inPeriod.length,
      approved: approved.length,
      declined: inPeriod.filter((r) => r.status === 'Declined').length,
      pending: inPeriod.filter((r) => r.status === 'Pending').length,
      // From the final decision, as the server credits and pays it (see otOutcome in adapters.ts).
      compOff: Math.round(approved.reduce((a, r) => a + r.compOffDays, 0) * 10) / 10,
      toPay: approved.filter((r) => r.paidInPayroll).length,
      toPayHours: Math.round(approved.filter((r) => r.paidInPayroll).reduce((a, r) => a + (r.hours || 0), 0) * 10) / 10,
      toPayLegacy: approved.filter((r) => r.paidInPayroll && !r.decision).length,
      // A request from before the choice is comp-off only, as overtime always was then.
      compOffLegacy: approved.filter((r) => r.compOffDays > 0 && !r.decision).length,
      busiest: best >= 0 ? { d: chartDays[best], n: sum(totals[best]) } : null,
    };
  }, [inPeriod, totals]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(() => [...new Set(s.ots.map((r) => r.team))].sort(), [s.ots]);
  const rows = useMemo(() => {
    let out = inPeriod.slice();
    const q = s.otSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    if (s.otStatus !== 'all') out = out.filter((r) => r.status === s.otStatus);
    if (dept !== 'all') out = out.filter((r) => r.team === dept);
    if (given !== 'all') out = out.filter((r) => givenAs(r)[given]);
    return out.sort((a, b) => b.ord - a.ord);
  }, [inPeriod, s.otSearch, s.otStatus, dept, given]);
  const paged = usePaged(rows, `${rows.length}|${rows[0]?.id ?? ''}`);

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
        { header: 'Preference', value: (r) => withCredit(r.preference, r.preferenceCredit) },
        { header: 'Decision', value: (r) => withCredit(r.decision, r.decisionCredit) },
        { header: 'Hours', value: (r) => String(r.hours) },
        { header: 'Note', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
      ],
      rows,
    );

  /** Brings the request list to the top of the screen, once it is there. */
  const toList = () => {
    let tries = 0;
    const go = () => {
      const el = document.getElementById('ot-list');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tries++ < 20) setTimeout(go, 50);
    };
    setTimeout(go, 50);
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <NeedsAction state={st} />

      <Card padded>
        <section aria-labelledby="ot-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PeriodStepper id="ot-period" title={range.title} unit={unit} onUnit={(u) => { setUnit(u === 'week' ? 'week' : 'month'); setOffset(0); }} onStep={(by) => setOffset((o) => o + by)}
            hasPrev={s.ots.some((r) => workDay(r) && workDay(r) < range.from)} hasNext={s.ots.some((r) => workDay(r) > range.to)} />

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              {/* Each tile filters the list below to what it counts, and brings the list into view. */}
              <StatTile state={st} label="Overtime requests" value={stats.requests} sub={`${stats.approved} approved`}
                onPick={() => { s.setOtStatus('all'); setGiven('all'); toList(); }} picked={s.otStatus === 'all' && given === 'all'} />
              <StatTile state={st} label="Pending" value={stats.pending}
                action={stats.pending > 0 && s.otStatus !== 'Pending' ? <Pill label="Needs action" tone={TO_STAT.Pending} fontSize={11} padding="2px 8px" /> : undefined}
                onPick={() => { s.setOtStatus('Pending'); setGiven('all'); toList(); }} picked={s.otStatus === 'Pending'} color="var(--p-yellow)" />
              <StatTile state={st} label="Declined" value={stats.declined}
                onPick={() => { s.setOtStatus('Declined'); setGiven('all'); toList(); }} picked={s.otStatus === 'Declined'} color="var(--p-red)" />
              <StatTile
                state={st}
                label="To pay in payroll"
                value={stats.toPay}
                sub={`${stats.toPayHours} h`}
                onPick={() => { s.setOtStatus('Approved'); setGiven('pay'); toList(); }} picked={s.otStatus === 'Approved' && given === 'pay'} color="var(--p-green)"
              />
              <StatTile state={st} label="Comp-off credited" value={stats.compOff} unit={stats.compOff === 1 ? 'day' : 'days'}
                onPick={() => { s.setOtStatus('Approved'); setGiven('comp'); toList(); }} picked={s.otStatus === 'Approved' && given === 'comp'} color="var(--p-blue)" />
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Overtime worked, day by day</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="approved" />Pay</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="second" />Comp-off</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="pending" />Pending</span>
                </div>
              </div>
              <DayBars days={chartDays} totals={totals} today={today} shadeFuture words={['pay', 'pending', 'comp-off']} />
            </div>
          )}

          {!waitingForDates && (
            <div id="ot-list" style={{ scrollMarginTop: 96 }}>
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
                <FiltersButton open={filters.open} active={filters.active} onClick={filters.toggle} />
                <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
                  <IconDownload stroke="currentColor" /> Export
                </button>
              </div>
              {filters.open && (
                <FiltersPanel active={filters.active} dirty={filters.dirty} onApply={filters.apply} onClear={filters.clear}>
                  <LabeledSelect label="Department" value={filters.draft.dept} onChange={(v) => filters.set('dept', v)} options={[['all', 'All departments'], ...departments.map((d): [string, string] => [d, d])]} />
                  <LabeledSelect label="Given as" value={filters.draft.given} onChange={(v) => filters.set('given', v)} options={[['all', 'Pay and comp-off'], ['pay', 'Pay'], ['comp', 'Comp-off']]} />
                </FiltersPanel>
              )}

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 1040 }}>
                  <div style={TH(COLS)}>
                    <Th>EMPLOYEE</Th>
                    <Th>WORKED ON</Th>
                    <Th>DURATION</Th>
                    <Th>NOTE</Th>
                    <Th>PREFERENCE</Th>
                    <Th>DECISION</Th>
                    <Th>STATUS</Th>
                    <Th align="right">APPLIED</Th>
                  </div>
                  {paged.rows.map((r, i) => {
                    const pend = r.status === 'Pending';
                    const open = () => s.setOtDrawerId(r.id);
                    return (
                      <div key={r.id} className="dc-row" onClick={open} style={{ ...TR(COLS, i === paged.rows.length - 1), cursor: 'pointer', ...(pend ? PENDING_ROW : null) }}>
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
                        {/* What the employee asked for: overtime pay, or comp-off and how much. */}
                        <div
                          style={{ color: r.preference ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={r.preference ? withCredit(r.preference, r.preferenceCredit) : 'Not chosen — a request from before the choice'}
                        >
                          {otShortLabel(r.preference, r.preferenceCredit)}
                        </div>
                        {/* The final call, once approved: what payroll and the Comp-off balance use. */}
                        <div
                          style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
                          title={r.decision ? `${withCredit(r.decision, r.decisionCredit)}${r.decisionDiffers ? ' — differs from the preference' : ''}` : pend ? 'Decided on approval' : ''}
                        >
                          <span style={{ fontWeight: r.decisionDiffers ? 600 : 400, color: r.decision ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.decision ? otShortLabel(r.decision, r.decisionCredit) : '—'}
                          </span>
                          {/* Who decided it, as the design's "Given as" has it under the decision. */}
                          {!pend && <span style={cellSub}>{r.status === 'Declined' ? 'Declined ' : ''}by {r.byAdmin ? 'HR' : 'manager'}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>{pend ? <PendingChip onClick={open} label={`Review ${r.name}'s overtime request`} /> : <Pill label={r.status} tone={TO_STAT[r.status]} />}{!pend && r.byAdmin && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>by admin</span>}</div>
                        <div style={{ textAlign: 'right', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.appliedOn}</div>
                      </div>
                    );
                  })}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No overtime requests match your filters." />}
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
