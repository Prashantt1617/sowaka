// Reports › Company calendar: one month for the whole company (or a department,
// or a manager's team), day by day, counting one thing at a time: present,
// late, left early, half day, missed punch, out of location, absent, on leave
// or leave without pay. It is laid out like the calendar on an employee's
// profile; click a date to see who.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { expandReport, getAttendanceReport, getHolidays, getOutOfLocation } from '../../services/hrms';
import type { AttendanceReportDTO, HolidayDTO, OutOfLocationDTO, ReportRow } from '../../services/hrms';
import { LoadError, SelectBox, Skeleton, SkeletonRows } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass } from '../ds';
import { IconDownload } from '../icons';
import { downloadCsv } from '../export';
import { canOpen } from '../access';
import type { View } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { dateOf, dayLabel, daysIn, isoOf, leaveDates, todayISO } from './leaveDays';
import './people.css';

type Metric = 'present' | 'late' | 'early' | 'half' | 'missed' | 'ool' | 'absent' | 'leave' | 'lwp';
/** One colour per thing counted; none of them the amber the Time office pages dropped. */
const METRICS: { key: Metric; label: string; phrase: string; bg: string; fg: string; look: [string, View]; head: string }[] = [
  { key: 'present', label: 'Present', phrase: 'present', bg: 'var(--ok-bg)', fg: 'var(--ok)', look: ['Punch log', 'punchlog'], head: 'Punched in' },
  { key: 'late', label: 'Late', phrase: 'late', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)', look: ['Punch log', 'punchlog'], head: 'Punched in' },
  { key: 'early', label: 'Left early', phrase: 'left early', bg: 'var(--t-peach)', fg: 'var(--t-peach-i)', look: ['Punch log', 'punchlog'], head: 'Punched out' },
  { key: 'half', label: 'Half day', phrase: 'on a half day', bg: 'var(--t-olive)', fg: 'var(--t-olive-i)', look: ['Punch log', 'punchlog'], head: 'Worked' },
  { key: 'missed', label: 'Missed punch', phrase: 'with a missed punch', bg: 'var(--mute-bg)', fg: 'var(--ink-2)', look: ['Attendance corrections', 'attendance'], head: 'What’s missing' },
  { key: 'ool', label: 'Out of location', phrase: 'out of location', bg: 'var(--t-sky)', fg: 'var(--t-sky-i)', look: ['OOL check-ins', 'oolcheckins'], head: 'Reason' },
  { key: 'absent', label: 'Absent', phrase: 'absent', bg: 'var(--bad-bg)', fg: 'var(--bad)', look: ['Attendance corrections', 'attendance'], head: 'What we have' },
  { key: 'leave', label: 'On leave', phrase: 'on leave', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', look: ['Leave requests', 'leave'], head: 'Leave' },
  { key: 'lwp', label: 'Leave without pay', phrase: 'on leave without pay', bg: 'var(--t-plum)', fg: 'var(--t-plum-i)', look: ['Leave requests', 'leave'], head: 'Leave' },
];
const META = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<Metric, (typeof METRICS)[number]>;
/** Counted from the day's punches, so a day still to come has none. Leave is known ahead. */
const AHEAD: Partial<Record<Metric, true>> = { leave: true, lwp: true };

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const shiftMonth = (month: string, by: number) => {
  const d = dateOf(`${month}-01`);
  return isoOf(new Date(d.getFullYear(), d.getMonth() + by, 1)).slice(0, 7);
};

/** One person counted on one day for one thing, with the line that says why. */
type Hit = { userId: string; name: string; code: string; dept: string; manager: string; detail: string };

/** What this session has already loaded, per month: a revisit shows it at once. */
const calendarMemo = new Map<string, AttendanceReportDTO>();
const oolMemo = new Map<string, OutOfLocationDTO[]>();

export function CompanyCalendar() {
  const s = useStore();
  const { user } = useAuth();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [metric, setMetric] = useState<Metric>('leave');
  const [scope, setScope] = useState('company');
  const [day, setDay] = useState(today);
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

  useEffect(() => {
    let live = true;
    getHolidays().then((h) => live && setHolidays(h)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Everyone still at the company, with their department and manager.
  const people = useMemo(() => {
    const byId = new Map<string, { name: string; code: string; dept: string; manager: string }>();
    for (const e of s.empRaw) {
      if (e.lifecycleStatus === 'offboarded' || e.lifecycleStatus === 'terminated') continue;
      byId.set(e.userId, { name: e.name, code: e.employeeId ?? '', dept: e.department || 'Team', manager: e.managerName ?? '' });
    }
    for (const [id, p] of Object.entries(report?.people ?? {})) {
      if (!byId.has(id)) byId.set(id, { name: p.name, code: p.employeeId, dept: p.department || 'Team', manager: p.manager });
    }
    return byId;
  }, [s.empRaw, report]);

  const groups = useMemo(() => {
    const dept = new Map<string, number>(), mgr = new Map<string, number>();
    for (const p of people.values()) {
      dept.set(p.dept, (dept.get(p.dept) ?? 0) + 1);
      if (p.manager) mgr.set(p.manager, (mgr.get(p.manager) ?? 0) + 1);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { dept: sort(dept), mgr: sort(mgr) };
  }, [people]);

  const inScope = (userId: string) => {
    if (scope === 'company') return true;
    const p = people.get(userId);
    if (!p) return false;
    return scope.startsWith('dept:') ? p.dept === scope.slice(5) : p.manager === scope.slice(4);
  };
  const scopeSize = scope === 'company' ? people.size : (scope.startsWith('dept:') ? groups.dept : groups.mgr).find(([n]) => n === scope.slice(scope.indexOf(':') + 1))?.[1] ?? 0;
  const scopeName = scope === 'company' ? 'Whole company' : scope.startsWith('dept:') ? scope.slice(5) : `${scope.slice(4)}’s team`;

  // Every hit, by metric and day, for the chosen scope.
  const hits = useMemo(() => {
    const out = new Map<string, Hit[]>(); // `${metric}|${date}`
    const add = (m: Metric, date: string, userId: string, detail: string) => {
      if (!inScope(userId)) return;
      const p = people.get(userId);
      const k = `${m}|${date}`;
      const list = out.get(k) ?? [];
      if (list.some((h) => h.userId === userId)) return;
      list.push({ userId, name: p?.name ?? '—', code: p?.code ?? '', dept: p?.dept ?? '', manager: p?.manager ?? '', detail });
      out.set(k, list);
    };
    const rows: ReportRow[] = report ? expandReport(report) : [];
    for (const r of rows) {
      const late = r.lateByMinutes > 0, early = r.earlyByMinutes > 0;
      if (r.status === 'present') add('present', r.date, r.userId, `In at ${clock(r.punchIn)}`);
      if (late) add('late', r.date, r.userId, `In at ${clock(r.punchIn)} · ${r.lateByMinutes} min late`);
      if (early) add('early', r.date, r.userId, `Out at ${clock(r.punchOut)} · ${r.earlyByMinutes} min early`);
      if (r.status === 'half_day') add('half', r.date, r.userId, `${clock(r.punchIn)} – ${clock(r.punchOut)}`);
      if (r.status === 'missed_punch' && !r.shiftRunning) add('missed', r.date, r.userId, !r.punchIn && !r.punchOut ? 'Both punches missed' : !r.punchOut ? `Punch-out missed · in at ${clock(r.punchIn)}` : 'Punch-in missed');
      if (r.status === 'absent' && !r.shiftRunning) add('absent', r.date, r.userId, 'No punch, no leave');
      if (r.status === 'on_leave') add('leave', r.date, r.userId, `${r.leaveType ?? 'Leave'} · approved`);
      if (r.status === 'unpaid_leave') add('lwp', r.date, r.userId, 'Leave without pay · approved');
    }
    for (const o of ool) {
      const reason = (o as { reason?: string }).reason;
      add('ool', o.workDate.slice(0, 10), o.userId, reason ? String(reason) : o.outcome === 'present' ? 'Marked present' : `Request · ${o.status}`);
    }
    // Leave ahead of today, and pending leave on any day, from the leave requests.
    for (const l of s.leaves) {
      if (l.status !== 'Approved' && l.status !== 'Pending' || !l.submitterId) continue;
      // HR's unpaid flag on the person's leave type, sent with the leave list; never guessed from the name.
      const unpaid = l.unpaid === true;
      for (const d of leaveDates(l)) {
        if (d < first || d > last) continue;
        if (l.status === 'Approved' && d <= upTo && report) continue; // the report already counts it
        add(unpaid ? 'lwp' : 'leave', d, l.submitterId, `${l.type} · ${l.status === 'Pending' ? 'pending' : 'approved'}`);
      }
    }
    return out;
  }, [report, ool, s.leaves, people, scope, first, last, upTo]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const countOn = (m: Metric, d: string): number | null => (d > today && !AHEAD[m] ? null : (hits.get(`${m}|${d}`)?.length ?? 0));
  const mdef = META[metric];
  const loading = !report && !error;
  const monthMax = Math.max(1, ...days.map((d) => countOn(metric, d) ?? 0));
  const totals = Object.fromEntries(METRICS.map((m) => [m.key, days.reduce((a, d) => a + (offDay(d) ? 0 : countOn(m.key, d) ?? 0), 0)])) as Record<Metric, number>;
  const best = days.reduce<[string, number] | null>((b, d) => { const v = countOn(metric, d) ?? 0; return v > (b?.[1] ?? 0) ? [d, v] : b; }, null);
  const lead = (dateOf(first).getDay() + 6) % 7;

  const selected = hits.get(`${metric}|${day}`) ?? [];
  const selCount = countOn(metric, day);

  const exportDay = () =>
    downloadCsv<Hit>(
      `${metric}-${day}`,
      [
        { header: 'Employee', value: (h) => h.name },
        { header: 'Employee ID', value: (h) => h.code },
        { header: 'Department', value: (h) => h.dept },
        { header: mdef.head, value: (h) => h.detail },
        { header: 'Manager', value: (h) => h.manager },
      ],
      selected,
    );

  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section className="pd-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="pd-calnav">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="pd-round">‹</button>
            <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="pd-inp" style={{ height: 42, borderRadius: 999, fontSize: 14, fontWeight: 500, padding: '0 14px' }} />
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="pd-round">›</button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
            Showing
            <SelectBox value={scope} onChange={(v) => { setScope(v); }}>
              <option value="company">Whole company · {people.size} people</option>
              <optgroup label="Department">
                {groups.dept.map(([n, c]) => <option key={n} value={`dept:${n}`}>{n} · {c} {c === 1 ? 'person' : 'people'}</option>)}
              </optgroup>
              <optgroup label="Manager’s team">
                {groups.mgr.map(([n, c]) => <option key={n} value={`mgr:${n}`}>{n} · {c} {c === 1 ? 'person' : 'people'}</option>)}
              </optgroup>
            </SelectBox>
          </div>
        </div>

        {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

        <div role="tablist" aria-label="What to count" className="pd-legend">
          {METRICS.map((m) => {
            const on = metric === m.key;
            return (
              <button key={m.key} type="button" role="tab" aria-selected={on} onClick={() => setMetric(m.key)}
                style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 999, border: `1.5px solid ${on ? m.fg : 'transparent'}`, background: on ? m.bg : 'transparent', color: 'var(--ink-2)', font: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
                <i style={{ background: m.fg }} />{m.label} <span style={{ color: 'var(--ink-3)', marginLeft: 5 }}>{loading ? '…' : totals[m.key]}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 14 }}>
            <b style={{ fontWeight: 600 }}>{mdef.label} · {scopeName}</b>
            {scope !== 'company' && <span style={{ color: 'var(--ink-3)' }}> ({scopeSize} {scopeSize === 1 ? 'person' : 'people'})</span>}
            {best && <span style={{ color: 'var(--ink-3)' }}> · highest on {dayLabel(best[0])} with {best[1]}</span>}
          </span>
          <span className="pd-subnote">People counted on each day. Darker means more. Click a date to see who.</span>
        </div>

        <div className="pd-cal" style={{ marginBottom: 6 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="pd-cdh">{d.toUpperCase()}</div>)}
        </div>
        <div className="pd-cal">
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} className="pd-cd empty" />)}
          {loading && days.map((d) => (
            <div key={`sk-${d}`} className="sk-delay" aria-hidden style={{ minHeight: 84, padding: 10, borderRadius: 12, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            const share = v ? 12 + Math.round((v / monthMax) * 38) : 0;
            const bg = off ? 'var(--surface-2)' : future ? undefined : v ? `color-mix(in srgb, ${mdef.fg} ${share}%, var(--surface))` : 'var(--surface)';
            const note = off ? (fest ?? 'Week off') : future ? 'Not yet' : v && metric === 'leave' && (hits.get(`leave|${d}`) ?? []).some((h) => h.detail.endsWith('pending')) ? 'incl. pending' : mdef.label;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                aria-pressed={on}
                aria-label={`${dayLabel(d)}: ${future ? 'not yet' : `${v} ${mdef.phrase}`}`}
                className={future ? 'pd-cd future' : 'pd-cd'}
                style={{ minHeight: 84, textAlign: 'left', font: 'inherit', cursor: 'pointer', background: bg, color: off ? 'var(--ink-4)' : 'var(--ink)', borderColor: off ? 'var(--line)' : v ? 'transparent' : 'var(--line)', boxShadow: on ? 'inset 0 0 0 2px var(--ink)' : d === today ? 'inset 0 0 0 1.5px var(--accent)' : undefined }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                  <b style={{ fontWeight: d === today ? 700 : 500 }}>{Number(d.slice(8))}</b>
                  {fest && <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--t-lilac-i)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fest}>{fest}</span>}
                </div>
                {!off && !future && <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: v ? 'var(--ink)' : 'var(--ink-4)' }}>{v}</div>}
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: v && !off ? mdef.fg : undefined }}>{note}</div>
              </button>
            );
          })}
        </div>
        {!AHEAD[metric] && <div className="pd-subnote" style={{ marginTop: 12 }}>Punches count only once a day has happened; leave shows ahead, pending included.</div>}
        {AHEAD[metric] && <div className="pd-subnote" style={{ marginTop: 12 }}>Approved leave up to today is as the attendance report counts it. Pending leave, and leave still to come, is approx.: by its dates, with Saturday and Sunday taken out when it counts fewer days than its span (week offs per shift and holidays are not applied).</div>}
      </section>

      <section className="pd-card">
        <div className="pd-card-h" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>{dayLabel(day)}{festOn.get(day) ? ` · ${festOn.get(day)}` : ''} · {mdef.label}</h3>
            <small>{scopeName} · {selCount === null ? 'this day hasn’t happened yet' : `${selCount} ${mdef.phrase}`}</small>
          </div>
          <button type="button" disabled={selected.length === 0} onClick={exportDay} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
          {METRICS.map((m) => {
            const v = countOn(m.key, day);
            const on = metric === m.key;
            return (
              <button key={m.key} type="button" aria-pressed={on} onClick={() => setMetric(m.key)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', font: 'inherit', background: on ? m.bg : 'var(--surface)', border: on ? `1.5px solid ${m.fg}` : '1px solid var(--line)', color: 'var(--ink)' }}>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{m.label}</span>
                <span style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : v === null ? '—' : v}</span>
              </button>
            );
          })}
        </div>

        {loading ? <SkeletonRows rows={4} cols={4} /> : selected.length === 0 ? (
          <div className="pd-empty">{selCount === null ? 'Punches for this day show once it happens. Leave is already counted.' : `Nobody ${mdef.phrase} on this day.`}</div>
        ) : (
          <div className="pd-tbl-wrap">
            <table className="pd-t">
              <thead><tr><th>Employee</th><th>{mdef.head}</th><th>Manager</th><th>Where to look</th></tr></thead>
              <tbody>
                {selected.slice().sort((a, b) => a.name.localeCompare(b.name)).map((h) => (
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
                    <td>{h.detail}</td>
                    <td>{h.manager || '—'}</td>
                    <td>
                      {canOpen(user, mdef.look[1])
                        ? <button type="button" onClick={() => s.setView(mdef.look[1])} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)' }}>{mdef.look[0]}</button>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
