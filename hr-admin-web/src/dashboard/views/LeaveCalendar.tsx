import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import type { Leave } from '../seed';
import { getHolidays } from '../../services/hrms';
import type { HolidayDTO } from '../../services/hrms';
import { Card, EmptyRow, ListPending, LoadingFigure, SelectBox, Th } from '../ui';
import type { LoadState } from '../ui';
import { btn, btnClass, cellSub, iconBtn, SEG, segBtn, TH } from '../ds';
import { IconChevronLeft, IconChevronRight, IconDownload } from '../icons';
import { downloadCsv } from '../export';
import { dateOf, dayLabel, daysIn, isoOf, isWeekend, LEAVE_COLS, MONTH, needsActionSummary, peopleTotals, perDay, todayISO } from './leaveDays';
import { DayBars, LeaveRow, Swatch } from './leaveParts';

const who = (l: Leave) => l.submitterId || l.name;
/** Shares of a department off that the heatmap calls out. */
const BUSY = 0.25;
const TOO_MANY = 0.4;

export function LeaveCalendar({ state, initialDay, onPending, onOpenDay }: {
  state: LoadState;
  initialDay: string | null;
  onPending: () => void;
  onOpenDay: (iso: string) => void;
}) {
  const s = useStore();
  const today = todayISO();
  const [day, setDay] = useState(initialDay || today);
  const [month, setMonth] = useState(() => (initialDay || today).slice(0, 7));
  const [tab, setTab] = useState<'overall' | 'dept'>('overall');
  const [dept, setDept] = useState<string | null>(null);
  const [type, setType] = useState('all');
  const [holidays, setHolidays] = useState<HolidayDTO[]>([]);

  useEffect(() => {
    let live = true;
    // Holidays are a nice-to-have here: no access or a failure just leaves the dots off.
    getHolidays().then((h) => live && setHolidays(h)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const first = dateOf(`${month}-01`);
  const days = daysIn(`${month}-01`, isoOf(new Date(first.getFullYear(), first.getMonth() + 1, 0)));
  const shift = (k: number) => {
    const d = new Date(first.getFullYear(), first.getMonth() + k, 1);
    const m = isoOf(d).slice(0, 7);
    setMonth(m);
    setDay(today.startsWith(m) ? today : `${m}-01`);
    setDept(null);
  };

  const leaves = useMemo(() => (type === 'all' ? s.leaves : s.leaves.filter((l) => l.type === type)), [s.leaves, type]);
  const counts = useMemo(() => perDay(leaves, days), [leaves, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => peopleTotals(counts), [counts]);

  const festByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const h of holidays) if (h.date.startsWith(month)) m.set(h.date.slice(0, 10), [...(m.get(h.date.slice(0, 10)) ?? []), h.name]);
    return m;
  }, [holidays, month]);

  // Department sizes: everyone still at the company, by department.
  const depts = useMemo(() => {
    const size = new Map<string, number>();
    for (const e of s.empRaw) {
      if (e.lifecycleStatus === 'offboarded' || e.lifecycleStatus === 'terminated') continue;
      const d = e.department || 'Team';
      size.set(d, (size.get(d) ?? 0) + 1);
    }
    for (const l of leaves) if (!size.has(l.team)) size.set(l.team, 0);
    return [...size.entries()].map(([name, n]) => ({ name, size: n })).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  }, [s.empRaw, leaves]);

  const offIn = (i: number, name: string) => new Set([...counts[i].approved, ...counts[i].pending].filter((l) => l.team === name).map(who)).size;

  const di = days.indexOf(day);
  const sel = di >= 0 ? counts[di] : { approved: [], pending: [] };
  const a = new Set(sel.approved.map(who)).size;
  const p = new Set(sel.pending.map(who)).size;
  const dayRows = [...sel.pending, ...sel.approved]
    .filter((l, i, all) => all.indexOf(l) === i)
    .filter((l) => !dept || l.team === dept);
  const crowded = di >= 0 ? depts.filter((d) => d.size >= 3 && offIn(di, d.name) / d.size >= TOO_MANY) : [];
  const fest = festByDay.get(day);

  const exportDay = () =>
    downloadCsv<Leave>(
      `leave-${day}${dept ? `-${dept}` : ''}`,
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Type', value: (r) => r.type },
        { header: 'From', value: (r) => r.from },
        { header: 'To', value: (r) => r.to },
        { header: 'Days', value: (r) => r.dayN },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Applied', value: (r) => r.applied },
      ],
      dayRows,
    );

  const na = needsActionSummary(s.leaves);
  const types = [...new Set(s.leaves.map((r) => r.type))].sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {na.pending.length > 0 && (
        <button type="button" onClick={onPending} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 20px', background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 16, cursor: 'pointer', font: 'inherit', color: 'var(--ink)', textAlign: 'left' }}>
          <span style={{ fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>Needs action:</span> {na.pending.length} pending
            {na.passed > 0 && ` · ${na.passed} ${na.passed === 1 ? 'date' : 'dates'} already passed`}
            {na.soon > 0 && ` · ${na.soon} start within 7 days`}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--warn)' }}>Review pending</span>
        </button>
      )}

      <Card padded>
        <section aria-labelledby="leave-cal-month" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="ds-icon-btn" style={iconBtn(38)}><IconChevronLeft size={16} stroke="currentColor" /></button>
              <h2 id="leave-cal-month" style={{ margin: 0, fontSize: 18, fontWeight: 600, minWidth: 160, textAlign: 'center' }}>{MONTH[first.getMonth()]} {first.getFullYear()}</h2>
              <button type="button" aria-label="Next month" onClick={() => shift(1)} className="ds-icon-btn" style={iconBtn(38)}><IconChevronRight size={16} stroke="currentColor" /></button>
            </div>
            <div role="tablist" aria-label="Calendar view" style={SEG}>
              {([['overall', 'Overall'], ['dept', 'By department']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setDept(null); }} style={segBtn(tab === id)}>{label}</button>
              ))}
            </div>
            <SelectBox value={type} onChange={setType}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </SelectBox>
          </div>

          {tab === 'overall' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="approved" />Approved</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="pending" />Pending (tentative)</span>
                {festByDay.size > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch kind="holiday" />Holiday</span>}
                <span style={{ color: 'var(--ink-3)' }}>Click a day to see who is off</span>
              </div>
              <LoadingFigure state={state} w="100%" h={190}>
                <DayBars days={days} totals={totals} today={today} selected={day} onPick={(d) => { setDay(d); setDept(null); }} height={140} />
              </LoadingFigure>
              {festByDay.size > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[...festByDay.entries()].sort().map(([d, names]) => (
                    <button key={d} type="button" onClick={() => setDay(d)} style={{ border: '1px solid var(--line-2)', background: d === day ? 'var(--accent-soft)' : 'var(--surface)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', font: 'inherit', color: 'var(--ink-2)' }}>
                      {dateOf(d).getDate()} · {names.join(', ')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ ...legend, background: 'var(--accent-soft)' }} />A few off</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ ...legend, background: BUSY_BG }} />{BUSY * 100}% or more off</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ ...legend, background: 'var(--bad-bg)', boxShadow: 'inset 0 0 0 1.5px var(--bad)' }} />{TOO_MANY * 100}% or more off</span>
                <span style={{ color: 'var(--ink-3)' }}>Click a cell to see who is off</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 980, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${days.length}, minmax(0, 1fr))`, gap: 4 }}>
                    <span />
                    {days.map((d) => (
                      <span key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: d === today ? 700 : 500, color: isWeekend(d) ? 'var(--ink-3)' : 'var(--ink)' }}>{dateOf(d).getDate()}</span>
                    ))}
                  </div>
                  {depts.map((dp) => (
                    <div key={dp.name} style={{ display: 'grid', gridTemplateColumns: `160px repeat(${days.length}, minmax(0, 1fr))`, gap: 4, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', paddingRight: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={dp.name}>{dp.name}</span>
                        <span style={cellSub}>{dp.size} {dp.size === 1 ? 'person' : 'people'}</span>
                      </div>
                      {days.map((d, i) => {
                        const c = offIn(i, dp.name);
                        const ratio = dp.size ? c / dp.size : c ? 1 : 0;
                        const on = day === d && dept === dp.name;
                        const wk = isWeekend(d);
                        const cell: CSSProperties = { height: 32, padding: 0, border: 'none', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', font: 'inherit', ...(c === 0 ? { background: wk ? 'var(--surface-2)' : 'var(--mute-bg)', color: 'var(--ink-4)' } : ratio >= TOO_MANY ? { background: 'var(--bad-bg)', color: 'var(--bad)', boxShadow: 'inset 0 0 0 1.5px var(--bad)' } : ratio >= BUSY ? { background: BUSY_BG, color: 'var(--ink)' } : { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }), ...(on ? { outline: '2px solid var(--ink)', outlineOffset: 1 } : null) };
                        const title = `${dp.name}, ${dayLabel(d)}: ${c} of ${dp.size} off`;
                        return <button key={d} type="button" title={title} aria-label={title} onClick={() => { setDay(d); setDept(dp.name); }} style={cell}>{c || ''}</button>;
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </Card>

      <Card padded>
        <section aria-labelledby="leave-cal-day" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
              <h2 id="leave-cal-day" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{dayLabel(day)}{fest ? ` · ${fest.join(', ')}` : ''}{dept ? ` · ${dept}` : ''}</h2>
              <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                {dept
                  ? `${di >= 0 ? offIn(di, dept) : 0} of ${depts.find((d) => d.name === dept)?.size ?? 0} in ${dept} off`
                  : a + p === 0 ? 'Nobody on leave' : `${a + p} on leave · ${a} approved, ${p} pending`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button type="button" onClick={() => onOpenDay(day)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>Open in list view</button>
              <button type="button" disabled={dayRows.length === 0} onClick={exportDay} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
            </div>
          </div>
          {!dept && crowded.length > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 13.5 }}>
              {crowded.map((d) => `${d.name} has ${offIn(di, d.name)} of ${d.size} off`).join(', ')}. Check cover before approving more.
            </div>
          )}
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
              {dayRows.map((r, i) => <LeaveRow key={r.id} r={r} last={i === dayRows.length - 1} onOpen={() => s.setDrawerId(r.id)} />)}
              <ListPending state={state} onRetry={() => void s.reload()} cols={8} rows={3} />
              {state === 'ready' && dayRows.length === 0 && <EmptyRow text="Nobody is on leave this day." />}
            </div>
          </div>
        </section>
      </Card>
    </div>
  );
}

const legend: CSSProperties = { width: 14, height: 14, borderRadius: 3, display: 'inline-block' };
const BUSY_BG = 'color-mix(in srgb, var(--accent) 32%, var(--surface))';
