// Reports › Attendance — today, this week, this month or a custom range, one
// row per employee, as the attendance report prototype draws it.
//
// Each employee gets one status a day: leave first (leave without pay is its
// own, LWP: neither leave nor absent), then week off or holiday,
// then missed punch (only once the shift has ended), then late, then present.
// Before the shift ends, anyone without an in-punch is Not punched in yet.
// Today lists each person's punches; a week is a grid of chips; a month, or a
// custom range of eight days or more, is each person's totals. Pressing a row
// opens that person's basic details beside the report, with the one Edit.
//
// The server grades the days (the same grading payroll reads); this page only
// turns each graded day into its one status. Today, the week and the month come
// from one request, so switching between them is instant. The filters live in
// this tab's session.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkSheet } from 'xlsx';
import { expandReport, getAttendanceReport } from '../../services/hrms';
import type { AttendanceReportDTO, ReportPersonDTO, ReportRow } from '../../services/hrms';
import { DateRange, ListPending } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { IconDownload } from './peopleTable';
import { IconClose } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { useStore } from '../store';
import { BasicDetailsEditor, ShiftPicker } from './EmployeeProfile';
import { isSelfOrBelow } from './selfOrBelow';
import { PdEdit, PdLock } from './pdIcons';
import * as L from './look';
import './look.css';
import './attendance-report.css';

const cacheKey = (userId: string, from: string, to: string) => `sowaka.report.v3.${userId}.${from}.${to}`;
const readCached = (key: string): { at: string; report: AttendanceReportDTO } | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { at: string; report: AttendanceReportDTO }) : null;
  } catch {
    return null;
  }
};
const writeCached = (key: string, value: { at: string; report: AttendanceReportDTO }) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the page still works, it just won't paint early.
  }
};

// ── one status per employee per day ──────────────────────────────────────
type Code = 'P' | 'L' | 'HD' | 'LV' | 'LWP' | 'MP' | 'NP' | 'WO' | 'H' | 'A';
const TONE: Record<Code | 'future', { bg: string; fg: string }> = {
  P: { bg: 'var(--ar-p-bg)', fg: 'var(--ar-p-fg)' },
  L: { bg: 'var(--ar-l-bg)', fg: 'var(--ar-l-fg)' },
  HD: { bg: 'var(--ar-hd-bg)', fg: 'var(--ar-hd-fg)' },
  LV: { bg: 'var(--ar-lv-bg)', fg: 'var(--ar-lv-fg)' },
  LWP: { bg: 'var(--ar-lwp-bg)', fg: 'var(--ar-lwp-fg)' },
  MP: { bg: 'var(--ar-mp-bg)', fg: 'var(--ar-mp-fg)' },
  NP: { bg: 'var(--ar-np-bg)', fg: 'var(--ar-np-fg)' },
  WO: { bg: 'var(--ar-wo-bg)', fg: 'var(--ar-wo-fg)' },
  H: { bg: 'var(--ar-wo-bg)', fg: 'var(--ar-wo-fg)' },
  A: { bg: 'var(--ar-mp-bg)', fg: 'var(--ar-mp-fg)' },
  future: { bg: 'transparent', fg: 'var(--ink-4, #9CA3AF)' },
};
const LEGEND: [Code, string][] = [['P', 'Present'], ['L', 'Late'], ['HD', 'Half day'], ['LV', 'On leave'], ['LWP', 'Leave without pay'], ['MP', 'Missed punch'], ['NP', 'Not punched in yet'], ['WO', 'Week off'], ['H', 'Holiday']];

type Day = {
  code: Code;
  /** What the pill says: a leave shows its type. */
  label: string;
  /** Why, in the Mode column: which punch is missing, or when the shift ends. */
  mode: string;
  late: boolean;
  punchIn: string | null;
  punchOut: string | null;
  /** In, and the shift still running: the out-punch is Pending, not missing. */
  pending: boolean;
  /** Leave taken that day: 1, or 0.5 for half-day leave. */
  leave: number;
  /** Leave without pay that day: 1, or 0.5 for a half day. Never counted as leave. */
  unpaid: number;
};

const LEAVE_LABEL: Record<string, string> = { sick: 'Sick', casual: 'Casual', earned: 'Earned', comp_off: 'Comp off' };
const leaveLabel = (type: string | null) => {
  if (!type) return 'On leave';
  if (/leave/i.test(type)) return type;
  const name = LEAVE_LABEL[type] ?? type.split('_').map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' ');
  return `${name} leave`;
};

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '—';
/** 18:30 → 06:30 PM. */
const hhmm = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

function dayOf(row: ReportRow, person: ReportPersonDTO, halfLeave: boolean): Day {
  const base = { mode: '', late: false, punchIn: row.punchIn, punchOut: row.punchOut, pending: false, leave: 0, unpaid: 0 };
  if (row.status === 'unpaid_leave') {
    return halfLeave
      ? { ...base, code: 'LWP', label: 'Leave without pay (half day)', unpaid: 0.5 }
      : { ...base, code: 'LWP', label: 'Leave without pay', unpaid: 1 };
  }
  if (row.status === 'on_leave') {
    return halfLeave
      ? { ...base, code: 'HD', label: 'Half day', leave: 0.5 }
      : { ...base, code: 'LV', label: leaveLabel(row.leaveType), leave: 1 };
  }
  // HR's own mark has no punches behind it.
  if (row.source === 'hr') {
    if (row.status === 'absent') return { ...base, code: 'A', label: 'Absent (marked by HR)' };
    return row.status === 'half_day' ? { ...base, code: 'HD', label: 'Half day' } : { ...base, code: 'P', label: 'Present' };
  }
  const late = row.late;
  if (row.shiftRunning) {
    if (!row.punchIn) return { ...base, code: 'NP', label: 'Not punched in yet', mode: person.shiftEnd ? `Shift ends ${hhmm(person.shiftEnd)}` : '' };
    return { ...base, code: late ? 'L' : 'P', label: late ? 'Late' : 'Present', late, pending: !row.punchOut };
  }
  if (!row.punchIn && !row.punchOut) {
    // Present by default: nobody punches, and a working day is a present day.
    if (row.status === 'present') return { ...base, code: 'P', label: 'Present' };
    return { ...base, code: 'MP', label: 'Missed punch', mode: 'Both punches missing' };
  }
  if (!row.punchIn) return { ...base, code: 'MP', label: 'Missed punch', mode: 'Missing punch-in' };
  if (row.status === 'missed_punch') return { ...base, code: 'MP', label: 'Missed punch', mode: `Missing punch-out${late ? ' · came in late' : ''}`, late };
  return { ...base, code: late ? 'L' : 'P', label: late ? 'Late' : 'Present', late };
}
/** Present counts any day with an in-punch, late, half day and a missing out-punch included. */
const presentLike = (d: Day) => d.code === 'P' || d.code === 'L' || d.code === 'HD' || (d.code === 'MP' && Boolean(d.punchIn));

type Person = { userId: string; person: ReportPersonDTO; days: Map<string, Day> };

// ── the range ─────────────────────────────────────────────────────────────
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (iso: string) => new Date(`${iso}T00:00:00`);
const addDays = (iso: string, n: number) => {
  const d = dateOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};
const MON = (iso: string) => dateOf(iso).toLocaleDateString('en-GB', { month: 'short' });
const WD = (iso: string) => dateOf(iso).toLocaleDateString('en-GB', { weekday: 'short' });
const DAY = (iso: string) => dateOf(iso).getDate();

type Period = 'today' | 'week' | 'month' | 'custom';
const PERIODS: [Period, string][] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];
const TITLE: Record<Period, string> = { today: 'Today', week: 'This week', month: 'This month', custom: 'Custom range' };
const GRID_MAX_DAYS = 7;

function presetRanges(today: string) {
  const now = dateOf(today);
  const monday = addDays(today, -((now.getDay() + 6) % 7));
  const monthEnd = isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return {
    today: { from: today, to: today },
    week: { from: monday, to: addDays(monday, 6) },
    month: { from: `${today.slice(0, 7)}-01`, to: monthEnd },
  };
}

/** "Mon 19 – Sun 25 Oct 2026", or with both months when it spans two. */
function spanLabel(from: string, to: string, withDays: boolean) {
  const year = dateOf(to).getFullYear();
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (withDays) return sameMonth ? `${WD(from)} ${DAY(from)} – ${WD(to)} ${DAY(to)} ${MON(to)} ${year}` : `${WD(from)} ${DAY(from)} ${MON(from)} – ${WD(to)} ${DAY(to)} ${MON(to)} ${year}`;
  return sameMonth ? `${DAY(from)}–${DAY(to)} ${MON(to)} ${year}` : `${DAY(from)} ${MON(from)} – ${DAY(to)} ${MON(to)} ${year}`;
}

// ── attendance sources ────────────────────────────────────────────────────
const SHORT_SOURCE: Record<string, string> = {
  'Biometric': 'Biometric', 'Geotag (powered by Sowaka)': 'Geotag', 'In-app punch in': 'In-app', 'Present by default (Auto Punch)': 'Auto punch',
};
const shortSource = (f: string) => SHORT_SOURCE[f] ?? f;
const AUTO = 'Present by default (Auto Punch)';

// ── filters, kept for this tab ────────────────────────────────────────────
type Saved = { period: Period; custom: { from: string; to: string }; department: string; manager: string; source: string };
const DEFAULTS: Saved = { period: 'today', custom: { from: '', to: '' }, department: 'all', manager: 'all', source: 'all' };
const filtersKey = (userId: string) => `sowaka.report.filters.v3.${userId}`;
const readFilters = (userId: string): Saved => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(filtersKey(userId)) ?? '{}') as Partial<Saved>;
    return { ...DEFAULTS, ...saved, period: PERIODS.some(([p]) => p === saved.period) ? (saved.period as Period) : 'today', custom: { ...DEFAULTS.custom, ...(saved.custom ?? {}) } };
  } catch {
    return DEFAULTS;
  }
};
const writeFilters = (userId: string, saved: Saved) => {
  try {
    sessionStorage.setItem(filtersKey(userId), JSON.stringify(saved));
  } catch {
    // Storage blocked: the filters last as long as the page.
  }
};

const PAGE = 50;
const NOTE = 'Day status: leave (or leave without pay, LWP: unpaid, and neither leave nor absent), then week off or holiday, then missed punch (only once the shift has ended), then late, then present. Before the shift ends, anyone without an in-punch shows as Not punched in yet.';

export function AttendanceReport() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [saved] = useState(() => readFilters(userId));
  const [range, setRange] = useState(() => ({ period: saved.period, custom: saved.custom }));
  const { period, custom } = range;
  const today = isoOf(new Date());
  const presets = useMemo(() => presetRanges(today), [today]);
  const fetchFrom = period === 'custom' ? custom.from || custom.to : [presets.week.from, presets.month.from].sort()[0];
  const fetchTo = period === 'custom' ? custom.to || custom.from : [presets.week.to, presets.month.to].sort()[1];
  const shownFrom = period === 'custom' ? fetchFrom : presets[period].from;
  const shownTo = period === 'custom' ? fetchTo : presets[period].to;
  const dates = useMemo(() => (shownFrom && shownTo ? datesBetween(shownFrom, shownTo) : []), [shownFrom, shownTo]);
  const countedDates = useMemo(() => dates.filter((d) => d <= today), [dates, today]);
  const view: 'today' | 'grid' | 'totals' = period === 'today' ? 'today' : period === 'week' || (period === 'custom' && dates.length <= GRID_MAX_DAYS) ? 'grid' : 'totals';

  const [loaded, setLoaded] = useState<{ key: string; at: string; report: AttendanceReportDTO } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [department, setDepartment] = useState(saved.department);
  const [manager, setManager] = useState(saved.manager);
  const [source, setSource] = useState(saved.source);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { writeFilters(userId, { period, custom, department, manager, source }); }, [userId, period, custom, department, manager, source]);

  const pickPeriod = (next: Period) =>
    setRange((prev) => ({ period: next, custom: next === 'custom' ? (prev.custom.from ? prev.custom : { from: presets.month.from, to: today }) : prev.custom }));
  const editRange = (side: 'from' | 'to', value: string) =>
    setRange((prev) => {
      const next = { ...prev.custom, [side]: value };
      if (!next.from && !next.to) return { period: 'today', custom: DEFAULTS.custom };
      return { period: 'custom', custom: next };
    });

  useEffect(() => {
    if (!fetchFrom || !fetchTo) return;
    let live = true;
    const key = cacheKey(userId, fetchFrom, fetchTo);
    const cached = readCached(key);
    if (cached) setLoaded({ key, ...cached });
    setError('');
    const timer = setTimeout(() => {
      getAttendanceReport({ from: fetchFrom, to: fetchTo })
        .then((report) => {
          if (!live) return;
          const value = { at: new Date().toISOString(), report };
          setLoaded({ key, ...value });
          writeCached(key, value);
        })
        .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the report'); });
    }, cached ? 150 : 400);
    return () => { live = false; clearTimeout(timer); };
  }, [fetchFrom, fetchTo, userId, attempt]);

  const shown = loaded && loaded.key === cacheKey(userId, fetchFrom, fetchTo) ? loaded.report : null;
  const reportState: LoadState = shown ? 'ready' : error ? 'error' : 'loading';

  const everyone = useMemo<Person[]>(() => {
    if (!shown) return [];
    const half = new Set(shown.halfDayLeave ?? []);
    const byUser = new Map<string, Person>();
    for (const [id, person] of Object.entries(shown.people)) byUser.set(id, { userId: id, person, days: new Map() });
    for (const row of expandReport(shown)) {
      const p = byUser.get(row.userId);
      if (p) p.days.set(row.date, dayOf(row, p.person, half.has(`${row.userId}|${row.date}`)));
    }
    const off = { mode: '', late: false, punchIn: null, punchOut: null, pending: false, leave: 0, unpaid: 0 };
    for (const [id, date, kind] of shown.offDays ?? []) {
      byUser.get(id)?.days.set(date, kind === 'holiday' ? { ...off, code: 'H', label: 'Holiday' } : { ...off, code: 'WO', label: 'Week off' });
    }
    return [...byUser.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
  }, [shown]);

  const list = useMemo(() => everyone.filter(({ person: p }) =>
    (department === 'all' || p.department === department)
    && (manager === 'all' || p.manager === manager)
    && (source === 'all' || p.punchFormat === source)), [everyone, department, manager, source]);

  const statusIn = (p: Person) => countedDates.map((d) => p.days.get(d)).filter((d): d is Day => Boolean(d));
  const counts = useMemo(() => {
    const per = list.map(statusIn);
    const n = (f: (days: Day[]) => boolean) => per.filter(f).length;
    return {
      present: n((ds) => ds.some(presentLike)),
      late: n((ds) => ds.some((d) => d.late)),
      half: n((ds) => ds.some((d) => d.code === 'HD')),
      leave: n((ds) => ds.some((d) => d.code === 'LV')),
      unpaid: n((ds) => ds.some((d) => d.code === 'LWP')),
      missed: n((ds) => ds.some((d) => d.code === 'MP')),
      notYet: n((ds) => ds.some((d) => d.code === 'NP')),
      punchedIn: n((ds) => ds.some((d) => Boolean(d.punchIn))),
      punchedOut: n((ds) => ds.some((d) => Boolean(d.punchOut))),
    };
    // statusIn reads only countedDates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, countedDates]);
  const graces = [...new Set(list.map((p) => p.person.lateGraceMinutes).filter((g): g is number => typeof g === 'number'))];
  const scope = view === 'today' ? 'today' : 'at least once';
  const cards: { label: string; value: number; sub: string; color: string }[] = [
    { label: 'Employees', value: list.length, sub: 'Matching the filters', color: 'var(--ink)' },
    { label: 'Present', value: counts.present, sub: `${view === 'today' ? 'Punched in today' : `Present ${scope}`}, late included`, color: 'var(--ar-n-present)' },
    { label: 'Late', value: counts.late, sub: graces.length === 1 ? `In after the ${graces[0]}-min grace` : 'In after the grace', color: 'var(--ar-n-late)' },
    { label: 'Half day', value: counts.half, sub: 'Half-day leave with a punch', color: 'var(--ar-n-half)' },
    { label: 'On leave', value: counts.leave, sub: 'Approved full-day leave', color: 'var(--ar-n-leave)' },
    ...(counts.unpaid ? [{ label: 'Leave without pay', value: counts.unpaid, sub: 'Approved, and unpaid', color: 'var(--ar-n-lwp)' }] : []),
    { label: 'Missed punch', value: counts.missed, sub: 'Shift over, a punch missing', color: 'var(--ar-n-missed)' },
    ...(view === 'today' ? [{ label: 'Not punched in yet', value: counts.notYet, sub: 'Shift still running', color: 'var(--ar-n-np)' }] : []),
  ];

  const totalsOf = (p: Person) => {
    const t = { work: 0, present: 0, late: 0, missed: 0, leave: 0, unpaid: 0 };
    for (const date of dates) {
      const d = p.days.get(date);
      if (!d || d.code === 'WO' || d.code === 'H') continue;
      t.work += 1;
      if (date > today) continue;
      if (presentLike(d)) t.present += d.code === 'HD' ? 0.5 : 1;
      // Half a day without pay is half a day worked, as half-day leave is.
      if (d.code === 'LWP' && d.unpaid === 0.5) t.present += 0.5;
      if (d.late) t.late += 1;
      if (d.code === 'MP') t.missed += 1;
      t.leave += d.leave;
      t.unpaid += d.unpaid;
    }
    return t;
  };
  const workingDays = useMemo(() => {
    const tally = new Map<number, number>();
    for (const p of list) {
      const w = dates.filter((d) => { const c = p.days.get(d)?.code; return c && c !== 'WO' && c !== 'H'; }).length;
      tally.set(w, (tally.get(w) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  }, [list, dates]);

  const asOf = loaded?.at ? new Date(loaded.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '';
  const periodLabel = !shownFrom ? ''
    : period === 'today' ? `${dateOf(today).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/^(\w+)/, '$1,').replace(',,', ',')}${asOf ? ` · as of ${asOf}` : ''}`
      : period === 'week' ? spanLabel(shownFrom, shownTo, true)
        : period === 'month' ? `${dateOf(today).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · ${workingDays} working days, counted to today`
          : `${spanLabel(shownFrom, shownTo, false)} · ${view === 'grid' ? 'day view' : 'totals'}`;

  const coverage = source !== 'all' && source !== AUTO && list.length
    ? { name: shortSource(source), expected: list.length, punchedIn: counts.punchedIn, punchedOut: counts.punchedOut, none: list.length - counts.punchedIn }
    : null;

  useEffect(() => { setPage(1); }, [department, manager, source, period, fetchFrom, fetchTo]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const current = Math.min(page, pages);
  const rows = list.slice((current - 1) * PAGE, current * PAGE);

  // ── export: what is on screen ──────────────────────────────────────────
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const who = (p: Person) => ({ 'Employee ID': p.person.employeeId, 'Name': p.person.name, 'Department': p.person.department, 'Manager': p.person.manager || '' });
    const main: Record<string, unknown>[] = list.map((p) => {
      if (view === 'today') {
        const d = p.days.get(today);
        return {
          ...who(p), 'Template': p.person.template ?? 'Default', 'Shift': p.person.shiftStart ? `${p.person.shiftStart}–${p.person.shiftEnd}` : '',
          'In': d?.punchIn ? clock(d.punchIn) : '', 'Out': d?.punchOut ? clock(d.punchOut) : d?.pending ? 'Pending' : '',
          'Status': d?.label ?? '', 'Mode': d?.mode ?? '', 'Attendance source': p.person.punchFormat,
        };
      }
      if (view === 'grid') return { ...who(p), ...Object.fromEntries(dates.map((date) => [date, date > today ? '' : p.days.get(date)?.label ?? ''])) };
      const t = totalsOf(p);
      return { ...who(p), 'Working days': t.work, 'Present': t.present, 'Late': t.late, 'Missed punch days': t.missed, 'Leave days': t.leave, 'Leave without pay days': t.unpaid, 'Attendance source': p.person.punchFormat };
    });
    const sheet = (rowsOut: Record<string, unknown>[]): WorkSheet => {
      const ws = XLSX.utils.json_to_sheet(rowsOut);
      ws['!cols'] = Object.keys(rowsOut[0] ?? {}).map((k) => ({ wch: Math.max(k.length, ...rowsOut.map((r) => String(r[k] ?? '').length)) + 2 }));
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(main), TITLE[period]);
    XLSX.utils.book_append_sheet(wb, sheet([
      { Filter: 'Period', Value: periodLabel },
      { Filter: 'Department', Value: department === 'all' ? 'All departments' : department },
      { Filter: 'Manager', Value: manager === 'all' ? 'All managers' : manager },
      { Filter: 'Attendance source', Value: source === 'all' ? 'All sources' : source },
    ]), 'Filters');
    XLSX.writeFile(wb, `attendance-${shownFrom}-to-${shownTo}.xlsx`);
  };

  const open = openId ? everyone.find((p) => p.userId === openId) ?? null : null;

  return (
    <div className="ar">
      <div className="ar-top">
        <div style={{ display: 'flex', gap: 2, padding: 4, borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)' }} role="tablist">
          {PERIODS.map(([p, label]) => (
            <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => pickPeriod(p)}
              style={{ border: 0, borderRadius: 999, padding: '10px 18px', fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', background: period === p ? 'var(--sel)' : 'transparent', color: period === p ? 'var(--on-sel)' : 'var(--ink-2)' }}>
              {label}
            </button>
          ))}
        </div>
        {period === 'custom' && <DateRange from={custom.from} to={custom.to} onFrom={(v) => editRange('from', v)} onTo={(v) => editRange('to', v)} />}
        <span className="ar-period">{periodLabel}</span>
      </div>

      <div className="ar-filters">
        <LabeledSelect label="Department" value={department} onChange={setDepartment} options={[['all', 'All departments'], ...(shown?.departments ?? []).map((d): [string, string] => [d, d])]} />
        <LabeledSelect label="Manager" value={manager} onChange={setManager} options={[['all', 'All managers'], ...(shown?.managers ?? []).map((m): [string, string] => [m, m])]} />
        <LabeledSelect label="Attendance source" value={source} onChange={setSource} options={[['all', 'All sources'], ...(shown?.punchFormats ?? []).map((f): [string, string] => [f, f])]} />
      </div>
      <button type="button" className="lk-btn-p ar-export" onClick={() => void exportExcel()} disabled={!list.length}
        style={{ ...L.btnPrimary, cursor: list.length ? 'pointer' : 'not-allowed', opacity: list.length ? 1 : 0.5 }}>
        <IconDownload /> Export Excel
      </button>

      {error && shown && <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--bad)' }}>{error}</div>}

      {coverage && (
        <div className="ar-cov">
          <div className="ar-cov-h">
            <div className="ar-cov-k">{coverage.name} coverage · {TITLE[period]}</div>
            <div className="ar-cov-t">{coverage.expected} {coverage.expected === 1 ? 'person is' : 'people are'} expected to punch with {coverage.name}</div>
          </div>
          <div className="ar-cov-n">
            <div><span>Punched in</span><b style={{ color: 'var(--ar-n-present)' }}>{coverage.punchedIn}</b><small>of {coverage.expected}</small></div>
            <div><span>Punched out</span><b style={{ color: 'var(--ar-n-leave)' }}>{coverage.punchedOut}</b><small>of {coverage.expected}</small></div>
            <div><span>{view === 'today' ? 'No punch yet' : 'No punch'}</span><b style={{ color: 'var(--ar-t-missed)' }}>{coverage.none}</b></div>
          </div>
        </div>
      )}

      {shown && (
        <div className="ar-cards">
          {cards.map((c) => (
            <div key={c.label} className="ar-card">
              <div className="ar-card-l">{c.label}</div>
              <div className="ar-card-n" style={{ color: c.color }}>{c.value}</div>
              <div className="ar-card-s">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ar-h"><b>{TITLE[period]}</b>{shown && <span>{list.length} {list.length === 1 ? 'person' : 'people'} · one row per employee</span>}</div>

      <div className="ar-box">
        {!shown ? (
          <ListPending state={reportState} errorText={error || undefined} onRetry={() => setAttempt((n) => n + 1)} rows={8} cols={6} />
        ) : !rows.length ? (
          <div className="ar-empty">{everyone.length ? 'Nobody matches these filters.' : 'Nobody is on the roll for this range.'}</div>
        ) : (
          <>
            {view === 'grid' && (
              <div className="ar-legend">
                {LEGEND.map(([c, label]) => <span key={c}><Chip code={c} /> {label}</span>)}
              </div>
            )}
            <div className="ar-scroll">
              {view === 'today' && (
                <table className="ar-t">
                  <thead><tr><th>Employee</th><th>Template</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th><th>Mode</th></tr></thead>
                  <tbody>
                    {rows.map((p) => {
                      const d = p.days.get(today);
                      return (
                        <tr key={p.userId} onClick={() => setOpenId(p.userId)}>
                          <td><Who p={p} sub={`${p.person.employeeId} · ${p.person.department}`} /></td>
                          <td className="ar-tpl"><b>{p.person.template ?? 'Default'}{p.person.shiftStart ? ` ${p.person.shiftStart}–${p.person.shiftEnd}` : ''}</b><small>{p.person.punchFormat}</small></td>
                          <td>{clock(d?.punchIn ?? null)}</td>
                          <td>{d?.pending ? <span className="ar-pending">Pending</span> : clock(d?.punchOut ?? null)}</td>
                          <td>{hours(d)}</td>
                          <td>{d ? <span className="ar-pill" style={{ background: TONE[d.code].bg, color: TONE[d.code].fg }}>{d.label}</span> : '—'}</td>
                          <td className="ar-mode">{d?.mode ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {view === 'grid' && (
                <table className="ar-t ar-grid">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {dates.map((d) => <th key={d}>{WD(d)} {DAY(d)}{d === today ? ' · Today' : ''}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.userId} onClick={() => setOpenId(p.userId)}>
                        <td><Who p={p} sub={`${p.person.employeeId} · ${p.person.punchFormat}`} /></td>
                        {dates.map((date) => {
                          const d = date > today ? undefined : p.days.get(date);
                          return (
                            <td key={date}>
                              {d ? <Chip code={d.code} title={`${DAY(date)} ${MON(date)}: ${d.label}${d.mode ? ` (${d.mode})` : ''}`} /> : <span className="ar-chip" style={{ color: TONE.future.fg }}>—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {view === 'totals' && (
                <table className="ar-t">
                  <thead><tr><th>Employee</th><th className="num">Working days</th><th className="num">Present</th><th className="num">Late</th><th className="num">Missed punch days</th><th className="num">Leave days</th><th className="num">LWP days</th><th>Attendance source</th></tr></thead>
                  <tbody>
                    {rows.map((p) => {
                      const t = totalsOf(p);
                      return (
                        <tr key={p.userId} onClick={() => setOpenId(p.userId)}>
                          <td><Who p={p} sub={`${p.person.employeeId} · ${p.person.department}`} /></td>
                          <td className="num">{t.work}</td>
                          <td className="num" style={{ color: 'var(--ar-t-present)', fontWeight: 500 }}>{t.present}</td>
                          <td className="num" style={{ color: 'var(--ar-t-late)' }}>{t.late}</td>
                          <td className="num" style={{ color: 'var(--ar-t-missed)' }}>{t.missed}</td>
                          <td className="num" style={{ color: 'var(--ar-t-leave)' }}>{t.leave}</td>
                          <td className="num" style={{ color: t.unpaid ? 'var(--ar-n-lwp)' : undefined }}>{t.unpaid}</td>
                          <td>{p.person.punchFormat}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {view === 'totals' && <div className="ar-foot">Present includes late days and counts a half day as 0.5. Leave days are paid leave; LWP days are leave without pay, a half day as 0.5. A day with both punches missing counts as one missed-punch day. Days after today are not counted.</div>}
            {list.length > PAGE && (
              <div className="ar-pager">
                Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, list.length)} of {list.length}
                <div>
                  <button type="button" className="lk-btn" style={L.btnSm} disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
                  <span>{current} / {pages}</span>
                  <button type="button" className="lk-btn" style={L.btnSm} disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <p className="ar-note">{NOTE}</p>

      {open && <EmployeeDrawer person={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function hours(d: Day | undefined) {
  if (!d?.punchIn || !d.punchOut) return '—';
  const mins = Math.round((new Date(d.punchOut).getTime() - new Date(d.punchIn).getTime()) / 60_000);
  return mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '—';
}

function Who({ p, sub }: { p: Person; sub: string }) {
  return (
    <div className="ar-who">
      <PersonAvatar name={p.person.name} userId={p.userId} size={40} />
      <div style={{ minWidth: 0 }}><b>{p.person.name}</b><small>{sub}</small></div>
    </div>
  );
}

function Chip({ code, title }: { code: Code; title?: string }) {
  return <span className="ar-chip" title={title} style={{ background: TONE[code].bg, color: TONE[code].fg }}>{code}</span>;
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="ar-sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** A person's basic details beside the report, with the profile's one Edit. */
function EmployeeDrawer({ person, onClose }: { person: Person; onClose: () => void }) {
  const s = useStore();
  const { user } = useAuth();
  const emp = s.emps.find((e) => e.id === person.userId);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const canEdit = Boolean(emp) && user?.canEditEmployees === true && (user.dashboardAdmin === true || isSelfOrBelow(s.emps, user.id, emp!));
  const p = person.person;
  const fields: [string, string, boolean][] = [
    ['Full name', emp?.name ?? p.name, true],
    ['Work email', emp?.email || '—', true],
    ['Phone', emp?.phone || '—', false],
    ['Department', emp?.team || p.department, false],
    ['Designation', emp?.role || '—', false],
    ['Reporting manager', emp?.manager || p.manager || '—', false],
    ['Shift', `${p.template ?? 'Default'}${p.shiftStart ? ` ${p.shiftStart}–${p.shiftEnd}` : ''}`, false],
    ['Attendance source', shortSource(p.punchFormat), false],
    ['Work location', emp?.location || p.location || '—', false],
    ['Date of joining', emp?.joining || '—', false],
  ];
  // On the page itself: the report fades in with a transform, which would trap a fixed layer under the top bar.
  return createPortal(
    <div className="ar-dim" onClick={onClose}>
      <aside className="ar-drawer" role="dialog" aria-label={`${p.name}'s details`} onClick={(e) => e.stopPropagation()}>
        <div className="ar-dr-h">
          <PersonAvatar name={p.name} userId={person.userId} size={56} />
          <div style={{ minWidth: 0 }}><b>{p.name}</b><small>{p.employeeId}{emp?.role ? ` · ${emp.role}` : ''}</small></div>
          <button type="button" className="ar-dr-x" onClick={onClose} aria-label="Close"><IconClose size={16} stroke="currentColor" /></button>
        </div>
        <div className="ar-dr-card">
          <div className="ar-dr-ct">
            <b>Basic details</b>
            {canEdit && !editing && <button type="button" className="pd-sec-act" onClick={() => setEditing(true)}><PdEdit /> Edit</button>}
          </div>
          {editing && emp ? (
            <>
              <BasicDetailsEditor emp={emp} onDone={() => setEditing(false)} />
              <div className="ar-dr-sub">
                <div className="ar-dr-f"><span>Shift template</span></div>
                <ShiftPicker emp={emp} onChanged={() => undefined} />
              </div>
            </>
          ) : (
            <>
              {fields.map(([label, value, locked]) => (
                <div key={label} className="ar-dr-f">
                  <span>{label}{locked && <i><PdLock size={12} /> Locked</i>}</span>
                  <div>{value}</div>
                </div>
              ))}
              <p className="ar-dr-note">Full name and work email can&apos;t be edited here. Every other field, including reporting manager, is edited with the one Edit button.</p>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
