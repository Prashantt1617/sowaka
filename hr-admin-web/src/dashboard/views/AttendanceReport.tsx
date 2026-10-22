// Reports › Attendance — how a date range went, for everyone, on one page.
//
// Filters first, then the totals, then the days. The totals are not a summary
// sitting above the real controls: each card is the filter. Press Present and
// the list is the present days; press Missed punch and it opens into the three
// ways a punch can be missing, because "a punch is missing" is never the whole
// question — which one, and was it the one this shift needs.
//
// The date range is the server's; everything else is applied here to the days
// already graded, so a filter changes the page instantly and never re-runs a
// month of grading. The export carries exactly what the filters show.
import { useEffect, useMemo, useState } from 'react';
import type { WorkSheet } from 'xlsx';
import { expandReport, getAttendanceReport } from '../../services/hrms';
import type { AttendanceReportDTO, ReportRow } from '../../services/hrms';
import { Card, DateRange, EmptyRow, ListPending, Pill, SelectBox, SkeletonCards } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { IconDownload } from './peopleTable';
import { useAuth } from '../auth/AuthContext';
import * as L from './look';
import './look.css';

/**
 * The last report for a range, kept in this tab so coming back to the page —
 * or re-picking a range already seen — paints at once and refreshes behind.
 * The link to the database has measured anywhere from under a second to the
 * better part of a minute for the same answer; a stale table that fills in is
 * a better wait than an empty one.
 */
const cacheKey = (userId: string, from: string, to: string) => `sowaka.report.${userId}.${from}.${to}`;
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

/** What a card filters to. Late is a flag on a day, not a status, so it is its own. */
type Facet = 'present' | 'half_day' | 'missed' | 'on_leave' | 'late';
type Filter = 'all' | Facet;
/** Which punch is missing. A day with no punch at all is the third kind. */
type Gap = 'in' | 'out' | 'both';
type GapFilter = 'all' | Gap;

const FACETS: { key: Facet; label: string; note: string }[] = [
  { key: 'present', label: 'Present', note: 'Full days' },
  { key: 'half_day', label: 'Half day', note: 'Both punches available' },
  { key: 'missed', label: 'Missed punch', note: 'One or both punches missing' },
  { key: 'on_leave', label: 'On leave', note: 'Approved leave' },
  { key: 'late', label: 'Late', note: 'In after the grace' },
];

const GAPS: { key: Gap; label: string }[] = [
  { key: 'in', label: 'Missing punch-in' },
  { key: 'out', label: 'Missing punch-out' },
  { key: 'both', label: 'Both punches missing' },
];

const TONE: Record<Facet, { bg: string; fg: string }> = {
  present: { bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  half_day: { bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  missed: { bg: 'var(--t-peach)', fg: 'var(--warn)' },
  on_leave: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  late: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
};

// The same statuses as solid pills in the day list.
const SOLID = new Map<{ bg: string; fg: string }, { bg: string; fg: string }>([
  [TONE.present, L.TONES.ok],
  [TONE.half_day, L.TONES.info],
  [TONE.missed, L.TONES.bad],
  [TONE.on_leave, L.TONES.info],
  [TONE.late, L.TONES.warn],
]);
const solid = (t: { bg: string; fg: string }) => SOLID.get(t) ?? t;

const LEAVE_LABEL: Record<string, string> = {
  sick: 'Sick', casual: 'Casual', earned: 'Earned', comp_off: 'Comp off',
};
/** 'emergency' -> 'Emergency': a type HR added reads as a word, not a key. */
const leaveName = (key: string) => LEAVE_LABEL[key] ?? key.split('_').map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' ');

const PAGE = 20;

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => `${todayIso().slice(0, 7)}-01`;

/**
 * Which punch a day is missing. The server has already decided *whether* one
 * is missing for this person's shift — on a single-punch shift a punch-in
 * alone is a full day and never lands here — so this only has to say which.
 * A punch-out with no punch-in is a missing punch-in whatever the shift: the
 * punch-in is the one every shift needs.
 */
const gapOf = (row: ReportRow): Gap | null => {
  if (row.status === 'absent') return 'both';
  if (row.status !== 'missed_punch') return null;
  return row.punchIn ? 'out' : 'in';
};

const matches = (row: ReportRow, facet: Facet): boolean => {
  switch (facet) {
    case 'present': return row.status === 'present';
    case 'half_day': return row.status === 'half_day';
    case 'missed': return row.status === 'missed_punch' || row.status === 'absent';
    case 'on_leave': return row.status === 'on_leave';
    case 'late': return row.late;
  }
};

/** Counts for a set of days. Cheap enough to run on every filter change. */
function tally(rows: ReportRow[]) {
  const counts = {
    employees: new Set(rows.map((r) => r.userId)).size,
    days: rows.length,
    present: 0, half_day: 0, missed: 0, on_leave: 0, late: 0,
    in: 0, out: 0, both: 0,
  };
  for (const row of rows) {
    for (const facet of FACETS) if (matches(row, facet.key)) counts[facet.key] += 1;
    const gap = gapOf(row);
    if (gap) counts[gap] += 1;
  }
  return counts;
}

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const hours = (row: ReportRow) => {
  if (!row.punchIn || !row.punchOut) return '—';
  const h = (new Date(row.punchOut).getTime() - new Date(row.punchIn).getTime()) / 3_600_000;
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

/** The status a day shows. A day with nothing on it is a missed punch of the third kind. */
const statusOf = (row: ReportRow): { label: string; tone: { bg: string; fg: string } } => {
  switch (row.status) {
    case 'present': return { label: 'Present', tone: TONE.present };
    case 'half_day': return { label: 'Half day', tone: TONE.half_day };
    case 'on_leave': return { label: 'On leave', tone: TONE.on_leave };
    default: return { label: 'Missed punch', tone: TONE.missed };
  }
};
const gapLabel = (row: ReportRow) => {
  const gap = gapOf(row);
  return gap ? GAPS.find((g) => g.key === gap)!.label : '';
};
const detail = (row: ReportRow) =>
  row.leaveType ? `${leaveName(row.leaveType)} leave`
    : gapLabel(row)
      || (row.late ? `Late by ${row.lateByMinutes} min`
        : row.source === 'sql_import' ? 'Biometric device'
          : row.source === 'manual' ? 'App punch' : '');

export function AttendanceReport() {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [report, setReport] = useState<AttendanceReportDTO | null>(null);
  // Which range the report on screen is for: another range shows its own
  // skeleton (or its cached copy), never the last range's days.
  const [reportFor, setReportFor] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const [department, setDepartment] = useState('all');
  const [manager, setManager] = useState('all');
  const [mode, setMode] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [gap, setGap] = useState<GapFilter>('all');
  const [page, setPage] = useState(1);

  const { user } = useAuth();
  const userId = user?.id ?? '';
  // True while a fresh copy is on its way and a cached one is already showing.
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    const key = cacheKey(userId, from, to);
    // Whatever this tab last saw for the range goes up immediately.
    const cached = readCached(key);
    // A range with no copy yet shows its skeleton, not "Refreshing…" left over from the last one.
    if (!cached) setRefreshing(false);
    if (cached) {
      setReport(cached);
      setReportFor(key);
      setRefreshing(true);
    }
    setError('');
    // A date input fires on every edit, and each intermediate value is a
    // complete date; without a pause here, typing a year is several requests.
    const timer = setTimeout(() => {
      getAttendanceReport({ from, to })
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
  }, [from, to, userId, attempt]);

  const shown = report && reportFor === cacheKey(userId, from, to) ? report : null;
  const reportState: LoadState = shown ? 'ready' : error ? 'error' : 'loading';
  const all = useMemo(() => (shown ? expandReport(shown) : []), [shown]);

  // Everything but the card: this is the population the totals describe.
  const scoped = useMemo(
    () => all.filter((r) =>
      (department === 'all' || r.department === department)
      && (manager === 'all' || r.manager === manager)
      && (mode === 'all' || r.punchFormat === mode)),
    [all, department, manager, mode],
  );
  const totals = useMemo(() => tally(scoped), [scoped]);

  // The card narrows the list; under Missed punch, the gap narrows it again.
  const listed = useMemo(() => {
    if (filter === 'all') return scoped;
    const byFacet = scoped.filter((r) => matches(r, filter));
    if (filter !== 'missed' || gap === 'all') return byFacet;
    return byFacet.filter((r) => gapOf(r) === gap);
  }, [scoped, filter, gap]);

  const pick = (facet: Facet) => {
    // Pressing the active card clears it; leaving Missed punch clears its gap.
    const next: Filter = filter === facet ? 'all' : facet;
    setFilter(next);
    if (next !== 'missed') setGap('all');
  };

  // A filter change lands on page one; the page is otherwise clamped to what exists.
  useEffect(() => { setPage(1); }, [department, manager, mode, filter, gap, from, to]);
  const pages = Math.max(1, Math.ceil(listed.length / PAGE));
  const current = Math.min(page, pages);
  const pageRows = listed.slice((current - 1) * PAGE, current * PAGE);

  // ── export ─────────────────────────────────────────────────────────────
  const widths = (rows: Record<string, unknown>[]) =>
    Object.keys(rows[0] ?? {}).map((key) => ({ wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2 }));
  const sheet = (XLSX: typeof import('xlsx'), rows: Record<string, unknown>[]): WorkSheet => {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = widths(rows);
    return ws;
  };
  // One row per attendance mode, then everyone — the totals the cards show,
  // in a shape a spreadsheet can add up.
  const summaryRows = () => {
    const modes = [...new Set(scoped.map((r) => r.punchFormat))].sort();
    const row = (name: string, rows: ReportRow[]) => {
      const t = tally(rows);
      return {
        'Attendance mode': name,
        'Employees': t.employees,
        'Working days': t.days,
        'Present': t.present,
        'Half day': t.half_day,
        'Missed punch': t.missed,
        'Missing punch-in': t.in,
        'Missing punch-out': t.out,
        'Both punches missing': t.both,
        'On leave': t.on_leave,
        'Late': t.late,
      };
    };
    return [...modes.map((m) => row(m, scoped.filter((r) => r.punchFormat === m))), row('All modes', scoped)];
  };
  // Employee-wise: each person's days sit together, in date order, so a
  // month reads down the sheet the way HR reads a register.
  const dayRows = () => [...listed].sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date)).map((r) => ({
    'Employee ID': r.employeeId,
    'Name': r.name,
    'Department': r.department,
    'Manager': r.manager || '',
    'Location': r.location,
    'Shift template': r.template ?? 'Org policy',
    'Attendance mode': r.punchFormat,
    'Date': r.date,
    'Status': statusOf(r).label,
    'Gap': gapLabel(r),
    'Late': r.late ? 'Yes' : 'No',
    'Late by (min)': r.late ? r.lateByMinutes : '',
    'Punch in': clock(r.punchIn),
    'Punch out': clock(r.punchOut),
    'Hours': hours(r),
    'Leave type': r.leaveType ? leaveName(r.leaveType) : '',
    'Source': r.source ?? '',
  }));
  const suffix = `${from}-to-${to}${filter === 'all' ? '' : `-${filter}`}${gap === 'all' ? '' : `-${gap}`}`;
  const exportExcel = async () => {
    // The spreadsheet library is large; it is fetched the first time someone exports.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    // The punches are the sheet the file opens on; the totals sit behind them.
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, dayRows()), 'Attendance');
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, summaryRows()), 'Summary');
    XLSX.writeFile(wb, `attendance-${suffix}.xlsx`);
  };
  const canExport = listed.length > 0;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {/* ── filters ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SelectBox value={department} onChange={setDepartment}>
          <option value="all">All departments</option>
          {(report?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </SelectBox>
        <SelectBox value={manager} onChange={setManager}>
          <option value="all">All managers</option>
          {(report?.managers ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </SelectBox>
        <SelectBox value={mode} onChange={setMode}>
          <option value="all">All attendance modes</option>
          {(report?.punchFormats ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
        </SelectBox>
        {refreshing && <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>Refreshing…</span>}
        <ExportButton label="Export Excel" disabled={!canExport} onClick={() => void exportExcel()} />
      </div>

      {error && shown && (
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--bad)', fontWeight: 400 }}>{error}</div>
      )}

      {/* ── the totals, which are the filter ──────────────────────────── */}
      {!shown && <SkeletonCards count={6} minWidth={120} style={{ marginBottom: 20 }} />}
      {shown && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: filter === 'missed' ? 12 : 20 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', padding: '14px 16px', minHeight: 96, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 400 }}>Employees</div>
          <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6 }}>{totals.employees}</div>
        </div>
        {FACETS.map((f) => (
          <FilterCard
            key={f.key}
            label={f.label}
            note={f.note}
            value={totals[f.key]}
            tone={TONE[f.key]}
            active={filter === f.key}
            onClick={() => pick(f.key)}
          />
        ))}
      </div>}

      {/* Missed punch opens into which punch is missing. */}
      {filter === 'missed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400, marginRight: 4 }}>Which punch</span>
          <GapChip label="All missed" value={totals.missed} active={gap === 'all'} onClick={() => setGap('all')} />
          {GAPS.map((g) => (
            <GapChip key={g.key} label={g.label} value={totals[g.key]} active={gap === g.key} onClick={() => setGap(gap === g.key ? 'all' : g.key)} />
          ))}
        </div>
      )}

      {/* ── the days ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ ...L.cardTitle }}>
          {filter === 'all' ? 'All days' : FACETS.find((f) => f.key === filter)!.label}
          {filter === 'missed' && gap !== 'all' ? ` · ${GAPS.find((g) => g.key === gap)!.label}` : ''}
        </span>
        {shown && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>
          {listed.length} {listed.length === 1 ? 'day' : 'days'} · {new Set(listed.map((r) => r.userId)).size} people
        </span>}
      </div>

      <Card style={{ padding: 20 }}>
        <div style={{ display: 'grid', background: 'var(--surface-2)', borderRadius: 12, gridTemplateColumns: LIST_COLS, gap: 12, padding: '10px 12px', fontSize: 12, fontWeight: 400, letterSpacing: 0, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          <div className="lk-cap">EMPLOYEE</div>
          <div className="lk-cap">TEMPLATE</div>
          <div className="lk-cap">DATE</div>
          <div className="lk-cap">IN</div>
          <div className="lk-cap">OUT</div>
          <div className="lk-cap">HOURS</div>
          <div className="lk-cap">STATUS</div>
          <div className="lk-cap">MODE</div>
        </div>
        {!shown ? (
          <ListPending state={reportState} errorText={error || undefined} onRetry={() => setAttempt((n) => n + 1)} rows={8} cols={8} />
        ) : pageRows.length === 0 ? (
          <EmptyRow text="No days match these filters." />
        ) : pageRows.map((r) => {
          const status = statusOf(r);
          return (
            <div key={`${r.userId}-${r.date}`} className="lk-row" style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <PersonAvatar name={r.name} userId={r.userId} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.employeeId} · {r.department}
                  </div>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.template ?? 'Org policy'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.punchFormat}</div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>{dayLabel(r.date)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 400, color: r.punchIn ? 'var(--ink)' : 'var(--warn)' }}>{clock(r.punchIn)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>{clock(r.punchOut)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' }}>{hours(r)}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Pill label={status.label} tone={solid(status.tone)} />
                {r.late && <Pill label="Late" tone={solid(TONE.late)} />}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 400, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail(r) || '—'}</div>
            </div>
          );
        })}
        {listed.length > 0 && (
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

/** A total that is also the filter: the same card as everywhere else, pressable, lit when it is the one in force. */
function FilterCard({ label, note, value, tone, active, onClick }: {
  label: string; note: string; value: number; tone: { bg: string; fg: string }; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Showing ${label.toLowerCase()} days — press to show all` : `Show ${label.toLowerCase()} days`}
      style={{
        textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
        background: active ? tone.bg : 'var(--surface)',
        border: '1px solid transparent',
        boxShadow: active ? `0 0 0 1px ${tone.fg}, var(--shadow)` : 'var(--shadow)',
        borderRadius: 'var(--r-lg)', padding: '14px 16px', minHeight: 96, transition: 'background .12s, box-shadow .12s',
      }}
    >
      <div style={{ fontSize: 12.5, color: active ? tone.fg : 'var(--ink-2)', fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: tone.fg }}>{value}</div>
      <div style={{ fontSize: 11.5, color: active ? tone.fg : 'var(--ink-3)', fontWeight: 400, marginTop: 4, opacity: active ? 0.85 : 1 }}>{note}</div>
    </button>
  );
}

function GapChip({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', cursor: 'pointer',
        background: active ? 'var(--sel)' : 'var(--surface)', color: active ? 'var(--on-sel)' : 'var(--ink-2)',
        border: `1px solid ${active ? 'var(--sel)' : 'var(--line)'}`, borderRadius: 99, height: 36, padding: '0 14px',
        fontSize: 12.5, fontWeight: 400,
      }}
    >
      {label}
      <span style={{ fontSize: 12, fontWeight: 500, color: active ? 'inherit' : 'var(--ink-3)', opacity: active ? 0.8 : 1 }}>{value}</span>
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

const LIST_COLS = '2fr 1.5fr 1.1fr .8fr .8fr .8fr 1.3fr 1.4fr';
