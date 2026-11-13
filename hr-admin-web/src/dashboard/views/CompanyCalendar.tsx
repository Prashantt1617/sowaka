// Reports › Company calendar: one month for the whole company (or a department,
// or a manager's team), day by day, counting one thing at a time: present,
// late, left early, half day, missed punch, out of location, on leave
// or leave without pay. It is laid out like the calendar on an employee's
// profile; click a date to see who.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { clearCalendarDay, expandReport, getAttendanceReport, getEmployeeCalendar, getHolidays, getOutOfLocation, setCalendarDay, setDayMarkRemoved } from '../../services/hrms';
import type { AttendanceReportDTO, CalendarDayDTO, HolidayDTO, HrDayStatus, OutOfLocationDTO, ReportRow } from '../../services/hrms';
import { CAL_TONE, MarkDay } from './MarkDay';
import { LoadError, Pill, Skeleton, SkeletonRows } from '../ui';
import { LabeledSelect } from './LabeledSelect';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, iconBtn } from '../ds';
import { IconDownload, IconEye } from '../icons';
import { downloadCsv } from '../export';
import { canOpen } from '../access';
import { STAT } from '../theme';
import type { View } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { dateOf, dayLabel, daysIn, isoOf, leaveDates, MONTH, todayISO } from './leaveDays';
import './people.css';
import { Pager, usePaged } from './Pager';

type Metric = 'present' | 'late' | 'early' | 'half' | 'missed' | 'ool' | 'leave';
/** One colour per thing counted; none of them the amber the Time office pages dropped. */
const METRICS: { key: Metric; label: string; phrase: string; bg: string; fg: string; look: [string, View]; head: string }[] = [
  { key: 'present', label: 'Present', phrase: 'present', bg: 'var(--ok-bg)', fg: 'var(--ok)', look: ['Punch log', 'punchlog'], head: '' },
  { key: 'late', label: 'Late', phrase: 'late', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)', look: ['Punch log', 'punchlog'], head: 'Late by' },
  { key: 'early', label: 'Left early', phrase: 'left early', bg: 'var(--t-peach)', fg: 'var(--t-peach-i)', look: ['Punch log', 'punchlog'], head: 'Left early by' },
  { key: 'half', label: 'Half day', phrase: 'on a half day', bg: 'var(--t-olive)', fg: 'var(--t-olive-i)', look: ['Punch log', 'punchlog'], head: 'Worked' },
  { key: 'missed', label: 'Missed punch', phrase: 'with a missed punch', bg: 'var(--mute-bg)', fg: 'var(--ink-2)', look: ['Attendance corrections', 'attendance'], head: 'What’s missing' },
  { key: 'ool', label: 'Out of location', phrase: 'out of location', bg: 'var(--t-sky)', fg: 'var(--t-sky-i)', look: ['OOL check-ins', 'oolcheckins'], head: 'Reason' },
  { key: 'leave', label: 'On leave', phrase: 'on leave', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', look: ['Leave requests', 'leave'], head: 'Leave' },
];
const META = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<Metric, (typeof METRICS)[number]>;
/** Counted from the day's punches, so a day still to come has none. Leave is known ahead. */
const AHEAD: Partial<Record<Metric, true>> = { leave: true };

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const shiftMonth = (month: string, by: number) => {
  const d = dateOf(`${month}-01`);
  return isoOf(new Date(d.getFullYear(), d.getMonth() + by, 1)).slice(0, 7);
};

/** One person counted on one day for one thing, with the line that says why. */
type Hit = { userId: string; name: string; code: string; dept: string; manager: string; detail: string; inAt?: string | null; outAt?: string | null; leaveId?: string; leaveStatus?: 'Approved' | 'Pending'; miss?: MissKind };
/** Which punch a missed-punch day is missing. */
type MissKind = 'in' | 'out' | 'both';
const MISS_KINDS: [MissKind | 'all', string][] = [['all', 'All'], ['in', 'Missing punch-in'], ['out', 'Missing punch-out'], ['both', 'Both punches missing']];

/** What this session has already loaded, per month: a revisit shows it at once. */
const calendarMemo = new Map<string, AttendanceReportDTO>();
const oolMemo = new Map<string, OutOfLocationDTO[]>();

export function CompanyCalendar() {
  const s = useStore();
  const { user } = useAuth();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [metric, setMetric] = useState<Metric>('leave');
  // Filters, as on the Attendance report: each narrows the people counted; 'all' leaves it open.
  const [dept, setDept] = useState('all');
  const [mgr, setMgr] = useState('all');
  const [loc, setLoc] = useState('all');
  const [source, setSource] = useState('all');
  // Picking what to count (or applying filters) brings the calendar to the top of the page,
  // so the chosen day's list, with its Correct buttons, peeks in below it.
  const calTop = useRef<HTMLDivElement>(null);
  const toCalendar = () => requestAnimationFrame(() => calTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  // Missed punches can be narrowed to one kind (punch-in, punch-out, both); a new metric starts on all of them.
  const [missKind, setMissKind] = useState<MissKind | 'all'>('all');
  const pickMetric = (m: Metric) => { setMetric(m); setMissKind('all'); toCalendar(); };
  // The filters open in one line under the header; picks only count once applied.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({ dept: 'all', mgr: 'all', loc: 'all', source: 'all' });
  const openFilters = () => { setDraft({ dept, mgr, loc, source }); setFiltersOpen((o) => !o); };
  const applyFilters = () => { setDept(draft.dept); setMgr(draft.mgr); setLoc(draft.loc); setSource(draft.source); setFiltersOpen(false); toCalendar(); };
  const clearFilters = () => { setDraft({ dept: 'all', mgr: 'all', loc: 'all', source: 'all' }); setDept('all'); setMgr('all'); setLoc('all'); setSource('all'); setFiltersOpen(false); };
  // Correct: the person whose day HR is marking, with that day as their calendar has it.
  const [fixing, setFixing] = useState<{ userId: string; name: string; day: CalendarDayDTO } | null>(null);
  const [opening, setOpening] = useState('');
  const [saving, setSaving] = useState(false);
  // Removing a late / left-early mark is asked first.
  const [confirmRemove, setConfirmRemove] = useState<{ hit: Hit; which: 'late' | 'early' } | null>(null);
  const [day, setDay] = useState(today);
  // The day's list shows only for a date picked in the month on screen; moving to another month clears it.
  const dayShown = day.startsWith(month);
  useEffect(() => { if (!day.startsWith(month)) setDay(''); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const [report, setReport] = useState<AttendanceReportDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [holidays, setHolidays] = useState<HolidayDTO[]>([]);
  const [ool, setOol] = useState<OutOfLocationDTO[]>([]);

  const first = `${month}-01`;
  const last = isoOf(new Date(dateOf(first).getFullYear(), dateOf(first).getMonth() + 1, 0));
  const days = daysIn(first, last);
  // Punches only exist up to today.
  const upTo = last < today ? last : today;

  useEffect(() => {
    let live = true;
    const key = `${first}|${upTo}`;
    // A month seen before shows at once from memory while the fresh answer comes in.
    setReport(calendarMemo.get(key) ?? null);
    setError('');
    if (first > today) { setReport({ from: first, to: last, departments: [], templates: [], leaveTypes: [], punchFormats: [], managers: [], people: {}, days: [] }); return; }
    getAttendanceReport({ from: first, to: upTo })
      .then((r) => { calendarMemo.set(key, r); if (live) setReport(r); })
      .catch((e) => { if (live && !calendarMemo.has(key)) setError(e instanceof Error ? e.message : 'Could not load the month'); });
    // Out-of-location punches are their own list (and their own access); without it that count stays empty.
    setOol(oolMemo.get(key) ?? []);
    if (canOpen(user, 'oolcheckins')) getOutOfLocation(first, upTo).then((r) => { oolMemo.set(key, r); if (live) setOol(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [month, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // A leave approved or cancelled (in the side drawer, or anywhere) changes the days: read the month again.
  const leavesSeen = useRef(s.leaves);
  useEffect(() => {
    if (leavesSeen.current === s.leaves) return;
    leavesSeen.current = s.leaves;
    calendarMemo.delete(`${first}|${upTo}`);
    setAttempt((n) => n + 1);
  }, [s.leaves]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    getHolidays().then((h) => live && setHolidays(h)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Everyone still at the company, with their department, manager, location and how they punch.
  const people = useMemo(() => {
    const byId = new Map<string, { name: string; code: string; dept: string; manager: string; loc: string; source: string }>();
    for (const e of s.empRaw) {
      if (e.lifecycleStatus === 'offboarded' || e.lifecycleStatus === 'terminated') continue;
      const r = report?.people[e.userId];
      byId.set(e.userId, { name: e.name, code: e.employeeId ?? '', dept: e.department || 'Team', manager: e.managerName ?? '', loc: e.location || r?.location || '', source: r?.punchFormat ?? '' });
    }
    for (const [id, p] of Object.entries(report?.people ?? {})) {
      if (!byId.has(id)) byId.set(id, { name: p.name, code: p.employeeId, dept: p.department || 'Team', manager: p.manager, loc: p.location || '', source: p.punchFormat || '' });
    }
    return byId;
  }, [s.empRaw, report]);

  // Each filter's choices: the values people have, A to Z.
  const choices = useMemo(() => {
    const of = (k: 'dept' | 'manager' | 'loc' | 'source') => [...new Set([...people.values()].map((p) => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { dept: of('dept'), mgr: of('manager'), loc: of('loc'), source: of('source') };
  }, [people]);

  const filtered = dept !== 'all' || mgr !== 'all' || loc !== 'all' || source !== 'all';
  const inScope = (userId: string) => {
    if (!filtered) return true;
    const p = people.get(userId);
    if (!p) return false;
    return (dept === 'all' || p.dept === dept) && (mgr === 'all' || p.manager === mgr) && (loc === 'all' || p.loc === loc) && (source === 'all' || p.source === source);
  };
  const activeFilters = [dept, mgr, loc, source].filter((v) => v !== 'all').length;
  const scopeName = filtered
    ? [dept !== 'all' && dept, mgr !== 'all' && `${mgr}’s team`, loc !== 'all' && loc, source !== 'all' && source].filter(Boolean).join(' · ')
    : 'Whole company';

  // Every hit, by metric and day, for the chosen scope.
  const hits = useMemo(() => {
    const out = new Map<string, Hit[]>(); // `${metric}|${date}`
    const add = (m: Metric, date: string, userId: string, detail: string, leave?: Partial<Hit>) => {
      if (!inScope(userId)) return;
      const p = people.get(userId);
      const k = `${m}|${date}`;
      const list = out.get(k) ?? [];
      if (list.some((h) => h.userId === userId)) return;
      list.push({ userId, name: p?.name ?? '—', code: p?.code ?? '', dept: p?.dept ?? '', manager: p?.manager ?? '', detail, ...leave });
      out.set(k, list);
    };
    // The leave request behind a leave day, so its row can open it.
    const leaveOn = (userId: string, date: string) => s.leaves.find((l) => l.submitterId === userId && l.status === 'Approved' && leaveDates(l).includes(date));
    const rows: ReportRow[] = report ? expandReport(report) : [];
    const punchesOf = new Map(rows.map((r) => [`${r.userId}|${r.date}`, { inAt: r.punchIn, outAt: r.punchOut }]));
    const worked = (a: string | null, b: string | null) => {
      if (!a || !b) return '—';
      const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
      return `${Math.floor(m / 60)}h ${m % 60}m worked`;
    };
    for (const r of rows) {
      const late = r.lateByMinutes > 0, early = r.earlyByMinutes > 0;
      const punches = { inAt: r.punchIn, outAt: r.punchOut };
      if (r.status === 'present') add('present', r.date, r.userId, '', punches);
      if (late) add('late', r.date, r.userId, `${r.lateByMinutes} min`, punches);
      if (early) add('early', r.date, r.userId, `${r.earlyByMinutes} min`, punches);
      if (r.status === 'half_day') add('half', r.date, r.userId, worked(r.punchIn, r.punchOut), punches);
      // As the Attendance report words it: which punch is missing, or both (a day with no punch at all;
      // payroll still counts it as absent). Days HR marked absent are on the person's own calendar.
      if (r.status === 'missed_punch' && !r.shiftRunning) add('missed', r.date, r.userId, !r.punchIn ? 'Missing punch-in' : `Missing punch-out${late ? ' · came in late' : ''}`, { ...punches, miss: !r.punchIn ? 'in' : 'out' });
      if (r.status === 'absent' && !r.shiftRunning && !r.punchIn && !r.punchOut && r.source !== 'hr') add('missed', r.date, r.userId, 'Both punches missing', { ...punches, miss: 'both' });
      if (r.status === 'on_leave' || r.status === 'unpaid_leave') {
        const l = leaveOn(r.userId, r.date);
        // Paid and unpaid leave are one count; an unpaid type says so on its row.
        const name = l?.type ?? (r.status === 'on_leave' ? (r.leaveType ?? 'Leave') : 'Leave without pay');
        add('leave', r.date, r.userId, r.status === 'unpaid_leave' && !/without pay/i.test(name) ? `${name} (without pay)` : name, { leaveId: l?.id, leaveStatus: 'Approved' });
      }
    }
    for (const o of ool) {
      const reason = (o as { reason?: string }).reason;
      add('ool', o.workDate.slice(0, 10), o.userId, reason ? String(reason) : o.outcome === 'present' ? 'Marked present' : `Request · ${o.status}`, punchesOf.get(`${o.userId}|${o.workDate.slice(0, 10)}`));
    }
    // Leave ahead of today, and pending leave on any day, from the leave requests.
    for (const l of s.leaves) {
      if (l.status !== 'Approved' && l.status !== 'Pending' || !l.submitterId) continue;
      // HR's unpaid flag on the person's leave type, sent with the leave list; never guessed from the name.
      const unpaid = l.unpaid === true;
      for (const d of leaveDates(l)) {
        if (d < first || d > last) continue;
        if (l.status === 'Approved' && d <= upTo && report) continue; // the report already counts it
        add('leave', d, l.submitterId, unpaid && !/without pay/i.test(l.type) ? `${l.type} (without pay)` : l.type, { leaveId: l.id, leaveStatus: l.status === 'Pending' ? 'Pending' : 'Approved' });
      }
    }
    return out;
  }, [report, ool, s.leaves, people, dept, mgr, loc, source, first, last, upTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // A day most people had off is the company's week off (or a holiday).
  const offDay = useMemo(() => {
    const n = new Map<string, number>();
    for (const [, date, kind] of report?.offDays ?? []) if (kind === 'week_off') n.set(date, (n.get(date) ?? 0) + 1);
    const total = Math.max(1, Object.keys(report?.people ?? {}).length);
    return (d: string) => (n.get(d) ?? 0) / total >= 0.5;
  }, [report]);
  const festOn = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidays) if (h.date.startsWith(month) && !m.has(h.date.slice(0, 10))) m.set(h.date.slice(0, 10), h.name);
    return m;
  }, [holidays, month]);

  // A metric's people on a day; for missed punches, only the kind picked.
  const listOf = (m: Metric, d: string): Hit[] => {
    const all = hits.get(`${m}|${d}`) ?? [];
    return m === 'missed' && missKind !== 'all' ? all.filter((h) => h.miss === missKind) : all;
  };
  const countOn = (m: Metric, d: string): number | null => (d > today && !AHEAD[m] ? null : listOf(m, d).length);
  // The chips' totals count every kind; the kind tabs say how many of each.
  const rawCountOn = (m: Metric, d: string): number => (d > today && !AHEAD[m] ? 0 : (hits.get(`${m}|${d}`)?.length ?? 0));
  const mdef = META[metric];
  const loading = !report && !error;
  const totals = Object.fromEntries(METRICS.map((m) => [m.key, days.reduce((a, d) => a + (offDay(d) ? 0 : rawCountOn(m.key, d)), 0)])) as Record<Metric, number>;
  const missTotals = Object.fromEntries(MISS_KINDS.map(([k]) => [k, days.reduce((a, d) => a + (offDay(d) || d > today ? 0 : (hits.get(`missed|${d}`) ?? []).filter((h) => k === 'all' || h.miss === k).length), 0)])) as Record<MissKind | 'all', number>;
  const lead = (dateOf(first).getDay() + 6) % 7;
  const gradeMax = Math.max(1, ...days.map((d) => (offDay(d) ? 0 : countOn(metric, d) ?? 0)));

  const selected = listOf(metric, day);
  const paged = usePaged(selected.slice().sort((a, b) => a.name.localeCompare(b.name)), `${metric}|${day}|${missKind}|${dept}|${mgr}|${loc}|${source}`);
  const selCount = countOn(metric, day);

  const exportDay = () =>
    downloadCsv<Hit>(
      `${metric}-${day}`,
      [
        { header: 'Employee', value: (h) => h.name },
        { header: 'Employee ID', value: (h) => h.code },
        { header: 'Department', value: (h) => h.dept },
        { header: 'Punch in', value: (h) => (h.inAt ? clock(h.inAt) : '') },
        { header: 'Punch out', value: (h) => (h.outAt ? clock(h.outAt) : '') },
        { header: mdef.head || 'Detail', value: (h) => h.detail },
        { header: 'Manager', value: (h) => h.manager },
      ],
      selected,
    );

  // Correct: open the person's own day, as their calendar has it, in the same dialog as their Calendar tab.
  const openFix = async (h: Hit) => {
    setOpening(h.userId);
    try {
      const cal = await getEmployeeCalendar(h.userId, day.slice(0, 7));
      const d = cal.days.find((x) => x.date === day);
      if (!d || d.status === 'before_joining') { s.flash(`${h.name} had not joined yet on ${dayLabel(day)}`, 'error'); return; }
      // The server says which days are still open (the current pay period); an older server, this month only.
      if (!(d.canMark ?? day.slice(0, 7) === today.slice(0, 7))) { s.flash(`${dayLabel(day)} is outside the open pay period, so it can no longer be marked`, 'error'); return; }
      setFixing({ userId: h.userId, name: h.name, day: d });
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not open the day', 'error');
    } finally {
      setOpening('');
    }
  };
  // Remove late / early: only that mark comes off the day; the day stays as punched, everywhere.
  const removeMark = async (h: Hit, which: 'late' | 'early') => {
    setOpening(h.userId);
    try {
      await setDayMarkRemoved(h.userId, day, which);
      s.flash(`${h.name} · ${dayLabel(day)}: ${which === 'late' ? 'late' : 'left-early'} mark removed`);
      calendarMemo.delete(`${first}|${upTo}`);
      setAttempt((n) => n + 1);
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not remove the mark', 'error');
    } finally {
      setOpening('');
    }
  };
  const saveFix = async (status: HrDayStatus | null, note: string) => {
    if (!fixing) return;
    setSaving(true);
    try {
      if (status) await setCalendarDay(fixing.userId, fixing.day.date, status, note.trim() || undefined);
      else await clearCalendarDay(fixing.userId, fixing.day.date);
      s.flash(status ? `${fixing.name} · ${dayLabel(fixing.day.date)} marked ${CAL_TONE[status].label.toLowerCase()}` : `${fixing.name} · ${dayLabel(fixing.day.date)} back to what was recorded`);
      setFixing(null);
      calendarMemo.delete(`${first}|${upTo}`);
      setAttempt((n) => n + 1);
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="pd-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="pd-calnav">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="pd-round">‹</button>
            <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="pd-inp" style={{ height: 42, borderRadius: 999, fontSize: 14, fontWeight: 500, padding: '0 14px' }} />
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="pd-round">›</button>
          </div>
          <button type="button" onClick={openFilters} aria-expanded={filtersOpen} className={btnClass()}
            style={{ ...btn(), marginLeft: 'auto', gap: 8, background: filtered ? 'var(--accent-soft)' : undefined, color: filtered ? 'var(--accent-ink)' : undefined }}>
            Filters{activeFilters ? ` · ${activeFilters}` : ''}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        {filtersOpen && (
          <div className="ar-filters compact">
            <LabeledSelect label="Department" value={draft.dept} onChange={(v) => setDraft((d) => ({ ...d, dept: v }))} options={[['all', 'All departments'], ...choices.dept.map((d): [string, string] => [d, d])]} />
            <LabeledSelect label="Manager" value={draft.mgr} onChange={(v) => setDraft((d) => ({ ...d, mgr: v }))} options={[['all', 'All managers'], ...choices.mgr.map((m): [string, string] => [m, m])]} />
            <LabeledSelect label="Location" value={draft.loc} onChange={(v) => setDraft((d) => ({ ...d, loc: v }))} options={[['all', 'All locations'], ...choices.loc.map((l): [string, string] => [l, l])]} />
            <LabeledSelect label="Attendance source" value={draft.source} onChange={(v) => setDraft((d) => ({ ...d, source: v }))} options={[['all', 'All sources'], ...choices.source.map((f): [string, string] => [f, f])]} />
            <button type="button" onClick={applyFilters} className="pd-btn primary">Apply</button>
            {(filtered || Object.values(draft).some((v) => v !== 'all')) && <button type="button" onClick={clearFilters} className="pd-btn ghost">Clear</button>}
          </div>
        )}

        {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

        <div ref={calTop} role="tablist" aria-label="What to count" className="pd-legend" style={{ scrollMarginTop: 96, gap: 6, flexWrap: 'nowrap', alignItems: 'stretch' }}>
          {METRICS.map((m) => {
            const on = metric === m.key;
            // Each a chip in its own colour; the chosen one in a deeper shade of it.
            return (
              <button key={m.key} type="button" role="tab" aria-selected={on} onClick={() => pickMetric(m.key)}
                style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '5px 10px', borderRadius: 12, cursor: 'pointer', font: 'inherit', fontSize: 12.5, lineHeight: 1.25, textAlign: 'left',
                  background: on ? `color-mix(in srgb, ${m.fg} 22%, ${m.bg})` : m.bg,
                  border: `1.5px solid ${on ? m.fg : `color-mix(in srgb, ${m.fg} 28%, transparent)`}`,
                  color: on ? m.fg : 'var(--ink-2)', fontWeight: on ? 600 : 500 }}>
                <i style={{ background: m.fg, flexShrink: 0, margin: 0 }} />
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>{m.label}<span style={{ color: m.fg, fontWeight: 600, whiteSpace: 'nowrap' }}>{loading ? '…' : totals[m.key]}</span></span>
              </button>
            );
          })}
        </div>

        {metric === 'missed' && (
          <div role="tablist" aria-label="Which punch is missing" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '-4px 0 14px' }}>
            {MISS_KINDS.map(([k, label]) => {
              const on = missKind === k;
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setMissKind(k)}
                  style={{ height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 500,
                    border: `1.5px solid ${on ? 'var(--ink-2)' : 'var(--line)'}`, background: on ? 'var(--mute-bg)' : 'var(--surface)', color: on ? 'var(--ink)' : 'var(--ink-2)' }}>
                  {label} <span style={{ fontWeight: 600, marginLeft: 4 }}>{loading ? '…' : missTotals[k]}</span>
                </button>
              );
            })}
          </div>
        )}


        <div className="pd-cal" style={{ marginBottom: 6 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="pd-cdh">{d.toUpperCase()}</div>)}
        </div>
        <div className="pd-cal">
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} className="pd-cd empty" />)}
          {loading && days.map((d) => (
            <div key={`sk-${d}`} className="sk-delay" aria-hidden style={{ height: 68, padding: 8, borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton w={18} h={12} />
              <Skeleton w="50%" h={18} style={{ opacity: 0.7 }} />
            </div>
          ))}
          {!loading && days.map((d) => {
            const v = countOn(metric, d);
            const off = offDay(d);
            const fest = festOn.get(d);
            const future = v === null;
            const on = d === day;
            // As the design draws a day: its count large in the middle, tinted in the metric's colour,
            // deeper the more people (6% to 36%, never fainter than 12% of the month's highest).
            const t = v ? Math.max(0.12, v / gradeMax) : 0;
            const bg = off ? 'var(--surface-2)' : future || !v ? 'var(--surface)' : `color-mix(in srgb, ${mdef.fg} ${Math.round((0.06 + t * 0.3) * 100)}%, var(--surface))`;
            const fg = off || future ? 'var(--ink-3)' : v ? mdef.fg : 'var(--ink-2)';
            // Leave asked for but not yet approved counts too; the note says how many.
            const pending = v && metric === 'leave' ? (hits.get(`leave|${d}`) ?? []).filter((h) => h.leaveStatus === 'Pending').length : 0;
            const note = off ? (fest ? 'Holiday' : 'Week off') : future ? 'Not yet' : pending ? `${pending} awaiting approval` : '';
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                aria-pressed={on}
                aria-label={`${dayLabel(d)}: ${future ? 'not yet' : `${v} ${mdef.phrase}`}`}
                style={{ height: 68, borderRadius: 12, padding: 8, display: 'block', textAlign: 'left', font: 'inherit', cursor: 'pointer', minWidth: 0, background: bg, color: fg,
                  border: on ? '2px solid var(--accent)' : d === today ? '2px dashed var(--ink-2)' : '2px solid transparent' }}
              >
                <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%', width: '100%', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13, lineHeight: 1.2, fontWeight: d === today ? 700 : 500, whiteSpace: 'nowrap' }}>{Number(d.slice(8))} {MONTH[Number(d.slice(5, 7)) - 1].slice(0, 3)}</span>
                    {fest && <span title={fest} style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2, opacity: 0.85, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{fest}</span>}
                  </div>
                  <span style={{ alignSelf: 'end', fontSize: 17, fontWeight: 600, lineHeight: 1, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{off || future ? '' : v}</span>
                  <span style={{ fontSize: 11, lineHeight: 1.2, opacity: 0.85, minHeight: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {dayShown && (
      <section className="pd-card">
        <div className="pd-card-h" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>{dayLabel(day)}{festOn.get(day) ? ` · ${festOn.get(day)}` : ''} · {mdef.label}</h3>
            <small>{scopeName} · {selCount === null ? 'this day hasn’t happened yet' : `${selCount} ${mdef.phrase}`}</small>
          </div>
          <button type="button" disabled={selected.length === 0} onClick={exportDay} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
        </div>

        {/* One line of tiles, one per count; on a narrow screen the line scrolls sideways instead of wrapping. */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${METRICS.length}, minmax(92px, 1fr))`, gap: 8, marginBottom: 16, overflowX: 'auto' }}>
          {METRICS.map((m) => {
            const v = countOn(m.key, day);
            const on = metric === m.key;
            return (
              <button key={m.key} type="button" aria-pressed={on} onClick={() => pickMetric(m.key)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px', minWidth: 0, borderRadius: 12, cursor: 'pointer', textAlign: 'left', font: 'inherit', background: on ? m.bg : 'var(--surface)', border: on ? `1.5px solid ${m.fg}` : '1px solid var(--line)', color: 'var(--ink)' }}>
                <span style={{ fontSize: 11.5, lineHeight: 1.3, color: 'var(--ink-3)' }}>{m.label}</span>
                <span style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 'auto' }}>{loading ? '…' : v === null ? '—' : v}</span>
              </button>
            );
          })}
        </div>

        {loading ? <SkeletonRows rows={4} cols={4} /> : selected.length === 0 ? (
          <div className="pd-empty">{selCount === null ? 'Not yet' : `Nobody ${mdef.phrase}`}</div>
        ) : (
          <>
          <div className="pd-tbl-wrap">
            <table className="pd-t">
              <thead><tr><th>Employee</th>{metric !== 'leave' && <><th>Punch in</th><th>Punch out</th></>}{metric !== 'present' && <th>{mdef.head}</th>}<th>Manager</th>{metric === 'leave' && <th>Status</th>}{metric !== 'present' && <th aria-label="Action" />}</tr></thead>
              <tbody>
                {paged.rows.map((h) => (
                  <tr key={h.userId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PersonAvatar name={h.name} userId={h.userId} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <b>{h.name}</b>
                          <span className="muted" style={{ fontSize: 12 }}>{[h.code, h.dept].filter(Boolean).join(' · ')}</span>
                        </div>
                      </div>
                    </td>
                    {metric !== 'leave' && <><td>{h.inAt ? clock(h.inAt) : '—'}</td><td>{h.outAt ? clock(h.outAt) : '—'}</td></>}
                    {metric !== 'present' && <td>{h.detail}</td>}
                    <td>{h.manager || '—'}</td>
                    {metric === 'leave' && <td>{h.leaveStatus ? <Pill label={h.leaveStatus} tone={STAT[h.leaveStatus]} /> : '—'}</td>}
                    {metric !== 'present' && (
                      <td style={{ textAlign: 'right' }}>
                        {metric === 'leave' ? (
                          h.leaveId && <button type="button" onClick={() => s.setDrawerId(h.leaveId!)} aria-label={`Open ${h.name}'s leave`} className="ds-icon-btn" style={{ ...iconBtn(34), marginLeft: 'auto' }}><IconEye stroke="currentColor" /></button>
                        ) : (metric === 'late' || metric === 'early') ? (
                          <button type="button" disabled={opening === h.userId} onClick={() => setConfirmRemove({ hit: h, which: metric })} className="pd-btn" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>
                            {opening === h.userId ? 'Removing…' : metric === 'late' ? 'Remove late mark' : 'Remove early mark'}
                          </button>
                        ) : day <= today && (
                          <button type="button" disabled={opening === h.userId} onClick={() => void openFix(h)} className="pd-btn" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>
                            {opening === h.userId ? 'Opening…' : 'Correct'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={paged} />
          </>
        )}
      </section>
      )}
      {confirmRemove && createPortal(
        <div className="pd-scrim">
          <div className="bg" onClick={() => setConfirmRemove(null)} />
          <div className="pd-modal" role="dialog" aria-modal="true" aria-labelledby="remove-mark-title" style={{ width: 'min(440px, 100%)' }}>
            <div className="pd-md-h">
              <div>
                <h3 id="remove-mark-title">Remove {confirmRemove.which === 'late' ? 'late' : 'left-early'} mark?</h3>
                <div className="pd-md-sub">{confirmRemove.hit.name} · {dayLabel(day)} · {confirmRemove.hit.detail}</div>
              </div>
            </div>
            <div className="pd-md-b">
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                The day stays as punched. The {confirmRemove.which === 'late' ? 'late' : 'left-early'} mark comes off the calendar, punch log, reports and payroll.
              </p>
            </div>
            <div className="pd-md-f">
              <button type="button" onClick={() => setConfirmRemove(null)} className="pd-btn" style={{ marginLeft: 'auto' }}>Cancel</button>
              <button type="button" onClick={() => { const c = confirmRemove; setConfirmRemove(null); void removeMark(c.hit, c.which); }} className="pd-btn primary">
                Remove {confirmRemove.which === 'late' ? 'late' : 'early'} mark
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {fixing && <MarkDay day={fixing.day} saving={saving} onClose={() => setFixing(null)} onSave={(status, note) => void saveFix(status, note)} />}
    </div>
  );
}
