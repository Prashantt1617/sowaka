// Reports › Attendance — how today, this week or this month went, one row per
// employee.
//
// Every number counts people, not days: one row per employee, one status per
// employee per day, picked in a fixed order (on leave, week off or holiday,
// late, present, not punched in yet, missed punch). Today lists each person's
// status and punches; a week is a grid of short chips; a month is each
// person's totals. A custom range under eight days is the grid, longer is the
// totals.
//
// The server grades the days (the same grading payroll reads); this page only
// turns each graded day into its one status, so nothing here can disagree with
// a payslip about a punch. Today, the week and the month come from one
// request, so switching between them is instant. The filters live in this
// tab's session, so leaving the page and coming back finds them as they were.
import { useEffect, useMemo, useState } from 'react';
import type { WorkSheet } from 'xlsx';
import { expandReport, getAttendanceReport } from '../../services/hrms';
import type { AttendanceReportDTO, ReportPersonDTO, ReportRow } from '../../services/hrms';
import { Card, DateRange, EmptyRow, ListPending, SearchInput, SelectBox, SkeletonCards, StatusTabs } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { IconDownload } from './peopleTable';
import { useAuth } from '../auth/AuthContext';
import * as L from './look';
import './look.css';

/**
 * The last report for a range, kept in this tab so coming back to the page —
 * or re-picking a range already seen — paints at once and refreshes behind.
 */
const cacheKey = (userId: string, from: string, to: string) => `sowaka.report.v2.${userId}.${from}.${to}`;
const readCached = (key: string): AttendanceReportDTO | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AttendanceReportDTO) : null;
  } catch {
    return null;
  }
};
const writeCached = (key: string, report: AttendanceReportDTO) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(report));
  } catch {
    // Quota or private mode: the page still works, it just won't paint early.
  }
};

// ── one status per employee per day ──────────────────────────────────────
/** The day's one status, as its chip reads. */
type Code = 'LV' | 'HL' | 'WO' | 'H' | 'L' | 'P' | 'NY' | 'MP' | 'A';
const CODE: Record<Code, { label: string; tone: { bg: string; fg: string } }> = {
  LV: { label: 'On leave', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  HL: { label: 'Half day leave', tone: { bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' } },
  WO: { label: 'Week off', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-3)' } },
  H: { label: 'Holiday', tone: { bg: 'var(--t-butter)', fg: 'var(--t-butter-i)' } },
  L: { label: 'Late', tone: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' } },
  P: { label: 'Present', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
  NY: { label: 'Not punched in yet', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
  MP: { label: 'Missed punch', tone: { bg: 'var(--t-peach)', fg: 'var(--t-peach-i)' } },
  A: { label: 'Absent (marked by HR)', tone: { bg: 'var(--bad-bg)', fg: 'var(--bad)' } },
};
/** The legend under a grid, in the order a day's status is decided. */
const LEGEND: Code[] = ['P', 'L', 'MP', 'LV', 'HL', 'WO', 'H', 'NY'];
const PRESENT = new Set<Code>(['P', 'L']);
const LEAVE = new Set<Code>(['LV', 'HL']);

/**
 * A graded day as its one status. The server has already said whether a punch
 * is missing for this person's shift (a single-punch shift needs only the
 * punch-in); a day with an in-time is present, or late, unless it is missing
 * its out-punch after the shift ended. While the shift is still running nothing
 * is missed yet: an in-time is present with the out-punch pending, and no
 * in-time is not punched in yet.
 */
function codeOf(row: ReportRow, halfLeave: boolean): Code {
  if (row.status === 'on_leave') return halfLeave ? 'HL' : 'LV';
  if (row.shiftRunning) return row.punchIn ? (row.late ? 'L' : 'P') : 'NY';
  // HR's own mark, which has no punches behind it.
  if (row.source === 'hr') return row.status === 'absent' ? 'A' : 'P';
  if (row.status === 'missed_punch') return 'MP';
  if (row.punchIn) return row.late ? 'L' : 'P';
  // Present by default: nobody punches, and the working day is a present day.
  if (row.status === 'present') return 'P';
  return 'MP';
}

/** Whether a person had one of these statuses on any of these dates. */
const had = (p: PersonDays, codes: Set<Code>, dates: string[]) => dates.some((d) => {
  const c = p.days.get(d)?.code;
  return c !== undefined && codes.has(c);
});

/** One person over the days on screen. */
type PersonDays = {
  userId: string;
  person: ReportPersonDTO;
  /** By date: the status, and the graded day behind it (none on a week off or holiday). */
  days: Map<string, { code: Code; row?: ReportRow }>;
};

/** A person's totals over a set of dates; statuses only count up to today. */
function totalsOf(p: PersonDays, dates: string[], today: string) {
  const t = { working: 0, present: 0, late: 0, missed: 0, leave: 0 };
  for (const date of dates) {
    const d = p.days.get(date);
    if (!d || d.code === 'WO' || d.code === 'H') continue;
    t.working += 1;
    if (date > today) continue;
    if (PRESENT.has(d.code)) t.present += 1;
    if (d.code === 'L') t.late += 1;
    if (d.code === 'MP') t.missed += 1;
    if (d.code === 'LV') t.leave += 1;
    if (d.code === 'HL') t.leave += 0.5;
  }
  return t;
}

// ── the range ─────────────────────────────────────────────────────────────
/** A date as YYYY-MM-DD on this computer's calendar, which is the office's. */
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};

type Period = 'today' | 'week' | 'month' | 'custom';
const PERIODS: Period[] = ['today', 'week', 'month', 'custom'];
const PERIOD_LABEL: Record<Period, string> = { today: 'Today', week: 'This week', month: 'This month', custom: 'Custom' };
/** Under this many days a custom range is the week grid; from it on, the month totals. */
const GRID_MAX_DAYS = 7;

/** Today, this week (Monday to Sunday, as the shifts' weekly offs run) and this calendar month. */
function presetRanges(today: string) {
  const now = new Date(`${today}T00:00:00`);
  const monday = addDays(today, -((now.getDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return {
    today: { from: today, to: today },
    week: { from: monday, to: addDays(monday, 6) },
    month: { from: monthStart, to: monthEnd },
  };
}

// ── attendance sources ────────────────────────────────────────────────────
/** The shift template's punch format, as the filter and the rows name it. */
const SOURCE_LABEL: Record<string, string> = {
  'Biometric': 'Biometric',
  'Geotag (powered by Sowaka)': 'Geotag',
  'In-app punch in': 'In-app',
  'Present by default (Auto Punch)': 'Auto punch',
};
const sourceName = (format: string) => SOURCE_LABEL[format] ?? format;
/** How a punch reached us: the biometric import, or the app (Geotag and in-app alike). */
const punchedVia = (format: string): string | null =>
  format === 'Biometric' ? 'sql_import' : format === 'Present by default (Auto Punch)' ? null : 'manual';

// ── filters, kept for this tab ────────────────────────────────────────────
type Card3 = 'present' | 'on_leave' | 'missed';
type Saved = {
  period: Period;
  custom: { from: string; to: string };
  department: string;
  manager: string;
  source: string;
  search: string;
  card: Card3 | 'all';
};
const DEFAULTS: Saved = {
  period: 'today', custom: { from: '', to: '' }, department: 'all', manager: 'all', source: 'all', search: '', card: 'all',
};
const filtersKey = (userId: string) => `sowaka.report.filters.v2.${userId}`;
const readFilters = (userId: string): Saved => {
  try {
    const raw = sessionStorage.getItem(filtersKey(userId));
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return {
      ...DEFAULTS,
      ...saved,
      period: PERIODS.includes(saved.period as Period) ? (saved.period as Period) : DEFAULTS.period,
      custom: { ...DEFAULTS.custom, ...(saved.custom ?? {}) },
    };
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

const CARDS: { key: Card3; label: string; codes: Set<Code> }[] = [
  { key: 'present', label: 'Present', codes: PRESENT },
  { key: 'on_leave', label: 'On leave', codes: LEAVE },
  { key: 'missed', label: 'Missed punch', codes: new Set<Code>(['MP']) },
];

const PAGE = 25;

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const dayHead = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return { wd: d.toLocaleDateString('en-IN', { weekday: 'short' }), dm: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) };
};
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function AttendanceReport() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [saved] = useState(() => readFilters(userId));

  const [range, setRange] = useState(() => ({ period: saved.period, custom: saved.custom }));
  const { period, custom } = range;
  // Worked out afresh each render, so a page left open overnight moves to the new today.
  const today = isoOf(new Date());
  const presets = useMemo(() => presetRanges(today), [today]);
  // One request covers today, the week and the month; Custom asks for its own.
  const fetchFrom = period === 'custom' ? custom.from || custom.to : [presets.week.from, presets.month.from].sort()[0];
  const fetchTo = period === 'custom' ? custom.to || custom.from : [presets.week.to, presets.month.to].sort()[1];
  const shownRange = period === 'custom' ? { from: fetchFrom, to: fetchTo } : presets[period];
  const dates = useMemo(() => (shownRange.from && shownRange.to ? datesBetween(shownRange.from, shownRange.to) : []), [shownRange.from, shownRange.to]);
  const view: 'today' | 'grid' | 'totals' = period === 'today' ? 'today'
    : period === 'week' ? 'grid'
      : period === 'month' ? 'totals'
        : dates.length <= GRID_MAX_DAYS ? 'grid' : 'totals';

  const [report, setReport] = useState<AttendanceReportDTO | null>(null);
  const [reportFor, setReportFor] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const [department, setDepartment] = useState(saved.department);
  const [manager, setManager] = useState(saved.manager);
  const [source, setSource] = useState(saved.source);
  const [search, setSearch] = useState(saved.search);
  const [card, setCard] = useState<Card3 | 'all'>(saved.card);
  const [page, setPage] = useState(1);

  useEffect(() => {
    writeFilters(userId, { period, custom, department, manager, source, search, card });
  }, [userId, period, custom, department, manager, source, search, card]);

  const pickPeriod = (next: Period) =>
    setRange((prev) => ({ period: next, custom: next === 'custom' ? (prev.custom.from ? prev.custom : presets.week) : prev.custom }));
  const editRange = (side: 'from' | 'to', value: string) =>
    setRange((prev) => {
      const base = prev.period === 'custom' ? prev.custom : presets[prev.period];
      const next = { ...base, [side]: value };
      if (!next.from && !next.to) return { period: 'today', custom: DEFAULTS.custom };
      return { period: 'custom', custom: next };
    });
  const clearFilters = () => {
    setDepartment('all');
    setManager('all');
    setSource('all');
    setSearch('');
    setCard('all');
  };
  const narrowed = department !== 'all' || manager !== 'all' || source !== 'all' || search.trim() !== '';

  useEffect(() => {
    if (!fetchFrom || !fetchTo) return;
    let live = true;
    const key = cacheKey(userId, fetchFrom, fetchTo);
    const cached = readCached(key);
    if (!cached) setRefreshing(false);
    if (cached) {
      setReport(cached);
      setReportFor(key);
      setRefreshing(true);
    }
    setError('');
    // A date input fires on every edit; without a pause, typing a year is several requests.
    const timer = setTimeout(() => {
      getAttendanceReport({ from: fetchFrom, to: fetchTo })
        .then((data) => {
          if (!live) return;
          setReport(data);
          setReportFor(key);
          writeCached(key, data);
        })
        .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the report'); })
        .finally(() => { if (live) setRefreshing(false); });
    }, cached ? 150 : 400);
    return () => { live = false; clearTimeout(timer); };
  }, [fetchFrom, fetchTo, userId, attempt]);

  const shown = report && reportFor === cacheKey(userId, fetchFrom, fetchTo) ? report : null;
  const reportState: LoadState = shown ? 'ready' : error ? 'error' : 'loading';

  // Everyone, each with one status per date: graded days, then the days they did not owe.
  const everyone = useMemo<PersonDays[]>(() => {
    if (!shown) return [];
    const half = new Set(shown.halfDayLeave ?? []);
    const byUser = new Map<string, PersonDays>();
    for (const [id, person] of Object.entries(shown.people)) byUser.set(id, { userId: id, person, days: new Map() });
    for (const row of expandReport(shown)) {
      byUser.get(row.userId)?.days.set(row.date, { code: codeOf(row, half.has(`${row.userId}|${row.date}`)), row });
    }
    for (const [id, date, kind] of shown.offDays ?? []) byUser.get(id)?.days.set(date, { code: kind === 'holiday' ? 'H' : 'WO' });
    return [...byUser.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
  }, [shown]);

  // Who the page is about, before a card narrows the list.
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return everyone.filter(({ person: p }) =>
      (department === 'all' || p.department === department)
      && (manager === 'all' || p.manager === manager)
      && (source === 'all' || p.punchFormat === source)
      && (!q || p.name.toLowerCase().includes(q) || p.employeeId.toLowerCase().includes(q)));
  }, [everyone, department, manager, source, search]);

  // Past and present dates of the range: a day that has not come yet has no status.
  const countedDates = useMemo(() => dates.filter((d) => d <= today), [dates, today]);
  const cardCounts = useMemo(
    () => Object.fromEntries(CARDS.map((c) => [c.key, scoped.filter((p) => had(p, c.codes, countedDates)).length])) as Record<Card3, number>,
    [scoped, countedDates],
  );
  const listed = useMemo(() => {
    if (card === 'all') return scoped;
    const codes = CARDS.find((c) => c.key === card)!.codes;
    return scoped.filter((p) => had(p, codes, countedDates));
  }, [scoped, card, countedDates]);

  // With one source picked: of the people expected on it, who punched in and out that way.
  const coverage = useMemo(() => {
    const via = source === 'all' ? null : punchedVia(source);
    if (!via || !scoped.length) return null;
    const columns = period === 'custom'
      ? [{ label: `${dayLabel(shownRange.from)} – ${dayLabel(shownRange.to)}`, dates: countedDates }]
      : (['today', 'week', 'month'] as const).map((k) => ({ label: PERIOD_LABEL[k], dates: datesBetween(presets[k].from, presets[k].to).filter((d) => d <= today) }));
    return columns.map((col) => {
      let punchedIn = 0;
      let punchedOut = 0;
      for (const p of scoped) {
        const rows = col.dates.map((d) => p.days.get(d)?.row).filter((r): r is ReportRow => Boolean(r) && r!.source === via);
        if (rows.some((r) => r.punchIn)) punchedIn += 1;
        if (rows.some((r) => r.punchOut)) punchedOut += 1;
      }
      return { label: col.label, expected: scoped.length, punchedIn, punchedOut };
    });
  }, [scoped, source, period, countedDates, today, presets, shownRange.from, shownRange.to]);

  const pick = (key: Card3) => setCard((c) => (c === key ? 'all' : key));
  useEffect(() => { setPage(1); }, [department, manager, source, search, card, period, fetchFrom, fetchTo]);
  const pages = Math.max(1, Math.ceil(listed.length / PAGE));
  const current = Math.min(page, pages);
  const pageRows = listed.slice((current - 1) * PAGE, current * PAGE);
  const cardWords = period === 'today' ? 'today' : 'on at least one day';

  // ── export: what is on screen, then every day behind it ──────────────
  const widths = (rows: Record<string, unknown>[]) =>
    Object.keys(rows[0] ?? {}).map((key) => ({ wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2 }));
  const sheet = (XLSX: typeof import('xlsx'), rows: Record<string, unknown>[]): WorkSheet => {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = widths(rows);
    return ws;
  };
  const who = (p: PersonDays) => ({ 'Employee ID': p.person.employeeId, 'Name': p.person.name, 'Department': p.person.department, 'Manager': p.person.manager || '' });
  const mainRows = (): Record<string, unknown>[] => listed.map((p) => {
    if (view === 'today') {
      const d = p.days.get(today);
      return {
        ...who(p),
        'Status': d ? CODE[d.code].label : '',
        'In time': d?.row?.punchIn ? clock(d.row.punchIn) : '',
        'Out time': d?.row?.punchOut ? clock(d.row.punchOut) : d?.row?.punchIn && d.row.shiftRunning ? 'Pending' : '',
        'Attendance source': sourceName(p.person.punchFormat),
      };
    }
    if (view === 'grid') {
      return { ...who(p), ...Object.fromEntries(dates.map((d) => {
        const c = d > today ? undefined : p.days.get(d)?.code;
        return [d, c ? CODE[c].label : ''];
      })) };
    }
    const t = totalsOf(p, dates, today);
    return {
      ...who(p), 'Working days': t.working, 'Present days': t.present, 'Late days': t.late, 'Missed punch days': t.missed,
      'Leave days': t.leave, 'Attendance source': sourceName(p.person.punchFormat),
    };
  });
  const dayRows = () => listed.flatMap((p) => countedDates.map((d) => {
    const day = p.days.get(d);
    if (!day) return null;
    return {
      ...who(p), 'Date': d, 'Status': CODE[day.code].label,
      'In time': day.row?.punchIn ? clock(day.row.punchIn) : '', 'Out time': day.row?.punchOut ? clock(day.row.punchOut) : '',
      'Late by (min)': day.row?.late ? day.row.lateByMinutes : '', 'Leave type': day.row?.leaveType ?? '',
      'Punched via': day.row?.source === 'sql_import' ? 'Biometric device' : day.row?.source === 'manual' ? 'App' : day.row?.source === 'hr' ? 'Marked by HR' : '',
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null));
  const filterRows = () => [
    { 'Filter': 'Period', 'Value': period === 'custom' ? 'Custom range' : PERIOD_LABEL[period] },
    { 'Filter': 'From', 'Value': shownRange.from },
    { 'Filter': 'To', 'Value': shownRange.to },
    { 'Filter': 'Department', 'Value': department === 'all' ? 'All departments' : department },
    { 'Filter': 'Manager', 'Value': manager === 'all' ? 'All managers' : manager },
    { 'Filter': 'Attendance source', 'Value': source === 'all' ? 'All sources' : sourceName(source) },
    { 'Filter': 'Search', 'Value': search.trim() || '—' },
    { 'Filter': 'Employees', 'Value': card === 'all' ? 'Everyone' : `${CARDS.find((c) => c.key === card)!.label} ${cardWords}` },
  ];
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, mainRows()), view === 'today' ? 'Today' : view === 'grid' ? 'Days' : 'Totals');
    const each = dayRows();
    if (view !== 'today' && each.length) XLSX.utils.book_append_sheet(wb, sheet(XLSX, each), 'Every day');
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, filterRows()), 'Filters');
    const suffix = [`${shownRange.from}-to-${shownRange.to}`, department !== 'all' && slug(department), source !== 'all' && slug(sourceName(source)), card !== 'all' && card].filter(Boolean).join('-');
    XLSX.writeFile(wb, `attendance-${suffix}.xlsx`);
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {/* ── the range ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <StatusTabs<Period> options={PERIODS} active={period} onSelect={pickPeriod} labels={PERIOD_LABEL} />
        {period === 'custom'
          ? <DateRange from={custom.from} to={custom.to} onFrom={(v) => editRange('from', v)} onTo={(v) => editRange('to', v)} />
          : <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{period === 'today' ? dayLabel(today) : `${dayLabel(shownRange.from)} – ${dayLabel(shownRange.to)}`}</span>}
        {refreshing && <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>Refreshing…</span>}
        <ExportButton label="Export Excel" disabled={!listed.length} onClick={() => void exportExcel()} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or employee ID…" />
        <SelectBox value={department} onChange={setDepartment}>
          <option value="all">All departments</option>
          {(shown?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </SelectBox>
        <SelectBox value={manager} onChange={setManager}>
          <option value="all">All managers</option>
          {(shown?.managers ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </SelectBox>
        <SelectBox value={source} onChange={setSource}>
          <option value="all">All attendance sources</option>
          {(shown?.punchFormats ?? []).map((f) => <option key={f} value={f}>{sourceName(f)}</option>)}
        </SelectBox>
        {(narrowed || card !== 'all') && (
          <button type="button" onClick={clearFilters} className="lk-btn" style={{ ...L.btnGhost, height: 40, fontSize: 13 }}>
            Clear filters
          </button>
        )}
      </div>

      {error && shown && <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--bad)', fontWeight: 400 }}>{error}</div>}

      {/* ── three counts of people, each also the filter ─────────────── */}
      {!shown && <SkeletonCards count={3} minWidth={160} style={{ marginBottom: 20 }} />}
      {shown && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          {CARDS.map((c) => (
            <CountCard
              key={c.key}
              label={c.label}
              value={cardCounts[c.key]}
              of={scoped.length}
              note={`${c.label === 'Present' ? 'present' : c.label === 'On leave' ? 'on leave' : 'with a missed punch'} ${cardWords}`}
              tone={CODE[c.key === 'present' ? 'P' : c.key === 'on_leave' ? 'LV' : 'MP'].tone}
              active={card === c.key}
              onClick={() => pick(c.key)}
            />
          ))}
        </div>
      )}

      {/* ── one source picked: did the people on it punch that way ────── */}
      {shown && coverage && (
        <Card padded style={{ marginBottom: 20 }}>
          <div style={{ ...L.cardTitle, fontSize: 14 }}>{sourceName(source)} coverage</div>
          <div style={{ ...L.cardNote, marginTop: 2, marginBottom: 12 }}>
            People expected to punch with {sourceName(source)}, and how many punched in and out that way at least once.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ar-cov">
              <thead>
                <tr><th />{coverage.map((c) => <th key={c.label}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                <tr><th>Expected on {sourceName(source)}</th>{coverage.map((c) => <td key={c.label}>{c.expected}</td>)}</tr>
                <tr><th>Punched in via {sourceName(source)}</th>{coverage.map((c) => <td key={c.label}>{c.punchedIn}</td>)}</tr>
                <tr><th>Punched out via {sourceName(source)}</th>{coverage.map((c) => <td key={c.label}>{c.punchedOut}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── the people ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ ...L.cardTitle }}>{card === 'all' ? 'Everyone' : `${CARDS.find((c) => c.key === card)!.label} ${cardWords}`}</span>
        {shown && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>{listed.length} {listed.length === 1 ? 'person' : 'people'}</span>}
        {shown && view === 'totals' && dates.some((d) => d > today) && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>· Working days cover the whole range; the other counts run to today.</span>
        )}
      </div>

      <Card style={{ padding: 20 }}>
        {!shown ? (
          <ListPending state={reportState} errorText={error || undefined} onRetry={() => setAttempt((n) => n + 1)} rows={8} cols={5} />
        ) : everyone.length === 0 ? (
          <EmptyRow text="Nobody is on the roll for this range." />
        ) : pageRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontWeight: 400 }}>
            <div>Nobody matches these filters.</div>
            <button type="button" onClick={clearFilters} className="lk-btn" style={{ ...L.btnSm, marginTop: 14 }}>Clear filters</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {view === 'today' && <TodayTable rows={pageRows} today={today} />}
            {view === 'grid' && <WeekGrid rows={pageRows} dates={dates} today={today} />}
            {view === 'totals' && <TotalsTable rows={pageRows} dates={dates} today={today} />}
          </div>
        )}
        {shown && view === 'grid' && pageRows.length > 0 && (
          <div className="ar-legend">
            {LEGEND.map((c) => <span key={c}><Chip code={c} /> {CODE[c].label}</span>)}
          </div>
        )}
        {listed.length > PAGE && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0 0' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>
              Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, listed.length)} of {listed.length}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <PageButton label="Previous" disabled={current <= 1} onClick={() => setPage(current - 1)} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', padding: '0 6px' }}>{current} / {pages}</span>
              <PageButton label="Next" disabled={current >= pages} onClick={() => setPage(current + 1)} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Who({ p }: { p: PersonDays }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
      <PersonAvatar name={p.person.name} userId={p.userId} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.person.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.person.employeeId} · {p.person.department}
        </div>
      </div>
    </div>
  );
}

function TodayTable({ rows, today }: { rows: PersonDays[]; today: string }) {
  return (
    <table className="ar-t">
      <thead><tr><th>Employee</th><th>Status</th><th>In time</th><th>Out time</th><th>Attendance source</th></tr></thead>
      <tbody>
        {rows.map((p) => {
          const d = p.days.get(today);
          const row = d?.row;
          return (
            <tr key={p.userId}>
              <td><Who p={p} /></td>
              <td>{d ? <StatusPill code={d.code} /> : '—'}{row?.late && d?.code === 'L' ? <span className="ar-sub">by {row.lateByMinutes} min</span> : null}</td>
              <td>{clock(row?.punchIn ?? null)}</td>
              <td>{row?.punchOut ? clock(row.punchOut) : row?.punchIn && row.shiftRunning ? <span style={{ color: 'var(--accent-ink)' }}>Pending</span> : '—'}</td>
              <td>{sourceName(p.person.punchFormat)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WeekGrid({ rows, dates, today }: { rows: PersonDays[]; dates: string[]; today: string }) {
  return (
    <table className="ar-t ar-grid">
      <thead>
        <tr>
          <th>Employee</th>
          {dates.map((d) => {
            const h = dayHead(d);
            return <th key={d} className={d === today ? 'ar-today' : undefined}>{h.wd}<span className="ar-sub">{h.dm}</span></th>;
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.userId}>
            <td><Who p={p} /></td>
            {dates.map((d) => {
              const day = d > today ? undefined : p.days.get(d);
              return (
                <td key={d} className={d === today ? 'ar-today' : undefined}>
                  {day ? <Chip code={day.code} title={`${CODE[day.code].label}${day.row?.punchIn ? ` · in ${clock(day.row.punchIn)}` : ''}${day.row?.punchOut ? ` · out ${clock(day.row.punchOut)}` : ''}`} /> : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsTable({ rows, dates, today }: { rows: PersonDays[]; dates: string[]; today: string }) {
  return (
    <table className="ar-t">
      <thead>
        <tr><th>Employee</th><th>Working days</th><th>Present days</th><th>Late days</th><th>Missed punch days</th><th>Leave days</th><th>Attendance source</th></tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const t = totalsOf(p, dates, today);
          return (
            <tr key={p.userId}>
              <td><Who p={p} /></td>
              <td className="ar-n">{t.working}</td>
              <td className="ar-n">{t.present}</td>
              <td className="ar-n">{t.late || '—'}</td>
              <td className="ar-n" style={t.missed ? { color: 'var(--t-peach-i)' } : undefined}>{t.missed || '—'}</td>
              <td className="ar-n">{t.leave ? days(t.leave) : '—'}</td>
              <td>{sourceName(p.person.punchFormat)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Chip({ code, title }: { code: Code; title?: string }) {
  const { tone, label } = CODE[code];
  return <span className="ar-chip" title={title ?? label} style={{ background: tone.bg, color: tone.fg }}>{code}</span>;
}

function StatusPill({ code }: { code: Code }) {
  const { tone, label } = CODE[code];
  return <span className="ar-pill" style={{ background: tone.bg, color: tone.fg }}>{label}</span>;
}

/** A count of people that is also the filter: pressed, the list is those people. */
function CountCard({ label, value, of, note, tone, active, onClick }: {
  label: string; value: number; of: number; note: string; tone: { bg: string; fg: string }; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Press to show everyone' : `Show only the people ${note}`}
      style={{
        textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
        background: active ? tone.bg : 'var(--surface)',
        border: '1px solid transparent',
        boxShadow: active ? `0 0 0 1px ${tone.fg}, var(--shadow)` : 'var(--shadow)',
        borderRadius: 'var(--r-lg)', padding: '14px 16px', minHeight: 96, transition: 'background .12s, box-shadow .12s',
      }}
    >
      <div style={{ fontSize: 12.5, color: active ? tone.fg : 'var(--ink-2)', fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: tone.fg, fontVariantNumeric: 'tabular-nums' }}>
        {value}<span style={{ fontSize: 13, color: 'var(--ink-3)', letterSpacing: 0, marginLeft: 6 }}>of {of}</span>
      </div>
      <div style={{ fontSize: 11.5, color: active ? tone.fg : 'var(--ink-3)', fontWeight: 400, marginTop: 4, opacity: active ? 0.85 : 1 }}>{note}</div>
    </button>
  );
}

function ExportButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="lk-btn-p"
      style={{ ...L.btnPrimary, marginLeft: 'auto', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <IconDownload /> {label}
    </button>
  );
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 34, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)',
        fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}
