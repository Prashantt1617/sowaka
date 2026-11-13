// Reports › Punch log: every day someone punched, in an office or out of
// location, one row per person per day. It only reads; deciding a day happens
// in Attendance corrections. Open a row to see each punch and where it was made.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { expandReport, getAttendanceReport, getPayCycle, getPunchLog } from '../../services/hrms';
import type { PayCycleDTO, PunchDayDTO, PunchPlaceDTO, ReportRow } from '../../services/hrms';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, LoadError, Pill, SearchInput, Th } from '../ui';
import { FiltersButton, FiltersPanel, LabeledSelect } from './LabeledSelect';
import { useFilterDraft } from './useFilterDraft';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, iconBtn, TH, toolbar, TR } from '../ds';
import { IconDownload, IconEye } from '../icons';
import { DrawerHeader, DrawerShell } from '../drawers/shell';
import { canOpen } from '../access';
import { useAuth } from '../auth/AuthContext';
import { addDays, chartDaysOf, dateOf, dayLabel, daysBetween, MON, rangeProblem, todayISO } from './leaveDays';
import type { PeriodId } from './leaveDays';
import { CustomRange, Key, LinkButton, PeriodButtons, StackBars, StatTile } from './leaveParts';
import { Pager, usePaged } from './Pager';

const COLS = '1.7fr 1fr .8fr .8fr .7fr 1.6fr 1.2fr 48px';
type Counted = 'present' | 'late' | 'early' | 'half' | 'open' | 'lateopen' | 'waiting' | 'corr' | 'missed' | 'absent' | 'leave' | 'none';
const COUNTED: Record<Counted, { label: string; bg: string; fg: string }> = {
  present: { label: 'Present', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  late: { label: 'Late', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  early: { label: 'Left early', bg: 'var(--t-peach)', fg: 'var(--t-peach-i)' },
  half: { label: 'Half day', bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  open: { label: 'In office now', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  lateopen: { label: 'Late · in now', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  // Waiting on someone's decision: the Time office attention tint.
  waiting: { label: 'Waiting on manager', bg: 'var(--attn-bg)', fg: 'var(--attn)' },
  corr: { label: 'Correction raised', bg: 'var(--attn-bg)', fg: 'var(--attn)' },
  missed: { label: 'Missed punch', bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  absent: { label: 'Absent', bg: 'var(--bad-bg)', fg: 'var(--bad)' },
  leave: { label: 'On leave', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  none: { label: '—', bg: 'var(--mute-bg)', fg: 'var(--ink-3)' },
};
// In office green, out of office yellow.
const OFFICE_COLOR = 'var(--p-green)';
const OOL_COLOR = 'var(--p-yellow)';
// The same two colours as a light-to-deep gradient, for the bars, the key and the dots.
const OFFICE_FILL = 'linear-gradient(180deg, color-mix(in srgb, var(--p-green) 55%, var(--surface)), var(--ok))';
const OOL_FILL = 'linear-gradient(180deg, color-mix(in srgb, var(--p-yellow) 60%, var(--surface)), color-mix(in srgb, var(--p-yellow) 65%, var(--warn)))';
const Dot = ({ color }: { color: string }) => <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 0 }} />;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const hoursOf = (a: string | null, b: string | null) => {
  if (!a || !b) return '—';
  const m = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const mapUrl = (p: { latitude: number; longitude: number }) => `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;
/** How an app punch was made, from where it was taken: inside an office's geofence or away from all of them. */
const methodOf = (loc: PunchPlaceDTO | null, outside: boolean) =>
  outside ? 'App check-in, out of location' : loc ? (loc.inOffice ? 'App punch inside the office geofence' : 'App punch outside every office') : '';

/** One person's day as the table reads it. */
type Row = PunchDayDTO & { key: string; ool: boolean; where: string; whereSub: string; counted: Counted; why: string; report?: ReportRow };

/** What this session has already loaded, per range: a revisit shows it at once. */
const punchMemo = new Map<string, PunchDayDTO[]>();
const reportMemo = new Map<string, ReportRow[]>();

export function PunchLog() {
  const s = useStore();
  const { user } = useAuth();
  const today = todayISO();
  const [cycle, setCycle] = useState<PayCycleDTO | null>(null);
  const [period, setPeriod] = useState<PeriodId>('today');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [where, setWhere] = useState<'all' | 'office' | 'ool' | 'waiting'>('all');
  const [counted, setCounted] = useState<'all' | 'present' | 'late' | 'early' | 'half'>('all');
  const [reason, setReason] = useState('all');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [punches, setPunches] = useState<PunchDayDTO[] | null>(null);
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const filters = useFilterDraft(
    { where, reason, counted, dept },
    (v) => { setWhere(v.where as typeof where); setReason(v.where === 'ool' ? v.reason : 'all'); setCounted(v.counted as typeof counted); setDept(v.dept); },
    { where: 'all', reason: 'all', counted: 'all', dept: 'all' },
  );

  useEffect(() => {
    let live = true;
    getPayCycle().then((c) => live && setCycle(c)).catch(() => live && setCycle({ current: null, previous: null }));
    return () => { live = false; };
  }, []);

  const weekFrom = addDays(today, -((dateOf(today).getDay() + 6) % 7));
  // No pay cycle set: the button says This month and reads the calendar month, never calling it a cycle.
  const hasCycle = Boolean(cycle?.current);
  const cycleWord = cycle && !hasCycle ? 'This month' : 'This cycle';
  const cycleRange = cycle?.current ?? { from: `${today.slice(0, 8)}01`, to: today };
  const range = period === 'today' ? { from: today, to: today }
    : period === 'week' ? { from: weekFrom, to: today }
      : period === 'cycle' ? { from: cycleRange.from, to: cycleRange.to < today ? cycleRange.to : today }
        : applied;
  const title = period === 'today' ? `Today · ${dayLabel(today)}`
    : period === 'week' ? `This week · ${dayLabel(range.from)} – ${dayLabel(range.to)}`
      : period === 'cycle' ? `${cycleWord} · ${dateOf(cycleRange.from).getDate()} ${MON[dateOf(cycleRange.from).getMonth()]} – ${dateOf(cycleRange.to).getDate()} ${MON[dateOf(cycleRange.to).getMonth()]}`
        : applied.from ? (applied.from === applied.to ? dayLabel(applied.from) : `${dayLabel(applied.from)} – ${dayLabel(applied.to)}`) : 'Custom range';
  const waitingForDates = period === 'custom' && !applied.from;

  useEffect(() => {
    if (!range.from || (period === 'cycle' && !cycle)) return;
    let live = true;
    const key = `${range.from}|${range.to}`;
    // A range seen before shows at once from memory while the fresh answer comes in.
    setPunches(punchMemo.get(key) ?? null);
    setReport(reportMemo.get(key) ?? null);
    setError('');
    getPunchLog(range.from, range.to)
      .then((p) => { punchMemo.set(key, p); if (live) setPunches(p); })
      .catch((e) => { if (live && !punchMemo.has(key)) setError(e instanceof Error ? e.message : 'Could not load punches'); });
    // How each day counts comes from the attendance report; without it the column says "—".
    if (canOpen(user, 'attendancereport')) {
      getAttendanceReport(range).then((r) => { const rows = expandReport(r); reportMemo.set(key, rows); if (live) setReport(rows); }).catch(() => { if (live && !reportMemo.has(key)) setReport([]); });
    } else setReport([]);
    return () => { live = false; };
  }, [range.from, range.to, attempt, cycle === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const state: LoadState = error ? 'error' : punches ? 'ready' : 'loading';

  const rows = useMemo<Row[]>(() => {
    if (!punches) return [];
    const graded = new Map((report ?? []).map((r) => [`${r.userId}|${r.date}`, r]));
    const raised = new Set(s.corrs.filter((c) => c.status === 'Pending' && c.kind !== 'ool').map((c) => `${c.submitterId}|${(c.refISO || '').slice(0, 10)}`));
    return punches.map((p) => {
      const key = `${p.userId}|${p.workDate}`;
      const rep = graded.get(key);
      const awayIn = p.inLocation && !p.inLocation.inOffice;
      const ool = Boolean(p.outside) || Boolean(awayIn);
      const office = p.inLocation?.inOffice ? (p.inLocation.officeName ?? 'Office') : p.outLocation?.inOffice ? (p.outLocation.officeName ?? 'Office') : null;
      const whereLabel = ool ? (p.outside?.reason ?? 'Out of location') : office ?? (p.inLocation || p.outLocation ? 'Office' : 'Biometric device');
      const whereSub = ool ? (p.outside?.place ?? p.inLocation?.place ?? '') : '';
      let c: Counted = 'none';
      let why = '';
      if (p.waiting) { c = 'waiting'; why = 'Out of location: the day counts once the manager approves.'; }
      else if (raised.has(key)) { c = 'corr'; why = 'A correction is pending for this day.'; }
      else if (rep) {
        const late = rep.lateByMinutes > 0;
        if (p.workDate === today && p.punchIn && !p.punchOut && rep.shiftRunning) c = late ? 'lateopen' : 'open';
        else if (rep.status === 'half_day') c = 'half';
        else if (rep.status === 'missed_punch') c = 'missed';
        else if (rep.status === 'absent') c = 'absent';
        else if (rep.status === 'on_leave' || rep.status === 'unpaid_leave') c = 'leave';
        else if (late) c = 'late';
        else if (rep.earlyByMinutes > 0) c = 'early';
        else c = 'present';
        if (late) why = `In ${rep.lateByMinutes} min after the shift's start and grace.`;
        else if (rep.earlyByMinutes > 0) why = `Out ${rep.earlyByMinutes} min before the shift ended.`;
        else if (c === 'half') why = 'Fewer hours than a full day on their shift.';
        else if (c === 'missed') why = 'One punch is missing, so the day is not counted yet.';
      }
      return { ...p, key, ool, where: whereLabel, whereSub, counted: c, why, report: rep };
    });
  }, [punches, report, s.corrs, today]);

  // A correction for a day with no punch at all ("mark me present for Tuesday"): no punch row
  // carries it, so it gets its own row, listed under Waiting for approval only.
  const noPunchCorr = useMemo<Row[]>(() => {
    if (!punches) return [];
    const punched = new Set(punches.map((p) => `${p.userId}|${p.workDate}`));
    const out = new Map<string, Row>();
    for (const c of s.corrs) {
      const date = (c.refISO || '').slice(0, 10);
      if (c.status !== 'Pending' || c.kind === 'ool' || !c.submitterId || date < range.from || date > range.to) continue;
      const key = `${c.submitterId}|${date}`;
      if (punched.has(key) || out.has(key)) continue;
      out.set(key, {
        userId: c.submitterId, name: c.name, employeeCode: c.employeeCode, department: c.team, manager: c.manager, workDate: date,
        punchIn: null, punchOut: null, inLocation: null, outLocation: null, outside: null, face: null, dayType: null, waiting: false,
        key, ool: false, where: 'No punch', whereSub: c.askedFor ? `Asked for ${c.askedFor.toLowerCase()}` : '', counted: 'corr', why: 'A correction is pending for this day, which has no punch.',
      });
    }
    return [...out.values()].sort((a, b) => b.workDate.localeCompare(a.workDate));
  }, [punches, s.corrs, range.from, range.to]);

  const departments = useMemo(() => [...new Set(rows.map((r) => r.department || 'Team'))].sort(), [rows]);
  const reasons = useMemo(() => [...new Set(rows.filter((r) => r.ool && r.outside).map((r) => r.outside!.reason))].sort(), [rows]);

  const shown = useMemo(() => {
    let out = rows;
    if (where === 'office') out = out.filter((r) => !r.ool);
    if (where === 'ool') out = out.filter((r) => r.ool);
    if (where === 'waiting') out = [...out.filter((r) => r.counted === 'waiting' || r.counted === 'corr'), ...noPunchCorr];
    if (where === 'ool' && reason !== 'all') out = out.filter((r) => r.outside?.reason === reason);
    if (counted !== 'all') out = out.filter((r) => (counted === 'late' ? r.counted === 'late' || r.counted === 'lateopen' : counted === 'present' ? r.counted === 'present' || r.counted === 'open' : r.counted === counted));
    if (dept !== 'all') out = out.filter((r) => (r.department || 'Team') === dept);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.where.toLowerCase().includes(q) || r.whereSub.toLowerCase().includes(q));
    return out;
  }, [rows, noPunchCorr, where, reason, counted, dept, search]);
  const paged = usePaged(shown, `${where}|${reason}|${counted}|${dept}|${search}|${rows.length}|${noPunchCorr.length}`);

  const chartDays = chartDaysOf(range);
  const series = useMemo(() => {
    const ix = new Map(chartDays.map((d, i) => [d, i]));
    const office = chartDays.map(() => 0), away = chartDays.map(() => 0);
    for (const r of rows) {
      const i = ix.get(r.workDate);
      if (i === undefined || !r.punchIn && !r.outside) continue;
      (r.ool ? away : office)[i]++;
    }
    return [{ label: 'In office', color: OFFICE_FILL, values: office }, { label: 'Out of location', color: OOL_FILL, values: away }];
  }, [rows, chartDays.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const people = new Set(rows.filter((r) => r.punchIn || r.outside).map((r) => r.userId)).size;
    const ool = rows.filter((r) => r.ool);
    // Exactly what Waiting for approval lists: each request once (an out-of-location one is not a correction too).
    const waitingCorr = rows.filter((r) => r.counted === 'corr').length + noPunchCorr.length;
    const punched = rows.filter((r) => r.punchIn || r.outside);
    // Out of location by the reason given ("11 WFH · 2 client visit"), the commonest first.
    const why = new Map<string, number>();
    for (const r of ool) { const k = r.outside?.reason || 'Away from every office'; why.set(k, (why.get(k) ?? 0) + 1); }
    return {
      people, days: rows.length, personDays: punched.length, office: rows.length - ool.length, ool: ool.length,
      oolPresent: ool.filter((r) => !r.waiting).length, oolWaiting: ool.filter((r) => r.waiting).length, waitingCorr,
      late: rows.filter((r) => r.counted === 'late' || r.counted === 'lateopen').length,
      early: rows.filter((r) => r.counted === 'early').length,
      half: rows.filter((r) => r.counted === 'half').length,
      reasons: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`).join(' · '),
    };
  }, [rows, noPunchCorr]);

  const exportRows = () =>
    downloadCsv<Row>(
      'punch-log',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Employee ID', value: (r) => r.employeeCode },
        { header: 'Department', value: (r) => r.department },
        { header: 'Date', value: (r) => r.workDate },
        { header: 'In', value: (r) => clock(r.punchIn) },
        { header: 'Out', value: (r) => clock(r.punchOut) },
        { header: 'Hours', value: (r) => hoursOf(r.punchIn, r.punchOut) },
        { header: 'Where', value: (r) => r.where },
        { header: 'Place', value: (r) => r.whereSub },
        { header: 'Counted as', value: (r) => COUNTED[r.counted].label },
        { header: 'Manager', value: (r) => r.manager },
      ],
      shown,
    );

  const applyCustom = () => {
    let problem = rangeProblem(draftFrom, draftTo);
    if (!problem && daysBetween(draftFrom, draftTo) > 92) problem = 'Pick at most three months.';
    setRangeError(problem);
    if (!problem) setApplied({ from: draftFrom, to: draftTo });
  };

  const open = openKey ? rows.find((r) => r.key === openKey) ?? null : null;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <Card padded>
        <section aria-labelledby="punch-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="punch-period" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>

            </div>
            <PeriodButtons periods={[['today', 'Today'], ['week', 'This week'], ['cycle', cycleWord], ['custom', 'Custom']]} period={period} onPeriod={setPeriod} />
          </div>

          {period === 'custom' && (
            <CustomRange
              applied={!!applied.from}
              draftFrom={draftFrom}
              draftTo={draftTo}
              onDraftFrom={(v) => { setDraftFrom(v); setRangeError(''); }}
              onDraftTo={(v) => { setDraftTo(v); setRangeError(''); }}
              onApply={applyCustom}
              error={rangeError}
              hint="Pick up to three months to see the punches in them."
              max={today}
            />
          )}

          {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

          {!waitingForDates && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {/* Every punch, where they were made, and what still waits on a decision; each tile filters the list. */}
              <StatTile state={state} label="Total punches" value={stats.days} sub={`${stats.people} ${stats.people === 1 ? 'person' : 'people'}`}
                onPick={() => { setWhere('all'); setReason('all'); }} picked={where === 'all'} />
              <StatTile state={state} label={<><Dot color={OFFICE_FILL} />In office punches</>} value={stats.office} sub="At an office or on its device"
                onPick={() => { setWhere('office'); setReason('all'); }} picked={where === 'office'} color={OFFICE_COLOR} />
              <StatTile state={state} label={<><Dot color={OOL_FILL} />Out of office punches</>} value={stats.ool} sub={stats.ool ? stats.reasons : 'None in this period'}
                onPick={() => { setWhere('ool'); setReason('all'); }} picked={where === 'ool'} color={OOL_COLOR} />
              <StatTile state={state} label="Punches waiting for approval" value={stats.oolWaiting + stats.waitingCorr}
                sub={`${stats.oolWaiting} out of office · ${stats.waitingCorr} ${stats.waitingCorr === 1 ? 'correction' : 'corrections'}`} attn={stats.oolWaiting + stats.waitingCorr > 0 && where !== 'waiting'}
                onPick={() => { setWhere('waiting'); setReason('all'); }} picked={where === 'waiting'} color="var(--attn)"
                action={canOpen(user, 'attendance') ? <span onClick={(e) => e.stopPropagation()}><LinkButton onClick={() => s.setView('attendance')}>Open</LinkButton></span> : undefined} />
            </div>
          )}

          {!waitingForDates && chartDays.length > 1 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>People punched in, day by day</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <Key color={OFFICE_FILL}>In office</Key>
                  <Key color={OOL_FILL}>Out of office</Key>
                </div>
              </div>
              <StackBars days={chartDays} series={series} today={today} />
            </div>
          )}

          {!waitingForDates && (
            <div>
              <div style={toolbar}>
                <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search employee or office…" width="100%" />
                </div>
                <FiltersButton open={filters.open} active={filters.active} onClick={filters.toggle} />
                <button onClick={exportRows} disabled={shown.length === 0} className={btnClass()} style={btn()}>
                  <IconDownload stroke="currentColor" /> Export
                </button>
              </div>
              {filters.open && (
                <FiltersPanel active={filters.active} dirty={filters.dirty} onApply={filters.apply} onClear={filters.clear}>
                  <LabeledSelect label="Punch type" value={filters.draft.where} onChange={(v) => filters.set('where', v)}
                    options={[['all', 'All punches'], ['office', 'In office'], ['ool', 'Out of office'], ['waiting', 'Waiting for approval']]} />
                  {filters.draft.where === 'ool' && reasons.length > 0 && (
                    <LabeledSelect label="Reason" value={filters.draft.reason} onChange={(v) => filters.set('reason', v)} options={[['all', 'All reasons'], ...reasons.map((x): [string, string] => [x, x])]} />
                  )}
                  <LabeledSelect label="Counted as" value={filters.draft.counted} onChange={(v) => filters.set('counted', v)}
                    options={[['all', 'Any'], ['present', 'Present'], ['late', 'Late'], ['early', 'Left early'], ['half', 'Half day']]} />
                  <LabeledSelect label="Department" value={filters.draft.dept} onChange={(v) => filters.set('dept', v)} options={[['all', 'All departments'], ...departments.map((d): [string, string] => [d, d])]} />
                </FiltersPanel>
              )}

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 1000 }}>
                  <div style={TH(COLS)}>
                    <Th>EMPLOYEE</Th>
                    <Th>DATE</Th>
                    <Th>IN</Th>
                    <Th>OUT</Th>
                    <Th>HOURS</Th>
                    <Th>WHERE</Th>
                    <Th>COUNTED AS</Th>
                    <Th align="right"> </Th>
                  </div>
                  {paged.rows.map((r, i) => {
                    const c = COUNTED[r.counted];
                    return (
                      <div key={r.key} className="dc-row" onClick={() => setOpenKey(r.key)} style={{ ...TR(COLS, i === paged.rows.length - 1), cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <PersonAvatar name={r.name} userId={r.userId} />
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[r.employeeCode, r.department].filter(Boolean).join(' · ')}</div>
                          </div>
                        </div>
                        <div style={{ whiteSpace: 'nowrap' }}>{dayLabel(r.workDate)}</div>
                        <div style={{ whiteSpace: 'nowrap', color: r.punchIn ? 'var(--ink)' : 'var(--ink-3)' }}>{clock(r.punchIn)}</div>
                        <div style={{ whiteSpace: 'nowrap', color: r.punchOut ? 'var(--ink)' : 'var(--ink-3)' }}>{clock(r.punchOut)}</div>
                        <div style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{hoursOf(r.punchIn, r.punchOut)}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: r.ool ? OOL_FILL : OFFICE_FILL, flexShrink: 0 }} />{r.where}
                          </span>
                          {r.whereSub && <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.whereSub}</span>}
                        </div>
                        <div>{report ? <Pill label={c.label} tone={{ bg: c.bg, fg: c.fg }} /> : <span style={{ color: 'var(--ink-3)' }}>…</span>}</div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => setOpenKey(r.key)} aria-label={`See ${r.name}'s punches on ${dayLabel(r.workDate)}`} className="ds-icon-btn" style={iconBtn(34)}><IconEye stroke="currentColor" /></button>
                        </div>
                      </div>
                    );
                  })}
                  {state === 'loading' && <ListPending state="loading" cols={8} />}
                  {state === 'ready' && shown.length === 0 && <EmptyRow text={rows.length ? 'No punches match your filters.' : 'No punches in this period yet.'} />}
                </div>
                <Pager p={paged} />
              </div>
            </div>
          )}
        </section>
      </Card>

      {open && <PunchDrawer r={open} onClose={() => setOpenKey(null)} onCorrections={canOpen(user, 'attendance') ? () => s.setView('attendance') : undefined} />}
    </div>
  );
}

/** One person's day: how it counts, why, and each punch with where it was taken. */
function PunchDrawer({ r, onClose, onCorrections }: { r: Row; onClose: () => void; onCorrections?: () => void }) {
  const c = COUNTED[r.counted];
  // Sent only to someone with Face ID access, and only as passed or failed: never the match score.
  const face = r.face === 'passed' ? 'Face check passed' : r.face === 'failed' ? 'Face check failed' : null;
  const punch = (kind: string, at: string | null, loc: PunchPlaceDTO | null, extra?: string | null) => ({ kind, at, loc, extra });
  const list = [
    punch('Punch in', r.punchIn, r.inLocation, face),
    punch('Punch out', r.punchOut, r.outLocation, null),
  ];
  return (
    <DrawerShell onClose={onClose}>
      <DrawerHeader name={r.name} userId={r.userId} subtitle={`${[r.employeeCode, r.department].filter(Boolean).join(' · ')} · ${dayLabel(r.workDate)}`} onClose={onClose} />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Pill label={c.label} tone={{ bg: c.bg, fg: c.fg }} />
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{r.punchIn && r.punchOut ? `${hoursOf(r.punchIn, r.punchOut)} worked` : r.punchIn ? 'No punch-out yet' : 'No punch-in'}</span>
        </div>
        {r.why && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface-2)', fontSize: 13.5, color: 'var(--ink-2)' }}>{r.why}</div>}
        {(r.counted === 'corr' || r.counted === 'waiting') && onCorrections && (
          <button type="button" onClick={() => { onClose(); onCorrections(); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'var(--attn-bg)', border: '1px solid var(--attn-line)', cursor: 'pointer', font: 'inherit', color: 'var(--ink)', textAlign: 'left' }}>
            <span style={{ fontSize: 13.5 }}>{r.counted === 'waiting' ? 'The out-of-location request is waiting on the manager.' : 'A correction for this day is waiting for a decision.'}</span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--attn)', whiteSpace: 'nowrap' }}>Open in corrections</span>
          </button>
        )}
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>PUNCHES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((p) => (
              <div key={p.kind} style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.kind}</span>
                  <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: p.at ? 'var(--ink)' : 'var(--ink-3)' }}>{p.at ? clock(p.at) : p.kind === 'Punch out' && r.punchIn && r.workDate === todayISO() ? 'Not yet' : 'Missed'}</span>
                </div>
                {!p.at && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No punch recorded</span>}
                {p.at && (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                      {p.loc ? p.loc.place : r.outside && r.outside.punchType === (p.kind === 'Punch in' ? 'in' : 'out') ? `${r.outside.reason} · ${r.outside.place}` : 'Biometric device (no location)'}
                      {p.loc?.mocked ? ' · location looked faked' : ''}
                    </span>
                    {(p.loc || (r.outside && r.outside.punchType === (p.kind === 'Punch in' ? 'in' : 'out'))) && (() => {
                      const at = p.loc ?? r.outside!;
                      return <a href={mapUrl(at)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--accent-ink)' }}>{at.latitude.toFixed(5)}, {at.longitude.toFixed(5)} · Open in map</a>;
                    })()}
                    {(() => { const m = methodOf(p.loc, Boolean(r.outside && r.outside.punchType === (p.kind === 'Punch in' ? 'in' : 'out'))); return m ? <span style={cellSub}>{m}</span> : null; })()}
                    {p.extra && <span style={cellSub}>{p.extra}</span>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        {r.manager && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Manager: {r.manager}</div>}
      </div>
    </DrawerShell>
  );
}
