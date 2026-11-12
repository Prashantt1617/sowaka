// Requests › Attendance: corrections employees raised against a day, and
// out-of-location punches waiting on a manager.
//
// The same queue a manager sees in the app, but org-wide: HR is asking what is
// outstanding anywhere, not what is waiting on them, so every row names the
// manager it actually belongs to. "Before payroll" puts this pay cycle first:
// what is still pending, which of it costs pay, and whose desk it sits on.
// Deciding from here is an override, so it goes through a confirm with a note.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { TO_STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Correction, CorrectionKind } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { getPayCycle } from '../../services/hrms';
import type { PayCycleDTO } from '../../services/hrms';
import { Card, EmptyRow, ListPending, Pill, SearchInput, StatusTabs, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, textareaStyle, TH, TILE, toolbar, TR } from '../ds';
import { IconDownload, IconX } from '../icons';
import { SuwiInsight } from '../suwi/SuwiInsight';
import { DrawerHeader, DrawerShell, InfoGrid, RemarkBlock } from '../drawers/shell';
import { chartDaysOf, dateOf, dayLabel, daysBetween, daysSince, MON, PENDING_ROW, plural, rangeProblem, todayISO } from './leaveDays';
import type { PeriodId } from './leaveDays';
import { CustomRange, Key, LinkButton, PendingChip, PeriodButtons, StackBars, StatTile } from './leaveParts';

const COLS = '32px 1.5fr .95fr 1.15fr 1.3fr .9fr 1.2fr 1fr 1.1fr';
type Kind = CorrectionKind;
/**
 * What each request is, from the request itself (adapters' correctionKindOf):
 * a correction by the day type it asks for, an older one's punch times, an
 * out-of-location punch, or a punch the face check refused.
 */
const KIND: Record<Kind, { label: string; color: string; bg: string; fg: string }> = {
  full: { label: 'Full day asked', color: 'var(--accent)', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  half: { label: 'Half day asked', color: 'var(--t-peach-i)', bg: 'var(--t-peach)', fg: 'var(--t-peach-i)' },
  wfh: { label: 'Work from home', color: 'var(--t-lilac-i)', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  visit: { label: 'Client visit', color: 'var(--t-plum-i)', bg: 'var(--t-plum)', fg: 'var(--t-plum-i)' },
  leave: { label: 'Leave asked', color: 'color-mix(in srgb, var(--accent) 40%, var(--surface))', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  times: { label: 'Punch times', color: 'var(--ink-3)', bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  other: { label: 'Correction', color: 'var(--ink-4)', bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  ool: { label: 'Out of location', color: 'var(--t-sky-i)', bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  face: { label: 'Face check', color: 'var(--ok)', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
};
const KINDS: Kind[] = ['full', 'half', 'wfh', 'visit', 'leave', 'times', 'other', 'ool', 'face'];
const kindOf = (r: Correction): Kind => r.kind ?? 'other';
/**
 * Until it is decided the day counts as recorded (absent, a half day, a missed
 * punch) while the request asks for it to count otherwise, so it can change
 * pay: every pending correction and out-of-location request, a disputed half
 * day included. A face check request only holds a punch for a decision and is
 * not counted here.
 */
const affectsPay = (r: Correction) => r.status === 'Pending' && kindOf(r) !== 'face';
const workDay = (r: Correction) => (r.refISO || '').slice(0, 10);
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const span = (r: { from: string; to: string }) => {
  const f = dateOf(r.from), t = dateOf(r.to);
  return `${f.getDate()} ${MON[f.getMonth()]} – ${t.getDate()} ${MON[t.getMonth()]} ${t.getFullYear()}`;
};

type Filter = 'all' | 'pay' | Kind;

export function AttendanceCorrections() {
  const s = useStore();
  const st = s.listState('corrections');
  const today = todayISO();
  const [cycle, setCycle] = useState<PayCycleDTO | null>(null);
  const [cycleError, setCycleError] = useState('');
  const [period, setPeriod] = useState<PeriodId>('cycle');
  const [draftFrom, setDraftFrom] = useState(s.corrFrom);
  const [draftTo, setDraftTo] = useState(s.corrTo);
  const [rangeError, setRangeError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [mgr, setMgr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'approve' | 'decline' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPayCycle()
      .then((c) => live && setCycle(c))
      .catch((e) => {
        if (!live) return;
        // A pay cycle setting payroll refuses (409) is HR's to fix: say so rather than guess.
        setCycleError(e instanceof Error ? e.message : 'Could not read the pay cycle');
        setCycle({ current: null, previous: null });
      });
    return () => { live = false; };
  }, []);

  // The month stands in for the cycle until payroll's own dates arrive (or when there are none).
  const monthRange = (k: number) => {
    const d = new Date(); const f = new Date(d.getFullYear(), d.getMonth() + k, 1);
    const t = new Date(f.getFullYear(), f.getMonth() + 1, 0);
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: iso(f), to: iso(t) };
  };
  const thisCycle = cycle?.current ?? monthRange(0);
  const lastCycle = cycle?.previous ?? monthRange(-1);
  const range = period === 'cycle' ? thisCycle : period === 'lastcycle' ? lastCycle : { from: s.corrFrom, to: s.corrTo };
  const title = period === 'cycle' ? `This cycle · ${span(thisCycle)}` : period === 'lastcycle' ? `Last cycle · ${span(lastCycle)}` : s.corrFrom ? (s.corrFrom === s.corrTo ? dayLabel(s.corrFrom) : `${dayLabel(s.corrFrom)} – ${dayLabel(s.corrTo)}`) : 'Custom range';
  const waitingForDates = period === 'custom' && !s.corrFrom;

  // Before payroll: this cycle's pending, by whose desk it is on.
  const inCycle = s.corrs.filter((r) => r.status === 'Pending' && inDateRange(r.refISO, thisCycle.from, thisCycle.to));
  const earlier = s.corrs.filter((r) => r.status === 'Pending' && workDay(r) < thisCycle.from).length;
  const managers = useMemo(() => {
    const m = new Map<string, { pending: number; pay: number; oldest: number }>();
    for (const r of inCycle) {
      const k = r.manager || 'No manager';
      const e = m.get(k) ?? { pending: 0, pay: 0, oldest: 0 };
      e.pending++;
      if (affectsPay(r)) e.pay++;
      e.oldest = Math.max(e.oldest, daysSince(r.ord));
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].pay - a[1].pay || b[1].pending - a[1].pending);
  }, [inCycle]);
  const closesIn = daysBetween(today, thisCycle.to);

  const inPeriod = useMemo(() => s.corrs.filter((r) => inDateRange(r.refISO, range.from, range.to)), [s.corrs, range.from, range.to]);
  const chartDays = chartDaysOf(range);
  const series = useMemo(() => {
    const ix = new Map(chartDays.map((d, i) => [d, i]));
    const out = KINDS.map((k) => ({ label: KIND[k].label, color: KIND[k].color, values: chartDays.map(() => 0) }));
    for (const r of inPeriod) {
      const i = ix.get(workDay(r));
      if (i !== undefined) out[KINDS.indexOf(kindOf(r))].values[i]++;
    }
    return out.filter((x) => x.values.some(Boolean));
  }, [inPeriod, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of inPeriod) byDay.set(workDay(r), (byDay.get(workDay(r)) ?? 0) + 1);
    const top = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total: inPeriod.length,
      pending: inPeriod.filter((r) => r.status === 'Pending').length,
      pay: inPeriod.filter(affectsPay).length,
      approved: inPeriod.filter((r) => r.status === 'Approved').length,
      declined: inPeriod.filter((r) => r.status === 'Declined').length,
      top,
    };
  }, [inPeriod]);

  const rows = useMemo(() => {
    let out = inPeriod.slice();
    const q = s.corrSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.manager.toLowerCase().includes(q));
    if (s.corrStatus !== 'all') out = out.filter((r) => r.status === s.corrStatus);
    if (filter === 'pay') out = out.filter(affectsPay);
    else if (filter !== 'all') out = out.filter((r) => kindOf(r) === filter);
    if (mgr) out = out.filter((r) => (r.manager || 'No manager') === mgr);
    // Pending that costs pay first, then other pending, then the decided; newest raised within each.
    const rank = (r: Correction) => (r.status === 'Pending' ? (affectsPay(r) ? 0 : 1) : 2);
    return out.sort((a, b) => rank(a) - rank(b) || b.ord - a.ord);
  }, [inPeriod, s.corrSearch, s.corrStatus, filter, mgr]);
  const pendingRows = rows.filter((r) => r.status === 'Pending');
  const picked = pendingRows.filter((r) => selected.has(r.id));
  const allPicked = pendingRows.length > 0 && picked.length === pendingRows.length;
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const statusCounts = useMemo(() => {
    const c: Partial<Record<ReqStatus | 'all', number>> = { all: inPeriod.length };
    for (const r of inPeriod) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [inPeriod]);

  const exportRows = () =>
    downloadCsv<Correction>(
      'attendance-corrections',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Employee ID', value: (r) => r.employeeCode },
        { header: 'Team', value: (r) => r.team },
        { header: 'Raised on', value: (r) => r.appliedOn },
        { header: 'Work date', value: (r) => r.workDate },
        { header: 'Day', value: (r) => r.day },
        { header: 'Type', value: (r) => KIND[kindOf(r)].label },
        { header: 'Asked for', value: (r) => r.askedFor ?? r.dayType },
        { header: 'Recorded punches', value: (r) => r.recorded },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Affects pay', value: (r) => (affectsPay(r) ? 'yes' : '') },
        { header: 'Decision note', value: (r) => r.mRemark },
        { header: 'Decided by', value: (r) => (r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
      ],
      rows,
    );

  const applyCustom = () => {
    const problem = rangeProblem(draftFrom, draftTo);
    setRangeError(problem);
    if (problem) return;
    s.setCorrFrom(draftFrom);
    s.setCorrTo(draftTo);
  };
  const seeManager = (name: string) => {
    setPeriod('cycle');
    s.setCorrStatus('Pending');
    setFilter('all');
    setMgr(name);
    setSelected(new Set());
  };
  const seeEarlier = () => {
    setPeriod('custom');
    const from = '2000-01-01', to = isoBefore(thisCycle.from);
    setDraftFrom(''); setDraftTo(to);
    s.setCorrFrom(from); s.setCorrTo(to);
    s.setCorrStatus('Pending');
    setMgr(null);
  };

  const open = openId ? s.corrs.find((r) => r.id === openId) ?? null : null;
  const chip = (on: boolean): CSSProperties => ({ height: 32, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit', border: `1px solid ${on ? 'var(--sel)' : 'var(--line-2)'}`, background: on ? 'var(--sel)' : 'var(--surface)', color: on ? 'var(--on-sel)' : 'var(--ink)' });

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {(st !== 'ready' || inCycle.length > 0 || earlier > 0) && (
        <section aria-labelledby="corr-before-payroll" style={{ ...TILE, padding: 0, overflow: 'hidden', border: '1px solid var(--attn-line)', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 22px', background: 'var(--attn-bg)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 id="corr-before-payroll" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Before payroll</h2>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                This cycle closes {dayLabel(thisCycle.to)}{closesIn >= 0 ? ` · ${closesIn === 0 ? 'today' : plural(closesIn, 'day') + ' left'}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{inCycle.length}</span><span style={{ ...cellSub, color: 'var(--ink-2)' }}>pending this cycle</span></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>{inCycle.filter(affectsPay).length}</span><span style={{ ...cellSub, color: 'var(--ink-2)' }}>affect pay</span></div>
            </div>
          </div>
          {managers.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 620 }}>
                <div style={{ ...TH('1.6fr .7fr .7fr .7fr auto'), margin: 0, borderRadius: 0 }}>
                  <Th>WAITING ON</Th><Th>PENDING</Th><Th>AFFECT PAY</Th><Th>OLDEST</Th><Th> </Th>
                </div>
                {managers.map(([name, m], i) => (
                  <div key={name} style={{ ...TR('1.6fr .7fr .7fr .7fr auto', i === managers.length - 1), padding: '10px 22px' }}>
                    <span style={cellName}>{name}</span>
                    <span>{m.pending}</span>
                    <span style={{ fontWeight: m.pay ? 600 : 400, color: m.pay ? 'var(--bad)' : 'var(--ink)' }}>{m.pay}</span>
                    <span style={{ fontWeight: m.oldest > 2 ? 600 : 400, color: m.oldest > 2 ? 'var(--bad)' : 'var(--ink)' }}>{m.oldest === 0 ? 'Today' : plural(m.oldest, 'day')}</span>
                    <LinkButton onClick={() => seeManager(name)}>See requests</LinkButton>
                  </div>
                ))}
              </div>
            </div>
          )}
          {earlier > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{plural(earlier, 'more pending', 'more pending')} from earlier cycles. They don’t block this payroll but need fixing.</span>
              <LinkButton onClick={seeEarlier}>See earlier cycles</LinkButton>
            </div>
          )}
          <ListPending state={st} onRetry={() => void s.reload()} rows={3} cols={4} avatar={false} />
        </section>
      )}

      <Card padded>
        <section aria-labelledby="corr-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="corr-period" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>By work date. {cycle?.current ? 'Cycle dates come from payroll settings.' : cycleError ? `The pay cycle could not be read (${cycleError}), so a cycle is the calendar month.` : 'No pay cycle is set, so a cycle is the calendar month.'}</span>
            </div>
            <PeriodButtons periods={[['cycle', 'This cycle'], ['lastcycle', 'Last cycle'], ['custom', 'Custom']]} period={period} onPeriod={(p) => { setPeriod(p); setSelected(new Set()); }} />
          </div>

          {period === 'custom' && (
            <CustomRange
              applied={!!s.corrFrom}
              draftFrom={draftFrom}
              draftTo={draftTo}
              onDraftFrom={(v) => { setDraftFrom(v); setRangeError(''); }}
              onDraftTo={(v) => { setDraftTo(v); setRangeError(''); }}
              onApply={applyCustom}
              error={rangeError}
              hint="Pick a date range to see corrections for work days in it."
              max={today}
            />
          )}

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <StatTile state={st} label="Corrections" value={stats.total} />
              <StatTile state={st} label="Pending" value={stats.pending} sub={`${stats.pay} affect pay`} attn />
              <StatTile state={st} label="Approved · Declined" value={<>{stats.approved} <span style={{ fontSize: 17, color: 'var(--ink-3)' }}>· {stats.declined}</span></>} />
              <StatTile state={st} label="Most corrections in a day" value={stats.top ? stats.top[1] : '—'} sub={stats.top ? <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{dayLabel(stats.top[0])}</span> : 'No corrections'} />
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Corrections by work date</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {series.map((x) => <Key key={x.label} color={x.color}>{x.label}</Key>)}
                </div>
              </div>
              <StackBars days={chartDays} series={series} today={today} />
            </div>
          )}

          {!waitingForDates && (
            <div>
              <div style={toolbar}>
                <StatusTabs<ReqStatus | 'all'>
                  options={['all', 'Pending', 'Approved', 'Declined']}
                  active={s.corrStatus}
                  onSelect={(v) => { s.setCorrStatus(v); setSelected(new Set()); }}
                  counts={st === 'ready' ? statusCounts : undefined}
                />
                <div role="group" aria-label="Type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(['all', 'pay', ...KINDS.filter((k) => k === filter || inPeriod.some((r) => kindOf(r) === k))] as Filter[]).map((f) => (
                    <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={chip(filter === f)}>
                      {f === 'all' ? 'All types' : f === 'pay' ? 'Affects pay' : KIND[f].label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={toolbar}>
                <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                  <SearchInput value={s.corrSearch} onChange={s.setCorrSearch} placeholder="Search employee or manager…" width="100%" />
                </div>
                <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
                  <IconDownload stroke="currentColor" /> Export
                </button>
              </div>

              {mgr && (
                <div style={{ ...toolbar, fontSize: 12.5, color: 'var(--ink-3)' }}>
                  Showing
                  <button type="button" onClick={() => setMgr(null)} aria-label={`Stop filtering by ${mgr}`} style={{ ...chip(true), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Waiting on {mgr} <IconX size={12} />
                  </button>
                </div>
              )}

              {picked.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginBottom: 12 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>{plural(picked.length, 'correction')} selected{picked.some(affectsPay) ? ` · ${picked.filter(affectsPay).length} affect pay` : ''}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setSelected(new Set())} className={btnClass('ghost')} style={btn('ghost', 'sm')}>Clear</button>
                    <button type="button" onClick={() => setBulk('decline')} className={btnClass('no')} style={btn('no', 'sm')}>Decline</button>
                    <button type="button" onClick={() => setBulk('approve')} className={btnClass('primary')} style={btn('primary', 'sm')}>Approve selected</button>
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 1040 }}>
                  <div style={TH(COLS)}>
                    <div><input type="checkbox" aria-label="Select all pending rows" checked={allPicked} disabled={pendingRows.length === 0} onChange={() => setSelected(allPicked ? new Set() : new Set(pendingRows.map((r) => r.id)))} /></div>
                    <Th>EMPLOYEE</Th>
                    <Th>WORK DATE</Th>
                    <Th>TYPE</Th>
                    <Th>PUNCHED</Th>
                    <Th>ASKED FOR</Th>
                    <Th>REASON</Th>
                    <Th>MANAGER</Th>
                    <Th>STATUS</Th>
                  </div>
                  {rows.map((r, i) => {
                    const pend = r.status === 'Pending';
                    const k = KIND[kindOf(r)];
                    return (
                      <div key={r.id} className="dc-row" onClick={() => setOpenId(r.id)} style={{ ...TR(COLS, i === rows.length - 1), cursor: 'pointer', ...(pend ? PENDING_ROW : null), ...(selected.has(r.id) && pend ? { background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))' } : null) }}>
                        <div onClick={(e) => e.stopPropagation()}>
                          {pend && <input type="checkbox" aria-label={`Select ${r.name}, ${r.workDate}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <PersonAvatar name={r.name} userId={r.submitterId} />
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.employeeCode} · {r.team}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{r.day} {r.workDate}</span>
                          <span style={cellSub}>raised {r.appliedOn}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: k.bg, color: k.fg, whiteSpace: 'nowrap' }}>{k.label}</span>
                          {r.ool && <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ool.reason}</span>}
                        </div>
                        <div style={{ fontSize: 13, color: r.recorded === 'No punch' ? 'var(--ink-3)' : 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.recorded}>{r.recorded === 'No punch' ? '— → —' : r.recorded}</div>
                        <div>{r.askedFor ?? r.dayType}</div>
                        <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>{r.manager || '—'}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                          {pend ? <PendingChip onClick={() => setOpenId(r.id)} label={`Review ${r.name}'s correction`} /> : <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={TO_STAT[r.status]} />}
                          {affectsPay(r) && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad)' }}>Affects pay</span>}
                        </div>
                      </div>
                    );
                  })}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No attendance corrections match your filters." />}
                </div>
              </div>
            </div>
          )}
        </section>
      </Card>

      {open && <CorrectionDrawer r={open} onClose={() => setOpenId(null)} />}
      {s.corrConfirm && <ConfirmOverride />}
      {bulk && <BulkConfirm action={bulk} rows={picked} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); }} />}
    </div>
  );
}

const isoBefore = (iso: string) => {
  const d = dateOf(iso); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One correction: Suwi's checks, what was punched and asked, where, and the decision. */
function CorrectionDrawer({ r, onClose }: { r: Correction; onClose: () => void }) {
  const s = useStore();
  const k = KIND[kindOf(r)];
  const pend = r.status === 'Pending';
  const map = r.ool ? `https://www.google.com/maps?q=${r.ool.latitude},${r.ool.longitude}` : '';
  return (
    <DrawerShell onClose={onClose}>
      <DrawerHeader name={r.name} userId={r.submitterId} subtitle={`${r.employeeCode} · ${r.team} · Raised ${r.appliedOn}`} onClose={onClose} />
      <div style={{ padding: 20 }}>
        <SuwiInsight kind="correction" id={r.id} pending={pend} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={TO_STAT[r.status]} />
          <Pill label={k.label} tone={{ bg: k.bg, fg: k.fg }} />
          {affectsPay(r) && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bad)' }}>Affects pay until decided</span>}
        </div>
        <InfoGrid
          cells={[
            { label: 'WORK DATE', value: `${r.day} ${r.workDate}` },
            { label: 'TYPE', value: k.label },
            { label: 'PUNCHED', value: r.punchInISO || r.punchOutISO ? `${clock(r.punchInISO)} → ${clock(r.punchOutISO)}` : r.ool ? `Checked ${r.ool.at ? clock(r.ool.at) : ''}` : 'No punch' },
            { label: 'ASKED FOR', value: r.askedFor ?? r.dayType },
            { label: 'MANAGER', value: r.manager || '—', wide: true },
          ]}
        />
        {r.ool && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>LOCATION</div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.ool.place}</span>
              <a href={map} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-ink)' }}>{r.ool.latitude.toFixed(5)}, {r.ool.longitude.toFixed(5)} · Open in map</a>
            </div>
          </div>
        )}
        <RemarkBlock label="EMPLOYEE REASON" text={r.eRemark || 'No reason given.'} filled={!!r.eRemark} marginBottom={16} />
        <RemarkBlock label="MANAGER REMARK" text={r.mRemark || 'No remark yet.'} filled={!!r.mRemark} marginBottom={8} />
      </div>
      {pend && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '16px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => { onClose(); s.corrAsk(r.id, 'decline'); }} className={btnClass('no')} style={btn('no')}>Decline</button>
          <button onClick={() => { onClose(); s.corrAsk(r.id, 'approve'); }} className={btnClass('primary')} style={btn('primary')}>Approve correction</button>
        </div>
      )}
    </DrawerShell>
  );
}

/** Approve or decline the selected ones together: one note, each its own override. */
function BulkConfirm({ action, rows, onClose, onDone }: { action: 'approve' | 'decline'; rows: Correction[]; onClose: () => void; onDone: () => void }) {
  const s = useStore();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = action === 'approve';
  const managers = [...new Set(rows.map((r) => r.manager).filter(Boolean))];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'ovl .2s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>{approve ? 'Approve' : 'Decline'} {plural(rows.length, 'correction')}?</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 16 }}>
          {approve ? 'Each day will count as asked.' : 'Each day stays as it was recorded.'}
          {managers.length ? ` This overrides ${managers.length <= 2 ? managers.join(' and ') : `${managers.length} managers`}.` : ''}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the employees (optional)" rows={3} className="ds-inp" style={{ ...textareaStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className={btnClass()} style={btn()}>Cancel</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await s.corrDecideMany(rows.map((r) => r.id), action, note); setBusy(false); onDone(); }} className={btnClass(approve ? 'primary' : 'danger')} style={btn(approve ? 'primary' : 'danger')}>
            {busy ? 'Saving…' : approve ? `Approve ${rows.length}` : `Decline ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** HR is overriding the reporting manager, so the note is worth capturing. */
function ConfirmOverride() {
  const s = useStore();
  if (!s.corrConfirm) return null;
  const { id, action } = s.corrConfirm;
  const row = s.corrs.find((r) => r.id === id);
  const approve = action === 'approve';
  return (
    <div onClick={s.corrCloseConfirm} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'ovl .2s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>{approve ? 'Approve' : 'Decline'} this correction?</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 400, lineHeight: 1.55, marginBottom: 16 }}>
          {row ? `${row.name}’s ${row.workDate} will be ${approve ? `recorded as ${(row.askedFor ?? row.dayType).toLowerCase()}` : 'left as it is'}. ${row.manager ? `${row.manager} is the approver — this overrides them.` : ''}` : ''}
        </div>
        <textarea value={s.corrNote} onChange={(e) => s.setCorrNote(e.target.value)} placeholder="Add a note for the employee (optional)" rows={3} className="ds-inp" style={{ ...textareaStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={s.corrCloseConfirm} className={btnClass()} style={btn()}>Cancel</button>
          <button type="button" onClick={s.corrDecide} className={btnClass(approve ? 'primary' : 'danger')} style={btn(approve ? 'primary' : 'danger')}>{approve ? 'Approve' : 'Decline'}</button>
        </div>
      </div>
    </div>
  );
}
